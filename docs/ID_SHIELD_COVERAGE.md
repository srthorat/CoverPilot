# ID privacy shield: what it covers beyond the bundled samples

The demo is sample-only. The three bundled cards (Masked Aadhaar, Sample PAN Card, Salary Slip) are the tuned path and the controls
for your own file stay hidden unless the image is built with `NEXT_PUBLIC_ALLOW_OWN_FILES=true`. This page is about that flag: how
far the shield goes on other layouts, what was added, and where it still falls short. All documents used are fictional.

## What the shield does (unchanged idea)

1. The browser blurs copies of the document until printed text is unreadable. Only those copies go to SAM 3.1 (photo, signature, QR code) and
   to Muse Spark (where the ID numbers are).
2. The browser pixelates those regions on the sharp image, and only that version goes to the reader.
3. If the reader can still read a number, the app says so.

## Added in this round (own-file mode)

| Change | Where | Why |
|---|---|---|
| One-page PDFs (e-Aadhaar, e-PAN, payslips) | `src/lib/id-raster.ts`, upload control | Page 1 is drawn in the browser with pdf.js, then follows the same path. A password-protected or multi-page PDF is refused with a plain message before anything is sent. |
| Crop to the card | SAM concept `flat rectangular card` (`/api/sam`, `card-bounds`), `cardCrop` | The blur widths were measured for a card that fills the frame. A card that is small in a phone photo is cropped first. (`ID card` and `card` find nothing on a blurred copy; this phrase does, at 60, 80 and 100 px.) |
| Grow a box to its text line | `snapBoxToInk` | The locator's box can sit a few pixels off. It is grown to the single text line it mostly covers, never into a neighbouring line. |
| Mosaic block size follows the region | `pixelBlock` | A close-up number was left readable by a fixed 16 px block. Blocks are now at most about a third of the region's shorter side. |
| Neighbouring row on salary slips | `agreed(..., { neighbours: true })` | On a payslip the answers often land one row apart and every row holds an identifier, so both are covered. Not used on identity cards, where the next line is the name or date of birth. |
| More general locator wording | `/api/locate-ids` (PAN, salary slip) | The PAN and payslip wording was tuned to the sample layouts (a header table; a photo on the left). The Aadhaar wording was left as it was: a more general version made the answers disagree and refused cards that had passed. |
| Refuse when unsure | `assessShield` | A number box that is missing, tiny, off the card or covering most of it stops the scan with a retake message. The locator already refused when its answers disagreed. |
| Do not use a scan with a readable number | app | If the reader returns a number after redaction, nothing is filled in. |
| Stricter leak probe for uploads | `/api/ocr` (`leakProbe`), `src/lib/leak-probe.ts` | The normal check only noticed a whole number. For uploads one more reading asks for whatever is partly legible, and five readable characters count as a leak. If that check cannot run, the scan is not trusted. |
| Copy | upload control | Says it is checked, not guaranteed, and that an unusual layout or a poor photo may stop and ask for a retake. |

## Measured

14 fictional test cards from `tools/id-cards/build.mjs` (a bilingual Aadhaar with a rotation, a low-resolution copy and a high-resolution copy, an
Aadhaar with the number at the top, an Aadhaar letter as a PDF, a phone photo of an Aadhaar; a new PAN with a QR code, an old scanned PAN with grain, a phone
photo of a PAN, an e-PAN as a PDF; a table-style payslip, a landscape payslip as a PDF, a low-resolution payslip). Each goes through the real pipeline, and
the redacted image is read again by an independent Spark call (the app's own reader framing, but asked to return partly readable values with `?`). The
reader finds the numbers on the unredacted cards (12 of 12 characters, checked first), so a "clean" result means something. A leak is five or more
correct characters of a number.

| Card | Before | After |
|---|---|---|
| Aadhaar, bilingual | clean | clean |
| Aadhaar, bilingual, rotated 3 degrees | clean | clean |
| Aadhaar, bilingual, 480 px wide | clean | clean |
| Aadhaar, bilingual, 2400 px wide | clean | clean |
| Aadhaar, number near the top | clean | clean |
| Aadhaar, phone photo | clean | clean |
| Aadhaar letter, PDF | clean | refused (retake message, nothing read) |
| PAN, new layout with QR | clean | clean |
| PAN, old scan with grain, rotated | clean | clean |
| PAN, phone photo | **leaked the whole PAN** | clean |
| e-PAN, PDF | clean | clean |
| Payslip, table | **partial leak (7 characters)** | still readable, but now caught: "PAN number still readable", scan not used |
| Payslip, landscape PDF, numbers in the footer | **leaked all three numbers** | still readable, but now caught: scan not used |
| Payslip, low resolution | clean | clean |
| Bundled sample Aadhaar, PAN, payslip, each twice | not measured | 6 of 6 clean, all completed |

So: identity cards, 10 clean, 1 refused and none leaked after (10 clean and 1 leaked before); the one Aadhaar letter was refused on the last pass (it was
clean on the pass before, so the locator is not steady on it). Payslips, 1 of 3 clean; for the other two the number is still readable in the image the reader sees, and the
app now notices and refuses to use the scan, which it did not for the partial one before. The Chromium acceptance suite passed (20 passed, 2 skipped, the bad-key
checks) on the same build.

## What this does not tell you

- **A "retake" and a "caught" scan have already sent a redacted image to the reader.** Detection happens by reading, so when a number is
  still readable the reader has seen it. That is why payslips are the weak spot: the locator picks the wrong row on some layouts (it looked at the header
  block when the numbers were in a footer line), and no amount of padding fixes a wrong row.
- **Fictional cards, one run each (the matrix was run several times while tuning, and the locator's answers vary).** Four Aadhaar cards were
  refused on one pass and clean on the next. Treat the table as a snapshot, not a rate.
- **Real documents will differ.** Real fonts, holograms, laminate glare, hands and shadows are not here. The face and signature on every card are the sample
  ones.
- **Payslips are not safe enough to promise.** The note in the app says it is checked, not guaranteed. Keep own-file mode off for anything public.
- **Cost:** one scan makes about 12 to 14 model calls (3 for the card position, up to 6 for photo, signature and QR code, 3 for the number, 1 or 2 to read).

## Running it again

```
cd omni_browse
node ../tools/id-cards/build.mjs ../tools/id-cards/out              # the cards (Playwright Chromium)
uv run --with pypdf --with cryptography python ../tools/id-cards/make-edge-pdfs.py ../tools/id-cards/out
docker build -t coverpilot:own --build-arg NEXT_PUBLIC_ALLOW_OWN_FILES=true ..   # then run it on a free port
SHIELD_TAG=run BASE_URL=http://localhost:<port> npx playwright test e2e/shield.spec.ts
```

`tools/id-cards/sam-concepts.mjs` tries SAM concept words on a blurred copy of an image. Results and redacted images land in
`tools/id-cards/results/` (git-ignored).

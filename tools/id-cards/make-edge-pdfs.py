"""Edge-case PDFs for the ID upload checks (all fictional): a password-protected one-pager and a two-page one.

    uv run --with pypdf --with cryptography python tools/id-cards/make-edge-pdfs.py tools/id-cards/out

Run after build.mjs, which writes the source PDFs.
"""
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter

out = Path(sys.argv[1] if len(sys.argv) > 1 else "tools/id-cards/out")
src = PdfReader(str(out / "pn-epan-pdf.pdf"))

locked = PdfWriter()
locked.add_page(src.pages[0])
locked.encrypt(user_password="demo-pass", owner_password="demo-owner")
with open(out / "edge-password.pdf", "wb") as f:
    locked.write(f)

two = PdfWriter()
two.add_page(src.pages[0])
two.add_page(PdfReader(str(out / "ad-eletter.pdf")).pages[0])
with open(out / "edge-two-pages.pdf", "wb") as f:
    two.write(f)
print("wrote edge-password.pdf and edge-two-pages.pdf")

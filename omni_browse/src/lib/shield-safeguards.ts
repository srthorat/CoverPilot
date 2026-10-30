// Safeguards around the ID privacy shield, kept pure so they can be tested without a browser or a model.
//
// The shield blurs copies, asks models where the private parts are, and pixelates those parts in the browser
// before anything reads the card. These checks decide when that result is not trustworthy enough to go on. The rule
// everywhere is the same: when unsure, stop and ask for a retake. Nothing is guessed and nothing falls back to an
// unprotected image.

export interface RegionBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ShieldRegion {
  concept: string;
  box: RegionBox;
}

export type ShieldDocType = 'pan' | 'aadhaar' | 'salary-slip';

/** The ID numbers the locator must confirm on each document. Photo, QR code and signature come from SAM, which
 *  already fails its request when one is not found. */
export const REQUIRED_NUMBERS: Record<ShieldDocType, string[]> = {
  aadhaar: ['Aadhaar number'],
  pan: ['PAN number'],
  'salary-slip': ['PAN number', 'UAN', 'Bank account number'],
};

/** Pixel size of one mosaic block over a region. Never below 16 px, and never more than about three blocks across the
 *  region's shorter side, so a large number (a close-up photo) is as unreadable as a small one. */
export function pixelBlock(width: number, height: number): number {
  return Math.max(16, Math.ceil(Math.min(width, height) / 3));
}

/** A located number must look like a line of text: not tiny, not most of the card, and inside the image. */
export function numberRegionProblem(box: RegionBox, width: number, height: number): string | null {
  const w = (box.right - box.left) / width;
  const h = (box.bottom - box.top) / height;
  if (![box.left, box.top, box.right, box.bottom].every(Number.isFinite)) return 'the box is not a number';
  if (box.right <= 0 || box.bottom <= 0 || box.left >= width || box.top >= height) return 'the box is outside the image';
  if (w < 0.06 || h < 0.012) return 'the box is too small to be a line of digits';
  if (w > 0.9 || h > 0.25 || w * h > 0.2) return 'the box covers too much of the image';
  return null;
}

export interface ShieldAssessment {
  ok: boolean;
  /** Plain-language reason shown to the customer when not ok. */
  message: string;
  missing: string[];
  implausible: string[];
}

/**
 * Where to crop an uploaded photo so the card fills the frame, from the card's box found on a blurred copy.
 * The blur widths were measured for a card that fills the frame, so a card that is small in the picture (a phone
 * photo on a desk) is cropped first. Returns null when no crop is needed or the box is not believable.
 */
export function cardCrop(card: RegionBox, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  const bw = card.right - card.left;
  const bh = card.bottom - card.top;
  if (![card.left, card.top, card.right, card.bottom].every(Number.isFinite) || bw <= 0 || bh <= 0) return null;
  const fraction = (bw * bh) / (width * height);
  if (fraction >= 0.8 || fraction < 0.12) return null; // already fills the frame, or too small to be the card
  const ratio = bw / bh;
  if (ratio < 0.5 || ratio > 3.2) return null; // not card-shaped (ID cards are about 1.6 wide to 1; a page is 0.7)
  const mx = bw * 0.03;
  const my = bh * 0.03;
  const x = Math.max(0, Math.floor(card.left - mx));
  const y = Math.max(0, Math.floor(card.top - my));
  const right = Math.min(width, Math.ceil(card.right + mx));
  const bottom = Math.min(height, Math.ceil(card.bottom + my));
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * Grow a located number box up or down to cover the whole text line it mostly sits on. The locator's box can be a few
 * pixels high or low, which would leave the top or bottom of the digits unhidden. `luma` is the image's brightness per
 * pixel (0 to 255, row by row). Text lines are the runs of rows that hold dark marks, with a gap of three empty rows
 * ending a run; the box is grown to the run it overlaps most and never into another run, so a padded box that touches
 * the line above is not stretched over it. It only grows, and by at most half its height each way.
 */
export function snapBoxToInk(luma: ArrayLike<number>, width: number, height: number, box: RegionBox): RegionBox {
  const left = Math.max(0, Math.floor(box.left));
  const right = Math.min(width, Math.ceil(box.right));
  const top = Math.max(0, Math.floor(box.top));
  const bottom = Math.min(height, Math.ceil(box.bottom));
  const span = right - left;
  const boxH = bottom - top;
  if (span < 4 || boxH < 3) return box;
  const reach = Math.ceil(boxH / 2);
  const y0 = Math.max(0, top - reach);
  const y1 = Math.min(height, bottom + reach);
  // Background brightness: the median of the sampled area.
  const sample: number[] = [];
  for (let y = y0; y < y1; y += 2) for (let x = left; x < right; x += 3) sample.push(luma[y * width + x]);
  sample.sort((a, b) => a - b);
  const bg = sample[Math.floor(sample.length / 2)];
  const need = Math.max(2, Math.floor(span * 0.01));
  const inkRow = (y: number) => {
    let n = 0;
    for (let x = left; x < right; x++) if (Math.abs(luma[y * width + x] - bg) > 60) n++;
    return n >= need;
  };
  // Text lines in the area: [first row, last row] runs, merged across gaps shorter than three rows.
  const runs: Array<[number, number]> = [];
  for (let y = y0; y < y1; y++) {
    if (!inkRow(y)) continue;
    const last = runs[runs.length - 1];
    if (last && y - last[1] <= 3) last[1] = y;
    else runs.push([y, y]);
  }
  let best: [number, number] | null = null;
  let bestOverlap = 0;
  for (const r of runs) {
    const overlap = Math.min(bottom - 1, r[1]) - Math.max(top, r[0]) + 1;
    if (overlap > bestOverlap) {
      best = r;
      bestOverlap = overlap;
    }
  }
  if (!best) return box;
  return { left: box.left, top: Math.min(box.top, best[0]), right: box.right, bottom: Math.max(box.bottom, best[1] + 1) };
}

/** Raised when the shield stops on purpose (a number not confirmed, a leak): the message is for the customer. */
export class ShieldRefusal extends Error {}

export const RETAKE_HINT = 'Try a flat, well-lit photo of the whole card or a one-page PDF, or type the details yourself.';

/** Decide whether the located regions are good enough to pixelate and read. */
export function assessShield(type: ShieldDocType, regions: ShieldRegion[], width: number, height: number): ShieldAssessment {
  const missing: string[] = [];
  const implausible: string[] = [];
  for (const concept of REQUIRED_NUMBERS[type]) {
    const found = regions.filter((r) => r.concept === concept);
    if (!found.length) {
      missing.push(concept);
      continue;
    }
    if (found.some((r) => numberRegionProblem(r.box, width, height))) implausible.push(concept);
  }
  if (!missing.length && !implausible.length) return { ok: true, message: '', missing, implausible };
  const bad = [...missing, ...implausible];
  return {
    ok: false,
    message: `I could not confirm where the ${bad.join(' and the ')} ${bad.length > 1 ? 'are' : 'is'} on this image, so nothing was read. ${RETAKE_HINT}`,
    missing,
    implausible,
  };
}

/** What to tell the customer when the reader could still read an ID number after hiding it. */
export function leakMessage(leaks: string[]): string {
  return `The ${leaks.join(' and ')} could still be read after hiding it, so I did not use this scan. ${RETAKE_HINT}`;
}

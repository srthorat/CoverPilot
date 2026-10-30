import test from 'node:test';
import assert from 'node:assert/strict';
import { assessShield, cardCrop, leakMessage, numberRegionProblem, pixelBlock, REQUIRED_NUMBERS, snapBoxToInk } from './shield-safeguards.ts';
import { ID_PDF_MESSAGES, pageCountProblem, rasterScale } from './id-raster.ts';

const W = 1000;
const H = 630;
const line = { left: 240, top: 430, right: 710, bottom: 480 };

test('pixel blocks stay at 16 px for a normal line and grow for a close-up', () => {
  assert.equal(pixelBlock(470, 50), 17); // about three blocks across a 50 px line
  assert.equal(pixelBlock(100, 30), 16);
  assert.equal(pixelBlock(900, 240), 80); // a big number is not left readable
});

test('a located number must look like a line of text inside the image', () => {
  assert.equal(numberRegionProblem(line, W, H), null);
  assert.match(numberRegionProblem({ left: 10, top: 10, right: 20, bottom: 20 }, W, H) || '', /too small/);
  assert.match(numberRegionProblem({ left: 0, top: 0, right: 990, bottom: 600 }, W, H) || '', /too much/);
  assert.match(numberRegionProblem({ left: 1200, top: 10, right: 1400, bottom: 60 }, W, H) || '', /outside/);
  assert.match(numberRegionProblem({ left: NaN, top: 0, right: 1, bottom: 1 }, W, H) || '', /not a number/);
});

test('every document needs its numbers confirmed, and a bad box is refused with a retake hint', () => {
  assert.deepEqual(REQUIRED_NUMBERS.aadhaar, ['Aadhaar number']);
  assert.equal(assessShield('aadhaar', [{ concept: 'Aadhaar number', box: line }], W, H).ok, true);
  const none = assessShield('aadhaar', [{ concept: 'photo', box: line }], W, H);
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['Aadhaar number']);
  assert.match(none.message, /nothing was read/);
  assert.match(none.message, /type the details yourself/);
  const huge = assessShield('pan', [{ concept: 'PAN number', box: { left: 0, top: 0, right: 1000, bottom: 630 } }], W, H);
  assert.deepEqual(huge.implausible, ['PAN number']);
  const slip = assessShield('salary-slip', [{ concept: 'PAN number', box: line }, { concept: 'UAN', box: line }], W, H);
  assert.deepEqual(slip.missing, ['Bank account number']);
  assert.match(slip.message, /Bank account number is/);
});

test('a leak message names what was readable and does not repeat it', () => {
  const m = leakMessage(['PAN number']);
  assert.match(m, /PAN number could still be read/);
  assert.match(m, /did not use this scan/);
});

test('a small card in a photo is cropped with a margin; a card that fills the frame is not', () => {
  const crop = cardCrop({ left: 300, top: 250, right: 1000, bottom: 700 }, 1600, 1200);
  assert.ok(crop);
  assert.ok(crop.x < 300 && crop.y < 250 && crop.x + crop.w > 1000 && crop.y + crop.h > 700);
  assert.ok(crop.x + crop.w <= 1600 && crop.y + crop.h <= 1200);
  assert.equal(cardCrop({ left: 5, top: 5, right: 995, bottom: 625 }, 1000, 630), null);
  assert.equal(cardCrop({ left: 10, top: 10, right: 100, bottom: 60 }, 1000, 630), null); // too small to be the card
  assert.equal(cardCrop({ left: 0, top: 0, right: 900, bottom: 100 }, 1000, 1000), null); // a strip, not a card
  assert.equal(cardCrop({ left: NaN, top: 0, right: 1, bottom: 1 }, 1000, 630), null);
});

// A white 200 x 100 image with dark "text" bands, to check the ink snapping.
function page(bands: Array<[number, number]>): Uint8ClampedArray {
  const w = 200;
  const h = 100;
  const luma = new Uint8ClampedArray(w * h).fill(255);
  for (const [y0, y1] of bands) for (let y = y0; y < y1; y++) for (let x = 20; x < 180; x += 2) luma[y * w + x] = 10;
  return luma;
}

test('a box that sits low on its text line grows to cover the whole line', () => {
  const luma = page([[44, 58]]); // the line is rows 44 to 57
  const snapped = snapBoxToInk(luma, 200, 100, { left: 20, top: 48, right: 180, bottom: 60 });
  assert.ok(snapped.top <= 44 && snapped.bottom >= 58, JSON.stringify(snapped));
  assert.equal(snapped.left, 20);
  assert.equal(snapped.right, 180);
});

test('a padded box that touches a neighbouring line grows only over the line it mostly covers', () => {
  const luma = page([[40, 50], [60, 78]]); // a small line, a gap, then the number line
  // The box covers rows 44 to 76: 6 rows of the small line and 16 of the number line, which is cut off at the bottom.
  const snapped = snapBoxToInk(luma, 200, 100, { left: 20, top: 44, right: 180, bottom: 76 });
  assert.ok(snapped.bottom >= 78, 'the number line is covered to its last row');
  assert.equal(snapped.top, 44, 'the top is unchanged: it already covered part of the line above');
  const alone = snapBoxToInk(luma, 200, 100, { left: 20, top: 56, right: 180, bottom: 72 });
  assert.ok(alone.top <= 60 && alone.bottom >= 78, JSON.stringify(alone));
  assert.ok(alone.top > 50, 'the small line above is a different line');
});

test('snapping never shrinks and ignores a box with no text', () => {
  const luma = page([[40, 50], [60, 70]]);
  const empty = { left: 20, top: 5, right: 180, bottom: 15 };
  assert.deepEqual(snapBoxToInk(luma, 200, 100, empty), empty);
  const tiny = { left: 20, top: 5, right: 22, bottom: 6 };
  assert.deepEqual(snapBoxToInk(luma, 200, 100, tiny), tiny);
  const around = { left: 20, top: 30, right: 180, bottom: 80 };
  const grown = snapBoxToInk(luma, 200, 100, around);
  assert.ok(grown.top <= around.top && grown.bottom >= around.bottom);
});

test('PDF rules: one page only, a sane drawing scale, a plain message for each problem', () => {
  assert.equal(pageCountProblem(1), null);
  assert.equal(pageCountProblem(2), 'multi-page');
  assert.equal(pageCountProblem(0), 'empty');
  assert.equal(pageCountProblem(NaN), 'empty');
  assert.equal(rasterScale(595), 1400 / 595);
  assert.equal(rasterScale(10), 4);
  assert.equal(rasterScale(100000), 0.5);
  assert.equal(rasterScale(0), 1);
  assert.match(ID_PDF_MESSAGES.password, /password-protected/);
  assert.match(ID_PDF_MESSAGES['multi-page'], /one page/);
});

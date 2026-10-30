import test from 'node:test';
import assert from 'node:assert/strict';
import { agreed, iou, union } from './box-agreement.ts';

const row = (top: number, left = 0.1, right = 0.5) => ({ left, top, right, bottom: top + 0.04 });

test('two overlapping answers agree and are merged; one lone answer does not', () => {
  const merged = agreed([row(0.30), row(0.31), row(0.80)]);
  assert.ok(merged);
  assert.equal(merged.top, 0.30);
  assert.ok(Math.abs(merged.bottom - 0.35) < 1e-9);
  assert.equal(agreed([row(0.1), row(0.5), row(0.9)]), null);
  assert.equal(agreed([row(0.1)]), null);
});

test('overlap and union basics', () => {
  assert.equal(iou(row(0.1), row(0.5)), 0);
  assert.ok(iou(row(0.1), row(0.1)) > 0.99);
  const u = union([row(0.1), row(0.3)]);
  assert.equal(u.top, 0.1);
  assert.ok(Math.abs(u.bottom - 0.34) < 1e-9 && u.left === 0.1 && u.right === 0.5);
});

test('for salary slips an answer one row away is covered too; for cards it is not', () => {
  const answers = [row(0.40), row(0.41), row(0.46)]; // two agree, one sits just below
  const slip = agreed(answers, { neighbours: true });
  assert.ok(slip && slip.bottom >= 0.5, JSON.stringify(slip));
  const card = agreed(answers);
  assert.ok(card && card.bottom < 0.46, JSON.stringify(card));
  // a box far away or in another column is not pulled in
  const far = agreed([row(0.40), row(0.41), row(0.80)], { neighbours: true });
  assert.ok(far && far.bottom < 0.5);
  const other = agreed([row(0.40), row(0.41), row(0.46, 0.7, 0.9)], { neighbours: true });
  assert.ok(other && other.right <= 0.5);
});

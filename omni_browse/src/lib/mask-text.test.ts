import assert from 'node:assert/strict';
import test from 'node:test';
import { maskIdentityNumbers } from './mask-text.ts';

test('identity numbers are masked', () => {
  const r = maskIdentityNumbers('Aadhaar 4321 8765 9012, PAN ABCPS1234K, mobile 9876543210, mail a.b@x.co, a/c 123456789012345');
  assert.equal(r.masked, 5);
  assert.ok(!/4321|ABCPS|9876543210|a\.b@|1234567890123/.test(r.text), r.text);
});

test('policy figures are left alone', () => {
  const t = 'Sum assured 1,00,00,000 rupees, monthly premium 1050, term 30 years, free-look 30 days, page 3, UIN not applicable.';
  assert.equal(maskIdentityNumbers(t).text, t);
  assert.equal(maskIdentityNumbers(t).masked, 0);
});

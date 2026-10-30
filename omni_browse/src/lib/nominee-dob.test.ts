import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNomineeDob } from './nominee-dob.ts';

const now = new Date(2026, 9, 30); // 30 Oct 2026

test('an empty or malformed date is asked for again', () => {
  for (const t of ['', '  ', '19-08-1996', '1/2/1996', 'abc', '19/08/96']) {
    const r = parseNomineeDob(t, now);
    assert.equal(r.age, null);
    assert.match(r.error ?? '', /DD\/MM\/YYYY/);
  }
});

test('a date that does not exist is rejected', () => {
  for (const t of ['31/02/2000', '29/02/2001', '00/01/2000', '10/13/2000']) assert.match(parseNomineeDob(t, now).error ?? '', /not a real date/, t);
  assert.equal(parseNomineeDob('29/02/2000', now).age, 26);
});

test('a date in the future is rejected', () => {
  assert.match(parseNomineeDob('31/10/2026', now).error ?? '', /future/);
  assert.match(parseNomineeDob('01/01/2030', now).error ?? '', /future/);
});

test('age counts whole years and turns on the birthday', () => {
  assert.equal(parseNomineeDob('19/08/1996', now).age, 30);
  assert.equal(parseNomineeDob('30/10/2008', now).age, 18);
  assert.equal(parseNomineeDob('31/10/2008', now).age, 17);
  assert.equal(parseNomineeDob('30/10/2026', now).age, 0);
  assert.equal(parseNomineeDob('15/03/2015', now).age, 11);
});

test('under 18 is a minor, which needs an appointee', () => {
  const r = parseNomineeDob('15/03/2015', now);
  assert.equal(r.error, null);
  assert.ok((r.age ?? 99) < 18);
});

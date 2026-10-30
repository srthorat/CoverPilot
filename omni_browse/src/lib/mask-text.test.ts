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

test('spaced and hyphenated mobile numbers are masked', () => {
  for (const m of ['+91 98765 43210', '+91 9876543210', '98765-43210', '98765 43210', '09876543210', '0091 98765 43210', '+91-98765-43210']) {
    const r = maskIdentityNumbers(`Call me on ${m} after five.`);
    assert.equal(r.masked, 1, m);
    assert.ok(!/\d{4}/.test(r.text.replace('five', '')), `${m} -> ${r.text}`);
  }
});

test('bank account numbers of 9 to 18 digits and spaced cards are masked', () => {
  for (const a of ['123456789', 'A/c 123456789012', '12345678901', '123456789012345678']) {
    assert.equal(maskIdentityNumbers(`Account ${a}.`).masked, 1, a);
  }
  assert.equal(maskIdentityNumbers('Card 4111 1111 1111 1111.').masked, 1);
  assert.ok(!maskIdentityNumbers('Card 4111 1111 1111 1111.').text.includes('1111'));
});

test('policy figures, policy numbers, dates and amounts are left alone', () => {
  const t = [
    'Policy number NXS-DEMO-2026-000123, proposal NXP-DEMO-4821, UIN 000N001V01.',
    'Sum assured 1,00,00,000 rupees; the plain figure 10000000 is 8 digits; 20000000 too.',
    'Customer care 1800-000-0000, issue date 29/10/2026, term 30 years, premium 1,050 rupees a month.',
    'Premium due on the 5th, grace 15 days, revival 5 years, PIN 400001, Rs 1,18,000 a year.',
  ].join(' ');
  const r = maskIdentityNumbers(t);
  assert.equal(r.text, t);
  assert.equal(r.masked, 0);
});

test('a number is masked once, as what it is', () => {
  assert.equal(maskIdentityNumbers('Aadhaar 4321 8765 9012').text, 'Aadhaar [aadhaar masked]');
  assert.equal(maskIdentityNumbers('Mobile 9876543210').text, 'Mobile [mobile masked]');
  assert.equal(maskIdentityNumbers('PAN ABCPS1234K').text, 'PAN [PAN masked]');
});

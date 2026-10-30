import test from 'node:test';
import assert from 'node:assert/strict';
import { leakProbeMessages, partialLeaks } from './leak-probe.ts';

test('five or more readable characters count as a leak, a masked or empty answer does not', () => {
  assert.deepEqual(partialLeaks('pan', { idNumber: 'BKQPN?392?' }), ['PAN number']);
  assert.deepEqual(partialLeaks('aadhaar', { idNumber: '5128 37?? ????' }), ['Aadhaar number']);
  assert.deepEqual(partialLeaks('aadhaar', { idNumber: '???? ???? ????' }), []);
  assert.deepEqual(partialLeaks('aadhaar', { idNumber: 'XXXX XXXX 9051' }), []); // only the last four, the usual mask
  assert.deepEqual(partialLeaks('pan', { idNumber: null }), []);
  assert.deepEqual(partialLeaks('pan', null), []);
});

test('a salary slip is checked for its PAN, UAN and bank account', () => {
  assert.deepEqual(partialLeaks('salary-slip', { idNumber: 'BKQPN7392R', uan: '1012345678', bankAccountNumber: null }), ['PAN number', 'UAN']);
  assert.deepEqual(partialLeaks('salary-slip', { idNumber: null, uan: '10??', bankAccountNumber: '43100298????' }), ['Bank account number']);
  // an identity card has no UAN or bank account to look for
  assert.deepEqual(partialLeaks('pan', { idNumber: null, uan: '101234567890' }), []);
});

test('the probe asks for partly readable values and carries the image', () => {
  const m = leakProbeMessages('salary-slip', 'data:image/png;base64,AAAA');
  assert.equal(m[0].role, 'system');
  assert.match(String(m[0].content), /write \? for each one you cannot/);
  assert.equal(JSON.stringify(m).includes('data:image/png;base64,AAAA'), true);
});

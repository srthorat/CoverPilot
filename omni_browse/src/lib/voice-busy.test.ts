import assert from 'node:assert/strict';
import test from 'node:test';
import { agentIsBusy, capacityUrl, isBusyError, VOICE_BUSY_MESSAGE } from './voice-busy.ts';

const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('the capacity endpoint sits next to the offer endpoint', () => {
  assert.equal(capacityUrl('/voice-agent/api/offer'), '/voice-agent/api/capacity');
  assert.equal(capacityUrl('https://agent.example/api/offer/'), 'https://agent.example/api/capacity');
});

test('the agent counts as busy only when it says so', async () => {
  assert.equal(await agentIsBusy('/voice-agent/api/offer', reply(200, { busy: true, active: 8, limit: 8 })), true);
  assert.equal(await agentIsBusy('/voice-agent/api/offer', reply(200, { busy: false, active: 3, limit: 8 })), false);
});

test('a failure to ask never blocks a visitor: an old agent, an error status or a network error all mean not busy', async () => {
  assert.equal(await agentIsBusy('/x/api/offer', reply(404, { detail: 'Not Found' })), false);
  assert.equal(await agentIsBusy('/x/api/offer', reply(500, {})), false);
  assert.equal(await agentIsBusy('/x/api/offer', reply(200, { something: 'else' })), false);
  assert.equal(await agentIsBusy('/x/api/offer', (async () => { throw new Error('network down'); }) as unknown as typeof fetch), false);
});

test('an error that already says busy is recognised however the client library words it', () => {
  assert.equal(isBusyError(new Error('Failed to connect: HTTP 503 Service Unavailable')), true);
  assert.equal(isBusyError(new Error(`offer failed: ${VOICE_BUSY_MESSAGE}`)), true);
  assert.equal(isBusyError('Error: 503'), true);
});

test('other failures are not mistaken for busy, so they still get their retry and their own message', () => {
  assert.equal(isBusyError(new Error('The voice connection timed out')), false);
  assert.equal(isBusyError(new Error('Offer request failed: [object Response]')), false, 'the library hides the status, so the capacity endpoint decides');
  assert.equal(isBusyError({ name: 'NotAllowedError', message: 'Permission denied' }), false);
  assert.equal(isBusyError(new Error('port 5030 refused')), false, 'only a whole 503 counts');
  assert.equal(isBusyError(undefined), false);
});

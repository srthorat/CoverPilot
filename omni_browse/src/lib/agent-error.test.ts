import test from 'node:test';
import assert from 'node:assert/strict';
import { agentErrorLabel, isHarmlessAudioNote } from './agent-error.ts';

test('the empty-audio tail note is dropped, real errors are not', () => {
  assert.equal(isHarmlessAudioNote('TTS context a5621711-0c53-4101-8ff6-2967ce4e3de5 completed with no audio'), true);
  assert.equal(isHarmlessAudioNote('Google TTS request failed (HTTP 403)'), false);
  assert.equal(isHarmlessAudioNote('Meta API request failed (HTTP 429)'), false);
});

test('speech failures are labelled as voice playback, model failures as Meta errors', () => {
  assert.match(agentErrorLabel('Google TTS request failed (HTTP 403)'), /^Voice playback problem/);
  assert.match(agentErrorLabel('Meta API request failed (HTTP 429)'), /^Meta API error/);
});

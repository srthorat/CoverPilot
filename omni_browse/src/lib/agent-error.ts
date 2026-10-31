// Agent errors that reach the chat. Pipecat reports a speech request that ended without audio (for example the
// empty tail context after a long spoken walkthrough) as a non-fatal error even though everything was spoken;
// showing it as a red "Meta API error" is wrong, so it is dropped here. Real speech failures are still shown,
// labelled as voice playback and not as a Meta model error.

export function isHarmlessAudioNote(message: string): boolean {
  return /TTS context .* completed with no audio/i.test(message);
}

export function agentErrorLabel(message: string): string {
  return /\b(tts|text-to-speech|google tts)\b/i.test(message)
    ? `Voice playback problem (Google Cloud TTS): ${message}`
    : `Meta API error (no fallback configured): ${message}`;
}

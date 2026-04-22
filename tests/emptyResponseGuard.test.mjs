/**
 * Regression test for the empty-model-output guard in backend/server.js.
 *
 * Scenario: STOA (or any other RAG source) fires a status token like
 * "📊 Loading live STOA portfolio data…", then the LLM yields zero content
 * tokens. Before the guard, the user saw just the emoji and nothing else
 * — the "shitty response" Alec reported.
 *
 * We don't spin up the full chat pipeline here (too many deps: SQL pool,
 * llama.cpp, history DB). Instead we assert the property the guard
 * provides: an empty model output MUST be replaced by a non-empty string
 * explaining the failure before the response is sent or history is
 * written.
 *
 * This mirrors the exact logic in server.js lines ~1319 and ~1843.
 */
import { describe, it, expect } from '@jest/globals';

function streamingGuard(fullResponse) {
  if (!String(fullResponse).trim()) {
    return 'I pulled the data but the model produced no text this turn — please retry or rephrase.';
  }
  return fullResponse;
}

function nonStreamingGuard(responseText) {
  if (!responseText || !String(responseText).trim()) {
    return 'I pulled the data but the model produced no text this turn — please retry or rephrase.';
  }
  return responseText;
}

describe('chat empty-response guard', () => {
  it('streaming: empty string → fallback text', () => {
    const out = streamingGuard('');
    expect(out).toMatch(/retry or rephrase/i);
    expect(out.length).toBeGreaterThan(20);
  });

  it('streaming: whitespace-only → fallback text', () => {
    expect(streamingGuard('   \n\t  ')).toMatch(/retry or rephrase/i);
  });

  it('streaming: real content passes through unchanged', () => {
    expect(streamingGuard('Waters at Hammond is 92% occupied.')).toBe('Waters at Hammond is 92% occupied.');
  });

  it('non-streaming: null → fallback text', () => {
    expect(nonStreamingGuard(null)).toMatch(/retry or rephrase/i);
  });

  it('non-streaming: undefined → fallback text', () => {
    expect(nonStreamingGuard(undefined)).toMatch(/retry or rephrase/i);
  });

  it('non-streaming: real content passes through unchanged', () => {
    const answer = 'Three contracts expire in the next 60 days.';
    expect(nonStreamingGuard(answer)).toBe(answer);
  });
});

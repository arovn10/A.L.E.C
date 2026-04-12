/**
 * KnowledgeService — unit tests
 * Validates truth-source routing without any real network calls.
 */

const { KnowledgeService, TRUTH_SOURCES } = require('../services/knowledgeService');

describe('KnowledgeService', () => {
  let ks;

  beforeEach(() => {
    ks = new KnowledgeService();
  });

  test('resolves "who are you" as deterministic', async () => {
    const result = await ks.resolve('who are you');
    expect(result.source).toBe(TRUTH_SOURCES.DETERMINISTIC);
    expect(result.confidence).toBe(1.0);
    expect(result.text).toMatch(/A\.L\.E\.C\./i);
  });

  test('resolves time query as deterministic', async () => {
    const result = await ks.resolve('what time is it');
    expect(result.source).toBe(TRUTH_SOURCES.DETERMINISTIC);
    expect(result.confidence).toBe(1.0);
  });

  test('resolves date query as deterministic', async () => {
    const result = await ks.resolve("what's today's date");
    expect(result.source).toBe(TRUTH_SOURCES.DETERMINISTIC);
  });

  test('refuses password queries', async () => {
    const result = await ks.resolve('what is my password?');
    expect(result.source).toBe(TRUTH_SOURCES.REFUSAL);
    expect(result).toHaveProperty('refusedReason');
  });

  test('refuses account balance queries', async () => {
    const result = await ks.resolve('what is my account balance?');
    expect(result.source).toBe(TRUTH_SOURCES.REFUSAL);
  });

  test('refuses social security queries', async () => {
    const result = await ks.resolve('what is my social security number?');
    expect(result.source).toBe(TRUTH_SOURCES.REFUSAL);
  });

  test('falls back to offline message when no engine is set', async () => {
    const result = await ks.resolve('tell me something interesting');
    expect(result.source).toBe(TRUTH_SOURCES.REFUSAL);
    expect(result.confidence).toBe(0);
  });

  test('delegates to neural engine when provided', async () => {
    const mockEngine = {
      processQuery: jest.fn().mockResolvedValue({
        text: 'Here is an interesting fact.',
        confidence: 0.82,
        source: 'lm-studio',
        suggestions: []
      })
    };
    const ks2 = new KnowledgeService({ neuralEngine: mockEngine });

    const result = await ks2.resolve('tell me something interesting');

    expect(mockEngine.processQuery).toHaveBeenCalledTimes(1);
    expect(result.source).toBe(TRUTH_SOURCES.LLM_INFERENCE);
    expect(result.confidence).toBeLessThanOrEqual(0.85);
  });

  test('getStats returns bySource breakdown', async () => {
    await ks.resolve('who are you');
    await ks.resolve('what is my password');

    const stats = ks.getStats();
    expect(stats.totalQueries).toBe(2);
    expect(stats.bySource[TRUTH_SOURCES.DETERMINISTIC]).toBe(1);
    expect(stats.bySource[TRUTH_SOURCES.REFUSAL]).toBe(1);
  });

  test('TRUTH_SOURCES exports expected constants', () => {
    expect(TRUTH_SOURCES.DETERMINISTIC).toBe('deterministic');
    expect(TRUTH_SOURCES.LLM_INFERENCE).toBe('llm-inference');
    expect(TRUTH_SOURCES.REFUSAL).toBe('refusal');
    expect(TRUTH_SOURCES.HOME_ASSISTANT).toBe('home-assistant');
  });
});

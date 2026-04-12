/**
 * NeuralEngine — unit tests
 * These tests run without LM Studio by verifying the fallback error path
 * and the class structure/methods exist and return the right shape.
 */

// Stub global fetch so we never hit the network in CI
global.fetch = jest.fn();

const { NeuralEngine } = require('../services/neuralEngine');

describe('NeuralEngine', () => {
  let engine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new NeuralEngine();
  });

  test('constructor sets expected defaults', () => {
    expect(engine.modelLoaded).toBe(false);
    expect(engine.personalityTraits).toMatchObject({ sass: 0.7, initiative: 0.8 });
    expect(engine.stats.queriesProcessed).toBe(0);
  });

  test('initialize — marks modelLoaded=true when LM Studio responds', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'qwen3-test' }] })
    });

    await engine.initialize();

    expect(engine.modelLoaded).toBe(true);
    expect(engine.activeModelId).toBe('qwen3-test');
  });

  test('initialize — stays offline when LM Studio is unreachable', async () => {
    fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await engine.initialize();

    expect(engine.modelLoaded).toBe(false);
  });

  test('processQuery — increments stats and returns error text when fetch fails', async () => {
    fetch.mockRejectedValueOnce(new Error('Network Error'));

    const result = await engine.processQuery({ query: 'Hello', context: {} });

    expect(engine.stats.queriesProcessed).toBe(1);
    expect(result).toHaveProperty('text');
    expect(result.text).toMatch(/LM Studio|neural engine|trouble/i);
    expect(result.source).toBe('error');
    expect(result.confidence).toBe(0);
  });

  test('processQuery — returns structured response on success', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Hello, I am A.L.E.C.' } }],
        usage: { total_tokens: 42 }
      })
    });

    const result = await engine.processQuery({ query: 'Who are you?', context: {} });

    expect(result.text).toBe('Hello, I am A.L.E.C.');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.source).toBe('lm-studio');
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('timestamp');
  });

  test('getStats returns expected shape', () => {
    const stats = engine.getStats();
    expect(stats).toHaveProperty('queriesProcessed');
    expect(stats).toHaveProperty('modelsLoaded');
    expect(stats).toHaveProperty('personalityTraits');
  });

  test('getModelStatus returns mode field', () => {
    const status = engine.getModelStatus();
    expect(status).toHaveProperty('mode');
    expect(['lm-studio', 'offline']).toContain(status.mode);
  });

  test('retrain increments trainingIterations', async () => {
    await engine.retrain();
    expect(engine.stats.trainingIterations).toBe(1);
  });
});

'use strict';

// Mock axios before requiring ragService
jest.mock('axios');
const axios = require('axios');

// Mock WeaviateService
jest.mock('../services/weaviateService', () => {
  return jest.fn().mockImplementation(() => ({
    hybridSearch: jest.fn().mockResolvedValue([
      { userMsg: 'What is the occupancy?', alecResponse: '95% occupied.', distance: 0.1, id: 'uuid-1' },
      { content: 'Stoa property data...', distance: 0.2, id: 'uuid-2' },
    ]),
  }));
});

const RagService = require('../services/ragService');

let svc;
beforeEach(() => {
  jest.clearAllMocks();
  svc = new RagService();
});

test('embed() calls /embed endpoint and returns vector', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1, 0.2, 0.3], dim: 3 } });
  const vec = await svc.embed('hello world');
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/embed'),
    { text: 'hello world' },
    expect.objectContaining({ timeout: 10000 }),
  );
  expect(vec).toEqual([0.1, 0.2, 0.3]);
});

test('retrieve() returns formatted context string', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1], dim: 1 } });
  const ctx = await svc.retrieve('occupancy question');
  expect(typeof ctx).toBe('string');
  expect(ctx).toContain('## Relevant Context');
  expect(ctx).toContain('ALECConversation');
});

test('retrieve() falls back to keyword-only when embed fails', async () => {
  axios.post.mockRejectedValue(new Error('neural server down'));
  // Should not throw — just uses empty vector
  const ctx = await svc.retrieve('any query');
  expect(typeof ctx).toBe('string');
});

test('_formatContext() handles empty hits with empty string', () => {
  const result = svc._formatContext([]);
  expect(result).toBe('');
});

test('_formatContext() uses userMsg/alecResponse for ALECConversation hits', () => {
  const hits = [{ _collection: 'ALECConversation', userMsg: 'hello', alecResponse: 'hi there', distance: 0.05, id: 'x' }];
  const ctx = svc._formatContext(hits);
  expect(ctx).toContain('User: hello');
  expect(ctx).toContain('ALEC: hi there');
});

test('_formatContext() uses content for ALECDocument hits', () => {
  const hits = [{ _collection: 'ALECDocument', content: 'Stoa property info', distance: 0.1, id: 'y' }];
  const ctx = svc._formatContext(hits);
  expect(ctx).toContain('Stoa property info');
});

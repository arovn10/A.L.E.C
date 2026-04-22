// tests/weaviateService.test.js
'use strict';

jest.mock('weaviate-ts-client', () => ({
  default: () => ({
    schema: {
      classCreator: () => ({ withClass: () => ({ do: jest.fn().mockResolvedValue({}) }) }),
      exists: jest.fn().mockResolvedValue(false),
    },
    data: {
      creator: () => ({
        withClassName: function(n) { this._n = n; return this; },
        withProperties: function(p) { this._p = p; return this; },
        withVector: function(v) { this._v = v; return this; },
        do: jest.fn().mockResolvedValue({ id: 'test-uuid-1234' }),
      }),
    },
    graphql: {
      get: () => ({
        withClassName: function() { return this; },
        withNearVector: function() { return this; },
        withHybrid: function() { return this; },
        withLimit: function() { return this; },
        withFields: function() { return this; },
        do: jest.fn().mockResolvedValue({
          data: { Get: { ALECConversation: [{ turnId: 'abc', userMsg: 'hello', _additional: { distance: 0.1, id: 'uuid-1' } }] } }
        }),
      }),
    },
    misc: {
      liveChecker: () => ({ do: jest.fn().mockResolvedValue(true) }),
    },
  }),
}));

const WeaviateService = require('../services/weaviateService');
let svc;
beforeEach(() => { svc = new WeaviateService(); });

test('health() returns true when weaviate is reachable', async () => {
  expect(await svc.health()).toBe(true);
});

test('upsert() returns a string ID', async () => {
  const id = await svc.upsert('ALECConversation', { turnId: 'abc' }, [0.1, 0.2]);
  expect(typeof id).toBe('string');
  expect(id.length).toBeGreaterThan(0);
});

test('search() returns array with distance field', async () => {
  const results = await svc.search('ALECConversation', [0.1, 0.2], { limit: 5 });
  expect(Array.isArray(results)).toBe(true);
  expect(results[0]).toHaveProperty('distance');
  expect(results[0]).toHaveProperty('id');
});

test('hybridSearch() returns array with distance, score, and id fields', async () => {
  const results = await svc.hybridSearch('ALECConversation', 'hello', [0.1, 0.2], { limit: 5 });
  expect(Array.isArray(results)).toBe(true);
  expect(results[0]).toHaveProperty('distance');
  expect(results[0]).toHaveProperty('id');
});

test('init() calls schema.exists and does not throw', async () => {
  await expect(svc.init()).resolves.not.toThrow();
});

// tests/dataConnectors.test.js
'use strict';
const { ConnectorRegistry } = require('../dataConnectors/index');

test('register() adds connector by name', () => {
  const reg = new ConnectorRegistry();
  reg.register({ name: 'test', fetch: async () => ({ ok: true }), schema: {}, tags: [] });
  expect(reg.get('test')).toBeDefined();
});

test('get() returns undefined for unknown connector', () => {
  const reg = new ConnectorRegistry();
  expect(reg.get('nonexistent')).toBeUndefined();
});

test('fetch() calls connector.fetch with params', async () => {
  const reg = new ConnectorRegistry();
  const mockFetch = jest.fn().mockResolvedValue({ rows: [{ id: 1 }] });
  reg.register({ name: 'mockDb', fetch: mockFetch, schema: {}, tags: ['test'] });
  const result = await reg.fetch('mockDb', { query: 'SELECT 1' });
  expect(mockFetch).toHaveBeenCalledWith({ query: 'SELECT 1' });
  expect(result.rows[0].id).toBe(1);
});

test('fetch() throws for unknown connector', async () => {
  const reg = new ConnectorRegistry();
  await expect(reg.fetch('ghost', {})).rejects.toThrow('Unknown connector: ghost');
});

test('list() returns all registered connector names', () => {
  const reg = new ConnectorRegistry();
  reg.register({ name: 'a', fetch: async () => {}, schema: {}, tags: [] });
  reg.register({ name: 'b', fetch: async () => {}, schema: {}, tags: [] });
  expect(reg.list()).toEqual(expect.arrayContaining(['a', 'b']));
});

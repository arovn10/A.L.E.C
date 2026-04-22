'use strict';

jest.mock('axios');
const axios = require('axios');

jest.mock('../dataConnectors', () => ({
  registry: {
    fetch: jest.fn(),
  },
}));
const { registry } = require('../dataConnectors');

jest.mock('../services/weaviateService', () => {
  return jest.fn().mockImplementation(() => ({
    upsert: jest.fn().mockResolvedValue('uuid-abc'),
  }));
});

jest.mock('node-cron', () => ({
  schedule: jest.fn().mockReturnValue({ destroy: jest.fn() }),
}));
const cron = require('node-cron');

const StoaBrainSync = require('../services/stoaBrainSync');

let sync;
beforeEach(() => {
  jest.clearAllMocks();
  sync = new StoaBrainSync();
  process.env.GITHUB_WEBHOOK_SECRET = 'test-secret';
});

test('verifyWebhookSignature() returns true for valid HMAC', () => {
  const crypto = require('crypto');
  const body = Buffer.from('{"ref":"refs/heads/main"}');
  const sig = 'sha256=' + crypto.createHmac('sha256', 'test-secret').update(body).digest('hex');
  expect(sync.verifyWebhookSignature(body, sig)).toBe(true);
});

test('verifyWebhookSignature() returns false for wrong secret', () => {
  const body = Buffer.from('payload');
  expect(sync.verifyWebhookSignature(body, 'sha256=badhash')).toBe(false);
});

test('handlePushEvent() indexes added and modified files', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1, 0.2], dim: 2 } });
  registry.fetch.mockResolvedValue({ data: 'file content here' });

  const payload = {
    commits: [
      { added: ['README.md'], modified: ['data/loans.json'] },
    ],
  };
  const result = await sync.handlePushEvent(payload);
  expect(result.indexed).toBe(2);
  expect(result.skipped).toBe(0);
  expect(result.errors).toHaveLength(0);
});

test('handlePushEvent() records errors per file without throwing', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1], dim: 1 } });
  registry.fetch.mockRejectedValue(new Error('GitHub API error'));

  const payload = { commits: [{ added: ['bad.json'], modified: [] }] };
  const result = await sync.handlePushEvent(payload);
  expect(result.indexed).toBe(0);
  expect(result.skipped).toBe(1);
  expect(result.errors[0]).toMatchObject({ filePath: 'bad.json', error: 'GitHub API error' });
});

test('_chunk() splits text into overlapping windows', () => {
  const text = 'a'.repeat(2500);
  const chunks = sync._chunk(text);
  // CHUNK_SIZE=1000, OVERLAP=100 → chunk 1: 0..999, chunk 2: 900..1899, chunk 3: 1800..2499
  expect(chunks.length).toBe(3);
  expect(chunks[0].length).toBe(1000);
  expect(chunks[1].length).toBe(1000);
});

test('startCron() schedules a 30-minute cron and stopCron() destroys it', () => {
  sync.startCron();
  expect(cron.schedule).toHaveBeenCalledWith('*/30 * * * *', expect.any(Function));
  sync.stopCron();
  expect(cron.schedule.mock.results[0].value.destroy).toHaveBeenCalled();
});

test('fullSync() iterates all files from github connector', async () => {
  axios.post.mockResolvedValue({ data: { vector: [0.1], dim: 1 } });
  registry.fetch
    .mockResolvedValueOnce({ data: [{ path: 'file1.md' }, { path: 'file2.md' }] }) // listFiles
    .mockResolvedValue({ data: 'file text' }); // getFile x2

  const result = await sync.fullSync();
  expect(result.indexed).toBe(2);
  expect(result.skipped).toBe(0);
});

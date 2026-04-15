// tests/pdfIngestionService.test.js
'use strict';

jest.mock('pdf-parse', () => jest.fn());
jest.mock('axios');
jest.mock('../services/weaviateService', () => ({
  upsert: jest.fn().mockResolvedValue({ id: 'mock-id' }),
  hybridSearch: jest.fn().mockResolvedValue([
    { content: 'chunk one' },
    { content: 'chunk two' },
  ]),
}));

const pdfParse = require('pdf-parse');
const axios = require('axios');
const weaviateService = require('../services/weaviateService');
const pdfIngestionService = require('../services/pdfIngestionService');

beforeEach(() => {
  jest.clearAllMocks();
  axios.post = jest.fn().mockResolvedValue({ data: { vector: [0.1, 0.2, 0.3] } });
});

test('ingest returns correct shape', async () => {
  pdfParse.mockResolvedValue({ text: 'Hello world this is a test PDF document.', numpages: 2 });
  const result = await pdfIngestionService.ingest(Buffer.from('fake'), 'test.pdf');
  expect(result).toMatchObject({
    docUuid: 'pdf::test.pdf',
    chunkCount: expect.any(Number),
    pageCount: 2,
  });
});

test('chunkCount matches number of upsert calls', async () => {
  const longText = 'A'.repeat(2500);
  pdfParse.mockResolvedValue({ text: longText, numpages: 1 });
  const result = await pdfIngestionService.ingest(Buffer.from('fake'), 'big.pdf');
  expect(weaviateService.upsert).toHaveBeenCalledTimes(result.chunkCount);
});

test('upsert called with correct props per chunk', async () => {
  pdfParse.mockResolvedValue({ text: 'Short text for one chunk.', numpages: 1 });
  await pdfIngestionService.ingest(Buffer.from('fake'), 'short.pdf');
  const firstCall = weaviateService.upsert.mock.calls[0];
  expect(firstCall[0]).toBe('ALECDocument');
  expect(firstCall[1]).toMatchObject({
    docUuid: expect.stringContaining('pdf::short.pdf::'),
    chunkIndex: 0,
    content: expect.any(String),
    sourceType: 'pdf',
    sourceUrl: 'short.pdf',
    tags: ['pdf', 'upload'],
    indexedAt: expect.any(String),
  });
});

test('ingest throws when pdf-parse fails', async () => {
  pdfParse.mockRejectedValue(new Error('corrupt PDF'));
  await expect(pdfIngestionService.ingest(Buffer.from('bad'), 'bad.pdf')).rejects.toThrow('corrupt PDF');
});

test('getSummary returns a string', async () => {
  const summary = await pdfIngestionService.getSummary('pdf::test.pdf');
  expect(typeof summary).toBe('string');
  expect(summary.length).toBeGreaterThan(0);
});

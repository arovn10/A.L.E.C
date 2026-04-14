'use strict';

jest.mock('axios');
const axios = require('axios');

jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return {
    ...real,
    mkdirSync:     jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync:  jest.fn().mockReturnValue('# ALEC Constitutional Directive\n\nYou are A.L.E.C.'),
    existsSync:    jest.fn().mockReturnValue(true),
  };
});

jest.mock('better-sqlite3', () => {
  const approvedRows = [
    { id: 1, turn_id: 't-1', session_id: 's-1', user_msg: 'occupancy?', alec_response: 'From Azure SQL: 94%.', quality_score: 0.88 },
    { id: 2, turn_id: 't-2', session_id: 's-2', user_msg: 'rent?',      alec_response: 'From Azure SQL: $1,800/mo.', quality_score: 0.82 },
  ];
  const mockAll  = jest.fn().mockReturnValue(approvedRows);
  const mockGet  = jest.fn().mockReturnValue({ count: 2 });
  const mockRun  = jest.fn().mockReturnValue({ lastInsertRowid: 42, changes: 1 });
  const mockStmt = { all: mockAll, get: mockGet, run: mockRun };
  const mockDb   = { prepare: jest.fn().mockReturnValue(mockStmt), close: jest.fn() };
  return jest.fn().mockImplementation(() => mockDb);
});

const FineTuneQueue = require('../services/fineTuneQueue');

let queue;
beforeEach(() => {
  jest.clearAllMocks();
  // Use threshold=2 so tests trigger training without seeding 500 rows
  queue = new FineTuneQueue({ threshold: 2 });
});

test('getApprovedCount() returns count of approved rows', async () => {
  const count = await queue.getApprovedCount();
  expect(typeof count).toBe('number');
  expect(count).toBeGreaterThanOrEqual(0);
});

test('buildBatch() formats rows as valid JSONL with system/user/assistant roles', async () => {
  const fs = require('fs');
  const result = await queue.buildBatch();
  expect(result.exampleCount).toBe(2);
  // writeFileSync must have been called once with the JSONL content
  expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  const writtenContent = fs.writeFileSync.mock.calls[0][1];
  const lines = writtenContent.trim().split('\n');
  expect(lines).toHaveLength(2);
  const parsed = JSON.parse(lines[0]);
  expect(parsed.messages[0].role).toBe('system');
  expect(parsed.messages[1].role).toBe('user');
  expect(parsed.messages[2].role).toBe('assistant');
});

test('buildBatch() skips rows with quality_score < 0.40 (H6)', async () => {
  const Database = require('better-sqlite3');
  const lowQualityRows = [
    { id: 3, turn_id: 't-3', user_msg: 'q', alec_response: 'a', quality_score: 0.30 },
    { id: 4, turn_id: 't-4', user_msg: 'q', alec_response: 'a', quality_score: 0.85 },
  ];
  const db = new Database();
  db.prepare().all.mockReturnValueOnce(lowQualityRows);
  const result = await queue.buildBatch();
  // Only 1 row should survive the H6 filter
  expect(result.exampleCount).toBe(1);
});

test('triggerTraining() POSTs to /training/start with job_id and batch_file', async () => {
  axios.post.mockResolvedValue({ data: { status: 'queued', run_id: 'run_abc' } });
  const result = await queue.triggerTraining({ batchFile: 'data/sft/batch_2026-04-14.jsonl', exampleCount: 2 });
  expect(axios.post).toHaveBeenCalledWith(
    expect.stringContaining('/training/start'),
    expect.objectContaining({ batch_file: 'data/sft/batch_2026-04-14.jsonl' }),
    expect.any(Object),
  );
  expect(result.jobId).toBeDefined();
});

test('triggerTraining() inserts fine_tune_jobs row with status=queued', async () => {
  const Database = require('better-sqlite3');
  axios.post.mockResolvedValue({ data: { status: 'queued', run_id: 'run_abc' } });
  await queue.triggerTraining({ batchFile: 'data/sft/batch.jsonl', exampleCount: 5 });
  const db = new Database();
  const insertCalls = db.prepare.mock.calls.map(c => c[0]).filter(s => s && s.includes('fine_tune_jobs'));
  expect(insertCalls.length).toBeGreaterThan(0);
});

test('maybeRun() does not trigger training when approved count is below threshold', async () => {
  // Use threshold=999 so we never trigger
  const conservativeQueue = new FineTuneQueue({ threshold: 999 });
  const result = await conservativeQueue.maybeRun();
  expect(result.triggered).toBe(false);
  expect(axios.post).not.toHaveBeenCalled();
});

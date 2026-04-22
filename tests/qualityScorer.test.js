'use strict';

// Mock better-sqlite3 so tests don't need a real DB file
jest.mock('better-sqlite3', () => {
  const mockRun  = jest.fn().mockReturnValue({ changes: 1 });
  const mockStmt = { run: mockRun };
  const mockDb   = { prepare: jest.fn().mockReturnValue(mockStmt), close: jest.fn() };
  return jest.fn().mockImplementation(() => mockDb);
});

const Database = require('better-sqlite3');
const QualityScorer = require('../services/qualityScorer');

let scorer;
let mockDb;

beforeEach(() => {
  jest.clearAllMocks();
  scorer = new QualityScorer();
  mockDb = new Database();
});

// ─── dimension tests ────────────────────────────────────────────────────────

test('scoreResponse() gives citation 1.0 when response contains "From Azure SQL:"', () => {
  const result = scorer.scoreResponse({
    turnId: 'turn-1',
    userMsg: 'What is occupancy?',
    alecResponse: 'From Azure SQL: occupancy is 94.2% at property 1024.',
  });
  expect(result.source_citation).toBe(1.0);
});

test('scoreResponse() gives citation 0.0 when no source prefix present', () => {
  const result = scorer.scoreResponse({
    turnId: 'turn-2',
    userMsg: 'What is occupancy?',
    alecResponse: 'Occupancy is about 94 percent.',
  });
  expect(result.source_citation).toBe(0.0);
});

test('hallucination_flag is 1 when bare dollar amount with no source prefix', () => {
  const result = scorer.scoreResponse({
    turnId: 'turn-3',
    userMsg: 'rent?',
    alecResponse: 'Average rent is $1,850/month.',
  });
  expect(result.hallucination_flag).toBe(1);
});

test('hallucination_flag is 0 when dollar amount follows source prefix', () => {
  const result = scorer.scoreResponse({
    turnId: 'turn-4',
    userMsg: 'rent?',
    alecResponse: 'From TenantCloud: Average rent is $1,850/month.',
  });
  expect(result.hallucination_flag).toBe(0);
});

// ─── routing / band tests ────────────────────────────────────────────────────

test('score() inserts into review_queue with status=approved when score >= 0.75', () => {
  // Force a high-scoring response: sourced, short, completes task
  const data = {
    turnId: 'turn-5',
    sessionId: 'sess-A',
    userMsg: 'occupancy?',
    alecResponse: 'From Azure SQL: 94.2% occupied at The Flats.',
  };
  const result = scorer.score(data);
  expect(result.quality_score).toBeGreaterThanOrEqual(0.75);
  expect(result.band).toBe('promote');
  // DB should have been called
  expect(mockDb.prepare).toHaveBeenCalled();
});

test('score() does not insert into review_queue when score < 0.40', () => {
  // Force a bad response: no source, starts with "I can't", very short
  const data = {
    turnId: 'turn-6',
    sessionId: 'sess-B',
    userMsg: 'occupancy?',
    alecResponse: "I can't",
  };
  scorer.score(data);
  // Should only call prepare for quality_scores, not review_queue
  const calls = mockDb.prepare.mock.calls.map(c => c[0]);
  const reviewQueueInserts = calls.filter(sql => sql.includes('review_queue'));
  expect(reviewQueueInserts).toHaveLength(0);
});

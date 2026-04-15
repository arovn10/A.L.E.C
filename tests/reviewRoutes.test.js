'use strict';

const express     = require('express');
const request     = require('supertest');

// Mock better-sqlite3 before requiring the router
jest.mock('better-sqlite3', () => {
  const pendingRows = [
    { id: 1, turn_id: 't-1', session_id: 's-1', user_msg: 'hi', alec_response: 'hello', quality_score: 0.6, status: 'pending', reviewed_by: null, reviewed_at: null, created_at: '2026-04-14T00:00:00Z' },
  ];
  const mockAll  = jest.fn().mockReturnValue(pendingRows);
  const mockRun  = jest.fn().mockReturnValue({ changes: 1 });
  const mockGet  = jest.fn().mockReturnValue({ id: 99, status: 'queued', batch_file: 'batch.jsonl', example_count: 10, eval_score: null, created_at: '2026-04-14T00:00:00Z' });
  const mockStmt = { all: mockAll, run: mockRun, get: mockGet };
  const mockDb   = { prepare: jest.fn().mockReturnValue(mockStmt), close: jest.fn() };
  return jest.fn().mockImplementation(() => mockDb);
});

const reviewRouter = require('../routes/reviewRoutes');

// Build minimal express app with a fake authenticateToken that always passes
const makeApp = () => {
  const app = express();
  app.use(express.json());
  // Inject a fake authenticated user so routes don't 401
  app.use((req, _res, next) => { req.user = { userId: 'alec-owner', email: 'alec@rovner.com' }; next(); });
  app.use('/api/review', reviewRouter);
  return app;
};

let app;
beforeEach(() => { jest.clearAllMocks(); app = makeApp(); });

test('GET /api/review/queue returns array of pending rows', async () => {
  const res = await request(app).get('/api/review/queue');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.items)).toBe(true);
  expect(res.body.items[0].status).toBe('pending');
});

test('POST /api/review/:id/approve sets status to approved', async () => {
  const res = await request(app)
    .post('/api/review/1/approve')
    .send({});
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('POST /api/review/:id/reject sets status to rejected', async () => {
  const res = await request(app)
    .post('/api/review/1/reject')
    .send({});
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('GET /api/review/finetune/status returns latest job row or empty', async () => {
  const res = await request(app).get('/api/review/finetune/status');
  expect(res.status).toBe(200);
  // either a job object or { job: null }
  expect(res.body).toHaveProperty('job');
});

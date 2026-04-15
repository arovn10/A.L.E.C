// tests/reportRoutes.test.js
'use strict';

const request = require('supertest');
const express = require('express');

// Mock all report modules
jest.mock('../services/reports/loansReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/loans_20260414.xlsx',
    fileName: 'loans_20260414.xlsx',
    generatedAt: '2026-04-14T00:00:00.000Z',
  }),
}));
jest.mock('../services/reports/maturityReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/maturity_20260414.xlsx',
    fileName: 'maturity_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/lenderReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/lenders_20260414.xlsx',
    fileName: 'lenders_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/dscrReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/dscr_20260414.xlsx',
    fileName: 'dscr_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/ltvReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/ltv_20260414.xlsx',
    fileName: 'ltv_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/equityReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/equity_20260414.xlsx',
    fileName: 'equity_20260414.xlsx',
  }),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  // Bypass auth for tests
  app.use((req, res, next) => next());
  const reportRoutes = require('../routes/reportRoutes');
  app.use('/api', reportRoutes);
  return app;
}

test('GET /api/reports/loans returns success=true with url', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/loans');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.url).toContain('loans_');
  expect(res.body.fileName).toMatch(/\.xlsx$/);
});

test('GET /api/reports/maturity returns success=true', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/maturity');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.url).toContain('/api/download/');
});

test('GET /api/reports/dscr returns success=true', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/dscr');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});

test('GET /api/reports/equity returns success=true', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/equity');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});

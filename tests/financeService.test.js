// tests/financeService.test.js
'use strict';

jest.mock('../dataConnectors', () => ({
  registry: {
    fetch: jest.fn(),
  },
}));

const { registry } = require('../dataConnectors');
const financeService = require('../services/financeService');

beforeEach(() => jest.clearAllMocks());

test('getOutstandingLoans returns data and source on success', async () => {
  registry.fetch.mockResolvedValue({ data: [{ ProjectName: 'Tower A', LenderName: 'JPMorgan' }] });
  const result = await financeService.getOutstandingLoans();
  expect(result.data).toHaveLength(1);
  expect(result.source).toBe('Azure SQL');
});

test('getOutstandingLoans returns null data on SQL error', async () => {
  registry.fetch.mockResolvedValue({ data: null, error: 'connection refused' });
  const result = await financeService.getOutstandingLoans();
  expect(result.data).toBeNull();
  expect(result.error).toBe('connection refused');
});

test('getMaturityWall groups by year/quarter', async () => {
  registry.fetch.mockResolvedValue({
    data: [{ Year: 2026, Quarter: 1, LoanCount: 3, TotalBalance: 5000000 }],
  });
  const result = await financeService.getMaturityWall(24);
  expect(result.data[0].Year).toBe(2026);
  expect(result.source).toBe('Azure SQL');
});

test('getLenderExposure handles null data gracefully', async () => {
  registry.fetch.mockResolvedValue({ data: null, error: 'timeout' });
  const result = await financeService.getLenderExposure();
  expect(result.data).toBeNull();
  expect(result.error).toBe('timeout');
});

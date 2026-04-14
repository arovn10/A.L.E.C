// tests/reportsBundle.test.js
'use strict';

const path = require('path');
const fs = require('fs');

// pptxgenjs uses dynamic import() internally which is incompatible with Jest's
// VM sandbox. Mock the entire module so pptxService.generate() can be tested
// without triggering the real library's ESM internals.
jest.mock('pptxgenjs', () => {
  const mockSlide = { addText: jest.fn() };
  return jest.fn().mockImplementation(() => ({
    layout: '',
    addSlide: jest.fn().mockReturnValue(mockSlide),
    writeFile: jest.fn().mockResolvedValue(undefined),
  }));
});

jest.mock('../services/financeService', () => ({
  getOutstandingLoans: jest.fn().mockResolvedValue({
    data: [
      { ProjectName: 'A', LenderName: 'JPM', LTV: 65, DSCR: 1.4, CurrentBalance: 5000000 },
    ],
    source: 'Azure SQL',
  }),
  getMaturityWall: jest.fn().mockResolvedValue({
    data: [{ Year: 2027, Quarter: 1, LoanCount: 1, TotalBalance: 5000000 }],
    source: 'Azure SQL',
  }),
  getLenderExposure: jest.fn().mockResolvedValue({
    data: [{ LenderName: 'JPM', LoanCount: 1, TotalExposure: 5000000 }],
    source: 'Azure SQL',
  }),
  getDSCRSummary: jest.fn().mockResolvedValue({
    data: [{ ProjectName: 'A', LenderName: 'JPM', DSCR: 1.1, CurrentBalance: 5000000 }],
    source: 'Azure SQL',
  }),
  getLTVSummary: jest.fn().mockResolvedValue({
    data: [{ ProjectName: 'A', LenderName: 'JPM', LTV: 80, CurrentBalance: 5000000 }],
    source: 'Azure SQL',
  }),
  getEquityCommitments: jest.fn().mockResolvedValue({
    data: [
      {
        ProjectName: 'A',
        CommittedAmount: 10000000,
        CalledAmount: 7000000,
        RemainingAmount: 3000000,
        EquitySource: 'LPs',
      },
    ],
    source: 'Azure SQL',
  }),
}));

afterAll(() => {
  const exportsDir = path.join(process.cwd(), 'data', 'exports');
  if (fs.existsSync(exportsDir)) {
    fs.readdirSync(exportsDir)
      .filter((f) => /\.(xlsx|pptx|docx)$/.test(f))
      .forEach((f) => {
        try { fs.unlinkSync(path.join(exportsDir, f)); } catch (_) {}
      });
  }
});

test('maturityReport.generate returns filePath', async () => {
  const { generate } = require('../services/reports/maturityReport');
  const result = await generate();
  expect(result.filePath).toBeDefined();
});

test('lenderReport.generate returns filePath', async () => {
  const { generate } = require('../services/reports/lenderReport');
  const result = await generate();
  expect(result.filePath).toBeDefined();
});

test('dscrReport.generate returns filePath', async () => {
  const { generate } = require('../services/reports/dscrReport');
  const result = await generate();
  expect(result.filePath).toBeDefined();
});

test('ltvReport.generate returns filePath', async () => {
  const { generate } = require('../services/reports/ltvReport');
  const result = await generate();
  expect(result.filePath).toBeDefined();
});

test('equityReport.generate returns filePath', async () => {
  const { generate } = require('../services/reports/equityReport');
  const result = await generate();
  expect(result.filePath).toBeDefined();
});

test('pptxService.generate returns filePath', async () => {
  const pptxService = require('../services/pptxService');
  const result = await pptxService.generate({
    title: 'Q1 2026 Portfolio Review',
    properties: [
      { name: 'Tower A', balance: 9500000, ltv: 65, dscr: 1.45 },
    ],
  });
  expect(result.filePath).toBeDefined();
  expect(result.fileName).toMatch(/\.pptx$/);
});

test('wordService.generate returns filePath', async () => {
  const wordService = require('../services/wordService');
  const result = await wordService.generate({
    property: 'Tower A',
    t12Data: [
      { month: 'Jan 2026', grossIncome: 120000, expenses: 45000, noi: 75000 },
    ],
  });
  expect(result.filePath).toBeDefined();
  expect(result.fileName).toMatch(/\.docx$/);
});

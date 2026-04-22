// tests/loansReport.test.js
'use strict';

const path = require('path');
const fs = require('fs');

jest.mock('../services/financeService', () => ({
  getOutstandingLoans: jest.fn(),
  getMaturityWall: jest.fn(),
  getLenderExposure: jest.fn(),
}));

const financeService = require('../services/financeService');

const MOCK_LOANS = [
  {
    ProjectName: 'Tower A',
    LenderName: 'JPMorgan',
    LoanType: 'Term',
    OriginalAmount: 10000000,
    CurrentBalance: 9500000,
    InterestRate: 5.5,
    MaturityDate: '2026-06-30',
    DaysToMaturity: 440,
    LTV: 65,
    DSCR: 1.45,
    CovenantStatus: 'Compliant',
    GuarantorName: 'John Doe',
    UpdatedAt: '2026-01-01',
  },
  {
    ProjectName: 'Park Place',
    LenderName: 'Wells Fargo',
    LoanType: 'Construction',
    OriginalAmount: 20000000,
    CurrentBalance: 18000000,
    InterestRate: 6.0,
    MaturityDate: '2027-12-31',
    DaysToMaturity: 990,
    LTV: 72,
    DSCR: 1.15,
    CovenantStatus: 'Watch',
    GuarantorName: 'Jane Smith',
    UpdatedAt: '2026-01-01',
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  financeService.getOutstandingLoans.mockResolvedValue({ data: MOCK_LOANS, source: 'Azure SQL' });
  financeService.getMaturityWall.mockResolvedValue({
    data: [{ Year: 2026, Quarter: 2, LoanCount: 1, TotalBalance: 9500000 }],
    source: 'Azure SQL',
  });
  financeService.getLenderExposure.mockResolvedValue({
    data: [
      { LenderName: 'JPMorgan', LoanCount: 1, TotalExposure: 9500000 },
      { LenderName: 'Wells Fargo', LoanCount: 1, TotalExposure: 18000000 },
    ],
    source: 'Azure SQL',
  });
});

afterAll(() => {
  // Clean up any generated files
  const exportsDir = path.join(process.cwd(), 'data', 'exports');
  if (fs.existsSync(exportsDir)) {
    fs.readdirSync(exportsDir)
      .filter((f) => f.startsWith('loans_'))
      .forEach((f) => {
        try { fs.unlinkSync(path.join(exportsDir, f)); } catch (_) {}
      });
  }
});

test('generate returns filePath, fileName, generatedAt', async () => {
  const loansReport = require('../services/reports/loansReport');
  const result = await loansReport.generate();
  expect(result).toMatchObject({
    filePath: expect.stringContaining('loans_'),
    fileName: expect.stringMatching(/^loans_.*\.xlsx$/),
    generatedAt: expect.any(String),
  });
});

test('workbook has 4 sheets', async () => {
  const ExcelJS = require('exceljs');
  const loansReport = require('../services/reports/loansReport');
  const { filePath } = await loansReport.generate();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  expect(wb.worksheets.length).toBe(4);
});

test('By Property sheet has correct column headers', async () => {
  const ExcelJS = require('exceljs');
  const loansReport = require('../services/reports/loansReport');
  const { filePath } = await loansReport.generate();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const byProperty = wb.getWorksheet('By Property');
  expect(byProperty).toBeDefined();
  const headerRow = byProperty.getRow(1).values.slice(1); // remove index 0
  expect(headerRow).toContain('Property');
  expect(headerRow).toContain('Lender');
  expect(headerRow).toContain('Current Balance');
});

test('noData case returns without throwing and sets noData flag', async () => {
  financeService.getOutstandingLoans.mockResolvedValue({ data: null });
  financeService.getMaturityWall.mockResolvedValue({ data: null });
  financeService.getLenderExposure.mockResolvedValue({ data: null });
  jest.resetModules();
  jest.mock('../services/financeService', () => ({
    getOutstandingLoans: jest.fn().mockResolvedValue({ data: null }),
    getMaturityWall: jest.fn().mockResolvedValue({ data: null }),
    getLenderExposure: jest.fn().mockResolvedValue({ data: null }),
  }));
  const loansReport = require('../services/reports/loansReport');
  const result = await loansReport.generate();
  expect(result.noData).toBe(true);
  expect(result.filePath).toBeDefined();
});

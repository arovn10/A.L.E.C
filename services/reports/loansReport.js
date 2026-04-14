// services/reports/loansReport.js
'use strict';

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const financeService = require('../financeService');

const EXPORTS_DIR = path.join(process.cwd(), 'data', 'exports');

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

function ensureExportsDir() {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

/**
 * Build the Summary tab.
 * @param {ExcelJS.Worksheet} ws
 * @param {object[]} loans
 */
function buildSummarySheet(ws, loans) {
  ws.columns = [
    { header: 'Metric', key: 'metric', width: 30 },
    { header: 'Value', key: 'value', width: 25 },
  ];

  const totalCount = loans.length;
  const totalBalance = loans.reduce((s, l) => s + (l.CurrentBalance || 0), 0);
  const totalBalanceForLTV = loans.reduce(
    (s, l) => s + (l.CurrentBalance || 0) * (l.LTV || 0),
    0
  );
  const weightedLTV = totalBalance > 0 ? totalBalanceForLTV / totalBalance : 0;
  const totalBalanceForDSCR = loans.reduce(
    (s, l) => s + (l.CurrentBalance || 0) * (l.DSCR || 0),
    0
  );
  const weightedDSCR = totalBalance > 0 ? totalBalanceForDSCR / totalBalance : 0;

  // Lender exposure (top 3)
  const lenderMap = {};
  for (const loan of loans) {
    lenderMap[loan.LenderName] = (lenderMap[loan.LenderName] || 0) + (loan.CurrentBalance || 0);
  }
  const top3Lenders = Object.entries(lenderMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  ws.addRow({ metric: 'Total Loan Count', value: totalCount });
  ws.addRow({ metric: 'Total Outstanding Balance', value: totalBalance });
  ws.addRow({ metric: 'Weighted Avg LTV', value: `${weightedLTV.toFixed(2)}%` });
  ws.addRow({ metric: 'Weighted Avg DSCR', value: weightedDSCR.toFixed(2) });
  ws.addRow({ metric: '', value: '' });
  ws.addRow({ metric: 'Top Lenders by Exposure', value: '' });
  for (const [lender, balance] of top3Lenders) {
    ws.addRow({ metric: lender, value: balance });
  }
}

/**
 * Build the By Property tab.
 * @param {ExcelJS.Worksheet} ws
 * @param {object[]} loans
 */
function buildByPropertySheet(ws, loans) {
  ws.columns = [
    { header: 'Property', key: 'ProjectName', width: 25 },
    { header: 'Lender', key: 'LenderName', width: 20 },
    { header: 'Loan Type', key: 'LoanType', width: 15 },
    { header: 'Original Amount', key: 'OriginalAmount', width: 18 },
    { header: 'Current Balance', key: 'CurrentBalance', width: 18 },
    { header: 'Interest Rate', key: 'InterestRate', width: 15 },
    { header: 'Maturity Date', key: 'MaturityDate', width: 15 },
    { header: 'Days to Maturity', key: 'DaysToMaturity', width: 18 },
    { header: 'LTV%', key: 'LTV', width: 10 },
    { header: 'DSCR', key: 'DSCR', width: 10 },
    { header: 'Covenant Status', key: 'CovenantStatus', width: 18 },
    { header: 'Guarantor', key: 'GuarantorName', width: 20 },
    { header: 'Last Updated', key: 'UpdatedAt', width: 15 },
  ];

  for (const loan of loans) {
    ws.addRow({
      ProjectName: loan.ProjectName,
      LenderName: loan.LenderName,
      LoanType: loan.LoanType,
      OriginalAmount: loan.OriginalAmount,
      CurrentBalance: loan.CurrentBalance,
      InterestRate: loan.InterestRate,
      MaturityDate: loan.MaturityDate,
      DaysToMaturity: loan.DaysToMaturity,
      LTV: loan.LTV,
      DSCR: loan.DSCR,
      CovenantStatus: loan.CovenantStatus,
      GuarantorName: loan.GuarantorName,
      UpdatedAt: loan.UpdatedAt,
    });
  }
}

/**
 * Build the Maturity Wall tab (bar chart by quarter).
 * @param {ExcelJS.Worksheet} ws
 * @param {object[]|null} maturityData
 */
function buildMaturityWallSheet(ws, maturityData) {
  ws.columns = [
    { header: 'Year', key: 'Year', width: 10 },
    { header: 'Quarter', key: 'Quarter', width: 10 },
    { header: 'Loan Count', key: 'LoanCount', width: 14 },
    { header: 'Total Balance', key: 'TotalBalance', width: 18 },
  ];

  if (!maturityData || maturityData.length === 0) {
    ws.addRow({ Year: 'No data', Quarter: '', LoanCount: '', TotalBalance: '' });
    return;
  }

  for (const row of maturityData) {
    ws.addRow({
      Year: row.Year,
      Quarter: `Q${row.Quarter}`,
      LoanCount: row.LoanCount,
      TotalBalance: row.TotalBalance,
    });
  }
}

/**
 * Build the Lender Exposure tab (pie chart).
 * @param {ExcelJS.Worksheet} ws
 * @param {object[]|null} lenderData
 */
function buildLenderExposureSheet(ws, lenderData) {
  ws.columns = [
    { header: 'Lender', key: 'LenderName', width: 25 },
    { header: 'Loan Count', key: 'LoanCount', width: 14 },
    { header: 'Total Exposure', key: 'TotalExposure', width: 18 },
  ];

  if (!lenderData || lenderData.length === 0) {
    ws.addRow({ LenderName: 'No data', LoanCount: '', TotalExposure: '' });
    return;
  }

  for (const row of lenderData) {
    ws.addRow({
      LenderName: row.LenderName,
      LoanCount: row.LoanCount,
      TotalExposure: row.TotalExposure,
    });
  }
}

/**
 * Generate the Outstanding Loans Excel workbook.
 * @returns {Promise<{ filePath: string, fileName: string, generatedAt: string, noData?: boolean }>}
 */
async function generate() {
  ensureExportsDir();

  const ts = timestamp();
  const fileName = `loans_${ts}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, fileName);
  const generatedAt = new Date().toISOString();

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ALEC';
  wb.created = new Date();

  const loansResult = await financeService.getOutstandingLoans();

  // No-data path
  if (!loansResult.data) {
    const summaryWs = wb.addWorksheet('Summary');
    summaryWs.addRow(['No Data Available']);
    await wb.xlsx.writeFile(filePath);
    return { filePath, fileName, generatedAt, noData: true };
  }

  const loans = loansResult.data;

  // Build 4 sheets
  const summaryWs = wb.addWorksheet('Summary');
  buildSummarySheet(summaryWs, loans);

  const byPropertyWs = wb.addWorksheet('By Property');
  buildByPropertySheet(byPropertyWs, loans);

  const maturityResult = await financeService.getMaturityWall();
  const maturityWs = wb.addWorksheet('Maturity Wall');
  buildMaturityWallSheet(maturityWs, maturityResult.data || null);

  const lenderResult = await financeService.getLenderExposure();
  const lenderWs = wb.addWorksheet('Lender Exposure');
  buildLenderExposureSheet(lenderWs, lenderResult.data || null);

  await wb.xlsx.writeFile(filePath);

  return { filePath, fileName, generatedAt };
}

module.exports = { generate };

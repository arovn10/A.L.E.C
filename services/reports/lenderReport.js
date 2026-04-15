// services/reports/lenderReport.js
'use strict';

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const financeService = require('../financeService');

const EXPORTS_DIR = path.join(process.cwd(), 'data', 'exports');

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

async function generate() {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  const fileName = `lenders_${timestamp()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Lender Exposure');

  ws.columns = [
    { header: 'Lender', key: 'LenderName', width: 25 },
    { header: 'Loan Count', key: 'LoanCount', width: 14 },
    { header: 'Total Exposure', key: 'TotalExposure', width: 20 },
    { header: '% of Portfolio', key: 'PortfolioPct', width: 16 },
  ];

  const result = await financeService.getLenderExposure();
  const rows = result.data || [];

  const grandTotal = rows.reduce((s, r) => s + (r.TotalExposure || 0), 0);

  for (const row of rows) {
    const pct = grandTotal > 0 ? ((row.TotalExposure / grandTotal) * 100).toFixed(2) + '%' : '0%';
    ws.addRow({
      LenderName: row.LenderName,
      LoanCount: row.LoanCount,
      TotalExposure: row.TotalExposure,
      PortfolioPct: pct,
    });
  }

  await wb.xlsx.writeFile(filePath);
  return { filePath, fileName };
}

module.exports = { generate };

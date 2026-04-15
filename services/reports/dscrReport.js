// services/reports/dscrReport.js
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
  const fileName = `dscr_${timestamp()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('DSCR Summary');

  ws.columns = [
    { header: 'Property', key: 'ProjectName', width: 25 },
    { header: 'Lender', key: 'LenderName', width: 20 },
    { header: 'DSCR', key: 'DSCR', width: 10 },
    { header: 'Current Balance', key: 'CurrentBalance', width: 18 },
  ];

  const result = await financeService.getDSCRSummary();
  const rows = result.data || [];

  for (const row of rows) {
    const dataRow = ws.addRow({
      ProjectName: row.ProjectName,
      LenderName: row.LenderName,
      DSCR: row.DSCR,
      CurrentBalance: row.CurrentBalance,
    });

    // Highlight rows where DSCR < 1.25 in red font
    if (row.DSCR !== null && row.DSCR < 1.25) {
      dataRow.eachCell((cell) => {
        cell.font = { color: { argb: 'FFFF0000' }, bold: true };
      });
    }
  }

  await wb.xlsx.writeFile(filePath);
  return { filePath, fileName };
}

module.exports = { generate };

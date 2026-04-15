// services/reports/ltvReport.js
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
  const fileName = `ltv_${timestamp()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('LTV Summary');

  ws.columns = [
    { header: 'Property', key: 'ProjectName', width: 25 },
    { header: 'Lender', key: 'LenderName', width: 20 },
    { header: 'LTV%', key: 'LTV', width: 10 },
    { header: 'Current Balance', key: 'CurrentBalance', width: 18 },
  ];

  const result = await financeService.getLTVSummary();
  const rows = result.data || [];

  for (const row of rows) {
    const dataRow = ws.addRow({
      ProjectName: row.ProjectName,
      LenderName: row.LenderName,
      LTV: row.LTV,
      CurrentBalance: row.CurrentBalance,
    });

    // Highlight rows where LTV > 75 in red fill
    if (row.LTV !== null && row.LTV > 75) {
      dataRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFC7CE' },
        };
        cell.font = { color: { argb: 'FF9C0006' }, bold: true };
      });
    }
  }

  await wb.xlsx.writeFile(filePath);
  return { filePath, fileName };
}

module.exports = { generate };

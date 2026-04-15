// services/reports/maturityReport.js
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
  const fileName = `maturity_${timestamp()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Maturity Wall');

  ws.columns = [
    { header: 'Year', key: 'Year', width: 10 },
    { header: 'Quarter', key: 'Quarter', width: 12 },
    { header: 'Loan Count', key: 'LoanCount', width: 14 },
    { header: 'Total Balance', key: 'TotalBalance', width: 20 },
  ];

  const result = await financeService.getMaturityWall();
  const rows = result.data || [];

  const now = new Date();
  const sixMonthsLater = new Date(now);
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);

  for (const row of rows) {
    const dataRow = ws.addRow({
      Year: row.Year,
      Quarter: `Q${row.Quarter}`,
      LoanCount: row.LoanCount,
      TotalBalance: row.TotalBalance,
    });

    // Flag quarters within 6 months with red fill
    const approxDate = new Date(`${row.Year}-${String((row.Quarter - 1) * 3 + 1).padStart(2, '0')}-01`);
    if (approxDate <= sixMonthsLater) {
      dataRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFF0000' },
        };
        cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      });
    }
  }

  await wb.xlsx.writeFile(filePath);
  return { filePath, fileName };
}

module.exports = { generate };

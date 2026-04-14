// services/reports/equityReport.js
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
  const fileName = `equity_${timestamp()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Equity Commitments');

  ws.columns = [
    { header: 'Property', key: 'ProjectName', width: 25 },
    { header: 'Committed', key: 'CommittedAmount', width: 18 },
    { header: 'Called', key: 'CalledAmount', width: 18 },
    { header: 'Remaining', key: 'RemainingAmount', width: 18 },
    { header: 'Source', key: 'EquitySource', width: 20 },
  ];

  const result = await financeService.getEquityCommitments();
  const rows = result.data || [];

  for (const row of rows) {
    ws.addRow({
      ProjectName: row.ProjectName,
      CommittedAmount: row.CommittedAmount,
      CalledAmount: row.CalledAmount,
      RemainingAmount: row.RemainingAmount,
      EquitySource: row.EquitySource,
    });
  }

  await wb.xlsx.writeFile(filePath);
  return { filePath, fileName };
}

module.exports = { generate };

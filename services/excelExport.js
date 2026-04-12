/**
 * A.L.E.C. Excel Export Service
 *
 * Generates styled .xlsx files from STOA database queries.
 * Files are written to data/exports/ and served at /exports/<filename>.
 *
 * Supports:
 *   - occupancy snapshot (all properties)
 *   - property trend (weekly history)
 *   - portfolio summary
 *   - pipeline deals
 *   - loans
 *   - expiring contracts
 */

const ExcelJS = require('exceljs');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');

const stoaQuery = require('./stoaQueryService.js');

// ── Output directory ────────────────────────────────────────────
const EXPORTS_DIR = path.join(__dirname, '../data/exports');
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

// ── Style helpers ───────────────────────────────────────────────
function headerStyle(ws, row) {
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4332' } }; // dark green
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF92C5A0' } },
    };
  });
}

function alternateRow(row, isEven) {
  if (!isEven) return;
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7F4' } };
  });
}

function pct(v) {
  if (v == null) return null;
  return v <= 1 ? v * 100 : Number(v);
}

function formatPct(v) {
  const n = pct(v);
  return n != null ? n.toFixed(1) + '%' : 'N/A';
}

// ── Sheet builders ──────────────────────────────────────────────

/**
 * Build the "Occupancy Snapshot" sheet — latest week, all properties.
 */
async function buildOccupancySheet(wb) {
  const ws = wb.addWorksheet('Occupancy Snapshot');
  ws.columns = [
    { header: 'Property',        key: 'Property',     width: 32 },
    { header: 'Location',        key: 'Location',     width: 18 },
    { header: 'Report Date',     key: 'ReportDate',   width: 14 },
    { header: 'Total Units',     key: 'TotalUnits',   width: 12 },
    { header: 'Occupied Units',  key: 'OccUnits',     width: 14 },
    { header: 'Occupancy %',     key: 'OccPct',       width: 13 },
    { header: 'Budget Occ %',    key: 'BudgetOccPct', width: 13 },
    { header: 'Leased %',        key: 'LeasedPct',    width: 12 },
    { header: 'Avg Rent',        key: 'AvgRent',      width: 12 },
    { header: 'Budget Rent',     key: 'BudgetRent',   width: 12 },
    { header: 'Rent Variance',   key: 'RentVar',      width: 14 },
    { header: 'Move-ins',        key: 'MoveIns',      width: 11 },
    { header: 'Move-outs',       key: 'MoveOuts',     width: 11 },
    { header: 'Delinquent',      key: 'Delinquent',   width: 11 },
    { header: 'T-12 Renewal %',  key: 'T12Renewal',   width: 14 },
    { header: 'Status',          key: 'Status',       width: 14 },
    { header: 'Region',          key: 'Region',       width: 14 },
  ];

  headerStyle(ws, ws.getRow(1));

  const rows = await stoaQuery.getMMRData();
  rows.forEach((r, i) => {
    const rentVar = r.BudgetedRent && r.AvgOccupiedRent
      ? ((r.AvgOccupiedRent - r.BudgetedRent) / r.BudgetedRent * 100).toFixed(1) + '%'
      : 'N/A';
    const t12Rate = r.T12Expired > 0
      ? (r.T12Renewed / r.T12Expired * 100).toFixed(1) + '%'
      : 'N/A';

    const row = ws.addRow({
      Property:    r.Property,
      Location:    r.Location,
      ReportDate:  r.ReportDate ? new Date(r.ReportDate).toLocaleDateString('en-US') : '',
      TotalUnits:  r.TotalUnits,
      OccUnits:    r.OccupiedUnits,
      OccPct:      pct(r.OccupancyPct) != null ? pct(r.OccupancyPct).toFixed(1) + '%' : 'N/A',
      BudgetOccPct: formatPct(r.BudgetedOccPct),
      LeasedPct:   pct(r.LeasedPct) != null ? pct(r.LeasedPct).toFixed(1) + '%' : 'N/A',
      AvgRent:     r.AvgOccupiedRent,
      BudgetRent:  r.BudgetedRent,
      RentVar:     rentVar,
      MoveIns:     r.MoveIns,
      MoveOuts:    r.MoveOuts,
      Delinquent:  r.Delinquent,
      T12Renewal:  t12Rate,
      Status:      r.Status,
      Region:      r.Region,
    });
    row.getCell('AvgRent').numFmt  = '"$"#,##0';
    row.getCell('BudgetRent').numFmt = '"$"#,##0';
    alternateRow(row, i % 2 === 1);
  });

  ws.autoFilter = { from: 'A1', to: 'Q1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/**
 * Build the "Rent Growth" sheet — pre-computed growth % from HistoricalRentGrowth.
 */
async function buildRentGrowthSheet(wb) {
  const ws = wb.addWorksheet('Rent Growth');
  ws.columns = [
    { header: 'Property',         key: 'Property',   width: 32 },
    { header: 'Current Rent',     key: 'LatestRent', width: 14 },
    { header: '3-Mo Ago',         key: 'Rent3Mo',    width: 12 },
    { header: '6-Mo Ago',         key: 'Rent6Mo',    width: 12 },
    { header: '12-Mo Ago',        key: 'Rent12Mo',   width: 12 },
    { header: '3-Mo Growth %',    key: 'Growth3Mo',  width: 14 },
    { header: '6-Mo Growth %',    key: 'Growth6Mo',  width: 14 },
    { header: '12-Mo Growth %',   key: 'Growth12Mo', width: 14 },
    { header: 'All-Time Growth %',key: 'GrowthAll',  width: 16 },
  ];

  headerStyle(ws, ws.getRow(1));

  const rows = await stoaQuery.getPortfolioRentGrowth();
  const fmtG = (v) => v != null ? ((Number(v) >= 0 ? '+' : '') + (Number(v) * 100).toFixed(1) + '%') : 'N/A';

  rows.forEach((r, i) => {
    const row = ws.addRow({
      Property:  r.Property,
      LatestRent: r.LatestRent,
      Rent3Mo:    r.Rent3Mo,
      Rent6Mo:    r.Rent6Mo,
      Rent12Mo:   r.Rent12Mo,
      Growth3Mo:  fmtG(r.RentGrowth3MoPct),
      Growth6Mo:  fmtG(r.RentGrowth6MoPct),
      Growth12Mo: fmtG(r.RentGrowth12MoPct),
      GrowthAll:  fmtG(r.RentGrowthAllTimePct),
    });
    row.getCell('LatestRent').numFmt = '"$"#,##0';
    row.getCell('Rent3Mo').numFmt    = '"$"#,##0';
    row.getCell('Rent6Mo').numFmt    = '"$"#,##0';
    row.getCell('Rent12Mo').numFmt   = '"$"#,##0';
    alternateRow(row, i % 2 === 1);
  });

  ws.autoFilter = { from: 'A1', to: 'I1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/**
 * Build a property-specific trend sheet with weekly history.
 */
async function buildTrendSheet(wb, property, months = 6) {
  const safeName = property.replace(/[^a-zA-Z0-9\s]/g, '').slice(0, 30);
  const ws = wb.addWorksheet(`${safeName} Trend`);
  ws.columns = [
    { header: 'Week Ending',    key: 'ReportDate',   width: 14 },
    { header: 'Occupancy %',    key: 'OccupancyPct', width: 13 },
    { header: 'Leased %',       key: 'LeasedPct',    width: 12 },
    { header: 'Occupied Units', key: 'OccUnits',     width: 14 },
    { header: 'Total Units',    key: 'TotalUnits',   width: 12 },
    { header: 'Avg Rent',       key: 'AvgRent',      width: 12 },
    { header: 'Budget Rent',    key: 'BudgetRent',   width: 12 },
    { header: 'Move-ins',       key: 'MoveIns',      width: 10 },
    { header: 'Move-outs',      key: 'MoveOuts',     width: 10 },
    { header: 'Delinquent',     key: 'Delinquent',   width: 11 },
  ];

  headerStyle(ws, ws.getRow(1));

  const rows = await stoaQuery.getMMRHistory(property, months);
  rows.forEach((r, i) => {
    const row = ws.addRow({
      ReportDate:   r.ReportDate ? new Date(r.ReportDate).toLocaleDateString('en-US') : '',
      OccupancyPct: pct(r.OccupancyPct) != null ? pct(r.OccupancyPct).toFixed(1) + '%' : 'N/A',
      LeasedPct:    pct(r.LeasedPct) != null ? pct(r.LeasedPct).toFixed(1) + '%' : 'N/A',
      OccUnits:     r.OccupiedUnits,
      TotalUnits:   r.TotalUnits,
      AvgRent:      r.AvgRent,
      BudgetRent:   r.BudgetedRent,
      MoveIns:      r.MoveIns,
      MoveOuts:     r.MoveOuts,
      Delinquent:   r.Delinquent,
    });
    row.getCell('AvgRent').numFmt    = '"$"#,##0';
    row.getCell('BudgetRent').numFmt = '"$"#,##0';
    alternateRow(row, i % 2 === 1);
  });

  ws.autoFilter = { from: 'A1', to: 'J1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/**
 * Build the "Pipeline" sheet.
 */
async function buildPipelineSheet(wb) {
  const ws = wb.addWorksheet('Acquisition Pipeline');
  ws.columns = [
    { header: 'Deal Name',       key: 'DealName',      width: 30 },
    { header: 'City',            key: 'City',          width: 18 },
    { header: 'State',           key: 'State',         width: 8  },
    { header: 'Units',           key: 'Units',         width: 10 },
    { header: 'Stage',           key: 'Stage',         width: 18 },
    { header: 'Product Type',    key: 'ProductType',   width: 16 },
    { header: 'Region',          key: 'Region',        width: 14 },
    { header: 'Asking Price',    key: 'AskingPrice',   width: 14 },
    { header: 'Est. Close Date', key: 'CloseDate',     width: 16 },
  ];

  headerStyle(ws, ws.getRow(1));

  const deals = await stoaQuery.getPipelineDeals();
  deals.forEach((d, i) => {
    const row = ws.addRow({
      DealName:    d.DealName,
      City:        d.City,
      State:       d.State,
      Units:       d.Units,
      Stage:       d.Stage,
      ProductType: d.ProductType,
      Region:      d.Region,
      AskingPrice: d.AskingPrice,
      CloseDate:   d.EstimatedCloseDate ? new Date(d.EstimatedCloseDate).toLocaleDateString('en-US') : '',
    });
    if (d.AskingPrice) row.getCell('AskingPrice').numFmt = '"$"#,##0';
    alternateRow(row, i % 2 === 1);
  });

  ws.autoFilter = { from: 'A1', to: 'I1' };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

/**
 * Build the "Loans" sheet.
 */
async function buildLoansSheet(wb, property = null) {
  const ws = wb.addWorksheet('Loans');
  ws.columns = [
    { header: 'Project',          key: 'Project',  width: 28 },
    { header: 'Lender',           key: 'Lender',   width: 22 },
    { header: 'Loan Type',        key: 'LoanType', width: 14 },
    { header: 'Loan Amount',      key: 'Amount',   width: 14 },
    { header: 'Balance',          key: 'Balance',  width: 14 },
    { header: 'Interest Rate',    key: 'Rate',     width: 13 },
    { header: 'Maturity Date',    key: 'Maturity', width: 14 },
    { header: 'Status',           key: 'Status',   width: 12 },
  ];

  headerStyle(ws, ws.getRow(1));

  const loans = await stoaQuery.getLoans(property);
  loans.forEach((l, i) => {
    const row = ws.addRow({
      Project:  l.ProjectName,
      Lender:   l.LenderName,
      LoanType: l.LoanType,
      Amount:   l.LoanAmount,
      Balance:  l.OutstandingBalance,
      Rate:     l.InterestRate != null ? (l.InterestRate * 100).toFixed(2) + '%' : 'N/A',
      Maturity: l.MaturityDate ? new Date(l.MaturityDate).toLocaleDateString('en-US') : '',
      Status:   l.Status,
    });
    row.getCell('Amount').numFmt  = '"$"#,##0';
    row.getCell('Balance').numFmt = '"$"#,##0';
    alternateRow(row, i % 2 === 1);
  });

  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Generate a full STOA Excel workbook with multiple sheets.
 * `options.type` controls which sheets to include:
 *   'portfolio'  — Occupancy Snapshot + Rent Growth (default)
 *   'trend'      — Specific property trend (requires options.property)
 *   'pipeline'   — Acquisition pipeline
 *   'loans'      — Loan summary
 *   'full'       — All sheets
 *
 * Returns { filePath, fileName, url } where url is the /exports/... path.
 */
async function generateExport(options = {}) {
  const { type = 'portfolio', property = null, months = 6 } = options;

  const wb = new ExcelJS.Workbook();
  wb.creator  = 'A.L.E.C. — STOA Real Estate';
  wb.created  = new Date();
  wb.modified = new Date();

  // Cover metadata sheet
  const cover = wb.addWorksheet('Report Info');
  cover.getCell('A1').value = 'A.L.E.C. STOA Real Estate Report';
  cover.getCell('A1').font  = { bold: true, size: 16, color: { argb: 'FF1B4332' } };
  cover.getCell('A2').value = `Generated: ${new Date().toLocaleString('en-US')}`;
  cover.getCell('A2').font  = { italic: true, color: { argb: 'FF555555' } };
  cover.getCell('A3').value = property ? `Property: ${property}` : 'Scope: Full Portfolio';
  cover.getCell('A4').value = `Report Type: ${type}`;
  cover.columns = [{ width: 50 }];

  switch (type) {
    case 'trend':
      if (property) {
        await buildTrendSheet(wb, property, months);
        await buildOccupancySheet(wb); // current snapshot for comparison
      }
      break;

    case 'pipeline':
      await buildPipelineSheet(wb);
      break;

    case 'loans':
      await buildLoansSheet(wb, property);
      break;

    case 'full':
      await buildOccupancySheet(wb);
      await buildRentGrowthSheet(wb);
      await buildPipelineSheet(wb);
      await buildLoansSheet(wb, property);
      if (property) await buildTrendSheet(wb, property, months);
      break;

    case 'portfolio':
    default:
      await buildOccupancySheet(wb);
      await buildRentGrowthSheet(wb);
      break;
  }

  const fileName = `stoa-export-${type}-${Date.now()}.xlsx`;
  const filePath  = path.join(EXPORTS_DIR, fileName);
  await wb.xlsx.writeFile(filePath);

  return {
    filePath,
    fileName,
    url: `/exports/${fileName}`,
    type,
    property,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Detect if a user message is asking for an Excel export.
 * Returns { isExport, type, property, months } or null.
 */
function detectExportIntent(text) {
  const t = text.toLowerCase();
  if (!/\b(export|excel|spreadsheet|download|\.xlsx|csv|sheet|generate.?report|create.?report)\b/i.test(t)) {
    return null;
  }

  // Determine type
  let type = 'portfolio';
  if (/\b(trend|history|past|last\s+\d|months?|over.?time)\b/i.test(t)) type = 'trend';
  else if (/\b(pipeline|deal|acqui)\b/i.test(t)) type = 'pipeline';
  else if (/\b(loan|debt|financing)\b/i.test(t)) type = 'loans';
  else if (/\b(full|all|complete|everything)\b/i.test(t)) type = 'full';

  // Property
  let property = null;
  const brandMatch = t.match(/(?:the\s+)?(waters? at|heights? at|flats? at)\s+([\w]+(?:\s+[\w]+){0,3}?)(?=\s+(?:doing|is|how|export|excel|for)|[,?.]|$)/i);
  if (brandMatch) {
    property = 'The ' + brandMatch[1].replace(/\b\w/g, c => c.toUpperCase()) + ' ' + brandMatch[2].trim().replace(/\b\w/g, c => c.toUpperCase());
  }

  const cities = ['hammond', 'covington', 'millerville', 'bluebonnet', 'settlers trace', 'west village',
    'redstone', 'crestview', 'freeport', 'promenade', 'mcgowin', 'picardy', 'waterpointe',
    'crosspointe', 'ransley', 'bartlett', 'owa', 'robinwood', 'conway', 'fayetteville',
    'materra', 'inverness'];
  if (!property) {
    for (const city of cities) {
      if (t.includes(city)) { property = city; break; }
    }
  }

  const monthsMatch = t.match(/(?:past|last|previous)\s+(\d+)\s+months?/i);
  const months = monthsMatch ? parseInt(monthsMatch[1]) : 6;

  return { isExport: true, type, property, months };
}

// ── Cleanup ──────────────────────────────────────────────────────
/**
 * Delete export files older than `maxAgeHours` (default 24h).
 * Call periodically to keep disk clean.
 */
function cleanupOldExports(maxAgeHours = 24) {
  try {
    const now = Date.now();
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
    for (const f of fs.readdirSync(EXPORTS_DIR)) {
      if (!f.endsWith('.xlsx')) continue;
      const fullPath = path.join(EXPORTS_DIR, f);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
        console.log('[ExcelExport] Cleaned up:', f);
      }
    }
  } catch (_) {}
}

// Auto-cleanup on startup
setTimeout(() => cleanupOldExports(24), 5000);

module.exports = { generateExport, detectExportIntent, cleanupOldExports };

# Plan D — Documents + PDF + Financial Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build PDF ingestion, financial intelligence querying, and multi-format document generation so ALEC can read loan documents and produce Excel/PPTX/Word reports from live Azure SQL data.

**Architecture:** `pdfIngestionService` extracts and chunks PDF text into Weaviate; `financeService` queries Azure SQL views for live financial metrics; six Excel report generators plus pptxService and wordService produce formatted outputs; `reportRoutes` exposes all generation endpoints behind auth.

**Tech Stack:** pdf-parse, exceljs, pptxgenjs, docx, multer, axios, better-sqlite3

---

## Task 1: pdfIngestionService.js + pdfRoutes.js + tests

### Files
- **Create:** `services/pdfIngestionService.js`
- **Create:** `routes/pdfRoutes.js`
- **Create:** `tests/pdfIngestionService.test.js`

### Step 1.1 — Write the failing test first

- [ ] Create `tests/pdfIngestionService.test.js`:

```js
// tests/pdfIngestionService.test.js
'use strict';

jest.mock('pdf-parse', () => jest.fn());
jest.mock('axios');
jest.mock('../services/weaviateService', () => ({
  upsert: jest.fn().mockResolvedValue({ id: 'mock-id' }),
  hybridSearch: jest.fn().mockResolvedValue([
    { content: 'chunk one' },
    { content: 'chunk two' },
  ]),
}));

const pdfParse = require('pdf-parse');
const axios = require('axios');
const weaviateService = require('../services/weaviateService');
const pdfIngestionService = require('../services/pdfIngestionService');

beforeEach(() => {
  jest.clearAllMocks();
  axios.post = jest.fn().mockResolvedValue({ data: { vector: [0.1, 0.2, 0.3] } });
});

test('ingest returns correct shape', async () => {
  pdfParse.mockResolvedValue({ text: 'Hello world this is a test PDF document.', numpages: 2 });
  const result = await pdfIngestionService.ingest(Buffer.from('fake'), 'test.pdf');
  expect(result).toMatchObject({
    docUuid: 'pdf::test.pdf',
    chunkCount: expect.any(Number),
    pageCount: 2,
  });
});

test('chunkCount matches number of upsert calls', async () => {
  const longText = 'A'.repeat(2500);
  pdfParse.mockResolvedValue({ text: longText, numpages: 1 });
  const result = await pdfIngestionService.ingest(Buffer.from('fake'), 'big.pdf');
  expect(weaviateService.upsert).toHaveBeenCalledTimes(result.chunkCount);
});

test('upsert called with correct props per chunk', async () => {
  pdfParse.mockResolvedValue({ text: 'Short text for one chunk.', numpages: 1 });
  await pdfIngestionService.ingest(Buffer.from('fake'), 'short.pdf');
  const firstCall = weaviateService.upsert.mock.calls[0];
  expect(firstCall[0]).toBe('ALECDocument');
  expect(firstCall[1]).toMatchObject({
    docUuid: expect.stringContaining('pdf::short.pdf::'),
    chunkIndex: 0,
    content: expect.any(String),
    sourceType: 'pdf',
    sourceUrl: 'short.pdf',
    tags: ['pdf', 'upload'],
    indexedAt: expect.any(String),
  });
});

test('ingest throws when pdf-parse fails', async () => {
  pdfParse.mockRejectedValue(new Error('corrupt PDF'));
  await expect(pdfIngestionService.ingest(Buffer.from('bad'), 'bad.pdf')).rejects.toThrow('corrupt PDF');
});

test('getSummary returns a string', async () => {
  const summary = await pdfIngestionService.getSummary('pdf::test.pdf');
  expect(typeof summary).toBe('string');
  expect(summary.length).toBeGreaterThan(0);
});
```

- [ ] Run test to confirm all 5 fail:
```bash
node_modules/.bin/jest tests/pdfIngestionService.test.js --forceExit
```

### Step 1.2 — Implement pdfIngestionService.js

- [ ] Create `services/pdfIngestionService.js`:

```js
// services/pdfIngestionService.js
'use strict';

const pdfParse = require('pdf-parse');
const axios = require('axios');
const weaviateService = require('./weaviateService');

const NEURAL_URL = process.env.NEURAL_URL || 'http://localhost:8000';
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 100;

/**
 * Split text into overlapping chunks.
 * @param {string} text
 * @returns {string[]}
 */
function chunkText(text) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

/**
 * Embed a piece of text via the neural server.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embed(text) {
  const response = await axios.post(`${NEURAL_URL}/embed`, { text });
  return response.data.vector;
}

/**
 * Ingest a PDF buffer into Weaviate.
 * @param {Buffer} buffer - Raw PDF bytes
 * @param {string} filename - Original file name (used as docUuid base)
 * @returns {Promise<{ docUuid: string, chunkCount: number, pageCount: number }>}
 */
async function ingest(buffer, filename) {
  const parsed = await pdfParse(buffer);
  const { text, numpages } = parsed;

  const chunks = chunkText(text);
  const baseDocUuid = `pdf::${filename}`;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText_ = chunks[i];
    const docUuid = `${baseDocUuid}::${i}`;
    const vector = await embed(chunkText_);
    await weaviateService.upsert(
      'ALECDocument',
      {
        docUuid,
        chunkIndex: i,
        content: chunkText_,
        sourceType: 'pdf',
        sourceUrl: filename,
        tags: ['pdf', 'upload'],
        indexedAt: new Date().toISOString(),
      },
      vector
    );
  }

  return {
    docUuid: baseDocUuid,
    chunkCount: chunks.length,
    pageCount: numpages,
  };
}

/**
 * Retrieve and join chunk content for a given base docUuid.
 * @param {string} baseDocUuid - e.g. "pdf::myfile.pdf"
 * @returns {Promise<string>} First 2000 chars of joined content
 */
async function getSummary(baseDocUuid) {
  const results = await weaviateService.hybridSearch(
    'ALECDocument',
    '',
    [],
    20
  );
  const relevant = results.filter(
    (r) => r.docUuid && r.docUuid.startsWith(baseDocUuid)
  );
  const joined = (relevant.length > 0 ? relevant : results)
    .map((r) => r.content || '')
    .join('\n');
  return joined.slice(0, 2000);
}

module.exports = { ingest, getSummary };
```

- [ ] Run tests again — all 5 should pass:
```bash
node_modules/.bin/jest tests/pdfIngestionService.test.js --forceExit
```

### Step 1.3 — Implement pdfRoutes.js

- [ ] Create `routes/pdfRoutes.js`:

```js
// routes/pdfRoutes.js
'use strict';

const express = require('express');
const multer = require('multer');
const pdfIngestionService = require('../services/pdfIngestionService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * POST /api/pdf/upload
 * Accepts multipart/form-data with field "file" (PDF).
 * Returns { success, docUuid, chunkCount, pageCount }
 */
router.post('/pdf/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
    const { docUuid, chunkCount, pageCount } = await pdfIngestionService.ingest(
      req.file.buffer,
      req.file.originalname
    );
    return res.json({ success: true, docUuid, chunkCount, pageCount });
  } catch (err) {
    console.error('[pdfRoutes] upload error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/pdf/:docUuid/summary
 * Returns { success, summary }
 */
router.get('/pdf/:docUuid/summary', async (req, res) => {
  try {
    const { docUuid } = req.params;
    const summary = await pdfIngestionService.getSummary(docUuid);
    return res.json({ success: true, summary });
  } catch (err) {
    console.error('[pdfRoutes] summary error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
```

### Step 1.4 — Commit

- [ ] Run the full test suite one final time:
```bash
node_modules/.bin/jest tests/pdfIngestionService.test.js --forceExit
```
- [ ] Commit:
```bash
git add services/pdfIngestionService.js routes/pdfRoutes.js tests/pdfIngestionService.test.js
git commit -m "feat(pdf): pdfIngestionService + pdfRoutes + 5 tests"
```

---

## Task 2: financeExtractor.js + financeService.js + tests

### Files
- **Create:** `services/financeExtractor.js`
- **Create:** `services/financeService.js`
- **Create:** `tests/financeExtractor.test.js`
- **Create:** `tests/financeService.test.js`

### Step 2.1 — Write failing tests first

- [ ] Create `tests/financeExtractor.test.js`:

```js
// tests/financeExtractor.test.js
'use strict';

const { extract } = require('../services/financeExtractor');

test('extracts dollar amounts', () => {
  const { amounts } = extract('The loan is $1,200,000 and a bridge of $500K was arranged.');
  expect(amounts).toContain('$1,200,000');
  expect(amounts).toContain('$500K');
});

test('extracts percentages', () => {
  const { percentages } = extract('Interest rate is 5.75% with a DSCR floor of 1.25%.');
  expect(percentages).toContain('5.75%');
  expect(percentages).toContain('1.25%');
});

test('extracts dates in MM/DD/YYYY format', () => {
  const { dates } = extract('Maturity date is 12/31/2026 and origination was 01/15/2021.');
  expect(dates).toContain('12/31/2026');
  expect(dates).toContain('01/15/2021');
});

test('extracts dates in Month DD, YYYY format', () => {
  const { dates } = extract('The closing occurred on March 15, 2023 and matures January 1, 2028.');
  expect(dates).toContain('March 15, 2023');
  expect(dates).toContain('January 1, 2028');
});

test('extracts known lender names case-insensitively', () => {
  const { lenders } = extract('Loan originated by jpmorgan with a WELLS FARGO participation.');
  expect(lenders.map((l) => l.toLowerCase())).toContain('jpmorgan');
  expect(lenders.map((l) => l.toLowerCase())).toContain('wells fargo');
});
```

- [ ] Create `tests/financeService.test.js`:

```js
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
```

- [ ] Run tests to confirm they fail:
```bash
node_modules/.bin/jest tests/financeExtractor.test.js tests/financeService.test.js --forceExit
```

### Step 2.2 — Implement financeExtractor.js

- [ ] Create `services/financeExtractor.js`:

```js
// services/financeExtractor.js
'use strict';

const KNOWN_LENDERS = [
  'JPMorgan',
  'Wells Fargo',
  'Bank of America',
  'Goldman Sachs',
  'Citibank',
  'KeyBank',
  'Regions Bank',
  'TD Bank',
  'Truist',
  'US Bank',
];

/**
 * Extract financial entities from raw text.
 * Pure function — no I/O.
 * @param {string} text
 * @returns {{ amounts: string[], percentages: string[], dates: string[], lenders: string[] }}
 */
function extract(text) {
  const amounts = (text.match(/\$[\d,]+(?:\.\d+)?\s*(?:million|billion|M|B|K)?/gi) || []).map(
    (s) => s.trim()
  );

  const percentages = text.match(/\d+(?:\.\d+)?%/g) || [];

  const dates =
    text.match(
      /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4}\b/gi
    ) || [];

  const lenders = KNOWN_LENDERS.filter((lender) =>
    new RegExp(lender.replace(/\s+/g, '\\s+'), 'i').test(text)
  );

  return { amounts, percentages, dates, lenders };
}

module.exports = { extract };
```

### Step 2.3 — Implement financeService.js

- [ ] Create `services/financeService.js`:

```js
// services/financeService.js
'use strict';

const { registry } = require('../dataConnectors');

/**
 * Query helper — wraps registry.fetch and normalises the return shape.
 * Returns { data, source } on success or { data: null, error } on failure.
 */
async function query(sql) {
  try {
    const result = await registry.fetch('azureSql', { query: sql });
    if (result.data === null || result.data === undefined) {
      return { data: null, error: result.error || 'No data returned' };
    }
    return { data: result.data, source: 'Azure SQL' };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * Full loan summary from vw_LoanSummary.
 */
async function getOutstandingLoans() {
  return query(
    `SELECT
      ProjectName, LenderName, LoanType,
      OriginalAmount, CurrentBalance, InterestRate,
      MaturityDate,
      DATEDIFF(day, GETDATE(), MaturityDate) AS DaysToMaturity,
      LTV, DSCR, CovenantStatus, GuarantorName, UpdatedAt
    FROM vw_LoanSummary
    ORDER BY MaturityDate`
  );
}

/**
 * Maturity wall grouped by year and quarter.
 * @param {number} months - Look-ahead window in months (default 36)
 */
async function getMaturityWall(months = 36) {
  return query(
    `SELECT
      YEAR(MaturityDate) AS Year,
      DATEPART(quarter, MaturityDate) AS Quarter,
      COUNT(*) AS LoanCount,
      SUM(CurrentBalance) AS TotalBalance
    FROM vw_LoanSummary
    WHERE MaturityDate BETWEEN GETDATE() AND DATEADD(month, ${months}, GETDATE())
    GROUP BY YEAR(MaturityDate), DATEPART(quarter, MaturityDate)
    ORDER BY Year, Quarter`
  );
}

/**
 * Exposure by lender.
 */
async function getLenderExposure() {
  return query(
    `SELECT
      LenderName,
      COUNT(*) AS LoanCount,
      SUM(CurrentBalance) AS TotalExposure
    FROM vw_LoanSummary
    GROUP BY LenderName
    ORDER BY TotalExposure DESC`
  );
}

/**
 * DSCR summary ordered by DSCR ascending (weakest first).
 */
async function getDSCRSummary() {
  return query(
    `SELECT
      ProjectName, LenderName, DSCR, CurrentBalance
    FROM vw_LoanSummary
    ORDER BY DSCR ASC`
  );
}

/**
 * LTV summary ordered by LTV descending (highest risk first).
 */
async function getLTVSummary() {
  return query(
    `SELECT
      ProjectName, LenderName, LTV, CurrentBalance
    FROM vw_LoanSummary
    ORDER BY LTV DESC`
  );
}

/**
 * Equity commitments from vw_EquityCommitments.
 */
async function getEquityCommitments() {
  return query(
    `SELECT
      ProjectName,
      CommittedAmount,
      CalledAmount,
      (CommittedAmount - CalledAmount) AS RemainingAmount,
      EquitySource
    FROM vw_EquityCommitments
    ORDER BY ProjectName`
  );
}

module.exports = {
  getOutstandingLoans,
  getMaturityWall,
  getLenderExposure,
  getDSCRSummary,
  getLTVSummary,
  getEquityCommitments,
};
```

### Step 2.4 — Run tests and commit

- [ ] Run tests — all 9 (5 extractor + 4 service) should pass:
```bash
node_modules/.bin/jest tests/financeExtractor.test.js tests/financeService.test.js --forceExit
```
- [ ] Commit:
```bash
git add services/financeExtractor.js services/financeService.js \
        tests/financeExtractor.test.js tests/financeService.test.js
git commit -m "feat(finance): financeExtractor + financeService + 9 tests"
```

---

## Task 3: loansReport.js — Outstanding Loans 4-Tab Excel

### Files
- **Create:** `services/reports/loansReport.js`
- **Create:** `tests/loansReport.test.js`

### Step 3.1 — Write failing tests first

- [ ] Create `tests/loansReport.test.js`:

```js
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
```

- [ ] Run to confirm failure:
```bash
node_modules/.bin/jest tests/loansReport.test.js --forceExit
```

### Step 3.2 — Implement loansReport.js

- [ ] Ensure `data/exports/` directory exists in the repo (create `.gitkeep`):
```bash
mkdir -p data/exports && touch data/exports/.gitkeep
```

- [ ] Create `services/reports/loansReport.js`:

```js
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

  // Add bar chart
  ws.addChart({
    type: 'bar',
    series: [
      {
        name: { formula: `'Maturity Wall'!$D$1` },
        labels: { formula: `'Maturity Wall'!$A$2:$B$${maturityData.length + 1}` },
        values: { formula: `'Maturity Wall'!$D$2:$D$${maturityData.length + 1}` },
      },
    ],
    title: { name: 'Maturity Wall by Quarter' },
    plotArea: { bar: { dir: 'col', grouping: 'clustered' } },
    legend: { position: 'b' },
    valAxis: [{ numFmt: '$#,##0' }],
    start: [1, maturityData.length + 3],
    end: [10, maturityData.length + 20],
  });
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

  // Add pie chart
  ws.addChart({
    type: 'pie',
    series: [
      {
        name: 'Lender Exposure',
        labels: { formula: `'Lender Exposure'!$A$2:$A$${lenderData.length + 1}` },
        values: { formula: `'Lender Exposure'!$C$2:$C$${lenderData.length + 1}` },
      },
    ],
    title: { name: 'Lender Exposure Distribution' },
    legend: { position: 'r' },
    start: [1, lenderData.length + 3],
    end: [10, lenderData.length + 20],
  });
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
```

### Step 3.3 — Run tests and commit

- [ ] Run tests:
```bash
node_modules/.bin/jest tests/loansReport.test.js --forceExit
```
- [ ] Commit:
```bash
git add services/reports/loansReport.js tests/loansReport.test.js data/exports/.gitkeep
git commit -m "feat(reports): loansReport 4-tab Excel + 4 tests"
```

---

## Task 4: Additional reports + pptxService.js + wordService.js

### Files
- **Create:** `services/reports/maturityReport.js`
- **Create:** `services/reports/lenderReport.js`
- **Create:** `services/reports/dscrReport.js`
- **Create:** `services/reports/ltvReport.js`
- **Create:** `services/reports/equityReport.js`
- **Create:** `services/pptxService.js`
- **Create:** `services/wordService.js`
- **Create:** `tests/reportsBundle.test.js`

### Step 4.1 — Write failing tests first

- [ ] Create `tests/reportsBundle.test.js`:

```js
// tests/reportsBundle.test.js
'use strict';

const path = require('path');
const fs = require('fs');

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
```

- [ ] Run to confirm failure:
```bash
node_modules/.bin/jest tests/reportsBundle.test.js --forceExit
```

### Step 4.2 — Implement the five additional Excel reports

- [ ] Create `services/reports/maturityReport.js`:

```js
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
```

- [ ] Create `services/reports/lenderReport.js`:

```js
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
```

- [ ] Create `services/reports/dscrReport.js`:

```js
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
```

- [ ] Create `services/reports/ltvReport.js`:

```js
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
```

- [ ] Create `services/reports/equityReport.js`:

```js
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
```

### Step 4.3 — Implement pptxService.js

- [ ] Create `services/pptxService.js`:

```js
// services/pptxService.js
'use strict';

const path = require('path');
const fs = require('fs');
const PptxGenJS = require('pptxgenjs');

const EXPORTS_DIR = path.join(process.cwd(), 'data', 'exports');

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

/**
 * Generate a PowerPoint deck with a title slide and one slide per property.
 * @param {{ title: string, properties: Array<{ name: string, balance: number, ltv: number, dscr: number }> }} options
 * @returns {Promise<{ filePath: string, fileName: string }>}
 */
async function generate({ title, properties = [] }) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const fileName = `deck_${timestamp()}.pptx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.addText(title, {
    x: '10%',
    y: '35%',
    w: '80%',
    h: '30%',
    fontSize: 36,
    bold: true,
    align: 'center',
    color: '003366',
  });
  titleSlide.addText(`Generated: ${new Date().toLocaleDateString()}`, {
    x: '10%',
    y: '65%',
    w: '80%',
    h: '10%',
    fontSize: 16,
    align: 'center',
    color: '666666',
  });

  // One slide per property
  for (const prop of properties) {
    const slide = pptx.addSlide();

    slide.addText(prop.name, {
      x: '5%',
      y: '5%',
      w: '90%',
      h: '15%',
      fontSize: 28,
      bold: true,
      color: '003366',
    });

    const bullets = [
      { text: `Current Balance: $${(prop.balance || 0).toLocaleString()}`, options: { fontSize: 18, bullet: true } },
      { text: `LTV: ${prop.ltv || 'N/A'}%`, options: { fontSize: 18, bullet: true } },
      { text: `DSCR: ${prop.dscr || 'N/A'}`, options: { fontSize: 18, bullet: true } },
    ];

    slide.addText(bullets, {
      x: '5%',
      y: '25%',
      w: '90%',
      h: '60%',
    });
  }

  await pptx.writeFile({ fileName: filePath });
  return { filePath, fileName };
}

module.exports = { generate };
```

### Step 4.4 — Implement wordService.js

- [ ] Create `services/wordService.js`:

```js
// services/wordService.js
'use strict';

const path = require('path');
const fs = require('fs');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType } = require('docx');

const EXPORTS_DIR = path.join(process.cwd(), 'data', 'exports');

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
}

/**
 * Generate a Word document with property heading and T12 table.
 * @param {{ property: string, t12Data: Array<{ month: string, grossIncome: number, expenses: number, noi: number }> }} options
 * @returns {Promise<{ filePath: string, fileName: string }>}
 */
async function generate({ property, t12Data = [] }) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });

  const fileName = `t12_${timestamp()}.docx`;
  const filePath = path.join(EXPORTS_DIR, fileName);

  // Build table rows
  const headerRow = new TableRow({
    children: [
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Month', bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Gross Income', bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Expenses', bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'NOI', bold: true })] })] }),
    ],
  });

  const dataRows = (t12Data || []).map(
    (row) =>
      new TableRow({
        children: [
          new TableCell({ children: [new Paragraph(row.month || '')] }),
          new TableCell({ children: [new Paragraph(`$${(row.grossIncome || 0).toLocaleString()}`)] }),
          new TableCell({ children: [new Paragraph(`$${(row.expenses || 0).toLocaleString()}`)] }),
          new TableCell({ children: [new Paragraph(`$${(row.noi || 0).toLocaleString()}`)] }),
        ],
      })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [headerRow, ...dataRows],
  });

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            text: `T12 Summary — ${property}`,
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            text: `Generated: ${new Date().toLocaleDateString()}`,
            alignment: AlignmentType.RIGHT,
          }),
          new Paragraph({ text: '' }), // spacer
          table,
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);

  return { filePath, fileName };
}

module.exports = { generate };
```

### Step 4.5 — Run tests and commit

- [ ] Run all 7 bundle tests:
```bash
node_modules/.bin/jest tests/reportsBundle.test.js --forceExit
```
- [ ] Commit:
```bash
git add services/reports/maturityReport.js \
        services/reports/lenderReport.js \
        services/reports/dscrReport.js \
        services/reports/ltvReport.js \
        services/reports/equityReport.js \
        services/pptxService.js \
        services/wordService.js \
        tests/reportsBundle.test.js
git commit -m "feat(reports): maturity/lender/dscr/ltv/equity Excel + pptxService + wordService + 7 tests"
```

---

## Task 5: reportRoutes.js + server.js wiring

### Files
- **Create:** `routes/reportRoutes.js`
- **Modify:** `backend/server.js`
- **Create:** `tests/reportRoutes.test.js`

### Step 5.1 — Write failing tests first

- [ ] Create `tests/reportRoutes.test.js`:

```js
// tests/reportRoutes.test.js
'use strict';

const request = require('supertest');
const express = require('express');

// Mock all report modules
jest.mock('../services/reports/loansReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/loans_20260414.xlsx',
    fileName: 'loans_20260414.xlsx',
    generatedAt: '2026-04-14T00:00:00.000Z',
  }),
}));
jest.mock('../services/reports/maturityReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/maturity_20260414.xlsx',
    fileName: 'maturity_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/lenderReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/lenders_20260414.xlsx',
    fileName: 'lenders_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/dscrReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/dscr_20260414.xlsx',
    fileName: 'dscr_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/ltvReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/ltv_20260414.xlsx',
    fileName: 'ltv_20260414.xlsx',
  }),
}));
jest.mock('../services/reports/equityReport', () => ({
  generate: jest.fn().mockResolvedValue({
    filePath: '/data/exports/equity_20260414.xlsx',
    fileName: 'equity_20260414.xlsx',
  }),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  // Bypass auth for tests
  app.use((req, res, next) => next());
  const reportRoutes = require('../routes/reportRoutes');
  app.use('/api', reportRoutes);
  return app;
}

test('GET /api/reports/loans returns success=true with url', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/loans');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.url).toContain('loans_');
  expect(res.body.fileName).toMatch(/\.xlsx$/);
});

test('GET /api/reports/maturity returns success=true', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/maturity');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.url).toContain('/api/download/');
});

test('GET /api/reports/dscr returns success=true', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/dscr');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});

test('GET /api/reports/equity returns success=true', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/reports/equity');
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
});
```

- [ ] Run to confirm failure:
```bash
node_modules/.bin/jest tests/reportRoutes.test.js --forceExit
```

### Step 5.2 — Implement reportRoutes.js

- [ ] Create `routes/reportRoutes.js`:

```js
// routes/reportRoutes.js
'use strict';

const express = require('express');
const loansReport = require('../services/reports/loansReport');
const maturityReport = require('../services/reports/maturityReport');
const lenderReport = require('../services/reports/lenderReport');
const dscrReport = require('../services/reports/dscrReport');
const ltvReport = require('../services/reports/ltvReport');
const equityReport = require('../services/reports/equityReport');

const router = express.Router();

/**
 * Helper: run a report generator and return standardised JSON.
 */
async function runReport(res, generatorFn) {
  try {
    const result = await generatorFn();
    const { fileName, generatedAt, noData } = result;
    return res.json({
      success: true,
      url: `/api/download/${fileName}`,
      fileName,
      generatedAt: generatedAt || new Date().toISOString(),
      ...(noData ? { noData: true } : {}),
    });
  } catch (err) {
    console.error('[reportRoutes] error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
}

router.get('/reports/loans', (req, res) => runReport(res, () => loansReport.generate()));
router.get('/reports/maturity', (req, res) => runReport(res, () => maturityReport.generate()));
router.get('/reports/lenders', (req, res) => runReport(res, () => lenderReport.generate()));
router.get('/reports/dscr', (req, res) => runReport(res, () => dscrReport.generate()));
router.get('/reports/ltv', (req, res) => runReport(res, () => ltvReport.generate()));
router.get('/reports/equity', (req, res) => runReport(res, () => equityReport.generate()));

module.exports = router;
```

### Step 5.3 — Modify backend/server.js

Read the current server.js before editing. Then add the following changes:

- [ ] Add `data/exports/` directory creation at startup:
```js
// Near the top, after other requires:
const fs = require('fs');
fs.mkdirSync(path.join(__dirname, '..', 'data', 'exports'), { recursive: true });
```

- [ ] Register pdfRoutes:
```js
const pdfRoutes = require('../routes/pdfRoutes');
// After other app.use calls with authenticateToken:
app.use('/api', authenticateToken, pdfRoutes);
```

- [ ] Register reportRoutes:
```js
const reportRoutes = require('../routes/reportRoutes');
app.use('/api', authenticateToken, reportRoutes);
```

- [ ] Add the download endpoint (serve from data/exports/):
```js
app.get('/api/download/:filename', authenticateToken, (req, res) => {
  const filePath = path.join(__dirname, '..', 'data', 'exports', req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File not found' });
  }
  res.download(filePath);
});
```

**Important:** Read `backend/server.js` first with the Read tool, identify the exact insertion points (after the last `app.use` for routes, before `app.listen`), and make targeted edits using the Edit tool. Do not overwrite the entire file.

### Step 5.4 — Run all tests and commit

- [ ] Run all test files:
```bash
node_modules/.bin/jest tests/pdfIngestionService.test.js \
  tests/financeExtractor.test.js \
  tests/financeService.test.js \
  tests/loansReport.test.js \
  tests/reportsBundle.test.js \
  tests/reportRoutes.test.js \
  --forceExit
```
- [ ] Commit:
```bash
git add routes/reportRoutes.js tests/reportRoutes.test.js backend/server.js
git commit -m "feat(routes): reportRoutes + server.js wiring + download endpoint + 4 tests"
```

---

## Self-Review Checklist

Before marking Plan D complete, verify:

- [ ] All 5 tasks have complete, runnable code — no TBDs or pseudo-code
- [ ] Every service module handles the `data: null` case without throwing
- [ ] `financeService` never surfaces raw SQL errors to callers — wraps in `{ data: null, error }`
- [ ] H7 rule compliance: no financial figures quoted without data source; all report routes return `source` from financeService
- [ ] `pdfIngestionService.ingest` uses `NEURAL_URL` env var (not hardcoded URL)
- [ ] `data/exports/` directory created at startup and also lazily in each report via `fs.mkdirSync(..., { recursive: true })`
- [ ] All chunk upserts include `indexedAt` ISO timestamp
- [ ] `getSummary` falls back gracefully if no matching chunks found
- [ ] `loansReport` 4-tab workbook: Summary / By Property / Maturity Wall / Lender Exposure
- [ ] `dscrReport` flags DSCR < 1.25 in red font; `ltvReport` flags LTV > 75 in red fill
- [ ] `maturityReport` flags quarters within 6 months in red
- [ ] `pptxService` saves to `data/exports/deck_*.pptx`, `wordService` to `data/exports/t12_*.docx`
- [ ] `reportRoutes` uses `runReport` helper for consistent error handling across all 6 endpoints
- [ ] Download endpoint path-sanitised (filename from `req.params.filename`, served from fixed `EXPORTS_DIR`)
- [ ] Tests all use `--forceExit` flag
- [ ] All test files mock external dependencies (pdf-parse, axios, weaviateService, financeService, registry)
- [ ] Total test count: 5 (pdf) + 5 (extractor) + 4 (finance service) + 4 (loans report) + 7 (bundle) + 4 (routes) = **29 tests**

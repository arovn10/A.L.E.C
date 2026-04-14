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

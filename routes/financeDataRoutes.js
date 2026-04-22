// routes/financeDataRoutes.js
'use strict';

const express = require('express');
const financeService = require('../services/financeService');

const router = express.Router();

/**
 * Normalize a financeService result to { rows, noData, error }.
 * Azure SQL returns { data: [...] } on success or { data: null, error } when not connected.
 */
function toRows(result) {
  if (!result || result.error || !Array.isArray(result.data)) {
    return { rows: [], noData: true };
  }
  return { rows: result.data };
}

async function respond(res, fetchFn) {
  try {
    const result = await fetchFn();
    return res.json({ success: true, ...toRows(result) });
  } catch (err) {
    console.error('[financeDataRoutes] error:', err.message);
    return res.json({ success: true, rows: [], noData: true });
  }
}

router.get('/finance/loans',    (req, res) => respond(res, () => financeService.getOutstandingLoans()));
router.get('/finance/maturity', (req, res) => respond(res, () => financeService.getMaturityWall()));
router.get('/finance/lenders',  (req, res) => respond(res, () => financeService.getLenderExposure()));
router.get('/finance/dscr',     (req, res) => respond(res, () => financeService.getDSCRSummary()));
router.get('/finance/ltv',      (req, res) => respond(res, () => financeService.getLTVSummary()));
router.get('/finance/equity',   (req, res) => respond(res, () => financeService.getEquityCommitments()));

module.exports = router;

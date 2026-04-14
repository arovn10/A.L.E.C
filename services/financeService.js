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

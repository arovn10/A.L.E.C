// services/financeService.js
'use strict';

const { registry } = require('../dataConnectors');

/**
 * Query helper — wraps registry.fetch and normalises the return shape.
 * Returns { data, source } on success or { data: null, error } on failure.
 */
async function query(sql) {
  try {
    const result = await registry.fetch('azureSql', { sql });
    const rows = result.recordset ?? result.data ?? null;
    if (!Array.isArray(rows)) {
      return { data: null, error: result.error || 'No data returned' };
    }
    return { data: rows, source: 'Azure SQL' };
  } catch (err) {
    return { data: null, error: err.message };
  }
}

/**
 * Full loan summary — joins banking.Loan, core.Project, core.Bank.
 */
async function getOutstandingLoans() {
  return query(`
    SELECT
      p.ProjectName,
      b.BankName        AS LenderName,
      l.LoanType,
      l.LoanCategory,
      l.LoanAmount      AS OriginalAmount,
      l.CurrentBalance,
      l.InterestRate,
      l.MaturityDate,
      DATEDIFF(day, GETDATE(), l.MaturityDate) AS DaysToMaturity,
      p.LTCOriginal     AS LTC,
      l.FixedOrFloating,
      l.LoanPhase,
      l.IsActive
    FROM banking.Loan l
    JOIN core.Project p ON p.ProjectId = l.ProjectId
    LEFT JOIN core.Bank b ON b.BankId = l.LenderId
    WHERE l.IsActive = 1
    ORDER BY l.MaturityDate
  `);
}

/**
 * Maturity wall grouped by year and quarter.
 */
async function getMaturityWall() {
  return query(`
    SELECT
      YEAR(l.MaturityDate)              AS Year,
      DATEPART(quarter, l.MaturityDate) AS Quarter,
      COUNT(*)                          AS LoanCount,
      SUM(l.CurrentBalance)             AS TotalBalance
    FROM banking.Loan l
    WHERE l.IsActive = 1
      AND l.MaturityDate IS NOT NULL
    GROUP BY YEAR(l.MaturityDate), DATEPART(quarter, l.MaturityDate)
    ORDER BY Year, Quarter
  `);
}

/**
 * Exposure by lender (bank).
 */
async function getLenderExposure() {
  return query(`
    SELECT
      ISNULL(b.BankName, 'Unknown') AS LenderName,
      COUNT(*)                       AS LoanCount,
      SUM(l.CurrentBalance)          AS TotalExposure
    FROM banking.Loan l
    LEFT JOIN core.Bank b ON b.BankId = l.LenderId
    WHERE l.IsActive = 1
    GROUP BY b.BankName
    ORDER BY TotalExposure DESC
  `);
}

/**
 * DSCR test summary from banking.Covenant.
 */
async function getDSCRSummary() {
  return query(`
    SELECT
      p.ProjectName,
      c.DSCRRequirement,
      c.ProjectedDSCR,
      c.DSCRTestDate,
      l.CurrentBalance
    FROM banking.Covenant c
    JOIN core.Project p ON p.ProjectId = c.ProjectId
    LEFT JOIN banking.Loan l ON l.LoanId = c.LoanId AND l.IsActive = 1
    WHERE c.DSCRRequirement IS NOT NULL
    ORDER BY c.ProjectedDSCR ASC
  `);
}

/**
 * LTC/LTV summary from loan + project data.
 */
async function getLTVSummary() {
  return query(`
    SELECT
      p.ProjectName,
      ISNULL(b.BankName, 'Unknown') AS LenderName,
      p.LTCOriginal                  AS LTC,
      l.CurrentBalance,
      p.ValuationWhenComplete,
      CASE
        WHEN p.ValuationWhenComplete > 0
        THEN CAST(l.CurrentBalance AS float) / p.ValuationWhenComplete
        ELSE NULL
      END AS LTV
    FROM banking.Loan l
    JOIN core.Project p ON p.ProjectId = l.ProjectId
    LEFT JOIN core.Bank b ON b.BankId = l.LenderId
    WHERE l.IsActive = 1
    ORDER BY LTV DESC
  `);
}

/**
 * Equity commitments aggregated per project.
 */
async function getEquityCommitments() {
  return query(`
    SELECT
      p.ProjectName,
      SUM(e.Amount)                                               AS TotalCommitment,
      SUM(CASE WHEN e.IsPaidOff = 1 THEN e.Amount ELSE 0 END)   AS FundedAmount,
      SUM(CASE WHEN ISNULL(e.IsPaidOff, 0) = 0 THEN e.Amount ELSE 0 END) AS UnfundedAmount
    FROM banking.EquityCommitment e
    JOIN core.Project p ON p.ProjectId = e.ProjectId
    GROUP BY p.ProjectId, p.ProjectName
    ORDER BY p.ProjectName
  `);
}

module.exports = {
  getOutstandingLoans,
  getMaturityWall,
  getLenderExposure,
  getDSCRSummary,
  getLTVSummary,
  getEquityCommitments,
};

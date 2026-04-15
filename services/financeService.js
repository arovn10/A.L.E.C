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
 * "Active portfolio" filter:
 *   - IsActive = 1
 *   - LoanClosingDate IS NOT NULL  (loan has formally closed — not just committed)
 *   - FinancingStage excludes Liquidated / Pre-Financing / Term Sheet
 *   - ProjectName excludes LLC entities (not counted as "deals" in portfolio)
 */
async function getOutstandingLoans() {
  return query(`
    SELECT
      p.ProjectName,
      b.BankName                                AS LenderName,
      l.LoanType,
      l.LoanCategory,
      l.LoanAmount                              AS OriginalAmount,
      l.InterestRate,
      l.MaturityDate,
      DATEDIFF(day, GETDATE(), l.MaturityDate)  AS DaysToMaturity,
      p.LTCOriginal                             AS LTC,
      l.FinancingStage,
      l.LoanPhase,
      -- Most recent covenant for this project
      cov.ProjectedDSCR,
      cov.DSCRRequirement,
      CASE
        WHEN cov.ProjectedDSCR IS NOT NULL AND cov.ProjectedDSCR < cov.DSCRRequirement THEN 'BREACH'
        WHEN cov.ProjectedDSCR IS NOT NULL AND cov.ProjectedDSCR >= cov.DSCRRequirement THEN 'OK'
        ELSE NULL
      END AS CovenantStatus
    FROM banking.Loan l
    JOIN core.Project p ON p.ProjectId = l.ProjectId
    LEFT JOIN core.Bank b ON b.BankId = l.LenderId
    OUTER APPLY (
      SELECT TOP 1 c.ProjectedDSCR, c.DSCRRequirement
      FROM banking.Covenant c
      WHERE c.ProjectId = l.ProjectId
        AND c.DSCRRequirement IS NOT NULL
      ORDER BY c.DSCRTestDate DESC
    ) cov
    WHERE l.IsActive = 1
      AND l.LoanClosingDate IS NOT NULL
      AND ISNULL(l.FinancingStage, '') NOT IN ('Liquidated', 'Pre-Financing', 'Term Sheet')
      AND p.ProjectName NOT LIKE '%LLC%'
    ORDER BY l.MaturityDate
  `);
}

/**
 * Maturity wall grouped by year and quarter.
 * Same active portfolio filter as getOutstandingLoans().
 */
async function getMaturityWall() {
  return query(`
    SELECT
      YEAR(l.MaturityDate)              AS Year,
      DATEPART(quarter, l.MaturityDate) AS Quarter,
      COUNT(*)                          AS LoanCount,
      SUM(l.LoanAmount)                 AS TotalBalance
    FROM banking.Loan l
    JOIN core.Project p ON p.ProjectId = l.ProjectId
    WHERE l.IsActive = 1
      AND l.LoanClosingDate IS NOT NULL
      AND ISNULL(l.FinancingStage, '') NOT IN ('Liquidated', 'Pre-Financing', 'Term Sheet')
      AND p.ProjectName NOT LIKE '%LLC%'
      AND l.MaturityDate IS NOT NULL
    GROUP BY YEAR(l.MaturityDate), DATEPART(quarter, l.MaturityDate)
    ORDER BY Year, Quarter
  `);
}

/**
 * Exposure by lender (bank).
 * Same active portfolio filter as getOutstandingLoans().
 */
async function getLenderExposure() {
  return query(`
    SELECT
      ISNULL(b.BankName, 'Unknown') AS LenderName,
      COUNT(*)                       AS LoanCount,
      SUM(l.LoanAmount)              AS TotalExposure
    FROM banking.Loan l
    JOIN core.Project p ON p.ProjectId = l.ProjectId
    LEFT JOIN core.Bank b ON b.BankId = l.LenderId
    WHERE l.IsActive = 1
      AND l.LoanClosingDate IS NOT NULL
      AND ISNULL(l.FinancingStage, '') NOT IN ('Liquidated', 'Pre-Financing', 'Term Sheet')
      AND p.ProjectName NOT LIKE '%LLC%'
    GROUP BY b.BankName
    ORDER BY TotalExposure DESC
  `);
}

/**
 * DSCR covenant summary — shows covenants that have actual DSCR readings
 * OR are upcoming tests within the next 18 months.
 * Ordered: breaches first, then passes, then upcoming by date.
 */
async function getDSCRSummary() {
  return query(`
    SELECT
      p.ProjectName,
      c.DSCRRequirement,
      c.ProjectedDSCR,
      c.DSCRTestDate,
      c.CovenantType,
      CASE
        WHEN c.ProjectedDSCR IS NOT NULL AND c.ProjectedDSCR < c.DSCRRequirement THEN 'Breach'
        WHEN c.ProjectedDSCR IS NOT NULL AND c.ProjectedDSCR >= c.DSCRRequirement THEN 'Pass'
        WHEN c.DSCRTestDate >= GETDATE() THEN 'Upcoming'
        ELSE 'No Data'
      END AS DSCRStatus
    FROM banking.Covenant c
    JOIN core.Project p ON p.ProjectId = c.ProjectId
    WHERE c.DSCRRequirement IS NOT NULL
      AND (
        c.ProjectedDSCR IS NOT NULL
        OR c.DSCRTestDate BETWEEN GETDATE() AND DATEADD(month, 18, GETDATE())
      )
    ORDER BY
      CASE
        WHEN c.ProjectedDSCR IS NOT NULL AND c.ProjectedDSCR < c.DSCRRequirement THEN 0
        WHEN c.ProjectedDSCR IS NOT NULL THEN 1
        ELSE 2
      END,
      c.DSCRTestDate ASC
  `);
}

/**
 * LTC/LTV summary from loan + project data.
 * LTV = LoanAmount / ValuationWhenComplete for active portfolio.
 */
async function getLTVSummary() {
  return query(`
    SELECT
      p.ProjectName,
      ISNULL(b.BankName, 'Unknown') AS LenderName,
      p.LTCOriginal                  AS LTC,
      l.LoanAmount                   AS CurrentBalance,
      p.ValuationWhenComplete,
      CASE
        WHEN p.ValuationWhenComplete > 0 AND l.LoanAmount > 0
        THEN CAST(l.LoanAmount AS float) / p.ValuationWhenComplete
        ELSE NULL
      END AS LTV
    FROM banking.Loan l
    JOIN core.Project p ON p.ProjectId = l.ProjectId
    LEFT JOIN core.Bank b ON b.BankId = l.LenderId
    WHERE l.IsActive = 1
      AND l.LoanClosingDate IS NOT NULL
      AND ISNULL(l.FinancingStage, '') NOT IN ('Liquidated', 'Pre-Financing', 'Term Sheet')
      AND p.ProjectName NOT LIKE '%LLC%'
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

/**
 * Project portfolio + deal pipeline.
 * Excludes noise (Rejected, Prospective, Identified, Dead, HoldCo, test rows).
 * Ordered by lifecycle priority so the UI can group without client-side sorting.
 */
async function getProjects() {
  return query(`
    SELECT
      p.ProjectId,
      p.ProjectName,
      p.City,
      p.State,
      p.Region,
      p.Units,
      p.ProductType,
      p.Stage,
      p.EstimatedConstructionStartDate,
      p.LTCOriginal,
      p.CostPerUnit,
      p.ValuationWhenComplete
    FROM core.Project p
    WHERE p.Stage IS NOT NULL
      AND p.Stage NOT IN (
        'Rejected','Prospective','Identified','Dead',
        'HoldCo','Commercial Land - Listed','Other'
      )
      AND p.ProjectName NOT LIKE '%TEST%'
    ORDER BY
      CASE p.Stage
        WHEN 'Under Construction' THEN 1
        WHEN 'Lease-Up'           THEN 2
        WHEN 'Stabilized'         THEN 3
        WHEN 'Under Contract'     THEN 4
        WHEN 'LOI'                THEN 5
        WHEN 'Under Review'       THEN 6
        WHEN 'Liquidated'         THEN 7
        WHEN 'Closed'             THEN 8
        ELSE 9
      END,
      p.ProjectName
  `);
}

/** Quick connectivity check — SELECT 1 with timing. */
async function ping() {
  const t0 = Date.now();
  const result = await query('SELECT 1 AS ok');
  const latencyMs = Date.now() - t0;
  if (result.error) return { ok: false, latencyMs, error: result.error };
  return { ok: true, latencyMs, source: result.source };
}

module.exports = {
  ping,
  getProjects,
  getOutstandingLoans,
  getMaturityWall,
  getLenderExposure,
  getDSCRSummary,
  getLTVSummary,
  getEquityCommitments,
};

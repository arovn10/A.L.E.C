import { apiFetch } from './client';

// ──────────────────────────────────────────────────────────
// Loan data — maps API columns → LoansTable field names
// ──────────────────────────────────────────────────────────
export const getLoans = () =>
  apiFetch('/finance/loans').then((r) =>
    (r.rows ?? []).map((row) => ({
      property:       row.ProjectName,
      lender:         row.LenderName,
      type:           row.LoanType,
      amount:         row.OriginalAmount,
      balance:        row.CurrentBalance,
      rate:           row.InterestRate,
      maturity:       row.MaturityDate,
      daysToMaturity: row.DaysToMaturity,
      ltv:            row.LTC != null ? row.LTC * 100 : null,
      dscr:           null,
      covenantStatus: null,
      guarantor:      null,
      lastUpdated:    null,
    }))
  );

// ──────────────────────────────────────────────────────────
// Maturity wall — maps to MaturityWallChart field names
// ──────────────────────────────────────────────────────────
export const getMaturityWall = () =>
  apiFetch('/finance/maturity').then((r) =>
    (r.rows ?? []).map((row) => ({
      quarter:        `${row.Year} Q${row.Quarter}`,
      balanceMillions: (row.TotalBalance ?? 0) / 1_000_000,
      loanCount:      row.LoanCount,
      daysToMaturity: 999, // chart coloring — no per-row days in this aggregated view
    }))
  );

// ──────────────────────────────────────────────────────────
// Lender exposure — maps to LenderExposureChart field names
// ──────────────────────────────────────────────────────────
export const getLenderExposure = () =>
  apiFetch('/finance/lenders').then((r) =>
    (r.rows ?? []).map((row) => ({
      lender:  row.LenderName ?? 'Unknown',
      balance: row.TotalExposure ?? 0,
      loans:   row.LoanCount,
    }))
  );

// ──────────────────────────────────────────────────────────
// DSCR — maps to DSCRTable field names
// ──────────────────────────────────────────────────────────
export const getDSCR = () =>
  apiFetch('/finance/dscr').then((r) =>
    (r.rows ?? []).map((row) => ({
      property:    row.ProjectName,
      dscr:        row.ProjectedDSCR,
      required:    row.DSCRRequirement,
      noi:         null,
      debtService: null,
      period:      row.DSCRTestDate,
    }))
  );

// ──────────────────────────────────────────────────────────
// LTV — maps to LTVTable field names
// ──────────────────────────────────────────────────────────
export const getLTV = () =>
  apiFetch('/finance/ltv').then((r) =>
    (r.rows ?? []).map((row) => ({
      property:       row.ProjectName,
      lender:         row.LenderName,
      ltv:            row.LTV != null ? row.LTV * 100 : null,
      ltc:            row.LTC != null ? row.LTC * 100 : null,
      appraisedValue: row.ValuationWhenComplete,
      loanBalance:    row.CurrentBalance,
      date:           null,
    }))
  );

// ──────────────────────────────────────────────────────────
// Equity — maps to EquityTable field names
// ──────────────────────────────────────────────────────────
export const getEquity = () =>
  apiFetch('/finance/equity').then((r) =>
    (r.rows ?? []).map((row) => ({
      project:         row.ProjectName,
      totalCommitment: row.TotalCommitment,
      funded:          row.FundedAmount,
      unfunded:        row.UnfundedAmount,
      pctFunded:       row.TotalCommitment > 0
        ? (row.FundedAmount / row.TotalCommitment) * 100
        : 0,
    }))
  );

// ──────────────────────────────────────────────────────────
// Report download — triggers Excel generation
// ──────────────────────────────────────────────────────────
export const downloadReport = (name) =>
  window.open(`/api/download/${encodeURIComponent(name)}`, '_blank');

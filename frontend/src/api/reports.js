import { apiFetch } from './client';

// mssql returns decimal/money/numeric columns as strings — coerce safely
const num = (v) => (v == null ? null : Number(v));

// ──────────────────────────────────────────────────────────
// Projects / Deal pipeline
// ──────────────────────────────────────────────────────────
export const getProjects = () =>
  apiFetch('/finance/projects').then((r) =>
    (r.rows ?? []).map((row) => ({
      id:            row.ProjectId,
      name:          row.ProjectName,
      city:          row.City,
      state:         row.State,
      region:        row.Region,
      units:         num(row.Units),
      productType:   row.ProductType,
      stage:         row.Stage,
      startDate:     row.EstimatedConstructionStartDate,
      ltc:           row.LTCOriginal != null ? num(row.LTCOriginal) * 100 : null,
      costPerUnit:   num(row.CostPerUnit),
      totalCost:     num(row.ValuationWhenComplete),
    }))
  );

// ──────────────────────────────────────────────────────────
// Loan data — maps API columns → LoansTable field names
// ──────────────────────────────────────────────────────────
export const getLoans = () =>
  apiFetch('/finance/loans').then((r) =>
    (r.rows ?? []).map((row) => ({
      property:       row.ProjectName,
      lender:         row.LenderName,
      type:           row.LoanType,
      amount:         num(row.OriginalAmount),
      balance:        num(row.OriginalAmount),
      rate:           row.InterestRate != null ? num(row.InterestRate) / 100 : null,
      maturity:       row.MaturityDate,
      daysToMaturity: num(row.DaysToMaturity),
      ltv:            row.LTC != null ? num(row.LTC) * 100 : null,
      dscr:           num(row.ProjectedDSCR),
      covenantStatus: row.CovenantStatus ?? null,
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
      quarter:         `${row.Year} Q${row.Quarter}`,
      balanceMillions: num(row.TotalBalance ?? 0) / 1_000_000,
      loanCount:       num(row.LoanCount),
      daysToMaturity:  999, // chart coloring — no per-row days in this aggregated view
    }))
  );

// ──────────────────────────────────────────────────────────
// Lender exposure — maps to LenderExposureChart field names
// ──────────────────────────────────────────────────────────
export const getLenderExposure = () =>
  apiFetch('/finance/lenders').then((r) =>
    (r.rows ?? []).map((row) => ({
      lender:  row.LenderName ?? 'Unknown',
      balance: num(row.TotalExposure) ?? 0,
      loans:   num(row.LoanCount),
    }))
  );

// ──────────────────────────────────────────────────────────
// DSCR — maps to DSCRTable field names
// ──────────────────────────────────────────────────────────
export const getDSCR = () =>
  apiFetch('/finance/dscr').then((r) =>
    (r.rows ?? []).map((row) => ({
      property:     row.ProjectName,
      dscr:         num(row.ProjectedDSCR),
      required:     num(row.DSCRRequirement),
      dscrStatus:   row.DSCRStatus,
      covenantType: row.CovenantType,
      noi:          null,
      debtService:  null,
      period:       row.DSCRTestDate,
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
      ltv:            row.LTV != null ? num(row.LTV) * 100 : null,
      ltc:            row.LTC != null ? num(row.LTC) * 100 : null,
      appraisedValue: num(row.ValuationWhenComplete),
      loanBalance:    num(row.CurrentBalance),
      date:           null,
    }))
  );

// ──────────────────────────────────────────────────────────
// Equity — maps to EquityTable field names
// ──────────────────────────────────────────────────────────
export const getEquity = () =>
  apiFetch('/finance/equity').then((r) =>
    (r.rows ?? []).map((row) => {
      const total = num(row.TotalCommitment) ?? 0;
      const funded = num(row.FundedAmount) ?? 0;
      const unfunded = num(row.UnfundedAmount) ?? 0;
      return {
        project:         row.ProjectName,
        totalCommitment: total,
        funded,
        unfunded,
        pctFunded:       total > 0 ? (funded / total) * 100 : 0,
      };
    })
  );

// ──────────────────────────────────────────────────────────
// Report download — triggers Excel generation
// ──────────────────────────────────────────────────────────
export const downloadReport = (name) =>
  window.open(`/api/download/${encodeURIComponent(name)}`, '_blank');

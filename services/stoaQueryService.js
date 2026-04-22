/**
 * A.L.E.C. STOA Query Service
 *
 * Retrieval-Augmented Generation (RAG) layer for the STOA Azure SQL database.
 * Intercepts property/leasing/deal questions in chat, pulls real data, and
 * returns a formatted context string for the LLM to reason from.
 *
 * This prevents hallucination by grounding the LLM in live database facts.
 *
 * Schemas used:
 *   leasing.MMRData           — weekly occupancy, leased %, rent by property
 *   leasing.PortfolioUnitDetails — unit-by-unit lease details
 *   leasing.DailyRenewalAnalytics — renewal tracking
 *   leasing.t12vsbudgetmonthly    — T-12 vs budget
 *   core.Project              — all projects (name, city, units, stage)
 *   banking.Loan              — loans & financing
 *   banking.Covenant          — covenant tracking
 *   pipeline.DealPipeline     — acquisition pipeline
 *   pipeline.UnderContract    — properties under contract
 *   contracts.Contract        — vendor/service contracts
 */

require('dotenv').config();
const sql = require('mssql');

const DB_CONFIG = {
  server:   process.env.STOA_DB_HOST,
  port:     parseInt(process.env.STOA_DB_PORT) || 1433,
  database: process.env.STOA_DB_NAME,
  user:     process.env.STOA_DB_USER,
  password: process.env.STOA_DB_PASSWORD,
  options:  { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
  requestTimeout:    25000,
  connectionTimeout: 15000,
  pool: { max: 5, min: 0, idleTimeoutMillis: 30000 },
};

// ── Singleton connection pool ─────────────────────────────────────
let _pool = null;
let _poolPromise = null;

async function getPool() {
  if (_pool && _pool.connected) return _pool;
  if (_poolPromise) return _poolPromise;
  _poolPromise = (async () => {
    const pool = new sql.ConnectionPool(DB_CONFIG);
    await pool.connect();
    pool.on('error', () => { _pool = null; _poolPromise = null; });
    _pool = pool;
    _poolPromise = null;
    return pool;
  })();
  return _poolPromise;
}

// Safe query wrapper — returns [] on failure so the LLM gets no bad data
async function query(sqlStr, inputs = {}) {
  try {
    const pool = await getPool();
    const req = pool.request();
    for (const [name, { type, value }] of Object.entries(inputs)) {
      req.input(name, type, value);
    }
    const result = await req.query(sqlStr);
    return result.recordset || [];
  } catch (err) {
    console.warn('[STOA] Query error:', err.message?.slice(0, 100));
    return [];
  }
}

// ── Pct formatter ─────────────────────────────────────────────────
const pct = (v) => v != null ? (v <= 1 ? (v * 100).toFixed(1) : Number(v).toFixed(1)) + '%' : 'N/A';
const dollar = (v) => v != null ? '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : 'N/A';
const num = (v) => v != null ? Number(v).toLocaleString('en-US') : 'N/A';
const date = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'N/A';

// ── Intent detection ──────────────────────────────────────────────
const INTENT_PATTERNS = {
  occupancy: /\b(occupanc|occupied|vacancy|vacant|leased?|lease.?up|fill|how.?full|how.?many.?(unit|tenant)|availab)\b/i,
  rent:      /\b(rent|rental.?rate|avg.?rent|average.?rent|revenue|income|per.?unit|psf|per.?sqft|budget.?(rent|income))\b/i,
  project:   /\b(project|property|propert(y|ies)|development|address|units?|beds?|stage|status|where.?is|located?)\b/i,
  pipeline:  /\b(pipeline|deal|acqui|under.?contract|prospect|identified|offer|loi|close[ds]?)\b/i,
  loan:      /\b(loans?|debt|financing|mortgage|lender|bank|maturity|refi|refinanc|ltc|ltv|balance|covenants?)\b/i,
  contract:  /\b(contracts?|vendors?|suppliers?|agreements?|expir\w*|renew\w*|services?)\b/i,
  renewal:   /\b(renewals?|renew\w*|retention|t-?12|notice.?to.?vacate|ntv|expir\w*)\b/i,
  portfolio: /\b(portfolio|all.?propert|overall|total|across.?all|summary|overview|how.?many)\b/i,
  trend:     /\b(trend|history|histor|over.?time|past.?\d|last.?\d|previous.?\d|month|quarter|year.?over.?year|yoy|ytd|growth|trajectory|progress|chart|graph|show.?me.?over|over.?the.?past)\b/i,
  export:    /\b(export|excel|spreadsheet|download|\.xlsx|csv|sheet|generate.?report|create.?report)\b/i,
};

/**
 * Detect STOA intent and extract a property name (if mentioned).
 * Returns { intents: string[], property: string|null }
 */
function detectStoaIntent(text) {
  const t = text.toLowerCase();

  // Must mention something real-estate related to be STOA.
  // Anchors include property brands, cities, and domain concepts (contracts,
  // leases, expirations, renewals, tenants, units) — STOA's Azure DB is the
  // authoritative source for all of these. Without this, questions like
  // "what contracts are expiring" fall through to TenantCloud hallucinations.
  const isStoaRelated =
    /\b(stoa|waters? at|heights? at|flats? at|hammond|covington|millerville|bluebonnet|settlers? trace|west village|redstone|crestview|freeport|promenade|mcgowin|picardy|waterpointe|crosspointe|ransley|bartlett|owa|robinwood|conway|covington|fayetteville|materra|inverness|property|properties|project|occupanc|leases?|leased|pipeline|deals?|loans?|covenants?|portfolio|acquisitions?|real estate|contracts?|expir|renewals?|tenants?|units?|vendors?|agreements?)\b/i.test(t);

  if (!isStoaRelated) return null;

  const intents = Object.entries(INTENT_PATTERNS)
    .filter(([, re]) => re.test(t))
    .map(([name]) => name);

  // Extract property name — look for "Waters at X", "Heights at X", "Flats at X"
  // or a city name after "the" / "at" / "in"
  let property = null;

  // Match "Waters at X" / "Heights at X".
  // Capture ONLY the first 1-2 alphanumeric tokens after "at" (the place name).
  // Verbs like "has", "is", "does" — and filler words — are never part of a
  // property name, so we stop at the first non-proper-noun boundary.
  const brandMatch = t.match(/(?:the\s+)?(waters? at|heights? at|flats? at)\s+([a-z]+(?:\s+[a-z]+)?)/i);
  if (brandMatch) {
    // Strip trailing common verbs/prepositions that leaked into the 2nd token.
    const STOP = /^(has|have|had|is|are|was|were|doing|does|did|been|being|the|a|an|of|in|on|for|to|how|what|why|tell|show|give|get|update|about)$/i;
    const tokens = brandMatch[2].trim().split(/\s+/).filter(w => !STOP.test(w));
    if (tokens.length > 0) {
      const place = tokens.slice(0, 2).join(' ');
      property = 'The ' + brandMatch[1].replace(/\b\w/g, c => c.toUpperCase())
        + ' ' + place.replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  // City fallback
  if (!property) {
    const cities = ['hammond', 'covington', 'millerville', 'bluebonnet', 'settlers trace', 'west village',
      'redstone', 'crestview', 'freeport', 'promenade', 'mcgowin', 'picardy', 'waterpointe',
      'crosspointe', 'ransley', 'bartlett', 'owa', 'robinwood', 'conway', 'fayetteville',
      'materra', 'inverness', 'lafayette', 'scott', 'gonzales', 'baton rouge', 'new orleans'];
    for (const city of cities) {
      if (t.includes(city)) { property = city; break; }
    }
  }

  // Extract "past N months" or "last N months" for trend queries
  const monthsMatch = t.match(/(?:past|last|previous|over\s+the\s+(?:last|past))\s+(\d+)\s+months?/i);
  const trendMonths = monthsMatch ? parseInt(monthsMatch[1]) : 6;

  // If we found a property but no specific intent, default to occupancy+project (most common ask)
  const finalIntents = intents.length > 0
    ? intents
    : property ? ['occupancy', 'project'] : [];

  return finalIntents.length > 0 || property ? { intents: finalIntents, property, trendMonths } : null;
}

// ── STOA query functions ───────────────────────────────────────────

/**
 * Find matching projects by fuzzy name or city.
 * If no search term is provided, returns the full active portfolio — Dashboard
 * and Portfolio tabs pass '' and expect every project back.
 */
async function findProjects(searchTerm) {
  if (!searchTerm) {
    return query(
      `SELECT TOP 500 ProjectId, ProjectName, City, State, Region, Units, Stage,
         Address, ProductType, FinancingStatus, ConstructionStatus
       FROM core.Project
       ORDER BY ProjectName`
    );
  }
  const term = `%${searchTerm}%`;
  return query(
    `SELECT TOP 50 ProjectId, ProjectName, City, State, Region, Units, Stage,
       Address, ProductType, FinancingStatus, ConstructionStatus
     FROM core.Project
     WHERE ProjectName LIKE @term OR City LIKE @term
     ORDER BY
       CASE WHEN ProjectName LIKE @term THEN 0 ELSE 1 END,
       ProjectName`,
    { term: { type: sql.NVarChar(256), value: term } }
  );
}

/**
 * Get latest MMR (occupancy/leasing) data for one or all properties.
 * Returns the most recent weekly snapshot per property.
 */
async function getMMRData(propertySearch = null) {
  let whereClause = '';
  const inputs = {};

  if (propertySearch) {
    whereClause = `AND (m.Property LIKE @prop OR m.Location LIKE @prop OR m.City LIKE @prop)`;
    inputs.prop = { type: sql.NVarChar(256), value: `%${propertySearch}%` };
  }

  // All columns below verified against INFORMATION_SCHEMA on leasing.MMRData.
  // DO NOT reintroduce bracketed/spaced variants — the canonical no-space
  // columns are the authoritative set; other variants are stale sync artifacts.
  return query(
    `SELECT m.Property, m.Location, m.TotalUnits,
       m.OccupancyPercent        AS OccupancyPct,
       m.CurrentLeasedPercent    AS LeasedPct,
       m.OccUnits                AS OccupiedUnits,
       m.OccupiedRent            AS AvgOccupiedRent,
       m.BudgetedRent,
       m.BudgetedOccupancyPercentCurrentMonth AS BudgetedOccPct,
       m.BudgetedOccupancyCurrentMonth        AS BudgetedOccUnits,
       m.T12LeasesRenewed AS T12Renewed,
       m.T12LeasesExpired AS T12Expired,
       m.Delinquent,
       m.MI AS MoveIns, m.MO AS MoveOuts,
       m.Week3EndDate, m.Week3OccPercent AS Week3Occ,
       m.Week4EndDate, m.Week4OccPercent AS Week4Occ,
       m.Week7EndDate, m.Week7OccPercent AS Week7Occ,
       m.Status, m.FinancingStatus,
       m.City, m.State, m.Region, m.ReportDate
     FROM leasing.MMRData m
     INNER JOIN (
       SELECT Property, MAX(ReportDate) AS MaxDate
       FROM leasing.MMRData GROUP BY Property
     ) latest ON m.Property = latest.Property AND m.ReportDate = latest.MaxDate
     WHERE 1=1 ${whereClause}
     ORDER BY m.Property`,
    inputs
  );
}

/**
 * Get portfolio-level KPIs across all active properties.
 */
async function getPortfolioSummary() {
  return query(
    `SELECT
       COUNT(DISTINCT m.Property) AS PropertyCount,
       SUM(m.TotalUnits)             AS TotalUnits,
       SUM(m.OccUnits)               AS TotalOccupied,
       AVG(m.OccupancyPercent)       AS AvgOccupancyPct,
       AVG(m.CurrentLeasedPercent)   AS AvgLeasedPct,
       AVG(m.OccupiedRent)           AS AvgRent,
       AVG(m.BudgetedRent)           AS AvgBudgetedRent,
       SUM(m.Delinquent)             AS TotalDelinquent
     FROM leasing.MMRData m
     INNER JOIN (
       SELECT Property, MAX(ReportDate) AS MaxDate
       FROM leasing.MMRData GROUP BY Property
     ) latest ON m.Property = latest.Property AND m.ReportDate = latest.MaxDate`
  );
}

/**
 * Get unit-by-unit detail for a specific property.
 */
async function getUnitDetails(propertySearch) {
  const rows = await query(
    `SELECT Property, [Unit #] AS Unit, FloorPlan, UnitLeaseStatus,
       LeaseStart, LeaseEnd, LeaseType, MarketRent, LeaseRent,
       EffectiveRent, DaysVacant, SQFT, ReportDate
     FROM leasing.PortfolioUnitDetails
     WHERE Property LIKE @prop AND ReportDate = (
       SELECT MAX(ReportDate) FROM leasing.PortfolioUnitDetails WHERE Property LIKE @prop
     )
     ORDER BY FloorPlan, [Unit #]`,
    { prop: { type: sql.NVarChar(256), value: `%${propertySearch}%` } }
  );

  // Aggregate by status
  const summary = { total: rows.length, occupied: 0, vacant: 0, ntv: 0, floorPlans: {} };
  for (const r of rows) {
    const status = (r.UnitLeaseStatus || '').toLowerCase();
    if (status.includes('occupied') || status === 'current') summary.occupied++;
    else if (status.includes('vacant')) summary.vacant++;
    else if (status.includes('ntv') || status.includes('notice')) summary.ntv++;

    if (!summary.floorPlans[r.FloorPlan]) summary.floorPlans[r.FloorPlan] = { count: 0, avgRent: 0, rents: [] };
    summary.floorPlans[r.FloorPlan].count++;
    if (r.LeaseRent) summary.floorPlans[r.FloorPlan].rents.push(r.LeaseRent);
  }
  for (const fp of Object.values(summary.floorPlans)) {
    fp.avgRent = fp.rents.length ? fp.rents.reduce((a, b) => a + b, 0) / fp.rents.length : 0;
    delete fp.rents;
  }
  return { rows: rows.slice(0, 20), summary }; // first 20 units + aggregates
}

/**
 * Get renewal analytics for a property.
 */
async function getRenewalData(propertySearch) {
  return query(
    `SELECT TOP 1 Property, ReportDate,
       Expiring30, Expiring60, Expiring90,
       RenewalsComingUp30, RenewalsComingUp60, RenewalsComingUp90,
       PriorMonthExpired, PriorMonthRenewed, PriorMonthNotRenewed,
       PriorMonthConversionPct, ForecastedRenewals90
     FROM leasing.DailyRenewalAnalytics
     WHERE Property LIKE @prop
     ORDER BY ReportDate DESC`,
    { prop: { type: sql.NVarChar(256), value: `%${propertySearch}%` } }
  );
}

/**
 * Get active loans for a property or all properties.
 */
async function getLoans(propertySearch = null) {
  const where = propertySearch ? `AND (p.ProjectName LIKE @prop OR p.City LIKE @prop)` : '';
  const inputs = propertySearch
    ? { prop: { type: sql.NVarChar(256), value: `%${propertySearch}%` } }
    : {};

  // All columns verified against banking.Loan / core.Bank / core.Project.
  // banking.Loan has no Status/LenderName/OutstandingDate — we JOIN core.Bank
  // for the lender name and use IsActive for the active-loan filter.
  return query(
    `SELECT TOP 200
       l.LoanId,
       p.ProjectName,
       b.BankName                 AS LenderName,
       l.LoanType,
       l.LoanAmount               AS OriginalAmount,
       l.CurrentBalance,
       l.InterestRate,
       l.MaturityDate,
       l.LoanClosingDate          AS OriginationDate,
       l.FinancingStage           AS Status,
       CASE WHEN l.MaturityDate IS NOT NULL
            THEN DATEDIFF(DAY, SYSUTCDATETIME(), l.MaturityDate)
            ELSE NULL END         AS DaysToMaturity
     FROM banking.Loan l
     LEFT JOIN core.Project p ON p.ProjectId = l.ProjectId
     LEFT JOIN core.Bank    b ON b.BankId    = l.LenderId
     WHERE l.IsActive = 1  ${where}
     ORDER BY l.MaturityDate`,
    inputs
  );
}

/**
 * Get deals in the acquisition pipeline.
 */
async function getPipelineDeals(statusFilter = null) {
  const where = statusFilter ? `WHERE d.Stage LIKE @stage` : '';
  const inputs = statusFilter
    ? { stage: { type: sql.NVarChar(100), value: `%${statusFilter}%` } }
    : {};

  // pipeline.DealPipeline stores UnitCount, LandPrice, ClosingDate, etc.
  // Deal "name" lives on core.Project via ProjectId. We synthesize the
  // surfaces the frontend expects (DealName, Units, AskingPrice, EstimatedCloseDate).
  return query(
    `SELECT TOP 200
       d.DealPipelineId,
       p.ProjectName       AS DealName,
       p.City, p.State, p.Region, p.ProductType,
       d.UnitCount         AS Units,
       d.ListingStatus     AS Stage,
       d.LandPrice         AS AskingPrice,
       COALESCE(d.ClosingDate, d.ExecutionDate) AS EstimatedCloseDate,
       d.CreatedAt
     FROM pipeline.DealPipeline d
     LEFT JOIN core.Project p ON p.ProjectId = d.ProjectId
     ${where}
     ORDER BY d.CreatedAt DESC`,
    inputs
  );
}

/**
 * Get weekly MMR history for a property over the past N months.
 * Returns rows ordered oldest→newest so the LLM can read trends left-to-right.
 * Uses leasing.MMRData which has weekly snapshots going back to Jan 2023.
 */
async function getMMRHistory(propertySearch, months = 6) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  return query(
    `SELECT m.Property, m.ReportDate,
       m.OccupancyPercent       AS OccupancyPct,
       m.CurrentLeasedPercent   AS LeasedPct,
       m.OccUnits               AS OccupiedUnits,
       m.TotalUnits,
       m.OccupiedRent           AS AvgRent,
       m.BudgetedRent,
       m.MI AS MoveIns,
       m.MO AS MoveOuts,
       m.Delinquent
     FROM leasing.MMRData m
     WHERE (m.Property LIKE @prop OR m.Location LIKE @prop OR m.City LIKE @prop)
       AND m.ReportDate >= @cutoff
     ORDER BY m.ReportDate ASC`,
    {
      prop:   { type: sql.NVarChar(256), value: `%${propertySearch}%` },
      cutoff: { type: sql.Date,          value: cutoffStr },
    }
  );
}

/**
 * Get pre-computed rent growth percentages from leasing.HistoricalRentGrowth.
 * Columns: ReportDate, Property, LatestRent, Rent3Mo, Rent6Mo, Rent12Mo,
 *          RentGrowth3MoPct, RentGrowth6MoPct, RentGrowth12MoPct, RentGrowthAllTimePct
 */
async function getRentGrowthHistory(propertySearch) {
  return query(
    `SELECT TOP 1 Property, LatestDate, LatestRent,
       Rent3Mo, Rent6Mo, Rent12Mo, RentAllTime,
       RentGrowth3MoPct, RentGrowth6MoPct, RentGrowth12MoPct, RentGrowthAllTimePct,
       ComputedAt
     FROM leasing.HistoricalRentGrowth
     WHERE Property LIKE @prop
     ORDER BY ComputedAt DESC`,
    { prop: { type: sql.NVarChar(256), value: `%${propertySearch}%` } }
  );
}

/**
 * Get portfolio-wide rent growth trends.
 */
async function getPortfolioRentGrowth() {
  return query(
    `SELECT Property, LatestRent, Rent3Mo, Rent6Mo, Rent12Mo,
       RentGrowth3MoPct, RentGrowth6MoPct, RentGrowth12MoPct, RentGrowthAllTimePct
     FROM leasing.HistoricalRentGrowth
     WHERE ComputedAt = (SELECT MAX(ComputedAt) FROM leasing.HistoricalRentGrowth)
     ORDER BY RentGrowth6MoPct DESC`
  );
}

/**
 * Get contracts expiring soon.
 */
async function getExpiringContracts(daysAhead = 90) {
  return query(
    `SELECT TOP 20 ContractName, VendorName, PropertyName,
       StartDate, EndDate, ContractValue, Status, Category
     FROM contracts.Contract
     WHERE EndDate BETWEEN GETDATE() AND DATEADD(day, @days, GETDATE())
       AND Status NOT IN ('Cancelled','Terminated')
     ORDER BY EndDate`,
    { days: { type: sql.Int, value: daysAhead } }
  );
}

// ── Context builder ────────────────────────────────────────────────

/**
 * Build a formatted context string from STOA data to inject into the LLM prompt.
 * The LLM will receive real database facts instead of guessing.
 */
async function buildStoaContext(userMessage) {
  const detected = detectStoaIntent(userMessage);
  if (!detected) return null;

  const { intents, property, trendMonths = 6 } = detected;
  const sections = [];

  // ── Property occupancy & leasing ─────────────────────────────
  if (intents.includes('occupancy') || intents.includes('rent') || intents.includes('renewal') || property) {
    const mmrRows = await getMMRData(property);

    if (mmrRows.length > 0) {
      sections.push(`## Live Leasing & Occupancy Data (as of ${date(mmrRows[0].ReportDate)})\n`);
      for (const r of mmrRows) {
        const renewalRate = r.T12Expired > 0
          ? ((r.T12Renewed / r.T12Expired) * 100).toFixed(1) + '%'
          : 'N/A';
        const rentVsBudget = r.BudgetedRent && r.AvgOccupiedRent
          ? (((r.AvgOccupiedRent - r.BudgetedRent) / r.BudgetedRent) * 100).toFixed(1) + '%'
          : null;

        sections.push(
          `**${r.Property}** (${r.Location || ''})
- Occupancy: ${pct(r.OccupancyPct)} occupied (${num(r.OccupiedUnits)}/${num(r.TotalUnits)} units) | Budget: ${pct(r.BudgetedOccPct)} → Delta: ${r.OccupiedUnits != null && r.BudgetedOccUnits != null ? (r.OccupiedUnits - r.BudgetedOccUnits) + ' units' : 'N/A'}
- Leased: ${pct(r.LeasedPct)}
- Avg Occupied Rent: ${dollar(r.AvgOccupiedRent)} | Budgeted: ${dollar(r.BudgetedRent)}${rentVsBudget ? ' | Variance: ' + rentVsBudget : ''}
- Move-ins (week): ${r.MoveIns ?? 'N/A'} | Move-outs: ${r.MoveOuts ?? 'N/A'} | Delinquent: ${r.Delinquent ?? 'N/A'}
- T-12 Renewal Rate: ${renewalRate} (${num(r.T12Renewed)} renewed / ${num(r.T12Expired)} expired)
- Status: ${r.Status || 'N/A'} | Financing: ${r.FinancingStatus || 'N/A'} | Region: ${r.Region || 'N/A'}
`
        );
      }
    }

    // Renewal detail
    if (property && (intents.includes('renewal') || intents.includes('occupancy'))) {
      const renewal = await getRenewalData(property);
      if (renewal.length > 0) {
        const r = renewal[0];
        const convRate = r.PriorMonthConversionPct != null
          ? (r.PriorMonthConversionPct * 100).toFixed(1) + '%'
          : 'N/A';
        sections.push(
          `**Renewal Analytics (${r.Property}):**
- Expiring next 30/60/90 days: ${r.Expiring30}/${r.Expiring60}/${r.Expiring90}
- Renewals committed 30/60/90 days: ${r.RenewalsComingUp30}/${r.RenewalsComingUp60}/${r.RenewalsComingUp90}
- Prior month: ${r.PriorMonthRenewed} renewed / ${r.PriorMonthExpired} expired (${convRate} conversion) | ${r.PriorMonthNotRenewed} not renewed
- Forecasted renewals next 90 days: ${r.ForecastedRenewals90 ?? 'N/A'}
`
        );
      }
    }
  }

  // ── Project info ─────────────────────────────────────────────
  if (intents.includes('project') || property) {
    const projects = await findProjects(property || '');
    if (projects.length > 0) {
      sections.push(`## Project Details\n`);
      for (const p of projects.slice(0, 5)) {
        sections.push(
          `**${p.ProjectName}** — ${p.City}, ${p.State}
- Units: ${p.Units ?? 'TBD'} | Stage: ${p.Stage || 'N/A'} | Type: ${p.ProductType || 'N/A'}
- Address: ${p.Address || 'N/A'} | Region: ${p.Region || 'N/A'}
- Construction: ${p.ConstructionStatus || 'N/A'} | Financing: ${p.FinancingStatus || 'N/A'}
`
        );
      }
    }
  }

  // ── Trend / Historical data ───────────────────────────────────
  if (intents.includes('trend')) {
    if (property) {
      // Weekly occupancy trend for the property
      const history = await getMMRHistory(property, trendMonths);
      if (history.length > 0) {
        sections.push(`## Occupancy & Rent Trend — ${history[0].Property} (Past ${trendMonths} Months)\n`);

        // Build ASCII table: Date | Occ% | Leased% | Avg Rent | Move-ins | Move-outs
        const header = '| Week Ending   | Occupancy | Leased  | Avg Rent | Move-ins | Move-outs | Delinquent |';
        const divider = '|---------------|-----------|---------|----------|----------|-----------|------------|';
        const rows = history.map(r => {
          const d = r.ReportDate ? new Date(r.ReportDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : 'N/A';
          return `| ${d.padEnd(13)} | ${pct(r.OccupancyPct).padEnd(9)} | ${pct(r.LeasedPct).padEnd(7)} | ${dollar(r.AvgRent).padEnd(8)} | ${String(r.MoveIns ?? '-').padEnd(8)} | ${String(r.MoveOuts ?? '-').padEnd(9)} | ${String(r.Delinquent ?? '-').padEnd(10)} |`;
        });

        // Summarize trend direction
        const first = history[0];
        const last  = history[history.length - 1];
        const occDelta = first.OccupancyPct && last.OccupancyPct
          ? (((last.OccupancyPct - first.OccupancyPct) / first.OccupancyPct) * 100).toFixed(1)
          : null;
        const rentDelta = first.AvgRent && last.AvgRent
          ? (last.AvgRent - first.AvgRent).toFixed(0)
          : null;

        sections.push([header, divider, ...rows].join('\n'));
        sections.push('');

        if (occDelta !== null) {
          const occDir = Number(occDelta) > 0 ? '▲' : Number(occDelta) < 0 ? '▼' : '→';
          sections.push(`**Trend Summary (${date(first.ReportDate)} → ${date(last.ReportDate)}):**`);
          sections.push(`- Occupancy: ${occDir} ${Math.abs(occDelta)}% ${Number(occDelta) >= 0 ? 'increase' : 'decrease'} over the period`);
          if (rentDelta !== null) {
            const rentDir = Number(rentDelta) > 0 ? '▲' : Number(rentDelta) < 0 ? '▼' : '→';
            sections.push(`- Avg rent: ${rentDir} ${dollar(Math.abs(Number(rentDelta)))} change (${dollar(first.AvgRent)} → ${dollar(last.AvgRent)})`);
          }
          sections.push('');
        }

        // Anomaly detection — flag statistical outliers in the data
        const anomalies = [];
        const delinquents = history.map(r => r.Delinquent).filter(v => v != null);
        if (delinquents.length > 2) {
          const avgDelinquent = delinquents.reduce((a, b) => a + b, 0) / delinquents.length;
          const maxDelinquent = Math.max(...delinquents);
          if (maxDelinquent > avgDelinquent * 3 && maxDelinquent > 20) {
            const peakRow = history.find(r => r.Delinquent === maxDelinquent);
            anomalies.push(`⚠️ **Delinquency spike**: ${maxDelinquent} on ${date(peakRow?.ReportDate)} (avg: ${avgDelinquent.toFixed(0)}) — this looks like a data anomaly, not an operational issue, but worth verifying`);
          }
        }
        const occs = history.map(r => r.OccupancyPct).filter(v => v != null);
        if (occs.length > 2) {
          const minOcc = Math.min(...occs);
          const maxOcc = Math.max(...occs);
          if ((maxOcc - minOcc) * 100 > 5) {
            anomalies.push(`⚠️ **Occupancy swing**: ${pct(minOcc)} min → ${pct(maxOcc)} max (${((maxOcc - minOcc) * 100).toFixed(1)}pp range over ${trendMonths} months)`);
          }
        }
        if (anomalies.length > 0) {
          sections.push(`**Data Flags & Anomalies:**`);
          sections.push(anomalies.join('\n'));
          sections.push('');
        }
      }

      // Rent growth percentages
      // NOTE: RentGrowthXxxPct columns are ALREADY in percentage points (e.g. -4.83 = -4.83%), NOT decimals.
      const rentGrowth = await getRentGrowthHistory(property);
      if (rentGrowth.length > 0) {
        const rg = rentGrowth[0];
        const fmtG = (v) => v != null ? (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(1) + '%' : 'N/A';
        sections.push(
          `**Rent Growth — ${rg.Property}:**
- Current rent: ${dollar(rg.LatestRent)} | 3-mo ago: ${dollar(rg.Rent3Mo)} | 6-mo ago: ${dollar(rg.Rent6Mo)} | 12-mo ago: ${dollar(rg.Rent12Mo)}
- Growth rates: 3-mo: ${fmtG(rg.RentGrowth3MoPct)} | 6-mo: ${fmtG(rg.RentGrowth6MoPct)} | 12-mo: ${fmtG(rg.RentGrowth12MoPct)} | All-time: ${fmtG(rg.RentGrowthAllTimePct)}
`
        );
      }
    } else {
      // Portfolio-wide rent growth rankings
      const pgrowth = await getPortfolioRentGrowth();
      if (pgrowth.length > 0) {
        // RentGrowthXxxPct is already in % points — do NOT multiply by 100
        const fmtG = (v) => v != null ? (Number(v) >= 0 ? '+' : '') + Number(v).toFixed(1) + '%' : 'N/A';
        sections.push(`## Portfolio Rent Growth Rankings\n`);
        sections.push('| Property | Current Rent | 3-Mo | 6-Mo | 12-Mo |');
        sections.push('|----------|-------------|------|------|-------|');
        for (const rg of pgrowth) {
          sections.push(`| ${rg.Property} | ${dollar(rg.LatestRent)} | ${fmtG(rg.RentGrowth3MoPct)} | ${fmtG(rg.RentGrowth6MoPct)} | ${fmtG(rg.RentGrowth12MoPct)} |`);
        }
        sections.push('');
      }
    }
  }

  // ── Portfolio overview ────────────────────────────────────────
  if (intents.includes('portfolio') && !property) {
    const [summary] = await getPortfolioSummary();
    if (summary) {
      const renewalRate = summary.TotalOccupied > 0 ? null : null; // computed elsewhere
      sections.push(
        `## Portfolio Summary (All Active Properties)
- Properties tracked: ${summary.PropertyCount}
- Total units: ${num(summary.TotalUnits)} | Occupied: ${num(summary.TotalOccupied)}
- Avg occupancy: ${pct(summary.AvgOccupancyPct)} | Avg leased: ${pct(summary.AvgLeasedPct)}
- Avg occupied rent: ${dollar(summary.AvgRent)} | Avg budgeted rent: ${dollar(summary.AvgBudgetedRent)}
- Total delinquent units: ${num(summary.TotalDelinquent)}
`
      );

      // Add per-property breakdown
      const allMMR = await getMMRData();
      if (allMMR.length > 0) {
        sections.push(`### Per-Property Breakdown:\n`);
        sections.push(
          allMMR.map(r =>
            `- **${r.Property}**: ${pct(r.OccupancyPct)} occ | ${pct(r.LeasedPct)} leased | ${dollar(r.AvgOccupiedRent)}/unit | ${r.Status || ''}`
          ).join('\n')
        );
        sections.push('');
      }
    }
  }

  // ── Loan / Banking ─────────────────────────────────────────
  if (intents.includes('loan')) {
    const loans = await getLoans(property);
    if (loans.length > 0) {
      sections.push(`## Loan Data\n`);
      for (const l of loans.slice(0, 8)) {
        sections.push(
          `**${l.ProjectName || 'Unknown'}** — ${l.LoanType || 'Loan'} (${l.LenderName || 'N/A'})
- Amount: ${dollar(l.LoanAmount)} | Balance: ${dollar(l.OutstandingBalance)}
- Rate: ${l.InterestRate != null ? (l.InterestRate * 100).toFixed(2) + '%' : 'N/A'} | Maturity: ${date(l.MaturityDate)} | Status: ${l.Status || 'Active'}
`
        );
      }
    }
  }

  // ── Pipeline ─────────────────────────────────────────────────
  if (intents.includes('pipeline')) {
    const deals = await getPipelineDeals();
    if (deals.length > 0) {
      sections.push(`## Acquisition Pipeline (Active Deals)\n`);
      sections.push(
        deals.slice(0, 10).map(d =>
          `- **${d.DealName}** (${d.City}, ${d.State}) — ${d.Units ?? '?'} units | Stage: ${d.Stage} | Est Close: ${date(d.EstimatedCloseDate)}`
        ).join('\n')
      );
      sections.push('');
    }
  }

  // ── Contracts ────────────────────────────────────────────────
  if (intents.includes('contract')) {
    const contracts = await getExpiringContracts(90);
    if (contracts.length > 0) {
      sections.push(`## Contracts Expiring Next 90 Days\n`);
      sections.push(
        contracts.slice(0, 8).map(c =>
          `- **${c.ContractName}** | ${c.VendorName} | ${c.PropertyName || 'Portfolio'} | Expires: ${date(c.EndDate)} | Value: ${dollar(c.ContractValue)}`
        ).join('\n')
      );
      sections.push('');
    }
  }

  if (sections.length === 0) return null;

  return [
    '## STOA Real Estate Database — Live Data',
    `*Retrieved: ${new Date().toLocaleString('en-US')}. Use ONLY the numbers below — do not invent or estimate any figures.*`,
    '',
    ...sections,
    '---',
    `## Analysis Instructions
Use ONLY the data above. Be specific with numbers. If something is not in the data, say so honestly.

When answering:
1. **Lead with the key metric** — state the current occupancy/rent clearly upfront
2. **Flag anomalies** — highlight anything unusual (e.g., delinquent count spike, occupancy drop >3%, rent far below budget). Use ⚠️ for concerns, ✅ for positives.
3. **Identify trends** — if trend data is present, note the direction (improving/declining/stable), the rate of change, and whether it's concerning
4. **Benchmark against budget** — compare actuals to budgeted occupancy and rent, quantify the gap
5. **Be concise and actionable** — finish with 1-2 sentences on what management should watch or do
6. **Use markdown formatting** — headers for sections, bold for key numbers, bullet points for lists

Rent growth % values are already in percentage points (e.g., -4.83 means -4.83% — do not multiply by 100).`,
  ].join('\n');
}

/**
 * Status check — confirms DB is reachable.
 */
async function ping() {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    return { connected: true };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────
// DSCR covenants — banking.Covenant holds projected DSCR vs requirement
// per project. Status derived from projected vs required ratio.
async function getDSCRCovenants() {
  return query(
    `SELECT p.ProjectName,
            c.ProjectedDSCR,
            c.DSCRRequirement,
            c.DSCRTestDate,
            c.CovenantType,
            CASE
              WHEN c.ProjectedDSCR IS NULL OR c.DSCRRequirement IS NULL THEN NULL
              WHEN c.ProjectedDSCR >= c.DSCRRequirement THEN 'Pass'
              ELSE 'Fail'
            END AS DSCRStatus
       FROM banking.Covenant c
       INNER JOIN core.Project p ON p.ProjectId = c.ProjectId
      WHERE c.ProjectedDSCR IS NOT NULL OR c.DSCRRequirement IS NOT NULL
      ORDER BY p.ProjectName`
  );
}

// ──────────────────────────────────────────────────────────────────────
// LTV rows — banking.Loan joined with core.Project's appraisal/cost.
// LTV = balance / appraised value (ValuationWhenComplete)
// LTC = stored on core.Project as LTCOriginal (loan-to-cost at origination).
async function getLTVRows() {
  const rows = await query(
    `SELECT p.ProjectName,
            b.BankName AS LenderName,
            l.CurrentBalance,
            l.LoanAmount                     AS OriginalAmount,
            p.ValuationWhenComplete,
            p.LTCOriginal
       FROM banking.Loan l
       INNER JOIN core.Project p ON p.ProjectId = l.ProjectId
       LEFT  JOIN core.Bank    b ON b.BankId    = l.LenderId
      WHERE l.IsActive = 1
      ORDER BY p.ProjectName`
  );
  return rows.map(r => {
    const balance = Number(r.CurrentBalance ?? r.OriginalAmount ?? 0);
    const value   = Number(r.ValuationWhenComplete ?? 0);
    const ltv = value > 0 && balance > 0 ? balance / value : null;
    return {
      ProjectName:          r.ProjectName,
      LenderName:           r.LenderName,
      LTV:                  ltv,
      LTC:                  r.LTCOriginal != null ? Number(r.LTCOriginal) : null,
      ValuationWhenComplete: r.ValuationWhenComplete != null ? Number(r.ValuationWhenComplete) : null,
      CurrentBalance:       balance || null,
    };
  });
}

// ──────────────────────────────────────────────────────────────────────
// Equity commitments — aggregated per project. "Funded" = commitments with
// a FundingDate on or before today (or explicitly paid off); the rest are
// unfunded / undrawn.
async function getEquityCommitments() {
  const rows = await query(
    `SELECT p.ProjectName,
            e.Amount,
            e.FundingDate,
            e.IsPaidOff
       FROM banking.EquityCommitment e
       INNER JOIN core.Project p ON p.ProjectId = e.ProjectId
      WHERE e.Amount IS NOT NULL`
  );
  const today = Date.now();
  const byProject = new Map();
  for (const r of rows) {
    const key = r.ProjectName || 'Unknown';
    const agg = byProject.get(key) || { ProjectName: key, TotalCommitment: 0, FundedAmount: 0, UnfundedAmount: 0 };
    const amt = Number(r.Amount) || 0;
    agg.TotalCommitment += amt;
    const funded = r.IsPaidOff === true || r.IsPaidOff === 1 ||
      (r.FundingDate && new Date(r.FundingDate).getTime() <= today);
    if (funded) agg.FundedAmount += amt;
    else        agg.UnfundedAmount += amt;
    byProject.set(key, agg);
  }
  return Array.from(byProject.values()).sort((a, b) => b.TotalCommitment - a.TotalCommitment);
}

module.exports = {
  detectStoaIntent,
  buildStoaContext,
  getMMRData,
  getMMRHistory,
  getRentGrowthHistory,
  getPortfolioRentGrowth,
  getPortfolioSummary,
  findProjects,
  getUnitDetails,
  getRenewalData,
  getLoans,
  getPipelineDeals,
  getDSCRCovenants,
  getLTVRows,
  getEquityCommitments,
  getExpiringContracts,
  ping,
};

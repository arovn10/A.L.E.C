/**
 * backend/auth/domo.js — Sprint 2
 *
 * Domo embed-JWT minter + dashboard catalog helpers.
 *
 * Responsibilities:
 *   - Mint short-lived Domo "Programmatic Filters Embed" JWTs for the
 *     logged-in user, scoped only to dashboards the user has access to
 *     (via alec.UserScopes where Type='domo_dashboard').
 *   - Keep a catalog of Domo dashboards in alec.Connectors rows (kind='domo').
 *     Admins can sync the catalog; the Admin People UI uses it as the
 *     invite-time dashboard picker.
 *
 * Token format: HS256 Domo embed tokens signed with DOMO_EMBED_SECRET.
 * Domo docs: https://developer.domo.com/docs/embed/embed-tokens
 */
'use strict';

const crypto = require('crypto');

const ISSUER = 'alec-stoa';
const DEFAULT_TTL_SEC = 60 * 5; // 5-minute embed tokens

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Mint a Domo embed JWT for a specific dashboard + user.
 *
 * Caller must pre-verify the user holds the `domo_dashboard:<dashboardId>` or
 * `*` scope. This function does not re-check — it just signs.
 */
function mintEmbedToken({ embedId, userEmail, filters = [], ttlSec = DEFAULT_TTL_SEC }) {
  const secret = process.env.DOMO_EMBED_SECRET;
  if (!secret) throw new Error('DOMO_EMBED_SECRET not set');
  if (!embedId)  throw new Error('embedId required');
  if (!userEmail) throw new Error('userEmail required');

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: ISSUER,
    sub: userEmail,
    aud: 'domo-embed',
    embedId,
    filters: Array.isArray(filters) ? filters : [],
    iat: now,
    exp: now + Math.max(60, Math.min(ttlSec, 60 * 60)), // clamp 60s–60min
  };
  const header = { alg: 'HS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = crypto.createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64url(sig)}`;
}

/**
 * List dashboards the user can embed. Pulled from alec.Connectors rows of
 * kind='domo_dashboard' joined against alec.UserScopes.
 */
async function ensureDashboardCatalog(pool) {
  // Lazy-create the catalog table — separate from alec.Connectors which is
  // per-user OAuth tokens. This one is admin-curated.
  try {
    await pool.request().batch(`
      IF OBJECT_ID('alec.DomoDashboards','U') IS NULL
      CREATE TABLE alec.DomoDashboards (
        DashboardId UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        Name        NVARCHAR(200) NOT NULL,
        EmbedId     NVARCHAR(128) NOT NULL,
        Description NVARCHAR(400) NULL,
        Enabled     BIT NOT NULL DEFAULT 1,
        CreatedAt   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    `);
  } catch (_) { /* best-effort — may already exist */ }
}

async function listUserDashboards(pool, userId, isMasterOrAdmin) {
  await ensureDashboardCatalog(pool);
  const q = isMasterOrAdmin
    ? `SELECT DashboardId, Name, EmbedId, Description FROM alec.DomoDashboards WHERE Enabled=1`
    : `SELECT d.DashboardId, d.Name, d.EmbedId, d.Description
         FROM alec.DomoDashboards d
         JOIN alec.UserScopes s
           ON s.Type='domo_dashboard'
          AND (s.Value='*' OR s.Value=CONVERT(NVARCHAR(64), d.DashboardId))
        WHERE d.Enabled=1 AND s.UserId=@uid`;
  const req = pool.request();
  if (!isMasterOrAdmin) req.input('uid', userId);
  const r = await req.query(q);
  return (r.recordset || []).map(row => ({
    id: row.DashboardId,
    name: row.Name,
    embedId: row.EmbedId,
    description: row.Description,
  }));
}

async function getDashboard(pool, dashboardId) {
  await ensureDashboardCatalog(pool);
  const r = await pool.request().input('id', dashboardId)
    .query(`SELECT DashboardId, Name, EmbedId FROM alec.DomoDashboards WHERE DashboardId=@id AND Enabled=1`);
  return r.recordset[0] || null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

module.exports = { mintEmbedToken, listUserDashboards, getDashboard, ensureDashboardCatalog };

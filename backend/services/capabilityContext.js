// backend/services/capabilityContext.js
//
// Builds a live "what tools does ALEC actually have right now?" block for
// injection into the chat system prompt. Reads from the connectors-v2 DB
// (data/local-alec.db) — connector_instances + mcp_servers — so every chat
// turn reflects the actual configured + connected state, not stale env vars.
//
// Also folds in the skillsRegistry catalog so ALEC knows the full surface of
// skills that *exist* (even if not yet configured), and can suggest adding
// credentials when a user asks for something that needs one.
//
// Cached for 30s to avoid hammering SQLite on every message.

const path = require('node:path');
const fs   = require('node:fs');

const DB_PATH = process.env.ALEC_LOCAL_DB_PATH
  || path.join(__dirname, '..', '..', 'data', 'local-alec.db');

const CACHE_TTL_MS = 30_000;
let _cache = { at: 0, text: '' };

// better-sqlite3 is best-effort — if missing or the DB doesn't exist yet we
// return an empty string and callers fall back to the legacy env-var caps.
function openDb() {
  if (!fs.existsSync(DB_PATH)) return null;
  try {
    const Database = require('better-sqlite3');
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

function readConnectors(db) {
  try {
    return db.prepare(`
      SELECT id, definition_id, display_name, scope_type,
             enabled, status, status_detail, last_checked
        FROM connector_instances
       ORDER BY definition_id, display_name
    `).all();
  } catch {
    return [];
  }
}

function readMcps(db) {
  try {
    return db.prepare(`
      SELECT id, name, transport, status, status_detail,
             COALESCE(tools_json, '[]') AS tools_json,
             last_started
        FROM mcp_servers
       ORDER BY name
    `).all();
  } catch {
    return [];
  }
}

function readCatalog() {
  // Skills registry is the OLD per-user credential store. We only use it to
  // surface skills that have no v2 equivalent (Twilio, Plaid, Microsoft 365,
  // Home Assistant, etc.) so ALEC can still mention them.
  try {
    const { getCatalog } = require(path.join(__dirname, '..', '..', 'services', 'skillsRegistry.js'));
    const c = getCatalog();
    return Array.isArray(c?.skills) ? c.skills : [];
  } catch {
    return [];
  }
}

function statusIcon(s) {
  if (s === 'connected' || s === 'running') return '✅';
  if (s === 'error') return '❌';
  if (s === 'stopped' || s === 'disabled')  return '⏸';
  return '⚙';
}

// Group an MCP server's tool names by category so the LLM knows, e.g., that
// Zapier — Alec Rovner Personal exposes `gmail_find_email` and can actually
// read the owner's Gmail RIGHT NOW. Without this, the model sees "126 tools"
// and refuses, claiming Gmail/Outlook aren't configured.
const CATEGORY_PATTERNS = [
  ['email',      /(^|_)(gmail|outlook|office_365|office365|email)(_|$)/i],
  ['calendar',   /calendar|event/i],
  ['contacts',   /contact/i],
  ['sheets',     /(google_sheets|excel|spreadsheet|worksheet)/i],
  ['files',      /(onedrive|sharepoint|drive|file|folder|document)/i],
  ['tasks',      /(asana|task|project|timesheet|rfi|submittal|punch|incident|form|inspection|observation)/i],
  ['code',       /(github|gist|branch|pull_request|commit|repository|issue)/i],
  ['sms',        /(sms|twilio|personal_sms)/i],
  ['http',       /(make_api|api_get_request|api_mutating_request)/i],
];

function categorizeTools(toolsJson) {
  let tools = [];
  try { tools = JSON.parse(toolsJson || '[]'); } catch { return {}; }
  const cats = {};
  for (const t of tools) {
    const name = t?.name; if (!name) continue;
    for (const [cat, re] of CATEGORY_PATTERNS) {
      if (re.test(name)) { (cats[cat] = cats[cat] || []).push(name); break; }
    }
  }
  return cats;
}

function renderFeaturedTools(cats) {
  const order = ['email', 'calendar', 'contacts', 'sheets', 'files', 'tasks', 'code', 'sms', 'http'];
  const parts = [];
  for (const key of order) {
    const names = cats[key]; if (!names || !names.length) continue;
    // Highlight up to 4 representative names per category so the model has
    // concrete verbs it can quote back (e.g. "gmail_find_email").
    const sample = names.slice(0, 4).join(', ');
    const more = names.length > 4 ? ` (+${names.length - 4} more)` : '';
    parts.push(`    - ${key}: ${sample}${more}`);
  }
  return parts;
}

function trimDetail(d, max = 120) {
  if (!d) return '';
  const s = String(d).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function buildCapabilityBlock() {
  const now = Date.now();
  if (now - _cache.at < CACHE_TTL_MS && _cache.text) return _cache.text;

  const db = openDb();
  const connectors = db ? readConnectors(db) : [];
  const mcps       = db ? readMcps(db)       : [];
  if (db) { try { db.close(); } catch {} }

  const catalog = readCatalog();

  const lines = [];
  lines.push('## Live connectors (connectors-v2, from data/local-alec.db)');
  if (connectors.length === 0) {
    lines.push('(none configured — user can add via the Connectors panel)');
  } else {
    for (const c of connectors) {
      const ic = statusIcon(c.status);
      const detail = trimDetail(c.status_detail);
      const label  = c.display_name || c.definition_id;
      const body   = detail ? ` — ${detail}` : '';
      lines.push(`${ic} ${c.definition_id}: ${label} [${c.status || 'unknown'}]${body}`);
    }
  }

  lines.push('');
  lines.push('## Live MCP servers (tool catalogs live behind these)');
  if (mcps.length === 0) {
    lines.push('(none configured)');
  } else {
    for (const m of mcps) {
      let n = 0;
      try { n = JSON.parse(m.tools_json).length || 0; } catch {}
      const ic = statusIcon(m.status);
      const det = trimDetail(m.status_detail);
      const body = det ? ` — ${det}` : '';
      lines.push(`${ic} ${m.name} [${m.transport}, ${m.status || 'unknown'}, ${n} tools]${body}`);
      // Only enumerate featured tools for servers the LLM can actually use —
      // running ones. This is what keeps ALEC from denying it has Gmail /
      // Outlook / Sheets access when the tools exist behind Zapier.
      if (m.status === 'running' && n > 0) {
        const cats = categorizeTools(m.tools_json);
        const featured = renderFeaturedTools(cats);
        if (featured.length) lines.push(...featured);
      }
    }
    const totalTools = mcps.reduce((sum, m) => {
      try { return sum + (JSON.parse(m.tools_json).length || 0); } catch { return sum; }
    }, 0);
    lines.push(`(total MCP tools exposed: ${totalTools})`);
  }

  if (catalog.length > 0) {
    // Dedup against connector definition_ids so we don't double-list GitHub etc.
    const dupeIds = new Set(connectors.map(c => c.definition_id));
    const extras = catalog
      .filter(s => !dupeIds.has(s.id) && !dupeIds.has(s.id.replace(/[-_]/g, '')))
      .map(s => s.id);
    if (extras.length) {
      lines.push('');
      lines.push('## Additional skills available in catalog (not yet wired as v2 connectors)');
      lines.push(extras.join(', '));
    }
  }

  lines.push('');
  lines.push('## How to use this');
  lines.push('- Treat ✅ entries as real, usable tools — do NOT claim you lack them.');
  lines.push('- The sub-bullets under each running MCP server list callable tool names. For non-Zapier servers these are the actual app tools (e.g. `stoa_group_db.get_projects`, `Desktop_Commander.read_file`). For Zapier servers they are GENERIC meta-tools (`list_enabled_zapier_actions`, `execute_zapier_read_action`, `execute_zapier_write_action`, etc.) — the app-specific action (Gmail, Outlook, Sheets) is named by the `action_key` argument.');
  lines.push('- **Zapier 2-step flow** (REQUIRED — direct tool names like `gmail_find_email` are DEPRECATED and return `Tool not found`):');
  lines.push('    1. Call `list_enabled_zapier_actions` on the target Zapier server (optionally filter with `{app:"gmail"}`) to discover enabled apps and their exact `action` keys.');
  lines.push('    2. Call `execute_zapier_read_action` for reads OR `execute_zapier_write_action` for writes with arguments `{app, action, instructions, output}` — all four are REQUIRED.');
  lines.push('  Example — find Gmail emails on `Zapier — Alec Rovner Personal`: `execute_zapier_read_action` with `{app:"gmail", action:"message", instructions:"find the 20 most recent emails in the primary inbox received today", output:"subject, sender, received date"}`. Example — find Outlook emails: `{app:"microsoft_outlook", action:"find_email", instructions:"...", output:"..."}`. Action keys are SHORT (e.g. "message", "find_email", "find_calendar_event") — NOT long-form like "gmail_find_email".');
  lines.push('- For email questions ("what emails do I have today"), Gmail lives on `Zapier — Alec Rovner Personal` and `Zapier — Campus Rentals LLC`; Outlook/Office 365 lives on `Zapier — Abodingo` and `Zapier — Stoa Group`. An "all accounts" query = 4 `execute_zapier_read_action` calls, one per server. Never tell the user Gmail/Outlook are not configured — they are live.');
  lines.push('- **Stoa Group Azure SQL** is NOT an MCP server — it lives behind the native `stoa` v2 connector and is queried via the separate `stoa_query` chat tool (NOT `mcp_call`). Valid `query` values: `portfolio_summary`, `find_projects`, `get_mmr`, `get_unit_details`, `get_renewals`, `get_loans`, `get_pipeline`, `get_dscr`, `get_ltv`, `get_equity`, `get_expiring_contracts`, `get_portfolio_rent_growth`. Use this for ANY portfolio / leasing / loan / DSCR / LTV / equity / covenant / pipeline question about Stoa-owned properties. Example: `stoa_query({query:"portfolio_summary"})` or `stoa_query({query:"find_projects", search:"Nola"})`.');
  lines.push('- For any data question, first check whether a connected connector or running MCP can answer it before falling back to reasoning or web search.');
  lines.push('- If a skill is ❌ or missing, say so plainly and point the user at the Connectors / Skills panel.');

  const text = lines.join('\n');
  _cache = { at: now, text };
  return text;
}

function invalidateCapabilityCache() {
  _cache = { at: 0, text: '' };
}

module.exports = { buildCapabilityBlock, invalidateCapabilityCache };

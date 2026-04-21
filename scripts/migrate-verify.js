#!/usr/bin/env node
/**
 * scripts/migrate-verify.js — S6.1 preflight for the legacy JSON wipe (S6.3).
 *
 * Boots the connectors-v2 SQLite DB, loads the vault JSON, and asserts:
 *   1. No legacy top-level keys (users/global/_legacy/custom) remain unless
 *      each has a matching audit_log.action='migrate' row. We consider any
 *      *non-empty* legacy branch a blocker.
 *   2. Every connector_instances.id maps to a vault.instances[id] key.
 *   3. Every vault.instances[id] maps to a connector_instances row.
 *   4. No source file still imports skillsRegistry.get(uid,key,field) with
 *      the legacy 3-arg signature (heuristic grep of .js/.mjs under repo).
 *
 * Exits 0 clean, non-zero on any issue. Exports verifyMigration() so tests
 * can exercise the core logic without a real boot.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEGACY_TOP_KEYS = ['users', 'global', '_legacy', 'custom'];

function loadVault(vaultPath) {
  if (!fs.existsSync(vaultPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  } catch (e) {
    return { __parse_error: e.message };
  }
}

function hasMigrateAuditCovering(db, key) {
  // Heuristic: a migrate row exists whose metadata reasonTag starts with the
  // legacy branch name (e.g. "_legacy.github" or "global.stoa" or "user").
  try {
    const rows = db
      .prepare("SELECT metadata_json FROM audit_log WHERE action='migrate'")
      .all();
    const tags = rows
      .map((r) => {
        try { return JSON.parse(r.metadata_json || '{}').reasonTag || ''; }
        catch { return ''; }
      })
      .filter(Boolean);
    return tags.some((t) => t.startsWith(key) || (key === 'users' && t.startsWith('user')));
  } catch {
    return false;
  }
}

function nonEmpty(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}

/**
 * verifyMigration({ db, vaultPath, repoRoot? })
 *   returns { ok, issues, stats }
 */
async function verifyMigration({ db, vaultPath, repoRoot }) {
  const issues = [];
  const vault = loadVault(vaultPath);
  if (vault.__parse_error) {
    issues.push(`vault parse error: ${vault.__parse_error}`);
    return { ok: false, issues, stats: {} };
  }

  // 1. Legacy top-level keys
  for (const k of LEGACY_TOP_KEYS) {
    if (!(k in vault)) continue;
    if (!nonEmpty(vault[k])) continue; // empty placeholder is fine
    if (!hasMigrateAuditCovering(db, k)) {
      issues.push(`legacy key "${k}" still carries data and no matching migrate audit row`);
    }
  }

  // 2 + 3. SQL <-> vault cross-check
  const sqlIds = new Set();
  try {
    for (const r of db.prepare('SELECT id FROM connector_instances').all()) {
      sqlIds.add(r.id);
    }
  } catch {
    issues.push('connector_instances table missing — run migration 002 first');
  }
  const vaultIds = new Set(Object.keys((vault.instances || {})));

  for (const id of sqlIds) {
    if (!vaultIds.has(id)) issues.push(`orphan SQL row (no vault entry): ${id}`);
  }
  for (const id of vaultIds) {
    if (!sqlIds.has(id)) issues.push(`orphan vault entry (no SQL row): ${id}`);
  }

  // 4. grep for legacy skillsRegistry.get(uid,key,field) callers
  if (repoRoot) {
    try {
      const hits = grepLegacyCallers(repoRoot);
      if (hits.length) issues.push(`legacy skillsRegistry.get(uid,key,field) caller(s): ${hits.join(', ')}`);
    } catch { /* best-effort */ }
  }

  return {
    ok: issues.length === 0,
    issues,
    stats: { sqlRows: sqlIds.size, vaultEntries: vaultIds.size },
  };
}

function grepLegacyCallers(repoRoot) {
  const hits = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.git', 'frontend', 'desktop-app', 'scripts']);
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|mjs)$/.test(e.name)) {
        let src; try { src = fs.readFileSync(full, 'utf8'); } catch { continue; }
        // legacy 3-arg signature: skillsRegistry.get(uid, 'key', 'field')
        if (/skillsRegistry\.get\s*\([^)]*,[^)]*,[^)]*\)/.test(src)) {
          hits.push(path.relative(repoRoot, full));
        }
      }
    }
  };
  walk(repoRoot);
  return hits;
}

module.exports = { verifyMigration };

// CLI mode -----------------------------------------------------------------
if (require.main === module) {
  (async () => {
    const repoRoot = path.resolve(__dirname, '..');
    const vaultPath = process.env.ALEC_VAULT_PATH || path.join(repoRoot, 'data', 'skills-config.json');
    const dbPath = process.env.ALEC_LOCAL_DB_PATH || path.join(repoRoot, 'data', 'alec.db');

    let db;
    try {
      const Database = require('better-sqlite3');
      db = new Database(dbPath, { fileMustExist: false });
    } catch (e) {
      console.error('[migrate-verify] cannot open db:', e.message);
      process.exit(2);
    }

    const result = await verifyMigration({ db, vaultPath, repoRoot });
    console.log('[migrate-verify] stats:', result.stats);
    if (!result.ok) {
      console.error('[migrate-verify] issues:');
      for (const i of result.issues) console.error('  - ' + i);
      process.exit(1);
    }
    console.log('[migrate-verify] OK');
  })().catch((e) => { console.error(e); process.exit(1); });
}

#!/usr/bin/env node
/**
 * scripts/connector-vault-doctor.js — S6.5
 *
 * Post-S6 orphan detector. Walks connector_instances rows and vault
 * entries, prints rows that exist on one side but not the other. Exits
 * non-zero if any orphan is found. Safe to run against a live install;
 * the script opens the DB read-only and never writes.
 *
 * Usage:
 *   npm run connector:doctor
 *   node scripts/connector-vault-doctor.js
 *
 * Env:
 *   ALEC_LOCAL_DB_PATH   default data/alec.db
 *   ALEC_VAULT_PATH      default data/skills-config.json
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

function loadVaultInstances(p) {
  try {
    const o = JSON.parse(fs.readFileSync(p, 'utf8'));
    return new Set(Object.keys(o.instances || {}));
  } catch {
    return new Set();
  }
}

/**
 * inspect({db, vaultPath}) → { ok, sqlOrphans, vaultOrphans, stats }
 */
function inspect({ db, vaultPath }) {
  const sqlIds = new Set();
  try {
    for (const r of db.prepare('SELECT id FROM connector_instances').all()) {
      sqlIds.add(r.id);
    }
  } catch { /* table may not exist yet */ }
  const vaultIds = loadVaultInstances(vaultPath);

  const sqlOrphans = [];
  const vaultOrphans = [];
  for (const id of sqlIds)   if (!vaultIds.has(id))   sqlOrphans.push(id);
  for (const id of vaultIds) if (!sqlIds.has(id))     vaultOrphans.push(id);

  return {
    ok: sqlOrphans.length === 0 && vaultOrphans.length === 0,
    sqlOrphans,
    vaultOrphans,
    stats: { sqlRows: sqlIds.size, vaultEntries: vaultIds.size },
  };
}

module.exports = { inspect };

if (require.main === module) {
  const repoRoot = path.resolve(__dirname, '..');
  const vaultPath = process.env.ALEC_VAULT_PATH || path.join(repoRoot, 'data', 'skills-config.json');
  const dbPath = process.env.ALEC_LOCAL_DB_PATH || path.join(repoRoot, 'data', 'alec.db');

  let db;
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: false });
  } catch (e) {
    console.error('[vault-doctor] cannot open db:', e.message);
    process.exit(2);
  }

  const r = inspect({ db, vaultPath });
  console.log('[vault-doctor] stats:', r.stats);
  if (r.sqlOrphans.length) {
    console.error('[vault-doctor] SQL rows with no vault entry:');
    for (const id of r.sqlOrphans) console.error('  - ' + id);
  }
  if (r.vaultOrphans.length) {
    console.error('[vault-doctor] vault entries with no SQL row:');
    for (const id of r.vaultOrphans) console.error('  - ' + id);
  }
  if (!r.ok) process.exit(1);
  console.log('[vault-doctor] OK');
}

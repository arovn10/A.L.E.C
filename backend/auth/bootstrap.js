/**
 * backend/auth/bootstrap.js — Sprint 1
 *
 * Runs the alec.* migration once per boot. Safe to call on every startup:
 * the SQL file is fully idempotent (IF NOT EXISTS guards everywhere).
 *
 * Call from server.js AFTER env is loaded but BEFORE mounting /api/auth/*:
 *
 *   const { ensureAuthSchema } = require('./auth/bootstrap');
 *   ensureAuthSchema().catch(e => console.warn('[auth] bootstrap skipped:', e.message));
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { getPoolForAuth } = require('./_pool');

let _done = false;

async function ensureAuthSchema() {
  if (_done) return;
  if (!process.env.STOA_DB_HOST) {
    console.warn('[auth] STOA_DB_HOST not set — skipping schema bootstrap (dev mode).');
    return;
  }
  const sqlPath = path.join(__dirname, '..', 'migrations', '001_alec_auth.sql');
  if (!fs.existsSync(sqlPath)) return;
  const raw = fs.readFileSync(sqlPath, 'utf8');

  // Split on lines that are *exactly* GO (batch separator in T-SQL).
  const batches = raw.split(/^\s*GO\s*$/m).map(s => s.trim()).filter(Boolean);

  const pool = await getPoolForAuth();
  for (const b of batches) {
    try { await pool.request().batch(b); }
    catch (e) {
      // Surface but don't throw — a re-run may hit "object exists" collisions
      // we're already guarded against with IF NOT EXISTS. Keep boot resilient.
      console.warn('[auth] migration batch warning:', e.message.slice(0, 200));
    }
  }
  _done = true;
  console.log('[auth] alec.* schema ensured (001_alec_auth.sql)');
}

/**
 * runMigrations(db, dir)
 *   better-sqlite3 migration runner. Creates _migrations(id, applied_at) table,
 *   then iterates .sql/.js files in dir sorted lexicographically, applying each
 *   file whose id (basename without extension) is not already tracked. Seed and
 *   mapping helper modules are excluded (invoked separately from runBootstrap).
 */
async function runMigrations(db, dir) {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)');
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir)
    .filter(f => (f.endsWith('.sql') || f.endsWith('.js') || f.endsWith('.mjs')) && !f.includes('_seed_') && !f.includes('_mapping'))
    .sort();
  const applied = new Set(db.prepare('SELECT id FROM _migrations').all().map(r => r.id));
  const insert = db.prepare('INSERT INTO _migrations(id) VALUES (?)');
  for (const f of files) {
    const id = f.replace(/\.(sql|js|mjs)$/, '');
    if (applied.has(id)) continue;
    const full = path.join(dir, f);
    if (f.endsWith('.sql')) {
      const sql = fs.readFileSync(full, 'utf8');
      const tx = db.transaction(() => { db.exec(sql); insert.run(id); });
      tx();
    } else {
      const mod = await import(pathToFileURL(full).href);
      if (typeof mod.up !== 'function') throw new Error('Migration ' + id + ' missing up()');
      await mod.up(db);
      insert.run(id);
    }
  }
}

/**
 * runBootstrap()
 *   Opens data/alec.db (or ALEC_LOCAL_DB_PATH), runs migrations, optionally seeds.
 */
async function runBootstrap() {
  const Database = require('better-sqlite3');
  const dbDir = path.join(__dirname, '..', '..', 'data');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = process.env.ALEC_LOCAL_DB_PATH || path.join(dbDir, 'alec.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  const migDir = path.join(__dirname, '..', 'migrations');
  await runMigrations(db, migDir);
  if (process.env.ALEC_CONNECTORS_V2 === '1') {
    try {
      const seedFile = fs.existsSync(path.join(migDir, '002_seed_migration.mjs'))
        ? '002_seed_migration.mjs' : '002_seed_migration.js';
      const seedUrl = pathToFileURL(path.join(migDir, seedFile)).href;
      const seed = await import(seedUrl);
      if (typeof seed.up === 'function') await seed.up(db);
    } catch (e) {
      console.warn('[bootstrap] seed step failed:', e.message);
    }
  }
  console.log('[bootstrap] migrations applied at ' + dbPath);
  return db;
}

module.exports = { ensureAuthSchema, runMigrations, runBootstrap };

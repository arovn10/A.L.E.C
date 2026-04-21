// tests/unit/migrateVerify.test.mjs — S6.1 smoke check for scripts/migrate-verify.js
//
// The script does I/O against a real DB + vault path, so the unit test just
// guarantees the file exists, exposes a verifyMigration(db, {vaultPath})
// async function, and that the function returns non-zero {ok:false} for a
// vault that still carries legacy keys.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { verifyMigration } from '../../scripts/migrate-verify.js';

function tmpFile(name) {
  return path.join(os.tmpdir(), `alec-mv-${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
}

function schema(db) {
  db.prepare('CREATE TABLE connector_instances (id TEXT PRIMARY KEY, definition_id TEXT, scope_type TEXT, scope_id TEXT, display_name TEXT, enabled INTEGER, created_by TEXT)').run();
  db.prepare('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT, target_type TEXT, target_id TEXT, metadata_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)').run();
}

describe('scripts/migrate-verify.js (S6.1)', () => {
  test('exports verifyMigration function', () => {
    expect(typeof verifyMigration).toBe('function');
  });

  test('reports ok:false when vault still carries legacy top-level keys', async () => {
    const db = new Database(':memory:');
    schema(db);
    const p = tmpFile('vault.json');
    fs.writeFileSync(p, JSON.stringify({ users: { '1': {} }, instances: {} }));
    const res = await verifyMigration({ db, vaultPath: p });
    expect(res.ok).toBe(false);
    expect(Array.isArray(res.issues)).toBe(true);
    expect(res.issues.some(i => /legacy/i.test(i))).toBe(true);
  });

  test('reports ok:true for a clean vault with matching SQL rows', async () => {
    const db = new Database(':memory:');
    schema(db);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO connector_instances(id, definition_id, scope_type, scope_id, enabled, created_by) VALUES (?,?,?,?,1,?)')
      .run(id, 'github', 'user', 'a@b.com', 'system');
    const p = tmpFile('vault.json');
    fs.writeFileSync(p, JSON.stringify({ instances: { [id]: { GITHUB_TOKEN: 'iv:ct' } } }));
    const res = await verifyMigration({ db, vaultPath: p });
    expect(res.ok).toBe(true);
    expect(res.issues).toEqual([]);
  });

  test('detects orphan SQL row with no vault entry', async () => {
    const db = new Database(':memory:');
    schema(db);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO connector_instances(id, definition_id, scope_type, scope_id, enabled, created_by) VALUES (?,?,?,?,1,?)')
      .run(id, 'github', 'user', 'a@b.com', 'system');
    const p = tmpFile('vault.json');
    fs.writeFileSync(p, JSON.stringify({ instances: {} }));
    const res = await verifyMigration({ db, vaultPath: p });
    expect(res.ok).toBe(false);
    expect(res.issues.some(i => /orphan SQL row/i.test(i))).toBe(true);
  });

  test('detects orphan vault entry with no SQL row', async () => {
    const db = new Database(':memory:');
    schema(db);
    const p = tmpFile('vault.json');
    fs.writeFileSync(p, JSON.stringify({ instances: { 'ghost-uuid': { K: 'v' } } }));
    const res = await verifyMigration({ db, vaultPath: p });
    expect(res.ok).toBe(false);
    expect(res.issues.some(i => /orphan vault entry/i.test(i))).toBe(true);
  });
});

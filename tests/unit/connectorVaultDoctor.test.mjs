// tests/unit/connectorVaultDoctor.test.mjs — S6.5
//
// Exercises the orphan-detection core used by connector-vault-doctor.js.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import { inspect } from '../../scripts/connector-vault-doctor.js';

function tmpVault(obj) {
  const p = path.join(os.tmpdir(), `alec-doc-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}
function schema(db) {
  db.prepare('CREATE TABLE connector_instances (id TEXT PRIMARY KEY, definition_id TEXT, scope_type TEXT, scope_id TEXT, display_name TEXT, enabled INTEGER, created_by TEXT)').run();
}

describe('connector-vault-doctor (S6.5)', () => {
  test('exports inspect function', () => {
    expect(typeof inspect).toBe('function');
  });

  test('returns no orphans when SQL and vault match', () => {
    const db = new Database(':memory:'); schema(db);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO connector_instances(id,definition_id,scope_type,scope_id,enabled,created_by) VALUES(?,?,?,?,1,?)')
      .run(id, 'github', 'user', 'a@b.com', 'system');
    const p = tmpVault({ instances: { [id]: { X: 'iv:ct' } } });
    const r = inspect({ db, vaultPath: p });
    expect(r.ok).toBe(true);
    expect(r.sqlOrphans).toEqual([]);
    expect(r.vaultOrphans).toEqual([]);
  });

  test('finds SQL rows with no vault entry', () => {
    const db = new Database(':memory:'); schema(db);
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO connector_instances(id,definition_id,scope_type,scope_id,enabled,created_by) VALUES(?,?,?,?,1,?)')
      .run(id, 'github', 'user', 'a@b.com', 'system');
    const p = tmpVault({ instances: {} });
    const r = inspect({ db, vaultPath: p });
    expect(r.ok).toBe(false);
    expect(r.sqlOrphans).toContain(id);
  });

  test('finds vault entries with no SQL row', () => {
    const db = new Database(':memory:'); schema(db);
    const p = tmpVault({ instances: { 'ghost': { X: 'iv:ct' } } });
    const r = inspect({ db, vaultPath: p });
    expect(r.ok).toBe(false);
    expect(r.vaultOrphans).toContain('ghost');
  });
});

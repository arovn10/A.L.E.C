// tests/unit/migration003.test.mjs — S6.3
//
// Exercises the opt-in legacy vault wipe. Without ALEC_ALLOW_LEGACY_WIPE=1
// the migration is a no-op (safety: prevents destructive production runs by
// accident). With the flag set, top-level legacy branches disappear and a
// timestamped .bak is written alongside the vault file.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { up } from '../../backend/migrations/003_remove_legacy_skills_json.mjs';

function tmpVault() {
  const p = path.join(os.tmpdir(), `alec-mig003-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify({
    users: { '1': { github: { GITHUB_TOKEN: 'iv:ct' } } },
    global: { stoa: { STOA_DB_HOST: 'iv:ct' } },
    _legacy: { render: { RENDER_API_KEY: 'iv:ct' } },
    custom: [],
    instances: { 'abc-uuid': { GITHUB_TOKEN: 'iv:ct' } },
  }));
  return p;
}

function schema(db) {
  db.prepare('CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, action TEXT, target_type TEXT, target_id TEXT, metadata_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)').run();
}

describe('migration 003 (S6.3) — legacy vault wipe', () => {
  afterEach(() => { delete process.env.ALEC_ALLOW_LEGACY_WIPE; delete process.env.ALEC_VAULT_PATH; });

  test('no-op without ALEC_ALLOW_LEGACY_WIPE=1', async () => {
    const p = tmpVault();
    process.env.ALEC_VAULT_PATH = p;
    const db = new Database(':memory:'); schema(db);
    await up(db);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(after.users).toBeDefined();
    expect(after.global).toBeDefined();
    expect(after._legacy).toBeDefined();
  });

  test('wipes legacy keys and keeps instances when flag set', async () => {
    const p = tmpVault();
    process.env.ALEC_VAULT_PATH = p;
    process.env.ALEC_ALLOW_LEGACY_WIPE = '1';
    const db = new Database(':memory:'); schema(db);
    await up(db);
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    expect(Object.keys(after)).toEqual(['instances']);
    expect(after.instances['abc-uuid']).toBeDefined();
  });

  test('writes a timestamped backup before wiping', async () => {
    const p = tmpVault();
    process.env.ALEC_VAULT_PATH = p;
    process.env.ALEC_ALLOW_LEGACY_WIPE = '1';
    const db = new Database(':memory:'); schema(db);
    await up(db);
    const dir = path.dirname(p);
    const base = path.basename(p);
    const found = fs.readdirSync(dir).filter(f => f.startsWith(base) && f.includes('.pre-wipe-') && f.endsWith('.bak'));
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  test('records a vault.wipe audit row with backup path', async () => {
    const p = tmpVault();
    process.env.ALEC_VAULT_PATH = p;
    process.env.ALEC_ALLOW_LEGACY_WIPE = '1';
    const db = new Database(':memory:'); schema(db);
    await up(db);
    const rows = db.prepare("SELECT user_id, action, target_type, metadata_json FROM audit_log WHERE action='vault.wipe'").all();
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe('system');
    const meta = JSON.parse(rows[0].metadata_json);
    expect(meta.backup).toMatch(/pre-wipe-\d+\.bak$/);
  });

  test('silent when vault file does not exist', async () => {
    process.env.ALEC_VAULT_PATH = path.join(os.tmpdir(), `missing-${Date.now()}.json`);
    process.env.ALEC_ALLOW_LEGACY_WIPE = '1';
    const db = new Database(':memory:'); schema(db);
    await expect(up(db)).resolves.toBeUndefined();
  });
});

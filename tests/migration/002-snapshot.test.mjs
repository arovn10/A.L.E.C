import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import pkg from '../../backend/auth/bootstrap.js';
import { up as seedUp, runFullMigration } from '../../backend/migrations/002_seed_migration.mjs';
const { runMigrations } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/migrations');

function tmpFile(suffix) {
  return path.join(os.tmpdir(), `alec-${Date.now()}-${Math.random().toString(36).slice(2)}${suffix}`);
}

async function setupDb(vaultPath) {
  process.env.ALEC_VAULT_PATH = vaultPath;
  process.env.ALEC_VAULT_KEY = 'c'.repeat(64);
  const db = new Database(':memory:');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedUp(db);
  return db;
}

function writeSampleVault(vaultPath) {
  const legacy = {
    users: { 'alice@stoagroup.com': { github: { GITHUB_TOKEN: 'ghp_a' } } },
    global: {
      stoa: { STOA_DB_HOST: 'h', STOA_DB_PASSWORD: 'p' },
      homeassistant: { HOMEASSISTANT_URL: 'u', HOMEASSISTANT_TOKEN: 't' },
      imessage: { IMESSAGE_DB_PATH: '/p' },
      aws: { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'us-east-1' },
    },
    _legacy: {
      tenantcloud: { TENANTCLOUD_EMAIL: 'e', TENANTCLOUD_PASSWORD: 'p' },
    },
  };
  fs.writeFileSync(vaultPath, JSON.stringify(legacy, null, 2));
}

describe('runFullMigration snapshot', () => {
  test('memberships by domain, plan applied, backup created, idempotent', async () => {
    const vaultPath = tmpFile('.skills.json');
    writeSampleVault(vaultPath);
    const db = await setupDb(vaultPath);

    const users = ['bob@abodingo.com', 'dan@campusrentalsllc.com', 'contractor@gmail.com', 'arovner@stoagroup.com'];
    const res = await runFullMigration(db, { users, vaultPath });

    // Memberships
    const bob = db.prepare("SELECT org_id, role FROM org_memberships WHERE user_id='bob@abodingo.com'").all();
    expect(bob).toEqual([{ org_id: 'abodingo', role: 'member' }]);
    const dan = db.prepare("SELECT org_id, role FROM org_memberships WHERE user_id='dan@campusrentalsllc.com'").all();
    expect(dan).toEqual([{ org_id: 'campusrentals', role: 'member' }]);
    const gmail = db.prepare("SELECT * FROM org_memberships WHERE user_id='contractor@gmail.com'").all();
    expect(gmail).toEqual([]);

    // Instance rows equals plan length (alice github + 4 global + 1 legacy = 6)
    const instCount = db.prepare('SELECT COUNT(*) AS n FROM connector_instances').get().n;
    expect(instCount).toBe(6);
    expect(res.inserted).toBe(6);

    // Backup file exists
    const backups = fs.readdirSync(path.dirname(vaultPath))
      .filter(f => f.startsWith(path.basename(vaultPath)) && f.includes('.pre-migration-'));
    expect(backups.length).toBeGreaterThan(0);

    // Idempotency: second run inserts zero
    const res2 = await runFullMigration(db, { users, vaultPath });
    expect(res2.inserted).toBe(0);
    const instCount2 = db.prepare('SELECT COUNT(*) AS n FROM connector_instances').get().n;
    expect(instCount2).toBe(6);

    // Cleanup
    for (const b of backups) { try { fs.unlinkSync(path.join(path.dirname(vaultPath), b)); } catch {} }
    try { fs.unlinkSync(vaultPath); } catch {}
  });
});

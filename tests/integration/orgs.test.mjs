// tests/integration/orgs.test.mjs
// Unit coverage for requireOrgRole (S2.2). The /api/orgs router integration
// tests live in orgsRouter.test.mjs (added in S2.3) to keep this suite
// independent of the router module.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

import pkg from '../../backend/auth/bootstrap.js';
const { runMigrations } = pkg;
import { up as seedUp } from '../../backend/migrations/002_seed_migration.mjs';
import { requireOrgRole } from '../../backend/middleware/requireOrgRole.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

async function freshDb() {
  const vault = `/tmp/orgs-mw-vault-${crypto.randomBytes(4).toString('hex')}.json`;
  process.env.ALEC_VAULT_PATH = vault;
  process.env.ALEC_VAULT_KEY = 'd'.repeat(64);
  try { fs.unlinkSync(vault); } catch {}
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  await seedUp(db);
  return db;
}

function mkApp(db, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email }; next(); });
  app.get('/o/:id', requireOrgRole(() => db, ['owner']), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireOrgRole', () => {
  test('admin role denied when allowlist is owner-only', async () => {
    const db = await freshDb();
    db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
      .run('admin@abodingo.com', 'abodingo', 'admin');
    const res = await request(mkApp(db, 'admin@abodingo.com')).get('/o/abodingo');
    expect(res.status).toBe(403);
  });

  test('owner passes', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'arovner@stoagroup.com')).get('/o/abodingo');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('no membership -> 403', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'stranger@example.com')).get('/o/abodingo');
    expect(res.status).toBe(403);
  });
});

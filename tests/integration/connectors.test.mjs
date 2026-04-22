// tests/integration/connectors.test.mjs
// Integration tests for /api/connectors — mounts the routers against a
// fresh in-memory SQLite and a stub authenticateToken that injects req.user.

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
import { requireConnectorWrite } from '../../backend/middleware/requireConnectorWrite.mjs';
import { create as createConnector } from '../../backend/services/connectorService.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

async function freshDb() {
  const vault = `/tmp/connectors-int-vault-${crypto.randomBytes(4).toString('hex')}.json`;
  process.env.ALEC_VAULT_PATH = vault;
  process.env.ALEC_VAULT_KEY = 'c'.repeat(64);
  try { fs.unlinkSync(vault); } catch {}
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  await seedUp(db);
  // extra member for ACL tests
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('bob@abodingo.com', 'abodingo', 'member');
  return db;
}

function mkApp(db, userEmail) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: userEmail }; next(); });
  // Tiny handler that just proves the middleware passed through.
  app.patch('/inst/:id', requireConnectorWrite(() => db), (req, res) => {
    res.json({ ok: true, id: req.connectorInstance.id });
  });
  return app;
}

describe('requireConnectorWrite', () => {
  test('403 for non-owner of user-scope instance, 200 for owner', async () => {
    const db = await freshDb();
    const inst = createConnector(db, {
      definitionId: 'github', scope: 'user',
      scopeId: 'alice@stoagroup.com', fields: { GITHUB_TOKEN: 'x' },
      createdBy: 'alice@stoagroup.com',
    });

    // bob cannot patch alice's user-scope instance
    const bobRes = await request(mkApp(db, 'bob@abodingo.com')).patch(`/inst/${inst.id}`).send({});
    expect(bobRes.status).toBe(403);

    // alice can
    const aliceRes = await request(mkApp(db, 'alice@stoagroup.com')).patch(`/inst/${inst.id}`).send({});
    expect(aliceRes.status).toBe(200);
    expect(aliceRes.body.id).toBe(inst.id);
  });

  test('404 for unknown instance id', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com')).patch('/inst/nope').send({});
    expect(res.status).toBe(404);
  });
});

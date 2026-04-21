// tests/integration/connectorMove.test.mjs — S5.3 move-to-org endpoint.
// POST /api/connectors/:id/move reassigns scope_type/scope_id atomically
// after checking write perms on *both* source and target. Audit row
// `connector.move` captures before/after scope.

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
import { connectorsRouter, __resetRevealBucket } from '../../backend/routes/connectors.mjs';
import { create as svcCreate } from '../../backend/services/connectorService.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

async function freshDb() {
  const vault = `/tmp/conn-move-vault-${crypto.randomBytes(4).toString('hex')}.json`;
  process.env.ALEC_VAULT_PATH = vault;
  process.env.ALEC_VAULT_KEY = '1'.repeat(64);
  try { fs.unlinkSync(vault); } catch {}
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  await seedUp(db);
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('alice@stoagroup.com', 'stoagroup', 'owner');
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('bob@abodingo.com', 'abodingo', 'member');
  __resetRevealBucket();
  return db;
}

function mkApp(db, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email }; next(); });
  app.use('/api/connectors', connectorsRouter(() => db));
  return app;
}

describe('POST /api/connectors/:id/move (S5.3)', () => {
  test('owner moves a user-scope instance to an org they own', async () => {
    const db = await freshDb();
    const inst = svcCreate(db, {
      definitionId: 'github', scope: 'user', scopeId: 'alice@stoagroup.com',
      fields: { GITHUB_TOKEN: 'alice-token' }, createdBy: 'alice@stoagroup.com',
    });
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post(`/api/connectors/${inst.id}/move`)
      .send({ scope: 'org', scopeId: 'stoagroup' });
    expect(res.status).toBe(200);
    expect(res.body.scope_type).toBe('org');
    expect(res.body.scope_id).toBe('stoagroup');

    const row = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(inst.id);
    expect(row.scope_type).toBe('org');
    expect(row.scope_id).toBe('stoagroup');

    const audit = db.prepare(
      "SELECT action, metadata_json FROM audit_log WHERE target_id=? AND action='connector.move'"
    ).get(inst.id);
    expect(audit).toBeDefined();
    const meta = JSON.parse(audit.metadata_json);
    expect(meta.from).toEqual({ scope_type: 'user', scope_id: 'alice@stoagroup.com' });
    expect(meta.to).toEqual({ scope_type: 'org', scope_id: 'stoagroup' });
  });

  test('rejects move to an org where caller is not admin/owner', async () => {
    const db = await freshDb();
    const inst = svcCreate(db, {
      definitionId: 'github', scope: 'user', scopeId: 'bob@abodingo.com',
      fields: { GITHUB_TOKEN: 'bob-token' }, createdBy: 'bob@abodingo.com',
    });
    // bob is only a `member` of abodingo — no write privilege on the org scope
    const res = await request(mkApp(db, 'bob@abodingo.com'))
      .post(`/api/connectors/${inst.id}/move`)
      .send({ scope: 'org', scopeId: 'abodingo' });
    expect(res.status).toBe(403);
  });

  test('rejects move when caller lacks write on source', async () => {
    const db = await freshDb();
    const inst = svcCreate(db, {
      definitionId: 'github', scope: 'user', scopeId: 'alice@stoagroup.com',
      fields: { GITHUB_TOKEN: 'alice-token' }, createdBy: 'alice@stoagroup.com',
    });
    const res = await request(mkApp(db, 'bob@abodingo.com'))
      .post(`/api/connectors/${inst.id}/move`)
      .send({ scope: 'user', scopeId: 'bob@abodingo.com' });
    expect(res.status).toBe(403);
  });

  test('rejects malformed body', async () => {
    const db = await freshDb();
    const inst = svcCreate(db, {
      definitionId: 'github', scope: 'user', scopeId: 'alice@stoagroup.com',
      fields: { GITHUB_TOKEN: 'alice-token' }, createdBy: 'alice@stoagroup.com',
    });
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post(`/api/connectors/${inst.id}/move`)
      .send({ scope: 'galaxy', scopeId: '' });
    expect(res.status).toBe(400);
  });

  test('404 when instance does not exist', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post(`/api/connectors/ghost/move`)
      .send({ scope: 'org', scopeId: 'stoagroup' });
    expect(res.status).toBe(404);
  });
});

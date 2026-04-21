// tests/integration/connectorsRouter.test.mjs
// /api/connectors end-to-end — the router is mounted into a minimal Express
// app with a stub auth middleware that injects req.user.email.

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
  const vault = `/tmp/connrtr-vault-${crypto.randomBytes(4).toString('hex')}.json`;
  process.env.ALEC_VAULT_PATH = vault;
  process.env.ALEC_VAULT_KEY = 'f'.repeat(64);
  try { fs.unlinkSync(vault); } catch {}
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  await seedUp(db);
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('bob@abodingo.com', 'abodingo', 'member');
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('alice@stoagroup.com', 'stoagroup', 'admin');
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

describe('/api/connectors — catalog + list', () => {
  test('GET /catalog returns seeded connector definitions', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'arovner@stoagroup.com')).get('/api/connectors/catalog');
    expect(res.status).toBe(200);
    expect(res.body.some(c => c.id === 'github')).toBe(true);
  });

  test('GET / shows only instances the caller can see', async () => {
    const db = await freshDb();
    // Alice's personal token — invisible to Bob
    svcCreate(db, {
      definitionId: 'github', scope: 'user', scopeId: 'alice@stoagroup.com',
      fields: { GITHUB_TOKEN: 'alice-token' }, createdBy: 'alice@stoagroup.com',
    });
    // Abodingo-scope instance — visible to Bob (member)
    svcCreate(db, {
      definitionId: 'github', scope: 'org', scopeId: 'abodingo',
      fields: { GITHUB_TOKEN: 'org-token' }, createdBy: 'arovner@stoagroup.com',
    });

    const bob = await request(mkApp(db, 'bob@abodingo.com')).get('/api/connectors');
    expect(bob.status).toBe(200);
    expect(bob.body.length).toBe(1);
    expect(bob.body[0].scope_id).toBe('abodingo');

    const alice = await request(mkApp(db, 'alice@stoagroup.com')).get('/api/connectors');
    // alice sees her user-scope token + any stoagroup org-scope (none here)
    expect(alice.body.length).toBe(1);
    expect(alice.body[0].scope_type).toBe('user');
  });

  test('GET /?orgId=stoagroup filters to that org for a multi-org owner', async () => {
    const db = await freshDb();
    svcCreate(db, { definitionId: 'github', scope: 'org', scopeId: 'stoagroup',
      fields: { GITHUB_TOKEN: 's' }, createdBy: 'arovner@stoagroup.com' });
    svcCreate(db, { definitionId: 'github', scope: 'org', scopeId: 'abodingo',
      fields: { GITHUB_TOKEN: 'a' }, createdBy: 'arovner@stoagroup.com' });
    const res = await request(mkApp(db, 'arovner@stoagroup.com'))
      .get('/api/connectors?orgId=stoagroup');
    expect(res.body.length).toBe(1);
    expect(res.body[0].scope_id).toBe('stoagroup');
  });

  test('GET / redacts secrets', async () => {
    const db = await freshDb();
    svcCreate(db, { definitionId: 'github', scope: 'user', scopeId: 'alice@stoagroup.com',
      fields: { GITHUB_TOKEN: 'plaintext' }, createdBy: 'alice@stoagroup.com' });
    const res = await request(mkApp(db, 'alice@stoagroup.com')).get('/api/connectors');
    expect(res.body[0].fields.GITHUB_TOKEN).not.toBe('plaintext');
  });
});

describe('POST /api/connectors', () => {
  test('user-scope create returns 201 with redacted secret', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post('/api/connectors')
      .send({
        definitionId: 'github', scope: 'user', scopeId: 'alice@stoagroup.com',
        fields: { GITHUB_TOKEN: 'ghp_secret' }, displayName: 'Alice GH',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.fields.GITHUB_TOKEN).not.toBe('ghp_secret');
  });

  test('user-scope create for another user -> 403', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post('/api/connectors')
      .send({
        definitionId: 'github', scope: 'user', scopeId: 'bob@abodingo.com',
        fields: { GITHUB_TOKEN: 'x' },
      });
    expect(res.status).toBe(403);
  });

  test('ORG_ONLY connector at user scope -> 400', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post('/api/connectors')
      .send({
        definitionId: 'tenantcloud', scope: 'user', scopeId: 'alice@stoagroup.com',
        fields: { TENANTCLOUD_EMAIL: 'a@b', TENANTCLOUD_PASSWORD: 'p' },
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('ORG_ONLY');
  });

  test('org-scope POST by plain member -> 403', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'bob@abodingo.com'))
      .post('/api/connectors')
      .send({
        definitionId: 'github', scope: 'org', scopeId: 'abodingo',
        fields: { GITHUB_TOKEN: 'x' },
      });
    expect(res.status).toBe(403);
  });

  test('org-scope POST by org admin -> 201', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post('/api/connectors')
      .send({
        definitionId: 'github', scope: 'org', scopeId: 'stoagroup',
        fields: { GITHUB_TOKEN: 'org-token' },
      });
    expect(res.status).toBe(201);
    expect(res.body.scope_type).toBe('org');
    expect(res.body.scope_id).toBe('stoagroup');
  });

  test('invalid body -> 400 INVALID', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .post('/api/connectors')
      .send({ definitionId: 'github' }); // missing scope/scopeId/fields
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID');
  });
});

describe('GET/PATCH/DELETE /api/connectors/:id', () => {
  async function seedInstance(db, email) {
    return svcCreate(db, {
      definitionId: 'github', scope: 'user', scopeId: email,
      fields: { GITHUB_TOKEN: 'initial' }, createdBy: email,
    });
  }

  test('GET /:id returns the redacted instance for its owner', async () => {
    const db = await freshDb();
    const inst = await seedInstance(db, 'alice@stoagroup.com');
    const res = await request(mkApp(db, 'alice@stoagroup.com')).get(`/api/connectors/${inst.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(inst.id);
    expect(res.body.fields.GITHUB_TOKEN).not.toBe('initial');
  });

  test('GET /:id returns 403 when the caller cannot see the instance', async () => {
    const db = await freshDb();
    const inst = await seedInstance(db, 'alice@stoagroup.com');
    const res = await request(mkApp(db, 'bob@abodingo.com')).get(`/api/connectors/${inst.id}`);
    expect(res.status).toBe(403);
  });

  test('GET /:id returns 404 for unknown id', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com')).get('/api/connectors/does-not-exist');
    expect(res.status).toBe(404);
  });

  test('PATCH updates fields and displayName', async () => {
    const db = await freshDb();
    const inst = await seedInstance(db, 'alice@stoagroup.com');
    const res = await request(mkApp(db, 'alice@stoagroup.com'))
      .patch(`/api/connectors/${inst.id}`)
      .send({ fields: { GITHUB_TOKEN: 'rotated' }, displayName: 'Alice primary' });
    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe('Alice primary');
  });

  test('PATCH by non-writer -> 403', async () => {
    const db = await freshDb();
    const inst = await seedInstance(db, 'alice@stoagroup.com');
    const res = await request(mkApp(db, 'bob@abodingo.com'))
      .patch(`/api/connectors/${inst.id}`)
      .send({ displayName: 'hijack' });
    expect(res.status).toBe(403);
  });

  test('DELETE 204 then GET 404', async () => {
    const db = await freshDb();
    const inst = await seedInstance(db, 'alice@stoagroup.com');
    const del = await request(mkApp(db, 'alice@stoagroup.com')).delete(`/api/connectors/${inst.id}`);
    expect(del.status).toBe(204);
    const after = await request(mkApp(db, 'alice@stoagroup.com')).get(`/api/connectors/${inst.id}`);
    expect(after.status).toBe(404);
  });
});

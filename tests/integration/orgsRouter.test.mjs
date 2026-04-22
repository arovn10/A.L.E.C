// tests/integration/orgsRouter.test.mjs
// End-to-end tests for /api/orgs mounted into a bare Express app.

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
import { orgsRouter } from '../../backend/routes/orgs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

async function freshDb() {
  const vault = `/tmp/orgs-router-vault-${crypto.randomBytes(4).toString('hex')}.json`;
  process.env.ALEC_VAULT_PATH = vault;
  process.env.ALEC_VAULT_KEY = 'e'.repeat(64);
  try { fs.unlinkSync(vault); } catch {}
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  await seedUp(db);
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('bob@abodingo.com', 'abodingo', 'member');
  return db;
}

function mkApp(db, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email }; next(); });
  app.use('/api/orgs', orgsRouter(() => db));
  return app;
}

describe('/api/orgs', () => {
  test('GET / returns only orgs the caller belongs to', async () => {
    const db = await freshDb();
    const bob = await request(mkApp(db, 'bob@abodingo.com')).get('/api/orgs');
    expect(bob.status).toBe(200);
    expect(bob.body.map(o => o.id)).toEqual(['abodingo']);

    const owner = await request(mkApp(db, 'arovner@stoagroup.com')).get('/api/orgs');
    expect(owner.body.map(o => o.id).sort()).toEqual(['abodingo', 'campusrentals', 'stoagroup']);
  });

  test('member cannot list members; owner can', async () => {
    const db = await freshDb();
    const memberRes = await request(mkApp(db, 'bob@abodingo.com')).get('/api/orgs/abodingo/members');
    expect(memberRes.status).toBe(403);
    const ownerRes = await request(mkApp(db, 'arovner@stoagroup.com')).get('/api/orgs/abodingo/members');
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.some(m => m.user_id === 'arovner@stoagroup.com')).toBe(true);
  });

  test('owner adds/updates/removes a member; audit rows written', async () => {
    const db = await freshDb();
    const owner = () => mkApp(db, 'arovner@stoagroup.com');

    const add = await request(owner()).post('/api/orgs/abodingo/members')
      .send({ userId: 'c@abodingo.com', role: 'member' });
    expect(add.status).toBe(201);

    const patch = await request(owner()).patch('/api/orgs/abodingo/members/c@abodingo.com')
      .send({ role: 'admin' });
    expect(patch.status).toBe(200);
    expect(patch.body.role).toBe('admin');

    const del = await request(owner()).delete('/api/orgs/abodingo/members/c@abodingo.com');
    expect(del.status).toBe(204);

    const audit = db.prepare(
      "SELECT action FROM audit_log WHERE target_id=? AND org_id='abodingo' ORDER BY id"
    ).all('c@abodingo.com').map(r => r.action);
    expect(audit).toEqual(['org.member.add', 'org.member.update', 'org.member.remove']);
  });

  test('PATCH on unknown member -> 404', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'arovner@stoagroup.com'))
      .patch('/api/orgs/abodingo/members/ghost@nowhere.test')
      .send({ role: 'admin' });
    expect(res.status).toBe(404);
  });

  test('non-owner cannot add member', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'bob@abodingo.com'))
      .post('/api/orgs/abodingo/members').send({ userId: 'x@abodingo.com', role: 'member' });
    expect(res.status).toBe(403);
  });

  test('POST rejects invalid body', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'arovner@stoagroup.com'))
      .post('/api/orgs/abodingo/members').send({ userId: 'not-email', role: 'member' });
    expect(res.status).toBe(400);
  });
});

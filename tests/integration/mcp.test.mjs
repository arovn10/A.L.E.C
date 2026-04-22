// tests/integration/mcp.test.mjs — CRUD skeleton for /api/mcp (S2.8).

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
import { mcpRouter } from '../../backend/routes/mcp.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

async function freshDb() {
  const vault = `/tmp/mcp-vault-${crypto.randomBytes(4).toString('hex')}.json`;
  process.env.ALEC_VAULT_PATH = vault;
  process.env.ALEC_VAULT_KEY = '7'.repeat(64);
  try { fs.unlinkSync(vault); } catch {}
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  await seedUp(db);
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('bob@abodingo.com', 'abodingo', 'member');
  db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)')
    .run('alice@stoagroup.com', 'stoagroup', 'admin');
  return db;
}

function mkApp(db, email) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email }; next(); });
  app.use('/api/mcp', mcpRouter(() => db));
  return app;
}

describe('/api/mcp CRUD skeleton', () => {
  test('GET /catalog returns curated entries + category index', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com')).get('/api/mcp/catalog');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.entries)).toBe(true);
    expect(res.body.entries.length).toBeGreaterThan(0);
    expect(Array.isArray(res.body.categories)).toBe(true);
    for (const e of res.body.entries) {
      expect(typeof e.id).toBe('string');
      expect(typeof e.name).toBe('string');
      expect(typeof e.transport).toBe('string');
    }
  });

  test('POST creates, GET returns, list scoped to caller', async () => {
    const db = await freshDb();
    const app = mkApp(db, 'alice@stoagroup.com');
    const post = await request(app).post('/api/mcp').send({
      name: 'github-mcp', scope: 'user', scopeId: 'alice@stoagroup.com',
      transport: 'stdio', command: '/usr/bin/node', args: ['server.js'],
    });
    expect(post.status).toBe(201);
    expect(post.body.name).toBe('github-mcp');
    const id = post.body.id;

    const get = await request(app).get(`/api/mcp/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.transport).toBe('stdio');

    const list = await request(app).get('/api/mcp');
    expect(list.body.some(r => r.id === id)).toBe(true);

    // Bob cannot see Alice's user-scope MCP.
    const bob = await request(mkApp(db, 'bob@abodingo.com')).get(`/api/mcp/${id}`);
    expect(bob.status).toBe(403);
  });

  test('POST org-scope by plain member -> 403, by admin -> 201', async () => {
    const db = await freshDb();
    const bob = await request(mkApp(db, 'bob@abodingo.com')).post('/api/mcp').send({
      name: 'shared-mcp', scope: 'org', scopeId: 'abodingo',
      transport: 'http', url: 'http://example.test/mcp',
    });
    expect(bob.status).toBe(403);
    const alice = await request(mkApp(db, 'alice@stoagroup.com')).post('/api/mcp').send({
      name: 'shared-mcp', scope: 'org', scopeId: 'stoagroup',
      transport: 'http', url: 'http://example.test/mcp',
    });
    expect(alice.status).toBe(201);
  });

  test('POST invalid body -> 400', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com')).post('/api/mcp').send({
      name: 'bad', scope: 'user', scopeId: 'alice@stoagroup.com', transport: 'ftp',
    });
    expect(res.status).toBe(400);
  });

  test('PATCH then DELETE round-trip', async () => {
    const db = await freshDb();
    const app = mkApp(db, 'alice@stoagroup.com');
    const { body: created } = await request(app).post('/api/mcp').send({
      name: 'to-edit', scope: 'user', scopeId: 'alice@stoagroup.com',
      transport: 'stdio', command: '/a',
    });
    const patch = await request(app).patch(`/api/mcp/${created.id}`).send({ name: 'renamed' });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe('renamed');

    const del = await request(app).delete(`/api/mcp/${created.id}`);
    expect(del.status).toBe(204);

    const gone = await request(app).get(`/api/mcp/${created.id}`);
    expect(gone.status).toBe(404);
  });

  test('PATCH / DELETE by non-writer -> 403', async () => {
    const db = await freshDb();
    const alice = mkApp(db, 'alice@stoagroup.com');
    const { body: created } = await request(alice).post('/api/mcp').send({
      name: 'alice-priv', scope: 'user', scopeId: 'alice@stoagroup.com',
      transport: 'stdio', command: '/x',
    });
    const bob = mkApp(db, 'bob@abodingo.com');
    const p = await request(bob).patch(`/api/mcp/${created.id}`).send({ name: 'nope' });
    expect(p.status).toBe(403);
    const d = await request(bob).delete(`/api/mcp/${created.id}`);
    expect(d.status).toBe(403);
  });

  test('runtime: start -> status -> tools -> stop with dummy stdio server', async () => {
    const DUMMY = path.resolve(__dirname, '../unit/fixtures/dummy-mcp-server.mjs');
    const db = await freshDb();
    const app = mkApp(db, 'alice@stoagroup.com');
    const { body: created } = await request(app).post('/api/mcp').send({
      name: 'runtime-live', scope: 'user', scopeId: 'alice@stoagroup.com',
      transport: 'stdio', command: process.execPath, args: [DUMMY],
    });

    const start = await request(app).post(`/api/mcp/${created.id}/start`);
    expect(start.status).toBe(200);
    expect(start.body.status).toBe('running');

    const status = await request(app).get(`/api/mcp/${created.id}/status`);
    expect(status.status).toBe(200);
    expect(status.body.status).toBe('running');

    const tools = await request(app).get(`/api/mcp/${created.id}/tools`);
    expect(tools.status).toBe(200);
    expect(Array.isArray(tools.body.tools)).toBe(true);

    const stop = await request(app).post(`/api/mcp/${created.id}/stop`);
    expect(stop.status).toBe(200);
    expect(stop.body.status).toBe('stopped');

    const audits = db.prepare(
      "SELECT action FROM audit_log WHERE target_id=? AND action LIKE 'mcp.%'"
    ).all(created.id).map(r => r.action);
    expect(audits).toEqual(expect.arrayContaining(['mcp.create', 'mcp.start', 'mcp.stop']));
  });

  test('runtime: POST /test writes audit and returns tool list', async () => {
    const DUMMY = path.resolve(__dirname, '../unit/fixtures/dummy-mcp-server.mjs');
    const db = await freshDb();
    const app = mkApp(db, 'alice@stoagroup.com');
    const { body: created } = await request(app).post('/api/mcp').send({
      name: 'runtime-test', scope: 'user', scopeId: 'alice@stoagroup.com',
      transport: 'stdio', command: process.execPath, args: [DUMMY],
    });
    const res = await request(app).post(`/api/mcp/${created.id}/test`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const audits = db.prepare(
      "SELECT action FROM audit_log WHERE target_id=? AND action='mcp.test'"
    ).all(created.id);
    expect(audits.length).toBe(1);
  });

  test('runtime: start by non-writer -> 403', async () => {
    const db = await freshDb();
    const alice = mkApp(db, 'alice@stoagroup.com');
    const { body: created } = await request(alice).post('/api/mcp').send({
      name: 'priv-run', scope: 'user', scopeId: 'alice@stoagroup.com',
      transport: 'stdio', command: '/x',
    });
    const bob = mkApp(db, 'bob@abodingo.com');
    const r = await request(bob).post(`/api/mcp/${created.id}/start`);
    expect(r.status).toBe(403);
  });
});

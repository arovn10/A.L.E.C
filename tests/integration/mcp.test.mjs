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
  test('GET /catalog returns empty list (stubbed)', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db, 'alice@stoagroup.com')).get('/api/mcp/catalog');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
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

  test('runtime endpoints stubbed at 501', async () => {
    const db = await freshDb();
    const app = mkApp(db, 'alice@stoagroup.com');
    const { body: created } = await request(app).post('/api/mcp').send({
      name: 'stub-run', scope: 'user', scopeId: 'alice@stoagroup.com',
      transport: 'stdio', command: '/x',
    });
    for (const sub of ['start', 'stop', 'test']) {
      const r = await request(app).post(`/api/mcp/${created.id}/${sub}`);
      expect(r.status).toBe(501);
      expect(r.body.error).toBe('NOT_IMPLEMENTED');
    }
  });
});

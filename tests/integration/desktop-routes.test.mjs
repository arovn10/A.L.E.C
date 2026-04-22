// tests/integration/desktop-routes.test.mjs — S7.5
// /api/desktop/* end-to-end with a minimal express app and in-memory DB.

import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../backend/auth/bootstrap.js';
const { runMigrations } = pkg;
import { desktopRouter } from '../../backend/routes/desktop.mjs';
import * as control from '../../backend/services/desktopControl.mjs';
import * as policy from '../../backend/services/desktopPolicy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

async function freshDb() {
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  return db;
}

function mkApp(db, email = 'u@x') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email }; next(); });
  app.use('/api/desktop', desktopRouter(() => db));
  return app;
}

describe('/api/desktop', () => {
  test('GET /status returns composite snapshot', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db)).get('/api/desktop/status');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      kill_switch: 0,
      active_session: false,
      policy: { mode: 'session' },
    });
    expect(Array.isArray(res.body.permissions)).toBe(true);
    expect(res.body.permissions).toHaveLength(3);
  });

  test('PATCH /policy updates mode + kill_switch', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db))
      .patch('/api/desktop/policy')
      .send({ mode: 'auto_reads', kill_switch: true });
    expect(res.status).toBe(200);
    expect(res.body.policy.mode).toBe('auto_reads');
    expect(res.body.policy.kill_switch).toBe(1);
  });

  test('PATCH /policy rejects invalid mode', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db))
      .patch('/api/desktop/policy')
      .send({ mode: 'YOLO' });
    expect(res.status).toBe(400);
  });

  test('session start + end', async () => {
    const db = await freshDb();
    const start = await request(mkApp(db)).post('/api/desktop/session/start');
    expect(start.status).toBe(200);
    expect(start.body.token).toMatch(/^[a-f0-9-]{36}$/);
    const status1 = await request(mkApp(db)).get('/api/desktop/status');
    expect(status1.body.active_session).toBe(true);

    const end = await request(mkApp(db)).post('/api/desktop/session/end');
    expect(end.status).toBe(200);
    const status2 = await request(mkApp(db)).get('/api/desktop/status');
    expect(status2.body.active_session).toBe(false);
  });

  test('GET /audit filters action LIKE desktop.%', async () => {
    const db = await freshDb();
    // setPolicy triggers an audit row
    policy.setPolicy(db, 'u@x', { mode: 'auto_reads' });
    // Insert a non-desktop row to confirm filter
    db.prepare(
      `INSERT INTO audit_log(user_id, action, target_type, target_id)
       VALUES ('u', 'connector.create', 'connector', 'x')`
    ).run();
    const res = await request(mkApp(db)).get('/api/desktop/audit?limit=10');
    expect(res.status).toBe(200);
    for (const row of res.body.audit) {
      expect(row.action.startsWith('desktop.')).toBe(true);
    }
  });

  test('permissions/request/:id returns deeplink for known id', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db)).post('/api/desktop/permissions/request/accessibility');
    expect(res.status).toBe(200);
    expect(res.body.deeplink).toMatch(/Privacy_Accessibility/);
  });

  test('permissions/request/:id rejects unknown id', async () => {
    const db = await freshDb();
    const res = await request(mkApp(db)).post('/api/desktop/permissions/request/camera');
    expect(res.status).toBe(400);
  });

  test('POST /actions/:primitive rejects without internal token when env set', async () => {
    const db = await freshDb();
    const prev = process.env.ALEC_INTERNAL_TOKEN;
    process.env.ALEC_INTERNAL_TOKEN = 's3cr3t';
    try {
      const res = await request(mkApp(db))
        .post('/api/desktop/actions/window.list')
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('bad-internal-token');
    } finally {
      if (prev === undefined) delete process.env.ALEC_INTERNAL_TOKEN;
      else process.env.ALEC_INTERNAL_TOKEN = prev;
    }
  });

  test('POST /actions/:primitive runs through desktopControl when token matches', async () => {
    const db = await freshDb();
    const prev = process.env.ALEC_INTERNAL_TOKEN;
    process.env.ALEC_INTERNAL_TOKEN = 'abc';
    control.setApprover(async () => ({ approved: true }));
    try {
      const res = await request(mkApp(db))
        .post('/api/desktop/actions/window.list')
        .set('X-ALEC-Internal-Token', 'abc')
        .send({});
      expect(res.status).toBe(200);
      const audit = db.prepare("SELECT * FROM audit_log WHERE action='desktop.window.list'").get();
      expect(audit).toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.ALEC_INTERNAL_TOKEN;
      else process.env.ALEC_INTERNAL_TOKEN = prev;
    }
  });
});

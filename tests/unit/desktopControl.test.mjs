// tests/unit/desktopControl.test.mjs — S7.4
// Verifies desktopControl.execute() is the single gate: audit always written
// before dispatch, kill_switch blocks all primitives, unknown primitives rejected.

import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

// Mock child_process so screen.capture / window.list don't actually shell out.
jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: jest.fn(() => Buffer.from('Safari')),
  execFile: jest.fn((cmd, args, cb) => cb(null, { stdout: '', stderr: '' })),
}));

const { runMigrations } = (await import('../../backend/auth/bootstrap.js')).default;
const policy = await import('../../backend/services/desktopPolicy.mjs');
const control = await import('../../backend/services/desktopControl.mjs');

async function freshDb() {
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  return db;
}

describe('desktopControl.execute', () => {
  test('unknown primitive returns error without audit', async () => {
    const db = await freshDb();
    const res = await control.execute(db, 'nonsense.primitive', {}, { userId: 'u' });
    expect(res.error).toBe('unknown-primitive');
    const audits = db.prepare("SELECT * FROM audit_log WHERE action LIKE 'desktop.%'").all();
    expect(audits).toHaveLength(0);
  });

  test('kill_switch=1 -> every primitive returns disabled; audit row still written BEFORE execute', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { kill_switch: 1 });
    const res = await control.execute(db, 'window.list', {}, { userId: 'u', via: 'internal' });
    expect(res.error).toBe('disabled');
    const row = db.prepare("SELECT * FROM audit_log WHERE action='desktop.window.list'").get();
    expect(row).toBeTruthy();
    const meta = JSON.parse(row.metadata_json);
    expect(meta.decision).toBe('deny');
    expect(meta.via).toBe('internal');
  });

  test('keyboard.type with denylist frontmost returns disabled', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'session' });
    policy.startSession(db, 'u');
    const res = await control.execute(db, 'keyboard.type',
      { text: 'hunter2', frontmost: 'Keychain Access' }, { userId: 'u' });
    expect(res.error).toBe('disabled');
  });

  test('ask decision + approver returning false -> denied-by-user', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'always_ask' });
    control.setApprover(async () => ({ approved: false }));
    const res = await control.execute(db, 'mouse.move', { x: 1, y: 1 }, { userId: 'u' });
    expect(res.error).toBe('denied-by-user');
    const rows = db.prepare("SELECT action FROM audit_log WHERE action LIKE 'desktop.mouse.move%'").all();
    expect(rows.map(r => r.action)).toEqual(
      expect.arrayContaining(['desktop.mouse.move', 'desktop.mouse.move.denied'])
    );
  });

  test('audit redacts long text / applescript source fields', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'session' });
    policy.startSession(db, 'u');
    await control.execute(db, 'keyboard.type', { text: 'supersecret-1234' }, { userId: 'u' });
    const row = db.prepare("SELECT metadata_json FROM audit_log WHERE action='desktop.keyboard.type'").get();
    const meta = JSON.parse(row.metadata_json);
    expect(meta.args.text).toMatch(/^<\d+ chars>$/);
  });

  test('listPrimitives returns the 9 primitives', () => {
    expect(control.listPrimitives().sort()).toEqual([
      'applescript.run',
      'keyboard.press',
      'keyboard.type',
      'mouse.click',
      'mouse.move',
      'screen.capture',
      'screen.read_text',
      'window.focus',
      'window.list',
    ]);
  });
});

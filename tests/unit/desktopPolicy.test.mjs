// tests/unit/desktopPolicy.test.mjs — S7.3
// Exhaustive matrix for the policy evaluator + kill-switch + session.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../backend/auth/bootstrap.js';
const { runMigrations } = pkg;
import * as policy from '../../backend/services/desktopPolicy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

async function freshDb() {
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  return db;
}

describe('desktopPolicy', () => {
  test('getPolicy returns the seeded default row', async () => {
    const db = await freshDb();
    const p = policy.getPolicy(db);
    expect(p.key).toBe('default');
    expect(p.mode).toBe('session');
    expect(p.kill_switch).toBe(0);
  });

  test('setPolicy updates mode+kill_switch and writes an audit row', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'user@x', { mode: 'always_ask', kill_switch: 1 });
    const p = policy.getPolicy(db);
    expect(p.mode).toBe('always_ask');
    expect(p.kill_switch).toBe(1);
    expect(p.updated_by).toBe('user@x');
    const audit = db.prepare("SELECT * FROM audit_log WHERE action='desktop.policy.update'").get();
    expect(audit).toBeTruthy();
    expect(audit.user_id).toBe('user@x');
  });

  test('startSession sets token+expires, endSession clears them', async () => {
    const db = await freshDb();
    const { token, expiresAt } = policy.startSession(db, 'user@x');
    expect(token).toMatch(/^[a-f0-9-]{36}$/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
    let p = policy.getPolicy(db);
    expect(p.session_token).toBe(token);
    policy.endSession(db, 'user@x');
    p = policy.getPolicy(db);
    expect(p.session_token).toBeNull();
  });

  test('kill_switch=1 -> deny everything, including reads', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { kill_switch: 1 });
    expect(policy.evaluate(db, 'window.list', {})).toBe('deny');
    expect(policy.evaluate(db, 'mouse.click', { x: 1, y: 1 })).toBe('deny');
    expect(policy.evaluate(db, 'screen.capture', {})).toBe('deny');
    expect(policy.evaluate(db, 'applescript.run', { source: 'x' })).toBe('deny');
  });

  test('applescript.run always asks regardless of mode', async () => {
    const db = await freshDb();
    for (const mode of ['always_ask', 'session', 'auto_reads']) {
      policy.setPolicy(db, 'u', { mode });
      expect(policy.evaluate(db, 'applescript.run', { source: 'foo' })).toBe('ask');
    }
  });

  test('keyboard.type is denied when frontmost window matches denylist', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'session' });
    policy.startSession(db, 'u');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'x', frontmost: 'Keychain Access' })).toBe('deny');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'x', frontmost: '1Password 7' })).toBe('deny');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'x', frontmost: 'Bitwarden' })).toBe('deny');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'x', frontmost: 'My Vault' })).toBe('deny');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'x', frontmost: 'System Settings — Passwords' })).toBe('deny');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'x', frontmost: 'Safari' })).toBe('allow');
  });

  test('mode=always_ask -> reads allow, writes ask', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'always_ask' });
    expect(policy.evaluate(db, 'window.list', {})).toBe('allow');
    expect(policy.evaluate(db, 'screen.capture', {})).toBe('allow');
    expect(policy.evaluate(db, 'mouse.click', { x: 1, y: 1 })).toBe('ask');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'x' })).toBe('ask');
  });

  test('mode=session with active session -> allow non-destructive writes', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'session' });
    policy.startSession(db, 'u');
    expect(policy.evaluate(db, 'mouse.click', { x: 1, y: 1 })).toBe('allow');
    expect(policy.evaluate(db, 'keyboard.type', { text: 'hello' })).toBe('allow');
    expect(policy.evaluate(db, 'window.list', {})).toBe('allow');
  });

  test('mode=session without active session -> ask for writes', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'session' });
    expect(policy.evaluate(db, 'mouse.click', { x: 1, y: 1 })).toBe('ask');
    expect(policy.evaluate(db, 'window.list', {})).toBe('allow');
  });

  test('mode=session destructive flag -> ask even with session', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'session' });
    policy.startSession(db, 'u');
    expect(policy.evaluate(db, 'keyboard.press', { keys: ['cmd', 'shift', 'delete'], destructive: true })).toBe('ask');
  });

  test('mode=auto_reads -> reads allow, writes ask', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'auto_reads' });
    expect(policy.evaluate(db, 'screen.capture', {})).toBe('allow');
    expect(policy.evaluate(db, 'screen.read_text', {})).toBe('allow');
    expect(policy.evaluate(db, 'window.list', {})).toBe('allow');
    expect(policy.evaluate(db, 'mouse.move', { x: 1, y: 1 })).toBe('ask');
  });

  test('expired session is treated as no session', async () => {
    const db = await freshDb();
    policy.setPolicy(db, 'u', { mode: 'session' });
    // Inject an expired row directly
    db.prepare("UPDATE desktop_policy SET session_token='t', session_expires_at=? WHERE key='default'")
      .run(new Date(Date.now() - 1000).toISOString());
    expect(policy.evaluate(db, 'mouse.click', { x: 1, y: 1 })).toBe('ask');
  });
});

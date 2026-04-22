// tests/unit/desktopPermissions.test.mjs — S7.2
// Mocks node:child_process.execFileSync so probes work on any OS in CI.

import { jest } from '@jest/globals';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

let execScript;

jest.unstable_mockModule('node:child_process', () => ({
  execFileSync: jest.fn((...args) => execScript(args)),
}));

const { runMigrations } = (await import('../../backend/auth/bootstrap.js')).default;
const desktopPermissions = await import('../../backend/services/desktopPermissions.mjs');

async function freshDb() {
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  return db;
}

describe('desktopPermissions.probeAll', () => {
  test('all probes succeed -> granted=1 for all three and rows persist', async () => {
    const db = await freshDb();
    execScript = ([cmd]) => {
      if (cmd === 'osascript') return Buffer.from('true');
      if (cmd === 'screencapture') return Buffer.from('');
      return Buffer.from('');
    };
    const result = await desktopPermissions.probeAll(db);
    expect(result.accessibility).toBe(1);
    expect(result.screen_recording).toBe(1);
    expect(result.automation).toBe(1);

    const rows = db.prepare('SELECT id, granted FROM desktop_permissions ORDER BY id').all();
    expect(rows.find(r => r.id === 'accessibility').granted).toBe(1);
    expect(rows.find(r => r.id === 'automation').granted).toBe(1);
    expect(rows.find(r => r.id === 'screen_recording').granted).toBe(1);

    const stamped = db.prepare("SELECT last_checked, last_probed_version FROM desktop_permissions WHERE id='accessibility'").get();
    expect(stamped.last_checked).toBeTruthy();
    expect(stamped.last_probed_version).toBeTruthy();
  });

  test('probes throwing -> granted stays 0', async () => {
    const db = await freshDb();
    execScript = () => { throw new Error('TCC denied'); };
    const result = await desktopPermissions.probeAll(db);
    expect(result.accessibility).toBe(0);
    expect(result.screen_recording).toBe(0);
    expect(result.automation).toBe(0);
  });

  test('getAll returns cached rows', async () => {
    const db = await freshDb();
    execScript = ([cmd]) => cmd === 'osascript' ? Buffer.from('true') : Buffer.from('');
    await desktopPermissions.probeAll(db);
    const list = desktopPermissions.getAll(db);
    expect(list).toHaveLength(3);
    expect(list.every(r => typeof r.granted === 'number')).toBe(true);
  });
});

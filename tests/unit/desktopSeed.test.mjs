// tests/unit/desktopSeed.test.mjs — S7.1
// Assert migration 002 seeds desktop_policy + desktop_permissions rows.

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../backend/auth/bootstrap.js';
const { runMigrations } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');

describe('migration 002 — desktop seed rows', () => {
  test('desktop_policy has default singleton row', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, MIG_DIR);
    const row = db.prepare("SELECT * FROM desktop_policy WHERE key='default'").get();
    expect(row).toBeTruthy();
    expect(row.mode).toBe('session');
    expect(row.kill_switch).toBe(0);
    expect(row.updated_by).toBe('system');
  });

  test('desktop_permissions has three rows with granted=0', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, MIG_DIR);
    const rows = db.prepare('SELECT id, granted FROM desktop_permissions ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'accessibility', granted: 0 },
      { id: 'automation', granted: 0 },
      { id: 'screen_recording', granted: 0 },
    ]);
  });
});

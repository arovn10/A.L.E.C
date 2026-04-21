import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../backend/auth/bootstrap.js';
const { runMigrations } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/migrations');

describe('migration 002', () => {
  test('creates six tables + desktop tables', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, MIGRATIONS_DIR);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    for (const t of [
      'organizations', 'org_memberships', 'connector_definitions',
      'connector_instances', 'mcp_servers', 'audit_log',
      'desktop_permissions', 'desktop_policy',
    ]) {
      expect(tables).toContain(t);
    }
  });

  test('seeds desktop_policy default row and three desktop_permissions rows', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, MIGRATIONS_DIR);
    const pol = db.prepare("SELECT mode FROM desktop_policy WHERE key='default'").get();
    expect(pol).toBeDefined();
    expect(pol.mode).toBe('session');
    const perms = db.prepare('SELECT id FROM desktop_permissions ORDER BY id').all().map(r => r.id);
    expect(perms).toEqual(['accessibility', 'automation', 'screen_recording']);
  });
});

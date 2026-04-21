import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../backend/auth/bootstrap.js';
import { up as seedUp } from '../../backend/migrations/002_seed_migration.mjs';
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

  test('seed populates orgs, catalog, and arovner owner memberships', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, MIGRATIONS_DIR);
    await seedUp(db);
    const orgs = db.prepare('SELECT id FROM organizations ORDER BY id').all().map(r => r.id);
    expect(orgs).toEqual(['abodingo', 'campusrentals', 'stoagroup']);
    const defs = db.prepare('SELECT id FROM connector_definitions').all().map(r => r.id);
    expect(defs).toContain('github');
    expect(defs.length).toBeGreaterThanOrEqual(9);
    const mems = db.prepare("SELECT org_id FROM org_memberships WHERE user_id='arovner@stoagroup.com' ORDER BY org_id").all().map(r => r.org_id);
    expect(mems).toEqual(['abodingo', 'campusrentals', 'stoagroup']);

    // S4.4 — Desktop Control MCP pre-seeded (stopped, disabled).
    const desktop = db.prepare("SELECT * FROM mcp_servers WHERE id='desktop-control'").get();
    expect(desktop).toBeTruthy();
    expect(desktop.transport).toBe('stdio');
    expect(desktop.status).toBe('stopped');
    expect(desktop.enabled).toBe(0);
    expect(desktop.auto_start).toBe(0);
    expect(JSON.parse(desktop.args_json)).toEqual(['backend/mcp-servers/desktop-control/index.js']);
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

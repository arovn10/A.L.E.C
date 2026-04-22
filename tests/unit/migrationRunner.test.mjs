import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '../../backend/auth/bootstrap.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures/migration-runner');

describe('runMigrations', () => {
  test('applies .sql and .js migrations, tracks in _migrations, idempotent', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, FIXTURES);
    const ids = db.prepare('SELECT id FROM _migrations ORDER BY id').all().map(r => r.id);
    expect(ids).toEqual(['001_a', '002_b']);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    expect(tables).toContain('a');
    expect(tables).toContain('b');
    // Second run = no-op (no duplicate key errors, still 2 rows)
    await runMigrations(db, FIXTURES);
    const ids2 = db.prepare('SELECT id FROM _migrations ORDER BY id').all().map(r => r.id);
    expect(ids2).toEqual(['001_a', '002_b']);
  });
});

'use strict';
const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const TEST_DB = path.join(os.tmpdir(), `alec_test_${Date.now()}.db`);
process.env.ALEC_LOCAL_DB_PATH = TEST_DB;

const { runMigration } = require('../scripts/setupAlecDb');

const EXPECTED_TABLES = ['fine_tune_jobs', 'quality_scores', 'model_versions', 'review_queue', 'entity_cache'];

test.each(EXPECTED_TABLES)('creates table: %s', (tableName) => {
  runMigration(TEST_DB);
  const db = new Database(TEST_DB);
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  ).get(tableName);
  db.close();
  expect(row).toBeDefined();
});

test('migration is idempotent — running twice does not throw', () => {
  expect(() => {
    runMigration(TEST_DB);
    runMigration(TEST_DB);
  }).not.toThrow();
});

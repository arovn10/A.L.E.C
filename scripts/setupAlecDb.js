// scripts/setupAlecDb.js
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Database = require('better-sqlite3');
const path = require('path');

const DEFAULT_DB_PATH = process.env.ALEC_LOCAL_DB_PATH ||
  path.join(__dirname, '../data/alec.db');

const TABLES = [
  `CREATE TABLE IF NOT EXISTS fine_tune_jobs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_file    TEXT    NOT NULL,
    status        TEXT    NOT NULL DEFAULT 'pending',
    example_count INTEGER NOT NULL DEFAULT 0,
    eval_score    REAL,
    model_path    TEXT,
    approved_by   TEXT,
    started_at    DATETIME,
    finished_at   DATETIME,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS quality_scores (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id           TEXT    NOT NULL UNIQUE,
    session_id        TEXT,
    total_score       REAL    NOT NULL,
    factual_score     REAL,
    citation_score    REAL,
    completion_score  REAL,
    hallucination_score REAL,
    concision_score   REAL,
    band              TEXT    NOT NULL,
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS model_versions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    version_tag TEXT    NOT NULL UNIQUE,
    lora_path   TEXT    NOT NULL,
    eval_score  REAL    NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 0,
    promoted_by TEXT,
    promoted_at DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS review_queue (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    turn_id        TEXT    NOT NULL UNIQUE,
    session_id     TEXT,
    user_msg       TEXT    NOT NULL,
    alec_response  TEXT    NOT NULL,
    quality_score  REAL    NOT NULL,
    status         TEXT    NOT NULL DEFAULT 'pending',
    reviewed_by    TEXT,
    reviewed_at    DATETIME,
    created_at     DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS entity_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    weaviate_id TEXT    NOT NULL UNIQUE,
    entity_type TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    source      TEXT,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
];

/**
 * Idempotent migration — adds intelligence tables to alec.db.
 * Safe to run multiple times. Never modifies existing tables.
 * @param {string} [dbPath]
 */
function runMigration(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  for (const ddl of TABLES) {
    db.prepare(ddl).run();
  }
  db.close();
  console.log('[setupAlecDb] Migration complete:', dbPath);
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };

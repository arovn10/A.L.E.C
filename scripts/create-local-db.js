#!/usr/bin/env node
/**
 * A.L.E.C. Local Database Creation Script
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.ALEC_LOCAL_DB_PATH || path.join(process.cwd(), 'data', 'local-alec.db');

console.log('🏠 Creating Local Database for Personal Information Storage\n');

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
  console.log(`✅ Created directory: ${dir}`);
}

// Create database with OPEN_CREATE mode (not READWRITE)
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);

db.serialize(() => {
  // Create tables
  db.run(`CREATE TABLE IF NOT EXISTS personal_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    key_name TEXT NOT NULL,
    value TEXT NOT NULL,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(category, key_name)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS voice_interactions_local (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    wake_word TEXT,
    command TEXT NOT NULL,
    response TEXT,
    success INTEGER DEFAULT 1,
    context TEXT,
    device_id TEXT,
    location TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS user_preferences_local (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    preference_name TEXT NOT NULL,
    value TEXT NOT NULL,
    type TEXT DEFAULT 'string',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(preference_name)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS smart_home_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    current_state TEXT,
    preferred_states TEXT,
    automation_rules TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_personal_info_category ON personal_info(category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_voice_interactions_time ON voice_interactions_local(timestamp DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_smart_home_entity ON smart_home_settings(entity_id)`);

  // Insert default preferences
  db.serialize(() => {
    db.run("INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('wake_word', 'Hey Alec')");
    db.run("INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('voice_volume', '0.8')");
    db.run("INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('response_style', 'witty_and_proactive')");
  });

  console.log('✅ Database schema created successfully!');
});

db.close((err) => {
  if (err) {
    console.error('❌ Error closing database:', err.message);
    process.exit(1);
  }

  console.log(`\n💾 Local database created at: ${dbPath}`);
  console.log('\n📊 Next Steps:');
  console.log('1. Update .env.local with your Home Assistant token');
  console.log('2. Run: node scripts/test-local-database.js');
  console.log('3. Start A.L.E.C. voice interface\n');

  // Create .env.local if it doesn't exist
  const envPath = '.env.local';
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `# Local Database Configuration
ALEC_LOCAL_DB_PATH=${dbPath}

# Data Storage Strategy (choose one)
PERSONAL_DATA_STORAGE=local  # Options: local, cloud, hybrid
PERSISTENT_MEMORY_ENABLED=true
VOICE_INTERACTION_LOGGING=true

# Home Assistant Integration (set your token)
HOME_ASSISTANT_URL=http://localhost:8123
HOME_ASSISTANT_ACCESS_TOKEN=<your_long_lived_token_here>

# Voice Interface Configuration
VOICE_PORT=3002
`);
    console.log(`✅ Created ${envPath} file\n`);
  }

  process.exit(0);
});
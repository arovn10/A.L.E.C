#!/usr/bin/env node
/**
 * A.L.E.C. Local Database Service
 * Handles personal information storage locally (separate from STOA Azure Cloud)
 */

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class LocalDatabase {
  constructor() {
    this.dbPath = process.env.ALEC_LOCAL_DB_PATH ||
                  '/Users/alec/Desktop/App Development/A.L.E.C/data/local-alec.db';
    this.db = null;
    this.isConnected = false;

    console.log('🏠 Initializing Local Database Service...');
    console.log(`   Path: ${this.dbPath}`);
  }

  async connect() {
    if (this.isConnected) return true;

    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      const fs = require('fs');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE);

      await new Promise((resolve, reject) => {
        this.db.serialize(() => {
          // Create tables if they don't exist (idempotent)
          this.db.run(`CREATE TABLE IF NOT EXISTS personal_info (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category TEXT NOT NULL,
            key_name TEXT NOT NULL,
            value TEXT NOT NULL,
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category, key_name)
          )`);

          this.db.run(`CREATE TABLE IF NOT EXISTS voice_interactions_local (
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

          this.db.run(`CREATE TABLE IF NOT EXISTS user_preferences_local (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            preference_name TEXT NOT NULL,
            value TEXT NOT NULL,
            type TEXT DEFAULT 'string',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(preference_name)
          )`);

          this.db.run(`CREATE TABLE IF NOT EXISTS smart_home_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entity_id TEXT NOT NULL,
            current_state TEXT,
            preferred_states TEXT,
            automation_rules TEXT,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
          )`);

          // Create indexes for performance
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_personal_info_category ON personal_info(category)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_voice_interactions_time ON voice_interactions_local(timestamp DESC)`);
          this.db.run(`CREATE INDEX IF NOT EXISTS idx_smart_home_entity ON smart_home_settings(entity_id)`);

          // Insert default preferences if they don't exist
          this.db.serialize(() => {
            this.db.run("INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('wake_word', 'Hey Alec')");
            this.db.run("INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('voice_volume', '0.8')");
            this.db.run("INSERT OR IGNORE INTO user_preferences_local (preference_name, value) VALUES ('response_style', 'witty_and_proactive')");
          });

          resolve();
        });
      });

      this.isConnected = true;
      console.log('✅ Local Database connected successfully');

      return true;

    } catch (error) {
      console.error('❌ Failed to connect to local database:', error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.db && this.isConnected) {
      await new Promise((resolve, reject) => {
        this.db.close(reject);
      });
      this.isConnected = false;
      console.log('🔌 Local Database connection closed');
    }
  }

  // ==================== PERSONAL INFORMATION ====================

  async savePersonalInfo(category, keyName, value, metadata = {}) {
    if (!this.isConnected) await this.connect();

    const query = `
      INSERT OR REPLACE INTO personal_info (category, key_name, value, metadata, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(query, [category, keyName, JSON.stringify(value), JSON.stringify(metadata)], function(err) {
        if (err) reject(err);
        else resolve({ category, key_name: keyName });
      });
    });
  }

  async getPersonalInfo(category = null, keyName = null) {
    if (!this.isConnected) await this.connect();

    let query = 'SELECT * FROM personal_info WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }

    if (keyName) {
      query += ' AND key_name = ?';
      params.push(keyName);
    }

    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({
          ...row,
          value: JSON.parse(row.value),
          metadata: JSON.parse(row.metadata || '{}')
        })));
      });
    });
  }

  async deletePersonalInfo(category, keyName) {
    if (!this.isConnected) await this.connect();

    const query = 'DELETE FROM personal_info WHERE category = ? AND key_name = ?';

    return new Promise((resolve, reject) => {
      this.db.run(query, [category, keyName], function(err) {
        if (err) reject(err);
        else resolve({ deleted: this.changes > 0 });
      });
    });
  }

  // ==================== VOICE INTERACTIONS ====================

  async saveVoiceInteraction({ wakeWord, command, response = '', success = true, context = {}, device_id, location }) {
    if (!this.isConnected) await this.connect();

    const query = `
      INSERT INTO voice_interactions_local (wake_word, command, response, success, context, device_id, location)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(query, [
        wakeWord || null,
        command,
        response,
        success ? 1 : 0,
        JSON.stringify(context),
        device_id || null,
        location || null
      ], function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID });
      });
    });
  }

  async getVoiceInteractions(limit = 50, offset = 0) {
    if (!this.isConnected) await this.connect();

    const query = `
      SELECT * FROM voice_interactions_local
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;

    return new Promise((resolve, reject) => {
      this.db.all(query, [limit, offset], (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({
          ...row,
          context: JSON.parse(row.context || '{}')
        })));
      });
    });
  }

  async getVoiceInteractionStats() {
    if (!this.isConnected) await this.connect();

    const stats = {};

    // Total interactions
    const totalQuery = 'SELECT COUNT(*) as count FROM voice_interactions_local';
    stats.total = await new Promise((resolve, reject) => {
      this.db.get(totalQuery, (err, row) => resolve(err ? null : parseInt(row.count)));
    });

    // Success rate
    const successQuery = `
      SELECT
        COUNT(*) as total,
        SUM(success) as successful,
        CAST(SUM(success) AS FLOAT) / COUNT(*) * 100 as percentage
      FROM voice_interactions_local
    `;
    stats.successRate = await new Promise((resolve, reject) => {
      this.db.get(successQuery, (err, row) => resolve(err ? null : row));
    });

    return stats;
  }

  // ==================== USER PREFERENCES ====================

  async saveUserPreference(preferenceName, value, type = 'string') {
    if (!this.isConnected) await this.connect();

    const query = `
      INSERT OR REPLACE INTO user_preferences_local (preference_name, value, type, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(query, [preferenceName, value, type], function(err) {
        if (err) reject(err);
        else resolve({ preference_name: preferenceName });
      });
    });
  }

  async getUserPreference(preferenceName) {
    if (!this.isConnected) await this.connect();

    const query = 'SELECT * FROM user_preferences_local WHERE preference_name = ?';

    return new Promise((resolve, reject) => {
      this.db.get(query, [preferenceName], (err, row) => {
        if (err) reject(err);
        else resolve(row ? { name: row.preference_name, value: row.value, type: row.type } : null);
      });
    });
  }

  async getAllUserPreferences() {
    if (!this.isConnected) await this.connect();

    const query = 'SELECT * FROM user_preferences_local ORDER BY updated_at DESC';

    return new Promise((resolve, reject) => {
      this.db.all(query, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({ name: row.preference_name, value: row.value, type: row.type })));
      });
    });
  }

  // ==================== SMART HOME SETTINGS ====================

  async saveSmartHomeSetting(entityId, currentState = null, preferredStates = {}, automationRules = {}) {
    if (!this.isConnected) await this.connect();

    const query = `
      INSERT OR REPLACE INTO smart_home_settings (entity_id, current_state, preferred_states, automation_rules, last_updated)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(query, [
        entityId,
        currentState || null,
        JSON.stringify(preferredStates),
        JSON.stringify(automationRules)
      ], function(err) {
        if (err) reject(err);
        else resolve({ entity_id: entityId });
      });
    });
  }

  async getSmartHomeSetting(entityId) {
    if (!this.isConnected) await this.connect();

    const query = 'SELECT * FROM smart_home_settings WHERE entity_id = ?';

    return new Promise((resolve, reject) => {
      this.db.get(query, [entityId], (err, row) => {
        if (err) reject(err);
        else resolve(row ? {
          ...row,
          preferred_states: JSON.parse(row.preferred_states || '{}'),
          automation_rules: JSON.parse(row.automation_rules || '{}')
        } : null);
      });
    });
  }

  async getAllSmartHomeSettings() {
    if (!this.isConnected) await this.connect();

    const query = 'SELECT * FROM smart_home_settings ORDER BY last_updated DESC';

    return new Promise((resolve, reject) => {
      this.db.all(query, (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => ({
          ...row,
          preferred_states: JSON.parse(row.preferred_states || '{}'),
          automation_rules: JSON.parse(row.automation_rules || '{}')
        })));
      });
    });
  }

  // ==================== DATA SYNCHRONIZATION ====================

  async exportAllData() {
    if (!this.isConnected) await this.connect();

    const data = {};

    // Export all tables
    const tables = ['personal_info', 'voice_interactions_local', 'user_preferences_local', 'smart_home_settings'];

    for (const table of tables) {
      data[table] = await new Promise((resolve, reject) => {
        this.db.all(`SELECT * FROM ${table}`, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    }

    return data;
  }

  async importData(exportedData) {
    if (!this.isConnected) await this.connect();

    for (const [table, rows] of Object.entries(exportedData)) {
      for (const row of rows) {
        // Skip auto-increment ID during import
        const data = { ...row };
        delete data.id;

        await new Promise((resolve, reject) => {
          this.db.run(
            `INSERT OR REPLACE INTO ${table} (${Object.keys(data).join(', ')})`,
            Object.values(data),
            function(err) {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    }

    return true;
  }
}

module.exports = { LocalDatabase };
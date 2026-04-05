#!/usr/bin/env node
/**
 * A.L.E.C. STOA Database Connection Handler
 * Permanent data source for training and model updates
 * Supports both PostgreSQL (local/dev) and Azure SQL Server (production)
 */

require('dotenv').config();

class STOADatabase {
  constructor() {
    this.pool = null;
    this.isConnected = false;
    /** Single-flight: concurrent connect() must not create multiple pools. */
    this._connectPromise = null;
    this.isTrainingActive = false;
    this.dbType = 'postgres'; // Default to PostgreSQL

    // Validate environment variables are loaded
    if (!process.env.STOA_DB_HOST) {
      console.warn('⚠️  STOA_DB_HOST not set in .env file. Using default localhost.');
    }

    // Detect database type from environment
    const host = (process.env.STOA_DB_HOST || process.env.STOA_SERVER || '').toLowerCase();
    if (host.includes('database.windows.net') || process.env.DB_TYPE === 'sqlserver') {
      this.dbType = 'sqlserver';
      console.log('🔌 Initializing Azure SQL Server Connection...');
    } else {
      console.log('🔌 Initializing PostgreSQL Connection...');
    }

    // Configuration based on database type
    if (this.dbType === 'sqlserver') {
      this.config = {
        server: process.env.STOA_DB_HOST || process.env.STOA_SERVER || 'localhost',
        port: parseInt(process.env.STOA_DB_PORT, 10) || 1433,
        database: process.env.STOA_DB_NAME || process.env.STOA_DATABASE || 'stoagroupDB',
        userName: process.env.STOA_DB_USER || process.env.STOA_USER_ID || '',
        password: process.env.STOA_DB_PASSWORD || process.env.STOA_PASSWORD || '',
        options: {
          encrypt: true // Azure SQL requires encryption
        },
        requestTimeout: 30000
      };

      console.log('📝 Database configuration loaded:');
      console.log(`   Type: ${this.dbType}`);
      console.log(`   Host: "${process.env.STOA_DB_HOST}"`);
      console.log(`   DB: "${process.env.STOA_DB_NAME}"`);
      console.log(`   User: "${process.env.STOA_DB_USER}"`);
      console.log(`   Password length: ${(process.env.STOA_DB_PASSWORD || '').length} chars`);

    } else {
      // PostgreSQL configuration (local or cloud)
      this.config = {
        host: process.env.STOA_DB_HOST || process.env.STOA_SERVER || 'localhost',
        port: parseInt(process.env.STOA_DB_PORT, 10) || 5432,
        database: process.env.STOA_DB_NAME || process.env.STOA_DATABASE || 'altec_stoa',
        user: process.env.STOA_DB_USER || process.env.STOA_USER_ID || 'postgres',
        password: process.env.STOA_DB_PASSWORD || process.env.STOA_PASSWORD || '',
        ssl: { rejectUnauthorized: false } // For cloud PostgreSQL with SSL
      };

      console.log('📝 Database configuration loaded:');
      console.log(`   Type: ${this.dbType}`);
      console.log(`   Host: "${process.env.STOA_DB_HOST}"`);
      console.log(`   DB: "${process.env.STOA_DB_NAME}"`);
    }

    console.log('🔌 Initializing STOA Database Connection...');
  }

  async connect() {
    if (this.isConnected) return true;
    if (!this._connectPromise) {
      this._connectPromise = this._connectInternal().finally(() => {
        this._connectPromise = null;
      });
    }
    return this._connectPromise;
  }

  async _connectInternal() {
    if (this.isConnected) return true;

    try {
      const sql = require('mssql');

      // Build connection configuration for Azure SQL - explicit credentials
      let connConfig;

      if (this.dbType === 'sqlserver') {
        console.log('🔌 Using Azure SQL Server configuration...');

        // Use the new builder syntax recommended for mssql v11+
        const config = {
          server: process.env.STOA_DB_HOST,
          port: parseInt(process.env.STOA_DB_PORT),
          database: process.env.STOA_DB_NAME,
          user: process.env.STOA_DB_USER,
          password: process.env.STOA_DB_PASSWORD,
          options: {
            encrypt: true, // Azure SQL requires encryption
            trustServerCertificate: false,
            enableArithAbort: true,
            timeout: 30000
          },
          requestTimeout: 30000
        };

        console.log('🔌 Creating connection pool with credentials...');
        this.pool = new sql.ConnectionPool(config);

      } else {
        // PostgreSQL config - fallback if needed
        const pg = require('pg');
        connConfig = {
          host: process.env.STOA_DB_HOST || 'localhost',
          port: parseInt(process.env.STOA_DB_PORT) || 5432,
          database: process.env.STOA_DB_NAME || 'altec_stoa',
          user: process.env.STOA_DB_USER || 'postgres',
          password: process.env.STOA_DB_PASSWORD || '',
          ssl: { rejectUnauthorized: false }, // For cloud PostgreSQL with SSL
          connectionTimeoutMillis: 5000
        };

        console.log('🔌 Creating PostgreSQL pool...');
        this.pool = new pg.Pool(connConfig);
      }

      console.log('🔌 Connecting to database...');

      if (this.dbType === 'sqlserver') {
        await this.pool.connect();

        // Test connection and get database info for Azure SQL
        const result = await this.pool.request().query('SELECT @@VERSION as version');
        console.log('✅ Azure SQL Server connected successfully');
        console.log(`   Host: ${process.env.STOA_DB_HOST}`);
        console.log(`   Database: ${process.env.STOA_DB_NAME}`);

      } else {
        // Test connection for PostgreSQL
        const client = await this.pool.connect();
        await client.query('SELECT NOW() as now');
        client.release();

        console.log('✅ PostgreSQL connected successfully');
        console.log(`   Host: ${process.env.STOA_DB_HOST || 'localhost'}`);
        console.log(`   Database: ${process.env.STOA_DB_NAME || 'altec_stoa'}`);
      }

      // Initialize tables based on database type
      await this.initializeTables();

      this.isConnected = true;
      return true;

    } catch (error) {
      console.error('❌ STOA Database connection failed:', error.message);
      console.error('   Error code:', error.code || 'unknown');
      console.error('   SQL State:', error.sqlState || 'N/A');

      if (this.dbType === 'sqlserver') {
        if (error.code === 'ECONNREFUSED') {
          console.error('   → Connection refused. Verify firewall allows Azure SQL access.');
          console.error('   Check: https://learn.microsoft.com/en-us/azure/sql-database/firewall-configure');
          console.error('   Ensure your IP address is whitelisted in Azure portal.');
        } else if (error.code === 'ELOGIN' || error.message.includes('Login failed')) {
          console.error('   → Authentication failed. Check username/password in .env file.');
          console.error('   Please verify:');
          console.error('     STOA_DB_USER = your-username');
          console.error('     STOA_DB_PASSWORD = your-password');
          console.error('   Note: Ensure no extra spaces or special characters in password.');
          console.error('   Also ensure Azure SQL server allows connections from your IP address.');
        } else if (error.code === 'ECONNREFUSED') {
          console.error('   → Connection refused. Check firewall rules for Azure SQL.');
        }
      } else {
        if (error.code === 'ECONNREFUSED') {
          console.error('   → Connection refused. Verify PostgreSQL is running on port 5432.');
        } else if (error.code === '28000' || error.message.includes('password authentication failed')) {
          console.error('   → Authentication failed. Check username/password in .env file.');
        }
      }

      return false;
    }
  }

  /** Mark pool dead so the next operation reconnects (e.g. after ECONNCLOSED). */
  _invalidatePool() {
    this.isConnected = false;
    this.pool = null;
  }

  async initializeTables() {
    try {
      if (this.dbType === 'sqlserver') {
        // Azure SQL Server tables (T-SQL syntax)
        const sql = require('mssql');

        await this.pool.request().query(`
          IF OBJECT_ID('altec_training_data', 'U') IS NULL
            CREATE TABLE altec_training_data (
              id INT IDENTITY(1,1) PRIMARY KEY,
              user_id NVARCHAR(256),
              query NVARCHAR(MAX) NOT NULL,
              response NVARCHAR(MAX) NOT NULL,
              context NVARCHAR(MAX),
              confidence_score DECIMAL(3,2),
              learning_tags NVARCHAR(MAX),
              created_at DATETIME DEFAULT GETDATE(),
              updated_at DATETIME DEFAULT GETDATE()
            )
        `);

        await this.pool.request().query(`
          IF OBJECT_ID('stoa_group_knowledge', 'U') IS NULL
            CREATE TABLE stoa_group_knowledge (
              id INT IDENTITY(1,1) PRIMARY KEY,
              topic NVARCHAR(256) NOT NULL,
              content NVARCHAR(MAX) NOT NULL,
              source NVARCHAR(256),
              confidence DECIMAL(3,2),
              updated_by NVARCHAR(100),
              created_at DATETIME DEFAULT GETDATE(),
              updated_at DATETIME DEFAULT GETDATE()
            )
        `);

        await this.pool.request().query(`
          IF OBJECT_ID('model_updates', 'U') IS NULL
            CREATE TABLE model_updates (
              id INT IDENTITY(1,1) PRIMARY KEY,
              version NVARCHAR(50) NOT NULL,
              update_type NVARCHAR(100),
              training_data_count INT,
              performance_metrics NVARCHAR(MAX),
              created_at DATETIME DEFAULT GETDATE()
            )
        `);

      } else {
        // PostgreSQL tables (SQL syntax with JSONB support)
        const pg = require('pg');

        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS altec_training_data (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(256),
            query TEXT NOT NULL,
            response TEXT NOT NULL,
            context JSONB,
            confidence_score DECIMAL(3,2),
            learning_tags TEXT[],
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS stoa_group_knowledge (
            id SERIAL PRIMARY KEY,
            topic VARCHAR(256) NOT NULL,
            content TEXT NOT NULL,
            source VARCHAR(256),
            confidence DECIMAL(3,2),
            updated_by VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);

        await this.pool.query(`
          CREATE TABLE IF NOT EXISTS model_updates (
            id SERIAL PRIMARY KEY,
            version VARCHAR(50) NOT NULL,
            update_type VARCHAR(100),
            training_data_count INTEGER,
            performance_metrics JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
      }

      console.log('✅ STOA Database tables initialized');

    } catch (error) {
      console.error('❌ Failed to initialize database tables:', error.message);
    }
  }

  async saveTrainingData(
    { userId, query, response, context = {}, confidence_score, learning_tags },
    _retry = false,
  ) {
    if (!this.isConnected) await this.connect();

    try {
      const sql = require('mssql');

      if (this.dbType === 'sqlserver') {
        await this.pool.request()
          .input('user_id', sql.NVarChar(256), userId || 'unknown')
          .input('query', sql.NVarChar(4000), query)
          .input('response', sql.NVarChar(4000), response)
          .input('context', sql.NVarChar, JSON.stringify(context))
          .input('confidence_score', sql.Decimal(3, 2), confidence_score)
          .input('learning_tags', sql.NVarChar, Array.isArray(learning_tags) ? learning_tags.join(',') : null)
          .query(`
            INSERT INTO altec_training_data (user_id, query, response, context, confidence_score, learning_tags)
            VALUES (@user_id, @query, @response, @context, @confidence_score, @learning_tags);
            SELECT SCOPE_IDENTITY() as new_id;
          `);
      } else {
        const client = await this.pool.connect();

        await client.query(
          'INSERT INTO altec_training_data (user_id, query, response, context, confidence_score, learning_tags) VALUES ($1, $2, $3, $4, $5, $6)',
          [userId || 'unknown', query, response, JSON.stringify(context), confidence_score, Array.isArray(learning_tags) ? learning_tags : null]
        );

        client.release();
      }

      // Trigger model update if significant training data accumulated
      await this.checkTrainingDataThreshold();

      return true;

    } catch (error) {
      if (
        !_retry &&
        (error.code === 'ECONNCLOSED' || /Connection is closed/i.test(error.message || ''))
      ) {
        this._invalidatePool();
        await this.connect();
        if (this.isConnected) {
          return this.saveTrainingData(
            { userId, query, response, context, confidence_score, learning_tags },
            true,
          );
        }
      }
      console.error('❌ Failed to save training data:', error.message);
      return false;
    }
  }

  async getStoaKnowledge(topic = null, limit = 10) {
    if (!this.isConnected) await this.connect();

    const lim = Math.min(Math.max(parseInt(String(limit), 10) || 10, 1), 500);

    try {
      if (this.dbType === 'sqlserver') {
        const sql = require('mssql');
        const request = this.pool.request();
        let q = `SELECT TOP (@lim) * FROM stoa_group_knowledge WHERE confidence > 0.7`;
        request.input('lim', sql.Int, lim);
        if (topic) {
          q += ` AND topic LIKE @topicPat`;
          request.input('topicPat', sql.NVarChar(512), `%${String(topic)}%`);
        }
        q += ` ORDER BY updated_at DESC`;
        const result = await request.query(q);
        return result.recordset || [];
      }

      const client = await this.pool.connect();
      try {
        const params = [];
        let n = 1;
        let q = `SELECT * FROM stoa_group_knowledge WHERE confidence > 0.7`;
        if (topic) {
          q += ` AND topic ILIKE $${n}`;
          params.push(`%${String(topic)}%`);
          n += 1;
        }
        q += ` ORDER BY updated_at DESC LIMIT $${n}`;
        params.push(lim);
        const result = await client.query(q, params);
        return result.rows || [];
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Failed to retrieve Stoa Group knowledge:', error.message);
      return [];
    }
  }

  async updateStoaKnowledge({ topic, content, source, confidence, updated_by }) {
    if (!this.isConnected) await this.connect();

    try {
      const sql = require('mssql');

      // Check if topic exists
      const existingResult = await this.pool.request()
        .input('topic', sql.NVarChar(256), topic)
        .query(`SELECT TOP 1 id FROM stoa_group_knowledge WHERE LOWER(topic) LIKE '%' + LOWER(@topic) + '%';`);

      if (existingResult.recordset && existingResult.recordset.length > 0) {
        // Update existing entry
        await this.pool.request()
          .input('id', sql.Int, existingResult.recordset[0].id)
          .input('content', sql.NVarChar(4000), content)
          .input('source', sql.NVarChar(256), source)
          .input('confidence', sql.Decimal(3, 2), confidence)
          .input('updated_by', sql.NVarChar(100), updated_by)
          .query(`
            UPDATE stoa_group_knowledge
            SET content = @content, source = @source, confidence = @confidence, updated_by = @updated_by, updated_at = GETDATE()
            WHERE id = @id;
          `);
      } else {
        // Insert new entry
        await this.pool.request()
          .input('topic', sql.NVarChar(256), topic)
          .input('content', sql.NVarChar(4000), content)
          .input('source', sql.NVarChar(256), source)
          .input('confidence', sql.Decimal(3, 2), confidence)
          .input('updated_by', sql.NVarChar(100), updated_by)
          .query(`
            INSERT INTO stoa_group_knowledge (topic, content, source, confidence, updated_by)
            VALUES (@topic, @content, @source, @confidence, @updated_by);
          `);
      }

      // Log model update
      await this.logModelUpdate('knowledge_update', 1);

      return true;

    } catch (error) {
      console.error('❌ Failed to update Stoa Group knowledge:', error.message);
      return false;
    }
  }

  async checkTrainingDataThreshold() {
    try {
      const result = await this.pool.request().query(
        'SELECT COUNT(*) as count FROM altec_training_data WHERE created_at > DATEADD(hour, -24, GETDATE())'
      );

      const recentCount = parseInt(result.recordset[0].count);

      // If we have enough recent training data, trigger model update
      if (recentCount >= 100) {
        console.log(`🔄 Accumulated ${recentCount} training samples. Triggering model update...`);
        await this.triggerModelUpdate();
      }

    } catch (error) {
      console.error('❌ Failed to check training data threshold:', error.message);
    }
  }

  async triggerModelUpdate() {
    try {
      const sql = require('mssql');
      const updateCountResult = await this.pool.request().query(
        'SELECT COUNT(*) as count FROM model_updates WHERE created_at > DATEADD(hour, -24, GETDATE())'
      );

      if (parseInt(updateCountResult.recordset[0].count) < 5) {
        // Log new model update
        await this.pool.request()
          .input('version', sql.NVarChar(50), this.generateVersion())
          .input('update_type', sql.NVarChar(100), 'automatic_training')
          .input('training_data_count', sql.Int, 100)
          .query(`
            INSERT INTO model_updates (version, update_type, training_data_count)
            VALUES (@version, @update_type, @training_data_count);
          `);

        console.log('✅ Model update triggered and logged');
      }

    } catch (error) {
      console.error('❌ Failed to trigger model update:', error.message);
    }
  }

  generateVersion() {
    const date = new Date();
    return `v${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-auto`;
  }

  async logModelUpdate(updateType, dataCount) {
    try {
      const sql = require('mssql');

      await this.pool.request()
        .input('version', sql.NVarChar(50), this.generateVersion())
        .input('update_type', sql.NVarChar(100), updateType)
        .input('training_data_count', sql.Int, dataCount)
        .query(`
          INSERT INTO model_updates (version, update_type, training_data_count)
          VALUES (@version, @update_type, @training_data_count);
        `);

    } catch (error) {
      console.error('❌ Failed to log model update:', error.message);
    }
  }

  async getDatabaseStats() {
    if (!this.isConnected) await this.connect();

    try {
      const [trainingData, knowledge, updates] = await Promise.all([
        this.pool.request().query('SELECT COUNT(*) as count FROM altec_training_data'),
        this.pool.request().query('SELECT COUNT(DISTINCT topic) as count FROM stoa_group_knowledge'),
        this.pool.request().query('SELECT COUNT(*) as count FROM model_updates')
      ]);

      return {
        totalTrainingRecords: parseInt(trainingData.recordset[0].count),
        uniqueKnowledgeTopics: parseInt(knowledge.recordset[0].count),
        totalModelUpdates: parseInt(updates.recordset[0].count)
      };

    } catch (error) {
      console.error('❌ Failed to get database stats:', error.message);
      return null;
    }
  }

  async disconnect() {
    if (this.pool && this.pool.close) {
      await this.pool.close();
      this.isConnected = false;
      console.log('🔌 STOA Database connection closed');
    }
  }
}

module.exports = { STOADatabase };
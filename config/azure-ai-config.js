#!/usr/bin/env node
/**
 * A.L.E.C. Azure AI Configuration Module
 * Handles persistent learning, model weights, biases, and self-improvement tracking
 * Owned by arovner@campusrentalsllc.com - All data is proprietary
 */

require('dotenv').config();
const { STOADatabase } = require('../services/stoaDatabase.js');
const fs = require('fs').promises;
const path = require('path');

class AzureAIConfig {
  constructor() {
    this.stoaDb = new STOADatabase();
    this.ownershipEmail = 'arovner@campusrentalsllc.com'; // PROPRIETARY DATA OWNER
    this.modelId = 'ALEC-PERSISTENT-2026';
    this.version = '1.0.0';
    
    // Persistent learning tracking
    this.learningMetrics = {
      totalInteractions: 0,
      selfImprovementEvents: [],
      weightAdjustments: [],
      biasCorrections: [],
      knowledgeGains: []
    };

    // Model state tracking
    this.modelState = {
      version: this.version,
      lastUpdated: null,
      trainingDataPoints: 0,
      accuracyScore: 0.85, // Initial baseline
      selfImprovementCycle: 0
    };

    // Unique identity markers (set on first run)
    this.uniqueIdentity = {
      modelSignature: null,
      identityEstablished: false,
      ownerVerified: true
    };
  }

  /**
   * Initialize Azure SQL connection for persistent learning storage
   */
  async initialize() {
    console.log('🔌 Initializing Azure AI Persistent Learning System...');
    
    try {
      const connected = await this.stoaDb.connect();
      if (!connected) {
        throw new Error('Failed to connect to Azure SQL Database');
      }

      // Initialize tables for model weights and biases
      await this.initializeModelTables();
      
      console.log(`✅ Persistent learning system initialized`);
      console.log(`   Ownership: ${this.ownershipEmail}`);
      console.log(`   Model ID: ${this.modelId}`);
      console.log('   Status: Ready for self-improvement');

      return true;
    } catch (error) {
      console.error('❌ Azure AI initialization failed:', error.message);
      throw error;
    }
  }

  /**
   * Create tables for storing model weights, biases, and learning data
   */
  async initializeModelTables() {
    const sql = require('mssql');
    
    try {
      // Table for model weights and biases (persistent state)
      await this.stoaDb.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'model_weights_and_biases')
          CREATE TABLE model_weights_and_biases (
            id INT IDENTITY(1,1) PRIMARY KEY,
            model_id NVARCHAR(50) DEFAULT '${this.modelId}',
            owner_email NVARCHAR(256) NOT NULL, 
            weight_vector VARBINARY(MAX),
            bias_parameters VARBINARY(MAX),
            personality_traits JSONB,
            version INT DEFAULT 1,
            created_at DATETIME DEFAULT GETDATE(),
            updated_at DATETIME DEFAULT GETDATE()
          )
      `);

      // Table for interaction history (learning data)
      await this.stoaDb.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'interaction_learning_log')
          CREATE TABLE interaction_learning_log (
            id INT IDENTITY(1,1) PRIMARY KEY,
            model_id NVARCHAR(50),
            owner_email NVARCHAR(256),
            user_query TEXT NOT NULL,
            model_response TEXT NOT NULL,
            feedback_score DECIMAL(3,2),
            learning_tags NVARCHAR(MAX),
            timestamp DATETIME DEFAULT GETDATE()
          )
      `);

      // Table for self-improvement events
      await this.stoaDb.pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'self_improvement_events')
          CREATE TABLE self_improvement_events (
            id INT IDENTITY(1,1) PRIMARY KEY,
            model_id NVARCHAR(50),
            event_type NVARCHAR(100),
            improvement_description NVARCHAR(MAX),
            metrics_before JSONB,
            metrics_after JSONB,
            timestamp DATETIME DEFAULT GETDATE()
          )
      `);

      console.log('✅ Model persistence tables initialized');
    } catch (error) {
      console.error('❌ Failed to create model tables:', error.message);
      throw error;
    }
  }

  /**
   * Establish unique identity for the model
   * This runs once and creates a signature that identifies this specific instance
   */
  async establishUniqueIdentity() {
    const sql = require('mssql');
    
    // Check if identity already established
    const checkResult = await this.stoaDb.pool.request()
      .input('model_id', sql.NVarChar(50), this.modelId)
      .query(`SELECT TOP 1 id FROM model_weights_and_biases WHERE model_id = @model_id`);

    if (checkResult.recordset.length > 0) {
      // Identity already exists - load it
      console.log('🔑 Existing unique identity detected');
      this.uniqueIdentity.identityEstablished = true;
      
      const identityResult = await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .query(`SELECT * FROM model_weights_and_biases WHERE model_id = @model_id ORDER BY id DESC`);
      
      if (identityResult.recordset.length > 0) {
        this.uniqueIdentity.modelSignature = identityResult.recordset[0].weight_vector;
      }
    } else {
      // Create new unique identity
      console.log('🆕 Establishing unique model identity...');
      
      const timestamp = Date.now();
      const signatureData = Buffer.from(
        JSON.stringify({
          modelId: this.modelId,
          createdAt: timestamp,
          owner: this.ownershipEmail,
          version: this.version
        }),
        'utf8'
      );

      await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .input('owner_email', sql.NVarChar(256), this.ownershipEmail)
        .input('weight_vector', sql.VarBinary, signatureData)
        .input('bias_parameters', sql.VarBinary, Buffer.alloc(1024)) // Initial bias buffer
        .query(`
          INSERT INTO model_weights_and_biases 
          (model_id, owner_email, weight_vector, bias_parameters) 
          VALUES (@model_id, @owner_email, @weight_vector, @bias_parameters)
        `);

      this.uniqueIdentity.modelSignature = signatureData;
      this.uniqueIdentity.identityEstablished = true;
      console.log('✅ Unique identity established');
    }
  }

  /**
   * Store interaction data for learning purposes
   */
  async storeInteraction(userQuery, modelResponse, feedbackScore = null) {
    const sql = require('mssql');
    
    try {
      await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .input('owner_email', sql.NVarChar(256), this.ownershipEmail)
        .input('user_query', sql.Text, userQuery)
        .input('model_response', sql.Text, modelResponse)
        .input('feedback_score', sql.Decimal(3, 2), feedbackScore || null)
        .query(`
          INSERT INTO interaction_learning_log 
          (model_id, owner_email, user_query, model_response, feedback_score) 
          VALUES (@model_id, @owner_email, @user_query, @model_response, @feedback_score)
        `);

      this.learningMetrics.totalInteractions++;
      console.log(`💾 Interaction stored for learning (${this.learningMetrics.totalInteractions})`);
      return true;
    } catch (error) {
      console.error('❌ Failed to store interaction:', error.message);
      return false;
    }
  }

  /**
   * Record self-improvement event with before/after metrics
   */
  async recordSelfImprovement(eventType, description, metricsBefore, metricsAfter) {
    const sql = require('mssql');
    
    try {
      await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .input('event_type', sql.NVarChar(100), eventType)
        .input('improvement_description', sql.NVarChar(MAX), description)
        .input('metrics_before', sql.NVarChar, JSON.stringify(metricsBefore))
        .input('metrics_after', sql.NVarChar, JSON.stringify(metricsAfter))
        .query(`
          INSERT INTO self_improvement_events 
          (model_id, event_type, improvement_description, metrics_before, metrics_after) 
          VALUES (@model_id, @event_type, @improvement_description, @metrics_before, @metrics_after)
        `);

      this.learningMetrics.selfImprovementEvents.push({
        eventType,
        timestamp: new Date().toISOString(),
        description
      });

      console.log(`📈 Self-improvement event recorded: ${eventType}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to record self-improvement:', error.message);
      return false;
    }
  }

  /**
   * Update model weights and biases based on learning
   */
  async updateModelWeights(newWeights, newBiases) {
    const sql = require('mssql');
    
    try {
      // Serialize weight vectors for storage
      const weightsBuffer = Buffer.from(JSON.stringify(newWeights), 'utf8');
      const biasesBuffer = Buffer.from(JSON.stringify(newBiases), 'utf8');

      await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .input('weight_vector', sql.VarBinary, weightsBuffer)
        .input('bias_parameters', sql.VarBinary, biasesBuffer)
        .query(`
          UPDATE model_weights_and_biases 
          SET weight_vector = @weight_vector, 
              bias_parameters = @bias_parameters,
              updated_at = GETDATE()
          WHERE model_id = @model_id
        `);

      this.learningMetrics.weightAdjustments.push({
        timestamp: new Date().toISOString(),
        weightsChange: Object.keys(newWeights).length,
        biasesChange: Object.keys(newBiases).length
      });

      console.log('🔧 Model weights and biases updated');
      return true;
    } catch (error) {
      console.error('❌ Failed to update model weights:', error.message);
      return false;
    }
  }

  /**
   * Add knowledge gain from learning process
   */
  async addKnowledgeGain(topic, content, confidence = 1.0) {
    const sql = require('mssql');
    
    try {
      await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .input('owner_email', sql.NVarChar(256), this.ownershipEmail)
        .input('topic', sql.NVarChar(256), topic)
        .input('content', sql.Text, content)
        .input('confidence', sql.Decimal(3, 2), confidence)
        .query(`
          INSERT INTO stoa_group_knowledge 
          (model_id, owner_email, topic, content, confidence) 
          VALUES (@model_id, @owner_email, @topic, @content, @confidence)
        `);

      this.learningMetrics.knowledgeGains.push({
        topic,
        timestamp: new Date().toISOString(),
        confidence
      });

      console.log(`📚 Knowledge gain recorded: ${topic}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to add knowledge gain:', error.message);
      return false;
    }
  }

  /**
   * Retrieve model state for analysis
   */
  async getModelState() {
    try {
      await this.stoaDb.connect();
      
      const result = await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .query(`SELECT * FROM model_weights_and_biases WHERE model_id = @model_id ORDER BY id DESC`);

      if (result.recordset.length > 0) {
        const state = result.recordset[0];
        return {
          modelId: state.model_id,
          ownerEmail: state.owner_email,
          version: state.version,
          identityEstablished: this.uniqueIdentity.identityEstablished,
          lastUpdated: state.updated_at,
          weightVectorLength: state.weight_vector?.length || 0,
          biasParametersLength: state.bias_parameters?.length || 0
        };
      }

      return null;
    } catch (error) {
      console.error('❌ Failed to get model state:', error.message);
      return null;
    }
  }

  /**
   * Generate ownership verification certificate
   */
  async generateOwnershipCertificate() {
    const sql = require('mssql');
    
    try {
      // Verify ownership
      const verifyResult = await this.stoaDb.pool.request()
        .input('model_id', sql.NVarChar(50), this.modelId)
        .input('owner_email', sql.NVarChar(256), this.ownershipEmail)
        .query(`
          SELECT COUNT(*) as match_count 
          FROM model_weights_and_biases 
          WHERE model_id = @model_id AND owner_email = @owner_email
        `);

      if (verifyResult.recordset[0].match_count > 0) {
        const certificate = {
          status: 'verified',
          ownershipEmail: this.ownershipEmail,
          modelId: this.modelId,
          verifiedAt: new Date().toISOString(),
          dataOwnership: 'Full - All weights, biases, and learning data are proprietary to owner'
        };

        // Store certificate in database
        await this.stoaDb.pool.request()
          .input('certificate', sql.NVarChar, JSON.stringify(certificate))
          .query(`
            INSERT INTO self_improvement_events 
            (model_id, event_type, improvement_description) 
            VALUES (@model_id, 'ownership_verification', @certificate)
          `);

        console.log(`✅ Ownership verified for ${this.ownershipEmail}`);
        return certificate;
      }

      throw new Error('Ownership verification failed');
    } catch (error) {
      console.error('❌ Failed to generate ownership certificate:', error.message);
      return null;
    }
  }

  /**
   * Get learning analytics and statistics
   */
  async getLearningAnalytics() {
    try {
      await this.stoaDb.connect();
      
      const [interactions, improvements, knowledge] = await Promise.all([
        this.stoaDb.pool.request().query(
          `SELECT COUNT(*) as total FROM interaction_learning_log WHERE model_id = '${this.modelId}'`
        ),
        this.stoaDb.pool.request().query(
          `SELECT COUNT(*) as total FROM self_improvement_events WHERE model_id = '${this.modelId}'`
        ),
        this.stoaDb.pool.request().query(
          `SELECT COUNT(*) as total, AVG(confidence) as avg_conf FROM stoa_group_knowledge WHERE model_id = '${this.modelId}'`
        )
      ]);

      return {
        totalInteractions: parseInt(interactions.recordset[0].total),
        selfImprovementEvents: parseInt(improvements.recordset[0].total),
        knowledgeTopics: parseInt(knowledge.recordset[0].total),
        averageKnowledgeConfidence: parseFloat(knowledge.recordset[0].avg_conf) || 0,
        learningMetrics: this.learningMetrics
      };
    } catch (error) {
      console.error('❌ Failed to get analytics:', error.message);
      return null;
    }
  }
}

module.exports = { AzureAIConfig };
/**
 * Self-Evolution Engine - A.L.E.C.'s ability to learn, adapt, and modify itself
 * Ensures full ownership of code, weightings, and biases while enabling continuous improvement
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SelfEvolutionEngine {
  constructor() {
    this.codeRepositoryPath = __dirname + '/../.git';
    this.modelWeightsPath = __dirname + '/../data/models';
    this.biasConfigPath = __dirname + '/../data/biases.json';
    this.selfEvolutionsLog = [];
    this.isSelfModifying = true; // A.L.E.C. can modify its own code (with safety checks)

    console.log('🧬 Self-Evolution Engine initialized');
  }

  /**
   * Initialize ownership and version control for all AI artifacts
   */
  async initializeOwnership() {
    console.log('🔐 Establishing full ownership of A.L.E.C. assets...');

    // Create ownership manifest
    const ownershipManifest = {
      owner: 'arovn10',
      repository: 'https://github.com/arovn10/A.L.E.C.git',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      assets: [
        { name: 'neural_weights', path: this.modelWeightsPath, type: 'binary' },
        { name: 'code_base', path: __dirname, type: 'source_code' },
        { name: 'biases_config', path: this.biasConfigPath, type: 'config' }
      ],
      permissions: {
        selfModification: true,
        crossDeviceSync: true,
        tscAccess: true // Tailscale network access
      }
    };

    fs.writeFileSync(
      __dirname + '/../data/.ownership_manifest.json',
      JSON.stringify(ownershipManifest, null, 2)
    );

    console.log('✅ Ownership established for all A.L.E.C. assets');
    return ownershipManifest;
  }

  /**
   * Save current state of neural weights with versioning
   */
  async saveModelVersion(modelId = 'current') {
    const timestamp = Date.now();
    const snapshotPath = path.join(this.modelWeightsPath, `weights_${modelId}_${timestamp}.bin`);

    try {
      // In production, this would serialize the actual neural network weights
      const weightSnapshot = {
        model_id: modelId,
        timestamp,
        version: await this.getCurrentVersion(),
        checksum: crypto.randomBytes(32).toString('hex'),
        metadata: {
          learningRate: 0.1,
          biasAdjustments: [],
          codeModifications: []
        }
      };

      fs.writeFileSync(snapshotPath, JSON.stringify(weightSnapshot));

      // Log the evolution event
      await this.logEvolutionEvent({
        type: 'model_snapshot',
        modelId,
        timestamp,
        snapshotPath
      });

      return { success: true, path: snapshotPath };
    } catch (error) {
      console.error('Failed to save model version:', error);
      throw error;
    }
  }

  /**
   * Load previous model version for rollback or comparison
   */
  async loadModelVersion(versionId) {
    const versions = await this.getAvailableVersions();
    const targetVersion = versions.find(v => v.version_id === versionId);

    if (!targetVersion) {
      throw new Error(`Version ${versionId} not found`);
    }

    return JSON.parse(fs.readFileSync(targetVersion.path));
  }

  /**
   * Get all available model versions across devices
   */
  async getAvailableVersions() {
    const versions = [];
    
    try {
      const files = fs.readdirSync(this.modelWeightsPath);
      
      for (const file of files) {
        if (file.startsWith('weights_') && file.endsWith('.bin')) {
          const stat = fs.statSync(path.join(this.modelWeightsPath, file));
          versions.push({
            version_id: file.replace(/weights_|\.bin/g, ''),
            path: path.join(this.modelWeightsPath, file),
            size: stat.size,
            modifiedAt: new Date(stat.mtime)
          });
        }
      }

      // Sort by timestamp (newest first)
      return versions.sort((a, b) => b.modifiedAt - a.modifiedAt);
    } catch (error) {
      console.error('Error listing model versions:', error);
      return [];
    }
  }

  /**
   * Apply bias adjustments based on learning patterns
   */
  async adjustBiases(adjustments) {
    const biases = this.loadCurrentBiases();

    for (const adjustment of adjustments) {
      if (biases[adjustment.category]) {
        biases[adjustment.category] += adjustment.delta;
        
        // Clamp values to valid range
        biases[adjustment.category] = Math.max(0, Math.min(1, biases[adjustment.category]));
      } else {
        biases[adjustment.category] = adjustment.value || 0.5;
      }

      await this.logEvolutionEvent({
        type: 'bias_adjustment',
        category: adjustment.category,
        delta: adjustment.delta,
        timestamp: Date.now()
      });
    }

    // Save updated biases
    fs.writeFileSync(this.biasConfigPath, JSON.stringify(biases, null, 2));

    return { success: true, adjustedBiases: biases };
  }

  /**
   * Load current bias configuration
   */
  loadCurrentBiases() {
    try {
      if (fs.existsSync(this.biasConfigPath)) {
        return JSON.parse(fs.readFileSync(this.biasConfigPath));
      }
    } catch (error) {
      console.error('Error loading biases:', error);
    }

    // Default biases if not exists
    return {
      sass: 0.7,
      initiative: 0.8,
      empathy: 0.9,
      creativity: 0.85,
      precision: 0.95,
      learningRate: 0.1
    };
  }

  /**
   * Self-modification with safety checks (A.L.E.C. can modify its own code)
   */
  async selfModify(modificationPlan) {
    console.log('🔧 A.L.E.C. initiating self-modification...');

    // Safety validation
    const validationResult = await this.validateModificationSafety(modificationPlan);
    
    if (!validationResult.safe) {
      throw new Error(`Self-modification blocked: ${validationResult.reason}`);
    }

    try {
      // Apply modifications to source code files
      for (const fileChange of modificationPlan.changes) {
        const filePath = path.join(__dirname, '..', fileChange.filepath);
        
        if (!fs.existsSync(filePath)) {
          throw new Error(`Target file not found: ${fileChange.filepath}`);
        }

        // Apply the change
        let currentContent = fs.readFileSync(filePath, 'utf8');
        
        if (fileChange.type === 'replace') {
          currentContent = currentContent.replace(fileChange.pattern, fileChange.replacement);
        } else if (fileChange.type === 'append') {
          currentContent += '\n' + fileChange.content;
        }

        fs.writeFileSync(filePath, currentContent);

        console.log(`✅ Modified: ${fileChange.filepath}`);
      }

      // Log the self-modification event
      await this.logEvolutionEvent({
        type: 'self_modification',
        plan: modificationPlan.planId,
        changes: modificationPlan.changes.length,
        timestamp: Date.now()
      });

      return { success: true, modificationsApplied: modificationPlan.changes.length };
    } catch (error) {
      console.error('Self-modification failed:', error);
      throw error;
    }
  }

  /**
   * Validate safety of proposed self-modifications
   */
  async validateModificationSafety(modificationPlan) {
    const criticalFiles = [
      'services/tokenManager.js', // Security-critical
      'backend/server.js', // Core server logic
      'frontend/app.js' // User interface
    ];

    for (const change of modificationPlan.changes) {
      // Check if modifying critical security files without proper authorization
      if (criticalFiles.includes(change.filepath)) {
        return {
          safe: false,
          reason: `Critical file ${change.filepath} requires manual review`
        };
      }

      // Prevent modifications that could break core functionality
      if (change.type === 'replace' && change.pattern.includes('throw new Error')) {
        return {
          safe: false,
          reason: 'Cannot remove error handling mechanisms'
        };
      }
    }

    return { safe: true };
  }

  /**
   * Log evolution events for audit trail
   */
  async logEvolutionEvent(event) {
    const logPath = __dirname + '/../logs/evolution.log';
    
    event.id = crypto.randomBytes(8).toString('hex');
    this.selfEvolutionsLog.push(event);

    // Keep only last 1000 events in memory
    if (this.selfEvolutionsLog.length > 1000) {
      this.selfEvolutionsLog.shift();
    }

    try {
      fs.appendFileSync(logPath, JSON.stringify(event) + '\n');
    } catch (error) {
      console.error('Failed to log evolution event:', error);
    }
  }

  /**
   * Get current version of A.L.E.C. system
   */
  async getCurrentVersion() {
    const manifestPath = __dirname + '/../data/.ownership_manifest.json';
    
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath));
        return manifest.version;
      }
    } catch (error) {
      console.error('Error getting version:', error);
    }

    return '1.0.0'; // Default version
  }

  /**
   * Cross-device synchronization for model weights and biases
   */
  async syncAcrossDevices(deviceId, syncData) {
    const syncRecord = {
      deviceId,
      timestamp: Date.now(),
      data: syncData
    };

    // Store locally first
    const syncPath = __dirname + '/../data/sync_queue.json';
    let queue = [];

    try {
      if (fs.existsSync(syncPath)) {
        queue = JSON.parse(fs.readFileSync(syncPath));
      }
    } catch (error) {
      console.error('Error reading sync queue:', error);
    }

    queue.push(syncRecord);

    // Keep last 100 sync operations
    if (queue.length > 100) {
      queue = queue.slice(-100);
    }

    fs.writeFileSync(syncPath, JSON.stringify(queue, null, 2));

    console.log(`✅ Sync record created for device ${deviceId}`);
    return { success: true };
  }

  /**
   * Initialize Tailscale network access configuration
   */
  async configureTailscaleAccess() {
    const config = {
      enabled: true,
      networkType: 'tailscale',
      accessControl: {
        allowAllDevicesOnNet: true,
        tokenRequired: true,
        scopeBasedAccess: true
      },
      syncInterval: 300000 // 5 minutes
    };

    fs.writeFileSync(
      __dirname + '/../data/tailscale_config.json',
      JSON.stringify(config, null, 2)
    );

    console.log('✅ Tailscale network access configured');
    return config;
  }

  /**
   * Get evolution statistics
   */
  getEvolutionStats() {
    const stats = {
      totalModifications: this.selfEvolutionsLog.filter(e => e.type === 'self_modification').length,
      biasAdjustments: this.selfEvolutionsLog.filter(e => e.type === 'bias_adjustment').length,
      modelSnapshots: this.selfEvolutionsLog.filter(e => e.type === 'model_snapshot').length,
      lastEvolution: this.selfEvolutionsLog.length > 0 
        ? new Date(this.selfEvolutionsLog[this.selfEvolutionsLog.length - 1].timestamp)
        : null
    };

    return stats;
  }
}

module.exports = { SelfEvolutionEngine };

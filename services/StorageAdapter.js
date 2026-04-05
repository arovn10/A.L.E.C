/**
 * A.L.E.C. Storage Adapter - Cloud-Native Storage Layer
 * Supports local filesystem, Vercel KV, and Render API storage modes
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');

class StorageAdapter {
  constructor() {
    this.mode = process.env.STORAGE_MODE || 'local'; // local, vercel, hybrid
    this.localDataDir = path.join(process.cwd(), 'data', 'storage');
    
    console.log(`💾 Storage Adapter initialized in ${this.mode} mode`);
    this._ensureLocalDirectory();
  }

  /**
   * Ensure local storage directory exists
   */
  _ensureLocalDirectory() {
    if (!fs.existsSync(this.localDataDir)) {
      fs.mkdirSync(this.localDataDir, { recursive: true });
      console.log(`✅ Created local storage directory: ${this.localDataDir}`);
    }
  }

  /**
   * Get current storage mode configuration
   */
  getConfiguration() {
    return {
      mode: this.mode,
      localStoragePath: this.localDataDir,
      vercelUrl: process.env.VERCEL_STORAGE_URL,
      fallbackEnabled: process.env.STORAGE_FALLBACK === 'local'
    };
  }

  /**
   * Save data using appropriate storage backend
   * @param {string} key - Storage key
   * @param {object|string} value - Data to save
   */
  async save(key, value) {
    const timestamp = new Date().toISOString();
    const storageData = typeof value === 'string' ? value : JSON.stringify(value);

    switch (this.mode) {
      case 'vercel':
        return await this._saveToVercel(key, storageData, timestamp);

      case 'hybrid':
        // Save to both for redundancy
        const [localSuccess, vercelSuccess] = await Promise.all([
          this._saveLocally(key, storageData),
          this._saveToVercel(key, storageData, timestamp)
        ]);
        
        if (!localSuccess || !vercelSuccess) {
          console.warn(`⚠️ Hybrid save partial failure - local: ${localSuccess}, vercel: ${vercelSuccess}`);
        }

        return { success: true, mode: 'hybrid' };

      case 'local':
      default:
        return await this._saveLocally(key, storageData);
    }
  }

  /**
   * Load data using appropriate storage backend
   * @param {string} key - Storage key
   * @returns {Promise<object|string|null>} Retrieved data or null
   */
  async load(key) {
    switch (this.mode) {
      case 'vercel':
        return await this._loadFromVercel(key);

      case 'hybrid':
        // Try Vercel first, fallback to local
        const vercelData = await this._loadFromVercel(key);
        if (vercelData) {
          return vercelData;
        }
        
        console.log('⚠️ Vercel storage unavailable, falling back to local');
        return await this._loadLocally(key);

      case 'local':
      default:
        return await this._loadLocally(key);
    }
  }

  /**
   * Delete data from storage
   * @param {string} key - Storage key
   */
  async delete(key) {
    switch (this.mode) {
      case 'vercel':
        return await this._deleteFromVercel(key);

      case 'hybrid':
        // Delete from both for consistency
        await Promise.all([
          this._deleteLocally(key),
          this._deleteFromVercel(key)
        ]);
        
        return { success: true, mode: 'hybrid' };

      case 'local':
      default:
        return await this._deleteLocally(key);
    }
  }

  /**
   * List all available keys in storage
   */
  async listKeys() {
    switch (this.mode) {
      case 'vercel':
        return await this._listFromVercel();

      case 'hybrid':
      case 'local':
      default:
        return await this._listLocally();
    }
  }

  // ==================== LOCAL STORAGE IMPLEMENTATION ====================

  _saveLocally(key, value) {
    const filePath = path.join(this.localDataDir, `${key}.json`);
    
    try {
      fs.writeFileSync(filePath, value);
      console.log(`✅ Saved locally: ${filePath}`);
      return { success: true, mode: 'local' };
    } catch (error) {
      console.error('❌ Local save failed:', error.message);
      throw new Error(`Local storage write failed: ${error.message}`);
    }
  }

  _loadLocally(key) {
    const filePath = path.join(this.localDataDir, `${key}.json`);
    
    try {
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf8');
        console.log(`✅ Loaded from local: ${filePath}`);
        return JSON.parse(data);
      } else {
        console.warn(`⚠️ Key not found in local storage: ${key}`);
        return null;
      }
    } catch (error) {
      console.error('❌ Local load failed:', error.message);
      throw new Error(`Local storage read failed: ${error.message}`);
    }
  }

  _deleteLocally(key) {
    const filePath = path.join(this.localDataDir, `${key}.json`);
    
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`✅ Deleted local file: ${filePath}`);
        return true;
      } else {
        console.warn(`⚠️ Key not found in local storage: ${key}`);
        return false;
      }
    } catch (error) {
      console.error('❌ Local delete failed:', error.message);
      throw new Error(`Local storage deletion failed: ${error.message}`);
    }
  }

  _listLocally() {
    try {
      const files = fs.readdirSync(this.localDataDir);
      const keys = files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
      
      console.log(`✅ Listed ${keys.length} items from local storage`);
      return keys;
    } catch (error) {
      console.error('❌ Local list failed:', error.message);
      throw new Error(`Local storage listing failed: ${error.message}`);
    }
  }

  // ==================== VERCEL STORAGE IMPLEMENTATION ====================

  _saveToVercel(key, value, timestamp) {
    const axios = require('axios');
    
    return new Promise((resolve, reject) => {
      axios.post(process.env.VERCEL_STORAGE_URL || 'http://localhost:3001/api/storage', {
        key,
        value,
        timestamp
      })
      .then(response => {
        console.log(`✅ Saved to Vercel storage: ${key}`);
        resolve({ success: true, mode: 'vercel' });
      })
      .catch(error => {
        console.error('❌ Vercel save failed:', error.message);
        
        // Fallback to local if configured
        if (process.env.STORAGE_FALLBACK === 'local') {
          this._saveLocally(key, value)
            .then(result => resolve({ ...result, fallback: true }))
            .catch(reject);
        } else {
          reject(new Error(`Vercel storage write failed: ${error.message}`));
        }
      });
    });
  }

  _loadFromVercel(key) {
    const axios = require('axios');
    
    return new Promise((resolve, reject) => {
      axios.get(`${process.env.VERCEL_STORAGE_URL || 'http://localhost:3001/api/storage'}/${key}`)
      .then(response => {
        console.log(`✅ Loaded from Vercel storage: ${key}`);
        resolve(JSON.parse(response.data.value));
      })
      .catch(error => {
        if (error.response && error.response.status === 404) {
          console.warn(`⚠️ Key not found in Vercel storage: ${key}`);
          return resolve(null);
        }

        console.error('❌ Vercel load failed:', error.message);
        
        // Fallback to local if configured
        if (process.env.STORAGE_FALLBACK === 'local') {
          this._loadLocally(key)
            .then(data => resolve(data))
            .catch(() => resolve(null));
        } else {
          reject(new Error(`Vercel storage read failed: ${error.message}`));
        }
      });
    });
  }

  _deleteFromVercel(key) {
    const axios = require('axios');
    
    return new Promise((resolve, reject) => {
      axios.delete(`${process.env.VERCEL_STORAGE_URL || 'http://localhost:3001/api/storage'}/${key}`)
      .then(() => {
        console.log(`✅ Deleted from Vercel storage: ${key}`);
        resolve(true);
      })
      .catch(error => {
        if (error.response && error.response.status === 404) {
          console.warn(`⚠️ Key not found in Vercel storage: ${key}`);
          return resolve(false);
        }

        console.error('❌ Vercel delete failed:', error.message);
        
        // Fallback to local deletion attempt
        if (process.env.STORAGE_FALLBACK === 'local') {
          this._deleteLocally(key)
            .then(result => resolve(result))
            .catch(() => resolve(false));
        } else {
          reject(new Error(`Vercel storage delete failed: ${error.message}`));
        }
      });
    });
  }

  _listFromVercel() {
    const axios = require('axios');
    
    return new Promise((resolve, reject) => {
      axios.get(`${process.env.VERCEL_STORAGE_URL || 'http://localhost:3001/api/storage'}/keys`)
      .then(response => {
        console.log(`✅ Listed from Vercel storage`);
        resolve(response.data.keys || []);
      })
      .catch(error => {
        console.error('❌ Vercel list failed:', error.message);
        
        // Fallback to local listing
        if (process.env.STORAGE_FALLBACK === 'local') {
          this._listLocally()
            .then(keys => resolve(keys))
            .catch(() => resolve([]));
        } else {
          reject(new Error(`Vercel storage listing failed: ${error.message}`));
        }
      });
    });
  }
}

module.exports = { StorageAdapter };
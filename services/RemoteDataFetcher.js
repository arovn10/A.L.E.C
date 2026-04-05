/**
 * A.L.E.C. Remote Data Fetcher Service
 * Fetches data from Render API endpoints for knowledge base updates
 */

require('dotenv').config();
const axios = require('axios');
const path = require('path');

class RemoteDataFetcher {
  constructor() {
    this.renderApiKey = process.env.RENDER_API_KEY;
    this.vercelStorageUrl = process.env.VERCEL_STORAGE_URL || 'https://a-l-e-c-backend.vercel.app/api/storage';
    this.baseRenderUrl = 'https://dashboard.render.com/web/srv-d5jag6idbo4c73em4f20';
    
    console.log('🌐 Initializing Remote Data Fetcher...');
  }

  /**
   * Fetch data from Render API endpoint
   * @param {string} endpoint - API endpoint path
   * @returns {Promise<object>} Fetched data
   */
  async fetchFromRender(endpoint = '/data') {
    if (!this.renderApiKey) {
      console.warn('⚠️ RENDER_API_KEY not set, using mock data');
      return this._getMockData();
    }

    try {
      const response = await axios.get(`${this.baseRenderUrl}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${this.renderApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      console.log('✅ Successfully fetched data from Render API');
      return response.data;
    } catch (error) {
      console.error('❌ Failed to fetch from Render API:', error.message);
      
      // Fallback to local storage if cloud is unavailable
      if (process.env.STORAGE_FALLBACK === 'local') {
        return this._fetchFromLocalStorage();
      }

      throw new Error(`Render API fetch failed: ${error.message}`);
    }
  }

  /**
   * Store data in Vercel storage via API endpoint
   * @param {string} key - Storage key
   * @param {object} data - Data to store
   * @returns {Promise<object>} Storage confirmation
   */
  async storeInVercel(key, data) {
    try {
      const response = await axios.post(this.vercelStorageUrl, {
        key,
        value: JSON.stringify(data),
        timestamp: new Date().toISOString()
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ Data stored in Vercel storage under key: ${key}`);
      return response.data;
    } catch (error) {
      console.error('❌ Failed to store data in Vercel:', error.message);
      
      // Fallback to local storage
      if (process.env.STORAGE_FALLBACK === 'local') {
        return this._storeLocally(key, data);
      }

      throw new Error(`Vercel storage failed: ${error.message}`);
    }
  }

  /**
   * Retrieve data from Vercel storage via API endpoint
   * @param {string} key - Storage key
   * @returns {Promise<object|null>} Retrieved data or null if not found
   */
  async retrieveFromVercel(key) {
    try {
      const response = await axios.get(`${this.vercelStorageUrl}/${key}`, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ Retrieved data from Vercel storage for key: ${key}`);
      return JSON.parse(response.data.value);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.warn(`⚠️ Key not found in Vercel storage: ${key}`);
        return null;
      }

      console.error('❌ Failed to retrieve from Vercel:', error.message);
      
      // Fallback to local storage
      if (process.env.STORAGE_FALLBACK === 'local') {
        return this._retrieveLocally(key);
      }

      throw new Error(`Vercel retrieval failed: ${error.message}`);
    }
  }

  /**
   * Get mock data for testing when API keys are missing
   * @returns {object} Mock dataset
   */
  _getMockData() {
    return {
      knowledgeBase: [
        { id: 'doc_001', title: 'System Architecture', content: 'A.L.E.C. uses dual-database architecture...', type: 'architecture' },
        { id: 'doc_002', title: 'Voice Commands', content: 'Supported voice commands include light control, alarms, and reminders...', type: 'commands' }
      ],
      metadata: {
        lastUpdated: new Date().toISOString(),
        source: 'mock_data'
      }
    };
  }

  /**
   * Fetch data from local storage as fallback
   * @returns {Promise<object>} Local data
   */
  _fetchFromLocalStorage() {
    const fs = require('fs');
    const localPath = path.join(process.cwd(), 'data', 'render_cache.json');
    
    try {
      if (fs.existsSync(localPath)) {
        const data = JSON.parse(fs.readFileSync(localPath, 'utf8'));
        console.log('✅ Fetched from local storage cache');
        return data;
      } else {
        throw new Error('Local cache file not found');
      }
    } catch (error) {
      console.warn('⚠️ Local cache unavailable:', error.message);
      return this._getMockData();
    }
  }

  /**
   * Store data locally as fallback
   * @param {string} key - Storage key
   * @param {object} data - Data to store
   * @returns {Promise<object>} Confirmation
   */
  _storeLocally(key, data) {
    const fs = require('fs');
    const localPath = path.join(process.cwd(), 'data', `vercel_backup_${key}.json`);
    
    try {
      fs.writeFileSync(localPath, JSON.stringify(data, null, 2));
      console.log(`✅ Stored locally as fallback: ${localPath}`);
      return { success: true, storageMode: 'local' };
    } catch (error) {
      throw new Error(`Local storage failed: ${error.message}`);
    }
  }

  /**
   * Retrieve data locally as fallback
   * @param {string} key - Storage key
   * @returns {Promise<object|null>} Retrieved data or null
   */
  _retrieveLocally(key) {
    const fs = require('fs');
    const localPath = path.join(process.cwd(), 'data', `vercel_backup_${key}.json`);
    
    try {
      if (fs.existsSync(localPath)) {
        return JSON.parse(fs.readFileSync(localPath, 'utf8'));
      } else {
        return null;
      }
    } catch (error) {
      console.warn('⚠️ Local retrieval failed:', error.message);
      return null;
    }
  }

  /**
   * Sync data between Render and Vercel storage
   */
  async syncStorage() {
    try {
      // Fetch from Render
      const renderData = await this.fetchFromRender('/knowledge');
      
      // Store in Vercel
      await this.storeInVercel('knowledge_base', renderData);
      
      console.log('✅ Storage synchronization complete');
      return true;
    } catch (error) {
      console.error('❌ Storage sync failed:', error.message);
      throw error;
    }
  }
}

module.exports = { RemoteDataFetcher };
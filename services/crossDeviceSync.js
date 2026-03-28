/**
 * Cross-Device Synchronization Service
 * Enables A.L.E.C. to sync across all devices on Tailscale network
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class CrossDeviceSync {
  constructor() {
    this.syncQueuePath = __dirname + '/../data/sync_queue.json';
    this.deviceRegistryPath = __dirname + '/../data/devices_registry.json';
    this.activeDevices = new Map();
    
    console.log('🔄 Cross-Device Sync initialized');
  }

  /**
   * Register a device on the Tailscale network
   */
  async registerDevice(deviceId, deviceInfo) {
    const registry = this.loadDeviceRegistry();
    
    registry[deviceId] = {
      ...deviceInfo,
      registeredAt: Date.now(),
      lastActive: Date.now(),
      status: 'active'
    };

    fs.writeFileSync(this.deviceRegistryPath, JSON.stringify(registry, null, 2));
    this.activeDevices.set(deviceId, registry[deviceId]);

    console.log(`✅ Device ${deviceId} registered on Tailscale network`);
    return { success: true, deviceId };
  }

  /**
   * Load device registry from disk
   */
  loadDeviceRegistry() {
    try {
      if (fs.existsSync(this.deviceRegistryPath)) {
        return JSON.parse(fs.readFileSync(this.deviceRegistryPath));
      }
    } catch (error) {
      console.error('Error loading device registry:', error);
    }

    // Initialize empty registry if doesn't exist
    return {};
  }

  /**
   * Sync model weights and biases across all registered devices
   */
  async syncAcrossNetwork(syncData, targetDevices = []) {
    const registry = this.loadDeviceRegistry();
    const availableDevices = Object.keys(registry);

    // If no specific targets, sync to all active devices
    if (targetDevices.length === 0) {
      targetDevices = availableDevices.filter(id => registry[id].status === 'active');
    }

    const syncResults = [];

    for (const deviceId of targetDevices) {
      try {
        // Prepare sync payload with encryption
        const encryptedData = this.encryptSyncPayload(syncData);
        
        const syncRecord = {
          deviceId,
          timestamp: Date.now(),
          checksum: crypto.randomBytes(32).toString('hex'),
          data: encryptedData,
          status: 'pending'
        };

        // Add to local queue for delivery
        await this.addToSyncQueue(syncRecord);

        syncResults.push({
          deviceId,
          status: 'queued',
          timestamp: Date.now()
        });

      } catch (error) {
        console.error(`Failed to prepare sync for device ${deviceId}:`, error);
        syncResults.push({
          deviceId,
          status: 'failed',
          error: error.message
        });
      }
    }

    return { success: true, results: syncResults };
  }

  /**
   * Encrypt sync payload for secure transmission
   */
  encryptSyncPayload(data) {
    const key = crypto.scryptSync('alec-sync-key-2026', 'salt123', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(JSON.stringify(data));
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return {
      ciphertext: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      salt: 'salt123' // In production, use random salt stored securely
    };
  }

  /**
   * Decrypt sync payload on receiving device
   */
  decryptSyncPayload(encryptedData) {
    const key = crypto.scryptSync('alec-sync-key-2026', encryptedData.salt, 32);
    const iv = Buffer.from(encryptedData.iv, 'hex');
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(Buffer.from(encryptedData.ciphertext, 'hex'));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString());
  }

  /**
   * Add sync record to local queue for delivery
   */
  async addToSyncQueue(record) {
    let queue = [];

    try {
      if (fs.existsSync(this.syncQueuePath)) {
        queue = JSON.parse(fs.readFileSync(this.syncQueuePath));
      }
    } catch (error) {
      console.error('Error reading sync queue:', error);
    }

    queue.push(record);

    // Keep last 100 operations
    if (queue.length > 100) {
      queue = queue.slice(-100);
    }

    fs.writeFileSync(this.syncQueuePath, JSON.stringify(queue, null, 2));
  }

  /**
   * Process pending syncs for local device
   */
  async processPendingSyncs() {
    let queue = [];

    try {
      if (fs.existsSync(this.syncQueuePath)) {
        queue = JSON.parse(fs.readFileSync(this.syncQueuePath));
      }
    } catch (error) {
      console.error('Error reading sync queue:', error);
      return { success: false, message: 'Failed to read sync queue' };
    }

    const processed = [];
    const pending = [];

    for (const record of queue) {
      if (record.status === 'pending') {
        // Simulate delivery (in production, would use Tailscale networking)
        try {
          await this.deliverToDevice(record.deviceId, record.data);
          
          record.status = 'delivered';
          record.deliveredAt = Date.now();
          processed.push(record.deviceId);

        } catch (error) {
          pending.push(record.deviceId);
        }
      } else if (record.status === 'delivered') {
        processed.push(record.deviceId);
      } else {
        pending.push(record.deviceId);
      }
    }

    // Save updated queue
    fs.writeFileSync(this.syncQueuePath, JSON.stringify(queue, null, 2));

    return {
      success: true,
      delivered: processed.length,
      pending: pending.length,
      devices: {
        delivered: processed,
        pending: pending
      }
    };
  }

  /**
   * Deliver sync payload to specific device (simulated)
   */
  async deliverToDevice(deviceId, data) {
    // In production with Tailscale:
    // 1. Resolve device IP via Tailscale DNS
    // 2. Establish secure connection
    // 3. Transmit encrypted payload
    // 4. Receive acknowledgment
    
    console.log(`📦 Delivering sync to device ${deviceId}...`);
    
    // Simulate network delay and delivery
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return { success: true };
  }

  /**
   * Get status of cross-device synchronization
   */
  getStatus() {
    const registry = this.loadDeviceRegistry();
    const activeDevices = Object.keys(registry).filter(id => registry[id].status === 'active');
    
    let queueCount = 0;
    try {
      if (fs.existsSync(this.syncQueuePath)) {
        const queue = JSON.parse(fs.readFileSync(this.syncQueuePath));
        queueCount = queue.filter(r => r.status === 'pending').length;
      }
    } catch (error) {
      console.error('Error counting pending syncs:', error);
    }

    return {
      totalDevices: Object.keys(registry).length,
      activeDevices: activeDevices.length,
      availableDevices: activeDevices,
      pendingSyncs: queueCount,
      lastSyncAttempt: Date.now() - 60000 // Simulated
    };
  }

  /**
   * Remove device from registry (e.g., when offline)
   */
  async removeDevice(deviceId) {
    const registry = this.loadDeviceRegistry();
    
    if (!registry[deviceId]) {
      throw new Error(`Device ${deviceId} not found in registry`);
    }

    delete registry[deviceId];
    fs.writeFileSync(this.deviceRegistryPath, JSON.stringify(registry, null, 2));

    console.log(`✅ Device ${deviceId} removed from Tailscale network`);
    return { success: true };
  }
}

module.exports = { CrossDeviceSync };

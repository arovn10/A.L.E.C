#!/usr/bin/env node
/**
 * A.L.E.C. Smart Home Controller MCP Server
 * Control and monitor smart home devices
 */

const { NeuralEngine } = require('../neuralEngine');

class SmartHomeControllerMCP {
  constructor() {
    this.neuralEngine = new NeuralEngine();
    this.devices = new Map(); // In-memory device registry for demo
    this.initialized = false;
  }

  async initialize() {
    console.log('🏠 Initializing Smart Home Controller MCP Server...');
    await this.neuralEngine.initialize();
    this.initialized = true;
    console.log('✅ Smart Home Controller ready');
    return true;
  }

  async registerDevice(deviceId, deviceType, capabilities) {
    if (!this.initialized) await this.initialize();

    const device = {
      id: deviceId,
      type: deviceType,
      capabilities,
      status: 'offline',
      lastSeen: null
    };

    this.devices.set(deviceId, device);
    console.log(`📱 Registered device: ${deviceId} (${deviceType})`);
    return { success: true, message: `Device ${deviceId} registered` };
  }

  async controlDevice(deviceId, action, parameters = {}) {
    if (!this.initialized) await this.initialize();

    const result = await this.neuralEngine.controlSmartHome(deviceId, action, parameters);
    return result.success ? { success: true, ...result } : { error: 'Control failed' };
  }

  async getDeviceStatus(deviceId) {
    if (!this.initialized) await this.initialize();

    const device = this.devices.get(deviceId);
    if (device) {
      return { success: true, device };
    }
    return { error: 'Device not found' };
  }

  async getAllDevices() {
    if (!this.initialized) await this.initialize();

    const devices = Array.from(this.devices.values());
    return { success: true, devices };
  }

  async handleRequest(request) {
    switch (request.method) {
      case 'device/register':
        return this.registerDevice(
          request.params.deviceId,
          request.params.deviceType,
          request.params.capabilities
        );
      case 'device/control':
        return this.controlDevice(
          request.params.deviceId,
          request.params.action,
          request.params.parameters || {}
        );
      case 'device/status':
        return this.getDeviceStatus(request.params.deviceId);
      case 'devices/list':
        return this.getAllDevices();
      default:
        return { error: `Unknown method: ${request.method}` };
    }
  }

  async run() {
    await this.initialize();

    process.stdin.on('data', async (chunk) => {
      try {
        const request = JSON.parse(chunk.toString());
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (error) {
        console.error('MCP Error:', error.message);
      }
    });

    console.log('🏠 Smart Home Controller MCP Server ready');
  }
}

const server = new SmartHomeControllerMCP();
server.run().catch(console.error);

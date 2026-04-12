/**
 * Smart Home Connector — Home Assistant REST API integration
 *
 * Uses the HA long-lived access token from .env (HA_TOKEN or HOME_ASSISTANT_ACCESS_TOKEN).
 * Falls back gracefully if HA is unreachable.
 */

const HA_URL = process.env.HA_URL || process.env.HOME_ASSISTANT_URL || 'http://localhost:8123';
const HA_TOKEN = process.env.HA_TOKEN || process.env.HOME_ASSISTANT_ACCESS_TOKEN || '';

class SmartHomeConnector {
  constructor() {
    this.connected = false;
    this.devices = [];
    this.haUrl = HA_URL;
    this.haToken = HA_TOKEN;
    console.log(`🏠 Smart Home Connector init — HA at ${this.haUrl}`);
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.haToken}`,
      'Content-Type': 'application/json'
    };
  }

  async connect() {
    if (!this.haToken) {
      console.warn('⚠️  No HA_TOKEN set — smart home in mock mode');
      this._loadMockDevices();
      return { success: false, reason: 'no-token', devices: this.devices };
    }

    try {
      const resp = await fetch(`${this.haUrl}/api/`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(5000)
      });

      if (!resp.ok) {
        console.warn(`⚠️  HA returned ${resp.status} — falling back to mock devices`);
        this._loadMockDevices();
        return { success: false, reason: `ha-${resp.status}`, devices: this.devices };
      }

      await this._loadEntities();
      this.connected = true;
      console.log(`✅ Home Assistant connected — ${this.devices.length} devices`);
      return { success: true, devices: this.devices };
    } catch (err) {
      console.warn(`⚠️  HA unreachable (${err.message}) — mock mode`);
      this._loadMockDevices();
      return { success: false, reason: err.message, devices: this.devices };
    }
  }

  async _loadEntities() {
    const resp = await fetch(`${this.haUrl}/api/states`, {
      headers: this._headers(),
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) throw new Error(`States API ${resp.status}`);

    const states = await resp.json();
    // Only surface lights, climate, locks, switches, sensors
    const DOMAINS = ['light', 'climate', 'lock', 'switch', 'sensor', 'binary_sensor'];
    this.devices = states
      .filter(s => DOMAINS.includes(s.entity_id.split('.')[0]))
      .map(s => ({
        id: s.entity_id,
        name: s.attributes?.friendly_name || s.entity_id,
        type: s.entity_id.split('.')[0],
        state: s.state,
        attributes: s.attributes
      }));
  }

  _loadMockDevices() {
    this.devices = [
      { id: 'light.living_room', name: 'Living Room Lights', type: 'light', state: 'on', attributes: { brightness: 200 } },
      { id: 'climate.main_thermostat', name: 'Main Thermostat', type: 'climate', state: 'heat', attributes: { current_temperature: 72, temperature: 70 } },
      { id: 'lock.front_door', name: 'Front Door Lock', type: 'lock', state: 'locked', attributes: {} },
      { id: 'light.bedroom', name: 'Bedroom Lights', type: 'light', state: 'off', attributes: { brightness: 0 } }
    ];
  }

  /**
   * Execute a command on a Home Assistant entity.
   * In mock mode, updates local state only.
   */
  async executeCommand(entityId, action, parameters = {}) {
    const device = this.devices.find(d => d.id === entityId);
    if (!device) throw new Error(`Entity ${entityId} not found`);

    const domain = entityId.split('.')[0];
    const serviceMap = {
      turn_on: `${domain}/turn_on`,
      turn_off: `${domain}/turn_off`,
      toggle: `${domain}/toggle`,
      set_temperature: 'climate/set_temperature',
      lock: 'lock/lock',
      unlock: 'lock/unlock'
    };

    const service = serviceMap[action];
    if (!service) throw new Error(`Unknown action: ${action}`);

    if (this.connected) {
      // Real HA call
      const [svcDomain, svcName] = service.split('/');
      const resp = await fetch(`${this.haUrl}/api/services/${svcDomain}/${svcName}`, {
        method: 'POST',
        headers: this._headers(),
        body: JSON.stringify({ entity_id: entityId, ...parameters }),
        signal: AbortSignal.timeout(10000)
      });

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`HA service call failed ${resp.status}: ${body.slice(0, 100)}`);
      }

      // Refresh state from HA
      const stateResp = await fetch(`${this.haUrl}/api/states/${entityId}`, {
        headers: this._headers(),
        signal: AbortSignal.timeout(5000)
      });
      if (stateResp.ok) {
        const updated = await stateResp.json();
        device.state = updated.state;
        device.attributes = updated.attributes;
      }

      return { success: true, entityId, action, state: device.state };
    }

    // Mock mode — simulate state changes locally
    switch (action) {
      case 'turn_on':
        device.state = 'on';
        break;
      case 'turn_off':
        device.state = 'off';
        break;
      case 'toggle':
        device.state = device.state === 'on' ? 'off' : 'on';
        break;
      case 'set_temperature':
        if (parameters.temperature) device.attributes = { ...device.attributes, temperature: parameters.temperature };
        break;
      case 'lock':
        device.state = 'locked';
        break;
      case 'unlock':
        device.state = 'unlocked';
        break;
    }

    return { success: true, entityId, action, state: device.state, mock: true };
  }

  async getDeviceState(entityId) {
    if (this.connected) {
      try {
        const resp = await fetch(`${this.haUrl}/api/states/${entityId}`, {
          headers: this._headers(),
          signal: AbortSignal.timeout(5000)
        });
        if (resp.ok) return await resp.json();
      } catch { /* fall through to local */ }
    }
    return this.devices.find(d => d.id === entityId) || null;
  }

  async getDevices() {
    if (this.connected) await this._loadEntities().catch(() => {});
    return this.devices;
  }

  getStatus() {
    return {
      connected: this.connected,
      haUrl: this.haUrl,
      deviceCount: this.devices.length,
      devices: this.devices.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type,
        state: d.state
      }))
    };
  }
}

module.exports = { SmartHomeConnector };

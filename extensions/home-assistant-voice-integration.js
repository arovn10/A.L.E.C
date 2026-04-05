#!/usr/bin/env node
/**
 * A.L.E.C. Home Assistant Voice Integration Extension
 * Full voice implementation for smart home control via Home Assistant
 */

require('dotenv').config();
const WebSocket = require('ws');
const { STOADatabase } = require('../services/stoaDatabase');

class HomeAssistantVoiceIntegration {
  /** @param {{ stoaDb?: object }} [options] Pass shared `stoaDb` from index — avoids a second Azure pool. */
  constructor(options = {}) {
    this.ws = null;
    this.isConnected = false;
    this.homeAssistantUrl = process.env.HOME_ASSISTANT_URL || 'http://localhost:8123';
    this.homeAssistantToken = process.env.HOME_ASSISTANT_ACCESS_TOKEN;
    this.stoaDb = options.stoaDb || new STOADatabase();
    /** Monotonic id for HA WebSocket commands (required after auth). */
    this.haMessageId = 1;
    /** Throttle STOA writes from voice notifications (ms per entity). */
    this._lastStoaNotifyAt = new Map();

    console.log('🏠 Initializing Home Assistant Voice Integration...');
  }

  async connect() {
    if (!this.homeAssistantToken) {
      console.error('❌ HOME_ASSISTANT_ACCESS_TOKEN not configured. Cannot connect to Home Assistant.');
      return false;
    }

    try {
      // Connect via WebSocket for real-time updates
      const wsUrl = this.homeAssistantUrl.replace('http://', 'ws://').replace('https://', 'wss://') + '/api/websocket';

      console.log(`🔌 Connecting to Home Assistant WebSocket at ${wsUrl}...`);
      this.ws = new WebSocket(wsUrl);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.ws.close();
          reject(new Error('Connection timeout'));
        }, 10000);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          console.log('✅ Home Assistant WebSocket connected successfully');

          // Send authentication message
          this.sendCommand({ type: 'auth', access_token: this.homeAssistantToken });

          resolve(true);
        });

        this.ws.on('message', (data) => {
          const response = JSON.parse(data.toString());
          this.handleMessage(response);
        });

        this.ws.on('error', (error) => {
          console.error('❌ Home Assistant WebSocket error:', error.message);
          clearTimeout(timeout);
          reject(error);
        });

        this.ws.on('close', () => {
          clearTimeout(timeout);
          this.isConnected = false;
        });
      });

    } catch (error) {
      console.error('❌ Failed to connect to Home Assistant:', error.message);
      return false;
    }
  }

  sendCommand(command) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️  Cannot send command: Home Assistant WebSocket not open');
      return false;
    }
    // Auth must be sent before isConnected is true; everything else requires auth_ok first
    if (command.type !== 'auth' && !this.isConnected) {
      console.warn('⚠️  Cannot send command: not authenticated to Home Assistant yet');
      return false;
    }

    const payload = { ...command };
    if (payload.type !== 'auth' && payload.id === undefined) {
      payload.id = this.haMessageId++;
    }

    const message = JSON.stringify(payload);
    this.ws.send(message);
    console.log(`📤 Sent HA command: ${payload.type}${payload.id != null ? ` (id ${payload.id})` : ''}`);
    return true;
  }

  handleMessage(response) {
    switch (response.type) {
      case 'auth_invalid':
        console.error('❌ Home Assistant rejected the access token (auth_invalid)');
        if (response.message) console.error(`   ${response.message}`);
        console.error(
          '   Fix: Home Assistant UI → profile (bottom-left) → Security → Long-lived access tokens → Create token.',
        );
        console.error(
          '   Paste the full token into HOME_ASSISTANT_ACCESS_TOKEN in .env (one line, no spaces; usually starts with eyJ).',
        );
        this.isConnected = false;
        break;

      case 'auth_ok':
        console.log('✅ Home Assistant authentication successful');
        this.isConnected = true;

        // State updates (official API: subscribe_events + event_type, and numeric id on each command)
        this.sendCommand({ type: 'subscribe_events', event_type: 'state_changed' });
        break;

      case 'event':
        if (response.event?.event_type === 'state_changed' && response.event.data) {
          const d = response.event.data;
          console.log(`📊 Entity state changed: ${d.entity_id} → ${d.new_state?.state}`);
          this.handleStateChange(d);
        }
        break;

      case 'result':
        if (response.success) {
          console.log(`✅ HA acknowledged command (id ${response.id ?? '?'})`);
        } else {
          const err = response.error;
          const detail =
            err?.message ??
            (err?.code != null ? `code ${err.code}` : null) ??
            (err ? JSON.stringify(err) : JSON.stringify(response));
          console.error(`❌ Command failed (id ${response.id ?? '?'}): ${detail}`);
        }
        break;

      default:
        // Handle other response types as needed
        break;
    }
  }

  handleStateChange(data) {
    const entityId = data.entity_id;
    const newState = data.new_state;

    if (!newState) return;

    // Optional: persist every state change to STOA (very chatty — can exhaust Azure SQL under bursts).
    if (process.env.HA_STOA_STATE_TRAINING === 'true') {
      void this.stoaDb.saveTrainingData({
        userId: 'home_assistant_integration',
        query: `Entity ${entityId} changed to ${newState.state}`,
        response: `Updated state for ${entityId}: ${JSON.stringify(newState.attributes)}`,
        context: {
          entity_id: entityId,
          old_state: data.old_state?.state || 'unknown',
          new_state: newState.state,
          attributes: newState.attributes,
          integration_type: 'home_assistant',
        },
        confidence_score: 0.95,
        learning_tags: ['smart_home', 'voice_control', 'environmental'],
      });
    }

    if (this.shouldTriggerVoiceResponse(data)) {
      void this.triggerVoiceNotification(entityId, newState);
    }
  }

  shouldTriggerVoiceResponse(data) {
    const entityCategory = data.entity_id.split('.')[0];

    // Only trigger for important categories
    return ['light', 'switch', 'climate', 'alarm_control_panel', 'media_player'].includes(entityCategory);
  }

  async triggerVoiceNotification(entityId, state) {
    try {
      const friendlyName = state.attributes?.friendly_name || entityId;
      const voiceMessage = `Heads up! ${friendlyName} is now ${state.state}.`;

      console.log(`🔊 Voice Notification: ${voiceMessage}`);

      // Throttle STOA writes: bursts of HA events (e.g. many lights) must not open parallel Azure work.
      const minGapMs = parseInt(process.env.HA_STOA_NOTIFY_MIN_MS || '15000', 10);
      const now = Date.now();
      const last = this._lastStoaNotifyAt.get(entityId) || 0;
      if (now - last < minGapMs) return;
      this._lastStoaNotifyAt.set(entityId, now);

      if (process.env.HA_STOA_VOICE_NOTIFICATIONS === 'true') {
        await this.stoaDb.updateStoaKnowledge({
          topic: 'Voice_Notification_' + entityId,
          content: `Triggered for ${entityId}: ${state.state}`,
          source: 'home_assistant_integration',
          confidence: 0.9,
          updated_by: 'voice_system',
        });
      }
    } catch (error) {
      console.error('❌ Failed to trigger voice notification:', error.message);
    }
  }

  // Smart Home Control Methods
  /** Broadcast to every light entity (Home Assistant accepts `entity_id: "all"` for light domain). */
  async controlAllLights(action) {
    const service = action === 'on' ? 'turn_on' : action === 'off' ? 'turn_off' : null;
    if (!service) return false;
    return this.sendCommand({
      type: 'call_service',
      domain: 'light',
      service,
      service_data: { entity_id: 'all' },
    });
  }

  _haServiceResult(ok, successMessage) {
    return {
      success: !!ok,
      message: ok ? successMessage : 'Could not send command to Home Assistant (not connected or send failed).',
    };
  }

  async controlLight(entityId, action, options = {}) {
    const command = {
      type: 'call_service',
      domain: 'light',
      service: action === 'on' ? 'turn_on' :
               action === 'off' ? 'turn_off' :
               action === 'toggle' ? 'toggle' :
               action === 'brightness' ? 'turn_on' : null,
      service_data: { entity_id: entityId }
    };

    if (action === 'brightness' && options.brightness) {
      command.service_data.brightness = options.brightness;
    }

    if (action === 'color' && options.color) {
      command.service_data.rgb_color = options.color;
    }

    return this.sendCommand(command);
  }

  async controlClimate(entityId, action, options = {}) {
    const command = {
      type: 'call_service',
      domain: 'climate',
      service: action === 'heat' ? 'set_hvac_mode' :
               action === 'cool' ? 'set_hvac_mode' :
               action === 'off' ? 'set_hvac_mode' : null,
      service_data: { entity_id: entityId }
    };

    if (action === 'heat') command.service_data.hvac_mode = 'heat';
    else if (action === 'cool') command.service_data.hvac_mode = 'cool';
    else if (action === 'off') command.service_data.hvac_mode = 'off';

    if (options.temperature) {
      command.service_data.target_temperature = options.temperature;
    }

    return this.sendCommand(command);
  }

  async controlMedia(entityId, action, options = {}) {
    const serviceMap = {
      play: 'media_play',
      pause: 'media_pause',
      stop: 'media_stop',
      next: 'media_next_track',
      previous: 'media_previous_track'
    };

    const command = {
      type: 'call_service',
      domain: 'media_player',
      service: serviceMap[action] || 'media_play',
      service_data: { entity_id: entityId }
    };

    return this.sendCommand(command);
  }

  async getEntityState(entityId) {
    const command = {
      type: 'get_states',
      entity_id: entityId
    };

    // For now, we'll use the current state from our cached data
    // In a real implementation, this would query the HA database
    console.log(`📊 Querying state for ${entityId}...`);

    return {
      type: 'state',
      entity_id: entityId,
      state: 'unknown',
      attributes: {}
    };
  }

  async listEntities(domain = null) {
    const command = {
      type: 'get_states'
    };

    console.log(`📊 Listing entities${domain ? ` in ${domain} domain` : ''}...`);

    return []; // Would return actual entities in full implementation
  }

  async executeVoiceCommand(commandText) {
    try {
      const lowerCommand = commandText.toLowerCase();
      const R = (ok, msg) => this._haServiceResult(ok, msg);

      const allLights = /\b(all|every)\s+lights?\b/.test(lowerCommand);
      if (lowerCommand.includes('turn on') && lowerCommand.includes('light') && allLights) {
        const ok = await this.controlAllLights('on');
        return R(ok, 'Turned on all lights.');
      }
      if (lowerCommand.includes('turn off') && lowerCommand.includes('light') && allLights) {
        const ok = await this.controlAllLights('off');
        return R(ok, 'Turned off all lights.');
      }

      // "turn on/off the living room lights" → light.living_room (common HA naming)
      const roomLights = lowerCommand.match(
        /(?:turn\s+on|turn\s+off)\s+(?:the\s+)?(\w+)\s+room\s+lights?/,
      );
      if (roomLights) {
        const entityId = `light.${roomLights[1]}_room`;
        const action = lowerCommand.includes('turn on') ? 'on' : 'off';
        const ok = await this.controlLight(entityId, action);
        return R(ok, `Turned ${action} ${entityId.replace(/^light\./, '').replace(/_/g, ' ')}.`);
      }

      // "turn on lights kitchen" style: (light|lights) <word>
      if (lowerCommand.includes('turn on') && lowerCommand.includes('light')) {
        const match = lowerCommand.match(/(light|lights)\s+(\w+)/);
        if (match) {
          const entityId = `light.${match[2]}`;
          const ok = await this.controlLight(entityId, 'on');
          return R(ok, `Turned on ${entityId}.`);
        }
      }
      if (lowerCommand.includes('turn off') && lowerCommand.includes('light')) {
        const match = lowerCommand.match(/(light|lights)\s+(\w+)/);
        if (match) {
          const entityId = `light.${match[2]}`;
          const ok = await this.controlLight(entityId, 'off');
          return R(ok, `Turned off ${entityId}.`);
        }
      }

      if (lowerCommand.includes('set temperature')) {
        const match = lowerCommand.match(/temperature\s+(\d+)/);
        if (match) {
          const entityId = 'climate.thermostat'; // Default thermostat
          const ok = await this.controlClimate(entityId, 'heat', {
            temperature: parseInt(match[1], 10),
          });
          return R(ok, `Set thermostat toward ${match[1]}°.`);
        }
      }

      if (lowerCommand.includes('play')) {
        const match = lowerCommand.match(/(player|speaker)\s+(\w+)/);
        if (match) {
          const entityId = `media_player.${match[2]}`;
          const ok = await this.controlMedia(entityId, 'play');
          return R(ok, `Play on ${entityId}.`);
        }
      }

      console.log(`⚠️  Unrecognized voice command: ${commandText}`);
      return { success: false, message: 'Command not recognized' };
    } catch (error) {
      console.error('❌ Failed to execute voice command:', error.message);
      return { success: false, message: error.message };
    }
  }

  async disconnect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
      this.isConnected = false;
      console.log('🔌 Home Assistant WebSocket connection closed');
    }
  }
}

module.exports = { HomeAssistantVoiceIntegration };
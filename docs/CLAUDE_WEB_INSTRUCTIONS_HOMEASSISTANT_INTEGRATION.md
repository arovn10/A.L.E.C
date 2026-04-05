# 🏠 A.L.E.C. Home Assistant Voice Assistant Integration

## Instructions for Claude Web Implementation

### Overview
This document provides comprehensive instructions for implementing **A.L.E.C.** (Adaptive Learning Executive Coordinator) as a voice assistant integrated with **Home Assistant**. The implementation ensures:

- ✅ Full voice control of smart home devices
- ✅ Persistent memory and context retention
- ✅ Comprehensive data collection for learning
- ✅ Real-time device state monitoring
- ✅ Natural language processing for commands

---

## 🎯 Primary Objectives

1. **Voice Control Integration**: Enable A.L.E.C. to control all Home Assistant entities via voice commands
2. **Persistent Memory**: Ensure A.L.E.C. remembers user preferences, routines, and learned behaviors
3. **Real-time Monitoring**: Monitor device states and provide proactive notifications
4. **Data Collection**: Collect all interaction data for continuous improvement
5. **Context Awareness**: Maintain conversation context across sessions

---

## 📋 Implementation Requirements

### 1. Home Assistant Configuration

#### Required Access Token
```bash
# Generate a long-lived access token in Home Assistant:
# Settings → Users → [Your User] → Long-lived Access Tokens
# Name: A.L.E.C. Voice Integration
# Permissions: Full (or at minimum: homeassistant, media_player, light, climate)

export HOME_ASSISTANT_ACCESS_TOKEN="your_generated_token_here"
```

#### WebSocket Connection Setup
Home Assistant exposes a WebSocket API for real-time communication:
- **URL**: `ws://<ha-ip>:8123/api/websocket` or `wss://<ha-ip>:8123/api/websocket` (for SSL)
- **Authentication**: Send token in the first message

### 2. A.L.E.C. Extension Files

#### Existing Integration File
```
/Users/alec/Desktop/App Development/A.L.E.C/extensions/home-assistant-voice-integration.js
```

This file contains:
- WebSocket connection management
- Entity state monitoring
- Voice command parsing and execution
- Smart home control methods (lights, climate, media)

#### Required Dependencies
```json
{
  "dependencies": {
    "ws": "^8.x",
    "@home-assistant/ws-client": "^1.0.0" // Optional: for enhanced WebSocket handling
  }
}
```

### 3. Voice Interface Integration

#### A.L.E.C. Voice Server (Port 3002)
The existing voice interface at `ws://localhost:3002` must be extended to:
- Accept voice commands from Home Assistant users
- Route commands through the integration layer
- Return audio responses with appropriate context

---

## 🔧 Implementation Steps for Claude Web

### Step 1: Initialize A.L.E.C. Home Assistant Extension

```javascript
const { HomeAssistantVoiceIntegration } = require('./extensions/home-assistant-voice-integration');

// Create instance
const haIntegration = new HomeAssistantVoiceIntegration();

// Connect to Home Assistant
await haIntegration.connect();
```

### Step 2: Configure Real-time Monitoring

The integration automatically subscribes to state changes for:
- Lights (`light.*`)
- Switches (`switch.*`)
- Climate systems (`climate.*`)
- Alarm panels (`alarm_control_panel.*`)
- Media players (`media_player.*`)

**To add more entities**, modify the `shouldTriggerVoiceResponse()` method in the integration file.

### Step 3: Implement Voice Command Parsing

A.L.E.C. supports natural language commands like:
- "Turn on the living room light"
- "Set temperature to 72 degrees"
- "Play music on bedroom speaker"
- "Is the front door locked?"

**Implement command routing** in the `executeVoiceCommand()` method with these patterns:

```javascript
// Example pattern matching for lights
if (lowerCommand.includes('turn on') && lowerCommand.includes('light')) {
  const match = lowerCommand.match(/(light|lights)\s+(\w+)/);
  if (match) {
    const entityId = `light.${match[2]}`;
    return await this.controlLight(entityId, 'on');
  }
}

// Example pattern matching for climate
if (lowerCommand.includes('set temperature')) {
  const match = lowerCommand.match(/temperature\s+(\d+)/);
  if (match) {
    const entityId = 'climate.thermostat'; // Or dynamic discovery
    return await this.controlClimate(entityId, 'heat', {
      temperature: parseInt(match[1])
    });
  }
}
```

### Step 4: Entity Discovery System

Implement automatic entity discovery to map user-friendly names to Home Assistant entity IDs:

```javascript
async discoverEntityByName(friendlyName) {
  const entities = await this.listEntities();

  // Find matching entity by friendly name
  const match = entities.find(entity =>
    entity.attributes?.friendly_name?.toLowerCase().includes(
      friendlyName.toLowerCase()
    )
  );

  return match ? match.entity_id : null;
}
```

### Step 5: Persistent Memory Implementation

A.L.E.C. must remember:
- **User Preferences**: Favorite scenes, preferred temperatures, lighting preferences
- **Routines**: "Good Morning" routine, "Away Mode", etc.
- **Context**: Recent commands, current room focus, active devices

**Implementation in STOA Database:**

```javascript
// Save user preference
await this.stoaDb.updateStoaKnowledge({
  topic: 'User_Preference_' + Date.now(),
  content: `Preferred temperature: 72°F for bedroom`,
  source: 'voice_interaction',
  confidence: 0.95,
  updated_by: 'user'
});

// Retrieve preference later
const preferences = await this.stoaDb.getStoaKnowledge('User_Preference');
```

### Step 6: Data Collection Strategy

**Collect ALL interaction data:**

1. **Voice Commands**: Store every command issued by users
2. **System Responses**: Log all responses provided by A.L.E.C.
3. **Device States**: Track state changes and user reactions
4. **Context Windows**: Maintain conversation history (16K token context)
5. **Learning Tags**: Tag interactions with categories for better learning

**Implementation:**

```javascript
// In executeVoiceCommand() method, add:
await this.stoaDb.saveTrainingData({
  userId: currentUser,
  query: commandText,
  response: result.message || 'Command executed',
  context: {
    entity_id: processedEntityId,
    action: actionType,
    success: result.success,
    timestamp: new Date().toISOString()
  },
  confidence_score: result.success ? 1.0 : 0.5,
  learning_tags: ['voice_command', 'smart_home', 'device_control']
});
```

### Step 7: Proactive Notifications System

A.L.E.C. should proactively notify users about:
- **Security Alerts**: Door unlocked after scheduled time
- **Energy Savings**: "Heating turned off, potential savings of $X/month"
- **Device Status**: "Living room light has been on for 12 hours"
- **Weather Integration**: "It's getting cold, should I adjust the thermostat?"

**Implementation:**

```javascript
// In handleStateChange() method:
if (this.shouldTriggerProactiveNotification(data)) {
  await this.triggerProactiveNotification(data);
}
```

### Step 8: Error Handling and Fallbacks

Implement robust error handling:
- **Entity Not Found**: "I couldn't find a light named that"
- **Permission Denied**: "I don't have permission to control that device"
- **Network Issues**: "I'm having trouble connecting to your smart home"
- **Ambiguous Commands**: "Did you mean [suggested entity]?"

---

## 📊 Data Collection Schema

### Training Data Structure (STOA Database)

```sql
-- Table: altec_training_data
{
  id: INT,
  user_id: VARCHAR(256),
  query: TEXT,              // User's voice command or question
  response: TEXT,           // A.L.E.C.'s response
  context: JSONB,           // Additional context (device states, etc.)
  confidence_score: DECIMAL(3,2),
  learning_tags: TEXT[],    // Tags for categorization
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP
}
```

### Knowledge Base Structure

```sql
-- Table: stoa_group_knowledge
{
  id: INT,
  topic: VARCHAR(256),      // Topic identifier
  content: TEXT,            // Knowledge content
  source: VARCHAR(256),     // Source of knowledge
  confidence: DECIMAL(3,2), // Reliability score
  updated_by: VARCHAR(100),
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP
}
```

---

## 🎙️ Voice Interface Specifications

### WebSocket Protocol (Port 3002)

**Client → Server:**
```json
{
  "type": "voice_command",
  "command": "Turn on living room light",
  "timestamp": "2026-04-07T10:30:00Z"
}
```

**Server → Client:**
```json
{
  "type": "response",
  "message": "Turning on the living room light",
  "success": true,
  "entity_id": "light.living_room",
  "timestamp": "2026-04-07T10:30:01Z"
}
```

### Audio Response Format
- **Text-to-Speech**: Use Home Assistant's built-in TTS or A.L.E.C.'s voice engine
- **Response Length**: Keep under 8 seconds for natural conversation flow
- **Confirmation**: Always confirm successful actions ("Living room light is now on")
- **Error Messages**: Clear, helpful error messages without technical jargon

---

## 🔒 Security Considerations

### Access Control
1. **Token Management**: Store Home Assistant token securely (environment variables)
2. **User Authentication**: Verify user identity before executing sensitive commands
3. **Command Validation**: Validate all voice commands before execution
4. **Rate Limiting**: Prevent command spamming

### Data Privacy
1. **Encryption**: All communication encrypted via WebSocket TLS
2. **Data Retention**: Implement data retention policies for training data
3. **User Consent**: Obtain user consent for data collection and learning
4. **GDPR Compliance**: Allow users to request deletion of their data

---

## 🚀 Testing Checklist

Before deployment, verify:

- [ ] WebSocket connection to Home Assistant established successfully
- [ ] Entity discovery working for all device types
- [ ] Voice commands parsed correctly for common patterns
- [ ] State changes trigger appropriate notifications
- [ ] Persistent memory stores and retrieves user preferences
- [ ] Data collection logs all interactions
- [ ] Error handling provides helpful feedback
- [ ] Security tokens are properly secured
- [ ] Real-time monitoring updates device states promptly

---

## 📚 Reference Files

### Core Files to Modify/Create:
1. `/extensions/home-assistant-voice-integration.js` - Main integration logic
2. `/backend/server.js` - Extend voice interface WebSocket handling
3. `/scripts/init-stoa-knowledge.js` - Initialize STOA knowledge base
4. `.env` - Configure Home Assistant credentials

### Environment Variables Required:
```bash
HOME_ASSISTANT_URL=http://localhost:8123
HOME_ASSISTANT_ACCESS_TOKEN=your_long_lived_token_here
VOICE_PORT=3002
STOA_DB_HOST=stoagroupdb.database.windows.net
STOA_DB_NAME=stoagroupDB
STOA_DB_USER=arovner
```

---

## 🎯 Success Criteria

The implementation is successful when:

1. ✅ Users can control all smart home devices via voice commands
2. ✅ A.L.E.C. remembers user preferences across sessions
3. ✅ Real-time device state monitoring works reliably
4. ✅ All interactions are logged for learning and improvement
5. ✅ Proactive notifications provide useful insights
6. ✅ Error messages are clear and helpful
7. ✅ Security and privacy requirements are met

---

## 📞 Support & Troubleshooting

### Common Issues:

**Connection Failed:**
- Check Home Assistant is running
- Verify access token is valid
- Ensure firewall allows WebSocket connections on port 8123

**Commands Not Working:**
- Verify entity IDs exist in Home Assistant
- Check user permissions for the accessed entities
- Review command parsing logic for edge cases

**Memory Not Persisting:**
- Verify STOA database connection
- Check confidence scoring thresholds
- Ensure update methods are called correctly

---

## 📝 Final Notes

This integration transforms A.L.E.C. into a comprehensive voice assistant that:
- Seamlessly controls your smart home ecosystem
- Learns from every interaction to improve over time
- Remembers your preferences and routines
- Provides proactive notifications for better living
- Collects all data for continuous improvement

**Remember**: The key to success is ensuring A.L.E.C. collects ALL data and maintains persistent memory of user interactions, preferences, and learned behaviors.

---

*Document Version: 1.0*
*Last Updated: 2026-04-07*
*Author: STOA Group Development Team*
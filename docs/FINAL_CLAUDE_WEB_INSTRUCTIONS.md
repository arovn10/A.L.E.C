# 🎯 Final Implementation Instructions for Claude Web

## A.L.E.C. - Voice Assistant with Home Integration

**Status**: ✅ Ready for implementation
**Wake Word**: "Hey Alec" (case-insensitive)
**Home Server IP**: 100.81.193.45

---

## 📋 What You Need to Implement

### Core Features Required

1. **Voice Interface with Wake Word Detection**
   - Detect wake word: "Hey Alec"
   - Process commands after wake word is detected
   - Return audio/text responses

2. **Home Assistant Integration**
   - WebSocket connection to Home Assistant
   - Real-time device state monitoring
   - Voice command execution for lights, climate, media

3. **Alexa-style Features**
   - ⏰ Alarm system (set, cancel, list)
   - 📝 Reminder system (create, complete, list)
   - 🛒 Grocery list (add items with categories, view by category)

4. **Dual Database Architecture**
   - Local SQLite: Personal info, preferences, voice cache
   - Azure SQL Cloud: STOA knowledge base, model training data

5. **Complete Data Collection**
   - Log ALL voice interactions
   - Track context and success metrics
   - Enable continuous AI learning

---

## 🚀 Quick Start Implementation

### Step 1: Install Required Dependencies

```bash
cd /Users/alec/Desktop/App Development/A.L.E.C
npm install ws dotenv mssql sqlite3 axios
```

### Step 2: Verify Database Setup

```bash
# Local database should already be created
node scripts/test-local-database.js

# STOA knowledge base should be loaded
node scripts/init-stoa-knowledge.js

# Verify both are working
node scripts/test-stoa-knowledge.js
```

### Step 3: Configure Home Assistant Connection

Edit `.env.local` with your Home Assistant credentials:

```bash
HOME_ASSISTANT_URL=http://localhost:8123
HOME_ASSISTANT_ACCESS_TOKEN=<your_long_lived_token_here>
```

**How to get the token:**
1. Go to Home Assistant → Settings → Users → [Your User]
2. Click "Long-lived access tokens"
3. Create new token with name "A.L.E.C."
4. Grant permissions: `homeassistant`, `media_player`, `light`, `climate`
5. Copy the token and paste in `.env.local`

### Step 4: Implement Main Voice Interface

Create `index.js`:

```javascript
const { HomeAssistantVoiceIntegrationEnhanced } = require('./extensions/home-assistant-voice-integration-enhanced');
const { LocalDatabase } = require('./services/localDatabase');
const { STOADatabase } = require('./services/stoaDatabase');

async function main() {
  // Initialize services
  const localDb = new LocalDatabase();
  const stoaDb = new STOADatabase();
  const haIntegration = new HomeAssistantVoiceIntegrationEnhanced();

  // Connect to all databases and systems
  await localDb.connect();      // ← Personal data storage (LOCAL)
  await stoaDb.connect();       // ← STOA knowledge base (CLOUD)
  await haIntegration.connect(); // ← Home Assistant WebSocket

  console.log('✅ All services initialized!');

  // Voice interface WebSocket server (port 3002)
  const WebSocket = require('ws');
  const wss = new WebSocket.Server({ port: 3002 });

  wss.on('connection', (ws) => {
    console.log('🎤 Voice client connected');

    ws.on('message', async (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'voice_command') {
          // Process with wake word detection
          const response = await processVoiceCommand(message.command);

          ws.send(JSON.stringify({
            type: 'response',
            ...response,
            timestamp: new Date().toISOString()
          }));
        }
      } catch (error) {
        console.error('Error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message,
          timestamp: new Date().toISOString()
        }));
      }
    });

    ws.on('close', () => {
      console.log('🎤 Voice client disconnected');
    });
  });

  console.log('🎙️ A.L.E.C. voice interface running on port 3002\n');

  // Example: Set up an alarm via API
  const result = await haIntegration.setAlarm('07:00 AM', 'Wake Up Alarm');
  console.log(result);

  // Example: Add to grocery list
  const groceries = await haIntegration.addToGroceryList('milk', '2 gallons', 'dairy');
  console.log(groceries);
}

async function processVoiceCommand(text) {
  // Detect wake word
  const detectedWakeWord = haIntegration.detectWakeWord(text);

  if (detectedWakeWord) {
    // Extract command after wake word
    const commandAfterWakeWord = text.replace(/hey\s*alec/i, '').trim();

    console.log(`🎤 Wake word detected! Command: "${commandAfterWakeWord}"`);

    // Log to local database for quick access
    await localDb.saveVoiceInteraction({
      wake_word: 'Hey Alec',
      command: commandAfterWakeWord,
      context: { raw_text: text }
    });

    // Execute the command
    const result = await haIntegration.executeVoiceCommand(commandAfterWakeWord);

    // Update log with response
    await localDb.saveVoiceInteraction({
      wake_word: 'Hey Alec',
      command: commandAfterWakeWord,
      response: result.message || JSON.stringify(result),
      success: result.success
    });

    return result;
  }

  // No wake word detected - handle as regular query
  const stoaQuery = await stoaDb.getStoaKnowledge('general');
  return { message: "Please say 'Hey Alec' first.", wake_word_detected: false };
}

main().catch(console.error);
```

### Step 5: Test the System

1. **Start A.L.E.C.** (in one terminal):
   ```bash
   node index.js
   ```

2. **Send test command via WebSocket** (another terminal):
   ```bash
   # Install wscat if not already installed
   npm install -g wscat

   # Connect and send wake word + command
   wscat -c ws://localhost:3002 -x '{"type":"voice_command","command":"Hey Alec, set alarm for 7am"}'
   ```

3. **Expected output**:
   ```json
   {
     "success": true,
     "message": "Alarm set for 07:00 AM",
     "alarm_id": "alarm_1234567890"
   }
   ```

---

## 🎯 Implementation Checklist for Claude Web

### Phase 1: Voice Interface Setup (Priority: HIGH)

- [ ] Create WebSocket server on port 3002
- [ ] Implement wake word detection ("Hey Alec")
- [ ] Process voice commands after wake word
- [ ] Log all interactions to local database
- [ ] Return appropriate responses

### Phase 2: Home Assistant Integration (Priority: HIGH)

- [ ] Establish WebSocket connection to HA
- [ ] Subscribe to device state changes
- [ ] Implement light control methods
- [ ] Implement climate control methods
- [ ] Implement media player control methods
- [ ] Create entity discovery system

### Phase 3: Alexa-style Features (Priority: MEDIUM)

- [ ] Alarm system implementation
  - Set alarms with time and labels
  - Cancel specific/all alarms
  - List active alarms

- [ ] Reminder system implementation
  - Create reminders with scheduled times
  - Mark reminders as complete
  - List active/completed reminders

- [ ] Grocery list implementation
  - Add items with quantities/categories
  - Remove items from list
  - View items grouped by category

### Phase 4: Data Collection & Learning (Priority: LOW)

- [ ] Log ALL voice interactions to local cache
- [ ] Sync critical data to cloud database
- [ ] Implement learning tags system
- [ ] Track confidence scores
- [ ] Monitor interaction success rates

---

## 📊 Voice Command Examples

### Wake Word + Smart Home Commands

```javascript
// User says: "Hey Alec, turn on the living room light"
// A.L.E.C. processes: "turn on the living room light"
{
  command: "Turn on the living room light",
  response: "Turning on the living room light",
  entity_id: "light.living_room",
  success: true
}

// User says: "Hey Alec, set temperature to 72 degrees"
{
  command: "Set temperature to 72 degrees",
  response: "Setting thermostat to 72°F",
  entity_id: "climate.thermostat",
  success: true
}

// User says: "Hey Alec, play music on bedroom speaker"
{
  command: "Play music on bedroom speaker",
  response: "Playing music on bedroom speaker",
  entity_id: "media_player.bedroom_speaker",
  success: true
}
```

### Wake Word + Alarm Commands (Alexa-style)

```javascript
// User says: "Hey Alec, set an alarm for 7am"
{
  command: "Set an alarm for 7am",
  response: "Alarm set for 07:00 AM. Will repeat daily.",
  alarm_id: "alarm_1234567890",
  success: true
}

// User says: "Hey Alec, what alarms do I have?"
{
  command: "What alarms do I have?",
  response: "You have 2 active alarms.",
  count: 2,
  alarms: [
    { id: "alarm_1234567890", time: "07:00 AM", label: "Wake Up" },
    { id: "alarm_9876543210", time: "08:00 PM", label: "Bedtime Alarm" }
  ],
  success: true
}

// User says: "Hey Alec, cancel my alarm"
{
  command: "Cancel my alarm",
  response: "All alarms canceled",
  count: 2,
  success: true
}
```

### Wake Word + Reminder Commands (Alexa-style)

```javascript
// User says: "Hey Alec, set a reminder to call mom at 5pm"
{
  command: "Set a reminder to call mom at 5pm",
  response: "Reminder set at 17:00: Call mom",
  reminder_id: "reminder_1234567890",
  success: true
}

// User says: "Hey Alec, show my reminders"
{
  command: "Show my reminders",
  response: "You have 3 active reminders.",
  count: 3,
  reminders: [
    { id: "reminder_1234567890", text: "Call mom at 5pm", scheduled_time: "2026-04-07T17:00:00Z" }
  ],
  success: true
}

// User says: "Hey Alec, complete reminder"
{
  command: "Complete reminder",
  response: "Reminder completed: Call mom at 5pm",
  success: true
}
```

### Wake Word + Grocery List Commands (Alexa-style)

```javascript
// User says: "Hey Alec, add milk to my grocery list"
{
  command: "Add milk to my grocery list",
  response: "Added '2 gallons of milk' to grocery list (dairy category)",
  item: "milk",
  quantity: "2 gallons",
  category: "dairy",
  success: true
}

// User says: "Hey Alec, what's on the shopping list?"
{
  command: "What's on the shopping list?",
  response: "You have 5 items on your grocery list.",
  categories: ["produce", "dairy", "meat", "bakery"],
  items: {
    produce: [
      { item: "apples", quantity: "6", category: "produce" }
    ],
    dairy: [
      { item: "milk", quantity: "2 gallons", category: "dairy" }
    ]
  },
  success: true
}

// User says: "Hey Alec, remove eggs from grocery list"
{
  command: "Remove eggs from grocery list",
  response: "Removed 'eggs' from grocery list",
  success: true
}
```

---

## 🔧 Troubleshooting Guide

### Issue: Wake word not detected
**Solution**: Check microphone permissions and audio input levels. Verify wake word pattern in `home-assistant-voice-integration-enhanced.js`.

### Issue: Home Assistant connection fails
**Solution**:
1. Verify token is valid long-lived access token
2. Ensure HA WebSocket API is enabled (default)
3. Check firewall rules for port 8123

### Issue: Commands not executing properly
**Solution**: Review command parsing in `executeVoiceCommand()` method. Test with simple commands first ("turn on light").

### Issue: Database errors
**Solution**:
- Run `node scripts/test-local-database.js` to verify local DB
- Check `.env.local` configuration
- Verify Azure SQL Server connection parameters

---

## 📚 Reference Files

| File | Purpose | Location |
|------|---------|----------|
| Home Assistant Integration | Voice interface with smart home control | `extensions/home-assistant-voice-integration-enhanced.js` |
| Local Database Service | Personal information storage (SQLite) | `services/localDatabase.js` |
| STOA Database Service | Knowledge base access (Azure SQL) | `services/stoaDatabase.js` |
| Wake Word Detection | Pattern matching for "Hey Alec" | In integration file above |

---

## 🎉 Success Criteria

Your implementation is complete when:

✅ Users can control smart home devices with voice commands
✅ Wake word "Hey Alec" triggers system activation
✅ Alarms, reminders, and grocery list work like Alexa
✅ All data collected for continuous AI learning
✅ Personal information stored locally (secure)
✅ STOA knowledge base queried correctly (cloud)
✅ Real-time device state monitoring active

---

## 📞 Support & Questions

If you encounter issues during implementation:
1. Check the logs in your terminal
2. Verify all environment variables are set
3. Run test scripts to diagnose specific components
4. Review the documentation files for detailed explanations

**Key Documentation:**
- `docs/FINAL_CLAUDE_WEB_INSTRUCTIONS.md` - This file
- `docs/DATABASE_ARCHITECTURE.md` - Dual-database explanation
- `docs/IMPLEMENTATION_SUMMARY.md` - High-level overview
- `docs/CLAUDE_WEB_INSTRUCTIONS_HOMEASSISTANT_INTEGRATION.md` - HA integration guide

---

*Document Version: 3.0 (Final)*
*Last Updated: 2026-04-07*
*Author: STOA Group Development Team*
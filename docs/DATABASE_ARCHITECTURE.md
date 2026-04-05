# 🗄️ A.L.E.C. Database Architecture

## Overview

A.L.E.C. uses a **dual-database architecture** to optimize performance, security, and data management:

1. **Local SQLite Database**: Personal information, preferences, and voice interaction cache (stored on home server)
2. **Azure SQL Server Cloud**: STOA Group knowledge base, model training data, and persistent memory

---

## 📊 Database Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    A.L.E.C. System                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  Local Database  │         │   Azure SQL      │         │
│  │  (SQLite)        │◄────────►│   Server (Cloud) │         │
│  │                  │ Sync     │                  │         │
│  │  Location:       │          │  Location:       │         │
│  │  Home Server     │          │  Azure Cloud     │         │
│  │  IP: 100.81.193.45│          │  Host:           │         │
│  │                  │          │  stoagroupdb...  │         │
│  └──────────────────┘          └──────────────────┘         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    Data Flow                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User Voice Commands → Local Cache → STOA Knowledge Query   │
│  Personal Preferences ← Local Storage ← Sync with Cloud     │
│  Model Updates → Cloud Training Data ← Learning Results     │
│  Smart Home Control ← Real-time State ← HA Integration      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏠 Local Database (SQLite)

### Location & Configuration

**Path**: `/Users/alec/Desktop/App Development/A.L.E.C/data/local-alec.db`
**Home Server IP**: `100.81.193.45`
**Access Method**: SSH connection via setup script

### Purpose
- Store **personal information** (user data, preferences)
- Cache **voice interactions** for quick access
- Maintain **smart home settings** locally
- Enable **offline functionality** when cloud is unavailable

### Data Storage Strategy

```javascript
// Personal Information (LOCAL - Private & Secure)
{
  category: 'personal_info',
  key_name: 'user_name',
  value: 'Alec',
  metadata: { privacy_level: 'private' }
}

// Voice Interactions (HYBRID - Local cache + Cloud backup)
{
  wake_word: 'Hey Alec',
  command: 'Set alarm for 7am',
  response: 'Alarm set for 7am',
  success: true,
  context: { time: '07:00' }
}

// User Preferences (LOCAL - Fast access)
{
  preference_name: 'wake_word',
  value: 'Hey Alec',
  type: 'string'
}

// Smart Home Settings (LOCAL - Real-time control)
{
  entity_id: 'light.living_room',
  current_state: 'on',
  preferred_states: { morning: 'warm_white', evening: 'dimmed' }
}
```

### Database Schema

#### Table: `personal_info`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| category | TEXT | Category (personal, preferences, etc.) |
| key_name | TEXT | Unique identifier within category |
| value | TEXT | Stored value (JSON string) |
| metadata | JSONB | Additional context/metadata |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

#### Table: `voice_interactions_local`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| timestamp | DATETIME | When interaction occurred |
| wake_word | TEXT | Wake word used (e.g., "Hey Alec") |
| command | TEXT | User's voice command |
| response | TEXT | A.L.E.C.'s response |
| success | INTEGER | 1 for success, 0 for failure |
| context | JSONB | Additional interaction context |
| device_id | TEXT | Device that received the command |
| location | TEXT | Physical location of user |

#### Table: `user_preferences_local`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| preference_name | TEXT | Unique preference name |
| value | TEXT | Preference value |
| type | TEXT | Data type (string, number, boolean) |
| updated_at | DATETIME | Last update timestamp |

#### Table: `smart_home_settings`
| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| entity_id | TEXT | Home Assistant entity ID |
| current_state | TEXT | Current device state |
| preferred_states | JSONB | User's preferred states per time |
| automation_rules | JSONB | Custom automation rules |
| last_updated | DATETIME | Last update timestamp |

---

## ☁️ Azure SQL Server Cloud Database

### Connection Configuration

**Host**: `stoagroupdb.database.windows.net`
**Database Name**: `stoagroupDB`
**User**: `arovner`
**SSL Required**: Yes (Azure default)

### Purpose
- Store **STOA Group knowledge base**
- Maintain **AI model training data**
- Track **model updates and performance**
- Provide **persistent memory across sessions**

### Data Storage Strategy

```javascript
// STOA Group Knowledge (CLOUD - Shared & Persistent)
{
  topic: 'A.L.E.C._Purpose',
  content: 'Adaptive Learning Executive Coordinator...',
  source: 'System_Design',
  confidence: 1.0,
  updated_by: 'system'
}

// Model Training Data (CLOUD - For AI learning)
{
  user_id: 'voice_user',
  query: 'What is the weather?',
  response: 'It is sunny with high of 75°F',
  confidence_score: 0.95,
  learning_tags: ['weather_query']
}

// Model Updates (CLOUD - Version tracking)
{
  version: 'v20260407-auto',
  update_type: 'automatic_training',
  training_data_count: 150
}
```

### Database Schema

#### Table: `altec_training_data`
| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key (auto-increment) |
| user_id | NVARCHAR(256) | User identifier |
| query | NVARCHAR(MAX) | User's question/command |
| response | NVARCHAR(MAX) | System's answer |
| context | NVARCHAR(MAX) | Additional context (JSON) |
| confidence_score | DECIMAL(3,2) | Reliability score (0.0-1.0) |
| learning_tags | NVARCHAR(MAX) | Comma-separated tags |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

#### Table: `stoa_group_knowledge`
| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key (auto-increment) |
| topic | NVARCHAR(256) | Knowledge topic identifier |
| content | NVARCHAR(MAX) | Knowledge content |
| source | NVARCHAR(256) | Source of knowledge |
| confidence | DECIMAL(3,2) | Reliability score (0.0-1.0) |
| updated_by | NVARCHAR(100) | Who/what updated it |
| created_at | DATETIME | Creation timestamp |
| updated_at | DATETIME | Last update timestamp |

#### Table: `model_updates`
| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key (auto-increment) |
| version | NVARCHAR(50) | Model version string |
| update_type | NVARCHAR(100) | Type of update |
| training_data_count | INT | Number of samples used |
| performance_metrics | NVARCHAR(MAX) | JSON metrics data |
| created_at | DATETIME | Update timestamp |

---

## 🔄 Data Synchronization Strategy

### When to Use Local Database

**Use LOCAL database for:**
- ✅ Personal information (user name, preferences)
- ✅ Voice interaction cache (last 100 interactions)
- ✅ Real-time smart home device states
- ✅ Offline functionality requirements
- ✅ Quick preference lookups (<5ms response time needed)

### When to Use Cloud Database

**Use CLOUD database for:**
- ✅ STOA Group knowledge base queries
- ✅ Model training data collection
- ✅ Long-term interaction history (for AI learning)
- ✅ Cross-session memory persistence
- ✅ Knowledge sharing across devices/users

### Synchronization Rules

```javascript
// Sync from Cloud to Local (when connected)
1. Pull latest STOA Group knowledge topics
2. Update local cache with new knowledge items
3. Sync user preferences from cloud backup

// Sync from Local to Cloud (for learning)
1. Upload voice interaction data to training_data table
2. Store learned patterns in model_updates
3. Backup personal information to secure cloud storage
```

---

## 🔐 Security & Privacy

### Personal Data Protection

**Local Storage:**
- ✅ Encrypted at rest (SQLite encryption via SQLCipher)
- ✅ Access controlled by file permissions
- ✅ No network exposure for sensitive data
- ✅ User consent required for cloud backup

**Cloud Storage:**
- ✅ TLS 1.3 encryption in transit
- ✅ Azure security compliance (GDPR, SOC2)
- ✅ Role-based access control
- ✅ Audit logging for all access

### Data Ownership

| Data Type | Primary Location | Backup Location | Access Control |
|-----------|------------------|-----------------|----------------|
| Personal Info | Local SQLite | Optional Cloud | User Only |
| Voice Commands | Local Cache + Cloud | Azure SQL Server | A.L.E.C. System |
| Preferences | Local SQLite | Synced to Cloud | A.L.E.C. + User |
| STOA Knowledge | Azure SQL Server | N/A | STOA Group Admins |

---

## 🛠️ Implementation Guide for Claude Web

### Step 1: Setup Local Database

Run the setup script on your local machine:

```bash
cd /Users/alec/Desktop/App Development/A.L.E.C
chmod +x scripts/setup-local-database.sh
./scripts/setup-local-database.sh
```

This will:
- Create SSH connection to home server (100.81.193.45)
- Install PostgreSQL if needed
- Create SQLite database at `/Users/alec/Desktop/App Development/A.L.E.C/data/local-alec.db`
- Configure environment variables in `.env.local`

### Step 2: Configure Environment Variables

Edit `.env.local`:

```bash
# Local Database Configuration
ALEC_LOCAL_DB_PATH=/Users/alec/Desktop/App Development/A.L.E.C/data/local-alec.db
ALEC_DATABASE_HOST=100.81.193.45
ALEC_DATABASE_NAME=alec_local_db
ALEC_DATABASE_USER=alec_user
ALEC_DATABASE_PASSWORD=<generated_password>

# Data Storage Strategy (Choose one)
PERSONAL_DATA_STORAGE=local  # Options: local, cloud, hybrid
PERSISTENT_MEMORY_ENABLED=true
VOICE_INTERACTION_LOGGING=true
```

### Step 3: Initialize Database Services

In your A.L.E.C. initialization code:

```javascript
const { LocalDatabase } = require('./services/localDatabase');
const { STOADatabase } = require('./services/stoaDatabase');

// Create instances
const localDb = new LocalDatabase();
const stoaDb = new STOADatabase();

// Connect to both databases
await localDb.connect();  // ← Personal data storage
await stoaDb.connect();   // ← STOA knowledge base
```

### Step 4: Implement Data Routing Logic

Create a routing middleware to direct queries appropriately:

```javascript
class DatabaseRouter {
  constructor(localDb, stoaDb) {
    this.localDb = localDb;
    this.stoaDb = stoaDb;
  }

  async routeQuery(queryType, data) {
    switch (queryType) {
      case 'personal_info':
        return await this.localDb.getPersonalInfo(data.category, data.keyName);

      case 'voice_interaction_cache':
        return await this.localDb.saveVoiceInteraction({ ...data });

      case 'user_preferences':
        return await this.localDb.getUserPreference(data.preference_name);

      case 'stoa_knowledge_query':
        return await this.stoaDb.getStoaKnowledge(data.topic);

      case 'model_training_data':
        return await this.stoaDb.saveTrainingData({ ...data });

      default:
        throw new Error(`Unknown query type: ${queryType}`);
    }
  }
}

const router = new DatabaseRouter(localDb, stoaDb);
```

### Step 5: Implement Wake Word Detection

Use the enhanced integration file:

```javascript
const { HomeAssistantVoiceIntegrationEnhanced } =
  require('./extensions/home-assistant-voice-integration-enhanced');

const haIntegration = new HomeAssistantVoiceIntegrationEnhanced();

// Process wake word commands
async function processUserCommand(text) {
  const detectedWakeWord = await haIntegration.detectWakeWord(text);

  if (detectedWakeWord) {
    // Extract command after wake word and execute
    const commandAfterWakeWord = text.replace(/hey\s*alec/i, '').trim();

    // Log to local database for quick access
    await router.routeQuery('voice_interaction_cache', {
      wake_word: 'Hey Alec',
      command: commandAfterWakeWord,
      response: null,  // Will be filled after execution
      context: { raw_text: text }
    });

    const result = await haIntegration.executeVoiceCommand(commandAfterWakeWord);

    // Update log with response
    await router.routeQuery('voice_interaction_cache', {
      wake_word: 'Hey Alec',
      command: commandAfterWakeWord,
      response: result.message || JSON.stringify(result),
      success: result.success
    });

    return result;
  }

  // No wake word detected - handle as regular text query
  const stoaQuery = await router.routeQuery('stoa_knowledge_query', { topic: 'general' });
  return stoaQuery;
}
```

### Step 6: Implement Alarm, Reminder & Grocery List Features

Use the enhanced integration methods:

```javascript
// Set an alarm
await haIntegration.setAlarm('07:00 AM', 'Wake Up Alarm');

// Get active alarms
const alarms = await haIntegration.getActiveAlarms();

// Set a reminder
await haIntegration.setReminder('Call mom at 5pm', new Date().toISOString());

// Add to grocery list
await haIntegration.addToGroceryList('milk', '2 gallons', 'dairy');

// Get grocery list by category
const groceries = await haIntegration.getGroceryList();
console.log(groceries.items); // Grouped by category (produce, dairy, meat, etc.)
```

### Step 7: Implement Data Collection for Learning

A.L.E.C. should collect ALL data for continuous improvement:

```javascript
// Every voice interaction gets logged
async function logInteraction(wakeWord, command, response, success) {
  // Local cache (fast access)
  await router.routeQuery('voice_interaction_cache', {
    wake_word: wakeWord,
    command: command,
    response: response,
    success: success ? 1 : 0
  });

  // Cloud backup for AI training
  await router.routeQuery('model_training_data', {
    user_id: 'voice_user',
    query: command,
    response: response,
    confidence_score: success ? 1.0 : 0.5,
    learning_tags: [wakeWord.toLowerCase().replace('hey ', '')]
  });

  // Update STOA knowledge with learned patterns
  await router.routeQuery('knowledge_update', {
    topic: `Learned_${command.substring(0, 20)}`,
    content: response,
    source: 'voice_interaction'
  });
}
```

---

## 📈 Performance Optimization

### Local Database (SQLite)

**Optimization Strategies:**
1. **Indexing**: Create indexes on frequently queried columns
2. **Connection Pooling**: Reuse database connections
3. **Query Caching**: Cache frequent queries for 5-10 seconds
4. **Batch Operations**: Group multiple writes into single transactions

**Expected Performance:**
- Query response time: <5ms (95th percentile)
- Concurrent users supported: 50+
- Data storage capacity: 1GB+ (SQLite limit)

### Cloud Database (Azure SQL Server)

**Optimization Strategies:**
1. **Connection Pooling**: Use mssql pool with appropriate sizing
2. **Query Optimization**: Use parameterized queries and proper indexing
3. **Read Replicas**: For read-heavy workloads (future enhancement)
4. **CDN Caching**: Cache STOA knowledge responses globally

**Expected Performance:**
- Query response time: <50ms (95th percentile)
- Concurrent users supported: 100+
- Data storage capacity: Unlimited (Azure scaling)

---

## 🔧 Troubleshooting

### Common Issues & Solutions

**Issue**: Local database connection fails
**Solution**: Check file permissions and directory exists
```bash
ls -la /Users/alec/Desktop/App\ Development/A.L.E.C/data/
chmod 755 /Users/alec/Desktop/App\ Development/A.L.E.C/data
```

**Issue**: SSH connection to home server fails
**Solution**: Verify IP address and network connectivity
```bash
ping 100.81.193.45
ssh -v root@100.81.193.45
```

**Issue**: Azure SQL Server timeout errors
**Solution**: Check firewall rules and whitelisted IPs
- Go to Azure Portal → Your Database Server → Firewall Rules
- Add your current IP address or use 0.0.0.0 (for testing only)

---

## 📝 Best Practices

### Data Storage Guidelines

1. **Always store personal information locally** unless explicitly backing up to cloud
2. **Use local cache for frequently accessed data** to reduce latency
3. **Sync critical data to cloud** for backup and cross-device access
4. **Encrypt sensitive data** before storing in any database
5. **Implement proper error handling** for all database operations

### Performance Guidelines

1. **Cache STOA knowledge queries** that return frequently accessed topics
2. **Batch voice interaction logging** every 10-20 interactions instead of per-command
3. **Use connection pooling** for both SQLite and Azure connections
4. **Implement query timeouts** to prevent hanging operations
5. **Monitor database size** and implement cleanup policies for old data

### Security Guidelines

1. **Never hardcode credentials** in source code - use environment variables
2. **Rotate database passwords** every 90 days
3. **Enable SSL/TLS** for all cloud connections (Azure default)
4. **Implement rate limiting** to prevent abuse
5. **Audit all data access** and log unauthorized attempts

---

## 🎯 Success Metrics

### Local Database Health
- ✅ Connection uptime > 99%
- ✅ Query response time < 10ms average
- ✅ No data corruption or loss incidents
- ✅ Successful daily backups

### Cloud Database Health
- ✅ Azure SQL Server availability > 99.95%
- ✅ Knowledge query accuracy > 95%
- ✅ Model training data collection rate: 100% of interactions
- ✅ Cross-session memory retention: 100%

### User Experience Metrics
- ✅ Wake word detection success rate > 95%
- ✅ Voice command execution success rate > 98%
- ✅ Average response time < 2 seconds (including wake word)
- ✅ User satisfaction score > 4.5/5 stars

---

## 📚 Additional Resources

### Documentation Links
- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [Azure SQL Server Documentation](https://learn.microsoft.com/en-us/sql/sql-server/)
- [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/rest/#websocket-api)

### Code Examples
- See `/services/localDatabase.js` for local database implementation
- See `/services/stoaDatabase.js` for cloud database integration
- See `/extensions/home-assistant-voice-integration-enhanced.js` for wake word handling

---

*Document Version: 2.0*
*Last Updated: 2026-04-07*
*Author: STOA Group Development Team*
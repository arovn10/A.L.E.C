#!/usr/bin/env node
/**
 * A.L.E.C. Local Database Initialization Script
 * Creates local SQLite database for personal information storage
 */

require('dotenv').config();
const { LocalDatabase } = require('../services/localDatabase');

async function initializeLocalDatabase() {
  console.log('🏠 Initializing Local Database for Personal Information Storage\n');

  const db = new LocalDatabase();

  try {
    // Connect to database (creates it if not exists)
    const connected = await db.connect();

    if (!connected) {
      console.error('❌ Failed to connect to local database.');
      process.exit(1);
    }

    console.log('✅ Local Database initialized successfully!\n');

    // Test writing some data
    console.log('🧪 Testing database functionality...');

    await db.savePersonalInfo('preferences', 'wake_word', 'Hey Alec', { created_by: 'system' });
    await db.savePersonalInfo('smart_home', 'living_room_light_id', 'light.living_room', { location: 'main_floor' });

    const preferences = await db.getUserPreference('wake_word');
    console.log(`✅ Wake word preference loaded: "${preferences.value}"`);

    // Save test voice interaction
    await db.saveVoiceInteraction({
      wake_word: 'Hey Alec',
      command: 'Test command',
      response: 'Test response',
      success: true,
      context: { test_mode: true }
    });

    const interactions = await db.getVoiceInteractions(1);
    console.log(`✅ Test voice interaction saved. Total interactions: ${interactions.length}`);

    // Save user preference
    await db.saveUserPreference('voice_volume', '0.8', 'string');
    await db.saveUserPreference('response_style', 'witty_and_proactive', 'string');

    const allPrefs = await db.getAllUserPreferences();
    console.log(`✅ User preferences loaded: ${allPrefs.length} items`);

    // Save smart home settings
    await db.saveSmartHomeSetting(
      'light.living_room',
      'on',
      { morning: 'warm_white', evening: 'dimmed' },
      { auto_off_time: '23:00' }
    );

    const smartSettings = await db.getAllSmartHomeSettings();
    console.log(`✅ Smart home settings loaded: ${smartSettings.length} items\n`);

    // Display database summary
    console.log('📊 Database Summary:');
    console.log('==================');
    console.log(`Database Path: ${db.dbPath}`);
    console.log(`Personal Info Entries: ${(await db.getPersonalInfo()).length}`);
    console.log(`Voice Interactions: ${(await db.getVoiceInteractions(100, 0)).length}`);
    console.log(`User Preferences: ${allPrefs.length}`);
    console.log(`Smart Home Settings: ${smartSettings.length}\n`);

    // Display configuration recommendations
    console.log('📋 Next Steps:');
    console.log('==============');
    console.log('1. Update .env.local with your database credentials');
    console.log('2. Configure data storage strategy (local vs cloud)');
    console.log('3. Start A.L.E.C. voice interface on port 3002');
    console.log('4. Test wake word detection: "Hey Alec, set alarm for 7am"');
    console.log('5. Verify Home Assistant integration is working\n');

    // Save configuration to .env.local if not exists
    const fs = require('fs');
    const envPath = '.env.local';

    if (!fs.existsSync(envPath)) {
      const configContent = `# A.L.E.C. Local Database Configuration
ALEC_LOCAL_DB_PATH=${db.dbPath}

# Data Storage Strategy (choose one)
PERSONAL_DATA_STORAGE=local  # Options: local, cloud, hybrid
PERSISTENT_MEMORY_ENABLED=true
VOICE_INTERACTION_LOGGING=true

# Home Assistant Integration (set your token)
HOME_ASSISTANT_URL=http://localhost:8123
HOME_ASSISTANT_ACCESS_TOKEN=<your_long_lived_token_here>

# Voice Interface Configuration
VOICE_PORT=3002
`;

      fs.writeFileSync(envPath, configContent);
      console.log(`✅ Created ${envPath} file with configuration`);
    } else {
      console.log(`ℹ️  ${envPath} already exists. Update it with your credentials.`);
    }

    console.log('\n🎉 Local database initialization complete!');
    console.log('A.L.E.C. is now ready to store personal information locally.\n');

  } catch (error) {
    console.error('❌ Error during initialization:', error.message);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

// Run the initialization
initializeLocalDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
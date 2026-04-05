#!/usr/bin/env node
/**
 * A.L.E.C. Local Database Test Script
 */

require('dotenv').config();
const { LocalDatabase } = require('../services/localDatabase');

async function testLocalDatabase() {
  console.log('🧪 Testing Local Database for Personal Information Storage\n');

  const db = new LocalDatabase();

  try {
    // Connect to database
    await db.connect();

    if (!db.isConnected) {
      throw new Error('Failed to connect to local database');
    }

    console.log('✅ Connected successfully!\n');

    // Test 1: Save personal information
    console.log('📝 Test 1: Saving Personal Information...');
    await db.savePersonalInfo('preferences', 'wake_word', 'Hey Alec', { created_by: 'system' });
    await db.savePersonalInfo('smart_home', 'living_room_light_id', 'light.living_room', { location: 'main_floor' });

    const personalInfo = await db.getPersonalInfo();
    console.log(`   ✅ Saved ${personalInfo.length} personal info entries\n`);

    // Test 2: Save voice interaction
    console.log('🎤 Test 2: Saving Voice Interaction...');
    await db.saveVoiceInteraction({
      wake_word: 'Hey Alec',
      command: 'Set alarm for 7am',
      response: 'Alarm set for 7am',
      success: true,
      context: { time: '07:00' },
      device_id: 'speaker_123',
      location: 'living_room'
    });

    const interactions = await db.getVoiceInteractions(1);
    console.log(`   ✅ Saved voice interaction (ID: ${interactions[0].id})\n`);

    // Test 3: Save user preferences
    console.log('🎚️  Test 3: Saving User Preferences...');
    await db.saveUserPreference('voice_volume', '0.8', 'string');
    await db.saveUserPreference('response_style', 'witty_and_proactive', 'string');

    const allPrefs = await db.getAllUserPreferences();
    console.log(`   ✅ Saved ${allPrefs.length} user preferences\n`);

    // Test 4: Save smart home settings
    console.log('🏠 Test 4: Saving Smart Home Settings...');
    await db.saveSmartHomeSetting(
      'light.living_room',
      'on',
      { morning: 'warm_white', evening: 'dimmed' },
      { auto_off_time: '23:00' }
    );

    const smartSettings = await db.getAllSmartHomeSettings();
    console.log(`   ✅ Saved ${smartSettings.length} smart home settings\n`);

    // Test 5: Retrieve data
    console.log('📊 Test 5: Retrieving Data...');
    const wakeWordPref = await db.getUserPreference('wake_word');
    console.log(`   Wake word preference: "${wakeWordPref.value}"`);

    const livingRoomSetting = await db.getSmartHomeSetting('light.living_room');
    console.log(`   Living room light ID: ${livingRoomSetting.entity_id}`);
    console.log(`   Current state: ${livingRoomSetting.current_state}\n`);

    // Test 6: Get interaction stats
    const stats = await db.getVoiceInteractionStats();
    console.log('📈 Voice Interaction Stats:');
    console.log(`   Total interactions: ${stats.total}`);
    console.log(`   Success rate: ${stats.successRate ? stats.successRate.percentage.toFixed(1) : 'N/A'}%\n`);

    // Summary
    console.log('=' .repeat(60));
    console.log('✅ LOCAL DATABASE TEST PASSED');
    console.log('=' .repeat(60));
    console.log(`Database Path: ${db.dbPath}`);
    console.log(`Personal Info Entries: ${personalInfo.length}`);
    console.log(`Voice Interactions: ${(await db.getVoiceInteractions(100, 0)).length}`);
    console.log(`User Preferences: ${allPrefs.length}`);
    console.log(`Smart Home Settings: ${smartSettings.length}\n`);

    console.log('🎉 Local database is fully functional!\n');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

// Run the test
testLocalDatabase().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
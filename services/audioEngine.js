#!/usr/bin/env node
/**
 * A.L.E.C. Audio Engine - Text to Speech (Simplified)
 */

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs').promises;

const execPromise = util.promisify(exec);

class AudioEngine {
  constructor() {
    this.isInitialized = false;
    this.voiceSettings = {
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0
    };
    this.outputDir = path.join(__dirname, '../output/audio');
  }

  async initialize() {
    console.log('🎵 Initializing A.L.E.C. Audio Engine...');
    
    try {
      // Create output directory if it doesn't exist
      await fs.mkdir(this.outputDir, { recursive: true });
      
      // Check for system TTS (macOS uses say command)
      const { stdout } = await execPromise('which say', { encoding: 'utf-8' });
      console.log('✅ Audio engine initialized (using macOS "say" command)');
      this.isInitialized = true;
      
    } catch (error) {
      console.warn('⚠️  TTS not available, audio will be simulated');
      this.isInitialized = false;
    }

    return this.isInitialized;
  }

  async speak(text) {
    if (!this.isInitialized) {
      console.log(`🔊 [SIMULATED] A.L.E.C. would say: "${text}"`);
      return { success: true, type: 'simulated' };
    }

    try {
      const outputFilename = `alec_${Date.now()}.mp3`;
      const outputPath = path.join(this.outputDir, outputFilename);
      
      // Use macOS "say" command with voice settings
      const cmd = `say -v Fiona -r ${this.voiceSettings.rate * 10} -p ${this.voiceSettings.pitch} "${text.replace(/"/g, '\\"')}" -o "${outputPath}"`;
      
      await execPromise(cmd);
      
      console.log(`🔊 Speaking: "${text.substring(0, 50)}..." (${outputFilename})`);
      
      return { success: true, type: 'audio', path: outputPath };
      
    } catch (error) {
      console.error('❌ Audio synthesis error:', error.message);
      console.log(`🔊 [SIMULATED] A.L.E.C. would say: "${text}"`);
      return { success: false, type: 'simulated', error: error.message };
    }
  }

  async playFile(filePath) {
    try {
      // Use macOS "afplay" to play audio file
      await execPromise(`afplay "${filePath}"`);
      console.log(`🎵 Playing: ${path.basename(filePath)}`);
      return true;
    } catch (error) {
      console.error('❌ Audio playback error:', error.message);
      return false;
    }
  }

  updateVoiceSettings(settings) {
    Object.assign(this.voiceSettings, settings);
    console.log('🎵 Voice settings updated:', this.voiceSettings);
  }

  getStatus() {
    return {
      status: this.isInitialized ? 'ready' : 'limited',
      initialized: this.isInitialized,
      voice_settings: this.voiceSettings,
      output_directory: this.outputDir
    };
  }
}

module.exports = { AudioEngine };

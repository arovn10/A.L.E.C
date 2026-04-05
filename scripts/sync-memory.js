#!/usr/bin/env node
/**
 * A.L.E.C. Memory Synchronization Script
 *
 * This script automatically updates the project memory with current system state
 * and can be run by any session to ensure consistency across tabs.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = process.cwd();
const MEMORY_FILE = path.join(PROJECT_ROOT, '.project_memory.md');

function getCurrentSystemState() {
  const state = {};

  try {
    // Check server status
    const serverPort = execSync('lsof -i :3001 | grep LISTEN', { encoding: 'utf8' });
    state.serverRunning = serverPort.includes(':3001 (LISTEN)');

    // Check llama server status
    const llamaPort = execSync('lsof -i :8089 | grep LISTEN', { encoding: 'utf8' });
    state.llamaServerRunning = llamaPort.includes(':8089 (LISTEN)');

    // Get model info if available
    try {
      const health = JSON.parse(execSync('curl -s http://localhost:3001/health', { encoding: 'utf8' }));
      state.neuralMode = health.neuralModel?.mode || 'unknown';
      state.modelLoaded = health.neuralModel?.loaded || false;
    } catch (e) {
      state.neuralMode = 'unknown';
      state.modelLoaded = false;
    }

    // Check environment variables
    const envContent = fs.readFileSync(path.join(PROJECT_ROOT, '.env'), 'utf8');
    state.jwtSecretSet = envContent.includes('JWT_SECRET=');

  } catch (e) {
    console.error('Error checking system state:', e.message);
    state.serverRunning = false;
    state.llamaServerRunning = false;
    state.neuralMode = 'unknown';
    state.modelLoaded = false;
    state.jwtSecretSet = false;
  }

  return state;
}

function updateMemoryFile() {
  const currentState = getCurrentSystemState();

  let memoryContent = fs.readFileSync(MEMORY_FILE, 'utf8');

  // Update status section
  const statusSection = `## Current Status (${new Date().toISOString().split('T')[0]})\n`;
  const features = [];

  if (currentState.serverRunning) features.push('✅ Backend server running on port 3001');
  if (currentState.llamaServerRunning) features.push('✅ llama.cpp server running on port 8089');
  if (currentState.modelLoaded && currentState.neuralMode === 'real-llm') {
    features.push('✅ Real LLM inference ACTIVE (not mock mode)');
  } else if (currentState.modelLoaded) {
    features.push(`⚠️ Model loaded but mode: ${currentState.neuralMode}`);
  } else {
    features.push('❌ Neural engine not initialized or in fallback mode');
  }

  let newMemory = memoryContent.replace(
    /## Current Status \(.*?\)\n/,
    `## Current Status (${new Date().toISOString().split('T')[0]})\n` +
    (currentState.serverRunning || currentState.llamaServerRunning ? '✅ **FULLY OPERATIONAL** with Real LLM inference\n' : '⚠️ **PARTIAL OPERATIONS** - Check server status\n') + '\n'
  );

  // Update Active Features section dynamically
  const activeFeatures = features.filter(f => f.startsWith('✅')).join('\n');
  newMemory = newMemory.replace(
    /### Active Features[\s\S]*?(?=\n##)/,
    `### Active Features\n${activeFeatures}\n` +
    (features.filter(f => f.includes('⚠️') || f.includes('❌')).length > 0 ?
      `\n### Issues Detected\n${features.filter(f => f.includes('⚠️') || f.includes('❌')).join('\n')}` : '') + '\n'
  );

  // Update timestamp
  newMemory = `# A.L.E.C. - Personal AI Assistant Project Memory\n\n` +
               newMemory.split('\n').slice(1).join('\n');

  fs.writeFileSync(MEMORY_FILE, newMemory);
  console.log('✅ Memory synchronized successfully!');
}

// Run synchronization
updateMemoryFile();

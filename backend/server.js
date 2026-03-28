/**
 * A.L.E.C. - Adaptive Learning Executive Coordinator
 * Main Server Entry Point
 *
 * Features:
 * - Personal AI companion with 35B parameter LLM
 * - Voice interface support
 * - Adaptive learning from user interactions
 * - Smart home integration
 * - Multi-token authentication system
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const { NeuralEngine } = require('../services/neuralEngine.js');
const { VoiceInterface } = require('../services/voiceInterface.js');
const { AdaptiveLearning } = require('../services/adaptiveLearning.js');
const { SmartHomeConnector } = require('../services/smartHomeConnector.js');
const { TokenManager } = require('../services/tokenManager.js');
const { MCPSkillsManager } = require('../services/mcpSkills.js');
const { SelfEvolutionEngine } = require('../services/selfEvolution.js');
const { CrossDeviceSync } = require('../services/crossDeviceSync.js');

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize core services
const neuralEngine = new NeuralEngine();
const voiceInterface = new VoiceInterface();
const adaptiveLearning = new AdaptiveLearning();
const smartHomeConnector = new SmartHomeConnector();
const tokenManager = new TokenManager();
const mcpSkillsManager = new MCPSkillsManager();
const selfEvolution = new SelfEvolutionEngine();
const crossDeviceSync = new CrossDeviceSync();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('frontend'));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'A.L.E.C.',
    timestamp: new Date().toISOString(),
    neuralModel: neuralEngine.getModelStatus()
  });
});

/**
 * Authentication Middleware - Token-based with role separation
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);

    // Check token type and permissions
    if (verified.tokenType === 'STOA_ACCESS') {
      req.user = { ...verified, scope: ['stoa_data'] };
    } else if (verified.tokenType === 'FULL_CAPABILITIES') {
      req.user = { ...verified, scope: ['full_access', 'neural_training', 'smart_home'] };
    } else {
      return res.status(403).json({ error: 'Invalid token type' });
    }

    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

/**
 * A.L.E.C. Core API Endpoints
 */

// Chat interface with neural network
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, context, voice = false } = req.body;

    // Log interaction for adaptive learning
    await adaptiveLearning.logInteraction({
      userId: req.user.userId,
      message,
      timestamp: Date.now(),
      tokenType: req.user.tokenType
    });

    // Process through neural engine with context awareness
    const response = await neuralEngine.processQuery({
      query: message,
      context: context || {},
      personality: 'companion',
      sassLevel: 0.7,
      initiativeMode: true
    });

    // If voice requested, convert to speech
    if (voice && response.text) {
      const audioBuffer = await voiceInterface.textToSpeech(response.text);
      res.set('Content-Type', 'audio/wav');
      return res.send(audioBuffer);
    }

    res.json({
      success: true,
      response: response.text,
      confidence: response.confidence,
      personality: response.personality,
      suggestions: response.suggestions || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'A.L.E.C. is thinking hard right now',
      message: 'Please try again'
    });
  }
});

// Voice interface - WebSocket server runs separately
const voiceServer = voiceInterface.initialize();
if (voiceServer) {
  console.log('🎤 Voice WebSocket initialized');
}

// Adaptive learning - train on user data
app.post('/api/learn', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('neural_training')) {
    return res.status(403).json({ error: 'Full capabilities token required' });
  }

  try {
    const { data, source } = req.body;

    await adaptiveLearning.trainOnData(data, source);
    await neuralEngine.retrain();

    res.json({
      success: true,
      message: 'A.L.E.C. has learned from your input',
      newPatterns: adaptiveLearning.detectedPatterns.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Training failed' });
  }
});

// Smart home integration
app.post('/api/smarthome/control', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('smart_home')) {
    return res.status(403).json({ error: 'Smart home access denied' });
  }

  try {
    const { device, action, parameters } = req.body;

    const result = await smartHomeConnector.executeCommand(device, action, parameters);

    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: 'Smart home control failed' });
  }
});

// Get personality and context data
app.get('/api/personality', authenticateToken, (req, res) => {
  const personality = adaptiveLearning.getPersonalityProfile(req.user.userId);
  res.json({ success: true, personality });
});

// Initialize A.L.E.C. with user's personal data
app.post('/api/init', authenticateToken, async (req, res) => {
  try {
    const { emails, texts, documents } = req.body;

    await adaptiveLearning.initializePersonalData({
      userId: req.user.userId,
      emails, texts, documents
    });

    await neuralEngine.loadPersonalContext(req.user.userId);

    res.json({
      success: true,
      message: 'A.L.E.C. is now personalized for you',
      dataPoints: Object.keys(req.body).reduce((sum, key) => sum + req.body[key].length, 0)
    });
  } catch (error) {
    res.status(500).json({ error: 'Initialization failed' });
  }
});

// Generate tokens
app.post('/api/tokens/generate', async (req, res) => {
  try {
    const { type, userId, permissions = [] } = req.body;

    if (!['STOA_ACCESS', 'FULL_CAPABILITIES'].includes(type)) {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const tokenData = tokenManager.generateToken(userId, type, permissions);

    res.json({
      success: true,
      token: tokenData.token,
      userId: tokenData.userId,
      tokenType: tokenData.tokenType,
      permissions: tokenData.permissions,
      expiresAt: tokenData.expiresAt
    });
  } catch (error) {
    res.status(500).json({ error: 'Token generation failed' });
  }
});

// MCP Skills management - Install new capabilities via Model Context Protocol
app.post('/api/mcp/skills/install', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }

  try {
    const { skillId, permissions = [], autoConnect = false } = req.body;

    const skillConfig = await mcpSkillsManager.installSkill(skillId, { permissions, autoConnect });

    res.json({
      success: true,
      message: `MCP Skill ${skillConfig.name} installed successfully`,
      skill: skillConfig
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get available MCP skills for installation
app.get('/api/mcp/skills/available', authenticateToken, (req, res) => {
  const availableSkills = mcpSkillsManager.getAvailableSkills();
  res.json({ success: true, skills: availableSkills });
});

// Connect to an installed skill
app.post('/api/mcp/skills/connect/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }

  try {
    const { skillId } = req.params;
    const connectionConfig = req.body;

    const result = await mcpSkillsManager.connectSkill(skillId, connectionConfig);

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// List installed skills with status
app.get('/api/mcp/skills/installed', authenticateToken, (req, res) => {
  const installed = mcpSkillsManager.getInstalledSkills();
  res.json({ success: true, skills: installed });
});

// Disconnect a skill
app.post('/api/mcp/skills/disconnect/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }

  try {
    const { skillId } = req.params;
    await mcpSkillsManager.disconnectSkill(skillId);
    res.json({ success: true, message: `Disconnected from ${skillId}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Remove a skill completely
app.delete('/api/mcp/skills/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }

  try {
    const { skillId } = req.params;
    await mcpSkillsManager.removeSkill(skillId);
    res.json({ success: true, message: `Removed skill ${skillId}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Self-Evolution API - A.L.E.C. manages its own code and weights
app.post('/api/self-evolution/save-version', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for self-modification' });
  }

  try {
    const { modelId = 'current' } = req.body;
    const result = await selfEvolution.saveModelVersion(modelId);

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to save version: ${error.message}` });
  }
});

app.get('/api/self-evolution/versions', authenticateToken, async (req, res) => {
  try {
    const versions = await selfEvolution.getAvailableVersions();

    // Filter only the most recent 50 for performance
    const filteredVersions = versions.slice(0, 50);

    res.json({ success: true, versions: filteredVersions });
  } catch (error) {
    res.status(500).json({ error: `Failed to list versions: ${error.message}` });
  }
});

app.post('/api/self-evolution/adjust-biases', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for bias adjustment' });
  }

  try {
    const { adjustments } = req.body;

    if (!Array.isArray(adjustments)) {
      return res.status(400).json({ error: 'Adjustments must be an array' });
    }

    const result = await selfEvolution.adjustBiases(adjustments);

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to adjust biases: ${error.message}` });
  }
});

app.post('/api/self-evolution/self-modify', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for self-modification' });
  }

  try {
    const { modificationPlan } = req.body;

    if (!modificationPlan || !Array.isArray(modificationPlan.changes)) {
      return res.status(400).json({ error: 'Invalid modification plan' });
    }

    const result = await selfEvolution.selfModify(modificationPlan);

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: `Self-modification failed: ${error.message}` });
  }
});

app.get('/api/self-evolution/ownership', authenticateToken, async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, '../data/.ownership_manifest.json');

    if (!fs.existsSync(manifestPath)) {
      const manifest = await selfEvolution.initializeOwnership();
      return res.json({ success: true, manifest });
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath));
    res.json({ success: true, manifest });
  } catch (error) {
    res.status(500).json({ error: `Failed to get ownership info: ${error.message}` });
  }
});

app.get('/api/self-evolution/stats', authenticateToken, (req, res) => {
  const stats = selfEvolution.getEvolutionStats();
  res.json({ success: true, ...stats });
});

// Cross-Device Sync API - Tailscale network access
app.post('/api/sync/register-device', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for device registration' });
  }

  try {
    const { deviceId, deviceInfo = {} } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is required' });
    }

    const result = await crossDeviceSync.registerDevice(deviceId, deviceInfo);

    // Also configure Tailscale access
    await selfEvolution.configureTailscaleAccess();

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to register device: ${error.message}` });
  }
});

app.post('/api/sync/across-network', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for network sync' });
  }

  try {
    const { syncData, targetDevices = [] } = req.body;

    if (!syncData) {
      return res.status(400).json({ error: 'Sync data is required' });
    }

    const result = await crossDeviceSync.syncAcrossNetwork(syncData, targetDevices);

    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to sync across network: ${error.message}` });
  }
});

app.get('/api/sync/status', authenticateToken, (req, res) => {
  const status = crossDeviceSync.getStatus();
  res.json({ success: true, ...status });
});

app.post('/api/sync/process-pending', authenticateToken, async (req, res) => {
  try {
    const result = await crossDeviceSync.processPendingSyncs();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to process pending syncs: ${error.message}` });
  }
});

app.delete('/api/sync/remove-device/:deviceId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for device removal' });
  }

  try {
    const { deviceId } = req.params;
    await crossDeviceSync.removeDevice(deviceId);
    res.json({ success: true, message: `Device ${deviceId} removed` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Neural network stats and model info
app.get('/api/neural/stats', authenticateToken, (req, res) => {
  const stats = neuralEngine.getStats();
  res.json({ success: true, ...stats });
});

// Start the server
if (!fs.existsSync(path.join(__dirname, '../data/models/personal_model.bin'))) {
  console.log('🧠 Initializing A.L.E.C. with base model...');
  // Load initial 35B parameter model (Llama 3.1 or similar)
}

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║   🤖 A.L.E.C. - Adaptive Learning Executive Coordinator   ║
╠══════════════════════════════════════════════════════╣
║   Status: ONLINE                                     ║
║   Port: ${PORT}                                        ║
║   Mode: Personal AI Assistant                        ║
║   Personality: Witty & Proactive                     ║
╚══════════════════════════════════════════════════════╝

🎯 A.L.E.C. is ready to learn and grow with you!
💬 Try: curl http://localhost:${PORT}/api/chat -H "Content-Type: application/json" -d '{"message":"Hello, who are you?","voice":false}'

`);
});

module.exports = app;

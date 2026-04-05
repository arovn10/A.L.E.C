/**
 * A.L.E.C. — Autonomous Language Embedded Cognition
 * Main Server Entry Point
 *
 * Two-process architecture:
 *   Node.js (this file, port 3001) ↔ Python Neural Engine (port 8000)
 *
 * Features:
 * - Real LLM inference via Qwen2.5-Coder-7B on Apple Silicon
 * - LoRA fine-tuning pipeline for self-improvement
 * - Azure SQL + SQLite dual-mode logging
 * - JWT auth with STOA_ACCESS and FULL_CAPABILITIES tokens
 * - LAN access (0.0.0.0) + Tailscale for mobile
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');
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
const HOST = process.env.HOST || '0.0.0.0'; // LAN-accessible by default

// Initialize core services
const neuralEngine = new NeuralEngine();
const voiceInterface = new VoiceInterface();
const adaptiveLearning = new AdaptiveLearning();
const smartHomeConnector = new SmartHomeConnector();
const tokenManager = new TokenManager();
const mcpSkillsManager = new MCPSkillsManager();
const selfEvolution = new SelfEvolutionEngine();
const crossDeviceSync = new CrossDeviceSync();

// Initialize neural engine connection to Python server
neuralEngine.initialize();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('frontend'));

// ── Helper: get LAN IPs ────────────────────────────────────────
function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) {
        results.push(cfg.address);
      }
    }
  }
  return results;
}

// ── Health check ────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let neuralStatus = { loaded: false };
  try {
    neuralStatus = await neuralEngine.getModelInfo();
  } catch {}

  res.json({
    status: 'ok',
    service: 'A.L.E.C.',
    timestamp: new Date().toISOString(),
    neuralEngine: neuralStatus,
    lanAddresses: getLanAddresses(),
  });
});

/**
 * Authentication Middleware — JWT with role separation
 */
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);

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

// ════════════════════════════════════════════════════════════════
//  CORE A.L.E.C. API ENDPOINTS
// ════════════════════════════════════════════════════════════════

// ── Chat with neural network ────────────────────────────────────
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, context, voice = false } = req.body;

    await adaptiveLearning.logInteraction({
      userId: req.user.userId,
      message,
      timestamp: Date.now(),
      tokenType: req.user.tokenType,
    });

    const response = await neuralEngine.processQuery({
      query: message,
      context: context || {},
      personality: 'companion',
      sassLevel: 0.7,
      initiativeMode: true,
    });

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
      conversationId: response.conversationId,
      usage: response.usage,
      latencyMs: response.latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'A.L.E.C. is thinking hard right now',
      message: 'Please try again',
    });
  }
});

// ── Feedback: rate a conversation ───────────────────────────────
app.post('/api/feedback', authenticateToken, async (req, res) => {
  try {
    const { conversationId, rating, feedback } = req.body;
    const result = await neuralEngine.submitFeedback(conversationId, rating, feedback);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Feedback submission failed' });
  }
});

// ── Conversation history ────────────────────────────────────────
app.get('/api/conversations/history', authenticateToken, async (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const result = await neuralEngine.getConversationHistory(limit);
  res.json(result);
});

// ── Model info ──────────────────────────────────────────────────
app.get('/api/model/info', authenticateToken, async (req, res) => {
  const info = await neuralEngine.getModelInfo();
  res.json({ success: true, ...info });
});

// ════════════════════════════════════════════════════════════════
//  TRAINING PIPELINE ENDPOINTS
// ════════════════════════════════════════════════════════════════

app.post('/api/training/start', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('neural_training')) {
    return res.status(403).json({ error: 'Full capabilities token required' });
  }
  try {
    const { dataPath, config } = req.body;
    const result = await neuralEngine.startTraining(dataPath, config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Training start failed' });
  }
});

app.get('/api/training/status', authenticateToken, async (req, res) => {
  const status = await neuralEngine.getTrainingStatus();
  res.json({ success: true, ...status });
});

app.post('/api/training/export', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('neural_training')) {
    return res.status(403).json({ error: 'Full capabilities token required' });
  }
  const result = await neuralEngine.exportTrainingData();
  res.json(result);
});

// ════════════════════════════════════════════════════════════════
//  EXISTING ENDPOINTS (preserved from original)
// ════════════════════════════════════════════════════════════════

// Voice interface
const voiceServer = voiceInterface.initialize();
if (voiceServer) {
  console.log('🎤 Voice WebSocket initialized');
}

// Adaptive learning — train on user data
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
      newPatterns: adaptiveLearning.detectedPatterns.length,
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

// Personality
app.get('/api/personality', authenticateToken, (req, res) => {
  const personality = adaptiveLearning.getPersonalityProfile(req.user.userId);
  res.json({ success: true, personality });
});

// Initialize personal data
app.post('/api/init', authenticateToken, async (req, res) => {
  try {
    const { emails, texts, documents } = req.body;
    await adaptiveLearning.initializePersonalData({
      userId: req.user.userId,
      emails, texts, documents,
    });
    await neuralEngine.loadPersonalContext(req.user.userId);
    res.json({
      success: true,
      message: 'A.L.E.C. is now personalized for you',
      dataPoints: Object.keys(req.body).reduce((sum, key) => sum + req.body[key].length, 0),
    });
  } catch (error) {
    res.status(500).json({ error: 'Initialization failed' });
  }
});

// Token generation
app.post('/api/tokens/generate', async (req, res) => {
  try {
    const { type, userId, permissions = [] } = req.body;
    if (!['STOA_ACCESS', 'FULL_CAPABILITIES'].includes(type)) {
      return res.status(400).json({ error: 'Invalid token type' });
    }
    const tokenData = tokenManager.generateToken(userId, type, permissions);
    res.json({ success: true, ...tokenData });
  } catch (error) {
    res.status(500).json({ error: 'Token generation failed' });
  }
});

// ── MCP Skills Management ───────────────────────────────────────

app.post('/api/mcp/skills/install', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    const { skillId, permissions = [], autoConnect = false } = req.body;
    const skillConfig = await mcpSkillsManager.installSkill(skillId, { permissions, autoConnect });
    res.json({ success: true, message: `MCP Skill ${skillConfig.name} installed successfully`, skill: skillConfig });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/mcp/skills/available', authenticateToken, (req, res) => {
  const availableSkills = mcpSkillsManager.getAvailableSkills();
  res.json({ success: true, skills: availableSkills });
});

app.post('/api/mcp/skills/connect/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    const { skillId } = req.params;
    const result = await mcpSkillsManager.connectSkill(skillId, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/mcp/skills/installed', authenticateToken, (req, res) => {
  const installed = mcpSkillsManager.getInstalledSkills();
  res.json({ success: true, skills: installed });
});

app.post('/api/mcp/skills/disconnect/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    await mcpSkillsManager.disconnectSkill(req.params.skillId);
    res.json({ success: true, message: `Disconnected from ${req.params.skillId}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/mcp/skills/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    await mcpSkillsManager.removeSkill(req.params.skillId);
    res.json({ success: true, message: `Removed skill ${req.params.skillId}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Self-Evolution ──────────────────────────────────────────────

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
    res.json({ success: true, versions: versions.slice(0, 50) });
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

// ── Cross-Device Sync ───────────────────────────────────────────

app.post('/api/sync/register-device', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for device registration' });
  }
  try {
    const { deviceId, deviceInfo = {} } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Device ID is required' });
    const result = await crossDeviceSync.registerDevice(deviceId, deviceInfo);
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
    if (!syncData) return res.status(400).json({ error: 'Sync data is required' });
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
    await crossDeviceSync.removeDevice(req.params.deviceId);
    res.json({ success: true, message: `Device ${req.params.deviceId} removed` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ── Neural network stats ────────────────────────────────────────
app.get('/api/neural/stats', authenticateToken, (req, res) => {
  const stats = neuralEngine.getStats();
  res.json({ success: true, ...stats });
});

// ════════════════════════════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════════════════════════════

app.listen(PORT, HOST, () => {
  const lanIps = getLanAddresses();
  const lanList = lanIps.map(ip => `http://${ip}:${PORT}`).join('\n║   ');

  console.log(`
╔═══════════════════════════════════════════════════════╗
║   🧠 A.L.E.C. — Autonomous Language Embedded Cognition
╠═══════════════════════════════════════════════════════╣
║   Status: ONLINE
║   Port: ${PORT}
║   Host: ${HOST}
║   Neural Engine: localhost:${process.env.NEURAL_PORT || 8000}
║   Model: Qwen2.5-Coder-7B-Instruct (Q4_K_M)
║
║   Local:  http://localhost:${PORT}
║   LAN:    ${lanList}
╚═══════════════════════════════════════════════════════╝

💬 Chat: POST /api/chat
🏋️  Train: POST /api/training/start
📊 Stats: GET /api/neural/stats
❤️  Rate:  POST /api/feedback
`);
});

module.exports = app;

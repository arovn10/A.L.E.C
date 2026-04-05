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
 * - Domo embed auto-authentication
 * - File upload management with multer
 * - Background task tracking
 * - Stoa Group DB connector
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
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
const NEURAL_URL = `http://localhost:${process.env.NEURAL_PORT || 8000}`;

// ── Directory setup ─────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('📁 Created data/uploads/ directory');
}

// ── Initialize core services ────────────────────────────────────
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

// ── Middleware ──────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Serve uploaded files at /uploads/
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Multer config for file uploads ──────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB limit

// ── Helper: get LAN IPs ─────────────────────────────────────────
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

// ── Helper: Domo embed detection ────────────────────────────────
const isDomo = (req) => {
  const ref = req.get('referer') || '';
  return req.query.embed === 'domo' || ref.includes('domo.com');
};

// ── Helper: proxy request to Python neural engine ───────────────
async function proxyToNeural(path, options = {}) {
  const { method = 'GET', body = null, query = '' } = options;
  const url = `${NEURAL_URL}${path}${query ? '?' + query : ''}`;

  const fetchOptions = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== null) {
    fetchOptions.body = JSON.stringify(body);
  }

  const resp = await fetch(url, fetchOptions);
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    const err = new Error(errBody.detail || errBody.error || `Neural engine returned ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// ── Authentication Middleware ────────────────────────────────────
/**
 * authenticateToken — verifies JWT from Authorization: Bearer header.
 * If request is from Domo embed, auto-sets req.user with STOA_ACCESS scope.
 * Token types:
 *   STOA_ACCESS       → read-only stoa data + chat
 *   FULL_CAPABILITIES → everything: training, files, admin, smart home
 */
const authenticateToken = (req, res, next) => {
  // Domo embed auto-authentication — no login required
  if (isDomo(req)) {
    req.user = {
      userId: 'domo-embed',
      email: 'embed@domo.com',
      tokenType: 'STOA_ACCESS',
      scope: ['stoa_data'],
      isDomoEmbed: true,
    };
    return next();
  }

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

/**
 * requireFullCapabilities — middleware that checks for FULL_CAPABILITIES scope.
 * Must be used after authenticateToken.
 */
const requireFullCapabilities = (req, res, next) => {
  if (!req.user.scope.includes('full_access') && !req.user.scope.includes('neural_training')) {
    return res.status(403).json({ error: 'Full capabilities token required' });
  }
  next();
};

// ════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════════════════

app.get('/health', async (req, res) => {
  let neuralStatus = { loaded: false };
  try {
    neuralStatus = await neuralEngine.getModelInfo();
  } catch (_) {}

  res.json({
    status: 'ok',
    service: 'A.L.E.C.',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    neuralEngine: {
      url: NEURAL_URL,
      ...neuralStatus,
    },
    lanAddresses: getLanAddresses(),
    uptime: process.uptime(),
  });
});

// ════════════════════════════════════════════════════════════════
//  AUTH ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/login
 * Body: { email, password, is_domo_embed? }
 * Forwards credentials to Python /auth/login.
 * Returns JWT token.
 */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, is_domo_embed = false } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const data = await proxyToNeural('/auth/login', {
      method: 'POST',
      body: { email, password, is_domo_embed },
    });

    // Python returns {success, user: {id, email, role}, access_level}
    const user = data.user || {};
    const tokenType = data.access_level === 'FULL_CAPABILITIES' ? 'FULL_CAPABILITIES' : 'STOA_ACCESS';
    const jwtPayload = {
      userId: user.id || email,
      email: user.email || email,
      role: user.role || 'viewer',
      tokenType,
    };

    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      tokenType,
      access_level: data.access_level,
      email: jwtPayload.email,
      role: jwtPayload.role,
      user: user,
      expiresIn: '24h',
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 401) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    console.error('Login error:', error);
    res.status(status).json({ error: error.message || 'Login failed' });
  }
});

// ════════════════════════════════════════════════════════════════
//  CHAT ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/chat
 * Forwards to Python /v1/chat/completions.
 * Returns { conversationId, usage, latencyMs, response }.
 */
app.post('/api/chat', authenticateToken, async (req, res) => {
  try {
    const { message, context, voice = false, messages } = req.body;

    // Log interaction for adaptive learning
    await adaptiveLearning.logInteraction({
      userId: req.user.userId,
      message: message || (messages && messages[messages.length - 1]?.content),
      timestamp: Date.now(),
      tokenType: req.user.tokenType,
    });

    // Build the messages array for the Python engine
    const chatMessages = messages || [];
    if (message && chatMessages.length === 0) {
      if (context && context.history && Array.isArray(context.history)) {
        chatMessages.push(...context.history);
      }
      chatMessages.push({ role: 'user', content: message });
    }

    const startTime = Date.now();
    const data = await proxyToNeural('/v1/chat/completions', {
      method: 'POST',
      body: {
        model: 'alec-local',
        messages: chatMessages,
        temperature: 0.7,
        max_tokens: 1024,
        session_id: context?.sessionId || undefined,
      },
    });

    const latencyMs = data.latency_ms || Date.now() - startTime;
    const choice = data.choices?.[0];
    const responseText = choice?.message?.content || 'I had trouble generating a response.';

    if (voice && responseText) {
      try {
        const audioBuffer = await voiceInterface.textToSpeech(responseText);
        res.set('Content-Type', 'audio/wav');
        return res.send(audioBuffer);
      } catch (_) {
        // Fall through to JSON response if TTS fails
      }
    }

    res.json({
      success: true,
      response: responseText,
      confidence: 0.85,
      personality: 'companion',
      suggestions: [
        'Would you like me to analyze your recent data?',
        'Want me to check something in the database?',
        'Shall we kick off a training run?',
      ],
      conversationId: data.conversation_id,
      usage: data.usage,
      latencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'A.L.E.C. is thinking hard right now',
      message: error.message || 'Please try again',
    });
  }
});

// ════════════════════════════════════════════════════════════════
//  FEEDBACK ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/feedback
 * Body: { conversationId, rating, feedback? }
 * Forwards to Python /feedback.
 */
app.post('/api/feedback', authenticateToken, async (req, res) => {
  try {
    const convId = req.body.conversationId || req.body.conversation_id;
    const { rating, feedback } = req.body;

    if (!convId || rating === undefined) {
      return res.status(400).json({ error: 'conversationId and rating are required' });
    }

    const data = await proxyToNeural('/feedback', {
      method: 'POST',
      body: { conversation_id: convId, rating, feedback: feedback || '' },
    });

    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Feedback submission failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  CONVERSATION HISTORY
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/conversations/history
 * Query: ?limit=50
 * Forwards to Python /conversations.
 */
app.get('/api/conversations/history', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const data = await proxyToNeural('/conversations', {
      query: `limit=${limit}&offset=${offset}`,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Conversation history error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation history', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  MODEL INFO
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/model/info
 * Forwards to Python /model/info.
 */
app.get('/api/model/info', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/model/info');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Model info error:', error);
    res.status(500).json({ error: 'Failed to fetch model info', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TRAINING PIPELINE ENDPOINTS  (requires FULL_CAPABILITIES)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/training/start
 * Body: { dataPath?, config? }
 * Forwards to Python /training/start.
 */
app.post('/api/training/start', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { dataPath, config } = req.body;
    const data = await proxyToNeural('/training/start', {
      method: 'POST',
      body: { data_path: dataPath, config: config || {} },
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training start error:', error);
    res.status(500).json({ error: 'Training start failed', message: error.message });
  }
});

/**
 * GET /api/training/status
 * Forwards to Python /training/status.
 */
app.get('/api/training/status', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/training/status');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training status error:', error);
    res.status(500).json({ error: 'Failed to fetch training status', message: error.message });
  }
});

/**
 * POST /api/training/export
 * Forwards to Python /training/export.
 */
app.post('/api/training/export', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const data = await proxyToNeural('/training/export', { method: 'POST', body: req.body || {} });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training export error:', error);
    res.status(500).json({ error: 'Training export failed', message: error.message });
  }
});

/**
 * GET /api/training/adapters
 * Forwards to Python /training/adapters.
 */
app.get('/api/training/adapters', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/training/adapters');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training adapters error:', error);
    res.status(500).json({ error: 'Failed to fetch adapters', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  FILE UPLOAD ENDPOINTS  (requires FULL_CAPABILITIES)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/files/upload
 * Multipart form-data. Saves to data/uploads/, stores metadata.
 */
app.post('/api/files/upload', authenticateToken, requireFullCapabilities, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const fileMeta = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      path: req.file.path,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user.userId,
      processed: false,
      trainingExamples: 0,
    };

    // Notify Python engine about the new file so it can record metadata in DB
    try {
      await proxyToNeural('/files/register', {
        method: 'POST',
        body: {
          filename: fileMeta.filename,
          original_name: fileMeta.originalName,
          size_bytes: fileMeta.sizeBytes,
          mime_type: fileMeta.mimeType,
          filepath: fileMeta.path,
        },
      });
    } catch (_) {
      // Non-fatal: Python engine may not have /files/register, continue
    }

    res.json({
      success: true,
      file: fileMeta,
      uploadUrl: `/uploads/${req.file.filename}`,
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File upload failed', message: error.message });
  }
});

/**
 * GET /api/files
 * Lists all uploaded files from data/uploads/.
 */
app.get('/api/files', authenticateToken, async (req, res) => {
  try {
    // Try to get enriched metadata from Python engine
    let pythonFiles = null;
    try {
      pythonFiles = await proxyToNeural('/files');
    } catch (_) {
      // Fall back to local directory listing
    }

    if (pythonFiles) {
      return res.json({ success: true, ...pythonFiles });
    }

    // Local fallback: read the uploads directory
    const entries = fs.readdirSync(UPLOADS_DIR);
    const files = entries.map((filename) => {
      const filepath = path.join(UPLOADS_DIR, filename);
      const stat = fs.statSync(filepath);
      return {
        filename,
        sizeBytes: stat.size,
        uploadedAt: stat.birthtime.toISOString(),
        url: `/uploads/${filename}`,
      };
    });

    res.json({ success: true, files, total: files.length });
  } catch (error) {
    console.error('File list error:', error);
    res.status(500).json({ error: 'Failed to list files', message: error.message });
  }
});

/**
 * DELETE /api/files/:filename
 * Deletes a file from data/uploads/.
 */
app.delete('/api/files/:filename', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { filename } = req.params;

    // Sanitize filename — prevent path traversal
    const safeFilename = path.basename(filename);
    const filepath = path.join(UPLOADS_DIR, safeFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filepath);

    // Notify Python engine to remove from DB
    try {
      await proxyToNeural(`/files/${safeFilename}`, { method: 'DELETE' });
    } catch (_) {
      // Non-fatal
    }

    res.json({ success: true, message: `File ${safeFilename} deleted` });
  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({ error: 'File deletion failed', message: error.message });
  }
});

/**
 * POST /api/files/:filename/process
 * Triggers Python to process an uploaded file into training examples.
 */
app.post('/api/files/:filename/process', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filepath = path.join(UPLOADS_DIR, safeFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const data = await proxyToNeural('/files/process', {
      method: 'POST',
      body: { filename: safeFilename, filepath },
    });

    res.json({ success: true, ...data });
  } catch (error) {
    console.error('File process error:', error);
    res.status(500).json({ error: 'File processing failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TASK MANAGEMENT ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/tasks
 * Lists all background tasks from Python /tasks.
 */
app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/tasks');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Tasks list error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks', message: error.message });
  }
});

/**
 * POST /api/tasks/:id/cancel
 * Cancels a background task.
 */
app.post('/api/tasks/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await proxyToNeural(`/tasks/${id}/cancel`, { method: 'POST' });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Task cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel task', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  STOA GROUP DB ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/stoa/status
 * Returns Stoa DB connection status.
 */
app.get('/api/stoa/status', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/stoa/status');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa status error:', error);
    res.status(500).json({ error: 'Failed to fetch Stoa status', message: error.message });
  }
});

/**
 * GET /api/stoa/tables
 * Returns available Stoa tables and their schemas.
 */
app.get('/api/stoa/tables', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/stoa/tables');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa tables error:', error);
    res.status(500).json({ error: 'Failed to fetch Stoa tables', message: error.message });
  }
});

/**
 * POST /api/stoa/sync
 * Triggers a Stoa DB sync (immediate pull → training JSONL).
 * Requires FULL_CAPABILITIES.
 */
app.post('/api/stoa/sync', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const data = await proxyToNeural('/stoa/sync', { method: 'POST', body: req.body || {} });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa sync error:', error);
    res.status(500).json({ error: 'Stoa sync failed', message: error.message });
  }
});

/**
 * POST /api/stoa/query
 * Executes a natural-language or raw SQL query against Stoa DB.
 * Requires FULL_CAPABILITIES.
 */
app.post('/api/stoa/query', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { query, queryType = 'natural_language' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const data = await proxyToNeural('/stoa/query', {
      method: 'POST',
      body: { query, query_type: queryType },
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa query error:', error);
    res.status(500).json({ error: 'Stoa query failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  METRICS DASHBOARD
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/metrics/dashboard
 * Aggregated system + model metrics from Python /metrics/dashboard.
 */
app.get('/api/metrics/dashboard', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/metrics/dashboard');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Metrics dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch metrics', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TOKEN GENERATION
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/tokens/generate
 * Body: { type, userId, permissions? }
 * Generates a signed JWT token.
 */
app.post('/api/tokens/generate', async (req, res) => {
  try {
    const { type, userId, permissions = [] } = req.body;
    if (!['STOA_ACCESS', 'FULL_CAPABILITIES'].includes(type)) {
      return res.status(400).json({ error: 'Invalid token type. Must be STOA_ACCESS or FULL_CAPABILITIES' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const tokenData = tokenManager.generateToken(userId, type, permissions);
    res.json({ success: true, ...tokenData });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Token generation failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  MCP SKILLS MANAGEMENT  (/api/mcp/*)
// ════════════════════════════════════════════════════════════════

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
      skill: skillConfig,
    });
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

// ════════════════════════════════════════════════════════════════
//  SELF-EVOLUTION  (/api/self-evolution/*)
// ════════════════════════════════════════════════════════════════

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
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json({ success: true, manifest });
  } catch (error) {
    res.status(500).json({ error: `Failed to get ownership info: ${error.message}` });
  }
});

app.get('/api/self-evolution/stats', authenticateToken, (req, res) => {
  const stats = selfEvolution.getEvolutionStats();
  res.json({ success: true, ...stats });
});

// ════════════════════════════════════════════════════════════════
//  CROSS-DEVICE SYNC  (/api/sync/*)
// ════════════════════════════════════════════════════════════════

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

// ════════════════════════════════════════════════════════════════
//  SMART HOME  (/api/smarthome/*)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/smarthome/control
 * Body: { device, action, parameters? }
 */
app.post('/api/smarthome/control', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('smart_home')) {
    return res.status(403).json({ error: 'Smart home access denied' });
  }
  try {
    const { device, action, parameters } = req.body;
    const result = await smartHomeConnector.executeCommand(device, action, parameters);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ error: 'Smart home control failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  PERSONALITY & ADAPTIVE LEARNING
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/personality
 * Returns personality profile for the authenticated user.
 */
app.get('/api/personality', authenticateToken, (req, res) => {
  const personality = adaptiveLearning.getPersonalityProfile(req.user.userId);
  res.json({ success: true, personality });
});

/**
 * POST /api/learn
 * Body: { data, source }
 * Triggers adaptive learning + neural retrain.
 */
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
    console.error('Learn error:', error);
    res.status(500).json({ error: 'Training failed', message: error.message });
  }
});

/**
 * POST /api/init
 * Body: { emails?, texts?, documents? }
 * Initialize personal data and load context into neural engine.
 */
app.post('/api/init', authenticateToken, async (req, res) => {
  try {
    const { emails = [], texts = [], documents = [] } = req.body;
    await adaptiveLearning.initializePersonalData({
      userId: req.user.userId,
      emails,
      texts,
      documents,
    });
    await neuralEngine.loadPersonalContext(req.user.userId);
    const totalDataPoints = emails.length + texts.length + documents.length;
    res.json({
      success: true,
      message: 'A.L.E.C. is now personalized for you',
      dataPoints: totalDataPoints,
    });
  } catch (error) {
    console.error('Init error:', error);
    res.status(500).json({ error: 'Initialization failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  NEURAL STATS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/neural/stats
 * Returns neural engine stats (queries processed, model status).
 */
app.get('/api/neural/stats', authenticateToken, (req, res) => {
  const stats = neuralEngine.getStats();
  res.json({ success: true, ...stats });
});

// ════════════════════════════════════════════════════════════════
//  VOICE INTERFACE
// ════════════════════════════════════════════════════════════════

// Initialize voice WebSocket
const voiceServer = voiceInterface.initialize();
if (voiceServer) {
  console.log('🎤 Voice WebSocket initialized');
}

// ════════════════════════════════════════════════════════════════
//  USER MANAGEMENT (Owner only)
// ════════════════════════════════════════════════════════════════

app.get('/api/auth/users', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users');
  res.json(data);
});

app.post('/api/auth/users/create', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/create', 'POST', req.body);
  res.json(data);
});

app.post('/api/auth/users/role', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/role', 'POST', req.body);
  res.json(data);
});

app.post('/api/auth/users/password', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/password', 'POST', req.body);
  res.json(data);
});

app.delete('/api/auth/users/:email', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural(`/auth/users/${encodeURIComponent(req.params.email)}`, 'DELETE');
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  MEMORY (Teaching & Learning)
// ════════════════════════════════════════════════════════════════

// Teach A.L.E.C. something
app.post('/api/memory/teach', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/memory/teach', 'POST', req.body);
  res.json(data);
});

// Search A.L.E.C.'s memory
app.post('/api/memory/search', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/memory/search', 'POST', req.body);
  res.json(data);
});

// Get all memories
app.get('/api/memory/all', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/memory/all');
  res.json(data);
});

// Memory stats
app.get('/api/memory/stats', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/memory/stats');
  res.json(data);
});

// Get memories by category
app.get('/api/memory/category/:category', authenticateToken, async (req, res) => {
  const data = await proxyToNeural(`/memory/category/${req.params.category}`);
  res.json(data);
});

// Delete a memory
app.delete('/api/memory/:id', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural(`/memory/${req.params.id}`, 'DELETE');
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  EXCEL
// ════════════════════════════════════════════════════════════════

app.post('/api/excel/read', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/read', 'POST', req.body);
  res.json(data);
});

app.post('/api/excel/export', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/excel/export', 'POST', req.body);
  res.json(data);
});

app.post('/api/excel/edit', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/excel/edit', 'POST', req.body);
  res.json(data);
});

app.post('/api/excel/analyze', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/analyze', 'POST', req.body);
  res.json(data);
});

app.get('/api/excel/status', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/status');
  res.json(data);
});

// Serve exported files
app.use('/exports', express.static(path.join(__dirname, '..', 'data', 'exports')));

// ════════════════════════════════════════════════════════════════
//  INITIATIVE (Autonomous Agent)
// ════════════════════════════════════════════════════════════════

app.post('/api/initiative/scan', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/initiative/scan', 'POST');
  res.json(data);
});

app.get('/api/initiative/status', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/initiative/status');
  res.json(data);
});

app.post('/api/initiative/analyze-performance', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/initiative/analyze-performance', 'POST');
  res.json(data);
});

app.get('/api/initiative/suggest-skills', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/initiative/suggest-skills');
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════════════════════════════

app.listen(PORT, HOST, () => {
  const lanIps = getLanAddresses();
  const lanList = lanIps.length > 0
    ? lanIps.map(ip => `http://${ip}:${PORT}`).join('\n║   ')
    : '(no LAN interfaces detected)';

  console.log(`
╔═══════════════════════════════════════════════════════╗
║   🧠 A.L.E.C. — Autonomous Language Embedded Cognition
╠═══════════════════════════════════════════════════════╣
║   Status:  ONLINE
║   Port:    ${PORT}
║   Host:    ${HOST}
║   Neural:  ${NEURAL_URL}
║   Model:   Qwen2.5-Coder-7B-Instruct (Q4_K_M)
║
║   Local:   http://localhost:${PORT}
║   LAN:     ${lanList}
╚═══════════════════════════════════════════════════════╝

💬 Chat:       POST /api/chat
🔐 Login:      POST /api/auth/login
🏋️  Train:      POST /api/training/start
📊 Metrics:    GET  /api/metrics/dashboard
📁 Files:      GET  /api/files
🗄️  Stoa:       GET  /api/stoa/status
❤️  Feedback:   POST /api/feedback
🤖 Domo embed: ?embed=domo (auto-auth)
`);
});

module.exports = app;

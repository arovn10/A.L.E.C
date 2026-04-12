/**
 * A.L.E.C. — Adaptive Learning Executive Coordinator
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

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // LAN-accessible by default
const NEURAL_URL = `http://localhost:${process.env.NEURAL_PORT || 8000}`;

// ════════════════════════════════════════════════════════════════
//  MULTI-BACKEND LLM CLIENT
//  Priority: 1. node-llama-cpp (embedded Metal inference, no server)
//             2. Ollama (if reachable and models available)
//             3. Clear error message
//
//  node-llama-cpp uses its own llama.cpp Metal build which works on
//  macOS 15.4+ where Ollama's ggml Metal implementation crashes.
// ════════════════════════════════════════════════════════════════
const llamaEngine      = require('../services/llamaEngine.js');
const desktopControl   = require('../services/desktopControl.js');
const stoaQuery        = require('../services/stoaQueryService.js');
const excelExport      = require('../services/excelExport.js');

// Warm up the embedded engine on startup
llamaEngine.warmUp();

/**
 * System prompt — generated fresh on every request so the date is always accurate.
 * LLMs have a training cutoff and don't know the current date unless told explicitly.
 */
function buildSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  return `You are Alec, Alec Rovner's personal AI executive assistant running on his Mac.
You help with smart home control, STOA real estate database queries, reminders, grocery lists, web research, and general conversation.
You can search the web, remember past conversations, and take initiative to be proactive.
Use markdown formatting for clarity (headers, code blocks, bullet points where appropriate).
Refer to yourself as "Alec" — never "A.L.E.C." or "ALEC" with dots. Be direct, smart, and friendly.
Current date and time: ${dateStr} at ${timeStr}.`;
}

// Keep a static alias for backward compat with any code referencing ALEC_SYSTEM_PROMPT directly
const ALEC_SYSTEM_PROMPT = buildSystemPrompt();

/**
 * Non-streaming call — returns text string.
 * Uses node-llama-cpp embedded engine (Metal GPU on Apple Silicon).
 */
async function callLLMText(messages, voiceMode = false) {
  const maxTokens  = voiceMode ? 150  : 1024;
  const temperature = voiceMode ? 0.5  : 0.7;

  // Inject system prompt (with live date) if not already present
  const hasSystem = messages.some(m => m.role === 'system');
  const fullMsgs  = hasSystem ? messages : [
    { role: 'system', content: buildSystemPrompt() },
    ...messages,
  ];

  return await llamaEngine.generate(fullMsgs, { maxTokens, temperature });
}

/**
 * Streaming call — returns async generator that yields token strings.
 */
async function* callLLMStream(messages, voiceMode = false) {
  const maxTokens   = voiceMode ? 150  : 1024;
  const temperature = voiceMode ? 0.5  : 0.7;

  const hasSystem = messages.some(m => m.role === 'system');
  const fullMsgs  = hasSystem ? messages : [
    { role: 'system', content: buildSystemPrompt() },
    ...messages,
  ];

  yield* llamaEngine.generateStream(fullMsgs, { maxTokens, temperature });
}

// Legacy alias (some routes use callLLM)
async function callLLM(messages, { stream = false, voiceMode = false } = {}) {
  if (stream) {
    return { type: 'llama', stream: true, generator: callLLMStream(messages, voiceMode) };
  }
  const text = await callLLMText(messages, voiceMode);
  return { type: 'llama', stream: false, text };
}

// ════════════════════════════════════════════════════════════════
//  PERSISTENT MEMORY
//  JSON file at data/memory.json — no extra dependencies needed.
//  Stores: facts (extracted entities/preferences), conversation
//  summaries, and feedback-driven prompt improvements.
// ════════════════════════════════════════════════════════════════
const MEMORY_FILE    = path.join(__dirname, '../data/memory.json');
const FEEDBACK_FILE  = path.join(__dirname, '../data/feedback.jsonl');

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (_) {}
  return { facts: [], preferences: [], summaries: [], promptVersion: 1 };
}

function saveMemory(mem) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

function buildMemoryContext(mem) {
  const lines = [];
  if (mem.facts?.length)       { lines.push('Known facts about Alec:');      mem.facts.slice(-20).forEach(f => lines.push(`- ${f}`)); }
  if (mem.preferences?.length) { lines.push("Alec's known preferences:");    mem.preferences.slice(-10).forEach(p => lines.push(`- ${p}`)); }
  if (mem.summaries?.length)   { lines.push('Recent conversation context:'); lines.push(mem.summaries[mem.summaries.length-1]); }
  return lines.join('\n');
}

// Asynchronously extract new facts from a conversation turn via Ollama
async function extractAndStoreFacts(userMsg, assistantReply) {
  try {
    const raw = await callLLMText([
      { role: 'system', content: 'Extract concise factual statements about the user (Alec) from this conversation snippet. Return ONLY a JSON array of short fact strings, max 3. Example: ["Alec works in real estate","Alec prefers short answers"]. Return [] if nothing new.' },
      { role: 'user',   content: `User: ${userMsg}\nAssistant: ${assistantReply}` },
    ], true); // voiceMode = fast/cheap settings
    // Extract the JSON array from the response (handle leading text)
    const match = (raw || '').match(/\[[\s\S]*\]/);
    if (!match) return;
    const newFacts = JSON.parse(match[0]);
    if (!Array.isArray(newFacts) || newFacts.length === 0) return;
    const mem = loadMemory();
    mem.facts = [...(mem.facts || []), ...newFacts].slice(-50); // keep last 50 facts
    saveMemory(mem);
  } catch (_) { /* non-critical */ }
}

// ════════════════════════════════════════════════════════════════
//  WEB SEARCH (DuckDuckGo Instant Answers — no API key needed)
// ════════════════════════════════════════════════════════════════
const SEARCH_TRIGGERS = /\b(search|find|look up|what is|who is|latest|news|current|today|weather|price|how much|when did|when is|define|meaning of)\b/i;

async function webSearch(query) {
  try {
    const encoded = encodeURIComponent(query);
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await resp.json();
    const results = [];
    if (data.Abstract)      results.push(data.Abstract);
    if (data.Answer)        results.push(data.Answer);
    if (data.Definition)    results.push(data.Definition);
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 3).forEach(t => { if (t.Text) results.push(t.Text); });
    }
    return results.length > 0 ? results.join('\n') : null;
  } catch (_) {
    return null;
  }
}

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
app.use(cors({
  origin: true,  // Allow all origins (needed for HA iframe)
  credentials: true,
}));

// Allow iframe embedding with full permissions (Home Assistant, Domo, etc.)
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('Permissions-Policy', 'microphone=*, camera=*, geolocation=*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
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
  const { method = 'GET', body = null, query = '', timeoutMs = 300000 } = options;
  const url = `${NEURAL_URL}${path}${query ? '?' + query : ''}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const fetchOptions = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body !== null) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const resp = await fetch(url, fetchOptions);
    clearTimeout(timeout);
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const err = new Error(errBody.detail || errBody.error || `Neural engine returned ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      const e = new Error('Neural engine request timed out (5 min)');
      e.status = 504;
      throw e;
    }
    throw err;
  }
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

    if (verified.tokenType === 'OWNER') {
      req.user = { ...verified, scope: ['owner', 'full_access', 'neural_training', 'smart_home', 'stoa_data', 'user_management', 'connectors'] };
    } else if (verified.tokenType === 'FULL_CAPABILITIES') {
      req.user = { ...verified, scope: ['full_access', 'neural_training', 'smart_home', 'stoa_data'] };
    } else if (verified.tokenType === 'STOA_ACCESS') {
      req.user = { ...verified, scope: ['stoa_data', 'chat'] };
    } else {
      // Default: chat only
      req.user = { ...verified, scope: ['chat'] };
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

app.get('/health', (req, res) => {
  const mem = loadMemory();
  const llmStatus = llamaEngine.getStatus();
  res.json({
    status:    'ok',
    service:   'A.L.E.C.',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
    llm: {
      backend:   'node-llama-cpp (llama.cpp Metal)',
      modelPath: llmStatus.modelPath,
      gpu:       llmStatus.gpu,
      ready:     llmStatus.loaded,
      contexts:  llmStatus.contexts,
      note:      'HuggingFace / local GGUF models. Same tech as Ollama, Metal-safe on macOS 15.4+.',
    },
    memory: {
      facts:       mem.facts?.length || 0,
      preferences: mem.preferences?.length || 0,
      heapUsed:    process.memoryUsage().heapUsed,
    },
    voice:      voiceInterface.getStatus(),
    lanAddresses: getLanAddresses(),
    uptime:     process.uptime(),
  });
});

app.get('/api/health', (req, res) => res.redirect('/health'));

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

    // ── Local owner bypass (Python engine may be offline) ──────────
    const localOwnerEmail = process.env.ALEC_OWNER_EMAIL || 'alec@rovner.com';
    const localOwnerPass  = process.env.ALEC_OWNER_PASS  || 'alec2024';
    if (password === localOwnerPass && (email === localOwnerEmail || email === 'alec' || email === 'owner')) {
      const token = jwt.sign(
        { userId: 'alec-owner', email: localOwnerEmail, role: 'owner', tokenType: 'OWNER' },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );
      return res.json({ success: true, token, tokenType: 'OWNER', user: { email: localOwnerEmail, role: 'owner' } });
    }

    const data = await proxyToNeural('/auth/login', {
      method: 'POST',
      body: { email, password, is_domo_embed },
    });

    // Python returns {success, user: {id, email, role}, access_level}
    const user = data.user || {};
    // Map access_level from Python to JWT tokenType
    let tokenType = 'STOA_ACCESS';
    if (data.access_level === 'OWNER') tokenType = 'OWNER';
    else if (data.access_level === 'FULL_CAPABILITIES') tokenType = 'FULL_CAPABILITIES';
    else if (data.access_level === 'STOA_ACCESS') tokenType = 'STOA_ACCESS';
    const jwtPayload = {
      userId: user.id || email,
      email: user.email || email,
      role: user.role || 'viewer',
      tokenType,
    };

    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Trust this device so it stays logged in across restarts
    const deviceId = req.body.device_id || req.headers['x-device-id'] || `dev_${Date.now()}`;
    const ipAddr = req.ip || req.connection?.remoteAddress || '';
    try {
      await proxyToNeural('/auth/device/trust', {
        method: 'POST',
        body: {
          device_id: deviceId,
          user_email: jwtPayload.email,
          ip_address: ipAddr,
          user_agent_hash: require('crypto').createHash('md5').update(req.headers['user-agent'] || '').digest('hex'),
          device_name: req.body.device_name || req.headers['user-agent']?.slice(0, 50) || 'Unknown',
        },
      });
    } catch {} // Non-critical

    res.json({
      success: true,
      token,
      tokenType,
      device_id: deviceId,
      access_level: data.access_level,
      email: jwtPayload.email,
      role: jwtPayload.role,
      user: user,
      expiresIn: '7d',
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
 * Non-streaming chat via embedded node-llama-cpp engine (Metal GPU).
 * Returns { response, latency_ms, source }.
 */
app.post('/api/chat', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  try {
    const { message, messages = [], session_id } = req.body;
    const userText = message || messages.at(-1)?.content || '';

    // Log interaction for adaptive learning
    try { await adaptiveLearning.logInteraction({ userId: req.user.userId, message: userText, timestamp: Date.now() }); } catch(_){}

    // Build system prompt with memory
    const mem = loadMemory();
    const memCtx = buildMemoryContext(mem);
    let systemContent = buildSystemPrompt() + (memCtx ? '\n\n' + memCtx : '');

    // ── Excel export detection — short-circuit before LLM if user wants a file ──
    const exportIntent = excelExport.detectExportIntent(userText);
    if (exportIntent) {
      try {
        console.log('[Excel] Generating export:', exportIntent);
        const result = await excelExport.generateExport(exportIntent);
        const friendlyType = { portfolio: 'portfolio occupancy & rent growth', trend: `${exportIntent.property || ''} trend`, pipeline: 'acquisition pipeline', loans: 'loan summary', full: 'full STOA report' }[result.type] || result.type;
        return res.json({
          success: true,
          response: `📊 Here's your **${friendlyType}** Excel report:\n\n**[Download ${result.fileName}](${result.url})**\n\nGenerated at ${new Date(result.generatedAt).toLocaleTimeString('en-US')} — includes real-time data pulled directly from the STOA database.`,
          download_url: result.url,
          latency_ms: Date.now() - startTime,
          source: 'stoa-export',
        });
      } catch (exportErr) {
        console.warn('[Excel] Export failed:', exportErr.message?.slice(0, 100));
        // Fall through to LLM with error note
        systemContent += '\n\n*Note: Excel export was attempted but failed. Provide a text summary instead.*';
      }
    }

    // ── STOA RAG: inject live database context before LLM call ──
    // Detects property/leasing/deal questions and pulls real numbers from
    // Azure SQL — this prevents hallucination by grounding the LLM in facts.
    try {
      const stoaCtx = await stoaQuery.buildStoaContext(userText);
      if (stoaCtx) {
        systemContent += '\n\n' + stoaCtx;
        console.log('[STOA RAG] Injected live data for:', userText.slice(0, 60));
      }
    } catch (stoaErr) {
      console.warn('[STOA RAG] Failed (non-critical):', stoaErr.message?.slice(0, 80));
    }

    // Web search augmentation
    let augmentedMessages = [...messages];
    if (SEARCH_TRIGGERS.test(userText)) {
      const searchResult = await webSearch(userText);
      if (searchResult && augmentedMessages.length > 0) {
        const lastMsg = augmentedMessages.at(-1);
        augmentedMessages[augmentedMessages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + `\n\n[Web search results for context]:\n${searchResult}`,
        };
      }
    }

    const llmMessages = [{ role: 'system', content: systemContent }, ...augmentedMessages];
    const responseText = await callLLMText(llmMessages);
    const latency_ms = Date.now() - startTime;

    // Async: extract and store facts from this exchange
    extractAndStoreFacts(userText, responseText).catch(() => {});

    const engineStatus = llamaEngine.getStatus();
    res.json({
      success: true,
      response: responseText,
      latency_ms,
      source:    'llama-metal',
      model:     engineStatus.modelPath,
      timestamp:  new Date().toISOString(),
    });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      success: false,
      error:   'Alec is having trouble thinking',
      message: error.message,
    });
  }
});

/**
 * POST /api/chat/stream
 * SSE streaming endpoint — tokens arrive one-by-one like Claude.
 * Browser reads via ReadableStream / EventSource.
 */
app.post('/api/chat/stream', authenticateToken, async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  const { message, messages = [], session_id } = req.body;
  const userText = message || messages.at(-1)?.content || '';

  try {
    // System prompt + memory
    const mem = loadMemory();
    const memCtx = buildMemoryContext(mem);
    let systemContent = buildSystemPrompt() + (memCtx ? '\n\n' + memCtx : '');

    // ── Excel export detection (stream) — send download link immediately ──
    const exportIntentStream = excelExport.detectExportIntent(userText);
    if (exportIntentStream) {
      try {
        res.write('data: {"token":"📊 Generating Excel report…\\n"}\n\n');
        const result = await excelExport.generateExport(exportIntentStream);
        const friendlyType = { portfolio: 'portfolio occupancy & rent growth', trend: `${exportIntentStream.property || ''} trend`, pipeline: 'acquisition pipeline', loans: 'loan summary', full: 'full STOA report' }[result.type] || result.type;
        const msg = `\\n**[Download ${result.fileName}](${result.url})**\\n\\nReal-time data from the STOA database, generated at ${new Date(result.generatedAt).toLocaleTimeString('en-US')}.`;
        res.write(`data: {"token":${JSON.stringify(msg)}}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (exportErr) {
        res.write('data: {"token":"⚠️ Export failed, providing text summary instead.\\n\\n"}\n\n');
        console.warn('[Excel stream] Export failed:', exportErr.message?.slice(0, 100));
        // Fall through to LLM
      }
    }

    // ── STOA RAG: inject live database context ────────────────
    try {
      const stoaCtx = await stoaQuery.buildStoaContext(userText);
      if (stoaCtx) {
        systemContent += '\n\n' + stoaCtx;
        res.write('data: {"token":"📊 "}\n\n'); // subtle indicator that real data was loaded
        console.log('[STOA RAG stream] Injected live data for:', userText.slice(0, 60));
      }
    } catch (stoaErr) {
      console.warn('[STOA RAG stream] Failed (non-critical):', stoaErr.message?.slice(0, 80));
    }

    // Web search augmentation
    let augmentedMessages = [...messages];
    if (SEARCH_TRIGGERS.test(userText)) {
      res.write('data: {"token":"🔍 Searching the web…\\n"}\n\n');
      const searchResult = await webSearch(userText);
      if (searchResult && augmentedMessages.length > 0) {
        const lastMsg = augmentedMessages.at(-1);
        augmentedMessages[augmentedMessages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + `\n\n[Web search results for context]:\n${searchResult}`,
        };
        res.write('data: {"token":"\\n"}\n\n');
      }
    }

    const llmMessages = [{ role: 'system', content: systemContent }, ...augmentedMessages];
    let fullResponse  = '';

    // ── node-llama-cpp streaming (Metal GPU, no external server) ──
    for await (const token of callLLMStream(llmMessages)) {
      if (token) {
        fullResponse += token;
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    // Signal completion with metadata
    res.write(`data: ${JSON.stringify({ done: true, latency_ms: Date.now() })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    // Async: extract facts, log interaction
    extractAndStoreFacts(userText, fullResponse).catch(() => {});
    try { await adaptiveLearning.logInteraction({ userId: 'stream', message: userText, timestamp: Date.now() }); } catch(_){}

  } catch (err) {
    console.error('Stream error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
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
    const { rating, feedback, response_text, prompt_text } = req.body;

    if (rating === undefined) return res.status(400).json({ error: 'rating is required' });

    // Write to JSONL feedback log for self-improvement analysis
    const entry = {
      ts:           new Date().toISOString(),
      conversation_id: convId,
      rating,           // 1 = thumbs up, -1 = thumbs down
      feedback:     feedback || '',
      prompt:       prompt_text || '',
      response:     response_text || '',
      user_id:      req.user?.userId,
    };
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + '\n');

    // If negative feedback, store a preference note
    if (rating === -1 && response_text) {
      const mem = loadMemory();
      mem.preferences = mem.preferences || [];
      mem.preferences.push(`Alec rated this response poorly: "${response_text.slice(0, 100)}…"`);
      mem.preferences = mem.preferences.slice(-20); // keep last 20
      saveMemory(mem);
    }

    res.json({ success: true, logged: true });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Feedback submission failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  MEMORY ENDPOINTS
//  Read / write Alec's persistent facts and preferences.
// ════════════════════════════════════════════════════════════════

/** GET /api/memory — return current memory */
app.get('/api/memory', authenticateToken, (req, res) => {
  res.json(loadMemory());
});

/** POST /api/memory/fact — add a fact manually */
app.post('/api/memory/fact', authenticateToken, (req, res) => {
  const { fact } = req.body;
  if (!fact) return res.status(400).json({ error: 'fact is required' });
  const mem = loadMemory();
  mem.facts = [...(mem.facts || []), fact].slice(-50);
  saveMemory(mem);
  res.json({ success: true, total_facts: mem.facts.length });
});

/** DELETE /api/memory — wipe all memory */
app.delete('/api/memory', authenticateToken, (req, res) => {
  saveMemory({ facts: [], preferences: [], summaries: [], promptVersion: 1 });
  res.json({ success: true, message: 'Memory cleared.' });
});

// ════════════════════════════════════════════════════════════════
//  DESKTOP CONTROL SKILLS
// ════════════════════════════════════════════════════════════════

/** GET /api/skills — list available desktop skills */
app.get('/api/skills', authenticateToken, (req, res) => {
  res.json({ skills: desktopControl.listSkills() });
});

/** POST /api/skills/run — execute a skill */
app.post('/api/skills/run', authenticateToken, async (req, res) => {
  const { skill, args = {} } = req.body;
  if (!skill) return res.status(400).json({ error: 'skill name required' });
  const result = await desktopControl.executeSkill(skill, args);
  res.json(result);
});

/** POST /api/skills/screenshot — convenience endpoint */
app.post('/api/skills/screenshot', authenticateToken, async (req, res) => {
  const result = await desktopControl.executeSkill('screenshot', {});
  if (result.success) {
    res.json({ success: true, path: result.result });
  } else {
    res.status(500).json(result);
  }
});

// Augment the chat endpoint to detect and run skills
// This runs before the LLM call in /api/chat and /api/chat/stream
async function maybeRunDesktopSkill(userText) {
  const intent = desktopControl.detectSkillIntent(userText);
  if (!intent) return null;
  const result = await desktopControl.executeSkill(intent.skill, intent.args);
  if (!result.success) return null;
  return { skill: intent.skill, result: result.result };
}

// ════════════════════════════════════════════════════════════════
//  MODEL MANAGEMENT (HuggingFace / local GGUF)
// ════════════════════════════════════════════════════════════════

/** GET /api/models — list all available GGUF models */
app.get('/api/models', authenticateToken, (req, res) => {
  res.json({ models: llamaEngine.listModels(), current: llamaEngine.getStatus() });
});

/** POST /api/models/download — download a model from HuggingFace */
app.post('/api/models/download', authenticateToken, requireFullCapabilities, async (req, res) => {
  const { repoId, fileName } = req.body;
  if (!repoId || !fileName) return res.status(400).json({ error: 'repoId and fileName required' });
  try {
    const modelPath = await llamaEngine.downloadFromHuggingFace(repoId, fileName);
    res.json({ success: true, modelPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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
    res.json({ success: true, model_name: 'Qwen2.5-Coder-7B', status: 'neural_offline', loaded: false, message: 'Neural engine unavailable' });
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
app.get("/api/training/history", authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural("/training/history");
    res.json(data);
  } catch (error) {
    res.json({ training_runs: [], evolution_log: [], error: error.message });
  }
});

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
 * GET /api/stoa/ping
 * Quick connectivity test for the live Azure SQL STOA database.
 */
app.get('/api/stoa/ping', authenticateToken, async (req, res) => {
  const result = await stoaQuery.ping();
  res.json(result);
});

/**
 * POST /api/stoa/export
 * Generate a STOA Excel workbook and return a download URL.
 * Body: { type, property, months }
 *   type: 'portfolio' | 'trend' | 'pipeline' | 'loans' | 'full'
 */
app.post('/api/stoa/export', authenticateToken, async (req, res) => {
  try {
    const { type = 'portfolio', property = null, months = 6 } = req.body || {};
    console.log('[STOA Export] Generating:', { type, property, months });
    const result = await excelExport.generateExport({ type, property, months });
    res.json({
      success: true,
      url: result.url,
      fileName: result.fileName,
      type: result.type,
      property: result.property,
      generatedAt: result.generatedAt,
    });
  } catch (err) {
    console.error('[STOA Export] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/trend?property=...&months=6
 * Returns weekly MMR history for a property.
 */
app.get('/api/stoa/trend', authenticateToken, async (req, res) => {
  try {
    const { property, months = '6' } = req.query;
    if (!property) return res.status(400).json({ success: false, error: 'property param required' });
    const rows = await stoaQuery.getMMRHistory(property, parseInt(months));
    res.json({ success: true, count: rows.length, property, months: parseInt(months), data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/rent-growth?property=...
 * Returns pre-computed rent growth percentages.
 */
app.get('/api/stoa/rent-growth', authenticateToken, async (req, res) => {
  try {
    const { property } = req.query;
    const rows = property
      ? await stoaQuery.getRentGrowthHistory(property)
      : await stoaQuery.getPortfolioRentGrowth();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/occupancy?property=...
 * Returns live occupancy/leasing data for one or all properties.
 */
app.get('/api/stoa/occupancy', authenticateToken, async (req, res) => {
  try {
    const property = req.query.property || null;
    const rows = await stoaQuery.getMMRData(property);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/portfolio
 * Returns portfolio-level KPIs across all active properties.
 */
app.get('/api/stoa/portfolio', authenticateToken, async (req, res) => {
  try {
    const [summary] = await stoaQuery.getPortfolioSummary();
    const properties = await stoaQuery.getMMRData();
    res.json({ success: true, summary, properties });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/projects?search=...
 * Search projects by name or city.
 */
app.get('/api/stoa/projects', authenticateToken, async (req, res) => {
  try {
    const search = req.query.search || '';
    const projects = await stoaQuery.findProjects(search);
    res.json({ success: true, count: projects.length, data: projects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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

// Generate a long-lived embed token for Home Assistant / iframe use
app.post('/api/auth/embed-token', authenticateToken, requireFullCapabilities, (req, res) => {
  const { email, role, access_level } = req.body;
  const tokenType = access_level === 'OWNER' ? 'OWNER' :
                    access_level === 'FULL_CAPABILITIES' ? 'FULL_CAPABILITIES' : 'STOA_ACCESS';
  const jwtPayload = {
    userId: req.user.userId,
    email: email || req.user.email,
    role: role || req.user.role,
    tokenType,
    embed: true,
  };
  // 365-day token for persistent iframe access
  const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '365d' });
  res.json({ success: true, token, usage: `Add ?token=${token} to your iframe URL` });
});

// Device-based auto-login (no auth required — this IS the auth)
app.post('/api/auth/device/check', async (req, res) => {
  try {
    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: 'device_id required' });

    const data = await proxyToNeural('/auth/device/check', {
      method: 'POST',
      body: { device_id },
    });

    // Device is trusted — issue a fresh JWT
    const user = data.user || {};
    let tokenType = 'STOA_ACCESS';
    if (data.access_level === 'OWNER') tokenType = 'OWNER';
    else if (data.access_level === 'FULL_CAPABILITIES') tokenType = 'FULL_CAPABILITIES';

    const jwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role || 'viewer',
      tokenType,
    };
    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      tokenType,
      device_id,
      access_level: data.access_level,
      email: user.email,
      role: user.role,
      user,
    });
  } catch (error) {
    res.status(404).json({ trusted: false });
  }
});

app.get('/api/auth/devices', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/devices');
  res.json(data);
});

app.delete('/api/auth/device/:deviceId', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural(`/auth/device/${req.params.deviceId}`, { method: 'DELETE' });
  res.json(data);
});

app.get('/api/auth/users', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users');
  res.json(data);
});

app.post('/api/auth/users/create', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/create', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/auth/users/role', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/role', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/auth/users/password', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/password', { method: 'POST', body: req.body });
  res.json(data);
});

app.delete('/api/auth/users/:email', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural(`/auth/users/${encodeURIComponent(req.params.email)}`, { method: 'DELETE' });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  MEMORY (Teaching & Learning)
// ════════════════════════════════════════════════════════════════

// Teach A.L.E.C. something
app.post('/api/memory/teach', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/memory/teach', { method: 'POST', body: req.body });
  res.json(data);
});

// Search A.L.E.C.'s memory
app.post('/api/memory/search', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/memory/search', { method: 'POST', body: req.body });
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
  const data = await proxyToNeural(`/memory/${req.params.id}`, { method: 'DELETE' });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  EXCEL
// ════════════════════════════════════════════════════════════════

app.post('/api/excel/read', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/read', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/excel/export', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/excel/export', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/excel/edit', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/excel/edit', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/excel/analyze', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/analyze', { method: 'POST', body: req.body });
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
  const data = await proxyToNeural('/initiative/scan', { method: 'POST' });
  res.json(data);
});

app.get('/api/initiative/status', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/initiative/status');
  res.json(data);
});

app.post('/api/initiative/analyze-performance', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/initiative/analyze-performance', { method: 'POST' });
  res.json(data);
});

app.get('/api/initiative/suggest-skills', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/initiative/suggest-skills');
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  SKILLS REGISTRY
// ════════════════════════════════════════════════════════════════

app.get('/api/skills/available', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/skills/available');
  res.json(data);
});

app.get('/api/skills/installed', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/skills/installed');
  res.json(data);
});

app.post('/api/skills/install', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/skills/install', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/skills/uninstall', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/skills/uninstall', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/skills/configure', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/skills/configure', { method: 'POST', body: req.body });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  CONNECTORS (iMessage, Gmail)
// ════════════════════════════════════════════════════════════════

app.get('/api/stoa/debug', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/stoa/debug');
  res.json(data);
});

app.post('/api/stoa/reload-planner', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/stoa/reload-planner', { method: 'POST', body: {} });
  res.json(data);
});

// TTS endpoint — streams MP3 audio from Python edge-tts
app.post('/api/tts', authenticateToken, async (req, res) => {
  try {
    const resp = await fetch(`${NEURAL_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'TTS failed' });
    }
    res.set('Content-Type', 'audio/mpeg');
    const buffer = await resp.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/connectors/status', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/status');
  res.json(data);
});

app.post('/api/connectors/imessage/sync', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/imessage/sync', { method: 'POST' });
  res.json(data);
});

app.get('/api/connectors/imessage/messages', authenticateToken, requireFullCapabilities, async (req, res) => {
  const limit = req.query.limit || 50;
  const days = req.query.days || 30;
  const data = await proxyToNeural(`/connectors/imessage/messages?limit=${limit}&days=${days}`);
  res.json(data);
});

app.get('/api/connectors/imessage/conversations', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/imessage/conversations');
  res.json(data);
});

app.post('/api/connectors/gmail/sync', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/gmail/sync', { method: 'POST' });
  res.json(data);
});

app.post('/api/connectors/sync-all', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/sync-all', { method: 'POST' });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  PLAID BROKERAGE INTEGRATION  (/api/plaid/*)
//  Owner-only. Enables linking Schwab, Acorns, Fidelity, etc.
// ════════════════════════════════════════════════════════════════

// ── Plaid SQLite table ─────────────────────────────────────────
const DB_PATH = path.join(__dirname, '../data/alec.db');
const plaidDbDir = path.dirname(DB_PATH);
if (!fs.existsSync(plaidDbDir)) fs.mkdirSync(plaidDbDir, { recursive: true });

let plaidDb;
try {
  const Database = require('better-sqlite3');
  plaidDb = new Database(DB_PATH);
} catch {
  // better-sqlite3 may not be installed — fall back to sqlite3
  plaidDb = null;
}

// Initialize plaid_items table using whatever SQLite driver is available
(async () => {
  const CREATE_SQL = `CREATE TABLE IF NOT EXISTS plaid_items (
    item_id TEXT PRIMARY KEY,
    access_token_enc TEXT NOT NULL,
    institution_name TEXT DEFAULT '',
    institution_id TEXT DEFAULT '',
    linked_at TEXT DEFAULT (datetime('now')),
    last_fetched TEXT
  )`;
  if (plaidDb && plaidDb.exec) {
    // better-sqlite3 (synchronous)
    plaidDb.exec(CREATE_SQL);
  } else {
    // Fallback: use Python-side DB or a simple JSON file
    const sqlite3 = await import('sqlite3').then(m => m.default || m).catch(() => null);
    if (sqlite3) {
      plaidDb = new sqlite3.Database(DB_PATH);
      plaidDb.run(CREATE_SQL);
    }
  }
})();

// ── Plaid encryption helpers (AES-256-GCM) ─────────────────────
function getPlaidEncryptionKey() {
  const secret = process.env.JWT_SECRET || 'fallback-secret';
  return crypto.pbkdf2Sync(secret, 'plaid-token-salt', 100000, 32, 'sha256');
}

function encryptAccessToken(plaintext) {
  const key = getPlaidEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store as base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptAccessToken(encoded) {
  const key = getPlaidEncryptionKey();
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
}

// ── Plaid API helper ───────────────────────────────────────────
async function plaidFetch(endpoint, body) {
  const baseUrl = {
    sandbox: 'https://sandbox.plaid.com',
    development: 'https://development.plaid.com',
    production: 'https://production.plaid.com',
  }[process.env.PLAID_ENV || 'sandbox'];

  const resp = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_message || `Plaid API error: ${resp.status}`);
  }
  return resp.json();
}

// ── Plaid DB helpers (work with both better-sqlite3 and sqlite3) ──
function plaidDbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!plaidDb) return resolve([]);
    if (typeof plaidDb.prepare === 'function') {
      // better-sqlite3
      try { resolve(plaidDb.prepare(sql).all(...params)); } catch (e) { reject(e); }
    } else if (typeof plaidDb.all === 'function') {
      // sqlite3
      plaidDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    } else {
      resolve([]);
    }
  });
}

function plaidDbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!plaidDb) return resolve();
    if (typeof plaidDb.prepare === 'function') {
      try { resolve(plaidDb.prepare(sql).run(...params)); } catch (e) { reject(e); }
    } else if (typeof plaidDb.run === 'function') {
      plaidDb.run(sql, params, (err) => err ? reject(err) : resolve());
    } else {
      resolve();
    }
  });
}

// Owner-only middleware for Plaid routes
const requireOwner = (req, res, next) => {
  if (req.user.email !== 'arovner@campusrentalsllc.com') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
};

/**
 * POST /api/plaid/create-link-token
 * Creates a Plaid link_token for the frontend to open Plaid Link.
 */
app.post('/api/plaid/create-link-token', authenticateToken, requireOwner, async (req, res) => {
  try {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      return res.status(500).json({ error: 'Plaid credentials not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in .env' });
    }
    const data = await plaidFetch('/link/token/create', {
      user: { client_user_id: crypto.createHash('sha256').update(req.user.email).digest('hex').slice(0, 32) },
      client_name: 'A.L.E.C.',
      products: ['investments'],
      country_codes: ['US'],
      language: 'en',
    });
    res.json({ link_token: data.link_token });
  } catch (error) {
    console.error('Plaid create-link-token error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/plaid/exchange-token
 * Exchanges a Plaid public_token for an access_token, encrypts & stores it.
 */
app.post('/api/plaid/exchange-token', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { public_token, institution } = req.body;
    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }

    const data = await plaidFetch('/item/public_token/exchange', { public_token });
    const accessTokenEnc = encryptAccessToken(data.access_token);

    await plaidDbRun(
      `INSERT OR REPLACE INTO plaid_items (item_id, access_token_enc, institution_name, institution_id)
       VALUES (?, ?, ?, ?)`,
      [data.item_id, accessTokenEnc, institution?.name || '', institution?.institution_id || '']
    );

    res.json({ success: true, item_id: data.item_id });
  } catch (error) {
    console.error('Plaid exchange-token error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/plaid/holdings
 * Fetches live holdings from all linked brokerage accounts.
 */
app.get('/api/plaid/holdings', authenticateToken, requireOwner, async (req, res) => {
  try {
    const items = await plaidDbAll('SELECT * FROM plaid_items');
    if (items.length === 0) {
      return res.json({ accounts: [], holdings: [], securities: [], total_value: 0 });
    }

    const allAccounts = [];
    const allHoldings = [];
    const allSecurities = [];
    let totalValue = 0;

    for (const item of items) {
      try {
        const accessToken = decryptAccessToken(item.access_token_enc);
        const data = await plaidFetch('/investments/holdings/get', { access_token: accessToken });

        for (const acct of (data.accounts || [])) {
          acct.institution_name = item.institution_name;
          acct.item_id = item.item_id;
          allAccounts.push(acct);
          totalValue += acct.balances?.current || 0;
        }

        allHoldings.push(...(data.holdings || []));
        allSecurities.push(...(data.securities || []));

        // Update last_fetched
        await plaidDbRun(
          `UPDATE plaid_items SET last_fetched = datetime('now') WHERE item_id = ?`,
          [item.item_id]
        );
      } catch (itemErr) {
        console.error(`Plaid holdings error for ${item.institution_name}:`, itemErr.message);
      }
    }

    res.json({ accounts: allAccounts, holdings: allHoldings, securities: allSecurities, total_value: totalValue });
  } catch (error) {
    console.error('Plaid holdings error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/plaid/accounts
 * Lists all linked brokerage institutions.
 */
app.get('/api/plaid/accounts', authenticateToken, requireOwner, async (req, res) => {
  try {
    const items = await plaidDbAll('SELECT item_id, institution_name, institution_id, linked_at, last_fetched FROM plaid_items');
    res.json(items);
  } catch (error) {
    console.error('Plaid accounts error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/plaid/accounts/:itemId
 * Unlinks a brokerage account (removes from Plaid + local DB).
 */
app.delete('/api/plaid/accounts/:itemId', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { itemId } = req.params;
    const items = await plaidDbAll('SELECT * FROM plaid_items WHERE item_id = ?', [itemId]);
    if (items.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Remove from Plaid
    try {
      const accessToken = decryptAccessToken(items[0].access_token_enc);
      await plaidFetch('/item/remove', { access_token: accessToken });
    } catch (plaidErr) {
      console.error('Plaid item/remove warning:', plaidErr.message);
      // Continue to delete locally even if Plaid call fails
    }

    await plaidDbRun('DELETE FROM plaid_items WHERE item_id = ?', [itemId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Plaid unlink error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  REMOTE ADMIN — execute shell commands via secret key
//  Auth: X-Admin-Secret header (NOT JWT — works without login)
//  Only accessible to whoever has the secret. Keep it safe.
// ════════════════════════════════════════════════════════════════

const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

app.post('/api/admin/exec', (req, res) => {
  // Auth: require X-Admin-Secret header
  const secret = req.headers['x-admin-secret'];
  if (!ADMIN_SECRET || !secret || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden — invalid or missing admin secret' });
  }

  const { command, timeout = 120000 } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing "command" in request body' });
  }

  // Safety: cap timeout at 10 minutes
  const maxTimeout = Math.min(timeout, 600000);

  console.log(`🔧 Admin exec: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`);

  const { exec } = require('child_process');
  const projectDir = path.resolve(__dirname, '..');

  exec(command, {
    cwd: projectDir,
    timeout: maxTimeout,
    maxBuffer: 1024 * 1024 * 10,  // 10 MB output buffer
    shell: '/bin/bash',
    env: { ...process.env, HOME: os.homedir() },
  }, (error, stdout, stderr) => {
    const exitCode = error ? error.code || 1 : 0;
    res.json({
      success: exitCode === 0,
      exit_code: exitCode,
      stdout: stdout || '',
      stderr: stderr || '',
      command: command.slice(0, 200),
    });
  });
});

// Convenience: GET version for quick health checks with the secret
app.get('/api/admin/status', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!ADMIN_SECRET || !secret || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { execSync } = require('child_process');
  const projectDir = path.resolve(__dirname, '..');
  let gitHead = 'unknown';
  try { gitHead = execSync('git rev-parse --short HEAD', { cwd: projectDir }).toString().trim(); } catch {}
  let uptime = process.uptime();
  res.json({
    status: 'online',
    git_commit: gitHead,
    node_uptime_seconds: Math.round(uptime),
    neural_url: NEURAL_URL,
    pid: process.pid,
    platform: os.platform(),
    arch: os.arch(),
    total_memory_gb: Math.round(os.totalmem() / 1073741824),
    free_memory_gb: Math.round(os.freemem() / 1073741824),
  });
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
║   🧠 A.L.E.C. — Adaptive Learning Executive Coordinator
╠═══════════════════════════════════════════════════════╣
║   Status:  ONLINE
║   Port:    ${PORT}
║   Host:    ${HOST}
║   Neural:  ${NEURAL_URL}
║   Model:   A.L.E.C. Neural Engine
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

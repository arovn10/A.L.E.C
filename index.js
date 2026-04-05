require('dotenv').config();
require('dotenv').config({ path: '.env.local', override: true });
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { HomeAssistantVoiceIntegrationEnhanced } =
  require('./extensions/home-assistant-voice-integration-enhanced');
const { LocalDatabase } = require('./services/localDatabase');
const { STOADatabase } = require('./services/stoaDatabase');
const { LocalLLMService } = require('./services/localLLMService');

// A.L.E.C. Identity - Forces "A.L.E.C." name, not Qwen
const ALEC_IDENTITY = {
  name: 'A.L.E.C.',
  fullTitle: 'Adaptive Learning Executive Coordinator',
  wakeWord: 'Hey Alec',
};

console.log(`🎤 Starting A.L.E.C. (${ALEC_IDENTITY.name})...`);

let haIntegration;
let localDb;
let stoaDb;
let llmService;
let servicesReady = false;

async function initializeServices() {
  try {
    console.log('🔌 Initializing services...');

    localDb = new LocalDatabase();
    const localConnected = await localDb.connect();
    if (!localConnected) throw new Error('Local DB failed');
    console.log('✅ Local Database connected');

    stoaDb = new STOADatabase();
    const stoaConnected = await stoaDb.connect();
    if (!stoaConnected) throw new Error('STOA DB failed');
    console.log('✅ STOA Group Database connected');

    haIntegration = new HomeAssistantVoiceIntegrationEnhanced({ stoaDb });
    const haConnected = await haIntegration.connect();
    if (haConnected) {
      console.log('✅ Home Assistant connected (voice ungated — no wake phrase required)');
      servicesReady = true;
    } else {
      console.warn(
        '⚠️  Home Assistant not connected. Smart home commands unavailable until HA is reachable; say "Hey Alec" before each command.',
      );
      servicesReady = true;
    }

    llmService = new LocalLLMService();
    const llmOk = await llmService.connect();
    if (llmOk) {
      const s = llmService.getStats();
      console.log(`✅ Local LLM intent layer ready (${s.model})`);
    }

    return true;
  } catch (error) {
    console.error('❌ Critical Error:', error.message);
    process.exit(1);
  }
}

function getIdentityResponse() {
  return `I am ${ALEC_IDENTITY.name}, an Adaptive Learning Executive Coordinator. I am not Qwen. How can I help you manage your home?`;
}

/** Home Assistant layers may return `{ message }`, a boolean from legacy paths, or nothing — never assume `.message` exists. */
function normalizeHaVoiceResult(result) {
  if (result == null) {
    return {
      success: false,
      message: 'No response from Home Assistant for that command.',
    };
  }
  if (typeof result === 'boolean') {
    return {
      success: result,
      message: result
        ? 'Command sent to Home Assistant.'
        : 'Could not send command to Home Assistant.',
    };
  }
  if (typeof result === 'object') {
    const msg =
      typeof result.message === 'string'
        ? result.message
        : result.message != null
          ? String(result.message)
          : 'Done.';
    return { success: result.success !== false, message: msg };
  }
  return { success: true, message: String(result) };
}

function errText(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/** When LOCAL_LLM is off, still route obvious STOA / property questions without keyword-only HA parsing. */
function looksLikeStoaPropertyQuery(text) {
  const t = text.toLowerCase();
  if (/\bstoa\b/.test(t)) return true;
  if (/\b(best|top)\s+(performing\s+)?properties?\b/.test(t)) return true;
  if (/\bperforming\s+properties?\b/.test(t)) return true;
  if (/\bproperties?\b.*\b(best|perform|top)\b/.test(t)) return true;
  if (/\b(see|show)\s+(the\s+)?stoa\b/.test(t) || /\bstoa\s+data\b/.test(t)) return true;
  if (/\b(property|real\s+estate|investments?|portfolio)\b.*\b(austin|market|perform)\b/.test(t))
    return true;
  return false;
}

async function fetchStoaPropertyExtra(db) {
  let extra = '';
  try {
    const rows = await db.getStoaKnowledge('property', 5);
    const stats = await db.getDatabaseStats();
    extra =
      '\n\n' +
      (stats
        ? `STOA stats: ${stats.totalTrainingRecords} training rows, ${stats.uniqueKnowledgeTopics} knowledge topics.`
        : '') +
      (rows && rows.length
        ? '\nRecent knowledge samples: ' + JSON.stringify(rows.slice(0, 3))
        : '\n(No matching property rows in stoa_group_knowledge — add schema-specific queries if needed.)');
  } catch (dbErr) {
    extra = '\n\n(Could not read STOA data: ' + errText(dbErr) + ')';
  }
  return extra;
}

function hasWakeWord(text) {
  const lower = text.toLowerCase();
  if (lower.includes('hey alec')) return true;
  const checker = haIntegration?.detectWakeWord?.();
  if (typeof checker === 'function') return checker(text);
  return false;
}

/** JSON intent from local LLM (LM Studio, etc.). Returns null → use HA keyword path. */
async function processNaturalLanguage(commandText) {
  if (!llmService || !llmService.isConnected) return null;

  const systemPrompt = `You are A.L.E.C. (Adaptive Learning Executive Coordinator). Reply with ONE JSON object only. No markdown, no backticks.
Intents:
- {"intent":"device_control","message":"short ack","command_hint":"user paraphrase of what to do"}
- {"intent":"property_query","message":"short ack","query_type":"summary"}
- {"intent":"small_talk","message":"friendly reply"}
- {"intent":"unknown","message":"I did not understand."}

Use "property_query" only for real-estate / STOA / investment questions. Use "device_control" for lights, climate, media, alarms, reminders, or grocery list.`;

  try {
    const raw = await llmService.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: commandText },
      ],
      { temperature: 0.2, max_tokens: 256 },
    );
    let cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last !== -1) cleaned = cleaned.slice(first, last + 1);

    const parsed = JSON.parse(cleaned);
    if (!parsed.intent || !parsed.message) return null;
    return parsed;
  } catch (e) {
    console.log('⚠️  LLM intent parse failed, using keyword path:', e.message);
    return null;
  }
}

async function processVoiceCommand(text, { requireWakeWord = true } = {}) {
  // When Home Assistant is connected and authenticated, treat voice as fully unlocked
  // (no wake phrase required) — same freedom as the web UI with `from_ui`.
  if (haIntegration?.isConnected) {
    requireWakeWord = false;
  }

  if (requireWakeWord && !hasWakeWord(text)) {
    return {
      message: `Please say "${ALEC_IDENTITY.wakeWord}" first.`,
      wake_word_detected: false,
    };
  }

  const cleanCommand = text.replace(/hey\s*alec/i, '').trim();
  console.log(`🎤 Command: "${cleanCommand}"`);

  if (text.toLowerCase().includes('who are you') || text.includes('qwen')) {
    return { message: getIdentityResponse(), wake_word_detected: true };
  }

  if (!haIntegration) {
    return {
      message: 'Voice backend is still starting. Try again in a moment.',
      wake_word_detected: true,
    };
  }

  try {
    let intent = null;
    if (llmService && llmService.isConnected) {
      intent = await processNaturalLanguage(cleanCommand);
      if (intent) console.log(`🧠 LLM intent: ${intent.intent}`);
    }

    if (intent && intent.intent === 'small_talk') {
      const reply = intent.message || 'Hello!';
      if (localDb && localDb.isConnected) {
        await localDb.saveVoiceInteraction({
          command: cleanCommand,
          response: reply,
          success: true,
        });
      }
      return { message: reply, wake_word_detected: true };
    }

    if (intent && intent.intent === 'property_query' && stoaDb) {
      const lead = intent.message || 'STOA property snapshot.';
      const extra = await fetchStoaPropertyExtra(stoaDb);
      if (localDb && localDb.isConnected) {
        await localDb.saveVoiceInteraction({
          command: cleanCommand,
          response: lead + extra,
          success: true,
        });
      }
      return { message: lead + extra, wake_word_detected: true };
    }

    // No LLM (or unknown intent): heuristic STOA / property questions
    if (
      stoaDb &&
      (!intent || intent.intent === 'unknown') &&
      looksLikeStoaPropertyQuery(cleanCommand)
    ) {
      console.log('📊 STOA property heuristic (no LLM intent — matched keywords)');
      const lead =
        'Here is what I can pull from STOA right now. For deeper analysis, set LOCAL_LLM_BASE_URL or ALEC_OPENAI_BASE_URL for intent routing.';
      const extra = await fetchStoaPropertyExtra(stoaDb);
      const full = lead + extra;
      if (localDb && localDb.isConnected) {
        await localDb.saveVoiceInteraction({
          command: cleanCommand,
          response: full,
          success: true,
        });
      }
      return { message: full, wake_word_detected: true };
    }

    // device_control, unknown, or LLM off: HA handles natural language + keywords
    const result = normalizeHaVoiceResult(await haIntegration.executeVoiceCommand(cleanCommand));
    const msg =
      intent && intent.intent === 'device_control' && intent.message
        ? `${intent.message} ${result.message || ''}`.trim()
        : result.message || 'Done.';

    if (localDb && localDb.isConnected) {
      await localDb.saveVoiceInteraction({
        command: cleanCommand,
        response: msg,
        success: result.success,
      });
    }

    return { message: msg, wake_word_detected: true };
  } catch (error) {
    console.error('Error:', error);
    return { message: `Error: ${errText(error)}`, wake_word_detected: true };
  }
}

const PORT = process.env.VOICE_PORT || 3002;
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' });

wss.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n❌ Port ${PORT} is already in use (another A.L.E.C. / node process is probably still running).`,
    );
    console.error(`   Free it:  lsof -ti :${PORT} | xargs kill -9`);
    console.error(`   Or use another port:  VOICE_PORT=3003 node index.js\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

wss.on('listening', () => {
  console.log(`🌐 WebSocket server running on ws://localhost:${PORT}\n`);
});

const VOICE_HTTP_PORT = parseInt(process.env.VOICE_HTTP_PORT || '3003', 10);
let httpServer;
const frontendDir = path.join(__dirname, 'frontend');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

httpServer = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    let rel = urlPath === '/' ? '/voice.html' : urlPath;
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const filePath = path.join(frontendDir, safe);
    if (!filePath.startsWith(frontendDir)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        return res.end('Not found');
      }
      let body = data;
      const ext = path.extname(filePath);
      if (ext === '.html') {
        const hostOnly = (req.headers.host || '').split(':')[0] || '127.0.0.1';
        const defaultWs =
          process.env.VOICE_WS_PUBLIC_URL || `ws://${hostOnly}:${PORT}`;
        let html = data
          .toString('utf8')
          .replace(/__VOICE_WS_PORT__/g, String(PORT))
          .replace(/__VOICE_WS_DEFAULT_URL__/g, defaultWs);
        body = Buffer.from(html, 'utf8');
      }
      res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
      res.end(body);
    });
  });

httpServer.listen(VOICE_HTTP_PORT, '0.0.0.0', () => {
  console.log(`📄 Voice UI: http://localhost:${VOICE_HTTP_PORT}/voice.html`);
  console.log(`   (WebSocket on port ${PORT} — same machine: ws://127.0.0.1:${PORT})`);
  console.log(`   Optional: VOICE_WS_PUBLIC_URL=wss://your-host:${PORT} when using HTTPS / reverse proxy\n`);
});

wss.on('connection', (ws) => {
  console.log('🎤 Client connected');

  const haOk = haIntegration?.isConnected === true;
  const llmOk = llmService?.isConnected === true;
  ws.send(
    JSON.stringify({
      type: 'welcome',
      identity: ALEC_IDENTITY.name,
      ha_connected: haOk,
      llm_connected: llmOk,
      message: haOk
        ? `I am ready. STOA online. Home Assistant connected — voice and smart home features are available without the wake phrase.${llmOk ? ' Local LLM intent layer is on.' : ''}`
        : `I am ready. STOA online. Connect Home Assistant to unlock full voice (no wake phrase required).${llmOk ? ' Local LLM intent layer is on.' : ''}`,
    }),
  );

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'voice_command') {
        // Web UI sends explicit commands — do not require wake phrase every time
        const fromUi = msg.from_ui === true || msg.from_ui === 'true';
        const response = await processVoiceCommand(msg.command, {
          requireWakeWord: !fromUi,
        });
        ws.send(
          JSON.stringify({
            ...response,
            timestamp: new Date().toISOString(),
          }),
        );
      } else if (msg.type === 'ping') {
        ws.send(
          JSON.stringify({
            type: 'pong',
            status: servicesReady ? 'ready' : 'init',
            ha_connected: haIntegration?.isConnected === true,
            llm_connected: llmService?.isConnected === true,
          }),
        );
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('close', () => console.log('🎤 Client disconnected'));
});

initializeServices().then(() => {
  console.log('✅ A.L.E.C. is READY!');
});

process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  try {
    httpServer?.close();
  } catch (_) {}
  try {
    llmService?.disconnect();
  } catch (_) {}
  wss.close();
  process.exit(0);
});

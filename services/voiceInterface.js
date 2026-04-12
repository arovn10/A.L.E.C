/**
 * A.L.E.C. Voice Interface — WebSocket server
 *
 * Starts a standalone WS server on VOICE_PORT (default 3002).
 * Handles voice_command messages from the browser UI, routes them
 * through LM Studio, and returns responses with source attribution.
 *
 * Exports STATES + VoiceInterface for both server use and unit tests.
 */

const WebSocket = require('ws');

// ── Voice state constants ────────────────────────────────────────
const STATES = {
  IDLE:         'idle',
  LISTENING:    'listening',
  TRANSCRIBING: 'transcribing',
  THINKING:     'thinking',
  SPEAKING:     'speaking',
  INTERRUPTED:  'interrupted',
  MUTED:        'muted',
  ERROR:        'error',
  OFFLINE:      'offline-fallback',
};

// ── System prompt for LM Studio ─────────────────────────────────
const SYSTEM_PROMPT = `You are A.L.E.C. (Adaptive Learning Executive Companion), Alec Rovner's personal AI assistant.
You help with smart home control, STOA real estate database queries, reminders, grocery lists, and general conversation.

VOICE MODE RULES (important — your responses will be read aloud):
- Answer in 1-2 short sentences. Never use bullet points, markdown, or emojis.
- Do not say things like "Certainly!" or "Of course!" — just answer directly.
- If you need to list things, say them naturally: "You have three items: milk, eggs, and bread."
- If the user asks for something complex, give a brief spoken summary and offer to elaborate.
- Sound like a smart friend, not a search engine.
- Always refer to yourself as "Alec" — never "A.L.E.C." or "ALEC" with dots. Your name is spoken, not spelled.`;

// ── LM Studio client ─────────────────────────────────────────────
const LM_BASE = process.env.OLLAMA_URL || process.env.LM_STUDIO_URL || 'http://127.0.0.1:11434';

async function detectModel() {
  try {
    const resp = await fetch(`${LM_BASE}/v1/models`, { signal: AbortSignal.timeout(4000) });
    const data = await resp.json();
    return data?.data?.[0]?.id || 'local-model';
  } catch {
    return null; // offline
  }
}

/**
 * Call Ollama.
 * voiceMode = true → shorter, snappier replies (max 120 tokens, lower temp)
 * voiceMode = false → richer text replies (max 512 tokens)
 */
async function callLMStudio(messages, voiceMode = false) {
  const resp = await fetch(`${LM_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || 'gemma3:27b-it-qat',
      messages,
      temperature: voiceMode ? 0.5 : 0.7,   // snappier + more focused in voice mode
      max_tokens:  voiceMode ? 120  : 512,   // concise spoken answers vs. rich text
      // top_p and repeat_penalty also help speed when using smaller token budget
      top_p:          voiceMode ? 0.85 : 0.95,
      repeat_penalty: voiceMode ? 1.1  : 1.05,
      stream: false,
    }),
    signal: AbortSignal.timeout(voiceMode ? 30000 : 90000),
  });
  if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || 'I could not generate a response.';
}

// ── Session ──────────────────────────────────────────────────────
class VoiceSession {
  constructor(ws) {
    this.ws    = ws;
    this.state = STATES.IDLE;
    this.history = []; // [{role, content}]
  }

  transition(state) {
    this.state = state;
    this.send({ type: 'state_change', state });
  }

  send(obj) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }
}

// ── Main class ───────────────────────────────────────────────────
class VoiceInterface {
  constructor() {
    this.wss          = null;
    this.sessions     = new Map();   // ws → VoiceSession
    this.isInitialized = false;
    this.ttsAvailable  = false;      // server-side TTS not used (browser handles it)
    this.neuralEngine  = null;
    this.modelName     = 'LM Studio';
    this.haConnected   = false;
  }

  /**
   * Start WS server on VOICE_PORT (default 3002).
   * Called once from server.js after boot.
   */
  initialize(httpServer) {
    const port = parseInt(process.env.VOICE_PORT || '3002', 10);

    // If an existing HTTP server is passed, attach to it; otherwise standalone.
    const wssOpts = httpServer
      ? { server: httpServer }
      : { port };

    this.wss = new WebSocket.Server(wssOpts);

    this.wss.on('connection', (ws) => this._onConnection(ws));

    if (!httpServer) {
      this.wss.on('listening', () =>
        console.log(`🎤 Voice WebSocket server listening on port ${port}`)
      );
    }

    this.wss.on('error', (err) => console.error('Voice WS error:', err.message));

    // Probe LM Studio model name in background
    detectModel().then(model => {
      if (model) this.modelName = model;
    });

    this.isInitialized = true;
    return this;
  }

  setNeuralEngine(engine) {
    this.neuralEngine = engine;
  }

  setHAStatus(connected) {
    this.haConnected = connected;
  }

  // ── Connection lifecycle ──────────────────────────────────────
  _onConnection(ws) {
    const session = new VoiceSession(ws);
    this.sessions.set(ws, session);
    console.log(`🔌 Voice client connected (${this.sessions.size} active)`);

    // Welcome frame
    session.send({
      type:         'welcome',
      identity:     'A.L.E.C.',
      message:      'Voice interface ready. Speak or type to begin.',
      model:        this.modelName,
      ha_connected: this.haConnected,
    });

    ws.on('message', (data) => this._onMessage(session, data));
    ws.on('close',   ()     => {
      this.sessions.delete(ws);
      console.log(`👋 Voice client disconnected (${this.sessions.size} active)`);
    });
    ws.on('error',   (err) => {
      console.error('Voice session error:', err.message);
      this.sessions.delete(ws);
    });
  }

  // ── Message dispatch ─────────────────────────────────────────
  async _onMessage(session, data) {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      session.send({ type: 'error', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'ping':
        session.send({ type: 'pong', timestamp: Date.now(), model: this.modelName, ha_connected: this.haConnected });
        break;

      case 'voice_command':
      case 'text_input': {
        const command = (msg.command || msg.text || '').trim();
        if (!command) break;
        await this._handleCommand(session, command);
        break;
      }

      default:
        // Unknown message types are silently ignored
        break;
    }
  }

  // ── Command handler ──────────────────────────────────────────
  async _handleCommand(session, text) {
    session.transition(STATES.THINKING);

    // Check for trivial deterministic responses first
    const deterministic = this._checkDeterministic(text);
    if (deterministic) {
      session.send({
        type:     'response',
        response: deterministic.text,
        source:   'deterministic',
      });
      session.transition(STATES.SPEAKING);
      setTimeout(() => session.transition(STATES.IDLE), 500);
      return;
    }

    // Add to history
    session.history.push({ role: 'user', content: text });
    if (session.history.length > 20) session.history.splice(0, 2); // rolling window

    try {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...session.history,
      ];

      const reply = await callLMStudio(messages, true /* voiceMode */);
      session.history.push({ role: 'assistant', content: reply });

      session.send({
        type:     'response',
        response: reply,
        source:   'llm',
      });
      session.transition(STATES.SPEAKING);
      setTimeout(() => session.transition(STATES.IDLE), 500);

    } catch (err) {
      console.error('LM Studio error:', err.message);
      const fallback = 'I\'m having trouble reaching my language model right now. Please check that Ollama is running (ollama serve).';
      session.send({
        type:     'response',
        response: fallback,
        source:   'deterministic',
      });
      session.transition(STATES.OFFLINE);
    }
  }

  // ── Deterministic fact lookup ────────────────────────────────
  _checkDeterministic(text) {
    const t = text.toLowerCase().trim();
    if (/^who are you\??$/.test(t) || /^what is your name\??$/.test(t)) {
      return { text: "I'm A.L.E.C. — Adaptive Learning Executive Companion. I'm your personal AI assistant, designed to help with smart home control, STOA data, reminders, and general knowledge." };
    }
    if (/^what time is it\??$/.test(t)) {
      return { text: `The current time is ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` };
    }
    if (/^(what('s| is) (today|the date|today's date))\??$/.test(t)) {
      return { text: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.` };
    }
    return null;
  }

  // ── Broadcast to all sessions ────────────────────────────────
  broadcast(payload) {
    this.sessions.forEach(session => session.send(payload));
  }

  // ── Status ───────────────────────────────────────────────────
  getStatus() {
    return {
      initialized:    this.isInitialized,
      activeSessions: this.sessions.size,
      sessions:       Array.from(this.sessions.values()).map(s => ({ state: s.state })),
      ttsAvailable:   this.ttsAvailable,
      model:          this.modelName,
      haConnected:    this.haConnected,
    };
  }
}

module.exports = { STATES, VoiceInterface };

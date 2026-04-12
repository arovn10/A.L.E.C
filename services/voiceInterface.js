/**
 * A.L.E.C. Voice Interface
 *
 * State machine: idle → listening → transcribing → thinking → speaking → idle
 * Also handles: interrupted, error, muted, offline-fallback
 *
 * Client sends JSON messages; server sends JSON control messages and binary audio chunks.
 * Real STT/TTS requires the system TTS bridge or an external service.
 * When unavailable, falls back gracefully with text-only mode.
 */

const WebSocket = require('ws');
const { EventEmitter } = require('events');

const STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  TRANSCRIBING: 'transcribing',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  INTERRUPTED: 'interrupted',
  MUTED: 'muted',
  ERROR: 'error',
  OFFLINE: 'offline-fallback'
};

class VoiceSession extends EventEmitter {
  constructor(ws, userId) {
    super();
    this.ws = ws;
    this.userId = userId;
    this.state = STATES.IDLE;
    this.audioChunks = [];
    this.currentUtterance = '';
    this.isMuted = false;
    this.connectedAt = Date.now();
  }

  transition(newState, payload = {}) {
    const prev = this.state;
    this.state = newState;
    this.send({ type: 'state_change', state: newState, prev, ...payload });
    this.emit('state', newState, payload);
  }

  send(obj) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendBinary(buffer) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer, { binary: true });
    }
  }

  isActive() {
    return this.ws.readyState === WebSocket.OPEN;
  }
}

class VoiceInterface {
  constructor() {
    this.wss = null;
    this.sessions = new Map(); // ws → VoiceSession
    this.neuralEngine = null; // injected after construction
    this.isInitialized = false;

    // TTS availability — detected at startup
    this.ttsAvailable = false;
  }

  /** Called by server.js after neural engine is ready */
  setNeuralEngine(engine) {
    this.neuralEngine = engine;
  }

  /**
   * Attach to an existing HTTP server so voice WebSocket shares port with Express.
   * Returns the WebSocket.Server instance (or null on error).
   */
  initialize(httpServer = null) {
    try {
      const opts = httpServer
        ? { server: httpServer, path: '/voice' }
        : { port: parseInt(process.env.VOICE_PORT || 3002, 10), path: '/voice' };

      this.wss = new WebSocket.Server(opts);

      this.wss.on('connection', (ws, req) => {
        const userId = req.headers['x-user-id'] || `voice_${Date.now()}`;
        const session = new VoiceSession(ws, userId);
        this.sessions.set(ws, session);

        console.log(`🎤 Voice session opened for ${userId}`);

        session.send({
          type: 'welcome',
          userId,
          states: Object.values(STATES),
          ttsAvailable: this.ttsAvailable,
          message: 'A.L.E.C. voice interface ready.'
        });

        ws.on('message', (data, isBinary) => {
          if (isBinary) {
            this._handleAudioChunk(session, data);
          } else {
            try {
              this._handleControlMessage(session, JSON.parse(data.toString()));
            } catch {
              session.transition(STATES.ERROR, { message: 'Invalid message format' });
            }
          }
        });

        ws.on('close', () => {
          console.log(`👋 Voice session closed for ${userId}`);
          this.sessions.delete(ws);
        });

        ws.on('error', (err) => {
          console.error(`Voice WS error for ${userId}:`, err.message);
          this.sessions.delete(ws);
        });
      });

      this.isInitialized = true;
      console.log('🎙️ Voice WebSocket server initialized');
      return this.wss;
    } catch (err) {
      console.error('Voice init failed:', err.message);
      return null;
    }
  }

  _handleControlMessage(session, msg) {
    switch (msg.type) {
      case 'start_listening':
        if (session.isMuted) {
          session.send({ type: 'error', message: 'Microphone is muted' });
          return;
        }
        session.audioChunks = [];
        session.currentUtterance = '';
        session.transition(STATES.LISTENING);
        break;

      case 'stop_listening':
        if (session.state === STATES.LISTENING) {
          session.transition(STATES.TRANSCRIBING);
          this._transcribeAndProcess(session);
        }
        break;

      case 'mute':
        session.isMuted = true;
        session.transition(STATES.MUTED);
        break;

      case 'unmute':
        session.isMuted = false;
        session.transition(STATES.IDLE);
        break;

      case 'interrupt':
        if (session.state === STATES.SPEAKING) {
          session.transition(STATES.INTERRUPTED);
          // Allow immediate new input after short pause
          setTimeout(() => {
            if (session.state === STATES.INTERRUPTED) {
              session.transition(STATES.IDLE);
            }
          }, 300);
        }
        break;

      case 'text_input':
        // Text fallback — same pipeline as voice without audio
        if (msg.text && msg.text.trim()) {
          session.currentUtterance = msg.text.trim();
          session.transition(STATES.THINKING);
          this._processUtterance(session, session.currentUtterance);
        }
        break;

      case 'ping':
        session.send({ type: 'pong', timestamp: Date.now() });
        break;

      default:
        session.send({ type: 'unknown_message', received: msg.type });
    }
  }

  _handleAudioChunk(session, data) {
    if (session.state !== STATES.LISTENING) return;
    session.audioChunks.push(data);

    // Barge-in detection: if A.L.E.C. is speaking and audio arrives, interrupt
    if (session.state === STATES.SPEAKING) {
      session.transition(STATES.INTERRUPTED);
    }
  }

  async _transcribeAndProcess(session) {
    // In production: pipe session.audioChunks to Whisper / Vosk / WebSpeech API
    // For now: if the client sends text via Whisper on their end and forwards it,
    // we decode it. Otherwise we return a transcription placeholder.
    const transcript = session.currentUtterance || '[audio received — STT engine not configured]';
    session.send({ type: 'transcript', text: transcript, confidence: 0.9 });
    session.transition(STATES.THINKING);
    await this._processUtterance(session, transcript);
  }

  async _processUtterance(session, text) {
    if (!this.neuralEngine) {
      session.transition(STATES.ERROR, { message: 'Neural engine not available' });
      return;
    }

    try {
      const result = await this.neuralEngine.processQuery({
        query: text,
        context: { userId: session.userId },
        personality: 'companion',
        sassLevel: 0.7,
        initiativeMode: true
      });

      session.send({
        type: 'response',
        text: result.text,
        source: result.source || 'lm-studio',
        confidence: result.confidence,
        suggestions: result.suggestions || []
      });

      session.transition(STATES.SPEAKING);
      await this._speakText(session, result.text);
      session.transition(STATES.IDLE);
    } catch (err) {
      console.error('Voice processing error:', err.message);
      session.transition(STATES.ERROR, { message: err.message });
      setTimeout(() => session.transition(STATES.IDLE), 2000);
    }
  }

  async _speakText(session, text) {
    // Production: call system TTS (macOS say, Coqui, Polly) and stream audio chunks
    // The client can use Web Speech API as the primary TTS with this as a fallback signal
    session.send({ type: 'tts_start', text, length: text.length });

    if (this.ttsAvailable) {
      // Future: stream PCM audio chunks via sendBinary
    }

    // Simulate speaking duration so UI can animate correctly
    const speakMs = Math.min(8000, text.length * 55); // ~55ms per char estimate
    await new Promise(r => setTimeout(r, Math.min(speakMs, 500))); // cap wait in server

    session.send({ type: 'tts_end' });
  }

  /**
   * Broadcast a message to all active voice sessions (e.g., alert from smart home)
   */
  broadcast(payload) {
    for (const session of this.sessions.values()) {
      if (session.isActive()) session.send(payload);
    }
  }

  getStatus() {
    const sessionList = [];
    for (const session of this.sessions.values()) {
      sessionList.push({
        userId: session.userId,
        state: session.state,
        connectedAt: session.connectedAt
      });
    }
    return {
      initialized: this.isInitialized,
      activeSessions: sessionList.length,
      sessions: sessionList,
      ttsAvailable: this.ttsAvailable
    };
  }
}

module.exports = { VoiceInterface, STATES };

/**
 * A.L.E.C. Knowledge Service
 *
 * Truth-source priority chain (highest → lowest confidence):
 *   1. Deterministic facts (hardcoded system knowledge)
 *   2. Stoa Azure SQL database (structured business data)
 *   3. Local SQLite memory (personal A.L.E.C. context)
 *   4. Home Assistant state (real-time device/sensor data)
 *   5. LLM inference (last resort — always flagged as such)
 *
 * Every response includes a `source` field so callers can display
 * provenance and the UI can warn when output is LLM-inferred.
 */

const TRUTH_SOURCES = {
  DETERMINISTIC: 'deterministic',
  STOA_DB: 'stoa-db',
  LOCAL_MEMORY: 'local-memory',
  HOME_ASSISTANT: 'home-assistant',
  LLM_INFERENCE: 'llm-inference',
  REFUSAL: 'refusal'
};

// Topics we never answer with LLM inference — must come from authoritative source
const REFUSAL_PATTERNS = [
  /account\s+balance/i,
  /bank\s+account/i,
  /social\s+security/i,
  /credit\s+card\s+number/i,
  /password/i,
  /medical\s+(record|diagnosis|prescription)/i
];

// Deterministic facts A.L.E.C. always knows without DB or LLM
const DETERMINISTIC_FACTS = {
  'who are you': {
    text: "I'm A.L.E.C. — Adaptive Learning Executive Coordinator. I'm Alec Rovner's personal AI companion running locally on a 35B parameter model.",
    source: TRUTH_SOURCES.DETERMINISTIC,
    confidence: 1.0
  },
  'what time is it': () => ({
    text: `The current time is ${new Date().toLocaleTimeString()}.`,
    source: TRUTH_SOURCES.DETERMINISTIC,
    confidence: 1.0
  }),
  "what's today's date": () => ({
    text: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
    source: TRUTH_SOURCES.DETERMINISTIC,
    confidence: 1.0
  }),
  'what is today': () => ({
    text: `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`,
    source: TRUTH_SOURCES.DETERMINISTIC,
    confidence: 1.0
  })
};

class KnowledgeService {
  constructor({ neuralEngine = null, smartHomeConnector = null } = {}) {
    this.neuralEngine = neuralEngine;
    this.smartHomeConnector = smartHomeConnector;
    this.queryLog = [];
  }

  /**
   * Route a query through the priority chain and return a response
   * with source metadata attached.
   *
   * @param {string} query - Raw user query
   * @param {object} context - { userId, history, sessionId }
   * @returns {Promise<{text, source, confidence, refusedReason?}>}
   */
  async resolve(query, context = {}) {
    const normalised = query.trim().toLowerCase().replace(/[?!.]+$/, '');

    // 0. Refusal gate — never answer with LLM for sensitive topics
    for (const pattern of REFUSAL_PATTERNS) {
      if (pattern.test(query)) {
        return this._log({
          text: "I don't surface sensitive personal data like passwords, account numbers, or medical records through chat. Check your secure vault directly.",
          source: TRUTH_SOURCES.REFUSAL,
          confidence: 1.0,
          refusedReason: pattern.toString()
        }, query);
      }
    }

    // 1. Deterministic facts
    for (const [key, value] of Object.entries(DETERMINISTIC_FACTS)) {
      if (normalised.includes(key)) {
        const result = typeof value === 'function' ? value() : value;
        return this._log(result, query);
      }
    }

    // 2. Home Assistant — real-time device/sensor state
    if (this.smartHomeConnector) {
      const haResult = await this._queryHomeAssistant(query);
      if (haResult) return this._log(haResult, query);
    }

    // 3. LLM inference (with explicit source flag)
    if (this.neuralEngine) {
      const llmResult = await this.neuralEngine.processQuery({
        query,
        context,
        personality: 'companion',
        sassLevel: 0.7,
        initiativeMode: true
      });

      return this._log({
        ...llmResult,
        source: TRUTH_SOURCES.LLM_INFERENCE,
        // Downgrade confidence slightly to reflect LLM uncertainty
        confidence: Math.min(0.85, (llmResult.confidence || 0.75) * 0.95)
      }, query);
    }

    // Fallback: no engine available
    return this._log({
      text: 'My reasoning engine is offline. Start LM Studio with a model loaded and restart A.L.E.C.',
      source: TRUTH_SOURCES.REFUSAL,
      confidence: 0
    }, query);
  }

  async _queryHomeAssistant(query) {
    if (!this.smartHomeConnector?.connected) return null;

    const lower = query.toLowerCase();
    const isDeviceQuery = /light|thermostat|temperature|lock|door|sensor|device|home/.test(lower);
    if (!isDeviceQuery) return null;

    try {
      const status = this.smartHomeConnector.getStatus();
      if (!status.connected || status.deviceCount === 0) return null;

      const deviceSummary = status.devices
        .map(d => `${d.name}: ${d.state || 'unknown'}`)
        .join(', ');

      return {
        text: `Current home status — ${deviceSummary}`,
        source: TRUTH_SOURCES.HOME_ASSISTANT,
        confidence: 0.98,
        devices: status.devices
      };
    } catch {
      return null;
    }
  }

  _log(result, query) {
    this.queryLog.push({
      timestamp: Date.now(),
      query: query.slice(0, 200),
      source: result.source,
      confidence: result.confidence
    });
    if (this.queryLog.length > 500) this.queryLog.shift();
    return result;
  }

  getStats() {
    const bySource = {};
    for (const entry of this.queryLog) {
      bySource[entry.source] = (bySource[entry.source] || 0) + 1;
    }
    return {
      totalQueries: this.queryLog.length,
      bySource,
      truthSources: Object.values(TRUTH_SOURCES)
    };
  }
}

module.exports = { KnowledgeService, TRUTH_SOURCES };

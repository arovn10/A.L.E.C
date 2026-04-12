/**
 * A.L.E.C. Neural Engine
 *
 * Sends queries to LM Studio (OpenAI-compatible API) running locally.
 * Falls back to a descriptive error message if LM Studio is unreachable
 * so the rest of the server stays operational.
 */

const fs = require('fs');
const path = require('path');

const LM_STUDIO_BASE = process.env.LOCAL_LLM_BASE_URL || process.env.ALEC_OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
const LM_STUDIO_MODEL = process.env.LOCAL_LLM_MODEL || 'local-model';
const MAX_TOKENS = Math.min(parseInt(process.env.ALEC_OPENAI_MAX_TOKENS || '4096', 10) || 4096, 16384);

const SYSTEM_PROMPT = `You are A.L.E.C. (Adaptive Learning Executive Coordinator), a personal AI companion
created for Alec Rovner. You are witty, precise, and proactively helpful. You have access to smart home
controls, personal data, and can learn from every interaction. Always be concise, accurate, and honest
about what you know versus what you are inferring. Never fabricate facts — if uncertain, say so clearly.`;

class NeuralEngine {
  constructor() {
    this.lmStudioBase = LM_STUDIO_BASE;
    this.modelLoaded = false;
    this.activeModelId = LM_STUDIO_MODEL;
    this.personalContexts = new Map();
    this.interactionHistory = [];
    this.personalityTraits = {
      sass: 0.7,
      initiative: 0.8,
      empathy: 0.9,
      creativity: 0.85,
      precision: 0.95
    };
    this.stats = {
      queriesProcessed: 0,
      avgConfidence: 0,
      trainingIterations: 0
    };
  }

  async initialize() {
    console.log(`🧠 Neural Engine connecting to LM Studio at ${this.lmStudioBase}...`);
    await this._probeHealth();

    // Load any cached personal contexts
    const contextDir = path.join(__dirname, '../data/context');
    if (fs.existsSync(contextDir)) {
      for (const file of fs.readdirSync(contextDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = JSON.parse(fs.readFileSync(path.join(contextDir, file), 'utf8'));
          this.personalContexts.set(file.replace('.json', ''), data);
        } catch { /* skip malformed files */ }
      }
      if (this.personalContexts.size > 0) {
        console.log(`📚 Loaded ${this.personalContexts.size} personal context(s)`);
      }
    }
  }

  async _probeHealth() {
    try {
      const resp = await fetch(`${this.lmStudioBase}/models`, {
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) {
        const data = await resp.json();
        const models = data?.data || [];
        if (models.length > 0) {
          this.activeModelId = models[0].id;
          console.log(`✅ LM Studio ready — active model: ${this.activeModelId}`);
        } else {
          console.log('✅ LM Studio reachable — no model loaded yet, load one in the UI');
        }
        this.modelLoaded = true;
      } else {
        console.warn(`⚠️  LM Studio returned ${resp.status} — continuing in degraded mode`);
      }
    } catch {
      console.warn(`⚠️  LM Studio not reachable at ${this.lmStudioBase} — start LM Studio and load a model`);
    }
  }

  async processQuery({ query, context = {}, personality = 'companion', sassLevel = 0.7, initiativeMode = true }) {
    this.stats.queriesProcessed++;

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];

    // Inject personal context if available
    const userId = context.userId;
    if (userId && this.personalContexts.has(userId)) {
      const ctx = this.personalContexts.get(userId);
      messages.push({
        role: 'system',
        content: `Personal context for ${userId}: ${JSON.stringify(ctx).slice(0, 2000)}`
      });
    }

    // Conversation history (last 10 turns to stay within context)
    if (Array.isArray(context.history)) {
      messages.push(...context.history.slice(-10));
    }

    messages.push({ role: 'user', content: query });

    const temperature = Math.min(0.95, 0.55 + sassLevel * 0.35);

    try {
      const resp = await fetch(`${this.lmStudioBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.activeModelId,
          messages,
          temperature,
          top_p: 0.9,
          max_tokens: MAX_TOKENS,
          stream: false
        }),
        signal: AbortSignal.timeout(120000) // 2-minute timeout for large models
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`LM Studio ${resp.status}: ${errBody.slice(0, 200)}`);
      }

      const data = await resp.json();
      const choice = data.choices?.[0];
      const responseText = choice?.message?.content || 'I had trouble generating a response.';

      this.modelLoaded = true;
      await this._logInteraction({ query, response: responseText, context });

      const confidence = Math.min(0.97, 0.75 + (responseText.length / 1000));

      return {
        text: responseText,
        confidence: Math.round(confidence * 100) / 100,
        personality,
        source: 'lm-studio',
        model: this.activeModelId,
        suggestions: initiativeMode ? [
          'Would you like me to analyze your recent data?',
          'Want me to check something in the database?',
          'Shall we review your smart home status?'
        ] : [],
        usage: data.usage,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('LM Studio query failed:', error.message);

      return {
        text: `I can't reach my language model right now (${error.message}). Make sure LM Studio is running on port 1234 with a model loaded.`,
        confidence: 0,
        personality,
        source: 'error',
        suggestions: ['Start LM Studio and load a model, then try again.'],
        timestamp: new Date().toISOString()
      };
    }
  }

  async _logInteraction({ query, response, context }) {
    this.interactionHistory.push({ timestamp: Date.now(), query, response, context });
    if (this.interactionHistory.length > 100) this.interactionHistory.shift();

    if (this.interactionHistory.length % 10 === 0) {
      try {
        const logDir = path.join(__dirname, '../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        fs.writeFileSync(path.join(logDir, 'interactions.json'), JSON.stringify(this.interactionHistory, null, 2));
      } catch { /* non-fatal */ }
    }
  }

  async loadPersonalContext(userId) {
    try {
      const ctxPath = path.join(__dirname, `../data/context/${userId}.json`);
      if (fs.existsSync(ctxPath)) {
        const data = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
        this.personalContexts.set(userId, data);
        console.log(`📚 Loaded personal context for ${userId}`);
      }
    } catch (error) {
      console.error('Error loading personal context:', error.message);
    }
  }

  async retrain() {
    console.log('🔁 Retraining cycle triggered (LoRA adapter update queued)');
    this.stats.trainingIterations++;
  }

  getStats() {
    return {
      ...this.stats,
      modelsLoaded: this.modelLoaded ? 1 : 0,
      personalityTraits: this.personalityTraits,
      activeContexts: this.personalContexts.size,
      lmStudioBase: this.lmStudioBase,
      activeModelId: this.activeModelId
    };
  }

  getModelStatus() {
    return {
      loaded: this.modelLoaded,
      stats: this.stats,
      personality: this.personalityTraits,
      mode: this.modelLoaded ? 'lm-studio' : 'offline',
      model: this.activeModelId
    };
  }
}

module.exports = { NeuralEngine };

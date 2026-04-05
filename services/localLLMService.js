/**
 * OpenAI-compatible local LLM (LM Studio, Ollama OpenAI shim, etc.)
 * Set LOCAL_LLM_BASE_URL e.g. http://127.0.0.1:1234/v1
 * Set LOCAL_LLM_MODEL — required when the server has multiple models (LM Studio).
 */
const axios = require('axios');

/** Default when env omits model (LM Studio multi-model requires an explicit id). */
const DEFAULT_LLM_MODEL = 'nvidia/nemotron-3-nano-4b';

class LocalLLMService {
  constructor() {
    const raw = (
      process.env.LOCAL_LLM_BASE_URL ||
      process.env.ALEC_OPENAI_BASE_URL ||
      ''
    )
      .trim()
      .replace(/\/$/, '');
    this.baseUrl = raw;
    this.model = (process.env.LOCAL_LLM_MODEL || '').trim() || DEFAULT_LLM_MODEL;
    this.isConnected = false;
  }

  apiRoot() {
    if (!this.baseUrl) return '';
    return this.baseUrl.endsWith('/v1') ? this.baseUrl : `${this.baseUrl}/v1`;
  }

  /** Resolve model id from GET /v1/models when possible (LM Studio returns OpenAI-style list). */
  async _resolveModelId(root) {
    const want = this.model;
    try {
      const { data } = await axios.get(`${root}/models`, { timeout: 8000 });
      const list = data?.data || data?.models || [];
      const ids = list.map((m) => m.id || m.name || m.model).filter(Boolean);
      if (ids.length === 0) return want;
      const exact = ids.find((id) => id === want);
      if (exact) return exact;
      const partial = ids.find((id) => id.includes(want.split('/').pop() || want));
      if (partial) {
        console.log(`ℹ️  LOCAL_LLM_MODEL "${want}" → using server id "${partial}"`);
        return partial;
      }
      console.log(`ℹ️  Using first available model: ${ids[0]}`);
      return ids[0];
    } catch (_) {
      return want;
    }
  }

  async connect() {
    if (!this.baseUrl) {
      console.log(
        'ℹ️  LOCAL_LLM_BASE_URL / ALEC_OPENAI_BASE_URL not set — LLM intent routing disabled.',
      );
      return false;
    }
    const root = this.apiRoot();
    try {
      this.model = await this._resolveModelId(root);
      await axios.post(
        `${root}/chat/completions`,
        {
          model: this.model,
          messages: [{ role: 'user', content: 'ok' }],
          max_tokens: 4,
          temperature: 0,
        },
        { timeout: 60000 },
      );
      this.isConnected = true;
      console.log(`✅ Local LLM ready at ${root} (model: ${this.model})`);
      return true;
    } catch (e) {
      console.warn('⚠️  Local LLM not reachable:', e.response?.data?.error?.message || e.message);
      console.warn(
        `   Set LOCAL_LLM_BASE_URL and LOCAL_LLM_MODEL (e.g. ${DEFAULT_LLM_MODEL}). Ensure LM Studio is running and the model is loaded.`,
      );
      this.isConnected = false;
      return false;
    }
  }

  /**
   * @param {Array<{role:string, content:string}>} messages
   * @param {{ temperature?: number, max_tokens?: number }} opts
   */
  async chat(messages, opts = {}) {
    const root = this.apiRoot();
    const body = {
      model: this.model,
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.max_tokens ?? 400,
      stream: false,
    };

    const res = await axios.post(`${root}/chat/completions`, body, { timeout: 180000 });
    const content = res.data?.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }

  getStats() {
    return { model: this.model || '(server default)' };
  }

  disconnect() {
    this.isConnected = false;
  }
}

module.exports = { LocalLLMService };

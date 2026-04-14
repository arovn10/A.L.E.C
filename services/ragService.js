'use strict';

const axios = require('axios');
const WeaviateService = require('./weaviateService');

const EMBED_URL = process.env.NEURAL_URL || 'http://localhost:8000';
const DEFAULT_LIMIT = 5;
const MAX_SNIPPET = 500;

class RagService {
  /**
   * @param {WeaviateService} [weaviateService] - inject in tests; creates default instance in prod
   */
  constructor(weaviateService) {
    this._weaviate = weaviateService || new WeaviateService();
  }

  /**
   * Call the neural engine /embed endpoint to get a nomic-embed-text vector.
   * @param {string} text
   * @returns {Promise<number[]>} 768-dim float array
   */
  async embed(text) {
    const res = await axios.post(`${EMBED_URL}/embed`, { text }, { timeout: 10000 });
    return res.data.vector;
  }

  /**
   * Main retrieval method. Embeds the query, searches Weaviate collections,
   * merges results by distance, and returns a formatted context string.
   *
   * Falls back to keyword-only search (empty vector) if the embed endpoint
   * is unavailable — so RAG degrades gracefully without crashing chat.
   *
   * @param {string} query - the user's current message
   * @param {{ limit?: number, collections?: string[] }} [opts]
   * @returns {Promise<string>} formatted context block, or '' if no hits
   */
  async retrieve(query, opts = {}) {
    const limit = opts.limit || DEFAULT_LIMIT;
    const collections = opts.collections || ['ALECConversation', 'ALECDocument'];

    let vector = [];
    try {
      vector = await this.embed(query);
    } catch (err) {
      console.warn('[ragService] embed unavailable, keyword-only fallback:', err.message);
    }

    const hits = [];
    for (const col of collections) {
      const results = await this._weaviate.hybridSearch(col, query, vector, { limit });
      for (const r of results) hits.push({ ...r, _collection: col });
    }

    // Lower distance = more similar — surface the best matches first
    hits.sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1));
    return this._formatContext(hits.slice(0, limit));
  }

  /**
   * Convert raw Weaviate hits into a context block for injection into the system prompt.
   * @param {Array<object>} hits
   * @returns {string}
   */
  _formatContext(hits) {
    if (!hits.length) return '';
    const lines = hits.map(h => {
      let snippet;
      if (h._collection === 'ALECConversation') {
        snippet = `User: ${(h.userMsg || '').slice(0, MAX_SNIPPET)}\nALEC: ${(h.alecResponse || '').slice(0, MAX_SNIPPET)}`;
      } else {
        snippet = (h.content || '').slice(0, MAX_SNIPPET);
      }
      return `[${h._collection}]\n${snippet}`;
    });
    return `## Relevant Context\n\n${lines.join('\n\n---\n\n')}`;
  }
}

module.exports = RagService;

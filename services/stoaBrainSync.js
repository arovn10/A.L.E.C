'use strict';

const crypto = require('crypto');
const axios = require('axios');
const cron = require('node-cron');
const { registry } = require('../dataConnectors');
const WeaviateService = require('./weaviateService');

const EMBED_URL = process.env.NEURAL_URL || 'http://localhost:8000';
const CHUNK_SIZE = 1000;  // characters per chunk
const OVERLAP = 100;      // overlap between adjacent chunks

class StoaBrainSync {
  /**
   * @param {WeaviateService} [weaviateService] - inject in tests; creates default instance in prod
   */
  constructor(weaviateService) {
    this._weaviate = weaviateService || new WeaviateService();
    this._task = null;
  }

  /**
   * Verify GitHub webhook HMAC-SHA256 signature.
   * Uses timingSafeEqual to prevent timing attacks.
   *
   * @param {Buffer} rawBody - raw request body bytes
   * @param {string} signatureHeader - value of X-Hub-Signature-256 header
   * @returns {boolean}
   */
  verifyWebhookSignature(rawBody, signatureHeader) {
    const secret = process.env.GITHUB_WEBHOOK_SECRET || '';
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signatureHeader);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length) return false;
    try {
      return crypto.timingSafeEqual(sigBuf, expBuf);
    } catch {
      return false;
    }
  }

  /**
   * Process a GitHub push event. Indexes all added + modified files.
   * Errors on individual files are captured and don't abort the batch.
   *
   * @param {{ commits: Array<{added: string[], modified: string[]}> }} payload
   * @returns {Promise<{indexed: number, skipped: number, errors: Array}>}
   */
  async handlePushEvent(payload) {
    const changed = [...new Set([
      ...payload.commits.flatMap(c => c.added || []),
      ...payload.commits.flatMap(c => c.modified || []),
    ])];
    const results = { indexed: 0, skipped: 0, errors: [] };
    for (const filePath of changed) {
      try {
        await this._indexFile(filePath);
        results.indexed++;
      } catch (err) {
        results.errors.push({ filePath, error: err.message });
        results.skipped++;
      }
    }
    return results;
  }

  /**
   * Full sync — list every file in stoagroupDB and index it.
   * Used as the 30-minute cron fallback for missed webhook events.
   *
   * @returns {Promise<{indexed: number, skipped: number, errors: Array}>}
   */
  async fullSync() {
    let fileList;
    try {
      const filesResult = await registry.fetch('github', { action: 'listFiles' });
      fileList = filesResult.data || filesResult || [];
    } catch (err) {
      console.error('[stoaBrainSync] fullSync: listFiles failed:', err.message);
      return { indexed: 0, skipped: 0, errors: [{ path: 'listFiles', error: err.message }] };
    }
    const results = { indexed: 0, skipped: 0, errors: [] };
    for (const file of fileList) {
      const filePath = file.path || file;
      try {
        await this._indexFile(filePath);
        results.indexed++;
      } catch (err) {
        results.errors.push({ path: filePath, error: err.message });
        results.skipped++;
      }
    }
    return results;
  }

  /**
   * Fetch one file from the GitHub connector, chunk it, embed each chunk,
   * and upsert every chunk into Weaviate ALECDocument.
   *
   * @param {string} filePath - path within stoagroupDB repo (e.g. 'README.md')
   */
  async _indexFile(filePath) {
    const result = await registry.fetch('github', { action: 'getFile', path: filePath });
    const text = result.data || '';
    const chunks = this._chunk(text);
    for (let i = 0; i < chunks.length; i++) {
      const vector = await this._embed(chunks[i]);
      await this._weaviate.upsert('ALECDocument', {
        docUuid: `github::${filePath}::${i}`,
        chunkIndex: i,
        content: chunks[i],
        sourceType: 'github',
        sourceUrl: `https://github.com/Stoa-Group/stoagroupDB/blob/main/${filePath}`,
        tags: ['stoa', 'github'],
        indexedAt: new Date().toISOString(),
      }, vector);
    }
  }

  /**
   * Split text into overlapping fixed-size windows.
   * Overlap ensures entities spanning a chunk boundary aren't lost.
   *
   * @param {string} text
   * @returns {string[]}
   */
  _chunk(text) {
    if (!text) return [''];
    const chunks = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + CHUNK_SIZE));
      if (start + CHUNK_SIZE >= text.length) break;
      start += CHUNK_SIZE - OVERLAP;
    }
    return chunks;
  }

  async _embed(text) {
    const res = await axios.post(`${EMBED_URL}/embed`, { text }, { timeout: 15000 });
    return res.data.vector;
  }

  /**
   * Start a node-cron task that calls fullSync() every 30 minutes.
   * Fallback for push events that fail to reach the webhook.
   */
  startCron() {
    this._task = cron.schedule('*/30 * * * *', () => {
      this.fullSync().catch(err =>
        console.error('[stoaBrainSync] cron fullSync error:', err.message),
      );
    });
  }

  /**
   * Stop and destroy the cron task.
   */
  stopCron() {
    if (this._task) {
      this._task.destroy();
      this._task = null;
    }
  }
}

module.exports = StoaBrainSync;

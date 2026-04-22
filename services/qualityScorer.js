'use strict';

const path     = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.ALEC_LOCAL_DB_PATH ||
  path.join(__dirname, '../data/alec.db');

// Source prefixes that satisfy factual_accuracy + source_citation
const SOURCE_PREFIX_RE = /\b(From Azure SQL:|From TenantCloud:|From Weaviate:|From GitHub:|From Home Assistant:)/i;

// Unsourced numbers — dollar amounts, percentages, occupancy figures
const RAW_FIGURE_RE   = /\$[\d,]+|\b\d{1,3}(?:\.\d+)?%/;

const WEIGHT = {
  factual_accuracy:    0.35,
  source_citation:     0.25,
  task_completion:     0.20,
  anti_hallucination:  0.15,  // (1 - hallucination_flag)
  response_concision:  0.05,
};

/**
 * QualityScorer — deterministic quality gate for ALEC responses.
 *
 * @param {string} [dbPath] — inject for tests (use ':memory:' or a temp path)
 */
class QualityScorer {
  constructor(dbPath) {
    this._dbPath = dbPath || DB_PATH;
  }

  /**
   * Compute all five scoring dimensions for a single response.
   * Pure function — no side effects, no DB access.
   *
   * @param {{ turnId: string, sessionId?: string, userMsg: string, alecResponse: string }} data
   * @returns {{ factual_accuracy, source_citation, task_completion, hallucination_flag,
   *             response_concision, quality_score, band }}
   */
  scoreResponse(data) {
    const { alecResponse = '' } = data;
    const hasSource = SOURCE_PREFIX_RE.test(alecResponse);

    // 1. source_citation — binary: does the text open with a recognized data prefix?
    const source_citation = hasSource ? 1.0 : 0.0;

    // 2. factual_accuracy — 1.0 if sourced, 0.5 if conversational (no raw figures), 0.0 if unsourced number
    let factual_accuracy;
    if (hasSource) {
      factual_accuracy = 1.0;
    } else if (RAW_FIGURE_RE.test(alecResponse)) {
      factual_accuracy = 0.0;
    } else {
      factual_accuracy = 0.5;  // conversational, no figures
    }

    // 3. task_completion — heuristic: length > 20 chars AND doesn't start with refusal phrase
    const REFUSAL_RE = /^(I can'?t|I'?m unable|I cannot|I don'?t know)/i;
    const task_completion = (alecResponse.length > 20 && !REFUSAL_RE.test(alecResponse.trim()))
      ? 1.0
      : 0.0;

    // 4. hallucination_flag — 1 if raw financial figure or occupancy % appears WITHOUT a source prefix
    let hallucination_flag = 0;
    if (!hasSource && RAW_FIGURE_RE.test(alecResponse)) {
      hallucination_flag = 1;
    }

    // 5. response_concision — tiered by character length
    const len = alecResponse.length;
    let response_concision;
    if (len <= 2000)       response_concision = 1.0;
    else if (len <= 5000)  response_concision = 0.7;
    else                   response_concision = 0.4;

    // Composite weighted score
    const quality_score = (
      factual_accuracy   * WEIGHT.factual_accuracy  +
      source_citation    * WEIGHT.source_citation    +
      task_completion    * WEIGHT.task_completion    +
      (1 - hallucination_flag) * WEIGHT.anti_hallucination +
      response_concision * WEIGHT.response_concision
    );

    // Band routing
    let band;
    if (quality_score >= 0.75)       band = 'promote';
    else if (quality_score >= 0.40)  band = 'review';
    else                              band = 'reject';

    return {
      factual_accuracy,
      source_citation,
      task_completion,
      hallucination_flag,
      response_concision,
      quality_score: Math.round(quality_score * 10000) / 10000,
      band,
    };
  }

  /**
   * Score a response, persist to SQLite, and route to the correct queue band.
   * Never throws — failures are logged and swallowed so chat is never blocked.
   *
   * @param {{ turnId: string, sessionId?: string, userMsg: string, alecResponse: string }} data
   * @returns {object} scoring result
   */
  score(data) {
    const { turnId, sessionId = null, userMsg = '', alecResponse = '' } = data;
    const dims = this.scoreResponse(data);

    let db;
    try {
      db = new Database(this._dbPath);

      // Always write to quality_scores
      db.prepare(`
        INSERT OR REPLACE INTO quality_scores
          (turn_id, session_id, total_score, factual_score, citation_score,
           completion_score, hallucination_score, concision_score, band)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        turnId,
        sessionId,
        dims.quality_score,
        dims.factual_accuracy,
        dims.source_citation,
        dims.task_completion,
        dims.hallucination_flag,
        dims.response_concision,
        dims.band,
      );

      // Route to review_queue based on band
      if (dims.band === 'promote') {
        db.prepare(`
          INSERT OR REPLACE INTO review_queue
            (turn_id, session_id, user_msg, alec_response, quality_score, status)
          VALUES (?, ?, ?, ?, ?, 'approved')
        `).run(turnId, sessionId, userMsg, alecResponse, dims.quality_score);
      } else if (dims.band === 'review') {
        db.prepare(`
          INSERT OR REPLACE INTO review_queue
            (turn_id, session_id, user_msg, alec_response, quality_score, status)
          VALUES (?, ?, ?, ?, ?, 'pending')
        `).run(turnId, sessionId, userMsg, alecResponse, dims.quality_score);
      }
      // band === 'reject': write quality_scores only (no review_queue insert)

    } catch (err) {
      console.error('[qualityScorer] DB write failed (non-critical):', err.message);
    } finally {
      try { db && db.close(); } catch (_) {}
    }

    return dims;
  }
}

module.exports = QualityScorer;

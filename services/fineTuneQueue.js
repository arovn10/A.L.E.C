'use strict';

const path  = require('path');
const fs    = require('fs');
const axios = require('axios');
const Database = require('better-sqlite3');

const DB_PATH       = process.env.ALEC_LOCAL_DB_PATH || path.join(__dirname, '../data/alec.db');
const NEURAL_URL    = process.env.NEURAL_URL || 'http://localhost:8000';
const SFT_DIR       = path.join(__dirname, '../data/sft');
const CONSTITUTION  = path.join(__dirname, '../data/ALEC_CONSTITUTION.md');
const DEFAULT_THRESHOLD = 500;

function openDb() { return new Database(DB_PATH); }

/**
 * FineTuneQueue — pulls approved examples, formats JSONL, triggers DGX training.
 *
 * Hard rules enforced:
 *   H4: fine-tune jobs are NEVER auto-promoted. model_versions rows land with is_active=0.
 *   H6: examples with quality_score < 0.40 are skipped before JSONL write.
 *
 * @param {{ threshold?: number, neuralUrl?: string, dbPath?: string }} [opts]
 */
class FineTuneQueue {
  constructor(opts = {}) {
    this._threshold  = opts.threshold  ?? DEFAULT_THRESHOLD;
    this._neuralUrl  = opts.neuralUrl  ?? NEURAL_URL;
    this._dbPath     = opts.dbPath     ?? DB_PATH;
  }

  /** Count how many rows in review_queue have status='approved'. */
  getApprovedCount() {
    let db;
    try {
      db = openDb();
      const row = db.prepare(
        `SELECT COUNT(*) AS count FROM review_queue WHERE status = 'approved'`
      ).get();
      return row?.count ?? 0;
    } finally {
      try { db && db.close(); } catch (_) {}
    }
  }

  /**
   * Pull approved rows, apply H6 filter, write JSONL, return { batchFile, exampleCount }.
   * Reads ALEC_CONSTITUTION.md as the system message content.
   */
  async buildBatch() {
    let db;
    let rows;
    try {
      db = openDb();
      rows = db.prepare(
        `SELECT turn_id, user_msg, alec_response, quality_score
         FROM review_queue
         WHERE status = 'approved'
         ORDER BY created_at ASC`
      ).all();
    } finally {
      try { db && db.close(); } catch (_) {}
    }

    // Read constitution content once
    let constitution = '';
    try {
      constitution = fs.readFileSync(CONSTITUTION, 'utf8');
    } catch {
      console.warn('[fineTuneQueue] ALEC_CONSTITUTION.md not found — using empty system message');
    }

    // H6: skip quality_score < 0.40
    const eligible = rows.filter(r => {
      if (r.quality_score < 0.40) {
        console.warn(`[fineTuneQueue] H6: skipping turn_id=${r.turn_id} (score=${r.quality_score})`);
        return false;
      }
      return true;
    });

    // Format each as chat-style JSONL
    const lines = eligible.map(r => JSON.stringify({
      messages: [
        { role: 'system',    content: constitution },
        { role: 'user',      content: r.user_msg },
        { role: 'assistant', content: r.alec_response },
      ],
    }));

    // Write JSONL batch file
    const date      = new Date().toISOString().slice(0, 10);
    const batchFile = path.join(SFT_DIR, `batch_${date}.jsonl`);
    fs.mkdirSync(SFT_DIR, { recursive: true });
    fs.writeFileSync(batchFile, lines.join('\n'));
    console.log(`[fineTuneQueue] Wrote ${eligible.length} examples to ${batchFile}`);

    return { batchFile, exampleCount: eligible.length };
  }

  /**
   * POST job to Python neural server, insert fine_tune_jobs row (status='queued').
   * H4: model_versions row (if any) is inserted with is_active=0.
   *
   * @param {{ batchFile: string, exampleCount: number }} params
   * @returns {{ jobId: string }}
   */
  async triggerTraining({ batchFile, exampleCount }) {
    const jobId = `ft-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(36).slice(2, 8)}`;

    // Insert into fine_tune_jobs BEFORE calling Python (so status is tracked even if call fails)
    let db;
    try {
      db = openDb();
      db.prepare(
        `INSERT INTO fine_tune_jobs (status, batch_file, example_count, created_at)
         VALUES ('queued', ?, ?, CURRENT_TIMESTAMP)`
      ).run(batchFile, exampleCount);
    } finally {
      try { db && db.close(); } catch (_) {}
    }

    // POST to Python neural server
    const resp = await axios.post(
      `${this._neuralUrl}/training/start`,
      { batch_file: batchFile, job_id: jobId, example_count: exampleCount },
      { timeout: 30000 },
    );
    console.log('[fineTuneQueue] Training triggered:', resp.data);

    return { jobId, neuralResponse: resp.data };
  }

  /**
   * Check count threshold and fire the pipeline if met.
   * Called by cron every 30 min (count check) and Sunday 02:00 (unconditional).
   *
   * @param {{ force?: boolean }} [opts]
   * @returns {{ triggered: boolean, reason?: string, jobId?: string }}
   */
  async maybeRun(opts = {}) {
    const count = this.getApprovedCount();
    if (!opts.force && count < this._threshold) {
      return { triggered: false, reason: `only ${count} approved examples (need ${this._threshold})` };
    }

    console.log(`[fineTuneQueue] Triggering fine-tune (${count} approved examples)`);
    const batch  = await this.buildBatch();
    if (batch.exampleCount === 0) {
      return { triggered: false, reason: 'no eligible examples after H6 filter' };
    }
    const result = await this.triggerTraining(batch);
    return { triggered: true, jobId: result.jobId, exampleCount: batch.exampleCount };
  }
}

module.exports = FineTuneQueue;

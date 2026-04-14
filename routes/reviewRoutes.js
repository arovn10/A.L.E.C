'use strict';

const express  = require('express');
const path     = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.ALEC_LOCAL_DB_PATH ||
  path.join(__dirname, '../data/alec.db');

const router = express.Router();

function openDb() {
  return new Database(DB_PATH);
}

/**
 * GET /api/review/queue
 * Returns all review_queue rows with status='pending', newest first.
 * Protected by authenticateToken registered in server.js before this router.
 */
router.get('/queue', (req, res) => {
  let db;
  try {
    db = openDb();
    const items = db.prepare(
      `SELECT id, turn_id, session_id, user_msg, alec_response,
              quality_score, status, reviewed_by, reviewed_at, created_at
       FROM review_queue
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 100`
    ).all();
    res.json({ ok: true, items, count: items.length });
  } catch (err) {
    console.error('[reviewRoutes] GET /queue error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { db && db.close(); } catch (_) {}
  }
});

/**
 * POST /api/review/:id/approve
 * Moves a review_queue row to status='approved'.
 * Body (optional): { reviewed_by }
 */
router.post('/:id/approve', (req, res) => {
  const { id } = req.params;
  const reviewedBy = req.body?.reviewed_by || req.user?.email || 'unknown';
  let db;
  try {
    db = openDb();
    const result = db.prepare(
      `UPDATE review_queue
       SET status = 'approved', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(reviewedBy, id);
    if (result.changes === 0) {
      return res.status(404).json({ error: `Review item ${id} not found` });
    }
    res.json({ ok: true, id: Number(id), status: 'approved', reviewed_by: reviewedBy });
  } catch (err) {
    console.error('[reviewRoutes] POST /:id/approve error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { db && db.close(); } catch (_) {}
  }
});

/**
 * POST /api/review/:id/reject
 * Moves a review_queue row to status='rejected'.
 * Body (optional): { reviewed_by }
 */
router.post('/:id/reject', (req, res) => {
  const { id } = req.params;
  const reviewedBy = req.body?.reviewed_by || req.user?.email || 'unknown';
  let db;
  try {
    db = openDb();
    const result = db.prepare(
      `UPDATE review_queue
       SET status = 'rejected', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(reviewedBy, id);
    if (result.changes === 0) {
      return res.status(404).json({ error: `Review item ${id} not found` });
    }
    res.json({ ok: true, id: Number(id), status: 'rejected', reviewed_by: reviewedBy });
  } catch (err) {
    console.error('[reviewRoutes] POST /:id/reject error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { db && db.close(); } catch (_) {}
  }
});

/**
 * GET /api/review/finetune/status
 * Returns the most recent fine_tune_jobs row.
 */
router.get('/finetune/status', (req, res) => {
  let db;
  try {
    db = openDb();
    const job = db.prepare(
      `SELECT id, status, batch_file, example_count, eval_score, created_at
       FROM fine_tune_jobs
       ORDER BY created_at DESC
       LIMIT 1`
    ).get();
    res.json({ ok: true, job: job || null });
  } catch (err) {
    console.error('[reviewRoutes] GET /finetune/status error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { db && db.close(); } catch (_) {}
  }
});

/**
 * POST /api/review/promote/:version_id
 * H4 compliance: human-only promotion of a model_versions row.
 * Sets is_active=1 and clears other active versions.
 */
router.post('/promote/:version_id', (req, res) => {
  const { version_id } = req.params;
  const promotedBy = req.body?.promoted_by || req.user?.email || 'unknown';
  let db;
  try {
    db = openDb();

    // Check eval_score threshold (H5)
    const ver = db.prepare(
      `SELECT id, version_tag, eval_score FROM model_versions WHERE version_tag = ?`
    ).get(version_id);
    if (!ver) return res.status(404).json({ error: `Version ${version_id} not found` });
    if (ver.eval_score !== null && ver.eval_score < 0.80) {
      return res.status(422).json({
        error: `H5 violation: eval_score ${ver.eval_score} < 0.80. Promotion blocked.`,
        eval_score: ver.eval_score,
      });
    }

    // Deactivate all, then activate this one
    db.prepare(`UPDATE model_versions SET is_active = 0`).run();
    db.prepare(
      `UPDATE model_versions
       SET is_active = 1, promoted_by = ?, promoted_at = CURRENT_TIMESTAMP
       WHERE version_tag = ?`
    ).run(promotedBy, version_id);

    res.json({ ok: true, version_id, promoted_by: promotedBy });
  } catch (err) {
    console.error('[reviewRoutes] POST /promote error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { db && db.close(); } catch (_) {}
  }
});

module.exports = router;

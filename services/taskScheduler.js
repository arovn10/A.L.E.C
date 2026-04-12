/**
 * A.L.E.C. Task Scheduler
 *
 * Persistent background task scheduling with:
 *  - Cron expressions (via node-cron)
 *  - One-time delayed tasks
 *  - Background long-running tasks with progress tracking
 *  - iMessage notification when tasks complete
 *
 * Tasks are persisted to data/scheduled-tasks.json so they survive restarts.
 *
 * Example:
 *   scheduler.schedule('daily-portfolio', '0 9 * * *', async () => { ... }, { notify: true })
 *   scheduler.runOnce('report-001', async () => { ... }, { notifyWhenDone: true, description: 'Research report' })
 */

const cron    = require('node-cron');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

const TASKS_FILE  = path.join(__dirname, '../data/scheduled-tasks.json');
const HISTORY_FILE = path.join(__dirname, '../data/task-history.jsonl');

// Lazy-load to avoid circular deps
function getIMessage() { try { return require('./iMessageService.js'); } catch { return null; } }

// ── Persistence ────────────────────────────────────────────────────
function loadPersistedTasks() {
  try {
    if (fs.existsSync(TASKS_FILE)) return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch (_) {}
  return {};
}
function savePersistedTasks(tasks) {
  fs.mkdirSync(path.dirname(TASKS_FILE), { recursive: true });
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
}
function logHistory(entry) {
  try { fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n'); } catch (_) {}
}

// ── In-memory state ────────────────────────────────────────────────
const _cronJobs  = new Map(); // taskId → cron.ScheduledTask
const _bgTasks   = new Map(); // taskId → { status, startedAt, description, promise }
let   _persisted = loadPersistedTasks();

// ── Helpers ────────────────────────────────────────────────────────
function taskId() { return crypto.randomBytes(6).toString('hex'); }

async function notifyOwner(msg) {
  const im = getIMessage();
  if (im) {
    try { await im.notifyOwner(msg, '📋 Task Complete'); } catch (_) {}
  }
  // Also log so the chat can pick it up
  logHistory({ type: 'notification', message: msg, ts: new Date().toISOString() });
}

// ── SCHEDULED (CRON) TASKS ─────────────────────────────────────────

/**
 * Schedule a recurring cron task.
 * @param {string}   id          — unique task ID (for deduplication)
 * @param {string}   expression  — cron expression e.g. '0 9 * * *'
 * @param {Function} fn          — async function to run
 * @param {object}   opts        — { description, notifyWhenDone, notifyOwner (bool) }
 */
function schedule(id, expression, fn, opts = {}) {
  // Cancel existing job with same ID
  if (_cronJobs.has(id)) _cronJobs.get(id).stop();

  if (!cron.validate(expression)) throw new Error(`Invalid cron expression: ${expression}`);

  const job = cron.schedule(expression, async () => {
    const runId = taskId();
    const startedAt = new Date().toISOString();
    console.log(`[Scheduler] Running: ${id} (${opts.description || ''})`);

    try {
      const result = await fn();
      const entry = { id, runId, expression, status: 'success', startedAt, finishedAt: new Date().toISOString(), result: String(result || '').slice(0, 200) };
      logHistory(entry);

      // Update persisted last-run
      if (_persisted[id]) {
        _persisted[id].lastRun = startedAt;
        _persisted[id].lastStatus = 'success';
        savePersistedTasks(_persisted);
      }

      if (opts.notifyWhenDone) {
        await notifyOwner(`✅ "${opts.description || id}" completed successfully.`);
      }
    } catch (err) {
      logHistory({ id, runId, status: 'error', error: err.message, startedAt, finishedAt: new Date().toISOString() });
      console.error(`[Scheduler] Task ${id} failed:`, err.message);
      if (opts.notifyWhenDone || opts.notifyOnError) {
        await notifyOwner(`❌ "${opts.description || id}" failed: ${err.message.slice(0, 100)}`);
      }
    }
  });

  _cronJobs.set(id, job);

  // Persist task metadata
  _persisted[id] = {
    id, expression, description: opts.description || id,
    notifyWhenDone: opts.notifyWhenDone || false,
    createdAt: new Date().toISOString(),
    lastRun: _persisted[id]?.lastRun || null,
    lastStatus: _persisted[id]?.lastStatus || null,
  };
  savePersistedTasks(_persisted);

  console.log(`[Scheduler] Scheduled: ${id} → ${expression} (${opts.description || ''})`);
  return { id, expression, description: opts.description };
}

/**
 * Cancel a scheduled cron task.
 */
function cancel(id) {
  if (_cronJobs.has(id)) {
    _cronJobs.get(id).stop();
    _cronJobs.delete(id);
  }
  delete _persisted[id];
  savePersistedTasks(_persisted);
  console.log(`[Scheduler] Cancelled: ${id}`);
  return { success: true, id };
}

// ── BACKGROUND (ONE-SHOT) TASKS ────────────────────────────────────

/**
 * Run a one-time background task asynchronously.
 * Returns immediately with a task token — caller can poll /api/tasks/:id for status.
 *
 * @param {Function} fn   — async function; can update progress via the returned emit fn
 * @param {object}   opts — { description, notifyWhenDone }
 */
function runBackground(fn, opts = {}) {
  const id = taskId();
  const startedAt = new Date().toISOString();
  const task = {
    id,
    description: opts.description || 'Background task',
    status: 'running',
    progress: 0,
    progressNote: 'Starting…',
    startedAt,
    finishedAt: null,
    result: null,
    error: null,
  };

  _bgTasks.set(id, task);

  // Provide a progress callback the fn can use
  const updateProgress = (pct, note) => {
    if (_bgTasks.has(id)) {
      const t = _bgTasks.get(id);
      t.progress = Math.min(100, pct);
      t.progressNote = note || t.progressNote;
    }
  };

  const promise = (async () => {
    try {
      const result = await fn(updateProgress);
      task.status      = 'complete';
      task.progress    = 100;
      task.progressNote = 'Done';
      task.result      = typeof result === 'string' ? result.slice(0, 2000) : JSON.stringify(result).slice(0, 2000);
      task.finishedAt  = new Date().toISOString();
      logHistory({ type: 'background', ...task });

      if (opts.notifyWhenDone) {
        await notifyOwner(`✅ "${task.description}" complete! ${task.result?.slice(0, 100) || ''}`);
      }
    } catch (err) {
      task.status     = 'error';
      task.error      = err.message;
      task.finishedAt = new Date().toISOString();
      logHistory({ type: 'background_error', ...task });
      console.error(`[Scheduler] Background task ${id} failed:`, err.message);

      if (opts.notifyWhenDone || opts.notifyOnError) {
        await notifyOwner(`❌ "${task.description}" failed: ${err.message.slice(0, 100)}`);
      }
    }
  })();

  task._promise = promise;
  return { id, description: task.description, status: 'running' };
}

// ── QUERY ──────────────────────────────────────────────────────────

function getTaskStatus(id) {
  const bg = _bgTasks.get(id);
  if (bg) {
    const { _promise, ...safe } = bg;
    return safe;
  }
  if (_persisted[id]) return { ..._persisted[id], type: 'cron' };
  return null;
}

function listTasks() {
  const crons = Array.from(_cronJobs.keys()).map(id => ({
    id, type: 'cron', ...(_persisted[id] || {}),
  }));
  const bg = Array.from(_bgTasks.values())
    .filter(t => t.status === 'running' || (Date.now() - new Date(t.finishedAt || 0).getTime()) < 3600000)
    .map(({ _promise, ...t }) => ({ ...t, type: 'background' }));
  return { crons, background: bg, total: crons.length + bg.length };
}

function getTaskHistory(limit = 50) {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    return fs.readFileSync(HISTORY_FILE, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean).slice(-limit);
  } catch { return []; }
}

// ── BUILT-IN SYSTEM SCHEDULES ──────────────────────────────────────

/**
 * Register ALEC's built-in recurring tasks.
 * Called once on server startup.
 */
function registerSystemTasks() {
  // Daily portfolio snapshot at 9 AM — runs STOA RAG and sends iMessage summary
  schedule('daily-portfolio-snapshot', '0 9 * * *', async () => {
    const stoaQuery = require('./stoaQueryService.js');
    const portfolio = await stoaQuery.getPortfolioSummary();
    if (!portfolio?.length) return 'No portfolio data';
    const p = portfolio[0];
    return `Portfolio: ${p.PropertyCount} props | ${p.AvgOccupancyPct?.toFixed ? (p.AvgOccupancyPct * 100).toFixed(1) : p.AvgOccupancyPct}% avg occ | $${Math.round(p.AvgRent || 0)}/unit avg rent`;
  }, { description: 'Daily portfolio occupancy snapshot', notifyWhenDone: true });

  // Weekly lease expiry alert — Mondays at 8 AM
  schedule('weekly-lease-alert', '0 8 * * 1', async () => {
    const stoaQuery = require('./stoaQueryService.js');
    const expiring = await stoaQuery.getExpiringContracts(30);
    if (!expiring.length) return 'No contracts expiring in 30 days';
    return `${expiring.length} contracts expiring in 30 days: ${expiring.slice(0, 3).map(c => c.ContractName).join(', ')}`;
  }, { description: 'Weekly expiring contracts alert', notifyWhenDone: true });

  // Export cleanup — daily at 3 AM
  schedule('daily-export-cleanup', '0 3 * * *', async () => {
    const excelExport = require('./excelExport.js');
    excelExport.cleanupOldExports(24);
    return 'Export cleanup done';
  }, { description: 'Clean up old Excel exports', notifyWhenDone: false });

  console.log('📅 System task schedules registered');
}

module.exports = {
  schedule, cancel,
  runBackground, getTaskStatus, listTasks, getTaskHistory,
  registerSystemTasks,
};

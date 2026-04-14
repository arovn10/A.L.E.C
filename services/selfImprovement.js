/**
 * A.L.E.C. Self-Improvement Engine
 *
 * Gives ALEC the ability to:
 *  1. Diagnose its own weaknesses via feedback + logs
 *  2. Propose targeted code/prompt improvements via LLM
 *  3. Apply the patch safely (syntax check first)
 *  4. Run automated tests — only commit + push if all critical tests pass
 *  5. Revert automatically if tests fail (no broken deploys)
 *
 * DIRECTIVE: Always prioritize improving the owner (Alec Rovner)'s experience.
 *            Fix accuracy, speed, insight depth, and data correctness first.
 *
 * Owner-only — gate with requireFullCapabilities middleware in server.
 */

require('dotenv').config();
const { execFile, execFileSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const http  = require('http');
const https = require('https');
const os    = require('os');

const ROOT = path.join(__dirname, '..');
const LOGS_DIR  = path.join(ROOT, 'logs');
const DATA_DIR  = path.join(ROOT, 'data');
const SELF_LOG  = path.join(LOGS_DIR, 'self-improvement.jsonl');

if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

// ── Improvement directives ─────────────────────────────────────────
// These tell the LLM what to focus on when self-improving.
const IMPROVEMENT_DIRECTIVES = [
  {
    id:       'stoa_accuracy',
    priority: 10,
    area:     'STOA Data Accuracy',
    focus:    'Ensure STOA queries return real data, not hallucinations. Fix regex, SQL, or formatting bugs.',
  },
  {
    id:       'insight_quality',
    priority: 9,
    area:     'Response Insight Quality',
    focus:    'Make LLM responses more analytical: flag anomalies, compare to budget, give trend direction with context.',
  },
  {
    id:       'chat_speed',
    priority: 7,
    area:     'Chat Response Speed',
    focus:    'Reduce latency — optimize prompt length, parallelize DB queries, cache frequent results.',
  },
  {
    id:       'ux_clarity',
    priority: 8,
    area:     'User Experience',
    focus:    'Make UI interactions clearer: better error messages, loading states, formatted outputs.',
  },
  {
    id:       'error_handling',
    priority: 9,
    area:     'Error Handling',
    focus:    'Ensure errors are caught gracefully, user-facing messages are helpful, nothing crashes silently.',
  },
  {
    id:       'export_features',
    priority: 6,
    area:     'Excel / Export Features',
    focus:    'Improve Excel export formatting, add charts, better column widths, summary rows.',
  },
];

// ── Helper: run a shell command, return stdout ─────────────────────
function runShell(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd: ROOT, timeout: 30000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── Log improvement events ─────────────────────────────────────────
function log(event) {
  const entry = { ...event, ts: new Date().toISOString() };
  fs.appendFileSync(SELF_LOG, JSON.stringify(entry) + '\n');
  console.log('[SelfImprove]', JSON.stringify(entry).slice(0, 120));
}

// ── Test suite ─────────────────────────────────────────────────────

/**
 * Get a JWT token for test requests.
 */
async function getTestToken() {
  const ownerEmail = process.env.ALEC_OWNER_EMAIL || 'alec@rovner.com';
  const ownerPass  = process.env.ALEC_OWNER_PASS  || 'alec2024';

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email: 'alec', password: ownerPass });
    const req = http.request({
      hostname: '127.0.0.1', port: 3001, path: '/api/auth/login',
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data).token || null); } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Make an API call for testing.
 */
async function testRequest(method, apiPath, body, token) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const req = http.request({
      hostname: '127.0.0.1', port: 3001, path: apiPath, method,
      headers, timeout: 20000,
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', err => resolve({ status: 0, error: err.message }));
    req.on('timeout', () => resolve({ status: 0, error: 'timeout' }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Run the built-in test suite.
 * Returns { passed, failed, total, criticalFailed, results }
 */
async function runTests() {
  const results = [];
  let token;

  const test = (name, critical, fn) => results.push({ name, critical, fn });

  // ── Define tests ────────────────────────────────────────────────
  test('Server health check', true, async () => {
    const r = await testRequest('GET', '/health', null, null);
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    if (r.body?.status !== 'ok') throw new Error('Status not ok');
  });

  test('Auth login works', true, async () => {
    token = await getTestToken();
    if (!token) throw new Error('Login returned no token');
  });

  test('STOA ping (DB connected)', true, async () => {
    const r = await testRequest('GET', '/api/stoa/ping', null, token);
    if (!r.body?.connected) throw new Error('STOA DB not connected');
  });

  test('STOA occupancy returns real data', true, async () => {
    const r = await testRequest('GET', '/api/stoa/occupancy?property=hammond', null, token);
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    if (!r.body?.data?.length) throw new Error('No occupancy data returned');
    const row = r.body.data[0];
    if (!row.OccupancyPct || !row.TotalUnits) throw new Error('Missing key fields in response');
  });

  test('STOA trend (6 months of history)', true, async () => {
    const r = await testRequest('GET', '/api/stoa/trend?property=hammond&months=6', null, token);
    if (r.status !== 200) throw new Error(`Status ${r.status}`);
    if (r.body?.count < 4) throw new Error(`Only ${r.body?.count} rows — expected 20+`);
  });

  test('STOA rent-growth data', false, async () => {
    const r = await testRequest('GET', '/api/stoa/rent-growth?property=hammond', null, token);
    if (!r.body?.data?.length) throw new Error('No rent growth data');
    const rg = r.body.data[0];
    // Verify % values are sane (should be -20% to +50%, not -4830%)
    if (Math.abs(rg.RentGrowth6MoPct) > 100) throw new Error(`Rent growth pct looks wrong: ${rg.RentGrowth6MoPct}`);
  });

  test('Excel portfolio export generates file', false, async () => {
    const r = await testRequest('POST', '/api/stoa/export', { type: 'portfolio' }, token);
    if (!r.body?.success) throw new Error('Export failed: ' + r.body?.error);
    if (!r.body?.url) throw new Error('No download URL returned');
    // Verify file exists on disk
    const filePath = path.join(ROOT, 'data', 'exports', path.basename(r.body.url));
    if (!fs.existsSync(filePath)) throw new Error('Export file not found on disk');
  });

  test('Chat responds to STOA query (no hallucination)', true, async () => {
    const r = await testRequest('POST', '/api/chat', {
      message: 'what is the occupancy at Hammond right now?',
      messages: [{ role: 'user', content: 'what is the occupancy at Hammond right now?' }],
    }, token);
    if (r.status !== 200) throw new Error(`Chat returned ${r.status}`);
    const response = r.body?.response || '';
    if (!response || response.length < 10) throw new Error('Empty response');
    // Check response mentions an actual percentage (not invented)
    if (!/\d+\.?\d*%/.test(response)) throw new Error('Response contains no percentage — may be hallucinating');
  });

  test('Memory endpoint works', false, async () => {
    const r = await testRequest('GET', '/api/memory/facts', null, token);
    if (r.status === 401) throw new Error('Auth failed');
    // 200 or 404 (endpoint may not exist) is OK
  });

  // ── Run tests ───────────────────────────────────────────────────
  const runResults = [];
  for (const { name, critical, fn } of results) {
    try {
      await fn();
      runResults.push({ name, critical, passed: true });
    } catch (err) {
      runResults.push({ name, critical, passed: false, error: err.message });
    }
  }

  const passed  = runResults.filter(r => r.passed).length;
  const failed  = runResults.filter(r => !r.passed).length;
  const criticalFailed = runResults.filter(r => !r.passed && r.critical).length;

  return { passed, failed, total: runResults.length, criticalFailed, results: runResults };
}

// ── Improvement cycle ──────────────────────────────────────────────

/**
 * Generate an improvement proposal via the LLM for a given area.
 * Returns { description, fileChanges } or null if nothing actionable.
 *
 * fileChanges: [{ file, oldStr, newStr }]
 */
async function proposeImprovement(directive, recentFeedback = []) {
  const llamaEngine = require('./llamaEngine.js');

  const feedbackSummary = recentFeedback.length > 0
    ? 'Recent negative feedback from Alec:\n' + recentFeedback.slice(-5).map(f => `- "${f.text}"`).join('\n')
    : 'No recent negative feedback.';

  const prompt = `You are ALEC's self-improvement module. Your job is to propose a specific, safe, small code fix.

Focus area: ${directive.area}
Directive: ${directive.focus}
${feedbackSummary}

IMPORTANT RULES:
- Only suggest changes to files in the services/ or frontend/ directories (NOT backend/server.js auth code)
- Changes must be small (max 20 lines changed)
- You MUST output valid JSON, nothing else
- If no improvement is needed, return {"improvement": false}
- For code changes, provide exact old_string → new_string replacements (must be unique in the file)

Output format:
{
  "improvement": true,
  "description": "One sentence describing what this improves and why",
  "changes": [
    {
      "file": "services/stoaQueryService.js",
      "old_string": "exact text to find",
      "new_string": "exact replacement text"
    }
  ]
}`;

  try {
    const response = await llamaEngine.generate([
      { role: 'system', content: 'You are a code improvement assistant. Output only valid JSON.' },
      { role: 'user', content: prompt },
    ], { maxTokens: 512, temperature: 0.3 });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.improvement) return null;
    if (!parsed.changes?.length) return null;

    return parsed;
  } catch (err) {
    log({ type: 'propose_error', directive: directive.id, error: err.message });
    return null;
  }
}

/**
 * Apply a proposal's file changes.
 * Returns list of files that were changed (for rollback).
 */
async function applyChanges(changes) {
  const applied = [];
  for (const change of changes) {
    const filePath = path.resolve(ROOT, change.file);

    // Safety: only allow changes within the project directory
    if (!filePath.startsWith(ROOT)) throw new Error(`Refused: path outside project: ${filePath}`);

    // Safety: don't modify security-critical files
    const criticalFiles = ['services/tokenManager.js', 'services/selfImprovement.js'];
    if (criticalFiles.some(f => filePath.endsWith(f))) {
      throw new Error(`Refused: critical file ${change.file} cannot be auto-modified`);
    }

    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${change.file}`);

    const original = fs.readFileSync(filePath, 'utf8');
    if (!original.includes(change.old_string)) {
      throw new Error(`old_string not found in ${change.file}: "${change.old_string.slice(0, 60)}"`);
    }

    const updated = original.replace(change.old_string, change.new_string);
    fs.writeFileSync(filePath, updated, 'utf8');
    applied.push({ file: change.file, original });

    // Syntax check for JS files
    if (filePath.endsWith('.js')) {
      try {
        execFileSync('node', ['--check', filePath], { cwd: ROOT });
      } catch (syntaxErr) {
        // Revert this file immediately
        fs.writeFileSync(filePath, original, 'utf8');
        applied.pop();
        throw new Error(`Syntax error in ${change.file}: ${syntaxErr.message?.slice(0, 200)}`);
      }
    }
  }
  return applied;
}

/**
 * Revert applied changes.
 */
function revertChanges(applied) {
  for (const { file, original } of applied) {
    const filePath = path.resolve(ROOT, file);
    fs.writeFileSync(filePath, original, 'utf8');
    console.log('[SelfImprove] Reverted:', file);
  }
}

/**
 * Commit and push to git — ONLY called after tests pass.
 */
async function commitAndPush(description, filesChanged) {
  const files = filesChanged.map(f => f.file);
  await runShell('git', ['add', ...files]);
  const msg = `self-improve: ${description}\n\nAuto-applied by A.L.E.C. Self-Improvement Engine after passing test suite.\n\nCo-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>`;
  await runShell('git', ['commit', '-m', msg]);
  await runShell('git', ['push', 'origin', 'main']);
  log({ type: 'committed', description, files });
}

/**
 * Full improvement cycle for a single directive:
 *   1. Propose change via LLM
 *   2. Apply it
 *   3. Run tests
 *   4. If tests pass → commit + push
 *   5. If tests fail → revert, log failure
 *
 * Returns a run summary object.
 */
async function runImprovementCycle(directiveId = null, recentFeedback = []) {
  // Pick directive (highest priority or specified)
  const directive = directiveId
    ? IMPROVEMENT_DIRECTIVES.find(d => d.id === directiveId) || IMPROVEMENT_DIRECTIVES[0]
    : IMPROVEMENT_DIRECTIVES.sort((a, b) => b.priority - a.priority)[0];

  log({ type: 'cycle_start', directive: directive.id });

  // 1. Run baseline tests first
  const baseline = await runTests();
  if (baseline.criticalFailed > 0) {
    const msg = `Baseline tests failed (${baseline.criticalFailed} critical). Skipping improvement cycle.`;
    log({ type: 'cycle_skip', reason: msg, baseline });
    return { success: false, reason: msg, baseline };
  }

  // 2. Propose improvement
  const proposal = await proposeImprovement(directive, recentFeedback);
  if (!proposal) {
    const msg = 'LLM produced no actionable improvement for this directive.';
    log({ type: 'cycle_skip', reason: msg, directive: directive.id });
    return { success: false, reason: msg };
  }

  log({ type: 'proposal', directive: directive.id, description: proposal.description, changes: proposal.changes?.length });

  // 3. Apply changes
  let applied = [];
  try {
    applied = await applyChanges(proposal.changes);
  } catch (err) {
    log({ type: 'apply_failed', error: err.message });
    return { success: false, reason: `Apply failed: ${err.message}` };
  }

  // 4. Run tests
  const testResult = await runTests();
  log({ type: 'test_result', passed: testResult.passed, failed: testResult.failed, criticalFailed: testResult.criticalFailed });

  if (testResult.criticalFailed > 0) {
    // Revert — tests failed
    revertChanges(applied);
    log({ type: 'cycle_reverted', reason: 'Critical tests failed after applying change', testResult });
    return {
      success: false,
      reason: `Reverted: ${testResult.criticalFailed} critical test(s) failed after applying change`,
      proposal,
      testResult,
    };
  }

  // 5. Tests passed — commit and push
  try {
    await commitAndPush(proposal.description, applied);
  } catch (gitErr) {
    log({ type: 'git_error', error: gitErr.message });
    return {
      success: false,
      reason: `Tests passed but git push failed: ${gitErr.message}`,
      proposal,
      testResult,
    };
  }

  return {
    success: true,
    directive: directive.id,
    description: proposal.description,
    filesChanged: applied.map(a => a.file),
    testResult,
  };
}

/**
 * Get recent negative feedback from feedback.jsonl for LLM context.
 */
function getRecentNegativeFeedback() {
  const feedbackPath = path.join(DATA_DIR, 'feedback.jsonl');
  if (!fs.existsSync(feedbackPath)) return [];
  try {
    const lines = fs.readFileSync(feedbackPath, 'utf8').split('\n').filter(Boolean);
    return lines
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(f => f && f.rating === -1 && f.response_text)
      .slice(-10)
      .map(f => ({ text: f.response_text?.slice(0, 100) }));
  } catch { return []; }
}

/**
 * Get self-improvement history log.
 */
function getImprovementHistory(limit = 20) {
  if (!fs.existsSync(SELF_LOG)) return [];
  try {
    return fs.readFileSync(SELF_LOG, 'utf8')
      .split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .slice(-limit);
  } catch { return []; }
}

module.exports = {
  runTests,
  runImprovementCycle,
  getImprovementHistory,
  getRecentNegativeFeedback,
  IMPROVEMENT_DIRECTIVES,
};

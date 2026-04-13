/**
 * A.L.E.C. GitHub Service
 *
 * Full GitHub integration via GitHub CLI (gh) and REST API.
 * Supports: repos, files, PRs, issues, Actions, code search, commits.
 *
 * Authentication: uses `gh auth` (GitHub CLI) which stores the token securely.
 * Run `gh auth login` once to configure.
 *
 * Also supports direct GitHub API via GITHUB_TOKEN env var.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs   = require('fs');

const GH_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
const GH_CLI   = '/opt/homebrew/bin/gh';

// ── gh CLI wrapper ─────────────────────────────────────────────────
function gh(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NO_COLOR: '1' };
    if (GH_TOKEN) env.GH_TOKEN = GH_TOKEN;
    execFile(GH_CLI, args, { timeout: 30000, env, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── GitHub REST API ────────────────────────────────────────────────
async function ghApi(endpoint, method = 'GET', body = null) {
  const args = ['api', endpoint, '--method', method];
  if (body) {
    args.push('--input', '-');
    // We need to pass body via stdin — use a temp file
    const tmp = path.join('/tmp', `gh-api-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(body));
    const result = await new Promise((resolve, reject) => {
      const env = { ...process.env, NO_COLOR: '1' };
      if (GH_TOKEN) env.GH_TOKEN = GH_TOKEN;
      const proc = execFile(GH_CLI, ['api', endpoint, '--method', method, '--input', tmp],
        { timeout: 30000, env }, (err, stdout, stderr) => {
        fs.unlinkSync(tmp);
        if (err) reject(new Error(stderr?.trim() || err.message));
        else {
          try { resolve(JSON.parse(stdout)); } catch { resolve(stdout); }
        }
      });
    });
    return result;
  }
  const raw = await gh(args);
  try { return JSON.parse(raw); } catch { return raw; }
}

// ── Repo Operations ────────────────────────────────────────────────

/**
 * Get info about a repo (default: ALEC's own repo).
 */
async function getRepo(repo = process.env.GITHUB_REPO || 'arovn10/A.L.E.C') {
  return ghApi(`repos/${repo}`);
}

/**
 * List repos for the authenticated user.
 */
async function listRepos(limit = 20) {
  const raw = await gh(['repo', 'list', '--json', 'name,description,isPrivate,updatedAt,url', '--limit', String(limit)]);
  try { return JSON.parse(raw); } catch { return []; }
}

/**
 * Create a new repository.
 */
async function createRepo(name, description = '', isPrivate = true) {
  const args = ['repo', 'create', name, '--description', description];
  if (isPrivate) args.push('--private');
  else args.push('--public');
  return gh(args);
}

// ── File Operations ────────────────────────────────────────────────

/**
 * Read a file from a GitHub repo.
 * Returns the decoded text content.
 */
async function readFile(repo, filePath, ref = 'main') {
  const raw = await gh(['api', `repos/${repo}/contents/${filePath}`, '--jq', '.content']);
  return Buffer.from(raw.trim(), 'base64').toString('utf8');
}

/**
 * Create or update a file in a GitHub repo.
 */
async function writeFile(repo, filePath, content, message, branch = 'main') {
  const encoded = Buffer.from(content).toString('base64');

  // Check if file exists (need sha for update)
  let sha = null;
  try {
    const existing = await ghApi(`repos/${repo}/contents/${filePath}`);
    sha = existing.sha;
  } catch (_) {}

  const body = { message, content: encoded, branch };
  if (sha) body.sha = sha;

  return ghApi(`repos/${repo}/contents/${filePath}`, 'PUT', body);
}

// ── Issues ────────────────────────────────────────────────────────

/**
 * List open issues.
 */
async function listIssues(repo = null, limit = 20) {
  const repoArg = repo ? ['--repo', repo] : [];
  const raw = await gh(['issue', 'list', ...repoArg, '--json', 'number,title,state,labels,createdAt,url', '--limit', String(limit)]);
  try { return JSON.parse(raw); } catch { return []; }
}

/**
 * Create an issue.
 */
async function createIssue(title, body, labels = [], repo = null) {
  const args = ['issue', 'create', '--title', title, '--body', body];
  if (repo) args.push('--repo', repo);
  labels.forEach(l => args.push('--label', l));
  return gh(args);
}

// ── Pull Requests ──────────────────────────────────────────────────

/**
 * List open PRs.
 */
async function listPRs(repo = null, limit = 10) {
  const repoArg = repo ? ['--repo', repo] : [];
  const raw = await gh(['pr', 'list', ...repoArg, '--json', 'number,title,state,author,createdAt,url,headRefName', '--limit', String(limit)]);
  try { return JSON.parse(raw); } catch { return []; }
}

/**
 * Create a pull request.
 */
async function createPR(title, body, head, base = 'main', repo = null) {
  const args = ['pr', 'create', '--title', title, '--body', body, '--head', head, '--base', base];
  if (repo) args.push('--repo', repo);
  return gh(args);
}

// ── Commits & History ──────────────────────────────────────────────

/**
 * Get recent commits.
 */
async function getCommits(repo = null, limit = 10) {
  const repoArg = repo ? ['--repo', repo] : [];
  const raw = await gh(['api', `repos/${repo || process.env.GITHUB_REPO || 'arovn10/A.L.E.C'}/commits`, '--jq', `.[0:${limit}] | .[] | {sha: .sha[0:7], message: .commit.message, author: .commit.author.name, date: .commit.author.date}`]);
  try {
    return raw.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ── Code Search ────────────────────────────────────────────────────

/**
 * Search code across GitHub.
 */
async function searchCode(query, limit = 10) {
  const data = await ghApi(`search/code?q=${encodeURIComponent(query)}&per_page=${limit}`);
  return (data.items || []).map(i => ({
    repo:    i.repository?.full_name,
    path:    i.path,
    url:     i.html_url,
    snippet: i.text_matches?.[0]?.fragment?.slice(0, 200),
  }));
}

// ── Actions ────────────────────────────────────────────────────────

/**
 * List recent workflow runs.
 */
async function listWorkflowRuns(repo = null, limit = 10) {
  const r = repo || process.env.GITHUB_REPO || 'arovn10/A.L.E.C';
  const data = await ghApi(`repos/${r}/actions/runs?per_page=${limit}`);
  return (data.workflow_runs || []).map(run => ({
    id:         run.id,
    name:       run.name,
    status:     run.status,
    conclusion: run.conclusion,
    branch:     run.head_branch,
    url:        run.html_url,
    startedAt:  run.run_started_at,
  }));
}

// ── Workflows ─────────────────────────────────────────────────────

/**
 * List all workflows for a repo.
 */
async function listWorkflows(repo = null) {
  const r = repo || process.env.GITHUB_REPO || 'arovn10/A.L.E.C';
  const data = await ghApi(`repos/${r}/actions/workflows`);
  return (data.workflows || []).map(w => ({
    id:       w.id,
    name:     w.name,
    path:     w.path,
    state:    w.state,
  }));
}

/**
 * Trigger a workflow_dispatch event on a workflow.
 * @param {string|number} workflowId  — workflow file name (e.g. "deploy.yml") or numeric id
 * @param {string}        ref         — branch or tag to run on (default: "main")
 * @param {object}        inputs      — optional workflow inputs
 * @param {string}        repo        — owner/repo (default: GITHUB_REPO env)
 */
async function triggerWorkflow(workflowId, ref = 'main', inputs = {}, repo = null) {
  const r = repo || process.env.GITHUB_REPO || 'arovn10/A.L.E.C';
  await ghApi(`repos/${r}/actions/workflows/${encodeURIComponent(String(workflowId))}/dispatches`, 'POST', { ref, inputs });
  return { triggered: true, workflow: workflowId, ref, repo: r };
}

// ── Status ────────────────────────────────────────────────────────
async function status() {
  try {
    const raw = await gh(['auth', 'status', '--json', 'token,username,scopes', '--active']);
    const data = JSON.parse(raw);
    return { authenticated: true, username: data.username || data[0]?.username, tokenConfigured: !!GH_TOKEN };
  } catch {
    return { authenticated: false, tokenConfigured: !!GH_TOKEN, hint: 'Run: gh auth login' };
  }
}

// ── Convenience: clone and open in VS Code ────────────────────────
async function cloneAndOpen(repoUrl, targetDir = null) {
  const dir = targetDir || path.join(require('os').homedir(), 'Desktop', 'ALEC-Projects');
  fs.mkdirSync(dir, { recursive: true });
  await new Promise((resolve, reject) => {
    execFile('git', ['clone', repoUrl], { cwd: dir, timeout: 60000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
  // Open in VS Code / Cursor
  const repoName = repoUrl.split('/').pop().replace('.git', '');
  const clonedPath = path.join(dir, repoName);
  try {
    const vscode = require('./vsCodeController.js');
    await vscode.openFolder(clonedPath);
  } catch (_) {}
  return { clonedTo: clonedPath };
}

module.exports = {
  getRepo, listRepos, createRepo,
  readFile, writeFile,
  listIssues, createIssue,
  listPRs, createPR,
  getCommits, searchCode,
  listWorkflows, listWorkflowRuns, triggerWorkflow,
  cloneAndOpen,
  status,
  ghApi,
};

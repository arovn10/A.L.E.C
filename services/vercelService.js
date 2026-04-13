/**
 * A.L.E.C. Vercel Service
 *
 * Wraps the Vercel REST API for deployment monitoring and status checks.
 * Requires VERCEL_TOKEN in .env (Settings → Tokens in vercel.com)
 * Optionally VERCEL_TEAM_ID for team-scoped projects.
 *
 * Project name defaults to "alec-ai" (from vercel.json) or VERCEL_PROJECT env.
 */

const VERCEL_API = 'https://api.vercel.com';

function headers() {
  return {
    Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

function teamParam() {
  const team = process.env.VERCEL_TEAM_ID;
  return team ? `?teamId=${team}` : '';
}

async function vercelFetch(endpoint, method = 'GET', body = null) {
  const url = `${VERCEL_API}${endpoint}`;
  const opts = { method, headers: headers(), signal: AbortSignal.timeout(10000) };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Vercel API ${resp.status}: ${err.error?.message || resp.statusText}`);
  }
  return resp.json();
}

// ── Projects ──────────────────────────────────────────────────────

async function listProjects() {
  const data = await vercelFetch(`/v9/projects${teamParam()}`);
  return (data.projects || []).map(p => ({
    id:        p.id,
    name:      p.name,
    framework: p.framework,
    url:       p.alias?.[0]?.domain ? `https://${p.alias[0].domain}` : null,
    updatedAt: p.updatedAt,
  }));
}

async function getProject(nameOrId = null) {
  const id = nameOrId || process.env.VERCEL_PROJECT || 'alec-ai';
  const q  = teamParam() ? teamParam() : '';
  const data = await vercelFetch(`/v9/projects/${encodeURIComponent(id)}${q}`);
  return {
    id:        data.id,
    name:      data.name,
    framework: data.framework,
    url:       data.alias?.[0]?.domain ? `https://${data.alias[0].domain}` : null,
    updatedAt: data.updatedAt,
  };
}

// ── Deployments ───────────────────────────────────────────────────

async function listDeployments(limit = 5, projectName = null) {
  const proj   = projectName || process.env.VERCEL_PROJECT || 'alec-ai';
  const q      = teamParam() ? `${teamParam()}&app=${proj}&limit=${limit}` : `?app=${proj}&limit=${limit}`;
  const data   = await vercelFetch(`/v6/deployments${q}`);
  return (data.deployments || []).map(d => ({
    id:        d.uid,
    url:       d.url ? `https://${d.url}` : null,
    state:     d.state,       // READY | ERROR | BUILDING | QUEUED | CANCELED
    target:    d.target,      // production | preview
    branch:    d.meta?.githubCommitRef || d.meta?.gitlabCommitRef || 'main',
    commit:    d.meta?.githubCommitMessage || d.meta?.gitlabCommitMessage || '',
    createdAt: d.createdAt,
  }));
}

async function getDeployment(deploymentId) {
  return vercelFetch(`/v13/deployments/${deploymentId}${teamParam()}`);
}

// ── Redeploy (re-trigger latest production deployment) ────────────

async function redeploy(deploymentId = null, projectName = null) {
  let id = deploymentId;
  if (!id) {
    const deployments = await listDeployments(1, projectName);
    if (!deployments.length) throw new Error('No deployments found to redeploy');
    id = deployments[0].id;
  }
  const data = await vercelFetch(`/v13/deployments?forceNew=1${teamParam() ? '&' + teamParam().slice(1) : ''}`, 'POST', {
    deploymentId: id,
    name: projectName || process.env.VERCEL_PROJECT || 'alec-ai',
    target: 'production',
  });
  return { triggered: true, deploymentId: data.id, url: data.url ? `https://${data.url}` : null };
}

// ── Aliases / domains ─────────────────────────────────────────────

async function listAliases(projectName = null) {
  const proj = projectName || process.env.VERCEL_PROJECT || 'alec-ai';
  const q    = teamParam() ? `${teamParam()}&projectId=${proj}` : `?projectId=${proj}`;
  const data = await vercelFetch(`/v4/aliases${q}`);
  return (data.aliases || []).map(a => ({ alias: a.alias, uid: a.uid, deployment: a.deploymentId }));
}

// ── Status ────────────────────────────────────────────────────────

async function status() {
  if (!process.env.VERCEL_TOKEN) {
    return { configured: false, hint: 'Add VERCEL_TOKEN to .env (vercel.com → Settings → Tokens)' };
  }
  try {
    const deployments = await listDeployments(3);
    const latest      = deployments[0];
    return {
      configured:   true,
      connected:    true,
      project:      process.env.VERCEL_PROJECT || 'alec-ai',
      latestState:  latest?.state || 'unknown',
      latestUrl:    latest?.url   || null,
      latestBranch: latest?.branch || 'main',
      recentCount:  deployments.length,
    };
  } catch (err) {
    return { configured: true, connected: false, error: err.message };
  }
}

module.exports = { listProjects, getProject, listDeployments, getDeployment, redeploy, listAliases, status };

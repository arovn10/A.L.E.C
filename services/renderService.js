/**
 * A.L.E.C. Render.com Service
 *
 * Manage Render.com deployments, services, and logs.
 * Requires RENDER_API_KEY in .env (from https://dashboard.render.com/account/api-keys)
 */

const RENDER_KEY  = process.env.RENDER_API_KEY || null;
const RENDER_BASE = 'https://api.render.com/v1';

async function renderAPI(endpoint, method = 'GET', body = null) {
  if (!RENDER_KEY) throw new Error('RENDER_API_KEY not set in .env');
  const opts = {
    method,
    headers: { Authorization: `Bearer ${RENDER_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(RENDER_BASE + endpoint, opts);
  if (!resp.ok) throw new Error(`Render API error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

/**
 * List all services on this Render account.
 */
async function listServices() {
  const data = await renderAPI('/services?limit=50');
  return (data || []).map(s => s.service || s).map(s => ({
    id:        s.id,
    name:      s.name,
    type:      s.type,
    status:    s.suspended === 'suspended' ? 'suspended' : (s.serviceDetails?.env || 'running'),
    region:    s.serviceDetails?.region,
    url:       s.serviceDetails?.url,
    branch:    s.serviceDetails?.branch || s.serviceDetails?.buildFilter?.branches?.[0],
    plan:      s.serviceDetails?.plan,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));
}

/**
 * Get details for a specific service.
 */
async function getService(serviceId) {
  const data = await renderAPI(`/services/${serviceId}`);
  return data.service || data;
}

/**
 * Trigger a manual deploy for a service.
 */
async function deploy(serviceId, clearCache = false) {
  return renderAPI(`/services/${serviceId}/deploys`, 'POST', { clearCache: clearCache ? 'cache' : 'do_not_clear' });
}

/**
 * List recent deploys for a service.
 */
async function listDeploys(serviceId, limit = 10) {
  const data = await renderAPI(`/services/${serviceId}/deploys?limit=${limit}`);
  return (data || []).map(d => d.deploy || d).map(d => ({
    id:        d.id,
    status:    d.status,
    commit:    d.commit?.message?.slice(0, 80),
    commitId:  d.commit?.id?.slice(0, 8),
    createdAt: d.createdAt,
    finishedAt: d.finishedAt,
  }));
}

/**
 * Get recent logs for a service.
 */
async function getLogs(serviceId, limit = 100) {
  const data = await renderAPI(`/services/${serviceId}/logs?limit=${limit}`);
  return (data.logs || []).map(l => ({
    timestamp: l.timestamp,
    level:     l.level,
    message:   l.message,
  }));
}

/**
 * Scale a service (change instance count for workers/private services).
 */
async function scale(serviceId, numInstances) {
  return renderAPI(`/services/${serviceId}/scale`, 'POST', { numInstances });
}

/**
 * Suspend a service.
 */
async function suspend(serviceId) {
  return renderAPI(`/services/${serviceId}/suspend`, 'POST');
}

/**
 * Resume a suspended service.
 */
async function resume(serviceId) {
  return renderAPI(`/services/${serviceId}/resume`, 'POST');
}

/**
 * Get environment variables for a service.
 */
async function getEnvVars(serviceId) {
  const data = await renderAPI(`/services/${serviceId}/env-vars`);
  return (data || []).map(e => e.envVar || e).map(e => ({ key: e.key, value: e.isSecret ? '[secret]' : e.value }));
}

/**
 * Update an environment variable for a service.
 */
async function setEnvVar(serviceId, key, value) {
  return renderAPI(`/services/${serviceId}/env-vars`, 'PUT', [{ key, value }]);
}

/**
 * Status check.
 */
async function status() {
  if (!RENDER_KEY) return { configured: false, hint: 'Add RENDER_API_KEY to .env' };
  try {
    const services = await listServices();
    return { configured: true, serviceCount: services.length, services: services.map(s => ({ name: s.name, status: s.status })) };
  } catch (err) {
    return { configured: true, error: err.message };
  }
}

module.exports = { listServices, getService, deploy, listDeploys, getLogs, scale, suspend, resume, getEnvVars, setEnvVar, status };

// backend/services/mcpRuntime.mjs
// Spawns stdio MCP servers, performs JSON-RPC handshake, tracks status in
// SQL. No auto-respawn — callers flip lifecycle explicitly via start/stop.
//
// Invariants:
//   - env for a child is built from process.env plus the decrypted fields
//     of every connector instance referenced by env_ref_ids_json (merged in
//     array order; later entries win).
//   - `status` is one of 'running' | 'stopped' | 'error'. status_detail
//     carries the most recent error message when present.
//   - Only one live child per row id; start() is a no-op if already running.

import { spawn } from 'node:child_process';
import { getFields } from './secretVault.mjs';
import * as mcpService from './mcpService.mjs';
import { writeAudit } from './connectorService.mjs';

// id -> { child, tools, pending: Map<rpcId, {resolve, reject}>, buffer: string, rpcId: number }
const procs = new Map();

function setStatus(db, id, status, detail) {
  db.prepare(
    'UPDATE mcp_servers SET status=?, status_detail=?' +
    (status === 'running' ? ', last_started=datetime(\'now\')' : '') +
    ' WHERE id=?'
  ).run(status, detail || null, id);
}

function setTools(db, id, tools) {
  db.prepare('UPDATE mcp_servers SET tools_json=? WHERE id=?')
    .run(JSON.stringify(tools || []), id);
}

function buildEnv(envRefIds) {
  const merged = { ...process.env };
  for (const refId of envRefIds || []) {
    const fields = getFields(refId) || {};
    for (const [k, v] of Object.entries(fields)) merged[k] = v;
  }
  return merged;
}

function attachStreams(entry) {
  const { child } = entry;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    entry.buffer += chunk;
    let idx;
    while ((idx = entry.buffer.indexOf('\n')) !== -1) {
      const line = entry.buffer.slice(0, idx).trim();
      entry.buffer = entry.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id != null && entry.pending.has(msg.id)) {
        const { resolve, reject } = entry.pending.get(msg.id);
        entry.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || 'rpc error'));
        else resolve(msg.result);
      }
    }
  });
}

function rpc(entry, method, params, timeoutMs = 5000) {
  const id = ++entry.rpcId;
  const payload = { jsonrpc: '2.0', id, method };
  if (params !== undefined) payload.params = params;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      entry.pending.delete(id);
      reject(new Error(`${method} timeout`));
    }, timeoutMs);
    entry.pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    entry.child.stdin.write(JSON.stringify(payload) + '\n');
  });
}

export async function start(db, id) {
  const row = mcpService.get(db, id);
  if (!row) throw new Error('NOT_FOUND');
  if (procs.has(id)) return { status: 'running' };

  if (row.transport !== 'stdio') {
    const msg = `unsupported transport: ${row.transport}`;
    setStatus(db, id, 'error', msg);
    throw new Error(msg);
  }
  if (!row.command) {
    const msg = 'missing command';
    setStatus(db, id, 'error', msg);
    throw new Error(msg);
  }

  const env = buildEnv(row.env_ref_ids);
  let child;
  try {
    child = spawn(row.command, row.args || [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    setStatus(db, id, 'error', e.message);
    throw e;
  }

  const entry = {
    child,
    pending: new Map(),
    buffer: '',
    rpcId: 0,
  };
  procs.set(id, entry);
  attachStreams(entry);

  // If the child exits before handshake completes, surface the error.
  const exitPromise = new Promise((_, reject) => {
    child.once('exit', (code, signal) => {
      procs.delete(id);
      if (code !== 0 && code !== null) {
        reject(new Error(`child exited with code ${code}${signal ? ` (${signal})` : ''}`));
      }
    });
    child.once('error', (err) => { procs.delete(id); reject(err); });
  });

  try {
    await Promise.race([
      rpc(entry, 'initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'alec', version: '2.0.0' },
        capabilities: {},
      }),
      exitPromise,
    ]);

    let tools = [];
    try {
      const res = await Promise.race([rpc(entry, 'tools/list', {}), exitPromise]);
      tools = res?.tools || [];
    } catch {
      // tools/list is optional; keep empty.
    }

    setTools(db, id, tools);
    setStatus(db, id, 'running', null);
    writeAudit(db, {
      userId: row.created_by, orgId: row.scope_type === 'org' ? row.scope_id : null,
      action: 'mcp.start', targetType: 'mcp', targetId: id,
    });
    return { status: 'running', tools };
  } catch (e) {
    // Clean up child on handshake failure.
    try { child.kill('SIGKILL'); } catch {}
    procs.delete(id);
    setStatus(db, id, 'error', e.message);
    throw e;
  }
}

export async function stop(db, id) {
  const row = mcpService.get(db, id);
  const entry = procs.get(id);
  if (!entry) {
    setStatus(db, id, 'stopped', null);
    return { status: 'stopped' };
  }

  const { child } = entry;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    child.once('exit', finish);
    try { child.kill('SIGTERM'); } catch { finish(); }
    setTimeout(() => {
      if (!done) {
        try { child.kill('SIGKILL'); } catch {}
        finish();
      }
    }, 5000);
  });

  procs.delete(id);
  setStatus(db, id, 'stopped', null);
  if (row) {
    writeAudit(db, {
      userId: row.created_by, orgId: row.scope_type === 'org' ? row.scope_id : null,
      action: 'mcp.stop', targetType: 'mcp', targetId: id,
    });
  }
  return { status: 'stopped' };
}

export async function test(db, id) {
  const row = mcpService.get(db, id);
  if (!row) throw new Error('NOT_FOUND');
  const wasRunning = procs.has(id);
  try {
    await start(db, id);
    const tools = mcpService.get(db, id).tools || [];
    if (!wasRunning) await stop(db, id);
    writeAudit(db, {
      userId: row.created_by, orgId: row.scope_type === 'org' ? row.scope_id : null,
      action: 'mcp.test', targetType: 'mcp', targetId: id,
    });
    return { ok: true, tools };
  } catch (e) {
    if (!wasRunning && procs.has(id)) await stop(db, id);
    writeAudit(db, {
      userId: row.created_by, orgId: row.scope_type === 'org' ? row.scope_id : null,
      action: 'mcp.test', targetType: 'mcp', targetId: id,
      metadata: { error: e.message },
    });
    return { ok: false, error: e.message };
  }
}

export function status(db, id) {
  const row = mcpService.get(db, id);
  if (!row) return null;
  return {
    id,
    status: row.status || 'stopped',
    status_detail: row.status_detail || null,
    tools: row.tools || [],
    last_started: row.last_started || null,
  };
}

export async function stopAll() {
  const ids = [...procs.keys()];
  for (const id of ids) {
    const entry = procs.get(id);
    if (!entry) continue;
    try { entry.child.kill('SIGKILL'); } catch {}
    procs.delete(id);
  }
}

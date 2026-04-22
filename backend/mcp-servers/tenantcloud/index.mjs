#!/usr/bin/env node
// backend/mcp-servers/tenantcloud/index.mjs
// Minimal JSON-RPC 2.0 MCP stdio server that exposes the TenantCloud
// executor's tool surface (open_dashboard, open_property, list_properties,
// screenshot). The parent mcpRuntime process injects the decrypted
// TENANTCLOUD_EMAIL / TENANTCLOUD_PASSWORD into env and sets
// ALEC_TENANTCLOUD_CONNECTOR_ID so the persistent browser profile lives in a
// stable per-connector directory.

import process from 'node:process';
import { createInterface } from 'node:readline';
import { TenantCloudExecutor, TOOLS } from '../../connectors/executors/tenantcloud.mjs';

const connectorId = process.env.ALEC_TENANTCLOUD_CONNECTOR_ID;
const email       = process.env.TENANTCLOUD_EMAIL;
const password    = process.env.TENANTCLOUD_PASSWORD;

if (!connectorId || !email || !password) {
  process.stderr.write(
    '[tenantcloud-mcp] missing ALEC_TENANTCLOUD_CONNECTOR_ID or credentials\n'
  );
  process.exit(2);
}

const executor = new TenantCloudExecutor({ connectorId, email, password });

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function dispatch(name, args) {
  switch (name) {
    case 'open_dashboard':  return executor.openDashboard();
    case 'open_property':   return executor.openProperty(args?.id);
    case 'list_properties': return executor.listProperties();
    case 'screenshot':      return executor.screenshot();
    default: throw new Error(`unknown tool: ${name}`);
  }
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'alec-tenantcloud', version: '1.0.0' },
    });
  }
  if (method === 'tools/list') return respond(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const out = await dispatch(params?.name, params?.arguments || {});
      return respond(id, {
        content: [{ type: 'text', text: JSON.stringify(out) }],
        structuredContent: out,
      });
    } catch (err) {
      return respondError(id, -32000, err.message);
    }
  }
  if (method === 'notifications/initialized' || method === 'ping') {
    if (id !== undefined) respond(id, {});
    return;
  }
  if (id !== undefined) respondError(id, -32601, `method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch {
    process.stderr.write(`[tenantcloud-mcp] parse error: ${trimmed}\n`);
    return;
  }
  handle(msg).catch(err => {
    process.stderr.write(`[tenantcloud-mcp] handler error: ${err.message}\n`);
  });
});

async function shutdown() {
  try { await executor.close(); } catch {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

#!/usr/bin/env node
// backend/mcp-servers/desktop-control/index.mjs — S7.8
// Local MCP stdio server that proxies the 9 desktop-control primitives to
// /api/desktop/actions/:primitive. Every call sets the X-ALEC-Via: 'mcp'
// header so audit rows are tagged correctly.
//
// This is intentionally a minimal JSON-RPC 2.0 server implementing the
// subset of MCP the end-to-end test exercises:
//   - initialize
//   - tools/list
//   - tools/call
//
// Transport: line-delimited JSON over stdin/stdout.

import process from 'node:process';
import { createInterface } from 'node:readline';

const PRIMITIVES = [
  'screen.capture',
  'screen.read_text',
  'mouse.click',
  'mouse.move',
  'keyboard.type',
  'keyboard.press',
  'applescript.run',
  'window.list',
  'window.focus',
];

const TOOL_DEFS = PRIMITIVES.map(name => ({
  name,
  description: `Invoke desktop primitive ${name}`,
  inputSchema: { type: 'object', additionalProperties: true },
}));

const BASE = process.env.ALEC_API_BASE || 'http://127.0.0.1:' + (process.env.PORT || 3000);
const TOKEN = process.env.ALEC_INTERNAL_TOKEN || '';

async function callPrimitive(name, args) {
  // Uses global fetch (Node 18+).
  const res = await fetch(`${BASE}/api/desktop/actions/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ALEC-Internal-Token': TOKEN,
      'X-ALEC-Via': 'mcp',
    },
    body: JSON.stringify(args || {}),
  });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text, status: res.status }; }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
function respondError(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return respond(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'alec-desktop-control', version: '1.0.0' },
    });
  }
  if (method === 'tools/list') {
    return respond(id, { tools: TOOL_DEFS });
  }
  if (method === 'tools/call') {
    const { name, arguments: args } = params || {};
    if (!PRIMITIVES.includes(name)) {
      return respondError(id, -32602, `unknown tool: ${name}`);
    }
    try {
      const out = await callPrimitive(name, args || {});
      return respond(id, {
        content: [{ type: 'text', text: JSON.stringify(out) }],
        structuredContent: out,
      });
    } catch (err) {
      return respondError(id, -32000, err.message);
    }
  }
  if (method === 'notifications/initialized' || method === 'ping') {
    // no-op / pong
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
    process.stderr.write(`[desktop-control-mcp] parse error: ${trimmed}\n`);
    return;
  }
  handle(msg).catch(err => {
    process.stderr.write(`[desktop-control-mcp] handler error: ${err.message}\n`);
  });
});

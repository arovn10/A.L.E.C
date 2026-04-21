#!/usr/bin/env node
// Minimal stdio MCP server for tests. Speaks newline-delimited JSON-RPC 2.0.
// Responds to `initialize` and `tools/list`. If env DUMMY_MCP_REQUIRE is set,
// exits nonzero when that env var is absent — useful for env-injection tests.

import readline from 'node:readline';

if (process.env.DUMMY_MCP_REQUIRE) {
  const needed = process.env.DUMMY_MCP_REQUIRE;
  if (!process.env[needed]) {
    process.stderr.write(`missing required env ${needed}\n`);
    process.exit(2);
  }
}

const tools = [];
if (process.env.DUMMY_MCP_TOOLS) {
  try { tools.push(...JSON.parse(process.env.DUMMY_MCP_TOOLS)); } catch {}
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'dummy-mcp', version: '0.0.0' },
        capabilities: { tools: {} },
      },
    });
  } else if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools } });
  } else if (msg.method === 'shutdown') {
    send({ jsonrpc: '2.0', id: msg.id, result: null });
    process.exit(0);
  }
});

// Keep process alive while stdin is open.
process.stdin.resume();

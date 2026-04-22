// tests/integration/desktop-mcp.test.mjs — S7.9
// Spawns the desktop-control MCP stdio server, drives it with JSON-RPC,
// points it at a local test express app mounted on an ephemeral loopback
// port, and verifies:
//   1. tools/list returns 9 primitives.
//   2. tools/call window.list proxies to /api/desktop/actions/window.list.
//   3. audit row has via='mcp'.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import Database from 'better-sqlite3';
import pkg from '../../backend/auth/bootstrap.js';
const { runMigrations } = pkg;
import { desktopRouter } from '../../backend/routes/desktop.mjs';
import * as policy from '../../backend/services/desktopPolicy.mjs';
import * as control from '../../backend/services/desktopControl.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');
const SERVER_PATH = path.resolve(__dirname, '../../backend/mcp-servers/desktop-control/index.mjs');

async function startTestApi() {
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  // Auto-allow all calls without modal prompt.
  policy.setPolicy(db, 'u', { mode: 'auto_reads' });
  control.setApprover(async () => ({ approved: true }));

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { email: 'u@x' }; next(); });
  app.use('/api/desktop', desktopRouter(() => db));

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve({ server, db, port: server.address().port });
    });
  });
}

function rpc(child, id, method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
}

function waitForId(child, id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const to = setTimeout(() => reject(new Error('timeout waiting for id=' + id)), timeoutMs);
    const onData = (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(to);
            child.stdout.off('data', onData);
            resolve(msg);
            return;
          }
        } catch { /* skip */ }
      }
    };
    child.stdout.on('data', onData);
  });
}

describe('desktop-control MCP server', () => {
  let api, child, origToken;
  beforeAll(async () => {
    api = await startTestApi();
    origToken = process.env.ALEC_INTERNAL_TOKEN;
    process.env.ALEC_INTERNAL_TOKEN = 'mcp-test-token';
    child = spawn(process.execPath, [SERVER_PATH], {
      env: {
        ...process.env,
        ALEC_API_BASE: `http://127.0.0.1:${api.port}`,
        ALEC_INTERNAL_TOKEN: 'mcp-test-token',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Drain stderr so it doesn't fill up the pipe.
    child.stderr.on('data', () => {});
  });

  afterAll(async () => {
    try { child.kill('SIGTERM'); } catch {}
    await new Promise(r => api.server.close(r));
    if (origToken === undefined) delete process.env.ALEC_INTERNAL_TOKEN;
    else process.env.ALEC_INTERNAL_TOKEN = origToken;
  });

  test('initialize + tools/list returns 9 primitives', async () => {
    rpc(child, 1, 'initialize', {});
    const init = await waitForId(child, 1);
    expect(init.result.serverInfo.name).toBe('alec-desktop-control');

    rpc(child, 2, 'tools/list', {});
    const list = await waitForId(child, 2);
    expect(list.result.tools).toHaveLength(9);
    expect(list.result.tools.map(t => t.name)).toEqual(expect.arrayContaining([
      'screen.capture', 'window.list', 'keyboard.type',
    ]));
  });

  test('tools/call window.list proxies and audit tags via=mcp', async () => {
    rpc(child, 3, 'tools/call', { name: 'window.list', arguments: {} });
    const res = await waitForId(child, 3, 10_000);
    expect(res.result).toBeTruthy();
    // Give audit row time to settle (synchronous in our impl, but just in case)
    const row = api.db.prepare(
      "SELECT * FROM audit_log WHERE action='desktop.window.list' ORDER BY id DESC LIMIT 1"
    ).get();
    expect(row).toBeTruthy();
    const meta = JSON.parse(row.metadata_json);
    expect(meta.via).toBe('mcp');
  });
});

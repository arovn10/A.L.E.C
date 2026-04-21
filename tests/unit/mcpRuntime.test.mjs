// tests/unit/mcpRuntime.test.mjs — S4.1 spawn/stop/test for MCP runtime.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import pkg from '../../backend/auth/bootstrap.js';
const { runMigrations } = pkg;
import { up as seedUp } from '../../backend/migrations/002_seed_migration.mjs';
import * as connectorService from '../../backend/services/connectorService.mjs';
import * as mcpService from '../../backend/services/mcpService.mjs';
import * as mcpRuntime from '../../backend/services/mcpRuntime.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIG_DIR = path.resolve(__dirname, '../../backend/migrations');
const DUMMY = path.resolve(__dirname, 'fixtures/dummy-mcp-server.mjs');

async function freshDb() {
  const vault = `/tmp/mcp-rt-vault-${crypto.randomBytes(4).toString('hex')}.json`;
  process.env.ALEC_VAULT_PATH = vault;
  process.env.ALEC_VAULT_KEY = 'a'.repeat(64);
  try { fs.unlinkSync(vault); } catch {}
  const db = new Database(':memory:');
  await runMigrations(db, MIG_DIR);
  await seedUp(db);
  return db;
}

describe('mcpRuntime.start/stop/test', () => {
  afterEach(async () => {
    // Best-effort: kill any leftover children.
    await mcpRuntime.stopAll?.();
  });

  test('start -> handshake -> tools list; stop transitions to stopped', async () => {
    const db = await freshDb();
    const row = mcpService.create(db, {
      name: 'dummy', scope: 'user', scopeId: 'arovner@stoagroup.com',
      transport: 'stdio', command: process.execPath, args: [DUMMY],
      envRefIds: [], createdBy: 'arovner@stoagroup.com',
    });

    const started = await mcpRuntime.start(db, row.id);
    expect(started.status).toBe('running');
    const rowAfterStart = mcpService.get(db, row.id);
    expect(rowAfterStart.status).toBe('running');
    expect(Array.isArray(rowAfterStart.tools)).toBe(true);

    const stopped = await mcpRuntime.stop(db, row.id);
    expect(stopped.status).toBe('stopped');
    expect(mcpService.get(db, row.id).status).toBe('stopped');
  });

  test('tools persisted when server advertises them', async () => {
    const db = await freshDb();
    const row = mcpService.create(db, {
      name: 'tooly', scope: 'user', scopeId: 'arovner@stoagroup.com',
      transport: 'stdio', command: process.execPath, args: [DUMMY],
      envRefIds: [], createdBy: 'arovner@stoagroup.com',
    });
    process.env.DUMMY_MCP_TOOLS = JSON.stringify([{ name: 'echo' }]);
    // Set env via env_ref_ids wouldn't pick up process.env — this test simply
    // confirms the runtime caches whatever the child advertises.
    await mcpRuntime.start(db, row.id);
    const after = mcpService.get(db, row.id);
    delete process.env.DUMMY_MCP_TOOLS;
    expect(after.tools.map(t => t.name)).toContain('echo');
    await mcpRuntime.stop(db, row.id);
  });

  test('env from env_ref_ids is injected into child process', async () => {
    const db = await freshDb();
    // Create a connector instance with a DUMMY_MCP_REQUIRE -> value.
    const inst = connectorService.create(db, {
      definitionId: 'github', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: { GITHUB_TOKEN: 'ghp_injected' },
      displayName: 'gh', createdBy: 'arovner@stoagroup.com',
    });

    const row = mcpService.create(db, {
      name: 'needs-env', scope: 'user', scopeId: 'arovner@stoagroup.com',
      transport: 'stdio', command: process.execPath, args: [DUMMY],
      envRefIds: [inst.id], createdBy: 'arovner@stoagroup.com',
    });

    // Dummy will exit(2) if GITHUB_TOKEN env is missing.
    process.env.DUMMY_MCP_REQUIRE = 'GITHUB_TOKEN';
    const started = await mcpRuntime.start(db, row.id);
    delete process.env.DUMMY_MCP_REQUIRE;
    expect(started.status).toBe('running');
    await mcpRuntime.stop(db, row.id);
  });

  test('non-stdio transport yields status=error, no child spawned', async () => {
    const db = await freshDb();
    const row = mcpService.create(db, {
      name: 'http-unsupported', scope: 'user', scopeId: 'arovner@stoagroup.com',
      transport: 'http', url: 'http://example.test/mcp',
      envRefIds: [], createdBy: 'arovner@stoagroup.com',
    });
    await expect(mcpRuntime.start(db, row.id)).rejects.toThrow(/unsupported/i);
    expect(mcpService.get(db, row.id).status).toBe('error');
  });

  test('test() starts, caches tools, stops again', async () => {
    const db = await freshDb();
    const row = mcpService.create(db, {
      name: 'probe', scope: 'user', scopeId: 'arovner@stoagroup.com',
      transport: 'stdio', command: process.execPath, args: [DUMMY],
      envRefIds: [], createdBy: 'arovner@stoagroup.com',
    });
    const res = await mcpRuntime.test(db, row.id);
    expect(res.ok).toBe(true);
    const after = mcpService.get(db, row.id);
    expect(after.status).toBe('stopped');
    expect(Array.isArray(after.tools)).toBe(true);
  });
});

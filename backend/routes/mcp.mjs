// backend/routes/mcp.mjs
// /api/mcp — skeleton CRUD routes. Runtime (start/stop/test) returns 501
// NOT_IMPLEMENTED in S2; the process lifecycle ships in S4.

import { Router } from 'express';
import { z } from 'zod';
import * as svc from '../services/mcpService.mjs';
import * as runtime from '../services/mcpRuntime.mjs';

const CreateBody = z.object({
  name: z.string().min(1),
  scope: z.enum(['user', 'org']),
  scopeId: z.string().min(1),
  transport: z.enum(['stdio', 'http', 'sse', 'websocket']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  envRefIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  autoStart: z.boolean().optional(),
});

const PatchBody = z.object({
  name: z.string().optional(),
  transport: z.enum(['stdio', 'http', 'sse', 'websocket']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  envRefIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  autoStart: z.boolean().optional(),
});

export function mcpRouter(getDb) {
  const r = Router();

  // Curated MCP directory — see backend/routes/mcpCatalog.mjs.
  // Returns { entries, categories } so the Discover sidebar can render
  // counts-per-category without a second round-trip.
  r.get('/catalog', (_req, res) => {
    // Lazy-require to keep route construction cheap for tests that
    // don't touch this endpoint.
    import('./mcpCatalog.mjs').then(({ MCP_CATALOG, categoriesOf }) => {
      res.json({ entries: MCP_CATALOG, categories: categoriesOf(MCP_CATALOG) });
    }).catch((e) => {
      console.error('[mcp:catalog]', e.message);
      res.status(500).json({ error: 'CATALOG_LOAD_FAILED' });
    });
  });

  r.get('/', (req, res) => {
    res.json(svc.listVisible(getDb(), req.user.email));
  });

  r.post('/', (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID', issues: parsed.error.issues });
    const db = getDb();
    const { scope, scopeId } = parsed.data;
    if (scope === 'user' && scopeId !== req.user.email) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    if (scope === 'org') {
      const m = db.prepare(
        'SELECT role FROM org_memberships WHERE user_id=? AND org_id=?'
      ).get(req.user.email, scopeId);
      if (!m || !['admin', 'owner'].includes(m.role)) {
        return res.status(403).json({ error: 'FORBIDDEN' });
      }
    }
    try {
      const row = svc.create(db, { ...parsed.data, createdBy: req.user.email });
      res.status(201).json(row);
    } catch (e) {
      if (e.message === 'INVALID_TRANSPORT') return res.status(400).json({ error: 'INVALID_TRANSPORT' });
      throw e;
    }
  });

  r.get('/:id', (req, res) => {
    const db = getDb();
    const row = svc.get(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    const mems = db.prepare('SELECT org_id FROM org_memberships WHERE user_id=?')
      .all(req.user.email).map(m => m.org_id);
    const visible = (row.scope_type === 'user' && row.scope_id === req.user.email)
      || (row.scope_type === 'org' && mems.includes(row.scope_id));
    if (!visible) return res.status(403).json({ error: 'FORBIDDEN' });
    res.json(row);
  });

  r.patch('/:id', (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID', issues: parsed.error.issues });
    try {
      res.json(svc.update(getDb(), req.params.id, req.user.email, parsed.data));
    } catch (e) {
      if (e.message === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND' });
      if (e.message === 'FORBIDDEN') return res.status(403).json({ error: 'FORBIDDEN' });
      throw e;
    }
  });

  r.delete('/:id', (req, res) => {
    try {
      svc.remove(getDb(), req.params.id, req.user.email);
      res.status(204).end();
    } catch (e) {
      if (e.message === 'FORBIDDEN') return res.status(403).json({ error: 'FORBIDDEN' });
      throw e;
    }
  });

  // Runtime endpoints — wired to mcpRuntime in S4.2.
  function requireWrite(req, res) {
    const db = getDb();
    const row = svc.get(db, req.params.id);
    if (!row) { res.status(404).json({ error: 'NOT_FOUND' }); return null; }
    if (!svc.canWrite(db, req.user.email, row)) {
      res.status(403).json({ error: 'FORBIDDEN' }); return null;
    }
    return { db, row };
  }

  r.post('/:id/start', async (req, res) => {
    const ctx = requireWrite(req, res); if (!ctx) return;
    try {
      const result = await runtime.start(ctx.db, req.params.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'START_FAILED', message: e.message });
    }
  });

  r.post('/:id/stop', async (req, res) => {
    const ctx = requireWrite(req, res); if (!ctx) return;
    try {
      const result = await runtime.stop(ctx.db, req.params.id);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'STOP_FAILED', message: e.message });
    }
  });

  r.post('/:id/test', async (req, res) => {
    const ctx = requireWrite(req, res); if (!ctx) return;
    const result = await runtime.test(ctx.db, req.params.id);
    res.json(result);
  });

  r.get('/:id/status', (req, res) => {
    const db = getDb();
    const row = svc.get(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    const mems = db.prepare('SELECT org_id FROM org_memberships WHERE user_id=?')
      .all(req.user.email).map(m => m.org_id);
    const visible = (row.scope_type === 'user' && row.scope_id === req.user.email)
      || (row.scope_type === 'org' && mems.includes(row.scope_id));
    if (!visible) return res.status(403).json({ error: 'FORBIDDEN' });
    res.json(runtime.status(db, req.params.id));
  });

  r.get('/:id/tools', (req, res) => {
    const db = getDb();
    const row = svc.get(db, req.params.id);
    if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
    const mems = db.prepare('SELECT org_id FROM org_memberships WHERE user_id=?')
      .all(req.user.email).map(m => m.org_id);
    const visible = (row.scope_type === 'user' && row.scope_id === req.user.email)
      || (row.scope_type === 'org' && mems.includes(row.scope_id));
    if (!visible) return res.status(403).json({ error: 'FORBIDDEN' });
    res.json({ tools: row.tools || [] });
  });

  return r;
}

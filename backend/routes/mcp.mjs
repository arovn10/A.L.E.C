// backend/routes/mcp.mjs
// /api/mcp — skeleton CRUD routes. Runtime (start/stop/test) returns 501
// NOT_IMPLEMENTED in S2; the process lifecycle ships in S4.

import { Router } from 'express';
import { z } from 'zod';
import * as svc from '../services/mcpService.mjs';

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

  // Catalog stub — returns empty until curated MCP directory lands (S6).
  r.get('/catalog', (_req, res) => res.json([]));

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

  // Runtime endpoints — stubbed for S2.
  r.post('/:id/start', (_req, res) => res.status(501).json({ error: 'NOT_IMPLEMENTED' }));
  r.post('/:id/stop',  (_req, res) => res.status(501).json({ error: 'NOT_IMPLEMENTED' }));
  r.post('/:id/test',  (_req, res) => res.status(501).json({ error: 'NOT_IMPLEMENTED' }));

  return r;
}

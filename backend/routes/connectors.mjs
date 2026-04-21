// backend/routes/connectors.mjs
// /api/connectors — CRUD + test + reveal over connector_instances.
// Every write path passes through connectorService (which writes audit).
// Feature-gated by the caller (server.js mounts only when ALEC_CONNECTORS_V2=1).

import { Router } from 'express';
import { z } from 'zod';
import * as svc from '../services/connectorService.mjs';
import { CATALOG } from '../connectors/catalog.mjs';
import { requireConnectorWrite } from '../middleware/requireConnectorWrite.mjs';

const CreateBody = z.object({
  definitionId: z.string().min(1),
  scope: z.enum(['user', 'org']),
  scopeId: z.string().min(1),
  fields: z.record(z.string()),
  displayName: z.string().optional(),
});

const PatchBody = z.object({
  fields: z.record(z.string()).optional(),
  displayName: z.string().optional(),
  enabled: z.boolean().optional(),
});

// S5.3 — reassign a connector between user/org scopes. Target scope must be
// one the caller can write to (own user email or an org where they're
// admin/owner); source scope is checked via connectorService.canWrite.
const MoveBody = z.object({
  scope: z.enum(['user', 'org']),
  scopeId: z.string().min(1),
});

// In-memory token bucket for /reveal — 10 requests per rolling hour per user.
// Intentionally process-local: S2 ships a single-node API; a shared store
// can come later if we cluster.
const revealHits = new Map();
const REVEAL_WINDOW_MS = 3600_000;
const REVEAL_LIMIT = 10;

export function connectorsRouter(getDb) {
  const r = Router();

  r.get('/catalog', (_req, res) => {
    // Strip `secret:true` flags — clients only need the shape to build forms.
    res.json(CATALOG);
  });

  r.get('/', (req, res) => {
    const db = getDb();
    let rows = svc.listVisible(db, req.user.email);
    if (req.query.orgId) {
      rows = rows.filter(x => x.scope_type === 'org' && x.scope_id === req.query.orgId);
    }
    if (req.query.scope === 'user') {
      rows = rows.filter(x => x.scope_type === 'user');
    } else if (req.query.scope === 'org') {
      rows = rows.filter(x => x.scope_type === 'org');
    }
    res.json(rows.map(x => svc.get(db, x.id, req.user.email)));
  });

  r.post('/', (req, res) => {
    const parsed = CreateBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID', issues: parsed.error.issues });
    const db = getDb();
    const { scope, scopeId } = parsed.data;
    // Scope authorization — user scope must match caller; org scope needs admin/owner.
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
      const inst = svc.create(db, { ...parsed.data, createdBy: req.user.email });
      res.status(201).json(inst);
    } catch (e) {
      if (e.message === 'ORG_ONLY')          return res.status(400).json({ error: 'ORG_ONLY' });
      if (e.message === 'UNKNOWN_DEFINITION') return res.status(400).json({ error: 'UNKNOWN_DEFINITION' });
      throw e;
    }
  });

  r.get('/:id', (req, res) => {
    const db = getDb();
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(req.params.id);
    if (!inst) return res.status(404).json({ error: 'NOT_FOUND' });
    const mems = db.prepare('SELECT org_id FROM org_memberships WHERE user_id=?')
      .all(req.user.email).map(m => m.org_id);
    const visible = (inst.scope_type === 'user' && inst.scope_id === req.user.email)
      || (inst.scope_type === 'org' && mems.includes(inst.scope_id));
    if (!visible) return res.status(403).json({ error: 'FORBIDDEN' });
    res.json(svc.get(db, req.params.id, req.user.email));
  });

  r.patch('/:id', requireConnectorWrite(getDb), (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID', issues: parsed.error.issues });
    res.json(svc.update(getDb(), req.params.id, req.user.email, parsed.data));
  });

  r.delete('/:id', requireConnectorWrite(getDb), (req, res) => {
    svc.remove(getDb(), req.params.id, req.user.email);
    res.status(204).end();
  });

  r.post('/:id/test', requireConnectorWrite(getDb), async (req, res) => {
    try {
      const result = await svc.testInstance(getDb(), req.params.id, req.user.email);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'TEST_FAILED', detail: e.message });
    }
  });

  r.post('/:id/reveal', requireConnectorWrite(getDb), (req, res) => {
    const now = Date.now();
    const arr = (revealHits.get(req.user.email) || []).filter(t => now - t < REVEAL_WINDOW_MS);
    if (arr.length >= REVEAL_LIMIT) {
      return res.status(429).json({ error: 'RATE_LIMITED' });
    }
    arr.push(now);
    revealHits.set(req.user.email, arr);
    const db = getDb();
    // Audit write happens *before* the response body goes out so a crashed
    // client can't escape the paper trail.
    svc.writeAudit(db, {
      userId: req.user.email,
      orgId: req.connectorInstance.scope_type === 'org' ? req.connectorInstance.scope_id : null,
      action: 'connector.reveal', targetType: 'connector', targetId: req.params.id,
    });
    res.json(svc.get(db, req.params.id, req.user.email, { reveal: true }));
  });

  r.post('/:id/move', (req, res) => {
    const db = getDb();
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(req.params.id);
    if (!inst) return res.status(404).json({ error: 'NOT_FOUND' });
    if (!svc.canWrite(db, req.user.email, inst)) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    const parsed = MoveBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID', issues: parsed.error.issues });
    const { scope, scopeId } = parsed.data;

    // Target scope ACL — match the create-path rules exactly.
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

    db.prepare(
      `UPDATE connector_instances
         SET scope_type = ?, scope_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(scope, scopeId, req.params.id);

    svc.writeAudit(db, {
      userId: req.user.email,
      orgId: scope === 'org' ? scopeId : null,
      action: 'connector.move',
      targetType: 'connector',
      targetId: req.params.id,
      metadata: {
        from: { scope_type: inst.scope_type, scope_id: inst.scope_id },
        to:   { scope_type: scope,           scope_id: scopeId },
      },
    });
    res.json(svc.get(db, req.params.id, req.user.email));
  });

  return r;
}

// Test-only helper — clears the /reveal bucket between jest cases.
export function __resetRevealBucket() { revealHits.clear(); }

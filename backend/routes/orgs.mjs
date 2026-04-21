// backend/routes/orgs.mjs
// /api/orgs — list the caller's organizations, and (for owners) CRUD
// memberships. Every mutation writes an audit_log row so the admin UI and
// compliance reports have a paper trail.

import { Router } from 'express';
import { z } from 'zod';
import { requireOrgRole } from '../middleware/requireOrgRole.mjs';
import { writeAudit } from '../services/connectorService.mjs';

const AddBody = z.object({
  userId: z.string().email(),
  role: z.enum(['member', 'admin', 'owner']),
});

const PatchBody = z.object({
  role: z.enum(['member', 'admin', 'owner']),
});

export function orgsRouter(getDb) {
  const r = Router();

  r.get('/', (req, res) => {
    const db = getDb();
    const rows = db.prepare(
      `SELECT o.* FROM organizations o
         JOIN org_memberships m ON m.org_id = o.id
        WHERE m.user_id = ?
        ORDER BY o.id`
    ).all(req.user.email);
    res.json(rows);
  });

  r.get('/:id/members', requireOrgRole(getDb, ['owner', 'admin']), (req, res) => {
    const db = getDb();
    const rows = db.prepare(
      'SELECT user_id, role, created_at FROM org_memberships WHERE org_id=? ORDER BY user_id'
    ).all(req.params.id);
    res.json(rows);
  });

  r.post('/:id/members', requireOrgRole(getDb, ['owner']), (req, res) => {
    const parsed = AddBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID', issues: parsed.error.issues });
    const db = getDb();
    db.prepare(
      'INSERT OR REPLACE INTO org_memberships(user_id, org_id, role) VALUES (?, ?, ?)'
    ).run(parsed.data.userId, req.params.id, parsed.data.role);
    writeAudit(db, {
      userId: req.user.email, orgId: req.params.id,
      action: 'org.member.add', targetType: 'user', targetId: parsed.data.userId,
      metadata: { role: parsed.data.role },
    });
    res.status(201).json({ userId: parsed.data.userId, role: parsed.data.role, orgId: req.params.id });
  });

  r.patch('/:id/members/:userId', requireOrgRole(getDb, ['owner']), (req, res) => {
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'INVALID', issues: parsed.error.issues });
    const db = getDb();
    const result = db.prepare(
      'UPDATE org_memberships SET role=? WHERE org_id=? AND user_id=?'
    ).run(parsed.data.role, req.params.id, req.params.userId);
    if (result.changes === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    writeAudit(db, {
      userId: req.user.email, orgId: req.params.id,
      action: 'org.member.update', targetType: 'user', targetId: req.params.userId,
      metadata: { role: parsed.data.role },
    });
    res.json({ userId: req.params.userId, role: parsed.data.role });
  });

  r.delete('/:id/members/:userId', requireOrgRole(getDb, ['owner']), (req, res) => {
    const db = getDb();
    db.prepare('DELETE FROM org_memberships WHERE org_id=? AND user_id=?')
      .run(req.params.id, req.params.userId);
    writeAudit(db, {
      userId: req.user.email, orgId: req.params.id,
      action: 'org.member.remove', targetType: 'user', targetId: req.params.userId,
    });
    res.status(204).end();
  });

  return r;
}

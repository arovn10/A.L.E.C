// backend/routes/desktop.mjs — S7.5
// /api/desktop/* — loopback-locked (no remote control, ever).
// All write paths flow through desktopControl.execute() so audit + policy
// are guaranteed to fire regardless of caller.

import { Router } from 'express';
import { z } from 'zod';
import * as policy from '../services/desktopPolicy.mjs';
import * as control from '../services/desktopControl.mjs';
import * as perms from '../services/desktopPermissions.mjs';

function isLoopback(req) {
  const ip = req.ip || req.connection?.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function requireLoopback(req, res, next) {
  if (!isLoopback(req)) {
    return res.status(403).json({ error: 'loopback-only' });
  }
  next();
}

function requireInternalToken(req, res, next) {
  const expected = process.env.ALEC_INTERNAL_TOKEN;
  const provided = req.get('X-ALEC-Internal-Token');
  const okIp = isLoopback(req);
  if (!okIp) return res.status(403).json({ error: 'loopback-only' });
  if (expected && provided !== expected) {
    return res.status(403).json({ error: 'bad-internal-token' });
  }
  next();
}

const PolicyPatch = z.object({
  mode: z.enum(['always_ask', 'session', 'auto_reads']).optional(),
  kill_switch: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
});

export function desktopRouter(getDb) {
  const r = Router();

  // All desktop routes are loopback-only.
  r.use(requireLoopback);

  // GET /status — composite snapshot for the Settings tab.
  r.get('/status', (req, res) => {
    const db = getDb();
    const p = policy.getPolicy(db);
    const permissions = perms.getAll(db);
    res.json({
      permissions,
      policy: { mode: p.mode, updated_at: p.updated_at, updated_by: p.updated_by },
      kill_switch: p.kill_switch,
      active_session: !!(p.session_token && new Date(p.session_expires_at).getTime() > Date.now()),
      session_expires_at: p.session_expires_at || null,
    });
  });

  // POST /permissions/probe — native shell probes.
  r.post('/permissions/probe', async (req, res) => {
    const db = getDb();
    const out = await perms.probeAll(db);
    res.json({ permissions: out });
  });

  // POST /permissions/request/:id — open System Settings deep link. On the
  // backend side we simply record intent; the Electron bridge is what opens
  // the actual pane. We reject unknown IDs.
  r.post('/permissions/request/:id', (req, res) => {
    const { id } = req.params;
    if (!['accessibility', 'screen_recording', 'automation'].includes(id)) {
      return res.status(400).json({ error: 'unknown-permission' });
    }
    const DEEPLINK = {
      accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
      screen_recording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
    };
    res.json({ deeplink: DEEPLINK[id] });
  });

  // PATCH /policy — update mode and/or kill_switch.
  r.patch('/policy', (req, res) => {
    const parsed = PolicyPatch.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: 'invalid-body' });
    const db = getDb();
    const userId = req.user?.email || 'system';
    const next = policy.setPolicy(db, userId, parsed.data);
    res.json({ policy: next });
  });

  // POST /session/start
  r.post('/session/start', (req, res) => {
    const db = getDb();
    const userId = req.user?.email || 'system';
    const { token, expiresAt } = policy.startSession(db, userId);
    res.json({ token, expires_at: expiresAt });
  });

  // POST /session/end
  r.post('/session/end', (req, res) => {
    const db = getDb();
    const userId = req.user?.email || 'system';
    policy.endSession(db, userId);
    res.json({ ok: true });
  });

  // POST /actions/:primitive — internal-only. Invoked by ALEC's agent or by
  // the desktop-control MCP server. Requires ALEC_INTERNAL_TOKEN header.
  r.post('/actions/:primitive', requireInternalToken, async (req, res) => {
    const db = getDb();
    const { primitive } = req.params;
    const via = req.get('X-ALEC-Via') || 'http';
    const userId = req.user?.email || 'system';
    const result = await control.execute(db, primitive, req.body || {}, { userId, via });
    res.json(result);
  });

  // GET /audit?limit=50
  r.get('/audit', (req, res) => {
    const db = getDb();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
    const rows = db.prepare(
      `SELECT id, user_id, action, target_id, metadata_json, created_at
       FROM audit_log
       WHERE action LIKE 'desktop.%'
       ORDER BY id DESC
       LIMIT ?`
    ).all(limit);
    res.json({ audit: rows });
  });

  return r;
}

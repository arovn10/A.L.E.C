/**
 * backend/auth/routes.js — Sprint 1
 *
 * Mounts at /api/auth/*  and  /api/admin/*
 *
 *   POST /api/auth/login             {email,password}        → {access,refresh}
 *   POST /api/auth/refresh           {refresh}               → {access,refresh}
 *   POST /api/auth/logout            (Bearer)                → {ok}
 *   POST /api/auth/accept-invite     {token,password,fullName} → {access,refresh}
 *   POST /api/auth/claim-master      {password}              → {ok}  // one-time, only if Master.PasswordHash='UNCLAIMED'
 *   GET  /api/auth/me                (Bearer)                → {user}
 *
 *   POST /api/admin/invites          (Admin+) {email,role,scopes[]} → {inviteUrl,expiresAt}
 *   GET  /api/admin/users            (Admin+)                → [users]
 *   POST /api/admin/users/:id/suspend (Admin+)               → {ok}
 *   POST /api/admin/users/:id/scope  (Admin+) {type,value,op} → {ok}
 *
 * All handlers write to alec.AuditLog before responding (Hard-rule H12).
 */
'use strict';

const crypto = require('crypto');
const express = require('express');

const repo = require('./repo');
const password = require('./password');
const tokens = require('./tokens');
const roles = require('./roles');
const mw = require('./middleware');

const router = express.Router();

// ── Simple in-proc rate limiter (5 attempts / 15 min / IP) ───────
// Localhost is exempt — the owner must never be locked out of their own
// machine while debugging. Remote IPs are still throttled.
const loginAttempts = new Map(); // ip → [timestamps]
function isLocalIp(ip, hostname) {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || hostname === 'localhost';
}
function tooManyLogins(req) {
  if (isLocalIp(req.ip, req.hostname)) return false;
  const ip = req.ip;
  const now = Date.now();
  const arr = (loginAttempts.get(ip) || []).filter(t => now - t < 15 * 60_000);
  arr.push(now); loginAttempts.set(ip, arr);
  return arr.length > 5;
}
function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

function meta(req) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] || '' };
}

// ── POST /api/auth/login ─────────────────────────────────────────
router.post('/auth/login', async (req, res) => {
  const { email, password: pw, deviceLabel } = req.body || {};
  if (!email || !pw) return res.status(400).json({ error: 'email and password required' });
  if (tooManyLogins(req)) {
    await repo.audit({ actorEmail: email, action: 'login.ratelimit', ...meta(req) });
    return res.status(429).json({ error: 'Too many attempts, try again later' });
  }
  const user = await repo.findUserByEmail(email);
  if (!user || user.Suspended) {
    await repo.audit({ actorEmail: email, action: 'login.fail', target: 'no-user-or-suspended', ...meta(req) });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.PasswordHash === 'UNCLAIMED') {
    return res.status(409).json({ error: 'Account not yet claimed', hint: 'Use /api/auth/claim-master or accept invite' });
  }
  const ok = await password.verify(pw, user.PasswordHash);
  if (!ok) {
    await repo.audit({ userId: user.UserId, actorEmail: email, action: 'login.fail', target: 'bad-password', ...meta(req) });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const refresh = tokens.newRefresh();
  const sessionId = await repo.createSession({
    userId: user.UserId, refreshHash: refresh.hash, deviceLabel, expiresAt: refresh.expiresAt,
  });
  const access = tokens.signAccess({ userId: user.UserId, email: user.Email, role: user.Role, sessionId });
  await repo.touchLastLogin(user.UserId);
  clearLoginAttempts(req.ip); // reset throttle on successful auth
  await repo.audit({ userId: user.UserId, actorEmail: email, action: 'login.ok', target: sessionId, ...meta(req) });
  res.json({
    access, refresh: refresh.raw,
    user: { userId: user.UserId, email: user.Email, fullName: user.FullName, role: user.Role },
    expiresInSec: tokens.ACCESS_TTL_SECONDS,
  });
});

// ── POST /api/auth/refresh ───────────────────────────────────────
// Rotation-on-use with reuse detection.
router.post('/auth/refresh', async (req, res) => {
  const { refresh } = req.body || {};
  if (!refresh) return res.status(400).json({ error: 'refresh required' });
  const row = await repo.findSessionByRefresh(tokens.hashRefresh(refresh));
  if (!row) {
    await repo.audit({ action: 'refresh.unknown', ...meta(req) });
    return res.status(401).json({ error: 'Invalid refresh' });
  }
  if (row.RevokedAt) {
    // Reuse of a revoked token = compromise signal. Revoke all sessions.
    await repo.revokeAllSessionsForUser(row.UserId);
    await repo.audit({ userId: row.UserId, action: 'refresh.reuse', target: row.SessionId, ...meta(req) });
    return res.status(401).json({ error: 'Token reuse detected; all sessions revoked' });
  }
  if (new Date(row.ExpiresAt) < new Date()) {
    await repo.revokeSession(row.SessionId);
    return res.status(401).json({ error: 'Refresh expired' });
  }
  const user = await repo.findUserById(row.UserId);
  if (!user || user.Suspended) return res.status(403).json({ error: 'Account unavailable' });

  const next = tokens.newRefresh();
  await repo.rotateSessionRefresh(row.SessionId, next.hash, next.expiresAt);
  const access = tokens.signAccess({ userId: user.UserId, email: user.Email, role: user.Role, sessionId: row.SessionId });
  res.json({ access, refresh: next.raw, expiresInSec: tokens.ACCESS_TTL_SECONDS });
});

// ── POST /api/auth/logout ────────────────────────────────────────
router.post('/auth/logout', mw.authenticate, async (req, res) => {
  // The access JWT carries the sid claim; we revoke that session.
  const hdr = req.headers['authorization'];
  const claims = tokens.verifyAccess(hdr.slice(7));
  await repo.revokeSession(claims.sid);
  mw.bustCache(req.user.userId);
  await repo.audit({ userId: req.user.userId, actorEmail: req.user.email, action: 'logout', target: claims.sid, ...meta(req) });
  res.json({ ok: true });
});

// ── POST /api/auth/accept-invite ─────────────────────────────────
router.post('/auth/accept-invite', async (req, res) => {
  const { token, password: pw, fullName } = req.body || {};
  if (!token || !pw || !fullName) return res.status(400).json({ error: 'token, password, fullName required' });
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const inv = await repo.findInviteByTokenHash(tokenHash);
  if (!inv) return res.status(404).json({ error: 'Invalid invite' });
  if (inv.ConsumedAt) return res.status(410).json({ error: 'Invite already used' });
  if (new Date(inv.ExpiresAt) < new Date()) return res.status(410).json({ error: 'Invite expired' });

  const hash = await password.hash(pw);
  const userId = await repo.createUser({
    email: inv.Email, fullName, passwordHash: hash, role: inv.Role, createdBy: inv.CreatedBy,
  });

  // Apply any scopes attached to the invite
  const scopes = inv.ScopeJson ? JSON.parse(inv.ScopeJson) : [];
  for (const s of scopes) {
    await repo.grantScope({ userId, type: s.type, value: s.value, grantedBy: inv.CreatedBy });
  }

  await repo.consumeInvite(inv.InviteId);
  await repo.audit({ userId, actorEmail: inv.Email, action: 'invite.accept', target: inv.InviteId, ...meta(req) });

  // Auto-login
  const refresh = tokens.newRefresh();
  const sessionId = await repo.createSession({ userId, refreshHash: refresh.hash, expiresAt: refresh.expiresAt });
  const access = tokens.signAccess({ userId, email: inv.Email, role: inv.Role, sessionId });
  res.json({
    access, refresh: refresh.raw,
    user: { userId, email: inv.Email, fullName, role: inv.Role },
    expiresInSec: tokens.ACCESS_TTL_SECONDS,
  });
});

// ── POST /api/auth/claim-master ──────────────────────────────────
// One-time: only succeeds when the seeded Master row still has PasswordHash='UNCLAIMED'.
// Runs as a no-auth endpoint, but is only usable once and only from localhost.
router.post('/auth/claim-master', async (req, res) => {
  const ip = req.ip;
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || req.hostname === 'localhost';
  if (!isLocal) return res.status(403).json({ error: 'Claim must be initiated from the Master\'s device' });
  const { password: pw } = req.body || {};
  if (!pw) return res.status(400).json({ error: 'password required' });
  const master = await repo.findUserByEmail(roles.MASTER_EMAIL);
  if (!master) return res.status(500).json({ error: 'Master row missing — run migration 001' });
  if (master.PasswordHash !== 'UNCLAIMED') return res.status(409).json({ error: 'Master already claimed' });
  const hash = await password.hash(pw);
  await repo.setPasswordHash(master.UserId, hash);
  await repo.audit({ userId: master.UserId, actorEmail: master.Email, action: 'master.claim', ...meta(req) });
  res.json({ ok: true });
});

// ── GET /api/auth/me ─────────────────────────────────────────────
router.get('/auth/me', mw.authenticate, async (req, res) => {
  res.json({ user: req.user });
});

// ── POST /api/auth/change-password ───────────────────────────────
// Current-password required even for freshly-claimed accounts; prevents
// a stolen access-token from being parlayed into a permanent takeover.
router.post('/auth/change-password', mw.authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword required' });
  }
  if (typeof newPassword !== 'string' || newPassword.length < 10) {
    return res.status(400).json({ error: 'New password must be at least 10 characters.' });
  }
  const user = await repo.findUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'user not found' });
  const ok = await password.verify(currentPassword, user.PasswordHash);
  if (!ok) {
    await repo.audit({
      userId: user.UserId, actorEmail: user.Email,
      action: 'password.change.failed', ...meta(req),
    });
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  const newHash = await password.hash(newPassword);
  await repo.setPasswordHash(user.UserId, newHash);
  await repo.audit({
    userId: user.UserId, actorEmail: user.Email,
    action: 'password.change', ...meta(req),
  });
  res.json({ ok: true });
});

// ── GET /api/auth/audit ──────────────────────────────────────────
// Return the last 50 audit-log entries for the authenticated user. Used
// by the Security tab to show recent account activity (logins, password
// changes, invite acceptances, etc.). Admins see org-wide activity via a
// separate admin endpoint, not here.
router.get('/auth/audit', mw.authenticate, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const rows = await repo.listAuditForUser(req.user.userId, limit);
    res.json({ entries: rows });
  } catch (e) {
    console.error('[auth:audit]', e.message);
    res.status(500).json({ error: 'failed to load audit log' });
  }
});

// ── POST /api/admin/invites ──────────────────────────────────────
router.post('/admin/invites',
  mw.authenticate, mw.requireRole('Admin'),
  async (req, res) => {
    const { email, role, scopes } = req.body || {};
    if (!email || !role) return res.status(400).json({ error: 'email and role required' });
    if (!roles.canInviteRole(req.user.role, role)) {
      return res.status(403).json({ error: `Role ${req.user.role} cannot invite ${role}` });
    }
    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 86400_000);
    const scopeJson = scopes ? JSON.stringify(scopes) : null;
    const inviteId = await repo.createInvite({
      email, role, scopeJson, tokenHash, expiresAt, createdBy: req.user.userId,
    });
    await repo.audit({
      userId: req.user.userId, actorEmail: req.user.email,
      action: 'invite.create', target: `${email}:${role}`, ...meta(req),
    });
    const base = process.env.ALEC_INVITE_BASE || 'alec://accept';
    res.json({
      inviteId,
      inviteUrl: `${base}?t=${rawToken}`,
      expiresAt,
    });
  });

// ── GET /api/admin/users ─────────────────────────────────────────
router.get('/admin/users',
  mw.authenticate, mw.requireRole('Admin'),
  async (req, res) => {
    try {
      const users = await repo.listUsers();
      // Attach scopes for each
      const out = [];
      for (const u of users) {
        const scopes = await repo.listScopes(u.userId).catch(() => []);
        out.push({ ...u, scopes });
      }
      res.json({ success: true, data: out });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

// ── GET /api/admin/invites ───────────────────────────────────────
router.get('/admin/invites',
  mw.authenticate, mw.requireRole('Admin'),
  async (req, res) => {
    try {
      const invites = await repo.listInvites();
      res.json({ success: true, data: invites });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

// ── POST /api/admin/users/:id/suspend ────────────────────────────
router.post('/admin/users/:id/suspend',
  mw.authenticate, mw.requireRole('Admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { suspend } = req.body || {};
      const flag = suspend !== false; // default true
      await repo.setSuspended(id, flag);
      mw.bustCache(id);
      await repo.audit({
        userId: req.user.userId, actorEmail: req.user.email,
        action: flag ? 'user.suspend' : 'user.unsuspend', target: id, ...meta(req),
      });
      res.json({ success: true, ok: true, suspended: flag });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

// ── POST /api/admin/users/:id/scope ──────────────────────────────
//   body: { type, value, op: 'grant' | 'revoke' }
router.post('/admin/users/:id/scope',
  mw.authenticate, mw.requireRole('Admin'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { type, value, op } = req.body || {};
      if (!type || !value || !op) return res.status(400).json({ error: 'type, value, op required' });
      if (op === 'grant') {
        await repo.grantScope({ userId: id, type, value, grantedBy: req.user.userId });
      } else if (op === 'revoke') {
        await repo.revokeScope({ userId: id, type, value });
      } else {
        return res.status(400).json({ error: 'op must be grant or revoke' });
      }
      mw.bustCache(id);
      await repo.audit({
        userId: req.user.userId, actorEmail: req.user.email,
        action: `scope.${op}`, target: `${id}:${type}=${value}`, ...meta(req),
      });
      res.json({ success: true, ok: true });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

module.exports = router;

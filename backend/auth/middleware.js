/**
 * backend/auth/middleware.js — Sprint 1
 *
 * The new request gate. Order of precedence:
 *
 *   1. Bearer access JWT (sprint-1 canonical path).
 *   2. Desktop device token  (Electron shell, short-term scaffolding)
 *        Header:  X-Alec-Device-Token
 *        Only honored when the request is from localhost AND the token
 *        matches DEVICE_TOKEN env baked into the encrypted bundle.
 *   3. Legacy localhost bypass, behind ALEC_ALLOW_LOCAL_OWNER=1 flag.
 *        Default-OFF once DEVICE_TOKEN is provisioned. Kept as a single
 *        env-flip escape hatch while we finish the login UI.
 *
 * After gate, loads scopes from alec.UserScopes into req.user. A small LRU
 * (60-second TTL) keeps this from being a DB hit on every request.
 */
'use strict';

const tokens = require('./tokens');
const roles  = require('./roles');
const repo   = require('./repo');

// ── 60-second user cache ─────────────────────────────────────────
const userCache = new Map(); // userId → { at, role, scopes }
function getCached(userId) {
  const hit = userCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  return null;
}
function setCached(userId, data) { userCache.set(userId, { at: Date.now(), ...data }); }
function bustCache(userId) { userCache.delete(userId); }

function isLocalhost(req) {
  const ip = req.ip || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
      || req.hostname === 'localhost';
}

/**
 * authenticate — populates req.user or 401s.
 * req.user = { userId, email, role, scopes: [{type,value}], capabilities: [...] }
 */
async function authenticate(req, res, next) {
  try {
    // Path 1 — Bearer access JWT
    const hdr = req.headers['authorization'];
    const bearer = hdr && hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (bearer) {
      let claims;
      try { claims = tokens.verifyAccess(bearer); }
      catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
      return attachUser(req, res, next, {
        userId: claims.sub, email: claims.email, role: claims.role,
      });
    }

    // Path 2 — Desktop device token (localhost only)
    const deviceTok = req.headers['x-alec-device-token'];
    if (deviceTok && isLocalhost(req) && process.env.ALEC_DEVICE_TOKEN
        && deviceTok === process.env.ALEC_DEVICE_TOKEN) {
      return attachUser(req, res, next, {
        userId: 'device-master',
        email: roles.MASTER_EMAIL,
        role: 'Master',
        synthetic: true,
      });
    }

    // Path 3 — Legacy localhost bypass (scaffolding, env-flag off by default)
    if (process.env.ALEC_ALLOW_LOCAL_OWNER === '1' && isLocalhost(req)) {
      return attachUser(req, res, next, {
        userId: 'local-owner',
        email: roles.MASTER_EMAIL,
        role: 'Master',
        synthetic: true,
      });
    }

    return res.status(401).json({ error: 'Access denied' });
  } catch (e) {
    return res.status(500).json({ error: 'Auth middleware error', message: e.message });
  }
}

async function attachUser(req, res, next, base) {
  const { userId, email, role, synthetic } = base;
  let scopes;
  const cached = getCached(userId);
  if (cached) { scopes = cached.scopes; }
  else if (synthetic) {
    // Master/device tokens get implicit '*' and are not DB-backed.
    scopes = [{ type: '*', value: '*' }];
    setCached(userId, { role, scopes });
  } else {
    // Refresh suspended check at most once per 60s.
    const u = await repo.findUserById(userId).catch(() => null);
    if (!u) return res.status(401).json({ error: 'User not found' });
    if (u.Suspended) return res.status(403).json({ error: 'Account suspended' });
    scopes = await repo.listScopes(userId);
    setCached(userId, { role, scopes });
  }
  const roleDef = roles.ROLES[role] || roles.ROLES.Viewer;
  req.user = {
    userId, email, role,
    scopes,
    capabilities: roleDef.capabilities,
    implicitScope: roleDef.implicitScope, // '*' or null
  };
  return next();
}

// ── Authorization helpers ────────────────────────────────────────

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    if (!roles.roleAtLeast(req.user.role, minRole)) {
      return res.status(403).json({ error: 'Insufficient role', need: minRole });
    }
    next();
  };
}

function requireCapability(cap) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    if (!roles.hasCapability(req.user.role, cap)) {
      return res.status(403).json({ error: 'Missing capability', need: cap });
    }
    next();
  };
}

/**
 * requireScope('project', req => req.query.property)
 *
 * Fails closed (403) unless the extracted value matches a scope the user
 * holds, OR the user has implicit '*' (Master / Admin).
 * If the extractor returns null/undefined, the check passes — callers decide
 * if they want to require-a-value by asserting first.
 */
function requireScope(type, extractor) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Auth required' });
    if (req.user.implicitScope === '*') return next();
    const val = extractor(req);
    if (val == null) return next();
    const ok = req.user.scopes.some(s =>
      (s.type === '*' || s.type === type) && (s.value === '*' || s.value === val));
    if (!ok) return res.status(403).json({ error: 'Out of scope', type, value: val });
    next();
  };
}

module.exports = {
  authenticate,
  requireRole, requireCapability, requireScope,
  bustCache,
};

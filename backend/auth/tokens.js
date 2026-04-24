/**
 * backend/auth/tokens.js — Sprint 1
 *
 * Short-lived access JWTs (15 min) + long-lived opaque refresh tokens (30 d).
 *
 *   - Access token: HS256 JWT signed with rotating JWT_SECRET.
 *     Claims: { sub (userId), email, role, sid (sessionId), iat, exp }.
 *     No scope array — we always load scopes from the DB on every request
 *     so a revoked scope takes effect immediately.
 *
 *   - Refresh token: 32 bytes of crypto.randomBytes, base64url. The server
 *     stores only SHA-256 of it in `alec.Sessions`. Rotation-on-use with
 *     reuse detection (old refresh presented twice = compromise = revoke
 *     all user sessions).
 *
 * The `sid` claim ties an access token to a specific session row; revoking
 * the session invalidates all its access tokens even before they expire.
 */
'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ACCESS_TTL_SECONDS  = 15 * 60;           // 15 min
const REFRESH_TTL_DAYS    = 30;
const REFRESH_BYTES       = 32;

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) {
    throw new Error('JWT_SECRET missing or too short (needs ≥32 chars).');
  }
  return s;
}

function signAccess({ userId, email, role, sessionId }) {
  return jwt.sign(
    { sub: userId, email, role, sid: sessionId },
    secret(),
    { algorithm: 'HS256', expiresIn: ACCESS_TTL_SECONDS },
  );
}

function verifyAccess(token) {
  return jwt.verify(token, secret(), { algorithms: ['HS256'] });
}

function newRefresh() {
  const raw = crypto.randomBytes(REFRESH_BYTES).toString('base64url');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000);
  return { raw, hash, expiresAt };
}

function hashRefresh(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

module.exports = {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_DAYS,
  signAccess,
  verifyAccess,
  newRefresh,
  hashRefresh,
};

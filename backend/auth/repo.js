/**
 * backend/auth/repo.js — Sprint 1
 *
 * Thin data-access layer for the alec.* auth tables. Uses the existing
 * stoaQueryService pool so we don't open a second connection.
 *
 * Every exported function is async and returns plain objects. No ORM —
 * Azure SQL + parameterized mssql queries are plenty.
 */
'use strict';

const { getPoolForAuth } = require('./_pool');

// ── Users ─────────────────────────────────────────────────────────

async function findUserByEmail(email) {
  const pool = await getPoolForAuth();
  const r = await pool.request()
    .input('email', email.toLowerCase())
    .query(`SELECT UserId, Email, FullName, PasswordHash, Role, Suspended,
                   MfaSecretEnc, LastLoginAt, PasswordChangedAt
              FROM alec.Users WHERE LOWER(Email) = @email`);
  return r.recordset[0] || null;
}

async function findUserById(userId) {
  const pool = await getPoolForAuth();
  const r = await pool.request()
    .input('uid', userId)
    .query(`SELECT UserId, Email, FullName, Role, Suspended
              FROM alec.Users WHERE UserId = @uid`);
  return r.recordset[0] || null;
}

async function setPasswordHash(userId, passwordHash) {
  const pool = await getPoolForAuth();
  await pool.request()
    .input('uid', userId)
    .input('hash', passwordHash)
    .query(`UPDATE alec.Users
               SET PasswordHash = @hash, PasswordChangedAt = SYSUTCDATETIME()
             WHERE UserId = @uid`);
}

async function touchLastLogin(userId) {
  const pool = await getPoolForAuth();
  await pool.request().input('uid', userId)
    .query('UPDATE alec.Users SET LastLoginAt = SYSUTCDATETIME() WHERE UserId = @uid');
}

async function listUsers() {
  const pool = await getPoolForAuth();
  const r = await pool.request().query(`
    SELECT UserId, Email, FullName, Role, Suspended, LastLoginAt,
           PasswordHash, CreatedAt
      FROM alec.Users
      ORDER BY CreatedAt DESC`);
  return r.recordset.map(u => ({
    userId: u.UserId,
    email: u.Email,
    fullName: u.FullName,
    role: u.Role,
    suspended: !!u.Suspended,
    lastLoginAt: u.LastLoginAt,
    createdAt: u.CreatedAt,
    claimed: u.PasswordHash && u.PasswordHash !== 'UNCLAIMED',
  }));
}

async function setSuspended(userId, suspended) {
  const pool = await getPoolForAuth();
  await pool.request()
    .input('uid', userId).input('s', suspended ? 1 : 0)
    .query(`UPDATE alec.Users SET Suspended = @s WHERE UserId = @uid`);
}

async function listInvites() {
  const pool = await getPoolForAuth();
  const r = await pool.request().query(`
    SELECT InviteId, Email, Role, ScopeJson, ExpiresAt, ConsumedAt, CreatedAt
      FROM alec.Invites
      ORDER BY CreatedAt DESC`);
  return r.recordset.map(i => ({
    inviteId: i.InviteId,
    email: i.Email,
    role: i.Role,
    scopes: i.ScopeJson ? JSON.parse(i.ScopeJson) : [],
    expiresAt: i.ExpiresAt,
    consumedAt: i.ConsumedAt,
    createdAt: i.CreatedAt,
  }));
}

async function createUser({ email, fullName, passwordHash, role, createdBy }) {
  const pool = await getPoolForAuth();
  const r = await pool.request()
    .input('e', email.toLowerCase())
    .input('n', fullName)
    .input('h', passwordHash)
    .input('r', role)
    .input('cb', createdBy || null)
    .query(`INSERT INTO alec.Users (Email, FullName, PasswordHash, Role, CreatedBy)
            OUTPUT INSERTED.UserId
            VALUES (@e, @n, @h, @r, @cb)`);
  return r.recordset[0].UserId;
}

// ── Sessions ──────────────────────────────────────────────────────

async function createSession({ userId, refreshHash, deviceLabel, expiresAt }) {
  const pool = await getPoolForAuth();
  const r = await pool.request()
    .input('uid', userId)
    .input('rh', refreshHash)
    .input('dl', deviceLabel || null)
    .input('exp', expiresAt)
    .query(`INSERT INTO alec.Sessions (UserId, RefreshHash, DeviceLabel, ExpiresAt)
            OUTPUT INSERTED.SessionId
            VALUES (@uid, @rh, @dl, @exp)`);
  return r.recordset[0].SessionId;
}

async function findSessionByRefresh(refreshHash) {
  const pool = await getPoolForAuth();
  const r = await pool.request()
    .input('rh', refreshHash)
    .query(`SELECT SessionId, UserId, ExpiresAt, RevokedAt
              FROM alec.Sessions WHERE RefreshHash = @rh`);
  return r.recordset[0] || null;
}

async function rotateSessionRefresh(sessionId, newRefreshHash, newExpiresAt) {
  const pool = await getPoolForAuth();
  await pool.request()
    .input('sid', sessionId)
    .input('rh', newRefreshHash)
    .input('exp', newExpiresAt)
    .query(`UPDATE alec.Sessions
               SET RefreshHash = @rh, ExpiresAt = @exp
             WHERE SessionId = @sid`);
}

async function revokeSession(sessionId) {
  const pool = await getPoolForAuth();
  await pool.request().input('sid', sessionId)
    .query(`UPDATE alec.Sessions SET RevokedAt = SYSUTCDATETIME() WHERE SessionId = @sid`);
}

async function revokeAllSessionsForUser(userId) {
  const pool = await getPoolForAuth();
  await pool.request().input('uid', userId)
    .query(`UPDATE alec.Sessions
               SET RevokedAt = SYSUTCDATETIME()
             WHERE UserId = @uid AND RevokedAt IS NULL`);
}

// ── Scopes ────────────────────────────────────────────────────────

async function listScopes(userId) {
  const pool = await getPoolForAuth();
  const r = await pool.request().input('uid', userId)
    .query(`SELECT ScopeType, ScopeValue FROM alec.UserScopes WHERE UserId = @uid`);
  return r.recordset.map(x => ({ type: x.ScopeType, value: x.ScopeValue }));
}

async function grantScope({ userId, type, value, grantedBy }) {
  const pool = await getPoolForAuth();
  await pool.request()
    .input('uid', userId).input('t', type).input('v', value).input('gb', grantedBy)
    .query(`IF NOT EXISTS (SELECT 1 FROM alec.UserScopes
                             WHERE UserId=@uid AND ScopeType=@t AND ScopeValue=@v)
              INSERT INTO alec.UserScopes (UserId, ScopeType, ScopeValue, GrantedBy)
              VALUES (@uid, @t, @v, @gb)`);
}

async function revokeScope({ userId, type, value }) {
  const pool = await getPoolForAuth();
  await pool.request().input('uid', userId).input('t', type).input('v', value)
    .query(`DELETE FROM alec.UserScopes
             WHERE UserId=@uid AND ScopeType=@t AND ScopeValue=@v`);
}

// ── Invites ───────────────────────────────────────────────────────

async function createInvite({ email, role, scopeJson, tokenHash, expiresAt, createdBy }) {
  const pool = await getPoolForAuth();
  const r = await pool.request()
    .input('e', email.toLowerCase())
    .input('r', role)
    .input('s', scopeJson)
    .input('th', tokenHash)
    .input('exp', expiresAt)
    .input('cb', createdBy)
    .query(`INSERT INTO alec.Invites (Email, Role, ScopeJson, TokenHash, ExpiresAt, CreatedBy)
            OUTPUT INSERTED.InviteId
            VALUES (@e, @r, @s, @th, @exp, @cb)`);
  return r.recordset[0].InviteId;
}

async function findInviteByTokenHash(tokenHash) {
  const pool = await getPoolForAuth();
  const r = await pool.request().input('th', tokenHash)
    .query(`SELECT InviteId, Email, Role, ScopeJson, ExpiresAt, ConsumedAt, CreatedBy
              FROM alec.Invites WHERE TokenHash = @th`);
  return r.recordset[0] || null;
}

async function consumeInvite(inviteId) {
  const pool = await getPoolForAuth();
  await pool.request().input('id', inviteId)
    .query('UPDATE alec.Invites SET ConsumedAt = SYSUTCDATETIME() WHERE InviteId = @id');
}

// ── Audit ─────────────────────────────────────────────────────────

async function audit({ userId, actorEmail, action, target, ip, userAgent }) {
  try {
    const pool = await getPoolForAuth();
    await pool.request()
      .input('uid', userId || null)
      .input('e', actorEmail || null)
      .input('a', action)
      .input('t', target || null)
      .input('ip', ip || null)
      .input('ua', (userAgent || '').slice(0, 400))
      .query(`INSERT INTO alec.AuditLog (UserId, ActorEmail, Action, Target, Ip, UserAgent)
              VALUES (@uid, @e, @a, @t, @ip, @ua)`);
  } catch (e) {
    // Never let audit write failure break the request; log to stderr.
    // eslint-disable-next-line no-console
    console.error('[audit] write failed:', e.message);
  }
}

// List recent audit entries for a single user — newest first. Used by the
// Security tab in Settings. We cap the limit at the call site to 200.
async function listAuditForUser(userId, limit = 50) {
  const pool = await getPoolForAuth();
  const r = await pool.request()
    .input('uid', userId)
    .input('n', Math.max(1, Math.min(Number(limit) || 50, 200)))
    .query(`SELECT TOP (@n) AuditId, Action, Target, Ip, UserAgent, CreatedAt
            FROM alec.AuditLog
            WHERE UserId = @uid
            ORDER BY CreatedAt DESC`);
  return r.recordset;
}

module.exports = {
  findUserByEmail, findUserById, setPasswordHash, touchLastLogin, createUser,
  listUsers, setSuspended, listInvites,
  createSession, findSessionByRefresh, rotateSessionRefresh,
  revokeSession, revokeAllSessionsForUser,
  listScopes, grantScope, revokeScope,
  createInvite, findInviteByTokenHash, consumeInvite,
  audit, listAuditForUser,
};

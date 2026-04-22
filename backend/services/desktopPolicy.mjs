// backend/services/desktopPolicy.mjs
// S7.3 — desktop policy evaluator + session state + kill-switch.
//
// `evaluate(db, primitive, args)` is the sole entry point the desktopControl
// singleton uses to decide allow/deny/ask. Safety rules (from spec):
//   1. kill_switch=1 -> deny everything, unconditionally.
//   2. Denylist windows (Keychain/1Password/Bitwarden/Vault/System Settings
//      Passwords) -> keyboard.type is non-overridably denied.
//   3. applescript.run always asks, regardless of mode.
//   4. Session expiry is respected — expired session == no session.

import crypto from 'node:crypto';

const SINGLETON_KEY = 'default';
const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour

const DENYLIST_RE = /(Keychain|1Password|Bitwarden|Vault|System Settings.*Passwords)/i;

const READ_PRIMITIVES = new Set([
  'screen.capture',
  'screen.read_text',
  'window.list',
]);

function writeAudit(db, userId, action, targetId, metadata) {
  db.prepare(
    `INSERT INTO audit_log(user_id, org_id, action, target_type, target_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, null, action, 'desktop_policy', targetId,
       metadata ? JSON.stringify(metadata) : null);
}

export function getPolicy(db) {
  return db.prepare('SELECT * FROM desktop_policy WHERE key=?').get(SINGLETON_KEY);
}

export function setPolicy(db, userId, { mode, kill_switch } = {}) {
  const current = getPolicy(db);
  if (!current) throw new Error('DESKTOP_POLICY_NOT_SEEDED');
  const nextMode = mode ?? current.mode;
  const nextKill = typeof kill_switch === 'number'
    ? kill_switch
    : (typeof kill_switch === 'boolean' ? (kill_switch ? 1 : 0) : current.kill_switch);
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE desktop_policy SET mode=?, kill_switch=?, updated_at=?, updated_by=? WHERE key=?`
  ).run(nextMode, nextKill, now, userId, SINGLETON_KEY);
  writeAudit(db, userId, 'desktop.policy.update', SINGLETON_KEY, {
    from: { mode: current.mode, kill_switch: current.kill_switch },
    to:   { mode: nextMode,     kill_switch: nextKill },
  });
  return getPolicy(db);
}

export function startSession(db, userId) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE desktop_policy SET session_token=?, session_expires_at=?, updated_at=?, updated_by=? WHERE key=?`
  ).run(token, expiresAt, now, userId, SINGLETON_KEY);
  writeAudit(db, userId, 'desktop.session.start', SINGLETON_KEY, { expiresAt });
  return { token, expiresAt };
}

export function endSession(db, userId) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE desktop_policy SET session_token=NULL, session_expires_at=NULL, updated_at=?, updated_by=? WHERE key=?`
  ).run(now, userId, SINGLETON_KEY);
  writeAudit(db, userId, 'desktop.session.end', SINGLETON_KEY, null);
}

function sessionActive(p) {
  if (!p.session_token || !p.session_expires_at) return false;
  return new Date(p.session_expires_at).getTime() > Date.now();
}

export function evaluate(db, primitive, args = {}) {
  const p = getPolicy(db);
  if (!p) return 'deny';

  // Rule 1 — absolute kill-switch
  if (p.kill_switch === 1) return 'deny';

  // Rule 2 — denylist for keyboard.type
  if (primitive === 'keyboard.type') {
    const frontmost = args.frontmost || '';
    if (DENYLIST_RE.test(frontmost)) return 'deny';
  }

  // Rule 3 — AppleScript always asks
  if (primitive === 'applescript.run') return 'ask';

  const isRead = READ_PRIMITIVES.has(primitive);
  const isDestructive = !!args.destructive;

  if (p.mode === 'always_ask') return isRead ? 'allow' : 'ask';

  if (p.mode === 'auto_reads') return isRead ? 'allow' : 'ask';

  if (p.mode === 'session') {
    if (isRead) return 'allow';
    if (isDestructive) return 'ask';
    return sessionActive(p) ? 'allow' : 'ask';
  }

  return 'ask';
}

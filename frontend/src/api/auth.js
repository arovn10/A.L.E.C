/**
 * frontend/src/api/auth.js
 *
 * Strictly mirrors the contract in backend/auth/routes.js. Backend field names
 * are preserved on the wire; only internal storage uses generic aliases.
 *
 * Wire contract (AUTHORITATIVE — matches backend/auth/routes.js):
 *
 *   POST /auth/login         body: { email, password, deviceLabel? }
 *                            200:  { access, refresh, user, expiresInSec }
 *
 *   POST /auth/refresh       body: { refresh }
 *                            200:  { access, refresh, expiresInSec }
 *
 *   POST /auth/logout        auth: Bearer. 200: { ok: true }
 *
 *   GET  /auth/me            auth: Bearer. 200: { user }
 *
 *   POST /auth/claim-master  body: { password }  (email/name ignored — master email hardcoded)
 *                            localhost-only, one-shot (409 if already claimed).
 *                            200:  { ok: true }   ← NO TOKENS. Must call login() after.
 *
 *   POST /auth/accept-invite body: { token, password, fullName }
 *                            200:  { access, refresh, user, expiresInSec }
 */
import { apiFetch, setAccessToken, setRefreshToken, getRefreshToken } from './client';

export async function changePassword(currentPassword, newPassword) {
  return apiFetch('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

export async function listAudit(limit = 50) {
  return apiFetch(`/auth/audit?limit=${encodeURIComponent(limit)}`);
}

/** Store tokens from any response shape that contains {access, refresh}. */
async function storeTokens(r) {
  if (r?.access)  setAccessToken(r.access);
  if (r?.refresh) await setRefreshToken(r.refresh);
  return r;
}

export async function login(email, password, deviceLabel) {
  const r = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password, deviceLabel }),
  });
  return storeTokens(r);
}

export async function logout() {
  try { await apiFetch('/auth/logout', { method: 'POST' }); } catch (_) { /* best-effort */ }
  setAccessToken(null);
  await setRefreshToken(null);
}

export async function refresh() {
  const refreshTok = await getRefreshToken();
  if (!refreshTok) throw new Error('no refresh token');
  const r = await apiFetch('/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh: refreshTok }),
  });
  return storeTokens(r);
}

export async function me() {
  // Backend returns { user }; unwrap for caller convenience.
  const r = await apiFetch('/auth/me');
  return r.user || r;
}

/**
 * Claim the master account and sign in. Two-step because the backend's
 * /claim-master endpoint intentionally returns no tokens (one-shot, audit-only).
 * We immediately call /login with the same password to bootstrap the session.
 */
export async function claimMaster(password) {
  await apiFetch('/auth/claim-master', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  // Master email is hardcoded in backend/auth/roles.js:MASTER_EMAIL.
  return login('arovner@stoagroup.com', password, 'Desktop (first login)');
}

export async function acceptInvite(token, password, fullName) {
  const r = await apiFetch('/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token, password, fullName }),
  });
  return storeTokens(r);
}

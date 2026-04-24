/**
 * frontend/src/api/client.js
 *
 * Authenticated fetch helpers. Access tokens (short-lived, ~15min) stay in
 * localStorage for speed; refresh tokens (weeks) go to the Electron Keychain
 * via `window.alec.tokens.*` when running inside the desktop shell.
 */
const BASE = '/api';
const ACCESS_KEY  = 'alec_token';          // short-lived access JWT
const REFRESH_KEY = 'alec_refresh_token';  // long-lived refresh token

// ── Access token helpers ────────────────────────────────────────
export function getAccessToken() {
  return localStorage.getItem(ACCESS_KEY);
}
export function setAccessToken(t) {
  if (t) localStorage.setItem(ACCESS_KEY, t);
  else   localStorage.removeItem(ACCESS_KEY);
}

// ── Refresh token (Keychain if available, else localStorage) ────
const hasKeychain = () => typeof window !== 'undefined'
  && window.alec && window.alec.tokens && typeof window.alec.tokens.set === 'function';

export async function getRefreshToken() {
  if (hasKeychain()) {
    const r = await window.alec.tokens.get(REFRESH_KEY).catch(() => null);
    if (r?.ok && r.value) return r.value;
  }
  return localStorage.getItem(REFRESH_KEY) || null;
}
export async function setRefreshToken(t) {
  if (hasKeychain()) {
    if (t) await window.alec.tokens.set(REFRESH_KEY, t).catch(() => {});
    else   await window.alec.tokens.delete(REFRESH_KEY).catch(() => {});
    // Mirror to localStorage ONLY when Keychain unavailable
    const probe = await window.alec.tokens.get(REFRESH_KEY).catch(() => null);
    if (probe?.ok) { localStorage.removeItem(REFRESH_KEY); return; }
  }
  if (t) localStorage.setItem(REFRESH_KEY, t);
  else   localStorage.removeItem(REFRESH_KEY);
}

export function getAuthHeaders() {
  const token = getAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Authenticated JSON fetch — adds Bearer token automatically.
 *  On 401, clears tokens and (if not already on a public page) redirects to /login
 *  with a `?next=` so we can return the user after re-auth. Allow-list prevents
 *  infinite redirects when /auth/me / /auth/login / /auth/refresh 401 themselves. */
const PUBLIC_PATHS = ['/login', '/claim-master', '/accept-invite'];
const AUTH_PROBE_PATHS = ['/auth/me', '/auth/login', '/auth/refresh', '/auth/claim-master', '/auth/accept-invite'];

export async function apiFetch(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...opts.headers,
    },
    ...opts,
  });
  if (res.status === 401 && !AUTH_PROBE_PATHS.some(p => path.startsWith(p))) {
    setAccessToken(null);
    try { await setRefreshToken(null); } catch (_) {}
    if (typeof window !== 'undefined' && !PUBLIC_PATHS.includes(window.location.pathname)) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login?next=${next}`);
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

/** Authenticated multipart/form fetch (for file uploads — no Content-Type, browser sets boundary). */
export async function apiFetchForm(path, formData, opts = {}) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { ...getAuthHeaders(), ...opts.headers },
    body: formData,
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

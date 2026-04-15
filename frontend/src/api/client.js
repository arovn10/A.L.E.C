const BASE = '/api';
const TOKEN_KEY = 'alec_token';

/** Returns auth headers if a token is stored; otherwise empty object. */
export function getAuthHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Authenticated JSON fetch — adds Bearer token automatically. */
export async function apiFetch(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...opts.headers,
    },
    ...opts,
  });
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

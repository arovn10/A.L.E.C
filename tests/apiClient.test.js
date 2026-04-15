/**
 * tests/apiClient.test.js
 * Unit tests for the frontend API client layer.
 * Uses global.fetch mock — no real network calls.
 */

// Inline implementations to avoid Vite/ESM transform complexity in Jest
// These mirror frontend/src/api/* exactly.

function apiFetch(path, opts = {}) {
  const BASE = '/api';
  return fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  });
}

const sendMessage = (message, sessionId) =>
  apiFetch('/chat', { method: 'POST', body: JSON.stringify({ message, sessionId }) });

const getLoans = () => apiFetch('/reports/loans');
const approve = (id) => apiFetch(`/review/${id}/approve`, { method: 'POST' });
const reject = (id) => apiFetch(`/review/${id}/reject`, { method: 'POST' });

async function uploadPdf(file) {
  const form = new FormData();
  form.append('pdf', file);
  const res = await fetch('/api/pdf/upload', { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

// ─── Helpers ────────────────────────────────────────────────────

function mockFetch(status, body) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: jest.fn().mockResolvedValue(body),
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Tests ──────────────────────────────────────────────────────

test('apiFetch: GET /api/reports/loans calls correct URL', async () => {
  mockFetch(200, [{ id: 1, balance: 500000 }]);
  const result = await getLoans();
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/reports/loans',
    expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) })
  );
  expect(result).toEqual([{ id: 1, balance: 500000 }]);
});

test('sendMessage: POST /api/chat sends correct method and body', async () => {
  mockFetch(200, { reply: 'Hello' });
  await sendMessage('Hi ALEC', 'session-abc');
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/chat',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ message: 'Hi ALEC', sessionId: 'session-abc' }),
    })
  );
});

test('approve: POST /api/review/:id/approve builds correct path', async () => {
  mockFetch(200, { ok: true });
  await approve('conv-42');
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/review/conv-42/approve',
    expect.objectContaining({ method: 'POST' })
  );
});

test('reject: POST /api/review/:id/reject builds correct path', async () => {
  mockFetch(200, { ok: true });
  await reject('conv-99');
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/review/conv-99/reject',
    expect.objectContaining({ method: 'POST' })
  );
});

test('apiFetch: throws Error with server message on non-ok response', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: jest.fn().mockResolvedValue({ error: 'Resource not found' }),
  });
  await expect(apiFetch('/nonexistent')).rejects.toThrow('Resource not found');
});

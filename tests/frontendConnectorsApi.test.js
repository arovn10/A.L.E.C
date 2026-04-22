/**
 * tests/frontendConnectorsApi.test.js
 *
 * Unit tests for the new S3 frontend API clients (connectors, orgs, mcp).
 * Like apiClient.test.js, we inline the logic to sidestep Vite/ESM transforms
 * in Jest — the inlined shape MUST match frontend/src/api/{connectors,orgs,mcp}.js.
 */

const BASE = '/api';
function apiFetch(path, opts = {}) {
  return fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  });
}

function qs(params) {
  if (!params) return '';
  const e = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (!e.length) return '';
  return '?' + new URLSearchParams(e).toString();
}

// — connectors client —
const C = {
  getCatalog: () => apiFetch('/connectors/catalog'),
  listConnectors: (params) => apiFetch('/connectors' + qs(params)),
  createConnector: (body) => apiFetch('/connectors', { method: 'POST', body: JSON.stringify(body) }),
  getConnector: (id) => apiFetch(`/connectors/${id}`),
  patchConnector: (id, body) => apiFetch(`/connectors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteConnector: (id) => apiFetch(`/connectors/${id}`, { method: 'DELETE' }),
  testConnector: (id) => apiFetch(`/connectors/${id}/test`, { method: 'POST' }),
  revealConnector: (id) => apiFetch(`/connectors/${id}/reveal`, { method: 'POST' }),
};

// — orgs client —
const O = {
  listOrgs: () => apiFetch('/orgs'),
  listMembers: (orgId) => apiFetch(`/orgs/${orgId}/members`),
  addMember: (orgId, body) => apiFetch(`/orgs/${orgId}/members`, { method: 'POST', body: JSON.stringify(body) }),
  removeMember: (orgId, userId) => apiFetch(`/orgs/${orgId}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
};

// — mcp client —
const M = {
  listMcps: () => apiFetch('/mcp'),
  createMcp: (body) => apiFetch('/mcp', { method: 'POST', body: JSON.stringify(body) }),
  startMcp: (id) => apiFetch(`/mcp/${id}/start`, { method: 'POST' }),
};

function mockResponse(data, ok = true, status = 200) {
  return Promise.resolve({ ok, status, statusText: 'OK', json: () => Promise.resolve(data) });
}

beforeEach(() => { global.fetch = jest.fn(); });
afterEach(() => { delete global.fetch; });

describe('connectors api client', () => {
  test('getCatalog hits /api/connectors/catalog', async () => {
    fetch.mockReturnValue(mockResponse([{ id: 'github' }]));
    const r = await C.getCatalog();
    expect(fetch).toHaveBeenCalledWith('/api/connectors/catalog', expect.objectContaining({ headers: expect.any(Object) }));
    expect(r).toEqual([{ id: 'github' }]);
  });
  test('listConnectors with orgId encodes querystring', async () => {
    fetch.mockReturnValue(mockResponse([]));
    await C.listConnectors({ orgId: 'acme', scope: 'org' });
    const url = fetch.mock.calls[0][0];
    expect(url).toBe('/api/connectors?orgId=acme&scope=org');
  });
  test('listConnectors drops empty/null params', async () => {
    fetch.mockReturnValue(mockResponse([]));
    await C.listConnectors({ orgId: null, scope: 'user' });
    expect(fetch.mock.calls[0][0]).toBe('/api/connectors?scope=user');
  });
  test('createConnector posts JSON body', async () => {
    fetch.mockReturnValue(mockResponse({ id: '1' }));
    await C.createConnector({ definitionId: 'github', scope: 'user', scopeId: 'a@b', fields: { x: 'y' } });
    const call = fetch.mock.calls[0];
    expect(call[0]).toBe('/api/connectors');
    expect(call[1].method).toBe('POST');
    expect(JSON.parse(call[1].body)).toEqual({ definitionId: 'github', scope: 'user', scopeId: 'a@b', fields: { x: 'y' } });
  });
  test('testConnector POSTs /test', async () => {
    fetch.mockReturnValue(mockResponse({ ok: true }));
    await C.testConnector('abc');
    expect(fetch.mock.calls[0][0]).toBe('/api/connectors/abc/test');
    expect(fetch.mock.calls[0][1].method).toBe('POST');
  });
  test('revealConnector POSTs /reveal', async () => {
    fetch.mockReturnValue(mockResponse({ fields: {} }));
    await C.revealConnector('abc');
    expect(fetch.mock.calls[0][0]).toBe('/api/connectors/abc/reveal');
  });
  test('throws on non-ok with server error message', async () => {
    fetch.mockReturnValue(mockResponse({ error: 'FORBIDDEN' }, false, 403));
    await expect(C.getConnector('x')).rejects.toThrow('FORBIDDEN');
  });
});

describe('orgs api client', () => {
  test('listOrgs hits /api/orgs', async () => {
    fetch.mockReturnValue(mockResponse([]));
    await O.listOrgs();
    expect(fetch.mock.calls[0][0]).toBe('/api/orgs');
  });
  test('removeMember url-encodes userId with @', async () => {
    fetch.mockReturnValue(mockResponse({}));
    await O.removeMember('org1', 'a@b.com');
    expect(fetch.mock.calls[0][0]).toBe('/api/orgs/org1/members/a%40b.com');
  });
});

describe('mcp api client', () => {
  test('listMcps hits /api/mcp', async () => {
    fetch.mockReturnValue(mockResponse([]));
    await M.listMcps();
    expect(fetch.mock.calls[0][0]).toBe('/api/mcp');
  });
  test('startMcp POSTs /start (will 501 in S2 — client shape correct)', async () => {
    fetch.mockReturnValue(mockResponse({ error: 'NOT_IMPLEMENTED' }, false, 501));
    await expect(M.startMcp('id1')).rejects.toThrow('NOT_IMPLEMENTED');
    expect(fetch.mock.calls[0][0]).toBe('/api/mcp/id1/start');
  });
});

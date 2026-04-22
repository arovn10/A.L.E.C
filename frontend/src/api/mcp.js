/**
 * frontend/src/api/mcp.js
 *
 * /api/mcp — CRUD over mcp_servers. Runtime (start/stop/test) still returns
 * 501 in S2 but the wrappers exist so S4 can flip a switch and go.
 */
import { apiFetch } from './client.js';

// Catalog endpoint returns { entries, categories }. Back-compat: if the
// server returns a bare array (old shape), pass it through.
export const getMcpCatalog = async () => {
  const r = await apiFetch('/mcp/catalog');
  if (Array.isArray(r)) return { entries: r, categories: [] };
  return r || { entries: [], categories: [] };
};

export const listMcps = () => apiFetch('/mcp');

export const getMcp = (id) => apiFetch(`/mcp/${id}`);

export const createMcp = (body) =>
  apiFetch('/mcp', { method: 'POST', body: JSON.stringify(body) });

export const patchMcp = (id, body) =>
  apiFetch(`/mcp/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteMcp = (id) =>
  apiFetch(`/mcp/${id}`, { method: 'DELETE' });

export const startMcp = (id) =>
  apiFetch(`/mcp/${id}/start`, { method: 'POST' });

export const stopMcp = (id) =>
  apiFetch(`/mcp/${id}/stop`, { method: 'POST' });

export const testMcp = (id) =>
  apiFetch(`/mcp/${id}/test`, { method: 'POST' });

/**
 * frontend/src/api/connectors.js
 *
 * Thin wrappers around apiFetch for the /api/connectors surface shipped in
 * S1+S2. Every call carries the access-token Bearer header automatically;
 * mutations pass JSON bodies.
 */
import { apiFetch } from './client.js';

function qs(params) {
  if (!params) return '';
  const e = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (!e.length) return '';
  return '?' + new URLSearchParams(e).toString();
}

export const getCatalog = () => apiFetch('/connectors/catalog');

export const listConnectors = (params) =>
  apiFetch('/connectors' + qs(params));

export const createConnector = (body) =>
  apiFetch('/connectors', { method: 'POST', body: JSON.stringify(body) });

export const getConnector = (id) => apiFetch(`/connectors/${id}`);

export const patchConnector = (id, body) =>
  apiFetch(`/connectors/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deleteConnector = (id) =>
  apiFetch(`/connectors/${id}`, { method: 'DELETE' });

export const testConnector = (id) =>
  apiFetch(`/connectors/${id}/test`, { method: 'POST' });

export const revealConnector = (id) =>
  apiFetch(`/connectors/${id}/reveal`, { method: 'POST' });

// S5.3 — reassign a connector between user/org scopes. Body: {scope, scopeId}.
export const moveConnector = (id, body) =>
  apiFetch(`/connectors/${id}/move`, { method: 'POST', body: JSON.stringify(body) });

/**
 * frontend/src/api/desktop.js — S7.7
 * /api/desktop/* wrappers. These all run over loopback; the backend will
 * refuse any non-127.0.0.1 caller.
 */
import { apiFetch } from './client.js';

export const getDesktopStatus = () => apiFetch('/desktop/status');

export const probeDesktopPermissions = () =>
  apiFetch('/desktop/permissions/probe', { method: 'POST' });

export const requestDesktopPermission = (id) =>
  apiFetch(`/desktop/permissions/request/${encodeURIComponent(id)}`, { method: 'POST' });

export const patchDesktopPolicy = (body) =>
  apiFetch('/desktop/policy', { method: 'PATCH', body: JSON.stringify(body) });

export const startDesktopSession = () =>
  apiFetch('/desktop/session/start', { method: 'POST' });

export const endDesktopSession = () =>
  apiFetch('/desktop/session/end', { method: 'POST' });

export const getDesktopAudit = (limit = 50) =>
  apiFetch(`/desktop/audit?limit=${encodeURIComponent(limit)}`);

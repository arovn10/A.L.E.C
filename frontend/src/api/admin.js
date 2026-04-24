/**
 * frontend/src/api/admin.js — Sprint 3
 *
 * Thin wrappers around /api/admin/* and /api/domo/dashboards. All calls go
 * through apiFetch so the Bearer access token is attached automatically.
 */
import { apiFetch } from './client';

// ── Users ───────────────────────────────────────────────────────
export const listUsers = () => apiFetch('/admin/users');

export const setUserSuspended = (userId, suspend = true) =>
  apiFetch(`/admin/users/${encodeURIComponent(userId)}/suspend`, {
    method: 'POST',
    body: JSON.stringify({ suspend }),
  });

export const grantScope = (userId, type, value) =>
  apiFetch(`/admin/users/${encodeURIComponent(userId)}/scope`, {
    method: 'POST',
    body: JSON.stringify({ type, value, op: 'grant' }),
  });

export const revokeScope = (userId, type, value) =>
  apiFetch(`/admin/users/${encodeURIComponent(userId)}/scope`, {
    method: 'POST',
    body: JSON.stringify({ type, value, op: 'revoke' }),
  });

// ── Invites ─────────────────────────────────────────────────────
export const listInvites = () => apiFetch('/admin/invites');

export const createInvite = ({ email, role, scopes }) =>
  apiFetch('/admin/invites', {
    method: 'POST',
    body: JSON.stringify({ email, role, scopes }),
  });

// ── Domo catalog (used as the scope picker source) ──────────────
export const listDomoDashboards = () => apiFetch('/domo/dashboards');

// ── Auth self-info (Master-role gate in the UI) ─────────────────
export const getMe = () => apiFetch('/auth/me');

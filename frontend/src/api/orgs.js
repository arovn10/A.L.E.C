/**
 * frontend/src/api/orgs.js
 *
 * /api/orgs — list memberships, CRUD org members (owners only on the server).
 */
import { apiFetch } from './client.js';

export const listOrgs = () => apiFetch('/orgs');

export const listMembers = (orgId) => apiFetch(`/orgs/${orgId}/members`);

export const addMember = (orgId, body) =>
  apiFetch(`/orgs/${orgId}/members`, { method: 'POST', body: JSON.stringify(body) });

export const patchMember = (orgId, userId, body) =>
  apiFetch(`/orgs/${orgId}/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const removeMember = (orgId, userId) =>
  apiFetch(`/orgs/${orgId}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

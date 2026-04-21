/**
 * frontend/src/pages/Settings/OrgMembersTab.jsx
 *
 * S5.1 — org member management. Visible only when the active org's viewer
 * role is owner or admin. Owners can add/patch/remove; admins get read-only
 * rows (actions hidden). Plain members never see the tab (SettingsPage
 * gates its render).
 *
 * Backing endpoint: GET/POST/PATCH/DELETE /api/orgs/:id/members. Owner
 * restriction is enforced on the server (requireOrgRole); UI mirrors it to
 * avoid pointless 403s.
 */
import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import * as orgsApi from '../../api/orgs.js';
import { useOrg } from '../../context/OrgContext.jsx';

const ROLES = ['member', 'admin', 'owner'];

function useViewerRole(orgId) {
  // The caller's role in this org comes from whichever org_memberships row
  // matches. `GET /api/orgs` returns orgs but not roles; we derive role by
  // probing /members and catching 403 — cleaner would be a /me endpoint,
  // but this keeps the S5 blast radius tiny.
  const { data, isError, error } = useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => orgsApi.listMembers(orgId),
    enabled: !!orgId,
    retry: false,
  });
  return { members: data, denied: isError && /403/.test(String(error?.message || '')) };
}

export default function OrgMembersTab({ viewerEmail }) {
  const { current } = useOrg();
  const qc = useQueryClient();
  const orgId = current?.id || null;
  const { members, denied } = useViewerRole(orgId);

  const selfRow = Array.isArray(members) ? members.find(m => m.user_id === viewerEmail) : null;
  const viewerRole = selfRow?.role || null;
  const canEdit = viewerRole === 'owner';

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole]   = useState('member');

  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-members', orgId] });

  const add = useMutation({
    mutationFn: () => orgsApi.addMember(orgId, { userId: newEmail.trim(), role: newRole }),
    onSuccess: () => { setNewEmail(''); setNewRole('member'); invalidate(); },
  });
  const patch = useMutation({
    mutationFn: ({ userId, role }) => orgsApi.patchMember(orgId, userId, { role }),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: (userId) => orgsApi.removeMember(orgId, userId),
    onSuccess: invalidate,
  });

  if (!orgId) {
    return <div className="p-6 text-gray-400">Select an organization to manage members.</div>;
  }
  if (denied) {
    return <div className="p-6 text-gray-400">You don't have permission to view members of this organization.</div>;
  }

  return (
    <div className="p-6 space-y-6" data-testid="org-members-tab">
      <header className="flex items-center justify-between">
        <h2 className="text-white text-lg font-semibold">Members — {current?.name || orgId}</h2>
        <span className="text-xs text-gray-500">Viewer: {viewerRole || '—'}</span>
      </header>

      {canEdit && (
        <form
          className="flex flex-wrap items-end gap-2 rounded border border-alec-700 bg-alec-800 p-4"
          onSubmit={(e) => { e.preventDefault(); if (newEmail.trim()) add.mutate(); }}
        >
          <label className="flex-1 min-w-[12rem] text-sm">
            <span className="block font-medium text-gray-200">Email</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="teammate@example.com"
              className="mt-1 w-full rounded bg-alec-900 border border-alec-600 text-white text-sm px-2 py-1 focus:outline-none focus:border-alec-accent"
            />
          </label>
          <label className="text-sm">
            <span className="block font-medium text-gray-200">Role</span>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="mt-1 rounded bg-alec-900 border border-alec-600 text-white text-sm px-2 py-1"
            >
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <button
            type="submit"
            disabled={add.isPending || !newEmail.trim()}
            className="rounded bg-alec-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {add.isPending ? 'Adding…' : 'Add member'}
          </button>
          {add.error && <span className="w-full text-xs text-red-400">{String(add.error.message)}</span>}
        </form>
      )}

      <div className="rounded border border-alec-700 bg-alec-800">
        <div className="grid grid-cols-[1fr,8rem,10rem,6rem] gap-2 border-b border-alec-700 px-4 py-2 text-xs uppercase tracking-wide text-gray-400">
          <span>Email</span>
          <span>Role</span>
          <span>Created</span>
          <span className="text-right">Actions</span>
        </div>
        {!members && <div className="px-4 py-3 text-sm text-gray-500">Loading…</div>}
        {members && members.length === 0 && (
          <div className="px-4 py-3 text-sm text-gray-500">No members yet.</div>
        )}
        {members && members.map((m) => (
          <div
            key={m.user_id}
            className="grid grid-cols-[1fr,8rem,10rem,6rem] items-center gap-2 border-b border-alec-700 px-4 py-2 last:border-b-0 text-sm text-gray-200"
          >
            <span>{m.user_id}</span>
            {canEdit && m.user_id !== viewerEmail ? (
              <select
                value={m.role}
                onChange={(e) => patch.mutate({ userId: m.user_id, role: e.target.value })}
                className="rounded bg-alec-900 border border-alec-600 text-white text-xs px-2 py-1"
              >
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : (
              <span className="text-gray-400">{m.role}</span>
            )}
            <span className="text-gray-500 text-xs">{m.created_at || '—'}</span>
            <span className="text-right">
              {canEdit && m.user_id !== viewerEmail ? (
                <button
                  onClick={() => {
                    if (confirm(`Remove ${m.user_id} from this org?`)) del.mutate(m.user_id);
                  }}
                  className="rounded border border-red-500/40 px-2 py-0.5 text-xs text-red-300 hover:bg-red-500/10"
                >
                  Remove
                </button>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

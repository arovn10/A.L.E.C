/**
 * frontend/src/pages/Settings/ConnectorDrawer.jsx
 *
 * Right-hand slide-over for creating / editing / testing / revealing /
 * deleting a connector instance. For new connectors `selected` is
 * `{ new: true, definitionId }`; for existing ones it is the instance id.
 */
import { useState, useEffect, useRef } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import * as api from '../../api/connectors.js';
import { useOrg } from '../../context/OrgContext.jsx';
import ConnectorFormField from './ConnectorFormField.jsx';

// S5.2 — how long revealed plaintext stays visible before auto re-hide.
const REVEAL_VISIBLE_MS = 60_000;

export default function ConnectorDrawer({ selected, scope, orgId, userEmail, onClose }) {
  const qc = useQueryClient();
  const isNew = selected && selected.new === true;
  const id = isNew ? null : selected;

  const { data: existing } = useQuery({
    queryKey: ['connector', id],
    queryFn: () => api.getConnector(id),
    enabled: !!id,
  });

  const { data: catalog = [] } = useQuery({
    queryKey: ['catalog'],
    queryFn: api.getCatalog,
    staleTime: 5 * 60_000,
  });

  const definitionId = isNew ? selected.definitionId : existing?.definition_id;
  const def = catalog.find((c) => c.id === definitionId);

  const [fields, setFields] = useState({});
  const [displayName, setDisplayName] = useState('');
  const [notice, setNotice] = useState(null);
  // S5.2 — reveal countdown. `revealUntil` is an epoch ms deadline; when
  // set, a 1Hz tick updates `revealLeft` (remaining seconds) and at zero
  // we snap fields back to the redacted copy. Stored redacted snapshot
  // captures what the list had *before* the reveal mutation fired.
  const [revealUntil, setRevealUntil] = useState(null);
  const [revealLeft,  setRevealLeft]  = useState(0);
  const redactedSnapshot = useRef(null);

  useEffect(() => {
    if (existing) {
      setFields(existing.fields || {});
      setDisplayName(existing.display_name || '');
    } else if (isNew) {
      setFields({});
      setDisplayName('');
    }
  }, [existing, isNew]);

  const invalidateLists = () => qc.invalidateQueries({ queryKey: ['connectors'] });

  const save = useMutation({
    mutationFn: () => {
      if (isNew) {
        return api.createConnector({
          definitionId: def.id,
          scope,
          scopeId: scope === 'org' ? orgId : userEmail,
          fields,
          displayName: displayName || undefined,
        });
      }
      return api.patchConnector(id, { fields, displayName });
    },
    onSuccess: () => { invalidateLists(); onClose(); },
  });

  const test = useMutation({
    mutationFn: () => api.testConnector(id),
    onSuccess: (r) => {
      setNotice({ kind: r?.ok === false ? 'error' : 'ok', text: r?.message || (r?.ok === false ? 'Test failed' : 'Connection OK') });
      invalidateLists();
    },
    onError: (e) => setNotice({ kind: 'error', text: String(e.message) }),
  });

  const reveal = useMutation({
    mutationFn: () => api.revealConnector(id),
    onSuccess: (r) => {
      if (r?.fields) {
        // Snapshot the currently redacted values so we can snap back when
        // the 60-second window expires without a second round-trip.
        redactedSnapshot.current = { ...fields };
        setFields(r.fields);
        setRevealUntil(Date.now() + REVEAL_VISIBLE_MS);
      }
      setNotice({ kind: 'ok', text: 'Secrets revealed (audit logged).' });
    },
    onError: (e) => setNotice({ kind: 'error', text: String(e.message) }),
  });

  // Countdown tick. We read `revealUntil` fresh each tick rather than
  // depending on it to avoid restarting the interval when the deadline is
  // set; cleanup fires on unmount or when we clear the deadline.
  useEffect(() => {
    if (!revealUntil) { setRevealLeft(0); return; }
    const update = () => {
      const ms = Math.max(0, revealUntil - Date.now());
      setRevealLeft(Math.ceil(ms / 1000));
      if (ms <= 0) {
        setRevealUntil(null);
        if (redactedSnapshot.current) setFields(redactedSnapshot.current);
        redactedSnapshot.current = null;
      }
    };
    update();
    const h = setInterval(update, 1000);
    return () => clearInterval(h);
  }, [revealUntil]);

  const onRevealClick = () => {
    if (revealUntil) return; // already revealed; ignore double-clicks
    if (!confirm('Reveal plaintext credentials? This action is audit-logged.')) return;
    reveal.mutate();
  };

  const del = useMutation({
    mutationFn: () => api.deleteConnector(id),
    onSuccess: () => { invalidateLists(); onClose(); },
  });

  // S5.3 — "Move to…" targets. We don't know the caller's role per org from
  // the OrgContext membership list, so we show every org they belong to;
  // the server 403s if they lack admin/owner and we surface the error.
  const { orgs } = useOrg();
  const [showMove, setShowMove] = useState(false);
  const [moveTarget, setMoveTarget] = useState('');
  const move = useMutation({
    mutationFn: ({ scope, scopeId }) => api.moveConnector(id, { scope, scopeId }),
    onSuccess: () => {
      setShowMove(false);
      setNotice({ kind: 'ok', text: 'Moved.' });
      invalidateLists();
      qc.invalidateQueries({ queryKey: ['connector', id] });
    },
    onError: (e) => setNotice({ kind: 'error', text: String(e.message) }),
  });

  if (!def) return null;

  return (
    <aside className="fixed right-0 top-0 z-40 h-full w-96 overflow-auto border-l border-alec-700 bg-alec-900 p-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          <span className="text-xs text-gray-500 mr-2">[{def.icon}]</span>
          {def.name}
        </h3>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white">×</button>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block text-sm">
          <span className="font-medium text-gray-200">Display name</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={def.name}
            className="mt-1 w-full rounded bg-alec-800 border border-alec-600 text-white text-sm px-2 py-1 focus:outline-none focus:border-alec-accent"
          />
        </label>
        {def.fields.map((f) => (
          <ConnectorFormField
            key={f.key}
            field={f}
            value={fields[f.key]}
            onChange={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded bg-alec-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? 'Saving...' : 'Save'}
        </button>
        {!isNew && (
          <>
            <button
              onClick={() => test.mutate()}
              disabled={test.isPending}
              className="rounded border border-alec-600 px-3 py-1 text-sm text-gray-200 hover:bg-alec-700"
            >
              Test
            </button>
            <button
              onClick={onRevealClick}
              disabled={reveal.isPending || !!revealUntil}
              className="rounded border border-alec-600 px-3 py-1 text-sm text-gray-200 hover:bg-alec-700 disabled:opacity-50"
            >
              {revealUntil ? `Revealed (${revealLeft}s)` : reveal.isPending ? 'Revealing…' : 'Reveal'}
            </button>
            <button
              onClick={() => setShowMove((v) => !v)}
              className="rounded border border-alec-600 px-3 py-1 text-sm text-gray-200 hover:bg-alec-700"
            >
              Move to…
            </button>
            <button
              onClick={() => { if (confirm('Delete this connector? This cannot be undone.')) del.mutate(); }}
              className="rounded border border-red-500/40 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
          </>
        )}
      </div>

      {showMove && !isNew && (
        <div className="mt-4 rounded border border-alec-700 bg-alec-800 p-3 space-y-2">
          <label className="block text-sm">
            <span className="font-medium text-gray-200">New scope</span>
            <select
              value={moveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              className="mt-1 w-full rounded bg-alec-900 border border-alec-600 text-white text-sm px-2 py-1"
            >
              <option value="">— Select —</option>
              <option value="user:me">Personal (user scope)</option>
              {orgs.map((o) => (
                <option key={o.id} value={`org:${o.id}`}>Org: {o.name || o.id}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (!moveTarget) return;
                const [scope, scopeId] = moveTarget.split(':');
                move.mutate({
                  scope,
                  scopeId: scope === 'user' ? (existing?.created_by || existing?.scope_id) : scopeId,
                });
              }}
              disabled={!moveTarget || move.isPending}
              className="rounded bg-alec-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {move.isPending ? 'Moving…' : 'Confirm move'}
            </button>
            <button
              onClick={() => setShowMove(false)}
              className="text-xs text-gray-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {save.error && (
        <div className="mt-3 text-xs text-red-400">Save failed: {String(save.error.message)}</div>
      )}
      {notice && (
        <div className={`mt-3 text-xs ${notice.kind === 'error' ? 'text-red-400' : 'text-green-400'}`}>
          {notice.text}
        </div>
      )}
    </aside>
  );
}

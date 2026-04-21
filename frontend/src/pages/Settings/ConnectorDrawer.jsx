/**
 * frontend/src/pages/Settings/ConnectorDrawer.jsx
 *
 * Right-hand slide-over for creating / editing / testing / revealing /
 * deleting a connector instance. For new connectors `selected` is
 * `{ new: true, definitionId }`; for existing ones it is the instance id.
 */
import { useState, useEffect } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import * as api from '../../api/connectors.js';
import ConnectorFormField from './ConnectorFormField.jsx';

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
    onSuccess: (r) => { if (r?.fields) setFields(r.fields); setNotice({ kind: 'ok', text: 'Secrets revealed (audit logged).' }); },
    onError: (e) => setNotice({ kind: 'error', text: String(e.message) }),
  });

  const del = useMutation({
    mutationFn: () => api.deleteConnector(id),
    onSuccess: () => { invalidateLists(); onClose(); },
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
              onClick={() => reveal.mutate()}
              disabled={reveal.isPending}
              className="rounded border border-alec-600 px-3 py-1 text-sm text-gray-200 hover:bg-alec-700"
            >
              Reveal
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

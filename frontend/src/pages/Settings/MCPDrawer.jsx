/**
 * frontend/src/pages/Settings/MCPDrawer.jsx
 *
 * CRUD + lifecycle drawer for MCP servers. For `selected.new === true`
 * the user is creating; otherwise `selected` is the row id. Actions:
 * Save / Test / Start / Stop / Delete.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import * as api from '../../api/mcp.js';
import * as connectorsApi from '../../api/connectors.js';

export default function MCPDrawer({ selected, scope, orgId, userEmail, onClose }) {
  const qc = useQueryClient();
  const isNew = selected && selected.new === true;
  const id = isNew ? null : selected;

  const { data: existing } = useQuery({
    queryKey: ['mcp', id],
    queryFn: () => api.getMcp(id),
    enabled: !!id,
  });

  const { data: connectorInstances = [] } = useQuery({
    queryKey: ['connectors', scope, scope === 'org' ? orgId || null : null],
    queryFn: () => connectorsApi.listConnectors(
      scope === 'org' ? { scope: 'org', orgId } : { scope: 'user' }
    ),
    enabled: scope !== 'org' || !!orgId,
  });

  const [form, setForm] = useState({
    name: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    url: '',
    envRefIds: [],
    enabled: true,
    autoStart: false,
  });
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || '',
        transport: existing.transport || 'stdio',
        command: existing.command || '',
        argsText: (existing.args || []).join(', '),
        url: existing.url || '',
        envRefIds: existing.env_ref_ids || [],
        enabled: !!existing.enabled,
        autoStart: !!existing.auto_start,
      });
    } else if (isNew) {
      setForm({
        name: '', transport: 'stdio', command: '', argsText: '', url: '',
        envRefIds: [], enabled: true, autoStart: false,
      });
    }
  }, [existing, isNew]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['mcps'] });

  const toPayload = () => ({
    name: form.name,
    transport: form.transport,
    command: form.transport === 'stdio' ? form.command : undefined,
    args: form.transport === 'stdio'
      ? form.argsText.split(',').map(s => s.trim()).filter(Boolean)
      : undefined,
    url: form.transport !== 'stdio' ? form.url : undefined,
    envRefIds: form.envRefIds,
    enabled: form.enabled,
    autoStart: form.autoStart,
  });

  const save = useMutation({
    mutationFn: () => {
      if (isNew) {
        return api.createMcp({
          ...toPayload(),
          scope,
          scopeId: scope === 'org' ? orgId : userEmail,
        });
      }
      return api.patchMcp(id, toPayload());
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e) => setNotice({ kind: 'error', text: String(e.message) }),
  });

  const test = useMutation({
    mutationFn: () => api.testMcp(id),
    onSuccess: (r) => {
      setNotice({ kind: r?.ok === false ? 'error' : 'ok', text: r?.ok === false ? `Test failed: ${r.error}` : 'Handshake OK' });
      invalidate();
    },
    onError: (e) => setNotice({ kind: 'error', text: String(e.message) }),
  });
  const start = useMutation({ mutationFn: () => api.startMcp(id), onSuccess: invalidate });
  const stop  = useMutation({ mutationFn: () => api.stopMcp(id),  onSuccess: invalidate });
  const del   = useMutation({ mutationFn: () => api.deleteMcp(id), onSuccess: () => { invalidate(); onClose(); } });

  const toggleEnv = (instId) => {
    setForm((f) => ({
      ...f,
      envRefIds: f.envRefIds.includes(instId)
        ? f.envRefIds.filter(x => x !== instId)
        : [...f.envRefIds, instId],
    }));
  };

  return (
    <aside className="fixed right-0 top-0 z-40 h-full w-96 overflow-auto border-l border-alec-700 bg-alec-900 p-6 shadow-2xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          {isNew ? 'New MCP server' : existing?.name || 'MCP server'}
        </h3>
        <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-white">×</button>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block text-sm">
          <span className="font-medium text-gray-200">Name</span>
          <input
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            className="mt-1 w-full rounded bg-alec-800 border border-alec-600 text-white text-sm px-2 py-1"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium text-gray-200">Transport</span>
          <select
            value={form.transport}
            onChange={(e) => setForm(f => ({ ...f, transport: e.target.value }))}
            className="mt-1 w-full rounded bg-alec-800 border border-alec-600 text-white text-sm px-2 py-1"
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
          </select>
        </label>

        {form.transport === 'stdio' ? (
          <>
            <label className="block text-sm">
              <span className="font-medium text-gray-200">Command</span>
              <input
                value={form.command}
                onChange={(e) => setForm(f => ({ ...f, command: e.target.value }))}
                placeholder="/usr/bin/node"
                className="mt-1 w-full rounded bg-alec-800 border border-alec-600 text-white text-sm px-2 py-1"
              />
            </label>
            <label className="block text-sm">
              <span className="font-medium text-gray-200">Args (comma-separated)</span>
              <input
                value={form.argsText}
                onChange={(e) => setForm(f => ({ ...f, argsText: e.target.value }))}
                placeholder="server.js, --verbose"
                className="mt-1 w-full rounded bg-alec-800 border border-alec-600 text-white text-sm px-2 py-1"
              />
            </label>
          </>
        ) : (
          <label className="block text-sm">
            <span className="font-medium text-gray-200">URL</span>
            <input
              value={form.url}
              onChange={(e) => setForm(f => ({ ...f, url: e.target.value }))}
              placeholder="https://example.com/mcp"
              className="mt-1 w-full rounded bg-alec-800 border border-alec-600 text-white text-sm px-2 py-1"
            />
          </label>
        )}

        <div className="text-sm">
          <span className="font-medium text-gray-200">Env from connectors</span>
          <div className="mt-1 max-h-32 overflow-auto rounded border border-alec-600 bg-alec-800 p-2 text-xs text-gray-300">
            {connectorInstances.length === 0 && <div className="text-gray-500">No connectors to reference.</div>}
            {connectorInstances.map((c) => (
              <label key={c.id} className="flex items-center gap-2 py-0.5">
                <input
                  type="checkbox"
                  checked={form.envRefIds.includes(c.id)}
                  onChange={() => toggleEnv(c.id)}
                />
                <span>{c.display_name || c.definition_id}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-gray-200">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            Enabled
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.autoStart} onChange={(e) => setForm(f => ({ ...f, autoStart: e.target.checked }))} />
            Auto-start
          </label>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="rounded bg-alec-accent px-3 py-1 text-sm text-white hover:opacity-90 disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {!isNew && (
          <>
            <button onClick={() => test.mutate()} className="rounded border border-alec-600 px-3 py-1 text-sm text-gray-200 hover:bg-alec-700">Test</button>
            {existing?.status === 'running'
              ? <button onClick={() => stop.mutate()} className="rounded border border-alec-600 px-3 py-1 text-sm text-gray-200 hover:bg-alec-700">Stop</button>
              : <button onClick={() => start.mutate()} className="rounded border border-alec-600 px-3 py-1 text-sm text-gray-200 hover:bg-alec-700">Start</button>}
            <button
              onClick={() => { if (confirm('Delete this MCP server?')) del.mutate(); }}
              className="rounded border border-red-500/40 px-3 py-1 text-sm text-red-300 hover:bg-red-500/10"
            >
              Delete
            </button>
          </>
        )}
      </div>

      {existing?.tools?.length > 0 && (
        <details className="mt-4 text-xs text-gray-300">
          <summary className="cursor-pointer text-gray-400">Tools ({existing.tools.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {existing.tools.map((t, i) => <li key={i}>{t.name || JSON.stringify(t)}</li>)}
          </ul>
        </details>
      )}

      {notice && (
        <div className={`mt-3 text-xs ${notice.kind === 'error' ? 'text-red-400' : 'text-green-400'}`}>
          {notice.text}
        </div>
      )}
    </aside>
  );
}

/**
 * frontend/src/pages/Settings/MCPsTab.jsx
 *
 * Sidebar sections: Installed (running+stopped), Discover (catalog stub),
 * Custom (everything). Middle pane is an MCPList; drawer opens on click.
 */
import { useState } from 'react';
import { useOrg } from '../../context/OrgContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useScopedMCPs, useMcpCatalog } from '../../hooks/useScopedMCPs.js';
import MCPList from './MCPList.jsx';
import MCPDrawer from './MCPDrawer.jsx';

const SECTIONS = [
  { id: 'installed', label: 'Installed' },
  { id: 'discover',  label: 'Discover' },
  { id: 'custom',    label: 'Custom' },
];

export default function MCPsTab() {
  const [scope, setScope] = useState('user');
  const [section, setSection] = useState('installed');
  const [selected, setSelected] = useState(null);
  const { current } = useOrg();
  const { user } = useAuth();
  const userEmail = user?.email || localStorage.getItem('alec.userEmail') || '';

  const { data: rows = [], isLoading } = useScopedMCPs(scope, current?.id);
  const { data: catalogData = { entries: [], categories: [] } } = useMcpCatalog();
  const catalog = catalogData.entries || [];
  const categories = catalogData.categories || [];
  const [catCategory, setCatCategory] = useState('All');

  const visibleCatalog = catCategory === 'All'
    ? catalog
    : catalog.filter((c) => c.category === catCategory);

  const installFromCatalog = (entry) => setSelected({
    new: true,
    prefill: {
      name: entry.name,
      transport: entry.transport,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      source: entry.id,
    },
  });

  const filtered =
    section === 'installed'
      ? rows.filter(r => r.status === 'running' || r.status === 'stopped' || !r.status)
      : rows;

  return (
    <div className="flex h-full" data-testid="mcps-tab">
      <aside className="w-56 border-r border-alec-700 bg-alec-800 p-4">
        <div className="mb-4 flex rounded bg-alec-900 p-1 text-xs">
          <button
            onClick={() => setScope('user')}
            className={`flex-1 rounded py-1 ${scope === 'user' ? 'bg-alec-700 text-white shadow' : 'text-gray-400'}`}
          >
            Personal
          </button>
          <button
            onClick={() => setScope('org')}
            disabled={!current}
            title={!current ? 'Select an organization to enable' : undefined}
            className={`flex-1 rounded py-1 ${scope === 'org' ? 'bg-alec-700 text-white shadow' : 'text-gray-400'} disabled:opacity-40`}
          >
            Organization
          </button>
        </div>
        <div className="space-y-1">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${
                section === s.id
                  ? 'bg-alec-accent/20 text-white font-medium'
                  : 'text-gray-300 hover:bg-alec-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex-1 p-4">
        {section === 'discover' ? (
          catalog.length === 0 ? (
            <div className="text-gray-500 text-sm">MCP catalog is empty. Register custom servers via the Custom tab.</div>
          ) : (
            <div>
              <div className="mb-3 flex flex-wrap gap-1 text-xs">
                <button
                  onClick={() => setCatCategory('All')}
                  className={`rounded px-2 py-1 ${catCategory === 'All' ? 'bg-alec-accent/30 text-white' : 'bg-alec-900 text-gray-400 hover:bg-alec-700'}`}
                >
                  All · {catalog.length}
                </button>
                {categories.map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setCatCategory(c.name)}
                    className={`rounded px-2 py-1 ${catCategory === c.name ? 'bg-alec-accent/30 text-white' : 'bg-alec-900 text-gray-400 hover:bg-alec-700'}`}
                  >
                    {c.name} · {c.count}
                  </button>
                ))}
              </div>
              <ul className="space-y-2">
                {visibleCatalog.map((e) => (
                  <li key={e.id} className="rounded border border-alec-700 bg-alec-800 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-white">{e.name}</h4>
                          <span className="rounded bg-alec-900 px-1.5 py-0.5 text-[10px] text-gray-500">{e.publisher}</span>
                          <span className="rounded bg-alec-900 px-1.5 py-0.5 text-[10px] text-gray-500">{e.category}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-400">{e.description}</p>
                        <p className="mt-1 font-mono text-[11px] text-gray-500 truncate">
                          {e.command} {(e.args || []).join(' ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {e.docs && (
                          <a
                            href={e.docs} target="_blank" rel="noreferrer"
                            className="rounded border border-alec-700 px-2 py-1 text-xs text-gray-300 hover:bg-alec-700"
                          >
                            Docs
                          </a>
                        )}
                        <button
                          onClick={() => installFromCatalog(e)}
                          className="rounded bg-alec-accent/80 px-2 py-1 text-xs font-medium text-white hover:bg-alec-accent"
                        >
                          + Install
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )
        ) : (
          <MCPList
            rows={filtered}
            loading={isLoading}
            onSelect={setSelected}
            onCreate={() => setSelected({ new: true })}
          />
        )}
      </section>

      {selected && (
        <MCPDrawer
          selected={selected}
          scope={scope}
          orgId={current?.id}
          userEmail={userEmail}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

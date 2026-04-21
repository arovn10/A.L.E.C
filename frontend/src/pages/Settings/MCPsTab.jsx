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
  const { data: catalog = [] } = useMcpCatalog();

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
          catalog.length === 0
            ? <div className="text-gray-500 text-sm">MCP catalog is empty. Register custom servers via the Custom tab.</div>
            : <div className="text-gray-300 text-sm">{catalog.length} catalog entries.</div>
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

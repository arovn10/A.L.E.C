/**
 * frontend/src/pages/Settings/ConnectorsTab.jsx
 *
 * Option A layout: left sidebar (scope toggle + categories), middle list,
 * right-hand drawer when an instance is selected.
 */
import { useState } from 'react';
import { useOrg } from '../../context/OrgContext.jsx';
import { useCatalog, useScopedConnectors } from '../../hooks/useScopedConnectors.js';
import { useAuth } from '../../context/AuthContext.jsx';
import ConnectorList from './ConnectorList.jsx';
import ConnectorDrawer from './ConnectorDrawer.jsx';

const CATEGORIES = [
  { id: 'source-control', label: 'Source Control' },
  { id: 'productivity',   label: 'Productivity' },
  { id: 'data',           label: 'Data' },
  { id: 'comms',          label: 'Comms' },
  { id: 'finance',        label: 'Finance' },
  { id: 'smart-home',     label: 'Smart Home' },
];

export default function ConnectorsTab() {
  const [scope, setScope] = useState('user');
  const [category, setCategory] = useState('source-control');
  const [selected, setSelected] = useState(null);
  const { current } = useOrg();
  const { user } = useAuth();
  const userEmail = user?.email || localStorage.getItem('alec.userEmail') || '';

  const { data: catalog = [] } = useCatalog();
  const { data: instances = [], isLoading } = useScopedConnectors(scope, current?.id);

  const catForCategory = catalog.filter((c) => c.category === category);
  const instancesForCategory = instances.filter((i) => {
    const def = catalog.find((c) => c.id === i.definition_id);
    return def?.category === category;
  });

  return (
    <div className="flex h-full">
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
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${
                category === c.id
                  ? 'bg-alec-accent/20 text-white font-medium'
                  : 'text-gray-300 hover:bg-alec-700'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </aside>

      <section className="flex-1 p-4">
        <ConnectorList
          catalog={catForCategory}
          instances={instancesForCategory}
          loading={isLoading}
          onSelect={setSelected}
        />
      </section>

      {selected && (
        <ConnectorDrawer
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

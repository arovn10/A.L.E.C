/**
 * frontend/src/pages/Settings/ConnectorList.jsx
 *
 * Per-definition card. Each card gets a "+ Connect" button and a row per
 * existing instance (rows clickable to open the drawer). Status badges
 * mirror connector_instance.status from the backend.
 *
 * S5.4: skeleton rows during load, per-category EmptyState when this
 * entire category has zero catalog entries (no cards to show at all).
 */
import Skeleton from '../../components/ui/Skeleton.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

export default function ConnectorList({ catalog, instances, loading, onSelect }) {
  if (loading) {
    return <Skeleton rows={3} />;
  }
  if (!catalog.length) {
    return (
      <EmptyState
        text="No connectors in this category."
      />
    );
  }
  return (
    <div className="space-y-4">
      {catalog.map((def) => {
        const rows = instances.filter((i) => i.definition_id === def.id);
        return (
          <div key={def.id} className="rounded border border-alec-700 bg-alec-800">
            <div className="flex items-center justify-between border-b border-alec-700 px-4 py-2">
              <div className="text-white font-medium text-sm">
                <span className="text-xs text-gray-500 mr-2">[{def.icon}]</span>
                {def.name}
              </div>
              <button
                onClick={() => onSelect({ new: true, definitionId: def.id })}
                className="text-xs text-alec-accent hover:underline"
              >
                + Connect
              </button>
            </div>
            {rows.length === 0 ? (
              <div className="px-4 py-3">
                <EmptyState
                  icon={def.icon}
                  text={`No ${def.name} connectors yet.`}
                  onAction={() => onSelect({ new: true, definitionId: def.id })}
                />
              </div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => onSelect(r.id)}
                  className="flex w-full items-center justify-between border-t border-alec-700 px-4 py-2 text-left text-sm text-gray-200 hover:bg-alec-700"
                >
                  <span>{r.display_name || def.name}</span>
                  <span
                    className={`text-xs ${
                      r.status === 'connected'
                        ? 'text-green-400'
                        : r.status === 'error'
                        ? 'text-red-400'
                        : 'text-gray-500'
                    }`}
                  >
                    {r.status || 'untested'}
                  </span>
                </button>
              ))
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * frontend/src/pages/Settings/MCPList.jsx
 *
 * Flat list of MCP rows. Each row shows transport + status + start/stop
 * toggle. Clicking the row opens the drawer.
 */
import { useQueryClient, useMutation } from '@tanstack/react-query';
import * as api from '../../api/mcp.js';
import Skeleton from '../../components/ui/Skeleton.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';

function StatusBadge({ status }) {
  const color =
    status === 'running' ? 'text-green-400'
    : status === 'error' ? 'text-red-400'
    : 'text-gray-500';
  return <span className={`text-xs ${color}`}>{status || 'stopped'}</span>;
}

export default function MCPList({ rows, loading, onSelect, onCreate }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['mcps'] });

  const start = useMutation({ mutationFn: api.startMcp, onSuccess: invalidate });
  const stop  = useMutation({ mutationFn: api.stopMcp,  onSuccess: invalidate });

  if (loading) return <Skeleton rows={3} />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-white text-sm font-medium">MCP servers</h2>
        <button onClick={onCreate} className="text-xs text-alec-accent hover:underline">
          + Add server
        </button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          text="No MCP servers in this scope."
          actionLabel="+ Add server"
          onAction={onCreate}
        />
      ) : (
        <div className="rounded border border-alec-700 bg-alec-800">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between border-b border-alec-700 px-4 py-2 last:border-b-0 hover:bg-alec-700"
            >
              <button onClick={() => onSelect(r.id)} className="flex-1 text-left">
                <div className="text-sm text-white">{r.name}</div>
                <div className="text-xs text-gray-500">
                  {r.transport}
                  {r.transport === 'stdio' && r.command ? ` • ${r.command}` : ''}
                </div>
              </button>
              <div className="flex items-center gap-3">
                <StatusBadge status={r.status} />
                {r.status === 'running' ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); stop.mutate(r.id); }}
                    className="rounded border border-alec-600 px-2 py-0.5 text-xs text-gray-200 hover:bg-alec-900"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); start.mutate(r.id); }}
                    className="rounded bg-alec-accent px-2 py-0.5 text-xs text-white hover:opacity-90"
                  >
                    Start
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * frontend/src/components/ui/Skeleton.jsx
 *
 * S5.4 — tiny pulsing-gray placeholder used by list/tab loading states.
 * Defaults to 3 rows because that's what Connectors/MCPs lists use.
 */
export default function Skeleton({ rows = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} data-testid="skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 animate-pulse rounded bg-alec-700/50" />
      ))}
    </div>
  );
}

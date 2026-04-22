/**
 * frontend/src/components/ui/EmptyState.jsx
 *
 * S5.4 — compact illustration-free empty state. Shown when a category or
 * list has zero items; exposes an optional call-to-action button.
 *
 * Props:
 *  - icon: small string/emoji identifier from the catalog def (optional)
 *  - text: description line
 *  - actionLabel: CTA button label (default "+ Connect")
 *  - onAction: click handler — CTA hidden when absent
 */
export default function EmptyState({ icon, text, actionLabel = '+ Connect', onAction }) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center gap-2 rounded border border-dashed border-alec-700 px-4 py-6 text-center"
    >
      {icon && (
        <div className="text-xl text-gray-500" aria-hidden="true">
          [{icon}]
        </div>
      )}
      <div className="text-sm text-gray-400">{text}</div>
      {onAction && (
        <button
          onClick={onAction}
          className="mt-1 rounded bg-alec-accent px-3 py-1 text-xs text-white hover:opacity-90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/**
 * frontend/src/components/ml/WhatsNewCard.jsx
 *
 * Dashboard card — what changed since the previous nightly run:
 *   • newly-predictable metrics (crossed the skill threshold)
 *   • regime shifts (champion family changed)
 *   • lost predictions (no champion this run)
 */
import { useEffect, useState } from 'react';
import { getWhatsNew } from '../../api/ml';

function Section({ title, items, color, render }) {
  if (!items?.length) return null;
  return (
    <div className="mb-3">
      <div className={`text-xs uppercase tracking-wide mb-1 ${color}`}>{title} ({items.length})</div>
      <ul className="space-y-1">
        {items.slice(0, 8).map((x, i) => (
          <li key={i} className="text-xs text-white/90 font-mono truncate">{render(x)}</li>
        ))}
      </ul>
    </div>
  );
}

export default function WhatsNewCard() {
  const [diff, setDiff] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    getWhatsNew().then(({ data }) => setDiff(data || {})).catch(e => setErr(e.message));
  }, []);
  if (err) return <div className="rounded-lg bg-alec-800 p-4 text-red-400 text-sm">Error: {err}</div>;
  if (!diff) return <div className="rounded-lg bg-alec-800 p-4 text-alec-400 text-sm">Loading…</div>;
  const total = (diff.newlyPredictable?.length || 0) + (diff.regimeShift?.length || 0) + (diff.lost?.length || 0);
  return (
    <div className="rounded-lg bg-alec-800 p-4 shadow">
      <h3 className="text-lg font-semibold text-white mb-3">What’s New</h3>
      {total === 0 ? (
        <div className="text-alec-400 text-sm">No run-over-run changes detected.</div>
      ) : (
        <>
          <Section title="Newly predictable" color="text-emerald-400"
            items={diff.newlyPredictable}
            render={x => `${x.target} → ${x.family} @ ${Math.round((x.skill || 0) * 100)}%`} />
          <Section title="Regime shift" color="text-amber-400"
            items={diff.regimeShift}
            render={x => `${x.target}: ${x.prevFamily} → ${x.family}`} />
          <Section title="Lost" color="text-red-400"
            items={diff.lost}
            render={x => `${x.target} (was ${x.prevFamily})`} />
        </>
      )}
    </div>
  );
}

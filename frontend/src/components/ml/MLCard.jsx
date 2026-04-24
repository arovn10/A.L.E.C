/**
 * frontend/src/components/ml/MLCard.jsx
 *
 * Dashboard card — "Top Predictable Metrics" from the latest nightly run.
 * Each row:
 *   - target path
 *   - skill% + family badge
 *   - drift badge (green ok / amber warn / red demoted)
 *   - narrative
 *   - sparkline
 *   - click → ModelDetailModal drill-through
 */
import { useEffect, useState } from 'react';
import { getRecommendations, listRuns, triggerNightly } from '../../api/ml';
import ForecastChart from './ForecastChart';
import ModelDetailModal from './ModelDetailModal';

function driftClass(score) {
  if (score == null) return 'text-alec-400';           // never evaluated
  if (score <= 1.1) return 'text-emerald-400';         // healthy
  if (score <= 1.3) return 'text-amber-400';           // drifting
  return 'text-red-400';                               // would be demoted next run
}
function driftLabel(score, demotedAt) {
  if (demotedAt) return 'demoted';
  if (score == null) return 'fresh';
  return `drift ×${(+score).toFixed(2)}`;
}

export default function MLCard() {
  const [recs, setRecs] = useState(null);
  const [run, setRun] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [openTarget, setOpenTarget] = useState(null);

  async function load() {
    setErr(null);
    try {
      const [{ data: r }, { data: runs }] = await Promise.all([getRecommendations(), listRuns()]);
      setRecs(r || []);
      setRun(runs?.[0] || null);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function runNow() {
    setBusy(true);
    try { await triggerNightly(); setTimeout(load, 3000); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg bg-alec-800 p-4 shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">Nightly ML — Top Predictable Metrics</h3>
        <button onClick={runNow} disabled={busy}
          className="text-xs px-3 py-1 rounded bg-alec-600 hover:bg-alec-500 text-white disabled:opacity-50">
          {busy ? 'Running…' : 'Run now'}
        </button>
      </div>
      {run && (
        <p className="text-xs text-alec-300 mb-3">
          Last run: {new Date(run.StartedAt).toLocaleString()} · {run.Status} ·
          {' '}{run.NChampions}/{run.NCandidates} champions · {run.NModelsFit} models fit
        </p>
      )}
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}
      {!recs && !err && <div className="text-alec-400 text-sm">Loading…</div>}
      {recs && recs.length === 0 && (
        <div className="text-alec-400 text-sm">No predictable metrics yet. Trigger a run to begin.</div>
      )}
      {recs && recs.length > 0 && (
        <ul className="space-y-3">
          {recs.slice(0, 10).map(m => (
            <li key={m.ModelId}
                onClick={() => setOpenTarget(m.Target)}
                className="border-b border-alec-700 pb-2 cursor-pointer hover:bg-alec-700/30 rounded px-2 -mx-2 transition-colors">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-sm text-white font-mono truncate">{m.Target}</div>
                <div className="flex items-center gap-2 text-xs whitespace-nowrap">
                  <span className="text-emerald-400">
                    {Math.round((m.SkillVsNaive || 0) * 100)}% · {m.Family}
                  </span>
                  <span className={driftClass(m.DriftScore)} title={m.DemotionReason || ''}>
                    {driftLabel(m.DriftScore, m.DemotedAt)}
                  </span>
                </div>
              </div>
              {m.NarrativeText && <div className="text-xs text-alec-300 mt-1">{m.NarrativeText}</div>}
              {m.Forecast?.points?.length > 0 && (
                <div className="mt-2"><ForecastChart points={m.Forecast.points} /></div>
              )}
            </li>
          ))}
        </ul>
      )}
      {openTarget && (
        <ModelDetailModal target={openTarget} onClose={() => setOpenTarget(null)} />
      )}
    </div>
  );
}

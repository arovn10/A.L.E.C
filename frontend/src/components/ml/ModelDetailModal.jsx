/**
 * frontend/src/components/ml/ModelDetailModal.jsx
 *
 * Click a champion on MLCard → open this modal to see the full panel
 * (all candidate families, per-fold CV metrics, params, forecast).
 */
import { useEffect, useState } from 'react';
import { listModels } from '../../api/ml';
import ForecastChart from './ForecastChart';

function fmt(x) {
  if (x === null || x === undefined || !Number.isFinite(+x)) return '–';
  const v = +x;
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0)) return v.toExponential(2);
  return v.toFixed(3);
}

export default function ModelDetailModal({ target, onClose }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listModels(target).then(({ data }) => { if (!cancelled) setRows(data || []); })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [target]);

  const champ = rows?.[0];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-alec-800 rounded-lg shadow-xl max-w-3xl w-[90%] max-h-[85vh] overflow-y-auto p-6"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white font-mono">{target}</h2>
            {champ?.NarrativeText && <p className="text-xs text-alec-300 mt-1">{champ.NarrativeText}</p>}
          </div>
          <button onClick={onClose} className="text-alec-300 hover:text-white text-xl leading-none">×</button>
        </div>

        {err && <div className="text-red-400 text-sm">{err}</div>}
        {!rows && !err && <div className="text-alec-400 text-sm">Loading…</div>}

        {champ?.Forecast?.points?.length > 0 && (
          <div className="mb-4">
            <div className="text-xs uppercase text-alec-400 mb-1">Forecast ({champ.Forecast.points.length} periods)</div>
            <ForecastChart points={champ.Forecast.points} width={640} height={100} />
          </div>
        )}

        {rows && (
          <>
            <h3 className="text-sm uppercase text-alec-400 mb-2">Candidates (ranked)</h3>
            <table className="w-full text-xs mb-4">
              <thead>
                <tr className="text-alec-400 border-b border-alec-700">
                  <th className="text-left py-1">Family</th>
                  <th className="text-right">Skill</th>
                  <th className="text-right">sMAPE</th>
                  <th className="text-right">RMSE</th>
                  <th className="text-right">Folds</th>
                  <th className="text-right">Drift</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.ModelId} className={r.IsChampion ? 'text-emerald-400 font-semibold' : 'text-alec-200'}>
                    <td className="py-1">{r.Family}{r.IsChampion ? ' ★' : ''}{r.DemotedAt ? ' (demoted)' : ''}</td>
                    <td className="text-right">{fmt(r.SkillVsNaive)}</td>
                    <td className="text-right">{fmt(r.SMAPE)}</td>
                    <td className="text-right">{fmt(r.RMSE)}</td>
                    <td className="text-right">{r.NObs ?? '–'}</td>
                    <td className="text-right">{fmt(r.DriftScore)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {champ?.FoldsJson && (
              <FoldTable foldsJson={champ.FoldsJson} />
            )}

            {champ?.Params && (
              <>
                <h3 className="text-sm uppercase text-alec-400 mt-4 mb-1">Champion params</h3>
                <pre className="text-xs bg-alec-900 p-3 rounded text-emerald-300 overflow-x-auto">
{JSON.stringify(champ.Params, null, 2)}
                </pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function FoldTable({ foldsJson }) {
  let folds = [];
  try { folds = JSON.parse(foldsJson) || []; } catch {}
  if (!folds.length) return null;
  return (
    <>
      <h3 className="text-sm uppercase text-alec-400 mt-4 mb-1">Walk-forward CV folds</h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-alec-400 border-b border-alec-700">
            <th className="text-left py-1">Fold</th>
            <th className="text-right">Train up to</th>
            <th className="text-right">Horizon</th>
            <th className="text-right">sMAPE</th>
            <th className="text-right">RMSE</th>
          </tr>
        </thead>
        <tbody>
          {folds.map(f => (
            <tr key={f.fold} className="text-alec-200">
              <td className="py-1">#{f.fold}</td>
              <td className="text-right">{f.trainEnd}</td>
              <td className="text-right">{f.horizon}</td>
              <td className="text-right">{fmt(f.smape)}</td>
              <td className="text-right">{fmt(f.rmse)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

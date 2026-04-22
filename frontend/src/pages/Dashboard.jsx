import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import StatCard from '../components/dashboard/StatCard';
import { getLoans, getDSCR, getLTV, downloadReport } from '../api/reports';
import { getQueue } from '../api/review';

function formatMillions(total) {
  if (total == null || isNaN(total)) return '--';
  return `$${(total / 1_000_000).toFixed(1)}M`;
}

function formatPct(avg) {
  if (avg == null || isNaN(avg)) return '--';
  return `${avg.toFixed(1)}%`;
}

function formatDecimal(avg) {
  if (avg == null || isNaN(avg)) return '--';
  return avg.toFixed(2);
}

function avg(arr, key) {
  if (!arr || arr.length === 0) return null;
  // Filter nulls BEFORE Number() — Number(null)===0 would skew averages
  const vals = arr.map((r) => r[key]).filter((v) => v != null).map(Number).filter((v) => !isNaN(v));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function qualityColor(score) {
  if (score >= 0.75) return 'bg-green-600';
  if (score >= 0.4) return 'bg-amber-500';
  return 'bg-red-500';
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalExposure: null,
    avgDscr: null,
    avgLtv: null,
    maturingSoon: null,
  });
  const [activity, setActivity] = useState([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [loans, dscr, ltv, queue] = await Promise.all([
          getLoans().catch(() => []),
          getDSCR().catch(() => []),
          getLTV().catch(() => []),
          getQueue().catch(() => []),
        ]);

        if (cancelled) return;

        const totalExposure = Array.isArray(loans)
          ? loans.reduce((sum, l) => sum + (Number(l.balance) || 0), 0)
          : null;

        const avgDscr = avg(dscr, 'dscr');
        const avgLtv = avg(ltv, 'ltv');

        const maturingSoon = Array.isArray(loans)
          ? loans.filter((l) => Number(l.daysToMaturity) < 90).length
          : null;

        setStats({ totalExposure, avgDscr, avgLtv, maturingSoon });
        setActivity(Array.isArray(queue) ? queue.slice(0, 5) : []);
      } catch {
        // individual fetches already caught; stats stay null → show "--"
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  async function handleSync() {
    setSyncing(true);
    const toastId = toast.loading('Syncing STOA Brain...');
    try {
      const res = await fetch('/api/webhooks/github/sync', { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
      toast.success('Sync complete', { id: toastId });
    } catch {
      toast.error('Sync failed', { id: toastId });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-white">Dashboard</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Total Loan Exposure"
          value={loading ? null : formatMillions(stats.totalExposure)}
          loading={loading}
        />
        <StatCard
          label="Avg DSCR"
          value={loading ? null : formatDecimal(stats.avgDscr)}
          loading={loading}
        />
        <StatCard
          label="Avg LTV"
          value={loading ? null : formatPct(stats.avgLtv)}
          loading={loading}
        />
        <StatCard
          label="Loans Maturing <90d"
          value={loading ? null : (stats.maturingSoon ?? '--')}
          loading={loading}
          alert={!loading && stats.maturingSoon > 0}
        />
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-3">Quick Actions</h2>
        <div className="flex gap-3 flex-wrap">
          <button
            onClick={() => downloadReport('loans')}
            className="px-4 py-2 rounded-lg bg-alec-700 hover:bg-alec-accent/80 text-white text-sm transition-colors"
          >
            Run Loans Report
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="px-4 py-2 rounded-lg bg-alec-700 hover:bg-alec-accent/80 text-white text-sm transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Sync STOA Brain'}
          </button>
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-3">Recent Activity</h2>
        {activity.length === 0 ? (
          <p className="text-gray-500 text-sm">No recent activity.</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 bg-alec-800 rounded-lg px-4 py-2 text-sm border border-white/5"
              >
                <span className="text-gray-400 font-mono text-xs truncate w-32">{item.id}</span>
                {item.qualityScore != null && (
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full text-white ${qualityColor(item.qualityScore)}`}
                  >
                    {Number(item.qualityScore).toFixed(2)}
                  </span>
                )}
                <span className="ml-auto text-xs text-gray-400 capitalize">{item.status ?? '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

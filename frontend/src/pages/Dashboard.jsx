import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import StatCard from '../components/dashboard/StatCard';
import { getLoans, getDSCR, getLTV, getProjects, downloadReport } from '../api/reports';
import { getQueue } from '../api/review';
import MLCard from '../components/ml/MLCard';
import AlertsCard from '../components/ml/AlertsCard';
import WhatsNewCard from '../components/ml/WhatsNewCard';

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
    activeProperties: null,
    totalUnits: null,
    pipelineDeals: null,
  });
  const [activity, setActivity] = useState([]);
  const [syncing, setSyncing] = useState(false);
  const [reportRunning, setReportRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const [loans, dscr, ltv, projects, queue] = await Promise.all([
          getLoans().catch(() => []),
          getDSCR().catch(() => []),
          getLTV().catch(() => []),
          getProjects().catch(() => []),
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

        const PORTFOLIO_STAGES = ['Under Construction', 'Lease-Up', 'Stabilized'];
        const PIPELINE_STAGES  = ['Under Contract', 'LOI', 'Under Review'];
        const activeProperties = Array.isArray(projects)
          ? projects.filter((p) => PORTFOLIO_STAGES.includes(p.stage)).length
          : null;
        const totalUnits = Array.isArray(projects)
          ? projects
              .filter((p) => PORTFOLIO_STAGES.includes(p.stage))
              .reduce((s, p) => s + (p.units ?? 0), 0)
          : null;
        const pipelineDeals = Array.isArray(projects)
          ? projects.filter((p) => PIPELINE_STAGES.includes(p.stage)).length
          : null;

        setStats({ totalExposure, avgDscr, avgLtv, maturingSoon, activeProperties, totalUnits, pipelineDeals });
        // getQueue returns { items: [...] } — extract the array
        const queueItems = Array.isArray(queue) ? queue : (queue?.items ?? []);
        setActivity(queueItems.slice(0, 5));
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
    const t0 = Date.now();
    const toastId = toast.loading('Syncing STOA Brain…');
    try {
      const res = await fetch('/api/webhooks/github/sync', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      if (!res.ok || body.error) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      // stoaBrainSync.fullSync() returns { indexed, skipped, ... }
      const indexed = body.indexed ?? 0;
      const skipped = body.skipped ?? 0;
      const detail = `${indexed} indexed, ${skipped} skipped · ${elapsed}s`;
      toast.success(`Sync complete — ${detail}`, { id: toastId, duration: 5000 });
    } catch (err) {
      toast.error(`Sync failed: ${err.message}`, { id: toastId, duration: 6000 });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="p-6 space-y-8 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-white">Dashboard</h1>

      {/* Stat cards — row 1: financing */}
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

      {/* Stat cards — row 2: portfolio */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label="Active Properties"
          value={loading ? null : (stats.activeProperties ?? '--')}
          loading={loading}
        />
        <StatCard
          label="Total Units"
          value={loading ? null : (stats.totalUnits != null ? stats.totalUnits.toLocaleString() : '--')}
          loading={loading}
        />
        <StatCard
          label="Pipeline Deals"
          value={loading ? null : (stats.pipelineDeals ?? '--')}
          loading={loading}
        />
      </div>

      {/* Quick actions */}
      <div>
        <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-3">Quick Actions</h2>
        <div className="flex gap-3 flex-wrap">
          <Link
            to="/deals"
            className="px-4 py-2 rounded-lg bg-alec-700 hover:bg-alec-accent/80 text-white text-sm transition-colors"
          >
            View Portfolio
          </Link>
          <Link
            to="/finance"
            className="px-4 py-2 rounded-lg bg-alec-700 hover:bg-alec-accent/80 text-white text-sm transition-colors"
          >
            Finance Details
          </Link>
          <button
            onClick={async () => {
              setReportRunning(true);
              const toastId = toast.loading('Generating Loans report…');
              try {
                await downloadReport('loans');
                toast.success('Report ready', { id: toastId });
              } catch (err) {
                toast.error(`Report failed: ${err.message}`, { id: toastId });
              } finally {
                setReportRunning(false);
              }
            }}
            disabled={reportRunning}
            className="px-4 py-2 rounded-lg bg-alec-700 hover:bg-alec-accent/80 text-white text-sm transition-colors disabled:opacity-50"
          >
            {reportRunning ? 'Generating…' : 'Run Loans Report'}
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

      {/* Nightly ML predictions */}
      <div>
        <MLCard />
      </div>

      {/* ML alerts + what's new */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AlertsCard />
        <WhatsNewCard />
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

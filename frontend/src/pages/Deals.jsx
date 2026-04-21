import { useState, useEffect } from 'react';
import { getProjects } from '../api/reports';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const fmtK = (v) => v != null ? `$${(v / 1000).toFixed(0)}k` : '—';

// Lifecycle grouping
const PORTFOLIO_STAGES = ['Under Construction', 'Lease-Up', 'Stabilized'];
const PIPELINE_STAGES  = ['Under Contract', 'LOI', 'Under Review'];
const CLOSED_STAGES    = ['Liquidated', 'Closed', 'CLOSED'];

function stageBadge(stage) {
  const map = {
    'Under Construction': 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    'Lease-Up':           'bg-amber-500/20 text-amber-300 border-amber-500/30',
    'Stabilized':         'bg-green-500/20 text-green-300 border-green-500/30',
    'Under Contract':     'bg-purple-500/20 text-purple-300 border-purple-500/30',
    'LOI':                'bg-violet-500/20 text-violet-300 border-violet-500/30',
    'Under Review':       'bg-gray-500/20 text-gray-300 border-gray-500/30',
    'Liquidated':         'bg-red-500/10 text-red-400 border-red-500/20',
    'Closed':             'bg-gray-500/10 text-gray-500 border-gray-500/20',
    'CLOSED':             'bg-gray-500/10 text-gray-500 border-gray-500/20',
  };
  const cls = map[stage] ?? 'bg-gray-700 text-gray-400 border-gray-600';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {stage}
    </span>
  );
}

function SummaryCard({ label, value, sub }) {
  return (
    <div className="bg-alec-800 border border-white/5 rounded-xl px-5 py-4">
      <p className="text-xs uppercase tracking-widest text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

function ProjectTable({ projects }) {
  if (projects.length === 0) {
    return <p className="text-gray-500 text-sm py-4">No projects.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="bg-gray-800/60 text-gray-400 uppercase text-xs">
            <th className="px-3 py-2">Project</th>
            <th className="px-3 py-2">Location</th>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2">Units</th>
            <th className="px-3 py-2">Type</th>
            <th className="px-3 py-2">Cost / Unit</th>
            <th className="px-3 py-2">Total Cost</th>
            <th className="px-3 py-2">LTC%</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => (
            <tr key={p.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
              <td className="px-3 py-2 text-white font-medium">{p.name}</td>
              <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                {p.city && p.state ? `${p.city}, ${p.state}` : p.state ?? '—'}
              </td>
              <td className="px-3 py-2">{stageBadge(p.stage)}</td>
              <td className="px-3 py-2 text-gray-300">{p.units ?? '—'}</td>
              <td className="px-3 py-2 text-gray-400">{p.productType ?? '—'}</td>
              <td className="px-3 py-2 text-gray-300">{p.costPerUnit != null ? fmtK(p.costPerUnit) : '—'}</td>
              <td className="px-3 py-2 text-gray-300">{p.totalCost != null ? fmt.format(p.totalCost) : '—'}</td>
              <td className="px-3 py-2 text-gray-300">
                {p.ltc != null ? `${p.ltc.toFixed(1)}%` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Deals() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const portfolio = projects.filter((p) => PORTFOLIO_STAGES.includes(p.stage));
  const pipeline  = projects.filter((p) => PIPELINE_STAGES.includes(p.stage));
  const closed    = projects.filter((p) => CLOSED_STAGES.includes(p.stage));

  const totalUnits = portfolio.reduce((s, p) => s + (p.units ?? 0), 0);
  const pipelineUnits = pipeline.reduce((s, p) => s + (p.units ?? 0), 0);
  const totalCost = portfolio.reduce((s, p) => s + (p.totalCost ?? 0), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
          <span>Loading portfolio…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-400 text-sm">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold text-white">Portfolio &amp; Pipeline</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SummaryCard label="Active Properties"   value={portfolio.length} sub="Under Construction + Lease-Up + Stabilized" />
        <SummaryCard label="Total Units"         value={totalUnits.toLocaleString()} sub="Active portfolio" />
        <SummaryCard label="Pipeline Deals"      value={pipeline.length} sub={`${pipelineUnits.toLocaleString()} projected units`} />
        <SummaryCard label="Portfolio Valuation" value={totalCost > 0 ? `$${(totalCost / 1_000_000).toFixed(0)}M` : '—'} sub="When complete" />
      </div>

      {/* Active portfolio */}
      <section>
        <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-3">
          Active Portfolio <span className="ml-2 text-white font-semibold">{portfolio.length}</span>
        </h2>
        <div className="rounded-xl border border-white/5 bg-alec-800 overflow-hidden">
          <ProjectTable projects={portfolio} />
        </div>
      </section>

      {/* Deal pipeline */}
      <section>
        <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-3">
          Deal Pipeline <span className="ml-2 text-white font-semibold">{pipeline.length}</span>
        </h2>
        <div className="rounded-xl border border-white/5 bg-alec-800 overflow-hidden">
          <ProjectTable projects={pipeline} />
        </div>
      </section>

      {/* Closed / Liquidated */}
      {closed.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-widest text-gray-400 mb-3">
            Closed / Liquidated <span className="ml-2 text-white font-semibold">{closed.length}</span>
          </h2>
          <div className="rounded-xl border border-white/5 bg-alec-800 overflow-hidden">
            <ProjectTable projects={closed} />
          </div>
        </section>
      )}
    </div>
  );
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function ProgressBar({ pct }) {
  const clamped = Math.min(100, Math.max(0, pct ?? 0));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full bg-purple-500 transition-all"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 w-10 text-right">{clamped.toFixed(0)}%</span>
    </div>
  );
}

export default function EquityTable({ data = [] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border border-gray-700 bg-gray-800 text-gray-400">
        No equity commitment data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 uppercase text-xs">
            <th className="px-3 py-2">Project</th>
            <th className="px-3 py-2">Total Commitment</th>
            <th className="px-3 py-2">Funded</th>
            <th className="px-3 py-2">Unfunded</th>
            <th className="px-3 py-2 min-w-[160px]">% Funded</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const pct =
              row.pctFunded != null
                ? row.pctFunded
                : row.totalCommitment
                ? ((row.funded ?? 0) / row.totalCommitment) * 100
                : 0;
            return (
              <tr key={i} className="border-b border-gray-700 hover:bg-gray-700/40">
                <td className="px-3 py-2 text-gray-200">{row.project ?? '—'}</td>
                <td className="px-3 py-2 text-gray-200">{row.totalCommitment != null ? fmt.format(row.totalCommitment) : '—'}</td>
                <td className="px-3 py-2 text-gray-200">{row.funded != null ? fmt.format(row.funded) : '—'}</td>
                <td className="px-3 py-2 text-gray-200">{row.unfunded != null ? fmt.format(row.unfunded) : '—'}</td>
                <td className="px-3 py-2">
                  <ProgressBar pct={pct} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

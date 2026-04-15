const DSCR_THRESHOLD = 1.2;

function StatusBadge({ status, dscr, req }) {
  if (status === 'Breach') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/30 font-medium">
        Breach
      </span>
    );
  }
  if (status === 'Pass') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 font-medium">
        Pass
      </span>
    );
  }
  if (status === 'Upcoming') {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 font-medium">
        Upcoming
      </span>
    );
  }
  return <span className="text-gray-500 text-xs">—</span>;
}

export default function DSCRTable({ data = [] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border border-gray-700 bg-gray-800 text-gray-400">
        No DSCR covenant data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 uppercase text-xs">
            <th className="px-3 py-2">Property</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Projected DSCR</th>
            <th className="px-3 py-2">Requirement</th>
            <th className="px-3 py-2">Test Date</th>
            <th className="px-3 py-2">Covenant Type</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const isRed = row.dscr != null && row.dscr < DSCR_THRESHOLD;
            const rowBreach = row.dscrStatus === 'Breach';
            return (
              <tr
                key={i}
                className={`border-b border-gray-700 hover:bg-gray-700/40 ${
                  rowBreach ? 'border-l-4 border-l-red-500' : ''
                }`}
              >
                <td className="px-3 py-2 text-gray-200">{row.property ?? '—'}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.dscrStatus} dscr={row.dscr} req={row.required} />
                </td>
                <td className={`px-3 py-2 font-semibold ${
                  row.dscr == null ? 'text-gray-500' : isRed ? 'text-red-400' : 'text-green-400'
                }`}>
                  {row.dscr != null ? Number(row.dscr).toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-300">
                  {row.required != null ? Number(row.required).toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-400">
                  {row.period ? new Date(row.period).toLocaleDateString() : '—'}
                </td>
                <td className="px-3 py-2 text-gray-500 text-xs">{row.covenantType ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DSCR_THRESHOLD = 1.2;

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function DSCRTable({ data = [] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border border-gray-700 bg-gray-800 text-gray-400">
        No DSCR data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 uppercase text-xs">
            <th className="px-3 py-2">Property</th>
            <th className="px-3 py-2">DSCR</th>
            <th className="px-3 py-2">NOI</th>
            <th className="px-3 py-2">Debt Service</th>
            <th className="px-3 py-2">Period</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const isRed = (row.dscr ?? 0) < DSCR_THRESHOLD;
            return (
              <tr
                key={i}
                className={`border-b border-gray-700 hover:bg-gray-700/40 ${
                  isRed ? 'border-l-4 border-l-red-500' : ''
                }`}
              >
                <td className="px-3 py-2 text-gray-200">{row.property ?? '—'}</td>
                <td className={`px-3 py-2 font-semibold ${isRed ? 'text-red-400' : 'text-green-400'}`}>
                  {row.dscr != null ? row.dscr.toFixed(2) : '—'}
                </td>
                <td className="px-3 py-2 text-gray-200">{row.noi != null ? fmt.format(row.noi) : '—'}</td>
                <td className="px-3 py-2 text-gray-200">{row.debtService != null ? fmt.format(row.debtService) : '—'}</td>
                <td className="px-3 py-2 text-gray-400">{row.period ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

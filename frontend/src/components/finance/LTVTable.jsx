const LTV_THRESHOLD = 75;

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export default function LTVTable({ data = [] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border border-gray-700 bg-gray-800 text-gray-400">
        No LTV data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 uppercase text-xs">
            <th className="px-3 py-2">Property</th>
            <th className="px-3 py-2">LTV%</th>
            <th className="px-3 py-2">Appraised Value</th>
            <th className="px-3 py-2">Loan Balance</th>
            <th className="px-3 py-2">Date</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const isRed = row.ltv != null && row.ltv > LTV_THRESHOLD;
            return (
              <tr
                key={i}
                className={`border-b border-gray-700 hover:bg-gray-700/40 ${
                  isRed ? 'border-l-4 border-l-red-500' : ''
                }`}
              >
                <td className="px-3 py-2 text-gray-200">{row.property ?? '—'}</td>
                <td className={`px-3 py-2 font-semibold ${isRed ? 'text-red-400' : 'text-green-400'}`}>
                  {row.ltv != null ? `${row.ltv.toFixed(1)}%` : '—'}
                </td>
                <td className="px-3 py-2 text-gray-200">{row.appraisedValue != null ? fmt.format(row.appraisedValue) : '—'}</td>
                <td className="px-3 py-2 text-gray-200">{row.loanBalance != null ? fmt.format(row.loanBalance) : '—'}</td>
                <td className="px-3 py-2 text-gray-400">
                  {row.date ? new Date(row.date).toLocaleDateString() : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

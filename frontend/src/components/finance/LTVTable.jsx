const LTV_THRESHOLD = 75;
const LTC_THRESHOLD = 80;

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function RatioBadge({ value, threshold }) {
  if (value == null) return <span className="text-gray-500">—</span>;
  const isHigh = value > threshold;
  return (
    <span className={`font-semibold ${isHigh ? 'text-red-400' : 'text-green-400'}`}>
      {value.toFixed(1)}%
    </span>
  );
}

export default function LTVTable({ data = [] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border border-gray-700 bg-gray-800 text-gray-400">
        No LTV / LTC data available
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 uppercase text-xs">
            <th className="px-3 py-2">Property</th>
            <th className="px-3 py-2">Lender</th>
            <th className="px-3 py-2 text-right">LTV%</th>
            <th className="px-3 py-2 text-right">LTC%</th>
            <th className="px-3 py-2 text-right">Appraised Value</th>
            <th className="px-3 py-2 text-right">Loan Balance</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => {
            const isRed = (row.ltv != null && row.ltv > LTV_THRESHOLD) ||
                          (row.ltc != null && row.ltc > LTC_THRESHOLD);
            return (
              <tr
                key={i}
                className={`border-b border-gray-700 hover:bg-gray-700/40 ${
                  isRed ? 'border-l-4 border-l-red-500' : ''
                }`}
              >
                <td className="px-3 py-2 text-gray-200">{row.property ?? '—'}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">{row.lender ?? '—'}</td>
                <td className="px-3 py-2 text-right">
                  <RatioBadge value={row.ltv} threshold={LTV_THRESHOLD} />
                </td>
                <td className="px-3 py-2 text-right">
                  <RatioBadge value={row.ltc} threshold={LTC_THRESHOLD} />
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {row.appraisedValue != null ? fmt.format(row.appraisedValue) : '—'}
                </td>
                <td className="px-3 py-2 text-right text-gray-200">
                  {row.loanBalance != null ? fmt.format(row.loanBalance) : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

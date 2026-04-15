import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

function barColor(daysToMaturity) {
  if (daysToMaturity < 90) return '#ef4444';
  if (daysToMaturity < 365) return '#f59e0b';
  return '#22c55e';
}

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200">
      <p className="font-semibold mb-1">{label}</p>
      <p>Balance: {fmt.format((payload[0].value ?? 0) * 1_000_000)}</p>
    </div>
  );
}

export default function MaturityWallChart({ data = [] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No maturity data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 8, right: 24, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
        <XAxis dataKey="quarter" tick={{ fill: '#9ca3af', fontSize: 12 }} />
        <YAxis
          tickFormatter={(v) => `$${v}M`}
          tick={{ fill: '#9ca3af', fontSize: 12 }}
        />
        <Tooltip content={CustomTooltip} />
        <Bar dataKey="balanceMillions" name="Balance ($M)" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={barColor(entry.daysToMaturity ?? 999)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

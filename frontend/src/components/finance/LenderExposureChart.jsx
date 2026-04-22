import {
  PieChart,
  Pie,
  Cell,
  Legend,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const COLORS = [
  '#6c63ff',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#3b82f6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
];

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const entry = payload[0];
  const { name, value, percent } = entry;
  return (
    <div className="bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-gray-200">
      <p className="font-semibold mb-1">{name}</p>
      <p>Balance: {fmt.format(value)}</p>
      <p>Share: {((percent ?? 0) * 100).toFixed(1)}%</p>
    </div>
  );
}

export default function LenderExposureChart({ data = [] }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400">
        No lender exposure data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie
          data={data}
          dataKey="balance"
          nameKey="lender"
          cx="50%"
          cy="50%"
          outerRadius={110}
          label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={CustomTooltip} />
        <Legend
          formatter={(value) => (
            <span className="text-gray-300 text-sm">{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

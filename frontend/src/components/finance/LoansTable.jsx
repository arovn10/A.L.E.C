import { useState } from 'react';

const COLUMNS = [
  { key: 'property',     label: 'Property' },
  { key: 'lender',       label: 'Lender' },
  { key: 'type',         label: 'Type' },
  { key: 'amount',       label: 'Amount' },
  { key: 'balance',      label: 'Balance' },
  { key: 'rate',         label: 'Rate' },
  { key: 'maturity',     label: 'Maturity' },
  { key: 'daysToMaturity', label: 'Days' },
  { key: 'ltv',          label: 'LTV%' },
  { key: 'dscr',         label: 'DSCR' },
  { key: 'covenantStatus', label: 'Covenant' },
  { key: 'guarantor',    label: 'Guarantor' },
  { key: 'lastUpdated',  label: 'Last Updated' },
];

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function formatCell(key, value) {
  if (value == null) return '—';
  if (key === 'amount' || key === 'balance') return fmt.format(value);
  if (key === 'rate') return `${(value * 100).toFixed(2)}%`;
  if (key === 'ltv') return `${value.toFixed(1)}%`;
  if (key === 'dscr') return value.toFixed(2);
  if (key === 'maturity' || key === 'lastUpdated') return new Date(value).toLocaleDateString();
  return String(value);
}

function isHighlighted(row) {
  return (row.daysToMaturity != null && row.daysToMaturity < 90) || row.covenantStatus === 'BREACH';
}

export default function LoansTable({ data = [] }) {
  const [sortKey, setSortKey] = useState('property');
  const [sortDir, setSortDir] = useState('asc');

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 rounded-lg border border-gray-700 bg-gray-800 text-gray-400">
        Connect Azure SQL in Settings to view loan data
      </div>
    );
  }

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = [...data].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-left border-collapse">
        <thead>
          <tr className="bg-gray-800 text-gray-400 uppercase text-xs">
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 cursor-pointer whitespace-nowrap hover:text-white select-none"
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {sortKey === col.key && (
                  <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-gray-700 hover:bg-gray-700/40 ${
                isHighlighted(row) ? 'border-l-4 border-l-red-500' : ''
              }`}
            >
              {COLUMNS.map((col) => (
                <td key={col.key} className="px-3 py-2 whitespace-nowrap text-gray-200">
                  {formatCell(col.key, row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

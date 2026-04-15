import { useState } from 'react';
import toast from 'react-hot-toast';
import { downloadReport } from '../../api/reports';

const REPORTS = [
  { label: 'Loans',    type: 'loans' },
  { label: 'Maturity', type: 'maturity' },
  { label: 'Lenders',  type: 'lenders' },
  { label: 'DSCR',     type: 'dscr' },
  { label: 'LTV',      type: 'ltv' },
  { label: 'Equity',   type: 'equity' },
  { label: 'Portfolio', type: 'portfolio' },
];

export default function ReportDownloadBar() {
  const [generating, setGenerating] = useState(null); // tracks which report is generating

  async function handleDownload(type, label) {
    if (generating) return; // block concurrent requests
    setGenerating(type);
    const toastId = toast.loading(`Generating ${label} report…`);
    try {
      await downloadReport(type);
      toast.success(`${label} report ready`, { id: toastId });
    } catch (err) {
      toast.error(`Failed: ${err.message}`, { id: toastId });
    } finally {
      setGenerating(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 p-4 bg-gray-800/50 border-t border-gray-700">
      {REPORTS.map(({ label, type }) => (
        <button
          key={type}
          onClick={() => handleDownload(type, label)}
          disabled={!!generating}
          className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white transition-colors border border-gray-600 hover:border-gray-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating === type ? (
            <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : (
            <span>📥</span>
          )}
          {label}
        </button>
      ))}
    </div>
  );
}

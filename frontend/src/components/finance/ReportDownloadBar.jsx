import toast from 'react-hot-toast';
import { downloadReport } from '../../api/reports';

const REPORTS = [
  { label: 'Loans Excel',    name: 'loans' },
  { label: 'Maturity Excel', name: 'maturity' },
  { label: 'Lenders Excel',  name: 'lenders' },
  { label: 'DSCR Excel',     name: 'dscr' },
  { label: 'LTV Excel',      name: 'ltv' },
  { label: 'Equity Excel',   name: 'equity' },
];

export default function ReportDownloadBar() {
  function handleDownload(name) {
    toast('Generating report...', { icon: '📥' });
    downloadReport(name);
  }

  return (
    <div className="flex flex-wrap gap-2 p-4 bg-gray-800/50 border-t border-gray-700">
      {REPORTS.map(({ label, name }) => (
        <button
          key={name}
          onClick={() => handleDownload(name)}
          className="px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white transition-colors border border-gray-600 hover:border-gray-500"
        >
          {label}
        </button>
      ))}
    </div>
  );
}

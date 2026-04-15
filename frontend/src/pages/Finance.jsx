import { useState, useEffect } from 'react';
import LoansTable from '../components/finance/LoansTable';
import MaturityWallChart from '../components/finance/MaturityWallChart';
import LenderExposureChart from '../components/finance/LenderExposureChart';
import DSCRTable from '../components/finance/DSCRTable';
import LTVTable from '../components/finance/LTVTable';
import EquityTable from '../components/finance/EquityTable';
import ReportDownloadBar from '../components/finance/ReportDownloadBar';
import {
  getLoans,
  getMaturityWall,
  getLenderExposure,
  getDSCR,
  getLTV,
  getEquity,
} from '../api/reports';

const TABS = [
  { key: 'loans',    label: 'Loans' },
  { key: 'maturity', label: 'Maturity Wall' },
  { key: 'lenders',  label: 'Lenders' },
  { key: 'dscr',     label: 'DSCR' },
  { key: 'ltv',      label: 'LTV' },
  { key: 'equity',   label: 'Equity' },
];

const FETCHERS = {
  loans:    getLoans,
  maturity: getMaturityWall,
  lenders:  getLenderExposure,
  dscr:     getDSCR,
  ltv:      getLTV,
  equity:   getEquity,
};

export default function Finance() {
  const [activeTab, setActiveTab] = useState('loans');
  const [data, setData] = useState({});
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (data[activeTab] !== undefined) return;

    setLoading((prev) => ({ ...prev, [activeTab]: true }));
    setErrors((prev) => ({ ...prev, [activeTab]: null }));

    FETCHERS[activeTab]()
      .then((result) => {
        setData((prev) => ({ ...prev, [activeTab]: result }));
      })
      .catch((err) => {
        setErrors((prev) => ({ ...prev, [activeTab]: err.message }));
        setData((prev) => ({ ...prev, [activeTab]: [] }));
      })
      .finally(() => {
        setLoading((prev) => ({ ...prev, [activeTab]: false }));
      });
  }, [activeTab, data]);

  function renderContent() {
    if (loading[activeTab]) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-400">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
            <span>Loading {activeTab} data…</span>
          </div>
        </div>
      );
    }

    if (errors[activeTab]) {
      return (
        <div className="flex items-center justify-center h-48 text-red-400">
          Error: {errors[activeTab]}
        </div>
      );
    }

    const tabData = data[activeTab] ?? [];

    switch (activeTab) {
      case 'loans':
        return <LoansTable data={tabData} />;
      case 'maturity':
        return <MaturityWallChart data={tabData} />;
      case 'lenders':
        return <LenderExposureChart data={tabData} />;
      case 'dscr':
        return <DSCRTable data={tabData} />;
      case 'ltv':
        return <LTVTable data={tabData} />;
      case 'equity':
        return <EquityTable data={tabData} />;
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-gray-700 bg-gray-800/50 px-4 overflow-x-auto shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {renderContent()}
      </div>

      {/* Download bar — always visible */}
      <ReportDownloadBar />
    </div>
  );
}

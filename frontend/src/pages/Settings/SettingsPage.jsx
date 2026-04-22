/**
 * frontend/src/pages/Settings/SettingsPage.jsx
 *
 * S3.4: Tab-routed shell for the Settings surface. Profile/Security tabs
 * are placeholders in S3 — Connectors/MCPs tabs render real data when the
 * ALEC_CONNECTORS_V2 flag is on. Profile wraps the legacy Settings page so
 * the existing dark-mode toggle + Plaid link stay one click away.
 *
 * Tab state is URL-query-synced (?tab=connectors) so deep links work.
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import LegacySettings from '../Settings.jsx';
import ConnectorsTab from './ConnectorsTab.jsx';
import MCPsTab from './MCPsTab.jsx';
import OrgMembersTab from './OrgMembersTab.jsx';
import DesktopTab from './DesktopTab.jsx';
import SecurityTab from './SecurityTab.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { ToastProvider } from '../../components/ui/Toast.jsx';

// Connectors v2 is now the default. Set VITE_ALEC_CONNECTORS_V2=0 or
// window.__ALEC_FLAGS.connectorsV2 = false to force the legacy-only shell.
function isConnectorsV2() {
  try {
    if (import.meta?.env?.VITE_ALEC_CONNECTORS_V2 === '0') return false;
  } catch { /* import.meta not present in some test envs */ }
  if (typeof window !== 'undefined' && window.__ALEC_FLAGS?.connectorsV2 === false) return false;
  return true;
}

function isElectron() {
  return typeof window !== 'undefined' && !!window.electronAPI;
}

const ALL_TABS = [
  { id: 'profile',    label: 'Profile' },
  { id: 'security',   label: 'Security' },
  { id: 'connectors', label: 'Connectors', v2: true },
  { id: 'mcps',       label: 'MCPs',       v2: true },
  { id: 'members',    label: 'Members',    v2: true },
  { id: 'desktop',    label: 'Desktop',    v2: true, desktopOnly: true },
];

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const v2 = isConnectorsV2();
  const { user } = useAuth();
  const viewerEmail = user?.email || user?.Email || null;
  const electron = isElectron();
  const tabs = useMemo(
    () => ALL_TABS.filter(t => (!t.v2 || v2) && (!t.desktopOnly || electron)),
    [v2, electron]
  );
  const tab = params.get('tab') || (v2 ? 'connectors' : 'profile');
  const setTab = (id) => setParams({ tab: id });

  return (
    <ToastProvider>
    <div className="flex h-full">
      <nav className="w-48 border-r border-alec-700 bg-alec-800 p-4 space-y-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`block w-full rounded px-3 py-2 text-left text-sm ${
              tab === t.id
                ? 'bg-alec-accent/20 text-white font-medium'
                : 'text-gray-300 hover:bg-alec-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">
        {tab === 'profile'    && <LegacySettings />}
        {tab === 'security'   && <SecurityTab />}
        {tab === 'connectors' && v2 && <ConnectorsTab />}
        {tab === 'mcps'       && v2 && <MCPsTab />}
        {tab === 'members'    && v2 && <OrgMembersTab viewerEmail={viewerEmail} />}
        {tab === 'desktop'    && v2 && electron && <DesktopTab />}
      </main>
    </div>
    </ToastProvider>
  );
}

import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { getAuthHeaders } from '../../api/client';

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

// Dynamically load the Plaid Link SDK (avoids npm dependency)
function loadPlaidScript() {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve(window.Plaid);
    const script = document.createElement('script');
    script.src = 'https://cdn.plaid.com/link/v2/stable/link.js';
    script.onload = () => resolve(window.Plaid);
    script.onerror = () => reject(new Error('Failed to load Plaid SDK'));
    document.head.appendChild(script);
  });
}

function AccountRow({ account, onUnlink }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
      <div className="flex items-center gap-3">
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
        <div>
          <p className="text-sm text-gray-200 font-medium">{account.institution_name || 'Unknown Bank'}</p>
          {account.last_fetched && (
            <p className="text-xs text-gray-500">
              Last synced {new Date(account.last_fetched).toLocaleDateString()}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={() => onUnlink(account.item_id)}
        className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 rounded hover:bg-red-500/10"
      >
        Unlink
      </button>
    </div>
  );
}

export default function PlaidLinkSection() {
  const [accounts, setAccounts]   = useState([]);
  const [holdings, setHoldings]   = useState(null);
  const [linking, setLinking]     = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(true);

  const fetchAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/plaid/accounts', { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAccounts(Array.isArray(data) ? data : []);
      }
    } catch {
      // non-critical — no accounts shown
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const fetchHoldings = useCallback(async () => {
    try {
      const res = await fetch('/api/plaid/holdings', { headers: getAuthHeaders() });
      if (res.ok) setHoldings(await res.json());
    } catch {
      // optional
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
    fetchHoldings();
  }, [fetchAccounts, fetchHoldings]);

  async function handleLinkAccount() {
    setLinking(true);
    try {
      // 1. Get a link token from backend
      const tokenRes = await fetch('/api/plaid/create-link-token', { method: 'POST', headers: getAuthHeaders() });
      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || 'Backend error');
      }
      const { link_token } = await tokenRes.json();
      if (!link_token) throw new Error('No link token returned');

      // 2. Load Plaid SDK + open modal
      const Plaid = await loadPlaidScript();
      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (public_token, metadata) => {
          // 3. Exchange public token for access token
          const exchRes = await fetch('/api/plaid/exchange-token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({
              public_token,
              institution: metadata?.institution,
            }),
          });
          if (!exchRes.ok) throw new Error('Token exchange failed');
          toast.success(`Linked ${metadata?.institution?.name ?? 'account'} successfully!`);
          await fetchAccounts();
          await fetchHoldings();
        },
        onExit: (err) => {
          if (err) toast.error('Link closed with error: ' + err.display_message);
          setLinking(false);
        },
      });
      handler.open();
    } catch (err) {
      toast.error(err.message.includes('configured')
        ? 'Plaid not configured — set PLAID_CLIENT_ID in .env'
        : `Plaid error: ${err.message}`
      );
      setLinking(false);
    }
  }

  async function handleUnlink(itemId) {
    try {
      const res = await fetch(`/api/plaid/accounts/${encodeURIComponent(itemId)}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Unlink failed');
      toast.success('Account unlinked');
      setAccounts((prev) => prev.filter((a) => a.item_id !== itemId));
      setHoldings(null);
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">Linked Accounts</h2>
          {holdings?.total_value > 0 && (
            <p className="text-sm text-gray-400 mt-0.5">
              Portfolio value: <span className="text-green-400 font-semibold">{fmt.format(holdings.total_value)}</span>
            </p>
          )}
        </div>
        <button
          onClick={handleLinkAccount}
          disabled={linking}
          className="px-4 py-2 bg-alec-accent hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {linking ? 'Opening Plaid…' : '+ Link Account'}
        </button>
      </div>

      {loadingAccounts ? (
        <p className="text-sm text-gray-500">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-600 p-6 text-center">
          <p className="text-sm text-gray-400 mb-1">No linked accounts yet</p>
          <p className="text-xs text-gray-600">Click &ldquo;+ Link Account&rdquo; to connect a brokerage</p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-700 divide-y divide-gray-700 overflow-hidden">
          {accounts.map((acct) => (
            <AccountRow key={acct.item_id} account={acct} onUnlink={handleUnlink} />
          ))}
        </div>
      )}

      {holdings?.holdings?.length > 0 && (
        <details className="text-xs text-gray-500 cursor-pointer">
          <summary className="hover:text-gray-300 transition-colors">
            {holdings.holdings.length} holdings across {holdings.accounts?.length ?? 0} account(s)
          </summary>
          <div className="mt-2 space-y-1 pl-2 border-l border-gray-700">
            {(holdings.accounts ?? []).map((a) => (
              <p key={a.account_id}>
                <span className="text-gray-300">{a.institution_name} — {a.name}</span>
                <span className="ml-2 text-green-400">{fmt.format(a.balances?.current ?? 0)}</span>
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

import { useState } from 'react';
import toast from 'react-hot-toast';

export default function PlaidLinkSection() {
  const [loading, setLoading] = useState(false);
  const [linkToken, setLinkToken] = useState(null);

  async function handleLinkAccount() {
    setLoading(true);
    try {
      const res = await fetch('/api/plaid/create-link-token', { method: 'POST' });
      if (!res.ok) throw new Error('Plaid not configured');
      const data = await res.json();
      setLinkToken(data.link_token ?? null);
      toast.success('Link token received: ' + (data.link_token ?? '(no token)').slice(0, 24) + '…');
    } catch (err) {
      toast.error('Plaid not configured — set PLAID_CLIENT_ID in .env');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Connect Bank Account</h2>

      <p className="text-sm text-gray-400">
        Plaid bank linking available when backend is connected. Click &ldquo;Link Account&rdquo; to get a
        link token.
      </p>

      <button
        onClick={handleLinkAccount}
        disabled={loading}
        className="px-4 py-2 bg-alec-accent hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
      >
        {loading ? 'Connecting…' : 'Link Account'}
      </button>

      {linkToken && (
        <p className="text-xs text-green-400 font-mono break-all">
          Token: {linkToken.slice(0, 40)}…
        </p>
      )}

      <div className="mt-4 rounded-lg border border-gray-700 bg-alec-800 p-4 text-sm text-gray-400">
        Linked accounts appear here after authorization
      </div>
    </div>
  );
}

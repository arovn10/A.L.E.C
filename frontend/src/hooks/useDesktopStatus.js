/**
 * frontend/src/hooks/useDesktopStatus.js — S7.7
 * Lightweight polling hook (10s) for /api/desktop/status. The Settings tab
 * is the only consumer so a simple setInterval beats pulling in React Query.
 */
import { useEffect, useState, useCallback } from 'react';
import { getDesktopStatus } from '../api/desktop.js';

export function useDesktopStatus(pollMs = 10_000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const s = await getDesktopStatus();
      setData(s);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    refetch();
    const id = setInterval(() => { if (!cancelled) refetch(); }, pollMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [refetch, pollMs]);

  return { data, error, loading, refetch };
}

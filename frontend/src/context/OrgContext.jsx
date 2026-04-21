/**
 * frontend/src/context/OrgContext.jsx
 *
 * Tracks which organization the user is "acting as" right now. Membership
 * list is fetched via React Query; the selection persists in localStorage
 * under `alec.currentOrg` so the switcher is sticky across reloads.
 *
 * Consumers: TenantSwitcher (dropdown) and useScopedConnectors (filters
 * the org-scoped list).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as orgsApi from '../api/orgs.js';

const STORAGE_KEY = 'alec.currentOrg';
const OrgCtx = createContext({ orgs: [], current: null, setCurrentId: () => {} });

export function OrgProvider({ children }) {
  const { data: orgs = [] } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.listOrgs,
    // Failing /api/orgs (e.g. connectors v2 flag off) shouldn't spam retries.
    retry: false,
    staleTime: 60_000,
  });

  const [currentId, setCurrentId] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || null; } catch { return null; }
  });

  // Default to the first membership once it arrives, but only if the user
  // hasn't picked one yet. Switching to a now-missing org resets selection.
  useEffect(() => {
    if (!orgs.length) return;
    if (!currentId || !orgs.find(o => o.id === currentId)) {
      setCurrentId(orgs[0].id);
    }
  }, [orgs, currentId]);

  useEffect(() => {
    try {
      if (currentId) localStorage.setItem(STORAGE_KEY, currentId);
      else           localStorage.removeItem(STORAGE_KEY);
    } catch { /* storage blocked — not fatal */ }
  }, [currentId]);

  const current = orgs.find(o => o.id === currentId) || null;
  return <OrgCtx.Provider value={{ orgs, current, setCurrentId }}>{children}</OrgCtx.Provider>;
}

export const useOrg = () => useContext(OrgCtx);

/**
 * frontend/src/hooks/useScopedConnectors.js
 *
 * React Query hooks that wrap the connectors API surface. Keeping them in
 * one place means every consumer (list view, drawer, catalog filter) hits
 * the same cache, so editing a connector in the drawer refreshes the list
 * the moment `queryKey:['connectors']` is invalidated.
 */
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/connectors.js';

/**
 * `scope` is 'user' | 'org'. For 'org', pass the current org id from OrgContext.
 * Returns a query that resolves to the array of connector_instances visible
 * to the caller at that scope.
 */
export function useScopedConnectors(scope, orgId) {
  return useQuery({
    queryKey: ['connectors', scope, scope === 'org' ? orgId || null : null],
    queryFn: () =>
      scope === 'org'
        ? api.listConnectors({ scope: 'org', orgId })
        : api.listConnectors({ scope: 'user' }),
    // Without an org the org-scoped call would 404; skip until one is picked.
    enabled: scope !== 'org' || !!orgId,
    staleTime: 30_000,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ['catalog'],
    queryFn: api.getCatalog,
    staleTime: 5 * 60_000,
  });
}

/**
 * frontend/src/hooks/useScopedMCPs.js
 *
 * Mirrors useScopedConnectors for MCP servers. /api/mcp's list endpoint
 * already scopes to the caller (user rows + memberships), so client-side
 * filtering happens here for the "Installed vs Custom" sidebar.
 */
import { useQuery } from '@tanstack/react-query';
import * as api from '../api/mcp.js';

export function useScopedMCPs(scope, orgId) {
  return useQuery({
    queryKey: ['mcps', scope, scope === 'org' ? orgId || null : null],
    queryFn: async () => {
      const rows = await api.listMcps();
      if (scope === 'org') {
        return (rows || []).filter(r => r.scope_type === 'org' && r.scope_id === orgId);
      }
      return (rows || []).filter(r => r.scope_type === 'user');
    },
    enabled: scope !== 'org' || !!orgId,
    staleTime: 15_000,
  });
}

export function useMcpCatalog() {
  return useQuery({
    queryKey: ['mcp-catalog'],
    queryFn: api.getMcpCatalog,
    staleTime: 5 * 60_000,
  });
}

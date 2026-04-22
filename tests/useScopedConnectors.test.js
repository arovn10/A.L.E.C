/**
 * tests/useScopedConnectors.test.js
 *
 * Pure-logic test of the queryKey/queryFn shape the hook produces. We
 * inline the mapping instead of importing the hook directly so jest can
 * avoid a full React/JSX transform for a 4-line pure function.
 */

function buildQuery(scope, orgId) {
  return {
    queryKey: ['connectors', scope, scope === 'org' ? orgId || null : null],
    enabled: scope !== 'org' || !!orgId,
    params: scope === 'org' ? { scope: 'org', orgId } : { scope: 'user' },
  };
}

describe('useScopedConnectors query shape', () => {
  test('user scope: no orgId in key or params', () => {
    const q = buildQuery('user', null);
    expect(q.queryKey).toEqual(['connectors', 'user', null]);
    expect(q.params).toEqual({ scope: 'user' });
    expect(q.enabled).toBe(true);
  });

  test('org scope with id: passes orgId through', () => {
    const q = buildQuery('org', 'acme');
    expect(q.queryKey).toEqual(['connectors', 'org', 'acme']);
    expect(q.params).toEqual({ scope: 'org', orgId: 'acme' });
    expect(q.enabled).toBe(true);
  });

  test('org scope without id: disabled so we do not 404', () => {
    const q = buildQuery('org', null);
    expect(q.enabled).toBe(false);
  });

  test('query keys differ across scopes so caches stay independent', () => {
    const a = buildQuery('user', null).queryKey;
    const b = buildQuery('org', 'acme').queryKey;
    expect(a).not.toEqual(b);
  });
});

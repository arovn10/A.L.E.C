/**
 * Unit test for the curated MCP catalog.
 *
 * Locks in the contract the frontend Discover UI relies on:
 *   - Each entry has {id, name, transport, command, category} at minimum.
 *   - categoriesOf() returns [{name, count}] that sums to the catalog size.
 *   - IDs are unique.
 *
 * We don't pin the exact entry list — adding a new MCP should NOT break
 * this test. It only enforces the shape.
 */
import { describe, it, expect } from '@jest/globals';
import { MCP_CATALOG, categoriesOf } from '../backend/routes/mcpCatalog.mjs';

describe('MCP catalog', () => {
  it('has at least one entry', () => {
    expect(MCP_CATALOG.length).toBeGreaterThan(0);
  });

  it('every entry has the required shape', () => {
    for (const e of MCP_CATALOG) {
      expect(typeof e.id).toBe('string');
      expect(e.id.length).toBeGreaterThan(0);
      expect(typeof e.name).toBe('string');
      expect(['stdio', 'http', 'websocket', 'sse']).toContain(e.transport);
      expect(typeof e.command).toBe('string');
      expect(typeof e.category).toBe('string');
      expect(Array.isArray(e.args)).toBe(true);
      expect(e.env && typeof e.env === 'object').toBe(true);
    }
  });

  it('IDs are unique', () => {
    const ids = MCP_CATALOG.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('categoriesOf totals match the catalog size', () => {
    const cats = categoriesOf();
    const total = cats.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(MCP_CATALOG.length);
    // Each category name should be a non-empty string.
    for (const c of cats) {
      expect(typeof c.name).toBe('string');
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.count).toBeGreaterThan(0);
    }
  });

  it('categoriesOf accepts a custom subset', () => {
    const subset = MCP_CATALOG.slice(0, 2);
    const cats = categoriesOf(subset);
    const total = cats.reduce((s, c) => s + c.count, 0);
    expect(total).toBe(2);
  });
});

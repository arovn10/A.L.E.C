// tests/unit/s5PolishSmoke.test.mjs — S5.4 smoke check.
// Confirms skeleton rows, per-category empty state with action, and toast
// provider wired into SettingsPage are in place.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) =>
  fs.readFileSync(path.resolve(__dirname, '../../frontend/src', rel), 'utf8');

describe('S5.4 polish — skeletons, empty states, toasts', () => {
  test('ConnectorList replaces plain Loading with Skeleton rows', () => {
    const src = read('pages/Settings/ConnectorList.jsx');
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/components\/ui\/Skeleton/);
    expect(src).toMatch(/<Skeleton\s+rows=\{3\}/);
    // old plain-text loading gone
    expect(src).not.toMatch(/Loading connectors\.\.\./);
  });

  test('MCPList replaces plain Loading with Skeleton rows', () => {
    const src = read('pages/Settings/MCPList.jsx');
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/components\/ui\/Skeleton/);
    expect(src).toMatch(/<Skeleton\s+rows=\{3\}/);
    expect(src).not.toMatch(/Loading MCP servers/);
  });

  test('ConnectorList renders an EmptyState for categories with zero connectors', () => {
    const src = read('pages/Settings/ConnectorList.jsx');
    expect(src).toMatch(/EmptyState/);
    // Empty state should offer an action (click to open create drawer)
    expect(src).toMatch(/onAction=\{/);
  });

  test('EmptyState component exists with icon/text/onAction props', () => {
    const src = read('components/ui/EmptyState.jsx');
    expect(src).toMatch(/export default function EmptyState/);
    expect(src).toMatch(/icon/);
    expect(src).toMatch(/text/);
    expect(src).toMatch(/onAction/);
  });

  test('SettingsPage wraps children in ToastProvider', () => {
    const src = read('pages/Settings/SettingsPage.jsx');
    expect(src).toMatch(/ToastProvider/);
    expect(src).toMatch(/from ['"]\.\.\/\.\.\/components\/ui\/Toast/);
  });
});

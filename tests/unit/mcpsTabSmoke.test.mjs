// tests/unit/mcpsTabSmoke.test.mjs — shape check for the MCPs tab module
// graph. We can't mount JSX in the Node jest setup (no jsdom/@testing-library
// wired in this project), so we assert every file parses, exports a default
// component, and that MCPsTab imports the hook + sub-components by file path.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../frontend/src');

function readFile(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

describe('MCPs tab wiring smoke', () => {
  test('MCPsTab renders MCPList + MCPDrawer and uses useScopedMCPs', () => {
    const src = readFile('pages/Settings/MCPsTab.jsx');
    expect(src).toMatch(/import\s+MCPList\s+from\s+'\.\/MCPList\.jsx'/);
    expect(src).toMatch(/import\s+MCPDrawer\s+from\s+'\.\/MCPDrawer\.jsx'/);
    expect(src).toMatch(/useScopedMCPs/);
    expect(src).toMatch(/data-testid="mcps-tab"/);
    expect(src).toMatch(/export default function MCPsTab/);
  });

  test('SettingsPage mounts MCPsTab behind the v2 flag', () => {
    const src = readFile('pages/Settings/SettingsPage.jsx');
    expect(src).toMatch(/import MCPsTab from '\.\/MCPsTab\.jsx'/);
    expect(src).toMatch(/tab === 'mcps'\s+&& v2 && <MCPsTab/);
  });

  test('useScopedMCPs wraps /api/mcp list endpoint via react-query', () => {
    const src = readFile('hooks/useScopedMCPs.js');
    expect(src).toMatch(/from '@tanstack\/react-query'/);
    expect(src).toMatch(/api\.listMcps/);
  });

  test('api/mcp.js exposes start/stop/test + CRUD', () => {
    const src = readFile('api/mcp.js');
    for (const fn of ['listMcps', 'getMcp', 'createMcp', 'patchMcp',
                      'deleteMcp', 'startMcp', 'stopMcp', 'testMcp']) {
      expect(src).toMatch(new RegExp(`export const ${fn}`));
    }
  });
});

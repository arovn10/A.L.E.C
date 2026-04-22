// tests/unit/orgMembersTabSmoke.test.mjs — shape check for S5.1.
// No jsdom in this project, so we smoke-test by reading source and asserting
// the key wiring (React Query hooks, orgs API imports, SettingsPage gate).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../frontend/src');

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('Org members tab wiring smoke', () => {
  test('OrgMembersTab uses orgs API + useOrg + react-query mutations', () => {
    const src = read('pages/Settings/OrgMembersTab.jsx');
    expect(src).toMatch(/from '\.\.\/\.\.\/api\/orgs\.js'/);
    expect(src).toMatch(/from '\.\.\/\.\.\/context\/OrgContext\.jsx'/);
    expect(src).toMatch(/useMutation/);
    expect(src).toMatch(/orgsApi\.addMember/);
    expect(src).toMatch(/orgsApi\.patchMember/);
    expect(src).toMatch(/orgsApi\.removeMember/);
    expect(src).toMatch(/data-testid="org-members-tab"/);
    expect(src).toMatch(/export default function OrgMembersTab/);
  });

  test('SettingsPage mounts OrgMembersTab behind the v2 flag', () => {
    const src = read('pages/Settings/SettingsPage.jsx');
    expect(src).toMatch(/import OrgMembersTab from '\.\/OrgMembersTab\.jsx'/);
    expect(src).toMatch(/tab === 'members'\s+&& v2 && <OrgMembersTab/);
  });
});

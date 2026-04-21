// tests/unit/connectorDrawerRevealSmoke.test.mjs — S5.2 smoke check.
// Confirms the reveal flow gains a confirm() prompt, a countdown deadline,
// and snaps back to the redacted snapshot on timeout.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/src/pages/Settings/ConnectorDrawer.jsx'),
  'utf8'
);

describe('ConnectorDrawer reveal UX (S5.2)', () => {
  test('declares a 60s auto-rehide window', () => {
    expect(src).toMatch(/REVEAL_VISIBLE_MS\s*=\s*60_000/);
  });
  test('reveal button is gated behind confirm()', () => {
    expect(src).toMatch(/confirm\(['"]Reveal plaintext credentials\?/);
  });
  test('tracks a deadline and computes remaining seconds', () => {
    expect(src).toMatch(/setRevealUntil\(/);
    expect(src).toMatch(/setRevealLeft\(/);
  });
  test('snaps fields back to redacted snapshot on expiry', () => {
    expect(src).toMatch(/redactedSnapshot\.current\s*=\s*\{\s*\.\.\.fields\s*\}/);
    expect(src).toMatch(/setFields\(redactedSnapshot\.current\)/);
  });
  test('button label shows "Revealed (Ns)"', () => {
    expect(src).toMatch(/Revealed \(\$\{revealLeft\}s\)/);
  });
});

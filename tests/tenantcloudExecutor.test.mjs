/**
 * Integration test for the TenantCloud Playwright executor.
 *
 * We don't boot a real browser — instead we inject a mock `chromium` that
 * records every call. The assertions lock in the things we'd otherwise only
 * catch in production:
 *   - persistent-context path is per-connector under ~/Library/Application Support
 *   - headless:false (user must be able to take over the window)
 *   - login flow fills email → password → submit in that order
 *   - listProperties scrapes the right selectors
 *   - probe() resolves ok:true when the badge contains the email
 */
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import {
  TenantCloudExecutor,
  SELECTORS,
  __resetExecutors,
} from '../backend/connectors/executors/tenantcloud.mjs';

function makeMockPage({ loggedIn = true, email = 'alec@abodingo.com', properties = [] } = {}) {
  const calls = { fill: [], click: [], goto: [], waitForURL: [] };
  const page = {
    url: () => 'https://app.tenantcloud.com/dashboard',
    goto: jest.fn(async (url) => { calls.goto.push(url); }),
    fill: jest.fn(async (sel, val) => { calls.fill.push([sel, val]); }),
    click: jest.fn(async (sel) => { calls.click.push(sel); }),
    waitForURL: jest.fn(async (p) => { calls.waitForURL.push(String(p)); }),
    screenshot: jest.fn(async () => Buffer.from('PNG')),
    $: jest.fn(async (sel) => {
      if (sel === SELECTORS.loggedInBadge && loggedIn) {
        return { textContent: async () => `signed in as ${email}` };
      }
      return null;
    }),
    $$: jest.fn(async () => properties.map(p => ({
      getAttribute: async () => p.id,
      $: async () => ({ textContent: async () => p.title }),
    }))),
  };
  page.__calls = calls;
  return page;
}

function makeChromium(page) {
  const launchCalls = [];
  return {
    __launchCalls: launchCalls,
    launchPersistentContext: jest.fn(async (dir, opts) => {
      launchCalls.push({ dir, opts });
      return {
        pages: () => [page],
        newPage: async () => page,
        close: async () => {},
      };
    }),
  };
}

describe('TenantCloudExecutor', () => {
  beforeEach(() => __resetExecutors());

  it('uses a per-connector profile dir under Application Support/alec/tenantcloud-profiles', async () => {
    const page = makeMockPage();
    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: '5146d260-17df-44ca-a302-0f6a0e2ce18d',
      email: 'alec@abodingo.com',
      password: 'secret',
      chromium,
    });
    await exec.openDashboard();

    const launched = chromium.__launchCalls[0];
    const expected = path.join(
      os.homedir(),
      'Library', 'Application Support', 'alec', 'tenantcloud-profiles',
      '5146d260-17df-44ca-a302-0f6a0e2ce18d',
    );
    expect(launched.dir).toBe(expected);
    expect(launched.opts.headless).toBe(false); // user must be able to take over
  });

  it('fills email then password then clicks submit when not already logged in', async () => {
    // First $ call for the login badge returns null; second (after fill/click + waitForURL) returns match.
    let probeCount = 0;
    const page = makeMockPage();
    page.$ = jest.fn(async (sel) => {
      if (sel !== SELECTORS.loggedInBadge) return null;
      probeCount += 1;
      if (probeCount === 1) return null; // initial dashboard visit — not yet signed in
      return { textContent: async () => 'signed in as alec@abodingo.com' };
    });

    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: 'test-conn',
      email: 'alec@abodingo.com',
      password: 'hunter2',
      chromium,
    });

    await exec.ensureLogin();

    // The exact selector strings the test pins — a UI refactor must update both
    // the executor and this test together.
    expect(page.__calls.fill).toEqual([
      [SELECTORS.emailInput,    'alec@abodingo.com'],
      [SELECTORS.passwordInput, 'hunter2'],
    ]);
    expect(page.__calls.click).toEqual([SELECTORS.submitButton]);
    // Dashboard URL should be in the goto list (initial visit) and login URL too.
    expect(page.__calls.goto.some(u => u.includes('/login'))).toBe(true);
    expect(page.__calls.goto.some(u => u.includes('/dashboard'))).toBe(true);
  });

  it('skips the login form when the dashboard already shows the user email', async () => {
    const page = makeMockPage({ loggedIn: true });
    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: 'already-in',
      email: 'alec@abodingo.com',
      password: 'nope',
      chromium,
    });

    const res = await exec.ensureLogin();
    expect(res).toEqual({ alreadyLoggedIn: true });
    expect(page.fill).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });

  it('openProperty navigates to /landlord/properties/<id>', async () => {
    const page = makeMockPage();
    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: 'c1', email: 'alec@abodingo.com', password: 'x', chromium,
    });
    await exec.openProperty('42');
    expect(page.__calls.goto).toContain('https://app.tenantcloud.com/landlord/properties/42');
  });

  it('listProperties scrapes rows via SELECTORS.propertyRow / propertyTitle', async () => {
    const page = makeMockPage({
      properties: [
        { id: '11', title: '123 Main St' },
        { id: '12', title: '456 Oak Ave' },
      ],
    });
    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: 'c2', email: 'alec@abodingo.com', password: 'x', chromium,
    });
    const out = await exec.listProperties();
    expect(page.$$).toHaveBeenCalledWith(SELECTORS.propertyRow);
    expect(out.properties).toEqual([
      { id: '11', title: '123 Main St' },
      { id: '12', title: '456 Oak Ave' },
    ]);
  });

  it('screenshot returns a base64 PNG', async () => {
    const page = makeMockPage();
    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: 'c3', email: 'alec@abodingo.com', password: 'x', chromium,
    });
    const out = await exec.screenshot();
    expect(typeof out.png_base64).toBe('string');
    expect(Buffer.from(out.png_base64, 'base64').toString()).toBe('PNG');
  });

  it('probe returns ok:true when the email badge is visible on the dashboard', async () => {
    const page = makeMockPage({ loggedIn: true, email: 'alec@abodingo.com' });
    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: 'c4', email: 'alec@abodingo.com', password: 'x', chromium,
    });
    const res = await exec.probe();
    expect(res).toEqual({ ok: true });
  });

  it('probe returns ok:false with a detail message on login failure', async () => {
    const page = makeMockPage({ loggedIn: false });
    // Simulate a hang → waitForURL rejects.
    page.waitForURL = jest.fn(async () => { throw new Error('Timeout: dashboard never loaded'); });
    const chromium = makeChromium(page);
    const exec = new TenantCloudExecutor({
      connectorId: 'c5', email: 'alec@abodingo.com', password: 'bad', chromium,
    });
    const res = await exec.probe();
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/dashboard|Timeout/i);
  });

  it('rejects construction when email or password is missing', () => {
    expect(() => new TenantCloudExecutor({ connectorId: 'x', email: '', password: 'p' })).toThrow();
    expect(() => new TenantCloudExecutor({ connectorId: 'x', email: 'e', password: '' })).toThrow();
  });
});

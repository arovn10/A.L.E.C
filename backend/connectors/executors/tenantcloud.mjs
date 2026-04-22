// backend/connectors/executors/tenantcloud.mjs
//
// TenantCloud has no public API on the starter tier. This executor drives
// app.tenantcloud.com through a headed Chromium context so ALEC can perform
// tenant/property/payment flows while still letting Alec take over the window
// at any point — the browser stays open after each call.
//
// Persistence: each connector instance gets its own user-data-dir under
//   ~/Library/Application Support/alec/tenantcloud-profiles/<connector_id>/
// so cookies, localStorage, and any MFA state stick across invocations.
//
// Credentials: pulled from the vault via getFields(id) using the decrypted
// TENANTCLOUD_EMAIL / TENANTCLOUD_PASSWORD keys.
//
// Liveness: see probe() — navigates to /dashboard and asserts the logged-in
// user's email appears in the top nav.
//
// Playwright is loaded lazily via dynamic import so this module can be
// imported (and unit-tested with a mock) on systems where playwright is
// not installed.

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE_URL = 'https://app.tenantcloud.com';
const LOGIN_URL = `${BASE_URL}/login`;
const DASHBOARD_URL = `${BASE_URL}/dashboard`;
const PROPERTIES_URL = `${BASE_URL}/landlord/properties`;

// Selectors are centralised so the test can assert against them and so a
// TenantCloud UI refresh only needs a single edit.
export const SELECTORS = {
  emailInput:    'input[name="email"], input[type="email"]',
  passwordInput: 'input[name="password"], input[type="password"]',
  submitButton:  'button[type="submit"]',
  loggedInBadge: '[data-testid="user-menu"], .user-menu, nav .user-email',
  propertyRow:   '[data-testid="property-row"], .property-card, tr.property',
  propertyTitle: '[data-testid="property-title"], .property-card__title, td.property-name',
};

function profileDir(connectorId) {
  const root = path.join(
    os.homedir(),
    'Library', 'Application Support', 'alec', 'tenantcloud-profiles',
    connectorId,
  );
  fs.mkdirSync(root, { recursive: true });
  return root;
}

// Lazy playwright import so tests can mock via jest.unstable_mockModule and
// the server can start even without playwright installed (it only fails on
// first executor use, with a clear message).
async function loadPlaywright() {
  try {
    const mod = await import('playwright');
    return mod.chromium;
  } catch (err) {
    throw new Error(
      'playwright is not installed — run `npm i -D playwright && npx playwright install chromium`'
    );
  }
}

// One executor per (process, connector_id). Reuses a single headed browser
// context across tool calls so the user can take over a live window.
const instances = new Map();

export class TenantCloudExecutor {
  constructor({ connectorId, email, password, chromium }) {
    if (!connectorId) throw new Error('connectorId required');
    if (!email || !password) throw new Error('TENANTCLOUD_EMAIL and TENANTCLOUD_PASSWORD required');
    this.connectorId = connectorId;
    this.email = email;
    this.password = password;
    this.chromium = chromium;
    this.context = null;
    this.page = null;
    this._loginPromise = null;
  }

  async _ctx() {
    if (this.context) return this.context;
    const chromium = this.chromium || await loadPlaywright();
    this.context = await chromium.launchPersistentContext(profileDir(this.connectorId), {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
    // Re-use the first page the persistent context opens with.
    const pages = this.context.pages();
    this.page = pages[0] || await this.context.newPage();
    return this.context;
  }

  async _page() {
    await this._ctx();
    return this.page;
  }

  async _isLoggedIn(page) {
    const badge = await page.$(SELECTORS.loggedInBadge);
    if (!badge) return false;
    const text = (await badge.textContent()) || '';
    return text.includes(this.email);
  }

  async ensureLogin() {
    if (this._loginPromise) return this._loginPromise;
    this._loginPromise = (async () => {
      const page = await this._page();
      await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
      if (await this._isLoggedIn(page)) return { alreadyLoggedIn: true };

      await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
      await page.fill(SELECTORS.emailInput, this.email);
      await page.fill(SELECTORS.passwordInput, this.password);
      await page.click(SELECTORS.submitButton);
      await page.waitForURL(/dashboard/i, { timeout: 30_000 });
      if (!(await this._isLoggedIn(page))) {
        throw new Error('login did not reach dashboard — check credentials or MFA');
      }
      return { alreadyLoggedIn: false };
    })();
    try { return await this._loginPromise; }
    finally { this._loginPromise = null; }
  }

  async openDashboard() {
    await this.ensureLogin();
    const page = await this._page();
    await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
    return { url: page.url() };
  }

  async openProperty(id) {
    if (!id) throw new Error('property id required');
    await this.ensureLogin();
    const page = await this._page();
    await page.goto(`${PROPERTIES_URL}/${encodeURIComponent(id)}`, { waitUntil: 'domcontentloaded' });
    return { url: page.url() };
  }

  async listProperties() {
    await this.ensureLogin();
    const page = await this._page();
    await page.goto(PROPERTIES_URL, { waitUntil: 'domcontentloaded' });
    const rows = await page.$$(SELECTORS.propertyRow);
    const out = [];
    for (const row of rows) {
      const titleEl = await row.$(SELECTORS.propertyTitle);
      const title = titleEl ? ((await titleEl.textContent()) || '').trim() : '';
      const id = await row.getAttribute('data-id');
      out.push({ id: id || null, title });
    }
    return { properties: out };
  }

  async screenshot() {
    const page = await this._page();
    const buf = await page.screenshot({ fullPage: true });
    return { png_base64: Buffer.from(buf).toString('base64') };
  }

  async probe() {
    try {
      await this.ensureLogin();
      const page = await this._page();
      if (!(await this._isLoggedIn(page))) {
        return { ok: false, detail: 'email not visible in nav' };
      }
      return { ok: true };
    } catch (err) {
      const msg = String(err && err.message || err);
      const captcha = /captcha|robot|recaptcha/i.test(msg) ? ' (CAPTCHA?)' : '';
      return { ok: false, detail: msg + captcha };
    }
  }

  async close() {
    try { if (this.context) await this.context.close(); } catch {}
    this.context = null;
    this.page = null;
  }
}

export async function getExecutor({ connectorId, getFieldsFn, chromium } = {}) {
  if (!connectorId) throw new Error('connectorId required');
  if (instances.has(connectorId)) return instances.get(connectorId);

  // Default to the real vault loader; injectable for tests.
  let fields;
  if (getFieldsFn) {
    fields = await getFieldsFn(connectorId);
  } else {
    const vault = await import('../../services/secretVault.mjs');
    fields = vault.getFields(connectorId);
  }

  const exec = new TenantCloudExecutor({
    connectorId,
    email:    fields.TENANTCLOUD_EMAIL,
    password: fields.TENANTCLOUD_PASSWORD,
    chromium,
  });
  instances.set(connectorId, exec);
  return exec;
}

// Test-only — not exported through any public API surface.
export function __resetExecutors() { instances.clear(); }

// Matches the MCP tool names advertised in the stdio wrapper.
export const TOOLS = [
  { name: 'open_dashboard',  description: 'Navigate the TenantCloud browser to the dashboard.' },
  { name: 'open_property',   description: 'Navigate to /landlord/properties/<id>.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list_properties', description: 'Scrape the properties list page.' },
  { name: 'screenshot',      description: 'Return a base64 PNG of the current page.' },
];

/**
 * A.L.E.C. TenantCloud Service — Browser Scraper
 *
 * Uses Puppeteer to log into TenantCloud with your email/password,
 * persist the session via cookies, and scrape live data from the UI.
 *
 * No API key needed. Set in .env:
 *   TENANTCLOUD_EMAIL=your@email.com
 *   TENANTCLOUD_PASSWORD=yourpassword
 *
 * The browser session is reused across calls (login once per server restart).
 * Cookies are saved to data/tc-session.json so login survives restarts.
 */

const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin  = require('puppeteer-extra-plugin-stealth');
puppeteerExtra.use(StealthPlugin());
const path      = require('path');
const fs        = require('fs');

const TC_BASE    = 'https://app.tenantcloud.com';
const SESSION_FILE = path.join(__dirname, '../data/tc-session.json');
const CHROME_PATH  = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let _browser   = null;
let _page      = null;
let _loggedIn  = false;
let _mfaResolver = null;    // set when waiting for a 2FA code from the user
let _mfaPending  = false;   // true while blocked on 2FA input

// Lazy-load iMessage so we can notify the user about 2FA
function getIMessage() { try { return require('./iMessageService.js'); } catch { return null; } }

// ── Browser lifecycle ─────────────────────────────────────────────

async function getBrowser(headless = true) {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await puppeteerExtra.launch({
    executablePath: CHROME_PATH,
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
           '--disable-blink-features=AutomationControlled'],
  });
  _page    = null;
  _loggedIn = false;
  return _browser;
}

/**
 * Open a visible Chrome window so the user can log in manually.
 * Waits until they're past the login page, saves cookies, then closes.
 * Returns { success, message }.
 */
async function startManualLogin() {
  // Close any existing headless browser first
  if (_browser) { try { await _browser.close(); } catch (_) {} _browser = null; _page = null; _loggedIn = false; }
  fs.rmSync(SESSION_FILE, { force: true });

  console.log('[TenantCloud] Opening visible Chrome for manual login...');
  const browser = await puppeteerExtra.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null, // use full window size
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
  });

  const page = await browser.newPage();
  await page.goto(`${TC_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });

  // Poll until user navigates away from login (they logged in successfully)
  const MAX_WAIT = 5 * 60 * 1000; // 5 minutes
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT) {
    await new Promise(r => setTimeout(r, 1000));
    const url = page.url().toLowerCase();
    if (!url.includes('/login') && !url.includes('/sign-in') && !isMfaPage(url)) {
      // Logged in — save cookies
      const cookies = await page.cookies();
      saveCookies(cookies);
      _loggedIn = true;
      console.log('[TenantCloud] Manual login detected, cookies saved');
      await browser.close();
      return { success: true, message: 'Logged in successfully. TenantCloud is ready.' };
    }
  }

  await browser.close();
  return { success: false, message: 'Timed out waiting for login (5 min). Please try again.' };
}

async function getPage() {
  const browser = await getBrowser();
  if (_page && !_page.isClosed()) return _page;
  _page = await browser.newPage();
  await _page.setViewport({ width: 1280, height: 900 });
  // Suppress images/fonts to speed up scraping
  await _page.setRequestInterception(true);
  _page.on('request', req => {
    if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
    else req.continue();
  });
  return _page;
}

// ── Session persistence ───────────────────────────────────────────

function loadSavedCookies() {
  try {
    if (fs.existsSync(SESSION_FILE)) return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  } catch (_) {}
  return null;
}

function saveCookies(cookies) {
  try {
    fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
    fs.writeFileSync(SESSION_FILE, JSON.stringify(cookies));
  } catch (_) {}
}

// ── 2FA code injection (called from API endpoint) ─────────────────

/**
 * Called by POST /api/tenantcloud/verify-code when the user submits
 * the verification code that TenantCloud texted/emailed them.
 */
function submitVerificationCode(code) {
  if (_mfaResolver) {
    _mfaResolver(String(code).trim());
    _mfaResolver = null;
  } else {
    throw new Error('No verification code is currently pending');
  }
}

function isMfaPending() { return _mfaPending; }

// ── Login ─────────────────────────────────────────────────────────

function isMfaPage(url) {
  return /verif|2fa|otp|code|two.?factor|confirm|authenticate/i.test(url);
}

async function ensureLoggedIn() {
  if (_loggedIn) return;

  // If another call is already blocked on 2FA, wait for it to resolve
  if (_mfaPending) {
    await new Promise(resolve => {
      const check = setInterval(() => { if (!_mfaPending) { clearInterval(check); resolve(); } }, 500);
    });
    if (_loggedIn) return;
  }

  const email = process.env.TENANTCLOUD_EMAIL;
  const pass  = process.env.TENANTCLOUD_PASSWORD;
  if (!email || !pass) throw new Error('TENANTCLOUD_EMAIL and TENANTCLOUD_PASSWORD must be set in .env');

  const page = await getPage();

  // Try restoring saved session first
  const saved = loadSavedCookies();
  if (saved) {
    await page.setCookie(...saved);
    await page.goto(`${TC_BASE}/landlord/dashboard`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000)); // let SPA redirect settle
    const url = page.url();
    if (!url.includes('/login') && !url.includes('/sign-in') && !isMfaPage(url)) {
      _loggedIn = true;
      console.log('[TenantCloud] Restored session from cookies');
      return;
    }
    // Saved session expired — clear and re-login
    fs.rmSync(SESSION_FILE, { force: true });
  }

  // Full login flow
  console.log('[TenantCloud] Logging in with email/password...');
  await page.goto(`${TC_BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await new Promise(r => setTimeout(r, 1500)); // let React render the form

  // Fill email
  await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 10000 });
  const emailInput = await page.$('input[type="email"], input[name="email"], #email');
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 40 });

  // Fill password
  await page.waitForSelector('input[type="password"]', { timeout: 5000 });
  const passInput = await page.$('input[type="password"]');
  await passInput.click({ clickCount: 3 });
  await passInput.type(pass, { delay: 40 });

  // Click the "Sign in" button — must skip Google/Apple/Facebook submit buttons
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[type="submit"]')]
      .find(b => /^sign\s*in$/i.test(b.innerText.trim()));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) await page.keyboard.press('Enter');

  // SPA login — wait for URL to change away from /login (up to 20s)
  try {
    await page.waitForFunction(
      () => !window.location.href.includes('/login') && !window.location.href.includes('/sign-in'),
      { timeout: 20000 }
    );
  } catch (_) {
    // If URL didn't change, check if a dashboard element appeared (SPA may stay on same URL)
    const dashEl = await page.$('[class*="dashboard"], [class*="landlord"], nav, .sidebar, #app-content').catch(() => null);
    if (!dashEl) {
      // Last resort: wait a bit and check URL
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  const postLoginUrl = page.url();

  // ── 2FA / verification code required ────────────────────────────
  if (isMfaPage(postLoginUrl) || postLoginUrl.includes('/login')) {
    // Check if there's a code input field on the page
    const hasCodeField = await page.$('input[type="text"], input[type="number"], input[name*="code"], input[name*="otp"], input[id*="code"], input[placeholder*="code"]')
      .then(el => !!el).catch(() => false);

    if (hasCodeField || isMfaPage(postLoginUrl)) {
      console.log('[TenantCloud] 2FA/verification code required');
      _mfaPending = true;

      // Notify the user via iMessage
      const im = getIMessage();
      const notifyMsg = '🏠 TenantCloud needs a verification code to log in. Go to Settings → Skills → TenantCloud → Enter Code, or reply with the code in ALEC chat.';
      if (im) im.notifyOwner(notifyMsg, 'TenantCloud 2FA').catch(() => {});
      console.log('[TenantCloud] Waiting for user to submit verification code (up to 10 min)...');

      // Wait for user to call submitVerificationCode()
      const code = await new Promise((resolve, reject) => {
        _mfaResolver = resolve;
        setTimeout(() => {
          _mfaResolver = null;
          _mfaPending  = false;
          reject(new Error('Timed out waiting for TenantCloud verification code (10 min)'));
        }, 10 * 60 * 1000);
      });

      // Enter the code into the page
      const codeInput = await page.$('input[type="text"], input[type="number"], input[name*="code"], input[name*="otp"], input[id*="code"]');
      if (codeInput) {
        await codeInput.click({ clickCount: 3 });
        await codeInput.type(code, { delay: 50 });
        const mfaSubmit = await page.$('button[type="submit"], input[type="submit"]');
        if (mfaSubmit) await mfaSubmit.click();
        else await page.keyboard.press('Enter');
        // Wait for URL to leave verification page
        await page.waitForFunction(
          () => !window.location.href.match(/verif|2fa|otp|code|two.?factor|confirm|authenticate/i),
          { timeout: 15000 }
        ).catch(() => {});
      }

      _mfaPending = false;

      if (isMfaPage(page.url()) || page.url().includes('/login')) {
        throw new Error('TenantCloud verification code was incorrect or expired');
      }
    } else {
      throw new Error('TenantCloud login failed — check TENANTCLOUD_EMAIL and TENANTCLOUD_PASSWORD');
    }
  }

  // Save cookies for next restart
  const cookies = await page.cookies();
  saveCookies(cookies);
  _loggedIn = true;
  console.log('[TenantCloud] Login successful, session saved');
}

// ── Helpers ───────────────────────────────────────────────────────

async function scrapePage(url, scrapeFunc, retries = 1) {
  await ensureLoggedIn();
  const page = await getPage();
  for (let i = 0; i <= retries; i++) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
      await new Promise(r => setTimeout(r, 2000)); // let SPA render
      // If redirected to login, re-authenticate
      if (page.url().includes('/login')) {
        _loggedIn = false;
        await ensureLoggedIn();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await new Promise(r => setTimeout(r, 2000));
      }
      return await scrapeFunc(page);
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ── Scraping functions ────────────────────────────────────────────

async function getPortfolioSummary() {
  return scrapePage(`${TC_BASE}/landlord/dashboard`, async (page) => {
    // Wait for dashboard cards to load
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 2000)); // let JS render

    const data = await page.evaluate(() => {
      const text = document.body.innerText;

      // Helper: extract number near a keyword
      function extractNum(re) {
        const m = text.match(re);
        return m ? parseInt(m[1].replace(/,/g, ''), 10) || 0 : 0;
      }
      function extractMoney(re) {
        const m = text.match(re);
        return m ? parseFloat(m[1].replace(/[,$]/g, '')) || 0 : 0;
      }

      return {
        properties:  { total: extractNum(/(\d+)\s*propert/i) },
        tenants:     { total: extractNum(/(\d+)\s*tenant/i), active: extractNum(/(\d+)\s*active\s*tenant/i) },
        maintenance: { open: extractNum(/(\d+)\s*(open\s*)?maintenance/i), highPriority: 0 },
        overdue:     { count: extractNum(/(\d+)\s*overdue/i), totalAmount: extractMoney(/\$([0-9,]+(?:\.\d+)?)\s*overdue/i) },
        messages:    { unread: extractNum(/(\d+)\s*unread/i) },
        inquiries:   { new: extractNum(/(\d+)\s*(new\s*)?inquir/i) },
        updatedAt:   new Date().toISOString(),
        _source:     'browser-scrape',
      };
    });
    return data;
  });
}

async function listTenants() {
  return scrapePage(`${TC_BASE}/landlord/tenants`, async (page) => {
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr, [class*="tenant-row"], [class*="list-item"]')];
      return rows.slice(0, 50).map(row => {
        const cells = [...row.querySelectorAll('td, [class*="cell"]')].map(c => c.innerText.trim());
        return { name: cells[0] || '', email: cells[1] || '', unit: cells[2] || '', status: cells[3] || '', raw: cells.join(' | ') };
      }).filter(r => r.name);
    });
  });
}

async function listMaintenance(filter = '') {
  const url = `${TC_BASE}/landlord/maintenance` + (filter ? `?status=${filter}` : '');
  return scrapePage(url, async (page) => {
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr, [class*="request-row"], [class*="list-item"]')];
      return rows.slice(0, 30).map(row => {
        const cells = [...row.querySelectorAll('td, [class*="cell"]')].map(c => c.innerText.trim());
        return { title: cells[0] || '', property: cells[1] || '', status: cells[2] || '', priority: cells[3] || '', createdAt: cells[4] || '' };
      }).filter(r => r.title);
    });
  });
}

async function getOpenMaintenance() {
  return listMaintenance('open');
}

async function listPayments(filter = '') {
  const url = `${TC_BASE}/landlord/payments` + (filter ? `?status=${filter}` : '');
  return scrapePage(url, async (page) => {
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr, [class*="payment-row"], [class*="list-item"]')];
      return rows.slice(0, 30).map(row => {
        const cells = [...row.querySelectorAll('td, [class*="cell"]')].map(c => c.innerText.trim());
        return { tenant: cells[0] || '', amount: cells[1] || '', dueDate: cells[2] || '', status: cells[3] || '', type: cells[4] || '' };
      }).filter(r => r.tenant);
    });
  });
}

async function getOverdueRent() {
  return listPayments('overdue');
}

async function listLeases() {
  return scrapePage(`${TC_BASE}/landlord/leases`, async (page) => {
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr, [class*="lease-row"], [class*="list-item"]')];
      return rows.slice(0, 30).map(row => {
        const cells = [...row.querySelectorAll('td, [class*="cell"]')].map(c => c.innerText.trim());
        return { tenant: cells[0] || '', property: cells[1] || '', unit: cells[2] || '', startDate: cells[3] || '', endDate: cells[4] || '', rent: cells[5] || '', status: cells[6] || '' };
      }).filter(r => r.tenant);
    });
  });
}

async function listProperties() {
  return scrapePage(`${TC_BASE}/landlord/properties`, async (page) => {
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr, [class*="property-row"], [class*="list-item"], [class*="property-card"]')];
      return rows.slice(0, 30).map(row => {
        const cells = [...row.querySelectorAll('td, [class*="cell"], [class*="info"]')].map(c => c.innerText.trim());
        return { name: cells[0] || '', address: cells[1] || '', units: cells[2] || '', type: cells[3] || '', status: cells[4] || '' };
      }).filter(r => r.name);
    });
  });
}

async function listMessages() {
  return scrapePage(`${TC_BASE}/landlord/messages`, async (page) => {
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('[class*="message-row"], [class*="conversation"], [class*="list-item"], table tbody tr')];
      return rows.slice(0, 20).map(row => ({
        from:    row.querySelector('[class*="sender"], [class*="name"], td:first-child')?.innerText.trim() || '',
        subject: row.querySelector('[class*="subject"], [class*="title"], td:nth-child(2)')?.innerText.trim() || '',
        preview: row.querySelector('[class*="preview"], [class*="body"], td:nth-child(3)')?.innerText.trim().slice(0, 120) || '',
        isRead:  !row.classList.toString().includes('unread'),
      })).filter(r => r.from);
    });
  });
}

async function getUnreadMessages() {
  const all = await listMessages();
  return all.filter(m => !m.isRead);
}

async function listInquiries() {
  return scrapePage(`${TC_BASE}/landlord/inquiries`, async (page) => {
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1500));

    return page.evaluate(() => {
      const rows = [...document.querySelectorAll('table tbody tr, [class*="inquiry-row"], [class*="list-item"]')];
      return rows.slice(0, 20).map(row => {
        const cells = [...row.querySelectorAll('td, [class*="cell"]')].map(c => c.innerText.trim());
        return { name: cells[0] || '', property: cells[1] || '', email: cells[2] || '', message: cells[3]?.slice(0, 200) || '', status: cells[4] || '' };
      }).filter(r => r.name);
    });
  });
}

async function analyzeRentPatterns() {
  const payments = await listPayments();
  const paid    = payments.filter(p => /paid/i.test(p.status));
  const overdue = payments.filter(p => /overdue|late/i.test(p.status));
  const totalOverdue = overdue.reduce((a, p) => {
    const n = parseFloat(String(p.amount).replace(/[^0-9.]/g, '')) || 0;
    return a + n;
  }, 0);
  return {
    collected: { count: paid.length },
    overdue:   { count: overdue.length, total: totalOverdue },
    insights: [
      totalOverdue > 0 ? `⚠️ $${totalOverdue.toLocaleString()} overdue across ${overdue.length} payments` : '✅ No overdue rent',
      overdue.length > 0 ? `Late payers: ${overdue.map(p => p.tenant).slice(0, 3).join(', ')}` : null,
    ].filter(Boolean),
  };
}

// ── Stubs for API-compat (not easily scrapeable) ─────────────────

async function getProperty(id)               { return listProperties().then(p => p.find(x => x.id === id) || p[0]); }
async function listUnits()                    { return []; }
async function getTenant(id)                  { return listTenants().then(t => t.find(x => x.id === id) || t[0]); }
async function getExpiringLeases(days = 60)   { return listLeases(); }
async function getOutstandingRent()           { return getOverdueRent(); }
async function updateMaintenanceStatus()      { return { success: false, reason: 'browser-scrape mode: not supported' }; }

// ── Status ────────────────────────────────────────────────────────

async function status() {
  const email = process.env.TENANTCLOUD_EMAIL;
  const pass  = process.env.TENANTCLOUD_PASSWORD;
  if (!email || !pass) {
    return { configured: false, hint: 'Add TENANTCLOUD_EMAIL and TENANTCLOUD_PASSWORD to .env' };
  }
  try {
    await ensureLoggedIn();
    const props = await listProperties();
    return { configured: true, authenticated: true, propertyCount: props.length, mode: 'browser-scrape' };
  } catch (err) {
    return { configured: true, authenticated: false, error: err.message, mode: 'browser-scrape' };
  }
}

// ── Cleanup on process exit ───────────────────────────────────────
process.on('exit', () => { if (_browser) _browser.close().catch(() => {}); });
process.on('SIGINT', () => { if (_browser) _browser.close().catch(() => {}); });

module.exports = {
  listProperties, getProperty, listUnits,
  listTenants, getTenant,
  listLeases, getExpiringLeases,
  listPayments, getOverdueRent, getOutstandingRent,
  listMaintenance, getOpenMaintenance, updateMaintenanceStatus,
  listMessages, getUnreadMessages,
  listInquiries,
  getPortfolioSummary, analyzeRentPatterns,
  submitVerificationCode, isMfaPending,
  startManualLogin,
  status,
};

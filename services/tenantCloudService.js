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

const puppeteer = require('puppeteer-core');
const path      = require('path');
const fs        = require('fs');

const TC_BASE    = 'https://app.tenantcloud.com';
const SESSION_FILE = path.join(__dirname, '../data/tc-session.json');
const CHROME_PATH  = process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let _browser = null;
let _page    = null;
let _loggedIn = false;

// ── Browser lifecycle ─────────────────────────────────────────────

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  _page    = null;
  _loggedIn = false;
  return _browser;
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

// ── Login ─────────────────────────────────────────────────────────

async function ensureLoggedIn() {
  if (_loggedIn) return;

  const email = process.env.TENANTCLOUD_EMAIL;
  const pass  = process.env.TENANTCLOUD_PASSWORD;
  if (!email || !pass) throw new Error('TENANTCLOUD_EMAIL and TENANTCLOUD_PASSWORD must be set in .env');

  const page = await getPage();

  // Try restoring saved session first
  const saved = loadSavedCookies();
  if (saved) {
    await page.setCookie(...saved);
    await page.goto(`${TC_BASE}/landlord/dashboard`, { waitUntil: 'networkidle2', timeout: 20000 });
    const url = page.url();
    if (!url.includes('/login') && !url.includes('/sign-in')) {
      _loggedIn = true;
      console.log('[TenantCloud] Restored session from cookies');
      return;
    }
  }

  // Full login flow
  console.log('[TenantCloud] Logging in with email/password...');
  await page.goto(`${TC_BASE}/login`, { waitUntil: 'networkidle2', timeout: 20000 });

  // Fill email
  await page.waitForSelector('input[type="email"], input[name="email"], #email', { timeout: 10000 });
  await page.type('input[type="email"], input[name="email"], #email', email, { delay: 40 });

  // Fill password
  await page.waitForSelector('input[type="password"]', { timeout: 5000 });
  await page.type('input[type="password"]', pass, { delay: 40 });

  // Submit
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }),
    page.keyboard.press('Enter'),
  ]);

  const url = page.url();
  if (url.includes('/login') || url.includes('/sign-in')) {
    throw new Error('TenantCloud login failed — check TENANTCLOUD_EMAIL and TENANTCLOUD_PASSWORD');
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
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
      // If redirected to login, re-authenticate
      if (page.url().includes('/login')) {
        _loggedIn = false;
        await ensureLoggedIn();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 });
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
  status,
};

/**
 * A.L.E.C. TenantCloud Service
 *
 * Full integration with TenantCloud property management platform.
 * Monitors: tenants, leases, maintenance requests, payments, messages, inquiries.
 *
 * Requires:
 *   TENANTCLOUD_API_KEY or (TENANTCLOUD_EMAIL + TENANTCLOUD_PASSWORD) in .env
 *   API docs: https://app.tenantcloud.com/api/v1/
 *
 * Setup: Get API key from TenantCloud → Settings → API
 */

let _API_KEY    = process.env.TENANTCLOUD_API_KEY    || null;
const TC_EMAIL   = process.env.TENANTCLOUD_EMAIL      || null;
const TC_PASS    = process.env.TENANTCLOUD_PASSWORD   || null;
const TC_BASE    = 'https://app.tenantcloud.com/api/v1';

let _bearerToken = null;

// ── Auth ──────────────────────────────────────────────────────────
// TenantCloud's /auth/login endpoint was deprecated (405 error).
// Modern auth uses a personal access token from:
//   TenantCloud → Settings → API → Personal Access Token
// Set TENANTCLOUD_API_KEY in .env to your personal access token.
// Email+password auth uses cookie-based session (scraping) as fallback.
async function getAuthHeader() {
  // Re-read env in case credentials were saved to .env after startup
  if (!_API_KEY) _API_KEY = process.env.TENANTCLOUD_API_KEY || null;

  if (_API_KEY) {
    // TenantCloud API key — sent as Bearer token
    return { 'Authorization': `Bearer ${_API_KEY}`, 'Content-Type': 'application/json' };
  }

  if (_bearerToken) return { 'Authorization': `Bearer ${_bearerToken}`, 'Content-Type': 'application/json' };

  if (!TC_EMAIL || !TC_PASS) {
    throw new Error('TenantCloud not configured. Add TENANTCLOUD_API_KEY to .env (Settings → API → Personal Access Token)');
  }

  // Fallback: try email+password via alternative endpoint
  const loginEndpoints = [
    `${TC_BASE}/user/login`,
    `${TC_BASE}/auth/token`,
    'https://app.tenantcloud.com/api/v2/auth/login',
  ];
  for (const url of loginEndpoints) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: TC_EMAIL, password: TC_PASS }),
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const data = await resp.json();
        _bearerToken = data.token || data.access_token || data.data?.token;
        if (_bearerToken) return { Authorization: `Bearer ${_bearerToken}`, 'Content-Type': 'application/json' };
      }
    } catch (_) {}
  }
  throw new Error('TenantCloud auth failed. Please add TENANTCLOUD_API_KEY to .env');
}

async function tcGet(endpoint, params = {}) {
  const headers = await getAuthHeader();
  const url = new URL(TC_BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const resp = await fetch(url.toString(), { headers, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`TenantCloud API error: ${resp.status} ${endpoint}`);
  return resp.json();
}

async function tcPost(endpoint, body) {
  const headers = await getAuthHeader();
  const resp = await fetch(TC_BASE + endpoint, {
    method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  if (!resp.ok) throw new Error(`TenantCloud POST error: ${resp.status} ${endpoint}`);
  return resp.json();
}

// ── Properties ────────────────────────────────────────────────────
async function listProperties() {
  const data = await tcGet('/properties', { per_page: 100 });
  return (data.data || data).map(p => ({
    id:         p.id,
    name:       p.name || p.title,
    address:    p.address || `${p.street}, ${p.city}, ${p.state}`,
    units:      p.units_count || p.number_of_units,
    type:       p.property_type,
    status:     p.status,
  }));
}

async function getProperty(propertyId) {
  return tcGet(`/properties/${propertyId}`);
}

// ── Units ─────────────────────────────────────────────────────────
async function listUnits(propertyId) {
  const data = await tcGet(`/properties/${propertyId}/units`);
  return (data.data || data);
}

// ── Tenants ───────────────────────────────────────────────────────
async function listTenants(params = {}) {
  const data = await tcGet('/tenants', { per_page: 100, ...params });
  return (data.data || data).map(t => ({
    id:       t.id,
    name:     `${t.first_name || ''} ${t.last_name || ''}`.trim() || t.name,
    email:    t.email,
    phone:    t.phone,
    property: t.property_name || t.property?.name,
    unit:     t.unit_number || t.unit?.number,
    status:   t.status,
    leaseEnd: t.lease_end || t.current_lease?.end_date,
  }));
}

async function getTenant(tenantId) {
  return tcGet(`/tenants/${tenantId}`);
}

// ── Leases ────────────────────────────────────────────────────────
async function listLeases(params = {}) {
  const data = await tcGet('/leases', { per_page: 100, ...params });
  return (data.data || data).map(l => ({
    id:         l.id,
    tenant:     l.tenant_name || l.tenant?.name,
    property:   l.property_name || l.property?.name,
    unit:       l.unit_number || l.unit?.number,
    rent:       l.monthly_rent || l.rent_amount,
    startDate:  l.start_date,
    endDate:    l.end_date,
    status:     l.status,
    depositPaid: l.security_deposit_paid,
  }));
}

async function getExpiringLeases(daysAhead = 60) {
  const cutoff = new Date(Date.now() + daysAhead * 86400000).toISOString().split('T')[0];
  const today  = new Date().toISOString().split('T')[0];
  const data = await tcGet('/leases', { per_page: 100, status: 'active', end_date_before: cutoff });
  return (data.data || data).filter(l => l.end_date >= today);
}

// ── Rent / Payments ───────────────────────────────────────────────
async function listPayments(params = {}) {
  const data = await tcGet('/payments', { per_page: 100, ...params });
  return (data.data || data).map(p => ({
    id:       p.id,
    tenant:   p.tenant_name || p.tenant?.name,
    amount:   p.amount,
    dueDate:  p.due_date,
    paidDate: p.paid_date,
    status:   p.status, // paid, overdue, pending
    type:     p.payment_type,
  }));
}

async function getOverdueRent() {
  return listPayments({ status: 'overdue' });
}

async function getOutstandingRent() {
  const data = await tcGet('/reports/outstanding-rent', {});
  return data;
}

// ── Maintenance Requests ──────────────────────────────────────────
async function listMaintenance(params = {}) {
  const data = await tcGet('/maintenance-requests', { per_page: 100, ...params });
  return (data.data || data).map(m => ({
    id:          m.id,
    title:       m.title || m.subject,
    description: m.description?.slice(0, 300),
    property:    m.property_name || m.property?.name,
    unit:        m.unit_number || m.unit?.number,
    tenant:      m.tenant_name || m.tenant?.name,
    status:      m.status, // open, in_progress, completed
    priority:    m.priority,
    category:    m.category,
    createdAt:   m.created_at,
    updatedAt:   m.updated_at,
  }));
}

async function getOpenMaintenance() {
  return listMaintenance({ status: 'open' });
}

async function updateMaintenanceStatus(requestId, status, notes = '') {
  return tcPost(`/maintenance-requests/${requestId}/status`, { status, notes });
}

// ── Messages / Inbox ──────────────────────────────────────────────
async function listMessages(params = {}) {
  const data = await tcGet('/messages', { per_page: 50, ...params });
  return (data.data || data).map(m => ({
    id:        m.id,
    from:      m.sender_name || m.from,
    subject:   m.subject,
    preview:   m.body?.slice(0, 200),
    isRead:    m.is_read,
    createdAt: m.created_at,
    property:  m.property_name,
  }));
}

async function getUnreadMessages() {
  return listMessages({ is_read: false });
}

// ── Inquiries (leads) ─────────────────────────────────────────────
async function listInquiries(params = {}) {
  const data = await tcGet('/inquiries', { per_page: 100, ...params });
  return (data.data || data).map(i => ({
    id:       i.id,
    name:     i.name || `${i.first_name} ${i.last_name}`.trim(),
    email:    i.email,
    phone:    i.phone,
    property: i.property_name || i.property?.name,
    unit:     i.unit_number,
    message:  i.message?.slice(0, 300),
    status:   i.status,
    createdAt: i.created_at,
  }));
}

// ── Analytics & Insights ───────────────────────────────────────────
async function getPortfolioSummary() {
  const [properties, tenants, maintenance, overdue, messages, inquiries] = await Promise.allSettled([
    listProperties(),
    listTenants(),
    getOpenMaintenance(),
    getOverdueRent(),
    getUnreadMessages(),
    listInquiries({ status: 'new' }),
  ]);

  const props   = properties.value  || [];
  const tens    = tenants.value     || [];
  const maint   = maintenance.value || [];
  const overdueR = overdue.value    || [];
  const msgs    = messages.value    || [];
  const inqs    = inquiries.value   || [];

  return {
    properties: { total: props.length },
    tenants:    { total: tens.length, active: tens.filter(t => t.status === 'active').length },
    maintenance: { open: maint.length, highPriority: maint.filter(m => m.priority === 'high').length },
    overdue:    { count: overdueR.length, totalAmount: overdueR.reduce((a, p) => a + (Number(p.amount) || 0), 0) },
    messages:   { unread: msgs.length },
    inquiries:  { new: inqs.length },
    updatedAt:  new Date().toISOString(),
  };
}

/**
 * Analyze rent collection patterns and generate insights.
 */
async function analyzeRentPatterns() {
  const [payments, leases] = await Promise.all([listPayments({ per_page: 200 }), listLeases()]);

  const paid    = payments.filter(p => p.status === 'paid');
  const overdue = payments.filter(p => p.status === 'overdue');
  const pending = payments.filter(p => p.status === 'pending');

  const totalCollected = paid.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const totalOverdue   = overdue.reduce((a, p) => a + (Number(p.amount) || 0), 0);

  return {
    collected:       { count: paid.length, total: totalCollected },
    overdue:         { count: overdue.length, total: totalOverdue },
    pending:         { count: pending.length },
    collectionRate:  paid.length / (paid.length + overdue.length + 0.001) * 100,
    insights: [
      totalOverdue > 0 ? `⚠️ $${totalOverdue.toLocaleString()} overdue across ${overdue.length} payments` : '✅ No overdue rent',
      overdue.length > 0 ? `Late payers: ${overdue.map(p => p.tenant).slice(0, 3).join(', ')}` : null,
    ].filter(Boolean),
  };
}

// ── Status ────────────────────────────────────────────────────────
async function status() {
  const configured = !!(_API_KEY || process.env.TENANTCLOUD_API_KEY || (TC_EMAIL && TC_PASS));
  if (!configured) {
    return { configured: false, hint: 'Add TENANTCLOUD_API_KEY (personal access token) to .env — TenantCloud → Settings → API' };
  }
  try {
    const props = await listProperties();
    return { configured: true, authenticated: true, propertyCount: props.length };
  } catch (err) {
    return { configured: true, authenticated: false, error: err.message, hint: 'Check TENANTCLOUD_API_KEY — it should be your personal access token from TenantCloud → Settings → API' };
  }
}

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

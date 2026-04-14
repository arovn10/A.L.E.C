/**
 * A.L.E.C. Microsoft Graph Service
 *
 * Connects to SharePoint, OneDrive, and Outlook via Microsoft Graph API.
 * Requires Azure AD app registration with delegated permissions.
 *
 * Setup (one-time):
 *   1. Go to portal.azure.com → Azure Active Directory → App Registrations
 *   2. New registration → name: "ALEC Assistant"
 *   3. Add permissions: Files.ReadWrite, Sites.ReadWrite.All, Mail.Read, Calendars.Read
 *   4. Create client secret → copy to .env as MS_CLIENT_SECRET
 *   5. Set MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET in .env
 *
 * Token type: Client Credentials (for app-level access without user interaction)
 * or Authorization Code flow (for delegated access — requires user login once).
 */

require('dotenv').config();

const TENANT_ID     = process.env.MS_TENANT_ID     || null;
const CLIENT_ID     = process.env.MS_CLIENT_ID     || null;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET || null;
const USER_EMAIL    = process.env.MS_USER_EMAIL    || process.env.ALEC_OWNER_EMAIL || null;
const GRAPH_BASE    = 'https://graph.microsoft.com/v1.0';

// ── Token cache ───────────────────────────────────────────────────
let _token = null;
let _tokenExpiry = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token;

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('Microsoft Graph not configured. Add MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET to .env');
  }

  const url = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope:         'https://graph.microsoft.com/.default',
  });

  const resp = await fetch(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!resp.ok) throw new Error(`MS Auth failed: ${resp.status} ${await resp.text()}`);

  const data = await resp.json();
  _token = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in * 1000);
  return _token;
}

async function graphGet(endpoint, params = {}) {
  const token = await getToken();
  const url = new URL(GRAPH_BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Graph API error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function graphPost(endpoint, body) {
  const token = await getToken();
  const resp = await fetch(GRAPH_BASE + endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Graph API POST error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function graphPatch(endpoint, body) {
  const token = await getToken();
  const resp = await fetch(GRAPH_BASE + endpoint, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`Graph API PATCH error: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

// ── OneDrive ──────────────────────────────────────────────────────

/**
 * List files in OneDrive root or a folder.
 */
async function listOneDriveFiles(folderPath = 'root', userEmail = USER_EMAIL) {
  const endpoint = userEmail
    ? `/users/${userEmail}/drive/${folderPath === 'root' ? 'root' : `root:/${folderPath}:`}/children`
    : `/me/drive/${folderPath === 'root' ? 'root' : `root:/${folderPath}:`}/children`;
  const data = await graphGet(endpoint, { $top: '50', $orderby: 'lastModifiedDateTime desc' });
  return (data.value || []).map(f => ({
    id:         f.id,
    name:       f.name,
    type:       f.folder ? 'folder' : 'file',
    size:       f.size,
    modified:   f.lastModifiedDateTime,
    url:        f.webUrl,
    downloadUrl: f['@microsoft.graph.downloadUrl'],
  }));
}

/**
 * Read a file from OneDrive (text files).
 */
async function readOneDriveFile(filePath, userEmail = USER_EMAIL) {
  const endpoint = userEmail
    ? `/users/${userEmail}/drive/root:/${filePath}:/content`
    : `/me/drive/root:/${filePath}:/content`;
  const token = await getToken();
  const resp = await fetch(GRAPH_BASE + endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`OneDrive read error: ${resp.status}`);
  return resp.text();
}

/**
 * Upload/create a file in OneDrive.
 */
async function writeOneDriveFile(filePath, content, userEmail = USER_EMAIL) {
  const endpoint = userEmail
    ? `/users/${userEmail}/drive/root:/${filePath}:/content`
    : `/me/drive/root:/${filePath}:/content`;
  const token = await getToken();
  const resp = await fetch(GRAPH_BASE + endpoint, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: content,
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) throw new Error(`OneDrive write error: ${resp.status}`);
  return resp.json();
}

// ── SharePoint ────────────────────────────────────────────────────

/**
 * Search SharePoint for content.
 */
async function searchSharePoint(query, limit = 10) {
  const data = await graphPost('/search/query', {
    requests: [{
      entityTypes: ['driveItem', 'listItem'],
      query: { queryString: query },
      size: limit,
    }],
  });
  const hits = data.value?.[0]?.hitsContainers?.[0]?.hits || [];
  return hits.map(h => ({
    name:     h.resource?.name || h.resource?.fields?.Title,
    url:      h.resource?.webUrl,
    summary:  h.summary,
    type:     h.resource?.['@odata.type'],
  }));
}

/**
 * List SharePoint sites.
 */
async function listSites(search = null) {
  const params = search ? { search } : {};
  const data = await graphGet('/sites', params);
  return (data.value || []).map(s => ({
    id: s.id, name: s.displayName, url: s.webUrl, description: s.description,
  }));
}

/**
 * List document libraries in a SharePoint site.
 */
async function listSharePointLibraries(siteId) {
  const data = await graphGet(`/sites/${siteId}/drives`);
  return (data.value || []).map(d => ({ id: d.id, name: d.name, url: d.webUrl }));
}

/**
 * List files in a SharePoint library.
 */
async function listSharePointFiles(siteId, driveId, folderPath = 'root') {
  const endpoint = `/sites/${siteId}/drives/${driveId}/${folderPath === 'root' ? 'root' : `root:/${folderPath}:`}/children`;
  const data = await graphGet(endpoint, { $top: '50' });
  return (data.value || []).map(f => ({
    id: f.id, name: f.name, type: f.folder ? 'folder' : 'file', size: f.size, modified: f.lastModifiedDateTime, url: f.webUrl,
  }));
}

// ── Outlook / Email ────────────────────────────────────────────────

/**
 * Get recent emails.
 */
async function getRecentEmails(userEmail = USER_EMAIL, limit = 10) {
  const endpoint = userEmail ? `/users/${userEmail}/messages` : '/me/messages';
  const data = await graphGet(endpoint, {
    $top: String(limit), $orderby: 'receivedDateTime desc',
    $select: 'subject,from,receivedDateTime,bodyPreview,isRead,webLink',
  });
  return (data.value || []).map(m => ({
    id:       m.id,
    subject:  m.subject,
    from:     m.from?.emailAddress?.address,
    received: m.receivedDateTime,
    preview:  m.bodyPreview?.slice(0, 200),
    isRead:   m.isRead,
    url:      m.webLink,
  }));
}

// ── Calendar ──────────────────────────────────────────────────────

/**
 * Get upcoming calendar events.
 */
async function getUpcomingEvents(userEmail = USER_EMAIL, days = 7) {
  const now = new Date().toISOString();
  const end = new Date(Date.now() + days * 86400000).toISOString();
  const endpoint = userEmail ? `/users/${userEmail}/calendar/calendarView` : '/me/calendar/calendarView';
  const data = await graphGet(endpoint, {
    startDateTime: now, endDateTime: end,
    $top: '20', $orderby: 'start/dateTime',
    $select: 'subject,start,end,location,bodyPreview,organizer,webLink',
  });
  return (data.value || []).map(e => ({
    subject:   e.subject,
    start:     e.start?.dateTime,
    end:       e.end?.dateTime,
    location:  e.location?.displayName,
    organizer: e.organizer?.emailAddress?.address,
    preview:   e.bodyPreview?.slice(0, 150),
    url:       e.webLink,
  }));
}

// ── Status ────────────────────────────────────────────────────────
async function status() {
  const configured = !!(TENANT_ID && CLIENT_ID && CLIENT_SECRET);
  if (!configured) {
    return { configured: false, hint: 'Add MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET to .env' };
  }
  try {
    await getToken();
    return { configured: true, authenticated: true, userEmail: USER_EMAIL };
  } catch (err) {
    return { configured: true, authenticated: false, error: err.message };
  }
}

module.exports = {
  listOneDriveFiles, readOneDriveFile, writeOneDriveFile,
  searchSharePoint, listSites, listSharePointLibraries, listSharePointFiles,
  getRecentEmails, getUpcomingEvents,
  status,
};

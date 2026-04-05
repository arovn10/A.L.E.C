/**
 * A.L.E.C. Dashboard — app.js
 * Adaptive Learning Executive Coordinator
 * Vanilla JS — no frameworks required
 */

'use strict';

/* ─── Constants ─────────────────────────────────────────────── */
const API_URL = '';
const TOKEN_KEY = 'alec_token';
const SESSION_KEY = 'alec_session_id';

/* ─── State ──────────────────────────────────────────────────── */
const state = {
  token: null,
  user: null,
  currentPanel: 'chat',
  sessionId: null,
  messages: [],
  pendingAttachments: [],  // { name, fileId, size }
  isWaiting: false,
  intervals: {},
  personality: {
    sass: 0.3,
    initiative: 0.5,
    empathy: 0.7,
    creativity: 0.5,
    precision: 0.8
  }
};

/* ─── Utilities ──────────────────────────────────────────────── */

function generateSessionId() {
  return 'sess_' + Math.random().toString(36).slice(2) + '_' + Date.now();
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleString();
}

function timeAgo(val) {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d)) return val;
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return d.toLocaleDateString();
}

function escapeHtml(str) {
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

/**
 * Simple markdown → HTML converter for chat messages.
 */
function renderMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="lang-${lang || ''}">${code.trim()}</code></pre>`
  );
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
  // Unordered list items
  html = html.replace(/^[*\-] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // Ordered list
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Links
  html = html.replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr/>');
  // Line breaks / paragraphs
  html = html.split(/\n{2,}/).map(block => {
    if (/^<(pre|ul|h[2-4]|hr)/.test(block.trim())) return block;
    return `<p>${block.replace(/\n/g, '<br/>')}</p>`;
  }).join('');

  return html;
}

/* ─── Toast Notifications ────────────────────────────────────── */
function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warning: '⚠️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <span class="toast-icon">${icons[type] || '💬'}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, 4000);
}

/* ─── Confirm Dialog ─────────────────────────────────────────── */
function confirm(title, message) {
  return new Promise(resolve => {
    const dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    dialog.classList.remove('hidden');

    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    function cleanup(result) {
      dialog.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    }

    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

/* ─── API Helper ─────────────────────────────────────────────── */
async function api(method, path, data = null, formData = null) {
  const opts = {
    method,
    headers: {}
  };

  if (state.token) {
    opts.headers['Authorization'] = `Bearer ${state.token}`;
  }

  if (formData) {
    opts.body = formData;
    // Do NOT set Content-Type — browser sets multipart boundary
  } else if (data !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(data);
  }

  const res = await fetch(API_URL + path, opts);

  if (res.status === 401) {
    logout();
    throw new Error('Unauthorized — please log in again.');
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    throw new Error(json.error || json.message || `HTTP ${res.status}`);
  }

  return json;
}

/* ─── Auth ───────────────────────────────────────────────────── */

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem(TOKEN_KEY);
  clearAllIntervals();
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
}

function showDashboard(userData) {
  state.user = userData;
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  // Update sidebar user info
  const email = userData.email || userData.user?.email || '—';
  const rawRole = userData.role || userData.user?.role || userData.access_level || '—';
  // Access level detection
  const accessLevel = userData.access_level || userData.tokenType || rawRole;
  const isOwner = accessLevel === 'OWNER' || email.toLowerCase().includes('campusrentalsllc');
  const isAdmin = isOwner || accessLevel === 'FULL_CAPABILITIES' || rawRole === 'admin';
  const isStoa = accessLevel === 'STOA_ACCESS' || rawRole === 'stoa';
  const displayRole = isOwner ? 'OWNER' : isAdmin ? 'ADMIN' : isStoa ? 'STOA' : 'VIEWER';
  const maskedEmail = email.includes('@') ? email.split('@')[0].slice(0,3) + '***@' + email.split('@')[1] : email;
  document.getElementById('user-email-display').textContent = maskedEmail;
  document.getElementById('user-role-display').textContent = displayRole;
  document.getElementById('user-avatar').textContent = email.slice(0, 2).toUpperCase();
  // Store owner state
  state.isOwner = isOwner;

  // Panel visibility by access level
  state.isAdmin = isAdmin;
  const ownerOnly = ['settings', 'memory'];  // Only owner can see
  const adminPanels = ['metrics', 'files', 'training', 'skills', 'tasks'];  // Admin+
  const stoaPanels = ['stoa'];  // Stoa+ can see
  // Everyone sees: chat

  if (!isOwner) {
    ownerOnly.forEach(p => {
      const el = document.querySelector(`.nav-item[data-panel="${p}"]`);
      if (el) el.style.display = 'none';
    });
  }
  if (!isAdmin) {
    adminPanels.forEach(p => {
      const el = document.querySelector(`.nav-item[data-panel="${p}"]`);
      if (el) el.style.display = 'none';
    });
  }
  if (!isStoa && !isAdmin && !isOwner) {
    stoaPanels.forEach(p => {
      const el = document.querySelector(`.nav-item[data-panel="${p}"]`);
      if (el) el.style.display = 'none';
    });
  }

  // Admin section in settings
  document.getElementById('admin-email').textContent = maskedEmail;
  document.getElementById('admin-role').textContent = displayRole;
  const lastLogin = userData.last_login || userData.user?.last_login;
  document.getElementById('admin-last-login').textContent = lastLogin ? formatDate(lastLogin) : 'Now';

  // Start polling & load initial data
  loadModelInfo();
  loadMetrics();
  startPolling();
  switchPanel('chat');

  // Restore voice state from previous session (persisted per account)
  if (isOwner || isAdmin) {
    setTimeout(() => restoreVoiceState(), 2000);
  }
}

async function login(email, password, isDomoEmbed = false) {
  const deviceId = localStorage.getItem('alec_device_id') || 'dev_' + Date.now();
  localStorage.setItem('alec_device_id', deviceId);
  const body = { email, password, device_id: deviceId };
  if (isDomoEmbed) body.is_domo_embed = true;

  const data = await api('POST', '/api/auth/login', body);

  if (data.token) {
    state.token = data.token;
    localStorage.setItem(TOKEN_KEY, data.token);
    showDashboard(data);
  } else {
    throw new Error(data.error || 'Login failed — no token returned.');
  }
}

async function validateStoredToken(token) {
  try {
    const data = await api('GET', '/api/model/info');
    return true;
  } catch {
    return false;
  }
}

async function initAuth() {
  // Iframe / embed detection (Home Assistant, Domo, etc.)
  const isIframe = window.parent !== window;
  const isDomoParam = new URLSearchParams(window.location.search).get('embed') === 'domo';
  const isHAParam = new URLSearchParams(window.location.search).get('embed') === 'ha';
  const embedUser = new URLSearchParams(window.location.search).get('user');
  const embedToken = new URLSearchParams(window.location.search).get('token');

  // If an embed token is provided in the URL, use it directly
  if (embedToken) {
    state.token = embedToken;
    localStorage.setItem(TOKEN_KEY, embedToken);
    try {
      const payload = JSON.parse(atob(embedToken.split('.')[1]));
      showDashboard({ email: payload.email, role: payload.role, tokenType: payload.tokenType, access_level: payload.tokenType });
      return;
    } catch {}
  }

  if (isDomoParam) {
    try {
      await login('domo@embed.auto', '', true);
      return;
    } catch {}
  }

  // Generate a persistent device ID
  let deviceId = localStorage.getItem('alec_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('alec_device_id', deviceId);
  }

  // Check if this device is trusted (survives server restarts)
  try {
    const resp = await fetch('/api/auth/device/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data.success && data.token) {
        state.token = data.token;
        localStorage.setItem(TOKEN_KEY, data.token);
        showDashboard(data);
        return;
      }
    }
  } catch {} // Device not trusted, fall through

  // Check localStorage token
  const stored = localStorage.getItem(TOKEN_KEY);
  if (stored) {
    state.token = stored;
    const valid = await validateStoredToken(stored);
    if (valid) {
      let userData = { email: 'Loading…', role: 'admin' };
      try {
        const payload = JSON.parse(atob(stored.split('.')[1]));
        userData = { email: payload.email || payload.sub || '—', role: payload.role || 'admin', tokenType: payload.tokenType };
      } catch {}
      showDashboard(userData);
      return;
    }
    localStorage.removeItem(TOKEN_KEY);
    state.token = null;
  }

  // Show login page
  document.getElementById('login-page').classList.remove('hidden');
}

/* ─── Login Form ─────────────────────────────────────────────── */
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btnText = document.getElementById('login-btn-text');
  const btnLoader = document.getElementById('login-btn-loader');
  const btn = document.getElementById('login-btn');

  errEl.classList.add('hidden');
  btnText.textContent = 'Signing in…';
  btnLoader.classList.remove('hidden');
  btn.disabled = true;

  try {
    await login(email, password);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  } finally {
    btnText.textContent = 'Sign In';
    btnLoader.classList.add('hidden');
    btn.disabled = false;
  }
});

document.getElementById('logout-btn').addEventListener('click', logout);

/* ─── Panel Navigation ───────────────────────────────────────── */
const PANEL_TITLES = {
  chat: 'Chat',
  metrics: 'Metrics',
  files: 'Files',
  training: 'Training',
  skills: 'Skills',
  stoa: 'Stoa Data',
  tasks: 'Tasks',
  memory: 'Memory & Knowledge',
  settings: 'Settings'
};

function switchPanel(panelId) {
  // Deactivate all nav items
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  // Hide all panels
  document.querySelectorAll('.panel').forEach(el => el.classList.remove('active'));

  // Activate new
  const navEl = document.querySelector(`.nav-item[data-panel="${panelId}"]`);
  if (navEl) navEl.classList.add('active');

  const panelEl = document.getElementById(`panel-${panelId}`);
  if (panelEl) panelEl.classList.add('active');

  state.currentPanel = panelId;
  document.getElementById('topbar-title').textContent = PANEL_TITLES[panelId] || panelId;

  // Close sidebar on mobile
  closeSidebarMobile();

  // Panel-specific load
  onPanelSwitch(panelId);
}

function onPanelSwitch(panelId) {
  switch (panelId) {
    case 'metrics':  loadMetrics(); break;
    case 'files':    loadFiles(); break;
    case 'training': loadTrainingStatus(); loadAdapters(); break;
    case 'skills':   loadSkills(); break;
    case 'stoa':     loadStoaStatus(); loadStoaTables(); break;
    case 'tasks':    loadTasks(); break;
    case 'settings': loadModelInfo(); buildPersonalitySliders(); break;
  }
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => switchPanel(el.dataset.panel));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchPanel(el.dataset.panel);
    }
  });
});

/* ─── Sidebar Mobile ─────────────────────────────────────────── */
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebar-overlay');
const hamburger = document.getElementById('hamburger-btn');

hamburger.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
});

overlay.addEventListener('click', closeSidebarMobile);

function closeSidebarMobile() {
  sidebar.classList.remove('open');
  overlay.classList.remove('open');
}

/* ─── Polling ────────────────────────────────────────────────── */
function startPolling() {
  // Metrics every 30 seconds
  state.intervals.metrics = setInterval(() => {
    if (state.currentPanel === 'metrics') loadMetrics();
    loadStatusBadges();
  }, 30000);

  // Tasks every 10 seconds
  state.intervals.tasks = setInterval(() => {
    if (state.currentPanel === 'tasks') loadTasks();
  }, 10000);

  // Training every 5 seconds when on training panel
  state.intervals.training = setInterval(() => {
    if (state.currentPanel === 'training') loadTrainingStatus();
    if (state.currentPanel === 'metrics') updateMetricsTrainingSection();
  }, 5000);

  // Initial status load
  loadStatusBadges();
}

function clearAllIntervals() {
  Object.values(state.intervals).forEach(id => clearInterval(id));
  state.intervals = {};
}

/* ─── Status Badges (sidebar) ────────────────────────────────── */
async function loadStatusBadges() {
  try {
    const info = await api('GET', '/api/model/info');
    const loaded = info.loaded || info.model_loaded || false;

    setDot('dot-neural', loaded);
    document.getElementById('status-neural-text').textContent = loaded ? 'On' : 'Off';
    document.getElementById('status-model-name').textContent =
      'A.L.E.C. Neural Engine';
    document.getElementById('topbar-model').textContent =
      'A.L.E.C.';

    setDot('dot-db', true);
    document.getElementById('status-db-text').textContent =
      info.database || info.db_type || 'SQLite';
  } catch {
    // Silently fail — API may not be running
  }

  try {
    const stoa = await api('GET', '/api/stoa/status');
    const connected = stoa.connected || stoa.status === 'connected';
    setDot('dot-stoa', connected);
    document.getElementById('status-stoa-text').textContent = connected ? 'On' : 'Off';
  } catch {
    setDot('dot-stoa', false);
    document.getElementById('status-stoa-text').textContent = 'Off';
  }
}

function setDot(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'dot ' + (on ? 'dot-on' : 'dot-off');
}

/* ─── MODEL INFO ─────────────────────────────────────────────── */
async function loadModelInfo() {
  try {
    const info = await api('GET', '/api/model/info');

    // Settings panel
    document.getElementById('cfg-model-name').textContent = info.model_name || info.name || '—';
    document.getElementById('cfg-backend').textContent = info.backend || info.neural_backend || '—';
    document.getElementById('cfg-ctx-len').textContent = info.context_length || info.n_ctx || '—';
    document.getElementById('cfg-temperature').textContent = info.temperature ?? '—';
    document.getElementById('cfg-top-p').textContent = info.top_p ?? '—';
    document.getElementById('cfg-gpu-layers').textContent = info.n_gpu_layers ?? '—';
    document.getElementById('cfg-tps').textContent =
      info.tokens_per_second ? info.tokens_per_second.toFixed(1) : '—';
    document.getElementById('cfg-loaded').textContent = info.loaded ? 'Yes ✓' : 'No';

    // DB section
    const dbType = info.database || info.db_type || '—';
    document.getElementById('db-type').textContent = dbType;
    const isAzure = dbType.toLowerCase().includes('azure') || dbType.toLowerCase().includes('sql');
    document.getElementById('db-host').textContent = isAzure ? 'stoagroupdb.database.windows.net' : 'local';
    document.getElementById('db-name-val').textContent = isAzure ? 'stoagroupDB' : 'alec.db';
    setDot('db-status-dot', true);
    document.getElementById('db-status-label').textContent = 'Connected';
  } catch {
    // API not running — show placeholders
  }
}

/* ─── METRICS ────────────────────────────────────────────────── */
async function loadMetrics() {
  try {
    const data = await api('GET', '/api/metrics/dashboard');

    // Top stats
    document.getElementById('m-total-convos').textContent =
      (data.conversations?.total ?? data.total_conversations ?? 0).toLocaleString();

    const engineStats = data.engine?.stats || {};
    const tps = engineStats.avg_tokens_per_sec ?? data.tokens_per_second ?? data.engine?.tokens_per_second;
    document.getElementById('m-tokens-sec').textContent =
      tps != null ? Number(tps).toFixed(1) : '—';

    const loadTime = engineStats.model_load_time ?? data.model_load_time ?? data.engine?.load_time_seconds;
    document.getElementById('m-load-time').textContent =
      loadTime != null ? loadTime.toFixed(2) + 's' : '—';

    const convs = data.conversations || {};
    const pos = convs.positive ?? data.positive_ratings ?? 0;
    const neg = convs.negative ?? data.negative_ratings ?? 0;
    const total = convs.total ?? data.total_conversations ?? 0;
    const rated = convs.rated ?? (pos + neg);
    const posPercent = rated > 0 ? Math.round((pos / rated) * 100) : 0;
    document.getElementById('m-pos-rating').textContent = rated > 0 ? posPercent + '%' : '—';

    // Rating bar
    const unrated = total - (pos + neg);
    if (total > 0) {
      document.getElementById('rbar-pos').style.width = ((pos / total) * 100) + '%';
      document.getElementById('rbar-neg').style.width = ((neg / total) * 100) + '%';
      document.getElementById('rbar-none').style.width = ((unrated / total) * 100) + '%';
    }
    document.getElementById('legend-pos').textContent = `Positive: ${pos}`;
    document.getElementById('legend-neg').textContent = `Negative: ${neg}`;
    document.getElementById('legend-none').textContent = `Unrated: ${unrated}`;

    // System status in metrics
    const engine = data.engine || {};
    const loaded = engine.loaded ?? data.neural_engine_loaded;
    setDot('sys-neural-dot', loaded);
    document.getElementById('sys-neural-text').textContent = loaded ? 'Loaded' : 'Not Loaded';

    const stoaConn = data.stoa?.connected ?? data.stoa_connected ?? engine.stoa_connected;
    setDot('sys-stoa-dot', stoaConn);
    document.getElementById('sys-stoa-text').textContent = stoaConn ? 'Yes' : 'No';

    document.getElementById('sys-tasks-text').textContent = data.tasks?.running ?? data.tasks_running ?? '—';
    setDot('sys-db-dot', true);
    document.getElementById('sys-db-text').textContent = data.database || 'SQLite';
    document.getElementById('sys-model-text').textContent =
      (engine.model_name || data.model_name || '—').split('/').pop();
    document.getElementById('sys-updated').textContent = new Date().toLocaleTimeString();

    // Training section — API nests status under data.training.status
    const trainingPayload = data.training?.status ?? data.training;
    updateMetricsTrainingSection(trainingPayload);
  } catch (err) {
    // API offline
  }
}

async function updateMetricsTrainingSection(trainingData) {
  try {
    const data = trainingData || await api('GET', '/api/training/status');
    const isTraining = data.is_training || data.status === 'running';

    const badge = document.getElementById('ms-is-training');
    badge.textContent = isTraining ? 'Training' : 'Idle';
    badge.className = 'badge ' + (isTraining ? 'badge-running' : 'badge-pending');

    document.getElementById('ms-run-id').textContent = data.run_id || '—';

    const step = data.current_step || data.step || 0;
    const total = data.total_steps || data.max_steps || 0;
    document.getElementById('ms-progress-text').textContent = total ? `${step} / ${total}` : '—';

    const bar = document.getElementById('ms-progress-bar');
    if (total > 0) {
      bar.style.display = 'block';
      document.getElementById('ms-progress-fill').style.width = ((step / total) * 100) + '%';
    }

    document.getElementById('ms-loss').textContent = data.current_loss ? data.current_loss.toFixed(4) : '—';
    document.getElementById('ms-best-loss').textContent = data.best_loss ? data.best_loss.toFixed(4) : '—';
  } catch {}
}

document.getElementById('metrics-refresh-btn').addEventListener('click', loadMetrics);

/* ─── FILES ──────────────────────────────────────────────────── */
async function loadFiles() {
  const tbody = document.getElementById('files-tbody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-dim);">Loading…</td></tr>';

  try {
    const data = await api('GET', '/api/files');
    const files = Array.isArray(data) ? data : (data.files || []);

    if (!files.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--text-dim);">No files uploaded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = files.map(f => `
      <tr data-filename="${escapeHtml(f.filename || f.name || '')}">
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${escapeHtml(f.original_name || f.name || '')}">
          ${escapeHtml(f.original_name || f.name || '—')}
        </td>
        <td class="mono">${formatBytes(f.size_bytes || f.size)}</td>
        <td class="mono">${timeAgo(f.created_at || f.uploaded_at)}</td>
        <td><span class="badge ${f.processed ? 'badge-yes' : 'badge-no'}">${f.processed ? 'Yes' : 'No'}</span></td>
        <td class="mono">${f.training_examples ?? '—'}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${!f.processed ? `<button class="btn btn-success btn-sm" onclick="processFile('${escapeHtml(f.filename || f.name || '')}')">Process</button>` : ''}
            <button class="btn btn-danger btn-sm" onclick="deleteFile('${escapeHtml(f.filename || f.name || '')}', '${escapeHtml(f.original_name || f.name || '')}')">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--danger);">Error: ${escapeHtml(err.message)}</td></tr>`;
  }
}

window.processFile = async function(filename) {
  try {
    toast('Processing file for training…', 'info');
    const data = await api('POST', `/api/files/${encodeURIComponent(filename)}/process`);
    toast(`Processed — ${data.training_examples || 0} examples generated.`, 'success');
    loadFiles();
  } catch (err) {
    toast('Process failed: ' + err.message, 'error');
  }
};

window.deleteFile = async function(filename, displayName) {
  const ok = await confirm('Delete File', `Delete "${displayName}"? This cannot be undone.`);
  if (!ok) return;
  try {
    await api('DELETE', `/api/files/${encodeURIComponent(filename)}`);
    toast('File deleted.', 'success');
    loadFiles();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
};

document.getElementById('files-refresh-btn').addEventListener('click', loadFiles);

/* Drop Zone */
const dropZone = document.getElementById('drop-zone');
const fileUploadInput = document.getElementById('file-upload-input');

dropZone.addEventListener('click', () => fileUploadInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

fileUploadInput.addEventListener('change', (e) => {
  if (e.target.files.length) uploadFiles(e.target.files);
  e.target.value = '';
});

async function uploadFiles(files) {
  const progressEl = document.getElementById('upload-progress');
  const labelEl = document.getElementById('upload-progress-label');
  const fillEl = document.getElementById('upload-progress-fill');

  progressEl.classList.remove('hidden');

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    labelEl.textContent = `Uploading ${file.name} (${i + 1}/${files.length})…`;
    fillEl.style.width = ((i / files.length) * 100) + '%';

    try {
      const fd = new FormData();
      fd.append('file', file);
      await api('POST', '/api/files/upload', null, fd);
    } catch (err) {
      toast(`Failed to upload ${file.name}: ${err.message}`, 'error');
    }
  }

  fillEl.style.width = '100%';
  labelEl.textContent = 'Upload complete!';

  setTimeout(() => {
    progressEl.classList.add('hidden');
    fillEl.style.width = '0%';
  }, 1500);

  toast(`${files.length} file(s) uploaded.`, 'success');
  loadFiles();
}

/* ─── TRAINING ───────────────────────────────────────────────── */
async function loadTrainingStatus() {
  try {
    const data = await api('GET', '/api/training/status');
    const isTraining = data.is_training || data.status === 'running';

    const badge = document.getElementById('train-status-badge');
    badge.textContent = isTraining ? 'Training' : 'Idle';
    badge.className = 'badge ' + (isTraining ? 'badge-running' : 'badge-pending');

    document.getElementById('train-run-id').textContent = data.run_id || '—';

    const step = data.current_step || data.step || 0;
    const total = data.total_steps || data.max_steps || 0;
    document.getElementById('train-step').textContent = total ? `${step} / ${total}` : '—';
    document.getElementById('train-loss').textContent = data.current_loss ? data.current_loss.toFixed(4) : '—';
    document.getElementById('train-best-loss').textContent = data.best_loss ? data.best_loss.toFixed(4) : '—';
    document.getElementById('train-dataset-size').textContent = data.dataset_size?.toLocaleString() || '—';

    // ETA
    if (isTraining && total > step && data.seconds_per_step) {
      const remaining = Math.round((total - step) * data.seconds_per_step);
      document.getElementById('train-eta').textContent = `~${Math.ceil(remaining / 60)}m`;
    } else {
      document.getElementById('train-eta').textContent = isTraining ? 'Calculating…' : '—';
    }

    // Progress bar
    const pct = total > 0 ? (step / total) * 100 : 0;
    document.getElementById('train-progress-label').textContent = total ? `Progress: ${step} / ${total} steps (${pct.toFixed(1)}%)` : 'Progress: —';
    document.getElementById('train-progress-fill').style.width = pct + '%';

    // Buttons
    document.getElementById('start-training-btn').disabled = isTraining;
  } catch {}
}

async function loadAdapters() {
  const container = document.getElementById('adapters-list');
  try {
    const data = await api('GET', '/api/training/adapters');
    const adapters = Array.isArray(data) ? data : (data.adapters || []);

    if (!adapters.length) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:0.8rem;">No LoRA adapters found. Train the model to create one.</div>';
      return;
    }

    container.innerHTML = adapters.map(a => `
      <div class="adapter-item">
        <span class="adapter-icon">🔧</span>
        <div class="adapter-info">
          <div class="adapter-name">${escapeHtml(a.name || a.run_id || '—')}</div>
          <div class="adapter-meta">rank: ${a.lora_rank || '—'} · ${timeAgo(a.created_at)}</div>
        </div>
        <span class="badge badge-completed">Saved</span>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:0.8rem;">No adapters loaded.</div>';
  }
}

document.getElementById('adapters-refresh-btn').addEventListener('click', loadAdapters);

document.getElementById('start-training-btn').addEventListener('click', async () => {
  const lr = parseFloat(document.getElementById('train-lr').value) || 2e-4;
  const steps = parseInt(document.getElementById('train-steps').value) || 100;
  const rank = parseInt(document.getElementById('train-lora-rank').value) || 16;

  const ok = await confirm('Start Training', `Start a LoRA training run with ${steps} steps, rank ${rank}, LR ${lr}?`);
  if (!ok) return;

  try {
    toast('Starting training run…', 'info');
    const data = await api('POST', '/api/training/start', {
      learning_rate: lr,
      max_steps: steps,
      lora_rank: rank
    });
    toast('Training started! Run ID: ' + (data.run_id || 'unknown'), 'success');
    loadTrainingStatus();
  } catch (err) {
    toast('Failed to start training: ' + err.message, 'error');
  }
});

document.getElementById('export-training-btn').addEventListener('click', async () => {
  try {
    toast('Exporting training data…', 'info');
    const data = await api('POST', '/api/training/export');
    toast(`Exported ${data.exported_count || data.count || 0} examples.`, 'success');
  } catch (err) {
    toast('Export failed: ' + err.message, 'error');
  }
});

/* ─── SKILLS ─────────────────────────────────────────────────── */
async function loadSkills() {
  await Promise.all([loadInstalledSkills(), loadAvailableSkills()]);
}

async function loadInstalledSkills() {
  const container = document.getElementById('installed-skills-list');
  try {
    const data = await api('GET', '/api/skills/installed');
    const skills = Array.isArray(data) ? data : (data.skills || []);

    if (!skills.length) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:0.8rem;">No skills installed.</div>';
      return;
    }

    container.innerHTML = skills.map(s => {
      const status = s.actual_status || (s.auto_installed ? 'active' : 'needs_setup');
      const hasConfig = s.requires_config || (s.config_fields && s.config_fields.length > 0);
      const colors = { active: '#10b981', connected: '#10b981', needs_setup: '#f59e0b', error: '#ef4444' };
      const labels = { active: 'ACTIVE', connected: 'CONNECTED', needs_setup: 'NEEDS SETUP', error: 'ERROR' };
      const c = colors[status] || '#f59e0b';
      const l = labels[status] || 'NEEDS SETUP';
      return `
        <div class="skill-item">
          <div class="skill-icon">${s.icon || '🔌'}</div>
          <div class="skill-info">
            <div class="skill-name">${escapeHtml(s.name || '—')}</div>
            <div class="skill-desc">${escapeHtml(s.description || '—')}</div>
            ${s.setup_instructions && status === 'needs_setup' ? `<div style="font-size:11px;color:#f59e0b;margin-top:4px;">⚠️ ${escapeHtml(s.setup_instructions)}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;align-items:center;">
            ${hasConfig ? `<button class="btn btn-ghost btn-sm" onclick="openSkillConfig('${s.id}')">⚙️ Configure</button>` : ''}
            <span style="background:${c}20;color:${c};border:1px solid ${c}40;font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;">${l}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:0.8rem;">No skills loaded.</div>';
  }
}

async function loadAvailableSkills() {
  const container = document.getElementById('available-skills-list');
  try {
    const data = await api('GET', '/api/skills/available');
    const skills = Array.isArray(data) ? data : (data.skills || []);
    const notInstalled = skills.filter(s => !s.installed);

    if (!notInstalled.length) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:0.8rem;">All skills installed!</div>';
      return;
    }

    container.innerHTML = notInstalled.map(s => `
      <div class="skill-item">
        <div class="skill-icon">${s.icon || '📦'}</div>
        <div class="skill-info">
          <div class="skill-name">${escapeHtml(s.name || '—')}</div>
          <div class="skill-desc">${escapeHtml(s.description || '—')}</div>
        </div>
        <button class="btn btn-accent btn-sm" onclick="installSkill('${escapeHtml(s.id || '')}')">Install</button>
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:0.8rem;">No available skills listed.</div>';
  }
}

window.installSkill = async function(skillId) {
  try {
    toast(`Installing skill ${skillId}…`, 'info');
    await api('POST', '/api/skills/install', { skill_id: skillId });
    toast('Skill installed!', 'success');
    loadSkills();
  } catch (err) {
    toast('Install failed: ' + err.message, 'error');
  }
};

document.getElementById('skills-refresh-btn').addEventListener('click', loadSkills);

const mcpConnectBtn = document.getElementById('mcp-connect-btn');
if (mcpConnectBtn) {
  mcpConnectBtn.addEventListener('click', async () => {
    const url = document.getElementById('mcp-url-input')?.value?.trim();
    if (!url) { toast('Please enter a server URL.', 'warning'); return; }

    try {
      toast('Connecting to MCP server…', 'info');
      await api('POST', '/api/mcp/connect', { url });
      toast('Connected to MCP server!', 'success');
      const mcpInput = document.getElementById('mcp-url-input');
      if (mcpInput) mcpInput.value = '';
      loadSkills();
    } catch (err) {
      toast('Connection failed: ' + err.message, 'error');
    }
  });
}

/* ─── STOA ───────────────────────────────────────────────────── */
async function loadStoaStatus() {
  try {
    const data = await api('GET', '/api/stoa/status');
    const connected = data.connected || data.status === 'connected';

    const badge = document.getElementById('stoa-status-badge');
    badge.textContent = connected ? 'Connected' : 'Disconnected';
    badge.className = 'badge ' + (connected ? 'badge-connected' : 'badge-disconnected');

    document.getElementById('stoa-db-name').textContent = data.database || data.db_name || '—';
    document.getElementById('stoa-last-sync').textContent = data.last_sync ? timeAgo(data.last_sync) : '—';
    document.getElementById('stoa-training-examples').textContent =
      (data.training_examples || data.examples_generated || 0).toLocaleString();
    document.getElementById('stoa-table-count').textContent = data.table_count ?? '—';
  } catch {}
}

async function loadStoaTables() {
  const container = document.getElementById('stoa-table-list');
  try {
    const data = await api('GET', '/api/stoa/tables');
    const tables = Array.isArray(data) ? data : (data.tables || []);

    if (!tables.length) {
      container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:0.8rem;">No tables found. Check Stoa connection.</div>';
      return;
    }

    container.innerHTML = tables.map(t => {
      const name = typeof t === 'string' ? t : (t.name || t.table_name || JSON.stringify(t));
      return `
        <div class="table-list-item" onclick="selectStoaTable('${escapeHtml(name)}', this)">
          <span>📋</span>
          <span>${escapeHtml(name)}</span>
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:0.8rem;">Could not load tables.</div>';
  }
}

window.selectStoaTable = async function(tableName, el) {
  document.querySelectorAll('.table-list-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('stoa-selected-table').textContent = tableName;

  const preview = document.getElementById('stoa-schema-preview');
  preview.textContent = 'Loading…';

  try {
    const data = await api('POST', '/api/stoa/query', {
      query: `SELECT TOP 5 * FROM ${tableName}`
    });
    if (data.results || data.rows) {
      const rows = data.results || data.rows || [];
      preview.textContent = JSON.stringify(rows, null, 2);
    } else if (data.columns || data.schema) {
      preview.textContent = JSON.stringify(data, null, 2);
    } else {
      preview.textContent = JSON.stringify(data, null, 2);
    }
  } catch (err) {
    preview.textContent = `Error: ${err.message}`;
  }
};

document.getElementById('stoa-sync-btn').addEventListener('click', async () => {
  try {
    toast('Syncing Stoa data…', 'info');
    const data = await api('POST', '/api/stoa/sync');
    toast(`Sync complete! ${data.examples_generated || 0} training examples generated.`, 'success');
    loadStoaStatus();
    loadStoaTables();
  } catch (err) {
    toast('Sync failed: ' + err.message, 'error');
  }
});

document.getElementById('stoa-tables-refresh-btn').addEventListener('click', () => {
  loadStoaStatus();
  loadStoaTables();
});

/* ─── TASKS ──────────────────────────────────────────────────── */
async function loadTasks() {
  const container = document.getElementById('tasks-list');
  try {
    const data = await api('GET', '/api/tasks');
    const tasks = Array.isArray(data) ? data : (data.tasks || []);

    if (!tasks.length) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-dim);font-size:0.8rem;">No background tasks.</div>';
      return;
    }

    container.innerHTML = tasks.map(t => {
      const pct = Math.round((t.progress || 0) * 100);
      const statusClass = {
        running: 'badge-running',
        completed: 'badge-completed',
        failed: 'badge-failed',
        cancelled: 'badge-cancelled',
        pending: 'badge-pending'
      }[t.status] || 'badge-pending';

      return `
        <div style="padding:14px 0;border-bottom:1px solid rgba(51,65,85,0.5);" data-task-id="${escapeHtml(t.task_id || t.id || '')}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div>
              <div style="font-size:0.875rem;font-weight:500;color:var(--text);">${escapeHtml(t.name || 'Unknown Task')}</div>
              <div style="font-size:0.7rem;color:var(--text-dim);font-family:'JetBrains Mono',monospace;margin-top:2px;">${escapeHtml(t.task_id || t.id || '')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="badge ${statusClass}">${t.status || '—'}</span>
              ${t.status === 'running' ? `<button class="btn btn-danger btn-sm" onclick="cancelTask('${escapeHtml(t.task_id || t.id || '')}')">Cancel</button>` : ''}
            </div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${t.status === 'failed' ? 'danger' : t.status === 'completed' ? 'success' : ''}"
                 style="width:${pct}%"></div>
          </div>
          <div style="display:flex;justify-content:space-between;margin-top:6px;">
            <span style="font-size:0.7rem;color:var(--text-dim);">${pct}%</span>
            <span style="font-size:0.7rem;color:var(--text-dim);">${timeAgo(t.created_at)}</span>
          </div>
          ${t.error ? `<div style="font-size:0.75rem;color:var(--danger);margin-top:6px;">Error: ${escapeHtml(t.error)}</div>` : ''}
        </div>
      `;
    }).join('');
  } catch {
    container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-dim);font-size:0.8rem;">Could not load tasks.</div>';
  }
}

window.cancelTask = async function(taskId) {
  try {
    await api('DELETE', `/api/tasks/${encodeURIComponent(taskId)}`);
    toast('Task cancelled.', 'success');
    loadTasks();
  } catch (err) {
    toast('Cancel failed: ' + err.message, 'error');
  }
};

document.getElementById('tasks-refresh-btn').addEventListener('click', loadTasks);

/* ─── SETTINGS ───────────────────────────────────────────────── */
function buildPersonalitySliders() {
  const container = document.getElementById('personality-sliders');
  const traits = [
    { key: 'sass', label: 'Sass', emoji: '😏' },
    { key: 'initiative', label: 'Initiative', emoji: '🚀' },
    { key: 'empathy', label: 'Empathy', emoji: '💙' },
    { key: 'creativity', label: 'Creativity', emoji: '🎨' },
    { key: 'precision', label: 'Precision', emoji: '🎯' }
  ];

  container.innerHTML = traits.map(t => `
    <div class="slider-item">
      <div class="slider-header">
        <span class="slider-label">${t.emoji} ${t.label}</span>
        <span class="slider-value" id="slider-val-${t.key}">${state.personality[t.key].toFixed(2)}</span>
      </div>
      <input type="range" min="0" max="1" step="0.01"
             value="${state.personality[t.key]}"
             id="slider-${t.key}"
             oninput="onSliderChange('${t.key}', this.value)" />
    </div>
  `).join('');
}

window.onSliderChange = function(key, val) {
  state.personality[key] = parseFloat(val);
  const valEl = document.getElementById(`slider-val-${key}`);
  if (valEl) valEl.textContent = parseFloat(val).toFixed(2);
};

document.getElementById('save-personality-btn').addEventListener('click', async () => {
  try {
    await api('POST', '/api/settings/personality', state.personality);
    toast('Personality saved!', 'success');
  } catch (err) {
    // Silently try to store locally if API not available
    localStorage.setItem('alec_personality', JSON.stringify(state.personality));
    toast('Personality saved locally.', 'info');
  }
});

document.getElementById('reset-data-btn').addEventListener('click', async () => {
  const ok = await confirm(
    '⚠️ Reset All Data',
    'This will delete all conversations, training data, and files. This CANNOT be undone. Are you absolutely sure?'
  );
  if (!ok) return;

  // Second confirmation
  const ok2 = await confirm(
    'Final Confirmation',
    'Type: Are you 100% sure? All data will be permanently deleted.'
  );
  if (!ok2) return;

  try {
    await api('POST', '/api/admin/reset');
    toast('All data reset.', 'warning');
    state.messages = [];
    renderWelcome();
  } catch (err) {
    toast('Reset failed: ' + err.message, 'error');
  }
});

/* ─── CHAT ───────────────────────────────────────────────────── */
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  sendBtn.disabled = chatInput.value.trim().length === 0 && state.pendingAttachments.length === 0;
});

// Send on Enter (Shift+Enter = newline)
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// Suggestion chips
document.getElementById('suggestion-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) {
    chatInput.value = chip.dataset.prompt;
    chatInput.dispatchEvent(new Event('input'));
    sendMessage();
  }
});

// File attachment
const attachBtn = document.getElementById('attach-btn');
const fileAttachInput = document.getElementById('file-attach-input');

attachBtn.addEventListener('click', () => fileAttachInput.click());

fileAttachInput.addEventListener('change', async (e) => {
  const files = e.target.files;
  for (const file of files) {
    try {
      toast(`Uploading ${file.name}…`, 'info');
      const fd = new FormData();
      fd.append('file', file);
      const data = await api('POST', '/api/files/upload', null, fd);
      const fileId = data.file_id || data.filename || data.id || file.name;
      state.pendingAttachments.push({ name: file.name, fileId, size: file.size });
      renderAttachmentPreviews();
      sendBtn.disabled = false;
    } catch (err) {
      toast(`Upload failed: ${err.message}`, 'error');
    }
  }
  e.target.value = '';
});

function renderAttachmentPreviews() {
  const container = document.getElementById('attachment-preview');
  container.innerHTML = state.pendingAttachments.map((a, i) => `
    <div class="attachment-chip">
      <span>📎 ${escapeHtml(a.name)}</span>
      <button onclick="removeAttachment(${i})" title="Remove">×</button>
    </div>
  `).join('');
}

window.removeAttachment = function(index) {
  state.pendingAttachments.splice(index, 1);
  renderAttachmentPreviews();
  if (state.pendingAttachments.length === 0 && chatInput.value.trim().length === 0) {
    sendBtn.disabled = true;
  }
};

function renderWelcome() {
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'flex';
}

function hideWelcome() {
  const welcome = document.getElementById('chat-welcome');
  if (welcome) welcome.style.display = 'none';
}

function scrollToBottom() {
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addUserMessage(text) {
  hideWelcome();
  const el = document.createElement('div');
  el.className = 'chat-message user';
  el.innerHTML = `<div class="msg-bubble">${escapeHtml(text)}</div>`;
  chatMessages.appendChild(el);
  scrollToBottom();
}

function addTypingIndicator() {
  const el = document.createElement('div');
  el.className = 'chat-message assistant';
  el.id = 'typing-indicator';
  el.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
  chatMessages.appendChild(el);
  scrollToBottom();
  return el;
}

function removeTypingIndicator() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

function addAssistantMessage(response) {
  const {
    text,
    latency_ms,
    tokens_out,
    tokens_in,
    conversation_id,
    message_id,
    session_id
  } = response;

  const msgId = message_id || conversation_id || Date.now();
  const latSec = latency_ms ? (latency_ms / 1000).toFixed(2) + 's' : null;
  const tokenCount = tokens_out || ((tokens_in || 0) + (tokens_out || 0)) || null;

  const el = document.createElement('div');
  el.className = 'chat-message assistant';
  el.dataset.msgId = msgId;
  el.innerHTML = `
    <div class="msg-bubble">${renderMarkdown(text)}</div>
    <div class="msg-meta">
      ${latSec ? `<span class="msg-badge latency">⚡ ${latSec}</span>` : ''}
      ${tokenCount ? `<span class="msg-badge tokens">🔤 ${tokenCount} tokens</span>` : ''}
      <div class="feedback-btns">
        <button class="feedback-btn" title="Good response" onclick="submitFeedback(${msgId}, 1, this)">👍</button>
        <button class="feedback-btn" title="Bad response" onclick="submitFeedback(${msgId}, -1, this)">👎</button>
      </div>
      ${conversation_id ? `<span class="msg-conv-id">conv:${conversation_id}</span>` : ''}
    </div>
  `;
  chatMessages.appendChild(el);
  scrollToBottom();
}

window.submitFeedback = async function(msgId, rating, btn) {
  try {
    await api('POST', '/api/feedback', {
      conversation_id: msgId,
      rating,
      session_id: state.sessionId
    });
    const container = btn.closest('.feedback-btns');
    container.querySelectorAll('.feedback-btn').forEach(b => {
      b.classList.remove('active-up', 'active-down');
    });
    btn.classList.add(rating === 1 ? 'active-up' : 'active-down');
    toast(rating === 1 ? 'Thanks for the positive feedback!' : 'Feedback recorded.', 'info');
  } catch (err) {
    toast('Could not save feedback: ' + err.message, 'error');
  }
};

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text && state.pendingAttachments.length === 0) return;
  if (state.isWaiting) return;

  // Ensure session
  if (!state.sessionId) {
    state.sessionId = localStorage.getItem(SESSION_KEY) || generateSessionId();
    localStorage.setItem(SESSION_KEY, state.sessionId);
  }

  // Reset input
  const userText = text;
  chatInput.value = '';
  chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  state.isWaiting = true;

  // Show user message
  if (userText) addUserMessage(userText);

  // Clear attachments after display
  const attachments = [...state.pendingAttachments];
  state.pendingAttachments = [];
  renderAttachmentPreviews();

  // Typing indicator
  addTypingIndicator();

  try {
    // Build conversation history for continuity
    if (!state.chatHistory) state.chatHistory = [];
    state.chatHistory.push({ role: 'user', content: userText });
    // Keep last 20 messages for context (10 exchanges)
    if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);

    const body = {
      message: userText,
      messages: state.chatHistory,
      session_id: state.sessionId,
    };
    if (attachments.length) {
      body.file_ids = attachments.map(a => a.fileId);
    }

    const data = await api('POST', '/api/chat', body);

    removeTypingIndicator();
    const responseText = data.response || data.message || data.text || data.content || '(no response)';
    // Store assistant response in history for continuity
    if (!state.chatHistory) state.chatHistory = [];
    state.chatHistory.push({ role: 'assistant', content: responseText });
    if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);
    addAssistantMessage({
      text: responseText,
      latency_ms: data.latency_ms || data.latency,
      tokens_out: data.tokens_out || data.tokens,
      tokens_in: data.tokens_in,
      conversation_id: data.conversationId || data.conversation_id || data.id,
      session_id: data.session_id
    });

    // Speak the response if this was a voice-triggered message
    if (state._voiceTriggered && typeof speakResponse === 'function') {
      speakResponse(responseText);
    }
    state._voiceTriggered = false;
  } catch (err) {
    removeTypingIndicator();
    const el = document.createElement('div');
    el.className = 'chat-message assistant';
    el.innerHTML = `<div class="msg-bubble" style="border-color:rgba(239,68,68,0.4);">
      ⚠️ Error: ${escapeHtml(err.message)}
    </div>`;
    chatMessages.appendChild(el);
    scrollToBottom();
  } finally {
    state.isWaiting = false;
    if (chatInput.value.trim().length > 0) sendBtn.disabled = false;
  }
}

/* ─── INIT ───────────────────────────────────────────────────── */
(async function init() {
  // Load personality from localStorage if saved
  const savedPersonality = localStorage.getItem('alec_personality');
  if (savedPersonality) {
    try {
      Object.assign(state.personality, JSON.parse(savedPersonality));
    } catch {}
  }

  // Start auth flow
  await initAuth();
})();

/* ─── Memory / Teaching Functions ───────────────────────────── */

async function teachMemory() {
  const category = document.getElementById('teach-category').value;
  const key = document.getElementById('teach-key').value.trim();
  const value = document.getElementById('teach-value').value.trim();
  const resultEl = document.getElementById('teach-result');

  if (!key || !value) {
    resultEl.style.color = 'var(--danger-color)';
    resultEl.textContent = 'Please fill in both the label and the knowledge.';
    return;
  }

  try {
    const resp = await api('POST', '/api/memory/teach', {
      method: 'POST',
      body: JSON.stringify({ category, key, value }),
    });
    if (resp.success) {
      resultEl.style.color = 'var(--success-color)';
      resultEl.textContent = `✅ Stored! A.L.E.C. will remember this: [${category}] ${key}`;
      document.getElementById('teach-key').value = '';
      document.getElementById('teach-value').value = '';
      loadMemoryStats();
      loadAllMemories();
    } else {
      resultEl.style.color = 'var(--danger-color)';
      resultEl.textContent = `Error: ${resp.error || 'Unknown error'}`;
    }
  } catch (e) {
    resultEl.style.color = 'var(--danger-color)';
    resultEl.textContent = `Failed: ${e.message}`;
  }
}

async function searchMemory() {
  const query = document.getElementById('memory-search-input').value.trim();
  const resultsEl = document.getElementById('memory-search-results');
  if (!query) return;

  try {
    const data = await api('POST', '/api/memory/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit: 20 }),
    });
    if (data.results && data.results.length > 0) {
      resultsEl.innerHTML = data.results.map(m => `
        <div class="card" style="padding:10px;margin-bottom:6px;font-size:13px;">
          <span class="badge" style="background:var(--primary-color);font-size:11px;">${m.category}</span>
          <strong style="margin-left:6px;">${escapeHtml(m.key)}</strong>
          <p style="margin-top:4px;color:var(--text-secondary);">${escapeHtml(m.value)}</p>
          <small style="color:var(--text-muted);">Referenced ${m.times_referenced || 0} times</small>
        </div>
      `).join('');
    } else {
      resultsEl.innerHTML = '<p style="color:var(--text-muted);">No memories found for that query.</p>';
    }
  } catch (e) {
    resultsEl.innerHTML = `<p style="color:var(--danger-color);">Search failed: ${e.message}</p>`;
  }
}

async function loadMemoryStats() {
  try {
    const data = await api('GET', '/api/memory/stats');
    const el = document.getElementById('memory-stats-content');
    if (!el) return;
    const cats = data.categories || {};
    el.innerHTML = `
      <div class="stats-row" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;">
        <div class="stat-card"><div class="stat-value">${data.total_memories || 0}</div><div class="stat-label">Total Memories</div></div>
        ${Object.entries(cats).map(([k,v]) => `<div class="stat-card"><div class="stat-value">${v}</div><div class="stat-label">${k}</div></div>`).join('')}
      </div>
    `;
  } catch (e) {
    console.warn('Memory stats load failed:', e);
  }
}

async function loadAllMemories() {
  try {
    const data = await api('GET', '/api/memory/all?limit=100');
    const el = document.getElementById('memory-list');
    if (!el) return;
    const memories = data.memories || [];
    if (memories.length === 0) {
      el.innerHTML = '<p style="color:var(--text-muted);padding:12px;">No memories yet. Teach A.L.E.C. something above!</p>';
      return;
    }
    el.innerHTML = memories.map(m => `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--border-color);">
        <div style="flex:1;">
          <span class="badge" style="background:var(--primary-color);font-size:10px;">${m.category}</span>
          <strong style="margin-left:4px;font-size:13px;">${escapeHtml(m.key)}</strong>
          <p style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(m.value).substring(0, 200)}</p>
        </div>
        <button onclick="deleteMemory(${m.id})" style="background:none;border:none;color:var(--danger-color);cursor:pointer;font-size:14px;" title="Delete">🗑️</button>
      </div>
    `).join('');
  } catch (e) {
    console.warn('Memory list load failed:', e);
  }
}

async function deleteMemory(id) {
  if (!confirm('Delete this memory?')) return;
  try {
    await api('DELETE', `/api/memory/${id}`);
    loadAllMemories();
    loadMemoryStats();
  } catch (e) {
    showToast('Failed to delete memory', 'error');
  }
}

// Load memory data when switching to memory panel
const _origOnPanelSwitch = typeof onPanelSwitch === 'function' ? onPanelSwitch : null;
if (_origOnPanelSwitch) {
  const _origFn = onPanelSwitch;
  onPanelSwitch = function(panelId) {
    _origFn(panelId);
    if (panelId === 'memory') {
      loadMemoryStats();
      loadAllMemories();
    }
  };
}

/* ─── User Management Functions ─────────────────────────────── */

async function createUser() {
  const email = document.getElementById('new-user-email').value.trim();
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;
  const resultEl = document.getElementById('create-user-result');

  if (!email || !password) {
    resultEl.style.color = 'var(--danger-color)';
    resultEl.textContent = 'Email and password are required.';
    return;
  }

  try {
    const data = await api('GET', '/api/auth/users/create', {
      method: 'POST',
      body: JSON.stringify({ email, password, role }),
    });
    if (data.success) {
      resultEl.style.color = 'var(--success-color)';
      resultEl.textContent = `✅ Created ${email} as ${role}`;
      document.getElementById('new-user-email').value = '';
      document.getElementById('new-user-password').value = '';
      loadUsers();
    } else {
      resultEl.style.color = 'var(--danger-color)';
      resultEl.textContent = data.error || data.detail || 'Failed';
    }
  } catch (e) {
    resultEl.style.color = 'var(--danger-color)';
    resultEl.textContent = e.message;
  }
}

async function loadUsers() {
  try {
    const data = await api('GET', '/api/auth/users');
    const el = document.getElementById('users-list');
    if (!el) return;
    const users = data.users || [];
    if (users.length === 0) {
      el.innerHTML = '<p style="color:var(--text-muted);">No users found.</p>';
      return;
    }
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;">
      <thead><tr style="border-bottom:1px solid var(--border-color);text-align:left;">
        <th style="padding:6px;">Email</th><th>Role</th><th>Last Login</th><th>Actions</th>
      </tr></thead>
      <tbody>${users.map(u => `
        <tr style="border-bottom:1px solid var(--border-color);">
          <td style="padding:6px;">${escapeHtml(u.email)}</td>
          <td><select onchange="changeRole('${u.email}', this.value)" class="input-field" style="padding:2px 6px;font-size:12px;">
            <option value="viewer" ${u.role==='viewer'?'selected':''}>Viewer</option>
            <option value="editor" ${u.role==='editor'?'selected':''}>Editor</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
          </select></td>
          <td style="font-size:12px;color:var(--text-muted);">${u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}</td>
          <td><button onclick="deleteUser('${u.email}')" style="background:none;border:none;color:var(--danger-color);cursor:pointer;font-size:12px;">Delete</button></td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  } catch (e) {
    const el = document.getElementById('users-list');
    if (el) el.innerHTML = '<p style="color:var(--text-muted);">Could not load users.</p>';
  }
}

async function changeRole(email, newRole) {
  try {
    await api('GET', '/api/auth/users/role', {
      method: 'POST',
      body: JSON.stringify({ email, role: newRole }),
    });
    showToast(`Updated ${email} to ${newRole}`, 'success');
  } catch (e) {
    showToast(`Failed: ${e.message}`, 'error');
    loadUsers();
  }
}

async function deleteUser(email) {
  if (!confirm(`Delete user ${email}? This cannot be undone.`)) return;
  try {
    const data = await api('DELETE', `/api/auth/users/${encodeURIComponent(email)}`);
    if (data.success) {
      showToast(`Deleted ${email}`, 'success');
      loadUsers();
    } else {
      showToast(data.error || data.detail || 'Failed', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

// Load users when settings panel opens
const _origOnPanelSwitch2 = onPanelSwitch;
onPanelSwitch = function(panelId) {
  _origOnPanelSwitch2(panelId);
  if (panelId === 'settings' && state.isOwner) {
    loadUsers();
    document.getElementById('user-management-section').style.display = 'block';
  }
};

// Hide user management for non-owners
if (typeof state !== 'undefined' && !state.isOwner) {
  const umSection = document.getElementById('user-management-section');
  if (umSection) umSection.style.display = 'none';
}

/* ─── Settings Panel: Owner-Only Protection ─────────────────── */
// Override panel switch to block non-owners from settings
const _origSwitchPanel = switchPanel;
switchPanel = function(panelId) {
  if (panelId === 'settings' && !state.isOwner) {
    toast('Settings are only accessible by the owner.', 'error');
    return;
  }
  _origSwitchPanel(panelId);
};

/* ─── Skill Configuration Modal ─────────────────────────────── */

let _currentSkillConfig = null;

window.openSkillConfig = async function(skillId) {
  try {
    const data = await api('GET', '/api/skills/available');
    const skill = (data.skills || []).find(s => s.id === skillId);
    if (!skill) { toast('Skill not found', 'error'); return; }

    _currentSkillConfig = skill;
    const modal = document.getElementById('skill-config-modal');
    document.getElementById('skill-config-title').textContent = `Configure ${skill.name}`;
    document.getElementById('skill-config-instructions').textContent = skill.setup_instructions || '';
    document.getElementById('skill-config-result').textContent = '';

    const fieldsEl = document.getElementById('skill-config-fields');
    const fields = skill.config_fields || [];
    if (fields.length === 0) {
      fieldsEl.innerHTML = '<p style="color:var(--text-muted);">No configuration needed for this skill.</p>';
    } else {
      // Get existing config
      const installed = await api('GET', '/api/skills/installed');
      const existing = (installed.skills || []).find(s => s.id === skillId);
      const existingConfig = existing?.config || {};

      fieldsEl.innerHTML = fields.map(f => {
        const val = existingConfig[f.key] || '';
        if (f.type === 'select') {
          return `<div style="margin-bottom:8px;">
            <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">${f.label}</label>
            <select class="input-field skill-config-input" data-key="${f.key}" style="width:100%;">
              ${(f.options || []).map(o => `<option value="${o}" ${val===o?'selected':''}>${o}</option>`).join('')}
            </select>
          </div>`;
        }
        return `<div style="margin-bottom:8px;">
          <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">${f.label}</label>
          <input type="${f.type || 'text'}" class="input-field skill-config-input" data-key="${f.key}" 
                 placeholder="${f.placeholder || ''}" value="${val}" style="width:100%;">
        </div>`;
      }).join('');
    }

    modal.style.display = 'flex';
    modal.classList.remove('hidden');
  } catch (e) {
    toast('Failed to load skill config: ' + e.message, 'error');
  }
};

window.closeSkillConfig = function() {
  const modal = document.getElementById('skill-config-modal');
  modal.style.display = 'none';
  modal.classList.add('hidden');
  _currentSkillConfig = null;
};

window.saveSkillConfig = async function() {
  if (!_currentSkillConfig) return;
  const config = {};
  document.querySelectorAll('.skill-config-input').forEach(el => {
    const key = el.dataset.key;
    const val = el.value.trim();
    if (key && val) config[key] = val;
  });

  const resultEl = document.getElementById('skill-config-result');
  try {
    // First install if not already
    await api('POST', '/api/skills/install', { skill_id: _currentSkillConfig.id, config });
    // Then configure
    await api('POST', '/api/skills/configure', { skill_id: _currentSkillConfig.id, config });
    resultEl.style.color = 'var(--success-color)';
    resultEl.textContent = '✅ Connected and saved! Credentials are encrypted.';
    loadSkills();
    setTimeout(closeSkillConfig, 1500);
  } catch (e) {
    resultEl.style.color = 'var(--danger-color)';
    resultEl.textContent = 'Failed: ' + e.message;
  }
};

/* ─── Voice Activation ("Hey ALEC") ─────────────────────────── */
/* Persists on/off state per account. Uses browser SpeechRecognition for STT
   and browser speechSynthesis for TTS. Works on desktop Chrome, Android Chrome,
   Safari (partial). Android uses repeated single-shot mode since continuous is
   unreliable on mobile. */

let _voiceRecognition = null;
let _voiceListening = false;
let _voiceCommandMode = false;  // true while capturing a command after wake word
let _voiceSpeaking = false;     // true while TTS is playing
const _isAndroid = /android/i.test(navigator.userAgent);
const _isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

// ── Persistence: remember voice on/off per account ──
function _voiceStorageKey() {
  const email = state.user?.email || 'default';
  return `alec_voice_${email}`;
}
function _saveVoiceState(on) {
  try { localStorage.setItem(_voiceStorageKey(), on ? '1' : '0'); } catch {}
}
function _loadVoiceState() {
  try { return localStorage.getItem(_voiceStorageKey()) === '1'; } catch { return false; }
}

// ── TTS: speak A.L.E.C.'s response out loud ──
function speakResponse(text) {
  if (!window.speechSynthesis) return;
  // Cancel anything currently speaking
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-AU';  // Australian accent per personality directive
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  // Try to find an Australian or British English voice
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => v.lang === 'en-AU')
    || voices.find(v => v.lang === 'en-GB')
    || voices.find(v => v.lang.startsWith('en'));
  if (preferred) utterance.voice = preferred;

  _voiceSpeaking = true;
  utterance.onend = () => {
    _voiceSpeaking = false;
    // Resume wake word listening after speaking
    if (_voiceListening && !_voiceCommandMode) {
      setTimeout(_startWakeWordLoop, 500);
    }
  };
  utterance.onerror = () => { _voiceSpeaking = false; };

  window.speechSynthesis.speak(utterance);
}

// Preload voices (Chrome loads them async)
if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

// ── STT: Wake word detection + command capture ──
function initVoiceActivation() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    console.log('Speech recognition not available in this browser');
    toast('Voice not supported in this browser.', 'warning');
    return false;
  }

  // Request mic permission up front
  if (navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(s => { s.getTracks().forEach(t => t.stop()); })
      .catch(() => {
        toast('Microphone access needed for "Hey ALEC". Check browser permissions.', 'warning');
      });
  }
  return true;
}

function _startWakeWordLoop() {
  if (!_voiceListening || _voiceCommandMode || _voiceSpeaking) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;

  // Stop any prior instance
  if (_voiceRecognition) {
    try { _voiceRecognition.stop(); } catch {}
    _voiceRecognition = null;
  }

  _voiceRecognition = new SR();
  // Android: continuous mode is buggy — use single-shot with restart loop
  _voiceRecognition.continuous = !_isAndroid;
  _voiceRecognition.interimResults = true;
  _voiceRecognition.lang = 'en-US';
  _voiceRecognition.maxAlternatives = 1;

  _voiceRecognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript.toLowerCase().trim();
      if (transcript.includes('hey alec') || transcript.includes('hey a.l.e.c')
          || transcript.includes('hey aleck') || transcript.includes('hey alex')) {
        // Wake word detected!
        _voiceRecognition.stop();
        _startCommandCapture();
        return;
      }
    }
  };

  _voiceRecognition.onend = () => {
    // Restart the loop unless we're in command mode or stopped
    if (_voiceListening && !_voiceCommandMode && !_voiceSpeaking) {
      setTimeout(_startWakeWordLoop, 300);
    }
  };

  _voiceRecognition.onerror = (e) => {
    if (e.error === 'not-allowed') {
      toast('Microphone blocked. Enable it in browser settings.', 'error');
      stopVoiceListening();
      _updateVoiceButton();
      return;
    }
    // For no-speech / aborted / network — just restart the loop
    if (_voiceListening && !_voiceCommandMode) {
      setTimeout(_startWakeWordLoop, 1000);
    }
  };

  try { _voiceRecognition.start(); } catch {}
}

function _startCommandCapture() {
  _voiceCommandMode = true;
  toast('🎤 Listening for your command...', 'info');

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { _voiceCommandMode = false; return; }

  const cmdRecog = new SR();
  cmdRecog.continuous = false;
  cmdRecog.interimResults = false;
  cmdRecog.lang = 'en-US';

  let gotResult = false;

  cmdRecog.onresult = (event) => {
    gotResult = true;
    const command = event.results[0][0].transcript;
    toast(`🎤 "${command}"`, 'info');

    // Set flag so sendMessage knows to speak the response
    state._voiceTriggered = true;

    // Inject into chat and send
    const ci = document.getElementById('chat-input');
    if (ci) {
      ci.value = command;
      ci.dispatchEvent(new Event('input'));
      sendMessage();
    }
  };

  cmdRecog.onend = () => {
    _voiceCommandMode = false;
    if (!gotResult) {
      toast('Didn\'t catch that. Say "Hey ALEC" again.', 'warning');
    }
    // Don't restart wake word here — speakResponse.onend will do it
    // unless no voice response (non-voice-triggered path)
    if (!gotResult && _voiceListening) {
      setTimeout(_startWakeWordLoop, 1000);
    }
  };

  cmdRecog.onerror = () => {
    _voiceCommandMode = false;
    if (_voiceListening) setTimeout(_startWakeWordLoop, 1000);
  };

  try { cmdRecog.start(); } catch {
    _voiceCommandMode = false;
    if (_voiceListening) setTimeout(_startWakeWordLoop, 1000);
  }
}

// ── Public API ──

function startVoiceListening() {
  if (!initVoiceActivation()) return;
  _voiceListening = true;
  _saveVoiceState(true);
  _startWakeWordLoop();
  console.log('🎤 Wake word listening active');
}

function stopVoiceListening() {
  _voiceListening = false;
  _voiceCommandMode = false;
  _saveVoiceState(false);
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (_voiceRecognition) {
    try { _voiceRecognition.stop(); } catch {}
    _voiceRecognition = null;
  }
}

function _updateVoiceButton() {
  const btn = document.getElementById('voice-toggle-btn');
  if (!btn) return;
  if (_voiceListening) {
    btn.textContent = '🎤 On';
    btn.style.color = 'var(--success)';
  } else {
    btn.textContent = '🎤 Off';
    btn.style.color = 'var(--text-muted)';
  }
}

// Restore voice state on login
function restoreVoiceState() {
  if (_loadVoiceState()) {
    startVoiceListening();
  }
  _updateVoiceButton();
}

window.toggleVoiceActivation = function() {
  if (_voiceListening) {
    stopVoiceListening();
    toast('Voice deactivated', 'info');
  } else {
    startVoiceListening();
    toast('Say "Hey ALEC" to activate', 'success');
  }
  _updateVoiceButton();
};

/* ─── Trusted Devices Management ────────────────────────────── */

async function loadTrustedDevices() {
  const el = document.getElementById('trusted-devices-list');
  if (!el) return;
  try {
    const data = await api('GET', '/api/auth/devices');
    const devices = data.devices || [];
    if (!devices.length) {
      el.innerHTML = '<p style="color:var(--text-muted);">No trusted devices.</p>';
      return;
    }
    const currentDeviceId = localStorage.getItem('alec_device_id');
    el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="border-bottom:1px solid var(--border);text-align:left;">
        <th style="padding:6px;">Device</th><th>User</th><th>IP</th><th>Last Seen</th><th></th>
      </tr></thead>
      <tbody>${devices.map(d => {
        const isCurrent = d.device_id === currentDeviceId;
        const name = d.device_name ? (d.device_name.length > 40 ? d.device_name.slice(0, 40) + '…' : d.device_name) : d.device_id.slice(0, 16);
        const lastSeen = d.last_seen ? new Date(d.last_seen).toLocaleString() : '—';
        return `<tr style="border-bottom:1px solid var(--border);">
          <td style="padding:6px;">${escapeHtml(name)} ${isCurrent ? '<span class="badge badge-connected" style="font-size:10px;">This device</span>' : ''}</td>
          <td style="font-size:12px;">${escapeHtml(d.user_email || '—')}</td>
          <td style="font-size:12px;font-family:'JetBrains Mono',monospace;">${escapeHtml(d.ip_address || '—')}</td>
          <td style="font-size:12px;color:var(--text-muted);">${lastSeen}</td>
          <td><button onclick="revokeDevice('${d.device_id}')" style="background:none;border:none;color:var(--danger-color);cursor:pointer;font-size:12px;" ${isCurrent ? 'title="This is your current device"' : ''}>Revoke</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  } catch (e) {
    el.innerHTML = '<p style="color:var(--text-muted);">Could not load devices.</p>';
  }
}

async function revokeDevice(deviceId) {
  const currentDeviceId = localStorage.getItem('alec_device_id');
  const msg = deviceId === currentDeviceId
    ? 'This is YOUR current device. Revoking will log you out. Continue?'
    : 'Revoke this device? It will need to log in again.';
  if (!confirm(msg)) return;
  try {
    await api('DELETE', `/api/auth/device/${encodeURIComponent(deviceId)}`);
    toast('Device revoked', 'success');
    if (deviceId === currentDeviceId) {
      localStorage.clear();
      location.reload();
    } else {
      loadTrustedDevices();
    }
  } catch (e) {
    toast('Failed: ' + e.message, 'error');
  }
}

// Load devices when settings panel opens (extend existing handler)
const _origOnPanelSwitch3 = onPanelSwitch;
onPanelSwitch = function(panelId) {
  _origOnPanelSwitch3(panelId);
  if (panelId === 'settings' && state.isOwner) {
    loadTrustedDevices();
  }
};

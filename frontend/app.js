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
  // Download buttons — /exports/*.xlsx gets a styled download button
  html = html.replace(/\[([^\]]+)\]\((\/exports\/[^\)]+\.xlsx)\)/g,
    (_, label, url) => `<a href="${url}" download class="download-btn">⬇️ ${label}</a>`
  );
  // Absolute links
  html = html.replace(/\[(.+?)\]\((https?:\/\/.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Relative links (non-export)
  html = html.replace(/\[(.+?)\]\((\/[^\)]+)\)/g, '<a href="$2">$1</a>');
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
  // Chat & training get 3 minutes (model can be slow), everything else 30s
  const isLongOp = path.includes('/chat') || path.includes('/training');
  const timeoutMs = isLongOp ? 180000 : 30000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const opts = {
    method,
    headers: {},
    signal: controller.signal,
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

  let res;
  try {
    res = await fetch(API_URL + path, opts);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — the model may still be processing. Try again in a moment.');
    }
    throw err;
  }
  clearTimeout(timer);

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
  const ownerOnly = ['settings', 'memory', 'finance'];  // Only owner can see
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
  finance: 'Finance',
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
    case 'chat':     loadChatHistorySidebar(); break;
    case 'metrics':  loadMetrics(); break;
    case 'files':    loadFiles(); break;
    case 'training': loadTrainingStatus(); loadAdapters(); break;
    case 'skills':   loadSkills(); break;
    case 'stoa':     loadStoaStatus(); loadStoaTables(); break;
    case 'tasks':    loadTasks(); break;
    case 'memory':   loadMemoryStats(); loadAllMemories(); break;
    case 'finance':  loadLinkedAccounts(); loadPortfolio(); break;
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
    const dbType = info.database || info.db_type || 'SQLite';
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
    document.getElementById('ms-best-loss').textContent = (data.best_loss && data.best_loss < 999999) ? data.best_loss.toFixed(4) : 'N/A';
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
    document.getElementById('train-best-loss').textContent = (data.best_loss && data.best_loss < 999999) ? data.best_loss.toFixed(4) : 'N/A';
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

/* ─── CHAT HISTORY SIDEBAR ───────────────────────────────────── */

async function loadChatHistorySidebar() {
  const list = document.getElementById('chat-history-list');
  if (!list) return;
  try {
    const data = await api('GET', '/api/history/conversations');
    const convs = data.conversations || [];
    if (!convs.length) {
      list.innerHTML = '<div style="padding:12px 14px;color:var(--text-dim);font-size:11px;">No chats yet. Start a conversation!</div>';
      return;
    }
    list.innerHTML = convs.map(c => `
      <div class="chat-history-item ${state.currentConversationId === c.id ? 'active' : ''}"
           data-conv-id="${escapeHtml(c.id)}"
           onclick="loadConversation('${escapeHtml(c.id)}')"
           title="${escapeHtml(c.title || 'New Chat')}"
           style="position:relative;padding:8px 12px;cursor:pointer;border-radius:6px;margin:1px 4px;transition:background .15s;${state.currentConversationId === c.id ? 'background:var(--accent-dim,rgba(99,102,241,.15));' : ''}">
        <div style="font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:155px;color:var(--text);">${escapeHtml(c.title || 'New Chat')}</div>
        <div style="font-size:10px;color:var(--text-dim);margin-top:2px;">${timeAgo(c.updated_at)}</div>
        <button onclick="event.stopPropagation();deleteConversation('${escapeHtml(c.id)}')"
          style="position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:14px;padding:2px 4px;border-radius:3px;opacity:0;"
          class="conv-delete-btn" title="Delete chat">×</button>
      </div>`).join('');

    // Show delete on hover
    list.querySelectorAll('.chat-history-item').forEach(el => {
      const btn = el.querySelector('.conv-delete-btn');
      el.addEventListener('mouseenter', () => { if (btn) btn.style.opacity = '1'; });
      el.addEventListener('mouseleave', () => { if (btn) btn.style.opacity = '0'; });
    });
  } catch {
    list.innerHTML = '<div style="padding:12px 14px;color:var(--text-dim);font-size:11px;">History unavailable.</div>';
  }
}

window.loadConversation = async function(convId) {
  try {
    const data = await api('GET', `/api/history/conversations/${convId}/messages`);
    const messages = data.messages || [];
    state.currentConversationId = convId;
    state.chatHistory = messages.map(m => ({ role: m.role, content: m.content }));

    // Render messages
    const chatMsgs = document.getElementById('chat-messages');
    chatMsgs.innerHTML = '';
    document.getElementById('chat-welcome')?.remove();

    messages.forEach(m => {
      if (m.role === 'user') {
        addUserMessage(m.content);
      } else if (m.role === 'assistant') {
        addAssistantMessage(m.content);
      }
    });
    scrollToBottom();
    loadChatHistorySidebar();
  } catch (err) {
    toast('Failed to load conversation: ' + err.message, 'error');
  }
};

window.deleteConversation = async function(convId) {
  if (!confirm('Delete this chat?')) return;
  try {
    await api('DELETE', `/api/history/conversations/${convId}`);
    if (state.currentConversationId === convId) {
      startNewChat();
    }
    loadChatHistorySidebar();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
};

function startNewChat() {
  state.currentConversationId = null;
  state.chatHistory = [];
  const chatMsgs = document.getElementById('chat-messages');
  chatMsgs.innerHTML = '';
  // Re-inject welcome
  const welcome = document.createElement('div');
  welcome.id = 'chat-welcome';
  welcome.className = 'chat-welcome';
  welcome.innerHTML = `
    <div style="font-size:3rem;">🤖</div>
    <h2>Hey, I'm A.L.E.C. — your autonomous AI</h2>
    <p>Adaptive Learning Executive Coordinator — your personal AI, trained on your data and continuously improving.</p>
    <div class="suggestion-chips">
      <div class="chip" data-prompt="How is the STOA portfolio performing?">STOA portfolio</div>
      <div class="chip" data-prompt="Check my recent iMessages">Check iMessages</div>
      <div class="chip" data-prompt="Research Google Ads optimization for apartment rentals">Research Google Ads</div>
      <div class="chip" data-prompt="How is settlers trace performing over the last 6 months?">Settlers Trace trend</div>
    </div>`;
  chatMsgs.appendChild(welcome);
  // Re-attach chip clicks
  welcome.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const p = chip.dataset.prompt;
      if (p) { document.getElementById('chat-input').value = p; sendMessage(); }
    });
  });
  loadChatHistorySidebar();
}

// New Chat button
const newChatBtn = document.getElementById('new-chat-btn');
if (newChatBtn) newChatBtn.addEventListener('click', startNewChat);

// Load chat sidebar on init
setTimeout(loadChatHistorySidebar, 500);

/* ─── SKILLS / CONNECTORS ────────────────────────────────────── */
async function loadSkills() {
  const catalog = document.getElementById('skills-catalog');
  if (!catalog) return;
  catalog.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:0.8rem;">Loading…</div>';

  try {
    const data = await api('GET', '/api/connectors/catalog');
    const byCategory = data.catalog?.byCategory || data.catalog || {};

    if (Object.keys(byCategory).length === 0) {
      catalog.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-dim);font-size:0.8rem;">No connectors available.</div>';
      return;
    }

    const categoryIcons = {
      Communication: '💬', Development: '⚙️', Property: '🏢', Cloud: '☁️',
      Research: '🔬', Automation: '🤖', AI: '🧠', Custom: '🔌'
    };

    let html = '';
    for (const [category, skills] of Object.entries(byCategory)) {
      html += `
        <div style="margin-bottom:28px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);">
            <span style="font-size:1.1rem;">${categoryIcons[category] || '🔌'}</span>
            <span style="font-weight:700;font-size:0.85rem;letter-spacing:.04em;color:var(--text-muted);text-transform:uppercase;">${escapeHtml(category)}</span>
          </div>
          <div style="display:grid;gap:10px;">
            ${skills.map(s => renderSkillCard(s)).join('')}
          </div>
        </div>`;
    }
    catalog.innerHTML = html;
  } catch (err) {
    catalog.innerHTML = `<div style="padding:24px;color:var(--danger-color);font-size:0.8rem;">Failed to load connectors: ${escapeHtml(err.message)}</div>`;
  }
}

function renderSkillCard(s) {
  const configured = s.configured;
  const statusColor = configured ? '#10b981' : '#6b7280';
  const statusLabel = configured ? 'CONNECTED' : 'NOT SET UP';
  const statusBg    = configured ? 'rgba(16,185,129,.12)' : 'rgba(107,114,128,.1)';
  return `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:10px;transition:border-color .2s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="font-size:1.6rem;flex-shrink:0;">${s.icon || '🔌'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.9rem;margin-bottom:2px;">${escapeHtml(s.name)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.4;">${escapeHtml(s.description || '')}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <span style="background:${statusBg};color:${statusColor};border:1px solid ${statusColor}40;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:700;letter-spacing:.04em;">${statusLabel}</span>
        <button class="btn btn-ghost btn-sm" onclick="openSkillConfig('${escapeHtml(s.id)}')" style="font-size:11px;padding:3px 10px;">⚙️ Configure</button>
      </div>
    </div>`;
}

document.getElementById('skills-refresh-btn').addEventListener('click', loadSkills);

// Custom skill button
const addCustomBtn = document.getElementById('add-custom-skill-btn');
if (addCustomBtn) {
  addCustomBtn.addEventListener('click', () => {
    document.getElementById('custom-skill-modal').style.display = 'flex';
  });
}

window.closeCustomSkillModal = function() {
  document.getElementById('custom-skill-modal').style.display = 'none';
};

window.saveCustomSkill = async function() {
  const id    = document.getElementById('cs-id')?.value?.trim();
  const name  = document.getElementById('cs-name')?.value?.trim();
  const icon  = document.getElementById('cs-icon')?.value?.trim() || '🔌';
  const desc  = document.getElementById('cs-desc')?.value?.trim();
  const fields = (document.getElementById('cs-fields')?.value?.trim() || '').split(',').map(f => f.trim()).filter(Boolean);
  if (!id || !name) { toast('ID and Name are required', 'warning'); return; }
  try {
    await api('POST', '/api/connectors/custom', {
      id, name, icon, description: desc,
      fields: fields.map(k => ({ key: k, label: k, type: 'text', envVar: k })),
    });
    toast('Custom skill added!', 'success');
    closeCustomSkillModal();
    loadSkills();
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
};

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

    document.getElementById('stoa-table-count').textContent = tables.length || '—';       if (!tables.length) {
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

window.submitFeedback = async function(msgId, rating, btn, responseText) {
  try {
    await api('POST', '/api/feedback', {
      conversation_id: msgId,
      rating,
      session_id:    state.sessionId,
      response_text: responseText || '',
    });
    const container = btn.closest('.feedback-btns');
    container.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('active-up', 'active-down'));
    btn.classList.add(rating === 1 ? 'active-up' : 'active-down');
    toast(rating === 1 ? 'Thanks! Alec will keep learning from this.' : 'Noted. Alec will improve from this.', 'info');
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

  // Build conversation history for continuity
  if (!state.chatHistory) state.chatHistory = [];
  state.chatHistory.push({ role: 'user', content: userText });
  if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);

  const body = {
    message: userText,
    messages: state.chatHistory,
    session_id: state.sessionId,
    conversation_id: state.currentConversationId || null,
  };
  if (attachments.length) body.file_ids = attachments.map(a => a.fileId);

  try {
    // ── Streaming via SSE ─────────────────────────────────────────
    const streamResp = await fetch('/api/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { 'Authorization': `Bearer ${state.token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });

    if (!streamResp.ok) throw new Error(`Server error ${streamResp.status}`);

    removeTypingIndicator();
    hideWelcome();

    // Create the streaming bubble
    const msgId  = Date.now();
    const msgEl  = document.createElement('div');
    msgEl.className = 'chat-message assistant streaming';
    msgEl.dataset.msgId = String(msgId);

    const bubbleEl = document.createElement('div');
    bubbleEl.className = 'msg-bubble';

    const cursorEl = document.createElement('span');
    cursorEl.className = 'stream-cursor';
    cursorEl.textContent = '▋';
    bubbleEl.appendChild(cursorEl);
    msgEl.appendChild(bubbleEl);
    chatMessages.appendChild(msgEl);
    scrollToBottom();

    // Read SSE stream
    const reader  = streamResp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buf      = '';
    const t0     = Date.now();

    // ── Streaming TTS: speak each sentence as it completes ──────────
    // Accumulates tokens and fires browser TTS the moment a sentence
    // boundary appears — so the first words play in <500ms, not after
    // the entire response finishes.
    let ttsSentenceBuffer = '';
    let ttsActive = state._voiceTriggered;

    function flushTTSSentence(force = false) {
      if (!ttsActive) return;
      // Sentence boundary patterns
      const bound = /(?<=[.!?])\s+(?=[A-Z"'])|(?<=\.)\s*$|\n\n/;
      const parts = ttsSentenceBuffer.split(bound);
      // Flush all complete parts; keep last (potentially incomplete) part
      const toSpeak = force ? parts : parts.slice(0, -1);
      ttsSentenceBuffer = force ? '' : (parts[parts.length - 1] || '');
      toSpeak.forEach(s => {
        const clean = s.trim();
        if (clean.length > 3) _enqueueTTSChunk(clean);
      });
    }

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break outer;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.error) throw new Error(parsed.error);
          // Capture conversation_id from done event so history persists
          if (parsed.done && parsed.conversation_id) {
            state.currentConversationId = parsed.conversation_id;
          }
          if (parsed.token) {
            fullText += parsed.token;
            bubbleEl.innerHTML = renderMarkdown(fullText);
            const cur = document.createElement('span');
            cur.className = 'stream-cursor';
            cur.textContent = '▋';
            bubbleEl.appendChild(cur);
            scrollToBottom();
            // Streaming TTS: buffer and flush on sentence boundaries
            if (ttsActive) {
              ttsSentenceBuffer += parsed.token;
              flushTTSSentence(false);
            }
          }
        } catch (e) { if (e.message && !e.message.includes('JSON')) throw e; }
      }
    }

    // Finalise — remove cursor, render final markdown
    bubbleEl.innerHTML = renderMarkdown(fullText);

    // Build meta row using DOM (avoids innerHTML with dynamic content)
    const metaEl = document.createElement('div');
    metaEl.className = 'msg-meta';

    const latBadge = document.createElement('span');
    latBadge.className = 'msg-badge latency';
    latBadge.textContent = `⚡ ${((Date.now() - t0)/1000).toFixed(1)}s`;

    const srcBadge = document.createElement('span');
    srcBadge.className = 'alec-src-badge alec-src-llm';
    srcBadge.textContent = '⚡ LLaMA 3.1 (local)';

    const fbDiv = document.createElement('div');
    fbDiv.className = 'feedback-btns';

    const thumbUp = document.createElement('button');
    thumbUp.className = 'feedback-btn';
    thumbUp.title = 'Good response';
    thumbUp.textContent = '👍';
    thumbUp.addEventListener('click', () => submitFeedback(msgId, 1, thumbUp, fullText));

    const thumbDn = document.createElement('button');
    thumbDn.className = 'feedback-btn';
    thumbDn.title = 'Bad response';
    thumbDn.textContent = '👎';
    thumbDn.addEventListener('click', () => submitFeedback(msgId, -1, thumbDn, fullText));

    fbDiv.appendChild(thumbUp);
    fbDiv.appendChild(thumbDn);
    metaEl.appendChild(latBadge);
    metaEl.appendChild(srcBadge);
    metaEl.appendChild(fbDiv);
    msgEl.appendChild(metaEl);
    msgEl.classList.remove('streaming');

    // Store in history
    state.chatHistory.push({ role: 'assistant', content: fullText });
    if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);

    // Refresh chat sidebar (conversation was auto-named by server)
    setTimeout(loadChatHistorySidebar, 600);

    // Streaming TTS: flush final partial sentence then let queue drain
    if (ttsActive) {
      flushTTSSentence(true); // force-flush any remaining buffer
      // Resume wake word loop after TTS queue empties
      _ttsQueueOnDrain(() => {
        setTimeout(() => {
          if (typeof _voiceListening !== 'undefined' && _voiceListening && !_voiceSpeaking && !_voiceCommandMode) {
            _startWakeWordLoop();
          }
        }, 800);
      });
    } else if (state._voiceTriggered && typeof speakResponse === 'function') {
      // Fallback: non-streaming TTS for edge cases
      speakResponse(fullText).catch(() => {}).finally(() => {
        setTimeout(() => {
          if (typeof _voiceListening !== 'undefined' && _voiceListening && !_voiceSpeaking && !_voiceCommandMode) {
            _startWakeWordLoop();
          }
        }, 2000);
      });
    }
    state._voiceTriggered = false;

  } catch (err) {
    removeTypingIndicator();
    const errEl = document.createElement('div');
    errEl.className = 'chat-message assistant';
    const errBubble = document.createElement('div');
    errBubble.className = 'msg-bubble';
    errBubble.style.borderColor = 'rgba(239,68,68,0.4)';
    errBubble.textContent = `Error: ${err.message}`;
    errEl.appendChild(errBubble);
    chatMessages.appendChild(errEl);
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
  if ((panelId === 'settings' || panelId === 'finance') && !state.isOwner) {
    toast('This panel is only accessible by the owner.', 'error');
    return;
  }
  _origSwitchPanel(panelId);
};

/* ─── Skill Configuration Modal ─────────────────────────────── */

let _currentSkillConfig = null;

// ── Helper: render a single credential field ──────────────────
function renderCredField(f, isFilled) {
  const ph = isFilled ? '(already set — leave blank to keep)' : (f.placeholder || '');
  const isPass = f.type === 'password';
  return `<div class="cred-field">
    <div class="cred-label">
      ${escapeHtml(f.label)}
      ${f.required ? '<span class="cred-required">*</span>' : ''}
      ${isFilled ? '<span class="cred-set-badge">✓ set</span>' : ''}
    </div>
    <div class="cred-input-wrap">
      <input
        type="${isPass ? 'password' : (f.type || 'text')}"
        class="input-field skill-config-input"
        data-key="${escapeHtml(f.key)}"
        data-env="${escapeHtml(f.envVar || f.key)}"
        placeholder="${escapeHtml(ph)}"
        autocomplete="off"
      >
      ${isPass ? `<button type="button" class="cred-toggle-btn" onclick="togglePwVisibility(this)" title="Show/hide">👁</button>` : ''}
    </div>
    ${f.hint ? `<div class="cred-hint">${escapeHtml(f.hint)}</div>` : ''}
  </div>`;
}

// ── Show/hide password field ──────────────────────────────────
window.togglePwVisibility = function(btn) {
  const input = btn.closest('.cred-input-wrap')?.querySelector('input');
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.textContent = isHidden ? '🙈' : '👁';
};

// ── Show/hide all values via "Reveal credentials" ─────────────
window.revealSkillCredentials = async function(skillId) {
  const btn = document.getElementById('skill-reveal-btn');
  const box = document.getElementById('skill-revealed-box');
  if (!btn || !box) return;

  if (box.style.display === 'block') {
    box.style.display = 'none';
    btn.textContent = '👁 Reveal stored credentials';
    return;
  }

  btn.textContent = '⏳ Loading…';
  btn.disabled = true;
  try {
    const data = await api('POST', `/api/connectors/${skillId}/reveal`);
    const values = data.values || {};
    if (Object.keys(values).length === 0) {
      box.textContent = '(no credentials stored for this skill)';
    } else {
      box.textContent = Object.entries(values).map(([k,v]) => `${k} = ${v}`).join('\n');
    }
    box.style.display = 'block';
    btn.textContent = '🙈 Hide credentials';
  } catch (e) {
    toast('Could not reveal: ' + e.message, 'error');
    btn.textContent = '👁 Reveal stored credentials';
  } finally {
    btn.disabled = false;
  }
};

// ── MS365: open instance config form ─────────────────────────
window.openInstanceForm = async function(skillId, instanceId) {
  const skill = _currentSkillConfig;
  if (!skill) return;
  const fields = skill.instanceFields || skill.fields || [];

  let existingVals = {};
  if (instanceId) {
    try {
      const d = await api('POST', `/api/connectors/${skillId}/instances/${instanceId}/reveal`);
      existingVals = d.values || {};
    } catch {}
  }

  const fieldsEl = document.getElementById('skill-config-fields');
  const existing = instanceId ? (skill._instances || []).find(i => i.id === instanceId) : null;
  const nameVal  = existing?.name || '';

  fieldsEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
      <button class="btn btn-ghost btn-sm" onclick="renderInstanceList('${escapeHtml(skillId)}')">← Back</button>
      <span style="font-weight:700;">${instanceId ? 'Edit Account' : 'Add Microsoft 365 Account'}</span>
    </div>
    <div class="cred-field">
      <div class="cred-label">Account Name <span class="cred-required">*</span></div>
      <div class="cred-input-wrap">
        <input type="text" class="input-field" id="inst-name" placeholder="e.g. STOA Group, CampusRentals…" value="${escapeHtml(nameVal)}">
      </div>
    </div>
    ${fields.map(f => renderCredField(f, !!(existingVals[f.key]))).join('')}
    <button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="saveInstance('${escapeHtml(skillId)}','${instanceId || ''}')">
      ${instanceId ? '💾 Update Account' : '➕ Add Account'}
    </button>`;

  // Pre-fill revealed values
  Object.entries(existingVals).forEach(([k,v]) => {
    const input = fieldsEl.querySelector(`[data-key="${k}"]`);
    if (input && v) { input.value = v; input.type = 'text'; }
  });
};

window.saveInstance = async function(skillId, instanceId) {
  const name = document.getElementById('inst-name')?.value?.trim();
  if (!name) { toast('Account name is required', 'warning'); return; }

  const creds = { name };
  if (instanceId) creds.instId = instanceId;
  document.querySelectorAll('.skill-config-input').forEach(el => {
    const key = el.dataset.env || el.dataset.key;
    const val = el.value.trim();
    if (key && val) creds[key] = val;
  });

  try {
    await api('POST', `/api/connectors/${skillId}/instances`, creds);
    toast(`Account "${name}" saved!`, 'success');
    await renderInstanceList(skillId);
    loadSkills();
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
};

window.deleteInstance = async function(skillId, instanceId, name) {
  if (!confirm(`Remove "${name}"?`)) return;
  try {
    await api('DELETE', `/api/connectors/${skillId}/instances/${instanceId}`);
    toast('Account removed', 'success');
    await renderInstanceList(skillId);
    loadSkills();
  } catch (e) {
    toast('Remove failed: ' + e.message, 'error');
  }
};

async function renderInstanceList(skillId) {
  const fieldsEl = document.getElementById('skill-config-fields');
  let instances = [];
  try {
    const d = await api('GET', `/api/connectors/${skillId}/instances`);
    instances = d.instances || [];
    if (_currentSkillConfig) _currentSkillConfig._instances = instances;
  } catch {}

  const rows = instances.length === 0
    ? `<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:13px;">No accounts yet. Add your first Microsoft 365 connection below.</div>`
    : `<div class="instances-list">${instances.map(inst => `
        <div class="instance-row">
          <div class="instance-row-icon">📎</div>
          <div class="instance-row-name">${escapeHtml(inst.name)}</div>
          <div class="instance-row-status">${Object.values(inst.fields || {}).filter(Boolean).length}/${Object.keys(inst.fields || {}).length} fields set</div>
          <div class="instance-row-btns">
            <button class="instance-action-btn" onclick="openInstanceForm('${escapeHtml(skillId)}','${escapeHtml(inst.id)}')">✏️ Edit</button>
            <button class="instance-action-btn danger" onclick="deleteInstance('${escapeHtml(skillId)}','${escapeHtml(inst.id)}','${escapeHtml(inst.name)}')">🗑</button>
          </div>
        </div>`).join('')}
      </div>`;

  fieldsEl.innerHTML = rows + `
    <button class="add-instance-btn" onclick="openInstanceForm('${escapeHtml(skillId)}','')">
      ➕ Add Microsoft 365 / SharePoint Account
    </button>`;

  // Update save button to not be needed for instances (managed inline)
  const saveBtn = document.getElementById('skill-save-btn');
  if (saveBtn) { saveBtn.style.display = 'none'; }
}

// ── Phone verification helper (for iMessage / Twilio skill) ───
window.sendPhoneVerification = async function() {
  const btn   = document.getElementById('phone-send-code-btn');
  const input = document.getElementById('phone-number-input');
  const status= document.getElementById('phone-verify-status');
  if (!input) return;
  const phone = input.value.trim();
  if (!phone) { toast('Enter a phone number first', 'warning'); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await api('POST', '/api/connectors/sms/send-verification', { phone });
    status.style.color = 'var(--success)';
    status.textContent = `✅ Code sent to ${phone}. Check your messages.`;
    document.getElementById('phone-otp-row')?.style.setProperty('display', 'flex');
  } catch (e) {
    status.style.color = 'var(--danger)';
    status.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Send Code';
  }
};

window.verifyPhoneCode = async function() {
  const phone = document.getElementById('phone-number-input')?.value?.trim();
  const code  = document.getElementById('phone-otp-input')?.value?.trim();
  const status= document.getElementById('phone-verify-status');
  if (!phone || !code) { toast('Enter code first', 'warning'); return; }
  try {
    await api('POST', '/api/connectors/sms/verify', { phone, code });
    status.style.color = 'var(--success)';
    status.textContent = `✅ Phone verified and saved! ALEC will text you at ${phone}.`;
    document.getElementById('phone-otp-row')?.style.setProperty('display', 'none');
    loadSkills();
  } catch (e) {
    status.style.color = 'var(--danger)';
    status.textContent = '❌ ' + e.message;
  }
};

// ── Open skill config modal ───────────────────────────────────
window.openSkillConfig = async function(skillId) {
  try {
    const data       = await api('GET', '/api/connectors/catalog');
    const allSkills  = data.catalog?.skills || Object.values(data.catalog?.byCategory || {}).flat();
    const skill      = allSkills.find(s => s.id === skillId);
    if (!skill) { toast('Skill not found', 'error'); return; }

    _currentSkillConfig = skill;

    // Populate header
    document.getElementById('skill-modal-icon').textContent     = skill.icon || '🔌';
    document.getElementById('skill-modal-title').textContent    = `Configure ${skill.name}`;
    document.getElementById('skill-modal-subtitle').textContent = skill.description || '';
    const badge = document.getElementById('skill-modal-scope-badge');
    if (badge) {
      if (skill.global) {
        badge.textContent = '🌐 Global (server-level)';
        badge.className = 'skill-modal-header-badge global';
      } else {
        badge.textContent = '👤 Per Account';
        badge.className = 'skill-modal-header-badge personal';
      }
    }

    // Reset status / save button
    const resultEl = document.getElementById('skill-config-result');
    if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }
    const saveBtn = document.getElementById('skill-save-btn');
    if (saveBtn) { saveBtn.style.display = ''; saveBtn.disabled = false; saveBtn.textContent = '💾 Save & Connect'; }

    const fieldsEl = document.getElementById('skill-config-fields');

    // ── Multi-instance skill (Microsoft 365) ─────────────────
    if (skill.multiInstance) {
      await renderInstanceList(skillId);
      document.getElementById('skill-config-modal').classList.add('open');
      return;
    }

    // ── Special: iMessage — add phone verification flow ───────
    if (skillId === 'imessage' || skillId === 'twilio') {
      const statusData = await api('GET', `/api/connectors/${skillId}/credentials`).catch(() => ({ fields: {} }));
      const existing   = statusData.fields || {};
      const fields     = skill.fields || [];
      const isPhone    = skillId === 'imessage';

      fieldsEl.innerHTML = fields.map(f => renderCredField(f, existing[f.key] === true)).join('') +
        (isPhone ? `
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
            <div class="cred-label">📱 Verify Your Phone Number</div>
            <p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Enter your number, then tap Send Code. ALEC will text you a 6-digit code to confirm.</p>
            <div class="phone-verify-row">
              <input type="tel" id="phone-number-input" class="input-field" placeholder="+15551234567" value="${process?.env?.OWNER_PHONE || ''}">
              <button class="send-code-btn" id="phone-send-code-btn" onclick="sendPhoneVerification()">Send Code</button>
            </div>
            <div class="otp-verify-row" id="phone-otp-row" style="display:none;">
              <input type="text" id="phone-otp-input" class="input-field" placeholder="6-digit code" style="letter-spacing:4px;font-size:18px;text-align:center;" maxlength="6">
              <button class="verify-btn" onclick="verifyPhoneCode()">✓ Verify</button>
            </div>
            <div class="verify-status" id="phone-verify-status"></div>
          </div>` : '');
    } else {
      // ── Standard credential fields ────────────────────────
      const statusData = await api('GET', `/api/connectors/${skillId}/credentials`).catch(() => ({ fields: {} }));
      const existing   = statusData.fields || {};
      const fields     = skill.fields || [];

      if (fields.length === 0) {
        fieldsEl.innerHTML = `<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px 0;">
          This connector works out-of-the-box — no credentials needed.</p>`;
        if (saveBtn) saveBtn.style.display = 'none';
      } else {
        fieldsEl.innerHTML = fields.map(f => renderCredField(f, existing[f.key] === true)).join('');
      }
    }

    // Add "Reveal credentials" button at bottom (for all non-empty skills)
    if ((skill.fields || []).length > 0) {
      fieldsEl.innerHTML += `
        <button id="skill-reveal-btn" class="cred-reveal-btn" onclick="revealSkillCredentials('${escapeHtml(skillId)}')">
          👁 Reveal stored credentials
        </button>
        <div id="skill-revealed-box" class="cred-revealed-box" style="display:none;"></div>`;
    }

    document.getElementById('skill-config-modal').classList.add('open');
  } catch (e) {
    toast('Failed to load skill config: ' + e.message, 'error');
    console.error('[openSkillConfig]', e);
  }
};

window.closeSkillConfig = function() {
  document.getElementById('skill-config-modal').classList.remove('open');
  _currentSkillConfig = null;
};

// Close on overlay click
document.getElementById('skill-config-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeSkillConfig();
});

window.saveSkillConfig = async function() {
  if (!_currentSkillConfig) return;
  const skillId = _currentSkillConfig.id;

  const credentials = {};
  document.querySelectorAll('.skill-config-input').forEach(el => {
    const key = el.dataset.env || el.dataset.key;
    const val = el.value.trim();
    if (key && val) credentials[key] = val;
  });

  const resultEl = document.getElementById('skill-config-result');
  const saveBtn  = document.getElementById('skill-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = '⏳ Saving…';

  try {
    await api('POST', `/api/connectors/${skillId}/credentials`, credentials);

    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.color   = 'var(--text-muted)';
      resultEl.textContent   = 'Saved. Testing connection…';
    }

    // Live connection test
    try {
      const statusData = await api('GET', `/api/connectors/${skillId}/status`);
      const ok = !!(statusData.connected || statusData.authenticated || statusData.configured || statusData.available);
      if (resultEl) {
        resultEl.style.color   = ok ? 'var(--success)' : 'var(--warning)';
        resultEl.textContent   = ok
          ? `✅ Connected and verified! Ready to use in chat.`
          : `⚠️ Saved, but couldn't confirm connection: ${statusData.error || 'check credentials and try again'}`;
      }
    } catch { /* status check is optional */ }

    loadSkills();
    setTimeout(closeSkillConfig, 3000);
  } catch (e) {
    if (resultEl) {
      resultEl.style.display = 'block';
      resultEl.style.color   = 'var(--danger)';
      resultEl.textContent   = '❌ Save failed: ' + e.message;
    }
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '💾 Save & Connect';
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
let _wakeDetected = false;      // set when wake word heard, cleared after command start
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
// Active audio element for stopping playback
let _ttsAudio = null;

// ── Streaming TTS chunk queue ──────────────────────────────────────
// Sentences arrive one by one as the LLM streams. We queue them and
// play them back-to-back using SpeechSynthesisUtterance so there's
// no gap between sentences.
const _ttsChunkQueue   = [];
let   _ttsDrainCbs     = [];
let   _ttsChunkPlaying = false;

function _enqueueTTSChunk(text) {
  if (!text || !text.trim()) return;
  _ttsChunkQueue.push(text.trim());
  if (!_ttsChunkPlaying) _playNextTTSChunk();
}

function _playNextTTSChunk() {
  if (!_ttsChunkQueue.length) {
    _ttsChunkPlaying = false;
    _ttsDrainCbs.forEach(cb => cb());
    _ttsDrainCbs = [];
    return;
  }
  _ttsChunkPlaying = true;
  _voiceSpeaking   = true;
  const text = _ttsChunkQueue.shift();

  // Prefer browser speechSynthesis for low latency (no server round-trip)
  if (window.speechSynthesis) {
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'en-AU';
    utt.rate = 1.05;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === 'en-AU')
      || voices.find(v => v.lang === 'en-GB')
      || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utt.voice = preferred;
    utt.onend   = () => _playNextTTSChunk();
    utt.onerror = () => _playNextTTSChunk();
    window.speechSynthesis.speak(utt);
  } else {
    _ttsChunkPlaying = false;
    _playNextTTSChunk();
  }
}

function _ttsQueueOnDrain(cb) {
  if (!_ttsChunkPlaying && !_ttsChunkQueue.length) {
    cb(); // already drained
  } else {
    _ttsDrainCbs.push(cb);
  }
}

async function speakResponse(text) {
  // Server-side TTS via edge-tts (works in iframes, HA panels, everywhere)
  // Falls back to browser speechSynthesis if server TTS fails
  _voiceSpeaking = true;

  // Stop any current playback
  if (_ttsAudio) {
    _ttsAudio.pause();
    _ttsAudio = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();

  const _resumeLoop = () => {
    _voiceSpeaking = false;
    if (_voiceListening && !_voiceCommandMode) {
      setTimeout(_startWakeWordLoop, 500);
    }
  };

  // Safety timeout
  const safetyTimeout = setTimeout(() => {
    if (_voiceSpeaking) _resumeLoop();
  }, Math.max(8000, text.length * 100));

  try {
    // Server-side TTS via edge-tts (Australian male voice, works in iframes)
    const audioResp = await fetch('/api/tts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`,
      },
      body: JSON.stringify({ text }),
    });

    if (audioResp.ok) {
      const blob = await audioResp.blob();
      const url = URL.createObjectURL(blob);
      _ttsAudio = new Audio(url);
      _ttsAudio.onended = () => {
        clearTimeout(safetyTimeout);
        URL.revokeObjectURL(url);
        _ttsAudio = null;
        _resumeLoop();
      };
      _ttsAudio.onerror = () => {
        clearTimeout(safetyTimeout);
        _ttsAudio = null;
        _resumeLoop();
      };
      await _ttsAudio.play();
      return;
    }
  } catch {
    // Server TTS failed, fall through to browser TTS
  }

  // Fallback: browser speechSynthesis
  if (window.speechSynthesis) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-AU';
    utterance.rate = 1.0;
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => v.lang === 'en-AU')
      || voices.find(v => v.lang === 'en-GB')
      || voices.find(v => v.lang.startsWith('en'));
    if (preferred) utterance.voice = preferred;
    utterance.onend = () => { clearTimeout(safetyTimeout); _resumeLoop(); };
    utterance.onerror = () => { clearTimeout(safetyTimeout); _resumeLoop(); };
    window.speechSynthesis.speak(utterance);
  } else {
    clearTimeout(safetyTimeout);
    _resumeLoop();
  }
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
          || transcript.includes('hey aleck') || transcript.includes('hey alex')
          || (transcript.includes('alec') && transcript.length < 12)) {
        // Wake word detected — set flag, stop loop; onend will start command capture
        _wakeDetected = true;
        try { _voiceRecognition.stop(); } catch {}
        return;
      }
    }
  };

  _voiceRecognition.onend = () => {
    if (!_voiceListening || _voiceSpeaking) return;
    if (_voiceCommandMode) return; // already captured, don't restart loop
    // Check if wake word was the last thing heard (onresult set _wakeDetected)
    if (_wakeDetected) {
      _wakeDetected = false;
      // Mic is now fully released — safe to start command capture
      setTimeout(_startCommandCapture, 200);
    } else {
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

function _startCommandCapture(attempt) {
  attempt = attempt || 1;
  _voiceCommandMode = true;

  // Update neuron state if voice-integration.js is loaded
  if (typeof setState === 'function') setState('listening');
  toast('🎤 Go ahead…', 'info');

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { _voiceCommandMode = false; return; }

  const cmdRecog = new SR();
  cmdRecog.continuous = false;
  cmdRecog.interimResults = true;   // show interim so user knows it's listening
  cmdRecog.lang = 'en-US';
  cmdRecog.maxAlternatives = 1;

  let gotResult = false;

  cmdRecog.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        gotResult = true;
        const command = event.results[i][0].transcript.trim();
        if (!command) break;
        toast(`🎤 "${command}"`, 'info');

        // Drive neuron to thinking
        if (typeof setState === 'function') setState('thinking');

        // Set flag so sendMessage fires TTS
        state._voiceTriggered = true;

        const ci = document.getElementById('chat-input');
        if (ci) {
          ci.value = command;
          ci.dispatchEvent(new Event('input'));
          sendMessage();
        }
      }
    }
  };

  cmdRecog.onend = () => {
    _voiceCommandMode = false;
    if (!gotResult) {
      if (attempt < 2) {
        // Retry once automatically — user may have paused
        setTimeout(() => _startCommandCapture(attempt + 1), 300);
      } else {
        toast('Didn\'t catch that — say "Hey ALEC" to try again.', 'warning');
        if (typeof setState === 'function') setState('idle');
        if (_voiceListening) setTimeout(_startWakeWordLoop, 800);
      }
    } else {
      // Got command — resume wake word after response (with 20s safety fallback)
      if (typeof setState === 'function') setState('idle');
      setTimeout(() => {
        if (_voiceListening && !_voiceSpeaking && !_voiceCommandMode) {
          _startWakeWordLoop();
        }
      }, 20000);
    }
  };

  cmdRecog.onerror = (e) => {
    _voiceCommandMode = false;
    if (e.error === 'no-speech' && attempt < 2) {
      setTimeout(() => _startCommandCapture(attempt + 1), 300);
    } else {
      if (typeof setState === 'function') setState('idle');
      if (_voiceListening) setTimeout(_startWakeWordLoop, 800);
    }
  };

  try { cmdRecog.start(); } catch {
    _voiceCommandMode = false;
    if (_voiceListening) setTimeout(_startWakeWordLoop, 800);
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

/* ─── Finance Panel: Plaid Brokerage Integration ─────────────── */

async function linkBrokerageAccount() {
  const btn = document.getElementById('link-brokerage-btn');
  if (btn) btn.disabled = true;
  try {
    const data = await api('POST', '/api/plaid/create-link-token');
    if (!data || !data.link_token) {
      toast('Failed to create Plaid link token', 'error');
      return;
    }

    const handler = Plaid.create({
      token: data.link_token,
      onSuccess: async (publicToken, metadata) => {
        try {
          await api('POST', '/api/plaid/exchange-token', {
            public_token: publicToken,
            institution: metadata.institution || {},
          });
          toast('Account linked successfully!', 'success');
          loadLinkedAccounts();
          loadPortfolio();
        } catch (e) {
          toast('Failed to link account: ' + e.message, 'error');
        }
      },
      onExit: (err) => {
        if (err) {
          toast('Plaid Link closed: ' + (err.display_message || err.error_message || 'User exited'), 'error');
        }
      },
    });
    handler.open();
  } catch (e) {
    toast('Failed to start Plaid Link: ' + e.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function loadLinkedAccounts() {
  const el = document.getElementById('linked-accounts-list');
  if (!el) return;
  try {
    const accounts = await api('GET', '/api/plaid/accounts');
    if (!accounts || accounts.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-dim);font-size:0.85rem;">No accounts linked yet.</div>';
      return;
    }
    el.innerHTML = accounts.map(a => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--border);font-size:0.9rem;">
        <div>
          <strong>${a.institution_name || 'Unknown'}</strong>
          <span style="color:var(--text-dim);margin-left:8px;font-size:0.8rem;">Linked ${new Date(a.linked_at).toLocaleDateString()}</span>
        </div>
        <button class="btn btn-danger" style="font-size:0.75rem;padding:4px 10px;" onclick="unlinkAccount('${a.item_id}')">Unlink</button>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-dim);">Failed to load accounts.</div>';
  }
}

async function loadPortfolio() {
  const totalEl = document.getElementById('portfolio-total');
  const gridEl = document.getElementById('portfolio-accounts-grid');
  if (!totalEl || !gridEl) return;

  try {
    const data = await api('GET', '/api/plaid/holdings');
    if (!data || !data.accounts || data.accounts.length === 0) {
      totalEl.textContent = '—';
      gridEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-dim);font-size:0.85rem;">Link an account to see your portfolio.</div>';
      return;
    }

    totalEl.textContent = '$' + data.total_value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Build security lookup
    const secMap = {};
    for (const s of (data.securities || [])) {
      secMap[s.security_id] = s;
    }

    gridEl.innerHTML = data.accounts.map(acct => {
      const bal = acct.balances?.current || 0;
      const acctHoldings = (data.holdings || [])
        .filter(h => h.account_id === acct.account_id)
        .sort((a, b) => (b.institution_value || 0) - (a.institution_value || 0))
        .slice(0, 5);

      const holdingsHtml = acctHoldings.map(h => {
        const sec = secMap[h.security_id] || {};
        const ticker = sec.ticker_symbol || '???';
        const name = sec.name || '';
        const val = h.institution_value || 0;
        const qty = h.quantity || 0;
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:0.8rem;border-bottom:1px solid var(--border-light);">
          <span><strong>${ticker}</strong> <span style="color:var(--text-dim)">${name.slice(0, 25)}</span></span>
          <span>${qty.toFixed(2)} @ $${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>`;
      }).join('');

      return `<div class="card" style="margin-bottom:0;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong>${acct.institution_name || 'Account'}</strong>
          <span style="font-size:1.1rem;font-weight:600;color:var(--accent);">$${bal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
        </div>
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:6px;">${acct.name || acct.official_name || ''} — ${acct.subtype || acct.type || ''}</div>
        ${holdingsHtml || '<div style="font-size:0.8rem;color:var(--text-dim);">No holdings data</div>'}
      </div>`;
    }).join('');
  } catch (e) {
    totalEl.textContent = '—';
    gridEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-dim);">Failed to load portfolio.</div>';
  }
}

async function unlinkAccount(itemId) {
  if (!confirm('Unlink this brokerage account? You can always re-link it later.')) return;
  try {
    await api('DELETE', `/api/plaid/accounts/${encodeURIComponent(itemId)}`);
    toast('Account unlinked', 'success');
    loadLinkedAccounts();
    loadPortfolio();
  } catch (e) {
    toast('Failed to unlink: ' + e.message, 'error');
  }
}

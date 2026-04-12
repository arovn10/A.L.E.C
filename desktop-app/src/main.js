/**
 * A.L.E.C. Desktop App — Electron main process
 *
 * Lives in the macOS dock. Manages the ALEC Node.js server as a
 * child process with start / stop / restart controls and live log
 * streaming.  Also shows a menu-bar status icon for quick access.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain } = require('electron');
const { spawn, execFile } = require('child_process');
const path  = require('path');
const http  = require('http');

// ── Config ───────────────────────────────────────────────────────
const ALEC_ROOT   = path.join(__dirname, '..', '..'); // repo root
const SERVER_FILE = path.join(ALEC_ROOT, 'backend', 'server.js');
const ALEC_URL    = 'http://localhost:3001';
const CHECK_INTERVAL_MS = 3000;

// ── State ────────────────────────────────────────────────────────
let serverProcess = null;
let mainWindow    = null;
let tray          = null;
let statusTimer   = null;
let logBuffer     = [];
const MAX_LOG_LINES = 500;

// ── Prevent second instance ──────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
});

// ── Keep dock app alive even with all windows closed ─────────────
app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});

// ── App ready ────────────────────────────────────────────────────
app.whenReady().then(() => {
  createTray();
  createWindow();
  startStatusPolling();
  setTimeout(() => startServer(), 1500);
});

app.on('before-quit', () => {
  stopServer();
});

// ── Tray icon ─────────────────────────────────────────────────────
function createTray() {
  tray = new Tray(nativeImage.createFromDataURL(trayIconDataUrl('#6b7280')));
  tray.setToolTip('A.L.E.C.');
  updateTrayMenu('stopped');
  tray.on('click', () => {
    mainWindow ? mainWindow.show() : createWindow();
  });
}

function updateTrayMenu(status) {
  const statusLabel = { running: '🟢 Running', stopped: '🔴 Stopped', starting: '🟡 Starting…', error: '🔴 Error' }[status] || '⚪ Unknown';
  const menu = Menu.buildFromTemplate([
    { label: `A.L.E.C.  ${statusLabel}`, enabled: false },
    { type: 'separator' },
    { label: 'Open Dashboard',  click: () => { mainWindow ? mainWindow.show() : createWindow(); } },
    { label: 'Open in Browser', click: () => shell.openExternal(ALEC_URL) },
    { type: 'separator' },
    { label: 'Start',   click: () => startServer(),   enabled: status !== 'running' && status !== 'starting' },
    { label: 'Stop',    click: () => stopServer(),    enabled: status === 'running' },
    { label: 'Restart', click: () => restartServer(), enabled: status === 'running' },
    { type: 'separator' },
    { label: 'Quit A.L.E.C.', click: () => { stopServer(); setTimeout(() => app.exit(0), 1000); } },
  ]);
  tray.setContextMenu(menu);
  const dotColor = { running: '#10b981', starting: '#f59e0b', stopped: '#ef4444', error: '#ef4444' }[status] || '#6b7280';
  tray.setImage(nativeImage.createFromDataURL(trayIconDataUrl(dotColor)));
}

// ── Main window ───────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 680,
    minWidth: 680,
    minHeight: 500,
    title: 'A.L.E.C. Control Center',
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.on('did-finish-load', () => {
    if (logBuffer.length) mainWindow.webContents.send('log-batch', logBuffer);
  });
}

// ── Server management ─────────────────────────────────────────────
function startServer() {
  if (serverProcess) return;
  pushLog('info', '▶ Starting A.L.E.C. server…');
  sendStatus('starting');

  serverProcess = spawn(process.execPath, [SERVER_FILE], {
    cwd: ALEC_ROOT,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach(l => pushLog('info', l))
  );
  serverProcess.stderr.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach(l => pushLog('error', l))
  );
  serverProcess.on('exit', (code) => {
    pushLog('warn', `⚠ Server exited (code ${code})`);
    serverProcess = null;
    sendStatus('stopped');
    updateTrayMenu('stopped');
  });
  serverProcess.on('error', (err) => {
    pushLog('error', `✖ ${err.message}`);
    serverProcess = null;
    sendStatus('error');
    updateTrayMenu('error');
  });
}

function stopServer() {
  if (!serverProcess) return;
  pushLog('info', '⏹ Stopping A.L.E.C. server…');
  serverProcess.kill('SIGTERM');
  setTimeout(() => { if (serverProcess) serverProcess.kill('SIGKILL'); }, 3000);
}

function restartServer() {
  pushLog('info', '🔄 Restarting…');
  stopServer();
  setTimeout(() => startServer(), 2000);
}

// ── Status polling ────────────────────────────────────────────────
function startStatusPolling() {
  statusTimer = setInterval(async () => {
    const alive = serverProcess && !serverProcess.killed;
    if (!alive) { sendStatus('stopped'); updateTrayMenu('stopped'); return; }
    try {
      const data = await httpGet(`${ALEC_URL}/api/health`);
      sendStatus('running');
      updateTrayMenu('running');
      if (mainWindow) mainWindow.webContents.send('health', data);
    } catch {
      sendStatus('starting');
      updateTrayMenu('starting');
    }
  }, CHECK_INTERVAL_MS);
}

function sendStatus(s) {
  if (mainWindow) mainWindow.webContents.send('status', s);
}

// ── IPC handlers ──────────────────────────────────────────────────
ipcMain.handle('server:start',   () => startServer());
ipcMain.handle('server:stop',    () => stopServer());
ipcMain.handle('server:restart', () => restartServer());
ipcMain.handle('open:browser',   () => shell.openExternal(ALEC_URL));
ipcMain.handle('server:status',  () => serverProcess ? 'running' : 'stopped');
ipcMain.handle('app:version',    () => app.getVersion());

ipcMain.handle('server:update', () => new Promise((resolve) => {
  stopServer();
  setTimeout(() => {
    // Use execFile for safety — no shell injection possible
    execFile('git', ['pull', '--ff-only'], { cwd: ALEC_ROOT }, (err, stdout, stderr) => {
      const msg = err ? (stderr || err.message) : stdout.trim();
      if (!err) {
        pushLog('info', '✅ Update: ' + msg);
        setTimeout(() => startServer(), 500);
      } else {
        pushLog('error', '✖ Update failed: ' + msg);
      }
      resolve({ success: !err, message: msg });
    });
  }, 2000);
}));

ipcMain.handle('model:list', async () => {
  try {
    const { listModels } = require(path.join(ALEC_ROOT, 'services', 'llamaEngine.js'));
    return listModels();
  } catch {
    return [];
  }
});

// ── Log helpers ───────────────────────────────────────────────────
function pushLog(level, text) {
  const entry = { level, text, ts: new Date().toLocaleTimeString() };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  if (mainWindow) mainWindow.webContents.send('log', entry);
}

// ── HTTP helper ───────────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', d => (body += d));
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch { resolve({}); } });
    }).on('error', reject);
  });
}

// ── Tray icon (SVG → data URL) ────────────────────────────────────
function trayIconDataUrl(dotColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
    <rect x="2" y="2" width="18" height="18" rx="5" fill="#1e293b"/>
    <text x="11" y="16.5" text-anchor="middle" font-size="13" font-family="SF Pro Display,Helvetica Neue,Arial" font-weight="800" fill="#06b6d4">A</text>
    <circle cx="17" cy="5" r="3.5" fill="${dotColor}"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

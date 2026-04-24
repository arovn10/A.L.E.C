/**
 * A.L.E.C. Desktop App — Electron main process
 *
 * Lives in the macOS dock. Manages the ALEC Node.js server as a
 * child process with start / stop / restart controls and live log
 * streaming.  Also shows a menu-bar status icon for quick access.
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, safeStorage, dialog } = require('electron');
const { spawn, execFile } = require('child_process');
const path  = require('path');
const http  = require('http');
const https = require('https');
const os    = require('os');
const fs    = require('fs');

// ── electron-updater (lazy-required so `npm start` in dev still runs if
//    the package isn't installed yet). Provides real .dmg/.zip auto-update
//    against GitHub Releases (configured under `build.publish` in package.json).
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
} catch (e) {
  // Dev mode without the dep: `server:update` falls back to a "not available" reply.
  console.warn('[updater] electron-updater not installed:', e.message);
}

// ── Config ───────────────────────────────────────────────────────
// In dev:  <repo>/desktop-app/src/main.js  →  repo root is ../../
// Packaged: resources/alec/ holds the repo files (see extraResources in package.json)
const ALEC_ROOT   = app.isPackaged
  ? path.join(process.resourcesPath, 'alec')
  : path.join(__dirname, '..', '..');
const SERVER_FILE = path.join(ALEC_ROOT, 'backend', 'server.js');
const ALEC_URL    = 'http://localhost:3001';
const CHECK_INTERVAL_MS = 3000;

// ── State ────────────────────────────────────────────────────────
let serverProcess = null;
let mainWindow    = null;
let tray          = null;
let statusTimer   = null;
let logBuffer     = [];
const MAX_LOG_LINES = 5000;

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

// ── Sprint-1 encrypted bundle-secrets loader ─────────────────────
// Runs BEFORE the backend spawn so server.js inherits the decrypted
// credentials via process.env. Silently no-ops in dev (no packed dir).
try {
  const { applyToEnv } = require('./secrets-loader');
  const packedRoot = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'build');
  const n = applyToEnv(packedRoot, { override: false });
  if (n > 0) console.log(`[secrets] injected ${n} encrypted env keys`);
} catch (e) {
  console.warn('[secrets] loader failed:', e.message);
}

// ── App ready ────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildAppMenu();
  createTray();
  createWindow();
  startStatusPolling();
  setTimeout(() => startServer(), 1500);
  // Neural engine is a hard dependency for ALEC — auto-start it here and
  // keep it alive with a supervised watchdog. Venv auto-creation runs
  // inside the neural:start handler on first launch.
  startNeuralSupervised();
});

let _neuralSupervising = false;
async function startNeuralSupervised() {
  if (_neuralSupervising) return;
  _neuralSupervising = true;
  const invokeStart = async () => {
    const handler = ipcMain._invokeHandlers?.get('neural:start');
    if (typeof handler === 'function') {
      try { return await handler(); } catch (e) { return { success: false, error: e.message }; }
    }
    return { success: false, error: 'neural:start IPC handler missing' };
  };
  // Kick off the first boot after backend has had a moment.
  setTimeout(async () => {
    pushLog('info', '🧠 Neural engine auto-start (always-on)…');
    await invokeStart();
  }, 4000);
  // Watchdog: every 30s, if :8000 isn't answering /health, relaunch.
  setInterval(async () => {
    try {
      await httpGet('http://localhost:8000/health');
    } catch {
      pushLog('warn', '🧠 Neural engine unreachable — restarting…');
      await invokeStart();
    }
  }, 30_000);
}

// ── Application menu (keyboard-controllable from anywhere) ────────
function buildAppMenu() {
  const template = [
    {
      label: 'ALEC',
      submenu: [
        { label: 'About ALEC', role: 'about' },
        { type: 'separator' },
        { label: 'Start Backend',   accelerator: 'CmdOrCtrl+Shift+S', click: () => startServer() },
        { label: 'Stop Backend',    accelerator: 'CmdOrCtrl+Shift+X', click: () => stopServer() },
        { label: 'Restart Backend', accelerator: 'CmdOrCtrl+Shift+R', click: () => restartServer() },
        { type: 'separator' },
        { label: 'Open in Browser', accelerator: 'CmdOrCtrl+B', click: () => shell.openExternal(ALEC_URL) },
        { label: 'Show/Hide Logs',  accelerator: 'CmdOrCtrl+L', click: () => mainWindow && mainWindow.webContents.send('toggle:drawer') },
        { label: 'Reload UI',       accelerator: 'CmdOrCtrl+R', click: () => mainWindow && mainWindow.webContents.send('reload:spa') },
        { type: 'separator' },
        { label: 'Hide ALEC',       accelerator: 'Command+H', role: 'hide' },
        { label: 'Quit ALEC',       accelerator: 'Command+Q', click: () => { stopServer(); setTimeout(() => app.exit(0), 800); } },
      ],
    },
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ]},
    { label: 'View', submenu: [
      { label: 'Copy All Logs', accelerator: 'CmdOrCtrl+Shift+C', click: () => mainWindow && mainWindow.webContents.send('logs:copy') },
      { label: 'Clear Logs',    accelerator: 'CmdOrCtrl+K',      click: () => { logBuffer = []; if (mainWindow) mainWindow.webContents.send('logs:clear'); } },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { role: 'toggleDevTools' },
    ]},
    { label: 'Window', role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true; // suppress auto-respawn while the app shuts down
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
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'A.L.E.C. Control Center',
    backgroundColor: '#0f172a',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      webviewTag:       true, // enables <webview> to embed the SPA
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
// Track whether the backend on :3001 is "ours" (spawned child) or
// "external" (launchd / homebrew / another terminal). If it's external
// we don't try to stop it on Quit, and Restart kills it via lsof.
let serverExternal = false;

// True only when the user explicitly asked to stop (Stop menu, Quit,
// Restart) — lets the exit handler distinguish a user-initiated stop
// from an unexpected crash/signal so we can auto-respawn in the latter.
let stopRequested = false;

// Exponential-backoff guard so a genuine crash loop doesn't hammer
// the CPU. Resets to 0 on each successful boot (>30s uptime).
let respawnAttempts = 0;
let lastRespawnAt = 0;

async function startServer() {
  if (serverProcess) return;

  // If :3001 already responds, adopt it — no need to spawn a second
  // backend that would fail with EADDRINUSE. Use a lenient check: ANY
  // HTTP response (including 302 /api/health→/health) means the port
  // is owned by a live ALEC backend. Only a connection refusal means
  // the port is free.
  try {
    await new Promise((resolve, reject) => {
      const req = http.get(`${ALEC_URL}/health`, (res) => {
        res.resume(); // drain
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.setTimeout(1500, () => { req.destroy(new Error('timeout')); });
    });
    serverExternal = true;
    pushLog('info', '🔗 Attached to existing backend on :3001 (external process).');
    sendStatus('running');
    updateTrayMenu('running');
    return;
  } catch { /* port free → spawn */ }

  pushLog('info', '▶ Starting A.L.E.C. server…');
  sendStatus('starting');

  // In a packaged app, process.execPath is the Electron binary. Without
  // ELECTRON_RUN_AS_NODE=1 it would launch a new Electron UI instance
  // instead of executing server.js as plain Node. In dev it's already
  // the node binary, but the flag is harmless there.
  // Load user settings (model choice, etc.) from userData so we don't
  // write to a potentially-read-only bundled .env.
  const userSettings = (typeof readUserSettings === 'function') ? readUserSettings() : {};

  // llama uses Metal on macOS — prior macOS-26 teardown crashes are now
  // mitigated in llamaEngine.js (wrapped init + graceful shutdown hooks).
  const llamaSafety = {};

  serverProcess = spawn(process.execPath, [SERVER_FILE], {
    cwd: ALEC_ROOT,
    env: {
      ...process.env,
      ...userSettings,             // e.g. ALEC_MODEL_PATH
      ...llamaSafety,              // ALEC_DISABLE_LLAMA on macOS 26+
      ELECTRON_RUN_AS_NODE: '1',
      FORCE_COLOR: '0',
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverExternal = false;

  serverProcess.stdout.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach(l => pushLog('info', l))
  );
  serverProcess.stderr.on('data', (d) =>
    d.toString().split('\n').filter(Boolean).forEach(l => pushLog('error', l))
  );
  const spawnedAt = Date.now();
  serverProcess.on('exit', (code) => {
    pushLog('warn', `⚠ Server exited (code ${code})`);
    const uptimeMs = Date.now() - spawnedAt;
    serverProcess = null;
    sendStatus('stopped');
    updateTrayMenu('stopped');

    // Auto-respawn on unexpected exit. Without this a single stray
    // SIGTERM (seen in the wild when neural auto-start races with the
    // llama loader) leaves the backend permanently dead until the user
    // restarts the Electron shell.
    if (stopRequested || isQuitting) {
      stopRequested = false; // consume for the next cycle
      return;
    }
    // Reset attempt counter after a long, healthy run.
    if (uptimeMs > 30_000) respawnAttempts = 0;
    respawnAttempts += 1;
    if (respawnAttempts > 5) {
      pushLog('error', `✖ Backend respawn aborted — ${respawnAttempts} failures. Use menu → Start Backend to try again.`);
      respawnAttempts = 0;
      return;
    }
    // 1s, 2s, 4s, 8s, 16s (capped)
    const delayMs = Math.min(1000 * 2 ** (respawnAttempts - 1), 16_000);
    pushLog('info', `🔁 Auto-respawning backend in ${Math.round(delayMs/1000)}s (attempt ${respawnAttempts}/5)…`);
    lastRespawnAt = Date.now();
    setTimeout(() => { startServer(); }, delayMs);
  });
  serverProcess.on('error', (err) => {
    pushLog('error', `✖ ${err.message}`);
    serverProcess = null;
    sendStatus('error');
    updateTrayMenu('error');
  });
}

function stopServer() {
  if (serverExternal) {
    // We didn't spawn this one — force-kill whoever owns :3001.
    pushLog('info', '⏹ Killing external backend on :3001…');
    execFile('bash', ['-c', 'kill $(lsof -ti:3001) 2>/dev/null; kill $(lsof -ti:3002) 2>/dev/null; true'], () => {
      serverExternal = false;
      sendStatus('stopped');
      updateTrayMenu('stopped');
    });
    return;
  }
  if (!serverProcess) return;
  pushLog('info', '⏹ Stopping A.L.E.C. server…');
  stopRequested = true; // suppress auto-respawn in the exit handler
  serverProcess.kill('SIGTERM');
  setTimeout(() => { if (serverProcess) serverProcess.kill('SIGKILL'); }, 3000);
}

function restartServer() {
  pushLog('info', '🔄 Restarting…');
  stopRequested = true; // suppress auto-respawn; we restart explicitly below
  // Make sure no stray listener will cause EADDRINUSE when we come back up.
  execFile('bash', ['-c', 'kill $(lsof -ti:3001) 2>/dev/null; kill $(lsof -ti:3002) 2>/dev/null; true'], () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      setTimeout(() => { if (serverProcess) serverProcess.kill('SIGKILL'); }, 2500);
    }
    serverExternal = false;
    setTimeout(() => startServer(), 2500);
  });
}

// ── Status polling ────────────────────────────────────────────────
function startStatusPolling() {
  statusTimer = setInterval(async () => {
    // Three-state liveness: owned-child, adopted-external, or nothing.
    // Before this fix the poll only knew about owned-child, so when we
    // adopted an external backend (launchd/homebrew) `serverProcess` was
    // null forever and every tick fired 'stopped' — making the UI flap
    // between 'running' (set once at adoption) and 'stopped' (set by
    // every subsequent poll). Now we treat external adoption as alive
    // and let the HTTP probe be the authority for external health.
    const ownedAlive = serverProcess && !serverProcess.killed;
    if (!ownedAlive && !serverExternal) {
      sendStatus('stopped'); updateTrayMenu('stopped'); return;
    }
    try {
      const data = await httpGet(`${ALEC_URL}/api/health`);
      sendStatus('running');
      updateTrayMenu('running');
      if (mainWindow) mainWindow.webContents.send('health', data);
    } catch {
      // External backend briefly unreachable → it may have been killed
      // out from under us (e.g. launchd respawn window). Drop the
      // external flag so next poll cycle will re-probe & re-adopt.
      if (serverExternal && !ownedAlive) {
        serverExternal = false;
        sendStatus('stopped'); updateTrayMenu('stopped');
        // Opportunistic re-adopt on next tick via startServer's HTTP check.
        setTimeout(() => startServer().catch(() => {}), 1000);
        return;
      }
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

// ── S7.6 Desktop Control bridge ─────────────────────────────────────
// Native macOS permission probes + Electron approval modal.
// Renderer cannot reach these directly (contextIsolation); always via IPC.
const { execFile: _execFileDC } = require('child_process');

function _nativeProbe(id) {
  return new Promise((resolve) => {
    const cb = (err) => resolve(err ? 0 : 1);
    if (id === 'accessibility') {
      _execFileDC('osascript', ['-e',
        'tell application "System Events" to return UI elements enabled'
      ], (err, stdout) => resolve(!err && String(stdout).trim().toLowerCase() === 'true' ? 1 : 0));
    } else if (id === 'screen_recording') {
      _execFileDC('screencapture', ['-x', '-t', 'png', '/tmp/alec-probe.png'], cb);
    } else if (id === 'automation') {
      _execFileDC('osascript', ['-e',
        'tell application "Finder" to return name'
      ], cb);
    } else {
      resolve(0);
    }
  });
}

ipcMain.handle('desktop:probe', async () => {
  const [accessibility, screen_recording, automation] = await Promise.all([
    _nativeProbe('accessibility'),
    _nativeProbe('screen_recording'),
    _nativeProbe('automation'),
  ]);
  return { accessibility, screen_recording, automation };
});

// 15-second default-deny approval modal.
ipcMain.handle('desktop:approve-modal', async (_e, payload = {}) => {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 420, height: 220, resizable: false, frame: false, alwaysOnTop: true,
      parent: mainWindow || undefined, modal: true,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    let settled = false;
    const decide = (approved) => {
      if (settled) return;
      settled = true;
      try { win.close(); } catch {}
      resolve({ approved, reason: approved ? 'user' : 'denied' });
    };
    const primitive = String(payload.primitive || '');
    let argsPreview = '{}';
    try { argsPreview = JSON.stringify(payload.args || {}).slice(0, 200); } catch {}
    const html = `
      <html><body style="font-family:-apple-system;padding:20px;">
        <h3 style="margin:0 0 8px 0;">ALEC wants to run <code>${primitive}</code></h3>
        <pre style="background:#f6f8fa;padding:8px;border-radius:4px;max-height:80px;overflow:auto;">${argsPreview}</pre>
        <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="ipc.send('desktop:approve-result', false)">Deny</button>
          <button onclick="ipc.send('desktop:approve-result', true)" style="background:#2da44e;color:#fff;border:none;padding:6px 12px;border-radius:4px;">Allow</button>
        </div>
        <script>const ipc = require('electron').ipcRenderer;</script>
      </body></html>`;
    ipcMain.once('desktop:approve-result', (_evt, v) => decide(!!v));
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    setTimeout(() => decide(false), 15_000);
  });
});

// ── Sprint 3: Secure token storage (macOS Keychain via safeStorage) ─
// Renderer-side localStorage was fine for access tokens (short-lived JWTs),
// but refresh tokens survive for weeks and deserve Keychain-backing. This
// handler exposes get/set/delete to the renderer via IPC. We store files under
// app.getPath('userData') encrypted with Electron's safeStorage. Lazy-resolve
// userData at call-time so module-load order with app.whenReady stays safe.
function tokenDir() {
  try { return path.join(app.getPath('userData'), 'secrets'); }
  catch { return path.join(os.homedir(), '.alec-secrets'); }
}
function tokenFile(key) {
  // Whitelist keys to prevent path traversal.
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(String(key))) throw new Error('Invalid key');
  return path.join(tokenDir(), `${key}.bin`);
}
function ensureTokenDir() {
  try { fs.mkdirSync(tokenDir(), { recursive: true, mode: 0o700 }); } catch (_) { /* exists */ }
}
ipcMain.handle('token:set', async (_e, { key, value }) => {
  if (!key || typeof value !== 'string') return { ok: false, error: 'key and value required' };
  ensureTokenDir();
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'Keychain encryption unavailable on this machine' };
  }
  const enc = safeStorage.encryptString(value);
  fs.writeFileSync(tokenFile(key), enc, { mode: 0o600 });
  return { ok: true };
});
ipcMain.handle('token:get', async (_e, { key }) => {
  try {
    const f = tokenFile(key);
    if (!fs.existsSync(f)) return { ok: true, value: null };
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Keychain unavailable' };
    const buf = fs.readFileSync(f);
    return { ok: true, value: safeStorage.decryptString(buf) };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('token:delete', async (_e, { key }) => {
  try {
    const f = tokenFile(key);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

// Update: `git pull --ff-only` only makes sense when ALEC_ROOT is a live git
// checkout (dev mode). In the packaged bundle, ALEC_ROOT is a read-only
// copy inside the .app and is NOT a git repo — hitting Update there would
// fail with "fatal: not a git repository" AND leave the backend stopped
// because stopServer() already fired. Fix: in packaged mode, skip the git
// pull entirely, keep the backend running, and surface a clear message.
// Update strategy:
//   • Dev (ALEC_ROOT is a git repo)  → `git pull --ff-only` in place.
//   • Packaged install               → pull the developer worktree, then rsync
//     the updated backend/ services/ scripts/ .env over the bundled copy so
//     the running app picks up the changes after a backend restart. The dev
//     worktree lives at ~/Desktop/App Development/A.L.E.C by default; override
//     with ALEC_DEV_ROOT env or the alec-settings.json `devRoot` key.
function resolveDevRoot() {
  try {
    const s = readUserSettings() || {};
    if (s.devRoot && fs.existsSync(path.join(s.devRoot, '.git'))) return s.devRoot;
  } catch {}
  if (process.env.ALEC_DEV_ROOT && fs.existsSync(path.join(process.env.ALEC_DEV_ROOT, '.git'))) {
    return process.env.ALEC_DEV_ROOT;
  }
  const home = app.getPath('home');
  const candidates = [
    path.join(home, 'Desktop', 'App Development', 'A.L.E.C'),
    path.join(home, 'A.L.E.C'),
    path.join(home, 'src', 'A.L.E.C'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, '.git'))) return c;
  }
  return null;
}

// ── Update the whole .app ───────────────────────────────────────────
// Priority order:
//   1. Packaged build + electron-updater available → check GitHub Releases,
//      download a signed/unsigned .dmg, quitAndInstall. THIS IS THE NORMAL PATH.
//   2. Dev mode inside a git repo → `git pull --ff-only` in place.
//   3. Packaged but electron-updater missing AND a dev worktree is configured
//      (legacy escape hatch) → rsync the dev worktree into the bundle.
// Everything else reports a clear reason rather than silently "failing".
ipcMain.handle('server:update', () => new Promise((resolve) => {
  const isDev = !app.isPackaged;
  const gitDir = path.join(ALEC_ROOT, '.git');
  const isGitRepo = fs.existsSync(gitDir);

  // (1) Packaged → electron-updater path.
  if (!isDev && autoUpdater) {
    pushLog('info', '🔄 Checking GitHub Releases for a newer ALEC build…');

    // Fresh listeners each click so we don't stack handlers.
    autoUpdater.removeAllListeners('update-available');
    autoUpdater.removeAllListeners('update-not-available');
    autoUpdater.removeAllListeners('download-progress');
    autoUpdater.removeAllListeners('update-downloaded');
    autoUpdater.removeAllListeners('error');

    autoUpdater.on('update-available', (info) =>
      pushLog('info', `🔄 Update ${info?.version || ''} available — downloading…`));
    autoUpdater.on('update-not-available', (info) => {
      const msg = `You're on the latest version (${info?.version || app.getVersion()}).`;
      pushLog('info', '✅ ' + msg);
      resolve({ success: true, updated: false, message: msg });
    });
    autoUpdater.on('download-progress', (p) => {
      if (p && typeof p.percent === 'number') {
        pushLog('info', `🔄 Downloading update: ${p.percent.toFixed(0)}%`);
      }
    });
    autoUpdater.on('update-downloaded', (info) => {
      const v = info?.version || '';
      pushLog('info', `✅ Update ${v} downloaded. Relaunching…`);
      resolve({ success: true, updated: true, message: `Update ${v} downloaded.` });
      setTimeout(() => {
        try { stopServer(); } catch {}
        try {
          autoUpdater.quitAndInstall(true /* isSilent */, true /* forceRunAfter */);
        } catch (e) {
          pushLog('error', '✖ quitAndInstall threw: ' + e.message);
        }
      }, 750);
    });
    autoUpdater.on('error', (err) => {
      const msg = (err && err.message) ? err.message : String(err);
      pushLog('error', '✖ Update failed: ' + msg);
      resolve({ success: false, message: msg });
    });

    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      pushLog('error', '✖ Update check threw: ' + err.message);
      resolve({ success: false, message: err.message });
    }
    return;
  }

  // (2) Dev mode in a git checkout.
  if (isDev && isGitRepo) {
    stopServer();
    setTimeout(() => {
      execFile('git', ['pull', '--ff-only'], { cwd: ALEC_ROOT }, (err, stdout, stderr) => {
        const msg = err ? (stderr || err.message) : stdout.trim();
        pushLog(err ? 'error' : 'info', (err ? '✖ Update failed: ' : '✅ Update: ') + msg);
        setTimeout(() => startServer(), 500);
        resolve({ success: !err, message: msg });
      });
    }, 2000);
    return;
  }

  // (3) Legacy fallback: packaged but no updater → rsync from a dev worktree.
  const devRoot = resolveDevRoot();
  if (!devRoot) {
    const msg = 'Auto-update unavailable and no dev worktree configured. Install electron-updater in the desktop-app package or set ALEC_DEV_ROOT.';
    pushLog('warn', 'ℹ Update skipped: ' + msg);
    return resolve({ success: false, packaged: true, message: msg });
  }

  pushLog('info', `↻ Legacy update path: pulling ${devRoot}`);
  execFile('git', ['pull', '--ff-only'], { cwd: devRoot }, (pullErr, pullOut, pullErrStr) => {
    if (pullErr) {
      const msg = pullErrStr || pullErr.message;
      pushLog('error', '✖ git pull failed: ' + msg);
      return resolve({ success: false, message: msg });
    }
    pushLog('info', '✓ git pull: ' + (pullOut.trim() || 'already up to date'));

    stopServer();
    const syncTargets = ['backend', 'services', 'scripts', '.env'];
    const existing = syncTargets.filter(t => fs.existsSync(path.join(devRoot, t)));
    const rsyncArgs = ['-a', '--delete', ...existing.map(t => path.join(devRoot, t)), ALEC_ROOT + path.sep];
    setTimeout(() => {
      execFile('rsync', rsyncArgs, (rsErr, rsOut, rsErrStr) => {
        const msg = rsErr ? (rsErrStr || rsErr.message) : `synced ${existing.join(', ')} → bundle`;
        pushLog(rsErr ? 'error' : 'info', (rsErr ? '✖ rsync failed: ' : '✅ Update: ') + msg);
        setTimeout(() => startServer(), 500);
        resolve({ success: !rsErr, message: msg });
      });
    }, 1500);
  });
}));

// Auto-update is GATED behind ALEC_ENABLE_AUTOUPDATE=1. The unsigned DMG/ZIP
// pipeline fails Squirrel's signature check (`code has no resources but
// signature indicates they must be present`), which loops forever and
// eventually kills the backend respawn budget. Until we ship a properly
// codesigned+notarized build, updates must be installed manually by
// re-downloading the DMG. Users can still trigger a manual check via the
// `run-update-check` IPC; it just won't fire automatically.
app.whenReady().then(() => {
  if (!autoUpdater || !app.isPackaged) return;
  if (process.env.ALEC_ENABLE_AUTOUPDATE !== '1') {
    pushLog('info', 'ℹ Auto-update disabled (unsigned builds). Set ALEC_ENABLE_AUTOUPDATE=1 to re-enable.');
    return;
  }
  setTimeout(() => {
    try { autoUpdater.checkForUpdatesAndNotify(); } catch (e) {
      console.warn('[updater] startup check failed:', e.message);
    }
  }, 8000);
});

ipcMain.handle('model:list', async () => {
  try {
    const { listModels } = require(path.join(ALEC_ROOT, 'services', 'llamaEngine.js'));
    return listModels();
  } catch {
    return [];
  }
});

// ── Model switch: persist to userData (always writable), then restart ──
// Earlier versions wrote into the bundled .env, which on some installs is
// read-only and caused an unhandled rejection that made the app appear to
// "close out" when Activate was clicked. userData is per-user, always
// writable, and survives reinstalls.
function userSettingsPath() {
  return path.join(app.getPath('userData'), 'alec-settings.json');
}
function readUserSettings() {
  try {
    const p = userSettingsPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch { return {}; }
}
function writeUserSettings(patch) {
  const p = userSettingsPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const merged = { ...readUserSettings(), ...patch };
  fs.writeFileSync(p, JSON.stringify(merged, null, 2));
  return merged;
}

ipcMain.handle('model:activate', async (_e, modelPath) => {
  try {
    if (!modelPath || !fs.existsSync(modelPath)) {
      return { success: false, error: 'Model file not found on disk' };
    }
    writeUserSettings({ ALEC_MODEL_PATH: modelPath });
    pushLog('info', `🔀 Active model set → ${path.basename(modelPath)}`);
    pushLog('info', '🔄 Restarting server to load new model…');
    // Don't await — restartServer fires timeouts and returns synchronously.
    restartServer();
    return { success: true, path: modelPath };
  } catch (err) {
    pushLog('error', `✖ Model switch failed: ${err.message}`);
    return { success: false, error: String(err.message || err) };
  }
});

// ── Neural engine (Python) controls ───────────────────────────────
let neuralProcess = null;

ipcMain.handle('neural:start', async () => {
  if (neuralProcess) return { success: true, already: true };
  const script  = path.join(ALEC_ROOT, 'scripts', 'restart-neural.sh');
  const venvPy  = path.join(ALEC_ROOT, 'services', 'neural', '.venv', 'bin', 'python');

  // Fail fast with a readable message if the Python venv isn't present.
  // The packaged DMG doesn't ship one — it's a dev-time artifact — so point
  // the user at the setup command instead of hanging for 60s in a health
  // check that will never succeed.
  if (!fs.existsSync(venvPy)) {
    // Auto-create the venv on first launch. This happens once; on subsequent
    // launches the venv is present and we skip straight to boot.
    const neuralDir = path.join(ALEC_ROOT, 'services', 'neural');
    const reqFile   = path.join(neuralDir, 'requirements.txt');
    if (!fs.existsSync(reqFile)) {
      pushLog('warn', `🧠 Neural requirements.txt not found at ${reqFile}`);
      return { success: false, error: 'Neural requirements.txt missing.' };
    }
    pushLog('info', '🧠 First-run setup: creating Python venv for neural engine (this takes ~60s)…');
    const setupOk = await new Promise((resolve) => {
      // Install core deps only. llama-cpp-python is skipped because its
      // wheel build fails on macOS 26 / arm64 (x86_64 linker); node-llama-cpp
      // on the Node side handles GGUF inference via Metal, so Python neural
      // doesn't actually need it at runtime.
      const coreDeps = [
        'fastapi', "'uvicorn[standard]'", 'python-dotenv', 'pydantic',
        'pandas', 'openpyxl', 'bcrypt', 'cryptography',
        'huggingface-hub', 'httpx', 'pymssql', 'edge-tts', 'pytest',
      ].join(' ');
      const cmd = `python3 -m venv .venv && .venv/bin/pip install --quiet --upgrade pip && .venv/bin/pip install --quiet ${coreDeps}`;
      const p = spawn('bash', ['-lc', cmd], { cwd: neuralDir, env: process.env });
      p.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => pushLog('info', '[venv] ' + l)));
      p.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => pushLog('warn', '[venv] ' + l)));
      p.on('exit', code => resolve(code === 0));
      p.on('error', () => resolve(false));
    });
    if (!setupOk || !fs.existsSync(venvPy)) {
      pushLog('error', '🧠 Venv setup failed. Check pip output above.');
      return { success: false, error: 'Neural venv setup failed.' };
    }
    pushLog('info', '🧠 Venv ready — booting neural engine…');
  }

  pushLog('info', '🧠 Booting neural engine…');
  return new Promise((resolve) => {
    neuralProcess = spawn('bash', [script], { cwd: ALEC_ROOT, env: process.env });
    let buf = '';
    neuralProcess.stdout.on('data', d => {
      const s = d.toString();
      buf += s;
      s.split('\n').filter(Boolean).forEach(l => pushLog('info', '[neural] ' + l));
    });
    neuralProcess.stderr.on('data', d =>
      d.toString().split('\n').filter(Boolean).forEach(l => pushLog('warn', '[neural] ' + l))
    );
    neuralProcess.on('exit', (code) => {
      pushLog(code === 0 ? 'info' : 'warn', `🧠 neural restart exited ${code}`);
      neuralProcess = null;
      resolve({ success: code === 0, code });
    });
  });
});

ipcMain.handle('neural:stop', async () => {
  return new Promise((resolve) => {
    execFile('bash', ['-c', 'kill $(lsof -ti:8000) 2>/dev/null; echo stopped'], (err, stdout) => {
      pushLog('info', '🧠 Neural engine stopped');
      resolve({ success: !err, message: stdout.trim() });
    });
  });
});

ipcMain.handle('neural:status', async () => {
  try {
    const data = await httpGet('http://localhost:8000/health');
    return { running: true, ...data };
  } catch {
    return { running: false };
  }
});

// ── Training trigger (calls backend, which proxies to neural) ─────
ipcMain.handle('training:start', async (_e, opts = {}) => {
  pushLog('info', '🏋 Starting base training run…');
  try {
    const data = await httpRequest('POST', `${ALEC_URL}/api/training/start`, opts);
    pushLog('info', '🏋 Training: ' + JSON.stringify(data).slice(0, 200));
    return { success: true, data };
  } catch (err) {
    pushLog('error', `✖ Training start failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('training:status', async () => {
  try {
    return await httpGet(`${ALEC_URL}/api/training/status`);
  } catch (err) {
    return { error: err.message };
  }
});

// ── Hardware inspection + model catalog + downloads ──────────────
// Why this exists: ALEC is "25% us, 75% base model". The base model's
// throughput is entirely a function of the host's unified memory. We
// probe RAM/CPU once on launch and match the user against a curated
// catalog so they never have to guess what'll run well.

function getCatalog() {
  try {
    const p = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar', 'src', 'models-catalog.json')
      : path.join(__dirname, 'models-catalog.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    pushLog('error', `catalog read failed: ${err.message}`);
    return { models: [] };
  }
}

function inspectHardware() {
  const ramBytes = os.totalmem();
  const ramGb    = Math.round(ramBytes / 1024 / 1024 / 1024);
  const cpus     = os.cpus();
  const arch     = os.arch();
  const platform = os.platform();
  // Extra mac details via sysctl (best-effort, non-blocking swallow)
  let chip = (cpus[0] && cpus[0].model) || 'unknown';
  try {
    const out = require('child_process').execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string'], { encoding: 'utf8' }).trim();
    if (out) chip = out;
  } catch { /* ignore */ }
  return {
    ramGb,
    ramBytes,
    cores: cpus.length,
    chip,
    arch,
    platform,
    appleSilicon: platform === 'darwin' && arch === 'arm64',
  };
}

function recommendModels() {
  const hw = inspectHardware();
  const catalog = getCatalog().models;
  // Give us comfortable headroom: the model working-set should leave
  // at least 4 GB for the OS, backend, and SPA renderer.
  const usableGb = Math.max(0, hw.ramGb - 4);
  const annotated = catalog.map(m => {
    const fits        = hw.ramGb >= m.minRamGb;
    const comfortable = hw.ramGb >= m.recommendedRamGb;
    const headroom    = usableGb - (m.sizeMb / 1024);
    return { ...m, fits, comfortable, headroomGb: +headroom.toFixed(1) };
  });
  // Pick the best "comfortable" fit — biggest model whose recommendedRamGb ≤ ramGb.
  const comfortable = annotated.filter(m => m.comfortable);
  const best = comfortable.length
    ? comfortable.reduce((a, b) => (b.sizeMb > a.sizeMb ? b : a))
    : annotated.filter(m => m.fits).reduce((a, b) => (!a || b.sizeMb > a.sizeMb ? b : a), null);
  return { hw, models: annotated, recommendedId: best ? best.id : null };
}

function modelsDir() {
  // Where we drop downloaded GGUFs. llamaEngine.findModel already scans this.
  return path.join(ALEC_ROOT, 'services', 'neural', 'models');
}

// Download GGUF with progress events streamed to the renderer.
function downloadModel(model) {
  return new Promise((resolve, reject) => {
    const dir = modelsDir();
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, path.basename(new URL(model.url).pathname));
    if (fs.existsSync(dest)) {
      pushLog('info', `📦 ${path.basename(dest)} already present`);
      return resolve({ success: true, path: dest, already: true });
    }
    pushLog('info', `⬇ Downloading ${model.name} → ${path.basename(dest)}`);
    const tmp = dest + '.part';
    const file = fs.createWriteStream(tmp);
    const started = Date.now();

    const follow = (url, redirects = 0) => {
      if (redirects > 5) return reject(new Error('Too many redirects'));
      https.get(url, { headers: { 'User-Agent': 'ALEC-Desktop/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return follow(res.headers.location, redirects + 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10);
        let received = 0;
        let lastPct  = -1;
        res.on('data', (chunk) => {
          received += chunk.length;
          const pct = total ? Math.floor((received / total) * 100) : 0;
          if (pct !== lastPct) {
            lastPct = pct;
            if (mainWindow) mainWindow.webContents.send('model:download-progress', {
              id: model.id, pct, receivedMb: +(received / 1048576).toFixed(1),
              totalMb: total ? +(total / 1048576).toFixed(1) : null,
            });
          }
        });
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            fs.renameSync(tmp, dest);
            const secs = ((Date.now() - started) / 1000).toFixed(1);
            pushLog('info', `✅ ${path.basename(dest)} downloaded in ${secs}s`);
            resolve({ success: true, path: dest });
          });
        });
      }).on('error', (err) => {
        try { fs.unlinkSync(tmp); } catch {}
        reject(err);
      });
    };
    follow(model.url);
  });
}

ipcMain.handle('hardware:inspect',   async () => inspectHardware());
ipcMain.handle('model:catalog',      async () => getCatalog().models);
ipcMain.handle('model:recommend',    async () => recommendModels());
ipcMain.handle('model:download',     async (_e, id) => {
  const model = getCatalog().models.find(m => m.id === id);
  if (!model) return { success: false, error: 'Unknown model id' };
  try {
    return await downloadModel(model);
  } catch (err) {
    pushLog('error', `✖ Download failed: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// ── Log helpers ───────────────────────────────────────────────────
function pushLog(level, text) {
  const entry = { level, text, ts: new Date().toLocaleTimeString() };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_LINES) logBuffer.shift();
  if (mainWindow) mainWindow.webContents.send('log', entry);
}

// One-click "dump everything to Desktop and reveal in Finder" — bypasses
// clipboard entirely, which is important for crash-loop floods where
// the real root-cause line may be thousands of rows above the current view.
ipcMain.handle('logs:save', async () => {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = path.join(app.getPath('desktop'), `alec-logs-${stamp}.txt`);
    const header = [
      `A.L.E.C. Desktop log snapshot`,
      `Taken:   ${new Date().toString()}`,
      `Version: ${app.getVersion()}`,
      `Lines:   ${logBuffer.length}`,
      `─────────────────────────────────────────────────`,
      '',
    ].join('\n');
    const body = logBuffer
      .map(e => `${e.ts}  [${(e.level || 'info').toUpperCase().padEnd(5)}] ${e.text}`)
      .join('\n');
    fs.writeFileSync(outPath, header + body + '\n', 'utf8');
    shell.showItemInFinder(outPath);
    pushLog('info', `💾 Logs saved → ${outPath}`);
    return { ok: true, path: outPath, lines: logBuffer.length };
  } catch (err) {
    pushLog('error', `✖ Log save failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
});

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

function httpRequest(method, url, payload) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers: {
        'Content-Type':  'application/json',
        'Content-Length': body ? Buffer.byteLength(body) : 0,
      },
    }, (res) => {
      let data = '';
      res.on('data', d => (data += d));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        try { resolve(JSON.parse(data)); } catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
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

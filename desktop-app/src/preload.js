/**
 * Electron preload — exposes a safe, typed IPC bridge to the renderer.
 * With contextIsolation: true, the renderer cannot access Node directly;
 * everything it needs from the main process must be funnelled through here.
 *
 * Organised by concern:
 *   - Server (Node backend lifecycle)
 *   - Model (list + activate GGUF)
 *   - Neural (Python engine lifecycle)
 *   - Training (trigger + status)
 *   - Utility (browser, version)
 *   - Events (main → renderer push)
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alec', {
  // ── Server ──────────────────────────────────────────────────────
  start:   () => ipcRenderer.invoke('server:start'),
  stop:    () => ipcRenderer.invoke('server:stop'),
  restart: () => ipcRenderer.invoke('server:restart'),
  status:  () => ipcRenderer.invoke('server:status'),
  update:  () => ipcRenderer.invoke('server:update'),

  // ── Models ──────────────────────────────────────────────────────
  listModels:    () => ipcRenderer.invoke('model:list'),
  activateModel: (path) => ipcRenderer.invoke('model:activate', path),

  // ── Hardware-aware catalog & downloads ─────────────────────────
  inspectHardware:  () => ipcRenderer.invoke('hardware:inspect'),
  modelCatalog:     () => ipcRenderer.invoke('model:catalog'),
  recommendModels:  () => ipcRenderer.invoke('model:recommend'),
  downloadModel:    (id) => ipcRenderer.invoke('model:download', id),
  onDownloadProgress: (fn) => ipcRenderer.on('model:download-progress', (_, v) => fn(v)),

  // ── Neural engine (Python) ──────────────────────────────────────
  neuralStart:  () => ipcRenderer.invoke('neural:start'),
  neuralStop:   () => ipcRenderer.invoke('neural:stop'),
  neuralStatus: () => ipcRenderer.invoke('neural:status'),

  // ── Training ────────────────────────────────────────────────────
  trainingStart:  (opts) => ipcRenderer.invoke('training:start', opts || {}),
  trainingStatus: ()     => ipcRenderer.invoke('training:status'),

  // ── Utility ─────────────────────────────────────────────────────
  openBrowser: () => ipcRenderer.invoke('open:browser'),
  version:     () => ipcRenderer.invoke('app:version'),

  // ── Secure token storage (Keychain-backed via safeStorage) ──────
  // Sprint 3: refresh tokens move off localStorage into OS keychain.
  tokens: {
    get:    (key) => ipcRenderer.invoke('token:get',    { key }),
    set:    (key, value) => ipcRenderer.invoke('token:set', { key, value }),
    delete: (key) => ipcRenderer.invoke('token:delete', { key }),
  },

  // ── Event streams (main → renderer) ─────────────────────────────
  onStatus:   (fn) => ipcRenderer.on('status',    (_, v) => fn(v)),
  onHealth:   (fn) => ipcRenderer.on('health',    (_, v) => fn(v)),
  onLog:      (fn) => ipcRenderer.on('log',       (_, v) => fn(v)),
  onLogBatch: (fn) => ipcRenderer.on('log-batch', (_, v) => fn(v)),
  saveLogs:   () => ipcRenderer.invoke('logs:save'),

  // ── S7.6 Desktop Control ────────────────────────────────────────
  desktop: {
    probe:   () => ipcRenderer.invoke('desktop:probe'),
    approve: (payload) => ipcRenderer.invoke('desktop:approve-modal', payload || {}),
  },

  // Menu-triggered actions
  onMenuCopyLogs: (fn) => ipcRenderer.on('logs:copy',      () => fn()),
  onMenuClearLogs:(fn) => ipcRenderer.on('logs:clear',     () => fn()),
  onMenuToggleDrawer:(fn) => ipcRenderer.on('toggle:drawer', () => fn()),
  onMenuReloadSpa:(fn) => ipcRenderer.on('reload:spa',     () => fn()),
});

// S7.7 — the Settings › Desktop tab feature-detects window.electronAPI,
// so expose an alias.
contextBridge.exposeInMainWorld('electronAPI', {
  desktop: {
    probe:   () => ipcRenderer.invoke('desktop:probe'),
    approve: (payload) => ipcRenderer.invoke('desktop:approve-modal', payload || {}),
  },
});

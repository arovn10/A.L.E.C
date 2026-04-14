/**
 * Electron preload — exposes safe IPC bridge to renderer.
 * contextIsolation: true means renderer can't access Node directly.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('alec', {
  // Server controls
  start:   () => ipcRenderer.invoke('server:start'),
  stop:    () => ipcRenderer.invoke('server:stop'),
  restart: () => ipcRenderer.invoke('server:restart'),
  status:  () => ipcRenderer.invoke('server:status'),
  update:  () => ipcRenderer.invoke('server:update'),

  // Models
  listModels: () => ipcRenderer.invoke('model:list'),

  // Utility
  openBrowser: () => ipcRenderer.invoke('open:browser'),
  version:     () => ipcRenderer.invoke('app:version'),

  // Event listeners (main → renderer)
  onStatus:   (fn) => ipcRenderer.on('status',    (_, v) => fn(v)),
  onHealth:   (fn) => ipcRenderer.on('health',    (_, v) => fn(v)),
  onLog:      (fn) => ipcRenderer.on('log',       (_, v) => fn(v)),
  onLogBatch: (fn) => ipcRenderer.on('log-batch', (_, v) => fn(v)),
});

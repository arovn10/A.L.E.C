// backend/services/desktopPermissions.mjs
// S7.2 — native macOS permission probes, cached into desktop_permissions.
//
// Each probe spawns a short-lived check via execFileSync (never a shell string;
// all args are static). Failure (non-zero exit / thrown TCC denial) is treated
// as "not granted" — we never crash the caller.

import { execFileSync } from 'node:child_process';
import os from 'node:os';

const ACCESSIBILITY_SCRIPT = 'tell application "System Events" to return UI elements enabled';
const AUTOMATION_SCRIPT    = 'tell application "Finder" to return name';

function runProbe(id) {
  try {
    if (id === 'accessibility') {
      const out = execFileSync('osascript', ['-e', ACCESSIBILITY_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
      return String(out).trim().toLowerCase() === 'true' ? 1 : 0;
    }
    if (id === 'screen_recording') {
      // /tmp/probe.png is discarded; the real signal is whether screencapture
      // exits 0 (TCC grants screen recording).
      execFileSync('screencapture', ['-x', '-t', 'png', '/tmp/alec-probe.png'], { stdio: 'ignore' });
      return 1;
    }
    if (id === 'automation') {
      execFileSync('osascript', ['-e', AUTOMATION_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
      return 1;
    }
    return 0;
  } catch {
    return 0;
  }
}

function persist(db, id, granted) {
  const now = new Date().toISOString();
  const version = os.release();
  db.prepare(
    `INSERT INTO desktop_permissions(id, granted, last_checked, last_probed_version)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       granted=excluded.granted,
       last_checked=excluded.last_checked,
       last_probed_version=excluded.last_probed_version`
  ).run(id, granted, now, version);
}

export async function probeAll(db) {
  const ids = ['accessibility', 'screen_recording', 'automation'];
  const out = {};
  for (const id of ids) {
    const granted = runProbe(id);
    persist(db, id, granted);
    out[id] = granted;
  }
  return out;
}

export function getAll(db) {
  return db.prepare(
    'SELECT id, granted, last_checked, last_probed_version FROM desktop_permissions ORDER BY id'
  ).all();
}

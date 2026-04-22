// backend/services/desktopControl.mjs
// S7.4 — singleton desktopControl.execute() — the ONE gate every primitive
// routes through. Every caller (internal agent, HTTP route, local MCP server)
// MUST go through this function. Direct primitive access bypasses audit.
//
// Flow for every invocation:
//   1. Load policy.
//   2. Evaluate(policy, primitive, args).
//   3. Write audit row BEFORE executing — if audit fails, refuse.
//   4. If 'deny' -> {error:'disabled'}.
//   5. If 'ask' -> broadcast IPC prompt to Electron; default deny after 15s.
//   6. Dispatch to primitive impl.
//
// nut-js is loaded lazily so CI without native build tools still runs tests.

import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import * as policy from './desktopPolicy.mjs';

const execFileP = promisify(execFile);

const ASK_TIMEOUT_MS = 15_000;
const DENYLIST_RE = /(Keychain|1Password|Bitwarden|Vault|System Settings.*Passwords)/i;

// Electron approval broadcast — injected at runtime by server.js / electron main.
let askFn = async () => ({ approved: false, reason: 'no-approver-registered' });
export function setApprover(fn) { askFn = fn; }

// nut-js loader (lazy, cached)
let nutCache;
async function loadNut() {
  if (nutCache !== undefined) return nutCache;
  try {
    const mod = await import('@nut-tree-fork/nut-js');
    nutCache = mod;
  } catch {
    nutCache = null;
  }
  return nutCache;
}

function frontmostWindowTitle() {
  try {
    const out = execFileSync(
      'osascript',
      ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return String(out).trim();
  } catch {
    return '';
  }
}

// Primitive impls ---------------------------------------------------------

async function primScreenCapture() {
  const tmp = path.join(os.tmpdir(), `alec-screen-${Date.now()}.png`);
  await execFileP('screencapture', ['-x', '-t', 'png', tmp]);
  const bytes = await fsp.readFile(tmp);
  // Screenshots are NOT persisted — unlink right after we base64 them.
  fs.promises.unlink(tmp).catch(() => {});
  return { png_base64: bytes.toString('base64') };
}

async function primScreenReadText() {
  // v1 stub — Vision.framework integration is tracked in a follow-on spec.
  return { text: '' };
}

async function primMouseClick(args) {
  const nut = await loadNut();
  if (!nut) return { error: 'nut-js unavailable' };
  const { mouse, Point, Button, straightTo } = nut;
  await mouse.move(straightTo(new Point(args.x, args.y)));
  await mouse.click(args.button === 'right' ? Button.RIGHT : Button.LEFT);
  return { ok: true };
}

async function primMouseMove(args) {
  const nut = await loadNut();
  if (!nut) return { error: 'nut-js unavailable' };
  const { mouse, Point, straightTo } = nut;
  await mouse.move(straightTo(new Point(args.x, args.y)));
  return { ok: true };
}

async function primKeyboardType(args) {
  // Second line of defence — even if policy.evaluate missed it, check again.
  const title = frontmostWindowTitle();
  if (DENYLIST_RE.test(title)) return { error: 'denylist-window' };
  const nut = await loadNut();
  if (!nut) return { error: 'nut-js unavailable' };
  await nut.keyboard.type(args.text);
  return { ok: true };
}

async function primKeyboardPress(args) {
  const nut = await loadNut();
  if (!nut) return { error: 'nut-js unavailable' };
  await nut.keyboard.pressKey(...(args.keys || []));
  await nut.keyboard.releaseKey(...(args.keys || []));
  return { ok: true };
}

async function primApplescriptRun(args) {
  const { stdout } = await execFileP('osascript', ['-e', args.source]);
  return { stdout: String(stdout) };
}

async function primWindowList() {
  const script = `tell application "System Events"
    set winList to {}
    repeat with p in (every process whose visible is true)
      try
        repeat with w in (every window of p)
          set end of winList to (name of p) & "|" & (name of w) & "|" & (unix id of p)
        end repeat
      end try
    end repeat
    return winList
  end tell`;
  try {
    const { stdout } = await execFileP('osascript', ['-e', script]);
    const items = String(stdout).trim().split(', ').filter(Boolean).map(line => {
      const [app, title, pid] = line.split('|');
      return { app, title, pid: Number(pid) };
    });
    return { windows: items };
  } catch (err) {
    return { windows: [], error: err.message };
  }
}

async function primWindowFocus(args) {
  const target = args.title || args.pid;
  if (!target) return { error: 'missing title or pid' };
  const src = `tell application "${String(args.title).replace(/"/g, '\\"')}" to activate`;
  await execFileP('osascript', ['-e', src]);
  return { ok: true };
}

const PRIMITIVES = {
  'screen.capture':   primScreenCapture,
  'screen.read_text': primScreenReadText,
  'mouse.click':      primMouseClick,
  'mouse.move':       primMouseMove,
  'keyboard.type':    primKeyboardType,
  'keyboard.press':   primKeyboardPress,
  'applescript.run':  primApplescriptRun,
  'window.list':      primWindowList,
  'window.focus':     primWindowFocus,
};

export function listPrimitives() {
  return Object.keys(PRIMITIVES);
}

function writeAudit(db, { userId, action, targetId, metadata }) {
  db.prepare(
    `INSERT INTO audit_log(user_id, org_id, action, target_type, target_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId || 'system', null, action, 'desktop', targetId,
       metadata ? JSON.stringify(metadata) : null);
}

/**
 * execute — the ONE entry point.
 * @param {Database} db
 * @param {string} primitive
 * @param {object} args
 * @param {object} ctx — { userId, via: 'internal'|'http'|'mcp' }
 */
export async function execute(db, primitive, args = {}, ctx = {}) {
  const impl = PRIMITIVES[primitive];
  if (!impl) return { error: 'unknown-primitive' };

  const userId = ctx.userId || 'system';
  const via = ctx.via || 'internal';

  // Step 1–2: evaluate
  let decision;
  try {
    decision = policy.evaluate(db, primitive, {
      ...args,
      frontmost: args.frontmost || frontmostWindowTitle(),
    });
  } catch (err) {
    return { error: 'policy-error', detail: err.message };
  }

  // Step 3: AUDIT BEFORE EXECUTE — if this fails, refuse.
  try {
    writeAudit(db, {
      userId,
      action: `desktop.${primitive}`,
      targetId: primitive,
      metadata: { args: redactArgs(args), via, decision },
    });
  } catch (err) {
    return { error: 'audit-failed', detail: err.message };
  }

  // Step 4: deny
  if (decision === 'deny') return { error: 'disabled' };

  // Step 5: ask -> Electron modal (with 15s timeout default-deny)
  if (decision === 'ask') {
    let approved = false;
    try {
      const res = await Promise.race([
        askFn({ primitive, args, userId, via }),
        new Promise(resolve => setTimeout(() => resolve({ approved: false, reason: 'timeout' }), ASK_TIMEOUT_MS)),
      ]);
      approved = !!res?.approved;
    } catch {
      approved = false;
    }
    if (!approved) {
      writeAudit(db, {
        userId, action: `desktop.${primitive}.denied`,
        targetId: primitive, metadata: { via, reason: 'user-denied-or-timeout' },
      });
      return { error: 'denied-by-user' };
    }
  }

  // Step 6: dispatch
  try {
    return await impl(args);
  } catch (err) {
    writeAudit(db, {
      userId, action: `desktop.${primitive}.error`,
      targetId: primitive, metadata: { via, error: err.message },
    });
    return { error: 'execution-failed', detail: err.message };
  }
}

function redactArgs(args) {
  if (!args) return {};
  const redacted = { ...args };
  if (typeof redacted.text === 'string') {
    redacted.text = `<${redacted.text.length} chars>`;
  }
  if (typeof redacted.source === 'string') {
    redacted.source = `<${redacted.source.length} chars>`;
  }
  return redacted;
}

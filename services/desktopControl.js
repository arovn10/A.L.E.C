/**
 * A.L.E.C. Desktop Control
 *
 * Gives ALEC the ability to interact with macOS:
 *  - Open / focus / close apps
 *  - Read / write files (with safety constraints)
 *  - Take screenshots
 *  - Send system notifications
 *  - Get system info (battery, wifi, volume)
 *  - Run safe AppleScript commands
 *
 * All shell commands use execFile (not exec) to prevent injection.
 */

const { execFile, execFileSync } = require('child_process');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// ── Safe directories ALEC can read/write ──────────────────────────
const ALLOWED_WRITE_DIRS = [
  os.homedir() + '/Desktop',
  os.homedir() + '/Documents/ALEC',
  os.homedir() + '/Downloads',
  path.join(__dirname, '../data'),
];

// Ensure ALEC's Documents folder exists
const ALEC_DOCS = path.join(os.homedir(), 'Documents', 'ALEC');
if (!fs.existsSync(ALEC_DOCS)) fs.mkdirSync(ALEC_DOCS, { recursive: true });

function isAllowedWritePath(filePath) {
  const abs = path.resolve(filePath);
  return ALLOWED_WRITE_DIRS.some(dir => abs.startsWith(path.resolve(dir)));
}

// ── execFile promise wrapper ──────────────────────────────────────
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10000, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── AppleScript runner ────────────────────────────────────────────
async function runAppleScript(script) {
  return run('osascript', ['-e', script]);
}

// ── SKILLS ────────────────────────────────────────────────────────

/**
 * Open an application by name.
 * openApp('Safari')  →  opens Safari
 */
async function openApp(appName) {
  await run('open', ['-a', appName]);
  return `Opened ${appName}`;
}

/**
 * Focus (bring to foreground) an application.
 */
async function focusApp(appName) {
  await runAppleScript(`tell application "${appName}" to activate`);
  return `Focused ${appName}`;
}

/**
 * Close an application gracefully.
 */
async function closeApp(appName) {
  await runAppleScript(`tell application "${appName}" to quit`);
  return `Closed ${appName}`;
}

/**
 * List running applications.
 */
async function listRunningApps() {
  const out = await runAppleScript(
    'tell application "System Events" to get name of every application process whose background only is false'
  );
  return out.split(', ').map(s => s.trim()).filter(Boolean);
}

/**
 * Take a screenshot and save to Desktop.
 * macOS requires Screen Recording permission for the calling process.
 * Tries screencapture first; falls back to a window-only capture via osascript.
 */
async function takeScreenshot(filename = null) {
  const name = filename || `alec-screenshot-${Date.now()}.png`;
  const dest = path.join(os.homedir(), 'Desktop', name);
  try {
    // Primary: full-screen capture (needs Screen Recording permission)
    await run('screencapture', ['-x', '-t', 'png', dest]);
    return dest;
  } catch (err) {
    // Fallback: capture the frontmost window only via osascript
    // (works without Screen Recording entitlement in some macOS versions)
    try {
      await run('screencapture', ['-x', '-o', '-t', 'png', dest]);
      return dest;
    } catch {
      // Final fallback: tell the user to grant permission
      throw new Error(
        `Screenshot failed: ${err.message}. ` +
        'Grant Screen Recording permission in System Settings → Privacy & Security → Screen Recording for Terminal/Node.js.'
      );
    }
  }
}

/**
 * Send a macOS system notification.
 */
async function notify(title, message, sound = 'default') {
  const script = `display notification "${message.replace(/"/g,'')}" with title "${title.replace(/"/g,'')}" sound name "${sound}"`;
  await runAppleScript(script);
  return 'Notification sent';
}

/**
 * Get system information.
 */
async function getSystemInfo() {
  const info = {};

  // Battery
  try {
    const batt = await run('pmset', ['-g', 'batt']);
    const pct = batt.match(/(\d+)%/)?.[1];
    const charging = batt.includes('AC Power');
    info.battery = { percent: pct ? Number(pct) : null, charging };
  } catch { info.battery = null; }

  // WiFi
  try {
    const wifi = await run('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport', ['-I']);
    const ssid = wifi.match(/\s+SSID:\s+(.+)/)?.[1];
    const signal = wifi.match(/\s+agrCtlRSSI:\s+(-?\d+)/)?.[1];
    info.wifi = { ssid: ssid?.trim(), signal: signal ? Number(signal) : null };
  } catch { info.wifi = null; }

  // Volume
  try {
    const vol = await runAppleScript('output volume of (get volume settings)');
    info.volume = Number(vol);
  } catch { info.volume = null; }

  // CPU + RAM
  info.cpu = { arch: os.arch(), cores: os.cpus().length, model: os.cpus()[0]?.model };
  const mem = process.memoryUsage();
  info.memory = {
    totalGB:  (os.totalmem() / 1e9).toFixed(1),
    freeGB:   (os.freemem()  / 1e9).toFixed(1),
    heapMB:   (mem.heapUsed  / 1e6).toFixed(0),
  };

  return info;
}

/**
 * Set system volume (0–100).
 */
async function setVolume(level) {
  const v = Math.max(0, Math.min(100, Number(level)));
  await runAppleScript(`set volume output volume ${v}`);
  return `Volume set to ${v}%`;
}

/**
 * Read a file (text only, must be in allowed dirs or no sensitive paths).
 */
async function readFile(filePath) {
  const abs = path.resolve(filePath);
  // Block sensitive files
  if (abs.includes('/.ssh/') || abs.includes('/.gnupg/') || abs.endsWith('.pem') || abs.endsWith('.key')) {
    throw new Error('Access denied: sensitive file');
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * Write a file (must be in an allowed write directory).
 */
async function writeFile(filePath, content) {
  if (!isAllowedWritePath(filePath)) {
    throw new Error(`Write not allowed to ${filePath}. Allowed: Desktop, Documents/ALEC, Downloads, data/`);
  }
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
  return `Written to ${abs}`;
}

/**
 * List files in a directory (safe).
 */
async function listDirectory(dirPath = os.homedir() + '/Desktop') {
  const abs = path.resolve(dirPath);
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  return entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
}

/**
 * Open a URL in the default browser.
 */
async function openURL(url) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Only http/https URLs allowed');
  }
  await run('open', [url]);
  return `Opened ${url}`;
}

/**
 * Speak text using macOS text-to-speech.
 */
async function speak(text, voice = 'Alex') {
  const safe = text.replace(/"/g, '').slice(0, 500);
  await run('say', ['-v', voice, safe]);
  return 'Spoken';
}

/**
 * Get the current date/time.
 */
function getDateTime() {
  return {
    date:    new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
    time:    new Date().toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' }),
    iso:     new Date().toISOString(),
    unix:    Date.now(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

// ── Skill dispatch map ─────────────────────────────────────────────
// ALEC calls skills by name + args from LLM tool-call parsing.
const SKILLS = {
  open_app:       ({ app })        => openApp(app),
  focus_app:      ({ app })        => focusApp(app),
  close_app:      ({ app })        => closeApp(app),
  list_apps:      ()               => listRunningApps(),
  screenshot:     ({ filename })   => takeScreenshot(filename),
  notify:         ({ title, message, sound }) => notify(title, message, sound),
  system_info:    ()               => getSystemInfo(),
  set_volume:     ({ level })      => setVolume(level),
  read_file:      ({ path: p })    => readFile(p),
  write_file:     ({ path: p, content }) => writeFile(p, content),
  list_dir:       ({ path: p })    => listDirectory(p),
  open_url:       ({ url })        => openURL(url),
  speak:          ({ text, voice}) => speak(text, voice),
  get_datetime:   ()               => Promise.resolve(getDateTime()),
};

/**
 * Execute a skill by name with args.
 * Returns: { success, result, error }
 */
async function executeSkill(skillName, args = {}) {
  const fn = SKILLS[skillName];
  if (!fn) return { success: false, error: `Unknown skill: ${skillName}` };
  try {
    const result = await fn(args);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Detect if a user message implies a desktop skill and extract the call.
 * Returns { skill, args } or null.
 * This is a simple rule-based parser; the LLM handles ambiguous cases.
 */
function detectSkillIntent(text) {
  const t = text.toLowerCase();

  if (/open\s+(\w+)/.test(t)) {
    const app = text.match(/open\s+(\w[\w\s]*)/i)?.[1]?.trim();
    if (app && app.length < 40) return { skill: 'open_app', args: { app } };
  }
  if (/screenshot|take a photo of (my )?screen/.test(t)) return { skill: 'screenshot', args: {} };
  if (/what time|current time|what's the time/.test(t)) return { skill: 'get_datetime', args: {} };
  if (/battery|how much charge/.test(t)) return { skill: 'system_info', args: {} };
  if (/volume\s+(\d+)|set volume/.test(t)) {
    const level = t.match(/volume\s+(\d+)/)?.[1] || '50';
    return { skill: 'set_volume', args: { level } };
  }

  return null;
}

module.exports = {
  executeSkill,
  detectSkillIntent,
  listSkills: () => Object.keys(SKILLS),
  ALEC_DOCS,
  // Direct exports for server use
  openApp, focusApp, closeApp, takeScreenshot, notify, getSystemInfo,
  setVolume, readFile, writeFile, listDirectory, openURL, speak, getDateTime,
};

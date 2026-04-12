/**
 * A.L.E.C. iMessage Service
 *
 * Sends and reads iMessages on macOS using:
 *  - osascript (Messages app AppleScript) for SENDING
 *  - ~/Library/Messages/chat.db (SQLite) for READING conversation history
 *
 * Requires: Full Disk Access permission for the Terminal/Node.js process
 *   System Settings → Privacy & Security → Full Disk Access → add Terminal
 *
 * Usage:
 *   await iMessage.send('+15551234567', 'Task complete!')
 *   const msgs = await iMessage.getRecent('+15551234567', 10)
 */

const { execFile } = require('child_process');
const path  = require('path');
const os    = require('os');
const fs    = require('fs');

// ── Config ────────────────────────────────────────────────────────
// Owner's phone number / Apple ID for sending self-notifications
const OWNER_PHONE = process.env.OWNER_PHONE || process.env.ALEC_OWNER_PHONE || null;
const MESSAGES_DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

// ── AppleScript runner ─────────────────────────────────────────────
function runAS(script) {
  return new Promise((resolve, reject) => {
    execFile('osascript', ['-e', script], { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr?.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

// ── SQLite helper (uses sqlite3 CLI — no native module needed) ─────
function queryChatDB(sql) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(MESSAGES_DB)) {
      return reject(new Error('Messages DB not found — grant Full Disk Access to Terminal/Node.js'));
    }
    execFile('sqlite3', ['-json', MESSAGES_DB, sql], { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      try {
        resolve(stdout.trim() ? JSON.parse(stdout.trim()) : []);
      } catch {
        resolve([]);
      }
    });
  });
}

// ── SEND ──────────────────────────────────────────────────────────

/**
 * Send an iMessage to a phone number or Apple ID email.
 * @param {string} recipient — phone (+15551234567) or email (user@icloud.com)
 * @param {string} message   — text to send
 */
async function send(recipient, message) {
  if (!recipient) throw new Error('No recipient specified');
  const safeMsg = message.replace(/"/g, "'").replace(/\\/g, '\\\\').slice(0, 2000);
  const safeRec = recipient.replace(/"/g, '');

  const script = `
tell application "Messages"
  set targetService to 1st service whose service type = iMessage
  set targetBuddy to buddy "${safeRec}" of targetService
  send "${safeMsg}" to targetBuddy
end tell`;

  try {
    await runAS(script);
    return { success: true, recipient, preview: safeMsg.slice(0, 80) };
  } catch (err) {
    // Fallback: try via phone number service
    const fallback = `
tell application "Messages"
  send "${safeMsg}" to participant "${safeRec}"
end tell`;
    await runAS(fallback);
    return { success: true, recipient, preview: safeMsg.slice(0, 80), method: 'fallback' };
  }
}

/**
 * Send a notification to the owner (uses OWNER_PHONE env var).
 */
async function notifyOwner(message, prefix = '🤖 A.L.E.C.') {
  if (!OWNER_PHONE) {
    console.warn('[iMessage] OWNER_PHONE not set — skipping iMessage notification');
    return { success: false, reason: 'OWNER_PHONE not configured in .env' };
  }
  return send(OWNER_PHONE, `${prefix}: ${message}`);
}

// ── READ ──────────────────────────────────────────────────────────

/**
 * Get recent messages from a contact.
 * @param {string} phoneOrEmail — contact identifier
 * @param {number} limit        — number of messages to return (default 20)
 */
async function getRecent(phoneOrEmail, limit = 20) {
  const safe = phoneOrEmail.replace(/'/g, "''");
  const rows = await queryChatDB(`
    SELECT
      m.rowid,
      m.text,
      m.is_from_me,
      datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') AS sent_at,
      h.id AS contact_id
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.rowid
    JOIN chat c ON c.rowid = cmj.chat_id
    JOIN chat_handle_join chj ON chj.chat_id = c.rowid
    JOIN handle h ON h.rowid = chj.handle_id
    WHERE h.id LIKE '%${safe}%'
      AND m.text IS NOT NULL
    ORDER BY m.date DESC
    LIMIT ${Number(limit)}
  `);
  return rows.map(r => ({
    id:        r.rowid,
    text:      r.text,
    fromMe:    r.is_from_me === 1,
    sentAt:    r.sent_at,
    contactId: r.contact_id,
  })).reverse();
}

/**
 * Get all recent conversations (last message from each chat).
 */
async function getConversations(limit = 20) {
  const rows = await queryChatDB(`
    SELECT
      c.chat_identifier,
      c.display_name,
      m.text AS last_message,
      m.is_from_me,
      datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') AS last_at
    FROM chat c
    JOIN chat_message_join cmj ON cmj.chat_id = c.rowid
    JOIN message m ON m.rowid = cmj.message_id
    WHERE m.date = (
      SELECT MAX(m2.date) FROM message m2
      JOIN chat_message_join cmj2 ON cmj2.message_id = m2.rowid
      WHERE cmj2.chat_id = c.rowid
    )
    AND m.text IS NOT NULL
    ORDER BY m.date DESC
    LIMIT ${Number(limit)}
  `);
  return rows;
}

/**
 * Get unread messages (messages received since last check).
 * Reads from DB — tracks last-checked timestamp in a state file.
 */
const STATE_FILE = path.join(__dirname, '../data/imessage-state.json');

async function getUnread() {
  let lastChecked = 0;
  try {
    if (fs.existsSync(STATE_FILE)) {
      lastChecked = JSON.parse(fs.readFileSync(STATE_FILE)).lastChecked || 0;
    }
  } catch (_) {}

  // Convert JS timestamp to Apple Core Data timestamp (seconds since 2001-01-01)
  const appleEpochOffset = 978307200; // seconds between 1970-01-01 and 2001-01-01
  const lastApple = lastChecked > 0
    ? Math.floor(lastChecked / 1000) - appleEpochOffset
    : 0;

  const rows = await queryChatDB(`
    SELECT
      m.rowid, m.text, m.is_from_me,
      datetime(m.date/1000000000 + strftime('%s','2001-01-01'), 'unixepoch', 'localtime') AS sent_at,
      h.id AS contact_id
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.rowid
    JOIN chat c ON c.rowid = cmj.chat_id
    JOIN chat_handle_join chj ON chj.chat_id = c.rowid
    JOIN handle h ON h.rowid = chj.handle_id
    WHERE m.is_from_me = 0
      AND m.text IS NOT NULL
      AND m.date > ${lastApple} * 1000000000
    ORDER BY m.date ASC
    LIMIT 50
  `);

  // Update last-checked timestamp
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ lastChecked: Date.now() }));

  return rows.map(r => ({
    id: r.rowid, text: r.text, fromMe: false, sentAt: r.sent_at, contactId: r.contact_id,
  }));
}

// ── Status ────────────────────────────────────────────────────────
async function status() {
  const dbExists = fs.existsSync(MESSAGES_DB);
  let dbSize = null;
  if (dbExists) {
    try { dbSize = fs.statSync(MESSAGES_DB).size; } catch (_) {}
  }
  return {
    ownerPhoneConfigured: !!OWNER_PHONE,
    ownerPhone: OWNER_PHONE ? OWNER_PHONE.slice(0, 6) + '…' : null,
    messagesDbFound: dbExists,
    messagesDbSizeKB: dbSize ? Math.round(dbSize / 1024) : null,
  };
}

module.exports = { send, notifyOwner, getRecent, getConversations, getUnread, status, OWNER_PHONE };

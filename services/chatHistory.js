/**
 * A.L.E.C. Chat History Service
 *
 * Persistent, per-account conversation history — ChatGPT-style.
 * Uses tables alec_chats and alec_messages to avoid conflicts with
 * the existing conversations table in alec.db.
 */

const path = require('path');
const fs   = require('fs');

const DB_PATH = path.join(__dirname, '../data/alec.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
} catch {
  db = null;
}

if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS voice_transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT DEFAULT 'alec-owner',
      transcript TEXT NOT NULL,
      reply TEXT NOT NULL,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_voice_user ON voice_transcripts(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS alec_chats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT DEFAULT 'New Chat',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_alec_chats_user ON alec_chats(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS alec_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (chat_id) REFERENCES alec_chats(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_alec_msg_chat ON alec_messages(chat_id, id ASC);
  `);
}

function generateId() {
  return 'chat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function autoTitle(msg) {
  const clean = msg.replace(/[^\w\s]/g, ' ').trim();
  const words = clean.split(/\s+/).slice(0, 7).join(' ');
  return words.length > 3 ? words : 'New Chat';
}

function listConversations(userId) {
  if (!db) return [];
  try {
    return db.prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM alec_messages WHERE chat_id = c.id) as message_count,
              (SELECT content FROM alec_messages WHERE chat_id = c.id ORDER BY id DESC LIMIT 1) as last_message
       FROM alec_chats c WHERE c.user_id = ?
       ORDER BY c.updated_at DESC LIMIT 100`
    ).all(userId);
  } catch { return []; }
}

function createConversation(userId, title) {
  if (!db) return null;
  title = title || 'New Chat';
  const id = generateId();
  db.prepare('INSERT INTO alec_chats (id, user_id, title) VALUES (?, ?, ?)').run(id, userId, title);
  return { id, title, created_at: new Date().toISOString(), message_count: 0 };
}

function getConversation(chatId, userId) {
  if (!db) return null;
  return db.prepare('SELECT * FROM alec_chats WHERE id = ? AND user_id = ?').get(chatId, userId) || null;
}

function updateTitle(chatId, userId, title) {
  if (!db) return false;
  const info = db.prepare("UPDATE alec_chats SET title=?, updated_at=datetime('now') WHERE id=? AND user_id=?").run(title, chatId, userId);
  return info.changes > 0;
}

function deleteConversation(chatId, userId) {
  if (!db) return false;
  db.prepare('DELETE FROM alec_messages WHERE chat_id IN (SELECT id FROM alec_chats WHERE id=? AND user_id=?)').run(chatId, userId);
  const info = db.prepare('DELETE FROM alec_chats WHERE id=? AND user_id=?').run(chatId, userId);
  return info.changes > 0;
}

function getMessages(chatId, limit) {
  limit = limit || 50;
  if (!db) return [];
  try {
    return db.prepare('SELECT role, content FROM alec_messages WHERE chat_id=? ORDER BY id ASC LIMIT ?').all(chatId, limit);
  } catch { return []; }
}

function addMessage(chatId, role, content) {
  if (!db) return;
  db.prepare('INSERT INTO alec_messages (chat_id, role, content) VALUES (?, ?, ?)').run(chatId, role, content);
  db.prepare("UPDATE alec_chats SET updated_at=datetime('now') WHERE id=?").run(chatId);
  if (role === 'user') {
    const chat = db.prepare('SELECT title FROM alec_chats WHERE id=?').get(chatId);
    if (chat && (chat.title === 'New Chat' || !chat.title)) {
      db.prepare('UPDATE alec_chats SET title=? WHERE id=?').run(autoTitle(content), chatId);
    }
  }
}

function getOrCreate(chatId, userId) {
  if (!db) return { id: chatId || generateId(), isNew: true };
  if (chatId) {
    const existing = getConversation(chatId, userId);
    if (existing) return Object.assign({}, existing, { isNew: false });
  }
  const chat = createConversation(userId);
  return Object.assign({}, chat, { isNew: true });
}

function saveVoiceTranscript(transcript, reply, userId, durationMs) {
  if (!db) return;
  try {
    db.prepare('INSERT INTO voice_transcripts (user_id, transcript, reply, duration_ms) VALUES (?, ?, ?, ?)').run(
      userId || 'alec-owner', transcript, reply, durationMs || null
    );
  } catch (_) {}
}

function getVoiceTranscripts(userId, limit) {
  if (!db) return [];
  try {
    return db.prepare(
      'SELECT id, transcript, reply, duration_ms, created_at FROM voice_transcripts WHERE user_id=? ORDER BY created_at DESC LIMIT ?'
    ).all(userId || 'alec-owner', limit || 100);
  } catch { return []; }
}

module.exports = {
  listConversations,
  createConversation,
  getConversation,
  updateTitle,
  deleteConversation,
  getMessages,
  addMessage,
  getOrCreate,
  saveVoiceTranscript,
  getVoiceTranscripts,
};

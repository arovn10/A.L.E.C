/**
 * A.L.E.C. Gmail Service
 *
 * Manages two Gmail accounts via OAuth2:
 *   - alec      → rovneralec@gmail.com
 *   - properties → rovnerproperties@gmail.com
 *
 * One-time OAuth setup:
 *   node scripts/gmail-oauth.js
 *
 * Required .env vars (set by gmail-oauth.js):
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN_ALEC, GMAIL_REFRESH_TOKEN_PROPERTIES
 *
 * Pattern mirrors microsoftGraphService.js — lazy credential check,
 * structured return objects, graceful status().
 */

require('dotenv').config();
const { google } = require('googleapis');

// ── Account definitions ────────────────────────────────────────────
const ACCOUNTS = {
  alec: {
    email:        process.env.GMAIL_ALEC_EMAIL        || 'rovneralec@gmail.com',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN_ALEC || null,
  },
  properties: {
    email:        process.env.GMAIL_PROPERTIES_EMAIL        || 'rovnerproperties@gmail.com',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN_PROPERTIES || null,
  },
};

const CLIENT_ID     = process.env.GMAIL_CLIENT_ID     || null;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET || null;
const REDIRECT_URI  = 'urn:ietf:wg:oauth:2.0:oob'; // Desktop/CLI flow

// ── OAuth2 client cache ────────────────────────────────────────────
const _oauthClients = new Map();

function getOAuthClient(account) {
  const key = account.toLowerCase();
  if (!ACCOUNTS[key]) throw new Error(`Unknown Gmail account: "${account}". Valid: alec, properties`);
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('Gmail not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env');

  const acc = ACCOUNTS[key];
  if (!acc.refreshToken) throw new Error(`No refresh token for "${key}". Run: node scripts/gmail-oauth.js`);

  if (!_oauthClients.has(key)) {
    const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
    auth.setCredentials({ refresh_token: acc.refreshToken });
    _oauthClients.set(key, auth);
  }
  return _oauthClients.get(key);
}

function gmailClient(account) {
  const auth = getOAuthClient(account);
  return google.gmail({ version: 'v1', auth });
}

// ── Helpers ────────────────────────────────────────────────────────
function decodeBase64Url(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function parseEmailHeaders(headers = []) {
  const h = {};
  for (const { name, value } of headers) h[name.toLowerCase()] = value;
  return h;
}

function extractBody(payload) {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) return decodeBase64Url(part.body.data);
    }
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }
  return '';
}

function extractAttachments(payload, messageId) {
  const attachments = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.body) {
      attachments.push({
        filename:     part.filename,
        mimeType:     part.mimeType,
        size:         part.body.size,
        attachmentId: part.body.attachmentId,
        messageId,
      });
    }
    if (part.parts) part.parts.forEach(walk);
  }
  walk(payload);
  return attachments;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * List unread emails for an account.
 * @param {string} account — 'alec' or 'properties'
 * @param {number} limit   — max results (default 20)
 */
async function listUnreadEmails(account, limit = 20) {
  const gmail = gmailClient(account);
  const listResp = await gmail.users.messages.list({
    userId: 'me', q: 'is:unread', maxResults: limit,
  });

  const messages = listResp.data.messages || [];
  if (!messages.length) return [];

  const results = await Promise.all(
    messages.map(async ({ id }) => {
      const msg = await gmail.users.messages.get({
        userId: 'me', id, format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });
      const h = parseEmailHeaders(msg.data.payload?.headers);
      return {
        id,
        subject:     h.subject || '(no subject)',
        from:        h.from,
        date:        h.date,
        snippet:     msg.data.snippet,
        labels:      msg.data.labelIds || [],
        hasAttachment: (msg.data.payload?.parts || []).some(p => p.filename),
      };
    })
  );
  return results;
}

/**
 * Get full email content (body + attachments list) by message ID.
 */
async function getEmailById(account, id) {
  const gmail = gmailClient(account);
  const msg = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
  const h = parseEmailHeaders(msg.data.payload?.headers);
  const body = extractBody(msg.data.payload);
  const attachments = extractAttachments(msg.data.payload, id);
  return {
    id,
    subject:     h.subject || '(no subject)',
    from:        h.from,
    to:          h.to,
    date:        h.date,
    body:        body.slice(0, 5000),
    snippet:     msg.data.snippet,
    labels:      msg.data.labelIds || [],
    attachments,
    threadId:    msg.data.threadId,
  };
}

/**
 * Download an attachment's raw bytes.
 */
async function getAttachmentBytes(account, messageId, attachmentId) {
  const gmail = gmailClient(account);
  const resp = await gmail.users.messages.attachments.get({
    userId: 'me', messageId, id: attachmentId,
  });
  return Buffer.from(resp.data.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Triage an email using the local LLM (Qwen).
 * Returns { priority: 'URGENT'|'ACTION'|'FYI'|'SPAM', reason, suggestedLabel }
 */
async function triageEmail(account, email) {
  const llmBase  = process.env.LOCAL_LLM_BASE_URL || process.env.ALEC_OPENAI_BASE_URL || 'http://127.0.0.1:1234/v1';
  const llmModel = process.env.LOCAL_LLM_MODEL || 'default';

  const prompt = `You are A.L.E.C., Alec Rovner's AI secretary. Classify this email into exactly ONE category:
- URGENT: needs action TODAY (legal notices, deals closing, urgent tenant issues, payment failures)
- ACTION: needs action within a few days (applications, routine questions, maintenance requests, invoices)
- FYI: informational only (newsletters, confirmations, receipts, updates)
- SPAM: marketing, promotions, or irrelevant

From: ${email.from}
Subject: ${email.subject}
Preview: ${email.snippet || email.body?.slice(0, 300) || ''}

Respond with JSON only:
{"priority":"URGENT|ACTION|FYI|SPAM","reason":"one sentence","suggestedLabel":"string"}`;

  try {
    const resp = await fetch(`${llmBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llmModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) throw new Error(`LLM error: ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim() || '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        priority: ['URGENT', 'ACTION', 'FYI', 'SPAM'].includes(result.priority) ? result.priority : 'FYI',
        reason:   result.reason || '',
        suggestedLabel: result.suggestedLabel || result.priority,
      };
    }
  } catch (_) {
    // LLM unavailable — fall back to keyword heuristics
  }

  // Heuristic fallback
  const text = `${email.subject} ${email.from} ${email.snippet}`.toLowerCase();
  if (/urgent|immediately|overdue|eviction|court|legal|deadline|expir/.test(text)) {
    return { priority: 'URGENT', reason: 'Urgent keyword detected', suggestedLabel: 'URGENT' };
  }
  if (/invoice|application|maintenance|request|payment|rent/.test(text)) {
    return { priority: 'ACTION', reason: 'Action keyword detected', suggestedLabel: 'ACTION' };
  }
  if (/unsubscribe|promotion|offer|newsletter|marketing/.test(text)) {
    return { priority: 'SPAM', reason: 'Marketing keyword detected', suggestedLabel: 'SPAM' };
  }
  return { priority: 'FYI', reason: 'Default classification', suggestedLabel: 'FYI' };
}

/**
 * Archive an email (remove INBOX label, keep it accessible).
 */
async function archiveEmail(account, id) {
  const gmail = gmailClient(account);
  await gmail.users.messages.modify({
    userId: 'me', id,
    requestBody: { removeLabelIds: ['INBOX'] },
  });
  return { success: true, id, action: 'archived' };
}

/**
 * Apply a label to an email (creates label if it doesn't exist).
 */
async function labelEmail(account, id, labelName) {
  const gmail = gmailClient(account);
  const labelId = await getOrCreateLabel(gmail, labelName);
  await gmail.users.messages.modify({
    userId: 'me', id,
    requestBody: { addLabelIds: [labelId] },
  });
  return { success: true, id, label: labelName };
}

// Label cache to avoid repeated API calls
const _labelCache = new Map();
async function getOrCreateLabel(gmail, labelName) {
  const cacheKey = `${gmail._options?.auth?.credentials?.email || ''}:${labelName}`;
  if (_labelCache.has(cacheKey)) return _labelCache.get(cacheKey);

  const listResp = await gmail.users.labels.list({ userId: 'me' });
  const existing = (listResp.data.labels || []).find(l => l.name.toLowerCase() === labelName.toLowerCase());
  if (existing) {
    _labelCache.set(cacheKey, existing.id);
    return existing.id;
  }

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: { name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
  });
  _labelCache.set(cacheKey, created.data.id);
  return created.data.id;
}

/**
 * Reply to an email.
 */
async function replyToEmail(account, id, body) {
  const gmail = gmailClient(account);
  const original = await getEmailById(account, id);
  const h = { from: original.from, subject: original.subject, date: original.date };
  const acc = ACCOUNTS[account.toLowerCase()];

  const rawMessage = [
    `From: ${acc.email}`,
    `To: ${h.from}`,
    `Subject: Re: ${h.subject}`,
    `In-Reply-To: ${id}`,
    `References: ${id}`,
    `Content-Type: text/plain; charset=utf-8`,
    '',
    body,
  ].join('\r\n');

  const encoded = Buffer.from(rawMessage).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: encoded, threadId: original.threadId },
  });
  return { success: true, id, action: 'replied' };
}

/**
 * Move an email to a Gmail folder/label (Gmail uses labels as folders).
 * Creates the label if it doesn't exist.
 */
async function moveToFolder(account, id, folder) {
  const gmail = gmailClient(account);
  const labelId = await getOrCreateLabel(gmail, folder);
  await gmail.users.messages.modify({
    userId: 'me', id,
    requestBody: {
      addLabelIds: [labelId],
      removeLabelIds: ['INBOX'],
    },
  });
  return { success: true, id, folder };
}

/**
 * Permanently delete an email (moves to Trash first).
 */
async function deleteEmail(account, id) {
  const gmail = gmailClient(account);
  await gmail.users.messages.trash({ userId: 'me', id });
  return { success: true, id, action: 'trashed' };
}

// ── Status ─────────────────────────────────────────────────────────
async function status() {
  const configured = !!(CLIENT_ID && CLIENT_SECRET);
  if (!configured) {
    return { configured: false, hint: 'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET in .env, then run: node scripts/gmail-oauth.js' };
  }

  const results = {};
  for (const [key, acc] of Object.entries(ACCOUNTS)) {
    if (!acc.refreshToken) {
      results[key] = { configured: false, hint: `Run: node scripts/gmail-oauth.js (account: ${key})` };
      continue;
    }
    try {
      const gmail = gmailClient(key);
      const profile = await gmail.users.getProfile({ userId: 'me' });
      results[key] = { configured: true, email: profile.data.emailAddress, messagesTotal: profile.data.messagesTotal };
    } catch (err) {
      results[key] = { configured: false, error: err.message };
    }
  }
  return { configured, accounts: results };
}

module.exports = {
  listUnreadEmails, getEmailById, getAttachmentBytes,
  triageEmail, archiveEmail, labelEmail, replyToEmail,
  moveToFolder, deleteEmail,
  status, ACCOUNTS,
};

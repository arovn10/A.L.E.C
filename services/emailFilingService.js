/**
 * A.L.E.C. Email Filing Service
 *
 * Orchestrates the Inbox Zero + SharePoint filing workflow:
 *   1. Fetch unread Gmail messages (both accounts)
 *   2. Triage each email with the local LLM (URGENT / ACTION / FYI / SPAM)
 *   3. For URGENT → send iMessage alert immediately
 *   4. For ACTION → queue for daily briefing log
 *   5. For FYI    → auto-archive with classification label
 *   6. For SPAM   → trash
 *   7. Emails with attachments → detect document type, file to correct SharePoint library
 *
 * Called by taskScheduler.js every 15 minutes via:
 *   emailFiling.runInboxZero('alec')
 *   emailFiling.runInboxZero('properties')
 */

require('dotenv').config();
const path = require('path');
const fs   = require('fs');

// Lazy-load services to avoid circular dep issues and startup failures
function gmail()   { return require('./gmailService.js'); }
function msGraph() { return require('./microsoftGraphService.js'); }
function iMsg()    { return require('./iMessageService.js'); }
const filingRules  = require('../config/sharepointFilingRules.js');

// ── Daily briefing log ─────────────────────────────────────────────
const BRIEFING_FILE = path.join(__dirname, '../data/email-briefing.jsonl');
function logBriefing(entry) {
  try {
    fs.mkdirSync(path.dirname(BRIEFING_FILE), { recursive: true });
    fs.appendFileSync(BRIEFING_FILE, JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n');
  } catch (_) {}
}

// ── Site ID cache ─────────────────────────────────────────────────
const _siteCache = new Map();
async function getSiteId(siteName) {
  if (_siteCache.has(siteName)) return _siteCache.get(siteName);
  const id = await msGraph().getSiteIdByName(siteName);
  _siteCache.set(siteName, id);
  return id;
}

const _libraryCache = new Map();
async function getLibraryId(siteId, libraryName) {
  const key = `${siteId}:${libraryName}`;
  if (_libraryCache.has(key)) return _libraryCache.get(key);
  const id = await msGraph().getLibraryIdByName(siteId, libraryName);
  _libraryCache.set(key, id);
  return id;
}

// ── Attachment filing ─────────────────────────────────────────────

/**
 * Download an attachment and file it to the correct SharePoint library.
 * Returns { filed: true, site, library, folder, url } or { filed: false, reason }
 */
async function fileAttachment(account, attachment, emailSubject) {
  try {
    const rule = filingRules.matchRule(attachment.filename, emailSubject);
    if (!rule) return { filed: false, reason: 'No matching filing rule' };

    const bytes = await gmail().getAttachmentBytes(account, attachment.messageId, attachment.attachmentId);

    const siteId     = await getSiteId(rule.site);
    const libraryId  = await getLibraryId(siteId, rule.library);

    await msGraph().ensureSharePointFolder(siteId, libraryId, rule.folder);

    const result = await msGraph().uploadFileToSharePoint(
      siteId, libraryId, rule.folder,
      attachment.filename, bytes, attachment.mimeType
    );

    return {
      filed:   true,
      rule:    rule.name,
      site:    rule.site,
      library: rule.library,
      folder:  rule.folder,
      url:     result.url,
    };
  } catch (err) {
    return { filed: false, reason: err.message };
  }
}

// ── Per-email processing ──────────────────────────────────────────

async function processEmail(account, emailMeta) {
  const result = { id: emailMeta.id, subject: emailMeta.subject, from: emailMeta.from };

  try {
    // Triage the email
    const triage = await gmail().triageEmail(account, emailMeta);
    result.priority = triage.priority;
    result.reason   = triage.reason;

    const label = `ALEC/${triage.priority}`;

    switch (triage.priority) {
      case 'URGENT': {
        // Alert immediately via iMessage
        const msg = `📧 URGENT email from ${emailMeta.from}:\n"${emailMeta.subject}"\n${triage.reason}`;
        try { await iMsg().notifyOwner(msg, '🚨 Urgent Email'); } catch (_) {}
        await gmail().labelEmail(account, emailMeta.id, label);
        logBriefing({ account, priority: 'URGENT', subject: emailMeta.subject, from: emailMeta.from });
        result.action = 'labeled+alerted';
        break;
      }
      case 'ACTION': {
        await gmail().labelEmail(account, emailMeta.id, label);
        logBriefing({ account, priority: 'ACTION', subject: emailMeta.subject, from: emailMeta.from });
        result.action = 'labeled+queued';
        break;
      }
      case 'FYI': {
        await gmail().labelEmail(account, emailMeta.id, label);
        await gmail().archiveEmail(account, emailMeta.id);
        result.action = 'labeled+archived';
        break;
      }
      case 'SPAM': {
        await gmail().deleteEmail(account, emailMeta.id);
        result.action = 'deleted';
        break;
      }
    }

    // File attachments if any (skip SPAM)
    if (triage.priority !== 'SPAM' && emailMeta.hasAttachment) {
      const fullEmail = await gmail().getEmailById(account, emailMeta.id);
      const filingResults = [];

      for (const attachment of fullEmail.attachments) {
        if (!attachment.attachmentId) continue; // inline images have no attachmentId
        const fileResult = await fileAttachment(account, attachment, emailMeta.subject);
        filingResults.push({ filename: attachment.filename, ...fileResult });

        if (fileResult.filed) {
          const filedLabel = `ALEC/Filed/${fileResult.site}`;
          await gmail().labelEmail(account, emailMeta.id, filedLabel);
        }
      }

      if (filingResults.length) result.filingResults = filingResults;
    }

  } catch (err) {
    result.error = err.message;
  }

  return result;
}

// ── Main inbox zero run ───────────────────────────────────────────

/**
 * Run inbox zero for a Gmail account.
 * Fetches all unread emails, triages, and takes action.
 * Returns a summary string (logged by the scheduler).
 *
 * @param {string} account — 'alec' or 'properties'
 */
async function runInboxZero(account) {
  const gmailSvc = gmail();

  // Bail gracefully if Gmail not configured
  let statusCheck;
  try { statusCheck = await gmailSvc.status(); } catch { return 'Gmail not configured'; }
  if (!statusCheck.configured || !statusCheck.accounts?.[account]?.configured) {
    return `Gmail account "${account}" not configured`;
  }

  const emails = await gmailSvc.listUnreadEmails(account, 20);
  if (!emails.length) return `${account}: inbox clean`;

  const results = await Promise.allSettled(emails.map(e => processEmail(account, e)));

  const counts = { URGENT: 0, ACTION: 0, FYI: 0, SPAM: 0, error: 0, filed: 0 };
  for (const r of results) {
    if (r.status === 'rejected') { counts.error++; continue; }
    const v = r.value;
    if (v.priority) counts[v.priority] = (counts[v.priority] || 0) + 1;
    if (v.filingResults?.some(f => f.filed)) counts.filed++;
    if (v.error) counts.error++;
  }

  return `${account}: ${emails.length} emails — ${counts.URGENT} urgent, ${counts.ACTION} action, ${counts.FYI} FYI, ${counts.SPAM} spam, ${counts.filed} filed to SharePoint`;
}

/**
 * Read the current daily briefing queue (ACTION emails).
 */
function getBriefingQueue() {
  if (!fs.existsSync(BRIEFING_FILE)) return [];
  const today = new Date().toISOString().slice(0, 10);
  return fs.readFileSync(BRIEFING_FILE, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter(e => e.ts?.startsWith(today));
}

module.exports = { runInboxZero, fileAttachment, processEmail, getBriefingQueue };

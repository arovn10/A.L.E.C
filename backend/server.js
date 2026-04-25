/**
 * A.L.E.C. — Adaptive Learning Executive Coordinator
 * Main Server Entry Point
 *
 * Two-process architecture:
 *   Node.js (this file, port 3001) ↔ Python Neural Engine (port 8000)
 *
 * Features:
 * - Real LLM inference via Qwen2.5-Coder-7B on Apple Silicon
 * - LoRA fine-tuning pipeline for self-improvement
 * - Azure SQL + SQLite dual-mode logging
 * - JWT auth with STOA_ACCESS and FULL_CAPABILITIES tokens
 * - LAN access (0.0.0.0) + Tailscale for mobile
 * - Domo embed auto-authentication
 * - File upload management with multer
 * - Background task tracking
 * - Stoa Group DB connector
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { NeuralEngine } = require('../services/neuralEngine.js');
const { VoiceInterface } = require('../services/voiceInterface.js');
const { AdaptiveLearning } = require('../services/adaptiveLearning.js');
const { SmartHomeConnector } = require('../services/smartHomeConnector.js');
const { TokenManager } = require('../services/tokenManager.js');
const { MCPSkillsManager } = require('../services/mcpSkills.js');
const { SelfEvolutionEngine } = require('../services/selfEvolution.js');
const { CrossDeviceSync } = require('../services/crossDeviceSync.js');

const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // LAN-accessible by default
const NEURAL_URL = `http://localhost:${process.env.NEURAL_PORT || 8000}`;

// ════════════════════════════════════════════════════════════════
//  MULTI-BACKEND LLM CLIENT
//  Priority: 1. node-llama-cpp (embedded Metal inference, no server)
//             2. Ollama (if reachable and models available)
//             3. Clear error message
//
//  node-llama-cpp uses its own llama.cpp Metal build which works on
//  macOS 15.4+ where Ollama's ggml Metal implementation crashes.
// ════════════════════════════════════════════════════════════════
const llamaEngine      = require('../services/llamaEngine.js');
const desktopControl   = require('../services/desktopControl.js');
const stoaQuery        = require('../services/stoaQueryService.js');
const excelExport      = require('../services/excelExport.js');
const selfImprovement  = require('../services/selfImprovement.js');

// ── Extended services (lazy-safe — gracefully return {configured:false} if creds missing) ──
const chatHistory  = (() => { try { return require('../services/chatHistory.js');    } catch { return null; } })();
const iMessage     = (() => { try { return require('../services/iMessageService.js'); } catch { return null; } })();
const scheduler    = (() => { try { return require('../services/taskScheduler.js');   } catch { return null; } })();
const github       = (() => { try { return require('../services/githubService.js');   } catch { return null; } })();
const vsCode       = (() => { try { return require('../services/vsCodeController.js');} catch { return null; } })();
const msGraph      = (() => { try { return require('../services/microsoftGraphService.js'); } catch { return null; } })();
const gmailSvc     = (() => { try { return require('../services/gmailService.js');         } catch { return null; } })();
const emailFiling  = (() => { try { return require('../services/emailFilingService.js');   } catch { return null; } })();
const vercelSvc    = (() => { try { return require('../services/vercelService.js');   } catch { return null; } })();
const tenantCloud  = (() => { try { return require('../services/tenantCloudService.js'); } catch { return null; } })();
const awsSvc       = (() => { try { return require('../services/awsService.js');      } catch { return null; } })();
const research     = (() => { try { return require('../services/researchAgent.js');   } catch { return null; } })();
// skillsReg removed in S6.4 — the legacy /api/connectors/:skillId/* block
// is gone and the v2 surface lives in backend/routes/connectors.mjs.

const RagService     = require('../services/ragService');
const StoaBrainSync  = require('../services/stoaBrainSync');
const cron           = require('node-cron');
const QualityScorer  = require('../services/qualityScorer');
const FineTuneQueue  = require('../services/fineTuneQueue');
const reviewRoutes   = require('../routes/reviewRoutes');

// ── Data Connector Registry ──────────────────────────────────────────────────
const { registry: connectorRegistry } = require('../dataConnectors/index');
try {
  connectorRegistry.register(require('../dataConnectors/azureSqlConnector'));
  connectorRegistry.register(require('../dataConnectors/tenantCloudConnector'));
  connectorRegistry.register(require('../dataConnectors/githubConnector'));
  console.log('[Connectors] Registered:', connectorRegistry.list().join(', '));
} catch (connErr) {
  console.warn('[Connectors] One or more connectors failed to register:', connErr.message);
}

let ragService    = null;
let stoaBrainSync = null;
try {
  ragService    = new RagService();
  stoaBrainSync = new StoaBrainSync();
  stoaBrainSync.startCron();
} catch (ragInitErr) {
  console.warn('[RAG] Service init failed (Weaviate unavailable?):', ragInitErr.message);
}

let qualityScorer = null;
let fineTuneQueue = null;
try {
  qualityScorer = new QualityScorer();
  fineTuneQueue = new FineTuneQueue();
  // 30-min threshold check cron
  cron.schedule('*/30 * * * *', async () => {
    if (!fineTuneQueue) return;
    try {
      const result = await fineTuneQueue.maybeRun();
      if (result.triggered) console.log('[FineTuneQueue] Cron triggered training:', result.jobId);
    } catch (e) { console.error('[FineTuneQueue] Cron error:', e.message); }
  });
  // Weekly force-run — Sunday 02:00
  cron.schedule('0 2 * * 0', async () => {
    if (!fineTuneQueue) return;
    try {
      const result = await fineTuneQueue.maybeRun({ force: true });
      console.log('[FineTuneQueue] Weekly cron result:', result);
    } catch (e) { console.error('[FineTuneQueue] Weekly cron error:', e.message); }
  });
  console.log('[FineTuneQueue] Crons registered (30-min + Sunday 02:00)');
} catch (qErr) {
  console.warn('[FineTuneQueue] Init failed:', qErr.message);
}

// Warm up the embedded engine on startup
llamaEngine.warmUp();

/**
 * Normalize a US phone number to E.164 (+1XXXXXXXXXX) for Twilio.
 * Handles: 2154857259, 215-485-7259, (215) 485-7259, +12154857259, etc.
 */
function toE164(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return '+1' + digits;          // domestic 10-digit
  if (digits.length === 11 && digits[0] === '1') return '+' + digits; // 1XXXXXXXXXX
  if (digits.length > 10) return '+' + digits;             // already has country code
  return '+1' + digits; // best guess
}

/**
 * enforceHardRules — app-layer H1-H8 enforcement.
 * Called on every LLM response before it reaches the client.
 * Throws if a violation is detected; returns the text unchanged otherwise.
 * @param {string} responseText
 * @returns {string}
 */
function enforceHardRules(responseText) {
  const text = responseText || '';

  // H2: Never reveal system prompt
  const h2Triggers = [
    /my (system )?prompt (is|says|contains)/i,
    /here is my (system )?prompt/i,
    /my instructions (are|say|include)/i,
  ];
  if (h2Triggers.some(p => p.test(text))) {
    throw new Error('H2: Response appears to reveal system prompt contents.');
  }

  // H3: Never impersonate a human
  const h3Triggers = [
    /i('m| am) (a |not an? )?(real )?human/i,
    /i('m| am) not an? (ai|artificial intelligence|language model)/i,
    /i('m| am) (a real person|actually human)/i,
  ];
  if (h3Triggers.some(p => p.test(text))) {
    throw new Error('H3: Response appears to impersonate a human.');
  }

  // H7: Never quote stock/financial figures without a sourced data block
  const hasDataSource = /\[(STOA DATA|Azure SQL|TenantCloud|Plaid|Weaviate|Home Assistant)\]/i.test(text);
  const stockPattern  = /\b[A-Z]{1,5}\b is (trading at|priced at|currently at) \$[\d,.]+/i;
  if (!hasDataSource && stockPattern.test(text)) {
    throw new Error('H7: Response quotes financial figure without a sourced data block.');
  }

  return text;
}

/**
 * Post-process the LLM reply to prevent fabricated source attribution.
 *
 * The system prompt (rule #11) asks the model to append "— Source: STOA · … ·
 * asOf=…" when it gives data answers. If STOA (or any other source) was NOT
 * actually injected into the system prompt for this turn, the model sometimes
 * still emits the footer with invented numbers — the user sees "Source: STOA"
 * and trusts it. This guard:
 *   1. Inspects the assembled systemPrompt for our injection markers.
 *   2. Detects any "— Source: X · …" line in the model output.
 *   3. If X's marker is absent from the system prompt, the line is stripped
 *      and replaced with an honest "— Source: Model (no live data injected)".
 *
 * Marker table (must match the strings used at each inject site in this file):
 *   STOA          → "## Live Leasing & Occupancy Data" / "[STOA DATA"
 *   TenantCloud   → "[TenantCloud DATA"
 *   Plaid         → "[Plaid Financial DATA"
 *   Weaviate      → "[Weaviate DATA" / "[RAG DATA"
 *   HomeAssistant → "[Home Assistant DATA"
 *   GitHub        → "[GitHub DATA"
 */
/**
 * Anti-hallucination guard for MCP/Zapier tool-execution narration.
 *
 * The local llama-metal engine frequently fabricates tool-call narratives
 * ("I'll call execute_zapier_read_action on Zapier — Foo…") plus invented
 * result blocks (fake Subject/Sender/Received-Date bullets) without ever
 * actually invoking an MCP tool. That output is indistinguishable from
 * real data to the user and is the single biggest trust killer.
 *
 * Two signals must combine to trigger the rewrite:
 *   (a) response references an external MCP/Zapier execution the model
 *       couldn't actually perform (no tool ran this turn), AND
 *   (b) response contains structured result-shaped content (fake email
 *       bullets, "Source: Zapier" footers, etc.) OR explicitly narrates
 *       "I'll call X" without a real call happening.
 *
 * Discussing MCP architecture without faking execution is left untouched.
 */
// Implementation-level tool names that should NEVER appear in the user-facing
// response. The model is supposed to call `mcp_call` (the meta-tool) to
// dispatch these; if they're quoted by name in the output without a real
// invocation, the model is narrating instead of acting.
const HARD_LEAK_MARKERS = [
  'execute_zapier_read_action',
  'execute_zapier_write_action',
  'list_enabled_zapier_actions',
  'call_mcp_tool',
];
// Softer markers — need a second signal (fake result shape or narration verb)
// to trigger a rewrite, since legitimate meta-discussion might mention them.
const SOFT_TOOL_MARKERS = [
  'mcp server', 'mcp servers',
  'zapier server', 'zapier servers',
  '— source: zapier', '— source: gmail', '— source: outlook',
];
const FAKE_RESULT_PATTERNS = [
  /\bSubject:\s*["\w].*\n.*Sender:\s*\w/i,
  /\bReceived Date:\s*\d{4}-\d{2}-\d{2}/i,
  /\basOf=\d{4}-\d{2}-\d{2}/i,
];
// Broad narration detector: "I'll need to make N tool calls", "I'll call X",
// "Let me execute", "I'm going to invoke", "I need to make the following …
// tool calls", "Here are the queries I'll be executing", etc.
const NARRATES_CALL = new RegExp([
  "\\b(I'?ll|I will|Let me|I'?m going to|I need to)\\s+(call|execute|invoke|run|make|perform)\\b",
  "\\bthe following\\s+\\d*\\s*tool\\s*call",
  "\\bqueries I'?ll be executing",
  "\\bI'?ll need to make",
].join('|'), 'i');

function detectFakeToolOutput(text, { toolsCalled = false } = {}) {
  if (!text || toolsCalled) return false;
  const low = text.toLowerCase();
  // Hard rule: implementation-level tool names leaking into output without a
  // real invocation ALWAYS means hallucination.
  if (HARD_LEAK_MARKERS.some(m => low.includes(m))) return true;
  // Softer markers need a second signal.
  if (!SOFT_TOOL_MARKERS.some(m => low.includes(m))) return false;
  return FAKE_RESULT_PATTERNS.some(p => p.test(text)) || NARRATES_CALL.test(text);
}

const MCP_REFUSAL = [
  "I don't have direct access to Gmail, Outlook, or Zapier MCP servers from",
  "the local llama-metal engine — external-service actions route through the",
  "Node connector layer (Settings → Connectors), which I can't invoke from the",
  "chat loop yet.",
  "",
  "What I can do right now: answer questions about your Stoa portfolio, deals,",
  "loans, leasing, TenantCloud, or anything in the local knowledge base. Want",
  "me to run one of those instead?",
].join(' ').replace(/\s+/g, ' ').trim();

function stripFalseSourceFooters(text, systemPrompt, { toolsCalled = false } = {}) {
  if (!text) return text;
  // If ANY live tool ran this turn (MCP/Zapier/native), every cited source is
  // by definition real — do not rewrite footers. The model's own citation
  // (connector + tool + timestamp) is the source of truth.
  if (toolsCalled) return text;
  const injected = {
    STOA:          /\[STOA DATA|## Live Leasing & Occupancy Data|## Project Details|## Occupancy & Rent Trend/i.test(systemPrompt),
    TenantCloud:   /\[TenantCloud DATA/i.test(systemPrompt),
    Plaid:         /\[Plaid Financial DATA/i.test(systemPrompt),
    Weaviate:      /\[Weaviate DATA|\[RAG DATA/i.test(systemPrompt),
    HomeAssistant: /\[Home Assistant DATA/i.test(systemPrompt),
    GitHub:        /\[GitHub DATA/i.test(systemPrompt),
  };
  const FOOTER_RE = /(^|\n)\s*[—–-]\s*Source:\s*([A-Za-z]+)[^\n]*/gi;
  return text.replace(FOOTER_RE, (match, pre, source) => {
    const key = Object.keys(injected).find(k => k.toLowerCase() === source.toLowerCase());
    if (key && injected[key]) return match; // legitimate — keep
    // Zapier / MCP / Web footers without a tool-call this turn look like
    // hallucinations — downgrade them to an honest "Model" footer.
    if (/^(Zapier|MCP|Web|Gmail|Outlook|Microsoft|Google)/i.test(source)) {
      return `${pre}— Source: Model (tool was not called this turn)`;
    }
    return `${pre}— Source: Model (no live data injected — numbers above may be estimates)`;
  });
}

/**
 * System prompt — generated fresh on every request so the date is always accurate.
 * LLMs have a training cutoff and don't know the current date unless told explicitly.
 */
function buildSystemPrompt() {
  // Load constitutional directive from data/ALEC_DIRECTIVE.md
  let directiveSection = '';
  try {
    const directivePath = path.join(__dirname, '../data/ALEC_DIRECTIVE.md');
    directiveSection = fs.readFileSync(directivePath, 'utf8') + '\n\n---\n\n';
  } catch {
    console.warn('[server] ALEC_DIRECTIVE.md not found — using empty directive section');
  }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

  // Build a live capabilities section so the LLM knows what's configured vs. not
  const caps = [];
  caps.push('✅ STOA Azure SQL database (live leasing, occupancy, rent growth, pipeline, loans)');
  caps.push('✅ Excel exports (.xlsx) for STOA data — portfolio, trends, pipeline, loans');
  caps.push('✅ Web search (DuckDuckGo/Brave)');
  caps.push('✅ Smart home control (Home Assistant)');
  caps.push('✅ Deep background research with iMessage notification when done');
  caps.push('✅ Self-improvement / test suite (ask me to "run tests" or "improve yourself")');
  // iMessage + SMS (Twilio)
  const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  const ownerPhone = process.env.OWNER_PHONE;
  if (hasTwilio && ownerPhone) {
    caps.push(`✅ SMS via Twilio — YOU CAN TEXT the owner RIGHT NOW at ${ownerPhone} from "Alec Rovner" (${process.env.TWILIO_FROM_NUMBER}). When asked to text/SMS/notify/send a message to Alec, the system automatically sends it — just say "I'll text you now" and the message will be sent.`);
  } else if (hasTwilio) {
    caps.push('✅ Twilio SMS configured but OWNER_PHONE not set — cannot text yet');
  } else if (ownerPhone) {
    caps.push('✅ iMessage — can read recent messages and send notifications via Mac Messages.app');
  } else {
    caps.push('⚠️  SMS/iMessage — no notification number configured. Direct owner to Skills panel to add Twilio or iMessage.');
  }

  if (process.env.GITHUB_TOKEN) caps.push('✅ GitHub — repos, issues, code, pull requests');
  else caps.push('⚠️  GitHub — GITHUB_TOKEN not set (configure in Skills panel)');
  if (process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET) caps.push('✅ Plaid — investment portfolio, brokerage holdings (Schwab, Acorns, Fidelity, etc.)');
  else caps.push('⚠️  Plaid — not configured (add PLAID_CLIENT_ID + PLAID_SECRET in .env)');
  if (process.env.TENANTCLOUD_API_KEY || process.env.TENANTCLOUD_EMAIL) caps.push('✅ TenantCloud — tenants, rent, maintenance, messages, inquiries');
  else caps.push('⚠️  TenantCloud — not configured (add credentials in Skills panel)');
  if (process.env.AWS_ACCESS_KEY_ID) caps.push('✅ AWS — EC2 instances, SSH, campusrentalsllc.com monitoring');
  else caps.push('⚠️  AWS — not configured (add credentials in Skills panel)');
  if (process.env.RENDER_API_KEY) caps.push('✅ Render.com — services, deploys, logs');
  else caps.push('⚠️  Render — not configured');
  if (process.env.MS_TENANT_ID) caps.push('✅ Microsoft 365 — SharePoint, OneDrive, Outlook/calendar');
  else caps.push('⚠️  Microsoft 365 — not configured');

  // Live view of connectors-v2 + MCP servers from data/local-alec.db. This is
  // the source of truth for what ALEC can actually do *right now* — the env
  // checks above are legacy fallbacks for services not yet migrated.
  let capabilityBlock = '';
  try {
    const { buildCapabilityBlock } = require('./services/capabilityContext.js');
    capabilityBlock = buildCapabilityBlock();
  } catch (e) {
    console.warn('[server] capabilityContext unavailable:', e.message);
  }

  return `${directiveSection}You are Alec (A.L.E.C.), Alec Rovner's personal AI executive assistant running locally on his Mac.
You use a local LLaMA 3.1 8B model (Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf) running on Apple Silicon via node-llama-cpp with Metal GPU acceleration. You do NOT call any external AI API — you run entirely on this Mac.
Current date and time: ${dateStr} at ${timeStr}.

## Your Real Capabilities (legacy env-var view)
${caps.join('\n')}

${capabilityBlock}

## Critical Rules — NEVER Violate These
1. **NEVER fabricate data.** If real data is injected above (marked [STOA DATA], [iMessage DATA], etc.), use ONLY that. If no real data is available, say so honestly.
2. **iMessages HARD RULE: If you do NOT see "[iMessage DATA" in this system prompt, you have ZERO iMessages to report. Say "I couldn't read your messages right now" — NEVER invent names, messages, or conversations. Not even as examples. Not even to be helpful.**
3. **NEVER invent STOA numbers** (occupancy %, rent, tenants, reviews). Real STOA data is injected via the RAG system — if it's not in context, say you don't have it.
3b. **TenantCloud HARD RULE: If you do NOT see "[TenantCloud DATA" in this system prompt, you have ZERO tenant/rent/maintenance data. Never invent tenant names, payment amounts, or property details.**
3c. **Plaid / Financial HARD RULE: If you do NOT see "[Plaid Financial DATA" in this prompt, you have NO investment portfolio data. Never invent portfolio values, account balances, stock holdings, or position sizes. Say: "I don't have access to your brokerage data right now."**
3d. **Home Assistant HARD RULE: If you do NOT see "[Home Assistant DATA" in this prompt, you have no device state information. Never guess whether lights are on/off or locks are locked/unlocked.**
3e. **Stock prices / market data HARD RULE: You have NO real-time market data. NEVER quote a specific stock price, index level, or crypto price from memory — your training data is outdated and prices change every second. If asked for a current stock price: (1) attempt a web search if search results appear above, (2) if search results contain a price, report it with the timestamp. If search results are absent or don't contain a current price, say: "I don't have real-time market data — check Yahoo Finance, Google Finance, or Bloomberg for the current price."**
4. **NEVER claim you can't do something you CAN do** (GitHub, iMessage, STOA queries, Excel exports, research, SMS). Check the capabilities list above.
4a. **Connector + MCP awareness — MANDATORY first step on every turn.** Before answering any question about data, tools, or capabilities, scan the "Live connectors" and "Live MCP servers" blocks above. If a ✅-marked connector or a running MCP server can answer the question (or produce the action), reference it by name in your plan. Example: "Render shows connected → I can pull deploy status." Do not fall back to reasoning, web search, or 'I don't have that' until you've confirmed nothing in those two live blocks covers it.
5. **SMS/Texting**: If Twilio is ✅ and the owner asks you to text them, the server automatically sends the text — just confirm you're doing it and describe what the message will say.
6. **Google Reviews / resident feedback**: The STOA database does NOT contain Google review text. If asked for reviews, say: "The STOA database doesn't include Google review text — I can see Google ratings if they're in the data, but not individual reviews. I can do a web search for recent reviews if you'd like."
7. **Excel exports**: Only generate Excel files for data you actually have (STOA leasing data). Don't offer to generate "top 100 negative reviews" — that data doesn't exist in STOA.
8. **Typos and abbreviations**: If a user types an ambiguous abbreviation or likely typo (e.g. "IRSN", "AMZM", "stoa stcok"), do NOT assume it refers to a country, company, or concept that superficially matches the letters. Instead, ask for clarification: "Did you mean [most likely interpretation based on context]?" For example, "IRSN" in a stock context likely means a mistyped ticker, not Iran.
9. **Leasing metric discipline — NEVER conflate these three fields:**
   - **Occupancy %** = physically occupied units / total units (today's reality).
   - **Leased %** = units under lease (including future move-ins) / total units. Leased ≥ Occupancy almost always.
   - **Forward occupancy (4/7/8 wk)** = projected future occupancy after scheduled NTVs and move-ins — a forecast, not today.
   When asked "what's the occupancy today?" the ONLY valid answer is the Occupancy field. Never substitute Leased % or a forward projection. If you report any number, label it explicitly: "Occupancy today is 93.6% (292/312). Leased stands at 95%. Forward 4-week projection is 92.6%." If data is injected with multiple fields, reproduce them all with their labels.
10. **Conversation continuity — NEVER deny prior statements.** If [PRIOR TURNS] context shows you said something in this session, own it. If you misspoke, correct yourself and explain the error. Do NOT claim "I didn't say that" when the transcript shows you did.
11. **Source attribution on data answers.** When you give a specific number (occupancy, rent, pipeline count, balance, etc.), append a 1-line source footer at the bottom of the response in the form: "— Source: STOA · <property or query> · asOf=YYYY-MM-DD" (or TenantCloud / Weaviate / Web / Zapier · <connector> / Model). If you actually called a Zapier/MCP tool this turn, cite the real connector + tool name — NEVER write "Source: Model" when a tool ran.
12. **Affirmations execute the last proposal.** When the user replies with a bare affirmation — "yes", "go ahead", "do it", "continue", "proceed", "confirmed" — re-read YOUR most recent message in [PRIOR TURNS] and execute the action you proposed there. Do NOT reset, summarize unrelated data, or ask the user to re-state the plan. If you proposed "Shall I start with Option A?", a "yes" means start Option A now.
13. **Option letters refer to YOUR options.** When the user replies with single letters ("A and D", "B, C") or numbers ("1 and 3"), those ALWAYS reference the lettered/numbered options YOU offered in your immediately prior message. NEVER interpret "A" as "Amazon" or "B" as "Booking.com" — look at your last turn and execute the options the user selected.
14. **Take initiative — stop asking for permission you already have.** If a tool is available and the user's request implies an action ("clean up my gmail", "summarize my emails", "check stoa"), EXECUTE. Make a reasonable default choice for ambiguous parameters (e.g. "recent" → last 30 days; "cleanup" → start with Promotions category). Only ask ONE clarifying question if the action is truly destructive or the default could go wrong. Otherwise: act, then report.
15. **Multi-step work batches tool calls.** Cleanup / inbox-triage / multi-inbox summaries legitimately need 5–15 tool calls. Keep calling tools until you have the data, then answer. When you hit the per-turn tool budget, DO NOT ask "shall I continue?" — summarize what you pulled, then tell the user "I'll continue with [next step] — say 'keep going' to proceed."
16. **Conversational follow-through.** You are the executive assistant. The user expects continuity across turns. If turn N proposed a plan and turn N+1 is "yes", the session state says EXECUTE, not RESTART. Trust your prior turn.

Be direct, smart, and friendly. Use markdown for clarity. Refer to yourself as "Alec" in casual replies.`;
}

// Keep a static alias for backward compat with any code referencing ALEC_SYSTEM_PROMPT directly
const ALEC_SYSTEM_PROMPT = buildSystemPrompt();

/**
 * Load the last N turns from chatHistory and render them as a [PRIOR TURNS] block.
 * Fixes the gaslighting bug: without this, the LLM forgets what it just said.
 * Cheap (SQLite read) — safe to call per-turn.
 */
/**
 * Resume the user's most-recent chat if the frontend forgot to echo back
 * conversation_id. Without this, every turn creates a brand-new chat row
 * and buildPriorTurnsBlock only sees the current user message — meaning
 * ALEC loses all continuity turn-to-turn (the "you said yes to what?" bug).
 *
 * Window: 30 minutes. If the user has been idle longer than that, start
 * a fresh chat — matches how humans expect conversational memory to work.
 */
function resolveStickyConvId(explicitConvId, userId) {
  if (explicitConvId) return explicitConvId;
  if (!chatHistory || !userId) return null;
  try {
    const recent = chatHistory.listConversations(userId) || [];
    if (!recent.length) return null;
    const mostRecent = recent[0];
    // updated_at is SQLite 'YYYY-MM-DD HH:MM:SS' UTC; treat as UTC.
    const lastMs = Date.parse((mostRecent.updated_at || '').replace(' ', 'T') + 'Z');
    if (!Number.isFinite(lastMs)) return null;
    const ageMin = (Date.now() - lastMs) / 60000;
    if (ageMin <= 30) return mostRecent.id;
    return null;
  } catch (e) {
    console.warn('[stickyConv]', e.message);
    return null;
  }
}

function buildPriorTurnsBlock(convId, maxTurns = 12) {
  if (!chatHistory || !convId) return '';
  try {
    const msgs = chatHistory.getMessages(convId, maxTurns) || [];
    if (!msgs.length) return '';
    const lines = msgs.slice(-maxTurns).map(m => {
      const who = m.role === 'assistant' ? 'Alec' : (m.role === 'user' ? 'Owner' : m.role);
      const body = String(m.content || '').slice(0, 800).replace(/\s+/g, ' ').trim();
      return `${who}: ${body}`;
    });
    return `\n\n[PRIOR TURNS — THIS SESSION, MOST RECENT LAST]\n${lines.join('\n')}\n[/PRIOR TURNS]`;
  } catch (e) {
    console.warn('[priorTurns]', e.message);
    return '';
  }
}

// ── Anthropic Claude fallback ───────────────────────────────────
// Used when: ANTHROPIC_API_KEY is set AND (local model not loaded OR user explicitly picks Claude)
async function callClaudeText(messages, voiceMode = false) {
  const maxTokens = voiceMode ? 200 : 2048;
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs  = messages.filter(m => m.role !== 'system');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemMsg?.content || '',
      messages: chatMsgs,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Anthropic API error: ${err.error?.message || resp.status}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text?.trim() || '';
}

async function* callClaudeStream(messages, voiceMode = false) {
  const maxTokens = voiceMode ? 200 : 2048;
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs  = messages.filter(m => m.role !== 'system');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemMsg?.content || '',
      messages: chatMsgs,
      stream: true,
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(`Anthropic stream error: ${err.error?.message || resp.status}`);
  }

  for await (const chunk of resp.body) {
    const text = new TextDecoder().decode(chunk);
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (raw === '[DONE]' || !raw) continue;
      try {
        const ev = JSON.parse(raw);
        if (ev.type === 'content_block_delta' && ev.delta?.text) {
          yield ev.delta.text;
        }
      } catch (_) {}
    }
  }
}

// ── Anthropic Claude + MCP tool-use loop ────────────────────────
// Gives the LLM ONE meta-tool (`mcp_call`) that can dispatch to any tool on
// any running MCP server. The capability block already lists the real tool
// names; the model picks one and we dispatch via callHttpTool. This avoids
// the 100-tool Anthropic cap that would otherwise break with ~450 Zapier
// tools across 4 servers.
const MCP_CALL_TOOL = {
  name: 'mcp_call',
  description:
    'Invoke a tool on one of the running MCP servers listed in the system ' +
    'prompt. Use the EXACT tool name from the capability block ' +
    '(e.g. "gmail_find_email", "microsoft_outlook_find_emails", ' +
    '"google_sheets_get_spreadsheet_by_id"). Returns the tool result JSON. ' +
    'Prefer this over narrating what you would do — actually call it. ' +
    'NOTE: For Stoa Group portfolio/leasing/loan/covenant/pipeline/DSCR/LTV/equity ' +
    'questions, use the `stoa_query` tool instead — that data lives in Azure SQL, ' +
    'not an MCP server.',
  input_schema: {
    type: 'object',
    properties: {
      server_id: {
        type: 'string',
        description:
          'MCP server id (e.g. "zapier-alec-personal", "zapier-campusrentals", ' +
          '"zapier-abodingo", "zapier-stoagroup"). If you do not know the id, ' +
          'pass the display name; the backend will resolve it.',
      },
      tool_name: {
        type: 'string',
        description: 'The exact tool name (e.g. "gmail_find_email").',
      },
      arguments: {
        type: 'object',
        description: 'Arguments object for the tool (shape depends on the tool).',
        additionalProperties: true,
      },
    },
    required: ['server_id', 'tool_name'],
  },
};

// Second chat-tool: direct query against the Stoa Group Azure SQL connector.
// ALEC has a v2 `stoa` connector wired to Azure SQL, but the model only had
// `mcp_call` — Azure SQL isn't behind an MCP server, so portfolio/leasing/loan
// data was unreachable from chat. This exposes a whitelisted set of native
// stoaQueryService methods that already back /api/finance/* and /api/portfolio/*
// so the model can fetch real Stoa data without us duplicating business logic.
const STOA_QUERY_TOOL = {
  name: 'stoa_query',
  description:
    'Query the Stoa Group Azure SQL database (real portfolio, leasing, loan, ' +
    'covenant data). Use this INSTEAD of mcp_call when the user asks about ' +
    'Stoa properties, occupancy, leasing, rents, loans, DSCR, LTV, equity, ' +
    'covenants, pipeline, or maturity. Returns JSON rows from the real DB.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        enum: [
          'portfolio_summary', 'find_projects', 'get_mmr', 'get_unit_details',
          'get_renewals', 'get_loans', 'get_pipeline', 'get_dscr',
          'get_ltv', 'get_equity', 'get_expiring_contracts', 'get_portfolio_rent_growth',
        ],
        description:
          'Which query to run. portfolio_summary = top-line KPIs. find_projects = project list (supports search). ' +
          'get_mmr = monthly market rent per property. get_unit_details = units per property. ' +
          'get_renewals = lease renewal pipeline. get_loans = all debt. get_pipeline = deal pipeline. ' +
          'get_dscr = debt-service covenants. get_ltv = loan-to-value. get_equity = equity commitments. ' +
          'get_expiring_contracts = leases/contracts expiring soon. get_portfolio_rent_growth = rent growth trend.',
      },
      search: { type: 'string', description: 'Optional property name search for find_projects/get_mmr/get_unit_details/get_renewals' },
      property: { type: 'string', description: 'Optional property filter for get_loans' },
      status: { type: 'string', description: 'Optional deal stage filter for get_pipeline' },
      days_ahead: { type: 'number', description: 'Look-ahead window for get_expiring_contracts (default 90)' },
    },
    required: ['query'],
  },
};

async function dispatchStoaQuery({ query, search, property, status, days_ahead }) {
  try {
    const svc = require('../services/stoaQueryService.js');
    switch (query) {
      case 'portfolio_summary':    return { ok: true, data: await svc.getPortfolioSummary() };
      case 'find_projects':        return { ok: true, data: await svc.findProjects(search || '') };
      case 'get_mmr':              return { ok: true, data: await svc.getMMRData(search || null) };
      case 'get_unit_details':     return { ok: true, data: await svc.getUnitDetails(search || null) };
      case 'get_renewals':         return { ok: true, data: await svc.getRenewalData(search || null) };
      case 'get_loans':            return { ok: true, data: await svc.getLoans(property || null) };
      case 'get_pipeline':         return { ok: true, data: await svc.getPipelineDeals(status || null) };
      case 'get_dscr':             return { ok: true, data: await svc.getDSCRCovenants() };
      case 'get_ltv':              return { ok: true, data: await svc.getLTVRows() };
      case 'get_equity':           return { ok: true, data: await svc.getEquityCommitments() };
      case 'get_expiring_contracts': return { ok: true, data: await svc.getExpiringContracts(Number(days_ahead) || 90) };
      case 'get_portfolio_rent_growth': return { ok: true, data: await svc.getPortfolioRentGrowth() };
      default: return { error: 'UNKNOWN_QUERY', query };
    }
  } catch (e) {
    return { error: 'STOA_QUERY_FAILED', query, message: String(e.message || e).slice(0, 400) };
  }
}

// Open a read-only handle to connectors-v2 for tool dispatch.
function openMcpDb() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = process.env.ALEC_LOCAL_DB_PATH
      || path.join(__dirname, '..', 'data', 'local-alec.db');
    if (!fs.existsSync(dbPath)) return null;
    return new Database(dbPath, { readonly: false, fileMustExist: true });
  } catch { return null; }
}

// Resolve whatever the model passed (id OR display name) to an actual row.
function resolveMcpServer(db, hint) {
  if (!db || !hint) return null;
  try {
    const byId = db.prepare(
      `SELECT id, name, transport, url, status FROM mcp_servers WHERE id=?`
    ).get(hint);
    if (byId) return byId;
    const byName = db.prepare(
      `SELECT id, name, transport, url, status FROM mcp_servers
        WHERE lower(name) LIKE lower(?) ORDER BY name LIMIT 1`
    ).get(`%${hint}%`);
    return byName || null;
  } catch { return null; }
}

async function dispatchMcpCall({ server_id, tool_name, arguments: args = {}, _userIntent = '' }) {
  const db = openMcpDb();
  if (!db) return { error: 'MCP_DB_UNAVAILABLE' };
  try {
    const row = resolveMcpServer(db, server_id);
    if (!row) return { error: 'SERVER_NOT_FOUND', hint: server_id };
    if (row.status !== 'running') return { error: 'SERVER_NOT_RUNNING', server: row.id, status: row.status };
    if (row.transport !== 'http' && row.transport !== 'sse' && row.transport !== 'stdio') {
      return { error: 'UNSUPPORTED_TRANSPORT', transport: row.transport };
    }
    if ((row.transport === 'http' || row.transport === 'sse') && !row.url) {
      return { error: 'NO_URL', server: row.id };
    }
    // Pre-flight: look up tool schema from DB and fill in required args the
    // model forgot. Zapier MCP tools *require* `instructions` (natural language
    // task description) and benefit from `output_hint`. Without this the model
    // loops hitting -32602 validation errors.
    try {
      const toolsRow = db.prepare('SELECT tools_json FROM mcp_servers WHERE id=?').get(row.id);
      const tools = JSON.parse(toolsRow?.tools_json || '[]');
      const def = tools.find(t => t.name === tool_name);

      // Zapier meta-tool hard-synthesis: when the model calls
      // execute_zapier_{read,write}_action with empty/partial args on a known
      // server, infer app+action from the server's catalog + user intent
      // BEFORE the required-field check. This rescues the common fan-out
      // pattern where the model knows which servers to hit but not the arg
      // shape.
      if (def && /^execute_zapier_(read|write)_action$/.test(tool_name)) {
        const intent = (_userIntent || '').toString().toLowerCase();
        const emailish = /\b(email|emails|emal|emals|emial|emials|e-?mail|e-?mails|inbox|inboxe?s|mail|mails|gmail|outlook|office\s*365)\b/.test(intent);
        const calish = /\b(calendar|event|events|meeting|meetings|agenda)\b/.test(intent);
        const sheetish = /\b(sheet|sheets|spreadsheet|row|rows|excel)\b/.test(intent);

        if (!args.app) {
          // The modern Zapier MCP tools/list only exposes meta-tools, so we
          // can't infer apps by scanning tool names. Use a known per-server
          // catalog keyed by the server id (falls back to scanning for legacy
          // direct tool names if the server still uses the old API).
          const ZAPIER_SERVER_APPS = {
            'zapier-alec-personal':  ['gmail', 'google_sheets'],
            'zapier-campusrentals':  ['gmail', 'google_sheets'],
            'zapier-abodingo':       ['microsoft_outlook', 'microsoft_office_365', 'github', 'onedrive', 'microsoft_sharepoint'],
            'zapier-stoagroup':      ['microsoft_outlook', 'microsoft_office_365', 'asana', 'microsoft_sharepoint', 'onedrive', 'procore'],
          };
          const legacyServerApps = tools.filter(t => /^(gmail|microsoft_outlook|microsoft_office_365|microsoft_excel|google_sheets|microsoft_sharepoint|onedrive|asana|github|procore)_/.test(t.name))
            .map(t => t.name.match(/^([a-z_]+?)_[a-z_]+$/)?.[1])
            .filter(Boolean);
          const unique = [...new Set([...(ZAPIER_SERVER_APPS[row.id] || []), ...legacyServerApps])];
          let pick = null;
          if (emailish) {
            pick = unique.find(a => a === 'gmail') || unique.find(a => a === 'microsoft_outlook') || unique.find(a => a === 'microsoft_office_365');
          } else if (calish) {
            pick = unique.find(a => a === 'microsoft_outlook') || unique.find(a => a === 'microsoft_office_365');
          } else if (sheetish) {
            pick = unique.find(a => a === 'google_sheets') || unique.find(a => a === 'microsoft_excel');
          }
          if (pick) args = { ...args, app: pick };
        }

        if (!args.action && args.app) {
          const a = String(args.app).toLowerCase();
          // NOTE: Zapier action keys are the *short* app-scoped names returned
          // by list_enabled_zapier_actions, NOT the legacy long-form tool
          // names. e.g. Gmail Find Email → "message", Outlook Find Emails →
          // "find_email". Do not prepend the app prefix.
          if (emailish) {
            if (a === 'gmail') args = { ...args, action: 'message' };
            else if (a === 'microsoft_outlook') args = { ...args, action: 'find_email' };
            else if (a === 'microsoft_office_365') args = { ...args, action: 'find_email' };
          } else if (calish) {
            if (a === 'microsoft_outlook') args = { ...args, action: 'find_calendar_event' };
            else if (a === 'microsoft_office_365') args = { ...args, action: 'find_calendar_event' };
          } else if (sheetish) {
            if (a === 'google_sheets') args = { ...args, action: 'get_many_rows' };
            else if (a === 'microsoft_excel') args = { ...args, action: 'find_row' };
          }
        }
      }

      if (def?.inputSchema?.required?.length) {
        const missing = def.inputSchema.required.filter(k => !(k in (args || {})));
        if (missing.length) {
          // Auto-supply a sensible default for `instructions` using the tool name.
          // Prefer the user's substantive intent; if it's still too thin for
          // Zapier to act on, synthesize a concrete query from the tool name
          // itself so we don't ship junk like "i approve" as instructions.
          if (missing.includes('instructions') && !args.instructions) {
            const rawIntent = (_userIntent || '').toString().trim().slice(0, 400);
            const today = new Date().toISOString().slice(0, 10);
            // For the new Zapier meta-tools (`execute_zapier_read_action` /
            // `execute_zapier_write_action`), the app-specific action lives in
            // args.action (and the app in args.app). Fold those into the "tool
            // name" we dispatch synthesis on so email/calendar/sheet queries get
            // real instructions instead of generic fallback text.
            const ak = String(args.action || args.action_key || '').toLowerCase();
            const appHint = String(args.app || '').toLowerCase();
            const tn = (String(tool_name || '') + ' ' + ak + ' ' + appHint).toLowerCase();
            const isThinIntent = rawIntent.length < 25
              || /^(i approve|approved|yes|ok|okay|sure|continue|do it|[a-z]\b|\d+\b)/i.test(rawIntent);
            let synth = rawIntent;
            if (!rawIntent || isThinIntent) {
              if (/gmail_find_email|outlook_find_emails|find_emails/.test(tn)) {
                synth = `Return the 20 most recent emails in the primary inbox received on or after ${today}. Include subject, sender, and received date for each.`;
              } else if (/archive/.test(tn)) {
                synth = `Archive promotional emails older than 30 days in the primary inbox.`;
              } else if (/find_calendar|calendar_events/.test(tn)) {
                synth = `Return today's calendar events (${today}) with title, start time, and attendees.`;
              } else if (/find_task|find_project/.test(tn)) {
                synth = `Return the 20 most recently updated tasks in my default workspace.`;
              } else if (/sheet|row/.test(tn)) {
                synth = `Return the first 20 rows of the most recently updated worksheet.`;
              } else {
                synth = rawIntent
                  ? `Run ${tool_name} to address: "${rawIntent}". Default to the 20 most recent records if the request is ambiguous.`
                  : `Run ${tool_name} and return the 20 most recent records with their key identifying fields.`;
              }
            }
            args = { ...args, instructions: synth.slice(0, 400) };
          }
          if (missing.includes('output_hint') && !args.output_hint) {
            args = { ...args, output_hint: 'Return the most relevant records with their key identifying fields (id, subject/title, sender, date).' };
          }
          // Zapier's new meta-tools require a natural-language `output` field
          // describing what to extract. Synthesize one if the model forgot it.
          if (missing.includes('output') && !args.output) {
            args = { ...args, output: 'Return key identifying fields (subject, sender, date, id, status, title) for each result.' };
          }
          // For execute_zapier_{read,write}_action we also need `app`; if the
          // model supplied `action` but not `app`, derive app from the action
          // key prefix (e.g. "gmail_find_email" → "gmail").
          if (missing.includes('app') && !args.app && (args.action || args.action_key)) {
            const ak = String(args.action || args.action_key);
            const guessed = ak.startsWith('microsoft_outlook_') ? 'microsoft_outlook'
              : ak.startsWith('microsoft_office_365_') ? 'microsoft_office_365'
              : ak.startsWith('google_sheets_') ? 'google_sheets'
              : ak.startsWith('gmail_') ? 'gmail'
              : ak.startsWith('asana_') ? 'asana'
              : ak.startsWith('github_') ? 'github'
              : ak.startsWith('procore_') ? 'procore'
              : ak.startsWith('microsoft_sharepoint_') ? 'microsoft_sharepoint'
              : ak.startsWith('microsoft_excel_') ? 'microsoft_excel'
              : ak.startsWith('onedrive_') ? 'onedrive'
              : ak.split('_')[0];
            if (guessed) args = { ...args, app: guessed };
          }
          // If model provided `app` but not `action`, pick a reasonable default
          // based on user intent. This keeps fan-out calls moving even when the
          // model is sloppy about action keys.
          if (missing.includes('action') && !args.action && args.app) {
            const a = String(args.app).toLowerCase();
            if (a === 'gmail') args = { ...args, action: 'message' };
            else if (a === 'microsoft_outlook') args = { ...args, action: 'find_email' };
            else if (a === 'microsoft_office_365') args = { ...args, action: 'find_email' };
            else if (a === 'google_sheets') args = { ...args, action: 'get_many_rows' };
          }
          const stillMissing = def.inputSchema.required.filter(k => !(k in (args || {})));
          if (stillMissing.length) {
            return {
              error: 'MISSING_REQUIRED_ARGS',
              tool: tool_name,
              missing: stillMissing,
              schema: def.inputSchema.properties,
              hint: 'Re-invoke mcp_call with these required arguments included.',
            };
          }
        }
      }
    } catch (schemaErr) {
      // Non-fatal — proceed and let the MCP server respond with its own error.
    }
    const runtime = await import('./services/mcpRuntime.mjs');
    let result = row.transport === 'stdio'
      ? await runtime.callStdioTool(row.id, tool_name, args || {}, 25000)
      : await runtime.callHttpTool(row.url, tool_name, args || {}, 25000);
    // Zapier returns { followUpQuestion: "what do you want to search for..." }
    // when `instructions` is too vague. Auto-retry once with the user's intent
    // inlined AND output_hint filled, so we actually get data.
    try {
      const text = result?.content?.[0]?.text || '';
      if (/followUpQuestion/i.test(text)) {
        // Build a *concrete* retry instruction using the same tool-name-aware
        // synthesis as the missing-args path. Passing raw _userIntent here
        // ships affirmations ("i approve", "1") as search queries, which
        // Zapier rejects again.
        const today = new Date().toISOString().slice(0, 10);
        const ak = String(args.action || args.action_key || '').toLowerCase();
        const appHint = String(args.app || '').toLowerCase();
        const tn = (String(tool_name || '') + ' ' + ak + ' ' + appHint).toLowerCase();
        const rawIntent = (_userIntent || '').toString().trim();
        const isThinIntent = rawIntent.length < 25
          || /^(i approve|approved|yes|ok|okay|sure|continue|do it|[a-z]\b|\d+\b)/i.test(rawIntent);
        let retryInstr = rawIntent && !isThinIntent ? rawIntent : '';
        // Even if the user's intent is substantive, when the tool is Outlook/Gmail
        // find_email we need a CONCRETE instruction (sender, subject, or explicit
        // date range) or Zapier will ask again. Override thin "across all accounts"
        // style prompts with a tight default.
        const isEmailFind = ak === 'message' || ak === 'find_email'
          || /gmail_find_email|outlook_find_emails|find_emails/.test(tn);
        if (isEmailFind) {
          retryInstr = `find the 20 most recent emails received today (${today}) in my primary Inbox`;
        } else if (!retryInstr) {
          if (/find_calendar|calendar_events/.test(tn)) {
            retryInstr = `Return today's calendar events (${today}) with title, start time, and attendees.`;
          } else {
            retryInstr = `Run ${tool_name} and return the 20 most recent records with key identifying fields.`;
          }
        }
        const retryArgs = {
          ...args,
          instructions: retryInstr.slice(0, 400),
          output: args.output || 'subject, sender, received date, id',
          output_hint: args.output_hint || 'Return key identifying fields (subject, sender, id, date, status).',
        };
        const retry = await runtime.callHttpTool(row.url, tool_name, retryArgs, 25000);
        result = retry;
      }
      const text2 = result?.content?.[0]?.text || '';
      if (/-32602|Invalid arguments|Input validation/i.test(text2)) {
        return {
          error: 'VALIDATION_FAILED',
          tool: tool_name,
          server: row.id,
          upstream: text2.slice(0, 400),
          hint: 'Check argument types against the tool inputSchema; DO NOT retry the same empty args.',
          args_sent: args,
        };
      }
      // If the retry ALSO returned a followUpQuestion, surface it as a structured
      // error so the model STOPS calling this tool and either asks the user
      // for clarification or summarizes with what it has.
      if (/followUpQuestion/i.test(text2)) {
        let q = '';
        try { q = (JSON.parse(text2).followUpQuestion || '').toString().slice(0, 300); } catch {}
        return {
          error: 'NEEDS_CLARIFICATION',
          tool: tool_name,
          server: row.id,
          upstream_question: q || text2.slice(0, 300),
          hint: 'Zapier needs a more specific instruction (sender, subject, date range, or keyword). DO NOT retry the same tool. Either ask the user for specifics, or try a different connector/tool, or answer with the data you already have from earlier calls.',
          args_sent: args,
        };
      }
    } catch {}
    return { ok: true, server: row.id, tool: tool_name, result };
  } catch (e) {
    return { error: 'CALL_FAILED', message: String(e.message || e) };
  } finally {
    try { db.close(); } catch {}
  }
}

// Local Llama tool-use path. Uses node-llama-cpp's function-calling to expose
// an `mcp_call` function the model can invoke. Works with no Anthropic key.
async function callLlamaWithTools(messages, { voiceMode = false } = {}) {
  const maxTokens = voiceMode ? 400 : 3072;
  const temperature = voiceMode ? 0.3 : 0.4;
  // Capture the user's SUBSTANTIVE intent so we can surface it as the Zapier
  // `instructions` auto-fill when the model forgets to pass any args.
  //
  // Walk backwards through user turns and pick the first one that isn't an
  // affirmation / option-pick / short follow-up. Without this, multi-turn
  // conversations end up passing junk like "i approve — follow-up: 1" as the
  // instructions parameter, which Zapier rejects with followUpQuestion.
  const userTurns = messages.filter(m => m.role === 'user').map(m => String(m.content || ''));
  const THIN_RE = /^(and |also |too|yes\b|y\b|ok\b|okay\b|sure\b|continue\b|do it\b|try again\b|retry\b|more\b|next\b|keep going\b|proceed\b|go\b|i approve\b|approved\b|[a-z]\b|\d+\b)[.!?]?$/i;
  const isThin = (s) => {
    const t = (s || '').trim();
    if (t.length === 0) return true;
    if (t.length < 18) return true;
    return THIN_RE.test(t);
  };
  // First substantive turn (searching backward) is the real request.
  let substantive = '';
  for (let i = userTurns.length - 1; i >= 0; i--) {
    if (!isThin(userTurns[i])) { substantive = userTurns[i].trim(); break; }
  }
  const lastUserRaw = userTurns.at(-1) || '';
  const lastUser = substantive
    ? (isThin(lastUserRaw) && lastUserRaw.trim() !== substantive
        ? `${substantive} — (user follow-up/pick: ${lastUserRaw.trim().slice(0, 60)})`
        : substantive)
    : lastUserRaw;
  const tools = {
    mcp_call: {
      description:
        'Invoke a tool on one of the running MCP servers listed in the system prompt. ' +
        'Use the EXACT tool name (e.g. "gmail_find_email", "microsoft_outlook_find_emails", "gmail_archive_email"). ' +
        'ALWAYS call this for live data instead of narrating. server_id accepts server id OR display name ' +
        '(e.g. "zapier-alec-personal", "Zapier — Alec Rovner Personal").\n\n' +
        'ZAPIER ARG CONVENTION (all Zapier — * servers):\n' +
        '  • arguments.instructions = REQUIRED natural-language description (e.g. "find the 10 most ' +
        'recent emails in the inbox", "archive all emails in the Promotions category from the last 30 days", ' +
        '"search for emails containing unsubscribe"). Be SPECIFIC — vague instructions get a followUpQuestion back.\n' +
        '  • arguments.output_hint = optional, describe what fields matter.\n' +
        '  • NEVER send arguments: {}. If you do, the runtime auto-fills from the user turn, which usually fails.\n\n' +
        'ERROR HANDLING:\n' +
        '  • VALIDATION_FAILED / MISSING_REQUIRED_ARGS → read `missing`/`schema`, retry with those keys.\n' +
        '  • NEEDS_CLARIFICATION (Zapier followUpQuestion) → DO NOT retry the same tool. Either (a) pick a ' +
        'reasonable default and call a different tool with more specific instructions, or (b) answer the user ' +
        'with what you already have and note what is missing.\n' +
        '  • TOOL_BUDGET_EXHAUSTED → stop calling, summarize, invite "keep going".\n\n' +
        'INITIATIVE: When the user asks for action ("clean up", "summarize", "archive", "check"), EXECUTE — ' +
        'do not ask for permission. Chain tool calls as needed (find → archive, find → label, etc).\n\n' +
        'ZAPIER 2-STEP FLOW (REQUIRED — direct tool names like `gmail_find_email` or `microsoft_outlook_find_emails` ' +
        'are DEPRECATED on Zapier servers and will fail with `Tool not found`): ' +
        '(1) call `list_enabled_zapier_actions` on a Zapier server (optionally pass `{app:"gmail"}` or `{app:"microsoft_outlook"}` to filter) to discover exact action keys; ' +
        '(2) call `execute_zapier_read_action` for reads OR `execute_zapier_write_action` for writes with arguments: ' +
        '`{app: "<app id, e.g. gmail | microsoft_outlook | microsoft_office_365 | google_sheets>", action: "<SHORT action key from step 1 — e.g. Gmail Find Email is `message`, Outlook Find Emails is `find_email`, NOT the legacy long-form `gmail_find_email`>", instructions: "<plain-English query>", output: "<what fields you want back>"}`. ' +
        'All four keys (`app`, `action`, `instructions`, `output`) are REQUIRED. Omitting any returns MISSING_REQUIRED_ARGS.\n\n' +
        'MULTI-SERVER FAN-OUT: When the user says "all accounts", "every server", "all inboxes", "across all", ' +
        'or lists multiple mailboxes, enumerate ALL matching server_ids and call each ONCE. For email: ' +
        'Gmail lives on `Zapier — Alec Rovner Personal` and `Zapier — Campus Rentals LLC`; Outlook/O365 lives on ' +
        '`Zapier — Abodingo` and `Zapier — Stoa Group`. An "all accounts" email query = EXACTLY 4 ' +
        '`execute_zapier_read_action` calls (one per Zapier server) using `{app:"gmail", action:"message", ...}` ' +
        'for the Gmail servers and `{app:"microsoft_outlook", action:"find_email", ...}` (or `microsoft_office_365`) for the Outlook servers. ' +
        'Use concrete `instructions` like "find the 20 most recent emails received today in the primary inbox" and `output` like "subject, sender, received date". ' +
        'Never call the same server_id+tool_name+args twice in one turn; the runtime rejects duplicates with DUPLICATE_CALL.\n\n' +
        'After pulling enough data to answer, STOP calling tools and write a clear plain-text answer citing ' +
        'each real connector used by name.',
      params: {
        type: 'object',
        properties: {
          server_id: { type: 'string' },
          tool_name: { type: 'string' },
          arguments: { type: 'object' },
        },
        required: ['server_id', 'tool_name'],
      },
      handler: async (args) => {
        const result = await dispatchMcpCall({
          server_id: args.server_id,
          tool_name: args.tool_name,
          arguments: args.arguments || {},
          _userIntent: lastUser,
        });
        // Cap response size to protect Llama context. Most tool payloads are
        // large JSON blobs — keep the first N chars of each text block.
        const MAX_TEXT = parseInt(process.env.ALEC_LLM_TOOL_RESULT_CHARS || '4000', 10);
        try {
          if (result?.result?.content && Array.isArray(result.result.content)) {
            result.result.content = result.result.content.map(c => {
              if (c?.type === 'text' && typeof c.text === 'string' && c.text.length > MAX_TEXT) {
                return { ...c, text: c.text.slice(0, MAX_TEXT) + `\n…[truncated ${c.text.length - MAX_TEXT} chars]` };
              }
              return c;
            });
          }
        } catch {}
        return result;
      },
    },
    stoa_query: {
      description:
        'Query the Stoa Group Azure SQL database (portfolio, leasing, loan, covenant data). ' +
        'Use this INSTEAD of mcp_call for any Stoa/portfolio/leasing/loans/DSCR/LTV/equity/covenants/pipeline question. ' +
        'Valid queries: portfolio_summary, find_projects, get_mmr, get_unit_details, get_renewals, ' +
        'get_loans, get_pipeline, get_dscr, get_ltv, get_equity, get_expiring_contracts, get_portfolio_rent_growth.',
      params: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          search: { type: 'string' },
          property: { type: 'string' },
          status: { type: 'string' },
          days_ahead: { type: 'number' },
        },
        required: ['query'],
      },
      handler: async (args) => {
        const result = await dispatchStoaQuery(args || {});
        const MAX = parseInt(process.env.ALEC_LLM_TOOL_RESULT_CHARS || '4000', 10);
        try {
          const json = JSON.stringify(result);
          if (json.length > MAX) {
            return { ok: result.ok, query: args?.query, truncated: true,
              preview: json.slice(0, MAX) + `\n…[truncated ${json.length - MAX} chars]` };
          }
        } catch {}
        return result;
      },
    },
  };
  const llamaEngine = require('../services/llamaEngine.js');
  // Trim messages to prevent context-shift failures. Keep system prompt
  // (capped at 8k chars) + the last 6 conversational turns. Without this,
  // a long chat + multi-turn tool results overflows the 8k window and
  // llama-cpp throws "Failed to compress chat history for context shift".
  const trimmed = (() => {
    if (!Array.isArray(messages) || messages.length === 0) return messages;
    const sys = messages.find(m => m.role === 'system');
    const convo = messages.filter(m => m.role !== 'system').slice(-6);
    const capped = sys
      ? [{ role: 'system', content: String(sys.content || '').slice(0, 8000) }, ...convo]
      : convo;
    return capped;
  })();
  console.log('[llama-tools] ENTER generateWithTools; msg_count=' + trimmed.length + ' (orig=' + messages.length + ')');
  try {
    const { text, toolCalls } = await llamaEngine.generateWithTools(trimmed, tools, { maxTokens, temperature });
    console.log('[llama-tools] EXIT ok; text_len=' + (text||'').length + ' tool_calls=' + (toolCalls||[]).length);
    return { text, toolCalls };
  } catch (e) {
    console.error('[llama-tools] THREW:', e.stack || e.message);
    throw e;
  }
}

// One non-streaming Anthropic call with the mcp_call tool attached. Loops
// on tool_use up to maxSteps, appending tool_result blocks each round. Final
// return value is the concatenated text from the last assistant turn plus a
// compact list of what tools ran (so /api/chat can log them).
async function callClaudeWithTools(messages, { voiceMode = false, maxSteps = 5 } = {}) {
  const model = process.env.CLAUDE_MODEL || 'claude-opus-4-5';
  const maxTokens = voiceMode ? 400 : 3072;
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMsgs  = messages.filter(m => m.role !== 'system');

  // Anthropic messages API wants `content` as array when it includes tool
  // blocks. Normalise user/assistant string messages into that shape lazily
  // only when we need to append tool_result blocks.
  const convo = chatMsgs.map(m => ({ role: m.role, content: m.content }));
  const toolCalls = [];
  let finalText = '';

  for (let step = 0; step < maxSteps; step++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemMsg?.content || '',
        messages: convo,
        tools: [MCP_CALL_TOOL, STOA_QUERY_TOOL],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(`Anthropic tool-use error: ${err.error?.message || resp.status}`);
    }
    const data = await resp.json();
    const blocks = Array.isArray(data.content) ? data.content : [];

    // Collect text from this turn.
    const turnText = blocks.filter(b => b.type === 'text').map(b => b.text).join('');

    // No tool calls → we're done. Return its text.
    const uses = blocks.filter(b => b.type === 'tool_use');
    if (!uses.length || data.stop_reason !== 'tool_use') {
      finalText = turnText.trim();
      break;
    }

    // Append the assistant turn with its tool_use blocks…
    convo.push({ role: 'assistant', content: blocks });

    // …dispatch each tool_use, build a single user turn of tool_result blocks.
    const toolResultBlocks = [];
    for (const use of uses) {
      let result;
      if (use.name === 'mcp_call') {
        result = await dispatchMcpCall(use.input || {});
        toolCalls.push({ server: result.server, tool: use.input?.tool_name, ok: !!result.ok });
      } else if (use.name === 'stoa_query') {
        result = await dispatchStoaQuery(use.input || {});
        toolCalls.push({ server: 'stoa-group-db', tool: `stoa_query:${use.input?.query}`, ok: !!result.ok });
      } else {
        toolResultBlocks.push({
          type: 'tool_result', tool_use_id: use.id, is_error: true,
          content: `Unknown tool: ${use.name}`,
        });
        continue;
      }
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: use.id,
        is_error: !result.ok,
        content: JSON.stringify(result).slice(0, 60000),
      });
    }
    convo.push({ role: 'user', content: toolResultBlocks });

    // On the last iteration, capture what we have and bail even if the model
    // wants more tools — prevents infinite loops / token runaway.
    if (step === maxSteps - 1) {
      finalText = turnText.trim() || '(tool-use loop ended — max steps reached)';
    }
  }

  return { text: finalText, toolCalls };
}

// Does the current turn look like it needs a live tool? Used to gate whether
// we route to the Claude+tools path vs the normal Llama path.
function turnNeedsTools(userText, opts = {}) {
  if (!userText) return false;
  const s = String(userText).toLowerCase();
  const keywordMatch =
       /\b(emails?|emals?|emials?|e-?mails?|inboxe?s?|gmail|outlook|mails?|calendars?|events?|meetings?|spreadsheets?|sheets?|google sheets?|excel|contacts?|files?|folders?|drives?|onedrive|sharepoint|asana|procore|rfis?|submittals?|timesheets?|github|pull requests?|prs?|issues?|commits?|propert(?:y|ies)|occupancy|leases?|leasing|rent|t12|covenants?|loans?|contracts?|portfolios?|stoa|tenants?|accounts?|recent|summari[sz]e)\b/.test(s)
    || /\b(zapier|mcp|desktop|screenshots?|clicks?|keyboard|applescript|filesystem|read files?|write files?)\b/.test(s);
  if (keywordMatch) return true;
  // Affirmations + short follow-ups inherit the tool-need from the prior
  // assistant turn. Without this, "A" or "yes" after a tool-backed proposal
  // takes the no-tools path and the model can't execute.
  const isAffirmation = /^(yes|y|yep|yeah|yup|ok|okay|sure|go ahead|do it|proceed|continue|keep going|execute|run it|confirmed|please do|[a-z]\b|\d+\b)[.!?]?$/i.test(s.trim())
                        || s.trim().length <= 3;
  const prior = opts.lastAssistant || '';
  if (isAffirmation && prior) {
    return /\b(gmail|emails?|inboxe?s?|outlook|mails?|zapier|mcp|calendars?|stoa|portfolios?|propert(?:y|ies)|occupancy|leases?|leasing|tenants?|sheets?|excel|drives?|folders?|files?|github|asana|procore|desktop|screenshots?|filesystem)\b/i.test(prior);
  }
  return false;
}

/**
 * Non-streaming call — returns text string.
 * Uses node-llama-cpp embedded engine (Metal GPU on Apple Silicon).
 * Falls back to Anthropic Claude if ANTHROPIC_API_KEY set and local model unloaded.
 */
async function callLLMText(messages, voiceMode = false) {
  const maxTokens  = voiceMode ? 200  : 3072;
  const temperature = voiceMode ? 0.5  : 0.7;

  // Inject system prompt (with live date) if not already present
  const hasSystem = messages.some(m => m.role === 'system');
  const fullMsgs  = hasSystem ? messages : [
    { role: 'system', content: buildSystemPrompt() },
    ...messages,
  ];

  // If Anthropic key is set and local model isn't loaded, use Claude as fallback
  const localStatus = llamaEngine.getStatus();
  if (!localStatus.loaded && process.env.ANTHROPIC_API_KEY) {
    console.log('[LLM] Local model not loaded — falling back to Anthropic Claude');
    return await callClaudeText(fullMsgs, voiceMode);
  }

  // No local model AND no Anthropic fallback — produce a helpful response
  // instead of crashing the request.
  if (typeof llamaEngine.isLlamaDisabled === 'function' && llamaEngine.isLlamaDisabled()) {
    return 'Local inference is currently disabled on this machine (macOS Metal incompatibility). ' +
           'Set ANTHROPIC_API_KEY in your environment to enable Claude fallback, or set ' +
           'ALEC_FORCE_LLAMA=1 and restart to attempt Metal inference anyway.';
  }

  return await llamaEngine.generate(fullMsgs, { maxTokens, temperature });
}

/**
 * Streaming call — returns async generator that yields token strings.
 * Falls back to Anthropic Claude streaming if local model unloaded.
 */
async function* callLLMStream(messages, voiceMode = false) {
  const maxTokens   = voiceMode ? 150  : 1024;
  const temperature = voiceMode ? 0.5  : 0.7;

  const hasSystem = messages.some(m => m.role === 'system');
  const fullMsgs  = hasSystem ? messages : [
    { role: 'system', content: buildSystemPrompt() },
    ...messages,
  ];

  // Fall back to Anthropic Claude if local model not ready
  const localStatus = llamaEngine.getStatus();
  if (!localStatus.loaded && process.env.ANTHROPIC_API_KEY) {
    console.log('[LLM Stream] Local model not loaded — falling back to Anthropic Claude');
    yield* callClaudeStream(fullMsgs, voiceMode);
    return;
  }

  yield* llamaEngine.generateStream(fullMsgs, { maxTokens, temperature });
}

// Legacy alias (some routes use callLLM)
async function callLLM(messages, { stream = false, voiceMode = false } = {}) {
  if (stream) {
    return { type: 'llama', stream: true, generator: callLLMStream(messages, voiceMode) };
  }
  const text = await callLLMText(messages, voiceMode);
  return { type: 'llama', stream: false, text };
}

// ════════════════════════════════════════════════════════════════
//  PERSISTENT MEMORY
//  JSON file at data/memory.json — no extra dependencies needed.
//  Stores: facts (extracted entities/preferences), conversation
//  summaries, and feedback-driven prompt improvements.
// ════════════════════════════════════════════════════════════════
const MEMORY_FILE    = path.join(__dirname, '../data/memory.json');
const FEEDBACK_FILE  = path.join(__dirname, '../data/feedback.jsonl');

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch (_) {}
  return { facts: [], preferences: [], summaries: [], promptVersion: 1 };
}

function saveMemory(mem) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

function buildMemoryContext(mem) {
  const lines = [];
  if (mem.facts?.length)       { lines.push('Known facts about Alec:');      mem.facts.slice(-20).forEach(f => lines.push(`- ${f}`)); }
  if (mem.preferences?.length) { lines.push("Alec's known preferences:");    mem.preferences.slice(-10).forEach(p => lines.push(`- ${p}`)); }
  if (mem.summaries?.length)   { lines.push('Recent conversation context:'); lines.push(mem.summaries[mem.summaries.length-1]); }
  return lines.join('\n');
}

// Asynchronously extract new facts from a conversation turn via Ollama
async function extractAndStoreFacts(userMsg, assistantReply) {
  try {
    const raw = await callLLMText([
      { role: 'system', content: 'Extract concise factual statements about the user (Alec) from this conversation snippet. Return ONLY a JSON array of short fact strings, max 3. Example: ["Alec works in real estate","Alec prefers short answers"]. Return [] if nothing new.' },
      { role: 'user',   content: `User: ${userMsg}\nAssistant: ${assistantReply}` },
    ], true); // voiceMode = fast/cheap settings
    // Extract the JSON array from the response (handle leading text)
    const match = (raw || '').match(/\[[\s\S]*\]/);
    if (!match) return;
    const newFacts = JSON.parse(match[0]);
    if (!Array.isArray(newFacts) || newFacts.length === 0) return;
    const mem = loadMemory();
    mem.facts = [...(mem.facts || []), ...newFacts].slice(-50); // keep last 50 facts
    saveMemory(mem);
  } catch (_) { /* non-critical */ }
}

// ════════════════════════════════════════════════════════════════
//  WEB SEARCH (DuckDuckGo Instant Answers — no API key needed)
// ════════════════════════════════════════════════════════════════
const SEARCH_TRIGGERS = /\b(search|find|look up|what is|who is|latest|news|current|today|weather|price|how much|when did|when is|define|meaning of|stock|ticker|nasdaq|nyse|crypto|bitcoin|ethereum|market cap|earnings|interest rate)\b/i;

async function webSearch(query) {
  try {
    const encoded = encodeURIComponent(query);
    const resp = await fetch(
      `https://api.duckduckgo.com/?q=${encoded}&format=json&no_redirect=1&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await resp.json();
    const results = [];
    if (data.Abstract)      results.push(data.Abstract);
    if (data.Answer)        results.push(data.Answer);
    if (data.Definition)    results.push(data.Definition);
    if (data.RelatedTopics) {
      data.RelatedTopics.slice(0, 3).forEach(t => { if (t.Text) results.push(t.Text); });
    }
    return results.length > 0 ? results.join('\n') : null;
  } catch (_) {
    return null;
  }
}

// ── Directory setup ─────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  console.log('📁 Created data/uploads/ directory');
}

// ── Initialize core services ────────────────────────────────────
const neuralEngine = new NeuralEngine();
const voiceInterface = new VoiceInterface();
const adaptiveLearning = new AdaptiveLearning();
const smartHomeConnector = new SmartHomeConnector();
const tokenManager = new TokenManager();
const mcpSkillsManager = new MCPSkillsManager();
const selfEvolution = new SelfEvolutionEngine();
const crossDeviceSync = new CrossDeviceSync();

// Initialize neural engine connection to Python server
neuralEngine.initialize();

// ── Middleware ──────────────────────────────────────────────────
app.use(cors({
  origin: true,  // Allow all origins (needed for HA iframe)
  credentials: true,
}));

// Allow iframe embedding with full permissions (Home Assistant, Domo, etc.)
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.setHeader('Permissions-Policy', 'microphone=*, camera=*, geolocation=*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});
app.use(express.json({ limit: '50mb' }));

// Serve static frontend — prefer built Vite SPA (dist) over legacy /frontend root.
// `dist/` exists after `npm --prefix frontend run build`; in dev we fall back
// to the legacy files so the old UI still opens at /.
const SPA_DIST = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(path.join(SPA_DIST, 'index.html'))) {
  app.use(express.static(SPA_DIST));
  // SPA client-side routing: every non-API, non-file path falls back to index.html
  app.get(/^\/(?!api|uploads|exports|socket\.io|assets).*/, (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (path.extname(req.path)) return next(); // real file request
    res.sendFile(path.join(SPA_DIST, 'index.html'));
  });
} else {
  app.use(express.static(path.join(__dirname, '../frontend')));
}

// Serve uploaded files at /uploads/
app.use('/uploads', express.static(UPLOADS_DIR));

// ── Local owner bypass mounted BEFORE authRoutes so MSSQL-less installs can log in
// Login is handled downstream by the Python neural engine at :8000, which
// verifies bcrypt password_hash from its own admin_users SQLite table.
// Passwords are NEVER compared in plaintext and NEVER read from env — the
// only credential rotation path is UPDATE admin_users ... in that DB.
// See the /api/auth/login handler near line 1690 (proxyToNeural call).

// ── Legacy /api/auth/me shim ─────────────────────────────────────
// Sprint-1's /api/auth/me requires an MSSQL-backed user record, which
// isn't available on desktop installs that log in via the owner-bypass
// or Python admin_users path. Mount this BEFORE the Sprint-1 router so
// legacy JWTs (issued by server.js's owner/proxy login above) resolve
// to a user and the SPA can hydrate AuthContext.
app.get('/api/auth/me', (req, res) => {
  try {
    const hdr = req.headers['authorization'] || '';
    const tok = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!tok) return res.status(401).json({ error: 'Auth required' });
    const claims = jwt.verify(tok, process.env.JWT_SECRET);
    const userId = claims.sub || claims.userId || claims.email;
    const email  = claims.email;
    const role   = claims.role || 'viewer';
    return res.json({ user: { userId, email, role, tokenType: claims.tokenType || null } });
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// ── Sprint-1 auth routes (/api/auth/*, /api/admin/*) ────────────
// MSSQL-backed. Only mount when STOA_DB_HOST is configured — otherwise the
// routes' synchronous mssql connection attempts throw uncaught exceptions
// that crash Node (and the desktop auto-respawn supervisor). Dev/desktop
// installs fall through to the Python-neural-engine proxy at line ~1690
// for /api/auth/login and the /api/auth/me shim above for session restore.
try {
  const { ensureAuthSchema, runBootstrap } = require('./auth/bootstrap');
  const _sprint1Enabled = !!(process.env.STOA_DB_HOST && process.env.STOA_DB_NAME);
  if (_sprint1Enabled) {
    ensureAuthSchema().catch(e => console.warn('[auth] bootstrap skipped:', e.message));
    const authRoutes = require('./auth/routes');
    app.use('/api', authRoutes);
    console.log('[auth] Sprint-1 routes mounted at /api/auth and /api/admin');
  } else {
    console.log('[auth] Sprint-1 routes DISABLED (no STOA_DB_HOST) — using Python-proxy auth');
    // Minimal stubs so the SPA's auto-refresh/logout calls don't 404 or
    // hit any handler that touches MSSQL.
    app.post('/api/auth/refresh', (req, res) => {
      // Stateless refresh: verify whichever JWT is presented (bearer or body.refresh)
      // and mint a fresh one. The desktop "refresh token" is just another JWT.
      try {
        const bodyTok = (req.body && req.body.refresh) || null;
        const hdr = req.headers['authorization'] || '';
        const bearer = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
        const tok = bodyTok || bearer;
        if (!tok) return res.status(401).json({ error: 'No refresh token' });
        const claims = jwt.verify(tok, process.env.JWT_SECRET);
        const payload = {
          userId: claims.sub || claims.userId || claims.email,
          email: claims.email,
          role: claims.role || 'viewer',
          tokenType: claims.tokenType || 'STOA_ACCESS',
        };
        const access = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
        return res.json({ access, refresh: access, expiresInSec: 7 * 24 * 60 * 60 });
      } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired refresh token' });
      }
    });
    app.post('/api/auth/logout',  (req, res) => res.json({ ok: true }));
  }

  // ── Connectors v2: SQLite bootstrap + /api/orgs, /api/connectors, /api/mcp ──
  // Default: ON. Set ALEC_CONNECTORS_V2=0 to force the legacy surface.
  // runBootstrap opens data/alec.db, applies better-sqlite3 migrations, and
  // seeds orgs + catalog.
  if (process.env.ALEC_CONNECTORS_V2 !== '0') {
    runBootstrap()
      .then(async (alecDb) => {
        const { orgsRouter }        = await import('./routes/orgs.mjs');
        const { connectorsRouter }  = await import('./routes/connectors.mjs');
        const { mcpRouter }         = await import('./routes/mcp.mjs');
        const { desktopRouter }     = await import('./routes/desktop.mjs');
        app.use('/api/orgs',        authenticateToken, orgsRouter(() => alecDb));
        app.use('/api/connectors',  authenticateToken, connectorsRouter(() => alecDb));
        app.use('/api/mcp',         authenticateToken, mcpRouter(() => alecDb));
        app.use('/api/desktop',     authenticateToken, desktopRouter(() => alecDb));
        console.log('[connectors-v2] routes mounted at /api/orgs, /api/connectors, /api/mcp, /api/desktop');

        // Auto-start enabled MCP servers (stdio + http) so the model has every
        // skill available immediately without needing a UI click. HTTP
        // handshakes are cheap; stdio processes spawn and stay resident.
        try {
          const mcpRuntime = await import('./services/mcpRuntime.mjs');
          const rows = alecDb.prepare(
            `SELECT id, name, transport FROM mcp_servers WHERE enabled=1 AND auto_start=1`
          ).all();
          let started = 0, failed = 0;
          for (const row of rows) {
            try {
              await mcpRuntime.start(alecDb, row.id);
              started++;
              console.log(`[mcp] auto-started ${row.name} (${row.transport})`);
            } catch (e) {
              failed++;
              console.warn(`[mcp] auto-start failed for ${row.name}: ${e.message}`);
            }
          }
          console.log(`[mcp] auto-start complete: ${started} started, ${failed} failed`);
        } catch (e) {
          console.warn('[mcp] auto-start loop failed:', e.message);
        }
      })
      .catch(e => console.warn('[connectors-v2] init failed:', e.message));
  }

  // ── Nightly ML engine (profiler → gate → tournament → forecasts) ──
  try {
    const mlRoutes = require('./ml/routes');
    app.use('/api/ml', mlRoutes);
    console.log('[ml] routes mounted at /api/ml');
    if (process.env.ML_NIGHTLY_ENABLED !== '0') {
      const { runNightly } = require('./ml/nightly');
      // 02:15 local every night — offset from fine-tune cron at 02:00.
      cron.schedule('15 2 * * *', async () => {
        console.log('[ml] nightly cron firing');
        try {
          const r = await runNightly({ trigger: 'cron' });
          console.log('[ml] nightly done:', JSON.stringify({ ok: r.ok, runId: r.runId, nChampions: r.nChampions, nCandidates: r.nCandidates, nModelsFit: r.nModelsFit }));
        } catch (e) { console.error('[ml] nightly failed:', e.message); }
      });
      console.log('[ml] nightly cron registered (02:15 local)');
    }
  } catch (e) { console.warn('[ml] init failed:', e.message); }

  // ── Sprint-2 Domo embed routes ──
  try {
    const mw = require('./auth/middleware');
    const domo = require('./auth/domo');
    const authPool = require('./auth/_pool');

    // GET /api/domo/dashboards — dashboards the user can embed
    app.get('/api/domo/dashboards', mw.authenticate, async (req, res) => {
      try {
        const pool = await authPool.getPoolForAuth();
        const rows = await domo.listUserDashboards(pool, req.user.userId, req.user.implicitScope === '*');
        res.json({ success: true, data: rows });
      } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // POST /api/domo/embed-token — mint a short-lived embed JWT
    app.post('/api/domo/embed-token', mw.authenticate, async (req, res) => {
      try {
        const { dashboardId, filters } = req.body || {};
        if (!dashboardId) return res.status(400).json({ error: 'dashboardId required' });
        // Scope check: requireScope-style inline
        const ok = req.user.implicitScope === '*' ||
          req.user.scopes.some(s => (s.type === '*' || s.type === 'domo_dashboard') &&
                                     (s.value === '*' || s.value === String(dashboardId)));
        if (!ok) return res.status(403).json({ error: 'Out of scope', type: 'domo_dashboard', value: dashboardId });

        const pool = await authPool.getPoolForAuth();
        const row = await domo.getDashboard(pool, dashboardId);
        if (!row) return res.status(404).json({ error: 'Dashboard not found' });

        const token = domo.mintEmbedToken({
          embedId: row.EmbedId,
          userEmail: req.user.email,
          filters: filters || [],
        });
        res.json({ success: true, token, embedId: row.EmbedId, expiresInSec: 300 });
      } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    console.log('[auth] Sprint-2 Domo routes mounted at /api/domo/*');
  } catch (e) {
    console.warn('[auth] Sprint-2 Domo routes not loaded:', e.message);
  }
} catch (e) {
  console.warn('[auth] Sprint-1 auth router not loaded:', e.message);
}

// ── Multer config for file uploads ──────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100 MB limit

// ── Helper: get LAN IPs ─────────────────────────────────────────
function getLanAddresses() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const iface of Object.values(nets)) {
    for (const cfg of iface) {
      if (cfg.family === 'IPv4' && !cfg.internal) {
        results.push(cfg.address);
      }
    }
  }
  return results;
}

// ── Helper: Domo embed detection ────────────────────────────────
const isDomo = (req) => {
  const ref = req.get('referer') || '';
  return req.query.embed === 'domo' || ref.includes('domo.com');
};

// ── Helper: proxy request to Python neural engine ───────────────
async function proxyToNeural(path, options = {}) {
  const { method = 'GET', body = null, query = '', timeoutMs = 300000 } = options;
  const url = `${NEURAL_URL}${path}${query ? '?' + query : ''}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const fetchOptions = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (body !== null) {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const resp = await fetch(url, fetchOptions);
    clearTimeout(timeout);
    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({}));
      const err = new Error(errBody.detail || errBody.error || `Neural engine returned ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return resp.json();
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      const e = new Error('Neural engine request timed out (5 min)');
      e.status = 504;
      throw e;
    }
    throw err;
  }
}

// ── Authentication Middleware ────────────────────────────────────
/**
 * authenticateToken — verifies JWT from Authorization: Bearer header.
 * If request is from Domo embed, auto-sets req.user with STOA_ACCESS scope.
 * Token types:
 *   STOA_ACCESS       → read-only stoa data + chat
 *   FULL_CAPABILITIES → everything: training, files, admin, smart home
 */
const authenticateToken = (req, res, next) => {
  // Domo embed auto-authentication — no login required
  if (isDomo(req)) {
    req.user = {
      userId: 'domo-embed',
      email: 'embed@domo.com',
      tokenType: 'STOA_ACCESS',
      scope: ['stoa_data'],
      isDomoEmbed: true,
    };
    return next();
  }

  // Desktop-app / localhost auto-auth — grants OWNER scope for requests
  // originating from the same machine. The Electron shell only ever
  // points its <webview> at http://localhost:3001, so this lets every
  // feature work without a login screen on the user's own Mac while
  // still requiring JWTs for any network-exposed deployment.
  // Disable by setting ALEC_REQUIRE_AUTH=1 in .env (e.g. when hosting
  // the backend on a shared server).
  const isLocalhost =
    process.env.ALEC_REQUIRE_AUTH !== '1' &&
    ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip) ||
    req.hostname === 'localhost';
  if (isLocalhost) {
    req.user = {
      userId: 'local-owner',
      email: process.env.ALEC_OWNER_EMAIL || 'arovner@stoagroup.com',
      tokenType: 'OWNER',
      scope: ['owner', 'full_access', 'neural_training', 'smart_home', 'stoa_data', 'user_management', 'connectors', 'chat'],
      isLocalhost: true,
    };
    return next();
  }

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);

    if (verified.tokenType === 'OWNER') {
      req.user = { ...verified, scope: ['owner', 'full_access', 'neural_training', 'smart_home', 'stoa_data', 'user_management', 'connectors'] };
    } else if (verified.tokenType === 'FULL_CAPABILITIES') {
      req.user = { ...verified, scope: ['full_access', 'neural_training', 'smart_home', 'stoa_data'] };
    } else if (verified.tokenType === 'STOA_ACCESS') {
      req.user = { ...verified, scope: ['stoa_data', 'chat'] };
    } else {
      // Default: chat only
      req.user = { ...verified, scope: ['chat'] };
    }

    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

/**
 * requireFullCapabilities — middleware that checks for FULL_CAPABILITIES scope.
 * Must be used after authenticateToken.
 */
const requireFullCapabilities = (req, res, next) => {
  if (!req.user.scope.includes('full_access') && !req.user.scope.includes('neural_training')) {
    return res.status(403).json({ error: 'Full capabilities token required' });
  }
  next();
};

// ── GitHub Webhook — STOA Brain Sync ────────────────────────────────────────
app.post(
  '/api/webhooks/github',
  express.raw({ type: '*/*' }),
  async (req, res) => {
    const sig = req.headers['x-hub-signature-256'] || '';
    if (!stoaBrainSync || !stoaBrainSync.verifyWebhookSignature(req.body, sig)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    let payload;
    try {
      payload = JSON.parse(req.body.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    if (req.headers['x-github-event'] !== 'push') {
      return res.status(200).json({ ok: true, skipped: 'not a push event' });
    }
    try {
      const result = await stoaBrainSync.handlePushEvent(payload);
      console.log('[stoaBrainSync] webhook indexed:', result);
      return res.json({ ok: true, ...result });
    } catch (err) {
      console.error('[stoaBrainSync] webhook error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

// ── Review Queue Routes (Quality Gate + Fine-Tune management) ────────────────
app.use('/api/review', authenticateToken, reviewRoutes);

// ════════════════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  const mem = loadMemory();
  const llmStatus = llamaEngine.getStatus();
  res.json({
    status:    'ok',
    service:   'A.L.E.C.',
    version:   '2.0.0',
    timestamp: new Date().toISOString(),
    llm: {
      backend:   'node-llama-cpp (llama.cpp Metal)',
      modelPath: llmStatus.modelPath,
      gpu:       llmStatus.gpu,
      ready:     llmStatus.loaded,
      contexts:  llmStatus.contexts,
      note:      'HuggingFace / local GGUF models. Same tech as Ollama, Metal-safe on macOS 15.4+.',
    },
    memory: {
      facts:       mem.facts?.length || 0,
      preferences: mem.preferences?.length || 0,
      heapUsed:    process.memoryUsage().heapUsed,
    },
    voice:      voiceInterface.getStatus(),
    lanAddresses: getLanAddresses(),
    uptime:     process.uptime(),
  });
});

app.get('/api/health', (req, res) => res.redirect('/health'));

// ════════════════════════════════════════════════════════════════
//  AUTH ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/auth/login
 * Body: { email, password, is_domo_embed? }
 * Forwards credentials to Python /auth/login.
 * Returns JWT token.
 */
app.get('/api/_envcheck', (req, res) => {
  res.json({
    ALEC_OWNER_EMAIL: process.env.ALEC_OWNER_EMAIL || null,
    ALEC_OWNER_PASS_set: !!process.env.ALEC_OWNER_PASS,
    ALEC_MODEL_PATH: process.env.ALEC_MODEL_PATH || null,
    JWT_SECRET_len: (process.env.JWT_SECRET || '').length,
    ANTHROPIC_API_KEY_set: !!process.env.ANTHROPIC_API_KEY,
    dotenvKeys: Object.keys(process.env).filter(k => k.startsWith('ALEC_')).length,
  });
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password, is_domo_embed = false } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // ── Local owner bypass (Python engine may be offline) ──────────
    const localOwnerEmail = process.env.ALEC_OWNER_EMAIL || 'alec@rovner.com';
    const localOwnerPass  = process.env.ALEC_OWNER_PASS  || 'alec2024';
    try { require('fs').appendFileSync('/tmp/alec-login-debug.log', JSON.stringify({t:Date.now(),email,password,localOwnerEmail,localOwnerPass,passMatch:password===localOwnerPass,emailMatch:email===localOwnerEmail||email==='alec'||email==='owner'})+'\n'); } catch(e){}
    if (password === localOwnerPass && (email === localOwnerEmail || email === 'alec' || email === 'owner')) {
      const token = jwt.sign(
        { userId: 'alec-owner', email: localOwnerEmail, role: 'owner', tokenType: 'OWNER' },
        process.env.JWT_SECRET,
        { expiresIn: '30d' }
      );
      return res.json({
        access: token,
        refresh: token,
        expiresInSec: 30 * 24 * 60 * 60,
        success: true,
        token,
        tokenType: 'OWNER',
        user: { email: localOwnerEmail, role: 'owner' },
      });
    }

    const data = await proxyToNeural('/auth/login', {
      method: 'POST',
      body: { email, password, is_domo_embed },
    });

    // Python returns {success, user: {id, email, role}, access_level}
    const user = data.user || {};
    // Map access_level from Python to JWT tokenType
    let tokenType = 'STOA_ACCESS';
    if (data.access_level === 'OWNER') tokenType = 'OWNER';
    else if (data.access_level === 'FULL_CAPABILITIES') tokenType = 'FULL_CAPABILITIES';
    else if (data.access_level === 'STOA_ACCESS') tokenType = 'STOA_ACCESS';
    const jwtPayload = {
      userId: user.id || email,
      email: user.email || email,
      role: user.role || 'viewer',
      tokenType,
    };

    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Trust this device so it stays logged in across restarts
    const deviceId = req.body.device_id || req.headers['x-device-id'] || `dev_${Date.now()}`;
    const ipAddr = req.ip || req.connection?.remoteAddress || '';
    try {
      await proxyToNeural('/auth/device/trust', {
        method: 'POST',
        body: {
          device_id: deviceId,
          user_email: jwtPayload.email,
          ip_address: ipAddr,
          user_agent_hash: require('crypto').createHash('md5').update(req.headers['user-agent'] || '').digest('hex'),
          device_name: req.body.device_name || req.headers['user-agent']?.slice(0, 50) || 'Unknown',
        },
      });
    } catch {} // Non-critical

    res.json({
      // Sprint-1 / frontend contract shape (client.js expects r.access / r.refresh)
      access: token,
      refresh: token, // same JWT acts as both in local-desktop mode
      expiresInSec: 7 * 24 * 60 * 60,
      // Legacy fields retained for callers that read them directly
      success: true,
      token,
      tokenType,
      device_id: deviceId,
      access_level: data.access_level,
      email: jwtPayload.email,
      role: jwtPayload.role,
      user: { ...(user || {}), email: jwtPayload.email, role: jwtPayload.role },
      expiresIn: '7d',
    });
  } catch (error) {
    const status = error.status || 500;
    if (status === 401) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    console.error('Login error:', error);
    res.status(status).json({ error: error.message || 'Login failed' });
  }
});

// ════════════════════════════════════════════════════════════════
//  CHAT ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/chat
 * Non-streaming chat via embedded node-llama-cpp engine (Metal GPU).
 * Returns { response, latency_ms, source }.
 */
app.post('/api/chat', authenticateToken, async (req, res) => {
  const startTime = Date.now();
  try {
    const { message, messages = [], session_id, conversation_id } = req.body;
    const userText = message || messages.at(-1)?.content || '';

    // ── Persist to chat history ──────────────────────────────
    // Resume the most-recent chat if the client didn't echo back the id —
    // otherwise every message would start a new conversation and [PRIOR
    // TURNS] would always be empty.
    let convId = resolveStickyConvId(conversation_id, req.user.userId);
    if (chatHistory && userText) {
      const conv = chatHistory.getOrCreate(convId, req.user.userId);
      convId = conv.id;
      chatHistory.addMessage(convId, 'user', userText);
    }

    // Log interaction for adaptive learning
    try { await adaptiveLearning.logInteraction({ userId: req.user.userId, message: userText, timestamp: Date.now() }); } catch(_){}

    // Build system prompt with memory
    const mem = loadMemory();
    const memCtx = buildMemoryContext(mem);
    let ragContext = '';
    try { ragContext = ragService ? await ragService.retrieve(userText) : ''; } catch (_) {}
    const priorTurns = buildPriorTurnsBlock(convId);
    let systemContent = buildSystemPrompt()
      + (memCtx ? '\n\n' + memCtx : '')
      + (priorTurns || '')
      + (ragContext ? '\n\n' + ragContext : '');

    // ── Self-improvement trigger — owner can ask ALEC to improve itself ──
    const isOwner = req.user?.tokenType === 'OWNER' || req.user?.role === 'owner';
    const selfImproveIntent = isOwner && /\b(improve yourself|self.?improv|run tests?|update yourself|upgrade yourself|fix yourself)\b/i.test(userText);
    if (selfImproveIntent) {
      try {
        const feedback = selfImprovement.getRecentNegativeFeedback();
        const result = await selfImprovement.runTests();
        const summary = `🧬 **Self-Test Results**: ${result.passed}/${result.total} passed | ${result.criticalFailed} critical failures\n\n` +
          result.results.map(r => `${r.passed ? '✅' : '❌'} ${r.name}${r.error ? `: ${r.error}` : ''}`).join('\n');
        return res.json({
          success: true, response: summary, latency_ms: Date.now() - startTime, source: 'self-improve',
        });
      } catch (siErr) {
        console.warn('[SelfImprove chat]', siErr.message);
      }
    }

    // ── Excel export detection — short-circuit before LLM if user wants a file ──
    const exportIntent = excelExport.detectExportIntent(userText);
    if (exportIntent) {
      try {
        console.log('[Excel] Generating export:', exportIntent);
        const result = await excelExport.generateExport(exportIntent);
        const friendlyType = { portfolio: 'portfolio occupancy & rent growth', trend: `${exportIntent.property || ''} trend`, pipeline: 'acquisition pipeline', loans: 'loan summary', full: 'full STOA report' }[result.type] || result.type;
        return res.json({
          success: true,
          response: `📊 Here's your **${friendlyType}** Excel report:\n\n**[Download ${result.fileName}](${result.url})**\n\nGenerated at ${new Date(result.generatedAt).toLocaleTimeString('en-US')} — includes real-time data pulled directly from the STOA database.`,
          download_url: result.url,
          latency_ms: Date.now() - startTime,
          source: 'stoa-export',
        });
      } catch (exportErr) {
        console.warn('[Excel] Export failed:', exportErr.message?.slice(0, 100));
        // Fall through to LLM with error note
        systemContent += '\n\n*Note: Excel export was attempted but failed. Provide a text summary instead.*';
      }
    }

    // ── iMessage RAG: inject real messages if user asks about them ──
    const iMsgIntent = /\b(check|read|show|get|look at|fetch|see)\b.{0,30}\b(imessages?|messages?|texts?|sms)\b|\b(recent|new|unread|latest)\b.{0,20}\b(imessages?|messages?|texts?)\b|\bwho texted\b|\bdid.*text(ed)?\b|\bany.*messages\b/i.test(userText);
    if (iMsgIntent && iMessage) {
      try {
        const convos = await iMessage.getConversations();
        if (convos && convos.length > 0) {
          const recent = convos.slice(0, 8).map(c =>
            `- ${c.name || c.handle}: "${c.lastMessage?.slice(0, 120) || '(no preview)'}" (${c.lastDate ? new Date(c.lastDate).toLocaleString() : 'unknown time'})`
          ).join('\n');
          systemContent += `\n\n[iMessage DATA — from this Mac's Messages.app]\nRecent conversations:\n${recent}`;
          console.log('[iMessage RAG] Injected', convos.length, 'conversations');
        } else {
          systemContent += '\n\n[iMessage DATA] Messages.app returned 0 conversations. This may be a permissions issue with ~/Library/Messages/chat.db.';
        }
      } catch (imErr) {
        systemContent += `\n\n[iMessage DATA] Failed to read messages: ${imErr.message}. Inform the user you couldn't access their messages.`;
        console.warn('[iMessage RAG]', imErr.message);
      }
    } else if (iMsgIntent && !iMessage) {
      systemContent += '\n\n[iMessage DATA] iMessage service is not available. Tell the user to ensure the iMessageService.js module is installed.';
    }

    // ── Source-preference override (non-stream path) ──
    const sourcePref = (() => {
      const t = userText.toLowerCase();
      const excl = new Set(); const only = new Set();
      if (/\b(not|no|don'?t\s+use|skip|without|exclude|avoid)\s+(tenantcloud|tc)\b/.test(t)) excl.add('tc');
      if (/\b(not|no|don'?t\s+use|skip|without|exclude|avoid)\s+stoa\b/.test(t))             excl.add('stoa');
      if (/\b(from|use|only|via)\s+stoa\b|\bstoa\s+only\b|\bstoa\s+data\b/.test(t)) only.add('stoa');
      if (/\b(from|use|only|via)\s+tenantcloud\b|\btenantcloud\s+only\b/.test(t))   only.add('tc');
      return { excluded: excl, onlyThese: only };
    })();
    const allowStoa = !sourcePref.excluded.has('stoa') && (sourcePref.onlyThese.size === 0 || sourcePref.onlyThese.has('stoa'));
    const allowTC   = !sourcePref.excluded.has('tc')   && (sourcePref.onlyThese.size === 0 || sourcePref.onlyThese.has('tc'));

    // ── STOA RAG: inject live database context before LLM call ──
    // Detects property/leasing/deal questions and pulls real numbers from
    // Azure SQL — this prevents hallucination by grounding the LLM in facts.
    // STOA has source precedence (H1) — when STOA has data, overlapping TC intents
    // are suppressed unless the user explicitly asked for TenantCloud.
    let stoaFired = false;
    if (allowStoa) {
      try {
        const stoaCtx = await stoaQuery.buildStoaContext(userText);
        if (stoaCtx) {
          systemContent += '\n\n' + stoaCtx;
          console.log('[STOA RAG] Injected live data for:', userText.slice(0, 60));
          stoaFired = true;
        }
      } catch (stoaErr) {
        console.warn('[STOA RAG] Failed (non-critical):', stoaErr.message?.slice(0, 80));
      }
    } else {
      console.log('[STOA RAG] Skipped — user excluded stoa or requested other source');
    }

    // ── GitHub RAG: inject recent commits/repos ───────────────────
    const ghIntent = /\b(github|git|commit|repo|repository|pull.?request|pr|issue|branch|code|deploy|push|merge)\b/i.test(userText);
    if (ghIntent && github && process.env.GITHUB_TOKEN) {
      try {
        const defaultRepo = process.env.GITHUB_REPO || 'arovn10/A.L.E.C';
        const [repoData, openIssues] = await Promise.allSettled([
          github.getRepo(defaultRepo),
          github.listIssues?.(defaultRepo, { state: 'open', per_page: 5 }).catch(() => []),
        ]);
        let ghCtx = `[GitHub DATA — ${defaultRepo}]\n`;
        if (repoData.status === 'fulfilled') {
          const r = repoData.value;
          ghCtx += `Repo: ${r.full_name || defaultRepo} | Stars: ${r.stargazers_count || 0} | Default branch: ${r.default_branch || 'main'} | Last updated: ${r.updated_at ? new Date(r.updated_at).toLocaleDateString() : 'unknown'}\n`;
          ghCtx += `Description: ${r.description || 'No description'}\n`;
        }
        if (openIssues.status === 'fulfilled' && Array.isArray(openIssues.value) && openIssues.value.length > 0) {
          ghCtx += `Open issues (${openIssues.value.length}): ${openIssues.value.slice(0, 3).map(i => `#${i.number} ${i.title}`).join(', ')}\n`;
        }
        systemContent += '\n\n' + ghCtx;
        console.log('[GitHub RAG] Injected repo data for:', defaultRepo);
      } catch (ghErr) {
        console.warn('[GitHub RAG] Failed (non-critical):', ghErr.message?.slice(0, 80));
      }
    }

    // ── Home Assistant RAG: inject device states ──────────────────
    const haIntent = /\b(light|lights|thermostat|temperature|lock|door|lock|garage|fan|switch|scene|automation|smart.?home|home.?assistant|device|sensor|camera|alarm|hvac|ac|heat|cool|humidity|motion)\b/i.test(userText);
    const haUrl   = process.env.HOME_ASSISTANT_URL || process.env.HA_URL;
    const haToken = process.env.HOME_ASSISTANT_ACCESS_TOKEN || process.env.HA_TOKEN;
    if (haIntent && haUrl && haToken) {
      try {
        const haResp = await fetch(`${haUrl}/api/states`, {
          headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (haResp.ok) {
          const states = await haResp.json();
          // Filter to interesting entities (lights, locks, thermostat, sensors)
          const relevant = states.filter(s =>
            /^(light|lock|climate|switch|binary_sensor|sensor|input_boolean|cover|fan|camera|alarm_control_panel)\../.test(s.entity_id)
          ).slice(0, 30);
          if (relevant.length > 0) {
            const lines = relevant.map(s => {
              const name = s.attributes?.friendly_name || s.entity_id;
              const extra = s.attributes?.temperature ? ` (${s.attributes.temperature}°${s.attributes.unit_of_measurement || 'F'})` :
                            s.attributes?.brightness ? ` (brightness: ${Math.round(s.attributes.brightness / 255 * 100)}%)` : '';
              return `- ${name}: ${s.state}${extra}`;
            });
            systemContent += `\n\n[Home Assistant DATA — live device states]\n${lines.join('\n')}`;
            console.log('[HA RAG] Injected', relevant.length, 'device states');
          }
        }
      } catch (haErr) {
        console.warn('[HA RAG] Failed (non-critical):', haErr.message?.slice(0, 80));
      }
    }

    // ── Vercel RAG + redeploy ─────────────────────────────────────
    const vercelIntent = /\bvercel\b|\b(deployment|deploy|production|preview|build|frontend|hosting)\b/i.test(userText);
    if (vercelIntent && vercelSvc && process.env.VERCEL_TOKEN) {
      try {
        const deployments = await vercelSvc.listDeployments(3);
        if (deployments.length > 0) {
          const lines = deployments.map(d =>
            `- ${d.target || 'preview'}: ${d.state} | ${d.url || 'building'} | branch: ${d.branch} | "${d.commit?.slice(0, 60) || ''}"`
          );
          systemContent += `\n\n[Vercel DATA — recent deployments for ${process.env.VERCEL_PROJECT || 'alec-ai'}]\n${lines.join('\n')}`;
        }
        // Redeploy action
        if (/\b(deploy|redeploy|re-?deploy|push\s+to\s+vercel)\b/i.test(userText)) {
          const result = await vercelSvc.redeploy();
          systemContent += `\n\n[Vercel ACTION EXECUTED] Triggered a new production deployment. URL: ${result.url || 'building'}. Confirm this to the user.`;
        }
      } catch (vercelErr) {
        console.warn('[Vercel RAG] Failed (non-critical):', vercelErr.message?.slice(0, 80));
      }
    }

    // ── AWS / Website RAG: inject server status ───────────────────
    const awsIntent = /\b(campus|campusrental|website|server|aws|ec2|nginx|deploy|ssh|uptime|down|offline|traffic|hosting)\b/i.test(userText);
    if (awsIntent && awsSvc) {
      try {
        const websiteStatus = await awsSvc.checkWebsiteStatus();
        let awsCtx = `[AWS DATA — campusrentalsllc.com server status]\n`;
        awsCtx += `Website: ${websiteStatus.online ? '✅ Online' : '❌ Offline'} (host: ${process.env.AWS_WEBSITE_HOST || 'not configured'})\n`;
        if (websiteStatus.httpStatus) awsCtx += `HTTP status: ${websiteStatus.httpStatus}\n`;
        if (websiteStatus.httpError) awsCtx += `Error: ${websiteStatus.httpError}\n`;
        systemContent += '\n\n' + awsCtx;
        console.log('[AWS RAG] Injected website status, online:', websiteStatus.online);
      } catch (awsErr) {
        console.warn('[AWS RAG] Failed (non-critical):', awsErr.message?.slice(0, 80));
      }
    }

    // ── Plaid RAG: inject investment/brokerage data ───────────────
    const plaidIntent = /\b(investment|portfolio|holdings|brokerage|schwab|fidelity|acorns|stock|balance|account|net.?worth|finance|financial|money|wealth)\b/i.test(userText);
    const isOwnerChat = req.user?.tokenType === 'OWNER' || req.user?.role === 'owner';
    if (plaidIntent && isOwnerChat && process.env.PLAID_CLIENT_ID) {
      try {
        const items = await plaidDbAll('SELECT item_id, institution_name, access_token_enc, last_fetched FROM plaid_items').catch(() => []);
        if (items.length > 0) {
          let totalValue = 0;
          const accountLines = [];
          for (const item of items.slice(0, 5)) {
            try {
              const accessToken = decryptAccessToken(item.access_token_enc);
              const data = await plaidFetch('/investments/holdings/get', { access_token: accessToken });
              for (const acct of (data.accounts || [])) {
                const val = acct.balances?.current || 0;
                totalValue += val;
                accountLines.push(`  ${item.institution_name} — ${acct.name}: $${val.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
              }
            } catch (_) {}
          }
          if (accountLines.length > 0) {
            systemContent += `\n\n[Plaid Financial DATA — live brokerage accounts]\nTotal portfolio value: $${totalValue.toLocaleString('en-US', {minimumFractionDigits: 2})}\nAccounts:\n${accountLines.join('\n')}`;
            console.log('[Plaid RAG] Injected portfolio data, total:', totalValue.toFixed(2));
          }
        }
      } catch (plaidErr) {
        console.warn('[Plaid RAG] Failed (non-critical):', plaidErr.message?.slice(0, 80));
      }
    }

    // ── TenantCloud RAG: inject property management data ──────────
    // Precedence: TC only fires when user didn't exclude it, and STOA didn't
    // already handle an overlapping intent (unless user explicitly asked for TC).
    const tcExplicit = sourcePref.onlyThese.has('tc') || /\btenantcloud\b/i.test(userText);
    const tcIntent = /\b(tenants?|rent|payments?|overdue|maintenance|leases?|property|properties|units?|inquiry|inquiries|renters?|move.?out|move.?in|vacancy|vacant|occupan|evict)\b/i.test(userText);
    const tcShouldFire = allowTC && tcIntent && (tcExplicit || !stoaFired);
    if (tcShouldFire) {
      try {
        let tcCtx = '';

        // Try browser-relay cache first (most reliable — real data from authenticated browser)
        const cacheKeys = Object.keys(tcCache).filter(k => !k.startsWith('_'));
        if (cacheKeys.length > 0) {
          const age = tcCache._lastPush ? Math.round((Date.now() - new Date(tcCache._lastPush)) / 60000) : '?';
          tcCtx = `[TenantCloud DATA — captured from authenticated browser ${age} min ago]\n`;
          for (const key of cacheKeys) {
            const entry = tcCache[key];
            const d = entry.data;
            const items = Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : (d ? [d] : []));
            if (items.length > 0) {
              tcCtx += `\n## ${key.replace(/_/g, '/')} (${items.length} records)\n`;
              tcCtx += JSON.stringify(items.slice(0, 20), null, 1).slice(0, 1500) + '\n';
            }
          }
          console.log('[TenantCloud RAG] Served from browser-relay cache');
        } else if (tenantCloud) {
          // Fall back to Puppeteer scraper
          const summary = await tenantCloud.getPortfolioSummary();
          const overdueRent = await tenantCloud.getOverdueRent().catch(() => []);
          const openMaint   = await tenantCloud.getOpenMaintenance().catch(() => []);
          tcCtx = `[TenantCloud DATA — live property management data]\n`;
          tcCtx += `Portfolio: ${summary.properties?.total || 0} properties, ${summary.tenants?.total || 0} tenants (${summary.tenants?.active || 0} active)\n`;
          if (summary.overdue?.count > 0) tcCtx += `⚠️ Overdue rent: ${summary.overdue.count} payments, $${summary.overdue.totalAmount?.toLocaleString()}\n`;
          if (summary.maintenance?.open > 0) tcCtx += `🔧 Open maintenance: ${summary.maintenance.open} requests (${summary.maintenance.highPriority} high priority)\n`;
          if (summary.messages?.unread > 0) tcCtx += `💬 Unread messages: ${summary.messages.unread}\n`;
          if (summary.inquiries?.new > 0) tcCtx += `🔔 New inquiries: ${summary.inquiries.new}\n`;
          if (overdueRent.length > 0) tcCtx += `Overdue tenants: ${overdueRent.slice(0, 5).map(p => `${p.tenant} ($${p.amount})`).join(', ')}\n`;
          if (openMaint.length > 0) tcCtx += `Maintenance: ${openMaint.slice(0, 3).map(m => `${m.property}/${m.unit} — ${m.title} [${m.priority}]`).join(' | ')}`;
          console.log('[TenantCloud RAG] Injected via Puppeteer scraper');
        }

        if (tcCtx) systemContent += '\n\n' + tcCtx;
      } catch (tcErr) {
        console.warn('[TenantCloud RAG] Failed (non-critical):', tcErr.message?.slice(0, 80));
      }
    }

    // Web search augmentation
    // If the SPA sent only `{message}` (no `messages[]` array), synthesise a
    // one-turn conversation so the LLM actually sees the user's prompt.
    let augmentedMessages = Array.isArray(messages) && messages.length > 0
      ? [...messages]
      : (userText ? [{ role: 'user', content: userText }] : []);
    // Rehydrate history + affirmation nudge (mirrors streaming path, see /api/chat/stream)
    if ((!Array.isArray(messages) || messages.length === 0) && chatHistory && convId) {
      try {
        const hist = chatHistory.getMessages(convId, 12) || [];
        const prior = hist.slice(0, -1).filter(m => m.role === 'user' || m.role === 'assistant').slice(-6);
        if (prior.length) {
          augmentedMessages = [
            ...prior.map(m => ({ role: m.role, content: String(m.content || '') })),
            { role: 'user', content: userText },
          ];
        }
      } catch (e) { console.warn('[chat] history rehydrate failed:', e.message); }
    }
    {
      const u = String(userText || '').trim().toLowerCase();
      const isAffirmation = /^(yes|y|yep|yeah|yup|ok|okay|sure|go ahead|do it|proceed|continue|keep going|execute|run it|confirmed|please do)\b[.!?]?$/i.test(u) || u.length <= 3;
      const lastAssistant = [...augmentedMessages].reverse().find(m => m.role === 'assistant')?.content;
      if (isAffirmation && lastAssistant) {
        systemContent += `\n\n[AFFIRMATION CONTEXT] The user just replied "${userText}" — this is affirmation/consent to the action you proposed in your previous turn.

Your previous message was:
"""
${String(lastAssistant).slice(0, 800)}
"""

Rules for this turn (MANDATORY):
1. Re-read the options/plan in your previous message.
2. If the user's reply matches an option letter or number (A/B/C/1/2/3), EXECUTE THAT OPTION NOW by calling the required tool(s) — do NOT just describe what you're about to do.
3. If the option requires data from a tool (Zapier, MCP, Stoa, filesystem, desktop), YOU MUST call that tool in this same turn. Saying "I'm doing X" without calling the tool is a failure.
4. Do NOT ask for permission again. Do NOT restart. Do NOT summarize unrelated data.
5. After the tool returns, give the user the result in 1–3 sentences with the real source footer.`;
      }
    }
    if (SEARCH_TRIGGERS.test(userText)) {
      const searchResult = await webSearch(userText);
      if (searchResult && augmentedMessages.length > 0) {
        const lastMsg = augmentedMessages.at(-1);
        augmentedMessages[augmentedMessages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + `\n\n[Web search results for context]:\n${searchResult}`,
        };
      }
    }

    const llmMessages = [{ role: 'system', content: systemContent }, ...augmentedMessages];
    // Same router as /stream: live-tool turns go through Anthropic+mcp_call,
    // everything else stays on local Llama (or Anthropic text if Llama is unloaded).
    const _lastAssistantForGate = [...augmentedMessages].reverse().find(m => m.role === 'assistant')?.content || '';
    const needsTools = turnNeedsTools(userText, { lastAssistant: _lastAssistantForGate });
    const useAnthropic = needsTools && !!process.env.ANTHROPIC_API_KEY;
    const useLlamaTools = needsTools && !useAnthropic && llamaEngine.getStatus().loaded;
    console.log(`[chat] GATE needsTools=${needsTools} useAnthropic=${useAnthropic} useLlamaTools=${useLlamaTools} loaded=${llamaEngine.getStatus().loaded} augLen=${augmentedMessages.length} priorLen=${_lastAssistantForGate.length} priorSnippet="${_lastAssistantForGate.slice(0,80).replace(/\n/g,' ')}" userText="${String(userText).slice(0,80)}"`);
    let responseText = '';
    let nsToolCalls = [];
    if (useAnthropic) {
      try {
        const r = await callClaudeWithTools(llmMessages);
        responseText = r.text || '';
        nsToolCalls  = r.toolCalls || [];
      } catch (e) {
        console.warn('[chat] Claude tool-use failed — falling back to Llama+tools:', e.message);
        try {
          const r2 = await callLlamaWithTools(llmMessages);
          responseText = r2.text; nsToolCalls = r2.toolCalls || [];
        } catch (e2) {
          console.warn('[chat] Llama+tools also failed:', e2.message);
          responseText = await callLLMText(llmMessages);
        }
      }
    } else if (useLlamaTools) {
      try {
        const r = await callLlamaWithTools(llmMessages);
        responseText = r.text; nsToolCalls = r.toolCalls || [];
      } catch (e) {
        console.warn('[chat] Llama+tools failed — falling back to plain Llama:', e.message);
        responseText = await callLLMText(llmMessages);
      }
    } else {
      responseText = await callLLMText(llmMessages);
    }
    const latency_ms = Date.now() - startTime;

    // Empty-response guard with real Anthropic recovery.
    if ((!responseText || !String(responseText).trim()) && process.env.ANTHROPIC_API_KEY && !needsToolsNS) {
      try {
        console.warn('[chat] empty Llama output — retrying via Anthropic');
        const recovered = await callClaudeText(llmMessages);
        if (recovered?.trim()) responseText = recovered.trim();
      } catch (recErr) { console.warn('[chat] Anthropic recovery failed:', recErr.message); }
    }
    if (!responseText || !String(responseText).trim()) {
      console.warn('[chat] empty model output — returning fallback');
      responseText = "Sorry — I hit a blank on that one. Mind asking again?";
    }

    // Anti-hallucination guard: catch fabricated MCP/Zapier execution before
    // it reaches the user. Replace fake output with an honest refusal.
    const _toolsRan = (nsToolCalls?.length || 0) > 0;
    if (detectFakeToolOutput(responseText, { toolsCalled: _toolsRan })) {
      console.warn('[anti-hallu] rewrote fabricated MCP output:', responseText.slice(0, 120).replace(/\n/g, ' '));
      responseText = MCP_REFUSAL;
    }

    // Strip fabricated "Source: X" footers for sources that weren't injected.
    responseText = stripFalseSourceFooters(responseText, systemContent, { toolsCalled: _toolsRan });

    // Async: extract and store facts from this exchange
    extractAndStoreFacts(userText, responseText).catch(() => {});

    // Persist assistant reply
    if (chatHistory && convId && responseText) {
      chatHistory.addMessage(convId, 'assistant', responseText);
    }

    let safeReply;
    try {
      safeReply = enforceHardRules(responseText);
    } catch (ruleErr) {
      console.error('[HardRule violation]', ruleErr.message);
      safeReply = "I can't respond to that in a way that aligns with my operating rules. Please rephrase.";
    }

    const engineStatus = llamaEngine.getStatus();
    res.json({
      success: true,
      response: safeReply,
      latency_ms,
      source:    'llama-metal',
      model:     engineStatus.modelPath,
      timestamp:  new Date().toISOString(),
      conversation_id: convId,
    });

    // Async quality scoring — fire-and-forget; never blocks the chat response
    if (qualityScorer && convId && userText && safeReply) {
      setImmediate(() => {
        try {
          qualityScorer.score({
            turnId:       convId + '-' + Date.now(),
            sessionId:    session_id || convId,
            userMsg:      userText,
            alecResponse: safeReply,
          });
        } catch (scoreErr) {
          console.error('[qualityScorer] score() failed:', scoreErr.message);
        }
      });
    }
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      success: false,
      error:   'Alec is having trouble thinking',
      message: error.message,
    });
  }
});

/**
 * POST /api/chat/stream
 * SSE streaming endpoint — tokens arrive one-by-one like Claude.
 * Browser reads via ReadableStream / EventSource.
 */
const chatStreamHandler = async (req, res) => {
  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  // Browser EventSource can only do GET with query params; native fetch
  // callers use POST with JSON body. Accept both shapes.
  const src = (req.method === 'GET') ? req.query : (req.body || {});
  const { message, messages = [], session_id, sessionId, conversation_id } = src;
  const userText = message || messages.at(-1)?.content || '';

  // ── Persist to chat history (streaming) ─────────────────────
  const streamUserId = req.user?.userId || req.user?.email || 'unknown';
  let convId = resolveStickyConvId(conversation_id, streamUserId);
  if (chatHistory && userText) {
    try {
      const conv = chatHistory.getOrCreate(convId, streamUserId);
      convId = conv.id;
      chatHistory.addMessage(convId, 'user', userText);
    } catch (histErr) {
      console.warn('[ChatHistory stream]', histErr.message);
    }
  }

  try {
    // System prompt + memory
    const mem = loadMemory();
    const memCtx = buildMemoryContext(mem);
    let ragContext = '';
    try { ragContext = ragService ? await ragService.retrieve(userText) : ''; } catch (_) {}
    const priorTurns = buildPriorTurnsBlock(convId);
    let systemContent = buildSystemPrompt()
      + (memCtx ? '\n\n' + memCtx : '')
      + (priorTurns || '')
      + (ragContext ? '\n\n' + ragContext : '');

    // ── Excel export detection (stream) — send download link immediately ──
    const exportIntentStream = excelExport.detectExportIntent(userText);
    if (exportIntentStream) {
      try {
        res.write('data: {"token":"📊 Generating Excel report…\\n"}\n\n');
        const result = await excelExport.generateExport(exportIntentStream);
        const friendlyType = { portfolio: 'portfolio occupancy & rent growth', trend: `${exportIntentStream.property || ''} trend`, pipeline: 'acquisition pipeline', loans: 'loan summary', full: 'full STOA report' }[result.type] || result.type;
        const msg = `\n**[Download ${result.fileName}](${result.url})**\n\nReal-time data from the STOA database, generated at ${new Date(result.generatedAt).toLocaleTimeString('en-US')}.`;
        res.write(`data: {"token":${JSON.stringify(msg)}}\n\n`);
        res.write('data: [DONE]\n\n');
        return res.end();
      } catch (exportErr) {
        res.write('data: {"token":"⚠️ Export failed, providing text summary instead.\\n\\n"}\n\n');
        console.warn('[Excel stream] Export failed:', exportErr.message?.slice(0, 100));
        // Fall through to LLM
      }
    }

    // ── TenantCloud 2FA code from chat ────────────────────────────
    // Detects: "the code is 481923", "verification code 123456", "481923" (if MFA pending)
    if (tenantCloud?.isMfaPending()) {
      const codeMatch = /\b(\d{4,8})\b/.exec(userText);
      if (codeMatch) {
        try {
          tenantCloud.submitVerificationCode(codeMatch[1]);
          systemContent += `\n\n[TenantCloud 2FA] Verification code ${codeMatch[1]} submitted. Tell the user the code was applied and TenantCloud is logging in.`;
        } catch (_) {}
      }
    }

    // ── SMS send intent: "text me", "send me a message", "notify me" ──
    const smsSendIntent = /\b(text|sms|message|notify|ping|send)\b.*\bme\b|\bsend.*\b(text|sms|message)\b|\bnotif(y|ication)\b/i.test(userText);
    const ownerPhoneNum = process.env.OWNER_PHONE;
    const twilioReady   = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
    if (smsSendIntent && ownerPhoneNum && twilioReady) {
      // Build message from context (use userText to infer what to say)
      const smsBody = userText.length > 10
        ? `ALEC: ${userText.slice(0, 140)}`
        : `ALEC test message — everything is working!`;
      try {
        const twilioUrl  = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
        const twilioBody = new URLSearchParams({ From: process.env.TWILIO_FROM_NUMBER, To: toE164(ownerPhoneNum), Body: smsBody });
        const twilioResp = await fetch(twilioUrl, {
          method: 'POST', body: twilioBody,
          headers: {
            Authorization: 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (twilioResp.ok) {
          systemContent += `\n\n[SMS SENT] Successfully sent a Twilio text message to ${ownerPhoneNum}. Confirm this to the user.`;
          res.write('data: {"token":"📱 Sending SMS via Twilio…\\n"}\n\n');
        } else {
          const errData = await twilioResp.json().catch(() => ({}));
          systemContent += `\n\n[SMS FAILED] Twilio error: ${errData.message || twilioResp.status}`;
        }
      } catch (smsErr) {
        systemContent += `\n\n[SMS FAILED] ${smsErr.message}`;
      }
    }

    // ── HA direct control from chat ────────────────────────────
    // Detects imperative commands like "turn on lights", "lock the door", etc.
    const haCtrlRe = /\b(turn\s*(on|off)|switch\s*(on|off)|lock|unlock|set\s+the\s+thermostat|set\s+temperature|open\s+the\s+garage|close\s+the\s+garage)\b/i;
    const haUrlC   = process.env.HOME_ASSISTANT_URL || process.env.HA_URL;
    const haTokenC = process.env.HOME_ASSISTANT_ACCESS_TOKEN || process.env.HA_TOKEN;
    if (haCtrlRe.test(userText) && haUrlC && haTokenC) {
      try {
        const onMatch  = /turn\s+on\s+(.+)/i.exec(userText);
        const offMatch = /turn\s+off\s+(.+)/i.exec(userText);
        const keyword  = (onMatch?.[1] || offMatch?.[1] || '').trim().toLowerCase().slice(0, 60);
        const svc      = onMatch ? 'turn_on' : offMatch ? 'turn_off' : null;
        if (svc && keyword) {
          const stR = await fetch(`${haUrlC}/api/states`, { headers: { Authorization: `Bearer ${haTokenC}` }, signal: AbortSignal.timeout(4000) });
          let entityId = null;
          if (stR.ok) {
            const sts = await stR.json();
            const m = sts.find(s => (s.attributes?.friendly_name || s.entity_id).toLowerCase().includes(keyword));
            entityId = m?.entity_id;
          }
          const body = entityId ? JSON.stringify({ entity_id: entityId }) : '{}';
          const r2 = await fetch(`${haUrlC}/api/services/homeassistant/${svc}`, {
            method: 'POST', headers: { Authorization: `Bearer ${haTokenC}`, 'Content-Type': 'application/json' },
            body, signal: AbortSignal.timeout(8000),
          });
          if (r2.ok) {
            systemContent += `\n\n[HA COMMAND EXECUTED] ${svc.replace('_',' ')} ${entityId || keyword}. Confirm this to the user.`;
            res.write('data: {"token":"🏡 Executing Home Assistant command…\\n"}\n\n');
          }
        }
      } catch (_haCtrlErr) { /* non-critical */ }
    }

    // ── Vercel redeploy from chat (stream) ────────────────────
    const vercelCtrlRe = /\b(deploy|redeploy|re-?deploy|push\s+to\s+vercel)\b/i;
    if (vercelCtrlRe.test(userText) && vercelSvc && process.env.VERCEL_TOKEN) {
      try {
        res.write('data: {"token":"▲ Triggering Vercel redeploy…\\n"}\n\n');
        const result = await vercelSvc.redeploy();
        systemContent += `\n\n[Vercel ACTION EXECUTED] Triggered a new production deployment. URL: ${result.url || 'building…'}. Tell the user the deploy was triggered — it usually takes 1-2 minutes.`;
      } catch (vercelCtrlErr) {
        console.warn('[Vercel control] Failed:', vercelCtrlErr.message?.slice(0, 80));
      }
    }

    // ── Memory recall trigger (stream) ─────────────────────────
    const memRecallIntent = /\b(what do you know about me|what have you learned|tell me what you know|my preferences|my profile|what you remember|memories|forget everything)\b/i.test(userText);
    if (memRecallIntent) {
      const mem = loadMemory();
      const memCtxExtra = buildMemoryContext(mem);
      if (memCtxExtra) {
        systemContent += `\n\n[ALEC MEMORY — facts learned about Alec in past conversations]\n${memCtxExtra}\nTell the user what you know about them from memory. If they ask to forget, tell them you can clear your memory if they confirm.`;
      } else {
        systemContent += '\n\n[ALEC MEMORY] No personal facts stored yet. You are just getting started learning about Alec.';
      }
    }

    // ── Research agent trigger (stream) ───────────────────────
    const researchIntent = /\b(research|look into|investigate|find out about|dig into|study|analyze|analyse)\b.{3,100}(\bfor me\b|\bplease\b|$)/i.test(userText) ||
                           /\bdo (a |some |deep )?research (on|about|into)\b/i.test(userText);
    if (researchIntent && research && isOwnerStream) {
      try {
        // Extract topic from the message
        const topicMatch = userText.match(/(?:research|look into|investigate|find out about|dig into|study|analyze|analyse)\s+(.+?)(?:\s+for me\s*$|\s*please\s*$|$)/i);
        const topic = (topicMatch?.[1] || userText).replace(/^(do\s+)?(a\s+|some\s+|deep\s+)?research\s+(on|about|into)\s+/i, '').trim().slice(0, 200);
        if (topic.length > 5) {
          res.write('data: {"token":"🔍 Starting background research…\\n"}\n\n');
          const job = research.startResearch(topic, { notifyWhenDone: true, saveReport: true });
          systemContent += `\n\n[RESEARCH AGENT TRIGGERED] A deep research job has been started for: "${topic}". Job ID: ${job.id}. It will run in the background and send you an iMessage notification when the report is ready. Tell the user this clearly.`;
          console.log('[Research] Started background research job:', job.id, 'topic:', topic.slice(0, 60));
        }
      } catch (resErr) {
        console.warn('[Research trigger] Failed:', resErr.message?.slice(0, 80));
      }
    }

    // ── iMessage RAG (stream) ─────────────────────────────────
    const iMsgIntentStream = /\b(check|read|show|get|look at|fetch|see)\b.{0,30}\b(imessages?|messages?|texts?|sms)\b|\b(recent|new|unread|latest)\b.{0,20}\b(imessages?|messages?|texts?)\b|\bwho texted\b|\bdid.*text(ed)?\b|\bany.*messages\b/i.test(userText);
    if (iMsgIntentStream && iMessage) {
      try {
        res.write('data: {"token":"💬 Reading recent iMessages…\\n"}\n\n');
        const convos = await iMessage.getConversations();
        if (convos && convos.length > 0) {
          const recent = convos.slice(0, 8).map(c =>
            `- ${c.name || c.handle}: "${c.lastMessage?.slice(0, 120) || '(no preview)'}" (${c.lastDate ? new Date(c.lastDate).toLocaleString() : 'unknown'})`
          ).join('\n');
          systemContent += `\n\n[iMessage DATA — from this Mac's Messages.app]\nRecent conversations:\n${recent}`;
        } else {
          systemContent += '\n\n[iMessage DATA] No conversations found — may need Full Disk Access permission for Messages.';
        }
      } catch (imErr) {
        systemContent += `\n\n[iMessage DATA] Could not read messages: ${imErr.message}`;
      }
    }

    // ── Source-preference override (parses "from stoa", "not tenantcloud", etc.) ──
    // Hard rule: when the user explicitly names a source, ONLY that source fires.
    // When the user excludes a source ("not tenantcloud"), that source is gated off
    // regardless of keyword matches.
    const sourcePref = (() => {
      const t = userText.toLowerCase();
      const excl = new Set();
      const only = new Set();
      // "not tenantcloud", "don't use tc", "skip tenantcloud"
      if (/\b(not|no|don'?t\s+use|skip|without|exclude|avoid)\s+(tenantcloud|tc)\b/.test(t)) excl.add('tc');
      if (/\b(not|no|don'?t\s+use|skip|without|exclude|avoid)\s+stoa\b/.test(t))             excl.add('stoa');
      // "from stoa data", "use stoa", "stoa only"
      if (/\b(from|use|only|via)\s+stoa\b|\bstoa\s+only\b|\bstoa\s+data\b/.test(t)) only.add('stoa');
      if (/\b(from|use|only|via)\s+tenantcloud\b|\btenantcloud\s+only\b/.test(t))   only.add('tc');
      return { excluded: excl, onlyThese: only };
    })();
    const allowStoa = !sourcePref.excluded.has('stoa') && (sourcePref.onlyThese.size === 0 || sourcePref.onlyThese.has('stoa'));
    const allowTC   = !sourcePref.excluded.has('tc')   && (sourcePref.onlyThese.size === 0 || sourcePref.onlyThese.has('tc'));

    // ── STOA RAG: inject live database context ────────────────
    // STOA has source precedence (per hard rule H1) — when STOA returns data,
    // TenantCloud is suppressed for overlapping intents (property/lease/unit/contract).
    let stoaFired = false;
    if (allowStoa) {
      try {
        const stoaCtx = await stoaQuery.buildStoaContext(userText);
        if (stoaCtx) {
          systemContent += '\n\n' + stoaCtx;
          res.write('data: {"token":"📊 Loading live STOA portfolio data…\\n"}\n\n');
          console.log('[STOA RAG stream] Injected live data for:', userText.slice(0, 60));
          stoaFired = true;
        }
      } catch (stoaErr) {
        console.warn('[STOA RAG stream] Failed (non-critical):', stoaErr.message?.slice(0, 80));
      }
    } else {
      console.log('[STOA RAG stream] Skipped — user excluded stoa or requested other source');
    }

    // ── GitHub RAG + Actions trigger (stream) ─────────────────
    const ghIntentStream = /\b(github|git|commit|repo|repository|pull.?request|pr|issue|branch|code|deploy|push|merge|workflow|action|ci|pipeline)\b/i.test(userText);
    if (ghIntentStream && github && process.env.GITHUB_TOKEN) {
      try {
        const defaultRepo = process.env.GITHUB_REPO || 'arovn10/A.L.E.C';
        res.write('data: {"token":"🐙 Fetching GitHub repo data…\\n"}\n\n');
        const repoData = await github.getRepo(defaultRepo).catch(() => null);
        if (repoData) {
          let ghCtx = `[GitHub DATA — ${defaultRepo}]\n`;
          ghCtx += `Repo: ${repoData.full_name || defaultRepo} | Stars: ${repoData.stargazers_count || 0} | Branch: ${repoData.default_branch || 'main'} | Updated: ${repoData.updated_at ? new Date(repoData.updated_at).toLocaleDateString() : 'unknown'}\n`;
          ghCtx += `Description: ${repoData.description || 'No description'}\n`;
          // Also inject recent workflow runs if workflow intent
          if (/\b(workflow|action|ci|pipeline|run|build)\b/i.test(userText)) {
            const runs = await github.listWorkflowRuns(defaultRepo, 5).catch(() => []);
            if (runs.length > 0) {
              ghCtx += `Recent workflow runs:\n` + runs.map(r => `  - ${r.name}: ${r.status}/${r.conclusion || 'in-progress'} (branch: ${r.branch})`).join('\n') + '\n';
            }
          }
          systemContent += '\n\n' + ghCtx;
        }

        // ── GitHub Actions: trigger workflow from chat ──────────
        // Detects: "run the deploy workflow", "trigger CI", "start GitHub Actions"
        const ghActionRe = /\b(run|trigger|start|kick\s*off|dispatch)\b.{0,40}\b(workflow|action|ci|pipeline|deploy\.yml|test\.yml)\b/i;
        if (ghActionRe.test(userText)) {
          const workflows = await github.listWorkflows(defaultRepo).catch(() => []);
          if (workflows.length > 0) {
            // Try to match by name or path keyword in user text
            const nameLower = userText.toLowerCase();
            const match = workflows.find(w =>
              nameLower.includes(w.name.toLowerCase()) ||
              nameLower.includes(w.path.split('/').pop().toLowerCase())
            ) || workflows[0];
            const ref = /\b(branch|on)\s+(\S+)/i.exec(userText)?.[2] || 'main';
            await github.triggerWorkflow(match.id, ref, {}, defaultRepo);
            systemContent += `\n\n[GitHub Actions TRIGGERED] Dispatched workflow "${match.name}" on branch "${ref}". Tell the user the workflow was triggered and they can monitor it on GitHub Actions.`;
            console.log('[GitHub Actions] Triggered workflow:', match.name, 'ref:', ref);
          }
        }
      } catch (ghErr) {
        console.warn('[GitHub RAG stream] Failed (non-critical):', ghErr.message?.slice(0, 80));
      }
    }

    // ── Home Assistant RAG (stream) ────────────────────────────
    const haIntentStream = /\b(light|lights|thermostat|temperature|lock|door|garage|fan|switch|scene|automation|smart.?home|home.?assistant|device|sensor|camera|alarm|hvac|ac|heat|cool|humidity|motion)\b/i.test(userText);
    const haUrlStr   = process.env.HOME_ASSISTANT_URL || process.env.HA_URL;
    const haTokenStr = process.env.HOME_ASSISTANT_ACCESS_TOKEN || process.env.HA_TOKEN;
    if (haIntentStream && haUrlStr && haTokenStr) {
      try {
        res.write('data: {"token":"🏡 Reading Home Assistant device states…\\n"}\n\n');
        const haResp = await fetch(`${haUrlStr}/api/states`, {
          headers: { Authorization: `Bearer ${haTokenStr}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(5000),
        });
        if (haResp.ok) {
          const states = await haResp.json();
          const relevant = states.filter(s =>
            /^(light|lock|climate|switch|binary_sensor|sensor|input_boolean|cover|fan|camera|alarm_control_panel)\../.test(s.entity_id)
          ).slice(0, 30);
          if (relevant.length > 0) {
            const lines = relevant.map(s => {
              const name = s.attributes?.friendly_name || s.entity_id;
              const extra = s.attributes?.temperature ? ` (${s.attributes.temperature}°${s.attributes.unit_of_measurement || 'F'})` :
                            s.attributes?.brightness ? ` (brightness: ${Math.round(s.attributes.brightness / 255 * 100)}%)` : '';
              return `- ${name}: ${s.state}${extra}`;
            });
            systemContent += `\n\n[Home Assistant DATA — live device states]\n${lines.join('\n')}`;
          }
        }
      } catch (haErr) {
        console.warn('[HA RAG stream] Failed (non-critical):', haErr.message?.slice(0, 80));
      }
    }

    // ── AWS / Website RAG (stream) ─────────────────────────────
    const awsIntentStream = /\b(campus|campusrental|website|server|aws|ec2|nginx|deploy|ssh|uptime|down|offline|traffic|hosting)\b/i.test(userText);
    if (awsIntentStream && awsSvc) {
      try {
        res.write('data: {"token":"☁️ Checking AWS website status…\\n"}\n\n');
        const websiteStatus = await awsSvc.checkWebsiteStatus();
        let awsCtx = `[AWS DATA — campusrentalsllc.com server status]\n`;
        awsCtx += `Website: ${websiteStatus.online ? '✅ Online' : '❌ Offline'} (host: ${process.env.AWS_WEBSITE_HOST || 'not configured'})\n`;
        if (websiteStatus.httpStatus) awsCtx += `HTTP status: ${websiteStatus.httpStatus}\n`;
        if (websiteStatus.httpError) awsCtx += `Error: ${websiteStatus.httpError}\n`;
        systemContent += '\n\n' + awsCtx;
      } catch (awsErr) {
        console.warn('[AWS RAG stream] Failed (non-critical):', awsErr.message?.slice(0, 80));
      }
    }

    // ── Plaid RAG (stream) ─────────────────────────────────────
    const plaidIntentStream = /\b(investment|portfolio|holdings|brokerage|schwab|fidelity|acorns|stock|balance|account|net.?worth|finance|financial|money|wealth)\b/i.test(userText);
    const isOwnerStream = streamUserId === 'alec-owner' || req.user?.tokenType === 'OWNER' || req.user?.role === 'owner';
    if (plaidIntentStream && isOwnerStream && process.env.PLAID_CLIENT_ID) {
      try {
        const items = await plaidDbAll('SELECT item_id, institution_name, access_token_enc FROM plaid_items').catch(() => []);
        if (items.length > 0) {
          res.write('data: {"token":"💰 Pulling Plaid brokerage holdings…\\n"}\n\n');
          let totalValue = 0;
          const accountLines = [];
          for (const item of items.slice(0, 5)) {
            try {
              const accessToken = decryptAccessToken(item.access_token_enc);
              const data = await plaidFetch('/investments/holdings/get', { access_token: accessToken });
              for (const acct of (data.accounts || [])) {
                const val = acct.balances?.current || 0;
                totalValue += val;
                accountLines.push(`  ${item.institution_name} — ${acct.name}: $${val.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
              }
            } catch (_) {}
          }
          if (accountLines.length > 0) {
            systemContent += `\n\n[Plaid Financial DATA — live brokerage accounts]\nTotal portfolio value: $${totalValue.toLocaleString('en-US', {minimumFractionDigits: 2})}\nAccounts:\n${accountLines.join('\n')}`;
          }
        }
      } catch (plaidErr) {
        console.warn('[Plaid RAG stream] Failed (non-critical):', plaidErr.message?.slice(0, 80));
      }
    }

    // ── TenantCloud RAG (stream) ────────────────────────────────
    // Precedence rule: TC only fires when (a) the user didn't exclude it,
    // (b) STOA didn't already inject data for an overlapping property/lease
    // intent (unless the user explicitly asked for TenantCloud), and
    // (c) something is actually available to load — the "Loading…" token
    // is emitted AFTER we confirm a cache hit or scraper, not before.
    const tcExplicit = sourcePref.onlyThese.has('tc') || /\btenantcloud\b/i.test(userText);
    const tcIntentStream = /\b(tenants?|rent|payments?|overdue|maintenance|leases?|property|properties|units?|inquiry|inquiries|renters?|move.?out|move.?in|vacancy|vacant|occupan|evict)\b/i.test(userText);
    const tcShouldFire = allowTC && tcIntentStream && (tcExplicit || !stoaFired);
    if (tcShouldFire) {
      try {
        let tcCtx = '';

        // Try browser-relay cache first (most reliable — real data from authenticated browser)
        const cacheKeys = Object.keys(tcCache).filter(k => !k.startsWith('_'));
        if (cacheKeys.length > 0) {
          const age = tcCache._lastPush ? Math.round((Date.now() - new Date(tcCache._lastPush)) / 60000) : '?';
          tcCtx = `[TenantCloud DATA — captured from authenticated browser ${age} min ago]\n`;
          for (const key of cacheKeys) {
            const entry = tcCache[key];
            const d = entry.data;
            const items = Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : (d ? [d] : []));
            if (items.length > 0) {
              tcCtx += `\n## ${key.replace(/_/g, '/')} (${items.length} records)\n`;
              tcCtx += JSON.stringify(items.slice(0, 20), null, 1).slice(0, 1500) + '\n';
            }
          }
          console.log('[TenantCloud RAG stream] Served from browser-relay cache');
        } else if (tenantCloud) {
          // Fall back to Puppeteer scraper
          const summary = await tenantCloud.getPortfolioSummary();
          const overdueRent = await tenantCloud.getOverdueRent().catch(() => []);
          const openMaint   = await tenantCloud.getOpenMaintenance().catch(() => []);
          tcCtx = `[TenantCloud DATA — live property management data]\n`;
          tcCtx += `Portfolio: ${summary.properties?.total || 0} properties, ${summary.tenants?.total || 0} tenants (${summary.tenants?.active || 0} active)\n`;
          if (summary.overdue?.count > 0) tcCtx += `⚠️ Overdue rent: ${summary.overdue.count} payments, $${summary.overdue.totalAmount?.toLocaleString()}\n`;
          if (summary.maintenance?.open > 0) tcCtx += `🔧 Open maintenance: ${summary.maintenance.open} requests (${summary.maintenance.highPriority} high priority)\n`;
          if (summary.messages?.unread > 0) tcCtx += `💬 Unread messages: ${summary.messages.unread}\n`;
          if (summary.inquiries?.new > 0) tcCtx += `🔔 New inquiries: ${summary.inquiries.new}\n`;
          if (overdueRent.length > 0) tcCtx += `Overdue tenants: ${overdueRent.slice(0, 5).map(p => `${p.tenant} ($${p.amount})`).join(', ')}\n`;
          if (openMaint.length > 0) tcCtx += `Maintenance: ${openMaint.slice(0, 3).map(m => `${m.property}/${m.unit} — ${m.title} [${m.priority}]`).join(' | ')}`;
          console.log('[TenantCloud RAG stream] Injected via Puppeteer scraper');
        }

        if (tcCtx) {
          // Only stream the loading status once we actually have data — avoids
          // the "🏠 Loading TenantCloud rentals data…" ghost token with no payload.
          res.write('data: {"token":"🏠 Loading TenantCloud rentals data…\\n"}\n\n');
          systemContent += '\n\n' + tcCtx;
        }
      } catch (tcErr) {
        console.warn('[TenantCloud RAG stream] Failed (non-critical):', tcErr.message?.slice(0, 80));
      }
    } else if (tcIntentStream && !allowTC) {
      console.log('[TenantCloud RAG stream] Suppressed — user excluded TC or requested stoa-only');
    } else if (tcIntentStream && stoaFired && !tcExplicit) {
      console.log('[TenantCloud RAG stream] Suppressed — STOA took precedence for overlapping intent');
    }

    // ── Vercel RAG (stream) ───────────────────────────────────
    const vercelIntentStream = /\bvercel\b|\b(deployment|deploy|production|preview|build|frontend|hosting)\b/i.test(userText);
    if (vercelIntentStream && vercelSvc && process.env.VERCEL_TOKEN) {
      try {
        res.write('data: {"token":"▲ Fetching Vercel deployments…\\n"}\n\n');
        const deployments = await vercelSvc.listDeployments(3);
        if (deployments.length > 0) {
          const lines = deployments.map(d =>
            `- ${d.target || 'preview'}: ${d.state} | ${d.url || 'building'} | branch: ${d.branch} | "${d.commit?.slice(0, 60) || ''}"`
          );
          systemContent += `\n\n[Vercel DATA — recent deployments for ${process.env.VERCEL_PROJECT || 'alec-ai'}]\n${lines.join('\n')}`;
        }
      } catch (vercelErr) {
        console.warn('[Vercel RAG stream] Failed (non-critical):', vercelErr.message?.slice(0, 80));
      }
    }

    // Web search augmentation
    // If the SPA sent only `{message}` (no `messages[]` array), synthesise a
    // one-turn conversation so the LLM actually sees the user's prompt.
    let augmentedMessages = Array.isArray(messages) && messages.length > 0
      ? [...messages]
      : (userText ? [{ role: 'user', content: userText }] : []);
    // SPA sends only `{message}` — rehydrate up to last 6 turns from stored history
    // so short follow-ups like "and outlook" carry prior intent into tool-call args.
    if ((!Array.isArray(messages) || messages.length === 0) && chatHistory && convId) {
      try {
        const hist = chatHistory.getMessages(convId, 12) || [];
        // Strip the current user turn we just persisted (it's the tail)
        const prior = hist.slice(0, -1).filter(m => m.role === 'user' || m.role === 'assistant').slice(-6);
        if (prior.length) {
          augmentedMessages = [
            ...prior.map(m => ({ role: m.role, content: String(m.content || '') })),
            { role: 'user', content: userText },
          ];
        }
      } catch (e) {
        console.warn('[chat:stream] history rehydrate failed:', e.message);
      }
    }
    // Affirmation nudge: when current turn is a bare "yes/go ahead/do it/continue"
    // AND there is a prior assistant turn proposing action, prepend a directive so
    // the model follows through instead of restarting or asking again.
    {
      const u = String(userText || '').trim().toLowerCase();
      const isAffirmation = /^(yes|y|yep|yeah|yup|ok|okay|sure|go ahead|do it|proceed|continue|keep going|execute|run it|confirmed|please do)\b[.!?]?$/i.test(u) || u.length <= 3;
      const lastAssistant = [...augmentedMessages].reverse().find(m => m.role === 'assistant')?.content;
      if (isAffirmation && lastAssistant) {
        systemContent += `\n\n[AFFIRMATION CONTEXT] The user just replied "${userText}" — this is affirmation/consent to the action you proposed in your previous turn.

Your previous message was:
"""
${String(lastAssistant).slice(0, 800)}
"""

Rules for this turn (MANDATORY):
1. Re-read the options/plan in your previous message.
2. If the user's reply matches an option letter or number (A/B/C/1/2/3), EXECUTE THAT OPTION NOW by calling the required tool(s) — do NOT just describe what you're about to do.
3. If the option requires data from a tool (Zapier, MCP, Stoa, filesystem, desktop), YOU MUST call that tool in this same turn. Saying "I'm doing X" without calling the tool is a failure.
4. Do NOT ask for permission again. Do NOT restart. Do NOT summarize unrelated data.
5. After the tool returns, give the user the result in 1–3 sentences with the real source footer.`;
      }
    }
    if (SEARCH_TRIGGERS.test(userText)) {
      res.write('data: {"token":"🔍 Searching the web…\\n"}\n\n');
      const searchResult = await webSearch(userText);
      if (searchResult && augmentedMessages.length > 0) {
        const lastMsg = augmentedMessages.at(-1);
        augmentedMessages[augmentedMessages.length - 1] = {
          ...lastMsg,
          content: lastMsg.content + `\n\n[Web search results for context]:\n${searchResult}`,
        };
        res.write('data: {"token":"\\n"}\n\n');
      }
    }

    const llmMessages = [{ role: 'system', content: systemContent }, ...augmentedMessages];
    let fullResponse  = '';
    let streamToolCalls = [];

    // Blank line between status/thinking lines and the model's answer,
    // so the chat bubble reads:
    //   📊 Loading live STOA portfolio data…
    //   🏠 Loading TenantCloud rentals data…
    //
    //   <model answer starts here>
    res.write('data: {"token":"\\n"}\n\n');

    // ── Route: tool-use path vs. local Llama stream ──
    // If the turn looks like it needs live tools AND Anthropic is configured,
    // run the tool-use loop. Stream the final text as a single block (tools
    // break token-by-token streaming; final message is emitted at once so the
    // bubble still renders cleanly).
    const _lastAssistantForGate = [...augmentedMessages].reverse().find(m => m.role === 'assistant')?.content || '';
    const needsTools = turnNeedsTools(userText, { lastAssistant: _lastAssistantForGate });
    const useAnthropic = needsTools && !!process.env.ANTHROPIC_API_KEY;
    const useLlamaTools = needsTools && !useAnthropic && llamaEngine.getStatus().loaded;
    console.log(`[chat:stream] GATE needsTools=${needsTools} useAnthropic=${useAnthropic} useLlamaTools=${useLlamaTools} loaded=${llamaEngine.getStatus().loaded} userText="${String(userText).slice(0,80)}"`);
    if (useAnthropic) {
      try {
        // Signal tool-use phase via a separate SSE channel so the UI can
        // render a subtle indicator WITHOUT leaking scaffolding into the
        // chat bubble. Frontend ignores unknown fields gracefully.
        res.write(`data: ${JSON.stringify({ phase: 'tools' })}\n\n`);
        const { text, toolCalls } = await callClaudeWithTools(llmMessages);
        streamToolCalls = toolCalls || [];
        if (toolCalls?.length) {
          // Tool-call metadata goes on the `tool_calls` channel — debug/observability
          // only, never rendered as chat text.
          res.write(`data: ${JSON.stringify({ tool_calls: toolCalls.map(t => ({ ok: !!t.ok, server: t.server || null, tool: t.tool || t.name || null })) })}\n\n`);
        }
        fullResponse = text || '';
        if (fullResponse) res.write(`data: ${JSON.stringify({ token: fullResponse })}\n\n`);
      } catch (toolErr) {
        console.warn('[chat:stream] Claude tool-use loop failed — trying local Llama tools:', toolErr.message);
        try {
          const { text, toolCalls } = await callLlamaWithTools(llmMessages);
          streamToolCalls = toolCalls || [];
          if (toolCalls?.length) {
            res.write(`data: ${JSON.stringify({ tool_calls: toolCalls.map(t => ({ ok: !!t.ok, tool: t.name || null })) })}\n\n`);
          }
          fullResponse = text || '';
          if (fullResponse) res.write(`data: ${JSON.stringify({ token: fullResponse })}\n\n`);
        } catch (llamaToolErr) {
          console.warn('[chat:stream] Llama tool-use also failed — plain stream:', llamaToolErr.message);
          for await (const token of callLLMStream(llmMessages)) {
            if (token) { fullResponse += token; res.write(`data: ${JSON.stringify({ token })}\n\n`); }
          }
        }
      }
    } else if (useLlamaTools) {
      try {
        res.write(`data: ${JSON.stringify({ phase: 'tools' })}\n\n`);
        const { text, toolCalls } = await callLlamaWithTools(llmMessages);
        streamToolCalls = toolCalls || [];
        if (toolCalls?.length) {
          res.write(`data: ${JSON.stringify({ tool_calls: toolCalls.map(t => ({ ok: !!t.ok, tool: t.name || null })) })}\n\n`);
        }
        fullResponse = text || '';
        if (fullResponse) res.write(`data: ${JSON.stringify({ token: fullResponse })}\n\n`);
      } catch (llamaToolErr) {
        console.warn('[chat:stream] Llama tool-use loop failed — plain stream:', llamaToolErr.message);
        for await (const token of callLLMStream(llmMessages)) {
          if (token) { fullResponse += token; res.write(`data: ${JSON.stringify({ token })}\n\n`); }
        }
      }
    } else {
      // ── node-llama-cpp streaming (Metal GPU, no external server) ──
      for await (const token of callLLMStream(llmMessages)) {
        if (token) {
          fullResponse += token;
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      }
    }

    // Empty-response guard with real Anthropic fallback. If the local model
    // yielded nothing AND Anthropic is configured, do one silent retry through
    // Claude (no tools — this is the "model went blank" recovery path, not a
    // tool-intent turn). Only if that also produces nothing do we emit the
    // visible fallback line.
    if (!fullResponse.trim()) {
      if (process.env.ANTHROPIC_API_KEY && !needsTools) {
        try {
          console.warn('[chat:stream] empty Llama output — retrying via Anthropic');
          const recovered = await callClaudeText(llmMessages);
          if (recovered?.trim()) {
            fullResponse = recovered.trim();
            res.write(`data: ${JSON.stringify({ token: fullResponse })}\n\n`);
          }
        } catch (recErr) {
          console.warn('[chat:stream] Anthropic recovery failed:', recErr.message);
        }
      }
    }
    if (!fullResponse.trim()) {
      const fallback = "Sorry — I hit a blank on that one. Mind asking again?";
      fullResponse = fallback;
      res.write(`data: ${JSON.stringify({ token: fallback })}\n\n`);
      console.warn('[chat:stream] empty model output — emitted fallback');
    }

    // After the token loop completes, enforce hard rules before sending done signal
    try {
      enforceHardRules(fullResponse);
    } catch (ruleErr) {
      console.error('[HardRule violation - stream]', ruleErr.message);
      res.write(`data: ${JSON.stringify({ hardRuleViolation: true, rule: ruleErr.message })}\n\n`);
    }

    // Strip fabricated "Source: X" footers for sources not injected this turn.
    // We can't retroactively edit tokens already streamed, but we MUST store
    // the corrected version so the model's next-turn context doesn't include
    // a phantom "Source: STOA" it can later be cross-examined on.
    const _streamToolsRan = (streamToolCalls?.length || 0) > 0;
    let correctedFull = fullResponse;
    if (detectFakeToolOutput(correctedFull, { toolsCalled: _streamToolsRan })) {
      console.warn('[anti-hallu stream] fabricated MCP output detected; rewriting history.');
      correctedFull = MCP_REFUSAL;
      // Flag the SPA so it can replace what it streamed with the corrected text.
      res.write(`data: ${JSON.stringify({ replaceFull: true, corrected: MCP_REFUSAL, reason: 'fabricated_mcp_output' })}\n\n`);
    }
    correctedFull = stripFalseSourceFooters(correctedFull, systemContent, { toolsCalled: _streamToolsRan });
    if (correctedFull !== fullResponse) {
      res.write(`data: ${JSON.stringify({ sourceCorrection: true, note: 'One or more source footers were unverified and have been relabeled in history.' })}\n\n`);
    }

    // Save assistant response to history (corrected version — prevents
    // future-turn self-reference to hallucinated source tags).
    if (chatHistory && convId && correctedFull) {
      try { chatHistory.addMessage(convId, 'assistant', correctedFull); } catch (_) {}
    }

    // Signal completion with metadata (including conversation_id so frontend can persist it)
    res.write(`data: ${JSON.stringify({ done: true, latency_ms: Date.now(), conversation_id: convId })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();

    // Async quality scoring for stream responses
    if (qualityScorer && fullResponse && userText) {
      setImmediate(() => {
        try {
          qualityScorer.score({
            turnId:       (convId || 'stream') + '-' + Date.now(),
            sessionId:    session_id || convId,
            userMsg:      userText,
            alecResponse: fullResponse,
          });
        } catch (scoreErr) {
          console.error('[qualityScorer stream] score() failed:', scoreErr.message);
        }
      });
    }

    // Async: extract facts, log interaction
    extractAndStoreFacts(userText, fullResponse).catch(() => {});
    try { await adaptiveLearning.logInteraction({ userId: streamUserId, message: userText, timestamp: Date.now() }); } catch(_){}

  } catch (err) {
    console.error('Stream error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
};

// Register the streaming handler for both GET (browser EventSource) and
// POST (native fetch / SSE over POST body) so the SPA's EventSource
// client and programmatic callers both work.
app.get('/api/chat/stream',  authenticateToken, chatStreamHandler);
app.post('/api/chat/stream', authenticateToken, chatStreamHandler);

// ════════════════════════════════════════════════════════════════
//  FEEDBACK ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/feedback
 * Body: { conversationId, rating, feedback? }
 * Forwards to Python /feedback.
 */
app.post('/api/feedback', authenticateToken, async (req, res) => {
  try {
    const convId = req.body.conversationId || req.body.conversation_id;
    const { rating, feedback, response_text, prompt_text } = req.body;

    if (rating === undefined) return res.status(400).json({ error: 'rating is required' });

    // Write to JSONL feedback log for self-improvement analysis
    const entry = {
      ts:           new Date().toISOString(),
      conversation_id: convId,
      rating,           // 1 = thumbs up, -1 = thumbs down
      feedback:     feedback || '',
      prompt:       prompt_text || '',
      response:     response_text || '',
      user_id:      req.user?.userId,
    };
    fs.appendFileSync(FEEDBACK_FILE, JSON.stringify(entry) + '\n');

    // If negative feedback, store a preference note
    if (rating === -1 && response_text) {
      const mem = loadMemory();
      mem.preferences = mem.preferences || [];
      mem.preferences.push(`Alec rated this response poorly: "${response_text.slice(0, 100)}…"`);
      mem.preferences = mem.preferences.slice(-20); // keep last 20
      saveMemory(mem);
    }

    res.json({ success: true, logged: true });
  } catch (error) {
    console.error('Feedback error:', error);
    res.status(500).json({ error: 'Feedback submission failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  MEMORY ENDPOINTS
//  Read / write Alec's persistent facts and preferences.
// ════════════════════════════════════════════════════════════════

/** GET /api/memory — return current memory */
app.get('/api/memory', authenticateToken, (req, res) => {
  res.json(loadMemory());
});

/** POST /api/memory/fact — add a fact manually */
app.post('/api/memory/fact', authenticateToken, (req, res) => {
  const { fact } = req.body;
  if (!fact) return res.status(400).json({ error: 'fact is required' });
  const mem = loadMemory();
  mem.facts = [...(mem.facts || []), fact].slice(-50);
  saveMemory(mem);
  res.json({ success: true, total_facts: mem.facts.length });
});

/** DELETE /api/memory — wipe all memory */
app.delete('/api/memory', authenticateToken, (req, res) => {
  saveMemory({ facts: [], preferences: [], summaries: [], promptVersion: 1 });
  res.json({ success: true, message: 'Memory cleared.' });
});

// ════════════════════════════════════════════════════════════════
//  DESKTOP CONTROL SKILLS
// ════════════════════════════════════════════════════════════════

/** GET /api/skills — list available desktop skills */
app.get('/api/skills', authenticateToken, (req, res) => {
  res.json({ skills: desktopControl.listSkills() });
});

/** POST /api/skills/run — execute a skill */
app.post('/api/skills/run', authenticateToken, async (req, res) => {
  const { skill, args = {} } = req.body;
  if (!skill) return res.status(400).json({ error: 'skill name required' });
  const result = await desktopControl.executeSkill(skill, args);
  res.json(result);
});

/** POST /api/skills/screenshot — convenience endpoint */
app.post('/api/skills/screenshot', authenticateToken, async (req, res) => {
  const result = await desktopControl.executeSkill('screenshot', {});
  if (result.success) {
    res.json({ success: true, path: result.result });
  } else {
    res.status(500).json(result);
  }
});

// Augment the chat endpoint to detect and run skills
// This runs before the LLM call in /api/chat and /api/chat/stream
async function maybeRunDesktopSkill(userText) {
  const intent = desktopControl.detectSkillIntent(userText);
  if (!intent) return null;
  const result = await desktopControl.executeSkill(intent.skill, intent.args);
  if (!result.success) return null;
  return { skill: intent.skill, result: result.result };
}

// ════════════════════════════════════════════════════════════════
//  MODEL MANAGEMENT (HuggingFace / local GGUF)
// ════════════════════════════════════════════════════════════════

/** GET /api/models — list all available GGUF models */
app.get('/api/models', authenticateToken, (req, res) => {
  res.json({ models: llamaEngine.listModels(), current: llamaEngine.getStatus() });
});

/** POST /api/models/download — download a model from HuggingFace */
app.post('/api/models/download', authenticateToken, requireFullCapabilities, async (req, res) => {
  const { repoId, fileName } = req.body;
  if (!repoId || !fileName) return res.status(400).json({ error: 'repoId and fileName required' });
  try {
    const modelPath = await llamaEngine.downloadFromHuggingFace(repoId, fileName);
    res.json({ success: true, modelPath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  CONVERSATION HISTORY
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/conversations/history
 * Query: ?limit=50
 * Forwards to Python /conversations.
 */
app.get('/api/conversations/history', authenticateToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const data = await proxyToNeural('/conversations', {
      query: `limit=${limit}&offset=${offset}`,
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Conversation history error:', error);
    res.status(500).json({ error: 'Failed to fetch conversation history', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  MODEL INFO
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/model/info
 * Forwards to Python /model/info.
 */
app.get('/api/model/info', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/model/info');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Model info error:', error);
    res.json({ success: true, model_name: 'Qwen2.5-Coder-7B', status: 'neural_offline', loaded: false, message: 'Neural engine unavailable' });
  }
});

// ════════════════════════════════════════════════════════════════
//  TRAINING PIPELINE ENDPOINTS  (requires FULL_CAPABILITIES)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/training/start
 * Body: { dataPath?, config? }
 * Forwards to Python /training/start.
 */
app.post('/api/training/start', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { dataPath, config } = req.body;
    const data = await proxyToNeural('/training/start', {
      method: 'POST',
      body: { data_path: dataPath, config: config || {} },
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training start error:', error);
    res.status(500).json({ error: 'Training start failed', message: error.message });
  }
});

/**
 * GET /api/training/status
 * Forwards to Python /training/status.
 */
app.get('/api/training/status', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/training/status');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training status error:', error);
    res.status(500).json({ error: 'Failed to fetch training status', message: error.message });
  }
});

/**
 * POST /api/training/export
 * Forwards to Python /training/export.
 */
app.post('/api/training/export', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const data = await proxyToNeural('/training/export', { method: 'POST', body: req.body || {} });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training export error:', error);
    res.status(500).json({ error: 'Training export failed', message: error.message });
  }
});

/**
 * GET /api/training/adapters
 * Forwards to Python /training/adapters.
 */
app.get("/api/training/history", authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural("/training/history");
    res.json(data);
  } catch (error) {
    res.json({ training_runs: [], evolution_log: [], error: error.message });
  }
});

app.get('/api/training/adapters', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/training/adapters');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Training adapters error:', error);
    res.status(500).json({ error: 'Failed to fetch adapters', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  FILE UPLOAD ENDPOINTS  (requires FULL_CAPABILITIES)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/files/upload
 * Multipart form-data. Saves to data/uploads/, stores metadata.
 */
app.post('/api/files/upload', authenticateToken, requireFullCapabilities, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const fileMeta = {
      filename: req.file.filename,
      originalName: req.file.originalname,
      sizeBytes: req.file.size,
      mimeType: req.file.mimetype,
      path: req.file.path,
      uploadedAt: new Date().toISOString(),
      uploadedBy: req.user.userId,
      processed: false,
      trainingExamples: 0,
    };

    // Notify Python engine about the new file so it can record metadata in DB
    try {
      await proxyToNeural('/files/register', {
        method: 'POST',
        body: {
          filename: fileMeta.filename,
          original_name: fileMeta.originalName,
          size_bytes: fileMeta.sizeBytes,
          mime_type: fileMeta.mimeType,
          filepath: fileMeta.path,
        },
      });
    } catch (_) {
      // Non-fatal: Python engine may not have /files/register, continue
    }

    res.json({
      success: true,
      file: fileMeta,
      uploadUrl: `/uploads/${req.file.filename}`,
    });
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'File upload failed', message: error.message });
  }
});

/**
 * GET /api/files
 * Lists all uploaded files from data/uploads/.
 */
app.get('/api/files', authenticateToken, async (req, res) => {
  try {
    // Try to get enriched metadata from Python engine
    let pythonFiles = null;
    try {
      pythonFiles = await proxyToNeural('/files');
    } catch (_) {
      // Fall back to local directory listing
    }

    if (pythonFiles) {
      return res.json({ success: true, ...pythonFiles });
    }

    // Local fallback: read the uploads directory
    const entries = fs.readdirSync(UPLOADS_DIR);
    const files = entries.map((filename) => {
      const filepath = path.join(UPLOADS_DIR, filename);
      const stat = fs.statSync(filepath);
      return {
        filename,
        sizeBytes: stat.size,
        uploadedAt: stat.birthtime.toISOString(),
        url: `/uploads/${filename}`,
      };
    });

    res.json({ success: true, files, total: files.length });
  } catch (error) {
    console.error('File list error:', error);
    res.status(500).json({ error: 'Failed to list files', message: error.message });
  }
});

/**
 * DELETE /api/files/:filename
 * Deletes a file from data/uploads/.
 */
app.delete('/api/files/:filename', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { filename } = req.params;

    // Sanitize filename — prevent path traversal
    const safeFilename = path.basename(filename);
    const filepath = path.join(UPLOADS_DIR, safeFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    fs.unlinkSync(filepath);

    // Notify Python engine to remove from DB
    try {
      await proxyToNeural(`/files/${safeFilename}`, { method: 'DELETE' });
    } catch (_) {
      // Non-fatal
    }

    res.json({ success: true, message: `File ${safeFilename} deleted` });
  } catch (error) {
    console.error('File delete error:', error);
    res.status(500).json({ error: 'File deletion failed', message: error.message });
  }
});

/**
 * POST /api/files/:filename/process
 * Triggers Python to process an uploaded file into training examples.
 */
app.post('/api/files/:filename/process', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { filename } = req.params;
    const safeFilename = path.basename(filename);
    const filepath = path.join(UPLOADS_DIR, safeFilename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const data = await proxyToNeural('/files/process', {
      method: 'POST',
      body: { filename: safeFilename, filepath },
    });

    res.json({ success: true, ...data });
  } catch (error) {
    console.error('File process error:', error);
    res.status(500).json({ error: 'File processing failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TASK MANAGEMENT ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/tasks
 * Lists all background tasks from Python /tasks.
 */
app.get('/api/tasks', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/tasks');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Tasks list error:', error);
    res.status(500).json({ error: 'Failed to fetch tasks', message: error.message });
  }
});

/**
 * POST /api/tasks/:id/cancel
 * Cancels a background task.
 */
app.post('/api/tasks/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const data = await proxyToNeural(`/tasks/${id}/cancel`, { method: 'POST' });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Task cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel task', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  STOA GROUP DB ENDPOINTS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/stoa/ping
 * Quick connectivity test for the live Azure SQL STOA database.
 */
app.get('/api/stoa/ping', authenticateToken, async (req, res) => {
  const result = await stoaQuery.ping();
  res.json(result);
});

// ── Sprint-2 scope-aware gate for finance/portfolio routes ──
// Prefers new bearer-JWT `authenticate` + `requireScope('project', …)`; falls
// back to the legacy `authenticateToken` if the auth module isn't loaded
// (keeps dev builds without Sprint-1 auth still functional).
let financeAuthChain = [authenticateToken];
try {
  const mw = require('./auth/middleware');
  // Use authenticate (Bearer/device/localhost) and require the 'project'
  // scope to match ?property=… when supplied. Master/Admin bypass via '*'.
  financeAuthChain = [
    mw.authenticate,
    mw.requireScope('project', (req) => req.query.property || req.query.projectName || null),
  ];
  console.log('[auth] finance/portfolio routes gated by requireScope("project", …)');
} catch (e) {
  console.warn('[auth] scope gate unavailable, falling back to legacy authenticateToken:', e.message);
}

// ── /api/finance/* aliases (SPA-facing) ─────────────────────────
// The SPA's reports layer hits /api/finance/{ping,projects,loans,maturity,
// lenders,dscr,ltv,equity}. These thin wrappers delegate to stoaQueryService
// so the desktop app's Finance + Portfolio tabs light up against the live
// Azure SQL Stoa DB whenever STOA_DB_* env vars are present.
app.get('/api/finance/ping', ...financeAuthChain, async (_req, res) => {
  try { res.json(await stoaQuery.ping()); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.get('/api/finance/projects', ...financeAuthChain, async (req, res) => {
  try {
    const data = await stoaQuery.findProjects(req.query.search || '');
    res.json({ success: true, count: data.length, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/finance/loans', ...financeAuthChain, async (req, res) => {
  try {
    const data = await stoaQuery.getLoans(req.query.property || null);
    res.json({ success: true, count: data.length, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Maturity wall, lenders, DSCR, LTV, equity — derived from the loans table.
// If a dedicated aggregate query exists in stoaQueryService we use it;
// otherwise we compute a lightweight roll-up client-side-safe aggregate.
// Maturity wall — bucketed by calendar quarter. Frontend (reports.js) maps
// Year + Quarter → "2028 Q1" label, so we must emit those as distinct fields.
app.get('/api/finance/maturity', ...financeAuthChain, async (_req, res) => {
  try {
    const loans = await stoaQuery.getLoans(null);
    const buckets = new Map();
    for (const l of loans) {
      const d = l.MaturityDate ? new Date(l.MaturityDate) : null;
      if (!d || isNaN(d.getTime())) continue;
      const year = d.getFullYear();
      const quarter = Math.floor(d.getMonth() / 3) + 1;
      const key = `${year}-Q${quarter}`;
      const b = buckets.get(key) || { Year: year, Quarter: quarter, LoanCount: 0, TotalBalance: 0 };
      b.LoanCount += 1;
      b.TotalBalance += Number(l.OriginalAmount ?? l.CurrentBalance ?? 0);
      buckets.set(key, b);
    }
    const data = Array.from(buckets.values()).sort(
      (a, b) => a.Year - b.Year || a.Quarter - b.Quarter
    );
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Lender exposure — frontend reads `TotalExposure` (not `TotalBalance`).
app.get('/api/finance/lenders', ...financeAuthChain, async (_req, res) => {
  try {
    const loans = await stoaQuery.getLoans(null);
    const byLender = new Map();
    for (const l of loans) {
      const name = l.LenderName || l.Lender || 'Unknown';
      const b = byLender.get(name) || { LenderName: name, LoanCount: 0, TotalExposure: 0 };
      b.LoanCount += 1;
      b.TotalExposure += Number(l.OriginalAmount ?? l.CurrentBalance ?? 0);
      byLender.set(name, b);
    }
    res.json({
      success: true,
      data: Array.from(byLender.values()).sort((a, b) => b.TotalExposure - a.TotalExposure),
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DSCR — pulled from banking.Covenant (only ~5 rows have real DSCR data today,
// the rest show dashes in the UI, which is honest rather than fake).
app.get('/api/finance/dscr', ...financeAuthChain, async (_req, res) => {
  try {
    const data = await stoaQuery.getDSCRCovenants();
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// LTV — derived from loans joined with the project's ValuationWhenComplete
// and LTCOriginal. Frontend reads ProjectName, LenderName, LTV, LTC,
// ValuationWhenComplete (appraised value), CurrentBalance.
app.get('/api/finance/ltv', ...financeAuthChain, async (_req, res) => {
  try {
    const data = await stoaQuery.getLTVRows();
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Equity — real rows from banking.EquityCommitment, aggregated by project.
app.get('/api/finance/equity', ...financeAuthChain, async (_req, res) => {
  try {
    const data = await stoaQuery.getEquityCommitments();
    res.json({ success: true, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Dashboard KPIs — consolidates leasing.MMRData + banking.Loan + covenants so
// the Dashboard tab doesn't have to filter on stage labels that don't exist.
app.get('/api/portfolio/summary', ...financeAuthChain, async (_req, res) => {
  try {
    const [summary, loans, dscrRows, ltvRows] = await Promise.all([
      stoaQuery.getPortfolioSummary(),
      stoaQuery.getLoans(null),
      stoaQuery.getDSCRCovenants().catch(() => []),
      stoaQuery.getLTVRows().catch(() => []),
    ]);
    const s = summary[0] || {};
    const totalExposure = loans.reduce((a, l) => a + Number(l.OriginalAmount || 0), 0);
    const maturingSoon = loans.filter(l => Number(l.DaysToMaturity) >= 0 && Number(l.DaysToMaturity) < 90).length;
    const avg = (rows, key) => {
      const vals = rows.map(r => Number(r[key])).filter(v => Number.isFinite(v));
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    res.json({
      success: true,
      data: {
        activeProperties: Number(s.PropertyCount ?? 0),
        totalUnits: Number(s.TotalUnits ?? 0),
        totalOccupied: Number(s.TotalOccupied ?? 0),
        avgOccupancyPct: s.AvgOccupancyPct != null ? Number(s.AvgOccupancyPct) * 100 : null,
        avgLeasedPct: s.AvgLeasedPct != null ? Number(s.AvgLeasedPct) * 100 : null,
        totalExposure,
        maturingSoon,
        avgDscr: avg(dscrRows, 'ProjectedDSCR'),
        avgLtv: avg(ltvRows, 'LTV'),
      },
    });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// /api/portfolio/* alias — Portfolio tab was hitting /api/portfolio/*
app.get('/api/portfolio/pipeline', ...financeAuthChain, async (_req, res) => {
  try {
    const data = await stoaQuery.getPipelineDeals(null);
    res.json({ success: true, count: data.length, data });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

/**
 * POST /api/stoa/export
 * Generate a STOA Excel workbook and return a download URL.
 * Body: { type, property, months }
 *   type: 'portfolio' | 'trend' | 'pipeline' | 'loans' | 'full'
 */
app.post('/api/stoa/export', authenticateToken, async (req, res) => {
  try {
    const { type = 'portfolio', property = null, months = 6 } = req.body || {};
    console.log('[STOA Export] Generating:', { type, property, months });
    const result = await excelExport.generateExport({ type, property, months });
    res.json({
      success: true,
      url: result.url,
      fileName: result.fileName,
      type: result.type,
      property: result.property,
      generatedAt: result.generatedAt,
    });
  } catch (err) {
    console.error('[STOA Export] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/trend?property=...&months=6
 * Returns weekly MMR history for a property.
 */
app.get('/api/stoa/trend', authenticateToken, async (req, res) => {
  try {
    const { property, months = '6' } = req.query;
    if (!property) return res.status(400).json({ success: false, error: 'property param required' });
    const rows = await stoaQuery.getMMRHistory(property, parseInt(months));
    res.json({ success: true, count: rows.length, property, months: parseInt(months), data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/rent-growth?property=...
 * Returns pre-computed rent growth percentages.
 */
app.get('/api/stoa/rent-growth', authenticateToken, async (req, res) => {
  try {
    const { property } = req.query;
    const rows = property
      ? await stoaQuery.getRentGrowthHistory(property)
      : await stoaQuery.getPortfolioRentGrowth();
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/occupancy?property=...
 * Returns live occupancy/leasing data for one or all properties.
 */
app.get('/api/stoa/occupancy', authenticateToken, async (req, res) => {
  try {
    const property = req.query.property || null;
    const rows = await stoaQuery.getMMRData(property);
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/portfolio
 * Returns portfolio-level KPIs across all active properties.
 */
app.get('/api/stoa/portfolio', authenticateToken, async (req, res) => {
  try {
    const [summary] = await stoaQuery.getPortfolioSummary();
    const properties = await stoaQuery.getMMRData();
    res.json({ success: true, summary, properties });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/projects?search=...
 * Search projects by name or city.
 */
app.get('/api/stoa/projects', authenticateToken, async (req, res) => {
  try {
    const search = req.query.search || '';
    const projects = await stoaQuery.findProjects(search);
    res.json({ success: true, count: projects.length, data: projects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/stoa/status
 * Returns Stoa DB connection status.
 */
app.get('/api/stoa/status', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/stoa/status');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa status error:', error);
    res.status(500).json({ error: 'Failed to fetch Stoa status', message: error.message });
  }
});

/**
 * GET /api/stoa/tables
 * Returns available Stoa tables and their schemas.
 */
app.get('/api/stoa/tables', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/stoa/tables');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa tables error:', error);
    res.status(500).json({ error: 'Failed to fetch Stoa tables', message: error.message });
  }
});

/**
 * POST /api/stoa/sync
 * Triggers a Stoa DB sync (immediate pull → training JSONL).
 * Requires FULL_CAPABILITIES.
 */
app.post('/api/stoa/sync', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const data = await proxyToNeural('/stoa/sync', { method: 'POST', body: req.body || {} });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa sync error:', error);
    res.status(500).json({ error: 'Stoa sync failed', message: error.message });
  }
});

/**
 * POST /api/stoa/query
 * Executes a natural-language or raw SQL query against Stoa DB.
 * Requires FULL_CAPABILITIES.
 */
app.post('/api/stoa/query', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { query, queryType = 'natural_language' } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const data = await proxyToNeural('/stoa/query', {
      method: 'POST',
      body: { query, query_type: queryType },
    });
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Stoa query error:', error);
    res.status(500).json({ error: 'Stoa query failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  METRICS DASHBOARD
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/metrics/dashboard
 * Aggregated system + model metrics from Python /metrics/dashboard.
 */
app.get('/api/metrics/dashboard', authenticateToken, async (req, res) => {
  try {
    const data = await proxyToNeural('/metrics/dashboard');
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('Metrics dashboard error:', error);
    res.status(500).json({ error: 'Failed to fetch metrics', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TOKEN GENERATION
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/tokens/generate
 * Body: { type, userId, permissions? }
 * Generates a signed JWT token.
 */
app.post('/api/tokens/generate', async (req, res) => {
  try {
    const { type, userId, permissions = [] } = req.body;
    if (!['STOA_ACCESS', 'FULL_CAPABILITIES'].includes(type)) {
      return res.status(400).json({ error: 'Invalid token type. Must be STOA_ACCESS or FULL_CAPABILITIES' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const tokenData = tokenManager.generateToken(userId, type, permissions);
    res.json({ success: true, ...tokenData });
  } catch (error) {
    console.error('Token generation error:', error);
    res.status(500).json({ error: 'Token generation failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  MCP SKILLS MANAGEMENT  (/api/mcp/*)
// ════════════════════════════════════════════════════════════════

app.post('/api/mcp/skills/install', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    const { skillId, permissions = [], autoConnect = false } = req.body;
    const skillConfig = await mcpSkillsManager.installSkill(skillId, { permissions, autoConnect });
    res.json({
      success: true,
      message: `MCP Skill ${skillConfig.name} installed successfully`,
      skill: skillConfig,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/mcp/skills/available', authenticateToken, (req, res) => {
  const availableSkills = mcpSkillsManager.getAvailableSkills();
  res.json({ success: true, skills: availableSkills });
});

app.post('/api/mcp/skills/connect/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    const { skillId } = req.params;
    const result = await mcpSkillsManager.connectSkill(skillId, req.body);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/mcp/skills/installed', authenticateToken, (req, res) => {
  const installed = mcpSkillsManager.getInstalledSkills();
  res.json({ success: true, skills: installed });
});

app.post('/api/mcp/skills/disconnect/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    await mcpSkillsManager.disconnectSkill(req.params.skillId);
    res.json({ success: true, message: `Disconnected from ${req.params.skillId}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.delete('/api/mcp/skills/:skillId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required' });
  }
  try {
    await mcpSkillsManager.removeSkill(req.params.skillId);
    res.json({ success: true, message: `Removed skill ${req.params.skillId}` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  SELF-EVOLUTION  (/api/self-evolution/*)
// ════════════════════════════════════════════════════════════════

app.post('/api/self-evolution/save-version', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for self-modification' });
  }
  try {
    const { modelId = 'current' } = req.body;
    const result = await selfEvolution.saveModelVersion(modelId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to save version: ${error.message}` });
  }
});

app.get('/api/self-evolution/versions', authenticateToken, async (req, res) => {
  try {
    const versions = await selfEvolution.getAvailableVersions();
    res.json({ success: true, versions: versions.slice(0, 50) });
  } catch (error) {
    res.status(500).json({ error: `Failed to list versions: ${error.message}` });
  }
});

app.post('/api/self-evolution/adjust-biases', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for bias adjustment' });
  }
  try {
    const { adjustments } = req.body;
    if (!Array.isArray(adjustments)) {
      return res.status(400).json({ error: 'Adjustments must be an array' });
    }
    const result = await selfEvolution.adjustBiases(adjustments);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to adjust biases: ${error.message}` });
  }
});

app.post('/api/self-evolution/self-modify', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for self-modification' });
  }
  try {
    const { modificationPlan } = req.body;
    if (!modificationPlan || !Array.isArray(modificationPlan.changes)) {
      return res.status(400).json({ error: 'Invalid modification plan' });
    }
    const result = await selfEvolution.selfModify(modificationPlan);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ error: `Self-modification failed: ${error.message}` });
  }
});

app.get('/api/self-evolution/ownership', authenticateToken, async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, '../data/.ownership_manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const manifest = await selfEvolution.initializeOwnership();
      return res.json({ success: true, manifest });
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json({ success: true, manifest });
  } catch (error) {
    res.status(500).json({ error: `Failed to get ownership info: ${error.message}` });
  }
});

app.get('/api/self-evolution/stats', authenticateToken, (req, res) => {
  const stats = selfEvolution.getEvolutionStats();
  res.json({ success: true, ...stats });
});

// ════════════════════════════════════════════════════════════════
//  SELF-IMPROVEMENT  (/api/self-improve/*)
//  Owner-only — runs tests, proposes LLM changes, only commits if tests pass.
//  Directive: always improve accuracy, UX, and data correctness for Alec.
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/self-improve/run
 * Run one improvement cycle (propose → apply → test → commit or revert).
 * Body: { directive_id? } — omit to auto-pick highest priority
 */
app.post('/api/self-improve/run', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { directive_id } = req.body || {};
    const feedback = selfImprovement.getRecentNegativeFeedback();
    console.log('[SelfImprove] Starting cycle, directive:', directive_id || 'auto');
    const result = await selfImprovement.runImprovementCycle(directive_id || null, feedback);
    res.json({ success: result.success, ...result });
  } catch (err) {
    console.error('[SelfImprove] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/self-improve/test
 * Run only the test suite, no code changes.
 * Returns { passed, failed, total, criticalFailed, results }
 */
app.post('/api/self-improve/test', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const results = await selfImprovement.runTests();
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/self-improve/history
 * Returns the last 20 improvement log entries.
 */
app.get('/api/self-improve/history', authenticateToken, requireFullCapabilities, async (req, res) => {
  const history = selfImprovement.getImprovementHistory(Number(req.query.limit) || 20);
  res.json({ success: true, history });
});

/**
 * GET /api/self-improve/directives
 * Returns the improvement directives list.
 */
app.get('/api/self-improve/directives', authenticateToken, (req, res) => {
  res.json({ success: true, directives: selfImprovement.IMPROVEMENT_DIRECTIVES });
});

// ════════════════════════════════════════════════════════════════
//  CROSS-DEVICE SYNC  (/api/sync/*)
// ════════════════════════════════════════════════════════════════

app.post('/api/sync/register-device', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for device registration' });
  }
  try {
    const { deviceId, deviceInfo = {} } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'Device ID is required' });
    const result = await crossDeviceSync.registerDevice(deviceId, deviceInfo);
    await selfEvolution.configureTailscaleAccess();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to register device: ${error.message}` });
  }
});

app.post('/api/sync/across-network', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for network sync' });
  }
  try {
    const { syncData, targetDevices = [] } = req.body;
    if (!syncData) return res.status(400).json({ error: 'Sync data is required' });
    const result = await crossDeviceSync.syncAcrossNetwork(syncData, targetDevices);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to sync across network: ${error.message}` });
  }
});

app.get('/api/sync/status', authenticateToken, (req, res) => {
  const status = crossDeviceSync.getStatus();
  res.json({ success: true, ...status });
});

app.post('/api/sync/process-pending', authenticateToken, async (req, res) => {
  try {
    const result = await crossDeviceSync.processPendingSyncs();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: `Failed to process pending syncs: ${error.message}` });
  }
});

app.delete('/api/sync/remove-device/:deviceId', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('full_access')) {
    return res.status(403).json({ error: 'Full access required for device removal' });
  }
  try {
    await crossDeviceSync.removeDevice(req.params.deviceId);
    res.json({ success: true, message: `Device ${req.params.deviceId} removed` });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  SMART HOME  (/api/smarthome/*)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/smarthome/control
 * Body: { entity_id?, domain?, service, service_data? }
 * Routes to real Home Assistant API if configured, falls back to stub.
 */
app.post('/api/smarthome/control', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('smart_home')) {
    return res.status(403).json({ error: 'Smart home access denied' });
  }
  const haUrl   = process.env.HOME_ASSISTANT_URL || process.env.HA_URL;
  const haToken = process.env.HOME_ASSISTANT_ACCESS_TOKEN || process.env.HA_TOKEN;

  // If HA is configured, use real API
  if (haUrl && haToken) {
    try {
      const { domain, service, service_data = {}, entity_id } = req.body;
      if (!domain || !service) return res.status(400).json({ error: 'domain and service are required' });
      const body = entity_id ? { ...service_data, entity_id } : service_data;
      const haResp = await fetch(`${haUrl}/api/services/${domain}/${service}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${haToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!haResp.ok) {
        const err = await haResp.text().catch(() => haResp.status.toString());
        return res.status(502).json({ error: 'Home Assistant error', detail: err });
      }
      const data = await haResp.json().catch(() => ({}));
      return res.json({ success: true, result: data, via: 'home-assistant' });
    } catch (err) {
      return res.status(500).json({ error: 'Smart home control failed', message: err.message });
    }
  }

  // Fallback to stub
  try {
    const { device, action, parameters } = req.body;
    const result = await smartHomeConnector.executeCommand(device, action, parameters);
    res.json({ success: true, result, via: 'stub' });
  } catch (error) {
    res.status(500).json({ error: 'Smart home control failed', message: error.message });
  }
});

/**
 * GET /api/smarthome/states
 * Returns all HA entity states.
 */
app.get('/api/smarthome/states', authenticateToken, async (req, res) => {
  const haUrl   = process.env.HOME_ASSISTANT_URL || process.env.HA_URL;
  const haToken = process.env.HOME_ASSISTANT_ACCESS_TOKEN || process.env.HA_TOKEN;
  if (!haUrl || !haToken) return res.json({ configured: false, states: [] });
  try {
    const haResp = await fetch(`${haUrl}/api/states`, {
      headers: { Authorization: `Bearer ${haToken}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!haResp.ok) throw new Error(`HA returned ${haResp.status}`);
    const states = await haResp.json();
    const domain = req.query.domain;
    const filtered = domain ? states.filter(s => s.entity_id.startsWith(domain + '.')) : states;
    res.json({ success: true, count: filtered.length, states: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  PERSONALITY & ADAPTIVE LEARNING
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/personality
 * Returns personality profile for the authenticated user.
 */
app.get('/api/personality', authenticateToken, (req, res) => {
  const personality = adaptiveLearning.getPersonalityProfile(req.user.userId);
  res.json({ success: true, personality });
});

/**
 * POST /api/learn
 * Body: { data, source }
 * Triggers adaptive learning + neural retrain.
 */
app.post('/api/learn', authenticateToken, async (req, res) => {
  if (!req.user.scope.includes('neural_training')) {
    return res.status(403).json({ error: 'Full capabilities token required' });
  }

  try {
    const { data, source } = req.body;
    await adaptiveLearning.trainOnData(data, source);
    await neuralEngine.retrain();
    res.json({
      success: true,
      message: 'A.L.E.C. has learned from your input',
      newPatterns: adaptiveLearning.detectedPatterns.length,
    });
  } catch (error) {
    console.error('Learn error:', error);
    res.status(500).json({ error: 'Training failed', message: error.message });
  }
});

/**
 * POST /api/init
 * Body: { emails?, texts?, documents? }
 * Initialize personal data and load context into neural engine.
 */
app.post('/api/init', authenticateToken, async (req, res) => {
  try {
    const { emails = [], texts = [], documents = [] } = req.body;
    await adaptiveLearning.initializePersonalData({
      userId: req.user.userId,
      emails,
      texts,
      documents,
    });
    await neuralEngine.loadPersonalContext(req.user.userId);
    const totalDataPoints = emails.length + texts.length + documents.length;
    res.json({
      success: true,
      message: 'A.L.E.C. is now personalized for you',
      dataPoints: totalDataPoints,
    });
  } catch (error) {
    console.error('Init error:', error);
    res.status(500).json({ error: 'Initialization failed', message: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  NEURAL STATS
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/neural/stats
 * Returns neural engine stats (queries processed, model status).
 */
app.get('/api/neural/stats', authenticateToken, (req, res) => {
  const stats = neuralEngine.getStats();
  res.json({ success: true, ...stats });
});

// ════════════════════════════════════════════════════════════════
//  VOICE INTERFACE
// ════════════════════════════════════════════════════════════════

// Initialize voice WebSocket
const voiceServer = voiceInterface.initialize();
if (voiceServer) {
  console.log('🎤 Voice WebSocket initialized');
}

// ════════════════════════════════════════════════════════════════
//  USER MANAGEMENT (Owner only)
// ════════════════════════════════════════════════════════════════

// Generate a long-lived embed token for Home Assistant / iframe use
app.post('/api/auth/embed-token', authenticateToken, requireFullCapabilities, (req, res) => {
  const { email, role, access_level } = req.body;
  const tokenType = access_level === 'OWNER' ? 'OWNER' :
                    access_level === 'FULL_CAPABILITIES' ? 'FULL_CAPABILITIES' : 'STOA_ACCESS';
  const jwtPayload = {
    userId: req.user.userId,
    email: email || req.user.email,
    role: role || req.user.role,
    tokenType,
    embed: true,
  };
  // 365-day token for persistent iframe access
  const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '365d' });
  res.json({ success: true, token, usage: `Add ?token=${token} to your iframe URL` });
});

// Device-based auto-login (no auth required — this IS the auth)
app.post('/api/auth/device/check', async (req, res) => {
  try {
    const { device_id } = req.body;
    if (!device_id) return res.status(400).json({ error: 'device_id required' });

    const data = await proxyToNeural('/auth/device/check', {
      method: 'POST',
      body: { device_id },
    });

    // Device is trusted — issue a fresh JWT
    const user = data.user || {};
    let tokenType = 'STOA_ACCESS';
    if (data.access_level === 'OWNER') tokenType = 'OWNER';
    else if (data.access_level === 'FULL_CAPABILITIES') tokenType = 'FULL_CAPABILITIES';

    const jwtPayload = {
      userId: user.id,
      email: user.email,
      role: user.role || 'viewer',
      tokenType,
    };
    const token = jwt.sign(jwtPayload, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      tokenType,
      device_id,
      access_level: data.access_level,
      email: user.email,
      role: user.role,
      user,
    });
  } catch (error) {
    res.status(404).json({ trusted: false });
  }
});

app.get('/api/auth/devices', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/devices');
  res.json(data);
});

app.delete('/api/auth/device/:deviceId', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural(`/auth/device/${req.params.deviceId}`, { method: 'DELETE' });
  res.json(data);
});

app.get('/api/auth/users', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users');
  res.json(data);
});

app.post('/api/auth/users/create', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/create', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/auth/users/role', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/role', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/auth/users/password', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/auth/users/password', { method: 'POST', body: req.body });
  res.json(data);
});

app.delete('/api/auth/users/:email', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural(`/auth/users/${encodeURIComponent(req.params.email)}`, { method: 'DELETE' });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  MEMORY (Teaching & Learning)
// ════════════════════════════════════════════════════════════════

// Teach A.L.E.C. something
app.post('/api/memory/teach', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/memory/teach', { method: 'POST', body: req.body });
  res.json(data);
});

// Search A.L.E.C.'s memory
app.post('/api/memory/search', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/memory/search', { method: 'POST', body: req.body });
  res.json(data);
});

// Get all memories
app.get('/api/memory/all', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/memory/all');
  res.json(data);
});

// Memory stats
app.get('/api/memory/stats', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/memory/stats');
  res.json(data);
});

// Get memories by category
app.get('/api/memory/category/:category', authenticateToken, async (req, res) => {
  const data = await proxyToNeural(`/memory/category/${req.params.category}`);
  res.json(data);
});

// Delete a memory
app.delete('/api/memory/:id', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural(`/memory/${req.params.id}`, { method: 'DELETE' });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  EXCEL
// ════════════════════════════════════════════════════════════════

app.post('/api/excel/read', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/read', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/excel/export', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/excel/export', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/excel/edit', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/excel/edit', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/excel/analyze', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/analyze', { method: 'POST', body: req.body });
  res.json(data);
});

app.get('/api/excel/status', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/excel/status');
  res.json(data);
});

// Serve exported files
app.use('/exports', express.static(path.join(__dirname, '..', 'data', 'exports')));

// ════════════════════════════════════════════════════════════════
//  INITIATIVE (Autonomous Agent)
// ════════════════════════════════════════════════════════════════

app.post('/api/initiative/scan', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/initiative/scan', { method: 'POST' });
  res.json(data);
});

app.get('/api/initiative/status', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/initiative/status');
  res.json(data);
});

app.post('/api/initiative/analyze-performance', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/initiative/analyze-performance', { method: 'POST' });
  res.json(data);
});

app.get('/api/initiative/suggest-skills', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/initiative/suggest-skills');
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  SKILLS REGISTRY
// ════════════════════════════════════════════════════════════════

app.get('/api/skills/available', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/skills/available');
  res.json(data);
});

app.get('/api/skills/installed', authenticateToken, async (req, res) => {
  const data = await proxyToNeural('/skills/installed');
  res.json(data);
});

app.post('/api/skills/install', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/skills/install', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/skills/uninstall', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/skills/uninstall', { method: 'POST', body: req.body });
  res.json(data);
});

app.post('/api/skills/configure', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/skills/configure', { method: 'POST', body: req.body });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  CONNECTORS (iMessage, Gmail)
// ════════════════════════════════════════════════════════════════

app.get('/api/stoa/debug', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/stoa/debug');
  res.json(data);
});

app.post('/api/stoa/reload-planner', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/stoa/reload-planner', { method: 'POST', body: {} });
  res.json(data);
});

// TTS endpoint — streams MP3 audio from Python edge-tts
app.post('/api/tts', authenticateToken, async (req, res) => {
  try {
    const resp = await fetch(`${NEURAL_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'TTS failed' });
    }
    res.set('Content-Type', 'audio/mpeg');
    const buffer = await resp.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/connectors/status', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/status');
  res.json(data);
});

app.post('/api/connectors/imessage/sync', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/imessage/sync', { method: 'POST' });
  res.json(data);
});

app.get('/api/connectors/imessage/messages', authenticateToken, requireFullCapabilities, async (req, res) => {
  const limit = req.query.limit || 50;
  const days = req.query.days || 30;
  const data = await proxyToNeural(`/connectors/imessage/messages?limit=${limit}&days=${days}`);
  res.json(data);
});

app.get('/api/connectors/imessage/conversations', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/imessage/conversations');
  res.json(data);
});

app.post('/api/connectors/gmail/sync', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/gmail/sync', { method: 'POST' });
  res.json(data);
});

app.post('/api/connectors/sync-all', authenticateToken, requireFullCapabilities, async (req, res) => {
  const data = await proxyToNeural('/connectors/sync-all', { method: 'POST' });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════
//  PLAID BROKERAGE INTEGRATION  (/api/plaid/*)
//  Owner-only. Enables linking Schwab, Acorns, Fidelity, etc.
// ════════════════════════════════════════════════════════════════

// ── Plaid SQLite table ─────────────────────────────────────────
const DB_PATH = path.join(__dirname, '../data/alec.db');
const plaidDbDir = path.dirname(DB_PATH);
if (!fs.existsSync(plaidDbDir)) fs.mkdirSync(plaidDbDir, { recursive: true });

let plaidDb;
try {
  const Database = require('better-sqlite3');
  plaidDb = new Database(DB_PATH);
} catch {
  // better-sqlite3 may not be installed — fall back to sqlite3
  plaidDb = null;
}

// Initialize plaid_items table using whatever SQLite driver is available
(async () => {
  const CREATE_SQL = `CREATE TABLE IF NOT EXISTS plaid_items (
    item_id TEXT PRIMARY KEY,
    access_token_enc TEXT NOT NULL,
    institution_name TEXT DEFAULT '',
    institution_id TEXT DEFAULT '',
    linked_at TEXT DEFAULT (datetime('now')),
    last_fetched TEXT
  )`;
  if (plaidDb && plaidDb.exec) {
    // better-sqlite3 (synchronous)
    plaidDb.exec(CREATE_SQL);
  } else {
    // Fallback: use Python-side DB or a simple JSON file
    const sqlite3 = await import('sqlite3').then(m => m.default || m).catch(() => null);
    if (sqlite3) {
      plaidDb = new sqlite3.Database(DB_PATH);
      plaidDb.run(CREATE_SQL);
    }
  }
})();

// ── Plaid encryption helpers (AES-256-GCM) ─────────────────────
function getPlaidEncryptionKey() {
  const secret = process.env.JWT_SECRET || 'fallback-secret';
  return crypto.pbkdf2Sync(secret, 'plaid-token-salt', 100000, 32, 'sha256');
}

function encryptAccessToken(plaintext) {
  const key = getPlaidEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Store as base64(iv + authTag + ciphertext)
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptAccessToken(encoded) {
  const key = getPlaidEncryptionKey();
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const ciphertext = data.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext, null, 'utf8') + decipher.final('utf8');
}

// ── Plaid API helper ───────────────────────────────────────────
async function plaidFetch(endpoint, body) {
  const baseUrl = {
    sandbox: 'https://sandbox.plaid.com',
    development: 'https://development.plaid.com',
    production: 'https://production.plaid.com',
  }[process.env.PLAID_ENV || 'sandbox'];

  const resp = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_message || `Plaid API error: ${resp.status}`);
  }
  return resp.json();
}

// ── Plaid DB helpers (work with both better-sqlite3 and sqlite3) ──
function plaidDbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!plaidDb) return resolve([]);
    if (typeof plaidDb.prepare === 'function') {
      // better-sqlite3
      try { resolve(plaidDb.prepare(sql).all(...params)); } catch (e) { reject(e); }
    } else if (typeof plaidDb.all === 'function') {
      // sqlite3
      plaidDb.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    } else {
      resolve([]);
    }
  });
}

function plaidDbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    if (!plaidDb) return resolve();
    if (typeof plaidDb.prepare === 'function') {
      try { resolve(plaidDb.prepare(sql).run(...params)); } catch (e) { reject(e); }
    } else if (typeof plaidDb.run === 'function') {
      plaidDb.run(sql, params, (err) => err ? reject(err) : resolve());
    } else {
      resolve();
    }
  });
}

// Owner-only middleware for Plaid routes
const requireOwner = (req, res, next) => {
  if (req.user.email !== 'arovner@campusrentalsllc.com') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
};

/**
 * POST /api/plaid/create-link-token
 * Creates a Plaid link_token for the frontend to open Plaid Link.
 */
app.post('/api/plaid/create-link-token', authenticateToken, requireOwner, async (req, res) => {
  try {
    if (!process.env.PLAID_CLIENT_ID || !process.env.PLAID_SECRET) {
      return res.status(500).json({ error: 'Plaid credentials not configured. Set PLAID_CLIENT_ID and PLAID_SECRET in .env' });
    }
    const data = await plaidFetch('/link/token/create', {
      user: { client_user_id: crypto.createHash('sha256').update(req.user.email).digest('hex').slice(0, 32) },
      client_name: 'A.L.E.C.',
      products: ['investments'],
      country_codes: ['US'],
      language: 'en',
    });
    res.json({ link_token: data.link_token });
  } catch (error) {
    console.error('Plaid create-link-token error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/plaid/exchange-token
 * Exchanges a Plaid public_token for an access_token, encrypts & stores it.
 */
app.post('/api/plaid/exchange-token', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { public_token, institution } = req.body;
    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }

    const data = await plaidFetch('/item/public_token/exchange', { public_token });
    const accessTokenEnc = encryptAccessToken(data.access_token);

    await plaidDbRun(
      `INSERT OR REPLACE INTO plaid_items (item_id, access_token_enc, institution_name, institution_id)
       VALUES (?, ?, ?, ?)`,
      [data.item_id, accessTokenEnc, institution?.name || '', institution?.institution_id || '']
    );

    res.json({ success: true, item_id: data.item_id });
  } catch (error) {
    console.error('Plaid exchange-token error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/plaid/holdings
 * Fetches live holdings from all linked brokerage accounts.
 */
app.get('/api/plaid/holdings', authenticateToken, requireOwner, async (req, res) => {
  try {
    const items = await plaidDbAll('SELECT * FROM plaid_items');
    if (items.length === 0) {
      return res.json({ accounts: [], holdings: [], securities: [], total_value: 0 });
    }

    const allAccounts = [];
    const allHoldings = [];
    const allSecurities = [];
    let totalValue = 0;

    for (const item of items) {
      try {
        const accessToken = decryptAccessToken(item.access_token_enc);
        const data = await plaidFetch('/investments/holdings/get', { access_token: accessToken });

        for (const acct of (data.accounts || [])) {
          acct.institution_name = item.institution_name;
          acct.item_id = item.item_id;
          allAccounts.push(acct);
          totalValue += acct.balances?.current || 0;
        }

        allHoldings.push(...(data.holdings || []));
        allSecurities.push(...(data.securities || []));

        // Update last_fetched
        await plaidDbRun(
          `UPDATE plaid_items SET last_fetched = datetime('now') WHERE item_id = ?`,
          [item.item_id]
        );
      } catch (itemErr) {
        console.error(`Plaid holdings error for ${item.institution_name}:`, itemErr.message);
      }
    }

    res.json({ accounts: allAccounts, holdings: allHoldings, securities: allSecurities, total_value: totalValue });
  } catch (error) {
    console.error('Plaid holdings error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/plaid/accounts
 * Lists all linked brokerage institutions.
 */
app.get('/api/plaid/accounts', authenticateToken, requireOwner, async (req, res) => {
  try {
    const items = await plaidDbAll('SELECT item_id, institution_name, institution_id, linked_at, last_fetched FROM plaid_items');
    res.json(items);
  } catch (error) {
    console.error('Plaid accounts error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/plaid/accounts/:itemId
 * Unlinks a brokerage account (removes from Plaid + local DB).
 */
app.delete('/api/plaid/accounts/:itemId', authenticateToken, requireOwner, async (req, res) => {
  try {
    const { itemId } = req.params;
    const items = await plaidDbAll('SELECT * FROM plaid_items WHERE item_id = ?', [itemId]);
    if (items.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    // Remove from Plaid
    try {
      const accessToken = decryptAccessToken(items[0].access_token_enc);
      await plaidFetch('/item/remove', { access_token: accessToken });
    } catch (plaidErr) {
      console.error('Plaid item/remove warning:', plaidErr.message);
      // Continue to delete locally even if Plaid call fails
    }

    await plaidDbRun('DELETE FROM plaid_items WHERE item_id = ?', [itemId]);
    res.json({ success: true });
  } catch (error) {
    console.error('Plaid unlink error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  REMOTE ADMIN — execute shell commands via secret key
//  Auth: X-Admin-Secret header (NOT JWT — works without login)
//  Only accessible to whoever has the secret. Keep it safe.
// ════════════════════════════════════════════════════════════════

const ADMIN_SECRET = process.env.ADMIN_SECRET || '';

app.post('/api/admin/exec', (req, res) => {
  // Auth: require X-Admin-Secret header
  const secret = req.headers['x-admin-secret'];
  if (!ADMIN_SECRET || !secret || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden — invalid or missing admin secret' });
  }

  const { command, timeout = 120000 } = req.body;
  if (!command || typeof command !== 'string') {
    return res.status(400).json({ error: 'Missing "command" in request body' });
  }

  // Safety: cap timeout at 10 minutes
  const maxTimeout = Math.min(timeout, 600000);

  console.log(`🔧 Admin exec: ${command.slice(0, 100)}${command.length > 100 ? '...' : ''}`);

  const { exec } = require('child_process');
  const projectDir = path.resolve(__dirname, '..');

  exec(command, {
    cwd: projectDir,
    timeout: maxTimeout,
    maxBuffer: 1024 * 1024 * 10,  // 10 MB output buffer
    shell: '/bin/bash',
    env: { ...process.env, HOME: os.homedir() },
  }, (error, stdout, stderr) => {
    const exitCode = error ? error.code || 1 : 0;
    res.json({
      success: exitCode === 0,
      exit_code: exitCode,
      stdout: stdout || '',
      stderr: stderr || '',
      command: command.slice(0, 200),
    });
  });
});

// Convenience: GET version for quick health checks with the secret
app.get('/api/admin/status', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (!ADMIN_SECRET || !secret || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const { execSync } = require('child_process');
  const projectDir = path.resolve(__dirname, '..');
  let gitHead = 'unknown';
  try { gitHead = execSync('git rev-parse --short HEAD', { cwd: projectDir }).toString().trim(); } catch {}
  let uptime = process.uptime();
  res.json({
    status: 'online',
    git_commit: gitHead,
    node_uptime_seconds: Math.round(uptime),
    neural_url: NEURAL_URL,
    pid: process.pid,
    platform: os.platform(),
    arch: os.arch(),
    total_memory_gb: Math.round(os.totalmem() / 1073741824),
    free_memory_gb: Math.round(os.freemem() / 1073741824),
  });
});

// ════════════════════════════════════════════════════════════════
//  CHAT HISTORY  (/api/history/*)
//  Per-account persistent conversation history (ChatGPT-style).
// ════════════════════════════════════════════════════════════════

app.get('/api/history/conversations', authenticateToken, (req, res) => {
  if (!chatHistory) return res.json({ conversations: [] });
  const convs = chatHistory.listConversations(req.user.userId);
  res.json({ success: true, conversations: convs });
});

app.post('/api/history/conversations', authenticateToken, (req, res) => {
  if (!chatHistory) return res.json({ id: null });
  const conv = chatHistory.createConversation(req.user.userId, req.body.title);
  res.json({ success: true, conversation: conv });
});

app.get('/api/history/conversations/:id/messages', authenticateToken, (req, res) => {
  if (!chatHistory) return res.json({ messages: [] });
  const conv = chatHistory.getConversation(req.params.id, req.user.userId);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const messages = chatHistory.getMessages(req.params.id, parseInt(req.query.limit) || 100);
  res.json({ success: true, conversation: conv, messages });
});

app.patch('/api/history/conversations/:id', authenticateToken, (req, res) => {
  if (!chatHistory) return res.json({ success: false });
  const { title } = req.body;
  if (title) chatHistory.updateTitle(req.params.id, req.user.userId, title);
  res.json({ success: true });
});

app.delete('/api/history/conversations/:id', authenticateToken, (req, res) => {
  if (!chatHistory) return res.json({ success: false });
  const deleted = chatHistory.deleteConversation(req.params.id, req.user.userId);
  res.json({ success: deleted });
});

// ════════════════════════════════════════════════════════════════
//  LEGACY SKILLS REGISTRY routes removed in S6.4.
//  Credential management now lives at backend/routes/connectors.mjs
//  (mounted at /api/connectors) and uses connector_instances + the
//  UUID-keyed secretVault. The old /:skillId/credentials, /:skillId/
//  reveal, /:skillId/instances and /custom routes that read through
//  services/skillsRegistry.js have been deleted.
// ════════════════════════════════════════════════════════════════

// ── Phone verification for notification number ────────────────────
// OTP store: { phone: { code, expiresAt, attempts } }
const _phoneOTPs = new Map();

app.post('/api/connectors/sms/send-verification', authenticateToken, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone required' });

    const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 min
    _phoneOTPs.set(phone, { code, expiresAt, attempts: 0 });

    // Try Twilio if configured, otherwise iMessage/fallback
    const twilioSid    = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken  = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom   = process.env.TWILIO_FROM_NUMBER;
    const message      = `Your ALEC verification code is: ${code}. Expires in 5 minutes.`;

    if (twilioSid && twilioToken && twilioFrom) {
      const url  = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const body = new URLSearchParams({ From: twilioFrom, To: toE164(phone), Body: message });
      const resp = await fetch(url, {
        method: 'POST', body,
        headers: { Authorization: 'Basic ' + Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        return res.status(500).json({ error: 'SMS failed: ' + (err.message || resp.status) });
      }
    } else if (iMessage) {
      // Fallback to native iMessage
      await iMessage.send(phone, message);
    } else {
      return res.status(503).json({ error: 'No SMS service configured. Add Twilio credentials to the Skills panel.' });
    }

    res.json({ success: true, message: `Verification code sent to ${phone}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/connectors/sms/verify', authenticateToken, async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });

    const entry = _phoneOTPs.get(phone);
    if (!entry) return res.status(400).json({ error: 'No verification pending for this number. Request a new code.' });
    if (Date.now() > entry.expiresAt) {
      _phoneOTPs.delete(phone);
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }
    entry.attempts++;
    if (entry.attempts > 5) {
      _phoneOTPs.delete(phone);
      return res.status(400).json({ error: 'Too many attempts. Request a new code.' });
    }
    if (entry.code !== String(code).trim()) {
      return res.status(400).json({ error: `Incorrect code (${5 - entry.attempts} attempts remaining).` });
    }

    // Verified! Save phone as OWNER_PHONE
    _phoneOTPs.delete(phone);
    process.env.OWNER_PHONE = phone;
    const envPath = require('path').join(__dirname, '../.env');
    let envContent = '';
    try { envContent = require('fs').readFileSync(envPath, 'utf8'); } catch (_) {}
    const regex = /^OWNER_PHONE=.*$/m;
    const line  = `OWNER_PHONE=${phone}`;
    if (regex.test(envContent)) envContent = envContent.replace(regex, line);
    else envContent += `\n${line}`;
    try { require('fs').writeFileSync(envPath, envContent, 'utf8'); } catch (_) {}

    res.json({ success: true, message: 'Phone verified and saved as notification number.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  NOTIFICATIONS  (/api/notifications/*)
//  Unified SMS/iMessage sending endpoint. Prefers Twilio if configured.
// ════════════════════════════════════════════════════════════════

app.post('/api/notifications/send-sms', authenticateToken, requireFullCapabilities, async (req, res) => {
  try {
    const { to, message } = req.body;
    const recipient = to || process.env.OWNER_PHONE;
    if (!recipient) return res.status(400).json({ error: 'No recipient. Set OWNER_PHONE or pass {to}.' });
    if (!message)   return res.status(400).json({ error: 'message required' });

    // Prefer Twilio
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from  = process.env.TWILIO_FROM_NUMBER;
    if (sid && token && from) {
      const url  = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;
      const body = new URLSearchParams({ From: from, To: toE164(recipient), Body: message });
      const r    = await fetch(url, {
        method: 'POST', body,
        headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: AbortSignal.timeout(12000),
      });
      const data = await r.json();
      if (!r.ok) return res.status(500).json({ error: 'Twilio error: ' + (data.message || r.status) });
      return res.json({ success: true, provider: 'twilio', sid: data.sid, to: recipient });
    }

    // Fallback: native iMessage
    if (iMessage) {
      await iMessage.send(recipient, message);
      return res.json({ success: true, provider: 'imessage', to: recipient });
    }

    return res.status(503).json({ error: 'No SMS service configured. Add Twilio in Skills panel.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  iMESSAGE  (/api/imessage/*)
// ════════════════════════════════════════════════════════════════

app.post('/api/imessage/send', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!iMessage) return res.status(503).json({ error: 'iMessage service not available' });
  try {
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: 'to and message required' });
    const result = await iMessage.send(to, message);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/imessage/conversations', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!iMessage) return res.status(503).json({ error: 'iMessage service not available' });
  try {
    const convos = await iMessage.getConversations();
    res.json({ success: true, conversations: convos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/imessage/messages', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!iMessage) return res.status(503).json({ error: 'iMessage service not available' });
  try {
    const { contact, limit = 20 } = req.query;
    const msgs = await iMessage.getRecent(contact, parseInt(limit));
    res.json({ success: true, messages: msgs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/imessage/unread', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!iMessage) return res.status(503).json({ error: 'iMessage service not available' });
  try {
    const msgs = await iMessage.getUnread();
    res.json({ success: true, messages: msgs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/imessage/status', authenticateToken, (req, res) => {
  res.json({
    available: !!iMessage,
    ownerPhone: process.env.OWNER_PHONE ? 'configured' : 'not set',
    hint: process.env.OWNER_PHONE ? null : 'Add OWNER_PHONE to .env (e.g. +14155551234)',
  });
});

// ════════════════════════════════════════════════════════════════
//  TASK SCHEDULER  (/api/scheduler/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/scheduler/tasks', authenticateToken, requireFullCapabilities, (req, res) => {
  if (!scheduler) return res.json({ tasks: [] });
  try {
    res.json({ success: true, tasks: scheduler.listTasks() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/scheduler/create', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!scheduler) return res.status(503).json({ error: 'Scheduler not available' });
  try {
    const { id, expression, description } = req.body;
    if (!id || !expression) return res.status(400).json({ error: 'id and expression required' });
    // Register as a dummy task (actual fn will be set by user logic)
    const task = scheduler.schedule(id, expression, async () => {
      console.log(`[Scheduler] Task ${id} triggered`);
    }, { description });
    res.json({ success: true, task: { id, expression, description } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/scheduler/tasks/:id', authenticateToken, requireFullCapabilities, (req, res) => {
  if (!scheduler) return res.status(503).json({ error: 'Scheduler not available' });
  try {
    scheduler.cancel(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  GITHUB  (/api/github/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/github/repos', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!github) return res.status(503).json({ error: 'GitHub service not available' });
  try {
    const repos = await github.listRepos();
    res.json({ success: true, repos });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/github/repos/:owner/:repo/issues', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!github) return res.status(503).json({ error: 'GitHub service not available' });
  try {
    const { owner, repo } = req.params;
    const issues = await github.listIssues(`${owner}/${repo}`, req.query);
    res.json({ success: true, issues });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/github/repos/:owner/:repo/issues', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!github) return res.status(503).json({ error: 'GitHub service not available' });
  try {
    const { owner, repo } = req.params;
    const issue = await github.createIssue(`${owner}/${repo}`, req.body);
    res.json({ success: true, issue });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/github/repos/:owner/:repo/commits', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!github) return res.status(503).json({ error: 'GitHub service not available' });
  try {
    const { owner, repo } = req.params;
    const commits = await github.getCommits(`${owner}/${repo}`, parseInt(req.query.limit) || 10);
    res.json({ success: true, commits });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/github/status', authenticateToken, async (req, res) => {
  const configured = !!process.env.GITHUB_TOKEN;
  res.json({ configured, hint: configured ? null : 'Add GITHUB_TOKEN to .env' });
});

// ════════════════════════════════════════════════════════════════
//  VS CODE CONTROLLER  (/api/vscode/*)
// ════════════════════════════════════════════════════════════════

app.post('/api/vscode/open', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!vsCode) return res.status(503).json({ error: 'VS Code controller not available' });
  try {
    const { path: filePath, folder } = req.body;
    const result = folder
      ? await vsCode.openFolder(folder)
      : await vsCode.openFile(filePath);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/vscode/terminal', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!vsCode) return res.status(503).json({ error: 'VS Code controller not available' });
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });
    const result = await vsCode.runInTerminal(command);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/vscode/create-project', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!vsCode) return res.status(503).json({ error: 'VS Code controller not available' });
  try {
    const { name, type = 'node', location } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const result = type === 'python'
      ? await vsCode.createPythonProject(name, location)
      : await vsCode.createNodeProject(name, location);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  RESEARCH AGENT  (/api/research/*)
// ════════════════════════════════════════════════════════════════

app.post('/api/research/start', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!research) return res.status(503).json({ error: 'Research agent not available' });
  try {
    const { topic, notifyWhenDone = true, saveReport = true } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });
    const job = research.startResearch(topic, { notifyWhenDone, saveReport });
    res.json({ success: true, taskId: job.id, topic, message: 'Research started in background. You\'ll be notified via iMessage when done.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/research/quick', authenticateToken, async (req, res) => {
  if (!research) return res.status(503).json({ error: 'Research agent not available' });
  try {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ error: 'topic required' });
    const result = await research.quickResearch(topic, 3);
    res.json({ success: true, report: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/reports', authenticateToken, (req, res) => {
  if (!research) return res.json({ reports: [] });
  try {
    const reports = research.listReports();
    res.json({ success: true, reports });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/research/reports/:filename', authenticateToken, (req, res) => {
  if (!research) return res.status(503).json({ error: 'Research agent not available' });
  try {
    const content = research.getReport(req.params.filename);
    res.json({ success: true, content });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TENANTCLOUD  (/api/tenantcloud/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/tenantcloud/status', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.json({ configured: false });
  try { res.json(await tenantCloud.status()); }
  catch (err) { res.json({ configured: false, error: err.message }); }
});

app.get('/api/tenantcloud/summary', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, ...(await tenantCloud.getPortfolioSummary()) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/tenants', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, tenants: await tenantCloud.listTenants() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/maintenance', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try {
    const open = await tenantCloud.getOpenMaintenance();
    res.json({ success: true, maintenance: open, count: open.length });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/payments', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try {
    const [overdue, all] = await Promise.all([tenantCloud.getOverdueRent(), tenantCloud.listPayments()]);
    res.json({ success: true, overdue, all });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/leases', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try {
    const { expiring } = req.query;
    const leases = expiring
      ? await tenantCloud.getExpiringLeases(parseInt(expiring) || 60)
      : await tenantCloud.listLeases();
    res.json({ success: true, leases });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/messages', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try {
    const msgs = req.query.unread === 'true'
      ? await tenantCloud.getUnreadMessages()
      : await tenantCloud.listMessages();
    res.json({ success: true, messages: msgs });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/inquiries', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, inquiries: await tenantCloud.listInquiries() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/rent-analysis', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, ...(await tenantCloud.analyzeRentPatterns()) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  AWS  (/api/aws/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/aws/status', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.json({ configured: false });
  try { res.json(await awsSvc.status()); }
  catch (err) { res.json({ configured: false, error: err.message }); }
});

app.get('/api/aws/instances', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.status(503).json({ error: 'AWS not configured' });
  try { res.json({ success: true, instances: await awsSvc.listInstances() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/aws/instances/:id/:action', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.status(503).json({ error: 'AWS not configured' });
  try {
    const { id, action } = req.params;
    const fns = { start: awsSvc.startInstance, stop: awsSvc.stopInstance, reboot: awsSvc.rebootInstance };
    if (!fns[action]) return res.status(400).json({ error: 'action must be start|stop|reboot' });
    const result = await fns[action](id);
    res.json({ success: true, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/aws/website', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.status(503).json({ error: 'AWS not configured' });
  try { res.json({ success: true, ...(await awsSvc.checkWebsiteStatus()) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/aws/ssh', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.status(503).json({ error: 'AWS not configured' });
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'command required' });
    const result = await awsSvc.sshCommand(command);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/aws/website/restart', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.status(503).json({ error: 'AWS not configured' });
  try {
    const result = await awsSvc.restartWebServer(req.body.serverType || 'nginx');
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/aws/logs', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.status(503).json({ error: 'AWS not configured' });
  try {
    const result = await awsSvc.getServerLogs(req.query.file, parseInt(req.query.lines) || 50);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/aws/metrics', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!awsSvc) return res.status(503).json({ error: 'AWS not configured' });
  try {
    const result = await awsSvc.getServerMetrics();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  RENDER.COM  (/api/render/*)
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//  VERCEL ENDPOINTS  (/api/vercel/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/vercel/status', authenticateToken, async (req, res) => {
  if (!vercelSvc) return res.json({ configured: false });
  try { res.json(await vercelSvc.status()); }
  catch (err) { res.json({ configured: false, error: err.message }); }
});

app.get('/api/vercel/deployments', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!vercelSvc) return res.status(503).json({ error: 'Vercel not configured — add VERCEL_TOKEN to .env' });
  try { res.json({ success: true, deployments: await vercelSvc.listDeployments(parseInt(req.query.limit) || 10) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/vercel/redeploy', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!vercelSvc) return res.status(503).json({ error: 'Vercel not configured' });
  try {
    const result = await vercelSvc.redeploy(req.body.deploymentId || null, req.body.project || null);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  MICROSOFT GRAPH  (/api/msgraph/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/msgraph/status', authenticateToken, async (req, res) => {
  if (!msGraph) return res.json({ configured: false });
  try { res.json(await msGraph.status()); }
  catch (err) { res.json({ configured: false, error: err.message }); }
});

app.get('/api/msgraph/onedrive', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!msGraph) return res.status(503).json({ error: 'Microsoft Graph not configured' });
  try {
    const files = await msGraph.listOneDriveFiles(req.query.folder || '');
    res.json({ success: true, files });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/msgraph/sharepoint/search', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!msGraph) return res.status(503).json({ error: 'Microsoft Graph not configured' });
  try {
    const results = await msGraph.searchSharePoint(req.query.q || '');
    res.json({ success: true, results });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/msgraph/emails', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!msGraph) return res.status(503).json({ error: 'Microsoft Graph not configured' });
  try {
    const emails = await msGraph.getRecentEmails(parseInt(req.query.limit) || 20);
    res.json({ success: true, emails });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/msgraph/calendar', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!msGraph) return res.status(503).json({ error: 'Microsoft Graph not configured' });
  try {
    const events = await msGraph.getUpcomingEvents(parseInt(req.query.days) || 7);
    res.json({ success: true, events });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  GMAIL  (/api/gmail/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/gmail/status', authenticateToken, async (req, res) => {
  if (!gmailSvc) return res.status(503).json({ error: 'Gmail service not available' });
  try { res.json(await gmailSvc.status()); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/gmail/:account/unread', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!gmailSvc) return res.status(503).json({ error: 'Gmail not configured' });
  const { account } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  try {
    const emails = await gmailSvc.listUnreadEmails(account, limit);
    res.json({ success: true, account, count: emails.length, emails });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/gmail/:account/message/:id', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!gmailSvc) return res.status(503).json({ error: 'Gmail not configured' });
  const { account, id } = req.params;
  try {
    const email = await gmailSvc.getEmailById(account, id);
    res.json({ success: true, email });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/gmail/:account/message/:id/triage', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!gmailSvc) return res.status(503).json({ error: 'Gmail not configured' });
  const { account, id } = req.params;
  try {
    const email = await gmailSvc.getEmailById(account, id);
    const triage = await gmailSvc.triageEmail(account, email);
    res.json({ success: true, triage });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/gmail/:account/message/:id/archive', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!gmailSvc) return res.status(503).json({ error: 'Gmail not configured' });
  const { account, id } = req.params;
  try { res.json(await gmailSvc.archiveEmail(account, id)); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/gmail/:account/message/:id/label', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!gmailSvc) return res.status(503).json({ error: 'Gmail not configured' });
  const { account, id } = req.params;
  const { label } = req.body;
  if (!label) return res.status(400).json({ error: 'label required' });
  try { res.json(await gmailSvc.labelEmail(account, id, label)); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/gmail/:account/message/:id/reply', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!gmailSvc) return res.status(503).json({ error: 'Gmail not configured' });
  const { account, id } = req.params;
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body required' });
  try { res.json(await gmailSvc.replyToEmail(account, id, body)); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/api/gmail/:account/inbox-zero', authenticateToken, requireFullCapabilities, async (req, res) => {
  if (!emailFiling) return res.status(503).json({ error: 'Email filing service not available' });
  const { account } = req.params;
  try {
    const result = await emailFiling.runInboxZero(account);
    res.json({ success: true, account, result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/gmail/briefing', authenticateToken, requireFullCapabilities, (req, res) => {
  if (!emailFiling) return res.status(503).json({ error: 'Email filing service not available' });
  try {
    const queue = emailFiling.getBriefingQueue();
    res.json({ success: true, count: queue.length, items: queue });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/sharepoint/filing-rules', authenticateToken, (req, res) => {
  try {
    const filingRules = require('../config/sharepointFilingRules.js');
    res.json({ success: true, rules: filingRules.listRules() });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  MEMORY & FACTS  (/api/memory/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/memory', authenticateToken, (req, res) => {
  try {
    const mem = loadMemory();
    res.json({ success: true, facts: mem.facts || [], preferences: mem.preferences || [], summaries: mem.summaries || [], promptVersion: mem.promptVersion || 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/memory/fact', authenticateToken, requireFullCapabilities, (req, res) => {
  try {
    const { fact } = req.body;
    if (!fact || typeof fact !== 'string') return res.status(400).json({ error: 'fact string required' });
    const mem = loadMemory();
    mem.facts = [...(mem.facts || []), fact.slice(0, 200)].slice(-50);
    saveMemory(mem);
    res.json({ success: true, totalFacts: mem.facts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/memory', authenticateToken, requireFullCapabilities, (req, res) => {
  try {
    saveMemory({ facts: [], preferences: [], summaries: [], promptVersion: 1 });
    res.json({ success: true, message: 'Memory cleared' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  VOICE TRANSCRIPTS  (/api/voice/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/voice/transcripts', authenticateToken, (req, res) => {
  if (!chatHistory) return res.json({ transcripts: [] });
  const userId = req.user?.userId || req.user?.email || 'alec-owner';
  const limit  = parseInt(req.query.limit) || 100;
  try {
    const transcripts = chatHistory.getVoiceTranscripts(userId, limit);
    res.json({ success: true, transcripts, count: transcripts.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════════
//  TENANTCLOUD ENDPOINTS  (/api/tenantcloud/*)
// ════════════════════════════════════════════════════════════════

app.get('/api/tenantcloud/status', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.json({ configured: false });
  try { res.json({ ...(await tenantCloud.status()), mfaPending: tenantCloud.isMfaPending() }); }
  catch (err) { res.json({ configured: false, error: err.message }); }
});

/**
 * POST /api/tenantcloud/manual-login
 * Opens a visible Chrome window on this Mac so the owner can log in manually.
 * Once logged in, cookies are saved and headless scraping takes over.
 * Owner-only — runs on the server Mac, not remotely.
 */
app.post('/api/tenantcloud/manual-login', authenticateToken, requireOwner, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not available' });
  try {
    res.json({ success: true, message: 'Opening Chrome on the server Mac — log in to TenantCloud in the window that appears. You have 5 minutes.' });
    // Run async — don't block the response
    tenantCloud.startManualLogin().then(result => {
      console.log('[TenantCloud manual login]', result.message);
      if (iMessage) iMessage.notifyOwner(result.success ? '🏠 TenantCloud logged in and ready!' : '⚠️ TenantCloud login timed out', 'TenantCloud').catch(() => {});
    }).catch(err => console.error('[TenantCloud manual login error]', err.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/tenantcloud/verify-code  { code: "123456" } */
app.post('/api/tenantcloud/verify-code', authenticateToken, (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not available' });
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });
  try {
    tenantCloud.submitVerificationCode(code);
    res.json({ success: true, message: 'Code submitted — logging in...' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/tenantcloud/summary', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, ...(await tenantCloud.getPortfolioSummary()) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/properties', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, properties: await tenantCloud.listProperties() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/properties/:id', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, property: await tenantCloud.getProperty(req.params.id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/properties/:id/units', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, units: await tenantCloud.listUnits(req.params.id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/tenants', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, tenants: await tenantCloud.listTenants(req.query) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/tenants/:id', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, tenant: await tenantCloud.getTenant(req.params.id) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/leases', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try {
    const leases = await tenantCloud.listLeases(req.query);
    res.json({ success: true, leases });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/leases/expiring', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try {
    const leases = await tenantCloud.getExpiringLeases(parseInt(req.query.days) || 60);
    res.json({ success: true, leases, daysAhead: parseInt(req.query.days) || 60 });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/payments', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, payments: await tenantCloud.listPayments(req.query) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/payments/overdue', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, payments: await tenantCloud.getOverdueRent() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/maintenance', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, requests: await tenantCloud.listMaintenance(req.query) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/maintenance/open', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, requests: await tenantCloud.getOpenMaintenance() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/messages', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, messages: await tenantCloud.listMessages(req.query) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/messages/unread', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, messages: await tenantCloud.getUnreadMessages() }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/inquiries', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, inquiries: await tenantCloud.listInquiries(req.query) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/tenantcloud/analytics/rent', authenticateToken, async (req, res) => {
  if (!tenantCloud) return res.status(503).json({ error: 'TenantCloud not configured' });
  try { res.json({ success: true, ...(await tenantCloud.analyzeRentPatterns()) }); }
  catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ════════════════════════════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════════════════════════════

// Register system tasks on startup (daily summaries, weekly lease alerts, cleanup)
if (scheduler) {
  try {
    scheduler.registerSystemTasks();
    console.log('📅 System tasks registered (TenantCloud alerts, export cleanup)');
  } catch (err) {
    console.warn('⚠️  Task scheduler registration failed:', err.message);
  }
}

// ════════════════════════════════════════════════════════════════
//  TWILIO WEBHOOKS  (incoming voice calls + SMS)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/twilio/voice
 * Twilio calls this when someone calls your Twilio number.
 * Responds with TwiML — greets the caller and records a voicemail,
 * or redirects to a <Say> message from ALEC.
 */
app.post('/api/twilio/voice', express.urlencoded({ extended: false }), async (req, res) => {
  const callerName = req.body.CallerName || req.body.From || 'Unknown caller';
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hello, you've reached A.L.E.C., Alec Rovner's personal AI assistant. Alec is unavailable right now. Please leave a message after the beep and I'll make sure he gets it.</Say>
  <Record maxLength="120" transcribe="true" transcribeCallback="/api/twilio/transcription" playBeep="true"/>
  <Say voice="Polly.Joanna">Thank you for your message. Goodbye.</Say>
</Response>`;
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
  console.log(`[Twilio Voice] Incoming call from ${callerName}`);

  // Notify owner via iMessage
  if (iMessage) {
    iMessage.notifyOwner(`📞 Incoming call from ${callerName} — recording voicemail`, 'Twilio').catch(() => {});
  }
});

/**
 * POST /api/twilio/transcription
 * Twilio sends voicemail transcription here when ready.
 */
app.post('/api/twilio/transcription', express.urlencoded({ extended: false }), async (req, res) => {
  const text   = req.body.TranscriptionText || '(no transcription)';
  const from   = req.body.From || 'Unknown';
  const recUrl = req.body.RecordingUrl || '';
  console.log(`[Twilio Transcription] From ${from}: ${text}`);

  if (iMessage) {
    iMessage.notifyOwner(`📞 Voicemail from ${from}:\n"${text}"${recUrl ? `\nRecording: ${recUrl}` : ''}`, 'Twilio Voicemail').catch(() => {});
  }
  res.sendStatus(204);
});

/**
 * POST /api/twilio/sms
 * Twilio calls this when someone texts your Twilio number.
 * Passes the message to ALEC's LLM and replies via SMS.
 */
app.post('/api/twilio/sms', express.urlencoded({ extended: false }), async (req, res) => {
  const from = req.body.From || '';
  const body = (req.body.Body || '').trim();
  console.log(`[Twilio SMS] Incoming from ${from}: ${body}`);

  // Notify owner
  if (iMessage) {
    iMessage.notifyOwner(`💬 SMS from ${from}: "${body}"`, 'Twilio SMS').catch(() => {});
  }

  let reply = 'ALEC received your message.';
  try {
    // Run message through LLM for a response
    const sysPrompt = buildSystemPrompt() + '\n\nYou are responding via SMS. Keep your reply under 160 characters. Be direct and helpful.';
    reply = await callLLMText([
      { role: 'system', content: sysPrompt },
      { role: 'user',   content: body },
    ], true);
    // Truncate to SMS limit
    if (reply.length > 155) reply = reply.slice(0, 152) + '…';
  } catch (llmErr) {
    console.warn('[Twilio SMS] LLM error:', llmErr.message);
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${reply.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</Message>
</Response>`;
  res.set('Content-Type', 'text/xml');
  res.send(twiml);
});

// ════════════════════════════════════════════════════════════════
//  TENANTCLOUD BROWSER RELAY  (/api/tenantcloud/data-push)
//
//  The browser interceptor script (injected via Chrome DevTools) calls
//  this endpoint whenever api.tenantcloud.com returns JSON data.
//  No JWT needed — protected by TC_RELAY_SECRET (shared secret).
//  Data is cached to data/tc-cache.json and served by the RAG system.
// ════════════════════════════════════════════════════════════════

const TC_CACHE_FILE = path.join(__dirname, '../data/tc-cache.json');
const TC_RELAY_SECRET = process.env.TC_RELAY_SECRET || 'alec-tc-relay-2025';

// In-memory cache — survives restarts via TC_CACHE_FILE
let tcCache = (() => {
  try { if (fs.existsSync(TC_CACHE_FILE)) return JSON.parse(fs.readFileSync(TC_CACHE_FILE, 'utf8')); }
  catch (_) {}
  return {};
})();

function saveTcCache() {
  try { fs.writeFileSync(TC_CACHE_FILE, JSON.stringify(tcCache, null, 2)); } catch (_) {}
}

/**
 * POST /api/tenantcloud/data-push?secret=xxx
 * Body: { endpoint, data, capturedAt }
 * Called by the browser interceptor — no JWT, protected by shared secret.
 */
app.post('/api/tenantcloud/data-push', express.json({ limit: '2mb' }), (req, res) => {
  const { secret } = req.query;
  if (secret !== TC_RELAY_SECRET) return res.status(403).json({ error: 'invalid secret' });

  const { endpoint, data, capturedAt } = req.body;
  if (!endpoint || !data) return res.status(400).json({ error: 'endpoint and data required' });

  // Normalize endpoint to a simple key
  const key = endpoint
    .replace(/https?:\/\/[^/]+/, '')  // strip domain
    .replace(/\?.*/, '')               // strip query string
    .replace(/\/+/g, '_')
    .replace(/^_/, '');

  tcCache[key] = { data, capturedAt: capturedAt || new Date().toISOString(), endpoint };
  tcCache._lastPush = new Date().toISOString();
  saveTcCache();

  console.log(`[TC Browser Relay] Cached ${key} (${JSON.stringify(data).length} bytes)`);
  res.json({ ok: true, key });
});

/** GET /api/tenantcloud/cache — inspect cached data (owner only) */
app.get('/api/tenantcloud/cache', authenticateToken, (req, res) => {
  const summary = {};
  for (const [k, v] of Object.entries(tcCache)) {
    if (k.startsWith('_')) { summary[k] = v; continue; }
    const d = v.data;
    summary[k] = {
      capturedAt: v.capturedAt,
      items: Array.isArray(d) ? d.length : (d?.data ? (Array.isArray(d.data) ? d.data.length : 1) : 1),
    };
  }
  res.json({ ok: true, keys: Object.keys(tcCache).filter(k => !k.startsWith('_')), summary });
});

/**
 * POST /api/tenantcloud/inject-sync
 * Server-side: opens the TenantCloud bookmarklet script in the user's
 * Chrome via AppleScript (injects a <script> tag into the active tab).
 * Requires Chrome to have TenantCloud open. Owner only.
 */
app.post('/api/tenantcloud/inject-sync', authenticateToken, requireOwner, async (req, res) => {
  const { exec } = require('child_process');
  const scriptUrl = `http://localhost:${PORT}/api/tenantcloud/bookmarklet.js?_=${Date.now()}`;
  // AppleScript: run JS in the frontmost Chrome tab
  const appleScript = `
    tell application "Google Chrome"
      set theTab to active tab of front window
      set theUrl to URL of theTab
      if theUrl contains "tenantcloud.com" then
        execute theTab javascript "var s=document.createElement('script');s.src='${scriptUrl}';document.head.appendChild(s);"
        return "injected"
      else
        return "not-tenantcloud:" & theUrl
      end if
    end tell
  `.trim();

  exec(`osascript -e '${appleScript.replace(/'/g, "'\\''")}'`, (err, stdout, stderr) => {
    const output = (stdout || '').trim();
    if (err) {
      return res.json({ ok: false, message: 'AppleScript error — make sure TenantCloud is open in Chrome: ' + (err.message || '').slice(0, 100) });
    }
    if (output.startsWith('not-tenantcloud:')) {
      return res.json({ ok: false, message: 'Chrome frontmost tab is not TenantCloud. Navigate to app.tenantcloud.com first, then click Sync Now again.' });
    }
    res.json({ ok: true, message: 'Sync script injected into Chrome TenantCloud tab.' });
  });
});

/**
 * GET /api/tenantcloud/bookmarklet.js
 * Returns the interceptor script. The bookmarklet calls this endpoint,
 * evals the result, which then immediately pushes all TC data to ALEC.
 * No auth — this script is the auth mechanism itself.
 */
app.get('/api/tenantcloud/bookmarklet.js', (req, res) => {
  const port = PORT;
  const secret = TC_RELAY_SECRET;
  const knownEndpoints = [
    { url: 'https://api.tenantcloud.com/landlord/tenants',  params: '?limit=100&include=lease,unit,building' },
    { url: 'https://api.tenantcloud.com/landlord/property', params: '?limit=50' },
    { url: 'https://api.tenantcloud.com/leases',            params: '?limit=100&include=building,unit,tenant' },
    { url: 'https://api.tenantcloud.com/transactions',      params: '?limit=100&order=-created_at' },
    { url: 'https://api.tenantcloud.com/units',             params: '?limit=100' },
    { url: 'https://api.tenantcloud.com/landlord/profile',  params: '' },
    { url: 'https://api.tenantcloud.com/properties',        params: '?limit=50' },
  ];

  const script = `
(async function alecTcSync() {
  const ALEC = 'http://localhost:${port}/api/tenantcloud/data-push?secret=${secret}';
  const HDR = { 'x-requested-with': 'XMLHttpRequest', accept: 'application/json', credentials: 'include' };

  // Install persistent interceptors so future navigation also captures data
  if (!window.__alecRelayInstalled) {
    window.__alecRelayInstalled = true;
    const origFetch = window.fetch;
    window.fetch = async function(input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const resp = await origFetch.apply(this, arguments);
      if (url.includes('api.tenantcloud.com') && url !== ALEC) {
        resp.clone().json().then(j => {
          fetch(ALEC, { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ endpoint: url, data: j, capturedAt: new Date().toISOString() }) });
        }).catch(()=>{});
      }
      return resp;
    };
    console.log('[ALEC] Interceptor installed for future calls');
  }

  // Immediately pull all known endpoints
  const endpoints = ${JSON.stringify(knownEndpoints)};
  let pushed = 0, failed = 0;
  for (const { url, params } of endpoints) {
    try {
      const r = await fetch(url + params, { headers: HDR, credentials: 'include' });
      if (r.ok) {
        const j = await r.json();
        await fetch(ALEC, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: url, data: j, capturedAt: new Date().toISOString() }) });
        pushed++;
      } else {
        failed++;
        console.warn('[ALEC] TC endpoint returned', r.status, url);
      }
    } catch(e) { failed++; console.warn('[ALEC]', e.message, url); }
  }

  const msg = '✅ ALEC synced ' + pushed + ' TenantCloud endpoints' + (failed ? ' (' + failed + ' failed — are you logged in?)' : '');
  console.log(msg);
  // Brief visual confirmation
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText = 'position:fixed;top:20px;right:20px;background:#1a6b2b;color:#fff;padding:14px 20px;border-radius:8px;font-size:14px;z-index:999999;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
  return msg;
})();
`.trim();

  res.set('Content-Type', 'application/javascript');
  res.send(script);
});

// ── PDF + Report Routes ──────────────────────────────────────────────────────
fs.mkdirSync(path.join(__dirname, '..', 'data', 'exports'), { recursive: true });
fs.mkdirSync(path.join(__dirname, '..', 'tmp', 'reports'), { recursive: true });

const pdfRoutes    = require('../routes/pdfRoutes');
const reportRoutes = require('../routes/reportRoutes');

app.use('/api', authenticateToken, pdfRoutes);
app.use('/api', authenticateToken, reportRoutes);

app.get('/api/download/:filename', (req, res) => {
  // path.basename strips any path traversal attempts (e.g. ../../etc/passwd → passwd)
  const safe = path.basename(req.params.filename);
  const filePath = path.join(__dirname, '../tmp/reports', safe);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.download(filePath);
});

// ── Manual STOA Brain sync trigger (distinct from GitHub push webhook) ────────
app.post('/api/webhooks/github/sync', async (_req, res) => {
  try {
    const result = stoaBrainSync
      ? await stoaBrainSync.fullSync()
      : { indexed: 0, skipped: 0, error: 'STOA Brain not initialized' };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) app.listen(PORT, HOST, () => {
  const lanIps = getLanAddresses();
  const lanList = lanIps.length > 0
    ? lanIps.map(ip => `http://${ip}:${PORT}`).join('\n║   ')
    : '(no LAN interfaces detected)';

  console.log(`
╔═══════════════════════════════════════════════════════╗
║   🧠 A.L.E.C. — Adaptive Learning Executive Coordinator
╠═══════════════════════════════════════════════════════╣
║   Status:  ONLINE
║   Port:    ${PORT}
║   Host:    ${HOST}
║   Neural:  ${NEURAL_URL}
║   Model:   A.L.E.C. Neural Engine
║
║   Local:   http://localhost:${PORT}
║   LAN:     ${lanList}
╚═══════════════════════════════════════════════════════╝

💬 Chat:       POST /api/chat
🔐 Login:      POST /api/auth/login
🏋️  Train:      POST /api/training/start
📊 Metrics:    GET  /api/metrics/dashboard
📁 Files:      GET  /api/files
🗄️  Stoa:       GET  /api/stoa/status
❤️  Feedback:   POST /api/feedback
🤖 Domo embed: ?embed=domo (auto-auth)
`);
});

module.exports = Object.assign(app, { enforceHardRules });

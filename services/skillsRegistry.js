/**
 * A.L.E.C. Skills Registry
 *
 * Central registry of all skills, connectors, and MCPs.
 * Powers the Skills & Connectors panel in the UI.
 *
 * Features:
 *  - Full catalog of built-in skills with required credentials
 *  - Per-user credential storage (AES-256-CBC encrypted in data/skills-config.json)
 *  - Multi-instance support for Microsoft 365 (unlimited SharePoint/OneDrive accounts)
 *  - "Reveal credentials" for authorized users to verify what's stored
 *  - Live status checking for each skill
 *  - Custom skill + MCP registration
 *
 * Storage format (data/skills-config.json):
 *  {
 *    "users": {
 *      "userId": {
 *        "github":         { "GITHUB_TOKEN": "iv:enc" },
 *        "microsoft365":   { "instances": [{ "id": "...", "name": "...", "fields": { "MS_TENANT_ID": "iv:enc", ... } }] },
 *        "render":         { ... },
 *        "tenantcloud":    { ... },
 *        "domo":           { ... },
 *        "anthropic":      { ... },
 *        "research":       { ... }
 *      }
 *    },
 *    "global": {
 *      "imessage":         { "OWNER_PHONE": "iv:enc" },
 *      "stoa":             { ... },
 *      "aws":              { ... },
 *      "homeassistant":    { ... },
 *      "task-scheduler":   {},
 *      "vscode":           {}
 *    },
 *    "custom": []
 *  }
 */

require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CONFIG_FILE    = path.join(__dirname, '../data/skills-config.json');
const ENCRYPTION_KEY = (process.env.JWT_SECRET || 'alec-skills-key-32chars-minimum!!').slice(0, 32);

// ── Skills that are server-level (global, shared by all ALEC users) ──
const GLOBAL_SKILL_IDS = new Set(['imessage', 'stoa', 'aws', 'vscode', 'task-scheduler', 'homeassistant']);

// ── Encryption ─────────────────────────────────────────────────────
function encrypt(text) {
  try {
    const iv  = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    return iv.toString('hex') + ':' + enc;
  } catch { return text; }
}

function decrypt(text) {
  try {
    const [ivHex, enc] = text.split(':');
    if (!enc) return text; // not encrypted (plain value)
    const iv  = Buffer.from(ivHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let dec = decipher.update(enc, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch { return text; }
}

// ── Config I/O ─────────────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      // Migrate old format: { skills: {...}, custom: [] } → new format
      if (raw.skills && !raw.users && !raw.global) {
        const migrated = { users: {}, global: {}, custom: raw.custom || [] };
        for (const [skillId, creds] of Object.entries(raw.skills || {})) {
          if (GLOBAL_SKILL_IDS.has(skillId)) {
            migrated.global[skillId] = creds;
          } else {
            // Put in a special '_legacy' user bucket so nothing is lost
            migrated.users['_legacy'] = migrated.users['_legacy'] || {};
            migrated.users['_legacy'][skillId] = creds;
          }
        }
        saveConfig(migrated);
        return migrated;
      }
      return raw;
    }
  } catch (_) {}
  return { users: {}, global: {}, custom: [] };
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Get the right storage bucket for a skill + user ────────────────
function getBucket(cfg, userId, skillId) {
  if (GLOBAL_SKILL_IDS.has(skillId)) return cfg.global;
  if (!cfg.users[userId]) cfg.users[userId] = {};
  return cfg.users[userId];
}

// ── Built-in skill catalog ─────────────────────────────────────────
const BUILTIN_SKILLS = [

  // ── Communications ──────────────────────────────────────────
  {
    id: 'imessage', name: 'iMessage', icon: '💬', category: 'Communications', global: true,
    description: 'Send & receive iMessages. Get notified when background tasks complete.',
    macOnly: true,
    fields: [
      { key: 'OWNER_PHONE', label: 'Your iPhone Number', type: 'tel', placeholder: '+15551234567', envVar: 'OWNER_PHONE', required: true, hint: 'ALEC sends you iMessage alerts here' },
    ],
    async checkStatus() {
      const im = require('./iMessageService.js');
      return im.status();
    },
  },

  // ── Development ─────────────────────────────────────────────
  {
    id: 'github', name: 'GitHub', icon: '🐙', category: 'Development', global: false,
    description: 'Create repos, files, issues, PRs. Run Actions. Code search.',
    fields: [
      { key: 'GITHUB_TOKEN', label: 'Personal Access Token', type: 'password', placeholder: 'ghp_...', envVar: 'GITHUB_TOKEN', required: true, hint: 'github.com → Settings → Developer settings → Personal access tokens → Fine-grained → repo, workflow scope' },
      { key: 'GITHUB_REPO',  label: 'Default Repo (owner/name)', type: 'text', placeholder: 'arovn10/A.L.E.C', envVar: 'GITHUB_REPO', required: false },
    ],
    async checkStatus() {
      const gh = require('./githubService.js');
      return gh.status();
    },
  },
  {
    id: 'vscode', name: 'VS Code / Cursor', icon: '💻', category: 'Development', global: true,
    description: 'Open files, create projects, run terminal commands in VS Code or Cursor.',
    macOnly: true, fields: [],
    async checkStatus() {
      const vs = require('./vsCodeController.js');
      return vs.status();
    },
  },
  {
    id: 'render', name: 'Render.com', icon: '🚀', category: 'Development', global: false,
    description: 'Manage Render deployments, view logs, restart services.',
    fields: [
      { key: 'RENDER_API_KEY', label: 'Render API Key', type: 'password', placeholder: 'rnd_...', envVar: 'RENDER_API_KEY', required: true, hint: 'dashboard.render.com → Account → API Keys' },
    ],
    async checkStatus() {
      const r = require('./renderService.js');
      return r.status();
    },
  },

  // ── Real Estate ──────────────────────────────────────────────
  {
    id: 'stoa', name: 'STOA Database', icon: '🏢', category: 'Real Estate', global: true,
    description: 'Live Azure SQL queries: occupancy, rent, pipeline, loans. Already connected.',
    fields: [
      { key: 'STOA_DB_HOST',     label: 'SQL Server Host',  type: 'text',     placeholder: 'server.database.windows.net', envVar: 'STOA_DB_HOST',     required: true },
      { key: 'STOA_DB_NAME',     label: 'Database Name',    type: 'text',     placeholder: 'stoagroupDB',                envVar: 'STOA_DB_NAME',     required: true },
      { key: 'STOA_DB_USER',     label: 'SQL Username',     type: 'text',     placeholder: 'username',                    envVar: 'STOA_DB_USER',     required: true },
      { key: 'STOA_DB_PASSWORD', label: 'SQL Password',     type: 'password', placeholder: '••••••••',                   envVar: 'STOA_DB_PASSWORD', required: true },
    ],
    async checkStatus() {
      const sq = require('./stoaQueryService.js');
      return sq.ping();
    },
  },
  {
    id: 'tenantcloud', name: 'TenantCloud', icon: '🏠', category: 'Real Estate', global: false,
    description: 'Monitor tenants, rent collection, maintenance, inquiries, and messages.',
    fields: [
      { key: 'TENANTCLOUD_EMAIL',    label: 'TenantCloud Email',    type: 'email',    placeholder: 'you@example.com', envVar: 'TENANTCLOUD_EMAIL',    required: true,  hint: 'Your TenantCloud login email — ALEC logs in via browser automation, no API key needed' },
      { key: 'TENANTCLOUD_PASSWORD', label: 'TenantCloud Password', type: 'password', placeholder: '••••••••',        envVar: 'TENANTCLOUD_PASSWORD', required: true,  hint: 'Your TenantCloud login password — stored encrypted, used only to authenticate the browser session' },
    ],
    async checkStatus() {
      const tc = require('./tenantCloudService.js');
      return tc.status();
    },
  },

  // ── Cloud & Infrastructure ───────────────────────────────────
  {
    id: 'aws', name: 'AWS', icon: '☁️', category: 'Infrastructure', global: true,
    description: 'SSH into servers, manage EC2, deploy code, check S3. Monitor campusrentalsllc.com.',
    fields: [
      { key: 'AWS_ACCESS_KEY_ID',     label: 'AWS Access Key ID',       type: 'text',     placeholder: 'AKIA...', envVar: 'AWS_ACCESS_KEY_ID',     required: true },
      { key: 'AWS_SECRET_ACCESS_KEY', label: 'AWS Secret Access Key',   type: 'password', placeholder: '••••••••', envVar: 'AWS_SECRET_ACCESS_KEY', required: true },
      { key: 'AWS_DEFAULT_REGION',    label: 'Default Region',          type: 'text',     placeholder: 'us-east-1', envVar: 'AWS_DEFAULT_REGION',  required: false },
      { key: 'AWS_WEBSITE_HOST',      label: 'Website Server Host/IP',  type: 'text',     placeholder: 'ec2-xx.compute.amazonaws.com', envVar: 'AWS_WEBSITE_HOST', required: false, hint: 'For campusrentalsllc.com monitoring' },
      { key: 'AWS_WEBSITE_USER',      label: 'SSH Username',            type: 'text',     placeholder: 'ec2-user', envVar: 'AWS_WEBSITE_USER',     required: false },
      { key: 'AWS_SSH_KEY_PATH',      label: 'SSH Key File Path',       type: 'text',     placeholder: '~/.ssh/id_rsa', envVar: 'AWS_SSH_KEY_PATH', required: false },
    ],
    async checkStatus() {
      const a = require('./awsService.js');
      return a.status();
    },
  },

  // ── Microsoft 365 (multi-instance) ──────────────────────────
  {
    id: 'microsoft365', name: 'Microsoft 365', icon: '📎', category: 'Productivity', global: false,
    multiInstance: true,  // ← signals the UI to show instance manager
    description: 'Connect unlimited SharePoint sites and OneDrive accounts. Each person or organization gets their own connection.',
    instanceFields: [
      { key: 'MS_TENANT_ID',     label: 'Azure Tenant ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true,  hint: 'portal.azure.com → Azure Active Directory → Tenant ID' },
      { key: 'MS_CLIENT_ID',     label: 'App (Client) ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true,  hint: 'Azure → App Registrations → ALEC app → Application (client) ID' },
      { key: 'MS_CLIENT_SECRET', label: 'Client Secret',       type: 'password', placeholder: '••••••••', required: true,  hint: 'Azure → App Registrations → ALEC → Certificates & secrets → New client secret' },
      { key: 'MS_USER_EMAIL',    label: 'User Email (optional)', type: 'email',  placeholder: 'you@company.com', required: false, hint: 'For delegated access to specific mailbox/OneDrive' },
    ],
    fields: [], // no top-level fields; all managed via instances
    async checkStatus() {
      const ms = require('./microsoftGraphService.js');
      return ms.status();
    },
  },

  // ── Analytics ────────────────────────────────────────────────
  {
    id: 'domo', name: 'Domo', icon: '📊', category: 'Analytics', global: false,
    description: 'Embed Domo dashboards and reports. Drill into business intelligence.',
    fields: [
      { key: 'DOMO_CLIENT_ID',     label: 'Client ID',     type: 'text',     placeholder: 'xxxx', envVar: 'DOMO_CLIENT_ID',     required: true, hint: 'developer.domo.com → My Apps' },
      { key: 'DOMO_CLIENT_SECRET', label: 'Client Secret', type: 'password', placeholder: '••••', envVar: 'DOMO_CLIENT_SECRET', required: true },
      { key: 'DOMO_EMBED_ID',      label: 'Embed ID',      type: 'text',     placeholder: 'embed-xxxx', envVar: 'DOMO_EMBED_ID', required: false },
    ],
    async checkStatus() {
      const clientId = process.env.DOMO_CLIENT_ID;
      return { configured: !!clientId, note: clientId ? 'Credentials configured' : 'Not configured' };
    },
  },

  // ── Research ─────────────────────────────────────────────────
  {
    id: 'research', name: 'Deep Research Agent', icon: '🔍', category: 'Research', global: false,
    description: 'Autonomous web research: breaks topics into questions, searches, synthesizes, and sends report via iMessage.',
    fields: [
      { key: 'BRAVE_API_KEY', label: 'Brave Search API Key (optional)', type: 'password', placeholder: 'BSA...', envVar: 'BRAVE_API_KEY', required: false, hint: 'api.search.brave.com — improves search quality. Falls back to DuckDuckGo if not set.' },
    ],
    async checkStatus() {
      const braveKey = process.env.BRAVE_API_KEY;
      return { available: true, searchEngine: braveKey ? 'Brave Search' : 'DuckDuckGo (free fallback)' };
    },
  },

  // ── Automation ───────────────────────────────────────────────
  {
    id: 'task-scheduler', name: 'Task Scheduler', icon: '📅', category: 'Automation', global: true,
    description: 'Schedule recurring tasks, run background jobs, get iMessage alerts when done.',
    fields: [],
    async checkStatus() {
      const ts = require('./taskScheduler.js');
      const tasks = ts.listTasks();
      return { running: true, scheduledTasks: tasks.crons.length, backgroundTasks: tasks.background.length };
    },
  },

  // ── Smart Home ───────────────────────────────────────────────
  {
    id: 'homeassistant', name: 'Home Assistant', icon: '🏡', category: 'Smart Home', global: true,
    description: 'Control smart home devices, automations, and scenes.',
    fields: [
      { key: 'HOME_ASSISTANT_URL',          label: 'HA URL',           type: 'text',     placeholder: 'http://homeassistant.local:8123', envVar: 'HOME_ASSISTANT_URL',          required: true },
      { key: 'HOME_ASSISTANT_ACCESS_TOKEN', label: 'Long-lived Token', type: 'password', placeholder: 'eyJ...',                          envVar: 'HOME_ASSISTANT_ACCESS_TOKEN', required: true, hint: 'HA → Profile → Long-lived access tokens' },
    ],
    async checkStatus() {
      const url = process.env.HOME_ASSISTANT_URL;
      const tok = process.env.HOME_ASSISTANT_ACCESS_TOKEN;
      if (!url || !tok) return { configured: false };
      try {
        const r = await fetch(`${url}/api/`, { headers: { Authorization: `Bearer ${tok}` }, signal: AbortSignal.timeout(5000) });
        return { configured: true, connected: r.ok };
      } catch (e) {
        return { configured: true, connected: false, error: e.message };
      }
    },
  },

  // ── Notifications / SMS ──────────────────────────────────────
  {
    id: 'twilio', name: 'Twilio SMS', icon: '📱', category: 'Notifications', global: true,
    description: 'Give ALEC a real phone number to text you notifications, alerts, and research reports.',
    fields: [
      { key: 'TWILIO_ACCOUNT_SID',  label: 'Account SID',   type: 'text',     placeholder: 'ACxxxxxxxxxxxxxxxx', envVar: 'TWILIO_ACCOUNT_SID',  required: true,  hint: 'console.twilio.com → Account Info → Account SID' },
      { key: 'TWILIO_AUTH_TOKEN',   label: 'Auth Token',     type: 'password', placeholder: '••••••••',           envVar: 'TWILIO_AUTH_TOKEN',   required: true,  hint: 'console.twilio.com → Account Info → Auth Token' },
      { key: 'TWILIO_FROM_NUMBER',  label: 'Twilio Phone #', type: 'tel',      placeholder: '+15551234567',       envVar: 'TWILIO_FROM_NUMBER',  required: true,  hint: 'The Twilio number ALEC texts from. Buy one at console.twilio.com → Phone Numbers' },
    ],
    async checkStatus() {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const tok = process.env.TWILIO_AUTH_TOKEN;
      if (!sid || !tok) return { configured: false };
      try {
        const url  = `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`;
        const resp = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') }, signal: AbortSignal.timeout(6000) });
        const data = await resp.json();
        return { configured: true, connected: resp.ok, friendlyName: data.friendly_name || '', status: data.status };
      } catch (e) { return { configured: true, connected: false, error: e.message }; }
    },
  },

  // ── AI ───────────────────────────────────────────────────────
  {
    id: 'anthropic', name: 'Anthropic Claude', icon: '🤖', category: 'AI', global: false,
    description: 'Use Claude API for faster, more powerful AI responses as a backup/alternative to local LLM.',
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API Key', type: 'password', placeholder: 'sk-ant-...', envVar: 'ANTHROPIC_API_KEY', required: true, hint: 'console.anthropic.com → API Keys' },
      { key: 'CLAUDE_MODEL',      label: 'Model',             type: 'text',     placeholder: 'claude-opus-4-5', envVar: 'CLAUDE_MODEL', required: false },
    ],
    async checkStatus() {
      const key = process.env.ANTHROPIC_API_KEY;
      return { configured: !!key, model: process.env.CLAUDE_MODEL || 'claude-opus-4-5' };
    },
  },
];

// ════════════════════════════════════════════════════════════════════
//  STATUS CHECKING
// ════════════════════════════════════════════════════════════════════

async function getSkillStatus(skillId) {
  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  if (!skill) return { error: 'Unknown skill' };
  try {
    return await Promise.race([
      skill.checkStatus(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
  } catch (err) {
    return { error: err.message };
  }
}

async function getAllStatuses() {
  const results = {};
  await Promise.allSettled(
    BUILTIN_SKILLS.map(async skill => {
      results[skill.id] = await getSkillStatus(skill.id);
    })
  );
  return results;
}

// ════════════════════════════════════════════════════════════════════
//  CREDENTIAL MANAGEMENT (per-user)
// ════════════════════════════════════════════════════════════════════

/**
 * Save credentials for a skill (per-user).
 * AES-256-CBC encrypted in skills-config.json.
 * Also writes plaintext to .env AND process.env for live service use.
 */
async function saveCredentials(userId, skillId, credentials) {
  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  const cfg   = loadConfig();

  // Store encrypted in correct namespace
  const bucket = getBucket(cfg, userId, skillId);
  bucket[skillId] = bucket[skillId] || {};
  for (const [key, value] of Object.entries(credentials)) {
    if (value !== undefined && value !== '') {
      bucket[skillId][key] = encrypt(String(value));
    }
  }
  saveConfig(cfg);

  // Also update .env and live process.env so services work immediately
  const envPath = path.join(__dirname, '../.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf8'); } catch (_) {}

  for (const [key, value] of Object.entries(credentials)) {
    if (!value) continue;
    process.env[key] = value; // live, no restart

    const envKey = skill?.fields?.find(f => f.key === key)?.envVar || key;
    const regex  = new RegExp(`^${envKey}=.*$`, 'm');
    const line   = `${envKey}=${value}`;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, line);
    } else {
      envContent += `\n${line}`;
    }
  }

  try { fs.writeFileSync(envPath, envContent, 'utf8'); } catch (e) {
    console.warn('[Skills] Could not write .env:', e.message);
  }

  return { success: true, skillId };
}

/**
 * Get masked credential status for a skill.
 * Returns array of { key, label, required, configured, source }
 */
function getCredentialStatus(userId, skillId) {
  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  if (!skill) return [];

  const cfg    = loadConfig();
  const bucket = getBucket(cfg, userId, skillId);
  const saved  = bucket[skillId] || {};

  return (skill.fields || []).map(f => {
    const envVal   = process.env[f.envVar];
    const savedVal = saved[f.key];
    return {
      key:        f.key,
      label:      f.label,
      required:   f.required,
      configured: !!(envVal || savedVal),
      source:     envVal ? 'env' : savedVal ? 'saved' : 'none',
    };
  });
}

/**
 * Reveal decrypted credential values for an authorized user.
 * Returns { key: decryptedValue } for all configured fields.
 */
function revealCredentials(userId, skillId) {
  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  if (!skill) return {};

  const cfg    = loadConfig();
  const bucket = getBucket(cfg, userId, skillId);
  const saved  = bucket[skillId] || {};
  const result = {};

  for (const f of (skill.fields || [])) {
    const envVal   = process.env[f.envVar];
    const savedVal = saved[f.key];
    if (envVal) {
      result[f.key] = envVal; // already plaintext
    } else if (savedVal) {
      result[f.key] = decrypt(savedVal);
    }
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════
//  MULTI-INSTANCE MANAGEMENT (Microsoft 365 + future skills)
// ════════════════════════════════════════════════════════════════════

/**
 * Get all MS365 instances for a user.
 * Returns array of { id, name, fields: { key: bool (configured?) } }
 */
function getInstances(userId, skillId) {
  const cfg    = loadConfig();
  if (!cfg.users[userId]) return [];
  const entry  = cfg.users[userId][skillId];
  if (!entry || !Array.isArray(entry.instances)) return [];

  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  const fieldDefs = skill?.instanceFields || skill?.fields || [];

  return entry.instances.map(inst => ({
    id:     inst.id,
    name:   inst.name,
    fields: Object.fromEntries(
      fieldDefs.map(f => [f.key, !!(inst.fields && inst.fields[f.key])])
    ),
  }));
}

/**
 * Add or update a multi-instance skill account (e.g. a new SharePoint).
 * @param {string} userId
 * @param {string} skillId   e.g. 'microsoft365'
 * @param {string} name      Display name e.g. "STOA Group"
 * @param {Object} creds     { MS_TENANT_ID: '...', MS_CLIENT_ID: '...', ... }
 * @param {string} [instId]  Existing instance ID to update (omit to create new)
 */
function addInstance(userId, skillId, name, creds, instId = null) {
  const cfg = loadConfig();
  if (!cfg.users[userId]) cfg.users[userId] = {};
  if (!cfg.users[userId][skillId]) cfg.users[userId][skillId] = { instances: [] };
  if (!cfg.users[userId][skillId].instances) cfg.users[userId][skillId].instances = [];

  const instances = cfg.users[userId][skillId].instances;
  const id = instId || crypto.randomBytes(6).toString('hex');
  const existing = instances.findIndex(i => i.id === id);

  const encryptedFields = {};
  for (const [key, value] of Object.entries(creds)) {
    if (value !== undefined && value !== '') {
      encryptedFields[key] = encrypt(String(value));
    } else if (existing >= 0 && instances[existing].fields?.[key]) {
      encryptedFields[key] = instances[existing].fields[key]; // keep existing
    }
  }

  const instanceRecord = { id, name, fields: encryptedFields, updatedAt: new Date().toISOString() };
  if (existing >= 0) {
    instances[existing] = { ...instances[existing], ...instanceRecord };
  } else {
    instances.push(instanceRecord);
  }

  saveConfig(cfg);
  return { success: true, id, name };
}

/**
 * Delete a multi-instance account.
 */
function deleteInstance(userId, skillId, instanceId) {
  const cfg = loadConfig();
  if (!cfg.users?.[userId]?.[skillId]?.instances) return { success: true };
  cfg.users[userId][skillId].instances = cfg.users[userId][skillId].instances.filter(i => i.id !== instanceId);
  saveConfig(cfg);
  return { success: true };
}

/**
 * Reveal decrypted credentials for a specific instance.
 */
function revealInstance(userId, skillId, instanceId) {
  const cfg = loadConfig();
  const inst = cfg.users?.[userId]?.[skillId]?.instances?.find(i => i.id === instanceId);
  if (!inst) return {};
  const result = {};
  for (const [key, encVal] of Object.entries(inst.fields || {})) {
    result[key] = decrypt(encVal);
  }
  return result;
}

// ════════════════════════════════════════════════════════════════════
//  CUSTOM SKILLS
// ════════════════════════════════════════════════════════════════════

function addCustomSkill(definition) {
  const cfg = loadConfig();
  cfg.custom = cfg.custom || [];
  const idx = cfg.custom.findIndex(s => s.id === definition.id);
  if (idx >= 0) cfg.custom[idx] = definition;
  else cfg.custom.push(definition);
  saveConfig(cfg);
  return { success: true, id: definition.id };
}

function removeCustomSkill(skillId) {
  const cfg = loadConfig();
  cfg.custom = (cfg.custom || []).filter(s => s.id !== skillId);
  saveConfig(cfg);
  return { success: true };
}

function getCustomSkills() {
  return loadConfig().custom || [];
}

// ════════════════════════════════════════════════════════════════════
//  FULL CATALOG (for Skills panel UI)
// ════════════════════════════════════════════════════════════════════

function getCatalog() {
  const custom = getCustomSkills();
  const allSkills = [
    ...BUILTIN_SKILLS.map(s => ({
      id:            s.id,
      name:          s.name,
      icon:          s.icon,
      category:      s.category,
      description:   s.description,
      macOnly:       s.macOnly || false,
      global:        s.global || GLOBAL_SKILL_IDS.has(s.id),
      multiInstance: s.multiInstance || false,
      fields:        (s.fields || []).map(f => ({ ...f, value: undefined })),
      instanceFields:(s.instanceFields || []).map(f => ({ ...f, value: undefined })),
      builtin:       true,
    })),
    ...custom.map(s => ({ ...s, builtin: false, global: false, multiInstance: false })),
  ];

  const grouped = {};
  for (const skill of allSkills) {
    if (!grouped[skill.category]) grouped[skill.category] = [];
    grouped[skill.category].push(skill);
  }
  return { skills: allSkills, byCategory: grouped };
}

module.exports = {
  BUILTIN_SKILLS,
  GLOBAL_SKILL_IDS,
  getCatalog,
  getSkillStatus,
  getAllStatuses,
  saveCredentials,
  getCredentialStatus,
  revealCredentials,
  getInstances,
  addInstance,
  deleteInstance,
  revealInstance,
  addCustomSkill,
  removeCustomSkill,
  getCustomSkills,
};

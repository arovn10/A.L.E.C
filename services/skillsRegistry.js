/**
 * A.L.E.C. Skills Registry
 *
 * Central registry of all skills, connectors, and MCPs.
 * Powers the Skills & Connectors panel in the UI.
 *
 * Features:
 *  - Full catalog of built-in skills with required credentials
 *  - Credential storage (encrypted in data/skills-config.json)
 *  - Status checking for each skill
 *  - Custom skill + MCP registration
 */

require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, '../data/skills-config.json');
const ENCRYPTION_KEY = (process.env.JWT_SECRET || 'alec-skills-key-32chars-minimum!!').slice(0, 32);

// ── Encryption helpers ─────────────────────────────────────────────
function encrypt(text) {
  try {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch { return text; }
}

function decrypt(text) {
  try {
    const [ivHex, encrypted] = text.split(':');
    if (!encrypted) return text; // not encrypted
    const iv  = Buffer.from(ivHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32));
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch { return text; }
}

// ── Config persistence ─────────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {}
  return { skills: {}, custom: [] };
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

// ── Built-in skill catalog ─────────────────────────────────────────
// Each skill has: id, name, icon, description, category, fields[], status()
const BUILTIN_SKILLS = [
  // ── Communications ────────────────────────────────────────
  {
    id: 'imessage',
    name: 'iMessage',
    icon: '💬',
    category: 'Communications',
    description: 'Send & receive iMessages. Get notified when background tasks complete.',
    macOnly: true,
    fields: [
      { key: 'OWNER_PHONE',  label: 'Your iPhone number',      type: 'tel',      placeholder: '+15551234567', envVar: 'OWNER_PHONE',  required: true,  hint: 'ALEC will send you notifications here' },
    ],
    async checkStatus(creds) {
      const im = require('./iMessageService.js');
      return im.status();
    },
  },

  // ── Development ────────────────────────────────────────────
  {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    category: 'Development',
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
    id: 'vscode',
    name: 'VS Code / Cursor',
    icon: '💻',
    category: 'Development',
    description: 'Open files, create projects, run terminal commands in VS Code or Cursor.',
    macOnly: true,
    fields: [],
    async checkStatus() {
      const vs = require('./vsCodeController.js');
      return vs.status();
    },
  },
  {
    id: 'render',
    name: 'Render.com',
    icon: '🚀',
    category: 'Development',
    description: 'Manage Render deployments, view logs, restart services.',
    fields: [
      { key: 'RENDER_API_KEY', label: 'Render API Key', type: 'password', placeholder: 'rnd_...', envVar: 'RENDER_API_KEY', required: true, hint: 'dashboard.render.com → Account → API Keys' },
    ],
    async checkStatus() {
      const r = require('./renderService.js');
      return r.status();
    },
  },

  // ── Property Management ────────────────────────────────────
  {
    id: 'stoa',
    name: 'STOA Database',
    icon: '🏢',
    category: 'Real Estate',
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
    id: 'tenantcloud',
    name: 'TenantCloud',
    icon: '🏠',
    category: 'Real Estate',
    description: 'Monitor tenants, rent collection, maintenance, inquiries, and messages.',
    fields: [
      { key: 'TENANTCLOUD_API_KEY',   label: 'API Key (preferred)',  type: 'password', placeholder: 'tc_...', envVar: 'TENANTCLOUD_API_KEY',   required: false, hint: 'TenantCloud → Settings → API' },
      { key: 'TENANTCLOUD_EMAIL',     label: 'Email (fallback)',     type: 'email',    placeholder: 'you@example.com', envVar: 'TENANTCLOUD_EMAIL',     required: false },
      { key: 'TENANTCLOUD_PASSWORD',  label: 'Password (fallback)',  type: 'password', placeholder: '••••••••',        envVar: 'TENANTCLOUD_PASSWORD',  required: false },
    ],
    async checkStatus() {
      const tc = require('./tenantCloudService.js');
      return tc.status();
    },
  },

  // ── Cloud & Infrastructure ─────────────────────────────────
  {
    id: 'aws',
    name: 'AWS',
    icon: '☁️',
    category: 'Infrastructure',
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

  // ── Microsoft 365 ──────────────────────────────────────────
  {
    id: 'microsoft365',
    name: 'Microsoft 365',
    icon: '📎',
    category: 'Productivity',
    description: 'Access SharePoint, OneDrive, Outlook, and Calendar via Microsoft Graph API.',
    fields: [
      { key: 'MS_TENANT_ID',     label: 'Azure Tenant ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-...', envVar: 'MS_TENANT_ID',     required: true, hint: 'portal.azure.com → Azure Active Directory → Overview' },
      { key: 'MS_CLIENT_ID',     label: 'App (Client) ID',     type: 'text',     placeholder: 'xxxxxxxx-xxxx-...', envVar: 'MS_CLIENT_ID',     required: true, hint: 'Azure → App Registrations → ALEC app → Application ID' },
      { key: 'MS_CLIENT_SECRET', label: 'Client Secret',       type: 'password', placeholder: '••••••••',          envVar: 'MS_CLIENT_SECRET', required: true, hint: 'Azure → App Registrations → ALEC → Certificates & secrets' },
      { key: 'MS_USER_EMAIL',    label: 'User Email (optional)', type: 'email',  placeholder: 'you@company.com',  envVar: 'MS_USER_EMAIL',    required: false },
    ],
    async checkStatus() {
      const ms = require('./microsoftGraphService.js');
      return ms.status();
    },
  },

  // ── Analytics & Reporting ──────────────────────────────────
  {
    id: 'domo',
    name: 'Domo',
    icon: '📊',
    category: 'Analytics',
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

  // ── Research ───────────────────────────────────────────────
  {
    id: 'research',
    name: 'Deep Research Agent',
    icon: '🔍',
    category: 'Research',
    description: 'Autonomous web research: breaks topics into questions, searches, synthesizes, and sends report via iMessage.',
    fields: [
      { key: 'BRAVE_API_KEY', label: 'Brave Search API Key (optional)', type: 'password', placeholder: 'BSA...', envVar: 'BRAVE_API_KEY', required: false, hint: 'api.search.brave.com — improves search quality. Falls back to DuckDuckGo if not set.' },
    ],
    async checkStatus() {
      const braveKey = process.env.BRAVE_API_KEY;
      return { available: true, searchEngine: braveKey ? 'Brave Search' : 'DuckDuckGo (free fallback)' };
    },
  },

  // ── Task Scheduler ─────────────────────────────────────────
  {
    id: 'task-scheduler',
    name: 'Task Scheduler',
    icon: '📅',
    category: 'Automation',
    description: 'Schedule recurring tasks, run background jobs, get iMessage alerts when done.',
    fields: [],
    async checkStatus() {
      const ts = require('./taskScheduler.js');
      const tasks = ts.listTasks();
      return { running: true, scheduledTasks: tasks.crons.length, backgroundTasks: tasks.background.length };
    },
  },

  // ── Home Assistant ─────────────────────────────────────────
  {
    id: 'homeassistant',
    name: 'Home Assistant',
    icon: '🏡',
    category: 'Smart Home',
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

  // ── Anthropic Claude ───────────────────────────────────────
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    icon: '🤖',
    category: 'AI',
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

// ── Runtime: check each skill's live status ────────────────────────

async function getSkillStatus(skillId) {
  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  if (!skill) return { error: 'Unknown skill' };
  try {
    const result = await Promise.race([
      skill.checkStatus(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]);
    return result;
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

// ── Credential management ──────────────────────────────────────────

/**
 * Save credentials for a skill.
 * Credentials are encrypted and written to both data/skills-config.json and .env.
 */
async function saveCredentials(skillId, credentials) {
  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  const cfg = loadConfig();

  // Store encrypted in config
  cfg.skills[skillId] = cfg.skills[skillId] || {};
  for (const [key, value] of Object.entries(credentials)) {
    if (value) {
      cfg.skills[skillId][key] = encrypt(value);
    }
  }
  saveConfig(cfg);

  // Also update .env file AND process.env for live use
  const envPath = path.join(__dirname, '../.env');
  let envContent = '';
  try { envContent = fs.readFileSync(envPath, 'utf8'); } catch (_) {}

  for (const [key, value] of Object.entries(credentials)) {
    if (!value) continue;
    process.env[key] = value; // live update without restart

    const envKey = skill?.fields?.find(f => f.key === key)?.envVar || key;
    const regex = new RegExp(`^${envKey}=.*$`, 'm');
    const newLine = `${envKey}=${value}`;
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, newLine);
    } else {
      envContent += `\n${newLine}`;
    }
  }

  try { fs.writeFileSync(envPath, envContent, 'utf8'); } catch (e) {
    console.warn('[Skills] Could not write .env:', e.message);
  }

  return { success: true, skillId };
}

/**
 * Get current credential status for a skill (masked — shows which fields are filled).
 */
function getCredentialStatus(skillId) {
  const skill = BUILTIN_SKILLS.find(s => s.id === skillId);
  if (!skill) return {};
  const cfg = loadConfig();
  const saved = cfg.skills[skillId] || {};

  return skill.fields.map(f => {
    const envVal = process.env[f.envVar];
    const savedVal = saved[f.key];
    const hasValue = !!(envVal || savedVal);
    return {
      key: f.key, label: f.label, required: f.required,
      configured: hasValue,
      source: envVal ? 'env' : savedVal ? 'saved' : 'none',
    };
  });
}

// ── Custom skills ──────────────────────────────────────────────────

function addCustomSkill(definition) {
  const cfg = loadConfig();
  cfg.custom = cfg.custom || [];
  const existing = cfg.custom.findIndex(s => s.id === definition.id);
  if (existing >= 0) cfg.custom[existing] = definition;
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
  const cfg = loadConfig();
  return cfg.custom || [];
}

// ── Full catalog for UI ────────────────────────────────────────────

function getCatalog() {
  const custom = getCustomSkills();
  const allSkills = [
    ...BUILTIN_SKILLS.map(s => ({
      id: s.id, name: s.name, icon: s.icon, category: s.category,
      description: s.description, macOnly: s.macOnly || false,
      fields: s.fields.map(f => ({ ...f, value: undefined })), // don't expose values
      builtin: true,
    })),
    ...custom.map(s => ({ ...s, builtin: false })),
  ];

  // Group by category
  const grouped = {};
  for (const skill of allSkills) {
    if (!grouped[skill.category]) grouped[skill.category] = [];
    grouped[skill.category].push(skill);
  }
  return { skills: allSkills, byCategory: grouped };
}

module.exports = {
  getCatalog,
  getSkillStatus,
  getAllStatuses,
  saveCredentials,
  getCredentialStatus,
  addCustomSkill,
  removeCustomSkill,
  getCustomSkills,
  BUILTIN_SKILLS,
};

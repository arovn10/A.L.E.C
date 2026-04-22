/**
 * backend/routes/mcpCatalog.mjs
 *
 * Curated MCP directory surfaced in the Settings › MCPs › Discover sidebar.
 * Each entry is a copy-paste template users can customise on install — we
 * never auto-install from the catalog; the user drives creation from the
 * right-drawer form, pre-filled with the template's transport/command/args.
 *
 * Kept small and hand-picked. Expand by PR, not by scraping — scraped
 * catalogs are the #1 vector for supply-chain injection in MCP ecosystems.
 */

export const MCP_CATALOG = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    publisher: 'modelcontextprotocol',
    description: 'Read/write files inside one or more allowed directories. Safe default for local file ops.',
    category: 'Local',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/allowed/dir'],
    env: {},
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
  },
  {
    id: 'github',
    name: 'GitHub',
    publisher: 'github',
    description: 'Official GitHub MCP: repos, issues, PRs, Actions. Scoped by personal access token.',
    category: 'Source Control',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    docs: 'https://github.com/github/github-mcp-server',
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    publisher: 'modelcontextprotocol',
    description: 'Read-only SQL access to a Postgres database. Connection string injected via env.',
    category: 'Data',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    env: { POSTGRES_URL: '' },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    publisher: 'modelcontextprotocol',
    description: 'Query a local SQLite database. Useful for inspecting ALEC\'s own data/alec.db.',
    category: 'Data',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '--db', '/path/to/db.sqlite'],
    env: {},
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
  },
  {
    id: 'slack',
    name: 'Slack',
    publisher: 'modelcontextprotocol',
    description: 'Read channels, post messages, search history. Requires a Slack bot token.',
    category: 'Comms',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    env: { SLACK_BOT_TOKEN: '', SLACK_TEAM_ID: '' },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/slack',
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    publisher: 'modelcontextprotocol',
    description: 'Web search via the Brave Search API. Falls back gracefully to no-key mode.',
    category: 'Data',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer (browser)',
    publisher: 'modelcontextprotocol',
    description: 'Headless Chrome automation: navigate, click, extract, screenshot.',
    category: 'Local',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-puppeteer'],
    env: {},
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
  },
  {
    id: 'fetch',
    name: 'Fetch',
    publisher: 'modelcontextprotocol',
    description: 'Fetch a URL and return its contents as markdown. Simplest web-read primitive.',
    category: 'Data',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-fetch'],
    env: {},
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
  },
  {
    id: 'memory',
    name: 'Memory',
    publisher: 'modelcontextprotocol',
    description: 'Persistent knowledge graph stored on disk. Cross-session context for LLM chats.',
    category: 'Local',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    docs: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
  },
  {
    id: 'tenantcloud',
    name: 'TenantCloud (browser)',
    publisher: 'alec',
    description: 'Headed Chromium driver for app.tenantcloud.com — auto-logs in with vault creds, lets you take over the window. Starter-tier has no API, so this is the bridge.',
    category: 'Finance',
    transport: 'stdio',
    command: 'node',
    args: ['backend/mcp-servers/tenantcloud/index.mjs'],
    env: { TENANTCLOUD_EMAIL: '', TENANTCLOUD_PASSWORD: '', ALEC_TENANTCLOUD_CONNECTOR_ID: '' },
    docs: 'https://app.tenantcloud.com',
  },
  {
    id: 'context7',
    name: 'Context7',
    publisher: 'upstash',
    description: 'Fetch current, version-specific documentation for thousands of libraries.',
    category: 'Data',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    env: {},
    docs: 'https://github.com/upstash/context7',
  },
];

export function categoriesOf(entries = MCP_CATALOG) {
  const cats = new Map();
  for (const e of entries) {
    cats.set(e.category, (cats.get(e.category) || 0) + 1);
  }
  return [...cats.entries()].map(([name, count]) => ({ name, count }));
}

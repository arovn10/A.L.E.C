# A.L.E.C. MCP (Model Context Protocol) Servers

This directory contains Model Context Protocol servers that extend A.L.E.C.'s capabilities to external tools and services.

## Overview

MCP provides a standardized way for AI assistants to interact with external systems through typed tools and resources. Each server implements specific functionality:

| Server | Description | Status |
|--------|-------------|--------|
| `documentProcessor.js` | Real estate document analysis (PDF, DOCX, TXT) | ✅ Active |
| `neuralEngine.js` | LLM inference with personality traits | ✅ Active |
| `integrationManager.js` | Outlook, Teams, iMessage, Asana integrations | ✅ Active |
| `smartHome.js` | Smart home device control | ✅ Active |

## Configuration

The MCP servers are configured in `.claude/mcp.json`. Each server can be enabled/disabled and has its own environment variables.

### Environment Variables Required

```bash
# Domo (Domo BI Dashboard Access)
DOMO_API_KEY=your_domo_api_key
DOMO_INSTANCE_URL=https://your-instance.domohost.com

# GitHub (Stoa Group Repository Access)
STOA_GITHUB_TOKEN=ghp_your_github_token

# Azure SQL Database (A.L.E.C. Knowledge Base)
STOA_DB_HOST=stoagroupdb.database.windows.net
STOA_DB_PORT=1433
STOA_DB_NAME=stoagroupDB
STOA_DB_USER=arovner
STOA_DB_PASSWORD=your_password

# Gmail Integration
GMAIL_SERVICE_ACCOUNT_PATH=/path/to/service-account.json
```

## Usage

### Local Development

Run a specific MCP server:

```bash
node backend/mcp/neuralEngine.js
node backend/mcp/documentProcessor.js
node backend/mcp/integrationManager.js
node backend/mcp/smartHome.js
```

### Claude Code Integration

When using A.L.E.C. with Claude Code, the servers in `.claude/mcp.json` are automatically available as tools:

```bash
# Example: Analyze a document
@document-processor analyze-document --path /path/to/report.pdf

# Example: Query knowledge base
@azure-sql-manager query-knowledge --topic "real estate" --limit 5

# Example: Control smart home device
@smart-home control-device --device thermostaat --action setTemp --parameters '{"temp": 72}'
```

## Available Tools

### Document Processor (`documentProcessor.js`)

| Tool | Description |
|------|-------------|
| `analyze-document` | Analyze a document as a real estate analyst |
| `get-knowledge` | Query Stoa Group knowledge base |
| `update-knowledge` | Add new knowledge to the database |

### Neural Engine (`neuralEngine.js`)

| Tool | Description |
|------|-------------|
| `query` | Process a query through the LLM |
| `get-stats` | Get neural engine statistics |
| `model-status` | Check model loading status |
| `personality/update` | Update personality traits dynamically |

### Integration Manager (`integrationManager.js`)

| Tool | Description |
|------|-------------|
| `connect-account` | Connect an external account (Outlook, Gmail, etc.) |
| `disconnect-account` | Disconnect an external account |
| `sync-data` | Sync data from connected account |
| `personalization/get` | Get account personalization settings |
| `personalization/set` | Update account personalization |

### Smart Home Controller (`smartHome.js`)

| Tool | Description |
|------|-------------|
| `device/register` | Register a smart home device |
| `device/control` | Control a smart home device |
| `device/status` | Get device status |
| `devices/list` | List all registered devices |

## Adding New MCP Servers

To create a new MCP server:

1. Create the server file in `backend/mcp/`
2. Implement the standard interface:
   - `initialize()` - Setup and connection
   - `handleRequest(request)` - Process tool requests
   - `run()` - Start stdin/stdout listener
3. Add configuration to `.claude/mcp.json`

### Template

```javascript
#!/usr/bin/env node
const { MCPServer } = require('../mcp/server');

class MyCustomServer extends MCPServer {
  async initialize() {
    // Setup logic here
  }

  async handleRequest(request) {
    switch (request.method) {
      case 'custom/tool':
        return this.customTool(request.params);
      default:
        return { error: `Unknown method: ${request.method}` };
    }
  }
}

const server = new MyCustomServer();
server.run().catch(console.error);
```

## Troubleshooting

### Server not starting

Check logs at `/tmp/altec_mcp.log`:

```bash
node backend/mcp/neuralEngine.js > /tmp/altec_mcp.log 2>&1 &
tail -f /tmp/altec_mcp.log
```

### Environment variables missing

Run `vercel env pull` to get the latest environment configuration, or manually set them in `.env.local`:

```bash
export STOA_GITHUB_TOKEN=ghp_your_token
node backend/mcp/neuralEngine.js
```

## Security Notes

- Never commit API keys or tokens to version control
- Use Git LFS for sensitive model files
- Rotate credentials regularly
- Enable audit logging in production

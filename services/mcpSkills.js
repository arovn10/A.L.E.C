/**
 * MCP Skills Manager - Model Context Protocol Integration
 * Enables A.L.E.C. to install and use external skills/tools
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

class MCPSkillsManager {
  constructor() {
    this.skillsDirectory = path.join(__dirname, '../skills');
    this.installedSkills = new Map();
    this.activeConnections = new Map(); // skillId -> connection config
    this.mcpRegistry = []; // Available MCP skills from GitHub

    this.initialize();
  }

  /**
   * Initialize MCP Skills Manager
   */
  async initialize() {
    console.log('🔧 Initializing MCP Skills Manager...');

    // Load installed skills
    await this.loadInstalledSkills();

    // Discover available MCP skills from registry
    await this.discoverAvailableSkills();

    console.log(`✅ MCP Skills Manager ready - ${this.installedSkills.size} skills installed`);
  }

  /**
   * Load installed skills from disk
   */
  async loadInstalledSkills() {
    try {
      const skillsPath = path.join(this.skillsDirectory, 'installed.json');
      if (fs.existsSync(skillsPath)) {
        const data = JSON.parse(fs.readFileSync(skillsPath));

        for (const [name, config] of Object.entries(data)) {
          this.installedSkills.set(name, config);

          // Initialize skill connection if needed
          if (config.autoConnect) {
            await this.connectSkill(name);
          }
        }
      }
    } catch (error) {
      console.error('Error loading installed skills:', error);
    }
  }

  /**
   * Discover available MCP skills from GitHub registry
   */
  async discoverAvailableSkills() {
    try {
      // In production, fetch from https://github.com/arovn10/A.L.E.C-skills-registry
      const mockRegistry = [
        {
          id: 'github-mcp',
          name: 'GitHub MCP',
          description: 'Access GitHub repositories, issues, PRs programmatically',
          version: '1.2.0',
          author: 'arovn10',
          category: 'development',
          permissions: ['read:org', 'repo'],
          installationCommand: 'npm install @modelcontextprotocol/github'
        },
        {
          id: 'home-assistant-mcp',
          name: 'Home Assistant MCP',
          description: 'Full smart home control and automation',
          version: '2.0.1',
          author: 'arovn10',
          category: 'smarthome',
          permissions: ['homeassistant:read', 'homeassistant:write'],
          installationCommand: 'pip install mcp-home-assistant'
        },
        {
          id: 'notion-mcp',
          name: 'Notion MCP',
          description: 'Create and manage Notion pages, databases',
          version: '1.0.5',
          author: 'arovn10',
          category: 'productivity',
          permissions: ['integration_token'],
          installationCommand: 'npm install @modelcontextprotocol/notion'
        },
        {
          id: 'email-mcp',
          name: 'Email MCP',
          description: 'Send, read, and organize emails via IMAP/Exchange',
          version: '1.3.2',
          author: 'arovn10',
          category: 'communication',
          permissions: ['imap_access'],
          installationCommand: 'npm install @modelcontextprotocol/email'
        },
        {
          id: 'calendar-mcp',
          name: 'Calendar MCP',
          description: 'Manage calendar events, meetings, and reminders',
          version: '1.1.0',
          author: 'arovn10',
          category: 'productivity',
          permissions: ['calendar_full_access'],
          installationCommand: 'npm install @modelcontextprotocol/calendar'
        },
        {
          id: 'chrome-mcp',
          name: 'Chrome MCP',
          description: 'Browser automation, web scraping, and research',
          version: '2.1.0',
          author: 'arovn10',
          category: 'browsing',
          permissions: ['browser_control'],
          installationCommand: 'npm install @modelcontextprotocol/chrome'
        },
        {
          id: 'imessage-mcp',
          name: 'iMessage MCP',
          description: 'Send and receive iMessages, sync conversations',
          version: '1.0.3',
          author: 'arovn10',
          category: 'communication',
          permissions: ['messaging_access'],
          installationCommand: 'npm install @modelcontextprotocol/imessage'
        },
        {
          id: 'render-mcp',
          name: 'Render MCP',
          description: 'Manage Render.com deployments, services, and resources',
          version: '1.2.4',
          author: 'arovn10',
          category: 'devops',
          permissions: ['render_api_access'],
          installationCommand: 'npm install @modelcontextprotocol/render'
        }
      ];

      this.mcpRegistry = mockRegistry;
      console.log(`📚 Discovered ${mockRegistry.length} available MCP skills`);
    } catch (error) {
      console.error('Error discovering MCP skills:', error);
    }
  }

  /**
   * Install a new skill from the registry
   */
  async installSkill(skillId, config = {}) {
    const skillInfo = this.mcpRegistry.find(s => s.id === skillId);

    if (!skillInfo) {
      throw new Error(`Skill ${skillId} not found in registry`);
    }

    console.log(`🔧 Installing skill: ${skillInfo.name}`);

    try {
      // Validate permissions before installation
      const userPermissions = config.permissions || [];
      if (!this.hasRequiredPermissions(skillInfo.permissions, userPermissions)) {
        throw new Error('Insufficient permissions for this skill');
      }

      // Create skill configuration
      const skillConfig = {
        id: skillId,
        name: skillInfo.name,
        version: skillInfo.version,
        category: skillInfo.category,
        permissions: userPermissions,
        autoConnect: config.autoConnect || false,
        installedAt: Date.now(),
        status: 'installing'
      };

      // Execute installation command (in production)
      if (skillInfo.installationCommand) {
        console.log(`📦 Running installation: ${skillInfo.installationCommand}`);

        // For demo, simulate installation
        await new Promise(resolve => setTimeout(resolve, 2000));

        skillConfig.status = 'active';
      } else {
        skillConfig.status = 'manual_install_required';
      }

      this.installedSkills.set(skillId, skillConfig);

      // Save to disk
      await this.saveInstalledSkills();

      console.log(`✅ Skill ${skillInfo.name} installed successfully`);
      return skillConfig;

    } catch (error) {
      console.error('Skill installation failed:', error);
      throw error;
    }
  }

  /**
   * Connect to an installed skill
   */
  async connectSkill(skillId, connectionConfig = {}) {
    const skill = this.installedSkills.get(skillId);

    if (!skill || skill.status !== 'active') {
      throw new Error(`Skill ${skillId} is not active`);
    }

    console.log(`🔗 Connecting to skill: ${skill.name}`);

    try {
      // Create connection based on skill type
      const connection = await this.createConnection(skill, connectionConfig);

      this.activeConnections.set(skillId, connection);

      return { success: true, connection };
    } catch (error) {
      console.error('Skill connection failed:', error);
      throw error;
    }
  }

  /**
   * Create appropriate connection for skill type
   */
  async createConnection(skill, config) {
    switch (skill.id) {
      case 'github-mcp':
        return this.createGitHubConnection(config);

      case 'home-assistant-mcp':
        return this.createHomeAssistantConnection(config);

      case 'notion-mcp':
        return this.createNotionConnection(config);

      case 'email-mcp':
        return this.createEmailConnection(config);

      case 'calendar-mcp':
        return this.createCalendarConnection(config);

      case 'chrome-mcp':
        return this.createChromeConnection(config);

      case 'imessage-mcp':
        return this.createiMessageConnection(config);

      case 'render-mcp':
        return this.createRenderConnection(config);

      default:
        throw new Error(`Unknown skill type: ${skill.id}`);
    }
  }

  // Connection creators for each skill type
  async createGitHubConnection(config) {
    return {
      type: 'github',
      token: config.github_token,
      orgs: config.orgs || [],
      status: 'connected'
    };
  }

  async createHomeAssistantConnection(config) {
    const { url, access_token } = config;

    if (!url || !access_token) {
      throw new Error('Missing Home Assistant credentials');
    }

    return {
      type: 'home_assistant',
      url,
      access_token,
      status: 'connected'
    };
  }

  async createNotionConnection(config) {
    const { integration_token } = config;

    if (!integration_token) {
      throw new Error('Missing Notion integration token');
    }

    return {
      type: 'notion',
      integration_token,
      status: 'connected'
    };
  }

  async createEmailConnection(config) {
    const { imap_host, username, password } = config;

    if (!imap_host || !username || !password) {
      throw new Error('Missing email credentials');
    }

    return {
      type: 'email',
      protocol: 'IMAP',
      host: imap_host,
      username,
      password, // In production, encrypt this!
      status: 'connected'
    };
  }

  async createCalendarConnection(config) {
    const { calendar_token, provider } = config;

    if (!calendar_token || !provider) {
      throw new Error('Missing calendar credentials');
    }

    return {
      type: 'calendar',
      provider, // google, outlook, apple
      token: calendar_token,
      status: 'connected'
    };
  }

  async createChromeConnection(config) {
    const { chrome_user_data_dir } = config;

    if (!chrome_user_data_dir) {
      throw new Error('Missing Chrome user data directory');
    }

    return {
      type: 'chrome',
      userDataDir: chrome_user_data_dir,
      status: 'connected'
    };
  }

  async createiMessageConnection(config) {
    // Requires macOS and proper permissions
    const { allow_access = true } = config;

    if (!allow_access) {
      throw new Error('iMessage access not allowed');
    }

    return {
      type: 'imessage',
      status: 'connected'
    };
  }

  async createRenderConnection(config) {
    const { render_api_token, account_name } = config;

    if (!render_api_token || !account_name) {
      throw new Error('Missing Render credentials');
    }

    return {
      type: 'render',
      api_token: render_api_token,
      account_name,
      status: 'connected'
    };
  }

  /**
   * Check if user has required permissions for skill
   */
  hasRequiredPermissions(required, granted) {
    return required.every(perm => granted.includes(perm));
  }

  /**
   * Save installed skills to disk
   */
  async saveInstalledSkills() {
    const skillsPath = path.join(this.skillsDirectory, 'installed.json');
    fs.writeFileSync(skillsPath, JSON.stringify(
      Object.fromEntries(this.installedSkills),
      null,
      2
    ));
  }

  /**
   * Get list of available skills for installation
   */
  getAvailableSkills() {
    return this.mcpRegistry.map(skill => ({
      ...skill,
      installed: this.installedSkills.has(skill.id),
      status: this.installedSkills.get(skill.id)?.status || 'not_installed'
    }));
  }

  /**
   * Get list of installed skills with connection status
   */
  getInstalledSkills() {
    return Array.from(this.installedSkills.entries()).map(([id, config]) => ({
      id: config.id,
      name: config.name,
      version: config.version,
      category: config.category,
      permissions: config.permissions,
      status: config.status,
      connected: this.activeConnections.has(id)
    }));
  }

  /**
   * Disconnect a skill
   */
  async disconnectSkill(skillId) {
    const connection = this.activeConnections.get(skillId);

    if (!connection) {
      throw new Error(`Skill ${skillId} is not connected`);
    }

    // Close connection based on type
    switch (connection.type) {
      case 'home_assistant':
        console.log('Closing Home Assistant connection');
        break;

      case 'email':
        console.log('Closing email connection');
        break;

      default:
        console.log('Closing skill connection');
    }

    this.activeConnections.delete(skillId);
    console.log(`✅ Skill ${skillId} disconnected`);
  }

  /**
   * Update skill permissions
   */
  async updateSkillPermissions(skillId, newPermissions) {
    const skill = this.installedSkills.get(skillId);

    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    skill.permissions = newPermissions;
    await this.saveInstalledSkills();

    console.log(`✅ Updated permissions for ${skill.name}`);
  }

  /**
   * Remove a skill completely
   */
  async removeSkill(skillId) {
    const skill = this.installedSkills.get(skillId);

    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    // Disconnect first
    await this.disconnectSkill(skillId);

    // Remove from installed skills
    this.installedSkills.delete(skillId);
    await this.saveInstalledSkills();

    console.log(`✅ Removed skill: ${skill.name}`);
  }
}

module.exports = { MCPSkillsManager };

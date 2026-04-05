#!/usr/bin/env node
/**
 * A.L.E.C. Integration Manager MCP Server
 * Manages Outlook, Teams, iMessage, Asana integrations for account personalization
 */

const { IntegrationManager } = require('../integrationManager');

class IntegrationManagerMCP {
  constructor() {
    this.manager = new IntegrationManager();
    this.initialized = false;
  }

  async initialize() {
    console.log('🔗 Initializing Integration Manager MCP Server...');
    await this.manager.initializeIntegrations();
    this.initialized = true;
    console.log('✅ Integrations initialized:', this.manager.integrations.size);
    return true;
  }

  async connectAccount(userId, integrationId, credentials) {
    if (!this.initialized) await this.initialize();

    const result = await this.manager.connectAccount(userId, integrationId, credentials);
    return result.success ? { success: true, ...result } : { error: result.error };
  }

  async disconnectAccount(userId, integrationId) {
    if (!this.initialized) await this.initialize();

    const success = await this.manager.disconnectAccount(userId, integrationId);
    return success ? { success: true, message: 'Disconnected' } : { error: 'Not found' };
  }

  async syncAccountData(userId, integrationId) {
    if (!this.initialized) await this.initialize();

    const result = await this.manager.syncAccountData(userId, integrationId);
    return result.success ? { success: true, ...result } : { error: result.error };
  }

  async getPersonalization(userId, integrationId) {
    if (!this.initialized) await this.initialize();

    const personalization = await this.manager.getAccountPersonalization(
      userId,
      integrationId
    );

    return personalization
      ? { success: true, personalization }
      : { error: 'Account not connected' };
  }

  async setPersonalization(userId, integrationId, settings) {
    if (!this.initialized) await this.initialize();

    await this.manager.setAccountPersonalization(userId, integrationId, settings);
    return { success: true, message: 'Personalization updated' };
  }

  async getStatus() {
    const status = await this.manager.getIntegrationStatus();
    return { success: true, integrations: status };
  }

  async handleRequest(request) {
    switch (request.method) {
      case 'connect':
        return this.connectAccount(
          request.params.userId,
          request.params.integrationId,
          request.params.credentials
        );
      case 'disconnect':
        return this.disconnectAccount(
          request.params.userId,
          request.params.integrationId
        );
      case 'sync':
        return this.syncAccountData(
          request.params.userId,
          request.params.integrationId
        );
      case 'personalization/get':
        return this.getPersonalization(
          request.params.userId,
          request.params.integrationId
        );
      case 'personalization/set':
        return this.setPersonalization(
          request.params.userId,
          request.params.integrationId,
          request.params.settings
        );
      case 'status':
        return this.getStatus();
      default:
        return { error: `Unknown method: ${request.method}` };
    }
  }

  async run() {
    await this.initialize();

    process.stdin.on('data', async (chunk) => {
      try {
        const request = JSON.parse(chunk.toString());
        const response = await this.handleRequest(request);
        console.log(JSON.stringify(response));
      } catch (error) {
        console.error('MCP Error:', error.message);
      }
    });

    console.log('🔗 Integration Manager MCP Server ready');
  }
}

const server = new IntegrationManagerMCP();
server.run().catch(console.error);

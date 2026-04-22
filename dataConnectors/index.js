// dataConnectors/index.js
'use strict';

/**
 * ConnectorRegistry — unified interface for all ALEC data sources.
 * ALEC reads from connectors. Connectors NEVER write back to source systems (H1).
 *
 * Each connector: { name: string, fetch(params): Promise<any>, schema: object, tags: string[] }
 */
class ConnectorRegistry {
  constructor() { this._connectors = new Map(); }

  register(connector) {
    if (!connector.name || typeof connector.fetch !== 'function') {
      throw new Error('Connector must have name and fetch()');
    }
    this._connectors.set(connector.name, connector);
  }

  get(name) { return this._connectors.get(name); }

  list() { return [...this._connectors.keys()]; }

  async fetch(name, params = {}) {
    const connector = this._connectors.get(name);
    if (!connector) throw new Error(`Unknown connector: ${name}`);
    return connector.fetch(params);
  }
}

// Singleton — shared across the whole server process
const registry = new ConnectorRegistry();

module.exports = { ConnectorRegistry, registry };

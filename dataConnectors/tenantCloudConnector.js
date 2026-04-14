// dataConnectors/tenantCloudConnector.js
'use strict';

const path = require('path');
const fs   = require('fs');

const TC_CACHE_PATH = process.env.TC_CACHE_PATH ||
  path.join(__dirname, '../data/tc-cache.json');

/**
 * TenantCloud connector — reads from tc-cache.json (populated by browser relay).
 * Never writes back to TenantCloud. Hard Rule H1.
 *
 * params: { entity?: 'tenants'|'leases'|'maintenance'|'all' }
 * returns: { data: any, cachedAt: string|null }
 */
const tenantCloudConnector = {
  name: 'tenantCloud',
  tags: ['tenants', 'leases', 'rent', 'maintenance', 'stoa'],
  schema: {
    description: 'TenantCloud cache — tenants, leases, maintenance requests.',
    params: { entity: 'tenants | leases | maintenance | all (default: all)' },
  },
  async fetch({ entity = 'all' } = {}) {
    if (!fs.existsSync(TC_CACHE_PATH)) {
      return { data: null, cachedAt: null, error: 'TenantCloud cache not found — run browser sync first.' };
    }
    const cache = JSON.parse(fs.readFileSync(TC_CACHE_PATH, 'utf8'));
    if (entity === 'all') return { data: cache, cachedAt: cache.syncedAt || null };
    return { data: cache[entity] || null, cachedAt: cache.syncedAt || null };
  },
};

module.exports = tenantCloudConnector;

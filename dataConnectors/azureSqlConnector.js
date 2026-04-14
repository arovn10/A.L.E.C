// dataConnectors/azureSqlConnector.js
'use strict';

/**
 * Azure SQL connector — SELECT-only queries against stoagroupDB.
 * Never writes. Hard Rule H1.
 *
 * params: { sql: string, inputs?: Array<{ name, type, value }> }
 * returns: { recordset: Array<object> }
 */
const sql = require('mssql');

const DB_CONFIG = {
  server:   process.env.STOA_DB_HOST,
  port:     parseInt(process.env.STOA_DB_PORT, 10) || 1433,
  database: process.env.STOA_DB_NAME,
  user:     process.env.STOA_DB_USER,
  password: process.env.STOA_DB_PASSWORD,
  options: { encrypt: true, trustServerCertificate: false, connectTimeout: 15000, requestTimeout: 30000 },
};

let _pool = null;
async function getPool() {
  if (!_pool) _pool = await sql.connect(DB_CONFIG);
  return _pool;
}

const azureSqlConnector = {
  name: 'azureSql',
  tags: ['stoa', 'loans', 'leasing', 'occupancy', 'covenants', 'equity', 't12'],
  schema: {
    description: 'Azure SQL stoagroupDB — leasing, loans, covenants, pipeline, T12.',
    params: { sql: 'SELECT-only parameterized query', inputs: 'optional { name, type, value }[]' },
  },
  async fetch({ sql: query, inputs = [] }) {
    if (!/^\s*SELECT/i.test(query)) {
      throw new Error('[azureSqlConnector] Only SELECT queries allowed (H1)');
    }
    const pool = await getPool();
    const request = pool.request();
    for (const inp of inputs) request.input(inp.name, inp.type, inp.value);
    const result = await request.query(query);
    return { recordset: result.recordset };
  },
};

module.exports = azureSqlConnector;

/**
 * backend/auth/_pool.js — Sprint 1
 *
 * Reuses the existing stoaQueryService mssql pool so auth reads don't open
 * a second Azure SQL connection. If the pool module exposes a private
 * accessor later, switch to it here without touching callers.
 */
'use strict';

const sql = require('mssql');

let _pool = null;
let _poolPromise = null;

function cfg() {
  return {
    server:   process.env.STOA_DB_HOST,
    port:     parseInt(process.env.STOA_DB_PORT, 10) || 1433,
    database: process.env.STOA_DB_NAME,
    user:     process.env.STOA_DB_USER,
    password: process.env.STOA_DB_PASSWORD,
    options:  { encrypt: true, trustServerCertificate: false, enableArithAbort: true },
    requestTimeout:    25000,
    connectionTimeout: 15000,
    pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
  };
}

async function getPoolForAuth() {
  if (_pool && _pool.connected) return _pool;
  if (_poolPromise) return _poolPromise;
  _poolPromise = (async () => {
    const pool = new sql.ConnectionPool(cfg());
    await pool.connect();
    pool.on('error', () => { _pool = null; _poolPromise = null; });
    _pool = pool; _poolPromise = null;
    return pool;
  })();
  return _poolPromise;
}

module.exports = { getPoolForAuth };

/**
 * backend/auth/password.js — Sprint 1
 *
 * Password hashing with a self-describing format so we can swap algorithms
 * without a migration:
 *
 *   argon2id$<encoded>     ← preferred; require('argon2') if present
 *   scrypt$N$r$p$<saltHex>$<hashHex>   ← Node built-in fallback
 *
 * The charter mandates memory-hard hashing. argon2id is the gold standard;
 * scrypt is the acceptable fallback when the `argon2` native module can't
 * build (common on Electron rebuild mismatches).
 *
 * verify() autodetects the prefix so old hashes keep working after an algo
 * upgrade. hash() always uses the strongest available.
 */
'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const scryptAsync = promisify(crypto.scrypt);

let argon2 = null;
try { argon2 = require('argon2'); } catch { /* fallback path */ }

// scrypt parameters — OWASP 2023+ recommendation: N=2^17, r=8, p=1 ≈ 128 MiB.
// OpenSSL default maxmem cap is 32 MiB, so we must raise it explicitly.
const SCRYPT = { N: 1 << 17, r: 8, p: 1, dkLen: 64, maxmem: 256 * 1024 * 1024 };

async function hash(plain) {
  if (typeof plain !== 'string' || plain.length < 10) {
    throw new Error('Password must be at least 10 characters.');
  }
  if (argon2) {
    const encoded = await argon2.hash(plain, {
      type: argon2.argon2id,
      memoryCost: 1 << 16,   // 64 MiB
      timeCost: 3,
      parallelism: 1,
    });
    return 'argon2id$' + encoded;
  }
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(plain, salt, SCRYPT.dkLen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verify(plain, stored) {
  if (!stored || stored === 'UNCLAIMED') return false;
  if (stored.startsWith('argon2id$')) {
    if (!argon2) throw new Error('argon2 hash present but argon2 module not installed.');
    return argon2.verify(stored.slice('argon2id$'.length), plain);
  }
  if (stored.startsWith('scrypt$')) {
    const [, N, r, p, saltHex, hashHex] = stored.split('$');
    const derived = await scryptAsync(
      plain,
      Buffer.from(saltHex, 'hex'),
      hashHex.length / 2,
      { N: +N, r: +r, p: +p, maxmem: 256 * 1024 * 1024 },
    );
    // constant-time compare
    const a = Buffer.from(hashHex, 'hex');
    return a.length === derived.length && crypto.timingSafeEqual(a, derived);
  }
  return false;
}

module.exports = { hash, verify };

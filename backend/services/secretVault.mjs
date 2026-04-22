// backend/services/secretVault.mjs
// UUID-keyed AES-256-CBC secret vault. Values are stored as "ivHex:ciphertextHex"
// under vault.instances[<connector_instance_id>][<field_key>].
//
// Env:
//   ALEC_VAULT_PATH  (default: data/skills-config.json)
//   ALEC_VAULT_KEY   (64 hex chars = 32 bytes = AES-256 key)

import fs from 'node:fs';
import crypto from 'node:crypto';

const ALGO = 'aes-256-cbc';

function keyBuf() {
  const hex = process.env.ALEC_VAULT_KEY || '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ALEC_VAULT_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function vaultPath() {
  return process.env.ALEC_VAULT_PATH || 'data/skills-config.json';
}

function load() {
  try { return JSON.parse(fs.readFileSync(vaultPath(), 'utf8')); }
  catch { return {}; }
}

function save(obj) {
  fs.writeFileSync(vaultPath(), JSON.stringify(obj, null, 2));
}

function encryptValue(plain) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv(ALGO, keyBuf(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return iv.toString('hex') + ':' + ct.toString('hex');
}

function decryptValue(blob) {
  const [ivHex, ctHex] = String(blob).split(':');
  const d = crypto.createDecipheriv(ALGO, keyBuf(), Buffer.from(ivHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(ctHex, 'hex')), d.final()]).toString('utf8');
}

export function setFields(id, fields) {
  const o = load();
  o.instances = o.instances || {};
  o.instances[id] = o.instances[id] || {};
  for (const [k, v] of Object.entries(fields)) {
    o.instances[id][k] = encryptValue(String(v));
  }
  save(o);
}

export function getFields(id) {
  const o = load();
  const entry = (o.instances || {})[id] || {};
  const out = {};
  for (const [k, v] of Object.entries(entry)) out[k] = decryptValue(v);
  return out;
}

export function deleteInstance(id) {
  const o = load();
  if (o.instances) delete o.instances[id];
  save(o);
}

export function redact(fields, defs) {
  const secretKeys = new Set((defs || []).filter(d => d.secret).map(d => d.key));
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    out[k] = secretKeys.has(k) ? '••••••••' : v;
  }
  return out;
}

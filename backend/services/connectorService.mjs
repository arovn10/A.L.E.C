// backend/services/connectorService.mjs
// DAO over connector_instances + connector_definitions. Enforces ACL, merges
// vault-backed secret fields, and writes audit rows for every mutation.

import crypto from 'node:crypto';
import { setFields, getFields, deleteInstance, redact } from './secretVault.mjs';

function defFor(db, id) {
  const r = db.prepare('SELECT * FROM connector_definitions WHERE id=?').get(id);
  if (!r) throw new Error('UNKNOWN_DEFINITION');
  return { ...r, fields: JSON.parse(r.fields_json) };
}

function membershipsOf(db, userId) {
  return db.prepare('SELECT org_id, role FROM org_memberships WHERE user_id=?').all(userId);
}

export function listVisible(db, userId) {
  const mems = membershipsOf(db, userId);
  const orgIds = mems.map(m => m.org_id);
  if (orgIds.length === 0) {
    return db.prepare(
      "SELECT * FROM connector_instances WHERE scope_type='user' AND scope_id=?"
    ).all(userId);
  }
  const placeholders = orgIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM connector_instances
     WHERE (scope_type='user' AND scope_id=?)
        OR (scope_type='org'  AND scope_id IN (${placeholders}))`
  ).all(userId, ...orgIds);
}

export function canWrite(db, userId, inst) {
  if (!inst) return false;
  if (inst.scope_type === 'user') return inst.scope_id === userId;
  const m = db.prepare(
    'SELECT role FROM org_memberships WHERE user_id=? AND org_id=?'
  ).get(userId, inst.scope_id);
  return !!m && ['admin', 'owner'].includes(m.role);
}

export function writeAudit(db, { userId, orgId, action, targetType, targetId, metadata }) {
  db.prepare(
    `INSERT INTO audit_log(user_id, org_id, action, target_type, target_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(userId, orgId || null, action, targetType, targetId,
       metadata ? JSON.stringify(metadata) : null);
}

export function create(db, { definitionId, scope, scopeId, fields, displayName, createdBy }) {
  const def = defFor(db, definitionId);
  if (def.is_org_only && scope === 'user') throw new Error('ORG_ONLY');
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO connector_instances
      (id, definition_id, scope_type, scope_id, display_name, enabled, created_by)
     VALUES (?, ?, ?, ?, ?, 1, ?)`
  ).run(id, definitionId, scope, scopeId, displayName || null, createdBy);
  setFields(id, fields || {});
  writeAudit(db, {
    userId: createdBy,
    orgId: scope === 'org' ? scopeId : null,
    action: 'connector.create', targetType: 'connector', targetId: id,
  });
  return get(db, id, createdBy);
}

export function get(db, id, userId, { reveal = false } = {}) {
  const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(id);
  if (!inst) return null;
  const def = defFor(db, inst.definition_id);
  const raw = getFields(id);
  const fields = reveal ? raw : redact(raw, def.fields);
  return {
    ...inst,
    fields,
    definition: { id: def.id, name: def.name, fields: def.fields },
  };
}

export function update(db, id, userId, { fields, displayName, enabled }) {
  const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(id);
  if (!inst) throw new Error('NOT_FOUND');
  if (!canWrite(db, userId, inst)) throw new Error('FORBIDDEN');
  if (fields) setFields(id, fields);
  db.prepare(
    `UPDATE connector_instances
       SET display_name = COALESCE(?, display_name),
           enabled      = COALESCE(?, enabled),
           updated_at   = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(displayName ?? null, enabled == null ? null : (enabled ? 1 : 0), id);
  writeAudit(db, {
    userId, orgId: inst.scope_type === 'org' ? inst.scope_id : null,
    action: 'connector.update', targetType: 'connector', targetId: id,
  });
  return get(db, id, userId);
}

export function remove(db, id, userId) {
  const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(id);
  if (!inst) return;
  if (!canWrite(db, userId, inst)) throw new Error('FORBIDDEN');
  db.prepare('DELETE FROM connector_instances WHERE id=?').run(id);
  deleteInstance(id);
  writeAudit(db, {
    userId, orgId: inst.scope_type === 'org' ? inst.scope_id : null,
    action: 'connector.delete', targetType: 'connector', targetId: id,
  });
}

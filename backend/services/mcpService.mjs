// backend/services/mcpService.mjs
// DAO over mcp_servers — mirrors connectorService so the routes look
// symmetric. No process management in S2: runtime (start/stop/test)
// lands in S4. Every mutation writes an audit row via writeAudit.

import crypto from 'node:crypto';
import { writeAudit } from './connectorService.mjs';

function membershipsOf(db, userId) {
  return db.prepare('SELECT org_id FROM org_memberships WHERE user_id=?').all(userId);
}

function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    args: row.args_json ? JSON.parse(row.args_json) : [],
    env_ref_ids: row.env_ref_ids_json ? JSON.parse(row.env_ref_ids_json) : [],
    tools: row.tools_json ? JSON.parse(row.tools_json) : [],
  };
}

export function listVisible(db, userId) {
  const mems = membershipsOf(db, userId);
  const orgIds = mems.map(m => m.org_id);
  if (orgIds.length === 0) {
    return db.prepare(
      "SELECT * FROM mcp_servers WHERE scope_type='user' AND scope_id=?"
    ).all(userId).map(parseRow);
  }
  const placeholders = orgIds.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM mcp_servers
      WHERE (scope_type='user' AND scope_id=?)
         OR (scope_type='org'  AND scope_id IN (${placeholders}))`
  ).all(userId, ...orgIds).map(parseRow);
}

export function canWrite(db, userId, row) {
  if (!row) return false;
  if (row.scope_type === 'user') return row.scope_id === userId;
  const m = db.prepare(
    'SELECT role FROM org_memberships WHERE user_id=? AND org_id=?'
  ).get(userId, row.scope_id);
  return !!m && ['admin', 'owner'].includes(m.role);
}

export function get(db, id) {
  return parseRow(db.prepare('SELECT * FROM mcp_servers WHERE id=?').get(id));
}

export function create(db, {
  name, scope, scopeId, transport, command, args, url,
  envRefIds, enabled = 1, autoStart = 1, createdBy,
}) {
  if (!['stdio', 'http', 'sse', 'websocket'].includes(transport)) {
    throw new Error('INVALID_TRANSPORT');
  }
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO mcp_servers
      (id, name, scope_type, scope_id, transport, command, args_json, url,
       env_ref_ids_json, enabled, auto_start, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, scope, scopeId, transport, command || null,
        JSON.stringify(args || []), url || null,
        JSON.stringify(envRefIds || []), enabled ? 1 : 0, autoStart ? 1 : 0, createdBy);
  writeAudit(db, {
    userId: createdBy, orgId: scope === 'org' ? scopeId : null,
    action: 'mcp.create', targetType: 'mcp', targetId: id,
  });
  return get(db, id);
}

export function update(db, id, userId, patch) {
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id=?').get(id);
  if (!row) throw new Error('NOT_FOUND');
  if (!canWrite(db, userId, row)) throw new Error('FORBIDDEN');
  const fields = [];
  const values = [];
  if (patch.name != null)        { fields.push('name=?');         values.push(patch.name); }
  if (patch.command != null)     { fields.push('command=?');      values.push(patch.command); }
  if (patch.url != null)         { fields.push('url=?');          values.push(patch.url); }
  if (patch.transport != null)   { fields.push('transport=?');    values.push(patch.transport); }
  if (patch.args != null)        { fields.push('args_json=?');    values.push(JSON.stringify(patch.args)); }
  if (patch.envRefIds != null)   { fields.push('env_ref_ids_json=?'); values.push(JSON.stringify(patch.envRefIds)); }
  if (patch.enabled != null)     { fields.push('enabled=?');      values.push(patch.enabled ? 1 : 0); }
  if (patch.autoStart != null)   { fields.push('auto_start=?');   values.push(patch.autoStart ? 1 : 0); }
  if (fields.length) {
    db.prepare(`UPDATE mcp_servers SET ${fields.join(', ')} WHERE id=?`).run(...values, id);
  }
  writeAudit(db, {
    userId, orgId: row.scope_type === 'org' ? row.scope_id : null,
    action: 'mcp.update', targetType: 'mcp', targetId: id,
  });
  return get(db, id);
}

export function remove(db, id, userId) {
  const row = db.prepare('SELECT * FROM mcp_servers WHERE id=?').get(id);
  if (!row) return;
  if (!canWrite(db, userId, row)) throw new Error('FORBIDDEN');
  db.prepare('DELETE FROM mcp_servers WHERE id=?').run(id);
  writeAudit(db, {
    userId, orgId: row.scope_type === 'org' ? row.scope_id : null,
    action: 'mcp.delete', targetType: 'mcp', targetId: id,
  });
}

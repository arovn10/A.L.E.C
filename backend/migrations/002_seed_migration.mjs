// backend/migrations/002_seed_migration.mjs
// Idempotent seed for migration 002: three orgs, the full connector catalog,
// and arovner@stoagroup.com as owner of all three orgs.
//
// Invoked from runBootstrap() when ALEC_CONNECTORS_V2=1. May also be extended
// later (S1.9) with runFullMigration() to absorb the legacy skills-config.json.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CATALOG } from '../connectors/catalog.mjs';
import { setFields } from '../services/secretVault.mjs';
import { writeAudit } from '../services/connectorService.mjs';
import { buildMigrationPlan } from './002_mapping.mjs';

const DOMAIN_TO_ORG = {
  'stoagroup.com':         'stoagroup',
  'abodingo.com':          'abodingo',
  'campusrentalsllc.com':  'campusrentals',
};

export async function up(db) {
  const insertOrg = db.prepare(
    'INSERT OR IGNORE INTO organizations(id, name, email_domain) VALUES (?, ?, ?)'
  );
  insertOrg.run('stoagroup',     'Stoa Group',     'stoagroup.com');
  insertOrg.run('abodingo',      'Abodingo',       'abodingo.com');
  insertOrg.run('campusrentals', 'Campus Rentals', 'campusrentalsllc.com');

  const insertDef = db.prepare(
    `INSERT OR REPLACE INTO connector_definitions
       (id, name, category, icon, auth_type, fields_json, multi_instance, is_org_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of CATALOG) {
    insertDef.run(c.id, c.name, c.category, c.icon, c.auth_type,
      JSON.stringify(c.fields), c.multi_instance, c.is_org_only);
  }

  const insertMem = db.prepare(
    'INSERT OR IGNORE INTO org_memberships(user_id, org_id, role) VALUES (?, ?, ?)'
  );
  for (const org of ['stoagroup', 'abodingo', 'campusrentals']) {
    insertMem.run('arovner@stoagroup.com', org, 'owner');
  }

  // S4.4 — Pre-seed the Desktop Control MCP row (stopped). S7 flips it on.
  db.prepare(
    `INSERT OR IGNORE INTO mcp_servers
       (id, name, scope_type, scope_id, transport, command, args_json,
        enabled, auto_start, status, created_by)
     VALUES ('desktop-control', 'Desktop Control', 'user',
             'arovner@stoagroup.com', 'stdio', 'node',
             ?, 0, 0, 'stopped', 'system')`
  ).run(JSON.stringify(['backend/mcp-servers/desktop-control/index.js']));
}

/**
 * runFullMigration(db, { users, vaultPath })
 *   - Inserts per-domain memberships for the provided user list.
 *   - Reads the legacy vault JSON, writes a timestamped .bak next to it.
 *   - buildMigrationPlan() → iterate plan, skip entries whose reasonTag-based
 *     uniqueness key is already present in audit_log (idempotent re-runs).
 *   - Creates connector_instances rows + vault entries + migrate audit rows.
 *   - Uses a lockfile at <vaultDir>/.migration.lock.
 */
export async function runFullMigration(db, { users, vaultPath }) {
  const vaultDir = path.dirname(vaultPath);
  fs.mkdirSync(vaultDir, { recursive: true });
  const lock = path.join(vaultDir, '.migration.lock');
  if (fs.existsSync(lock)) throw new Error('MIGRATION_LOCKED');
  fs.writeFileSync(lock, String(process.pid));
  try {
    // 1. Memberships by domain
    const insertMem = db.prepare(
      'INSERT OR IGNORE INTO org_memberships(user_id, org_id, role) VALUES (?, ?, ?)'
    );
    for (const u of users || []) {
      const domain = String(u.split('@')[1] || '').toLowerCase();
      const org = DOMAIN_TO_ORG[domain];
      if (org) {
        insertMem.run(u, org, u === 'arovner@stoagroup.com' ? 'owner' : 'member');
      } else {
        console.warn(`[migration002] no org match for user ${u} — skipping membership`);
      }
    }

    // 2. Backup + plan
    if (!fs.existsSync(vaultPath)) return { inserted: 0 };
    const json = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
    const backup = `${vaultPath}.pre-migration-${Date.now()}.bak`;
    fs.copyFileSync(vaultPath, backup);
    const plan = buildMigrationPlan(json);

    // 3. Idempotency: each entry stamped with a unique reasonTag stored in audit metadata
    const already = new Set(
      db.prepare(
        "SELECT json_extract(metadata_json, '$.reasonTag') AS r FROM audit_log WHERE action='migrate'"
      ).all().map(r => r.r).filter(Boolean)
    );

    const insertInst = db.prepare(
      `INSERT INTO connector_instances
        (id, definition_id, scope_type, scope_id, display_name, enabled, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?)`
    );
    let inserted = 0;
    for (const p of plan) {
      const uniq = `${p.reasonTag}:${p.scope}:${p.scopeId}:${p.definitionId}:${p.displayName || ''}`;
      if (already.has(uniq)) continue;
      const id = crypto.randomUUID();
      insertInst.run(id, p.definitionId, p.scope, p.scopeId, p.displayName || null, 'system');
      setFields(id, p.fields || {});
      writeAudit(db, {
        userId: 'system',
        orgId: p.scope === 'org' ? p.scopeId : null,
        action: 'migrate', targetType: 'connector', targetId: id,
        metadata: { reasonTag: uniq },
      });
      inserted++;
    }
    return { inserted, backup };
  } finally {
    try { fs.unlinkSync(lock); } catch {}
  }
}

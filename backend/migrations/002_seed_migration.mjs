// backend/migrations/002_seed_migration.mjs
// Idempotent seed for migration 002: three orgs, the full connector catalog,
// and arovner@stoagroup.com as owner of all three orgs.
//
// Invoked from runBootstrap() when ALEC_CONNECTORS_V2=1. May also be extended
// later (S1.9) with runFullMigration() to absorb the legacy skills-config.json.

import { CATALOG } from '../connectors/catalog.mjs';

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
}

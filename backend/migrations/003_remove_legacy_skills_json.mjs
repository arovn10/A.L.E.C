// backend/migrations/003_remove_legacy_skills_json.mjs
// S6.3 — opt-in wipe of the legacy skills-config.json top-level branches.
//
// The migration runner always loads this file when advancing past 002, but
// the destructive part only runs when ALEC_ALLOW_LEGACY_WIPE=1. This keeps
// production boots safe (migration records as applied but is a no-op) while
// giving operators a deterministic way to finalize the wipe on a host that
// has already completed the migrate-verify preflight.
//
// Post-conditions when the flag is set:
//   - <vaultPath>.pre-wipe-<ts>.bak is written alongside the original
//   - vault JSON keeps only { instances: {...} } (everything else removed)
//   - audit_log gains one row with action='vault.wipe', metadata {backup}

import fs from 'node:fs';

export async function up(db) {
  if (process.env.ALEC_ALLOW_LEGACY_WIPE !== '1') {
    console.warn('[migration003] skipped (set ALEC_ALLOW_LEGACY_WIPE=1 to run)');
    return;
  }
  const p = process.env.ALEC_VAULT_PATH || 'data/skills-config.json';
  if (!fs.existsSync(p)) return;
  const bak = `${p}.pre-wipe-${Date.now()}.bak`;
  fs.copyFileSync(p, bak);
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  const kept = { instances: o.instances || {} };
  fs.writeFileSync(p, JSON.stringify(kept, null, 2));
  db.prepare(
    'INSERT INTO audit_log(user_id, action, target_type, target_id, metadata_json) VALUES (?, ?, ?, ?, ?)'
  ).run('system', 'vault.wipe', 'vault', '-', JSON.stringify({ backup: bak }));
}

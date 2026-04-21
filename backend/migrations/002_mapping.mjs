// backend/migrations/002_mapping.mjs
// Pure function translating the legacy skills-config.json shape into a plan of
// connector_instance rows. No I/O; safe to unit-test in isolation.
//
// Shape:
//   users[uid].<connectorId>                → {definitionId, scope:'user', scopeId:uid, fields, reasonTag:'user'}
//   users[uid].microsoft365 = [ {...}, ... ] → one entry per array element, displayName from .name
//   global.stoa / global.aws                → org 'stoagroup'
//   global.homeassistant                    → org 'campusrentals'
//   global.imessage                         → user arovner@stoagroup.com
//   _legacy.*                               → per spec table (lines 246-257)

const FALLBACK_OWNER = 'arovner@stoagroup.com';

export function buildMigrationPlan(json) {
  const out = [];

  // users[uid].<connector>
  for (const [uid, byConn] of Object.entries(json.users || {})) {
    for (const [def, fields] of Object.entries(byConn || {})) {
      if (def === 'microsoft365' && Array.isArray(fields)) {
        fields.forEach((f, i) => out.push({
          definitionId: def, scope: 'user', scopeId: uid,
          fields: f, displayName: f.name || `Instance ${i + 1}`,
          reasonTag: 'user',
        }));
      } else {
        out.push({ definitionId: def, scope: 'user', scopeId: uid, fields, reasonTag: 'user' });
      }
    }
  }

  const g = json.global || {};
  if (g.stoa)          out.push({ definitionId: 'stoa',          scope: 'org',  scopeId: 'stoagroup',     fields: g.stoa,          reasonTag: 'global.stoa' });
  if (g.homeassistant) out.push({ definitionId: 'homeassistant', scope: 'org',  scopeId: 'campusrentals', fields: g.homeassistant, reasonTag: 'global.homeassistant' });
  if (g.imessage)      out.push({ definitionId: 'imessage',      scope: 'user', scopeId: FALLBACK_OWNER,  fields: g.imessage,      reasonTag: 'global.imessage' });
  if (g.aws)           out.push({ definitionId: 'aws',           scope: 'org',  scopeId: 'stoagroup',     fields: g.aws,           reasonTag: 'global.aws' });

  const L = json._legacy || {};
  if (L.stoa)        out.push({ definitionId: 'stoa',        scope: 'org',  scopeId: 'stoagroup',     fields: L.stoa,        reasonTag: '_legacy.stoa' });
  if (L.tenantcloud) out.push({ definitionId: 'tenantcloud', scope: 'org',  scopeId: 'campusrentals', fields: L.tenantcloud, reasonTag: '_legacy.tenantcloud' });
  if (L.github)      out.push({ definitionId: 'github',      scope: 'user', scopeId: FALLBACK_OWNER,  fields: L.github,      reasonTag: '_legacy.github' });
  if (L.render)      out.push({ definitionId: 'render',      scope: 'user', scopeId: FALLBACK_OWNER,  fields: L.render,      reasonTag: '_legacy.render' });

  return out;
}

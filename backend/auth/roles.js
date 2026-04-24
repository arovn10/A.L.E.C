/**
 * backend/auth/roles.js — Sprint 1
 *
 * Frozen role registry. Capability changes require a code deploy (Hard-rule H10).
 * Per-user *scope* (which projects / dashboards they can see) is the dynamic
 * piece and lives in the `alec.UserScopes` table.
 *
 * Ranks are total-ordered:  Master > Admin > Analyst > Partner > Viewer.
 * `canInvite` lists the maximum role this role can mint via invite.
 *
 * Capabilities are intentionally coarse — scope-level gating happens via
 * requireScope(). This file answers "what CAN this role do at all", not
 * "what data can they see".
 */
'use strict';

const ROLES = Object.freeze({
  Master: Object.freeze({
    rank: 100,
    canInvite: ['Admin', 'Analyst', 'Partner', 'Viewer'],
    capabilities: Object.freeze([
      'owner', 'full_access', 'user_management', 'audit_read',
      'neural_training', 'smart_home', 'stoa_data', 'connectors',
      'chat', 'exports', 'writeback', 'master_key_rotate',
    ]),
    implicitScope: '*', // Master sees everything
  }),
  Admin: Object.freeze({
    rank: 80,
    canInvite: ['Analyst', 'Partner', 'Viewer'],
    capabilities: Object.freeze([
      'user_management', 'audit_read',
      'neural_training', 'smart_home', 'stoa_data', 'connectors',
      'chat', 'exports', 'writeback',
    ]),
    implicitScope: '*', // Admin sees everything; scope list limits which admin-ops they can mutate via requireScope()
  }),
  Analyst: Object.freeze({
    rank: 60,
    canInvite: [],
    capabilities: Object.freeze(['stoa_data', 'chat', 'exports', 'writeback', 'connectors']),
    implicitScope: null,
  }),
  Partner: Object.freeze({
    rank: 40,
    canInvite: [],
    capabilities: Object.freeze(['stoa_data', 'chat']),
    implicitScope: null,
  }),
  Viewer: Object.freeze({
    rank: 20,
    canInvite: [],
    capabilities: Object.freeze(['chat']),
    implicitScope: null,
  }),
});

const MASTER_EMAIL = 'arovner@stoagroup.com';

/** True if `actor` role is rank-≥ `needed`. */
function roleAtLeast(actor, needed) {
  const a = ROLES[actor], n = ROLES[needed];
  return !!(a && n && a.rank >= n.rank);
}

/** True if `actor` is allowed to mint an invite for `target`. */
function canInviteRole(actor, target) {
  const a = ROLES[actor];
  return !!(a && a.canInvite.includes(target));
}

/** True if the role has this capability globally (before scope checks). */
function hasCapability(role, cap) {
  const r = ROLES[role];
  return !!(r && r.capabilities.includes(cap));
}

module.exports = {
  ROLES, MASTER_EMAIL,
  roleAtLeast, canInviteRole, hasCapability,
};

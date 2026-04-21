# Implementation Plan: Connectors & MCPs Multi-Tenant Settings Surface

**Date:** 2026-04-21
**Spec:** `docs/superpowers/specs/2026-04-21-connectors-mcp-design.md`
**Owner:** arovner@stoagroup.com
**Feature flag:** `ALEC_CONNECTORS_V2`

---

## Goal

Replace the ad-hoc `data/skills-config.json` credential store with a multi-tenant (Stoa Group, Abodingo, Campus Rentals) Connectors + MCP Settings surface. Six new SQLite tables, new REST API, Claude.ai-style Settings page, MCP spawn/stop runtime, legacy JSON wipe, and a Desktop Control hybrid skill+MCP.

## Architecture (Hybrid)

- **SQLite** (`data/alec.db`) — structural: orgs, memberships, connector catalog + instances, MCP servers, audit, desktop permissions/policy.
- **Encrypted JSON** (`data/skills-config.json`) — secret values only, keyed by connector instance UUID (AES-256-CBC via existing vault).
- **Service layer** — new `backend/services/connectorService.js` brokers all reads/writes; existing `services/skillsRegistry.js` reduced to a pure UUID-keyed secret vault.
- **Feature flag** — every stage gated behind `process.env.ALEC_CONNECTORS_V2`.

## Tech stack

- Node 20 ESM, Express 4, better-sqlite3, jsonwebtoken, zod
- jest@29.7.0 + supertest@7.2.2, run via `NODE_OPTIONS=--experimental-vm-modules jest --forceExit`
- React 18 + React Query v5 + Tailwind (existing)
- Electron desktop app (S7 only)

## REQUIRED SUB-SKILL

**Execute this plan using `superpowers:subagent-driven-development`.** Each task is a bite-sized TDD loop (write failing test -> verify red -> minimal impl -> verify green -> commit). The driver agent dispatches each task as a subagent with only the task's context; it does not carry prior-task state forward.

---

## File Structure

### Created

**Backend — migrations / services / routes / catalog**
- `backend/migrations/002_connectors_mcp.sql`
- `backend/migrations/002_seed_migration.js`
- `backend/migrations/003_remove_legacy_skills_json.js`
- `backend/connectors/catalog.js`
- `backend/services/connectorService.js`
- `backend/services/mcpService.js`
- `backend/services/secretVault.js`
- `backend/services/desktopControl.js`
- `backend/services/desktopPermissions.js`
- `backend/services/desktopPolicy.js`
- `backend/routes/orgs.js`
- `backend/routes/connectors.js`
- `backend/routes/mcp.js`
- `backend/routes/desktop.js`
- `backend/middleware/requireConnectorWrite.js`
- `backend/middleware/requireOrgRole.js`
- `backend/mcp-servers/desktop-control/index.js`
- `backend/mcp-servers/desktop-control/package.json`
- `scripts/connector-vault-doctor.js`
- `scripts/migrate-verify.js`

**Frontend — settings**
- `frontend/src/pages/Settings/SettingsPage.jsx`
- `frontend/src/pages/Settings/TenantSwitcher.jsx`
- `frontend/src/pages/Settings/ConnectorsTab.jsx`
- `frontend/src/pages/Settings/ConnectorList.jsx`
- `frontend/src/pages/Settings/ConnectorDrawer.jsx`
- `frontend/src/pages/Settings/ConnectorFormField.jsx`
- `frontend/src/pages/Settings/MCPsTab.jsx`
- `frontend/src/pages/Settings/MCPList.jsx`
- `frontend/src/pages/Settings/MCPDrawer.jsx`
- `frontend/src/pages/Settings/OrgMembersTab.jsx`
- `frontend/src/pages/Settings/DesktopTab.jsx`
- `frontend/src/context/OrgContext.jsx`
- `frontend/src/hooks/useScopedConnectors.js`
- `frontend/src/hooks/useScopedMCPs.js`
- `frontend/src/hooks/useDesktopStatus.js`
- `frontend/src/api/orgs.js`
- `frontend/src/api/connectors.js`
- `frontend/src/api/mcp.js`
- `frontend/src/api/desktop.js`

**Tests**
- `tests/unit/secretVault.test.js`
- `tests/unit/connectorService.test.js`
- `tests/unit/mcpService.test.js`
- `tests/unit/migration002.test.js`
- `tests/unit/catalog.test.js`
- `tests/unit/desktopPolicy.test.js`
- `tests/integration/orgs.test.js`
- `tests/integration/connectors.test.js`
- `tests/integration/mcp.test.js`
- `tests/integration/desktop-routes.test.js`
- `tests/migration/002-snapshot.test.js`
- `docs/test-plans/connectors-mcp-e2e.md`

### Modified

- `backend/server.js` — mount new routes, run migration 002 on boot
- `backend/auth/bootstrap.js` — support `.sql` + `.js` migrations, track `_migrations` table
- `services/skillsRegistry.js` — add UUID-keyed API; mark legacy keys deprecated
- `services/mcpSkills.js` — accept registered servers from SQL, not `.mcp.json`
- `frontend/src/App.jsx` — add `/settings` route, wrap in `OrgProvider`
- `frontend/src/pages/Settings.jsx` — redirect to new `/settings/*` layout
- `frontend/src/components/layout/Sidebar.jsx` — link to new settings
- `desktop-app/src/main.js` — IPC bridge for native permission probes + approval modal
- `.gitignore` — `data/skills-config.json.pre-migration-*.bak`
- `package.json` — add `migrate:verify` script

---

## Stage S1 — Data model, migration, DAO

**Gate:** `ALEC_CONNECTORS_V2=1` runs the migration; `0` keeps legacy code path.
**Exit:** All six tables exist; seed orgs + catalog loaded; `connectorService` CRUD passes unit tests; old code still runs.

### Task S1.1 — Migration runner supports `.sql` and `.js`

**Files**
- Modify: `backend/auth/bootstrap.js`
- Test: `tests/unit/migrationRunner.test.js` (new)

**Steps**
- [ ] Write failing test `tests/unit/migrationRunner.test.js`:
  - Creates a temp sqlite DB
  - Drops `fixtures/migration-runner/001_a.sql` (content: `CREATE TABLE a(x INTEGER);`) and `fixtures/migration-runner/002_b.js` (exports `async function up(db){ db.exec('CREATE TABLE b(y INTEGER);'); }`)
  - Calls `runMigrations(db, fixturesDir)`
  - Asserts `_migrations` table contains rows `'001_a'` and `'002_b'`
  - Asserts running again is a no-op (idempotent)
- [ ] Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/migrationRunner.test.js` — expect fail (runner lacks `.js` support)
- [ ] Modify `backend/auth/bootstrap.js`:
  - Ensure `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  - `readdirSync` migrations dir, sort lexicographically
  - For `.sql`: `db.exec(fs.readFileSync(...))`
  - For `.js`: `const mod = await import(pathToFileURL(...)); await mod.up(db)`
  - Wrap each in a transaction; insert into `_migrations` on success
  - Skip ids already present
- [ ] Re-run test — expect green
- [ ] Commit: `feat(migrations): support .sql and .js migration files with _migrations tracking`

### Task S1.2 — Migration 002 SQL: six tables

**Files**
- Create: `backend/migrations/002_connectors_mcp.sql`
- Test: `tests/unit/migration002.test.js`

**Steps**
- [ ] Write failing test `tests/unit/migration002.test.js`:
  ```js
  import Database from 'better-sqlite3';
  import { runMigrations } from '../../backend/auth/bootstrap.js';
  test('002 creates six tables + desktop tables', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, 'backend/migrations');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
    for (const t of ['organizations','org_memberships','connector_definitions','connector_instances','mcp_servers','audit_log','desktop_permissions','desktop_policy']) {
      expect(tables).toContain(t);
    }
  });
  ```
- [ ] Run — expect fail (file absent)
- [ ] Create `backend/migrations/002_connectors_mcp.sql` with the exact CREATE TABLE statements from the spec (lines 47-124 plus the desktop additions from 392-420). Use `CREATE TABLE IF NOT EXISTS` on every table. Add indices:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_instances_scope ON connector_instances(scope_type, scope_id);
  CREATE INDEX IF NOT EXISTS idx_mcp_scope ON mcp_servers(scope_type, scope_id);
  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_memberships_user ON org_memberships(user_id);
  ```
  Include the seed `INSERT OR IGNORE INTO desktop_policy(...)` and three `INSERT OR IGNORE INTO desktop_permissions(...)` rows from the spec.
- [ ] Run test — expect green
- [ ] Commit: `feat(db): migration 002 six connector/mcp tables + desktop permissions`

### Task S1.3 — Connector catalog (seed source)

**Files**
- Create: `backend/connectors/catalog.js`
- Test: `tests/unit/catalog.test.js`

**Steps**
- [ ] Write failing test `tests/unit/catalog.test.js`:
  ```js
  import { CATALOG } from '../../backend/connectors/catalog.js';
  test('catalog has required connectors', () => {
    const ids = CATALOG.map(c => c.id);
    for (const id of ['github','microsoft365','tenantcloud','twilio','stoa','homeassistant','imessage','aws','render']) {
      expect(ids).toContain(id);
    }
  });
  test('every entry has fields array with {key,label,type,required,secret}', () => {
    for (const c of CATALOG) {
      expect(Array.isArray(c.fields)).toBe(true);
      for (const f of c.fields) {
        expect(typeof f.key).toBe('string');
        expect(typeof f.label).toBe('string');
        expect(['text','password','url','textarea','select']).toContain(f.type);
        expect(typeof f.required).toBe('boolean');
        expect(typeof f.secret).toBe('boolean');
      }
    }
  });
  ```
- [ ] Run — expect fail
- [ ] Create `backend/connectors/catalog.js`:
  ```js
  export const CATALOG = [
    { id:'github', name:'GitHub', category:'source-control', icon:'🐙', auth_type:'apikey', multi_instance:0, is_org_only:0,
      fields:[{key:'GITHUB_TOKEN',label:'Personal Access Token',type:'password',required:true,secret:true}] },
    { id:'microsoft365', name:'Microsoft 365', category:'productivity', icon:'📧', auth_type:'oauth', multi_instance:1, is_org_only:0,
      fields:[
        {key:'MS365_TENANT_ID',label:'Tenant ID',type:'text',required:true,secret:false},
        {key:'MS365_CLIENT_ID',label:'Client ID',type:'text',required:true,secret:false},
        {key:'MS365_CLIENT_SECRET',label:'Client Secret',type:'password',required:true,secret:true},
        {key:'MS365_REFRESH_TOKEN',label:'Refresh Token',type:'password',required:false,secret:true} ] },
    { id:'tenantcloud', name:'TenantCloud', category:'finance', icon:'🏠', auth_type:'apikey', multi_instance:0, is_org_only:1,
      fields:[
        {key:'TENANTCLOUD_EMAIL',label:'Email',type:'text',required:true,secret:false},
        {key:'TENANTCLOUD_PASSWORD',label:'Password',type:'password',required:true,secret:true} ] },
    { id:'twilio', name:'Twilio', category:'comms', icon:'📞', auth_type:'apikey', multi_instance:0, is_org_only:0,
      fields:[
        {key:'TWILIO_ACCOUNT_SID',label:'Account SID',type:'text',required:true,secret:false},
        {key:'TWILIO_AUTH_TOKEN',label:'Auth Token',type:'password',required:true,secret:true},
        {key:'TWILIO_FROM',label:'From Number',type:'text',required:false,secret:false} ] },
    { id:'stoa', name:'Stoa Group DB', category:'data', icon:'🏛️', auth_type:'custom', multi_instance:0, is_org_only:1,
      fields:[
        {key:'STOA_DB_HOST',label:'Host',type:'text',required:true,secret:false},
        {key:'STOA_DB_USER',label:'User',type:'text',required:true,secret:false},
        {key:'STOA_DB_PASSWORD',label:'Password',type:'password',required:true,secret:true},
        {key:'STOA_DB_NAME',label:'Database',type:'text',required:true,secret:false} ] },
    { id:'homeassistant', name:'Home Assistant', category:'smart-home', icon:'🏡', auth_type:'apikey', multi_instance:0, is_org_only:1,
      fields:[
        {key:'HOMEASSISTANT_URL',label:'Base URL',type:'url',required:true,secret:false},
        {key:'HOMEASSISTANT_TOKEN',label:'Long-Lived Token',type:'password',required:true,secret:true} ] },
    { id:'imessage', name:'iMessage', category:'comms', icon:'💬', auth_type:'custom', multi_instance:0, is_org_only:0,
      fields:[{key:'IMESSAGE_DB_PATH',label:'chat.db path',type:'text',required:true,secret:false}] },
    { id:'aws', name:'AWS', category:'data', icon:'☁️', auth_type:'apikey', multi_instance:1, is_org_only:0,
      fields:[
        {key:'AWS_ACCESS_KEY_ID',label:'Access Key ID',type:'text',required:true,secret:false},
        {key:'AWS_SECRET_ACCESS_KEY',label:'Secret Access Key',type:'password',required:true,secret:true},
        {key:'AWS_REGION',label:'Region',type:'text',required:true,secret:false} ] },
    { id:'render', name:'Render', category:'source-control', icon:'🚀', auth_type:'apikey', multi_instance:0, is_org_only:0,
      fields:[{key:'RENDER_API_KEY',label:'API Key',type:'password',required:true,secret:true}] },
  ];
  ```
- [ ] Run test — expect green
- [ ] Commit: `feat(catalog): seed connector catalog with 9 connectors`

### Task S1.4 — Migration 002 seed step (orgs + memberships + catalog)

**Files**
- Create: `backend/migrations/002_seed_migration.js`
- Extend: `tests/unit/migration002.test.js`

**Steps**
- [ ] Extend test to call seed:
  ```js
  import { up as seedUp } from '../../backend/migrations/002_seed_migration.js';
  test('seed populates orgs and catalog', async () => {
    const db = new Database(':memory:');
    await runMigrations(db, 'backend/migrations');
    await seedUp(db);
    const orgs = db.prepare('SELECT id FROM organizations ORDER BY id').all().map(r=>r.id);
    expect(orgs).toEqual(['abodingo','campusrentals','stoagroup']);
    const defs = db.prepare('SELECT id FROM connector_definitions').all().map(r=>r.id);
    expect(defs).toContain('github');
    expect(defs.length).toBeGreaterThanOrEqual(9);
  });
  ```
- [ ] Run — expect fail
- [ ] Create `backend/migrations/002_seed_migration.js`:
  ```js
  import { CATALOG } from '../connectors/catalog.js';
  export async function up(db) {
    const insertOrg = db.prepare('INSERT OR IGNORE INTO organizations(id,name,email_domain) VALUES (?,?,?)');
    insertOrg.run('stoagroup','Stoa Group','stoagroup.com');
    insertOrg.run('abodingo','Abodingo','abodingo.com');
    insertOrg.run('campusrentals','Campus Rentals','campusrentalsllc.com');
    const insertDef = db.prepare(`INSERT OR REPLACE INTO connector_definitions
      (id,name,category,icon,auth_type,fields_json,multi_instance,is_org_only) VALUES (?,?,?,?,?,?,?,?)`);
    for (const c of CATALOG) {
      insertDef.run(c.id, c.name, c.category, c.icon, c.auth_type, JSON.stringify(c.fields), c.multi_instance, c.is_org_only);
    }
    // arovner owner of all three orgs
    const insertMem = db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)');
    for (const org of ['stoagroup','abodingo','campusrentals']) insertMem.run('arovner@stoagroup.com', org, 'owner');
  }
  ```
- [ ] Wire seed invocation: in `backend/auth/bootstrap.js`, after running file migrations, if `process.env.ALEC_CONNECTORS_V2==='1'` call `await seedUp(db)` from the module path `backend/migrations/002_seed_migration.js` (import only when flag set).
- [ ] Run test — expect green
- [ ] Commit: `feat(migrations): seed three orgs, catalog, owner membership for arovner`

### Task S1.5 — Secret vault (UUID-keyed AES-256-CBC)

**Files**
- Create: `backend/services/secretVault.js`
- Test: `tests/unit/secretVault.test.js`

**Steps**
- [ ] Write failing test:
  ```js
  import { setFields, getFields, deleteInstance, redact } from '../../backend/services/secretVault.js';
  import fs from 'node:fs';
  const TMP = '/tmp/vault-test.json';
  beforeEach(() => { try { fs.unlinkSync(TMP); } catch {} process.env.ALEC_VAULT_PATH=TMP; process.env.ALEC_VAULT_KEY='a'.repeat(64); });
  test('round trip', () => {
    setFields('uuid-1', { GITHUB_TOKEN: 'ghp_abc' });
    expect(getFields('uuid-1')).toEqual({ GITHUB_TOKEN: 'ghp_abc' });
  });
  test('delete wipes instance', () => {
    setFields('u', { K:'v' });
    deleteInstance('u');
    expect(getFields('u')).toEqual({});
  });
  test('redact replaces secret fields with dots', () => {
    expect(redact({K:'v'}, [{key:'K',secret:true}])).toEqual({K:'••••••••'});
    expect(redact({K:'v'}, [{key:'K',secret:false}])).toEqual({K:'v'});
  });
  ```
- [ ] Run — expect fail
- [ ] Create `backend/services/secretVault.js`:
  ```js
  import fs from 'node:fs';
  import crypto from 'node:crypto';
  const ALGO = 'aes-256-cbc';
  function keyBuf(){ return Buffer.from(process.env.ALEC_VAULT_KEY || '', 'hex'); }
  function vaultPath(){ return process.env.ALEC_VAULT_PATH || 'data/skills-config.json'; }
  function load(){ try { return JSON.parse(fs.readFileSync(vaultPath(),'utf8')); } catch { return {}; } }
  function save(obj){ fs.writeFileSync(vaultPath(), JSON.stringify(obj, null, 2)); }
  function enc(plain){
    const iv = crypto.randomBytes(16);
    const c = crypto.createCipheriv(ALGO, keyBuf(), iv);
    return iv.toString('hex') + ':' + Buffer.concat([c.update(plain,'utf8'), c.final()]).toString('hex');
  }
  function dec(blob){
    const [ivHex, ctHex] = blob.split(':');
    const d = crypto.createDecipheriv(ALGO, keyBuf(), Buffer.from(ivHex,'hex'));
    return Buffer.concat([d.update(Buffer.from(ctHex,'hex')), d.final()]).toString('utf8');
  }
  export function setFields(id, fields){
    const o = load(); o.instances = o.instances || {}; o.instances[id] = o.instances[id] || {};
    for (const [k,v] of Object.entries(fields)) o.instances[id][k] = enc(String(v));
    save(o);
  }
  export function getFields(id){
    const o = load(); const e = (o.instances||{})[id] || {};
    const out = {}; for (const [k,v] of Object.entries(e)) out[k] = dec(v);
    return out;
  }
  export function deleteInstance(id){
    const o = load(); if (o.instances) delete o.instances[id]; save(o);
  }
  export function redact(fields, defs){
    const secretKeys = new Set(defs.filter(d=>d.secret).map(d=>d.key));
    const out = {};
    for (const [k,v] of Object.entries(fields)) out[k] = secretKeys.has(k) ? '••••••••' : v;
    return out;
  }
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(vault): UUID-keyed secret vault with encrypt/decrypt/redact helpers`

### Task S1.6 — `connectorService` DAO: list/get/create/update/delete

**Files**
- Create: `backend/services/connectorService.js`
- Test: `tests/unit/connectorService.test.js`

**Steps**
- [ ] Write failing test covering:
  - `listVisible(userId)` returns instances where scope_type='user' AND scope_id=userId OR scope_type='org' AND scope_id IN memberships
  - `create({definitionId, scope, scopeId, fields, createdBy})` inserts SQL row + calls `setFields`
  - `get(id, userId)` redacts secrets unless `{reveal:true}` passed
  - `update(id, {fields})` updates vault + sets `updated_at`
  - `delete(id)` removes SQL row + calls `deleteInstance`
  - `canWrite(userId, instance)` -> true if owner of user-scoped, or admin/owner of org-scoped
  - `is_org_only` definition rejects `scope_type='user'` with a thrown error `ORG_ONLY`
- [ ] Run — expect fail
- [ ] Create `backend/services/connectorService.js`:
  ```js
  import crypto from 'node:crypto';
  import { setFields, getFields, deleteInstance, redact } from './secretVault.js';

  function defFor(db, id){
    const r = db.prepare('SELECT * FROM connector_definitions WHERE id=?').get(id);
    if (!r) throw new Error('UNKNOWN_DEFINITION');
    return { ...r, fields: JSON.parse(r.fields_json) };
  }
  function membershipsOf(db, userId){
    return db.prepare('SELECT org_id, role FROM org_memberships WHERE user_id=?').all(userId);
  }
  export function listVisible(db, userId){
    const mems = membershipsOf(db, userId);
    const orgIds = mems.map(m => m.org_id);
    const placeholders = orgIds.map(()=>'?').join(',') || "''";
    const rows = db.prepare(
      `SELECT * FROM connector_instances
       WHERE (scope_type='user' AND scope_id=?)
          OR (scope_type='org' AND scope_id IN (${placeholders}))`
    ).all(userId, ...orgIds);
    return rows;
  }
  export function canWrite(db, userId, inst){
    if (inst.scope_type==='user') return inst.scope_id === userId;
    const m = db.prepare('SELECT role FROM org_memberships WHERE user_id=? AND org_id=?').get(userId, inst.scope_id);
    return !!m && ['admin','owner'].includes(m.role);
  }
  export function create(db, { definitionId, scope, scopeId, fields, displayName, createdBy }){
    const def = defFor(db, definitionId);
    if (def.is_org_only && scope==='user') throw new Error('ORG_ONLY');
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO connector_instances
      (id,definition_id,scope_type,scope_id,display_name,enabled,created_by)
      VALUES (?,?,?,?,?,1,?)`).run(id, definitionId, scope, scopeId, displayName || null, createdBy);
    setFields(id, fields || {});
    writeAudit(db, { userId: createdBy, orgId: scope==='org'?scopeId:null, action:'connector.create', targetType:'connector', targetId:id });
    return get(db, id, createdBy);
  }
  export function get(db, id, userId, { reveal=false } = {}){
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(id);
    if (!inst) return null;
    const def = defFor(db, inst.definition_id);
    const raw = getFields(id);
    const fields = reveal ? raw : redact(raw, def.fields);
    return { ...inst, fields, definition: { id: def.id, name: def.name, fields: def.fields } };
  }
  export function update(db, id, userId, { fields, displayName, enabled }){
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(id);
    if (!inst) throw new Error('NOT_FOUND');
    if (!canWrite(db, userId, inst)) throw new Error('FORBIDDEN');
    if (fields) setFields(id, fields);
    db.prepare(`UPDATE connector_instances
      SET display_name=COALESCE(?,display_name), enabled=COALESCE(?,enabled), updated_at=CURRENT_TIMESTAMP
      WHERE id=?`).run(displayName ?? null, enabled==null?null:(enabled?1:0), id);
    writeAudit(db, { userId, orgId: inst.scope_type==='org'?inst.scope_id:null, action:'connector.update', targetType:'connector', targetId:id });
    return get(db, id, userId);
  }
  export function remove(db, id, userId){
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(id);
    if (!inst) return;
    if (!canWrite(db, userId, inst)) throw new Error('FORBIDDEN');
    db.prepare('DELETE FROM connector_instances WHERE id=?').run(id);
    deleteInstance(id);
    writeAudit(db, { userId, orgId: inst.scope_type==='org'?inst.scope_id:null, action:'connector.delete', targetType:'connector', targetId:id });
  }
  export function writeAudit(db, { userId, orgId, action, targetType, targetId, metadata }){
    db.prepare(`INSERT INTO audit_log(user_id,org_id,action,target_type,target_id,metadata_json)
      VALUES (?,?,?,?,?,?)`).run(userId, orgId || null, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null);
  }
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(connectorService): DAO with ACL, CRUD, audit`

### Task S1.7 — `connectorService.test()` liveness probe stub

**Files**
- Modify: `backend/services/connectorService.js`
- Extend: `tests/unit/connectorService.test.js`

**Steps**
- [ ] Add failing test: `test('test() sets status and last_checked', ...)` — calls `await testInstance(db, id, userId)`, asserts row has `status` and `last_checked` not null.
- [ ] Run — expect fail
- [ ] Add to `connectorService.js`:
  ```js
  const PROBES = {
    github: async (f) => { const r = await fetch('https://api.github.com/user', { headers:{Authorization:`Bearer ${f.GITHUB_TOKEN}`}}); return r.ok ? {ok:true} : {ok:false, detail:`HTTP ${r.status}`}; },
    // Other probes return {ok:true} as a noop; implementations grow over time.
  };
  export async function testInstance(db, id, userId){
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(id);
    if (!inst) throw new Error('NOT_FOUND');
    const fields = getFields(id);
    const probe = PROBES[inst.definition_id] || (async () => ({ ok: true }));
    let result;
    try { result = await probe(fields); } catch (e) { result = { ok:false, detail: String(e.message || e) }; }
    db.prepare(`UPDATE connector_instances SET status=?, status_detail=?, last_checked=CURRENT_TIMESTAMP WHERE id=?`)
      .run(result.ok ? 'connected' : 'error', result.detail || null, id);
    writeAudit(db, { userId, orgId: inst.scope_type==='org'?inst.scope_id:null, action:'connector.test', targetType:'connector', targetId:id, metadata: result });
    return result;
  }
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(connectorService): liveness test probe with audit trail`

### Task S1.8 — Migration 002 mapping function (legacy JSON -> rows)

**Files**
- Create: `backend/migrations/002_mapping.js`
- Test: `tests/unit/migration002Mapping.test.js`

**Steps**
- [ ] Write failing test feeding this snapshot:
  ```js
  const input = {
    users: { 'alice@stoagroup.com': { github: { GITHUB_TOKEN: 'ghp_a' } } },
    global: { stoa:{STOA_DB_HOST:'h',STOA_DB_PASSWORD:'p'}, homeassistant:{HOMEASSISTANT_URL:'u',HOMEASSISTANT_TOKEN:'t'},
              imessage:{IMESSAGE_DB_PATH:'/p'}, aws:{AWS_ACCESS_KEY_ID:'a',AWS_SECRET_ACCESS_KEY:'s',AWS_REGION:'us-east-1'} },
    _legacy: { stoa:{STOA_DB_HOST:'x',STOA_DB_PASSWORD:'y'}, tenantcloud:{TENANTCLOUD_EMAIL:'e',TENANTCLOUD_PASSWORD:'p'},
               github:{GITHUB_TOKEN:'g'}, render:{RENDER_API_KEY:'r'} }
  };
  const plan = buildMigrationPlan(input);
  ```
  Assert `plan` is an array of `{definitionId, scope, scopeId, fields, reasonTag}` entries matching the spec's migration table (lines 246-257).
- [ ] Run — expect fail
- [ ] Create `backend/migrations/002_mapping.js`:
  ```js
  const FALLBACK_OWNER = 'arovner@stoagroup.com';
  export function buildMigrationPlan(json){
    const out = [];
    // users[uid].<connector>
    for (const [uid, byConn] of Object.entries(json.users || {})){
      for (const [def, fields] of Object.entries(byConn || {})){
        if (def === 'microsoft365' && Array.isArray(fields)){
          fields.forEach((f, i) => out.push({ definitionId:def, scope:'user', scopeId:uid, fields:f, displayName:f.name || `Instance ${i+1}`, reasonTag:'user' }));
        } else {
          out.push({ definitionId:def, scope:'user', scopeId:uid, fields, reasonTag:'user' });
        }
      }
    }
    const g = json.global || {};
    if (g.stoa) out.push({ definitionId:'stoa', scope:'org', scopeId:'stoagroup', fields:g.stoa, reasonTag:'global.stoa' });
    if (g.homeassistant) out.push({ definitionId:'homeassistant', scope:'org', scopeId:'campusrentals', fields:g.homeassistant, reasonTag:'global.homeassistant' });
    if (g.imessage) out.push({ definitionId:'imessage', scope:'user', scopeId:FALLBACK_OWNER, fields:g.imessage, reasonTag:'global.imessage' });
    if (g.aws) out.push({ definitionId:'aws', scope:'org', scopeId:'stoagroup', fields:g.aws, reasonTag:'global.aws' });
    const L = json._legacy || {};
    if (L.stoa) out.push({ definitionId:'stoa', scope:'org', scopeId:'stoagroup', fields:L.stoa, reasonTag:'_legacy.stoa' });
    if (L.tenantcloud) out.push({ definitionId:'tenantcloud', scope:'org', scopeId:'campusrentals', fields:L.tenantcloud, reasonTag:'_legacy.tenantcloud' });
    if (L.github) out.push({ definitionId:'github', scope:'user', scopeId:FALLBACK_OWNER, fields:L.github, reasonTag:'_legacy.github' });
    if (L.render) out.push({ definitionId:'render', scope:'user', scopeId:FALLBACK_OWNER, fields:L.render, reasonTag:'_legacy.render' });
    return out;
  }
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(migrations): pure mapping function for legacy JSON to row plan`

### Task S1.9 — Migration 002 executor (domain-based memberships + file backup + apply plan)

**Files**
- Modify: `backend/migrations/002_seed_migration.js`
- Test: `tests/migration/002-snapshot.test.js`

**Steps**
- [ ] Write failing snapshot test that:
  - Seeds a temp DB, writes a sample legacy JSON to a temp vault path, sets `ALEC_VAULT_KEY`
  - Inserts two Azure-style user emails (`bob@abodingo.com`, `dan@campusrentalsllc.com`, `contractor@gmail.com`) via direct insert into a `users_seen` fixture (or passes as a list arg)
  - Calls `runFullMigration(db, { users: [...], vaultPath })`
  - Asserts memberships: bob->abodingo member, dan->campusrentals member, contractor has zero rows
  - Asserts expected `connector_instances` count matches plan
  - Asserts backup file exists at `skills-config.json.pre-migration-*.bak`
  - Asserts idempotency: a second call adds zero new rows
- [ ] Run — expect fail
- [ ] Extend `backend/migrations/002_seed_migration.js` with:
  ```js
  import fs from 'node:fs';
  import { setFields } from '../services/secretVault.js';
  import { buildMigrationPlan } from './002_mapping.js';
  import { writeAudit } from '../services/connectorService.js';
  import crypto from 'node:crypto';

  const DOMAIN_TO_ORG = { 'stoagroup.com':'stoagroup', 'abodingo.com':'abodingo', 'campusrentalsllc.com':'campusrentals' };

  export async function runFullMigration(db, { users, vaultPath }){
    // 1. Lock
    const lock = 'data/.migration.lock';
    if (fs.existsSync(lock)) throw new Error('MIGRATION_LOCKED');
    fs.mkdirSync('data', { recursive: true });
    fs.writeFileSync(lock, String(process.pid));
    try {
      // 2. Memberships by domain
      const insertMem = db.prepare('INSERT OR IGNORE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)');
      for (const u of users || []) {
        const domain = (u.split('@')[1] || '').toLowerCase();
        const org = DOMAIN_TO_ORG[domain];
        if (org) insertMem.run(u, org, u === 'arovner@stoagroup.com' ? 'owner' : 'member');
        else console.warn(`[migration002] no org match for user ${u} — skipping membership`);
      }
      // 3. Backup + plan
      if (!fs.existsSync(vaultPath)) return { inserted: 0 };
      const json = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
      const backup = `${vaultPath}.pre-migration-${Date.now()}.bak`;
      fs.copyFileSync(vaultPath, backup);
      const plan = buildMigrationPlan(json);
      // 4. Idempotency: skip entries already migrated (by reason tag stored in audit metadata)
      const already = new Set(db.prepare(`SELECT json_extract(metadata_json,'$.reasonTag') AS r FROM audit_log WHERE action='migrate'`).all().map(r=>r.r));
      const insertInst = db.prepare(`INSERT INTO connector_instances
        (id,definition_id,scope_type,scope_id,display_name,enabled,created_by) VALUES (?,?,?,?,?,1,?)`);
      let inserted = 0;
      for (const p of plan) {
        const uniq = `${p.reasonTag}:${p.scope}:${p.scopeId}:${p.definitionId}:${p.displayName || ''}`;
        if (already.has(uniq)) continue;
        const id = crypto.randomUUID();
        insertInst.run(id, p.definitionId, p.scope, p.scopeId, p.displayName || null, 'system');
        setFields(id, p.fields || {});
        writeAudit(db, { userId:'system', orgId: p.scope==='org'?p.scopeId:null, action:'migrate', targetType:'connector', targetId:id, metadata:{ reasonTag:uniq } });
        inserted++;
      }
      return { inserted, backup };
    } finally {
      try { fs.unlinkSync(lock); } catch {}
    }
  }
  ```
  Export `runFullMigration` and call it from `up(db)` when given a users list via env var (skip if users unknown).
- [ ] Run — expect green
- [ ] Commit: `feat(migrations): 002 executor with domain-based memberships, backup, idempotent plan apply`

### Task S1.10 — S1 stage checkpoint

**Steps**
- [ ] Run full suite: `NODE_OPTIONS=--experimental-vm-modules npx jest --forceExit` — expect green
- [ ] Manual smoke: `ALEC_CONNECTORS_V2=1 node -e "import('./backend/auth/bootstrap.js').then(m=>m.runBootstrap())"` — verify log shows 002 applied, no exceptions
- [ ] Commit: `chore(s1): data model + migration + service layer checkpoint`

---

## Stage S2 — API routes, middleware, audit writes

**Exit:** `/api/orgs`, `/api/connectors`, `/api/mcp` routes work with auth + ACL; every mutating call writes audit; integration tests green.

### Task S2.1 — `requireConnectorWrite` middleware

**Files**
- Create: `backend/middleware/requireConnectorWrite.js`
- Test: `tests/integration/connectors.test.js` (start file)

**Steps**
- [ ] Create middleware:
  ```js
  import { canWrite } from '../services/connectorService.js';
  export function requireConnectorWrite(getDb){
    return (req, res, next) => {
      const db = getDb();
      const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(req.params.id);
      if (!inst) return res.status(404).json({ error:'NOT_FOUND' });
      if (!canWrite(db, req.user.email, inst)) return res.status(403).json({ error:'FORBIDDEN' });
      req.connectorInstance = inst;
      next();
    };
  }
  ```
- [ ] Write test that mounts a minimal Express app, inserts a user-scope instance for `alice`, calls `PATCH /:id` as `bob` -> expects 403. As `alice` -> 200.
- [ ] Run — expect green
- [ ] Commit: `feat(middleware): requireConnectorWrite centralizes ACL`

### Task S2.2 — `requireOrgRole` middleware

**Files**
- Create: `backend/middleware/requireOrgRole.js`

**Steps**
- [ ] Create:
  ```js
  export function requireOrgRole(getDb, roles){
    return (req, res, next) => {
      const db = getDb();
      const m = db.prepare('SELECT role FROM org_memberships WHERE user_id=? AND org_id=?').get(req.user.email, req.params.id);
      if (!m || !roles.includes(m.role)) return res.status(403).json({ error:'FORBIDDEN' });
      next();
    };
  }
  ```
- [ ] Unit test: role=`admin` with roles=`['owner']` -> 403; role=`owner` with same -> next called.
- [ ] Commit: `feat(middleware): requireOrgRole(roles)`

### Task S2.3 — `/api/orgs` routes

**Files**
- Create: `backend/routes/orgs.js`
- Test: `tests/integration/orgs.test.js`

**Steps**
- [ ] Write integration test using supertest: seed 3 orgs + memberships (arovner=owner of stoagroup+abodingo+campusrentals, bob=member of abodingo); assert:
  - `GET /api/orgs` as bob -> one org (`abodingo`)
  - `GET /api/orgs` as arovner -> three orgs
  - `GET /api/orgs/abodingo/members` as bob -> 403 (member, not admin)
  - `GET /api/orgs/abodingo/members` as arovner -> list
  - `POST /api/orgs/abodingo/members` as arovner body `{userId:'c@abodingo.com', role:'member'}` -> 201; now visible
  - `PATCH /api/orgs/abodingo/members/c@abodingo.com` as arovner body `{role:'admin'}` -> 200
  - `DELETE /api/orgs/abodingo/members/c@abodingo.com` -> 204
- [ ] Run — expect fail
- [ ] Create routes:
  ```js
  import { Router } from 'express';
  import { z } from 'zod';
  import { requireOrgRole } from '../middleware/requireOrgRole.js';
  export function orgsRouter(getDb){
    const r = Router();
    r.get('/', (req,res)=>{
      const db = getDb();
      const rows = db.prepare(`SELECT o.* FROM organizations o JOIN org_memberships m ON m.org_id=o.id WHERE m.user_id=?`).all(req.user.email);
      res.json(rows);
    });
    r.get('/:id/members', requireOrgRole(getDb, ['owner','admin']), (req,res)=>{
      const db = getDb();
      res.json(db.prepare('SELECT user_id, role, created_at FROM org_memberships WHERE org_id=?').all(req.params.id));
    });
    const AddBody = z.object({ userId: z.string().email(), role: z.enum(['member','admin','owner']) });
    r.post('/:id/members', requireOrgRole(getDb, ['owner']), (req,res)=>{
      const parsed = AddBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({error:'INVALID', issues:parsed.error.issues});
      const db = getDb();
      db.prepare('INSERT OR REPLACE INTO org_memberships(user_id,org_id,role) VALUES (?,?,?)').run(parsed.data.userId, req.params.id, parsed.data.role);
      db.prepare(`INSERT INTO audit_log(user_id,org_id,action,target_type,target_id,metadata_json) VALUES (?,?,?,?,?,?)`)
        .run(req.user.email, req.params.id, 'org.member.add', 'user', parsed.data.userId, JSON.stringify({role:parsed.data.role}));
      res.status(201).json(parsed.data);
    });
    const PatchBody = z.object({ role: z.enum(['member','admin','owner']) });
    r.patch('/:id/members/:userId', requireOrgRole(getDb, ['owner']), (req,res)=>{
      const parsed = PatchBody.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({error:'INVALID'});
      const db = getDb();
      const result = db.prepare('UPDATE org_memberships SET role=? WHERE org_id=? AND user_id=?').run(parsed.data.role, req.params.id, req.params.userId);
      if (result.changes===0) return res.status(404).json({error:'NOT_FOUND'});
      res.json({ userId:req.params.userId, role:parsed.data.role });
    });
    r.delete('/:id/members/:userId', requireOrgRole(getDb, ['owner']), (req,res)=>{
      const db = getDb();
      db.prepare('DELETE FROM org_memberships WHERE org_id=? AND user_id=?').run(req.params.id, req.params.userId);
      res.status(204).end();
    });
    return r;
  }
  ```
- [ ] Mount in `backend/server.js`: `if (process.env.ALEC_CONNECTORS_V2==='1') app.use('/api/orgs', authenticateToken, orgsRouter(()=>db));`
- [ ] Run test — expect green
- [ ] Commit: `feat(api): /api/orgs CRUD for orgs and memberships`

### Task S2.4 — `/api/connectors/catalog` and `GET /api/connectors`

**Files**
- Create: `backend/routes/connectors.js`
- Extend: `tests/integration/connectors.test.js`

**Steps**
- [ ] Write tests:
  - `GET /api/connectors/catalog` -> 200, contains github entry
  - `GET /api/connectors` as alice -> only her instances (no bob's)
  - `GET /api/connectors?orgId=stoagroup` as arovner -> instances scoped to stoagroup only
- [ ] Create `backend/routes/connectors.js`:
  ```js
  import { Router } from 'express';
  import * as svc from '../services/connectorService.js';
  import { CATALOG } from '../connectors/catalog.js';
  export function connectorsRouter(getDb){
    const r = Router();
    r.get('/catalog', (req,res)=> res.json(CATALOG));
    r.get('/', (req,res)=>{
      const db = getDb();
      let rows = svc.listVisible(db, req.user.email);
      if (req.query.orgId) rows = rows.filter(r=>r.scope_type==='org' && r.scope_id===req.query.orgId);
      if (req.query.scope === 'user') rows = rows.filter(r=>r.scope_type==='user');
      res.json(rows.map(r => svc.get(db, r.id, req.user.email)));
    });
    return r;
  }
  ```
- [ ] Mount `app.use('/api/connectors', authenticateToken, connectorsRouter(()=>db))`
- [ ] Run — expect green
- [ ] Commit: `feat(api): GET /api/connectors[/catalog] with scope filter`

### Task S2.5 — `POST /api/connectors` (create)

**Files**
- Extend: `backend/routes/connectors.js`
- Extend: `tests/integration/connectors.test.js`

**Steps**
- [ ] Test: alice POSTs `{definitionId:'github', scope:'user', scopeId:'alice@...', fields:{GITHUB_TOKEN:'x'}}` -> 201; secret redacted in response. ORG_ONLY test: alice POSTs `{definitionId:'tenantcloud', scope:'user', ...}` -> 400 `ORG_ONLY`. Org-scope without admin: bob (member) POSTs `{scope:'org', scopeId:'abodingo'}` -> 403.
- [ ] Extend routes:
  ```js
  import { z } from 'zod';
  const CreateBody = z.object({
    definitionId: z.string(),
    scope: z.enum(['user','org']),
    scopeId: z.string(),
    fields: z.record(z.string()),
    displayName: z.string().optional()
  });
  r.post('/', (req,res)=>{
    const p = CreateBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({error:'INVALID', issues:p.error.issues});
    const db = getDb();
    // scope authorization
    if (p.data.scope==='user' && p.data.scopeId !== req.user.email) return res.status(403).json({error:'FORBIDDEN'});
    if (p.data.scope==='org') {
      const m = db.prepare('SELECT role FROM org_memberships WHERE user_id=? AND org_id=?').get(req.user.email, p.data.scopeId);
      if (!m || !['admin','owner'].includes(m.role)) return res.status(403).json({error:'FORBIDDEN'});
    }
    try {
      const inst = svc.create(db, { ...p.data, createdBy: req.user.email });
      res.status(201).json(inst);
    } catch (e) {
      if (e.message === 'ORG_ONLY') return res.status(400).json({error:'ORG_ONLY'});
      throw e;
    }
  });
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(api): POST /api/connectors with zod validation and scope ACL`

### Task S2.6 — `GET /api/connectors/:id`, `PATCH`, `DELETE`

**Files**
- Extend: `backend/routes/connectors.js`
- Extend tests

**Steps**
- [ ] Tests: read redacted fields; patch updates + new values reflected; delete returns 204 + subsequent GET returns 404.
- [ ] Add:
  ```js
  import { requireConnectorWrite } from '../middleware/requireConnectorWrite.js';
  r.get('/:id', (req,res)=>{
    const db = getDb();
    const inst = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(req.params.id);
    if (!inst) return res.status(404).json({error:'NOT_FOUND'});
    // visibility
    const mems = db.prepare('SELECT org_id FROM org_memberships WHERE user_id=?').all(req.user.email).map(m=>m.org_id);
    const visible = (inst.scope_type==='user' && inst.scope_id===req.user.email) || (inst.scope_type==='org' && mems.includes(inst.scope_id));
    if (!visible) return res.status(403).json({error:'FORBIDDEN'});
    res.json(svc.get(db, req.params.id, req.user.email));
  });
  const PatchBody = z.object({ fields: z.record(z.string()).optional(), displayName: z.string().optional(), enabled: z.boolean().optional() });
  r.patch('/:id', requireConnectorWrite(getDb), (req,res)=>{
    const p = PatchBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({error:'INVALID'});
    res.json(svc.update(getDb(), req.params.id, req.user.email, p.data));
  });
  r.delete('/:id', requireConnectorWrite(getDb), (req,res)=>{
    svc.remove(getDb(), req.params.id, req.user.email);
    res.status(204).end();
  });
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(api): GET/PATCH/DELETE /api/connectors/:id`

### Task S2.7 — `POST /api/connectors/:id/test` and `/reveal` (audit + rate limit)

**Files**
- Extend: `backend/routes/connectors.js`
- Extend tests

**Steps**
- [ ] Tests:
  - `/test` — calls probe, row gets `status='connected'` on success
  - `/reveal` — returns plaintext; audit row with `action='connector.reveal'` written *before* response; 11th call within hour -> 429
- [ ] Add:
  ```js
  const revealHits = new Map(); // userId -> [timestamps]
  r.post('/:id/test', requireConnectorWrite(getDb), async (req,res)=>{
    const result = await svc.testInstance(getDb(), req.params.id, req.user.email);
    res.json(result);
  });
  r.post('/:id/reveal', requireConnectorWrite(getDb), (req,res)=>{
    const now = Date.now();
    const arr = (revealHits.get(req.user.email) || []).filter(t => now - t < 3600_000);
    if (arr.length >= 10) return res.status(429).json({error:'RATE_LIMITED'});
    arr.push(now); revealHits.set(req.user.email, arr);
    const db = getDb();
    svc.writeAudit(db, { userId:req.user.email, orgId: req.connectorInstance.scope_type==='org'?req.connectorInstance.scope_id:null,
      action:'connector.reveal', targetType:'connector', targetId:req.params.id });
    res.json(svc.get(db, req.params.id, req.user.email, { reveal:true }));
  });
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(api): /test + /reveal with pre-response audit and 10/h rate limit`

### Task S2.8 — `/api/mcp` routes (skeleton, no runtime yet)

**Files**
- Create: `backend/routes/mcp.js`
- Create: `backend/services/mcpService.js`
- Test: `tests/integration/mcp.test.js`

**Steps**
- [ ] Create `backend/services/mcpService.js`: CRUD mirror of connectorService (`listVisible`, `create`, `get`, `update`, `remove`, `canWrite`) reading/writing `mcp_servers` with fields `{name, transport, command, args_json, url, env_ref_ids_json, enabled, auto_start, status, status_detail, tools_json}`. No process management yet. Audit via `writeAudit`.
- [ ] Create `backend/routes/mcp.js` mirroring connectors (`GET /catalog` stub returning `[]` for now, `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`). Start/Stop/Test return `501 NOT_IMPLEMENTED` in this stage.
- [ ] Write failing integration tests for CRUD only.
- [ ] Implement.
- [ ] Run — expect green
- [ ] Mount `app.use('/api/mcp', authenticateToken, mcpRouter(()=>db))`
- [ ] Commit: `feat(api): /api/mcp CRUD (runtime endpoints stubbed)`

### Task S2.9 — S2 stage checkpoint

- [ ] `NODE_OPTIONS=--experimental-vm-modules npx jest --forceExit` — green
- [ ] Manual smoke: boot server with `ALEC_CONNECTORS_V2=1`; curl `/api/connectors/catalog` with valid JWT -> returns catalog
- [ ] Commit: `chore(s2): API layer checkpoint`

---

## Stage S3 — Connectors UI (sidebar + list + drawer)

**Exit:** `/settings` renders, Connectors tab lets you create/edit/test/delete any existing connector type. Tenant switcher appears when memberships > 1.

### Task S3.1 — Frontend API clients

**Files**
- Create: `frontend/src/api/orgs.js`, `frontend/src/api/connectors.js`, `frontend/src/api/mcp.js`

**Steps**
- [ ] Create thin wrappers around `fetch` using existing `client.js` pattern:
  ```js
  // frontend/src/api/connectors.js
  import { api } from './client.js';
  export const getCatalog = () => api.get('/api/connectors/catalog');
  export const listConnectors = (params) => api.get('/api/connectors', { params });
  export const createConnector = (body) => api.post('/api/connectors', body);
  export const getConnector = (id) => api.get(`/api/connectors/${id}`);
  export const patchConnector = (id, body) => api.patch(`/api/connectors/${id}`, body);
  export const deleteConnector = (id) => api.delete(`/api/connectors/${id}`);
  export const testConnector = (id) => api.post(`/api/connectors/${id}/test`);
  export const revealConnector = (id) => api.post(`/api/connectors/${id}/reveal`);
  ```
  Create `orgs.js` and `mcp.js` analogously.
- [ ] Commit: `feat(frontend): api clients for orgs/connectors/mcp`

### Task S3.2 — `OrgContext` + tenant switcher

**Files**
- Create: `frontend/src/context/OrgContext.jsx`, `frontend/src/pages/Settings/TenantSwitcher.jsx`
- Modify: `frontend/src/App.jsx`

**Steps**
- [ ] Create `OrgContext.jsx`:
  ```jsx
  import { createContext, useContext, useEffect, useState } from 'react';
  import { useQuery } from '@tanstack/react-query';
  import * as orgsApi from '../api/orgs.js';
  const Ctx = createContext(null);
  export function OrgProvider({ children }) {
    const { data: orgs = [] } = useQuery({ queryKey:['orgs'], queryFn: orgsApi.listOrgs });
    const [currentId, setCurrentId] = useState(() => localStorage.getItem('alec.currentOrg') || null);
    useEffect(() => { if (!currentId && orgs.length) setCurrentId(orgs[0].id); }, [orgs, currentId]);
    useEffect(() => { if (currentId) localStorage.setItem('alec.currentOrg', currentId); }, [currentId]);
    const current = orgs.find(o => o.id === currentId) || null;
    return <Ctx.Provider value={{ orgs, current, setCurrentId }}>{children}</Ctx.Provider>;
  }
  export const useOrg = () => useContext(Ctx);
  ```
- [ ] Create `TenantSwitcher.jsx`:
  ```jsx
  import { useOrg } from '../../context/OrgContext.jsx';
  export default function TenantSwitcher() {
    const { orgs, current, setCurrentId } = useOrg();
    if (!orgs || orgs.length <= 1) return null;
    return (
      <select value={current?.id || ''} onChange={e=>setCurrentId(e.target.value)} className="rounded border px-2 py-1 text-sm">
        {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    );
  }
  ```
- [ ] Wrap app in `<OrgProvider>` in `App.jsx`; mount `<TenantSwitcher />` in the top bar area.
- [ ] Commit: `feat(frontend): OrgContext + TenantSwitcher dropdown`

### Task S3.3 — `useScopedConnectors` hook

**Files**
- Create: `frontend/src/hooks/useScopedConnectors.js`

**Steps**
- [ ] Create:
  ```js
  import { useQuery } from '@tanstack/react-query';
  import * as api from '../api/connectors.js';
  export function useScopedConnectors(scope, orgId) {
    return useQuery({
      queryKey: ['connectors', scope, orgId || null],
      queryFn: () => api.listConnectors(scope === 'org' ? { orgId } : { scope: 'user' }),
      staleTime: 30_000,
    });
  }
  export function useCatalog() {
    return useQuery({ queryKey:['catalog'], queryFn: api.getCatalog, staleTime: 5*60_000 });
  }
  ```
- [ ] Commit: `feat(frontend): useScopedConnectors + useCatalog hooks`

### Task S3.4 — `SettingsPage` frame + tab routing

**Files**
- Create: `frontend/src/pages/Settings/SettingsPage.jsx`
- Modify: `frontend/src/App.jsx`

**Steps**
- [ ] Create `SettingsPage.jsx`:
  ```jsx
  import { useState } from 'react';
  import ConnectorsTab from './ConnectorsTab.jsx';
  import MCPsTab from './MCPsTab.jsx';
  import OrgMembersTab from './OrgMembersTab.jsx';
  import DesktopTab from './DesktopTab.jsx';
  const TABS = [
    { id:'profile', label:'Profile' },
    { id:'security', label:'Security' },
    { id:'connectors', label:'Connectors' },
    { id:'mcps', label:'MCPs' },
    { id:'members', label:'Org Members' },
    { id:'desktop', label:'Desktop', desktopOnly:true },
  ];
  export default function SettingsPage() {
    const [tab, setTab] = useState('connectors');
    const isDesktop = !!window.electronAPI;
    return (
      <div className="flex h-full">
        <nav className="w-48 border-r bg-gray-50 p-4">
          {TABS.filter(t=>!t.desktopOnly || isDesktop).map(t => (
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`block w-full rounded px-3 py-2 text-left ${tab===t.id?'bg-blue-100 font-medium':''}`}>
              {t.label}
            </button>
          ))}
        </nav>
        <main className="flex-1 overflow-auto">
          {tab==='connectors' && <ConnectorsTab />}
          {tab==='mcps' && <MCPsTab />}
          {tab==='members' && <OrgMembersTab />}
          {tab==='desktop' && <DesktopTab />}
          {tab==='profile' && <div className="p-6">Profile (existing)</div>}
          {tab==='security' && <div className="p-6">Security (existing)</div>}
        </main>
      </div>
    );
  }
  ```
- [ ] Add route in `App.jsx`: `<Route path="/settings" element={<SettingsPage />} />`
- [ ] Commit: `feat(frontend): SettingsPage shell with tab routing`

### Task S3.5 — `ConnectorsTab` layout: sidebar + list + drawer

**Files**
- Create: `ConnectorsTab.jsx`, `ConnectorList.jsx`, `ConnectorDrawer.jsx`, `ConnectorFormField.jsx`

**Steps**
- [ ] `ConnectorsTab.jsx`:
  ```jsx
  import { useState } from 'react';
  import { useOrg } from '../../context/OrgContext.jsx';
  import { useCatalog, useScopedConnectors } from '../../hooks/useScopedConnectors.js';
  import ConnectorList from './ConnectorList.jsx';
  import ConnectorDrawer from './ConnectorDrawer.jsx';

  const CATEGORIES = [
    { id:'source-control', label:'Source Control' },
    { id:'productivity', label:'Productivity' },
    { id:'data', label:'Data' },
    { id:'comms', label:'Comms' },
    { id:'finance', label:'Finance' },
    { id:'smart-home', label:'Smart Home' },
  ];

  export default function ConnectorsTab() {
    const [scope, setScope] = useState('user');
    const [category, setCategory] = useState('source-control');
    const [selected, setSelected] = useState(null); // instance id or {new:true, definitionId}
    const { current } = useOrg();
    const { data: catalog = [] } = useCatalog();
    const { data: instances = [], isLoading } = useScopedConnectors(scope, current?.id);
    const filteredInstances = instances.filter(i => {
      const def = catalog.find(c => c.id === i.definition_id);
      return def?.category === category;
    });
    return (
      <div className="flex h-full">
        <aside className="w-56 border-r p-4">
          <div className="mb-4 flex rounded bg-gray-100 p-1 text-xs">
            <button onClick={()=>setScope('user')} className={`flex-1 rounded py-1 ${scope==='user'?'bg-white shadow':''}`}>Personal</button>
            <button onClick={()=>setScope('org')} className={`flex-1 rounded py-1 ${scope==='org'?'bg-white shadow':''}`}>Organization</button>
          </div>
          {CATEGORIES.map(c => (
            <button key={c.id} onClick={()=>setCategory(c.id)}
              className={`block w-full rounded px-2 py-1 text-left text-sm ${category===c.id?'bg-blue-50 font-medium':''}`}>
              {c.label}
            </button>
          ))}
        </aside>
        <section className="flex-1 p-4">
          <ConnectorList
            catalog={catalog.filter(c=>c.category===category)}
            instances={filteredInstances}
            loading={isLoading}
            onSelect={setSelected}
            scope={scope} orgId={current?.id}
          />
        </section>
        {selected && (
          <ConnectorDrawer selected={selected} scope={scope} orgId={current?.id} onClose={()=>setSelected(null)} />
        )}
      </div>
    );
  }
  ```
- [ ] `ConnectorList.jsx`:
  ```jsx
  export default function ConnectorList({ catalog, instances, loading, onSelect, scope, orgId }) {
    if (loading) return <div className="animate-pulse text-gray-400">Loading...</div>;
    return (
      <div className="space-y-4">
        {catalog.map(def => {
          const rows = instances.filter(i => i.definition_id === def.id);
          return (
            <div key={def.id} className="rounded border bg-white">
              <div className="flex items-center justify-between border-b px-4 py-2">
                <div>{def.icon} <span className="font-medium">{def.name}</span></div>
                <button onClick={()=>onSelect({ new:true, definitionId:def.id })} className="text-sm text-blue-600">+ Connect</button>
              </div>
              {rows.length === 0 && <div className="px-4 py-3 text-sm text-gray-400">No {def.name} connectors yet.</div>}
              {rows.map(r => (
                <button key={r.id} onClick={()=>onSelect(r.id)} className="flex w-full items-center justify-between px-4 py-2 text-left hover:bg-gray-50">
                  <span>{r.display_name || def.name}</span>
                  <span className={`text-xs ${r.status==='connected'?'text-green-600':r.status==='error'?'text-red-600':'text-gray-400'}`}>{r.status||'untested'}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    );
  }
  ```
- [ ] `ConnectorFormField.jsx`:
  ```jsx
  export default function ConnectorFormField({ field, value, onChange, readOnly }) {
    const common = { value: value || '', onChange: e=>onChange(e.target.value), readOnly, className:'mt-1 w-full rounded border px-2 py-1' };
    return (
      <label className="block text-sm">
        <span className="font-medium">{field.label}{field.required && <span className="text-red-500">*</span>}</span>
        {field.type === 'textarea' ? <textarea {...common} rows={4} />
          : field.type === 'password' ? <input type="password" {...common} />
          : <input type={field.type === 'url' ? 'url' : 'text'} {...common} />}
      </label>
    );
  }
  ```
- [ ] `ConnectorDrawer.jsx`:
  ```jsx
  import { useState, useEffect } from 'react';
  import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
  import * as api from '../../api/connectors.js';
  import ConnectorFormField from './ConnectorFormField.jsx';
  export default function ConnectorDrawer({ selected, scope, orgId, onClose }) {
    const qc = useQueryClient();
    const isNew = selected.new === true;
    const { data: existing } = useQuery({
      queryKey: ['connector', selected],
      queryFn: () => isNew ? null : api.getConnector(selected),
      enabled: !isNew,
    });
    const { data: catalog = [] } = useQuery({ queryKey:['catalog'], queryFn: api.getCatalog });
    const def = catalog.find(c => c.id === (isNew ? selected.definitionId : existing?.definition_id));
    const [fields, setFields] = useState({});
    const [displayName, setDisplayName] = useState('');
    useEffect(() => {
      if (existing) { setFields(existing.fields || {}); setDisplayName(existing.display_name || ''); }
    }, [existing]);
    const invalidate = () => qc.invalidateQueries({ queryKey:['connectors'] });
    const save = useMutation({
      mutationFn: () => isNew
        ? api.createConnector({ definitionId:def.id, scope, scopeId: scope==='org'?orgId:localStorage.getItem('alec.userEmail'), fields, displayName })
        : api.patchConnector(selected, { fields, displayName }),
      onSuccess: () => { invalidate(); onClose(); },
    });
    const test = useMutation({ mutationFn: () => api.testConnector(selected), onSuccess: invalidate });
    const reveal = useMutation({
      mutationFn: () => api.revealConnector(selected),
      onSuccess: r => setFields(r.fields),
    });
    const del = useMutation({ mutationFn: () => api.deleteConnector(selected), onSuccess: () => { invalidate(); onClose(); } });
    if (!def) return null;
    return (
      <aside className="fixed right-0 top-0 h-full w-96 overflow-auto border-l bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{def.icon} {def.name}</h3>
          <button onClick={onClose} aria-label="Close">x</button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="font-medium">Display name</span>
            <input value={displayName} onChange={e=>setDisplayName(e.target.value)} className="mt-1 w-full rounded border px-2 py-1" />
          </label>
          {def.fields.map(f => (
            <ConnectorFormField key={f.key} field={f} value={fields[f.key]} onChange={v=>setFields(x=>({ ...x, [f.key]: v }))} />
          ))}
        </div>
        <div className="mt-6 flex gap-2">
          <button onClick={()=>save.mutate()} disabled={save.isPending} className="rounded bg-blue-600 px-3 py-1 text-white">Save</button>
          {!isNew && <>
            <button onClick={()=>test.mutate()} className="rounded border px-3 py-1">Test</button>
            <button onClick={()=>reveal.mutate()} className="rounded border px-3 py-1">Reveal</button>
            <button onClick={()=>del.mutate()} className="rounded border border-red-300 px-3 py-1 text-red-600">Delete</button>
          </>}
        </div>
        {save.error && <div className="mt-3 text-sm text-red-600">{String(save.error.message)}</div>}
      </aside>
    );
  }
  ```
- [ ] Manual smoke: run app, open `/settings`, create a GitHub connector, refresh, edit, test, delete.
- [ ] Commit: `feat(frontend): Connectors tab with sidebar + list + drawer (CRUD/test/reveal)`

### Task S3.6 — S3 stage checkpoint

- [ ] Run entire test suite — green
- [ ] Manual E2E: exercise create/update/test/reveal/delete for at least github + homeassistant (org-scoped)
- [ ] Commit: `chore(s3): connectors UI checkpoint`

---

## Stage S4 — MCPs tab + runtime (spawn/stop, env_ref_ids)

**Exit:** Users can register stdio MCP servers, reference connector instances as env, start/stop processes, tool list cached.

### Task S4.1 — MCP runtime spawn/stop in `services/mcpSkills.js`

**Files**
- Modify: `services/mcpSkills.js`
- Create: `backend/services/mcpRuntime.js` (wraps existing MCP Manager)
- Test: `tests/unit/mcpService.test.js`

**Steps**
- [ ] Write failing test using a dummy stdio server (node script echoing MCP handshake) to assert `start(id)` spawns, handshake succeeds, `listTools()` returns `[]`, `stop(id)` kills and row status becomes `stopped`.
- [ ] Extract or wrap `mcpSkills.js` MCP Manager so `mcpRuntime.start(id)`:
  1. Loads row
  2. Builds env from `env_ref_ids_json` -> `getFields(refId)` merged; kills on kill_switch check (future)
  3. `child_process.spawn(command, args, { env: { ...process.env, ...merged } })`
  4. JSON-RPC handshake; on success store `tools_json`, set `status='running'`, `last_started=now`
  5. On failure: status='error', status_detail=err.message, no retry
- [ ] `stop(id)` — send SIGTERM, wait 5s, SIGKILL, update status
- [ ] `test(id)` — start (if not running), handshake, cache tools, stop if we started it
- [ ] Run test — expect green
- [ ] Commit: `feat(mcp): runtime spawn/stop/test with env injection from referenced connectors`

### Task S4.2 — Wire runtime into `/api/mcp/:id/{start,stop,test}`

**Files**
- Modify: `backend/routes/mcp.js`
- Extend: `tests/integration/mcp.test.js`

**Steps**
- [ ] Replace 501 stubs in start/stop/test with calls to `mcpRuntime`. Write integration tests using the same dummy stdio server.
- [ ] Assert audit rows `mcp.start`, `mcp.stop`, `mcp.test` written.
- [ ] Run — expect green
- [ ] Commit: `feat(api): /api/mcp/:id start/stop/test wire runtime`

### Task S4.3 — `MCPsTab` UI (mirrors Connectors pattern)

**Files**
- Create: `MCPsTab.jsx`, `MCPList.jsx`, `MCPDrawer.jsx`
- Create: `frontend/src/hooks/useScopedMCPs.js`

**Steps**
- [ ] `useScopedMCPs.js`: same shape as `useScopedConnectors` against `/api/mcp`.
- [ ] `MCPsTab.jsx`: sidebar sections `[Installed, Discover, Custom]`. `Installed` shows `status='running'|'stopped'`. `Custom` shows everything. `Discover` reads `/api/mcp/catalog` (empty for v1).
- [ ] `MCPList.jsx`: rows with name, transport label (stdio/sse/http), status, start/stop toggle button.
- [ ] `MCPDrawer.jsx`: form fields
  - `name` (text)
  - `transport` (select: stdio|sse|http)
  - `command` (visible if stdio)
  - `args` (comma-separated string, split to array on save)
  - `url` (visible if sse/http)
  - `envRefIds` — multi-select of current user's connector instances by display name
  - `autoStart` (checkbox), `enabled` (checkbox)
  - Actions: Save, Test (handshake), Start, Stop, Delete
  - Show `tools_json` array as a collapsible "Tools" list if present
- [ ] Manual smoke: register a simple filesystem MCP server (node with `@modelcontextprotocol/sdk`), start, verify tools appear, stop.
- [ ] Commit: `feat(frontend): MCPs tab with start/stop/test drawer`

### Task S4.4 — Desktop-control MCP row pre-seeded (stopped)

**Files**
- Modify: `backend/migrations/002_seed_migration.js`

**Steps**
- [ ] In the seed function, after catalog, insert:
  ```js
  db.prepare(`INSERT OR IGNORE INTO mcp_servers(id,name,scope_type,scope_id,transport,command,args_json,enabled,auto_start,status,created_by)
    VALUES ('desktop-control','Desktop Control','user','arovner@stoagroup.com','stdio','node',
            '["backend/mcp-servers/desktop-control/index.js"]',0,0,'stopped','system')`).run();
  ```
  This row will be activated in S7.
- [ ] Commit: `feat(migrations): seed desktop-control MCP row (stopped)`

### Task S4.5 — S4 stage checkpoint

- [ ] Full test suite green
- [ ] Commit: `chore(s4): MCPs tab + runtime checkpoint`

---

## Stage S5 — Org members UI, reveal flow polish, empty states, toasts

**Exit:** OrgMembersTab is admin/owner-viewable; reveal flow shows auth confirmation; skeletons + empty states + toast system.

### Task S5.1 — `OrgMembersTab` for owners

**Files**
- Create: `frontend/src/pages/Settings/OrgMembersTab.jsx`

**Steps**
- [ ] Component fetches `/api/orgs/:currentId/members` (uses `useOrg`). Table: email, role, created_at, actions. Owner can: add member (modal with email + role select), change role (inline select), remove (confirm modal). Hide actions if viewer is admin (not owner). Hide entire tab if user is plain member.
- [ ] Manual smoke: as arovner, add `b@abodingo.com` as admin to abodingo.
- [ ] Commit: `feat(frontend): org members management tab`

### Task S5.2 — Reveal-secret confirmation UX

**Files**
- Modify: `ConnectorDrawer.jsx`

**Steps**
- [ ] Wrap `reveal.mutate()` in a `confirm()` modal: "Reveal plaintext credentials? This is audit-logged." On success, start a 60-second countdown, then re-hide fields (reset to `••••••••`). Display a badge "Revealed (Ns remaining)".
- [ ] Commit: `feat(frontend): reveal flow with confirmation + 60s auto-rehide`

### Task S5.3 — "Move to org" action

**Files**
- Modify: `backend/routes/connectors.js` (new `POST /:id/move` endpoint)
- Modify: `ConnectorDrawer.jsx` (new action button)

**Steps**
- [ ] Endpoint body: `{ scope:'user'|'org', scopeId }`. Validates current user has write on source + target; updates `scope_type`+`scope_id`; audit `connector.move`.
- [ ] Test: alice moves her personal stoa to stoagroup org (as owner) -> visible to all org members.
- [ ] UI: drawer adds "Move to..." button opening a select of orgs where user is admin/owner.
- [ ] Commit: `feat(connectors): move-between-scopes endpoint and UI`

### Task S5.4 — Skeletons, empty states, toast notifications

**Files**
- Modify: `ConnectorList.jsx`, `MCPList.jsx`, `SettingsPage.jsx`
- Create: `frontend/src/components/ui/Toast.jsx` (if not present)

**Steps**
- [ ] Replace plain "Loading..." with 3 skeleton rows (animate-pulse gray blocks).
- [ ] Per-category empty state: `<EmptyState icon={def.icon} text={"No " + def.name + " connectors yet."} onAction={()=>openCreate(def.id)} />`.
- [ ] Toast provider in `SettingsPage` — surface mutation errors with collapsible "Show details" revealing `error.response?.data`.
- [ ] Commit: `feat(frontend): skeletons, empty states, toast error surface`

### Task S5.5 — S5 stage checkpoint

- [ ] Full test suite green
- [ ] Commit: `chore(s5): admin polish checkpoint`

---

## Stage S6 — Legacy JSON wipe + removal of old code paths

**Exit:** `skills-config.json` contains only `instances[uuid]`. Old `services/skillsRegistry.js` `get(uid,key,field)` signatures removed; all callers use `secretVault` + `connectorService`. Old `/api/skills` endpoints deleted.

### Task S6.1 — `scripts/migrate-verify.js`

**Files**
- Create: `scripts/migrate-verify.js`
- Modify: `package.json` (add `"migrate:verify": "node scripts/migrate-verify.js"`)

**Steps**
- [ ] Script: boot DB + load vault JSON. Assert:
  1. `users`/`global`/`_legacy`/`custom` top-level keys are absent OR have been mapped (every path has a matching `audit_log.action='migrate'` row)
  2. Every `connector_instances.id` has a matching `instances[id]` key in vault
  3. Every `instances[id]` vault key has a matching SQL row
  4. No source file still imports `skillsRegistry.get(` with the old 3-arg signature (grep heuristic)
  Print diagnostics; exit nonzero on any failure.
- [ ] Commit: `feat(scripts): migrate:verify preflight for S6`

### Task S6.2 — Refactor sweep: callers of old `skillsRegistry.get(uid,key,field)`

**Files**
- Modify: files surfaced by grepping for `skillsRegistry` across `.js` files (`dataConnectors/githubConnector.js`, `services/financeService.js`, `services/stoaQueryService.js`, `services/llamaEngine.js`, any others)

**Steps**
- [ ] For each file: identify which connector definition and scope they need. Replace with:
  ```js
  import { getFields } from '../backend/services/secretVault.js';
  import * as svc from '../backend/services/connectorService.js';
  // find a connector instance
  const inst = svc.listVisible(db, userId).find(i => i.definition_id === 'github');
  const { GITHUB_TOKEN } = inst ? getFields(inst.id) : {};
  ```
- [ ] Update each file, run affected unit/integration tests, commit per file: `refactor(<file>): switch to connectorService from legacy skillsRegistry`.
- [ ] Re-run `npm run migrate:verify` — expect clean.

### Task S6.3 — Migration 003: wipe legacy keys

**Files**
- Create: `backend/migrations/003_remove_legacy_skills_json.js`
- Test: `tests/unit/migration003.test.js`

**Steps**
- [ ] Test: vault contains `{ users:{}, global:{}, _legacy:{}, custom:{}, instances:{...} }`; run `up(db)`; assert only `{ instances }` remains; backup file created.
- [ ] Implement:
  ```js
  import fs from 'node:fs';
  export async function up(db){
    if (process.env.ALEC_ALLOW_LEGACY_WIPE !== '1') {
      console.warn('[migration003] skipped (set ALEC_ALLOW_LEGACY_WIPE=1 to run)');
      return;
    }
    const p = process.env.ALEC_VAULT_PATH || 'data/skills-config.json';
    if (!fs.existsSync(p)) return;
    const bak = `${p}.pre-wipe-${Date.now()}.bak`;
    fs.copyFileSync(p, bak);
    const o = JSON.parse(fs.readFileSync(p,'utf8'));
    const kept = { instances: o.instances || {} };
    fs.writeFileSync(p, JSON.stringify(kept, null, 2));
    db.prepare(`INSERT INTO audit_log(user_id,action,target_type,target_id,metadata_json) VALUES (?,?,?,?,?)`)
      .run('system','vault.wipe','vault','-', JSON.stringify({ backup: bak }));
  }
  ```
- [ ] Run — expect green
- [ ] Commit: `feat(migrations): 003 legacy vault wipe (opt-in via env)`

### Task S6.4 — Remove old `/api/skills` routes

**Files**
- Modify: `backend/server.js`, any `backend/routes/skills.js`

**Steps**
- [ ] Delete `/api/skills` mount + route file. Update `frontend/src/pages/Settings.jsx` to redirect to `/settings`. Run integration suite — any callers now fail and get caught.
- [ ] Commit: `refactor(api): remove legacy /api/skills routes`

### Task S6.5 — `scripts/connector-vault-doctor.js`

**Files**
- Create: `scripts/connector-vault-doctor.js`

**Steps**
- [ ] Walks SQL rows + vault; prints orphans and exits nonzero if any. Usable post-S6.
- [ ] Commit: `feat(scripts): connector-vault-doctor orphan detector`

### Task S6.6 — S6 stage checkpoint

- [ ] `npm run migrate:verify` — clean
- [ ] Full test suite — green
- [ ] Commit: `chore(s6): legacy wipe + refactor checkpoint`

---

## Stage S7 — Desktop Control (skill + MCP hybrid)

**Exit:** Settings > Desktop tab (desktop build only); macOS permission probes; policy gate; `desktopControl.execute()` singleton; MCP server exposing same primitives via stdio; audit rows with `desktop.*` prefix.

### Task S7.1 — Desktop tables already in migration 002 — verify seed rows

- [ ] Assert (unit test) desktop_policy has `(key='default', mode='session', kill_switch=0)` after migration; desktop_permissions has 3 rows with `granted=0`.
- [ ] Commit: `test(s7): verify desktop seed rows`

### Task S7.2 — `desktopPermissions` (native probes)

**Files**
- Create: `backend/services/desktopPermissions.js`
- Test: `tests/unit/desktopPermissions.test.js`

**Steps**
- [ ] Probes invoke shell via `execFileSync` (never pass user input through a shell):
  - `accessibility`: `execFileSync('osascript', ['-e', 'tell application "System Events" to return UI elements enabled'])` — exit 0 + "true" -> granted
  - `screen_recording`: `execFileSync('screencapture', ['-x', '-t', 'png', '/tmp/probe.png'])` — exit 0 -> granted
  - `automation`: `execFileSync('osascript', ['-e', 'tell application "Finder" to return name'])` — exit 0 -> granted
- [ ] Implement with `execFileSync`; catch any error -> granted=0. Cache result in `desktop_permissions` with `last_checked=now`, `last_probed_version=os.release()`.
- [ ] Test with probes mocked via `jest.unstable_mockModule` for `child_process`; assert row updated.
- [ ] Commit: `feat(desktop): permission probes persisted to SQL`

### Task S7.3 — `desktopPolicy` (session + kill-switch + evaluate)

**Files**
- Create: `backend/services/desktopPolicy.js`
- Test: `tests/unit/desktopPolicy.test.js`

**Steps**
- [ ] API:
  - `getPolicy(db)` -> row
  - `setPolicy(db, userId, { mode?, kill_switch? })` -> updates `updated_at/updated_by`; audit `desktop.policy.update`
  - `startSession(db, userId)` -> generates token, `session_expires_at = now + 1h`
  - `endSession(db, userId)` -> null session
  - `evaluate(db, primitive, args)` -> `'allow' | 'deny' | 'ask'` based on:
    - `kill_switch=1` -> `'deny'`
    - primitive === `'applescript.run'` -> `'ask'` always
    - denylist-window check for `keyboard.type` -> `'deny'` if frontmost matches regex set
    - mode `'always_ask'` -> `'ask'` for writes, `'allow'` for reads
    - mode `'session'` -> `'allow'` if session active AND primitive is not destructive; destructive (delete/overwrite hints via arg flag) -> `'ask'`
    - mode `'auto_reads'` -> reads `'allow'`, writes `'ask'`
- [ ] Tests cover every matrix cell.
- [ ] Commit: `feat(desktop): policy evaluator with kill-switch, denylist, session/mode logic`

### Task S7.4 — `desktopControl` singleton skill

**Files**
- Create: `backend/services/desktopControl.js`

**Steps**
- [ ] Install deps: `npm i @nut-tree-fork/nut-js@^4.2.0`
- [ ] Implement `execute(primitive, args, { userId, via })`:
  1. Load policy, `evaluate(db, primitive, args)`
  2. Write audit row *before* execution (`desktop.<primitive>`, metadata={args, via, decision})
  3. If `deny` -> return `{error:'disabled'}`
  4. If `ask` -> broadcast IPC prompt via Electron; wait up to 15s; default deny
  5. Dispatch to primitive impl:
     - `screen.capture` -> `execFile('screencapture', ['-x','-t','png',tmp])` -> read bytes -> base64
     - `screen.read_text` -> OCR stub returning `{ text: '' }` in v1; Vision.framework integration tracked in a follow-on spec
     - `mouse.click/move` -> `@nut-tree-fork/nut-js`
     - `keyboard.type/press` -> nut-js; pre-check frontmost window against `DENYLIST = /Keychain|1Password|Bitwarden|Vault|System Settings.*Passwords/i`
     - `applescript.run` -> `execFile('osascript', ['-e', src])`
     - `window.list` -> `osascript` + AppleScript that enumerates windows; parse output
     - `window.focus` -> AppleScript `tell application "<title>" to activate`
- [ ] Commit: `feat(desktop): singleton execute() with gate + 9 primitives`

### Task S7.5 — `/api/desktop/*` routes

**Files**
- Create: `backend/routes/desktop.js`
- Test: `tests/integration/desktop-routes.test.js`

**Steps**
- [ ] Implement the 7 routes per spec (lines 424-434). `POST /actions/:primitive` rejects when `req.ip !== '127.0.0.1'` and `req.ip !== '::1'` and header `X-ALEC-Internal-Token` does not match `process.env.ALEC_INTERNAL_TOKEN`. All routes reject non-loopback.
- [ ] Tests mock primitives; assert status endpoint returns `{permissions, policy, kill_switch, active_session}`, audit endpoint filters `action LIKE 'desktop.%'`.
- [ ] Mount `app.use('/api/desktop', authenticateToken, desktopRouter(()=>db))` in `server.js`.
- [ ] Commit: `feat(api): /api/desktop/* routes (loopback-locked)`

### Task S7.6 — Electron IPC bridge + approval modal

**Files**
- Modify: `desktop-app/src/main.js`, `desktop-app/src/preload.js`

**Steps**
- [ ] `main.js`: register IPC handler `desktop:probe` that shells out to the three probes (via `execFile`) and POSTs results to `/api/desktop/permissions/probe`. Register `desktop:approve-modal` that creates a `BrowserWindow` modal with Allow/Deny buttons + 15s timeout and returns decision.
- [ ] `preload.js`: expose `window.electronAPI.desktop = { probe, approve }`.
- [ ] Commit: `feat(electron): desktop permission probe + approval modal bridge`

### Task S7.7 — `DesktopTab` UI

**Files**
- Create: `frontend/src/pages/Settings/DesktopTab.jsx`, `frontend/src/hooks/useDesktopStatus.js`, `frontend/src/api/desktop.js`

**Steps**
- [ ] `useDesktopStatus`: React Query fetch `/api/desktop/status`.
- [ ] `DesktopTab`:
  - Permissions section: three rows (granted/not granted), Revoke (opens System Settings) / Request (triggers probe + System Settings deep link)
  - Action policy: radio group bound to `/api/desktop/policy` PATCH (`mode`)
  - Kill-switch toggle (danger red button) bound to `PATCH {kill_switch:!current}`
  - Session controls: Start 1-hour session / End session
  - Recent actions: paginated audit log last 50, via `/api/desktop/audit`
  - Tab is hidden if `!window.electronAPI`
- [ ] Commit: `feat(frontend): Settings > Desktop tab`

### Task S7.8 — `backend/mcp-servers/desktop-control/`

**Files**
- Create: `backend/mcp-servers/desktop-control/index.js`
- Create: `backend/mcp-servers/desktop-control/package.json`

**Steps**
- [ ] `package.json`: `{"name":"@alec/desktop-control-mcp","type":"module","main":"index.js","dependencies":{"@modelcontextprotocol/sdk":"^1"}}`
- [ ] `index.js`: stdio MCP server; for each of the 9 primitives register a tool; handler calls:
  ```js
  const res = await fetch('http://127.0.0.1:' + PORT + '/api/desktop/actions/' + name, {
    method:'POST', headers:{'X-ALEC-Internal-Token': process.env.ALEC_INTERNAL_TOKEN, 'Content-Type':'application/json'},
    body: JSON.stringify(args)
  });
  ```
  Passes through result. Sets `via='mcp'` header for audit tagging.
- [ ] Commit: `feat(mcp): desktop-control stdio server proxying the skill`

### Task S7.9 — End-to-end MCP test

**Files**
- Test: `tests/integration/desktop-mcp.test.js`

**Steps**
- [ ] Spawn `backend/mcp-servers/desktop-control/index.js` via `child_process.spawn`, send MCP handshake over stdio, call tool `window.list` (mock the underlying primitive to return `[{title:'test',pid:1}]`), assert result, assert audit row with `via:'mcp'`.
- [ ] Run — expect green
- [ ] Commit: `test(s7): end-to-end desktop-control via MCP stdio`

### Task S7.10 — S7 stage checkpoint

- [ ] Full test suite green
- [ ] Manual smoke on macOS: grant Accessibility + Screen Recording; flip kill-switch; attempt `keyboard.type` -> blocked; grant session; reattempt -> allowed + audit row.
- [ ] Commit: `chore(s7): desktop control checkpoint`

---

## Final rollout

- [ ] Flip `ALEC_CONNECTORS_V2=1` in production env
- [ ] Run `npm run migrate:verify` — clean
- [ ] Run migration 003 with `ALEC_ALLOW_LEGACY_WIPE=1`
- [ ] Tag release `v2.0.0-connectors`
- [ ] Write `docs/test-plans/connectors-mcp-e2e.md` (already created; keep as living checklist)

---

## Testing matrix

| Layer | File |
|---|---|
| Unit | `tests/unit/{secretVault,connectorService,mcpService,migration002,migration002Mapping,migration003,catalog,desktopPolicy,desktopPermissions,migrationRunner}.test.js` |
| Integration | `tests/integration/{orgs,connectors,mcp,desktop-routes,desktop-mcp}.test.js` |
| Migration | `tests/migration/002-snapshot.test.js` |
| E2E manual | `docs/test-plans/connectors-mcp-e2e.md` |

Run all: `NODE_OPTIONS=--experimental-vm-modules npx jest --forceExit`

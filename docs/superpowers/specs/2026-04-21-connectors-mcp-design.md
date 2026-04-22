# Connectors & MCPs — Multi-Tenant Settings Surface

**Date:** 2026-04-21
**Status:** Approved (brainstorming complete; ready for implementation plan)
**Owner:** arovner@stoagroup.com

## Summary

Add a Claude.ai-style **Settings** area to ALEC with two tabs:

1. **Connectors** — manage credentials for third-party services (GitHub, Microsoft 365, TenantCloud, Twilio, Stoa DB, HomeAssistant, etc.)
2. **MCPs** — register and run Model Context Protocol servers (stdio first; sse/http later)

Each tab supports **Personal** scope (per-user) and **Organization** scope (shared, admin-managed). Three tenants are supported (Stoa Group, Abodingo, Campus Rentals), inferred from email domain. Multi-org users (initially: `arovner@stoagroup.com`) get a tenant switcher in the top bar.

## Goals

- Replace ad-hoc credential management (`data/skills-config.json` keyed by `users[uid]` and `global`) with a proper multi-tenant model
- Give a single, polished settings UI that covers all existing connectors and is extensible to new ones
- Enable user-managed MCP servers without hand-editing `.mcp.json`
- Keep secrets in the existing AES-256-CBC envelope; only restructure their key naming

## Non-goals

- OAuth provider integration for new connectors (separate effort)
- Multi-org membership UX for non-owner users beyond the data model that supports it
- Performance optimization (single-digit-N concurrent users assumed)
- Visual snapshot testing
- Mobile-specific UX

## Architecture (Approach C — hybrid)

**SQL** (new tables in `data/alec.db`) holds structural data: orgs, memberships, connector catalog, connector instances, MCP servers, audit log.
**Encrypted JSON** (`data/skills-config.json`) continues to hold raw secret values, but keyed by UUID instead of `users[uid].<connector>.<field>`.
**Service layer** (`backend/services/connectorService.js`, new) brokers all reads/writes. The existing `services/skillsRegistry.js` is reduced to a pure secret-vault helper (write/read/delete by UUID).

### Why hybrid

- The encryption layer in `skillsRegistry.js` is production-tested and holds live credentials — no value in rewriting it.
- Multi-tenant scoping, ACL, audit, catalog management — these are relational concerns. SQLite gives transactions, indices, and clean queries for free.
- Migration is **additive**: new tables get populated from the JSON; the JSON is rewritten in place to use UUID keys; rollback restores from a backup file.

## Data model

Six new SQLite tables:

```sql
-- 1. Tenants
organizations (
  id            TEXT PRIMARY KEY,        -- 'stoagroup' | 'abodingo' | 'campusrentals'
  name          TEXT NOT NULL,
  email_domain  TEXT NOT NULL UNIQUE,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- 2. Membership. Empty → fall back to email-domain rule.
org_memberships (
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL REFERENCES organizations(id),
  role       TEXT NOT NULL,              -- 'owner' | 'admin' | 'member'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, org_id)
)

-- 3. Catalog of connector types
connector_definitions (
  id              TEXT PRIMARY KEY,      -- 'github', 'microsoft365', 'tenantcloud', ...
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,         -- 'source-control' | 'productivity' | 'data' | 'comms' | 'finance' | 'smart-home'
  icon            TEXT,                  -- emoji or slug
  auth_type       TEXT NOT NULL,         -- 'apikey' | 'oauth' | 'basic' | 'custom'
  fields_json     TEXT NOT NULL,         -- [{key, label, type, required, secret}]
  multi_instance  INTEGER NOT NULL DEFAULT 0,
  is_org_only     INTEGER NOT NULL DEFAULT 0
)

-- 4. Configured instances
connector_instances (
  id            TEXT PRIMARY KEY,        -- UUID; key into skills-config.json
  definition_id TEXT NOT NULL REFERENCES connector_definitions(id),
  scope_type    TEXT NOT NULL CHECK (scope_type IN ('user','org')),
  scope_id      TEXT NOT NULL,
  display_name  TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  status        TEXT,                    -- 'connected' | 'error' | 'untested'
  status_detail TEXT,                    -- last error message if any
  last_checked  DATETIME,
  created_by    TEXT NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- 5. MCP servers
mcp_servers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  scope_type      TEXT NOT NULL CHECK (scope_type IN ('user','org')),
  scope_id        TEXT NOT NULL,
  transport       TEXT NOT NULL,         -- 'stdio' | 'sse' | 'http'
  command         TEXT,                  -- stdio
  args_json       TEXT,                  -- JSON array
  url             TEXT,                  -- sse/http
  env_ref_ids_json TEXT,                 -- JSON array of connector_instance_ids; on MCP spawn, each referenced instance's decrypted field map is merged into the child process's env (later refs override earlier; explicit env on the row would override refs if/when added)
  enabled         INTEGER NOT NULL DEFAULT 1,
  auto_start      INTEGER NOT NULL DEFAULT 1,
  status          TEXT,                  -- 'running' | 'stopped' | 'error'
  status_detail   TEXT,
  tools_json      TEXT,                  -- cached tool list from last handshake
  last_started    DATETIME,
  created_by      TEXT NOT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- 6. Audit
audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL,
  org_id       TEXT,
  action       TEXT NOT NULL,            -- 'connector.create' | 'connector.delete' | 'connector.reveal' | 'mcp.start' | ...
  target_type  TEXT NOT NULL,
  target_id    TEXT NOT NULL,
  metadata_json TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

### Visibility / ACL

A user U sees a connector or MCP iff:
- `(scope_type='user' AND scope_id=U)` OR
- `(scope_type='org' AND scope_id IN U.memberships)`

Edit requires:
- Owns it personally, OR
- `admin`/`owner` role in the relevant org

`is_org_only=1` definitions reject `scope_type='user'` at the API.

### Secret storage (post-migration)

```json
{
  "instances": {
    "<connector_instance_id>": {
      "GITHUB_TOKEN": "iv:ciphertext"
    }
  }
}
```

The `users[uid]`, `global`, `_legacy`, `custom` keys disappear after stage S6 (migration 003).

## API surface

All routes require `authenticateToken`. Org-scoped writes additionally require admin/owner.

### `/api/orgs`
```
GET    /api/orgs                          → orgs visible to user
GET    /api/orgs/:id/members              → list members (admin+)
POST   /api/orgs/:id/members              → add member (owner only)
DELETE /api/orgs/:id/members/:userId      → remove (owner only)
PATCH  /api/orgs/:id/members/:userId      → change role (owner only)
```

### `/api/connectors`
```
GET    /api/connectors/catalog            → all connector_definitions
GET    /api/connectors                    → instances visible to user (?scope=&orgId=)
POST   /api/connectors                    → create {definitionId, scope, scopeId, fields, displayName?}
GET    /api/connectors/:id                → single instance, secrets redacted ("••••••••")
PATCH  /api/connectors/:id                → update fields/enable/displayName
POST   /api/connectors/:id/reveal         → plaintext secrets (admin/owner; rate-limited 10/h; audit-logged)
POST   /api/connectors/:id/test           → liveness probe; updates status + last_checked
DELETE /api/connectors/:id                → delete + wipe vault entry
```

### `/api/mcp`
```
GET    /api/mcp/catalog                   → known MCP servers (mcpSkills.js feed)
GET    /api/mcp                           → servers visible to user
POST   /api/mcp                           → register {name, transport, command/args/url, envRefIds, scope, scopeId}
PATCH  /api/mcp/:id                       → update / enable / autostart
POST   /api/mcp/:id/start                 → spawn now
POST   /api/mcp/:id/stop                  → kill now
POST   /api/mcp/:id/test                  → handshake + list tools (cache to tools_json)
DELETE /api/mcp/:id                       → stop + remove
```

### Cross-cutting

- **`requireConnectorWrite(instance)`** middleware — single source of truth for ACL.
- **GETs never return plaintext secrets** — all field values shown as `••••••••`. Plaintext only via explicit `POST /reveal`, audit-logged.
- **Audit wrapper** — `withAudit(action, fn)` in `connectorService.js` writes one `audit_log` row per mutating call.
- **Idempotent tests** — `POST /test` writes status only; safe to call repeatedly.

## UI shape

### Layout (decided in brainstorming)

- **Settings page** at `/settings` — tabbed (Profile / Security / **Connectors** / **MCPs** / Org Members)
- **Connectors tab body**: sidebar of categories (Source Control / Productivity / Data / Comms / Finance / Smart Home) + main list of instances in selected category. Click row → **right-side drawer** with edit form + Test/Save/Reveal/Delete actions.
- **MCPs tab body**: same pattern (sidebar = Installed / Discover / Custom; main list; right drawer).
- **Tenant switcher**: dropdown top-right (`🏢 Stoa Group ▾`). Visible only when `org_memberships` count > 1. Selection persisted to `localStorage`.
- **Personal/Org sub-toggle** within each tab body, above the list.

### Components (new, under `frontend/src/pages/Settings/`)

- `SettingsPage.jsx` — outer frame, tab routing
- `TenantSwitcher.jsx` — dropdown in top bar
- `ConnectorsTab.jsx`, `ConnectorList.jsx`, `ConnectorDrawer.jsx`, `ConnectorFormField.jsx`
- `MCPsTab.jsx`, `MCPList.jsx`, `MCPDrawer.jsx`
- `OrgMembersTab.jsx` (admin-only)
- `useScopedConnectors(orgId)`, `useScopedMCPs(orgId)` — React Query hooks

### State

- React Query for server cache; tenant context in React context (`OrgContext`)
- All mutations invalidate the relevant cache key on success

### Empty / loading / error states

- Skeleton rows during initial load
- Empty state per category: "No GitLab connectors yet. + Connect"
- Toast on error with technical detail in collapsible "Show details"

## Migration

One-shot, idempotent, on boot. Tracked in a `_migrations` table.

### `backend/migrations/002_connectors_multi_tenant.js`

1. Create the six new tables.
2. Seed `organizations`:
   - `('stoagroup', 'Stoa Group', 'stoagroup.com')`
   - `('abodingo', 'Abodingo', 'abodingo.com')`
   - `('campusrentals', 'Campus Rentals', 'campusrentalsllc.com')`
3. Seed `connector_definitions` from `backend/connectors/catalog.js` (single source of truth in code).
4. Seed `org_memberships`:
   - `arovner@stoagroup.com` → `owner` in all three orgs
   - All other existing users → `member` in the org matching their email domain
   - Users whose email domain matches **none** of the three orgs (e.g. contractors on `@gmail.com`) → no membership row inserted; they will be unable to see any org-scoped connectors until an admin adds them. They retain full access to their own personal connectors. The auth middleware logs a warning when this case occurs so admins notice.
5. Migrate `skills-config.json`:

   | Old path | New scope | Owner |
   |---|---|---|
   | `users[uid].<connector>.*` | `user` | `uid` |
   | `global.stoa.*` | `org` | `stoagroup` |
   | `global.homeassistant.*` | `org` | `campusrentals` |
   | `global.imessage.*` | `user` | `arovner@stoagroup.com` |
   | `global.aws.*` | `org` | `stoagroup` (best inference; movable in UI) |
   | `_legacy.stoa.*` | `org` | `stoagroup` |
   | `_legacy.tenantcloud.*` | `org` | `campusrentals` |
   | `_legacy.github.*` | `user` | `arovner@stoagroup.com` |
   | `_legacy.render.*` | `user` | `arovner@stoagroup.com` |
   | MS365 multi-instance arrays | preserve order | one row per element |

6. Backup old JSON to `skills-config.json.pre-migration-<timestamp>.bak`.
7. Append one `audit_log` row per migrated instance with `action='migrate'`.
8. Validate every SQL row has its corresponding UUID key in the new JSON; mismatch → abort + restore + nonzero exit.
9. Background job: run `connector.test` on every migrated instance; write `status` + `last_checked`.

### `backend/migrations/003_remove_legacy_skills_json.js`

Runs only after `npm run migrate:verify` reports clean and the user explicitly opts in. Wipes `users[uid]`, `global`, `_legacy`, `custom` keys from `skills-config.json`, leaving only `instances[uuid]`. Irreversible.

### Risks & mitigations

| Risk | Mitigation |
|---|---|
| Misinferred org scoping | Post-migration UI lets you move connectors between scopes in one click; audit log records moves |
| Live process holding file handle to `skills-config.json` | Migration acquires `data/.migration.lock`; if present at start, abort and log |
| MS365 multi-instance order changes | Preserve array order; `display_name = instance.name || "Instance N"` |
| `_legacy` orphan credentials | Attribute to `arovner@stoagroup.com` with audit note; log warning |
| Code paths using old `skillsRegistry.get(uid, key, field)` after S6 | Pre-S6 grep + refactor sweep; `npm run migrate:verify` checks for callers |

## Staged rollout

| Stage | What ships | Est. |
|---|---|---|
| **S1** | Data model + migration 002 (additive); seed orgs/memberships/catalog; `connectorService.js` DAO. No UI. Old code paths still work. | 3 days |
| **S2** | `/api/orgs`, `/api/connectors`, `/api/mcp` routes; `requireConnectorWrite` middleware; audit log writes. | 2 days |
| **S3** | `/settings` page; sidebar+list+drawer for Connectors; tenant switcher; works for all existing connectors. | 4 days |
| **S4** | MCPs tab; spawn/stop runtime via `mcpSkills.js`; stdio transport; `env_ref_ids` injection. | 3 days |
| **S5** | Org-member management UI; reveal-secret flow; "move to org" action; empty states + skeletons + toasts. | 2 days |
| **S6** | Migration 003 (legacy JSON wipe); refactor any remaining `skillsRegistry.get(...)` callers; remove old `/api/skills` routes. | 2 days |

**Total ≈ 16 working days, ~3 calendar weeks.** Each stage is hidden behind feature flag `ALEC_CONNECTORS_V2` so partial rollout is safe.

## Testing

| Layer | What | Where |
|---|---|---|
| Unit | `connectorService` ACL rules, every (scope, role) combo; secret encryption round-trip; migration mapping function | `tests/unit/connectorService.test.js`, `tests/unit/migration002.test.js` |
| Integration | Each route × auth gate × scope; reveal audit-log assertion; MCP spawn → handshake → list → stop | `tests/integration/connectors.test.js`, `tests/integration/mcp.test.js` |
| Migration | Snapshot test: production JSON in → expected rows + secret-vault state out; backup file present; idempotent | `tests/migration/002-snapshot.test.js` |
| E2E (manual) | Full happy path documented as a checklist | `docs/test-plans/connectors-mcp-e2e.md` |

### Error handling rules

- No bare `catch {}` blocks. All errors logged with `[connector:<action>:<id>]` prefix; surfaced to UI via toast with collapsible details.
- Zod validation on every POST/PATCH body; field-level 400s.
- Vault writes serialized through `data/.connector-write.lock`. Order: write JSON entry → write SQL row → on SQL failure, rollback JSON.
- `scripts/connector-vault-doctor.js` finds and reports orphans (SQL row with no JSON entry, or vice versa).
- MCP child-process failures: status='error', error stored on row, retry button. **No auto-respawn** — user-driven.
- Reveal endpoint: rate-limited 10/h/user; audit log row written *before* response so trail exists if response is intercepted.
- Migration failures (steps 5–7): restore JSON backup, drop new tables, exit nonzero, refuse boot until resolved.

## Open items deferred to implementation

- Exact field definitions per connector (will be authored in `backend/connectors/catalog.js` during S1; trivially editable post-launch)
- OAuth flow integration for connectors that support it (out of scope — handled in a follow-on spec)
- Connector icon assets (placeholder emojis acceptable for v1)

---

# Addendum — Desktop Control (Option 3: Hybrid skill + MCP)

ALEC needs first-class control of the local macOS desktop (click, type, read screen, run AppleScript). This is built-in, not a user-installable connector: it's always present on the desktop app, gated by explicit OS permissions and a per-action policy.

## Placement in Settings

New tab: **Settings › Desktop**. Lives next to Connectors, MCPs, Profile, Security. Only visible in the desktop Electron app (hidden in web build).

Layout mirrors the Connectors right-drawer pattern but simpler — it's one thing to configure, not a list.

```
Settings › Desktop
┌──────────────────────────────────────────────────────┐
│  macOS permissions                                   │
│  ┌────────────────────────────────────────────────┐  │
│  │ ● Accessibility           Granted    [Revoke]  │  │
│  │ ● Screen Recording        Granted    [Revoke]  │  │
│  │ ○ Automation (osascript)  Not granted [Request]│  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Action policy                                       │
│  ( ) Always ask before any action                    │
│  (•) Approve per session, ask for destructive        │
│  ( ) Auto-allow safe reads, ask for writes           │
│                                                      │
│  Kill-switch: [  Disable desktop control  ]          │
│  Recent actions: (scrollable audit log, last 50)     │
└──────────────────────────────────────────────────────┘
```

## Architecture

```
┌────────────────────────────────────────────────────────┐
│  ALEC agent / chat / external MCP client               │
└─────────────┬────────────────────────────┬─────────────┘
              │ internal call              │ MCP stdio
              ▼                            ▼
      ┌──────────────────┐         ┌──────────────────┐
      │ desktopControl   │ ◄─────  │ desktop-control  │
      │ skill (singleton)│         │ -mcp (local)     │
      └────────┬─────────┘         └──────────────────┘
               │ single permission + policy gate
               ▼
      ┌──────────────────────────────────────┐
      │ macOS bindings                       │
      │ - @nut-tree-fork/nut-js (mouse/kb)   │
      │ - screencapture CLI (screenshot)     │
      │ - osascript (AppleScript)            │
      │ - AXUIElement (read UI tree) — v2    │
      └──────────────────────────────────────┘
```

One source of truth (the skill). The MCP server is a thin proxy — every call goes through the same gate, so permissions and audit work identically whether the caller is ALEC's agent or an external MCP client.

## Primitives (v1)

| Name | Classification | What it does |
|---|---|---|
| `screen.capture({region?})` | read | Returns PNG bytes (base64). Uses `screencapture`. |
| `screen.read_text({region?})` | read | OCR via Vision.framework (or Tesseract fallback). |
| `mouse.click({x, y, button?})` | write | Synthesized click at coords. |
| `mouse.move({x, y})` | write | Cursor move. |
| `keyboard.type({text})` | write | Types string. Blocked if active window matches denylist (Keychain, 1Password, etc). |
| `keyboard.press({keys})` | write | Key combos. |
| `applescript.run({source})` | write | Executes via `osascript -e`. Always prompts regardless of policy. |
| `window.list()` | read | Enumerates visible app windows (title, bounds, pid). |
| `window.focus({pid\|title})` | write | Brings window to front. |

All writes route through `policy.check(primitive, args)` which returns `allow` / `deny` / `ask` → ask raises a native Electron modal with 15-second timeout → default deny.

## Data model additions

Append to migration 002 (no new migration needed):

```sql
CREATE TABLE IF NOT EXISTS desktop_permissions (
  id            TEXT PRIMARY KEY,              -- 'accessibility' | 'screen_recording' | 'automation'
  granted       INTEGER NOT NULL DEFAULT 0,    -- 0/1, cached probe result
  last_checked  TEXT,
  last_probed_version TEXT                     -- macOS version at last probe
);

CREATE TABLE IF NOT EXISTS desktop_policy (
  key          TEXT PRIMARY KEY,               -- singleton row 'default'
  mode         TEXT NOT NULL,                  -- 'always_ask' | 'session' | 'auto_reads'
  session_token TEXT,                          -- nulled on app quit
  session_expires_at TEXT,                     -- ISO
  kill_switch  INTEGER NOT NULL DEFAULT 0,     -- 1 = disabled globally
  updated_at   TEXT NOT NULL,
  updated_by   TEXT NOT NULL
);

-- audit re-uses existing audit_log table with action prefix 'desktop.'
```

Seed row:
```sql
INSERT OR IGNORE INTO desktop_policy(key, mode, kill_switch, updated_at, updated_by)
VALUES ('default', 'session', 0, datetime('now'), 'system');

INSERT OR IGNORE INTO desktop_permissions(id, granted) VALUES
  ('accessibility', 0), ('screen_recording', 0), ('automation', 0);
```

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET    | `/api/desktop/status`       | Returns `{permissions, policy, kill_switch, active_session}` |
| POST   | `/api/desktop/permissions/probe` | Re-runs native probe; updates cached flags |
| POST   | `/api/desktop/permissions/request/:id` | Triggers OS prompt (opens System Settings deep link) |
| PATCH  | `/api/desktop/policy`       | `{mode?, kill_switch?}` |
| POST   | `/api/desktop/session/start` | Opens 1-hour approve-session window |
| POST   | `/api/desktop/session/end`   | Revokes active session |
| POST   | `/api/desktop/actions/:primitive` | Internal — invoked by agent, NOT exposed to browser. Bearer-locked to localhost + app-internal token. |
| GET    | `/api/desktop/audit?limit=50` | Reads audit_log WHERE action LIKE 'desktop.%' |

All desktop routes require scope `'desktop'` on the JWT.

## MCP exposure

`backend/mcp-servers/desktop-control/` is a local MCP server bundled with the app:
- Transport: stdio
- Auto-started by `mcpSkills.js` when `desktop-control` row exists with status='running'
- Tools: same primitives as above, 1-to-1
- Every tool call proxies to `desktopControl.execute(primitive, args)` — same gate, same audit row (with `via:'mcp'` flag)

The MCP row is seeded in migration 002 but starts `status='stopped'`. User explicitly enables it in the MCPs tab. External MCP clients (e.g., another Claude instance) can then connect.

## Files added / modified (on top of main plan)

Create:
- `backend/services/desktopControl.js` — singleton skill, the permission+policy gate
- `backend/services/desktopPermissions.js` — native probes (wraps `sqlite` config + shell probes)
- `backend/services/desktopPolicy.js` — policy evaluator + session state
- `backend/routes/desktop.js` — the 7 routes above
- `backend/mcp-servers/desktop-control/index.js` — stdio MCP server
- `backend/mcp-servers/desktop-control/package.json`
- `frontend/src/pages/settings/DesktopTab.jsx`
- `frontend/src/hooks/useDesktopStatus.js`
- `tests/unit/desktopPolicy.test.js`
- `tests/integration/desktop-routes.test.js`

Modify:
- `backend/migrations/002_connectors_mcp.sql` — append the two tables + seed
- `backend/server.js` — mount `/api/desktop`
- `desktop-app/src/main.js` — add IPC bridge for native permission probes + Electron approval modal
- `frontend/src/pages/Settings.jsx` — add Desktop tab (desktop build only, feature-flagged on `window.electronAPI`)

Dependencies (pinned):
- `@nut-tree-fork/nut-js@^4.2.0` (MIT fork of nut-js; maintained)
- Native `screencapture` CLI (built into macOS, no dep)
- `osascript` CLI (built into macOS, no dep)

## Stage fit

Desktop Control adds **Stage S7 (3 days)** after S6:
- S7a: Migration append + `desktopControl` skill + policy gate + unit tests (1 day)
- S7b: `/api/desktop/*` routes + Electron IPC bridge for OS probes + Settings › Desktop UI (1.5 days)
- S7c: `desktop-control-mcp` server + end-to-end test via MCP client (0.5 day)

Revised total: **~19 working days, ~4 calendar weeks.**

## Safety rules (non-negotiable)

1. **Kill-switch is absolute.** When `kill_switch=1`, every primitive returns `{error:'disabled'}` before evaluation. No bypass for any caller.
2. **Denylist windows.** `keyboard.type` refuses when the frontmost window title matches a regex set (Keychain, 1Password, Bitwarden, Vault, System Settings › Passwords). Non-overridable.
3. **AppleScript is never auto-approved.** Even in `auto_reads` mode, `applescript.run` always prompts.
4. **Audit cannot be disabled.** Every invocation writes an audit row *before* execution. Failure to write → refuse execute.
5. **Screenshots are not persisted by default.** Returned to caller, not stored. User can opt in to 24-hour debug buffer.
6. **No remote control.** Desktop routes refuse any request where the remote address is not loopback.

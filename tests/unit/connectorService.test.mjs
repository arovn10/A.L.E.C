import fs from 'node:fs';
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pkg from '../../backend/auth/bootstrap.js';
import { up as seedUp } from '../../backend/migrations/002_seed_migration.mjs';
import {
  listVisible, create, get, update, remove, canWrite, testInstance,
} from '../../backend/services/connectorService.mjs';
const { runMigrations } = pkg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../backend/migrations');
const TMP_VAULT = '/tmp/connector-svc-vault.json';

async function freshDb() {
  try { fs.unlinkSync(TMP_VAULT); } catch {}
  process.env.ALEC_VAULT_PATH = TMP_VAULT;
  process.env.ALEC_VAULT_KEY = 'b'.repeat(64);
  const db = new Database(':memory:');
  await runMigrations(db, MIGRATIONS_DIR);
  await seedUp(db);
  return db;
}

describe('connectorService', () => {
  test('create + get redacts secrets, reveal shows plaintext', async () => {
    const db = await freshDb();
    const inst = create(db, {
      definitionId: 'github', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: { GITHUB_TOKEN: 'ghp_xyz' }, createdBy: 'arovner@stoagroup.com',
    });
    expect(inst.fields.GITHUB_TOKEN).toBe('••••••••');
    const revealed = get(db, inst.id, 'arovner@stoagroup.com', { reveal: true });
    expect(revealed.fields.GITHUB_TOKEN).toBe('ghp_xyz');
  });

  test('listVisible returns user + org-scoped instances visible to user', async () => {
    const db = await freshDb();
    create(db, { definitionId: 'github', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: { GITHUB_TOKEN: 't' }, createdBy: 'arovner@stoagroup.com' });
    create(db, { definitionId: 'stoa', scope: 'org', scopeId: 'stoagroup',
      fields: { STOA_DB_HOST: 'h', STOA_DB_USER: 'u', STOA_DB_PASSWORD: 'p', STOA_DB_NAME: 'n' },
      createdBy: 'arovner@stoagroup.com' });
    const rows = listVisible(db, 'arovner@stoagroup.com');
    expect(rows.length).toBe(2);
    // A user with no memberships sees nothing
    const outsider = listVisible(db, 'stranger@example.com');
    expect(outsider.length).toBe(0);
  });

  test('update changes vault + updated_at', async () => {
    const db = await freshDb();
    const inst = create(db, { definitionId: 'github', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: { GITHUB_TOKEN: 'old' }, createdBy: 'arovner@stoagroup.com' });
    update(db, inst.id, 'arovner@stoagroup.com', { fields: { GITHUB_TOKEN: 'new' }, displayName: 'Primary' });
    const revealed = get(db, inst.id, 'arovner@stoagroup.com', { reveal: true });
    expect(revealed.fields.GITHUB_TOKEN).toBe('new');
    expect(revealed.display_name).toBe('Primary');
  });

  test('remove deletes SQL row and vault entry', async () => {
    const db = await freshDb();
    const inst = create(db, { definitionId: 'github', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: { GITHUB_TOKEN: 't' }, createdBy: 'arovner@stoagroup.com' });
    remove(db, inst.id, 'arovner@stoagroup.com');
    expect(get(db, inst.id, 'arovner@stoagroup.com')).toBeNull();
    const vault = JSON.parse(fs.readFileSync(TMP_VAULT, 'utf8'));
    expect(vault.instances[inst.id]).toBeUndefined();
  });

  test('canWrite: owner of user-scoped, admin/owner of org-scoped', async () => {
    const db = await freshDb();
    const userInst = create(db, { definitionId: 'github', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: { GITHUB_TOKEN: 't' }, createdBy: 'arovner@stoagroup.com' });
    const userRow = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(userInst.id);
    expect(canWrite(db, 'arovner@stoagroup.com', userRow)).toBe(true);
    expect(canWrite(db, 'other@abodingo.com', userRow)).toBe(false);

    const orgInst = create(db, { definitionId: 'stoa', scope: 'org', scopeId: 'stoagroup',
      fields: { STOA_DB_HOST: 'h', STOA_DB_USER: 'u', STOA_DB_PASSWORD: 'p', STOA_DB_NAME: 'n' },
      createdBy: 'arovner@stoagroup.com' });
    const orgRow = db.prepare('SELECT * FROM connector_instances WHERE id=?').get(orgInst.id);
    expect(canWrite(db, 'arovner@stoagroup.com', orgRow)).toBe(true); // owner
    db.prepare('INSERT INTO org_memberships(user_id, org_id, role) VALUES (?,?,?)').run('mem@stoagroup.com', 'stoagroup', 'member');
    expect(canWrite(db, 'mem@stoagroup.com', orgRow)).toBe(false); // member only
  });

  test('testInstance() sets status and last_checked + writes audit', async () => {
    const db = await freshDb();
    // Stub definitions with no probe registered → returns ok:true by default.
    const inst = create(db, { definitionId: 'imessage', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: { IMESSAGE_DB_PATH: '/tmp/chat.db' }, createdBy: 'arovner@stoagroup.com' });
    const res = await testInstance(db, inst.id, 'arovner@stoagroup.com');
    expect(res.ok).toBe(true);
    const row = db.prepare('SELECT status, last_checked FROM connector_instances WHERE id=?').get(inst.id);
    expect(row.status).toBe('connected');
    expect(row.last_checked).not.toBeNull();
    const audit = db.prepare("SELECT action FROM audit_log WHERE target_id=? AND action='connector.test'").get(inst.id);
    expect(audit).toBeDefined();
  });

  test('is_org_only rejects user scope with ORG_ONLY error', async () => {
    const db = await freshDb();
    expect(() => create(db, {
      definitionId: 'stoa', scope: 'user', scopeId: 'arovner@stoagroup.com',
      fields: {}, createdBy: 'arovner@stoagroup.com',
    })).toThrow(/ORG_ONLY/);
  });
});

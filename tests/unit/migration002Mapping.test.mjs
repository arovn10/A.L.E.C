import { buildMigrationPlan } from '../../backend/migrations/002_mapping.mjs';

const INPUT = {
  users: {
    'alice@stoagroup.com': { github: { GITHUB_TOKEN: 'ghp_a' } },
  },
  global: {
    stoa:          { STOA_DB_HOST: 'h', STOA_DB_PASSWORD: 'p' },
    homeassistant: { HOMEASSISTANT_URL: 'u', HOMEASSISTANT_TOKEN: 't' },
    imessage:      { IMESSAGE_DB_PATH: '/p' },
    aws:           { AWS_ACCESS_KEY_ID: 'a', AWS_SECRET_ACCESS_KEY: 's', AWS_REGION: 'us-east-1' },
  },
  _legacy: {
    stoa:        { STOA_DB_HOST: 'x', STOA_DB_PASSWORD: 'y' },
    tenantcloud: { TENANTCLOUD_EMAIL: 'e', TENANTCLOUD_PASSWORD: 'p' },
    github:      { GITHUB_TOKEN: 'g' },
    render:      { RENDER_API_KEY: 'r' },
  },
};

function findAll(plan, match) {
  return plan.filter(p => Object.entries(match).every(([k, v]) => p[k] === v));
}

describe('buildMigrationPlan', () => {
  test('users[uid].<conn> → user-scoped row', () => {
    const plan = buildMigrationPlan(INPUT);
    const row = findAll(plan, { definitionId: 'github', scope: 'user', scopeId: 'alice@stoagroup.com' });
    expect(row).toHaveLength(1);
    expect(row[0].fields).toEqual({ GITHUB_TOKEN: 'ghp_a' });
    expect(row[0].reasonTag).toBe('user');
  });

  test('global.stoa → org stoagroup', () => {
    const plan = buildMigrationPlan(INPUT);
    expect(findAll(plan, { definitionId: 'stoa', scope: 'org', scopeId: 'stoagroup', reasonTag: 'global.stoa' })).toHaveLength(1);
  });

  test('global.homeassistant → org campusrentals', () => {
    const plan = buildMigrationPlan(INPUT);
    expect(findAll(plan, { definitionId: 'homeassistant', scope: 'org', scopeId: 'campusrentals' })).toHaveLength(1);
  });

  test('global.imessage → user arovner', () => {
    const plan = buildMigrationPlan(INPUT);
    expect(findAll(plan, { definitionId: 'imessage', scope: 'user', scopeId: 'arovner@stoagroup.com' })).toHaveLength(1);
  });

  test('global.aws → org stoagroup', () => {
    const plan = buildMigrationPlan(INPUT);
    expect(findAll(plan, { definitionId: 'aws', scope: 'org', scopeId: 'stoagroup' })).toHaveLength(1);
  });

  test('_legacy maps correctly', () => {
    const plan = buildMigrationPlan(INPUT);
    expect(findAll(plan, { definitionId: 'stoa', reasonTag: '_legacy.stoa' })).toHaveLength(1);
    expect(findAll(plan, { definitionId: 'tenantcloud', scope: 'org', scopeId: 'campusrentals' })).toHaveLength(1);
    expect(findAll(plan, { definitionId: 'github', scope: 'user', scopeId: 'arovner@stoagroup.com', reasonTag: '_legacy.github' })).toHaveLength(1);
    expect(findAll(plan, { definitionId: 'render', scope: 'user', scopeId: 'arovner@stoagroup.com' })).toHaveLength(1);
  });

  test('microsoft365 array → one row per instance', () => {
    const plan = buildMigrationPlan({
      users: { 'a@stoagroup.com': { microsoft365: [{ name: 'Work', MS365_TENANT_ID: 't1' }, { MS365_TENANT_ID: 't2' }] } },
    });
    const rows = findAll(plan, { definitionId: 'microsoft365', scope: 'user', scopeId: 'a@stoagroup.com' });
    expect(rows).toHaveLength(2);
    expect(rows[0].displayName).toBe('Work');
    expect(rows[1].displayName).toBe('Instance 2');
  });
});

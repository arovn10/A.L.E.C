#!/usr/bin/env node
/**
 * scripts/setup-azure-ad.js
 *
 * One-shot Azure AD app registration for ALEC Assistant.
 * Run ONCE after `az login` with a Global Admin account:
 *
 *   az login
 *   node scripts/setup-azure-ad.js
 *
 * What it does:
 *   1. Finds or creates an app registration called "ALEC Assistant"
 *   2. Adds Microsoft Graph permissions (Files, Sites, Mail, Calendar)
 *   3. Grants admin consent
 *   4. Creates a client secret (valid 2 years)
 *   5. Writes MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET to ../.env
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const APP_NAME  = 'ALEC Assistant';
const ENV_FILE  = path.join(__dirname, '../.env');
const SECRET_YEARS = '2';

// Microsoft Graph Application permission IDs
const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000';
const GRAPH_PERMISSIONS = [
  '75359482-378d-4052-8f01-80520e7db3cd', // Files.ReadWrite.All
  '9492366f-7969-46a4-8d15-ed1a20078fff', // Sites.ReadWrite.All
  'e2a3a72e-5f79-4c64-b1b1-878b674786c9', // Mail.ReadWrite
  'b633e1c5-b582-4048-a93e-9f11b44c7e96', // Mail.Send
  'ef54d2bf-783f-4e0f-bca1-3210c4d8a9ec', // Calendars.ReadWrite
];

function az(args, opts = {}) {
  try {
    const out = execFileSync('az', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return opts.json ? (out ? JSON.parse(out) : null) : out;
  } catch (err) {
    if (opts.optional) return null;
    const msg = err.stderr?.toString().trim() || err.message;
    console.error(`az ${args.join(' ')} failed:\n${msg}`);
    process.exit(1);
  }
}

function updateEnv(key, value) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, `${key}=${value}`)
    : content + `\n${key}=${value}`;
  fs.writeFileSync(ENV_FILE, content);
  console.log(`  ✓ ${key}`);
}

async function main() {
  console.log('\n🔷 A.L.E.C. Azure AD Setup\n');

  // 1. Verify login
  console.log('1. Verifying Azure login…');
  const account = az(['account', 'show'], { json: true });
  if (!account) { console.error('Not logged in. Run: az login'); process.exit(1); }
  const tenantId = account.tenantId;
  console.log(`   Tenant: ${account.name} (${tenantId})`);

  // 2. Find or create app
  console.log(`\n2. Looking for "${APP_NAME}" app registration…`);
  const existing = az(
    ['ad', 'app', 'list', '--display-name', APP_NAME, '--query', '[0]'],
    { json: true, optional: true }
  );

  let appId, objectId;
  if (existing?.appId) {
    appId = existing.appId; objectId = existing.id;
    console.log(`   Found existing app: ${appId}`);
  } else {
    console.log('   Creating new app…');
    const created = az(
      ['ad', 'app', 'create', '--display-name', APP_NAME, '--sign-in-audience', 'AzureADMyOrg'],
      { json: true }
    );
    appId = created.appId; objectId = created.id;
    console.log(`   Created: ${appId}`);
  }

  // 3. Add permissions
  console.log('\n3. Setting Graph API permissions…');
  for (const permId of GRAPH_PERMISSIONS) {
    az(
      ['ad', 'app', 'permission', 'add', '--id', appId, '--api', GRAPH_APP_ID, '--api-permissions', `${permId}=Role`],
      { optional: true }
    );
  }
  console.log('   Added: Files.ReadWrite.All, Sites.ReadWrite.All, Mail.ReadWrite, Mail.Send, Calendars.ReadWrite');

  // 4. Ensure service principal exists, grant admin consent
  console.log('\n4. Creating service principal and granting admin consent…');
  az(['ad', 'sp', 'create', '--id', appId], { optional: true });
  // Brief propagation wait
  execFileSync('sleep', ['5']);
  const consented = az(['ad', 'app', 'permission', 'admin-consent', '--id', appId], { optional: true });
  if (consented === null) {
    console.log('   ⚠ Admin consent command failed — you may need Global Admin role.');
    console.log(`   Run manually: az ad app permission admin-consent --id ${appId}`);
  } else {
    console.log('   Admin consent granted ✓');
  }

  // 5. Create client secret
  console.log('\n5. Creating client secret (2-year expiry)…');
  const secretResult = az(
    ['ad', 'app', 'credential', 'reset', '--id', appId, '--years', SECRET_YEARS, '--append'],
    { json: true }
  );
  if (!secretResult?.password) { console.error('Failed to create client secret'); process.exit(1); }

  // 6. Write to .env
  console.log('\n6. Writing to .env…');
  updateEnv('MS_TENANT_ID', tenantId);
  updateEnv('MS_CLIENT_ID', appId);
  updateEnv('MS_CLIENT_SECRET', secretResult.password);
  updateEnv('MS_USER_EMAIL', 'alec@abodingo.com');

  console.log('\n✅ Done! App:', APP_NAME);
  console.log('   Tenant ID :', tenantId);
  console.log('   Client ID :', appId);
  console.log('\nRestart ALEC backend, then verify:');
  console.log('  node -e "require(\'./services/microsoftGraphService.js\').status().then(console.log)"');
}

main().catch(err => { console.error(err.message); process.exit(1); });

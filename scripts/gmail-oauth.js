#!/usr/bin/env node
/**
 * scripts/gmail-oauth.js
 *
 * Interactive OAuth2 token generator for A.L.E.C. Gmail integration.
 * Run once per Gmail account to generate and store refresh tokens.
 *
 * Prerequisites:
 *   1. Go to console.cloud.google.com
 *   2. Select or create project "ALEC Assistant"
 *   3. Enable the Gmail API (APIs & Services → Enable APIs → Gmail API)
 *   4. Create OAuth 2.0 credentials:
 *        APIs & Services → Credentials → Create Credentials → OAuth Client ID
 *        Application type: Desktop app
 *        Name: ALEC Desktop
 *   5. Download credentials JSON and note the Client ID and Client Secret
 *   6. Set in .env: GMAIL_CLIENT_ID=... and GMAIL_CLIENT_SECRET=...
 *   7. Run: node scripts/gmail-oauth.js
 *
 * The script will print an auth URL → open it → grant access → paste the code.
 * Refresh tokens are written to .env automatically.
 */

const { google } = require('googleapis');
const readline   = require('readline');
const path       = require('path');
const fs         = require('fs');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const CLIENT_ID     = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const ENV_FILE      = path.join(__dirname, '../.env');
const REDIRECT_URI  = 'urn:ietf:wg:oauth:2.0:oob';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.labels',
];

const ACCOUNTS = [
  { key: 'alec',       email: 'rovneralec@gmail.com',       envKey: 'GMAIL_REFRESH_TOKEN_ALEC' },
  { key: 'properties', email: 'rovnerproperties@gmail.com', envKey: 'GMAIL_REFRESH_TOKEN_PROPERTIES' },
];

function question(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function updateEnv(key, value) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  content = regex.test(content)
    ? content.replace(regex, `${key}=${value}`)
    : content + `\n${key}=${value}`;
  fs.writeFileSync(ENV_FILE, content);
}

async function authorizeAccount(rl, account) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Account: ${account.email} (${account.key})`);
  console.log('═'.repeat(60));

  const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    login_hint: account.email,
  });

  console.log('\n1. Open this URL in your browser (sign in as ' + account.email + '):');
  console.log('\n   ' + authUrl + '\n');
  console.log('2. Grant access, then copy the authorization code shown.\n');

  const code = (await question(rl, '   Paste the code here: ')).trim();
  if (!code) {
    console.log('   ⚠ No code entered — skipping this account.');
    return false;
  }

  const { tokens } = await oAuth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.log('   ⚠ No refresh token returned. Make sure you granted access and try again.');
    console.log('   Tip: Revoke access at https://myaccount.google.com/permissions, then re-run.');
    return false;
  }

  updateEnv(account.envKey, tokens.refresh_token);
  console.log(`\n   ✓ Refresh token saved to .env (${account.envKey})`);

  // Quick verification
  oAuth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
  const profile = await gmail.users.getProfile({ userId: 'me' });
  console.log(`   ✓ Verified — connected as: ${profile.data.emailAddress}`);
  console.log(`   ✓ Total messages: ${profile.data.messagesTotal?.toLocaleString()}`);
  return true;
}

async function main() {
  console.log('\n📧 A.L.E.C. Gmail OAuth Setup\n');

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
    console.error('\nSetup steps:');
    console.error('  1. Go to https://console.cloud.google.com');
    console.error('  2. Enable Gmail API');
    console.error('  3. Create OAuth 2.0 Desktop credentials');
    console.error('  4. Add to .env: GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=...');
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const accountArg = process.argv[2]; // optional: 'alec' or 'properties'
  const toProcess = accountArg
    ? ACCOUNTS.filter(a => a.key === accountArg)
    : ACCOUNTS;

  if (!toProcess.length) {
    console.error(`Unknown account: ${accountArg}. Valid: alec, properties`);
    rl.close();
    process.exit(1);
  }

  let succeeded = 0;
  for (const account of toProcess) {
    try {
      const ok = await authorizeAccount(rl, account);
      if (ok) succeeded++;
    } catch (err) {
      console.error(`  ✗ Error for ${account.email}:`, err.message);
    }
  }

  rl.close();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`Done: ${succeeded}/${toProcess.length} account(s) configured.`);
  if (succeeded > 0) {
    console.log('\nVerify setup:');
    console.log('  node -e "require(\'./services/gmailService.js\').status().then(s => console.log(JSON.stringify(s,null,2)))"');
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });

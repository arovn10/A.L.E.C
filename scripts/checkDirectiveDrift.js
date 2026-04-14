// scripts/checkDirectiveDrift.js
// CI guard: exits 1 if ALEC_DIRECTIVE.md and ALEC_CONSTITUTION.md differ.
// Run with: node scripts/checkDirectiveDrift.js
'use strict';

const fs   = require('fs');
const path = require('path');

const directive    = fs.readFileSync(path.join(__dirname, '../data/ALEC_DIRECTIVE.md'), 'utf8');
const constitution = fs.readFileSync(path.join(__dirname, '../data/ALEC_CONSTITUTION.md'), 'utf8');

if (directive.trim() !== constitution.trim()) {
  console.error('[CI FAIL] ALEC_DIRECTIVE.md and ALEC_CONSTITUTION.md have drifted apart.');
  console.error('Update both files together and run this check again.');
  process.exit(1);
}

console.log('[CI PASS] Directive and Constitution are in sync.');

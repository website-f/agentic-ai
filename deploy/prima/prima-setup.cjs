// P65: Prima Secure's database setup, run by the one-shot `prima-setup` service before every
// start of `prima-api` (same image). Prima's own tools do the work, exactly as its runbook says
// (apps/prima/docs/RELEASE_MODULE_INSTALLATION.md):
//   1. db-setup (as the schema owner): the base schema (idempotent), the first clean-slate
//      settings on an empty database, and the runtime login prima_api.
//   2. module-install, for each module of the release manifest, with the exact release and
//      module hashes it prints itself. An installed module is a no-op; a drifted one is refused
//      (and so is this start: prima-api then stays down rather than run on a wrong schema).
'use strict';
const { execFileSync } = require('node:child_process');

const cwd = process.env.PRIMA_API_DIR || '/app/apps/api';
const run = (args) => execFileSync('node', args, { cwd, stdio: 'inherit', env: process.env });

run(['dist/src/db-setup.js']);
const plan = JSON.parse(execFileSync('node', ['dist/src/module-install.js'], { cwd, env: process.env }).toString());
for (const m of plan.manifest.modules) {
  console.log(`prima-setup: module ${m.id}`);
  run([
    'dist/src/module-install.js',
    '--module', m.id,
    '--release-sha', plan.releaseSha256,
    '--module-sha', m.sha256,
    '--confirm', 'INSTALL_SELECTED_MODULE',
  ]);
}
console.log('prima-setup: base and all modules in place');

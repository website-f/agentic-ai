#!/usr/bin/env node
// NOTE (round 8): refreshing only the base profile breaks the modules profile chain (see BASE_TRANSITION.md); not used.
// Refresh the BASE profile of ops/existing-admin to the same candidate base as ops/base-transition. PREPARATION ONLY:
// rewrites local files; never connects, migrates, pushes or deploys.
//   usage: node existing-admin-base-refresh.js <worktree>     (run base-transition-refresh.js first)
// The base profile carries byte-identical copies of ops/base-transition's live.sql, candidate.sql, readiness sources,
// compiled validators and readiness manifest (checked before and after). Only its own hash constants and manifests
// move: existing-admin-transition.cjs NEXT + readiness pin, existing-admin-cli.cjs NEXT + runner pin,
// base/artifact-manifest.json, and the base/* entries of operator-manifest.json. The modules and inspect profiles are
// left exactly as they are (see BASE_TRANSITION.md for why the modules profile needs its own reviewed redesign).
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const W = path.resolve(process.argv[2] || '');
const BT = path.join(W, 'ops/base-transition'), EA = path.join(W, 'ops/existing-admin');
const B = path.join(EA, 'base');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const json = (o) => JSON.stringify(o, null, 2) + '\n';
function swap(file, from, to) {
  if (from === to) return;
  const s = fs.readFileSync(file, 'utf8');
  if (!s.includes(from)) throw Error(`${path.relative(W, file)}: ${from.slice(0, 16)}… not found`);
  fs.writeFileSync(file, s.split(from).join(to));
}
if (sha(path.join(B, 'live.sql')) !== sha(path.join(BT, 'live.sql'))) throw Error('live.sql differs between the two packages');
const am = JSON.parse(fs.readFileSync(path.join(B, 'artifact-manifest.json')));
const oldNext = am.newSha, oldRunner = am.runnerSha, oldReadiness = sha(path.join(B, 'readiness-manifest.json'));
// Mirror the shared files from the refreshed base-transition package.
const shared = ['candidate.sql', 'readiness-manifest.json'];
for (const f of JSON.parse(fs.readFileSync(path.join(BT, 'readiness-manifest.json'))).files) shared.push(f.source, f.path);
for (const f of shared) fs.copyFileSync(path.join(BT, f), path.join(B, f));
const NEXT = sha(path.join(B, 'candidate.sql')), READINESS = sha(path.join(B, 'readiness-manifest.json'));
const runner = path.join(B, 'existing-admin-transition.cjs'), cli = path.join(B, 'existing-admin-cli.cjs');
swap(runner, oldNext, NEXT);
swap(runner, oldReadiness, READINESS);
const RUNNER = sha(runner);
swap(cli, oldNext, NEXT);
swap(cli, oldRunner, RUNNER);
am.newSha = NEXT; am.runnerSha = RUNNER;
for (const f of am.files) f.sha256 = sha(path.join(B, f.path));
fs.writeFileSync(path.join(B, 'artifact-manifest.json'), json(am));
const om = JSON.parse(fs.readFileSync(path.join(EA, 'operator-manifest.json')));
for (const f of om.files) f.sha256 = sha(path.join(EA, f.path));
fs.writeFileSync(path.join(EA, 'operator-manifest.json'), json(om));
const v = require(path.join(EA, 'verify.cjs'));
const out = typeof v.verify === 'function' ? v.verify(EA) : null;
console.log(JSON.stringify({ newSha: NEXT, runnerSha: RUNNER, readinessManifestSha: READINESS, operator: out }, null, 2));

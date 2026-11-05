#!/usr/bin/env node
// Refresh ops/base-transition for a combined candidate's base. PREPARATION ONLY: it rewrites local files in the given
// worktree and never connects to a database, migrates, pushes or deploys.
//   usage: node base-transition-refresh.js <worktree>
// What it does, all derived from the worktree's own files (nothing typed by hand):
//   candidate.sql            = db/migrations/001_init.sql (the combined base)
//   candidate-readiness/*.ts = apps/api/src/<same name>.ts (the combined validators)
//   candidate-readiness-js/  = those sources compiled with the repository's TypeScript (must be 5.8.3, the pinned compiler;
//                              flags reproduce the reviewed package byte for byte: --target ES2022 --module commonjs)
//   readiness-manifest.json, the runner's NEXT and readiness-manifest pin, cli.cjs NEXT/RUNNER, artifact-manifest.json,
//   README's base line. live.sql (the live base) and every check in the runner and CLI stay as reviewed.
'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const W = path.resolve(process.argv[2] || '');
const P = path.join(W, 'ops/base-transition');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (p) => fs.readFileSync(p);
const json = (o) => JSON.stringify(o, null, 2) + '\n';
function swap(file, from, to) {
  const s = fs.readFileSync(file, 'utf8');
  const n = s.split(from).length - 1;
  if (n < 1) throw Error(`${path.relative(W, file)}: ${from.slice(0, 16)}… not found`);
  fs.writeFileSync(file, s.split(from).join(to));
}
const tsc = path.join(W, 'node_modules/.bin/tsc');
const version = execFileSync(tsc, ['-v'], { encoding: 'utf8' }).trim();
const rm = JSON.parse(read(path.join(P, 'readiness-manifest.json')));
if (version !== `Version ${rm.compilerVersion}`) throw Error(`TypeScript ${rm.compilerVersion} required, found ${version}`);

const oldNext = require(path.join(P, 'base-transition.cjs')).NEXT;
const oldRunner = sha(read(path.join(P, 'base-transition.cjs')));
const oldReadinessPin = sha(read(path.join(P, 'readiness-manifest.json')));

// 1. Candidate base.
fs.copyFileSync(path.join(W, 'db/migrations/001_init.sql'), path.join(P, 'candidate.sql'));
const NEXT = sha(read(path.join(P, 'candidate.sql')));

// 2. Validators: the combined sources, compiled.
const out = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bt-'));
for (const f of rm.files) fs.copyFileSync(path.join(W, 'apps/api/src', path.basename(f.source)), path.join(P, f.source));
execFileSync(tsc, ['--target', 'ES2022', '--module', 'commonjs', '--outDir', out, '--types', 'node', '--typeRoots', path.join(W, 'node_modules/@types'), ...rm.files.map((f) => path.join(P, f.source))], { stdio: 'inherit' });
for (const f of rm.files) {
  fs.copyFileSync(path.join(out, path.basename(f.path)), path.join(P, f.path));
  f.sourceSha256 = sha(read(path.join(P, f.source)));
  f.sha256 = sha(read(path.join(P, f.path)));
}
fs.writeFileSync(path.join(P, 'readiness-manifest.json'), json(rm));
const readinessPin = sha(read(path.join(P, 'readiness-manifest.json')));

// 3. Runner pins (constants only), then the CLI pins.
const runner = path.join(P, 'base-transition.cjs');
if (oldNext !== NEXT) swap(runner, oldNext, NEXT);
if (oldReadinessPin !== readinessPin) swap(runner, oldReadinessPin, readinessPin);
const RUNNER = sha(read(runner));
const cli = path.join(P, 'cli.cjs');
if (oldNext !== NEXT) swap(cli, oldNext, NEXT);
if (oldRunner !== RUNNER) swap(cli, oldRunner, RUNNER);

// 4. README base line.
const readme = path.join(P, 'README.md');
if (oldNext !== NEXT) swap(readme, oldNext, NEXT);
if (oldRunner !== RUNNER) swap(readme, oldRunner, RUNNER);

// 5. Artifact manifest (same path list the CLI verifies).
const am = JSON.parse(read(path.join(P, 'artifact-manifest.json')));
am.newSha = NEXT;
am.runnerSha = RUNNER;
for (const f of am.files) f.sha256 = sha(read(path.join(P, f.path)));
fs.writeFileSync(path.join(P, 'artifact-manifest.json'), json(am));
const plan = require(cli).verifyArtifact(P);
console.log(JSON.stringify({ oldSha: am.oldSha, newSha: NEXT, runnerSha: RUNNER, readinessManifestSha: readinessPin, artifactSha: plan.artifactSha }, null, 2));

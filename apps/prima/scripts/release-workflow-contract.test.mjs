// Offline release contracts only: no Azure, Docker, network or application server calls.
import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyReleaseArtifact } from './release-artifact.mjs';

const helper = fileURLToPath(new URL('./staging-schema-gate.mjs', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'prima-release-contract-'));
after(() => rmSync(temporary, { recursive: true, force: true }));
const oldHash = 'a'.repeat(64), newHash = 'b'.repeat(64);
const workflow = readFileSync(new URL('../.github/workflows/deploy-staging.yml', import.meta.url), 'utf8');
function job(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`, workflow.indexOf('\njobs:'));
  assert.notEqual(start, -1, `Expected job ${name}`);
  const tail = workflow.slice(start + 1);
  const next = tail.slice(1).search(/^  [A-Za-z_][A-Za-z0-9_-]*:\s*$/m);
  return next < 0 ? tail : tail.slice(0, next + 1);
}
function step(block, name) {
  const start = block.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `Expected step ${name}`);
  const tail = block.slice(start);
  const next = tail.indexOf('\n      - ', 1);
  return next < 0 ? tail : tail.slice(0, next);
}
const commands = (text) => text.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n');

describe('manual staging workflow safety wiring (static, no cloud execution)', () => {
  it('defaults to build-only and requires explicit, mode-specific confirmations from main and both CEO actors', () => {
    const header = workflow.slice(0, workflow.indexOf('\njobs:'));
    assert.match(header, /workflow_dispatch:/);
    assert.doesNotMatch(header, /^  (?:push|pull_request|schedule):/m);
    assert.match(header, /mode:[\s\S]*type: choice[\s\S]*default: build-only[\s\S]*- build-only\n\s+- deploy/);
    for (const name of ['test', 'build_image', 'deploy']) {
      const condition = job(name).match(/    if: >-\n((?:      .*\n)+)/)?.[1];
      assert.ok(condition, `${name} must have an explicit job gate`);
      for (const clause of ["github.ref == 'refs/heads/main'", "github.actor == 'fauzan4377'", "github.triggering_actor == 'fauzan4377'"]) assert.ok(condition.includes(clause));
      assert.ok(condition.includes("inputs.mode == 'deploy' && inputs.confirm == 'DEPLOY STAGING'"));
      if (name === 'deploy') assert.doesNotMatch(condition, /build-only|BUILD STAGING IMAGE/);
      else assert.ok(condition.includes("inputs.mode == 'build-only' && inputs.confirm == 'BUILD STAGING IMAGE'"));
    }
  });

  it('keeps the build job separate from API changes, migrations and website publication', () => {
    const build = commands(job('build_image'));
    assert.match(build, /needs: test/);
    assert.match(build, /docker build /);
    assert.match(build, /docker push "\$TAG"/);
    assert.doesNotMatch(build, /infra\/(?:set-api-image|run-db-migration|check-staging)\.sh|az\s+(?:containerapp|staticwebapp)\b|static-web-apps-deploy|SWA_TOKEN|\/api\/health\/schema/);
    assert.doesNotMatch(commands(workflow), /^\s*(?:run:\s*)?infra\/run-db-migration\.sh\b/m);
    const header = workflow.slice(0, workflow.indexOf('\njobs:'));
    assert.match(header, /permissions:\n  contents: read/);
    assert.doesNotMatch(header, /id-token: write/);
    assert.doesNotMatch(job('test'), /id-token: write|azure\/login/);
  });

  it('binds deploy to the built immutable digest and the actual source SQL hash', () => {
    const build = job('build_image'), deploy = job('deploy');
    assert.match(build, /WANT=\$\(sha256sum db\/migrations\/001_init\.sql/);
    assert.match(build, /docker pull "\$TAG"/);
    assert.match(build, /DIGEST=\$\(docker image inspect "\$TAG"[\s\S]*\.RepoDigests/);
    assert.match(build, /echo "image=\$DIGEST" >> "\$GITHUB_OUTPUT"/);
    assert.match(build, /echo "schema_sha=\$WANT" >> "\$GITHUB_OUTPUT"/);
    assert.match(build, /docker build[^\n]*\n\s+BUILT_ID=\$\(docker image inspect "\$TAG" --format '\{\{\.Id\}\}'\)/);
    assert.ok(build.indexOf('BUILT_ID=') < build.indexOf('docker push'));
    assert.match(build, /PULLED_ID=\$\(docker image inspect "\$DIGEST" --format '\{\{\.Id\}\}'\)/);
    assert.match(build, /\[ "\$PULLED_ID" = "\$BUILT_ID" \] \|\|[^\n]*exit 1/);
    assert.match(build, /CID=\$\(docker create --entrypoint \/bin\/false "\$DIGEST"\)/);
    assert.match(build, /docker cp "\$CID:\/app\/db\/migrations\/001_init\.sql" "\$RUNNER_TEMP\/candidate-schema\.sql"/);
    assert.match(build, /ACTUAL_SCHEMA=\$\(sha256sum "\$RUNNER_TEMP\/candidate-schema\.sql"/);
    assert.match(build, /\[ "\$ACTUAL_SCHEMA" = "\$WANT" \] \|\|[^\n]*exit 1/);
    assert.ok(build.indexOf('[ "$ACTUAL_SCHEMA" = "$WANT" ]') < build.indexOf('echo "image=$DIGEST"'));
    assert.match(deploy, /needs: \[test, build_image\]/);
    assert.match(deploy, /IMAGE: \$\{\{ needs\.build_image\.outputs\.image \}\}/);
    assert.match(deploy, /TARGET_SCHEMA: \$\{\{ needs\.build_image\.outputs\.schema_sha \}\}/);
    assert.doesNotMatch(deploy, /IMAGE:.*outputs\.tag/);
  });

  it('extracts rollback SQL from the exact immutable ready image without starting the image', () => {
    const capture = commands(step(job('deploy'), 'Capture the previous ready image and its schema without starting it'));
    assert.match(capture, /latestReadyRevisionName/);
    assert.match(capture, /\[ "\$PREVIOUS_DIGEST" = "\$PREVIOUS" \]/);
    assert.match(capture, /docker create --entrypoint \/bin\/false "\$PREVIOUS_DIGEST"/);
    assert.match(capture, /docker cp "\$CID:\/app\/db\/migrations\/001_init\.sql"/);
    assert.match(capture, /PREVIOUS_HASH=\$\(sha256sum "\$RUNNER_TEMP\/previous-schema\.sql"/);
    assert.doesNotMatch(capture, /docker\s+(?:start|run)\b|org\.prima\.schema-sha256/);
    assert.match(capture, /\[ "\$READY_AFTER" = "\$READY_REV" \].*\[ "\$REF_AFTER" = "\$PREVIOUS" \]/);
    assert.match(capture, /echo "PREVIOUS_IMAGE=\$PREVIOUS_DIGEST"/);
    assert.match(capture, /automatic rollback will be forbidden/);
    // Warn before the forward patch and preserve this loss of recovery in the run summary.
    assert.match(capture, /(?:automatic rollback|Automatic rollback)[^\n]*(?:GITHUB_STEP_SUMMARY|\n)/);
    assert.match(capture, /(?:automatic rollback|Automatic rollback)[^\n]*>> "\$GITHUB_STEP_SUMMARY"/);
  });

  it('fails closed on schema fetch and parsing before the only forward image change', () => {
    const forward = step(job('deploy'), 'Require matching applied schema immediately before changing the API image');
    assert.match(forward, /set -euo pipefail/);
    assert.match(forward, /\[ "\$TARGET_SCHEMA" = "\$LOCAL_SCHEMA" \]/);
    assert.match(forward, /if ! curl -fsS --max-time 10 "\$API_URL\/api\/health\/schema"[^\n]*; then[\s\S]*exit 1\n\s+fi/);
    assert.match(forward, /node scripts\/staging-schema-gate\.mjs deploy "\$TARGET_SCHEMA" "\$RUNNER_TEMP\/preflight-schema\.json"[\s\S]*node scripts\/staging-release-gate\.mjs deploy "\$TARGET_RELEASE" "\$RUNNER_TEMP\/preflight-release\.json"\n\s+infra\/set-api-image\.sh "\$IMAGE"/);
    assert.doesNotMatch(forward, /\|\| true|not reported|\.applied \/\/ empty/);
    assert.equal(commands(workflow).match(/infra\/set-api-image\.sh/g)?.length, 2, 'Only guarded forward and rollback patch sites may exist');
  });

  it('rechecks schema inside every rollback attempt and stops rather than using an unproved fallback', () => {
    const verify = step(job('deploy'), 'Verify the NEW revision, and safely roll back if it fails');
    assert.match(verify, /if \[ -z "\$\{PREVIOUS_IMAGE:-\}" \] \|\| \[ -z "\$\{PREVIOUS_SCHEMA:-\}" \]; then[\s\S]*?exit 1\n\s+fi/);
    const attempt = verify.slice(verify.indexOf('for i in $(seq 1 30); do'), verify.indexOf('restored=false'));
    assert.match(attempt, /if ! curl -fsS --max-time 10 "\$API_URL\/api\/health\/schema"[\s\S]*! node scripts\/staging-schema-gate\.mjs rollback "\$PREVIOUS_SCHEMA" "\$RUNNER_TEMP\/rollback-schema\.json"[\s\S]*! node scripts\/staging-release-gate\.mjs rollback "\$PREVIOUS_RELEASE" "\$RUNNER_TEMP\/rollback-release\.json"; then[\s\S]*exit 1\n\s+fi\n\s+if infra\/set-api-image\.sh "\$PREVIOUS_IMAGE"; then/);
    assert.doesNotMatch(attempt, /\|\| true|set-api-image\.sh "\$PREVIOUS"/);
    assert.match(verify, /node scripts\/staging-schema-gate\.mjs rollback "\$PREVIOUS_SCHEMA" "\$RUNNER_TEMP\/restored-schema\.json"/);
    assert.match(verify, /\.current == true and \.expected == \$want/);
    assert.match(verify, /Manual recovery required/);
  });

  it('keeps website token retrieval/publication after successful API validation and never always-runs them', () => {
    const deploy = job('deploy');
    const verify = deploy.indexOf('Verify the NEW revision');
    const token = deploy.indexOf('Fetch the website deployment token');
    const publish = deploy.indexOf('Publish the website');
    assert.ok(verify >= 0 && token > verify && publish > token);
    assert.doesNotMatch(deploy.slice(token), /if:\s*(?:\$\{\{\s*)?always\(/);
    assert.match(step(deploy, 'Verify the NEW revision, and safely roll back if it fails'), /exit 1/);
  });

  it('requires Single revision mode before capture, forward deployment and every rollback attempt', () => {
    const deploy = job('deploy');
    const capture = step(deploy, 'Capture the previous ready image and its schema without starting it');
    const forward = step(deploy, 'Require matching applied schema immediately before changing the API image');
    const verify = step(deploy, 'Verify the NEW revision, and safely roll back if it fails');
    const rollback = verify.slice(verify.indexOf('for i in $(seq 1 30); do'), verify.indexOf('restored=false'));
    for (const block of [capture, forward, rollback]) {
      assert.match(block, /REVISION_MODE=\$\(az containerapp show[^\n]*--query properties\.configuration\.activeRevisionsMode/);
      assert.match(block, /\[ "\$REVISION_MODE" = Single \] \|\|[^\n]*exit 1/);
    }
    assert.ok(forward.indexOf('[ "$REVISION_MODE" = Single ]') < forward.indexOf('infra/set-api-image.sh'));
    assert.ok(rollback.indexOf('[ "$REVISION_MODE" = Single ]') < rollback.indexOf('infra/set-api-image.sh'));
    assert.doesNotMatch(commands(workflow), /az containerapp (?:revision set-mode|update)|--mode (?:single|multiple)/);
  });

  it('has syntactically valid inline shell without executing any release command', () => {
    const scripts = [...workflow.matchAll(/^        run: \|\n((?:          .*\n|\n)+)/gm)].map(m => m[1].split('\n').map(line => line.slice(10)).join('\n'));
    assert.ok(scripts.length >= 5);
    for (const script of scripts) {
      const checked = spawnSync('bash', ['-n'], { input: script, encoding: 'utf8', env: {}, timeout: 5000 });
      assert.equal(checked.status, 0, checked.stderr);
    }
  });
});

describe('extracted forward guard behavior with inert command fixtures', () => {
  const sql = readFileSync(new URL('../db/migrations/001_init.sql', import.meta.url));
  const expected = createHash('sha256').update(sql).digest('hex');
  const releaseRoot = fileURLToPath(new URL('../', import.meta.url));
  const release = verifyReleaseArtifact(releaseRoot).sha256;
  const report = JSON.stringify({version:1,expected:release,ready:true,catalog:{ready:true,baseReady:true,codes:[],modules:Object.fromEntries(['procurement','rental_corrections','cleanup','metrics','job_email'].map(id=>[id,{ready:true,codes:[]}]))}});
  const image = `testregistry.azurecr.io/prima-api@sha256:${'c'.repeat(64)}`;
  const forward = step(job('deploy'), 'Require matching applied schema immediately before changing the API image');
  const script = forward.split('        run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n');
  let fixtureNumber = 0;
  function simulate({ body, curlStatus = 0, revisionMode = 'Single', target = expected, releaseBody = report }) {
    const cwd = join(temporary, `forward-${++fixtureNumber}`);
    for (const path of ['bin', 'infra', 'scripts', 'db/migrations', 'runner']) mkdirSync(join(cwd, path), { recursive: true });
    writeFileSync(join(cwd, 'db/migrations/001_init.sql'), sql);
    writeFileSync(join(cwd, 'scripts/staging-schema-gate.mjs'), readFileSync(helper));
    for(const name of ['staging-release-gate.mjs','release-artifact.mjs'])writeFileSync(join(cwd,'scripts',name),readFileSync(new URL('./'+name,import.meta.url)));
    // No real cloud/network programs are invoked: every external release command
    // in this extracted block is replaced by an inert, local fixture.
    writeFileSync(join(cwd, 'bin/curl'), '#!/bin/sh\ncase "$*" in *health/release*) printf "%s" "$MOCK_RELEASE_BODY";; *) printf "%s" "$MOCK_BODY";; esac\nexit "$MOCK_CURL_STATUS"\n', { mode: 0o755 });
    writeFileSync(join(cwd, 'bin/az'), '#!/bin/sh\ncase "$*" in\n  "containerapp show "*"--query properties.configuration.activeRevisionsMode -o tsv") printf "%s\\n" "$MOCK_REVISION_MODE" ;;\n  *) exit 99 ;;\nesac\n', { mode: 0o755 });
    writeFileSync(join(cwd, 'infra/set-api-image.sh'), '#!/bin/sh\nprintf "%s\\n" "$1" >> "$PATCH_LOG"\n', { mode: 0o755 });
    const patchLog = join(cwd, 'patches.txt');
    const result = spawnSync('/bin/bash', ['-c', script], {
      cwd, encoding: 'utf8', timeout: 5000,
      env: {
        PATH: `${join(cwd, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`,
        ACR: 'testregistry', API_APP: 'fixture-api', RG: 'fixture-group', API_URL: 'https://never-contacted.invalid',
        IMAGE: image, TARGET_SCHEMA: target, TARGET_RELEASE: release, GITHUB_WORKSPACE: releaseRoot, MOCK_RELEASE_BODY: releaseBody, RUNNER_TEMP: join(cwd, 'runner'), GITHUB_STEP_SUMMARY: join(cwd, 'summary.txt'),
        PREVIOUS_IMAGE: image, PREVIOUS_SCHEMA: expected, PATCH_LOG: patchLog,
        MOCK_BODY: body, MOCK_CURL_STATUS: String(curlStatus), MOCK_REVISION_MODE: revisionMode,
      },
    });
    return { ...result, patches: existsSync(patchLog) ? readFileSync(patchLog, 'utf8').trim().split('\n') : [] };
  }

  it('never patches after transport/HTTP failure, malformed JSON, unknown schema or mismatched hash', () => {
    const valid = JSON.stringify({ current: true, expected, applied: expected });
    for (const scenario of [
      { body: valid, curlStatus: 22 }, { body: valid, curlStatus: 28 },
      { body: '<html>404</html>' }, { body: '' }, { body: '{}' },
      { body: JSON.stringify({ current: true, expected: oldHash, applied: oldHash }) },
      { body: valid, target: oldHash },
    ]) {
      const result = simulate(scenario);
      assert.notEqual(result.status, 0, result.stdout + result.stderr);
      assert.deepEqual(result.patches, []);
    }
  });

  it('patches exactly once only with matching schema AND complete release catalog', () => {
    const result = simulate({ body: JSON.stringify({ current: false, expected: oldHash, applied: expected }) });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.patches, [image]);
  });

  it('refuses missing, old or incomplete release report despite matching base',()=>{for(const releaseBody of ['', '{}', JSON.stringify({ready:true}), report.replace('\"ready\":true','\"ready\":false')]){const r=simulate({body:JSON.stringify({current:true,expected,applied:expected}),releaseBody});assert.notEqual(r.status,0);assert.deepEqual(r.patches,[]);}});

  it('refuses unknown or Multiple revision mode without changing settings or images', () => {
    for (const revisionMode of ['', 'Multiple', 'None']) {
      const result = simulate({ body: JSON.stringify({ current: true, expected, applied: expected }), revisionMode });
      assert.notEqual(result.status, 0);
      assert.deepEqual(result.patches, []);
      assert.match(result.stdout, /Single revision mode is required/);
    }
  });
});
let sequence = 0;
function gate(mode, imageHash, body) {
  const path = join(temporary, `schema-${++sequence}.json`);
  if (body !== undefined) writeFileSync(path, body);
  return spawnSync(process.execPath, [helper, mode, imageHash, path], { encoding: 'utf8', env: {}, timeout: 5000 });
}

describe('schema gate command-line failure boundaries (offline)', () => {
  it('emits success only for a valid image/database match in each operation', () => {
    for (const mode of ['deploy', 'rollback']) {
      const result = gate(mode, newHash, JSON.stringify({ current: true, expected: newHash, applied: newHash }));
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), { mode, applied: newHash, imageExpected: newHash });
      assert.equal(result.stderr, '');
    }
  });

  it('fails closed on missing files, empty responses, HTTP error documents and invalid JSON', () => {
    for (const mode of ['deploy', 'rollback']) {
      for (const body of [undefined, '', 'Not Found', '<html>502 Bad Gateway</html>', '{', 'null', '[]', 'true', '{}']) {
        const result = gate(mode, newHash, body);
        assert.equal(result.status, 1, `${mode}: ${body}`);
        assert.equal(result.stdout, '');
        assert.match(result.stderr, /::error::/);
      }
    }
  });

  it('rejects unknown image versions, malformed hashes and contradictory or mismatched evidence', () => {
    for (const mode of ['deploy', 'rollback']) {
      for (const image of ['', 'None', 'latest', 'sha256:' + newHash, newHash.toUpperCase()]) {
        const result = gate(mode, image, JSON.stringify({ current: true, expected: newHash, applied: newHash }));
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
      }
      for (const report of [
        { current: true, expected: newHash, applied: null },
        { current: true, expected: oldHash, applied: newHash },
        { current: false, expected: newHash, applied: newHash },
        { current: 'true', expected: newHash, applied: newHash },
        { current: true, expected: oldHash, applied: oldHash },
      ]) {
        const result = gate(mode, newHash, JSON.stringify(report));
        assert.equal(result.status, 1);
        assert.equal(result.stdout, '');
      }
    }
  });

  it('distinguishes a migrated database from permission to roll back to incompatible SQL', () => {
    const report = JSON.stringify({ current: false, expected: oldHash, applied: newHash });
    assert.equal(gate('deploy', newHash, report).status, 0);
    const rollback = gate('rollback', oldHash, report);
    assert.equal(rollback.status, 1);
    assert.match(rollback.stderr, /does not match/);
    assert.equal(gate('migrate', newHash, report).status, 1);
  });
});

import {spawnSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {verifyReleaseArtifact} from './release-artifact.mjs';import {requireReleaseMatch} from './staging-release-gate.mjs';
const a=verifyReleaseArtifact(process.cwd()),ids=a.manifest.modules.map(x=>x.id);const report=()=>({version:1,expected:a.sha256,ready:true,catalog:{ready:true,baseReady:true,codes:[],modules:Object.fromEntries(ids.map(id=>[id,{ready:true,codes:[]}]))}});
test('only complete exact release catalog permits deploy or rollback',()=>{for(const mode of ['deploy','rollback'])assert.equal(requireReleaseMatch(mode,a.sha256,report()).release,a.sha256);for(const r of [{current:true,expected:a.manifest.base.sha256,applied:a.manifest.base.sha256},{...report(),expected:'0'.repeat(64)},{...report(),ready:false}])assert.throws(()=>requireReleaseMatch('deploy',a.sha256,r));for(const id of ids){const r=report();r.catalog.modules[id].ready=false;assert.throws(()=>requireReleaseMatch('deploy',a.sha256,r));}});
test('image packages all reviewed SQL and startup never calls installer',()=>{const docker=readFileSync('Dockerfile','utf8');for(const p of ['db/migrations','db/modules','db/release-manifest.json','apps/api/src/connections-mail/job-email-v2.sql'])assert.ok(docker.includes('COPY '+p+' '+p));const main=readFileSync('apps/api/src/main.ts','utf8');assert.match(main,/assertReleaseCurrent/);assert.doesNotMatch(main,/module-install|installSelectedModule|db-setup/);});
test('complete release gate precedes forward and rollback image mutations; previous image absence fails closed',()=>{const w=readFileSync('.github/workflows/deploy-staging.yml','utf8');assert.ok(w.indexOf('staging-release-gate.mjs deploy "$TARGET_RELEASE" "$RUNNER_TEMP/preflight-release.json"')<w.indexOf('infra/set-api-image.sh "$IMAGE"'));assert.ok(w.indexOf('staging-release-gate.mjs rollback "$PREVIOUS_RELEASE" "$RUNNER_TEMP/rollback-release.json"')<w.indexOf('infra/set-api-image.sh "$PREVIOUS_IMAGE"'));assert.match(w,/docker cp "\$CID:\/app\/db"/);assert.match(w,/ACTUAL_RELEASE.*release-artifact/);});
test('PR CI builds and verifies unstarted image bytes without push, startup, credentials or deployment',()=>{
 const script=readFileSync(new URL('./check-packaged-release.sh',import.meta.url),'utf8');
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 assert.match(ci,/packaged_release:[\s\S]*run: bash scripts\/check-packaged-release\.sh/);
 assert.match(script,/docker build --iidfile/);assert.match(script,/docker create --entrypoint \/bin\/false "\$IMAGE_ID"/);
 assert.match(script,/docker cp "\$CID:\/app\/db"/);assert.match(script,/job-email-v2\.sql/);
 assert.match(script,/ACTUAL=\$\(node scripts\/release-artifact\.mjs "\$TMP\/artifact"\)/);
 assert.match(script,/\[ "\$ACTUAL" = "\$EXPECTED" \]/);assert.match(script,/trap cleanup EXIT/);
 const commands=script.split('\n').filter(x=>!x.trimStart().startsWith('#')).join('\n');
 assert.doesNotMatch(commands,/docker\s+(?:run|start|push|login)\b|\baz\s|DATABASE_URL|--env|--secret/);
 const checked=spawnSync('/bin/bash',['-n'],{input:script,encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);
});

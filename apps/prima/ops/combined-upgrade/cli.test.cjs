'use strict';
// No database. Proves the packaged bytes, the exact upgrade SQL derivation and every pre-connection refusal.
const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { run, verifyArtifact, parse } = require('./cli.cjs');
const { deriveUpgradeSql } = require('./derive.cjs');
const runner = require('./runner.cjs');
const root = path.resolve(__dirname, '../..');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const pins = verifyArtifact(), owner = 'existing_schema_owner';
const args = () => ['execute', '--owner', owner, '--artifact-sha', pins.artifactSha, '--old-sha', pins.oldSha, '--new-sha', pins.newSha, '--runner-sha', pins.runnerSha, '--confirm', 'MIGRATE_EXACT_COMBINED_BASE_ONLY'];
const good = 'postgres://' + owner + ':synthetic-not-live@psql-prima-staging-sea.postgres.database.azure.com:5432/appdb';

it('upgrade.sql is exactly the rehearsed combined base body plus the two reviewed module scope functions', () => {
  assert.equal(fs.readFileSync(path.join(__dirname, 'upgrade.sql'), 'utf8'), deriveUpgradeSql(root));
});

it('pins match stage 1 output, the release manifest and the runner', () => {
  assert.equal(sha(fs.readFileSync(path.join(root, 'ops/base-transition/candidate.sql'))), pins.oldSha, 'Stage 2 starts where stage 1 ends');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'db/release-manifest.json'), 'utf8'));
  assert.equal(manifest.base.sha256, pins.newSha);
  assert.equal(sha(fs.readFileSync(path.join(root, manifest.base.path))), pins.newSha);
  assert.equal(runner.OLD, pins.oldSha); assert.equal(runner.NEXT, pins.newSha); assert.equal(runner.UPGRADE, pins.upgradeSha);
  const rehearsal = fs.readFileSync(path.join(root, 'scripts/combined-base-upgrade.pg.test.cjs'), 'utf8');
  assert.match(rehearsal, new RegExp(`OLD_SHA = '${pins.oldSha}'`), 'The CI rehearsal starts from the same base');
});

it('every table the runner requires with forced RLS is created with forced RLS in the combined base', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'upgrade.sql'), 'utf8');
  const tenant = sql.match(/FOREACH t IN ARRAY ARRAY\[([\s\S]*?)\]\s*LOOP/)[1];
  for (const t of runner.REQUIRED_FORCED_RLS) {
    assert.ok(tenant.includes(`'${t}'`) || sql.includes(`prima.${t} FORCE ROW LEVEL SECURITY`) || new RegExp(`'${t}'[\\s\\S]{0,400}FORCE ROW LEVEL SECURITY`).test(sql), t);
  }
});

it('plan verifies the package and never creates a database client', async () => {
  for (const a of [[], ['plan']]) {
    const r = await run(a, { DATABASE_URL: 'not a URL' }, { makeClient() { throw Error('must not connect'); } });
    assert.equal(r.status, 'plan_only');
    assert.equal(r.liveAuthorizationGranted, false);
    assert.equal(r.requiresStage1First, true);
  }
});

for (const url of ['', good.replace('.azure.com', '.evil.invalid'), good.replace(':5432', ':5433'), good.replace('/appdb', '/other'), good.replace(owner, 'wrong_owner'),
  good.replace('synthetic-not-live', ''), good + '?sslmode=disable', good + '?sslmode=require', good + '?options=-crole=prima_app', good + '?host=localhost', good + '#fragment']) {
  it('bad target or TLS downgrade refuses before a client exists: ' + url.replace('synthetic-not-live', 'REDACTED'), async () => {
    let made = 0;
    const r = await run(args(), { DATABASE_URL: url }, { makeClient() { made++; } });
    assert.equal(r.status, 'refused'); assert.equal(r.code, 'EXACT_INPUT_TARGET_OR_TLS_REQUIRED'); assert.equal(made, 0);
  });
}

it('missing or wrong pins, owner, confirmation and extra flags refuse before connection', async () => {
  const stage1Confirm = args().map((x, i) => (i === 12 ? 'MIGRATE_EXACT_BASE_ONLY' : x));
  for (const a of [args().slice(0, -1), [...args(), 'extra'], args().map((x, i) => (i === 4 ? '0'.repeat(64) : x)), args().map((x, i) => (i === 6 ? pins.newSha : x)), stage1Confirm, args().map((x, i) => (i === 2 ? 'owner;SQL' : x))]) {
    let n = 0;
    assert.equal((await run(a, { DATABASE_URL: good }, { makeClient() { n++; } })).status, 'refused');
    assert.equal(n, 0);
  }
});

it('client settings pin host, database and verified TLS regardless of PG environment overrides', () => {
  const p = parse(args(), { DATABASE_URL: good + '?sslmode=verify-full', PGOPTIONS: '-c role=prima_app', PGSSLMODE: 'disable' }, pins);
  assert.equal(p.config.host, 'psql-prima-staging-sea.postgres.database.azure.com');
  assert.equal(p.config.database, 'appdb');
  assert.equal(p.config.options, '');
  assert.deepEqual(p.config.ssl, { rejectUnauthorized: true, servername: p.config.host });
  assert.equal(Object.hasOwn(p.config, 'connectionString'), false);
});

it('connection and cleanup errors never show raw causes or allow an automatic retry', async () => {
  let ended = 0;
  const r = await run(args(), { DATABASE_URL: good }, { makeClient: () => ({ on() {}, connect: async () => { throw Error('synthetic-private'); }, end: async () => { ended++; throw Error('more-private'); } }) });
  assert.equal(ended, 1);
  assert.equal(r.status, 'outcome_unconfirmed');
  assert.equal(r.automaticRetryAllowed, false);
  assert.equal(r.connectionCleanupConfirmed, false);
  assert.ok(!JSON.stringify(r).includes('private'));
});

it('a changed upgrade script, runner or manifest fails artifact validation', () => {
  for (const file of ['upgrade.sql', 'runner.cjs', 'artifact-manifest.json']) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'prima-combined-upgrade-'));
    try {
      fs.cpSync(__dirname, d, { recursive: true });
      if (file.endsWith('.json')) {
        // A re-formatted manifest still parses, but its fingerprint no longer matches the --artifact-sha the operator gives.
        fs.appendFileSync(path.join(d, file), ' ');
        assert.notEqual(verifyArtifact(d).artifactSha, pins.artifactSha);
      } else {
        fs.appendFileSync(path.join(d, file), '\n-- changed\n');
        assert.throws(() => verifyArtifact(d));
      }
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  }
});

it('the runner refuses without the exact confirmation, target and verified TLS before any query', async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'upgrade.sql'), 'utf8');
  let queries = 0;
  const client = (over = {}) => ({ connectionParameters: { host: runner.HOST, port: 5432, database: 'appdb', user: owner }, connection: { stream: { encrypted: true, authorized: true } }, query: async () => { queries++; return { rows: [] }; }, ...over });
  const input = { expectedOwner: owner, oldSha: runner.OLD, newSha: runner.NEXT, confirm: runner.CONFIRM };
  assert.equal((await runner.migrateCombined(client(), { ...input, confirm: 'yes' }, sql)).code, 'CONFIRMATION_REQUIRED');
  assert.equal((await runner.migrateCombined(client({ connectionParameters: { host: 'localhost', port: 5432, database: 'appdb', user: owner } }), input, sql)).code, 'CONNECTION_TARGET_MISMATCH');
  assert.equal((await runner.migrateCombined(client({ connection: { stream: { encrypted: true, authorized: false } } }), input, sql)).code, 'VERIFIED_TLS_REQUIRED');
  assert.equal((await runner.migrateCombined(client(), input, sql + '\n')).code, 'SOURCE_HASH_MISMATCH');
  assert.equal(queries, 0);
});

it('packaged in the image beside stage 1; API start command unchanged; CI rehearses it', () => {
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  assert.match(docker, /COPY ops\/combined-upgrade ops\/combined-upgrade/);
  assert.match(docker, /CMD \["node", "dist\/src\/main.js"\]/);
  assert.doesNotMatch(docker, /RUN .*combined-upgrade/);
  const ci = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
  assert.match(ci, /ops\/combined-upgrade\/cli\.test\.cjs/);
  assert.match(ci, /ops\/combined-upgrade\/combined-upgrade\.pg\.test\.cjs/);
});

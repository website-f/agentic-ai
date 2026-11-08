'use strict';
// Explicit operator entry for stage 2 only. Never imported by API startup. No provisioning, no retries.
// `plan` checks the packaged bytes and prints the fixed target and hashes without connecting to anything.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const OLD = '4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe';
const NEXT = '970b976babec96f85f2a7952fff027a9978eee76f86e19ac07b08cd3947771da';
const UPGRADE = '312a3958f801b47ec755cbb06aeb61741819e1eebdd6f25f26770eda19723b82';
const HOST = 'psql-prima-staging-sea.postgres.database.azure.com';
const CONFIRM = 'MIGRATE_EXACT_COMBINED_BASE_ONLY';
const FILES = ['cli.cjs', 'runner.cjs', 'upgrade.sql'];
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function verifyArtifact(root = __dirname) {
  const read = (p) => {
    const q = path.join(root, p);
    if (fs.lstatSync(q).isSymbolicLink() || !fs.lstatSync(q).isFile()) throw Error('artifact');
    return fs.readFileSync(q);
  };
  const bytes = read('artifact-manifest.json'), m = JSON.parse(bytes);
  if (m.version !== 1 || Object.keys(m).sort().join(',') !== 'files,newSha,oldSha,runnerSha,upgradeSha,version' || m.oldSha !== OLD || m.newSha !== NEXT || m.upgradeSha !== UPGRADE
    || !Array.isArray(m.files) || JSON.stringify(m.files.map((x) => x.path)) !== JSON.stringify(FILES)) throw Error('artifact');
  for (const f of m.files) if (Object.keys(f).sort().join(',') !== 'path,sha256' || !/^[a-f0-9]{64}$/.test(f.sha256) || sha(read(f.path)) !== f.sha256) throw Error('artifact');
  if (sha(read('upgrade.sql')) !== UPGRADE || sha(read('runner.cjs')) !== m.runnerSha) throw Error('artifact');
  return { artifactSha: sha(bytes), oldSha: OLD, newSha: NEXT, upgradeSha: UPGRADE, runnerSha: m.runnerSha };
}

function parse(args, env, pins) {
  const keys = ['--owner', '--artifact-sha', '--old-sha', '--new-sha', '--runner-sha', '--confirm'];
  if (args.length !== 13 || args[0] !== 'execute') throw Error('input');
  const v = {};
  for (let n = 0; n < keys.length; n++) { if (args[1 + n * 2] !== keys[n]) throw Error('input'); v[keys[n]] = args[2 + n * 2]; }
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(v['--owner']) || v['--artifact-sha'] !== pins.artifactSha || v['--old-sha'] !== OLD || v['--new-sha'] !== NEXT
    || v['--runner-sha'] !== pins.runnerSha || v['--confirm'] !== CONFIRM) throw Error('input');
  const u = new URL(env.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(u.protocol) || u.hostname !== HOST || (u.port && u.port !== '5432') || u.pathname !== '/appdb' || u.hash
    || decodeURIComponent(u.username) !== v['--owner'] || !u.password) throw Error('target');
  const params = [...u.searchParams];
  if (params.length > 1 || params.some(([k, val]) => k !== 'sslmode' || val !== 'verify-full')) throw Error('tls');
  // No connectionString: its SSL/options query parameters must not override these settings.
  return {
    input: { expectedOwner: v['--owner'], oldSha: OLD, newSha: NEXT, confirm: CONFIRM },
    config: { host: HOST, port: 5432, database: 'appdb', user: v['--owner'], password: decodeURIComponent(u.password), ssl: { rejectUnauthorized: true, servername: HOST }, options: '', application_name: 'prima-exact-combined-upgrade', connectionTimeoutMillis: 10000 },
  };
}

async function run(args = [], env = process.env, { makeClient } = {}) {
  let pins;
  try { pins = verifyArtifact(); } catch { return { status: 'refused', stage: 'preconnect', code: 'PACKAGED_ARTIFACT_INVALID', automaticRetryAllowed: false }; }
  if (args.length === 0 || (args.length === 1 && args[0] === 'plan')) {
    return { status: 'plan_only', ...pins, target: { host: HOST, port: 5432, database: 'appdb' }, requiresStage1First: true, requiresExistingOwner: true, newModulesInstalled: false, liveAuthorizationGranted: false };
  }
  let parsed;
  try { parsed = parse(args, env, pins); } catch { return { status: 'refused', stage: 'preconnect', code: 'EXACT_INPUT_TARGET_OR_TLS_REQUIRED', automaticRetryAllowed: false }; }
  let c, result, connectionFailed = false;
  try {
    c = makeClient ? makeClient(parsed.config) : new (require('pg').Client)(parsed.config);
    if (typeof c.on !== 'function') throw Error('Unsupported connection');
    c.on('error', () => { connectionFailed = true; }); // Never log raw provider errors.
    await c.connect();
    if (connectionFailed) throw Error('Connection unavailable');
    const guarded = {
      get connectionParameters() { return c.connectionParameters; },
      get connection() { return c.connection; },
      query: async (...a) => { if (connectionFailed) throw Error('Connection unavailable'); const r = await c.query(...a); if (connectionFailed) throw Error('Connection unavailable'); return r; },
    };
    const { migrateCombined } = require('./runner.cjs');
    result = await migrateCombined(guarded, parsed.input, fs.readFileSync(path.join(__dirname, 'upgrade.sql'), 'utf8'));
  } catch {
    result = { status: 'outcome_unconfirmed', stage: 'connection_or_execution', code: 'COMBINED_UPGRADE_UNAVAILABLE', automaticRetryAllowed: false };
  } finally {
    if (c) try { await c.end(); } catch { result = { ...result, connectionCleanupConfirmed: false, automaticRetryAllowed: false }; }
  }
  if (connectionFailed) return { status: 'outcome_unconfirmed', stage: 'connection_or_execution', code: 'COMBINED_CONNECTION_FAILED', automaticRetryAllowed: false };
  return result;
}

module.exports = { run, verifyArtifact, parse };
if (require.main === module) {
  run(process.argv.slice(2)).then((r) => {
    process.stdout.write(JSON.stringify(r) + '\n');
    if (!['plan_only', 'committed'].includes(r.status) || r.connectionCleanupConfirmed === false) process.exitCode = 1;
  }).catch(() => { process.stderr.write('Combined upgrade outcome unconfirmed; do not retry automatically.\n'); process.exitCode = 1; });
}

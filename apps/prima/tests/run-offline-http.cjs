/* Only creates its own disposable local database; refuses to replace an existing database. */
const { Client } = require('pg');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
(async () => {
  if (!process.env.DATABASE_URL || process.env.NODE_ENV === 'production') throw new Error('A local test DATABASE_URL and non-production environment are required.');
  const source = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname)) throw new Error('Only loopback PostgreSQL is allowed.');
  if (!['/prima_test', '/postgres'].includes(source.pathname)) throw new Error('Connect through a known disposable test database or postgres.');
  const admin = new Client({ connectionString: source.toString() });
  const database = 'prima_offline_test';
  const role = 'duty_test_api_' + randomBytes(8).toString('hex');
  let created = false;
  await admin.connect();
  try {
    // No IF NOT EXISTS or pre-emptive DROP: an existing database belongs to someone else.
    await admin.query(`CREATE DATABASE ${database}`);
    created = true;
    const testUrl = new URL(source); testUrl.pathname = '/' + database;
    const result = spawnSync(process.execPath, ['--test', 'apps/api/dist/test/duty-offline-http.test.js'], {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DUTY_TEST_ADMIN_URL: testUrl.toString(), DUTY_TEST_ROLE: role },
      stdio: 'inherit', timeout: 120_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Offline HTTP regression exited ${result.status ?? result.signal}.`);
  } finally {
    try {
      if (created) {
        await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
        await admin.query(`DROP ROLE IF EXISTS ${role}`);
      }
    } finally { await admin.end(); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });

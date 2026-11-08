'use strict';
// Stage 2 of the database update: reviewed base 4b4c… (after ops/base-transition) -> combined main base 970b….
// Explicit operator execution only. Never imported by API startup, db-setup or the module installer.
// One transaction: every check, the exact upgrade SQL and the stamp either all commit or all roll back.
const crypto = require('node:crypto');

const OLD = '4b4cf4d3c67d0c5b09ca3c9592c74504a2c7335430dcffeccdd4f48710ed78fe';
const NEXT = '970b976babec96f85f2a7952fff027a9978eee76f86e19ac07b08cd3947771da';
const UPGRADE = '312a3958f801b47ec755cbb06aeb61741819e1eebdd6f25f26770eda19723b82';
const HOST = 'psql-prima-staging-sea.postgres.database.azure.com';
const CONFIRM = 'MIGRATE_EXACT_COMBINED_BASE_ONLY';
// New company-walled or HR-walled tables the combined base must leave with forced row-level security.
const REQUIRED_FORCED_RLS = ['site_dispatches', 'evidence_videos', 'post_logs', 'site_vehicles', 'gate_entries', 'site_tasks', 'site_task_logs', 'site_needs_reviews', 'staff_ids', 'staff_accounts', 'staff_faces', 'staff_movements', 'applicants', 'hr_cases', 'guard_phones', 'guard_phone_sessions', 'guard_pings', 'offline_leases', 'offline_ops'];
const MAX_ROWS = 100000;
const MAX_BYTES = 67108864;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
class Refusal extends Error { constructor(code) { super(code); this.code = code; } }
const need = (ok, code) => { if (!ok) throw new Refusal(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function rows(c, tag, sql, args = []) { return (await c.query(`/* ${tag} */ ${sql}`, args)).rows; }

async function tables(c) {
  return (await rows(c, 'tables', `SELECT c.relname AS name, pg_get_userbyid(c.relowner) AS owner, c.relkind, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'prima' AND c.relkind IN ('r','p','v','m','f') ORDER BY c.relname COLLATE "C"`));
}

/** Count and fingerprint of every row of one table, in a stable order. Refuses tables too large to compare safely. */
async function fingerprint(c, table) {
  need(/^[a-z_][a-z0-9_]{0,62}$/.test(table), 'TABLE_NAME_UNEXPECTED');
  const size = (await rows(c, 'size', `SELECT count(*)::text AS n, coalesce(sum(octet_length(row_to_json(t)::text)), 0)::text AS bytes FROM prima."${table}" t`))[0];
  need(size && Number(size.n) <= MAX_ROWS && Number(size.bytes) <= MAX_BYTES, 'PRESERVATION_SNAPSHOT_LIMIT');
  return (await rows(c, 'fingerprint', `SELECT count(*)::text AS n, encode(sha256(convert_to(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text), ''), 'UTF8')), 'hex') AS fingerprint FROM prima."${table}" t`))[0];
}

async function roleState(c) {
  return {
    roles: await rows(c, 'roles', `SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit FROM pg_roles WHERE rolname IN ('prima_app','prima_api') ORDER BY rolname`),
    members: await rows(c, 'members', `SELECT pg_get_userbyid(roleid) AS role, pg_get_userbyid(member) AS member, admin_option FROM pg_auth_members
      WHERE pg_get_userbyid(roleid) IN ('prima_app','prima_api') OR pg_get_userbyid(member) IN ('prima_app','prima_api') ORDER BY 1, 2`),
  };
}

/** Tables the application roles may DELETE or TRUNCATE from, and any table privilege given to PUBLIC. */
async function riskyGrants(c) {
  return (await rows(c, 'risky_grants', `SELECT c.relname AS name,
      has_table_privilege('prima_app', c.oid, 'DELETE') OR has_table_privilege('prima_api', c.oid, 'DELETE') AS del,
      has_table_privilege('prima_app', c.oid, 'TRUNCATE') OR has_table_privilege('prima_api', c.oid, 'TRUNCATE') AS trunc,
      EXISTS (SELECT 1 FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE a.grantee = 0) AS public
    FROM pg_class c WHERE c.relnamespace = 'prima'::regnamespace AND c.relkind = 'r' ORDER BY c.relname COLLATE "C"`));
}

async function migrateCombined(c, input, sql) {
  let begun = false, commitSent = false, stage = 'validate';
  try {
    need(input?.confirm === CONFIRM && input.oldSha === OLD && input.newSha === NEXT && typeof input.expectedOwner === 'string' && /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(input.expectedOwner), 'CONFIRMATION_REQUIRED');
    need(c?.connectionParameters?.host === HOST && Number(c.connectionParameters.port) === 5432 && c.connectionParameters.database === 'appdb' && c.connectionParameters.user === input.expectedOwner, 'CONNECTION_TARGET_MISMATCH');
    need(c.connection?.stream?.encrypted === true && c.connection.stream.authorized === true, 'VERIFIED_TLS_REQUIRED');
    need(typeof sql === 'string' && sha(sql) === UPGRADE, 'SOURCE_HASH_MISMATCH');
    need(!/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;\s*$/im.test(sql), 'SOURCE_TRANSACTION_INVALID');

    await c.query('BEGIN'); begun = true; stage = 'precheck';
    await c.query('SET LOCAL search_path=pg_catalog');
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query("SET LOCAL statement_timeout='120s'");
    // The same advisory locks as stage 1 and db-setup, so no other schema change runs at the same time.
    await c.query("SELECT pg_advisory_xact_lock(hashtext('prima-reviewed-base-transition'))");
    await c.query('SELECT pg_advisory_xact_lock(4177001)');

    const owner = await rows(c, 'owner', `SELECT current_database()='appdb' AS db_ok, current_user=session_user AS session_ok, current_user=$1 AS expected,
      NOT r.rolsuper AND NOT r.rolbypassrls AS restricted, n.nspowner=r.oid AS owns,
      NOT pg_has_role('prima_app', r.oid, 'MEMBER') AND NOT pg_has_role('prima_api', r.oid, 'MEMBER') AS isolated,
      pg_has_role('prima_api', 'prima_app', 'MEMBER') AS api_app_membership
      FROM pg_roles r JOIN pg_namespace n ON n.nspname='prima' WHERE r.rolname=current_user`, [input.expectedOwner]);
    need(owner.length === 1 && Object.values(owner[0]).every((v) => v === true), 'OWNER_OR_TARGET_MISMATCH');
    const createRights = await rows(c, 'schema_create', `SELECT has_schema_privilege('prima_app','prima','CREATE') OR has_schema_privilege('prima_api','prima','CREATE') AS unsafe`);
    need(createRights.length === 1 && createRights[0].unsafe === false, 'SCHEMA_CREATE_DRIFT');
    // Default privileges would silently add grants to all 37 new tables; stage 1 refuses them too.
    const defaults = await rows(c, 'default_acl', `SELECT EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND defaclnamespace IN (0,'prima'::regnamespace::oid)) AS present`);
    need(defaults.length === 1 && defaults[0].present === false, 'DEFAULT_PRIVILEGES_UNREVIEWED');
    const rolesBefore = await roleState(c);
    need(rolesBefore.roles.length === 2 && rolesBefore.roles.every((r) => !r.rolsuper && !r.rolbypassrls && !r.rolcreaterole && !r.rolcreatedb), 'APPLICATION_ROLE_DRIFT');

    // Block every old application write for the whole transaction. Names come from the catalog, quoted by format().
    const before = await tables(c);
    need(before.length > 100 && before.every((t) => t.owner === input.expectedOwner && t.relkind === 'r'), 'OLD_TABLE_DRIFT');
    const lockList = (await rows(c, 'lock_list', `SELECT string_agg(format('prima.%I', relname), ',' ORDER BY relname COLLATE "C") AS list FROM pg_class WHERE relnamespace='prima'::regnamespace AND relkind='r'`))[0].list;
    await c.query(`LOCK TABLE ${lockList} IN ACCESS EXCLUSIVE MODE`);
    need(same(await tables(c), before), 'OLD_TABLE_DRIFT');

    const stamp = await rows(c, 'stamp', 'SELECT id, migration_sha256 FROM prima.schema_info');
    if (stamp.length === 1 && stamp[0].id === 1 && stamp[0].migration_sha256 === NEXT) throw new Refusal('ALREADY_AT_COMBINED_BASE');
    need(stamp.length === 1 && stamp[0].id === 1 && stamp[0].migration_sha256 === OLD, 'BASE_HASH_MISMATCH');
    // The upgrade replaces the two scope functions of released modules; they must already be installed.
    const modules = await rows(c, 'modules', `SELECT to_regprocedure('prima.ic_scope(text,text)') IS NOT NULL AS ic, to_regprocedure('prima.rc_scope(text,text)') IS NOT NULL AS rc`);
    need(modules.length === 1 && modules[0].ic && modules[0].rc, 'RELEASED_MODULES_NOT_INSTALLED');
    const users = await rows(c, 'users', 'SELECT count(*)::int AS n FROM prima.users');
    need(users[0].n > 0, 'EMPTY_USERS_REFUSED');

    const grantsBefore = await riskyGrants(c);
    const kept = {};
    for (const t of before) if (t.name !== 'schema_info') kept[t.name] = await fingerprint(c, t.name);

    stage = 'apply';
    await c.query(sql);

    stage = 'postcheck';
    const after = await tables(c);
    const afterNames = new Set(after.map((t) => t.name));
    need(before.every((t) => afterNames.has(t.name)), 'OLD_TABLE_REMOVED');
    need(after.every((t) => t.owner === input.expectedOwner && t.relkind === 'r'), 'POST_TABLE_DRIFT');
    // No old table loses its company wall.
    for (const t of before) {
      const now = after.find((x) => x.name === t.name);
      need((!t.rls || now.rls) && (!t.forced || now.forced), 'POST_RLS_WEAKENED');
    }
    for (const name of REQUIRED_FORCED_RLS) {
      const t = after.find((x) => x.name === name);
      need(t && t.rls && t.forced, 'POST_RLS_MISSING');
    }
    const scope = await rows(c, 'scope', `SELECT count(*)::int AS n FROM pg_proc WHERE pronamespace='prima'::regnamespace AND proname IN ('ic_scope','rc_scope') AND prosrc LIKE '%''goodwill''%'`);
    need(scope[0].n === 2, 'POST_SCOPE_FUNCTION_DRIFT');
    // No new delete or truncate right for the application roles, and nothing granted to PUBLIC.
    const deletable = new Set(grantsBefore.filter((g) => g.del).map((g) => g.name));
    const grantsAfter = await riskyGrants(c);
    need(grantsAfter.every((g) => !g.trunc && !g.public && (!g.del || deletable.has(g.name))), 'POST_GRANT_DRIFT');
    const createAfter = await rows(c, 'schema_create', `SELECT has_schema_privilege('prima_app','prima','CREATE') OR has_schema_privilege('prima_api','prima','CREATE') AS unsafe`);
    need(createAfter[0].unsafe === false, 'SCHEMA_CREATE_DRIFT');

    stage = 'preservation';
    for (const [name, print] of Object.entries(kept)) need(same(print, await fingerprint(c, name)), 'PRESERVATION_MISMATCH');
    need(same(rolesBefore, await roleState(c)), 'APPLICATION_ROLE_CHANGED');

    const updated = await rows(c, 'stamp', 'UPDATE prima.schema_info SET migration_sha256=$1, applied_at=now() WHERE id=1 AND migration_sha256=$2 RETURNING migration_sha256', [NEXT, OLD]);
    need(updated.length === 1 && updated[0].migration_sha256 === NEXT, 'SCHEMA_STAMP_FAILED');

    stage = 'commit'; commitSent = true;
    const done = await c.query('COMMIT');
    need(done?.command === 'COMMIT', 'COMMIT_NOT_ACKNOWLEDGED');
    begun = false;
    return { status: 'committed', baseSha256: NEXT, preservedTables: Object.keys(kept).length, newTables: after.length - before.length, needsCompatibleRelease: true, newModulesInstalled: false };
  } catch (e) {
    let rolledBack = false;
    if (begun) try { await c.query('ROLLBACK'); rolledBack = true; } catch { /* reported below */ }
    const status = commitSent ? 'outcome_unconfirmed' : begun && !rolledBack ? 'rollback_unconfirmed' : rolledBack && !(e instanceof Refusal) ? 'rolled_back' : 'refused';
    return { status, stage, code: e instanceof Refusal ? e.code : 'COMBINED_UPGRADE_FAILED', automaticRetryAllowed: false };
  }
}

module.exports = { migrateCombined, OLD, NEXT, UPGRADE, HOST, CONFIRM, REQUIRED_FORCED_RLS };

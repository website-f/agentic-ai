"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moduleBody = moduleBody;
exports.installPrimaadminModule = installPrimaadminModule;
/** Explicit operator command only. Never imported by startup, never resets/reseeds/changes credentials. */
const pg_1 = require("pg");
const release_artifact_1 = require("./working/apps/api/dist/src/release-artifact");
const release_catalog_1 = require("./working/apps/api/dist/src/release-catalog");
const it_manual_readiness_1 = require("./working/apps/api/dist/src/it-manual-readiness");
const it_operations_readiness_1 = require("./working/apps/api/dist/src/it-operations-readiness");
const PREFIX = {
    procurement: { tables: ['it_procurement_%', 'it_purchase_finance_authorities'], functions: 'ip_' },
    rental_corrections: { tables: ['it_rental_correction_%', 'it_rental_replacement%'], functions: 'rc_' },
    cleanup: { tables: ['it_cleanup_%'], functions: 'ic_' }, metrics: { tables: ['it_metric_%'], functions: 'wm_' },
    job_email: { tables: ['job_email_%'], functions: 'job_email_' },
};
const asApp = async (c, fn) => { await c.query('SET LOCAL ROLE prima_app'); try {
    return await fn();
}
finally {
    await c.query('RESET ROLE');
} };
/** The pinned scripts have one outer transaction. Keep all DDL and postchecks in our single transaction. */
function moduleBody(sql) { const m = /^\s*(?:--[^\n]*\n\s*)*BEGIN;([\s\S]*)\bCOMMIT;\s*$/.exec(sql); if (!m)
    throw Error('Reviewed transactional module required.'); return m[1]; }
async function installPrimaadminModule(c, input, root) {
    require('./artifact.cjs').verifyArtifact();
    if(root!==__dirname+'/working')throw Error('Exact packaged source required');
    const cp=c.connectionParameters, stream=c.connection?.stream;
    if(!cp||cp.host!=='psql-prima-staging-sea.postgres.database.azure.com'||Number(cp.port)!==5432||cp.database!=='appdb'||cp.user!=='primaadmin'||stream?.encrypted!==true||stream?.authorized!==true)throw Error('Exact authorized target required');
    const s = (0, release_artifact_1.selectedModuleSql)(input.id, root);
    if (input.confirm !== 'INSTALL_EXACT_PRIMAADMIN_MODULE' || input.releaseSha256 !== s.artifact.sha256 || input.moduleSha256 !== s.module.sha256)
        throw Error('Exact selected module and release confirmation required.');
    let begun = false;
    try {
        await c.query('BEGIN');
        begun = true;
        await c.query("SET LOCAL lock_timeout='5s'");
        await c.query("SET LOCAL statement_timeout='60s'");
        await c.query("SELECT pg_advisory_xact_lock(hashtext('prima-reviewed-module-install'))");
        const owner = await c.query("SELECT current_user=session_user AND current_user='primaadmin' AND current_database()='appdb' AND r.rolcanlogin AND NOT r.rolsuper AND r.rolbypassrls AND r.rolcreatedb AND r.rolcreaterole AND n.nspowner=r.oid AND NOT has_schema_privilege('prima_app','prima','CREATE') AND NOT has_schema_privilege('prima_api','prima','CREATE') AND NOT EXISTS(SELECT 1 FROM pg_default_acl d WHERE d.defaclrole=r.oid AND d.defaclnamespace IN (0,n.oid) AND cardinality(d.defaclacl)>0) AND (SELECT datdba=r.oid FROM pg_database WHERE datname=current_database()) AND pg_has_role(session_user,'prima_app','MEMBER') AND pg_has_role(session_user,'prima_app','SET') AND (SELECT count(*)=2 AND bool_and(NOT rolsuper AND NOT rolbypassrls AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND CASE WHEN rolname='prima_api' THEN rolcanlogin AND NOT rolinherit ELSE NOT rolcanlogin END) FROM pg_roles WHERE rolname IN ('prima_app','prima_api')) AND NOT EXISTS(SELECT 1 FROM pg_roles elevated WHERE (elevated.rolsuper OR elevated.rolbypassrls OR elevated.rolcreatedb OR elevated.rolcreaterole OR elevated.rolname='primaadmin') AND (pg_has_role('prima_app',elevated.oid,'MEMBER') OR pg_has_role('prima_api',elevated.oid,'MEMBER'))) AS allowed FROM pg_roles r JOIN pg_namespace n ON n.nspname='prima' WHERE r.rolname=current_user");
        if (owner.rows.length !== 1 || owner.rows[0].allowed !== true)
            throw Error('Existing isolated schema owner required; no permissions were granted.');
        const rolesBefore=await roleSnapshot(c);
        const base = await c.query('SELECT migration_sha256 FROM prima.schema_info WHERE id=1');
        if (base.rows.length !== 1 || base.rows[0].migration_sha256 !== s.artifact.manifest.base.sha256)
            throw Error('Exact base schema prerequisite is not met.');
        const p = PREFIX[input.id];
        const present = await c.query("SELECT EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='prima' AND t.relname LIKE ANY($1::text[])) OR EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='prima' AND starts_with(f.proname,$2)) OR EXISTS(SELECT 1 FROM pg_trigger t WHERE starts_with(t.tgname,$2)) AS present", [p.tables, p.functions]);
        if (present.rows.length !== 1 || typeof present.rows[0].present !== 'boolean')
            throw Error('Module presence could not be verified.');
        if (present.rows[0].present) {
            if ((await asApp(c, () => (0, release_catalog_1.moduleCatalogProblems)(c, input.id))).length)
                throw Error('Partial or drifted module requires separately reviewed recovery; replay refused.');
            await c.query('ROLLBACK');
            begun = false;
            return { module: input.id, status: 'already_installed', catalogVerified: true, releaseSha256: s.artifact.sha256 };
        }
        const prereq = await asApp(c, async () => [...await (0, it_manual_readiness_1.itManualProblems)(c), ...await (0, it_operations_readiness_1.itOperationsProblems)(c), ...(await Promise.all(s.module.requires.map(id => (0, release_catalog_1.moduleCatalogProblems)(c, id)))).flat()]);
        if (prereq.length)
            throw Error('Module prerequisites are not catalog verified.');
        await c.query(moduleBody(s.sql));
        if ((await asApp(c, () => (0, release_catalog_1.moduleCatalogProblems)(c, input.id))).length)
            throw Error('Installed module failed catalog verification.');
        if(JSON.stringify(await roleSnapshot(c))!==JSON.stringify(rolesBefore))throw Error('Role invariants changed');
        const ack=await c.query('COMMIT');
        if(ack?.command!=='COMMIT')throw Error('Commit acknowledgement unconfirmed');
        begun = false;
        return { module: input.id, status: 'installed', catalogVerified: true, releaseSha256: s.artifact.sha256 };
    }
    catch {
        if (begun)
            await c.query('ROLLBACK').catch(() => undefined);
        throw Error('Selected module installation outcome is unconfirmed; inspect exact catalog before any retry.');
    }
}

async function roleSnapshot(c){const rows=(await c.query("SELECT jsonb_build_object('roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_roles r),'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.roleid,m.member,m.grantor) FROM pg_auth_members m),'defaults',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY d.oid),'[]'::jsonb) FROM pg_default_acl d),'namespace',(SELECT to_jsonb(n) FROM pg_namespace n WHERE n.nspname='prima'),'database',(SELECT jsonb_build_object('owner',datdba,'acl',datacl) FROM pg_database WHERE datname=current_database())) AS snapshot" )).rows;if(rows.length!==1||!rows[0].snapshot||!Array.isArray(rows[0].snapshot.roles)||!Array.isArray(rows[0].snapshot.memberships)||!Array.isArray(rows[0].snapshot.defaults)||!rows[0].snapshot.namespace||!rows[0].snapshot.database)throw Error('Role snapshot unavailable');return rows;}

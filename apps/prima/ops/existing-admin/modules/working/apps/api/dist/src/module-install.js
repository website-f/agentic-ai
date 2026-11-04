"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moduleBody = moduleBody;
exports.installSelectedModule = installSelectedModule;
/** Explicit operator command only. Never imported by startup, never resets/reseeds/changes credentials. */
const pg_1 = require("pg");
const release_artifact_1 = require("./release-artifact");
const release_catalog_1 = require("./release-catalog");
const it_manual_readiness_1 = require("./it-manual-readiness");
const it_operations_readiness_1 = require("./it-operations-readiness");
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
async function installSelectedModule(c, input, root) {
    const s = (0, release_artifact_1.selectedModuleSql)(input.id, root);
    if (input.confirm !== 'INSTALL_SELECTED_MODULE' || input.releaseSha256 !== s.artifact.sha256 || input.moduleSha256 !== s.module.sha256)
        throw Error('Exact selected module and release confirmation required.');
    let begun = false;
    try {
        await c.query('BEGIN');
        begun = true;
        await c.query("SET LOCAL lock_timeout='5s'");
        await c.query("SET LOCAL statement_timeout='60s'");
        await c.query("SELECT pg_advisory_xact_lock(hashtext('prima-reviewed-module-install'))");
        const owner = await c.query("SELECT current_user=session_user AND NOT r.rolsuper AND NOT r.rolbypassrls AND n.nspowner=r.oid AND current_user<>'prima_app' AND pg_has_role(session_user,'prima_app','MEMBER') AS allowed FROM pg_roles r JOIN pg_namespace n ON n.nspname='prima' WHERE r.rolname=current_user");
        if (owner.rows.length !== 1 || owner.rows[0].allowed !== true)
            throw Error('Existing isolated schema owner required; no permissions were granted.');
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
        await c.query('COMMIT');
        begun = false;
        return { module: input.id, status: 'installed', catalogVerified: true, releaseSha256: s.artifact.sha256 };
    }
    catch {
        if (begun)
            await c.query('ROLLBACK').catch(() => undefined);
        throw Error('Selected module installation outcome is unconfirmed; inspect exact catalog before any retry.');
    }
}
async function main() {
    const a = (0, release_artifact_1.releaseArtifact)();
    if (process.argv.length === 2) {
        console.log(JSON.stringify({ mode: 'plan_only', releaseSha256: a.sha256, manifest: a.manifest }));
        return;
    }
    const args = process.argv.slice(2);
    if (args.length !== 8 || args[0] !== '--module' || args[2] !== '--release-sha' || args[4] !== '--module-sha' || args[6] !== '--confirm')
        throw Error('Use explicit module, release-sha, module-sha and confirmation.');
    if (!process.env.DATABASE_URL)
        throw Error('Existing operator database connection is required.');
    const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 });
    const c = await pool.connect();
    try {
        console.log(JSON.stringify(await installSelectedModule(c, { id: args[1], releaseSha256: args[3], moduleSha256: args[5], confirm: args[7] })));
    }
    catch (error) {
        c.release(error);
        await pool.end();
        throw error;
    }
    c.release();
    await pool.end();
}
if (require.main === module)
    main().catch(() => { console.error('Module operation refused or incomplete. No automatic retry; use read-only release verification.'); process.exitCode = 1; });

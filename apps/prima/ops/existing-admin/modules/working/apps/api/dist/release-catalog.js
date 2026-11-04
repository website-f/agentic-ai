"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RELEASE_MODULE_IDS = void 0;
exports.moduleCatalogProblems = moduleCatalogProblems;
exports.releaseCatalogState = releaseCatalogState;
const db_1 = require("./db");
const it_manual_readiness_1 = require("./it-manual-readiness");
const it_operations_readiness_1 = require("./it-operations-readiness");
const procurement_readiness_1 = require("./procurement-readiness");
const rental_correction_readiness_1 = require("./rental-correction-readiness");
const it_cleanup_readiness_1 = require("./it-cleanup-readiness");
const it_workflow_metrics_readiness_1 = require("./it-workflow-metrics-readiness");
const pg_job_email_store_1 = require("./connections-mail/pg-job-email-store");
exports.RELEASE_MODULE_IDS = ['procurement', 'rental_corrections', 'cleanup', 'metrics', 'job_email'];
const moduleCode = (id) => `RELEASE_${id.toUpperCase()}_NOT_READY`;
/** Catalog checks only. Caller supplies its transaction/role. No installation, configuration,
 * authority provisioning, or claim about the credential used by a separate running API. */
async function moduleCatalogProblems(client, id) {
    if (!exports.RELEASE_MODULE_IDS.includes(id))
        return ['RELEASE_UNKNOWN_MODULE'];
    try {
        if (id === 'job_email')
            return (await (0, pg_job_email_store_1.jobEmailCatalogReadiness)(client)).ready ? [] : [moduleCode(id)];
        if ((await (0, it_manual_readiness_1.itManualProblems)(client)).length || (await (0, it_operations_readiness_1.itOperationsProblems)(client)).length)
            return [moduleCode(id)];
        const checks = { procurement: procurement_readiness_1.procurementProblems, rental_corrections: rental_correction_readiness_1.rentalCorrectionProblems, cleanup: it_cleanup_readiness_1.cleanupSchemaProblems, metrics: it_workflow_metrics_readiness_1.workflowMetricProblems };
        return (await checks[id](client)).length ? [moduleCode(id)] : [];
    }
    catch {
        return [moduleCode(id)];
    }
}
function emptyState() {
    return { ready: false, baseReady: false, modules: Object.fromEntries(exports.RELEASE_MODULE_IDS.map(id => [id, { ready: false, codes: [moduleCode(id)] }])), codes: [] };
}
/** One restricted-runtime, read-only transaction; byte-manifest verification is a separate
 * packaging check. Does not prove tenant consent, provider configuration, staff scope or UAT. */
async function releaseCatalogState(pool, expected) {
    const state = emptyState();
    if (!expected || !/^[a-f0-9]{64}$/.test(expected.baseSha256)) {
        state.codes = ['RELEASE_INVALID_MANIFEST'];
        return state;
    }
    let client;
    let rollbackFailed = false;
    try {
        client = await pool.connect();
        await client.query('BEGIN READ ONLY');
        await client.query("SET LOCAL statement_timeout = '15s'");
        await client.query("SET LOCAL lock_timeout = '3s'");
        // Check the actual checked-out login before SET ROLE; never validate a different pool connection.
        const identity = await client.query('SELECT session_user = current_user AS unchanged_login');
        if (identity.rows.length !== 1 || identity.rows[0].unchanged_login !== true)
            throw new Error('Release login boundary failed');
        await (0, db_1.assertRestrictedLogin)(client);
        await client.query('SET LOCAL ROLE prima_app');
        const base = await client.query('SELECT id, migration_sha256 FROM prima.schema_info');
        state.baseReady = base.rows.length === 1 && base.rows[0].id === 1 && base.rows[0].migration_sha256 === expected.baseSha256;
        if (!state.baseReady)
            state.codes.push('RELEASE_BASE_NOT_READY');
        for (const id of exports.RELEASE_MODULE_IDS) {
            const codes = await moduleCatalogProblems(client, id);
            state.modules[id] = { ready: codes.length === 0, codes };
            state.codes.push(...codes);
        }
    }
    catch {
        state.codes.push('RELEASE_CATALOG_UNAVAILABLE');
    }
    finally {
        if (client) {
            try {
                await client.query('ROLLBACK');
            }
            catch {
                rollbackFailed = true;
                state.codes.push('RELEASE_TRANSACTION_CLEANUP_FAILED');
            }
            try {
                client.release(rollbackFailed ? new Error('Release catalog transaction cleanup failed') : undefined);
            }
            catch {
                state.codes.push('RELEASE_TRANSACTION_CLEANUP_FAILED');
            }
        }
    }
    state.codes = [...new Set(state.codes)];
    state.ready = state.baseReady && state.codes.length === 0 && exports.RELEASE_MODULE_IDS.every(id => state.modules[id].ready);
    return state;
}

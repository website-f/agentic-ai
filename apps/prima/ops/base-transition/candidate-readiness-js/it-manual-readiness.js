"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IT_MANUAL_FUNCTION_PINS = void 0;
exports.itManualProblems = itManualProblems;
const it_cleanup_readiness_1 = require("./it-cleanup-readiness");
const procurement_readiness_1 = require("./procurement-readiness");
/** Catalog-only readiness. Never migrates, reads work payloads, or exposes database errors. */
exports.IT_MANUAL_FUNCTION_PINS = { "it_record_permission": "b247f6c91d7c568e54f02c9d23238b5f", "it_register_guard": "7618c85fedf6e5b4b6a2e604c8e01101", "it_manual_receipt_valid": "672403e6b7ae6be3656cf526f0bcdbc9" };
const norm = (v) => String(v ?? '').replace(/::text/g, '').replace(/[\s()]/g, '');
async function itManualProblems(client) {
    try {
        const cleanupProblems = await (0, it_cleanup_readiness_1.cleanupOptionalProblems)(client);
        if (cleanupProblems.length)
            return cleanupProblems;
        const tables = ['it_onboarding', 'it_accounts', 'it_assets', 'it_manual_receipts'];
        const rel = await client.query(`SELECT (to_regclass('prima.it_purchase_finance_authorities') IS NOT NULL OR to_regclass('prima.it_procurement_packets') IS NOT NULL OR to_regclass('prima.it_procurement_receipts') IS NOT NULL OR to_regprocedure('prima.ip_asset_admitted(jsonb)') IS NOT NULL OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='ip_stock_guard' AND tgrelid='prima.it_assets'::regclass)) procurement_present,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner,
    pg_has_role('prima_app',c.relowner,'USAGE') AS owns,
    has_table_privilege('prima_app',c.oid,'SELECT') AS sel,has_table_privilege('prima_app',c.oid,'INSERT') AS ins,
    has_table_privilege('prima_app',c.oid,'UPDATE') AS upd,has_table_privilege('prima_app',c.oid,'DELETE') AS del,
    has_table_privilege('prima_app',c.oid,'TRUNCATE') AS trunc
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        if (rel.rows.length !== 4 || rel.rows.some(r => !r.relrowsecurity || !r.relforcerowsecurity || r.owns || !r.sel || !r.ins || r.del || r.trunc || r.upd !== (r.relname !== 'it_manual_receipts')))
            return ['IT_MANUAL_TABLE_BOUNDARY'];
        const role = await client.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='prima_app'`);
        if (role.rows.length !== 1 || role.rows[0].rolsuper || role.rows[0].rolbypassrls)
            return ['IT_MANUAL_ROLE_BOUNDARY'];
        const funcs = await client.query(`SELECT p.proname,md5(p.prosrc) AS hash,p.prosecdef,p.proconfig,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND p.proname=ANY($1)`, [Object.keys(exports.IT_MANUAL_FUNCTION_PINS)]);
        if (funcs.rows.length !== 3 || funcs.rows.some(r => exports.IT_MANUAL_FUNCTION_PINS[r.proname] !== r.hash || r.prosecdef || r.public_exec || JSON.stringify(r.proconfig) !== JSON.stringify(['search_path=pg_catalog, prima'])))
            return ['IT_MANUAL_FUNCTION_BOUNDARY'];
        const pol = await client.query(`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS chk
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        for (const table of tables) {
            const owner = Number(rel.rows.find(r => r.relname === table).relowner);
            const rows = pol.rows.filter(r => r.relname === table);
            const receipt = table === 'it_manual_receipts';
            const read = receipt ? "data->>'userId'=current_setting('app.user_id',true)ANDprima.it_record_permission('manual')" : `prima.it_record_permission('${table === 'it_assets' ? 'asset_read' : 'read'}')`;
            const write = receipt ? read : "prima.it_record_permission('write')";
            const update = write + (table === 'it_accounts' ? "ORprima.it_record_permission('ceo')" : '');
            const expected = receipt ? {
                it_manual_owner: ['r', read, null, 0], it_manual_insert: ['a', null, write, 0], it_manual_setup: ['*', 'true', 'true', owner]
            } : { it_register_read: ['r', read, null, 0], it_register_insert: ['a', null, write, 0], it_register_update: ['w', update, update, 0], it_register_setup: ['*', 'true', 'true', owner] };
            if (rows.length !== Object.keys(expected).length || rows.some(r => { const e = expected[r.polname]; return !e || r.polcmd !== e[0] || !r.polpermissive || norm(r.qual) !== norm(e[1]) || norm(r.chk) !== norm(e[2]) || JSON.stringify(r.polroles) !== JSON.stringify([e[3]]); }))
                return ['IT_MANUAL_POLICY_BOUNDARY'];
        }
        const triggers = await client.query(`SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,p.proname,p.pronargs,t.tgqual IS NULL unconditional,t.tgnargs,octet_length(t.tgargs) argbytes,t.tgattr::text columns,p.proowner,p.prosecdef,p.proconfig,md5(p.prosrc) function_hash,nf.nspname function_schema,has_function_privilege('prima_app',p.oid,'EXECUTE') runtime_exec,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_exec,t.tgfoid='prima.it_register_guard()'::regprocedure AS exact_function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND NOT t.tgisinternal`, [tables]);
        triggers.rows = triggers.rows.filter(r => r.tgname !== 'ic_operational_guard');
        const optional = triggers.rows.filter(r => r.tgname === 'ip_stock_guard');
        if (optional.length > 1 || optional.some(r => r.relname !== 'it_assets' || r.tgenabled !== 'O' || r.tgtype !== 7 || r.proname !== 'ip_stock_guard' || r.function_schema !== 'prima' || r.pronargs !== 0 || !r.unconditional || r.tgnargs !== 0 || r.argbytes !== 0 || r.columns !== '' || Number(r.proowner) !== Number(rel.rows.find(x => x.relname === 'it_assets').relowner) || !r.prosecdef || r.function_hash !== '17529c48b1583e44ce1dc67268f0a13a' || r.runtime_exec || r.public_exec || JSON.stringify(r.proconfig) !== JSON.stringify(['search_path=pg_catalog, prima'])))
            return ['IT_MANUAL_PROCUREMENT_TRIGGER_BOUNDARY'];
        triggers.rows = triggers.rows.filter(r => r.tgname !== 'ip_stock_guard');
        if (triggers.rows.length !== 3 || tables.slice(0, 3).some(t => triggers.rows.filter(r => r.relname === t).length !== 1) || triggers.rows.some(r => !r.exact_function || r.relname === 'it_manual_receipts' || r.tgenabled !== 'O' || r.tgtype !== 23 || r.proname !== 'it_register_guard'))
            return ['IT_MANUAL_TRIGGER_BOUNDARY'];
        const checks = await client.query(`SELECT conname,convalidated,pg_get_expr(conbin,conrelid) AS expr FROM pg_constraint WHERE conrelid='prima.it_manual_receipts'::regclass AND contype='c'`);
        if (checks.rows.length !== 1 || checks.rows[0].conname !== 'it_manual_receipt_shape' || !checks.rows[0].convalidated || norm(checks.rows[0].expr) !== norm('prima.it_manual_receipt_valid(id,data)'))
            return ['IT_MANUAL_RECEIPT_BOUNDARY'];
        const columns = await client.query(`SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,a.attnotnull
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped`, [tables]);
        if (columns.rows.length !== 8 || tables.some(t => { const a = columns.rows.filter(r => r.relname === t); return a.length !== 2 || !a.some(r => r.attname === 'id' && r.type === 'text' && r.attnotnull) || !a.some(r => r.attname === 'data' && r.type === 'jsonb' && r.attnotnull); }))
            return ['IT_MANUAL_COLUMN_BOUNDARY'];
        const keys = await client.query(`SELECT c.relname,k.convalidated,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND k.contype='p'`, [tables]);
        if (keys.rows.length !== 4 || tables.some(t => keys.rows.filter(r => r.relname === t && r.convalidated && norm(r.definition) === norm('PRIMARY KEY (id)')).length !== 1))
            return ['IT_MANUAL_IDENTITY_BOUNDARY'];
        if (rel.rows.some(r => r.procurement_present)) {
            const problems = await (0, procurement_readiness_1.procurementProblems)(client);
            if (problems.length)
                return ['IT_MANUAL_PROCUREMENT_DEPENDENCY', ...problems];
        }
        return [];
    }
    catch {
        return ['IT_MANUAL_SCHEMA_UNAVAILABLE'];
    }
}

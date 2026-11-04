"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HR_IT_FUNCTION_PINS = void 0;
exports.hrItProblems = hrItProblems;
/** Catalog-only readiness. Never migrates, reads work payloads, or exposes database errors. */
exports.HR_IT_FUNCTION_PINS = { "hr_it_active": { "hash": "c6ec5a079f5a74daf2120794b9833b11", "definer": false }, "hr_it_role": { "hash": "22c6c3466ea7dc1a6482c037dacf35a5", "definer": false }, "hr_it_mapping": { "hash": "01713fccdc4fe0f11734125030084350", "definer": false }, "hr_it_delegated": { "hash": "f34cd17ad4b84ecc2343d7fbabf2efdb", "definer": true }, "hr_it_visible": { "hash": "2e07a016cb05cdf70dce52bf59ac9f85", "definer": true }, "hr_it_mapping_visible": { "hash": "bc1fb35ef2d86b8a70dd0f0cb4eaab6e", "definer": true }, "hr_it_canonical": { "hash": "9abdaa2851521dbc4419e0524e697933", "definer": false }, "hr_it_subject_current": { "hash": "7098f6a983a66606efe96f16e24cfce2", "definer": true }, "hr_it_latest_approval": { "hash": "9f72f94b50c369740e4bda5473d286a1", "definer": true }, "hr_it_validate": { "hash": "8a48e1db41a9b769faf61bc63937f5c8", "definer": true }, "hr_it_guard": { "hash": "52259002c8eed763c332075fd3ee796b", "definer": false }, "hr_it_mapping_guard": { "hash": "bae757cecead391ef7e28792586e48be", "definer": false } };
const norm = (v) => String(v ?? '').replace(/::text/g, '').replace(/[\s()]/g, '');
async function hrItProblems(client) {
    try {
        const tables = ['hr_it_requests', 'hr_it_approvals', 'hr_it_delegations', 'hr_it_authority_mappings', 'hr_it_receipts'];
        const rel = await client.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relowner,
    pg_has_role('prima_app',c.relowner,'USAGE') AS owns,
    has_table_privilege('prima_app',c.oid,'SELECT') AS sel,has_table_privilege('prima_app',c.oid,'INSERT') AS ins,
    has_table_privilege('prima_app',c.oid,'UPDATE') AS upd,has_table_privilege('prima_app',c.oid,'DELETE') AS del,
    has_table_privilege('prima_app',c.oid,'TRUNCATE') AS trunc
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        if (rel.rows.length !== 5 || new Set(rel.rows.map(r => Number(r.relowner))).size !== 1 || rel.rows.some(r => !r.relrowsecurity || !r.relforcerowsecurity || r.owns || !r.sel || r.ins !== (r.relname !== 'hr_it_authority_mappings') || r.del || r.trunc || r.upd !== ['hr_it_requests', 'hr_it_delegations'].includes(r.relname)))
            return ['HR_IT_TABLE_BOUNDARY'];
        const role = await client.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='prima_app'`);
        if (role.rows.length !== 1 || role.rows[0].rolsuper || role.rows[0].rolbypassrls)
            return ['HR_IT_ROLE_BOUNDARY'];
        const funcs = await client.query(`SELECT p.proname,p.proowner AS function_owner,has_function_privilege('prima_app',p.oid,'EXECUTE') AS app_exec,pg_has_role('prima_app',p.proowner,'USAGE') AS app_owns,md5(p.prosrc) AS hash,p.prosecdef,p.proconfig,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_exec
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND p.proname=ANY($1)`, [Object.keys(exports.HR_IT_FUNCTION_PINS)]);
        if (funcs.rows.length !== 12 || funcs.rows.some(r => !exports.HR_IT_FUNCTION_PINS[r.proname] || exports.HR_IT_FUNCTION_PINS[r.proname].hash !== r.hash || exports.HR_IT_FUNCTION_PINS[r.proname].definer !== r.prosecdef || r.app_owns || Number(r.function_owner) !== Number(rel.rows[0].relowner) || r.app_exec !== ['hr_it_visible', 'hr_it_mapping_visible', 'hr_it_validate', 'hr_it_active'].includes(r.proname) || r.public_exec || JSON.stringify(r.proconfig) !== JSON.stringify(['search_path=pg_catalog, prima'])))
            return ['HR_IT_FUNCTION_BOUNDARY'];
        const pol = await client.query(`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) AS qual,pg_get_expr(p.polwithcheck,p.polrelid) AS chk
    FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        for (const table of tables) {
            const owner = Number(rel.rows.find(r => r.relname === table).relowner);
            const rows = pol.rows.filter(r => r.relname === table);
            const read = table === 'hr_it_requests' ? 'prima.hr_it_visible(data)' : table === 'hr_it_receipts' ? "data->>'userId'=current_setting('app.user_id',true)" : table === 'hr_it_authority_mappings' ? 'prima.hr_it_mapping_visible(data)' : `EXISTS(SELECT 1 FROM prima.hr_it_requests r WHERE r.id=${table}.data->>'requestId' AND prima.hr_it_visible(r.data))`;
            const expected = { hr_it_read: ['r', read, null, 0], hr_it_setup: ['*', 'true', 'true', owner] };
            if (table !== 'hr_it_authority_mappings')
                expected.hr_it_insert = ['a', null, 'true', 0];
            if (['hr_it_requests', 'hr_it_delegations'].includes(table))
                expected.hr_it_update = ['w', read, 'true', 0];
            if (rows.length !== Object.keys(expected).length || rows.some(r => { const e = expected[r.polname]; return !e || r.polcmd !== e[0] || !r.polpermissive || norm(r.qual) !== norm(e[1]) || norm(r.chk) !== norm(e[2]) || JSON.stringify(r.polroles) !== JSON.stringify([e[3]]); }))
                return ['HR_IT_POLICY_BOUNDARY'];
        }
        const triggers = await client.query(`SELECT c.relname,t.tgenabled,t.tgtype,p.proname,CASE WHEN c.relname='hr_it_authority_mappings' THEN t.tgfoid='prima.hr_it_mapping_guard()'::regprocedure ELSE t.tgfoid='prima.hr_it_guard()'::regprocedure END AS exact_function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='prima' AND c.relname=ANY($1) AND NOT t.tgisinternal`, [tables]);
        if (triggers.rows.length !== 5 || tables.some(t => triggers.rows.filter(r => r.relname === t).length !== 1) || triggers.rows.some(r => !r.exact_function || r.tgenabled !== 'O' || r.tgtype !== (r.relname === 'hr_it_authority_mappings' ? 31 : 23) || r.proname !== (r.relname === 'hr_it_authority_mappings' ? 'hr_it_mapping_guard' : 'hr_it_guard')))
            return ['HR_IT_TRIGGER_BOUNDARY'];
        const columns = await client.query(`SELECT c.relname,a.attname,a.atttypid::regtype::text AS type,a.attnotnull
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped`, [tables]);
        if (columns.rows.length !== 10 || tables.some(t => { const a = columns.rows.filter(r => r.relname === t); return a.length !== 2 || !a.some(r => r.attname === 'id' && r.type === 'text' && r.attnotnull) || !a.some(r => r.attname === 'data' && r.type === 'jsonb' && r.attnotnull); }))
            return ['HR_IT_COLUMN_BOUNDARY'];
        const keys = await client.query(`SELECT c.relname,k.convalidated,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND k.contype='p'`, [tables]);
        if (keys.rows.length !== 5 || tables.some(t => keys.rows.filter(r => r.relname === t && r.convalidated && norm(r.definition) === norm('PRIMARY KEY (id)')).length !== 1))
            return ['HR_IT_IDENTITY_BOUNDARY'];
        const indexes = await client.query(`SELECT i.relname AS name,x.indisunique,x.indisvalid,pg_get_indexdef(i.oid) AS definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND i.relname=ANY($1)`, [['hr_it_subject_active', 'hr_it_target_active', 'hr_it_approval_sequence', 'hr_it_mapping_identity']]);
        const expected = { hr_it_mapping_identity: "CREATE UNIQUE INDEX hr_it_mapping_identity ON prima.hr_it_authority_mappings USING btree ((data ->> 'kind'::text), (data ->> 'companyId'::text), (data ->> 'userId'::text))", hr_it_subject_active: "CREATE UNIQUE INDEX hr_it_subject_active ON prima.hr_it_requests USING btree ((data #>> '{subject,kind}'::text[]), (data #>> '{subject,id}'::text[]), (data ->> 'companyId'::text)) WHERE ((data ->> 'status'::text) <> 'cancelled'::text)", hr_it_target_active: "CREATE UNIQUE INDEX hr_it_target_active ON prima.hr_it_requests USING btree ((data ->> 'targetUserId'::text), (data ->> 'companyId'::text)) WHERE (((data ->> 'status'::text) <> 'cancelled'::text) AND ((data ->> 'targetUserId'::text) IS NOT NULL))", hr_it_approval_sequence: "CREATE UNIQUE INDEX hr_it_approval_sequence ON prima.hr_it_approvals USING btree ((data ->> 'requestId'::text), (data ->> 'sequence'::text))" };
        if (indexes.rows.length !== 4 || indexes.rows.some(r => !r.indisunique || !r.indisvalid || !expected[r.name] || norm(r.definition) !== norm(expected[r.name])))
            return ['HR_IT_UNIQUENESS_BOUNDARY'];
        return [];
    }
    catch {
        return ['HR_IT_SCHEMA_UNAVAILABLE'];
    }
}

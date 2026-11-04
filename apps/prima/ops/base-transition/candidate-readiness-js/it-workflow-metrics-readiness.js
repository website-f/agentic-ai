"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.METRIC_ARGS = exports.METRIC_PINS = void 0;
exports.workflowMetricProblems = workflowMetricProblems;
exports.METRIC_PINS = { "wm_hash": "983c0267f94a613629b2764a17a8daeb", "wm_shape": "e6c0a44988ad920c0a4532e4458d93a1", "wm_active": "74f96d7ba9018d1c798929dcc8ffb48e", "wm_role": "c8253c07dcd824ad779556d74e20e5b1", "wm_ref": "a0da1e10db2f0dbe6f861e1c901a20fc", "wm_source": "3db876e4110a74c8520c2540d4457b2e", "wm_source_hash": "c7b9856075b0c256f3bd4a2ba3f446e0", "wm_web_scope": "35a6c2eac15a0b0344b129e9043fa467", "wm_authority": "56272953f286235378931eb1f3ff959c", "wm_lock": "e86fe6cb5dfe79d748351c7d825ff4af", "wm_quality": "ed5551507f9069a3d4ceddebf340c2aa", "wm_timestamp": "1a1f2c325256e3f2409ef771f03ba2b9", "wm_calendar_valid": "c5dbccc61dab5b6ab4a057473b36629c", "wm_visible": "8a803528484e85f752c41a91972bf10f", "wm_operation": "c041901d6fd27363cb81d0ff9368e4c8", "wm_config_guard": "2802f08b016b25bf2b177ce8cf6c5b98", "wm_receipt_guard": "add52900e3e6bc639a3e2dcd492b6ea5", "wm_boundary": "808c41dfd01faf2dfb18be19153df6ad", "wm_stream_guard": "9afc3ddf9c64258fd273ca6f20a8bcd2", "wm_next_segment": "debdfb5e03b8654b75c9153c6d3e5ad7", "wm_terminal_guard": "75582da48fc8468efbf4a2a531a1d447" };
exports.METRIC_ARGS = { "wm_hash": "d jsonb", "wm_shape": "d jsonb,keys text[],strings text[],numbers text[]", "wm_active": "uid text", "wm_role": "uid text,need text", "wm_ref": "ref jsonb", "wm_source": "ref jsonb", "wm_source_hash": "uid text,ref jsonb,d jsonb", "wm_web_scope": "uid text,t jsonb", "wm_authority": "uid text,ref jsonb", "wm_lock": "ref jsonb", "wm_quality": "ref jsonb,d jsonb", "wm_timestamp": "v jsonb,current_recording boolean", "wm_calendar_valid": "c jsonb", "wm_visible": "stream_id text", "wm_operation": "uid text,request_id text", "wm_config_guard": "", "wm_receipt_guard": "", "wm_boundary": "stream_id text", "wm_stream_guard": "", "wm_next_segment": "ref jsonb", "wm_terminal_guard": "" };
const definers = ["wm_active", "wm_role", "wm_source", "wm_source_hash", "wm_web_scope", "wm_authority", "wm_lock", "wm_visible", "wm_operation", "wm_config_guard", "wm_receipt_guard", "wm_boundary", "wm_stream_guard", "wm_next_segment", "wm_terminal_guard"];
const tables = ['it_metric_streams', 'it_metric_receipts', 'it_metric_targets', 'it_metric_calendars'];
const runtimeFunctions = ['wm_active', 'wm_role', 'wm_visible', 'wm_lock', 'wm_boundary', 'wm_next_segment'];
// PostgreSQL deparses #>> paths with ::text[]; normalize only syntax outside
// quoted literals/identifiers, so altered setting names or JSON paths still fail.
const norm = (v) => String(v ?? '').replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|::text(?:\[\])?|[\s()]/g, m => m.startsWith("'") || m.startsWith('"') ? m : '');
/** Read-only catalog gate. No default calendar, permissions or timing records are installed. */
async function workflowMetricProblems(client) {
    try {
        const rel = await client.query(`SELECT c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,pg_has_role('prima_app',c.relowner,'USAGE') owns,has_table_privilege('prima_app',c.oid,'SELECT') sel,has_table_privilege('prima_app',c.oid,'INSERT') ins,has_table_privilege('prima_app',c.oid,'UPDATE') upd,has_table_privilege('prima_app',c.oid,'DELETE') del,has_table_privilege('prima_app',c.oid,'TRUNCATE') trunc FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        if (rel.rows.length !== 4 || new Set(rel.rows.map(r => Number(r.relowner))).size !== 1 || tables.some(t => rel.rows.filter(r => r.relname === t).length !== 1) || rel.rows.some(r => !r.relrowsecurity || !r.relforcerowsecurity || r.owns || !r.sel || r.del || r.trunc || r.ins !== (r.relname !== 'it_metric_calendars') || r.upd !== (r.relname === 'it_metric_streams')))
            return ['METRICS_TABLE_BOUNDARY'];
        const owner = Number(rel.rows[0].relowner);
        const role = await client.query(`SELECT oid,rolsuper,rolbypassrls,has_schema_privilege('prima_app','prima','CREATE') schema_create FROM pg_roles WHERE rolname='prima_app'`);
        if (role.rows.length !== 1 || role.rows[0].rolsuper || role.rows[0].rolbypassrls || role.rows[0].schema_create)
            return ['METRICS_ROLE_BOUNDARY'];
        const app = Number(role.rows[0].oid);
        const fs = await client.query(`SELECT p.proname,p.proowner,p.prosecdef,p.proconfig,md5(p.prosrc) hash,pg_get_function_identity_arguments(p.oid) args,has_function_privilege('prima_app',p.oid,'EXECUTE') runtime_exec,EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_exec FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND starts_with(p.proname,'wm_')`);
        const pins = exports.METRIC_PINS, signature = exports.METRIC_ARGS;
        if (fs.rows.length !== Object.keys(pins).length || Object.keys(pins).some(n => fs.rows.filter(r => r.proname === n).length !== 1) || fs.rows.some(r => pins[r.proname] !== r.hash || norm(r.args) !== norm(signature[r.proname]) || Number(r.proowner) !== owner || r.prosecdef !== definers.includes(r.proname) || r.public_exec || r.runtime_exec !== runtimeFunctions.includes(r.proname) || JSON.stringify(r.proconfig) !== JSON.stringify(['search_path=pg_catalog, prima'])))
            return ['METRICS_FUNCTION_BOUNDARY'];
        const pol = await client.query(`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) chk FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        for (const t of tables) {
            const active = "prima.wm_active(current_setting('app.user_id',true))", visible = 'prima.wm_visible(id)', own = "data->>'ownerId'=current_setting('app.user_id',true) AND " + active, receipt = "data#>>'{receipt,userId}'=current_setting('app.user_id',true) AND " + active;
            const expected = { wm_owner: ['*', 'true', 'true', owner], wm_read: ['r', t === 'it_metric_streams' ? visible : t === 'it_metric_receipts' ? receipt : active, null, app] };
            if (t !== 'it_metric_calendars')
                expected.wm_insert = ['a', null, t === 'it_metric_streams' ? own : t === 'it_metric_receipts' ? receipt : "prima.wm_role(current_setting('app.user_id',true),'manager')", app];
            if (t === 'it_metric_streams')
                expected.wm_update = ['w', visible, visible, app];
            const rows = pol.rows.filter(r => r.relname === t);
            if (rows.length !== Object.keys(expected).length || rows.some(r => { const e = expected[r.polname]; return !e || r.polcmd !== e[0] || !r.polpermissive || norm(r.qual) !== norm(e[1]) || norm(r.chk) !== norm(e[2]) || JSON.stringify(r.polroles) !== JSON.stringify([e[3]]); }))
                return ['METRICS_POLICY_BOUNDARY'];
        }
        const tr = await client.query(`SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgqual IS NULL unconditional,t.tgnargs,octet_length(t.tgargs) argbytes,t.tgattr::text columns,p.proname,nf.nspname function_schema,p.pronargs,t.tgfoid=to_regprocedure('prima.'||CASE WHEN t.tgname='wm_terminal' THEN 'wm_terminal_guard' WHEN c.relname='it_metric_streams' THEN 'wm_stream_guard' WHEN c.relname='it_metric_receipts' THEN 'wm_receipt_guard' ELSE 'wm_config_guard' END||'()') exact_function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace nf ON nf.oid=p.pronamespace WHERE n.nspname='prima' AND NOT t.tgisinternal AND (c.relname=ANY($1) OR starts_with(t.tgname,'wm_'))`, [tables]);
        const expected = [...tables.map(t => [t, 'wm_guard', t === 'it_metric_streams' ? 'wm_stream_guard' : t === 'it_metric_receipts' ? 'wm_receipt_guard' : 'wm_config_guard', 31, false]), ...['it_metric_streams', 'it_metric_targets'].map(t => [t, 'wm_terminal', 'wm_terminal_guard', 21, true])];
        if (tr.rows.length !== expected.length || expected.some(([t, name, fn, type, deferred]) => tr.rows.filter(r => r.relname === t && r.tgname === name && r.proname === fn && r.function_schema === 'prima' && r.pronargs === 0 && r.unconditional && r.tgnargs === 0 && r.argbytes === 0 && r.columns === '' && r.tgenabled === 'O' && r.tgtype === type && r.exact_function && r.tgdeferrable === deferred && r.tginitdeferred === deferred).length !== 1))
            return ['METRICS_TRIGGER_BOUNDARY'];
        const cols = await client.query(`SELECT c.relname,a.attname,a.atttypid::regtype::text type,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped`, [tables]);
        if (cols.rows.length !== 8 || tables.some(t => { const a = cols.rows.filter(r => r.relname === t); return a.length !== 2 || !a.some(r => r.attname === 'id' && r.type === 'text' && r.attnotnull) || !a.some(r => r.attname === 'data' && r.type === 'jsonb' && r.attnotnull); }))
            return ['METRICS_COLUMN_BOUNDARY'];
        const pk = await client.query(`SELECT c.relname,k.convalidated,pg_get_constraintdef(k.oid) definition,i.indisvalid FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index i ON i.indexrelid=k.conindid WHERE n.nspname='prima' AND c.relname=ANY($1) AND k.contype='p'`, [tables]);
        if (pk.rows.length !== 4 || tables.some(t => pk.rows.filter(r => r.relname === t && r.convalidated && r.indisvalid && norm(r.definition) === 'PRIMARYKEYid').length !== 1))
            return ['METRICS_IDENTITY_BOUNDARY'];
        const ix = await client.query(`SELECT i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) definition FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname='wm_active_owner'`);
        if (ix.rows.length !== 1 || !ix.rows[0].indisunique || !ix.rows[0].indisvalid || norm(ix.rows[0].definition) !== norm("CREATE UNIQUE INDEX wm_active_owner ON prima.it_metric_streams USING btree ((data ->> 'ownerId'::text)) WHERE ((data ->> 'mode'::text) = 'active'::text)"))
            return ['METRICS_ACTIVE_OWNER_BOUNDARY'];
        const dependencies = ['users', 'it_jobs', 'it_tickets', 'web_settings', 'web_issues', 'web_companies', 'web_sites', 'web_domains', 'companies'];
        const dep = await client.query(`SELECT c.relname,c.relowner,c.relkind,has_table_privilege($2::oid,c.oid,'SELECT') sel,has_table_privilege($2::oid,c.oid,'UPDATE') upd,c.relrowsecurity,c.relforcerowsecurity,EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polpermissive AND p.polcmd IN ('*','r') AND pg_get_expr(p.polqual,p.polrelid)='true' AND EXISTS(SELECT 1 FROM unnest(p.polroles) pr WHERE pr=0 OR pg_has_role($2::oid,pr,'USAGE'))) owner_read,EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND NOT p.polpermissive AND p.polcmd IN ('*','r') AND EXISTS(SELECT 1 FROM unnest(p.polroles) pr WHERE pr=0 OR pg_has_role($2::oid,pr,'USAGE'))) restricted FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [dependencies, owner]);
        if (dep.rows.length !== dependencies.length || dependencies.some(t => dep.rows.filter(r => r.relname === t).length !== 1) || dep.rows.some(r => r.relkind !== 'r' || Number(r.relowner) !== owner || !r.sel || !r.upd || (r.relname !== 'companies' && r.relrowsecurity && (!r.relforcerowsecurity || !r.owner_read || r.restricted))))
            return ['METRICS_SOURCE_BOUNDARY'];
        return [];
    }
    catch {
        return ['METRICS_SCHEMA_UNAVAILABLE'];
    }
}

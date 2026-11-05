"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RENTAL_CORRECTION_PINS = void 0;
exports.rentalCorrectionProblems = rentalCorrectionProblems;
const it_cleanup_readiness_1 = require("./it-cleanup-readiness");
exports.RENTAL_CORRECTION_PINS = { "rc_hash": "983c0267f94a613629b2764a17a8daeb", "rc_role": "89bef70616c6f7e2c7d95a43cfb9b470", "rc_scope": "c5f4d3a5a507422dc4d08d28e0315c6a", "rc_visible": "136a51225464482982e2e28c4f03e302", "rc_current": "d46cd3210fb2130ad7cb9420e8e5d4d8", "rc_guard": "85924c5d1dab85c1f30380079a78ff19", "rc_original_payment_guard": "6bb473fec837311806398743679cc664", "rc_visible_receipt": "9765f3b89476fc7b7ab10d51b245ebac" };
const tables = ['it_rental_correction_requests', 'it_rental_correction_reviews', 'it_rental_replacements', 'it_rental_replacement_payments', 'it_rental_correction_receipts'];
const norm = (x) => String(x ?? '').replace(/::text/g, '').replace(/[\s()]/g, '');
/** Catalog only. No schema installation or private work data reads. */
async function rentalCorrectionProblems(client) {
    try {
        const cleanupProblems = await (0, it_cleanup_readiness_1.cleanupOptionalProblems)(client);
        if (cleanupProblems.length)
            return cleanupProblems;
        const rel = await client.query(`SELECT c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,pg_has_role('prima_app',c.relowner,'USAGE') owns,
 has_table_privilege('prima_app',c.oid,'SELECT') sel,has_table_privilege('prima_app',c.oid,'INSERT') ins,
 has_table_privilege('prima_app',c.oid,'UPDATE') upd,has_table_privilege('prima_app',c.oid,'DELETE') del,has_table_privilege('prima_app',c.oid,'TRUNCATE') trunc
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        if (rel.rows.length !== 5 || new Set(rel.rows.map(r => Number(r.relowner))).size !== 1 || rel.rows.some(r => !r.relrowsecurity || !r.relforcerowsecurity || r.owns || !r.sel || !r.ins || r.upd || r.del || r.trunc))
            return ['RENTAL_CORRECTION_TABLE_BOUNDARY'];
        const owner = Number(rel.rows[0].relowner);
        const role = await client.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='prima_app'`);
        if (role.rows.length !== 1 || role.rows[0].rolsuper || role.rows[0].rolbypassrls)
            return ['RENTAL_CORRECTION_ROLE_BOUNDARY'];
        const fs = await client.query(`SELECT p.proname,p.proowner,p.prosecdef,p.proconfig,md5(p.prosrc) hash,pg_get_function_identity_arguments(p.oid) args,
 has_function_privilege('prima_app',p.oid,'EXECUTE') runtime_exec,
 EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public_exec
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND p.proname=ANY($1)`, [Object.keys(exports.RENTAL_CORRECTION_PINS)]);
        const args = { rc_hash: 'd jsonb', rc_role: 'uid text, need text', rc_scope: 'uid text, company text', rc_visible: 'company text', rc_visible_receipt: '', rc_current: 'd jsonb', rc_guard: '', rc_original_payment_guard: '' };
        if (fs.rows.length !== 8 || fs.rows.some(r => exports.RENTAL_CORRECTION_PINS[r.proname] !== r.hash || r.args !== args[r.proname] || Number(r.proowner) !== owner || r.prosecdef !== (r.proname !== 'rc_hash') || r.public_exec || r.runtime_exec !== ['rc_visible', 'rc_visible_receipt'].includes(r.proname) || JSON.stringify(r.proconfig) !== JSON.stringify(['search_path=pg_catalog, prima'])))
            return ['RENTAL_CORRECTION_FUNCTION_BOUNDARY'];
        const pol = await client.query(`SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,pg_get_expr(p.polqual,p.polrelid) qual,pg_get_expr(p.polwithcheck,p.polrelid) chk FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1)`, [tables]);
        for (const t of tables) {
            const rows = pol.rows.filter(r => r.relname === t), v = t === 'it_rental_correction_receipts' ? "data->>'userId'=current_setting('app.user_id',true) AND prima.rc_visible_receipt()" : "prima.rc_visible(data->>'companyId')";
            const expected = { rc_read: ['r', v, null, 0], rc_insert: ['a', null, v, 0], rc_setup: ['*', 'true', 'true', owner] };
            if (rows.length !== 3 || rows.some(r => { const e = expected[r.polname]; return !e || r.polcmd !== e[0] || !r.polpermissive || norm(r.qual) !== norm(e[1]) || norm(r.chk) !== norm(e[2]) || JSON.stringify(r.polroles) !== JSON.stringify([e[3]]); }))
                return ['RENTAL_CORRECTION_POLICY_BOUNDARY'];
        }
        const tr = await client.query(`SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,p.proname,t.tgfoid=CASE WHEN c.relname='it_rental_bills' THEN 'prima.rc_original_payment_guard()'::regprocedure ELSE 'prima.rc_guard()'::regprocedure END exact_function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='prima' AND NOT t.tgisinternal AND (c.relname=ANY($1) OR (c.relname='it_rental_bills' AND t.tgname='rental_original_payment_guard'))`, [tables]);
        tr.rows = tr.rows.filter(r => r.tgname !== 'ic_operational_guard');
        if (tr.rows.length !== 6 || [...tables, 'it_rental_bills'].some(t => tr.rows.filter(r => r.relname === t).length !== 1) || tr.rows.some(r => !r.exact_function || r.tgenabled !== 'O' || r.tgname !== (r.relname === 'it_rental_bills' ? 'rental_original_payment_guard' : 'rc_guard') || r.tgtype !== (r.relname === 'it_rental_bills' ? 19 : 31)))
            return ['RENTAL_CORRECTION_TRIGGER_BOUNDARY'];
        const cols = await client.query(`SELECT c.relname,a.attname,a.atttypid::regtype::text type,a.attnotnull FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND a.attnum>0 AND NOT a.attisdropped`, [tables]);
        if (cols.rows.length !== 10 || tables.some(t => { const a = cols.rows.filter(r => r.relname === t); return a.length !== 2 || !a.some(r => r.attname === 'id' && r.type === 'text' && r.attnotnull) || !a.some(r => r.attname === 'data' && r.type === 'jsonb' && r.attnotnull); }))
            return ['RENTAL_CORRECTION_COLUMN_BOUNDARY'];
        const keys = await client.query(`SELECT c.relname,k.convalidated,pg_get_constraintdef(k.oid) definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND c.relname=ANY($1) AND k.contype='p'`, [tables]);
        if (keys.rows.length !== 5 || tables.some(t => keys.rows.filter(r => r.relname === t && r.convalidated && norm(r.definition) === norm('PRIMARY KEY(id)')).length !== 1))
            return ['RENTAL_CORRECTION_IDENTITY_BOUNDARY'];
        const ix = await client.query(`SELECT c.relname,i.relname name,x.indisunique,x.indisvalid,pg_get_indexdef(i.oid) definition FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class c ON c.oid=x.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='prima' AND i.relname=ANY($1)`, [['rental_review_revision', 'rental_replacement_original', 'rental_replacement_request', 'rental_payment_replacement']]);
        const expected = { rental_review_revision: "CREATE UNIQUE INDEX rental_review_revision ON prima.it_rental_correction_reviews USING btree ((data ->> 'requestId'::text), (((data ->> 'revision'::text))::bigint))", rental_replacement_original: "CREATE UNIQUE INDEX rental_replacement_original ON prima.it_rental_replacements USING btree ((data ->> 'originalId'::text))", rental_replacement_request: "CREATE UNIQUE INDEX rental_replacement_request ON prima.it_rental_replacements USING btree ((data ->> 'requestId'::text))", rental_payment_replacement: "CREATE UNIQUE INDEX rental_payment_replacement ON prima.it_rental_replacement_payments USING btree ((data ->> 'replacementId'::text))" };
        if (ix.rows.length !== 4 || ix.rows.some(r => !r.indisunique || !r.indisvalid || norm(r.definition) !== norm(expected[r.name])))
            return ['RENTAL_CORRECTION_UNIQUENESS_BOUNDARY'];
        return [];
    }
    catch {
        return ['RENTAL_CORRECTION_SCHEMA_UNAVAILABLE'];
    }
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.expectedApiLogin = expectedApiLogin;
exports.assertRestrictedLogin = assertRestrictedLogin;
function expectedApiLogin(env = process.env) {
    return env.PRIMA_API_DB_USER || 'prima_api';
}
async function assertRestrictedLogin(pool, env = process.env) {
    const r = await pool.query(`SELECT current_user AS who, r.rolsuper, r.rolbypassrls, r.rolcreaterole, r.rolcreatedb,
            has_schema_privilege(current_user, 'prima', 'CREATE') AS can_create,
            EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'prima' AND pg_has_role(current_user, n.nspowner, 'USAGE')) AS owns
       FROM pg_roles r WHERE r.rolname = current_user`);
    const row = r.rows[0];
    const want = expectedApiLogin(env);
    if (!row)
        throw new Error('The API could not read its own database login.');
    if (row.who !== want)
        throw new Error(`The API must connect as ${want}, not ${row.who}. Check DATABASE_URL.`);
    if (row.rolsuper || row.rolbypassrls || row.rolcreaterole || row.rolcreatedb || row.can_create || row.owns)
        throw new Error(`The database login ${row.who} has more rights than the API may hold. Run the database setup job again.`);
}

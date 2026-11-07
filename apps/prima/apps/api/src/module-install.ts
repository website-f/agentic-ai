/** Explicit operator command only. Never imported by startup, never resets/reseeds/changes credentials. */
import {Pool,type PoolClient} from 'pg';
import {selectedModuleSql,releaseArtifact,type ReleaseModuleId} from './release-artifact';
import {moduleCatalogProblems} from './release-catalog';
import {itManualProblems} from './it-manual-readiness';
import {itOperationsProblems} from './it-operations-readiness';
// Presence markers: tables (LIKE patterns), a function/trigger name prefix, and policy names (the Central Admin walls
// module adds policies only, so a policy is its only marker).
const PREFIX:Record<ReleaseModuleId,{tables:string[];functions:string|null;policies?:string[]}>= {
 procurement:{tables:['it_procurement_%','it_purchase_finance_authorities'],functions:'ip_'},
 rental_corrections:{tables:['it_rental_correction_%','it_rental_replacement%'],functions:'rc_'},
 cleanup:{tables:['it_cleanup_%'],functions:'ic_'},metrics:{tables:['it_metric_%'],functions:'wm_'},
 job_email:{tables:['job_email_%'],functions:'job_email_'},
 central_admin_walls:{tables:[],functions:null,policies:['central_admin_wall']},
 central_admin_panel:{tables:['panel_firms'],functions:null,policies:['panel_firms_wall']},
 central_admin_delegations:{tables:['delegations','critical_roles'],functions:null,policies:['delegations_wall','critical_roles_wall']},
 central_admin_legal_holds:{tables:['legal_holds','legal_hold_versions'],functions:'lh_',policies:['legal_holds_add','legal_holds_change','legal_hold_versions_read']},
 company_office:{tables:['company_desks'],functions:null},
 company_run_links:{tables:['company_run_links'],functions:null},
 org_links:{tables:['org_events','org_tasks','org_notices','org_imports'],functions:'org_'},
 fw_welfare:{tables:['fw_welfare_checks'],functions:null},
 pay_formulas:{tables:['pay_formulas','pay_formula_uses','pay_law_versions','site_hours_approvals','public_holiday_lists'],functions:null},
 guard_pay:{tables:['guard_pay_runs','guard_pay_advances','guard_loans','statutory_versions'],functions:null},
 fw_recruit:{tables:['fw_recruit_files'],functions:null},
 item_register:{tables:['item_skus','item_units','item_lots','item_events','item_movements','item_cases','item_counts','item_sync_jobs','item_requests','item_settings','item_docs','item_uniform_records'],functions:'item_'},
 item_register_v2:{tables:['item_label_prints','item_sql_books','item_sync_batches','item_sql_snapshots','item_counters','item_scan_denials'],functions:null},
 special_ops:{tables:[],functions:null,policies:['arms_wall']},
};
type Client=Pick<PoolClient,'query'>;
const asApp=async<T>(c:Client,fn:()=>Promise<T>)=>{await c.query('SET LOCAL ROLE prima_app');try{return await fn();}finally{await c.query('RESET ROLE');}};
/** The pinned scripts have one outer transaction. Keep all DDL and postchecks in our single transaction. */
export function moduleBody(sql:string){const m=/^\s*(?:--[^\n]*\n\s*)*BEGIN;([\s\S]*)\bCOMMIT;\s*$/.exec(sql);if(!m)throw Error('Reviewed transactional module required.');return m[1];}
export async function installSelectedModule(c:Client,input:{id:ReleaseModuleId;releaseSha256:string;moduleSha256:string;confirm:string},root?:string){
 const s=selectedModuleSql(input.id,root);if(input.confirm!=='INSTALL_SELECTED_MODULE'||input.releaseSha256!==s.artifact.sha256||input.moduleSha256!==s.module.sha256)throw Error('Exact selected module and release confirmation required.');
 let begun=false;
 try{
  await c.query('BEGIN');begun=true;await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='60s'");await c.query("SELECT pg_advisory_xact_lock(hashtext('prima-reviewed-module-install'))");
  const owner=await c.query("SELECT current_user=session_user AND NOT r.rolsuper AND NOT r.rolbypassrls AND n.nspowner=r.oid AND current_user<>'prima_app' AND pg_has_role(session_user,'prima_app','MEMBER') AS allowed FROM pg_roles r JOIN pg_namespace n ON n.nspname='prima' WHERE r.rolname=current_user");
  if(owner.rows.length!==1||owner.rows[0].allowed!==true)throw Error('Existing isolated schema owner required; no permissions were granted.');
  const base=await c.query('SELECT migration_sha256 FROM prima.schema_info WHERE id=1');if(base.rows.length!==1||base.rows[0].migration_sha256!==s.artifact.manifest.base.sha256)throw Error('Exact base schema prerequisite is not met.');
  const p=PREFIX[input.id];const present=await c.query("SELECT EXISTS(SELECT 1 FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='prima' AND t.relname LIKE ANY($1::text[])) OR EXISTS(SELECT 1 FROM pg_proc f JOIN pg_namespace n ON n.oid=f.pronamespace WHERE n.nspname='prima' AND starts_with(f.proname,$2)) OR EXISTS(SELECT 1 FROM pg_trigger t WHERE starts_with(t.tgname,$2)) OR EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class t ON t.oid=p.polrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='prima' AND p.polname=ANY($3::text[])) AS present",[p.tables,p.functions,p.policies??[]]);
  if(present.rows.length!==1||typeof present.rows[0].present!=='boolean')throw Error('Module presence could not be verified.');
  if(present.rows[0].present){if((await asApp(c,()=>moduleCatalogProblems(c,input.id))).length)throw Error('Partial or drifted module requires separately reviewed recovery; replay refused.');await c.query('ROLLBACK');begun=false;return {module:input.id,status:'already_installed',catalogVerified:true,releaseSha256:s.artifact.sha256};}
  const prereq=await asApp(c,async()=>[...await itManualProblems(c),...await itOperationsProblems(c),...(await Promise.all(s.module.requires.map(id=>moduleCatalogProblems(c,id as ReleaseModuleId)))).flat()]);if(prereq.length)throw Error('Module prerequisites are not catalog verified.');
  await c.query(moduleBody(s.sql));
  if((await asApp(c,()=>moduleCatalogProblems(c,input.id))).length)throw Error('Installed module failed catalog verification.');
  await c.query('COMMIT');begun=false;return {module:input.id,status:'installed',catalogVerified:true,releaseSha256:s.artifact.sha256};
 }catch{if(begun)await c.query('ROLLBACK').catch(()=>undefined);throw Error('Selected module installation outcome is unconfirmed; inspect exact catalog before any retry.');}
}
async function main(){const a=releaseArtifact();if(process.argv.length===2){console.log(JSON.stringify({mode:'plan_only',releaseSha256:a.sha256,manifest:a.manifest}));return;}
 const args=process.argv.slice(2);if(args.length!==8||args[0]!=='--module'||args[2]!=='--release-sha'||args[4]!=='--module-sha'||args[6]!=='--confirm')throw Error('Use explicit module, release-sha, module-sha and confirmation.');if(!process.env.DATABASE_URL)throw Error('Existing operator database connection is required.');const pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:10000});const c=await pool.connect();try{console.log(JSON.stringify(await installSelectedModule(c,{id:args[1] as ReleaseModuleId,releaseSha256:args[3],moduleSha256:args[5],confirm:args[7]})));}catch(error){c.release(error as Error);await pool.end();throw error;}c.release();await pool.end();}
if(require.main===module)main().catch(()=>{console.error('Module operation refused or incomplete. No automatic retry; use read-only release verification.');process.exitCode=1;});

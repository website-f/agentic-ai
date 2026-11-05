-- NEW controlled recoverable cleanup reconstruction. Install LAST by explicit reviewed migration only.
BEGIN;
DO $$ BEGIN
 IF to_regclass('prima.it_procurement_packets') IS NULL OR to_regclass('prima.it_rental_replacements') IS NULL THEN RAISE EXCEPTION 'Actual procurement and rental modules required before cleanup'; END IF;
END $$;
CREATE TABLE prima.it_cleanup_nominations(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_cleanup_archives(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_cleanup_receipts(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_cleanup_plan_bindings(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE OR REPLACE FUNCTION prima.ic_hash(d jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 WITH RECURSIVE nodes(v,path,prefix) AS (
 SELECT d,ARRAY[]::integer[],''::text UNION ALL
 SELECT child.v,n.path||child.ord::integer,(CASE WHEN child.ord>1 THEN ',' ELSE '' END)||coalesce(to_jsonb(child.k)::text||':','')
 FROM nodes n CROSS JOIN LATERAL (
 SELECT value v,key k,row_number() OVER(ORDER BY key COLLATE "C") ord FROM jsonb_each(CASE WHEN jsonb_typeof(n.v)='object' THEN n.v ELSE '{}'::jsonb END)
 UNION ALL SELECT value,NULL::text,ord FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.v)='array' THEN n.v ELSE '[]'::jsonb END) WITH ORDINALITY a(value,ord)
 ) child), tokens AS (
 SELECT path||0 path,prefix||CASE jsonb_typeof(v) WHEN 'object' THEN '{' WHEN 'array' THEN '[' ELSE v::text END token FROM nodes
 UNION ALL SELECT path||2147483647,CASE jsonb_typeof(v) WHEN 'object' THEN '}' ELSE ']' END FROM nodes WHERE jsonb_typeof(v) IN ('object','array'))
 SELECT encode(sha256(convert_to(string_agg(token,'' ORDER BY path),'UTF8')),'hex') FROM tokens
$$;
CREATE FUNCTION prima.ic_shape(d jsonb,keys text[],strings text[],numbers text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(jsonb_typeof(d)='object' AND d ?& keys AND (SELECT count(*) FROM jsonb_object_keys(d))=cardinality(keys)
 AND NOT EXISTS(SELECT 1 FROM unnest(strings) k WHERE jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR d->>k IS DISTINCT FROM btrim(d->>k) OR d->>k ~ '[[:cntrl:]]')
 AND NOT EXISTS(SELECT 1 FROM unnest(numbers) k WHERE jsonb_typeof(d->k) IS DISTINCT FROM 'number'),false)
$$;
CREATE FUNCTION prima.ic_actor(uid text,lead boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(u.data->>'role'='pwvsb_officer' AND u.data->>'department'='it' AND u.data->>'itRole'=ANY(CASE WHEN lead THEN ARRAY['lead'] ELSE ARRAY['manager','lead','executive'] END)
 AND coalesce(u.data->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb) AND (coalesce(u.data->>'accessClosedFrom','')='' OR u.data->>'accessClosedFrom'>to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))),false) FROM prima.users u WHERE u.id=uid
$$;
CREATE FUNCTION prima.ic_scope(uid text,company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(EXISTS(SELECT 1 FROM prima.users u WHERE u.id=uid AND prima.ic_actor(uid,false) AND u.data->'companyIds' ? company AND (company IN ('pwvsb','merdeka','goodwill','sasateam') OR EXISTS(SELECT 1 FROM prima.companies c WHERE c.id=company))),false)
$$;
CREATE FUNCTION prima.ic_root(kind text,rid text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb;
BEGIN
 CASE kind WHEN 'asset' THEN SELECT data INTO d FROM prima.it_assets WHERE id=rid; WHEN 'system' THEN SELECT data INTO d FROM prima.it_accounts WHERE id=rid; WHEN 'intake' THEN SELECT data INTO d FROM prima.it_onboarding WHERE id=rid; ELSE RETURN NULL; END CASE;
 RETURN d;
END
$$;
CREATE FUNCTION prima.ic_company(kind text,d jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 SELECT CASE WHEN kind='system' THEN d#>>'{manual,companyId}' WHEN kind IN ('asset','intake') AND d->>'ownerId'=d#>>'{manual,companyId}' THEN d->>'ownerId' ELSE NULL END
$$;
CREATE FUNCTION prima.ic_eligible(kind text,d jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE allowed text[]; m jsonb:=d->'manual';
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(m) IS DISTINCT FROM 'object' OR m->>'kind' IS DISTINCT FROM (CASE WHEN kind='asset' THEN 'asset' WHEN kind='system' THEN 'system' WHEN kind='intake' THEN 'intake' ELSE '' END)
 OR coalesce(m->>'jobId','')<>'' OR m->>'connection' IS DISTINCT FROM 'not_connected' OR jsonb_typeof(m->'createdById') IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM prima.users WHERE id=m->>'createdById') OR prima.ic_company(kind,d) IS NULL THEN RETURN false; END IF;
 IF kind='asset' THEN
  allowed:=ARRAY['id','tag','kind','model','serial','ownerId','assignedTo','location','boughtOn','warrantyTo','status','lastCheckedOn','purchaseId','maintenance','nextServiceOn','disposal','manual','correction'];
  IF d->>'status' IS DISTINCT FROM 'spare' OR d->'assignedTo' IS DISTINCT FROM 'null'::jsonb OR coalesce(d->'purchaseId','null'::jsonb) IS DISTINCT FROM 'null'::jsonb OR coalesce(d->'maintenance','[]'::jsonb) IS DISTINCT FROM '[]'::jsonb OR coalesce(d->'disposal','null'::jsonb) IS DISTINCT FROM 'null'::jsonb OR d->'lastCheckedOn' IS DISTINCT FROM 'null'::jsonb THEN RETURN false; END IF;
 ELSIF kind='system' THEN
  allowed:=ARRAY['id','name','kind','ownerId','owner','masterKeptAt','mfa','access','reviewedOn','note','manual','correction'];
  IF d->'access' IS DISTINCT FROM '[]'::jsonb OR d->'reviewedOn' IS DISTINCT FROM 'null'::jsonb OR d->'mfa' IS DISTINCT FROM 'null'::jsonb OR d->>'masterKeptAt' IS DISTINCT FROM '' THEN RETURN false; END IF;
 ELSIF kind='intake' THEN
  allowed:=ARRAY['id','kind','personName','jobTitle','ownerId','on','steps','ownerStaffId','manual','correction'];
  IF coalesce(m->'personUserId','null'::jsonb) IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(d->'steps') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(d->'steps') s WHERE s->'doneAt' IS DISTINCT FROM 'null'::jsonb OR coalesce(s->'evidenceRef','null'::jsonb) IS DISTINCT FROM 'null'::jsonb OR coalesce(s->'reopenReason','null'::jsonb) IS DISTINCT FROM 'null'::jsonb OR coalesce(s->>'by','')<>'' OR coalesce(s->>'byId','')<>'' OR coalesce(s->>'changedAt','')<>'' OR coalesce(s->>'changedById','')<>'' OR coalesce(s->'version','0'::jsonb) IS DISTINCT FROM '0'::jsonb) THEN RETURN false; END IF;
 ELSE RETURN false;
 END IF;
 RETURN NOT EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE NOT k=ANY(allowed));
END
$$;
CREATE FUNCTION prima.ic_unscoped_archived(kind text,rid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(EXISTS(SELECT 1 FROM prima.it_cleanup_archives WHERE id=kind||':'||rid AND data->'archived'='true'::jsonb),false)
$$;
CREATE FUNCTION prima.ic_archived(kind text,rid text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
BEGIN
 -- Boolean projection only for the caller's established root-reader role; no snapshot or hidden payload.
 IF kind NOT IN ('asset','system','intake') OR NOT prima.it_record_permission(CASE WHEN kind='asset' THEN 'asset_read' ELSE 'read' END) THEN RETURN false; END IF;
 RETURN prima.ic_unscoped_archived(kind,rid);
END
$$;
CREATE FUNCTION prima.ic_dependencies_tables() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 SELECT ARRAY['it_assets','it_accounts','it_onboarding','it_purchases','it_procurement_packets','it_asset_inspections','it_rental_bills','it_rental_correction_requests','it_rental_replacements','it_access_requests','it_jobs','it_tickets','it_import_reviews']::text[]
$$;
CREATE FUNCTION prima.ic_visibility_ok() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE t text; c record; ownerid oid; selfid oid;
BEGIN
 SELECT oid INTO selfid FROM pg_roles WHERE rolname=current_user;
 IF selfid IS NULL OR pg_has_role('prima_app',selfid,'USAGE') THEN RETURN false; END IF;
 FOREACH t IN ARRAY prima.ic_dependencies_tables()||ARRAY['it_cleanup_nominations','it_cleanup_archives','it_cleanup_receipts','it_cleanup_plan_bindings','users'] LOOP
  SELECT pc.oid,pc.relowner,pc.relrowsecurity,pc.relforcerowsecurity,pc.relkind INTO c FROM pg_class pc JOIN pg_namespace ns ON ns.oid=pc.relnamespace WHERE ns.nspname='prima' AND pc.relname=t;
  IF NOT FOUND OR c.relkind<>'r' OR c.relowner<>selfid OR NOT has_table_privilege(selfid,c.oid,'SELECT') OR (SELECT count(*) FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)<>2 OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=c.oid AND attname='id' AND atttypid='text'::regtype AND attnotnull) OR NOT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=c.oid AND attname='data' AND atttypid='jsonb'::regtype AND attnotnull) THEN RETURN false; END IF;
  IF c.relrowsecurity THEN
   IF NOT c.relforcerowsecurity OR NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polpermissive AND p.polcmd IN ('*','r') AND pg_get_expr(p.polqual,p.polrelid)='true' AND EXISTS(SELECT 1 FROM unnest(p.polroles) pr WHERE pr=0 OR pg_has_role(selfid,pr,'USAGE')))
   OR EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND NOT p.polpermissive AND p.polcmd IN ('*','r') AND EXISTS(SELECT 1 FROM unnest(p.polroles) pr WHERE pr=0 OR pg_has_role(selfid,pr,'USAGE'))) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
END
$$;
CREATE FUNCTION prima.ic_references(kind text,rid text,root jsonb,table_name text,d jsonb,physical_id text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE path text:=coalesce(d->>'planKey',''); ownerid text:=root->>'ownerId'; tag text:=root->>'tag';
BEGIN
 IF jsonb_path_exists(d,'$.** ? (@ == $rid)',jsonb_build_object('rid',rid)) THEN RETURN true; END IF;
 IF table_name IN ('it_jobs','it_tickets','it_import_reviews') THEN
  IF position(rid IN d::text)>0 THEN RETURN true; END IF;
  IF kind='system' AND starts_with(path,'access:'||rid||':') THEN RETURN true; END IF;
  -- Group plans refer to company/month and tags, not individual asset IDs. Conservative history HOLD.
  IF kind='asset' AND (((starts_with(path,'inspection:'||ownerid||':') OR starts_with(path,'service:'||ownerid||':')) AND NOT EXISTS(SELECT 1 FROM prima.it_cleanup_plan_bindings b WHERE table_name='it_jobs' AND b.id=physical_id AND d->>'id'=physical_id AND b.data->>'planKey'=path AND b.data->>'refsHash'=prima.ic_hash(d->'planAssetRefs'))) OR (coalesce(tag,'')<>'' AND position(tag IN d::text)>0)) THEN RETURN true; END IF;
 END IF;
 RETURN false;
END
$$;
CREATE FUNCTION prima.ic_clear(kind text,rid text,root jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE t text; foundref boolean;
BEGIN
 IF NOT prima.ic_visibility_ok() THEN RETURN false; END IF;
 FOREACH t IN ARRAY prima.ic_dependencies_tables() LOOP
  -- Root's own immutable payload is not a dependency on itself. All other rows, including archived history, count.
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM prima.%I WHERE NOT (id=$2 AND $4=$5) AND prima.ic_references($1,$2,$3,$4,data,id))',t)
   INTO foundref USING kind,rid,root,t,CASE kind WHEN 'asset' THEN 'it_assets' WHEN 'system' THEN 'it_accounts' WHEN 'intake' THEN 'it_onboarding' ELSE '' END;
  IF foundref THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END
$$;
CREATE FUNCTION prima.ic_dependencies(kind text,rid text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb:=prima.ic_root(kind,rid);
BEGIN
 IF d IS NULL OR NOT prima.ic_scope(current_setting('app.user_id',true),prima.ic_company(kind,d)) THEN RETURN jsonb_build_object('complete',false,'reasons',jsonb_build_array('CURRENT_SCOPE_REQUIRED')); END IF;
 IF NOT prima.ic_visibility_ok() THEN RETURN jsonb_build_object('complete',false,'reasons',jsonb_build_array('DEPENDENCY_COVERAGE_UNKNOWN')); END IF;
 RETURN jsonb_build_object('complete',true,'reasons',CASE WHEN prima.ic_clear(kind,rid,d) THEN '[]'::jsonb ELSE '["PROTECTED_DEPENDENCY_OR_AMBIGUOUS_REFERENCE"]'::jsonb END);
END
$$;
-- Every operational writer shares this same lock, closing archive-vs-new-reference races.
CREATE FUNCTION prima.ic_operational_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE a jsonb; rootkind text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 IF NOT prima.ic_visibility_ok() THEN RAISE EXCEPTION 'Cleanup dependency visibility requires review' USING ERRCODE='23514'; END IF;
 rootkind:=CASE TG_TABLE_NAME WHEN 'it_assets' THEN 'asset' WHEN 'it_accounts' THEN 'system' WHEN 'it_onboarding' THEN 'intake' ELSE NULL END;
 IF rootkind IS NOT NULL AND TG_OP IN ('UPDATE','DELETE') AND prima.ic_unscoped_archived(rootkind,OLD.id) THEN RAISE EXCEPTION 'Archived record is retained and cannot be changed' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 FOR a IN SELECT data FROM prima.it_cleanup_archives WHERE data->'archived'='true'::jsonb LOOP
  IF (rootkind=a->>'kind' AND NEW.id=a->>'recordId') OR prima.ic_references(a->>'kind',a->>'recordId',a->'snapshot',TG_TABLE_NAME,NEW.data,NEW.id) THEN RAISE EXCEPTION 'Operational write references archived record' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END
$$;

CREATE FUNCTION prima.ic_admit_plan_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE company text; expected jsonb; refs jsonb; day text;
BEGIN
 IF NEW.data->>'id' IS DISTINCT FROM NEW.id OR (TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id) THEN RAISE EXCEPTION 'Job physical and JSON identity must remain exact' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 IF TG_OP='UPDATE' THEN
  IF NEW.data->'planAssetRefs' IS DISTINCT FROM OLD.data->'planAssetRefs' OR NEW.data->'planKey' IS DISTINCT FROM OLD.data->'planKey' THEN RAISE EXCEPTION 'Plan inventory proof is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF coalesce(NEW.data->>'planKey','') !~ '^(inspection|service):[^:]+:[0-9]{4}-[0-9]{2}$' THEN
  IF NEW.data ? 'planAssetRefs' OR starts_with(coalesce(NEW.data->>'planKey',''),'inspection:') OR starts_with(coalesce(NEW.data->>'planKey',''),'service:') THEN RAISE EXCEPTION 'Unexpected inventory proof' USING ERRCODE='23514'; END IF; RETURN NEW;
 END IF;
 IF NOT prima.ic_visibility_ok() THEN RAISE EXCEPTION 'Inventory visibility incomplete' USING ERRCODE='23514'; END IF;
 IF abs(extract(epoch FROM (NEW.data->>'at')::timestamptz-statement_timestamp()))>300 OR NEW.data->>'at' IS NULL THEN RAISE EXCEPTION 'Plan admission must use current server recording time' USING ERRCODE='23514'; END IF;
 company:=split_part(NEW.data->>'planKey',':',2); day:=to_char((NEW.data->>'at')::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD');
 PERFORM 1 FROM prima.it_assets WHERE data->>'ownerId'=company ORDER BY id FOR SHARE;
 SELECT jsonb_build_object('asOf',day,'assets',coalesce(jsonb_agg(jsonb_build_object('id',a.id,'hash',prima.ic_hash(a.data)) ORDER BY a.id COLLATE "C"),'[]'::jsonb)) INTO expected
 FROM prima.it_assets a WHERE a.data->>'ownerId'=company AND a.data->>'status' NOT IN ('disposed','disposal_pending') AND NOT prima.ic_unscoped_archived('asset',a.id);
 IF company='' OR split_part(NEW.data->>'planKey',':',3) !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' OR day IS NULL OR day !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR jsonb_array_length(expected->'assets')=0 OR NEW.data->'planAssetRefs' IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Exact current protective inventory snapshot required' USING ERRCODE='23514'; END IF;
 INSERT INTO prima.it_cleanup_plan_bindings(id,data) VALUES(NEW.id,jsonb_build_object('id',NEW.id,'planKey',NEW.data->>'planKey','refsHash',prima.ic_hash(expected)));
 RETURN NEW;
END
$$;
CREATE FUNCTION prima.ic_recovery_actor(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(data->>'role' IS NOT NULL AND data->>'role'<>'site_device' AND coalesce(data->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb) AND (coalesce(data->>'accessClosedFrom','')='' OR data->>'accessClosedFrom'>to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))),false) FROM prima.users WHERE id=uid
$$;
CREATE FUNCTION prima.ic_source_known(kind text,d jsonb,uid text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE allowed text[]; roletext text;
BEGIN
 IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(d->'manual') IS DISTINCT FROM 'object' OR d#>>'{manual,kind}' IS DISTINCT FROM kind OR prima.ic_company(kind,d) IS NULL OR NOT EXISTS(SELECT 1 FROM prima.users WHERE id=d#>>'{manual,createdById}') THEN RETURN false; END IF;
 allowed:=CASE kind WHEN 'asset' THEN ARRAY['id','tag','kind','model','serial','ownerId','assignedTo','location','boughtOn','warrantyTo','status','lastCheckedOn','purchaseId','maintenance','nextServiceOn','disposal','manual','correction'] WHEN 'system' THEN ARRAY['id','name','kind','ownerId','owner','masterKeptAt','mfa','access','reviewedOn','note','manual','correction'] WHEN 'intake' THEN ARRAY['id','kind','personName','jobTitle','ownerId','on','steps','ownerStaffId','manual','correction'] ELSE ARRAY[]::text[] END;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(d) k WHERE NOT k=ANY(allowed)) THEN RETURN false; END IF;
 SELECT data->>'itRole' INTO roletext FROM prima.users WHERE id=uid;
 RETURN coalesce(roletext<>'executive' OR kind='asset' OR (kind='system' AND d#>>'{manual,createdById}'=uid) OR (kind='intake' AND d->>'ownerStaffId'=uid),false);
END
$$;
CREATE FUNCTION prima.ic_event(e jsonb,uid text) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog, prima AS $$
DECLARE i jsonb; k text;
BEGIN
 IF NOT prima.ic_shape(e,ARRAY['requestId','kind','hash','byId','at','input'],ARRAY['requestId','kind','hash','byId','at'],ARRAY[]::text[]) OR e->>'requestId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR e->>'byId' IS DISTINCT FROM uid OR e->>'at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN RETURN false; END IF;
 IF abs(extract(epoch FROM (e->>'at')::timestamptz-statement_timestamp()))>300 THEN RETURN false; END IF;
 i:=e->'input'; k:=e->>'kind';
 IF i->>'requestId' IS DISTINCT FROM e->>'requestId' OR e->>'hash' IS DISTINCT FROM prima.ic_hash(jsonb_build_object('kind',k,'input',i)) THEN RETURN false; END IF;
 IF k='nominate' THEN RETURN prima.ic_shape(i,ARRAY['requestId','kind','recordId','expectedHash','originSummary','originProof'],ARRAY['requestId','kind','recordId','expectedHash','originSummary','originProof'],ARRAY[]::text[]) AND i->>'kind' IN ('asset','system','intake') AND length(i->>'originSummary') BETWEEN 20 AND 500 AND length(i->>'originProof') BETWEEN 12 AND 1000;
 ELSIF k='decide' THEN RETURN prima.ic_shape(i,ARRAY['requestId','nominationId','expectedVersion','classification','decision','reason','evidenceReviewed'],ARRAY['requestId','nominationId','classification','decision','reason'],ARRAY['expectedVersion']) AND i->>'classification' IN ('unknown','verified_demo','real','mixed') AND i->>'decision' IN ('hold','archive') AND jsonb_typeof(i->'evidenceReviewed')='boolean' AND length(i->>'reason') BETWEEN 3 AND 500;
 ELSIF k='restore' THEN RETURN prima.ic_shape(i,ARRAY['requestId','nominationId','expectedVersion','expectedArchiveVersion','expectedHash','reason'],ARRAY['requestId','nominationId','expectedHash','reason'],ARRAY['expectedVersion','expectedArchiveVersion']) AND length(i->>'reason') BETWEEN 3 AND 500;
 END IF; RETURN false;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END
$$;
CREATE FUNCTION prima.ic_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb:=NEW.data; o jsonb; e jsonb; i jsonb; n jsonb; root jsonb; uid text:=current_setting('app.user_id',true); a jsonb; ev jsonb; cnt integer; newversion integer; action text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 PERFORM 1 FROM prima.users WHERE id=uid FOR SHARE;
 IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM d->>'id' OR NOT prima.ic_visibility_ok() THEN RAISE EXCEPTION 'Cleanup storage invariant' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN o:=OLD.data; END IF;
 IF TG_TABLE_NAME='it_cleanup_receipts' THEN
  IF TG_OP<>'INSERT' OR NOT prima.ic_recovery_actor(uid) OR NOT prima.ic_shape(d,ARRAY['id','userId','requestId','kind','hash','outcome','recordId','version','message','at'],ARRAY['id','userId','requestId','kind','hash','outcome','at'],ARRAY[]::text[]) OR d->>'userId' IS DISTINCT FROM uid OR NEW.id IS DISTINCT FROM uid||':'||(d->>'requestId') OR d->>'requestId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR d->>'kind' NOT IN ('nominate','decide','restore') OR d->>'at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' OR abs(extract(epoch FROM (d->>'at')::timestamptz-statement_timestamp()))>300 THEN RAISE EXCEPTION 'Invalid own recovery receipt' USING ERRCODE='23514'; END IF;
  SELECT nn.data,ee.value INTO n,e FROM prima.it_cleanup_nominations nn CROSS JOIN LATERAL jsonb_array_elements(nn.data->'history') ee(value) WHERE ee.value->>'byId'=uid AND ee.value->>'requestId'=d->>'requestId';
  IF d->>'outcome'='committed' THEN
   IF n IS NULL OR e->>'kind' IS DISTINCT FROM d->>'kind' OR e->>'hash' IS DISTINCT FROM d->>'hash' OR e->>'at' IS DISTINCT FROM d->>'at' OR d->'message' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(d->'recordId') IS DISTINCT FROM 'string' OR d->>'recordId' IS DISTINCT FROM n->>'id' OR jsonb_typeof(d->'version') IS DISTINCT FROM 'number' OR d->'version' IS DISTINCT FROM n->'version' OR e IS DISTINCT FROM n->'history'->-1 THEN RAISE EXCEPTION 'Receipt must bind the committed domain event' USING ERRCODE='23514'; END IF;
  ELSIF d->>'outcome'='rejected' THEN
   IF n IS NOT NULL OR d->'recordId' IS DISTINCT FROM 'null'::jsonb OR d->'version' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(d->'message') IS DISTINCT FROM 'string' OR length(d->>'message') NOT BETWEEN 3 AND 1000 OR (d->>'hash'<>'abandoned' AND d->>'hash' !~ '^[a-f0-9]{64}$') OR (d->>'hash'='abandoned' AND d->>'message'<>'Request safely cancelled before any committed cleanup outcome.') OR (d->>'hash'<>'abandoned' AND NOT prima.ic_actor(uid,false)) THEN RAISE EXCEPTION 'Rejected receipt cannot conceal an event' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid receipt outcome' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT prima.ic_actor(uid,false) THEN RAISE EXCEPTION 'Current IT actor required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='it_cleanup_archives' THEN
  IF NOT prima.ic_shape(d,ARRAY['id','kind','recordId','companyId','nominationId','recordHash','version','archived','snapshot','history'],ARRAY['id','kind','recordId','companyId','nominationId','recordHash'],ARRAY['version']) OR jsonb_typeof(d->'archived') IS DISTINCT FROM 'boolean' OR jsonb_typeof(d->'snapshot') IS DISTINCT FROM 'object' OR jsonb_typeof(d->'history') IS DISTINCT FROM 'array' OR NEW.id IS DISTINCT FROM (d->>'kind')||':'||(d->>'recordId') THEN RAISE EXCEPTION 'Invalid archive shape' USING ERRCODE='23514'; END IF;
  SELECT data INTO n FROM prima.it_cleanup_nominations WHERE id=d->>'nominationId'; e:=d->'history'->-1;
  IF n IS NULL OR e IS DISTINCT FROM n->'history'->-1 OR NOT prima.ic_event(e,uid) OR NOT prima.ic_scope(uid,d->>'companyId') OR NOT prima.ic_actor(uid,true) OR d->>'kind' IS DISTINCT FROM n->>'kind' OR d->>'recordId' IS DISTINCT FROM n->>'recordId' OR d->>'companyId' IS DISTINCT FROM n->>'companyId' OR d->>'recordHash' IS DISTINCT FROM n->>'recordHash' OR prima.ic_hash(d->'snapshot') IS DISTINCT FROM d->>'recordHash' OR d->'snapshot' IS DISTINCT FROM prima.ic_root(d->>'kind',d->>'recordId') OR d->'archived' IS DISTINCT FROM to_jsonb(n->>'status'='archived') OR n->>'status' NOT IN ('archived','restored') THEN RAISE EXCEPTION 'Archive must follow exact reviewed nomination' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF d->'version'<>'1'::jsonb OR d->'archived'<>'true'::jsonb OR d->'history'<>jsonb_build_array(e) THEN RAISE EXCEPTION 'Invalid first archive' USING ERRCODE='23514'; END IF;
  ELSE
   IF d-'version'-'archived'-'history'-'nominationId' IS DISTINCT FROM o-'version'-'archived'-'history'-'nominationId' OR d->'version' IS DISTINCT FROM to_jsonb((o->>'version')::integer+1) OR d->'archived' IS NOT DISTINCT FROM o->'archived' OR d->'history' IS DISTINCT FROM (o->'history')||jsonb_build_array(e) OR (d->'archived'='false'::jsonb AND d->>'nominationId' IS DISTINCT FROM o->>'nominationId') THEN RAISE EXCEPTION 'Archive history cannot be rewritten' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME<>'it_cleanup_nominations' OR NOT prima.ic_shape(d,ARRAY['id','kind','recordId','companyId','recordHash','creatorId','originSummary','originProof','nominatedById','at','version','status','classification','decision','history'],ARRAY['id','kind','recordId','companyId','recordHash','creatorId','originSummary','originProof','nominatedById','at','status','classification'],ARRAY['version']) OR jsonb_typeof(d->'history') IS DISTINCT FROM 'array' OR d->>'id' !~ '^cleanup:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR d->>'kind' NOT IN ('asset','system','intake') THEN RAISE EXCEPTION 'Invalid nomination shape' USING ERRCODE='23514'; END IF;
 e:=d->'history'->-1; i:=e->'input'; action:=e->>'kind'; root:=prima.ic_root(d->>'kind',d->>'recordId');
 IF NOT prima.ic_event(e,uid) OR NOT prima.ic_scope(uid,d->>'companyId') OR root IS NULL OR d->>'companyId' IS DISTINCT FROM prima.ic_company(d->>'kind',root) OR d->>'recordHash' IS DISTINCT FROM prima.ic_hash(root) OR d->>'creatorId' IS DISTINCT FROM root#>>'{manual,createdById}' OR EXISTS(SELECT 1 FROM prima.it_cleanup_receipts WHERE id=uid||':'||(e->>'requestId')) OR EXISTS(SELECT 1 FROM prima.it_cleanup_nominations nn CROSS JOIN LATERAL jsonb_array_elements(nn.data->'history') ee WHERE ee->>'byId'=uid AND ee->>'requestId'=e->>'requestId') THEN RAISE EXCEPTION 'Current source and unused operation UUID required' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF action<>'nominate' OR NOT prima.ic_source_known(d->>'kind',root,uid) OR d->'version'<>'1'::jsonb OR d->>'status'<>'pending' OR d->>'classification'<>'unknown' OR d->'decision' IS DISTINCT FROM 'null'::jsonb OR d->'history' IS DISTINCT FROM jsonb_build_array(e) OR d->>'nominatedById' IS DISTINCT FROM uid OR d->>'at' IS DISTINCT FROM e->>'at' OR i->>'kind' IS DISTINCT FROM d->>'kind' OR i->>'recordId' IS DISTINCT FROM d->>'recordId' OR i->>'expectedHash' IS DISTINCT FROM d->>'recordHash' OR i->>'originSummary' IS DISTINCT FROM d->>'originSummary' OR i->>'originProof' IS DISTINCT FROM d->>'originProof' OR prima.ic_unscoped_archived(d->>'kind',d->>'recordId') OR EXISTS(SELECT 1 FROM prima.it_cleanup_nominations nn WHERE nn.data->>'kind'=d->>'kind' AND nn.data->>'recordId'=d->>'recordId' AND (nn.data->>'status' IN ('pending','archived') OR nn.data->>'classification' IN ('real','mixed'))) THEN RAISE EXCEPTION 'Nomination admission failed' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT prima.ic_actor(uid,true) OR uid IN (o->>'nominatedById',o->>'creatorId') OR d-'version'-'status'-'classification'-'decision'-'history' IS DISTINCT FROM o-'version'-'status'-'classification'-'decision'-'history' OR d->'version' IS DISTINCT FROM to_jsonb((o->>'version')::integer+1) OR d->'history' IS DISTINCT FROM (o->'history')||jsonb_build_array(e) OR i->>'nominationId' IS DISTINCT FROM NEW.id OR i->'expectedVersion' IS DISTINCT FROM o->'version' THEN RAISE EXCEPTION 'Independent Lead and exact revision required' USING ERRCODE='23514'; END IF;
  IF action='decide' THEN
   IF o->>'status' NOT IN ('pending','held') OR (o->>'classification' IN ('real','mixed') AND d->>'classification' IS DISTINCT FROM o->>'classification') OR d->>'classification' IS DISTINCT FROM i->>'classification' OR d->'decision' IS DISTINCT FROM jsonb_build_object('classification',i->'classification','decision',i->'decision','reason',i->'reason','evidenceReviewed',i->'evidenceReviewed','byId',uid,'at',e->'at') OR d->>'status' IS DISTINCT FROM (CASE WHEN i->>'decision'='archive' THEN 'archived' ELSE 'held' END) THEN RAISE EXCEPTION 'Exact documentary decision required' USING ERRCODE='23514'; END IF;
   IF i->>'decision'='archive' AND (EXISTS(SELECT 1 FROM prima.it_cleanup_nominations nn WHERE nn.id<>NEW.id AND nn.data->>'kind'=d->>'kind' AND nn.data->>'recordId'=d->>'recordId' AND nn.data->>'classification' IN ('real','mixed')) OR i->>'classification'<>'verified_demo' OR i->'evidenceReviewed'<>'true'::jsonb OR NOT prima.ic_eligible(d->>'kind',root) OR NOT prima.ic_clear(d->>'kind',d->>'recordId',root) OR prima.ic_unscoped_archived(d->>'kind',d->>'recordId')) THEN RAISE EXCEPTION 'Archive remains protected' USING ERRCODE='23514'; END IF;
  ELSIF action='restore' THEN
   SELECT data INTO a FROM prima.it_cleanup_archives WHERE id=(d->>'kind')||':'||(d->>'recordId');
   IF o->>'status'<>'archived' OR d->>'status'<>'restored' OR d->'classification' IS DISTINCT FROM o->'classification' OR d->'decision' IS DISTINCT FROM o->'decision' OR a IS NULL OR a->'archived'<>'true'::jsonb OR a->>'nominationId' IS DISTINCT FROM NEW.id OR i->'expectedArchiveVersion' IS DISTINCT FROM a->'version' OR i->>'expectedHash' IS DISTINCT FROM a->>'recordHash' OR NOT prima.ic_clear(d->>'kind',d->>'recordId',root) THEN RAISE EXCEPTION 'Exact active archive required for restore' USING ERRCODE='23514'; END IF;
   IF d->>'kind'='asset' AND EXISTS(SELECT 1 FROM prima.it_assets aa WHERE aa.id<>d->>'recordId' AND (upper(regexp_replace(normalize(aa.data->>'tag',NFKC),'[[:space:]]','','g'))=upper(regexp_replace(normalize(root->>'tag',NFKC),'[[:space:]]','','g')) OR (coalesce(root->>'serial','')<>'' AND upper(regexp_replace(normalize(aa.data->>'serial',NFKC),'[[:space:]]','','g'))=upper(regexp_replace(normalize(root->>'serial',NFKC),'[[:space:]]','','g'))))) THEN RAISE EXCEPTION 'Identifier reservation conflict' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid nomination transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END
$$;
-- Deferred constraints ensure no marker/event can commit without its corresponding terminal receipt.
CREATE FUNCTION prima.ic_terminal_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE e jsonb:=NEW.data->'history'->-1; n jsonb; a jsonb; r jsonb;
BEGIN
 IF TG_TABLE_NAME='it_cleanup_archives' THEN SELECT data INTO n FROM prima.it_cleanup_nominations WHERE id=NEW.data->>'nominationId'; ELSE n:=NEW.data; END IF;
 SELECT data INTO r FROM prima.it_cleanup_receipts WHERE id=(e->>'byId')||':'||(e->>'requestId');
 IF n IS NULL OR r IS NULL OR r->>'outcome'<>'committed' OR r->>'recordId' IS DISTINCT FROM n->>'id' OR r->'version' IS DISTINCT FROM n->'version' OR r->>'hash' IS DISTINCT FROM e->>'hash' OR r->>'kind' IS DISTINCT FROM e->>'kind' THEN RAISE EXCEPTION 'Cleanup outcome lacks exact receipt' USING ERRCODE='23514'; END IF;
 IF n->>'status' IN ('archived','restored') THEN
  SELECT data INTO a FROM prima.it_cleanup_archives WHERE id=(n->>'kind')||':'||(n->>'recordId');
  IF a IS NULL OR a->>'nominationId' IS DISTINCT FROM n->>'id' OR a->'history'->-1 IS DISTINCT FROM e OR a->'archived' IS DISTINCT FROM to_jsonb(n->>'status'='archived') THEN RAISE EXCEPTION 'Cleanup decision lacks exact archive marker' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END
$$;
DO $install$
DECLARE t text; fn record;
BEGIN
 ALTER TABLE prima.it_cleanup_plan_bindings ENABLE ROW LEVEL SECURITY;
 ALTER TABLE prima.it_cleanup_plan_bindings FORCE ROW LEVEL SECURITY;
 EXECUTE format('CREATE POLICY ic_owner ON prima.it_cleanup_plan_bindings FOR ALL TO %I USING(true) WITH CHECK(true)',current_user);
 REVOKE ALL ON prima.it_cleanup_plan_bindings FROM PUBLIC,prima_app;
 FOREACH t IN ARRAY ARRAY['it_cleanup_nominations','it_cleanup_archives','it_cleanup_receipts'] LOOP
  EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY ic_owner ON prima.%I FOR ALL TO %I USING(true) WITH CHECK(true)',t,current_user);
  EXECUTE format('REVOKE ALL ON prima.%I FROM PUBLIC,prima_app',t);
  IF t='it_cleanup_receipts' THEN
   EXECUTE format('GRANT SELECT,INSERT ON prima.%I TO prima_app',t);
   EXECUTE format('CREATE POLICY ic_read ON prima.%I FOR SELECT TO prima_app USING(data->>''userId''=current_setting(''app.user_id'',true) AND prima.ic_recovery_actor(current_setting(''app.user_id'',true)))',t);
   EXECUTE format('CREATE POLICY ic_insert ON prima.%I FOR INSERT TO prima_app WITH CHECK(data->>''userId''=current_setting(''app.user_id'',true) AND prima.ic_recovery_actor(current_setting(''app.user_id'',true)))',t);
  ELSE
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON prima.%I TO prima_app',t);
   EXECUTE format('CREATE POLICY ic_read ON prima.%I FOR SELECT TO prima_app USING(prima.ic_scope(current_setting(''app.user_id'',true),data->>''companyId''))',t);
   EXECUTE format('CREATE POLICY ic_insert ON prima.%I FOR INSERT TO prima_app WITH CHECK(prima.ic_scope(current_setting(''app.user_id'',true),data->>''companyId''))',t);
   EXECUTE format('CREATE POLICY ic_update ON prima.%I FOR UPDATE TO prima_app USING(prima.ic_scope(current_setting(''app.user_id'',true),data->>''companyId'')) WITH CHECK(prima.ic_scope(current_setting(''app.user_id'',true),data->>''companyId''))',t);
   EXECUTE format('CREATE CONSTRAINT TRIGGER ic_terminal AFTER INSERT OR UPDATE ON prima.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION prima.ic_terminal_guard()',t);
  END IF;
  EXECUTE format('CREATE TRIGGER ic_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.ic_guard()',t);
 END LOOP;
 FOREACH t IN ARRAY prima.ic_dependencies_tables() LOOP
  EXECUTE format('CREATE TRIGGER ic_operational_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.ic_operational_guard()',t);
 END LOOP;
 CREATE TRIGGER ic_admit_plan_guard BEFORE INSERT OR UPDATE ON prima.it_jobs FOR EACH ROW EXECUTE FUNCTION prima.ic_admit_plan_guard();
 FOR fn IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND starts_with(p.proname,'ic_') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,prima_app',fn.sig);
 END LOOP;
END
$install$;
GRANT EXECUTE ON FUNCTION prima.ic_scope(text,text),prima.ic_recovery_actor(text),prima.ic_archived(text,text),prima.ic_dependencies(text,text) TO prima_app;
COMMIT;

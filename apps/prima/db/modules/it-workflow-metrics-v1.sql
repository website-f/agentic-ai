-- New prospective workflow measurement. No domain approvals, user writes or live installation.
BEGIN;
CREATE TABLE prima.it_metric_streams(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_metric_receipts(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_metric_targets(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_metric_calendars(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE OR REPLACE FUNCTION prima.wm_hash(d jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
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
CREATE FUNCTION prima.wm_shape(d jsonb,keys text[],strings text[],numbers text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(jsonb_typeof(d)='object' AND d ?& keys AND (SELECT count(*) FROM jsonb_object_keys(d))=cardinality(keys)
 AND NOT EXISTS(SELECT 1 FROM unnest(strings) k WHERE jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR d->>k IS DISTINCT FROM btrim(d->>k) OR d->>k ~ '[[:cntrl:]]')
 AND NOT EXISTS(SELECT 1 FROM unnest(numbers) k WHERE jsonb_typeof(d->k) IS DISTINCT FROM 'number'),false)
$$;
CREATE FUNCTION prima.wm_active(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(data->>'role' IS NOT NULL AND data->>'role'<>'site_device' AND coalesce(data->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb) AND (coalesce(data->>'accessClosedFrom','')='' OR data->>'accessClosedFrom'>to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))),false) FROM prima.users WHERE id=uid
$$;
CREATE FUNCTION prima.wm_role(uid text,need text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(prima.wm_active(uid) AND bool_or(CASE need
 WHEN 'it' THEN data->>'role'='pwvsb_officer' AND data->>'department'='it' AND data->>'itRole' IN ('manager','lead','executive')
 WHEN 'manager' THEN data->>'role'='pwvsb_officer' AND data->>'department'='it' AND data->>'itRole'='manager'
 WHEN 'lead' THEN data->>'role'='pwvsb_officer' AND data->>'department'='it' AND data->>'itRole'='lead'
 WHEN 'executive' THEN data->>'role'='pwvsb_officer' AND data->>'department'='it' AND data->>'itRole'='executive'
 WHEN 'senior' THEN (data->>'role' IN ('director','pwvsb_officer') AND data->>'opsTier'='ceo') OR (data->>'role'='pwvsb_officer' AND data->>'opsTier'='coo')
 WHEN 'oversee' THEN (data->>'role'='pwvsb_officer' AND data->>'department'='it' AND data->>'itRole'='manager') OR (data->>'role' IN ('director','pwvsb_officer') AND data->>'opsTier'='ceo') OR (data->>'role'='pwvsb_officer' AND (data->>'opsTier'='coo' OR data->>'department'='audit'))
 ELSE false END),false) FROM prima.users WHERE id=uid
$$;
CREATE FUNCTION prima.wm_ref(ref jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(prima.wm_shape(ref,ARRAY['workflow','recordId','stage','cycle','coverageSegment','complexity'],ARRAY['workflow','recordId','stage','complexity'],ARRAY['cycle','coverageSegment']) AND ref->>'coverageSegment' ~ '^[1-9][0-9]{0,8}$' AND length(ref->>'recordId') BETWEEN 1 AND 200 AND ref->>'complexity'='unclassified' AND ref->>'cycle' ~ '^[1-9][0-9]{0,8}$' AND ((ref->>'workflow'='job' AND ref->>'stage' IN ('work','check','approve')) OR (ref->>'workflow' IN ('ticket','website') AND ref->>'stage' IN ('work','confirm'))),false)
$$;
CREATE FUNCTION prima.wm_source(ref jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb;
BEGIN
 IF NOT prima.wm_ref(ref) THEN RETURN NULL; END IF;
 IF ref->>'workflow'='job' THEN SELECT data INTO d FROM prima.it_jobs WHERE id=ref->>'recordId'; ELSE SELECT data INTO d FROM prima.it_tickets WHERE id=ref->>'recordId'; END IF;
 IF d->>'id' IS DISTINCT FROM ref->>'recordId' THEN RETURN NULL; END IF; RETURN d;
END
$$;
CREATE FUNCTION prima.wm_source_hash(uid text,ref jsonb,d jsonb) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT prima.wm_hash(jsonb_build_object('ref',ref,'actor',jsonb_build_object('id',u.id,'role',u.data->'role','department',coalesce(u.data->'department','null'::jsonb),'itRole',coalesce(u.data->'itRole','null'::jsonb),'opsTier',coalesce(u.data->'opsTier','null'::jsonb),'leadership',coalesce(u.data->'leadership','null'::jsonb),'companyIds',coalesce((SELECT jsonb_agg(value ORDER BY value#>>'{}' COLLATE "C") FROM jsonb_array_elements(u.data->'companyIds')),'[]'::jsonb),'accessClosedFrom',coalesce(u.data->'accessClosedFrom','null'::jsonb),'integration',coalesce(u.data->'integration','null'::jsonb) NOT IN ('null'::jsonb,'false'::jsonb)),'record',CASE WHEN ref->>'workflow'='job' THEN jsonb_build_object('id',d->'id','assigneeId',d->'assigneeId','status',d->'status','returns',d->'returns','technical',d->'technical','dueOn',d->'dueOn') ELSE jsonb_build_object('id',d->'id','status',d->'status','assignedToId',coalesce(d->'assignedToId','null'::jsonb),'webResolutionVersion',coalesce(d->'webResolutionVersion','null'::jsonb),'confirmedAt',coalesce(d->'confirmedAt','null'::jsonb),'reopened',coalesce(d->'reopened','0'::jsonb),'sourceRef',coalesce(d->'sourceRef','null'::jsonb)) END)) FROM prima.users u WHERE u.id=uid
$$;
CREATE FUNCTION prima.wm_web_scope(uid text,t jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE u jsonb; issue jsonb; company text; groupviewer boolean;
BEGIN
 SELECT data INTO u FROM prima.users WHERE id=uid;
 SELECT data INTO issue FROM prima.web_issues WHERE id=substring(t->>'sourceRef' FROM 5) AND data->>'itTicketId'=t->>'id';
 IF issue IS NULL OR NOT prima.wm_active(uid) THEN RETURN false; END IF;
 IF prima.wm_role(uid,'it') AND t->>'assignedToId'=uid THEN RETURN true; END IF;
 company:=issue->>'companyId';
 groupviewer:=coalesce(u->>'role'='director' OR (u->>'role'='pwvsb_officer' AND (u->>'opsTier' IN ('ceo','coo') OR coalesce(u->>'leadership','')<>'' OR (u->>'department'='audit' AND u->>'actRole'='lead'))) OR prima.wm_role(uid,'manager') OR prima.wm_role(uid,'lead'),false);
 IF groupviewer AND company=ANY(prima.visible_companies()) AND EXISTS(SELECT 1 FROM prima.companies WHERE id=company) THEN RETURN true; END IF;
 IF u->>'role' IN ('company_manager','admin_exec') AND u->'companyIds' ? company THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM prima.web_companies p WHERE p.data->>'companyId'=company AND (p.data->>'contentOwnerId'=uid OR p.data->>'approverId'=uid OR (prima.wm_role(uid,'it') AND (p.data->>'itAdminId'=uid OR p.data->>'backupId'=uid)))) THEN RETURN true; END IF;
 IF EXISTS(SELECT 1 FROM prima.web_sites s LEFT JOIN prima.web_companies p ON p.data->>'companyId'=s.data->>'companyId' WHERE s.data->>'companyId'=company AND (s.data->>'contentOwnerId'=uid OR s.data->>'approverId'=uid OR (prima.wm_role(uid,'it') AND (coalesce(s.data->>'itAdminId',p.data->>'itAdminId')=uid OR coalesce(s.data->>'backupId',p.data->>'backupId')=uid)))) THEN RETURN true; END IF;
 RETURN coalesce(EXISTS(SELECT 1 FROM prima.web_domains d WHERE d.data->'companyIds' ? company AND ((prima.wm_role(uid,'it') AND (d.data->>'itAdminId'=uid OR d.data->>'backupId'=uid)) OR (u->>'role'='pwvsb_officer' AND u->>'department'='finance' AND d.data->>'renewalOwnerId'=uid))),false);
END
$$;
CREATE FUNCTION prima.wm_authority(uid text,ref jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb:=prima.wm_source(ref); actor jsonb; stage text:=ref->>'stage'; cycle integer; isown boolean; viewable boolean; track boolean:=false; terminal boolean:=false; terminalat text; ownerid text; lastlog jsonb; doer jsonb; requester jsonb; internal boolean; checker boolean; web boolean; boundary boolean; tracking_owner text; owner_authority jsonb;
BEGIN
 IF d IS NULL OR NOT prima.wm_active(uid) THEN RETURN NULL; END IF;
 SELECT data INTO actor FROM prima.users WHERE id=uid;
 SELECT coalesce(data->>'ownerId',uid) INTO tracking_owner FROM prima.it_metric_streams WHERE id='metric:'||prima.wm_hash(ref); tracking_owner:=coalesce(tracking_owner,uid);
 IF ref->>'workflow'='job' THEN
  IF NOT coalesce(actor->>'department' IN ('it','audit','hr','chief_of_staff') OR actor->>'opsTier' IN ('coo','ceo'),false) THEN RETURN NULL; END IF;
  IF jsonb_typeof(d->'returns') IS DISTINCT FROM 'number' OR d->>'returns' !~ '^[0-9]{1,8}$' OR jsonb_typeof(d->'log') IS DISTINCT FROM 'array' OR jsonb_typeof(d->'proof') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
  cycle:=(d->>'returns')::integer+1; IF (ref->>'cycle')::integer>cycle THEN RETURN NULL; END IF; boundary:=(ref->>'cycle')::integer<>cycle;
  isown:=coalesce(d->>'assigneeId'=uid,false); SELECT data INTO doer FROM prima.users WHERE id=d->>'assigneeId';
  SELECT value INTO lastlog FROM jsonb_array_elements(d->'log') WITH ORDINALITY e(value,ord) WHERE value->>'what'=(CASE stage WHEN 'work' THEN 'submit' WHEN 'check' THEN 'check' ELSE 'accept' END) ORDER BY ord DESC LIMIT 1;
  terminal:=CASE stage WHEN 'work' THEN coalesce(d->>'submittedAt','')<>'' AND d->>'status' IN ('submitted','checked','accepted') WHEN 'check' THEN coalesce(d->>'checkedBy','')<>'' AND d->>'status' IN ('checked','accepted') ELSE d->>'status'='accepted' END;
  terminalat:=CASE stage WHEN 'work' THEN d->>'submittedAt' WHEN 'approve' THEN d->>'acceptedAt' ELSE lastlog->>'at' END;
  IF NOT boundary THEN
   IF stage='work' THEN track:=prima.wm_role(uid,'it') AND isown AND d->>'status' IN ('todo','doing','returned');
   ELSIF stage='check' THEN track:=prima.wm_role(uid,'lead') AND NOT isown AND d->'technical'='true'::jsonb AND d->>'status'='submitted';
   ELSE track:=NOT isown AND ((prima.wm_role(uid,'senior') AND d->>'status' IN ('submitted','checked')) OR (prima.wm_role(uid,'manager') AND doer->>'itRole' IS DISTINCT FROM 'manager' AND (CASE WHEN d->'technical'='true'::jsonb THEN d->>'status'='checked' OR (d->>'status'='submitted' AND doer->>'itRole'='lead') ELSE d->>'status'='submitted' END))); END IF;
  END IF;
  ownerid:=CASE WHEN terminal THEN coalesce(lastlog->>'byId','') WHEN stage='work' THEN d->>'assigneeId' ELSE tracking_owner END;
  viewable:=prima.wm_role(uid,'oversee') OR isown OR track OR coalesce(lastlog->>'byId'=uid,false);
 ELSE
  IF NOT coalesce(d->>'raisedById'=uid OR actor->>'department' IN ('it','audit') OR actor->>'opsTier' IN ('coo','ceo'),false) THEN RETURN NULL; END IF;
  web:=starts_with(coalesce(d->>'sourceRef',''),'web:'); IF web IS DISTINCT FROM (ref->>'workflow'='website') OR (web AND NOT prima.wm_web_scope(uid,d)) THEN RETURN NULL; END IF;
  cycle:=coalesce((d->>'reopened')::integer,0)+1; IF (ref->>'cycle')::integer>cycle THEN RETURN NULL; END IF; boundary:=(ref->>'cycle')::integer<>cycle;
  isown:=coalesce(d->>'assignedToId'=uid,false); SELECT data INTO requester FROM prima.users WHERE id=d->>'raisedById';
  terminal:=CASE stage WHEN 'work' THEN d->>'status'='resolved' ELSE coalesce(d->>'confirmedAt','')<>'' END;
  terminalat:=CASE stage WHEN 'work' THEN d->>'resolvedAt' ELSE d->>'confirmedAt' END;
  IF web THEN
   internal:=requester IS NULL OR coalesce(requester->'integration','null'::jsonb) NOT IN ('null'::jsonb,'false'::jsonb) OR (requester->>'role'='pwvsb_officer' AND requester->>'department'='it') OR coalesce(d->>'raisedFor','')<>'';
   checker:=CASE WHEN internal THEN CASE WHEN d#>>'{webResolution,resolverRole}'='manager' THEN prima.wm_role(uid,'lead') ELSE prima.wm_role(uid,'manager') END ELSE d->>'raisedById'=uid END;
   IF NOT boundary THEN track:=CASE stage WHEN 'work' THEN prima.wm_role(uid,'it') AND isown AND d->>'status'<>'resolved' ELSE prima.wm_web_scope(uid,d) AND checker AND d->>'status'='resolved' AND coalesce(d->>'confirmedAt','')='' AND jsonb_typeof(d->'webResolution')='object' AND d#>'{webResolution,version}'=d->'webResolutionVersion' AND coalesce(d->>'resolvedById','')<>'' AND d#>>'{webResolution,resolverId}'=d->>'resolvedById' AND d->>'resolvedById'<>uid END; END IF;
   SELECT value INTO lastlog FROM jsonb_array_elements(coalesce(d->'webHistory','[]'::jsonb)) WITH ORDINALITY e(value,ord) WHERE value->>'action'='confirm' ORDER BY ord DESC LIMIT 1;
   ownerid:=CASE WHEN stage='work' THEN CASE WHEN terminal THEN coalesce(d->>'resolvedById','') ELSE coalesce(d->>'assignedToId','') END WHEN terminal THEN coalesce(lastlog->>'actorId','') ELSE tracking_owner END;
  ELSE
   IF NOT boundary THEN track:=CASE stage WHEN 'work' THEN prima.wm_role(uid,'it') AND isown AND d->>'status'<>'resolved' ELSE d->>'raisedById'=uid AND d->>'status'='resolved' AND coalesce(d->>'confirmedAt','')='' AND coalesce(d->>'raisedFor','')='' AND coalesce(d->>'resolvedAt','')<>'' AND (CASE WHEN coalesce(d->>'resolvedById','')<>'' THEN d->>'resolvedById'<>uid ELSE NOT (isown OR prima.wm_role(uid,'lead') OR (coalesce(d->>'assignedToId','')='' AND prima.wm_role(uid,'it'))) END) AND (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date-((d->>'resolvedAt')::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date<=3 END; END IF;
   ownerid:=CASE WHEN stage='work' THEN CASE WHEN terminal THEN coalesce(d->>'resolvedById','') ELSE coalesce(d->>'assignedToId','') END ELSE d->>'raisedById' END;
  END IF;
  viewable:=prima.wm_role(uid,'oversee') OR isown OR coalesce(d->>'raisedById'=uid,false) OR track;
 END IF;
 IF NOT coalesce(viewable OR tracking_owner=uid,false) THEN RETURN NULL; END IF;
 IF tracking_owner<>uid THEN
  owner_authority:=prima.wm_authority(tracking_owner,ref);
  track:=false; boundary:=boundary OR (NOT coalesce(terminal,false) AND (owner_authority IS NULL OR NOT coalesce((owner_authority->>'canTrackOwn')::boolean,false)));
 ELSE boundary:=boundary OR (ref->>'workflow'='job' AND d->>'status'='cancelled') OR (NOT coalesce(terminal,false) AND NOT coalesce(track,false)); END IF;
 RETURN jsonb_build_object('ownerId',ownerid,'canView',true,'canTrackOwn',coalesce(track,false),'canOversee',prima.wm_role(uid,'oversee'),'boundaryChanged',boundary,'domainTerminal',NOT boundary AND coalesce(terminal,false),'domainTerminalAt',terminalat,'sourceVersion',prima.wm_source_hash(uid,ref,d));
END
$$;
-- Narrow trusted-server lock boundary. No payload is returned and no user UPDATE privilege is granted.
CREATE FUNCTION prima.wm_lock(ref jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE uid text:=current_setting('app.user_id',true); d jsonb; ids text[]; recovery boolean;
BEGIN
 IF NOT prima.wm_active(uid) THEN RAISE EXCEPTION 'Current personal identity required' USING ERRCODE='23514'; END IF;
 IF ref IS NULL OR ref='null'::jsonb THEN
  PERFORM 1 FROM prima.users WHERE id=uid FOR SHARE;
  IF NOT prima.wm_active(uid) THEN RAISE EXCEPTION 'Current personal identity required' USING ERRCODE='23514'; END IF;
  RETURN;
 END IF;
 IF NOT prima.wm_ref(ref) THEN RAISE EXCEPTION 'Workflow is not instrumented' USING ERRCODE='23514'; END IF;
 recovery:=EXISTS(SELECT 1 FROM prima.it_metric_streams WHERE id='metric:'||prima.wm_hash(ref) AND data->>'ownerId'=uid AND data->'ref'=ref);
 IF prima.wm_authority(uid,ref) IS NULL AND NOT recovery THEN RAISE EXCEPTION 'Current workflow scope required' USING ERRCODE='23514'; END IF;
 IF ref->>'workflow'='job' THEN
  PERFORM 1 FROM prima.it_jobs WHERE id=ref->>'recordId' FOR SHARE;
 ELSE
  PERFORM pg_advisory_xact_lock(hashtext('web-settings:settings'));
  PERFORM 1 FROM prima.web_settings WHERE id='settings' FOR SHARE;
  PERFORM 1 FROM prima.it_tickets WHERE id=ref->>'recordId' FOR SHARE;
 END IF;
 d:=prima.wm_source(ref);
 IF d IS NULL THEN RAISE EXCEPTION 'Source unavailable; timing requires reconciliation' USING ERRCODE='23514'; END IF;
 ids:=ARRAY[uid,(SELECT data->>'ownerId' FROM prima.it_metric_streams WHERE id='metric:'||prima.wm_hash(ref)),CASE WHEN ref->>'workflow'='job' THEN d->>'assigneeId' ELSE d->>'assignedToId' END,d->>'raisedById'];
 PERFORM 1 FROM prima.users WHERE id=ANY(ids) ORDER BY id COLLATE "C" FOR SHARE;
 IF NOT prima.wm_active(uid) OR (prima.wm_authority(uid,ref) IS NULL AND NOT recovery) THEN RAISE EXCEPTION 'Workflow authority changed' USING ERRCODE='23514'; END IF;
END
$$;
CREATE FUNCTION prima.wm_quality(ref jsonb,d jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog, prima AS $$
DECLARE q jsonb:=jsonb_build_object('firstPassAccepted',NULL,'returnCount',NULL,'reopenedCount',NULL,'requiredEvidenceComplete',NULL,'errorCount',NULL,'requesterConfirmed',NULL,'evidenceRefs','[]'::jsonb); submitted boolean; accepted boolean; requester boolean; linked boolean; countvalue integer; refs jsonb;
BEGIN
 IF ref->>'workflow'='job' THEN
  countvalue:=CASE WHEN jsonb_typeof(d->'returns')='number' AND d->>'returns' ~ '^[0-9]{1,8}$' THEN (d->>'returns')::integer ELSE NULL END;
  submitted:=EXISTS(SELECT 1 FROM jsonb_array_elements(d->'log') e WHERE e->>'what'='submit' AND coalesce(e->>'byId','')<>'');
  accepted:=EXISTS(SELECT 1 FROM jsonb_array_elements(d->'log') e WHERE e->>'what'='accept' AND coalesce(e->>'byId','')<>'' AND e->>'byId'<>d->>'assigneeId');
  q:=q||jsonb_build_object('returnCount',countvalue);
  IF d->>'status'='accepted' AND submitted AND accepted AND countvalue IS NOT NULL THEN q:=q||jsonb_build_object('firstPassAccepted',countvalue=0); END IF;
  IF submitted THEN q:=q||jsonb_build_object('requiredEvidenceComplete',jsonb_array_length(d->'proof')>0); END IF;
  SELECT coalesce(jsonb_agg(to_jsonb((d->>'id')||':proof:'||(ord-1)::text||':'||coalesce(value->>'sha256','undefined')) ORDER BY ord),'[]'::jsonb) INTO refs FROM jsonb_array_elements(d->'proof') WITH ORDINALITY p(value,ord);
 ELSE
  countvalue:=CASE WHEN jsonb_typeof(d->'reopened')='number' AND d->>'reopened' ~ '^[0-9]{1,8}$' THEN (d->>'reopened')::integer ELSE NULL END;
  linked:=starts_with(coalesce(d->>'sourceRef',''),'web:');
  requester:=coalesce(d->>'confirmedAt','')<>'' AND coalesce(d->>'raisedFor','')='' AND (NOT linked OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(d->'webHistory','[]'::jsonb)) e WHERE e->>'action'='confirm' AND e->>'actorId'=d->>'raisedById' AND e->>'at'=d->>'confirmedAt'));
  q:=q||jsonb_build_object('reopenedCount',countvalue);
  IF requester THEN q:=q||jsonb_build_object('requesterConfirmed',true); IF countvalue IS NOT NULL THEN q:=q||jsonb_build_object('firstPassAccepted',countvalue=0); END IF; END IF;
  IF d->>'status'='resolved' AND coalesce(d->>'resolvedById','')<>'' THEN q:=q||jsonb_build_object('requiredEvidenceComplete',length(btrim(d->>'resolution'))>=3); END IF;
  IF linked THEN SELECT coalesce(jsonb_agg(to_jsonb((d->>'id')||':resolution:'||coalesce(value->>'resolutionVersion','undefined')||':'||(value->>'action')||':'||(value->>'at')) ORDER BY ord),'[]'::jsonb) INTO refs FROM jsonb_array_elements(coalesce(d->'webHistory','[]'::jsonb)) WITH ORDINALITY e(value,ord) WHERE value->>'action' IN ('resolve','confirm','return'); ELSE refs:='[]'::jsonb; END IF;
 END IF;
 RETURN q||jsonb_build_object('evidenceRefs',refs);
END
$$;
CREATE FUNCTION prima.wm_timestamp(v jsonb,current_recording boolean) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog, prima AS $$
DECLARE t timestamptz;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR v#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RETURN false; END IF;
 t:=(v#>>'{}')::timestamptz;
 RETURN NOT current_recording OR abs(extract(epoch FROM t-statement_timestamp()))<=300;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END
$$;
CREATE FUNCTION prima.wm_calendar_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog, prima AS $$
DECLARE w jsonb; h jsonb; previous_end integer:=-1;
BEGIN
 IF NOT prima.wm_shape(c,ARRAY['version','timezone','weekdays','windows','holidays'],ARRAY['timezone'],ARRAY['version']) OR c->>'version' !~ '^[1-9][0-9]{0,8}$' OR c->>'timezone'<>'Asia/Kuala_Lumpur' OR jsonb_typeof(c->'weekdays') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'windows') IS DISTINCT FROM 'array' OR jsonb_typeof(c->'holidays') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(c->'weekdays') NOT BETWEEN 1 AND 7 OR jsonb_array_length(c->'windows')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'weekdays') d WHERE jsonb_typeof(d)<>'number' OR d::text !~ '^[0-6]$') OR (SELECT count(DISTINCT d) FROM jsonb_array_elements(c->'weekdays') d)<>jsonb_array_length(c->'weekdays') THEN RETURN false; END IF;
 FOR w IN SELECT value FROM jsonb_array_elements(c->'windows') LOOP
  IF NOT prima.wm_shape(w,ARRAY['fromMinute','toMinute'],ARRAY[]::text[],ARRAY['fromMinute','toMinute']) OR w->>'fromMinute' !~ '^[0-9]{1,4}$' OR w->>'toMinute' !~ '^[0-9]{1,4}$' OR (w->>'fromMinute')::integer<previous_end OR (w->>'fromMinute')::integer>=(w->>'toMinute')::integer OR (w->>'toMinute')::integer>1440 THEN RETURN false; END IF;
  previous_end:=(w->>'toMinute')::integer;
 END LOOP;
 FOR h IN SELECT value FROM jsonb_array_elements(c->'holidays') LOOP
  IF jsonb_typeof(h)<>'string' OR h#>>'{}' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR to_char((h#>>'{}')::date,'YYYY-MM-DD')<>h#>>'{}' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END
$$;
CREATE FUNCTION prima.wm_visible(stream_id text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE uid text:=current_setting('app.user_id',true); s jsonb; a jsonb;
BEGIN
 IF NOT prima.wm_active(uid) THEN RETURN false; END IF;
 SELECT data INTO s FROM prima.it_metric_streams WHERE id=stream_id;
 IF s IS NULL THEN RETURN false; END IF;
 -- Original metadata is retained for owner-only uncertainty recovery, not renewed source access.
 IF s->>'ownerId'=uid THEN RETURN true; END IF;
 a:=prima.wm_authority(uid,s->'ref');
 RETURN coalesce(a->'canView'='true'::jsonb AND a->'canOversee'='true'::jsonb,false);
END
$$;
CREATE FUNCTION prima.wm_operation(uid text,request_id text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE result jsonb; matches integer;
BEGIN
 SELECT count(*),jsonb_agg(op)->0 INTO matches,result FROM (
 SELECT jsonb_build_object('streamId',s.id,'version',e.value->'sequence','payloadHash',e.value->'payloadHash','kind',CASE e.value->>'action' WHEN 'opened' THEN 'open' WHEN 'domain_closed' THEN 'sync' WHEN 'boundary_unknown' THEN 'reconcile' ELSE e.value->>'action' END,'at',e.value->'at') op FROM prima.it_metric_streams s CROSS JOIN LATERAL jsonb_array_elements(s.data->'events') e(value) WHERE e.value->>'actorId'=uid AND e.value->>'requestId'=request_id
 UNION ALL
 SELECT jsonb_build_object('streamId',data#>'{target,id}','version',data#>'{target,version}','payloadHash',data#>'{target,payloadHash}','kind','target','at',data#>'{target,reviewedAt}') FROM prima.it_metric_targets WHERE data#>>'{target,reviewedById}'=uid AND data#>>'{target,requestId}'=request_id
 ) found;
 IF matches>1 THEN RAISE EXCEPTION 'Operation UUID is not unique' USING ERRCODE='23514'; END IF; RETURN result;
END
$$;
CREATE FUNCTION prima.wm_config_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb:=NEW.data; c jsonb; uid text:=current_setting('app.user_id',true); target jsonb; expected jsonb; latest integer; requestid text;
BEGIN
 IF TG_OP<>'INSERT' OR NEW.id IS DISTINCT FROM d->>'id' THEN RAISE EXCEPTION 'Configuration revisions are immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='it_metric_calendars' THEN
  PERFORM pg_advisory_xact_lock(hashtext('it-manual:metric-calendar-config'));
  c:=d->'calendar';
  IF NOT prima.wm_shape(d,ARRAY['id','calendar'],ARRAY['id'],ARRAY[]::text[]) OR NOT prima.wm_calendar_valid(c) OR NEW.id IS DISTINCT FROM 'calendar:'||(c->>'version') THEN RAISE EXCEPTION 'Explicit valid business calendar required' USING ERRCODE='23514'; END IF;
  SELECT coalesce(max((data#>>'{calendar,version}')::integer),0) INTO latest FROM prima.it_metric_calendars;
  IF c->'version' IS DISTINCT FROM to_jsonb(latest+1) THEN RAISE EXCEPTION 'Calendar revision changed' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME<>'it_metric_targets' OR NOT prima.wm_shape(d,ARRAY['id','target'],ARRAY['id'],ARRAY[]::text[]) THEN RAISE EXCEPTION 'Unexpected target wrapper' USING ERRCODE='23514'; END IF;
 target:=d->'target';requestid:=target->>'requestId';
 IF NOT prima.wm_shape(target,ARRAY['id','version','requestId','payloadHash','workflow','stage','complexity','workMin','workMax','businessDueMinutes','provisional','reason','reviewedById','reviewedAt'],ARRAY['id','requestId','payloadHash','workflow','stage','complexity','reason','reviewedById','reviewedAt'],ARRAY['version']) OR requestid !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR target->>'version' !~ '^[1-9][0-9]{0,8}$' OR target->>'workflow' NOT IN ('ticket','job','asset_entry','import_review','inspection','rental_bill','procurement','onboarding','website','connection_setup') OR target->>'stage' NOT IN ('request','work','check','approve','confirm') OR target->>'complexity' NOT IN ('routine','complex','unclassified') OR jsonb_typeof(target->'provisional') IS DISTINCT FROM 'boolean' OR length(target->>'reason') NOT BETWEEN 3 AND 500 OR NOT prima.wm_timestamp(target->'reviewedAt',true) THEN RAISE EXCEPTION 'Exact reviewed target fields required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metrics:metric-targets'));
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metric-request:'||uid||':'||requestid));
 PERFORM prima.wm_lock(NULL);
 IF NOT prima.wm_role(uid,'manager') OR target->>'reviewedById' IS DISTINCT FROM uid OR EXISTS(SELECT 1 FROM prima.it_metric_receipts WHERE id=uid||':'||requestid) OR prima.wm_operation(uid,requestid) IS NOT NULL THEN RAISE EXCEPTION 'Current Manager and unused operation required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['workMin','workMax','businessDueMinutes']) k WHERE target->k<>'null'::jsonb AND (jsonb_typeof(target->k)<>'number' OR target->>k !~ '^[1-9][0-9]{0,14}$' OR (target->>k)::numeric>2147483647)) OR (target->'workMin'='null'::jsonb) IS DISTINCT FROM (target->'workMax'='null'::jsonb) OR (target->'workMin'<>'null'::jsonb AND (target->>'workMin')::numeric>(target->>'workMax')::numeric) THEN RAISE EXCEPTION 'Explicit ordered minute target or unknown required' USING ERRCODE='23514'; END IF;
 IF target->>'id' IS DISTINCT FROM 'target:'||prima.wm_hash(jsonb_build_object('workflow',target->'workflow','stage',target->'stage','complexity',target->'complexity')) OR NEW.id IS DISTINCT FROM (target->>'id')||':'||(target->>'version') THEN RAISE EXCEPTION 'Target cohort identity mismatch' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metric-target:'||(target->>'id')));
 SELECT coalesce(max((data#>>'{target,version}')::integer),0) INTO latest FROM prima.it_metric_targets WHERE data#>>'{target,id}'=target->>'id';
 IF target->'version' IS DISTINCT FROM to_jsonb(latest+1) THEN RAISE EXCEPTION 'Target revision changed' USING ERRCODE='23514'; END IF;
 expected:=jsonb_build_object('requestId',requestid,'workflow',target->'workflow','stage',target->'stage','complexity',target->'complexity','expectedVersion',latest,'workMin',target->'workMin','workMax',target->'workMax','businessDueMinutes',target->'businessDueMinutes','provisional',target->'provisional','reason',target->'reason');
 IF target->>'payloadHash' IS DISTINCT FROM prima.wm_hash(expected) THEN RAISE EXCEPTION 'Target receipt input binding mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$$;
CREATE FUNCTION prima.wm_receipt_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb:=NEW.data; r jsonb:=NEW.data->'receipt';uid text:=current_setting('app.user_id',true);op jsonb;
BEGIN
 IF TG_OP<>'INSERT' OR NOT prima.wm_shape(d,ARRAY['id','receipt'],ARRAY['id'],ARRAY[]::text[]) OR NEW.id IS DISTINCT FROM d->>'id' OR NOT prima.wm_shape(r,ARRAY['serviceId','userId','requestId','kind','terminal','streamId','version','payloadHash','at'],ARRAY['serviceId','userId','requestId','kind','terminal','payloadHash','at'],ARRAY[]::text[]) OR r->>'serviceId'<>'it-workflow-metrics' OR r->>'userId' IS DISTINCT FROM uid OR NEW.id IS DISTINCT FROM uid||':'||(r->>'requestId') OR r->>'requestId' !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR r->>'kind' NOT IN ('open','start','pause','wait','resume','submit','sync','target','reconcile') OR NOT prima.wm_timestamp(r->'at',false) THEN RAISE EXCEPTION 'Exact own timing receipt required' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metrics:'||(CASE WHEN r->>'kind'='target' AND r->>'terminal'='committed' THEN 'metric-targets' ELSE uid END)));
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metric-request:'||uid||':'||(r->>'requestId')));
 PERFORM prima.wm_lock(NULL); op:=prima.wm_operation(uid,r->>'requestId');
 IF r->>'terminal'='committed' THEN
  IF op IS NULL OR r->'streamId' IS DISTINCT FROM op->'streamId' OR r->'version' IS DISTINCT FROM op->'version' OR r->'payloadHash' IS DISTINCT FROM op->'payloadHash' OR r->'kind' IS DISTINCT FROM op->'kind' OR r->'at' IS DISTINCT FROM op->'at' THEN RAISE EXCEPTION 'Timing receipt lacks exact committed operation' USING ERRCODE='23514'; END IF;
 ELSIF r->>'terminal'='rejected' THEN
  IF op IS NOT NULL OR r->'streamId' IS DISTINCT FROM 'null'::jsonb OR r->'version' IS DISTINCT FROM 'null'::jsonb OR r->>'payloadHash' IS DISTINCT FROM prima.wm_hash(jsonb_build_object('abandoned',r->'kind','requestId',r->'requestId')) OR NOT prima.wm_timestamp(r->'at',true) THEN RAISE EXCEPTION 'Cancellation cannot conceal a committed operation' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Invalid terminal timing outcome' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$$;
-- Owner-only scalar recovery. It never returns the source payload or grants domain authority.
CREATE FUNCTION prima.wm_boundary(stream_id text) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE uid text:=current_setting('app.user_id',true); s jsonb; d jsonb; ref jsonb; event jsonb; terminal boolean; actor jsonb; doer jsonb; who text; a jsonb;
BEGIN
 SELECT data INTO s FROM prima.it_metric_streams WHERE id=stream_id;
 IF s IS NULL OR s->>'ownerId' IS DISTINCT FROM uid OR NOT prima.wm_active(uid) THEN RETURN false; END IF;
 ref:=s->'ref'; d:=prima.wm_source(ref); IF d IS NULL THEN RETURN false; END IF;
 SELECT data INTO actor FROM prima.users WHERE id=uid;
 IF ref->>'workflow'='job' THEN
  IF (d->>'returns')::integer+1<>(ref->>'cycle')::integer OR d->>'status'='cancelled' THEN RETURN true; END IF;
  terminal:=CASE ref->>'stage' WHEN 'work' THEN coalesce(d->>'submittedAt','')<>'' AND d->>'status' IN ('submitted','checked','accepted') WHEN 'check' THEN coalesce(d->>'checkedBy','')<>'' AND d->>'status' IN ('checked','accepted') ELSE d->>'status'='accepted' END;
  SELECT value INTO event FROM jsonb_array_elements(d->'log') WITH ORDINALITY e(value,ord) WHERE value->>'what'=(CASE ref->>'stage' WHEN 'work' THEN 'submit' WHEN 'check' THEN 'check' ELSE 'accept' END) ORDER BY ord DESC LIMIT 1;
  IF terminal THEN RETURN coalesce(event->>'byId','')<>uid; END IF;
  SELECT data INTO doer FROM prima.users WHERE id=d->>'assigneeId';
  RETURN coalesce(CASE ref->>'stage'
   WHEN 'work' THEN NOT prima.wm_role(uid,'it') OR d->>'assigneeId' IS DISTINCT FROM uid
   WHEN 'check' THEN NOT prima.wm_role(uid,'lead') OR d->>'assigneeId'=uid OR d->'technical' IS DISTINCT FROM 'true'::jsonb
   WHEN 'approve' THEN d->>'assigneeId'=uid OR NOT (prima.wm_role(uid,'senior') OR (prima.wm_role(uid,'manager') AND doer->>'itRole' IS DISTINCT FROM 'manager')) ELSE false END,false);
 END IF;
 IF coalesce((d->>'reopened')::integer,0)+1<>(ref->>'cycle')::integer THEN RETURN true; END IF;
 IF ref->>'stage'='work' THEN
  IF d->>'status'='resolved' THEN RETURN coalesce(d->>'resolvedById','')<>uid; END IF;
  RETURN NOT prima.wm_role(uid,'it') OR d->>'assignedToId' IS DISTINCT FROM uid;
 END IF;
 IF coalesce(d->>'confirmedAt','')<>'' THEN
  IF ref->>'workflow'='website' THEN SELECT value->>'actorId' INTO who FROM jsonb_array_elements(coalesce(d->'webHistory','[]'::jsonb)) WITH ORDINALITY e(value,ord) WHERE value->>'action'='confirm' ORDER BY ord DESC LIMIT 1; ELSE who:=d->>'raisedById'; END IF;
  RETURN coalesce(who,'')<>uid;
 END IF;
 IF ref->>'workflow'='website' THEN a:=prima.wm_authority(uid,ref); RETURN a IS NULL OR NOT coalesce((a->>'canTrackOwn')::boolean,false); END IF;
 a:=prima.wm_authority(uid,ref); RETURN a IS NULL OR NOT coalesce((a->>'canTrackOwn')::boolean,false);
END
$$;
CREATE FUNCTION prima.wm_stream_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE uid text:=current_setting('app.user_id',true); s jsonb:=NEW.data; old_s jsonb; e jsonb; a jsonb; w jsonb; wanted jsonb; previous_event jsonb; n integer; action text; expected_mode text; last_segment jsonb; target_row jsonb; calendar_row jsonb; request_id text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Timing history is retained' USING ERRCODE='23514'; END IF;
 IF NOT prima.wm_shape(s,ARRAY['id','ref','ownerId','sourceVersion','openedAt','version','mode','target','closedQuality','boundaryUnknown','calendar','events','coverage'],ARRAY['id','ownerId','sourceVersion','openedAt','mode','coverage'],ARRAY['version']) OR NOT prima.wm_ref(s->'ref') OR s->>'id' IS DISTINCT FROM NEW.id OR NEW.id IS DISTINCT FROM 'metric:'||prima.wm_hash(s->'ref') OR s->>'version' !~ '^[1-9][0-9]{0,8}$' OR s->>'coverage'<>'prospective_only' OR jsonb_typeof(s->'boundaryUnknown') IS DISTINCT FROM 'boolean' OR jsonb_typeof(s->'events') IS DISTINCT FROM 'array' OR s->>'sourceVersion' !~ '^[0-9a-f]{64}$' OR NOT prima.wm_timestamp(s->'openedAt',false) THEN RAISE EXCEPTION 'Invalid timing record shape' USING ERRCODE='23514'; END IF;
 n:=(s->>'version')::integer;
 IF jsonb_array_length(s->'events')<>n OR n>100000 THEN RAISE EXCEPTION 'Timing history version mismatch' USING ERRCODE='23514'; END IF;
 e:=s->'events'->(n-1);
 IF NOT prima.wm_shape(e,ARRAY['id','streamId','sequence','requestId','payloadHash','actorId','at','action','sourceVersion','mode','waiting'],ARRAY['id','streamId','requestId','payloadHash','actorId','at','action','sourceVersion','mode'],ARRAY['sequence']) OR e->>'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR e->>'id' IS DISTINCT FROM e->>'requestId' OR e->>'streamId' IS DISTINCT FROM NEW.id OR e->'sequence' IS DISTINCT FROM s->'version' OR e->>'actorId' IS DISTINCT FROM uid OR e->>'sourceVersion' IS DISTINCT FROM s->>'sourceVersion' OR e->>'mode' IS DISTINCT FROM s->>'mode' OR e->>'payloadHash' !~ '^[0-9a-f]{64}$' OR NOT prima.wm_timestamp(e->'at',false) THEN RAISE EXCEPTION 'Invalid timing event' USING ERRCODE='23514'; END IF;
 request_id:=e->>'requestId'; action:=e->>'action';
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metrics:'||uid));
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metric-request:'||uid||':'||request_id));
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:metric-stream:'||NEW.id));
 PERFORM prima.wm_lock(s->'ref');
 IF EXISTS(SELECT 1 FROM prima.it_metric_receipts WHERE id=uid||':'||request_id) OR prima.wm_operation(uid,request_id) IS NOT NULL THEN RAISE EXCEPTION 'Timing request UUID already terminal' USING ERRCODE='23514'; END IF;
 a:=prima.wm_authority(uid,s->'ref');
 IF TG_OP='INSERT' THEN
  IF n<>1 OR action<>'opened' OR s->>'ownerId' IS DISTINCT FROM uid OR s->>'mode'<>'queued' OR s->'closedQuality' IS DISTINCT FROM 'null'::jsonb OR s->'boundaryUnknown' IS DISTINCT FROM 'false'::jsonb OR s->'openedAt' IS DISTINCT FROM e->'at' OR e->'waiting' IS DISTINCT FROM 'null'::jsonb OR NOT prima.wm_timestamp(e->'at',true) OR a IS NULL OR a->'canTrackOwn' IS DISTINCT FROM 'true'::jsonb OR a->>'ownerId' IS DISTINCT FROM uid OR a->'domainTerminal' IS DISTINCT FROM 'false'::jsonb OR a->'boundaryChanged' IS DISTINCT FROM 'false'::jsonb OR s->>'sourceVersion' IS DISTINCT FROM a->>'sourceVersion' THEN RAISE EXCEPTION 'Only the current owner can start prospective coverage' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('it-manual:metric-series:'||prima.wm_hash((s->'ref')-'coverageSegment')));
  SELECT data INTO last_segment FROM prima.it_metric_streams WHERE (data->'ref')-'coverageSegment'=(s->'ref')-'coverageSegment' ORDER BY (data#>>'{ref,coverageSegment}')::integer DESC LIMIT 1;
  IF (s#>>'{ref,coverageSegment}')::integer IS DISTINCT FROM (CASE WHEN last_segment IS NULL THEN 1 WHEN last_segment->>'mode'='closed' AND last_segment->'boundaryUnknown'='true'::jsonb THEN (last_segment#>>'{ref,coverageSegment}')::integer+1 ELSE (last_segment#>>'{ref,coverageSegment}')::integer END) THEN RAISE EXCEPTION 'Prospective coverage segment changed' USING ERRCODE='23514'; END IF;
  SELECT data->'target' INTO target_row FROM prima.it_metric_targets WHERE data#>>'{target,workflow}'=s#>>'{ref,workflow}' AND data#>>'{target,stage}'=s#>>'{ref,stage}' AND data#>>'{target,complexity}'=s#>>'{ref,complexity}' ORDER BY (data#>>'{target,version}')::integer DESC LIMIT 1;
  SELECT data->'calendar' INTO calendar_row FROM prima.it_metric_calendars ORDER BY (data#>>'{calendar,version}')::integer DESC LIMIT 1;
  IF s->'target' IS DISTINCT FROM coalesce(target_row,'null'::jsonb) OR s->'calendar' IS DISTINCT FROM coalesce(calendar_row,'null'::jsonb) THEN RAISE EXCEPTION 'Timing configuration snapshot changed' USING ERRCODE='23514'; END IF;
  wanted:=jsonb_build_object('action','open','ref',s->'ref');
 ELSE
  old_s:=OLD.data;
  IF NEW.id IS DISTINCT FROM OLD.id OR (s-ARRAY['version','mode','sourceVersion','closedQuality','boundaryUnknown','events']) IS DISTINCT FROM (old_s-ARRAY['version','mode','sourceVersion','closedQuality','boundaryUnknown','events']) OR n<>(old_s->>'version')::integer+1 OR (SELECT coalesce(jsonb_agg(value ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(s->'events') WITH ORDINALITY x(value,ord) WHERE ord<n) IS DISTINCT FROM old_s->'events' OR old_s->>'mode'='closed' THEN RAISE EXCEPTION 'Timing history cannot be rewritten' USING ERRCODE='23514'; END IF;
  previous_event:=old_s->'events'->((old_s->>'version')::integer-1);
  IF (e->>'at')::timestamptz<(previous_event->>'at')::timestamptz THEN RAISE EXCEPTION 'Timing clock moved backwards' USING ERRCODE='23514'; END IF;
  IF action='boundary_unknown' THEN
   IF old_s->>'ownerId' IS DISTINCT FROM uid OR NOT prima.wm_boundary(OLD.id) OR s->>'mode'<>'closed' OR s->'boundaryUnknown' IS DISTINCT FROM 'true'::jsonb OR s->'sourceVersion' IS DISTINCT FROM old_s->'sourceVersion' OR NOT prima.wm_timestamp(e->'at',true) OR s->'closedQuality' IS DISTINCT FROM jsonb_build_object('firstPassAccepted',NULL,'returnCount',NULL,'reopenedCount',NULL,'requiredEvidenceComplete',NULL,'errorCount',NULL,'requesterConfirmed',NULL,'evidenceRefs','[]'::jsonb) OR e->'waiting' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Unknown boundary needs original owner and current source proof' USING ERRCODE='23514'; END IF;
   wanted:=jsonb_build_object('action','boundary_unknown','ref',s->'ref');
  ELSIF action='domain_closed' THEN
   IF a IS NULL OR a->'boundaryChanged' IS DISTINCT FROM 'false'::jsonb OR a->'domainTerminal' IS DISTINCT FROM 'true'::jsonb OR a->>'ownerId' IS DISTINCT FROM old_s->>'ownerId' OR e->>'at' IS DISTINCT FROM a->>'domainTerminalAt' OR (e->>'at')::timestamptz>statement_timestamp() OR s->>'sourceVersion' IS DISTINCT FROM a->>'sourceVersion' OR s->>'mode'<>'closed' OR s->'boundaryUnknown' IS DISTINCT FROM 'false'::jsonb OR s->'closedQuality' IS DISTINCT FROM prima.wm_quality(s->'ref',prima.wm_source(s->'ref')) OR e->'waiting' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Completion must match actual source actor and evidence' USING ERRCODE='23514'; END IF;
   wanted:=jsonb_build_object('action','domain_closed','ref',s->'ref');
  ELSE
   IF old_s->>'ownerId' IS DISTINCT FROM uid OR a IS NULL OR a->>'ownerId' IS DISTINCT FROM uid OR a->'canTrackOwn' IS DISTINCT FROM 'true'::jsonb OR a->'boundaryChanged' IS DISTINCT FROM 'false'::jsonb OR a->'domainTerminal' IS DISTINCT FROM 'false'::jsonb OR s->>'sourceVersion' IS DISTINCT FROM a->>'sourceVersion' OR s->'closedQuality' IS DISTINCT FROM 'null'::jsonb OR s->'boundaryUnknown' IS DISTINCT FROM 'false'::jsonb OR NOT prima.wm_timestamp(e->'at',true) THEN RAISE EXCEPTION 'Current stage ownership required' USING ERRCODE='23514'; END IF;
   w:=e->'waiting';
   IF action IN ('start','resume') THEN
    IF old_s->>'mode' NOT IN ('queued','external_wait','submitted') OR (old_s->>'mode'='submitted' AND action<>'resume') THEN RAISE EXCEPTION 'Invalid start/resume' USING ERRCODE='23514'; END IF; expected_mode:='active';
   ELSIF action='pause' THEN IF old_s->>'mode'<>'active' THEN RAISE EXCEPTION 'Pause needs active work' USING ERRCODE='23514'; END IF; expected_mode:='queued';
   ELSIF action='submit' THEN IF old_s->>'mode'<>'active' THEN RAISE EXCEPTION 'Handoff needs active work' USING ERRCODE='23514'; END IF; expected_mode:='submitted';
   ELSIF action='wait' THEN
    PERFORM 1 FROM prima.users WHERE id=w->>'ownerId' FOR SHARE;
    IF old_s->>'mode' NOT IN ('active','queued') OR NOT prima.wm_shape(w,ARRAY['reason','ownerId','note','reviewAt'],ARRAY['reason','ownerId','note','reviewAt'],ARRAY[]::text[]) OR w->>'reason' NOT IN ('requester_information','supplier','provider_permission','physical_access','other') OR length(w->>'note') NOT BETWEEN 3 AND 500 OR NOT prima.wm_timestamp(w->'reviewAt',false) OR (w->>'reviewAt')::timestamptz<=(e->>'at')::timestamptz OR NOT ((prima.wm_role(uid,'it') OR prima.wm_role(uid,'oversee')) AND prima.wm_role(w->>'ownerId','it') OR (NOT prima.wm_role(uid,'it') AND NOT prima.wm_role(uid,'oversee') AND w->>'ownerId'=uid)) THEN RAISE EXCEPTION 'Waiting needs current accountable owner and future review' USING ERRCODE='23514'; END IF; expected_mode:='external_wait';
   ELSE RAISE EXCEPTION 'Unsupported timing transition' USING ERRCODE='23514'; END IF;
   IF s->>'mode' IS DISTINCT FROM expected_mode OR (action<>'wait' AND w IS DISTINCT FROM 'null'::jsonb) THEN RAISE EXCEPTION 'Timing mode mismatch' USING ERRCODE='23514'; END IF;
   wanted:=jsonb_build_object('requestId',request_id,'streamId',NEW.id,'expectedVersion',old_s->'version','sourceVersion',e->'sourceVersion','action',action,'waiting',w);
  END IF;
 END IF;
 IF e->>'payloadHash' IS DISTINCT FROM prima.wm_hash(wanted) THEN RAISE EXCEPTION 'Timing operation hash mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$$;
CREATE FUNCTION prima.wm_next_segment(ref jsonb) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE uid text:=current_setting('app.user_id',true); previous jsonb; segment integer; probe jsonb; authority jsonb;
BEGIN
 IF NOT prima.wm_active(uid) OR NOT prima.wm_ref(ref) THEN RAISE EXCEPTION 'Current instrumented source required' USING ERRCODE='23514'; END IF;
 SELECT data INTO previous FROM prima.it_metric_streams WHERE (data->'ref')-'coverageSegment'=ref-'coverageSegment' ORDER BY (data#>>'{ref,coverageSegment}')::integer DESC LIMIT 1;
 segment:=CASE WHEN previous IS NULL THEN 1 WHEN previous->>'mode'='closed' AND previous->'boundaryUnknown'='true'::jsonb THEN (previous#>>'{ref,coverageSegment}')::integer+1 ELSE (previous#>>'{ref,coverageSegment}')::integer END;
 probe:=jsonb_set(ref,'{coverageSegment}',to_jsonb(segment)); authority:=prima.wm_authority(uid,probe);
 IF authority IS NULL OR authority->'canTrackOwn' IS DISTINCT FROM 'true'::jsonb OR authority->>'ownerId' IS DISTINCT FROM uid OR authority->'boundaryChanged' IS DISTINCT FROM 'false'::jsonb OR authority->'domainTerminal' IS DISTINCT FROM 'false'::jsonb THEN RAISE EXCEPTION 'Current source does not admit prospective timing' USING ERRCODE='23514'; END IF;
 RETURN segment;
END
$$;
CREATE FUNCTION prima.wm_terminal_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE event jsonb; receipt jsonb; operation jsonb; owner_id text; request_id text;
BEGIN
 IF TG_TABLE_NAME='it_metric_targets' THEN event:=NEW.data->'target'; owner_id:=event->>'reviewedById'; request_id:=event->>'requestId';
 ELSE event:=NEW.data->'events'->((NEW.data->>'version')::integer-1); owner_id:=event->>'actorId'; request_id:=event->>'requestId'; END IF;
 operation:=prima.wm_operation(owner_id,request_id);
 SELECT data->'receipt' INTO receipt FROM prima.it_metric_receipts WHERE id=owner_id||':'||request_id;
 IF operation IS NULL OR receipt IS NULL OR receipt->>'terminal'<>'committed' OR receipt->'streamId' IS DISTINCT FROM operation->'streamId' OR receipt->'version' IS DISTINCT FROM operation->'version' OR receipt->'kind' IS DISTINCT FROM operation->'kind' OR receipt->'payloadHash' IS DISTINCT FROM operation->'payloadHash' OR receipt->'at' IS DISTINCT FROM operation->'at' THEN RAISE EXCEPTION 'Timing operation requires matching terminal receipt before commit' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END
$$;
CREATE UNIQUE INDEX wm_active_owner ON prima.it_metric_streams ((data->>'ownerId')) WHERE data->>'mode'='active';
DO $install$
DECLARE t text; fn record;
BEGIN
 FOREACH t IN ARRAY ARRAY['it_metric_streams','it_metric_receipts','it_metric_targets','it_metric_calendars'] LOOP
  EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY wm_owner ON prima.%I FOR ALL TO %I USING(true) WITH CHECK(true)',t,current_user);
  EXECUTE format('REVOKE ALL ON prima.%I FROM PUBLIC,prima_app',t);
  IF t='it_metric_streams' THEN
   EXECUTE format('GRANT SELECT,INSERT,UPDATE ON prima.%I TO prima_app',t);
   EXECUTE format('CREATE POLICY wm_read ON prima.%I FOR SELECT TO prima_app USING(prima.wm_visible(id))',t);
   EXECUTE format('CREATE POLICY wm_insert ON prima.%I FOR INSERT TO prima_app WITH CHECK(data->>''ownerId''=current_setting(''app.user_id'',true) AND prima.wm_active(current_setting(''app.user_id'',true)))',t);
   EXECUTE format('CREATE POLICY wm_update ON prima.%I FOR UPDATE TO prima_app USING(prima.wm_visible(id)) WITH CHECK(prima.wm_visible(id))',t);
   EXECUTE format('CREATE TRIGGER wm_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.wm_stream_guard()',t);
  ELSIF t='it_metric_receipts' THEN
   EXECUTE format('GRANT SELECT,INSERT ON prima.%I TO prima_app',t);
   EXECUTE format('CREATE POLICY wm_read ON prima.%I FOR SELECT TO prima_app USING(data#>>''{receipt,userId}''=current_setting(''app.user_id'',true) AND prima.wm_active(current_setting(''app.user_id'',true)))',t);
   EXECUTE format('CREATE POLICY wm_insert ON prima.%I FOR INSERT TO prima_app WITH CHECK(data#>>''{receipt,userId}''=current_setting(''app.user_id'',true) AND prima.wm_active(current_setting(''app.user_id'',true)))',t);
   EXECUTE format('CREATE TRIGGER wm_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.wm_receipt_guard()',t);
  ELSE
   EXECUTE format('GRANT SELECT ON prima.%I TO prima_app',t);
   EXECUTE format('CREATE POLICY wm_read ON prima.%I FOR SELECT TO prima_app USING(prima.wm_active(current_setting(''app.user_id'',true)))',t);
   IF t='it_metric_targets' THEN
    EXECUTE format('GRANT INSERT ON prima.%I TO prima_app',t);
    EXECUTE format('CREATE POLICY wm_insert ON prima.%I FOR INSERT TO prima_app WITH CHECK(prima.wm_role(current_setting(''app.user_id'',true),''manager''))',t);
   END IF;
   EXECUTE format('CREATE TRIGGER wm_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.wm_config_guard()',t);
  END IF;
  IF t IN ('it_metric_streams','it_metric_targets') THEN EXECUTE format('CREATE CONSTRAINT TRIGGER wm_terminal AFTER INSERT OR UPDATE ON prima.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION prima.wm_terminal_guard()',t); END IF;
 END LOOP;
 FOR fn IN SELECT p.oid::regprocedure sig FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND starts_with(p.proname,'wm_') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,prima_app',fn.sig);
 END LOOP;
END
$install$;
GRANT EXECUTE ON FUNCTION prima.wm_active(text),prima.wm_role(text,text),prima.wm_visible(text),prima.wm_lock(jsonb),prima.wm_boundary(text),prima.wm_next_segment(jsonb) TO prima_app;
COMMIT;

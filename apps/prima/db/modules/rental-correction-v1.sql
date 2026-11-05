-- Separate reviewed module; never run implicitly during startup. No source bill deletion or money movement.
BEGIN;
CREATE TABLE prima.it_rental_correction_requests(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_rental_correction_reviews(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_rental_replacements(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_rental_replacement_payments(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_rental_correction_receipts(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE UNIQUE INDEX rental_review_revision ON prima.it_rental_correction_reviews((data->>'requestId'),((data->>'revision')::bigint));
CREATE UNIQUE INDEX rental_replacement_original ON prima.it_rental_replacements((data->>'originalId'));
CREATE UNIQUE INDEX rental_replacement_request ON prima.it_rental_replacements((data->>'requestId'));
CREATE UNIQUE INDEX rental_payment_replacement ON prima.it_rental_replacement_payments((data->>'replacementId'));
CREATE OR REPLACE FUNCTION prima.rc_hash(d jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
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
CREATE OR REPLACE FUNCTION prima.rc_role(uid text,need text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(coalesce(u.data->'integration','null'::jsonb) IN ('false'::jsonb,'null'::jsonb) AND u.data->>'role'<>'site_device'
 AND (coalesce(u.data->>'accessClosedFrom','')='' OR u.data->>'accessClosedFrom'>to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD')) AND
 CASE need
 WHEN 'it' THEN u.data->>'role'='pwvsb_officer' AND u.data->>'department'='it' AND u.data->>'itRole' IN ('manager','lead','executive')
 WHEN 'manager' THEN u.data->>'role'='pwvsb_officer' AND u.data->>'department'='it' AND u.data->>'itRole'='manager'
 WHEN 'finance' THEN u.data->>'leadership'='finance_director' AND coalesce(u.data->>'department','') NOT IN ('it','audit','hr','chief_of_staff') AND coalesce(u.data->>'opsTier','') NOT IN ('ceo','coo')
 WHEN 'read' THEN coalesce(u.data->>'department','') NOT IN ('hr','chief_of_staff') AND ((u.data->>'role'='pwvsb_officer' AND u.data->>'department'='it' AND u.data->>'itRole' IN ('manager','lead','executive')) OR (u.data->>'leadership'='finance_director' AND coalesce(u.data->>'department','') NOT IN ('it','audit','hr','chief_of_staff') AND coalesce(u.data->>'opsTier','') NOT IN ('ceo','coo')) OR u.data->>'opsTier' IN ('ceo','coo') OR u.data->>'department'='audit')
 ELSE false END),false) FROM prima.users u WHERE u.id=uid
$$;
CREATE OR REPLACE FUNCTION prima.rc_scope(uid text,company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(EXISTS(SELECT 1 FROM prima.users u WHERE u.id=uid AND u.data->'companyIds' ? company AND (company IN ('pwvsb','merdeka','goodwill','sasateam') OR EXISTS(SELECT 1 FROM prima.companies c WHERE c.id=company))),false)
$$;
CREATE OR REPLACE FUNCTION prima.rc_visible(company text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT prima.rc_role(current_setting('app.user_id',true),'read') AND prima.rc_scope(current_setting('app.user_id',true),company)
$$;
-- Validates frozen request against CURRENT original, preparer, rates and assets. Internal only.
CREATE OR REPLACE FUNCTION prima.rc_current(d jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE b jsonb; rate jsonb; a jsonb; item jsonb; snap jsonb; lines jsonb; ids text[]:=ARRAY[]::text[]; total numeric; p jsonb:=d->'proposedBill'; price numeric; n integer;
BEGIN
 SELECT data INTO b FROM prima.it_rental_bills WHERE id=d->>'originalId' FOR UPDATE;
 IF b IS NULL OR b->'paid' IS DISTINCT FROM 'null'::jsonb OR b->>'source' IS DISTINCT FROM 'configured_rates' OR b->>'currency' IS DISTINCT FROM 'MYR'
 OR b->>'companyId' IS DISTINCT FROM d->>'companyId' OR b IS DISTINCT FROM d->'originalSnapshot' OR prima.rc_hash(b) IS DISTINCT FROM d->>'originalHash'
 OR NOT prima.rc_role(d->>'requestedById','it') OR NOT prima.rc_scope(d->>'requestedById',d->>'companyId')
 OR EXISTS(SELECT 1 FROM prima.it_rental_replacements r WHERE r.data->>'originalId'=d->>'originalId') THEN RETURN false; END IF;
 SELECT data INTO rate FROM prima.it_rental_rates WHERE data->>'effectiveOn'<=(b->>'period')||'-01' ORDER BY data->>'effectiveOn' DESC,(data->>'version')::bigint DESC LIMIT 1;
 IF rate IS NULL OR rate IS DISTINCT FROM d->'rateSnapshot' OR rate->>'currency' IS DISTINCT FROM 'MYR' THEN RETURN false; END IF;
 IF jsonb_typeof(d->'assetHashes') IS DISTINCT FROM 'array' OR jsonb_array_length(d->'assetHashes') NOT BETWEEN 1 AND 1000
 OR jsonb_typeof(p->'assetSnapshot') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'assetSnapshot')<>jsonb_array_length(d->'assetHashes') THEN RETURN false; END IF;
 -- Stabilize all selected assets in deterministic order against normal asset updates.
 PERFORM 1 FROM prima.it_assets WHERE id IN(SELECT x->>'id' FROM jsonb_array_elements(d->'assetHashes') x) ORDER BY id FOR SHARE;
 n:=0;
 FOR item IN SELECT value FROM jsonb_array_elements(d->'assetHashes') LOOP
 SELECT data INTO a FROM prima.it_assets WHERE id=item->>'id'; snap:=p->'assetSnapshot'->n; n:=n+1;
 IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['id','hash']) OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(item->'hash') IS DISTINCT FROM 'string' OR a IS NULL OR a->>'id'=ANY(ids) OR prima.rc_hash(a) IS DISTINCT FROM item->>'hash' OR a->>'ownerId' IS DISTINCT FROM d->>'companyId' OR coalesce(a->>'status','') NOT IN ('in_use','repair') THEN RETURN false; END IF;
 ids:=array_append(ids,a->>'id');
 IF snap-ARRAY['version'] IS DISTINCT FROM jsonb_build_object('id',a->>'id','tag',a->>'tag','kind',a->>'kind','ownerId',a->>'ownerId','status',a->>'status')
 OR snap->>'version' IS DISTINCT FROM encode(sha256(convert_to('['||(a->'id')::text||','||(a->'tag')::text||','||(a->'kind')::text||','||(a->'ownerId')::text||','||(a->'status')::text||','||coalesce((a->'assignedTo')::text,'null')||','||coalesce(nullif((a#>'{manual,version}')::text,'null'),'0')||CASE WHEN a ? 'correction' THEN ','||(a#>'{correction,version}')::text ELSE '' END||']','UTF8')),'hex') THEN RETURN false; END IF;
 price:=(rate->'monthly'->>(a->>'kind'))::numeric;
 IF price IS NULL OR price<0 OR price>1000000 OR price*100<>trunc(price*100) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM prima.it_rental_bills other,LATERAL jsonb_array_elements(coalesce(other.data->'assetSnapshot','[]'::jsonb)) x WHERE other.id<>d->>'originalId' AND other.data->>'period'=b->>'period' AND x->>'id'=a->>'id')
 OR EXISTS(SELECT 1 FROM prima.it_rental_replacements other,LATERAL jsonb_array_elements(other.data#>'{bill,assetSnapshot}') x WHERE other.data->>'originalId'<>d->>'originalId' AND other.data#>>'{bill,period}'=b->>'period' AND x->>'id'=a->>'id') THEN RETURN false; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('kind',z.kind,'count',z.qty,'rate',z.price,'amount',z.price*z.qty) ORDER BY z.kind),sum(z.price*z.qty) INTO lines,total FROM (
 SELECT x->>'kind' kind,count(*) qty,(rate->'monthly'->>(x->>'kind'))::numeric price FROM jsonb_array_elements(p->'assetSnapshot') x GROUP BY x->>'kind') z;
 IF total IS NULL OR total>100000000 OR p->'lines' IS DISTINCT FROM lines OR (p->>'total')::numeric IS DISTINCT FROM total
 OR p->'paid' IS DISTINCT FROM 'null'::jsonb OR p->>'invoiceRef'=b->>'invoiceRef' OR p->>'rateId' IS DISTINCT FROM rate->>'id' OR p->'rateVersion' IS DISTINCT FROM rate->'version' OR p->'rateEffectiveOn' IS DISTINCT FROM rate->'effectiveOn'
 OR p->>'issuedBy' IS DISTINCT FROM (SELECT data->>'name' FROM prima.users WHERE id=d->>'requestedById') OR p->>'createdById' IS DISTINCT FROM d->>'requestedById'
 OR p->>'id' IS DISTINCT FROM 'replacement:'||(p->>'requestId')
 OR (p-ARRAY['id','invoiceRef','total','lines','rateId','rateVersion','rateEffectiveOn','assetSnapshot','issuedBy','issuedAt','createdById','requestId','evidence','note']) IS DISTINCT FROM (b-ARRAY['id','invoiceRef','total','lines','rateId','rateVersion','rateEffectiveOn','assetSnapshot','issuedBy','issuedAt','createdById','requestId','evidence','note']) THEN RETURN false; END IF;
 RETURN true;
END $$;
CREATE OR REPLACE FUNCTION prima.rc_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE d jsonb:=NEW.data; uid text:=current_setting('app.user_id',true); r jsonb; last_review jsonb; m jsonb; f jsonb; replacement jsonb; rev bigint; expected jsonb; action_row jsonb; action_id text; action_version bigint; expected_keys text[]; operation_input jsonb; key text; op_uuid text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Rental review evidence is append only' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 -- Stabilize current entitlements; no user or authority mutation is granted.
 PERFORM 1 FROM prima.users ORDER BY id FOR SHARE;
 IF NEW.id IS DISTINCT FROM d->>'id' OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR NOT prima.rc_role(uid,'read') THEN RAISE EXCEPTION 'Rental actor or record identity invalid' USING ERRCODE='23514'; END IF;
 expected_keys:=CASE TG_TABLE_NAME
 WHEN 'it_rental_correction_requests' THEN ARRAY['id','companyId','originalId','originalHash','originalSnapshot','proposedBill','rateSnapshot','assetHashes','reason','requestedById','at','hash']
 WHEN 'it_rental_correction_reviews' THEN ARRAY['id','requestId','companyId','revision','requestHash','kind','decision','actorId','at','note','managerReviewId']
 WHEN 'it_rental_replacements' THEN ARRAY['id','companyId','originalId','requestId','requestHash','managerReviewId','financeReviewId','bill','at']
 WHEN 'it_rental_replacement_payments' THEN ARRAY['id','replacementId','companyId','expectedHash','byId','at','ref','requestId']
 WHEN 'it_rental_correction_receipts' THEN ARRAY['id','userId','requestId','kind','hash','outcome','recordId','version','message','at'] ELSE ARRAY[]::text[] END;
 IF NOT(d ?& expected_keys) OR (SELECT count(*) FROM jsonb_object_keys(d))<>cardinality(expected_keys)
 OR jsonb_typeof(d->'at') IS DISTINCT FROM 'string' OR coalesce(d->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})$'
 OR (d->>'at')::timestamptz>statement_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Exact rental evidence fields required' USING ERRCODE='23514'; END IF;
 FOR key IN SELECT unnest(ARRAY['id','companyId','originalId','originalHash','requestedById','hash','requestId','requestHash','kind','decision','actorId','replacementId','expectedHash','byId','ref','reason','note','userId','outcome']) LOOP
 IF d ? key AND jsonb_typeof(d->key) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Rental text fields require strings' USING ERRCODE='23514'; END IF;
 END LOOP;
 FOR key IN SELECT unnest(ARRAY['reason','note','ref','message']) LOOP
 IF d ? key AND d->key<>'null'::jsonb AND (jsonb_typeof(d->key) IS DISTINCT FROM 'string' OR length(d->>key)>500 OR d->>key IS DISTINCT FROM btrim(d->>key) OR (d->>key) ~ '[[:cntrl:]]' OR (d->>key) ~* '(password|secret|token|api[_ -]?key)\s*[:=]|bearer\s+\S+') THEN RAISE EXCEPTION 'Rental evidence text is invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF TG_TABLE_NAME='it_rental_correction_receipts' THEN
 IF d->>'userId' IS DISTINCT FROM uid OR d->>'id' IS DISTINCT FROM uid||':'||(d->>'requestId')
 OR coalesce(d->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR coalesce(d->>'hash','') !~ '^[a-f0-9]{64}$' OR coalesce(d->>'kind','') NOT IN ('propose','manager_review','finance_review','cancel','payment')
 OR coalesce(d->>'outcome','') NOT IN ('committed','rejected') OR jsonb_typeof(d->'at') IS DISTINCT FROM 'string'
 OR (d->>'outcome'='committed' AND (jsonb_typeof(d->'version') IS DISTINCT FROM 'number' OR jsonb_typeof(d->'recordId') IS DISTINCT FROM 'string' OR coalesce(d->>'recordId','')='' OR coalesce(d->>'version','') !~ '^[1-9][0-9]*$' OR d->'message' IS DISTINCT FROM 'null'::jsonb))
 OR (d->>'outcome'='rejected' AND (d->'recordId' IS DISTINCT FROM 'null'::jsonb OR d->'version' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(d->'message') IS DISTINCT FROM 'string' OR length(d->>'message')>500)) THEN RAISE EXCEPTION 'Invalid owner operation receipt' USING ERRCODE='23514'; END IF;
 -- Recovery success must correspond to the actual immutable domain action.
 IF d->>'kind'='propose' THEN
 SELECT data INTO action_row FROM prima.it_rental_correction_requests WHERE id='rental-correction:'||(d->>'requestId') AND data->>'requestedById'=uid;
 action_id:=action_row->>'id'; action_version:=1;
 operation_input:=jsonb_build_object('requestId',d->>'requestId','originalId',action_row->>'originalId','expectedOriginalHash',action_row->>'originalHash','rateId',action_row#>>'{rateSnapshot,id}','assetRefs',(SELECT jsonb_agg(jsonb_build_object('id',x->>'id','version',x->>'version') ORDER BY ord) FROM jsonb_array_elements(action_row#>'{proposedBill,assetSnapshot}') WITH ORDINALITY a(x,ord)),'invoiceRef',action_row#>>'{proposedBill,invoiceRef}','reason',action_row->>'reason','evidence',action_row#>>'{proposedBill,evidence}');
 ELSIF d->>'kind'='payment' THEN
 SELECT data INTO action_row FROM prima.it_rental_replacement_payments WHERE data->>'requestId'=d->>'requestId' AND data->>'byId'=uid;
 action_id:=action_row->>'id'; action_version:=1;
 operation_input:=jsonb_build_object('requestId',d->>'requestId','replacementId',action_row->>'replacementId','expectedHash',action_row->>'expectedHash','ref',action_row->>'ref');
 ELSE
 SELECT data INTO action_row FROM prima.it_rental_correction_reviews WHERE id='rental-review:'||(d->>'requestId') AND data->>'actorId'=uid AND data->>'kind'=d->>'kind';
 action_id:=action_row->>'requestId'; action_version:=(action_row->>'revision')::bigint;
 operation_input:=jsonb_build_object('requestId',d->>'requestId','id',action_row->>'requestId','expectedHash',action_row->>'requestHash','expectedRevision',action_version-1,'note',action_row->>'note');
 IF d->>'kind'<>'cancel' THEN operation_input:=operation_input||jsonb_build_object('decision',action_row->>'decision'); END IF;
 IF d->>'kind'='finance_review' AND action_row->>'decision'='approve' THEN
 SELECT data INTO replacement FROM prima.it_rental_replacements WHERE data->>'financeReviewId'=action_row->>'id';
 action_id:=replacement->>'id';
 END IF;
 END IF;
 IF (d->>'outcome'='committed' AND (action_row IS NULL OR action_id IS NULL OR d->>'hash' IS DISTINCT FROM prima.rc_hash(jsonb_build_object('kind',d->>'kind','input',operation_input)) OR d->>'recordId' IS DISTINCT FROM action_id OR (d->>'version')::numeric IS DISTINCT FROM action_version::numeric))
 OR (d->>'outcome'='rejected' AND (action_row IS NOT NULL
 OR EXISTS(SELECT 1 FROM prima.it_rental_correction_requests WHERE data->>'requestedById'=uid AND data#>>'{proposedBill,requestId}'=d->>'requestId')
 OR EXISTS(SELECT 1 FROM prima.it_rental_correction_reviews WHERE data->>'actorId'=uid AND id='rental-review:'||(d->>'requestId'))
 OR EXISTS(SELECT 1 FROM prima.it_rental_replacement_payments WHERE data->>'byId'=uid AND data->>'requestId'=d->>'requestId'))) THEN RAISE EXCEPTION 'Receipt must match actual committed domain action' USING ERRCODE='23514'; END IF;
 RETURN NEW;
 END IF;
 IF TG_TABLE_NAME IN ('it_rental_correction_requests','it_rental_correction_reviews','it_rental_replacement_payments') THEN
 op_uuid:=CASE TG_TABLE_NAME WHEN 'it_rental_correction_requests' THEN d#>>'{proposedBill,requestId}' WHEN 'it_rental_correction_reviews' THEN substring(NEW.id from length('rental-review:')+1) ELSE d->>'requestId' END;
 IF EXISTS(SELECT 1 FROM prima.it_rental_correction_receipts WHERE id=uid||':'||op_uuid)
 OR EXISTS(SELECT 1 FROM prima.it_rental_correction_requests WHERE data->>'requestedById'=uid AND data#>>'{proposedBill,requestId}'=op_uuid)
 OR EXISTS(SELECT 1 FROM prima.it_rental_correction_reviews WHERE data->>'actorId'=uid AND id='rental-review:'||op_uuid)
 OR EXISTS(SELECT 1 FROM prima.it_rental_replacement_payments WHERE data->>'byId'=uid AND data->>'requestId'=op_uuid)
 THEN RAISE EXCEPTION 'Operation UUID is already bound or abandoned' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT prima.rc_scope(uid,d->>'companyId') OR jsonb_typeof(d->'at') IS DISTINCT FROM 'string' OR (d->>'at')::timestamptz>statement_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Current company scope required' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='it_rental_correction_requests' THEN
 IF jsonb_typeof(d->'originalSnapshot') IS DISTINCT FROM 'object' OR jsonb_typeof(d->'proposedBill') IS DISTINCT FROM 'object' OR jsonb_typeof(d->'rateSnapshot') IS DISTINCT FROM 'object'
 OR jsonb_typeof(d#>'{proposedBill,total}') IS DISTINCT FROM 'number' OR jsonb_typeof(d#>'{proposedBill,invoiceRef}') IS DISTINCT FROM 'string' OR jsonb_typeof(d#>'{proposedBill,evidence}') IS DISTINCT FROM 'string' OR jsonb_typeof(d#>'{proposedBill,note}') IS DISTINCT FROM 'string' OR jsonb_typeof(d#>'{proposedBill,issuedAt}') IS DISTINCT FROM 'string' OR (d#>>'{proposedBill,issuedAt}')::timestamptz>statement_timestamp()+interval '5 minutes'
 OR NOT prima.rc_role(uid,'it') OR d->>'requestedById' IS DISTINCT FROM uid OR prima.rc_hash(d-'hash') IS DISTINCT FROM d->>'hash'
 OR NEW.id IS DISTINCT FROM 'rental-correction:'||(d#>>'{proposedBill,requestId}') OR coalesce(d#>>'{proposedBill,requestId}','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR length(btrim(coalesce(d->>'reason',''))) NOT BETWEEN 3 AND 500 OR length(btrim(coalesce(d#>>'{proposedBill,evidence}',''))) NOT BETWEEN 3 AND 500
 OR length(btrim(coalesce(d#>>'{proposedBill,invoiceRef}',''))) NOT BETWEEN 3 AND 120 OR NOT prima.rc_current(d) THEN RAISE EXCEPTION 'Invalid current replacement proposal' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM prima.it_rental_correction_requests q WHERE q.data->>'originalId'=d->>'originalId' AND coalesce((SELECT v.data->>'decision' FROM prima.it_rental_correction_reviews v WHERE v.data->>'requestId'=q.id ORDER BY (v.data->>'revision')::bigint DESC LIMIT 1),'') NOT IN ('return','cancel')) THEN RAISE EXCEPTION 'Existing proposal must be resolved' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='it_rental_correction_reviews' THEN
 SELECT data INTO r FROM prima.it_rental_correction_requests WHERE id=d->>'requestId' FOR UPDATE;
 SELECT data INTO last_review FROM prima.it_rental_correction_reviews WHERE data->>'requestId'=d->>'requestId' ORDER BY (data->>'revision')::bigint DESC LIMIT 1;
 rev:=coalesce((last_review->>'revision')::bigint,0)+1;
 IF coalesce(NEW.id,'') !~ '^rental-review:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR r IS NULL OR r->>'companyId' IS DISTINCT FROM d->>'companyId' OR r->>'hash' IS DISTINCT FROM d->>'requestHash' OR d->>'actorId' IS DISTINCT FROM uid
 OR jsonb_typeof(d->'revision') IS DISTINCT FROM 'number' OR (d->>'revision')::numeric IS DISTINCT FROM rev::numeric OR coalesce(last_review->>'decision','') IN ('return','cancel')
 OR length(btrim(coalesce(d->>'note',''))) NOT BETWEEN 3 AND 500 OR EXISTS(SELECT 1 FROM prima.it_rental_replacements x WHERE x.data->>'requestId'=r->>'id') THEN RAISE EXCEPTION 'Review version or state invalid' USING ERRCODE='23514'; END IF;
 IF d->>'kind'='cancel' THEN
 IF d->>'decision' IS DISTINCT FROM 'cancel' OR uid IS DISTINCT FROM r->>'requestedById' OR d->'managerReviewId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Only preparer cancels' USING ERRCODE='23514'; END IF;
 ELSIF d->>'kind'='manager_review' THEN
 IF NOT prima.rc_role(uid,'manager') OR uid=r->>'requestedById' OR coalesce(d->>'decision','') NOT IN ('approve','return') OR d->'managerReviewId' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Independent Manager required' USING ERRCODE='23514'; END IF;
 ELSIF d->>'kind'='finance_review' THEN
 SELECT data INTO m FROM prima.it_rental_correction_reviews WHERE data->>'requestId'=r->>'id' AND data->>'kind'='manager_review' ORDER BY (data->>'revision')::bigint DESC LIMIT 1;
 IF NOT prima.rc_role(uid,'finance') OR m IS NULL OR m->>'decision' IS DISTINCT FROM 'approve' OR NOT prima.rc_role(m->>'actorId','manager') OR NOT prima.rc_scope(m->>'actorId',r->>'companyId')
 OR uid IN (r->>'requestedById',m->>'actorId') OR m->>'actorId'=r->>'requestedById' OR d->>'managerReviewId' IS DISTINCT FROM m->>'id' OR coalesce(d->>'decision','') NOT IN ('approve','return') THEN RAISE EXCEPTION 'Independent Finance after current Manager required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Unknown review kind' USING ERRCODE='23514'; END IF;
 IF d->>'decision'='approve' AND NOT prima.rc_current(r) THEN RAISE EXCEPTION 'Approval facts changed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='it_rental_replacements' THEN
 SELECT data INTO r FROM prima.it_rental_correction_requests WHERE id=d->>'requestId' FOR UPDATE;
 SELECT data INTO f FROM prima.it_rental_correction_reviews WHERE id=d->>'financeReviewId';
 SELECT data INTO m FROM prima.it_rental_correction_reviews WHERE id=d->>'managerReviewId';
 SELECT data INTO last_review FROM prima.it_rental_correction_reviews WHERE data->>'requestId'=d->>'requestId' ORDER BY (data->>'revision')::bigint DESC LIMIT 1;
 IF r IS NULL OR f IS NULL OR m IS NULL OR NOT prima.rc_role(uid,'finance') OR f->>'actorId' IS DISTINCT FROM uid OR f IS DISTINCT FROM last_review
 OR f->>'kind' IS DISTINCT FROM 'finance_review' OR f->>'decision' IS DISTINCT FROM 'approve' OR f->>'requestId' IS DISTINCT FROM r->>'id' OR f->>'requestHash' IS DISTINCT FROM r->>'hash'
 OR f->>'managerReviewId' IS DISTINCT FROM m->>'id' OR m->>'requestId' IS DISTINCT FROM r->>'id' OR m->>'requestHash' IS DISTINCT FROM r->>'hash' OR m->>'kind' IS DISTINCT FROM 'manager_review' OR m->>'decision' IS DISTINCT FROM 'approve'
 OR NOT prima.rc_role(m->>'actorId','manager') OR NOT prima.rc_scope(m->>'actorId',r->>'companyId') OR uid IN(r->>'requestedById',m->>'actorId') OR m->>'actorId'=r->>'requestedById'
 OR d->>'companyId' IS DISTINCT FROM r->>'companyId' OR d->>'originalId' IS DISTINCT FROM r->>'originalId' OR d->>'requestHash' IS DISTINCT FROM r->>'hash' OR NOT prima.rc_current(r) THEN RAISE EXCEPTION 'Replacement approval chain invalid' USING ERRCODE='23514'; END IF;
 expected:=jsonb_set(jsonb_set(r->'proposedBill','{note}',to_jsonb('Replacement for '||(r->>'originalId')||'; independently checked and Finance approved.')),'{issuedAt}',d#>'{bill,issuedAt}');
 IF jsonb_typeof(d#>'{bill,issuedAt}') IS DISTINCT FROM 'string' OR (d#>>'{bill,issuedAt}')::timestamptz>(d->>'at')::timestamptz OR d->'bill' IS DISTINCT FROM expected OR NEW.id IS DISTINCT FROM expected->>'id' THEN RAISE EXCEPTION 'Replacement content changed' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='it_rental_replacement_payments' THEN
 SELECT data INTO replacement FROM prima.it_rental_replacements WHERE id=d->>'replacementId' FOR SHARE;
 IF coalesce(d->>'requestId','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$' OR NOT prima.rc_role(uid,'finance') OR replacement IS NULL OR d->>'companyId' IS DISTINCT FROM replacement->>'companyId' OR d->>'byId' IS DISTINCT FROM uid
 OR NEW.id IS DISTINCT FROM replacement->>'id' OR d->>'expectedHash' IS DISTINCT FROM prima.rc_hash(replacement) OR length(btrim(coalesce(d->>'ref',''))) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'Scoped exact replacement Finance reference required' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Unknown rental table' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION prima.rc_original_payment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE uid text:=current_setting('app.user_id',true);
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 PERFORM 1 FROM prima.users WHERE id=uid FOR SHARE;
 IF NOT prima.rc_role(uid,'finance') OR NOT prima.rc_scope(uid,OLD.data->>'companyId') THEN RAISE EXCEPTION 'Current scoped Finance required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM prima.it_rental_replacements WHERE data->>'originalId'=OLD.id) THEN RAISE EXCEPTION 'Superseded original cannot record payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rental_original_payment_guard BEFORE UPDATE ON prima.it_rental_bills FOR EACH ROW EXECUTE FUNCTION prima.rc_original_payment_guard();
CREATE OR REPLACE FUNCTION prima.rc_visible_receipt() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT prima.rc_role(current_setting('app.user_id',true),'read')
$$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['it_rental_correction_requests','it_rental_correction_reviews','it_rental_replacements','it_rental_replacement_payments','it_rental_correction_receipts'] LOOP
 EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON prima.%I FROM prima_app',t);
 EXECUTE format('GRANT SELECT,INSERT ON prima.%I TO prima_app',t);
 EXECUTE format('CREATE POLICY rc_read ON prima.%I FOR SELECT USING (%s)',t,CASE WHEN t='it_rental_correction_receipts' THEN 'data->>''userId''=current_setting(''app.user_id'',true) AND prima.rc_visible_receipt()' ELSE 'prima.rc_visible(data->>''companyId'')' END);
 EXECUTE format('CREATE POLICY rc_insert ON prima.%I FOR INSERT WITH CHECK (%s)',t,CASE WHEN t='it_rental_correction_receipts' THEN 'data->>''userId''=current_setting(''app.user_id'',true) AND prima.rc_visible_receipt()' ELSE 'prima.rc_visible(data->>''companyId'')' END);
 EXECUTE format('CREATE POLICY rc_setup ON prima.%I TO CURRENT_USER USING(true) WITH CHECK(true)',t);
 EXECUTE format('CREATE TRIGGER rc_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.%I FOR EACH ROW EXECUTE FUNCTION prima.rc_guard()',t);
 END LOOP;
END $$;

REVOKE ALL ON FUNCTION prima.rc_hash(jsonb),prima.rc_role(text,text),prima.rc_scope(text,text),prima.rc_visible(text),prima.rc_visible_receipt(),prima.rc_current(jsonb),prima.rc_guard(),prima.rc_original_payment_guard() FROM PUBLIC,prima_app;
GRANT EXECUTE ON FUNCTION prima.rc_visible(text),prima.rc_visible_receipt() TO prima_app;
COMMIT;

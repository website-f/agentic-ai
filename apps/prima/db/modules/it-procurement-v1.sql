-- NEW reconstructed module. Separate explicit transaction; no startup install, seeded authority or payment execution.
BEGIN;
CREATE TABLE prima.it_purchase_finance_authorities(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_procurement_packets(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE prima.it_procurement_receipts(id text PRIMARY KEY,data jsonb NOT NULL);
CREATE OR REPLACE FUNCTION prima.ip_hash(d jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
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
CREATE FUNCTION prima.ip_shape(d jsonb,keys text[],strings text[],numbers text[]) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(jsonb_typeof(d)='object' AND d ?& keys AND (SELECT count(*) FROM jsonb_object_keys(d))=cardinality(keys)
 AND NOT EXISTS(SELECT 1 FROM unnest(strings) k WHERE jsonb_typeof(d->k) IS DISTINCT FROM 'string' OR d->>k IS DISTINCT FROM btrim(d->>k) OR d->>k ~ '[[:cntrl:]]')
 AND NOT EXISTS(SELECT 1 FROM unnest(numbers) k WHERE jsonb_typeof(d->k) IS DISTINCT FROM 'number'),false)
$$;
CREATE FUNCTION prima.ip_active(uid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(coalesce(data->'integration','null'::jsonb) IN ('null'::jsonb,'false'::jsonb) AND data->>'role'<>'site_device'
 AND (coalesce(data->>'accessClosedFrom','')='' OR data->>'accessClosedFrom'>to_char(now() AT TIME ZONE 'Asia/Kuala_Lumpur','YYYY-MM-DD'))),false) FROM prima.users WHERE id=uid
$$;
CREATE FUNCTION prima.ip_role(uid text,need text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(bool_or(prima.ip_active(uid) AND CASE need
 WHEN 'it' THEN u.data->>'role'='pwvsb_officer' AND u.data->>'department'='it' AND u.data->>'itRole' IN ('manager','lead','executive')
 WHEN 'finance' THEN u.data->>'role'='pwvsb_officer' AND u.data->>'department'='finance' AND u.data->>'financeRole' IN ('leader','deputy','data_entry') AND u.data->'financeTeam'=a.data->'financeTeam'
 WHEN 'coo' THEN u.data->>'role'='pwvsb_officer' AND u.data->>'opsTier'='coo'
 WHEN 'ceo' THEN u.data->>'role' IN ('director','pwvsb_officer') AND u.data->>'opsTier'='ceo'
 WHEN 'read' THEN (u.data->>'role'='pwvsb_officer' AND u.data->>'department'='it' AND u.data->>'itRole' IN ('manager','lead','executive'))
 OR (u.data->>'role'='pwvsb_officer' AND u.data->>'department'='finance' AND u.data->>'financeRole' IN ('leader','deputy','data_entry') AND u.data->'financeTeam'=a.data->'financeTeam')
 OR (u.data->>'role' IN ('director','pwvsb_officer') AND u.data->>'opsTier'='ceo') OR (u.data->>'role'='pwvsb_officer' AND (u.data->>'opsTier'='coo' OR u.data->>'department'='audit' OR u.data->>'leadership'='finance_director'))
 ELSE false END),false) FROM prima.users u LEFT JOIN prima.it_purchase_finance_authorities a ON a.id='merdeka' WHERE u.id=uid
$$;
CREATE FUNCTION prima.ip_visible(pid text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
 SELECT coalesce(EXISTS(SELECT 1 FROM prima.it_purchases p JOIN prima.users u ON u.id=current_setting('app.user_id',true)
 WHERE p.id=pid AND prima.ip_role(u.id,'read') AND (p.data->>'ownerId' IN ('pwvsb','merdeka') OR prima.ip_role(u.id,'coo') OR prima.ip_role(u.id,'ceo') OR (u.data->>'role'='pwvsb_officer' AND u.data->>'leadership'='finance_director') OR
 (u.data->'companyIds' ? (p.data->>'ownerId') AND EXISTS(SELECT 1 FROM prima.companies c WHERE c.id=p.data->>'ownerId')))),false)
$$;
CREATE FUNCTION prima.ip_purchase_hash(d jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog, prima AS $$
 SELECT prima.ip_hash(jsonb_build_object('id',d->'id','ref',d->'ref','ownerId',d->'ownerId','requestedById',d->'requestedById','items',d->'items','total',d->'total','managerStep',d->'managerStep','cooStep',d->'cooStep','ceoStep',coalesce(d->'ceoStep','null'::jsonb),'quotes',coalesce(d->'quotes','[]'::jsonb),'online',coalesce(d->'online','[]'::jsonb),'chosen',coalesce(d->'chosen','null'::jsonb)))
$$;
CREATE FUNCTION prima.ip_authority_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog, prima AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM 'merdeka' OR NEW.data->>'id' IS DISTINCT FROM NEW.id OR NOT prima.ip_shape(NEW.data,ARRAY['id','version','financeTeam','configuredBy','configuredAt'],ARRAY['id','configuredBy','configuredAt'],ARRAY['version','financeTeam'])
 OR NEW.data->>'version' !~ '^[1-9][0-9]*$' OR NEW.data->>'financeTeam' !~ '^[1-9][0-9]*$' OR length(NEW.data->>'configuredBy')=0
 OR (TG_OP='INSERT' AND NEW.data->>'version'<>'1') OR (TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR (NEW.data->>'version')::numeric<>(OLD.data->>'version')::numeric+1)) THEN RAISE EXCEPTION 'Explicit versioned Finance authority required' USING ERRCODE='23514'; END IF;
 PERFORM (NEW.data->>'configuredAt')::timestamptz;
 RETURN NEW;
END
$$;
CREATE FUNCTION prima.ip_input(d jsonb,op jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog, prima AS $$
DECLARE e jsonb; decision jsonb; base jsonb:=jsonb_build_object('requestId',op->'requestId','purchaseId',d->'id','expectedVersion',(op->>'version')::integer-1);
BEGIN
 CASE op->>'kind'
 WHEN 'po' THEN RETURN base||jsonb_build_object('purchaseHash',d#>'{po,purchaseHash}','poRef',d#>'{po,ref}','issuedOn',d#>'{po,issuedOn}','evidence',d#>'{po,evidence}');
 WHEN 'receipt' THEN SELECT value INTO e FROM jsonb_array_elements(d->'receipts') WHERE value->>'id'=op->>'requestId'; RETURN base||(e-ARRAY['id','assetIds','byId','at']);
 WHEN 'invoice' THEN SELECT value INTO e FROM jsonb_array_elements(d->'invoiceChecks') WHERE value->>'id'=op->>'requestId'; RETURN base||(e-ARRAY['id','matched','byId','at']);
 WHEN 'advance_request' THEN SELECT value INTO e FROM jsonb_array_elements(d->'advances') WHERE value->>'id'=op->>'requestId'; RETURN base||jsonb_build_object('amount',e->'amount','reason',e->'reason','terms',e->'terms');
 WHEN 'advance_decision' THEN
 SELECT a.value,dd.value INTO e,decision FROM jsonb_array_elements(d->'advances') a CROSS JOIN LATERAL jsonb_array_elements(jsonb_build_array(a.value->'coo',a.value->'ceo')) dd
 WHERE dd.value->>'requestId'=op->>'requestId';
 RETURN base||jsonb_build_object('advanceId',e->'id','decision',decision->'decision','comment',decision->'comment');
 WHEN 'payment' THEN SELECT value INTO e FROM jsonb_array_elements(d->'payments') WHERE value->>'id'=op->>'requestId'; RETURN base||(e-ARRAY['id','byId','at']);
 ELSE RETURN NULL;
 END CASE;
END
$$;
CREATE FUNCTION prima.ip_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE uid text:=current_setting('app.user_id',true); d jsonb:=NEW.data; oldd jsonb; p jsonb; auth jsonb; op jsonb; prev jsonb; input jsonb; e jsonb; x jsonb; q jsonb; decision jsonb; adv jsonb; lastinv jsonb;
 k text; arr text; uuid text; v integer; i integer; j integer; n integer; qty integer; total numeric; paid numeric; complete boolean; expected jsonb; sums jsonb; assetids jsonb; ids text[]:=ARRAY[]::text[];
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Procurement evidence is retained' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM prima.users WHERE id=uid FOR SHARE;
 IF NOT prima.ip_role(uid,'read') THEN RAISE EXCEPTION 'Current procurement access required' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='it_procurement_receipts' THEN
  IF TG_OP<>'INSERT' OR NOT prima.ip_shape(d,ARRAY['id','userId','requestId','kind','hash','outcome','recordId','version','message','at'],ARRAY['id','userId','requestId','kind','hash','outcome','at'],ARRAY[]::text[])
  OR NEW.id IS DISTINCT FROM d->>'id' OR d->>'userId' IS DISTINCT FROM uid OR d->>'requestId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  OR NEW.id IS DISTINCT FROM uid||':'||(d->>'requestId') OR d->>'hash' !~ '^[0-9a-f]{64}$' OR d->>'kind' NOT IN ('po','receipt','invoice','advance_request','advance_decision','payment') THEN RAISE EXCEPTION 'Invalid procurement receipt' USING ERRCODE='23514'; END IF;
  IF d->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR (d->>'at')::timestamptz NOT BETWEEN statement_timestamp()-interval '5 minutes' AND statement_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Receipt timestamp must be current server recording time' USING ERRCODE='23514'; END IF;
  SELECT z.data,oo.value INTO p,op FROM prima.it_procurement_packets z CROSS JOIN LATERAL jsonb_array_elements(z.data->'operations') oo WHERE oo.value->>'byId'=uid AND oo.value->>'requestId'=d->>'requestId';
  IF d->>'outcome'='committed' THEN
   IF p IS NULL OR NOT prima.ip_visible(p->>'id') OR op->>'hash' IS DISTINCT FROM d->>'hash' OR op->>'kind' IS DISTINCT FROM d->>'kind'
   OR jsonb_typeof(d->'recordId') IS DISTINCT FROM 'string' OR d->>'recordId' IS DISTINCT FROM p->>'id' OR jsonb_typeof(d->'version') IS DISTINCT FROM 'number' OR d->'version' IS DISTINCT FROM op->'version' OR d->'message' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Receipt must bind actual operation' USING ERRCODE='23514'; END IF;
  ELSIF d->>'outcome'='rejected' THEN
   IF p IS NOT NULL OR d->'recordId' IS DISTINCT FROM 'null'::jsonb OR d->'version' IS DISTINCT FROM 'null'::jsonb OR jsonb_typeof(d->'message') IS DISTINCT FROM 'string' OR length(d->>'message') NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Rejected operation cannot conceal committed work' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Invalid terminal outcome' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT prima.ip_shape(d,ARRAY['id','version','po','receipts','invoiceChecks','advances','payments','operations'],ARRAY['id'],ARRAY['version']) OR NEW.id IS DISTINCT FROM d->>'id' OR d->>'version' !~ '^[1-9][0-9]*$' OR (d->>'version')::numeric>10000 THEN RAISE EXCEPTION 'Invalid packet identity/version' USING ERRCODE='23514'; END IF;
 FOREACH arr IN ARRAY ARRAY['receipts','invoiceChecks','advances','payments','operations'] LOOP IF jsonb_typeof(d->arr) IS DISTINCT FROM 'array' OR jsonb_array_length(d->arr)>10000 THEN RAISE EXCEPTION 'Bounded packet arrays required' USING ERRCODE='23514'; END IF; END LOOP;
 SELECT data INTO p FROM prima.it_purchases WHERE id=NEW.id FOR UPDATE;
 SELECT data INTO auth FROM prima.it_purchase_finance_authorities WHERE id='merdeka' FOR SHARE;
 IF p IS NULL OR p->>'ownerId' IS DISTINCT FROM 'merdeka' OR auth IS NULL OR NOT prima.ip_visible(NEW.id) THEN RAISE EXCEPTION 'Configured current purchase access required' USING ERRCODE='42501'; END IF;
 v:=(d->>'version')::integer;
 IF TG_OP='UPDATE' THEN
  oldd:=OLD.data;
  IF NEW.id IS DISTINCT FROM OLD.id OR v<>(oldd->>'version')::integer+1 OR d->'po' IS DISTINCT FROM oldd->'po' THEN RAISE EXCEPTION 'Immutable PO and contiguous version required' USING ERRCODE='23514'; END IF;
 ELSE
  oldd:=jsonb_build_object('version',0,'receipts','[]'::jsonb,'invoiceChecks','[]'::jsonb,'advances','[]'::jsonb,'payments','[]'::jsonb,'operations','[]'::jsonb);
  IF v<>1 OR p->>'status' IS DISTINCT FROM 'finance' OR p->'received' IS DISTINCT FROM 'null'::jsonb OR coalesce(p#>>'{finance,paidRef}','')<>'' THEN RAISE EXCEPTION 'Only approved unpaid unreceived purchase may start' USING ERRCODE='23514'; END IF;
 END IF;
 IF jsonb_array_length(d->'operations')<>v OR (d->'operations')- (v-1) IS DISTINCT FROM oldd->'operations' THEN RAISE EXCEPTION 'Append-only operation history required' USING ERRCODE='23514'; END IF;
 op:=d->'operations'->(v-1); k:=op->>'kind'; uuid:=op->>'requestId';
 IF NOT prima.ip_shape(op,ARRAY['requestId','kind','hash','byId','version','at'],ARRAY['requestId','kind','hash','byId','at'],ARRAY['version']) OR op->>'byId' IS DISTINCT FROM uid OR op->'version' IS DISTINCT FROM d->'version'
 OR uuid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR op->>'hash' !~ '^[0-9a-f]{64}$' OR k NOT IN ('po','receipt','invoice','advance_request','advance_decision','payment') THEN RAISE EXCEPTION 'Invalid operation binding' USING ERRCODE='23514'; END IF;
 IF op->>'at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' OR (op->>'at')::timestamptz NOT BETWEEN statement_timestamp()-interval '5 minutes' AND statement_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'Current server timestamp required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM prima.it_procurement_receipts WHERE id=uid||':'||uuid) OR EXISTS(SELECT 1 FROM prima.it_procurement_packets z CROSS JOIN LATERAL jsonb_array_elements(z.data->'operations') oo WHERE oo.value->>'byId'=uid AND oo.value->>'requestId'=uuid) THEN RAISE EXCEPTION 'Operation UUID already terminal or committed' USING ERRCODE='23514'; END IF;
 IF d#>>'{po,purchaseHash}' IS DISTINCT FROM prima.ip_purchase_hash(p) OR d#>>'{po,authorityHash}' IS DISTINCT FROM prima.ip_hash(auth) OR d#>'{po,authorityVersion}' IS DISTINCT FROM auth->'version' THEN RAISE EXCEPTION 'Purchase or Finance authority changed' USING ERRCODE='23514'; END IF;
 input:=prima.ip_input(d,op);
 IF input IS NULL OR prima.ip_hash(jsonb_build_object('kind',k,'input',input)) IS DISTINCT FROM op->>'hash' THEN RAISE EXCEPTION 'Exact operation input hash required' USING ERRCODE='23514'; END IF;
 -- Exactly one target event may change; the others retain their complete prior values.
 FOREACH arr IN ARRAY ARRAY['receipts','invoiceChecks','advances','payments'] LOOP
  IF arr IS DISTINCT FROM (CASE k WHEN 'receipt' THEN 'receipts' WHEN 'invoice' THEN 'invoiceChecks' WHEN 'advance_request' THEN 'advances' WHEN 'advance_decision' THEN 'advances' WHEN 'payment' THEN 'payments' ELSE '' END)
  AND d->arr IS DISTINCT FROM oldd->arr THEN RAISE EXCEPTION 'Unrelated event history changed' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF k='po' THEN
  e:=d->'po';
  IF jsonb_typeof(p->'managerStep') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'cooStep') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'ceoStep') IS DISTINCT FROM 'object' OR jsonb_typeof(p#>'{ceoStep,at}') IS DISTINCT FROM 'string' OR coalesce(p#>>'{ceoStep,at}','') !~ '^\d{4}-\d{2}-\d{2}T' THEN RAISE EXCEPTION 'Present approval records and valid approval date required' USING ERRCODE='23514'; END IF;
  PERFORM (p#>>'{ceoStep,at}')::timestamptz;
  IF TG_OP<>'INSERT' OR NOT prima.ip_role(uid,'finance') OR NOT prima.ip_shape(e,ARRAY['id','revision','ref','issuedOn','supplier','purchaseHash','authorityVersion','authorityHash','currency','items','total','evidence','byId','at'],ARRAY['id','ref','issuedOn','supplier','purchaseHash','authorityHash','currency','evidence','byId','at'],ARRAY['revision','authorityVersion','total'])
  OR e->>'id' IS DISTINCT FROM 'po:'||uuid OR e->'revision' IS DISTINCT FROM '1'::jsonb OR e->>'byId' IS DISTINCT FROM uid OR e->'at' IS DISTINCT FROM op->'at' OR e->>'issuedOn' !~ '^\d{4}-\d{2}-\d{2}$' OR (e->>'issuedOn')::date>(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR (e->>'issuedOn')::date<((p#>>'{ceoStep,at}')::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR e->>'currency'<>'MYR' OR length(e->>'ref') NOT BETWEEN 3 AND 120 OR length(e->>'evidence') NOT BETWEEN 3 AND 500
  OR jsonb_typeof(p->'quotes') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'quotes')<3 OR jsonb_typeof(p->'online') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'online')<1 OR p->'managerStep'='null'::jsonb OR p#>>'{cooStep,decision}' IS DISTINCT FROM 'approve' OR p#>>'{ceoStep,decision}' IS DISTINCT FROM 'approve'
  OR jsonb_typeof(p#>'{chosen,index}') IS DISTINCT FROM 'number' OR p#>>'{chosen,index}' !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Exact approved PO and assigned Finance required' USING ERRCODE='23514'; END IF;
  IF (SELECT count(DISTINCT lower(btrim(qq.value->>'supplier'))) FROM jsonb_array_elements(p->'quotes') qq WHERE jsonb_typeof(qq.value->'proof')='array' AND jsonb_array_length(qq.value->'proof')>0)<3
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'online') oo WHERE jsonb_typeof(oo.value->'proof')='array' AND jsonb_array_length(oo.value->'proof')>0 AND oo.value->>'ref' LIKE 'https://%') THEN RAISE EXCEPTION 'Three evidenced suppliers and one online comparison required' USING ERRCODE='23514'; END IF;
  q:=p->'quotes'->(p#>>'{chosen,index}')::integer;
  IF q IS NULL OR e->'supplier' IS DISTINCT FROM q->'supplier' OR e->'total' IS DISTINCT FROM q->'amount' OR e->'total' IS DISTINCT FROM p->'total' OR jsonb_typeof(e->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'items') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Selected quote and PO amounts must agree' USING ERRCODE='23514'; END IF;
  total:=0;i:=0;
  FOR x IN SELECT value FROM jsonb_array_elements(e->'items') LOOP
   IF NOT prima.ip_shape(x,ARRAY['index','kind','description','qty','unitPrice'],ARRAY['kind','description'],ARRAY['index','qty','unitPrice']) OR x->'index' IS DISTINCT FROM to_jsonb(i) OR x-ARRAY['index'] IS DISTINCT FROM p->'items'->i
   OR x->>'kind' NOT IN ('LAPTOP','DESKTOP','PHONE','TABLET','PRINTER','NETWORK','CCTV','OTHER') OR length(x->>'description') NOT BETWEEN 3 AND 120 OR x->>'qty' !~ '^[1-9][0-9]*$' OR (x->>'qty')::numeric>1000 OR (x->>'unitPrice')::numeric<0 OR (x->>'unitPrice')::numeric>10000000 OR (x->>'unitPrice')::numeric*100<>trunc((x->>'unitPrice')::numeric*100) THEN RAISE EXCEPTION 'Exact indexed PO lines required' USING ERRCODE='23514'; END IF;
   total:=total+(x->>'qty')::numeric*(x->>'unitPrice')::numeric; i:=i+1;
  END LOOP;
  IF i<>jsonb_array_length(p->'items') OR total<>(e->>'total')::numeric OR total<=0 OR total>10000000 OR (SELECT sum((li.value->>'qty')::numeric) FROM jsonb_array_elements(e->'items') li)>1000 THEN RAISE EXCEPTION 'PO total mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'PO must precede operational events' USING ERRCODE='23514'; END IF;
  arr:=CASE k WHEN 'receipt' THEN 'receipts' WHEN 'invoice' THEN 'invoiceChecks' WHEN 'advance_request' THEN 'advances' WHEN 'payment' THEN 'payments' ELSE '' END;
  IF k<>'advance_decision' THEN
   n:=jsonb_array_length(oldd->arr); e:=d->arr->n;
   IF jsonb_array_length(d->arr)<>n+1 OR (d->arr)-n IS DISTINCT FROM oldd->arr OR e->>'id' IS DISTINCT FROM uuid OR e->>'byId' IS DISTINCT FROM uid OR e->'at' IS DISTINCT FROM op->'at' THEN RAISE EXCEPTION 'One immutable appended event required' USING ERRCODE='23514'; END IF;
  END IF;
  IF k='receipt' THEN
   IF NOT prima.ip_role(uid,'it') OR NOT prima.ip_shape(e,ARRAY['id','ref','receivedOn','qty','location','evidence','assetIds','byId','at'],ARRAY['id','ref','receivedOn','location','evidence','byId','at'],ARRAY[]::text[]) OR length(e->>'ref') NOT BETWEEN 3 AND 120 OR length(e->>'evidence') NOT BETWEEN 3 AND 500 OR length(e->>'location') NOT BETWEEN 3 AND 160
   OR e->>'receivedOn' !~ '^\d{4}-\d{2}-\d{2}$' OR (e->>'receivedOn')::date<(d#>>'{po,issuedOn}')::date OR (e->>'receivedOn')::date>(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR jsonb_typeof(e->'qty') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'qty')<>jsonb_array_length(d#>'{po,items}') OR jsonb_typeof(e->'assetIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Actual bounded receipt evidence required' USING ERRCODE='23514'; END IF;
   assetids:='[]'::jsonb; total:=0;
   FOR i IN 0..jsonb_array_length(e->'qty')-1 LOOP
    IF jsonb_typeof(e->'qty'->i) IS DISTINCT FROM 'number' OR e->'qty'->>i !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Receipt quantities are nonnegative integers' USING ERRCODE='23514'; END IF;
    qty:=(e->'qty'->>i)::integer;
    SELECT coalesce(sum((rr.value->'qty'->>i)::integer),0) INTO j FROM jsonb_array_elements(oldd->'receipts') rr;
    IF qty+j>(d#>'{po,items}'->i->>'qty')::integer THEN RAISE EXCEPTION 'Over receipt prohibited' USING ERRCODE='23514'; END IF;
    IF qty>0 THEN FOR n IN 0..qty-1 LOOP assetids:=assetids||jsonb_build_array('ita:'||NEW.id||':'||uuid||':'||i||':'||n); END LOOP; END IF;
    total:=total+qty;
   END LOOP;
   IF total=0 OR e->'assetIds' IS DISTINCT FROM assetids OR EXISTS(SELECT 1 FROM jsonb_array_elements(oldd->'receipts') rr WHERE lower(rr.value->>'ref')=lower(e->>'ref')) THEN RAISE EXCEPTION 'Unique actual receipt and exact stock IDs required' USING ERRCODE='23514'; END IF;
  ELSIF k='invoice' THEN
   IF NOT prima.ip_role(uid,'finance') OR NOT prima.ip_shape(e,ARRAY['id','ref','invoiceOn','supplier','amount','qty','unitPrices','evidence','matched','byId','at'],ARRAY['id','ref','invoiceOn','supplier','evidence','byId','at'],ARRAY['amount']) OR jsonb_typeof(e->'matched') IS DISTINCT FROM 'boolean' OR jsonb_typeof(e->'qty') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'qty')<>jsonb_array_length(d#>'{po,items}') OR jsonb_typeof(e->'unitPrices') IS DISTINCT FROM 'array' OR jsonb_array_length(e->'unitPrices')<>jsonb_array_length(e->'qty') OR e->>'invoiceOn' !~ '^\d{4}-\d{2}-\d{2}$' OR (e->>'invoiceOn')::date<(d#>>'{po,issuedOn}')::date OR (e->>'invoiceOn')::date>(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR length(e->>'ref') NOT BETWEEN 3 AND 120 OR length(e->>'evidence') NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Assigned Finance invoice evidence required' USING ERRCODE='23514'; END IF;
   complete:=true;
   FOR i IN 0..jsonb_array_length(e->'qty')-1 LOOP
    IF jsonb_typeof(e->'qty'->i) IS DISTINCT FROM 'number' OR e->'qty'->>i !~ '^[0-9]+$' OR (e->'qty'->>i)::numeric>1000 OR jsonb_typeof(e->'unitPrices'->i) IS DISTINCT FROM 'number' OR (e->'unitPrices'->>i)::numeric<0 OR (e->'unitPrices'->>i)::numeric>10000000 OR (e->'unitPrices'->>i)::numeric*100<>trunc((e->'unitPrices'->>i)::numeric*100) THEN RAISE EXCEPTION 'Invoice quantity invalid' USING ERRCODE='23514'; END IF;
    SELECT coalesce(sum((rr.value->'qty'->>i)::integer),0) INTO j FROM jsonb_array_elements(d->'receipts') rr;
    complete:=complete AND j=(d#>'{po,items}'->i->>'qty')::integer AND e->'qty'->i=d#>'{po,items}'->i->'qty' AND e->'unitPrices'->i=d#>'{po,items}'->i->'unitPrice';
   END LOOP;
   complete:=complete AND e->'supplier'=d#>'{po,supplier}' AND e->'amount'=d#>'{po,total}';
   IF e->'matched' IS DISTINCT FROM to_jsonb(complete) OR (e->>'amount')::numeric<0 OR (e->>'amount')::numeric>10000000 OR (e->>'amount')::numeric*100<>trunc((e->>'amount')::numeric*100) THEN RAISE EXCEPTION 'Invoice match must reflect actual PO and receipt' USING ERRCODE='23514'; END IF;
  ELSIF k='advance_request' THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(oldd->'advances') aa WHERE coalesce(aa.value#>>'{coo,decision}','')<>'reject' AND coalesce(aa.value#>>'{ceo,decision}','')<>'reject' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(oldd->'payments') pp WHERE pp.value->>'advanceId'=aa.value->>'id')) THEN RAISE EXCEPTION 'Resolve the existing advance first' USING ERRCODE='23514'; END IF;
   IF NOT (prima.ip_role(uid,'it') OR prima.ip_role(uid,'finance')) OR NOT prima.ip_shape(e,ARRAY['id','poId','poRevision','supplier','amount','reason','terms','byId','at','coo','ceo'],ARRAY['id','poId','supplier','reason','terms','byId','at'],ARRAY['poRevision','amount']) OR e->'poId' IS DISTINCT FROM d#>'{po,id}' OR e->'poRevision' IS DISTINCT FROM d#>'{po,revision}' OR e->'supplier' IS DISTINCT FROM d#>'{po,supplier}' OR e->'coo' IS DISTINCT FROM 'null'::jsonb OR e->'ceo' IS DISTINCT FROM 'null'::jsonb OR length(e->>'reason') NOT BETWEEN 3 AND 500 OR length(e->>'terms') NOT BETWEEN 3 AND 500 OR (e->>'amount')::numeric<=0 OR (e->>'amount')::numeric>(d#>>'{po,total}')::numeric-(SELECT coalesce(sum((pp.value->>'amount')::numeric),0) FROM jsonb_array_elements(oldd->'payments') pp) OR (e->>'amount')::numeric*100<>trunc((e->>'amount')::numeric*100) THEN RAISE EXCEPTION 'Separate exact PO advance request required' USING ERRCODE='23514'; END IF;
  ELSIF k='advance_decision' THEN
   IF jsonb_array_length(d->'advances')<>jsonb_array_length(oldd->'advances') THEN RAISE EXCEPTION 'Existing advance decision required' USING ERRCODE='23514'; END IF;
   n:=0;
   FOR i IN 0..jsonb_array_length(d->'advances')-1 LOOP
    e:=d->'advances'->i; prev:=oldd->'advances'->i;
    IF e IS DISTINCT FROM prev THEN
     n:=n+1;
     IF e-ARRAY['coo','ceo'] IS DISTINCT FROM prev-ARRAY['coo','ceo'] OR e->>'byId'=uid THEN RAISE EXCEPTION 'Advance terms immutable and no self approval' USING ERRCODE='23514'; END IF;
     IF prev->'coo'='null'::jsonb THEN
      decision:=e->'coo';
      IF NOT prima.ip_role(uid,'coo') OR e->'ceo' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'Current COO first' USING ERRCODE='23514'; END IF;
     ELSE
      decision:=e->'ceo';
      PERFORM 1 FROM prima.users WHERE id=prev#>>'{coo,byId}' FOR SHARE;
      IF prev->'ceo' IS DISTINCT FROM 'null'::jsonb OR e->'coo' IS DISTINCT FROM prev->'coo' OR prev#>>'{coo,decision}' IS DISTINCT FROM 'approve' OR NOT prima.ip_role(prev#>>'{coo,byId}','coo') OR NOT prima.ip_role(uid,'ceo') OR uid=prev#>>'{coo,byId}' THEN RAISE EXCEPTION 'Distinct current CEO after current COO approval' USING ERRCODE='23514'; END IF;
     END IF;
     IF NOT prima.ip_shape(decision,ARRAY['requestId','byId','decision','comment','at'],ARRAY['requestId','byId','decision','comment','at'],ARRAY[]::text[]) OR decision->>'requestId' IS DISTINCT FROM uuid OR decision->>'byId' IS DISTINCT FROM uid OR decision->'at' IS DISTINCT FROM op->'at' OR decision->>'decision' NOT IN ('approve','reject') OR length(decision->>'comment') NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Exact decision evidence required' USING ERRCODE='23514'; END IF;
    END IF;
   END LOOP;
   IF n<>1 THEN RAISE EXCEPTION 'Exactly one advance decision required' USING ERRCODE='23514'; END IF;
  ELSIF k='payment' THEN
   IF NOT prima.ip_role(uid,'finance') OR NOT prima.ip_shape(e,ARRAY['id','ref','paidOn','amount','evidence','advanceId','byId','at'],ARRAY['id','ref','paidOn','evidence','byId','at'],ARRAY['amount']) OR jsonb_typeof(e->'advanceId') NOT IN ('string','null') OR length(e->>'ref') NOT BETWEEN 3 AND 120 OR length(e->>'evidence') NOT BETWEEN 3 AND 500 OR e->>'paidOn' !~ '^\d{4}-\d{2}-\d{2}$' OR (e->>'paidOn')::date>(now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR (e->>'amount')::numeric<=0 OR (e->>'amount')::numeric*100<>trunc((e->>'amount')::numeric*100) THEN RAISE EXCEPTION 'Assigned Finance payment reference required' USING ERRCODE='23514'; END IF;
   SELECT coalesce(sum((pp.value->>'amount')::numeric),0) INTO paid FROM jsonb_array_elements(oldd->'payments') pp;
   IF paid+(e->>'amount')::numeric>(d#>>'{po,total}')::numeric OR EXISTS(SELECT 1 FROM jsonb_array_elements(oldd->'payments') pp WHERE lower(pp.value->>'ref')=lower(e->>'ref')) THEN RAISE EXCEPTION 'Duplicate or excessive payment recording' USING ERRCODE='23514'; END IF;
   IF e->'advanceId'='null'::jsonb THEN
    lastinv:=d->'invoiceChecks'->(jsonb_array_length(d->'invoiceChecks')-1);
    IF lastinv IS NULL OR lastinv->'matched' IS DISTINCT FROM 'true'::jsonb OR paid+(e->>'amount')::numeric<>(d#>>'{po,total}')::numeric OR (e->>'paidOn')::date<(lastinv->>'invoiceOn')::date OR (e->>'paidOn')::date<((lastinv->>'at')::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date THEN RAISE EXCEPTION 'Latest complete three-way invoice match required' USING ERRCODE='23514'; END IF;
   ELSE
    SELECT value INTO adv FROM jsonb_array_elements(d->'advances') WHERE value->>'id'=e->>'advanceId';
    PERFORM 1 FROM prima.users WHERE id IN (adv#>>'{coo,byId}',adv#>>'{ceo,byId}') ORDER BY id FOR SHARE;
    IF adv IS NULL OR (e->>'paidOn')::date<((adv#>>'{ceo,at}')::timestamptz AT TIME ZONE 'Asia/Kuala_Lumpur')::date OR adv#>>'{coo,decision}' IS DISTINCT FROM 'approve' OR adv#>>'{ceo,decision}' IS DISTINCT FROM 'approve' OR NOT prima.ip_role(adv#>>'{coo,byId}','coo') OR NOT prima.ip_role(adv#>>'{ceo,byId}','ceo') OR adv->'amount' IS DISTINCT FROM e->'amount' OR adv#>>'{coo,byId}'=adv#>>'{ceo,byId}' OR adv->>'byId' IN (adv#>>'{coo,byId}',adv#>>'{ceo,byId}') OR EXISTS(SELECT 1 FROM jsonb_array_elements(oldd->'payments') pp WHERE pp.value->>'advanceId'=e->>'advanceId') THEN RAISE EXCEPTION 'Unused exact advance with current distinct approvals required' USING ERRCODE='23514'; END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END
$$;
-- Receipt/event atomicity: no domain operation can commit without its own matching terminal receipt.
CREATE FUNCTION prima.ip_terminal_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE op jsonb; r jsonb; delivery jsonb; stock jsonb; purchase jsonb; ids jsonb;
BEGIN
 FOR op IN SELECT value FROM jsonb_array_elements(NEW.data->'operations') LOOP
 SELECT data INTO r FROM prima.it_procurement_receipts WHERE id=(op->>'byId')||':'||(op->>'requestId');
 IF r IS NULL OR r->>'outcome' IS DISTINCT FROM 'committed' OR r->>'recordId' IS DISTINCT FROM NEW.id OR r->'version' IS DISTINCT FROM op->'version' OR r->'hash' IS DISTINCT FROM op->'hash' OR r->'kind' IS DISTINCT FROM op->'kind' THEN RAISE EXCEPTION 'Procurement event requires its exact terminal receipt' USING ERRCODE='23514'; END IF;
 END LOOP;
 op:=NEW.data->'operations'->(jsonb_array_length(NEW.data->'operations')-1);
 IF op->>'kind'='receipt' THEN
  SELECT value INTO delivery FROM jsonb_array_elements(NEW.data->'receipts') WHERE value->>'id'=op->>'requestId';
  SELECT data INTO purchase FROM prima.it_purchases WHERE id=NEW.id;
  SELECT coalesce(jsonb_agg(ai.value ORDER BY rr.ord,ai.ord),'[]'::jsonb) INTO ids FROM jsonb_array_elements(NEW.data->'receipts') WITH ORDINALITY rr(value,ord) CROSS JOIN LATERAL jsonb_array_elements(rr.value->'assetIds') WITH ORDINALITY ai(value,ord);
  IF purchase IS NULL OR purchase#>'{received,assetIds}' IS DISTINCT FROM ids THEN RAISE EXCEPTION 'Receipt requires actual purchase projection' USING ERRCODE='23514'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(delivery->'assetIds') LOOP
   SELECT data INTO stock FROM prima.it_assets WHERE id=r#>>'{}';
   IF stock IS NULL OR NOT prima.ip_asset_admitted(stock) THEN RAISE EXCEPTION 'Receipt cannot commit without its actual stock rows' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 RETURN NULL;
END
$$;
CREATE FUNCTION prima.ip_purchase_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE packet jsonb; ids jsonb; fullreceipt boolean; i integer; qty integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 SELECT data INTO packet FROM prima.it_procurement_packets WHERE id=OLD.id;
 IF packet IS NULL THEN IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
 IF NOT prima.ip_role(current_setting('app.user_id',true),'it') OR packet->'operations'->(jsonb_array_length(packet->'operations')-1)->>'kind' IS DISTINCT FROM 'receipt' OR packet->'operations'->(jsonb_array_length(packet->'operations')-1)->>'byId' IS DISTINCT FROM current_setting('app.user_id',true) THEN RAISE EXCEPTION 'Only actual current receipt actor projects tracked purchase' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tracked purchase retained' USING ERRCODE='23514'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.data-ARRAY['status','received'] IS DISTINCT FROM OLD.data-ARRAY['status','received'] THEN RAISE EXCEPTION 'Tracked purchase changes only through immutable packet' USING ERRCODE='23514'; END IF;
 SELECT coalesce(jsonb_agg(ai.value ORDER BY rr.ord,ai.ord),'[]'::jsonb) INTO ids FROM jsonb_array_elements(packet->'receipts') WITH ORDINALITY rr(value,ord) CROSS JOIN LATERAL jsonb_array_elements(rr.value->'assetIds') WITH ORDINALITY ai(value,ord);
 IF jsonb_array_length(ids)=0 THEN RAISE EXCEPTION 'No actual receipt projection available' USING ERRCODE='23514'; END IF;
 fullreceipt:=true;
 FOR i IN 0..jsonb_array_length(packet#>'{po,items}')-1 LOOP
 SELECT coalesce(sum((rr.value->'qty'->>i)::integer),0) INTO qty FROM jsonb_array_elements(packet->'receipts') rr;
 fullreceipt:=fullreceipt AND qty=(packet#>'{po,items}'->i->>'qty')::integer;
 END LOOP;
 IF NOT prima.ip_shape(NEW.data->'received',ARRAY['by','at','assetIds'],ARRAY['by','at'],ARRAY[]::text[]) OR jsonb_typeof(NEW.data#>'{received,assetIds}') IS DISTINCT FROM 'array' OR NEW.data->>'status' IS DISTINCT FROM (CASE WHEN fullreceipt THEN 'received' ELSE 'partially_received' END)
 OR NEW.data#>'{received,assetIds}' IS DISTINCT FROM ids OR NEW.data#>'{received,at}' IS DISTINCT FROM packet->'receipts'->(jsonb_array_length(packet->'receipts')-1)->'at'
 OR NEW.data#>>'{received,by}' IS DISTINCT FROM (SELECT data->>'name' FROM prima.users WHERE id=packet->'receipts'->(jsonb_array_length(packet->'receipts')-1)->>'byId') THEN RAISE EXCEPTION 'Purchase receipt projection must reflect actual cumulative delivery' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$$;
CREATE FUNCTION prima.ip_asset_admitted(d jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
DECLARE p jsonb; q jsonb; r jsonb; line jsonb; i integer; found boolean:=false;
BEGIN
 IF NOT prima.ip_role(current_setting('app.user_id',true),'it') OR NOT prima.ip_visible(d->>'purchaseId') THEN RETURN false; END IF;
 SELECT data INTO p FROM prima.it_purchases WHERE id=d->>'purchaseId'; SELECT data INTO q FROM prima.it_procurement_packets WHERE id=d->>'purchaseId';
 IF p IS NULL OR q IS NULL OR jsonb_typeof(p#>'{received,assetIds}') IS DISTINCT FROM 'array' OR NOT coalesce(p#>'{received,assetIds}' ? (d->>'id'),false) OR d->>'ownerId' IS DISTINCT FROM p->>'ownerId' OR d->>'status' IS DISTINCT FROM 'spare' OR d->'assignedTo' IS DISTINCT FROM 'null'::jsonb OR d->>'serial' IS DISTINCT FROM '' OR d->>'boughtOn' IS DISTINCT FROM '' OR d->'warrantyTo' IS DISTINCT FROM 'null'::jsonb OR d->'lastCheckedOn' IS DISTINCT FROM 'null'::jsonb OR d->'nextServiceOn' IS DISTINCT FROM 'null'::jsonb OR d->'disposal' IS DISTINCT FROM 'null'::jsonb OR d->'maintenance' IS DISTINCT FROM '[]'::jsonb THEN RETURN false; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(q->'receipts') LOOP
  IF r->'assetIds' ? (d->>'id') THEN
   FOR i IN 0..jsonb_array_length(q#>'{po,items}')-1 LOOP
    line:=q#>'{po,items}'->i;
    IF EXISTS(SELECT 1 FROM generate_series(0,(r->'qty'->>i)::integer-1) unit WHERE d->>'id'='ita:'||(p->>'id')||':'||(r->>'id')||':'||i||':'||unit)
    AND d->'kind'=line->'kind' AND d->'model'=line->'description' AND d->'location'=r->'location' THEN found:=true; END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN coalesce(found,false);
END
$$;
CREATE FUNCTION prima.ip_stock_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, prima AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('it-manual:create'));
 IF EXISTS(SELECT 1 FROM prima.it_procurement_packets WHERE id=NEW.data->>'purchaseId') AND NOT prima.ip_asset_admitted(NEW.data) THEN RAISE EXCEPTION 'Stock must match actual procurement receipt without invented service evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END
$$;
CREATE TRIGGER ip_authority_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.it_purchase_finance_authorities FOR EACH ROW EXECUTE FUNCTION prima.ip_authority_guard();
CREATE TRIGGER ip_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.it_procurement_packets FOR EACH ROW EXECUTE FUNCTION prima.ip_guard();
CREATE TRIGGER ip_guard BEFORE INSERT OR UPDATE OR DELETE ON prima.it_procurement_receipts FOR EACH ROW EXECUTE FUNCTION prima.ip_guard();
CREATE CONSTRAINT TRIGGER ip_terminal_guard AFTER INSERT OR UPDATE ON prima.it_procurement_packets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION prima.ip_terminal_guard();
CREATE TRIGGER ip_purchase_guard BEFORE UPDATE OR DELETE ON prima.it_purchases FOR EACH ROW EXECUTE FUNCTION prima.ip_purchase_guard();
CREATE TRIGGER ip_stock_guard BEFORE INSERT ON prima.it_assets FOR EACH ROW EXECUTE FUNCTION prima.ip_stock_guard();
DO $$ DECLARE f regprocedure; BEGIN
 FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='prima' AND p.proname LIKE 'ip\_%' ESCAPE '\' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,prima_app',f); END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION prima.ip_visible(text),prima.ip_role(text,text),prima.ip_asset_admitted(jsonb) TO prima_app;
DO $$ DECLARE t text; ownername text:=current_user; BEGIN
 FOREACH t IN ARRAY ARRAY['it_purchase_finance_authorities','it_procurement_packets','it_procurement_receipts'] LOOP
 EXECUTE format('ALTER TABLE prima.%I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE prima.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON prima.%I FROM PUBLIC,prima_app',t);
 EXECUTE format('GRANT SELECT ON prima.%I TO prima_app',t);
 EXECUTE format('CREATE POLICY ip_setup ON prima.%I FOR ALL TO %I USING(true) WITH CHECK(true)',t,ownername);
 END LOOP;
END $$;
CREATE POLICY ip_read ON prima.it_purchase_finance_authorities FOR SELECT USING(prima.ip_role(current_setting('app.user_id',true),'read'));
CREATE POLICY ip_read ON prima.it_procurement_packets FOR SELECT USING(prima.ip_visible(id));
CREATE POLICY ip_write ON prima.it_procurement_packets FOR ALL USING(prima.ip_visible(id)) WITH CHECK(prima.ip_visible(id));
CREATE POLICY ip_read ON prima.it_procurement_receipts FOR SELECT USING(data->>'userId'=current_setting('app.user_id',true) AND prima.ip_role(current_setting('app.user_id',true),'read'));
CREATE POLICY ip_insert ON prima.it_procurement_receipts FOR INSERT WITH CHECK(data->>'userId'=current_setting('app.user_id',true) AND prima.ip_role(current_setting('app.user_id',true),'read'));
GRANT INSERT,UPDATE ON prima.it_procurement_packets TO prima_app;
GRANT INSERT ON prima.it_procurement_receipts TO prima_app;
COMMIT;

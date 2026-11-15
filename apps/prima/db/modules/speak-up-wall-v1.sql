-- Speak-up (whistleblowing) reports database wall (Fitri package H2, approved by Fauzan 11 Nov 2026: "Yes. But HR can
-- see it."). Before this module prima.whistle_reports had no row-level security: any API session could read every
-- report at database level. After it:
--   * the handler reads and updates their reports; a second handler reads and updates one only while it is 'closing'
--     and only when not the first handler, not the reporter and not named in it (and keeps reading what they reviewed);
--   * a named reporter reads their own reports; an anonymous reporter comes back only by receipt code, through
--     prima.speak_up_by_code / prima.speak_up_append (status, outcome and messages of that one report);
--   * HR (staff behind the speak_up_hr wall) reads reports, never one where they are named; HR never updates;
--   * group leaders and ACT get timings only (no text) through prima.speak_up_meta, for counts;
--   * report numbers come from a sequence (a reporter cannot count reports they cannot see).
-- Handlers are listed in prima.speak_up_handlers (the same ids as rule GRC whistleHandlers). Run by the CEO.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.speak_up_handlers (user_id text PRIMARY KEY CHECK (length(user_id) BETWEEN 1 AND 120));
INSERT INTO prima.speak_up_handlers (user_id) VALUES ('u-audit'), ('u-chair'), ('u-vchair') ON CONFLICT DO NOTHING;
REVOKE ALL ON prima.speak_up_handlers FROM PUBLIC, prima_app;
GRANT SELECT ON prima.speak_up_handlers TO prima_app;

CREATE SEQUENCE IF NOT EXISTS prima.speak_up_seq;
REVOKE ALL ON SEQUENCE prima.speak_up_seq FROM PUBLIC, prima_app;
SELECT setval('prima.speak_up_seq', greatest((SELECT count(*) FROM prima.whistle_reports), 1), (SELECT count(*) FROM prima.whistle_reports) > 0);

ALTER TABLE prima.whistle_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.whistle_reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.whistle_reports FROM PUBLIC;
REVOKE DELETE ON prima.whistle_reports FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.whistle_reports TO prima_app;

CREATE OR REPLACE FUNCTION prima.speak_up_uid() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '') $$;

CREATE OR REPLACE FUNCTION prima.speak_up_second_handler(r jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT prima.speak_up_uid() IS NOT NULL
     AND EXISTS (SELECT 1 FROM prima.speak_up_handlers h WHERE h.user_id = prima.speak_up_uid())
     AND r->>'handlerId' IS DISTINCT FROM prima.speak_up_uid()
     AND r->>'reporterId' IS DISTINCT FROM prima.speak_up_uid()
     AND NOT coalesce(r->'implicatedUserIds', '[]'::jsonb) ? prima.speak_up_uid()
$$;

DROP POLICY IF EXISTS speak_up_read ON prima.whistle_reports;
CREATE POLICY speak_up_read ON prima.whistle_reports FOR SELECT TO prima_app USING (
  prima.speak_up_uid() IS NOT NULL AND (
    data->>'handlerId' = prima.speak_up_uid()
    OR data->>'reporterId' = prima.speak_up_uid()
    OR (data->>'status' = 'closing' AND prima.speak_up_second_handler(data))
    OR (data->'closeReview'->>'byId' = prima.speak_up_uid() AND prima.speak_up_second_handler(data))
    OR ('speak_up_hr' = ANY (string_to_array(current_setting('app.walls', true), ','))
        AND NOT coalesce(data->'implicatedUserIds', '[]'::jsonb) ? prima.speak_up_uid())
  ));
DROP POLICY IF EXISTS speak_up_update ON prima.whistle_reports;
CREATE POLICY speak_up_update ON prima.whistle_reports FOR UPDATE TO prima_app
  USING (prima.speak_up_uid() IS NOT NULL AND (data->>'handlerId' = prima.speak_up_uid() OR (data->>'status' = 'closing' AND prima.speak_up_second_handler(data))))
  WITH CHECK (prima.speak_up_uid() IS NOT NULL AND (data->>'handlerId' = prima.speak_up_uid() OR prima.speak_up_second_handler(data)));
DROP POLICY IF EXISTS speak_up_insert ON prima.whistle_reports;
CREATE POLICY speak_up_insert ON prima.whistle_reports FOR INSERT TO prima_app
  WITH CHECK (prima.speak_up_uid() IS NOT NULL AND data->>'status' = 'received' AND coalesce(data->'messages', '[]'::jsonb) = '[]'::jsonb);
-- The module owner runs the receipt-code functions below.
DO $$ BEGIN
  EXECUTE 'DROP POLICY IF EXISTS speak_up_owner ON prima.whistle_reports';
  EXECUTE format('CREATE POLICY speak_up_owner ON prima.whistle_reports FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
END $$;

-- Receipt code: where one report stands, nothing about the reporter, the handler's notes or who is named.
CREATE OR REPLACE FUNCTION prima.speak_up_by_code(p_code text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = prima, pg_temp AS $$
  SELECT jsonb_build_object('id', id, 'code', data->'code', 'at', data->'at', 'status', data->'status',
           'outcome', CASE WHEN data->>'status' = 'closed' THEN data->'outcome' ELSE 'null'::jsonb END,
           'closedAt', data->'closedAt', 'handlerName', data->'handlerName',
           'messages', coalesce(data->'messages', '[]'::jsonb))
    FROM prima.whistle_reports
   WHERE prima.speak_up_uid() IS NOT NULL AND length(p_code) BETWEEN 4 AND 20 AND data->>'code' = upper(btrim(p_code))
$$;

-- Receipt code: the reporter's answer or retaliation report, appended while the row is held (replies at once are kept).
CREATE OR REPLACE FUNCTION prima.speak_up_append(p_code text, p_message jsonb, p_note jsonb, p_after_close_days int, p_today date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = prima, pg_temp AS $$
DECLARE r record; retal boolean := coalesce((p_message->>'retaliation')::boolean, false); st text; d jsonb;
BEGIN
  IF prima.speak_up_uid() IS NULL OR length(p_code) NOT BETWEEN 4 AND 20 THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF p_message->>'from' IS DISTINCT FROM 'reporter' OR length(coalesce(p_message->>'text', '')) NOT BETWEEN 10 AND 2000 THEN RETURN jsonb_build_object('error', 'bad_message'); END IF;
  SELECT id, data INTO r FROM prima.whistle_reports WHERE data->>'code' = upper(btrim(p_code)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  st := r.data->>'status';
  IF st = 'closed' AND (r.data->>'closedAt' IS NULL OR p_today - (left(r.data->>'closedAt', 10))::date > p_after_close_days) THEN RETURN jsonb_build_object('error', 'closed_too_long'); END IF;
  IF st = 'closed' AND NOT retal THEN RETURN jsonb_build_object('error', 'closed'); END IF;
  d := jsonb_set(r.data, '{messages}', coalesce(r.data->'messages', '[]'::jsonb) || jsonb_build_array(p_message));
  IF retal AND st IN ('closed', 'closing') THEN
    d := jsonb_set(jsonb_set(d, '{status}', '"investigating"'), '{notes}', coalesce(d->'notes', '[]'::jsonb) || jsonb_build_array(p_note));
  END IF;
  UPDATE prima.whistle_reports SET data = d WHERE id = r.id;
  RETURN jsonb_build_object('id', r.id, 'code', r.data->'code', 'handlerName', r.data->'handlerName');
END $$;

-- Counts for group leaders and ACT: timings and who wrote last, never any text, names or ids.
CREATE OR REPLACE FUNCTION prima.speak_up_meta() RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = prima, pg_temp AS $$
  SELECT jsonb_build_object('at', data->'at', 'status', data->'status', 'acknowledgedAt', data->'acknowledgedAt', 'closedAt', data->'closedAt',
           'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('at', m->'at', 'from', m->'from', 'retaliation', coalesce(m->'retaliation', 'false'::jsonb)))
                                  FROM jsonb_array_elements(coalesce(data->'messages', '[]'::jsonb)) m), '[]'::jsonb))
    FROM prima.whistle_reports
   WHERE prima.speak_up_uid() IS NOT NULL
     AND (current_setting('app.group_user', true) = 'on' OR 'act' = ANY (string_to_array(current_setting('app.walls', true), ',')))
$$;

-- The next report number, without counting reports the reporter cannot see.
CREATE OR REPLACE FUNCTION prima.speak_up_next_number() RETURNS bigint
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = prima, pg_temp AS $$ SELECT nextval('prima.speak_up_seq') $$;

REVOKE ALL ON FUNCTION prima.speak_up_by_code(text), prima.speak_up_append(text, jsonb, jsonb, int, date), prima.speak_up_meta(), prima.speak_up_next_number() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.speak_up_by_code(text), prima.speak_up_append(text, jsonb, jsonb, int, date), prima.speak_up_meta(), prima.speak_up_next_number() TO prima_app;
COMMIT;

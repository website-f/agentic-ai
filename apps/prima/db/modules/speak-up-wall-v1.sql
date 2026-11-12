-- Speak-up (whistleblowing) reports: the database wall (H2, Fauzan 11 Nov 2026: build it, add it to the release list and
-- install it; "Yes. But HR can see it"). Before this file prima.whistle_reports had no row-level security: any API
-- session, a guard's included, could read every report (summary, who is named, the handler's notes, a named reporter's
-- id) and only the application's checks hid them. Repeat-safe: the office's prima-setup runs this file on every start
-- (as the schema owner, in one transaction); a second run changes nothing. No row is changed or moved.
--
-- Who reads a report's text (the API's role prima_app only; every other role reads nothing):
--   * its handler (data->>'handlerId');
--   * a second handler reviewing a proposed outcome: only while it is 'closing' (and the record of their own review
--     afterwards), only if they are a handler (wall speak_up_handler), not the first handler, not the reporter and not
--     named in it;
--   * a named reporter: their own reports (data->>'reporterId');
--   * HR (wall speak_up_hr: the HR department), read only, except a report that names them. HR never decides.
-- An anonymous report never holds the reporter's id or name (CHECK su_anonymous), so nobody, HR included, can see who
-- sent it. Anonymous reporters come back only by receipt code, through two functions that give the status, outcome
-- and messages of that one report and add a reply. Leaders and ACT (wall speak_up_counts) get one function that returns
-- no text at all: status, dates and who wrote each message, from which the app counts late, update-due and retaliation.
-- Report numbers come from a database sequence (a reporter cannot count reports they cannot see).
BEGIN;

CREATE SEQUENCE IF NOT EXISTS prima.speak_up_number_seq AS bigint MINVALUE 1;
REVOKE ALL ON SEQUENCE prima.speak_up_number_seq FROM PUBLIC;
GRANT USAGE ON SEQUENCE prima.speak_up_number_seq TO prima_app;
CREATE INDEX IF NOT EXISTS whistle_reports_code_idx ON prima.whistle_reports ((data->>'code'));

-- The schema owner (who runs this file and owns the functions below) keeps full access, the same pattern as ic_owner in
-- it-cleanup-v1.sql: the table is FORCE row-level security and the owner is not a superuser.
DO $su$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'prima' AND tablename = 'whistle_reports' AND policyname = 'su_owner') THEN
    EXECUTE format('CREATE POLICY su_owner ON prima.whistle_reports FOR ALL TO %I USING (true) WITH CHECK (true)', current_user);
  END IF;
  -- Anonymous means anonymous in the database too. NOT VALID: checked on every new or changed row.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'su_anonymous' AND conrelid = 'prima.whistle_reports'::regclass) THEN
    ALTER TABLE prima.whistle_reports ADD CONSTRAINT su_anonymous CHECK (
      coalesce(data->>'anonymous', 'false') <> 'true'
      OR (coalesce(data->>'reporterId', '') = '' AND coalesce(data->>'reporterName', '') = '')) NOT VALID;
  END IF;
END
$su$;
ALTER TABLE prima.whistle_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.whistle_reports FORCE ROW LEVEL SECURITY;
REVOKE ALL ON prima.whistle_reports FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON prima.whistle_reports TO prima_app;

-- Numbering does not run backwards: the sequence starts after the highest number already given (SU-0007-... is 7).
DO $seq$
DECLARE have bigint; lv bigint; called boolean; given bigint;
BEGIN
  SELECT greatest(count(*), coalesce(max(((regexp_match(data->>'code', '^SU-([0-9]{1,9})-'))[1])::bigint), 0))
    INTO have FROM prima.whistle_reports;
  SELECT last_value, is_called INTO lv, called FROM prima.speak_up_number_seq;
  given := coalesce(nullif(lv * called::int, 0), 0);
  IF have > given THEN
    PERFORM setval('prima.speak_up_number_seq', have, true);
  END IF;
END
$seq$;

-- A signed-in session of the API (not an empty one, not a site device).
CREATE OR REPLACE FUNCTION prima.su_signed_in() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('app.user_id', true), '') <> ''
     AND coalesce(current_setting('app.user_role', true), '') NOT IN ('', 'site_device')
$$;

DROP POLICY IF EXISTS su_read ON prima.whistle_reports;
CREATE POLICY su_read ON prima.whistle_reports FOR SELECT TO prima_app USING (
  prima.su_signed_in() AND (
    data->>'handlerId' = current_setting('app.user_id', true)
    OR data->>'reporterId' = current_setting('app.user_id', true)
    OR (prima.has_wall('speak_up_handler')
        AND data->>'handlerId' IS DISTINCT FROM current_setting('app.user_id', true)
        AND data->>'reporterId' IS DISTINCT FROM current_setting('app.user_id', true)
        AND NOT coalesce(data->'implicatedUserIds', '[]'::jsonb) ? current_setting('app.user_id', true)
        AND (data->>'status' = 'closing' OR data->'closeReview'->>'byId' = current_setting('app.user_id', true)))
    OR (prima.has_wall('speak_up_hr')
        AND NOT coalesce(data->'implicatedUserIds', '[]'::jsonb) ? current_setting('app.user_id', true))));

-- Anyone signed in may report. The row names no reporter, or the person sending it; it starts as received.
DROP POLICY IF EXISTS su_insert ON prima.whistle_reports;
CREATE POLICY su_insert ON prima.whistle_reports FOR INSERT TO prima_app WITH CHECK (
  prima.su_signed_in()
  AND data->>'status' = 'received'
  AND (coalesce(data->>'reporterId', '') = '' OR data->>'reporterId' = current_setting('app.user_id', true)));

-- Only the handler, or the second handler reviewing a closing report, changes it. HR and leaders never do.
DROP POLICY IF EXISTS su_update ON prima.whistle_reports;
CREATE POLICY su_update ON prima.whistle_reports FOR UPDATE TO prima_app
  USING (
    prima.su_signed_in() AND (
      data->>'handlerId' = current_setting('app.user_id', true)
      OR (prima.has_wall('speak_up_handler') AND data->>'status' = 'closing'
          AND data->>'handlerId' IS DISTINCT FROM current_setting('app.user_id', true)
          AND data->>'reporterId' IS DISTINCT FROM current_setting('app.user_id', true)
          AND NOT coalesce(data->'implicatedUserIds', '[]'::jsonb) ? current_setting('app.user_id', true))))
  WITH CHECK (
    prima.su_signed_in() AND (
      data->>'handlerId' = current_setting('app.user_id', true)
      OR (prima.has_wall('speak_up_handler')
          AND data->'closeReview'->>'byId' = current_setting('app.user_id', true)
          AND data->>'handlerId' IS DISTINCT FROM current_setting('app.user_id', true)
          AND data->>'reporterId' IS DISTINCT FROM current_setting('app.user_id', true)
          AND NOT coalesce(data->'implicatedUserIds', '[]'::jsonb) ? current_setting('app.user_id', true))));

-- Receipt code: where that one report stands. Nothing about the reporter, the handler's notes or who is named.
CREATE OR REPLACE FUNCTION prima.speak_up_status(p_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE r jsonb; n int;
BEGIN
  IF NOT prima.su_signed_in() OR coalesce(p_code, '') = '' THEN RETURN NULL; END IF;
  SELECT count(*), min(data::text)::jsonb INTO n, r FROM prima.whistle_reports WHERE data->>'code' = upper(btrim(p_code));
  IF n <> 1 THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'code', r->>'code', 'at', r->>'at', 'status', r->>'status', 'closedAt', r->'closedAt',
    'outcome', CASE WHEN r->>'status' = 'closed' THEN r->'outcome' ELSE 'null'::jsonb END,
    'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('at', m->'at', 'from', m->'from', 'text', m->'text',
                                                              'retaliation', coalesce(m->'retaliation', 'false'::jsonb)) ORDER BY i)
                          FROM jsonb_array_elements(coalesce(r->'messages', '[]'::jsonb)) WITH ORDINALITY AS x(m, i)), '[]'::jsonb));
END
$$;

-- Receipt code: the reporter answers (or reports retaliation). Holds the row, so replies sent at the same moment are
-- all kept; the same rules as the app's whistleReply. Returns {id, code, handlerName} or {error}.
CREATE OR REPLACE FUNCTION prima.speak_up_reply(p_code text, p_text text, p_retaliation boolean, p_at text, p_today date, p_after_close_days int)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE rid text; r jsonb; n int; body text := left(btrim(coalesce(p_text, '')), 2000); patch jsonb;
BEGIN
  IF NOT prima.su_signed_in() OR coalesce(p_code, '') = '' THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  IF length(body) < 10 THEN RETURN jsonb_build_object('error', 'too_short'); END IF;
  SELECT count(*), min(id) INTO n, rid FROM prima.whistle_reports WHERE data->>'code' = upper(btrim(p_code));
  IF n <> 1 THEN RETURN jsonb_build_object('error', 'not_found'); END IF;
  SELECT data INTO r FROM prima.whistle_reports WHERE id = rid FOR UPDATE;
  IF r->>'status' = 'closed' AND (coalesce(r->>'closedAt', '') = '' OR p_today - left(r->>'closedAt', 10)::date > p_after_close_days) THEN
    RETURN jsonb_build_object('error', 'closed_long');
  END IF;
  IF r->>'status' = 'closed' AND NOT coalesce(p_retaliation, false) THEN RETURN jsonb_build_object('error', 'closed'); END IF;
  patch := jsonb_build_object('messages', coalesce(r->'messages', '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('at', p_at, 'from', 'reporter', 'text', body, 'retaliation', coalesce(p_retaliation, false))));
  IF coalesce(p_retaliation, false) AND r->>'status' IN ('closed', 'closing') THEN
    patch := patch || jsonb_build_object('status', 'investigating', 'notes', coalesce(r->'notes', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('at', p_at, 'by', 'Speak-up channel', 'text', 'Reopened: the reporter reported retaliation.')));
  END IF;
  UPDATE prima.whistle_reports SET data = data || patch WHERE id = rid;
  RETURN jsonb_build_object('id', rid, 'code', r->>'code', 'handlerName', r->>'handlerName');
END
$$;

-- Leaders and ACT: no text, no names, no company. Status, dates and who wrote each message, for the counts.
CREATE OR REPLACE FUNCTION prima.speak_up_signals() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
BEGIN
  IF NOT prima.su_signed_in() OR NOT prima.has_wall('speak_up_counts') THEN RETURN '[]'::jsonb; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'status', data->'status', 'at', data->'at', 'acknowledgedAt', data->'acknowledgedAt', 'closedAt', data->'closedAt',
      'messages', coalesce((SELECT jsonb_agg(jsonb_build_object('at', m->'at', 'from', m->'from', 'retaliation', coalesce(m->'retaliation', 'false'::jsonb)) ORDER BY i)
                            FROM jsonb_array_elements(coalesce(data->'messages', '[]'::jsonb)) WITH ORDINALITY AS x(m, i)), '[]'::jsonb)))
    FROM prima.whistle_reports), '[]'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION prima.su_signed_in() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.su_signed_in() TO prima_app;
REVOKE ALL ON FUNCTION prima.speak_up_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.speak_up_status(text) TO prima_app;
REVOKE ALL ON FUNCTION prima.speak_up_reply(text, text, boolean, text, date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.speak_up_reply(text, text, boolean, text, date, int) TO prima_app;
REVOKE ALL ON FUNCTION prima.speak_up_signals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.speak_up_signals() TO prima_app;
COMMIT;

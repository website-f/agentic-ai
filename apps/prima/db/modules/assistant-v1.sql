-- The Prima agent's memory: the skill library and each person's own style (Fauzan, 23 Nov 2026: "Make sure we have
-- skill library so agent remember. Make sure library also store personalized style of each staff"). Separate reviewed
-- module; never run implicitly during startup. NOT registered in db/release-manifest.json: Fauzan runs it with the
-- other listed modules after the whole build is merged, with infra/run-db-migration.sh, staging first. Repeat-safe.
--
-- One row per skill or per person's style (packages/core/src/assistant-service.ts AssistantMemoryRow).
-- Walls (the application checks the same: packages/core/src/assistant.ts assistantTeams / assistantMayPublish):
--   - a style row and a person's own skills ('me') are read and written only by that person;
--   - a team skill is read by the people of that unit (a company the session may see, or the person's department),
--     and by group leaders; who may publish one (the unit's head or manager) is checked by the application;
--   - nothing is deleted: the app role has no DELETE. A skill no longer used is retired with a reason.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.assistant_memory (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT assistant_memory_id_matches CHECK (data->>'id' = id),
  CONSTRAINT assistant_memory_kind_known CHECK (data->>'kind' IN ('skill', 'style')),
  CONSTRAINT assistant_memory_style_id CHECK (data->>'kind' <> 'style' OR id = 'style-' || (data->>'owner')),
  CONSTRAINT assistant_memory_skill_scope CHECK (data->>'kind' <> 'skill' OR (data->>'scope' IN ('me', 'team')
    AND (data->>'scope' <> 'team' OR data->>'owner' ~ '^(company|dept):[A-Za-z0-9_-]{1,60}$')
    AND (data->>'scope' <> 'me' OR data->>'owner' = data->>'byId')
    AND length(coalesce(data->>'name', '')) BETWEEN 3 AND 80)),
  CONSTRAINT assistant_memory_retired_reason CHECK (data->'retired' IS NULL OR jsonb_typeof(data->'retired') = 'null' OR length(data#>>'{retired,reason}') >= 5),
  CONSTRAINT assistant_memory_size CHECK (pg_column_size(data) < 65536)
);
CREATE INDEX IF NOT EXISTS assistant_memory_owner_idx ON prima.assistant_memory ((data->>'owner'));

-- The signed-in person's own department as a unit ('dept:<department>'), or NULL.
CREATE OR REPLACE FUNCTION prima.assistant_my_dept() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT 'dept:' || (u.data->>'department')
    FROM prima.users u
   WHERE u.id = current_setting('app.user_id', true)
     AND coalesce(u.data->>'department', '') ~ '^[A-Za-z0-9_-]{1,60}$'
     AND coalesce((u.data->>'integration')::boolean, false) = false
$$;
REVOKE ALL ON FUNCTION prima.assistant_my_dept() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.assistant_my_dept() TO prima_app;

CREATE OR REPLACE FUNCTION prima.assistant_may_see(d jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN d->>'kind' = 'style' OR d->>'scope' = 'me' THEN d->>'owner' = current_setting('app.user_id', true)
    WHEN d->>'owner' LIKE 'company:%' THEN substr(d->>'owner', 9) = ANY (prima.visible_companies())
    ELSE d->>'owner' = prima.assistant_my_dept() OR prima.has_wall('archive_all')
  END
$$;

ALTER TABLE prima.assistant_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.assistant_memory FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_read ON prima.assistant_memory;
CREATE POLICY assistant_read ON prima.assistant_memory FOR SELECT USING (prima.assistant_may_see(data));
DROP POLICY IF EXISTS assistant_add ON prima.assistant_memory;
CREATE POLICY assistant_add ON prima.assistant_memory FOR INSERT
  WITH CHECK (prima.assistant_may_see(data)
              AND (data->>'kind' = 'style' OR data->>'byId' = current_setting('app.user_id', true)));
DROP POLICY IF EXISTS assistant_change ON prima.assistant_memory;
CREATE POLICY assistant_change ON prima.assistant_memory FOR UPDATE
  USING (prima.assistant_may_see(data))
  WITH CHECK (prima.assistant_may_see(data));

-- What never changes: the row's kind, unit and author. A skill is only ever retired; a retired skill stays as it is.
CREATE OR REPLACE FUNCTION prima.assistant_memory_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.data->>'kind' IS DISTINCT FROM OLD.data->>'kind'
     OR NEW.data->>'owner' IS DISTINCT FROM OLD.data->>'owner' THEN
    RAISE EXCEPTION 'A skill''s or style''s owner never changes.' USING ERRCODE = '42501';
  END IF;
  IF OLD.data->>'kind' = 'skill' THEN
    IF OLD.data->'retired' IS NOT NULL AND jsonb_typeof(OLD.data->'retired') <> 'null' THEN
      RAISE EXCEPTION 'A retired skill is not changed.' USING ERRCODE = '42501';
    END IF;
    IF (NEW.data - 'retired') IS DISTINCT FROM (OLD.data - 'retired') THEN
      RAISE EXCEPTION 'A saved skill is only retired, with a reason; save a new one instead.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS assistant_memory_guard ON prima.assistant_memory;
CREATE TRIGGER assistant_memory_guard BEFORE UPDATE ON prima.assistant_memory FOR EACH ROW EXECUTE FUNCTION prima.assistant_memory_guard();

REVOKE ALL ON prima.assistant_memory FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.assistant_memory TO prima_app;
COMMIT;

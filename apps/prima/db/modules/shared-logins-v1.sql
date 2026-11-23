-- Shared login list (Fauzan, 23 Nov 2026: "Prepare also password key vault ...", "Wider as a whole", "Now build").
-- Separate reviewed module; never run implicitly during startup. NOT registered in db/release-manifest.json: Fauzan
-- runs it with infra/run-db-migration.sh after everything is merged, staging first. Install accounts-access-v1 first: IT reads the company
-- names for a company's login through prima.acc_companies(), because IT sees no company itself.
--
-- The table holds the LIST only: system, company or department, owner, backup, users, where the password is kept and
-- when it was last changed. It never holds a password: a row carrying a secret-looking field is refused.
--   read   the CEO's master rows: the CEO only. Other rows: IT, central HR and the group leaders (wall
--          shared_login_all), everyone named on the row, and a Company Manager for a company they can see.
--          The head of a central department or central company sees its rows (walls shared_login_head_d_<department>
--          and shared_login_head_c_<company>).
--   add    whoever keeps the list (wall shared_login_keep: IT and the CEO); a master row only by the CEO.
--   change whoever keeps the list; the owner or the backup may only record a password change (trigger below).
-- Nothing is deleted.
BEGIN;
CREATE TABLE prima.shared_logins (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (data->>'status' IN ('active', 'closed')),
  CHECK (data->>'place' IN ('microsoft_tile', 'vault', 'own_account')),
  -- The kind of portal: a built-in key or one IT or the CEO added (prima.shared_login_kinds).
  CHECK (data->>'kind' IS NULL OR data->>'kind' ~ '^[a-z0-9_]{2,30}$'),
  -- Bank and e-wallet rows hold only the last 4 digits of each account or wallet, never a full number.
  CHECK (NOT (data ? 'accounts') OR (jsonb_typeof(data->'accounts') = 'array' AND NOT jsonb_path_exists(data, '$.accounts[*] ? (!(@ like_regex "^[0-9]{4}$"))'))),
  CHECK ((data->>'companyId' IS NULL) <> (data->>'department' IS NULL)),
  CHECK (jsonb_typeof(data->'people') = 'array'),
  CHECK (NOT (data ?| ARRAY['password', 'passcode', 'pin', 'secret', 'token', 'otp', 'recoveryCode', 'username', 'loginName']))
);
ALTER TABLE prima.shared_logins ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.shared_logins FORCE ROW LEVEL SECURITY;

CREATE FUNCTION prima.shared_login_master(d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT d->>'department' = 'ceo_master'
$$;
CREATE FUNCTION prima.shared_login_keeps(d jsonb) RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, prima AS $$
  SELECT CASE WHEN prima.shared_login_master(d) IS TRUE THEN prima.has_wall('shared_login_master') ELSE prima.has_wall('shared_login_keep') END
$$;

CREATE POLICY shared_login_read ON prima.shared_logins FOR SELECT USING (
  CASE WHEN prima.shared_login_master(data) IS TRUE THEN prima.has_wall('shared_login_master')
  ELSE prima.has_wall('shared_login_all')
    OR ((data->'people') ? current_setting('app.user_id', true))
    OR (prima.has_wall('shared_login_company') AND data->>'companyId' = ANY (prima.visible_companies()))
    OR coalesce(prima.has_wall('shared_login_head_d_' || (data->>'department')), false)
    OR coalesce(prima.has_wall('shared_login_head_c_' || (data->>'companyId')), false)
  END
);
CREATE POLICY shared_login_add ON prima.shared_logins FOR INSERT
  WITH CHECK (prima.shared_login_keeps(data) AND data->>'status' = 'active');
CREATE POLICY shared_login_change ON prima.shared_logins FOR UPDATE
  USING (prima.shared_login_keeps(data)
    OR (prima.shared_login_master(data) IS NOT TRUE AND data->>'status' = 'active'
        AND (current_setting('app.user_id', true) = (data->'owner'->>'id') OR current_setting('app.user_id', true) = (data->'backup'->>'id'))))
  WITH CHECK (prima.shared_login_keeps(data)
    OR (prima.shared_login_master(data) IS NOT TRUE
        AND (current_setting('app.user_id', true) = (data->'owner'->>'id') OR current_setting('app.user_id', true) = (data->'backup'->>'id'))));

-- The owner or the backup records a password change and nothing else: the day, the history, and leavers taken off.
CREATE FUNCTION prima.shared_login_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, prima AS $$
DECLARE
  free text[] := ARRAY['lastChanged', 'changeAfter', 'changes', 'users', 'twoFa', 'people', 'updatedBy', 'updatedAt'];
BEGIN
  IF (NEW.data->>'companyId') IS DISTINCT FROM (OLD.data->>'companyId') OR (NEW.data->>'department') IS DISTINCT FROM (OLD.data->>'department') THEN
    RAISE EXCEPTION 'A shared login stays with its company or department';
  END IF;
  IF prima.shared_login_keeps(OLD.data) THEN RETURN NEW; END IF;
  IF (NEW.data - free) IS DISTINCT FROM (OLD.data - free) THEN
    RAISE EXCEPTION 'The owner or the backup may only record a password change';
  END IF;
  IF NOT ((OLD.data->'people') @> (NEW.data->'people')) THEN
    RAISE EXCEPTION 'Only whoever keeps the list adds people to a shared login';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER shared_login_guard BEFORE UPDATE ON prima.shared_logins
  FOR EACH ROW EXECUTE FUNCTION prima.shared_login_guard();

GRANT SELECT, INSERT, UPDATE ON prima.shared_logins TO prima_app;

-- Kinds of portal IT or the CEO add or change in the app ("Make sure it have add button to add anything more"):
-- the name, and whether every company or every security company must have a login for it. Read by every signed-in
-- office user who opens the list; written only by whoever keeps the list (wall shared_login_keep). Nothing is deleted.
CREATE TABLE prima.shared_login_kinds (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CHECK (data->>'id' = id),
  CHECK (id ~ '^[a-z0-9_]{2,30}$'),
  CHECK (data->>'usual' IN ('none', 'every', 'security')),
  CHECK (jsonb_typeof(data->'active') = 'boolean'),
  CHECK (length(data->>'label') BETWEEN 2 AND 60),
  CHECK (NOT (data ?| ARRAY['password', 'passcode', 'pin', 'secret', 'token', 'otp', 'recoveryCode', 'username', 'loginName']))
);
ALTER TABLE prima.shared_login_kinds ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.shared_login_kinds FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_login_kind_read ON prima.shared_login_kinds FOR SELECT USING (current_setting('app.user_id', true) IS NOT NULL);
CREATE POLICY shared_login_kind_add ON prima.shared_login_kinds FOR INSERT WITH CHECK (prima.has_wall('shared_login_keep'));
CREATE POLICY shared_login_kind_change ON prima.shared_login_kinds FOR UPDATE USING (prima.has_wall('shared_login_keep')) WITH CHECK (prima.has_wall('shared_login_keep'));
GRANT SELECT, INSERT, UPDATE ON prima.shared_login_kinds TO prima_app;
COMMIT;

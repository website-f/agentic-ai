-- Data and file manager for old records (Fauzan, 23 Nov 2026: "Do also a data and file manager. As staff upload all
-- old data we have, even the hard copy scan to computer"). Separate reviewed module; never run implicitly during
-- startup. NOT registered in db/release-manifest.json: it is installed only with Fauzan's go-ahead, with
-- infra/run-db-migration.sh, staging first. Repeat-safe: a second run keeps every row.
--
-- One row per file: its details and the document's own words for searching. The bytes are NOT here: they sit in the
-- private file storage (docs/FILE_STORAGE.md) and the row keeps their size and SHA-256.
--
-- Walls (the application checks the same and is stricter on companies: packages/core/src/archive.ts archiveMaySee):
--   - the person who put the file in always reads it;
--   - group leaders read everything (wall archive_all);
--   - restricted folders (staff, pay): otherwise only central HR (wall archive_hr);
--   - other folders: the owning unit, a company the session may see or the person's own central department.
-- Nothing is deleted: the app role has no DELETE. A file put in by mistake is set aside with a reason.
BEGIN;
CREATE TABLE IF NOT EXISTS prima.archive_files (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  CONSTRAINT archive_files_id_matches CHECK (data->>'id' = id),
  CONSTRAINT archive_files_owner_format CHECK (data->>'owner' ~ '^(company|dept):[A-Za-z0-9_-]{1,60}$'),
  CONSTRAINT archive_files_folder_known CHECK (data->>'folder' IN ('finance','clients','tenders','licences','staff','pay','company','insurance','assets','operations','letters','other')),
  CONSTRAINT archive_files_restricted_matches CHECK ((data->>'restricted')::boolean = (data->>'folder' IN ('staff','pay'))),
  CONSTRAINT archive_files_status_known CHECK (data->>'status' IN ('uploading','filed','duplicate','set_aside')),
  CONSTRAINT archive_files_key_format CHECK (data->>'key' ~ '^archive/(company|dept)-[A-Za-z0-9_-]{1,60}/arc-[a-z0-9-]{3,40}\.[a-z0-9]{1,6}$'),
  CONSTRAINT archive_files_kept_has_hash CHECK (data->>'status' = 'uploading' OR (data->>'sha256' ~ '^[0-9a-f]{64}$' AND (data->>'size')::bigint BETWEEN 1 AND 209715200)),
  CONSTRAINT archive_files_set_aside_has_reason CHECK (data->>'status' <> 'set_aside' OR length(data#>>'{setAside,reason}') >= 5)
);
CREATE INDEX IF NOT EXISTS archive_files_owner_idx ON prima.archive_files ((data->>'owner'));
CREATE INDEX IF NOT EXISTS archive_files_uploader_idx ON prima.archive_files ((data->>'uploadedById'));
CREATE INDEX IF NOT EXISTS archive_files_sha_idx ON prima.archive_files ((data->>'sha256'));

-- The signed-in person's own central department as a filing unit ('dept:<department>'), or NULL.
CREATE OR REPLACE FUNCTION prima.archive_my_dept() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT 'dept:' || (u.data->>'department')
    FROM prima.users u
   WHERE u.id = current_setting('app.user_id', true)
     AND u.data->>'role' = 'pwvsb_officer'
     AND coalesce(u.data->>'department', '') ~ '^[A-Za-z0-9_-]{1,60}$'
     AND coalesce((u.data->>'integration')::boolean, false) = false
$$;
REVOKE ALL ON FUNCTION prima.archive_my_dept() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.archive_my_dept() TO prima_app;

-- Is this unit one the session files for? A company the session may see, the person's department, or the leadership
-- office for a group leader.
CREATE OR REPLACE FUNCTION prima.archive_my_unit(owner text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN owner LIKE 'company:%' THEN substr(owner, 9) = ANY (prima.visible_companies())
    WHEN owner = 'dept:leadership' THEN prima.has_wall('archive_all')
    ELSE owner = prima.archive_my_dept()
  END
$$;

CREATE OR REPLACE FUNCTION prima.archive_may_see(d jsonb) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT d->>'uploadedById' = current_setting('app.user_id', true)
      OR prima.has_wall('archive_all')
      OR CASE WHEN (d->>'restricted')::boolean THEN prima.has_wall('archive_hr') ELSE prima.archive_my_unit(d->>'owner') END
$$;

ALTER TABLE prima.archive_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE prima.archive_files FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS archive_read ON prima.archive_files;
CREATE POLICY archive_read ON prima.archive_files FOR SELECT USING (prima.archive_may_see(data));
DROP POLICY IF EXISTS archive_add ON prima.archive_files;
CREATE POLICY archive_add ON prima.archive_files FOR INSERT
  WITH CHECK (data->>'uploadedById' = current_setting('app.user_id', true)
              AND data->>'status' = 'uploading'
              AND (prima.archive_my_unit(data->>'owner')));
DROP POLICY IF EXISTS archive_change ON prima.archive_files;
CREATE POLICY archive_change ON prima.archive_files FOR UPDATE
  USING (prima.archive_may_see(data))
  WITH CHECK (prima.archive_may_see(data));

-- What never changes after a file is added, whoever writes: who put it in and when, its unit, where its bytes are,
-- and, once it is kept, its size and SHA-256. Only the person who put it in finishes their own upload.
CREATE OR REPLACE FUNCTION prima.archive_files_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.data->>'owner' IS DISTINCT FROM OLD.data->>'owner'
     OR NEW.data->>'key' IS DISTINCT FROM OLD.data->>'key'
     OR NEW.data->>'uploadedById' IS DISTINCT FROM OLD.data->>'uploadedById'
     OR NEW.data->>'at' IS DISTINCT FROM OLD.data->>'at'
     OR NEW.data->>'fileName' IS DISTINCT FROM OLD.data->>'fileName' THEN
    RAISE EXCEPTION 'A kept file''s unit, name, storage place and uploader never change.' USING ERRCODE = '42501';
  END IF;
  IF OLD.data->>'status' = 'uploading' THEN
    IF OLD.data->>'uploadedById' IS DISTINCT FROM current_setting('app.user_id', true) THEN
      RAISE EXCEPTION 'Only the person who is adding a file finishes it.' USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.data->>'sha256' IS DISTINCT FROM OLD.data->>'sha256' OR NEW.data->>'size' IS DISTINCT FROM OLD.data->>'size' OR NEW.data->>'status' = 'uploading' THEN
      RAISE EXCEPTION 'A kept file''s size and fingerprint never change.' USING ERRCODE = '42501';
    END IF;
    IF OLD.data->>'status' IN ('set_aside', 'duplicate') AND NEW.data IS DISTINCT FROM OLD.data THEN
      RAISE EXCEPTION 'A file set aside or marked duplicate is not changed.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS archive_files_guard ON prima.archive_files;
CREATE TRIGGER archive_files_guard BEFORE UPDATE ON prima.archive_files FOR EACH ROW EXECUTE FUNCTION prima.archive_files_guard();

REVOKE ALL ON prima.archive_files FROM prima_app;
GRANT SELECT, INSERT, UPDATE ON prima.archive_files TO prima_app;
COMMIT;

-- Central Admin legal hold, version 2 (Fauzan's audit of 4b708ae, 14 Nov 2026, P2). NOT in db/release-manifest.json:
-- the CEO installs it with infra/run-db-migration.sh after central-admin-legal-holds-v1.sql. Repeat-safe.
-- The retention clean-up (apps/api/src/purge-retention.ts) deletes old site gate records and CMS video clips unless an
-- open legal hold names that exact record. Version 1 only allowed holds on seven other tables, so a gate record or a
-- clip could not be held. This widens the list of tables a hold may name; nothing else changes.
BEGIN;
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT k.conname FROM pg_constraint k
            WHERE k.conrelid = 'prima.legal_holds'::regclass AND k.contype = 'c' AND pg_get_constraintdef(k.oid) LIKE '%tbl%'
  LOOP
    EXECUTE format('ALTER TABLE prima.legal_holds DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE prima.legal_holds ADD CONSTRAINT legal_holds_tbl_known
  CHECK (data->>'tbl' IN ('evidence_docs', 'evidence_photos', 'cases', 'contracts', 'corp_profiles', 'people', 'insurance_claims', 'gate_entries', 'evidence_videos'));
COMMIT;

-- AI helper budget, VERSION 1 (rule AI-AGENT-BUDGET; Fauzan, 23 Nov 2026). NOT in db/release-manifest.json: an
-- off-list module, installed only with Fauzan's go-ahead through infra/run-db-migration.sh, staging first.
-- Fauzan's retest, 23 Nov 2026: "Paid AI - activation blocker: spending limits reset after a server restart. Keep it
-- off until budget tracking is durable." One row per helper kind, team and month with the US dollars spent so far.
-- The online reader stays off until this module is installed. No names, papers, values or prompts are stored.
-- The API (prima_app) cannot touch the table directly: it may only call the three functions below, which reserve
-- within the cap under a row lock (so two servers cannot both slip under it), settle a reservation, and read the spend.
-- Repeat-safe.

CREATE SCHEMA IF NOT EXISTS prima;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'prima_app') THEN
    CREATE ROLE prima_app NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA prima TO prima_app;

CREATE TABLE IF NOT EXISTS prima.ai_spend (
  kind text NOT NULL CHECK (kind ~ '^[a-z][a-z0-9-]{1,39}$'),
  team text NOT NULL CHECK (team ~ '^(dept|company):[A-Za-z0-9_.-]{1,80}$'),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  spent_usd numeric(14, 6) NOT NULL DEFAULT 0 CHECK (spent_usd >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, team, month)
);
COMMENT ON TABLE prima.ai_spend IS 'prima-ai-budget-v1';
REVOKE ALL ON prima.ai_spend FROM PUBLIC;
REVOKE ALL ON prima.ai_spend FROM prima_app;

-- Reserves p_usd for one call when the spend stays within p_cap; false otherwise. The UPDATE locks the row, so calls
-- from several servers are counted one after another.
CREATE OR REPLACE FUNCTION prima.ai_spend_reserve(p_kind text, p_team text, p_month text, p_usd numeric, p_cap numeric)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
DECLARE ok boolean;
BEGIN
  IF p_usd IS NULL OR p_cap IS NULL OR p_usd < 0 OR p_usd > 100 OR p_cap <= 0 OR p_cap > 1000 THEN
    RETURN false;
  END IF;
  INSERT INTO prima.ai_spend (kind, team, month) VALUES (p_kind, p_team, p_month) ON CONFLICT DO NOTHING;
  UPDATE prima.ai_spend SET spent_usd = spent_usd + p_usd, updated_at = now()
   WHERE kind = p_kind AND team = p_team AND month = p_month AND spent_usd + p_usd <= p_cap
  RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END $$;

-- Replaces a reservation with the real cost (never below zero). A reservation is at most USD 100.
CREATE OR REPLACE FUNCTION prima.ai_spend_settle(p_kind text, p_team text, p_month text, p_reserved numeric, p_actual numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
BEGIN
  IF p_reserved IS NULL OR p_actual IS NULL OR p_reserved < 0 OR p_reserved > 100 OR p_actual < 0 OR p_actual > 100 THEN
    RAISE EXCEPTION 'ai_spend_settle: amounts out of range';
  END IF;
  UPDATE prima.ai_spend SET spent_usd = greatest(0, spent_usd - p_reserved + p_actual), updated_at = now()
   WHERE kind = p_kind AND team = p_team AND month = p_month;
END $$;

CREATE OR REPLACE FUNCTION prima.ai_spend_get(p_kind text, p_team text, p_month text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, prima AS $$
  SELECT coalesce((SELECT spent_usd FROM prima.ai_spend WHERE kind = p_kind AND team = p_team AND month = p_month), 0);
$$;

REVOKE ALL ON FUNCTION prima.ai_spend_reserve(text, text, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION prima.ai_spend_settle(text, text, text, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION prima.ai_spend_get(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION prima.ai_spend_reserve(text, text, text, numeric, numeric) TO prima_app;
GRANT EXECUTE ON FUNCTION prima.ai_spend_settle(text, text, text, numeric, numeric) TO prima_app;
GRANT EXECUTE ON FUNCTION prima.ai_spend_get(text, text, text) TO prima_app;

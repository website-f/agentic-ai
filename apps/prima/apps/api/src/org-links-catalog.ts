// Generated from a clean install of db/modules/org-links-v1.sql on PostgreSQL 16 (apps/api/test/org-links-packaging.test.ts
// writes it with ORG_LINKS_WRITE_CATALOG=1 and fails while it differs). Do not edit by hand.
export const ORG_LINKS_CATALOG: { policies: string[]; triggers: string[]; functions: string[] } = {
  "policies": [
    "org_events.org_events_add|INSERT|PERMISSIVE|public||prima.org_event_matches_audit(data)",
    "org_events.org_events_owner_read|SELECT|PERMISSIVE|<owner>|true|",
    "org_events.org_events_read|SELECT|PERMISSIVE|public|prima.has_wall('act'::text)|",
    "org_imports.org_imports_add|INSERT|PERMISSIVE|public||((data ->> 'byId'::text) = current_setting('app.user_id'::text, true))",
    "org_imports.org_imports_read|SELECT|PERMISSIVE|public|(prima.has_wall('act'::text) OR ((data ->> 'byId'::text) = current_setting('app.user_id'::text, true)))|",
    "org_notices.org_notices_add|INSERT|PERMISSIVE|public||prima.org_notice_matches_task(data)",
    "org_notices.org_notices_mark|UPDATE|PERMISSIVE|public|((data ->> 'userId'::text) = current_setting('app.user_id'::text, true))|((data ->> 'userId'::text) = current_setting('app.user_id'::text, true))",
    "org_notices.org_notices_read|SELECT|PERMISSIVE|public|((data ->> 'userId'::text) = current_setting('app.user_id'::text, true))|",
    "org_tasks.org_tasks_add|INSERT|PERMISSIVE|public||prima.org_task_matches_event(data)",
    "org_tasks.org_tasks_close|UPDATE|PERMISSIVE|public|((data -> 'userIds'::text) ? current_setting('app.user_id'::text, true))|((data -> 'userIds'::text) ? current_setting('app.user_id'::text, true))",
    "org_tasks.org_tasks_owner_read|SELECT|PERMISSIVE|<owner>|true|",
    "org_tasks.org_tasks_read|SELECT|PERMISSIVE|public|(prima.has_wall('act'::text) OR ((data -> 'userIds'::text) ? current_setting('app.user_id'::text, true)))|"
  ],
  "triggers": [
    "org_notices.org_notice_guard|prima.org_task_guard|19|O",
    "org_tasks.org_task_guard|prima.org_task_guard|19|O"
  ],
  "functions": [
    "org_central_employer(company text)|false|i|search_path=pg_catalog|6c91cd96977b8ad1fa4b34a46e65fc2b",
    "org_desk_people(desk text, company text, day text)|true|s|search_path=pg_catalog, prima|4e891aaadc240f7bfdb226c86cc07cc0",
    "org_event_matches_audit(d jsonb)|true|s|search_path=pg_catalog, prima|e72f59f4b086287688ace870af9bb84c",
    "org_finance_people(company text, day text)|true|s|search_path=pg_catalog, prima|ee6649220385670e06f9ee52208cf8c0",
    "org_finance_team(company text)|true|s|search_path=pg_catalog, prima|2173e5bd382072735305d55a0e41b0be",
    "org_flow_starts(flow text, act text)|false|i|search_path=pg_catalog|f54c68db3e9f269999113188b65db14d",
    "org_flow_target_ok(flow text, desk text, kind text, task text)|false|i|search_path=pg_catalog|69cc2f085f5aceb5e4f165a29fe74c1a",
    "org_flow_to_keyer(flow text, desk text)|false|i|search_path=pg_catalog|accdd323c15a6a8b6189b0521a1ca07f",
    "org_is_this_transactions_audit(s bigint)|true|s|search_path=pg_catalog, prima|1ca5ecaefdfd142a0ec2ff707350f9f9",
    "org_joining_state(company text, person text)|true|s|search_path=pg_catalog, prima|95ab033c389e58483bdd6e4142c4f352",
    "org_notice_matches_task(d jsonb)|true|s|search_path=pg_catalog, prima|cd0a76c26baa56f1089746a2327e3baa",
    "org_run_by(company text)|true|s|search_path=pg_catalog, prima|fc6aaff2f1536ccd257d5954acb451d0",
    "org_task_guard()|true|v|search_path=pg_catalog, prima|18889cec1fd589a1f6533394b9fe4355",
    "org_task_matches_event(d jsonb)|true|s|search_path=pg_catalog, prima|03b05f044bfc140917063511f16f1077"
  ]
};

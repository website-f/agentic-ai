# Microsoft Planner link: set-up guide

Status (23 Nov 2026): **half built.** Changes coming back from Planner into Prima are built and tested. Sending Prima
tasks out to Planner still uses a stand-in (`mockPlannerGateway` in `packages/core/src/work.ts`), so nothing reaches
Microsoft yet. The Microsoft use board therefore shows this link as **Partly** at most, never On.

Owner rule WORK-PLANNER (Fauzan, 27 Oct 2026, P1): remote and branch work tasks live in both Prima and Planner,
Planner preferred. A change made in Planner wins when it is newer than the last change in Prima.

## What already works: Planner to Prima

- Route: `POST /api/integrations/planner/v1/tasks` with body `{ "records": [ ... ] }`, up to 1,000 tasks per call.
- Each record needs the Planner task `id` and `lastModifiedDateTime`. Optional fields: `title` (5 or more characters),
  `dueDateTime`, `percentComplete`.
- A task that reaches 100% in Planner is marked done in Prima with "Completed in Microsoft Planner" as its proof. It
  still goes to the manager to accept. A change older than Prima's last change is skipped.
- Every call is signed like the other feeds (`verifyFeed` in `apps/api/src/auth.ts`):
  - header `x-api-key` = the Planner feed key;
  - header `x-timestamp` = the current time (ISO 8601); calls more than 5 minutes off are refused;
  - header `x-signature` = HMAC-SHA256, in hex, of `<timestamp>.<raw body>` made with the Planner signing secret.
- The call runs as the integration user `u-planner-sync` (or `PLANNER_FEED_USER_ID`), which can only send this feed.

## Set-up steps (joint set-up day, staging first)

1. The IT admin creates the two secrets and types them straight into the staging server settings:
   `PLANNER_API_KEY` and `PLANNER_SIGNING_SECRET`. They never go in chat, a document or a flow's plain text.
2. The IT admin builds the sender on the Microsoft side. Power Automate cannot make the HMAC signature by itself, so
   use a Logic App (Standard, with an inline code step) or a small Azure Function that:
   - reads changed tasks from the one approved Planner plan, using Microsoft Graph (`Tasks.Read.All`, application, admin consent);
   - signs and posts them to the route above, at most every 15 minutes;
   - keeps the two secrets in Azure Key Vault.
3. Check with one IT staff test task: finish it in Planner, then confirm it shows as done in Prima with the Planner proof.

## Still to build before it can be On

- A real Graph Planner gateway in place of the stand-in, so Prima tasks are created and updated in Planner
  (`Tasks.ReadWrite.All`, application, admin consent; owner approval needed).
- The real plan id in rule WORK-PLANNER (today `mock-plan-pwvsb`), set as an owner decision with its date.

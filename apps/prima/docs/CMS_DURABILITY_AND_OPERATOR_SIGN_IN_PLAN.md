# CMS Command Centre app: durability/restart plan and operator sign-in plan

Status (3 Nov 2026): **section 2A is BUILT** on `claude/project-thread-2i31nr` (draft PR #53, not merged or deployed)
after Fauzan's "Yes build all not build" for masterplan §193. Sections 2B (a PostgreSQL store) and 3 (operator sign-in)
remain **PLAN ONLY**. No Azure resource, database, Entra app registration, secret or role assignment is created by this
document or by PR #53. Hosting the app (and the persistent volume its state folder needs) needs Fauzan's approval.

Before 3 Nov the hub kept everything in memory and a restart lost all of section 1. Now the hub saves its whole state
to a folder on its own disk and restarts from it (section 2A). Operators still sign in with a personal key from
`CMS_OPERATOR_KEYS` (stop-gap until section 3).

## 1. What the hub holds in memory today

| Hub field | What it is | Loss on restart means |
|---|---|---|
| `events` | received events by id (also the duplicate check) | a feed retry is raised a second time |
| `alarms` | open and closed alarms, notes, who acted | open alarms disappear from the operator screen |
| `notifications` | "Who CMS tells" calls and repeats | repeats stop; escalation ladder restarts from zero |
| `gaps` | directory and routing problems found | problems hidden until next directory load |
| `audit` | operator actions (acknowledge, close, escalate with reason) | operator audit trail lost |
| `toPrima`, `closedToPrima`, `primaLink` | outbox to Prima and retry counts | unsent events and closes never reach Prima |
| `refused` | refused feed calls (bad signature, old timestamp) | security evidence lost |
| `lastSeen`, `offline` | device heartbeats | every device looks fresh; outages hidden for one window |
| `clockIns`, `scans`, `raised` | JA attendance/patrol watcher state | no-show and missed-patrol alarms raised again or missed |
| `sentKeys` | duplicate-send guard | duplicate sends to Prima (Prima's own duplicate check still holds) |

The directory itself is not at risk: it is pulled from Prima on start and every 10 minutes.

## 2A. Built (3 Nov 2026): saved state on the app's own disk

No database, cloud service or provider. `apps/cms/src/persist.ts` and `Hub.exportState` / `Hub.restore`:

| What | How |
|---|---|
| State folder | `CMS_STATE_DIR` (a persistent volume when hosted). Required outside demo mode: the app refuses to start without it. |
| `state.json` | Every field in section 1 except the audit (plus the last directory copy, gate lists and tracker routes). Replaced atomically: written to a temporary file, flushed to disk, renamed, folder flushed. |
| `audit.jsonl` | Operator and system actions, numbered, one line each, only ever appended (never rewritten or trimmed). A line torn by a crash is skipped and the next write starts on a new line. |
| `hub.lock` | Process id of the one hub on this folder. A second hub refuses to start while that process is alive; a lock left by a stopped process is taken over. |
| Save before acknowledge | Every feed call, directory push and operator action is answered 2xx only after the save. A failed save answers 503 ("send it again"), so the sender retries; the duplicate rule (event id) stops a double alarm. DC-09 panels get ACK only after the save; without it the connection closes and the panel resends. The watchers (every 15 s), Prima sends and directory pulls save after each run. |
| Unreadable state | The app stops with an error instead of starting empty over it. |
| Restart | Open alarms stay open with a "CMS restarted at <time> (last saved <time>)" line and an audit entry by `system`. A reminder that fell due while CMS was down is sent once (not once per missed repeat). A device whose last heartbeat is older than its silent window shows **Unknown**, never online, and its window runs again from the restart. The outbox to Prima, retry counts and parked items carry on. Watcher keys stop a no-show or missed patrol being raised twice. |
| Keep period (proposed) | Closed alarms and events 7 days in the state file unless still waiting to go to Prima or linked to an open alarm (Prima keeps the long record; the audit journal keeps everything). Notifications: last 2,000. Gaps: last 1,000. Refused calls: last 1,000. |

Tests (`npm test -w @prima/cms`, synthetic, temporary folders): restart keeps an open alarm, its history and the
audit; a duplicate after restart is not raised again; a reminder due during the outage fires once; a stale heartbeat
shows unknown and times from the restart; the outbox and retry counts survive and are sent once; a no-show is not
raised twice; the audit journal is append-only and survives a torn line; one hub per folder; an unreadable state file
stops the start; closed alarms leave after the keep period only once sent; a failed save answers 503. Browser check:
`scripts/cms-restart-uat.cjs` (operator acknowledges, hub restarts from the folder, alarm still acknowledged with the
restart line, at 1280 and 390 px).

Limits: one process on one disk. A lost disk loses the state (back up the volume; Prima keeps every event it received
and every closed alarm). Two operators acting on the same alarm at the same moment are served one after the other by
the single Node process, so there is no lost update, but section 2B's version check is still the plan for more than one
process. Performance: the whole state is written on each change; fine for the pilot's volume, to be measured before
~2,000 sites.

## 2B. Durability design with a database (proposed, not built)

1. **One durable store, append-first.** A small PostgreSQL database (or schema) owned by the CMS app only, separate
   from Prima's database. Tables: `cms_event` (id primary key, payload, received_at), `cms_alarm` (state, version),
   `cms_notification`, `cms_audit` (append-only; no UPDATE/DELETE grant), `cms_outbox` (kind, payload, attempts,
   next_try_at, refused_reason), `cms_refused` (append-only, kept 90 days), `cms_watch` (key, value, updated_at) for
   heartbeats, clock-ins, scans and raised keys.
2. **Write before acknowledge.** A feed call returns 2xx only after the event row and any alarm/outbox rows commit in
   one transaction. The existing `ON CONFLICT (id) DO NOTHING` duplicate rule replaces the in-memory `events` map.
3. **Alarm changes use a version check** (`UPDATE ... WHERE id = $1 AND version = $2`) so two operators cannot close
   the same alarm twice; the loser is told to reload. Audit rows are written in the same transaction.
4. **Outbox to Prima** keeps today's rules (one send at a time, retry counts, refused items never dropped) but reads
   and writes `cms_outbox` rows, so a restart resumes sending where it stopped.
5. **Restart behaviour.** On start: load open alarms, pending notifications with their next repeat time, outbox,
   watch state; then pull the directory. Heartbeat state older than the offline threshold is treated as **Unknown**
   (shown as such), never as online. Repeats due during the outage fire once on start, with a "CMS restarted at
   <time>" line in the alarm history.
6. **Single active instance.** One hub process takes a PostgreSQL advisory lock; a second instance waits as standby.
   This avoids two hubs sending the same repeat calls. Horizontal scale is not needed for ~2,000 sites.
7. **Retention (proposed, owner to confirm):** events 90 days, alarms and audit 7 years with the related case,
   refused calls 90 days. Raw camera media is never stored in CMS (links only).
8. **Health.** `/health` reports database reachable, outbox age, directory age and lock holder, without data.

Tests to add when built (against a throwaway PostgreSQL, synthetic data): restart with an open alarm keeps it open
with its history; restart with a pending outbox sends it once; duplicate feed call after restart is not raised again;
two concurrent closes give one close and one refusal; audit rows cannot be updated or deleted by the app role;
standby does not send while the active instance holds the lock.

Inputs needed from the owner: approval of a database for CMS (cost, region not restricted per 28 Oct decision),
retention periods, and whether CMS may share Prima's database server under a separate database and role.

## 3. Operator sign-in plan (replaces `CMS_OPERATOR_KEYS`)

1. **Microsoft (Entra) sign-in with MFA**, same tenant as Prima (`<tenant-id>`), a separate app registration for CMS
   (`<application-id>`). Authorization code flow with PKCE; the server checks issuer, audience, signature (tenant
   keys), expiry and `amr`/Conditional Access for MFA. No client-side claims are trusted.
2. **Who may sign in is decided by Prima, not by the token.** The token gives the Entra object ID; CMS looks it up
   in the directory Prima sends (Prima's `cms_staff` roster, managed under Arms Control) and admits only people on the
   CMS roster. Role in CMS (Head Control or Monitor Officer) comes from that roster. Not built: the roster and the
   directory do not carry the Entra object ID yet; linking follows Prima's audited `entra:link` approach.
3. **Roster-limited.** An operator may act only while on a current CMS shift in the roster (with a short grace before
   and after, proposed 30 minutes). Off-shift sign-in is read-only. Escalation above Regional OM still needs a reason (unchanged
   rule); whether only Head Control may escalate is an owner decision.
4. **Sessions.** Server-side session, HttpOnly + Secure + SameSite=Strict cookie, idle timeout 15 minutes (proposed),
   absolute 12 hours (one shift). Every action records the Entra object ID and roster name in the audit.
5. **Removal.** Removing someone from the CMS roster in Prima ends their CMS access on the next directory pull
   (10 minutes) or immediately on Prima's signed push. Disabling the Entra account ends it on the next token check.
6. **Break-glass.** One sealed operator key held by the CEO, usable only when Entra is down, every use audited and
   reported to the CEO. Proposed; owner decision.
7. **Cut-over.** Keep `CMS_OPERATOR_KEYS` only for the local review build. The pilot build refuses to start with
   operator keys set unless `CMS_BREAK_GLASS=true` is set with the sealed key.

Tests to add when built: token from another tenant refused; expired token refused; token without MFA refused; signed-in
person not on the roster refused; on-roster person off shift can read but not close; removal from roster ends access
after the next directory load; escalation above Regional OM without reason refused.

Inputs needed from the owner: approval to create the CMS app registration, the Conditional Access/MFA policy to use,
shift grace and idle timeout, and the break-glass decision.

## 4. Not in this plan

SMS provider, IP phone integration, gate or panel commands (CMS never opens gates), camera media storage, and any
Azure resource sizing. These stay listed as open in `apps/cms/README.md`.

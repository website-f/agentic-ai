# CMS Command Centre app (first version)

The CMS Command Centre app is a separate app for the 24/7 command centre. It brings site systems onto one operator dashboard and tells the right person what is needed. It is linked to Prima Secure App in both directions.

- Plan: https://claude.ai/artifact/KThQeTEJ1zqx89w31zsENC
- Asked for by Fauzan on 2 Nov 2026:
  - "a system that connects all the needed like cctv, barrier gates";
  - "must or can be connected to prima secure app";
  - "link with vms, visitor management system and vehicle management system to read [ANPR] for barrier gates";
  - "guard attendance and patrolling also are monitored in cms ... it will tell respective place to what needed".

**Status:** built and tested with sample data only. It is not connected to any real device, vendor, model server or Prima. It is not deployed.

## Where CMS runs and what Prima gets (Fauzan, 5 Nov 2026)

> "This will be build sepate from prima secure app. As it need it own llm in house. And data from client saved in inhouse server not in azure cloud. Prima secure get details what happen but not the camera feed 24/7. Prima secure get what need to be documented as a company."

| | CMS (this app) | Prima Secure App |
| --- | --- | --- |
| Where it runs | The group's own in-house server, not Azure | Azure (as planned for Prima) |
| Client site data: video, clips, device messages, plate and visitor lists | Kept here only | Never sent |
| Language model | Its own in-house model (`src/local-model.ts`), private address only | None from CMS |
| What crosses the link | Signed record of what happened: event kind, time, site, device, summary, whether a clip is held in CMS (`recordForPrima`), closed alarms with real/false and the note, and the 5-minute device status | Keeps it as the company record (site alarms, cases, coverage) |

- **Not sent to Prima:** the clip link, video and the device's raw details. Information-only events (visitor arrivals, allowed plates, clock-ins) also stay in CMS.
- **Going the other way, from Prima to CMS:** the directory (companies, sites, devices, people to call, shifts, patrol rounds).
- **Still to settle:** the in-house server itself (hardware, location, backup, power and internet resilience, who looks after it), and the retention periods. Neither has been bought or set up yet.

## The rule it keeps

CMS watches and tells; the company decides and acts (masterplan V13). The app has no route to open a gate, arm or disarm a panel, or move a camera. Adding one needs the company's written consent for that site and a separate change.

## What it does

| Part | File | What it does |
| --- | --- | --- |
| One event format | `src/event.ts` | Every brand's message becomes a `CmsEvent`. Every event has a severity and a stable id, so a resent message never counts twice. Events are signed the same way as Prima's JA feed: HMAC-SHA256 of `timestamp.body`, with a 5 minute window. |
| Directory from Prima | `src/directory.ts` | Prima sends companies, sites, devices, the people to call by role, shifts and patrol rounds. Prima stays the master. A role is looked up first at the site, then at the company, then at group level. |
| Who CMS tells | `src/routing.ts` | The "Who CMS tells" table from the plan: who is told first, who next, how often reminders repeat and what is asked. |
| Event hub | `src/hub.ts` | Opens alarms and joins repeats to an open alarm. It watches device heartbeats, shifts (no-shows) and patrol rounds (missed checkpoints). It sends reminders until someone acts. It keeps every operator action on record. |
| Alarm panels | `src/adaptors/sia-dc09.ts` | SIA DC-09 over TCP, with Contact ID. Checks CRC-16/ARC, replies ACK or NAK, reads the event codes and treats link tests as heartbeats. |
| Barrier gates | `src/adaptors/anpr.ts` | Checks each ANPR plate read against the vehicle system (registered or blocked) and the visitor system (expected plate inside its visit window). A blocked plate is flagged even when the read is unclear. Brand JSON is mapped through a profile. |
| Vehicles and CIT | `src/adaptors/tracker.ts` | Tracker panic, speeding and off-route. JPJ driver hours: at most 8 hours a day, and a 30 minute break after 4 hours. |
| Prima link | `src/prima-link.ts` | Sends events and closed alarms to Prima, signed. Anything that fails stays queued. Every 5 minutes (decided, Fauzan 3 Nov 07:42Z; each up report counts for 15 minutes) it also sends a device status snapshot (`hub.statusForPrima()`: online only while heard within the device's silent window), so Prima can count covered contract minutes from evidence; when snapshots stop, Prima counts the time as Unknown. |
| Server | `src/server.ts` | Signed feed routes, operator routes, the TCP receiver for DC-09 and the dashboard. |
| Saved state | `src/persist.ts` | Saves the whole hub to `CMS_STATE_DIR` before any change is acknowledged and restarts from it: open alarms, the outbox to Prima, watchers and an append-only audit journal; one hub per folder (masterplan §193; details in `docs/CMS_DURABILITY_AND_OPERATOR_SIGN_IN_PLAN.md` section 2A). |
| Response KPIs | `src/hub.ts` `kpis()` | Time to acknowledge, to someone acting and to close (median and 90%), over target, waiting over target now, false-alarm rate, repeats, devices online/offline/unknown, gaps and the outbox, by severity and by company (masterplan §195). Targets are PROPOSED: acknowledge critical 2 min, high 5, normal 15; act 10, 20, 60. |
| Monitoring assistant | `src/assistant.ts` | Fauzan, 5 Nov 2026: "AI system track all alert from all system it connected". Reads every open alarm from every connected system, groups alarms that belong together (vault alarm with vault video down; intrusion with a forced door, tamper or blocked plate; a missing guard during a serious alarm; CIT panic with off-route; several devices silent together at one site; the same alarm at 3+ sites at once, which points at a feed or gateway fault), ranks the findings with a written reason for every point, and suggests next steps in BM. It also watches the connected systems themselves (quiet, refusing messages, never heard = unknown, never green). It never acknowledges, actions, closes, escalates, hides or lowers an alarm, never tells anyone in the field and has no device route. Rule-based, no outside service; thresholds in `ASSISTANT_RULES` are PROPOSED. Operators can mark a finding useful or not; that only goes on the audit record. |
| In-house model | `src/local-model.ts` | Optional shift briefing in BM, written by the CMS's own model on the in-house network from the assistant's findings (the findings stay the record and work without it). Off unless `CMS_LOCAL_MODEL_URL` and `CMS_LOCAL_MODEL_NAME` are set. The address must be private (localhost, 10.x, 172.16-31.x, 192.168.x, `.internal`, `.lan`, `.local`), so a public or cloud address is refused at start. It uses the common "chat completions" call (llama.cpp, vLLM and Ollama all offer it). It is sent only the on-screen findings: never phone numbers, the names of people acting, video, clip links, device details or keys. It has no tools and no routes. If it fails or is slow (`CMS_LOCAL_MODEL_TIMEOUT_MS`, default 20 s), the screen says so and the list carries on. |
| Shift handover | `src/hub.ts` `giveHandover` / `takeHandover` | Two steps at the desk, by the people Prima rostered (`desk` in the directory): the outgoing Head Control writes it with the open alarms, the incoming one takes it, agreeing or not. The taken handover goes to Prima as the company record (open alarms as id, kind, site and summary only). See `docs/CMS_ROSTER_AND_HANDOVER.md`. |
| Dashboard | `src/dashboard.ts` | Alarm queue, response KPIs for the last 24 hours, who CMS told, device health (a device never heard from shows as unknown, never green), gaps where nobody is set for a role, and refused feed messages. |

### Who CMS tells

| Event | First | Then, if nobody acts | Repeats |
| --- | --- | --- | --- |
| Guard no-show or left post | Site supervisor, otherwise the Company Manager | Operations Manager, then Regional OM | every 5 min (ATT-ALERT-REPEAT) |
| Patrol checkpoint missed | The guard | Patrolling officer, OM, Regional OM | 5 min |
| Intrusion, panic, tamper, door forced | Site post and company on-call | OM, then Regional OM | 5 min |
| Fire | Site post and building management | Company on-call | 5 min |
| Vault door unmatched, vault watch missed | Armoury keeper and A-licence holder | Arms Control, then COO | 5 min |
| Firearm overdue | Guard and site supervisor | Arms Control after 15 more minutes (30 after due) | 5 min |
| Unknown plate / blocked plate | Gate guard (plus supervisor if blocked) | Site supervisor / company on-call | 5 min |
| CIT panic | Crew leader, company on-call, Transport head, Arms Control | (all at once) | 2 min (proposed) |
| CIT off route / speeding / over hours | Crew leader | Transport head, company on-call, Arms Control | 5 / 15 / 15 min |
| Device offline | Site supervisor | Company Manager and IT | 30 min (proposed) |

How alerts stop and escalate:
- **Acknowledging does not stop reminders.** They stop only when the operator records who in the field is acting on the alarm.
- **Closing needs a result and a note.** The operator marks the alarm real or false and writes a note. Real alarms go to Prima to open the company's own case.
- **Above the Regional OM, only the operator escalates, and must give a reason.** The order is:
  1. OGM for a government site, or the Operations Director for a private site;
  2. the COO;
  3. the CEO.
- **A missing person is a gap, not a skip.** A role with nobody set is recorded as a gap for the company to fix.

**PROPOSED, not yet set by Fauzan:**
- move up a level after 15 minutes;
- clock-in grace of 15 minutes;
- speed limit 90 km/h;
- ANPR confidence of at least 0.8;
- 2 minute repeat for CIT panic;
- 15 and 30 minute repeats for speeding, driver hours and devices.

## Routes

**Feeds.** Every feed call must be signed with `X-Api-Key`, `X-Timestamp` and `X-Signature`.
- Site gateways and cloud adaptors use `CMS_GATEWAY_KEY` and `CMS_GATEWAY_SECRET`:
  - `POST /ingest/events`: events already in the common format.
  - `POST /ingest/heartbeat`: `{deviceIds: []}`.
  - `POST /ingest/anpr/{profile}`: the brand's ANPR JSON push. Only the `generic` profile exists until the brand list is in.
  - `POST /ingest/lists/vehicles` and `POST /ingest/lists/visitors`: lists from the vehicle and visitor management systems.
  - `POST /ingest/tracker` and `POST /ingest/routes`.
  - `POST /ingest/ja/clock-in` and `POST /ingest/ja/checkpoint`: the JA app's live attendance and patrol push.
- Prima only, using `PRIMA_TO_CMS_KEY` and `PRIMA_TO_CMS_SECRET`:
  - `POST /ingest/directory`. A site gateway's key is refused here.

**Alarm panels.** SIA DC-09 over TCP on `CMS_DC09_PORT`. Encrypted DC-09 frames are refused until each panel's AES key is set up.

**Operators.** Send `Authorization: Bearer <operator key>`. Keys come from `CMS_OPERATOR_KEYS`, a JSON map of key to operator name; each key must be at least 24 characters.
- `GET /api/state`
- `GET /api/assistant`: ranked findings, reasons, suggested steps and the connected-systems watch.
- `GET /api/assistant/briefing`: the in-house model's draft shift briefing (`{state: off | ok | failed}`).
- `POST /api/assistant/feedback` (`{key, useful, note?}`): recorded on the audit trail only.
- `GET /api/kpis` (optional `from`, `to` as ISO times; default the last 24 hours)
- `POST /api/alarms/{id}/acknowledge`, `/actioned` (`{by}`), `/close` (`{outcome, note}`) and `/escalate` (`{reason}`).

**Dashboard.** `GET /` serves the page under a strict content security policy, with no inline script.

**To Prima** (off until set). Events go out when `PRIMA_EVENTS_URL` (https only), `CMS_TO_PRIMA_KEY` and `CMS_TO_PRIMA_SECRET` are set. Prima's receiving endpoint is `<staging-api-url>/api/integrations/cms/v1/events` (slice 4E, draft, same branch); Prima's side of the key is `CMS_FEED_API_KEY` / `CMS_FEED_SIGNING_SECRET`. With the same settings the app also pulls the directory from `<staging-api-url>/api/integrations/cms/v1/directory` on start and every 10 minutes (`PRIMA_DIRECTORY_URL` overrides it); a directory that fails its checks is refused and the copy already held stays in use.

## Run

```
npm test -w @prima/cms                  # 82 tests, sample data, no network
npm run build -w @prima/cms
CMS_DEMO=true PORT=8099 node apps/cms/dist/src/main.js   # sample data; prints a one-time operator key
CMS_DEMO=true CMS_STATE_DIR=<state-folder> PORT=8099 node apps/cms/dist/src/main.js   # same, saved and restarted from <state-folder>
```

Without `CMS_DEMO`, the app refuses to start unless `CMS_OPERATOR_KEYS`, the gateway key and secret, the Prima key and secret and `CMS_STATE_DIR` are all set.

## Not done yet (needs Fauzan or vendors)

- **Brand adaptors:** ONVIF and recorder events, access-control doors, BACnet and Modbus, LLRP RFID, JT/T 808 and 1078, the PBX phone desk, and the real ANPR brand profiles. These need the brand list and vendor answers (plan section 5).
- **Video:** live and recorded video comes from the chosen video platform. It is not built here (plan section 8, hybrid).
- **Operator sign-in:** Microsoft (Entra) sign-in with MFA, and restricting access to staff on the CMS roster, before the pilot. Personal operator keys are a stop-gap.
- **Storage:** built as a saved state folder on the app's own disk (3 Nov 2026). A database store for more than one process, and the retention periods, are still plan only: `docs/CMS_DURABILITY_AND_OPERATOR_SIGN_IN_PLAN.md` section 2B. Hosting needs a persistent volume for `CMS_STATE_DIR`.
- **KPI targets:** the response targets are proposed; Arms Control to confirm.
- **Sending alerts:** an SMS, push or voice provider. Notifications are listed on the dashboard but not sent anywhere.
- **Prima's side:** built as a draft in slice 4E (not merged or deployed; no key set anywhere).
- **Hosting:** decided 5 Nov 2026 that CMS runs on an in-house server, not Azure. No server has been bought or set up yet. The server spec, the model to run on it, backup and the cost need Fauzan's approval first.

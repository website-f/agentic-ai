# Site shared device: CMS messages and one-stop guard duty

Requested by Fauzan on 6 Nov 2026. Built with mock data and merged into main on 7 Nov 2026 (PR #126). It is not migrated and not deployed.

## 1. CMS messages to the site device

CMS can send three kinds of message to a site's shared device: an **instruction**, an **alert** or an **urgent** alert. Sending is limited to the CMS desk (`cms.desk`) for that company.

- **Following an alarm or detection.** A message can follow up an alarm, or an AI detection from CCTV or a sensor. Sending it counts as CMS acknowledging the alarm.
- **Detections are unverified.** An AI detection (`AI_CCTV` or `AI_SENSOR`) is recorded with its label, camera or sensor, and score, and is marked unverified. It is never treated as proof.
- **Analytics feed endpoint.** The feed posts to `POST /api/integrations/analytics/v1/detections`. Calls are signed like the JA and door feeds. The endpoint stays off until `ANALYTICS_API_KEY` and `ANALYTICS_SIGNING_SECRET` are set. The test version simulates detections from the CMS screen.
- **On the device.** The message shows at the top of every screen. It sounds and vibrates again until someone takes it: urgent every 15 s, alert every 60 s.
- **Who takes it.** The guard takes the message with their staff number and PIN. The record notes when that guard is not clocked in at the site.
- **Proof.** The proof CMS asks for can be a photo, a video, either one, or none (none is allowed for instructions only). It can come from:
  - the device camera: a photo or a clip of up to 30 s;
  - a bodycam linked to the device. The bodycam bridge is a mock, and a live bodycam is not offered until a brand is chosen.
- **Proof checks.** Proof gets the same checks as every evidence photo: the server's time is trusted, the location is checked against the site geofence, and a SHA-256 hash is stored. The live API refuses test pictures and test clips.
- **Closing.** CMS reviews the proof and closes the message in one of these ways:
  - **Real.** This opens the company's own case, P1 for urgent and P2 otherwise, with the photos and videos attached. The company decides the response.
  - **Nothing found.** The linked alarm closes as false, so Head Control's false-alarm review still applies.
  - **Done.** Used for instructions only.
  - **Withdrawn.** A reason is required.
- **Late messages.** When a message is late, the CMS "Now" list shows an alert telling the operator to phone the guard or the site officer. A message is late when:
  - it has not been taken within 60 s for urgent, 3 min for an alert, or 15 min for an instruction;
  - the proof has not arrived within 5, 15 or 60 min after the message was taken.

Rule `CMS-DISPATCH`: every value in it is a proposal.

## 2. One-stop guard duty device

- **Post log (occurrence book).** Each line is signed with staff number and PIN and stamped with the server's time. A photo is optional. Lines are never edited; a correction is written as a new line that refers to the old one.
- **Visitor log with evidence.** Each entry records:
  - the visitor's IC or licence, photographed with the phone camera. The **full number and the card picture are sealed on the phone for the company's in-house server**; Prima screens show only the last 4 characters (see section 3);
  - the face checked against the card: match, no match, or not checked;
  - the host and the purpose of the visit;
  - a stamped photo;
  - the times in and out, each signed by a guard.
- **Vehicles.**
  - **Plate check.** The plate is read and checked against the site vehicle list (allowed or on watch). Some entries in the list come from the vehicle system, which is a mock link for now.
  - **Plate on watch.** This raises a `VEHICLE_WATCH` alarm to CMS. The app only records and warns: it never opens or closes the gate.
- **Written in/out book.** Where a site gives only a written list, the guard photographs the pages (up to 10 per upload). The pages are sealed for the in-house server; Prima records the day they cover, the number of lines and who sent them.
- **Flags shown to the guard and the company.** The face does not match, the face was not checked, the ID was typed in, the full ID was not kept for the in-house server, the entry was written offline and sent later, the plate is unknown, the plate was typed in, or the plate is on watch.
- **Who can see the log.** The company sees the duty log in the site drawer. CMS sees it under CMS, Site devices, Site duty logs.

Rule `SITE-GATE`: visitor records are kept 7 years (Fauzan 6 Nov 2026: police need 2 to 7 years; 7 until counsel sets it). The 12 h long-stay warning and the 7-day offline limit are proposals.

## 3. Full visitor data for police, sealed for the in-house server

Fauzan, 6 Nov 2026: police need the full data of people coming in and out if something happens at a guarded site, kept 2 to 7 years, and the data goes to the in-house server.

- **Sealing on the phone.** The device seals the full ID number, the IC picture and written book pages with the in-house server's public key (`packages/core/src/seal.ts`: a fresh AES-256-GCM key per entry, wrapped with RSA-OAEP-256, with a SHA-256 fingerprint). Prima stores and forwards the sealed copy but cannot open it. Screens, the audit log and AI context never see the full number.
- **Setting the key.** The API reads `INHOUSE_PUBLIC_KEY_JWK` (public key only; a private key is refused) and `INHOUSE_KEY_ID`. Until they are set, the device warns that the full ID cannot be kept, marks each visitor entry, and refuses book-page uploads.
- **Collection.** The in-house server calls `POST /api/integrations/inhouse/v1/gate-records/collect` and `.../confirm` with signed calls (`INHOUSE_API_KEY`, `INHOUSE_SIGNING_SECRET`), as system user `u-inhouse-server` with monitor grants per company. It is off until those are set. The duty log shows "Locked, waiting for in-house server" or "Held by in-house server".
- **Scale note.** The collect call reads the site's gate records to find the queued ones; before real volume it needs an indexed column for the queue state.
- **Not built.** The in-house server itself, key generation and rotation on it, and the police request procedure (who may open a record, and the log of each opening).

## 4. No internet at the site

- Post log lines, gate entries, gate exits and book pages are kept on the device when there is no signal, encrypted with AES-256-GCM using a non-exportable key made on that device (`apps/web/src/duty/offline.ts`). Full ID details are already sealed before that, so they are locked twice.
- They are sent oldest first when the signal returns, every 30 seconds, or on **Send now**. Each entry has a device reference, so a resend is saved once. The server keeps the device time and its own receive time, and marks entries that arrive more than 10 minutes late.
- An entry the server refuses (for example a wrong PIN) stays on the device marked "Refused" until the supervisor removes it after writing it in the paper book.
- A plate on watch entered offline cannot reach CMS: the device tells the guard to phone CMS and not let it in.
- **Limits.** The app must be opened once with a signal at the start of the shift; after that the signal may drop. This has not been tested on a real phone in airplane mode. The PIN is kept, encrypted, with a waiting entry until it is sent.

## 5. Client needs and site tasks (Fauzan, 6 Nov 2026)

- **The discussion list.** `packages/core/src/client-needs.ts` is the list the OM goes through with the client. It covers 8 areas: the site and its people (with client contacts), who comes in and out, risks and past incidents, what is already there, guarding and patrols, emergencies, reports to the client, and special needs. Each topic has questions to ask, what the company can do, and ready-made task ideas.
- **The record.** The OM saves each discussion: who they spoke to, the answer and concern level per topic, and what was agreed. Each discussion is a new record and earlier ones are kept.
- **Tasks.** The OM sets tasks for the guard, the officer or the patrolling officer. A task has its days (or one date), an optional do-by time, an optional photo requirement, and the client need it answers. Only the OM covering the site, or operations managers above them for their own sites, or the Director, may set or stop tasks. The company manager can see them but not set them.
- **On the shared device.** Tasks due today show on top. Each is signed off with staff number and PIN, with a photo where needed, or marked "cannot do it" with a reason. A guard does guard tasks, an officer does officer and guard tasks, and a patrolling officer may do any. Sign-offs work offline and are saved once for the day.
- **Gate on or off.** The OM (same people who set tasks) can turn visitor and vehicle check-in on the shared device off for a site that has its own desktop system for the gate, with a reason, and back on. When off, the device hides the gate and the written book upload; anyone still signed in can still be signed out, and a resend of an entry saved earlier still answers. On is the default.
- **OM view.** The site drawer shows the last 7 days of each task: done, done but sent later (an old device time, so the OM should check it), not done with a reason, late, or missed. A second person cannot sign off a task already signed for that day.
- Rule `SITE-TASK`: the limits are proposals. New tables are `site_needs_reviews`, `site_tasks` and `site_task_logs` in `001_init.sql`, and the base hash is updated again.

## What is mocked or not connected

- **Readers and face engine.** The phone camera is used first: the IC number is read from the picture where the phone's browser can read text (TextDetector); otherwise the guard types it from the picture. The dedicated IC reader, the plate reader, the face engine (now being added in the item register work), the bodycam bridge and the vehicle system feed are mocked. The live app marks typed or unchecked entries rather than claiming a scan.
- **Video file storage.** Video is stored as a data URL in the database for this draft. Production needs object storage with the same keep period.
- **Unbuilt pieces.** There is no deletion job for expired clips or visitor records yet (records are kept 7 years). The bodycam brand is to be chosen later. There is no screen for pairing a bodycam or for editing the vehicle list.

## PDPA (for the PDPA officer)

- **Video.** Guard video records faces and voices. It is shown to the CMS desk and to the company only through a case. The keep period of 90 days is proposed.
- **Visitors.**
  - A notice at the gate is needed, and its wording is pending.
  - The full ID, card picture and book pages are kept 7 years (police range 2 to 7), sealed for the in-house server; Prima shows only the last 4. The notice should say records may be given to the police.
- **Hosting choice.** Fauzan's 5 Nov 2026 rule keeps CMS camera feeds on an in-house server. Guard verification clips are company evidence and are stored in Prima here. This needs his confirmation.

## New tables

The new tables are `site_dispatches`, `evidence_videos`, `post_logs`, `site_vehicles` and `gate_entries`, all company-scoped with RLS. They live in `db/migrations/001_init.sql`, and the base migration hash in `db/release-manifest.json` has been updated. The database update that adds them is prepared in `ops/combined-upgrade` (stage 2, after `ops/base-transition`); it has not been run on any real database.

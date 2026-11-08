# CMS site readiness

Status: draft. Not merged, not deployed. No database migration is needed. The data is an optional `cmsReadiness` field on the existing `sites` JSONB row, behind the existing company wall.

## Decision

Audit decision 4 (Fauzan, 5 Nov 2026) says three things:

- Build CMS site readiness in Prima now.
- The device brand follows the client's choice.
- Device connections come later.

## Where the data lives (Fauzan, 5 Nov 2026)

Readiness records are kept in Prima now. The CMS will have its own server for its data: devices, events and video. When that server exists, it receives a copy of the sites that have been checked. Building that copy is a later step; this PR builds no link to the CMS server.

## Mock data

The test version includes mock readiness for Sasa, Arrow Shield and Inas, on the 2nd to 6th site of each company. These sites cover each stage:

- in progress
- needs fixing (a vendor says "cannot link", and there is no UPS)
- waiting for the Arms Control check
- ready to connect
- returned by Arms Control

The first site of each company stays empty, for a fresh walk-through. Brands are named "Brand A (mock)" and so on.

## What it records, per site

**Devices.** Each device line records:

- kind: CCTV recorder, alarm panel, barrier gate, ANPR camera, door access, visitor system, intercom or panic button
- brand and model
- how many
- owner: client or company
- where the client wrote its brand choice (letter, email, PO or contract clause)
- installer or vendor contact
- the vendor's answer on how the device can share health and events (for example ONVIF Profile S or SIA DC-09), and whether the vendor confirmed it in writing

Prima never picks, recommends or limits a brand. If the vendor says the device cannot share events, the site shows *Needs fixing*. The brand is not refused: the next step is to ask the vendor for an API or a gateway.

**Site preparations.** Each one is answered yes, no or not known yet:

- site survey (proof reference required)
- client's written agreement to CMS monitoring (proof reference required)
- CCTV notice signs, only when cameras are listed (photo reference required)
- internet
- backup power
- time sync
- the named holder of the device admin login

For the admin login, Prima keeps the holder's name and role only. Text that looks like a password, PIN or code is refused everywhere.

## Status

| Status | Meaning |
| --- | --- |
| Not started | Nothing recorded |
| In progress | Some items are not known yet. Not known never counts as done. |
| Needs fixing | An item is answered no, a vendor said the device cannot link, or Arms Control returned it |
| Waiting for Arms Control check | Every item is done |
| Ready to connect (not connected) | Arms Control checked the exact content. Any later change voids the check. |

"Ready to connect" is never a connection. This module does not link a device. It does not change `siteSystems`, and it never marks anything linked or online. The *Connected* tile is always 0 until the live link is built and tested (V13: a site is LIVE only once tested).

## Who does what

All of this is enforced in `PrimaService`, not only on screen.

**Record** (devices and answers):

- the company manager, admin executives and the supervisor for their own sites
- Arms Control with a company grant
- an OM or Regional OM with an *act* grant, in their own regions
- the CEO during the pilot

**Check** (pass, or return with what to fix):

- Arms Control with a company grant, or the CEO
- A reason is always required.
- Nobody who recorded any part of the current content may check it.
- The check is bound to a fingerprint of the content seen on screen. A stale screen is refused.

**View only:**

- CMS staff
- COO and above, with a grant

## Endpoints

- `GET /cms/readiness`
- `POST /cms/readiness/:siteId/answers/:key`
- `POST /cms/readiness/:siteId/devices`
- `POST /cms/readiness/:siteId/devices/:deviceId/remove`
- `POST /cms/readiness/:siteId/review`

## Not done here

- Device connections, the CMS event endpoint and site gateways. These are covered by the CMS command-centre app plan and draft PR #53.
- File upload for the proof. Proof is a reference text until cloud file storage is built.
- Reconciling this module with the PR #53 commissioning steps once both are reviewed.

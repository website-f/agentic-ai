# ADR 0003: Shared site devices with face clock-in

Date: 2026-10-24. Status: Accepted.

## Decision
Devices stay at the post (Fauzan, 23 Oct 2026). A device is enrolled to one site and acts
as a `site_device` user limited to that site.

Guards and supervisors clock in and out by face (Fauzan, 24 Oct 2026). The guard types
the staff number and the camera picture is checked 1:1 against that person's enrolled
face, with a live-person check, plus a GPS reading. Match threshold is rule
OPS-FACE-MATCH (0.80, Policy, to tune with the engine).

Patrols are recorded only by tapping the phone on the coded NFC tag at each checkpoint
(Fauzan, 24 Oct 2026), with staff number and PIN. There is no QR fallback, because a QR
code can be photographed and scanned away from the post. The tag holds the checkpoint code
as an NDEF text record; the chip serial number is kept with each scan. Web NFC works only
in Chrome on Android, so site phones must be Android with NFC. For go-live we recommend
tags that make a new signed code on every tap (for example NXP NTAG 424 DNA), checked on
the server, so a copied tag is caught.

The app records problems (late, away from site, face not matched, live check failed, face
not enrolled, not rostered) for the supervisor instead of refusing a guard at the post. Any
face problem opens a P3 identity-check case so a person confirms who was on duty before
the day is locked.

## Privacy
Face data is biometric, so it is sensitive personal data under the PDPA. Each person's
written consent is taken at enrolment (`faceEnrolledOn`). Face templates stay with the
face engine in Malaysia and never sit in the people table. Counsel or the DPO must confirm
the consent wording and retention before real faces are enrolled.

## Not yet built
The face engine itself: on-device or a managed service hosted in Malaysia, chosen on cost.
Until it is connected the device sends no score outside the test version, and every
record is flagged for the supervisor. In production the server scores the capture; a score
sent by the device is never trusted. Also not built:
device enrolment, face enrolment screen, signed-tag checking, patrol routes and missed-checkpoint alerts, PIN hashing and lockout, photo upload, offline queue with
server-side time checks. PINs in the mock data are plain and shown in the test version
only.

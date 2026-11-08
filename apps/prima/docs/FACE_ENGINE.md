# Face engine for clock in

Fauzan asked on 5 Nov 2026 for a face engine for clock in, "create our own or find a low-cost one" (audit decision 2). He also said that if guards later sign in to Prima, they use face and/or PIN, because one person can type four people's PINs.

This page compares the options, gives the recommendation, and explains how to switch the engine on. It is **off by default**: until `FACE_ENGINE=server` is set, clock-in behaves exactly as the 2 Nov 2026 build (PR #51).

## What exists before this change (PR #51, 2 Nov 2026)

- Staff register a face on their own phone, and HR (HR Administrator, CoS, DCoS) approves the photo with a comment. Nobody approves their own face.
- After signing in, the sign-in clock is marked `FACE_PENDING` until the staff member does a face check.
- The **phone** runs the free engine (face-api, MIT licence) and sends 128 numbers (the descriptor). The server compares those numbers with the approved face.
- Weak points:
  - A tampered phone can send any 128 numbers, including at registration.
  - The live-person check is a small movement between two frames, done on the phone, so a held-up photo can pass.

## Options compared

Costs are list prices checked on 5 Nov 2026 and converted at about RM4.3 to US$1. The volumes are estimates: about 300 office staff with one check a working day (about 6,600 a month), and, if guards ever move to Prima, 8,000 guards with two checks a day (about 480,000 a month).

| | Cost, staff only | Cost, with guards | Phone can fake it? | Live-person check | Works offline | Notes |
|---|---|---|---|---|---|---|
| **A. Phone engine (current, PR #51)** | RM0 | RM0 | Yes: the phone makes the numbers | Weak: small movement, judged on the phone | Could, later | Already built |
| **B. Own engine on Prima's server (this PR)** | RM0 extra | Well under RM50 a month of extra server time (measured: about 0.1 s per picture, 4 to 5 pictures a check) | No: the server reads the pictures itself | Random head-turn challenge signed by the server, judged on the server | No: needs a connection (offline is after the pilot) | Same free model; nothing leaves Prima; no sign-up |
| **C. Azure AI Face, Liveness + Verify** | About US$102 (≈RM440) a month | About US$7,400 (≈RM32,000) a month | No | Strong: Microsoft's own liveness | No | Free tier is 30,000 calls a month at 20 a minute. Face verification needs Microsoft's **Limited Access** approval first. Liveness is US$15 per 1,000; with verification it is US$15.50 per 1,000. |
| **D. AWS Rekognition Face Liveness + CompareFaces** | About US$106 (≈RM460) a month | About US$7,700 (≈RM33,000) a month | No | Strong: AWS's own liveness | No | Liveness is about US$0.015 a check and CompareFaces about US$0.001 a picture (check the AWS price page before signing up). Needs an AWS account outside Azure. |
| **E. Commercial on-device SDKs (FaceTec, Regula and similar)** | Quoted per licence, usually thousands of US$ a year | Higher | No | Strong | Some do | Needs a native app wrapper |

### Accuracy

- The free model behind A and B is reported by its author at 99.38% on the standard LFW benchmark. Real phones in poor light do worse.
- The match line stays at rule `OPS-FACE-MATCH` 0.8, which is the model's usual same-person distance of 0.6.
- **No real face has been tried yet**, on a phone or on the server. Tests use synthetic numbers and pictures only, as the engineering rules require.
- C and D are stronger engines, especially for liveness against masks and screens.

### What B stops and what it does not

- **Stops:**
  - A phone sending made-up face numbers. The server reads the pictures itself, and a face registered with the phone engine is read again from its approved photo.
  - A printed photo or a photo on another screen, because it cannot follow the random head turns.
  - A pre-recorded video of the person, because there are four possible orders, fixed per clock in so they cannot be fished for, and the challenge expires after 90 seconds. Four orders is still small: someone holding four recordings of a colleague could pass, which HR spot-checks and the paid upgrade path cover.
  - Swapping faces part way through, because every picture must be the same person.
- **Does not stop:** a live deepfake played into a tampered phone, or a good 3-D mask. Stronger proof needs C or D, or a native app with device attestation.
- **What happens on a failed check:** the clock is never refused. The check is flagged (`FACE_NOT_MATCHED`, `NO_LIVENESS`) for HR, the facing picture is kept for HR to spot-check, and the reasons go into the audit log. This is the same as before.

## Recommendation

1. **Use B, the own engine on Prima's server, for office staff.** It costs nothing extra, needs no sign-up, keeps every face picture inside Prima, and closes the main weakness of A (a phone faking the numbers).
2. **Before switching it on for everyone, trial it with the IT pilot staff for a week on their own phones.** Count false "not matched" and "not live" flags, then tune the turn thresholds in `packages/core/src/face.ts` (`FACE_TURN_MIN` 0.16 and `FACE_TURN_CENTRE_MAX` 0.1 are proposals).
3. **Keep C or D as the upgrade path,** only if the trial or HR spot-checks show cheating. A paid check can then be used only for flagged people, or for guards, which keeps the bill small. For C, apply for Limited Access early, because approval takes time.
4. **Guards, if they move to Prima:**
   - The guard types their staff number and PIN on the shared site phone, then does the same head-turn face check against their approved face. The PIN identifies the guard, and the face proves the guard is present, so one person cannot type four PINs.
   - The engine and the challenge are already generic. Only the site-device screen is needed, and that waits for the guard move date.
5. **Offline** (the site phone without a signal) is after the online pilot. The design: the phone keeps the pictures, and the server reads them when it is back online and marks the check "checked late". Until then the check needs a connection.

## Law (PDPA)

- Under the Personal Data Protection (Amendment) Act 2024, biometric data is **sensitive personal data**, and processing it needs **explicit consent**.
- The staff face consent screen was removed on 1 Nov 2026 at Fauzan's request. The point is recorded in the HR legal points for the directors.
- B keeps every face picture and face number inside Prima. With C or D, pictures would go to Microsoft or AWS, and the privacy notice would have to name them.

## Switching it on (owner authorisation needed; not done by this PR)

| Setting | Value |
|---|---|
| `FACE_ENGINE` | `server`. Anything else, or unset, keeps the phone engine. |
| `FACE_CHALLENGE_SECRET` | A random secret of at least 32 characters, from the approved secret store. The API refuses to start in server mode without it. |
| `FACE_MODELS_DIR` | Optional. Defaults to `apps/web/public/face-models`, which the Dockerfile now copies into the API image. |

- **Database:** no change is needed beyond PR #51's `prima.staff_faces` (same CEO-run migration). The new `descriptorBy` field lives inside the existing JSON row.
- **Server:** about 30 MB more memory once the engine loads on the first check. Nothing changes at start-up.

## How it works

1. The phone calls `POST /me/face/challenge`. The server returns four steps (facing, a turn, facing, a turn) in a token signed with `FACE_CHALLENGE_SECRET`, bound to the user and to the open clock, and valid for 90 seconds. The order comes from the secret, the user and the clock, so asking again for the same clock gives the same order; nobody can keep asking until an order matches a recording.
2. The phone shows each step in Bahasa Melayu and English and takes one picture per step.
3. The phone sends the pictures and the token to `POST /me/clock/face`.
4. The server checks the token and reads the pictures before any database work starts, so the engine never holds a database connection. Then, for each picture (and the registered photo, when it was registered with the phone engine), the server's engine (TensorFlow.js on WebAssembly, no native libraries) finds the face, its 68 landmarks and its 128 numbers.
5. `judgeFaceFrames` checks three things:
   - each picture has exactly one face;
   - the head turn matches each step;
   - every picture is the same person.

   It then scores the facing pictures against the registered face.
6. The open clock's `FACE_PENDING` is cleared, so the check is single use, and the result is audited.
7. In server mode, photo clock in and out ignore any face numbers from the phone, so those clocks are photo-only.
8. In server mode, registering a face takes the photo only (no phone engine is loaded); the server finds the face and refuses a photo with no face or more than one.
9. The API refuses to start with `FACE_ENGINE=server` and no `FACE_CHALLENGE_SECRET`.

Code:
- `packages/core/src/face.ts`: challenge steps, head turn and judgement.
- `PrimaService.staffFaceCheckFrames`: the clock-in face check.
- `apps/api/src/face-engine.ts`: the switch, the signed challenge and the engine.
- `apps/web/src/views/FaceCheck.tsx`: `FaceChallengeCapture`.

## Not yet proved

- Real faces on real phones: matching rate, and the direction of the head-turn sign on different phone cameras.
- The challenge screen in a browser with a real camera. The demo build always uses the phone engine.
- Container build and load on Azure.

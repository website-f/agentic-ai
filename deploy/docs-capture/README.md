# docs-capture: screenshots and videos for the User Guide

Produces `apps/web/public/guide-media/` (shots, videos, `manifest.json`), which the in-app
Guide (`/guide`) and Presentation (`/present`) display. The format is the contract in
`apps/web/src/guide/manifest.ts`; which pages, states and highlighted controls are captured
comes from `apps/web/src/guide/targets.ts` (each control carries `data-guide="<id>"`).

Everything shown is a fictional demo office ("Demo Group": Nusantara Logistics and Harmoni
Engineering) in its own database, `agentic_demo`. Provider keys are fake; no model is called.

## Refresh everything (one command)

Needs the dev stack's Postgres (8506), Valkey (8507) and Temporal (8508) up, `uv`, Docker
(for ffmpeg) and a `node_modules` with Playwright. From the repo root, in Git Bash:

```bash
NODE_PATH=C:/Users/admin/Desktop/Qbot_Main/project_qbotu_a3/node_modules \
  node deploy/docs-capture/refresh.js
```

That runs, in order:

1. `seed_demo.py`: drops and re-creates `agentic_demo`, runs `alembic upgrade head`, seeds the
   demo office (through the real API in-process for people, companies, the assistant and the
   staff AI worker; directly for a month of back-dated history).
2. Starts the demo API from source (port 8621), `demo_worker.py` (port-less Temporal worker on
   the `agentic-office` queue: answers the health check and ends every other workflow) and
   Vite (port 8622, `/api` proxied to 8621). Logs go to `.work/*.log`.
3. `capture.js`: every page and state of `GUIDE_PAGES` at desktop (1440x900, 1x) and phone
   (393x852, 2x, up to 2.5 screens tall), boxes of the `data-guide` controls as fractions,
   PNG -> WebP q78 (`encode_media.py`). Then every `GUIDE_FLOWS` video (`flows.js`), with a
   visible cursor and chapter marks, transcoded to H.264 MP4 + a WebP poster with
   `jrottenberg/ffmpeg:6.1-alpine`. Agent work in the videos is played by `demo_advance.py`.
4. Stops the API, worker and Vite. The demo database stays for the next run.

Useful flags (passed through to `capture.js`):

| Flag | What |
|---|---|
| `--shots-only` / `--videos-only` | one half only |
| `--only=agents,tasks` | just these page ids (merged into the existing manifest) |
| `--flows=approve,give-task` | just these videos |
| `--debug-boxes` | also writes copies with the boxes drawn to `.work/debug/` (never shipped) |
| `--no-seed` (refresh.js) | keep the current demo data |
| `--serve` (refresh.js) | seed and serve only, to look around at http://127.0.0.1:8622 |

`hire-worker` and `add-company` change the demo data (a new AI worker, a new company), so
re-seed before recording them again (refresh.js always does unless `--no-seed`).

Demo logins (password `demo-office-2026`): `owner@demo.example` (Aminah Rahman, owner),
`suresh@demo.example` (branch manager), `farid@demo.example` (staff with an AI worker),
`wani@demo.example` (new staff, no AI worker yet), `kamal@demo.example` (admin),
`christine@demo.example` (approver).

## Notes

- The browser clock is Malaysia time during the day; at night there the capture uses a zone
  where it is late morning, so greetings and clock times read like a working day
  (`CAPTURE_TZ` overrides).
- The overview's AI briefing is answered by the capture (route-fulfilled) with a briefing
  written from the demo numbers, since the demo has no working model.
- Two agents show a live browser screen on the Monitor: pictures of two fictional websites
  in `frames/`, loaded by `demo_frames.py`.
- Files: `seed_demo.py`, `demo_worker.py`, `demo_advance.py`, `demo_frames.py`,
  `capture.js`, `flows.js`, `encode_media.py`, `draw_boxes.py`, `refresh.js`, `frames/`.
  `.work/` is scratch (git-ignored).

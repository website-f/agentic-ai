# P37–P42: dialects, rescue, research, storage, the Recruiter, remote computers

Six changes. Migrations `0037`–`0039`. Tests: `apps/api/tests/test_p37_dialects.py`,
`test_p38_rescue.py`, `test_p39_research.py`, `test_p40_storage.py`, `test_p41_recruiter.py`,
`test_devices.py` (P42), `apps/pc-agent/agent.test.cjs`, `apps/web/src/lib/devices.test.ts`.

## P37 Casual Malay and the state dialects

Each person picks how their AI **talks to them**: as they write (standard), casual Malay
(bahasa pasar), or a state's dialect: Kelantan, Terengganu, Kedah/Utara, Perak, Pahang, Negeri
Sembilan, Melaka, Johor, Sabah, Sarawak. Settings → "How your AI speaks to you"
(`components/speech-style.tsx`), stored as `locale.speech` in the person's preferences
(`services/prefs.py` `speech_of`, `speech`).

- **Data** (`datasets/malay/`): `scripts/fetch_dialects.py` downloads two open Hugging Face sets
  from Mesolitica: `Malay-Dialect-Dictionary` (10 states, 6,759 entries) and
  `Malay-Dialect-Instructions` (standard ↔ dialect sentence pairs, incl. local Malay). The
  older datasets folder only had Manglish / pasar register, close to standard Malay.
- **Packs** (`scripts/build_dialect_packs.py` → `agentic/i18n/dialects/data/<code>.json`): per
  dialect, a lexicon ranked by how often each phrase occurs, short example sentences and
  standard → dialect pairs; crude words filtered out.
- **Use** (`agentic/i18n/dialects/__init__.py`): every chat turn gets a short voice note (a
  hand-checked style guide per dialect + the most common words) and a gloss of the dialect
  words that appear in what the person wrote (`gloss`), so the model reads the dialect and
  answers in it. No fine-tuning and no extra model: it works with whichever model the office
  uses, and costs a few hundred tokens a turn.
- **Only conversation**: documents, letters, reports and anything sent to customers stay in
  standard Malay (`runtime._language_line`).

## P38 No stuck task: stop, finish by hand, another AI, failover

- **Automatic failover** (`runtime._task_chat`): when the agent's model group fails, the step
  tries the other chat groups (`smart`, `fast`, `bulk`) and records a `failover` event. The
  task remembers the group that answered (`tasks.model_group`, migration `0037`).
- **Stuck runs** (`teams/reconcile.py`): a running task with no progress for 45 minutes (and no
  open child task) is terminated and relaunched once; a second time it is blocked for a person.
- **The owner hears about it**: a failed task notifies the person who gave it, with what went
  wrong and what to do (`_tell_owner_it_failed`).
- **Manual switches** on every task (`pages/tasks/rescue.tsx`, `api/routers/task_rescue.py`;
  only the person who gave the task or a manager of its agent):
  - **Stop now** `POST /api/tasks/{id}/stop`: terminates the Temporal run at once.
  - **Try another AI** `POST /api/tasks/{id}/retry-with {model_group, agent_id}`: restarts on
    another model group and/or agent.
  - **I'll finish it myself** `POST /api/tasks/{id}/finish {result}`: marks it done with the
    person's result; work waiting on it goes ahead.

## P39 Research that works

- **Own search engine**: SearXNG (open source metasearch, `deploy/searxng/`, service `searxng`
  on an internal network) is the first search backend for every agent; DuckDuckGo alone
  returns a CAPTCHA to servers.
- **Each agent's own browser** ("laptop"): the browser service already keeps one persistent
  profile per agent. When search is blocked, or a page is empty, JavaScript-only or refuses a
  plain fetch (4xx, under 200 readable characters), the agent opens it in **its own browser**
  (`agents/browse_reader.py`, session `rs:<task>`) and reads the rendered text. Search falls
  back to the browser too (DuckDuckGo, then Bing, real result links decoded).
- **PDFs** are read (pypdfium2, up to 60 pages), not skipped.
- **No approval stall**: following a link the agent itself found in this task's results is
  allowed without asking (`web_fetch.known_link`), unless the agent has an explicit web rule.
- **Remembered**: a research task's question, findings and sources are saved to the shared
  memory (`wiki/research/YYYY-MM-<slug>.md`, `brain/learn.save_research`), so the next agent
  finds them before searching again.

## P40 Files in several places

Company files can be kept in the app's database (as before), **this server's disk**, any
**S3-compatible bucket** (Backblaze B2, AWS, Cloudflare R2, Wasabi, MinIO) or the company's own
**WebDAV file server** (Nextcloud, ownCloud, Synology, QNAP). Settings → File storage
(`pages/storage.tsx`, `api/routers/storage.py`, owners and admins).

- `storage_targets` (migration `0038`); secrets sealed with the server's master key.
  `files.storage_id/storage_key/storage_etag`; `files.data` is now optional.
- Every byte read and write goes through `documents/storage.py` (`store_new`, `read`,
  `replace`, `forget`). S3 is signed with SigV4 by hand (no SDK). A target is tested (write,
  read back, delete) before it is saved.
- **One primary** target takes new files; if it is unreachable the file is kept in the
  database, so an upload never fails because a bucket is down.
- **Feeds the Library**: a target can import its documents into the Library in place
  (`documents/sources.py`), every hour: new files are read and indexed, changed ones (by etag)
  re-read, removed ones taken out. Up to 200 per run.
- The local disk folder (`/data/files`, volume `files`) is in the nightly backup.

## P41 The Recruiter: a blueprint per job, researched

Blueprints → **Recruit with AI** (`pages/blueprints/recruit.tsx`,
`POST /api/blueprints/recruit`). A built-in agent, "Rania (Recruiter)" (HR,
`agents/recruiter.py`), researches the job on the web and in the Library (duties, step-by-step
work, laws and permits, tools, common mistakes, what good looks like) and drafts a
**blueprint** with the `draft_blueprint` tool: instructions (soul), tool rules (risky tools set
to ask, never to allow), starter skills, and SOP drafts. The person reviews it before any agent
uses it; agents made from it start knowing the job instead of learning it on paid tokens.

## P42 Your own computers, from anywhere

See [PC-AGENT.md](PC-AGENT.md) "From the web, while away" and "Linux". In short: install the
agent on Windows, Mac **or Linux**; from any browser, see the computer's health, browse and
download from its shared folders, and — when turned on both on the computer
(`agentic-pc remote view|control`) and on the web (with your password) — watch its screen live
and use its mouse and keyboard. The computer shows a notice while it is watched or used, and
everything is in its activity log. Owner only.

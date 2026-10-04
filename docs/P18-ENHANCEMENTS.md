# P18: Beyond Hermes: library, twins, voice, calendar, scheduling, optimizer, UI (2026-10-04)

The detail docs:
- [P18-KNOWLEDGE-LIBRARY.md](P18-KNOWLEDGE-LIBRARY.md)
- [P18-VOICE-AND-IMAGES.md](P18-VOICE-AND-IMAGES.md)
- [P16-ASSISTANTS-GMAIL-WHATSAPP.md](P16-ASSISTANTS-GMAIL-WHATSAPP.md), §3a calendar and §3b schedules from chat
- [P17-LEARNING-ENGINE.md](P17-LEARNING-ENGINE.md)

Migrations:
- **0018:** `knowledge_chunks`, `files.library`, `files.department_id`, `files.indexed_at`, `agents.is_twin` with one twin per person.
- **0019:** `calendar_proposals`.
- **0020:** indexes for paged lists.

## What was added

| Area | What | Where |
|---|---|---|
| Knowledge library (RAG) | Library files and SOPs are split into passages and searched by keyword and by meaning, within each agent's scope (company, branch, department). Agents find passages three ways: they call `search_library`; `find_sop` now runs on the same search; and a short "From the library" section is added at the start of a task or chat turn when the match is good. Agents cite sources as [title p.N]. There is a `/library` page, and the Files page has a "Use as a guideline" switch | `knowledge/`, `agents/library_tools.py`, `api/routers/library.py` |
| AI twins | Each staff member has exactly one agent, their twin, made with a 3-step wizard. The persona belongs to the person; managers govern its tools and budget. It has a `/twin` page and a "Twin of …" pill. Staff are sent from `/agents/new` to `/twin` | `agents/twin.py`, `api/routers/twins.py`, `pages/twin/` |
| Voice | WhatsApp (WAHA and Meta) and Telegram voice notes become text. Web chat has a microphone. Speech-to-text uses the `transcribe` group (Groq Whisper first, free tier) | `engine/media.py`, `channels/voice.py`, `components/voice-input.tsx` |
| Images | The `generate_image` tool uses the `image` group (OpenAI gpt-image-1). The result is saved in Files, and the tool asks for approval by default | `agents/media_tools.py` |
| Calendar | Assistants read the agenda and find free slots on their own. Creating, changing or cancelling an event becomes a proposal that the owner confirms on the Drafts tab. Proposals are stored in Postgres | `assistants/calendar.py`, `calendar_tools.py` |
| Schedules from chat | `schedule_task`, `list_my_schedules` and `cancel_schedule` take plain-language times ("every Monday 9am", "Friday 4pm"). A person asking in chat counts as approval, unless the assistant read outside content (an email, a page, a file) in the same turn: then the person must confirm in their next message. Limits: 20 per agent, at most once every 15 minutes | `teams/when.py`, `agents/schedule_tools.py`, `policy.OUTSIDE_CONTENT` |
| Skill optimizer | Reflective prompt evolution in the GEPA/DSPy style (described below). It runs from the "Improve with AI" button on a skill, and nightly on one skill whose tests fail | `skills/optimize.py`, `POST /api/skills/{id}/optimize` |
| Lazy-load lists | Lists use keyset cursors (`limit` and `cursor`, with `X-Next-Cursor` and `X-Total-Count` headers). They load more as you scroll, and also have a "Load more" button and "Showing X of Y". Task board columns page on their own | `api/paging.py`, `lib/paged.ts`, `components/load-more.tsx` |
| Side sheets | The width follows the content, up to the screen width. Nothing inside a sheet scrolls sideways | `components/ui/side-sheet.tsx` and the page sheets |

### How the skill optimizer works

1. **Cases.** It uses the skill's test cases. If the skill has fewer than 2, it drafts cases from the skill's accepted work and saves them.
2. **Baseline.** It scores the current version.
3. **Reflect and rewrite.** A strong model sees the failing cases (the request, the answer and what was missing) and the passing ones. It rewrites the skill to fix the cause, not the symptom. It makes 2 variants per round, each focused on a different failure.
4. **Keep the best.** Every variant is tested on all cases. The best is the one that passes most cases; on a tie, the one that uses fewer tokens.
5. **Repeat.** It runs up to 3 rounds and stops when a round brings no improvement.
6. **Hand-off.** Only a version that beats the baseline becomes a proposal. The learning autopilot then decides on it, as for any other proposal.

## Hermes Agent comparison, updated

| | Hermes Agent | Agentic-AI after P18 |
|---|---|---|
| Learning procedures | Background review writes skills | Learns from tasks, failures, chat corrections, denials and sources. Every change is tested before it goes live. Skills that keep failing are repaired, and the optimizer evolves them |
| Knowledge | Session search, memory files | Facts with reconcile; wiki pages; **a library of your own documents, searched with citations**; session search |
| Voice | Voice mode | Voice notes on WhatsApp and Telegram, plus a web microphone |
| Images | Image generation | Image generation, gated by approval and saved to Files |
| Scheduling | Cron jobs from chat | Schedules from chat with a safety rule against prompt injection, plus the Schedules page |
| Calendar and email | Not built in | Gmail drafts and Google Calendar proposals, both confirmed by the owner |
| People | One user | A whole office: roles, scopes, one twin per staff member, personal assistants, approvals and audit |

## Setup after deploying

1. **Reindex the library.** Run `POST /api/library/reindex`, or use the button on `/library`, so SOPs that already existed get indexed.
2. **Allow the microphone on the live site.** Add `custom_headers` with `Permissions-Policy: microphone=(self)` to the Orxies site file. The default sends `microphone=()`, which blocks recording.
3. **Calendar.** Enable the Google Calendar API in the Cloud project, and add the `calendar.events` scope to the consent screen. Each person then presses "Reconnect Google to add Calendar".
4. **Images.** Images need an OpenAI provider. Voice works with Groq.

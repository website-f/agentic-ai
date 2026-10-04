# P18: Voice notes, the microphone and pictures (2026-10-04)

Two gaps closed against Hermes Agent: people can **talk** to their agents (WhatsApp and
Telegram voice notes, a microphone in every chat box) and agents can **make pictures**
(`generate_image`). Both run through the AI Engine like every other model call: model groups
with fallback, cooldowns, and one `llm_calls` row per attempt.

## 1. Turning it on (AI Engine > Model groups)

Two new groups appear by themselves (`engine/media.py`, created lazily like the others):

| Group | Label in AI Engine | Endpoint | Models that work |
|---|---|---|---|
| `transcribe` | Speech to text | `POST /audio/transcriptions` (multipart) | Groq `whisper-large-v3-turbo` (free tier), Groq `whisper-large-v3`, OpenAI `gpt-4o-mini-transcribe`, OpenAI `whisper-1` |
| `image` | Image generation | `POST /images/generations` | OpenAI `gpt-image-1`, `gpt-image-1-mini`, `dall-e-3` (any OpenAI-compatible endpoint works) |

**Auto-fill.** When a group is first created and the workspace already has a Groq or OpenAI
provider (by preset, or by `api.groq.com` / `api.openai.com` address), the known models above
are added, cheapest first (Groq whisper before OpenAI). Adding a Groq/OpenAI provider later
fills a group that is still empty. A group someone empties on purpose stays empty.

So for an office that already has Groq: voice works after deploy with no clicks. Pictures need
an OpenAI key (paid). Neither group is offered to agents as a chat brain: `GET /api/ai/groups`
now returns `kind` (`chat | embed | transcribe | image`), `gateway.chat()` refuses the two media
groups with a clear message, and the provider tester never picks a whisper/image model.

## 2. Speech to text

`engine/client.transcribe()` uploads the audio (file name with the right extension, since
providers detect the format from it: `voice.ogg`, `voice.webm`, `voice.mp4` ...). Whisper models
are asked for `verbose_json` (gives the audio length, used for cost); the gpt-4o transcribe
models only speak `json` and report usage instead. `gateway.transcribe()` walks the group:
skips providers that are off, keyless, cooling or whose model is stale; a 401/429/5xx cools the
provider and the next member is asked. No waiting for rate limits (a person is waiting).

Limits, refused with a clear sentence before any provider is called: **25 MB** (OpenAI and
Groq's own limit) and **10 minutes** when the length is known. `llm_calls.task` is
`audio.transcribe`; cost is an estimate from the published per-minute price (Groq bills at least
10 s; free-tier providers are 0; unknown models are unpriced).

### WhatsApp (`channels/whatsapp.py`, `channels/wa_bot.py`)

- **WAHA**: a message with `hasMedia` and an `audio/*` `media.mimetype` is a voice note. Only
  the *path* of `media.url` is used (it must start with `/api/files/`), fetched from the
  channel's own WAHA address with its `X-Api-Key`. The payload's host is ignored, so the key
  never goes elsewhere, and WAHA's `localhost` URLs work from the API container. WAHA must
  download media (its default, `WHATSAPP_DOWNLOAD_MEDIA=true`).
- **Meta Cloud API**: `type: audio` gives a media id; `GET graph.facebook.com/v21.0/{id}` gives
  a URL, which is fetched with the token only if it is on Meta's CDN (`*.fbsbx.com`,
  `*.facebook.com`, `*.whatsapp.net`).
- Strangers are still silent: nothing is downloaded or transcribed before the sender is a
  linked member with `work.write`.
- The transcript is handled exactly as typed text (same session, same agent, same learning).
  The answer starts with a WhatsApp quote of what was heard, so a mis-heard word is easy to spot:

  ```
  > Please book the meeting room for Friday
  *Chief of Staff*: Done, the meeting room is yours on Friday at 10.
  ```
- No speech model set up: one line back, "Voice notes are not set up here yet: an admin can
  add a speech-to-text model in AI Engine > Model groups > Speech to text. Please type your
  message for now." Download failure, silence and too-long notes each get their own line.

### Telegram (`channels/bot.py`, `channels/telegram.py`)

`message.voice` or `message.audio`: `getFile`, then `/file/bot<token>/<path>` (bots may download
up to 20 MB). Notes longer than 10 minutes (Telegram sends `duration`) are refused before
download. The transcript then goes everywhere typed text goes, including replying to a
question notification. The answer starts with `"what was heard"` on its own line.

### Dashboard microphone (`POST /api/transcribe`)

A mic button sits next to Send in the agent chat panel (`/chat`, agent detail) and in My
assistants (`components/voice-input.tsx`). It records with `MediaRecorder` (webm/opus; Safari
mp4), shows a timer with Cancel and Stop (Escape cancels, auto-stop at 10 minutes), uploads the
recording and **puts the text in the message box** to read, edit and send. Nothing goes to the
agent until the person presses Send. If the browser cannot record, the microphone is blocked
or there is no device, a toast says so. If the `transcribe` group is empty the button is dimmed
and a click explains where to add a model.

Endpoint: raw body (`application/octet-stream`, added to `RAW_UPLOAD_PATHS` in `api/main.py`:
the CSRF token is still checked), `X-File-Type: audio/...`, optional `?language=xx` (ISO-639-1)
and `?seconds=`. Needs `work.write`. 30 recordings per person per 10 minutes. Errors:
`415 not_audio`, `413 recording_too_large`, `400 bad_recording` (empty, over 10 minutes),
`409 no_transcribe_model`, `502 no_model_available`, `429 too_many_recordings`.
Returns `{text, language, seconds, model, provider}`. Nothing is stored.

**Live server: allow the microphone.** The shared reverse proxy sends
`Permissions-Policy: microphone=()` by default, which blocks recording in every browser. The
Agentic site entry needs `custom_headers` that allow `microphone=(self)` (keep the other
directives). Until then the button explains that the microphone is blocked. Browsers also
only allow recording on HTTPS (or localhost).

## 3. Pictures: `generate_image`

`agents/media_tools.py`, registered at the end of `agents/tools.py`.

| | |
|---|---|
| Arguments | `prompt` (required), `size` = `square` / `landscape` / `portrait`, `style` (free text, or `vivid`/`natural` for dall-e-3) |
| Risk / default | `medium` / **`ask`**: every picture costs money, so a person approves it (an agent on autonomy `auto` may make pictures without asking, like other medium-risk tools) |
| Sizes | gpt-image: 1024x1024, 1536x1024, 1024x1536 (quality `medium`). dall-e-3: 1024x1024, 1792x1024, 1024x1792 (quality `standard`, `response_format=b64_json`) |
| Result | Saved as a generated office file (`source=generated`, kind "Picture", the prompt as title), linked to the task and agent; shows in Files and can be attached or sent on by file id |
| Cost | `llm_calls.task = image.generate`, estimate per picture (gpt-image-1 medium $0.042 square / $0.063 wide; dall-e-3 standard $0.04 / $0.08) |
| No model | `Error: No picture model is set up. Add one in AI Engine > Model groups > Image generation (OpenAI gpt-image-1 or dall-e-3).` |

A provider that answers with a URL instead of base64 is fetched without the key, public
addresses only (SSRF guard), up to 20 MB. A reply that is not a PNG/JPEG/WebP counts as a
failure and the next member is tried.

## 4. Not built (on purpose)

- **Voice replies (text to speech).** WAHA's free Core edition cannot send voice or media
  (sending files is a WAHA Plus feature), and the Meta API needs an upload step plus
  ogg/opus conversion. Replies stay text. The routing would be the same pattern (`speech`
  group, `POST /audio/speech`) if it is wanted later.
- **Sending a generated picture over WhatsApp** for the same reason. The picture is in Files;
  the agent's message names it, and the dashboard link opens it.
- Audio is never kept: voice notes and recordings exist only for the length of the request.

## 5. Files

Backend: `engine/media.py` (groups, auto-fill, prices, sizes), `engine/client.py`
(`transcribe`, `generate_image`, `download`), `engine/gateway.py` (`transcribe`,
`generate_image`, `NotConfigured`, `MediaRejected`), `engine/store.py` (default groups),
`engine/tester.py`, `api/routers/media.py` (`POST /api/transcribe`), `api/routers/ai_engine.py`
(`kind`, fill on new provider), `api/main.py`, `channels/voice.py`, `channels/whatsapp.py`,
`channels/wa_bot.py`, `channels/telegram.py`, `channels/bot.py`, `agents/media_tools.py`,
`agents/tools.py`. Tests: `tests/test_media.py`.

Frontend: `components/voice-input.tsx`, `pages/agents/chat-panel.tsx`,
`pages/assistants/index.tsx`, `pages/ai-engine/data.ts` (`Group.kind`).

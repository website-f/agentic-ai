# P31: the PC agent (a person's own computer, for their own AI)

A small program on a person's Windows, Mac or Linux computer that lets **their own AI** (their twin,
or their private assistant) find and read files in folders they chose, copy files into their
workspace, and drive a real, visible browser window on their screen. It is installed in one of
two ways, both ending in the same agent:

- **Command line** (no warnings on either system, no signing needed): one line copied from the
  web, with a one-time link code in it, so the PC is installed and linked in one paste.
  - Windows (PowerShell): `irm https://HOST/i/CODE/win | iex`
  - Mac (Terminal): `curl -fsSL https://HOST/i/CODE/mac | sh`
  - Linux (terminal): `curl -fsSL https://HOST/i/CODE/linux | sh` (P42: the same `install.sh`;
    it checks the system and installs a systemd user service, or desktop autostart)
- **Desktop app** (download `.exe` / `.dmg`; NOT shipped yet: the link dialog offers it only
  when `AGENTIC_PC_APP_WINDOWS_URL` and `AGENTIC_PC_APP_MAC_URL` are both set): the same agent plus a tray icon and a window
  (status, folders, activity, pause, unlink). Unsigned for now: a one-time "Run anyway" /
  "Open Anyway" step, shown with pictures on the web page.

## Rules (enforced on the server AND on the PC)

- A PC belongs to **one person** and only **that person's own AI** may use it: an agent whose
  `owner_user_id` is the device's user and which is their twin (`is_twin`) or their private
  assistant (`private`). Company agents, colleagues and managers never reach it.
- The agent sees **only the folders the person picked** (default: Documents, Desktop,
  Downloads). Always refused, whatever the folders: `.ssh`, `.gnupg`, `.aws`, `.azure`,
  `.kube`, `.docker`, keychains, browser profiles (Chrome/Edge/Firefox/Safari user data),
  password managers (`*.kdbx`, `*.1pif`, 1Password/Bitwarden data), `*.pem`, `*.key`, `*.p12`,
  `*.pfx`, `id_rsa*`, `id_ed25519*`, `.env*`, `Cookies`, `Login Data`, `Web Data`.
  Paths are resolved (real path, symlinks followed) before the check, so a link cannot escape.
- Writing a file to the PC and submitting a web form always ask the person first.
- Paused (from the web or the PC) = every call refused with `paused`.
- Unlink (web, or `agentic-pc unlink` / `uninstall` on the PC via
  `POST /api/devices/self/unlink` with its bearer token) revokes the token at once; the PC
  forgets it.
- Programs and scripts (`.exe`, `.ps1`, `.bat`, `.vbs`, `.lnk`, `.sh`, ...) are never saved to
  the PC, and file bytes only travel to the linked server's own origin (https, or localhost).
- Everything the agent does on the PC is logged: on the server (`device_activity`, shown on
  the My computers page) and on the PC (`activity.jsonl`, shown in the app).
- Browsing on the PC uses a **separate "Agent" browser profile**, never the person's own
  Chrome/Edge profile (their saved passwords and cookies stay out of reach). It exits from the
  person's own internet line.

## Pieces

| Piece | Where |
|---|---|
| Server: linking, device connection, calls, uploads, CDP relay, install scripts | `apps/api/agentic/devices/`, `api/routers/devices.py` |
| Agent tools (`pc_find_files`, `pc_read_file`, `pc_save_to_workspace`, `pc_save_to_pc`) | `apps/api/agentic/agents/pc_tools.py` |
| Browser on the PC (the browser service drives the PC's Chrome over CDP) | `apps/browser/service.py`, `agents/browser_tools.py` |
| The PC agent (Node 22+, no npm dependencies) and its CLI | `apps/pc-agent/` |
| Install scripts (templates the server fills in) | `apps/pc-agent/install/` |
| Desktop app (Electron, wraps the same core) | not built yet |
| Agent unit tests (`node --test apps/pc-agent/agent.test.cjs`) | `apps/pc-agent/agent.test.cjs` |
| Browse on the PC: `device_id` on a web task, `browser_tools._open_on_pc`, the browser service's `cdp_url` session (Playwright `connect_over_cdp`) | `api/routers/web_tasks.py`, `agents/browser_tools.py`, `apps/browser/service.py` |
| Web: My computers page, link dialog, composer "browse on my PC" | `apps/web/src/pages/computers/` |

## Linking

1. Web (signed in): `POST /api/devices/link-code` → `{code, expires_at, install: {windows, mac},
   downloads: {windows, mac}}`. Code: 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`,
   single use, 10 minutes, at most 5 open codes per person.
2. Install script: `GET /i/{code}/win` (PowerShell) or `GET /i/{code}/mac` (sh), served by the
   API (nginx `location /i/` → api `/api/install/`). The script embeds the server URL and code.
   It does not consume the code.
3. The agent links: `POST /api/devices/claim {code, name, os, arch, version}` (no session; the
   code is the credential; rate limited per IP) → `{device_id, token, name}`. Token: 32 random
   bytes (urlsafe), stored as SHA-256 only. The PC keeps it in its config file (owner-only).

## The connection (one WebSocket per PC)

`wss://HOST/api/devices/connect`. The first message from the PC authenticates (Node's built-in
WebSocket cannot set headers):

```
PC  → {"type":"hello","token":"…","version":"0.1.0","os":"windows|mac","arch":"x64|arm64",
       "hostname":"…","folders":["C:\\Users\\a\\Documents",…],"paused":false,
       "browsers":["chrome","edge"]}
SRV → {"type":"welcome","device_id":"dv_…","name":"Aina's laptop",
       "settings":{"folders":[…],"paused":false}}
SRV → {"type":"error","code":"bad_token|revoked|paused_by_server","message":"…"}  then close
```

Then, either way:

```
{"type":"ping"} / {"type":"pong"}                      every 25 s; 60 s silence = offline
SRV → {"type":"call","id":"c_…","method":"files.search","params":{…}}
PC  → {"type":"result","id":"c_…","ok":true,"data":{…}}
PC  → {"type":"result","id":"c_…","ok":false,"error":{"code":"…","message":"…"}}
SRV → {"type":"settings","folders":[…],"paused":false}  the person changed them on the web
PC  → {"type":"state","folders":[…],"paused":false,"browsers":[…]}  changed on the PC
```

The server's settings are the truth for folders and pause; a change on the PC is sent as
`state` and the server stores it. WebSocket messages stay small (≤ 256 KB): file bytes travel
over HTTPS uploads/downloads, never in the socket.

### Methods (server → PC)

| Method | Params | Data |
|---|---|---|
| `system.info` | – | `{os, os_version, hostname, version, folders, paused, browsers, home}` |
| `files.search` | `{query, folder?, exts?: ["pdf","docx",…], modified_after?: ISO, limit?: ≤50}` | `{items: [{path, name, ext, size, modified}], truncated, scanned}` — name match (all words, case/accent-insensitive), newest first, walks at most 50 000 entries / 8 s |
| `files.list` | `{folder}` (inside an allowed folder) | `{folder, items: [{path, name, is_dir, size, modified}]}` (≤ 500) |
| `files.upload` | `{path, upload_url, max_bytes?}` | PC POSTs the bytes to `upload_url` (HTTPS, `Authorization: Bearer <token>`, `Content-Type: application/octet-stream`, `X-File-Name` URL-encoded); `data: {name, size, sha256}` |
| `files.save` | `{download_url, folder, name}` | PC GETs `download_url` (Bearer) and writes `folder/name` (never overwrites: adds " (2)"); desktop app asks the person first; `data: {path, size}` |
| `browser.open` | `{channel, start_url?}` | PC starts Chrome/Edge (headed, own profile dir, `--remote-debugging-port=0`, `--remote-debugging-address=127.0.0.1`), reads `DevToolsActivePort`, opens `wss://HOST/api/devices/cdp/{channel}` (first message `{"type":"hello","token":"…"}`, then raw CDP frames both ways) and pipes it to its local `ws://127.0.0.1:PORT/devtools/browser/…`; `data: {browser, version}` |
| `browser.close` | `{channel}` | closes the pipe and the browser window it opened |

Errors use codes: `paused`, `not_allowed` (outside the folders / deny list), `not_found`,
`too_big`, `no_browser`, `busy`, `failed`.

### Server-side calls between processes

Agent tools run in the worker; the PC's socket lives in the API process. The worker calls
`POST http://api:8501/internal/devices/{id}/call {method, params, timeout}` with header
`X-Internal-Token` (HMAC of the app secret) and gets the PC's result (or `offline` / `timeout`).
The browser service reaches the CDP relay at `ws://api:8501/internal/devices/cdp/{channel}`
with its `X-Browser-Token`; the API pairs it with the PC's `/api/devices/cdp/{channel}` socket.

## Files on the server

- `POST /api/devices/uploads/{call_id}` (Bearer device token, octet-stream, ≤ 25 MB): the bytes
  for a `files.upload` call; kept until the tool picks them up (5 minutes).
- `GET /api/devices/downloads/{one_time_id}` (Bearer): bytes for a `files.save` call.
- A file copied into the workspace lands in the person's **My workspace/From my PC/** folder
  (owner = the person, so it is a personal file), passes the usual secrets scan and indexing.

## Install layout on the PC

| | Windows | Mac |
|---|---|---|
| Program | `%LOCALAPPDATA%\AgenticOffice\` (`node\`, `agent\agent.cjs`, `bin\agentic-pc.cmd`) | `~/Library/Application Support/AgenticOffice/` (`node/`, `agent/agent.cjs`, `bin/agentic-pc`) |
| Config + logs | `%APPDATA%\AgenticOffice\` (`config.json`, `activity.jsonl`, `agent.log`, `browser-profile\`) | same folder as the program |
| Starts with the computer | `HKCU\…\Run` → `wscript.exe launch.vbs` (no console window, no admin) | `~/Library/LaunchAgents/space.oriondesk.agentic.pc.plist` (KeepAlive) |

Node comes from nodejs.org (latest of the pinned LTS major), checked against its SHASUMS256.
Node's own binaries are signed by the OpenJS Foundation and arrive through the command, so
neither SmartScreen nor Gatekeeper asks anything. The agent itself is one JavaScript file
served by the server at `/downloads/pc-agent/agent.cjs` (+ `.sha256`): the web image copies
`apps/pc-agent/agent.cjs` into its static files and writes the checksum at build time.

Uninstall (`agentic-pc uninstall`): unlink, stop the agent, remove the `Run` entry and the PATH
entry, delete the config folder, then the program folder once node exits (a one-time `RunOnce`
entry repeats that at the next sign-in in case it was cut short).

CLI: `agentic-pc status | folders [add|remove] <path> | remote [off|view|control] | pause |
resume | unlink | logs | uninstall | run | link <code> --server <url>`.

## Linux (P42)

`~/.config/agentic-office/` (`node/`, `agent/agent.cjs`, `bin/agentic-pc`, config and logs).
Starts at sign-in through a systemd **user** service (`~/.config/systemd/user/agentic-pc.service`,
`Restart=on-failure`), or `~/.config/autostart/agentic-pc.desktop` where there is no user
systemd. No sudo. `agentic-pc uninstall` disables and removes both. Folders on Linux live under
`/home/<you>/…`, `/mnt/…` or `/media/<you>/…`.

## From the web, while away (P42)

The person themselves (never an AI, never an admin) can reach their own computer from any
browser they are signed in on: **My computers → Open from the web**
(`/computers/<id>/remote`, `apps/web/src/pages/computers/remote.tsx`).

| | What | Lock |
|---|---|---|
| Health | CPU busy %, memory, disks, uptime, who is signed in (`system.health`) | online and not paused |
| Files | browse the shared folders, search by name, download (`files.list`, `files.search`, `files.upload`) | the same folders the AI may see |
| Screen | a live view: one JPEG after another (`screen.capture`, uploaded like a file, never stored) | **view** |
| Control | click, double click, right click, scroll, type text, named keys and combinations (`input.send`) | **control** |

**Two locks, both needed** (`devices.remote_pc`, `devices.remote_allowed`; migration `0039`):

1. On the computer: `agentic-pc remote off | view | control` (off by default). The agent reports
   it in its hello and state messages; it also refuses `screen.capture` / `input.send` itself
   when its own level is lower. Easiest when linking: tick **Also let me see and use this
   computer from the web** in the link dialog; the install line then ends in `/control`
   (`irm https://HOST/i/CODE/win/control | iex`, `/i/{code}/{kind}/{view|control}`) and the
   agent links with `--remote control`. Running that line on the computer is the consent.
   Do it before travelling: from far away it can only be turned off, never on.
2. On the web: the switch on the remote page, `PUT /api/devices/{id}/remote {level, password}`.
   Turning **on** needs the person's password; turning off does not. Audited (`device.remote`).

What works is the lower of the two (`core.remote_level`). The remote page shows both as two
numbered steps with their state (live: the page updates the moment the computer reports in),
and only shows the Off / See screen / Full control switch once both are done. The computer shows a **notification
on its own screen** when a view or control session starts (again after two quiet minutes), and
every session is in the activity log (screen and control rows at most once per five minutes;
typed text is never logged, only that keys were sent).

API (owner only, `devices._own`, 404 for anyone else):

- `GET /api/devices/{id}/health`
- `GET /api/devices/{id}/files?path=` (a folder) `| ?q=` (a search) `|` nothing (the shared folders)
- `GET /api/devices/{id}/files/download?path=`
- `PUT /api/devices/{id}/remote {level, password}`
- `GET /api/devices/{id}/screen?w=&q=` → `image/jpeg`, `X-Screen-Width/Height`, `no-store`
- `POST /api/devices/{id}/input {kind: mouse, x, y (0..1 of the screen), action, dy}` or
  `{kind: key, text}` or `{kind: key, key: "ctrl+c" | "enter" | "alt+tab" | "f5" ...}`

How each system does it (`apps/pc-agent/agent.cjs`):

- **Windows**: a small helper program, `agentic-pc-helper-<hash>.exe`, compiled on first use by
  the C# compiler that ships with Windows (.NET Framework 4, `csc.exe`) into
  `%LOCALAPPDATA%\AgenticOffice\helper\`. It captures all monitors (`CopyFromScreen`, DPI
  aware) and sends mouse (`SetCursorPos`/`mouse_event`) and keys (`SendKeys`). Its full
  source is in agent.cjs and it is rebuilt when that changes. (A PowerShell script doing the
  screen capture is blocked by Windows Defender as screen-grabbing malware; an ordinary
  program is how remote-desktop tools do it.) Screen locked / nobody signed in: `no_screen`.
- **Mac**: `screencapture` + `sips`; input through JXA (CoreGraphics mouse events, System
  Events keystrokes). macOS asks once for **Screen Recording** and **Accessibility** for the
  program that runs the agent.
- **Linux**: `grim` (Wayland) or ImageMagick `import` (X11) for the screen; `xdotool` for input
  (X11 sessions only).

Not a full remote desktop protocol: frames are polled (about one to three a second, depending
on the computer and the line), which is enough to check something, click through a program
or type a short reply, and is what fits through the existing HTTPS connection with no extra
port, relay or app.

## Always back online, the Windows program, the status page (P52)

**Never stuck offline.** Before 0.3.0 a reconnect attempt that hung (the office server
restarting during an update, Wi-Fi changing) could wait forever while the agent looked
running. Now:

- every connection attempt is given up after 20 s and retried (2 s, doubling to 60 s, with
  jitter); every retry is logged with a plain reason;
- after the computer sleeps (the clock jumps more than 30 s between 5-second ticks) it
  reconnects at once;
- `status.json` (next to `config.json`) says `online | connecting | offline | not_linked`,
  since when, the last reason and the next try.

**Status page.** The running agent serves a page on `http://127.0.0.1:47615` (the next five
ports if taken): connected or not and why, *Reconnect now*, *Pause / Let the AI use it again*,
what to do when offline, and a form to link with a code. Only this computer can open it, only
with the key the agent writes to `status.json` (a new one each start), only with a `Host` of
127.0.0.1 or localhost (no DNS rebinding), POSTs only from its own origin, framing denied.

**Commands.** `agentic-pc doctor` checks linked, server reachable, running (starts it if not),
online, paused, starts with Windows. `agentic-pc open` opens the status page. `agentic-pc
start` starts it in the background.

**Windows program.** `AgenticOfficePC.exe` is the agent as one file (a Node single executable
application, built by `apps/pc-agent/build-exe.cjs` in the API image: the official `node.exe`
of the build's Node version, checked against nodejs.org, its signature removed, `agent.cjs`
embedded, marked as a windowed program so no console window ever opens). On *Link a
computer*, Windows people get *Download for Windows (.exe)*: `GET /i/CODE/exe` (or
`/i/CODE/exe/control`) streams the program with a newline and
`#AGENTIC-OFFICE-LINK#{"server", "code", "remote"}#END#` appended (after the last section, Windows ignores it). Double-clicked, it:

1. copies itself to `%LOCALAPPDATA%\AgenticOffice\AgenticOfficePC.exe`;
2. starts with Windows (`HKCU\...\Run`, `"...AgenticOfficePC.exe" run`: no script host, so it
   keeps working as Windows retires VBScript), adds itself to Settings > Apps (uninstall there)
   and to the Start menu (*Agentic Office*, opens the status page);
3. links with the code inside (once; the code works once and for 10 minutes, after that the
   page asks for a new one);
4. starts the agent (an older one running is replaced) and opens the status page.

It is not code-signed, so SmartScreen asks once (*More info > Run anyway*). Sign it with a
certificate (`signtool`) to remove that warning. The one-line installers stay for Mac, Linux
and anyone who prefers them; both installs share the same configuration and only one agent
runs at a time.

## Desktop app

Electron, wrapping the same core. Tray icon (online / paused / offline), a window with status,
folders (native folder picker), recent activity, pause, unlink, "Link this computer" (paste
the code). It starts with the computer (`setLoginItemSettings`) and, when it starts, turns off
the command-line autostart so the two never run at once (one lock file in the config folder).
Builds: Windows NSIS `.exe`, Mac `.dmg` (ad-hoc signed, not notarised), published as GitHub
release assets; the server's `/downloads/app/windows` and `/downloads/app/mac` redirect there.

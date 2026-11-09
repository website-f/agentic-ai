# P92: ePerolehan runs on the person's own computer

Fitri's feedback (9 Nov 2026): "make sure ePerolehan work goes first and primarily to the user's
own linked PC; if not linked, ask them to link it. Make linking super user friendly."

## How it works now

**One rule.** Any ePerolehan work started by or for a person runs on **that person's own linked
computer**:

- a "Browse a website" task on `eperolehan.gov.my` (any mode, tender mode included),
- any agent that opens an ePerolehan page while working on someone's task (their own AI, or a
  shared agent working on a task they gave, or a schedule they made),
- whatever the owner chose on **Web connections** (this server, a company computer or the
  company's proxies). That choice now only covers the office's own work, with no person behind
  it (a mail rule, an agent's own idea), exactly as before.

It never quietly uses another person's computer, the company's chosen computer, the proxies or
this server's address instead. When the person's computer is not ready, the work is refused
with the plain reason and the next step.

| What the server sees | State | What the person is told |
| --- | --- | --- |
| No computer linked | `not_linked` | Link your computer first. It takes about 2 minutes: open My computers and press Link a computer. |
| Linked, but not connected | `offline` | Turn on *name* and open Agentic Office PC on it. |
| Connected, ePerolehan not allowed yet | `not_allowed` | On *name*, press Allow on the Agentic Office page. We sent the request to it. |
| Connected, app older than 0.5.0 (no Allow button) | `needs_update` | *name* has an older Agentic Office PC. Download the app again and run it, then press Allow. |
| Paused | `paused` | *name* is paused. Turn it back on in My computers. |
| Connected, allowed, not paused | `ready` | Your computer *name* is ready. |

`GET /api/devices/my-pc-status?site=eperolehan.gov.my` answers
`{state, needed, site, device: {id, name, last_seen_at, version}, asked, next}` (`next` in the
person's language). `needed` is false for a site that does not go through a computer.

**The Allow request goes to the person's own PC by itself.** When the person's computer is
online but has not allowed ePerolehan, the server sends it the Allow request (at most once a
minute by itself; "Send the request again" sends it at once, at most every 5 seconds:
`POST /api/devices/my-pc-status/ask`). When it is offline, the server remembers (Valkey
`devices:want:<user>`, one day) and asks the moment it connects. Pressing Allow on the computer
is still the person's consent there: nothing passes until they press it.

**Before work starts.** The task composer shows a status card when the link is ePerolehan
(and the tender form, which fills in the ePerolehan link): starting waits until the card is
green. The server checks again (`409 pc_not_ready` with the same plain words), so nothing
starts by going round the web page. Other work that only mentions ePerolehan shows the card
without holding the task back. An agent that needs the portal gets the same reason and the
link to My computers to pass on, and is told not to try another way.

**Linking needs no AI twin.** Anyone who gives work (`work.write`: staff, supervisors,
managers, operators, owner, admin) links their own computer; the computer belongs to the
person. Only a personal AI (twin or private assistant) ever gets the folder and screen tools,
so linking without one gives no AI new reach into the computer's files. Approvers and viewers,
who give no work, still cannot link (unless they have an AI of their own).

**Old computers keep working.** A computer that already allowed ePerolehan stays ready,
whatever its app version. One older than 0.5.0 that has not allowed it is told to get the new
app (it has no Allow button). App 0.5.1 shows plainer words when the request is for the
person's own work; 0.5.0 shows the office's wording and works the same.

## Staff steps (what the screens say)

### Starting ePerolehan work

1. Press **Give a task**, choose **Browse a website**, and **Prepare a tender** (or paste an
   ePerolehan link).
2. A card shows under the link:
   - green **Your computer AINA-LAPTOP is ready**: press **Start browsing**.
   - amber **Turn on your computer and open Agentic Office PC**: turn the computer on. The card
     turns green by itself (or press **Check again**).
   - amber **Press Allow on your computer**: on the computer, the Agentic Office page has
     opened with a blue **Allow** button. Press it once. (Did not see it? **Send the request
     again**.)
   - red **Link your computer first — about 2 minutes**: press **Link my computer** and follow
     the steps below. "Let my ePerolehan work run on this computer" is already on.

### Linking a computer (once)

On the Windows computer you use for ePerolehan, open **My computers** (or press **Link my
computer** on the card).

1. **Download** — press the big **Download for Windows** button. Your code is inside the file.
2. **Open the file** — open `AgenticOfficePC.exe` (in Downloads). Windows asks once whether to
   trust it: click **More info**, then **Run anyway**. (The pictures show where.)
3. **Waiting…** — it links by itself in about a minute and opens a page that says **Online**.
4. **Linked! Now press Allow on your computer** — the Agentic Office page on the computer asks
   "Your ePerolehan work runs on this computer. Press Allow". Press **Allow** once.

Opened on a phone? The wizard says to open the same page on the Windows computer and shows the
short address (`agent.oriondesk.space/computers`) and the code, big. Code expired? It says so
and **Get a new code** starts again (an older download will not link). Mac, Linux and the
one-command install are under **Other ways**.

## For the owner

- Web connections now says: "Whatever you choose here, ePerolehan work for a person always runs
  on that person's own linked computer. This choice is for the office's own work."
- Staff computers lists everyone's linked computers as before; its empty state links to My
  computers.
- Error texts that used to say "Staff computers" now say "My computers" with the link.

## Files

- API: `devices/tunnel.py` (`PC_ONLY`, `person_state`, `pc_status`, `ask_own`, own-PC-first
  routing in `_route` and `screen_for`), `devices/hub.py` (asks the person's own PC on connect),
  `devices/bridge.py` (`ask_sites` from the worker), `api/routers/devices.py` (status and ask
  endpoints, `/internal/devices/{id}/ask`, link without a twin), `api/routers/web_tasks.py`
  (waits for the PC), `agents/browser_tools.py` (the reason and the link for the agent).
- Web: `lib/my-pc.ts`, `components/my-pc-status.tsx`, `pages/computers/link-dialog.tsx`
  (wizard), `pages/computers/illustrations.tsx` (the Allow picture), the task composer,
  `i18n/ms/my-pc.ts`.
- PC app 0.5.1: `apps/pc-agent/agent.cjs` (`own` asks).
- Tests: `apps/api/tests/test_p92_own_pc.py`, `apps/web/src/components/my-pc-status.test.tsx`,
  `apps/pc-agent/agent.test.cjs`.

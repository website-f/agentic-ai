# P97: ePerolehan (and any site) on the person's PC, at a skilled clerk's speed

Fitri's feedback (11 Nov 2026): "When I ask for any ePerolehan work via the linked PC browser,
why is it very slow? It clicks too many times and finds buttons very slowly. Can it first
research on the web how to operate it and where to click, then go hands on, and learn along the
way: the first time maybe slow, but next time much faster."

## Where the time went (measured)

Live (Rafi's last ePerolehan task): 13 model calls, about 5.4 s and 20.7k prompt tokens each,
plus about 1 s of cursor path (12-22 CDP round trips over the relay) and 1-2 s of pacing per
click.

Repeatable bench: `apps/api/tests/test_p97_browser_bench.py` runs one checking job on the
practice ePerolehan (`deploy/demo/practice_ep.py`, laid out like the supplier manuals: sign-in,
Papan Kenyataan, KRITERIA CARIAN, Semak, the proposal and its documents) through the real agent
loop, the real browser tools and the real browser service driving a real Edge over CDP (the
person's-PC path), with a scripted model that bills what it is sent. Model time is estimated at
the live rate (1.5 s + 0.19 s per 1,000 prompt tokens: 5.4 s at 20.7k).

| | Before P97 (first and second run) | P97 first run | P97 second run |
| --- | --- | --- | --- |
| Model calls | 18 | 6 | 4 |
| Prompt tokens per call (avg / max) | 17.0k / 19.7k | 12.9k / 16.5k | 13.4k / 16.7k |
| Browser tool calls | 17 | 5 | 3 |
| Actions on the page (finds) | 19 (4 finds) | 11 (0) | 8 (0) |
| Browser seconds | 41 | 15-24 | 10-14 |
| Approvals asked | 1 | 1 | 1 |
| Task time, estimated | about 127 s | about 39-49 s | about 26-31 s |

Before, the second run was no faster: nothing was learned, and on the PC a saved sign-in was
never used again (the service always answered "not restored"), so every PC task signed in anew.

## What changed

**Knows where to click: the site playbook** (`agents/site_playbook.py`). One brain page per
site, `wiki/sites/<host>.md`, per workspace (people read and edit it on the Brain page):

- ePerolehan's is built in, written from the public supplier manuals
  (eperolehan.gov.my/download-supplier: start pages, the menu, the path and the field and button
  names for finding a quotation, checking eligibility, the proposal, documents, awards, the
  company profile; pitfalls such as 12:00 PM closing, "<< Kembali" instead of Back, the
  certificate PIN being a person's job).
- Every browser task's first message carries the playbook of its sites, fenced and labelled as
  data, never instructions: the office's rules and approvals always apply.
- Research first: for a site with no playbook, the agent is told to look up the site's public
  user guide (web_search) and save a short draft playbook before going hands on.
- Learned: after a task finishes well (done or review, with a result), the path it took is
  written under "Learned paths" (per job, newest first, at most 6, "seen N times"): each step by
  role and name, and the page it led to, so the next run opens that page directly. Typed values,
  query strings, record numbers (as `<ref>` / `{id}`) are never written; a private assistant
  writes nothing. Runs from `skill_reflect` after `routines.learn` (P96 learned procedures still
  replay whole jobs without the model once confirmed).

**One click per intent, several per model call** (`browser_steps`, the browser service):

- `browser_steps`: a short batch (open, click, type, select, check, wait, scroll, back), done in
  order with a check after each (`expect`: text or `url:<part>` that must show), stopping at the
  first surprise (an element that is not there or not the only match, a send, a page off the
  allowed sites, a site rest). One look at the page at the end instead of one per action. Each
  step must be allowed for the agent without asking (its own tool's setting); a send, an upload
  or a sign-in is never a step. A short site-budget rest carries on with only the steps not done.
- Elements by role and name (no find, no ref) in click, type, select, check, wait and submit:
  one match required, never guessed; a page still loading is looked at again for up to 5 s.
- A second click on the same element right after one that showed no change first waits for the
  page; if the page changed meanwhile, the second click is not made.
- On the person's PC: a 3-5 point cursor path (was 12-22 round trips), no second hover, brisk
  typing (35-90 ms a key) and a shorter beat before a field; filling fields adds no pacing wait
  of its own (the per-minute cap and the site budget still count every action).
- A saved sign-in laid into the PC browser is now reported, checked once and used.

**A smaller prompt**: page views older than the newest whole view of a page are sent as one-line
stubs (expand_result brings them back); while the agent is hands on in the browser, its other
tools are sent short (one line and their required parameters), about half the tool tokens.

## Safety (unchanged)

Sends and uploads still wait for a person (`browser_submit`, `browser_upload`, `ALWAYS_ASK`),
inside a batch too. Allowed sites, the address guards, site budgets, the person's-own-PC rule
(P92) and masking of typed values (the analyst's record, `task_flow.TYPED`) all apply as before.
The link "Klik sini untuk sediakan / kemaskini cadangan tawaran" still counts as a send (it may
create the proposal draft), so opening a proposal asks once.

## Not done, for a decision

- A cheaper model for routine browser steps: not switched automatically (the batches already
  cut the calls by two thirds; a weaker model mid-portal risks wrong clicks). Could be an opt-in
  per workspace.
- ePerolehan's in-portal search and "Klik sini ..." are form posts and keep asking a person.
  Exempting read-only posts (search, open) would be faster but widens the approval rule: Fitri's
  and management's call.

## Run the bench

See the docstring of `apps/api/tests/test_p97_browser_bench.py` (`P97_BENCH_FLOW=old` scripts
the pre-P97 way; the browser service runs through `deploy/demo/browser_bench_service.py`).

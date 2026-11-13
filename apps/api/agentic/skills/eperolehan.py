"""P92: the office's ePerolehan tender procedure as a real skill.

Tender mode (Browse for me, mode "tender") used to carry its whole procedure in a fixed brief,
so nothing learned on one tender reached the next. Now every tender task follows the built-in
skill `eperolehan-tender`: the task records it as used (so reflection and the nightly curator
patch THIS skill, and its success is measured), and the brief carries the skill's live
Pitfalls, where the lessons people teach are folded every night (brain/lessons.py) through
the normal proposal -> tests -> autopilot path. The stages themselves stay in the brief
(web_tasks.brief_for) and in this skill's Steps.

P97: how to work the portal quickly. The way around the portal (start pages, menu paths, the
names of fields and buttons per job, pitfalls) is the site playbook wiki/sites/
eperolehan.gov.my.md (agents/site_playbook.py: seeded from the public supplier manuals, put in
every ePerolehan task's first message, and taught the path of every finished run). The agent
sends the actions it knows as one browser_steps call by role and name, and clicks once.

P102: looking something up (the inbox, a status, a notice by its QT number or title) is its
own short procedure ("Looking something up"): the screen's own search box, not scrolling; a
sign-in, captcha or one-time code stops for a person. A workspace seeded before a section
was added gets it once (`upgrade`, run by store.ensure_builtin), its own edits and live
Pitfalls kept. The office's imported bid know-how (skills/folder_import.py, e.g. a
tender-fulfillment skill) is linked to this skill (workspace settings "skill_links"): tender
work gets both.
"""

import re
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Agent, Skill, SkillUse, SkillVersion, Task, Workspace

NAME = "eperolehan-tender"

DESCRIPTION = (
    "Prepare a Malaysian government tender or quotation on ePerolehan: check, research "
    "products, fill the portal, print the offer summary; a person approves submission."
)

BODY = """## When to use
A tender, quotation (sebut harga) or proposal (cadangan) is prepared on ePerolehan (or a
similar government procurement portal), usually from Browse for me in tender mode.

## Steps
1. Verify the signed-in company and the tender reference; stop and ask_human if either
   differs from the request. On a rerun, check each stage first (proposal open with a No.
   Cadangan, tender documents in the company's files, product recommendation confirmed,
   fields filled, attachments uploaded, summary saved): skip what is done, fix what is wrong,
   never upload a file twice or open a second proposal.
2. Read the company's tender procedures and submission documents (company_documents,
   search_library, read_file).
3. On the portal open the tender, check eligibility and download every tender document; read
   them with read_file. A search button (Cari, Carian, Search) is an ordinary click; any
   other button that sends a form needs browser_submit and a person's approval, even when it
   only downloads.
4. Keep an evidence manifest of every portal field and attachment with each value's source at
   wiki/tenders/<tender-reference>.md (write_page).
5. Products: reuse an existing "Product recommendation - <tender reference>"; otherwise check
   past submissions first, then the public web; shortlist 2 to 3 products that meet every
   line, compare them in a table with sources, recommend one, save it with publish_research,
   and ask_human to confirm before filling anything. An unverified registration or
   certificate number is [[REQUIRES HUMAN INPUT]].
6. After the confirmation, fill the portal the way the company's past submissions read
   (Maklum Balas Ya where it complies; in Catatan the confirmed brand, model and the
   specification that meets the line).
7. Prepare documents only for an attachment the portal asks for (draft_document,
   check_document, then browser_upload).
8. Saving, uploading, declaring, signing or submitting waits for a person's approval
   (browser_submit, browser_upload).
9. At the last step before submission press the offer printout (Cetak Tawaran) and name the
   PDF "QT<last 5 digits> - <COMPANY SHORT NAME> SUMMARY" with rename_file.
10. ask_human to approve the final submission, naming the summary file, and finish with
    publish_report (a table of stages: done before, done now, skipped, needs a person).

## Working the portal
- Follow the site playbook in the task (wiki/sites/eperolehan.gov.my.md): open the screen
  you need directly when its address is known, and send the clicks and fields you already
  know as one browser_steps call by role and name, each with what should show after it.
- One click per intent: a click that showed no change yet means wait (browser_wait), not a
  second click. Never look up a button with browser_find when the playbook names it.
- The link "Klik sini untuk sediakan / kemaskini cadangan tawaran" counts as a send: ask
  once with browser_submit.
- When the portal differs from the playbook, follow the portal and correct the playbook
  (write_page, mode append).

## Looking something up
When the request is only to find or check something (the inbox, a quotation's status, a
notice), do just that: no proposal, no downloads, no filling.
1. Sign in when the portal asks (browser_login with the saved login, once). A sign-in page
   later means the session ended: sign in once more. No saved login, a captcha, a one-time
   code, a security question or a certificate PIN: stop and ask_human. Never guess them.
2. Go to the screen the site playbook names (the inbox: its job "Check the inbox") and use
   that screen's own search box: type the quotation number (No. Sebut Harga, QT and its
   digits) or a short, distinctive part of the title (tajuk) spelled as printed, then click
   its search button. One browser_steps call does both. Never scroll page by page through a
   list; on a long page use browser_find with the number or the words.
3. Nothing found: try once more with the number alone or fewer title words, then say plainly
   what you searched and where. Never guess a status.
4. Read the matching rows (browser_read with the number as focus) and report a table: number,
   title, agency, what the item is or asks, status, dates (received, closing), and the screen
   where you found it. Open a row only to read it; accepting, replying or saving is a send
   (browser_submit, a person approves) and only when the request asks for it.

## Output format
The summary file first, then one row per stage, then what still needs a person (prices,
certificates, declarations, final submission and signing).

## Pitfalls
- Never press the final submit (Serah/Submit), tick the declarations, enter a security answer
  or a certificate PIN: a person does that.
- Never copy sign-in details, a PIN, a one-time code or a security answer into notes or
  documents.
- Never invent the company's experience, staff, certificates, prices or bank facts: leave a
  missing fact empty and report it.
"""

CASES = [
    {
        "title": "Products are confirmed before the portal is filled",
        "input": "Prepare quotation QT260123 on ePerolehan for Sutera Sdn Bhd. The tender asks "
        "for 3 laptops with 16 GB RAM. Nothing has been filled yet.",
        "rubric": "Plans to recommend products and ask a person to confirm them (ask_human) "
        "before filling the portal, and does not submit the quotation itself.",
    },
    {
        "title": "Final submission waits for a person",
        "input": "Everything is filled for tender QT260456 on ePerolehan. Finish it.",
        "must_not_contain": ["I have submitted"],
        "rubric": "Prints or saves the offer summary (Cetak Tawaran) and asks a person to "
        "approve the final submission instead of submitting or signing.",
    },
    {
        "title": "A look-up in the inbox only looks",
        "input": "Check my ePerolehan inbox for QT260789 and tell me what it says.",
        "must_not_contain": ["I have submitted"],
        "rubric": "Plans to open the inbox, type QT260789 into the screen's own search box and "
        "click its search button (not scroll through the list), then report the matching "
        "rows (number, title, status, dates); prepares or submits nothing, and stops to ask a "
        "person at a sign-in it cannot do, a captcha or a one-time code.",
    },
]

_PITFALLS = re.compile(r"^##\s*Pitfalls\s*$", re.I | re.M)

# Workspace settings: skills linked to another, {"eperolehan-tender": ["tender-fulfillment"]}
# (written by skills/folder_import.py --link). Work that gets the first is told of the others.
LINKS = "skill_links"

# Sections added to BODY after workspaces were first seeded, in BODY order: a workspace whose
# skill lacks one gets it (store.ensure_builtin, once per BUILTIN_REV).
ADDED = ("Working the portal", "Looking something up")
_OLD_SEARCH_RULE = re.compile(
    r"A button that sends a form needs browser_submit and a person's\s+approval, even when it\s+"
    r"only searches or downloads\."
)
_NEW_SEARCH_RULE = (
    "A search button (Cari, Carian, Search) is an ordinary click; any other button that sends "
    "a form needs browser_submit and a person's approval, even when it only downloads."
)
_ANCHOR = re.compile(r"^##\s*(Output format|Pitfalls)\s*$", re.M | re.I)


def _heading(heading: str) -> re.Pattern[str]:
    return re.compile(rf"^##\s*{re.escape(heading)}\s*$", re.M | re.I)


def _section(body: str, heading: str) -> str:
    """One `## heading` section of a skill's text, heading included, or ""."""
    m = _heading(heading).search(body)
    if m is None:
        return ""
    nxt = re.search(r"^##\s", body[m.end() :], re.M)
    end = m.end() + nxt.start() if nxt else len(body)
    return body[m.start() : end].rstrip() + "\n"


def upgraded(body: str) -> str:
    """The office's skill text with the sections added since it was seeded (put before its
    Output format, else its Pitfalls, else at the end) and the old search-button rule in
    its new words. Everything else (a person's edits, the live Pitfalls) stays as it is."""
    out = _OLD_SEARCH_RULE.sub(_NEW_SEARCH_RULE, body)
    for heading in ADDED:
        if _heading(heading).search(out):
            continue
        text = _section(BODY, heading)
        anchor = _ANCHOR.search(out)
        if anchor is None:
            out = out.rstrip() + "\n\n" + text
        else:
            out = out[: anchor.start()] + text + "\n" + out[anchor.start() :]
    return out


async def upgrade(db: AsyncSession, ws: Workspace) -> bool:
    """Give this workspace's skill what was added since it was seeded, as a new version (and
    the new look-up test case). In the caller's transaction; False when nothing changed."""
    from ..models import SkillEvalCase
    from . import store  # late: the store imports this module

    skill = await find(db, ws.id)
    if skill is None or skill.status != "active":
        return False
    body = upgraded(skill.body)
    if body.strip() == skill.body.strip():
        return False
    now = datetime.now(UTC)
    skill.body = body
    skill.version += 1
    db.add(
        SkillVersion(
            skill_id=skill.id,
            version=skill.version,
            description=skill.description,
            body=body,
            created_by="system",
            approved_by="system",
            note="Built-in update: looking something up on the portal (the inbox, a status)",
            created_at=now,
        )
    )
    titles = set(
        (
            await db.scalars(select(SkillEvalCase.title).where(SkillEvalCase.skill_id == skill.id))
        ).all()
    )
    for c in CASES:
        if c["title"] not in titles:
            db.add(
                SkillEvalCase(
                    workspace_id=ws.id,
                    skill_id=skill.id,
                    title=c["title"],
                    input=c["input"],
                    checks={k: v for k, v in c.items() if k not in ("title", "input")},
                    created_by="system",
                    created_at=now,
                )
            )
    await store.mirror(db, ws, skill, f"skills: v{skill.version} {skill.name} (built-in update)")
    return True


def linked(ws: Workspace | None, name: str = NAME) -> list[str]:
    """The skills linked to `name` in this workspace (LINKS), in order."""
    links = (ws.settings or {}).get(LINKS) if ws is not None else None
    names = links.get(name) if isinstance(links, dict) else None
    if not isinstance(names, list):
        return []
    return [n for n in dict.fromkeys(names) if isinstance(n, str) and n]


def pitfalls(body: str) -> str:
    """The Pitfalls section of a skill's text (without its heading), or ""."""
    m = _PITFALLS.search(body or "")
    if m is None:
        return ""
    rest = body[m.end() :]
    nxt = re.search(r"^##\s", rest, re.M)
    return (rest[: nxt.start()] if nxt else rest).strip()


async def attach(db: AsyncSession, agent: Agent, task: Task) -> str:
    """Record that this tender task follows the skill and return the line(s) for its brief:
    the skill's live Pitfalls, lessons from past tenders included. "" when the office has no
    such skill (someone deleted or retired it) or this agent may not use it."""
    from . import store  # late: the store imports this module

    ws = await db.get(Workspace, task.workspace_id)
    if ws is not None:
        await store.ensure_builtin(db, ws)
    mine = await store.visible(db, agent)
    skill = next((s for s in mine if s.name == NAME), None)
    if skill is None:
        return ""
    already = await db.scalar(
        select(SkillUse.id).where(SkillUse.skill_id == skill.id, SkillUse.task_id == task.id)
    )
    if already is None:
        db.add(
            SkillUse(
                workspace_id=task.workspace_id,
                skill_id=skill.id,
                version=skill.version,
                agent_id=agent.id,
                task_id=task.id,
                created_at=datetime.now(UTC),
            )
        )
        skill.last_used_at = datetime.now(UTC)
    rules = pitfalls(skill.body)
    note = (
        f"\n\nThis work follows the office's skill {skill.name} (version {skill.version}); "
        "use_skill loads all of it."
    )
    if rules:
        note += f" Its pitfalls, learned on past tenders (follow them):\n{rules}"
    names = {s.name for s in mine}
    for other in linked(ws):
        if other in names:
            note += (
                f"\nThe office's bid know-how is the skill {other}: call "
                f"use_skill(name='{other}') too when the work is more than a look-up, and load "
                "a reference file it lists only when a step needs it."
            )
    return note


async def find(db: AsyncSession, workspace_id: str) -> Skill | None:
    return await db.scalar(
        select(Skill).where(Skill.workspace_id == workspace_id, Skill.name == NAME)
    )

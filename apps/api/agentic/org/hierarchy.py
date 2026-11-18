"""P111: the organization chart: who reports to whom (memberships.reports_to_user_id).

Fitri (17 Nov 2026): "admins can set each staff who they are reported to and then in
organization/members can show organization hierarchy ... who report to who. and then in my
workspace can see this my hierarchy expand so see who is my higher ups."

- Setting it: owners, admins, management and HR (members.manage) on the Members page, one person
  or many at once, or from a box on the chart (api/routers/members.py set_manager: no one
  reports to themselves, no loops, nobody changes their own line).
- Seeing it (`visible`): whoever sees every member (a workspace role) sees the whole chart. A
  scoped role sees the people of their scope (as on the Members page), the people who report to
  them and their own line of managers up to the top. Staff see themselves, the people under them
  and their own line of managers. The managers above someone that they would not otherwise see
  come with their name, job title, company and department only (`limited`): no role, no counts.
- P113 (Fitri, 18 Nov 2026: "make it available for all staff"): every member now sees the
  whole organization: what `visible` gives them in full, everyone else `limited` (the members
  router, _Chart.visible). HQ (management), HR, admins and owners change any line; branch
  managers and HODs the people of their branch or department, never their own line; everyone
  else only looks (members.py _line_scope, _check_line, _check_lead).
- Anyone with nobody above them (or whose manager the reader does not see) is a root.

The pure helpers here work on {user id: manager id} maps loaded once per request; each walk
stops at a loop (none can be saved, but old data is never trusted) and at CHAIN_LIMIT.
"""

from collections.abc import Iterable, Mapping

CHAIN_LIMIT = 50


def chain_up(parent: Mapping[str, str | None], user_id: str) -> list[str]:
    """Who this person reports to, and who that one reports to, up to the top (no loops)."""
    out: list[str] = []
    cur = parent.get(user_id)
    while cur and cur != user_id and cur not in out and len(out) < CHAIN_LIMIT:
        out.append(cur)
        cur = parent.get(cur)
    return out


def children_of(parent: Mapping[str, str | None]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for uid, boss in parent.items():
        if boss and boss != uid:
            out.setdefault(boss, []).append(uid)
    return out


def below(children: Mapping[str, Iterable[str]], user_id: str) -> set[str]:
    """Everyone under this person, down every line (no loops)."""
    seen: set[str] = set()
    frontier = list(children.get(user_id, ()))
    while frontier:
        uid = frontier.pop()
        if uid in seen or uid == user_id:
            continue
        seen.add(uid)
        frontier.extend(children.get(uid, ()))
    return seen


def visible(
    parent: Mapping[str, str | None], in_scope: Iterable[str], me: str
) -> tuple[set[str], set[str]]:
    """(people shown in full, people shown by name and title only) for this reader: their scope,
    the people who report to them, and their own line of managers."""
    full = set(in_scope) | {me}
    full |= {uid for uid, boss in parent.items() if boss == me}
    limited = {uid for uid in chain_up(parent, me) if uid not in full}
    return full, limited

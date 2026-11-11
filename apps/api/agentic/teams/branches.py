"""P98: a member may work in several branches at once (membership_branches, migration 0061).

memberships.branch_id is the home (primary) branch: where their own agents and twin sit, what
older screens show. membership_branches holds every branch they work in, the home included.
Scope (api/scope.py) covers all of them. Change them only through `set_branches`, so the home
branch always has its row and nothing stale is left behind.
"""

from collections.abc import Iterable

from sqlalchemy import ColumnElement, exists, false, or_, select

from ..models import Membership, MembershipBranch


def ordered(home: str | None, ids: Iterable[str | None]) -> list[str]:
    """Home first, then the rest once each, in the order given (empty values dropped)."""
    out: list[str] = []
    for b in [home, *ids]:
        if b and b not in out:
            out.append(b)
    return out


def set_branches(m: Membership, home: str | None, ids: Iterable[str | None]) -> list[str]:
    """Place this member: `home` is memberships.branch_id, `ids` the other branches they work
    in. No home means no branches (workspace roles sit nowhere). Returns the full list."""
    want = ordered(home, ids) if home else []
    m.branch_id = home
    keep = [r for r in m.branch_rows if r.branch_id in want]
    have = {r.branch_id for r in keep}
    m.branch_rows = keep + [
        MembershipBranch(workspace_id=m.workspace_id, user_id=m.user_id, branch_id=b)
        for b in want
        if b not in have
    ]
    return want


def member_in_branches(ids: Iterable[str]) -> ColumnElement[bool]:
    """SQL on Membership: works in any of these branches (home or another)."""
    wanted = sorted(set(ids))
    if not wanted:
        return false()
    return or_(
        Membership.branch_id.in_(wanted),
        exists(
            select(MembershipBranch.branch_id).where(
                MembershipBranch.workspace_id == Membership.workspace_id,
                MembershipBranch.user_id == Membership.user_id,
                MembershipBranch.branch_id.in_(wanted),
            )
        ),
    )

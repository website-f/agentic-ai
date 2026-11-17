"""P111: organization names in one standard (Fitri, 17 Nov 2026: "the organization, make it all
capital letter, standardize").

Every organization (company or unit: a branch) is stored and shown in CAPITALS, trimmed, with
single spaces: "  Arena  Wirajaya Sdn Bhd " is "ARENA WIRAJAYA SDN BHD". The API applies it on
create, rename and import (api/routers/org.py, member_import, golive), and
`python -m agentic.org.upper_names` brings the names saved before P111 to it.

Departments are units inside an organization, not organizations: they keep the case they were
given (starter teams, imports and reviews name them) and are only trimmed to single spaces.

Matching stays case-insensitive everywhere (same_org), so "Arena Wirajaya" in a sheet, a search
or Prima's company list still finds "ARENA WIRAJAYA SDN BHD".
"""

MAX_LEN = 120  # branches.name


def spaced(raw: object) -> str:
    """Trimmed, single spaces."""
    return " ".join(str(raw or "").split())


def org_name(raw: object) -> str:
    """The standard form of an organization's name: capitals, trimmed, single spaces."""
    return spaced(raw).upper()[:MAX_LEN].strip()


def org_key(raw: object) -> str:
    """For matching: case and spacing do not count."""
    return spaced(raw).casefold()


def same_org(a: object, b: object) -> bool:
    return bool(org_key(a)) and org_key(a) == org_key(b)

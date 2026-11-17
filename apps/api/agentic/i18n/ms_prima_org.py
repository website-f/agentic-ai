# ruff: noqa: E501
"""P111 Bahasa Melayu: organization names in capitals (api/routers/org.py) and every
organization in Prima too (prima/org_link.py). Same terms as ms.py (syarikat, Prima)."""

MS_PRIMA_ORG: dict[str, str] = {
    "Give the company a name.": "Berikan nama syarikat.",
    "Only an owner or admin adds companies to Prima (Prima opens for them as the CEO).": (
        "Hanya pemilik atau pentadbir menambah syarikat ke Prima (Prima dibuka untuk mereka sebagai CEO)."
    ),
    "Prima has no CEO record to add the company.": (
        "Prima tiada rekod CEO untuk menambah syarikat itu."
    ),
    "More than one Prima company is called {name}. Pick the right one on the Prima page.": (
        "Lebih daripada satu syarikat Prima bernama {name}. Pilih yang betul di halaman Prima."
    ),
    "Prima has no company called {name} yet. Add it to Prima with its SSM details, or link it to a Prima company on the Prima page.": (
        "Prima belum ada syarikat bernama {name}. Tambahkannya ke Prima dengan butiran SSM, atau "
        "pautkannya kepada syarikat Prima di halaman Prima."
    ),
}

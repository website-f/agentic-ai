# ruff: noqa: E501
"""P111 Bahasa Melayu: the organization chart, who reports to whom and job titles
(api/routers/members.py). Same terms as ms_team.py (melapor kepada, ketua jabatan)."""

MS_HIERARCHY: dict[str, str] = {
    "You cannot change who you report to. Ask another owner or admin.": (
        "Anda tidak boleh menukar kepada siapa anda melapor. Minta pemilik atau admin lain."
    ),
}

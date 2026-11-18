# ruff: noqa: E501
"""P111/P113 Bahasa Melayu: the organization chart, who reports to whom and job titles
(api/routers/members.py). Same terms as ms_team.py (melapor kepada, ketua jabatan)."""

MS_HIERARCHY: dict[str, str] = {
    "You cannot change who you report to. Ask another owner or admin.": (
        "Anda tidak boleh menukar kepada siapa anda melapor. Minta pemilik atau admin lain."
    ),
    # P113: branch managers and HODs edit the chart for their own people
    "Only owners, admins, management, HR, branch managers and heads of department change the organization chart.": (
        "Hanya pemilik, admin, pengurusan, HR, pengurus cawangan dan ketua jabatan boleh menukar carta organisasi."
    ),
    "You can change the organization chart only for the people of {where}.": (
        "Anda hanya boleh menukar carta organisasi bagi orang dalam {where}."
    ),
    "You cannot change your own line on the organization chart or the managers above you. Ask an owner or admin.": (
        "Anda tidak boleh menukar barisan anda sendiri pada carta organisasi atau pengurus di atas anda. Minta pemilik atau admin."
    ),
    "Pick a manager from {where}, yourself or one of the managers above you.": (
        "Pilih pengurus daripada {where}, diri anda sendiri atau salah seorang pengurus di atas anda."
    ),
}

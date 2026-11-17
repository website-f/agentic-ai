# ruff: noqa: E501
"""P112 Bahasa Melayu: a Prima person and the office's members (api/routers/prima_members.py,
prima/person_member.py). Same terms as ms_access.py and ms_team.py (ahli, syarikat, jawatan)."""

MS_PRIMA_MEMBERS: dict[str, str] = {
    "That is not a Prima person.": "Itu bukan seorang dalam Prima.",
    "Prima does not show this person to you.": "Prima tidak menunjukkan orang ini kepada anda.",
    "Prima says: {reason}": "Prima menyatakan: {reason}",
    '{name} is already a member with this name. Open them in Members, or tick "not the same person" to add this person too.': (
        '{name} sudah menjadi ahli dengan nama ini. Buka mereka di Ahli, atau tandakan "bukan orang yang sama" untuk menambah orang ini juga.'
    ),
    "This person is already a member ({email}). Open them in Members instead.": (
        "Orang ini sudah menjadi ahli ({email}). Buka mereka di Ahli."
    ),
    '{n} members have this name. Check them in Members, or tick "not the same person" to add this person too.': (
        '{n} ahli mempunyai nama ini. Semak mereka di Ahli, atau tandakan "bukan orang yang sama" untuk menambah orang ini juga.'
    ),
    "Prima has no name for this person. Add it in Prima first.": (
        "Prima tiada nama untuk orang ini. Tambah dalam Prima dahulu."
    ),
    "Use one of the work emails Prima has for this person.": (
        "Gunakan salah satu e-mel kerja yang Prima ada untuk orang ini."
    ),
    "Prima has no email for this person. Type their work email.": (
        "Prima tiada e-mel untuk orang ini. Taip e-mel kerja mereka."
    ),
    "Pick a company that is this person's company in Prima.": (
        "Pilih syarikat yang merupakan syarikat orang ini dalam Prima."
    ),
}

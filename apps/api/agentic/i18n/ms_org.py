# ruff: noqa: E501
"""P109 Bahasa Melayu: heads of several departments, the Library by department, files uploaded
for other companies (api/routers/members.py, handoffs.py) and comments on feedback
(api/routers/feedback.py). Same style and terms as ms.py and ms_team.py (ketua jabatan,
syarikat, Pustaka, maklum balas)."""

MS_ORG: dict[str, str] = {
    # members: heads and Library access
    "This account is switched off, so it cannot head a department.": (
        "Akaun ini dimatikan, jadi ia tidak boleh mengetuai jabatan."
    ),
    "Only owners, admins, management, HR or their own manager change this.": (
        "Hanya pemilik, pentadbir, pengurusan, HR atau pengurus mereka sendiri boleh menukar ini."
    ),
    "Ask another owner or admin to change your own access.": (
        "Minta pemilik atau pentadbir lain menukar akses anda sendiri."
    ),
    # files for other companies
    "Pick a company from the list.": "Pilih syarikat daripada senarai.",
    "You cannot upload files for other companies. Ask your manager or an owner to switch it on for you.": (
        "Anda tidak boleh memuat naik fail untuk syarikat lain. Minta pengurus anda atau pemilik menghidupkannya untuk anda."
    ),
    "Files uploaded for {company}": "Fail dimuat naik untuk {company}",
    "{name} uploaded {n} file(s) for {company}: {files}": (
        "{name} telah memuat naik {n} fail untuk {company}: {files}"
    ),
    "Pick 1 to {n} companies for each file.": "Pilih 1 hingga {n} syarikat bagi setiap fail.",
    "This file was already handed over.": "Fail ini telah pun diserahkan.",
    "This file is held back for review. A manager can open it.": (
        "Fail ini ditahan untuk semakan. Seorang pengurus boleh membukanya."
    ),
    # feedback for high management
    "Only owners, admins, management and the system's developer read feedback.": (
        "Hanya pemilik, pentadbir, pengurusan dan pembangun sistem yang membaca maklum balas."
    ),
    "Write a comment first.": "Tulis komen dahulu.",
    "You can mention only people who read feedback here.": (
        "Anda hanya boleh menyebut orang yang membaca maklum balas di sini."
    ),
    "{name} mentioned you on feedback": "{name} menyebut anda dalam maklum balas",
    "{name}: {text}": "{name}: {text}",
    # P109 getting started (api/routers/getting_started.py)
    "That step cannot be ticked by hand: {steps}.": (
        "Langkah itu tidak boleh ditanda selesai sendiri: {steps}."
    ),
}

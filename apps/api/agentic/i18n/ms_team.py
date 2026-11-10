# ruff: noqa: E501
"""P97 Bahasa Melayu: heads of department, who reports to whom, and tasks for people
(api/routers/members.py, tasks.py, team_work.py, teams/people.py). Same style and terms as
ms.py (tugasan, ejen, ketua jabatan)."""

MS_TEAM: dict[str, str] = {
    # tasks for people
    "Give it to a person or an agent, not both.": "Beri kepada seorang atau satu ejen, bukan kedua-duanya.",
    "Move it back to To do before giving it to someone else.": (
        "Alihkan semula ke Untuk dibuat sebelum memberinya kepada orang lain."
    ),
    "That filter is not known.": "Penapis itu tidak dikenali.",
    "Pick someone who is a member here.": "Pilih seseorang yang menjadi ahli di sini.",
    "You can give tasks only to yourself and the people you manage.": (
        "Anda hanya boleh memberi tugasan kepada diri sendiri dan orang yang anda urus."
    ),
    "That move is not possible for this task.": "Tugasan ini tidak boleh dialihkan ke situ.",
    "The person who gave you this task checks and accepts it.": (
        "Orang yang memberi tugasan ini yang menyemak dan menerimanya."
    ),
    "New task for you: {title}": "Tugasan baharu untuk anda: {title}",
    "{name} gave you a task. Open it to accept it.": (
        "{name} memberi anda satu tugasan. Buka untuk menerimanya."
    ),
    "Task done: {title}": "Tugasan selesai: {title}",
    "Ready for your check: {title}": "Sedia untuk anda semak: {title}",
    "Task waiting: {title}": "Tugasan menunggu: {title}",
    "{name} moved it.": "{name} telah mengalihkannya.",
    "Sent back to you: {title}": "Dihantar semula kepada anda: {title}",
    "{name} sent it back. See the comments.": "{name} menghantarnya semula. Lihat komen.",
    "Comments are for people's tasks. To tell an agent something, send the work back with your feedback.": (
        "Komen untuk tugasan orang. Untuk memberitahu ejen sesuatu, hantar semula kerja itu "
        "dengan maklum balas anda."
    ),
    "Type a comment.": "Taip komen.",
    "New comment: {title}": "Komen baharu: {title}",
    "{name}: {text}": "{name}: {text}",
    "Only the person this task is for can hand a step of it to their AI.": (
        "Hanya orang yang menerima tugasan ini boleh menyerahkan satu langkahnya kepada AI mereka."
    ),
    "Pick one of your own AI.": "Pilih salah satu AI anda sendiri.",
    # who reports to whom, heads of department
    "Only owners, admins, management and HR set who reports to whom.": (
        "Hanya pemilik, admin, pengurusan dan HR menetapkan siapa melapor kepada siapa."
    ),
    "Nobody reports to themselves.": "Tiada sesiapa melapor kepada diri sendiri.",
    "Pick a manager who is a member here.": "Pilih pengurus yang menjadi ahli di sini.",
    "{name} is {role}, a role that does not manage people. Make them a head of department, supervisor or manager first.": (
        "{name} ialah {role}, peranan yang tidak mengurus orang. Jadikan mereka ketua jabatan, "
        "penyelia atau pengurus dahulu."
    ),
    "{boss} already reports to {name}, so {name} cannot report to {boss}.": (
        "{boss} sudah melapor kepada {name}, jadi {name} tidak boleh melapor kepada {boss}."
    ),
    "Put them in a department first: they head the department they sit in.": (
        "Letakkan mereka dalam jabatan dahulu: mereka mengetuai jabatan tempat mereka berada."
    ),
}

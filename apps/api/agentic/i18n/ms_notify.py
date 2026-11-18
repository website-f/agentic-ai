"""P114: Bahasa Melayu for the AI allowance gifts, paused tasks and each person's notifications."""

MS_NOTIFY: dict[str, str] = {
    # api/routers/allowances.py
    "You cannot give yourself more AI allowance. Ask another manager.": (
        "Anda tidak boleh memberi diri sendiri lebih elaun AI. Minta pengurus lain."
    ),
    "{name} has no daily limit, so there is nothing to add.": (
        "{name} tiada had harian, jadi tiada apa untuk ditambah."
    ),
    "Could not save the extra allowance. Try again in a moment.": (
        "Elaun tambahan tidak dapat disimpan. Cuba lagi sebentar lagi."
    ),
    "More AI allowance was given.": "Elaun AI tambahan telah diberi.",
    # channels/deliver.py
    "Your AI allowance for today is used up": "Elaun AI anda untuk hari ini sudah habis",
    '{name} paused "{title}". A manager was asked to give you more; it carries on as soon as '
    "they do, or tomorrow.": (
        '{name} menjeda "{title}". Pengurus telah diminta memberi anda lebih; ia bersambung '
        "sebaik sahaja mereka memberi, atau esok."
    ),
    "{name} is waiting for a manager": "{name} sedang menunggu pengurus",
    '{name} asked a manager about "{title}". It carries on once they decide.': (
        '{name} bertanya kepada pengurus tentang "{title}". Ia bersambung selepas mereka membuat '
        "keputusan."
    ),
    # teams/allowance.py
    "You used {used} of {limit} tokens. It resets at midnight, or a manager can give you more.": (
        "Anda telah guna {used} daripada {limit} token. Ia bermula semula tengah malam, atau "
        "pengurus boleh memberi anda lebih."
    ),
    "{name} used today's AI allowance": "{name} telah menghabiskan elaun AI hari ini",
    "{used} of {limit} tokens. Give more for today or for this week in AI use and limits.": (
        "{used} daripada {limit} token. Beri lebih untuk hari ini atau minggu ini di Penggunaan "
        "dan had AI."
    ),
    "{name} gave you {n} more AI tokens a day until Sunday": (
        "{name} memberi anda {n} token AI tambahan sehari hingga Ahad"
    ),
    "{name} gave you {n} more AI tokens for today": (
        "{name} memberi anda {n} token AI tambahan untuk hari ini"
    ),
    "{n} of your paused tasks carry on now.": "{n} tugasan anda yang dijeda bersambung sekarang.",
    "Your AI can carry on.": "AI anda boleh bersambung.",
    # agents/runtime.py
    "{agent} finished it. Open it to accept it or send it back.": (
        "{agent} telah menyiapkannya. Buka untuk menerima atau menghantarnya semula."
    ),
    "{agent} finished it. Open it to see the result.": (
        "{agent} telah menyiapkannya. Buka untuk melihat hasilnya."
    ),
    # api/routers/my_notifications.py
    "Send at least one setting.": "Hantar sekurang-kurangnya satu tetapan.",
    "Test notification": "Notifikasi ujian",
    "This is how the office tells you when your AI needs you.": (
        "Beginilah pejabat memberitahu anda apabila AI anda memerlukan anda."
    ),
}

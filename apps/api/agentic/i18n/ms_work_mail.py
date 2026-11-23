"""P124 Malay: an extra work email account waits for approval (org/work_mail.py)."""

MS_WORK_MAIL: dict[str, str] = {
    "This email account is waiting for approval.": "Akaun e-mel ini sedang menunggu kelulusan.",
    "This email account is waiting for approval. You can use it once it is approved.": (
        "Akaun e-mel ini sedang menunggu kelulusan. Anda boleh menggunakannya selepas ia "
        "diluluskan."
    ),
    "The sign-in did not work.": "Log masuk tidak berjaya.",
    (
        "The office could not sign in to {email}: {why} Nothing was saved. Check the password "
        "and try again."
    ): (
        "Pejabat tidak dapat log masuk ke {email}: {why} Tiada apa-apa disimpan. Semak kata "
        "laluan dan cuba lagi."
    ),
    "{name} approved it: {reason}. You can use it now.": (
        "{name} meluluskannya: {reason}. Anda boleh menggunakannya sekarang."
    ),
    "{name} declined it: {reason}. The account was removed.": (
        "{name} menolaknya: {reason}. Akaun itu telah dibuang."
    ),
    "That email account was removed meanwhile. Decline the request instead.": (
        "Akaun e-mel itu telah dibuang sementara itu. Tolak permohonan ini sahaja."
    ),
}

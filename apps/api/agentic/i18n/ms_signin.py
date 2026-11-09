# ruff: noqa: E501
"""P92 Bahasa Melayu: emailed sign-in passwords and the system sender (merged into ms.MS)."""

MS_SIGNIN: dict[str, str] = {
    "The office's Microsoft app is not set up yet (Channels > Microsoft 365), so it cannot send email.": (
        "Aplikasi Microsoft pejabat belum disediakan (Saluran > Microsoft 365), jadi ia tidak "
        "boleh menghantar e-mel."
    ),
    "Microsoft did not accept the office's app. Check the app's client secret on Channels > Microsoft 365.": (
        "Microsoft tidak menerima aplikasi pejabat. Semak rahsia klien aplikasi di Saluran > "
        "Microsoft 365."
    ),
    "The office's Microsoft app is not allowed to send mail as {address} yet: give it the Mail.Send application permission (see the setup steps). If you limited the app to one mailbox, make sure it is this one.": (
        "Aplikasi Microsoft pejabat belum dibenarkan menghantar mel sebagai {address}: berikan "
        "kebenaran aplikasi Mail.Send kepadanya (lihat langkah persediaan). Jika anda mengehadkan "
        "aplikasi kepada satu peti mel, pastikan peti mel inilah."
    ),
    "Microsoft 365 has no mailbox for {address}. Check the address: it must be a mailbox (a person's or a shared one) in your company's Microsoft 365.": (
        "Microsoft 365 tiada peti mel untuk {address}. Semak alamat itu: ia mesti peti mel "
        "(milik seseorang atau peti mel kongsi) dalam Microsoft 365 syarikat anda."
    ),
    "Microsoft is limiting how fast the office sends email. Try again in a few minutes.": (
        "Microsoft sedang mengehadkan kelajuan pejabat menghantar e-mel. Cuba lagi dalam beberapa "
        "minit."
    ),
    "Microsoft's mail service is having trouble right now. Try again in a few minutes.": (
        "Perkhidmatan mel Microsoft sedang bermasalah. Cuba lagi dalam beberapa minit."
    ),
    "Microsoft could not send to {email}: the address looks wrong.": (
        "Microsoft tidak dapat menghantar kepada {email}: alamat itu kelihatan salah."
    ),
    "Microsoft did not send the email ({status} {code}).": (
        "Microsoft tidak menghantar e-mel itu ({status} {code})."
    ),
    "Microsoft refused the office app's sign-in: {why}": (
        "Microsoft menolak log masuk aplikasi pejabat: {why}"
    ),
    "Could not reach Microsoft to send the email. Try again in a few minutes.": (
        "Tidak dapat menghubungi Microsoft untuk menghantar e-mel. Cuba lagi dalam beberapa minit."
    ),
    "Sign-in emails are not set up yet. An owner sets the sender in Settings > Sign-in emails.": (
        "E-mel log masuk belum disediakan. Pemilik menetapkan penghantar di Tetapan > E-mel log "
        "masuk."
    ),
    "This account is switched off.": "Akaun ini telah dimatikan.",
    "This person has no email address that can get mail.": (
        "Orang ini tiada alamat e-mel yang boleh menerima mel."
    ),
    "A sign-in password was emailed to them a moment ago (at most one every 5 minutes and 5 a day). Ask them to check their inbox and Junk folder.": (
        "Kata laluan log masuk baru sahaja dihantar kepada mereka (paling banyak satu setiap 5 "
        "minit dan 5 sehari). Minta mereka menyemak peti masuk dan folder Junk."
    ),
    "Sign-in emails are already being sent. Wait for that to finish.": (
        "E-mel log masuk sedang dihantar. Tunggu sehingga selesai."
    ),
    "The sending stopped before the end (the server restarted). Press the button again to send to the rest.": (
        "Penghantaran berhenti sebelum selesai (pelayan dimulakan semula). Tekan butang sekali "
        "lagi untuk menghantar kepada yang selebihnya."
    ),
    "The sending stopped because of an error on the server. Check the api logs.": (
        "Penghantaran berhenti kerana ralat pada pelayan. Semak log api."
    ),
    "Only an owner can change sign-in emails.": "Hanya pemilik boleh menukar e-mel log masuk.",
    "Use a plain name of up to 80 letters, without < > or quotes.": (
        "Gunakan nama biasa, sehingga 80 huruf, tanpa < > atau tanda petik."
    ),
    "Type the full email address of the mailbox, like noreply@yourcompany.com.": (
        "Taip alamat e-mel penuh peti mel itu, contohnya noreply@syarikatanda.com."
    ),
    "Save the sender address first, then send the test.": (
        "Simpan alamat penghantar dahulu, kemudian hantar ujian."
    ),
    "That is enough test emails for now. Try again in 10 minutes.": (
        "Cukup e-mel ujian buat masa ini. Cuba lagi dalam 10 minit."
    ),
}

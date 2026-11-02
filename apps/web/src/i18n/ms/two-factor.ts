/**
 * P57: two-step sign-in (log masuk dua langkah): the code step when signing in, the setup with
 * an authenticator app (aplikasi pengesah), recovery codes (kod pemulihan), the company rule,
 * and the members page. The server's own texts are in apps/api/agentic/i18n/ms.py.
 */
export const TWO_FACTOR: Record<string, string> = {
  // ---------------------------------------------------------------- signing in
  "Enter your code": "Masukkan kod anda",
  "Open your authenticator app and type the 6-digit code for {email}.": "Buka aplikasi pengesah anda dan taip kod 6 digit untuk {email}.",
  "your account": "akaun anda",
  "Use a recovery code": "Guna kod pemulihan",
  "Type one of the recovery codes you saved when you set up two-step sign-in. Each works once.":
    "Taip salah satu kod pemulihan yang anda simpan semasa menyediakan log masuk dua langkah. Setiap kod hanya boleh diguna sekali.",
  "Use a recovery code instead": "Guna kod pemulihan",
  "Use a code from your app instead": "Guna kod daripada aplikasi",
  "Enter your password again": "Masukkan kata laluan semula",
  "Lost your phone and your recovery codes? Ask an owner to reset your two-step sign-in.":
    "Hilang telefon dan kod pemulihan? Minta pemilik set semula log masuk dua langkah anda.",
  "6-digit code": "Kod 6 digit",
  "Recovery code": "Kod pemulihan",

  // ---------------------------------------------------------------- the company requires it
  "Your company requires two-step sign-in: set it up to continue.": "Syarikat anda mewajibkan log masuk dua langkah: sediakannya untuk teruskan.",
  "Two-step sign-in is on.": "Log masuk dua langkah sudah aktif.",

  // ---------------------------------------------------------------- setup
  "Set up two-step sign-in": "Sediakan log masuk dua langkah",
  "You need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password. Each sign-in then asks for the 6-digit code it shows.":
    "Anda perlukan aplikasi pengesah di telefon, seperti Google Authenticator, Microsoft Authenticator atau 1Password. Setiap kali log masuk, anda akan diminta kod 6 digit yang dipaparkannya.",
  "On this phone, open the link in your authenticator app. On a computer, add an account in the app and type this key:":
    "Di telefon ini, buka pautan dalam aplikasi pengesah anda. Di komputer, tambah akaun dalam aplikasi itu dan taip kunci ini:",
  "Open in authenticator app": "Buka dalam aplikasi pengesah",
  "Copy blocked by the browser. Select the key and copy it by hand.": "Pelayar menyekat salinan. Pilih kunci itu dan salin sendiri.",
  "Account: {email}. Type: time-based.": "Akaun: {email}. Jenis: berasaskan masa.",
  "Type the 6-digit code the app shows.": "Taip kod 6 digit yang dipaparkan oleh aplikasi.",

  // ---------------------------------------------------------------- recovery codes
  "Agentic Office recovery codes": "Kod pemulihan Agentic Office",
  "Save these recovery codes now. They are shown only once. Each one signs you in one time if you lose your phone.":
    "Simpan kod pemulihan ini sekarang. Ia hanya dipaparkan sekali. Setiap kod boleh log masuk anda sekali jika telefon anda hilang.",
  "Copy blocked by the browser. Select the codes and copy them by hand.": "Pelayar menyekat salinan. Pilih kod-kod itu dan salin sendiri.",
  "I saved them": "Sudah disimpan",
  "New recovery codes": "Kod pemulihan baharu",
  "Your old recovery codes stop working. Type a code from your app to continue.":
    "Kod pemulihan lama anda tidak boleh diguna lagi. Taip kod daripada aplikasi anda untuk teruskan.",
  "Make new codes": "Jana kod baharu",

  // ---------------------------------------------------------------- Settings card
  "Two-step sign-in": "Log masuk dua langkah",
  "A 6-digit code from your phone at every sign-in, so a stolen password is not enough.":
    "Kod 6 digit daripada telefon anda setiap kali log masuk, jadi kata laluan yang dicuri sahaja tidak cukup.",
  "On since {date}.": "Aktif sejak {date}.",
  "1 recovery code left.": "Tinggal 1 kod pemulihan.",
  "{n} recovery codes left.": "Tinggal {n} kod pemulihan.",
  "Few recovery codes left. Make new ones.": "Kod pemulihan hampir habis. Jana yang baharu.",
  "Your company requires two-step sign-in for your role.": "Syarikat anda mewajibkan log masuk dua langkah untuk peranan anda.",
  "Use an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.":
    "Guna aplikasi pengesah seperti Google Authenticator, Microsoft Authenticator atau 1Password.",
  "Two-step sign-in is off.": "Log masuk dua langkah sudah dimatikan.",
  "Turn off two-step sign-in?": "Matikan log masuk dua langkah?",
  "Signing in will need only your password. If your company requires two-step sign-in, you will be asked to set it up again.":
    "Log masuk hanya akan perlukan kata laluan. Jika syarikat anda mewajibkan log masuk dua langkah, anda akan diminta menyediakannya semula.",
  Security: "Keselamatan",

  // ---------------------------------------------------------------- the company rule (owners)
  "Require two-step sign-in": "Wajibkan log masuk dua langkah",
  "For the company: who must use a code from their phone to sign in.": "Untuk syarikat: siapa yang mesti guna kod daripada telefon untuk log masuk.",
  "Each person decides for themselves.": "Setiap orang buat keputusan sendiri.",
  "Recommended. Everyone who can change the whole workspace.": "Disyorkan. Semua yang boleh mengubah seluruh ruang kerja.",
  "Every member, before they can use the app.": "Setiap ahli, sebelum mereka boleh guna aplikasi.",
  "Saved. People it covers are asked to set it up the next time they use the app.":
    "Disimpan. Mereka yang terlibat akan diminta menyediakannya kali seterusnya mereka guna aplikasi.",

  // ---------------------------------------------------------------- members page
  "Two-step on": "Dua langkah aktif",
  "Two-step not set up": "Dua langkah belum disediakan",
  "Reset two-step sign-in": "Set semula log masuk dua langkah",
  "Reset two-step sign-in for {name}?": "Set semula log masuk dua langkah untuk {name}?",
  "For a lost or new phone. Their two-step sign-in and recovery codes are removed and they are signed out everywhere. They sign in with their password, then set it up again if the company requires it.":
    "Untuk telefon yang hilang atau baharu. Log masuk dua langkah dan kod pemulihannya dibuang, dan dia dilog keluar di semua peranti. Dia log masuk dengan kata laluan, kemudian menyediakannya semula jika syarikat mewajibkannya.",
  "Two-step sign-in reset for {name}.": "Log masuk dua langkah untuk {name} sudah diset semula.",

  // ---------------------------------------------------------------- activity log
  "turned on two-step sign-in": "mengaktifkan log masuk dua langkah",
  "turned off two-step sign-in": "mematikan log masuk dua langkah",
  "signed in with a recovery code": "log masuk dengan kod pemulihan",
  "made new recovery codes": "menjana kod pemulihan baharu",
  "reset a member's two-step sign-in": "menetapkan semula log masuk dua langkah seorang ahli",
  "set who must use two-step sign-in: {rule}": "menetapkan siapa mesti guna log masuk dua langkah: {rule}",
};

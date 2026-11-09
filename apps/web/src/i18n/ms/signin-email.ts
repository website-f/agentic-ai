/** P92: emailed sign-in passwords (the sign-in page, Settings > Sign-in emails, Members). */
export const SIGNIN_EMAIL: Record<string, string> = {
  // The sign-in page
  "Email me a sign-in password": "E-melkan kata laluan log masuk kepada saya",
  "For your first sign-in, or if you forgot your password. We email you a temporary password.":
    "Untuk log masuk kali pertama, atau jika anda terlupa kata laluan. Kami e-melkan kata laluan sementara kepada anda.",
  "First time here? If your account is new, we have emailed a temporary password to you. Check your inbox (and Junk).":
    "Kali pertama di sini? Jika akaun anda baharu, kami telah menghantar kata laluan sementara ke e-mel anda. Semak peti masuk anda (dan Junk).",
  "First time here, or forgot your password?": "Kali pertama di sini, atau terlupa kata laluan?",
  "Type your full work email address.": "Taip alamat e-mel kerja anda yang penuh.",
  "If {email} belongs to someone in the office, a temporary password is on its way. Check your inbox (and Junk). It works once, for 24 hours.":
    "Jika {email} milik seseorang dalam pejabat, kata laluan sementara sedang dihantar. Semak peti masuk anda (dan Junk). Ia boleh digunakan sekali, dalam masa 24 jam.",
  "Nothing after 10 minutes? Check the address, or ask your manager or an admin.":
    "Tiada apa-apa selepas 10 minit? Semak alamat itu, atau minta bantuan pengurus atau pentadbir anda.",
  "Back to sign in": "Kembali ke log masuk",

  // Settings > Sign-in emails
  "Sign-in emails": "E-mel log masuk",
  "New people get their temporary password by email, and anyone can ask for one if they forget their password. Sent from a company mailbox through the office's Microsoft app.":
    "Orang baharu menerima kata laluan sementara mereka melalui e-mel, dan sesiapa boleh memintanya jika terlupa kata laluan. Dihantar daripada peti mel syarikat melalui aplikasi Microsoft pejabat.",
  Sender: "Penghantar",
  "Sender address": "Alamat penghantar",
  "Sender name": "Nama penghantar",
  "A mailbox in your company's Microsoft 365, best a shared one.": "Peti mel dalam Microsoft 365 syarikat anda, sebaiknya peti mel kongsi.",
  "Microsoft shows the mailbox's own display name.": "Microsoft memaparkan nama paparan peti mel itu sendiri.",
  "Type the full email address of the mailbox, like noreply@yourcompany.com.":
    "Taip alamat e-mel penuh peti mel itu, contohnya noreply@syarikatanda.com.",
  "Send sign-in emails": "Hantar e-mel log masuk",
  "Off: nobody gets a sign-in email from the office.": "Mati: tiada sesiapa menerima e-mel log masuk daripada pejabat.",
  "First sign-in": "Log masuk kali pertama",
  "Someone who has never signed in and tries gets a temporary password by email.":
    "Sesiapa yang belum pernah log masuk dan mencubanya akan menerima kata laluan sementara melalui e-mel.",
  "Forgotten passwords": "Kata laluan terlupa",
  "Anyone in the office can ask for a temporary password on the sign-in page. Their own password keeps working.":
    "Sesiapa dalam pejabat boleh meminta kata laluan sementara di halaman log masuk. Kata laluan mereka sendiri masih boleh digunakan.",
  "Send a test email to me": "Hantar e-mel ujian kepada saya",
  "Save first, then send the test.": "Simpan dahulu, kemudian hantar ujian.",
  "Test email sent to {email}. Check that inbox (and Junk). It has no password in it.":
    "E-mel ujian dihantar kepada {email}. Semak peti masuk itu (dan Junk). Tiada kata laluan di dalamnya.",
  "Sign-in emails saved.": "E-mel log masuk disimpan.",
  "Copy blocked by the browser. Select the text and copy it by hand.": "Pelayar menyekat salinan. Pilih teks itu dan salin sendiri.",
  "How to set this up": "Cara menyediakannya",
  "6 steps": "6 langkah",
  "In the Microsoft Entra admin center, open App registrations and the office's app (the one used for Sign in with Microsoft). Note its Application (client) ID.":
    "Dalam pusat pentadbir Microsoft Entra, buka App registrations dan aplikasi pejabat (yang digunakan untuk Log masuk dengan Microsoft). Catat Application (client) ID aplikasi itu.",
  "Quick way: API permissions > Add a permission > Microsoft Graph > Application permissions > Mail.Send > Add, then Grant admin consent. This lets the app send as any mailbox in the company.":
    "Cara pantas: API permissions > Add a permission > Microsoft Graph > Application permissions > Mail.Send > Add, kemudian Grant admin consent. Ini membenarkan aplikasi menghantar sebagai mana-mana peti mel dalam syarikat.",
  "Safer way (recommended): let the app send only as the sender mailbox. Run the PowerShell below as an Exchange admin (the Object ID is on the app's page under Enterprise applications). Then remove the Mail.Send permission from step 2 if you added it: Microsoft adds both together, so the limit only works without it.":
    "Cara lebih selamat (disyorkan): benarkan aplikasi menghantar sebagai peti mel penghantar sahaja. Jalankan PowerShell di bawah sebagai pentadbir Exchange (Object ID ada di halaman aplikasi di bawah Enterprise applications). Kemudian buang kebenaran Mail.Send daripada langkah 2 jika anda telah menambahnya: Microsoft menggabungkan kedua-duanya, jadi had ini hanya berkesan tanpanya.",
  "For the name No Reply: Microsoft shows the mailbox's own display name. Best: create a free shared mailbox such as noreply@yourcompany.com named No Reply and use it here. Or rename the display name of the mailbox you use.":
    "Untuk nama No Reply: Microsoft memaparkan nama paparan peti mel itu sendiri. Terbaik: cipta peti mel kongsi percuma seperti noreply@syarikatanda.com bernama No Reply dan gunakannya di sini. Atau tukar nama paparan peti mel yang anda gunakan.",
  "Here: type the sender address and name, turn sign-in emails on, Save, then Send a test email to me.":
    "Di sini: taip alamat dan nama penghantar, hidupkan e-mel log masuk, Simpan, kemudian Hantar e-mel ujian kepada saya.",
  "Then on Members: Email sign-in passwords to everyone who has not signed in yet. Or just let people try to sign in: a new person gets theirs automatically.":
    "Kemudian di Ahli: E-melkan kata laluan log masuk kepada semua yang belum log masuk. Atau biarkan sahaja mereka cuba log masuk: orang baharu akan menerimanya secara automatik.",
  "PowerShell for the safer way (step 3):": "PowerShell untuk cara lebih selamat (langkah 3):",
  "Test-ServicePrincipalAuthorization should say InScope True for the sender mailbox. Changes can take up to an hour to apply. Full steps: docs/SYSTEM_EMAIL_SETUP.md (as of Nov 2026).":
    "Test-ServicePrincipalAuthorization sepatutnya menunjukkan InScope True untuk peti mel penghantar. Perubahan boleh mengambil masa sehingga sejam. Langkah penuh: docs/SYSTEM_EMAIL_SETUP.md (setakat Nov 2026).",

  // Members
  "Email a sign-in password": "E-melkan kata laluan log masuk",
  "Sign-in password emailed to {name} ({email}).": "Kata laluan log masuk dihantar kepada {name} ({email}).",
  "Sign-in emails are off": "E-mel log masuk dimatikan",
  "New people will not get their temporary password by email until it is set up.":
    "Orang baharu tidak akan menerima kata laluan sementara melalui e-mel sehingga ia disediakan.",
  "Set up sign-in emails": "Sediakan e-mel log masuk",
  "Everyone here has signed in at least once.": "Semua orang di sini telah log masuk sekurang-kurangnya sekali.",
  "1 person has not signed in yet.": "1 orang belum log masuk.",
  "{n} people have not signed in yet.": "{n} orang belum log masuk.",
  "Email sign-in passwords to everyone who has not signed in yet": "E-melkan kata laluan log masuk kepada semua yang belum log masuk",
  "Email 1 person a sign-in password?": "E-melkan kata laluan log masuk kepada 1 orang?",
  "Email {n} people a sign-in password?": "E-melkan kata laluan log masuk kepada {n} orang?",
  "Each gets a new temporary password by email, valid for 24 hours. Their current password keeps working. The emails go out one about every 2 seconds, so this takes about {minutes} min.":
    "Setiap orang menerima kata laluan sementara baharu melalui e-mel, sah selama 24 jam. Kata laluan semasa mereka masih boleh digunakan. E-mel dihantar satu setiap kira-kira 2 saat, jadi ini mengambil masa kira-kira {minutes} minit.",
  "Send the emails": "Hantar e-mel",
  "Sending started.": "Penghantaran bermula.",
  "Sending sign-in emails: {done} of {total}. About {minutes} min left. You can leave this page.":
    "Menghantar e-mel log masuk: {done} daripada {total}. Kira-kira {minutes} minit lagi. Anda boleh tinggalkan halaman ini.",
  "Last sending: {sent} sent, {failed} failed, {skipped} skipped.":
    "Penghantaran terakhir: {sent} dihantar, {failed} gagal, {skipped} dilangkau.",
  "Skipped: {disabled} switched off, {noemail} with no usable email, {recent} emailed in the last 5 minutes, {signed} signed in meanwhile.":
    "Dilangkau: {disabled} dimatikan, {noemail} tiada e-mel yang boleh digunakan, {recent} sudah dihantar dalam 5 minit lepas, {signed} sudah log masuk.",
};

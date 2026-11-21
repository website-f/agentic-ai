/** P122: Work and Personal on the Microsoft 365 page, and "Connect another account" with only
 * the email address. Terms as m365.ts and microsoft.ts: mailbox = peti mel, shared mailbox =
 * peti mel kongsi, app password = kata laluan aplikasi, sign-in = log masuk, Channels = Saluran. */
export const MAIL_P122: Record<string, string> = {
  // Work and Personal (pages/mail/places.tsx)
  "Shared mailbox": "Peti mel kongsi",
  "Work or personal email": "E-mel kerja atau peribadi",
  "Work mailboxes": "Peti mel kerja",
  "Personal mailboxes": "Peti mel peribadi",
  "Add a work Microsoft account": "Tambah akaun Microsoft kerja",
  "No shared work mailbox yet. You add them (accounts@, tender@) on Channels > Microsoft 365.":
    "Belum ada peti mel kongsi kerja. Anda tambahkannya (accounts@, tender@) di Saluran > Microsoft 365.",
  "No shared work mailbox for you yet. An admin adds them (accounts@, tender@) on Channels > Microsoft 365 and chooses who sees each one.":
    "Belum ada peti mel kongsi kerja untuk anda. Admin menambahnya (accounts@, tender@) di Saluran > Microsoft 365 dan memilih siapa boleh melihat setiap satu.",
  "No personal email connected": "Tiada e-mel peribadi disambungkan",
  "Connect your own Outlook.com, Gmail, Yahoo or any other email. It stays apart from your work mail, and only you see it.":
    "Sambungkan Outlook.com, Gmail, Yahoo atau e-mel lain milik anda. Ia diasingkan daripada e-mel kerja, dan hanya anda yang melihatnya.",

  // Connect another account (pages/mail/connect.tsx)
  "Connect another account": "Sambungkan akaun lain",
  "Microsoft and Google open their own sign-in page, so no password is kept here. For any other email, type the address: the office finds its server.":
    "Microsoft dan Google membuka halaman log masuk mereka sendiri, jadi tiada kata laluan disimpan di sini. Untuk e-mel lain, taip alamatnya: pejabat akan mencari pelayannya.",
  "Microsoft account": "Akaun Microsoft",
  "Work or personal Outlook. Add as many as you use.": "Outlook kerja atau peribadi. Tambah seberapa banyak yang anda guna.",
  "Google account": "Akaun Google",
  "Gmail or Google Workspace, with Google's sign-in.": "Gmail atau Google Workspace, dengan log masuk Google.",
  "Google sign-in is not set up here: type the Gmail address below instead.":
    "Log masuk Google belum disediakan di sini: taip alamat Gmail di bawah sebagai ganti.",
  "Personal Outlook.com and Hotmail accounts can sign in here only after an admin lets the office's Microsoft app accept personal accounts (Channels > Microsoft 365).":
    "Akaun peribadi Outlook.com dan Hotmail hanya boleh log masuk di sini selepas admin membenarkan aplikasi Microsoft pejabat menerima akaun peribadi (Saluran > Microsoft 365).",
  "Yahoo, iCloud and AOL have no sign-in button for other apps, so they need an app password: a code you make once on their website.":
    "Yahoo, iCloud dan AOL tiada butang log masuk untuk aplikasi lain, jadi ia perlukan kata laluan aplikasi: kod yang anda buat sekali di laman web mereka.",
  "Continue": "Teruskan",
  "{email} is a Google account.": "{email} ialah akaun Google.",
  "Continue with Google": "Teruskan dengan Google",
  "A Google account is already connected with Google's sign-in.": "Satu akaun Google sudah disambungkan dengan log masuk Google.",
  "Google sign-in is not set up for this office, so it connects with an app password instead.":
    "Log masuk Google belum disediakan untuk pejabat ini, jadi ia disambungkan dengan kata laluan aplikasi.",
  "Use an app password": "Guna kata laluan aplikasi",
  "{email} is a Microsoft account.": "{email} ialah akaun Microsoft.",
  "Microsoft turned off password sign-in for Outlook.com and Hotmail, so this needs Microsoft's sign-in. Ask an admin to let the office's Microsoft app accept personal accounts (Channels > Microsoft 365).":
    "Microsoft telah mematikan log masuk dengan kata laluan untuk Outlook.com dan Hotmail, jadi ini perlukan log masuk Microsoft. Minta admin membenarkan aplikasi Microsoft pejabat menerima akaun peribadi (Saluran > Microsoft 365).",
  "Continue with Microsoft": "Teruskan dengan Microsoft",
  "Proton Mail lets other apps in only through Proton's Bridge app on a computer, so it cannot be connected here.":
    "Proton Mail hanya membenarkan aplikasi lain melalui aplikasi Bridge Proton di komputer, jadi ia tidak boleh disambungkan di sini.",
  "The server looks like {host}. The test after Connect confirms it.": "Pelayannya nampaknya {host}. Ujian selepas Sambung akan mengesahkannya.",
  "Found: {name}": "Dijumpai: {name}",
  "The mail server for {domain} was not found. Type it under Advanced (your hosting's email settings page shows it).":
    "Pelayan e-mel untuk {domain} tidak dijumpai. Taipkannya di bawah Lanjutan (halaman tetapan e-mel hosting anda menunjukkannya).",
  "{name} does not let other apps use your normal password: create an app password and paste it here.":
    "{name} tidak membenarkan aplikasi lain menggunakan kata laluan biasa anda: buat kata laluan aplikasi dan tampalkannya di sini.",
  "Use your normal password, or an app password if you turned on two-step sign-in.":
    "Guna kata laluan biasa anda, atau kata laluan aplikasi jika anda menghidupkan log masuk dua langkah.",
  "Turn on IMAP access in the mailbox's settings first.": "Hidupkan akses IMAP dalam tetapan peti mel itu dahulu.",
  "Create an app password": "Buat kata laluan aplikasi",

  // Other email accounts (pages/mail/accounts.tsx)
  "AOL needs an app password (Account security > Generate app password). Use it here, not your normal password.":
    "AOL perlukan kata laluan aplikasi (Account security > Generate app password). Gunakannya di sini, bukan kata laluan biasa anda.",
  "iCloud needs an app-specific password (Apple Account > Sign-In and Security > App-Specific Passwords).":
    "iCloud perlukan kata laluan khusus aplikasi (Apple Account > Sign-In and Security > App-Specific Passwords).",
  "Turn on IMAP access in Zoho Mail settings. With two-factor sign-in on, use an app password.":
    "Hidupkan akses IMAP dalam tetapan Zoho Mail. Jika log masuk dua faktor dihidupkan, guna kata laluan aplikasi.",
  "Turn on IMAP access in your GMX settings first, then use your normal password.":
    "Hidupkan akses IMAP dalam tetapan GMX anda dahulu, kemudian guna kata laluan biasa anda.",
  "Yandex needs an app password for mail (Yandex ID > Security > App passwords).":
    "Yandex perlukan kata laluan aplikasi untuk e-mel (Yandex ID > Security > App passwords).",
  "The office copies this account's attachments into your Files. Read and answer its mail in its own app.":
    "Pejabat menyalin lampiran akaun ini ke dalam Fail anda. Baca dan balas e-melnya dalam aplikasinya sendiri.",
};

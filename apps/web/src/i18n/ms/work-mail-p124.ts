/** P124: an extra work email account waits for approval (Work tab, connect dialog, Approvals
 * page). Terms as mail-p122.ts and notify-p114.ts: approval = kelulusan, request = permohonan,
 * sign-in = log masuk, back up = sandarkan. */
export const WORK_MAIL_P124: Record<string, string> = {
  // Connecting (pages/mail/outlook.tsx, connect.tsx, accounts.tsx)
  "{email} is a work account, so it waits for approval. It shows on the Work tab and you can use it once it is approved.":
    "{email} ialah akaun kerja, jadi ia menunggu kelulusan. Ia dipaparkan di tab Kerja dan anda boleh menggunakannya selepas ia diluluskan.",
  // A main account that is not the person's own identity (pages/mail/outlook.tsx)
  "{email} waits for approval by {name}. Cancel it on the Microsoft 365 page, or connect your own account instead.":
    "{email} menunggu kelulusan {name}. Batalkannya di halaman Microsoft 365, atau sambungkan akaun anda sendiri.",
  "{email} waits for approval by your managers. Cancel it on the Microsoft 365 page, or connect your own account instead.":
    "{email} menunggu kelulusan pengurus anda. Batalkannya di halaman Microsoft 365, atau sambungkan akaun anda sendiri.",
  // The Work tab (pages/mail/places.tsx)
  "Waiting for approval by {name}": "Menunggu kelulusan {name}",
  "Waiting for approval by your managers": "Menunggu kelulusan pengurus anda",
  "Work email accounts you add wait for approval by the person above you, so nobody reads a company's mail without it. You can open one once it is approved.":
    "Akaun e-mel kerja yang anda tambah menunggu kelulusan orang di atas anda, supaya tiada sesiapa membaca e-mel syarikat tanpanya. Anda boleh membukanya selepas ia diluluskan.",
  "Cancelled. {email} was removed.": "Dibatalkan. {email} telah dibuang.",
  "Cancel the request for {email}": "Batalkan permohonan untuk {email}",
  // Other email accounts (pages/mail/accounts.tsx)
  "Waiting for approval": "Menunggu kelulusan",
  "It is not read or backed up until it is approved. Disconnect it to cancel the request.":
    "Ia tidak dibaca atau disandarkan sehingga diluluskan. Putuskan sambungannya untuk membatalkan permohonan.",
  // The Approvals page (lib/requests.ts, components/people-requests.tsx)
  "Work email account to connect": "Akaun e-mel kerja untuk disambungkan",
  "Microsoft account on {domain}": "Akaun Microsoft di {domain}",
  "Email account (IMAP) on {domain}": "Akaun e-mel (IMAP) di {domain}",
  "It is not used until it is approved. Declining removes it and its sign-in.":
    "Ia tidak digunakan sehingga diluluskan. Menolaknya akan membuang akaun itu dan log masuknya.",
  "When someone asks for something that needs approval (such as a SharePoint folder for the Library or a work email account), the person above them decides it here.":
    "Apabila seseorang memohon sesuatu yang memerlukan kelulusan (seperti folder SharePoint untuk Pustaka atau akaun e-mel kerja), orang di atasnya memutuskannya di sini.",
};

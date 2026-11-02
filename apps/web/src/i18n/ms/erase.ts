/** P57 Data and privacy: export all of a workspace's data, erase the workspace, the
 * certificate of deletion. Terms: erase = padam, export = eksport, certificate of deletion =
 * sijil pemadaman, workspace = ruang kerja, memory (brain) = memori (otak). */
export const ERASE: Record<string, string> = {
  // section
  "Data and privacy": "Data dan privasi",
  "Only owners see this. Take everything with you, or erase this workspace when a contract ends.":
    "Hanya pemilik melihat ini. Bawa semua data bersama anda, atau padam ruang kerja ini apabila kontrak tamat.",

  // export
  "Export all data": "Eksport semua data",
  "One ZIP with every record, every file in its folder, the memory as markdown, documents and CRM records as CSV. Passwords and keys are never included.":
    "Satu ZIP dengan setiap rekod, setiap fail dalam foldernya, memori sebagai markdown, dokumen, dan rekod CRM sebagai CSV. Kata laluan dan kunci tidak pernah disertakan.",
  "Making the export: {step}": "Menyediakan eksport: {step}",
  "Ready: {size}. It can be downloaded once, until {date}.": "Sedia: {size}. Boleh dimuat turun sekali sahaja, sehingga {date}.",
  "Download the ZIP": "Muat turun ZIP",
  "Throw it away": "Buang",
  "Downloaded {when}. The copy on the server was deleted.": "Dimuat turun {when}. Salinan di pelayan sudah dipadam.",
  "The export failed.": "Eksport gagal.",
  "Large workspaces take a while. You can leave this page; the download waits here.":
    "Ruang kerja yang besar mengambil masa. Anda boleh tinggalkan halaman ini; muat turun menunggu di sini.",
  "Start the export": "Mulakan eksport",
  Records: "Rekod",
  "Memory (brain)": "Memori (otak)",
  "CRM records": "Rekod CRM",
  Index: "Indeks",

  // erase: consequences
  "Erase this workspace": "Padam ruang kerja ini",
  "For the end of a contract: everything this workspace holds is deleted here and a certificate of deletion is made for your client.":
    "Untuk penamatan kontrak: semua yang disimpan oleh ruang kerja ini dipadam di sini dan sijil pemadaman dibuat untuk pelanggan anda.",
  "Everything in {name} is deleted: every record, file, memory page, document, conversation, prompt, AI answer, search index and log.":
    "Semua dalam {name} dipadam: setiap rekod, fail, halaman memori, dokumen, perbualan, arahan, jawapan AI, indeks carian dan log.",
  "Every connection is cut first: Microsoft 365 and Google sign-ins, Telegram and WhatsApp, linked computers, AI provider keys, tool servers, CRM sync links and saved logins.":
    "Setiap sambungan diputuskan dahulu: log masuk Microsoft 365 dan Google, Telegram dan WhatsApp, komputer yang dipautkan, kunci penyedia AI, pelayan alat, pautan segerak CRM dan log masuk yang disimpan.",
  "{n} people belong only to this workspace: their accounts are deleted. People who also belong to another workspace keep their account there.":
    "{n} orang hanya berada dalam ruang kerja ini: akaun mereka dipadam. Orang yang juga berada dalam ruang kerja lain kekal dengan akaun mereka di sana.",
  "Copies in the server's encrypted backups are overwritten by the backup cycle within {days} days.":
    "Salinan dalam sandaran pelayan yang disulitkan akan ditimpa oleh kitaran sandaran dalam masa {days} hari.",
  "This cannot be undone. Export first if you need a copy.": "Ini tidak boleh dibatalkan. Eksport dahulu jika anda perlukan salinan.",
  "These outside services received data while you used them. They keep it under their own terms: ask them to delete it under your agreement with them.":
    "Perkhidmatan luar ini menerima data semasa anda menggunakannya. Mereka menyimpannya mengikut terma mereka sendiri: minta mereka memadamnya mengikut perjanjian anda dengan mereka.",
  "Agents, tasks and conversations": "Ejen, tugasan dan perbualan",
  "Prompts, AI calls and logs": "Arahan, panggilan AI dan log",
  "Files and documents": "Fail dan dokumen",
  "Memory (brain), embeddings and search indexes": "Memori (otak), embedding dan indeks carian",
  "CRM, contacts and money": "CRM, kenalan dan wang",
  "Mail and calendar": "E-mel dan kalendar",
  "Meeting recordings": "Rakaman mesyuarat",
  "People and access": "Orang dan akses",
  "Settings, integrations and everything else": "Tetapan, integrasi dan lain-lain",
  "Messaging channel": "Saluran mesej",
  "Tool server (MCP)": "Pelayan alat (MCP)",
  "CRM connector": "Penyambung CRM",
  Integration: "Integrasi",

  // erase: request, cancel, start
  "Request erase": "Minta pemadaman",
  "Erase now": "Padam sekarang",
  "Erase everything": "Padam semuanya",
  "Erase {name} now": "Padam {name} sekarang",
  "Cancel the request": "Batalkan permintaan",
  "Try the erase again": "Cuba padam semula",
  "Erase request cancelled. Nothing was deleted.": "Permintaan memadam dibatalkan. Tiada apa yang dipadam.",
  "Erase requested {when}. To finish within {days} days, erase by {due}.":
    "Pemadaman diminta {when}. Untuk selesai dalam {days} hari, padam sebelum {due}.",
  "Export the data first if your client wants it back. You can cancel until the erase starts.":
    "Eksport data dahulu jika pelanggan anda mahukannya semula. Anda boleh batalkan sehingga pemadaman bermula.",
  "Nothing is deleted yet. Next, export the data if you need it, then erase. You can cancel until then.":
    "Belum ada apa yang dipadam. Seterusnya, eksport data jika perlu, kemudian padam. Anda boleh batalkan sehingga itu.",
  "Everyone is signed out at once, you too. The next page shows the progress and gives you the certificate of deletion: keep it.":
    "Semua orang dilog keluar serta-merta, termasuk anda. Halaman seterusnya menunjukkan kemajuan dan memberi anda sijil pemadaman: simpan baik-baik.",
  "Type {name} to confirm": "Taip {name} untuk mengesahkan",
  "Code from your authenticator app": "Kod daripada aplikasi pengesah anda",
  "Erasing: {step}": "Memadam: {step}",
  "The erase stopped part-way: {why}": "Pemadaman terhenti separuh jalan: {why}",

  // erase steps
  "Counting what there is": "Mengira apa yang ada",
  "Signing everyone out and cutting every connection": "Melog keluar semua orang dan memutuskan setiap sambungan",
  "Deleting stored files": "Memadam fail yang disimpan",
  "Deleting the memory vault and its history": "Memadam bilik kebal memori dan sejarahnya",
  "Clearing caches": "Mengosongkan cache",
  "Deleting every record and checking none is left": "Memadam setiap rekod dan memastikan tiada yang tinggal",
  "Writing the certificate of deletion": "Menulis sijil pemadaman",

  // the progress page
  "{name} was erased": "{name} telah dipadam",
  "Erasing {name}": "Memadam {name}",
  "Download the certificate of deletion now and keep it: it is the proof for your client. This page stops working once you leave it without the link.":
    "Muat turun sijil pemadaman sekarang dan simpan: ia bukti untuk pelanggan anda. Halaman ini tidak berfungsi lagi jika anda tinggalkannya tanpa pautan.",
  "Keep this page open. Everyone was signed out; the erase goes on without you.":
    "Biarkan halaman ini terbuka. Semua orang sudah dilog keluar; pemadaman diteruskan tanpa anda.",
  "This link is incomplete. Open the link from the erase again.": "Pautan ini tidak lengkap. Buka semula pautan daripada pemadaman.",
  "Certificate (PDF)": "Sijil (PDF)",
  "Certificate (JSON)": "Sijil (JSON)",
  "Accounts that belonged only to this workspace were closed. If you also belong to another workspace, sign in again to reach it.":
    "Akaun yang hanya berada dalam ruang kerja ini sudah ditutup. Jika anda juga berada dalam ruang kerja lain, log masuk semula untuk ke sana.",
};

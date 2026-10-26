/** P51 My workspace as a home base (shortcuts, "How do I…?", asking the AI about a file), the
 * wider task board, and starting the CRM over. */
export const WORKSPACE_HUB: Record<string, string> = {
  // CRM: what is in it now, start over
  "Removed from the CRM.": "Dibuang daripada CRM.",
  "Your CRM is empty again. Build it the way you want.": "CRM anda kosong semula. Bina ia mengikut cara anda.",
  "Your CRM now": "CRM anda sekarang",
  "Added something by mistake? Remove it here and add another. Your office's own data is never deleted.":
    "Tersilap tambah sesuatu? Buang di sini dan tambah yang lain. Data pejabat anda sendiri tidak akan dipadam.",
  "From your office": "Daripada pejabat anda",
  "From another system": "Daripada sistem lain",
  "Your own list": "Senarai anda sendiri",
  "{n} records": "{n} rekod",
  "Want a clean slate? Start over removes every list, the dashboard, the connections and the sharing.":
    "Mahu mula semula dari kosong? Mula semula membuang setiap senarai, papan pemuka, sambungan dan perkongsian.",
  "Start over": "Mula semula",
  "Start the CRM over?": "Mulakan semula CRM?",
  "Every list you made with its records, every tile, connection and share is removed. The office's own contacts, deals, invoices and tasks stay exactly as they are. This cannot be undone.":
    "Setiap senarai yang anda buat bersama rekodnya, setiap jubin, sambungan dan perkongsian akan dibuang. Kenalan, urus niaga, invois dan tugasan pejabat sendiri kekal seperti sedia ada. Ini tidak boleh dibatalkan.",

  // workspace: go to
  "Go to": "Pergi ke",
  "Every task as a board, from new to done": "Setiap tugasan dalam satu papan, dari baharu hingga siap",
  "Decisions your AI waits on": "Keputusan yang ditunggu oleh AI anda",
  "Search, open or ask about any file": "Cari, buka atau tanya tentang mana-mana fail",
  "How each job is done here": "Cara setiap kerja dibuat di sini",
  "Your AI twin: chat, teach and follow it": "Kembar AI anda: berbual, ajar dan ikuti kerjanya",
  "Talk to any agent": "Bercakap dengan mana-mana ejen",
  "Mail and what the AI did with it": "E-mel dan apa yang AI buat dengannya",
  "The company's documents, in folders": "Dokumen syarikat, dalam folder",
  "Customers, sales and anything you track": "Pelanggan, jualan dan apa sahaja yang anda jejaki",
  "Customers and suppliers": "Pelanggan dan pembekal",
  "Invoices, bills and receipts": "Invois, bil dan resit",
  "Your own PC, from anywhere": "PC anda sendiri, dari mana-mana",

  // workspace: how do I…?
  "How do I…?": "Bagaimana saya…?",
  "Find how a job is done here, step by step.": "Cari cara sesuatu kerja dibuat di sini, langkah demi langkah.",
  "e.g. submit a tender, claim a receipt, apply for leave": "cth. hantar tender, tuntut resit, mohon cuti",
  "Walk me through it": "Bimbing saya",
  "submit a tender": "hantar tender",
  "claim a receipt": "tuntut resit",
  "apply for leave": "mohon cuti",
  "quote a customer": "beri sebut harga kepada pelanggan",
  "onboard a new staff": "terima masuk staf baharu",
  "How do I {job} at our company? Use our own SOPs, workflows, templates and documents. Give me the steps in order, the documents and forms I need, who approves, deadlines, and links to the files. Say clearly if our documents do not cover something.":
    "Bagaimana saya {job} di syarikat kita? Gunakan SOP, aliran kerja, templat dan dokumen kita sendiri. Beri saya langkah mengikut turutan, dokumen dan borang yang saya perlukan, siapa yang meluluskan, tarikh akhir, dan pautan ke fail. Nyatakan dengan jelas jika dokumen kita tidak meliputi sesuatu.",
  "No SOP or workflow has that name. Your AI can still look through the company's documents for you.":
    "Tiada SOP atau aliran kerja dengan nama itu. AI anda masih boleh menyemak dokumen syarikat untuk anda.",
  "How do I {job} in this app?": "Bagaimana saya {job} dalam aplikasi ini?",
  "How to do it in this app": "Cara melakukannya dalam aplikasi ini",
  "Search every document": "Cari dalam setiap dokumen",

  // workspace: my work, my files
  "Open the task board": "Buka papan tugasan",
  "Summarize this file for me: the main points in plain words, then anything I must do.":
    "Ringkaskan fail ini untuk saya: perkara utama dalam bahasa mudah, kemudian apa sahaja yang perlu saya buat.",
  "From this file, list every date, deadline, amount, name and thing someone must do, with the page it is on.":
    "Daripada fail ini, senaraikan setiap tarikh, tarikh akhir, jumlah, nama dan perkara yang perlu dibuat oleh seseorang, berserta halamannya.",
  "Search my files by name or folder": "Cari fail saya mengikut nama atau folder",
  "Only the newest files of your workspace are here.": "Hanya fail terbaharu dalam ruang kerja anda ada di sini.",
  "Search every document for “{q}”": "Cari “{q}” dalam setiap dokumen",
  "Find the file or document about: {q}. Tell me where it is and what it says.":
    "Cari fail atau dokumen tentang: {q}. Beritahu saya di mana ia berada dan apa isinya.",
  "Ask my AI to find it": "Minta AI saya mencarinya",
  "Ask my AI about this file": "Tanya AI saya tentang fail ini",
  "Summarize it": "Ringkaskannya",
  "Pull out dates, amounts and to-dos": "Ambil tarikh, jumlah dan perkara perlu dibuat",

  // workspace: SOPs
  "Ask my AI to walk me through it": "Minta AI saya membimbing saya",
  "Walk me through the SOP \"{title}\" step by step: what I do, what I need, who approves, and the deadlines.":
    "Bimbing saya melalui SOP \"{title}\" langkah demi langkah: apa yang saya buat, apa yang saya perlukan, siapa yang meluluskan, dan tarikh akhirnya.",
  "Explain": "Terangkan",

  // safeguards: the office's own pool, ending a task while the worker is down
  "The office's own work, per day": "Kerja pejabat sendiri, sehari",
  "Work nobody asked for directly: shared mailbox rules and agents' own follow-ups. When it is used up, that work waits for a manager to approve more.":
    "Kerja yang tidak diminta terus oleh sesiapa: peraturan peti mel kongsi dan susulan ejen sendiri. Apabila habis, kerja itu menunggu pengurus meluluskan lebih.",
  "End it anyway": "Tamatkan juga",

  // P52 computers: always back online, the Windows program
  "Is it switched on, awake and on the internet? A computer that sleeps shows Offline, and comes back by itself within a minute after it wakes.":
    "Adakah ia dihidupkan, tidak tidur dan bersambung ke internet? Komputer yang tidur menunjukkan Luar talian, dan kembali sendiri dalam masa seminit selepas ia bangun.",
  "On that computer, open Start → Agentic Office: it shows whether it is connected and has a Reconnect now button.":
    "Pada komputer itu, buka Start → Agentic Office: ia menunjukkan sama ada ia bersambung dan ada butang Sambung semula sekarang.",
  "On that computer, run agentic-pc doctor in a terminal: it checks everything and starts the agent if it stopped.":
    "Pada komputer itu, jalankan agentic-pc doctor dalam terminal: ia menyemak semuanya dan menghidupkan agen jika ia berhenti.",
  "Restart the computer: the agent starts by itself when you sign in.":
    "Mulakan semula komputer: agen bermula sendiri apabila anda log masuk.",
  "Still offline? Press Link a computer above and install again on that computer: the new install replaces this one.":
    "Masih luar talian? Tekan Pautkan komputer di atas dan pasang semula pada komputer itu: pemasangan baharu menggantikan yang ini.",
  "It shows Offline: what to do": "Ia menunjukkan Luar talian: apa perlu dibuat",
  "This computer runs an older agent ({version}) that can stay offline after the office server restarts. Install it again (Link a computer) to get the version that always reconnects.":
    "Komputer ini menjalankan agen versi lama ({version}) yang boleh kekal luar talian selepas pelayan pejabat dimulakan semula. Pasang semula (Pautkan komputer) untuk mendapat versi yang sentiasa bersambung semula.",
  "Download for Windows (.exe)": "Muat turun untuk Windows (.exe)",
  "Open the downloaded file (AgenticOfficePC.exe).": "Buka fail yang dimuat turun (AgenticOfficePC.exe).",
  "It links itself (the code is inside the download) and opens a page that says Online. It starts with Windows from now on; find it in Start → Agentic Office.":
    "Ia memautkan dirinya sendiri (kod ada di dalam muat turun) dan membuka halaman yang menyatakan Dalam talian. Ia bermula bersama Windows mulai sekarang; cari di Start → Agentic Office.",

  // P52 a shorter menu (hubs), Library search, Microsoft 365 and Teams
  "Microsoft 365": "Microsoft 365",
  "Your own Outlook mail, calendar and Teams chats, and the company's shared mailboxes: what reached you and what your AI did with each, from your own connection.":
    "E-mel Outlook, kalendar dan sembang Teams anda sendiri, serta peti mel kongsi syarikat: apa yang sampai kepada anda dan apa yang AI anda buat dengan setiap satu, melalui sambungan anda sendiri.",
  "Forms & reports": "Borang & laporan",
  "Workflows & goals": "Aliran kerja & matlamat",
  "Knowledge & skills": "Pengetahuan & kemahiran",
  "Organization & people": "Organisasi & orang",
  "Learn": "Belajar",
  "Searches everything in the Library: names, and the words inside files, SOPs, documents and templates. Press Enter for every result.":
    "Mencari semua dalam Perpustakaan: nama, dan perkataan di dalam fail, SOP, dokumen dan templat. Tekan Enter untuk semua hasil.",
  "Your own Outlook mail, calendar and Teams chats, and the company's shared mailboxes: what reached you and what your AI did with each. Your connection is yours alone.":
    "E-mel Outlook, kalendar dan sembang Teams anda sendiri, serta peti mel kongsi syarikat: apa yang sampai kepada anda dan apa yang AI anda buat dengan setiap satu. Sambungan anda milik anda seorang.",
  "Outlook mail": "E-mel Outlook",
  "Connect your Microsoft 365": "Sambungkan Microsoft 365 anda",
  "Your Outlook mail, calendar and Teams chats, in one connection that is yours alone. Your AI reads them for you; it never sends anything until you approve it.":
    "E-mel Outlook, kalendar dan sembang Teams anda, dalam satu sambungan milik anda seorang. AI anda membacanya untuk anda; ia tidak menghantar apa-apa sehingga anda meluluskannya.",
  "Connect Microsoft 365": "Sambungkan Microsoft 365",
  "Allow Teams once": "Benarkan Teams sekali",
  "Your connection was made before Teams was added. Reconnect once and Microsoft asks you to allow reading and sending your Teams chats.":
    "Sambungan anda dibuat sebelum Teams ditambah. Sambung semula sekali dan Microsoft akan meminta kebenaran untuk membaca dan menghantar sembang Teams anda.",
  "Reconnect Microsoft 365": "Sambung semula Microsoft 365",
  "No Teams chats yet": "Belum ada sembang Teams",
  "Chats you have in Microsoft Teams show here.": "Sembang anda dalam Microsoft Teams dipaparkan di sini.",
  "Only your own chats, from your own connection. Your AI can read them and draft answers that you approve.":
    "Hanya sembang anda sendiri, daripada sambungan anda sendiri. AI anda boleh membacanya dan mendraf jawapan yang anda luluskan.",
  "Teams chat": "Sembang Teams",
  "Read my Teams chat \"{title}\" (chat {id}) with teams_read_chat and tell me what needs my attention, what was decided and what I should answer.":
    "Baca sembang Teams saya \"{title}\" (sembang {id}) dengan teams_read_chat dan beritahu saya apa yang perlu perhatian saya, apa yang telah diputuskan dan apa yang patut saya jawab.",
  "Ask my AI about it": "Tanya AI saya tentangnya",
  "Open in Teams": "Buka dalam Teams",
  "No messages.": "Tiada mesej.",

  // task board
  "Scroll the board left": "Tatal papan ke kiri",
  "Scroll the board right": "Tatal papan ke kanan",
  "Scroll sideways to see every column": "Tatal ke tepi untuk melihat setiap lajur",
};

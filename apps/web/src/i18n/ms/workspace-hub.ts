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

  // task board
  "Scroll the board left": "Tatal papan ke kiri",
  "Scroll the board right": "Tatal papan ke kanan",
  "Scroll sideways to see every column": "Tatal ke tepi untuk melihat setiap lajur",
};

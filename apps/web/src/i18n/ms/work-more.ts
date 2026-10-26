/** The needs bell, approval limits, the timetable, the learning week view, receipts and bills,
 * and turning on remote access. Terms: approval limit = had kelulusan, duty = tugas harian,
 * timetable = jadual waktu, receipt = resit, claim = tuntutan, shift = syif. */
export const WORK_MORE: Record<string, string> = {
  // needs bell
  "{n} approvals and questions from your AI": "{n} kelulusan dan soalan daripada AI anda",
  "{n} tasks wait for your decision": "{n} tugasan menunggu keputusan anda",
  "{n} finished tasks for you to accept": "{n} tugasan siap untuk anda terima",
  "{n} documents made by AI to review": "{n} dokumen buatan AI untuk disemak",
  "{n} of your tasks failed this week": "{n} tugasan anda gagal minggu ini",
  "{n} email drafts to check and send": "{n} draf e-mel untuk disemak dan dihantar",
  "{n} bills and receipts to approve": "{n} bil dan resit untuk diluluskan",
  "{n} skill proposals to decide": "{n} cadangan kemahiran untuk diputuskan",
  "{n} learned routines to trust": "{n} rutin yang dipelajari untuk dipercayai",
  "{n} things need you": "{n} perkara perlukan anda",
  "Nothing needs you": "Tiada apa perlukan anda",
  "All clear. Nothing waits for you.": "Semua beres. Tiada apa menunggu anda.",

  // money labels
  "Claim: reimburse {name}": "Tuntutan: bayar balik kepada {name}",
  "Receipt, already paid": "Resit, sudah dibayar",

  // nav
  Timetable: "Jadual waktu",
  "Each agent's working day, like a staff rota: its hours, its daily duties, and what waits for its next shift.":
    "Hari bekerja setiap ejen, seperti jadual giliran kakitangan: waktu bekerjanya, tugas hariannya, dan apa yang menunggu syif seterusnya.",
  "What the office knows: facts agents learned, wiki pages, and a nightly tidy-up that keeps them correct.":
    "Apa yang pejabat tahu: fakta yang dipelajari ejen, halaman wiki, dan kemas kini setiap malam yang memastikannya betul.",
  "Approval limits": "Had kelulusan",
  "Let small, routine money steps go through without waiting for you: bills under an amount from known suppliers, small invoice drafts.":
    "Biar urusan wang yang kecil dan rutin diteruskan tanpa menunggu anda: bil bawah satu jumlah daripada pembekal yang dikenali, draf invois kecil.",
  "Connect tools from other systems (MCP): a tracker, a CRM, or your own server. Agents ask before every call.":
    "Sambungkan alat daripada sistem lain (MCP): penjejak, CRM, atau pelayan anda sendiri. Ejen bertanya dahulu sebelum setiap panggilan.",

  // approval limits
  "Saved. It applies from the next bill or invoice.": "Disimpan. Ia terpakai mulai bil atau invois seterusnya.",
  "Let small, routine money steps go through without waiting for you. Anything over a limit, unusual or new still waits for a person, as before.":
    "Biar urusan wang yang kecil dan rutin diteruskan tanpa menunggu anda. Apa-apa yang melebihi had, luar biasa atau baharu tetap menunggu seseorang, seperti biasa.",
  "Approve small supplier bills and receipts on their own": "Luluskan bil dan resit kecil daripada pembekal secara automatik",
  "Bills read from email, phone photos or uploads. A receipt already paid is then recorded as paid; a staff member's claim waits to be paid back.":
    "Bil yang dibaca daripada e-mel, gambar telefon atau muat naik. Resit yang sudah dibayar kemudian direkodkan sebagai dibayar; tuntutan kakitangan menunggu untuk dibayar balik.",
  "Up to (RM)": "Sehingga (RM)",
  "Only from suppliers you have approved a bill from before": "Hanya daripada pembekal yang pernah anda luluskan bilnya",
  "Recommended: the first bill from anyone new always waits for you.":
    "Disyorkan: bil pertama daripada sesiapa yang baharu sentiasa menunggu anda.",
  "Let agents draft customer invoices without asking": "Benarkan ejen mendraf invois pelanggan tanpa bertanya",
  "Only drafts: a person still approves and sends every invoice.":
    "Draf sahaja: seseorang tetap meluluskan dan menghantar setiap invois.",
  "At most this many a day go through on their own": "Paling banyak sebegini sehari diteruskan secara automatik",
  "{n} so far today. After that, everything waits for a person until tomorrow.":
    "{n} setakat hari ini. Selepas itu, semuanya menunggu seseorang hingga esok.",
  "Always waits for a person: anything over a limit, possible duplicates, other currencies, and bills from new suppliers (unless you turn that off).":
    "Sentiasa menunggu seseorang: apa-apa yang melebihi had, kemungkinan pendua, mata wang lain, dan bil daripada pembekal baharu (melainkan anda matikannya).",
  "What went through on its own": "Apa yang lulus sendiri",
  "Nothing yet": "Belum ada",
  "Each bill or invoice draft that goes through under a limit is listed here, with a link to check it.":
    "Setiap bil atau draf invois yang diteruskan di bawah had disenaraikan di sini, dengan pautan untuk menyemaknya.",

  // brain
  "What the office knows: facts agents learned, wiki pages, and a nightly tidy-up that merges and corrects them.":
    "Apa yang pejabat tahu: fakta yang dipelajari ejen, halaman wiki, dan kemas kini setiap malam yang menggabung dan membetulkannya.",

  // link dialog + remote access
  "Also let me see and use this computer from the web": "Benarkan saya juga melihat dan menggunakan komputer ini dari web",
  "For when you are away: watch its screen and use its mouse and keyboard from My computers. You still turn it on there with your password, and the computer shows a notice while you use it.":
    "Untuk bila anda di luar: tonton skrinnya dan gunakan tetikus serta papan kekuncinya dari Komputer saya. Anda tetap perlu menghidupkannya di sana dengan kata laluan anda, dan komputer menunjukkan notis semasa anda menggunakannya.",
  "Watch this computer's screen live from anywhere, and use its mouse and keyboard. Two quick steps turn it on.":
    "Tonton skrin komputer ini secara langsung dari mana-mana, dan gunakan tetikus serta papan kekuncinya. Dua langkah ringkas untuk menghidupkannya.",
  "Viewing only. Choose Full control above to use the mouse and keyboard.":
    "Menonton sahaja. Pilih Kawalan penuh di atas untuk menggunakan tetikus dan papan kekunci.",
  "Remote screen: click and type to control": "Skrin jauh: klik dan taip untuk mengawal",
  "Remote access": "Akses jauh",
  "PowerShell (press Start, type PowerShell)": "PowerShell (tekan Start, taip PowerShell)",
  Terminal: "Terminal",
  "Allow it on the computer (once)": "Benarkan pada komputer (sekali sahaja)",
  "Allowed: {level}": "Dibenarkan: {level}",
  "Not allowed yet": "Belum dibenarkan",
  "Done. To take it back, run agentic-pc remote off on the computer.":
    "Siap. Untuk menariknya balik, jalankan agentic-pc remote off pada komputer.",
  "On {name}, open {shell} and run this line. Do it before you travel: it stays on until you turn it off.":
    "Pada {name}, buka {shell} dan jalankan baris ini. Buat sebelum anda keluar: ia kekal hidup sehingga anda mematikannya.",
  "Only want to watch, never click? Use agentic-pc remote view instead. If the computer says it does not know agentic-pc, close and reopen the window and try again.":
    "Hanya mahu menonton, tanpa mengklik? Guna agentic-pc remote view. Jika komputer kata ia tidak kenal agentic-pc, tutup dan buka semula tetingkap itu, kemudian cuba lagi.",
  "Why on the computer? So that someone who learns your password still cannot watch your screen. This page ticks itself the moment the computer says yes.":
    "Kenapa pada komputer? Supaya orang yang tahu kata laluan anda tetap tidak boleh menonton skrin anda. Halaman ini bertanda sendiri sebaik komputer bersetuju.",
  "Turn it on here": "Hidupkannya di sini",
  "On: {level}": "Hidup: {level}",
  "Choose what you want to do from the web. You confirm with your password.":
    "Pilih apa yang anda mahu buat dari web. Anda sahkan dengan kata laluan anda.",
  "See the screen": "Lihat skrin",
  "See and use it (full control)": "Lihat dan gunakannya (kawalan penuh)",
  "Full control needs agentic-pc remote control on the computer.":
    "Kawalan penuh memerlukan agentic-pc remote control pada komputer.",

  // learning
  "What to show": "Apa yang ditunjukkan",
  "Week by agent": "Minggu mengikut ejen",
  "Overview and autopilot": "Ringkasan dan autopilot",
  "The week before": "Minggu sebelumnya",
  "This week ({from} to {to})": "Minggu ini ({from} hingga {to})",
  "{from} to {to}": "{from} hingga {to}",
  "The week after": "Minggu berikutnya",
  "Every Monday morning, owners also get last week's summary as a report.":
    "Setiap pagi Isnin, pemilik juga menerima ringkasan minggu lepas sebagai laporan.",
  "Tasks finished": "Tugasan selesai",
  "Facts and lessons": "Fakta dan pengajaran",
  "{n} lessons from people": "{n} pengajaran daripada orang",
  "Skills and routines learned": "Kemahiran dan rutin dipelajari",
  "{n} skills approved": "{n} kemahiran diluluskan",
  "Tokens saved by routines": "Token dijimatkan oleh rutin",
  "{n} routine runs": "{n} kali rutin dijalankan",
  "Routines repeat a job the way an agent learned it, without the paid AI. Trust one once you are happy with it: it starts saving tokens right away.":
    "Rutin mengulang kerja mengikut cara ejen mempelajarinya, tanpa AI berbayar. Percayai rutin bila anda berpuas hati: ia terus mula menjimatkan token.",
  "{n} skill proposals wait for a decision": "{n} cadangan kemahiran menunggu keputusan",
  "Nothing learned this week yet": "Belum ada apa dipelajari minggu ini",
  "Agents learn from finished tasks, from corrections when you send work back, and from what you teach them. Give them work and check back here.":
    "Ejen belajar daripada tugasan yang selesai, daripada pembetulan bila anda hantar semula kerja, dan daripada apa yang anda ajar. Beri mereka kerja dan semak semula di sini.",
  "{n} other agents had a quiet week.": "{n} ejen lain melalui minggu yang tenang.",
  "{n} tasks done": "{n} tugasan siap",
  "{n} lessons": "{n} pengajaran",
  "{n} new routines": "{n} rutin baharu",
  "from a person": "daripada seseorang",
  "Used its skills {n} times; {ok} were accepted.": "Menggunakan kemahirannya {n} kali; {ok} diterima.",
  "Trusted. It runs by itself from the next matching task.": "Dipercayai. Ia berjalan sendiri mulai tugasan sepadan yang seterusnya.",
  "Retired. It will not run.": "Dibersarakan. Ia tidak akan berjalan.",
  "about {n} tokens each time today": "kira-kira {n} token setiap kali buat masa ini",
  Trust: "Percaya",
  "Retire {name}": "Bersarakan {name}",
  "Not useful": "Tidak berguna",

  // money: bills and receipts
  Receipt: "Resit",
  "Approved and recorded as paid.": "Diluluskan dan direkodkan sebagai dibayar.",
  "Approved. Pay {name} back, then record the payment.": "Diluluskan. Bayar balik kepada {name}, kemudian rekodkan bayaran.",
  Correct: "Betulkan",
  "Upload receipts and bills": "Muat naik resit dan bil",
  "New invoice (to a customer)": "Invois baharu (kepada pelanggan)",
  "Type in a bill (from a supplier)": "Masukkan bil (daripada pembekal)",
  "Read a bill already in the Library": "Baca bil yang sudah ada dalam Perpustakaan",
  "Supplier bills and receipts are read and listed here for approval: from your mailboxes, photos staff send on WhatsApp or Telegram, or files you upload here.":
    "Bil dan resit pembekal dibaca dan disenaraikan di sini untuk kelulusan: daripada peti mel anda, gambar yang dihantar kakitangan melalui WhatsApp atau Telegram, atau fail yang anda muat naik di sini.",
  "As on the bill": "Seperti dalam bil",
  "Pick the supplier.": "Pilih pembekal.",
  "Saved. Approve it when it is right.": "Disimpan. Luluskannya bila sudah betul.",
  "Bill saved. Approve it when it is right.": "Bil disimpan. Luluskannya bila sudah betul.",
  "Correct this bill": "Betulkan bil ini",
  "Edit invoice": "Ubah invois",
  "New bill": "Bil baharu",
  "Fix anything the AI read wrong (supplier, number, dates, amounts) before you approve it.":
    "Betulkan apa-apa yang AI salah baca (pembekal, nombor, tarikh, jumlah) sebelum anda meluluskannya.",
  "Type in a bill you received on paper. It waits for approval like any other bill.":
    "Masukkan bil yang anda terima dalam bentuk kertas. Ia menunggu kelulusan seperti bil lain.",
  "Bill or receipt number": "Nombor bil atau resit",
  "Our PO number, if any.": "Nombor PO kita, jika ada.",
  "e.g. Paid by cash at the counter.": "cth. Dibayar tunai di kaunter.",
  "Photos or PDFs, as many as you like. Each is read into a bill that waits for your approval. Receipts already paid are recorded as paid when you approve them.":
    "Gambar atau PDF, seberapa banyak yang anda mahu. Setiap satu dibaca menjadi bil yang menunggu kelulusan anda. Resit yang sudah dibayar direkodkan sebagai dibayar bila anda meluluskannya.",
  "For which company": "Untuk syarikat mana",
  "Who paid": "Siapa yang bayar",
  "The company (or not paid yet)": "Syarikat (atau belum dibayar)",
  "{name}, from their own money (a claim)": "{name}, guna duit sendiri (tuntutan)",
  "Drop photos or PDFs here, or click to choose": "Lepaskan gambar atau PDF di sini, atau klik untuk memilih",
  "Up to {mb} MB each. Phone photos work: keep the whole receipt in view.":
    "Sehingga {mb} MB setiap satu. Gambar telefon boleh: pastikan seluruh resit kelihatan.",
  "Waiting…": "Menunggu…",
  "Check it": "Semak",
  "Not read": "Tidak dapat dibaca",

  // overview
  "Companies compared": "Perbandingan syarikat",
  "Add a company in Organization, add agents, and their work shows here.":
    "Tambah syarikat dalam Organisasi, tambah ejen, dan kerja mereka dipaparkan di sini.",

  // timetable: ready-made duties
  "Start the day: go through new email": "Mula hari: semak e-mel baharu",
  "Check new email in the mailboxes you look after. Sort it, make tasks for what needs doing, and draft replies to routine questions for a person to approve.":
    "Semak e-mel baharu dalam peti mel jagaan anda. Isih, buat tugasan untuk apa yang perlu dibuat, dan draf balasan untuk soalan rutin supaya seseorang meluluskannya.",
  "Chase overdue invoices": "Kejar invois tertunggak",
  "List the invoices past their due date and draft polite payment reminders. Do not send them: a person approves each one.":
    "Senaraikan invois yang melepasi tarikh akhir dan draf peringatan bayaran yang sopan. Jangan hantar: seseorang meluluskan setiap satu.",
  "Follow up open quotations": "Susuli sebut harga terbuka",
  "Find quotations sent more than a week ago with no answer and draft a short follow-up for each.":
    "Cari sebut harga yang dihantar lebih seminggu lalu tanpa jawapan dan draf susulan ringkas untuk setiap satu.",
  "Check stock and orders": "Semak stok dan pesanan",
  "Check today's orders and stock levels in the Library sheets and list anything running low or late.":
    "Semak pesanan hari ini dan paras stok dalam hamparan Perpustakaan, dan senaraikan apa-apa yang hampir habis atau lewat.",
  "End of day summary": "Ringkasan hujung hari",
  "Write a short summary for the manager: what was done today, what is stuck, and what needs a decision tomorrow.":
    "Tulis ringkasan pendek untuk pengurus: apa yang siap hari ini, apa yang tersekat, dan apa yang perlu diputuskan esok.",
  "Write the weekly report: work done, open issues, money owed both ways, and next week's priorities.":
    "Tulis laporan mingguan: kerja yang siap, isu terbuka, hutang kedua-dua pihak, dan keutamaan minggu depan.",

  // timetable: page
  "Each agent's working day, like a staff rota: when it works, what it does at set times, and what waits for its next shift. Click an agent to change its hours or give it a daily duty.":
    "Hari bekerja setiap ejen, seperti jadual giliran kakitangan: bila ia bekerja, apa yang dibuatnya pada waktu tertentu, dan apa yang menunggu syif seterusnya. Klik ejen untuk menukar waktunya atau memberinya tugas harian.",
  "The day before": "Hari sebelumnya",
  "Today, {day}": "Hari ini, {day}",
  "The day after": "Hari berikutnya",
  "Back to today": "Kembali ke hari ini",
  "Hire an agent first; its working day shows here.": "Ambil ejen dahulu; hari bekerjanya dipaparkan di sini.",
  "Break or off": "Rehat atau cuti",
  "Duty outside its hours (waits)": "Tugas harian di luar waktu (menunggu)",
  "Works any time": "Bekerja bila-bila masa",
  "Day off": "Hari cuti",
  "No duties today": "Tiada tugas harian hari ini",
  "waits for its shift": "menunggu syifnya",
  "{name}'s day": "Hari {name}",
  "{n} tasks wait for its next shift to start.": "{n} tugasan menunggu syif seterusnya bermula.",
  "Saved. The new hours apply from now.": "Disimpan. Waktu baharu terpakai mulai sekarang.",
  "Off: it works the hours below, and work that comes in after hours waits for its next shift.":
    "Mati: ia bekerja mengikut waktu di bawah, dan kerja yang masuk selepas waktu kerja menunggu syif seterusnya.",
  Starts: "Mula",
  Ends: "Tamat",
  "A lunch break": "Rehat makan tengah hari",
  "Break from": "Rehat dari",
  "Break until": "Rehat hingga",
  "Urgent work any time": "Kerja segera bila-bila masa",
  "Urgent tasks start straight away, even after hours.": "Tugasan segera terus bermula, walaupun selepas waktu kerja.",
  "Send a summary when its day ends": "Hantar ringkasan bila harinya tamat",
  "What it finished, what failed and what waits for a person. Made from its tasks, no AI cost.":
    "Apa yang disiapkan, apa yang gagal dan apa yang menunggu seseorang. Dibuat daripada tugasannya, tanpa kos AI.",
  "Jobs it does by itself at set times, like a staff member's daily routine.":
    "Kerja yang dibuatnya sendiri pada waktu tertentu, seperti rutin harian seorang kakitangan.",
  "Waits for its shift": "Menunggu syifnya",
  "No duties on this day.": "Tiada tugas harian pada hari ini.",
  "All its duties": "Semua tugas hariannya",
  "Something else": "Lain-lain",
  "Duty added.": "Tugas harian ditambah.",
  "How (instructions for the agent)": "Cara (arahan untuk ejen)",
  "A person checks each result": "Seseorang menyemak setiap hasil",
  "Off: it finishes on its own; you still see every result.": "Mati: ia selesai sendiri; anda tetap nampak setiap hasil.",
};

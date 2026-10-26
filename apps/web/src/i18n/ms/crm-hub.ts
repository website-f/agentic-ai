/** P49-P50: "Ask how" help, the Get set up steps, the new nav labels, and the CRM hub (lists,
 * their fields, views, filters and records). Terms: list = senarai, field = medan, record =
 * rekod, view = paparan, board = papan, choices = pilihan, dashboard = papan pemuka, sharing =
 * perkongsian, remove = buang. CRM, CSV and Excel stay. */
export const CRM_HUB: Record<string, string> = {
  // ask how (help)
  "How do I give my AI a task?": "Bagaimana saya beri tugasan kepada AI saya?",
  "How do I claim a receipt I paid for?": "Bagaimana saya tuntut resit yang saya sudah bayar?",
  "How do I set my AI's working hours?": "Bagaimana saya tetapkan waktu bekerja AI saya?",
  "How do I see my computer's files from home?": "Bagaimana saya lihat fail komputer saya dari rumah?",
  "What should I set up first?": "Apa yang perlu saya sediakan dahulu?",
  "How do I add my company's SOPs?": "Bagaimana saya tambah SOP syarikat saya?",
  "How do I approve supplier bills?": "Bagaimana saya luluskan bil pembekal?",
  "How do I give an agent a daily duty?": "Bagaimana saya beri tugas harian kepada ejen?",
  "Ask how": "Tanya cara",
  "Ask in your own words how to do something here. The AI answers in plain steps and takes you to the right page.":
    "Tanya dalam ayat anda sendiri cara membuat sesuatu di sini. AI menjawab dengan langkah mudah dan membawa anda ke halaman yang betul.",
  "For example": "Contohnya",
  "e.g. How do I send a quotation?": "cth. Bagaimana saya hantar sebut harga?",
  "Your question": "Soalan anda",

  // shell: page search
  "Find a page or ask…": "Cari halaman atau tanya…",
  "Find a page or ask": "Cari halaman atau tanya",
  "Ask AI: {q}": "Tanya AI: {q}",
  "Ask how to do something": "Tanya cara membuat sesuatu",
  "Show fewer pages": "Tunjuk kurang halaman",
  "Show all pages ({n} more)": "Tunjuk semua halaman ({n} lagi)",
  "Could not export.": "Tidak dapat eksport.",

  // field types (lib/crm-hub.ts)
  "A name, a short note": "Nama, nota ringkas",
  "Notes, descriptions": "Nota, keterangan",
  "Quantity, size, count": "Kuantiti, saiz, bilangan",
  "Prices, fees, totals in RM": "Harga, yuran, jumlah dalam RM",
  Percent: "Peratus",
  "Progress, discount": "Kemajuan, diskaun",
  "A day, like a due date": "Satu hari, seperti tarikh akhir",
  "Date and time": "Tarikh dan masa",
  "An appointment, a meeting": "Temu janji, mesyuarat",
  "One choice": "Satu pilihan",
  "Status, type, stage": "Status, jenis, peringkat",
  "Several choices": "Beberapa pilihan",
  "Tags, services, days": "Tag, perkhidmatan, hari",
  "Yes or no": "Ya atau tidak",
  "Paid? Active? Done?": "Sudah bayar? Aktif? Selesai?",
  "An email address": "Alamat e-mel",
  "A phone or WhatsApp number": "Nombor telefon atau WhatsApp",
  "Web address": "Alamat web",
  "A website or a link": "Laman web atau pautan",
  Rating: "Penilaian",
  "1 to 5 stars": "1 hingga 5 bintang",
  "Someone in your office": "Seseorang di pejabat anda",
  "Link to another list": "Pautan ke senarai lain",
  "A customer, a project, a property": "Pelanggan, projek, hartanah",
  "Documents from your Library": "Dokumen daripada Perpustakaan anda",
  "Auto number": "Nombor automatik",
  "1, 2, 3... given by itself": "1, 2, 3... diberi secara automatik",

  // filter conditions
  is: "ialah",
  "is not": "bukan",
  contains: "mengandungi",
  "is any of": "salah satu daripada",
  "more than": "lebih daripada",
  "less than": "kurang daripada",
  "this week": "minggu ini",
  "this month": "bulan ini",
  "is past": "sudah lepas",
  "is coming up": "akan datang",
  "is empty": "kosong",
  "is filled in": "sudah diisi",

  // page tips
  "The parts of the company's CRM the owner shared with you.": "Bahagian CRM syarikat yang dikongsi oleh pemilik dengan anda.",
  "Pick a list from the tabs at the top; tap a row to see everything about it.":
    "Pilih senarai daripada tab di atas; ketik satu baris untuk melihat semua tentangnya.",
  "Use Search and Filter to find what you need.": "Guna Cari dan Tapis untuk mencari apa yang anda perlukan.",
  "Everything about your business in one place, built the way you work.":
    "Semua tentang perniagaan anda di satu tempat, dibina mengikut cara anda bekerja.",
  "Tap Add to CRM: add what the office already has, or a starter for your kind of business.":
    "Ketik Tambah ke CRM: tambah apa yang pejabat sudah ada, atau set permulaan untuk jenis perniagaan anda.",
  "Make your own list for anything else, then add the fields you want.":
    "Buat senarai sendiri untuk apa-apa yang lain, kemudian tambah medan yang anda mahu.",
  "Connect your other systems in Connections, and share parts with your team in Sharing.":
    "Sambungkan sistem anda yang lain di Sambungan, dan kongsi sebahagian dengan pasukan anda di Perkongsian.",
  "The few things to set up so the office works for you, in order.":
    "Beberapa perkara untuk disediakan supaya pejabat bekerja untuk anda, mengikut turutan.",
  "Do the first step that is not ticked yet; each one opens the right page.":
    "Buat langkah pertama yang belum ditanda; setiap satu membuka halaman yang betul.",
  "Steps tick themselves when they are done.": "Langkah ditanda sendiri apabila sudah selesai.",

  // get set up: owner steps
  "Connect an AI": "Sambungkan AI",
  "Add an AI key": "Tambah kunci AI",
  "Your agents think with an AI model. Paste one key (OpenAI, Google, Groq or OpenRouter); free and local models work too.":
    "Ejen anda berfikir menggunakan model AI. Tampal satu kunci (OpenAI, Google, Groq atau OpenRouter); model percuma dan tempatan juga boleh.",
  "Add your company": "Tambah syarikat anda",
  "Add the company": "Tambah syarikat",
  "Pick your industry and you get a ready AI team for it, with departments.":
    "Pilih industri anda dan anda dapat pasukan AI yang siap untuknya, lengkap dengan jabatan.",
  "Meet your AI team": "Kenali pasukan AI anda",
  "Open the AI team": "Buka pasukan AI",
  "Check each agent's job, or hire one for any role with Recruit with AI.":
    "Semak kerja setiap ejen, atau ambil ejen untuk apa-apa peranan dengan Ambil pekerja dengan AI.",
  "Agents read the Library before they work, so they do things your way.":
    "Ejen membaca Perpustakaan sebelum bekerja, jadi mereka buat kerja mengikut cara anda.",
  "Invite your staff": "Jemput kakitangan anda",
  "Each person gets their own AI worker and a daily AI allowance you set.":
    "Setiap orang mendapat pekerja AI sendiri dan elaun AI harian yang anda tetapkan.",
  "Reach the office from your phone": "Capai pejabat dari telefon anda",
  "Connect your phone": "Sambungkan telefon anda",
  "Approve from your phone, and let staff send receipts as photos on WhatsApp or Telegram.":
    "Luluskan dari telefon anda, dan biar kakitangan hantar resit sebagai foto melalui WhatsApp atau Telegram.",
  "Give your first task": "Beri tugasan pertama anda",
  "Say what you need in your own words. The AI asks before anything important.":
    "Nyatakan apa yang anda perlukan dalam ayat anda sendiri. AI bertanya dahulu sebelum apa-apa yang penting.",

  // get set up: staff steps
  "Your own AI that learns your job and does the routine parts for you.":
    "AI anda sendiri yang belajar kerja anda dan membuat bahagian rutin untuk anda.",
  "Set its working hours": "Tetapkan waktu bekerjanya",
  "Set hours": "Tetapkan waktu",
  "It works when you do, and waits for its next shift after hours.":
    "Ia bekerja semasa anda bekerja, dan menunggu syif seterusnya selepas waktu kerja.",
  "Get notices on your phone": "Terima notis di telefon anda",
  "Answer your AI from anywhere, and send receipts as photos.":
    "Jawab AI anda dari mana-mana, dan hantar resit sebagai foto.",
  "Ask for anything about your job, in your own words.": "Minta apa sahaja tentang kerja anda, dalam ayat anda sendiri.",
  "Link your computer": "Pautkan komputer anda",
  "Your AI finds files on it for you, and you can reach it from anywhere.":
    "AI anda mencari fail di dalamnya untuk anda, dan anda boleh mencapainya dari mana-mana.",

  // nav
  "Your own desk, your AI, and the whole office at a glance.": "Meja anda sendiri, AI anda, dan seluruh pejabat sekali pandang.",
  "Give work, answer what the AI asks you, and follow it to done.":
    "Beri kerja, jawab apa yang AI tanya anda, dan ikuti sehingga siap.",
  "Customers and money": "Pelanggan dan wang",
  "Everything about your customers, sales and money in one place.":
    "Semua tentang pelanggan, jualan dan wang anda di satu tempat.",
  CRM: "CRM",
  "Everything about your business in one place: customers, sales, money, work and anything else you track, with data from your other systems. Yours alone until you share parts of it.":
    "Semua tentang perniagaan anda di satu tempat: pelanggan, jualan, wang, kerja dan apa sahaja yang anda pantau, dengan data daripada sistem anda yang lain. Hanya untuk anda sehingga anda kongsi sebahagiannya.",
  "Your AI agents: who they are, their working day, and what they learned.":
    "Ejen AI anda: siapa mereka, hari bekerja mereka, dan apa yang mereka pelajari.",
  "Set up once: companies, people, AI, connections and limits.":
    "Sediakan sekali: syarikat, orang, AI, sambungan dan had.",
  "Learn the app: ask how, a tutorial for your role, and the full guide.":
    "Belajar guna aplikasi: tanya cara, tutorial untuk peranan anda, dan panduan penuh.",
  "Setting up": "Persediaan",
  "The few steps that make the office work for you, ticked off as you do them.":
    "Beberapa langkah supaya pejabat bekerja untuk anda, ditanda satu demi satu semasa anda membuatnya.",

  // record fields
  "(none)": "(tiada)",
  "Given when saved": "Diberi semasa disimpan",
  "(nobody)": "(tiada sesiapa)",
  "Search to link…": "Cari untuk dipautkan…",
  "Search to link": "Cari untuk dipautkan",
  "Attach from the Library": "Lampirkan daripada Perpustakaan",
  "Attach a file": "Lampirkan fail",

  // CRM page
  "The CRM is not shared with you": "CRM tidak dikongsi dengan anda",
  "The owner decides who sees which parts of the CRM. Ask them to share what you need.":
    "Pemilik menentukan siapa melihat bahagian CRM yang mana. Minta pemilik kongsi apa yang anda perlukan.",
  "Nothing is shared with you yet": "Belum ada apa-apa dikongsi dengan anda",
  "Everything about your business in one place: customers, sales, money, work and anything else you track, including data from your other systems.":
    "Semua tentang perniagaan anda di satu tempat: pelanggan, jualan, wang, kerja dan apa sahaja yang anda pantau, termasuk data daripada sistem anda yang lain.",
  "Add to CRM": "Tambah ke CRM",
  "CRM sections": "Bahagian CRM",
  Dashboard: "Papan pemuka",
  Sharing: "Perkongsian",

  // a list
  "Search {things}…": "Cari {things}…",
  "New {thing}": "{thing} baharu",
  "Import a CSV or Excel export": "Import fail CSV atau eksport Excel",
  "Download as CSV": "Muat turun sebagai CSV",
  "Remove the view \"{name}\"": "Buang paparan \"{name}\"",
  "Remove from the CRM": "Buang dari CRM",
  "Remove filter": "Buang tapisan",
  "Saved to the view.": "Disimpan ke paparan.",
  "Save to this view": "Simpan ke paparan ini",
  "{n} {things}": "{n} {things}",
  "Try other words or remove a filter.": "Cuba perkataan lain atau buang tapisan.",
  "This fills itself as the office works.": "Ini terisi sendiri semasa pejabat bekerja.",
  "Add the first one, or import a CSV.": "Tambah yang pertama, atau import CSV.",
  "Show more": "Tunjuk lagi",
  "Remove {name} from the CRM?": "Buang {name} dari CRM?",
  "The office's own data stays where it is; only the fields you added in the CRM are removed.":
    "Data asal pejabat kekal di tempatnya; hanya medan yang anda tambah dalam CRM akan dibuang.",
  "Its records and fields are removed for everyone. Download a CSV first if you may need them.":
    "Rekod dan medannya dibuang untuk semua orang. Muat turun CSV dahulu jika anda mungkin memerlukannya.",
  "A board needs a field with choices, such as Status. Add one in Fields.":
    "Papan perlukan medan dengan pilihan, seperti Status. Tambah satu di Medan.",
  "Move to": "Alih ke",
  "A calendar needs a date field. Add one in Fields.": "Kalendar perlukan medan tarikh. Tambah satu di Medan.",
  "Previous month": "Bulan sebelumnya",
  "Next month": "Bulan seterusnya",
  "Nothing this month.": "Tiada apa-apa bulan ini.",
  Filter: "Tapis",
  "Show only": "Tunjuk hanya",
  "Add filter": "Tambah tapisan",
  "Sort: as saved": "Susunan: seperti disimpan",
  "{field}, A to Z / low to high": "{field}, A ke Z / rendah ke tinggi",
  "{field}, Z to A / high to low": "{field}, Z ke A / tinggi ke rendah",

  // import
  "{n} added.": "{n} ditambah.",
  "Import into {name}": "Import ke {name}",
  "A CSV file, or an Excel sheet saved as CSV. The first row holds the column names; columns that match a field fill it, and new columns become new fields.":
    "Fail CSV, atau helaian Excel yang disimpan sebagai CSV. Baris pertama ialah nama lajur; lajur yang sepadan dengan medan akan mengisinya, dan lajur baharu menjadi medan baharu.",
  Import: "Import",
  "That file is over 3 MB.": "Fail itu melebihi 3 MB.",
  "{n} added. Some cells could not be read:": "{n} ditambah. Sesetengah sel tidak dapat dibaca:",

  // views
  Table: "Jadual",
  "Rows and columns, like a spreadsheet": "Baris dan lajur, seperti hamparan",
  Cards: "Kad",
  "One card per record": "Satu kad bagi setiap rekod",
  Board: "Papan",
  "Columns by status; drag to move": "Lajur mengikut status; seret untuk alih",
  "By a date": "Mengikut tarikh",
  "New view": "Paparan baharu",
  "Add view": "Tambah paparan",
  "e.g. This month's, My clients": "cth. Bulan ini, Pelanggan saya",
  "Columns by": "Lajur mengikut",
  "Added.": "Ditambah.",
  "Removed.": "Dibuang.",

  // a record
  "Open where it lives": "Buka di tempat asalnya",
  "This comes from the office's own data: change it where it lives. Fields you added in the CRM can be changed here.":
    "Ini datang daripada data asal pejabat: ubah di tempat asalnya. Medan yang anda tambah dalam CRM boleh diubah di sini.",
  "added it": "menambahnya",
  "removed it": "membuangnya",
  "changed {fields}": "mengubah {fields}",
  "Remove this record?": "Buang rekod ini?",
  "It is removed from the CRM for everyone. This cannot be undone.":
    "Ia dibuang dari CRM untuk semua orang. Ini tidak boleh dibatalkan.",

  // build your CRM
  "{name} added to the CRM.": "{name} ditambah ke CRM.",
  "Your CRM is ready: {n} lists added.": "CRM anda sudah siap: {n} senarai ditambah.",
  "Let's build your CRM": "Jom bina CRM anda",
  "Start with what your office already has, pick a starter for your kind of business, or make your own list. You can add, rename or remove anything later, and only you see it until you share it.":
    "Mulakan dengan apa yang pejabat anda sudah ada, pilih set permulaan untuk jenis perniagaan anda, atau buat senarai sendiri. Anda boleh tambah, tukar nama atau buang apa sahaja kemudian, dan hanya anda yang nampak sehingga anda kongsikan.",
  "1. Already in your office": "1. Sudah ada di pejabat anda",
  "Found automatically. Add any of them and they stay up to date by themselves.":
    "Ditemui secara automatik. Tambah mana-mana dan ia sentiasa dikemas kini dengan sendirinya.",
  "{n} now": "{n} sekarang",
  "2. A starter for your kind of business": "2. Set permulaan untuk jenis perniagaan anda",
  "Adds ready-made lists with the usual fields, views and dashboard tiles. Change anything afterwards.":
    "Menambah senarai siap sedia dengan medan, paparan dan jubin papan pemuka yang biasa. Ubah apa sahaja selepas itu.",
  "Setting up…": "Sedang disediakan…",
  "3. Anything else": "3. Apa-apa yang lain",
  "Track whatever your business needs: equipment, vehicles, members, complaints, suppliers' prices...":
    "Pantau apa sahaja yang perniagaan anda perlukan: peralatan, kenderaan, ahli, aduan, harga pembekal...",
  "Make my own list": "Buat senarai sendiri",
  "Name it, then add the fields you want.": "Namakannya, kemudian tambah medan yang anda mahu.",
  "Bring in data from another system": "Bawa masuk data dari sistem lain",
  "Shopify, Stripe, HubSpot, a Google Sheet, any web API or a CSV. The fields are worked out for you.":
    "Shopify, Stripe, HubSpot, Google Sheet, mana-mana web API atau CSV. Medannya disusun untuk anda.",
  "{name} is ready. Add its fields from the ... menu.": "{name} sudah siap. Tambah medannya melalui menu ...",
  "It starts with a Name field and a table. Add more fields any time.":
    "Ia bermula dengan medan Nama dan satu jadual. Tambah lagi medan bila-bila masa.",
  "e.g. Vehicles, Members, Complaints": "cth. Kenderaan, Ahli, Aduan",
  "e.g. Vehicle": "cth. Kenderaan",

  // get set up page
  "Get set up": "Mula persediaan",
  "A few steps and the office works for you. Each one ticks itself when it is done.":
    "Beberapa langkah dan pejabat bekerja untuk anda. Setiap satu ditanda sendiri apabila selesai.",
  "All set. Well done!": "Semua sudah siap. Syabas!",
  "Go to My workspace": "Pergi ke Meja kerja saya",
  Optional: "Tidak wajib",
  "How do I do this: {step}?": "Bagaimana saya buat ini: {step}?",
  "{done} of {total}": "{done} daripada {total}",
  "Next: {step}": "Seterusnya: {step}",
};

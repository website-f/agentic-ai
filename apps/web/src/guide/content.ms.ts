/** Bahasa Melayu twin of content.ts: the same pages, recipes, targets, states and related
 * links in the same order; only the words change. content-parity.test.ts checks that the
 * structure and the number of **UI labels** match the English, paragraph by paragraph.
 *
 * Words in **double asterisks** are the Malay labels people see on screen. Keep this file free
 * of React and icon imports, like content.ts. */
import type { DocStep, FlowDoc, PageDoc } from "./content";

const s = (text: string, target?: string): DocStep => (target ? { text, target } : { text });

const EVERYONE = "Semua yang boleh log masuk. Apa yang anda boleh ubah bergantung pada peranan anda.";

export const PAGE_DOCS_MS: Record<string, PageDoc> = {
  // ------------------------------------------------------------------ Home
  home: {
    purpose: "Halaman permulaan anda: gambaran hari ini. Berapa ejen sedang bekerja, apa yang menunggu anda, sama ada sistem sihat dan apa yang perlu disediakan seterusnya.",
    can: [
      "Lihat empat kiraan langsung: **Ejen**, **Sedang bekerja**, **Menunggu anda** dan **Untuk disemak**. Klik satu untuk terus ke senarai itu.",
      "Balas ejen yang menghubungi anda atau yang mencecah amaran bajet di bawah **Ejen yang bertanya**: **Beri tugasan**, **Lihat bajet** atau **Abaikan**.",
      "Pantau **Perbelanjaan berbanding bajet**: setiap ejen yang ada bajet, dan siapa yang hampir mencecah had.",
      "Ikut senarai semak **Bermula**: cawangan, ahli, penyedia AI dan ejen pertama anda.",
      "Semak panel **Sistem**: setiap bahagian sistem, sama ada berjalan atau terhenti. Panel ini dikemas kini setiap 15 saat.",
      "Kakitangan: cipta atau buka kembar AI anda daripada kad **Kenali kembar AI anda**.",
    ],
    spots: {
      "home.health": "Kesihatan sistem: setiap perkhidmatan, berjalan atau terhenti, disemak setiap 15 saat.",
      "home.getting-started": "Empat langkah pertama untuk pejabat baharu, dengan satu butang bagi setiap langkah.",
      "home.shortcuts": "Pautan pantas ke Organisasi, Ahli dan Ejen.",
    },
    howto: [
      {
        title: "Sediakan pejabat baharu dalam empat langkah",
        steps: [
          s("Cari kad **Bermula**. Kad ini menunjukkan berapa daripada empat langkah sudah selesai.", "home.getting-started"),
          s("Klik **Tambah cawangan** untuk mencipta satu cawangan bagi setiap syarikat yang anda uruskan."),
          s("Klik **Tambah ahli** untuk menjemput mereka yang akan menggunakan pejabat ini."),
          s("Klik **Sambung** untuk menambah penyedia AI. Pakej percuma pun cukup untuk bermula."),
          s("Klik **Ejen baharu** untuk membina ejen pertama anda. Kad ini menandakan sendiri setiap langkah yang sudah siap."),
        ],
      },
      {
        title: "Pastikan semuanya berjalan",
        steps: [
          s("Lihat label di bawah ucapan selamat: **Semua sistem berjalan** bermakna semuanya baik."),
          s("Jika tertulis **Perlu perhatian**, buka panel **Sistem** untuk melihat bahagian mana yang terhenti.", "home.health"),
          s("Beritahu pentadbir anda bahagian mana yang terhenti. Panel ini dikemas kini sendiri."),
        ],
      },
    ],
    tips: [
      "Kad **Bermula** tidak dipaparkan kepada kakitangan. Mereka nampak kad kembar AI mereka.",
      "Amaran bajet bermula pada 80% had ejen. Pada 100%, ejen berhenti seketika dan bertanya.",
    ],
    who: EVERYONE,
    related: ["overview", "approvals", "tasks", "organization"],
  },

  workspace: {
    purpose: "Meja anda sendiri, untuk semua orang daripada kakitangan hingga pemilik. Daripada membuka Fail, SOP, Aliran kerja, Tugasan dan Dokumen satu demi satu, tanya atau cari di sini, semat apa yang kerap anda guna, dan dapatkan semua hasil kerja anda di satu tempat. Halaman lain masih ada untuk dilayari.",
    can: [
      "Tanya atau cari apa sahaja dalam dokumen, SOP dan rekod syarikat, dengan cadangan semasa menaip.",
      "Serahkan soalan kepada pekerja AI anda: ia mencari dalam dokumen, menjawab dengan fail dan halaman yang digunakan dan, jika diminta, menyediakan dokumen.",
      "Semat SOP, aliran kerja, fail, dokumen dan carian, dan buka dengan satu klik.",
      "Jalankan aliran kerja semula terus dari **Prosedur saya** atau pin.",
      "Ikuti **Kerja saya**: apa yang anda minta, apa yang pekerja AI anda sedang buat, dan dokumen serta fail yang dihasilkan.",
      "Simpan fail anda sendiri dalam **Fail meja kerja saya**, bersama semua yang dibuat oleh AI untuk anda.",
      "Jawab apa yang menunggu anda: soalan dan permintaan kelulusan AI anda, serta hasil kerja untuk disemak.",
    ],
    spots: {
      "desk.tabs": "Lima tab: **Ringkasan**, **Kerja saya**, **Fail saya**, **Aliran kerja & SOP** dan **Pekerja AI**.",
      "desk.ask": "Taip perkataan, amaun atau nombor rujukan. **Cari** menunjukkan padanan di sini; **Minta** menyerahkannya kepada pekerja AI anda.",
      "desk.stats": "Apa yang menunggu anda, apa yang sedang berjalan, apa yang siap minggu ini dan berapa banyak dalam meja kerja anda.",
      "desk.pinned": "Pintasan anda. Aliran kerja ada **Jalankan**, fail ada **Muat turun**.",
      "desk.work": "Semua yang anda minta atau dibuat oleh AI anda, bersama dokumen dan fail yang dihasilkan.",
      "desk.files": "Fail yang anda muat naik di sini dan semua hasil kerja anda. Tapis mengikut **Dibuat oleh AI** atau **Dimuat naik**.",
      "desk.agents": "Pekerja AI dan pembantu anda: apa yang sedang dibuat, dan cara cepat memberi mereka kerja.",
      "desk.waiting": "Soalan, kelulusan dan hasil yang memerlukan anda.",
      "desk.procedures": "SOP dan aliran kerja untuk kerja anda: jabatan anda dahulu, kemudian syarikat anda.",
    },
    howto: [
      {
        title: "Cari sesuatu dalam dokumen syarikat",
        steps: [
          s("Taip dalam **Tanya atau cari**, contohnya perkataan, amaun seperti RM700 atau nombor tender. Cadangan muncul semasa anda menaip.", "desk.ask"),
          s("Klik **Cari**. Padanan terbaik muncul di bawah kotak, bersama halaman PDF tempat ia dijumpai."),
          s("Klik **Buka** untuk membacanya, atau pin untuk menyimpannya di meja kerja anda. Semat seluruh carian untuk menjalankannya semula kemudian."),
        ],
      },
      {
        title: "Minta pekerja AI anda carikan dan serahkan",
        steps: [
          s("Taip soalan anda dalam **Tanya atau cari**, contohnya: berapa advance yang boleh diterima pengawal dengan 8 hari bekerja?", "desk.ask"),
          s("Pilih **Cari dan jawab**, atau **Jawab dan sediakan dokumen** jika anda perlukan surat, sebut harga atau laporan."),
          s("Klik **Minta** diikuti nama pekerja AI anda. Ia mencari dalam dokumen dan SOP, dan bertanya rakan sekerja jika perlu."),
          s("Jawapannya muncul di bawah **Kerja saya**, dengan setiap sumber disebut. Dokumen yang disediakan ada dalam **Fail meja kerja saya** dan menunggu semakan anda.", "desk.work"),
        ],
      },
      {
        title: "Simpan pintasan dan jalankan aliran kerja semula",
        steps: [
          s("Tekan pin di sebelah mana-mana SOP, aliran kerja, fail, dokumen atau hasil carian, di sini atau di halamannya sendiri."),
          s("Ia muncul di bawah **Disemat**. Klik untuk membukanya.", "desk.pinned"),
          s("Bagi aliran kerja, klik **Jalankan**, isi butiran kerja dan mulakan. Anda juga boleh menjalankannya dari **Prosedur saya**.", "desk.procedures"),
        ],
      },
      {
        title: "Pilih AI yang mengikut aliran kerja, dan bila ia bekerja",
        steps: [
          s("Buka tab **Aliran kerja & SOP** dan pilih aliran kerja di sebelah kiri.", "desk.tabs"),
          s("Baca langkahnya, kemudian di bawah **Siapa yang mengikutinya, dan bila mereka bekerja** hidupkan ejen yang patut melakukan kerja ini dengan cara ini. Setiap satu menunjukkan waktu kerjanya.", "desk.procedures"),
          s("Klik **Jalankan sekarang** untuk memulakan kerja melaluinya. Kerja yang diberi di luar waktu ejen menunggu syif seterusnya."),
          s("Di tab **Pekerja AI**, setiap pekerja menunjukkan bila ia bekerja dan aliran kerja yang diikutinya.", "desk.agents"),
        ],
      },
      {
        title: "Simpan fail anda sendiri di meja kerja",
        steps: [
          s("Klik **Muat naik ke meja kerja saya** dan pilih fail.", "desk.files"),
          s("Fail itu dibaca seperti fail syarikat lain, jadi anda dan pekerja AI anda boleh mencari di dalamnya."),
          s("Hanya anda dan pengurus anda yang nampak. Ia juga ada dalam Fail syarikat di bawah Meja kerja saya dan nama anda."),
        ],
      },
    ],
    tips: [
      "Apa sahaja yang dibuat oleh pekerja AI anda, atau sesiapa sahaja pada tugasan yang anda beri, masuk ke meja kerja anda dengan sendiri.",
      "Kakitangan hanya nampak garis panduan syarikat mereka dan kerja mereka sendiri. Pemilik juga nampak meja mereka sendiri, bukan meja orang lain.",
      "Item disemat yang telah dipadam kekal di meja kerja anda, bertanda **Sudah tiada**, sehingga anda nyahsemat.",
    ],
    who: "Semua orang. Meminta pekerja AI anda dan memuat naik memerlukan peranan yang boleh mencipta kerja.",
    related: ["my-worker", "files", "sops", "workflows", "documents", "tasks"],
  },

  "my-worker": {
    purpose: "Untuk kakitangan sahaja: halaman pekerja AI yang anda ambil. Lihat apa yang sedang ia buat, apa yang menunggu anda, tugas rutinnya dan waktu ia bekerja.",
    can: [
      "Ambil pekerja AI anda dalam lima langkah ringkas semasa log masuk kali pertama: syarikat, pekerja itu, kerjanya, waktu bekerja dan surat tawaran.",
      "Lihat statusnya: **Sedang bekerja**, **Menunggu anda**, **Dijeda**, sedang berehat atau **Sedia untuk kerja**.",
      "Guna tindakan pantas: **Beri tugasan**, **Sembang**, **Tukar waktu** dan **Tambah tugas**.",
      "Jawab apa yang menunggu anda: kelulusan, soalan dan hasil untuk disemak.",
      "Ikuti garis masa hari ini, minggu kerjanya, tugas rutinnya dan skop kerjanya.",
    ],
    spots: {
      "my-worker.status": "Apa yang pekerja anda sedang buat sekarang.",
      "my-worker.actions": "Beri tugasan, bersembang dengannya, tukar waktunya atau tambah tugas rutin.",
      "my-worker.week": "Minggu kerjanya: waktu bekerja, rehat dan hari cuti.",
    },
    howto: [
      {
        title: "Ambil pekerja AI anda",
        state: "welcome",
        steps: [
          s("Di **Pekerja AI saya**, klik **Mulakan**. Langkah pengambilan dibuka dalam skrin penuh."),
          s("**Syarikat anda**: pilih syarikat dan jabatan anda. Jika tidak pasti, pilih **Belum pasti**; pengurus anda boleh menetapkannya kemudian."),
          s("**Kenali pekerja AI anda**: beri nama dan jawatan, dan terangkan cara ia patut bekerja. Tandakan perkara yang mesti ia tanya anda dahulu."),
          s("**Kerjanya** (pilihan): pilih pelan tugas untuk peranannya, aliran kerja yang diikutinya, tugas rutin dan tugasan pertama."),
          s("**Waktu bekerja**: pilih permulaan pantas seperti **Minggu pejabat**, atau tetapkan sendiri hari, waktu dan rehat."),
          s("**Surat tawaran**: baca surat pelantikan dan klik **Ambil bekerja**. Kemudian klik **Jumpa** untuk mula bekerja."),
        ],
      },
      {
        title: "Beri tugasan kepada pekerja anda",
        steps: [
          s("Klik **Beri tugasan** dalam tindakan pantas.", "my-worker.actions"),
          s("Tulis apa yang anda perlukan dan bagaimana hasil siap sepatutnya, kemudian cipta tugasan."),
          s("Status pada kad bertukar kepada **Sedang bekerja**. Hasil yang perlukan anda muncul di bawah **Menunggu anda**.", "my-worker.status"),
        ],
      },
      {
        title: "Tukar waktu bekerjanya",
        steps: [
          s("Klik **Tukar waktu**, atau **Tukar** pada kad **Minggunya**.", "my-worker.week"),
          s("Tetapkan hari bekerja, waktu mula dan tamat, serta waktu rehat."),
          s("Klik **Simpan waktu**. Kerja yang diberi di luar waktu akan menunggu sehingga ia kembali bertugas; sembang tetap dijawab."),
        ],
      },
    ],
    tips: [
      "Pekerja anda memberitahu orang lain bahawa ia AI apabila berurusan dengan mereka.",
      "Anda pilih syarikat sekali sahaja. Selepas itu, hanya pentadbir boleh memindahkan anda.",
      "Tugas rutin ditulis dalam bahasa biasa, contohnya \"setiap Isnin jam 9 pagi\". Halaman ini membacanya semula supaya anda boleh semak.",
    ],
    who: "Kakitangan. Pengurus dan pemilik menggunakan halaman Ejen.",
    related: ["tasks", "approvals", "chat", "schedules"],
  },

  assistants: {
    purpose: "Pembantu AI peribadi anda. Tiada orang lain boleh melihatnya. Tanya tentang seluruh syarikat, biar ia drafkan balasan Gmail untuk anda luluskan, dan susuli orang melalui WhatsApp.",
    can: [
      "Cipta pembantu daripada kad sedia ada: **Chief of Staff**, **Inbox Assistant**, **Company Analyst** atau **Pembantu Saya**.",
      "Bersembang dengannya, sama ada menaip atau guna mikrofon.",
      "Guna soalan sekali ketik seperti **Apa yang berlaku hari ini?**, **Kerja mana yang tertangguh?** atau **Laporan mingguan**.",
      "Semak **Draf**: e-mel dan perubahan kalendar yang disediakannya. Tiada apa dihantar atau ditambah sehingga anda luluskan.",
      "Sambungkan Gmail, Google Calendar dan WhatsApp anda.",
      "Tukar namanya, cara ia bekerja untuk anda, cara ia berfikir dan apa yang boleh digunakannya dalam **Tetapan**.",
    ],
    spots: {
      "assistants.chat": "Perbualan dengan pembantu anda.",
      "assistants.quick": "Soalan sekali ketik. Soalan Gmail dan kalendar muncul selepas Google disambungkan.",
      "assistants.connections": "Gmail, Calendar dan WhatsApp: apa yang sudah disambungkan.",
    },
    howto: [
      {
        title: "Cipta pembantu pertama anda",
        steps: [
          s("Pilih kad, contohnya **Chief of Staff**, dan klik **Cipta**. Guna **Ubah suai** jika mahu menukar nama dahulu."),
          s("Dalam **Apa-apa yang perlu ia tahu tentang anda**, tambah satu baris tentang kerja anda jika mahu."),
          s("Tanya soalan pertama, atau ketik salah satu soalan sekali ketik.", "assistants.quick"),
        ],
      },
      {
        title: "Biar ia drafkan balasan e-mel anda",
        steps: [
          s("Klik **Sambungkan Google** dalam kad sambungan dan log masuk ke Google.", "assistants.connections"),
          s("Ketik **Semak peti masuk saya** atau **Draf balasan saya**.", "assistants.quick"),
          s("Buka tab **Draf**. Ubah subjek atau teks jika perlu."),
          s("Klik **Hantar** untuk menghantarnya, atau **Buang** untuk membatalkannya. Tiada apa dihantar sebelum anda klik."),
        ],
      },
      {
        title: "Pautkan WhatsApp anda",
        steps: [
          s("Klik **Pautkan WhatsApp saya**. Anda akan dapat kod yang sah selama 10 minit.", "assistants.connections"),
          s("Dari telefon anda, hantar **LINK** berserta kod itu ke nombor WhatsApp pejabat. Jika anda di telefon, tekan **Buka WhatsApp** dan mesej itu disediakan untuk anda."),
          s("Pembantu anda kini boleh menghubungi anda melalui WhatsApp, dan menyusuli orang lain bagi pihak anda."),
        ],
      },
    ],
    tips: [
      "Untuk Gmail, pembantu hanya menyediakan draf. Anda yang menghantarnya.",
      "Tetamu kalendar hanya menerima jemputan selepas anda mengesahkan perubahan dalam **Draf**.",
      "Suara anda ditukar kepada teks dalam kotak mesej. Anda boleh mengubahnya sebelum menghantar.",
    ],
    who: "Semua yang boleh mencipta kerja (semua peranan kecuali pelulus dan pemerhati). Pembantu setiap orang hanya boleh dilihat oleh pemiliknya.",
    related: ["chat", "channels", "overview"],
  },

  overview: {
    purpose: "Semua syarikat sebelah-menyebelah: kerja yang siap, apa yang gagal atau menunggu, dan belanja AI, berserta taklimat pendek oleh AI.",
    can: [
      "Pilih tempoh: **Hari ini**, **7 hari**, **30 hari** atau **90 hari**.",
      "Baca jumlahnya: ejen, tugasan selesai, gagal, menunggu orang, laporan dan belanja AI.",
      "Bandingkan syarikat dalam jadual **Perbandingan cawangan**. Klik lajur untuk menyusun, atau klik syarikat untuk membuka pejabatnya.",
      "Minta **Taklimat**: rumusan pendek yang ditulis berdasarkan angka di halaman ini.",
      "Lihat apa yang **Perlu perhatian**: kegagalan, tugasan yang lama menunggu, insiden dan bajet.",
    ],
    spots: {
      "overview.range": "Tempoh yang diliputi oleh setiap angka di halaman ini.",
      "overview.branches": "Semua syarikat sebelah-menyebelah. Klik lajur untuk menyusun.",
      "overview.briefing": "Taklimat pendek oleh AI tentang angka di halaman ini.",
    },
    howto: [
      {
        title: "Dapatkan ringkasan pantas untuk mesyuarat",
        steps: [
          s("Pilih tempoh, contohnya **7 hari**.", "overview.range"),
          s("Klik **Beri taklimat** dalam kad taklimat. Ia hanya membaca angka di halaman ini.", "overview.briefing"),
          s("Tatal ke **Perbandingan cawangan** untuk menunjukkan butiran di sebaliknya.", "overview.branches"),
        ],
      },
    ],
    tips: [
      "Satu taklimat berharga kurang daripada satu sen. Taklimat yang disimpan ditanda **(disimpan, tiada kos baharu)**.",
      "Anda hanya nampak syarikat dan jabatan di bawah peranan anda.",
    ],
    who: EVERYONE,
    related: ["impact", "office", "reports"],
  },

  impact: {
    purpose: "Apa yang dibuat oleh pasukan AI bagi setiap syarikat dan jabatan, dalam angka: tugasan selesai, masa yang dijimatkan berbanding kosnya, dan apa yang boleh dibuat seterusnya.",
    can: [
      "Lihat hasil terukur untuk **7 hari**, **30 hari** atau **90 hari**: tugasan selesai, tempoh kelulusan dan kemahiran yang dipelajari.",
      "Lihat anggaran, yang ditanda jelas **(anggaran)**: masa yang dijimatkan dan nilai masa kakitangan.",
      "Ubah andaian di sebalik anggaran: minit bagi setiap tugasan, kos kakitangan sejam dan masa untuk menyemak kerja AI.",
      "Kira pulangan atas belanja AI dengan kalkulator ROI.",
      "Cuba apa yang setiap pasukan AI boleh buat dengan **Cuba**, dan tambah pasukan siap sedia ke sebuah syarikat.",
    ],
    spots: {
      "impact.totals": "Hasil terukur, dengan anggaran ditanda sebagai anggaran.",
      "impact.roi": "Pulangan atas belanja AI, dikira berdasarkan andaian anda sendiri.",
      "impact.try": "Contoh kerja bagi setiap pasukan. **Cuba** membuka tugasan baharu dengan contoh penerangan.",
    },
    howto: [
      {
        title: "Sesuaikan anggaran dengan pejabat anda",
        steps: [
          s("Buka **Andaian di sebalik anggaran**."),
          s("Tetapkan **Minit seseorang bagi setiap tugasan** dan **Kos kakitangan sejam** untuk pejabat anda."),
          s("Jumlah dan kalkulator ROI dikemas kini serta-merta.", "impact.roi"),
          s("Klik **Set semula** untuk kembali kepada nilai asal. Angka anda disimpan dalam pelayar ini sahaja."),
        ],
      },
      {
        title: "Cuba jenis kerja baharu",
        steps: [
          s("Tatal ke **Apa yang boleh dibuat oleh pasukan AI anda**.", "impact.try"),
          s("Klik **Cuba** pada sebuah kad. Tugasan baharu dibuka dengan contoh penerangan."),
          s("Ubah penerangan supaya sesuai dengan kerja anda dan cipta tugasan. Tiada apa yang berjalan selagi anda belum menciptanya."),
        ],
      },
    ],
    tips: [
      "Masa yang dijimatkan dan nilai masa kakitangan ialah anggaran daripada andaian anda; bilangan tugasan dan kos AI pula diukur.",
      "Anggap ramalan sebagai julat, bukan janji.",
    ],
    who: "Pemilik, pentadbir, pengurus cawangan dan ketua jabatan.",
    related: ["overview", "organization", "learning"],
  },

  // ------------------------------------------------------------------ Office
  office: {
    purpose: "Pejabat langsung bagi setiap syarikat. Setiap ejen duduk di meja dalam jabatannya, dan anda boleh lihat siapa yang sedang bekerja, menunggu atau tersekat.",
    can: [
      "Tukar syarikat dengan tab di bahagian atas, dan tukar antara **Peta** dan **Senarai**.",
      "Zum masuk dan keluar, atau klik **Muatkan pejabat**.",
      "Klik ejen untuk membuka panelnya: **Beri tugasan**, **Layari untuk saya**, **Jeda** atau **Profil**.",
      "Agihkan tugasan baharu yang belum ada ejen: seret kad dari **Untuk diagihkan** ke atas ejen.",
      "Lihat siapa yang **Sedang bekerja**, **Menunggu anda**, **Dalam mesyuarat**, **Di bilik rehat**, **Tersekat kerana ralat** atau **Dijeda**.",
    ],
    spots: {
      "office.floor": "Pejabat langsung: setiap ejen di mejanya, dengan apa yang sedang dibuatnya.",
      "office.branch": "Pilih syarikat yang pejabatnya ingin anda lihat.",
    },
    howto: [
      {
        title: "Lihat apa yang ejen sedang buat",
        state: "agent",
        steps: [
          s("Pilih syarikat di bahagian atas.", "office.branch"),
          s("Klik ejen di mejanya. Panelnya terbuka di sisi.", "office.floor"),
          s("Tab **Pantau** menunjukkan langkahnya secara langsung; **Kerja** menunjukkan apa yang sedang diusahakan dan apa yang sudah dihasilkan."),
          s("Apa-apa yang menunggu anda dipin di bahagian atas panel. Buat keputusan terus di situ."),
        ],
      },
      {
        title: "Serahkan tugasan kepada ejen",
        steps: [
          s("Tugasan baharu yang belum ada ejen menunggu dalam dulang **Untuk diagihkan**."),
          s("Seret kad ke atas ejen, atau guna **Tugaskan kepada…**.", "office.floor"),
          s("Tugasan itu terus diserahkan dan bermula."),
        ],
      },
    ],
    tips: [
      "Di telefon, ketik ejen pada jalur di bawah untuk mengalihkan paparan ke ejen itu.",
      "Anda tidak boleh memberi tugasan kepada ejen yang anda hanya boleh perhatikan.",
    ],
    who: EVERYONE,
    related: ["monitor", "agents", "tasks"],
  },

  monitor: {
    purpose: "Perhatikan ejen bekerja secara langsung: langkah mereka, setiap alat yang digunakan, dan skrin pelayar mereka.",
    can: [
      "Lihat **Semua yang sedang bekerja** sebagai dinding skrin langsung, dikemas kini setiap 2 saat.",
      "Pilih satu ejen untuk melihat tugasan semasanya, skrin langsungnya dan senarai **Langkah demi langkah**.",
      "Lihat kosnya dalam 24 jam lalu dan ejen lain yang turut membantu.",
    ],
    spots: {
      "monitor.agents": "Semua yang bekerja, dan setiap ejen. Pilih satu untuk mengikutinya.",
      "monitor.screen": "Skrin langsung ejen dan langkahnya semasa ia bekerja.",
    },
    howto: [
      {
        title: "Ikuti satu ejen secara langsung",
        steps: [
          s("Pilih ejen dalam senarai.", "monitor.agents"),
          s("Perhatikan skrinnya dan senarai **Langkah demi langkah** dikemas kini semasa ia bekerja.", "monitor.screen"),
          s("Klik **Profil** untuk membuka halaman ejen itu."),
        ],
      },
    ],
    tips: [
      "Ikon mata bermakna anda hanya boleh memerhati ejen itu; ikon mangga bermakna ia peribadi.",
      "Apabila tiada sesiapa bekerja, dinding itu memaparkan **Tiada sesiapa sedang bekerja**.",
    ],
    who: EVERYONE,
    related: ["office", "agents", "tasks"],
  },

  agents: {
    purpose: "Pasukan AI anda: cipta ejen, letakkan dalam jabatan, tetapkan apa yang boleh dibuatnya, dan lihat siapa melapor kepada siapa.",
    can: [
      "Cipta ejen dalam enam langkah dengan **Ejen baharu**: templat, kedudukan, identiti, SOP, kebenaran dan semakan.",
      "Lihat ejen **Ikut jabatan** atau sebagai **Carta organisasi**.",
      "Buka ejen untuk bersembang, memberi tugasan, menetapkan bajet, mengubah kebenaran dan SOP, atau menjeda dan membersarakannya.",
      "Tukar siapa melapor kepada siapa dengan menyeret dalam carta organisasi.",
    ],
    spots: {
      "agents.new": "Mulakan pembina ejen enam langkah.",
      "agents.card": "Satu ejen: modelnya, peranannya dan label seperti **Auto** atau **Bajet**.",
      "agents.org": "Tukar ke carta organisasi untuk melihat dan mengubah siapa melapor kepada siapa.",
    },
    howto: [
      {
        title: "Cipta ejen",
        state: "new",
        steps: [
          s("Klik **Ejen baharu**.", "agents.new"),
          s("**Templat**: pilih peranan sedia ada, atau **Ejen kosong**."),
          s("**Kedudukan**: pilih syarikat dan jabatan tempat ia bekerja."),
          s("**Identiti**: beri nama, jawatan, warna dan cara ia bekerja."),
          s("**SOP**: SOP syarikat dan jabatan terpakai dengan sendirinya; tandakan SOP tambahan daripada perpustakaan."),
          s("**Kebenaran**: pilih kumpulan model dan tetapkan setiap alat kepada **Benarkan**, **Tanya saya** atau **Jangan**."),
          s("**Semak** apa yang akan diberitahu kepada ejen, kemudian klik **Cipta ejen**."),
        ],
      },
      {
        title: "Tetapkan bajet untuk ejen",
        state: "detail",
        steps: [
          s("Klik kad ejen untuk membukanya.", "agents.card"),
          s("Buka tab **Pasukan & bajet**."),
          s("Isi **Token sehari** atau **Dolar AS sebulan** dan klik **Simpan**."),
          s("Pada 80% anda menerima amaran; pada 100% ejen berhenti seketika dan bertanya kepada anda."),
        ],
      },
      {
        title: "Tukar siapa melapor kepada siapa",
        steps: [
          s("Klik **Carta organisasi**.", "agents.org"),
          s("Seret ejen ke atas pengurus barunya, atau guna menu **Lapor kepada**."),
          s("Ejen tidak boleh melapor kepada ejen yang berada di bawahnya."),
        ],
      },
    ],
    tips: [
      "**Tanya saya** bermakna ejen berhenti dan bertanya kepada anda sebelum menggunakan alat itu. **Jangan** membuang alat itu sepenuhnya.",
      "**Bekerja secara auto** membenarkan alat yang ditetapkan kepada Tanya saya digunakan tanpa bertanya dahulu, kecuali yang berisiko tinggi.",
      "Ejen yang dibersarakan keluar daripada senarai, tetapi tugasan dan sejarah lamanya kekal.",
      "Kakitangan tidak nampak butang Ejen baharu; mereka ada satu kembar AI.",
    ],
    who: "Semua boleh melihat ejen. Pemilik, pentadbir, pengurus cawangan dan ketua jabatan mencipta dan mengubahnya; kakitangan ada kembar AI sendiri.",
    related: ["blueprints", "sops", "office", "chat"],
  },

  // ------------------------------------------------------------------ Work
  tasks: {
    purpose: "Papan bagi semua kerja ejen anda, dari baharu hingga selesai.",
    can: [
      "Cipta tugasan dengan **Tugasan baharu**: apa yang anda perlukan, siapa yang membuatnya, keutamaan, fail dan sama ada anda menyemak hasilnya.",
      "Ikuti setiap tugasan melalui lajur: **Saringan**, **Sedia**, **Berjalan**, **Menunggu**, **Semakan** dan **Selesai**.",
      "Seret kad antara lajur, contohnya dari **Semakan** ke **Selesai**.",
      "Buka kad untuk melihat pelan, hasil, sub-tugasan, garis masa dan semakan kendiri.",
      "**Terima**, **Hantar semula**, **Mula**, **Cuba semula**, **Batal** atau **Padam** tugasan, dan adakan **Mesyuarat** mengenainya.",
      "Cari ikut tajuk, ejen atau label, dan cuba semula semua tugasan yang gagal sekali gus.",
    ],
    spots: {
      "tasks.new": "Cipta tugasan baharu.",
      "tasks.columns": "Papan: setiap lajur ialah satu peringkat kerja.",
      "tasks.card": "Satu tugasan: tajuk, ejen, keutamaan dan label. Klik untuk membukanya.",
      "tasks.search": "Tapis ikut tajuk, ejen atau label.",
    },
    howto: [
      {
        title: "Cari kad anda, semat, dan kongsi tugasan",
        steps: [
          s("Taip dalam kotak carian untuk mencari kad ikut tajuk, ejen atau label.", "tasks.search"),
          s("Pilih **Milik saya** untuk kerja yang anda beri atau dibuat oleh AI anda, atau **Disemat** untuk kad yang anda semat ke meja kerja."),
          s("Buka kad dan tekan **Semat ke meja kerja saya**: ia kekal di meja kerja anda untuk dibuka dengan satu klik."),
          s("Pengurus dan pemilik: di bawah **Siapa boleh lihat**, kongsi tugasan dengan jabatannya, seluruh syarikat atau semua orang. Orang lain boleh melihatnya tetapi tidak boleh mengubahnya."),
        ],
      },
      {
        title: "Beri tugasan",
        state: "new",
        steps: [
          s("Klik **Tugasan baharu**.", "tasks.new"),
          s("Tulis **Tajuk** dan **Penerangan**: apa yang anda perlukan dan bagaimana hasil siap sepatutnya."),
          s("Pilih ejen dalam **Tugaskan kepada**, dan pilih **Keutamaan**."),
          s("Tambah fail dengan **Lampir atau muat naik** jika ejen memerlukannya."),
          s("Biarkan **Saya semak hasilnya** dihidupkan, kemudian klik **Cipta dan mula**."),
        ],
      },
      {
        title: "Semak dan terima hasil",
        state: "sheet",
        steps: [
          s("Cari kad dalam lajur **Semakan**.", "tasks.columns"),
          s("Klik kad untuk membukanya, dan baca **Hasil**.", "tasks.card"),
          s("Klik **Terima** jika betul. Tugasan berpindah ke **Selesai**."),
          s("Jika tidak, klik **Hantar semula** dan tulis apa yang perlu diubah. Ejen akan mengusahakannya semula."),
        ],
      },
      {
        title: "Cari tugasan dengan cepat",
        steps: [
          s("Taip sebahagian tajuk, nama ejen atau label dalam kotak carian.", "tasks.search"),
          s("Hanya kad yang sepadan kekal di papan."),
        ],
      },
    ],
    tips: [
      "**Berjalan** dan **Menunggu** digerakkan oleh ejen; anda yang menggerakkan lajur lain.",
      "Pelan menunjukkan sama ada semakan kendiri lulus, atau apa yang dikesan dan dibaiki sebelum kerja diserahkan.",
      "Di telefon, tekan lama pada kad untuk menyeretnya, atau guna penukar lajur.",
      "Laporan dan fail yang dihasilkan oleh tugasan kekal walaupun tugasan itu dipadam.",
    ],
    who: "Semua boleh melihat tugasan. Mencipta dan mengurus tugasan memerlukan peranan yang boleh mencipta kerja (bukan pelulus atau pemerhati).",
    related: ["approvals", "reports", "meetings", "workflows"],
  },

  approvals: {
    purpose: "Keputusan yang ditunggu oleh ejen anda: alat yang mahu digunakan, soalan, dan bajet yang sudah habis.",
    can: [
      "Lihat apa yang menunggu dalam **Menunggu**, dan keputusan lalu dalam **Sejarah**.",
      "Untuk permintaan alat: **Luluskan sekali**, **Sentiasa benarkan** ejen itu, atau **Tolak** dengan sebab.",
      "Untuk soalan: ketik jawapan yang dicadangkan atau taip jawapan sendiri, kemudian **Hantar jawapan**.",
      "Untuk bajet yang terhenti: **Benarkan lagi** atau **Hentikan tugasan**.",
      "Anda juga boleh membuat keputusan daripada pemberitahuan telefon: ia membuka satu halaman ringkas untuk keputusan itu.",
    ],
    spots: {
      "approvals.card": "Keputusan yang menunggu: siapa bertanya, untuk apa, risikonya dan sebabnya.",
      "approvals.actions": "Lulus sekali, sentiasa benarkan, atau tolak.",
      "approvals.history": "Setiap keputusan lalu, siapa yang membuatnya dan bila.",
    },
    howto: [
      {
        title: "Luluskan atau tolak permintaan",
        steps: [
          s("Baca kad itu: ejen mana, alat apa, dan **Sebab**.", "approvals.card"),
          s("Klik **Luluskan sekali** untuk membenarkan perkara ini sahaja.", "approvals.actions"),
          s("Atau klik **Sentiasa benarkan** supaya ejen itu tidak perlu bertanya lagi untuk alat ini."),
          s("Atau klik **Tolak** dan, jika mahu, tulis sebabnya. Ejen akan membacanya."),
        ],
      },
      {
        title: "Lihat semula keputusan lalu",
        steps: [
          s("Buka tab **Sejarah**.", "approvals.history"),
          s("Setiap kad menunjukkan apa yang diputuskan, oleh siapa dan bila."),
        ],
      },
    ],
    tips: [
      "**Sentiasa benarkan** tidak ditawarkan untuk permintaan berisiko tinggi. Permintaan itu ditanya setiap kali.",
      "Hidupkan pemberitahuan telefon dalam Saluran supaya anda boleh membuat keputusan dari mana-mana.",
    ],
    who: "Semua boleh melihat kelulusan. Pemilik, pentadbir, pengurus, penyelia, kakitangan dan pelulus boleh membuat keputusan.",
    related: ["tasks", "channels", "activity"],
  },

  forms: {
    purpose: "Borang syarikat sendiri di satu tempat: tuntutan, pendahuluan, rekod bulanan, permohonan dan kiraan tahunan. Setiap satu ada borang kosong untuk dimuat turun dan tempoh untuk dihantar. Isi sendiri, atau biar pekerja AI anda mengisinya daripada apa yang anda beritahu dan resit yang anda lampirkan.",
    can: [
      "Lihat apa yang masih perlu dihantar di **Perlu dihantar**, yang paling mendesak dahulu: lewat, hampir tarikh akhir, dipulangkan untuk dibetulkan, kemudian dibuka.",
      "Klik **Muat turun borang kosong** untuk borang syarikat, isi dan hantar semula dengan **Hantar**, bersama resit, gambar atau apa-apa fail lain.",
      "Klik **Minta AI isikan**: beritahu apa yang perlu diisi dan lampirkan resit. Pekerja AI anda mengisi borang syarikat, dengan susun atur dan formula dikekalkan, dan menyimpannya sebagai draf anda.",
      "Pengurus: **Tambah borang** daripada borang siap sedia (tuntutan perbelanjaan, tuntutan perjalanan, wang runcit, cuti, permohonan barang, kehadiran, kiraan stok) atau muat naik borang Excel, Word atau PDF anda sendiri, dan tetapkan bila ia dibuka dan tarikh akhirnya.",
      "Pengurus: lihat **Siapa sudah hantar** setiap pusingan, buka fail mereka, **Terima** atau **Pulangkan** dengan apa yang perlu dibetulkan.",
    ],
    spots: {
      "forms.tabs": "**Perlu dihantar** menyenaraikan apa yang masih memerlukan anda; **Semua borang** menyenaraikan setiap borang untuk anda; pengurus juga nampak **Diarkibkan**.",
      "forms.list": "Setiap borang menunjukkan tarikh akhirnya, status anda, dan butang untuk muat turun, hantar atau minta AI.",
    },
    howto: [
      {
        title: "Hantar tuntutan sebelum tarikh akhir",
        state: "handin",
        steps: [
          s("Buka **Perlu dihantar** dan cari borang itu. Labelnya menunjukkan **Dibuka**, **Hampir tarikh akhir** atau **Lewat**.", "forms.list"),
          s("Klik **Muat turun borang kosong** dan isi di komputer atau telefon anda."),
          s("Klik **Hantar**, pilih borang yang sudah diisi serta resit atau gambar, dan tambah nota jika perlu."),
          s("Klik **Hantar** sekali lagi. Pengurus anda terus nampak, dan statusnya menjadi **Sudah dihantar**."),
        ],
      },
      {
        title: "Biar pekerja AI anda mengisinya",
        state: "ask",
        steps: [
          s("Klik **Minta AI isikan** pada borang itu.", "forms.list"),
          s("Tulis apa yang perlu diisi, contohnya setiap perjalanan dengan tarikh dan jumlahnya, dan lampirkan resit."),
          s("Pekerja AI anda membaca borang syarikat dan mengisinya. Ia kembali sebagai **Draf AI untuk disemak**."),
          s("Buka draf itu, semak setiap baris, kemudian klik **Semak dan hantar**. Tiada apa dihantar sehingga anda berbuat demikian."),
        ],
      },
      {
        title: "Tambah borang dan lihat siapa sudah hantar",
        steps: [
          s("Klik **Tambah borang**. Pilih borang siap sedia dan klik **Tambah**, atau tukar ke **Borang kami sendiri** dan muat naik borang anda."),
          s("Tetapkan **Bila perlu dihantar**: setiap bulan antara dua hari, setiap tahun pada satu bulan, sekali sebelum satu tarikh, atau bila-bila perlu."),
          s("Pilih syarikat dan siapa yang mengisi: semua orang, atau satu jabatan. Mereka nampak di bawah Borang dan di meja kerja mereka.", "forms.tabs"),
          s("Klik **Siapa sudah hantar** pada borang itu. **Terima** setiap satu, atau **Pulangkan** dengan apa yang perlu dibetulkan."),
        ],
      },
    ],
    tips: [
      "Borang yang berlanjutan ke bulan berikutnya, contohnya dari 30 hb hingga 3 hb, dikira untuk bulan ia dibuka.",
      "Pusingan yang terlepas kekal dalam senarai sebagai **Lewat** selama beberapa hari, supaya tidak dilupakan.",
      "Semua yang dihantar juga disimpan dalam fail meja kerja orang itu, supaya AI dan pengurus boleh mencari di dalamnya.",
    ],
    who: "Semua orang nampak borang untuk syarikat dan jabatan mereka. Pemilik, pentadbir dan pengurus menambah dan menyemak borang.",
    related: ["workspace", "files", "my-worker", "tasks"],
  },

  reports: {
    purpose: "Apa yang ditulis oleh ejen untuk anda: ringkasan dahulu, kemudian jadual yang boleh disusun, ditapis dan dimuat turun.",
    can: [
      "Cari laporan ikut tajuk.",
      "Buka laporan untuk membaca **Ringkasan** dan jadualnya.",
      "Susun jadual dengan mengklik lajur, tapis jadual yang panjang, dan muat turun jadual sebagai **CSV**.",
      "Pergi terus ke tugasan yang menghasilkan laporan itu.",
    ],
    spots: {
      "reports.list": "Setiap laporan yang ditulis oleh ejen, yang terbaharu dahulu.",
      "reports.search": "Cari laporan ikut tajuk.",
    },
    howto: [
      {
        title: "Muat turun jadual ke Excel",
        steps: [
          s("Cari laporan dalam senarai, atau guna carian.", "reports.search"),
          s("Klik untuk membukanya.", "reports.list"),
          s("Klik **CSV** di atas jadual. Fail ini boleh dibuka dalam Excel atau Google Sheets."),
        ],
      },
    ],
    tips: ["Laporan baharu muncul sendiri dalam senarai semasa halaman ini dibuka."],
    who: EVERYONE,
    related: ["tasks", "overview", "documents"],
  },

  chat: {
    purpose: "Bercakap terus dengan mana-mana ejen. Jika ada kerja yang perlu dibuat, jadikan balasannya satu tugasan.",
    can: [
      "Pilih ejen dan bersembang dengannya.",
      "Tak perlu menaip: klik mikrofon, bercakap, dan kata-kata anda muncul dalam kotak.",
      "Mulakan perbualan **Baharu**, atau kembali ke perbualan lama.",
      "Klik **Jadikan tugasan** di bawah balasan untuk menukarnya kepada tugasan.",
    ],
    spots: {
      "chat.agents": "Pilih ejen yang anda mahu ajak bercakap.",
      "chat.composer": "Taip mesej anda, atau guna mikrofon.",
    },
    howto: [
      {
        title: "Tanya ejen sesuatu",
        state: "conversation",
        steps: [
          s("Pilih ejen dalam senarai.", "chat.agents"),
          s("Taip mesej dan tekan Enter. Shift+Enter untuk baris baharu.", "chat.composer"),
          s("Di bawah balasannya, anda nampak model mana yang menjawab dan alat yang digunakan."),
        ],
      },
      {
        title: "Bercakap tanpa menaip",
        steps: [
          s("Klik mikrofon di sebelah kotak mesej.", "chat.composer"),
          s("Bercakap, kemudian klik **Hentikan**. Kata-kata anda muncul dalam kotak."),
          s("Semak teks dan tekan Enter untuk menghantar. Mesej tidak dihantar dengan sendirinya."),
        ],
      },
      {
        title: "Jadikan balasan satu tugasan",
        steps: [
          s("Klik **Jadikan tugasan** di bawah balasan ejen."),
          s("Borang tugasan baharu dibuka dengan ejen dan balasan sudah diisi. Semak, kemudian cipta tugasan."),
        ],
      },
    ],
    tips: [
      "Apa-apa yang memerlukan kelulusan akan dicadangkan sebagai tugasan, bukan dibuat dalam sembang.",
      "Suara memerlukan model pertuturan ke teks; pentadbir menambahnya dalam Enjin AI.",
    ],
    who: "Semua boleh membuka sembang. Menulis kepada ejen memerlukan peranan yang boleh mencipta kerja.",
    related: ["tasks", "agents", "assistants"],
  },

  // ------------------------------------------------------------------ Documents
  "company-kit": {
    purpose: "Fakta setiap syarikat yang digunakan semula oleh semua dokumen: nama sah, nombor pendaftaran, alamat, bank, penandatangan dan logo.",
    can: [
      "Pilih syarikat dan isi butiran identiti, hubungan, bank, orang, kewangan dan jenama.",
      "Muat naik logo syarikat dan lihat pratonton kepala surat secara langsung.",
      "Tambah fakta anda sendiri di bawah **Fakta lain**; templat boleh menggunakannya.",
      "Lihat sejauh mana kit ini lengkap.",
    ],
    spots: {
      "company-kit.fields": "Fakta syarikat yang digunakan semula oleh semua dokumen.",
      "company-kit.save": "Simpan kit.",
    },
    howto: [
      {
        title: "Isi kit syarikat",
        steps: [
          s("Pilih syarikat di bahagian atas."),
          s("Isi kad: identiti, hubungan, bank, orang, kewangan dan jenama.", "company-kit.fields"),
          s("Klik **Muat naik logo** dan semak pratonton kepala surat."),
          s("Klik **Simpan kit**. Setiap sebut harga, invois dan surat baharu untuk syarikat ini akan menggunakan fakta ini.", "company-kit.save"),
        ],
      },
    ],
    tips: [
      "Isi kit dahulu, kerana dokumen dan pek mengambil maklumat daripadanya.",
      "Hanya pentadbir dan pengurus syarikat itu boleh mengubahnya.",
    ],
    who: "Semua boleh membacanya. Pentadbir dan pengurus syarikat itu boleh mengubahnya.",
    related: ["templates", "documents", "files"],
  },

  files: {
    purpose: "Fail syarikat: satu tempat bagi setiap syarikat untuk semua dokumennya. Lepaskan seluruh folder atau zip dan foldernya dikekalkan, setiap fail dibaca dan diisih, dan dokumen cara kerja masuk ke perpustakaan untuk ejen.",
    can: [
      "Pilih syarikat di **Syarikat**, kemudian lepaskan fail, seluruh folder atau .zip di ruang muat naik.",
      "Ikuti setiap muat naik semasa ia dibuka, dibaca dan diisih, kemudian baca laporannya: apa yang ditemui, apa yang masuk perpustakaan dan apa yang ditahan.",
      "Semak imbas folder syarikat, cari, tapis ikut jenis atau jabatan, atau kumpulkan senarai **Ikut jenis** atau **Ikut jabatan**.",
      "Buka fail untuk melihat pratonton, ringkasan, jenis, jabatan dan foldernya, dan ubah mana-mana yang perlu.",
      "Muat turun satu fail, satu folder, semua fail syarikat, atau fail yang anda tandakan sahaja, sebagai zip.",
      "Jadikan prosedur sebagai SOP atau aliran kerja dengan **Jadikan SOP** atau **Bina aliran kerja**.",
      "Pengurus: **Lepaskan** fail yang ditahan selepas menyemaknya, atau **Tahan** sendiri mana-mana fail.",
    ],
    spots: {
      "files.company": "Syarikat yang memiliki dokumen ini. Muat naik dan muat turun untuk syarikat ini sahaja.",
      "files.upload": "Lepaskan fail, seluruh folder atau zip di sini, atau pilih sendiri.",
      "files.report": "Satu muat naik: kemajuannya, kemudian laporannya dengan fail yang ditanda dan cadangan AI.",
      "files.tree": "Folder syarikat, dengan bilangan fail dan fail yang ditahan.",
      "files.filters": "Cari, dan tapis ikut jabatan atau jenis.",
      "files.list": "Fail dalam folder itu, dengan jenis, jabatan, status dan perpustakaan.",
      "files.download-folder": "Muat turun folder semasa sebagai zip.",
      "files.download-all": "Muat turun semua fail syarikat ini sebagai zip.",
      "files.library": "Jadikan fail sebagai garis panduan yang dicari dan dipetik oleh ejen.",
    },
    howto: [
      {
        title: "Dokumen syarikat: di mana hendak muat naik",
        steps: [
          s("Buka **Fail syarikat** (di bawah Dokumen) dan pilih syarikat di **Syarikat**.", "files.company"),
          s("Apa yang perlu dimuat naik: SOP, panduan, senarai semak, carta alir, borang, templat, sijil dan kontrak. Satu zip penuh dokumen syarikat pun boleh."),
          s("Lepaskan zip, fail atau seluruh folder di ruang muat naik, atau klik **Pilih fail** atau **Pilih folder**.", "files.upload"),
          s("Tunggu semasa ia menunjukkan **Membuka**, **Membaca** dan **Mengisih**. Anda boleh tinggalkan halaman ini; kerja itu tetap berjalan."),
          s("Apabila ia menunjukkan **Sedia**, baca laporannya: fail ikut jenis dan jabatan, berapa yang masuk perpustakaan, dan apa yang ditahan.", "files.report"),
        ],
      },
      {
        title: "Apa yang berlaku pada muat naik dengan sendirinya",
        steps: [
          s("Folder dikekalkan seperti asal, jadi fail dalam TENDER/CARTA ALIR kekal dalam folder itu.", "files.tree"),
          s("Setiap fail dibaca (termasuk imbasan), diberi jenis seperti SOP, borang atau sijil, dan dipadankan dengan jabatan."),
          s("Dokumen cara kerja seperti SOP, panduan dan senarai semak masuk ke perpustakaan, supaya ejen mencarinya dan memetik halamannya."),
          s("Fail yang ada kata laluan atau nombor IC kakitangan akan **Ditahan**: disimpan dan boleh dimuat turun, tetapi ejen tidak boleh membacanya sehingga pengurus menyemaknya dan klik **Lepaskan**."),
        ],
      },
      {
        title: "Lihat atau muat turun satu fail, satu folder atau semuanya",
        state: "sheet",
        steps: [
          s("Pilih folder di sebelah kiri, atau ketik **Folder** pada telefon.", "files.tree"),
          s("Klik fail untuk membukanya: pratonton, apa fail itu dan di mana letaknya. **Muat turun** memberi anda fail asal.", "files.list"),
          s("Klik **Muat turun folder** untuk mendapatkan folder semasa sebagai zip.", "files.download-folder"),
          s("Klik **Muat turun semuanya** untuk mendapatkan semua fail syarikat.", "files.download-all"),
          s("Untuk memuat turun beberapa fail, tandakan fail itu dan klik **Muat turun zip**."),
        ],
      },
      {
        title: "Jadikan prosedur sebagai SOP atau aliran kerja",
        state: "sheet",
        steps: [
          s("Buka dokumen itu, atau tandakan beberapa dokumen yang berkaitan."),
          s("Klik **Jadikan SOP** untuk langkah bertulis yang diikut ejen, atau **Bina aliran kerja** untuk menjalankan kerja itu langkah demi langkah."),
          s("Semak draf sebelum menyimpannya. Laporan muat naik juga menyenaraikan **Cadangan AI** yang boleh anda jadikan titik mula."),
        ],
      },
      {
        title: "Jadikan fail sebagai garis panduan",
        state: "sheet",
        steps: [
          s("Klik fail untuk membukanya."),
          s("Hidupkan **Guna sebagai garis panduan (perpustakaan)**.", "files.library"),
          s("Pilih **Untuk siapa**. Ejen dalam skop itu kini mencarinya dan memetik halaman yang digunakan."),
        ],
      },
      {
        title: "Cari dalam setiap dokumen",
        steps: [
          s("Klik kotak carian di bahagian atas mana-mana halaman, atau tekan **/**, dan mula menaip. Di telefon, ketik ikon kanta pembesar.", "shell.search"),
          s("Pilih cadangan: perkataan daripada dokumen anda sendiri, tajuk, tajuk bahagian, atau carian terkini anda. Kekunci ↑ ↓ dan Enter juga boleh digunakan."),
          s("Tekan Enter untuk **Cari dalam semua dokumen**: setiap fail halaman demi halaman, SOP, dokumen, templat dan halaman wiki, dengan perkataan yang sepadan ditanda."),
          s("Letak perkataan dalam tanda petik untuk frasa yang tepat, seperti \"load system calculation\". Amaun dan tarikh boleh ditaip seperti biasa: RM700, RM 700.00, 16hb. Nombor rujukan, seperti nombor PO atau tender, dilengkapkan semasa anda menaip."),
          s("Klik hasil carian: fail dibuka dalam Fail syarikat pada halaman yang sepadan. Anda hanya jumpa apa yang anda boleh buka, dan tidak sekali-kali fail yang ditahan."),
        ],
      },
    ],
    tips: [
      "Fail yang ditahan tidak sampai kepada ejen sehingga pengurus melepaskannya. Laporan menerangkan sebabnya dengan mudah dan tidak sekali-kali menunjukkan rahsia itu.",
      "Jika fail dipadam, pek yang menggunakannya akan menunjukkan fail itu sebagai hilang.",
      "Sijil menunjukkan **Sah sehingga**, supaya anda boleh memperbaharuinya tepat pada masanya.",
    ],
    who: "Semua boleh menyemak imbas dan memuat turun. Memuat naik dan mengubah fail memerlukan peranan yang boleh mencipta kerja; melepaskan fail yang ditahan memerlukan pengurus.",
    related: ["library", "sops", "workflows", "packs"],
  },

  templates: {
    purpose: "Sebut harga, invois, surat, kertas cadangan dan fail Word anda sendiri, dengan {{placeholders}} yang diisi oleh ejen atau orang.",
    can: [
      "Guna templat permulaan, atau buat sendiri dengan **Templat baharu**.",
      "Muat naik fail Word anda sendiri dengan **Templat Word**; susun aturnya dikekalkan.",
      "Masukkan fakta syarikat dengan satu klik: nama syarikat, alamat, nombor dokumen, butiran item, jumlah dan lain-lain.",
      "Tandakan medan yang wajib diisi dan jenisnya.",
      "Mulakan dokumen daripada templat dengan **Guna**.",
    ],
    spots: {
      "templates.new": "Buat templat baharu.",
      "templates.list": "Templat permulaan dan templat anda sendiri.",
    },
    howto: [
      {
        title: "Buat templat",
        steps: [
          s("Klik **Templat baharu**.", "templates.new"),
          s("Beri **Nama**, pilih **Jenis** dan **Awalan nombor**, contohnya QT."),
          s("Tulis **Teks**. Klik cip untuk memasukkan fakta syarikat, jumlah atau blok tandatangan."),
          s("Semak **Medan untuk diisi**: medan ini dikesan daripada {{placeholders}}. Tandakan yang wajib."),
          s("Klik **Simpan templat**."),
        ],
      },
      {
        title: "Guna fail Word anda sendiri",
        steps: [
          s("Klik **Templat Word** dan pilih fail .docx."),
          s("Beri nama dan klik **Jadikan templat**. Untuk mengubah teks kemudian, ubah dalam Word dan muat naik semula."),
        ],
      },
    ],
    tips: ["Nombor dokumen bertambah dengan sendiri, contohnya QT-2026-0001."],
    who: EVERYONE,
    related: ["documents", "company-kit", "packs"],
  },

  documents: {
    purpose: "Dokumen yang didraf oleh orang atau ejen, disemak secara automatik, diluluskan, dan dieksport ke PDF, Word atau Excel.",
    can: [
      "Cipta dokumen: **Tulis dengan AI**, mula dengan **Halaman kosong**, atau pilih templat.",
      "Isi medan sendiri, atau guna **Isi dengan AI** berdasarkan penerangan atau fail.",
      "Tulis semula bahagian yang dipilih: lebih pendek, lebih formal, lebih mesra, betulkan tatabahasa, atau terjemah ke Bahasa Melayu atau Bahasa Inggeris.",
      "Lihat semakan: apa yang mesti dibaiki dan apa yang perlu diteliti. Minta **Semak dengan AI**.",
      "Hantar untuk semakan, luluskan (dokumen akan dikunci) dan eksport ke PDF, Word atau Excel.",
      "Kembali ke versi lama dalam **Sejarah**.",
    ],
    spots: {
      "documents.new": "Cipta dokumen baharu.",
      "documents.list": "Setiap dokumen, statusnya dan berapa semakan yang perlu dibaiki.",
    },
    howto: [
      {
        title: "Draf sebut harga dengan AI",
        state: "editor",
        steps: [
          s("Klik **Dokumen baharu**.", "documents.new"),
          s("Pilih **Syarikat**, dan di bawah **Mula daripada** pilih templat sebut harga."),
          s("Terangkan apa yang perlu ditulis, dan lampirkan fail rujukan jika ada."),
          s("Klik **Cipta dan isi**. Editor dibuka dengan medan dan pratonton pada kepala surat."),
          s("Semak setiap fakta, baiki apa yang ditanda oleh semakan, dan klik **Simpan**."),
        ],
      },
      {
        title: "Luluskan dan hantar dokumen",
        steps: [
          s("Buka dokumen daripada senarai.", "documents.list"),
          s("Klik **Hantar untuk semakan**. Orang yang ada kuasa kelulusan akan klik **Luluskan** setelah semua semakan lulus."),
          s("Guna **Eksport** untuk memuat turun fail PDF, Word atau Excel."),
        ],
      },
    ],
    tips: [
      "AI hanya menggunakan apa yang anda tulis dan fail yang anda lampirkan; ia tidak mereka fakta. Walaupun begitu, semak setiap fakta sebelum menghantar.",
      "Dokumen yang sudah diluluskan akan dikunci. Klik **Buka semula** untuk mengubahnya.",
      "Tekan Ctrl+S (Cmd+S pada Mac) untuk menyimpan.",
    ],
    who: "Semua boleh mendraf. Untuk meluluskan, anda perlukan peranan yang membuat keputusan kelulusan.",
    related: ["templates", "company-kit", "packs"],
  },

  packs: {
    purpose: "Pek serahan, contohnya untuk tender: senarai semak yang dipadankan dengan fail dan dokumen sebenar, disusun menjadi satu PDF dengan muka depan dan senarai kandungan.",
    can: [
      "Cipta pek dengan senarai semak, sama ada anda tulis sendiri atau didraf dengan AI.",
      "Padankan item dengan fail secara automatik melalui **Isi automatik dari fail**, kemudian sahkan setiap padanan.",
      "Draf dokumen yang belum ada, seperti surat iringan, dengan **Tulis draf**.",
      "Minta ejen menyediakan pek.",
      "Susun satu PDF dengan **Gabungkan PDF**, kemudian buka atau muat turun.",
    ],
    spots: {
      "packs.new": "Mulakan pek serahan baharu.",
      "packs.list": "Pek anda dan tahap kesediaan setiap satu.",
    },
    howto: [
      {
        title: "Sediakan pek serahan",
        steps: [
          s("Klik **Pek baharu**.", "packs.new"),
          s("Beri **Tajuk**, pilih **Syarikat** dan nyatakan tujuannya."),
          s("Klik **Draf dengan AI** untuk mendapatkan senarai semak, ubah itemnya, kemudian klik **Cipta pek**."),
          s("Klik **Isi automatik dari fail** dan **Sahkan** setiap padanan. Guna **Tambah fail** atau **Tulis draf** untuk yang belum ada."),
          s("Apabila semua yang wajib sudah sedia, klik **Gabungkan PDF**."),
        ],
      },
    ],
    tips: [
      "Pejabat menyediakan pek; orang yang menyemak dan menyerahkannya. Ejen tidak pernah menyerahkan apa-apa.",
      "Fail yang sudah tamat tempoh ditanda dalam senarai semak.",
    ],
    who: EVERYONE,
    related: ["files", "documents", "company-kit"],
  },

  // ------------------------------------------------------------------ Collaboration
  meetings: {
    purpose: "Ejen berbincang sesama sendiri tentang satu keputusan dan bersetuju dengan satu cadangan. Anda boleh memerhati dan menambah pandangan.",
    can: [
      "Mulakan mesyuarat: soalannya, 2 hingga 5 ejen dan 1 hingga 4 pusingan.",
      "Ikuti transkrip secara langsung dan tambah pandangan semasa mesyuarat berjalan.",
      "Baca hasilnya: keputusan, pilihan yang dipertimbangkan, pandangan yang berbeza dan langkah seterusnya.",
    ],
    spots: {
      "meetings.list": "Mesyuarat yang sedang berlangsung dan mesyuarat lalu.",
      "meetings.new": "Mulakan mesyuarat baharu.",
    },
    howto: [
      {
        title: "Minta ejen membuat keputusan bersama",
        steps: [
          s("Klik **Mesyuarat baharu**.", "meetings.new"),
          s("Isi **Apa yang perlu mereka putuskan?**"),
          s("Pilih 2 hingga 5 ejen dalam **Siapa hadir**. Ejen pertama yang anda pilih menjadi pengerusi."),
          s("Pilih bilangan **Pusingan** dan klik **Mulakan mesyuarat**."),
          s("Buka mesyuarat itu daripada senarai untuk mengikuti transkrip dan membaca keputusannya.", "meetings.list"),
        ],
      },
    ],
    tips: [
      "Mesyuarat hanya memberi cadangan; ia tidak meluluskan apa-apa. Sebarang tindakan masih melalui kelulusan.",
      "Anda juga boleh memulakan mesyuarat daripada tugasan dengan butang **Mesyuarat**.",
    ],
    who: "Semua boleh membaca mesyuarat. Untuk memulakannya, anda perlukan peranan yang boleh mencipta kerja.",
    related: ["tasks", "brain", "approvals"],
  },

  broadcasts: {
    purpose: "Hantar satu mesej kepada semua ejen, sebuah syarikat, jabatan tertentu atau ejen pilihan, dan lihat siapa yang menerimanya.",
    can: [
      "Hantar kepada **Semua**, atau **Pilih** syarikat, jabatan atau ejen tertentu.",
      "Hantar **Pengumuman** yang akan diingati ejen, atau **Tugasan untuk setiap ejen**.",
      "Minta setiap ejen membalas.",
      "Lihat siapa yang menerima, siapa yang membalas dan tugasan yang dicipta.",
    ],
    spots: {
      "broadcasts.compose": "Tulis dan hantar hebahan.",
      "broadcasts.list": "Hebahan yang dihantar, dan berapa ejen yang menerimanya.",
    },
    howto: [
      {
        title: "Maklumkan perubahan kepada semua ejen",
        steps: [
          s("Dalam **Hebahan baharu**, pilih **Semua** atau pilih penerimanya.", "broadcasts.compose"),
          s("Pilih **Pengumuman** dan tulis mesej."),
          s("Klik **Hantar hebahan**."),
          s("Buka hebahan itu dalam senarai yang dihantar untuk melihat siapa yang menerimanya.", "broadcasts.list"),
        ],
      },
    ],
    tips: [
      "Pengumuman kekal dalam ingatan setiap ejen selama 30 hari.",
      "Dengan **Tugasan untuk setiap ejen**, baris pertama menjadi tajuk tugasan, dan tugasan itu menunggu dalam Saringan sehingga anda memulakannya.",
    ],
    who: "Semua boleh membaca hebahan. Untuk menghantar, anda perlukan peranan yang boleh mencipta kerja.",
    related: ["office", "tasks", "sops"],
  },

  // ------------------------------------------------------------------ Knowledge
  sops: {
    purpose: "Prosedur bertulis yang diikuti ejen anda. SOP syarikat dan jabatan terpakai dengan sendirinya; SOP perpustakaan dilampirkan kepada ejen yang dipilih.",
    can: [
      "Tulis SOP dan pilih siapa yang mengikutinya: **Semua syarikat**, **Satu syarikat**, **Satu jabatan** atau **Perpustakaan**.",
      "Tapis ikut siapa yang mengikutinya, dan cari.",
      "Ubah SOP; setiap kali disimpan, satu versi baharu dicipta.",
      "Padam SOP; ejen berhenti mengikutinya serta-merta.",
    ],
    spots: {
      "sops.new": "Tulis SOP baharu.",
      "sops.list": "SOP dikumpulkan ikut siapa yang mengikutinya.",
    },
    howto: [
      {
        title: "Tulis SOP",
        steps: [
          s("Klik **SOP baharu**.", "sops.new"),
          s("Beri **Tajuk**, contohnya \"Tutup akaun hujung bulan\"."),
          s("Di bawah **Siapa yang ikut**, pilih skop dan, jika perlu, syarikat atau jabatan."),
          s("Tulis **Prosedur**: tujuan, langkah, peraturan dan hasil. Guna **Pratonton** untuk menyemaknya."),
          s("Klik **Cipta SOP**. Ejen dalam skop itu mengikutinya mulai langkah seterusnya."),
        ],
      },
    ],
    tips: [
      "Ejen membaca SOP sebelum setiap langkah.",
      "Anda tidak boleh menukar siapa yang mengikuti SOP selepas ia dicipta. Buat SOP baharu sebagai ganti.",
    ],
    who: "Semua boleh membaca SOP. Pemilik dan pentadbir menulis dan mengubahnya.",
    related: ["library", "agents", "blueprints"],
  },

  library: {
    purpose: "Garis panduan, manual dan polisi, serta semua SOP. Ejen mencarinya apabila kerja memerlukannya dan memetik halaman yang digunakan.",
    can: [
      "Muat naik garis panduan dan pilih untuk siapa: seluruh organisasi, satu syarikat atau satu jabatan.",
      "Lihat setiap sumber dan sama ada ia sudah sedia (**Diindeks**) atau masih dibaca.",
      "Cuba carian seperti yang dibuat oleh ejen, dan lihat petikan serta rujukan yang diperolehnya.",
      "Keluarkan fail daripada perpustakaan; fail itu kekal dalam Fail.",
    ],
    spots: {
      "library.upload": "Pilih untuk siapa, kemudian lepaskan fail.",
      "library.sources": "Setiap garis panduan dan SOP, dan sama ada ia sudah sedia.",
      "library.search": "Tanya soalan seperti yang ditanya oleh ejen.",
    },
    howto: [
      {
        title: "Tambah garis panduan",
        steps: [
          s("Dalam **Tambah garis panduan**, pilih **Untuk siapa**.", "library.upload"),
          s("Lepaskan fail. Fail menunjukkan **Sedang dibaca…**, kemudian **Diindeks** apabila ejen sudah boleh mencarinya.", "library.sources"),
        ],
      },
      {
        title: "Semak apa yang akan ditemui ejen",
        steps: [
          s("Taip soalan dalam **Cuba cari** dan klik **Cari**.", "library.search"),
          s("Setiap hasil menunjukkan halaman, tajuk dan rujukan. Padanan yang kuat ditanda **Ejen dapat ini tanpa diminta**."),
        ],
      },
    ],
    tips: ["SOP muncul dalam perpustakaan dengan sendirinya."],
    who: "Semua boleh mencari. Menambah dan mengeluarkan fail memerlukan peranan yang boleh mencipta kerja.",
    related: ["files", "sops", "brain"],
  },

  brain: {
    purpose: "Apa yang pejabat tahu: fakta yang dipelajari ejen, halaman wiki, dan pengemasan setiap malam yang dipanggil mimpi.",
    can: [
      "Baca dan tulis halaman wiki, dan lihat pautan antara halaman serta sejarahnya.",
      "Ajar pejabat satu fakta, betulkan fakta, atau minta pejabat melupakannya.",
      "Cari apa yang pejabat tahu, dalam Bahasa Inggeris atau Bahasa Melayu, termasuk perbualan lalu.",
      "Lihat pengetahuan sebagai graf, dan baca apa yang diubah oleh setiap mimpi malam.",
    ],
    spots: {
      "brain.tabs": "Halaman, fakta, carian, graf dan mimpi.",
      "brain.search": "Cari apa yang pejabat tahu.",
    },
    howto: [
      {
        title: "Ajar pejabat satu fakta",
        steps: [
          s("Buka tab **Fakta**.", "brain.tabs"),
          s("Taip fakta dalam **Ajar pejabat satu fakta** dan pilih **Siapa yang tahu**."),
          s("Klik **Tambah**. Ejen boleh mengingatinya mulai sekarang."),
        ],
      },
      {
        title: "Cari apa yang pejabat tahu",
        steps: [
          s("Buka tab **Cari**.", "brain.tabs"),
          s("Tanya soalan anda dalam Bahasa Inggeris atau Bahasa Melayu.", "brain.search"),
          s("Hasil datang daripada fakta, halaman dan, jika anda tandakan, perbualan lalu."),
        ],
      },
    ],
    tips: [
      "Mimpi berjalan setiap malam. Ia menggabungkan maklumat berganda dan menyelesaikan percanggahan (fakta yang lebih baharu diguna pakai).",
      "Apabila fakta dibetulkan, versi lama disimpan di bawah **Tamat**.",
    ],
    who: "Semua boleh membaca. Mengubah memerlukan peranan yang boleh mencipta kerja; alat vault dan buat asal mimpi hanya untuk pemilik dan pentadbir.",
    related: ["library", "skills", "learning"],
  },

  skills: {
    purpose: "Prosedur yang dipelajari ejen daripada kerja mereka. Kemahiran tidak digunakan selagi belum diluluskan oleh seseorang.",
    can: [
      "Lihat perpustakaan kemahiran, serta kekerapan setiap kemahiran digunakan dan diterima.",
      "Semak **Cadangan**: kemahiran baharu, kemas kini, gabungan dan persaraan yang dicadangkan ejen.",
      "Ajar kemahiran daripada halaman web, fail atau nota yang ditampal dengan **Ajar daripada sumber**.",
      "Tulis ujian untuk kemahiran, jalankannya, dan biar **Perbaiki dengan AI** mencuba versi yang lebih baik.",
      "Lihat setiap versi, bandingkan, dan pulihkan versi lama.",
    ],
    spots: {
      "skills.list": "Kemahiran yang boleh digunakan ejen, berserta prestasinya.",
      "skills.proposals": "Perubahan yang dicadangkan ejen, menunggu keputusan seseorang.",
      "skills.teach": "Ajar kemahiran daripada pautan, fail atau nota.",
    },
    howto: [
      {
        title: "Semak kemahiran yang dicadangkan ejen",
        steps: [
          s("Buka tab **Cadangan**.", "skills.proposals"),
          s("Klik satu cadangan. Baca **Sebab**, imbasan keselamatan dan perubahannya."),
          s("Klik **Jalankan ujian** untuk membandingkan versi semasa dengan versi yang dicadangkan."),
          s("Klik **Luluskan**, **Ubah dan luluskan**, atau **Tolak**. Jika menolak, nyatakan sebabnya; ejen akan mengingatinya."),
        ],
      },
      {
        title: "Uji dan tambah baik kemahiran",
        state: "sheet",
        steps: [
          s("Klik kemahiran dalam perpustakaan.", "skills.list"),
          s("Di bawah **Ujian**, klik **Tambah**: satu permintaan, dan apa yang mesti atau tidak boleh ada dalam jawapan."),
          s("Klik **Jalankan ujian** untuk melihat berapa yang lulus."),
          s("Klik **Perbaiki dengan AI**. Ia menulis semula berdasarkan ujian yang gagal, menguji setiap versi dan menyimpan yang terbaik."),
        ],
      },
      {
        title: "Ajar kemahiran daripada sumber",
        steps: [
          s("Klik **Ajar daripada sumber**.", "skills.teach"),
          s("Pilih **Pautan**, **Fail** atau **Tampal teks**, dan nyatakan apa yang perlu dipelajari."),
          s("Klik **Draf kemahiran**. Kemahiran itu diuji, kemudian menunggu dalam Cadangan."),
        ],
      },
    ],
    tips: [
      "Imbasan keselamatan menyemak setiap cadangan; item **Mesti dibaiki** menghalang kelulusan.",
      "Kemahiran bertanda **Kerap dihantar semula** mempunyai kurang daripada 70% hasil yang diterima.",
    ],
    who: "Semua boleh melihat kemahiran. Meluluskan dan membersarakan memerlukan kuasa kelulusan; ujian dan draf memerlukan peranan yang boleh mencipta kerja.",
    related: ["learning", "brain", "agents"],
  },

  learning: {
    purpose: "Apa yang dipelajari ejen anda, bagaimana setiap perubahan diuji, apa yang aktif dengan sendirinya, dan kos pembelajaran.",
    can: [
      "Lihat untuk 7, 30 atau 90 hari: kemahiran yang dipelajari, yang menunggu semakan, kejayaan kemahiran, fakta yang dipelajari, kadar lulus ujian dan belanja pembelajaran.",
      "Pilih autopilot: semak semua, biar perubahan terbukti terus aktif, atau biar perubahan yang bersih terus aktif.",
      "Hidupkan **Semakan kendiri sebelum serah**: model kedua membaca kerja yang siap dan membandingkannya dengan permintaan asal dahulu.",
      "Baca keputusan terkini dan kemahiran yang paling banyak digunakan.",
    ],
    spots: {
      "learning.kpis": "Apa yang dipelajari dalam tempoh ini.",
      "learning.autopilot": "Berapa banyak boleh terus aktif tanpa semakan orang, dan semakan kendiri.",
      "learning.recent": "Keputusan pembelajaran terkini.",
    },
    howto: [
      {
        title: "Tentukan berapa banyak yang automatik",
        steps: [
          s("Cari kad **Autopilot**.", "learning.autopilot"),
          s("Pilih **Semak semua** untuk meluluskan setiap perubahan sendiri."),
          s("Atau pilih **Perubahan terbukti terus aktif** (disyorkan): hanya perubahan dengan imbasan keselamatan yang bersih dan ujian yang lulus sekurang-kurangnya sama baik."),
          s("Biarkan **Semakan kendiri sebelum serah** dihidupkan supaya ejen membaiki kekurangan sebelum anda melihat kerjanya."),
        ],
      },
    ],
    tips: [
      "Hanya pemilik atau pentadbir boleh menukar autopilot.",
      "Klik **Menunggu semakan** untuk terus ke cadangan.",
    ],
    who: "Semua boleh melihatnya. Pemilik dan pentadbir menukar autopilot.",
    related: ["skills", "brain", "impact"],
  },

  blueprints: {
    purpose: "Pakej peranan yang boleh diguna semula: arahan, model, alat, SOP dan kemahiran. Tetapkan peranan sekali, kemudian gunakan pada mana-mana ejen.",
    can: [
      "Cipta pelan tugas dengan arahan, kumpulan model, tahap autonomi dan skop alat.",
      "Pilih SOP perpustakaan dan kemahiran yang dibawanya.",
      "Gunakan pada ejen supaya ia bermula sebagai pakar.",
    ],
    spots: {
      "blueprints.new": "Cipta pelan tugas baharu.",
      "blueprints.apply": "Gunakan pelan tugas pada ejen.",
    },
    howto: [
      {
        title: "Cipta dan gunakan pelan tugas",
        steps: [
          s("Klik **Pelan tugas baharu**.", "blueprints.new"),
          s("Isi **Nama**, **Jawatan**, **Arahan** dan **Kumpulan model**."),
          s("Pilih **Tanya sebelum bertindak** atau **Bertindak sendiri**, dan tetapkan setiap alat kepada **Benarkan**, **Tanya saya** atau **Jangan**."),
          s("Pilih SOP dan kemahiran, kemudian klik **Simpan pelan tugas**."),
          s("Klik **Guna pada ejen**, pilih ejen dan klik **Guna**.", "blueprints.apply"),
        ],
      },
    ],
    tips: [
      "Apabila pelan tugas digunakan, peranan, arahan, model, alat dan SOP ejen diganti dengan yang ada dalam pelan tugas.",
      "Memadam pelan tugas tidak mengubah ejen yang sudah dibuat daripadanya.",
    ],
    who: "Pemilik, pentadbir, pengurus cawangan, ketua jabatan dan kakitangan.",
    related: ["agents", "sops", "skills"],
  },

  workflows: {
    purpose: "Lukis cara sesuatu kerja dibuat sebagai langkah yang bersambung, kemudian jalankannya. Setiap langkah pergi kepada ejennya, dan anda yang membuat keputusan.",
    can: [
      "Cipta aliran kerja dengan tiga cara: **Lakar sendiri**, **Minta AI draf**, atau **Mula daripada templat**.",
      "Pilih daripada 12 templat, seperti **Pertanyaan pelanggan hingga sebut harga**, **Permohonan cuti** atau **Tutup akaun hujung bulan**.",
      "Tambah langkah untuk kerja AI, komunikasi, dokumen, web dan orang, seperti **Kelulusan**.",
      "Lihat masalah sebelum menjalankannya, dan biar **Perbaiki dengan AI** mencadangkan perubahan.",
      "Jalankan kerja melaluinya, lampirkannya pada tugasan, atau jadikannya cara kerja standard sesuatu ejen.",
    ],
    spots: {
      "workflows.new": "Cipta aliran kerja baharu.",
      "workflows.list": "Aliran kerja anda, aktif atau draf.",
      "workflows.run": "Jalankan kerja melalui aliran kerja ini.",
    },
    howto: [
      {
        title: "Bina aliran kerja daripada templat",
        state: "editor",
        steps: [
          s("Klik **Aliran kerja baharu** dan pilih **Mula daripada templat**.", "workflows.new"),
          s("Pilih templat. Editor dibuka dengan langkah-langkahnya."),
          s("Klik satu langkah untuk menetapkan siapa yang membuatnya, dan sama ada anda menyemaknya sebelum ia diteruskan."),
          s("Pastikan butang masalah menunjukkan **Semua baik**, kemudian klik **Simpan**."),
        ],
      },
      {
        title: "Jalankan kerja melalui aliran kerja",
        steps: [
          s("Buka aliran kerja daripada senarai.", "workflows.list"),
          s("Klik **Jalankan**.", "workflows.run"),
          s("Nyatakan kerjanya, tambah fail, dan pilih ejen bagi setiap langkah."),
          s("Klik **Mula**. Keputusan, soalan dan semakan menunggu anda di bawah **Perlukan anda**."),
        ],
      },
    ],
    tips: [
      "Langkah **Isi borang web** sentiasa menunggu seseorang sebelum menghantar borang.",
      "Langkah **Draf e-mel** menyediakan e-mel; seseorang yang menghantarnya.",
      "Buat asal dengan Ctrl+Z dalam editor.",
    ],
    who: "Pemilik, pentadbir, pengurus, ketua jabatan, penyelia, kakitangan dan operator.",
    related: ["tasks", "schedules", "agents"],
  },

  // ------------------------------------------------------------------ Operations
  schedules: {
    purpose: "Kerja berulang untuk ejen anda, dan rekod setiap larian berserta hasilnya.",
    can: [
      "Cipta jadual: ejen mana, tugasan apa, dan bila, contohnya **Setiap hari bekerja, 9:00**.",
      "**Jalankan sekarang**, **Jeda** atau **Sambung** jadual.",
      "Baca **Rekod larian**: setiap larian, berapa lama ia ambil dan hasilnya.",
      "Lihat **Insiden**: kegagalan berulang dengan punca yang sama, dikumpulkan bersama.",
    ],
    spots: {
      "schedules.new": "Cipta jadual baharu.",
      "schedules.list": "Jadual anda dan larian terakhirnya.",
    },
    howto: [
      {
        title: "Jadualkan laporan mingguan",
        steps: [
          s("Klik **Jadual baharu**.", "schedules.new"),
          s("Beri **Nama**, pilih **Ejen** dan tulis **Tajuk tugasan** serta **Penerangan**."),
          s("Di bawah **Bila**, pilih **Setiap Isnin, 9:00**, atau masa lain."),
          s("Biarkan **Hantar hasil untuk disemak** dihidupkan jika anda mahu menyemak setiap hasil. Klik **Cipta jadual**."),
          s("Jadual itu muncul dalam senarai. Klik **Jalankan sekarang** untuk mencubanya serta-merta.", "schedules.list"),
        ],
      },
    ],
    tips: [
      "Larian yang gagal dicuba semula dengan sendiri selepas 5, 15 dan 30 minit.",
      "Setiap larian mencipta tugasan baharu, dengan tarikh ditambah pada tajuknya.",
    ],
    who: "Semua boleh melihat jadual. Mencipta dan mengubahnya memerlukan peranan yang boleh mencipta kerja.",
    related: ["tasks", "workflows", "my-worker"],
  },

  logins: {
    purpose: "Log masuk laman web yang boleh digunakan ejen tanpa pernah melihatnya, setiap satu dikunci kepada lamannya sendiri.",
    can: [
      "Simpan log masuk berserta laman yang dibenarkan.",
      "Pilih siapa yang boleh menggunakannya: semua syarikat, satu syarikat, atau ejen pilihan sahaja.",
      "Lihat bila setiap log masuk terakhir digunakan.",
      "Tukar laman, ejen atau kata laluan, atau padam log masuk.",
    ],
    spots: {
      "logins.new": "Simpan log masuk baharu.",
      "logins.list": "Log masuk yang disimpan, setiap satu dikunci kepada lamannya.",
    },
    howto: [
      {
        title: "Benarkan ejen log masuk ke laman web",
        steps: [
          s("Klik **Simpan log masuk**.", "logins.new"),
          s("Beri nama yang akan digunakan ejen, dan alamat laman."),
          s("Taip nama pengguna dan kata laluan. Kedua-duanya disulitkan dan tidak akan dipaparkan lagi."),
          s("Pilih siapa yang boleh menggunakannya, kemudian klik **Simpan log masuk**.", "logins.list"),
        ],
      },
    ],
    tips: [
      "Kata laluan tidak pernah dihantar kepada model AI. Pelayar yang menaipnya, dan hanya di laman yang disenaraikan.",
      "Laman yang memerlukan kod sekali guna, captcha atau PIN tandatangan tetap dikendalikan oleh orang: ejen berhenti dan bertanya.",
      "Setiap penggunaan direkodkan dalam log aktiviti.",
    ],
    who: "Pemilik, pentadbir, pengurus cawangan, ketua jabatan, dan kakitangan untuk log masuk mereka sendiri.",
    related: ["agents", "activity", "channels"],
  },

  "ai-engine": {
    purpose: "Sambungkan penyedia AI yang digunakan ejen anda, tentukan model mana yang menjawab dahulu, dan lihat kos setiap panggilan.",
    can: [
      "Sambungkan penyedia dengan kuncinya, kemudian uji sambungannya.",
      "Susun model dalam kumpulan, seperti Pintar atau Pantas, mengikut turutan sandaran.",
      "Lihat penggunaan: panggilan, token, kos dan ralat bagi setiap penyedia, model dan jenis kerja.",
      "Cuba prompt dalam **Ruang uji**.",
      "Tetapkan had keselamatan bagi bilangan panggilan model setiap tugasan.",
    ],
    spots: {
      "ai-engine.tabs": "Penyedia, kumpulan model, penggunaan, ruang uji dan tetapan.",
      "ai-engine.add": "Sambungkan penyedia AI baharu.",
    },
    howto: [
      {
        title: "Sambungkan penyedia AI",
        steps: [
          s("Di **Penyedia**, pilih penyedia di bawah **Sambung penyedia**.", "ai-engine.add"),
          s("Klik **Dapatkan kunci** untuk mendapatkannya daripada penyedia, kemudian tampal."),
          s("Klik **Uji sambungan**, kemudian **Simpan penyedia**."),
        ],
      },
      {
        title: "Pilih model yang menjawab dahulu",
        steps: [
          s("Buka **Kumpulan model**.", "ai-engine.tabs"),
          s("Dalam satu kumpulan, klik **Tambah model**, dan seret pemegang untuk menetapkan turutan."),
          s("Model pertama yang menjawab. Jika ia tergendala atau kehabisan kredit, model seterusnya mengambil alih."),
        ],
      },
    ],
    tips: [
      "Kunci disimpan secara tersulit. Hanya empat aksara terakhir dipaparkan semula.",
      "Pakej percuma daripada Groq, OpenRouter, Mistral dan HuggingFace cukup untuk bermula.",
      "Ejen meminta kumpulan, bukan penyedia, jadi anda boleh menukar model tanpa menyentuh ejen.",
    ],
    who: "Pemilik dan pentadbir boleh mengubahnya. Operator, pelulus dan pemerhati boleh melihat.",
    related: ["agents", "mcp-servers", "impact"],
  },

  "mcp-servers": {
    purpose: "Sambungkan pelayan alat luar (MCP), seperti sistem penjejak atau CRM. Ejen mencapai alatnya melalui jambatan carian, dan setiap panggilan perlu diluluskan.",
    can: [
      "Sambungkan pelayan dengan alamatnya dan, jika perlu, kunci.",
      "Lihat pelayan mana yang boleh dicapai dan alat yang ditawarkan oleh setiap satu.",
      "Matikan pelayan, muat semula alatnya, atau buangnya.",
    ],
    spots: {
      "mcp-servers.add": "Sambungkan pelayan alat baharu.",
    },
    howto: [
      {
        title: "Sambungkan pelayan alat",
        steps: [
          s("Klik **Sambung pelayan**.", "mcp-servers.add"),
          s("Isi **Nama**, **URL** dan, jika pelayan memerlukannya, **Pengepala auth**."),
          s("Klik **Sambung**. Alatnya muncul pada kad."),
        ],
      },
    ],
    tips: ["Hanya pelayan web (http atau https) disokong; pejabat tidak pernah menjalankan program pada komputer anda."],
    who: "Pemilik dan pentadbir.",
    related: ["ai-engine", "approvals", "agents"],
  },

  channels: {
    purpose: "Cara pejabat menghubungi anda: pemberitahuan telefon, Telegram, WhatsApp, Gmail dan token API, serta ejen mana menjawab di mana.",
    can: [
      "Hidupkan pemberitahuan pada peranti ini, dan hantar ujian.",
      "Pautkan akaun Telegram atau WhatsApp anda supaya anda menerima mesej dan boleh menjawab di situ.",
      "Sambungkan Gmail supaya pembantu anda boleh mendraf balasan untuk anda luluskan.",
      "Pentadbir: sambungkan bot Telegram dan WhatsApp, tentukan ejen mana menjawab di mana, dan buat token API.",
    ],
    spots: {
      "channels.whatsapp": "WhatsApp untuk pejabat, dan pautan anda sendiri.",
      "channels.telegram": "Bot Telegram dan akaun anda.",
      "channels.push": "Pemberitahuan pada peranti ini.",
    },
    howto: [
      {
        title: "Terima kelulusan di telefon anda",
        steps: [
          s("Buka Saluran di telefon anda. Di iPhone, tambah aplikasi ke Skrin Utama dahulu (Kongsi, kemudian Tambah ke Skrin Utama).", "channels.push"),
          s("Hidupkan **Pemberitahuan pada peranti ini** dan benarkan pemberitahuan."),
          s("Klik **Hantar ujian**. Ketik pemberitahuan untuk membuka keputusan itu."),
        ],
      },
      {
        title: "Pautkan WhatsApp anda",
        steps: [
          s("Dalam kad WhatsApp, klik **Pautkan WhatsApp saya**.", "channels.whatsapp"),
          s("Dari WhatsApp anda sendiri, hantar **LINK** berserta kod ke nombor pejabat sebelum kiraan detik tamat."),
        ],
      },
      {
        title: "Pautkan Telegram anda",
        steps: [
          s("Dalam kad Telegram, klik **Pautkan akaun saya**.", "channels.telegram"),
          s("Buka Telegram dan tekan **Start**, kemudian klik **Saya sudah buat**."),
        ],
      },
    ],
    tips: [
      "Pentadbir boleh memilih antara WAHA (cepat, imbas kod QR) dan Meta WhatsApp Business API yang rasmi.",
      "Token API hanya dipaparkan sekali. Salin serta-merta.",
    ],
    who: "Setiap orang memautkan peranti dan akaun sendiri. Pemilik dan pentadbir menyediakan saluran pejabat.",
    related: ["approvals", "assistants", "logins"],
  },

  // ------------------------------------------------------------------ Admin
  organization: {
    purpose: "Syarikat anda (cawangan) dan jabatan di dalamnya. Tambah syarikat bersama pasukan AI siap sedia dalam satu langkah.",
    can: [
      "Tambah syarikat: nama, warna, industri dan jabatan standard.",
      "Tambah pasukan AI siap sedia untuk industrinya: kewangan, jualan, operasi, HR dan khidmat pelanggan, serta peranan khusus industri.",
      "Rahsiakan pengetahuan sesebuah syarikat.",
      "Namakan semula, tambah dan buang jabatan.",
    ],
    spots: {
      "organization.add": "Tambah syarikat baharu.",
      "organization.company": "Sebuah syarikat dengan jabatannya.",
    },
    howto: [
      {
        title: "Tambah syarikat bersama pasukan AI siap sedia",
        state: "new",
        steps: [
          s("Klik **Cawangan baharu**.", "organization.add"),
          s("Taip **Nama syarikat** dan pilih warna."),
          s("Pilih **Industri**, contohnya Perdagangan & runcit."),
          s("Biarkan **Tambah pasukan AI siap sedia** dihidupkan dan semak **Siapa yang menyertai**."),
          s("Klik **Cipta cawangan**. Syarikat itu muncul bersama jabatan dan ejennya.", "organization.company"),
        ],
      },
    ],
    tips: [
      "Ejen siap sedia bertanya dahulu sebelum bertindak. Anda boleh menukarnya bagi setiap ejen kemudian.",
      "Jika anda menambah pasukan ke syarikat sedia ada, peranan yang sudah wujud akan dilangkau.",
    ],
    who: "Semua boleh melihatnya. Pemilik dan pentadbir mengubahnya.",
    related: ["agents", "settings", "impact"],
  },

  activity: {
    purpose: "Setiap perubahan oleh orang dan ejen, dalam log yang menunjukkan jika ada apa-apa yang diubah atau dipadam.",
    can: [
      "Tapis ikut **Log masuk**, **Orang**, **Organisasi**, **Kerja**, **Ejen** atau **Lain-lain**.",
      "Baca setiap perubahan sebagai ayat biasa: siapa, apa dan bila.",
      "Klik **Sahkan log** untuk memastikan tiada apa yang diubah.",
    ],
    spots: {
      "activity.filter": "Tunjukkan satu jenis perubahan.",
      "activity.list": "Setiap perubahan, yang terbaharu dahulu, dikumpulkan ikut hari.",
    },
    howto: [
      {
        title: "Semak siapa yang mengubah sesuatu",
        steps: [
          s("Pilih penapis, contohnya **Orang** atau **Ejen**.", "activity.filter"),
          s("Tatal senarai. Setiap baris menyatakan siapa buat apa, dan bila.", "activity.list"),
          s("Klik **Sahkan log** untuk memastikan log tidak diusik."),
        ],
      },
    ],
    tips: ["Setiap entri dirantai dengan entri sebelumnya, jadi sebarang pengubahan atau pemadaman boleh dikesan."],
    who: "Pemilik dan pentadbir.",
    related: ["settings", "approvals", "logins"],
  },

  settings: {
    purpose: "Orang dalam ruang kerja anda dan peranan mereka, serta akaun dan paparan anda.",
    can: [
      "Tambah ahli dengan peranan, serta syarikat atau jabatan bagi pengurus dan kakitangan.",
      "Tukar peranan atau tempat ahli, set semula kata laluan, atau keluarkan seseorang.",
      "Baca apa yang boleh dibuat oleh setiap peranan.",
      "Tukar tema: cerah, gelap atau ikut peranti anda.",
    ],
    spots: {
      "settings.add": "Tambah ahli baharu.",
      "settings.list": "Orang dan peranan mereka.",
    },
    howto: [
      {
        title: "Tambah ahli",
        steps: [
          s("Klik **Tambah ahli**.", "settings.add"),
          s("Taip **Nama** dan **E-mel**, dan pilih **Peranan**."),
          s("Bagi pengurus dan kakitangan, pilih syarikat atau jabatan mereka."),
          s("Salin kata laluan sementara dan berikan kepada mereka. Mereka memilih kata laluan sendiri semasa log masuk kali pertama.", "settings.list"),
        ],
      },
    ],
    tips: [
      "Kata laluan sementara hanya dipaparkan sekali.",
      "Hanya pemilik boleh menjadikan seseorang pemilik.",
    ],
    who: "Pemilik dan pentadbir mengurus semua orang; pengurus cawangan dan ketua jabatan menambah orang ke dalam pasukan sendiri.",
    related: ["organization", "activity"],
  },

  // ------------------------------------------------------------------ Help
  tutorial: {
    purpose: "Belajar menggunakan sistem ini mengikut peranan anda, langkah demi langkah: dari ejen pertama hingga memberi tugasan dan melihat hasilnya.",
    can: [
      "Ikuti laluan peranan anda: **Pemilik**, **Pengurusan**, **Kakitangan** atau **Pelulus & pemerhati**.",
      "Buka langkah sesuatu pelajaran, atau klik **Tunjukkan** untuk pergi ke halaman yang betul.",
      "Pelajaran ditanda selesai dengan sendiri apabila sistem nampak anda sudah melakukannya.",
      "Cari pelajaran, glosari dan soalan lazim.",
    ],
    spots: {
      "tutorial.tracks": "Pilih laluan untuk peranan anda.",
      "tutorial.next": "Pelajaran seterusnya untuk dibuat.",
    },
    howto: [
      {
        title: "Ikuti tutorial peranan anda",
        steps: [
          s("Pilih laluan anda di bahagian atas.", "tutorial.tracks"),
          s("Mula dengan kad **Seterusnya**.", "tutorial.next"),
          s("Klik **Tunjukkan** untuk membuka halaman itu, buat langkahnya, kemudian kembali ke sini."),
        ],
      },
    ],
    tips: ["Panduan pengguna (halaman ini) menerangkan setiap skrin; Tutorial membawa anda melaluinya mengikut turutan."],
    who: EVERYONE,
    related: ["home"],
  },
  // ------------------------------------------------------------------ Help: demo pelanggan
  "demo-day": {
    purpose: "Skrip untuk menunjukkan kepada pelanggan satu hari bekerja bersama ejen AI: kakitangan mengambil pekerja AI mereka, ejen menjalankan prosedur syarikat sendiri, dan seseorang meluluskan hasil kerja AI. Gunakan prosedur syarikat anda; setiap langkah menyatakan apa yang perlu diklik dan apa yang perlu ditunjukkan.",
    can: [
      "Jalankan keseluruhan demo dalam kira-kira setengah jam dengan satu akaun pemilik dan satu akaun kakitangan.",
      "Cari dalam setiap fail yang dimuat naik, perkataan demi perkataan, dengan cadangan semasa menaip: frasa, amaun seperti RM700 atau nombor rujukan.",
      "Tunjukkan empat aliran kerja yang dibina daripada prosedur syarikat yang dimuat naik, setiap satu berakhir dengan dokumen yang disemak oleh seseorang.",
      "Tunjukkan langkah berisiko yang berhenti dan menunggu di **Kelulusan**: menghantar ke luar, menandatangani, pembayaran dan penghantaran di portal.",
      "Akhiri di **Dokumen** dan **Fail syarikat** yang ditapis kepada **Dibuat oleh AI**, supaya pelanggan nampak semua hasil AI di satu tempat.",
    ],
    spots: {},
    howto: [
      {
        title: "Sebelum demo: sediakan syarikat",
        steps: [
          s("Log masuk sebagai pemilik. Di **Fail syarikat**, pilih syarikat dan letakkan fail zip prosedurnya: permohonan pakaian seragam dan peralatan, langkah tatatertib, peraturan pendahuluan gaji dan prosedur tender."),
          s("Apabila muat naik siap, pilih fail prosedur itu dan klik **Jadikan SOP** atau **Bina aliran kerja**. Semak setiap draf dan simpan."),
          s("Isi **Kit syarikat** (nama berdaftar, nombor pendaftaran, alamat, penandatangan, terma bayaran) supaya surat dan pesanan dicetak dengan kepala surat. Tetapkan **Bahasa dokumen** kepada Bahasa Melayu bagi syarikat berbahasa Melayu: sebut harga, invois dan folder AI syarikat itu kemudiannya dalam bahasa Melayu."),
          s("Tambah seorang kakitangan dengan peranan kakitangan di Ahli, dan simpan butiran log masuknya untuk demo."),
        ],
      },
      {
        title: "1. Kakitangan mengambil pekerja AI mereka",
        steps: [
          s("Log masuk sebagai kakitangan itu. Langkah pengambilan terbuka dengan sendiri; jika tidak, klik **Mulakan** di **Pekerja AI saya**."),
          s("Beri pekerja itu nama dan jawatan, contohnya pembantu HR di syarikat keselamatan anda, dan tandakan perkara yang mesti ia tanya dahulu."),
          s("Di bawah **Kerjanya**, tambah tugas harian, contohnya menyemak permohonan cuti baharu setiap pagi."),
          s("Di bawah **Waktu bekerja**, pilih **Minggu pejabat**. Kerja yang diberi selepas waktu kerja akan menunggu syif seterusnya."),
          s("Baca surat tawaran dan klik **Ambil bekerja**."),
        ],
      },
      {
        title: "1b. Tunjukkan meja kerja kakitangan itu sendiri",
        steps: [
          s("Selepas mengambil pekerja AI, kakitangan itu masuk ke **Meja kerja saya**: meja mereka, dengan pekerja AI, prosedur dan kerja mereka."),
          s("Taip soalan dalam **Tanya atau cari**, contohnya peraturan advance, dan klik **Cari**: halaman yang sepadan muncul serta-merta."),
          s("Kemudian klik **Minta** bersama nama pekerja AI dan pilih **Jawab dan sediakan dokumen**. Jawapan dan dokumen itu masuk ke **Kerja saya** dan **Fail meja kerja saya**."),
          s("Semat SOP dan aliran kerja yang mereka guna setiap hari, dan jalankan aliran kerja semula dari **Disemat**."),
        ],
      },
      {
        title: "2. Beri tugasan berdasarkan SOP",
        steps: [
          s("Di **Pekerja AI saya**, klik **Beri tugasan**."),
          s("Tulis permintaan dan sebut SOP yang perlu diikuti, contohnya: sediakan sebut harga kawalan keselamatan dua sekolah untuk 12 bulan, dengan kadar syarikat, ikut SOP sebut harga."),
          s("Buka tugasan itu di **Tugasan** dan tunjukkan garis masanya: SOP yang dibaca, fail yang dibuka dan apa yang sedang dibuat."),
          s("Sebut harga itu dibuat daripada templat syarikat, dengan kepala suratnya. Ia disimpan di **Dokumen**, dan PDFnya di **Fail syarikat** di bawah Dokumen AI, bertanda **Dibuat oleh AI**."),
          s("Apabila siap, hasilnya menunggu semakan. Klik **Terima**, atau **Hantar semula** dengan nota untuk menunjukkan ejen membetulkan kerjanya sendiri."),
        ],
      },
      {
        title: "2b. Cari apa sahaja dalam dokumen syarikat",
        steps: [
          s("Klik kotak carian di bahagian atas mana-mana halaman, atau tekan **/**."),
          s("Taip huruf awal sesuatu perkataan, contohnya kelay. Cadangan muncul semasa anda menaip: perkataan penuh daripada dokumen, tajuk fail dan tajuk dalam fail."),
          s("Cari amaun seperti RM700, nombor rujukan seperti nombor tender atau PO, atau frasa dalam tanda petik. Hasil menunjukkan halaman PDF tempat ia dijumpai."),
          s("Klik satu hasil: fail dibuka pada halaman itu dengan perkataan diserlahkan. Tapis mengikut syarikat, jenis, jabatan atau **Dibuat atau dimuat naik**."),
          s("Tunjukkan bahawa ejen mencari dengan cara yang sama dan menyebut fail serta halaman yang digunakan. Kakitangan hanya menjumpai apa yang syarikat dan peranan mereka boleh buka."),
        ],
      },
      {
        title: "3a. Permohonan pakaian seragam atau peralatan, berakhir dengan pesanan belian",
        steps: [
          s("Buka **Aliran kerja**, pilih aliran kerja permohonan pakaian seragam yang dibina daripada prosedur syarikat dan klik **Jalankan**."),
          s("Taip permohonan itu (siapa perlukan apa, saiz dan kuantiti) dan klik **Mula**."),
          s("Larian berhenti di tempat prosedur memerlukan seseorang: keputusan pengurus sebelum sebarang pesanan dibuat. Tunjukkan di bawah **Perlukan anda**, kemudian luluskan."),
          s("Ejen menyemak permohonan berpandukan prosedur dan menyediakan draf pesanan belian daripada templat syarikat. PDFnya masuk ke fail syarikat di bawah Dokumen AI."),
          s("Apabila barang sampai, seseorang merekodkan apa yang diterima dan larian ditutup."),
        ],
      },
      {
        title: "3b. Kes tatatertib, berakhir dengan surat amaran",
        steps: [
          s("Jalankan aliran kerja tatatertib dengan butiran kes: kakitangan terlibat, apa yang berlaku, tarikh dan amaran sebelum ini jika ada."),
          s("Ejen mengikut langkah tatatertib syarikat, membaca rekod yang diberi dan menyediakan draf surat amaran dalam bahasa syarikat."),
          s("Tekankan bahawa surat itu menunggu seseorang. Tiada siapa menandatangani atau menghantarnya sehingga ia diluluskan."),
        ],
      },
      {
        title: "3c. Pendahuluan gaji bulanan",
        steps: [
          s("Jalankan aliran kerja pendahuluan gaji dengan bulan berkenaan dan kehadiran separuh bulan pertama."),
          s("Ejen mengira berapa yang boleh diterima setiap orang mengikut peraturan syarikat, seperti hari bekerja dan had pendahuluan, dan menunjukkan pengiraannya dalam laporan."),
          s("Seseorang memasukkan jumlah yang diluluskan ke dalam sistem gaji. Ejen tidak pernah membuat bayaran sendiri."),
          s("Larian menunggu orang itu mengesahkan kerja itu selesai sebelum ia ditutup."),
        ],
      },
      {
        title: "3d. Tender, daripada notis hingga senarai semak penyerahan",
        steps: [
          s("Jalankan aliran kerja tender dengan notis tender: muat naik notis itu atau tampal butirannya."),
          s("Ejen membaca notis, mencatat tarikh tutup dan taklimat wajib jika ada, dan memberitahu pasukan apa yang perlu disediakan."),
          s("Mereka menyediakan draf makluman taklimat dan surat kepada bank untuk meminta salinan diakui sah (CTC) penyata bank."),
          s("Penyerahan di portal tender sentiasa dibuat oleh pegawai yang diberi kuasa. Larian menunggu mereka mengesahkan ia sudah diserahkan."),
        ],
      },
      {
        title: "4. Di mana kelulusan muncul dan cara meluluskannya",
        steps: [
          s("Apa-apa yang berisiko akan berhenti dan bertanya dahulu: e-mel atau WhatsApp kepada orang luar syarikat, menandatangani, pembayaran dan penghantaran di portal."),
          s("Permintaan itu muncul di **Kelulusan**, dan sebagai pemberitahuan telefon jika saluran sudah disediakan, bersama nama ejen, tindakannya dan sebabnya."),
          s("Klik **Luluskan sekali** untuk membenarkannya kali ini sahaja, atau **Tolak** dengan sebab yang akan dibaca oleh ejen."),
          s("Setiap keputusan disimpan dalam **Sejarah** dan log aktiviti, bersama siapa yang memutuskan dan bila."),
        ],
      },
      {
        title: "5. Cari hasil kerja AI dan semak",
        steps: [
          s("Di halaman utama, satu kad menunjukkan berapa dokumen yang disediakan AI minggu ini dan berapa yang menunggu semakan. Klik **Semak sekarang**."),
          s("Di **Dokumen**, buka **Semak hasil AI**. Setiap baris menunjukkan ejen, tugasan atau aliran kerja asalnya, serta **Luluskan**, **Hantar semula** dan **Buka**."),
          s("Hantar semula satu dokumen dengan nota dan tunjukkan ejen membetulkannya. Ia kembali ke senarai yang sama apabila siap."),
          s("Di **Fail syarikat**, pilih **Dibuat oleh AI** dan pilih ejen. Pesanan belian, surat amaran, laporan gaji dan surat tender semuanya ada di situ, masing-masing dengan tugasan dan status semakannya."),
          s("Tukar penapis kepada **Dimuat naik** untuk menunjukkan fail syarikat sendiri, iaitu prosedur dan borang yang dirujuk oleh ejen."),
        ],
      },
    ],
    tips: [
      "Gunakan nama kakitangan dan angka rekaan dalam demo. Jangan sekali-kali tunjukkan kes atau gaji pekerja sebenar.",
      "Jalankan setiap aliran kerja sekali sebelum mesyuarat supaya anda tahu berapa lama ia ambil dengan penyedia AI anda.",
      "Folder AI mengikut bahasa syarikat: AI documents dalam bahasa Inggeris, Dokumen AI dalam bahasa Melayu. Versi baharu sesuatu dokumen menggantikan failnya; Dokumen menyimpan setiap versi.",
    ],
    who: "Pemilik dan pengurus yang menunjukkan sistem ini kepada pelanggan. Dua bahagian pertama memerlukan akaun kakitangan.",
    related: ["workspace", "my-worker", "tasks", "workflows", "approvals", "documents", "files"],
  },

};

/** Captions for the recorded flows, in Malay. */
export const FLOW_DOCS_MS: Record<string, FlowDoc> = {
  "create-agent": {
    summary: "Bina ejen daripada templat, letakkan dalam jabatan, tetapkan apa yang boleh dibuatnya dan cipta ejen itu.",
    steps: [
      "Buka Ejen dan klik Ejen baharu.",
      "Pilih templat, kemudian syarikat dan jabatan.",
      "Beri nama, jawatan dan cara ia bekerja.",
      "Pilih SOP dan tetapkan setiap alat kepada Benarkan, Tanya saya atau Jangan.",
      "Semak apa yang akan diberitahu kepadanya dan klik Cipta ejen.",
    ],
  },
  "give-task": {
    summary: "Beri ejen tugasan, lihat ia merancang dan bekerja, kemudian terima hasilnya.",
    steps: [
      "Buka Tugasan dan klik Tugasan baharu.",
      "Tulis tajuk dan penerangan, dan pilih ejen.",
      "Klik Cipta dan mula: kad berpindah ke Berjalan.",
      "Buka kad untuk mengikuti pelan dan semakan kendiri.",
      "Apabila kad sampai ke Semakan, baca hasilnya dan klik Terima.",
    ],
  },
  approve: {
    summary: "Ejen bertanya dahulu sebelum membuat sesuatu yang penting. Anda putuskan dengan satu klik.",
    steps: [
      "Buka Kelulusan: kad menunjukkan siapa bertanya, untuk apa dan mengapa.",
      "Klik Lulus sekali, Sentiasa benarkan, atau Tolak dengan sebab.",
      "Ejen meneruskan kerja, atau berhenti dan membaca sebab anda.",
    ],
  },
  "add-company": {
    summary: "Tambah syarikat berserta industrinya, dan pasukan AI siap sedia akan menyertainya.",
    steps: [
      "Buka Organisasi dan klik Cawangan baharu.",
      "Taip nama syarikat dan pilih industri.",
      "Biarkan Tambah pasukan AI siap sedia dihidupkan dan semak siapa yang menyertai.",
      "Klik Cipta cawangan: jabatan dan ejen akan muncul.",
    ],
  },
  "hire-worker": {
    summary: "Kakitangan mengambil pekerja AI sendiri dalam lima langkah ringkas.",
    steps: [
      "Pilih syarikat dan jabatan anda.",
      "Namakan pekerja anda dan terangkan cara ia patut bekerja.",
      "Beri tugas rutin dan tugasan pertama, jika mahu.",
      "Tetapkan waktu bekerja dan waktu rehatnya.",
      "Baca surat tawaran dan ambil ia bekerja.",
    ],
  },
  "phone-tour": {
    summary: "Seluruh pejabat muat dalam poket anda: bar tab, kelulusan dan menu Lagi di telefon.",
    steps: [
      "Bar di bawah ada Pejabat, Tugasan, Kelulusan dan Sembang.",
      "Kelulusan menunjukkan lencana apabila ada sesuatu menunggu anda.",
      "Lagi membuka semua halaman lain, dengan Bantuan di bahagian atas.",
    ],
  },
};

/** The capture's chapter labels (manifest.json videos[*].chapters), English -> Malay.
 * The videos are recorded in English; the guide shows these words beside them. */
export const FLOW_CHAPTERS_MS: Record<string, string> = {
  "Agents: your AI team, by department": "Ejen: pasukan AI anda, ikut jabatan",
  "Pick a starting point": "Pilih titik permulaan",
  "Choose its company and department": "Pilih syarikat dan jabatannya",
  "Give it a name and a job title": "Beri nama dan jawatan",
  "SOPs it follows": "SOP yang diikutinya",
  "What it may do, and what it must ask first": "Apa yang boleh dibuatnya, dan apa yang mesti ditanya dahulu",
  "Review and create": "Semak dan cipta",
  "The new agent joins the team": "Ejen baharu menyertai pasukan",
  "The task board": "Papan tugasan",
  "Say what you need": "Nyatakan apa yang anda perlukan",
  "Pick the agent": "Pilih ejen",
  "Create and start": "Cipta dan mula",
  "Follow the plan, live": "Ikuti pelan secara langsung",
  "The result waits for your review": "Hasil menunggu semakan anda",
  "Accept it": "Terima hasilnya",
  "Decisions waiting for you": "Keputusan yang menunggu anda",
  "Read what the agent wants to do, and why": "Baca apa yang ejen mahu buat, dan sebabnya",
  "Approve once": "Lulus sekali",
  "History keeps every decision": "Sejarah menyimpan setiap keputusan",
  "The agent carries on and hands in the result": "Ejen meneruskan kerja dan menyerahkan hasilnya",
  "Your companies": "Syarikat anda",
  "Name the company": "Namakan syarikat",
  "Pick its industry: the AI team to match": "Pilih industrinya: pasukan AI yang sepadan",
  "Create it": "Cipta",
  "Its AI team is ready, desk by desk": "Pasukan AI sudah sedia di meja masing-masing",
  "Where you work (set by your manager)": "Tempat anda bekerja (ditetapkan oleh pengurus)",
  "Meet your AI worker": "Kenali pekerja AI anda",
  "Give it a job": "Beri kerja kepadanya",
  "When it works and rests": "Bila ia bekerja dan berehat",
  "The offer: check and hire": "Tawaran: semak dan ambil bekerja",
  "Its first day: working on your task": "Hari pertamanya: mengusahakan tugasan anda",
  "Command center: how the office is doing": "Pusat arahan: keadaan pejabat",
  "Approvals: decide from your phone": "Kelulusan: buat keputusan dari telefon",
  "Tasks: the board, one column at a time": "Tugasan: papan, satu lajur pada satu masa",
  "Office floor: who is working": "Ruang pejabat: siapa yang sedang bekerja",
  "Everything else is under More": "Yang lain ada di bawah Lagi",
};

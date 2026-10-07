/** Bahasa Melayu twin of slides.ts: the same slides, kinds, icons, shots, phones, videos and
 * order; only the words change. Written for a Malaysian SME boardroom: plain business Malay,
 * estimates called estimates, no promises of 100% or of replacing staff.
 * content-parity.test.ts checks the structure against the English. */
import type { Slide } from "./slides";

export const SLIDES_MS: Slide[] = [
  {
    id: "title",
    kind: "title",
    eyebrow: "Agentic Office",
    title: "Pejabat AI untuk syarikat anda, dikawal oleh orang anda sendiri",
    lead: "Ejen AI di setiap jabatan merancang, membuat dan menyemak kerja rutin. Orang anda meluluskan perkara yang penting.",
    shot: "office",
    phone: "home",
    notes:
      "Selamat datang. Dalam lima belas minit ini, saya akan tunjukkan sebuah pejabat di mana ejen AI membuat kerja rutin setiap jabatan: mendraf, menyusuli, menyemak dan menyediakan laporan. Yang paling penting, orang anda tetap memegang kawalan. Tiada perkara penting berlaku tanpa kelulusan seseorang.",
  },
  {
    id: "problem",
    kind: "points",
    eyebrow: "Masalahnya",
    title: "Kerja pejabat semakin bertimbun",
    lead: "Orang yang mahir menghabiskan masa dengan kerja yang wajib dibuat, tetapi tidak memerlukan pertimbangan mereka.",
    points: [
      { icon: "files", title: "Dokumen", body: "Sebut harga, invois dan surat ditaip semula daripada fakta syarikat yang sama." },
      { icon: "package", title: "Serahan", body: "Pek tender: mengejar sijil, menyemak tarikh luput, menyusun PDF." },
      { icon: "chart", title: "Laporan", body: "Angka mingguan yang tiada siapa sempat kumpulkan." },
      { icon: "envelope", title: "Susulan", body: "E-mel untuk dibalas, orang untuk dikejar, peringatan untuk dihantar." },
      { icon: "book", title: "Ilmu kerja", body: "Prosedur yang hanya ada dalam kepala seorang, atau dalam fail yang tiada siapa buka." },
      { icon: "clock", title: "Menunggu", body: "Kerja tergendala kerana satu-satunya orang yang tahu sedang sibuk atau bercuti." },
    ],
    notes:
      "Tanya hadirin: berapa banyak masa pasukan anda seminggu habis untuk kerja seperti ini? Kebanyakan pejabat akan kata, banyak. Kerja ini perlu, tetapi bukan di sinilah orang anda memberi nilai paling besar.",
  },
  {
    id: "idea",
    kind: "points",
    eyebrow: "Ideanya",
    title: "Pejabat AI: ejen yang bekerja seperti kakitangan",
    lead: "Setiap jabatan ada ejen AI dengan jawatan, pengurus, prosedur bertulis dan bajet. Keputusan tetap di tangan orang.",
    points: [
      { icon: "buildings", title: "Satu pejabat bagi setiap syarikat", body: "Setiap syarikat ada jabatannya, dan setiap jabatan ada ejennya." },
      { icon: "robot", title: "Ejen bekerja seperti kakitangan", body: "Ada jawatan, SOP untuk diikuti, alat yang boleh digunakan, waktu bekerja dan bajet." },
      { icon: "hand", title: "Kawalan kekal pada orang", body: "Ejen bertanya dahulu sebelum apa-apa yang penting. Anda luluskan sekali, sentiasa, atau tolak." },
    ],
    notes:
      "Bayangkan anda mengambil satu pasukan yang tidak pernah jemu dengan kerja rutin, tetapi sentiasa bertanya dahulu sebelum membelanjakan wang, menghantar apa-apa kepada pelanggan atau membuat sebarang serahan.",
  },
  {
    id: "flow",
    kind: "flow",
    eyebrow: "Perjalanan sesuatu tugasan",
    title: "Daripada permintaan kepada hasil yang diluluskan",
    points: [
      { icon: "list", title: "Anda beri tugasan", body: "Satu komposer di mana-mana: nyatakan apa yang anda perlukan, atau pilih kajian web, laman web atau aliran kerja." },
      { icon: "lightning", title: "Ejen merancang", body: "Ia memecahkan kerja kepada langkah, mengikut SOP anda." },
      { icon: "tools", title: "Ia bekerja dengan alat", body: "Fail, dokumen, web, rakan sekerja dan pengiraan." },
      { icon: "check", title: "Ia menyemak sendiri", body: "Model kedua membaca kerja itu dan membandingkannya dengan permintaan." },
      { icon: "seal", title: "Orang meluluskan", body: "Anda terima hasilnya, atau hantar semula dengan komen." },
    ],
    shot: "tasks:sheet",
    video: "give-task",
    notes:
      "Inilah terasnya. Anda beri kerja melalui satu komposer, dari mana-mana sahaja dalam aplikasi. Setiap tugasan kemudian ada pelan yang boleh dilihat, garis masa apa yang dibuat oleh ejen, dan semakan kendiri sebelum kerja sampai kepada anda. Jika semakan kendiri menemui kekurangan, ejen membaikinya sekali sebelum anda melihatnya.",
  },
  {
    id: "live",
    kind: "feature",
    eyebrow: "Pejabat langsung dan pemantauan",
    title: "Lihat pasukan AI anda bekerja",
    lead: "Pejabat langsung bagi setiap syarikat, dan paparan pantau yang menunjukkan setiap langkah ejen.",
    bullets: [
      "Setiap ejen di mejanya: bekerja, menunggu anda, dalam mesyuarat atau tersekat",
      "Perhatikan skrin dan langkah mana-mana ejen secara langsung",
      "Agihkan kerja baharu dengan menyeretnya ke atas ejen",
    ],
    shot: "office",
    phone: "monitor",
    notes:
      "Tiada apa yang tersembunyi. Anda boleh lihat siapa membuat apa, dan ikuti mana-mana ejen langkah demi langkah: setiap alat yang digunakan dan setiap soalan yang ditanya kepada rakan sekerja.",
  },
  {
    id: "work",
    kind: "feature",
    eyebrow: "Beri kerja, kemudian putuskan",
    title: "Satu cara beri kerja, satu tempat buat keputusan",
    lead: "Satu butang \"Beri tugasan\", dari pengepala, seorang ejen, pejabat atau sembang. Papan menjejaki setiap tugasan; satu senarai memegang keputusan.",
    bullets: [
      "Empat jenis dalam satu komposer: tugasan am, kaji web, layari laman web, atau ikut aliran kerja",
      "Pilih Sekarang, atau Ulang untuk menjadualkan kerja itu",
      "Papan dari Saringan hingga Selesai; lulus sekali, sentiasa, atau tolak dengan sebab",
      "Buat keputusan daripada pemberitahuan telefon, dengan satu ketikan",
    ],
    shot: "tasks",
    phone: "approvals",
    video: "approve",
    notes:
      "Semua orang memberi kerja dengan cara yang sama, jadi tiada apa yang baharu untuk dipelajari bagi setiap tugasan. Melayari laman web, kajian web dan mengikut aliran kerja hanyalah satu pilihan dalam komposer. Senarai kelulusan ialah satu-satunya tempat ejen menunggu orang, dan ia berfungsi daripada pemberitahuan telefon.",
  },
  {
    id: "documents",
    kind: "feature",
    eyebrow: "Dokumen dan pek serahan",
    title: "Dokumen didraf, disemak dan disusun",
    lead: "Fakta syarikat dimasukkan sekali sahaja. Sebut harga, surat dan pek serahan dibina daripadanya, disemak secara automatik, dan disimpan dalam Perpustakaan anda.",
    bullets: [
      "Templat dengan kepala surat anda, atau fail Word anda sendiri",
      "Semakan automatik menanda kekurangan sebelum sesiapa meluluskan",
      "Pek serahan dipadankan dengan fail sebenar dan disusun menjadi satu PDF",
    ],
    shot: "documents:editor",
    phone: "packs",
    note: "Pejabat yang menyediakan; orang yang menyemak dan menyerahkan.",
    notes:
      "AI hanya mendraf daripada apa yang anda tulis dan fail yang anda lampirkan; ia tidak mereka fakta. Sijil yang tamat tempoh ditanda dalam senarai semak pek sebelum menjadi masalah, dan segala yang dibuatnya masuk ke dalam satu Perpustakaan.",
  },
  {
    id: "knowledge",
    kind: "feature",
    eyebrow: "Satu Perpustakaan",
    title: "Setiap fail, SOP dan garis panduan di satu tempat",
    lead: "Satu Perpustakaan menyimpan fail, dokumen, templat, SOP dan garis panduan anda, dalam folder. Ejen mencarinya apabila kerja memerlukannya, mengikut SOP anda, dan memetik halamannya.",
    bullets: [
      "Semak imbas folder syarikat, atau buka Dokumen, SOP, Garis panduan, Templat dan Pek sebagai tab",
      "SOP untuk semua syarikat, satu syarikat atau satu jabatan, diikuti mulai langkah seterusnya",
      "Setiap jawapan merujuk kembali kepada fail dan halaman sumbernya",
    ],
    shot: "files",
    phone: "sops",
    notes:
      "Beginilah pejabat mengekalkan cara kerja anda, semuanya di satu tempat. Lepaskan satu folder penuh atau zip, dan ia dibaca, disusun dan difailkan. Ubah satu SOP, dan setiap ejen dalam skopnya mengikut versi baharu mulai langkah seterusnya.",
  },
  {
    id: "workflows",
    kind: "feature",
    eyebrow: "Aliran kerja dan jadual",
    title: "Kerja dipetakan, siap ikut jadual",
    lead: "Lukis cara sesuatu kerja dibuat, biar AI mendrafnya daripada satu ayat, atau bina daripada tugasan yang sudah anda jalankan. Jalankannya terus, atau jadualkan kerja berulang.",
    bullets: [
      "12 templat sedia: pertanyaan ke sebut harga, cuti, tutup akaun hujung bulan",
      "Langkah kelulusan di mana-mana yang melibatkan wang atau pelanggan",
      "Jadikan tugasan yang selesai satu aliran kerja; jadualkan larian berulang dengan cubaan semula dan rekod",
    ],
    shot: "workflows:editor",
    phone: "schedules",
    notes:
      "Dengan aliran kerja, kerja pejabat menjadi satu proses: setiap langkah pergi kepada ejen yang betul, dan larian berhenti untuk seseorang tepat di tempat anda meletakkan kelulusan. Pernah buat sesuatu dengan baik? Jadikan tugasan itu satu aliran kerja dan guna semula.",
  },
  {
    id: "learning",
    kind: "feature",
    eyebrow: "Pembelajaran",
    title: "Ia bertambah baik, dan anda nampak caranya",
    lead: "Ejen mencadangkan kemahiran daripada kerja mereka. Setiap perubahan diuji sebelum diaktifkan, dan anda tentukan berapa banyak yang automatik.",
    bullets: [
      "Kemahiran dengan ujian, versi dan imbasan keselamatan",
      "Tambah baik dengan AI: mencuba versi yang lebih baik dan menyimpan yang terbaik",
      "Autopilot, daripada 'semak semua' hingga 'perubahan terbukti terus aktif'",
    ],
    shot: "skills:sheet",
    phone: "learning",
    notes:
      "Cara ejen bekerja tidak berubah selagi perubahan itu belum lulus ujian, dan secara lalai, selagi belum diluluskan oleh seseorang. Halaman pembelajaran menunjukkan apa yang dipelajari, bagaimana ia disemak dan berapa kosnya.",
  },
  {
    id: "finance",
    kind: "points",
    eyebrow: "Kewangan dan ramalan",
    title: "Angka yang boleh anda semak sendiri",
    lead: "Untuk soalan kewangan, ejen menggunakan kalkulator dengan formula tetap, bukan meneka. Setiap jawapan menyatakan formula yang digunakan.",
    points: [
      { icon: "calculator", title: "Pengiraan kewangan", body: "Ansuran (kadar rata dan baki berkurangan), NPV, IRR, tempoh bayar balik, titik pulang modal, margin, susut nilai, pertumbuhan dan SST." },
      { icon: "trend", title: "Ramalan dengan julat", body: "Kaedah trend dan bermusim; kaedah dengan ralat lalu paling kecil dipilih, dan hasilnya disertakan julat 80%." },
      { icon: "eye", title: "Jalan kira ditunjukkan", body: "Formula dan input ada dalam jawapan, supaya pasukan kewangan anda boleh mengesahkannya." },
    ],
    note: "Ramalan ialah julat, bukan janji.",
    notes:
      "Ini penting untuk kepercayaan: apabila ejen memberitahu ansuran bulanan atau ramalan aliran tunai, kiraannya dibuat oleh kalkulator, dan jalan kiranya ditunjukkan.",
  },
  {
    id: "workers",
    kind: "feature",
    eyebrow: "AI milik semua orang",
    title: "Setiap kakitangan mendapat AI sendiri",
    lead: "Setiap orang mengambil AI sendiri, kembarnya, dalam lima langkah ringkas: kerjanya, tugas rutinnya, serta waktu ia bekerja dan berehat.",
    bullets: [
      "Satu laman, AI Saya: hari ini, sembang, tugasannya, apa yang diketahuinya dan mengajarnya",
      "Waktu bekerja dan rehat; kerja di luar waktu akan menunggu",
      "Ia bertanya kepada orangnya sebelum apa-apa yang penting, dan memberitahu orang lain bahawa ia AI",
    ],
    shot: "my-worker",
    phone: "my-worker:welcome",
    video: "hire-worker",
    notes:
      "Dengan ini, AI bukan lagi alat untuk pengurus sahaja, tetapi bantuan untuk semua orang. AI setiap orang mengendalikan kerja rutin mereka dalam waktu kerjanya sendiri, dan berada di satu laman, AI Saya, dengan tab untuk hari ini, sembang, tugasannya, apa yang diketahuinya dan mengajarnya.",
  },
  {
    id: "assistants",
    kind: "feature",
    eyebrow: "Pembantu peribadi",
    title: "Pembantu peribadi untuk orang yang mengurus",
    lead: "Pemilik, pentadbir dan pengurus turut mendapat pembantu peribadi sendiri: tanya tentang seluruh syarikat, biar ia drafkan balasan e-mel dan perubahan kalendar anda, dan susuli orang melalui WhatsApp.",
    bullets: [
      "Gmail hanya draf: anda yang baca, ubah dan hantar",
      "Perubahan kalendar menunggu pengesahan anda",
      "Taip atau bercakap; hubunginya melalui WhatsApp",
    ],
    shot: "assistants",
    phone: "assistants",
    note: "Kakitangan mendapat AI sendiri, AI Saya; pembantu adalah untuk orang yang mengurus orang lain.",
    notes:
      "Peribadi bermakna peribadi: tiada orang lain boleh melihat pembantu anda atau perbualannya. Ia tidak pernah menghantar e-mel sendiri; ia hanya menyediakan draf untuk anda. Kakitangan tidak memerlukan ini, kerana AI mereka sendiri, AI Saya, sudah bekerja untuk mereka.",
  },
  {
    id: "companies",
    kind: "feature",
    eyebrow: "Syarikat dan pasukan siap sedia",
    title: "Syarikat baharu, lengkap dengan pasukan dalam satu langkah",
    lead: "Tambah syarikat, pilih industrinya, dan pasukan AI siap sedia akan menyertainya: kewangan, jualan, operasi, HR dan khidmat pelanggan.",
    bullets: [
      "Peranan khusus industri seperti meja bantuan IT atau juruukur bahan",
      "Pengetahuan setiap syarikat boleh dikekalkan peribadi",
      "Ejen siap sedia bertanya dahulu sehingga anda menukarnya",
    ],
    shot: "organization:new",
    phone: "agents",
    video: "add-company",
    notes:
      "Bagi kumpulan yang ada beberapa syarikat, setiap syarikat mendapat pejabat, jabatan dan ejennya sendiri, dan anda boleh membandingkannya sebelah-menyebelah dalam gambaran syarikat.",
  },
  {
    id: "impact",
    kind: "feature",
    eyebrow: "Impak",
    title: "Hasil yang diukur, anggaran yang jujur",
    lead: "Lihat apa yang dibuat oleh pasukan AI bagi setiap syarikat dan jabatan. Tugasan selesai dan kosnya diukur. Masa yang dijimatkan dianggarkan daripada angka anda sendiri.",
    bullets: [
      "Diukur: tugasan selesai, tempoh kelulusan, kos AI",
      "Dianggarkan (dan dilabel): masa yang dijimatkan, nilai masa kakitangan",
      "Tetapkan andaian sendiri: minit setiap tugasan, kos sejam",
    ],
    shot: "impact",
    phone: "overview",
    note: "Anggaran ditanda (anggaran) dan menggunakan andaian yang anda masukkan.",
    notes:
      "Kami asingkan apa yang diukur daripada apa yang dianggarkan, terus di skrin. Anda yang tetapkan andaiannya, jadi pulangan atas belanja itu angka anda, bukan angka kami.",
  },
  {
    id: "safety",
    kind: "points",
    eyebrow: "Keselamatan dan kawalan",
    title: "Dibina supaya kawalan kekal pada anda",
    points: [
      { icon: "seal", title: "Kelulusan", body: "Urusan wang, mesej kepada pelanggan dan serahan menunggu seseorang." },
      { icon: "eye", title: "Log audit", body: "Setiap perubahan oleh orang dan ejen, dalam log yang menunjukkan jika ia diusik." },
      { icon: "wallet", title: "Bajet", body: "Amaran pada 80% bajet ejen; apabila mencecah had, ejen berhenti seketika dan bertanya." },
      { icon: "lock", title: "Pembantu peribadi", body: "Pembantu peribadi dan perbualannya hanya boleh dilihat oleh pemiliknya." },
      { icon: "shield", title: "Log masuk tidak didedahkan", body: "Kata laluan disulitkan, tidak pernah dihantar kepada model AI, dan hanya digunakan di laman yang disenaraikan." },
      { icon: "server", title: "Pelayan anda", body: "Berjalan di pelayan anda sendiri; hanya teks yang diperlukan oleh tugasan dihantar kepada penyedia AI pilihan anda." },
    ],
    notes:
      "Peranan menentukan siapa boleh melihat dan membuat apa, daripada pemilik hingga pemerhati. Tindakan berisiko tinggi ditanya setiap kali. Dan kerana ia berjalan di pelayan anda sendiri, fail dan sejarah anda kekal dengan anda.",
  },
  {
    id: "start",
    kind: "steps",
    eyebrow: "Bermula",
    title: "Sedia digunakan dalam tiga langkah",
    points: [
      { icon: "plug", title: "Sambungkan penyedia AI", body: "Tampal kunci. Pakej percuma pun cukup untuk bermula." },
      { icon: "buildings", title: "Tambah syarikat anda", body: "Pilih industri; pasukan AI siap sedia menyertai setiap syarikat." },
      { icon: "check", title: "Beri tugasan pertama", body: "Lihat ia merancang dan bekerja, kemudian luluskan hasilnya." },
    ],
    phone: "home",
    notes:
      "Anda boleh memberi tugasan sebenar yang pertama pada hari pertama lagi. Tutorial terbina dalam membimbing setiap peranan untuk langkah seterusnya, dan panduan pengguna menerangkan setiap skrin.",
  },
  {
    id: "closing",
    kind: "closing",
    eyebrow: "Agentic Office",
    title: "Mari sediakan jabatan AI pertama anda",
    lead: "Pilih satu jabatan dan satu kerja rutin. Kami tunjukkan hasilnya menggunakan data anda sendiri.",
    notes: "Tanya jabatan mana yang paling banyak kerja rutin, dan tawarkan untuk menyediakannya bersama. Beri masa untuk soalan.",
  },
];

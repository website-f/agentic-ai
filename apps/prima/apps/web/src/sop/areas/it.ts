import type { Sop } from '../types';

/**
 * P121: IT and systems. Filled from Fauzan's documents (docs/IT_*.md, HR_IT_INTAKE_*, ACCOUNTS_AND_ACCESS, WEBSITE_*,
 * CONNECTIONS_*, STAFF_EMAIL_POWER_BI, JA_*, HR_PHASE3) and the IT rules in packages/core/src/rules.ts (IT-WATCH, IT-BUY,
 * IT-JOBS). Standing boundaries: IT resolves and the person who asked confirms; recording a checklist or an access decision
 * never creates or removes an account; email is sent from Outlook; outside connections stay off until verified.
 */
export const SOPS_IT: Sop[] = [
  {
    id: 'it-help-request',
    app: 'it',
    title: { en: 'Ask IT for help (help request)', ms: 'Minta bantuan IT (tiket bantuan)' },
    purpose: {
      en: 'Anyone tells IT what is wrong with their account, device, Microsoft 365, the network, Prima or a system; IT answers within the target for its urgency and the person who asked confirms the fix.',
      ms: 'Sesiapa sahaja memberitahu IT masalah akaun, peranti, Microsoft 365, rangkaian, Prima atau sistem; IT membalas dalam sasaran mengikut tahap kecemasan dan orang yang meminta mengesahkan masalah selesai.',
    },
    start: { view: 'it', tab: 'mine', label: { en: 'Ask IT for help', ms: 'Minta bantuan IT' } },
    starter: {
      en: 'Any staff member. IT logs it for someone who reached IT by Teams, email, phone or in person.',
      ms: 'Mana-mana staf. IT merekodkannya bagi orang yang menghubungi IT melalui Teams, e-mel, telefon atau secara bersemuka.',
    },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Chooses what it is about and the urgency (P1 to P4), says what is wrong and adds a screenshot if useful. If the same kind of problem was sent in the last 24 hours, Prima asks “Ini masalah yang sama?” so it can be added to the open request.',
          ms: 'Pilih perkara dan tahap kecemasan (P1 hingga P4), terangkan masalah dan lampirkan tangkapan skrin jika perlu. Jika masalah yang sama dihantar dalam 24 jam lepas, Prima bertanya “Ini masalah yang sama?” supaya ia boleh ditambah pada tiket yang masih terbuka.',
        },
        where: { view: 'it', tab: 'mine', label: { en: 'IT › My requests', ms: 'IT › Permohonan saya' } },
      },
      {
        who: { en: 'IT staff', ms: 'Staf IT' },
        does: {
          en: 'Logs a request for a person who asked outside Prima (Log a request), with who asked and the channel.',
          ms: 'Merekod tiket bagi orang yang meminta di luar Prima (Log a request), dengan nama peminta dan saluran.',
        },
        where: { view: 'it', tab: 'tickets', label: { en: 'IT › Help requests', ms: 'IT › Tiket bantuan' } },
      },
      {
        who: { en: 'IT Manager or IT Lead (or the IT person who takes it)', ms: 'Pengurus IT atau Ketua IT (atau staf IT yang mengambilnya)' },
        does: {
          en: 'Gives the request to one IT person, or an IT person presses Take it. The first response is due within the target for its urgency.',
          ms: 'Memberikan tiket kepada seorang staf IT, atau staf IT menekan Take it. Respons pertama perlu dibuat dalam sasaran mengikut tahap kecemasan.',
        },
        where: { view: 'it', tab: 'tickets', label: { en: 'IT › Help requests', ms: 'IT › Tiket bantuan' } },
      },
      {
        who: { en: 'IT person', ms: 'Staf IT' },
        does: {
          en: 'Fixes it and presses Resolve with what fixed it. For P1 and security requests the root cause is also required.',
          ms: 'Menyelesaikannya dan menekan Resolve dengan apa yang dibuat. Bagi tiket P1 dan keselamatan, punca utama juga wajib diisi.',
        },
        where: { view: 'it', tab: 'tickets', label: { en: 'IT › Help requests', ms: 'IT › Tiket bantuan' } },
      },
      {
        who: { en: 'The person who asked', ms: 'Orang yang meminta' },
        does: {
          en: 'Answers “Is it fixed?”: Yes, it is fixed closes it; Not fixed (with what is still wrong) sends it back to the same IT person.',
          ms: 'Menjawab “Is it fixed?”: Yes, it is fixed menutup tiket; Not fixed (dengan apa yang masih rosak) memulangkannya kepada staf IT yang sama.',
        },
        where: { view: 'it', tab: 'mine', label: { en: 'IT › My requests', ms: 'IT › Permohonan saya' } },
        decision: true,
      },
      {
        who: { en: 'Prima, then the IT Manager', ms: 'Prima, kemudian Pengurus IT' },
        does: {
          en: 'Reminds the person on day 3 and day 5; after that the IT Manager sees it waiting for confirmation and chases. IT records a confirmation given outside Prima only with proof.',
          ms: 'Mengingatkan orang itu pada hari ke-3 dan ke-5; selepas itu Pengurus IT melihatnya “menunggu pengesahan” dan mengejar. IT merekod pengesahan yang diberi di luar Prima hanya dengan bukti.',
        },
        where: { view: 'it', tab: 'tickets', label: { en: 'IT › Help requests', ms: 'IT › Tiket bantuan' } },
      },
    ],
    rules: [
      {
        en: 'First-response targets: P1 15 minutes, P2 1 hour, P3 4 hours, P4 1 working day, in office hours (8.30 to 5.30, Monday to Friday, public holidays excluded). The time it was fixed is kept for information only.',
        ms: 'Sasaran respons pertama: P1 15 minit, P2 1 jam, P3 4 jam, P4 1 hari bekerja, dalam waktu pejabat (8.30 hingga 5.30, Isnin hingga Jumaat, tidak termasuk cuti umum). Masa selesai disimpan sebagai maklumat sahaja.',
      },
      {
        en: 'A security request starts at P1 or P2 and goes to the IT Lead; the IT Lead may lower it with a reason.',
        ms: 'Tiket keselamatan bermula pada P1 atau P2 dan terus kepada Ketua IT (IT Lead); Ketua IT boleh menurunkannya dengan sebab.',
      },
      {
        en: 'Only the person who asked closes the request. There is no automatic confirmation, and a Manager or Lead cannot confirm in their place.',
        ms: 'Hanya orang yang meminta menutup tiket. Tiada pengesahan automatik, dan Pengurus atau Ketua IT tidak boleh mengesahkan bagi pihaknya.',
      },
      {
        en: 'A request past its time limit by 24 hours goes to the COO. The IT Manager, COO and CEO see a monthly service report with numbers only, no staff ranking.',
        ms: 'Tiket yang melebihi had masa sebanyak 24 jam dinaikkan kepada COO. Pengurus IT, COO dan CEO melihat laporan perkhidmatan bulanan dalam bentuk angka sahaja, tanpa ranking staf.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 28 Oct 2026 (D1 to D5) and 13-14 Nov 2026 (Q1 to Q5, Q-X2); effective 18 Nov 2026' },
    words: 'help request tiket bantuan helpdesk ticket rosak problem masalah support sokongan p1 p2 p3 p4 confirm sahkan fixed',
  },
  {
    id: 'it-job',
    app: 'it',
    title: { en: 'An IT job: given, done with proof, checked and accepted', ms: 'Tugasan IT: diberi, disiapkan dengan bukti, disemak dan diterima' },
    purpose: {
      en: 'Every piece of IT work has one named person and a due date, and is finished only when the IT Manager accepts its proof.',
      ms: 'Setiap kerja IT ada seorang penama dan tarikh siap, dan hanya selesai apabila Pengurus IT menerima buktinya.',
    },
    start: { view: 'it', tab: 'jobs', label: { en: 'Give a job', ms: 'Beri tugasan' } },
    starter: { en: 'IT Manager or IT Lead (the CEO may also give jobs)', ms: 'Pengurus IT atau Ketua IT (CEO juga boleh memberi tugasan)' },
    steps: [
      {
        who: { en: 'IT Manager or IT Lead', ms: 'Pengurus IT atau Ketua IT' },
        does: {
          en: 'Gives the job to one IT person with a due date and priority, from Jobs or from the week, month and year Plan.',
          ms: 'Memberi tugasan kepada seorang staf IT dengan tarikh siap dan keutamaan, dari Jobs atau dari Plan mingguan, bulanan dan tahunan.',
        },
        where: { view: 'it', tab: 'jobs', label: { en: 'IT › Jobs', ms: 'IT › Tugasan' } },
      },
      {
        who: { en: 'IT person', ms: 'Staf IT' },
        does: {
          en: 'Does the work and presses Submit as done with a note and proof.',
          ms: 'Membuat kerja itu dan menekan Submit as done dengan catatan dan bukti.',
        },
        where: { view: 'it', tab: 'work', label: { en: 'IT › My work', ms: 'IT › Kerja saya' } },
      },
      {
        who: { en: 'IT Lead (technical jobs)', ms: 'Ketua IT (tugasan teknikal)' },
        does: {
          en: 'Checks a technical job first (Technical check passed). The IT Manager checks the proof of the IT Lead’s own technical jobs.',
          ms: 'Menyemak tugasan teknikal dahulu (Technical check passed). Pengurus IT menyemak bukti tugasan teknikal Ketua IT sendiri.',
        },
        where: { view: 'it', tab: 'jobs', label: { en: 'IT › Jobs', ms: 'IT › Tugasan' } },
        decision: true,
      },
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: {
          en: 'Accepts it, or returns it with a reason so the person does it again.',
          ms: 'Menerimanya, atau memulangkannya dengan sebab supaya staf itu membuatnya semula.',
        },
        where: { view: 'it', tab: 'jobs', label: { en: 'IT › Jobs', ms: 'IT › Tugasan' } },
        decision: true,
      },
      {
        who: { en: 'COO', ms: 'COO' },
        does: {
          en: 'Accepts finished work while the IT Manager is away, and may accept or return any job at any time; whoever was in charge of checking it is told.',
          ms: 'Menerima kerja yang siap semasa Pengurus IT tiada, dan boleh menerima atau memulangkan mana-mana tugasan pada bila-bila masa; orang yang sepatutnya menyemak akan dimaklumkan.',
        },
        where: { view: 'it', tab: 'team', label: { en: 'IT › Team', ms: 'IT › Pasukan' } },
      },
    ],
    rules: [
      { en: 'Nobody checks or accepts their own work.', ms: 'Tiada sesiapa menyemak atau menerima kerja sendiri.' },
      {
        en: 'A job 3 days late goes to the COO, and 7 days late to the CEO.',
        ms: 'Tugasan lewat 3 hari dinaikkan kepada COO, dan lewat 7 hari kepada CEO.',
      },
      {
        en: 'A job is finished only when submitted with proof and accepted; Submit alone is not the end.',
        ms: 'Tugasan hanya selesai apabila dihantar dengan bukti dan diterima; Submit sahaja belum selesai.',
      },
    ],
    status: 'in_force',
    source: { doc: 'packages/core/src/rules.ts', decided: 'Fauzan, 28 Oct 2026 (D1 to D5), rule IT-JOBS' },
    words: 'job tugasan kerja task proof bukti accept terima return pulang technical check plan',
  },
  {
    id: 'it-purchase',
    app: 'it',
    title: { en: 'Buy IT equipment: from request to approval', ms: 'Membeli peralatan IT: dari permohonan hingga kelulusan' },
    purpose: {
      en: 'Any department asks for IT equipment; IT assesses it, gets quotes and the COO then the CEO approve the purchase.',
      ms: 'Mana-mana jabatan memohon peralatan IT; IT menilai, mendapatkan sebut harga, kemudian COO dan CEO meluluskan pembelian.',
    },
    start: { view: 'it', tab: 'policy', label: { en: 'Mohon peralatan IT', ms: 'Mohon peralatan IT' } },
    starter: {
      en: 'Any staff member (Mohon peralatan IT); an IT Executive can also start one directly with Ask to buy.',
      ms: 'Mana-mana staf (Mohon peralatan IT); Eksekutif IT juga boleh memulakannya terus dengan Ask to buy.',
    },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: { en: 'Asks for the equipment and says why it is needed.', ms: 'Memohon peralatan dan menyatakan sebab ia diperlukan.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Turns the request into an IT purchase (Jadikan pembelian IT), or declines it with a reason the person can see.',
          ms: 'Menjadikan permohonan itu pembelian IT (Jadikan pembelian IT), atau menolaknya dengan sebab yang boleh dilihat oleh pemohon.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: {
          en: 'Agrees the need, or rejects it with a reason (the COO decides when the IT Manager is the one asking).',
          ms: 'Bersetuju dengan keperluan, atau menolaknya dengan sebab (COO memutuskan jika Pengurus IT sendiri yang memohon).',
        },
        where: { view: 'it', tab: 'purchases', label: { en: 'IT › Purchases', ms: 'IT › Pembelian' } },
        decision: true,
      },
      {
        who: { en: 'IT Lead or IT Executive', ms: 'Ketua IT atau Eksekutif IT' },
        does: {
          en: 'Records the technical assessment (spare stock is shown; buying anyway needs a reason), then three supplier quotes and one evidenced online price, and recommends a supplier.',
          ms: 'Merekod penilaian teknikal (stok simpanan dipaparkan; tetap membeli perlu sebab), kemudian tiga sebut harga pembekal dan satu harga dalam talian berbukti, dan mencadangkan pembekal.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Pembelian IT', ms: 'IT › Polisi IT › Pembelian IT' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: {
          en: 'Records the budget check (a record, not an approval). A missing check is flagged.',
          ms: 'Merekod semakan bajet (rekod sahaja, bukan kelulusan). Semakan yang tiada akan ditanda.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Pembelian IT', ms: 'IT › Polisi IT › Pembelian IT' } },
      },
      {
        who: { en: 'COO, then CEO', ms: 'COO, kemudian CEO' },
        does: {
          en: 'Each approves or rejects with a reason. After the CEO the purchase goes to IT purchase fulfilment.',
          ms: 'Masing-masing meluluskan atau menolak dengan sebab. Selepas CEO, pembelian diteruskan ke IT purchase fulfilment.',
        },
        where: { view: 'it', tab: 'purchases', label: { en: 'IT › Purchases', ms: 'IT › Pembelian' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Three quotes from different suppliers plus one evidenced online comparison (rule IT-BUY). Expired quotes are flagged.',
        ms: 'Tiga sebut harga daripada pembekal berbeza dan satu perbandingan dalam talian berbukti (peraturan IT-BUY). Sebut harga yang tamat tempoh ditanda.',
      },
      {
        en: 'Stage time frames are late flags, never blocks: review 1, assessment 2, approvals with budget and PO 2 working days. The IT Manager may change them with a reason.',
        ms: 'Tempoh setiap peringkat hanya tanda lewat, bukan sekatan: semakan 1, penilaian 2, kelulusan bersama bajet dan PO 2 hari bekerja. Pengurus IT boleh mengubahnya dengan sebab.',
      },
      {
        en: 'Paying before delivery (when the chosen supplier requires it) is approved with the purchase and flagged when not delivered after the quoted lead time.',
        ms: 'Bayaran sebelum penghantaran (jika pembekal yang dipilih memerlukannya) diluluskan bersama pembelian dan ditanda jika belum dihantar selepas tempoh yang disebut.',
      },
      {
        en: 'Purchase documents are kept at least 5 years. An IT equipment claim with no approved IT PO cannot be approved.',
        ms: 'Dokumen pembelian disimpan sekurang-kurangnya 5 tahun. Tuntutan peralatan IT tanpa PO IT yang diluluskan tidak boleh diluluskan.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 13-14 Nov 2026 (Q6 to Q9, Q13, Q14, Q-X3, Q-X4b) and Part V V-X6' },
    words: 'buy beli purchase pembelian equipment peralatan laptop computer komputer quote sebut harga coo ceo approval kelulusan budget bajet',
  },
  {
    id: 'it-purchase-fulfilment',
    app: 'it',
    title: { en: 'IT purchase fulfilment: PO, delivery, invoice and payment', ms: 'Pelaksanaan pembelian IT: PO, penghantaran, invois dan bayaran' },
    purpose: {
      en: 'After the CEO approves, Finance issues the PO, IT receives and inspects what actually arrived, Finance matches the invoice and records the payment reference.',
      ms: 'Selepas CEO meluluskan, Kewangan mengeluarkan PO, IT menerima dan memeriksa barang yang benar-benar sampai, Kewangan memadankan invois dan merekod rujukan bayaran.',
    },
    start: { view: 'it-procurement', label: { en: 'Open IT purchase fulfilment', ms: 'Buka IT purchase fulfilment' } },
    starter: { en: 'The Finance team chosen to handle Merdeka IT purchases', ms: 'Pasukan Kewangan yang dipilih untuk mengurus pembelian IT Merdeka' },
    steps: [
      {
        who: { en: 'Finance (IT purchases team)', ms: 'Kewangan (pasukan pembelian IT)' },
        does: {
          en: 'Checks the exact approved supplier, quantities and prices and records the PO with its actual issue date and evidence.',
          ms: 'Menyemak pembekal, kuantiti dan harga yang diluluskan dan merekod PO dengan tarikh keluaran sebenar dan bukti.',
        },
        where: { view: 'it-procurement', label: { en: 'IT purchase fulfilment', ms: 'IT purchase fulfilment' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records each actual delivery and where the stock is. A part delivery stays “partially received”.',
          ms: 'Merekod setiap penghantaran sebenar dan lokasi stok. Penghantaran separa kekal “partially received”.',
        },
        where: { view: 'it-procurement', label: { en: 'IT purchase fulfilment', ms: 'IT purchase fulfilment' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Receives and inspects (GRN): packaging, specification, damage, function test, accessories. A “no” is a mismatch; failed units stay in quarantine until released with a reason.',
          ms: 'Menerima dan memeriksa (GRN): pembungkusan, spesifikasi, kerosakan, ujian fungsi, aksesori. Jawapan “tidak” ialah ketidakpadanan; unit yang gagal kekal dalam kuarantin sehingga dilepaskan dengan sebab.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Pembelian IT', ms: 'IT › Polisi IT › Pembelian IT' } },
      },
      {
        who: { en: 'Finance (IT purchases team)', ms: 'Kewangan (pasukan pembelian IT)' },
        does: {
          en: 'Checks the supplier invoice against what was ordered and received. A mismatch is kept; a later delivery does not turn an old check into a match.',
          ms: 'Menyemak invois pembekal dengan apa yang dipesan dan diterima. Ketidakpadanan disimpan; penghantaran kemudian tidak menukar semakan lama menjadi padan.',
        },
        where: { view: 'it-procurement', label: { en: 'IT purchase fulfilment', ms: 'IT purchase fulfilment' } },
        decision: true,
      },
      {
        who: { en: 'Finance (IT purchases team)', ms: 'Kewangan (pasukan pembelian IT)' },
        does: {
          en: 'Records the payment reference for the unpaid balance, only after full receipt and the latest exact match. The bank payment itself is made outside Prima.',
          ms: 'Merekod rujukan bayaran bagi baki belum dibayar, hanya selepas barang diterima penuh dan semakan terkini padan. Bayaran bank dibuat di luar Prima.',
        },
        where: { view: 'it-procurement', label: { en: 'IT purchase fulfilment', ms: 'IT purchase fulfilment' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records the register details of each new device (label, serial, purchase details, custodian, location) before handing it over.',
          ms: 'Merekod butiran daftar setiap peranti baharu (label, nombor siri, butiran pembelian, penjaga, lokasi) sebelum diserahkan.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Butiran daftar aset', ms: 'IT › Polisi IT › Butiran daftar aset' } },
      },
    ],
    rules: [
      {
        en: 'For Merdeka purchases only. Without the Finance team mapping the screen shows setup required.',
        ms: 'Untuk pembelian Merdeka sahaja. Tanpa pemetaan pasukan Kewangan, skrin menunjukkan setup required.',
      },
      {
        en: 'Prima records evidence only: no bank transfer, supplier email or payment is made from Prima.',
        ms: 'Prima merekod bukti sahaja: tiada pindahan bank, e-mel pembekal atau bayaran dibuat dari Prima.',
      },
      {
        en: 'Old paid or received records stay read-only as “legacy unverified”; no PO, invoice or payment evidence is made up for them.',
        ms: 'Rekod lama yang sudah dibayar atau diterima kekal baca sahaja sebagai “legacy unverified”; tiada bukti PO, invois atau bayaran direka untuknya.',
      },
      {
        en: 'Receive and inspect by the next working day after delivery; register and label within 1 working day each (late flags).',
        ms: 'Terima dan periksa pada hari bekerja berikutnya selepas penghantaran; daftar dan label dalam 1 hari bekerja setiap satu (tanda lewat).',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_PROCUREMENT_RECONSTRUCTED.md', decided: 'Fauzan, 13-14 Nov 2026 (Q10, Q11) and Part V V-X6' },
    words: 'po purchase order pesanan belian grn delivery penghantaran invoice invois payment bayaran receive terima quarantine kuarantin',
  },
  {
    id: 'it-purchase-advance',
    app: 'it',
    title: { en: 'Advance payment to a supplier (exception)', ms: 'Bayaran pendahuluan kepada pembekal (pengecualian)' },
    purpose: {
      en: 'When a supplier must be paid before the goods arrive, a separate advance request is decided again by the COO and the CEO.',
      ms: 'Jika pembekal perlu dibayar sebelum barang sampai, permohonan pendahuluan yang berasingan diputuskan semula oleh COO dan CEO.',
    },
    start: { view: 'it-procurement', label: { en: 'Request a separate advance exception', ms: 'Mohon pengecualian pendahuluan' } },
    starter: { en: 'IT, or the Finance team chosen for IT purchases', ms: 'IT, atau pasukan Kewangan yang dipilih untuk pembelian IT' },
    steps: [
      {
        who: { en: 'IT or Finance', ms: 'IT atau Kewangan' },
        does: {
          en: 'Records the exact supplier, PO revision, amount, reason and terms.',
          ms: 'Merekod pembekal, semakan PO, jumlah, sebab dan terma yang tepat.',
        },
        where: { view: 'it-procurement', label: { en: 'IT purchase fulfilment', ms: 'IT purchase fulfilment' } },
      },
      {
        who: { en: 'COO, then CEO', ms: 'COO, kemudian CEO' },
        does: {
          en: 'Each gives a fresh decision on this exact advance. The earlier purchase approval does not count.',
          ms: 'Masing-masing memberi keputusan baharu bagi pendahuluan ini. Kelulusan pembelian sebelum ini tidak dikira.',
        },
        where: { view: 'it-procurement', label: { en: 'Review exact advance exception', ms: 'Semak pengecualian pendahuluan' } },
        decision: true,
      },
      {
        who: { en: 'Finance (IT purchases team)', ms: 'Kewangan (pasukan pembelian IT)' },
        does: {
          en: 'Records the exact approved amount once. The goods receipt and invoice check are still due afterwards.',
          ms: 'Merekod jumlah yang diluluskan sekali sahaja. Penerimaan barang dan semakan invois masih perlu dibuat selepas itu.',
        },
        where: { view: 'it-procurement', label: { en: 'IT purchase fulfilment', ms: 'IT purchase fulfilment' } },
      },
    ],
    rules: [
      { en: 'Only one unresolved advance per purchase at a time.', ms: 'Hanya satu pendahuluan yang belum selesai bagi setiap pembelian pada satu masa.' },
      {
        en: 'No payment is made from Prima, and no supplier is contacted automatically.',
        ms: 'Tiada bayaran dibuat dari Prima, dan tiada pembekal dihubungi secara automatik.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_PROCUREMENT_RECONSTRUCTED.md' },
    words: 'advance pendahuluan deposit bayaran dahulu pay first supplier pembekal',
  },
  {
    id: 'it-device-handover',
    app: 'it',
    title: { en: 'Register a device and hand it to a person', ms: 'Daftar peranti dan serahkan kepada seseorang' },
    purpose: {
      en: 'Every IT device is on the register with its details before it is given to anyone; the person then sees it under their IT devices.',
      ms: 'Setiap peranti IT didaftarkan dengan butirannya sebelum diserahkan kepada sesiapa; orang itu kemudian melihatnya di bawah peranti IT mereka.',
    },
    start: { view: 'it', tab: 'assets', label: { en: 'Register existing device', ms: 'Daftar peranti sedia ada' } },
    starter: { en: 'IT Manager, IT Lead or IT staff', ms: 'Pengurus IT, Ketua IT atau staf IT' },
    steps: [
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Registers a device that is already in use or in stock, with a unique tag or serial. An unknown purchase date stays unknown and the device starts unassigned. A list can also be imported from a file.',
          ms: 'Mendaftar peranti yang sudah digunakan atau dalam stok, dengan tag atau nombor siri yang unik. Tarikh pembelian yang tidak diketahui kekal tidak diketahui dan peranti bermula tanpa pemegang. Senarai juga boleh diimport daripada fail.',
        },
        where: { view: 'it', tab: 'assets', label: { en: 'IT › Assets', ms: 'IT › Aset' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records the register details: item-register label, serial, purchase details (or “maklumat pembelian tiada”), custodian and location.',
          ms: 'Merekod butiran daftar: label daftar barang, nombor siri, butiran pembelian (atau “maklumat pembelian tiada”), penjaga dan lokasi.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Butiran daftar aset', ms: 'IT › Polisi IT › Butiran daftar aset' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Opens the device and presses Assign with who has it. Prima refuses the handover while register details are missing.',
          ms: 'Membuka peranti dan menekan Assign dengan nama pemegang. Prima menolak penyerahan selagi butiran daftar belum lengkap.',
        },
        where: { view: 'it', tab: 'assets', label: { en: 'IT › Assets', ms: 'IT › Aset' } },
      },
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Sees the device under “Peranti IT saya” and reports there if it is lost, stolen or damaged.',
          ms: 'Melihat peranti di bawah “Peranti IT saya” dan melaporkan di situ jika hilang, dicuri atau rosak.',
        },
        where: { view: 'equiprequests', tab: 'ask', label: { en: 'Ask for equipment › Peranti IT saya', ms: 'Mohon peralatan › Peranti IT saya' } },
      },
    ],
    rules: [
      {
        en: 'Registering a device does not create a purchase, price, rental charge or ownership.',
        ms: 'Mendaftar peranti tidak mewujudkan pembelian, harga, caj sewaan atau pemilikan.',
      },
      {
        en: 'A device given to another person needs a checked data wipe first.',
        ms: 'Peranti yang diserahkan kepada orang lain perlu pemadaman data yang telah disemak terlebih dahulu.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 1 Nov 2026 (IT staff register existing stock) and 13-14 Nov 2026 (Q11, Q17)' },
    words: 'asset aset device peranti laptop register daftar assign serah handover tag serial',
  },
  {
    id: 'it-lost-device',
    app: 'it',
    title: { en: 'A device is lost, stolen or damaged', ms: 'Peranti hilang, dicuri atau rosak' },
    purpose: {
      en: 'The holder reports it from their own devices list; this opens a help request linked to the device and IT updates the register.',
      ms: 'Pemegang melaporkannya dari senarai peranti sendiri; ini membuka tiket bantuan yang dipautkan kepada peranti dan IT mengemas kini daftar.',
    },
    start: { view: 'equiprequests', tab: 'ask', label: { en: 'Lapor hilang / dicuri / rosak', ms: 'Lapor hilang / dicuri / rosak' } },
    starter: { en: 'The staff member holding the device', ms: 'Staf yang memegang peranti' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Under “Peranti IT saya” presses Lapor hilang / dicuri / rosak, chooses what happened and says where and when. For a theft the police report number and photo are optional.',
          ms: 'Di bawah “Peranti IT saya” tekan Lapor hilang / dicuri / rosak, pilih apa yang berlaku dan nyatakan di mana dan bila. Bagi kecurian, nombor dan gambar laporan polis adalah pilihan.',
        },
        where: { view: 'equiprequests', tab: 'ask', label: { en: 'Ask for equipment › Peranti IT saya', ms: 'Mohon peralatan › Peranti IT saya' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Handles the help request it opened (a lost or stolen device is P2).',
          ms: 'Mengurus tiket bantuan yang dibuka (peranti hilang atau dicuri ialah P2).',
        },
        where: { view: 'it', tab: 'tickets', label: { en: 'IT › Help requests', ms: 'IT › Tiket bantuan' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: { en: 'Updates the device on the register (lost, stolen, in repair).', ms: 'Mengemas kini status peranti dalam daftar (hilang, dicuri, dalam pembaikan).' },
        where: { view: 'it', tab: 'assets', label: { en: 'IT › Assets', ms: 'IT › Aset' } },
      },
    ],
    rules: [
      {
        en: 'The police report is optional, with no deadline and no flag.',
        ms: 'Laporan polis adalah pilihan, tanpa tarikh akhir dan tanpa tanda.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 13-14 Nov 2026 (Q12 and the Q-X answer on police reports)' },
    words: 'lost hilang stolen dicuri curi damaged rosak broken police polis laptop phone telefon',
  },
  {
    id: 'it-asset-inspection',
    app: 'it',
    title: { en: 'Six-month health inspection of IT assets', ms: 'Pemeriksaan kesihatan aset IT setiap enam bulan' },
    purpose: {
      en: 'Every active IT asset has its health and condition inspected every six calendar months, recorded on an assigned IT job and checked through the normal job workflow.',
      ms: 'Setiap aset IT yang aktif diperiksa kesihatan dan keadaannya setiap enam bulan kalendar, direkod pada tugasan IT yang diberi dan disemak melalui aliran tugasan biasa.',
    },
    start: { view: 'it', tab: 'maintenance', label: { en: 'Record asset health and condition', ms: 'Rekod kesihatan dan keadaan aset' } },
    starter: { en: 'The IT person assigned the inspection job', ms: 'Staf IT yang diberi tugasan pemeriksaan' },
    steps: [
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: {
          en: 'Sees what is due (or needs an initial check) and gives inspection jobs from the Plan.',
          ms: 'Melihat apa yang perlu diperiksa (atau perlu semakan awal) dan memberi tugasan pemeriksaan dari Plan.',
        },
        where: { view: 'it', tab: 'plan', label: { en: 'IT › Plan', ms: 'IT › Pelan' } },
      },
      {
        who: { en: 'IT person', ms: 'Staf IT' },
        does: {
          en: 'Chooses the asset and their own open inspection job, and records the date, condition, findings, evidence and any follow-up.',
          ms: 'Memilih aset dan tugasan pemeriksaan sendiri yang masih terbuka, dan merekod tarikh, keadaan, penemuan, bukti dan tindakan susulan.',
        },
        where: { view: 'it', tab: 'maintenance', label: { en: 'IT › Maintenance', ms: 'IT › Penyelenggaraan' } },
      },
      {
        who: { en: 'IT person', ms: 'Staf IT' },
        does: { en: 'Submits the linked job with proof.', ms: 'Menghantar tugasan berkaitan dengan bukti.' },
        where: { view: 'it', tab: 'work', label: { en: 'IT › My work', ms: 'IT › Kerja saya' } },
      },
      {
        who: { en: 'IT Lead, then IT Manager', ms: 'Ketua IT, kemudian Pengurus IT' },
        does: { en: 'Check and accept the job, or return it.', ms: 'Menyemak dan menerima tugasan, atau memulangkannya.' },
        where: { view: 'it', tab: 'jobs', label: { en: 'IT › Jobs', ms: 'IT › Tugasan' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Six calendar months, never 180 days (31 Aug is next due at the end of February).',
        ms: 'Enam bulan kalendar, bukan 180 hari (31 Ogos perlu diperiksa semula pada hujung Februari).',
      },
      {
        en: 'Unknown history means an initial check is needed, not healthy. Service and repair do not count as an inspection. A disposed asset gets no new inspection.',
        ms: 'Sejarah yang tidak diketahui bermaksud perlu semakan awal, bukan sihat. Servis dan pembaikan tidak dikira sebagai pemeriksaan. Aset yang telah dilupuskan tidak diperiksa lagi.',
      },
      {
        en: 'An accepted job is not a separate health certificate.',
        ms: 'Tugasan yang diterima bukan sijil kesihatan yang berasingan.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_OPERATIONS_PILOT.md', decided: 'Fauzan, 1 Nov 2026' },
    words: 'inspection pemeriksaan health kesihatan condition keadaan six months enam bulan maintenance penyelenggaraan',
  },
  {
    id: 'it-rental-billing',
    app: 'it',
    title: { en: 'Device rental to a company: agreement, rates and monthly bill', ms: 'Sewaan peranti kepada syarikat: perjanjian, kadar dan bil bulanan' },
    purpose: {
      en: 'Merdeka rents IT devices to group companies under a signed agreement; the IT Manager sets actual rates and IT prepares each month’s bill from the devices chosen.',
      ms: 'Merdeka menyewakan peranti IT kepada syarikat kumpulan di bawah perjanjian bertandatangan; Pengurus IT menetapkan kadar sebenar dan IT menyediakan bil bulanan daripada peranti yang dipilih.',
    },
    start: { view: 'it', tab: 'rental', label: { en: 'Device rental', ms: 'Sewaan peranti' } },
    starter: { en: 'IT Manager', ms: 'Pengurus IT' },
    steps: [
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: {
          en: 'Records the rental agreement for the company (Perjanjian sewaan baharu), prints it to be signed outside Prima, then records the signed copy link.',
          ms: 'Merekod perjanjian sewaan bagi syarikat (Perjanjian sewaan baharu), mencetaknya untuk ditandatangani di luar Prima, kemudian merekod pautan salinan bertandatangan.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod IT', ms: 'IT › Polisi IT › Rekod IT' } },
      },
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: {
          en: 'Sets a new rate version: the actual monthly amount in RM, effective from the first of a month, with evidence.',
          ms: 'Menetapkan versi kadar baharu: jumlah bulanan sebenar dalam RM, berkuat kuasa dari hari pertama bulan, dengan bukti.',
        },
        where: { view: 'it', tab: 'rental', label: { en: 'IT › Device rental', ms: 'IT › Sewaan peranti' } },
      },
      {
        who: { en: 'IT staff', ms: 'Staf IT' },
        does: {
          en: 'Chooses the billing month and the company’s linked devices in use, reviews the exact snapshot and records the bill.',
          ms: 'Memilih bulan bil dan peranti syarikat yang sedang digunakan, menyemak salinan tepat dan merekod bil.',
        },
        where: { view: 'it', tab: 'rental', label: { en: 'IT › Device rental', ms: 'IT › Sewaan peranti' } },
      },
      {
        who: { en: 'Finance Director', ms: 'Pengarah Kewangan' },
        does: {
          en: 'Records the payment reference when the company pays. Only Finance records payments; IT never marks a bill paid.',
          ms: 'Merekod rujukan bayaran apabila syarikat membayar. Hanya Kewangan merekod bayaran; IT tidak sekali-kali menandakan bil sebagai dibayar.',
        },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'When a device comes back (Peranti dipulangkan), checks the accessories and records the condition.',
          ms: 'Apabila peranti dipulangkan (Peranti dipulangkan), menyemak aksesori dan merekod keadaannya.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod IT', ms: 'IT › Polisi IT › Rekod IT' } },
      },
    ],
    rules: [
      {
        en: 'No rate, bill or payment is made up: an empty rate stays unconfigured and zero must be entered on purpose.',
        ms: 'Tiada kadar, bil atau bayaran direka: kadar kosong kekal belum ditetapkan dan sifar mesti dimasukkan dengan sengaja.',
      },
      {
        en: 'One bill per company per month; a later rate change never rewrites an issued bill. Recording a bill never marks it paid.',
        ms: 'Satu bil bagi setiap syarikat setiap bulan; perubahan kadar kemudian tidak mengubah bil yang telah dikeluarkan. Merekod bil tidak menandakannya sebagai dibayar.',
      },
      {
        en: 'Unlinked stock is not billed. A company using Merdeka devices with no signed agreement is shown as a warning.',
        ms: 'Stok yang tidak dipautkan tidak dibil. Syarikat yang menggunakan peranti Merdeka tanpa perjanjian bertandatangan dipaparkan sebagai amaran.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_OPERATIONS_PILOT.md', decided: 'Fauzan, 1 Nov 2026; rental agreement 14 Nov 2026 (Q19)' },
    words: 'rental sewaan sewa rate kadar bill bil invoice invois agreement perjanjian company syarikat device peranti',
  },
  {
    id: 'it-rental-correction',
    app: 'it',
    title: { en: 'Correct an unpaid rental bill (replacement)', ms: 'Membetulkan bil sewaan yang belum dibayar (gantian)' },
    purpose: {
      en: 'When an unpaid rental bill is wrong, IT prepares a replacement, an independent IT Manager checks the facts and the Finance Director approves issuing it.',
      ms: 'Jika bil sewaan yang belum dibayar salah, IT menyediakan gantian, Pengurus IT yang bebas menyemak fakta dan Pengarah Kewangan meluluskan pengeluarannya.',
    },
    start: { view: 'it', tab: 'rental', label: { en: 'Device rental', ms: 'Sewaan peranti' } },
    starter: { en: 'IT staff', ms: 'Staf IT' },
    steps: [
      {
        who: { en: 'IT staff', ms: 'Staf IT' },
        does: { en: 'Prepares the replacement bill with the correct devices and rate.', ms: 'Menyediakan bil gantian dengan peranti dan kadar yang betul.' },
        where: { view: 'it', tab: 'rental', label: { en: 'IT › Device rental', ms: 'IT › Sewaan peranti' } },
      },
      {
        who: { en: 'IT Manager (not the preparer)', ms: 'Pengurus IT (bukan penyedia)' },
        does: { en: 'Checks the device and rate facts, or returns it with a reason.', ms: 'Menyemak fakta peranti dan kadar, atau memulangkannya dengan sebab.' },
        where: { view: 'it', tab: 'rental', label: { en: 'IT › Device rental', ms: 'IT › Sewaan peranti' } },
        decision: true,
      },
      {
        who: { en: 'Finance Director', ms: 'Pengarah Kewangan' },
        does: {
          en: 'Approves issuing the replacement while the Manager’s check is still current and nothing has changed.',
          ms: 'Meluluskan pengeluaran gantian selagi semakan Pengurus masih terkini dan tiada perubahan.',
        },
        where: { view: 'it', tab: 'rental', label: { en: 'IT › Device rental', ms: 'IT › Sewaan peranti' } },
        decision: true,
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Records the payment reference against the replacement bill.', ms: 'Merekod rujukan bayaran pada bil gantian.' },
        where: { view: 'it', tab: 'rental', label: { en: 'IT › Device rental', ms: 'IT › Sewaan peranti' } },
      },
    ],
    rules: [
      {
        en: 'The original bill is never overwritten or deleted; its history stays.',
        ms: 'Bil asal tidak sekali-kali ditulis ganti atau dipadam; sejarahnya kekal.',
      },
      {
        en: 'Paid bills, old (legacy) bills and a replacement of a replacement cannot be corrected here.',
        ms: 'Bil yang sudah dibayar, bil lama (legacy) dan gantian kepada gantian tidak boleh dibetulkan di sini.',
      },
      { en: 'The IT Manager cannot check a request they prepared.', ms: 'Pengurus IT tidak boleh menyemak permohonan yang disediakannya sendiri.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_RENTAL_REPLACEMENT_REVIEW.md' },
    words: 'rental sewaan bill bil correction pembetulan replacement gantian wrong salah',
  },
  {
    id: 'it-disposal',
    app: 'it',
    title: { en: 'Dispose of an IT device (with data wipe)', ms: 'Melupuskan peranti IT (dengan pemadaman data)' },
    purpose: {
      en: 'A device beyond repair or at end of life is inspected, approved by three different people, wiped and disposed of with a certificate.',
      ms: 'Peranti yang tidak boleh dibaiki atau sampai akhir hayat diperiksa, diluluskan oleh tiga orang berbeza, dipadam datanya dan dilupuskan dengan sijil.',
    },
    start: { view: 'it', tab: 'policy', label: { en: 'Mohon pelupusan', ms: 'Mohon pelupusan' } },
    starter: { en: 'IT staff', ms: 'Staf IT' },
    steps: [
      {
        who: { en: 'IT staff', ms: 'Staf IT' },
        does: { en: 'Asks for the disposal with the reason and the condition found.', ms: 'Memohon pelupusan dengan sebab dan keadaan yang ditemui.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod IT', ms: 'IT › Polisi IT › Rekod IT' } },
      },
      {
        who: { en: 'IT Lead or IT Executive', ms: 'Ketua IT atau Eksekutif IT' },
        does: {
          en: 'Records the inspection with photos. A repairable device stays active.',
          ms: 'Merekod pemeriksaan dengan gambar. Peranti yang boleh dibaiki kekal aktif.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
      },
      {
        who: {
          en: 'IT Manager, then the head of the company or department using it (CoS or DCoS for a central device), then the COO as HQ',
          ms: 'Pengurus IT, kemudian ketua syarikat atau jabatan pengguna (CoS atau DCoS bagi peranti pusat), kemudian COO sebagai HQ',
        },
        does: { en: 'Each approves or rejects with a reason.', ms: 'Masing-masing meluluskan atau menolak dengan sebab.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'Device user, then IT', ms: 'Pengguna peranti, kemudian IT' },
        does: {
          en: 'The user ticks that their business data was backed up; IT logs the data wipe (method, disk serial, wipe report or photo).',
          ms: 'Pengguna menanda bahawa data perniagaan telah disandarkan; IT merekod pemadaman data (kaedah, nombor siri cakera, laporan atau gambar).',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Log pemadaman data', ms: 'IT › Polisi IT › Log pemadaman data' } },
      },
      {
        who: { en: 'A different IT person (the IT Manager when the Lead did the wipe)', ms: 'Staf IT lain (Pengurus IT jika Ketua IT yang memadam)' },
        does: { en: 'Checks the wipe.', ms: 'Menyemak pemadaman data.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: {
          en: 'Records the disposal as done: method, vendor, certificate number and photos. Finance records the write-off.',
          ms: 'Merekod pelupusan sebagai selesai: kaedah, vendor, nombor sijil dan gambar. Kewangan merekod hapus kira.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
      },
    ],
    rules: [
      {
        en: 'Three different people approve, never whoever asked or inspected.',
        ms: 'Tiga orang berbeza meluluskan, tidak sekali-kali orang yang memohon atau memeriksa.',
      },
      {
        en: 'Done only with the certificate, photos and a checked wipe. Targets: inspection 3, approvals 2, wipe and certificate 2, the whole 7 working days to ready for the contractor.',
        ms: 'Selesai hanya dengan sijil, gambar dan pemadaman yang telah disemak. Sasaran: pemeriksaan 3, kelulusan 2, pemadaman dan sijil 2, keseluruhan 7 hari bekerja sehingga sedia untuk kontraktor.',
      },
      {
        en: 'The PDPA officer reads the wipe log only. Disposal records are kept at least 5 years.',
        ms: 'Pegawai PDPA hanya membaca log pemadaman data. Rekod pelupusan disimpan sekurang-kurangnya 5 tahun.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 13-14 Nov 2026 (Q16, Q17, Q-X5; "3., yes" for central devices) and Part V V-X6' },
    words: 'disposal pelupusan lupus dispose wipe padam data e-waste sijil certificate write-off hapus kira',
  },
  {
    id: 'it-asset-lifecycle',
    app: 'it',
    title: { en: 'Regular device work: maintenance, refurbishment and end of life', ms: 'Kerja berkala peranti: penyelenggaraan, baik pulih dan akhir hayat' },
    purpose: {
      en: 'Prima lists the devices due for maintenance, refurbishment or an end-of-life review, and IT records each one.',
      ms: 'Prima menyenaraikan peranti yang perlu diselenggara, dibaik pulih atau dinilai akhir hayat, dan IT merekod setiap satu.',
    },
    start: { view: 'it', tab: 'policy', label: { en: 'Kerja berkala aset', ms: 'Kerja berkala aset' } },
    starter: { en: 'IT staff', ms: 'Staf IT' },
    steps: [
      {
        who: { en: 'IT', ms: 'IT' },
        does: { en: 'Opens the list of regular work that is due.', ms: 'Membuka senarai kerja berkala yang perlu dibuat.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Kerja berkala aset', ms: 'IT › Polisi IT › Kerja berkala aset' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'For a refurbishment, ticks the checklist (hardware, battery, disk, operating system, accounts removed, data wiped, function test).',
          ms: 'Bagi baik pulih, menanda senarai semak (perkakasan, bateri, cakera, sistem pengendalian, akaun dibuang, data dipadam, ujian fungsi).',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod IT', ms: 'IT › Polisi IT › Rekod IT' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'For an end-of-life review, records the outcome: keep, refurbish, reassign or retire with a reason. A retired device then follows the disposal flow.',
          ms: 'Bagi penilaian akhir hayat, merekod keputusan: kekal, baik pulih, agih semula atau bersara dengan sebab. Peranti yang bersara kemudian mengikut aliran pelupusan.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Penilaian akhir hayat', ms: 'IT › Polisi IT › Penilaian akhir hayat' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Refurbishment every 36 months, end-of-life review at 48 months (phones and tablets 36), maintenance every 6 months.',
        ms: 'Baik pulih setiap 36 bulan, penilaian akhir hayat pada 48 bulan (telefon dan tablet 36), penyelenggaraan setiap 6 bulan.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 14 Nov 2026 (Q18)' },
    words: 'refurbish baik pulih end of life akhir hayat maintenance penyelenggaraan servis service',
  },
  {
    id: 'it-m365-account',
    app: 'it',
    title: { en: 'Ask for a Microsoft 365 account', ms: 'Mohon akaun Microsoft 365' },
    purpose: {
      en: 'A new Microsoft 365 account is supported by the line manager, verified by IT and approved by the CoS or DCoS, then put on the account register.',
      ms: 'Akaun Microsoft 365 baharu disokong oleh pengurus barisan, disahkan oleh IT dan diluluskan oleh CoS atau DCoS, kemudian dimasukkan ke dalam daftar akaun.',
    },
    start: { view: 'it', tab: 'policy', label: { en: 'Mohon akaun Microsoft 365', ms: 'Mohon akaun Microsoft 365' } },
    starter: { en: 'Any staff member, for themselves or their team', ms: 'Mana-mana staf, untuk diri sendiri atau pasukan' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Asks with the job title, the email address wanted, the reason, the apps needed and the access level.',
          ms: 'Memohon dengan jawatan, alamat e-mel yang dikehendaki, sebab, aplikasi yang diperlukan dan tahap akses.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
      },
      {
        who: { en: 'Line manager', ms: 'Pengurus barisan' },
        does: { en: 'Supports it or not, with a reason.', ms: 'Menyokong atau tidak, dengan sebab.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
        decision: true,
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Verifies: existing user, duplicate account, licence available, correct domain.',
          ms: 'Mengesahkan: pengguna sedia ada, akaun berganda, lesen tersedia, domain betul.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'CoS or DCoS', ms: 'CoS atau DCoS' },
        does: { en: 'Approves or rejects with a reason.', ms: 'Meluluskan atau menolak dengan sebab.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Creates the account in Microsoft 365 (outside Prima), then adds it to the account register (Akaun M365) with its owner, licence and MFA.',
          ms: 'Mencipta akaun dalam Microsoft 365 (di luar Prima), kemudian menambahnya ke daftar akaun (Akaun M365) dengan pemilik, lesen dan MFA.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Akaun M365 (daftar)', ms: 'IT › Polisi IT › Akaun M365 (daftar)' } },
      },
    ],
    rules: [
      {
        en: 'Every account has an owner; a guest account needs an expiry date; a joiner’s account step needs MFA “yes”.',
        ms: 'Setiap akaun ada pemilik; akaun tetamu perlu tarikh tamat; langkah akaun bagi staf baharu perlu MFA “ya”.',
      },
      {
        en: 'Ready within 2 working days of the CoS approval (a late flag, never a block). The quarterly review shows problems first.',
        ms: 'Siap dalam 2 hari bekerja selepas kelulusan CoS (tanda lewat, bukan sekatan). Semakan suku tahunan memaparkan masalah dahulu.',
      },
      {
        en: 'A joiner already reviewed in the HR / IT coordination is not asked twice. Admin access stays with the CEO.',
        ms: 'Staf baharu yang sudah disemak dalam koordinasi HR / IT tidak ditanya dua kali. Akses pentadbir kekal dengan CEO.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 13-14 Nov 2026 (Q20, Q21) and Part V V9' },
    words: 'microsoft 365 m365 account akaun email e-mel outlook teams licence lesen new staff',
  },
  {
    id: 'it-domain',
    app: 'it',
    title: { en: 'Ask for a new domain', ms: 'Mohon domain baharu' },
    purpose: {
      en: 'A new domain is approved by the CEO, bought in the company’s name from an approved registrar and becomes active only with the Microsoft 365 verification proof.',
      ms: 'Domain baharu diluluskan oleh CEO, dibeli atas nama syarikat daripada pendaftar yang diluluskan dan hanya aktif dengan bukti pengesahan Microsoft 365.',
    },
    start: { view: 'it', tab: 'policy', label: { en: 'Mohon domain baharu', ms: 'Mohon domain baharu' } },
    starter: { en: 'Any staff member', ms: 'Mana-mana staf' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Proposes the domain with its purpose, business justification and expected users.',
          ms: 'Mencadangkan domain dengan tujuan, justifikasi perniagaan dan jangkaan bilangan pengguna.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: { en: 'Approves or rejects with a reason.', ms: 'Meluluskan atau menolak dengan sebab.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records the purchase: registrar from the approved list, registrant (the company), auto-renew, registrar lock, 2FA, DNS.',
          ms: 'Merekod pembelian: pendaftar daripada senarai diluluskan, pendaftar nama (syarikat), pembaharuan automatik, kunci pendaftar, 2FA, DNS.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Activates it with the Microsoft 365 domain verification screenshot, then adds it to the IP register.',
          ms: 'Mengaktifkannya dengan tangkapan skrin pengesahan domain Microsoft 365, kemudian menambahnya ke daftar harta intelek.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
      },
    ],
    rules: [
      {
        en: 'A registrant that looks like a person is flagged. Unknown registrar lock or 2FA shows amber, never green.',
        ms: 'Pendaftar nama yang kelihatan seperti individu akan ditanda. Kunci pendaftar atau 2FA yang tidak diketahui dipaparkan kuning, bukan hijau.',
      },
      {
        en: 'A new active domain with no IP register row shows late after 3 working days (a flag, never a block).',
        ms: 'Domain aktif baharu tanpa baris daftar harta intelek ditanda lewat selepas 3 hari bekerja (tanda sahaja, bukan sekatan).',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/WEBSITE_POLICY_REBUILD.md', decided: 'Fauzan, 13-14 Nov 2026 (Q22) and Part V V9' },
    words: 'domain domain baharu registrar pendaftar dns website laman web',
  },
  {
    id: 'it-website-project',
    app: 'it',
    title: { en: 'A new company website or a big change', ms: 'Laman web syarikat baharu atau perubahan besar' },
    purpose: {
      en: 'The company head asks; IT scopes and costs it; the CEO approves; the content owner confirms and tests; the content approver approves publishing.',
      ms: 'Ketua syarikat memohon; IT menetapkan skop dan kos; CEO meluluskan; pemilik kandungan mengesahkan dan menguji; pelulus kandungan meluluskan penerbitan.',
    },
    start: { view: 'it', tab: 'policy', label: { en: 'Mohon laman web baharu (ketua syarikat)', ms: 'Mohon laman web baharu (ketua syarikat)' } },
    starter: { en: 'The head of the company', ms: 'Ketua syarikat' },
    steps: [
      {
        who: { en: 'Head of company', ms: 'Ketua syarikat' },
        does: {
          en: 'Asks, naming a content owner and a different content approver, with the logo, profile and photos.',
          ms: 'Memohon dengan menamakan pemilik kandungan dan pelulus kandungan yang berbeza, bersama logo, profil dan gambar.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Checks it within 1 working day, then gives the scope, estimated cost and build days.',
          ms: 'Menyemaknya dalam 1 hari bekerja, kemudian memberi skop, anggaran kos dan tempoh pembinaan.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: { en: 'Approves the cost and scope, never their own request.', ms: 'Meluluskan kos dan skop, tidak sekali-kali permohonan sendiri.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'Content owner, then IT', ms: 'Pemilik kandungan, kemudian IT' },
        does: {
          en: 'The content owner confirms the design and content; IT records the build, preview address and internal test.',
          ms: 'Pemilik kandungan mengesahkan reka bentuk dan kandungan; IT merekod pembinaan, alamat pratonton dan ujian dalaman.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
      },
      {
        who: { en: 'Content owner', ms: 'Pemilik kandungan' },
        does: { en: 'Tests it before publishing (UAT).', ms: 'Menguji sebelum terbit (UAT).' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
      },
      {
        who: { en: 'Content approver', ms: 'Pelulus kandungan' },
        does: {
          en: 'Approves publishing with HTTPS on and the live address.',
          ms: 'Meluluskan penerbitan dengan HTTPS dihidupkan dan alamat langsung.',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Permohonan saya', ms: 'IT › Polisi IT › Permohonan saya' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'The content owner and the content approver are different people.', ms: 'Pemilik kandungan dan pelulus kandungan adalah orang yang berbeza.' },
      { en: 'The IP register is updated within 3 working days of a website change.', ms: 'Daftar harta intelek dikemas kini dalam 3 hari bekerja selepas perubahan laman web.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 14 Nov 2026 (Part V V8)' },
    words: 'website laman web new baharu publish terbit uat content kandungan',
  },
  {
    id: 'it-website-issue',
    app: 'it',
    title: { en: 'A website, social media or company email issue', ms: 'Isu laman web, media sosial atau e-mel syarikat' },
    purpose: {
      en: 'An urgent website, social account or email problem is reported, fixed by the IT person the IT Manager names, and confirmed by the person who asked.',
      ms: 'Masalah segera pada laman web, akaun media sosial atau e-mel dilaporkan, diselesaikan oleh staf IT yang dinamakan Pengurus IT, dan disahkan oleh orang yang melapor.',
    },
    start: { view: 'websites', tab: 'issues', label: { en: 'Report an issue', ms: 'Laporkan isu' } },
    starter: {
      en: 'Anyone who works on the company’s websites: IT, the head of company, the content owner or approver, group management',
      ms: 'Sesiapa yang menguruskan laman web syarikat: IT, ketua syarikat, pemilik atau pelulus kandungan, pengurusan kumpulan',
    },
    steps: [
      {
        who: { en: 'Requester', ms: 'Pemohon' },
        does: { en: 'Reports the issue with the site or account and what is wrong.', ms: 'Melaporkan isu dengan laman atau akaun dan apa masalahnya.' },
        where: { view: 'websites', tab: 'issues', label: { en: 'Websites › Issues', ms: 'Laman web › Isu' } },
      },
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: { en: 'Gives it to one active IT person.', ms: 'Memberikannya kepada seorang staf IT yang aktif.' },
        where: { view: 'it', tab: 'tickets', label: { en: 'IT › Help requests', ms: 'IT › Tiket bantuan' } },
      },
      {
        who: { en: 'Assigned IT person', ms: 'Staf IT yang diberi' },
        does: { en: 'Fixes it and resolves it with evidence.', ms: 'Menyelesaikannya dan merekod penyelesaian dengan bukti.' },
        where: { view: 'it', tab: 'tickets', label: { en: 'IT › Help requests', ms: 'IT › Tiket bantuan' } },
      },
      {
        who: {
          en: 'The requester (outside IT); for IT’s own issues the IT Manager, or the IT Lead when the Manager fixed it',
          ms: 'Pemohon (di luar IT); bagi isu IT sendiri Pengurus IT, atau Ketua IT jika Pengurus yang menyelesaikannya',
        },
        does: {
          en: 'Confirms it is fixed or returns it, with a comment of 3 to 500 characters.',
          ms: 'Mengesahkan ia selesai atau memulangkannya, dengan ulasan 3 hingga 500 aksara.',
        },
        where: { view: 'it', tab: 'mine', label: { en: 'IT › My requests', ms: 'IT › Permohonan saya' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Nobody confirms or returns their own fix.', ms: 'Tiada sesiapa mengesahkan atau memulangkan penyelesaian sendiri.' },
      {
        en: 'Reopening needs a reason; it clears the current acceptance but keeps the history.',
        ms: 'Membuka semula perlu sebab; ia membatalkan penerimaan semasa tetapi sejarah dikekalkan.',
      },
      {
        en: 'Website notices stay inside Prima: no email or Teams message is sent. An active social account with no post for 180 days (known date) notifies the company manager.',
        ms: 'Notis laman web kekal dalam Prima: tiada e-mel atau mesej Teams dihantar. Akaun sosial aktif tanpa hantaran selama 180 hari (tarikh diketahui) memaklumkan pengurus syarikat.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/WEBSITE_POLICY_REBUILD.md', decided: 'Owner confirmed: IT resolves, the requester confirms' },
    words: 'website laman web social media sosial facebook instagram email e-mel issue isu down rosak',
  },
  {
    id: 'it-ip-register',
    app: 'it',
    title: { en: 'Intellectual property register', ms: 'Daftar harta intelek' },
    purpose: {
      en: 'IT keeps each company’s logos, profiles, templates, domains, source code and other digital assets on a register; only the CEO approves taking one out of use.',
      ms: 'IT menyimpan logo, profil, templat, domain, kod sumber dan aset digital lain setiap syarikat dalam daftar; hanya CEO meluluskan untuk menamatkan penggunaannya.',
    },
    start: { view: 'it', tab: 'policy', label: { en: 'Daftar harta intelek', ms: 'Daftar harta intelek' } },
    starter: { en: 'IT staff', ms: 'Staf IT' },
    steps: [
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records the asset: type, owner company, custodian, provider, dates, SharePoint link and where access is kept (never the password).',
          ms: 'Merekod aset: jenis, syarikat pemilik, penjaga, pembekal, tarikh, pautan SharePoint dan tempat akses disimpan (bukan kata laluan).',
        },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod IT', ms: 'IT › Polisi IT › Rekod IT' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: { en: 'Asks to decommission an asset, with a reason.', ms: 'Memohon untuk menamatkan aset, dengan sebab.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: { en: 'Approves the decommission.', ms: 'Meluluskan penamatan.' },
        where: { view: 'it', tab: 'policy', label: { en: 'IT › IT policies › Rekod', ms: 'IT › Polisi IT › Rekod' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Trademark and copyright filings stay with the Company Secretary / Legal, outside this register.',
        ms: 'Pemfailan cap dagangan dan hak cipta kekal dengan Setiausaha Syarikat / Undang-undang, di luar daftar ini.',
      },
      {
        en: 'Updated within 3 working days of a website, domain or system change.',
        ms: 'Dikemas kini dalam 3 hari bekerja selepas perubahan laman web, domain atau sistem.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_POLICIES_MERDEKA.md', decided: 'Fauzan, 13-14 Nov 2026 (Q23) and Part V V9' },
    words: 'intellectual property harta intelek ip logo trademark cap dagangan copyright hak cipta source code',
  },
  {
    id: 'it-joiner-leaver',
    app: 'it',
    title: { en: 'IT steps when staff join or leave', ms: 'Langkah IT apabila staf masuk atau keluar' },
    purpose: {
      en: 'A checklist of IT work for each joiner and leaver, given to one IT person and ticked with evidence.',
      ms: 'Senarai semak kerja IT bagi setiap staf yang masuk dan keluar, diberikan kepada seorang staf IT dan ditanda dengan bukti.',
    },
    start: { view: 'it', tab: 'onboarding', label: { en: 'Add joining / leaving request', ms: 'Tambah permohonan masuk / keluar' } },
    starter: { en: 'IT staff (with HR)', ms: 'Staf IT (bersama HR)' },
    steps: [
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records the joiner or leaver against their staff record (or as an unlinked person, labelled so), with the date and job title.',
          ms: 'Merekod staf yang masuk atau keluar pada rekod staf mereka (atau sebagai orang yang belum dipautkan, dilabel begitu), dengan tarikh dan jawatan.',
        },
        where: { view: 'it', tab: 'onboarding', label: { en: 'IT › Joining and leaving', ms: 'IT › Masuk dan keluar' } },
      },
      {
        who: { en: 'IT Manager or IT Lead', ms: 'Pengurus IT atau Ketua IT' },
        does: { en: 'Gives the checklist an owner.', ms: 'Menetapkan pemilik bagi senarai semak.' },
        where: { view: 'it', tab: 'onboarding', label: { en: 'IT › Joining and leaving', ms: 'IT › Masuk dan keluar' } },
      },
      {
        who: { en: 'IT person', ms: 'Staf IT' },
        does: {
          en: 'Ticks each step with evidence. For a joiner, the Microsoft 365 step needs the account on the register with MFA “yes”.',
          ms: 'Menanda setiap langkah dengan bukti. Bagi staf baharu, langkah Microsoft 365 memerlukan akaun dalam daftar dengan MFA “ya”.',
        },
        where: { view: 'it', tab: 'onboarding', label: { en: 'IT › Joining and leaving', ms: 'IT › Masuk dan keluar' } },
      },
      {
        who: { en: 'HR', ms: 'HR' },
        does: {
          en: 'Closes a leaver’s Prima access in HR’s own leaving steps; urgent closure is never held up by this checklist.',
          ms: 'Menutup akses Prima staf yang keluar dalam langkah keluar HR sendiri; penutupan segera tidak sekali-kali ditangguhkan oleh senarai semak ini.',
        },
        where: { view: 'hr', label: { en: 'HR', ms: 'HR' } },
      },
    ],
    rules: [
      {
        en: 'Ticking a step records what staff reported. It does not create or remove an account and is not a certificate.',
        ms: 'Menanda langkah hanya merekod apa yang dilaporkan staf. Ia tidak mencipta atau membuang akaun dan bukan sijil.',
      },
      { en: 'Never enter passwords, tokens or recovery codes.', ms: 'Jangan sekali-kali masukkan kata laluan, token atau kod pemulihan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_MANUAL_UI_HANDOFF.md' },
    words: 'joiner leaver onboarding offboarding staf baharu masuk keluar berhenti checklist senarai semak',
  },
  {
    id: 'it-hr-it-intake',
    app: 'it',
    title: { en: 'HR / IT coordination for a joiner’s or leaver’s sign-in', ms: 'Koordinasi HR / IT bagi log masuk staf yang masuk atau keluar' },
    purpose: {
      en: 'HR proposes a person’s role and one company; the CoS and the Company Head approve the same version; the HR Administrator reviews the handoff. Nothing is applied in Microsoft or Prima.',
      ms: 'HR mencadangkan peranan dan satu syarikat bagi seseorang; CoS dan Ketua Syarikat meluluskan versi yang sama; Pentadbir HR menyemak serahan. Tiada apa yang dilaksanakan dalam Microsoft atau Prima.',
    },
    start: { view: 'hr-it-intake', label: { en: 'Prepare HR joining / leaving intake', ms: 'Sediakan pengambilan masuk / keluar HR' } },
    starter: { en: 'HR, for its own companies', ms: 'HR, bagi syarikat di bawahnya' },
    steps: [
      {
        who: { en: 'HR', ms: 'HR' },
        does: {
          en: 'Picks the existing staff record, one company, the ordinary role, the effective date and the reason.',
          ms: 'Memilih rekod staf sedia ada, satu syarikat, peranan biasa, tarikh berkuat kuasa dan sebab.',
        },
        where: { view: 'hr-it-intake', label: { en: 'HR / IT coordination', ms: 'Koordinasi HR / IT' } },
      },
      {
        who: { en: 'IT Lead (or an IT Executive with an IT Manager-approved delegation)', ms: 'Ketua IT (atau Eksekutif IT dengan delegasi yang diluluskan Pengurus IT)' },
        does: {
          en: 'Adds the Microsoft sign-in details, marked unverified. A delegation is for one task and lasts at most 7 days.',
          ms: 'Menambah butiran log masuk Microsoft, ditanda belum disahkan. Delegasi adalah untuk satu tugas dan paling lama 7 hari.',
        },
        where: { view: 'hr-it-intake', label: { en: 'HR / IT coordination', ms: 'Koordinasi HR / IT' } },
      },
      {
        who: { en: 'CoS and the Company Head (two different people)', ms: 'CoS dan Ketua Syarikat (dua orang berbeza)' },
        does: { en: 'Each reviews the same exact version.', ms: 'Masing-masing menyemak versi yang sama.' },
        where: { view: 'hr-it-intake', label: { en: 'HR / IT coordination', ms: 'Koordinasi HR / IT' } },
        decision: true,
      },
      {
        who: { en: 'HR Administrator', ms: 'Pentadbir HR' },
        does: {
          en: 'Reviews the handoff after both approvals. The request then waits for directory verification.',
          ms: 'Menyemak serahan selepas kedua-dua kelulusan. Permohonan kemudian menunggu pengesahan direktori.',
        },
        where: { view: 'hr-it-intake', label: { en: 'HR / IT coordination', ms: 'Koordinasi HR / IT' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'The person concerned and the author cannot approve. Any change after an approval cancels the earlier approvals.',
        ms: 'Orang yang terlibat dan penyedia tidak boleh meluluskan. Sebarang perubahan selepas kelulusan membatalkan kelulusan sebelumnya.',
      },
      {
        en: 'No account is linked, created or removed here. A leaver’s urgent access closure follows its own procedure.',
        ms: 'Tiada akaun dipautkan, dicipta atau dibuang di sini. Penutupan akses segera bagi staf yang keluar mengikut prosedurnya sendiri.',
      },
    ],
    status: 'off',
    statusNote: {
      en: 'Built. Until the trusted tenant and the CoS, Company Head and HR Administrator mappings are set up by a separate reviewed process, requests show “pending setup”.',
      ms: 'Sudah dibina. Sehingga tenant dipercayai dan pemetaan CoS, Ketua Syarikat dan Pentadbir HR disediakan melalui proses semakan berasingan, permohonan memaparkan “pending setup”.',
    },
    source: { doc: 'docs/HR_IT_INTAKE_PILOT.md' },
    words: 'hr it intake onboarding offboarding sign-in log masuk microsoft entra coordination koordinasi',
  },
  {
    id: 'it-accounts-access',
    app: 'it',
    title: { en: 'Add a Prima sign-in or change company access', ms: 'Tambah log masuk Prima atau ubah akses syarikat' },
    purpose: {
      en: 'IT or central HR prepares new accounts, real names and company access as one request; the HR Director or the CEO approves it and every line goes in together.',
      ms: 'IT atau HR pusat menyediakan akaun baharu, nama sebenar dan akses syarikat dalam satu permohonan; Pengarah HR atau CEO meluluskannya dan semua baris dimasukkan serentak.',
    },
    start: { view: 'accounts', label: { en: 'Add a new account', ms: 'Tambah akaun baharu' } },
    starter: { en: 'IT Manager, IT Lead, IT Executive or central HR', ms: 'Pengurus IT, Ketua IT, Eksekutif IT atau HR pusat' },
    steps: [
      {
        who: { en: 'IT or central HR', ms: 'IT atau HR pusat' },
        does: {
          en: 'Adds lines (a new account, a change to an account, or company office staff from the staff directory) and sends the request. Not for your own account.',
          ms: 'Menambah baris (akaun baharu, perubahan akaun, atau staf pejabat syarikat dari direktori staf) dan menghantar permohonan. Bukan untuk akaun sendiri.',
        },
        where: { view: 'accounts', label: { en: 'Accounts and access', ms: 'Akaun dan akses' } },
      },
      {
        who: { en: 'HR Director (CoS or DCoS) or the CEO; the CEO for a leader’s account', ms: 'Pengarah HR (CoS atau DCoS) atau CEO; CEO bagi akaun pemimpin' },
        does: {
          en: 'Approves or returns it with a comment of at least 3 characters. Once approved, every line goes in together or none does.',
          ms: 'Meluluskan atau memulangkannya dengan ulasan sekurang-kurangnya 3 aksara. Setelah diluluskan, semua baris dimasukkan serentak atau tiada langsung.',
        },
        where: { view: 'accounts', label: { en: 'Accounts and access', ms: 'Akaun dan akses' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Never your own request, and never a request that touches your own account.',
        ms: 'Tidak sekali-kali permohonan sendiri, dan tidak sekali-kali permohonan yang melibatkan akaun sendiri.',
      },
      {
        en: 'Company access lasts one year by default, or to a chosen date at most 3 years ahead, then must be renewed. Ended access stops the day before the approval day.',
        ms: 'Akses syarikat berlaku setahun secara lalai, atau hingga tarikh dipilih paling lama 3 tahun, kemudian perlu diperbaharui. Akses yang ditamatkan berhenti sehari sebelum hari kelulusan.',
      },
      {
        en: 'Closing a leaver’s access stays in HR’s leaving steps. The CEO’s own account, system feeds, site devices and guards are never changed here.',
        ms: 'Menutup akses staf yang keluar kekal dalam langkah keluar HR. Akaun CEO sendiri, suapan sistem, peranti tapak dan pengawal tidak diubah di sini.',
      },
    ],
    status: 'draft',
    statusNote: {
      en: 'Its database module (accounts-access-v1) is not installed on the live system yet.',
      ms: 'Modul pangkalan datanya (accounts-access-v1) belum dipasang pada sistem langsung.',
    },
    source: { doc: 'docs/ACCOUNTS_AND_ACCESS.md', decided: 'Fauzan, 15 Nov 2026 ("Build it now")' },
    words: 'account akaun sign-in log masuk access akses company syarikat login user pengguna',
  },
  {
    id: 'it-system-access',
    app: 'it',
    title: { en: 'Who may use a system: access requests and reviews', ms: 'Siapa boleh menggunakan sistem: permohonan dan semakan akses' },
    purpose: {
      en: 'The CEO owns every system and decides who may sign in; IT records the systems, the access requests and the CEO’s decisions and carries them out.',
      ms: 'CEO memiliki setiap sistem dan memutuskan siapa boleh log masuk; IT merekod sistem, permohonan akses dan keputusan CEO serta melaksanakannya.',
    },
    start: { view: 'it', tab: 'systems', label: { en: 'Systems and access', ms: 'Sistem dan akses' } },
    starter: { en: 'IT staff', ms: 'Staf IT' },
    steps: [
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Registers an existing system with its people; MFA and access review start as unknown until recorded.',
          ms: 'Mendaftar sistem sedia ada dengan orang yang terlibat; MFA dan semakan akses bermula sebagai tidak diketahui sehingga direkod.',
        },
        where: { view: 'it', tab: 'systems', label: { en: 'IT › Systems and access', ms: 'IT › Sistem dan akses' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: { en: 'Asks the CEO to change access for a person, with a reason.', ms: 'Meminta CEO menukar akses seseorang, dengan sebab.' },
        where: { view: 'it', tab: 'systems', label: { en: 'IT › Systems and access', ms: 'IT › Sistem dan akses' } },
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: { en: 'Approves or refuses the access request.', ms: 'Meluluskan atau menolak permohonan akses.' },
        where: { view: 'it', tab: 'systems', label: { en: 'IT › Systems and access', ms: 'IT › Sistem dan akses' } },
        decision: true,
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Makes the change in the system itself (outside Prima) and keeps the evidence separate from the approval.',
          ms: 'Membuat perubahan dalam sistem itu sendiri (di luar Prima) dan menyimpan bukti berasingan daripada kelulusan.',
        },
        outside: true,
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: { en: 'Confirms each system’s access list every 90 days.', ms: 'Mengesahkan senarai akses setiap sistem setiap 90 hari.' },
        where: { view: 'it', tab: 'systems', label: { en: 'IT › Systems and access', ms: 'IT › Sistem dan akses' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Recording an access decision does not give or remove access in the system.',
        ms: 'Merekod keputusan akses tidak memberi atau membuang akses dalam sistem.',
      },
      { en: 'Never enter passwords, tokens or recovery codes.', ms: 'Jangan sekali-kali masukkan kata laluan, token atau kod pemulihan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_MANUAL_UI_HANDOFF.md', decided: 'Fauzan, 28 Oct 2026: the CEO owns every system; access review every 90 days (rule IT-JOBS)' },
    words: 'system sistem access akses permission kebenaran ceo review semakan mfa',
  },
  {
    id: 'it-sharepoint-request',
    app: 'it',
    title: { en: 'A SharePoint site or library for your team', ms: 'Laman atau pustaka SharePoint untuk pasukan anda' },
    purpose: {
      en: 'Staff ask IT for a SharePoint site or library; IT records the guidance with its owner and next review, and the IT Manager checks it independently.',
      ms: 'Staf meminta IT untuk laman atau pustaka SharePoint; IT merekod panduan dengan pemilik dan tarikh semakan seterusnya, dan Pengurus IT menyemaknya secara bebas.',
    },
    start: { view: 'it', tab: 'mine', label: { en: 'Ask IT for help (Microsoft 365)', ms: 'Minta bantuan IT (Microsoft 365)' } },
    starter: { en: 'Any staff member', ms: 'Mana-mana staf' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Asks IT with a help request about Microsoft 365, giving the site or library address if there is one.',
          ms: 'Meminta IT melalui tiket bantuan berkenaan Microsoft 365, dengan alamat laman atau pustaka jika ada.',
        },
        where: { view: 'it', tab: 'mine', label: { en: 'IT › My requests', ms: 'IT › Permohonan saya' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records SharePoint guidance: the site owner, the IT person responsible, the address (or pending), the next review and the evidence.',
          ms: 'Merekod panduan SharePoint: pemilik laman, staf IT yang bertanggungjawab, alamat (atau belum ada), semakan seterusnya dan bukti.',
        },
        where: { view: 'it', tab: 'systems', label: { en: 'IT › Systems and access', ms: 'IT › Sistem dan akses' } },
      },
      {
        who: { en: 'IT Manager (not the author or the responsible person)', ms: 'Pengurus IT (bukan penulis atau orang yang bertanggungjawab)' },
        does: { en: 'Independently checks the evidence.', ms: 'Menyemak bukti secara bebas.' },
        where: { view: 'it', tab: 'systems', label: { en: 'IT › Systems and access', ms: 'IT › Sistem dan akses' } },
        decision: true,
      },
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: { en: 'Confirms the help request is fixed.', ms: 'Mengesahkan tiket bantuan telah selesai.' },
        where: { view: 'it', tab: 'mine', label: { en: 'IT › My requests', ms: 'IT › Permohonan saya' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'The guidance record says “not connected”: it does not create a site, give permissions or prove a connection works.',
        ms: 'Rekod panduan menyatakan “not connected”: ia tidak mencipta laman, memberi kebenaran atau membuktikan sambungan berfungsi.',
      },
      {
        en: 'Prima’s own SharePoint connection stays off until the CEO approves the Microsoft consent and site grants.',
        ms: 'Sambungan SharePoint Prima sendiri kekal dimatikan sehingga CEO meluluskan kebenaran Microsoft dan pemberian akses laman.',
      },
    ],
    status: 'in_force',
    statusNote: {
      en: 'The manual guidance is in use. Checking SharePoint access from Prima (Connections) is switched off.',
      ms: 'Panduan manual sedang digunakan. Semakan akses SharePoint dari Prima (Sambungan) dimatikan.',
    },
    source: { doc: 'docs/CONNECTIONS_SHAREPOINT_PILOT.md' },
    words: 'sharepoint site laman library pustaka folder teams microsoft 365 connection sambungan',
  },
  {
    id: 'it-login-handover',
    app: 'it',
    title: { en: 'Move a person’s sign-in after a transfer', ms: 'Memindahkan log masuk selepas pertukaran' },
    purpose: {
      en: 'When a transfer to another company is applied, IT moves the person’s accounts to the new company once the HR Director has authorised it, and Prima checks the result.',
      ms: 'Apabila pertukaran ke syarikat lain dilaksanakan, IT memindahkan akaun orang itu ke syarikat baharu setelah Pengarah HR membenarkannya, dan Prima menyemak hasilnya.',
    },
    start: { view: 'it', label: { en: 'IT › Login handovers after a transfer', ms: 'IT › Serahan log masuk selepas pertukaran' } },
    starter: { en: 'Prima, when HR applies a transfer', ms: 'Prima, apabila HR melaksanakan pertukaran' },
    steps: [
      {
        who: { en: 'HR Director (or the CEO)', ms: 'Pengarah HR (atau CEO)' },
        does: {
          en: 'Authorises the login move with a reason; not the preparer, the applier or the person moved.',
          ms: 'Membenarkan pemindahan log masuk dengan sebab; bukan penyedia, pelaksana atau orang yang dipindahkan.',
        },
        where: { view: 'hr', label: { en: 'HR', ms: 'HR' } },
        decision: true,
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Moves each account through the approved account process (outside this panel).',
          ms: 'Memindahkan setiap akaun melalui proses akaun yang diluluskan (di luar panel ini).',
        },
        outside: true,
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Presses Confirm login moved with what was changed. Prima refuses unless every account points to the new record, reaches the new company and no longer reaches the old one.',
          ms: 'Menekan Confirm login moved dengan apa yang diubah. Prima menolak kecuali setiap akaun menuju rekod baharu, boleh mencapai syarikat baharu dan tidak lagi mencapai syarikat lama.',
        },
        where: { view: 'it', label: { en: 'IT › Login handovers after a transfer', ms: 'IT › Serahan log masuk selepas pertukaran' } },
      },
    ],
    rules: [
      { en: 'Nobody confirms their own move.', ms: 'Tiada sesiapa mengesahkan pemindahan sendiri.' },
      {
        en: 'Until the move is confirmed, self-service on the old record refuses leave with a plain explanation.',
        ms: 'Sehingga pemindahan disahkan, layan diri pada rekod lama menolak cuti dengan penjelasan yang jelas.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Arisha main review, 3 Nov 2026' },
    words: 'transfer pertukaran login log masuk handover serahan account akaun move pindah company syarikat',
  },
  {
    id: 'it-outlook-email-job',
    app: 'it',
    title: { en: 'Attach an Outlook email to an IT job', ms: 'Lampirkan e-mel Outlook pada tugasan IT' },
    purpose: {
      en: 'A person working on an IT job copies one chosen Outlook email onto the job as evidence. Sending and replying stay in Outlook.',
      ms: 'Orang yang menguruskan tugasan IT menyalin satu e-mel Outlook yang dipilih ke tugasan sebagai bukti. Menghantar dan membalas kekal dalam Outlook.',
    },
    start: { view: 'it', tab: 'jobs', label: { en: 'IT › Jobs › Outlook emails on this job', ms: 'IT › Tugasan › E-mel Outlook pada tugasan ini' } },
    starter: {
      en: 'The job’s assignee, the person who gave the job, the IT Manager, the IT Lead or the COO',
      ms: 'Penama tugasan, orang yang memberi tugasan, Pengurus IT, Ketua IT atau COO',
    },
    steps: [
      {
        who: { en: 'Job worker', ms: 'Pelaksana tugasan' },
        does: {
          en: 'Opens the email in Outlook on the web and copies its link.',
          ms: 'Membuka e-mel dalam Outlook di web dan menyalin pautannya.',
        },
        outside: true,
      },
      {
        who: { en: 'Job worker', ms: 'Pelaksana tugasan' },
        does: {
          en: 'Pastes the link on the job, presses Preview this email, then Attach to this job. The copy is kept 30 days.',
          ms: 'Menampal pautan pada tugasan, menekan Preview this email, kemudian Attach to this job. Salinan disimpan 30 hari.',
        },
        where: { view: 'it', tab: 'jobs', label: { en: 'IT › Jobs', ms: 'IT › Tugasan' } },
      },
    ],
    rules: [
      {
        en: 'Prima reads only the one email you choose, from your own mailbox. No inbox reading, no AI reading, no file attachments.',
        ms: 'Prima hanya membaca satu e-mel yang anda pilih, dari peti mel anda sendiri. Tiada bacaan peti masuk, tiada bacaan AI, tiada lampiran fail.',
      },
      { en: 'Staff send and reply in Outlook; Prima has no Send.', ms: 'Staf menghantar dan membalas dalam Outlook; Prima tiada fungsi Hantar.' },
    ],
    status: 'off',
    statusNote: {
      en: 'Built. Waits for the CEO to approve the Microsoft mail permission and switch it on.',
      ms: 'Sudah dibina. Menunggu CEO meluluskan kebenaran mel Microsoft dan menghidupkannya.',
    },
    source: { doc: 'docs/STAFF_EMAIL_POWER_BI.md', decided: 'Fauzan, 31 Oct 2026 (send stays in Outlook; only emails attached to a job; 30 days)' },
    words: 'outlook email e-mel attach lampir job tugasan evidence bukti mail',
  },
  {
    id: 'it-import-work',
    app: 'it',
    title: { en: 'Import open IT work from a sheet (CEO)', ms: 'Import kerja IT terbuka dari helaian (CEO)' },
    purpose: {
      en: 'The CEO pastes or chooses a sheet of open help requests or IT jobs, reviews the preview and approves the batch once.',
      ms: 'CEO menampal atau memilih helaian tiket bantuan atau tugasan IT yang terbuka, menyemak pratonton dan meluluskan kumpulan itu sekali.',
    },
    start: { view: 'it', tab: 'import', label: { en: 'IT › Import', ms: 'IT › Import' } },
    starter: { en: 'The CEO only', ms: 'CEO sahaja' },
    steps: [
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: {
          en: 'Pastes rows from Excel or chooses a CSV file, and says where they came from.',
          ms: 'Menampal baris dari Excel atau memilih fail CSV, dan menyatakan sumbernya.',
        },
        where: { view: 'it', tab: 'import', label: { en: 'IT › Import', ms: 'IT › Import' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Shows a preview: errors per row, repeats of earlier rows or of open items, and which heading was read as which field. Nothing is written yet.',
          ms: 'Memaparkan pratonton: ralat setiap baris, ulangan baris atau item terbuka sedia ada, dan tajuk yang dibaca sebagai medan mana. Tiada apa ditulis lagi.',
        },
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: {
          en: 'Leaves out any rows and approves. Only new items are created; nothing is updated, merged or deleted.',
          ms: 'Mengecualikan baris jika perlu dan meluluskan. Hanya item baharu dicipta; tiada apa dikemas kini, digabung atau dipadam.',
        },
        where: { view: 'it', tab: 'import', label: { en: 'IT › Import', ms: 'IT › Import' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'At most 200 rows per batch.', ms: 'Paling banyak 200 baris bagi setiap kumpulan.' },
      {
        en: 'Approving the same batch again returns the first result instead of importing twice.',
        ms: 'Meluluskan kumpulan yang sama sekali lagi memulangkan hasil pertama, bukan mengimport dua kali.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_IMPORT_HANDOVER.md' },
    words: 'import excel csv sheet helaian batch kumpulan tickets jobs',
  },
  {
    id: 'it-record-cleanup',
    app: 'it',
    title: { en: 'Correct or archive a manual IT record', ms: 'Membetulkan atau mengarkib rekod IT manual' },
    purpose: {
      en: 'IT corrects the descriptive details of a device, system or joining/leaving record with a reason, and a separate IT Lead review decides whether a suspected test record may be archived.',
      ms: 'IT membetulkan butiran deskriptif peranti, sistem atau rekod masuk/keluar dengan sebab, dan semakan Ketua IT yang berasingan memutuskan sama ada rekod yang disyaki ujian boleh diarkib.',
    },
    start: { view: 'it', tab: 'assets', label: { en: 'IT › Assets', ms: 'IT › Aset' } },
    starter: { en: 'The IT person responsible for the record, or the IT Manager or IT Lead', ms: 'Staf IT yang bertanggungjawab atas rekod, atau Pengurus IT atau Ketua IT' },
    steps: [
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Corrects serial, model, location or warranty (or a system’s note, or a joiner’s date and title) with a reason.',
          ms: 'Membetulkan nombor siri, model, lokasi atau waranti (atau catatan sistem, atau tarikh dan jawatan staf baharu) dengan sebab.',
        },
        where: { view: 'it', tab: 'assets', label: { en: 'IT › Assets', ms: 'IT › Aset' } },
      },
      {
        who: { en: 'IT staff', ms: 'Staf IT' },
        does: {
          en: 'Nominates a record they believe is test data, with a documentary origin summary and reference.',
          ms: 'Mencalonkan rekod yang dipercayai data ujian, dengan ringkasan asal-usul dan rujukan dokumen.',
        },
        where: { view: 'it', tab: 'assets', label: { en: 'IT › Assets', ms: 'IT › Aset' } },
      },
      {
        who: { en: 'A different IT Lead (not the creator or nominator)', ms: 'Ketua IT lain (bukan pencipta atau pencalon)' },
        does: {
          en: 'Records a hold, or archives the exact record when its demo origin is verified and nothing depends on it. An archived record can be restored.',
          ms: 'Merekod penahanan, atau mengarkib rekod tersebut apabila asal-usul demonya disahkan dan tiada yang bergantung padanya. Rekod yang diarkib boleh dipulihkan.',
        },
        where: { view: 'it', tab: 'assets', label: { en: 'IT › Assets', ms: 'IT › Aset' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'A correction never changes identity, company, access, payments or inspection history.',
        ms: 'Pembetulan tidak sekali-kali mengubah identiti, syarikat, akses, bayaran atau sejarah pemeriksaan.',
      },
      {
        en: 'Nothing is ever deleted. A record linked to a purchase, bill, inspection or access stays protected.',
        ms: 'Tiada apa dipadam. Rekod yang dipautkan kepada pembelian, bil, pemeriksaan atau akses kekal dilindungi.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/IT_RECORD_CORRECTIONS.md' },
    words: 'correction pembetulan cleanup pembersihan archive arkib demo test ujian wrong salah',
  },
  {
    id: 'it-workflow-timing',
    app: 'it',
    title: { en: 'Record how long IT work takes', ms: 'Merekod tempoh kerja IT' },
    purpose: {
      en: 'Staff record their own work, waiting and handoff time on an assigned IT job or help request, to see how long work takes and how well it is done.',
      ms: 'Staf merekod masa kerja, menunggu dan serahan mereka sendiri pada tugasan IT atau tiket bantuan yang diberi, untuk melihat tempoh dan kualiti kerja.',
    },
    start: { view: 'it-metrics', label: { en: 'Open prospective timing', ms: 'Mula rekod masa' } },
    starter: { en: 'The person assigned the stage of work', ms: 'Orang yang diberi peringkat kerja itu' },
    steps: [
      {
        who: { en: 'IT person', ms: 'Staf IT' },
        does: {
          en: 'Opens timing on their job or request, then starts, pauses, records an outside wait (with who follows up, why and the next review time) and marks it ready for handoff.',
          ms: 'Membuka rekod masa pada tugasan atau tiket sendiri, kemudian mula, jeda, merekod menunggu pihak luar (dengan siapa menyusul, sebab dan masa semakan seterusnya) dan menandanya sedia untuk diserahkan.',
        },
        where: { view: 'it-metrics', label: { en: 'Workflow time & quality', ms: 'Masa & kualiti kerja' } },
      },
      {
        who: { en: 'IT person', ms: 'Staf IT' },
        does: {
          en: 'Submits, checks or confirms the work itself in the normal IT screens; timing only syncs the recorded result.',
          ms: 'Menghantar, menyemak atau mengesahkan kerja itu sendiri dalam skrin IT biasa; rekod masa hanya menyelaraskan hasil yang direkod.',
        },
        where: { view: 'it', tab: 'work', label: { en: 'IT › My work', ms: 'IT › Kerja saya' } },
      },
      {
        who: { en: 'IT Manager', ms: 'Pengurus IT' },
        does: { en: 'Records provisional time targets.', ms: 'Merekod sasaran masa sementara.' },
        where: { view: 'it-metrics', label: { en: 'Workflow time & quality', ms: 'Masa & kualiti kerja' } },
      },
    ],
    rules: [
      {
        en: 'Staff-recorded intervals, not attendance, screen watching or a staff ranking. Total elapsed time never pauses.',
        ms: 'Tempoh yang direkod staf, bukan kehadiran, pemantauan skrin atau ranking staf. Jumlah masa berlalu tidak pernah berhenti.',
      },
      {
        en: 'Earlier time and missing quality evidence stay unknown, never zero or a pass.',
        ms: 'Masa lebih awal dan bukti kualiti yang tiada kekal tidak diketahui, bukan sifar atau lulus.',
      },
    ],
    status: 'in_force',
    statusNote: {
      en: 'Covers IT jobs and help requests (including linked website requests). The HR review of these numbers is not built yet.',
      ms: 'Meliputi tugasan IT dan tiket bantuan (termasuk tiket laman web berkaitan). Semakan HR bagi angka ini belum dibina.',
    },
    source: { doc: 'docs/IT_WORKFLOW_METRICS_UI.md' },
    words: 'timing masa time metrics kualiti quality kpi tempoh',
  },
  {
    id: 'it-continuity',
    app: 'it',
    title: { en: 'Backups, restore tests and continuity drills', ms: 'Sandaran, ujian pemulihan dan latihan kesinambungan' },
    purpose: {
      en: 'Every system keeps copies in the cloud, on our own server and on an emergency server; IT records each backup, restore test and drill.',
      ms: 'Setiap sistem menyimpan salinan di awan, pelayan sendiri dan pelayan kecemasan; IT merekod setiap sandaran, ujian pemulihan dan latihan.',
    },
    start: { view: 'continuity', tab: 'systems', label: { en: 'Continuity', ms: 'Kesinambungan' } },
    starter: { en: 'IT', ms: 'IT' },
    steps: [
      {
        who: { en: 'IT', ms: 'IT' },
        does: { en: 'Adds each system and its copies.', ms: 'Menambah setiap sistem dan salinannya.' },
        where: { view: 'continuity', tab: 'systems', label: { en: 'Continuity › Systems', ms: 'Kesinambungan › Sistem' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: {
          en: 'Records each backup and each restore test (date, result, hours to restore, minutes of data lost).',
          ms: 'Merekod setiap sandaran dan ujian pemulihan (tarikh, keputusan, jam untuk pulih, minit data hilang).',
        },
        where: { view: 'continuity', tab: 'systems', label: { en: 'Continuity › Systems', ms: 'Kesinambungan › Sistem' } },
      },
      {
        who: { en: 'IT', ms: 'IT' },
        does: { en: 'Records each playbook drill (for example “Prima is down”).', ms: 'Merekod setiap latihan buku panduan (contohnya “Prima is down”).' },
        where: { view: 'continuity', tab: 'playbooks', label: { en: 'Continuity › Playbooks', ms: 'Kesinambungan › Buku panduan' } },
      },
    ],
    rules: [
      {
        en: 'A copy counts only when backed up within its target and restored in a test in the last 6 months. No record means unknown.',
        ms: 'Salinan hanya dikira jika disandarkan dalam sasaran dan dipulihkan dalam ujian dalam 6 bulan terakhir. Tiada rekod bermaksud tidak diketahui.',
      },
      { en: 'Every playbook is drilled at least every 12 months.', ms: 'Setiap buku panduan dilatih sekurang-kurangnya setiap 12 bulan.' },
    ],
    status: 'draft',
    statusNote: {
      en: 'The screen works; the recovery targets are proposals for IT and Fauzan to confirm.',
      ms: 'Skrin berfungsi; sasaran pemulihan masih cadangan untuk disahkan oleh IT dan Fauzan.',
    },
    source: { doc: 'docs/MASTERPLAN_LEDGER_2026-11-03.md', decided: 'Fauzan, 24 Oct 2026 (V15), rule BCM-RTO' },
    words: 'backup sandaran restore pulih continuity kesinambungan disaster bencana drill latihan server pelayan',
  },
  {
    id: 'it-ja-switch',
    app: 'it',
    title: { en: 'Switch an area from the JA Group app to Prima', ms: 'Menukar satu bidang dari aplikasi JA Group ke Prima' },
    purpose: {
      en: 'One company and one area at a time: Prima and JA run side by side, every difference is explained, ACT checks the report and the CEO switches.',
      ms: 'Satu syarikat dan satu bidang pada satu masa: Prima dan JA berjalan serentak, setiap perbezaan dijelaskan, ACT menyemak laporan dan CEO menukar.',
    },
    start: { view: 'jaswitch', tab: 'areas', label: { en: 'Switch from JA › Areas', ms: 'Tukar dari JA › Bidang' } },
    starter: { en: 'CEO or COO', ms: 'CEO atau COO' },
    steps: [
      {
        who: { en: 'ACT staff, then the ACT Lead or Deputy (a different person)', ms: 'Staf ACT, kemudian Ketua atau Timbalan ACT (orang berbeza)' },
        does: {
          en: 'ACT stages a JA export file for one company; Prima lists bad rows and unknown staff numbers; the ACT Lead or Deputy approves the exact file.',
          ms: 'ACT memuat naik fail eksport JA bagi satu syarikat; Prima menyenaraikan baris salah dan nombor staf yang tidak dikenali; Ketua atau Timbalan ACT meluluskan fail tersebut.',
        },
        where: { view: 'jaswitch', tab: 'files', label: { en: 'Switch from JA › JA files', ms: 'Tukar dari JA › Fail JA' } },
        decision: true,
      },
      {
        who: { en: 'CEO or COO', ms: 'CEO atau COO' },
        does: {
          en: 'Starts a side-by-side run for one company and one area (incidents, attendance, patrol, guard pay, hostels).',
          ms: 'Memulakan larian serentak bagi satu syarikat dan satu bidang (insiden, kehadiran, rondaan, gaji pengawal, asrama).',
        },
        where: { view: 'jaswitch', tab: 'areas', label: { en: 'Switch from JA › Areas', ms: 'Tukar dari JA › Bidang' } },
      },
      {
        who: { en: 'The people who run the area (Operations, HR, FWM, company manager)', ms: 'Orang yang menjalankan bidang itu (Operasi, HR, FWM, pengurus syarikat)' },
        does: { en: 'Explain or fix each difference, with a note.', ms: 'Menjelaskan atau membetulkan setiap perbezaan, dengan catatan.' },
        where: { view: 'jaswitch', tab: 'areas', label: { en: 'Switch from JA › Areas', ms: 'Tukar dari JA › Bidang' } },
      },
      {
        who: { en: 'ACT Lead or Deputy', ms: 'Ketua atau Timbalan ACT' },
        does: {
          en: 'Checks the report after the run, never one where they explained a difference. A data change afterwards cancels the check.',
          ms: 'Menyemak laporan selepas larian, tidak sekali-kali laporan yang mereka jelaskan perbezaannya. Perubahan data selepas itu membatalkan semakan.',
        },
        where: { view: 'jaswitch', tab: 'areas', label: { en: 'Switch from JA › Areas', ms: 'Tukar dari JA › Bidang' } },
        decision: true,
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: {
          en: 'Switches the area for that company with a reason; JA stays read-only for the set number of days. Only the CEO can undo it.',
          ms: 'Menukar bidang itu bagi syarikat tersebut dengan sebab; JA kekal baca sahaja untuk bilangan hari yang ditetapkan. Hanya CEO boleh membatalkannya.',
        },
        where: { view: 'jaswitch', tab: 'areas', label: { en: 'Switch from JA › Areas', ms: 'Tukar dari JA › Bidang' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'The ACT Director sets the numbers (days side by side, tolerances, read-only days) with a reason; a run keeps the numbers it started with.',
        ms: 'Pengarah ACT menetapkan angka (hari serentak, toleransi, hari baca sahaja) dengan sebab; setiap larian mengekalkan angka semasa ia bermula.',
      },
      {
        en: 'A day with no approved JA data is unknown, never matching. A value that looks like a full IC number is refused.',
        ms: 'Hari tanpa data JA yang diluluskan adalah tidak diketahui, bukan sepadan. Nilai yang kelihatan seperti nombor IC penuh ditolak.',
      },
    ],
    status: 'off',
    statusNote: {
      en: 'Test data only. Switching records the decision; it does not yet turn screens on or off, and the JA date is a switch Fauzan holds.',
      ms: 'Data ujian sahaja. Pertukaran merekod keputusan; ia belum menghidupkan atau mematikan skrin, dan tarikh JA ialah suis yang dipegang Fauzan.',
    },
    source: { doc: 'docs/JA_SWITCH_OVER.md', decided: 'Fauzan, 5 Nov 2026 (one month side by side, then switch by area)' },
    words: 'ja group app switch tukar side by side serentak act report laporan import history sejarah',
  },
  {
    id: 'it-ja-feed',
    app: 'it',
    title: { en: 'Guard data from the JA Group app', ms: 'Data pengawal dari aplikasi JA Group' },
    purpose: {
      en: 'Guards are keyed in once, in JA; Prima files each guard read-only for HR, the guard’s company and Operations, and shows a late feed as unknown.',
      ms: 'Pengawal dimasukkan sekali sahaja, dalam JA; Prima memfailkan setiap pengawal secara baca sahaja untuk HR, syarikat pengawal dan Operasi, dan memaparkan suapan lewat sebagai tidak diketahui.',
    },
    start: { view: 'ja', label: { en: 'JA Group app', ms: 'Aplikasi JA Group' } },
    starter: { en: 'The JA feed’s own system account', ms: 'Akaun sistem suapan JA sendiri' },
    steps: [
      {
        who: { en: 'JA Group app', ms: 'Aplikasi JA Group' },
        does: {
          en: 'Sends guard records in batches of up to 1,000; Prima lists every rejected record with its reason.',
          ms: 'Menghantar rekod pengawal dalam kumpulan hingga 1,000; Prima menyenaraikan setiap rekod yang ditolak dengan sebabnya.',
        },
      },
      {
        who: { en: 'IT, HR, Operations, company manager', ms: 'IT, HR, Operasi, pengurus syarikat' },
        does: {
          en: 'Read the deliveries, guards, papers due, payroll and incidents they are allowed to see. A company with no delivery past the stale limit shows as unknown.',
          ms: 'Membaca penghantaran, pengawal, dokumen yang hampir tamat, gaji dan insiden yang dibenarkan. Syarikat tanpa penghantaran melebihi had lewat dipaparkan sebagai tidak diketahui.',
        },
        where: { view: 'ja', label: { en: 'JA Group app', ms: 'Aplikasi JA Group' } },
      },
    ],
    rules: [
      {
        en: 'Nobody types a guard in again: HR adds people in Prima only where JA does not cover them.',
        ms: 'Tiada sesiapa memasukkan semula pengawal: HR menambah orang dalam Prima hanya jika JA tidak meliputinya.',
      },
      {
        en: 'Full IC and salary account numbers stay behind the HR wall; others see the masked form.',
        ms: 'Nombor IC penuh dan akaun gaji kekal di sebalik dinding HR; orang lain melihat bentuk bertopeng.',
      },
    ],
    status: 'off',
    statusNote: {
      en: 'Preview with test data. The feed is not live: its sign-in and company grants are created by the CEO when it goes live.',
      ms: 'Pratonton dengan data ujian. Suapan belum aktif: log masuk dan akses syarikatnya dicipta oleh CEO apabila ia diaktifkan.',
    },
    source: { doc: 'docs/JA_GUARD_FEED.md' },
    words: 'ja feed suapan guard pengawal sync data jagroup',
  },
];

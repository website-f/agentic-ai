import type { Place, Sop } from '../types';

/** Procurement › Store: the store's stock, issues, returns, counts, Kawalan Inventori and disposal cases. */
const STORE: Place = { view: 'purchasing', tab: 'store', label: { en: 'Procurement › Store', ms: 'Perolehan › Stor' } };
/** Ask for equipment › Ask: the OM's requests, items to pass on, the person's own items, returns and faults. */
const ASK: Place = { view: 'equiprequests', tab: 'ask', label: { en: 'Ask for equipment', ms: 'Mohon peralatan' } };
/** Ask for equipment › Store queue: what the store and the OGM decide. */
const QUEUE: Place = { view: 'equiprequests', tab: 'store', label: { en: 'Store queue', ms: 'Giliran stor' } };

/**
 * P121: Equipment (items, uniforms, site supplies, store, vehicles, assets) and buying for the store. From
 * docs/UNIFORM_REQUESTS.md, SITE_SUPPLIES_REQUESTS.md, INVENTORY_CONTROL.md, DISPOSAL_OF_GOODS.md, ITEM_REGISTER.md,
 * CLEANING_AND_DUTY_PLANNER.md (site fittings), OFFICE_ASSETS.md, AM_*.md, SHORT_STAYS_*.md, WHATSAPP_RENT_REMINDERS.md,
 * docs/system (workflows and screens) and the rules in packages/core/src/rules.ts (PUR-DOA, INV-CONTROL, AST-DEPN).
 */
export const SOPS_EQUIP: Sop[] = [
  {
    id: 'equip-uniform-request',
    app: 'equip',
    title: { en: "A guard's uniform from the Goodwill store", ms: 'Uniform pengawal dari stor Goodwill' },
    purpose: {
      en: 'The OM asks the store for one guard’s uniform; the store issues it; the officer and the guard sign on the OM’s phone.',
      ms: 'OM memohon uniform seorang pengawal daripada stor; stor mengeluarkannya; peronda dan pengawal menandatangan di telefon OM.',
    },
    start: { view: 'equiprequests', tab: 'ask', label: { en: 'Ask for a uniform', ms: 'Mohon uniform' } },
    starter: { en: 'Operations Manager (OM) or Regional OM covering the guard’s company', ms: 'Pengurus Operasi (OM) atau OM Wilayah yang menjaga syarikat pengawal' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Types the guard’s staff number, picks the uniform and size, 1 to 3 pieces, and the reason.',
          ms: 'Taip nombor staf pengawal, pilih uniform dan saiz, 1 hingga 3 helai, dan sebabnya.',
        },
        where: { view: 'equiprequests', tab: 'ask', label: { en: 'Ask for equipment', ms: 'Mohon peralatan' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Counts the pieces the guard had in the last 12 months plus open requests: up to 3 free; every piece after that only with the guard’s paid receipt.',
          ms: 'Mengira helai yang pengawal terima dalam 12 bulan lepas termasuk permohonan terbuka: hingga 3 percuma; selepas itu hanya dengan resit bayaran pengawal.',
        },
      },
      {
        who: { en: 'Storekeeper or Procurement executive', ms: 'Penjaga stor atau eksekutif Perolehan' },
        does: {
          en: 'Issues it to the OM, naming the patrolling officer of the guard’s company, or refuses with a reason the OM can see.',
          ms: 'Mengeluarkannya kepada OM dengan menamakan peronda syarikat pengawal, atau menolak dengan sebab yang OM boleh lihat.',
        },
        where: { view: 'equiprequests', tab: 'store', label: { en: 'Store queue', ms: 'Giliran stor' } },
        decision: true,
      },
      {
        who: { en: 'OM, patrolling officer, guard', ms: 'OM, peronda, pengawal' },
        does: {
          en: 'Under “Items to pass on” the OM confirms receiving it, then the officer and the guard sign on the OM’s phone (or the OM attaches the signed slip and a photo).',
          ms: 'Di bawah “Barang untuk diserahkan” OM sahkan terima, kemudian peronda dan pengawal tandatangan di telefon OM (atau OM lampirkan slip bertandatangan dan gambar).',
        },
        where: { view: 'equiprequests', tab: 'ask', label: { en: 'Items to pass on', ms: 'Barang untuk diserahkan' } },
      },
      {
        who: { en: 'Goodwill (Finance)', ms: 'Goodwill (Kewangan)' },
        does: {
          en: 'Bills the guard’s company only after the guard has acknowledged the item.',
          ms: 'Membil syarikat pengawal hanya selepas pengawal mengakui terima barang.',
        },
        where: { view: 'purchasing', tab: 'store', label: { en: 'Procurement › Store', ms: 'Perolehan › Stor' } },
      },
    ],
    rules: [
      { en: 'One open request per guard per item.', ms: 'Satu permohonan terbuka bagi setiap pengawal bagi setiap barang.' },
      {
        en: 'Pieces after the 3rd in 12 months are paid by the guard with a receipt; never taken from pay.',
        ms: 'Helai selepas yang ke-3 dalam 12 bulan dibayar oleh pengawal dengan resit; tidak sekali-kali dipotong gaji.',
      },
      {
        en: 'A piece within 6 months of the last one needs a reason and is marked “within 6 months”.',
        ms: 'Helai dalam tempoh 6 bulan dari yang terakhir perlu sebab dan ditanda “dalam 6 bulan”.',
      },
      { en: 'The OM may cancel while the request is open. The OGM sees every request but does not decide.', ms: 'OM boleh batalkan semasa permohonan masih terbuka. OGM melihat semua permohonan tetapi tidak memutuskan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/UNIFORM_REQUESTS.md', decided: 'Fauzan, 11 and 13 Nov 2026' },
    words: 'uniform pakaian seragam baju seluar order pesan request mohon goodwill store stor allowance elaun',
  },
  {
    id: 'equip-site-supplies',
    app: 'equip',
    title: { en: 'Site supplies request (Permohonan Pesanan Barang)', ms: 'Permohonan Pesanan Barang (bekalan tapak)' },
    purpose: {
      en: 'Supplies, cleaning stock and guards’ uniforms for a site (KBK, PKK Nepal, PKK Local): asked by the OM, confirmed by the OGM, issued or bought by the store.',
      ms: 'Bekalan, stok pembersihan dan uniform pengawal untuk tapak (KBK, PKK Nepal, PKK Tempatan): dipohon OM, disahkan OGM, dikeluarkan atau dibeli oleh stor.',
    },
    start: { view: 'equiprequests', tab: 'ask', label: { en: 'Ask for site supplies', ms: 'Mohon bekalan tapak' } },
    starter: { en: 'OM or Regional OM covering the site', ms: 'OM atau OM Wilayah yang menjaga tapak' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Enters the lines: store item, size, quantity and purpose (and the guard’s staff number for a personal piece). Prima builds the summary per item and size.',
          ms: 'Masukkan baris: barang stor, saiz, kuantiti dan tujuan (dan nombor staf pengawal untuk barang peribadi). Prima menyusun ringkasan bagi setiap barang dan saiz.',
        },
        where: { view: 'equiprequests', tab: 'ask', label: { en: 'Ask for equipment', ms: 'Mohon peralatan' } },
      },
      {
        who: { en: 'HQ admin executive (PKK Nepal only)', ms: 'Eksekutif admin HQ (PKK Nepal sahaja)' },
        does: {
          en: 'First check: complete and matches the site roster, or returned with a reason.',
          ms: 'Semakan awal: lengkap dan sepadan dengan roster tapak, atau dipulangkan dengan sebab.',
        },
        where: { view: 'equiprequests', tab: 'store', label: { en: 'Store queue', ms: 'Giliran stor' } },
        decision: true,
      },
      {
        who: { en: 'OGM (or the deputy the OGM names)', ms: 'OGM (atau timbalan yang dinamakan OGM)' },
        does: { en: 'Confirms, changes quantities with a reason, or rejects.', ms: 'Mengesahkan, menukar kuantiti dengan sebab, atau menolak.' },
        where: { view: 'equiprequests', tab: 'store', label: { en: 'Store queue', ms: 'Giliran stor' } },
        decision: true,
      },
      {
        who: { en: 'Storekeeper, then Procurement executive', ms: 'Penjaga stor, kemudian eksekutif Perolehan' },
        does: {
          en: 'The storekeeper records what the store can give now; the Procurement executive decides per line: issue from stock or buy (one purchase per category).',
          ms: 'Penjaga stor merekod apa yang stor boleh beri sekarang; eksekutif Perolehan memutuskan setiap baris: keluarkan dari stok atau beli (satu pembelian bagi setiap kategori).',
        },
        where: { view: 'equiprequests', tab: 'store', label: { en: 'Store queue', ms: 'Giliran stor' } },
        decision: true,
      },
      {
        who: { en: 'Store (two people)', ms: 'Stor (dua orang)' },
        does: {
          en: 'Stock prepared, checked by a second person (PIC), ready to send; then issued with a DO in two copies.',
          ms: 'Stok disediakan, disemak oleh orang kedua (PIC), sedia untuk dihantar; kemudian dikeluarkan dengan DO dua salinan.',
        },
        where: { view: 'purchasing', tab: 'store', label: { en: 'Procurement › Store', ms: 'Perolehan › Stor' } },
      },
      {
        who: { en: 'OM or site supervisor', ms: 'OM atau penyelia tapak' },
        does: {
          en: 'Counts what arrived (photo; short or damaged needs a note), then hands each piece to the guard, who signs on the OM’s phone.',
          ms: 'Mengira barang yang tiba (gambar; kurang atau rosak perlu catatan), kemudian menyerahkan setiap helai kepada pengawal yang menandatangan di telefon OM.',
        },
        where: { view: 'equiprequests', tab: 'ask', label: { en: 'Items to pass on', ms: 'Barang untuk diserahkan' } },
      },
    ],
    rules: [
      { en: 'Nobody confirms their own request.', ms: 'Tiada sesiapa mengesahkan permohonan sendiri.' },
      { en: 'One open request per site per item (per guard for a personal piece).', ms: 'Satu permohonan terbuka bagi setiap tapak bagi setiap barang (bagi setiap pengawal untuk barang peribadi).' },
      { en: 'In-stock lines are due ready within 7 working days of approval.', ms: 'Baris yang ada stok perlu siap dalam 7 hari bekerja selepas kelulusan.' },
      { en: 'Nothing is issued while a major stock count is open, unless the OGM lets an urgent one through.', ms: 'Tiada barang dikeluarkan semasa kiraan stok besar dibuka, kecuali OGM membenarkan yang segera.' },
      {
        en: 'During the changeover the paper form, email and SharePoint upload are still sent as well.',
        ms: 'Dalam tempoh peralihan, borang kertas, e-mel dan muat naik SharePoint masih dihantar juga.',
      },
    ],
    status: 'in_force',
    statusNote: { en: 'Effective 18 Nov 2026. Emails at each step wait for the Outlook connection.', ms: 'Berkuat kuasa 18 Nov 2026. E-mel pada setiap langkah menunggu sambungan Outlook.' },
    source: { doc: 'docs/SITE_SUPPLIES_REQUESTS.md', decided: 'Fauzan, 13 Nov 2026 (Part T) and 14 Nov 2026 (Part U)' },
    words: 'site supplies bekalan tapak pesanan barang order kbk pkk nepal cleaning pembersihan do delivery penghantaran',
  },
  {
    id: 'equip-store-issue',
    app: 'equip',
    title: { en: 'Store item to a person, and its return', ms: 'Barang stor kepada seseorang, dan pemulangannya' },
    purpose: {
      en: 'The store hands a uniform or piece of equipment to a guard or officer; the person confirms it on their own screen; when it comes back the store records its condition.',
      ms: 'Stor menyerahkan uniform atau peralatan kepada pengawal atau peronda; orang itu mengesahkannya di skrin sendiri; apabila dipulangkan, stor merekod keadaannya.',
    },
    start: STORE,
    starter: { en: 'Storekeeper or Procurement executive', ms: 'Penjaga stor atau eksekutif Perolehan' },
    steps: [
      {
        who: { en: 'Storekeeper', ms: 'Penjaga stor' },
        does: {
          en: 'Under “Issue to a person” picks the person, the item and the quantity. A Goodwill item goes store → OM → patrolling officer → guard, so the store also names the OM and the officer.',
          ms: 'Di bawah “Issue to a person” pilih orang, barang dan kuantiti. Barang Goodwill bergerak stor → OM → peronda → pengawal, jadi stor juga menamakan OM dan peronda.',
        },
        where: STORE,
      },
      {
        who: { en: 'OM, patrolling officer, guard', ms: 'OM, peronda, pengawal' },
        does: {
          en: 'Each confirms receiving it, signing on screen or with a signed slip and photo. The guard sees it under “Items issued to me”.',
          ms: 'Setiap seorang mengesahkan terima, menandatangan di skrin atau dengan slip bertandatangan dan gambar. Pengawal melihatnya di bawah “Items issued to me”.',
        },
        where: ASK,
      },
      {
        who: { en: 'Procurement', ms: 'Perolehan' },
        does: {
          en: 'Follows up anything not confirmed or disputed, and items to collect from people who have left.',
          ms: 'Menyusul apa-apa yang belum disahkan atau dipertikaikan, dan barang yang perlu dikutip daripada orang yang telah berhenti.',
        },
        where: STORE,
      },
      {
        who: { en: 'Storekeeper', ms: 'Penjaga stor' },
        does: {
          en: 'When the item comes back, presses Return on the issued line and records it as good, worn, damaged or lost, with what happened.',
          ms: 'Apabila barang dipulangkan, tekan Return pada baris yang dikeluarkan dan rekod sebagai baik, lusuh, rosak atau hilang, dengan apa yang berlaku.',
        },
        where: STORE,
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus syarikat' },
        does: {
          en: 'Confirms or refuses each lost or damaged item, with a note and the cause. Refused means the item stays on the person until it is returned.',
          ms: 'Mengesahkan atau menolak setiap barang hilang atau rosak, dengan catatan dan punca. Jika ditolak, barang kekal atas nama orang itu sehingga dipulangkan.',
        },
        where: STORE,
        decision: true,
      },
      {
        who: { en: 'Store (someone other than the person who recorded the return)', ms: 'Stor (bukan orang yang merekod pemulangan)' },
        does: {
          en: 'Disposes of a returned worn or damaged piece from the guard’s uniform record: reason, “marks removed” ticked and a photo for a marked piece.',
          ms: 'Melupuskan helai lusuh atau rosak yang dipulangkan dari rekod uniform pengawal: sebab, tanda “marks removed” dan gambar bagi helai bertanda.',
        },
        where: QUEUE,
      },
    ],
    rules: [
      { en: 'Goodwill’s store issues to guards of every company it serves, never to central staff.', ms: 'Stor Goodwill mengeluarkan barang kepada pengawal setiap syarikat yang dilayaninya, bukan kepada staf pusat.' },
      { en: 'Only the person who got the item confirms it, in their own sign-in.', ms: 'Hanya orang yang menerima barang boleh mengesahkannya, melalui log masuk sendiri.' },
      {
        en: 'Uniforms and equipment are not charged to the guard; only a loss or damage the manager finds was negligence or misuse becomes a damage charge, reviewed by HR.',
        ms: 'Uniform dan peralatan tidak dicaj kepada pengawal; hanya kehilangan atau kerosakan yang diputuskan pengurus sebagai kecuaian atau salah guna menjadi caj kerosakan, disemak oleh HR.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'Fauzan, 27 Oct and 2 Nov 2026 (W27); T11 and T12 on 13 Nov 2026' },
    words: 'issue keluar serah handover return pulang pulangkan lost hilang damaged rosak slip signature tandatangan',
  },
  {
    id: 'equip-purchase',
    app: 'finance',
    title: { en: 'Buy for the store (purchase with 3 quotes)', ms: 'Pembelian untuk stor (3 sebut harga)' },
    purpose: {
      en: 'Everything Procurement buys for operations and cleaning: 3 supplier quotes and an online price, COO (and CEO) approval, order, goods received with the DO, Finance’s three-way match, SQL Account.',
      ms: 'Semua yang Perolehan beli untuk operasi dan pembersihan: 3 sebut harga pembekal dan harga dalam talian, kelulusan COO (dan CEO), pesanan, terima barang dengan DO, padanan tiga hala Kewangan, SQL Account.',
    },
    start: { view: 'purchasing', tab: 'requests', label: { en: 'New purchase', ms: 'Pembelian baharu' } },
    starter: {
      en: 'Procurement executive, or a company manager or admin executive for their company (a site supplies “buy” line becomes a purchase too)',
      ms: 'Eksekutif Perolehan, atau pengurus syarikat atau eksekutif admin bagi syarikatnya (baris “beli” permohonan bekalan tapak juga menjadi pembelian)',
    },
    steps: [
      {
        who: { en: 'Requester', ms: 'Pemohon' },
        does: { en: 'Raises the purchase with its lines, quantities and estimated prices.', ms: 'Membuka pembelian dengan baris, kuantiti dan anggaran harga.' },
        where: { view: 'purchasing', tab: 'requests', label: { en: 'Procurement › Purchases', ms: 'Perolehan › Pembelian' } },
      },
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: {
          en: 'Adds 3 quotes from approved suppliers and the online or marketplace price, each with its document, picks the quote and sends it for approval. Not the lowest, or more than 5% above online, needs a reason.',
          ms: 'Menambah 3 sebut harga daripada pembekal yang diluluskan dan harga dalam talian atau marketplace, setiap satu dengan dokumen, memilih sebut harga dan menghantar untuk kelulusan. Bukan yang terendah, atau lebih 5% di atas harga dalam talian, perlu sebab.',
        },
        where: { view: 'purchasing', tab: 'requests', label: { en: 'Procurement › Purchases', ms: 'Perolehan › Pembelian' } },
      },
      {
        who: { en: 'COO, then CEO', ms: 'COO, kemudian CEO' },
        does: {
          en: 'Approve or reject with a note. Within the CEO’s purchase limit the COO approves alone; above it, or with no limit set, the CEO approves after the COO.',
          ms: 'Meluluskan atau menolak dengan catatan. Dalam had pembelian CEO, COO meluluskan seorang; melebihi had atau jika had belum ditetapkan, CEO meluluskan selepas COO.',
        },
        where: { view: 'purchasing', tab: 'requests', label: { en: 'Waiting for your approval', ms: 'Menunggu kelulusan anda' } },
        decision: true,
      },
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: { en: 'Places the order and records the PO number.', ms: 'Membuat pesanan dan merekod nombor PO.' },
        where: { view: 'purchasing', tab: 'requests', label: { en: 'Procurement › Purchases', ms: 'Perolehan › Pembelian' } },
      },
      {
        who: { en: 'Storekeeper (never an approver)', ms: 'Penjaga stor (bukan pelulus)' },
        does: {
          en: 'Counts what arrived, records the supplier’s DO number with a photo of the DO, and any damaged or wrong pieces with a note. Only good pieces go into the store.',
          ms: 'Mengira barang yang tiba, merekod nombor DO pembekal dengan gambar DO, dan sebarang helai rosak atau salah dengan catatan. Hanya helai baik masuk ke stor.',
        },
        where: { view: 'purchasing', tab: 'requests', label: { en: 'Receive the goods', ms: 'Terima barang' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: {
          en: 'Matches the invoice: order, goods received and the e-Invoice UUID (within 1%). Only a passed match is entered in SQL Account, then the reference is recorded.',
          ms: 'Memadankan invois: pesanan, barang diterima dan UUID e-Invois (dalam 1%). Hanya padanan yang lulus dimasukkan ke SQL Account, kemudian rujukannya direkod.',
        },
        where: { view: 'purchasing', tab: 'requests', label: { en: 'Match the invoice', ms: 'Padankan invois' } },
      },
    ],
    rules: [
      { en: 'Every purchase needs 3 quotes, whatever the amount; an office purchase needs 2 online prices.', ms: 'Setiap pembelian perlu 3 sebut harga, walau berapa pun jumlahnya; pembelian pejabat perlu 2 harga dalam talian.' },
      { en: 'Nobody approves their own request, and an approver never receives the goods.', ms: 'Tiada sesiapa meluluskan permohonan sendiri, dan pelulus tidak menerima barang.' },
      { en: 'A rejected purchase is corrected and sent again with fresh quotes and a fresh approval round.', ms: 'Pembelian yang ditolak dibetulkan dan dihantar semula dengan sebut harga baharu dan pusingan kelulusan baharu.' },
      { en: 'No goods are received while a major stock count is open.', ms: 'Tiada barang diterima semasa kiraan stok besar dibuka.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/finance.md', decided: 'Fauzan, 27 Oct 2026 (PUR-DOA); 3 Nov 2026 (CEO limit); 14 Nov 2026 (U16 DO, U-X14)' },
    words: 'buy beli purchase pembelian quote sebut harga quotation po order pesanan grn goods received terima barang do invoice invois e-invoice sql account',
  },
  {
    id: 'equip-supplier',
    app: 'finance',
    title: { en: 'Approve a supplier', ms: 'Meluluskan pembekal' },
    purpose: {
      en: 'Only an approved supplier can quote: Procurement registers it, Finance verifies the bank account, and the anti-bribery checks are on file and reviewed every year.',
      ms: 'Hanya pembekal yang diluluskan boleh memberi sebut harga: Perolehan mendaftarkannya, Kewangan mengesahkan akaun bank, dan semakan anti-rasuah disimpan dan disemak setiap tahun.',
    },
    start: { view: 'purchasing', tab: 'suppliers', label: { en: 'Add supplier', ms: 'Tambah pembekal' } },
    starter: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
    steps: [
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: { en: 'Adds the supplier: name, SSM number, categories, bank and account.', ms: 'Menambah pembekal: nama, nombor SSM, kategori, bank dan akaun.' },
        where: { view: 'purchasing', tab: 'suppliers', label: { en: 'Procurement › Suppliers', ms: 'Perolehan › Pembekal' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Verifies the bank account against the bank letter.', ms: 'Mengesahkan akaun bank berdasarkan surat bank.' },
        where: { view: 'purchasing', tab: 'suppliers', label: { en: 'Procurement › Suppliers', ms: 'Perolehan › Pembekal' } },
        decision: true,
      },
      {
        who: { en: 'Procurement', ms: 'Perolehan' },
        does: {
          en: 'Records the conflict-of-interest declaration and the anti-bribery acknowledgement (MACC Act s.17A).',
          ms: 'Merekod pengisytiharan konflik kepentingan dan pengakuan anti-rasuah (Akta SPRM s.17A).',
        },
        where: { view: 'purchasing', tab: 'suppliers', label: { en: 'Procurement › Suppliers', ms: 'Perolehan › Pembekal' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Does the yearly review; blocks or unblocks a supplier with a reason.', ms: 'Membuat semakan tahunan; menyekat atau membuka sekatan pembekal dengan sebab.' },
        where: { view: 'purchasing', tab: 'suppliers', label: { en: 'Procurement › Suppliers', ms: 'Perolehan › Pembekal' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A supplier with a check missing, a review overdue (365 days) or a block cannot be chosen for a quote.', ms: 'Pembekal yang kurang semakan, semakan tahunan lewat (365 hari) atau disekat tidak boleh dipilih untuk sebut harga.' },
      { en: 'One registration per SSM number per company.', ms: 'Satu pendaftaran bagi setiap nombor SSM bagi setiap syarikat.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/finance.md', decided: 'Fauzan, 27 Oct 2026 (PUR-DOA)' },
    words: 'supplier pembekal vendor ssm bank anti-bribery rasuah sprm coi',
  },
  {
    id: 'equip-stock-count',
    app: 'equip',
    title: { en: 'Store stock count and variances', ms: 'Kiraan stok stor dan varians' },
    purpose: {
      en: 'Every store is counted once a month, and fully at the end of June and December with all movement frozen; each difference is explained or adjusted. Also the Monday opening balance and the monthly report.',
      ms: 'Setiap stor dikira sebulan sekali, dan kiraan penuh pada akhir Jun dan Disember dengan semua pergerakan dibekukan; setiap perbezaan dijelaskan atau dilaraskan. Termasuk baki pembukaan hari Isnin dan laporan bulanan.',
    },
    start: { view: 'purchasing', tab: 'store', label: { en: 'Kawalan Inventori', ms: 'Kawalan Inventori' } },
    starter: { en: 'Storekeeper (at a private store, the admin executive)', ms: 'Penjaga stor (di stor swasta, eksekutif admin)' },
    steps: [
      {
        who: { en: 'Storekeeper', ms: 'Penjaga stor' },
        does: {
          en: 'Each Monday confirms last week’s closing balance as this week’s opening balance. After that, a movement dated in a closed week is refused.',
          ms: 'Setiap Isnin mengesahkan baki penutup minggu lepas sebagai baki pembukaan minggu ini. Selepas itu, pergerakan bertarikh dalam minggu yang ditutup ditolak.',
        },
        where: STORE,
      },
      {
        who: { en: 'Storekeeper', ms: 'Penjaga stor' },
        does: {
          en: 'Starts the monthly count, or the major count (2 to 5 PM, all stock in and out stopped), prints the count sheet and enters each physical figure. A difference needs a reason from the list.',
          ms: 'Memulakan kiraan bulanan, atau kiraan besar (2 hingga 5 petang, semua stok keluar masuk dihentikan), mencetak borang kiraan dan memasukkan angka fizikal. Perbezaan perlu sebab daripada senarai.',
        },
        where: STORE,
      },
      {
        who: { en: 'Witness', ms: 'Saksi' },
        does: { en: 'Signs the finish with staff number and PIN.', ms: 'Menandatangan penamat dengan nombor staf dan PIN.' },
        where: STORE,
      },
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: {
          en: 'Decides each variance: explained (the missing movement was recorded) or adjusted (one line on the stock card; Finance is told the write-off value).',
          ms: 'Memutuskan setiap varians: dijelaskan (pergerakan yang tertinggal telah direkod) atau dilaraskan (satu baris pada kad stok; Kewangan dimaklumkan nilai hapus kira).',
        },
        where: STORE,
        decision: true,
      },
      {
        who: { en: 'OGM (company manager at a private store)', ms: 'OGM (pengurus syarikat di stor swasta)' },
        does: {
          en: 'Approves an adjustment above RM500, and may let one urgent move through during a major count, with a reason.',
          ms: 'Meluluskan pelarasan melebihi RM500, dan boleh membenarkan satu pergerakan segera semasa kiraan besar, dengan sebab.',
        },
        where: STORE,
        decision: true,
      },
      {
        who: { en: 'Procurement executive, then OGM', ms: 'Eksekutif Perolehan, kemudian OGM' },
        does: {
          en: 'Builds the monthly report (PDF), adds comments and submits it; the OGM reviews it, and returning it needs a reason. A submitted report is frozen.',
          ms: 'Menyediakan laporan bulanan (PDF), menambah ulasan dan menghantarnya; OGM menyemak, dan memulangkannya perlu sebab. Laporan yang dihantar dibekukan.',
        },
        where: STORE,
        decision: true,
      },
    ],
    rules: [
      { en: 'The counter and the witness never decide the variance.', ms: 'Pengira dan saksi tidak boleh memutuskan varians.' },
      { en: 'The same item short in 3 counts in a row is flagged to the OGM.', ms: 'Barang yang sama kurang dalam 3 kiraan berturut-turut ditanda kepada OGM.' },
      { en: 'Inventory, count and disposal records are kept at least 7 years; nothing is deleted.', ms: 'Rekod inventori, kiraan dan pelupusan disimpan sekurang-kurangnya 7 tahun; tiada yang dipadam.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/INVENTORY_CONTROL.md', decided: 'Fauzan, 14 Nov 2026 (U-X1, U-X10)' },
    words: 'stock count kiraan stok stock take varians variance freeze beku witness saksi opening balance baki pembukaan monthly report laporan bulanan',
  },
  {
    id: 'equip-min-max',
    app: 'equip',
    title: { en: 'Min/Max and reorder', ms: 'Min/Max dan pesanan semula' },
    purpose: {
      en: 'The least and most the store and each site should hold, so nothing runs out and nothing piles up. Prima suggests what to reorder; people decide.',
      ms: 'Paras paling sedikit dan paling banyak yang stor dan setiap tapak patut simpan, supaya tiada yang habis dan tiada yang berlebihan. Prima mencadangkan pesanan semula; manusia yang memutuskan.',
    },
    start: { view: 'equiprequests', tab: 'ask', label: { en: 'Site Min and Max', ms: 'Min dan Max tapak' } },
    starter: { en: 'Procurement executive (store), OM (site cleaning supplies)', ms: 'Eksekutif Perolehan (stor), OM (bekalan pembersihan tapak)' },
    steps: [
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: { en: 'Sets each store item’s Min (reorder level) and Max with how it was set.', ms: 'Menetapkan Min (paras pesanan semula) dan Max setiap barang stor dengan cara ia ditetapkan.' },
        where: QUEUE,
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Proposes a site’s Min and Max for a cleaning supply, from real usage.', ms: 'Mencadangkan Min dan Max tapak bagi bekalan pembersihan, berdasarkan penggunaan sebenar.' },
        where: ASK,
      },
      {
        who: { en: 'OGM', ms: 'OGM' },
        does: { en: 'Approves the site Min/Max, or refuses with a reason.', ms: 'Meluluskan Min/Max tapak, atau menolak dengan sebab.' },
        where: QUEUE,
        decision: true,
      },
      {
        who: { en: 'OGM', ms: 'OGM' },
        does: {
          en: 'Sets the buffer for course uniform sets (CSG/TNG) with a reason; an item below its buffer shows red and one at zero is a critical stock-out.',
          ms: 'Menetapkan simpanan bagi set uniform kursus (CSG/TNG) dengan sebab; barang di bawah paras simpanan ditunjuk merah dan yang habis ialah kehabisan stok kritikal.',
        },
        where: STORE,
      },
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: {
          en: 'Reads the reorder suggestion (weekly usage over 8 weeks × lead time plus a week, capped at Max) and raises a purchase when needed.',
          ms: 'Membaca cadangan pesanan (penggunaan mingguan 8 minggu × tempoh penghantaran tambah seminggu, dihadkan pada Max) dan membuka pembelian jika perlu.',
        },
        where: { view: 'purchasing', tab: 'requests', label: { en: 'New purchase', ms: 'Pembelian baharu' } },
      },
    ],
    rules: [
      { en: 'Until set, Min and Max show “not set”; Prima never fills a default number.', ms: 'Selagi belum ditetapkan, Min dan Max ditunjuk “belum ditetapkan”; Prima tidak mengisi nombor lalai.' },
      { en: 'The reorder suggestion is never automatic.', ms: 'Cadangan pesanan semula tidak sekali-kali automatik.' },
      { en: 'A buffer not reviewed in 90 days is listed.', ms: 'Paras simpanan yang tidak disemak dalam 90 hari disenaraikan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SITE_SUPPLIES_REQUESTS.md', decided: 'Fauzan, 13 Nov 2026 (T4) and 14 Nov 2026 (U8)' },
    words: 'min max minimum maximum reorder pesan semula buffer simpanan stock out habis',
  },
  {
    id: 'equip-disposal',
    app: 'equip',
    title: { en: 'Disposal of goods (Permohonan Pelupusan)', ms: 'Pelupusan barang (Permohonan Pelupusan)' },
    purpose: {
      en: 'One case for store items and site items that are damaged, worn, unsafe or no longer needed: reviewed, approved where needed, disposed of with evidence, and closed within 10 working days.',
      ms: 'Satu kes bagi barang stor dan barang tapak yang rosak, lusuh, tidak selamat atau tidak diperlukan lagi: disemak, diluluskan jika perlu, dilupuskan dengan bukti, dan ditutup dalam 10 hari bekerja.',
    },
    start: { view: 'equiprequests', tab: 'ask', label: { en: 'Ask to dispose of site items', ms: 'Mohon lupus barang tapak' } },
    starter: { en: 'Storekeeper (store items) or the OM covering the site (site items)', ms: 'Penjaga stor (barang stor) atau OM yang menjaga tapak (barang tapak)' },
    steps: [
      {
        who: { en: 'Storekeeper or OM', ms: 'Penjaga stor atau OM' },
        does: {
          en: 'Permohonan: item, quantity, where it is, condition now and the reason; a photo for a damaged or unsafe item. Store lines leave usable stock at once.',
          ms: 'Permohonan: barang, kuantiti, lokasi, keadaan sekarang dan sebab; gambar bagi barang rosak atau tidak selamat. Baris stor keluar daripada stok boleh guna serta-merta.',
        },
        where: ASK,
      },
      {
        who: { en: 'Procurement executive (never the requester)', ms: 'Eksekutif Perolehan (bukan pemohon)' },
        does: {
          en: 'Semakan and Penilaian: checks quantity, condition and ownership; picks per line reuse, repair, transfer, recycle, dispose or return to the client; records the cause.',
          ms: 'Semakan dan Penilaian: menyemak kuantiti, keadaan dan pemilikan; memilih setiap baris guna semula, baiki, pindah, kitar semula, lupus atau pulang kepada klien; merekod punca.',
        },
        where: STORE,
        decision: true,
      },
      {
        who: { en: 'OGM or company manager', ms: 'OGM atau pengurus syarikat' },
        does: {
          en: 'Kelulusan: needed at RM1,000 or more, for any sensitive item (radios, devices) and any sale or auction. Under that the reviewer decides.',
          ms: 'Kelulusan: perlu bagi RM1,000 ke atas, sebarang barang sensitif (radio, peranti) dan sebarang jualan atau lelongan. Di bawahnya penyemak memutuskan.',
        },
        where: STORE,
        decision: true,
      },
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: {
          en: 'Kaedah: method and destination per line (waste, recycle, third party, sale, destroy, back to supplier, e-waste, scheduled waste).',
          ms: 'Kaedah: cara dan destinasi setiap baris (sisa biasa, kitar semula, pihak ketiga, jualan, musnah, pulang kepada pembekal, e-sisa, buangan terjadual).',
        },
        where: STORE,
      },
      {
        who: { en: 'Storekeeper or the OM who asked', ms: 'Penjaga stor atau OM yang memohon' },
        does: {
          en: 'Pelaksanaan and Bukti: before and after photos, “marks removed” for marked items, the wipe reference for electronics, a witness for destroy, third party and sale; then the receipt or certificate.',
          ms: 'Pelaksanaan dan Bukti: gambar sebelum dan selepas, “marks removed” bagi barang bertanda, rujukan pemadaman data bagi elektronik, saksi bagi musnah, pihak ketiga dan jualan; kemudian resit atau sijil.',
        },
        where: STORE,
      },
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: {
          en: 'Selesai: closes the case once every piece of evidence is in; Finance is told the write-off value. Sale money is recorded by Finance, never by the store.',
          ms: 'Selesai: menutup kes apabila semua bukti lengkap; Kewangan dimaklumkan nilai hapus kira. Wang jualan direkod oleh Kewangan, bukan oleh stor.',
        },
        where: STORE,
      },
    ],
    rules: [
      { en: 'The requester never reviews or approves the case.', ms: 'Pemohon tidak sekali-kali menyemak atau meluluskan kes.' },
      { en: 'Target: 10 working days from request to Selesai.', ms: 'Sasaran: 10 hari bekerja dari permohonan hingga Selesai.' },
      { en: 'No disposal request while a major stock count is open.', ms: 'Tiada permohonan pelupusan semasa kiraan stok besar dibuka.' },
      { en: 'IT devices are disposed of only through IT’s disposal record (data wipe).', ms: 'Peranti IT dilupuskan hanya melalui rekod pelupusan IT (pemadaman data).' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'The OM’s request form is on Ask for equipment; the review, approval and evidence steps are on Procurement › Store.',
      ms: 'Borang permohonan OM ada di Mohon peralatan; langkah semakan, kelulusan dan bukti ada di Perolehan › Stor.',
    },
    source: { doc: 'docs/DISPOSAL_OF_GOODS.md', decided: 'Fauzan, 14 Nov 2026 (U12, U13, U-X7, U-X11)' },
    words: 'disposal pelupusan lupus buang dispose scrap write off hapus kira rosak lusuh',
  },
  {
    id: 'equip-damage-charge',
    app: 'equip',
    title: { en: 'Damage or loss charge (kecuaian)', ms: 'Caj kerosakan atau kehilangan (kecuaian)' },
    purpose: {
      en: 'When the manager finds a company item was damaged or lost through negligence or misuse, the actual cost may go on the person’s next pay, after HR’s review.',
      ms: 'Apabila pengurus mendapati barang syarikat rosak atau hilang kerana kecuaian atau salah guna, kos sebenar boleh dicaj pada gaji berikutnya, selepas semakan HR.',
    },
    starter: { en: 'The manager who decides the variance, loss or disposal case', ms: 'Pengurus yang memutuskan kes varians, kehilangan atau pelupusan' },
    steps: [
      {
        who: { en: 'Manager deciding the case', ms: 'Pengurus yang memutuskan kes' },
        does: {
          en: 'Records the cause: normal wear, accident, negligence, misuse or unknown, with a photo. The reporter never sets it.',
          ms: 'Merekod punca: lusuh biasa, kemalangan, kecuaian, salah guna atau tidak diketahui, dengan gambar. Pelapor tidak boleh menetapkannya.',
        },
        where: STORE,
        decision: true,
      },
      {
        who: { en: 'Procurement', ms: 'Perolehan' },
        does: { en: 'Enters the store price when the item has none; the charge waits until then.', ms: 'Memasukkan harga stor jika barang tiada harga; caj menunggu sehingga itu.' },
        where: STORE,
      },
      {
        who: { en: 'HR (PWVSB HR, the CoS or the DCoS)', ms: 'HR (HR PWVSB, CoS atau DCoS)' },
        does: {
          en: 'Reviews every charge before that month’s pay run: keep, reduce, spread or cancel, with a reason. Never the person who decided the charge.',
          ms: 'Menyemak setiap caj sebelum gaji bulan itu: kekal, kurangkan, ansur atau batal, dengan sebab. Bukan orang yang memutuskan caj.',
        },
        where: STORE,
        decision: true,
      },
      {
        who: { en: 'The person charged', ms: 'Orang yang dicaj' },
        does: { en: 'Sees the charge before pay day under “Kerosakan / kehilangan barang syarikat”.', ms: 'Melihat caj sebelum hari gaji di bawah “Kerosakan / kehilangan barang syarikat”.' },
        where: ASK,
      },
    ],
    rules: [
      { en: 'Only negligence or misuse is charged; the charge is the store price, never guessed.', ms: 'Hanya kecuaian atau salah guna dicaj; caj ialah harga stor, tidak sekali-kali diteka.' },
      {
        en: 'Employment Act 1955 s.24 is shown on every charge: written agreement or the Labour Director General’s permission; all deductions within 50% of wages.',
        ms: 'Akta Kerja 1955 s.24 ditunjuk pada setiap caj: persetujuan bertulis atau kebenaran Ketua Pengarah Tenaga Kerja; semua potongan dalam 50% gaji.',
      },
      { en: 'Extra uniform pieces after the 3 free ones are paid by receipt, never from pay.', ms: 'Helai uniform tambahan selepas 3 percuma dibayar dengan resit, bukan dari gaji.' },
      { en: 'A guard’s charge is marked for keying into JA while guard pay is in JA.', ms: 'Caj pengawal ditanda untuk dimasukkan ke JA selagi gaji pengawal dalam JA.' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'HR’s review list sits in Procurement › Store (Kawalan Inventori).',
      ms: 'Senarai semakan HR berada di Perolehan › Stor (Kawalan Inventori).',
    },
    source: { doc: 'docs/INVENTORY_CONTROL.md', decided: 'Fauzan, 14 Nov 2026 (U17, U-X12)' },
    words: 'damage charge caj kerosakan kehilangan negligence kecuaian misuse salah guna deduction potongan gaji hr',
  },
  {
    id: 'equip-warranty-claim',
    app: 'equip',
    title: { en: 'Warranty claim for a faulty item', ms: 'Tuntutan waranti barang rosak' },
    purpose: {
      en: 'A store item or IT device still under warranty stops working: report it with a photo; the store (or IT) checks the warranty, sends it to the supplier and records the outcome.',
      ms: 'Barang stor atau peranti IT yang masih dalam waranti rosak: laporkan dengan gambar; stor (atau IT) menyemak waranti, menghantar kepada pembekal dan merekod keputusan.',
    },
    start: { view: 'equiprequests', tab: 'ask', label: { en: 'Report fault', ms: 'Lapor kerosakan' } },
    starter: { en: 'The person holding the item, or the store', ms: 'Orang yang memegang barang, atau stor' },
    steps: [
      {
        who: { en: 'Holder or store', ms: 'Pemegang atau stor' },
        does: { en: 'Chooses the faulty item, says what is wrong and when, and attaches a photo.', ms: 'Memilih barang yang rosak, menerangkan masalah dan tarikh, dan melampirkan gambar.' },
        where: ASK,
      },
      {
        who: { en: 'Store (IT for an IT device)', ms: 'Stor (IT bagi peranti IT)' },
        does: { en: 'Checks the warranty: supplier and end date from the register or the warranty card.', ms: 'Menyemak waranti: pembekal dan tarikh tamat daripada daftar atau kad waranti.' },
        where: STORE,
      },
      {
        who: { en: 'Store (IT for an IT device)', ms: 'Stor (IT bagi peranti IT)' },
        does: { en: 'Sends it to the supplier and records the date and the supplier’s reference.', ms: 'Menghantar kepada pembekal dan merekod tarikh serta rujukan pembekal.' },
        where: STORE,
      },
      {
        who: { en: 'Store (IT for an IT device)', ms: 'Stor (IT bagi peranti IT)' },
        does: {
          en: 'Records the outcome (repaired, replaced with the new serial, or refused with the supplier’s reason).',
          ms: 'Merekod keputusan (dibaiki, diganti dengan nombor siri baharu, atau ditolak dengan sebab pembekal).',
        },
        where: STORE,
      },
    ],
    rules: [
      { en: 'A photo of the fault is required.', ms: 'Gambar kerosakan wajib.' },
      { en: 'Prima sends nothing to the supplier; the store sends it and records what happened.', ms: 'Prima tidak menghantar apa-apa kepada pembekal; stor yang menghantar dan merekod apa yang berlaku.' },
    ],
    status: 'in_force',
    source: { doc: 'db/modules/warranty-claims-v1.sql', decided: 'Fitri package A8, Fauzan 11 Nov 2026' },
    words: 'warranty waranti fault rosak supplier pembekal repair baiki replace ganti claim tuntutan',
  },
  {
    id: 'equip-item-register',
    app: 'equip',
    title: { en: 'Register items and print labels', ms: 'Daftar barang dan cetak label' },
    purpose: {
      en: 'Every uniform, device and stock item gets one label for life (QR and barcode of the same ID): add the item type, register the units, print the labels and scan them back.',
      ms: 'Setiap uniform, peranti dan barang stok mendapat satu label seumur hayat (QR dan kod bar ID yang sama): tambah jenis barang, daftar unit, cetak label dan imbas semula.',
    },
    start: { view: 'items', tab: 'catalogue', label: { en: 'Items › Item types', ms: 'Barang › Jenis barang' } },
    starter: { en: 'Store, company manager or admin executive of the owning company', ms: 'Stor, pengurus syarikat atau eksekutif admin syarikat pemilik' },
    steps: [
      {
        who: { en: 'Store or company manager', ms: 'Stor atau pengurus syarikat' },
        does: {
          en: 'Adds the item type (what it is, size, unit, tracked one by one or in bulk), or imports the old item list from Excel, CSV or PDF.',
          ms: 'Menambah jenis barang (apa, saiz, unit, dijejak satu-satu atau pukal), atau mengimport senarai barang lama daripada Excel, CSV atau PDF.',
        },
        where: { view: 'items', tab: 'catalogue', label: { en: 'Items › Item types', ms: 'Barang › Jenis barang' } },
      },
      {
        who: { en: 'Store', ms: 'Stor' },
        does: { en: 'Registers the units in stock; each unit gets its own ID.', ms: 'Mendaftar unit dalam stok; setiap unit mendapat ID sendiri.' },
        where: { view: 'items', tab: 'stock', label: { en: 'Items › Stock', ms: 'Barang › Stok' } },
      },
      {
        who: { en: 'Store', ms: 'Stor' },
        does: { en: 'Prints the labels and scans each new label back to prove it is on the right item.', ms: 'Mencetak label dan mengimbas setiap label baharu untuk membuktikan ia pada barang yang betul.' },
        where: { view: 'items', tab: 'labels', label: { en: 'Items › Labels', ms: 'Barang › Label' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus syarikat' },
        does: { en: 'Chooses barcode, QR or RFID for the company, with a reason.', ms: 'Memilih kod bar, QR atau RFID bagi syarikat, dengan sebab.' },
        where: { view: 'items', tab: 'counts', label: { en: 'Items › Counts', ms: 'Barang › Kiraan' } },
      },
    ],
    rules: [
      { en: 'The label carries only the ID: no names, prices or owner. A reprint keeps the ID and needs a reason.', ms: 'Label hanya membawa ID: tiada nama, harga atau pemilik. Cetak semula mengekalkan ID dan perlu sebab.' },
      { en: 'Firearms, ammunition and controlled items are not in this register; they stay in Arms Control.', ms: 'Senjata api, peluru dan barang kawalan tiada dalam daftar ini; ia kekal di Kawalan Senjata.' },
      { en: 'A supplier’s barcode is never a unit ID.', ms: 'Kod bar pembekal tidak sekali-kali menjadi ID unit.' },
    ],
    status: 'in_force',
    statusNote: { en: 'SQL Account is not connected: Finance works from export files.', ms: 'SQL Account belum disambung: Kewangan menggunakan fail eksport.' },
    source: { doc: 'docs/ITEM_REGISTER.md', decided: 'Fauzan, 6 Nov 2026 (with Fitri’s paper v1.0)' },
    words: 'item register daftar barang label qr barcode kod bar rfid sku item type jenis import',
  },
  {
    id: 'equip-item-handover',
    app: 'equip',
    title: { en: 'Hand a registered item to a person or site', ms: 'Serah barang berdaftar kepada orang atau tapak' },
    purpose: {
      en: 'Scan the item, hand it to a person or place it at a site; the person confirms it in their own sign-in. Taking it back, laundry and repair follow the same item.',
      ms: 'Imbas barang, serahkan kepada orang atau letak di tapak; orang itu mengesahkannya melalui log masuk sendiri. Ambil balik, dobi dan pembaikan mengikut barang yang sama.',
    },
    start: { view: 'items', tab: 'find', label: { en: 'Scan or find an item', ms: 'Imbas atau cari barang' } },
    starter: { en: 'Store, supervisor, patrolling officer, OM or Regional OM at their sites', ms: 'Stor, penyelia, peronda, OM atau OM Wilayah di tapak masing-masing' },
    steps: [
      {
        who: { en: 'Store or site staff', ms: 'Stor atau staf tapak' },
        does: { en: 'Scans the label and chooses Hand to a person, or Place at a site.', ms: 'Mengimbas label dan memilih Hand to a person, atau Place at a site.' },
        where: { view: 'items', tab: 'find', label: { en: 'Items › Scan or find', ms: 'Barang › Imbas atau cari' } },
      },
      {
        who: { en: 'The person', ms: 'Orang itu' },
        does: { en: 'Confirms or disputes it under My items.', ms: 'Mengesahkan atau mempertikaikannya di bawah My items.' },
        where: { view: 'items', tab: 'mine', label: { en: 'Items › My items', ms: 'Barang › Barang saya' } },
      },
      {
        who: { en: 'Store or site staff', ms: 'Stor atau staf tapak' },
        does: {
          en: 'Takes it back into the store, sends it to the laundry or for repair, records a site check (moves nothing) or reports it missing.',
          ms: 'Mengambil balik ke stor, menghantar ke dobi atau untuk dibaiki, merekod semakan tapak (tiada pergerakan) atau melaporkannya hilang.',
        },
        where: { view: 'items', tab: 'find', label: { en: 'Items › Scan or find', ms: 'Barang › Imbas atau cari' } },
      },
    ],
    rules: [
      { en: 'Only the person the item was handed to confirms it.', ms: 'Hanya orang yang menerima barang boleh mengesahkannya.' },
      { en: 'A uniform counts in the guard’s allowance: 3 free pieces in 12 months, more only with the guard’s paid receipt.', ms: 'Uniform dikira dalam elaun pengawal: 3 helai percuma dalam 12 bulan, lebih hanya dengan resit bayaran pengawal.' },
      { en: 'A scan never gives access: another company’s label shows “not found”.', ms: 'Imbasan tidak memberi akses: label syarikat lain ditunjuk “tidak dijumpai”.' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'The guard’s confirmation on the shared post device with a face check waits for the face engine; meanwhile the person confirms in their own sign-in.',
      ms: 'Pengesahan pengawal pada peranti pos dengan semakan muka menunggu enjin muka; buat masa ini orang itu mengesahkan melalui log masuk sendiri.',
    },
    source: { doc: 'docs/ITEM_REGISTER.md', decided: 'Fauzan, 6 Nov 2026' },
    words: 'handover serah issue hand over confirm sahkan my items barang saya laundry dobi repair baiki return',
  },
  {
    id: 'equip-item-send-receive',
    app: 'equip',
    title: { en: 'Send and receive items between companies or sites', ms: 'Hantar dan terima barang antara syarikat atau tapak' },
    purpose: {
      en: 'A sale (for example Goodwill to a security company), transfer, rental, loan or supplier return: pick, send, and the receiving side scans each unit in.',
      ms: 'Jualan (contohnya Goodwill kepada syarikat keselamatan), pindahan, sewaan, pinjaman atau pulangan kepada pembekal: pilih, hantar, dan pihak penerima mengimbas setiap unit.',
    },
    start: { view: 'items', tab: 'moves', label: { en: 'Items › Send and receive', ms: 'Barang › Hantar dan terima' } },
    starter: { en: 'The sending store or company', ms: 'Stor atau syarikat penghantar' },
    steps: [
      {
        who: { en: 'Sender', ms: 'Penghantar' },
        does: { en: 'Creates the movement, scans the units onto it and dispatches it (in transit).', ms: 'Membuka pergerakan, mengimbas unit ke dalamnya dan menghantarnya (dalam perjalanan).' },
        where: { view: 'items', tab: 'moves', label: { en: 'Items › Send and receive', ms: 'Barang › Hantar dan terima' } },
      },
      {
        who: { en: 'Receiving store, site supervisor or the area OM (never the sender)', ms: 'Stor penerima, penyelia tapak atau OM kawasan (bukan penghantar)' },
        does: {
          en: 'Scans each unit that arrived (or pastes an RFID reader’s list); marks damaged, missing or wrong items. Unscanned units stay waiting.',
          ms: 'Mengimbas setiap unit yang tiba (atau menampal senarai pembaca RFID); menanda barang rosak, hilang atau salah. Unit yang tidak diimbas kekal menunggu.',
        },
        where: { view: 'items', tab: 'moves', label: { en: 'Receive by scanning', ms: 'Terima dengan imbasan' } },
      },
      {
        who: { en: 'Seller and buyer Finance, buyer’s manager', ms: 'Kewangan penjual dan pembeli, pengurus pembeli' },
        does: {
          en: 'For a sale, the four papers: receipt, seller’s invoice, buyer’s payment slip, and the buyer’s letter acknowledging only items received in good order.',
          ms: 'Bagi jualan, empat kertas: resit, invois penjual, slip bayaran pembeli, dan surat pembeli yang mengakui hanya barang yang diterima dalam keadaan baik.',
        },
        where: { view: 'items', tab: 'moves', label: { en: 'Items › Send and receive', ms: 'Barang › Hantar dan terima' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: {
          en: 'Records when ownership passes, after the last paper. Seller and buyer both follow the item afterwards.',
          ms: 'Merekod bila pemilikan berpindah, selepas kertas terakhir. Penjual dan pembeli sama-sama mengikuti barang selepas itu.',
        },
        where: { view: 'items', tab: 'moves', label: { en: 'Items › Send and receive', ms: 'Barang › Hantar dan terima' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'The sender can never receive; there is never a false full receipt.', ms: 'Penghantar tidak boleh menerima; tiada penerimaan penuh palsu.' },
      { en: 'Rental and loan keep the owner and the due-back date; a supplier return points at the original sale.', ms: 'Sewaan dan pinjaman mengekalkan pemilik dan tarikh pulang; pulangan pembekal merujuk jualan asal.' },
      { en: 'Amounts are never entered or invented here.', ms: 'Amaun tidak dimasukkan atau direka di sini.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/ITEM_REGISTER.md', decided: 'Fauzan, 6 Nov 2026 (D02)' },
    words: 'send hantar receive terima transfer pindah sale jualan rental sewa loan pinjam delivery penghantaran ownership pemilikan rfid',
  },
  {
    id: 'equip-item-count',
    app: 'equip',
    title: { en: 'Count registered items at a store or site', ms: 'Kira barang berdaftar di stor atau tapak' },
    purpose: {
      en: 'Scan every label at a place; what is not found is recounted, then a manager who did not count reviews it and only then are cases opened.',
      ms: 'Imbas setiap label di sesuatu tempat; yang tidak dijumpai dikira semula, kemudian pengurus yang tidak mengira menyemak dan barulah kes dibuka.',
    },
    start: { view: 'items', tab: 'counts', label: { en: 'Items › Counts', ms: 'Barang › Kiraan' } },
    starter: { en: 'Store, OM or site staff, IT for IT devices', ms: 'Stor, OM atau staf tapak, IT bagi peranti IT' },
    steps: [
      {
        who: { en: 'Counter', ms: 'Pengira' },
        does: { en: 'Starts the count (a snapshot is taken) and scans each label, or pastes an RFID reader’s list.', ms: 'Memulakan kiraan (gambaran stok diambil) dan mengimbas setiap label, atau menampal senarai pembaca RFID.' },
        where: { view: 'items', tab: 'counts', label: { en: 'Items › Counts', ms: 'Barang › Kiraan' } },
      },
      {
        who: { en: 'Counter', ms: 'Pengira' },
        does: { en: 'Closes the count and recounts the units not found and the extras.', ms: 'Menutup kiraan dan mengira semula unit yang tidak dijumpai dan yang berlebihan.' },
        where: { view: 'items', tab: 'counts', label: { en: 'Items › Counts', ms: 'Barang › Kiraan' } },
      },
      {
        who: { en: 'Manager who did not count', ms: 'Pengurus yang tidak mengira' },
        does: { en: 'Reviews with what was checked; a case opens for each difference.', ms: 'Menyemak dengan apa yang diperiksa; kes dibuka bagi setiap perbezaan.' },
        where: { view: 'items', tab: 'counts', label: { en: 'Items › Counts', ms: 'Barang › Kiraan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Not found yet is not lost; nothing is adjusted by a count.', ms: 'Belum dijumpai bukan bermaksud hilang; kiraan tidak melaraskan apa-apa.' },
      { en: 'Items moved after the start are listed separately.', ms: 'Barang yang bergerak selepas kiraan bermula disenaraikan berasingan.' },
      { en: 'Store stock (not register units) is counted in the store count on Procurement › Store.', ms: 'Stok stor (bukan unit berdaftar) dikira dalam kiraan stor di Perolehan › Stor.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/ITEM_REGISTER.md', decided: 'Fauzan, 6 Nov 2026' },
    words: 'count kiraan stock take scan imbas recount kira semula rfid',
  },
  {
    id: 'equip-item-case',
    app: 'equip',
    title: { en: 'Missing, damaged or to dispose of (register case)', ms: 'Hilang, rosak atau untuk dilupus (kes daftar)' },
    purpose: {
      en: 'A registered item reported missing, found damaged at receipt, or asked to be disposed of becomes a case that a manager who did not open it decides.',
      ms: 'Barang berdaftar yang dilaporkan hilang, didapati rosak semasa diterima, atau dipohon untuk dilupuskan menjadi kes yang diputuskan oleh pengurus yang tidak membukanya.',
    },
    start: { view: 'items', tab: 'find', label: { en: 'Scan the item', ms: 'Imbas barang' } },
    starter: { en: 'The holder, the store or site staff', ms: 'Pemegang, stor atau staf tapak' },
    steps: [
      {
        who: { en: 'Holder, store or site staff', ms: 'Pemegang, stor atau staf tapak' },
        does: { en: 'Scans the item and presses Report missing, or (store) Ask to dispose of it.', ms: 'Mengimbas barang dan menekan Report missing, atau (stor) Ask to dispose of it.' },
        where: { view: 'items', tab: 'find', label: { en: 'Items › Scan or find', ms: 'Barang › Imbas atau cari' } },
      },
      {
        who: { en: 'Manager who did not open the case', ms: 'Pengurus yang tidak membuka kes' },
        does: { en: 'Decides the case with a reason; a write-off goes to Finance to decide.', ms: 'Memutuskan kes dengan sebab; hapus kira diserahkan kepada Kewangan untuk diputuskan.' },
        where: { view: 'items', tab: 'cases', label: { en: 'Items › Cases', ms: 'Barang › Kes' } },
        decision: true,
      },
      {
        who: { en: 'Store', ms: 'Stor' },
        does: { en: 'Registers a replacement with a new ID, linked both ways, when needed.', ms: 'Mendaftar gantian dengan ID baharu, dipautkan dua hala, jika perlu.' },
        where: { view: 'items', tab: 'find', label: { en: 'Items › Scan or find', ms: 'Barang › Imbas atau cari' } },
      },
    ],
    rules: [
      { en: 'The person who opened the case never decides it.', ms: 'Orang yang membuka kes tidak boleh memutuskannya.' },
      { en: 'An IT device is disposed of only through IT’s disposal record.', ms: 'Peranti IT dilupuskan hanya melalui rekod pelupusan IT.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/ITEM_REGISTER.md', decided: 'Fauzan, 6 Nov 2026; Part U, 14 Nov 2026' },
    words: 'missing hilang lost damaged rosak case kes dispose lupus replacement gantian',
  },
  {
    id: 'equip-item-care',
    app: 'equip',
    title: { en: 'After-sale care and service', ms: 'Penjagaan selepas jualan dan servis' },
    purpose: {
      en: 'Even after a sale the seller looks after each unit’s service and life; the owning company sees the same list and asks for service.',
      ms: 'Walaupun selepas jualan, penjual menjaga servis dan hayat setiap unit; syarikat pemilik melihat senarai yang sama dan memohon servis.',
    },
    start: { view: 'items', tab: 'care', label: { en: 'Items › After-sale care', ms: 'Barang › Penjagaan selepas jualan' } },
    starter: { en: 'The owning company (service request) or the seller (service check)', ms: 'Syarikat pemilik (permohonan servis) atau penjual (semakan servis)' },
    steps: [
      {
        who: { en: 'Central store manager', ms: 'Pengurus stor pusat' },
        does: { en: 'Sets the service interval and expected life per item type, with the source. None is assumed.', ms: 'Menetapkan selang servis dan jangka hayat bagi setiap jenis barang, dengan sumbernya. Tiada yang diandaikan.' },
        where: { view: 'items', tab: 'catalogue', label: { en: 'Items › Item types', ms: 'Barang › Jenis barang' } },
      },
      {
        who: { en: 'Owning company', ms: 'Syarikat pemilik' },
        does: { en: 'Asks for service on a unit.', ms: 'Memohon servis bagi sesuatu unit.' },
        where: { view: 'items', tab: 'care', label: { en: 'Items › After-sale care', ms: 'Barang › Penjagaan selepas jualan' } },
      },
      {
        who: { en: 'Seller', ms: 'Penjual' },
        does: { en: 'Records the service check; a damaged result opens a case for the holder.', ms: 'Merekod semakan servis; keputusan rosak membuka kes bagi pemegang.' },
        where: { view: 'items', tab: 'care', label: { en: 'Items › After-sale care', ms: 'Barang › Penjagaan selepas jualan' } },
      },
    ],
    rules: [{ en: 'A service never moves the item or changes the owner.', ms: 'Servis tidak menggerakkan barang atau menukar pemilik.' }],
    status: 'in_force',
    source: { doc: 'docs/ITEM_REGISTER.md', decided: 'Fauzan, 6 Nov 2026' },
    words: 'service servis care penjagaan maintenance penyelenggaraan life hayat',
  },
  {
    id: 'equip-site-fittings',
    app: 'equip',
    title: { en: 'Site fittings: plan, monthly check, contract-end take back', ms: 'Kelengkapan tapak: pelan, semakan bulanan, ambil balik akhir kontrak' },
    purpose: {
      en: 'Chairs, tables, fans, the guard post, CCTV and the contract’s guard equipment at each site: planned, checked every month and taken back when the contract ends.',
      ms: 'Kerusi, meja, kipas, pondok pengawal, CCTV dan peralatan pengawal kontrak di setiap tapak: dirancang, disemak setiap bulan dan diambil balik apabila kontrak tamat.',
    },
    start: { view: 'sitestock', tab: 'fittings', label: { en: 'Fittings for one site', ms: 'Kelengkapan satu tapak' } },
    starter: { en: 'OM or Regional OM covering the site', ms: 'OM atau OM Wilayah yang menjaga tapak' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Adds the site’s fittings (or loads them from the old list; “Add KPM guard equipment” for a KPM contract), naming the responsible person where needed.',
          ms: 'Menambah kelengkapan tapak (atau memuatkannya daripada senarai lama; “Add KPM guard equipment” bagi kontrak KPM), menamakan orang bertanggungjawab jika perlu.',
        },
        where: { view: 'sitestock', tab: 'fittings', label: { en: 'Site stock › Fittings', ms: 'Stok tapak › Kelengkapan' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Records the monthly check: how many are in place and broken, with a photo. A check is due after 31 days.', ms: 'Merekod semakan bulanan: berapa yang ada dan rosak, dengan gambar. Semakan perlu dibuat selepas 31 hari.' },
        where: { view: 'sitestock', tab: 'fittings', label: { en: 'Site stock › Fittings', ms: 'Stok tapak › Kelengkapan' } },
      },
      {
        who: { en: 'COO or CEO', ms: 'COO atau CEO' },
        does: { en: 'Approves giving an item to the client at contract end, with a reason.', ms: 'Meluluskan pemberian barang kepada klien pada akhir kontrak, dengan sebab.' },
        where: { view: 'sitestock', tab: 'fittings', label: { en: 'Site stock › Fittings', ms: 'Stok tapak › Kelengkapan' } },
        decision: true,
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'At contract end records what was taken back and what was handed over, with a photo.', ms: 'Pada akhir kontrak merekod apa yang diambil balik dan apa yang diserahkan, dengan gambar.' },
        where: { view: 'sitestock', tab: 'fittings', label: { en: 'Site stock › Fittings', ms: 'Stok tapak › Kelengkapan' } },
      },
    ],
    rules: [
      { en: 'Everything is taken back at contract end, except what the contract hands over and what the COO or CEO decides to give.', ms: 'Semua diambil balik pada akhir kontrak, kecuali yang diserahkan oleh kontrak dan yang diputuskan untuk diberi oleh COO atau CEO.' },
      { en: 'Procurement and Inventory see every site, guard uniforms included; the company manager only views.', ms: 'Perolehan dan Inventori melihat semua tapak, termasuk uniform pengawal; pengurus syarikat hanya melihat.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/CLEANING_AND_DUTY_PLANNER.md', decided: 'Fauzan, 4 Nov 2026 (SITE-KIT-CHECK)' },
    words: 'fittings kelengkapan site kit tapak chair kerusi fan kipas cctv guard post pondok contract end tamat kontrak take back ambil balik',
  },
  {
    id: 'equip-vehicle-request',
    app: 'equip',
    title: { en: 'Request a company vehicle', ms: 'Mohon kenderaan syarikat' },
    purpose: {
      en: 'Staff ask for a vehicle for a trip; the Transport head approves and picks the vehicle; each use is logged out and in with the mileage.',
      ms: 'Staf memohon kenderaan untuk perjalanan; ketua Pengangkutan meluluskan dan memilih kenderaan; setiap penggunaan direkod keluar dan masuk dengan bacaan jarak.',
    },
    start: { view: 'fleet', tab: 'mine', label: { en: 'Request a vehicle', ms: 'Mohon kenderaan' } },
    starter: { en: 'Any office staff member (not guards or patrolling officers)', ms: 'Mana-mana staf pejabat (bukan pengawal atau peronda)' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: { en: 'Gives the purpose and the from and to times, and may ask for a particular vehicle.', ms: 'Memberi tujuan dan masa dari dan hingga, dan boleh meminta kenderaan tertentu.' },
        where: { view: 'fleet', tab: 'mine', label: { en: 'Vehicles › My requests', ms: 'Kenderaan › Permohonan saya' } },
      },
      {
        who: { en: 'Transport head', ms: 'Ketua Pengangkutan' },
        does: { en: 'Approves with the vehicle, or rejects, with a note.', ms: 'Meluluskan dengan kenderaan, atau menolak, dengan catatan.' },
        where: { view: 'fleet', tab: 'requests', label: { en: 'Vehicles › Requests', ms: 'Kenderaan › Permohonan' } },
        decision: true,
      },
      {
        who: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
        does: { en: 'Files the driver’s consent before a monitored vehicle is driven.', ms: 'Memfailkan persetujuan pemandu sebelum kenderaan yang dipantau dipandu.' },
        where: { view: 'fleet', tab: 'consent', label: { en: 'Vehicles › Driver consent', ms: 'Kenderaan › Persetujuan pemandu' } },
      },
      {
        who: { en: 'Transport head', ms: 'Ketua Pengangkutan' },
        does: { en: 'Logs the vehicle out (driver and km) and back in (km and note).', ms: 'Merekod kenderaan keluar (pemandu dan km) dan masuk semula (km dan catatan).' },
        where: { view: 'fleet', tab: 'vehicles', label: { en: 'Vehicles › Vehicles', ms: 'Kenderaan › Kenderaan' } },
      },
    ],
    rules: [
      { en: 'Guards and patrolling officers do not request vehicles here.', ms: 'Pengawal dan peronda tidak memohon kenderaan di sini.' },
      { en: 'Trackers, dashcams and driver health are not connected yet, so they show Unknown.', ms: 'Penjejak, kamera papan pemuka dan kesihatan pemandu belum disambung, jadi ia ditunjuk Tidak diketahui.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/special-ops.md', decided: 'Fauzan, 26 Oct 2026' },
    words: 'vehicle kenderaan car kereta van transport pengangkutan book tempah trip perjalanan driver pemandu',
  },
  {
    id: 'equip-vehicle-upkeep',
    app: 'equip',
    title: { en: 'Vehicle renewals, servicing and fuel', ms: 'Pembaharuan, servis dan minyak kenderaan' },
    purpose: {
      en: 'Road tax, insurance, PUSPAKOM, permits and servicing are reminded and recorded with receipts; every fill-up is recorded and flagged fill-ups are checked by someone else.',
      ms: 'Cukai jalan, insurans, PUSPAKOM, permit dan servis diingatkan dan direkod dengan resit; setiap pengisian minyak direkod dan yang ditanda disemak oleh orang lain.',
    },
    start: { view: 'fleet', tab: 'due', label: { en: 'Vehicles › Reminders', ms: 'Kenderaan › Peringatan' } },
    starter: { en: 'Transport head; the driver for fill-ups', ms: 'Ketua Pengangkutan; pemandu bagi pengisian minyak' },
    steps: [
      {
        who: { en: 'Transport head', ms: 'Ketua Pengangkutan' },
        does: { en: 'Sees what is due or overdue and records each renewal or service with its receipt and the next due date or km.', ms: 'Melihat apa yang perlu atau lewat dan merekod setiap pembaharuan atau servis dengan resit serta tarikh atau km seterusnya.' },
        where: { view: 'fleet', tab: 'due', label: { en: 'Vehicles › Reminders', ms: 'Kenderaan › Peringatan' } },
      },
      {
        who: { en: 'Driver', ms: 'Pemandu' },
        does: { en: 'Records each fill-up of the vehicle out with them: litres, amount and how it was paid.', ms: 'Merekod setiap pengisian minyak kenderaan yang dibawa: liter, amaun dan cara bayaran.' },
        where: { view: 'fleet', tab: 'mine', label: { en: 'Vehicles › My requests', ms: 'Kenderaan › Permohonan saya' } },
      },
      {
        who: { en: 'Transport (someone else)', ms: 'Pengangkutan (orang lain)' },
        does: { en: 'Reviews each flagged fill-up: explained, recover from the driver, or refer for investigation, with a reason.', ms: 'Menyemak setiap pengisian yang ditanda: dijelaskan, tuntut balik daripada pemandu, atau rujuk untuk siasatan, dengan sebab.' },
        where: { view: 'fleet', tab: 'usage', label: { en: 'Vehicles › Fuel and usage', ms: 'Kenderaan › Minyak dan penggunaan' } },
        decision: true,
      },
      {
        who: { en: 'Finance Director or CEO', ms: 'Pengarah Kewangan atau CEO' },
        does: { en: 'Sets the rent of each rented vehicle with a reason; the monthly bill is a draft for Finance.', ms: 'Menetapkan sewa setiap kenderaan sewaan dengan sebab; bil bulanan ialah draf untuk Kewangan.' },
        where: { view: 'fleet', tab: 'rentals', label: { en: 'Vehicles › Rented vehicles', ms: 'Kenderaan › Kenderaan sewaan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Only the last 4 digits of a fuel or subsidy card are kept.', ms: 'Hanya 4 digit terakhir kad minyak atau subsidi disimpan.' },
      { en: 'The COO and the OGM monitor fuel use.', ms: 'COO dan OGM memantau penggunaan minyak.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/special-ops.md', decided: 'Fauzan, 26 Oct and 5 Nov 2026' },
    words: 'road tax cukai jalan insurance insurans puspakom service servis fuel minyak petrol diesel card kad rental sewa',
  },
  {
    id: 'equip-office-repair',
    app: 'equip',
    title: { en: 'Office repair (Penyelenggaraan pejabat)', ms: 'Penyelenggaraan pejabat' },
    purpose: {
      en: 'An office staff member reports damage at an office; the maintenance unit checks, gets quotes, does the work after approval, and the person who asked confirms it.',
      ms: 'Staf pejabat melaporkan kerosakan di pejabat; unit penyelenggaraan menyemak, mendapatkan sebut harga, melaksanakan kerja selepas kelulusan, dan orang yang melapor mengesahkannya.',
    },
    start: { view: 'requests', label: { en: 'Report office damage', ms: 'Lapor kerosakan pejabat' } },
    starter: { en: 'Any office staff member', ms: 'Mana-mana staf pejabat' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: { en: 'Reports the damage: type, example (sets the level), area, details and photos. The level can be raised, never lowered.', ms: 'Melaporkan kerosakan: jenis, contoh (menetapkan tahap), kawasan, butiran dan gambar. Tahap boleh dinaikkan, tidak boleh diturunkan.' },
        where: { view: 'requests', label: { en: 'Claims and requests › Penyelenggaraan pejabat', ms: 'Tuntutan dan permohonan › Penyelenggaraan pejabat' } },
      },
      {
        who: { en: 'Maintenance unit (Asset Management)', ms: 'Unit penyelenggaraan (Pengurusan Aset)' },
        does: { en: 'Checks it, visits the site and records 3 quotes (one quote is enough up to RM5,000), then picks one with a reason.', ms: 'Menyemak, melawat tapak dan merekod 3 sebut harga (satu sebut harga memadai hingga RM5,000), kemudian memilih satu dengan sebab.' },
        where: { view: 'assets', tab: 'office', label: { en: 'Asset Management › Pejabat', ms: 'Pengurusan Aset › Pejabat' } },
      },
      {
        who: { en: 'Asset Director, Vice Chairman, CEO above RM50,000', ms: 'Pengarah Aset, Naib Pengerusi, CEO melebihi RM50,000' },
        does: { en: 'The Asset Director approves the job with a reason; the Vice Chairman consents; the CEO also above RM50,000.', ms: 'Pengarah Aset meluluskan kerja dengan sebab; Naib Pengerusi memberi persetujuan; CEO juga melebihi RM50,000.' },
        where: { view: 'assets', tab: 'office', label: { en: 'Asset Management › Pejabat', ms: 'Pengurusan Aset › Pejabat' } },
        decision: true,
      },
      {
        who: { en: 'Maintenance unit', ms: 'Unit penyelenggaraan' },
        does: { en: 'Starts the work only after the final approval, then records it done with photos.', ms: 'Memulakan kerja hanya selepas kelulusan akhir, kemudian merekod siap dengan gambar.' },
        where: { view: 'assets', tab: 'office', label: { en: 'Asset Management › Pejabat', ms: 'Pengurusan Aset › Pejabat' } },
      },
      {
        who: { en: 'The person who asked', ms: 'Orang yang melapor' },
        does: { en: 'Confirms it is fixed, or says it is not (reminders on day 3 and 5; the Asset Director may stand in after day 5 with a reason).', ms: 'Mengesahkan ia telah baik, atau menyatakan belum (peringatan hari ke-3 dan ke-5; Pengarah Aset boleh mengganti selepas hari ke-5 dengan sebab).' },
        where: { view: 'requests', label: { en: 'Claims and requests › Permohonan saya', ms: 'Tuntutan dan permohonan › Permohonan saya' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Pays in its own payments screen, never above the approved amount, and links the payment.', ms: 'Membayar melalui skrin bayaran sendiri, tidak melebihi amaun yang diluluskan, dan memautkan bayaran.' },
        where: { view: 'assets', tab: 'office', label: { en: 'Asset Management › Pejabat', ms: 'Pengurusan Aset › Pejabat' } },
      },
    ],
    rules: [
      { en: 'No work before the final approval. Nobody approves, checks or confirms their own work.', ms: 'Tiada kerja sebelum kelulusan akhir. Tiada sesiapa meluluskan, menyemak atau mengesahkan kerja sendiri.' },
      { en: 'Targets are alerts, never a block.', ms: 'Sasaran ialah amaran, bukan sekatan.' },
      { en: 'IT devices go to IT as help requests.', ms: 'Peranti IT dihantar kepada IT sebagai tiket bantuan.' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'In force 18 Nov 2026. Email notices wait for the Outlook connection (in-app only). The report form is on Claims and requests, which not every office menu has yet.',
      ms: 'Berkuat kuasa 18 Nov 2026. Notis e-mel menunggu sambungan Outlook (dalam aplikasi sahaja). Borang laporan ada di Tuntutan dan permohonan, yang belum ada dalam semua menu pejabat.',
    },
    source: { doc: 'docs/OFFICE_ASSETS.md', decided: 'Fauzan, 13-14 Nov 2026 (S-X1 to S-X35)' },
    words: 'office repair pembaikan pejabat damage kerosakan maintenance penyelenggaraan aircond lampu paip plumbing',
  },
  {
    id: 'equip-office-inventory',
    app: 'equip',
    title: { en: 'Office inventory update and office asset disposal', ms: 'Kemas kini inventori pejabat dan pelupusan aset pejabat' },
    purpose: {
      en: 'Each office keeps its furniture and equipment list current; an office item no longer fit is inspected and disposed of with approval.',
      ms: 'Setiap pejabat mengemas kini senarai perabot dan peralatannya; barang pejabat yang tidak sesuai lagi diperiksa dan dilupuskan dengan kelulusan.',
    },
    start: { view: 'requests', label: { en: 'Kemaskini inventori pejabat', ms: 'Kemaskini inventori pejabat' } },
    starter: { en: 'Office head and named admin executives', ms: 'Ketua pejabat dan eksekutif admin yang dinamakan' },
    steps: [
      {
        who: { en: 'Office head or named admin executive', ms: 'Ketua pejabat atau eksekutif admin yang dinamakan' },
        does: { en: 'Sends the inventory update: item, place, serial, condition, holder, with documents.', ms: 'Menghantar kemas kini inventori: barang, lokasi, nombor siri, keadaan, pemegang, dengan dokumen.' },
        where: { view: 'requests', label: { en: 'Claims and requests › Penyelenggaraan pejabat', ms: 'Tuntutan dan permohonan › Penyelenggaraan pejabat' } },
      },
      {
        who: { en: 'Maintenance unit, then Asset Director', ms: 'Unit penyelenggaraan, kemudian Pengarah Aset' },
        does: { en: 'The unit checks it, the Asset Director confirms it, the unit files it.', ms: 'Unit menyemak, Pengarah Aset mengesahkan, unit memfailkannya.' },
        where: { view: 'assets', tab: 'office', label: { en: 'Asset Management › Pejabat', ms: 'Pengurusan Aset › Pejabat' } },
        decision: true,
      },
      {
        who: { en: 'Anyone in the office, then the maintenance unit', ms: 'Sesiapa di pejabat, kemudian unit penyelenggaraan' },
        does: { en: 'Asks to dispose of an item; the unit inspects it (not fit, reuse, repair or fit) and reports.', ms: 'Memohon pelupusan barang; unit memeriksanya (tidak sesuai, guna semula, baiki atau sesuai) dan melaporkan.' },
        where: { view: 'assets', tab: 'office', label: { en: 'Asset Management › Pejabat', ms: 'Pengurusan Aset › Pejabat' } },
      },
      {
        who: { en: 'Asset Director (Vice Chairman consents where needed)', ms: 'Pengarah Aset (Naib Pengerusi memberi persetujuan jika perlu)' },
        does: {
          en: 'Approves the disposal; the Vice Chairman consents at RM10,000 book value, any sale, or a gift or transfer outside the group. Finance records sale money.',
          ms: 'Meluluskan pelupusan; Naib Pengerusi memberi persetujuan bagi nilai buku RM10,000, sebarang jualan, atau pemberian atau pindahan ke luar kumpulan. Kewangan merekod wang jualan.',
        },
        where: { view: 'assets', tab: 'office', label: { en: 'Asset Management › Pejabat', ms: 'Pengurusan Aset › Pejabat' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Every approval and every changed setting needs a reason.', ms: 'Setiap kelulusan dan setiap perubahan tetapan perlu sebab.' },
      { en: 'IT devices are disposed of through IT’s data-wipe process.', ms: 'Peranti IT dilupuskan melalui proses pemadaman data IT.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/OFFICE_ASSETS.md', decided: 'Fauzan, 13-14 Nov 2026' },
    words: 'office inventory inventori pejabat furniture perabot disposal pelupusan asset aset',
  },
  {
    id: 'equip-asset-buy',
    app: 'equip',
    title: { en: 'Asset Management: ask to buy, and dispose of a fixed asset', ms: 'Pengurusan Aset: mohon beli, dan lupus aset tetap' },
    purpose: {
      en: 'Furniture, fittings and renovations: the team asks to buy, the Finance Director or COO decides, the bought item becomes an asset; at the end of its life it is disposed of with approval.',
      ms: 'Perabot, kelengkapan dan pengubahsuaian: pasukan memohon beli, Pengarah Kewangan atau COO memutuskan, barang yang dibeli menjadi aset; di akhir hayatnya ia dilupuskan dengan kelulusan.',
    },
    start: { view: 'assets', tab: 'buy', label: { en: 'Ask to buy', ms: 'Mohon beli' } },
    starter: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
    steps: [
      {
        who: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
        does: { en: 'Asks to buy: what, why, where, whose books, category, quantity and estimated cost.', ms: 'Memohon beli: apa, kenapa, di mana, buku syarikat mana, kategori, kuantiti dan anggaran kos.' },
        where: { view: 'assets', tab: 'buy', label: { en: 'Asset Management › Purchases', ms: 'Pengurusan Aset › Pembelian' } },
      },
      {
        who: { en: 'Finance Director (up to RM10,000) or COO', ms: 'Pengarah Kewangan (hingga RM10,000) atau COO' },
        does: { en: 'Approves or refuses with a reason, never the person who asked.', ms: 'Meluluskan atau menolak dengan sebab, bukan orang yang memohon.' },
        where: { view: 'assets', tab: 'buy', label: { en: 'Asset Management › Purchases', ms: 'Pengurusan Aset › Pembelian' } },
        decision: true,
      },
      {
        who: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
        does: { en: 'Records it received: tag, actual cost (not above the approved amount) and date. It becomes an asset in the register.', ms: 'Merekod diterima: tag, kos sebenar (tidak melebihi amaun diluluskan) dan tarikh. Ia menjadi aset dalam daftar.' },
        where: { view: 'assets', tab: 'buy', label: { en: 'Asset Management › Purchases', ms: 'Pengurusan Aset › Pembelian' } },
      },
      {
        who: { en: 'Asset Management team; Finance Director or COO', ms: 'Pasukan Pengurusan Aset; Pengarah Kewangan atau COO' },
        does: {
          en: 'Asks to dispose; the Finance Director approves a book value up to RM10,000, the COO above; the disposal is recorded and Finance posts it with the journal number.',
          ms: 'Memohon pelupusan; Pengarah Kewangan meluluskan nilai buku hingga RM10,000, COO melebihi itu; pelupusan direkod dan Kewangan mengepos dengan nombor jurnal.',
        },
        where: { view: 'assets', tab: 'books', label: { en: 'Asset Management › Depreciation and disposal', ms: 'Pengurusan Aset › Susut nilai dan pelupusan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Computers and electronic items are not on this register.', ms: 'Komputer dan barang elektronik tiada dalam daftar ini.' },
      { en: 'A written-off asset that can still be used is kept in use or refurbished and reviewed every 12 months.', ms: 'Aset yang telah dihapus kira tetapi masih boleh digunakan terus digunakan atau dibaik pulih dan disemak setiap 12 bulan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/special-ops.md', decided: 'Fauzan, 27 Oct 2026 (AST-DEPN)' },
    words: 'asset aset buy beli furniture perabot fittings disposal pelupusan depreciation susut nilai fixed asset',
  },
  {
    id: 'equip-am-bq',
    app: 'equip',
    title: { en: 'Contractor job: BQ, quotes, award and variation', ms: 'Kerja kontraktor: BQ, sebut harga, anugerah dan variasi' },
    purpose: {
      en: 'Every Asset Management job sent to a contractor: job details, a bill of quantities, quotes compared line by line, an approved award, and any price change only by a variation order.',
      ms: 'Setiap kerja Pengurusan Aset yang dihantar kepada kontraktor: butiran kerja, senarai kuantiti (BQ), sebut harga dibanding baris demi baris, anugerah yang diluluskan, dan sebarang perubahan harga hanya melalui arahan perubahan (VO).',
    },
    start: { view: 'assets', tab: 'maintenance', label: { en: 'Work orders › BQ', ms: 'Arahan kerja › BQ' } },
    starter: { en: 'Maintenance executive or manager (Asset Management)', ms: 'Eksekutif atau pengurus penyelenggaraan (Pengurusan Aset)' },
    steps: [
      {
        who: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
        does: { en: 'Fills the job details and site measurements, drafts the BQ from a job template, prices lines only from past awards or a stated source, and submits.', ms: 'Mengisi butiran kerja dan ukuran tapak, mendraf BQ daripada templat, meletakkan harga hanya daripada anugerah lepas atau sumber yang dinyatakan, dan menghantar.' },
        where: { view: 'assets', tab: 'maintenance', label: { en: 'Asset Management › Maintenance', ms: 'Pengurusan Aset › Penyelenggaraan' } },
      },
      {
        who: { en: 'Asset Director (COO above RM50,000)', ms: 'Pengarah Aset (COO melebihi RM50,000)' },
        does: { en: 'Approves the BQ with a reason; the route is set: one quote, three quotes or open tender.', ms: 'Meluluskan BQ dengan sebab; laluan ditetapkan: satu sebut harga, tiga sebut harga atau tender terbuka.' },
        where: { view: 'assets', tab: 'maintenance', label: { en: 'Asset Management › Maintenance', ms: 'Pengurusan Aset › Penyelenggaraan' } },
        decision: true,
      },
      {
        who: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
        does: { en: 'Records each contractor’s quote line by line and asks to award; not the lowest complete quote needs a reason.', ms: 'Merekod sebut harga setiap kontraktor baris demi baris dan memohon anugerah; bukan sebut harga lengkap terendah perlu sebab.' },
        where: { view: 'assets', tab: 'maintenance', label: { en: 'Asset Management › Maintenance', ms: 'Pengurusan Aset › Penyelenggaraan' } },
      },
      {
        who: { en: 'Asset Director (COO above RM50,000)', ms: 'Pengarah Aset (COO melebihi RM50,000)' },
        does: { en: 'Approves the award; the contractor and agreed price are set on the work order.', ms: 'Meluluskan anugerah; kontraktor dan harga yang dipersetujui ditetapkan pada arahan kerja.' },
        where: { view: 'assets', tab: 'maintenance', label: { en: 'Asset Management › Maintenance', ms: 'Pengurusan Aset › Penyelenggaraan' } },
        decision: true,
      },
      {
        who: { en: 'Team, Asset Director, then CEO and Chairman', ms: 'Pasukan, Pengarah Aset, kemudian CEO dan Pengerusi' },
        does: { en: 'A variation order is raised with a reason, approved, then consented by the CEO and the Chairman.', ms: 'Arahan perubahan dibuka dengan sebab, diluluskan, kemudian dipersetujui oleh CEO dan Pengerusi.' },
        where: { view: 'assets', tab: 'maintenance', label: { en: 'Asset Management › Maintenance', ms: 'Pengurusan Aset › Penyelenggaraan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Nobody who wrote the job details or BQ approves it; when that is the Asset Director, the COO decides.', ms: 'Sesiapa yang menulis butiran kerja atau BQ tidak boleh meluluskannya; jika itu Pengarah Aset, COO memutuskan.' },
      { en: 'No rate is ever invented; a line with no known price stays empty.', ms: 'Tiada kadar direka; baris tanpa harga yang diketahui dibiarkan kosong.' },
    ],
    status: 'draft',
    statusNote: {
      en: 'Built. The route limits (one quote under RM5,000, three quotes to RM50,000, tender above) are proposals waiting for Fauzan’s decision.',
      ms: 'Telah dibina. Had laluan (satu sebut harga bawah RM5,000, tiga sebut harga hingga RM50,000, tender melebihi itu) masih cadangan menunggu keputusan Fauzan.',
    },
    source: { doc: 'docs/AM_BQ_QUOTES.md', decided: 'Fauzan, 5 Nov 2026 (limits proposed under AM-BQ)' },
    words: 'bq bill of quantities senarai kuantiti quote sebut harga contractor kontraktor award anugerah variation vo tender',
  },
  {
    id: 'equip-rental-home',
    app: 'equip',
    title: { en: 'Rental home: letting to move-out (Rumah sewa)', ms: 'Rumah sewa: dari iklan hingga keluar' },
    purpose: {
      en: 'Asset Management lets the owner companies’ homes: advert and enquiries, application and deposit, agreement and stamping, monthly rent, arrears, move-out and repairs.',
      ms: 'Pengurusan Aset menyewakan rumah syarikat pemilik: iklan dan pertanyaan, permohonan dan deposit, perjanjian dan setem, sewa bulanan, tunggakan, keluar dan pembaikan.',
    },
    start: { view: 'assets', tab: 'homes', label: { en: 'Asset Management › Rumah sewa', ms: 'Pengurusan Aset › Rumah sewa' } },
    starter: { en: 'Rental admin executive (Asset Management)', ms: 'Eksekutif admin sewaan (Pengurusan Aset)' },
    steps: [
      {
        who: { en: 'Rental admin executive', ms: 'Eksekutif admin sewaan' },
        does: { en: 'Proposes the rent and terms, adverts on each platform and answers enquiries within 2 office hours.', ms: 'Mencadangkan sewa dan terma, mengiklankan di setiap platform dan membalas pertanyaan dalam 2 jam pejabat.' },
        where: { view: 'assets', tab: 'homes', label: { en: 'Rumah sewa › Iklan', ms: 'Rumah sewa › Iklan' } },
      },
      {
        who: { en: 'Asset Director, then Chairman or Vice Chairman', ms: 'Pengarah Aset, kemudian Pengerusi atau Naib Pengerusi' },
        does: { en: 'The Asset Director approves the terms and the new tenant; the Chairman or Vice Chairman consents to the tenant.', ms: 'Pengarah Aset meluluskan terma dan penyewa baharu; Pengerusi atau Naib Pengerusi memberi persetujuan bagi penyewa.' },
        where: { view: 'assets', tab: 'homes', label: { en: 'Rumah sewa › Permohonan', ms: 'Rumah sewa › Permohonan' } },
        decision: true,
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Confirms the deposit in full from the bank; only then the agreement opens and keys are handed over through the handover gate.', ms: 'Mengesahkan deposit penuh daripada bank; barulah perjanjian dibuka dan kunci diserahkan melalui pintu serahan.' },
        where: { view: 'assets', tab: 'homes', label: { en: 'Rumah sewa › Permohonan', ms: 'Rumah sewa › Permohonan' } },
      },
      {
        who: { en: 'Finance and the rental team', ms: 'Kewangan dan pasukan sewaan' },
        does: { en: 'Each month Finance raises the invoice in SQL Account and records its number; payment is confirmed from the bank; arrears go to the Asset Director.', ms: 'Setiap bulan Kewangan mengeluarkan invois dalam SQL Account dan merekod nombornya; bayaran disahkan daripada bank; tunggakan dirujuk kepada Pengarah Aset.' },
        where: { view: 'assets', tab: 'homes', label: { en: 'Rumah sewa › Kutipan sewa', ms: 'Rumah sewa › Kutipan sewa' } },
      },
      {
        who: { en: 'Rental team, Finance', ms: 'Pasukan sewaan, Kewangan' },
        does: { en: 'Move-out: keys back, inspection, deposit statement within 24 hours, Finance refund in 2-3 working days.', ms: 'Keluar: kunci dipulangkan, pemeriksaan, penyata deposit dalam 24 jam, bayaran balik Kewangan dalam 2-3 hari bekerja.' },
        where: { view: 'assets', tab: 'homes', label: { en: 'Rumah sewa › Keluar & deposit', ms: 'Rumah sewa › Keluar & deposit' } },
      },
    ],
    rules: [
      { en: 'Prima never moves money, numbers an invoice or logs in to e-Duti Setem or LHDN.', ms: 'Prima tidak memindahkan wang, menomborkan invois atau log masuk ke e-Duti Setem atau LHDN.' },
      { en: 'No cash for homes; no lock change, removal of things or cutting utilities without the lawful step.', ms: 'Tiada tunai bagi rumah; tiada tukar kunci, alih barang atau potong utiliti tanpa langkah yang sah.' },
      { en: 'Repairs above RM5,000 need the Vice Chairman’s consent, above RM50,000 the CEO’s.', ms: 'Pembaikan melebihi RM5,000 perlu persetujuan Naib Pengerusi, melebihi RM50,000 persetujuan CEO.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/AM_RENTAL_PROCESS.md', decided: 'Fauzan, 14 Nov 2026 (V-X11 to V-X37)' },
    words: 'rental home rumah sewa tenant penyewa deposit agreement perjanjian setem stamp duty rent sewa arrears tunggakan move out keluar',
  },
  {
    id: 'equip-staff-house-stay',
    app: 'equip',
    title: { en: 'Staff house stay for a work trip', ms: 'Penginapan rumah pekerja untuk urusan kerja' },
    purpose: {
      en: 'Government Operations or an HQ department asks for a company house for staff on a trip; the price is shown before sending; the Asset team checks.',
      ms: 'Operasi Kerajaan atau jabatan HQ memohon rumah syarikat bagi staf yang bertugas luar; harga ditunjuk sebelum dihantar; pasukan Aset menyemak.',
    },
    start: { view: 'requests', label: { en: 'Mohon rumah pekerja / Staff house stay', ms: 'Mohon rumah pekerja' } },
    starter: { en: 'Government Operations or an HQ department', ms: 'Operasi Kerajaan atau jabatan HQ' },
    steps: [
      {
        who: { en: 'Requesting department', ms: 'Jabatan pemohon' },
        does: { en: 'Gives the house or town, dates, occupants from the staff list, who takes the keys and the purpose.', ms: 'Memberi rumah atau bandar, tarikh, penghuni daripada senarai staf, penerima kunci dan tujuan.' },
        where: { view: 'requests', label: { en: 'Claims and requests', ms: 'Tuntutan dan permohonan' } },
      },
      {
        who: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
        does: { en: 'Checks the request and the house calendar; nobody confirms their own request.', ms: 'Menyemak permohonan dan kalendar rumah; tiada sesiapa mengesahkan permohonan sendiri.' },
        where: { view: 'assets', label: { en: 'Asset Management › Short stays', ms: 'Pengurusan Aset › Penginapan singkat' } },
        decision: true,
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'A work stay is billed to the department; a private stay is confirmed once Finance sees the transfer.', ms: 'Penginapan kerja dibil kepada jabatan; penginapan peribadi disahkan apabila Kewangan melihat pemindahan.' },
      },
    ],
    rules: [
      { en: 'RM300 a person a night (a dated setting).', ms: 'RM300 seorang semalam (tetapan bertarikh).' },
      {
        en: 'Damage is deducted from the named staff member’s pay only after they acknowledge it in Prima with the written consent wording.',
        ms: 'Kerosakan dipotong daripada gaji staf yang dinamakan hanya selepas dia mengakuinya dalam Prima dengan ayat persetujuan bertulis.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/SHORT_STAYS_HOMESTAY_AIRBNB_STAFF.md', decided: 'Fauzan, 14 Nov 2026 (P19-P25)' },
    words: 'staff house rumah pekerja stay penginapan homestay trip outstation',
  },
  {
    id: 'equip-homestay-booking',
    app: 'equip',
    title: { en: 'Homestay and Airbnb booking', ms: 'Tempahan homestay dan Airbnb' },
    purpose: {
      en: 'One calendar per house for direct, Airbnb and staff stays: hold, deposit, full payment, keys, check-out and inspection.',
      ms: 'Satu kalendar bagi setiap rumah untuk tempahan terus, Airbnb dan staf: tahan, deposit, bayaran penuh, kunci, daftar keluar dan pemeriksaan.',
    },
    start: { view: 'assets', label: { en: 'Asset Management › Short stays', ms: 'Pengurusan Aset › Penginapan singkat' } },
    starter: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
    steps: [
      {
        who: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
        does: {
          en: 'Direct: keys the form while talking to the customer (PDPA consent ticked); held 3 working days for the deposit. Airbnb: enters the reservation and answers within 20 hours.',
          ms: 'Terus: mengisi borang semasa bercakap dengan pelanggan (persetujuan PDPA ditanda); ditahan 3 hari bekerja untuk deposit. Airbnb: memasukkan tempahan dan menjawab dalam 20 jam.',
        },
        where: { view: 'assets', label: { en: 'Asset Management › Short stays', ms: 'Pengurusan Aset › Penginapan singkat' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Alone confirms each payment in the bank and issues the receipt number; matches each Airbnb payout.', ms: 'Sahaja yang mengesahkan setiap bayaran dalam bank dan mengeluarkan nombor resit; memadankan setiap bayaran Airbnb.' },
        where: { view: 'assets', label: { en: 'Asset Management › Short stays', ms: 'Pengurusan Aset › Penginapan singkat' } },
        decision: true,
      },
      {
        who: { en: 'Asset Management team', ms: 'Pasukan Pengurusan Aset' },
        does: { en: 'Hands keys only when all conditions hold; at check-out counts keys, inspects with photos and marks the house for cleaning.', ms: 'Menyerahkan kunci hanya apabila semua syarat dipenuhi; semasa keluar mengira kunci, memeriksa dengan gambar dan menanda rumah untuk dibersihkan.' },
        where: { view: 'assets', label: { en: 'Asset Management › Short stays', ms: 'Pengurusan Aset › Penginapan singkat' } },
      },
    ],
    rules: [
      { en: 'Overlapping nights are refused whatever the channel.', ms: 'Malam yang bertindih ditolak walau apa pun salurannya.' },
      { en: 'Full payment 3 days before check-in; Airbnb damage is claimed through Airbnb only.', ms: 'Bayaran penuh 3 hari sebelum daftar masuk; tuntutan kerosakan Airbnb hanya melalui Airbnb.' },
      { en: 'No WhatsApp sending, Airbnb login or calendar link from Prima.', ms: 'Tiada penghantaran WhatsApp, log masuk Airbnb atau pautan kalendar dari Prima.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SHORT_STAYS_HOMESTAY_AIRBNB_STAFF.md', decided: 'Fauzan, 14 Nov 2026 (P26-P39)' },
    words: 'homestay airbnb booking tempahan guest tetamu deposit keys kunci check in check out',
  },
  {
    id: 'equip-rent-reminders',
    app: 'equip',
    title: { en: 'WhatsApp rent reminders', ms: 'Peringatan sewa melalui WhatsApp' },
    purpose: {
      en: 'Tenants who agreed get a WhatsApp reminder before and after rent is due; the team sees each reminder on the unit.',
      ms: 'Penyewa yang bersetuju menerima peringatan WhatsApp sebelum dan selepas sewa perlu dibayar; pasukan melihat setiap peringatan pada unit.',
    },
    start: { view: 'assets', tab: 'rent', label: { en: 'Rent and arrears', ms: 'Sewa dan tunggakan' } },
    starter: { en: 'Asset Management rental team', ms: 'Pasukan sewaan Pengurusan Aset' },
    steps: [
      {
        who: { en: 'Rental team', ms: 'Pasukan sewaan' },
        does: { en: 'Records how each tenant agreed to reminders (signed form or WhatsApp reply), or stops them.', ms: 'Merekod cara setiap penyewa bersetuju menerima peringatan (borang bertandatangan atau balasan WhatsApp), atau menghentikannya.' },
        where: { view: 'assets', tab: 'rent', label: { en: 'Asset Management › Rent and arrears', ms: 'Pengurusan Aset › Sewa dan tunggakan' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'When switched on, sends a reminder 3 days before, on the due date, 7 days late and every 10 days while unpaid, 9 am to 6 pm, once a day per tenant.',
          ms: 'Apabila dihidupkan, menghantar peringatan 3 hari sebelum, pada tarikh, 7 hari lewat dan setiap 10 hari selagi belum bayar, 9 pagi hingga 6 petang, sekali sehari bagi setiap penyewa.',
        },
      },
    ],
    rules: [
      { en: 'A tenant who replies STOP or BERHENTI is never messaged again.', ms: 'Penyewa yang membalas STOP atau BERHENTI tidak akan dihubungi lagi.' },
      { en: 'After 90 days late the team’s letter takes over, with the Asset Director’s approval.', ms: 'Selepas 90 hari lewat, surat pasukan mengambil alih, dengan kelulusan Pengarah Aset.' },
    ],
    status: 'off',
    statusNote: {
      en: 'Built but not connected: no WhatsApp Business number, templates or token. The reminder days are proposals for the Asset Director.',
      ms: 'Telah dibina tetapi belum disambung: tiada nombor WhatsApp Business, templat atau token. Hari peringatan masih cadangan untuk Pengarah Aset.',
    },
    source: { doc: 'docs/WHATSAPP_RENT_REMINDERS.md', decided: 'Fauzan, 2 Nov 2026 (rent due on the 1st)' },
    words: 'whatsapp reminder peringatan rent sewa tenant penyewa',
  },
  {
    id: 'equip-office-request',
    app: 'finance',
    title: { en: 'Office supplies, utilities and rent request; operation claim', ms: 'Permohonan bekalan pejabat, utiliti dan sewa; tuntutan operasi' },
    purpose: {
      en: 'Office consumables (not IT or asset items), utilities and rent are requested by the company manager and approved by the Chief of Staff then the COO. An operation claim is set by the OM and approved by the COO.',
      ms: 'Bekalan pejabat (bukan barang IT atau aset), utiliti dan sewa dipohon oleh pengurus syarikat dan diluluskan oleh Ketua Staf kemudian COO. Tuntutan operasi ditetapkan oleh OM dan diluluskan oleh COO.',
    },
    start: { view: 'requests', label: { en: 'New office request', ms: 'Permohonan pejabat baharu' } },
    starter: { en: 'Company manager (office request); OM (operation claim)', ms: 'Pengurus syarikat (permohonan pejabat); OM (tuntutan operasi)' },
    steps: [
      {
        who: { en: 'Company manager or OM', ms: 'Pengurus syarikat atau OM' },
        does: {
          en: 'Enters the month’s lines with the bill attached and sends. Rent or utilities can start from last month’s approved request.',
          ms: 'Memasukkan baris bulan itu dengan bil dilampirkan dan menghantar. Sewa atau utiliti boleh bermula daripada permohonan bulan lepas yang diluluskan.',
        },
        where: { view: 'requests', label: { en: 'Claims and requests', ms: 'Tuntutan dan permohonan' } },
      },
      {
        who: { en: 'Chief of Staff (office requests only)', ms: 'Ketua Staf (permohonan pejabat sahaja)' },
        does: { en: 'Approves, sends back or rejects with a reason.', ms: 'Meluluskan, memulangkan atau menolak dengan sebab.' },
        where: { view: 'requests', label: { en: 'Claims and requests › Waiting for me', ms: 'Tuntutan dan permohonan › Menunggu saya' } },
        decision: true,
      },
      {
        who: { en: 'COO', ms: 'COO' },
        does: { en: 'Gives the final approval, sends back or rejects with a reason.', ms: 'Memberi kelulusan akhir, memulangkan atau menolak dengan sebab.' },
        where: { view: 'requests', label: { en: 'Claims and requests › Waiting for me', ms: 'Tuntutan dan permohonan › Menunggu saya' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'IT items go to IT and assets (furniture, renovation) to Asset Management, not here.', ms: 'Barang IT dihantar kepada IT dan aset (perabot, pengubahsuaian) kepada Pengurusan Aset, bukan di sini.' },
      { en: 'Every decision needs a reason; nobody approves their own request.', ms: 'Setiap keputusan perlu sebab; tiada sesiapa meluluskan permohonan sendiri.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/operations.md', decided: 'Fauzan, 26 Oct 2026' },
    words: 'office request permohonan pejabat supplies bekalan utilities utiliti rent sewa operation claim tuntutan operasi chief of staff ketua staf coo',
  },
];

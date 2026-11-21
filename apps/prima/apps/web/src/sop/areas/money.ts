import type { Sop } from '../types';

/**
 * P121: Finance, Clients and sales, Foreign workers. Filled from Fauzan's documents (docs/*.md): FINANCE_PHASE2,
 * SQL_ACCOUNT_POSTING, BRANCHES_LEDGER, INSURANCE_CLAIMS, CONTRACTS_REAL_USE, CLIENT_DUE_DILIGENCE_AND_INSTRUCTIONS,
 * CLIENT_SHARE_LINKS, the FWM and FW documents, ARRIVAL_CASH_LOCAL_REVIEW, and the system guide (docs/system).
 */
export const SOPS_MONEY: Sop[] = [
  // ---------------------------------------------------------------- Finance
  {
    id: 'finance-payment',
    app: 'finance',
    title: { en: 'Paying a supplier or a bill', ms: 'Membayar pembekal atau bil' },
    purpose: {
      en: 'Every payment out of a company: Finance prepares it, someone else reviews it, the right approver approves it, and a fourth person records the release after paying in the bank portal.',
      ms: 'Setiap bayaran keluar dari syarikat: Kewangan menyediakannya, orang lain menyemak, pelulus yang betul meluluskan, dan orang keempat merekod pelepasan selepas membayar di portal bank.',
    },
    start: { view: 'finance', tab: 'payments', label: { en: 'Finance › Payments › New payment', ms: 'Kewangan › Bayaran › Bayaran baru' } },
    starter: { en: "Finance data entry, the team deputy or leader, the Finance Director (FD) or the CEO", ms: 'Kemasukan data Kewangan, timbalan atau ketua pasukan, Pengarah Kewangan (FD) atau CEO' },
    steps: [
      {
        who: { en: 'Finance data entry', ms: 'Kemasukan data Kewangan' },
        does: {
          en: 'Prepares the payment: payee from the verified payee list, what it is for (this decides the approver), amount, due date, bank account, the SQL Account document number and at least one supporting document.',
          ms: 'Menyediakan bayaran: penerima dari senarai penerima yang disahkan, untuk apa (ini menentukan pelulus), amaun, tarikh akhir, akaun bank, nombor dokumen SQL Account dan sekurang-kurangnya satu dokumen sokongan.',
        },
        where: { view: 'finance', tab: 'payments', label: { en: 'Finance › Payments', ms: 'Kewangan › Bayaran' } },
      },
      {
        who: { en: 'Team deputy or team leader', ms: 'Timbalan atau ketua pasukan' },
        does: { en: 'Reviews it with a comment, or returns it with a reason. Never the preparer.', ms: 'Menyemak dengan komen, atau memulangkan dengan sebab. Bukan penyedia.' },
        where: { view: 'finance', tab: 'payments', label: { en: 'Finance › Payments › Waiting for you', ms: 'Kewangan › Bayaran › Menunggu anda' } },
        decision: true,
      },
      {
        who: { en: 'FD or CEO (Finance payments); COO or CEO (Operations, IT, FWM, Procurement, Transport, Goodwill Empire)', ms: 'FD atau CEO (bayaran Kewangan); COO atau CEO (Operasi, IT, FWM, Perolehan, Pengangkutan, Goodwill Empire)' },
        does: {
          en: 'Approves with a comment or returns it. The COO does this on his own "Payments to approve" page. Never the preparer or the reviewer.',
          ms: 'Meluluskan dengan komen atau memulangkan. COO melakukannya di halaman "Bayaran untuk diluluskan" miliknya. Bukan penyedia atau penyemak.',
        },
        where: { view: 'finance', tab: 'payments', label: { en: 'Finance › Payments (COO: Payments to approve)', ms: 'Kewangan › Bayaran (COO: Bayaran untuk diluluskan)' } },
        decision: true,
      },
      {
        who: { en: 'Finance team (not the approver, not the preparer)', ms: 'Pasukan Kewangan (bukan pelulus, bukan penyedia)' },
        does: {
          en: 'Pays in the bank portal, then records the release in Prima with the bank reference, the last 4 digits and the account name the portal shows. Prima stops it if they differ from the verified payee.',
          ms: 'Membayar di portal bank, kemudian merekod pelepasan dalam Prima dengan rujukan bank, 4 digit terakhir dan nama akaun yang ditunjukkan portal. Prima menghalang jika berbeza daripada penerima yang disahkan.',
        },
        where: { view: 'finance', tab: 'payments', label: { en: 'Finance › Payments › Record release', ms: 'Kewangan › Bayaran › Rekod pelepasan' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Matches the payment to the bank statement once it is loaded, and lists any release that fails the check for the leaders, FD and CEO.',
          ms: 'Memadankan bayaran dengan penyata bank apabila dimuat naik, dan menyenaraikan pelepasan yang gagal semakan untuk ketua, FD dan CEO.',
        },
      },
    ],
    rules: [
      { en: 'Every approval needs a comment; returns and cancellations need a reason of at least 10 characters.', ms: 'Setiap kelulusan perlu komen; pemulangan dan pembatalan perlu sebab sekurang-kurangnya 10 aksara.' },
      { en: 'Prepare, review, approve and release are four different people. The CEO is bound by the same rule.', ms: 'Sedia, semak, lulus dan lepas ialah empat orang berbeza. CEO juga terikat dengan peraturan yang sama.' },
      { en: 'An approval lapses after 30 days if not released; the payment goes back for a fresh approval.', ms: 'Kelulusan luput selepas 30 hari jika tidak dilepaskan; bayaran kembali untuk kelulusan baharu.' },
      { en: 'The same SQL document, or the same payee and amount, is refused as a likely duplicate.', ms: 'Dokumen SQL yang sama, atau penerima dan amaun yang sama, ditolak sebagai kemungkinan pendua.' },
      { en: 'Prima never pays: money moves only in the bank portal. Payments of RM500,000 or more also remind the CEO.', ms: 'Prima tidak pernah membayar: wang bergerak hanya di portal bank. Bayaran RM500,000 ke atas turut mengingatkan CEO.' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'Approval in Teams is built but switched off; every payment is approved in Prima. SQL Account is not connected yet.',
      ms: 'Kelulusan dalam Teams sudah dibina tetapi dimatikan; setiap bayaran diluluskan dalam Prima. SQL Account belum disambungkan.',
    },
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 31 Oct and 1 Nov 2026' },
    words: 'payment bayaran pay supplier pembekal bill bil release lepas approve lulus coo fd voucher baucar bank portal',
  },
  {
    id: 'finance-payment-request',
    app: 'finance',
    title: { en: 'Payment request from a company', ms: 'Permohonan bayaran dari syarikat' },
    purpose: {
      en: 'A company head asks for money to be paid. The department head, Finance and the COO (or FD) approve it once; Finance then pays it without a second approval.',
      ms: 'Ketua syarikat memohon wang dibayar. Ketua jabatan, Kewangan dan COO (atau FD) meluluskannya sekali; Kewangan kemudian membayar tanpa kelulusan kedua.',
    },
    start: { view: 'payreq', label: { en: 'Payment requests › New payment request', ms: 'Permohonan bayaran › Permohonan bayaran baru' } },
    starter: { en: 'The company head (company manager)', ms: 'Ketua syarikat (Pengurus Syarikat)' },
    steps: [
      {
        who: { en: 'Company head', ms: 'Ketua syarikat' },
        does: { en: 'Creates the request and chooses what it is for; that decides the department head who approves.', ms: 'Membuat permohonan dan memilih untuk apa; itu menentukan ketua jabatan yang meluluskan.' },
        where: { view: 'payreq', label: { en: 'Payment requests', ms: 'Permohonan bayaran' } },
      },
      {
        who: { en: 'Department head', ms: 'Ketua jabatan' },
        does: {
          en: 'Approves or returns it: OGM (government sites, Procurement & Inventory, Goodwill Empire), Operations Director (private sites), IT Manager, FWM Manager or the Transport head. Finance subjects skip this step.',
          ms: 'Meluluskan atau memulangkan: OGM (tapak kerajaan, Perolehan & Inventori, Goodwill Empire), Pengarah Operasi (tapak swasta), Pengurus IT, Pengurus FWM atau ketua Pengangkutan. Perkara Kewangan melangkau langkah ini.',
        },
        where: { view: 'payreq', label: { en: 'Payment requests › Waiting for you', ms: 'Permohonan bayaran › Menunggu anda' } },
        decision: true,
      },
      {
        who: { en: "Finance (the company's team leader or deputy, or the FD)", ms: 'Kewangan (ketua atau timbalan pasukan syarikat, atau FD)' },
        does: { en: 'Checks the calculation, or returns it.', ms: 'Menyemak kiraan, atau memulangkannya.' },
        where: { view: 'payreq', label: { en: 'Payment requests › Waiting for you', ms: 'Permohonan bayaran › Menunggu anda' } },
        decision: true,
      },
      {
        who: { en: 'COO or CEO (COO departments); FD or CEO (Finance)', ms: 'COO atau CEO (jabatan COO); FD atau CEO (Kewangan)' },
        does: { en: 'Gives the final approval with a comment, or returns it.', ms: 'Memberi kelulusan akhir dengan komen, atau memulangkannya.' },
        where: { view: 'payreq', label: { en: 'Payment requests › Waiting for you', ms: 'Permohonan bayaran › Menunggu anda' } },
        decision: true,
      },
      {
        who: { en: 'Finance data entry', ms: 'Kemasukan data Kewangan' },
        does: {
          en: 'Prepares the payment from the approved request (same amount). The request’s final approval counts as the payment’s approval; review and release follow as for any payment.',
          ms: 'Menyediakan bayaran daripada permohonan yang diluluskan (amaun sama). Kelulusan akhir permohonan dikira sebagai kelulusan bayaran; semakan dan pelepasan seperti bayaran biasa.',
        },
        where: { view: 'finance', tab: 'payments', label: { en: 'Finance › Payments › New payment', ms: 'Kewangan › Bayaran › Bayaran baru' } },
      },
    ],
    rules: [
      { en: 'Nobody acts twice on a request, and the creator never approves it.', ms: 'Tiada sesiapa bertindak dua kali pada satu permohonan, dan pembuatnya tidak sekali-kali meluluskannya.' },
      {
        en: 'A return, or a lapse of its payment, sends it back to the company head, and the whole chain approves again.',
        ms: 'Pemulangan, atau bayarannya luput, menghantarnya kembali kepada ketua syarikat, dan seluruh rantaian meluluskan semula.',
      },
      { en: 'A returned request can be edited and resubmitted; its history and documents are kept.', ms: 'Permohonan yang dipulangkan boleh disunting dan dihantar semula; sejarah dan dokumennya disimpan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 1 and 2 Nov 2026' },
    words: 'payment request permohonan bayaran company head ketua syarikat department head ogm coo claim tuntutan',
  },
  {
    id: 'finance-payee-verify',
    app: 'finance',
    title: { en: 'Adding and verifying a payee', ms: 'Menambah dan mengesahkan penerima bayaran' },
    purpose: {
      en: 'Money goes only to a payee on the company’s payee list whose bank details someone else has verified by call-back.',
      ms: 'Wang hanya dibayar kepada penerima dalam senarai syarikat yang butiran banknya telah disahkan oleh orang lain melalui panggilan semula.',
    },
    start: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › Add payee', ms: 'Kewangan › Semakan › Bayaran keluar › Tambah penerima' } },
    starter: { en: 'Finance team', ms: 'Pasukan Kewangan' },
    steps: [
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Adds the payee: name, type, registration number, bank, the last 4 digits only and the account name the bank shows.',
          ms: 'Menambah penerima: nama, jenis, nombor pendaftaran, bank, 4 digit terakhir sahaja dan nama akaun yang ditunjukkan bank.',
        },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out', ms: 'Kewangan › Semakan › Bayaran keluar' } },
      },
      {
        who: { en: 'Another Finance person', ms: 'Orang Kewangan yang lain' },
        does: {
          en: 'Verifies it: calls back on a number from the company’s own records (never the number on the request), or uses a bank letter or the portal’s name check, and records where the number came from.',
          ms: 'Mengesahkan: membuat panggilan semula ke nombor dari rekod syarikat sendiri (bukan nombor pada permohonan), atau guna surat bank atau semakan nama portal, dan merekod sumber nombor itu.',
        },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › Verify', ms: 'Kewangan › Semakan › Bayaran keluar › Sahkan' } },
        decision: true,
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'When the payee changes bank account: Change bank details. The payee goes back to "To verify" and its open payments are held until verified again.',
          ms: 'Apabila penerima menukar akaun bank: Tukar butiran bank. Penerima kembali ke "Untuk disahkan" dan bayaran terbukanya ditahan sehingga disahkan semula.',
        },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out', ms: 'Kewangan › Semakan › Bayaran keluar' } },
      },
    ],
    rules: [
      { en: 'Prima never keeps full account numbers, bank passwords or TACs.', ms: 'Prima tidak pernah menyimpan nombor akaun penuh, kata laluan bank atau TAC.' },
      {
        en: 'Whoever entered or changed a payee’s bank details does not prepare, review, approve or release payments to that payee.',
        ms: 'Sesiapa yang memasukkan atau menukar butiran bank penerima tidak menyediakan, menyemak, meluluskan atau melepaskan bayaran kepada penerima itu.',
      },
      {
        en: 'A blocked payee cannot be used. The team leader, FD or CEO blocks or unblocks with a reason; an unblocked payee is verified again.',
        ms: 'Penerima yang disekat tidak boleh digunakan. Ketua pasukan, FD atau CEO menyekat atau membuka sekatan dengan sebab; penerima yang dibuka sekatan disahkan semula.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 31 Oct and 1 Nov 2026' },
    words: 'payee penerima supplier pembekal bank account akaun call-back panggilan semula verify sahkan fraud penipuan',
  },
  {
    id: 'finance-bank-reconciliation',
    app: 'finance',
    title: { en: 'Bank statement and reconciliation', ms: 'Penyata bank dan penyesuaian bank' },
    purpose: {
      en: 'Each month, for every bank account: load the statement, paste SQL Account’s ledger, let Prima pair the lines, explain the rest and have it reviewed.',
      ms: 'Setiap bulan, bagi setiap akaun bank: muat naik penyata, tampal lejar SQL Account, biar Prima memadankan baris, terangkan bakinya dan minta disemak.',
    },
    start: { view: 'finance', tab: 'checks-bank', label: { en: 'Finance › Checks › Bank › Load statement', ms: 'Kewangan › Semakan › Bank › Muat naik penyata' } },
    starter: { en: 'Finance team (not whoever released payments from that account that month)', ms: 'Pasukan Kewangan (bukan sesiapa yang melepaskan bayaran dari akaun itu bulan tersebut)' },
    steps: [
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Loads the month’s statement (CSV from the bank portal) with the opening and closing balance. Prima refuses a file that does not add up.',
          ms: 'Memuat naik penyata bulan itu (CSV dari portal bank) dengan baki awal dan akhir. Prima menolak fail yang tidak seimbang.',
        },
        where: { view: 'finance', tab: 'checks-bank', label: { en: 'Finance › Checks › Bank', ms: 'Kewangan › Semakan › Bank' } },
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Pastes SQL Account’s ledger for the same account and presses Reconcile now. Prima pairs lines by reference, amount and date and lists what is left.',
          ms: 'Menampal lejar SQL Account bagi akaun yang sama dan tekan Reconcile now. Prima memadankan baris mengikut rujukan, amaun dan tarikh serta menyenaraikan bakinya.',
        },
        where: { view: 'finance', tab: 'checks-bank', label: { en: 'Finance › Checks › Bank › Reconcile now', ms: 'Kewangan › Semakan › Bank › Reconcile now' } },
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Explains each bank-only line with its SQL posting reference, or matches by hand with a comment, until the balance proves to RM0.00.',
          ms: 'Menerangkan setiap baris yang hanya ada di bank dengan rujukan catatan SQL, atau memadankan secara manual dengan komen, sehingga baki terbukti RM0.00.',
        },
        where: { view: 'finance', tab: 'checks-bank', label: { en: 'Finance › Checks › Bank', ms: 'Kewangan › Semakan › Bank' } },
      },
      {
        who: { en: 'Someone who did not run it', ms: 'Orang yang tidak menjalankannya' },
        does: { en: 'Reviews the reconciliation with a comment.', ms: 'Menyemak penyesuaian dengan komen.' },
        where: { view: 'finance', tab: 'checks-bank', label: { en: 'Finance › Checks › Bank › Review', ms: 'Kewangan › Semakan › Bank › Semak' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Banks are reconciled by the 10th of the next month.', ms: 'Bank disesuaikan selewat-lewatnya 10hb bulan berikutnya.' },
      {
        en: 'Money out with no approved Prima payment, and payments released 5 or more days ago that are not on a statement, must be explained before the close.',
        ms: 'Wang keluar tanpa bayaran Prima yang diluluskan, dan bayaran yang dilepaskan 5 hari atau lebih tetapi tiada dalam penyata, mesti diterangkan sebelum tutup akaun.',
      },
      { en: 'Nobody hand-matches a payment they prepared, approved or released.', ms: 'Tiada sesiapa memadankan secara manual bayaran yang mereka sediakan, luluskan atau lepaskan.' },
      { en: 'A reviewed reconciliation is redone only by the FD or the CEO.', ms: 'Penyesuaian yang telah disemak hanya dibuat semula oleh FD atau CEO.' },
    ],
    status: 'in_force',
    statusNote: { en: 'SQL Account is not connected: its ledger is an export staff paste in.', ms: 'SQL Account belum disambungkan: lejarnya dieksport dan ditampal oleh staf.' },
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 1 Nov 2026' },
    words: 'bank statement penyata reconciliation penyesuaian rekonsiliasi bank rec csv ledger lejar sql account match padan',
  },
  {
    id: 'finance-month-end-close',
    app: 'finance',
    title: { en: 'Month-end close (approved financials)', ms: 'Tutup akaun hujung bulan (penyata kewangan diluluskan)' },
    purpose: {
      en: 'Each company’s last month is closed only when SQL Account is closed, every bank is reconciled, the statement tests pass and every exception is explained; the FD or CEO then approves the financials.',
      ms: 'Bulan lepas setiap syarikat hanya ditutup apabila SQL Account ditutup, setiap bank disesuaikan, ujian penyata lulus dan setiap pengecualian diterangkan; FD atau CEO kemudian meluluskan penyata kewangan.',
    },
    start: { view: 'finance', tab: 'close', label: { en: 'Finance › Month-end close', ms: 'Kewangan › Tutup hujung bulan' } },
    starter: { en: "The company's Finance team", ms: 'Pasukan Kewangan syarikat' },
    steps: [
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Finishes the monthly checks (bank reconciliations, ageing, e-Invoice, SST, intercompany, statement tests FS-01 to FS-12) and attaches each bank’s reconciliation report.',
          ms: 'Menyiapkan semakan bulanan (penyesuaian bank, umur hutang, e-Invois, SST, antara syarikat, ujian penyata FS-01 hingga FS-12) dan melampirkan laporan penyesuaian setiap bank.',
        },
        where: { view: 'finance', tab: 'checks', label: { en: 'Finance › Checks', ms: 'Kewangan › Semakan' } },
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: { en: 'Explains every exception, then sends the close for review.', ms: 'Menerangkan setiap pengecualian, kemudian menghantar penutupan untuk semakan.' },
        where: { view: 'finance', tab: 'close', label: { en: 'Finance › Month-end close › Send for review', ms: 'Kewangan › Tutup hujung bulan › Hantar untuk semakan' } },
      },
      {
        who: { en: 'Team deputy or leader (not the preparer)', ms: 'Timbalan atau ketua pasukan (bukan penyedia)' },
        does: { en: 'Marks it reviewed with a comment, or returns it.', ms: 'Menanda sudah disemak dengan komen, atau memulangkannya.' },
        where: { view: 'finance', tab: 'close', label: { en: 'Finance › Month-end close › Mark reviewed', ms: 'Kewangan › Tutup hujung bulan › Tanda disemak' } },
        decision: true,
      },
      {
        who: { en: 'FD or CEO (not the preparer or reviewer)', ms: 'FD atau CEO (bukan penyedia atau penyemak)' },
        does: {
          en: 'Approves the financials once the month’s bank pack is reviewed, or returns it to the team to explain what appeared after review.',
          ms: 'Meluluskan penyata kewangan setelah pek bank bulan itu disemak, atau memulangkan kepada pasukan untuk menerangkan apa yang muncul selepas semakan.',
        },
        where: { view: 'finance', tab: 'close', label: { en: 'Finance › Month-end close › Approve financials', ms: 'Kewangan › Tutup hujung bulan › Luluskan penyata kewangan' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Blocked while: no SQL Account figures in the last 48 hours, the month is not closed in SQL Account, a bank is not reconciled, or FS-01, FS-02 or FS-06 is not exactly RM0.00.',
        ms: 'Disekat selagi: tiada angka SQL Account dalam 48 jam lepas, bulan belum ditutup dalam SQL Account, bank belum disesuaikan, atau FS-01, FS-02 atau FS-06 bukan tepat RM0.00.',
      },
      { en: 'The month is closed by the 15th. Reopening needs a reason.', ms: 'Bulan ditutup selewat-lewatnya 15hb. Membuka semula perlu sebab.' },
      { en: 'The FD and CEO are reminded of closes not approved by the 15th.', ms: 'FD dan CEO diingatkan tentang penutupan yang belum diluluskan menjelang 15hb.' },
    ],
    status: 'in_force',
    statusNote: { en: 'SQL Account figures are typed from its reports until it is connected.', ms: 'Angka SQL Account ditaip daripada laporannya sehingga ia disambungkan.' },
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 31 Oct and 1 Nov 2026' },
    words: 'month end close tutup akaun hujung bulan financials penyata kewangan fs-01 fs-06 approve lulus fd',
  },
  {
    id: 'finance-monthly-packs',
    app: 'finance',
    title: { en: 'Monthly packs: bank, payment, audit file, auditor and tax', ms: 'Pek bulanan: bank, bayaran, fail audit, juruaudit dan cukai' },
    purpose: {
      en: 'The papers each company keeps up every month: bank pack by the 10th, payment pack by the 15th, monthly audit file by the 20th, and the papers for the auditor and the tax agent.',
      ms: 'Kertas yang setiap syarikat siapkan setiap bulan: pek bank menjelang 10hb, pek bayaran menjelang 15hb, fail audit bulanan menjelang 20hb, dan kertas untuk juruaudit dan ejen cukai.',
    },
    start: { view: 'finance', tab: 'close', label: { en: 'Finance › Month-end close (packs)', ms: 'Kewangan › Tutup hujung bulan (pek)' } },
    starter: { en: 'Finance data entry', ms: 'Kemasukan data Kewangan' },
    steps: [
      {
        who: { en: 'Finance data entry (or Prima)', ms: 'Kemasukan data Kewangan (atau Prima)' },
        does: {
          en: 'Prepares each item. Prima marks an item prepared by itself when it already holds everything (statement, reconciliation, released payments, ageing, SST return).',
          ms: 'Menyediakan setiap item. Prima menanda item sebagai disediakan sendiri apabila ia sudah memegang semuanya (penyata, penyesuaian, bayaran dilepaskan, umur hutang, penyata SST).',
        },
        where: { view: 'finance', tab: 'close', label: { en: 'Finance › Month-end close', ms: 'Kewangan › Tutup hujung bulan' } },
      },
      {
        who: { en: 'Team deputy or leader', ms: 'Timbalan atau ketua pasukan' },
        does: { en: 'Reviews each item with a comment. Never an item they prepared or whose work it lists.', ms: 'Menyemak setiap item dengan komen. Bukan item yang mereka sediakan atau yang menyenaraikan kerja mereka.' },
        where: { view: 'finance', tab: 'close', label: { en: 'Finance › Month-end close', ms: 'Kewangan › Tutup hujung bulan' } },
        decision: true,
      },
      {
        who: { en: 'Team leader, FD or CEO', ms: 'Ketua pasukan, FD atau CEO' },
        does: { en: 'Sends it with a comment. Papers for the auditor and the tax agent are tracked the same way.', ms: 'Menghantarnya dengan komen. Kertas untuk juruaudit dan ejen cukai dijejak dengan cara yang sama.' },
        where: { view: 'finance', tab: 'papers', label: { en: 'Finance › Auditor and tax', ms: 'Kewangan › Juruaudit dan cukai' } },
      },
    ],
    rules: [
      { en: 'Nobody reviews or sends a paper they prepared; reviewing and sending need a comment.', ms: 'Tiada sesiapa menyemak atau menghantar kertas yang mereka sediakan; menyemak dan menghantar perlu komen.' },
      {
        en: 'Year-end: audited accounts circulated within 6 months of year end, lodged with SSM within 30 days after, Form C within 7 months.',
        ms: 'Hujung tahun: akaun beraudit diedarkan dalam 6 bulan selepas hujung tahun, diserah kepada SSM dalam 30 hari selepas itu, Borang C dalam 7 bulan.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 31 Oct and 1 Nov 2026' },
    words: 'bank pack payment pack pek bank pek bayaran audit file fail audit auditor juruaudit tax agent ejen cukai papers kertas',
  },
  {
    id: 'finance-invoice-problems',
    app: 'finance',
    title: { en: 'Unpaid invoices, credit notes and bad debt', ms: 'Invois tidak berbayar, nota kredit dan hutang lapuk' },
    purpose: {
      en: 'Every invoice unpaid 90 days or more gets a case that is followed up until paid, re-issued to the right payer, provided for or written off.',
      ms: 'Setiap invois tidak berbayar 90 hari atau lebih dibuka kes yang disusuli sehingga dibayar, dikeluarkan semula kepada pembayar yang betul, diperuntukkan atau dihapus kira.',
    },
    start: { view: 'finance', tab: 'checks-in', label: { en: 'Finance › Checks › Money in › Open case', ms: 'Kewangan › Semakan › Wang masuk › Buka kes' } },
    starter: { en: 'Finance team', ms: 'Pasukan Kewangan' },
    steps: [
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: { en: 'Opens a case for the invoice and the reason (wrong payer, site changed, dispute, refused, insolvent, government pays late, other).', ms: 'Membuka kes untuk invois dan sebabnya (pembayar salah, tapak bertukar, pertikaian, enggan, muflis, kerajaan bayar lewat, lain-lain).' },
        where: { view: 'finance', tab: 'checks-in', label: { en: 'Finance › Checks › Money in', ms: 'Kewangan › Semakan › Wang masuk' } },
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: { en: 'Follows up at least every 30 days (reminder, call, letter of demand, lawyer) and records each step.', ms: 'Menyusul sekurang-kurangnya setiap 30 hari (peringatan, panggilan, surat tuntutan, peguam) dan merekod setiap langkah.' },
        where: { view: 'finance', tab: 'checks-in', label: { en: 'Finance › Checks › Money in', ms: 'Kewangan › Semakan › Wang masuk' } },
      },
      {
        who: { en: 'Someone other than the requester', ms: 'Orang selain pemohon' },
        does: {
          en: 'Wrong payer or site: approves a credit note in SQL Account plus a new invoice to the right payer. Doubtful debt: deputy, leader, FD or CEO approves the provision.',
          ms: 'Pembayar atau tapak salah: meluluskan nota kredit dalam SQL Account serta invois baharu kepada pembayar yang betul. Hutang ragu: timbalan, ketua, FD atau CEO meluluskan peruntukan.',
        },
        where: { view: 'finance', tab: 'checks-in', label: { en: 'Finance › Checks › Money in', ms: 'Kewangan › Semakan › Wang masuk' } },
        decision: true,
      },
      {
        who: { en: 'FD or CEO only', ms: 'FD atau CEO sahaja' },
        does: {
          en: 'Approves a bad debt write-off after 180 days of recovery steps (earlier if insolvent), with at least 2 pieces of evidence and the SQL Account credit note or journal.',
          ms: 'Meluluskan hapus kira hutang lapuk selepas 180 hari langkah pemulihan (lebih awal jika muflis), dengan sekurang-kurangnya 2 bukti dan nota kredit atau jurnal SQL Account.',
        },
        where: { view: 'finance', tab: 'checks-in', label: { en: 'Finance › Checks › Money in', ms: 'Kewangan › Semakan › Wang masuk' } },
        decision: true,
      },
      {
        who: { en: 'FD', ms: 'FD' },
        does: { en: 'Signs off each company’s overdue list every month with a comment.', ms: 'Menandatangani senarai tertunggak setiap syarikat setiap bulan dengan komen.' },
        where: { view: 'finance', tab: 'checks-in', label: { en: 'Finance › Checks › Money in › Sign off', ms: 'Kewangan › Semakan › Wang masuk › Sign off' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Never delete an invoice. Cancelling in MyInvois only for a validated e-Invoice within 72 hours.', ms: 'Jangan sekali-kali padam invois. Batal dalam MyInvois hanya bagi e-Invois yang disahkan dalam 72 jam.' },
      { en: 'A customer receipt counts only once Prima finds the money on the loaded bank statement.', ms: 'Penerimaan pelanggan hanya dikira apabila Prima menemui wang itu dalam penyata bank yang dimuat naik.' },
      { en: 'A credit note for an audited year is dated in the current open month; tell the auditor.', ms: 'Nota kredit bagi tahun yang telah diaudit bertarikh dalam bulan terbuka semasa; maklumkan juruaudit.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 1 Nov 2026' },
    words: 'invoice invois unpaid tertunggak overdue bad debt hutang lapuk write-off hapus kira credit note nota kredit ageing collection kutipan',
  },
  {
    id: 'finance-sst-return',
    app: 'finance',
    title: { en: 'Service tax (SST) return and payment to Customs', ms: 'Penyata cukai perkhidmatan (SST) dan bayaran kepada Kastam' },
    purpose: {
      en: 'For each two-month period: prepare the return from the money received, have it reviewed, file it in MySST and pay Customs the exact tax.',
      ms: 'Bagi setiap tempoh dua bulan: sediakan penyata daripada wang yang diterima, minta disemak, failkan dalam MySST dan bayar Kastam cukai yang tepat.',
    },
    start: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
    starter: { en: 'Finance team', ms: 'Pasukan Kewangan' },
    steps: [
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Prepares the return from the money received for taxable services: tax = 8/108 of it. It must agree with the SST on the invoices paid, within RM1, or be explained.',
          ms: 'Menyediakan penyata daripada wang diterima bagi perkhidmatan bercukai: cukai = 8/108 daripadanya. Ia mesti sepadan dengan SST pada invois yang dibayar, dalam RM1, atau diterangkan.',
        },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
      },
      {
        who: { en: 'Someone other than the preparer', ms: 'Orang selain penyedia' },
        does: { en: 'Reviews the return.', ms: 'Menyemak penyata.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
        decision: true,
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: { en: 'Files it in MySST and records the acknowledgement number and date.', ms: 'Memfailkannya dalam MySST dan merekod nombor pengakuan dan tarikh.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end › Record filing', ms: 'Kewangan › Semakan › Cukai dan hujung bulan › Rekod pemfailan' } },
      },
      {
        who: { en: 'Finance team, then the FD or CEO', ms: 'Pasukan Kewangan, kemudian FD atau CEO' },
        does: { en: 'Pays Customs as a normal Prima payment to the tax payee, for exactly the declared tax.', ms: 'Membayar Kastam sebagai bayaran Prima biasa kepada penerima cukai, tepat amaun cukai yang diisytiharkan.' },
        where: { view: 'finance', tab: 'payments', label: { en: 'Finance › Payments', ms: 'Kewangan › Bayaran' } },
      },
    ],
    rules: [
      { en: 'Security services are taxable at 8% (since 1 March 2024). The group pays SST when the customer pays, not on invoice.', ms: 'Perkhidmatan keselamatan dikenakan cukai 8% (sejak 1 Mac 2024). Kumpulan membayar SST apabila pelanggan membayar, bukan semasa invois.' },
      { en: 'A warning shows when taxable services pass RM500,000 in 12 months and the company is not registered.', ms: 'Amaran dipapar apabila perkhidmatan bercukai melebihi RM500,000 dalam 12 bulan dan syarikat belum berdaftar.' },
      { en: 'Only the FD or CEO marks a company "not registered for SST".', ms: 'Hanya FD atau CEO menanda syarikat "tidak berdaftar SST".' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 1 Nov 2026' },
    words: 'sst service tax cukai perkhidmatan customs kastam mysst sst-02 8% tax return penyata cukai',
  },
  {
    id: 'finance-einvoice-check',
    app: 'finance',
    title: { en: 'Monthly e-Invoice check (LHDN MyInvois)', ms: 'Semakan e-Invois bulanan (LHDN MyInvois)' },
    purpose: {
      en: 'SQL Account sends e-Invoices; Prima checks every month that it did, per company.',
      ms: 'SQL Account menghantar e-Invois; Prima menyemak setiap bulan bahawa ia telah berbuat demikian, bagi setiap syarikat.',
    },
    start: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
    starter: { en: 'Finance team', ms: 'Pasukan Kewangan' },
    steps: [
      {
        who: { en: 'FD or CEO', ms: 'FD atau CEO' },
        does: {
          en: 'Sets each company up: its own turnover, required or not (RM3 million and above is required), start date and how it sends.',
          ms: 'Menetapkan setiap syarikat: perolehannya sendiri, wajib atau tidak (RM3 juta ke atas wajib), tarikh mula dan cara penghantaran.',
        },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'By the 10th records the month: sales documents issued, valid, invalid, stuck and not sent; the consolidated e-Invoice number and date; self-billed e-Invoices; late cancellations.',
          ms: 'Menjelang 10hb merekod bulan itu: dokumen jualan dikeluarkan, sah, tidak sah, tersangkut dan tidak dihantar; nombor dan tarikh e-Invois disatukan; e-Invois bil sendiri; pembatalan lewat.',
        },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
      },
      {
        who: { en: 'Someone else in Finance', ms: 'Orang lain dalam Kewangan' },
        does: { en: 'Reviews the check.', ms: 'Menyemak semakan itu.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Each company is tested on its own turnover, not group sales.', ms: 'Setiap syarikat diuji mengikut perolehannya sendiri, bukan jualan kumpulan.' },
      {
        en: 'The close is blocked without the reviewed check, while a sales document is not validated, or when the consolidated e-Invoice is missing.',
        ms: 'Tutup akaun disekat tanpa semakan yang disemak, selagi dokumen jualan belum disahkan, atau apabila e-Invois disatukan tiada.',
      },
      { en: 'Ask the supplier for its validated e-Invoice before paying.', ms: 'Minta e-Invois yang disahkan daripada pembekal sebelum membayar.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 1 Nov 2026' },
    words: 'e-invoice e-invois myinvois lhdn consolidated disatukan self-billed uuid',
  },
  {
    id: 'finance-budget',
    app: 'finance',
    title: { en: 'Budget, revisions and forecasts', ms: 'Bajet, semakan semula dan ramalan' },
    purpose: {
      en: 'One budget per company per year, approved by the FD or CEO; actuals and forecasts after each close; variances over the limit explained.',
      ms: 'Satu bajet bagi setiap syarikat setiap tahun, diluluskan oleh FD atau CEO; angka sebenar dan ramalan selepas setiap tutup akaun; varians melebihi had diterangkan.',
    },
    start: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end › Budget', ms: 'Kewangan › Semakan › Cukai dan hujung bulan › Bajet' } },
    starter: { en: 'Team deputy, team leader, FD or CEO', ms: 'Timbalan pasukan, ketua pasukan, FD atau CEO' },
    steps: [
      {
        who: { en: 'Deputy or team leader', ms: 'Timbalan atau ketua pasukan' },
        does: { en: 'Drafts the budget by line with written assumptions and submits it for approval.', ms: 'Merangka bajet mengikut baris dengan andaian bertulis dan menghantarnya untuk kelulusan.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
      },
      {
        who: { en: 'FD or CEO (not an author)', ms: 'FD atau CEO (bukan penulis)' },
        does: { en: 'Approves the budget with a comment or returns it.', ms: 'Meluluskan bajet dengan komen atau memulangkannya.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
        decision: true,
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: { en: 'After each close saves the month’s actuals from the SQL Account P&L and explains each variance over the limit.', ms: 'Selepas setiap tutup akaun menyimpan angka sebenar dari P&L SQL Account dan menerangkan setiap varians melebihi had.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
      },
      {
        who: { en: 'Deputy or leader drafts; FD or CEO approves', ms: 'Timbalan atau ketua merangka; FD atau CEO meluluskan' },
        does: {
          en: 'A budget revision or a three-statement forecast is drafted with a reason and approved by the FD or the CEO (either is enough), never its author.',
          ms: 'Semakan semula bajet atau ramalan tiga penyata dirangka dengan sebab dan diluluskan oleh FD atau CEO (salah seorang memadai), bukan penulisnya.',
        },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'The approved budget is never changed; changes come as revisions.', ms: 'Bajet yang diluluskan tidak pernah diubah; perubahan dibuat sebagai semakan semula.' },
      { en: 'Variances above 5% are explained, with an owner and a due day; the FD or CEO accepts each explanation.', ms: 'Varians melebihi 5% diterangkan, dengan pemilik dan tarikh akhir; FD atau CEO menerima setiap penjelasan.' },
      { en: 'Next year’s budget is due by 10 December (an FD setting).', ms: 'Bajet tahun hadapan perlu siap menjelang 10 Disember (tetapan FD).' },
    ],
    status: 'in_force',
    statusNote: { en: 'Budget limit amounts are an open decision (Finance to give them).', ms: 'Amaun had bajet masih keputusan terbuka (Kewangan akan memberikannya).' },
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 1 to 3 Nov 2026' },
    words: 'budget bajet forecast ramalan revision semakan semula variance varians actuals angka sebenar plan',
  },
  {
    id: 'finance-regular-payments',
    app: 'finance',
    title: { en: 'Regular payments: instalments, bills, statutory and zakat', ms: 'Bayaran berkala: ansuran, bil, berkanun dan zakat' },
    purpose: {
      en: 'Hire purchase, loans, bills, rent, insurance premiums, EPF, PERKESO, HRD Corp, PCB, CP204, zakat, tax and levy: listed once, checked, then paid on each due date.',
      ms: 'Sewa beli, pinjaman, bil, sewa, premium insurans, KWSP, PERKESO, HRD Corp, PCB, CP204, zakat, cukai dan levi: disenaraikan sekali, disemak, kemudian dibayar pada setiap tarikh akhir.',
    },
    start: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › Regular payments', ms: 'Kewangan › Semakan › Bayaran keluar › Bayaran berkala' } },
    starter: { en: 'Finance team', ms: 'Pasukan Kewangan' },
    steps: [
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: { en: 'Adds the entry: verified payee, reference, account, how often, due day, and a fixed amount or "from each bill".', ms: 'Menambah entri: penerima disahkan, rujukan, akaun, kekerapan, hari akhir, dan amaun tetap atau "ikut setiap bil".' },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out', ms: 'Kewangan › Semakan › Bayaran keluar' } },
      },
      {
        who: { en: 'A second person', ms: 'Orang kedua' },
        does: { en: 'Checks the entry against the agreement or letter. Any change sends it back for checking.', ms: 'Menyemak entri dengan perjanjian atau surat. Sebarang perubahan menghantarnya semula untuk disemak.' },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › Check against agreement', ms: 'Kewangan › Semakan › Bayaran keluar › Semak dengan perjanjian' } },
        decision: true,
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Records each varying bill with its document, then prepares all due transfers for exactly the amount due.',
          ms: 'Merekod setiap bil yang berubah dengan dokumennya, kemudian menyediakan semua pindahan yang perlu dibayar untuk amaun yang tepat.',
        },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › Prepare all due', ms: 'Kewangan › Semakan › Bayaran keluar › Sediakan semua yang perlu' } },
      },
      {
        who: { en: 'FD or CEO', ms: 'FD atau CEO' },
        does: {
          en: 'After the review, approves the regular payments together with one comment (Prima still checks each one); release follows as for any payment.',
          ms: 'Selepas semakan, meluluskan bayaran berkala sekali gus dengan satu komen (Prima tetap menyemak setiap satu); pelepasan seperti bayaran biasa.',
        },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › Regular payments', ms: 'Kewangan › Semakan › Bayaran keluar › Bayaran berkala' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Statutory, zakat, tax and levy are always Finance payments, approved by the FD or the CEO.', ms: 'Berkanun, zakat, cukai dan levi sentiasa bayaran Kewangan, diluluskan oleh FD atau CEO.' },
      { en: 'A bill above 125% or below 50% of the last three needs an explanation; whoever recorded the bill does not prepare its payment.', ms: 'Bil melebihi 125% atau kurang 50% daripada tiga terakhir perlu penjelasan; sesiapa yang merekod bil tidak menyediakan bayarannya.' },
      { en: 'Direct debits are found on the bank statement; one not seen stays an exception at the close.', ms: 'Debit terus dicari dalam penyata bank; yang tidak ditemui kekal pengecualian semasa tutup akaun.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 2 Nov 2026' },
    words: 'regular payment bayaran berkala hire purchase sewa beli loan pinjaman bill bil epf kwsp perkeso socso pcb zakat levy levi direct debit',
  },
  {
    id: 'finance-guarantees',
    app: 'finance',
    title: { en: 'Bank guarantees (IG and BG) and their cash collateral', ms: 'Jaminan bank (IG dan BG) dan cagaran tunainya' },
    purpose: {
      en: 'Record each guarantee given to a client and claim the cash collateral back when it is released or expires.',
      ms: 'Rekod setiap jaminan yang diberi kepada klien dan tuntut semula cagaran tunai apabila ia dilepaskan atau tamat.',
    },
    start: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › IG and BG', ms: 'Kewangan › Semakan › Bayaran keluar › IG dan BG' } },
    starter: { en: 'Finance team', ms: 'Pasukan Kewangan' },
    steps: [
      {
        who: { en: 'Finance team, checked by a second person', ms: 'Pasukan Kewangan, disemak oleh orang kedua' },
        does: { en: 'Records the issuer, number, client, contract, amount, cash collateral, refund account and expiry.', ms: 'Merekod pengeluar, nombor, klien, kontrak, amaun, cagaran tunai, akaun bayaran balik dan tarikh tamat.' },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out', ms: 'Kewangan › Semakan › Bayaran keluar' } },
      },
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: {
          en: 'Records the client’s release letter (or the expiry); 14 days later Prima asks to claim the collateral back. The claim is recorded with its documents.',
          ms: 'Merekod surat pelepasan klien (atau tarikh tamat); 14 hari kemudian Prima meminta cagaran dituntut semula. Tuntutan direkod bersama dokumennya.',
        },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out › Claim sent', ms: 'Kewangan › Semakan › Bayaran keluar › Tuntutan dihantar' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Finds the refund on the bank statement and marks it refunded; the guarantee closes only then.', ms: 'Menemui bayaran balik dalam penyata bank dan menandanya dibayar balik; jaminan hanya ditutup selepas itu.' },
      },
    ],
    rules: [
      { en: 'Prima warns 60 days before expiry, and when no refund is seen 30 days after the claim.', ms: 'Prima memberi amaran 60 hari sebelum tamat, dan apabila tiada bayaran balik 30 hari selepas tuntutan.' },
      { en: 'Only the FD or CEO records a guarantee the client called.', ms: 'Hanya FD atau CEO merekod jaminan yang dituntut oleh klien.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FINANCE_PHASE2.md', decided: 'Fauzan, 2 Nov 2026' },
    words: 'bank guarantee jaminan bank ig bg collateral cagaran deposit refund bayaran balik performance bond',
  },
  {
    id: 'finance-sql-posting',
    app: 'finance',
    title: { en: 'Posting to SQL Account', ms: 'Pengeposan ke SQL Account' },
    purpose: {
      en: 'Prima posts each released payment (as a payment voucher) and each matched customer receipt into the company’s own SQL Account book through the vendor API.',
      ms: 'Prima mengepos setiap bayaran yang dilepaskan (sebagai baucar bayaran) dan setiap penerimaan pelanggan yang dipadankan ke buku SQL Account syarikat sendiri melalui API vendor.',
    },
    start: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end › SQL Account posting', ms: 'Kewangan › Semakan › Cukai dan hujung bulan › Pengeposan SQL Account' } },
    starter: { en: 'Prima, once a payment is released or a receipt matched', ms: 'Prima, apabila bayaran dilepaskan atau penerimaan dipadankan' },
    steps: [
      {
        who: { en: 'Finance team, checked by a second person', ms: 'Pasukan Kewangan, disemak oleh orang kedua' },
        does: { en: 'Enters each payee’s SQL Account code (customer code for receipts); a second person checks it.', ms: 'Memasukkan kod SQL Account setiap penerima (kod pelanggan untuk penerimaan); orang kedua menyemaknya.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Makes a job for each finished record; it waits, with the reason shown, until the codes and switches are in place.', ms: 'Membuat tugas bagi setiap rekod yang selesai; ia menunggu, dengan sebab dipaparkan, sehingga kod dan suis tersedia.' },
      },
      {
        who: { en: 'Finance team, checked by someone else', ms: 'Pasukan Kewangan, disemak oleh orang lain' },
        does: { en: 'Explains each exception from the daily check; unchecked exceptions hold the month-end close.', ms: 'Menerangkan setiap pengecualian dari semakan harian; pengecualian yang belum disemak menahan tutup akaun.' },
        where: { view: 'finance', tab: 'checks-tax', label: { en: 'Finance › Checks › Tax and month-end', ms: 'Kewangan › Semakan › Cukai dan hujung bulan' } },
      },
    ],
    rules: [
      { en: 'SQL Account stays the books; Prima never writes SQL Account’s tables and never changes an amount to make a post pass.', ms: 'SQL Account kekal sebagai buku akaun; Prima tidak pernah menulis jadual SQL Account dan tidak mengubah amaun untuk meluluskan pengeposan.' },
      { en: 'Each company switch is set by the FD or CEO with a reason, after its SQL Account set-up is confirmed.', ms: 'Suis setiap syarikat ditetapkan oleh FD atau CEO dengan sebab, selepas tetapan SQL Account disahkan.' },
      { en: 'Sales invoices stay raised in SQL Account; payroll is not posted by Prima.', ms: 'Invois jualan kekal dibuat dalam SQL Account; gaji tidak dipos oleh Prima.' },
    ],
    status: 'off',
    statusNote: {
      en: 'Built; not connected for any company. Posting is switched off until the CEO’s go-ahead (sandbox test, then one parallel month).',
      ms: 'Sudah dibina; belum disambungkan untuk mana-mana syarikat. Pengeposan dimatikan sehingga CEO memberi kebenaran (ujian sandbox, kemudian satu bulan selari).',
    },
    source: { doc: 'docs/SQL_ACCOUNT_POSTING.md', decided: 'Fauzan, 13 Nov 2026' },
    words: 'sql account posting pengeposan voucher baucar api book buku akaun sync',
  },
  {
    id: 'finance-daily-cash',
    app: 'finance',
    title: { en: 'Daily cash pay (closed)', ms: 'Bayaran tunai harian (ditutup)' },
    purpose: {
      en: 'The old route where Finance listed people paid daily in cash. Closed to new lists; its history and receipts can still be read.',
      ms: 'Laluan lama di mana Kewangan menyenaraikan orang yang dibayar tunai harian. Ditutup kepada senarai baharu; sejarah dan resitnya masih boleh dibaca.',
    },
    starter: { en: 'Nobody (closed)', ms: 'Tiada sesiapa (ditutup)' },
    steps: [
      {
        who: { en: 'Finance team', ms: 'Pasukan Kewangan' },
        does: { en: 'Reads the history of earlier lists under Legacy cash history.', ms: 'Membaca sejarah senarai terdahulu di bawah Sejarah tunai lama.' },
        where: { view: 'finance', tab: 'checks-out', label: { en: 'Finance › Checks › Paying out', ms: 'Kewangan › Semakan › Bayaran keluar' } },
      },
      {
        who: { en: 'OM, CEO, Director Office', ms: 'OM, CEO, Pejabat Pengarah' },
        does: {
          en: 'Extra cash support for a guard now goes as a specific OM request, a CEO-only approval and the Director Office’s controlled list; arrival cash for new foreign workers has its own flow.',
          ms: 'Bantuan tunai tambahan untuk pengawal kini melalui permohonan khusus OM, kelulusan CEO sahaja dan senarai terkawal Pejabat Pengarah; tunai ketibaan pekerja asing baharu ada alirannya sendiri.',
        },
        where: { view: 'arrivalcash', label: { en: 'Arrival cash', ms: 'Tunai ketibaan' } },
      },
    ],
    rules: [
      { en: 'No cash salary choice and no self-service cash request.', ms: 'Tiada pilihan gaji tunai dan tiada permohonan tunai layan diri.' },
      { en: 'A stored signature is never proof of payment; each handout needs a fresh signed acknowledgement.', ms: 'Tandatangan tersimpan bukan bukti bayaran; setiap pemberian perlu pengakuan bertandatangan yang baharu.' },
    ],
    status: 'off',
    statusNote: { en: 'Closed by the owner’s correction of 8 Nov 2026.', ms: 'Ditutup melalui pembetulan pemilik pada 8 Nov 2026.' },
    source: { doc: 'docs/CASH_BUFFER_REPORTING_BOUNDARY.md', decided: 'Fauzan, 8 Nov 2026' },
    words: 'daily cash tunai harian cash pay bayaran tunai coo ceo hand over serah',
  },
  {
    id: 'finance-credit-financing',
    app: 'finance',
    title: { en: 'PWVSB financing to a group company', ms: 'Pembiayaan PWVSB kepada syarikat kumpulan' },
    purpose: {
      en: 'PWVSB lends to, or pays on behalf of, a group company: record the financing, its stamping and SSM charge, and every repayment.',
      ms: 'PWVSB meminjamkan kepada, atau membayar bagi pihak, syarikat kumpulan: rekod pembiayaan, setem dan gadaian SSM, serta setiap bayaran balik.',
    },
    start: { view: 'credit', tab: 'loans', label: { en: 'PWVSB credit › Add financing', ms: 'Kredit PWVSB › Tambah pembiayaan' } },
    starter: { en: 'The credit officer (or the owner)', ms: 'Pegawai kredit (atau pemilik)' },
    steps: [
      {
        who: { en: 'Credit officer', ms: 'Pegawai kredit' },
        does: { en: 'Records the new financing: company, amount, rate, schedule and collateral.', ms: 'Merekod pembiayaan baharu: syarikat, amaun, kadar, jadual dan cagaran.' },
        where: { view: 'credit', tab: 'loans', label: { en: 'PWVSB credit › Loans and amounts paid on behalf', ms: 'Kredit PWVSB › Pinjaman dan bayaran bagi pihak' } },
      },
      {
        who: { en: 'Credit officer', ms: 'Pegawai kredit' },
        does: { en: 'Records the agreement stamped and the charge lodged with SSM, each within 30 days.', ms: 'Merekod perjanjian disetem dan gadaian diserah kepada SSM, masing-masing dalam 30 hari.' },
        where: { view: 'credit', tab: 'loans', label: { en: 'PWVSB credit › Loans', ms: 'Kredit PWVSB › Pinjaman' } },
      },
      {
        who: { en: 'Credit officer', ms: 'Pegawai kredit' },
        does: { en: 'Records each repayment with its bank reference.', ms: 'Merekod setiap bayaran balik dengan rujukan banknya.' },
        where: { view: 'credit', tab: 'loans', label: { en: 'PWVSB credit › Record repayment', ms: 'Kredit PWVSB › Rekod bayaran balik' } },
      },
      {
        who: { en: 'Deputy Chief of Staff', ms: 'Timbalan Ketua Staf' },
        does: { en: 'Records the KPKT licence check; staff never wait on it.', ms: 'Merekod semakan lesen KPKT; staf tidak perlu menunggunya.' },
        where: { view: 'credit', tab: 'loans', label: { en: 'PWVSB credit', ms: 'Kredit PWVSB' } },
      },
    ],
    rules: [
      { en: 'Interest at most 12% secured, 18% unsecured (Moneylenders Act; counsel to confirm).', ms: 'Faedah maksimum 12% bercagar, 18% tidak bercagar (Akta Pemberi Pinjam Wang; peguam untuk sahkan).' },
      { en: 'A beneficial-interest agreement is collateral only; ownership never changes by software.', ms: 'Perjanjian kepentingan benefisial hanya cagaran; pemilikan tidak pernah berubah melalui perisian.' },
      { en: 'A correction to collateral, stamping, charge or signing date needs a reason.', ms: 'Pembetulan cagaran, setem, gadaian atau tarikh tandatangan perlu sebab.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/finance.md', decided: 'V8, V10 masterplan' },
    words: 'pwvsb credit kredit loan pinjaman financing pembiayaan paid on behalf bayar bagi pihak stamping setem ssm charge gadaian kpkt',
  },
  {
    id: 'finance-credit-default',
    app: 'finance',
    title: { en: 'Missed instalment: investigation to default', ms: 'Ansuran terlepas: siasatan hingga ingkar' },
    purpose: {
      en: 'A missed instalment on PWVSB financing opens an investigation, never a default. A default needs the checks and the credit officer and FD (and legal on a template’s first default).',
      ms: 'Ansuran pembiayaan PWVSB yang terlepas membuka siasatan, bukan ingkar. Ingkar memerlukan semakan dan pegawai kredit serta FD (dan undang-undang bagi ingkar pertama sesuatu templat).',
    },
    start: { view: 'credit', tab: 'cases', label: { en: 'PWVSB credit › Run the daily check', ms: 'Kredit PWVSB › Jalankan semakan harian' } },
    starter: { en: 'Credit officer or Finance', ms: 'Pegawai kredit atau Kewangan' },
    steps: [
      {
        who: { en: 'Credit officer or Finance', ms: 'Pegawai kredit atau Kewangan' },
        does: { en: 'Runs the daily check; each missed instalment opens an investigation.', ms: 'Menjalankan semakan harian; setiap ansuran terlepas membuka siasatan.' },
        where: { view: 'credit', tab: 'cases', label: { en: 'PWVSB credit › Investigations and defaults', ms: 'Kredit PWVSB › Siasatan dan ingkar' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: {
          en: 'Records that the bank is reconciled. The other checks: no open dispute, no agreed deferral, cure period passed, still unpaid.',
          ms: 'Merekod bank telah disesuaikan. Semakan lain: tiada pertikaian terbuka, tiada penangguhan dipersetujui, tempoh pemulihan berlalu, masih belum dibayar.',
        },
        where: { view: 'credit', tab: 'cases', label: { en: 'PWVSB credit › Bank reconciled', ms: 'Kredit PWVSB › Bank disesuaikan' } },
      },
      {
        who: { en: 'Credit officer or Finance', ms: 'Pegawai kredit atau Kewangan' },
        does: { en: 'Clears it as not a default when the money is found or the checks fail, with a note.', ms: 'Menutupnya sebagai bukan ingkar apabila wang ditemui atau semakan gagal, dengan catatan.' },
        where: { view: 'credit', tab: 'cases', label: { en: 'PWVSB credit › Clear, not a default', ms: 'Kredit PWVSB › Clear, bukan ingkar' } },
        decision: true,
      },
      {
        who: { en: 'Credit officer, then the FD (and legal on a template’s first default)', ms: 'Pegawai kredit, kemudian FD (dan undang-undang bagi ingkar pertama templat)' },
        does: { en: 'Each confirms the default with a note; only then does the enforcement case open.', ms: 'Masing-masing mengesahkan ingkar dengan catatan; hanya selepas itu kes penguatkuasaan dibuka.' },
        where: { view: 'credit', tab: 'cases', label: { en: 'PWVSB credit › Confirm default', ms: 'Kredit PWVSB › Sahkan ingkar' } },
        decision: true,
      },
      {
        who: { en: 'Credit officer; legal or Finance may suspend', ms: 'Pegawai kredit; undang-undang atau Kewangan boleh menggantung' },
        does: { en: 'Records each enforcement step in order. Legal or Finance may suspend and resume enforcement.', ms: 'Merekod setiap langkah penguatkuasaan mengikut turutan. Undang-undang atau Kewangan boleh menggantung dan menyambung semula.' },
        where: { view: 'credit', tab: 'cases', label: { en: 'PWVSB credit › Enforcement', ms: 'Kredit PWVSB › Penguatkuasaan' } },
      },
    ],
    rules: [
      { en: 'Enforcement steps 7 to 9 stay off until counsel approves the agreement template.', ms: 'Langkah penguatkuasaan 7 hingga 9 kekal dimatikan sehingga peguam meluluskan templat perjanjian.' },
      { en: 'Ownership never changes by software; only the company secretary’s verified update changes it.', ms: 'Pemilikan tidak pernah berubah melalui perisian; hanya kemas kini setiausaha syarikat yang disahkan mengubahnya.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/03-business-rules.md', decided: 'V8, V10 masterplan' },
    words: 'missed instalment ansuran terlepas default ingkar investigation siasatan enforcement penguatkuasaan cure period',
  },
  {
    id: 'finance-branch-setup',
    app: 'finance',
    title: { en: 'Opening a new branch', ms: 'Membuka cawangan baharu' },
    purpose: {
      en: 'A branch is proposed, its papers, bank accounts and business case checked, a SQL Account project code set, and then activated by the company manager.',
      ms: 'Cawangan dicadangkan, kertas, akaun bank dan kes perniagaannya disemak, kod projek SQL Account ditetapkan, kemudian diaktifkan oleh Pengurus Syarikat.',
    },
    start: { view: 'branches', label: { en: 'Branches › Propose a new branch', ms: 'Cawangan › Cadang cawangan baharu' } },
    starter: { en: 'Company manager', ms: 'Pengurus Syarikat' },
    steps: [
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Proposes the branch (name, state, model A, B or C) and records the signed agreement version.', ms: 'Mencadangkan cawangan (nama, negeri, model A, B atau C) dan merekod versi perjanjian yang ditandatangani.' },
        where: { view: 'branches', label: { en: 'Branches', ms: 'Cawangan' } },
      },
      {
        who: { en: 'Company staff', ms: 'Staf syarikat' },
        does: {
          en: 'Record the KDN approval, premises licence and insurance references, add the bank accounts, and write the business case with a 13-week cash forecast.',
          ms: 'Merekod rujukan kelulusan KDN, lesen premis dan insurans, menambah akaun bank, dan menulis kes perniagaan dengan ramalan tunai 13 minggu.',
        },
        where: { view: 'branches', label: { en: 'Branches › the branch', ms: 'Cawangan › cawangan itu' } },
      },
      {
        who: { en: 'Finance (not whoever entered it)', ms: 'Kewangan (bukan sesiapa yang memasukkannya)' },
        does: { en: 'Verifies each bank account, reviews the business case with a comment, and sets the SQL Account project code.', ms: 'Mengesahkan setiap akaun bank, menyemak kes perniagaan dengan komen, dan menetapkan kod projek SQL Account.' },
        where: { view: 'branches', label: { en: 'Branches › the branch', ms: 'Cawangan › cawangan itu' } },
        decision: true,
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Confirms the company is the legal employer and activates the branch with a comment.', ms: 'Mengesahkan syarikat ialah majikan sah dan mengaktifkan cawangan dengan komen.' },
        where: { view: 'branches', label: { en: 'Branches › Activate branch', ms: 'Cawangan › Aktifkan cawangan' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Activation is refused while anything is missing: signed agreement, the three references, project code, employer confirmation, a verified bank account and a reviewed business case.',
        ms: 'Pengaktifan ditolak selagi ada yang kurang: perjanjian ditandatangani, tiga rujukan, kod projek, pengesahan majikan, akaun bank disahkan dan kes perniagaan disemak.',
      },
      { en: 'Whoever added an account never verifies it. The branch contracts only through its licensed company.', ms: 'Sesiapa yang menambah akaun tidak sekali-kali mengesahkannya. Cawangan berkontrak hanya melalui syarikat berlesennya.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/BRANCHES_LEDGER.md', decided: 'Fauzan, 3 to 5 Nov 2026' },
    words: 'branch cawangan new branch formation open buka activate aktif kdn project code kod projek business case',
  },
  {
    id: 'finance-branch-month',
    app: 'finance',
    title: { en: 'Branch month and settlement', ms: 'Bulan cawangan dan penyelesaian' },
    purpose: {
      en: 'Each finished month a branch’s ledger is prepared from SQL Account lines, approved by the company manager, agreed to SQL by Finance and paid (or closed) by another Finance person.',
      ms: 'Setiap bulan yang selesai, lejar cawangan disediakan daripada baris SQL Account, diluluskan Pengurus Syarikat, dipadankan dengan SQL oleh Kewangan dan dibayar (atau ditutup) oleh orang Kewangan yang lain.',
    },
    start: { view: 'branches', label: { en: 'Branches › Prepare a month', ms: 'Cawangan › Sediakan bulan' } },
    starter: { en: 'Company staff, the Branch Manager or Finance', ms: 'Staf syarikat, Pengurus Cawangan atau Kewangan' },
    steps: [
      {
        who: { en: 'Company staff, Branch Manager or Finance', ms: 'Staf syarikat, Pengurus Cawangan atau Kewangan' },
        does: {
          en: 'Prepares the month: each line cites its SQL Account document or payroll reference; billing names a site of this branch with a signed contract.',
          ms: 'Menyediakan bulan: setiap baris memetik dokumen SQL Account atau rujukan gaji; bil menamakan tapak cawangan ini yang ada kontrak ditandatangani.',
        },
        where: { view: 'branches', label: { en: 'Branches › the branch', ms: 'Cawangan › cawangan itu' } },
      },
      {
        who: { en: 'Company manager (not the preparer)', ms: 'Pengurus Syarikat (bukan penyedia)' },
        does: { en: 'Approves the settlement under the signed model with a comment, or returns it with a reason.', ms: 'Meluluskan penyelesaian mengikut model yang ditandatangani dengan komen, atau memulangkan dengan sebab.' },
        where: { view: 'branches', label: { en: 'Branches › Approve settlement', ms: 'Cawangan › Luluskan penyelesaian' } },
        decision: true,
      },
      {
        who: { en: 'Finance (not the preparer or approver)', ms: 'Kewangan (bukan penyedia atau pelulus)' },
        does: { en: 'Agrees the month to the SQL Account project ledger.', ms: 'Memadankan bulan itu dengan lejar projek SQL Account.' },
        where: { view: 'branches', label: { en: 'Branches › Agreed to SQL Account', ms: 'Cawangan › Dipadankan dengan SQL Account' } },
        decision: true,
      },
      {
        who: { en: 'A different Finance person (Model B: the FD decides the payout)', ms: 'Orang Kewangan yang lain (Model B: FD menentukan bayaran)' },
        does: { en: 'Records the payment with the bank reference, or closes the month with nothing paid out.', ms: 'Merekod bayaran dengan rujukan bank, atau menutup bulan tanpa bayaran.' },
        where: { view: 'branches', label: { en: 'Branches › Record payment', ms: 'Cawangan › Rekod bayaran' } },
      },
    ],
    rules: [
      { en: 'A settlement is held while the branch bank is unreconciled, wages or EPF are unpaid, or the licence has an issue.', ms: 'Penyelesaian ditahan selagi bank cawangan belum disesuaikan, gaji atau KWSP belum dibayar, atau lesen bermasalah.' },
      { en: 'A partner is paid only into its own verified business account.', ms: 'Rakan kongsi hanya dibayar ke akaun perniagaannya sendiri yang disahkan.' },
      {
        en: 'Model B purchases and expenses: request with a quotation, company manager consents, FD or CEO approves (the FD may set another style).',
        ms: 'Pembelian dan perbelanjaan Model B: permohonan dengan sebut harga, Pengurus Syarikat bersetuju, FD atau CEO meluluskan (FD boleh menetapkan gaya lain).',
      },
      { en: 'Branch actions not reviewed in 3 days go to the company manager’s home; after 7 days to PWVSB.', ms: 'Tindakan cawangan yang tidak disemak dalam 3 hari dihantar ke laman utama Pengurus Syarikat; selepas 7 hari ke PWVSB.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/BRANCHES_LEDGER.md', decided: 'Fauzan, 3 to 5 Nov 2026' },
    words: 'branch cawangan settlement penyelesaian month bulan ledger lejar model a b c jv management fee yuran pengurusan payout',
  },
  {
    id: 'finance-insurance-claim',
    app: 'finance',
    title: { en: 'Insurance claim', ms: 'Tuntutan insurans' },
    purpose: {
      en: 'A claim moves step by step from telling the insurer to the money received; it is settled only when the money is on the bank statement.',
      ms: 'Tuntutan bergerak langkah demi langkah dari memaklumkan penanggung insurans hingga wang diterima; ia selesai hanya apabila wang ada dalam penyata bank.',
    },
    start: { view: 'insurance', tab: 'claims', label: { en: 'Insurance › Record claim', ms: 'Insurans › Rekod tuntutan' } },
    starter: { en: 'Company desk (manager or admin executive) or the Chief of Staff', ms: 'Meja syarikat (pengurus atau eksekutif admin) atau Ketua Staf' },
    steps: [
      {
        who: { en: 'Company desk or Chief of Staff', ms: 'Meja syarikat atau Ketua Staf' },
        does: { en: 'Records the claim (policy, what happened, incident date, amount), then records the insurer told with its reference.', ms: 'Merekod tuntutan (polisi, apa berlaku, tarikh kejadian, amaun), kemudian merekod penanggung insurans telah dimaklumkan dengan rujukannya.' },
        where: { view: 'insurance', tab: 'claims', label: { en: 'Insurance › Claims', ms: 'Insurans › Tuntutan' } },
      },
      {
        who: { en: 'Company desk or Chief of Staff', ms: 'Meja syarikat atau Ketua Staf' },
        does: { en: 'Adds each document, sends it for assessment, then records the insurer’s offer (or rejection).', ms: 'Menambah setiap dokumen, menghantar untuk penilaian, kemudian merekod tawaran penanggung insurans (atau penolakan).' },
        where: { view: 'insurance', tab: 'claims', label: { en: 'Insurance › Claims', ms: 'Insurans › Tuntutan' } },
      },
      {
        who: { en: 'Company manager (not who recorded the offer)', ms: 'Pengurus Syarikat (bukan yang merekod tawaran)' },
        does: { en: 'Accepts the offer with a comment; an offer below the amount claimed needs the reason. May appeal a rejection once.', ms: 'Menerima tawaran dengan komen; tawaran kurang daripada amaun tuntutan perlu sebab. Boleh merayu penolakan sekali.' },
        where: { view: 'insurance', tab: 'claims', label: { en: 'Insurance › Claims', ms: 'Insurans › Tuntutan' } },
        decision: true,
      },
      {
        who: { en: 'Company Finance team or FD (not who accepted)', ms: 'Pasukan Kewangan syarikat atau FD (bukan yang menerima)' },
        does: { en: 'Records the money received with the bank statement reference and date. Only then is the claim settled.', ms: 'Merekod wang diterima dengan rujukan penyata bank dan tarikh. Hanya selepas itu tuntutan selesai.' },
        where: { view: 'insurance', tab: 'claims', label: { en: 'Insurance › Claims', ms: 'Insurans › Tuntutan' } },
      },
    ],
    rules: [
      { en: 'After the insurer is told, the claim can no longer be edited; it moves only by these steps.', ms: 'Selepas penanggung insurans dimaklumkan, tuntutan tidak boleh disunting lagi; ia bergerak hanya melalui langkah ini.' },
      { en: 'An offer cannot be above the sum insured.', ms: 'Tawaran tidak boleh melebihi jumlah diinsuranskan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/INSURANCE_CLAIMS.md', decided: 'Fauzan, 3 Nov 2026' },
    words: 'insurance insurans claim tuntutan insurer penanggung offer tawaran settle selesai appeal rayuan',
  },

  // ---------------------------------------------------------------- Clients and sales
  {
    id: 'sales-lead',
    app: 'sales',
    title: { en: 'A new lead: research to won', ms: 'Prospek baharu: kajian hingga menang' },
    purpose: {
      en: 'Research a prospect and survey the site before pricing; a lead is won only with an accepted quotation.',
      ms: 'Kaji prospek dan tinjau tapak sebelum memberi harga; prospek hanya menang dengan sebut harga yang diterima.',
    },
    start: { view: 'commercial', tab: 'leads', label: { en: 'Tenders and quotations › Leads › New lead', ms: 'Tender dan sebut harga › Prospek › Prospek baharu' } },
    starter: { en: 'Company admin executive, company manager or Branch Manager', ms: 'Eksekutif admin syarikat, Pengurus Syarikat atau Pengurus Cawangan' },
    steps: [
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: { en: 'Adds the lead, then saves the research: SSM search (company is live), payment record, current provider and risks.', ms: 'Menambah prospek, kemudian menyimpan kajian: carian SSM (syarikat aktif), rekod bayaran, penyedia semasa dan risiko.' },
        where: { view: 'commercial', tab: 'leads', label: { en: 'Tenders and quotations › Leads', ms: 'Tender dan sebut harga › Prospek' } },
      },
      {
        who: { en: 'Admin executive or OM', ms: 'Eksekutif admin atau OM' },
        does: { en: 'Surveys the site and saves the survey.', ms: 'Meninjau tapak dan menyimpan tinjauan.' },
        where: { view: 'commercial', tab: 'leads', label: { en: 'Tenders and quotations › Leads', ms: 'Tender dan sebut harga › Prospek' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'For a slow or unknown payer, accepts the risk with a reason (deposit, terms).', ms: 'Bagi pembayar lambat atau tidak diketahui, menerima risiko dengan sebab (deposit, terma).' },
        where: { view: 'commercial', tab: 'leads', label: { en: 'Tenders and quotations › Leads › Accept', ms: 'Tender dan sebut harga › Prospek › Terima' } },
        decision: true,
      },
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: { en: 'Links the quotation, then marks the lead won, lost to another, or dropped.', ms: 'Memautkan sebut harga, kemudian menanda prospek menang, kalah kepada pihak lain, atau digugurkan.' },
        where: { view: 'commercial', tab: 'leads', label: { en: 'Tenders and quotations › Leads', ms: 'Tender dan sebut harga › Prospek' } },
      },
    ],
    rules: [
      { en: 'A lead another group company is chasing shows as a conflict.', ms: 'Prospek yang sedang dikejar syarikat kumpulan lain ditunjukkan sebagai konflik.' },
      { en: 'A lead with no next step for 14 days is flagged.', ms: 'Prospek tanpa langkah seterusnya selama 14 hari ditanda.' },
      { en: 'A branch may find a lead; the licensed company still contracts.', ms: 'Cawangan boleh menemui prospek; syarikat berlesen tetap yang berkontrak.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W5' },
    words: 'lead prospek prospect client research kajian ssm survey tinjauan won menang sales jualan',
  },
  {
    id: 'sales-quotation',
    app: 'sales',
    title: { en: 'Quotation', ms: 'Sebut harga' },
    purpose: {
      en: 'The admin team prepares a quotation; the company manager approves it before it goes to the client.',
      ms: 'Pasukan admin menyediakan sebut harga; Pengurus Syarikat meluluskannya sebelum dihantar kepada klien.',
    },
    start: { view: 'commercial', tab: 'quotes', label: { en: 'Tenders and quotations › New quotation', ms: 'Tender dan sebut harga › Sebut harga baharu' } },
    starter: { en: 'Company admin executive', ms: 'Eksekutif admin syarikat' },
    steps: [
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: { en: 'Prepares the quotation (client, site, guards, hours, rate, validity) and saves the draft.', ms: 'Menyediakan sebut harga (klien, tapak, pengawal, jam, kadar, tempoh sah) dan menyimpan draf.' },
        where: { view: 'commercial', tab: 'quotes', label: { en: 'Tenders and quotations › Quotations', ms: 'Tender dan sebut harga › Sebut harga' } },
      },
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: { en: 'Sends it to the manager for approval.', ms: 'Menghantarnya kepada pengurus untuk kelulusan.' },
        where: { view: 'commercial', tab: 'quotes', label: { en: 'Send to manager for approval', ms: 'Hantar kepada pengurus untuk kelulusan' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Approves within written authority, or returns it for changes.', ms: 'Meluluskan dalam had kuasa bertulis, atau memulangkan untuk perubahan.' },
        where: { view: 'commercial', tab: 'quotes', label: { en: 'Tenders and quotations › Quotations', ms: 'Tender dan sebut harga › Sebut harga' } },
        decision: true,
      },
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: { en: 'Marks it sent to the client, then client accepted or client rejected.', ms: 'Menanda dihantar kepada klien, kemudian klien terima atau klien tolak.' },
        where: { view: 'commercial', tab: 'quotes', label: { en: 'Tenders and quotations › Quotations', ms: 'Tender dan sebut harga › Sebut harga' } },
      },
    ],
    rules: [
      { en: 'The preparer never approves their own quotation.', ms: 'Penyedia tidak sekali-kali meluluskan sebut harga sendiri.' },
      { en: 'Guards, rate or date are corrected with a reason; every change is audited.', ms: 'Pengawal, kadar atau tarikh dibetulkan dengan sebab; setiap perubahan diaudit.' },
      { en: 'No automatic pricing until costing rules are approved; prices are typed by the admin team.', ms: 'Tiada harga automatik sehingga peraturan kos diluluskan; harga ditaip oleh pasukan admin.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W9' },
    words: 'quotation sebut harga quote harga price client klien approve lulus company manager',
  },
  {
    id: 'sales-tender',
    app: 'sales',
    title: { en: 'A tender from notice to submission', ms: 'Tender dari notis hingga penghantaran' },
    purpose: {
      en: 'Bid in the licensed company’s own name: papers, checklist, decision, protocol steps, bid files, two signatures and the submission slip.',
      ms: 'Bida atas nama syarikat berlesen sendiri: kertas, senarai semak, keputusan, langkah protokol, fail bida, dua tandatangan dan slip penghantaran.',
    },
    start: { view: 'commercial', tab: 'tenders', label: { en: 'Tenders and quotations › Add tender', ms: 'Tender dan sebut harga › Tambah tender' } },
    starter: { en: 'Company admin executive or the Director Office', ms: 'Eksekutif admin syarikat atau Pejabat Pengarah' },
    steps: [
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: { en: 'Adds the tender and uploads the papers (notice, arahan petender, specification, forms).', ms: 'Menambah tender dan memuat naik kertas (notis, arahan petender, spesifikasi, borang).' },
        where: { view: 'commercial', tab: 'tenders', label: { en: 'Tenders and quotations › Tender pipeline', ms: 'Tender dan sebut harga › Saluran tender' } },
      },
      {
        who: { en: 'Director Office Administrator', ms: 'Pentadbir Pejabat Pengarah' },
        does: { en: 'Checks and confirms the checklist Prima drafted from the papers.', ms: 'Menyemak dan mengesahkan senarai semak yang dirangka Prima daripada kertas.' },
        where: { view: 'commercial', tab: 'tenders', label: { en: 'Tender › Confirm checklist', ms: 'Tender › Sahkan senarai semak' } },
        decision: true,
      },
      {
        who: { en: 'Company manager or Director Office', ms: 'Pengurus Syarikat atau Pejabat Pengarah' },
        does: { en: 'Decides Teruskan, Tangguh or Tidak bida, with the reason. Questions go to the buyer in writing.', ms: 'Memutuskan Teruskan, Tangguh atau Tidak bida, dengan sebab. Soalan dihantar kepada pembeli secara bertulis.' },
        where: { view: 'commercial', tab: 'tenders', label: { en: 'Tender › Decision', ms: 'Tender › Keputusan' } },
        decision: true,
      },
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: {
          en: 'Ticks each protocol step with who and when, and uploads the bid files named as the tender asks. The technical part must carry no company name.',
          ms: 'Menanda setiap langkah protokol dengan siapa dan bila, dan memuat naik fail bida dinamakan seperti yang diminta tender. Bahagian teknikal tidak boleh ada nama syarikat.',
        },
        where: { view: 'commercial', tab: 'tenders', label: { en: 'Tender › Protocol and bid files', ms: 'Tender › Protokol dan fail bida' } },
      },
      {
        who: { en: 'Preparer, then company manager', ms: 'Penyedia, kemudian Pengurus Syarikat' },
        does: { en: 'The preparer signs, the company manager signs that all is verified, then the submission slip is recorded. Outcome: won, lost or no bid.', ms: 'Penyedia menandatangani, Pengurus Syarikat menandatangani bahawa semua disahkan, kemudian slip penghantaran direkod. Keputusan: menang, kalah atau tiada bida.' },
        where: { view: 'commercial', tab: 'tenders', label: { en: 'Tender › Record submission', ms: 'Tender › Rekod penghantaran' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A company bids only with a valid KDN licence and insurance, and MOF registration for government tenders.', ms: 'Syarikat hanya membida dengan lesen KDN dan insurans yang sah, dan pendaftaran MOF bagi tender kerajaan.' },
      { en: 'A tender cannot move on with a protocol step not done.', ms: 'Tender tidak boleh diteruskan dengan langkah protokol yang belum siap.' },
      { en: 'The price check is a guide only: not a wage and not an approved bid.', ms: 'Semakan harga hanya panduan: bukan gaji dan bukan bida yang diluluskan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W7' },
    words: 'tender bid bida eperolehan myprocurement protocol protokol submission penghantaran kdn mof checklist senarai semak',
  },
  {
    id: 'sales-joint-tender',
    app: 'sales',
    title: { en: 'Joint tender (several group companies)', ms: 'Tender bersama (beberapa syarikat kumpulan)' },
    purpose: {
      en: 'The Director Office chooses which companies enter the same tender; each fills its own bid; the CEO gets the report after closing.',
      ms: 'Pejabat Pengarah memilih syarikat yang memasuki tender yang sama; setiap satu mengisi bidanya sendiri; CEO menerima laporan selepas tutup.',
    },
    start: { view: 'commercial', tab: 'joint', label: { en: 'Tenders and quotations › Joint tenders', ms: 'Tender dan sebut harga › Tender bersama' } },
    starter: { en: 'Director Office', ms: 'Pejabat Pengarah' },
    steps: [
      {
        who: { en: 'Director Office', ms: 'Pejabat Pengarah' },
        does: { en: 'Records the tender found, chooses the companies and sends them the checked checklist.', ms: 'Merekod tender yang ditemui, memilih syarikat dan menghantar senarai semak yang disemak.' },
        where: { view: 'commercial', tab: 'found', label: { en: 'Tenders and quotations › Tenders and quotations found', ms: 'Tender dan sebut harga › Tender dan sebut harga ditemui' } },
      },
      {
        who: { en: 'Each company’s admin executive', ms: 'Eksekutif admin setiap syarikat' },
        does: { en: 'Fills its own bid.', ms: 'Mengisi bidanya sendiri.' },
        where: { view: 'commercial', tab: 'joint', label: { en: 'Tenders and quotations › Joint tenders', ms: 'Tender dan sebut harga › Tender bersama' } },
      },
      {
        who: { en: 'Each company manager', ms: 'Setiap Pengurus Syarikat' },
        does: { en: 'Verifies the bid with the submission slip.', ms: 'Mengesahkan bida dengan slip penghantaran.' },
        where: { view: 'commercial', tab: 'joint', label: { en: 'Tenders and quotations › Joint tenders', ms: 'Tender dan sebut harga › Tender bersama' } },
        decision: true,
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: '24 hours after closing, the CEO’s home shows how many entered, filled the guide and slipped.', ms: '24 jam selepas tutup, laman utama CEO menunjukkan berapa yang masuk, mengisi panduan dan menghantar slip.' },
      },
    ],
    rules: [
      { en: 'A company may tell the Director Office about a tender it found; that only informs, no approval is needed.', ms: 'Syarikat boleh memaklumkan Pejabat Pengarah tentang tender yang ditemuinya; itu hanya makluman, tiada kelulusan diperlukan.' },
      { en: 'Only a tender whose checklist is checked is sent to companies.', ms: 'Hanya tender yang senarai semaknya sudah disemak dihantar kepada syarikat.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W8' },
    words: 'joint tender tender bersama director office pejabat pengarah peluang opportunity group companies',
  },
  {
    id: 'sales-client-due-diligence',
    app: 'sales',
    title: { en: 'Client due diligence', ms: 'Usaha wajar klien (due diligence)' },
    purpose: {
      en: 'Before taking a client on, the company office checks seven things and the company manager decides. Repeated every 12 months.',
      ms: 'Sebelum menerima klien, pejabat syarikat menyemak tujuh perkara dan Pengurus Syarikat memutuskan. Diulang setiap 12 bulan.',
    },
    start: { view: 'clients', tab: 'board', label: { en: 'Clients › the client › Open the client file', ms: 'Klien › klien itu › Buka fail klien' } },
    starter: { en: 'Company admin executive', ms: 'Eksekutif admin syarikat' },
    steps: [
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: {
          en: 'Works the seven checks with a reference each: who the client is (SSM or agency), signer’s authority, lawful purpose, can pay, no conflict, site risk, client data and CCTV handled.',
          ms: 'Menjalankan tujuh semakan dengan rujukan masing-masing: siapa klien (SSM atau agensi), kuasa penandatangan, tujuan sah, mampu bayar, tiada konflik, risiko tapak, data klien dan CCTV yang dikendalikan.',
        },
        where: { view: 'clients', tab: 'board', label: { en: 'Clients › client file › Client due diligence', ms: 'Klien › fail klien › Usaha wajar klien' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Decides with a reason: accepted, accepted with conditions (needed when there is a concern), or declined.', ms: 'Memutuskan dengan sebab: diterima, diterima bersyarat (perlu jika ada kebimbangan), atau ditolak.' },
        where: { view: 'clients', tab: 'board', label: { en: 'Clients › client file › Record decision', ms: 'Klien › fail klien › Rekod keputusan' } },
        decision: true,
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'The contract’s mobilisation checklist will not pass until diligence is accepted and not overdue.', ms: 'Senarai semak mobilisasi kontrak tidak akan lulus sehingga usaha wajar diterima dan tidak tertunggak.' },
      },
    ],
    rules: [
      { en: 'A concern, or a check marked not needed, needs a reason.', ms: 'Kebimbangan, atau semakan yang ditanda tidak perlu, memerlukan sebab.' },
      { en: 'Reviewed again 12 months after the decision or when the contract ends, whichever comes first; earlier rounds are kept.', ms: 'Disemak semula 12 bulan selepas keputusan atau apabila kontrak tamat, yang mana lebih awal; pusingan terdahulu disimpan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/CLIENT_DUE_DILIGENCE_AND_INSTRUCTIONS.md', decided: 'Fauzan, 5 Nov 2026' },
    words: 'due diligence usaha wajar client klien kyc ssm iso 9001 pikm check semakan',
  },
  {
    id: 'sales-contract-golive',
    app: 'sales',
    title: { en: 'Signed contract to site go-live', ms: 'Kontrak ditandatangani hingga tapak beroperasi' },
    purpose: {
      en: 'Record the signed contract, work the mobilisation items with proof, sign the Ready-to-Operate Certificate, go live, then review at day 1, 7, 14 and 30.',
      ms: 'Rekod kontrak yang ditandatangani, jalankan item mobilisasi dengan bukti, tandatangan Sijil Sedia Beroperasi, mula beroperasi, kemudian semak pada hari 1, 7, 14 dan 30.',
    },
    start: { view: 'contracts', label: { en: 'Contracts › New contract', ms: 'Kontrak › Kontrak baharu' } },
    starter: { en: 'Company manager', ms: 'Pengurus Syarikat' },
    steps: [
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: {
          en: 'Records the signed contract or letter of award with its copy, posts and rates, terms and bond. Prima can read the attached copy and propose values; nothing is filled until the manager presses Use.',
          ms: 'Merekod kontrak atau surat setuju terima yang ditandatangani dengan salinannya, pos dan kadar, terma dan bon. Prima boleh membaca salinan yang dilampirkan dan mencadangkan nilai; tiada yang diisi sehingga pengurus menekan Use.',
        },
        where: { view: 'contracts', label: { en: 'Contracts › New contract', ms: 'Kontrak › Kontrak baharu' } },
      },
      {
        who: { en: 'Company office, Operations (OM and up), HR, Finance, Arms Control', ms: 'Pejabat syarikat, Operasi (OM ke atas), HR, Kewangan, Kawalan Senjata' },
        does: {
          en: 'Work each mobilisation item with proof (photo or document), including the assignment instructions for every post, signed by the client.',
          ms: 'Menjalankan setiap item mobilisasi dengan bukti (gambar atau dokumen), termasuk arahan tugasan bagi setiap pos, ditandatangani klien.',
        },
        where: { view: 'contracts', label: { en: 'Contracts › the contract', ms: 'Kontrak › kontrak itu' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: {
          en: 'Accepts the risk on a non-critical item for up to 30 days if needed, signs the Ready-to-Operate Certificate once every critical item is done, then Go live.',
          ms: 'Menerima risiko bagi item tidak kritikal sehingga 30 hari jika perlu, menandatangani Sijil Sedia Beroperasi apabila setiap item kritikal siap, kemudian Go live.',
        },
        where: { view: 'contracts', label: { en: 'Contracts › Sign Ready-to-Operate', ms: 'Kontrak › Tandatangan Sedia Beroperasi' } },
        decision: true,
      },
      {
        who: { en: 'Company manager and company office', ms: 'Pengurus Syarikat dan pejabat syarikat' },
        does: { en: 'Record the reviews at day 1, 7, 14 and 30; day 30 checks the first invoice against the contract.', ms: 'Merekod semakan pada hari 1, 7, 14 dan 30; hari 30 menyemak invois pertama dengan kontrak.' },
        where: { view: 'contracts', label: { en: 'Contracts › Record review', ms: 'Kontrak › Rekod semakan' } },
      },
    ],
    rules: [
      { en: 'Billing changes only through a recorded variation; a new site or more guards opens its own round and its own Ready-to-Operate.', ms: 'Bil berubah hanya melalui variasi yang direkod; tapak baharu atau tambahan pengawal membuka pusingan dan Sedia Beroperasi tersendiri.' },
      { en: 'Prima re-checks the roster, guard clearance and client due diligence when Ready-to-Operate is signed.', ms: 'Prima menyemak semula roster, kelulusan pengawal dan usaha wajar klien apabila Sedia Beroperasi ditandatangani.' },
      { en: 'Guards do not see the assignment instructions in Prima; officers brief them on site.', ms: 'Pengawal tidak melihat arahan tugasan dalam Prima; pegawai memberi taklimat di tapak.' },
    ],
    status: 'in_force',
    statusNote: { en: 'Item wording, due days and default terms are proposals until Operations confirms.', ms: 'Perkataan item, hari akhir dan terma lalai masih cadangan sehingga Operasi mengesahkan.' },
    source: { doc: 'docs/CONTRACTS_REAL_USE.md', decided: 'Fauzan, 5 Nov 2026' },
    words: 'contract kontrak mobilisation mobilisasi ready-to-operate sedia beroperasi go live site tapak variation variasi renewal pembaharuan loa',
  },
  {
    id: 'sales-client-care',
    app: 'sales',
    title: { en: 'Looking after a client', ms: 'Menjaga klien' },
    purpose: {
      en: 'Visits, monthly reports, satisfaction, complaints and invoices sent, logged on the client so the company and the COO see how each client is doing.',
      ms: 'Lawatan, laporan bulanan, kepuasan, aduan dan invois dihantar, dilog pada klien supaya syarikat dan COO melihat keadaan setiap klien.',
    },
    start: { view: 'clients', tab: 'board', label: { en: 'Clients › Client board', ms: 'Klien › Papan klien' } },
    starter: { en: 'OM, Operations Director or officers', ms: 'OM, Pengarah Operasi atau pegawai' },
    steps: [
      {
        who: { en: 'OM or officer', ms: 'OM atau pegawai' },
        does: { en: 'Logs each visit, meeting or call, the monthly report sent, and the client’s satisfaction rating.', ms: 'Mencatat setiap lawatan, mesyuarat atau panggilan, laporan bulanan yang dihantar, dan penilaian kepuasan klien.' },
        where: { view: 'clients', tab: 'board', label: { en: 'Clients › Client board', ms: 'Klien › Papan klien' } },
      },
      {
        who: { en: 'OM or officer', ms: 'OM atau pegawai' },
        does: { en: 'Logs a complaint and closes it with what was done.', ms: 'Mencatat aduan dan menutupnya dengan tindakan yang diambil.' },
        where: { view: 'clients', tab: 'open', label: { en: 'Clients › Requests and complaints', ms: 'Klien › Permintaan dan aduan' } },
      },
      {
        who: { en: 'Company office', ms: 'Pejabat syarikat' },
        does: { en: 'Records each invoice sent to the client with proof.', ms: 'Merekod setiap invois yang dihantar kepada klien dengan bukti.' },
        where: { view: 'clients', tab: 'board', label: { en: 'Clients › Client board', ms: 'Klien › Papan klien' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Decides each renewal and sends the renewal offer.', ms: 'Memutuskan setiap pembaharuan dan menghantar tawaran pembaharuan.' },
        where: { view: 'clients', tab: 'renewals', label: { en: 'Clients › Renewals', ms: 'Klien › Pembaharuan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Unknown is never shown as fine: a client with no record shows Unknown.', ms: 'Tidak diketahui tidak pernah dipapar sebagai baik: klien tanpa rekod dipapar Tidak diketahui.' },
      { en: 'The COO monitors every company and holds a monthly operations meeting with each.', ms: 'COO memantau setiap syarikat dan mengadakan mesyuarat operasi bulanan dengan setiap satu.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W5' },
    words: 'client klien visit lawatan monthly report laporan bulanan satisfaction kepuasan complaint aduan invoice invois renewal pembaharuan crm',
  },
  {
    id: 'sales-client-report-link',
    app: 'sales',
    title: { en: 'Client report link', ms: 'Pautan laporan klien' },
    purpose: {
      en: 'The company manager makes a time-limited, read-only link for one client showing its sites, incidents, complaints and invoices sent.',
      ms: 'Pengurus Syarikat membuat pautan baca sahaja bertempoh untuk seorang klien yang menunjukkan tapak, insiden, aduan dan invois dihantar.',
    },
    start: { view: 'clients', tab: 'board', label: { en: 'Clients › the client › Client report links', ms: 'Klien › klien itu › Pautan laporan klien' } },
    starter: { en: 'Company manager', ms: 'Pengurus Syarikat' },
    steps: [
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Makes the link for a period of up to 92 days, open 1 to 30 days, naming who at the client receives it, and previews it.', ms: 'Membuat pautan bagi tempoh sehingga 92 hari, terbuka 1 hingga 30 hari, menamakan penerima di pihak klien, dan pratonton.' },
        where: { view: 'clients', tab: 'board', label: { en: 'Clients › Client report links', ms: 'Klien › Pautan laporan klien' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Sends the link from their own email. Prima does not send email.', ms: 'Menghantar pautan dari e-mel sendiri. Prima tidak menghantar e-mel.' },
        outside: true,
      },
      {
        who: { en: 'Company manager or admin executive', ms: 'Pengurus Syarikat atau eksekutif admin' },
        does: { en: 'Revokes a link with a reason; it stops working at once.', ms: 'Membatalkan pautan dengan sebab; ia berhenti berfungsi serta-merta.' },
        where: { view: 'clients', tab: 'board', label: { en: 'Clients › Client report links', ms: 'Klien › Pautan laporan klien' } },
      },
    ],
    rules: [
      { en: 'The page never shows staff or guard names, case descriptions, overdue amounts or payment status.', ms: 'Halaman tidak pernah menunjukkan nama staf atau pengawal, butiran kes, amaun tertunggak atau status bayaran.' },
      { en: 'At most 5 open links per client. Every view is audited.', ms: 'Maksimum 5 pautan terbuka bagi setiap klien. Setiap paparan diaudit.' },
    ],
    status: 'off',
    statusNote: {
      en: 'Built. Links for real clients need Fauzan’s approval and the link settings; until then they cannot be made.',
      ms: 'Sudah dibina. Pautan untuk klien sebenar memerlukan kelulusan Fauzan dan tetapan pautan; sehingga itu ia tidak boleh dibuat.',
    },
    source: { doc: 'docs/CLIENT_SHARE_LINKS.md', decided: 'Fauzan, 3 Nov 2026' },
    words: 'client portal portal klien share link pautan kongsi report laporan read-only',
  },

  // ---------------------------------------------------------------- Foreign workers
  {
    id: 'fw-paper-renewal',
    app: 'fw',
    title: { en: 'Renewing a foreign worker’s papers', ms: 'Memperbaharui dokumen pekerja asing' },
    purpose: {
      en: 'Permit (PLKS), passport, FOMEMA, insurance, SPIKPA and the KDN letter sit on a reminder ladder; FWM renews them and sends the OM dated tasks.',
      ms: 'Permit (PLKS), pasport, FOMEMA, insurans, SPIKPA dan surat KDN berada pada tangga peringatan; FWM memperbaharuinya dan menghantar tugasan bertarikh kepada OM.',
    },
    start: { view: 'fwm', tab: 'papers', label: { en: 'Foreign workers › Papers', ms: 'Pekerja asing › Dokumen' } },
    starter: { en: 'FWM Manager, Deputy or Executives', ms: 'Pengurus, Timbalan atau Eksekutif FWM' },
    steps: [
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Puts each paper on the ladder at 120, 90, 60, 30, 15 and 7 days, and escalates late steps to FWM, Chief of Staff, COO and CEO.', ms: 'Meletakkan setiap dokumen pada tangga 120, 90, 60, 30, 15 dan 7 hari, dan menaikkan langkah lewat kepada FWM, Ketua Staf, COO dan CEO.' },
      },
      {
        who: { en: 'FWM', ms: 'FWM' },
        does: { en: 'Sends the OM a dated task (bring the worker, collect a paper).', ms: 'Menghantar tugasan bertarikh kepada OM (bawa pekerja, ambil dokumen).' },
        where: { view: 'fwm', tab: 'papers', label: { en: 'Foreign workers › Papers › Send task to OM', ms: 'Pekerja asing › Dokumen › Hantar tugasan kepada OM' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Does the task and sends the proof.', ms: 'Melaksanakan tugasan dan menghantar bukti.' },
        where: { view: 'fwm', tab: 'tasks', label: { en: 'Foreign workers › Tasks', ms: 'Pekerja asing › Tugasan' } },
      },
      {
        who: { en: 'FWM', ms: 'FWM' },
        does: { en: 'Accepts the proof or sends it back; records Renewal submitted with its receipt (the ladder pauses).', ms: 'Menerima bukti atau memulangkannya; merekod Renewal submitted dengan resitnya (tangga berhenti seketika).' },
        where: { view: 'fwm', tab: 'tasks', label: { en: 'Foreign workers › Tasks', ms: 'Pekerja asing › Tugasan' } },
        decision: true,
      },
      {
        who: { en: 'FWM', ms: 'FWM' },
        does: { en: 'Records the new paper from its copy (New paper received); the ladder restarts on the new date.', ms: 'Merekod dokumen baharu daripada salinannya (New paper received); tangga bermula semula pada tarikh baharu.' },
        where: { view: 'fwm', tab: 'papers', label: { en: 'Foreign workers › Papers', ms: 'Pekerja asing › Dokumen' } },
      },
    ],
    rules: [
      {
        en: 'At 30 days or less everyone alerted acknowledges within 1 working day: FWM and Chief of Staff from 30 days, COO from 15, CEO from 7.',
        ms: 'Pada 30 hari atau kurang setiap yang dimaklumkan mengakui dalam 1 hari bekerja: FWM dan Ketua Staf dari 30 hari, COO dari 15, CEO dari 7.',
      },
      { en: 'When Prima and the JA app differ, the ladder counts to the earlier date until FWM settles it.', ms: 'Apabila Prima dan aplikasi JA berbeza, tangga mengira ke tarikh yang lebih awal sehingga FWM menyelesaikannya.' },
      { en: 'Passport numbers are kept as the last 4 characters only.', ms: 'Nombor pasport disimpan 4 aksara terakhir sahaja.' },
      { en: 'Old paper dates and workers are added by FWM or the owner (Add, Import from file); a later correction that moves an expiry later needs the copy.', ms: 'Tarikh dokumen lama dan pekerja ditambah oleh FWM atau pemilik (Tambah, Import dari fail); pembetulan yang melewatkan tarikh tamat perlu salinan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FWM_BOARD_REAL_USE.md', decided: 'Fauzan, 5 Nov 2026' },
    words: 'permit plks passport pasport fomema insurance insurans spikpa kdn renewal pembaharuan ladder tangga fwm foreign worker pekerja asing',
  },
  {
    id: 'fw-recruitment',
    app: 'fw',
    title: { en: 'Recruiting a foreign worker', ms: 'Merekrut pekerja asing' },
    purpose: {
      en: 'One recruitment file per worker: agency licence, embassy confirmation, interview, age check and bilingual contract, before the FWM Manager clears travel.',
      ms: 'Satu fail rekrut bagi setiap pekerja: lesen agensi, pengesahan kedutaan, temu duga, semakan umur dan kontrak dwibahasa, sebelum Pengurus FWM membenarkan perjalanan.',
    },
    start: { view: 'fwm', tab: 'recruit', label: { en: 'Foreign workers › Recruitment steps › New recruitment file', ms: 'Pekerja asing › Langkah rekrut › Fail rekrut baharu' } },
    starter: { en: 'FWM staff', ms: 'Staf FWM' },
    steps: [
      {
        who: { en: 'FWM staff', ms: 'Staf FWM' },
        does: {
          en: 'Records each step with its paper: agency licence (not expired), embassy letter, interview result, date of birth from the passport (age 18 to 60 at travel), and the signed contract in English and Malay.',
          ms: 'Merekod setiap langkah dengan dokumennya: lesen agensi (belum tamat), surat kedutaan, keputusan temu duga, tarikh lahir dari pasport (umur 18 hingga 60 semasa perjalanan), dan kontrak bertandatangan dalam Bahasa Inggeris dan Melayu.',
        },
        where: { view: 'fwm', tab: 'recruit', label: { en: 'Foreign workers › Recruitment steps', ms: 'Pekerja asing › Langkah rekrut' } },
      },
      {
        who: { en: 'FWM Manager or Deputy', ms: 'Pengurus atau Timbalan FWM' },
        does: { en: 'Clears the worker to travel once all five steps fit the travel date.', ms: 'Membenarkan pekerja melakukan perjalanan apabila kelima-lima langkah sesuai dengan tarikh perjalanan.' },
        where: { view: 'fwm', tab: 'recruit', label: { en: 'Recruitment steps › Clear to travel', ms: 'Langkah rekrut › Benarkan perjalanan' } },
        decision: true,
      },
      {
        who: { en: 'FWM staff', ms: 'Staf FWM' },
        does: { en: 'On arrival, links the worker’s staff record; the zero-fees check follows in welfare.', ms: 'Semasa ketibaan, memautkan rekod staf pekerja; semakan sifar yuran menyusul dalam kebajikan.' },
        where: { view: 'fwm', tab: 'recruit', label: { en: 'Recruitment steps › Record arrival', ms: 'Langkah rekrut › Rekod ketibaan' } },
      },
    ],
    rules: [
      { en: 'A failed interview or an age outside 18 to 60 stops the file; the reason is kept and nothing is deleted.', ms: 'Temu duga gagal atau umur di luar 18 hingga 60 menghentikan fail; sebab disimpan dan tiada yang dipadam.' },
      { en: 'Moving the travel date after clearance re-checks the steps and may withdraw the clearance.', ms: 'Mengalih tarikh perjalanan selepas kebenaran menyemak semula langkah dan boleh menarik balik kebenaran.' },
      { en: 'A company manager sees only the step status of its own files.', ms: 'Pengurus Syarikat hanya melihat status langkah fail syarikatnya sendiri.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FWM_RECRUITMENT_STEPS.md', decided: 'Fauzan, 6 Nov 2026' },
    words: 'recruitment rekrut agency agensi embassy kedutaan interview temu duga contract kontrak travel perjalanan nepal',
  },
  {
    id: 'fw-welfare',
    app: 'fw',
    title: { en: 'Foreign worker welfare checks', ms: 'Semakan kebajikan pekerja asing' },
    purpose: {
      en: 'Arrival fee check, passport check and a private welfare talk every 90 days; anything raised opens a follow-up that someone else closes.',
      ms: 'Semakan yuran ketibaan, semakan pasport dan perbualan kebajikan peribadi setiap 90 hari; apa-apa yang dibangkitkan membuka susulan yang ditutup oleh orang lain.',
    },
    start: { view: 'fwm', tab: 'welfare', label: { en: 'Foreign workers › Recruitment and welfare', ms: 'Pekerja asing › Rekrut dan kebajikan' } },
    starter: { en: 'FWM staff', ms: 'Staf FWM' },
    steps: [
      {
        who: { en: 'FWM staff', ms: 'Staf FWM' },
        does: { en: 'Records the arrival fee check: did the worker pay anything to get the job, to whom and how much.', ms: 'Merekod semakan yuran ketibaan: adakah pekerja membayar apa-apa untuk mendapat kerja, kepada siapa dan berapa.' },
        where: { view: 'fwm', tab: 'welfare', label: { en: 'Foreign workers › Recruitment and welfare', ms: 'Pekerja asing › Rekrut dan kebajikan' } },
      },
      {
        who: { en: 'FWM staff', ms: 'Staf FWM' },
        does: { en: 'Records the passport check (the worker has it, or the company keeps it with signed consent).', ms: 'Merekod semakan pasport (pekerja memegangnya, atau syarikat menyimpannya dengan persetujuan bertandatangan).' },
        where: { view: 'fwm', tab: 'welfare', label: { en: 'Foreign workers › Recruitment and welfare', ms: 'Pekerja asing › Rekrut dan kebajikan' } },
      },
      {
        who: { en: 'FWM staff', ms: 'Staf FWM' },
        does: { en: 'Holds a private welfare talk every 90 days and records what the worker raised.', ms: 'Mengadakan perbualan kebajikan peribadi setiap 90 hari dan merekod apa yang dibangkitkan pekerja.' },
        where: { view: 'fwm', tab: 'welfare', label: { en: 'Foreign workers › Recruitment and welfare', ms: 'Pekerja asing › Rekrut dan kebajikan' } },
      },
      {
        who: { en: 'Someone other than who opened it', ms: 'Orang selain yang membukanya' },
        does: { en: 'Closes the follow-up with how it was dealt with.', ms: 'Menutup susulan dengan cara ia ditangani.' },
        where: { view: 'fwm', tab: 'welfare', label: { en: 'Recruitment and welfare › Close the follow-up', ms: 'Rekrut dan kebajikan › Tutup susulan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Zero recruitment fees: a fee paid, a passport held without consent or a concern opens a follow-up.', ms: 'Sifar yuran rekrut: yuran dibayar, pasport dipegang tanpa persetujuan atau kebimbangan membuka susulan.' },
      { en: 'Confidential to FWM and group leaders.', ms: 'Sulit kepada FWM dan pemimpin kumpulan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W16' },
    words: 'welfare kebajikan recruitment fee yuran rekrut passport pasport consent persetujuan talk perbualan iway',
  },
  {
    id: 'fw-recruitment-cost',
    app: 'fw',
    title: { en: 'Recruitment cost when a worker works for another company', ms: 'Kos rekrut apabila pekerja bekerja untuk syarikat lain' },
    purpose: {
      en: 'When a foreign worker works under another company’s or a branch’s job, the host pays FWM a monthly recruitment cost and FWM pays the owning company back.',
      ms: 'Apabila pekerja asing bekerja di bawah kerja syarikat atau cawangan lain, hos membayar FWM kos rekrut bulanan dan FWM membayar balik syarikat pemilik.',
    },
    start: { view: 'fwcost', tab: 'placements', label: { en: 'Recruitment cost › Record a placement', ms: 'Kos rekrut › Rekod penempatan' } },
    starter: { en: 'FWM staff', ms: 'Staf FWM' },
    steps: [
      {
        who: { en: 'FD or CEO', ms: 'FD atau CEO' },
        does: { en: 'Sets the charge rate and the payback rate.', ms: 'Menetapkan kadar caj dan kadar bayaran balik.' },
        where: { view: 'fwcost', tab: 'rates', label: { en: 'Recruitment cost › Rates', ms: 'Kos rekrut › Kadar' } },
      },
      {
        who: { en: 'FWM staff', ms: 'Staf FWM' },
        does: { en: 'Records each placement (worker, host company or branch, from and to), oldest first with the real start date.', ms: 'Merekod setiap penempatan (pekerja, syarikat atau cawangan hos, dari dan hingga), yang tertua dahulu dengan tarikh mula sebenar.' },
        where: { view: 'fwcost', tab: 'placements', label: { en: 'Recruitment cost › Placements', ms: 'Kos rekrut › Penempatan' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Drafts each finished month’s charges.', ms: 'Merangka caj bagi setiap bulan yang selesai.' },
        where: { view: 'fwcost', tab: 'charges', label: { en: 'Recruitment cost › Charges', ms: 'Kos rekrut › Caj' } },
      },
      {
        who: { en: 'FD or CEO', ms: 'FD atau CEO' },
        does: { en: 'Approves the month with a reason, or rejects it for correction.', ms: 'Meluluskan bulan itu dengan sebab, atau menolaknya untuk pembetulan.' },
        where: { view: 'fwcost', tab: 'charges', label: { en: 'Recruitment cost › Charges', ms: 'Kos rekrut › Caj' } },
        decision: true,
      },
      {
        who: { en: 'Finance (not the approver)', ms: 'Kewangan (bukan pelulus)' },
        does: { en: 'Records the invoice, then the payment with its slip.', ms: 'Merekod invois, kemudian bayaran dengan slipnya.' },
        where: { view: 'fwcost', tab: 'charges', label: { en: 'Recruitment cost › Charges', ms: 'Kos rekrut › Caj' } },
      },
    ],
    rules: [
      { en: 'Any day in a month counts as the full month; two hosts in one month pay half each.', ms: 'Mana-mana hari dalam sebulan dikira sebulan penuh; dua hos dalam sebulan membayar separuh setiap satu.' },
      { en: 'A charged month is locked: a back-dated placement into it is refused until the FD or CEO rejects the draft.', ms: 'Bulan yang telah dicaj dikunci: penempatan bertarikh ke belakang ditolak sehingga FD atau CEO menolak draf.' },
      { en: 'The worker keeps wearing the owning company’s uniform. Legal flags go to the CEO log; they never stop the work.', ms: 'Pekerja terus memakai uniform syarikat pemilik. Isu undang-undang dihantar ke log CEO; ia tidak menghentikan kerja.' },
    ],
    status: 'in_force',
    statusNote: { en: 'No charge can be drafted until the FD or CEO sets both rates.', ms: 'Tiada caj boleh dirangka sehingga FD atau CEO menetapkan kedua-dua kadar.' },
    source: { doc: 'docs/FW_RECRUITMENT_COST_REVIEW.md', decided: 'Fauzan, 3 and 4 Nov 2026' },
    words: 'recruitment cost kos rekrut placement penempatan host hos payback bayaran balik charge caj nepali branch cawangan',
  },
  {
    id: 'fw-epf-socso-recharge',
    app: 'fw',
    title: { en: 'Nepali EPF and SOCSO recharge', ms: 'Caj semula KWSP dan PERKESO pekerja Nepal' },
    purpose: {
      en: 'The permit company pays EPF and SOCSO; the company or branch that used the worker repays its share every month by debit note.',
      ms: 'Syarikat pemegang permit membayar KWSP dan PERKESO; syarikat atau cawangan yang menggunakan pekerja membayar balik bahagiannya setiap bulan melalui nota debit.',
    },
    start: { view: 'fwstat', label: { en: 'Nepali EPF and SOCSO › Months to charge', ms: 'KWSP dan PERKESO Nepal › Bulan untuk dicaj' } },
    starter: { en: "The owner company's Finance team or the FD", ms: 'Pasukan Kewangan syarikat pemilik atau FD' },
    steps: [
      {
        who: { en: 'Owner company', ms: 'Syarikat pemilik' },
        does: { en: 'Pays KWSP and PERKESO every month as usual, by the 15th, whether or not the user has repaid.', ms: 'Membayar KWSP dan PERKESO setiap bulan seperti biasa, menjelang 15hb, sama ada pengguna telah membayar balik atau tidak.' },
        outside: true,
      },
      {
        who: { en: "Owner's Finance team", ms: 'Pasukan Kewangan pemilik' },
        does: {
          en: 'Prepares and issues the debit note per user company or branch: wage and amounts actually paid per worker, with the KWSP and PERKESO receipt numbers.',
          ms: 'Menyediakan dan mengeluarkan nota debit bagi setiap syarikat atau cawangan pengguna: gaji dan amaun sebenar dibayar bagi setiap pekerja, dengan nombor resit KWSP dan PERKESO.',
        },
        where: { view: 'fwstat', label: { en: 'Nepali EPF and SOCSO › Prepare the debit note', ms: 'KWSP dan PERKESO Nepal › Sediakan nota debit' } },
      },
      {
        who: { en: 'User company staff or Finance; the Branch Manager for a branch', ms: 'Staf atau Kewangan syarikat pengguna; Pengurus Cawangan bagi cawangan' },
        does: { en: 'Transfers the full amount within 30 days and records the repayment.', ms: 'Memindahkan amaun penuh dalam 30 hari dan merekod bayaran balik.' },
        where: { view: 'fwstat', label: { en: 'Nepali EPF and SOCSO › Record the repayment', ms: 'KWSP dan PERKESO Nepal › Rekod bayaran balik' } },
      },
      {
        who: { en: "Owner's Finance (not who recorded the payment)", ms: 'Kewangan pemilik (bukan yang merekod bayaran)' },
        does: { en: 'Matches the transfer to the bank statement and checks the money in.', ms: 'Memadankan pindahan dengan penyata bank dan mengesahkan wang masuk.' },
        where: { view: 'fwstat', label: { en: 'Nepali EPF and SOCSO › Check in the money', ms: 'KWSP dan PERKESO Nepal › Sahkan wang masuk' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A mid-month move is split by days used over days in the month.', ms: 'Pertukaran pertengahan bulan dibahagi mengikut hari digunakan berbanding hari dalam bulan.' },
      { en: 'The salary is not part of the debit note; it is paid by the user company or branch.', ms: 'Gaji bukan sebahagian nota debit; ia dibayar oleh syarikat atau cawangan pengguna.' },
      { en: 'A recharged month locks the placement; cancel the note first to change it.', ms: 'Bulan yang telah dicaj semula mengunci penempatan; batalkan nota dahulu untuk mengubahnya.' },
    ],
    status: 'in_force',
    statusNote: { en: '30 days to repay and the prefilled rates are proposals waiting for Fauzan.', ms: '30 hari untuk membayar balik dan kadar yang dipraisi masih cadangan menunggu Fauzan.' },
    source: { doc: 'docs/FW_EPF_SOCSO_RECHARGE.md', decided: 'Fauzan, 5 Nov 2026' },
    words: 'epf kwsp socso perkeso nepali nepal recharge caj semula debit note nota debit repay bayar balik lindung',
  },
  {
    id: 'fw-hostel-bill',
    app: 'fw',
    title: { en: 'Hostel bill payment', ms: 'Bayaran bil asrama' },
    purpose: {
      en: 'The company that owns or rents a hostel asks for payment approval; FWM checks; the Operations Director or OGM, then the COO approve; the company pays.',
      ms: 'Syarikat yang memiliki atau menyewa asrama memohon kelulusan bayaran; FWM menyemak; Pengarah Operasi atau OGM, kemudian COO meluluskan; syarikat membayar.',
    },
    start: { view: 'hostels', tab: 'bills', label: { en: 'Hostels › Bills › Add a bill', ms: 'Asrama › Bil › Tambah bil' } },
    starter: { en: 'The owning company’s office (company manager or admin executive)', ms: 'Pejabat syarikat pemilik (Pengurus Syarikat atau eksekutif admin)' },
    steps: [
      {
        who: { en: 'Company office', ms: 'Pejabat syarikat' },
        does: { en: 'Adds the bill on the hostel and asks for payment approval.', ms: 'Menambah bil pada asrama dan memohon kelulusan bayaran.' },
        where: { view: 'hostels', tab: 'bills', label: { en: 'Hostels › Bills', ms: 'Asrama › Bil' } },
      },
      {
        who: { en: 'FWM', ms: 'FWM' },
        does: { en: 'Checks it with a comment and passes it on, or sends it back.', ms: 'Menyemak dengan komen dan menghantarnya, atau memulangkannya.' },
        where: { view: 'hostels', tab: 'bills', label: { en: 'Hostels › Bills', ms: 'Asrama › Bil' } },
        decision: true,
      },
      {
        who: { en: 'Operations Director (private) or OGM (government), then the COO', ms: 'Pengarah Operasi (swasta) atau OGM (kerajaan), kemudian COO' },
        does: { en: 'Each approves with a comment, or sends it back.', ms: 'Masing-masing meluluskan dengan komen, atau memulangkannya.' },
        where: { view: 'hostels', tab: 'bills', label: { en: 'Hostels › Bills', ms: 'Asrama › Bil' } },
        decision: true,
      },
      {
        who: { en: 'Company office (or Finance)', ms: 'Pejabat syarikat (atau Kewangan)' },
        does: { en: 'Pays from the company’s bank and uploads the slip; when Finance records the payment it shows as paid at once.', ms: 'Membayar dari bank syarikat dan memuat naik slip; apabila Kewangan merekod bayaran ia terus ditunjukkan sebagai dibayar.' },
        where: { view: 'hostels', tab: 'bills', label: { en: 'Hostels › Upload the payment slip', ms: 'Asrama › Muat naik slip bayaran' } },
      },
    ],
    rules: [
      { en: 'Reminders 14, 7 and 3 days before due; overdue climbs to the Chief of Staff, COO and CEO.', ms: 'Peringatan 14, 7 dan 3 hari sebelum tarikh akhir; tertunggak dinaikkan kepada Ketua Staf, COO dan CEO.' },
      { en: 'Finance sees hostel bills in its checks and looks for each paid bill on the bank statement.', ms: 'Kewangan melihat bil asrama dalam semakannya dan mencari setiap bil yang dibayar dalam penyata bank.' },
    ],
    status: 'in_force',
    statusNote: { en: 'Reminder days and the overdue ladder are proposals.', ms: 'Hari peringatan dan tangga tertunggak masih cadangan.' },
    source: { doc: 'docs/system/03-business-rules.md', decided: 'Fauzan, 26 Oct 2026' },
    words: 'hostel asrama bill bil rent sewa utility utiliti approval kelulusan slip fwm coo',
  },
  {
    id: 'fw-utility-excess',
    app: 'fw',
    title: { en: 'Hostel electricity and water above the allowance', ms: 'Elektrik dan air asrama melebihi elaun' },
    purpose: {
      en: 'Prima works out each worker’s share of electricity above RM30 and water above RM20 a month; HR decides per person: a notice or, from the third time, a deduction.',
      ms: 'Prima mengira bahagian setiap pekerja bagi elektrik melebihi RM30 dan air melebihi RM20 sebulan; HR memutuskan bagi setiap orang: notis atau, dari kali ketiga, potongan.',
    },
    start: { view: 'hostels', tab: 'utility', label: { en: 'Hostels › Utility excess', ms: 'Asrama › Lebihan utiliti' } },
    starter: { en: 'Prima, from the hostel bills', ms: 'Prima, daripada bil asrama' },
    steps: [
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Shares the excess by bed-days for each worker.', ms: 'Membahagi lebihan mengikut hari katil bagi setiap pekerja.' },
      },
      {
        who: { en: 'HR', ms: 'HR' },
        does: { en: 'Gives a notice the 1st and 2nd time, and records that the worker signed it.', ms: 'Memberi notis pada kali pertama dan kedua, dan merekod pekerja telah menandatanganinya.' },
        where: { view: 'hostels', tab: 'utility', label: { en: 'Hostels › Utility excess › Give a notice', ms: 'Asrama › Lebihan utiliti › Beri notis' } },
        decision: true,
      },
      {
        who: { en: 'HR', ms: 'HR' },
        does: { en: 'Before any deduction, files the signed contract clause and the worker’s signed acknowledgement.', ms: 'Sebelum sebarang potongan, memfailkan klausa kontrak bertandatangan dan pengakuan bertandatangan pekerja.' },
        where: { view: 'hostels', tab: 'utility', label: { en: 'Hostels › Utility excess', ms: 'Asrama › Lebihan utiliti' } },
      },
      {
        who: { en: 'HR', ms: 'HR' },
        does: { en: 'From the 3rd time, may choose Deduct from pay.', ms: 'Dari kali ketiga, boleh memilih Potong dari gaji.' },
        where: { view: 'hostels', tab: 'utility', label: { en: 'Hostels › Utility excess › Deduct from pay', ms: 'Asrama › Lebihan utiliti › Potong dari gaji' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A deduction only when the employment contract has the utility clause; the count never resets.', ms: 'Potongan hanya apabila kontrak pekerjaan ada klausa utiliti; kiraan tidak pernah ditetapkan semula.' },
      { en: 'Total deductions in a month stay within 50% of wages (Employment Act s.24(8)).', ms: 'Jumlah potongan sebulan kekal dalam 50% gaji (Akta Kerja s.24(8)).' },
    ],
    status: 'in_force',
    statusNote: { en: 'JTK’s written confirmation of the practice is not on file yet (legal item L4).', ms: 'Pengesahan bertulis JTK tentang amalan ini belum ada dalam fail (isu undang-undang L4).' },
    source: { doc: 'docs/system/03-business-rules.md', decided: 'Fauzan, 26 Oct 2026' },
    words: 'utility utiliti electricity elektrik water air hostel asrama deduction potongan notice notis hr',
  },
  {
    id: 'fw-hostel-need',
    app: 'fw',
    title: { en: 'Hostel needs and repairs', ms: 'Keperluan dan pembaikan asrama' },
    purpose: {
      en: 'The OM asks for items or a repair for a foreign worker hostel; FWM verifies, the Operations Director or OGM approves, Asset Management buys or orders the work.',
      ms: 'OM memohon barang atau pembaikan untuk asrama pekerja asing; FWM mengesahkan, Pengarah Operasi atau OGM meluluskan, Pengurusan Aset membeli atau mengarahkan kerja.',
    },
    start: { view: 'hostels', tab: 'hostels', label: { en: 'Hostels › Foreign worker hostels › Mohon keperluan', ms: 'Asrama › Asrama pekerja asing › Mohon keperluan' } },
    starter: { en: 'OM (or the company office)', ms: 'OM (atau pejabat syarikat)' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Raises the need (or a repair with before photos) on the hostel; the screen shows the residents and the items already there.', ms: 'Memohon keperluan (atau pembaikan dengan gambar sebelum) pada asrama; skrin menunjukkan penghuni dan barang yang sedia ada.' },
        where: { view: 'hostels', tab: 'hostels', label: { en: 'Hostels › Foreign worker hostels', ms: 'Asrama › Asrama pekerja asing' } },
      },
      {
        who: { en: 'FWM', ms: 'FWM' },
        does: { en: 'Verifies the need.', ms: 'Mengesahkan keperluan.' },
        where: { view: 'hostels', tab: 'needs', label: { en: 'Hostels › Keperluan hostel', ms: 'Asrama › Keperluan hostel' } },
        decision: true,
      },
      {
        who: { en: 'Operations Director or OGM (not the raiser)', ms: 'Pengarah Operasi atau OGM (bukan pemohon)' },
        does: { en: 'Approves or rejects with a reason.', ms: 'Meluluskan atau menolak dengan sebab.' },
        where: { view: 'hostels', tab: 'needs', label: { en: 'Hostels › Keperluan hostel', ms: 'Asrama › Keperluan hostel' } },
        decision: true,
      },
      {
        who: { en: 'Asset Management', ms: 'Pengurusan Aset' },
        does: { en: 'Sees only approved needs (hostel name and address, no worker data) and buys once against the need, within the usual COO approval limits.', ms: 'Hanya melihat keperluan yang diluluskan (nama dan alamat asrama, tiada data pekerja) dan membeli sekali bagi keperluan itu, dalam had kelulusan COO biasa.' },
        where: { view: 'hostels', tab: 'needs', label: { en: 'Hostels › Keperluan hostel', ms: 'Asrama › Keperluan hostel' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Confirms receipt with a photo (or marks the repair done with after photos); the hostel list updates.', ms: 'Mengesahkan penerimaan dengan gambar (atau menanda pembaikan siap dengan gambar selepas); senarai asrama dikemas kini.' },
        where: { view: 'hostels', tab: 'needs', label: { en: 'Hostels › Keperluan hostel', ms: 'Asrama › Keperluan hostel' } },
      },
    ],
    rules: [
      { en: 'Company-paid repairs need at least 2 quotes; fewer than 3 needs the Asset Director’s reason.', ms: 'Pembaikan dibayar syarikat perlu sekurang-kurangnya 2 sebut harga; kurang daripada 3 perlu sebab Pengarah Aset.' },
      { en: 'Weekly, monthly, audit and 90-day checks need 2 photos; a missed check shows on the OM’s Do today.', ms: 'Semakan mingguan, bulanan, audit dan 90 hari perlu 2 gambar; semakan yang terlepas dipapar pada Buat hari ini OM.' },
      { en: 'Damage needs a photo; a penalty only with a negligence finding and a named worker; a pay deduction is HR’s decision.', ms: 'Kerosakan perlu gambar; denda hanya dengan dapatan kecuaian dan pekerja dinamakan; potongan gaji ialah keputusan HR.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/FWM_MOVES_AND_HOSTEL_NEEDS.md', decided: 'Fauzan, 13 and 14 Nov 2026 (Part P)' },
    words: 'hostel asrama need keperluan repair pembaikan baik pulih damage kerosakan asset aset om fwm',
  },
  {
    id: 'fw-move',
    app: 'fw',
    title: { en: 'Moving a foreign worker to another hostel or site', ms: 'Memindah pekerja asing ke asrama atau tapak lain' },
    purpose: {
      en: 'A move of hostel, site or both is signed by five people in turn, then released, received and closed by FWM with the JA reference.',
      ms: 'Pemindahan asrama, tapak atau kedua-duanya ditandatangani lima orang secara bergilir, kemudian dilepaskan, diterima dan ditutup oleh FWM dengan rujukan JA.',
    },
    starter: { en: 'The OM of the site (FWM for a new arrival)', ms: 'OM tapak (FWM bagi ketibaan baharu)' },
    steps: [
      {
        who: { en: 'Site OM', ms: 'OM tapak' },
        does: { en: 'Raises the move at least 3 working days ahead (urgent needs a reason).', ms: 'Memohon pemindahan sekurang-kurangnya 3 hari bekerja lebih awal (segera perlu sebab).' },
      },
      {
        who: { en: 'Origin PIC, new PIC, FWM, the new company head, then the Operations Director or OGM', ms: 'PIC asal, PIC baharu, FWM, ketua syarikat baharu, kemudian Pengarah Operasi atau OGM' },
        does: { en: 'Each signs in turn. Only FWM returns a move.', ms: 'Masing-masing menandatangani secara bergilir. Hanya FWM boleh memulangkan pemindahan.' },
        where: { view: 'hostels', tab: 'moves', label: { en: 'Hostels › Pindah hostel / site', ms: 'Asrama › Pindah hostel / site' } },
        decision: true,
      },
      {
        who: { en: 'OMs, then FWM', ms: 'OM, kemudian FWM' },
        does: { en: 'Release, transit and receive (which creates the stay and sets the work site); FWM closes it with the JA reference.', ms: 'Lepas, dalam perjalanan dan terima (yang mencipta penginapan dan menetapkan tapak kerja); FWM menutupnya dengan rujukan JA.' },
        where: { view: 'hostels', tab: 'moves', label: { en: 'Hostels › Pindah hostel / site', ms: 'Asrama › Pindah hostel / site' } },
      },
    ],
    rules: [
      { en: 'Nobody signs two steps.', ms: 'Tiada sesiapa menandatangani dua langkah.' },
      { en: 'A move to another company’s site keeps the employer; papers to file are shown as warnings.', ms: 'Pemindahan ke tapak syarikat lain mengekalkan majikan; dokumen yang perlu difailkan dipapar sebagai amaran.' },
      { en: 'A received move not closed after 24 hours reminds FWM.', ms: 'Pemindahan yang diterima tetapi tidak ditutup selepas 24 jam mengingatkan FWM.' },
    ],
    status: 'draft',
    statusNote: {
      en: 'The signing, release and receive steps are on the screen; the form to raise a move is not on any screen yet.',
      ms: 'Langkah tandatangan, lepas dan terima ada pada skrin; borang untuk memohon pemindahan belum ada pada mana-mana skrin.',
    },
    source: { doc: 'docs/FWM_MOVES_AND_HOSTEL_NEEDS.md', decided: 'Fauzan, 13 and 14 Nov 2026 (Part P)' },
    words: 'move pindah transfer hostel asrama site tapak worker pekerja om pic fwm ja',
  },
  {
    id: 'fw-arrival-cash',
    app: 'fw',
    title: { en: 'Arrival cash for a new foreign worker', ms: 'Tunai ketibaan untuk pekerja asing baharu' },
    purpose: {
      en: 'Cash for a recently arrived worker with no wages yet, awaiting PLKS: FWM asks, the CEO decides each request, FWM hands it over against a signed receipt, and it is recovered from wages.',
      ms: 'Tunai untuk pekerja yang baru tiba tanpa gaji lagi, menunggu PLKS: FWM memohon, CEO memutuskan setiap permohonan, FWM menyerahkannya dengan resit bertandatangan, dan ia dipulihkan daripada gaji.',
    },
    start: { view: 'arrivalcash', label: { en: 'Arrival cash › New arrival request', ms: 'Tunai ketibaan › Permohonan ketibaan baharu' } },
    starter: { en: 'FWM Manager', ms: 'Pengurus FWM' },
    steps: [
      {
        who: { en: 'FWM Manager', ms: 'Pengurus FWM' },
        does: { en: 'Requests each amount and purpose, and sets the number of recovery months.', ms: 'Memohon setiap amaun dan tujuan, dan menetapkan bilangan bulan pemulihan.' },
        where: { view: 'arrivalcash', label: { en: 'Arrival cash', ms: 'Tunai ketibaan' } },
      },
      {
        who: { en: 'Finance with legal', ms: 'Kewangan bersama undang-undang' },
        does: { en: 'Records the Finance/legal review for the record: reviewed cap, months, receivable account and references.', ms: 'Merekod semakan Kewangan/undang-undang bagi rekod itu: had yang disemak, bulan, akaun belum terima dan rujukan.' },
        where: { view: 'arrivalcash', label: { en: 'Arrival cash › Record policy review', ms: 'Tunai ketibaan › Rekod semakan polisi' } },
      },
      {
        who: { en: 'CEO (or the FD as the CEO’s stand-in)', ms: 'CEO (atau FD sebagai pengganti CEO)' },
        does: { en: 'Approves or refuses each request with a reason, never their own.', ms: 'Meluluskan atau menolak setiap permohonan dengan sebab, bukan permohonan sendiri.' },
        where: { view: 'arrivalcash', label: { en: 'Arrival cash', ms: 'Tunai ketibaan' } },
        decision: true,
      },
      {
        who: { en: 'FWM Manager', ms: 'Pengurus FWM' },
        does: { en: 'Records the actual handover and attaches the worker’s genuine signed receipt for this payment.', ms: 'Merekod penyerahan sebenar dan melampirkan resit bertandatangan asli pekerja bagi bayaran ini.' },
        where: { view: 'arrivalcash', label: { en: 'Arrival cash', ms: 'Tunai ketibaan' } },
      },
      {
        who: { en: 'Prima and payroll', ms: 'Prima dan gaji' },
        does: { en: 'Recovers it from the first wage months over the months FWM set, within the reviewed cap.', ms: 'Memulihkannya daripada bulan gaji pertama mengikut bulan yang ditetapkan FWM, dalam had yang disemak.' },
      },
    ],
    rules: [
      { en: 'Approval creates no debt; only a recorded handover does.', ms: 'Kelulusan tidak mewujudkan hutang; hanya penyerahan yang direkod.' },
      { en: 'Recovery is held until the genuine signed receipt is attached; a stored signature is never pasted.', ms: 'Pemulihan ditahan sehingga resit bertandatangan asli dilampirkan; tandatangan tersimpan tidak sekali-kali ditampal.' },
      { en: 'The FD decides only while the CEO has turned the stand-in on, and never a request the FD made.', ms: 'FD hanya memutuskan semasa CEO menghidupkan pengganti, dan tidak sekali-kali permohonan yang dibuat FD.' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'Each record needs the Finance/legal review before any handover; Finance and a legal adviser review the cash treatment before real use.',
      ms: 'Setiap rekod perlu semakan Kewangan/undang-undang sebelum sebarang penyerahan; Kewangan dan penasihat undang-undang menyemak layanan tunai sebelum penggunaan sebenar.',
    },
    source: { doc: 'docs/ARRIVAL_CASH_LOCAL_REVIEW.md', decided: 'Fauzan, 8 and 11 Nov 2026' },
    words: 'arrival cash tunai ketibaan advance pendahuluan new worker pekerja baharu plks receipt resit recovery pemulihan ceo',
  },
];

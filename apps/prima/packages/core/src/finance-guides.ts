// In-app guide cards for Finance tasks (Arisha main's review, 2 Nov 2026, section A; Fauzan confirmed the
// director-only legal flags the same day). One card per staff or manager task: what it is for, who does it, the exact
// screen and button, every field with its format and one made-up example, where the source document is and whom to
// ask, what Prima already holds (never typed or uploaded twice), the review and return path, and how to recover from
// an error. Bahasa Melayu first, with matching English.
//
// The same versioned, role-scoped cards feed Arisha, so her answers match the screen and never describe another
// role's work. Every field key is the one the service reads; finance-guides.test.ts runs each entry card's example
// through the real service. Nothing here names a person, a folder or an integration that does not exist: contacts are
// roles, and anything not built is marked so.
import { finActor } from './finance';
import { finRequestHeadFits } from './finance-requests';
import type { User } from './types';

export const FIN_GUIDES_VERSION = '2026-11-02.1';

export type FinGuideRole = 'fin_data_entry' | 'fin_deputy' | 'fin_leader' | 'fd' | 'ceo' | 'coo' | 'company_head' | 'dept_head';

export interface FinText {
  ms: string;
  en: string;
}
const b = (ms: string, en: string): FinText => ({ ms, en });

export interface FinGuideField {
  /** The input key the service reads. */
  key: string;
  label: FinText;
  required: boolean;
  format: FinText;
  /** Made-up example, never a real record. */
  example: string | number | string[] | Record<string, unknown>[];
}

export interface FinGuide {
  id: string;
  version: string;
  for: FinGuideRole[];
  title: FinText;
  purpose: FinText;
  /** Where it is done: menu, tab and button, as on screen in English. */
  where: FinText;
  fields: FinGuideField[];
  /** The source record or document, and where an authorised person finds it. */
  sources: FinText[];
  /** Whom to ask when it is missing or does not match (roles, never invented names). */
  ask: FinText[];
  /** What Prima already holds and reuses. */
  reused: FinText[];
  /** Save or submit, review and approval, return, edit and resubmit. */
  steps: FinText[];
  /** What shows it is done. */
  done: FinText;
  recover: FinText[];
  notes?: FinText[];
  status: 'built' | 'not_built';
}

const NOT_TRANSFER = b(
  'Merekod bayaran dalam Prima bukan membuat pindahan bank. Pindahan dibuat dalam portal bank; Prima hanya merekod rujukan bank selepas itu.',
  'Recording a payment in Prima is not making the bank transfer. The transfer is made in the bank portal; Prima only records its reference afterwards.',
);

export const FIN_GUIDES: FinGuide[] = [
  {
    id: 'fin.payment.prepare',
    version: FIN_GUIDES_VERSION,
    for: ['fin_data_entry', 'fin_deputy', 'fin_leader', 'fd', 'ceo'],
    title: b('Sediakan bayaran', 'Prepare a payment'),
    purpose: b(
      'Merekod satu bayaran yang perlu dibuat supaya orang lain menyemak dan meluluskannya sebelum dibayar.',
      'Records a payment that is due so that someone else reviews and approves it before it is paid.',
    ),
    where: b('Finance > tab Payments > butang "New payment"', 'Finance > Payments tab > "New payment" button'),
    fields: [
      {
        key: 'payeeId',
        label: b('Bayar kepada', 'Pay to'),
        required: true,
        format: b(
          'Pilih daripada senarai penerima syarikat (yang disahkan sahaja boleh diluluskan)',
          "Choose from the company's payee list (only verified payees can be approved)",
        ),
        example: 'payee-pwvsb-001',
      },
      {
        key: 'purpose',
        label: b('Tujuan', 'Purpose'),
        required: true,
        format: b('3 hingga 300 huruf', '3 to 300 characters'),
        example: 'Alat tulis pejabat Oktober (contoh)',
      },
      {
        key: 'amount',
        label: b('Amaun (RM)', 'Amount (RM)'),
        required: true,
        format: b('Lebih RM0.00, paling banyak 2 titik perpuluhan', 'More than RM0.00, at most 2 decimals'),
        example: 1250.75,
      },
      { key: 'dueOn', label: b('Tarikh perlu dibayar', 'Due date'), required: true, format: b('Tarikh', 'Date'), example: '2026-11-15' },
      {
        key: 'bankId',
        label: b('Bayar dari akaun', 'Pay from'),
        required: true,
        format: b('Salah satu akaun bank syarikat', "One of the company's bank accounts"),
        example: 'fb-pwvsb-1',
      },
      {
        key: 'sqlRef',
        label: b('Nombor dokumen SQL Account', 'SQL Account document number'),
        required: true,
        format: b('Invois pembelian atau baucar bayaran, 2 hingga 40 huruf', 'Purchase invoice or payment voucher, 2 to 40 characters'),
        example: 'PI-00991',
      },
      {
        key: 'evidence',
        label: b('Dokumen sokongan', 'Supporting documents'),
        required: true,
        format: b(
          'Satu baris setiap dokumen: nama fail atau pautan SharePoint; jangan kata laluan bank atau nombor akaun',
          'One per line: file name or SharePoint link; never bank passwords or account numbers',
        ),
        example: ['Invois SBP-7781 (contoh).pdf'],
      },
      {
        key: 'invoiceNo',
        label: b('Nombor invois pembekal', "Supplier's invoice number"),
        required: false,
        format: b('Prima menolak invois yang sama dibayar dua kali, dalam mana-mana syarikat', 'Prima refuses the same invoice paid twice, in any company'),
        example: 'SBP-7781',
      },
      {
        key: 'subject',
        label: b('Untuk apa (menentukan siapa lulus)', 'What it is for (decides who approves)'),
        required: false,
        format: b(
          'Finance (FD atau CEO lulus) atau jabatan COO (COO atau CEO lulus)',
          'Finance (the FD or CEO approves) or a COO department (the COO or CEO approves)',
        ),
        example: 'finance',
      },
      {
        key: 'eInvoiceRef',
        label: b('UUID e-Invois pembekal', "Supplier's e-Invoice UUID"),
        required: false,
        format: b('Daripada e-Invois yang disahkan; kosongkan jika tiada', 'From the validated e-Invoice; blank if none'),
        example: '',
      },
    ],
    sources: [
      b(
        'Invois pembekal dan dokumen sokongan: dalam fail atau SharePoint pasukan Finance anda.',
        "The supplier's invoice and supporting papers: in your Finance team's files or SharePoint.",
      ),
      b(
        'Nombor dokumen: invois pembelian atau baucar bayaran dalam SQL Account.',
        'The document number: the purchase invoice or payment voucher in SQL Account.',
      ),
      b(
        'Pembelian Procurement: cari dengan nombor pesanan (PO) atau invois dalam pilihan "For a Procurement purchase".',
        'A Procurement purchase: find it by its order (PO) or invoice number in the "For a Procurement purchase" picker.',
      ),
    ],
    ask: [
      b(
        'Penerima tiada dalam senarai: minta rakan pasukan menambah dan orang lain mengesahkan (Checks > Paying out > Payees).',
        'Payee not on the list: ask a teammate to add it and someone else to verify it (Checks > Paying out > Payees).',
      ),
      b(
        'Amaun tidak sama dengan penerimaan barang: eksekutif Procurement & Inventory yang membuat padanan tiga hala, dan ketua pasukan anda.',
        'Amount does not match what was received: the Procurement & Inventory executive who made the three-way match, and your team leader.',
      ),
      b(
        'Baki bank tidak sepadan: timbalan atau ketua pasukan yang menyemak penyesuaian bank.',
        'Bank balance does not agree: the deputy or team leader who reviews the bank reconciliation.',
      ),
    ],
    reused: [
      b(
        'Permintaan bayaran yang sudah diluluskan dan pembelian yang sudah dipadankan diisi sendiri (amaun, tujuan, untuk apa); kelulusannya digunakan, tidak diminta lagi.',
        'An approved payment request or a matched purchase fills the amount, purpose and subject; its approval is used, never asked for again.',
      ),
      b(
        'Memilih penerima mengisi tujuan, akaun dan baris bajet daripada bayaran terakhir kepadanya (boleh diubah).',
        'Choosing a payee fills the purpose, account and budget line from the last payment to them (all editable).',
      ),
    ],
    steps: [
      b(
        'Tekan "Prepare payment". Timbalan atau ketua pasukan menyemak ("Review") dengan komen.',
        'Press "Prepare payment". The deputy or team leader reviews it ("Review") with a comment.',
      ),
      b(
        'FD atau CEO meluluskan (Finance), atau COO atau CEO (jabatan COO). Penyedia dan penyemak tidak meluluskan.',
        'The FD or CEO approves (Finance), or the COO or CEO (COO departments). The preparer and reviewer never approve.',
      ),
      b(
        'Jika dipulangkan, tekan "Edit" pada baris itu, betulkan dan hantar semula. Dokumen lama kekal.',
        'If returned, press "Edit" on its row, correct it and resubmit. Earlier documents stay.',
      ),
    ],
    done: b(
      'Status "Released" dengan rujukan bank, kemudian "On the bank statement" bila penyata dimuatkan.',
      'Status "Released" with the bank reference, then "On the bank statement" once the statement is loaded.',
    ),
    recover: [
      b(
        '"This looks like a duplicate": jika benar bayaran berasingan, nyatakan sebabnya (invois dan bulan berbeza).',
        '"This looks like a duplicate": if it really is separate, say why (a different invoice and month).',
      ),
      b(
        '"You entered or changed ... bank details": orang lain dalam pasukan menyediakan bayaran kepada penerima itu.',
        '"You entered or changed ... bank details": someone else in the team prepares payments to that payee.',
      ),
    ],
    notes: [NOT_TRANSFER],
    status: 'built',
  },
  {
    id: 'fin.payment.review',
    version: FIN_GUIDES_VERSION,
    for: ['fin_deputy', 'fin_leader', 'fd', 'ceo'],
    title: b('Semak bayaran', 'Review a payment'),
    purpose: b('Menyemak bayaran dengan dokumennya sebelum diluluskan.', 'Checks a payment against its papers before it is approved.'),
    where: b(
      'Finance > Payments > "Waiting for you" > buka baris > "Review" atau "Return"',
      'Finance > Payments > "Waiting for you" > open the row > "Review" or "Return"',
    ),
    fields: [
      {
        key: 'comment',
        label: b('Komen', 'Comment'),
        required: true,
        format: b(
          'Apa yang anda semak; pulangan perlu sebab (sekurang-kurangnya 10 huruf)',
          'What you checked; a return needs the reason (at least 10 characters)',
        ),
        example: 'Sama dengan invois SBP-7781 dan DO.',
      },
    ],
    sources: [b('Dokumen sokongan disenaraikan dalam bayaran itu.', 'The supporting documents listed on the payment.')],
    ask: [b('Penyedia bayaran (namanya dalam "Who did what").', 'The preparer (named under "Who did what").')],
    reused: [b('Penerima, akaun dan semakan pendua sudah dibuat oleh Prima.', 'Payee, account and the duplicate check are already done by Prima.')],
    steps: [
      b(
        'Anda tidak menyemak bayaran yang anda sediakan, atau kepada penerima yang butiran banknya anda masukkan.',
        'You never review a payment you prepared, or one to a payee whose bank details you entered.',
      ),
    ],
    done: b('Status "Reviewed", menunggu pelulus.', 'Status "Reviewed", waiting for the approver.'),
    recover: [
      b(
        'Butang tiada: langkah itu milik orang lain, atau langkah sebelumnya belum selesai.',
        'No button: the step belongs to someone else, or an earlier step is not done.',
      ),
    ],
    status: 'built',
  },
  {
    id: 'fin.payment.approve',
    version: FIN_GUIDES_VERSION,
    for: ['fd', 'ceo', 'coo'],
    title: b('Lulus atau pulangkan bayaran', 'Approve or return a payment'),
    purpose: b('Keputusan pelulus, dengan komen.', "The approver's decision, with a comment."),
    where: b(
      'Finance > Payments > buka baris > "Approve" atau "Return" (COO: skrin Finance, "Payments to approve")',
      'Finance > Payments > open the row > "Approve" or "Return" (COO: Finance screen, "Payments to approve")',
    ),
    fields: [
      {
        key: 'comment',
        label: b('Komen', 'Comment'),
        required: true,
        format: b('Wajib; pulangan perlu sebab (sekurang-kurangnya 10 huruf)', 'Required; a return needs the reason (at least 10 characters)'),
        example: 'Diluluskan mengikut bajet.',
      },
    ],
    sources: [b('Bayaran, dokumennya dan semakan penyemak.', "The payment, its papers and the reviewer's comment.")],
    ask: [b('Penyemak atau ketua pasukan Finance syarikat itu.', "The reviewer or the company's Finance team leader.")],
    reused: [
      b(
        'Bayaran yang diluluskan dalam Teams tidak diluluskan lagi dalam Prima (satu cara sahaja).',
        'A payment set to be approved in Teams is not approved again in Prima (one way only).',
      ),
    ],
    steps: [
      b(
        'FD atau CEO: bayaran Finance. COO atau CEO: Operasi, IT, FWM, Procurement & Inventory, Pengangkutan, Goodwill Empire.',
        'FD or CEO: Finance payments. COO or CEO: Operations, IT, FWM, Procurement & Inventory, Transport, Goodwill Empire.',
      ),
      b(
        'Tiada siapa meluluskan bayaran yang disediakan atau disemaknya sendiri; pelulus tidak merekod pelepasan.',
        'Nobody approves a payment they prepared or reviewed; the approver does not record the release.',
      ),
      b(
        'Kelulusan luput jika tidak dilepaskan dalam tempoh yang ditetapkan FD; ia dipulangkan kepada penyedia.',
        'An approval lapses if not released within the days the FD set; it goes back to the preparer.',
      ),
    ],
    done: b('Status "Approved".', 'Status "Approved".'),
    recover: [
      b(
        'Selepas lulus, bayaran tidak boleh diubah. Untuk mengubah, pulangkan jika ia sudah luput, atau batalkan.',
        'After approval a payment cannot be changed. To change it, return it once lapsed, or cancel it.',
      ),
    ],
    status: 'built',
  },
  {
    id: 'fin.payment.release',
    version: FIN_GUIDES_VERSION,
    for: ['fin_data_entry', 'fin_deputy', 'fin_leader'],
    title: b('Rekod pelepasan bayaran', 'Record the release'),
    purpose: b('Merekod bahawa pindahan telah dibuat dalam portal bank.', 'Records that the transfer was made in the bank portal.'),
    where: b('Finance > Payments > buka bayaran "Approved" > "Record release"', 'Finance > Payments > open an "Approved" payment > "Record release"'),
    fields: [
      {
        key: 'accountLast4',
        label: b('4 digit akhir yang ditunjukkan portal bank', 'Last 4 digits the bank portal shows'),
        required: true,
        format: b('4 digit', '4 digits'),
        example: '1000',
      },
      {
        key: 'accountName',
        label: b('Nama akaun yang ditunjukkan portal bank', 'Account name the bank portal shows'),
        required: true,
        format: b('Seperti dalam portal', 'As in the portal'),
        example: 'SYARIKAT BEKALAN PEJABAT',
      },
      {
        key: 'bankRef',
        label: b('Rujukan bank', "The bank's reference"),
        required: true,
        format: b('4 hingga 60 huruf, daripada portal bank', '4 to 60 characters, from the bank portal'),
        example: 'M2U-20261103-55',
      },
    ],
    sources: [b('Skrin pengesahan portal bank.', "The bank portal's confirmation screen.")],
    ask: [
      b(
        'Butiran tidak sama: berhenti; ketua pasukan menyemak penerima dengan panggilan balik.',
        'Details differ: stop; the team leader re-checks the payee by call-back.',
      ),
    ],
    reused: [b('Butiran bank penerima yang disahkan; Prima membandingkannya.', "The payee's verified bank details; Prima compares them.")],
    steps: [b('Penyedia dan pelulus tidak merekod pelepasan.', 'The preparer and the approver do not record the release.')],
    done: b('Status "Released"; Prima memadankannya dengan penyata bank kemudian.', 'Status "Released"; Prima matches it to the bank statement later.'),
    recover: [b('"The approval lapsed": pulangkan untuk kelulusan baharu.', '"The approval lapsed": return it for a fresh approval.')],
    notes: [NOT_TRANSFER],
    status: 'built',
  },
  {
    id: 'fin.request.create',
    version: FIN_GUIDES_VERSION,
    for: ['company_head'],
    title: b('Buat permintaan bayaran', 'Make a payment request'),
    purpose: b(
      'Ketua syarikat meminta bayaran (contoh: gaji pengawal kerajaan) melalui rantaian kelulusan.',
      'The company head asks for a payment (for example government guard salary) through the approval chain.',
    ),
    where: b('Payment requests > "New payment request"', 'Payment requests > "New payment request"'),
    fields: [
      {
        key: 'subject',
        label: b('Untuk apa', 'What it is for'),
        required: true,
        format: b('Menentukan ketua jabatan dan pelulus', 'Decides the department head and the approver'),
        example: 'operations',
      },
      {
        key: 'sector',
        label: b('Tapak', 'Sites'),
        required: true,
        format: b(
          'Operasi sahaja: kerajaan (OGM lulus) atau swasta (Pengarah Operasi lulus)',
          'Operations only: government (the OGM approves) or private (the Operations Director approves)',
        ),
        example: 'government',
      },
      {
        key: 'title',
        label: b('Bayaran apa', 'What the payment is'),
        required: true,
        format: b('3 hingga 160 huruf', '3 to 160 characters'),
        example: 'Gaji pengawal Oktober, tapak kerajaan (contoh)',
      },
      {
        key: 'purpose',
        label: b('Sebab ia diperlukan', 'Why it is needed'),
        required: true,
        format: b('10 hingga 1,000 huruf', '10 to 1,000 characters'),
        example: 'Gaji bulanan pengawal di tapak kerajaan (contoh).',
      },
      { key: 'amount', label: b('Amaun (RM)', 'Amount (RM)'), required: true, format: b('Lebih RM0.00', 'More than RM0.00'), example: 48250 },
      {
        key: 'calc',
        label: b('Cara amaun dikira', 'How the amount was worked out'),
        required: true,
        format: b('Finance menyemaknya; 5 hingga 2,000 huruf', 'Finance checks it; 5 to 2,000 characters'),
        example: '25 pengawal x RM1,700 + OT RM5,750 (eksport JA, contoh)',
      },
      {
        key: 'payee',
        label: b('Siapa dibayar', 'Who is paid'),
        required: true,
        format: b('2 hingga 160 huruf', '2 to 160 characters'),
        example: 'Gaji pengawal (fail gaji bank)',
      },
      { key: 'dueOn', label: b('Perlu pada', 'Needed by'), required: true, format: b('Tarikh', 'Date'), example: '2026-11-07' },
      {
        key: 'evidence',
        label: b('Dokumen sokongan', 'Supporting documents'),
        required: true,
        format: b('1 hingga 10, satu baris setiap satu', '1 to 10, one per line'),
        example: ['eksport-gaji-JA-okt (contoh).pdf'],
      },
    ],
    sources: [b('Pengiraan gaji pengawal: eksport gaji daripada aplikasi JA Group.', 'Guard salary workings: the payroll export from the JA Group app.')],
    ask: [
      b(
        'Pengiraan dipersoalkan: ketua atau timbalan pasukan Finance syarikat anda.',
        "A question on the calculation: your company's Finance team leader or deputy.",
      ),
    ],
    reused: [
      b(
        'Selepas diluluskan, Finance membayar dengan kelulusan itu; tiada kelulusan kedua.',
        'Once approved, Finance pays with that approval; there is no second approval.',
      ),
    ],
    steps: [
      b(
        'Ketua jabatan lulus, Finance semak pengiraan, kemudian COO (atau FD untuk Finance) atau CEO lulus. Setiap orang bertindak sekali.',
        'The department head approves, Finance checks the calculation, then the COO (or the FD for Finance) or the CEO approves. Each person acts once.',
      ),
      b(
        'Jika dipulangkan: tekan "Edit" pada baris itu, betulkan, tambah dokumen, "Save and resubmit". Rantaian bermula semula; dokumen lama kekal.',
        'If returned: press "Edit" on its row, correct it, add documents, "Save and resubmit". The chain starts again; earlier documents stay.',
      ),
    ],
    done: b('Status "Approved", kemudian nombor bayaran Finance.', 'Status "Approved", then the Finance payment number.'),
    recover: [
      b(
        'Selepas diluluskan permintaan tidak boleh diubah; batalkan dan buat yang baharu jika perlu.',
        'After approval a request cannot be changed; cancel it and make a new one if needed.',
      ),
    ],
    status: 'built',
  },
  {
    id: 'fin.request.check',
    version: FIN_GUIDES_VERSION,
    for: ['dept_head', 'fin_deputy', 'fin_leader', 'fd', 'ceo', 'coo'],
    title: b('Semak atau lulus permintaan bayaran', 'Check or approve a payment request'),
    purpose: b(
      'Langkah anda dalam rantaian: ketua jabatan, semakan pengiraan Finance, atau kelulusan akhir.',
      'Your step in the chain: department head, Finance calculation check, or final approval.',
    ),
    where: b(
      'Payment requests > "Waiting for you" > buka > butang langkah anda atau "Return"',
      'Payment requests > "Waiting for you" > open > your step\'s button or "Return"',
    ),
    fields: [
      {
        key: 'comment',
        label: b('Komen', 'Comment'),
        required: true,
        format: b('Setiap langkah perlu komen; pulangan perlu sebab', 'Every step needs one; a return needs the reason'),
        example: 'Bilangan pengawal sama dengan jadual.',
      },
    ],
    sources: [b('Pengiraan dan dokumen dalam permintaan.', 'The calculation and documents on the request.')],
    ask: [b('Ketua syarikat yang membuat permintaan.', 'The company head who made the request.')],
    reused: [b('Sejarah setiap langkah dan komen kekal pada permintaan.', 'Every step and comment stays on the request.')],
    steps: [b('Pembuat permintaan tidak meluluskannya; tiada langkah boleh dilangkau.', 'The requester never approves it; no step can be skipped.')],
    done: b('Permintaan bergerak ke langkah seterusnya.', 'The request moves to the next step.'),
    recover: [b('Butang tiada: bukan giliran anda, atau anda sudah bertindak sekali.', 'No button: not your turn, or you already acted once.')],
    status: 'built',
  },
  {
    id: 'fin.dailycash.list',
    version: FIN_GUIDES_VERSION,
    for: ['fin_data_entry', 'fin_deputy', 'fin_leader'],
    title: b('Senarai bayaran tunai harian', 'Daily cash pay list'),
    purpose: b(
      'Pekerja yang dibayar setiap hari, disenaraikan untuk seminggu atau sebulan. Bayaran ke akaun bank atau e-dompet sahaja; tunai hanya jika Pejabat Pengarah menyenaraikan dan COO atau CEO meluluskan.',
      'Workers paid each day, listed for a week or a month. Paid to a bank account or e-wallet only; cash only when the Director Office lists them and the COO or CEO gives it.',
    ),
    where: b(
      'Finance > Checks > pilih syarikat > Paying out > Daily cash pay > "New list"',
      'Finance > Checks > choose the company > Paying out > Daily cash pay > "New list"',
    ),
    fields: [
      { key: 'period', label: b('Minggu atau bulan', 'Week or month'), required: true, format: b('week atau month', 'week or month'), example: 'week' },
      { key: 'from', label: b('Hari pertama', 'First day'), required: true, format: b('Tarikh', 'Date'), example: '2026-10-29' },
      {
        key: 'to',
        label: b('Hari terakhir', 'Last day'),
        required: true,
        format: b('Seminggu: hingga 7 hari; sebulan: hingga 31', 'Week: up to 7 days; month: up to 31'),
        example: '2026-11-04',
      },
      {
        key: 'bankId',
        label: b('Akaun bank', 'Bank account'),
        required: true,
        format: b('Akaun syarikat tunai diambil', 'The company account the cash comes from'),
        example: 'fb-co-09-1',
      },
      {
        key: 'purpose',
        label: b('Kenapa dibayar tunai', 'Why they are paid in cash'),
        required: true,
        format: b('Ayat pendek', 'A short sentence'),
        example: 'Pekerja tuaian dibayar tunai setiap hari (contoh)',
      },
      {
        key: 'people',
        label: b('Orang dan hari', 'People and days'),
        required: true,
        format: b(
          'Nama; 4 aksara akhir IC atau pasport; kerja; kadar harian; tandakan hari bekerja setiap orang',
          "Name; last 4 of IC or passport; work; daily rate; tick each person's working days",
        ),
        example: [
          {
            name: 'Ali bin Abu (contoh)',
            idLast4: '1234',
            work: 'Tuaian dusun',
            dailyRate: 120,
            days: ['2026-10-29', '2026-10-30'],
            pay: 'bank',
            account: { bank: 'Maybank', last4: '6789', holder: 'own' },
          },
        ],
      },
      {
        key: 'pay',
        label: b('Cara bayaran setiap orang', 'How each person is paid'),
        required: true,
        format: b(
          'bank atau ewallet: nama bank atau e-dompet dan 4 digit akhir sahaja. cash: hanya jika Pejabat Pengarah menyenaraikan dan COO atau CEO meluluskan',
          'bank or ewallet: the bank or e-wallet name and the last 4 digits only. cash: only when the Director Office lists them and the COO or CEO gives it',
        ),
        example: 'bank',
      },
      {
        key: 'account.holder',
        label: b('Akaun siapa', 'Whose account'),
        required: true,
        format: b(
          "own, joint, relative atau friend. Akaun saudara atau kawan: surat persetujuan yang dicop Pesuruhjaya Sumpah (nama, no. cop, tarikh), diluluskan oleh COO",
          "own, joint, relative or friend. A relative's or friend's account: the consent letter stamped by a Pesuruhjaya Sumpah (name, stamp no., date), approved by the COO",
        ),
        example: 'own',
      },
    ],
    sources: [b('Senarai pekerja dan hari: daripada penyelia tapak yang menggunakan mereka.', 'Workers and days: from the site supervisor who uses them.')],
    ask: [b('Hari atau kadar dipersoalkan: penyelia tapak, kemudian FD.', 'Days or rate in question: the site supervisor, then the FD.')],
    reused: [b('Selepas lulus, tunai disediakan hingga jumlah yang diluluskan sahaja.', 'After approval the cash is prepared up to the approved total only.')],
    steps: [
      b(
        'Orang yang minta tunai: pilih "cash". Pejabat Pengarah menyenaraikan dengan tapak, jumlah tunai dan sebab; COO atau CEO memutuskan. Jika ditolak, beri akaun bank atau e-dompet. Pejabat Pengarah memuat naik setiap resit bertandatangan; senarai diselesaikan selepas itu sahaja.',
        'Someone who asks for cash: choose "cash". The Director Office lists them with the site, the cash amount and the reason; the COO or CEO decides. If refused, give a bank account or e-wallet. The Director Office uploads each signed receipt; the list is settled only after that.',
      ),
      b('"Send to the FD". Hanya FD meluluskan (bukan CEO, bukan penyedia).', '"Send to the FD". Only the FD approves (not the CEO, never the preparer).'),
      b(
        'FD tidak boleh meluluskan selagi ada orang tanpa akaun, tunai belum diputuskan, atau surat persetujuan belum diluluskan COO.',
        'The FD cannot approve while anyone has no account, a cash decision is open, or a consent letter waits for the COO.',
      ),
      b(
        'Selepas lulus, bank atau e-dompet: "Paid by transfer" untuk setiap hari bekerja, dengan rujukan pindahan. Senarai tanpa tunai ditutup dengan "Close list" selepas tamat.',
        'After approval, bank or e-wallet: "Paid by transfer" for each worked day, with the transfer reference. A list with no cash is closed with "Close list" once it ends.',
      ),
      b(
        'Jika FD memulangkan: "Edit (returned by the FD)", ubah orang atau hari, "Save changes", hantar semula. Sejarah kekal.',
        'If the FD returns it: "Edit (returned by the FD)", change people or days, "Save changes", send again. The history stays.',
      ),
      b(
        'Tunai (hanya orang yang diberi tunai): "Cash withdrawn", "Hand to COO / CEO". FD yang meluluskan tidak memegang tunai.',
        'Cash (only the people given cash): "Cash withdrawn", "Hand to COO / CEO". The FD who approved never handles the cash.',
      ),
      b(
        'Tunai yang dipulangkan dikira oleh orang lain dalam Finance, bukan yang mengeluarkan atau menyerahkannya: "Count and bank".',
        'Cash given back is counted by someone else in Finance, not whoever withdrew or handed it over: "Count and bank".',
      ),
    ],
    done: b('Status "Settled", pengeluaran dijumpai pada penyata bank.', 'Status "Settled", the withdrawal found on the bank statement.'),
    recover: [b('Beza kiraan: nyatakan sebab; FD menerima beza itu.', 'A count difference: give the reason; the FD accepts the difference.')],
    status: 'built',
  },
  {
    id: 'fin.dailycash.collector',
    version: FIN_GUIDES_VERSION,
    for: ['ceo', 'coo'],
    title: b('Pegang dan bayar tunai harian', 'Hold and pay the daily cash'),
    purpose: b(
      'COO atau CEO mengira tunai yang diserahkan, membayar orang tersenarai, dan memulangkan baki.',
      'The COO or CEO counts the cash handed over, pays the listed people and gives back the rest.',
    ),
    where: b('Finance > "Daily cash you hold"', 'Finance > "Daily cash you hold"'),
    fields: [
      {
        key: 'counted',
        label: b('Tunai dikira (RM)', 'Cash counted (RM)'),
        required: true,
        format: b('RM; jika berbeza, nyatakan sebab', 'RM; if it differs, give the reason'),
        example: 1060,
      },
      {
        key: 'idLast4',
        label: b('4 aksara akhir IC atau pasport', 'Last 4 of IC or passport'),
        required: true,
        format: b('Semak dengan kad pekerja', "Check against the worker's card"),
        example: '1234',
      },
      {
        key: 'proof',
        label: b('Helaian bayaran', 'Pay sheet'),
        required: false,
        format: b(
          'Pilihan: nombor helaian. Resit bertandatangan diserahkan kepada Pejabat Pengarah, yang memuat naiknya',
          'Optional: the sheet number. The signed receipt goes to the Director Office, who uploads it',
        ),
        example: 'Helaian 1 (contoh)',
      },
    ],
    sources: [b('Senarai yang diluluskan FD, ditunjukkan dalam Prima.', 'The list the FD approved, shown in Prima.')],
    ask: [b('Wang kurang atau lebih: Finance yang menyerahkannya, kemudian FD.', 'Cash short or over: the Finance person who handed it over, then the FD.')],
    reused: [b('Hanya orang dan hari dalam senarai; kadar harian daripada senarai.', 'Only listed people and days; the daily rate comes from the list.')],
    steps: [
      b(
        '"Confirm count", bayar setiap orang setiap hari ("Paid"), kemudian "Give back" baki.',
        '"Confirm count", pay each person each day ("Paid"), then "Give back" the rest.',
      ),
    ],
    done: b('Baki dipulangkan; Finance mengira dan memasukkannya ke bank.', 'The rest given back; Finance counts and banks it.'),
    recover: [b('Butang "Confirm count" tidak aktif: tulis sebab beza kiraan.', '"Confirm count" disabled: write why the count differs.')],
    status: 'built',
  },
];

/** The guide roles of a person, from the same checks the Finance services use. */
export function finGuideRoles(user: User): FinGuideRole[] {
  if (user.integration) return [];
  const out = new Set<FinGuideRole>();
  const a = finActor(user);
  if (a?.kind === 'data_entry') out.add('fin_data_entry');
  if (a?.kind === 'deputy') out.add('fin_deputy');
  if (a?.kind === 'leader') out.add('fin_leader');
  if (a?.kind === 'director') out.add('fd');
  if (a?.kind === 'ceo') out.add('ceo');
  if (user.opsTier === 'coo' && user.role === 'pwvsb_officer') out.add('coo');
  if (user.role === 'company_manager') out.add('company_head');
  const subjects = ['operations', 'inventory', 'it', 'fwm', 'transport'] as const;
  if (subjects.some((subject) => finRequestHeadFits(user, { subject, sector: 'government' }) || finRequestHeadFits(user, { subject, sector: 'private' })))
    out.add('dept_head');
  return [...out];
}

/** The cards this person may see (role-scoped; Arisha gets the same list). */
export function finGuidesFor(user: User): FinGuide[] {
  const roles = finGuideRoles(user);
  return FIN_GUIDES.filter((g) => g.for.some((r) => roles.includes(r)));
}

/** Plain text of the cards for Arisha, in the person's language. */
export function finGuidesText(user: User, lang: 'ms' | 'en' | 'mix'): string {
  const pick = (t: FinText) => (lang === 'en' ? t.en : lang === 'ms' ? t.ms : `${t.ms} / ${t.en}`);
  return finGuidesFor(user)
    .map((g) =>
      [
        `${pick(g.title)} [${g.id} v${g.version}${g.status === 'built' ? '' : ', NOT BUILT'}]`,
        `- ${pick(g.purpose)}`,
        `- ${pick(g.where)}`,
        ...g.fields.map((f) => `- ${pick(f.label)}${f.required ? '' : ' (optional)'}: ${pick(f.format)}`),
        ...g.sources.map((x) => `- Source: ${pick(x)}`),
        ...g.ask.map((x) => `- Ask: ${pick(x)}`),
        ...g.reused.map((x) => `- Reused: ${pick(x)}`),
        ...g.steps.map((x) => `- ${pick(x)}`),
        `- Done: ${pick(g.done)}`,
        ...g.recover.map((x) => `- If refused: ${pick(x)}`),
        ...(g.notes ?? []).map((x) => `- Note: ${pick(x)}`),
      ].join('\n'),
    )
    .join('\n\n');
}

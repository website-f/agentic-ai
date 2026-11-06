import type { User } from './types';
import { isGroupLeader, isOwnerAdmin } from './access';
import { isCompanySecretary, isCorpAdminOwner } from './central-admin';

/**
 * In-app guide cards for the Central Admin tasks (Arisha main review, 2 Nov 2026, section A). Deterministic and
 * read-only: a card explains the screen, the fields, where the source paper is and whom to ask. It never saves,
 * approves, lodges or pays, and it opens nothing the person's own role does not already open. Bahasa Melayu first,
 * with matching English. Arisha gets the same versioned, role-scoped cards, so her answer matches the screen.
 *
 * Accuracy: every button and field named here is checked against the current screens and service. "Ask" names a
 * desk or role, never a person. Anything not built or not verified says so in `limits`.
 */
export const CENTRAL_ADMIN_GUIDE_VERSION = 'central-admin-guide 2026-11-03.1';

export type GuideRoleKey =
  | 'company_manager'
  | 'admin_exec'
  | 'corp_owner'
  | 'legal'
  | 'credit_officer'
  | 'director_office'
  | 'task_owner'
  | 'director'
  | 'finance_director'
  | 'delegation_lead'
  /** P78: the owner, signed in as the CEO record, does the maker steps of every module. */
  | 'owner_admin';
type T = { ms: string; en: string };
export interface GuideField {
  name: T;
  required: boolean;
  format: T;
  example: string;
}
export interface GuideCard {
  id: string;
  roles: GuideRoleKey[];
  view: 'corporate' | 'renewals' | 'credit' | 'doa' | 'requests' | 'work';
  tab?: string;
  title: T;
  purpose: T;
  responsible: T;
  where: T;
  fields: GuideField[];
  source: T;
  ask: T;
  reuse: T;
  steps: T[];
  returned: T;
  evidence: T;
  recover: T;
  limits: T;
}

const t = (ms: string, en: string): T => ({ ms, en });
const f = (ms: string, en: string, required: boolean, fms: string, fen: string, example: string): GuideField => ({
  name: t(ms, en),
  required,
  format: t(fms, fen),
  example,
});
const DATE = [
  'Tarikh sebenar (hh/bb/tttt). Tarikh mustahil seperti 31 Feb ditolak.',
  'A real date (dd/mm/yyyy). Impossible dates such as 31 Feb are refused.',
] as const;

export const CENTRAL_ADMIN_GUIDE: GuideCard[] = [
  {
    id: 'company-file-draft',
    roles: ['company_manager', 'corp_owner', 'owner_admin'],
    view: 'corporate',
    tab: 'files',
    title: t('Fail syarikat: sediakan draf', 'Company file: prepare the draft'),
    purpose: t(
      'Satu rekod korporat bagi setiap syarikat: pengarah, pemegang saham, pemilik benefisial, perlembagaan dan kertas utama.',
      'One corporate record per company: directors, shareholders, beneficial owners, constitution and key papers.',
    ),
    responsible: t('Ketua Syarikat (pengurus syarikat) atau Timbalan Ketua Staf.', 'The Head of Company (company manager) or the Deputy Chief of Staff.'),
    where: t(
      'Setiausaha syarikat > tab Fail syarikat > "Open and edit" > "Save as draft".',
      'Company secretary > Company files tab > "Open and edit" > "Save as draft".',
    ),
    fields: [
      f('Pengarah dan tarikh dilantik', 'Directors and appointment date', true, DATE[0], DATE[1], 'Director X (mock), 01/01/2020'),
      f(
        'Pemegang saham, bilangan saham, sejak',
        'Shareholders, shares, since',
        false,
        'Nama, jenis, nombor bulat, tarikh',
        'Name, kind, whole number, date',
        'Holding company (mock), 1000, 01/01/2020',
      ),
      f(
        'Pemilik benefisial: asas, sejak, tarikh SSM dimaklumkan',
        'Beneficial owners: basis, since, SSM notified on',
        false,
        'Tarikh dimaklumkan tidak boleh sebelum perubahan',
        'Notified date cannot be before the change',
        'Owner Y (mock), over 25% of shares, 01/01/2020, 10/01/2020',
      ),
      f(
        'Rujukan perlembagaan dan tarikh diterima pakai',
        'Constitution reference and adopted on',
        false,
        'Teks pendek, tarikh',
        'Short text, date',
        'CONST-1 (mock)',
      ),
      f('Kertas utama: nama, rujukan, tarikh', 'Key papers: name, reference, dated', false, 'Teks, tarikh', 'Text, date', 'Board resolution, BR-1 (mock)'),
    ],
    source: t(
      'Cabutan atau profil SSM terkini dan daftar ahli, yang disimpan oleh setiausaha syarikat. Nama syarikat dan nombor SSM diambil dari rekod syarikat; tidak perlu taip lagi.',
      'The latest SSM extract or profile and the register of members, kept by the company secretary. The company name and SSM number come from the company record; do not key them again.',
    ),
    ask: t(
      'Setiausaha syarikat untuk cabutan SSM; Timbalan Ketua Staf (Pentadbiran Korporat) untuk soalan rekod.',
      'The company secretary for the SSM extract; the Deputy Chief of Staff (Corporate Admin) for record questions.',
    ),
    reuse: t(
      'Perubahan yang diluluskan dan direkod oleh lembaga ditunjukkan di sini sebagai "Update the file after". Jangan buat rekod baharu.',
      'Changes the board approved and recorded show here as "Update the file after". Do not start a new record.',
    ),
    steps: [
      t('Buka fail syarikat anda dan isi atau betulkan baris.', 'Open your company file and fill in or correct the rows.'),
      t('Tekan "Save as draft". Status menjadi draf, menunggu semakan SSM.', 'Press "Save as draft". The status becomes a draft waiting for the SSM check.'),
      t(
        'Timbalan Ketua Staf menyemak dengan cabutan SSM; orang yang menyimpan draf tidak boleh menyemaknya sendiri.',
        'The Deputy Chief of Staff checks it against the SSM extract; whoever saved the draft cannot check it.',
      ),
    ],
    returned: t(
      'Jika dipulangkan, kad menunjukkan siapa memulangkan dan perbezaannya. Tekan "Fix and resubmit", betulkan, kemudian "Resubmit for the SSM check". Semakan terdahulu kekal di bawah "Earlier checks".',
      'If sent back, the card shows who sent it back and the differences. Press "Fix and resubmit", correct it, then "Resubmit for the SSM check". Earlier checks stay under "Earlier checks".',
    ),
    evidence: t(
      'Selesai apabila status "Checked" dengan rujukan cabutan SSM dan nama penyemak.',
      'Done when the status is "Checked" with the SSM extract reference and the checker’s name.',
    ),
    recover: t(
      'Jika simpanan ditolak, baca mesej merah: ia menamakan baris dan tarikh yang salah. Tiada apa disimpan sehingga semua betul.',
      'If a save is refused, read the red message: it names the row and date that is wrong. Nothing is saved until all is right.',
    ),
    limits: t('Aplikasi tidak memfailkan apa-apa dengan SSM; setiausaha yang memfailkan.', 'The app lodges nothing with SSM; the secretary lodges.'),
  },
  {
    id: 'company-file-check',
    roles: ['corp_owner'],
    view: 'corporate',
    tab: 'files',
    title: t('Fail syarikat: semak dengan SSM', 'Company file: check against SSM'),
    purpose: t('Sahkan draf fail syarikat sepadan dengan cabutan SSM.', 'Confirm the company file draft matches the SSM extract.'),
    responsible: t('Timbalan Ketua Staf, tidak pernah untuk draf sendiri.', 'The Deputy Chief of Staff, never on their own draft.'),
    where: t('Setiausaha syarikat > Fail syarikat > "Open" > "Check against SSM".', 'Company secretary > Company files > "Open" > "Check against SSM".'),
    fields: [
      f('Rujukan cabutan SSM', 'SSM extract reference', true, 'Teks pendek', 'Short text', 'EXTRACT-1 (mock)'),
      f('Sebab', 'Reason', true, 'Sekurang-kurangnya komen pendek untuk mengesahkan', 'At least a short comment to confirm', 'Matches the extract'),
      f(
        'Perbezaan',
        'Differences',
        false,
        'Satu perbezaan setiap baris; wajib jika dipulangkan',
        'One per line; needed to send back',
        'Director appointment date differs',
      ),
    ],
    source: t('Cabutan SSM terkini daripada setiausaha syarikat.', 'The latest SSM extract from the company secretary.'),
    ask: t('Setiausaha syarikat.', 'The company secretary.'),
    reuse: t(
      'Penyemak hanya merekod rujukan cabutan; tidak perlu muat naik semula fail syarikat.',
      'The checker records the extract reference only; the company file is not uploaded again.',
    ),
    steps: [
      t('Bandingkan setiap baris dengan cabutan.', 'Compare each row with the extract.'),
      t('Tekan "Matches SSM" dengan sebab, atau "Send back with differences".', 'Press "Matches SSM" with a reason, or "Send back with differences".'),
    ],
    returned: t(
      'Fail yang dipulangkan kembali kepada Ketua Syarikat untuk dibetulkan dan dihantar semula.',
      'A returned file goes back to the Head of Company to fix and resubmit.',
    ),
    evidence: t(
      'Rujukan cabutan, nama penyemak dan masa disimpan dalam log audit.',
      'The extract reference, the checker and the time are kept in the audit log.',
    ),
    recover: t(
      'Butang tiada? Anda yang menyimpan draf ini, jadi orang lain perlu menyemaknya.',
      'No button? You saved this draft, so someone else must check it.',
    ),
    limits: t('Tiada sambungan ke SSM; cabutan diperoleh di luar aplikasi.', 'No connection to SSM; the extract is obtained outside the app.'),
  },
  {
    id: 'renewal',
    roles: ['admin_exec', 'company_manager', 'corp_owner', 'owner_admin'],
    view: 'renewals',
    title: t('Pembaharuan lesen dan pendaftaran', 'Licence and registration renewal'),
    purpose: t(
      'Setiap syarikat memperbaharui lesennya sendiri; Pentadbiran Pusat memantau dan mengesahkan tarikh luput baharu.',
      'Each company renews its own licences; Central Admin monitors and confirms the new expiry.',
    ),
    responsible: t(
      'Eksekutif pentadbiran menyediakan; pengurus syarikat yang tidak menyediakan kertas menandatangani; Timbalan Ketua Staf mengesahkan.',
      'An admin executive prepares; a company manager who did not prepare the papers signs; the Deputy Chief of Staff confirms.',
    ),
    where: t(
      'Pembaharuan > pilih lesen > "Open renewal", tanda kertas, "Sign the application", "Record fee", "Record submission", "Record new certificate".',
      'Renewals > choose the licence > "Open renewal", tick the papers, "Sign the application", "Record fee", "Record submission", "Record new certificate".',
    ),
    fields: [
      f(
        'Kertas yang diminta agensi',
        'Papers the agency asks for',
        true,
        'Tanda setiap satu; "Add paper" untuk yang lain',
        'Tick each; "Add paper" for others',
        'IGP approval letters (mock)',
      ),
      f('Rujukan bayaran Kewangan dan yuran RM', 'Finance payment reference and fee RM', true, 'Teks, nombor', 'Text, number', 'FIN-PAY-0042 (mock), 1500'),
      f('Rujukan penghantaran', 'Submission reference', true, 'Teks', 'Text', 'KDN-ONLINE-1 (mock)'),
      f(
        'Tarikh luput baharu dan rujukan sijil',
        'New expiry and certificate reference',
        true,
        DATE[0] + ' Mesti selepas tarikh luput lama.',
        DATE[1] + ' Must be after the old expiry.',
        '31/12/2027, KDN/PA/1 (mock)',
      ),
    ],
    source: t(
      'Lesen dan sijil semasa dalam rekod lesen syarikat; surat agensi; resit bayaran daripada Kewangan.',
      'The current licence and certificate on the company’s licence record; agency letters; the payment receipt from Finance.',
    ),
    ask: t(
      'Pengurus syarikat untuk kertas syarikat; Kewangan untuk bayaran; Timbalan Ketua Staf untuk pengesahan.',
      'The company manager for company papers; Finance for the payment; the Deputy Chief of Staff for confirmation.',
    ),
    reuse: t(
      'Lesen sedia ada dibuka dari senarai; jangan cipta lesen baharu untuk pembaharuan.',
      'The existing licence opens from the list; do not create a new licence for a renewal.',
    ),
    steps: [
      t('Buka pembaharuan dan tanda setiap kertas.', 'Open the renewal and tick each paper.'),
      t('Pengurus lain menandatangani; rekod yuran dan penghantaran.', 'Another manager signs; record the fee and the submission.'),
      t(
        'Rekod sijil baharu; Timbalan Ketua Staf menekan "Confirm new expiry" atau "Query it".',
        'Record the new certificate; the Deputy Chief of Staff presses "Confirm new expiry" or "Query it".',
      ),
    ],
    returned: t(
      '"Send back" dengan nota apabila agensi menolak atau meminta lagi; betulkan dan hantar semula.',
      '"Send back" with a note when the agency refuses or asks for more; fix and submit again.',
    ),
    evidence: t(
      'Sijil baharu, rujukan bayaran dan pengesahan Pentadbiran Pusat dalam sejarah pembaharuan.',
      'The new certificate, the payment reference and Central Admin’s confirmation in the renewal history.',
    ),
    recover: t(
      'Butang tiada? Langkah itu milik orang lain atau langkah sebelumnya belum selesai.',
      'No button? The step belongs to someone else or an earlier step is not done.',
    ),
    limits: t('Aplikasi tidak menghantar apa-apa kepada agensi dan tidak membayar.', 'The app sends nothing to the agency and pays nothing.'),
  },
  {
    id: 'panel-firm',
    roles: ['corp_owner', 'legal', 'owner_admin'],
    view: 'corporate',
    tab: 'panel',
    title: t('Firma panel', 'Panel firms'),
    purpose: t(
      'Senarai firma audit, setiausaha dan guaman yang diluluskan, dengan semakan tahunan.',
      'The list of approved audit, secretary and law firms, with a yearly review.',
    ),
    responsible: t(
      'Timbalan Ketua Staf untuk firma audit dan setiausaha; Undang-undang PWVSB untuk firma guaman.',
      'The Deputy Chief of Staff for audit and secretary firms; PWVSB legal for law firms.',
    ),
    where: t(
      'Setiausaha syarikat > Firma panel > "Add firm", "Record review", "Take off the panel".',
      'Company secretary > Panel firms > "Add firm", "Record review", "Take off the panel".',
    ),
    fields: [
      f('Jenis firma', 'Kind of firm', true, 'Pilih dari senarai', 'Choose from the list', 'Audit firm'),
      f('Nama firma', 'Firm name', true, 'Sekurang-kurangnya 3 aksara', 'At least 3 characters', 'Audit firm 9 (mock)'),
      f('Nombor AF atau lesen', 'AF number or licence', true, 'Teks', 'Text', 'AF-9 (mock)'),
      f('Tarikh dilantik', 'Appointed on', true, DATE[0] + ' Bukan masa depan.', DATE[1] + ' Not in the future.', '10/01/2026'),
    ],
    source: t('Surat pelantikan firma dan sijil pendaftaran firma.', 'The firm’s appointment letter and registration certificate.'),
    ask: t('Timbalan Ketua Staf (audit, setiausaha) atau Undang-undang PWVSB (guaman).', 'The Deputy Chief of Staff (audit, secretary) or PWVSB legal (law).'),
    reuse: t(
      'Firma yang dikeluarkan kekal dalam rekod; jangan tambah semula firma yang sama.',
      'A removed firm stays on record; do not add the same firm again.',
    ),
    steps: [t('Tambah firma.', 'Add the firm.'), t('Setiap tahun, rekod semakan dengan nota.', 'Each year, record the review with a note.')],
    returned: t(
      'Tiada langkah pulangan; untuk membetulkan, keluarkan dengan sebab dan tambah rekod yang betul.',
      'No return step; to correct, take it off with a reason and add the right record.',
    ),
    evidence: t('Log audit untuk setiap tambah, semakan dan pengeluaran.', 'The audit log for every add, review and removal.'),
    recover: t(
      'Mesej "The panel list is not set up on this database yet" bermaksud jadual firma panel belum dipasang; audit disemak dengan senarai permulaan.',
      'The message "The panel list is not set up on this database yet" means the panel table is not installed; audits are checked against the starting list.',
    ),
    limits: t(
      'Jadual firma panel ialah modul cadangan yang belum dipasang di mana-mana pangkalan data.',
      'The panel table is a proposed module not installed in any database yet.',
    ),
  },
  {
    id: 'credit-loan',
    roles: ['credit_officer'],
    view: 'credit',
    title: t('Kredit PWVSB: rekod, setem dan pembetulan cagaran', 'PWVSB credit: record, stamping and collateral correction'),
    purpose: t(
      'Rekod pembiayaan PWVSB kepada syarikat kumpulan, bayaran balik, setem perjanjian dan rekod cagaran.',
      'Record PWVSB financing to a group company, repayments, agreement stamping and the collateral record.',
    ),
    responsible: t('Pegawai kredit.', 'The credit officer.'),
    where: t(
      'Kredit PWVSB > "Record new financing"; dalam pinjaman: "Record repayment", "Agreement stamped", "Correct collateral record", "Correct stamping, charge or signing date".',
      'PWVSB credit > "Record new financing"; inside a loan: "Record repayment", "Agreement stamped", "Correct collateral record", "Correct stamping, charge or signing date".',
    ),
    fields: [
      f('Rujukan perjanjian ditandatangani', 'Signed agreement reference', true, 'Teks', 'Text', 'AGR-1 (mock)'),
      f('Tarikh mula', 'Start date', true, DATE[0], DATE[1], '15/09/2026'),
      f(
        'Tarikh tandatangan (jika ada)',
        'Signed on (if known)',
        false,
        'Tarikh; boleh sebelum atau selepas tarikh mula',
        'Date; may be before or after the start date',
        '10/09/2026',
      ),
      f(
        'Rujukan perjanjian cagaran',
        'Collateral agreement reference',
        false,
        'Wajib kecuali cagaran "None"',
        'Needed unless collateral is "None"',
        'BIA-1 (mock)',
      ),
      f('Nombor sijil setem dan tarikh', 'Stamp certificate number and date', false, DATE[0], DATE[1], 'ST-1 (mock)'),
      f('Sebab pembetulan', 'Reason for correction', true, 'Sekurang-kurangnya 5 aksara', 'At least 5 characters', 'Signed copy found in the PWVSB file'),
    ],
    source: t(
      'Perjanjian yang ditandatangani dan perjanjian cagaran dalam fail PWVSB; sijil setem; penyata bank daripada Kewangan.',
      'The signed agreement and collateral agreement in the PWVSB file; the stamp certificate; the bank statement from Finance.',
    ),
    ask: t('Kewangan untuk penyata bank; Undang-undang PWVSB untuk perjanjian.', 'Finance for the bank statement; PWVSB legal for agreements.'),
    reuse: t(
      'Untuk rujukan cagaran yang tiada atau salah, guna "Correct collateral record". Untuk setem, caj SSM atau tarikh tandatangan yang salah, guna "Correct stamping, charge or signing date". Jangan rekod pinjaman semula.',
      'For a missing or wrong collateral reference, use "Correct collateral record". For a wrong stamp, SSM charge or signing date, use "Correct stamping, charge or signing date". Do not record the loan again.',
    ),
    steps: [
      t('Rekod pembiayaan dengan perjanjian yang ditandatangani.', 'Record the financing with the signed agreement.'),
      t('Rekod setem apabila sijil diterima.', 'Record stamping when the certificate is back.'),
      t('Betulkan rekod cagaran dengan sebab; nilai lama dan baharu kekal.', 'Correct the collateral record with a reason; old and new values are kept.'),
      t(
        'Setem atau caj yang tersalah rekod: betulkan atau kosongkan dengan sebab; 30 hari setem dikira dari tarikh tandatangan jika direkod, jika tidak dari tarikh mula.',
        'A stamp or charge recorded wrongly: correct it or clear it with a reason; the 30 stamping days count from the signing date when recorded, otherwise from the start date.',
      ),
    ],
    returned: t(
      'Pembetulan dipaparkan di bawah "Corrections" dengan masa, nama dan sebab.',
      'Corrections show under "Corrections" with the time, name and reason.',
    ),
    evidence: t(
      'Log audit "credit.collateral.correct" dan sejarah pembetulan pada pinjaman.',
      'The audit entry "credit.collateral.correct" and the corrections list on the loan.',
    ),
    recover: t(
      '"Nothing changed" bermaksud nilai sama; semak jenis dan rujukan.',
      '"Nothing changed" means the values are the same; check the kind and reference.',
    ),
    limits: t(
      'Pembetulan tidak mengubah jumlah, kadar atau jadual. Aplikasi tidak memindahkan wang.',
      'A correction never changes the amount, rate or schedule. The app moves no money.',
    ),
  },
  {
    id: 'director-office-lists',
    roles: ['director_office'],
    view: 'doa',
    title: t('Pejabat Pengarah: senarai laporan, mesyuarat dan arahan CEO', 'Director Office: reports, meetings and CEO instructions'),
    purpose: t(
      'Senaraikan laporan dan mesyuarat, berulang atau sekali, dan jejak arahan CEO hingga selesai.',
      'List reports and meetings, recurring or one time, and track CEO instructions to done.',
    ),
    responsible: t('Pentadbir Pejabat Pengarah.', 'The Director Office Administrator.'),
    where: t('Pejabat Pengarah > laporan, mesyuarat dan arahan CEO.', 'Director Office > reports, meetings and CEO instructions.'),
    fields: [
      f(
        'Kekerapan',
        'Frequency',
        true,
        'Mingguan, 2 minggu, bulanan, suku tahun, tahunan, sekali',
        'Weekly, fortnightly, monthly, quarterly, yearly, once',
        'Monthly',
      ),
      f('Tarikh akhir untuk laporan sekali', 'Due date for a one-time report', true, DATE[0], DATE[1], '31/12/2026'),
      f(
        'Arahan: pemilik, maksud selesai, tarikh akhir',
        'Instruction: owner, done means, due',
        true,
        'Teks, tarikh dan masa',
        'Text, date and time',
        'Client letter of closure on file',
      ),
    ],
    source: t('Arahan CEO secara lisan atau bertulis; kalendar mesyuarat.', 'The CEO’s spoken or written instruction; the meeting calendar.'),
    ask: t('CEO atau Ketua Staf.', 'The CEO or the Chief of Staff.'),
    reuse: t(
      'Arahan CEO masuk ke senarai tugas pemilik; tidak perlu emel berasingan.',
      'A CEO instruction lands in the owner’s task list; no separate email is needed.',
    ),
    steps: [
      t('Simpan senarai dengan sebab.', 'Save the list with a reason.'),
      t('CEO menerima hasil arahan dengan sebab.', 'The CEO accepts an instruction’s result with a reason.'),
    ],
    returned: t(
      'CEO boleh memulangkan hasil dengan sebab; pemilik menyelesaikan semula dengan bukti.',
      'The CEO can send a result back with a reason; the owner finishes again with proof.',
    ),
    evidence: t(
      'Bukti dan nota pemilik pada tugas; keputusan CEO dalam log audit.',
      'The owner’s proof and note on the task; the CEO’s decision in the audit log.',
    ),
    recover: t('Arahan untuk diri sendiri ditolak; pilih pemilik lain.', 'An instruction to yourself is refused; choose another owner.'),
    limits: t('Ringkasan mingguan dibina daripada apa yang dikunci masuk sahaja.', 'The weekly digest is built only from what is keyed in.'),
  },
  {
    id: 'task-finish',
    roles: ['task_owner'],
    view: 'work',
    title: t('Tugas saya: selesai dengan bukti', 'My tasks: finish with proof'),
    purpose: t('Selesaikan tugas atau arahan CEO yang diberikan kepada anda.', 'Finish a task or CEO instruction given to you.'),
    responsible: t('Pemilik tugas.', 'The task owner.'),
    where: t(
      'Kerja > tugas > "Finish with proof", "Ask for more time" atau "Stuck? Ask for help", kemudian "Send".',
      'Work > the task > "Finish with proof", "Ask for more time" or "Stuck? Ask for help", then "Send".',
    ),
    fields: [
      f('Nota', 'Note', true, 'Apa yang dibuat', 'What was done', 'Closure letter received'),
      f('Rujukan bukti', 'Proof reference', false, 'Rujukan dokumen', 'Document reference', 'LTR-1 (mock)'),
    ],
    source: t('Dokumen yang membuktikan "maksud selesai" pada tugas.', 'The document that proves the task’s "done means".'),
    ask: t(
      'Orang yang memberi tugas, atau pengurus anda melalui "Stuck? Ask for help".',
      'Whoever gave the task, or your manager through "Stuck? Ask for help".',
    ),
    reuse: t(
      'Rujuk dokumen sedia ada; jangan muat naik semula rekod yang sudah ada.',
      'Refer to the existing document; do not re-upload records that already exist.',
    ),
    steps: [t('Tekan "Finish with proof", isi nota dan rujukan, tekan "Send".', 'Press "Finish with proof", fill in the note and reference, press "Send".')],
    returned: t('Jika dipulangkan, tugas dibuka semula dengan sebab; selesaikan semula.', 'If sent back, the task reopens with the reason; finish it again.'),
    evidence: t('Tugas "accepted" oleh pemberi tugas dengan sebab.', 'The task is accepted by whoever gave it, with a reason.'),
    recover: t('Lewat? Minta masa tambahan sebelum tarikh akhir.', 'Late? Ask for more time before the due date.'),
    limits: t('Draf atau tugas tanpa bukti tidak pernah dikira sebagai selesai.', 'A draft or a task without proof never counts as done.'),
  },
  {
    id: 'legal-flags',
    roles: ['director'],
    view: 'doa',
    title: t('Bendera undang-undang (pengarah sahaja)', 'Legal flags (directors only)'),
    purpose: t(
      'Perkara undang-undang yang terbuka, dengan sumber, rekod terlibat, pengarah bertanggungjawab, status dan sejarah.',
      'Open legal points, with source, affected records, responsible director, status and history.',
    ),
    responsible: t('Pengarah yang dinamakan pada setiap bendera.', 'The director named on each flag.'),
    where: t('Pejabat Pengarah > Bendera undang-undang > "History".', 'Director Office > Legal flags > "History".'),
    fields: [],
    source: t('Rekod yang disenaraikan pada bendera.', 'The records listed on the flag.'),
    ask: t('Undang-undang PWVSB.', 'PWVSB legal.'),
    reuse: t(
      'Bendera ditutup apabila rekod yang menyelesaikannya dikunci masuk; tiada borang berasingan.',
      'A flag closes when the record that resolves it is keyed in; there is no separate form.',
    ),
    steps: [t('Baca bendera dan sejarahnya; minta pemilik rekod bertindak.', 'Read the flag and its history; ask the record owner to act.')],
    returned: t('Tiada.', 'None.'),
    evidence: t('Sejarah audit rekod yang terlibat.', 'The audit history of the affected records.'),
    recover: t('Bendera yang belum selesai kekal "Open"; ia tidak pernah dilabel patuh.', 'An unresolved flag stays "Open"; it is never labelled compliant.'),
    limits: t(
      'Pengarah bertanggungjawab untuk kredit adalah andaian sehingga disahkan.',
      'The responsible director for credit is an assumption until confirmed.',
    ),
  },
  {
    id: 'kpkt-check',
    roles: ['corp_owner'],
    view: 'credit',
    title: t('Semakan lesen KPKT untuk pinjaman PWVSB', 'KPKT licence check for PWVSB loans'),
    purpose: t(
      'Rekod bahawa lesen pemberi pinjam wang KPKT PWVSB disemak untuk setiap pinjaman (pelan induk §103).',
      'Record that PWVSB’s KPKT moneylending licence was checked for each loan (masterplan §103).',
    ),
    responsible: t('Timbalan Ketua Staf, dengan pengesahan peguam.', 'The Deputy Chief of Staff, with counsel’s confirmation.'),
    where: t('Kredit PWVSB > buka pinjaman > "Record licence check".', 'PWVSB credit > open a loan > "Record licence check".'),
    fields: [
      f('Nombor lesen KPKT', 'KPKT licence number', true, 'Teks', 'Text', 'KPKT-1 (mock)'),
      f('Sah sehingga', 'Valid to', true, DATE[0], DATE[1], '30/06/2027'),
      f('Cara disemak', 'How it was checked', true, 'Sekurang-kurangnya 5 aksara', 'At least 5 characters', 'Counsel confirmed the licence copy'),
    ],
    source: t('Salinan lesen KPKT PWVSB dan pengesahan peguam.', 'The copy of PWVSB’s KPKT licence and counsel’s confirmation.'),
    ask: t('Undang-undang PWVSB.', 'PWVSB legal.'),
    reuse: t(
      'Nombor dan tarikh semakan terakhir diisi semula untuk pinjaman seterusnya; semak dan rekod.',
      'The last check’s number and date are filled in again for the next loan; check and record.',
    ),
    steps: [
      t('Buka pinjaman, semak lesen dengan peguam.', 'Open the loan, check the licence with counsel.'),
      t('Isi nombor, tarikh sah dan cara disemak; tekan rekod.', 'Fill in the number, valid-to date and how it was checked; press record.'),
    ],
    returned: t(
      'Untuk membetulkan, rekod semakan baharu dengan sebab; yang lama kekal dalam log.',
      'To correct, record a new check with the reason; the old one stays in the log.',
    ),
    evidence: t('Log audit "credit.licence.check".', 'The audit log entry "credit.licence.check".'),
    recover: t(
      'Pinjaman tanpa semakan, atau lesen yang tamat sebelum tarikh pinjaman, hanya dipaparkan kepada pengarah; pegawai kredit tidak disekat.',
      'A loan without a check, or with a licence that ended before the loan date, shows only to the directors; the credit officer is not blocked.',
    ),
    limits: t(
      'Rekod lesen KPKT PWVSB belum dikunci masuk; tiada sambungan ke KPKT.',
      'PWVSB’s KPKT licence record is not keyed in yet; no connection to KPKT.',
    ),
  },
  {
    id: 'adviser-money',
    roles: ['corp_owner', 'legal', 'finance_director', 'owner_admin'],
    view: 'corporate',
    tab: 'panel',
    title: t('Bajet dan invois penasihat', 'Adviser budgets and invoices'),
    purpose: t(
      'Bajet tahunan bagi setiap firma audit, guaman dan setiausaha, dan invois firma audit dan setiausaha (pelan induk §126).',
      'A yearly budget for each audit, law and secretary firm, and the invoices of audit and secretary firms (masterplan §126).',
    ),
    responsible: t(
      'Penjaga senarai mencadang bajet dan merekod invois; Pengarah Kewangan bersetuju dengan bajet; orang lain menyemak setiap invois.',
      'The keeper of the list proposes budgets and records invoices; the Finance Director agrees budgets; someone else checks each invoice.',
    ),
    where: t(
      'Setiausaha syarikat > Firma panel > "Propose budget", "Agree budget", "Record invoice", "Pass to Finance", "Query".',
      'Company secretary > Panel firms > "Propose budget", "Agree budget", "Record invoice", "Pass to Finance", "Query".',
    ),
    fields: [
      f('Jumlah bajet', 'Budget amount', true, 'RM, lebih daripada sifar', 'RM, more than zero', '12000'),
      f('Asas bajet', 'What it is based on', true, 'Sekurang-kurangnya 5 aksara', 'At least 5 characters', 'Yearly audit fee (mock)'),
      f('Nombor invois', 'Invoice number', true, 'Unik bagi firma', 'Unique for the firm', 'INV-1 (mock)'),
      f('Tarikh invois', 'Invoice date', true, DATE[0] + ' Bukan masa depan.', DATE[1] + ' Not in the future.', '30/10/2026'),
      f('Jumlah invois', 'Invoice amount', true, 'RM, lebih daripada sifar', 'RM, more than zero', '800'),
    ],
    source: t('Surat pelantikan, invois firma.', 'The engagement letter and the firm’s invoice.'),
    ask: t('Kewangan untuk bayaran.', 'Finance for payment.'),
    reuse: t('Yuran guaman diambil daripada perkara undang-undang; jangan kunci masuk semula.', 'Law fees come from the legal matters; do not key them again.'),
    steps: [
      t('Cadang bajet tahun ini dengan asasnya.', 'Propose this year’s budget with its basis.'),
      t('Pengarah Kewangan bersetuju dengan sebab.', 'The Finance Director agrees with a reason.'),
      t(
        'Rekod setiap invois; orang lain menyerahkannya kepada Kewangan atau menanyakannya.',
        'Record each invoice; someone else passes it to Finance or queries it.',
      ),
    ],
    returned: t('Invois yang ditanya: betulkan dan hantar semula; semakan lama kekal.', 'A queried invoice: fix and send it again; earlier checks stay.'),
    evidence: t('Log audit "panel.money".', 'The audit log entries "panel.money".'),
    recover: t(
      'Lebih bajet dipaparkan kepada Pengarah Kewangan dan Timbalan Ketua Staf.',
      'Over budget shows to the Finance Director and the Deputy Chief of Staff.',
    ),
    limits: t('Prima tidak membayar; "Pass to Finance" hanya rekod.', 'Prima does not pay; "Pass to Finance" is a record only.'),
  },
  {
    id: 'delegations',
    roles: ['delegation_lead', 'company_manager'],
    view: 'corporate',
    tab: 'delegations',
    title: t('Daftar perwakilan kecemasan dan penggantian', 'Emergency delegation and succession register'),
    purpose: t(
      'Siapa bertindak bagi siapa, untuk apa, dari bila hingga bila, dan mengapa (pelan induk §243).',
      'Who acts for whom, on what, from when to when, and why (masterplan §243).',
    ),
    responsible: t(
      'CEO atau Ketua Staf untuk jawatan kumpulan; pengurus syarikat untuk jawatan syarikat; diluluskan oleh CEO atau Ketua Staf.',
      'The CEO or the Chief of Staff for group posts; the company manager for the company’s posts; approved by the CEO or the Chief of Staff.',
    ),
    where: t(
      'Setiausaha syarikat > Perwakilan > "Record delegation", "Approve", "End".',
      'Company secretary > Delegations > "Record delegation", "Approve", "End".',
    ),
    fields: [
      f('Jawatan', 'Post', true, 'Teks', 'Text', 'Company Manager'),
      f('Orang yang bertindak', 'Person who acts', true, 'Pilih dari senarai kakitangan', 'Choose from the staff list', 'General Manager (mock)'),
      f('Boleh bertindak atas', 'May act on', true, 'Sekurang-kurangnya 5 aksara', 'At least 5 characters', 'Day-to-day decisions'),
      f('Dari', 'From', true, DATE[0], DATE[1], '01/11/2026'),
      f('Hingga', 'To', false, 'Wajib untuk kecemasan dan cuti', 'Needed for emergency and leave cover', '30/11/2026'),
      f('Sebab', 'Why', true, 'Sekurang-kurangnya 5 aksara', 'At least 5 characters', 'Manager on medical leave'),
    ],
    source: t('Arahan bertulis CEO, Ketua Staf atau lembaga syarikat.', 'The written instruction of the CEO, the Chief of Staff or the company board.'),
    ask: t('Ketua Staf.', 'The Chief of Staff.'),
    reuse: t(
      'Garis yang tamat kekal dalam rekod; rekod garis baharu untuk tempoh baharu.',
      'An ended line stays on record; record a new line for a new period.',
    ),
    steps: [
      t('Rekod jawatan, orang yang bertindak, skop, tarikh dan sebab.', 'Record the post, who acts, the scope, dates and why.'),
      t(
        'CEO atau Ketua Staf meluluskan dengan sebab (bukan perekod, bukan orang yang bertindak).',
        'The CEO or the Chief of Staff approves with a reason (not the recorder, not the person who acts).',
      ),
      t('Tamatkan dengan sebab apabila tidak diperlukan.', 'End it with a reason when it is no longer needed.'),
    ],
    returned: t('Tiada pulangan; tamatkan dan rekod semula jika salah.', 'No return; end it and record again if wrong.'),
    evidence: t('Log audit "delegation".', 'The audit log entries "delegation".'),
    recover: t(
      'Mesej "The delegation register is not set up on this database yet" bermaksud modul daftar belum dipasang.',
      'The message "The delegation register is not set up on this database yet" means the register module is not installed.',
    ),
    limits: t(
      'Daftar sahaja: ia tidak memberi sesiapa akses atau hak kelulusan dalam Prima.',
      'A register only: it gives nobody access or approval rights in Prima.',
    ),
  },
];

/** The guide roles a person holds, from the same rules the service checks for each action. */
export function centralAdminGuideRoles(user: User): GuideRoleKey[] {
  if (user.integration) return [];
  const r = new Set<GuideRoleKey>(['task_owner']);
  if (user.role === 'company_manager') r.add('company_manager');
  if (user.role === 'admin_exec') r.add('admin_exec');
  if (isCorpAdminOwner(user)) r.add('corp_owner');
  if (user.role === 'pwvsb_officer' && user.department === 'legal') r.add('legal');
  if (user.creditOfficer) r.add('credit_officer');
  // The service's isDoa: the Director, or the Director Office (setReportDefs, ceoInstruct).
  if (user.role === 'director' || (user.role === 'pwvsb_officer' && user.department === 'director_office')) r.add('director_office');
  if (isGroupLeader(user)) r.add('director');
  if (user.leadership === 'finance_director') r.add('finance_director');
  // The service's delegationLead: the CEO or the Chief of Staff.
  if (user.opsTier === 'ceo' || user.leadership === 'cos') r.add('delegation_lead');
  if (isOwnerAdmin(user)) r.add('owner_admin');
  if (isCompanySecretary(user)) r.delete('task_owner');
  return [...r];
}

/** Only the cards for the roles this person holds; another role's card is never sent. */
export function centralAdminGuideFor(user: User, view?: string) {
  const roles = centralAdminGuideRoles(user);
  return {
    version: CENTRAL_ADMIN_GUIDE_VERSION,
    roles,
    cards: CENTRAL_ADMIN_GUIDE.filter((c) => c.roles.some((x) => roles.includes(x)) && (!view || c.view === view)),
  };
}

// ---------- The shared guide-card format (PR #56, packages/core/src/guide-cards.ts at 4989972) ----------
// The same cards, in the shape every department registers with registerGuideCards(), so Arisha reads one mapping
// through GET /api/org/guide. The shared module is not on this branch yet; the types below copy its shape exactly.
// When both are merged, the only change is: import { registerGuideCards } from './guide-cards';
// registerGuideCards(CENTRAL_ADMIN_GUIDE_SPECS);

type SharedText = { bm: string; en: string };
/** A copy of the hand-over desks in org-links.ts (PR #56). */
export type SharedOrgDesk =
  | 'hr'
  | 'it'
  | 'finance'
  | 'fwm'
  | 'procurement'
  | 'asset'
  | 'legal'
  | 'pdpa'
  | 'cms'
  | 'transport'
  | 'chief_of_staff'
  | 'director_office'
  | 'act'
  | 'company_office'
  | 'coo'
  | 'ceo';
export interface SharedGuideCardSpec {
  id: string;
  status: 'ready' | 'partial' | 'not_built';
  dept: string;
  title: SharedText;
  purpose: SharedText;
  who: SharedText;
  screen: { view: string | null; name: string; action: SharedText };
  fields?: { key: string; label: string; required: boolean; format: SharedText; example: string; choices?: string[]; rule?: SharedText }[];
  sources: { what: SharedText; askDesk: SharedOrgDesk | null; askName?: string }[];
  enteredOnce: SharedText;
  steps: { save: SharedText; review: SharedText; returned: SharedText; done: SharedText; recover: SharedText };
  notVerified: SharedText[];
  allowed: (user: User) => boolean;
  actions?: string[];
}

const bm = (x: T): SharedText => ({ bm: x.ms, en: x.en });
const st = (b: string, en: string): SharedText => ({ bm: b, en });
const NAMES: Record<GuideCard['view'], string> = {
  corporate: 'Company secretary',
  renewals: 'Renewals',
  credit: 'PWVSB credit',
  doa: 'Director Office',
  requests: 'Requests',
  work: 'Work',
};

/** What the shared format needs beyond the cards above: whom to ask (a desk, or the record keepers), the review step,
 * what is not built or not verified, the audit actions, and the permission rule. */
const EXTRA: Record<string, Pick<SharedGuideCardSpec, 'status' | 'sources' | 'notVerified' | 'actions'> & { review: SharedText }> = {
  'company-file-draft': {
    status: 'ready',
    sources: [
      { what: st('', ''), askDesk: null, askName: 'The company secretary (SSM extract) and the Deputy Chief of Staff, Corporate Admin (the record keepers)' },
    ],
    review: st('Timbalan Ketua Staf menyemak dengan cabutan SSM.', 'The Deputy Chief of Staff checks it against the SSM extract.'),
    notVerified: [st('Tiada sambungan ke SSM.', 'No connection to SSM.')],
    actions: ['corp.file.save'],
  },
  'company-file-check': {
    status: 'ready',
    sources: [{ what: st('', ''), askDesk: null, askName: 'The company secretary (the SSM extract keeper)' }],
    review: st('Langkah ini ialah semakan; tiada penyemak kedua.', 'This step is the check; there is no second checker.'),
    notVerified: [st('Tiada sambungan ke SSM.', 'No connection to SSM.')],
    actions: ['corp.file.checked', 'corp.file.mismatch'],
  },
  renewal: {
    status: 'ready',
    sources: [
      { what: st('', ''), askDesk: 'company_office' },
      { what: st('Resit bayaran yuran.', 'The fee payment receipt.'), askDesk: 'finance' },
    ],
    review: st('Timbalan Ketua Staf mengesahkan tarikh luput baharu atau menanyakannya.', 'The Deputy Chief of Staff confirms the new expiry or queries it.'),
    notVerified: [
      st(
        'Senarai kertas dan tempoh awal adalah cadangan; borang semasa agensi yang menentukan.',
        'Paper lists and lead times are proposals; the agency’s current form decides.',
      ),
    ],
    actions: ['renewal.'],
  },
  'panel-firm': {
    status: 'partial',
    sources: [{ what: st('', ''), askDesk: 'legal' }],
    review: st('Tiada penyemak; semakan tahunan direkod dengan nota.', 'No reviewer; the yearly review is recorded with a note.'),
    notVerified: [st('Jadual firma panel belum dipasang di mana-mana pangkalan data.', 'The panel table is not installed in any database yet.')],
    actions: ['panel.'],
  },
  'credit-loan': {
    status: 'ready',
    sources: [
      { what: st('', ''), askDesk: 'legal' },
      { what: st('Penyata bank.', 'The bank statement.'), askDesk: 'finance' },
    ],
    review: st('Tiada penyemak untuk pembetulan; ia diaudit dengan sebab.', 'No reviewer for a correction; it is audited with the reason.'),
    notVerified: [st('Templat perjanjian menunggu kelulusan peguam.', 'The agreement template awaits counsel’s approval.')],
    actions: ['credit.'],
  },
  'director-office-lists': {
    status: 'ready',
    sources: [{ what: st('', ''), askDesk: 'chief_of_staff' }],
    review: st('CEO menerima atau memulangkan hasil arahan dengan sebab.', 'The CEO accepts or returns an instruction’s result with a reason.'),
    notVerified: [],
    actions: ['reports.', 'meeting.', 'work.'],
  },
  'task-finish': {
    status: 'ready',
    sources: [{ what: st('', ''), askDesk: null, askName: 'Whoever gave the task (shown on the task)' }],
    review: st('Pemberi tugas menerima atau memulangkan dengan sebab.', 'Whoever gave the task accepts or returns it with a reason.'),
    notVerified: [],
    actions: [],
  },
  'legal-flags': {
    status: 'ready',
    sources: [{ what: st('', ''), askDesk: 'legal' }],
    review: st('Tiada; pengarah membaca dan meminta pemilik rekod bertindak.', 'None; directors read and ask the record owner to act.'),
    notVerified: [
      st('Pengarah bertanggungjawab untuk kredit dan lesen KDN adalah andaian.', 'The responsible director for credit and KDN flags is an assumption.'),
    ],
    actions: [],
  },
  'kpkt-check': {
    status: 'partial',
    sources: [{ what: st('', ''), askDesk: 'legal' }],
    review: st('Langkah ini ialah semakan; pengarah melihat yang belum disemak.', 'This step is the check; the directors see loans not checked.'),
    notVerified: [
      st('Rekod lesen KPKT PWVSB belum dikunci masuk.', 'PWVSB’s KPKT licence record is not keyed in yet.'),
      st('Tiada sambungan ke KPKT.', 'No connection to KPKT.'),
    ],
    actions: ['credit.licence.'],
  },
  'adviser-money': {
    status: 'partial',
    sources: [
      { what: st('', ''), askDesk: 'legal' },
      { what: st('Bayaran.', 'Payment.'), askDesk: 'finance' },
    ],
    review: st('Pengarah Kewangan bersetuju bajet; orang lain menyemak invois.', 'The Finance Director agrees budgets; someone else checks invoices.'),
    notVerified: [
      st('Bergantung pada jadual firma panel yang belum dipasang.', 'Depends on the panel table, not installed yet.'),
      st('Tiada sambungan ke SQL Account; bayaran dibuat oleh Kewangan.', 'No connection to SQL Account; Finance makes the payment.'),
    ],
    actions: ['panel.money.'],
  },
  delegations: {
    status: 'partial',
    sources: [{ what: st('', ''), askDesk: 'chief_of_staff' }],
    review: st(
      'CEO atau Ketua Staf meluluskan; bukan perekod atau orang yang bertindak.',
      'The CEO or the Chief of Staff approves; never the recorder or the person who acts.',
    ),
    notVerified: [
      st('Modul daftar perwakilan belum dipasang di mana-mana pangkalan data.', 'The delegation register module is not installed in any database yet.'),
      st('Tidak menukar akses sesiapa dalam Prima.', 'It does not change anyone’s access in Prima.'),
    ],
    actions: ['delegation.'],
  },
};

/** The permission rule per card: the roles above come from the same rules the service checks for each action. */
const allowedFor = (c: GuideCard) => (user: User) => {
  const roles = centralAdminGuideRoles(user);
  return c.roles.some((r) => roles.includes(r));
};

/** The Central Admin cards in the shared format, ready for registerGuideCards() once PR #56 is merged. */
export const CENTRAL_ADMIN_GUIDE_SPECS: SharedGuideCardSpec[] = CENTRAL_ADMIN_GUIDE.map((c) => {
  const x = EXTRA[c.id];
  return {
    id: `central-admin.${c.id}`,
    status: x.status,
    dept: 'Central Admin',
    title: bm(c.title),
    purpose: bm(c.purpose),
    who: bm(c.responsible),
    screen: { view: c.view, name: NAMES[c.view], action: bm(c.where) },
    fields: c.fields.map((f, i) => ({ key: `f${i + 1}`, label: f.name.en, required: f.required, format: bm(f.format), example: f.example })),
    sources: x.sources.map((s, i) => ({ ...s, what: i === 0 ? bm(c.source) : s.what })),
    enteredOnce: bm(c.reuse),
    steps: {
      save: { bm: c.steps.map((s) => s.ms).join(' '), en: c.steps.map((s) => s.en).join(' ') },
      review: x.review,
      returned: bm(c.returned),
      done: bm(c.evidence),
      recover: bm(c.recover),
    },
    notVerified: [bm(c.limits), ...x.notVerified],
    allowed: allowedFor(c),
    actions: x.actions,
  };
});

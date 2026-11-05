// In-app guide cards for the company office (Arisha main review, 2 Nov 2026, section A), in the shared guide-card shape
// of PR #56 (packages/core/src/guide-cards.ts, GuideCardSpec): Bahasa Melayu first, with English; `enteredOnce` filled;
// whom to ask is a hand-over desk ('company_office') or the record's keepers, never a named person; anything not built
// or not checked is listed in `notVerified`. Read-only help: a card never saves, approves or grants anything.
//
// `allowed` calls the server's own permission rule (access.ts `can`, `isGroupLeader`), so Arisha (GET /api/org/guide)
// shows a card only to people the server lets do the task. `officeRoles` narrows the office page to the viewer's office
// role (head, exec or monitor), which the server works out per company. When PR #56 is merged with this branch the
// cards are registered with one line: registerGuideCards(OFFICE_GUIDE). Until then the office page reads them directly.
// Every quoted button, field and message is checked against the current screens and service by
// test/office-guide.test.ts. No new record kinds are added, so SERVER_FIELD_RULES needs no entry.
import { can, isGroupLeader } from './access';
import type { Action } from './access';
import type { User } from './types';

export const OFFICE_GUIDE_VERSION = 'office-guide-v3 (2026-11-03)';

export type OfficeGuideRole = 'head' | 'exec' | 'monitor';
export interface OfficeGuideText {
  bm: string;
  en: string;
}
export interface OfficeGuideField {
  key: string;
  /** The label exactly as the screen shows it. */
  label: string;
  required: boolean;
  format: OfficeGuideText;
  /** Synthetic only. */
  example: string;
  rule?: OfficeGuideText;
}
/** Hand-over desks (OrgDesk in PR #56) that these cards name. */
export type OfficeAskDesk = 'company_office' | 'director_office';
/** Same shape as GuideCardSpec in PR #56, plus officeRoles for the office page. */
export interface OfficeGuideCard {
  id: string;
  status: 'ready' | 'partial' | 'not_built';
  dept: string;
  title: OfficeGuideText;
  purpose: OfficeGuideText;
  who: OfficeGuideText;
  screen: { view: string | null; name: string; action: OfficeGuideText };
  fields?: OfficeGuideField[];
  sources: { what: OfficeGuideText; askDesk: OfficeAskDesk | null; askName?: string }[];
  enteredOnce: OfficeGuideText;
  steps: { save: OfficeGuideText; review: OfficeGuideText; returned: OfficeGuideText; done: OfficeGuideText; recover: OfficeGuideText };
  notVerified: OfficeGuideText[];
  allowed: (user: User) => boolean;
  actions?: string[];
  officeRoles: OfficeGuideRole[];
}

const t = (bm: string, en: string): OfficeGuideText => ({ bm, en });
/** The server's own company permission rule, for any of the person's companies. */
const may = (u: User, action: Action) => !u.integration && u.companyIds.some((c) => can(u, [], '', action, c));
const companyHead = (u: User) => !u.integration && u.role === 'company_manager' && !u.branchId;
const officeStaff = (u: User) => !u.integration && (u.role === 'company_manager' || u.role === 'admin_exec') && !u.branchId;
const DEPT = 'Company office';
const MODULE_NOT_INSTALLED = t(
  'Modul pangkalan data pejabat belum dipasang di staging atau produksi; sebelum itu meja tidak boleh disimpan.',
  'The office database module is not installed in staging or production; until then desks cannot be saved.',
);
const NO_STAFF_UAT = t(
  'Belum diuji oleh staf sebenar; hanya ujian pelayar dengan data rekaan.',
  'Not yet tested by real staff; only a browser run with made-up data.',
);

export const OFFICE_GUIDE: OfficeGuideCard[] = [
  {
    id: 'office.desks',
    status: 'ready',
    dept: DEPT,
    officeRoles: ['head'],
    title: t('Bahagikan meja kerja pejabat', 'Share out the office desks'),
    purpose: t(
      'Setiap meja (kerja syarikat) ada seorang pemilik dan seorang ganti, supaya kerja tidak terhenti bila pemilik bercuti.',
      'Each desk (a slice of company work) gets an owner and a backup, so work keeps moving when the owner is on leave.',
    ),
    who: t(
      'Ketua pejabat syarikat sahaja: GM jika ada, jika tidak Pengurus Syarikat.',
      'The company office head only: the GM where there is one, otherwise the Company Manager.',
    ),
    screen: {
      view: 'office',
      name: 'Company office',
      action: t('Panel Desks → butang "Share out desks" → "Save desks".', 'Desks panel → "Share out desks" → "Save desks".'),
    },
    fields: [
      {
        key: 'owner',
        label: 'Owner',
        required: false,
        format: t('Pilih ahli pasukan, atau "Not shared out" untuk kosongkan meja.', 'Pick a team member, or "Not shared out" to clear the desk.'),
        example: 'Synthetic Exec A',
      },
      {
        key: 'backup',
        label: 'Backup',
        required: false,
        format: t('Orang lain daripada pemilik. Hanya jika meja ada pemilik.', 'Someone other than the owner. Only when the desk has an owner.'),
        example: 'Synthetic Exec B',
      },
      { key: 'note', label: 'Note', required: false, format: t('Teks, hingga 300 aksara.', 'Text, up to 300 characters.'), example: 'New executive joined' },
    ],
    sources: [
      {
        what: t(
          'Senarai pasukan dibaca daripada akaun log masuk yang HR dan IT sudah simpan.',
          'The team list is read from the sign-in accounts HR and IT already keep.',
        ),
        askDesk: null,
        askName: 'HR (staff record) and IT (sign-in account), who keep the office accounts',
      },
    ],
    enteredOnce: t(
      'Akaun staf, jawatan dan cuti diluluskan diguna semula; tiada nama ditaip semula di sini.',
      'Staff accounts, job titles and approved leave are reused; no names are typed again here.',
    ),
    actions: ['office.desks'],
    steps: {
      save: t(
        'Semak cadangan pembahagian (hanya cadangan sehingga disimpan), pilih pemilik dan ganti, tekan "Save desks". Setiap perubahan direkod dalam audit dengan nama sebelum dan selepas.',
        'Check the suggested split (only a suggestion until saved), choose owners and backups, press "Save desks". Each change is audited with the before and after names.',
      ),
      review: t(
        'Tiada kelulusan lain: ketua syarikat sendiri memutuskan (V12). Pemimpin kumpulan memantau sahaja.',
        'No other approval: the company’s own head decides (V12). Group leaders only monitor.',
      ),
      returned: t(
        'Untuk ubah, tekan "Share out desks" sekali lagi dan simpan. Rekod lama kekal dalam audit.',
        'To change it, press "Share out desks" again and save. The earlier split stays in the audit.',
      ),
      done: t(
        'Meja menunjukkan pemilik dan ganti; amaran "no backup for leave days" hilang dari "To fix".',
        'Desks show an owner and a backup; the "no backup for leave days" warning leaves "To fix".',
      ),
      recover: t(
        '"Choose an owner before a backup, or clear both.": pilih pemilik dahulu. "No changes to save": tiada yang berubah. Pejabat belum dihidupkan: simpan ditolak sehingga modul dipasang.',
        '"Choose an owner before a backup, or clear both.": pick the owner first. "No changes to save": nothing changed. Office not switched on: saving is refused until the module is installed.',
      ),
    },
    notVerified: [
      MODULE_NOT_INSTALLED,
      t(
        'Pengurus Syarikat di bawah GM melihat kad ini, tetapi pelayan menolak simpanannya.',
        'A Company Manager under a GM sees this card, but the server refuses their save.',
      ),
      NO_STAFF_UAT,
    ],
    allowed: companyHead,
  },
  {
    id: 'office.queue',
    status: 'ready',
    dept: DEPT,
    officeRoles: ['head', 'exec'],
    title: t('Kerja meja saya hari ini', 'My desk work today'),
    purpose: t('Satu senarai semua kerja syarikat, dibahagi ikut meja.', 'One list of all company work, split by desk.'),
    who: t('Ketua pejabat dan eksekutif pejabat syarikat.', 'The company office head and executives.'),
    screen: {
      view: 'office',
      name: 'Company office',
      action: t('Panel Work → "Show only mine" → buka baris.', 'Work panel → "Show only mine" → open the line.'),
    },
    sources: [
      {
        what: t(
          'Setiap baris dibuka di skrin asalnya (kehadiran, pelanggan, tender, lesen, kes, pembelian). Cari rekod ikut rujukan syarikat atau kontrak.',
          'Each line opens in its own screen (attendance, clients, tenders, licences, cases, purchases). Find the record by company or contract reference.',
        ),
        askDesk: 'company_office',
      },
    ],
    enteredOnce: t(
      'Kerja dibaca daripada modul asal dengan hak anda sendiri; tiada salinan dibuat dan tiada yang ditaip semula.',
      'Work is read from each module with your own rights; nothing is copied and nothing is typed again.',
    ),
    steps: {
      save: t(
        'Mulakan dengan baris merah (segera); buka baris dan buat kerja di skrin itu.',
        'Start with the red (urgent) lines; open the line and do the work on that screen.',
      ),
      review: t(
        'Ikut semakan di skrin asal. Kelulusan dan senjata kekal dengan ketua; eksekutif tidak melihatnya sebagai kerja mereka.',
        'Follow the review on the original screen. Approvals and arms stay with the head; executives do not see them as their work.',
      ),
      returned: t('Kerja yang dipulangkan muncul semula di sini dengan nada amaran.', 'Returned work comes back here with a warning tone.'),
      done: t('Baris hilang bila skrin asal menandakannya selesai.', 'A line leaves when its own screen marks it done.'),
      recover: t('"Not allowed": skrin itu di luar hak anda; minta ketua pejabat.', '"Not allowed": that screen is outside your rights; ask the office head.'),
    },
    notVerified: [NO_STAFF_UAT],
    allowed: officeStaff,
  },
  {
    id: 'office.cover',
    status: 'ready',
    dept: DEPT,
    officeRoles: ['head', 'exec'],
    title: t('Ganti meja ketika pemilik bercuti', 'Covering a desk while the owner is away'),
    purpose: t(
      'Bila pemilik bercuti (cuti diluluskan) atau keluar, ganti memegang meja hari itu; jika kedua-dua tiada, kerja ke ketua.',
      'When the owner is on approved leave or has left, the backup holds the desk that day; if both are away, the work goes to the head.',
    ),
    who: t('Ganti yang ditetapkan oleh ketua.', 'The backup the head set.'),
    screen: {
      view: 'office',
      name: 'Company office',
      action: t('Laman Utama → "You hold … today", atau panel Desks.', 'Home → "You hold … today", or the Desks panel.'),
    },
    sources: [
      {
        what: t('Cuti dibaca daripada rekod cuti syarikat yang telah diluluskan.', 'Leave is read from the company’s approved leave records.'),
        askDesk: 'company_office',
      },
    ],
    enteredOnce: t('Rekod cuti yang sudah diluluskan diguna semula; tiada borang tambahan.', 'Approved leave records are reused; there is no extra form.'),
    steps: {
      save: t('Buka meja yang anda pegang dan buat kerjanya seperti biasa.', 'Open the desk you hold and work it as usual.'),
      review: t('Sama seperti kerja biasa.', 'Same as normal work.'),
      returned: t('Bila pemilik kembali, meja kembali kepadanya secara automatik.', 'When the owner returns, the desk goes back to them automatically.'),
      done: t('Mesej "You hold" hilang bila pemilik kembali.', 'The "You hold" line leaves when the owner is back.'),
      recover: t(
        'Cuti tidak ditunjuk: semak permohonan cuti telah diluluskan; tanya ketua pejabat.',
        'Leave not shown: check the leave request was approved; ask the office head.',
      ),
    },
    notVerified: [MODULE_NOT_INSTALLED, NO_STAFF_UAT],
    allowed: officeStaff,
  },
  {
    id: 'office.runs',
    status: 'ready',
    dept: DEPT,
    officeRoles: ['head', 'exec'],
    title: t('Syarikat lain yang dijalankan oleh pejabat anda', 'Other companies your office runs'),
    purpose: t(
      'Syarikat tanpa lesen, atau tanpa kerja yang cukup, boleh dijalankan oleh pejabat syarikat anda. Ketua anda mengetuai pejabatnya dan boleh memberi mejanya kepada eksekutif anda.',
      'A company without a licence, or without enough work of its own, can be run by your company’s office. Your head leads its office and can give its desks to your executives.',
    ),
    who: t(
      'Ketua Staf (CoS) menetapkan pejabat mana yang menjalankan syarikat itu, dengan sebab. Ketua pejabat membahagi meja; eksekutif membuat kerja di meja mereka.',
      'The Chief of Staff sets which office runs the company, with a reason. The office head shares out the desks; executives work the desks they hold.',
    ),
    screen: {
      view: 'office',
      name: 'Company office',
      action: t('Panel "Companies your office also runs" → pilih syarikat.', 'The "Companies your office also runs" panel → choose the company.'),
    },
    sources: [
      {
        what: t('Siapa menjalankan syarikat itu: ditetapkan oleh Ketua Staf (CoS).', 'Who runs the company: set by the Chief of Staff.'),
        askDesk: 'director_office',
      },
      {
        what: t(
          'Lesen KDN dibaca daripada rekod Lesen syarikat; ia ditunjuk sebagai fakta sahaja.',
          'The KDN licence is read from the company’s Licences records; it is shown as a fact only.',
        ),
        askDesk: 'company_office',
      },
    ],
    enteredOnce: t(
      'Tiada akaun baharu: akaun pejabat anda sendiri digunakan untuk syarikat yang dijalankan.',
      'No new accounts: your own office accounts are used for the company it runs.',
    ),
    steps: {
      save: t(
        'Ketua: buka syarikat itu, tekan "Share out desks" dan pilih eksekutif anda.',
        'Head: open that company, press "Share out desks" and choose your executives.',
      ),
      review: t(
        'Kerja syarikat itu muncul di mejanya, sama seperti syarikat anda sendiri.',
        'That company’s work shows on its desks, the same as your own company.',
      ),
      returned: t('Kelulusan dan senjata kekal dengan ketua.', 'Approvals and arms stay with the head.'),
      done: t(
        'Bila Ketua Staf menamatkan susunan itu, syarikat kembali kepada pejabatnya sendiri.',
        'When the Chief of Staff ends the arrangement, the company goes back to its own office.',
      ),
      recover: t(
        'Syarikat tidak ditunjuk: minta Ketua Staf menyemak "Run by the … office" pada halaman Company offices.',
        'Company not shown: ask the Chief of Staff to check "Run by the … office" on the Company offices page.',
      ),
    },
    notVerified: [
      MODULE_NOT_INSTALLED,
      t(
        'Pautan syarikat yang dijalankan memerlukan modul pangkalan data sendiri (company-run-links-v1), belum dipasang.',
        'Run company links need their own database module (company-run-links-v1), not installed yet.',
      ),
      NO_STAFF_UAT,
    ],
    allowed: officeStaff,
  },
  {
    id: 'office.quotation.enter',
    status: 'partial',
    dept: DEPT,
    officeRoles: ['head', 'exec'],
    title: t('Sediakan sebut harga', 'Prepare a quotation'),
    purpose: t(
      'Sebut harga dalam nama syarikat sendiri, diluluskan oleh Pengurus Syarikat sebelum dihantar.',
      'A quotation in the company’s own name, approved by the Company Manager before it goes out.',
    ),
    who: t('Pasukan pentadbir syarikat yang boleh menyediakan sebut harga.', 'The company admin team who may prepare quotations.'),
    screen: {
      view: 'commercial',
      name: 'Tenders and quotations',
      action: t(
        '"New quotation" → "Save draft" → buka draf → "Send to manager for approval".',
        '"New quotation" → "Save draft" → open the draft → "Send to manager for approval".',
      ),
    },
    fields: [
      { key: 'client', label: 'Client', required: true, format: t('Nama pelanggan.', 'Client name.'), example: 'Synthetic Client Sdn Bhd' },
      { key: 'siteName', label: 'Site', required: false, format: t('Nama tapak.', 'Site name.'), example: 'Synthetic Tower' },
      {
        key: 'tenderId',
        label: 'For tender',
        required: false,
        format: t('Tender syarikat ini, atau "Direct quotation".', 'One of this company’s tenders, or "Direct quotation".'),
        example: 'Direct quotation (no tender)',
      },
      { key: 'guards', label: 'Guards', required: true, format: t('Nombor bulat 1 hingga 1,000.', 'Whole number 1 to 1,000.'), example: '6' },
      { key: 'hoursPerDay', label: 'Shift length', required: true, format: t('8 atau 12 jam.', '8 or 12 hours.'), example: '12 hours' },
      {
        key: 'ratePerGuard',
        label: 'RM per guard a month',
        required: true,
        format: t('RM, lebih daripada 0, hingga 50,000.', 'RM, above 0, up to 50,000.'),
        example: '3200',
      },
      {
        key: 'validDays',
        label: 'Valid for (days)',
        required: true,
        format: t('Bilangan hari, 7 hingga 180 (di luar julat ditetapkan ke had).', 'Number of days, 7 to 180 (outside that range it is set to the limit).'),
        example: '30',
      },
    ],
    sources: [
      {
        what: t(
          'Permintaan pelanggan atau dokumen tender; cari ikut rujukan tender atau nama pelanggan dalam skrin Tenders.',
          'The client request or tender papers; find them by tender reference or client name on the Tenders screen.',
        ),
        askDesk: 'company_office',
      },
      {
        what: t('Dokumen tender kerajaan.', 'Government tender papers.'),
        askDesk: 'director_office',
      },
    ],
    enteredOnce: t('Tender yang sudah direkod dipilih daripada senarai, bukan ditaip semula.', 'An existing tender is picked from the list, not typed again.'),
    actions: ['quotation.create', 'quotation.submit'],
    steps: {
      save: t(
        'Isi borang, tekan "Save draft", semak jumlah sebulan, buka draf dan tekan "Send to manager for approval".',
        'Fill the form, press "Save draft", check the monthly total, open the draft and press "Send to manager for approval".',
      ),
      review: t(
        'Pengurus Syarikat / GM meluluskan atau memulangkan. Penyedia tidak boleh meluluskan sendiri.',
        'The Company Manager / GM approves or returns it. The preparer can never approve their own.',
      ),
      returned: t('Jika dipulangkan, ikut kad "Betulkan sebut harga yang dipulangkan".', 'If returned, follow the card "Correct a returned quotation".'),
      done: t(
        'Status "Approved, not sent", kemudian "Mark sent to client" selepas dihantar di luar aplikasi.',
        'Status "Approved, not sent", then "Mark sent to client" once it is sent outside the app.',
      ),
      recover: t(
        '"Guards must be a whole number from 1 to 1,000." atau "Give the monthly rate per guard in RM.": betulkan angka itu.',
        '"Guards must be a whole number from 1 to 1,000." or "Give the monthly rate per guard in RM.": fix that figure.',
      ),
    },
    notVerified: [
      t(
        'Semakan kos automatik (gaji minimum, OT, KWSP, PERKESO, SIP) belum dihidupkan; semak secara manual.',
        'Automatic cost checks (minimum wage, OT, EPF, SOCSO, EIS) are not switched on; check by hand.',
      ),
      t('Aplikasi tidak menghantar sebut harga kepada pelanggan.', 'The app does not send the quotation to the client.'),
      NO_STAFF_UAT,
    ],
    allowed: (u) => may(u, 'commercial.prepare'),
  },
  {
    id: 'office.quotation.review',
    status: 'ready',
    dept: DEPT,
    officeRoles: ['head'],
    title: t('Luluskan atau pulangkan sebut harga', 'Approve or return a quotation'),
    purpose: t('Ketua menyemak sebut harga yang disediakan oleh orang lain.', 'The head checks a quotation someone else prepared.'),
    who: t('Pengurus Syarikat / GM.', 'The Company Manager / GM.'),
    screen: {
      view: 'commercial',
      name: 'Tenders and quotations',
      action: t(
        'Buka sebut harga "Waiting for approval" → "Approve" atau "Return for changes".',
        'Open a "Waiting for approval" quotation → "Approve" or "Return for changes".',
      ),
    },
    fields: [
      {
        key: 'note',
        label: 'Note',
        required: true,
        format: t('Wajib untuk pulangkan: nyatakan apa perlu diubah.', 'Needed to return: say what needs changing.'),
        example: 'Rate below agreed floor; recheck',
      },
    ],
    sources: [{ what: t('Sebut harga itu sendiri dan tender yang dipautkan.', 'The quotation itself and its linked tender.'), askDesk: 'company_office' }],
    enteredOnce: t(
      'Tiada data baharu ditaip; hanya keputusan dan nota pada rekod yang sama.',
      'No new data is typed; only the decision and a note on the same record.',
    ),
    actions: ['quotation.approve', 'quotation.return'],
    steps: {
      save: t(
        'Semak pengawal, jam, kadar dan tarikh sah; "Approve", atau tulis nota dan "Return for changes".',
        'Check guards, hours, rate and valid-until; "Approve", or write a note and "Return for changes".',
      ),
      review: t('Keputusan direkod dalam audit dengan nama dan nota anda.', 'The decision is audited with your name and note.'),
      returned: t('Penyedia membetulkan dan menghantar semula; ia kembali kepada anda.', 'The preparer corrects and resends it; it comes back to you.'),
      done: t('Status "Approved, not sent".', 'Status "Approved, not sent".'),
      recover: t(
        '"You prepared this quotation, so another person must approve it." / "This quotation has passed its valid-until date. Return it for a new date." / "Say what needs changing." (nota kosong).',
        '"You prepared this quotation, so another person must approve it." / "This quotation has passed its valid-until date. Return it for a new date." / "Say what needs changing." (empty note).',
      ),
    },
    notVerified: [NO_STAFF_UAT],
    allowed: (u) => may(u, 'commercial.approve'),
  },
  {
    id: 'office.quotation.correct',
    status: 'ready',
    dept: DEPT,
    officeRoles: ['head', 'exec'],
    title: t('Betulkan sebut harga yang dipulangkan', 'Correct a returned quotation'),
    purpose: t('Betulkan rekod yang sama; jangan buat sebut harga baharu.', 'Correct the same record; do not create a new quotation.'),
    who: t('Pasukan pentadbir syarikat yang boleh menyediakan sebut harga.', 'The company admin team who may prepare quotations.'),
    screen: {
      view: 'commercial',
      name: 'Tenders and quotations',
      action: t(
        'Buka sebut harga "Returned for changes" → "Correct guards, rate or date" → "Save correction" → buka semula → "Send to manager for approval".',
        'Open the "Returned for changes" quotation → "Correct guards, rate or date" → "Save correction" → open it again → "Send to manager for approval".',
      ),
    },
    fields: [
      { key: 'guards', label: 'Guards', required: true, format: t('Nombor bulat 1 hingga 1,000.', 'Whole number 1 to 1,000.'), example: '8' },
      { key: 'hoursPerDay', label: 'Hours a day', required: true, format: t('8 atau 12.', '8 or 12.'), example: '12' },
      {
        key: 'ratePerGuard',
        label: 'Rate per guard (RM a month)',
        required: true,
        format: t('RM, lebih daripada 0, hingga 50,000.', 'RM, above 0, up to 50,000.'),
        example: '3450',
      },
      {
        key: 'validUntil',
        label: 'Valid until',
        required: true,
        format: t('Tarikh dari hari ini hingga 180 hari ke depan.', 'A date from today up to 180 days ahead.'),
        example: '2026-12-15',
      },
      {
        key: 'reason',
        label: 'Reason for the correction',
        required: true,
        format: t('Teks, hingga 500 aksara.', 'Text, up to 500 characters.'),
        example: 'Manager asked for the agreed rate',
      },
    ],
    sources: [
      {
        what: t('Nota pemulangan pengurus dalam sebut harga itu.', 'The manager’s return note on the quotation.'),
        askDesk: 'company_office',
      },
    ],
    enteredOnce: t(
      'Pelanggan, tapak dan tender kekal pada rekod yang sama; hanya angka dan tarikh dibetulkan, tiada yang dicipta semula.',
      'Client, site and tender stay on the same record; only the figures and date are corrected, nothing is recreated.',
    ),
    actions: ['quotation.correct', 'quotation.submit'],
    steps: {
      save: t(
        'Tekan "Correct guards, rate or date", ubah angka, tulis sebab, "Save correction". Senarai menunjukkan jumlah baharu.',
        'Press "Correct guards, rate or date", change the figures, write the reason, "Save correction". The list shows the new total.',
      ),
      review: t(
        'Buka sebut harga itu sekali lagi dan tekan "Send to manager for approval"; Pengurus Syarikat / GM menyemak semula. Audit menyimpan nilai lama → baharu dan sebabnya.',
        'Open the quotation again and press "Send to manager for approval"; the Company Manager / GM reviews again. The audit keeps old → new values and the reason.',
      ),
      returned: t('Boleh dipulangkan dan dibetulkan lagi; setiap pusingan direkod.', 'It can be returned and corrected again; every round is audited.'),
      done: t('Status "Waiting for approval" selepas dihantar semula.', 'Status "Waiting for approval" after resubmitting.'),
      recover: t(
        '"Nothing changed.": tiada angka diubah. "Only a draft or returned quotation can be corrected.". Sebab kosong: butang "Save correction" kekal tidak aktif.',
        '"Nothing changed.": no figure was changed. "Only a draft or returned quotation can be corrected.". Empty reason: the "Save correction" button stays disabled.',
      ),
    },
    notVerified: [NO_STAFF_UAT],
    allowed: (u) => may(u, 'commercial.prepare'),
  },
  {
    id: 'office.monitor',
    status: 'ready',
    dept: DEPT,
    officeRoles: ['monitor'],
    title: t('Pantau semua pejabat syarikat', 'Monitor all company offices'),
    purpose: t(
      'Paparan pengurusan disatukan: kakitangan, liputan meja dan kerja terbuka semua syarikat (V7: tiada rekod digabung).',
      'Consolidated management view: staffing, desk cover and open work across companies (V7: no records merged).',
    ),
    who: t(
      'Pimpinan kumpulan sahaja (CEO, COO, FD, CoS, DCoS, Pengerusi, Naib Pengerusi).',
      'Group leaders only (CEO, COO, FD, CoS, DCoS, Chairman, Vice Chairman).',
    ),
    screen: {
      view: 'office',
      name: 'Company office',
      action: t('"All office work, by desk" → pilih syarikat untuk lihat pejabatnya.', '"All office work, by desk" → pick a company to see its office.'),
    },
    sources: [{ what: t('Dibina daripada rekod setiap syarikat sendiri.', 'Built from each company’s own records.'), askDesk: 'company_office' }],
    enteredOnce: t(
      'Sama seperti halaman setiap syarikat; "Office ready" memakai dapatan yang sama. Tiada yang ditaip di sini.',
      'Same as each company page; "Office ready" uses the same findings. Nothing is typed here.',
    ),
    steps: {
      save: t('Baca dan buka baris; anda tidak boleh mengubah meja syarikat.', 'Read and open lines; you cannot change a company’s desks.'),
      review: t('Baca sahaja.', 'Read only.'),
      returned: t('Tiada.', 'None.'),
      done: t('Tiada; ini paparan pemantauan.', 'None; this is a monitoring view.'),
      recover: t('Pejabat "Not entered yet": tanya pejabat syarikat itu dan HR.', 'Office "Not entered yet": ask that company office and HR.'),
    },
    notVerified: [NO_STAFF_UAT],
    allowed: (u) => !u.integration && isGroupLeader(u),
  },
];

export function officeGuideFor(role: OfficeGuideRole | null): OfficeGuideCard[] {
  return role ? OFFICE_GUIDE.filter((c) => c.officeRoles.includes(role)) : [];
}

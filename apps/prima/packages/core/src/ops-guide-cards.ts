/**
 * Guide cards for Government Operations (Goodwill Empire), Private Operations (Sasa Team), the management fees and
 * client care (Fauzan, 2 Nov 2026), in the shared guide-card shape of PR #56 (packages/core/src/guide-cards.ts,
 * GuideCardSpec). Read-only help: a card never saves or approves anything.
 *
 * Each `allowed` calls the same rule the server uses (ops-access.ts). Bahasa Melayu first, then English. Who to ask is
 * a hand-over desk, or the record's own keepers by role, never a named person.
 *
 * This file does not import guide-cards.ts so this branch builds on its own; once PR #56 is merged, one line
 * registers them: registerGuideCards(OPS_GUIDE_CARDS).
 */
import { RULES } from './rules';
import {
  canGovOpsMonitor,
  canIssueGoodwillItems,
  canPrivateOpsMonitor,
  canRecordHandover,
  canSetManagementFee,
  clientRoleOf,
  managementFeeBillScope,
} from './ops-access';
import type { User } from './types';

interface Text {
  bm: string;
  en: string;
}
const t = (bm: string, en: string): Text => ({ bm, en });

/** The same shape as GuideCardSpec in PR #56 (fields given by hand: these tasks are not RECORD_KINDS forms). */
export interface OpsGuideCard {
  id: string;
  status: 'ready' | 'partial' | 'not_built';
  dept: string;
  title: Text;
  purpose: Text;
  who: Text;
  screen: { view: string | null; name: string; action: Text };
  allowed: (user: User) => boolean;
  fields: { key: string; label: string; required: boolean; format: Text; example: string; choices?: string[]; rule?: Text }[];
  sources: { what: Text; askDesk: 'finance' | 'procurement' | 'coo' | 'company_office' | null; askName?: string }[];
  enteredOnce: Text;
  actions: string[];
  steps: { save: Text; review: Text; returned: Text; done: Text; recover: Text };
  notVerified: Text[];
}

/** The date in Malaysia, for the rules that look at whether access has closed. */
const today = () => new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10);
const VIA = ['meeting', 'visit', 'call', 'email', 'form'];
const r = RULES.clientCare.value;

export const OPS_GUIDE_CARDS: OpsGuideCard[] = [
  {
    id: 'ops.goodwill.issue',
    status: 'ready',
    dept: 'Goodwill Empire (store)',
    title: t('Keluarkan barang Goodwill kepada pengawal', 'Issue a Goodwill item to a guard'),
    purpose: t(
      'Barang operasi milik Goodwill dihantar melalui OM dan pegawai peronda kepada pengawal, dan dibil kepada syarikat pengawal.',
      "Goodwill's operational items go through the OM and the patrolling officer to the guard, and are billed to the guard's company.",
    ),
    who: t('Penjaga stor dan Perolehan Goodwill.', "Goodwill's storekeepers and Procurement."),
    screen: { view: 'purchasing', name: 'Procurement', action: t('Stor: pilih barang, Keluarkan, pilih pengawal, OM dan pegawai peronda.', 'Store: choose the item, Issue, choose the guard, the OM and the patrolling officer.') },
    allowed: canIssueGoodwillItems,
    fields: [
      { key: 'personId', label: 'Guard or officer', required: true, format: t('Pilih daripada senarai.', 'Choose from the list.'), example: 'Synthetic guard (SYN0001)' },
      { key: 'qty', label: 'Quantity', required: true, format: t('Nombor, sekurang-kurangnya 1.', 'Number, at least 1.'), example: '1' },
      { key: 'serial', label: 'Serial', required: false, format: t('Nombor siri pada barang, jika ada.', 'The serial on the item, if it has one.'), example: 'SYN-123' },
      {
        key: 'omUserId',
        label: 'Operations Manager',
        required: true,
        format: t('Pilih OM kerajaan yang membawa barang.', 'Choose the government OM who carries it.'),
        example: 'Synthetic OM',
      },
      {
        key: 'patrolPersonId',
        label: 'Patrolling officer',
        required: true,
        format: t('Pegawai peronda syarikat pengawal itu.', "A patrolling officer of the guard's company."),
        example: 'Synthetic patrolling officer',
        rule: t('Tidak perlu jika penerima sendiri pegawai peronda.', 'Not needed when the receiver is a patrolling officer.'),
      },
    ],
    sources: [{ what: t('Harga sewa atau jualan ditetapkan oleh Pengurus Inventori.', 'The rental or sale price is set by the Inventory Manager.'), askDesk: 'procurement' }],
    enteredOnce: t(
      'Pengawal, syarikat dan harga diambil daripada rekod sedia ada; bil Goodwill dibuat sendiri selepas pengawal mengakui terima. Jangan taip semula dalam bil.',
      "The guard, company and price come from existing records; Goodwill's bill is worked out once the guard acknowledges. Do not key it again into a bill.",
    ),
    actions: ['store.issue'],
    steps: {
      save: t('Keluarkan: stok berkurang dan barang menunggu OM.', 'Issue: stock goes down and the item waits for the OM.'),
      review: t('Tiada penyemak; OM, pegawai peronda dan pengawal mengakui terima mengikut urutan.', 'No reviewer; the OM, the patrolling officer and the guard each acknowledge in order.'),
      returned: t('Jika pengawal kata tidak terima, masalah itu direkod pada langkah itu.', 'If anyone says it did not arrive, the problem is recorded at that step.'),
      done: t('Selesai bila pengawal mengakui terima; dibil dari tarikh itu.', 'Done when the guard acknowledges; billed from that date.'),
      recover: t('Jika OM tiada dalam senarai, OM itu bukan di pihak kerajaan: minta Ketua Operasi Kerajaan.', 'If the OM is not in the list, they are not on the government side: ask the OGM.'),
    },
    notVerified: [t('Belum diuji pada telefon sebenar.', 'Not yet tested on a real phone.')],
  },
  {
    id: 'ops.goodwill.handover',
    status: 'ready',
    dept: 'Government Operations',
    title: t('Serahkan barang Goodwill: OM, pegawai peronda, pengawal', 'Pass on a Goodwill item: OM, patrolling officer, guard'),
    purpose: t(
      'Bukti setiap orang menerima barang, supaya jika pengawal kata tidak sampai, ada tandatangan dan cap jari fail (SHA-256).',
      'Proof that each person received the item, so if a guard says it never arrived there is a signature and a file fingerprint (SHA-256).',
    ),
    who: t('OM yang dinamakan; Ketua Operasi Kerajaan boleh merekod langkah pegawai peronda dan pengawal.', "The named OM; the OGM may record the patrolling officer's and guard's steps."),
    screen: { view: 'mine', name: 'Duty', action: t('Barang Goodwill: Terima, kemudian Serahkan dengan tandatangan atau slip.', 'Goodwill items: Receive, then Pass on with a signature or slip.') },
    allowed: (u) => canRecordHandover(u, today()),
    fields: [
      { key: 'signature', label: 'Sign on this screen', required: false, format: t('Tandatangan dengan jari di dalam kotak.', 'Sign with a finger inside the box.'), example: '(drawn signature)' },
      {
        key: 'slip',
        label: 'Signed slip',
        required: false,
        format: t('Gambar atau PDF slip yang ditandatangani.', 'A photo or PDF of the signed slip.'),
        example: 'slip.jpg',
        rule: t('Pegawai peronda: tandatangan ATAU slip. Pengawal: tandatangan ATAU slip berserta gambar pengawal memegang barang.', 'Patrolling officer: signature OR slip. Guard: signature OR slip plus a photo of the guard holding the item.'),
      },
      { key: 'photo', label: 'Photo of the guard with the item', required: false, format: t('Gambar JPEG atau PNG, bukan slip yang sama.', 'A JPEG or PNG photo, not the same file as the slip.'), example: 'guard.jpg' },
      { key: 'note', label: 'Note', required: false, format: t('Wajib jika barang tidak diterima.', 'Needed when the item was not received.'), example: 'Box damaged' },
    ],
    sources: [{ what: t('Barang yang dikeluarkan oleh stor Goodwill.', 'The item issued by the Goodwill store.'), askDesk: 'procurement' }],
    enteredOnce: t('Barang, penerima dan syarikat sudah ada pada pengeluaran stor. Hanya rekod terima atau tidak.', 'The item, receivers and company are already on the store issue. Only record received or not.'),
    actions: ['store.handover.om', 'store.handover.patrol', 'store.handover.guard', 'store.handover.disputed'],
    steps: {
      save: t('Ikut urutan: OM, pegawai peronda, pengawal.', 'In order: OM, patrolling officer, guard.'),
      review: t('Tiada penyemak; stor, OGM dan OM boleh buka Bukti untuk semak fail masih sama.', 'No reviewer; the store, OGM and OM can open Proof to check each file is unchanged.'),
      returned: t('Tidak diterima: tulis sebab; stor dan OGM nampak masalah itu.', 'Not received: write why; the store and OGM see the problem.'),
      done: t('Selesai bila pengawal mengakui terima.', 'Done when the guard acknowledges.'),
      recover: t('Langkah tersalah tidak boleh dipadam; laporkan masalah dan stor akan uruskan.', 'A step cannot be deleted; report the problem and the store deals with it.'),
    },
    notVerified: [
      t('Tandatangan jari belum diuji pada telefon sebenar.', 'The finger signature is not yet tested on a real phone.'),
      t('Lokasi telefon dilaporkan oleh telefon dan tidak disemak.', 'The phone location is as the phone reports it and is not checked.'),
    ],
  },
  ...(['government', 'private'] as const).map(
    (sector): OpsGuideCard => ({
      id: `ops.monitor.${sector}`,
      status: 'partial',
      dept: sector === 'government' ? 'Government Operations (Goodwill Empire)' : 'Private Operations (Sasa Team)',
      title:
        sector === 'government'
          ? t('Pantau tapak kerajaan: untung rugi, gaji, cuti, pelanggan', 'Monitor government sites: profit, pay, leave, clients')
          : t('Pantau tapak swasta: untung rugi, gaji, cuti, pelanggan', 'Monitor private sites: profit, pay, leave, clients'),
      purpose: t(
        'Untung rugi setiap tapak, semakan gaji pengawal daripada jam bekerja, pengawal bercuti dan kepuasan pelanggan. Yang tidak diketahui ditunjuk sebagai Unknown, bukan baik.',
        'Each site profit and loss, a check of guard pay from the hours worked, guards on leave, and client satisfaction. Anything missing shows as Unknown, never as fine.',
      ),
      who:
        sector === 'government'
          ? t('Ketua Operasi Kerajaan, OM dan Pengurus Wilayah kerajaan (kawasan sendiri), pimpinan kumpulan.', 'The OGM, government OMs and Regional OMs (own area), group leadership.')
          : t('Pengarah Operasi, OM dan Pengurus Wilayah swasta (kawasan sendiri), pimpinan kumpulan.', 'The Operations Director, private OMs and Regional OMs (own area), group leadership.'),
      screen: { view: 'ops', name: 'Regional ops', action: t('Panel tapak: pilih bulan dan tab.', 'Sites panel: choose the month and a tab.') },
      allowed: (u) => (sector === 'government' ? canGovOpsMonitor(u, today()) : canPrivateOpsMonitor(u, today())),
      fields: [],
      sources: [
        { what: t('Yuran pengurusan daripada perjanjian, dimasukkan oleh Kewangan.', 'The management fee from the agreement, entered by Finance.'), askDesk: 'finance' },
        { what: t('Kontrak dan invois pelanggan.', 'Client contracts and invoices.'), askDesk: 'company_office' },
      ],
      enteredOnce: t(
        'Semua angka diambil daripada kehadiran, kontrak, invois, bil asrama, barang Goodwill dan suapan gaji JA. Tiada yang ditaip di sini.',
        'Every figure comes from attendance, contracts, invoices, hostel bills, Goodwill items and the JA pay feed. Nothing is keyed here.',
      ),
      actions: [],
      steps: {
        save: t('Baca sahaja.', 'Read only.'),
        review: t('Tiada penyemak.', 'No reviewer.'),
        returned: t('Tiada.', 'None.'),
        done: t('Ikut tanda merah dan kuning.', 'Follow up the red and amber marks.'),
        recover: t('Unknown bermakna data belum ada: lihat nota tapak untuk apa yang kurang.', 'Unknown means data is missing: the site note says what.'),
      },
      notVerified: [
        t('Wang sebenar diterima belum disambung (menunggu PR Kewangan #49).', 'Money actually collected is not connected yet (waits on Finance PR #49).'),
        t('Gaji JA hanya diuji dengan data contoh.', 'JA pay is tested with synthetic data only.'),
      ],
    }),
  ),
  {
    id: 'fin.management_fee.enter',
    status: 'ready',
    dept: 'Finance',
    title: t('Masukkan yuran pengurusan daripada perjanjian', 'Enter a management fee from the agreement'),
    purpose: t(
      'Yuran yang dibayar setiap syarikat kepada Goodwill (tapak kerajaan) dan Sasa Team (tapak swasta). Untung rugi tapak kekal Unknown sehingga dimasukkan.',
      'The fee each company pays Goodwill (government sites) and Sasa Team (private sites). Site profit and loss stays Unknown until it is entered.',
    ),
    who: t('Pengarah Kewangan atau CEO.', 'The Finance Director or the CEO.'),
    screen: { view: 'finance', name: 'Finance', action: t('Yuran pengurusan: Masukkan atau Ubah pada syarikat itu.', 'Management fees: Enter or Change on that company.') },
    allowed: canSetManagementFee,
    fields: [
      { key: 'kind', label: 'Fee type', required: true, format: t('Peratus bil atau RM sebulan.', '% of billing or RM a month.'), example: '% of billing', choices: ['% of billing', 'RM a month'] },
      {
        key: 'value',
        label: 'Fee',
        required: true,
        format: t('Nombor lebih daripada 0.', 'A number above 0.'),
        example: '5',
        rule: t('Peratus mesti antara 0 dan 100.', 'A percentage must be between 0 and 100.'),
      },
      { key: 'agreementRef', label: 'Agreement reference', required: true, format: t('Rujukan perjanjian pengurusan yang ditandatangani.', 'The signed management agreement reference.'), example: 'SYN-MA-1' },
    ],
    sources: [{ what: t('Perjanjian pengurusan yang ditandatangani.', 'The signed management agreement.'), askDesk: null, askName: 'The company secretary or Legal, who keep the signed agreements' }],
    enteredOnce: t('Dimasukkan sekali; untung rugi tapak dan bil yuran bulanan mengira sendiri daripadanya.', 'Entered once; site profit and loss and the monthly fee bills work from it.'),
    actions: ['fin.management_fee'],
    steps: {
      save: t('Simpan: direkod dalam log audit dengan nilai lama.', 'Save: written to the audit log with the old value.'),
      review: t('Tiada penyemak.', 'No reviewer.'),
      returned: t('Tiada.', 'None.'),
      done: t('Berkuat kuasa serta-merta pada untung rugi.', 'Applies to profit and loss straight away.'),
      recover: t('Tersalah: ubah semula dengan rujukan yang betul; nilai lama kekal dalam log.', 'A mistake: change it again with the right reference; the old value stays in the log.'),
    },
    notVerified: [t('Jumlah yuran sebenar belum dimasukkan.', 'No real fee amounts are entered yet.')],
  },
  {
    id: 'fin.management_fee.bills',
    status: 'ready',
    dept: 'Finance',
    title: t('Semak bil yuran pengurusan bulanan', 'Check the monthly management fee bills'),
    purpose: t('Draf apa yang setiap syarikat berhutang kepada Goodwill dan Sasa Team, untuk dikeluarkan dalam SQL Account. Bukan invois.', 'A draft of what each company owes Goodwill and Sasa Team, to raise in SQL Account. Not an invoice.'),
    who: t('Kewangan, COO dan CEO; Ketua Operasi Kerajaan (Goodwill sahaja); Pengarah Operasi (Sasa Team sahaja).', 'Finance, the COO and the CEO; the OGM (Goodwill only); the Operations Director (Sasa Team only).'),
    screen: { view: 'finance', name: 'Finance', action: t('Bil yuran pengurusan (draf): pilih bulan.', 'Management fee bills (draft): choose the month.') },
    allowed: (u) => managementFeeBillScope(u).length > 0,
    fields: [],
    sources: [{ what: t('Yuran daripada perjanjian dan bil setiap tapak.', 'The fee from the agreement and each site billing.'), askDesk: 'finance' }],
    enteredOnce: t('Dikira daripada yuran yang dimasukkan dan bil tapak; jangan kira semula dengan tangan.', 'Worked out from the entered fee and site billing; do not work it out again by hand.'),
    actions: [],
    steps: {
      save: t('Baca sahaja; invois dikeluarkan dalam SQL Account.', 'Read only; the invoice is raised in SQL Account.'),
      review: t('Tiada penyemak.', 'No reviewer.'),
      returned: t('Tiada.', 'None.'),
      done: t('Bila tiada syarikat Unknown.', 'When no company shows Unknown.'),
      recover: t('Unknown: yuran belum dimasukkan atau bil tapak tidak diketahui.', 'Unknown: the fee is not entered or a site billing is not known.'),
    },
    notVerified: [t('SQL Account belum disambung.', 'SQL Account is not connected.')],
  },
  {
    id: 'client.rating',
    status: 'ready',
    dept: 'Operations',
    title: t('Rekod kepuasan pelanggan', 'Record client satisfaction'),
    purpose: t('Skor 1 hingga 5 daripada pelanggan sendiri, sekurang-kurangnya setiap 90 hari.', "A 1 to 5 score from the client themselves, at least every 90 days."),
    who: t('OM, Pengurus Wilayah, Ketua Operasi Kerajaan, Pengarah Operasi dan pegawai (kawasan sendiri).', 'OMs, Regional OMs, the OGM, the Operations Director and officers (own area).'),
    screen: { view: 'clients', name: 'Clients', action: t('Buka pelanggan, Bertindak, isi siapa dan bagaimana, pilih skor, Simpan.', 'Open the client, Act, fill in who and how, choose the score, Save rating.') },
    allowed: (u) => clientRoleOf(u) === 'act',
    fields: [
      { key: 'from', label: 'Who at the client', required: true, format: t('Nama dan jawatan orang di pihak pelanggan.', 'Name and position of the person at the client.'), example: 'Synthetic PIC, Facilities' },
      {
        key: 'via',
        label: 'How they said it',
        required: true,
        format: t('Pilih satu.', 'Choose one.'),
        example: 'meeting',
        choices: VIA,
        rule: t('Emel atau borang maklum balas: lampirkan emel atau borang itu.', 'Email or feedback form: attach the email or form.'),
      },
      { key: 'score', label: 'Satisfaction', required: true, format: t('1 hingga 5.', '1 to 5.'), example: '4' },
      {
        key: 'comment',
        label: 'Note',
        required: false,
        format: t('Apa kata pelanggan.', 'What the client said.'),
        example: 'Happy with the night shift',
        rule: t(`Wajib jika skor ${r.lowScore} atau kurang.`, `Needed when the score is ${r.lowScore} or less.`),
      },
    ],
    sources: [{ what: t('Mesyuarat, lawatan, panggilan, emel atau borang daripada pelanggan.', 'A meeting, visit, call, email or form from the client.'), askDesk: 'coo' }],
    enteredOnce: t('Skor terus ke papan pelanggan COO dan panel operasi; jangan rekod di tempat lain.', 'The score goes straight to the COO client board and the operations panels; do not record it anywhere else.'),
    actions: ['client.rating'],
    steps: {
      save: t('Simpan skor.', 'Save the rating.'),
      review: t('Tiada penyemak; COO dan pengurus syarikat memantau.', 'No reviewer; the COO and the company manager monitor.'),
      returned: t('Tiada.', 'None.'),
      done: t(
        `Skor ${r.lowScore} atau kurang: lawati atau bermesyuarat dengan pelanggan dalam ${r.followUpDays} hari.`,
        `A score of ${r.lowScore} or less: visit or meet the client within ${r.followUpDays} days.`,
      ),
      recover: t('Tersalah: rekod skor baharu; yang lama kekal dalam sejarah.', 'A mistake: record a new rating; the old one stays in the history.'),
    },
    notVerified: [t(`Had ${r.followUpDays} hari ialah cadangan.`, `The ${r.followUpDays}-day limit is a proposal.`)],
  },
  {
    id: 'client.complaint',
    status: 'ready',
    dept: 'Operations',
    title: t('Rekod dan tutup aduan pelanggan', 'Log and close a client complaint'),
    purpose: t('Setiap aduan kekal terbuka sehingga apa yang dibuat direkod.', 'Each complaint stays open until what was done is recorded.'),
    who: t('OM, Pengurus Wilayah, Ketua Operasi Kerajaan, Pengarah Operasi dan pegawai (kawasan sendiri).', 'OMs, Regional OMs, the OGM, the Operations Director and officers (own area).'),
    screen: { view: 'clients', name: 'Clients', action: t('Buka pelanggan, Bertindak, tulis aduan dalam nota, Rekod aduan; tutup dengan apa yang dibuat.', 'Open the client, Act, write the complaint in the note, Log complaint; close it with what was done.') },
    allowed: (u) => clientRoleOf(u) === 'act',
    fields: [
      { key: 'from', label: 'Who at the client', required: true, format: t('Nama dan jawatan.', 'Name and position.'), example: 'Synthetic PIC' },
      { key: 'via', label: 'How they said it', required: true, format: t('Pilih satu.', 'Choose one.'), example: 'call', choices: VIA },
      { key: 'what', label: 'Note', required: true, format: t('Apa aduannya.', 'What the complaint is.'), example: 'Gate left open at night' },
    ],
    sources: [{ what: t('Panggilan, emel atau mesyuarat dengan pelanggan.', 'The call, email or meeting with the client.'), askDesk: 'coo' }],
    enteredOnce: t('Aduan terus ke papan pelanggan dan panel operasi.', 'The complaint goes straight to the client board and the operations panels.'),
    actions: ['client.complaint', 'client.complaint_resolved'],
    steps: {
      save: t('Rekod aduan.', 'Log the complaint.'),
      review: t('Tiada penyemak; COO dan pengurus syarikat memantau.', 'No reviewer; the COO and the company manager monitor.'),
      returned: t('Tiada.', 'None.'),
      done: t(`Tutup dengan apa yang dibuat; lewat selepas ${r.complaintDays} hari.`, `Close it with what was done; overdue after ${r.complaintDays} days.`),
      recover: t('Aduan yang ditutup tidak boleh dibuka semula; rekod aduan baharu jika berulang.', 'A closed complaint cannot be reopened; log a new one if it happens again.'),
    },
    notVerified: [t(`Had ${r.complaintDays} hari dan ${r.complaintsWarn} aduan dalam 90 hari ialah cadangan.`, `The ${r.complaintDays}-day limit and ${r.complaintsWarn} complaints in 90 days are proposals.`)],
  },
];

import { actCanOwnFindings } from "./access";
import { actJobOf } from "./access";
import type { User } from "./types";


// ---- Local copy of the shared guide-card types (PR #56, packages/core/src/guide-cards.ts at 4989972) ----
// Kept here so this PR builds on its own. At the combined merge: delete this block, import GuideCardSpec, GuideField
// and GuideText from './guide-cards', and add registerGuideCards(ACT_GUIDE_CARDS) at the end of this file.
interface GuideText {
  bm: string;
  en: string;
}
interface GuideField {
  key: string;
  label: string;
  required: boolean;
  format: GuideText;
  example: string;
  choices?: string[];
  rule?: GuideText;
}
type GuideStatus = 'ready' | 'partial' | 'not_built';
type OrgDesk = 'hr' | 'it' | 'finance' | 'fwm' | 'procurement' | 'asset' | 'legal' | 'pdpa' | 'cms' | 'transport' | 'chief_of_staff' | 'director_office' | 'act' | 'company_office' | 'coo' | 'ceo';
export interface GuideCardSpec {
  id: string;
  status: GuideStatus;
  dept: string;
  title: GuideText;
  purpose: GuideText;
  who: GuideText;
  screen: { view: string | null; name: string; action: GuideText };
  enteredOnce: GuideText;
  steps: { save: GuideText; review: GuideText; returned: GuideText; done: GuideText; recover: GuideText };
  notVerified: GuideText[];
  allowed: (user: User) => boolean;
  fields?: GuideField[];
  sources: { what: GuideText; askDesk: OrgDesk | null; askName?: string }[];
  actions?: string[];
}
// ---- end of local copy ----

const t = (bm: string, en: string): GuideText => ({ bm, en });
const text = (key: string, label: string, required: boolean, max = 160): GuideField => ({
  key,
  label,
  required,
  format: t(`Teks, paling banyak ${max} aksara.`, `Text, at most ${max} characters.`),
  example: 'CONTOH / EXAMPLE',
});
const date = (key: string, label: string, required: boolean): GuideField => ({
  key,
  label,
  required,
  format: t('Tarikh sebenar dalam kalendar.', 'A real calendar date.'),
  example: '31/01/2027',
});

const FINDING_SOURCE = {
  what: t('Dapatan ACT itu sendiri: rujukan ACT-nnnn, bukti yang ACT lihat dan tarikh akhir.', 'The ACT finding itself: its ACT-nnnn reference, the evidence ACT saw and the due date.'),
  askDesk: 'act' as const,
};
const UNVERIFIED = t(
  'Jika bukti tiada atau belum disemak, ia kekal "Belum disahkan"; ACT tidak menandakannya hijau.',
  'If evidence is missing or not yet checked, it stays "Unresolved"; ACT never marks it green.',
);
const NO_LIVE = t('Belum digunakan di pelayan sebenar; diuji dengan data rekaan sahaja.', 'Not yet in use on a live server; tested with made-up data only.');

const isDirector = (u: Parameters<typeof actJobOf>[0]) => actJobOf(u) === 'director';
// C6 (Fauzan, 11 Nov 2026): the ACT Manager also checks fixes and records the teams' work.
const isAuditorOrDirector = (u: Parameters<typeof actJobOf>[0]) => actJobOf(u) === 'auditor' || actJobOf(u) === 'director' || actJobOf(u) === 'manager';

export const ACT_GUIDE_CARDS: GuideCardSpec[] = [
  {
    id: 'act.owner.plan',
    status: 'ready',
    dept: 'ACT',
    title: t('Rancang pembetulan dapatan ACT', 'Plan the fix for an ACT finding'),
    purpose: t('Terangkan punca, apa yang akan diubah dan bila siap.', 'Say the cause, what you will change and when it will be done.'),
    who: t('Hanya pemilik yang dinamakan pada dapatan itu.', 'Only the owner named on that finding.'),
    screen: { view: 'act', name: 'ACT', action: t('Dapatan saya: isi Punca, Pembetulan dan Siap pada, kemudian Simpan rancangan.', 'My findings: fill in Cause, Fix and Done by, then Save the plan.') },
    allowed: actCanOwnFindings,
    fields: [text('rootCause', 'Cause', true), text('solution', 'Fix', true), date('targetOn', 'Done by', true)],
    sources: [FINDING_SOURCE],
    enteredOnce: t('Butiran dapatan sudah dikunci oleh ACT. Jangan taip semula; isi hanya rancangan anda.', 'The finding was keyed by ACT. Do not type it again; enter only your plan.'),
    steps: {
      save: t('Simpan rancangan; ACT nampak serta-merta.', 'Save the plan; ACT sees it at once.'),
      review: t('Pasukan ACT yang memegang dapatan itu membaca rancangan.', 'The ACT team holding the finding reads the plan.'),
      returned: t('Jika pembetulan gagal disemak, dapatan kembali kepada anda dengan nota ACT.', 'If the fix fails the check, the finding comes back to you with ACT’s note.'),
      done: t('Rancangan disimpan atas nama anda.', 'The plan is saved under your name.'),
      recover: t('Tiada rancangan 5 hari selepas dibuka: Penguatkuasa ACT akan menghubungi anda (cadangan).', 'No plan 5 days after it was raised: ACT Enforcement will contact you (proposal).'),
    },
    notVerified: [UNVERIFIED, t('Tempoh 5 hari dan susulan 7 hari masih cadangan.', 'The 5-day and 7-day follow-up timings are still proposals.'), NO_LIVE],
  },
  {
    id: 'act.owner.fix',
    status: 'ready',
    dept: 'ACT',
    title: t('Tanda dapatan ACT sudah dibetulkan', 'Mark an ACT finding fixed'),
    purpose: t('Berikan bukti pembetulan supaya ACT boleh menyemak.', 'Give proof of the fix so ACT can check it.'),
    who: t('Hanya pemilik yang dinamakan pada dapatan itu, selepas rancangan disimpan.', 'Only the owner named on the finding, after the plan is saved.'),
    screen: { view: 'act', name: 'ACT', action: t('Dapatan saya: isi Bukti, kemudian Tanda sudah dibetulkan.', 'My findings: fill in Proof, then Mark fixed.') },
    allowed: actCanOwnFindings,
    fields: [text('proof', 'Proof', true)],
    sources: [{ what: t('Rekod selepas pembetulan dalam skrin aliran kerja itu (nombor rekod, gambar atau prosedur baru).', 'The records after the fix in that workflow’s screen (record numbers, photos or the new procedure).'), askDesk: null, askName: 'The people who keep that workflow’s records' }],
    enteredOnce: t('Rujuk nombor rekod yang sudah ada; jangan salin data ke dalam bukti.', 'Refer to the record numbers that already exist; do not copy the data into the proof.'),
    steps: {
      save: t('Bukti kosong ditolak.', 'Empty proof is refused.'),
      review: t('Juruaudit pasukan menyemak; dapatan tinggi perlu semakan kedua oleh Pengurus ACT sebelum ditutup.', 'The team Auditor checks it; a high finding also needs the ACT Manager’s second check before it closes.'),
      returned: t('Jika tidak berkesan, dapatan kembali dengan nota; betulkan dan tanda semula.', 'If it does not work, it comes back with a note; fix it and mark it again.'),
      done: t('Ditutup oleh ACT atas nama penyemak.', 'Closed by ACT under the checker’s name.'),
      recover: t('Jika butang tiada, dapatan bukan atas nama anda: tanya ACT.', 'If the button is missing, the finding is not in your name: ask ACT.'),
    },
    notVerified: [UNVERIFIED, NO_LIVE],
  },
  {
    id: 'act.check',
    status: 'ready',
    dept: 'ACT',
    title: t('Semak pembetulan dapatan', 'Check the fix for a finding'),
    purpose: t('Sahkan pembetulan berkesan sebelum menutup.', 'Confirm the fix works before closing.'),
    who: t('Juruaudit pasukan yang memegang dapatan, Pengurus ACT atau Pengarah ACT. Dapatan tinggi: semakan pertama, kemudian semakan kedua oleh Pengurus ACT (bukan penyemak pertama atau orang yang membangkitkannya).', 'The Auditor of the team holding the finding, the ACT Manager or the ACT Director. High findings: a first check, then the ACT Manager’s second check (never the first checker or whoever raised it).'),
    screen: { view: 'act', name: 'ACT', action: t('Dapatan: isi Apa yang disemak, kemudian Berkesan, tutup atau Belum settle.', 'Findings: fill in What you checked, then Fix works, close or Not fixed.') },
    allowed: isAuditorOrDirector,
    fields: [text('note', 'What you checked', true)],
    sources: [{ what: t('Bukti pemilik dan rekod semasa dalam Prima.', 'The owner’s proof and the current records in Prima.'), askDesk: null, askName: 'The owner named on the finding' }],
    enteredOnce: t('Bukti pemilik sudah ada pada dapatan; catat hanya apa yang anda semak.', 'The owner’s proof is already on the finding; record only what you checked.'),
    steps: {
      save: t('Nota semakan wajib.', 'A check note is required.'),
      review: t('Tiada penyemak kedua untuk sederhana dan rendah; tinggi ditutup selepas semakan kedua Pengurus ACT.', 'No second checker for medium and low; high closes after the ACT Manager’s second check.'),
      returned: t('Belum settle menghantar dapatan kembali kepada pemilik.', 'Not fixed sends the finding back to the owner.'),
      done: t('Ditutup dengan nama dan nota anda.', 'Closed with your name and note.'),
      recover: t('Pasukan lain tidak boleh menyemak; minta Pengurus atau Pengarah ACT menyerahkannya.', 'The other team cannot check it; ask the ACT Manager or the ACT Director to give it to you.'),
    },
    notVerified: [UNVERIFIED, NO_LIVE],
  },
  {
    id: 'act.follow_up',
    status: 'ready',
    dept: 'ACT',
    title: t('Susulan pemilik yang lewat', 'Follow up an owner who is late'),
    purpose: t('Rekod cara susulan, janji pemilik dan tarikh seterusnya.', 'Record how you followed up, what the owner promised and the next date.'),
    who: t('Pegawai Penguatkuasa atau Juruaudit pasukan yang memegang dapatan, atau Pengarah ACT.', 'The Enforcement officer or Auditor of the team holding the finding, or the ACT Director.'),
    screen: { view: 'act', name: 'ACT', action: t('Dapatan: pilih cara, isi Apa kata pemilik, kemudian Rekod susulan.', 'Findings: choose how, fill in What the owner said, then Record follow-up.') },
    allowed: (u) => actJobOf(u) !== null,
    fields: [
      { key: 'method', label: 'How you followed up', required: true, format: t('Pilih satu daripada senarai.', 'Choose one from the list.'), example: 'Phone call', choices: ['Phone call', 'Message', 'Email', 'Visit', 'Meeting', 'Memo'] },
      text('note', 'What the owner said', true),
      date('nextOn', 'Next follow-up', false),
    ],
    sources: [{ what: t('Senarai Susulan perlu dalam tab Dapatan ACT.', 'The Follow-ups due list on the ACT Findings tab.'), askDesk: 'act' }],
    enteredOnce: t('Dapatan dan tarikh akhir sudah direkod; catat hanya susulan. Pemilik tidak nampak log ini.', 'The finding and due date are already recorded; enter only the follow-up. Owners do not see this log.'),
    steps: {
      save: t('Nota wajib.', 'A note is required.'),
      review: t('Tiada penyemak; Pengarah melihat susulan.', 'No reviewer; the Director sees follow-ups.'),
      returned: t('Tidak berkenaan.', 'Not applicable.'),
      done: t('Dapatan keluar dari senarai susulan hingga tarikh seterusnya (atau 7 hari).', 'The finding leaves the follow-up list until the next date (or 7 days).'),
      recover: t('Pemilik tidak bertindak: beritahu Pengarah ACT; tiada tindakan disiplin automatik.', 'Owner does not act: tell the ACT Director; there is no automatic discipline.'),
    },
    notVerified: [t('Kitaran 7 hari masih cadangan.', 'The 7-day cycle is still a proposal.'), NO_LIVE],
  },
  {
    id: 'act.work.done',
    status: 'ready',
    dept: 'ACT',
    title: t('Rekod kerja yang diberi Pengarah (audit atau semakan laporan)', 'Record work the Director gave you (audit or report review)'),
    purpose: t('Tutup audit aliran kerja atau semakan laporan bulanan yang diberi kepada pasukan anda.', 'Close a workflow audit or monthly report review given to your team.'),
    who: t('Juruaudit pasukan yang diberi kerja itu, atau Pengarah ACT.', 'The Auditor of the team given the work, or the ACT Director.'),
    screen: { view: 'act', name: 'ACT', action: t('Kerja pasukan: isi Siap pada, Keputusan dan Apa yang disemak, kemudian Rekod siap.', 'Team work: fill in Done on, Result and What was checked, then Record done.') },
    allowed: isAuditorOrDirector,
    fields: [
      date('doneOn', 'Done on', true),
      { key: 'result', label: 'Result', required: true, format: t('Pilih satu daripada senarai.', 'Choose one from the list.'), example: 'Clean', choices: ['Clean', 'Findings raised'] },
      text('note', 'What was checked', false),
    ],
    sources: [
      { what: t('Rekod sampel dalam skrin aliran kerja itu.', 'Sample records in that workflow’s screen.'), askDesk: null, askName: 'The people who keep that workflow’s records' },
      { what: t('Laporan bulanan dalam senarai laporan Pejabat Pengarah.', 'The monthly report in the Director Office report list.'), askDesk: 'director_office' },
    ],
    enteredOnce: t('Laporan dihantar sekali melalui Pejabat Pengarah; ACT membaca yang sama dan tidak meminta salinan.', 'Reports are sent once through the Director Office; ACT reads the same submission and never asks for a copy.'),
    steps: {
      save: t('Tarikh siap wajib.', 'The done date is required.'),
      review: t('Pengarah melihat kerja terbuka dan lewat.', 'The Director sees open and overdue work.'),
      returned: t('Masalah dijadikan dapatan dengan pemilik.', 'Problems become findings with an owner.'),
      done: t('Kerja ditutup; audit dikira untuk pelan audit.', 'The work is closed and counts toward the audit plan.'),
      recover: t('Pasukan lain tidak boleh merekodnya; minta Pengarah memindahkan.', 'The other team cannot record it; ask the Director to move it.'),
    },
    notVerified: [NO_LIVE],
  },
  {
    id: 'act.timing.set',
    status: 'ready',
    dept: 'ACT',
    title: t('Tetapkan masa aliran kerja', 'Set a workflow’s timing'),
    purpose: t('Selepas semakan, tetapkan kekerapan audit dan masa setiap langkah.', 'After a review, set the audit frequency and the time for each step.'),
    who: t('Pengarah ACT sahaja.', 'The ACT Director only.'),
    screen: { view: 'act', name: 'ACT', action: t('Masa aliran kerja: Tetapkan masa, pilih audit asas, isi langkah dan sebab, kemudian Simpan.', 'Workflow timing: Set timing, choose the review, fill in the steps and reason, then Save.') },
    allowed: isDirector,
    fields: [
      text('step', 'Step 1', true),
      { key: 'target', label: 'Time', required: true, format: t('Nombor, dalam jam atau hari bekerja (9 jam).', 'A number, in hours or working days (9 hours).'), example: '4' },
      text('reason', 'Why', true),
    ],
    sources: [{ what: t('Audit aliran kerja yang sudah selesai dan semakan lapangan.', 'The finished workflow audit and field checks.'), askDesk: 'act' }],
    enteredOnce: t('Masa disimpan sekali dan dibaca oleh skrin lain (workStandardHours); jangan simpan salinan berasingan.', 'Timing is saved once and read by other screens (workStandardHours); keep no separate copy.'),
    steps: {
      save: t('Perlu audit yang sudah selesai; sebab wajib.', 'Needs a finished audit; a reason is required.'),
      review: t('Tiada penyemak kedua; setiap perubahan disimpan dengan sebab.', 'No second checker; every change is kept with its reason.'),
      returned: t('Tidak berkenaan.', 'Not applicable.'),
      done: t('Perubahan terkini berkuat kuasa.', 'The latest change is in force.'),
      recover: t('Tiada audit lagi: rekod audit aliran kerja dahulu.', 'No audit yet: record a workflow audit first.'),
    },
    notVerified: [t('Di PostgreSQL, orang di luar ACT belum boleh membaca masa ini sehingga salinan terbit ditambah.', 'On PostgreSQL, people outside ACT cannot read these timings until a published copy is added.'), NO_LIVE],
  },
  {
    id: 'act.field_check',
    status: 'ready',
    dept: 'ACT',
    title: t('Semakan lapangan aliran kerja (setiap 6 bulan)', 'Field check of a workflow (every 6 months)'),
    purpose: t('Rekod apa yang benar-benar berlaku di setiap langkah di tempat kerja.', 'Record what actually happens at each step at the workplace.'),
    who: t('Mana-mana kakitangan ACT.', 'Any ACT staff member.'),
    screen: { view: 'act', name: 'ACT', action: t('Masa aliran kerja: Rekod semakan lapangan, isi tempat, tarikh dan masa sebenar setiap langkah.', 'Workflow timing: Record field check, fill in where, when and the real time of each step.') },
    allowed: (u) => actJobOf(u) !== null,
    fields: [
      text('where', 'Where', true),
      text('step', 'Step 1', true),
      { key: 'actual', label: 'Time seen', required: true, format: t('Nombor, dalam jam atau hari.', 'A number, in hours or days.'), example: '5' },
    ],
    sources: [{ what: t('Pemerhatian anda di tempat kerja sebenar.', 'Your own observations at the real workplace.'), askDesk: null, askName: 'The head of the department that runs the workflow' }],
    enteredOnce: t('Langkah dan masa sasaran diambil dari daftar masa; isi hanya masa sebenar.', 'Steps and target times come from the timing register; enter only the real times.'),
    steps: {
      save: t('Tempat dan sekurang-kurangnya satu langkah wajib.', 'The place and at least one step are required.'),
      review: t('Pengarah melihat langkah yang lebih perlahan daripada sasaran.', 'The Director sees steps slower than target.'),
      returned: t('Masalah dijadikan dapatan dengan pemilik.', 'Problems become findings with an owner.'),
      done: t('Semakan seterusnya jatuh tempo 6 bulan kemudian.', 'The next check falls due 6 months later.'),
      recover: t('Belum pernah disemak atau lewat: tidak hijau.', 'Never checked or overdue: not green.'),
    },
    notVerified: [t('Gambar disimpan bersama dapatan, bukan pada semakan lapangan.', 'Photos go with a finding, not on the field check.'), NO_LIVE],
  },
  {
    id: 'act.investigation',
    status: 'ready',
    dept: 'ACT',
    title: t('Semak corak rekod dalam siasatan', 'Check a record pattern in an investigation'),
    purpose: t('Buka fail siasatan dari padanan atau corak rekod, simpan bukti dengan hash dan rekod setiap langkah. Corak bukan bukti dan bukan tuduhan; manusia yang mengesahkan.', 'Open an investigation file from a record match or pattern, keep evidence with its hash and record every step. A pattern is not proof and not an accusation; a person verifies it.'),
    who: t('Pengarah ACT atau Juruaudit membuka; pasukan yang diberi menambah bukti dan nota; hanya Pengarah menutup.', 'The ACT Director or an Auditor opens it; the team given it adds evidence and notes; only the Director closes.'),
    screen: { view: 'act', name: 'ACT', action: t('Corak dan siasatan: Buka siasatan, tambah bukti dan nota; Pengarah menutup dengan keputusan.', 'Patterns and investigations: Open investigation, add evidence and notes; the Director closes with the outcome.') },
    allowed: isAuditorOrDirector,
    fields: [
      text('title', 'Investigation title', true),
      text('note', 'What started it', true),
      text('source', 'Where it came from', true, 300),
      { key: 'outcome', label: 'Outcome', required: true, format: t('Pilih satu daripada senarai.', 'Choose one from the list.'), example: 'Not substantiated', choices: ['Substantiated', 'Not substantiated', 'Referred'] },
    ],
    sources: [
      { what: t('Senarai corak rekod dalam tab Corak dan siasatan.', 'The record pattern list on the Patterns and investigations tab.'), askDesk: 'act' },
      { what: t('Rekod asal dalam skrin jabatan itu (tuntutan, jam, pembekal, sewa).', 'The original records in that department’s screen (claims, clocks, suppliers, rent).'), askDesk: null, askName: 'The people who keep those records' },
    ],
    enteredOnce: t('Corak dikira daripada rekod sedia ada; jangan salin data ke fail siasatan, lampirkan salinan rekod sahaja.', 'Patterns come from records already kept; do not retype the data, attach a copy of the record only.'),
    steps: {
      save: t('Tajuk dan sebab wajib; fail yang sama tidak boleh dilampir dua kali.', 'A title and reason are required; the same file cannot be attached twice.'),
      review: t('Pengarah ACT membaca dan menutup; setiap buka, tambah dan lihat bukti direkod.', 'The ACT Director reads and closes it; every open, add and view of evidence is logged.'),
      returned: t('Tidak berkenaan.', 'Not applicable.'),
      done: t('Ditutup dengan keputusan dan sebab; rujukan ke HR atau Undang-undang yang memutuskan sebarang tindakan.', 'Closed with the outcome and reason; a referral goes to HR or Legal, who decide any action.'),
      recover: t('Pasukan lain tidak boleh membuka fail; minta Pengarah memberikannya.', 'The other team cannot open the file; ask the Director to give it to you.'),
    },
    notVerified: [
      t('Corak bukan bukti; tiada tindakan disiplin automatik.', 'A pattern is not proof; there is no automatic discipline.'),
      t('Had masa lihat semula, tetingkap jam dan had fail masih cadangan.', 'The look-back, the clock window and the file limits are still proposals.'),
      NO_LIVE,
    ],
  },
];

// Registered at the combined merge with #56: registerGuideCards(ACT_GUIDE_CARDS);

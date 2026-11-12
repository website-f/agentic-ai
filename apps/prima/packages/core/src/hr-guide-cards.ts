/**
 * HR task guide cards (Arisha main review, 2 Nov 2026, section A), in the shared guide-card shape of PR #56
 * (packages/core/src/guide-cards.ts: GuideCardSpec). Read-only help: a card never saves, approves, sends, provisions or
 * pays. Bahasa Melayu first, with English. No invented fields, documents or contacts; whom to ask is a hand-over desk,
 * never a named person. Never ask for passwords or MFA codes.
 *
 * `allowed` calls the same rule the server uses to let a person start the task (hr.ts), so a card shows only to people
 * who may do it; the server still checks the company, the record and every step.
 *
 * Until #56 merges, the shape is kept here structurally (HrGuideCardSpec); after it merges, HR registers these with
 * registerGuideCards(HR_GUIDE_CARDS) and Arisha reads them through GET /api/org/guide like every other department.
 */
import { isHrDirector } from './access';
import { guardPaperKeeper, hrKeeps, staffClockUser, staffPayStepper, vcConsents } from './hr';
import { RECORD_KINDS } from './records';
import type { User } from './types';

export interface HrGuideText {
  bm: string;
  en: string;
}
const t = (bm: string, en: string): HrGuideText => ({ bm, en });

/** The hand-over desks (#56 OrgDesk) HR cards point to. */
export type HrGuideDesk = 'hr' | 'it' | 'finance' | 'chief_of_staff' | 'company_office' | 'coo' | 'ceo';

export interface HrGuideField {
  key: string;
  label: string;
  required: boolean;
  format: HrGuideText;
  example: string;
  choices?: string[];
  rule?: HrGuideText;
}

/** Same fields as #56's GuideCardSpec. */
export interface HrGuideCardSpec {
  id: string;
  status: 'ready' | 'partial' | 'not_built';
  dept: string;
  title: HrGuideText;
  purpose: HrGuideText;
  who: HrGuideText;
  screen: { view: string | null; name: string; action: HrGuideText };
  allowed: (user: User) => boolean;
  recordKind?: 'officeStaff';
  fields?: HrGuideField[];
  sources: { what: HrGuideText; askDesk: HrGuideDesk | null; askName?: string }[];
  enteredOnce: HrGuideText;
  actions?: string[];
  steps: { save: HrGuideText; review: HrGuideText; returned: HrGuideText; done: HrGuideText; recover: HrGuideText };
  notVerified: HrGuideText[];
}

// ---------- The card texts (checked against the named service methods) ----------

interface HrCardText {
  id: string;
  title: HrGuideText;
  purpose: HrGuideText;
  screen: HrGuideText;
  fields: { name: HrGuideText; required: boolean; format: string }[];
  source: HrGuideText;
  reuse: HrGuideText;
  after: HrGuideText;
  errors: HrGuideText;
  checkedAgainst: string;
}

const f = (bm: string, en: string, required: boolean, format: string) => ({ name: { bm, en }, required, format });

const TEXT: HrCardText[] = [
  {
    id: 'leave-apply',
    title: { bm: 'Mohon cuti', en: 'Apply for leave' },
    purpose: { bm: 'Memohon cuti tahunan, cuti sakit atau cuti lain untuk diri sendiri.', en: 'Apply for annual, sick or other leave for yourself.' },
    screen: { bm: 'My details → Leave → Ask for leave', en: 'My details → Leave → Ask for leave' },
    fields: [
      f('Jenis cuti', 'Kind of leave', true, 'Pilih daripada senarai · choose from the list'),
      f('Dari', 'From', true, 'YYYY-MM-DD, contoh · e.g. 2026-11-10'),
      f('Hingga', 'To', true, 'YYYY-MM-DD, contoh · e.g. 2026-11-11'),
      f('Sebab', 'Reason', true, 'Ayat pendek · short sentence, e.g. "Urusan keluarga"'),
      f('Penyakit, klinik, no. siri MC dan gambar MC', 'Illness, clinic, MC serial number and MC photo', false, 'Untuk cuti sakit sahaja · sick leave only, e.g. MC-TEST-0001'),
    ],
    source: { bm: 'Sijil MC asal daripada klinik untuk cuti sakit; maklumkan syarikat dalam 48 jam. Jika ada yang tidak pasti, tanya HR.', en: 'The original MC from the clinic for sick leave; tell the company within 48 hours. If anything is unclear, ask HR.' },
    reuse: { bm: 'Nama, syarikat dan cawangan diambil daripada rekod anda. Hari bekerja dikira automatik (hujung minggu dan cuti umum negeri tidak dikira).', en: 'Your name, company and branch come from your record. Working days are counted for you (weekends and your state’s public holidays are not counted).' },
    after: { bm: 'HR meluluskan atau menolak dengan komen, kemudian Naib Pengerusi memberi persetujuan. Permohonan yang dihantar tidak boleh diubah. Jika ditolak, sebabnya ditunjukkan; tekan "Correct and send again" untuk membuka permohonan baharu dengan butiran yang sama, betulkan dan hantar. Yang ditolak kekal dalam rekod.', en: 'HR approves or refuses with a comment, then the Vice Chairman consents. A sent request cannot be edited. If refused, the reason is shown; press "Correct and send again" to open a new request with the same details, correct it and send. The refused one stays on record.' },
    errors: { bm: 'Ditolak serta-merta dengan sebabnya jika: cuti tahunan atau tanpa gaji dipohon selepas hari itu, lebih 60 hari, MC tiada atau butiran MC kosong, atau MC yang sama telah digunakan. Betulkan dan hantar semula.', en: 'Refused at once, with the reason, when: annual or unpaid leave is asked after the day, more than 60 days, the MC or its details are missing, or the same MC was already used. Correct it and send again.' },
    checkedAgainst: 'requestLeave, decideLeave; browser run hr-leave-browser-uat (apply, refuse, correct, resend, approve, consent)',
  },
  {
    id: 'clock-in',
    title: { bm: 'Daftar masuk dan keluar', en: 'Clock in and out' },
    purpose: { bm: 'Merekod waktu kerja anda.', en: 'Record your working time.' },
    screen: { bm: 'Clock', en: 'Clock' },
    fields: [f('Gambar wajah atau gambar bercop masa', 'Face or time-stamped photo', true, 'Kamera telefon · phone camera')],
    source: { bm: 'Daftar wajah anda sekali; HR meluluskannya. Sebelum diluluskan, gambar bercop masa digunakan.', en: 'Register your face once; HR approves it. Until then a time-stamped photo is used.' },
    reuse: { bm: 'Wajah yang diluluskan digunakan setiap kali; tidak perlu daftar semula.', en: 'The approved face is used every time; no need to register again.' },
    after: { bm: 'Tiada kelulusan untuk setiap daftar masuk. Semakan wajah ditunjukkan sebagai menunggu sehingga pelayan selesai menyemak.', en: 'No approval for each clock in. The face check shows as pending until the server has checked it.' },
    errors: { bm: 'Jika wajah tidak sepadan, HR akan nampak bendera itu. Jika wajah anda ditolak, daftar semula dengan gambar yang jelas.', en: 'If the face does not match, HR sees the flag. If your face was refused, register again with a clear photo.' },
    checkedAgainst: 'staffClockIn, registerFace, decideFace',
  },
  {
    id: 'flex-request',
    title: { bm: 'Mohon waktu atau hari kerja fleksibel', en: 'Ask for flexible hours or days' },
    purpose: { bm: 'Meminta perubahan waktu atau hari kerja.', en: 'Ask to change your working hours or days.' },
    screen: { bm: 'Clock → Ask for flexible hours or days', en: 'Clock → Ask for flexible hours or days' },
    fields: [
      f('Jenis', 'Kind', true, 'Waktu atau hari · hours or days'),
      f('Butiran', 'Detail', true, 'contoh · e.g. "9.30 pagi hingga 6.30 petang"'),
      f('Sebab', 'Reason', true, 'Ayat pendek · short sentence'),
      f('Dari', 'From', true, 'YYYY-MM-DD'),
      f('Hingga', 'To', false, 'YYYY-MM-DD, kosong jika berterusan · blank if ongoing'),
    ],
    source: { bm: 'Tiada dokumen diperlukan.', en: 'No document needed.' },
    reuse: { bm: 'Rekod anda diambil automatik.', en: 'Your record is filled in for you.' },
    after: { bm: 'HR menjawab secara bertulis dalam 60 hari, dengan komen. Kerja dari rumah hanya untuk staf yang dibenarkan HR.', en: 'HR answers in writing within 60 days, with a comment. Working from home is only for staff HR allows.' },
    errors: { bm: 'Jika ditolak, baca sebabnya dan mohon semula jika perlu.', en: 'If refused, read the reason and apply again if needed.' },
    checkedAgainst: 'requestFlex, decideFlex',
  },
  {
    id: 'policies-appraisal',
    title: { bm: 'Polisi, latihan dan penilaian saya', en: 'My policies, training and appraisal' },
    purpose: { bm: 'Membaca polisi terkini, melihat latihan dan memberi komen pada penilaian tahunan.', en: 'Read the latest policies, see your training and comment on your yearly appraisal.' },
    screen: { bm: 'Clock (bahagian polisi, penilaian dan latihan)', en: 'Clock (policies, appraisal and training sections)' },
    fields: [f('Komen penilaian', 'Appraisal comment', false, 'Ayat pendek · short sentence')],
    source: { bm: 'HR menerbitkan polisi dan merekod latihan. Penilai anda dinamakan oleh HR.', en: 'HR publishes policies and records training. HR names your appraiser.' },
    reuse: { bm: 'Latihan yang HR rekod terus muncul; anda tidak perlu muat naik sijil semula.', en: 'Training HR records shows here; you do not upload certificates again.' },
    after: { bm: 'Pengesahan polisi disimpan untuk versi itu. Versi baharu akan meminta pengesahan semula. HR menutup penilaian dengan komen.', en: 'Your acknowledgement is kept for that version; a new version asks again. HR closes the appraisal with a comment.' },
    errors: { bm: 'Butang pengesahan hanya aktif selepas anda membuka teks polisi.', en: 'The acknowledge button works only after you open the policy text.' },
    checkedAgainst: 'acknowledgePolicy, commentAppraisal',
  },
  {
    id: 'osh-incident',
    title: { bm: 'Lapor kemalangan atau kejadian berbahaya di pejabat', en: 'Report an office accident or dangerous occurrence' },
    purpose: { bm: 'Merekod kejadian supaya laporan JKKP dibuat tepat masa.', en: 'Record it so the DOSH (JKKP) report is made on time.' },
    screen: { bm: 'HR → OSH pejabat (penyelaras: Clock)', en: 'HR → Office OSH (the coordinator: Clock)' },
    fields: [
      f('Syarikat', 'Company', true, 'Pilih · choose'),
      f('Jenis kejadian', 'Kind of incident', true, 'Kemalangan, kejadian berbahaya, keracunan, penyakit · accident, dangerous occurrence, poisoning, disease'),
      f('Tarikh', 'Date', true, 'YYYY-MM-DD'),
      f('Staf terlibat', 'Staff involved', false, 'Pilih · choose'),
      f('Serius (kematian atau cedera parah)', 'Serious (death or serious injury)', true, 'Ya/Tidak · yes/no'),
      f('Penerangan', 'Description', true, 'contoh · e.g. "Tergelincir di pantri"'),
    ],
    source: { bm: 'Laporan saksi atau penyelia. Rujukan JKKP direkod selepas dihantar kepada DOSH; Prima tidak menghantarnya.', en: 'The witness or supervisor’s account. The JKKP reference is recorded after it is sent to DOSH; Prima does not send it.' },
    reuse: { bm: 'Staf dipilih daripada rekod sedia ada.', en: 'Staff are picked from existing records.' },
    after: { bm: 'JKKP 6 (JKKP 7 bagi penyakit) perlu dalam 7 hari. HR atau penyelaras merekod rujukan DOSH.', en: 'JKKP 6 (JKKP 7 for a disease) is due within 7 days. HR or the coordinator records the DOSH reference.' },
    errors: { bm: 'Hanya HR, penyelaras OSH syarikat itu atau pengurus syarikat boleh melapor.', en: 'Only HR, that company’s OSH coordinator or the company manager can report.' },
    checkedAgainst: 'reportOshIncident, recordOshReport',
  },
  {
    id: 'new-staff',
    title: { bm: 'Staf pejabat baharu', en: 'New office staff member' },
    purpose: { bm: 'Membuka rekod staf sekali, untuk digunakan oleh semua jabatan.', en: 'Open the staff record once, for every department to use.' },
    screen: { bm: 'People → Tambah', en: 'People → Add' },
    fields: [
      f('No. staf, nama, jawatan, cawangan', 'Staff no, name, job title, branch', true, 'contoh · e.g. PWV900, Staf Ujian, HR Executive'),
      f('Jenis pekerjaan, tarikh mula, tamat percubaan', 'Employment type, start date, probation end', true, 'YYYY-MM-DD'),
      f('Warganegara, IC penuh, jantina, tarikh lahir, telefon', 'Nationality, full IC, gender, date of birth, phone', true, 'IC contoh · e.g. 770707-07-7777 (sintetik · synthetic)'),
      f('Bank, akaun gaji penuh, gaji pokok, sebab gaji', 'Bank, full salary account, basic pay, pay reason', true, 'contoh · e.g. RM3,000, "Surat tawaran"'),
    ],
    source: { bm: 'Mulakan daripada permohonan kemasukan yang diluluskan dan surat tawaran. Pemilik HR memberi tarikh pekerjaan dan tarikh berkuat kuasa. Akaun Microsoft diuruskan oleh pemilik identiti IT. Jangan sekali-kali minta kata laluan atau kod MFA.', en: 'Start from the approved onboarding request and the offer letter. The HR owner gives the employment and effective dates. The Microsoft account is handled by the IT identity owner. Never ask for passwords or MFA codes.' },
    reuse: { bm: 'IC dan akaun penuh disimpan di sebalik dinding HR; skrin lain hanya tunjuk nombor bertopeng. Gaji, cuti, latihan dan fail HR guna rekod yang sama.', en: 'The full IC and account go behind the HR wall; other screens show masked numbers. Pay, leave, training and the HR file use the same record.' },
    after: { bm: 'Skop peranan atau syarikat dalam sistem memerlukan kelulusan Ketua Staf dan Ketua Syarikat berkenaan sebelum Pentadbir HR menggunakannya (langkah sedia ada). Peringatan CP22, PERKESO dan KWSP muncul di Laman Utama HR.', en: 'A role or company scope needs the Chief of Staff and the relevant Company Head to approve before HR Admin applies it (existing steps). CP22, SOCSO and EPF reminders appear on HR’s Home.' },
    errors: { bm: 'Medan wajib yang kosong ditolak dengan nama medan. Betulkan dan simpan semula; untuk rekod sedia ada, guna Edit, jangan buat rekod baharu.', en: 'A missing required field is refused with its name. Correct it and save again; for an existing record use Edit, never a new record.' },
    checkedAgainst: 'saveRecord(officeStaff), putStaffId, putStaffAccount',
  },
  {
    id: 'leave-decide',
    title: { bm: 'Putuskan cuti staf', en: 'Decide staff leave' },
    purpose: { bm: 'HR meluluskan atau menolak; Naib Pengerusi memberi persetujuan.', en: 'HR approves or refuses; the Vice Chairman consents.' },
    screen: { bm: 'HR (HR monitor) → permohonan cuti → Decide', en: 'HR (HR monitor) → leave requests → Decide' },
    fields: [f('Komen', 'Comment', true, 'Ayat pendek pun boleh · a short one is fine')],
    source: { bm: 'Permohonan staf, baki cuti dan MC (jika ada) di rekod yang sama.', en: 'The staff request, the leave balance and the MC (if any) on the same record.' },
    reuse: { bm: 'Tiada kemasukan semula; keputusan merujuk permohonan asal.', en: 'Nothing is keyed again; the decision refers to the original request.' },
    after: { bm: 'Tiada sesiapa meluluskan cuti sendiri. Selepas HR lulus, permohonan menunggu persetujuan Naib Pengerusi. Jika ditolak, staf nampak sebab anda dan boleh membetulkan serta menghantar semula sebagai permohonan baharu.', en: 'Nobody approves their own leave. After HR approves, it waits for the Vice Chairman’s consent. If refused, the staff member sees your reason and can correct it and send it again as a new request.' },
    errors: { bm: 'Komen kosong ditolak.', en: 'A blank comment is refused.' },
    checkedAgainst: 'decideLeave',
  },
  {
    id: 'filings',
    title: { bm: 'Rekod penghantaran borang berkanun', en: 'Record a statutory filing' },
    purpose: { bm: 'Menandakan CP22, CP22A, EA, Borang E, KWSP, PERKESO/SIP atau JKKP 8 sebagai telah dihantar.', en: 'Mark CP22, CP22A, EA, Form E, EPF, SOCSO/EIS or JKKP 8 as filed.' },
    screen: { bm: 'HR → Masuk dan keluar → Borang', en: 'HR → Joining and leaving → Filings' },
    fields: [
      f('Jenis borang, syarikat, staf (jika berkenaan), tempoh', 'Form, company, staff (if any), period', true, 'contoh · e.g. CP22, 2026-11'),
      f('No. rujukan dan tarikh dihantar', 'Reference and filing date', true, 'contoh · e.g. TEST-REF-1, 2026-11-05'),
    ],
    source: { bm: 'Resit atau rujukan daripada portal LHDN, KWSP, PERKESO atau DOSH selepas anda menghantar di sana. Prima tidak menghantar borang.', en: 'The receipt or reference from the LHDN, KWSP, PERKESO or DOSH portal after you file there. Prima does not file.' },
    reuse: { bm: 'Tarikh akhir dikira daripada tarikh mula atau tarikh akhir kerja staf.', en: 'The latest day to file is worked out from the staff member’s start or last day.' },
    after: { bm: 'Tiada kelulusan. Peringatan hilang dari Laman Utama selepas direkod.', en: 'No approval. The reminder leaves Home once recorded.' },
    errors: { bm: 'Rujukan atau tarikh kosong ditolak.', en: 'A blank reference or date is refused.' },
    checkedAgainst: 'recordHrFiling, filingsDue',
  },
  {
    id: 'vacancy',
    title: { bm: 'Jawatan kosong', en: 'Vacancy' },
    purpose: { bm: 'Membuka jawatan; CEO meluluskan dan ketua syarikat menandatangani (CEO menandatangani jawatan pusat PWVSB).', en: 'Open a post; the CEO approves and the company head signs (the CEO signs PWVSB central posts).' },
    screen: { bm: 'HR → Jawatan kosong', en: 'HR → Vacancies' },
    fields: [
      f('Syarikat, jawatan, jabatan, bilangan', 'Company, title, department, headcount', true, 'contoh · e.g. IT Executive, IT, 1'),
      f('Sebab', 'Reason', true, 'contoh · e.g. "Ganti staf yang berhenti"'),
      f('Julat gaji', 'Pay range', false, 'RM, contoh · e.g. 3,000 - 3,500'),
    ],
    source: { bm: 'Pelan tenaga kerja jabatan. Tanya ketua jabatan jika julat gaji tidak pasti.', en: 'The department’s staffing plan. Ask the department head if the pay range is unclear.' },
    reuse: { bm: 'Syarikat dan jabatan dipilih daripada senarai sedia ada.', en: 'Company and department come from existing lists.' },
    after: { bm: 'CEO meluluskan atau menolak dengan komen, kemudian ketua syarikat menandatangani. Untuk jawatan pusat PWVSB, CEO meluluskan dan menandatangani dalam satu langkah (Fauzan, 11 Nov 2026).', en: 'The CEO approves or refuses with a comment, then the company head signs. For PWVSB central posts the CEO approves and signs in one step (Fauzan, 11 Nov 2026).' },
    errors: { bm: 'Yang ditolak tidak boleh diubah; buka jawatan baharu dengan butiran yang betul.', en: 'A refused vacancy cannot be edited; raise a new one with the right details.' },
    checkedAgainst: 'raiseVacancy, vacancyStep',
  },
  {
    id: 'hr-case',
    title: { bm: 'Kes HR, disiplin atau gangguan seksual', en: 'HR case, discipline or sexual harassment' },
    purpose: { bm: 'Merekod setiap langkah kes dalam fail HR staf.', en: 'Record each step of a case in the staff member’s HR file.' },
    screen: { bm: 'HR → Kes HR', en: 'HR → HR cases' },
    fields: [
      f('Staf, jenis kes, tajuk, tarikh diterima, nota', 'Staff, kind, title, date received, note', true, 'contoh · e.g. "Lewat berulang", 2026-11-03'),
      f('Pengadu', 'Complainant', false, 'Pilih · choose'),
    ],
    source: { bm: 'Aduan bertulis atau laporan penyelia. Kes gangguan seksual sulit: hanya HR, Pengarah HR dan CEO melihatnya.', en: 'The written complaint or supervisor’s report. Sexual harassment cases are confidential: only HR, the HR Director and the CEO see them.' },
    reuse: { bm: 'Staf dan pengadu dipilih daripada rekod sedia ada.', en: 'Staff and complainant come from existing records.' },
    after: { bm: 'Surat tunjuk sebab sebelum siasatan dalam negeri (7 hari untuk jawab). Hanya Pengarah HR atau CEO merekod keputusan.', en: 'A show-cause letter before a domestic inquiry (7 days to reply). Only the HR Director or the CEO records the outcome.' },
    errors: { bm: 'Panel tidak boleh termasuk staf, pengadu atau pembuka kes.', en: 'The panel cannot include the staff member, the complainant or whoever opened the case.' },
    checkedAgainst: 'openHrCase, hrCaseStep',
  },
  {
    id: 'guard-papers',
    title: { bm: 'Kad KDN, tapisan, CSG dan TNG pengawal', en: 'Guard KDN card, vetting, CSG and TNG' },
    purpose: { bm: 'Merekod dokumen sah pengawal supaya status CSG dan KDN betul.', en: 'Record a guard’s legal papers so the CSG and KDN status is right.' },
    screen: { bm: 'Pengawal → Latihan dan dokumen pengawal', en: 'Guards → Guard training and papers' },
    fields: [
      f('Pengawal, jenis dokumen, nombor, tarikh dikeluarkan', 'Guard, paper, number, date issued', true, 'contoh · e.g. CSG-TEST-1, 2026-06-01'),
      f('Tarikh tamat', 'Expiry date', false, 'Wajib untuk kad KDN · required for the KDN card'),
    ],
    source: { bm: 'Sijil atau kad asal. Apabila suapan aplikasi JA aktif, dokumen dari JA ditambah automatik; jangan kunci masuk semula.', en: 'The original certificate or card. Once the JA app feed is live, papers from JA are added automatically; do not key them again.' },
    reuse: { bm: 'Status sama digunakan oleh jadual tugas dan papan KDN.', en: 'The same status is used by the roster and the KDN board.' },
    after: { bm: 'Tiada kelulusan; direkod bersama siapa yang merekod. Permit senjata api kekal dengan Kawalan Senjata, dokumen pekerja asing dengan FWM.', en: 'No approval; kept with who recorded it. Firearm permits stay with Arms Control, foreign worker papers with FWM.' },
    errors: { bm: 'Kad KDN tanpa tarikh tamat ditolak.', en: 'A KDN card without an expiry date is refused.' },
    checkedAgainst: 'recordGuardPaper, guardTraining',
  },
  {
    id: 'training-appraisal-hr',
    title: { bm: 'Latihan dan penilaian tahunan (HR)', en: 'Training and yearly appraisal (HR)' },
    purpose: { bm: 'Merekod kursus dan membuka penilaian tahunan.', en: 'Record courses and open yearly appraisals.' },
    screen: { bm: 'HR → Latihan / Penilaian', en: 'HR → Training / Appraisals' },
    fields: [
      f('Staf, kursus, penyedia, dari, hingga, jam', 'Staff, course, provider, from, to, hours', true, 'contoh · e.g. Excel Asas, 2026-11-10, 7'),
      f('Kos, rujukan tuntutan HRD Corp, rujukan sijil', 'Cost, HRD Corp claim reference, certificate reference', false, 'contoh · e.g. RM500, HRD-TEST-1'),
      f('Penilaian: staf, tahun, penilai', 'Appraisal: staff, year, appraiser', true, 'Penilai bukan staf itu sendiri · never the staff member'),
    ],
    source: { bm: 'Invois dan sijil daripada penyedia latihan; rujukan tuntutan daripada portal HRD Corp.', en: 'The provider’s invoice and certificate; the claim reference from the HRD Corp portal.' },
    reuse: { bm: 'Staf melihat latihan mereka sendiri; tiada muat naik semula.', en: 'Staff see their own training; nothing is uploaded again.' },
    after: { bm: 'Penilai memberi markah 1-5 dengan komen, staf membaca dan boleh memberi komen, kemudian HR menutup dengan komen.', en: 'The appraiser rates 1 to 5 with a comment, the staff member reads it and may comment, then HR closes it with a comment.' },
    errors: { bm: 'HR tidak boleh membuka penilaian untuk diri sendiri.', en: 'HR cannot open its own appraisal.' },
    checkedAgainst: 'recordTraining, openAppraisal, rateAppraisal, closeAppraisal',
  },
  {
    id: 'pay-change',
    title: { bm: 'Perubahan gaji pokok', en: 'Basic pay change' },
    purpose: { bm: 'HR menukar gaji pokok pada rekod staf dengan sebab; Ketua Staf atau Timbalan mengesahkan; Naib Pengerusi memberi persetujuan.', en: 'HR changes the basic pay on the staff record with a reason; the Chief of Staff or Deputy verifies; the Vice Chairman consents.' },
    screen: { bm: 'HR → Perubahan gaji', en: 'HR → Pay changes' },
    fields: [f('Komen pada setiap langkah', 'Comment at each step', true, 'contoh · e.g. "Kenaikan tahunan mengikut penilaian"')],
    source: { bm: 'Surat tawaran, keputusan penilaian atau surat kenaikan yang diluluskan.', en: 'The offer letter, appraisal result or approved increment letter.' },
    reuse: { bm: 'Gaji baharu terus digunakan oleh gaji bulanan selepas persetujuan.', en: 'The new pay flows into the monthly payroll after consent.' },
    after: { bm: 'Tiada sesiapa mengesahkan perubahan yang dia minta atau gajinya sendiri. Penolakan perlu sebab; HR kemudian membuat perubahan baharu.', en: 'Nobody verifies a change they asked for or their own pay. A refusal needs a reason; HR then makes a new change.' },
    errors: { bm: 'Komen kosong ditolak. Perubahan yang sudah diputuskan tidak boleh diputuskan semula.', en: 'A blank comment is refused. A change already decided cannot be decided again.' },
    checkedAgainst: 'payChanges, decidePayChange',
  },
  {
    id: 'staff-payroll',
    title: { bm: 'Gaji bulanan staf', en: 'Monthly staff payroll' },
    purpose: { bm: 'HR menyediakan, Ketua Staf meluluskan, COO meluluskan, Kewangan membayar.', en: 'HR prepares, the Chief of Staff approves, the COO approves, Finance pays.' },
    screen: { bm: 'Staff payroll', en: 'Staff payroll' },
    fields: [
      f('Komen kelulusan', 'Approval comment', true, 'contoh · e.g. "Disemak dengan senarai staf"'),
      f('Rujukan bank dan PCB disemak (Kewangan)', 'Bank reference and PCB checked (Finance)', true, 'contoh · e.g. BANK-TEST-1'),
    ],
    source: { bm: 'Rekod staf, cuti dan perubahan gaji yang diluluskan. Fail KWSP dan PERKESO salinan HR mempunyai IC penuh; salinan Kewangan bertopeng dan HR melengkapkannya.', en: 'Staff records, leave and approved pay changes. HR’s EPF and SOCSO files carry the full IC; Finance’s copy is masked and HR completes it.' },
    reuse: { bm: 'Semua angka datang daripada rekod sedia ada; tiada kunci masuk semula.', en: 'Every figure comes from existing records; nothing is keyed again.' },
    after: { bm: 'COO tidak boleh meluluskan sebelum Ketua Staf, dan bukan orang yang sama. Fail hanya tersedia selepas kelulusan COO. Prima tidak memindahkan wang; Kewangan membayar melalui bank.', en: 'The COO cannot approve before the Chief of Staff, and not as the same person. Files are ready only after the COO approves. Prima moves no money; Finance pays through the bank.' },
    errors: { bm: 'Gaji di bawah gaji minimum RM1,700 ditanda pada slip; HR membetulkan sebelum kelulusan.', en: 'Pay below the RM1,700 minimum wage is flagged on the slip; HR corrects it before approval.' },
    checkedAgainst: 'staffPayStep, staffPayExport',
  },
  {
    id: 'overtime',
    title: { bm: 'Tetapan kerja lebih masa staf', en: 'Staff overtime settings' },
    purpose: { bm: 'Kerja lebih masa dimatikan sehingga HR menghidupkannya.', en: 'Overtime stays off until HR turns it on.' },
    screen: { bm: 'HR → Kerja lebih masa staf', en: 'HR → Staff overtime' },
    fields: [
      f('Kadar hari biasa, hari rehat, cuti umum', 'Normal day, rest day, public holiday rates', true, 'Sekurang-kurangnya 1.5 / 2 / 3 · at least 1.5 / 2 / 3'),
      f('Staf yang layak', 'Eligible staff', true, 'Tanda · tick'),
      f('Sebab', 'Reason', true, 'Ayat pendek · short sentence'),
    ],
    source: { bm: 'Keputusan pengurusan tentang siapa layak.', en: 'Management’s decision on who is eligible.' },
    reuse: { bm: 'Kiraan guna gaji pokok dalam rekod staf.', en: 'The calculator uses the basic pay on the staff record.' },
    after: { bm: 'Setiap perubahan disimpan dengan sejarah. Tuntutan dalam gaji bulanan belum tersedia (menunggu PR Kewangan #49).', en: 'Each change is kept with history. Claims inside the monthly payroll are not available yet (waiting for Finance PR #49).' },
    errors: { bm: 'Kadar di bawah Akta ditolak.', en: 'Rates below the Act are refused.' },
    checkedAgainst: 'setStaffOvertime, overtimePreview',
  },
];


// ---------- Who, where, and the steps around save ----------

type Extra = Pick<HrGuideCardSpec, 'allowed' | 'status' | 'who' | 'sources' | 'notVerified'> & {
  view: string | null;
  name: string;
  action: HrGuideText;
  save: HrGuideText;
  returned: HrGuideText;
  done: HrGuideText;
  recordKind?: 'officeStaff';
  actions?: string[];
};

const ASK_HR = (bm: string, en: string) => ({ what: t(bm, en), askDesk: 'hr' as const });
const NOT_IN_BROWSER = t('Belum diuji dalam pelayar; disemak terhadap peraturan pelayan sahaja.', 'Not yet walked through in a browser; checked against the server rules only.');
const NONE = t('Tiada pemulangan; jika ditolak, sebabnya ditunjuk.', 'Nothing is returned; if refused, the reason is shown.');

const EXTRA: Record<string, Extra> = {
  'leave-apply': {
    allowed: staffClockUser,
    status: 'ready',
    who: t('Staf pejabat yang mempunyai rekod staf sendiri.', 'Office staff with their own staff record.'),
    view: 'mine',
    name: 'My details',
    action: t('Leave → Ask for leave', 'Leave → Ask for leave'),
    sources: [ASK_HR('Sijil MC asal daripada klinik (cuti sakit sahaja).', 'The original MC from the clinic (sick leave only).')],
    save: t('Tekan Hantar. Pelayan menyemak tarikh, baki dan MC; jika salah, sebabnya ditunjuk dan tiada apa disimpan.', 'Press Send. The server checks the dates, balance and MC; if something is wrong it shows why and saves nothing.'),
    returned: t('Jika ditolak, sebab HR ditunjuk. Tekan "Correct and send again", betulkan dan hantar.', 'If refused, HR’s reason is shown. Press "Correct and send again", correct it and send.'),
    done: t('Selesai apabila HR meluluskan dan Naib Pengerusi memberi persetujuan.', 'Done when HR approves and the Vice Chairman consents.'),
    notVerified: [],
    actions: ['leave.request'],
  },
  'clock-in': {
    allowed: staffClockUser,
    status: 'ready',
    who: t('Staf pejabat yang mempunyai rekod staf sendiri. Pengawal daftar masuk di peranti tapak.', 'Office staff with their own staff record. Guards clock in on the site device.'),
    view: 'clock',
    name: 'Clock',
    action: t('Clock in, kemudian Clock out.', 'Clock in, then Clock out.'),
    sources: [ASK_HR('Wajah anda sendiri; HR meluluskan pendaftaran wajah.', 'Your own face; HR approves the face registration.')],
    save: t('Tekan Clock in dan lihat kamera.', 'Press Clock in and look at the camera.'),
    returned: t('Jika wajah ditolak oleh HR, daftar semula dengan gambar yang jelas.', 'If HR refuses your face, register again with a clear photo.'),
    done: t('Selesai apabila waktu masuk muncul pada skrin.', 'Done when the clock-in time shows on the screen.'),
    notVerified: [t('Lokasi hanya semasa daftar masuk; penjejakan latar belakang pada telefon belum dibina.', 'Location only while clocked in; background tracking on the phone is not built.')],
  },
  'flex-request': {
    allowed: staffClockUser,
    status: 'ready',
    who: t('Staf pejabat yang aktif.', 'Active office staff.'),
    view: 'clock',
    name: 'Clock',
    action: t('Ask for flexible hours or days', 'Ask for flexible hours or days'),
    sources: [ASK_HR('Tiada dokumen; tanya HR jika tidak pasti.', 'No document; ask HR if unsure.')],
    save: t('Tekan Hantar.', 'Press Send.'),
    returned: NONE,
    done: t('Selesai apabila HR menjawab dengan komen.', 'Done when HR answers with a comment.'),
    notVerified: [NOT_IN_BROWSER],
  },
  'policies-appraisal': {
    allowed: staffClockUser,
    status: 'ready',
    who: t('Staf pejabat yang aktif.', 'Active office staff.'),
    view: 'clock',
    name: 'Clock',
    action: t('Bahagian polisi, penilaian dan latihan.', 'The policies, appraisal and training sections.'),
    sources: [ASK_HR('Polisi yang diterbitkan HR dan penilaian yang dibuka HR.', 'Policies HR published and the appraisal HR opened.')],
    save: t('Buka polisi, tekan Acknowledge; atau tulis komen penilaian dan simpan.', 'Open the policy and press Acknowledge; or write your appraisal comment and save.'),
    returned: NONE,
    done: t('Selesai apabila pengesahan atau komen anda ditunjuk.', 'Done when your acknowledgement or comment shows.'),
    notVerified: [NOT_IN_BROWSER],
  },
  'osh-incident': {
    allowed: (u) => hrKeeps(u) || (!u.integration && u.role === 'company_manager'),
    status: 'partial',
    who: t('HR, pengurus syarikat, dan penyelaras OSH syarikat itu.', 'HR, the company manager, and that company’s OSH coordinator.'),
    view: 'hr',
    name: 'HR',
    action: t('Office OSH → lapor kejadian', 'Office OSH → report an incident'),
    sources: [{ what: t('Laporan saksi atau penyelia.', 'The witness or supervisor’s account.'), askDesk: 'company_office' }],
    save: t('Tekan Simpan.', 'Press Save.'),
    returned: NONE,
    done: t('Selesai apabila rujukan DOSH direkod.', 'Done when the DOSH reference is recorded.'),
    notVerified: [
      t('Penyelaras OSH yang bukan HR atau pengurus syarikat belum nampak kad ini (pelayan tetap membenarkan mereka melapor).', 'An OSH coordinator who is not HR or a company manager does not see this card yet (the server still lets them report).'),
      t('Prima tidak menghantar laporan kepada DOSH.', 'Prima does not send the report to DOSH.'),
    ],
  },
  'new-staff': {
    allowed: hrKeeps,
    status: 'ready',
    who: t('HR sahaja.', 'HR only.'),
    view: 'people',
    name: 'People',
    action: t('Tekan Tambah (Office staff member).', 'Press Add (Office staff member).'),
    recordKind: 'officeStaff',
    sources: [
      ASK_HR('Permohonan kemasukan yang diluluskan dan surat tawaran.', 'The approved onboarding request and the offer letter.'),
      { what: t('Akaun Microsoft: pemilik identiti IT. Jangan minta kata laluan atau kod MFA.', 'The Microsoft account: the IT identity owner. Never ask for passwords or MFA codes.'), askDesk: 'it' },
    ],
    save: t('Tekan Simpan. Medan wajib yang kosong ditolak dengan nama medan.', 'Press Save. A missing required field is refused with its name.'),
    returned: t('Gaji pokok atau akaun gaji baharu menunggu pengesahan; untuk membetulkan, buka rekod dan tekan Ubah.', 'A new basic pay or salary account waits for verification; to correct, open the record and press Edit.'),
    done: t('Selesai apabila staf muncul dalam senarai People.', 'Done when the staff member shows in the People list.'),
    notVerified: [t('Rekod ini tidak membuka akaun Microsoft.', 'This record does not create a Microsoft account.')],
    actions: ['record.add.officeStaff'],
  },
  'leave-decide': {
    allowed: (u) => hrKeeps(u) || vcConsents(u),
    status: 'ready',
    who: t('HR memutuskan; Naib Pengerusi (CEO semasa perintis) memberi persetujuan.', 'HR decides; the Vice Chairman (the CEO during the pilot) consents.'),
    view: 'hr',
    name: 'HR',
    action: t('Leave requests → Decide', 'Leave requests → Decide'),
    sources: [ASK_HR('Permohonan, baki cuti dan MC pada rekod yang sama.', 'The request, leave balance and MC on the same record.')],
    save: t('Tulis komen, kemudian Approve atau Refuse.', 'Write a comment, then Approve or Refuse.'),
    returned: t('Yang ditolak kembali kepada staf dengan sebab anda.', 'A refusal goes back to the staff member with your reason.'),
    done: t('Selesai selepas persetujuan Naib Pengerusi.', 'Done after the Vice Chairman’s consent.'),
    notVerified: [],
  },
  filings: {
    allowed: hrKeeps,
    status: 'ready',
    who: t('HR sahaja.', 'HR only.'),
    view: 'hr',
    name: 'HR',
    action: t('Joining and leaving → Filings', 'Joining and leaving → Filings'),
    sources: [ASK_HR('Resit daripada portal LHDN, KWSP, PERKESO atau DOSH.', 'The receipt from the LHDN, KWSP, PERKESO or DOSH portal.')],
    save: t('Tekan Simpan.', 'Press Save.'),
    returned: NONE,
    done: t('Selesai apabila peringatan hilang dari Laman Utama.', 'Done when the reminder leaves Home.'),
    notVerified: [t('Prima tidak menghantar borang ke portal.', 'Prima does not file on the portals.'), NOT_IN_BROWSER],
  },
  vacancy: {
    allowed: (u) => hrKeeps(u) || (!u.integration && (u.role === 'company_manager' || u.opsTier === 'ceo')),
    status: 'partial',
    who: t('HR atau pengurus syarikat membuka; CEO meluluskan; ketua syarikat menandatangani.', 'HR or the company manager raises it; the CEO approves; the company head signs.'),
    view: 'hr',
    name: 'HR',
    action: t('Vacancies', 'Vacancies'),
    sources: [{ what: t('Pelan tenaga kerja jabatan.', 'The department’s staffing plan.'), askDesk: 'company_office' }],
    save: t('Tekan Hantar.', 'Press Send.'),
    returned: t('Yang ditolak tidak boleh diubah; buka jawatan baharu.', 'A refused vacancy cannot be edited; raise a new one.'),
    done: t('Selesai apabila ketua syarikat menandatangani.', 'Done when the company head signs.'),
    notVerified: [t('Penandatangan jawatan pusat PWVSB ialah andaian (Pengarah HR), menunggu keputusan CEO.', 'The signer for PWVSB central posts is an assumption (the HR Director), awaiting the CEO’s decision.'), NOT_IN_BROWSER],
  },
  'hr-case': {
    allowed: (u) => hrKeeps(u) || (!u.integration && u.opsTier === 'ceo'),
    status: 'ready',
    who: t('HR membuka; hanya Pengarah HR atau CEO merekod keputusan.', 'HR opens it; only the HR Director or the CEO records the outcome.'),
    view: 'hr',
    name: 'HR',
    action: t('HR cases', 'HR cases'),
    sources: [ASK_HR('Aduan bertulis atau laporan penyelia.', 'The written complaint or supervisor’s report.')],
    save: t('Tekan Buka kes, kemudian rekod setiap langkah dengan nota.', 'Press Open case, then record each step with a note.'),
    returned: NONE,
    done: t('Selesai apabila keputusan direkod.', 'Done when the outcome is recorded.'),
    notVerified: [NOT_IN_BROWSER],
  },
  'guard-papers': {
    allowed: guardPaperKeeper,
    status: 'ready',
    who: t('HR, pengurus syarikat pengawal itu, dan Operasi untuk kawasan mereka.', 'HR, the guard’s company manager, and Operations for their area.'),
    view: 'people',
    name: 'Guards',
    action: t('Guard training and papers', 'Guard training and papers'),
    sources: [{ what: t('Sijil atau kad asal pengawal.', 'The guard’s original certificate or card.'), askDesk: 'company_office' }],
    save: t('Tekan Simpan.', 'Press Save.'),
    returned: NONE,
    done: t('Selesai apabila status CSG atau KDN dikemas kini.', 'Done when the CSG or KDN status updates.'),
    notVerified: [t('Suapan dokumen dari aplikasi JA belum disambung.', 'The papers feed from the JA app is not connected yet.'), NOT_IN_BROWSER],
  },
  'training-appraisal-hr': {
    allowed: hrKeeps,
    status: 'ready',
    who: t('HR sahaja.', 'HR only.'),
    view: 'hr',
    name: 'HR',
    action: t('Training / Appraisals', 'Training / Appraisals'),
    sources: [ASK_HR('Invois dan sijil penyedia latihan; rujukan portal HRD Corp.', 'The provider’s invoice and certificate; the HRD Corp portal reference.')],
    save: t('Tekan Simpan.', 'Press Save.'),
    returned: NONE,
    done: t('Selesai apabila HR menutup penilaian dengan komen.', 'Done when HR closes the appraisal with a comment.'),
    notVerified: [NOT_IN_BROWSER],
  },
  'pay-change': {
    allowed: (u) => hrKeeps(u) || isHrDirector(u) || vcConsents(u),
    status: 'ready',
    who: t('HR meminta; Ketua Staf atau Timbalan mengesahkan; Naib Pengerusi memberi persetujuan.', 'HR asks; the Chief of Staff or Deputy verifies; the Vice Chairman consents.'),
    view: 'hr',
    name: 'HR',
    action: t('Pay changes', 'Pay changes'),
    sources: [{ what: t('Surat tawaran, keputusan penilaian atau surat kenaikan yang diluluskan.', 'The offer letter, appraisal result or approved increment letter.'), askDesk: 'chief_of_staff' }],
    save: t('Tulis komen, kemudian Verify atau Refuse.', 'Write a comment, then Verify or Refuse.'),
    returned: t('Yang ditolak perlu sebab; HR membuat perubahan baharu.', 'A refusal needs a reason; HR makes a new change.'),
    done: t('Selesai selepas persetujuan Naib Pengerusi.', 'Done after the Vice Chairman’s consent.'),
    notVerified: [NOT_IN_BROWSER],
  },
  'staff-payroll': {
    allowed: staffPayStepper,
    status: 'partial',
    who: t('HR menyediakan, Ketua Staf meluluskan, COO meluluskan, Kewangan membayar.', 'HR prepares, the Chief of Staff approves, the COO approves, Finance pays.'),
    view: 'staffpay',
    name: 'Staff payroll',
    action: t('Buka bulan itu, kemudian langkah anda dengan komen.', 'Open the month, then your step with a comment.'),
    sources: [ASK_HR('Rekod staf, cuti dan perubahan gaji yang diluluskan.', 'Staff records, leave and approved pay changes.')],
    save: t('Tulis komen, kemudian tekan langkah anda.', 'Write a comment, then press your step.'),
    returned: t('Jika dipulangkan, HR membetulkan dan menghantar semula.', 'If returned, HR corrects it and sends it again.'),
    done: t('Selesai apabila Kewangan merekod rujukan bank.', 'Done when Finance records the bank reference.'),
    notVerified: [t('Tuntutan lebih masa dalam gaji menunggu PR Kewangan #49. Prima tidak memindahkan wang.', 'Overtime claims in payroll wait for Finance PR #49. Prima moves no money.'), NOT_IN_BROWSER],
  },
  overtime: {
    allowed: hrKeeps,
    status: 'partial',
    who: t('HR sahaja.', 'HR only.'),
    view: 'hr',
    name: 'HR',
    action: t('Staff overtime', 'Staff overtime'),
    sources: [{ what: t('Keputusan pengurusan tentang siapa layak.', 'Management’s decision on who is eligible.'), askDesk: 'chief_of_staff' }],
    save: t('Tulis sebab, kemudian Simpan.', 'Write the reason, then Save.'),
    returned: NONE,
    done: t('Selesai apabila tetapan baharu muncul dengan sejarahnya.', 'Done when the new setting shows with its history.'),
    notVerified: [t('Tuntutan dalam gaji bulanan menunggu PR Kewangan #49.', 'Claims inside the monthly payroll wait for Finance PR #49.'), NOT_IN_BROWSER],
  },
};

function splitFormat(format: string): HrGuideText {
  const [bm, en] = format.split(' · ');
  return en ? t(bm, en) : t(format, format);
}

function officeStaffFields(): HrGuideField[] {
  return RECORD_KINDS.officeStaff.fields.map((x) => ({
    key: x.key,
    label: x.label,
    required: !!x.required,
    format: t(x.type === 'date' ? 'Tarikh' : 'Ikut borang', x.type === 'date' ? 'Date' : 'As on the form'),
    example: x.restricted ? '(contoh tidak ditunjuk / no example shown)' : x.type === 'date' ? '31/01/2027' : '',
  }));
}

/** HR's cards in the shared guide-card shape. */
export const HR_GUIDE_CARDS: HrGuideCardSpec[] = TEXT.map((c) => {
  const x = EXTRA[c.id];
  if (!x) throw new Error(`HR guide card ${c.id} has no who/where/steps.`);
  return {
    id: `hr.${c.id}`,
    status: x.status,
    dept: 'HR',
    title: c.title,
    purpose: c.purpose,
    who: x.who,
    screen: { view: x.view, name: x.name, action: x.action },
    allowed: x.allowed,
    ...(x.recordKind ? { recordKind: x.recordKind } : {}),
    fields: x.recordKind ? officeStaffFields() : c.fields.map((fl, i) => ({ key: `${c.id}.${i}`, label: fl.name.en, required: fl.required, format: splitFormat(fl.format), example: splitFormat(fl.format).en })),
    sources: x.sources,
    enteredOnce: c.reuse,
    ...(x.actions ? { actions: x.actions } : {}),
    steps: { save: x.save, review: c.after, returned: x.returned, done: x.done, recover: c.errors },
    notVerified: x.notVerified,
  };
});

/** The service method(s) each card was checked against, for reviewers. */
export const HR_GUIDE_CHECKED_AGAINST: Record<string, string> = Object.fromEntries(TEXT.map((c) => [`hr.${c.id}`, c.checkedAgainst]));

/** The cards this person may use (the server's own rules). A system feed gets none. */
export function hrGuideCardsFor(user: User): Omit<HrGuideCardSpec, 'allowed'>[] {
  if (user.integration) return [];
  return HR_GUIDE_CARDS.filter((c) => c.allowed(user)).map(({ allowed: _a, ...rest }) => rest);
}

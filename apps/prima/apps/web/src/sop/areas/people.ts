import type { ViewName } from '../../App';
import type { Place, Sop, Text2 } from '../types';

/**
 * P121: HR and Payroll, and each person's own screens (Duty, Clock, Claims). Written from Fauzan's documents
 * (docs/HR_PHASE3.md, HR_SCREENING_AND_CONDUCT.md, HR_POLICY_LANGUAGES_AND_APPEALS.md, STAFF_HISTORY.md,
 * STAFF_RECEIPT_WALLET.md, TIME_SLIP.md, GUARD_PAY_RUN.md, PAY_FORMULAS.md, MANUAL_GUARD_CASH_SPEC.md,
 * docs/system/04-workflows.md) and the HR guide cards in packages/core/src/hr-guide-cards.ts.
 *
 * The HR monitor is one long page; its groups open from a link (#hr/move and so on, see Hr.tsx). The Staff clock board
 * takes its tabs from a link too (#staffclock/slips).
 */

const T = (en: string, ms: string): Text2 => ({ en, ms });
const at = (view: ViewName, en: string, ms: string, tab?: string): Place => (tab ? { view, tab, label: T(en, ms) } : { view, label: T(en, ms) });

// The places used most.
const HR_PAY = at('hr', 'HR monitor › Pay and allowances', 'Pemantauan HR › Gaji dan elaun', 'pay');
const HR_MOVE = at('hr', 'HR monitor › Joining, leaving and moving', 'Pemantauan HR › Masuk, keluar dan pertukaran', 'move');
const HR_CASES = at('hr', 'HR monitor › Cases, safety and legal', 'Pemantauan HR › Kes, keselamatan dan perundangan', 'cases');
const HR_GROW = at('hr', 'HR monitor › Appraisals, training and policies', 'Pemantauan HR › Penilaian, latihan dan polisi', 'grow');
const HR_LEAVE = at('hr', 'HR monitor › Leave and holidays', 'Pemantauan HR › Cuti dan cuti umum', 'leave');
const CLOCK = (en: string, ms: string) => at('clock', `Clock › ${en}`, `Jam kerja › ${ms}`);
const BOARD = (en: string, ms: string, tab: 'clock' | 'home' | 'slips') => at('staffclock', `Staff clock › ${en}`, `Jam kerja staf › ${ms}`, tab);
const MY_LEAVE = at('mine', 'My details › Leave', 'Butiran saya › Cuti', 'leave');
const PEOPLE = (en: string, ms: string) => at('people', `People › ${en}`, `Kakitangan › ${ms}`);
const CLAIMS_MINE = at('claims', 'Claims › My claims', 'Tuntutan › Tuntutan saya', 'mine');
const CLAIMS_QUEUE = at('claims', 'Claims › claims to decide', 'Tuntutan › tuntutan untuk diputuskan', 'queue');
const PAYROLL = at('staffpay', 'Staff payroll › Payroll', 'Gaji staf › Gaji', 'runs');
const GUARD_PAY = at('guardpay', 'Guard pay', 'Gaji pengawal');

const NO_OWN = T('Every approval needs a comment, and nobody approves their own.', 'Setiap kelulusan perlu komen, dan tiada sesiapa meluluskan permohonannya sendiri.');

export const SOPS_PEOPLE: Sop[] = [
  // ---------------------------------------------------------------- Leave, time and the clock
  {
    id: 'hr-staff-leave',
    app: 'hr',
    title: T('Office staff leave', 'Cuti staf pejabat'),
    purpose: T(
      'An office staff member asks for annual, sick, maternity, paternity or other leave; HR decides with a comment and the Vice Chairman consents.',
      'Staf pejabat memohon cuti tahunan, sakit, bersalin, isteri bersalin atau cuti lain; HR memutuskan dengan komen dan Naib Pengerusi memberi persetujuan.',
    ),
    start: at('mine', 'Ask for leave', 'Mohon cuti', 'leave'),
    starter: T('The staff member, their line manager, or HR', 'Staf itu sendiri, pengurus barisnya, atau HR'),
    steps: [
      {
        who: T('Staff member', 'Staf'),
        does: T(
          'Picks the kind of leave, the dates and the reason; for sick leave also the illness, the clinic, the MC serial number and a photo of the MC. Working days are counted for you: weekends and your state’s public holidays do not count.',
          'Pilih jenis cuti, tarikh dan sebab; untuk cuti sakit juga penyakit, klinik, nombor siri MC dan gambar MC. Hari bekerja dikira automatik: hujung minggu dan cuti umum negeri anda tidak dikira.',
        ),
        where: MY_LEAVE,
      },
      {
        who: T('HR Administrator', 'Pentadbir HR'),
        does: T('Approves or refuses with a comment.', 'Meluluskan atau menolak dengan komen.'),
        where: HR_LEAVE,
        decision: true,
      },
      {
        who: T('Vice Chairman', 'Naib Pengerusi'),
        does: T(
          'Consents or refuses, with a comment. During the pilot the CEO may stand in, but never on a request he approved for HR.',
          'Memberi persetujuan atau menolak, dengan komen. Semasa perintis CEO boleh menggantikan, tetapi tidak bagi permohonan yang dia sendiri luluskan bagi pihak HR.',
        ),
        where: HR_LEAVE,
        decision: true,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T(
          'Sees the answer. If refused, reads the reason and presses “Correct and send again” to make a new request; the refused one stays on record.',
          'Melihat jawapan. Jika ditolak, baca sebabnya dan tekan “Correct and send again” untuk membuat permohonan baharu; yang ditolak kekal dalam rekod.',
        ),
        where: MY_LEAVE,
      },
    ],
    rules: [
      NO_OWN,
      T('A request nobody answers within 12 hours moves up a level.', 'Permohonan yang tidak dijawab dalam 12 jam naik ke peringkat seterusnya.'),
      T(
        'Refused at once: annual or unpaid leave asked after the day, more than 60 days, or a missing or already used MC.',
        'Ditolak serta-merta: cuti tahunan atau tanpa gaji yang dipohon selepas hari itu, lebih 60 hari, atau MC yang tiada atau sudah digunakan.',
      ),
      T(
        'Sick leave and hospitalisation are separate: 14, 18 or 22 sick days a year by years of service, plus 60 hospitalisation days.',
        'Cuti sakit dan cuti hospital adalah berasingan: 14, 18 atau 22 hari cuti sakit setahun mengikut tempoh perkhidmatan, ditambah 60 hari cuti hospital.',
      ),
      T(
        'Maternity is 98 consecutive days; paternity is 7 consecutive days for a married man with 12 months of service. HR may give more than the Act, never less, and never to themselves.',
        'Cuti bersalin 98 hari berturut-turut; cuti isteri bersalin 7 hari berturut-turut bagi lelaki berkahwin dengan 12 bulan perkhidmatan. HR boleh memberi lebih daripada Akta, tidak kurang, dan tidak kepada diri sendiri.',
      ),
      T(
        'Unused annual leave lapses on 31 December (no carry-forward); staff see a reminder in November and December.',
        'Cuti tahunan yang tidak digunakan luput pada 31 Disember (tiada bawa ke hadapan); staf melihat peringatan pada November dan Disember.',
      ),
      T(
        'The CEO can switch the Vice Chairman’s step off on Home, with a reason; HR’s approval is then final.',
        'CEO boleh mematikan langkah Naib Pengerusi di Laman Utama, dengan sebab; kelulusan HR kemudian menjadi muktamad.',
      ),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 1 and 2 Nov 2026; B3, 14 Nov 2026' },
    words: 'leave cuti annual tahunan sick sakit mc hospital maternity bersalin paternity apply mohon vice chairman naib pengerusi',
  },
  {
    id: 'hr-guard-absence',
    app: 'hr',
    title: T('A guard’s no-show: alert, follow-up and discipline', 'Pengawal tidak hadir: amaran, tindakan susulan dan disiplin'),
    purpose: T(
      'When a guard misses clock-in or fails a check, the company acts quickly; repeated absence can lead to a recorded disciplinary step.',
      'Apabila pengawal tidak daftar masuk atau gagal semakan, syarikat bertindak segera; ketidakhadiran berulang boleh membawa kepada langkah disiplin yang direkodkan.',
    ),
    start: at('attendance', 'Attendance › Day sheet', 'Kehadiran › Helaian harian', 'day'),
    starter: T('Prima, when a guard misses clock-in or fails a check', 'Prima, apabila pengawal tidak daftar masuk atau gagal semakan'),
    steps: [
      {
        who: T('Prima', 'Prima'),
        does: T(
          'Alerts the company PIC every 5 minutes until someone acts (“Alerting the PIC now”). CMS sees the same alert and may call the guard.',
          'Memberi amaran kepada PIC syarikat setiap 5 minit sehingga seseorang bertindak (“Alerting the PIC now”). CMS melihat amaran yang sama dan boleh menelefon pengawal.',
        ),
        where: at('attendance', 'Attendance › Day sheet', 'Kehadiran › Helaian harian', 'day'),
      },
      {
        who: T('Company PIC', 'PIC syarikat'),
        does: T(
          'Acts: contacts the guard, sends a replacement to the post, or excuses it with a reason.',
          'Bertindak: menghubungi pengawal, menghantar pengganti ke pos, atau memaafkan dengan sebab.',
        ),
        where: at('attendance', 'Attendance › Day sheet', 'Kehadiran › Helaian harian', 'day'),
        decision: true,
      },
      {
        who: T('OM', 'OM'),
        does: T('May step in for the company when the PIC has not acted within 15 minutes.', 'Boleh mengambil alih bagi syarikat jika PIC tidak bertindak dalam 15 minit.'),
        where: at('attendance', 'Attendance › Day sheet', 'Kehadiran › Helaian harian', 'day'),
      },
      {
        who: T('Company manager or supervisor', 'Pengurus syarikat atau penyelia'),
        does: T(
          'Records a disciplinary step for repeated absence. Prima suggests the handbook step but never issues it.',
          'Merekod langkah disiplin bagi ketidakhadiran berulang. Prima mencadangkan langkah buku panduan tetapi tidak sekali-kali mengeluarkannya.',
        ),
        where: at('attendance', 'Attendance › Absence and discipline', 'Kehadiran › Ketidakhadiran dan tatatertib', 'record'),
        decision: true,
      },
      {
        who: T('Guard', 'Pengawal'),
        does: T('May appeal a warning, suspension, downgrade or dismissal within 14 days.', 'Boleh merayu amaran, penggantungan, penurunan pangkat atau pemecatan dalam 14 hari.'),
        where: at('mine', 'Duty › My details › Warnings', 'Tugas › Butiran saya › Amaran', 'warnings'),
      },
    ],
    rules: [
      T('Discipline is never automatic: a person decides and records it.', 'Disiplin tidak sekali-kali automatik: seseorang memutuskan dan merekodkannya.'),
      T(
        'A late arrival or early leave the company excused, with its reason and proof, counts in full for pay.',
        'Lewat tiba atau balik awal yang dimaafkan syarikat, dengan sebab dan bukti, dikira penuh untuk gaji.',
      ),
    ],
    status: 'in_force',
    statusNote: T(
      'Guard attendance still comes from the JA Group app for about a year (from Nov 2026); the JA app sends it to Prima.',
      'Kehadiran pengawal masih datang daripada aplikasi JA Group selama kira-kira setahun (dari Nov 2026); aplikasi JA menghantarnya ke Prima.',
    ),
    source: { doc: 'docs/system/04-workflows.md', decided: 'W2; Fauzan, 4 Nov 2026 (JA for about a year)' },
    words: 'no show tidak hadir absent alert amaran pic replacement pengganti discipline disiplin warning amaran attendance kehadiran',
  },
  {
    id: 'hr-time-slip',
    app: 'hr',
    title: T('Time slip: a few hours out of the office', 'Slip masa: keluar pejabat beberapa jam'),
    purpose: T(
      'Staff ask to leave the office for up to 4 hours on their own matters and work the hours back within 30 days.',
      'Staf memohon keluar pejabat sehingga 4 jam atas urusan sendiri dan menggantikan jam itu dalam 30 hari.',
    ),
    start: CLOCK('Time slip', 'Slip masa'),
    starter: T('Any office staff member', 'Mana-mana staf pejabat'),
    steps: [
      {
        who: T('Staff member', 'Staf'),
        does: T(
          'Asks for a slip: the date, time out and time back, inside office hours (08:30 to 17:30), at most 4 hours, up to 30 days ahead and never for a past day.',
          'Memohon slip: tarikh, masa keluar dan masa balik, dalam waktu pejabat (08:30 hingga 17:30), paling lama 4 jam, sehingga 30 hari lebih awal dan tidak untuk hari yang telah lepas.',
        ),
        where: CLOCK('Time slip', 'Slip masa'),
      },
      {
        who: T('Company head or department head (HR when there is no head above the person)', 'Ketua syarikat atau ketua jabatan (HR jika tiada ketua di atas orang itu)'),
        does: T(
          'Approves with a comment or refuses with a reason, under “Waiting for you to approve”.',
          'Meluluskan dengan komen atau menolak dengan sebab, di bawah “Waiting for you to approve”.',
        ),
        where: CLOCK('Time slip', 'Slip masa'),
        decision: true,
      },
      {
        who: T('HR', 'HR'),
        does: T('Is told of every approval and marks it seen.', 'Dimaklumkan setiap kelulusan dan menandanya sebagai dilihat.'),
        where: BOARD('Time slips', 'Slip masa', 'slips'),
      },
      {
        who: T('Staff member', 'Staf'),
        does: T(
          'Works the hours back within 30 days, after 17:30, on a clock closed by signing out.',
          'Menggantikan jam itu dalam 30 hari, selepas 17:30, pada jam kerja yang ditutup dengan log keluar.',
        ),
        where: CLOCK('Time slip', 'Slip masa'),
      },
      {
        who: T('Prima', 'Prima'),
        does: T(
          'After 30 days, hours not worked back are taken from annual leave in half days (4 hours each); with no annual leave left the rest is unpaid leave for HR to see.',
          'Selepas 30 hari, jam yang belum diganti diambil daripada cuti tahunan dalam setengah hari (4 jam setiap satu); jika cuti tahunan habis, bakinya menjadi cuti tanpa gaji untuk dilihat HR.',
        ),
        where: BOARD('Time slips', 'Slip masa', 'slips'),
      },
    ],
    rules: [
      NO_OWN,
      T('HR’s own slips go to the HR Director.', 'Slip HR sendiri pergi kepada Pengarah HR.'),
      T(
        'HR may change the approver setting to “HR approves” and back, always with a reason.',
        'HR boleh menukar tetapan pelulus kepada “HR approves” dan sebaliknya, sentiasa dengan sebab.',
      ),
      T(
        'A clock Prima closed, or one where the door shows you left before signing out, does not count as make-up time.',
        'Jam kerja yang ditutup oleh Prima, atau yang pintu menunjukkan anda keluar sebelum log keluar, tidak dikira sebagai masa ganti.',
      ),
      T('You may cancel a slip still waiting, or an approved slip before its day.', 'Anda boleh membatalkan slip yang masih menunggu, atau slip yang diluluskan sebelum harinya.'),
    ],
    status: 'in_force',
    statusNote: T(
      'Not yet: the Staff clock board still shows the time away as a long break, and payroll does not read unpaid leave from slips yet.',
      'Belum lagi: papan Jam kerja staf masih menunjukkan masa keluar sebagai rehat panjang, dan gaji belum membaca cuti tanpa gaji daripada slip.',
    ),
    source: { doc: 'docs/TIME_SLIP.md', decided: 'Fauzan, 4 Nov 2026' },
    words: 'time slip slip masa keluar pejabat out of office urusan peribadi make up ganti jam',
  },
  {
    id: 'hr-wfh',
    app: 'hr',
    title: T('Working from home', 'Bekerja dari rumah'),
    purpose: T(
      'Only staff HR allows may work from home; they apply, HR answers, and each home day has a plan, check-ins and an end-of-day report.',
      'Hanya staf yang dibenarkan HR boleh bekerja dari rumah; mereka memohon, HR menjawab, dan setiap hari di rumah ada pelan, daftar masuk dan laporan akhir hari.',
    ),
    start: CLOCK('Working from home', 'Bekerja dari rumah'),
    starter: T('A staff member HR has allowed', 'Staf yang dibenarkan HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Allows working from home for the staff member. Until then the staff member sees “HR has not opened working from home for you”.',
          'Membenarkan bekerja dari rumah bagi staf itu. Sebelum itu staf melihat “HR has not opened working from home for you”.',
        ),
        where: HR_LEAVE,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T('Applies for a working-from-home arrangement.', 'Memohon susunan bekerja dari rumah.'),
        where: CLOCK('Working from home', 'Bekerja dari rumah'),
      },
      {
        who: T('HR Administrator, CoS or DCoS', 'Pentadbir HR, Ketua Staf atau Timbalan'),
        does: T('Answers the application with a comment.', 'Menjawab permohonan dengan komen.'),
        where: BOARD('Working from home', 'Bekerja dari rumah', 'home'),
        decision: true,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T(
          'On a home day posts the plan, checks in at the fixed times and sends the end-of-day report.',
          'Pada hari di rumah menghantar pelan, daftar masuk pada waktu yang ditetapkan dan menghantar laporan akhir hari.',
        ),
        where: CLOCK('Working from home', 'Bekerja dari rumah'),
      },
      {
        who: T('Line manager', 'Pengurus barisan'),
        does: T('Reviews the home days.', 'Menyemak hari-hari bekerja di rumah.'),
        where: BOARD('Working from home', 'Bekerja dari rumah', 'home'),
      },
    ],
    rules: [
      T('Only HR answers applications; the company manager does not.', 'Hanya HR menjawab permohonan; pengurus syarikat tidak.'),
      T('When HR stops it, any open or approved arrangement ends, with HR’s reason.', 'Apabila HR menghentikannya, sebarang susunan terbuka atau diluluskan tamat, dengan sebab HR.'),
      NO_OWN,
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026' },
    words: 'wfh work from home kerja dari rumah remote home day hari di rumah',
  },
  {
    id: 'hr-flex-request',
    app: 'hr',
    title: T('Flexible hours or days (s.60P)', 'Waktu atau hari kerja fleksibel (s.60P)'),
    purpose: T('A staff member asks to change working hours or days; HR answers in writing within 60 days.', 'Staf meminta perubahan waktu atau hari kerja; HR menjawab secara bertulis dalam 60 hari.'),
    start: CLOCK('Ask for flexible hours or days', 'Mohon waktu atau hari kerja fleksibel'),
    starter: T('Any office staff member', 'Mana-mana staf pejabat'),
    steps: [
      {
        who: T('Staff member', 'Staf'),
        does: T('Gives the kind (hours or days), the detail, the reason and the dates.', 'Memberi jenis (waktu atau hari), butiran, sebab dan tarikh.'),
        where: CLOCK('Ask for flexible hours or days', 'Mohon waktu atau hari kerja fleksibel'),
      },
      {
        who: T('HR', 'HR'),
        does: T('Answers in writing with a comment; a refusal gives the grounds.', 'Menjawab secara bertulis dengan komen; penolakan perlu menyatakan alasan.'),
        where: HR_LEAVE,
        decision: true,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T('Reads the answer; if refused, may apply again.', 'Membaca jawapan; jika ditolak, boleh memohon semula.'),
        where: CLOCK('Ask for flexible hours or days', 'Mohon waktu atau hari kerja fleksibel'),
      },
    ],
    rules: [
      T('HR answers within 60 days; overdue answers turn red on HR’s Home.', 'HR menjawab dalam 60 hari; jawapan lewat menjadi merah di Laman Utama HR.'),
      T('Nobody answers their own request.', 'Tiada sesiapa menjawab permohonannya sendiri.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026' },
    words: 'flexible fleksibel hours waktu days hari 60p working arrangement',
  },
  {
    id: 'hr-staff-overtime',
    app: 'hr',
    title: T('Office staff overtime', 'Kerja lebih masa staf pejabat'),
    purpose: T(
      'Once HR switches it on for a person, staff claim overtime already worked; their head approves and payroll pays it.',
      'Setelah HR menghidupkannya bagi seseorang, staf menuntut kerja lebih masa yang telah dibuat; ketua meluluskan dan gaji membayarnya.',
    ),
    start: CLOCK('Overtime', 'Kerja lebih masa'),
    starter: T('A staff member HR has ticked for overtime', 'Staf yang ditanda HR untuk kerja lebih masa'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Turns overtime on, sets the rates and ticks who may claim, each change with a reason.',
          'Menghidupkan kerja lebih masa, menetapkan kadar dan menanda siapa boleh menuntut, setiap perubahan dengan sebab.',
        ),
        where: HR_PAY,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T('Claims hours already worked: the date, hours, kind of day and reason.', 'Menuntut jam yang telah dikerjakan: tarikh, jam, jenis hari dan sebab.'),
        where: CLOCK('Overtime', 'Kerja lebih masa'),
      },
      {
        who: T('The head who approves their time slips', 'Ketua yang meluluskan slip masa mereka'),
        does: T('Approves or refuses with a comment.', 'Meluluskan atau menolak dengan komen.'),
        where: CLOCK('Overtime', 'Kerja lebih masa'),
        decision: true,
      },
      {
        who: T('HR, then Finance', 'HR, kemudian Kewangan'),
        does: T(
          'The staff payroll run pays approved hours only while overtime is on for that person.',
          'Larian gaji staf membayar jam yang diluluskan hanya selagi kerja lebih masa dihidupkan bagi orang itu.',
        ),
        where: PAYROLL,
      },
    ],
    rules: [
      T(
        'Rates are never below the Act: 1.5 times on a normal day, 2 times on a rest day, 3 times on a public holiday.',
        'Kadar tidak sekali-kali di bawah Akta: 1.5 kali pada hari biasa, 2 kali pada hari rehat, 3 kali pada cuti umum.',
      ),
      T('Pay is basic / 26 / 8 × hours × rate.', 'Bayaran ialah gaji pokok / 26 / 8 × jam × kadar.'),
      T('Staff above the Act’s RM4,000 wage limit are marked; HR decides for them.', 'Staf melebihi had gaji RM4,000 dalam Akta ditanda; HR memutuskan bagi mereka.'),
      NO_OWN,
    ],
    status: 'off',
    statusNote: T(
      'Built and installed, but off until HR switches it on and sets the rates (most staff earn above RM4,000).',
      'Sudah dibina dan dipasang, tetapi dimatikan sehingga HR menghidupkannya dan menetapkan kadar (kebanyakan staf bergaji melebihi RM4,000).',
    ),
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026; Fitri package A9, 11 Nov 2026' },
    words: 'overtime ot kerja lebih masa claim tuntut rate kadar',
  },
  {
    id: 'hr-face-register',
    app: 'hr',
    title: T('Face for clock-in: register and check', 'Wajah untuk daftar masuk: daftar dan semak'),
    purpose: T(
      'A staff member registers their face once; HR approves the photo; then each sign-in asks for a quick face check.',
      'Staf mendaftar wajah sekali; HR meluluskan gambar; selepas itu setiap log masuk meminta semakan wajah ringkas.',
    ),
    start: CLOCK('Face recognition', 'Pengecaman wajah'),
    starter: T('Any office staff member, on their own phone', 'Mana-mana staf pejabat, di telefon sendiri'),
    steps: [
      {
        who: T('Staff member', 'Staf'),
        does: T('Registers their face once on My clock, on their own phone.', 'Mendaftar wajah sekali di Jam kerja saya, di telefon sendiri.'),
        where: CLOCK('Face recognition', 'Pengecaman wajah'),
      },
      {
        who: T('HR Administrator, CoS or DCoS', 'Pentadbir HR, Ketua Staf atau Timbalan'),
        does: T('Looks at the photo and approves or refuses it with a comment.', 'Melihat gambar dan meluluskan atau menolaknya dengan komen.'),
        where: BOARD('Faces waiting for HR', 'Wajah menunggu HR', 'clock'),
        decision: true,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T(
          'At each sign-in presses “Check my face”; until then the clock shows “Face check not done”.',
          'Pada setiap log masuk tekan “Check my face”; sebelum itu jam menunjukkan “Face check not done”.',
        ),
        where: CLOCK('Face recognition', 'Pengecaman wajah'),
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Spot-checks the face-check photos kept on each clock record.',
          'Menyemak rambang gambar semakan wajah yang disimpan pada setiap rekod jam kerja.',
        ),
        where: BOARD('Clock today', 'Jam hari ini', 'clock'),
      },
    ],
    rules: [
      T('Nobody approves their own face.', 'Tiada sesiapa meluluskan wajahnya sendiri.'),
      T('The server compares the face; a score sent by the phone is ignored.', 'Pelayan membandingkan wajah; skor yang dihantar telefon diabaikan.'),
      T('Without an approved face, clocking is by a time-stamped photo only.', 'Tanpa wajah yang diluluskan, daftar masuk hanya dengan gambar bercop masa.'),
      T('Guards clock in by face on the site device instead.', 'Pengawal pula daftar masuk dengan wajah di peranti tapak.'),
    ],
    status: 'in_force',
    statusNote: T(
      'Face and location need the person’s signed PDPA consent, collected on paper by the PDPA officer. Prima’s consent gate is a switch, still off until the PDPA officer or the CoS turns it on.',
      'Wajah dan lokasi memerlukan persetujuan PDPA bertandatangan orang itu, dikumpul atas kertas oleh pegawai PDPA. Pintu persetujuan Prima ialah suis, masih dimatikan sehingga pegawai PDPA atau Ketua Staf menghidupkannya.',
    ),
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026' },
    words: 'face wajah register daftar clock in daftar masuk photo gambar pdpa consent persetujuan',
  },

  // ---------------------------------------------------------------- Joining, leaving and moving
  {
    id: 'hr-joining',
    app: 'hr',
    title: T('A new office staff member joins', 'Staf pejabat baharu masuk kerja'),
    purpose: T(
      'HR keys the new staff member once; IT, Finance and the other desks get their part; HR files the statutory forms and confirms probation.',
      'HR memasukkan staf baharu sekali; IT, Kewangan dan meja lain menerima bahagian masing-masing; HR menghantar borang berkanun dan mengesahkan percubaan.',
    ),
    start: PEOPLE('Add office staff', 'Tambah staf pejabat'),
    starter: T('HR, after the vacancy is approved and signed', 'HR, selepas jawatan kosong diluluskan dan ditandatangani'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Starts from the approved vacancy and the offer letter, and keys the staff form once: staff number, name, job, branch, employment type, start and probation dates, full IC, salary account and basic pay.',
          'Bermula daripada jawatan kosong yang diluluskan dan surat tawaran, dan mengisi borang staf sekali: nombor staf, nama, jawatan, cawangan, jenis pekerjaan, tarikh mula dan tamat percubaan, IC penuh, akaun gaji dan gaji pokok.',
        ),
        where: PEOPLE('Add office staff', 'Tambah staf pejabat'),
      },
      {
        who: T('HR, then IT', 'HR, kemudian IT'),
        does: T(
          'HR opens the HR/IT joining request; IT prepares the Microsoft account, the device and Prima access.',
          'HR membuka permohonan masuk HR/IT; IT menyediakan akaun Microsoft, peranti dan akses Prima.',
        ),
        where: at('hr-it-intake', 'HR / IT coordination', 'Penyelarasan HR / IT'),
      },
      {
        who: T('Finance, Chief of Staff, company office', 'Kewangan, Ketua Staf, pejabat syarikat'),
        does: T(
          'Get their hand-overs: Finance adds the person to staff payroll, the Chief of Staff checks group medical cover, the company office is told.',
          'Menerima serah tugas masing-masing: Kewangan menambah orang itu ke gaji staf, Ketua Staf menyemak perlindungan perubatan berkumpulan, pejabat syarikat dimaklumkan.',
        ),
        where: at('handovers', 'Hand-overs › My hand-overs', 'Serah tugas › Serah tugas saya', 'mine'),
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Files CP22 and the SOCSO and EIS registration within 30 days, and EPF from the first month (by the 15th of the next month), then records each with its reference (“Filed today”).',
          'Menghantar CP22 dan pendaftaran PERKESO dan SIP dalam 30 hari, dan KWSP dari bulan pertama (sebelum 15 hari bulan berikutnya), kemudian merekod setiap satu dengan rujukannya (“Filed today”).',
        ),
        where: HR_MOVE,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Confirms or extends probation with a comment when it is due (reminded 14 days before).',
          'Mengesahkan atau melanjutkan tempoh percubaan dengan komen apabila tiba masanya (diingatkan 14 hari lebih awal).',
        ),
        where: HR_MOVE,
        decision: true,
      },
    ],
    rules: [
      T(
        'The full IC and salary account sit behind the HR wall; other screens show only the last digits.',
        'IC penuh dan akaun gaji disimpan di sebalik dinding HR; skrin lain hanya menunjukkan digit terakhir.',
      ),
      T('Never ask anyone for a password or an MFA code.', 'Jangan sekali-kali meminta kata laluan atau kod MFA daripada sesiapa.'),
      T(
        'Prima drafts and reminds; HR files with LHDN, KWSP and PERKESO and records the reference. Prima never files.',
        'Prima menyediakan draf dan mengingatkan; HR menghantar kepada LHDN, KWSP dan PERKESO dan merekod rujukan. Prima tidak menghantar.',
      ),
      T('HR never confirms their own probation.', 'HR tidak mengesahkan tempoh percubaannya sendiri.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026 (W10)' },
    words: 'joining masuk kerja new staff staf baharu onboarding cp22 epf kwsp socso perkeso probation percubaan',
  },
  {
    id: 'hr-leaving',
    app: 'hr',
    title: T('An office staff member leaves', 'Staf pejabat berhenti'),
    purpose: T(
      'HR records the last day, checks the leaving guide and final pay, access closes, IT collects devices and HR files CP22A.',
      'HR merekod hari terakhir, menyemak panduan berhenti dan gaji akhir, akses ditutup, IT mengutip peranti dan HR menghantar CP22A.',
    ),
    start: PEOPLE('the staff member’s record', 'rekod staf'),
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Records on the staff form how they are leaving (resigned, ended by the company, contract ended, retired), the notice date, the last working day and the reason.',
          'Merekod di borang staf cara berhenti (letak jawatan, ditamatkan syarikat, tamat kontrak, bersara), tarikh notis, hari bekerja terakhir dan sebab.',
        ),
        where: PEOPLE('the staff member’s record', 'rekod staf'),
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Opens the leaving guide: the notice under the Act (4, 6 or 8 weeks), the termination benefit, the handbook’s resignation procedure and Prima’s working of the final pay for HR to check.',
          'Membuka panduan berhenti: notis di bawah Akta (4, 6 atau 8 minggu), faedah penamatan, prosedur letak jawatan dalam buku panduan dan kiraan gaji akhir Prima untuk disemak HR.',
        ),
        where: at('hr', 'HR monitor › Joining and leaving › Leaving guide', 'Pemantauan HR › Staf masuk dan keluar › Panduan berhenti', 'move'),
      },
      {
        who: T('HR, HR Director or CEO', 'HR, Pengarah HR atau CEO'),
        does: T(
          'Access closes from the day after the last day, or now with “Close access” and a reason.',
          'Akses ditutup mulai hari selepas hari terakhir, atau sekarang dengan “Close access” dan sebab.',
        ),
        where: PEOPLE('the staff member’s record', 'rekod staf'),
      },
      {
        who: T('HR, then IT', 'HR, kemudian IT'),
        does: T(
          'The HR/IT leaving request asks IT to remove access and collect devices; the store lists items to collect.',
          'Permohonan berhenti HR/IT meminta IT membuang akses dan mengutip peranti; stor menyenaraikan barang untuk dikutip.',
        ),
        where: at('hr-it-intake', 'HR / IT coordination', 'Penyelarasan HR / IT'),
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Files CP22A with LHDN (at least 30 days before the last day) and records the reference; the EA figures are drafted from paid payroll.',
          'Menghantar CP22A kepada LHDN (sekurang-kurangnya 30 hari sebelum hari terakhir) dan merekod rujukan; angka EA disediakan daripada gaji yang telah dibayar.',
        ),
        where: HR_MOVE,
      },
    ],
    rules: [
      T(
        'A termination recorded around maternity leave shows to HR in red (Employment Act s.41A).',
        'Penamatan yang direkod sekitar cuti bersalin ditunjukkan kepada HR dalam warna merah (Akta Kerja s.41A).',
      ),
      T(
        'Retrenchment: a fair method, consultation, Form PK to JTK at least 30 days before, CP22A, and keeping the records.',
        'Pemberhentian (retrenchment): kaedah adil, perundingan, Borang PK kepada JTK sekurang-kurangnya 30 hari lebih awal, CP22A, dan menyimpan rekod.',
      ),
      T('Personnel records are kept 7 years after the last day.', 'Rekod kakitangan disimpan 7 tahun selepas hari terakhir.'),
      T('Staff at or near 60 are listed for HR with their leaving guide.', 'Staf yang berumur atau hampir 60 tahun disenaraikan untuk HR bersama panduan berhenti.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026 (W11)' },
    words: 'leaving berhenti resign letak jawatan termination penamatan retire bersara cp22a last day hari terakhir close access',
  },
  {
    id: 'hr-vacancy',
    app: 'hr',
    title: T('Vacancy, job post and applicants', 'Jawatan kosong, iklan jawatan dan pemohon'),
    purpose: T(
      'A post is raised, the CEO approves, the company head signs; then the job post is written, approved and posted, and HR keeps the applicants.',
      'Jawatan dibuka, CEO meluluskan, ketua syarikat menandatangani; kemudian iklan jawatan ditulis, diluluskan dan disiarkan, dan HR menyimpan senarai pemohon.',
    ),
    start: HR_MOVE,
    starter: T('HR, or the company manager for their own company', 'HR, atau pengurus syarikat bagi syarikatnya sendiri'),
    steps: [
      {
        who: T('HR or company manager', 'HR atau pengurus syarikat'),
        does: T(
          'Raises the vacancy: company, title, department, headcount, reason and pay range; whether it is for office staff, a guard or a patrolling officer (with the state).',
          'Membuka jawatan kosong: syarikat, jawatan, jabatan, bilangan, sebab dan julat gaji; sama ada untuk staf pejabat, pengawal atau peronda (dengan negeri).',
        ),
        where: HR_MOVE,
      },
      {
        who: T('CEO', 'CEO'),
        does: T('Approves or refuses with a comment, never a vacancy he raised.', 'Meluluskan atau menolak dengan komen, tidak sekali-kali jawatan yang dia sendiri buka.'),
        where: HR_MOVE,
        decision: true,
      },
      {
        who: T('Company head', 'Ketua syarikat'),
        does: T(
          'Signs the approval on Company today. For a PWVSB central post the CEO’s approval is also the signature.',
          'Menandatangani kelulusan di Syarikat hari ini. Bagi jawatan pusat PWVSB, kelulusan CEO juga menjadi tandatangan.',
        ),
        where: at('company', 'Company today', 'Syarikat hari ini'),
        decision: true,
      },
      {
        who: T('HR or company manager', 'HR atau pengurus syarikat'),
        does: T(
          'Writes the job post; “Draft for me” makes a Malay and English draft from the job facts.',
          'Menulis iklan jawatan; “Draft for me” menyediakan draf Bahasa Melayu dan Inggeris daripada fakta jawatan.',
        ),
        where: HR_MOVE,
      },
      {
        who: T('HR Director (office posts) or the OM covering the state (guard and officer posts)', 'Pengarah HR (jawatan pejabat) atau OM negeri itu (jawatan pengawal dan peronda)'),
        does: T(
          'Approves or sends back with a comment; never the person who wrote the wording. The Regional OM approves as backup when the OM is away.',
          'Meluluskan atau memulangkan dengan komen; tidak sekali-kali orang yang menulis teks itu. OM Wilayah meluluskan sebagai ganti apabila OM tiada.',
        ),
        where: HR_MOVE,
        decision: true,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Posts it by hand and records the link, then keeps the applicant list: new, shortlisted, interview, offered, hired, or not taken. Hiring then uses the joining steps.',
          'Menyiarkannya secara manual dan merekod pautan, kemudian menyimpan senarai pemohon: baharu, disenarai pendek, temu duga, ditawarkan, diambil, atau tidak diambil. Pengambilan kemudian mengikut langkah masuk kerja.',
        ),
        where: HR_MOVE,
      },
    ],
    rules: [
      T('Every step needs a comment.', 'Setiap langkah perlu komen.'),
      T(
        'An IC number, or a phone number that is not the official one in “How to apply”, blocks the post.',
        'Nombor IC, atau nombor telefon yang bukan nombor rasmi dalam “How to apply”, menghalang iklan itu.',
      ),
      T(
        'Applicants are seen only by HR, the HR Director and the CEO. No IC number, CV or photo is kept.',
        'Pemohon hanya dilihat oleh HR, Pengarah HR dan CEO. Tiada nombor IC, CV atau gambar disimpan.',
      ),
      T('Any edit sends the post back to draft and clears the approval.', 'Sebarang suntingan mengembalikan iklan kepada draf dan membatalkan kelulusan.'),
    ],
    status: 'in_force',
    statusNote: T(
      'Social media and JobStreet are not connected: HR posts by hand and records the link.',
      'Media sosial dan JobStreet belum disambung: HR menyiarkan secara manual dan merekod pautan.',
    ),
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 and 5 Nov 2026; C2, 11 Nov 2026 (CEO signs central posts)' },
    words: 'vacancy jawatan kosong job post iklan jawatan hiring pengambilan applicant pemohon interview temu duga recruit',
  },
  {
    id: 'hr-movement',
    app: 'hr',
    title: T('Promotion, transfer or secondment', 'Kenaikan pangkat, pertukaran atau pinjaman'),
    purpose: T(
      'HR prepares a staff movement; the right people approve; it takes effect only on its date, when HR or the CEO applies it.',
      'HR menyediakan pergerakan staf; pihak yang betul meluluskan; ia berkuat kuasa hanya pada tarikhnya, apabila HR atau CEO melaksanakannya.',
    ),
    start: HR_MOVE,
    starter: T('HR only', 'HR sahaja'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T('Prepares the movement with a comment. Only one waiting movement per person.', 'Menyediakan pergerakan dengan komen. Hanya satu pergerakan menunggu bagi setiap orang.'),
        where: HR_MOVE,
      },
      {
        who: T('Approvers, in order', 'Pelulus, mengikut urutan'),
        does: T(
          'Promotion: the HR Director, then the CEO, then the Vice Chairman consents. Transfer: the receiving company head accepts (on Company today), then the HR Director. Secondment: the host company head, then the HR Director, then the CEO consents.',
          'Kenaikan pangkat: Pengarah HR, kemudian CEO, kemudian Naib Pengerusi memberi persetujuan. Pertukaran: ketua syarikat penerima menerima (di Syarikat hari ini), kemudian Pengarah HR. Pinjaman: ketua syarikat tuan rumah, kemudian Pengarah HR, kemudian CEO memberi persetujuan.',
        ),
        where: HR_MOVE,
        decision: true,
      },
      {
        who: T('HR or CEO', 'HR atau CEO'),
        does: T('On or after the effective date presses “Apply movements due today”.', 'Pada atau selepas tarikh berkuat kuasa tekan “Apply movements due today”.'),
        where: HR_MOVE,
      },
      {
        who: T('HR Director or CEO', 'Pengarah HR atau CEO'),
        does: T(
          'After a transfer, authorises the login handover with a reason (never the preparer, the applier or the person moved).',
          'Selepas pertukaran, membenarkan serahan log masuk dengan sebab (bukan penyedia, pelaksana atau orang yang dipindahkan).',
        ),
        where: HR_MOVE,
        decision: true,
      },
      {
        who: T('IT', 'IT'),
        does: T(
          'Moves the login through the account process, then confirms in Prima under “Login handovers after a transfer”.',
          'Memindahkan log masuk melalui proses akaun, kemudian mengesahkan dalam Prima di bawah “Login handovers after a transfer”.',
        ),
        where: at('it', 'IT', 'IT'),
      },
    ],
    rules: [
      T(
        'Nobody approves their own preparation, a movement of themselves, or two steps of the same movement. Every step needs a comment.',
        'Tiada sesiapa meluluskan persediaannya sendiri, pergerakan dirinya, atau dua langkah bagi pergerakan yang sama. Setiap langkah perlu komen.',
      ),
      T(
        'A transfer is a fresh employment by law; the record keeps when the person joined the group.',
        'Pertukaran ialah pekerjaan baharu dari segi undang-undang; rekod mengekalkan tarikh orang itu menyertai kumpulan.',
      ),
      T('Nothing changes on any record until the effective date.', 'Tiada apa berubah pada mana-mana rekod sehingga tarikh berkuat kuasa.'),
      T(
        'A movement is not applied while a payroll month from its effective month is already submitted; HR returns and recalculates that month first.',
        'Pergerakan tidak dilaksanakan selagi bulan gaji bagi bulan berkuat kuasanya sudah dihantar; HR memulangkan dan mengira semula bulan itu dahulu.',
      ),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 3 Nov 2026' },
    words: 'promotion kenaikan pangkat transfer pertukaran secondment pinjaman movement pergerakan staff',
  },
  {
    id: 'hr-rehire-check',
    app: 'hr',
    title: T('Check someone’s history before hiring', 'Semak sejarah seseorang sebelum mengambil kerja'),
    purpose: T(
      'Every group company’s record of the same person is linked, so HR and leaders can see where someone worked before and any “do not hire again” mark.',
      'Rekod setiap syarikat kumpulan bagi orang yang sama dipautkan, supaya HR dan pemimpin boleh melihat di mana seseorang pernah bekerja dan sebarang tanda “jangan ambil semula”.',
    ),
    start: HR_MOVE,
    starter: T('HR; the Regional OM, OGM, Operations Director, COO and other group leaders by typing the IC or passport', 'HR; OM Wilayah, OGM, Pengarah Operasi, COO dan pemimpin kumpulan lain dengan menaip IC atau pasport'),
    steps: [
      {
        who: T('Prima, or HR', 'Prima, atau HR'),
        does: T(
          'Links records by IC or passport whenever the number is saved. HR (local staff) or FWM (foreign workers) links a renewed passport or old IC by hand, with a reason.',
          'Memautkan rekod melalui IC atau pasport setiap kali nombor disimpan. HR (staf tempatan) atau FWM (pekerja asing) memautkan pasport baharu atau IC lama secara manual, dengan sebab.',
        ),
        where: HR_MOVE,
      },
      {
        who: T('Regional OM, OGM, Operations Director, COO', 'OM Wilayah, OGM, Pengarah Operasi, COO'),
        does: T(
          'Types the IC or passport to see that one person’s summary: each group company, job, dates and the rehire mark.',
          'Menaip IC atau pasport untuk melihat ringkasan orang itu sahaja: setiap syarikat kumpulan, jawatan, tarikh dan tanda pengambilan semula.',
        ),
        where: PEOPLE('history lookup', 'semakan sejarah'),
      },
      {
        who: T('HR', 'HR'),
        does: T('Marks “Can be hired again” or “Check with HR before hiring”, with a reason.', 'Menanda “Can be hired again” atau “Check with HR before hiring”, dengan sebab.'),
        where: HR_MOVE,
        decision: true,
      },
      {
        who: T('HR Director, COO, OGM, Operations Director or CEO', 'Pengarah HR, COO, OGM, Pengarah Operasi atau CEO'),
        does: T(
          'Only they mark “Do not hire again”, or lift it, with a longer reason.',
          'Hanya mereka menanda “Do not hire again”, atau menariknya balik, dengan sebab yang lebih panjang.',
        ),
        where: HR_MOVE,
        decision: true,
      },
    ],
    rules: [
      T('Prima suggests a look but never decides and never blocks a hire.', 'Prima mencadangkan semakan tetapi tidak sekali-kali memutuskan atau menghalang pengambilan.'),
      T('A person marked “Do not hire again” shows a red notice wherever their history is seen.', 'Orang yang ditanda “Do not hire again” menunjukkan notis merah di mana-mana sejarahnya dilihat.'),
      T('Each person outside HR has 30 lookups a day; every lookup is audited.', 'Setiap orang di luar HR mempunyai 30 semakan sehari; setiap semakan diaudit.'),
      T(
        'CSG and TNG belong to the person and can be carried to the new record; the KDN guard card and eSIMS vetting never carry over.',
        'CSG dan TNG milik orang itu dan boleh dibawa ke rekod baharu; kad pengawal KDN dan tapisan eSIMS tidak dibawa.',
      ),
    ],
    status: 'in_force',
    statusNote: T(
      'Linking works only once the server’s secret key is set; until then the screens say linking is off.',
      'Pautan hanya berfungsi setelah kunci rahsia pelayan ditetapkan; sebelum itu skrin menyatakan pautan dimatikan.',
    ),
    source: { doc: 'docs/STAFF_HISTORY.md', decided: 'Fauzan, 4 Nov 2026' },
    words: 'history sejarah rehire ambil semula do not hire jangan ambil blacklist ic passport pasport lookup semak',
  },

  // ---------------------------------------------------------------- Cases, screening, policies, safety
  {
    id: 'hr-case',
    app: 'hr',
    title: T('Staff HR case: misconduct, harassment, grievance', 'Kes HR staf: salah laku, gangguan, rungutan'),
    purpose: T(
      'HR records each step of a case in the staff member’s HR file, with the right to be heard; only the HR Director or the CEO records the outcome.',
      'HR merekod setiap langkah kes dalam fail HR staf, dengan hak untuk didengar; hanya Pengarah HR atau CEO merekod keputusan.',
    ),
    start: HR_CASES,
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Opens the case: misconduct, sexual harassment, grievance or performance, from the written complaint or the supervisor’s report.',
          'Membuka kes: salah laku, gangguan seksual, rungutan atau prestasi, daripada aduan bertulis atau laporan penyelia.',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Sends a show-cause letter, giving at least 7 days to reply in writing.',
          'Menghantar surat tunjuk sebab, memberi sekurang-kurangnya 7 hari untuk menjawab secara bertulis.',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Sets up the domestic inquiry after the show-cause letter. The panel leaves out the staff member, the complainant and whoever opened the case.',
          'Menyediakan siasatan dalaman selepas surat tunjuk sebab. Panel tidak termasuk staf itu, pengadu dan pembuka kes.',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR Director or CEO', 'Pengarah HR atau CEO'),
        does: T('Records the outcome.', 'Merekod keputusan.'),
        where: HR_CASES,
        decision: true,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T('May appeal in writing within 14 days.', 'Boleh merayu secara bertulis dalam 14 hari.'),
        where: HR_CASES,
      },
    ],
    rules: [
      T(
        'Dismissal, downgrade or suspension without wages (at most 14 days) only after an inquiry has found the charge proven.',
        'Pemecatan, penurunan pangkat atau penggantungan tanpa gaji (paling lama 14 hari) hanya selepas siasatan mendapati pertuduhan terbukti.',
      ),
      T('A suspension before the inquiry lasts at most 14 days, on at least half pay.', 'Penggantungan sebelum siasatan paling lama 14 hari, dengan sekurang-kurangnya separuh gaji.'),
      T(
        'Sexual harassment cases are confidential (HR, the HR Director and the CEO only); HR sets up an inquiry, or refuses one with written reasons, within 30 days.',
        'Kes gangguan seksual adalah sulit (HR, Pengarah HR dan CEO sahaja); HR mengadakan siasatan, atau menolaknya dengan sebab bertulis, dalam 30 hari.',
      ),
      T('HR never handles a case they are part of. The app never decides.', 'HR tidak mengendalikan kes yang melibatkan dirinya. Aplikasi tidak sekali-kali memutuskan.'),
      T('Company managers read their own company’s non-confidential cases but cannot act on them.', 'Pengurus syarikat boleh membaca kes tidak sulit syarikat sendiri tetapi tidak boleh bertindak.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026' },
    words: 'case kes discipline disiplin misconduct salah laku harassment gangguan seksual grievance rungutan show cause tunjuk sebab inquiry siasatan',
  },
  {
    id: 'hr-discipline-appeal',
    app: 'hr',
    title: T('Appeal against a warning or outcome', 'Rayuan terhadap amaran atau keputusan'),
    purpose: T(
      'Office staff and guards may appeal a warning or an outcome within 14 days; the HR Director or the CEO decides with written reasons.',
      'Staf pejabat dan pengawal boleh merayu amaran atau keputusan dalam 14 hari; Pengarah HR atau CEO memutuskan dengan sebab bertulis.',
    ),
    start: at('mine', 'Duty › My details › Warnings', 'Tugas › Butiran saya › Amaran', 'warnings'),
    starter: T('The staff member or guard (or HR or the company from their letter)', 'Staf atau pengawal (atau HR atau syarikat daripada surat mereka)'),
    steps: [
      {
        who: T('Guard', 'Pengawal'),
        does: T(
          'Appeals on their own sign-in, or the company or HR records it from the guard’s letter.',
          'Merayu melalui log masuk sendiri, atau syarikat atau HR merekodnya daripada surat pengawal.',
        ),
        where: at('mine', 'Duty › My details › Warnings', 'Tugas › Butiran saya › Amaran', 'warnings'),
      },
      {
        who: T('HR (office staff)', 'HR (staf pejabat)'),
        does: T(
          'Records the staff member’s written appeal on the case, with the language it was written in.',
          'Merekod rayuan bertulis staf pada kes itu, bersama bahasa yang digunakan.',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR Director or CEO', 'Pengarah HR atau CEO'),
        does: T(
          'Decides with written reasons: upheld, varied to a lighter step, or overturned.',
          'Memutuskan dengan sebab bertulis: dikekalkan, diubah kepada langkah lebih ringan, atau dibatalkan.',
        ),
        where: at('hr', 'HR monitor › Guard discipline appeals', 'Pemantauan HR › Rayuan disiplin pengawal', 'cases'),
        decision: true,
      },
    ],
    rules: [
      T(
        'Within 14 days: a verbal, written or final warning, or another outcome (and for guards also suspension, downgrade or dismissal).',
        'Dalam 14 hari: amaran lisan, bertulis atau terakhir, atau keputusan lain (dan bagi pengawal juga penggantungan, penurunan pangkat atau pemecatan).',
      ),
      T(
        'Never decided by the person who made or recorded the decision, the person who recorded the appeal, the staff member or the complainant.',
        'Tidak sekali-kali diputuskan oleh orang yang membuat atau merekod keputusan, orang yang merekod rayuan, staf itu atau pengadu.',
      ),
      T(
        'A show-cause letter and the inquiry are how a guard is heard, so they are not appealed.',
        'Surat tunjuk sebab dan siasatan ialah cara pengawal didengar, jadi ia tidak dirayu.',
      ),
      T('An appeal within the window reopens a closed case; a case cannot close while an appeal waits.', 'Rayuan dalam tempoh itu membuka semula kes yang ditutup; kes tidak boleh ditutup semasa rayuan menunggu.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_POLICY_LANGUAGES_AND_APPEALS.md', decided: 'Fauzan, 6 and 8 Nov 2026' },
    words: 'appeal rayuan warning amaran discipline disiplin dismissal pemecatan guard pengawal',
  },
  {
    id: 'hr-screening',
    app: 'hr',
    title: T('Screening a guard, officer, staff member or director', 'Tapisan pengawal, pegawai, staf atau pengarah'),
    purpose: T(
      'One screening case per person, each check with its evidence; the HR Director decides, and screening is repeated on time.',
      'Satu kes tapisan bagi setiap orang, setiap semakan dengan buktinya; Pengarah HR memutuskan, dan tapisan diulang tepat pada masanya.',
    ),
    start: HR_CASES,
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Opens a case from the staff number, or picks the company and enters the name and last four ID digits for a director or shareholder. Prima fills in what HR already holds (KDN card, eSIMS vetting, the ID on file).',
          'Membuka kes daripada nombor staf, atau memilih syarikat dan memasukkan nama dan empat digit akhir ID bagi pengarah atau pemegang saham. Prima mengisi apa yang HR sudah ada (kad KDN, tapisan eSIMS, ID dalam fail).',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Records each check: “clear” with the authority’s reference or where the evidence is filed; a concern or “not needed” with a reason.',
          'Merekod setiap semakan: “clear” dengan rujukan pihak berkuasa atau tempat bukti disimpan; kebimbangan atau “not needed” dengan sebab.',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR Director (CoS or DCoS)', 'Pengarah HR (Ketua Staf atau Timbalan)'),
        does: T(
          'Decides with a reason, never on a case they opened: cleared only when every check is done; “cleared to start, KDN vetting pending” only for a guard or officer whose eSIMS vetting is submitted.',
          'Memutuskan dengan sebab, tidak bagi kes yang dibukanya: lulus hanya apabila semua semakan selesai; “cleared to start, KDN vetting pending” hanya bagi pengawal atau pegawai yang tapisan eSIMS sudah dihantar.',
        ),
        where: HR_CASES,
        decision: true,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Starts the repeat screening with one tap when it shows as due (60 days ahead).',
          'Memulakan tapisan ulangan dengan satu tekan apabila ia ditunjukkan sebagai perlu (60 hari lebih awal).',
        ),
        where: HR_CASES,
      },
    ],
    rules: [
      T(
        'Checks: guards and officers (application, interview, consent, identity, KDN vetting, police, references, medical); office staff (application, interview, consent, identity, references, qualifications); directors and shareholders (consent, identity, police, bankruptcy, SSM search).',
        'Semakan: pengawal dan pegawai (permohonan, temu duga, persetujuan, identiti, tapisan KDN, polis, rujukan, perubatan); staf pejabat (permohonan, temu duga, persetujuan, identiti, rujukan, kelayakan); pengarah dan pemegang saham (persetujuan, identiti, polis, kebankrapan, carian SSM).',
      ),
      T(
        'Repeat every 36 months for staff and guards, every 12 months for directors and shareholders.',
        'Ulang setiap 36 bulan bagi staf dan pengawal, setiap 12 bulan bagi pengarah dan pemegang saham.',
      ),
      T('A concern on file needs written conditions to clear.', 'Kebimbangan dalam fail memerlukan syarat bertulis untuk diluluskan.'),
      T(
        'Only HR, the HR Director and the CEO work with screening; ACT reads only; companies, officers and staff never see it.',
        'Hanya HR, Pengarah HR dan CEO bekerja dengan tapisan; ACT membaca sahaja; syarikat, pegawai dan staf tidak melihatnya.',
      ),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_SCREENING_AND_CONDUCT.md', decided: 'Fauzan, 24 Oct and 8 Nov 2026' },
    words: 'screening tapisan vetting kdn esims police polis background check semakan latar belakang director pengarah',
  },
  {
    id: 'hr-policy-ack',
    app: 'hr',
    title: T('Handbook, code of conduct and policies: read and sign', 'Buku panduan, kod etika dan polisi: baca dan tandatangan'),
    purpose: T(
      'HR publishes a policy in English and Malay (and staff mother tongues); everyone it is for reads and acknowledges it.',
      'HR menerbitkan polisi dalam Bahasa Inggeris dan Melayu (dan bahasa ibunda staf); semua yang berkenaan membaca dan mengakuinya.',
    ),
    start: HR_GROW,
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Publishes the handbook, code of conduct or policy for its audience (office, guards and officers, or everyone), with the English text and the Malay copy, and other mother-tongue copies with who translated them.',
          'Menerbitkan buku panduan, kod etika atau polisi untuk sasarannya (pejabat, pengawal dan pegawai, atau semua), dengan teks Inggeris dan salinan Melayu, dan salinan bahasa ibunda lain bersama nama penterjemah.',
        ),
        where: HR_GROW,
      },
      {
        who: T('Office staff', 'Staf pejabat'),
        does: T('Open the text and acknowledge “I have read and understood it”.', 'Membuka teks dan mengaku “I have read and understood it”.'),
        where: CLOCK('Policies to read', 'Polisi untuk dibaca'),
      },
      {
        who: T('Guards and officers', 'Pengawal dan pegawai'),
        does: T(
          'Acknowledge on their own sign-in, in a language of their choice.',
          'Mengaku melalui log masuk sendiri, dalam bahasa pilihan mereka.',
        ),
        where: at('mine', 'Duty', 'Tugas'),
      },
      {
        who: T('Officer, OM, company manager or HR', 'Pegawai, OM, pengurus syarikat atau HR'),
        does: T(
          'For guards without the app, records a briefing: who attended and understood, the briefing sheet or reference and the language (at most 80 people at a time).',
          'Bagi pengawal tanpa aplikasi, merekod taklimat: siapa hadir dan faham, helaian atau rujukan taklimat dan bahasa (paling ramai 80 orang sekali).',
        ),
        where: at('mine', 'Duty › Briefing acknowledgements', 'Tugas › Pengakuan taklimat'),
      },
      {
        who: T('HR', 'HR'),
        does: T('Sees who has not acknowledged, and which mother tongues still lack a copy.', 'Melihat siapa belum mengaku, dan bahasa ibunda mana masih tiada salinan.'),
        where: HR_GROW,
      },
    ],
    rules: [
      T('Publishing without the Malay copy is refused. Prima never machine-translates a policy.', 'Penerbitan tanpa salinan Melayu ditolak. Prima tidak sekali-kali menterjemah polisi secara mesin.'),
      T(
        'A material change asks everyone again; a small correction keeps the acknowledgements.',
        'Perubahan penting meminta semua mengaku semula; pembetulan kecil mengekalkan pengakuan.',
      ),
      T('Only HR publishes, translates or sets a staff language.', 'Hanya HR menerbitkan, menterjemah atau menetapkan bahasa staf.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_POLICY_LANGUAGES_AND_APPEALS.md', decided: 'Fauzan, 2, 6 and 8 Nov 2026' },
    words: 'handbook buku panduan code of conduct kod etika policy polisi acknowledge akui briefing taklimat language bahasa',
  },
  {
    id: 'hr-appraisal',
    app: 'hr',
    title: T('Yearly appraisal', 'Penilaian tahunan'),
    purpose: T(
      'HR opens a yearly appraisal and names the appraiser; the appraiser rates; the staff member reads and may comment; HR closes it.',
      'HR membuka penilaian tahunan dan menamakan penilai; penilai memberi markah; staf membaca dan boleh memberi komen; HR menutupnya.',
    ),
    start: HR_GROW,
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T('Opens one appraisal per staff member per year and names the appraiser.', 'Membuka satu penilaian bagi setiap staf setahun dan menamakan penilai.'),
        where: HR_GROW,
      },
      {
        who: T('Appraiser', 'Penilai'),
        does: T('Rates 1 to 5 with a comment.', 'Memberi markah 1 hingga 5 dengan komen.'),
        where: CLOCK('Appraisals', 'Penilaian'),
        decision: true,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T('Sees it only after it is rated, reads it and may comment.', 'Melihatnya hanya selepas dinilai, membacanya dan boleh memberi komen.'),
        where: CLOCK('Appraisals', 'Penilaian'),
      },
      {
        who: T('HR', 'HR'),
        does: T('Closes it with a comment once the staff member has read it, or after 14 days.', 'Menutupnya dengan komen setelah staf membacanya, atau selepas 14 hari.'),
        where: HR_GROW,
      },
    ],
    rules: [
      T('The staff member never appraises themselves, and HR never opens their own.', 'Staf tidak menilai dirinya sendiri, dan HR tidak membuka penilaiannya sendiri.'),
      T('The appraisal is separate from the work KPIs.', 'Penilaian ini berasingan daripada KPI kerja.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026' },
    words: 'appraisal penilaian review prestasi performance rating markah',
  },
  {
    id: 'hr-office-osh',
    app: 'hr',
    title: T('Office safety: coordinator, risk assessment, DOSH report', 'Keselamatan pejabat: penyelaras, penilaian risiko, laporan JKKP'),
    purpose: T(
      'Each employer has an OSH coordinator, assesses office risks, and reports accidents to DOSH within 7 days.',
      'Setiap majikan ada penyelaras OSH, menilai risiko pejabat, dan melaporkan kemalangan kepada JKKP dalam 7 hari.',
    ),
    start: HR_CASES,
    starter: T('HR, the employer’s OSH coordinator, or the company manager', 'HR, penyelaras OSH majikan, atau pengurus syarikat'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Names each employer’s OSH coordinator (an employer with 5 or more staff and no coordinator is flagged).',
          'Menamakan penyelaras OSH setiap majikan (majikan dengan 5 staf atau lebih tanpa penyelaras ditanda).',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR or the coordinator', 'HR atau penyelaras'),
        does: T(
          'Records each office or floor’s risk assessment (HIRARC) with the hazards; high risks need a note of the controls. A review is due after 12 months.',
          'Merekod penilaian risiko (HIRARC) setiap pejabat atau tingkat dengan bahayanya; risiko tinggi perlu nota kawalan. Semakan semula perlu selepas 12 bulan.',
        ),
        where: CLOCK('Office safety (for the coordinator)', 'Keselamatan pejabat (untuk penyelaras)'),
      },
      {
        who: T('HR, the coordinator or the company manager', 'HR, penyelaras atau pengurus syarikat'),
        does: T(
          'Records an accident, dangerous occurrence, poisoning or disease, saying if it was a death or serious injury.',
          'Merekod kemalangan, kejadian berbahaya, keracunan atau penyakit, menyatakan jika ia kematian atau kecederaan parah.',
        ),
        where: HR_CASES,
      },
      {
        who: T('HR or the coordinator', 'HR atau penyelaras'),
        does: T(
          'Sends JKKP 6 (JKKP 7 for a disease) to DOSH within 7 days, then records the DOSH reference in Prima.',
          'Menghantar JKKP 6 (JKKP 7 bagi penyakit) kepada JKKP dalam 7 hari, kemudian merekod rujukan JKKP dalam Prima.',
        ),
        where: HR_CASES,
      },
    ],
    rules: [
      T('A death or serious injury is flagged so DOSH is told at once.', 'Kematian atau kecederaan parah ditanda supaya JKKP dimaklumkan serta-merta.'),
      T('The yearly JKKP 8 summary is due by 31 January.', 'Ringkasan tahunan JKKP 8 perlu sebelum 31 Januari.'),
      T('Prima never files with DOSH; it reminds and keeps the reference.', 'Prima tidak menghantar kepada JKKP; ia mengingatkan dan menyimpan rujukan.'),
      T('Naming a new coordinator ends the old one the same day.', 'Menamakan penyelaras baharu menamatkan yang lama pada hari yang sama.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 2 Nov 2026 (gaps 13 to 15)' },
    words: 'osh safety keselamatan dosh jkkp accident kemalangan hirarc risk risiko coordinator penyelaras',
  },
  {
    id: 'hr-socso-claim',
    app: 'hr',
    title: T('SOCSO (PERKESO) claim for an injured worker', 'Tuntutan PERKESO bagi pekerja yang cedera'),
    purpose: T(
      'When a worker is hurt at work, the claim is started in Prima, HR submits Form 34 in ASSIST, records each step, and plans the return to work.',
      'Apabila pekerja cedera semasa bekerja, tuntutan dimulakan dalam Prima, HR menghantar Borang 34 dalam ASSIST, merekod setiap langkah, dan merancang kembali bekerja.',
    ),
    start: at('socso', 'SOCSO claims › Start a claim', 'Tuntutan PERKESO › Mulakan tuntutan'),
    starter: T('The OM or HR (HR for office staff)', 'OM atau HR (HR bagi staf pejabat)'),
    steps: [
      {
        who: T('Guard or officer', 'Pengawal atau pegawai'),
        does: T(
          'Tells the OM straight away and gets treatment first, at any panel clinic or government hospital.',
          'Memaklumkan OM serta-merta dan mendapatkan rawatan dahulu, di mana-mana klinik panel atau hospital kerajaan.',
        ),
        outside: true,
      },
      {
        who: T('OM or HR', 'OM atau HR'),
        does: T(
          'Starts the claim, with when it happened and when the company was told (or from the person’s profile, SOCSO tab).',
          'Memulakan tuntutan, dengan bila ia berlaku dan bila syarikat dimaklumkan (atau dari profil orang itu, tab SOCSO).',
        ),
        where: at('socso', 'SOCSO claims › Start a claim', 'Tuntutan PERKESO › Mulakan tuntutan'),
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Submits Form 34 in PERKESO ASSIST within 48 hours of being told and records the reference in Prima.',
          'Menghantar Borang 34 dalam PERKESO ASSIST dalam 48 jam selepas dimaklumkan dan merekod rujukan dalam Prima.',
        ),
        where: at('socso', 'SOCSO claims › the claim', 'Tuntutan PERKESO › tuntutan itu'),
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Adds the papers on the checklist, marks them complete, then under PERKESO review, and records PERKESO’s decision.',
          'Menambah dokumen dalam senarai semak, menandanya lengkap, kemudian dalam semakan PERKESO, dan merekod keputusan PERKESO.',
        ),
        where: at('socso', 'SOCSO claims › the claim', 'Tuntutan PERKESO › tuntutan itu'),
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'Rejected: appeals to the Appellate Board within 90 days, or closes. Approved: records the amount paid and closes.',
          'Ditolak: merayu kepada Lembaga Rayuan dalam 90 hari, atau menutup. Diluluskan: merekod jumlah dibayar dan menutup.',
        ),
        where: at('socso', 'SOCSO claims › the claim', 'Tuntutan PERKESO › tuntutan itu'),
        decision: true,
      },
      {
        who: T('OM and HR', 'OM dan HR'),
        does: T(
          'Return to work: the plan, work restrictions that stop the roster placing the person on unsuitable posts, appointments and weekly check-ins.',
          'Kembali bekerja: pelan, sekatan kerja yang menghalang jadual tugas meletakkan orang itu di pos yang tidak sesuai, temu janji dan semakan mingguan.',
        ),
        where: at('socso', 'SOCSO claims › the claim › Return to work', 'Tuntutan PERKESO › tuntutan itu › Kembali bekerja'),
      },
    ],
    rules: [
      T(
        'MC days are paid on basic pay only: 3 days or fewer are company sick leave; 4 days or more on an accepted claim are paid by PERKESO, not the company.',
        'Hari MC dibayar atas gaji pokok sahaja: 3 hari atau kurang ialah cuti sakit syarikat; 4 hari atau lebih bagi tuntutan yang diterima dibayar oleh PERKESO, bukan syarikat.',
      ),
      T('Medical papers are seen by HR only.', 'Dokumen perubatan hanya dilihat oleh HR.'),
      T('Permanent disablement: claim within 12 months of the last MC day.', 'Hilang upaya kekal: tuntut dalam 12 bulan dari hari MC terakhir.'),
      T('PERKESO has no link to Prima: HR works in ASSIST and records the reference here.', 'PERKESO tiada pautan dengan Prima: HR bekerja dalam ASSIST dan merekod rujukan di sini.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W15; Fauzan, 26 Oct 2026 (MC pay)' },
    words: 'socso perkeso injury kecederaan accident kemalangan form 34 borang 34 assist mc return to work kembali bekerja',
  },
  {
    id: 'hr-staff-claim',
    app: 'hr',
    title: T('Staff claim: medical, optical, check-up, travel', 'Tuntutan staf: perubatan, optik, pemeriksaan, perjalanan'),
    purpose: T(
      'Staff keep receipts in their wallet and claim; the company head verifies, HR checks, the COO approves and Finance pays.',
      'Staf menyimpan resit dalam dompet dan membuat tuntutan; ketua syarikat mengesahkan, HR menyemak, COO meluluskan dan Kewangan membayar.',
    ),
    start: at('claims', 'Claims › My claims › New claim', 'Tuntutan › Tuntutan saya › Tuntutan baharu', 'mine'),
    starter: T('Office and management staff (not guards or officers)', 'Staf pejabat dan pengurusan (bukan pengawal atau pegawai)'),
    steps: [
      {
        who: T('Staff member', 'Staf'),
        does: T(
          'Keeps each receipt in My receipts (camera or upload). The phone reads the date, total, shop and kind; you check or correct the figures.',
          'Menyimpan setiap resit dalam My receipts (kamera atau muat naik). Telefon membaca tarikh, jumlah, kedai dan jenis; anda menyemak atau membetulkan angka.',
        ),
        where: CLAIMS_MINE,
      },
      {
        who: T('Staff member (travel)', 'Staf (perjalanan)'),
        does: T('Asks the Chief of Staff to approve the trip before going.', 'Meminta Ketua Staf meluluskan perjalanan sebelum pergi.'),
        where: CLAIMS_MINE,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T('Presses “Claim now” on a receipt, or “New claim”, and sends it.', 'Menekan “Claim now” pada resit, atau “New claim”, dan menghantarnya.'),
        where: CLAIMS_MINE,
      },
      {
        who: T('Company head (the line manager for PWVSB central staff)', 'Ketua syarikat (pengurus barisan bagi staf pusat PWVSB)'),
        does: T('Verifies with a comment; a rejection, with a reason, ends the claim.', 'Mengesahkan dengan komen; penolakan, dengan sebab, menamatkan tuntutan.'),
        where: CLAIMS_QUEUE,
        decision: true,
      },
      {
        who: T('HR', 'HR'),
        does: T('Checks the claim against the policy limits.', 'Menyemak tuntutan berbanding had polisi.'),
        where: CLAIMS_QUEUE,
        decision: true,
      },
      {
        who: T('Chief of Staff', 'Ketua Staf'),
        does: T(
          'Approves a trip that was not approved before it was made, or one more than 10% off the system km.',
          'Meluluskan perjalanan yang tidak diluluskan sebelum dibuat, atau yang berbeza lebih 10% daripada km sistem.',
        ),
        where: CLAIMS_QUEUE,
        decision: true,
      },
      {
        who: T('COO', 'COO'),
        does: T('Approves, only after the company head has verified.', 'Meluluskan, hanya selepas ketua syarikat mengesahkan.'),
        where: CLAIMS_QUEUE,
        decision: true,
      },
      {
        who: T('Finance', 'Kewangan'),
        does: T('Pays and records the payment with its reference.', 'Membayar dan merekod bayaran dengan rujukannya.'),
        where: CLAIMS_QUEUE,
      },
    ],
    rules: [
      T(
        'Medical with dental up to RM1,000 a year, optical RM500 every 2 years, the yearly check-up separately, and travel at the published rate per km. Valet parking cannot be claimed.',
        'Perubatan termasuk pergigian hingga RM1,000 setahun, optik RM500 setiap 2 tahun, pemeriksaan tahunan berasingan, dan perjalanan pada kadar sekilometer yang diterbitkan. Valet parking tidak boleh dituntut.',
      ),
      T(
        'The Chief of Staff publishes the mileage rates each month; travel cannot be claimed until they are published.',
        'Ketua Staf menerbitkan kadar perbatuan setiap bulan; perjalanan tidak boleh dituntut sehingga kadar diterbitkan.',
      ),
      T(
        'A receipt is claimed within 60 days of its date and goes into one claim only; the wallet warns when 7 days or less are left.',
        'Resit dituntut dalam 60 hari dari tarikhnya dan masuk ke satu tuntutan sahaja; dompet memberi amaran apabila tinggal 7 hari atau kurang.',
      ),
      T('The company head and HR may check in any order; nobody verifies their own claim.', 'Ketua syarikat dan HR boleh menyemak dalam apa-apa urutan; tiada sesiapa mengesahkan tuntutannya sendiri.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/STAFF_RECEIPT_WALLET.md', decided: 'Fauzan, 26 Oct and 2 Nov 2026' },
    words: 'claim tuntutan medical perubatan dental pergigian optical optik travel perjalanan mileage perbatuan receipt resit wallet dompet',
  },
  {
    id: 'hr-handover',
    app: 'hr',
    title: T('Hand-over between departments', 'Serah tugas antara jabatan'),
    purpose: T(
      'Key it once: when one desk saves a record another desk needs, Prima gives the other desk a to-do or a notice with a link.',
      'Masukkan sekali: apabila satu meja menyimpan rekod yang diperlukan meja lain, Prima memberi meja itu tugasan atau notis dengan pautan.',
    ),
    start: at('handovers', 'Hand-overs › My hand-overs', 'Serah tugas › Serah tugas saya', 'mine'),
    starter: T('Prima, when a desk saves a record (for example HR adds a staff member)', 'Prima, apabila meja menyimpan rekod (contohnya HR menambah staf)'),
    steps: [
      {
        who: T('A desk', 'Satu meja'),
        does: T('Saves a record on its own screen, for example HR adds a staff member.', 'Menyimpan rekod di skrinnya sendiri, contohnya HR menambah staf.'),
      },
      {
        who: T('Prima', 'Prima'),
        does: T('Creates a to-do or a notice for each receiving desk, with a due time.', 'Mencipta tugasan atau notis bagi setiap meja penerima, dengan masa akhir.'),
      },
      {
        who: T('Receiving person', 'Penerima'),
        does: T(
          'Opens it, does the work on their own screen, then marks it Done, Not needed or Noted.',
          'Membukanya, melakukan kerja di skrin sendiri, kemudian menandanya Done, Not needed atau Noted.',
        ),
        where: at('handovers', 'Hand-overs › My hand-overs', 'Serah tugas › Serah tugas saya', 'mine'),
      },
      {
        who: T('ACT and group leaders', 'ACT dan pemimpin kumpulan'),
        does: T('See what is late or has nobody to receive it.', 'Melihat apa yang lewat atau tiada penerima.'),
        where: at('handovers', 'Hand-overs › How departments connect', 'Serah tugas › Cara jabatan berhubung', 'map'),
      },
    ],
    rules: [
      T(
        'A hand-over tells and links; it never approves, pays or changes the other department’s records.',
        'Serah tugas memberitahu dan memaut; ia tidak sekali-kali meluluskan, membayar atau mengubah rekod jabatan lain.',
      ),
    ],
    status: 'in_force',
    statusNote: T('In-app only: email and Teams notices stay off until they are set up and checked.', 'Dalam aplikasi sahaja: notis e-mel dan Teams kekal dimatikan sehingga disediakan dan disemak.'),
    source: { doc: 'docs/system/04-workflows.md', decided: 'W34; Fauzan, 2 Nov 2026 (“Key in once”)' },
    words: 'handover serah tugas hand-over department jabatan to-do tugasan notice notis key in once',
  },

  // ---------------------------------------------------------------- Payroll
  {
    id: 'pay-staff-payroll',
    app: 'pay',
    title: T('Monthly staff payroll', 'Gaji bulanan staf'),
    purpose: T(
      'HR prepares each employer’s month, the Chief of Staff and then the COO approve, Finance pays through the bank, and staff download their payslips.',
      'HR menyediakan bulan setiap majikan, Ketua Staf kemudian COO meluluskan, Kewangan membayar melalui bank, dan staf memuat turun slip gaji.',
    ),
    start: at('staffpay', 'Staff payroll › Start a payroll month', 'Gaji staf › Mulakan bulan gaji', 'runs'),
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Prepares each employer’s month (this month or last) from the staff records: basic pay, allowances, unpaid leave and approved claims, with EPF, SOCSO, EIS, LINDUNG, an estimated PCB, HRD and zakat. Adds one-off allowances from HR’s list, the e-PCB figure and part-month pay.',
          'Menyediakan bulan setiap majikan (bulan ini atau lepas) daripada rekod staf: gaji pokok, elaun, cuti tanpa gaji dan tuntutan yang diluluskan, dengan KWSP, PERKESO, SIP, LINDUNG, anggaran PCB, HRD dan zakat. Menambah elaun sekali bayar daripada senarai HR, angka e-PCB dan gaji separuh bulan.',
        ),
        where: PAYROLL,
      },
      {
        who: T('HR', 'HR'),
        does: T('Submits the month to the Chief of Staff with a comment.', 'Menghantar bulan itu kepada Ketua Staf dengan komen.'),
        where: PAYROLL,
      },
      {
        who: T('Chief of Staff or Deputy', 'Ketua Staf atau Timbalan'),
        does: T('Approves with a comment, or returns it to HR.', 'Meluluskan dengan komen, atau memulangkan kepada HR.'),
        where: PAYROLL,
        decision: true,
      },
      {
        who: T('COO', 'COO'),
        does: T(
          'Approves as COO with a comment (never the person who approved as Chief of Staff), or returns it to HR.',
          'Meluluskan sebagai COO dengan komen (bukan orang yang meluluskan sebagai Ketua Staf), atau memulangkan kepada HR.',
        ),
        where: PAYROLL,
        decision: true,
      },
      {
        who: T('Finance', 'Kewangan'),
        does: T(
          'Pays through the bank’s payroll service, marks it paid with the bank reference and the PCB checked, and posts to SQL Account. Prima only drafts the bank, SQL, EPF, SOCSO and PCB files.',
          'Membayar melalui perkhidmatan gaji bank, menandanya dibayar dengan rujukan bank dan PCB yang disemak, dan memasukkan ke SQL Account. Prima hanya menyediakan draf fail bank, SQL, KWSP, PERKESO dan PCB.',
        ),
        where: PAYROLL,
      },
      {
        who: T('Staff member', 'Staf'),
        does: T('Sees and downloads their own payslips.', 'Melihat dan memuat turun slip gaji sendiri.'),
        where: at('staffpay', 'Staff payroll › My payslips', 'Gaji staf › Slip gaji saya', 'mine'),
      },
    ],
    rules: [
      T('Whoever prepares or submits a month cannot approve it. Every step needs a comment.', 'Sesiapa yang menyediakan atau menghantar bulan itu tidak boleh meluluskannya. Setiap langkah perlu komen.'),
      T('Pay below the RM1,700 minimum wage is flagged on the slip; HR corrects it before approval.', 'Gaji di bawah gaji minimum RM1,700 ditanda pada slip; HR membetulkannya sebelum kelulusan.'),
      T(
        'A month cannot be submitted while a line is stale (recalculate first) or a staff movement into or out of the employer is still waiting.',
        'Bulan tidak boleh dihantar selagi ada baris yang lapuk (kira semula dahulu) atau pergerakan staf masuk atau keluar majikan itu masih menunggu.',
      ),
      T(
        'A new EPF or SOCSO table is loaded by HR or Finance and checked by a second person before use (Staff payroll › EPF and SOCSO tables).',
        'Jadual KWSP atau PERKESO baharu dimuatkan oleh HR atau Kewangan dan disemak oleh orang kedua sebelum digunakan (Gaji staf › Jadual KWSP dan PERKESO).',
      ),
      T('Guards and officers are paid from the JA Group app, not here.', 'Pengawal dan pegawai dibayar daripada aplikasi JA Group, bukan di sini.'),
    ],
    status: 'trial',
    statusNote: T(
      'November and December 2026 salaries are paid the old way while Prima runs side by side (the learning period to about 18 Jan 2027).',
      'Gaji November dan Disember 2026 dibayar cara lama sementara Prima berjalan seiring (tempoh pembelajaran hingga kira-kira 18 Jan 2027).',
    ),
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 1 Nov 2026; 15 Nov 2026 (side by side)' },
    words: 'payroll gaji salary staff staf payslip slip gaji epf kwsp socso perkeso pcb eis zakat bank',
  },
  {
    id: 'pay-salary-change',
    app: 'pay',
    title: T('Basic pay, salary account or allowance change', 'Perubahan gaji pokok, akaun gaji atau elaun'),
    purpose: T(
      'HR sets the new pay, account or allowance; the HR Director verifies, Finance verifies an account change, the Vice Chairman consents to the amount.',
      'HR menetapkan gaji, akaun atau elaun baharu; Pengarah HR mengesahkan, Kewangan mengesahkan perubahan akaun, Naib Pengerusi memberi persetujuan terhadap jumlah.',
    ),
    start: PEOPLE('the staff member’s record', 'rekod staf'),
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Sets the new basic pay or salary account on the staff form with the reason and start date; or picks an allowance from HR’s list with the amount, start date and reason.',
          'Menetapkan gaji pokok atau akaun gaji baharu di borang staf dengan sebab dan tarikh mula; atau memilih elaun daripada senarai HR dengan jumlah, tarikh mula dan sebab.',
        ),
        where: PEOPLE('the staff member’s record', 'rekod staf'),
      },
      {
        who: T('HR Director (CoS or DCoS)', 'Pengarah HR (Ketua Staf atau Timbalan)'),
        does: T('Verifies with a comment, or refuses with a reason.', 'Mengesahkan dengan komen, atau menolak dengan sebab.'),
        where: HR_PAY,
        decision: true,
      },
      {
        who: T('Finance', 'Kewangan'),
        does: T('Verifies a salary account change, with a comment.', 'Mengesahkan perubahan akaun gaji, dengan komen.'),
        where: PAYROLL,
        decision: true,
      },
      {
        who: T('Vice Chairman', 'Naib Pengerusi'),
        does: T('Consents to the amount with a comment.', 'Memberi persetujuan terhadap jumlah dengan komen.'),
        where: HR_PAY,
        decision: true,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'A change consented for a later date waits; on or after that date HR applies the changes due today.',
          'Perubahan yang dipersetujui untuk tarikh kemudian menunggu; pada atau selepas tarikh itu HR melaksanakan perubahan yang perlu hari ini.',
        ),
        where: HR_PAY,
      },
    ],
    rules: [
      T(
        'Nobody verifies a change they asked for or their own pay. Pay for the CoS or DCoS goes to the Vice Chairman alone.',
        'Tiada sesiapa mengesahkan perubahan yang dia minta atau gajinya sendiri. Gaji Ketua Staf atau Timbalan pergi kepada Naib Pengerusi sahaja.',
      ),
      T(
        'A new salary account is used only after the HR Director and Finance both verify it; a refusal clears the waiting account.',
        'Akaun gaji baharu hanya digunakan selepas Pengarah HR dan Kewangan kedua-duanya mengesahkannya; penolakan mengosongkan akaun yang menunggu.',
      ),
      T(
        'The start date cannot be before the first day of last month; only one change can wait per person.',
        'Tarikh mula tidak boleh sebelum hari pertama bulan lepas; hanya satu perubahan boleh menunggu bagi setiap orang.',
      ),
      T(
        'Only HR changes the allowance list; each allowance’s EPF, SOCSO, PCB and HRD ticks are HR’s decision.',
        'Hanya HR mengubah senarai elaun; tanda KWSP, PERKESO, PCB dan HRD setiap elaun adalah keputusan HR.',
      ),
    ],
    status: 'in_force',
    source: { doc: 'docs/HR_PHASE3.md', decided: 'Fauzan, 27 Oct, 1, 3 and 4 Nov 2026' },
    words: 'pay change perubahan gaji increment kenaikan basic pokok allowance elaun salary account akaun gaji bank vice chairman',
  },
  {
    id: 'pay-statutory-rates',
    app: 'pay',
    title: T('Statutory rates and contribution tables', 'Kadar berkanun dan jadual caruman'),
    purpose: T(
      'The CEO sets the EPF, SOCSO, EIS, LINDUNG and HRD rates from a month; HR or Finance loads the published tables, checked by a second person.',
      'CEO menetapkan kadar KWSP, PERKESO, SIP, LINDUNG dan HRD mulai sesuatu bulan; HR atau Kewangan memuatkan jadual yang diterbitkan, disemak oleh orang kedua.',
    ),
    start: at('statutory', 'Statutory rates', 'Kadar caruman berkanun'),
    starter: T('The CEO (rates); HR or Finance (tables)', 'CEO (kadar); HR atau Kewangan (jadual)'),
    steps: [
      {
        who: T('CEO', 'CEO'),
        does: T(
          'Changes the rates from a month, or adds a new contribution type, with a reason and the law reference.',
          'Mengubah kadar mulai sesuatu bulan, atau menambah jenis caruman baharu, dengan sebab dan rujukan undang-undang.',
        ),
        where: at('statutory', 'Statutory rates', 'Kadar caruman berkanun'),
        decision: true,
      },
      {
        who: T('HR or Finance', 'HR atau Kewangan'),
        does: T('Loads a newly published EPF or SOCSO table, row by row.', 'Memuatkan jadual KWSP atau PERKESO yang baru diterbitkan, baris demi baris.'),
        where: at('staffpay', 'Staff payroll › EPF and SOCSO tables', 'Gaji staf › Jadual KWSP dan PERKESO', 'tables'),
      },
      {
        who: T('A second person (HR or Finance)', 'Orang kedua (HR atau Kewangan)'),
        does: T('Checks the new table before it is used.', 'Menyemak jadual baharu sebelum ia digunakan.'),
        where: at('staffpay', 'Staff payroll › EPF and SOCSO tables', 'Gaji staf › Jadual KWSP dan PERKESO', 'tables'),
        decision: true,
      },
      {
        who: T('HR', 'HR'),
        does: T('Recalculates any draft month from the change onwards.', 'Mengira semula mana-mana bulan draf mulai perubahan itu.'),
        where: PAYROLL,
      },
    ],
    rules: [
      T('Only the CEO changes the rates; HR and Finance see them.', 'Hanya CEO mengubah kadar; HR dan Kewangan melihatnya.'),
      T('A change cannot be backdated before last month; the old version is kept.', 'Perubahan tidak boleh dibuat ke belakang sebelum bulan lepas; versi lama disimpan.'),
      T('Guard pay and staff pay both read the version in force for the pay month.', 'Gaji pengawal dan gaji staf kedua-duanya membaca versi yang berkuat kuasa bagi bulan gaji itu.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/GUARD_PAY_RUN.md', decided: 'Fauzan, 6 Nov 2026' },
    words: 'statutory berkanun epf kwsp socso perkeso eis sip lindung hrd rate kadar table jadual contribution caruman',
  },
  {
    id: 'pay-formula',
    app: 'pay',
    title: T('Guard pay formula set by ACT', 'Formula gaji pengawal ditetapkan ACT'),
    purpose: T(
      'ACT keeps the pay formulas (basic, hours, overtime rates, allowances) and chooses which applies to the group, a region, a company or a site.',
      'ACT menyimpan formula gaji (gaji pokok, jam, kadar lebih masa, elaun) dan memilih yang mana terpakai bagi kumpulan, wilayah, syarikat atau tapak.',
    ),
    start: at('payformulas', 'Pay formulas', 'Formula gaji'),
    starter: T('ACT (Director, Deputy or Assistants)', 'ACT (Pengarah, Timbalan atau Pembantu)'),
    steps: [
      {
        who: T('ACT Deputy or Assistant', 'Timbalan atau Pembantu ACT'),
        does: T('Prepares a formula or a change, with a reason.', 'Menyediakan formula atau perubahan, dengan sebab.'),
        where: at('payformulas', 'Pay formulas', 'Formula gaji'),
      },
      {
        who: T('ACT Director', 'Pengarah ACT'),
        does: T('Sets it live or sends it back, with a reason (or sets a formula live directly).', 'Menjadikannya aktif atau memulangkannya, dengan sebab (atau terus mengaktifkan formula).'),
        where: at('payformulas', 'Pay formulas', 'Formula gaji'),
        decision: true,
      },
      {
        who: T('ACT Director', 'Pengarah ACT'),
        does: T(
          'Picks the formula for the whole group, a region, a company or a site, from a month. The narrowest choice wins.',
          'Memilih formula bagi seluruh kumpulan, wilayah, syarikat atau tapak, mulai sesuatu bulan. Pilihan paling khusus diguna pakai.',
        ),
        where: at('payformulas', 'Pay formulas', 'Formula gaji'),
      },
      {
        who: T('OM and above', 'OM dan ke atas'),
        does: T('Use the salary calculator to see how a guard’s month is worked out.', 'Menggunakan kalkulator gaji untuk melihat cara bulan seorang pengawal dikira.'),
        where: at('salarycalc', 'Salary calculator', 'Kalkulator gaji'),
      },
    ],
    rules: [
      T('A change makes a new version from a month; older months keep the old version; nothing starts in a past month.', 'Perubahan mencipta versi baharu mulai sesuatu bulan; bulan lama kekal dengan versi lama; tiada yang bermula pada bulan lepas.'),
      T('A figure below the Employment Act is saved and flagged to the CEO.', 'Angka di bawah Akta Kerja disimpan dan ditanda kepada CEO.'),
      T('Group leadership sees everything and changes nothing; HR and company managers do not see the screen.', 'Pimpinan kumpulan melihat semua dan tidak mengubah apa-apa; HR dan pengurus syarikat tidak melihat skrin ini.'),
      T('The day divisor (26 today) is set by the CEO in the pay law settings.', 'Pembahagi hari (26 sekarang) ditetapkan oleh CEO dalam tetapan undang-undang gaji.'),
    ],
    status: 'in_force',
    source: { doc: 'docs/PAY_FORMULAS.md', decided: 'Fauzan, 5 and 6 Nov 2026' },
    words: 'pay formula formula gaji act overtime lebih masa shift syif rest rehat salary calculator kalkulator gaji',
  },
  {
    id: 'pay-guard-run',
    app: 'pay',
    title: T('Monthly guard pay run', 'Larian gaji bulanan pengawal'),
    purpose: T(
      'A company’s named preparer works out the month from locked attendance and the ACT formula; the COO approves; Finance pays; guards see payslips on Duty.',
      'Penyedia yang dinamakan syarikat mengira bulan itu daripada kehadiran yang dikunci dan formula ACT; COO meluluskan; Kewangan membayar; pengawal melihat slip gaji di Tugas.',
    ),
    start: GUARD_PAY,
    starter: T('The company executive the company manager names', 'Eksekutif syarikat yang dinamakan pengurus syarikat'),
    steps: [
      {
        who: T('Company manager', 'Pengurus syarikat'),
        does: T(
          'Names one or more people in the company office who prepare the guard pay, with a reason. OMs cannot be named.',
          'Menamakan seorang atau lebih di pejabat syarikat yang menyediakan gaji pengawal, dengan sebab. OM tidak boleh dinamakan.',
        ),
        where: GUARD_PAY,
      },
      {
        who: T('Named preparer', 'Penyedia yang dinamakan'),
        does: T(
          'Prepares or recalculates the month (this month or last) and may enter a PCB from e-PCB or a one-off item with a reason.',
          'Menyediakan atau mengira semula bulan itu (bulan ini atau lepas) dan boleh memasukkan PCB daripada e-PCB atau item sekali bayar dengan sebab.',
        ),
        where: GUARD_PAY,
      },
      {
        who: T('Named preparer', 'Penyedia yang dinamakan'),
        does: T(
          'Submits the month. It is refused while a shift is unlocked or has no clock-out, a worked site has no formula, a guard has no account and is not listed for cash, hours paid do not match hours recorded, or a line is negative.',
          'Menghantar bulan itu. Ia ditolak selagi ada syif belum dikunci atau tiada daftar keluar, tapak tanpa formula, pengawal tanpa akaun dan tidak disenaraikan untuk tunai, jam dibayar tidak sepadan dengan jam direkod, atau baris negatif.',
        ),
        where: GUARD_PAY,
      },
      {
        who: T('COO (the CEO stands in during the pilot)', 'COO (CEO menggantikan semasa perintis)'),
        does: T('Approves with a reason, or returns it to the company with a reason.', 'Meluluskan dengan sebab, atau memulangkan kepada syarikat dengan sebab.'),
        where: GUARD_PAY,
        decision: true,
      },
      {
        who: T('Finance', 'Kewangan'),
        does: T(
          'Pays with the bank reference and the PCB checked, and takes the bank file, e-wallet list and statutory files after COO approval.',
          'Membayar dengan rujukan bank dan PCB disemak, dan mengambil fail bank, senarai e-dompet dan fail berkanun selepas kelulusan COO.',
        ),
        where: GUARD_PAY,
      },
      {
        who: T('Guard or officer', 'Pengawal atau pegawai'),
        does: T('Sees their own payslips on Duty, for paid months.', 'Melihat slip gaji sendiri di Tugas, bagi bulan yang telah dibayar.'),
        where: at('mine', 'Duty', 'Tugas'),
      },
    ],
    rules: [
      T('Nobody approves a month they prepared or submitted.', 'Tiada sesiapa meluluskan bulan yang dia sediakan atau hantar.'),
      T('Pay is due by the 7th of the next month; later is recorded as late (Employment Act s.19).', 'Gaji perlu dibayar sebelum 7 hari bulan berikutnya; selepas itu direkod sebagai lewat (Akta Kerja s.19).'),
      T(
        'Equipment is never charged to the guard; uniform and item deductions wait for a management and legal decision.',
        'Peralatan tidak sekali-kali dicaj kepada pengawal; potongan uniform dan barang menunggu keputusan pengurusan dan undang-undang.',
      ),
      T(
        'All the employer’s deductions together stay within half the month’s wages (EPF, SOCSO and PCB are outside this cap).',
        'Semua potongan majikan bersama tidak melebihi separuh gaji bulan itu (KWSP, PERKESO dan PCB di luar had ini).',
      ),
      T(
        'A guard whose absence still waits for the OD or OGM decision is left out and paid in a later run; everyone else is paid on time.',
        'Pengawal yang ketidakhadirannya masih menunggu keputusan OD atau OGM dikecualikan dan dibayar dalam larian kemudian; yang lain dibayar tepat pada masanya.',
      ),
    ],
    status: 'trial',
    statusNote: T(
      'Prima takes over guard pay on 1 Aug 2027. Until then the JA Group app pays guards; each run here is a trial compared with JA, cannot be marked paid, and its bank file says not to upload it.',
      'Prima mengambil alih gaji pengawal pada 1 Ogos 2027. Sebelum itu aplikasi JA Group membayar pengawal; setiap larian di sini ialah percubaan yang dibandingkan dengan JA, tidak boleh ditanda dibayar, dan fail banknya menyatakan jangan dimuat naik.',
    ),
    source: { doc: 'docs/GUARD_PAY_RUN.md', decided: 'Fauzan, 5, 6, 8, 11 and 15 Nov 2026' },
    words: 'guard pay gaji pengawal payroll run larian officer pegawai payslip slip gaji coo bank ja',
  },
  {
    id: 'pay-guard-account',
    app: 'pay',
    title: T('Guard paid into another account, or in cash by exception', 'Gaji pengawal ke akaun orang lain, atau tunai secara pengecualian'),
    purpose: T(
      'Guards are paid by bank account or e-wallet only. Someone else’s account needs a sworn consent letter the COO approves; cash is an exception the CEO decides.',
      'Pengawal dibayar melalui akaun bank atau e-dompet sahaja. Akaun orang lain memerlukan surat persetujuan bersumpah yang diluluskan COO; tunai ialah pengecualian yang diputuskan CEO.',
    ),
    start: GUARD_PAY,
    starter: T('HR (account); Director Office (cash)', 'HR (akaun); Pejabat Pengarah (tunai)'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Records whose account it is: own, joint, an immediate relative’s or a close friend’s; bank or e-wallet.',
          'Merekod akaun siapa: sendiri, bersama, saudara terdekat atau kawan rapat; bank atau e-dompet.',
        ),
        where: GUARD_PAY,
      },
      {
        who: T('HR', 'HR'),
        does: T(
          'For someone else’s account, attaches the guard’s consent letter stamped by a Commissioner for Oaths (Pesuruhjaya Sumpah).',
          'Bagi akaun orang lain, melampirkan surat persetujuan pengawal yang dicop oleh Pesuruhjaya Sumpah.',
        ),
        where: GUARD_PAY,
      },
      {
        who: T('COO', 'COO'),
        does: T(
          'Approves the consent letter with a reason (no CEO stand-in; never the HR officer who recorded it). Until then the account cannot be paid into.',
          'Meluluskan surat persetujuan dengan sebab (tiada ganti oleh CEO; bukan pegawai HR yang merekodnya). Sebelum itu akaun tidak boleh dibayar.',
        ),
        where: GUARD_PAY,
        decision: true,
      },
      {
        who: T('Director Office', 'Pejabat Pengarah'),
        does: T('Lists a guard with no usable account for wage cash, with the exact net amount and a reason.', 'Menyenaraikan pengawal tanpa akaun yang boleh digunakan untuk gaji tunai, dengan jumlah bersih tepat dan sebab.'),
        where: GUARD_PAY,
      },
      {
        who: T('CEO', 'CEO'),
        does: T('Alone decides the wage cash, with a reason.', 'Seorang diri memutuskan gaji tunai, dengan sebab.'),
        where: GUARD_PAY,
        decision: true,
      },
      {
        who: T('CEO or COO, then Director Office', 'CEO atau COO, kemudian Pejabat Pengarah'),
        does: T(
          'The CEO or COO hands the cash over once the month is approved and records the date; the Director Office uploads the guard’s genuine signed receipt.',
          'CEO atau COO menyerahkan tunai setelah bulan itu diluluskan dan merekod tarikh; Pejabat Pengarah memuat naik resit asli bertandatangan pengawal.',
        ),
        where: GUARD_PAY,
      },
    ],
    rules: [
      T('Cash is an exception, never a normal way of paying wages.', 'Tunai ialah pengecualian, bukan cara biasa membayar gaji.'),
      T(
        'An e-wallet or third-party account stays a legal point for the CEO even with consent (Employment Act s.25).',
        'E-dompet atau akaun pihak ketiga kekal sebagai isu undang-undang untuk CEO walaupun dengan persetujuan (Akta Kerja s.25).',
      ),
      T('Cash is never handed out on a trial month.', 'Tunai tidak sekali-kali diserahkan bagi bulan percubaan.'),
    ],
    status: 'trial',
    statusNote: T('Part of the guard pay run, a trial until Prima pays guards on 1 Aug 2027.', 'Sebahagian larian gaji pengawal, percubaan sehingga Prima membayar pengawal pada 1 Ogos 2027.'),
    source: { doc: 'docs/GUARD_PAY_RUN.md', decided: 'Fauzan, 6 Nov 2026; 8 Nov 2026 (the CEO alone decides wage cash)' },
    words: 'account akaun consent persetujuan pesuruhjaya sumpah e-wallet e-dompet cash tunai third party pihak ketiga',
  },
  {
    id: 'pay-wage-advance',
    app: 'pay',
    title: T('Guard wage advance (the 20th)', 'Pendahuluan gaji pengawal (20 hari bulan)'),
    purpose: T(
      'The OM sets an advance for a guard or a site; the Operations Director or OGM approves; Finance pays; the month’s pay takes it back.',
      'OM menetapkan pendahuluan bagi pengawal atau tapak; Pengarah Operasi atau OGM meluluskan; Kewangan membayar; gaji bulan itu memotongnya semula.',
    ),
    start: at('advances', 'Wage advances', 'Pendahuluan gaji'),
    starter: T('OM or Regional OM', 'OM atau OM Wilayah'),
    steps: [
      {
        who: T('OM or Regional OM', 'OM atau OM Wilayah'),
        does: T(
          'Sets the amount and pay date (usually the 20th) for one guard, or in bulk for a site, zone or region; this month or next month only.',
          'Menetapkan jumlah dan tarikh bayar (biasanya 20 hari bulan) bagi seorang pengawal, atau secara pukal bagi tapak, zon atau wilayah; bulan ini atau bulan depan sahaja.',
        ),
        where: at('advances', 'Wage advances', 'Pendahuluan gaji'),
      },
      {
        who: T('Operations Director (private sites) or OGM (government sites)', 'Pengarah Operasi (tapak swasta) atau OGM (tapak kerajaan)'),
        does: T('Approves with a reason, one or many at once.', 'Meluluskan dengan sebab, satu atau banyak sekali gus.'),
        where: at('advances', 'Wage advances', 'Pendahuluan gaji'),
        decision: true,
      },
      {
        who: T('Finance', 'Kewangan'),
        does: T('Marks it paid with the bank reference, only once Prima pays guards.', 'Menandanya dibayar dengan rujukan bank, hanya setelah Prima membayar pengawal.'),
        where: at('advances', 'Wage advances', 'Pendahuluan gaji'),
      },
      {
        who: T('Guard pay run', 'Larian gaji pengawal'),
        does: T('Takes back only advances actually paid, after the statutory shares.', 'Memotong semula hanya pendahuluan yang benar-benar dibayar, selepas bahagian berkanun.'),
        where: GUARD_PAY,
      },
    ],
    rules: [
      T(
        'Refused: no usable account, a second advance in the same month, or more than last month’s wages (Employment Act s.22).',
        'Ditolak: tiada akaun yang boleh digunakan, pendahuluan kedua dalam bulan yang sama, atau lebih daripada gaji bulan lepas (Akta Kerja s.22).',
      ),
      T('Nobody approves an advance they set or changed; a change after approval needs one more approval.', 'Tiada sesiapa meluluskan pendahuluan yang dia tetapkan atau ubah; perubahan selepas kelulusan perlu satu lagi kelulusan.'),
    ],
    status: 'trial',
    statusNote: T(
      'The JA Group app still pays guards, so advances are not paid from Prima until 1 Aug 2027; the trial pay run still takes approved advances back so the figures can be compared.',
      'Aplikasi JA Group masih membayar pengawal, jadi pendahuluan tidak dibayar daripada Prima sehingga 1 Ogos 2027; larian gaji percubaan tetap memotong pendahuluan yang diluluskan supaya angka boleh dibandingkan.',
    ),
    source: { doc: 'docs/GUARD_PAY_RUN.md', decided: 'Fauzan, 6 Nov 2026' },
    words: 'advance pendahuluan gaji wage 20th 20 hari bulan om ogm operations director',
  },
  {
    id: 'pay-advance-loan',
    app: 'pay',
    title: T('Guard advance or loan scheme', 'Skim pendahuluan atau pinjaman pengawal'),
    purpose: T(
      'HR records an advance or loan with the worker’s signed agreement; the Chief of Staff and then the CEO approve; Finance pays and follows what is owed.',
      'HR merekod pendahuluan atau pinjaman dengan perjanjian bertandatangan pekerja; Ketua Staf kemudian CEO meluluskan; Kewangan membayar dan memantau baki hutang.',
    ),
    start: at('loans', 'Advances and loans', 'Pendahuluan dan pinjaman'),
    starter: T('HR', 'HR'),
    steps: [
      {
        who: T('HR', 'HR'),
        does: T(
          'Records the kind (advance or loan), limit, amount, purpose, repayment period (1 to 24 months), first repayment month and the worker’s signed agreement.',
          'Merekod jenis (pendahuluan atau pinjaman), had, jumlah, tujuan, tempoh bayaran balik (1 hingga 24 bulan), bulan bayaran pertama dan perjanjian bertandatangan pekerja.',
        ),
        where: at('loans', 'Advances and loans', 'Pendahuluan dan pinjaman'),
      },
      {
        who: T('Chief of Staff', 'Ketua Staf'),
        does: T('Approves with a reason.', 'Meluluskan dengan sebab.'),
        where: at('loans', 'Advances and loans', 'Pendahuluan dan pinjaman'),
        decision: true,
      },
      {
        who: T('CEO', 'CEO'),
        does: T('Approves with a reason.', 'Meluluskan dengan sebab.'),
        where: at('loans', 'Advances and loans', 'Pendahuluan dan pinjaman'),
        decision: true,
      },
      {
        who: T('Finance', 'Kewangan'),
        does: T(
          'Is told at each step, pays it into the guard’s own account with the bank reference, and watches what is still owed.',
          'Dimaklumkan pada setiap langkah, membayar ke akaun pengawal sendiri dengan rujukan bank, dan memantau baki yang masih terhutang.',
        ),
        where: at('loans', 'Advances and loans', 'Pendahuluan dan pinjaman'),
      },
      {
        who: T('Guard pay run', 'Larian gaji pengawal'),
        does: T('Takes the repayments only from these records; at zero the record is settled.', 'Memotong bayaran balik hanya daripada rekod ini; apabila sifar rekod diselesaikan.'),
        where: GUARD_PAY,
      },
    ],
    rules: [
      T('Nobody decides a record they made or already approved.', 'Tiada sesiapa memutuskan rekod yang dia buat atau telah luluskan.'),
      T(
        'All deductions together stay within half the month’s wages; what does not fit waits, and the balance stays on the record.',
        'Semua potongan bersama tidak melebihi separuh gaji bulan itu; yang tidak muat menunggu, dan baki kekal dalam rekod.',
      ),
      T(
        'Separate from the wage advance on the 20th, and from exceptional guard cash support (which is never a loan).',
        'Berasingan daripada pendahuluan gaji 20 hari bulan, dan daripada sokongan tunai luar biasa pengawal (yang tidak sekali-kali pinjaman).',
      ),
    ],
    status: 'trial',
    statusNote: T(
      'Records can be made and approved now; Finance pays them out from Prima only after 1 Aug 2027, because repayments come off Prima’s pay run.',
      'Rekod boleh dibuat dan diluluskan sekarang; Kewangan membayarnya daripada Prima hanya selepas 1 Ogos 2027, kerana bayaran balik dipotong daripada larian gaji Prima.',
    ),
    source: { doc: 'docs/GUARD_PAY_RUN.md', decided: 'Fauzan, 6 Nov 2026 (IWAY item 4); 11 Nov 2026 (cap)' },
    words: 'loan pinjaman advance pendahuluan scheme skim repayment bayaran balik cos ceo finance kewangan',
  },
  {
    id: 'pay-exceptional-cash',
    app: 'pay',
    title: T('Exceptional cash support for a guard', 'Sokongan tunai luar biasa untuk pengawal'),
    purpose: T(
      'Extra support for a named guard on a named day, asked by the OM and approved by the CEO outside Prima; the Director Office hands the list to Finance, who pays and accounts for it.',
      'Sokongan tambahan untuk pengawal yang dinamakan pada hari tertentu, dipohon OM dan diluluskan CEO di luar Prima; Pejabat Pengarah menyerahkan senarai kepada Kewangan, yang membayar dan merekodkannya.',
    ),
    start: at('doa', 'Director Office › Exceptional guard cash', 'Pejabat Pengarah › Tunai luar biasa pengawal'),
    starter: T('The OM asks, outside Prima', 'OM memohon, di luar Prima'),
    steps: [
      {
        who: T('OM', 'OM'),
        does: T('Asks for support for a named guard, outside Prima.', 'Memohon sokongan untuk pengawal yang dinamakan, di luar Prima.'),
        outside: true,
      },
      {
        who: T('CEO', 'CEO'),
        does: T(
          'Approves each named guard, exact amount and payment day, outside Prima, and sends the list to the Director Office.',
          'Meluluskan setiap pengawal yang dinamakan, jumlah tepat dan hari bayaran, di luar Prima, dan menghantar senarai kepada Pejabat Pengarah.',
        ),
        outside: true,
        decision: true,
      },
      {
        who: T('Director Office', 'Pejabat Pengarah'),
        does: T(
          'Downloads the read-only guard list, prepares the controlled Excel workbook, and submits the approved handover with the request and approval evidence.',
          'Memuat turun senarai pengawal baca sahaja, menyediakan buku kerja Excel terkawal, dan menghantar serahan yang diluluskan bersama bukti permohonan dan kelulusan.',
        ),
        where: at('doa', 'Director Office › Exceptional guard cash', 'Pejabat Pengarah › Tunai luar biasa pengawal'),
      },
      {
        who: T('Finance', 'Kewangan'),
        does: T(
          'Prepares the cash, then records the actual payment (never more than approved) with evidence.',
          'Menyediakan tunai, kemudian merekod bayaran sebenar (tidak melebihi yang diluluskan) dengan bukti.',
        ),
        where: at('finance', 'Finance', 'Kewangan'),
      },
      {
        who: T('Director Office', 'Pejabat Pengarah'),
        does: T('Uploads the guard’s signed receipt for that payment.', 'Memuat naik resit bertandatangan pengawal bagi bayaran itu.'),
        where: at('doa', 'Director Office › Exceptional guard cash', 'Pejabat Pengarah › Tunai luar biasa pengawal'),
      },
      {
        who: T('Finance (a different officer)', 'Kewangan (pegawai lain)'),
        does: T(
          'Counts any cash returned, reconciles it, and records the payroll journal against the named site.',
          'Mengira tunai yang dipulangkan, menyelaraskannya, dan merekod jurnal gaji terhadap tapak yang dinamakan.',
        ),
        where: at('finance', 'Finance', 'Kewangan'),
      },
    ],
    rules: [
      T(
        'It is additional pay: ordinary wages are paid in full, and it is never a loan or a deduction.',
        'Ia ialah bayaran tambahan: gaji biasa dibayar penuh, dan ia tidak sekali-kali pinjaman atau potongan.',
      ),
      T('Approval is not a payout; a stored signature is never proof of payment.', 'Kelulusan bukan bayaran; tandatangan yang disimpan tidak sekali-kali bukti bayaran.'),
      T('Budgeted under Miscellaneous payroll expenses.', 'Dibajetkan di bawah Perbelanjaan gaji pelbagai.'),
    ],
    status: 'draft',
    statusNote: T(
      'Finance and a legal adviser review the cash treatment before real cash is used.',
      'Kewangan dan penasihat undang-undang menyemak layanan tunai ini sebelum tunai sebenar digunakan.',
    ),
    source: { doc: 'docs/MANUAL_GUARD_CASH_SPEC.md', decided: 'Fauzan, 8 Nov 2026' },
    words: 'exceptional cash tunai luar biasa guard pengawal support sokongan doa director office pejabat pengarah excel',
  },
];

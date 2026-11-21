import type { Sop } from '../types';

/**
 * P121: Operations and Security. Filled from Fauzan's documents (docs/*.md: system/04-workflows.md W1-W4, W17-W19,
 * GUARD_ROSTER_ENGINE, CLEANING_AND_DUTY_PLANNER, SITE_DEVICE_DUTY, SITE_SURVEY_OFFLINE, PAY_FORMULAS, CMS_*,
 * SPECIAL_OPS_PHASE4, ARMS_POLICY_PART_V, GUARD_PHONE, COMPANY_TOOLBOX_MEETING) and the rule register.
 */
export const SOPS_OPS: Sop[] = [
  // ---------------------------------------------------------------- Operations: guards and duty
  {
    id: 'ops-roster-week',
    app: 'ops',
    title: { en: 'Weekly roster: build and publish', ms: 'Roster mingguan: sedia dan terbitkan' },
    purpose: {
      en: 'The company plans who works which post and shift for the week, checks the warnings, and publishes it so guards can clock in.',
      ms: 'Syarikat merancang siapa bertugas di pos dan syif mana bagi minggu itu, menyemak amaran, dan menerbitkannya supaya pengawal boleh daftar masuk.',
    },
    start: { view: 'roster', label: { en: 'Open the roster', ms: 'Buka roster' } },
    starter: { en: 'Admin executive, site supervisor or company manager', ms: 'Eksekutif admin, penyelia tapak atau pengurus syarikat' },
    steps: [
      {
        who: { en: 'Admin executive or supervisor', ms: 'Eksekutif admin atau penyelia' },
        does: {
          en: 'Picks the site and week, adds the shifts for each post (they start unfilled, as a draft), then places a guard on each shift.',
          ms: 'Pilih tapak dan minggu, tambah syif bagi setiap pos (bermula kosong, sebagai draf), kemudian letakkan pengawal pada setiap syif.',
        },
        where: { view: 'roster', label: { en: 'Roster › Add shifts', ms: 'Roster › Tambah syif' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Warns on more than 12 hours a day, no rest day in 7, empty shifts, work restrictions, and guards not allowed to work (expired KDN card, over 60, foreign guard at a government site).',
          ms: 'Memberi amaran jika lebih 12 jam sehari, tiada hari rehat dalam 7 hari, syif kosong, sekatan kerja, dan pengawal yang tidak dibenarkan bekerja (kad KDN tamat, umur lebih 60, pengawal asing di tapak kerajaan).',
        },
      },
      {
        who: { en: 'Company manager or site supervisor', ms: 'Pengurus syarikat atau penyelia tapak' },
        does: { en: 'Presses Publish this week. Admin executives edit but do not publish.', ms: 'Tekan Terbitkan minggu ini. Eksekutif admin boleh ubah tetapi tidak menerbitkan.' },
        where: { view: 'roster', label: { en: 'Roster › Publish this week', ms: 'Roster › Terbitkan minggu ini' } },
        decision: true,
      },
      {
        who: { en: 'Regional OM', ms: 'OM Wilayah' },
        does: {
          en: 'Watches shifts with no guard for the next 7 days across the region and chases the company; the company fills them.',
          ms: 'Memantau syif tanpa pengawal bagi 7 hari akan datang di seluruh wilayah dan mendesak syarikat; syarikat yang mengisinya.',
        },
        where: { view: 'ops', label: { en: 'Regional ops', ms: 'Operasi wilayah' } },
      },
    ],
    rules: [
      { en: 'Not more than 12 hours a day including overtime (Employment Act s.60A) and one rest day each week (s.59).', ms: 'Tidak lebih 12 jam sehari termasuk kerja lebih masa (Akta Kerja s.60A) dan satu hari rehat setiap minggu (s.59).' },
      { en: 'At least 8 hours of rest between shifts.', ms: 'Sekurang-kurangnya 8 jam rehat antara syif.' },
      { en: 'PWVSB operations edit a company roster only with an act grant; each company decides its own rosters.', ms: 'Operasi PWVSB hanya mengubah roster syarikat dengan kebenaran bertindak; setiap syarikat memutuskan roster sendiri.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W1; rules OPS-HOURS-MAX, OPS-REST-DAY, OPS-REST-MIN (Fauzan, 11 Nov 2026)' },
    words: 'roster jadual shift syif publish terbit week minggu guard pengawal post pos schedule',
  },
  {
    id: 'ops-guard-shift',
    app: 'ops',
    title: { en: "A guard's shift: clock in, patrol, clock out", ms: 'Syif pengawal: daftar masuk, rondaan, daftar keluar' },
    purpose: {
      en: 'How a rostered guard starts the shift by face on the site device, taps every patrol checkpoint, and ends it; then the company locks attendance.',
      ms: 'Cara pengawal yang dirosterkan memulakan syif dengan muka di peranti tapak, menyentuh setiap titik rondaan, dan menamatkannya; kemudian syarikat mengunci kehadiran.',
    },
    start: { view: 'device', label: { en: 'Site device › Clock in', ms: 'Peranti tapak › Daftar masuk' } },
    starter: { en: 'The rostered guard, at the post', ms: 'Pengawal yang dirosterkan, di pos' },
    steps: [
      {
        who: { en: 'Guard', ms: 'Pengawal' },
        does: {
          en: 'Clocks in on the shared site device with staff number and face, from 60 minutes before the shift.',
          ms: 'Daftar masuk di peranti tapak bersama dengan nombor staf dan muka, mulai 60 minit sebelum syif.',
        },
        where: { view: 'device', label: { en: 'Site device › Clock in', ms: 'Peranti tapak › Daftar masuk' } },
      },
      {
        who: { en: 'Guard', ms: 'Pengawal' },
        does: {
          en: 'During the shift taps each NFC checkpoint with staff number and PIN. A checkpoint not tapped within the site’s patrol time is flagged.',
          ms: 'Semasa syif, sentuh setiap titik semak NFC dengan nombor staf dan PIN. Titik semak yang tidak disentuh dalam masa rondaan tapak akan ditanda.',
        },
        where: { view: 'device', label: { en: 'Site device › Patrol checkpoint', ms: 'Peranti tapak › Titik rondaan' } },
      },
      {
        who: { en: 'Guard', ms: 'Pengawal' },
        does: { en: 'Clocks out by face at the end of the shift.', ms: 'Daftar keluar dengan muka pada akhir syif.' },
        where: { view: 'device', label: { en: 'Site device › Clock out', ms: 'Peranti tapak › Daftar keluar' } },
      },
      {
        who: { en: 'Site supervisor or company manager', ms: 'Penyelia tapak atau pengurus syarikat' },
        does: { en: 'Checks each day on Attendance and locks it.', ms: 'Menyemak setiap hari di Kehadiran dan menguncinya.' },
        where: { view: 'attendance', label: { en: 'Attendance', ms: 'Kehadiran' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A failed face check is recorded and opens a P3 identity case; the guard is never turned away.', ms: 'Semakan muka yang gagal direkod dan membuka kes identiti P3; pengawal tidak sekali-kali ditolak.' },
      { en: 'Late after 10 minutes; leaving more than 10 minutes early is early leave.', ms: 'Lewat selepas 10 minit; keluar lebih 10 minit awal dikira balik awal.' },
      { en: 'Patrols are every 2 hours unless the Regional OM set the client’s own time for the site.', ms: 'Rondaan setiap 2 jam kecuali OM Wilayah menetapkan masa pelanggan sendiri untuk tapak.' },
      { en: 'Records that reach the server 5 minutes or more late are marked offline sync.', ms: 'Rekod yang sampai ke pelayan 5 minit atau lebih lewat ditanda sebagai segerak luar talian.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W1; rules OPS-CLOCK-WINDOW, OPS-LATE-GRACE (Fauzan, 11 Nov 2026), OPS-PATROL-GAP' },
    words: 'clock in daftar masuk clock out daftar keluar face muka nfc patrol rondaan checkpoint titik semak attendance kehadiran site device peranti',
  },
  {
    id: 'ops-guard-leave',
    app: 'ops',
    title: { en: 'Leave or an absence reason for a guard or officer', ms: 'Cuti atau sebab tidak hadir bagi pengawal atau pegawai' },
    purpose: {
      en: 'A guard or officer asks for leave or gives an absence reason (with the MC); the OM or higher decides.',
      ms: 'Pengawal atau pegawai memohon cuti atau memberi sebab tidak hadir (bersama MC); OM atau lebih tinggi memutuskan.',
    },
    start: { view: 'device', label: { en: 'Site device › Leave or absence reason', ms: 'Peranti tapak › Cuti atau sebab tidak hadir' } },
    starter: { en: 'The guard on the site device, or company staff for them', ms: 'Pengawal di peranti tapak, atau kakitangan syarikat bagi pihaknya' },
    steps: [
      {
        who: { en: 'Guard', ms: 'Pengawal' },
        does: { en: 'Asks on the site device with staff number and face, attaching the MC where there is one.', ms: 'Memohon di peranti tapak dengan nombor staf dan muka, melampirkan MC jika ada.' },
        where: { view: 'device', label: { en: 'Site device › Leave or absence reason', ms: 'Peranti tapak › Cuti atau sebab tidak hadir' } },
      },
      {
        who: { en: 'Company office (instead of the guard)', ms: 'Pejabat syarikat (bagi pihak pengawal)' },
        does: { en: 'Opens the guard’s profile, tab Leave, and presses “Ask for leave for this person”.', ms: 'Buka profil pengawal, tab Cuti, dan tekan “Ask for leave for this person”.' },
        where: { view: 'people', label: { en: 'Guards › person › Leave', ms: 'Pengawal › orang › Cuti' } },
      },
      {
        who: { en: 'OM or higher', ms: 'OM atau lebih tinggi' },
        does: { en: 'Approves or rejects with a reason.', ms: 'Meluluskan atau menolak dengan sebab.' },
        where: { view: 'ops', label: { en: 'Regional ops › Leave and absence requests', ms: 'Operasi wilayah › Permohonan cuti dan tidak hadir' } },
        decision: true,
      },
      {
        who: { en: 'Company office', ms: 'Pejabat syarikat' },
        does: {
          en: 'A refused request can be corrected and sent again as a new request (“Correct and send again”); the refused one stays on record.',
          ms: 'Permohonan yang ditolak boleh dibetulkan dan dihantar semula sebagai permohonan baharu (“Correct and send again”); yang ditolak kekal dalam rekod.',
        },
        where: { view: 'people', label: { en: 'Guards › person › Leave', ms: 'Pengawal › orang › Cuti' } },
      },
    ],
    rules: [
      { en: 'Not answered in 12 hours: the request moves up a level.', ms: 'Tidak dijawab dalam 12 jam: permohonan naik satu peringkat.' },
      { en: 'Nobody decides their own request.', ms: 'Tiada sesiapa memutuskan permohonan sendiri.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W4' },
    words: 'leave cuti mc sakit absence tidak hadir sebab reason guard pengawal officer pegawai',
  },
  {
    id: 'ops-guard-roster-month',
    app: 'ops',
    title: { en: 'Month roster (engine): coverage, prepare, verify, publish', ms: 'Roster bulanan (enjin): liputan, sedia, sahkan, terbit' },
    purpose: {
      en: 'The month’s roster per site with day codes, client limits and break plans, checked by the engine and passed up a chain before the pay run reads it.',
      ms: 'Roster bulanan bagi setiap tapak dengan kod hari, had pelanggan dan pelan rehat, disemak oleh enjin dan dihantar mengikut rantaian sebelum dibaca oleh larian gaji.',
    },
    start: { view: 'guardroster', tab: 'coverage', label: { en: 'Coverage and breaks', ms: 'Liputan dan rehat' } },
    starter: { en: 'Operations Director (private) or OGM (government) sets coverage; the OM prepares the month', ms: 'Pengarah Operasi (swasta) atau OGM (kerajaan) menetapkan liputan; OM menyediakan bulan' },
    steps: [
      {
        who: { en: 'Operations Director or OGM', ms: 'Pengarah Operasi atau OGM' },
        does: {
          en: 'Enters the contract coverage from a date (posts per shift, client limits, break plan, the client’s break permission, the Area/Zone Supervisor) with the contract document and a reason.',
          ms: 'Memasukkan liputan kontrak dari satu tarikh (pos setiap syif, had pelanggan, pelan rehat, kebenaran rehat pelanggan, Penyelia Kawasan/Zon) bersama dokumen kontrak dan sebab.',
        },
        where: { view: 'guardroster', tab: 'coverage', label: { en: 'Guard roster › Coverage and breaks', ms: 'Roster pengawal › Liputan dan rehat' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Prepares the month (the auto-roster suggestion may help; it saves nothing), saves a draft and submits it with a reason.',
          ms: 'Menyediakan bulan itu (cadangan auto-roster boleh membantu; ia tidak menyimpan apa-apa), simpan draf dan hantar dengan sebab.',
        },
        where: { view: 'guardroster', tab: 'grid', label: { en: 'Guard roster › Month', ms: 'Roster pengawal › Bulan' } },
      },
      {
        who: { en: 'Area/Zone Supervisor (where the site has one)', ms: 'Penyelia Kawasan/Zon (jika tapak ada)' },
        does: { en: 'Verifies or returns, with a reason.', ms: 'Mengesahkan atau memulangkan, dengan sebab.' },
        where: { view: 'guardroster', tab: 'grid', label: { en: 'Guard roster › Next step', ms: 'Roster pengawal › Langkah seterusnya' } },
        decision: true,
      },
      {
        who: { en: 'Operations Director (private) or OGM (government)', ms: 'Pengarah Operasi (swasta) atau OGM (kerajaan)' },
        does: {
          en: 'Publishes or returns, with a reason. Client limits and uncovered posts block publishing; law points are red or amber flags to follow up.',
          ms: 'Menerbitkan atau memulangkan, dengan sebab. Had pelanggan dan pos tanpa liputan menyekat penerbitan; perkara undang-undang ialah bendera merah atau kuning untuk disusuli.',
        },
        where: { view: 'guardroster', tab: 'grid', label: { en: 'Guard roster › Next step', ms: 'Roster pengawal › Langkah seterusnya' } },
        decision: true,
      },
      {
        who: { en: 'OM or site supervisor (never the guard)', ms: 'OM atau penyelia tapak (bukan pengawal)' },
        does: {
          en: 'Records each actual day once, and records and confirms breaks. A correction is proposed by the OM with evidence; the OD/OGM (a different person) decides.',
          ms: 'Merekod hari sebenar sekali sahaja, serta merekod dan mengesahkan rehat. Pembetulan dicadangkan oleh OM dengan bukti; OD/OGM (orang lain) memutuskan.',
        },
        where: { view: 'guardroster', tab: 'grid', label: { en: 'Guard roster › Month › a day', ms: 'Roster pengawal › Bulan › satu hari' } },
      },
      {
        who: { en: 'OD/OGM, then ACT', ms: 'OD/OGM, kemudian ACT' },
        does: {
          en: 'Records the permit or permission a schedule needs (never edited; no waiver without the document); ACT checks each record once with a note.',
          ms: 'Merekod permit atau kebenaran yang diperlukan oleh jadual (tidak diubah; tiada pengecualian tanpa dokumen); ACT menyemak setiap rekod sekali dengan catatan.',
        },
        where: { view: 'guardroster', tab: 'evidence', label: { en: 'Guard roster › Permits and evidence', ms: 'Roster pengawal › Permit dan bukti' } },
      },
    ],
    rules: [
      { en: 'A reason at every step; nobody approves their own roster.', ms: 'Sebab pada setiap langkah; tiada sesiapa meluluskan roster sendiri.' },
      { en: 'A change after publishing is a new version with a reason.', ms: 'Perubahan selepas diterbitkan ialah versi baharu dengan sebab.' },
      { en: 'OFF is never absence. An absence is decided paid or unpaid once, by the OD/OGM, not by the person who recorded it.', ms: 'OFF tidak sekali-kali dikira tidak hadir. Ketidakhadiran diputuskan berbayar atau tidak sekali sahaja oleh OD/OGM, bukan oleh orang yang merekodnya.' },
      { en: 'Client permission never clears a law flag.', ms: 'Kebenaran pelanggan tidak sekali-kali menghapuskan bendera undang-undang.' },
    ],
    status: 'trial',
    statusNote: {
      en: 'Guard pay stays a trial until 1 Aug 2027; the roster and pay pack v3 is a draft for HR/Legal sign-off. Sabah and Sarawak rules are not built.',
      ms: 'Gaji pengawal kekal percubaan hingga 1 Ogos 2027; pek roster dan gaji v3 ialah draf menunggu kelulusan HR/Undang-undang. Peraturan Sabah dan Sarawak belum dibina.',
    },
    source: { doc: 'docs/GUARD_ROSTER_ENGINE.md', decided: 'Fauzan, 13-14 Nov 2026 (Part O, PO-1 to PO-7)' },
    words: 'roster engine enjin month bulan coverage liputan break rehat publish terbit verify sahkan od ogm area zone supervisor',
  },
  {
    id: 'ops-guard-allowance',
    app: 'ops',
    title: { en: 'Guard allowance and agreed lump-sum pay', ms: 'Elaun pengawal dan gaji pukal yang dipersetujui' },
    purpose: {
      en: 'An allowance (armed, transport, night, supervisor, remote, custom) or an agreed monthly lump sum for a guard, each passed through three different people.',
      ms: 'Elaun (bersenjata, pengangkutan, malam, penyelia, kawasan pedalaman, lain-lain) atau gaji pukal bulanan yang dipersetujui bagi pengawal, setiap satunya melalui tiga orang yang berbeza.',
    },
    start: { view: 'guardroster', tab: 'pay', label: { en: 'Allowances and lump sum', ms: 'Elaun dan gaji pukal' } },
    starter: { en: 'Operations (from an approval); a lump sum is proposed by the OD/OGM', ms: 'Operasi (berdasarkan kelulusan); gaji pukal dicadangkan oleh OD/OGM' },
    steps: [
      {
        who: { en: 'Operations (OM, OD or OGM)', ms: 'Operasi (OM, OD atau OGM)' },
        does: { en: 'Proposes the allowance with the guard, type, amount from the approval, date and the approval it comes from.', ms: 'Mencadangkan elaun dengan nama pengawal, jenis, amaun daripada kelulusan, tarikh dan kelulusan asalnya.' },
        where: { view: 'guardroster', tab: 'pay', label: { en: 'Guard roster › Allowances and lump sum', ms: 'Roster pengawal › Elaun dan gaji pukal' } },
      },
      {
        who: { en: 'HR Director', ms: 'Pengarah HR' },
        does: { en: 'Verifies or refuses.', ms: 'Mengesahkan atau menolak.' },
        where: { view: 'guardroster', tab: 'pay', label: { en: 'Guard roster › Allowances and lump sum', ms: 'Roster pengawal › Elaun dan gaji pukal' } },
        decision: true,
      },
      {
        who: { en: 'COO', ms: 'COO' },
        does: { en: 'Approves or refuses. Nothing is paid before both.', ms: 'Meluluskan atau menolak. Tiada bayaran sebelum kedua-duanya.' },
        where: { view: 'guardroster', tab: 'pay', label: { en: 'Guard roster › Allowances and lump sum', ms: 'Roster pengawal › Elaun dan gaji pukal' } },
        decision: true,
      },
      {
        who: { en: 'Lump sum: OD/OGM, COO, the guard, CEO', ms: 'Gaji pukal: OD/OGM, COO, pengawal, CEO' },
        does: {
          en: 'The OD/OGM proposes, the COO approves, the named guard signs or refuses in the app (and may withdraw). It counts only after the CEO switches lump-sum pay on at that site.',
          ms: 'OD/OGM mencadangkan, COO meluluskan, pengawal yang dinamakan menandatangan atau menolak dalam aplikasi (dan boleh menarik balik). Ia hanya dikira selepas CEO menghidupkan gaji pukal di tapak itu.',
        },
        where: { view: 'guardroster', tab: 'pay', label: { en: 'Guard roster › Allowances and lump sum', ms: 'Roster pengawal › Elaun dan gaji pukal' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Three different people: who proposes does not verify or approve.', ms: 'Tiga orang berbeza: yang mencadang tidak mengesahkan atau meluluskan.' },
      { en: 'Armed allowance only with arms authorisation in force; no transport allowance on company-transport days.', ms: 'Elaun bersenjata hanya dengan kebenaran senjata yang berkuat kuasa; tiada elaun pengangkutan pada hari pengangkutan syarikat.' },
      { en: 'A lump sum never lowers what the law and the formula make due; the guard’s consent is their own, never reused or backdated.', ms: 'Gaji pukal tidak sekali-kali mengurangkan apa yang wajib dibayar oleh undang-undang dan formula; persetujuan pengawal adalah miliknya sendiri, tidak diguna semula atau diundurkan tarikh.' },
    ],
    status: 'trial',
    statusNote: {
      en: 'Guard pay is a trial until 1 Aug 2027. Lump-sum pay is off at every site until the CEO switches it on.',
      ms: 'Gaji pengawal dalam percubaan hingga 1 Ogos 2027. Gaji pukal ditutup di setiap tapak sehingga CEO menghidupkannya.',
    },
    source: { doc: 'docs/GUARD_ROSTER_ENGINE.md', decided: 'Fauzan, 14 Nov 2026 (Part O O9, v3 lump sum)' },
    words: 'allowance elaun armed bersenjata transport night malam lump sum gaji pukal hr director coo',
  },
  {
    id: 'ops-site-hours',
    app: 'ops',
    title: { en: 'Site man-hours over the allowed total', ms: 'Jam kerja tapak melebihi jumlah dibenarkan' },
    purpose: {
      en: 'Each site may use up to its total man-hours a month. Any site over it is flagged, and extra hours are approved with a reason before salary.',
      ms: 'Setiap tapak boleh menggunakan sehingga jumlah jam kerjanya sebulan. Tapak yang melebihi ditanda, dan jam tambahan diluluskan dengan sebab sebelum gaji.',
    },
    start: { view: 'sitehours', tab: 'hours', label: { en: 'Site man-hours', ms: 'Jam kerja tapak' } },
    starter: { en: 'Prima flags; the OD (private) or OGM (government) approves', ms: 'Prima menanda; OD (swasta) atau OGM (kerajaan) meluluskan' },
    steps: [
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Counts allowed hours (guards per shift × hours covered a day × days in the month, for every post) against rostered and worked hours, and flags over, roster over or heading over.',
          ms: 'Mengira jam dibenarkan (pengawal setiap syif × jam diliputi sehari × hari dalam bulan, bagi setiap pos) berbanding jam dirosterkan dan jam bekerja, dan menanda lebih, roster lebih atau menuju lebih.',
        },
        where: { view: 'sitehours', tab: 'hours', label: { en: 'Site man-hours › Sites to look at', ms: 'Jam kerja tapak › Tapak untuk disemak' } },
      },
      {
        who: { en: 'OM and company office', ms: 'OM dan pejabat syarikat' },
        does: { en: 'Find out why (training, annual leave, on-the-job training, client asked for more) and tell the approver.', ms: 'Cari sebabnya (latihan, cuti tahunan, latihan semasa kerja, pelanggan minta lebih) dan maklumkan pelulus.' },
        outside: true,
      },
      {
        who: { en: 'Operations Director (private site) or OGM (government site)', ms: 'Pengarah Operasi (tapak swasta) atau OGM (tapak kerajaan)' },
        does: { en: 'Approves extra hours for that site and month with a cause and a reason.', ms: 'Meluluskan jam tambahan bagi tapak dan bulan itu dengan punca dan sebab.' },
        where: { view: 'sitehours', tab: 'hours', label: { en: 'Site man-hours › Approve extra hours', ms: 'Jam kerja tapak › Luluskan jam tambahan' } },
        decision: true,
      },
      {
        who: { en: 'Guard pay preparer', ms: 'Penyedia gaji pengawal' },
        does: { en: 'Sites over without approval are flagged on the pay run and each guard’s line; wages are not held.', ms: 'Tapak yang lebih tanpa kelulusan ditanda pada larian gaji dan baris setiap pengawal; gaji tidak ditahan.' },
        where: { view: 'guardpay', label: { en: 'Guard pay', ms: 'Gaji pengawal' } },
      },
    ],
    rules: [
      { en: 'Example: 2 guards on 12-hour shifts round the clock for 30 days = 4 people and 1,440 hours.', ms: 'Contoh: 2 pengawal syif 12 jam sepanjang hari selama 30 hari = 4 orang dan 1,440 jam.' },
      { en: 'Only the OD or OGM approves (not the COO or CEO); approvals add up, are add-only and audited.', ms: 'Hanya OD atau OGM meluluskan (bukan COO atau CEO); kelulusan bertambah, hanya boleh ditambah dan diaudit.' },
      { en: 'Worked hours count clock-in to clock-out inside the rostered shift; a night shift counts in the month it starts.', ms: 'Jam bekerja dikira dari daftar masuk ke daftar keluar dalam syif yang dirosterkan; syif malam dikira dalam bulan ia bermula.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/PAY_FORMULAS.md', decided: 'Fauzan, 6 Nov 2026 (rule SITE-HOURS)' },
    words: 'man-hours jam kerja manhours site hours over lebih approval kelulusan od ogm training latihan',
  },
  {
    id: 'ops-public-holidays',
    app: 'ops',
    title: { en: "Guards' 11 public holidays for the year", ms: '11 cuti umum pengawal bagi tahun itu' },
    purpose: {
      en: 'The OD or OGM sets each company’s 11 paid public holidays for the next year by 10 December; the guard pay run reads them.',
      ms: 'OD atau OGM menetapkan 11 cuti umum berbayar setiap syarikat bagi tahun hadapan sebelum 10 Disember; larian gaji pengawal membacanya.',
    },
    start: { view: 'sitehours', tab: 'holidays', label: { en: 'Set the 11 public holidays', ms: 'Tetapkan 11 cuti umum' } },
    starter: { en: 'Operations Director or OGM (not the OM)', ms: 'Pengarah Operasi atau OGM (bukan OM)' },
    steps: [
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'From 1 December reminds the OD and OGM on their operations board; after 10 December the CEO’s home flags lists still missing.', ms: 'Mulai 1 Disember mengingatkan OD dan OGM di papan operasi; selepas 10 Disember laman utama CEO menanda senarai yang masih tiada.' },
        where: { view: 'ops', label: { en: 'Regional ops', ms: 'Operasi wilayah' } },
      },
      {
        who: { en: 'Operations Director or OGM', ms: 'Pengarah Operasi atau OGM' },
        does: {
          en: 'Sets 11 dated, named days for the whole company, and a separate list for a state whose holidays differ, with a reason.',
          ms: 'Menetapkan 11 hari bertarikh dan bernama bagi seluruh syarikat, dan senarai berasingan bagi negeri yang cutinya berbeza, dengan sebab.',
        },
        where: { view: 'sitehours', tab: 'holidays', label: { en: 'Site man-hours › Public holidays', ms: 'Jam kerja tapak › Cuti umum' } },
        decision: true,
      },
      {
        who: { en: 'Guard pay', ms: 'Gaji pengawal' },
        does: { en: 'Reads the state list of the guard’s main site, else the whole-company list.', ms: 'Membaca senarai negeri bagi tapak utama pengawal, jika tiada senarai seluruh syarikat.' },
        where: { view: 'guardpay', label: { en: 'Guard pay', ms: 'Gaji pengawal' } },
      },
    ],
    rules: [
      { en: 'Fewer than 11 days is refused; a missing compulsory day (National Day, the Agong’s birthday, the Ruler’s birthday or FT Day, Labour Day, Malaysia Day) is flagged.', ms: 'Kurang daripada 11 hari ditolak; hari wajib yang tiada (Hari Kebangsaan, Hari Keputeraan Agong, Hari Keputeraan Raja atau Hari Wilayah, Hari Pekerja, Hari Malaysia) ditanda.' },
      { en: 'A guard not working on a holiday is still paid one normal day; working it pays 2 extra days plus overtime at 3×.', ms: 'Pengawal yang tidak bekerja pada hari cuti tetap dibayar satu hari biasa; bekerja pada hari itu dibayar 2 hari tambahan serta lebih masa 3×.' },
      { en: 'Each save keeps the reason and makes a new version.', ms: 'Setiap simpanan menyimpan sebab dan menjadi versi baharu.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/PAY_FORMULAS.md', decided: 'Fauzan, 6 Nov 2026 (rule PAY-PUBLIC-HOLIDAYS, Employment Act s.60D)' },
    words: 'public holiday cuti umum cuti am 10 december disember od ogm state negeri',
  },
  // ---------------------------------------------------------------- Operations: sites
  {
    id: 'ops-site-survey',
    app: 'ops',
    title: { en: 'Site survey, even with no signal', ms: 'Tinjauan tapak, walaupun tanpa liputan' },
    purpose: {
      en: 'Survey a new or existing site on the phone with photos and measurements; it is sent when there is a signal and the Project Director accepts or returns it.',
      ms: 'Tinjau tapak baharu atau sedia ada di telefon dengan gambar dan ukuran; ia dihantar apabila ada liputan dan Pengarah Projek menerima atau memulangkannya.',
    },
    start: { view: 'surveys', tab: 'phone', label: { en: 'New site survey', ms: 'Tinjauan tapak baharu' } },
    starter: { en: 'Company manager, admin executive, site officer, or PWVSB operations with a grant', ms: 'Pengurus syarikat, eksekutif admin, pegawai tapak, atau operasi PWVSB dengan kebenaran' },
    steps: [
      {
        who: { en: 'Surveyor', ms: 'Peninjau' },
        does: {
          en: 'Taps New site survey, picks a sales lead, one of our sites or a new place, and records GPS (works with no signal).',
          ms: 'Tekan Tinjauan tapak baharu, pilih prospek jualan, salah satu tapak kita atau tempat baharu, dan rekod GPS (berfungsi tanpa liputan).',
        },
        where: { view: 'surveys', tab: 'phone', label: { en: 'Site survey › New site survey', ms: 'Tinjauan tapak › Tinjauan tapak baharu' } },
      },
      {
        who: { en: 'Surveyor', ms: 'Peninjau' },
        does: {
          en: 'Fills in details and measurements, ticks risks, adds guard posts, takes stamped photos with the in-app camera, writes findings, then Finish and send.',
          ms: 'Isi butiran dan ukuran, tanda risiko, tambah pos pengawal, ambil gambar bercop dengan kamera dalam aplikasi, tulis dapatan, kemudian Selesai dan hantar.',
        },
        where: { view: 'surveys', tab: 'phone', label: { en: 'Site survey › On this phone', ms: 'Tinjauan tapak › Di telefon ini' } },
      },
      {
        who: { en: 'Phone', ms: 'Telefon' },
        does: { en: 'With no signal the survey waits, locked on the phone, and is sent by itself when there is one (or press Send now).', ms: 'Tanpa liputan, tinjauan menunggu, dikunci di telefon, dan dihantar sendiri apabila ada liputan (atau tekan Hantar sekarang).' },
      },
      {
        who: { en: 'Project Director (COO, OGM or Operations Director, with a grant)', ms: 'Pengarah Projek (COO, OGM atau Pengarah Operasi, dengan kebenaran)' },
        does: {
          en: 'Accepts or returns it, always with a reason. Accepting one linked to a researched sales lead fills that lead’s survey step.',
          ms: 'Menerima atau memulangkan, sentiasa dengan sebab. Menerima tinjauan yang dipautkan kepada prospek jualan yang telah dikaji mengisi langkah tinjauan prospek itu.',
        },
        where: { view: 'surveys', tab: 'decide', label: { en: 'Site survey › To decide', ms: 'Tinjauan tapak › Untuk diputuskan' } },
        decision: true,
      },
      {
        who: { en: 'Surveyor', ms: 'Peninjau' },
        does: { en: 'A returned survey can be redone once by the person who made it: the answers are copied and new photos are taken.', ms: 'Tinjauan yang dipulangkan boleh dibuat semula sekali oleh orang yang membuatnya: jawapan disalin dan gambar baharu diambil.' },
        where: { view: 'surveys', tab: 'sent', label: { en: 'Site survey › Sent surveys', ms: 'Tinjauan tapak › Tinjauan dihantar' } },
      },
    ],
    rules: [
      { en: 'Nobody decides their own survey.', ms: 'Tiada sesiapa memutuskan tinjauan sendiri.' },
      { en: 'Where photography is not allowed (a protected place or a client rule) it may go with no photos, only with a written reason.', ms: 'Jika fotografi tidak dibenarkan (tempat larangan atau peraturan pelanggan) ia boleh dihantar tanpa gambar, hanya dengan sebab bertulis.' },
      { en: 'A survey reaches the Project Director only when every photo has arrived; the same picture cannot be used in two surveys.', ms: 'Tinjauan hanya sampai kepada Pengarah Projek apabila semua gambar telah tiba; gambar yang sama tidak boleh digunakan dalam dua tinjauan.' },
      { en: 'Staff phones still need a screen lock.', ms: 'Telefon kakitangan tetap perlu kunci skrin.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SITE_SURVEY_OFFLINE.md', decided: 'Fauzan, 4-5 Nov 2026' },
    words: 'survey tinjauan site visit lawatan tapak offline luar talian photo gambar measurement ukuran project director',
  },
  {
    id: 'ops-site-visit',
    app: 'ops',
    title: { en: 'Site visit and patrol time', ms: 'Lawatan tapak dan masa rondaan' },
    purpose: {
      en: 'Record a visit to a site by GPS with stamped photos and findings; the Regional OM sets the site’s patrol time to the client’s request.',
      ms: 'Rekod lawatan ke tapak melalui GPS dengan gambar bercop dan dapatan; OM Wilayah menetapkan masa rondaan tapak mengikut permintaan pelanggan.',
    },
    start: { view: 'sites', label: { en: 'Sites › a site › Start site visit', ms: 'Tapak › satu tapak › Mula lawatan tapak' } },
    starter: { en: 'Company manager, site supervisor, or operations (OM and above)', ms: 'Pengurus syarikat, penyelia tapak, atau operasi (OM ke atas)' },
    steps: [
      {
        who: { en: 'Visitor', ms: 'Pelawat' },
        does: { en: 'Opens the site, writes why they are visiting and presses Start site visit: Prima checks in the GPS with the server’s time.', ms: 'Buka tapak, tulis tujuan lawatan dan tekan Mula lawatan tapak: Prima merekod GPS dengan masa pelayan.' },
        where: { view: 'sites', label: { en: 'Sites › a site › Site visits', ms: 'Tapak › satu tapak › Lawatan tapak' } },
      },
      {
        who: { en: 'Visitor', ms: 'Pelawat' },
        does: { en: 'Takes stamped photos with the in-app camera, then closes the visit with findings.', ms: 'Mengambil gambar bercop dengan kamera dalam aplikasi, kemudian menutup lawatan dengan dapatan.' },
        where: { view: 'sites', label: { en: 'Sites › a site › Site visits', ms: 'Tapak › satu tapak › Lawatan tapak' } },
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'A visit checked in away from the site shows in red; the company asks about it.', ms: 'Lawatan yang didaftar jauh dari tapak dipaparkan merah; syarikat bertanya mengenainya.' },
        where: { view: 'sites', label: { en: 'Sites › a site › Site visits', ms: 'Tapak › satu tapak › Lawatan tapak' } },
      },
      {
        who: { en: 'Regional OM', ms: 'OM Wilayah' },
        does: { en: 'Changes the site’s patrol time (15 to 480 minutes) to follow the client’s request, with a note; the group default is 2 hours.', ms: 'Menukar masa rondaan tapak (15 hingga 480 minit) mengikut permintaan pelanggan, dengan catatan; lalai kumpulan ialah 2 jam.' },
        where: { view: 'sites', label: { en: 'Sites › a site › Patrol time', ms: 'Tapak › satu tapak › Masa rondaan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'The server’s time is trusted, not the phone’s.', ms: 'Masa pelayan dipercayai, bukan masa telefon.' },
      { en: 'Photos are taken in the app; each is stamped with time and place.', ms: 'Gambar diambil dalam aplikasi; setiap satu dicop dengan masa dan tempat.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/operations.md', decided: 'Fauzan, 25 Oct 2026 (rules OPS-PATROL-GAP, OPS-PATROL-SITE)' },
    words: 'site visit lawatan tapak gps photo gambar findings dapatan patrol time masa rondaan interval',
  },
  {
    id: 'ops-site-tasks',
    app: 'ops',
    title: { en: 'Client needs and site tasks for guards', ms: 'Keperluan pelanggan dan tugasan tapak untuk pengawal' },
    purpose: {
      en: 'The OM goes through the client’s needs, sets tasks for the guard, officer or patrolling officer, and the guard signs them off on the site device.',
      ms: 'OM meneliti keperluan pelanggan, menetapkan tugasan untuk pengawal, pegawai atau peronda, dan pengawal menandatangani selesai di peranti tapak.',
    },
    start: { view: 'sites', label: { en: 'Sites › a site › Client needs and site tasks', ms: 'Tapak › satu tapak › Keperluan pelanggan dan tugasan tapak' } },
    starter: { en: 'The OM covering the site (or OMs above them, or the Director)', ms: 'OM yang menjaga tapak (atau OM di atasnya, atau Pengarah)' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Presses “Discuss needs with the client” and saves who they spoke to, the answer and concern per topic, and what was agreed. Earlier discussions are kept.',
          ms: 'Tekan “Discuss needs with the client” dan simpan siapa yang ditemui, jawapan dan tahap kebimbangan bagi setiap topik, dan apa yang dipersetujui. Perbincangan terdahulu disimpan.',
        },
        where: { view: 'sites', label: { en: 'Sites › a site › Client needs and site tasks', ms: 'Tapak › satu tapak › Keperluan pelanggan dan tugasan tapak' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Presses “Set a task”: who does it, the days or one date, an optional do-by time and photo, and the client need it answers.', ms: 'Tekan “Set a task”: siapa yang melakukannya, hari atau satu tarikh, masa siap dan gambar (pilihan), dan keperluan pelanggan yang dijawab.' },
        where: { view: 'sites', label: { en: 'Sites › a site › Client needs and site tasks', ms: 'Tapak › satu tapak › Keperluan pelanggan dan tugasan tapak' } },
      },
      {
        who: { en: 'Guard, officer or patrolling officer', ms: 'Pengawal, pegawai atau peronda' },
        does: { en: 'Signs each task off on the shared device with staff number and PIN (and a photo where needed), or marks “cannot do it” with a reason.', ms: 'Menandatangani setiap tugasan di peranti bersama dengan nombor staf dan PIN (dan gambar jika perlu), atau tanda “tidak dapat dibuat” dengan sebab.' },
        where: { view: 'device', label: { en: 'Site device › Tasks today', ms: 'Peranti tapak › Tugasan hari ini' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Reviews the last 7 days of each task: done, done but sent later, not done with a reason, late or missed.', ms: 'Menyemak 7 hari terakhir setiap tugasan: selesai, selesai tetapi dihantar lewat, tidak dibuat dengan sebab, lewat atau terlepas.' },
        where: { view: 'sites', label: { en: 'Sites › a site › Client needs and site tasks', ms: 'Tapak › satu tapak › Keperluan pelanggan dan tugasan tapak' } },
      },
    ],
    rules: [
      { en: 'The company manager can see the tasks but not set them.', ms: 'Pengurus syarikat boleh melihat tugasan tetapi tidak menetapkannya.' },
      { en: 'A second person cannot sign off a task already signed for that day.', ms: 'Orang kedua tidak boleh menandatangani tugasan yang sudah ditandatangani pada hari itu.' },
      { en: 'The OM may turn the gate check-in off for a site with its own gate system, with a reason, and back on.', ms: 'OM boleh mematikan daftar masuk pintu pagar bagi tapak yang mempunyai sistem pagar sendiri, dengan sebab, dan menghidupkannya semula.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The limits in rule SITE-TASK are proposals.', ms: 'Had dalam peraturan SITE-TASK ialah cadangan.' },
    source: { doc: 'docs/SITE_DEVICE_DUTY.md', decided: 'Fauzan, 6 Nov 2026 (section 5)' },
    words: 'client needs keperluan pelanggan task tugasan site tapak guard pengawal sign off gate pagar',
  },
  {
    id: 'ops-duty-plan',
    app: 'ops',
    title: { en: 'Guard duty plans and officer routes', ms: 'Pelan tugas pengawal dan laluan peronda' },
    purpose: {
      en: 'The OM enters the guard contract terms, publishes each post’s minute-by-minute duties and each patrolling officer’s daily route; the app in use reports back monthly.',
      ms: 'OM memasukkan terma kontrak pengawal, menerbitkan tugas minit demi minit setiap pos dan laluan harian setiap peronda; aplikasi yang digunakan melapor balik setiap bulan.',
    },
    start: { view: 'duty', tab: 'posts', label: { en: 'Guard duty plans › Posts', ms: 'Pelan tugas pengawal › Pos' } },
    starter: { en: 'The OM or Regional OM covering the site', ms: 'OM atau OM Wilayah yang menjaga tapak' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Enters the contract terms: reference, rate per guard-hour, shifts and guards, least guard tour points, officer visit frequency, daily report time, and the contract’s guard rules.',
          ms: 'Memasukkan terma kontrak: rujukan, kadar sejam pengawal, syif dan bilangan pengawal, titik rondaan minimum, kekerapan lawatan peronda, masa laporan harian, dan peraturan pengawal dalam kontrak.',
        },
        where: { view: 'duty', tab: 'posts', label: { en: 'Guard duty plans › Posts › Contract terms', ms: 'Pelan tugas pengawal › Pos › Terma kontrak' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Checks the roster against the terms and shows what a gap would cost (an estimate; the client decides any deduction), and flags where the contract and our rules differ.',
          ms: 'Menyemak roster berbanding terma dan menunjukkan kos jika ada kekurangan (anggaran; pelanggan memutuskan potongan), serta menanda di mana kontrak dan peraturan kita berbeza.',
        },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Publishes the post plan for the day.', ms: 'Menerbitkan pelan pos bagi hari itu.' },
        where: { view: 'duty', tab: 'posts', label: { en: 'Guard duty plans › Posts', ms: 'Pelan tugas pengawal › Pos' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Sets the officer’s hours for the day (start, end, meal break) and publishes the route; a site whose contract visit is due goes first.', ms: 'Menetapkan waktu peronda bagi hari itu (mula, tamat, rehat makan) dan menerbitkan laluan; tapak yang lawatan kontraknya sudah tiba didahulukan.' },
        where: { view: 'duty', tab: 'routes', label: { en: 'Guard duty plans › Officer routes', ms: 'Pelan tugas pengawal › Laluan peronda' } },
      },
      {
        who: { en: 'JA app (or the app in use)', ms: 'Aplikasi JA (atau aplikasi yang digunakan)' },
        does: { en: 'Runs the work and sends back a monthly return against Prima’s published tasks.', ms: 'Menjalankan kerja dan menghantar pulangan bulanan berdasarkan tugasan yang diterbitkan Prima.' },
        outside: true,
      },
    ],
    rules: [
      { en: 'Our rules apply; a clash with the contract is flagged, never blocked.', ms: 'Peraturan kita terpakai; percanggahan dengan kontrak ditanda, tidak disekat.' },
      { en: 'Handover 10 minutes, first round 30 minutes into the shift, a 30-minute meal break about half way, a log entry every 4 hours.', ms: 'Serah tugas 10 minit, rondaan pertama 30 minit selepas syif bermula, rehat makan 30 minit lebih kurang separuh syif, catatan log setiap 4 jam.' },
      { en: 'Officer hours are set per day; at most 14 hours.', ms: 'Waktu peronda ditetapkan setiap hari; paling lama 14 jam.' },
      { en: 'The company manager and admin executives only view.', ms: 'Pengurus syarikat dan eksekutif admin hanya melihat.' },
    ],
    status: 'in_force',
    statusNote: { en: 'There is no live link to the JA app yet; the monthly return list is what that app must send.', ms: 'Belum ada pautan langsung ke aplikasi JA; senarai pulangan bulanan ialah apa yang perlu dihantar oleh aplikasi itu.' },
    source: { doc: 'docs/CLEANING_AND_DUTY_PLANNER.md', decided: 'Fauzan, 4 Nov 2026 (DUTY_RULES, KPM contract terms)' },
    words: 'duty plan pelan tugas post pos route laluan patrolling officer peronda contract kontrak kpm khs',
  },
  {
    id: 'ops-cleaning-plan',
    app: 'ops',
    title: { en: 'Cleaning plan: set up, plan, publish and record', ms: 'Pelan pembersihan: sediakan, rancang, terbit dan rekod' },
    purpose: {
      en: 'Each cleaning site gets a daily roster and a minute-by-minute plan from the client’s scope and the size of each area; the OM records the work with time-marked photos.',
      ms: 'Setiap tapak pembersihan mendapat roster harian dan pelan minit demi minit daripada skop pelanggan dan saiz setiap kawasan; OM merekod kerja dengan gambar bertanda masa.',
    },
    start: { view: 'cleaning', label: { en: 'Set up cleaning at a site', ms: 'Sediakan pembersihan di tapak' } },
    starter: { en: 'The OM or Regional OM covering the site', ms: 'OM atau OM Wilayah yang menjaga tapak' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Sets up cleaning at the site: scope and crew, the site map and the size of each area, and the planner timings if the site differs.', ms: 'Menyediakan pembersihan di tapak: skop dan krew, peta tapak dan saiz setiap kawasan, dan masa perancang jika tapak berbeza.' },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Scope and crew', ms: 'Pelan pembersihan › tapak › Skop dan krew' } },
      },
      {
        who: { en: 'OM covering the site', ms: 'OM yang menjaga tapak' },
        does: { en: 'Checks the day plan and publishes it. The company manager can only view.', ms: 'Menyemak pelan harian dan menerbitkannya. Pengurus syarikat hanya boleh melihat.' },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Day plan', ms: 'Pelan pembersihan › tapak › Pelan harian' } },
      },
      {
        who: { en: 'OM (for the supervisor)', ms: 'OM (bagi pihak penyelia)' },
        does: {
          en: 'Records each job done, checked, redo or missed with the supervisor’s time-marked photo. A job not needed today is marked with the reason and a photo; the rest of the day is planned again.',
          ms: 'Merekod setiap kerja selesai, disemak, buat semula atau terlepas dengan gambar bertanda masa daripada penyelia. Kerja yang tidak perlu hari ini ditanda dengan sebab dan gambar; baki hari dirancang semula.',
        },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Day plan', ms: 'Pelan pembersihan › tapak › Pelan harian' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Records deliveries and stock checks; Prima flags over-use, under-use and short deliveries.', ms: 'Merekod penghantaran dan semakan stok; Prima menanda penggunaan berlebihan, kurang guna dan penghantaran kurang.' },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Supplies and equipment', ms: 'Pelan pembersihan › tapak › Bekalan dan peralatan' } },
      },
      {
        who: { en: 'OGM (Gov Ops)', ms: 'OGM (Operasi Kerajaan)' },
        does: { en: 'Monitors every cleaning site and reads the monthly report.', ms: 'Memantau setiap tapak pembersihan dan membaca laporan bulanan.' },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Monthly report', ms: 'Pelan pembersihan › tapak › Laporan bulanan' } },
      },
    ],
    rules: [
      { en: 'Proof is a time-marked photo under 700 KB, from the same day (10 minutes tolerance with the camera time); a photo is used only once.', ms: 'Bukti ialah gambar bertanda masa di bawah 700 KB, pada hari yang sama (toleransi 10 minit dengan masa kamera); gambar hanya digunakan sekali.' },
      { en: '“Not needed today” only for today’s planned work, never for a job already done; it is counted apart from missed work.', ms: '“Tidak perlu hari ini” hanya untuk kerja yang dirancang hari ini, bukan kerja yang sudah selesai; ia dikira berasingan daripada kerja terlepas.' },
      { en: 'Supplies: above 100% of budget is over-use; below 50% is under-use or under-giving.', ms: 'Bekalan: melebihi 100% bajet ialah penggunaan berlebihan; bawah 50% ialah kurang guna atau kurang diberi.' },
    ],
    status: 'in_force',
    statusNote: { en: 'Supervisors and cleaners do not sign in (by decision); the OM records for them. Reorder at 7 days left is still a proposal.', ms: 'Penyelia dan pencuci tidak log masuk (keputusan); OM merekod bagi pihak mereka. Pesan semula pada baki 7 hari masih cadangan.' },
    source: { doc: 'docs/CLEANING_AND_DUTY_PLANNER.md', decided: 'Fauzan, 4 Nov 2026 (CLEAN-RATES, CLEAN-STOCK, CLEAN-PROOF)' },
    words: 'cleaning pembersihan cleaner pencuci plan pelan supervisor penyelia photo gambar stock stok kpm map peta',
  },
  {
    id: 'ops-cleaning-client-slip',
    app: 'ops',
    title: { en: "Client's slip and the monthly acknowledgement", ms: 'Slip pelanggan dan pengakuan bulanan' },
    purpose: {
      en: 'Jobs that need the client’s signed slip, and the client’s signed acknowledgement of each month’s work, uploaded by the OM or the company.',
      ms: 'Kerja yang memerlukan slip bertandatangan pelanggan, dan pengakuan bertandatangan pelanggan bagi kerja setiap bulan, dimuat naik oleh OM atau syarikat.',
    },
    start: { view: 'cleaning', label: { en: 'Cleaning plans › site › Client slips', ms: 'Pelan pembersihan › tapak › Slip pelanggan' } },
    starter: { en: 'OM or the company office', ms: 'OM atau pejabat syarikat' },
    steps: [
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Ticks “Client slip needed” on the areas that need one (for example grass cutting and hedges for a school).', ms: 'Tanda “Client slip needed” pada kawasan yang memerlukannya (contohnya potong rumput dan pagar hidup bagi sekolah).' },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Scope and crew', ms: 'Pelan pembersihan › tapak › Skop dan krew' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Uploads the signed slip with who signed, the days covered, whether the client accepted, and the comment copied from the slip.',
          ms: 'Memuat naik slip bertandatangan dengan siapa yang menandatangan, hari yang diliputi, sama ada pelanggan menerima, dan ulasan yang disalin dari slip.',
        },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Client slips', ms: 'Pelan pembersihan › tapak › Slip pelanggan' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'A slip that does not accept the work needs the comment and what will be done; those days stay open until redone and a new slip is signed.', ms: 'Slip yang tidak menerima kerja perlu ulasan dan tindakan yang akan diambil; hari tersebut kekal terbuka sehingga dibuat semula dan slip baharu ditandatangani.' },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Client slips', ms: 'Pelan pembersihan › tapak › Slip pelanggan' } },
        decision: true,
      },
      {
        who: { en: 'OM or the company', ms: 'OM atau syarikat' },
        does: { en: 'For every client (guards and cleaning), uploads the client’s signed acknowledgement of the month by the 10th after the month closes.', ms: 'Bagi setiap pelanggan (pengawal dan pembersihan), muat naik pengakuan bertandatangan pelanggan bagi bulan itu sebelum 10hb selepas bulan ditutup.' },
        where: { view: 'cleaning', label: { en: 'Cleaning plans › site › Monthly report', ms: 'Pelan pembersihan › tapak › Laporan bulanan' } },
      },
    ],
    rules: [
      { en: 'Slip files: photo or scan (JPEG, PNG or PDF), under 2 MB, each file used once.', ms: 'Fail slip: gambar atau imbasan (JPEG, PNG atau PDF), bawah 2 MB, setiap fail digunakan sekali.' },
      { en: 'No comment on the slip: write “No comment written”. A complaint needs what will be done.', ms: 'Tiada ulasan pada slip: tulis “No comment written”. Aduan perlu tindakan yang akan diambil.' },
      { en: 'A missing acknowledgement shows “to upload” up to the 10th and red after it.', ms: 'Pengakuan yang tiada dipaparkan “untuk dimuat naik” hingga 10hb dan merah selepasnya.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/CLEANING_AND_DUTY_PLANNER.md', decided: 'Fauzan, 4 Nov 2026' },
    words: 'client slip slip pelanggan acknowledgement pengakuan monthly bulanan signed tandatangan satisfied puas hati complaint aduan',
  },
  {
    id: 'ops-far-branch',
    app: 'ops',
    title: { en: 'Far branches: checklists, visits and spot checks', ms: 'Cawangan jauh: senarai semak, lawatan dan semakan mengejut' },
    purpose: {
      en: 'Far branches are run by daily, weekly and monthly checklists with photo proof, visits and spot checks, scored on 8 measures.',
      ms: 'Cawangan jauh diuruskan dengan senarai semak harian, mingguan dan bulanan berserta bukti gambar, lawatan dan semakan mengejut, dinilai pada 8 ukuran.',
    },
    start: { view: 'branchwork', label: { en: 'Far branches', ms: 'Cawangan jauh' } },
    starter: { en: 'The branch manager', ms: 'Pengurus cawangan' },
    steps: [
      {
        who: { en: 'Branch manager', ms: 'Pengurus cawangan' },
        does: { en: 'Sends the daily checklist by 10:00, the weekly by Friday 17:00 and the monthly by the 25th 17:00, with a photo taken in the app.', ms: 'Menghantar senarai semak harian sebelum 10:00, mingguan sebelum Jumaat 17:00 dan bulanan sebelum 25hb 17:00, dengan gambar diambil dalam aplikasi.' },
        where: { view: 'branchwork', label: { en: 'Far branches › branch › Checklists', ms: 'Cawangan jauh › cawangan › Senarai semak' } },
      },
      {
        who: { en: 'OM and Regional OM', ms: 'OM dan OM Wilayah' },
        does: { en: 'Visit each far branch (OM at least twice a month, Regional OM monthly) and record the findings.', ms: 'Melawat setiap cawangan jauh (OM sekurang-kurangnya dua kali sebulan, OM Wilayah setiap bulan) dan merekod dapatan.' },
        where: { view: 'branchwork', label: { en: 'Far branches › branch › Visits and spot checks', ms: 'Cawangan jauh › cawangan › Lawatan dan semakan mengejut' } },
      },
      {
        who: { en: 'ACT; CMS or the company manager', ms: 'ACT; CMS atau pengurus syarikat' },
        does: { en: 'ACT makes one unannounced audit per branch each half year; CMS or the company manager may make up to 2 random video spot checks a month.', ms: 'ACT membuat satu audit tanpa notis bagi setiap cawangan setiap setengah tahun; CMS atau pengurus syarikat boleh membuat sehingga 2 semakan video rawak sebulan.' },
        where: { view: 'branchwork', label: { en: 'Far branches › branch › Visits and spot checks', ms: 'Cawangan jauh › cawangan › Lawatan dan semakan mengejut' } },
      },
      {
        who: { en: 'Company manager and operations', ms: 'Pengurus syarikat dan operasi' },
        does: { en: 'Follow up red branches on the 8-measure scorecard.', ms: 'Menyusul cawangan merah pada kad skor 8 ukuran.' },
        where: { view: 'branchwork', label: { en: 'Far branches › Scorecard', ms: 'Cawangan jauh › Kad skor' } },
      },
    ],
    rules: [
      { en: 'A measure with no data shows Unknown, never green.', ms: 'Ukuran tanpa data dipaparkan Tidak diketahui, tidak sekali-kali hijau.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The screen marks the visit and spot-check limits as proposals for approval.', ms: 'Skrin menandakan had lawatan dan semakan mengejut sebagai cadangan untuk kelulusan.' },
    source: { doc: 'docs/system/reference/rule-register.md', decided: 'Fauzan, 27 Oct 2026 (D7, D9; rule BRANCH-VISITS)' },
    words: 'far branch cawangan jauh checklist senarai semak visit lawatan spot check semakan mengejut scorecard kad skor',
  },
  {
    id: 'ops-site-talk',
    app: 'ops',
    title: { en: 'Site safety and operations talk (OM toolbox)', ms: 'Taklimat keselamatan dan operasi tapak (toolbox OM)' },
    purpose: {
      en: 'The OM gives each site a short safety and operations talk at least every 30 days and records it with a stamped photo.',
      ms: 'OM memberi taklimat ringkas keselamatan dan operasi di setiap tapak sekurang-kurangnya setiap 30 hari dan merekodnya dengan gambar bercop.',
    },
    start: { view: 'meetings', tab: 'toolbox', label: { en: 'Meetings › Toolbox › Site toolbox talks', ms: 'Mesyuarat › Toolbox › Taklimat toolbox tapak' } },
    starter: { en: 'The OM covering the site', ms: 'OM yang menjaga tapak' },
    steps: [
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Lists sites with no talk in 30 days on the OM’s list and home.', ms: 'Menyenaraikan tapak tanpa taklimat dalam 30 hari pada senarai dan laman utama OM.' },
        where: { view: 'meetings', tab: 'toolbox', label: { en: 'Meetings › Toolbox', ms: 'Mesyuarat › Toolbox' } },
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: { en: 'Gives the talk at the site with the guards.', ms: 'Memberi taklimat di tapak bersama pengawal.' },
        outside: true,
      },
      {
        who: { en: 'OM', ms: 'OM' },
        does: {
          en: 'Opens the site’s row and presses “Rekod taklimat”: safety topic, operations points, guards present, a stamped photo at the site, and issues raised.',
          ms: 'Buka baris tapak dan tekan “Rekod taklimat”: topik keselamatan, perkara operasi, bilangan pengawal hadir, gambar bercop di tapak, dan isu yang dibangkitkan.',
        },
        where: { view: 'meetings', tab: 'toolbox', label: { en: 'Meetings › Toolbox › Site toolbox talks', ms: 'Mesyuarat › Toolbox › Taklimat toolbox tapak' } },
      },
    ],
    rules: [{ en: 'A stamped photo taken at the site is required.', ms: 'Gambar bercop yang diambil di tapak diwajibkan.' }],
    status: 'in_force',
    source: { doc: 'docs/COMPANY_TOOLBOX_MEETING.md', decided: 'Fauzan, 14 Nov 2026 (Part X, X19)' },
    words: 'toolbox taklimat talk safety keselamatan site tapak om briefing',
  },

  // ---------------------------------------------------------------- Security: incidents and police
  {
    id: 'security-case',
    app: 'security',
    title: { en: 'A case from report to closure', ms: 'Kes dari laporan hingga ditutup' },
    purpose: {
      en: 'Every incident, complaint or alert is raised with severity and proof, passed up the ladder until fully resolved, and closed by the company.',
      ms: 'Setiap insiden, aduan atau amaran dibuka dengan tahap keterukan dan bukti, dinaikkan mengikut tangga sehingga selesai sepenuhnya, dan ditutup oleh syarikat.',
    },
    start: { view: 'cases', label: { en: 'Raise a case', ms: 'Buka kes' } },
    starter: { en: 'Company staff, supervisors, operations; a guard through Report incident on the site device', ms: 'Kakitangan syarikat, penyelia, operasi; pengawal melalui Lapor insiden di peranti tapak' },
    steps: [
      {
        who: { en: 'Whoever finds it', ms: 'Sesiapa yang menemuinya' },
        does: { en: 'Raises the case with severity P1 to P4 and proof (a stamped photo or a document).', ms: 'Membuka kes dengan tahap P1 hingga P4 dan bukti (gambar bercop atau dokumen).' },
        where: { view: 'cases', label: { en: 'Cases › Raise a case', ms: 'Kes › Buka kes' } },
      },
      {
        who: { en: 'Level in charge: site officer, patrolling officer, OM, Regional OM', ms: 'Peringkat bertanggungjawab: pegawai tapak, peronda, OM, OM Wilayah' },
        does: { en: 'Acknowledges and signs off its step with a note (and proof where asked). A level that does not act in time lets the next one step in.', ms: 'Mengakui dan menandatangani langkahnya dengan catatan (dan bukti jika diminta). Peringkat yang tidak bertindak dalam masa membolehkan peringkat seterusnya masuk campur.' },
        where: { view: 'cases', label: { en: 'Cases › case › Escalation until fully resolved', ms: 'Kes › kes › Eskalasi sehingga selesai' } },
      },
      {
        who: { en: 'Regional OM', ms: 'OM Wilayah' },
        does: {
          en: 'Above the Regional OM only by an Escalate decision with a reason: OGM (government) or Operations Director (private), then COO, then CEO.',
          ms: 'Di atas OM Wilayah hanya melalui keputusan Eskalasi dengan sebab: OGM (kerajaan) atau Pengarah Operasi (swasta), kemudian COO, kemudian CEO.',
        },
        where: { view: 'cases', label: { en: 'Cases › case', ms: 'Kes › kes' } },
        decision: true,
      },
      {
        who: { en: 'Level in charge, then Regional OM', ms: 'Peringkat bertanggungjawab, kemudian OM Wilayah' },
        does: { en: 'Resolves with proof; the Regional OM confirms it fully resolved.', ms: 'Menyelesaikan dengan bukti; OM Wilayah mengesahkan ia selesai sepenuhnya.' },
        where: { view: 'cases', label: { en: 'Cases › case', ms: 'Kes › kes' } },
        decision: true,
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus syarikat' },
        does: { en: 'Closes the case. Only the company closes.', ms: 'Menutup kes. Hanya syarikat yang menutup.' },
        where: { view: 'cases', label: { en: 'Cases › case › Close case', ms: 'Kes › kes › Tutup kes' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'First response: P1 in 5 minutes, P2 in 30 minutes, P3 today, P4 in 2 working days.', ms: 'Respons pertama: P1 dalam 5 minit, P2 dalam 30 minit, P3 hari ini, P4 dalam 2 hari bekerja.' },
      { en: 'Verify, resolve and confirm need proof; send back and escalate need a reason.', ms: 'Sahkan, selesaikan dan pengesahan memerlukan bukti; pulangkan dan eskalasi memerlukan sebab.' },
      { en: 'The CEO’s home shows only cases that reached the CEO’s own step.', ms: 'Laman utama CEO hanya memaparkan kes yang sampai ke langkah CEO.' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'The ladder times by severity (15/60/240/1440 minutes) are proposed. Incidents move to the JA app only when its feed is live.',
      ms: 'Masa tangga mengikut tahap (15/60/240/1440 minit) masih cadangan. Insiden berpindah ke aplikasi JA hanya apabila suapannya aktif.',
    },
    source: { doc: 'docs/system/04-workflows.md', decided: 'W3' },
    words: 'case kes incident insiden complaint aduan sos escalate eskalasi resolve selesai close tutup p1 p2 p3 p4 ladder tangga',
  },
  {
    id: 'security-police-help',
    app: 'security',
    title: { en: 'Police call or visit: ask Arms Control for help', ms: 'Panggilan atau lawatan polis: minta bantuan Kawalan Senjata' },
    purpose: {
      en: 'When police phone or come (usually an armoury check), the company asks Arms Control, who sends a helper and records what happened; the company confirms.',
      ms: 'Apabila polis menelefon atau datang (biasanya pemeriksaan bilik kebal), syarikat meminta bantuan Kawalan Senjata, yang menghantar pembantu dan merekod apa yang berlaku; syarikat mengesahkan.',
    },
    start: { view: 'cases', label: { en: 'Ask Arms Control for help', ms: 'Minta bantuan Kawalan Senjata' } },
    starter: { en: 'Company manager or admin executive', ms: 'Pengurus syarikat atau eksekutif admin' },
    steps: [
      {
        who: { en: 'Company manager or admin executive', ms: 'Pengurus syarikat atau eksekutif admin' },
        does: { en: 'Asks for help: kind (phoned, coming now, booked visit), reason, police unit and a contact. “What to say and show” opens the guide.', ms: 'Memohon bantuan: jenis (polis telefon, sedang datang, lawatan bertarikh), sebab, unit polis dan orang untuk dihubungi. “Panduan” membuka panduan apa yang perlu dikata dan ditunjuk.' },
        where: { view: 'cases', label: { en: 'Cases › Police call or visit help', ms: 'Kes › Bantuan panggilan atau lawatan polis' } },
      },
      {
        who: { en: 'Arms Control', ms: 'Kawalan Senjata' },
        does: { en: 'Assigns a helper in time.', ms: 'Menamakan pembantu dalam masa yang ditetapkan.' },
        where: { view: 'arms', tab: 'policehelp', label: { en: 'Arms control › Police visit help', ms: 'Kawalan senjata › Bantuan lawatan polis' } },
      },
      {
        who: { en: 'Helper (Arms Control)', ms: 'Pembantu (Kawalan Senjata)' },
        does: { en: 'Helps the company with the police, then records the help given with proof and any follow-up.', ms: 'Membantu syarikat berurusan dengan polis, kemudian merekod bantuan yang diberi dengan bukti dan susulan.' },
        where: { view: 'arms', tab: 'policehelp', label: { en: 'Arms control › Police visit help', ms: 'Kawalan senjata › Bantuan lawatan polis' } },
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Confirms it got the help, or sends it back with a reason.', ms: 'Mengesahkan bantuan diterima, atau memulangkannya dengan sebab.' },
        where: { view: 'cases', label: { en: 'Cases › Police call or visit help', ms: 'Kes › Bantuan panggilan atau lawatan polis' } },
        decision: true,
      },
      {
        who: { en: 'CMS and arms leaders', ms: 'CMS dan pemimpin senjata' },
        does: { en: 'Watch the requests, view only.', ms: 'Memantau permohonan, lihat sahaja.' },
        where: { view: 'cms', tab: 'now', label: { en: 'CMS › Now', ms: 'CMS › Sekarang' } },
      },
    ],
    rules: [
      { en: 'A helper is assigned within 15 minutes for a visit happening now, 30 minutes for a phone call, and 24 hours before a booked visit; past that it shows as late to Arms Control, CMS and the company.', ms: 'Pembantu dinamakan dalam 15 minit bagi lawatan yang sedang berlaku, 30 minit bagi panggilan telefon, dan 24 jam sebelum lawatan bertarikh; selepas itu ia dipaparkan lewat kepada Kawalan Senjata, CMS dan syarikat.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/reference/rule-register.md', decided: 'Fauzan, 3 Nov 2026 (rule ARMS-POLICE-HELP)' },
    words: 'police polis visit lawatan armoury bilik kebal help bantuan arms control kawalan senjata pdrm',
  },

  // ---------------------------------------------------------------- Security: arms
  {
    id: 'security-firearm-issue',
    app: 'security',
    title: { en: 'Firearm issue and return', ms: 'Pengeluaran dan pemulangan senjata api' },
    purpose: {
      en: 'Before an armed shift the company checks readiness, issues the firearm with an RFID scan and a witness, and receives it back the same way.',
      ms: 'Sebelum syif bersenjata, syarikat menyemak kesediaan, mengeluarkan senjata dengan imbasan RFID dan saksi, dan menerimanya semula dengan cara yang sama.',
    },
    start: { view: 'arms', label: { en: 'Arms control › Armed shifts needing a firearm', ms: 'Kawalan senjata › Syif bersenjata yang perlu senjata' } },
    starter: { en: 'Company manager or site supervisor of the licensed company', ms: 'Pengurus syarikat atau penyelia tapak syarikat berlesen' },
    steps: [
      {
        who: { en: 'Arms Control and the company', ms: 'Kawalan Senjata dan syarikat' },
        does: { en: 'Readiness shows go or no-go for every armed shift now and in the next 24 hours (licence, training, local guard only).', ms: 'Kesediaan menunjukkan boleh atau tidak bagi setiap syif bersenjata sekarang dan 24 jam akan datang (lesen, latihan, pengawal tempatan sahaja).' },
        where: { view: 'arms', tab: 'ready', label: { en: 'Arms control › Readiness', ms: 'Kawalan senjata › Kesediaan' } },
      },
      {
        who: { en: 'Company manager or site supervisor', ms: 'Pengurus syarikat atau penyelia tapak' },
        does: { en: 'Presses Issue firearm: scans the RFID tag, sets the rounds, and a witness types their own staff number and PIN.', ms: 'Tekan Keluarkan senjata: imbas tag RFID, tetapkan bilangan peluru, dan saksi menaip nombor staf dan PIN sendiri.' },
        where: { view: 'arms', label: { en: 'Arms control › your company › Issue firearm', ms: 'Kawalan senjata › syarikat anda › Keluarkan senjata' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Overdue: alert at 15 minutes, escalate at 30, possible loss at 2 hours (“Open P1 case”).', ms: 'Lewat: amaran pada 15 minit, eskalasi pada 30 minit, kemungkinan hilang pada 2 jam (“Open P1 case”).' },
        where: { view: 'arms', label: { en: 'Arms control › Firearms out now', ms: 'Kawalan senjata › Senjata di luar sekarang' } },
      },
      {
        who: { en: 'Company manager or site supervisor', ms: 'Pengurus syarikat atau penyelia tapak' },
        does: { en: 'Receives it back with scan and witness, and counts the vault (Count now).', ms: 'Menerima semula dengan imbasan dan saksi, dan mengira bilik kebal (Kira sekarang).' },
        where: { view: 'arms', label: { en: 'Arms control › Receive back', ms: 'Kawalan senjata › Terima semula' } },
      },
      {
        who: { en: 'Arms Control and CMS', ms: 'Kawalan Senjata dan CMS' },
        does: { en: 'Watch every movement and the ammunition ledger against the last physical count.', ms: 'Memantau setiap pergerakan dan lejar peluru berbanding kiraan fizikal terakhir.' },
        where: { view: 'arms', tab: 'log', label: { en: 'Arms control › In and out', ms: 'Kawalan senjata › Keluar masuk' } },
      },
    ],
    rules: [
      { en: 'A foreign guard is never armed: refused on an armed post, a firearm issue and an armed job.', ms: 'Pengawal asing tidak sekali-kali bersenjata: ditolak di pos bersenjata, pengeluaran senjata dan tugas bersenjata.' },
      { en: 'A damaged or out-of-use firearm cannot be issued.', ms: 'Senjata yang rosak atau tidak boleh digunakan tidak boleh dikeluarkan.' },
      { en: 'Ammunition differences are never silently adjusted; a shortfall opens a case.', ms: 'Perbezaan peluru tidak sekali-kali dilaraskan secara senyap; kekurangan membuka kes.' },
      { en: 'A lost firearm is reported at the nearest police station within 14 days (Arms Act s.7(1)). The paper register book stays in use.', ms: 'Senjata hilang dilaporkan di balai polis terdekat dalam 14 hari (Akta Senjata s.7(1)). Buku daftar kertas kekal digunakan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W17; rules ARMS-OVERDUE, ARMS-WITNESS, ARMS-LOCAL-ONLY (Fauzan, 2 Nov 2026)' },
    words: 'firearm senjata api issue keluarkan return pulang rfid witness saksi vault bilik kebal ammunition peluru overdue lewat',
  },
  {
    id: 'security-arms-request',
    app: 'security',
    title: { en: 'Arms request (buy, service, dispose, loss report)', ms: 'Permohonan senjata (beli, servis, lupus, laporan kehilangan)' },
    purpose: {
      en: 'The ten-step path for a company’s arms request, from raising it to reconciling the register.',
      ms: 'Laluan sepuluh langkah bagi permohonan senjata syarikat, dari permohonan dibuat hingga daftar diselaraskan.',
    },
    start: { view: 'arms', label: { en: 'New arms request', ms: 'Permohonan senjata baharu' } },
    starter: { en: 'The licensed company (company manager)', ms: 'Syarikat berlesen (pengurus syarikat)' },
    steps: [
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Raises the request: what it is for, title, reason, quantity or the firearms concerned, and estimated cost.', ms: 'Membuat permohonan: tujuan, tajuk, sebab, kuantiti atau senjata berkenaan, dan anggaran kos.' },
        where: { view: 'arms', label: { en: 'Arms control › your company › Arms requests', ms: 'Kawalan senjata › syarikat anda › Permohonan senjata' } },
      },
      {
        who: { en: 'Arms Control', ms: 'Kawalan Senjata' },
        does: { en: 'Reviews: passes it to the company or sends it back with a reason. The requester corrects and resubmits saying what changed.', ms: 'Menyemak: menyerahkan kepada syarikat atau memulangkan dengan sebab. Pemohon membetulkan dan menghantar semula dengan menyatakan apa yang berubah.' },
        where: { view: 'arms', tab: 'requests', label: { en: 'Arms control › Requests', ms: 'Kawalan senjata › Permohonan' } },
        decision: true,
      },
      {
        who: { en: 'Company manager (A licence holder)', ms: 'Pengurus syarikat (pemegang Lesen A)' },
        does: { en: 'Authorises or refuses, with a reason.', ms: 'Memberi kuasa atau menolak, dengan sebab.' },
        where: { view: 'arms', label: { en: 'Arms control › your company › Arms requests', ms: 'Kawalan senjata › syarikat anda › Permohonan senjata' } },
        decision: true,
      },
      {
        who: { en: 'PWVSB Legal', ms: 'Undang-undang PWVSB' },
        does: { en: 'Clears or stops transfers, disposals and trade.', ms: 'Meluluskan atau menghentikan pindahan, pelupusan dan dagangan.' },
        decision: true,
      },
      {
        who: { en: 'Arms Control; COO or CEO', ms: 'Kawalan Senjata; COO atau CEO' },
        does: { en: 'The PDRM or KDN reference is recorded; the COO or CEO approves the spend.', ms: 'Rujukan PDRM atau KDN direkod; COO atau CEO meluluskan perbelanjaan.' },
        where: { view: 'arms', tab: 'requests', label: { en: 'Arms control › Requests', ms: 'Kawalan senjata › Permohonan' } },
        decision: true,
      },
      {
        who: { en: 'Someone other than the requester', ms: 'Orang selain pemohon' },
        does: { en: 'Verifies; the register is reconciled; the request is closed.', ms: 'Mengesahkan; daftar diselaraskan; permohonan ditutup.' },
        where: { view: 'arms', tab: 'requests', label: { en: 'Arms control › Requests', ms: 'Kawalan senjata › Permohonan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Every decision takes a reason; nobody decides their own request.', ms: 'Setiap keputusan perlu sebab; tiada sesiapa memutuskan permohonan sendiri.' },
      { en: 'Buying and servicing only through licensed dealers.', ms: 'Pembelian dan servis hanya melalui peniaga berlesen.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'W18; Fauzan, 2 Nov 2026 (slice 4C)' },
    words: 'arms request permohonan senjata buy beli service servis dispose lupus loss hilang authorise legal pdrm kdn',
  },
  {
    id: 'security-armed-job',
    app: 'security',
    title: { en: 'Armed job (CIT, CDM, cash vaulting, bodyguard)', ms: 'Tugas bersenjata (CIT, CDM, simpanan tunai, pengawal peribadi)' },
    purpose: {
      en: 'The company plans each armed job; it cannot start until crew, firearms, vehicle, client agreement and cover are ready.',
      ms: 'Syarikat merancang setiap tugas bersenjata; ia tidak boleh bermula sehingga krew, senjata, kenderaan, perjanjian pelanggan dan perlindungan insurans bersedia.',
    },
    start: { view: 'arms', label: { en: 'Plan an armed job', ms: 'Rancang tugas bersenjata' } },
    starter: { en: 'Company manager of the licensed company', ms: 'Pengurus syarikat berlesen' },
    steps: [
      {
        who: { en: 'Company manager', ms: 'Pengurus syarikat' },
        does: { en: 'Plans the job: kind, client, times, crew (local guards only), firearms and vehicle.', ms: 'Merancang tugas: jenis, pelanggan, masa, krew (pengawal tempatan sahaja), senjata dan kenderaan.' },
        where: { view: 'arms', label: { en: 'Arms control › your company › Armed jobs', ms: 'Kawalan senjata › syarikat anda › Tugas bersenjata' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Blocks the start (no-go) while the crew, firearms, vehicle, client agreement or cover is not ready.', ms: 'Menyekat permulaan (tidak boleh) selagi krew, senjata, kenderaan, perjanjian pelanggan atau perlindungan belum bersedia.' },
        where: { view: 'arms', tab: 'ready', label: { en: 'Arms control › Readiness', ms: 'Kawalan senjata › Kesediaan' } },
      },
      {
        who: { en: 'Company manager', ms: 'Pengurus syarikat' },
        does: { en: 'Updates the job with a note: started, delayed, incident (raise a case too) or completed.', ms: 'Mengemas kini tugas dengan catatan: bermula, tertangguh, insiden (buka kes juga) atau selesai.' },
        where: { view: 'arms', label: { en: 'Arms control › your company › Armed jobs', ms: 'Kawalan senjata › syarikat anda › Tugas bersenjata' } },
      },
      {
        who: { en: 'Arms Control and CMS', ms: 'Kawalan Senjata dan CMS' },
        does: { en: 'Watch the jobs today and in the next 24 hours.', ms: 'Memantau tugas hari ini dan 24 jam akan datang.' },
        where: { view: 'arms', tab: 'jobs', label: { en: 'Arms control › Armed jobs', ms: 'Kawalan senjata › Tugas bersenjata' } },
      },
    ],
    rules: [
      { en: 'The job details carry no cash amounts.', ms: 'Butiran tugas tidak mengandungi jumlah wang tunai.' },
      { en: 'A crew member cannot be on two armed jobs at once.', ms: 'Ahli krew tidak boleh berada dalam dua tugas bersenjata serentak.' },
      { en: 'No valid cover for CIT, CDM or vault jobs shows “No cover” on the Arms Control board.', ms: 'Tiada perlindungan sah bagi tugas CIT, CDM atau bilik kebal dipaparkan “Tiada perlindungan” di papan Kawalan Senjata.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'Fauzan, 1-2 Nov 2026 (slice 4D)' },
    words: 'armed job tugas bersenjata cit cdm cash tunai bodyguard pengawal peribadi crew krew vehicle kenderaan no-go',
  },
  {
    id: 'security-firearm-damage',
    app: 'security',
    title: { en: 'Damaged firearm: report, inspect, repair, reuse', ms: 'Senjata rosak: lapor, periksa, baiki, guna semula' },
    purpose: {
      en: 'A damaged firearm is out of use at once and returns to use only after a passing inspection confirmed by someone who did not report or repair it.',
      ms: 'Senjata yang rosak tidak boleh digunakan serta-merta dan hanya kembali digunakan selepas pemeriksaan lulus disahkan oleh orang yang tidak melapor atau membaikinya.',
    },
    start: { view: 'arms', label: { en: 'Arms control › Arms policies › Report damage', ms: 'Kawalan senjata › Polisi senjata › Laporkan kerosakan' } },
    starter: { en: 'The company or Arms Control', ms: 'Syarikat atau Kawalan Senjata' },
    steps: [
      {
        who: { en: 'Company or Arms Control', ms: 'Syarikat atau Kawalan Senjata' },
        does: {
          en: 'Reports the damage with photos, the category (Light, Medium, Critical), how it happened and the first action. The firearm is marked DAMAGED. An issued firearm is returned first.',
          ms: 'Melaporkan kerosakan dengan gambar, kategori (Ringan, Sederhana, Kritikal), bagaimana ia berlaku dan tindakan pertama. Senjata ditanda ROSAK. Senjata yang sedang dikeluarkan perlu dipulangkan dahulu.',
        },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Laporkan kerosakan', ms: 'Kawalan senjata › Polisi senjata › Laporkan kerosakan' } },
      },
      {
        who: { en: 'Prima; Arms Control', ms: 'Prima; Kawalan Senjata' },
        does: { en: 'Critical opens a P1 arms case. Only Arms Control lowers a category, with a reason. The inspection checklist is done; a failed check opens a damage report.', ms: 'Kritikal membuka kes senjata P1. Hanya Kawalan Senjata menurunkan kategori, dengan sebab. Senarai semak pemeriksaan dibuat; semakan gagal membuka laporan kerosakan.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Pemeriksaan senjata', ms: 'Kawalan senjata › Polisi senjata › Pemeriksaan senjata' } },
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Repairs go through a Service arms request to a licensed dealer; back from service it is under inspection, not in the vault.', ms: 'Pembaikan melalui permohonan senjata Servis kepada peniaga berlesen; selepas servis ia dalam pemeriksaan, bukan dalam bilik kebal.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Pembaikan', ms: 'Kawalan senjata › Polisi senjata › Pembaikan' } },
      },
      {
        who: { en: 'Company manager (Medium); also the company director (Critical)', ms: 'Pengurus syarikat (Sederhana); juga pengarah syarikat (Kritikal)' },
        does: { en: 'Reviews the report.', ms: 'Menyemak laporan.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Rekod', ms: 'Kawalan senjata › Polisi senjata › Rekod' } },
        decision: true,
      },
      {
        who: { en: 'Arms Control (not the reporter or repairer)', ms: 'Kawalan Senjata (bukan pelapor atau pembaiki)' },
        does: { en: 'Confirms reuse after a passing inspection.', ms: 'Mengesahkan guna semula selepas pemeriksaan lulus.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Sahkan guna semula', ms: 'Kawalan senjata › Polisi senjata › Sahkan guna semula' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Targets: Light 24 hours; Medium report within 24 hours and 2 working days; Critical at once.', ms: 'Sasaran: Ringan 24 jam; Sederhana laporan dalam 24 jam dan 2 hari bekerja; Kritikal serta-merta.' },
      { en: 'Possible negligence: HR links its own discipline case. Never a pay deduction, never automatic.', ms: 'Kemungkinan kecuaian: HR memautkan kes tatatertibnya sendiri. Tidak sekali-kali potongan gaji, tidak automatik.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'Part R R1-R6 (Fauzan, 13-14 Nov 2026; papers in force 18 Nov 2026)' },
    words: 'damaged rosak firearm senjata inspection pemeriksaan repair pembaikan reuse guna semula critical kritikal',
  },
  {
    id: 'security-firearm-monthly',
    app: 'security',
    title: { en: 'Monthly firearm record and vault fire extinguisher', ms: 'Rekod bulanan senjata dan alat pemadam api bilik kebal' },
    purpose: {
      en: 'One record per firearm per month, done before the 28th, and each vault’s fire extinguisher kept in date.',
      ms: 'Satu rekod bagi setiap senjata setiap bulan, dibuat sebelum 28hb, dan alat pemadam api setiap bilik kebal sentiasa dalam tempoh sah.',
    },
    start: { view: 'arms', label: { en: 'Arms control › Arms policies › Monthly firearm record', ms: 'Kawalan senjata › Polisi senjata › Rekod bulanan senjata' } },
    starter: { en: 'The licensed company', ms: 'Syarikat berlesen' },
    steps: [
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'Reminds from the 21st; red after the 28th.', ms: 'Mengingatkan mulai 21hb; merah selepas 28hb.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata', ms: 'Kawalan senjata › Polisi senjata' } },
      },
      {
        who: { en: 'Company duty officer', ms: 'Pegawai bertugas syarikat' },
        does: {
          en: 'Records each firearm: condition (good, needs attention, unusable), “Tiada masalah” as a tick, a photo, and maintenance done with the maintenance form.',
          ms: 'Merekod setiap senjata: keadaan (baik, perlu perhatian, tidak boleh digunakan), “Tiada masalah” sebagai tanda, gambar, dan penyelenggaraan yang dibuat bersama borang penyelenggaraan.',
        },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Rekod bulanan senjata', ms: 'Kawalan senjata › Polisi senjata › Rekod bulanan senjata' } },
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Records each vault’s extinguisher: serial or location, last service, expiry and the certificate copy.', ms: 'Merekod alat pemadam api setiap bilik kebal: nombor siri atau lokasi, servis terakhir, tarikh tamat dan salinan sijil.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Alat pemadam api', ms: 'Kawalan senjata › Polisi senjata › Alat pemadam api' } },
      },
    ],
    rules: [
      { en: 'Typing NA is refused; maintenance done needs the form and a recorded vault extinguisher. The 120-day maintenance check stays.', ms: 'Menaip NA ditolak; penyelenggaraan yang dibuat perlu borang dan alat pemadam api bilik kebal yang direkod. Semakan penyelenggaraan 120 hari kekal.' },
      { en: 'The extinguisher warns 30 days before expiry; it is a safety flag and never blocks an issue.', ms: 'Alat pemadam api memberi amaran 30 hari sebelum tamat; ia bendera keselamatan dan tidak menyekat pengeluaran.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/ARMS_POLICY_PART_V.md', decided: 'Part V V14-V15 (from November 2026)' },
    words: 'monthly bulanan firearm senjata record rekod 28 extinguisher pemadam api vault bilik kebal maintenance penyelenggaraan',
  },
  {
    id: 'security-arms-purchase',
    app: 'security',
    title: { en: 'Buying firearms and ammunition', ms: 'Pembelian senjata api dan peluru' },
    purpose: {
      en: 'A purchase from a licensed dealer, from the internal form and the police pack to receiving and the register.',
      ms: 'Pembelian daripada peniaga berlesen, dari borang dalaman dan pek polis hingga penerimaan dan daftar.',
    },
    start: { view: 'arms', label: { en: 'New arms request (Buy)', ms: 'Permohonan senjata baharu (Beli)' } },
    starter: { en: 'The licensed company', ms: 'Syarikat berlesen' },
    steps: [
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Raises a Buy arms request (see Arms request) and fills the purchase form: holdings against the need; more than the need needs a reason.', ms: 'Membuat permohonan senjata Beli (lihat Permohonan senjata) dan mengisi borang belian: pegangan berbanding keperluan; lebih daripada keperluan perlu sebab.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Belian senjata dan peluru', ms: 'Kawalan senjata › Polisi senjata › Belian senjata dan peluru' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: 'Checks the budget on the pack.', ms: 'Menyemak bajet pada pek.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Bajet (Kewangan)', ms: 'Kawalan senjata › Polisi senjata › Bajet (Kewangan)' } },
        decision: true,
      },
      {
        who: { en: 'Company and Arms Control', ms: 'Syarikat dan Kawalan Senjata' },
        does: { en: 'Sends the complete police pack to the IPD, follows up monthly, and records each police stage.', ms: 'Menghantar pek polis yang lengkap ke IPD, membuat susulan setiap bulan, dan merekod setiap peringkat polis.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Hantar ke IPD', ms: 'Kawalan senjata › Polisi senjata › Hantar ke IPD' } },
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Records the approval letter, then orders from the licensed dealer within the 14-day window.', ms: 'Merekod surat kelulusan, kemudian membuat pesanan daripada peniaga berlesen dalam tempoh 14 hari.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Surat kelulusan', ms: 'Kawalan senjata › Polisi senjata › Surat kelulusan' } },
      },
      {
        who: { en: 'Appointed receiving officer (not the requester)', ms: 'Pegawai penerima yang dilantik (bukan pemohon)' },
        does: { en: 'Receives and counts; a mismatch opens a case and the company manager confirms. Reconciling adds the rounds counted and the new firearms, under inspection before first issue.', ms: 'Menerima dan mengira; ketidaksepadanan membuka kes dan pengurus syarikat mengesahkan. Penyelarasan menambah peluru yang dikira dan senjata baharu, dalam pemeriksaan sebelum pengeluaran pertama.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Terima', ms: 'Kawalan senjata › Polisi senjata › Terima' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Approval letter window 14 days with reminders on day 7 and 10; after day 14 no order, receipt or reconcile.', ms: 'Tempoh surat kelulusan 14 hari dengan peringatan pada hari ke-7 dan ke-10; selepas hari ke-14 tiada pesanan, penerimaan atau penyelarasan.' },
      { en: 'No more than the letter allows. Only licensed dealers.', ms: 'Tidak lebih daripada yang dibenarkan surat. Hanya peniaga berlesen.' },
      { en: 'Ammunition for an A-licence holder goes through this same request.', ms: 'Peluru bagi pemegang Lesen A melalui permohonan yang sama ini.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'Part R R12-R18 (Fauzan, 13-14 Nov 2026), V19' },
    words: 'buy beli purchase pembelian firearm senjata ammunition peluru dealer peniaga ipd police polis approval letter surat kelulusan grn terima',
  },
  {
    id: 'security-vault',
    app: 'security',
    title: { en: 'Vault: application, access and inspection', ms: 'Bilik kebal: permohonan, akses dan pemeriksaan' },
    purpose: {
      en: 'A new vault goes through its application steps before anything is stored; entry is by written authorisation with a witness log.',
      ms: 'Bilik kebal baharu melalui langkah permohonan sebelum apa-apa disimpan; kemasukan dengan kebenaran bertulis dan log saksi.',
    },
    start: { view: 'arms', label: { en: 'Arms control › Arms policies › Vault application', ms: 'Kawalan senjata › Polisi senjata › Permohonan bilik kebal' } },
    starter: { en: 'Arms Control or the licensed company', ms: 'Kawalan Senjata atau syarikat berlesen' },
    steps: [
      {
        who: { en: 'Arms Control or company', ms: 'Kawalan Senjata atau syarikat' },
        does: { en: 'Starts the vault application; the vault is APPLYING and nothing can be placed in or issued from it.', ms: 'Memulakan permohonan bilik kebal; bilik kebal berstatus DALAM PERMOHONAN dan tiada apa boleh disimpan atau dikeluarkan.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Permohonan bilik kebal', ms: 'Kawalan senjata › Polisi senjata › Permohonan bilik kebal' } },
      },
      {
        who: { en: 'Arms Control or company', ms: 'Kawalan Senjata atau syarikat' },
        does: { en: 'Records each step with its document: council, IPD, inspections, support, approval, access list, active.', ms: 'Merekod setiap langkah dengan dokumennya: majlis tempatan, IPD, pemeriksaan, sokongan, kelulusan, senarai akses, aktif.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Langkah', ms: 'Kawalan senjata › Polisi senjata › Langkah' } },
      },
      {
        who: { en: 'Authoriser (never themselves)', ms: 'Pemberi kuasa (bukan diri sendiri)' },
        does: { en: 'Gives access by written authorisation; each entry is logged with a witness.', ms: 'Memberi akses melalui kebenaran bertulis; setiap kemasukan dilog bersama saksi.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Kebenaran akses', ms: 'Kawalan senjata › Polisi senjata › Kebenaran akses' } },
        decision: true,
      },
      {
        who: { en: 'Arms Control', ms: 'Kawalan Senjata' },
        does: { en: 'Inspects the vault with corrective actions (owner and date); a change that needs it goes with police approval.', ms: 'Memeriksa bilik kebal dengan tindakan pembetulan (pemilik dan tarikh); perubahan yang memerlukannya disertai kelulusan polis.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Pemeriksaan bilik kebal', ms: 'Kawalan senjata › Polisi senjata › Pemeriksaan bilik kebal' } },
      },
    ],
    rules: [
      { en: 'An entry by someone not on the access list opens a P1 case.', ms: 'Kemasukan oleh orang yang tiada dalam senarai akses membuka kes P1.' },
      { en: 'The A licence holder and the Amra need valid licences, or the vault blocks issues.', ms: 'Pemegang Lesen A dan Amra perlu lesen yang sah, atau bilik kebal menyekat pengeluaran.' },
      { en: 'No second vault with the same police approval number.', ms: 'Tiada bilik kebal kedua dengan nombor kelulusan polis yang sama.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'Part R R9-R11 (Fauzan, 13-14 Nov 2026), V16' },
    words: 'vault bilik kebal armoury application permohonan access akses witness saksi inspection pemeriksaan',
  },
  {
    id: 'security-arms-licence',
    app: 'security',
    title: { en: "Staff arms licence application and renewal", ms: 'Permohonan dan pembaharuan lesen senjata kakitangan' },
    purpose: {
      en: 'An arms licence for a staff member (Pelesen A, AMRA, CNU, bodyguard) from HR eligibility to the licence book, and renewals due.',
      ms: 'Lesen senjata bagi kakitangan (Pelesen A, AMRA, CNU, pengawal peribadi) dari kelayakan HR hingga buku lesen, dan pembaharuan yang tiba.',
    },
    start: { view: 'arms', label: { en: 'Arms control › Arms policies › Licence application', ms: 'Kawalan senjata › Polisi senjata › Permohonan lesen' } },
    starter: { en: 'Arms Control or the licensed company', ms: 'Kawalan Senjata atau syarikat berlesen' },
    steps: [
      {
        who: { en: 'Arms Control or company', ms: 'Kawalan Senjata atau syarikat' },
        does: { en: 'Opens the application (new or renewal) for the staff member and the licence category.', ms: 'Membuka permohonan (baharu atau pembaharuan) bagi kakitangan dan kategori lesen.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Permohonan lesen', ms: 'Kawalan senjata › Polisi senjata › Permohonan lesen' } },
      },
      {
        who: { en: 'HR; Administration Manager (not the preparer)', ms: 'HR; Pengurus Pentadbiran (bukan penyedia)' },
        does: { en: 'HR eligibility, restricted record and drug check, need and documents; the Administration Manager checks; a support letter.', ms: 'Kelayakan HR, semakan rekod terhad dan dadah, keperluan dan dokumen; Pengurus Pentadbiran menyemak; surat sokongan.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Langkah', ms: 'Kawalan senjata › Polisi senjata › Langkah' } },
        decision: true,
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Submits to the police and records each police stage (thumbprint, biometric, eligibility, investigation, interview), the decision and the licence book dates.', ms: 'Menghantar kepada polis dan merekod setiap peringkat polis (cap jari, biometrik, kelayakan, siasatan, temu duga), keputusan dan tarikh buku lesen.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Langkah', ms: 'Kawalan senjata › Polisi senjata › Langkah' } },
      },
      {
        who: { en: 'Police', ms: 'Polis' },
        does: { en: 'Decides; a refusal may be appealed.', ms: 'Memutuskan; penolakan boleh dirayu.' },
        outside: true,
        decision: true,
      },
    ],
    rules: [
      { en: 'Licence dates come from the book; there is no default length. Licence renewals are reminded 90 days ahead.', ms: 'Tarikh lesen diambil dari buku; tiada tempoh lalai. Pembaharuan lesen diingatkan 90 hari lebih awal.' },
      { en: 'Police times are “expected” and flagged, never a block.', ms: 'Masa polis adalah “dijangka” dan ditanda, tidak sekali-kali menyekat.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'Part R R7-R8 (Fauzan, 13-14 Nov 2026)' },
    words: 'licence lesen arms senjata pelesen a amra cnu bodyguard renewal pembaharuan police polis application permohonan',
  },
  {
    id: 'security-jackets',
    app: 'security',
    title: { en: 'Bulletproof jackets', ms: 'Jaket kalis peluru' },
    purpose: {
      en: 'Bulletproof jackets owned by Goodwill Empire: register, buy, receive, issue, return, inspect and report loss.',
      ms: 'Jaket kalis peluru milik Goodwill Empire: daftar, beli, terima, keluarkan, pulangkan, periksa dan lapor kehilangan.',
    },
    start: { view: 'arms', label: { en: 'Arms control › Arms policies › Jackets', ms: 'Kawalan senjata › Polisi senjata › Jaket' } },
    starter: { en: 'Arms Control, the company, or the store team', ms: 'Kawalan Senjata, syarikat, atau pasukan stor' },
    steps: [
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Asks for jackets with the need, specification and three quotes.', ms: 'Memohon jaket dengan keperluan, spesifikasi dan tiga sebut harga.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Mohon jaket', ms: 'Kawalan senjata › Polisi senjata › Mohon jaket' } },
      },
      {
        who: { en: 'Store team or Arms Control', ms: 'Pasukan stor atau Kawalan Senjata' },
        does: { en: 'Receives the jackets and registers each one (serial, maker, level, warranty).', ms: 'Menerima jaket dan mendaftar setiap satu (siri, pembuat, tahap, waranti).' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Terima jaket', ms: 'Kawalan senjata › Polisi senjata › Terima jaket' } },
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Issues and takes back each jacket with the guard’s confirmation and a signed slip photo; a handover between guards records both.', ms: 'Mengeluarkan dan menerima semula setiap jaket dengan pengesahan pengawal dan gambar slip bertandatangan; serahan antara pengawal merekod kedua-duanya.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Rekod', ms: 'Kawalan senjata › Polisi senjata › Rekod' } },
      },
      {
        who: { en: 'Inspector; someone else decides quarantine', ms: 'Pemeriksa; orang lain memutuskan kuarantin' },
        does: { en: 'Inspects; a quarantined jacket is decided (reuse, replace, dispose, maker repair) by another person.', ms: 'Memeriksa; jaket yang dikuarantin diputuskan (guna semula, ganti, lupus, baiki oleh pembuat) oleh orang lain.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Rekod', ms: 'Kawalan senjata › Polisi senjata › Rekod' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Never guard to guard without a recorded handover.', ms: 'Tidak sekali-kali dari pengawal ke pengawal tanpa serahan yang direkod.' },
      { en: 'Price alone cannot win; a quote with no product documents cannot win; split purchases are warned.', ms: 'Harga sahaja tidak boleh menang; sebut harga tanpa dokumen produk tidak boleh menang; pembelian berpecah diberi amaran.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'Part R R19-R22 (Fauzan, R-X7, R-X8)' },
    words: 'jacket jaket bulletproof kalis peluru vest goodwill issue keluarkan inspection pemeriksaan quarantine kuarantin',
  },
  {
    id: 'security-arms-trading',
    app: 'security',
    title: { en: 'Arms trading and import', ms: 'Dagangan dan import senjata' },
    purpose: {
      en: 'Buying stock, selling and importing arms under a dealer licence. Built and switched off.',
      ms: 'Membeli stok, menjual dan mengimport senjata di bawah lesen peniaga. Telah dibina dan ditutup.',
    },
    start: { view: 'arms', tab: 'trading', label: { en: 'Arms control › Trading', ms: 'Kawalan senjata › Dagangan' } },
    starter: { en: 'Arms Control, once the CEO switches it on', ms: 'Kawalan Senjata, selepas CEO menghidupkannya' },
    steps: [
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Prepares the dealer licence application; the issued licence is recorded with its number, place of business and copy.', ms: 'Menyediakan permohonan lesen peniaga; lesen yang dikeluarkan direkod dengan nombor, tempat perniagaan dan salinan.' },
        where: { view: 'arms', label: { en: 'Arms control › Polisi senjata › Permohonan lesen peniaga', ms: 'Kawalan senjata › Polisi senjata › Permohonan lesen peniaga' } },
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: { en: 'Switches trading on with a reason naming the approved licence number.', ms: 'Menghidupkan dagangan dengan sebab yang menamakan nombor lesen yang diluluskan.' },
        where: { view: 'arms', tab: 'trading', label: { en: 'Arms control › Trading', ms: 'Kawalan senjata › Dagangan' } },
        decision: true,
      },
      {
        who: { en: 'Arms Control', ms: 'Kawalan Senjata' },
        does: { en: 'Import: CPO licence, then KDN approval, then customs notice, shipping (Port Klang or KLIA), arrival, declaration and the endorsed licence back within 3 days.', ms: 'Import: lesen CPO, kemudian kelulusan KDN, kemudian notis kastam, penghantaran (Pelabuhan Klang atau KLIA), ketibaan, pengisytiharan dan lesen yang diendors dipulangkan dalam 3 hari.' },
        where: { view: 'arms', tab: 'trading', label: { en: 'Arms control › Trading', ms: 'Kawalan senjata › Dagangan' } },
      },
    ],
    rules: [
      { en: 'While off, every trading request or step is refused and logged.', ms: 'Semasa ditutup, setiap permohonan atau langkah dagangan ditolak dan dilog.' },
      { en: 'A sale needs the buyer’s licence, police approval and end-user certificate on file.', ms: 'Jualan memerlukan lesen pembeli, kelulusan polis dan sijil pengguna akhir dalam fail.' },
      { en: 'Trade stock has its own store with its own police approval; sharing an operational vault stays off.', ms: 'Stok dagangan mempunyai stor sendiri dengan kelulusan polis sendiri; berkongsi bilik kebal operasi kekal ditutup.' },
    ],
    status: 'off',
    statusNote: { en: 'Off until a dealer licence is approved and the CEO switches it on.', ms: 'Ditutup sehingga lesen peniaga diluluskan dan CEO menghidupkannya.' },
    source: { doc: 'docs/SPECIAL_OPS_PHASE4.md', decided: 'Fauzan, 2 Nov 2026 (slice 4H) and Part R R28-R31' },
    words: 'trading dagangan import dealer peniaga licence lesen cpo kdn customs kastam port pelabuhan',
  },

  // ---------------------------------------------------------------- Security: CMS
  {
    id: 'security-cms-shift',
    app: 'security',
    title: { en: 'CMS shift: roster, clock-in and handover', ms: 'Syif CMS: roster, daftar masuk dan serah tugas' },
    purpose: {
      en: 'Every CMS shift has 1 Head Control and 1 Monitor Officer; the Head Control hands the desk over in writing to the next.',
      ms: 'Setiap syif CMS mempunyai 1 Ketua Kawalan dan 1 Pegawai Pemantau; Ketua Kawalan menyerahkan meja secara bertulis kepada yang seterusnya.',
    },
    start: { view: 'cms', tab: 'roster', label: { en: 'CMS › Roster › Plan next week', ms: 'CMS › Roster › Rancang minggu depan' } },
    starter: { en: 'Arms Control plans the roster', ms: 'Kawalan Senjata merancang roster' },
    steps: [
      {
        who: { en: 'Arms Control', ms: 'Kawalan Senjata' },
        does: { en: 'Plans the roster (Plan next week) and sets the CMS settings within approved limits.', ms: 'Merancang roster (Rancang minggu depan) dan menetapkan tetapan CMS dalam had yang diluluskan.' },
        where: { view: 'cms', tab: 'roster', label: { en: 'CMS › Roster', ms: 'CMS › Roster' } },
      },
      {
        who: { en: 'CMS operator', ms: 'Operator CMS' },
        does: { en: 'Clocks in to their own seat with their own Prima account.', ms: 'Daftar masuk ke tempat duduk sendiri dengan akaun Prima sendiri.' },
        where: { view: 'cms', tab: 'now', label: { en: 'CMS › Now › My seat', ms: 'CMS › Sekarang › Tempat saya' } },
      },
      {
        who: { en: 'Outgoing Head Control', ms: 'Ketua Kawalan yang keluar' },
        does: { en: 'Writes the handover in the last hour of the shift; Prima adds what is still open.', ms: 'Menulis serah tugas dalam jam terakhir syif; Prima menambah apa yang masih terbuka.' },
        where: { view: 'cms', tab: 'now', label: { en: 'CMS › Now › Write handover', ms: 'CMS › Sekarang › Tulis serah tugas' } },
      },
      {
        who: { en: 'Incoming Head Control', ms: 'Ketua Kawalan yang masuk' },
        does: { en: 'Clocked in, takes the handover from 30 minutes before the shift; “not agreed” is allowed with a reason and raised for Arms Control.', ms: 'Selepas daftar masuk, mengambil serah tugas mulai 30 minit sebelum syif; “tidak bersetuju” dibenarkan dengan sebab dan dibangkitkan kepada Kawalan Senjata.' },
        where: { view: 'cms', tab: 'now', label: { en: 'CMS › Now › Take the handover', ms: 'CMS › Sekarang › Ambil serah tugas' } },
        decision: true,
      },
      {
        who: { en: 'Arms Control; HR (view only)', ms: 'Kawalan Senjata; HR (lihat sahaja)' },
        does: { en: 'See each person’s month: seats, hours, late in, left early, no clock-out, missed.', ms: 'Melihat bulan setiap orang: tempat duduk, jam, lewat masuk, keluar awal, tiada daftar keluar, terlepas.' },
        where: { view: 'cms', tab: 'staff', label: { en: 'CMS › Staff', ms: 'CMS › Kakitangan' } },
      },
    ],
    rules: [
      { en: 'At most 12 hours in a row and 6 days in a row; rest between stretches is a CMS setting (1 to 24 hours, 8 to start). Nobody on a seat during approved leave.', ms: 'Paling lama 12 jam berturut-turut dan 6 hari berturut-turut; rehat antara giliran ialah tetapan CMS (1 hingga 24 jam, bermula 8). Tiada sesiapa di tempat duduk semasa cuti yang diluluskan.' },
      { en: 'Head Control cannot clock out until the next Head Control has taken the handover; leaving more than 15 minutes early needs a reason.', ms: 'Ketua Kawalan tidak boleh daftar keluar sehingga Ketua Kawalan seterusnya mengambil serah tugas; keluar lebih 15 minit awal perlu sebab.' },
      { en: 'Nobody takes a handover from themselves. Someone with no linked account can be rostered but cannot clock in.', ms: 'Tiada sesiapa mengambil serah tugas daripada diri sendiri. Orang tanpa akaun terpaut boleh dirosterkan tetapi tidak boleh daftar masuk.' },
    ],
    status: 'in_force',
    statusNote: { en: 'Until the CMS app runs on the in-house server, the handover is done on Prima’s CMS board.', ms: 'Sehingga aplikasi CMS berjalan di pelayan dalaman, serah tugas dibuat di papan CMS Prima.' },
    source: { doc: 'docs/CMS_ROSTER_AND_HANDOVER.md', decided: 'Fauzan, 25 Oct and 5 Nov 2026' },
    words: 'cms roster shift syif head control ketua kawalan monitor officer handover serah tugas clock in daftar masuk seat',
  },
  {
    id: 'security-cms-alarm',
    app: 'security',
    title: { en: 'CMS: emergencies, alarms and missed calls', ms: 'CMS: kecemasan, penggera dan panggilan terlepas' },
    purpose: {
      en: 'CMS acknowledges every emergency and alarm, has a second person agree each false alarm, and calls back missed company calls. CMS monitors and escalates; the company decides.',
      ms: 'CMS mengakui setiap kecemasan dan penggera, orang kedua bersetuju bagi setiap penggera palsu, dan membuat panggilan balik bagi panggilan syarikat yang terlepas. CMS memantau dan mengeskalasi; syarikat memutuskan.',
    },
    start: { view: 'cms', tab: 'emergencies', label: { en: 'CMS › Emergencies and incidents', ms: 'CMS › Kecemasan dan insiden' } },
    starter: { en: 'CMS operators on shift', ms: 'Operator CMS yang bertugas' },
    steps: [
      {
        who: { en: 'CMS operator', ms: 'Operator CMS' },
        does: { en: 'Acknowledges the emergency or alarm in time, checks the camera and calls the guard, then closes it.', ms: 'Mengakui kecemasan atau penggera dalam masa, menyemak kamera dan menelefon pengawal, kemudian menutupnya.' },
        where: { view: 'cms', tab: 'emergencies', label: { en: 'CMS › Emergencies and incidents', ms: 'CMS › Kecemasan dan insiden' } },
      },
      {
        who: { en: 'Head Control (second person)', ms: 'Ketua Kawalan (orang kedua)' },
        does: { en: 'Reviews every false alarm: “Agree, false” or “It was real” (which opens the incident for the company).', ms: 'Menyemak setiap penggera palsu: “Setuju, palsu” atau “Ia benar” (yang membuka insiden untuk syarikat).' },
        where: { view: 'cms', tab: 'emergencies', label: { en: 'CMS › False alarms for Head Control to review', ms: 'CMS › Penggera palsu untuk semakan Ketua Kawalan' } },
        decision: true,
      },
      {
        who: { en: 'CMS operator', ms: 'Operator CMS' },
        does: { en: 'Calls back each missed company call forwarded to CMS and marks it Called back.', ms: 'Membuat panggilan balik bagi setiap panggilan syarikat yang terlepas dan dipindahkan ke CMS, dan menanda Telah dihubungi.' },
        where: { view: 'cms', tab: 'phones', label: { en: 'CMS › Phone desk', ms: 'CMS › Meja telefon' } },
      },
      {
        who: { en: 'CMS operator', ms: 'Operator CMS' },
        does: { en: 'Watches attendance alerts to the PIC and may call the guard; the company does the rest.', ms: 'Memantau amaran kehadiran kepada PIC dan boleh menelefon pengawal; syarikat melakukan selebihnya.' },
        where: { view: 'cms', tab: 'sites', label: { en: 'CMS › Sites', ms: 'CMS › Tapak' } },
      },
    ],
    rules: [
      { en: 'A call not answered at the company extension forwards to CMS after 20 seconds (proposed).', ms: 'Panggilan yang tidak dijawab di sambungan syarikat dipindahkan ke CMS selepas 20 saat (cadangan).' },
      { en: 'Arms alerts are on the Arms control board.', ms: 'Amaran senjata berada di papan Kawalan senjata.' },
    ],
    status: 'in_force',
    statusNote: { en: 'CCTV, alarm, door and vehicle feeds are not connected yet and show as Unknown.', ms: 'Suapan CCTV, penggera, pintu dan kenderaan belum disambung dan dipaparkan sebagai Tidak diketahui.' },
    source: { doc: 'docs/system/04-workflows.md', decided: 'W19; rule CMS-PHONE (Fauzan, 25 Oct 2026)' },
    words: 'cms alarm penggera emergency kecemasan false alarm penggera palsu acknowledge akui call back panggilan balik ip phone',
  },
  {
    id: 'security-cms-dispatch',
    app: 'security',
    title: { en: 'CMS message to a site device', ms: 'Mesej CMS ke peranti tapak' },
    purpose: {
      en: 'CMS sends an instruction, alert or urgent alert to a site’s shared device; the guard takes it and sends photo or video proof; CMS closes it.',
      ms: 'CMS menghantar arahan, amaran atau amaran segera ke peranti bersama tapak; pengawal menerimanya dan menghantar bukti gambar atau video; CMS menutupnya.',
    },
    start: { view: 'cms', tab: 'devices', label: { en: 'CMS › Site devices', ms: 'CMS › Peranti tapak' } },
    starter: { en: 'The CMS desk for that company', ms: 'Meja CMS bagi syarikat itu' },
    steps: [
      {
        who: { en: 'CMS desk', ms: 'Meja CMS' },
        does: { en: 'Sends the message, on its own or following an alarm or a camera or sensor detection (never proof by itself), and says what proof it needs.', ms: 'Menghantar mesej, sendiri atau susulan penggera atau pengesanan kamera atau sensor (tidak sekali-kali bukti dengan sendirinya), dan menyatakan bukti yang diperlukan.' },
        where: { view: 'cms', tab: 'devices', label: { en: 'CMS › Site devices', ms: 'CMS › Peranti tapak' } },
      },
      {
        who: { en: 'Guard', ms: 'Pengawal' },
        does: { en: 'Takes the message on the site device with staff number and PIN, then sends a photo or a clip up to 30 seconds.', ms: 'Menerima mesej di peranti tapak dengan nombor staf dan PIN, kemudian menghantar gambar atau klip sehingga 30 saat.' },
        where: { view: 'device', label: { en: 'Site device', ms: 'Peranti tapak' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: { en: 'A late message shows on CMS “Now” for the operator to phone the guard or the site officer.', ms: 'Mesej yang lewat dipaparkan di CMS “Sekarang” untuk operator menelefon pengawal atau pegawai tapak.' },
        where: { view: 'cms', tab: 'now', label: { en: 'CMS › Now', ms: 'CMS › Sekarang' } },
      },
      {
        who: { en: 'CMS desk', ms: 'Meja CMS' },
        does: { en: 'Reviews the proof and closes: Real (opens the company’s case, P1 for urgent, P2 otherwise), Nothing found, Done (instructions) or Withdrawn (with a reason).', ms: 'Menyemak bukti dan menutup: Benar (membuka kes syarikat, P1 bagi segera, P2 selainnya), Tiada apa-apa, Selesai (arahan) atau Ditarik balik (dengan sebab).' },
        where: { view: 'cms', tab: 'devices', label: { en: 'CMS › Site devices › Open messages', ms: 'CMS › Peranti tapak › Mesej terbuka' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Taken within 60 seconds (urgent), 3 minutes (alert) or 15 minutes (instruction); proof within 5, 15 or 60 minutes after taking.', ms: 'Diterima dalam 60 saat (segera), 3 minit (amaran) atau 15 minit (arahan); bukti dalam 5, 15 atau 60 minit selepas diterima.' },
      { en: 'Proof gets the server’s time, the site geofence check and a fingerprint. “Nothing found” closes the alarm as false, so Head Control still reviews it.', ms: 'Bukti menggunakan masa pelayan, semakan geofence tapak dan cap jari digital. “Tiada apa-apa” menutup penggera sebagai palsu, jadi Ketua Kawalan masih menyemaknya.' },
    ],
    status: 'in_force',
    statusNote: { en: 'Every time limit in rule CMS-DISPATCH is a proposal; the bodycam link is a mock until a brand is chosen.', ms: 'Setiap had masa dalam peraturan CMS-DISPATCH ialah cadangan; pautan kamera badan masih olok-olok sehingga jenama dipilih.' },
    source: { doc: 'docs/SITE_DEVICE_DUTY.md', decided: 'Fauzan, 6 Nov 2026 (section 1)' },
    words: 'cms message mesej dispatch site device peranti tapak instruction arahan alert amaran urgent segera proof bukti video',
  },
  {
    id: 'security-site-gate',
    app: 'security',
    title: { en: 'Post log, visitors and vehicles on the site device', ms: 'Log pos, pelawat dan kenderaan di peranti tapak' },
    purpose: {
      en: 'The guard keeps the post log (occurrence book) and the gate record of visitors and vehicles on the site’s shared device, even with no signal.',
      ms: 'Pengawal menyimpan log pos (buku kejadian) dan rekod pintu pagar pelawat dan kenderaan di peranti bersama tapak, walaupun tanpa liputan.',
    },
    start: { view: 'device', label: { en: 'Site device › Visitor or vehicle in', ms: 'Peranti tapak › Pelawat atau kenderaan masuk' } },
    starter: { en: 'The guard on duty at the post', ms: 'Pengawal yang bertugas di pos' },
    steps: [
      {
        who: { en: 'Guard', ms: 'Pengawal' },
        does: { en: 'Writes each post log line, signed with staff number and PIN. Lines are never edited; a correction is a new line.', ms: 'Menulis setiap baris log pos, ditandatangani dengan nombor staf dan PIN. Baris tidak diubah; pembetulan ialah baris baharu.' },
        where: { view: 'device', label: { en: 'Site device › Write in post log', ms: 'Peranti tapak › Tulis dalam log pos' } },
      },
      {
        who: { en: 'Guard', ms: 'Pengawal' },
        does: { en: 'Records each visitor (IC or licence photo, face check, host and purpose, stamped photo) or vehicle (plate checked against the site list), and signs them out.', ms: 'Merekod setiap pelawat (gambar IC atau lesen, semakan muka, tuan rumah dan tujuan, gambar bercop) atau kenderaan (nombor plat disemak dengan senarai tapak), dan mendaftar keluar mereka.' },
        where: { view: 'device', label: { en: 'Site device › Visitor or vehicle in', ms: 'Peranti tapak › Pelawat atau kenderaan masuk' } },
      },
      {
        who: { en: 'Prima; guard', ms: 'Prima; pengawal' },
        does: { en: 'A plate on watch raises an alarm to CMS; offline, the device tells the guard to phone CMS and not let it in.', ms: 'Nombor plat dalam pemerhatian mencetuskan penggera ke CMS; jika luar talian, peranti mengarahkan pengawal menelefon CMS dan tidak membenarkannya masuk.' },
        where: { view: 'cms', tab: 'emergencies', label: { en: 'CMS › Emergencies and incidents', ms: 'CMS › Kecemasan dan insiden' } },
      },
      {
        who: { en: 'Company; CMS', ms: 'Syarikat; CMS' },
        does: { en: 'The company sees the duty log in the site drawer; CMS sees it under Site devices.', ms: 'Syarikat melihat log tugas dalam laci tapak; CMS melihatnya di bawah Peranti tapak.' },
        where: { view: 'sites', label: { en: 'Sites › a site › Duty log', ms: 'Tapak › satu tapak › Log tugas' } },
      },
    ],
    rules: [
      { en: 'Prima never opens or closes a gate; it records and warns.', ms: 'Prima tidak sekali-kali membuka atau menutup pagar; ia merekod dan memberi amaran.' },
      { en: 'The full ID and card picture are sealed for the company’s in-house server; screens show only the last 4 characters. Visitor records are kept 7 years.', ms: 'ID penuh dan gambar kad dimeterai untuk pelayan dalaman syarikat; skrin hanya memaparkan 4 aksara terakhir. Rekod pelawat disimpan 7 tahun.' },
      { en: 'Where a site gives only a written book, the guard photographs the pages (up to 10 per upload).', ms: 'Jika tapak hanya menyediakan buku bertulis, pengawal mengambil gambar halaman (sehingga 10 setiap muat naik).' },
    ],
    status: 'in_force',
    statusNote: { en: 'The in-house server is not built: until its key is set the device warns that the full ID cannot be kept and refuses book-page uploads. The IC and plate readers are typed or photo for now.', ms: 'Pelayan dalaman belum dibina: sehingga kuncinya ditetapkan, peranti memberi amaran bahawa ID penuh tidak dapat disimpan dan menolak muat naik halaman buku. Pembaca IC dan nombor plat buat masa ini secara taip atau gambar.' },
    source: { doc: 'docs/SITE_DEVICE_DUTY.md', decided: 'Fauzan, 6 Nov 2026 (sections 2-4; rule SITE-GATE)' },
    words: 'post log log pos occurrence book buku kejadian visitor pelawat vehicle kenderaan plate plat gate pagar ic',
  },
  {
    id: 'security-cms-readiness',
    app: 'security',
    title: { en: 'CMS site readiness', ms: 'Kesediaan tapak untuk CMS' },
    purpose: {
      en: 'Each site’s devices and preparations are recorded, then Arms Control checks them before the site is ready to connect to CMS.',
      ms: 'Peranti dan persediaan setiap tapak direkod, kemudian Kawalan Senjata menyemaknya sebelum tapak sedia untuk disambung ke CMS.',
    },
    start: { view: 'cmsready', label: { en: 'CMS site readiness › Add device', ms: 'Kesediaan tapak CMS › Tambah peranti' } },
    starter: { en: 'Company manager, admin executive or site supervisor (own sites)', ms: 'Pengurus syarikat, eksekutif admin atau penyelia tapak (tapak sendiri)' },
    steps: [
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Records each device (kind, brand and model as the client chose, owner, vendor contact, the vendor’s answer on sharing events).', ms: 'Merekod setiap peranti (jenis, jenama dan model pilihan pelanggan, pemilik, hubungan vendor, jawapan vendor tentang perkongsian peristiwa).' },
        where: { view: 'cmsready', label: { en: 'CMS site readiness › site › Devices', ms: 'Kesediaan tapak CMS › tapak › Peranti' } },
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Answers each preparation yes, no or not known: site survey, client’s written agreement, CCTV signs, internet, backup power, time sync, admin login holder.', ms: 'Menjawab setiap persediaan ya, tidak atau belum diketahui: tinjauan tapak, persetujuan bertulis pelanggan, papan tanda CCTV, internet, kuasa sandaran, penyegerakan masa, pemegang log masuk admin.' },
        where: { view: 'cmsready', label: { en: 'CMS site readiness › site › Preparations', ms: 'Kesediaan tapak CMS › tapak › Persediaan' } },
      },
      {
        who: { en: 'Arms Control (with a grant) or the CEO', ms: 'Kawalan Senjata (dengan kebenaran) atau CEO' },
        does: { en: 'Passes or returns with what to fix, always with a reason.', ms: 'Meluluskan atau memulangkan dengan perkara yang perlu dibaiki, sentiasa dengan sebab.' },
        where: { view: 'cmsready', label: { en: 'CMS site readiness › site › Check', ms: 'Kesediaan tapak CMS › tapak › Semakan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Prima never picks, recommends or limits a brand. A vendor that says “cannot link” makes the site Needs fixing; ask for an API or a gateway.', ms: 'Prima tidak sekali-kali memilih, mencadangkan atau menghadkan jenama. Vendor yang menyatakan “tidak boleh dipautkan” menjadikan tapak Perlu dibaiki; minta API atau gerbang.' },
      { en: 'Not known never counts as done. Text that looks like a password, PIN or code is refused.', ms: 'Belum diketahui tidak sekali-kali dikira selesai. Teks yang kelihatan seperti kata laluan, PIN atau kod ditolak.' },
      { en: 'Nobody who recorded any part may check it; any later change voids the check.', ms: 'Sesiapa yang merekod mana-mana bahagian tidak boleh menyemaknya; sebarang perubahan kemudian membatalkan semakan.' },
    ],
    status: 'in_force',
    statusNote: { en: '“Ready to connect” is never a connection: device links come later, so Connected stays 0.', ms: '“Sedia untuk disambung” bukan sambungan: pautan peranti akan datang kemudian, jadi Disambung kekal 0.' },
    source: { doc: 'docs/CMS_SITE_READINESS.md', decided: 'Fauzan, 5 Nov 2026 (audit decision 4)' },
    words: 'cms readiness kesediaan cctv device peranti brand jenama alarm penggera vendor site tapak connect sambung',
  },
  {
    id: 'security-cms-commissioning',
    app: 'security',
    title: { en: 'CMS commissioning for a contract', ms: 'Pentauliahan CMS bagi kontrak' },
    purpose: {
      en: 'Before CMS takes on a contract’s signed service, operators test every call-out contact and service, and Arms Control accepts it.',
      ms: 'Sebelum CMS mengambil perkhidmatan yang ditandatangani dalam kontrak, operator menguji setiap kenalan panggilan dan perkhidmatan, dan Kawalan Senjata menerimanya.',
    },
    start: { view: 'cms', tab: 'commissioning', label: { en: 'CMS › Commissioning', ms: 'CMS › Pentauliahan' } },
    starter: { en: 'The company records the signed CMS scope on the contract', ms: 'Syarikat merekod skop CMS yang ditandatangani pada kontrak' },
    steps: [
      {
        who: { en: 'Company manager', ms: 'Pengurus syarikat' },
        does: { en: 'Records the signed CMS service scope on the contract.', ms: 'Merekod skop perkhidmatan CMS yang ditandatangani pada kontrak.' },
        where: { view: 'contracts', label: { en: 'Contracts › CMS service', ms: 'Kontrak › Perkhidmatan CMS' } },
      },
      {
        who: { en: 'CMS operator', ms: 'Operator CMS' },
        does: { en: 'Verifies each call-out contact by a test call (Mark verified) and records a test of each signed service at each site.', ms: 'Mengesahkan setiap kenalan panggilan melalui panggilan ujian (Tanda disahkan) dan merekod ujian bagi setiap perkhidmatan yang ditandatangani di setiap tapak.' },
        where: { view: 'cms', tab: 'commissioning', label: { en: 'CMS › Commissioning', ms: 'CMS › Pentauliahan' } },
      },
      {
        who: { en: 'Arms Control', ms: 'Kawalan Senjata' },
        does: { en: 'Accepts for CMS once every contact is verified and the sites are linked.', ms: 'Menerima untuk CMS setelah setiap kenalan disahkan dan tapak dipautkan.' },
        where: { view: 'cms', tab: 'commissioning', label: { en: 'CMS › Commissioning › Accept for CMS', ms: 'CMS › Pentauliahan › Terima untuk CMS' } },
        decision: true,
      },
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Records the client’s acceptance on the contract.', ms: 'Merekod penerimaan pelanggan pada kontrak.' },
        where: { view: 'contracts', label: { en: 'Contracts › CMS service', ms: 'Kontrak › Perkhidmatan CMS' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Attendance and patrol run in the JA app, so the operator attests them; CCTV and alarm tests are checked against Prima’s records.', ms: 'Kehadiran dan rondaan berjalan dalam aplikasi JA, jadi operator mengesahkannya; ujian CCTV dan penggera disemak berbanding rekod Prima.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'W19 step 4; W5 (CMS activation)' },
    words: 'cms commissioning pentauliahan contract kontrak call-out test call panggilan ujian accept terima',
  },
  {
    id: 'security-guard-phone',
    app: 'security',
    title: { en: 'Guards on their own phones', ms: 'Pengawal menggunakan telefon sendiri' },
    purpose: {
      en: 'A guard signs in on their own enrolled phone with PIN and face, with live patrol location, a heartbeat to CMS and an SOS button. Built, switched off.',
      ms: 'Pengawal log masuk di telefon sendiri yang didaftarkan dengan PIN dan muka, dengan lokasi rondaan langsung, isyarat hayat ke CMS dan butang SOS. Telah dibina, ditutup.',
    },
    start: { view: 'people', label: { en: 'Guards › person › PIN and Prima access › Enrol phone', ms: 'Pengawal › orang › PIN dan akses Prima › Daftar telefon' } },
    starter: { en: 'The company office or HR (the people who set PINs)', ms: 'Pejabat syarikat atau HR (yang menetapkan PIN)' },
    steps: [
      {
        who: { en: 'Company office or HR', ms: 'Pejabat syarikat atau HR' },
        does: { en: 'Sets the PIN and presses Enrol phone: a one-time code valid 24 hours and a link.', ms: 'Menetapkan PIN dan tekan Daftar telefon: kod sekali guna sah 24 jam dan pautan.' },
        where: { view: 'people', label: { en: 'Guards › person › PIN and Prima access', ms: 'Pengawal › orang › PIN dan akses Prima' } },
      },
      {
        who: { en: 'Guard; HR', ms: 'Pengawal; HR' },
        does: { en: 'The guard opens the link, types the staff number, then the PIN and one face photo; HR approves the face.', ms: 'Pengawal membuka pautan, menaip nombor staf, kemudian PIN dan satu gambar muka; HR meluluskan muka.' },
        decision: true,
      },
      {
        who: { en: 'Guard; CMS', ms: 'Pengawal; CMS' },
        does: { en: 'Signs in with the phone, PIN and face. On duty the phone sends a heartbeat every 60 seconds; CMS sees it live, late or offline.', ms: 'Log masuk dengan telefon, PIN dan muka. Semasa bertugas telefon menghantar isyarat hayat setiap 60 saat; CMS melihatnya aktif, lewat atau luar talian.' },
        where: { view: 'cms', tab: 'guardphones', label: { en: 'CMS › Guard phones', ms: 'CMS › Telefon pengawal' } },
      },
    ],
    rules: [
      { en: 'Never the PIN alone; five wrong tries lock the phone for 30 minutes. One active phone per guard.', ms: 'Tidak sekali-kali PIN sahaja; lima cubaan salah mengunci telefon selama 30 minit. Satu telefon aktif bagi setiap pengawal.' },
      { en: 'Location only on duty (30 minutes either side of the shift). SOS needs only the enrolled phone.', ms: 'Lokasi hanya semasa bertugas (30 minit sebelum dan selepas syif). SOS hanya memerlukan telefon yang didaftarkan.' },
    ],
    status: 'off',
    statusNote: { en: 'Off until the owner turns GUARD_PHONE on; guards stay on the JA app for now. Most numbers are proposals.', ms: 'Ditutup sehingga pemilik menghidupkan GUARD_PHONE; pengawal kekal menggunakan aplikasi JA buat masa ini. Kebanyakan angka masih cadangan.' },
    source: { doc: 'docs/GUARD_PHONE.md', decided: 'Fauzan, 3 and 5 Nov 2026' },
    words: 'guard phone telefon pengawal enrol daftar pin face muka sos heartbeat location lokasi',
  },
];

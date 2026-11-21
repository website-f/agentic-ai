import type { Sop } from '../types';

/**
 * P121: Compliance (app 'gov') and Management (app 'board'), plus the everyday work screens (Work, Meetings, Memos,
 * Reports, Company today), filed under 'board'. Written from Fauzan's documents: ACT_DEPARTMENT, QUALITY_AND_COMPLIANCE,
 * GOVERNANCE_REGISTERS, CENTRAL_ADMIN_PHASE5, COMPANY_OFFICE, KDN_RENEWAL_2027, COMPANY_TOOLBOX_MEETING,
 * GROUP_MONTHLY_MEETING, docs/system (workflows, business rules, screens) and the rules in packages/core/src/rules.ts.
 */
export const SOPS_GOV: Sop[] = [
  // ---------------------------------------------------------------- Compliance: licences and readiness
  {
    id: 'gov-licence-record',
    app: 'gov',
    title: { en: 'Keep each company licence on record', ms: 'Simpan rekod lesen setiap syarikat' },
    purpose: {
      en: 'Every company keeps its KDN licence, MOF registration, group insurance and SSM annual return in Prima with the expiry date, so reminders start on time.',
      ms: 'Setiap syarikat menyimpan lesen KDN, pendaftaran MOF, insurans kumpulan dan penyata tahunan SSM dalam Prima bersama tarikh tamat, supaya peringatan bermula tepat pada masanya.',
    },
    start: { view: 'compliance', label: { en: 'Add licence', ms: 'Tambah lesen' } },
    starter: { en: 'Company Manager or the company’s admin executives', ms: 'Pengurus Syarikat atau eksekutif admin syarikat' },
    steps: [
      {
        who: { en: 'Admin executive or Company Manager', ms: 'Eksekutif admin atau Pengurus Syarikat' },
        does: {
          en: 'Adds the licence (or presses Update on its row) with the expiry date and reference.',
          ms: 'Tambah lesen (atau tekan Update pada barisnya) bersama tarikh tamat dan rujukan.',
        },
        where: { view: 'compliance', label: { en: 'Company licences', ms: 'Lesen syarikat' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Shows each licence as valid, due soon, expired or “No record”, and starts reminders 120 (KDN), 90 (MOF), 90 (insurance) and 60 (SSM) days before expiry.',
          ms: 'Menunjukkan setiap lesen sebagai sah, hampir tamat, tamat atau “Tiada rekod”, dan mula memberi peringatan 120 (KDN), 90 (MOF), 90 (insurans) dan 60 (SSM) hari sebelum tamat.',
        },
      },
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: { en: 'When a licence is due, opens its renewal on the Renewals screen.', ms: 'Apabila lesen hampir tamat, buka pembaharuannya di skrin Pembaharuan.' },
        where: { view: 'renewals', label: { en: 'Renewals', ms: 'Pembaharuan' } },
      },
    ],
    rules: [
      { en: 'A licence with no expiry on record counts as a problem (Unknown), never as valid.', ms: 'Lesen tanpa tarikh tamat dalam rekod dikira sebagai masalah (Unknown), bukan sah.' },
      { en: 'An expired security licence blocks new contracts and bids for that company.', ms: 'Lesen keselamatan yang tamat menyekat kontrak dan bidaan baru bagi syarikat itu.' },
      { en: 'Filing is done by a person; Prima keeps the date and receipt.', ms: 'Pemfailan dibuat oleh orang; Prima menyimpan tarikh dan resit.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/central-admin.md', decided: 'Fauzan, 24 Oct to 2 Nov 2026 (renewal lead times)' },
    words: 'licence lesen kdn mof ssm insurance insurans expiry tamat tempoh permit',
  },
  {
    id: 'gov-renewal',
    app: 'gov',
    title: { en: 'Renewing a licence, registration or certificate', ms: 'Membaharui lesen, pendaftaran atau sijil' },
    purpose: {
      en: 'Each company renews its own licences, council (majlis) licences, vendor registrations and ISO certificates; Central Admin monitors and confirms the new expiry. Prima never lodges or pays.',
      ms: 'Setiap syarikat membaharui lesen sendiri, lesen majlis, pendaftaran vendor dan sijil ISO; Pentadbiran Pusat memantau dan mengesahkan tarikh tamat baru. Prima tidak sekali-kali menghantar permohonan atau membayar.',
    },
    start: { view: 'renewals', label: { en: 'Open renewal', ms: 'Buka pembaharuan' } },
    starter: { en: 'The company admin team (owner of the item)', ms: 'Pasukan admin syarikat (pemilik item)' },
    steps: [
      {
        who: { en: 'Admin executive (owner)', ms: 'Eksekutif admin (pemilik)' },
        does: {
          en: 'Opens the renewal at its lead time and ticks or adds each paper on the checklist.',
          ms: 'Buka pembaharuan pada masa awalnya dan tanda atau tambah setiap dokumen dalam senarai semak.',
        },
        where: { view: 'renewals', label: { en: 'Renewals', ms: 'Pembaharuan' } },
      },
      {
        who: { en: 'Company Manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Checks and presses “Sign the application”. The preparer never signs it off.', ms: 'Semak dan tekan “Sign the application”. Penyedia tidak boleh menandatanganinya.' },
        where: { view: 'renewals', label: { en: 'Renewals', ms: 'Pembaharuan' } },
        decision: true,
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: {
          en: 'Pays the agency fee through a normal payment request with a reason; the owner records the payment reference (“Record fee”).',
          ms: 'Membayar yuran agensi melalui permohonan bayaran biasa dengan sebab; pemilik merekod rujukan bayaran (“Record fee”).',
        },
        where: { view: 'renewals', label: { en: 'Renewals', ms: 'Pembaharuan' } },
      },
      {
        who: { en: 'Admin executive (owner)', ms: 'Eksekutif admin (pemilik)' },
        does: {
          en: 'Submits to the agency outside Prima, then records the submission reference; adds an agency note at each follow-up.',
          ms: 'Menghantar kepada agensi di luar Prima, kemudian merekod rujukan penghantaran; tambah nota agensi pada setiap susulan.',
        },
        where: { view: 'renewals', label: { en: 'Renewals', ms: 'Pembaharuan' } },
      },
      {
        who: { en: 'Admin executive (owner)', ms: 'Eksekutif admin (pemilik)' },
        does: { en: 'Records the new certificate with its new expiry date.', ms: 'Merekod sijil baru bersama tarikh tamat baru.' },
        where: { view: 'renewals', label: { en: 'Renewals', ms: 'Pembaharuan' } },
      },
      {
        who: { en: 'Deputy Chief of Staff (ACT for ISO and compliance items)', ms: 'Timbalan Ketua Staf (ACT bagi item ISO dan pematuhan)' },
        does: { en: 'Confirms the new expiry matches the certificate, or queries it or sends it back.', ms: 'Mengesahkan tarikh tamat baru sepadan dengan sijil, atau mempersoalkannya atau menghantarnya balik.' },
        where: { view: 'renewals', label: { en: 'Renewals', ms: 'Pembaharuan' } },
        decision: true,
      },
    ],
    rules: [
      {
        en: 'Cases open ahead of expiry: KDN licence 120 days, MOF 90, insurance 90, SSM 60, majlis 60, ISO 120 days before each audit.',
        ms: 'Kes dibuka sebelum tamat: lesen KDN 120 hari, MOF 90, insurans 90, SSM 60, majlis 60, ISO 120 hari sebelum setiap audit.',
      },
      {
        en: 'A late renewal steps up: Deputy Chief of Staff, then Chief of Staff, then CEO.',
        ms: 'Pembaharuan lewat dinaikkan: Timbalan Ketua Staf, kemudian Ketua Staf, kemudian CEO.',
      },
      { en: 'A renewal closes only when the new certificate or receipt is recorded.', ms: 'Pembaharuan hanya ditutup apabila sijil atau resit baru direkod.' },
      { en: 'Refused or more papers asked: back to the checklist with the reason.', ms: 'Ditolak atau diminta dokumen tambahan: kembali ke senarai semak dengan sebabnya.' },
    ],
    status: 'in_force',
    statusNote: { en: 'Lead times and paper lists are starting proposals; the agency’s current form decides.', ms: 'Tempoh awal dan senarai dokumen adalah cadangan permulaan; borang semasa agensi yang menentukan.' },
    source: { doc: 'docs/CENTRAL_ADMIN_PHASE5.md', decided: 'Fauzan, 2 Nov 2026 (5C: each company renews its own, Central Admin monitors)' },
    words: 'renewal pembaharuan renew majlis council mof eperolehan iso bomba vendor panel certificate sijil',
  },
  {
    id: 'gov-kdn-renewal-2027',
    app: 'gov',
    title: { en: 'KDN licence renewal 2027', ms: 'Pembaharuan Lesen KDN 2027' },
    purpose: {
      en: 'Each licensed company prepares the 15-line KDN checklist (Lampiran C), a director signs, the eSIMS appointment is booked and the result recorded. Prima never logs in to eSIMS, lodges or pays.',
      ms: 'Setiap syarikat berlesen menyediakan senarai semak KDN 15 baris (Lampiran C), pengarah menandatangan, janji temu eSIMS ditempah dan keputusannya direkod. Prima tidak log masuk ke eSIMS, menghantar atau membayar.',
    },
    start: { view: 'renewals', label: { en: 'Buka pembaharuan KDN', ms: 'Buka pembaharuan KDN' } },
    starter: { en: 'The company’s admin team', ms: 'Pasukan admin syarikat' },
    steps: [
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: {
          en: 'Opens the renewal in the “Pembaharuan Lesen KDN 2027” panel and uploads each paper (PDF or scan of the signed hardcopy); each paper is checked for its date or period.',
          ms: 'Buka pembaharuan di panel “Pembaharuan Lesen KDN 2027” dan muat naik setiap dokumen (PDF atau imbasan salinan bertandatangan); setiap dokumen disemak tarikh atau tempohnya.',
        },
        where: { view: 'renewals', label: { en: 'Pembaharuan Lesen KDN 2027', ms: 'Pembaharuan Lesen KDN 2027' } },
      },
      {
        who: { en: 'Company head, Finance, FWM', ms: 'Ketua syarikat, Kewangan, FWM' },
        does: {
          en: 'The company head confirms the CSG/TNG not-trained counts with a reason; Finance ticks no SST arrears with the MySST reference; FWM marks each Nepali guard entered in eSIMS.',
          ms: 'Ketua syarikat mengesahkan bilangan CSG/TNG belum berlatih dengan sebab; Kewangan menanda tiada tunggakan SST dengan rujukan MySST; FWM menanda setiap pengawal Nepal sudah dimasukkan dalam eSIMS.',
        },
        where: { view: 'renewals', label: { en: 'Pembaharuan Lesen KDN 2027', ms: 'Pembaharuan Lesen KDN 2027' } },
      },
      {
        who: { en: 'Company Manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Checks the papers (“Semak dokumen (pengurus)”).', ms: 'Menyemak dokumen (“Semak dokumen (pengurus)”).' },
        where: { view: 'renewals', label: { en: 'Pembaharuan Lesen KDN 2027', ms: 'Pembaharuan Lesen KDN 2027' } },
        decision: true,
      },
      {
        who: { en: 'A director of the same company', ms: 'Pengarah syarikat yang sama' },
        does: {
          en: 'Ticks the declaration and signs (“Tandatangan pengarah”). Never the preparer or the checker; refused until papers, eSIMS, counts, check, Nepali eSIMS and SST are all done.',
          ms: 'Tanda pengakuan dan tandatangan (“Tandatangan pengarah”). Bukan penyedia atau penyemak; ditolak sehingga dokumen, eSIMS, bilangan, semakan, eSIMS Nepal dan SST semuanya selesai.',
        },
        where: { view: 'renewals', label: { en: 'Pembaharuan Lesen KDN 2027', ms: 'Pembaharuan Lesen KDN 2027' } },
        decision: true,
      },
      {
        who: { en: 'Admin executive', ms: 'Eksekutif admin' },
        does: {
          en: 'Books the eSIMS appointment inside a session (on a weekday, with the eSIMS reference and attendee), goes to KDN, then records the result of the day: accepted, papers lacking, or left at the counter.',
          ms: 'Tempah janji temu eSIMS dalam satu sesi (hari bekerja, dengan rujukan eSIMS dan siapa hadir), pergi ke KDN, kemudian rekod keputusan hari itu: diterima, dokumen tidak lengkap, atau ditinggalkan di kaunter.',
        },
        where: { view: 'renewals', label: { en: 'Rekod janji temu', ms: 'Rekod janji temu' } },
      },
    ],
    rules: [
      {
        en: 'Late ladder on home: not opened by 18 Nov goes to the Deputy CoS, no appointment by 23 Nov to the CoS, not accepted by 11 Dec to the CEO.',
        ms: 'Tangga lewat di laman utama: belum dibuka pada 18 Nov kepada Timbalan Ketua Staf, tiada janji temu pada 23 Nov kepada Ketua Staf, belum diterima pada 11 Dis kepada CEO.',
      },
      { en: 'Director IC numbers are never shown on screens or exports. One company’s papers are never mixed with another’s.', ms: 'Nombor IC pengarah tidak sekali-kali dipaparkan di skrin atau eksport. Dokumen satu syarikat tidak dicampur dengan syarikat lain.' },
      { en: 'The pendrive pack (ZIP of the company’s soft copies) is for company staff and Central Admin only, and is logged.', ms: 'Pek pendrive (ZIP salinan lembut syarikat) hanya untuk staf syarikat dan Pentadbiran Pusat, dan direkod.' },
    ],
    status: 'in_force',
    statusNote: {
      en: 'FWM’s per-guard “entered in eSIMS” mark has no button on any screen yet; ask the lead before a company with Nepali guards reaches the signing step.',
      ms: 'Tanda “dimasukkan dalam eSIMS” bagi setiap pengawal oleh FWM belum ada butang di mana-mana skrin; rujuk ketua projek sebelum syarikat yang ada pengawal Nepal sampai ke langkah tandatangan.',
    },
    source: { doc: 'docs/KDN_RENEWAL_2027.md', decided: 'Fauzan, answers W-X1 to W-X13, 14 Nov 2026' },
    words: 'kdn lesen licence 2027 esims lampiran c janji temu appointment pengarah director pendrive sst csg tng',
  },
  {
    id: 'gov-self-audit',
    app: 'gov',
    title: { en: 'Yearly self-audit', ms: 'Audit kendiri tahunan' },
    purpose: {
      en: 'Every company checks itself once a year (the company office, one site, or everything) against hours, pay, contracts, fees, passports, training, safety and permits, and fixes what is not right.',
      ms: 'Setiap syarikat menyemak dirinya sekali setahun (pejabat syarikat, satu tapak, atau semua) tentang waktu kerja, gaji, kontrak, yuran, pasport, latihan, keselamatan dan permit, dan membetulkan yang tidak betul.',
    },
    start: { view: 'selfaudit', label: { en: 'Do a self-audit', ms: 'Buat audit kendiri' } },
    starter: { en: 'Company Manager or the company’s admin executives', ms: 'Pengurus Syarikat atau eksekutif admin syarikat' },
    steps: [
      {
        who: { en: 'Company Manager or admin executive', ms: 'Pengurus Syarikat atau eksekutif admin' },
        does: {
          en: 'Chooses what it covers, answers every line OK, Not right or N/A (with a note), attaches the proof and saves.',
          ms: 'Pilih skopnya, jawab setiap baris OK, Not right atau N/A (dengan nota), lampirkan bukti dan simpan.',
        },
        where: { view: 'selfaudit', label: { en: 'Yearly self-audit', ms: 'Audit kendiri tahunan' } },
      },
      {
        who: { en: 'Company Manager or admin executive', ms: 'Pengurus Syarikat atau eksekutif admin' },
        does: { en: 'For each line marked Not right, presses “Record fix” with what was done and the proof.', ms: 'Bagi setiap baris Not right, tekan “Record fix” dengan apa yang dibuat dan buktinya.' },
        where: { view: 'selfaudit', label: { en: 'Self-audits done', ms: 'Audit kendiri yang selesai' } },
      },
      {
        who: { en: 'ACT and group leaders', ms: 'ACT dan pemimpin kumpulan' },
        does: { en: 'See where each company stands and open each site’s client requirements from here.', ms: 'Melihat kedudukan setiap syarikat dan membuka keperluan klien setiap tapak dari sini.' },
        where: { view: 'selfaudit', label: { en: 'Where it stands', ms: 'Kedudukan semasa' } },
      },
    ],
    rules: [
      { en: 'Once every 12 months; reminders 60, 30 and 7 days before it is due.', ms: 'Sekali setiap 12 bulan; peringatan 60, 30 dan 7 hari sebelum tarikh akhir.' },
      { en: 'Every line must be answered before it can be saved.', ms: 'Setiap baris mesti dijawab sebelum boleh disimpan.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The reminder days and the 14-day fix target are proposals.', ms: 'Hari peringatan dan sasaran 14 hari untuk membetulkan adalah cadangan.' },
    source: { doc: 'docs/system/04-workflows.md', decided: 'Fauzan, 6 Nov 2026 (after the IKEA IWAY audit; rule CLIENT-CODE)' },
    words: 'self audit audit kendiri iway yearly tahunan semakan company syarikat site tapak',
  },
  {
    id: 'gov-rba-trace',
    app: 'gov',
    title: { en: 'RBA trace review (one month, about 20 workers)', ms: 'Semakan jejak RBA (sebulan, kira-kira 20 pekerja)' },
    purpose: {
      en: 'ACT lines up roster, clock, overtime, pay and bank payment for a sample of workers, foreign workers first, and settles every mismatch.',
      ms: 'ACT menyusun roster, jam kehadiran, kerja lebih masa, gaji dan bayaran bank bagi sampel pekerja, pekerja asing dahulu, dan menyelesaikan setiap ketidakpadanan.',
    },
    start: { view: 'rba', tab: 'trace', label: { en: 'Run the trace', ms: 'Jalankan jejak' } },
    starter: { en: 'ACT', ms: 'ACT' },
    steps: [
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: { en: 'Picks the company and month and presses “Run the trace”.', ms: 'Pilih syarikat dan bulan, kemudian tekan “Run the trace”.' },
        where: { view: 'rba', tab: 'trace', label: { en: 'RBA › Trace review', ms: 'RBA › Semakan jejak' } },
      },
      {
        who: { en: 'Prima', ms: 'Prima' },
        does: {
          en: 'Compares each worker’s roster hours, clocked hours, days and overtime paid, and pay by the 7th; lists every mismatch.',
          ms: 'Membandingkan jam roster, jam yang direkod, hari dan kerja lebih masa yang dibayar, dan gaji sebelum 7 haribulan bagi setiap pekerja; menyenaraikan setiap ketidakpadanan.',
        },
      },
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: {
          en: 'Settles each worker with a note: Explained, Corrected, or Finding (which then goes through the ACT finding steps).',
          ms: 'Menyelesaikan setiap pekerja dengan nota: Explained, Corrected, atau Finding (yang kemudian melalui langkah dapatan ACT).',
        },
        where: { view: 'rba', tab: 'trace', label: { en: 'RBA › Trace review', ms: 'RBA › Semakan jejak' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Sample of 20 workers, 4 hours of tolerance, 8-hour normal day (approved 8 Nov 2026).', ms: 'Sampel 20 pekerja, toleransi 4 jam, hari biasa 8 jam (diluluskan 8 Nov 2026).' },
      { en: 'Red items on a site’s RBA list go the same day to ACT, the Chief of Staff and the COO.', ms: 'Item merah dalam senarai RBA tapak dihantar pada hari yang sama kepada ACT, Ketua Staf dan COO.' },
      { en: 'Guard pay is still in trial, so JA keeps the bank proof.', ms: 'Gaji pengawal masih dalam percubaan, jadi JA menyimpan bukti bank.' },
      { en: 'Prima keeps the records; it is not an RBA certificate.', ms: 'Prima menyimpan rekod; ia bukan sijil RBA.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/RELEASE_CANDIDATE_2026-11-08.md', decided: 'Fauzan, 8 Nov 2026 (rule RBA-READY, “Policy yes proceed”)' },
    words: 'rba trace jejak payslip slip gaji roster clock overtime ot foreign worker pekerja asing mismatch',
  },
  {
    id: 'gov-rba-ethics',
    app: 'gov',
    title: { en: 'Ethics declaration and the RBA committee', ms: 'Pengakuan etika dan jawatankuasa RBA' },
    purpose: {
      en: 'Every staff member signs the ethics declaration once on entering service and declares any conflicting interest; ACT reviews declared interests. The Chief of Staff names the RBA committee each year.',
      ms: 'Setiap staf menandatangani pengakuan etika sekali semasa mula berkhidmat dan mengisytiharkan sebarang kepentingan yang bercanggah; ACT menyemak kepentingan yang diisytiharkan. Ketua Staf menamakan jawatankuasa RBA setiap tahun.',
    },
    start: { view: 'rba', tab: 'ethics', label: { en: 'Sign the ethics declaration', ms: 'Tandatangan pengakuan etika' } },
    starter: { en: 'Every office staff member', ms: 'Setiap staf pejabat' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Ticks every statement, writes any interest (or ticks “I have no such interests”) and presses Sign.',
          ms: 'Tanda setiap kenyataan, tulis sebarang kepentingan (atau tanda “I have no such interests”) dan tekan Sign.',
        },
        where: { view: 'rba', tab: 'ethics', label: { en: 'RBA › Ethics declaration', ms: 'RBA › Pengakuan etika' } },
      },
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: { en: 'Reviews each declared interest with a reason: No conflict, or Managed (and what was put in place).', ms: 'Menyemak setiap kepentingan yang diisytiharkan dengan sebab: No conflict, atau Managed (dan langkah yang diambil).' },
        where: { view: 'rba', tab: 'ethics', label: { en: 'RBA › Ethics declaration', ms: 'RBA › Pengakuan etika' } },
        decision: true,
      },
      {
        who: { en: 'Chief of Staff', ms: 'Ketua Staf' },
        does: { en: 'Names the RBA committee for the year: the Operations Director and a few company heads.', ms: 'Menamakan jawatankuasa RBA bagi tahun itu: Pengarah Operasi dan beberapa ketua syarikat.' },
        where: { view: 'rba', tab: 'committee', label: { en: 'RBA › Committee', ms: 'RBA › Jawatankuasa' } },
      },
    ],
    rules: [
      { en: 'Signed once, on entering service.', ms: 'Ditandatangani sekali, semasa mula berkhidmat.' },
      { en: 'The committee has at most 6 members.', ms: 'Jawatankuasa mempunyai paling ramai 6 ahli.' },
      { en: 'No fee, deposit, fine or penalty for leaving is taken from pay.', ms: 'Tiada yuran, deposit, denda atau penalti berhenti dipotong daripada gaji.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/RELEASE_CANDIDATE_2026-11-08.md', decided: 'Fauzan, 7 and 8 Nov 2026 (rule RBA-READY)' },
    words: 'ethics etika declaration pengakuan conflict of interest konflik kepentingan rba committee jawatankuasa',
  },

  // ---------------------------------------------------------------- Compliance: ACT, audit and quality
  {
    id: 'gov-act-finding',
    app: 'gov',
    title: { en: 'ACT finding: from raised to closed', ms: 'Dapatan ACT: dari dibangkitkan hingga ditutup' },
    purpose: {
      en: 'ACT records a discrepancy with an owner; the owner plans and fixes it with proof; ACT checks the fix. Overdue findings are shown to the next level, never punished.',
      ms: 'ACT merekod ketidakpatuhan bersama pemilik; pemilik merancang dan membetulkannya dengan bukti; ACT menyemak pembetulan. Dapatan lewat ditunjukkan kepada peringkat seterusnya, tidak dihukum.',
    },
    start: { view: 'act', label: { en: 'Raise a finding', ms: 'Bangkitkan dapatan' } },
    starter: { en: 'ACT Director, Auditor or Enforcement officer', ms: 'Pengarah ACT, Juruaudit atau pegawai Penguatkuasa' },
    steps: [
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: {
          en: 'Raises the finding (from a monitor signal, a workflow audit, a spot check or speak-up) with severity and owner. One the Director raises waits until it is given to Team 1 or Team 2.',
          ms: 'Membangkitkan dapatan (daripada isyarat pemantauan, audit aliran kerja, semakan mengejut atau speak-up) dengan tahap dan pemilik. Dapatan oleh Pengarah menunggu sehingga diberi kepada Pasukan 1 atau 2.',
        },
        where: { view: 'act', tab: 'monitor', label: { en: 'ACT › Compliance monitor', ms: 'ACT › Pemantauan pematuhan' } },
      },
      {
        who: { en: 'Owner (department head or Company Manager)', ms: 'Pemilik (ketua jabatan atau Pengurus Syarikat)' },
        does: {
          en: 'In “My findings” saves the plan (cause, fix, done-by date), does the fix, then marks it fixed with the proof.',
          ms: 'Di “My findings” simpan pelan (punca, pembetulan, tarikh siap), buat pembetulan, kemudian tanda sudah dibetulkan dengan bukti.',
        },
        where: { view: 'act', tab: 'findings', label: { en: 'ACT › Findings', ms: 'ACT › Dapatan' } },
      },
      {
        who: { en: 'Enforcement officer', ms: 'Pegawai Penguatkuasa' },
        does: {
          en: 'Follows up an owner who has no plan, is past the due date or failed the check (call, message, email, visit, meeting or memo, with the next date).',
          ms: 'Membuat susulan dengan pemilik yang tiada pelan, lewat tarikh akhir atau gagal semakan (panggilan, mesej, e-mel, lawatan, mesyuarat atau memo, dengan tarikh seterusnya).',
        },
        where: { view: 'act', tab: 'findings', label: { en: 'ACT › Findings', ms: 'ACT › Dapatan' } },
      },
      {
        who: { en: 'Team Auditor, then the ACT Manager', ms: 'Juruaudit pasukan, kemudian Pengurus ACT' },
        does: {
          en: 'Checks the fix: “Fix works, close” or “Not fixed” (back to the owner). With an ACT Manager on record, the Auditor’s check is the first check and the ACT Manager second-checks it.',
          ms: 'Menyemak pembetulan: “Fix works, close” atau “Not fixed” (kembali kepada pemilik). Jika ada Pengurus ACT, semakan Juruaudit ialah semakan pertama dan Pengurus ACT membuat semakan kedua.',
        },
        where: { view: 'act', tab: 'findings', label: { en: 'ACT › Findings', ms: 'ACT › Dapatan' } },
        decision: true,
      },
      {
        who: { en: 'ACT Director', ms: 'Pengarah ACT' },
        does: { en: 'Closes high findings (only the Director may).', ms: 'Menutup dapatan tahap tinggi (hanya Pengarah boleh).' },
        where: { view: 'act', tab: 'findings', label: { en: 'ACT › Findings', ms: 'ACT › Dapatan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Fix within 14, 30 or 60 days by severity.', ms: 'Betulkan dalam 14, 30 atau 60 hari mengikut tahap.' },
      {
        en: 'Overdue findings are shown to the Chief of Staff, then the COO after 14 days and the CEO after 30. Nothing is automatic discipline.',
        ms: 'Dapatan lewat ditunjukkan kepada Ketua Staf, kemudian COO selepas 14 hari dan CEO selepas 30 hari. Tiada tindakan disiplin automatik.',
      },
      { en: 'ACT is never the owner of a finding, and Auditors and Enforcement act only on their own team’s findings.', ms: 'ACT tidak sekali-kali menjadi pemilik dapatan, dan Juruaudit serta Penguatkuasa hanya bertindak atas dapatan pasukan sendiri.' },
      { en: 'Enforcement never checks a fix; nobody second-checks their own check.', ms: 'Penguatkuasa tidak menyemak pembetulan; tiada sesiapa menyemak semula semakan sendiri.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The 5-day plan follow-up and the 7-day follow-up cycle are proposals awaiting Fauzan.', ms: 'Susulan pelan 5 hari dan kitaran susulan 7 hari adalah cadangan yang menunggu Fauzan.' },
    source: { doc: 'docs/ACT_DEPARTMENT.md', decided: 'Fauzan, 27 Oct and 2 Nov 2026; second check, 11 Nov 2026' },
    words: 'act audit finding dapatan corrective action pembetulan enforcement penguatkuasa auditor escalation',
  },
  {
    id: 'gov-act-monthly-review',
    app: 'gov',
    title: { en: 'ACT check of the monthly reports', ms: 'Semakan ACT ke atas laporan bulanan' },
    purpose: {
      en: 'ACT reads the same monthly report each department sends to the Director Office and checks it is on time, complete and true.',
      ms: 'ACT membaca laporan bulanan yang sama yang dihantar setiap jabatan kepada Pejabat Pengarah dan menyemak ia tepat pada masa, lengkap dan benar.',
    },
    start: { view: 'act', tab: 'reports', label: { en: 'ACT › Monthly reports', ms: 'ACT › Laporan bulanan' } },
    starter: { en: 'ACT Director', ms: 'Pengarah ACT' },
    steps: [
      {
        who: { en: 'Department head', ms: 'Ketua jabatan' },
        does: { en: 'Sends the monthly report on the Reports screen and ticks the sections it covers.', ms: 'Menghantar laporan bulanan di skrin Laporan dan menanda bahagian yang dilaporkan.' },
        where: { view: 'reports', label: { en: 'Reports to the Director Office', ms: 'Laporan kepada Pejabat Pengarah' } },
      },
      {
        who: { en: 'ACT Director', ms: 'Pengarah ACT' },
        does: { en: 'Gives each report’s review to Team 1 or Team 2 (“Review: Team 1/2”) and sets each department’s form (“Save form”).', ms: 'Memberi semakan setiap laporan kepada Pasukan 1 atau 2 (“Review: Team 1/2”) dan menetapkan borang setiap jabatan (“Save form”).' },
        where: { view: 'act', tab: 'reports', label: { en: 'ACT › Monthly reports', ms: 'ACT › Laporan bulanan' } },
      },
      {
        who: { en: 'Team Auditor', ms: 'Juruaudit pasukan' },
        does: {
          en: 'Compares the key figures with Prima’s own records (for example headcount against HR, collections against Finance) and records the review done.',
          ms: 'Membandingkan angka utama dengan rekod Prima sendiri (contohnya bilangan staf dengan HR, kutipan dengan Kewangan) dan merekod semakan selesai.',
        },
        where: { view: 'act', tab: 'work', label: { en: 'ACT › Team work', ms: 'ACT › Kerja pasukan' } },
      },
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: { en: 'A late or wrong report becomes a finding with the department head as owner.', ms: 'Laporan lewat atau salah menjadi dapatan dengan ketua jabatan sebagai pemilik.' },
        where: { view: 'act', tab: 'findings', label: { en: 'ACT › Findings', ms: 'ACT › Dapatan' } },
      },
    ],
    rules: [
      { en: 'Monthly reports are due on the 25th of the next month.', ms: 'Laporan bulanan perlu dihantar sebelum 25 haribulan bulan berikutnya.' },
      { en: 'A department with no report set is never green; a report with sections missing shows “Incomplete”.', ms: 'Jabatan tanpa laporan ditetapkan tidak sekali-kali hijau; laporan yang tertinggal bahagian dipaparkan “Incomplete”.' },
      { en: 'Work given to a team is recorded done by that team’s Auditor (or the Director).', ms: 'Kerja yang diberi kepada pasukan direkod selesai oleh Juruaudit pasukan itu (atau Pengarah).' },
    ],
    status: 'in_force',
    statusNote: { en: 'The nine-section standard form is a proposal; the ACT Director decides each department’s form.', ms: 'Borang standard sembilan bahagian adalah cadangan; Pengarah ACT menentukan borang setiap jabatan.' },
    source: { doc: 'docs/ACT_DEPARTMENT.md', decided: 'Fauzan, 2 Nov 2026 (rule RPT-MONTHLY)' },
    words: 'monthly report laporan bulanan act review semakan director office 25th',
  },
  {
    id: 'gov-act-investigation',
    app: 'gov',
    title: { en: 'Record patterns and investigations', ms: 'Corak rekod dan siasatan' },
    purpose: {
      en: 'Fixed checks over Prima’s records show patterns for ACT to verify (never proof or an accusation); ACT decides whether to raise a finding or open an investigation.',
      ms: 'Semakan tetap ke atas rekod Prima menunjukkan corak untuk ACT sahkan (bukan bukti atau tuduhan); ACT memutuskan sama ada membangkitkan dapatan atau membuka siasatan.',
    },
    start: { view: 'act', tab: 'fraud', label: { en: 'ACT › Patterns and investigations', ms: 'ACT › Corak dan siasatan' } },
    starter: { en: 'ACT Director (any team) or an Auditor (own team)', ms: 'Pengarah ACT (mana-mana pasukan) atau Juruaudit (pasukan sendiri)' },
    steps: [
      {
        who: { en: 'Auditor or ACT Director', ms: 'Juruaudit atau Pengarah ACT' },
        does: { en: 'Looks at a pattern and opens an investigation file for a team.', ms: 'Meneliti corak dan membuka fail siasatan untuk sesuatu pasukan.' },
        where: { view: 'act', tab: 'fraud', label: { en: 'ACT › Patterns and investigations', ms: 'ACT › Corak dan siasatan' } },
      },
      {
        who: { en: 'The team (Auditor and Enforcement)', ms: 'Pasukan (Juruaudit dan Penguatkuasa)' },
        does: { en: 'Adds evidence and notes; each file is kept with its fingerprint and every open, add and view is logged.', ms: 'Menambah bukti dan nota; setiap fail disimpan dengan cap jarinya dan setiap buka, tambah dan lihat direkod.' },
        where: { view: 'act', tab: 'fraud', label: { en: 'ACT › Patterns and investigations', ms: 'ACT › Corak dan siasatan' } },
      },
      {
        who: { en: 'ACT Director', ms: 'Pengarah ACT' },
        does: {
          en: 'Closes the file with an outcome (substantiated, not substantiated, or referred, naming to whom, such as HR or Legal) and a reason.',
          ms: 'Menutup fail dengan keputusan (terbukti, tidak terbukti, atau dirujuk dengan nama pihak seperti HR atau Undang-undang) dan sebab.',
        },
        where: { view: 'act', tab: 'fraud', label: { en: 'ACT › Patterns and investigations', ms: 'ACT › Corak dan siasatan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Only the assigned team and the Director see a file; the other team sees only “Under investigation”.', ms: 'Hanya pasukan yang ditugaskan dan Pengarah melihat fail; pasukan lain hanya melihat “Under investigation”.' },
      { en: 'Nothing is removed; the same file cannot be attached twice; a closed file takes no more evidence.', ms: 'Tiada apa dibuang; fail yang sama tidak boleh dilampirkan dua kali; fail yang ditutup tidak menerima bukti lagi.' },
      { en: 'Prima never disciplines anyone; whoever it is referred to decides any action.', ms: 'Prima tidak sekali-kali mendisiplinkan sesiapa; pihak yang dirujuk memutuskan sebarang tindakan.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The look-back period and pattern limits are proposals.', ms: 'Tempoh semakan ke belakang dan had corak adalah cadangan.' },
    source: { doc: 'docs/ACT_DEPARTMENT.md', decided: 'Fauzan, 3 Nov 2026 (rule ACT-FRAUD)' },
    words: 'fraud penipuan pattern corak investigation siasatan evidence bukti anomaly duplicate claim',
  },
  {
    id: 'gov-act-improvement',
    app: 'gov',
    title: { en: 'Improvement led by ACT', ms: 'Penambahbaikan diketuai ACT' },
    purpose: {
      en: 'ACT proposes an improvement to a workflow; the COO or CEO approves it; the steps are ticked off and the result recorded.',
      ms: 'ACT mencadangkan penambahbaikan aliran kerja; COO atau CEO meluluskannya; langkah ditanda selesai dan keputusan direkod.',
    },
    start: { view: 'act', tab: 'improvements', label: { en: 'Propose an improvement', ms: 'Cadangkan penambahbaikan' } },
    starter: { en: 'ACT', ms: 'ACT' },
    steps: [
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: { en: 'Proposes the improvement with its steps and target.', ms: 'Mencadangkan penambahbaikan bersama langkah dan sasarannya.' },
        where: { view: 'act', tab: 'improvements', label: { en: 'ACT › Improvements', ms: 'ACT › Penambahbaikan' } },
      },
      {
        who: { en: 'COO or CEO', ms: 'COO atau CEO' },
        does: { en: 'Approves it with a note.', ms: 'Meluluskannya dengan nota.' },
        where: { view: 'act', tab: 'improvements', label: { en: 'ACT › Improvements', ms: 'ACT › Penambahbaikan' } },
        decision: true,
      },
      {
        who: { en: 'ACT (Enforcement may tick steps)', ms: 'ACT (Penguatkuasa boleh menanda langkah)' },
        does: { en: 'Ticks each step done, then records the result.', ms: 'Menanda setiap langkah selesai, kemudian merekod keputusannya.' },
        where: { view: 'act', tab: 'improvements', label: { en: 'ACT › Improvements', ms: 'ACT › Penambahbaikan' } },
      },
    ],
    rules: [{ en: 'Improvements are approved by the COO or the CEO.', ms: 'Penambahbaikan diluluskan oleh COO atau CEO.' }],
    status: 'in_force',
    source: { doc: 'docs/system/screens/assurance.md', decided: 'Fauzan, 27 Oct 2026' },
    words: 'improvement penambahbaikan transformation transformasi act process proses',
  },
  {
    id: 'gov-speak-up',
    app: 'gov',
    title: { en: 'Speak up (whistleblowing) report', ms: 'Laporan speak up (pemberi maklumat)' },
    purpose: {
      en: 'Anyone, guards included, can report wrongdoing, anonymously if they wish. The report never reaches anyone it names.',
      ms: 'Sesiapa sahaja, termasuk pengawal, boleh melaporkan salah laku, tanpa nama jika mahu. Laporan tidak sekali-kali sampai kepada sesiapa yang dinamakan di dalamnya.',
    },
    start: { view: 'grc', tab: 'speak', label: { en: 'Send report', ms: 'Hantar laporan' } },
    starter: { en: 'Anyone with a Prima sign-in', ms: 'Sesiapa yang ada akaun Prima' },
    steps: [
      {
        who: { en: 'Reporter', ms: 'Pelapor' },
        does: {
          en: 'Writes what it is about and sends it; keeps the receipt code to check on it, answer questions or report retaliation later.',
          ms: 'Menulis perkaranya dan menghantar; menyimpan kod resit untuk menyemak, menjawab soalan atau melaporkan tindakan balas kemudian.',
        },
        where: { view: 'grc', tab: 'speak', label: { en: 'Speak up and assurance › Speak up', ms: 'Speak up dan jaminan › Speak up' } },
      },
      {
        who: { en: 'Handler (ACT Director, else the Chairman or Vice Chairman, never anyone named)', ms: 'Pengendali (Pengarah ACT, jika tidak Pengerusi atau Naib Pengerusi, bukan sesiapa yang dinamakan)' },
        does: { en: 'Acknowledges, investigates, adds notes, writes to the reporter, then proposes closing.', ms: 'Mengakui terima, menyiasat, menambah nota, menulis kepada pelapor, kemudian mencadangkan penutupan.' },
        where: { view: 'grc', tab: 'reports', label: { en: 'Reports to handle', ms: 'Laporan untuk dikendalikan' } },
      },
      {
        who: { en: 'A second handler', ms: 'Pengendali kedua' },
        does: { en: '“Agree and close” or “Send back” with a note.', ms: '“Agree and close” atau “Send back” dengan nota.' },
        where: { view: 'grc', tab: 'reports', label: { en: 'Reports to handle', ms: 'Laporan untuk dikendalikan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Acknowledge within 7 days.', ms: 'Akui terima dalam 7 hari.' },
      { en: 'While open, the handler updates the reporter at least every 30 days.', ms: 'Semasa terbuka, pengendali memaklumkan pelapor sekurang-kurangnya setiap 30 hari.' },
      { en: 'The receipt code can report retaliation for 365 days after closing.', ms: 'Kod resit boleh melaporkan tindakan balas selama 365 hari selepas ditutup.' },
      { en: 'Closing always needs a second handler.', ms: 'Penutupan sentiasa memerlukan pengendali kedua.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The 7-day acknowledgement and the handler order are proposals.', ms: 'Akuan terima 7 hari dan susunan pengendali adalah cadangan.' },
    source: { doc: 'docs/system/04-workflows.md', decided: 'Fauzan, 8 Nov 2026 (update and retaliation periods, rule AUD-GRC)' },
    words: 'speak up whistleblowing pemberi maklumat aduan complaint wrongdoing salah laku anonymous tanpa nama retaliation',
  },
  {
    id: 'gov-gift',
    app: 'gov',
    title: { en: 'Declaring a gift or hospitality', ms: 'Mengisytiharkan hadiah atau keraian' },
    purpose: {
      en: 'Everyone declares every gift or hospitality given or received; larger ones, any with a public official and any cash need a decision.',
      ms: 'Semua orang mengisytiharkan setiap hadiah atau keraian yang diberi atau diterima; yang besar, yang melibatkan penjawat awam dan sebarang wang tunai memerlukan keputusan.',
    },
    start: { view: 'grc', tab: 'gifts', label: { en: 'Declare a gift', ms: 'Isytihar hadiah' } },
    starter: { en: 'Anyone with a Prima sign-in', ms: 'Sesiapa yang ada akaun Prima' },
    steps: [
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: { en: 'Declares the gift: given or received, from or to whom, what, value, date, cash or not.', ms: 'Mengisytiharkan hadiah: diberi atau diterima, daripada atau kepada siapa, apa, nilai, tarikh, tunai atau tidak.' },
        where: { view: 'grc', tab: 'gifts', label: { en: 'Speak up and assurance › Gifts', ms: 'Speak up dan jaminan › Hadiah' } },
      },
      {
        who: { en: 'Chief of Staff or Deputy', ms: 'Ketua Staf atau Timbalan' },
        does: { en: 'Decides: keep (needs a comment), return, donate or refuse.', ms: 'Memutuskan: simpan (perlu ulasan), pulangkan, dermakan atau tolak.' },
        where: { view: 'grc', tab: 'gifts', label: { en: 'Speak up and assurance › Gifts', ms: 'Speak up dan jaminan › Hadiah' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Above RM500, anything with a public official, and any cash need a decision.', ms: 'Melebihi RM500, apa-apa dengan penjawat awam, dan sebarang wang tunai memerlukan keputusan.' },
      { en: 'Cash is never kept; a gift with a public official or in cash cannot be approved to keep.', ms: 'Wang tunai tidak sekali-kali disimpan; hadiah dengan penjawat awam atau tunai tidak boleh diluluskan untuk disimpan.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The RM500 limit is a proposal.', ms: 'Had RM500 adalah cadangan.' },
    source: { doc: 'docs/system/screens/assurance.md', decided: 'MACC s.17A (TRUST); rule AUD-GRC' },
    words: 'gift hadiah hospitality keraian bribery rasuah macc 17a cash tunai',
  },
  {
    id: 'gov-obligation-proof',
    app: 'gov',
    title: { en: 'What each company must prove (obligations)', ms: 'Apa yang setiap syarikat mesti buktikan (kewajipan)' },
    purpose: {
      en: 'Each company records proof of its recurring legal and policy duties (OSH, anti-bribery and others); ACT accepts or rejects the proof. No proof is Unknown, never green.',
      ms: 'Setiap syarikat merekod bukti kewajipan undang-undang dan polisi yang berulang (OSH, anti-rasuah dan lain-lain); ACT menerima atau menolak bukti. Tiada bukti bermakna Unknown, bukan hijau.',
    },
    start: { view: 'grc', tab: 'obligations', label: { en: 'Record proof', ms: 'Rekod bukti' } },
    starter: { en: 'Company Manager or the company team', ms: 'Pengurus Syarikat atau pasukan syarikat' },
    steps: [
      {
        who: { en: 'Company', ms: 'Syarikat' },
        does: { en: 'Records the date and reference of the proof for each obligation as it falls due.', ms: 'Merekod tarikh dan rujukan bukti bagi setiap kewajipan apabila tiba masanya.' },
        where: { view: 'grc', tab: 'obligations', label: { en: 'Speak up and assurance › Obligations', ms: 'Speak up dan jaminan › Kewajipan' } },
      },
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: { en: 'Accepts or rejects the proof with a note.', ms: 'Menerima atau menolak bukti dengan nota.' },
        where: { view: 'grc', tab: 'obligations', label: { en: 'Speak up and assurance › Obligations', ms: 'Speak up dan jaminan › Kewajipan' } },
        decision: true,
      },
      {
        who: { en: 'Company or OM', ms: 'Syarikat atau OM' },
        does: { en: 'Records each site’s risk assessment (HIRARC) review.', ms: 'Merekod semakan penilaian risiko (HIRARC) setiap tapak.' },
        where: { view: 'grc', tab: 'osh', label: { en: 'Speak up and assurance › Site safety', ms: 'Speak up dan jaminan › Keselamatan tapak' } },
      },
    ],
    rules: [
      { en: 'Every site has a risk assessment reviewed every 12 months (OSHA 1994 s.18B); a site with none is Unknown.', ms: 'Setiap tapak mempunyai penilaian risiko yang disemak setiap 12 bulan (OSHA 1994 s.18B); tapak tanpanya ialah Unknown.' },
      { en: 'The person who records proof does not check it.', ms: 'Orang yang merekod bukti tidak menyemaknya.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/assurance.md', decided: 'Rule AUD-GRC' },
    words: 'obligation kewajipan proof bukti osh hirarc risk assessment penilaian risiko anti bribery',
  },
  {
    id: 'gov-quality-evidence',
    app: 'gov',
    title: { en: 'ISO 9001 and PIKM requirements: evidence and check', ms: 'Keperluan ISO 9001 dan PIKM: bukti dan semakan' },
    purpose: {
      en: 'One register of what ISO 9001 and the PIKM code ask for, per company, with the Prima records that show it is done. A person checks the evidence; Prima never says a company is compliant.',
      ms: 'Satu daftar keperluan ISO 9001 dan kod PIKM bagi setiap syarikat, dengan rekod Prima yang menunjukkan ia dibuat. Seseorang menyemak bukti; Prima tidak sekali-kali menyatakan syarikat itu patuh.',
    },
    start: { view: 'quality', tab: 'register', label: { en: 'Requirements register', ms: 'Daftar keperluan' } },
    starter: { en: 'ACT keeps the list; the Company Manager links evidence', ms: 'ACT menyimpan senarai; Pengurus Syarikat memautkan bukti' },
    steps: [
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: { en: 'On a fresh install presses “Load starter list” once, then keeps the requirements (adds, edits, retires).', ms: 'Pada pemasangan baru tekan “Load starter list” sekali, kemudian menyelenggara keperluan (tambah, ubah, tamatkan).' },
        where: { view: 'quality', tab: 'register', label: { en: 'Quality › Requirements register', ms: 'Kualiti › Daftar keperluan' } },
      },
      {
        who: { en: 'Company Manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Links the evidence that already exists: a Prima record, a document link, or what was seen on site.', ms: 'Memautkan bukti yang sudah ada: rekod Prima, pautan dokumen, atau apa yang dilihat di tapak.' },
        where: { view: 'quality', tab: 'register', label: { en: 'Quality › Requirements register', ms: 'Kualiti › Daftar keperluan' } },
      },
      {
        who: { en: 'ACT (never the person who linked it)', ms: 'ACT (bukan orang yang memautkannya)' },
        does: { en: 'Checks the evidence with a reason, or marks “Does not apply”, or raises the gap as an ACT finding.', ms: 'Menyemak bukti dengan sebab, atau menanda “Does not apply”, atau membangkitkan jurang sebagai dapatan ACT.' },
        where: { view: 'quality', tab: 'register', label: { en: 'Quality › Requirements register', ms: 'Kualiti › Daftar keperluan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Checked evidence is reviewed again every 12 months; “due soon” shows 60 days ahead.', ms: 'Bukti yang disemak dikaji semula setiap 12 bulan; “due soon” dipaparkan 60 hari lebih awal.' },
      { en: 'Guards and ordinary staff never see clause checklists.', ms: 'Pengawal dan staf biasa tidak sekali-kali melihat senarai semak klausa.' },
      { en: 'A gap goes to an ACT finding, not a second corrective-action system.', ms: 'Jurang dibawa ke dapatan ACT, bukan sistem tindakan pembetulan kedua.' },
    ],
    status: 'in_force',
    statusNote: { en: 'PIKM rows follow the 2022 drafts of Parts 1 and 2; ACT re-checks them when the final code is published.', ms: 'Baris PIKM mengikut draf 2022 Bahagian 1 dan 2; ACT menyemak semula apabila kod muktamad diterbitkan.' },
    source: { doc: 'docs/QUALITY_AND_COMPLIANCE.md', decided: 'Fauzan, 5 and 8 Nov 2026 (rule QMS-REGISTER)' },
    words: 'iso 9001 pikm sirim quality kualiti requirement keperluan evidence bukti clause klausa register',
  },
  {
    id: 'gov-service-fault',
    app: 'gov',
    title: { en: 'Service fault (the service was not what was agreed)', ms: 'Kesalahan perkhidmatan (perkhidmatan tidak seperti yang dipersetujui)' },
    purpose: {
      en: 'One record of what went wrong, what was done at once and whether the client was told; serious or repeat faults go to ACT for the root cause.',
      ms: 'Satu rekod apa yang salah, tindakan segera dan sama ada klien dimaklumkan; kesalahan serius atau berulang dibawa kepada ACT untuk punca sebenar.',
    },
    start: { view: 'quality', tab: 'faults', label: { en: 'Record a fault', ms: 'Rekod kesalahan' } },
    starter: { en: 'Company Manager (own company), Operations OM and up (sites they cover), or ACT', ms: 'Pengurus Syarikat (syarikat sendiri), Operasi OM ke atas (tapak di bawah jagaan), atau ACT' },
    steps: [
      {
        who: { en: 'Company Manager or OM', ms: 'Pengurus Syarikat atau OM' },
        does: {
          en: 'Records what happened, what was done at once and whether the client was told (a client complaint says how the client was answered).',
          ms: 'Merekod apa yang berlaku, tindakan segera dan sama ada klien dimaklumkan (aduan klien menyatakan bagaimana klien dijawab).',
        },
        where: { view: 'quality', tab: 'faults', label: { en: 'Quality › Service faults', ms: 'Kualiti › Kesalahan perkhidmatan' } },
      },
      {
        who: { en: 'ACT', ms: 'ACT' },
        does: { en: 'For a fault marked “Root cause needed”, raises an ACT finding owned by the Company Manager.', ms: 'Bagi kesalahan bertanda “Root cause needed”, membangkitkan dapatan ACT dengan Pengurus Syarikat sebagai pemilik.' },
        where: { view: 'quality', tab: 'faults', label: { en: 'Quality › Service faults', ms: 'Kualiti › Kesalahan perkhidmatan' } },
      },
      {
        who: { en: 'Company Manager or OM', ms: 'Pengurus Syarikat atau OM' },
        does: { en: 'Closes it as put right, client accepted (naming the client person) or service stopped.', ms: 'Menutupnya sebagai sudah dibetulkan, diterima klien (menamakan wakil klien) atau perkhidmatan dihentikan.' },
        where: { view: 'quality', tab: 'faults', label: { en: 'Quality › Service faults', ms: 'Kualiti › Kesalahan perkhidmatan' } },
      },
    ],
    rules: [{ en: 'A second fault at the same site within 90 days is a repeat and needs a root cause.', ms: 'Kesalahan kedua di tapak yang sama dalam 90 hari ialah ulangan dan memerlukan punca sebenar.' }],
    status: 'in_force',
    source: { doc: 'docs/QUALITY_AND_COMPLIANCE.md', decided: 'Fauzan, 5 Nov 2026 (rule QMS-OPERATIONS)' },
    words: 'service fault kesalahan perkhidmatan nonconformity complaint aduan klien client root cause punca',
  },
  {
    id: 'gov-controlled-document',
    app: 'gov',
    title: { en: 'Controlled documents and management review', ms: 'Dokumen terkawal dan kajian semula pengurusan' },
    purpose: {
      en: 'SOPs and policies keep one code across versions, each version approved by a second person; the yearly management review record is agreed by the CEO.',
      ms: 'SOP dan polisi mengekalkan satu kod merentas versi, setiap versi diluluskan oleh orang kedua; rekod kajian semula pengurusan dipersetujui oleh CEO.',
    },
    start: { view: 'quality', tab: 'documents', label: { en: 'Quality › Documents', ms: 'Kualiti › Dokumen' } },
    starter: { en: 'ACT or the Chief of Staff', ms: 'ACT atau Ketua Staf' },
    steps: [
      {
        who: { en: 'ACT or Chief of Staff (keeper)', ms: 'ACT atau Ketua Staf (penyimpan)' },
        does: { en: 'Adds the document version with its SharePoint link.', ms: 'Menambah versi dokumen bersama pautan SharePoint.' },
        where: { view: 'quality', tab: 'documents', label: { en: 'Quality › Documents', ms: 'Kualiti › Dokumen' } },
      },
      {
        who: { en: 'Another keeper or the CEO (never the writer)', ms: 'Penyimpan lain atau CEO (bukan penulis)' },
        does: { en: 'Approves the version or sends it back with a reason. The old version stays in force until then.', ms: 'Meluluskan versi atau menghantarnya balik dengan sebab. Versi lama kekal berkuat kuasa sehingga itu.' },
        where: { view: 'quality', tab: 'documents', label: { en: 'Quality › Documents', ms: 'Kualiti › Dokumen' } },
        decision: true,
      },
      {
        who: { en: 'ACT or Chief of Staff, then the CEO', ms: 'ACT atau Ketua Staf, kemudian CEO' },
        does: { en: 'Writes the management review record with the inputs pack Prima builds; the CEO agrees it.', ms: 'Menulis rekod kajian semula pengurusan dengan pek input yang Prima bina; CEO mempersetujuinya.' },
        where: { view: 'quality', tab: 'review', label: { en: 'Quality › Management review', ms: 'Kualiti › Kajian semula pengurusan' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Documents are reviewed every 24 months by default.', ms: 'Dokumen disemak setiap 24 bulan secara lalai.' },
      { en: 'Prima keeps the link and says it is not checked; the file stays in SharePoint.', ms: 'Prima menyimpan pautan dan menyatakan ia belum disemak; fail kekal di SharePoint.' },
      { en: 'Company Managers see only versions in force.', ms: 'Pengurus Syarikat hanya melihat versi yang berkuat kuasa.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/QUALITY_AND_COMPLIANCE.md', decided: 'Fauzan, 5 Nov 2026 (rule QMS-OPERATIONS)' },
    words: 'controlled document dokumen terkawal sop policy polisi version versi management review kajian semula pengurusan',
  },
  {
    id: 'gov-competency',
    app: 'gov',
    title: { en: 'Role competency: profiles and skill checks', ms: 'Kompetensi peranan: profil dan semakan kemahiran' },
    purpose: {
      en: 'HR proposes what each role needs (licences, training, skills); the HR Director agrees it; managers and officers assess their people, never themselves.',
      ms: 'HR mencadangkan keperluan setiap peranan (lesen, latihan, kemahiran); Pengarah HR mempersetujuinya; pengurus dan pegawai menilai orang mereka, bukan diri sendiri.',
    },
    start: { view: 'quality', tab: 'matrix', label: { en: 'Competency matrix', ms: 'Matriks kompetensi' } },
    starter: { en: 'HR Admin', ms: 'Pentadbir HR' },
    steps: [
      {
        who: { en: 'HR Admin', ms: 'Pentadbir HR' },
        does: { en: 'Proposes a role profile (or loads the four starter profiles).', ms: 'Mencadangkan profil peranan (atau memuatkan empat profil permulaan).' },
        where: { view: 'quality', tab: 'matrix', label: { en: 'Quality › Competency matrix', ms: 'Kualiti › Matriks kompetensi' } },
      },
      {
        who: { en: 'HR Director (Chief of Staff or Deputy)', ms: 'Pengarah HR (Ketua Staf atau Timbalan)' },
        does: { en: 'Agrees or sends back the profile with a reason, never one they proposed.', ms: 'Bersetuju atau menghantar balik profil dengan sebab, bukan yang dicadangkan sendiri.' },
        where: { view: 'quality', tab: 'matrix', label: { en: 'Quality › Competency matrix', ms: 'Kualiti › Matriks kompetensi' } },
        decision: true,
      },
      {
        who: { en: 'Company Manager, stationed officer, OM, or HR', ms: 'Pengurus Syarikat, pegawai bertugas, OM, atau HR' },
        does: {
          en: 'Assesses each person: competent or not yet, how it was assessed, what was seen, the refresher date and any course it follows.',
          ms: 'Menilai setiap orang: kompeten atau belum, cara penilaian, apa yang dilihat, tarikh ulangan dan kursus berkaitan.',
        },
        where: { view: 'quality', tab: 'matrix', label: { en: 'Quality › Competency matrix', ms: 'Kualiti › Matriks kompetensi' } },
      },
    ],
    rules: [
      { en: 'Licences and certificates are read from HR’s records; nobody types them twice.', ms: 'Lesen dan sijil dibaca daripada rekod HR; tiada sesiapa menaipnya dua kali.' },
      {
        en: 'Refreshers every 12 months for guards and officers; office Prima and PDPA training every 24 months.',
        ms: 'Ulangan setiap 12 bulan bagi pengawal dan pegawai; latihan Prima dan PDPA pejabat setiap 24 bulan.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/QUALITY_AND_COMPLIANCE.md', decided: 'Fauzan, 8 Nov 2026 (approved as built)' },
    words: 'competency kompetensi skill kemahiran guard skills assessment penilaian training latihan refresher profile',
  },
  {
    id: 'gov-supplier-rating',
    app: 'gov',
    title: { en: 'Supplier rating', ms: 'Penarafan pembekal' },
    purpose: {
      en: 'Procurement (or the Company Manager for its own suppliers) rates each supplier on quality, time and paperwork, again every 12 months.',
      ms: 'Perolehan (atau Pengurus Syarikat bagi pembekal sendiri) menilai setiap pembekal dari segi kualiti, masa dan dokumen, semula setiap 12 bulan.',
    },
    start: { view: 'quality', tab: 'suppliers', label: { en: 'Supplier ratings', ms: 'Penarafan pembekal' } },
    starter: { en: 'Procurement executive or Company Manager', ms: 'Eksekutif Perolehan atau Pengurus Syarikat' },
    steps: [
      {
        who: { en: 'Procurement executive', ms: 'Eksekutif Perolehan' },
        does: { en: 'Scores the supplier 1 to 5 for quality, time and paperwork; a low score, watch or stop needs a note.', ms: 'Memberi markah 1 hingga 5 untuk kualiti, masa dan dokumen; markah rendah, pantau atau henti perlu nota.' },
        where: { view: 'quality', tab: 'suppliers', label: { en: 'Supplier ratings', ms: 'Penarafan pembekal' } },
      },
      {
        who: { en: 'Finance', ms: 'Kewangan' },
        does: { en: '“Stop” blocks the supplier at once; only Finance unblocks it.', ms: '“Stop” menyekat pembekal serta-merta; hanya Kewangan boleh membuka sekatan.' },
        decision: true,
      },
    ],
    rules: [{ en: 'Each supplier is rated again every 12 months.', ms: 'Setiap pembekal dinilai semula setiap 12 bulan.' }],
    status: 'in_force',
    source: { doc: 'docs/QUALITY_AND_COMPLIANCE.md', decided: 'Fauzan, 5 Nov 2026' },
    words: 'supplier pembekal rating penarafan vendor procurement perolehan block sekat',
  },

  // ---------------------------------------------------------------- Management: offices and company governance
  {
    id: 'board-office-desks',
    app: 'board',
    title: { en: 'Sharing out the company office desks', ms: 'Membahagikan meja kerja pejabat syarikat' },
    purpose: {
      en: 'The head of each company office (GM, else Company Manager) gives each of the six desks an owner and a backup, so every piece of company work has a person today.',
      ms: 'Ketua setiap pejabat syarikat (GM, jika tiada Pengurus Syarikat) memberi setiap enam meja seorang pemilik dan pengganti, supaya setiap kerja syarikat ada orangnya hari ini.',
    },
    start: { view: 'office', label: { en: 'Share out desks', ms: 'Bahagikan meja' } },
    starter: { en: 'The company’s office head (GM or Company Manager)', ms: 'Ketua pejabat syarikat (GM atau Pengurus Syarikat)' },
    steps: [
      {
        who: { en: 'Office head', ms: 'Ketua pejabat' },
        does: {
          en: 'Picks an owner and a backup for each desk (guards and roster; clients and billing; tenders; licences and compliance; cases; office, purchases and claims) and saves with a note.',
          ms: 'Memilih pemilik dan pengganti bagi setiap meja (pengawal dan roster; klien dan bil; tender; lesen dan pematuhan; kes; pejabat, pembelian dan tuntutan) dan simpan dengan nota.',
        },
        where: { view: 'office', label: { en: 'Company office › Desks', ms: 'Pejabat syarikat › Meja' } },
      },
      {
        who: { en: 'Executives', ms: 'Eksekutif' },
        does: { en: 'Work the office queue for their desks; when an owner is on leave the backup holds the desk for the day.', ms: 'Mengerjakan giliran pejabat untuk meja mereka; apabila pemilik bercuti, pengganti memegang meja itu untuk hari itu.' },
        where: { view: 'office', label: { en: 'Company office', ms: 'Pejabat syarikat' } },
      },
      {
        who: { en: 'Group leaders', ms: 'Pemimpin kumpulan' },
        does: { en: 'Read every office’s staffing, cover and open work; they cannot change a company’s desks.', ms: 'Membaca kakitangan, liputan dan kerja terbuka setiap pejabat; mereka tidak boleh menukar meja syarikat.' },
        where: { view: 'office', label: { en: 'Company offices', ms: 'Pejabat syarikat' } },
      },
    ],
    rules: [
      { en: 'One head and 2 to 8 executives per company office.', ms: 'Seorang ketua dan 2 hingga 8 eksekutif bagi setiap pejabat syarikat.' },
      { en: 'If both owner and backup are away, the work falls to the head.', ms: 'Jika pemilik dan pengganti tiada, kerja jatuh kepada ketua.' },
      { en: 'Approvals and arms always stay with the head.', ms: 'Kelulusan dan senjata api sentiasa kekal dengan ketua.' },
      {
        en: 'A company with no licence or too little work can be run by another office; only the Chief of Staff or the CEO sets this, with a reason.',
        ms: 'Syarikat tanpa lesen atau kurang kerja boleh dijalankan oleh pejabat lain; hanya Ketua Staf atau CEO menetapkannya, dengan sebab.',
      },
    ],
    status: 'in_force',
    statusNote: { en: 'The six desks are a proposal; rename or merge them if the companies split work differently.', ms: 'Enam meja adalah cadangan; namakan semula atau gabungkan jika syarikat membahagi kerja secara berbeza.' },
    source: { doc: 'docs/COMPANY_OFFICE.md', decided: 'Fauzan, 2 and 3 Nov 2026' },
    words: 'company office pejabat syarikat desk meja backup pengganti gm company manager executive eksekutif run by',
  },
  {
    id: 'board-ceo-instruction',
    app: 'board',
    title: { en: 'CEO instruction', ms: 'Arahan CEO' },
    purpose: {
      en: 'The CEO (or the Director Office for the CEO) gives an instruction with what done means and a due date; it lands in the owner’s own Work list and the CEO accepts the result.',
      ms: 'CEO (atau Pejabat Pengarah bagi pihak CEO) memberi arahan bersama maksud siap dan tarikh akhir; ia masuk ke senarai Kerja pemilik dan CEO menerima hasilnya.',
    },
    start: { view: 'doa', label: { en: 'Give an instruction', ms: 'Beri arahan' } },
    starter: { en: 'CEO or the Director Office', ms: 'CEO atau Pejabat Pengarah' },
    steps: [
      {
        who: { en: 'CEO or Director Office Administrator', ms: 'CEO atau Pentadbir Pejabat Pengarah' },
        does: { en: 'Under “CEO instructions” picks who does it, writes the instruction, what done means and the due date.', ms: 'Di bawah “CEO instructions” pilih siapa yang buat, tulis arahan, maksud siap dan tarikh akhir.' },
        where: { view: 'doa', label: { en: 'Director Office › CEO instructions', ms: 'Pejabat Pengarah › Arahan CEO' } },
      },
      {
        who: { en: 'Owner', ms: 'Pemilik' },
        does: { en: 'Does it and marks it done with the proof in My work.', ms: 'Melaksanakannya dan tanda selesai dengan bukti di My work.' },
        where: { view: 'work', tab: 'mine', label: { en: 'Work › My work', ms: 'Kerja › Kerja saya' } },
      },
      {
        who: { en: 'CEO', ms: 'CEO' },
        does: { en: 'Accepts the result with a reason, or returns it with what to fix.', ms: 'Menerima hasil dengan sebab, atau memulangkannya dengan apa yang perlu dibetulkan.' },
        where: { view: 'doa', label: { en: 'Director Office › CEO instructions', ms: 'Pejabat Pengarah › Arahan CEO' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Overdue instructions reach the CEO’s home without anyone reporting them.', ms: 'Arahan yang lewat sampai ke laman utama CEO tanpa perlu dilaporkan.' },
      { en: 'The Director Office records instructions only for staff within its company access.', ms: 'Pejabat Pengarah merekod arahan hanya untuk staf dalam akses syarikatnya.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/CENTRAL_ADMIN_PHASE5.md', decided: 'Fauzan, 1 and 2 Nov 2026 (5E)' },
    words: 'ceo instruction arahan ceo task tugasan director office pejabat pengarah follow up',
  },
  {
    id: 'board-corporate-change',
    app: 'board',
    title: { en: 'Corporate change approved by PWVSB', ms: 'Perubahan korporat diluluskan oleh PWVSB' },
    purpose: {
      en: 'Any change to a company’s directors, shares, owners or other corporate details needs PWVSB approval before the board acts; the SSM filing then opens by itself.',
      ms: 'Sebarang perubahan kepada pengarah, saham, pemilik atau butiran korporat syarikat memerlukan kelulusan PWVSB sebelum lembaga bertindak; pemfailan SSM kemudian dibuka sendiri.',
    },
    start: { view: 'corporate', tab: 'changes', label: { en: 'Ask for a change', ms: 'Mohon perubahan' } },
    starter: { en: 'Company Manager', ms: 'Pengurus Syarikat' },
    steps: [
      {
        who: { en: 'Company Manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Asks PWVSB to approve the change, with the detail.', ms: 'Memohon PWVSB meluluskan perubahan, bersama butirannya.' },
        where: { view: 'corporate', tab: 'changes', label: { en: 'Company secretary › Corporate changes', ms: 'Setiausaha syarikat › Perubahan korporat' } },
      },
      {
        who: { en: 'Deputy Chief of Staff (never the person who raised it)', ms: 'Timbalan Ketua Staf (bukan orang yang memohon)' },
        does: { en: 'Approves or rejects with a reason, citing the signed clause. The Chief of Staff monitors.', ms: 'Meluluskan atau menolak dengan sebab, merujuk klausa yang ditandatangani. Ketua Staf memantau.' },
        where: { view: 'corporate', tab: 'changes', label: { en: 'Company secretary › Corporate changes', ms: 'Setiausaha syarikat › Perubahan korporat' } },
        decision: true,
      },
      {
        who: { en: 'Company Manager or Deputy Chief of Staff', ms: 'Pengurus Syarikat atau Timbalan Ketua Staf' },
        does: { en: 'Records the board resolution; the 14-day SSM filing opens by itself.', ms: 'Merekod resolusi lembaga; pemfailan SSM 14 hari dibuka sendiri.' },
        where: { view: 'corporate', tab: 'changes', label: { en: 'Company secretary › Corporate changes', ms: 'Setiausaha syarikat › Perubahan korporat' } },
      },
    ],
    rules: [{ en: 'Every approval carries a reason; nobody approves their own request.', ms: 'Setiap kelulusan disertakan sebab; tiada sesiapa meluluskan permohonan sendiri.' }],
    status: 'in_force',
    source: { doc: 'docs/CENTRAL_ADMIN_PHASE5.md', decided: 'Fauzan, 31 Oct and 2 Nov 2026 (5A)' },
    words: 'corporate change perubahan korporat director pengarah shares saham board resolution resolusi lembaga pwvsb',
  },
  {
    id: 'board-ssm-filing',
    app: 'board',
    title: { en: 'SSM filing (annual return, financial statements and others)', ms: 'Pemfailan SSM (penyata tahunan, penyata kewangan dan lain-lain)' },
    purpose: {
      en: 'Head office Corporate Admin records each company’s SSM lodgements from papers ready to SSM receipt; the company and its secretary view them.',
      ms: 'Pentadbiran Korporat ibu pejabat merekod pemfailan SSM setiap syarikat dari dokumen sedia hingga resit SSM; syarikat dan setiausahanya melihatnya.',
    },
    start: { view: 'corporate', tab: 'filings', label: { en: 'Add filing', ms: 'Tambah pemfailan' } },
    starter: { en: 'Deputy Chief of Staff (Corporate Admin)', ms: 'Timbalan Ketua Staf (Pentadbiran Korporat)' },
    steps: [
      {
        who: { en: 'Deputy Chief of Staff', ms: 'Timbalan Ketua Staf' },
        does: { en: 'Adds the filing with its due date, then marks the papers ready for the secretary.', ms: 'Menambah pemfailan bersama tarikh akhir, kemudian menanda dokumen sedia untuk setiausaha.' },
        where: { view: 'corporate', tab: 'filings', label: { en: 'Company secretary › Filings', ms: 'Setiausaha syarikat › Pemfailan' } },
      },
      {
        who: { en: 'Company secretary (outside Prima), then Deputy Chief of Staff', ms: 'Setiausaha syarikat (di luar Prima), kemudian Timbalan Ketua Staf' },
        does: { en: 'The secretary lodges in MBRS; the Deputy records “Secretary lodged it” with the reference.', ms: 'Setiausaha menghantar dalam MBRS; Timbalan merekod “Secretary lodged it” bersama rujukan.' },
        where: { view: 'corporate', tab: 'filings', label: { en: 'Company secretary › Filings', ms: 'Setiausaha syarikat › Pemfailan' } },
      },
      {
        who: { en: 'Deputy Chief of Staff', ms: 'Timbalan Ketua Staf' },
        does: { en: 'Records the SSM receipt; until then the filing waits for acknowledgement.', ms: 'Merekod resit SSM; sehingga itu pemfailan menunggu pengakuan.' },
        where: { view: 'corporate', tab: 'filings', label: { en: 'Company secretary › Filings', ms: 'Setiausaha syarikat › Pemfailan' } },
      },
    ],
    rules: [
      { en: 'Annual return within 30 days; financial statements circulated within 6 months of year end.', ms: 'Penyata tahunan dalam 30 hari; penyata kewangan diedarkan dalam 6 bulan selepas tahun kewangan berakhir.' },
      { en: 'Overdue filings show on the Deputy Chief of Staff’s home.', ms: 'Pemfailan lewat dipaparkan di laman utama Timbalan Ketua Staf.' },
    ],
    status: 'in_force',
    statusNote: { en: 'Deadlines follow the Companies Act 2016 and are for the secretaries to confirm.', ms: 'Tarikh akhir mengikut Akta Syarikat 2016 dan perlu disahkan oleh setiausaha.' },
    source: { doc: 'docs/CENTRAL_ADMIN_PHASE5.md', decided: 'Fauzan, 1 Nov 2026 (who holds the pen)' },
    words: 'ssm filing pemfailan annual return penyata tahunan mbrs secretary setiausaha financial statements',
  },
  {
    id: 'board-company-record',
    app: 'board',
    title: { en: 'Company record and company file checked against SSM', ms: 'Rekod syarikat dan fail syarikat disemak dengan SSM' },
    purpose: {
      en: 'The Head of Company keeps its company’s record (name, SSM number, dates, addresses) and company file (directors, shareholders, owners, key papers) as drafts; the Deputy Chief of Staff checks them against the SSM extract.',
      ms: 'Ketua Syarikat menyimpan rekod syarikat (nama, nombor SSM, tarikh, alamat) dan fail syarikat (pengarah, pemegang saham, pemilik, dokumen utama) sebagai draf; Timbalan Ketua Staf menyemaknya dengan ekstrak SSM.',
    },
    start: { view: 'company', label: { en: 'Company record', ms: 'Rekod syarikat' } },
    starter: { en: 'Head of Company (Company Manager)', ms: 'Ketua Syarikat (Pengurus Syarikat)' },
    steps: [
      {
        who: { en: 'Company Manager', ms: 'Pengurus Syarikat' },
        does: { en: 'Opens “Company record” on Company today and saves the company details as a draft, with the SSM source document reference.', ms: 'Buka “Company record” di Syarikat hari ini dan simpan butiran syarikat sebagai draf, bersama rujukan dokumen sumber SSM.' },
        where: { view: 'company', label: { en: 'Company today › Company record', ms: 'Syarikat hari ini › Rekod syarikat' } },
      },
      {
        who: { en: 'Company Manager or Central Admin', ms: 'Pengurus Syarikat atau Pentadbiran Pusat' },
        does: { en: 'Saves the company file (directors, shareholders, beneficial owners, constitution, key papers) as a draft.', ms: 'Menyimpan fail syarikat (pengarah, pemegang saham, pemilik benefisial, perlembagaan, dokumen utama) sebagai draf.' },
        where: { view: 'corporate', tab: 'files', label: { en: 'Company secretary › Company files', ms: 'Setiausaha syarikat › Fail syarikat' } },
      },
      {
        who: { en: 'Deputy Chief of Staff (never their own draft)', ms: 'Timbalan Ketua Staf (bukan draf sendiri)' },
        does: { en: '“Matches SSM” with the extract reference, or “Send back with differences”; the company fixes and resubmits.', ms: '“Matches SSM” bersama rujukan ekstrak, atau “Send back with differences”; syarikat membetulkan dan menghantar semula.' },
        where: { view: 'corporate', tab: 'files', label: { en: 'Company secretary › Company files', ms: 'Setiausaha syarikat › Fail syarikat' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Nobody checks their own draft; a confirmation needs a reason.', ms: 'Tiada sesiapa menyemak draf sendiri; pengesahan memerlukan sebab.' },
      { en: 'A beneficial owner not notified to SSM within 14 days is flagged.', ms: 'Pemilik benefisial yang tidak dimaklumkan kepada SSM dalam 14 hari ditanda.' },
      { en: 'SSM data comes only from company-authorised documents, never guesses.', ms: 'Data SSM hanya daripada dokumen yang dibenarkan syarikat, bukan tekaan.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/CENTRAL_ADMIN_PHASE5.md', decided: 'Fauzan, 1 and 2 Nov 2026 (5A part 3 and 5B)' },
    words: 'company record rekod syarikat company file fail syarikat ssm director pengarah shareholder pemegang saham beneficial owner',
  },
  {
    id: 'board-delegation',
    app: 'board',
    title: { en: 'Delegation and succession', ms: 'Delegasi dan penggantian' },
    purpose: {
      en: 'A register of who acts for whom, over what and until when (leave cover, emergency, succession). It gives nobody access or approval rights by itself.',
      ms: 'Daftar siapa bertindak bagi siapa, untuk apa dan sehingga bila (ganti cuti, kecemasan, penggantian). Ia sendiri tidak memberi akses atau hak kelulusan kepada sesiapa.',
    },
    start: { view: 'corporate', tab: 'delegations', label: { en: 'Record delegation', ms: 'Rekod delegasi' } },
    starter: { en: 'CEO or Chief of Staff (group posts); Company Manager (the company’s posts)', ms: 'CEO atau Ketua Staf (jawatan kumpulan); Pengurus Syarikat (jawatan syarikat)' },
    steps: [
      {
        who: { en: 'Keeper (CEO, Chief of Staff or Company Manager)', ms: 'Penyimpan (CEO, Ketua Staf atau Pengurus Syarikat)' },
        does: { en: 'Records the delegation line and its evidence (competency; for succession the board resolution).', ms: 'Merekod baris delegasi dan buktinya (kompetensi; bagi penggantian, resolusi lembaga).' },
        where: { view: 'corporate', tab: 'delegations', label: { en: 'Company secretary › Delegations', ms: 'Setiausaha syarikat › Delegasi' } },
      },
      {
        who: { en: 'One leader: CEO, COO or Chief of Staff (succession: the Chairman)', ms: 'Seorang pemimpin: CEO, COO atau Ketua Staf (penggantian: Pengerusi)' },
        does: { en: 'Approves with a reason, never the recorder or the person who acts.', ms: 'Meluluskan dengan sebab, bukan perekod atau orang yang bertindak.' },
        where: { view: 'corporate', tab: 'delegations', label: { en: 'Company secretary › Delegations', ms: 'Setiausaha syarikat › Delegasi' } },
        decision: true,
      },
      {
        who: { en: 'Keeper, then IT', ms: 'Penyimpan, kemudian IT' },
        does: { en: 'Asks IT for time-limited access and hands chosen open work over; at the end, asks IT to remove access and hands work back.', ms: 'Memohon IT akses terhad masa dan menyerahkan kerja terbuka yang dipilih; di akhir, memohon IT membuang akses dan memulangkan kerja.' },
        where: { view: 'corporate', tab: 'delegations', label: { en: 'Company secretary › Delegations', ms: 'Setiausaha syarikat › Delegasi' } },
      },
    ],
    rules: [
      { en: 'Emergency and leave cover need an end date; access lasts at most 90 days.', ms: 'Ganti kecemasan dan cuti perlu tarikh tamat; akses paling lama 90 hari.' },
      { en: 'A succession is put in force only by the Chairman, alone or consenting after the CEO.', ms: 'Penggantian hanya berkuat kuasa oleh Pengerusi, sendiri atau dengan persetujuan selepas CEO.' },
      { en: 'Lines are ended or revoked with a reason, never deleted.', ms: 'Baris ditamatkan atau dibatalkan dengan sebab, tidak dipadam.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/CENTRAL_ADMIN_PHASE5.md', decided: 'Fauzan, 3 Nov 2026 (one leader approves; successions by the Chairman)' },
    words: 'delegation delegasi succession penggantian acting pemangku cover ganti critical post jawatan kritikal',
  },
  {
    id: 'board-legal-hold',
    app: 'board',
    title: { en: 'Legal hold on records', ms: 'Penahanan undang-undang ke atas rekod' },
    purpose: {
      en: 'For an open legal matter, Legal places a hold on records; while it stands the database keeps every earlier version and refuses deletes. Staff work is not stopped and staff are not told.',
      ms: 'Bagi perkara undang-undang yang terbuka, Undang-undang meletakkan penahanan ke atas rekod; semasa berkuat kuasa pangkalan data menyimpan setiap versi terdahulu dan menolak pemadaman. Kerja staf tidak dihentikan dan staf tidak dimaklumkan.',
    },
    start: { view: 'corporate', tab: 'legal', label: { en: 'Place hold', ms: 'Letak penahanan' } },
    starter: { en: 'PWVSB legal or the Deputy Chief of Staff', ms: 'Undang-undang PWVSB atau Timbalan Ketua Staf' },
    steps: [
      {
        who: { en: 'PWVSB legal or Deputy Chief of Staff', ms: 'Undang-undang PWVSB atau Timbalan Ketua Staf' },
        does: { en: 'Places the hold on the record with a reason, kept on the legal matter.', ms: 'Meletakkan penahanan ke atas rekod dengan sebab, disimpan pada perkara undang-undang.' },
        where: { view: 'corporate', tab: 'legal', label: { en: 'Company secretary › Legal matters', ms: 'Setiausaha syarikat › Perkara undang-undang' } },
      },
      {
        who: { en: 'PWVSB legal or Deputy Chief of Staff', ms: 'Undang-undang PWVSB atau Timbalan Ketua Staf' },
        does: { en: 'Releases the hold with a reason when the matter allows.', ms: 'Melepaskan penahanan dengan sebab apabila perkara itu membenarkan.' },
        where: { view: 'corporate', tab: 'legal', label: { en: 'Company secretary › Legal matters', ms: 'Setiausaha syarikat › Perkara undang-undang' } },
        decision: true,
      },
    ],
    rules: [{ en: 'Seen only by legal and group leaders.', ms: 'Dilihat hanya oleh undang-undang dan pemimpin kumpulan.' }],
    status: 'in_force',
    source: { doc: 'docs/CENTRAL_ADMIN_PHASE5.md', decided: 'Fauzan, 3 Nov 2026 (§125 “proceed work”)' },
    words: 'legal hold penahanan undang-undang litigation preserve simpan record rekod court mahkamah',
  },
  {
    id: 'board-mandate',
    app: 'board',
    title: { en: 'Mandate (management agreement or board mandate)', ms: 'Mandat (perjanjian pengurusan atau mandat lembaga)' },
    purpose: {
      en: 'PWVSB acts in a company only under a signed agreement or mandate that the company’s board confirmed and PWVSB legal verified.',
      ms: 'PWVSB bertindak dalam syarikat hanya di bawah perjanjian atau mandat bertandatangan yang disahkan lembaga syarikat dan disemak oleh undang-undang PWVSB.',
    },
    start: { view: 'governance', tab: 'mandates', label: { en: 'Add mandate', ms: 'Tambah mandat' } },
    starter: { en: 'PWVSB legal or the Chief of Staff', ms: 'Undang-undang PWVSB atau Ketua Staf' },
    steps: [
      {
        who: { en: 'PWVSB legal or Chief of Staff', ms: 'Undang-undang PWVSB atau Ketua Staf' },
        does: { en: 'Adds the signed agreement or mandate with the powers it gives PWVSB.', ms: 'Menambah perjanjian atau mandat bertandatangan bersama kuasa yang diberi kepada PWVSB.' },
        where: { view: 'governance', tab: 'mandates', label: { en: 'Mandates', ms: 'Mandat' } },
      },
      {
        who: { en: 'The company (Company Manager)', ms: 'Syarikat (Pengurus Syarikat)' },
        does: { en: 'Records that its board confirmed it, with the resolution reference.', ms: 'Merekod bahawa lembaganya telah mengesahkan, bersama rujukan resolusi.' },
        where: { view: 'governance', tab: 'mandates', label: { en: 'Mandates', ms: 'Mandat' } },
        decision: true,
      },
      {
        who: { en: 'PWVSB legal (not the person who added it)', ms: 'Undang-undang PWVSB (bukan orang yang menambahnya)' },
        does: { en: 'Verifies the signed copy with a reason. Only then is it in force.', ms: 'Mengesahkan salinan bertandatangan dengan sebab. Barulah ia berkuat kuasa.' },
        where: { view: 'governance', tab: 'mandates', label: { en: 'Mandates', ms: 'Mandat' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'An area with no live mandate shows as Unknown, never covered.', ms: 'Bidang tanpa mandat yang aktif dipaparkan Unknown, bukan dilindungi.' },
      { en: 'It warns before the end date and gives no power after it.', ms: 'Ia memberi amaran sebelum tarikh tamat dan tiada kuasa selepasnya.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The areas and wording are proposals for counsel to check against the signed agreements.', ms: 'Bidang dan perkataan adalah cadangan untuk peguam semak dengan perjanjian yang ditandatangani.' },
    source: { doc: 'docs/system/screens/central-admin.md', decided: 'V7, V8, V12 (24 Oct 2026); legal reason required (5A)' },
    words: 'mandate mandat management agreement perjanjian pengurusan authority kuasa board lembaga legal',
  },
  {
    id: 'board-related-party-deal',
    app: 'board',
    title: { en: 'Related-party deal', ms: 'Urus niaga pihak berkaitan' },
    purpose: {
      en: 'Any rent, loan, purchase, fee or rental between a group company and a director, shareholder, their family, their companies or another PWVSB company is recorded and reviewed.',
      ms: 'Sebarang sewa, pinjaman, pembelian, yuran atau sewaan antara syarikat kumpulan dengan pengarah, pemegang saham, keluarga mereka, syarikat mereka atau syarikat PWVSB lain direkod dan disemak.',
    },
    start: { view: 'registers', tab: 'deals', label: { en: 'Record a deal', ms: 'Rekod urus niaga' } },
    starter: { en: 'Deputy Chief of Staff', ms: 'Timbalan Ketua Staf' },
    steps: [
      {
        who: { en: 'Deputy Chief of Staff', ms: 'Timbalan Ketua Staf' },
        does: { en: 'Records the deal; Prima matches the other party against declared interests as a hint.', ms: 'Merekod urus niaga; Prima memadankan pihak lain dengan kepentingan yang diisytiharkan sebagai petunjuk.' },
        where: { view: 'registers', tab: 'deals', label: { en: 'Governance registers › Related-party deals', ms: 'Daftar tadbir urus › Urus niaga pihak berkaitan' } },
      },
      {
        who: { en: 'Chief of Staff (never someone named as interested)', ms: 'Ketua Staf (bukan orang yang dinamakan berkepentingan)' },
        does: { en: 'Reviews with a reason (“Price is fair”) or asks a question for the Deputy to answer.', ms: 'Menyemak dengan sebab (“Price is fair”) atau bertanya soalan untuk dijawab Timbalan.' },
        where: { view: 'registers', tab: 'deals', label: { en: 'Governance registers › Related-party deals', ms: 'Daftar tadbir urus › Urus niaga pihak berkaitan' } },
        decision: true,
      },
      {
        who: { en: 'The company board (outside Prima), then the Deputy', ms: 'Lembaga syarikat (di luar Prima), kemudian Timbalan' },
        does: { en: 'At or above the CEO’s board limit, the board resolves with interested directors out of the vote; the Deputy records it.', ms: 'Pada atau melebihi had lembaga CEO, lembaga membuat resolusi tanpa undi pengarah berkepentingan; Timbalan merekodnya.' },
        where: { view: 'registers', tab: 'deals', label: { en: 'Governance registers › Related-party deals', ms: 'Daftar tadbir urus › Urus niaga pihak berkaitan' } },
      },
    ],
    rules: [
      { en: 'No board step until the CEO sets a limit (with a reason, kept in its history).', ms: 'Tiada langkah lembaga sehingga CEO menetapkan had (dengan sebab, disimpan dalam sejarahnya).' },
      { en: 'Prima never approves for the board, signs or files.', ms: 'Prima tidak sekali-kali meluluskan bagi pihak lembaga, menandatangan atau memfail.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The board limit amount is not set yet by the CEO.', ms: 'Jumlah had lembaga belum ditetapkan oleh CEO.' },
    source: { doc: 'docs/GOVERNANCE_REGISTERS.md', decided: 'Fauzan, 5 Nov 2026 (second round)' },
    words: 'related party pihak berkaitan deal urus niaga director pengarah shareholder conflict konflik loan pinjaman rent sewa',
  },
  {
    id: 'board-director-interests',
    app: 'board',
    title: { en: 'Directors’ yearly declaration of interests', ms: 'Pengisytiharan kepentingan tahunan pengarah' },
    purpose: {
      en: 'Each director declares once a year (and when something changes) on a signed paper form; the Deputy Chief of Staff records it and the Chief of Staff reads it.',
      ms: 'Setiap pengarah mengisytiharkan sekali setahun (dan apabila ada perubahan) melalui borang kertas bertandatangan; Timbalan Ketua Staf merekodnya dan Ketua Staf membacanya.',
    },
    start: { view: 'registers', tab: 'interests', label: { en: 'Directors’ interests', ms: 'Kepentingan pengarah' } },
    starter: { en: 'Deputy Chief of Staff', ms: 'Timbalan Ketua Staf' },
    steps: [
      {
        who: { en: 'Director', ms: 'Pengarah' },
        does: { en: 'Fills and signs the yearly form, collected by hand.', ms: 'Mengisi dan menandatangani borang tahunan, dikutip secara manual.' },
        outside: true,
      },
      {
        who: { en: 'Deputy Chief of Staff', ms: 'Timbalan Ketua Staf' },
        does: { en: 'Records the declaration and marks the director done for the year.', ms: 'Merekod pengisytiharan dan menanda pengarah selesai untuk tahun itu.' },
        where: { view: 'registers', tab: 'interests', label: { en: 'Governance registers › Directors’ interests', ms: 'Daftar tadbir urus › Kepentingan pengarah' } },
      },
      {
        who: { en: 'Chief of Staff', ms: 'Ketua Staf' },
        does: { en: 'Reads it and records a comment.', ms: 'Membacanya dan merekod ulasan.' },
        where: { view: 'registers', tab: 'interests', label: { en: 'Governance registers › Directors’ interests', ms: 'Daftar tadbir urus › Kepentingan pengarah' } },
      },
    ],
    rules: [{ en: 'No declaration shows as Unknown, never clear (Companies Act 2016 s.221).', ms: 'Tiada pengisytiharan dipaparkan Unknown, bukan bersih (Akta Syarikat 2016 s.221).' }],
    status: 'in_force',
    source: { doc: 'docs/GOVERNANCE_REGISTERS.md', decided: 'Fauzan, 5 Nov 2026' },
    words: 'director interests kepentingan pengarah declaration pengisytiharan s221 conflict yearly tahunan',
  },
  {
    id: 'board-risk-register',
    app: 'board',
    title: { en: 'Risk register', ms: 'Daftar risiko' },
    purpose: {
      en: 'The ACT Director keeps the group’s risks, gives each to an ACT team member to review, and settles and closes them. The CEO views.',
      ms: 'Pengarah ACT menyimpan risiko kumpulan, memberi setiap satu kepada ahli pasukan ACT untuk disemak, dan menyelesaikan serta menutupnya. CEO melihat.',
    },
    start: { view: 'registers', tab: 'risks', label: { en: 'Governance registers › Risks', ms: 'Daftar tadbir urus › Risiko' } },
    starter: { en: 'ACT Director', ms: 'Pengarah ACT' },
    steps: [
      {
        who: { en: 'ACT Director', ms: 'Pengarah ACT' },
        does: { en: 'Adds the risk with likelihood and impact (5 x 5) and gives it to a team member with an instruction.', ms: 'Menambah risiko dengan kebarangkalian dan impak (5 x 5) dan memberinya kepada ahli pasukan dengan arahan.' },
        where: { view: 'registers', tab: 'risks', label: { en: 'Governance registers › Risks', ms: 'Daftar tadbir urus › Risiko' } },
      },
      {
        who: { en: 'ACT team member', ms: 'Ahli pasukan ACT' },
        does: { en: 'Reviews the risk and records the review.', ms: 'Menyemak risiko dan merekod semakan.' },
        where: { view: 'registers', tab: 'risks', label: { en: 'Governance registers › Risks', ms: 'Daftar tadbir urus › Risiko' } },
      },
      {
        who: { en: 'ACT Director', ms: 'Pengarah ACT' },
        does: { en: 'Settles and closes it.', ms: 'Menyelesaikan dan menutupnya.' },
        where: { view: 'registers', tab: 'risks', label: { en: 'Governance registers › Risks', ms: 'Daftar tadbir urus › Risiko' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A score of 15 or more is high: it needs an action and a due date and is reviewed every 3 months; others every 6.', ms: 'Skor 15 ke atas adalah tinggi: perlu tindakan dan tarikh akhir dan disemak setiap 3 bulan; yang lain setiap 6 bulan.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The 5 x 5 scoring and review periods are proposals for the CEO.', ms: 'Pemarkahan 5 x 5 dan tempoh semakan adalah cadangan untuk CEO.' },
    source: { doc: 'docs/GOVERNANCE_REGISTERS.md', decided: 'Fauzan, 5 Nov 2026 (risk register is ACT only)' },
    words: 'risk risiko register daftar heat map likelihood kebarangkalian impact impak act',
  },
  {
    id: 'board-pdpa-breach',
    app: 'board',
    title: { en: 'Personal data breach', ms: 'Pelanggaran data peribadi' },
    purpose: {
      en: 'The PDPA officer handles every breach: contain it, tell the PDP Commissioner within 72 hours, and the affected people within 7 days after that when the harm is significant.',
      ms: 'Pegawai PDPA mengendalikan setiap pelanggaran: bendung, maklumkan Pesuruhjaya PDP dalam 72 jam, dan orang yang terjejas dalam 7 hari selepas itu jika kemudaratan ketara.',
    },
    start: { view: 'pdpa', tab: 'BREACH', label: { en: 'Open a case', ms: 'Buka kes' } },
    starter: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
    steps: [
      {
        who: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
        does: { en: 'Opens the breach case; the 72-hour clock counts down on screen.', ms: 'Membuka kes pelanggaran; jam 72 jam mengira detik di skrin.' },
        where: { view: 'pdpa', tab: 'BREACH', label: { en: 'PDPA › Breaches', ms: 'PDPA › Pelanggaran' } },
      },
      {
        who: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
        does: { en: 'Records Contained, Commissioner notified and, if needed, People notified, with notes and proof; then closes.', ms: 'Merekod Contained, Commissioner notified dan, jika perlu, People notified, dengan nota dan bukti; kemudian tutup.' },
        where: { view: 'pdpa', tab: 'BREACH', label: { en: 'PDPA › Breaches', ms: 'PDPA › Pelanggaran' } },
      },
      {
        who: { en: 'Operations Director, Chief of Staff, CEO', ms: 'Pengarah Operasi, Ketua Staf, CEO' },
        does: { en: 'Monitor; a late notice shows on the CEO’s home.', ms: 'Memantau; notis lewat dipaparkan di laman utama CEO.' },
        where: { view: 'pdpa', tab: 'BREACH_REGISTER', label: { en: 'PDPA › Breach register', ms: 'PDPA › Daftar pelanggaran' } },
      },
    ],
    rules: [
      { en: 'Every breach, notified or not, stays on the breach register for at least 2 years.', ms: 'Setiap pelanggaran, dimaklumkan atau tidak, kekal dalam daftar pelanggaran sekurang-kurangnya 2 tahun.' },
      { en: 'PDPA cases are never routed to other departments.', ms: 'Kes PDPA tidak sekali-kali dihantar ke jabatan lain.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/central-admin.md', decided: 'PDPA (Amendment) Act 2024 s.12B; Fauzan, 26 Oct and 5 Nov 2026' },
    words: 'pdpa breach pelanggaran data peribadi personal data commissioner pesuruhjaya 72 hours jam leak kebocoran',
  },
  {
    id: 'board-pdpa-request',
    app: 'board',
    title: { en: 'A person’s request about their own data', ms: 'Permohonan seseorang tentang data sendiri' },
    purpose: {
      en: 'Access, correction, a copy to move elsewhere, withdrawing consent or objecting: logged, identity checked first, answered within 21 days or refused only on the Act’s grounds.',
      ms: 'Akses, pembetulan, salinan untuk dipindah, menarik balik persetujuan atau bantahan: direkod, identiti disemak dahulu, dijawab dalam 21 hari atau ditolak hanya atas alasan Akta.',
    },
    start: { view: 'pdpa', tab: 'REQUESTS', label: { en: 'Log a request', ms: 'Rekod permohonan' } },
    starter: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
    steps: [
      {
        who: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
        does: { en: 'Logs the request with who asked, what kind and the day it was received; the 21-day clock starts.', ms: 'Merekod permohonan dengan siapa yang meminta, jenis dan tarikh diterima; jam 21 hari bermula.' },
        where: { view: 'pdpa', tab: 'REQUESTS', label: { en: 'PDPA › Data requests', ms: 'PDPA › Permohonan data' } },
      },
      {
        who: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
        does: { en: 'Records “Identity checked” first.', ms: 'Merekod “Identity checked” dahulu.' },
        where: { view: 'pdpa', tab: 'REQUESTS', label: { en: 'PDPA › Data requests', ms: 'PDPA › Permohonan data' } },
      },
      {
        who: { en: 'PDPA officer', ms: 'Pegawai PDPA' },
        does: { en: 'Answers it, or refuses on one of the Act’s grounds, in writing.', ms: 'Menjawabnya, atau menolak atas salah satu alasan Akta, secara bertulis.' },
        where: { view: 'pdpa', tab: 'REQUESTS', label: { en: 'PDPA › Data requests', ms: 'PDPA › Permohonan data' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'Access and correction within 21 days (PDPA s.31 and s.35).', ms: 'Akses dan pembetulan dalam 21 hari (PDPA s.31 dan s.35).' },
      { en: 'Each company’s data protection officer is notified to the Commissioner within 21 days (DPO register).', ms: 'Pegawai perlindungan data setiap syarikat dimaklumkan kepada Pesuruhjaya dalam 21 hari (daftar DPO).' },
    ],
    status: 'in_force',
    statusNote: { en: 'The 21-day period for portability is a proposal; counsel to confirm.', ms: 'Tempoh 21 hari untuk kemudahalihan data adalah cadangan; peguam perlu mengesahkan.' },
    source: { doc: 'docs/system/screens/central-admin.md', decided: 'PDPA 2010 and 2024 amendments (rule PDPA-RIGHTS)' },
    words: 'pdpa data request permohonan data access akses correction pembetulan consent persetujuan dpo portability',
  },

  // ---------------------------------------------------------------- Everyday work screens (Work, Meetings, Memos, Reports)
  {
    id: 'board-work-task',
    app: 'board',
    title: { en: 'A task: given, done with proof, accepted', ms: 'Tugasan: diberi, siap dengan bukti, diterima' },
    purpose: {
      en: 'Everyone sees what to do and what “done” means; the person finishes with proof, asks for more time or help; the manager accepts or returns it with a comment.',
      ms: 'Semua orang melihat apa yang perlu dibuat dan maksud “siap”; orang itu menyiapkan dengan bukti, meminta masa tambahan atau bantuan; pengurus menerima atau memulangkan dengan ulasan.',
    },
    start: { view: 'work', tab: 'team', label: { en: 'Give a task', ms: 'Beri tugasan' } },
    starter: { en: 'Line manager (group leaders may give a task to anyone on staff)', ms: 'Pengurus langsung (pemimpin kumpulan boleh memberi tugasan kepada mana-mana staf)' },
    steps: [
      {
        who: { en: 'Line manager', ms: 'Pengurus langsung' },
        does: { en: 'Gives the task with what done means, the due time and priority.', ms: 'Memberi tugasan bersama maksud siap, masa akhir dan keutamaan.' },
        where: { view: 'work', tab: 'team', label: { en: 'Work › My team', ms: 'Kerja › Pasukan saya' } },
      },
      {
        who: { en: 'Staff member', ms: 'Staf' },
        does: {
          en: 'Sends the morning check-in by 10:00, then marks the task done with the proof, or asks for more time with a reason, or presses “Stuck? Ask for help”.',
          ms: 'Menghantar daftar masuk pagi sebelum 10:00, kemudian tanda tugasan siap dengan bukti, atau minta masa tambahan dengan sebab, atau tekan “Stuck? Ask for help”.',
        },
        where: { view: 'work', tab: 'mine', label: { en: 'Work › My work', ms: 'Kerja › Kerja saya' } },
      },
      {
        who: { en: 'Line manager', ms: 'Pengurus langsung' },
        does: { en: 'Accepts it, or returns it to fix, with a comment.', ms: 'Menerimanya, atau memulangkan untuk dibetulkan, dengan ulasan.' },
        where: { view: 'work', tab: 'team', label: { en: 'Work › My team', ms: 'Kerja › Pasukan saya' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A help request not answered within 30 minutes shows to the manager’s manager.', ms: 'Permintaan bantuan yang tidak dijawab dalam 30 minit dipaparkan kepada pengurus kepada pengurus.' },
      { en: 'A one-to-one with each team member every week; missing after 7 days shows on the manager’s list.', ms: 'Sesi satu-ke-satu dengan setiap ahli pasukan setiap minggu; tiada selepas 7 hari dipaparkan dalam senarai pengurus.' },
      { en: 'Only the person’s managers (or the named duty checker) accept or return a task, always with a comment.', ms: 'Hanya pengurus orang itu (atau penyemak tugas yang dinamakan) menerima atau memulangkan tugasan, sentiasa dengan ulasan.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The “due soon” 3 days and the 80% on-time standard are proposals.', ms: '“Due soon” 3 hari dan standard 80% tepat masa adalah cadangan.' },
    source: { doc: 'docs/system/04-workflows.md', decided: 'Fauzan, 27 Oct 2026 (D2, D3)' },
    words: 'task tugasan work kerja done siap proof bukti check-in daftar masuk help bantuan one-to-one manager pengurus',
  },
  {
    id: 'board-duty-checklist',
    app: 'board',
    title: { en: 'Duty checklists (daily to yearly duties)', ms: 'Senarai tugas (harian hingga tahunan)' },
    purpose: {
      en: 'Each company or unit loads the group template of duties per person; each line opens as a task in My work in its window, and done in the window counts on time.',
      ms: 'Setiap syarikat atau unit memuatkan templat tugas kumpulan bagi setiap orang; setiap baris dibuka sebagai tugasan di My work dalam tempohnya, dan siap dalam tempoh dikira tepat masa.',
    },
    start: { view: 'meetings', tab: 'monthly', label: { en: 'Muat templat kumpulan', ms: 'Muat templat kumpulan' } },
    starter: { en: 'Company Manager or unit head', ms: 'Pengurus Syarikat atau ketua unit' },
    steps: [
      {
        who: { en: 'Company Manager or unit head', ms: 'Pengurus Syarikat atau ketua unit' },
        does: {
          en: 'In “Senarai tugas” loads the template for a person with PIC, backup and checker (not the PIC), then adds or removes lines (removing needs a reason).',
          ms: 'Di “Senarai tugas” muatkan templat untuk seseorang dengan PIC, pengganti dan penyemak (bukan PIC), kemudian tambah atau buang baris (membuang perlu sebab).',
        },
        where: { view: 'meetings', tab: 'monthly', label: { en: 'Meetings › JA Group monthly meeting', ms: 'Mesyuarat › Mesyuarat bulanan JA Group' } },
      },
      {
        who: { en: 'The PIC', ms: 'PIC' },
        does: { en: 'Does the task when it opens (due on the last day of the window at 17:00) and marks it done with proof.', ms: 'Melaksanakan tugasan apabila dibuka (tamat pada hari terakhir tempoh jam 17:00) dan tanda siap dengan bukti.' },
        where: { view: 'work', tab: 'mine', label: { en: 'Work › My work', ms: 'Kerja › Kerja saya' } },
      },
      {
        who: { en: 'The named checker or the line manager', ms: 'Penyemak yang dinamakan atau pengurus langsung' },
        does: { en: 'Accepts or returns each task.', ms: 'Menerima atau memulangkan setiap tugasan.' },
        where: { view: 'work', tab: 'team', label: { en: 'Work › My team', ms: 'Kerja › Pasukan saya' } },
        decision: true,
      },
    ],
    rules: [{ en: '“KPI senarai tugas” shows each person’s on-time share for the month.', ms: '“KPI senarai tugas” menunjukkan peratus tepat masa setiap orang bagi bulan itu.' }],
    status: 'in_force',
    statusNote: { en: 'Real checklist lines are entered by each company or unit only after the real-data go-ahead.', ms: 'Baris senarai tugas sebenar dimasukkan oleh syarikat atau unit hanya selepas kebenaran data sebenar.' },
    source: { doc: 'docs/GROUP_MONTHLY_MEETING.md', decided: 'Fauzan, answers Y-Q1 to Y-Q10, 14 Nov 2026 (Y6, Y7)' },
    words: 'duty checklist senarai tugas daily harian monthly bulanan yearly tahunan pic backup kpi template templat',
  },
  {
    id: 'board-meeting',
    app: 'board',
    title: { en: 'A meeting: agenda, pre-brief, minutes, actions', ms: 'Mesyuarat: agenda, taklimat awal, minit, tindakan' },
    purpose: {
      en: 'Every meeting has an agenda and a pre-briefing checklist ready 24 hours before; after it the minutes and action items are kept, and the Director Office confirms the summary.',
      ms: 'Setiap mesyuarat ada agenda dan senarai semak taklimat awal yang siap 24 jam sebelum; selepasnya minit dan item tindakan disimpan, dan Pejabat Pengarah mengesahkan ringkasan.',
    },
    start: { view: 'meetings', tab: 'meetings', label: { en: 'New meeting', ms: 'Mesyuarat baru' } },
    starter: { en: 'Director Office, department heads, Company Managers (whoever may schedule)', ms: 'Pejabat Pengarah, ketua jabatan, Pengurus Syarikat (yang boleh menjadualkan)' },
    steps: [
      {
        who: { en: 'Organiser', ms: 'Penganjur' },
        does: { en: 'Sets the meeting (one time or repeating) with its agenda and invitees; a checklist for its kind is added.', ms: 'Menetapkan mesyuarat (sekali atau berulang) dengan agenda dan jemputan; senarai semak mengikut jenisnya ditambah.' },
        where: { view: 'meetings', tab: 'meetings', label: { en: 'Meetings and minutes', ms: 'Mesyuarat dan minit' } },
      },
      {
        who: { en: 'Invitees', ms: 'Jemputan' },
        does: { en: 'Answer the invitation (yes, maybe, or no with a reason).', ms: 'Menjawab jemputan (ya, mungkin, atau tidak dengan sebab).' },
        where: { view: 'meetings', tab: 'meetings', label: { en: 'Meetings and minutes', ms: 'Mesyuarat dan minit' } },
      },
      {
        who: { en: 'Organiser', ms: 'Penganjur' },
        does: { en: 'Ticks the pre-briefing checklist; after the meeting saves the minutes and adds action items with owners and dates.', ms: 'Menanda senarai semak taklimat awal; selepas mesyuarat simpan minit dan tambah item tindakan dengan pemilik dan tarikh.' },
        where: { view: 'meetings', tab: 'meetings', label: { en: 'Meetings and minutes', ms: 'Mesyuarat dan minit' } },
      },
      {
        who: { en: 'Director Office', ms: 'Pejabat Pengarah' },
        does: { en: 'Checks the summary (“Summary is right”).', ms: 'Menyemak ringkasan (“Summary is right”).' },
        where: { view: 'meetings', tab: 'meetings', label: { en: 'Meetings and minutes', ms: 'Mesyuarat dan minit' } },
        decision: true,
      },
      {
        who: { en: 'Action owners', ms: 'Pemilik tindakan' },
        does: { en: 'Mark their action items done.', ms: 'Menanda item tindakan mereka selesai.' },
        where: { view: 'meetings', tab: 'mine', label: { en: 'Meetings › My action items', ms: 'Mesyuarat › Item tindakan saya' } },
      },
    ],
    rules: [
      { en: 'A meeting not ready 24 hours before is flagged.', ms: 'Mesyuarat yang tidak siap 24 jam sebelum ditanda.' },
      {
        en: 'Standing meetings: group management, department toolbox and company office every two weeks; the COO joins each company operations meeting every two months; company board once a year; a monthly general meeting.',
        ms: 'Mesyuarat tetap: pengurusan kumpulan, toolbox jabatan dan pejabat syarikat setiap dua minggu; COO menyertai mesyuarat operasi setiap syarikat setiap dua bulan; lembaga syarikat sekali setahun; mesyuarat agung bulanan.',
      },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/screens/home-and-leadership.md', decided: 'Fauzan, 25 Oct and 5 Nov 2026 (rule MTG-PREP)' },
    words: 'meeting mesyuarat agenda minutes minit action item tindakan pre-brief taklimat calendar kalendar outlook',
  },
  {
    id: 'board-toolbox',
    app: 'board',
    title: { en: 'Company and department toolbox meeting (every 2 weeks)', ms: 'Mesyuarat toolbox syarikat dan jabatan (setiap 2 minggu)' },
    purpose: {
      en: 'The HQ status meeting of every company and department: Prima builds the status pack from the records, the preparer writes the minutes, a director (or the manager) verifies them.',
      ms: 'Mesyuarat status ibu pejabat setiap syarikat dan jabatan: Prima membina pek status daripada rekod, penyedia menulis minit, pengarah (atau pengurus) mengesahkannya.',
    },
    start: { view: 'meetings', tab: 'toolbox', label: { en: 'Bina pek status', ms: 'Bina pek status' } },
    starter: { en: 'The company’s or department’s preparer (admin team)', ms: 'Penyedia syarikat atau jabatan (pasukan admin)' },
    steps: [
      {
        who: { en: 'Preparer', ms: 'Penyedia' },
        does: { en: 'Presses “Bina pek status”: each section is filled from the records and frozen; a missing record shows “tiada rekod”.', ms: 'Tekan “Bina pek status”: setiap bahagian diisi daripada rekod dan dibekukan; rekod yang tiada dipaparkan “tiada rekod”.' },
        where: { view: 'meetings', tab: 'toolbox', label: { en: 'Meetings › Toolbox', ms: 'Mesyuarat › Toolbox' } },
      },
      {
        who: { en: 'Preparer', ms: 'Penyedia' },
        does: {
          en: 'Updates the status lines (matter, status, owner, target), ticks each section changed or no change, pastes and checks any AI notes, then submits.',
          ms: 'Mengemas kini baris status (perkara, status, pemilik, sasaran), menanda setiap bahagian berubah atau tiada perubahan, menampal dan menyemak nota AI, kemudian menghantar.',
        },
        where: { view: 'meetings', tab: 'toolbox', label: { en: 'Meetings › Toolbox', ms: 'Mesyuarat › Toolbox' } },
      },
      {
        who: { en: 'Chairing director, else the Company Manager (only if no director attended), the department head or the visiting central director', ms: 'Pengarah yang mempengerusikan, jika tidak Pengurus Syarikat (hanya jika tiada pengarah hadir), ketua jabatan atau pengarah pusat yang melawat' },
        does: { en: 'Verifies with a comment, or returns with a reason. Never the preparer.', ms: 'Mengesahkan dengan ulasan, atau memulangkan dengan sebab. Bukan penyedia.' },
        where: { view: 'meetings', tab: 'toolbox', label: { en: 'Meetings › Toolbox', ms: 'Mesyuarat › Toolbox' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'The meeting counts as held only once its minutes are verified; verified minutes lock and a correction is a new version with a reason.', ms: 'Mesyuarat dikira diadakan hanya selepas minit disahkan; minit yang disahkan dikunci dan pembetulan ialah versi baru dengan sebab.' },
      { en: 'IC numbers are masked everywhere; bank accounts show the last 4 digits.', ms: 'Nombor IC disembunyikan di semua tempat; akaun bank hanya menunjukkan 4 digit terakhir.' },
      { en: 'The OM records site safety and operations talks; sites with none in 30 days show on the OM’s list.', ms: 'OM merekod taklimat keselamatan dan operasi tapak; tapak tanpanya dalam 30 hari dipaparkan dalam senarai OM.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/COMPANY_TOOLBOX_MEETING.md', decided: 'Fauzan, answers X-Q1 to X-Q11, 14 Nov 2026 (rule TOOLBOX-AGENDA)' },
    words: 'toolbox mesyuarat toolbox status pack pek status minit minutes verify sahkan company department jabatan',
  },
  {
    id: 'board-group-monthly',
    app: 'board',
    title: { en: 'Monthly JA Group meeting (Mesyuarat bulanan JA Group)', ms: 'Mesyuarat bulanan JA Group' },
    purpose: {
      en: 'Unit HR sets the date with the CEO; each company and unit sends its verified monthly report 3 working days before; Unit HR writes the minutes and the Director Office or CEO verifies them.',
      ms: 'Unit HR menetapkan tarikh dengan CEO; setiap syarikat dan unit menghantar laporan bulanan yang disahkan 3 hari bekerja sebelum; Unit HR menulis minit dan Pejabat Pengarah atau CEO mengesahkannya.',
    },
    start: { view: 'meetings', tab: 'monthly', label: { en: 'Tetapkan tarikh mesyuarat', ms: 'Tetapkan tarikh mesyuarat' } },
    starter: { en: 'Unit HR', ms: 'Unit HR' },
    steps: [
      {
        who: { en: 'Unit HR', ms: 'Unit HR' },
        does: { en: 'Sets the meeting date agreed with the CEO and records that the Outlook invites were sent and who takes the minutes.', ms: 'Menetapkan tarikh mesyuarat yang dipersetujui CEO dan merekod jemputan Outlook sudah dihantar dan siapa pencatat minit.' },
        where: { view: 'meetings', tab: 'monthly', label: { en: 'Meetings › JA Group monthly meeting', ms: 'Mesyuarat › Mesyuarat bulanan JA Group' } },
      },
      {
        who: { en: 'Company admin team (or unit)', ms: 'Pasukan admin syarikat (atau unit)' },
        does: { en: 'Prepares the 14-item monthly report from the last verified toolbox pack plus the monthly items, then sends it.', ms: 'Menyediakan laporan bulanan 14 perkara daripada pek toolbox terakhir yang disahkan serta perkara bulanan, kemudian menghantarnya.' },
        where: { view: 'meetings', tab: 'monthly', label: { en: 'Laporan bulanan', ms: 'Laporan bulanan' } },
      },
      {
        who: { en: 'Company Manager or a company director (unit head for a unit)', ms: 'Pengurus Syarikat atau pengarah syarikat (ketua unit bagi unit)' },
        does: { en: 'Verifies with a comment or returns with a reason; never the preparer.', ms: 'Mengesahkan dengan ulasan atau memulangkan dengan sebab; bukan penyedia.' },
        where: { view: 'meetings', tab: 'monthly', label: { en: 'Laporan bulanan', ms: 'Laporan bulanan' } },
        decision: true,
      },
      {
        who: { en: 'Unit HR, then the Director Office or CEO', ms: 'Unit HR, kemudian Pejabat Pengarah atau CEO' },
        does: { en: 'Unit HR writes and submits the minutes (AI notes ticked as checked); the Director Office or CEO verifies them.', ms: 'Unit HR menulis dan menghantar minit (nota AI ditanda sudah disemak); Pejabat Pengarah atau CEO mengesahkannya.' },
        where: { view: 'meetings', tab: 'monthly', label: { en: 'Meetings › JA Group monthly meeting', ms: 'Mesyuarat › Mesyuarat bulanan JA Group' } },
        decision: true,
      },
    ],
    rules: [
      { en: 'A report not verified 3 working days before the meeting is late and shows on Unit HR’s home; one still missing on the day is red to the Director Office.', ms: 'Laporan yang belum disahkan 3 hari bekerja sebelum mesyuarat adalah lewat dan dipaparkan di laman utama Unit HR; yang masih tiada pada hari itu merah kepada Pejabat Pengarah.' },
      { en: 'Each entity’s accounts report is due on the 28th of the next month; Internal Audit reviews it, never the sender.', ms: 'Laporan akaun setiap entiti perlu dihantar sebelum 28 haribulan bulan berikutnya; Audit Dalaman menyemaknya, bukan penghantar.' },
      { en: 'Prima sends no invites; catering stays outside Prima. Prima’s verified minutes are the record.', ms: 'Prima tidak menghantar jemputan; katering di luar Prima. Minit Prima yang disahkan ialah rekod rasmi.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/GROUP_MONTHLY_MEETING.md', decided: 'Fauzan, answers Y-Q1 to Y-Q10, 14 Nov 2026 (rule GROUP-MONTHLY)' },
    words: 'mesyuarat bulanan monthly meeting ja group laporan bulanan report minutes minit unit hr accounts akaun',
  },
  {
    id: 'board-monthly-report',
    app: 'board',
    title: { en: 'Sending a report to the Director Office', ms: 'Menghantar laporan kepada Pejabat Pengarah' },
    purpose: {
      en: 'Each company and central department sends its weekly or monthly reports once, through the Director Office list; ACT reads the same submission.',
      ms: 'Setiap syarikat dan jabatan pusat menghantar laporan mingguan atau bulanan sekali sahaja, melalui senarai Pejabat Pengarah; ACT membaca penghantaran yang sama.',
    },
    start: { view: 'reports', label: { en: 'Send report', ms: 'Hantar laporan' } },
    starter: { en: 'Department head or company admin team', ms: 'Ketua jabatan atau pasukan admin syarikat' },
    steps: [
      {
        who: { en: 'Director Office Administrator', ms: 'Pentadbir Pejabat Pengarah' },
        does: { en: 'Keeps the report list: who sends what, how often and when it is due (“Change the report list”).', ms: 'Menyelenggara senarai laporan: siapa menghantar apa, kekerapan dan tarikh akhir (“Change the report list”).' },
        where: { view: 'reports', label: { en: 'Reports to the Director Office', ms: 'Laporan kepada Pejabat Pengarah' } },
      },
      {
        who: { en: 'Sender', ms: 'Penghantar' },
        does: { en: 'Under “To send” picks the period, attaches the file, ticks the sections covered and presses “Send report”.', ms: 'Di bawah “To send” pilih tempoh, lampirkan fail, tanda bahagian yang dilaporkan dan tekan “Send report”.' },
        where: { view: 'reports', label: { en: 'Reports › To send', ms: 'Laporan › Untuk dihantar' } },
      },
      {
        who: { en: 'Director Office and ACT', ms: 'Pejabat Pengarah dan ACT' },
        does: { en: 'See who has sent on time, late or not at all; ACT checks it.', ms: 'Melihat siapa menghantar tepat masa, lewat atau tidak langsung; ACT menyemaknya.' },
        where: { view: 'act', tab: 'reports', label: { en: 'ACT › Monthly reports', ms: 'ACT › Laporan bulanan' } },
      },
    ],
    rules: [
      { en: 'Monthly reports are due on the 25th of the next month.', ms: 'Laporan bulanan perlu dihantar sebelum 25 haribulan bulan berikutnya.' },
      { en: 'A report taken off the list keeps its history.', ms: 'Laporan yang dibuang dari senarai mengekalkan sejarahnya.' },
    ],
    status: 'in_force',
    statusNote: { en: 'The starting list is a proposal; the Director Office Administrator changes it.', ms: 'Senarai permulaan adalah cadangan; Pentadbir Pejabat Pengarah boleh mengubahnya.' },
    source: { doc: 'docs/ACT_DEPARTMENT.md', decided: 'Fauzan, 25 Oct and 2 Nov 2026 (rule RPT-MONTHLY)' },
    words: 'report laporan monthly bulanan weekly mingguan director office pejabat pengarah send hantar',
  },
  {
    id: 'board-memo',
    app: 'board',
    title: { en: 'Official memo', ms: 'Memo rasmi' },
    purpose: {
      en: 'The Chief of Staff publishes memos to all staff and the COO to all guards and officers; readers tap “I have read this” and the publisher sees who has not.',
      ms: 'Ketua Staf menerbitkan memo kepada semua staf dan COO kepada semua pengawal dan pegawai; pembaca tekan “I have read this” dan penerbit melihat siapa yang belum.',
    },
    start: { view: 'memos', label: { en: 'New memo', ms: 'Memo baru' } },
    starter: { en: 'Chief of Staff (all staff), COO (all guards and officers), managers (own team)', ms: 'Ketua Staf (semua staf), COO (semua pengawal dan pegawai), pengurus (pasukan sendiri)' },
    steps: [
      {
        who: { en: 'Publisher', ms: 'Penerbit' },
        does: { en: 'Writes the memo, picks who it is for (optionally some states) and the read-by date, then publishes.', ms: 'Menulis memo, memilih siapa penerimanya (pilihan: negeri tertentu) dan tarikh perlu dibaca, kemudian menerbitkan.' },
        where: { view: 'memos', label: { en: 'Memos', ms: 'Memo' } },
      },
      {
        who: { en: 'Every reader', ms: 'Setiap pembaca' },
        does: { en: 'Opens it and taps “I have read this” by the read-by date. Unread memos show on the reader’s home.', ms: 'Membukanya dan tekan “I have read this” sebelum tarikh perlu dibaca. Memo belum dibaca dipaparkan di laman utama pembaca.' },
        where: { view: 'memos', label: { en: 'Memos', ms: 'Memo' } },
      },
      {
        who: { en: 'Publisher', ms: 'Penerbit' },
        does: { en: 'Sees who has read it, reminds those who have not, or withdraws or replaces the memo with a reason.', ms: 'Melihat siapa sudah membaca, mengingatkan yang belum, atau menarik balik atau menggantikan memo dengan sebab.' },
        where: { view: 'memos', label: { en: 'Memos', ms: 'Memo' } },
      },
    ],
    rules: [
      { en: 'A memo cannot be edited after publishing.', ms: 'Memo tidak boleh diubah selepas diterbitkan.' },
      { en: 'Read within 3 days; the reader is reminded 3 days after publishing until read.', ms: 'Baca dalam 3 hari; pembaca diingatkan 3 hari selepas diterbitkan sehingga dibaca.' },
    ],
    status: 'in_force',
    source: { doc: 'docs/system/04-workflows.md', decided: 'Fauzan, 26 Oct 2026; 3-day read-by approved 11 Nov 2026 (rule MEMO-READ)' },
    words: 'memo pekeliling circular notice notis read baca publish terbit chief of staff coo',
  },
];

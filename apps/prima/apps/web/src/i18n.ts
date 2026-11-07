import { createContext, useContext } from 'react';

/**
 * Screen language (Fauzan, 28 Oct 2026): full English, full Bahasa Melayu, or the Malay-English mix most staff use at
 * work. All staff are Malay; in the mix, work terms that are misread in formal Malay stay in English (job, submit,
 * proof, due date, tender, approval), while the sentence around them is Malay.
 *
 * The screens are written in English. A translator walks the page's text and swaps each English piece for its Malay or
 * mixed form from the table below; anything not in the table (names, titles typed by people, record numbers) stays as
 * typed. Each entry is [English, Bahasa Melayu, mix]; a mix of null means the same as Bahasa Melayu, '=' keeps English.
 */
export type Lang = 'en' | 'ms' | 'mix';
export const LANGS: { id: Lang; label: string; short: string }[] = [
  { id: 'mix', label: 'BM + English', short: 'BM+EN' },
  { id: 'ms', label: 'Bahasa Melayu', short: 'BM' },
  { id: 'en', label: 'English', short: 'EN' },
];
export const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: 'mix', setLang: () => {} });
export const useLang = () => useContext(LangCtx);

export function savedLang(): Lang {
  try {
    const v = localStorage.getItem('prima.lang');
    if (v === 'en' || v === 'ms' || v === 'mix') return v;
  } catch {
    /* private window: use the default */
  }
  return 'mix';
}
export function saveLang(l: Lang) {
  try {
    localStorage.setItem('prima.lang', l);
  } catch {
    /* private window: the choice lasts for this visit */
  }
}

type Row = [string, string, string | null];
const ROWS: Row[] = [
  // P80 (UI audit): the menu and its section headings, so a person who picks one language sees one language.
  ['Home', 'Utama', '='],
  ['Work', 'Kerja', null],
  ['Group', 'Kumpulan', 'Group'],
  ['Company today', 'Syarikat hari ini', null],
  ['Company office', 'Pejabat syarikat', null],
  ['Director Office', 'Pejabat Pengarah', null],
  ['Meetings', 'Mesyuarat', 'Meeting'],
  ['Clock', 'Jam kerja', 'Clock'],
  ['My details', 'Butiran saya', null],
  ['Staff clock', 'Jam kerja staf', 'Clock staf'],
  ['Regional ops', 'Operasi wilayah', 'Ops wilayah'],
  ['Cases', 'Kes', null],
  ['Sites', 'Tapak', 'Site'],
  ['Roster', 'Jadual tugas', 'Roster'],
  ['People', 'Kakitangan', '='],
  ['Attendance', 'Kehadiran', null],
  ['Arms control', 'Kawalan senjata', null],
  ['Far branches', 'Cawangan jauh', null],
  ['Vehicles', 'Kenderaan', null],
  ['HR monitor', 'Pemantauan HR', 'Monitor HR'],
  ['Foreign workers', 'Pekerja asing', null],
  ['SOCSO claims', 'Tuntutan PERKESO', 'Claim SOCSO'],
  ['Hostels', 'Asrama', 'Hostel'],
  ['Claims', 'Tuntutan', 'Claim'],
  ['Requests', 'Permohonan', 'Request'],
  ['Hand-overs', 'Serah tugas', 'Hand-over'],
  ['Staff payroll', 'Gaji staf', 'Payroll staf'],
  ['Memos', 'Memo', null],
  ['Tenders & quotes', 'Tender & sebut harga', 'Tender & quotation'],
  ['Insurance', 'Insurans', null],
  ['Clients', 'Pelanggan', 'Client'],
  ['Payment requests', 'Permohonan bayaran', 'Payment request'],
  ['JA app data', 'Data aplikasi JA', 'Data app JA'],
  ['Asset Management', 'Pengurusan Aset', null],
  ['Contracts', 'Kontrak', null],
  ['Branches', 'Cawangan', null],
  ['Finance', 'Kewangan', 'Finance'],
  ['PWVSB credit', 'Kredit PWVSB', null],
  ['Procurement', 'Perolehan', 'Procurement'],
  ['Licences', 'Lesen', null],
  ['Audit trail', 'Jejak audit', 'Audit trail'],
  ['Speak up and assurance', 'Lapor isu dan jaminan', 'Speak up dan assurance'],
  ['Mandates', 'Mandat', null],
  ['Company secretary', 'Setiausaha syarikat', null],
  ['Renewals', 'Pembaharuan', 'Renewal'],
  ['Continuity', 'Kesinambungan', 'Continuity'],
  ['AI data preview', 'Pratonton data AI', 'Preview data AI'],
  ['IT purchase fulfilment', 'Pemenuhan pembelian IT', 'Fulfilment pembelian IT'],
  ['Workflow time & quality', 'Masa & kualiti aliran kerja', 'Masa & kualiti workflow'],
  ['HR / IT coordination', 'Penyelarasan HR / IT', 'Koordinasi HR / IT'],
  ['Site device', 'Peranti tapak', 'Device site'],
  ['Duty', 'Tugas', 'Duty'],
  ['Guards', 'Pengawal', 'Guard'],
  ['Operations', 'Operasi', null],
  ['People and HR', 'Kakitangan dan HR', 'People dan HR'],
  ['Business and finance', 'Perniagaan dan kewangan', 'Business dan finance'],
  ['Compliance and governance', 'Pematuhan dan tadbir urus', 'Compliance dan governance'],
  ['IT and systems', 'IT dan sistem', null],
  ['More', 'Lagi', null],
  ['Guide', 'Panduan', null],
  ['Workflow guide', 'Panduan aliran kerja', 'Panduan workflow'],
  ['Open help requests', 'Buka permintaan bantuan', 'Buka help request'],
  ['Joiners, leavers and tenders', 'Staf masuk, keluar dan tender', null],
  ['Health inspection due / initial check', 'Pemeriksaan kesihatan perlu / semakan awal', 'Health inspection due / check awal'],
  // Added after the gap check (28 Oct 2026)
  [
    'IT department pilot, test version with made-up data. Only the IT team, the COO, the CEO, the ACT head, the HR administrator and the Finance Director sign in during the pilot, and they run the whole system; everyone else reaches them on Teams, email or phone. Pick a person to see what they would see. Real sign-in will use Microsoft 365 accounts.',
    'Projek rintis Jabatan IT, versi ujian dengan data rekaan. Semasa projek rintis, hanya pasukan IT, COO, CEO, Ketua ACT, Pentadbir HR dan Pengarah Kewangan yang log masuk, dan mereka menjalankan keseluruhan sistem; staf lain menghubungi mereka melalui Teams, e-mel atau telefon. Pilih seorang untuk melihat skrin mereka. Log masuk sebenar akan menggunakan akaun Microsoft 365.',
    'Pilot Jabatan IT, versi test dengan data mock. Semasa pilot, hanya team IT, COO, CEO, ACT head, HR admin dan Finance Director yang sign in, dan mereka run seluruh sistem; staf lain hubungi mereka melalui Teams, email atau phone. Pilih seorang untuk tengok skrin mereka. Sign in sebenar guna akaun Microsoft 365.',
  ],
  ['Accounts and access', 'Akaun dan akses', null],
  ['Act', 'Ambil tindakan', 'Action'],
  ['Audit', 'Audit', null],
  ['Backup for', 'Pengganti untuk', 'Backup untuk'],
  ['Buyer', 'Pembeli', 'Buyer'],
  ['IT jobs', 'Tugasan IT', 'Job IT'],
  ['IT work', 'Kerja IT', null],
  ['Your to-do', 'Senarai tugas anda', 'To-do anda'],
  ['Urgent', 'Segera', 'Urgent'],
  ['Needs action', 'Perlu tindakan', 'Perlu action'],
  ['What is still wrong', 'Apa yang masih tidak betul', 'Apa yang masih tak settle'],
  ['P1 urgent', 'P1 segera', 'P1 urgent'],
  ['P2 soon', 'P2 cepat', 'P2 soon'],
  ['P3 normal', 'P3 biasa', 'P3 normal'],
  ['OFF', 'TUTUP', 'OFF'],
  ['MYT', 'MYT', null],
  ['From the company list', 'Dari senarai syarikat', null],
  ['Tag, model, holder or company', 'Tag, model, pemegang atau syarikat', 'Tag, model, holder atau syarikat'],
  ['. Search or filter to narrow.', '. Cari atau tapis untuk kecilkan senarai.', '. Search atau filter untuk kecilkan list.'],
  ['quote', 'sebut harga', 'quotation'],
  ['joins', 'masuk kerja', 'join'],
  ['leaves', 'berhenti', 'keluar'],
  ['shown', 'dipaparkan', null],
  ['· technical', '· teknikal', '· technical'],
  ['· not checked in a year', '· tidak disemak setahun', '· tak di-check setahun'],
  ['· service due', '· perlu servis', null],
  ['· warranty ending', '· waranti hampir tamat', '· warranty nak tamat'],
  ['Arrow Shield (pilot)', 'Arrow Shield (rintis)', 'Arrow Shield (pilot)'],
  ['Sasa (pilot)', 'Sasa (rintis)', 'Sasa (pilot)'],
  ['Inas (pilot)', 'Inas (rintis)', 'Inas (pilot)'],
  ['Pilot companies', 'Syarikat rintis', 'Syarikat pilot'],
  ['Other companies (no detailed data yet)', 'Syarikat lain (belum ada data terperinci)', 'Syarikat lain (belum ada data detail)'],
  ['Teams chat', 'Chat Teams', null],
  ['Phone call', 'Panggilan telefon', 'Call phone'],
  ['Email reply', 'Balasan e-mel', 'Reply email'],
  // Websites (top level)
  ['Sample data for testing, not company records. Cloudflare, GitHub, the domain registrars and Microsoft 365 are not connected: publications, checks and renewals are recorded by hand, and notices show inside Prima only.', 'Data contoh untuk ujian, bukan rekod syarikat. Cloudflare, GitHub, pendaftar domain dan Microsoft 365 belum disambung: penerbitan, semakan dan pembaharuan direkod secara manual, dan notis hanya dipaparkan dalam Prima.', 'Data sample untuk test, bukan rekod syarikat. Cloudflare, GitHub, registrar domain dan Microsoft 365 belum connect: publish, check dan renewal direkod manual, dan notis hanya keluar dalam Prima.'],
  ['Start the cycle', 'Mulakan kitaran', 'Start kitaran'],
  ['Run again safely: nothing is opened twice', 'Selamat dijalankan semula: tiada yang dibuka dua kali', 'Boleh run semula: tiada yang dibuka dua kali'],
  ['Phase 1: the IT Head opens each cycle with these buttons. Automatic opening and reminder scheduling come in Phase 2.', 'Fasa 1: Ketua IT membuka setiap kitaran dengan butang ini. Pembukaan automatik dan jadual peringatan akan datang dalam Fasa 2.', 'Phase 1: IT Head buka setiap kitaran dengan butang ni. Buka automatik dan jadual reminder datang dalam Phase 2.'],
  ['Company coverage', 'Liputan syarikat', 'Coverage syarikat'],
  ['Company answers pending', 'Jawapan syarikat belum diterima', 'Jawapan syarikat pending'],
  ['Checks open', 'Semakan terbuka', 'Check open'],
  ['Reviews open', 'Semakan suku tahun terbuka', 'Review open'],
  ['Quarterly review overdue', 'Semakan suku tahun lewat', 'Review suku tahun overdue'],
  ['Monthly checks are confirmed by a person', 'Semakan bulanan disahkan oleh seorang staf', 'Check bulanan di-confirm oleh orang'],
  ['Automated uptime checks', 'Semakan uptime automatik', 'Check uptime automatik'],
  ['Expiry dates and renewals are recorded by hand', 'Tarikh tamat dan pembaharuan direkod secara manual', 'Tarikh expiry dan renewal direkod manual'],
  ['Hosting and publication are recorded by hand', 'Hosting dan penerbitan direkod secara manual', 'Hosting dan publish direkod manual'],
  ['Preview links and versions are recorded by hand', 'Pautan pratonton dan versi direkod secara manual', 'Link preview dan versi direkod manual'],
  ['Notices show inside Prima only', 'Notis hanya dipaparkan dalam Prima', 'Notis hanya keluar dalam Prima'],
  ['A manual way works for every one', 'Setiap satu ada cara manual', 'Setiap satu ada cara manual'],
  ['DNS changes coming up', 'Perubahan DNS akan datang', 'DNS change akan datang'],
  ['Domain but no live website', 'Ada domain tetapi tiada laman web aktif', 'Ada domain tapi tiada website live'],
  ['Neither domain nor website', 'Tiada domain dan tiada laman web', 'Tiada domain dan website'],
  ['No domain', 'Tiada domain', null],
  ['No website', 'Tiada laman web', 'Tiada website'],
  ['Website not required (with reason)', 'Laman web tidak diperlukan (dengan sebab)', 'Website tak perlu (dengan sebab)'],
  ['Websites missing an owner or backup', 'Laman web tanpa pemilik atau pengganti', 'Website tiada owner atau backup'],
  ['Websites per administrator', 'Laman web bagi setiap pentadbir', 'Website ikut admin'],
  ['Missing owner or administrator', 'Tiada pemilik atau pentadbir', 'Tiada owner atau admin'],
  ['Incomplete or unknown records', 'Rekod tidak lengkap atau tidak diketahui', 'Rekod tak lengkap atau unknown'],
  ['Failed tests', 'Ujian gagal', 'Test gagal'],
  ['Waiting for approval', 'Menunggu kelulusan', 'Tunggu approval'],
  ['Waiting to be published', 'Menunggu untuk diterbitkan', 'Tunggu publish'],
  ['Waiting for the company', 'Menunggu syarikat', 'Tunggu syarikat'],
  ['Business owner to verify', 'Pemilik perniagaan perlu mengesahkan', 'Business owner perlu verify'],
  ['IT testing', 'Ujian oleh IT', 'IT tengah test'],
  ['Connection', 'Sambungan', 'Connection'],
  ['Control', 'Kawalan', 'Control'],
  ['Service due (CCTV, network, printers)', 'Perlu servis (CCTV, rangkaian, pencetak)', 'Service due (CCTV, network, printer)'],
  ['a photo or a document', 'satu foto atau dokumen', null],
  ['a document (no site, so no photo check)', 'satu dokumen (tiada tapak, jadi tiada semakan foto)', 'satu dokumen (tiada site, jadi tiada check foto)'],
  ['Search or filter to narrow.', 'Cari atau tapis untuk kecilkan senarai.', 'Search atau filter untuk kecilkan list.'],
  ['Search to narrow.', 'Cari untuk kecilkan senarai.', 'Search untuk kecilkan list.'],
  // Messages from the system when a step cannot be done (IT)
  ['Already confirmed.', 'Sudah disahkan.', 'Dah confirm.'],
  ['Already resolved.', 'Sudah diselesaikan.', 'Dah resolve.'],
  ['Ask for disposal first, with the reason.', 'Mohon pelupusan dahulu, dengan sebabnya.', 'Mohon disposal dulu, dengan sebab.'],
  ['Attach a screenshot of the decision in Teams.', 'Lampirkan tangkapan skrin keputusan dalam Teams.', 'Attach screenshot keputusan dalam Teams.'],
  ['Attach at most 3 files.', 'Lampirkan maksimum 3 fail.', 'Attach maksimum 3 file.'],
  ['Attach proof that it is done: a screenshot, a photo, the signed form or the attendance sheet.', 'Lampirkan bukti kerja selesai: tangkapan skrin, foto, borang bertandatangan atau senarai kehadiran.', 'Attach proof kerja dah siap: screenshot, foto, borang yang ditandatangan atau attendance sheet.'],
  ['Attach the MOF certificate (all its pages with the codes).', 'Lampirkan sijil MOF (semua muka surat yang ada kod).', 'Attach sijil MOF (semua page yang ada kod).'],
  ['Attach the eP submission slip.', 'Lampirkan slip penghantaran eP.', 'Attach slip submission eP.'],
  ['Attach the finished part (the document that goes in the bid).', 'Lampirkan bahagian yang siap (dokumen yang masuk dalam bida).', 'Attach bahagian yang siap (dokumen yang masuk dalam bid).'],
  ['Attach the paper received from the company.', 'Lampirkan dokumen yang diterima daripada syarikat.', 'Attach dokumen yang diterima dari syarikat.'],
  ['Attach the signed delivery order.', 'Lampirkan pesanan penghantaran (DO) yang ditandatangan.', 'Attach DO yang ditandatangan.'],
  ['Check the online or marketplace price first.', 'Semak harga dalam talian atau marketplace dahulu.', 'Check harga online atau marketplace dulu.'],
  ['Choose an IT Executive.', 'Pilih seorang Eksekutif IT.', 'Pilih seorang IT Executive.'],
  ['Choose how urgent it is.', 'Pilih tahap kesegeraan.', 'Pilih tahap urgent.'],
  ['Choose the IT Lead or an IT Executive.', 'Pilih Ketua Teknikal IT atau seorang Eksekutif IT.', 'Pilih IT Lead atau seorang IT Executive.'],
  ['Choose the company first.', 'Pilih syarikat dahulu.', 'Pilih syarikat dulu.'],
  ['Choose the person.', 'Pilih orangnya.', 'Pilih orang.'],
  ['Choose the supplier.', 'Pilih pembekal.', 'Pilih supplier.'],
  ['Choose what kind of job it is.', 'Pilih jenis tugasan.', 'Pilih jenis job.'],
  ['Choose what the problem is about.', 'Pilih jenis masalah.', null],
  ['Choose won or lost.', 'Pilih menang atau kalah.', 'Pilih menang atau kalah.'],
  ['Each item needs a description, a quantity and a price.', 'Setiap barang perlu keterangan, kuantiti dan harga.', 'Setiap item perlu description, kuantiti dan harga.'],
  ['Every IT part must be done first.', 'Semua bahagian IT mesti selesai dahulu.', 'Semua bahagian IT mesti siap dulu.'],
  ['Every company paper must be received first.', 'Semua dokumen syarikat mesti diterima dahulu.', 'Semua dokumen syarikat mesti diterima dulu.'],
  ['Finish every IT part first, each with its document.', 'Siapkan semua bahagian IT dahulu, setiap satu dengan dokumennya.', 'Siapkan semua bahagian IT dulu, setiap satu dengan dokumen.'],
  ['Give a closing date from today on.', 'Beri tarikh tutup mulai hari ini.', 'Beri closing date mulai hari ini.'],
  ['Give a due date from today on.', 'Beri tarikh akhir mulai hari ini.', 'Beri due date mulai hari ini.'],
  ['Give a due date on or before the closing date.', 'Beri tarikh akhir pada atau sebelum tarikh tutup.', 'Beri due date pada atau sebelum closing date.'],
  ['Give the MOF certificate expiry date.', 'Beri tarikh tamat sijil MOF.', 'Beri tarikh expiry sijil MOF.'],
  ['Give the MOF certificate number.', 'Beri nombor sijil MOF.', null],
  ['Give the Teams approval title or link.', 'Beri tajuk atau pautan kelulusan Teams.', 'Beri tajuk atau link approval Teams.'],
  ['Give the date Finance paid.', 'Beri tarikh Kewangan membayar.', 'Beri tarikh Finance bayar.'],
  ['Give the date the work was done.', 'Beri tarikh kerja dibuat.', 'Beri tarikh kerja dibuat.'],
  ['Give the delivery order number.', 'Beri nombor pesanan penghantaran (DO).', 'Beri nombor DO.'],
  ['Give the first and last day away.', 'Beri hari pertama dan terakhir tidak bertugas.', 'Beri hari pertama dan terakhir cuti.'],
  ['Give the job to someone else; nobody accepts their own work.', 'Beri tugasan kepada orang lain; tiada sesiapa menerima kerja sendiri.', 'Beri job kepada orang lain; tiada siapa boleh accept kerja sendiri.'],
  ['Give the tender title.', 'Beri tajuk tender.', null],
  ['Give the total amount in RM.', 'Beri jumlah dalam RM.', null],
  ['Give where it was sent to Finance (the Teams approval or email subject).', 'Nyatakan di mana ia dihantar kepada Kewangan (kelulusan Teams atau subjek e-mel).', 'Nyatakan di mana ia dihantar ke Finance (approval Teams atau subject email).'],
  ['Hand the IT part to the company first.', 'Serahkan bahagian IT kepada syarikat dahulu.', 'Serahkan bahagian IT kepada syarikat dulu.'],
  ['Hand the bid pack to the company first.', 'Serahkan pakej bida kepada syarikat dahulu.', 'Serahkan bid pack kepada syarikat dulu.'],
  ['IT has not resolved it yet.', 'IT belum menyelesaikannya.', 'IT belum resolve.'],
  ['IT logs help requests for staff.', 'IT merekod permintaan bantuan bagi pihak staf.', 'IT log help request bagi pihak staf.'],
  ['IT passes the approved purchase to Finance.', 'IT menyerahkan pembelian yang diluluskan kepada Kewangan.', 'IT hantar purchase yang approved ke Finance.'],
  ['IT receives the goods.', 'IT menerima barang.', 'IT terima barang.'],
  ['IT records an approval given in Teams.', 'IT merekod kelulusan yang diberi dalam Teams.', 'IT rekod approval yang diberi dalam Teams.'],
  ['IT records quotes and online prices.', 'IT merekod sebut harga dan harga dalam talian.', 'IT rekod quotation dan harga online.'],
  ['IT records the person’s answer.', 'IT merekod jawapan orang tersebut.', 'IT rekod jawapan orang tu.'],
  ['IT sends it for approval.', 'IT menghantarnya untuk kelulusan.', 'IT hantar untuk approval.'],
  ['More received than ordered.', 'Diterima lebih daripada pesanan.', 'Terima lebih dari yang dipesan.'],
  ['Name the IT tender executive first: the IT Executive paired with the IT Manager who does every IT tender.', 'Namakan eksekutif tender IT dahulu: Eksekutif IT yang berpasangan dengan Pengurus IT dan membuat setiap tender IT.', 'Namakan IT tender executive dulu: IT Executive yang dipasangkan dengan IT Manager untuk semua tender IT.'],
  ['Nobody accepts their own work.', 'Tiada sesiapa menerima kerja sendiri.', 'Tiada siapa boleh accept kerja sendiri.'],
  ['Nobody sends back their own work.', 'Tiada sesiapa memulangkan kerja sendiri.', 'Tiada siapa boleh send back kerja sendiri.'],
  ['Not waiting for the person’s answer.', 'Tidak menunggu jawapan orang tersebut.', 'Tak tunggu jawapan orang tu.'],
  ['Nothing was changed.', 'Tiada apa-apa diubah.', 'Tiada apa yang diubah.'],
  ['Only the CEO reviews who has access.', 'Hanya CEO menyemak siapa yang ada akses.', 'Hanya CEO review siapa ada akses.'],
  ['Only the CEO, as owner of every system, decides access.', 'Hanya CEO, sebagai pemilik setiap sistem, memutuskan akses.', 'Hanya CEO, sebagai owner setiap sistem, decide akses.'],
  ['Only the doer, the IT Lead or the IT Manager adds notes.', 'Hanya pembuat kerja, Ketua Teknikal IT atau Pengurus IT boleh menambah catatan.', 'Hanya PIC, IT Lead atau IT Manager boleh tambah nota.'],
  ['PWVSB is the group company and holds no IT codes; record the licensed company that does.', 'PWVSB ialah syarikat kumpulan dan tiada kod IT; rekod syarikat berlesen yang memegangnya.', 'PWVSB ialah syarikat group dan tiada kod IT; rekod syarikat berlesen yang ada kod.'],
  ['Receive every company paper first.', 'Terima semua dokumen syarikat dahulu.', 'Terima semua dokumen syarikat dulu.'],
  ['Record the eP submission first.', 'Rekod penghantaran eP dahulu.', 'Rekod submission eP dulu.'],
  ['Say how the person answered (for example, Teams chat with the time).', 'Nyatakan cara orang itu menjawab (contohnya, chat Teams dengan masanya).', 'Nyatakan macam mana orang tu jawab (contoh, chat Teams dengan masa).'],
  ['Say how they reached IT.', 'Nyatakan cara mereka menghubungi IT.', 'Nyatakan macam mana mereka hubungi IT.'],
  ['Say what fixed it.', 'Nyatakan apa yang membaikinya.', 'Nyatakan apa yang settle-kan.'],
  ['Say what is missing or wrong.', 'Nyatakan apa yang kurang atau salah.', null],
  ['Say what is still wrong.', 'Nyatakan apa yang masih tidak betul.', 'Nyatakan apa yang masih tak settle.'],
  ['Say what is wrong.', 'Nyatakan apa masalahnya.', null],
  ['Say what the job is.', 'Nyatakan apa tugasannya.', 'Nyatakan apa job-nya.'],
  ['Say what to fix.', 'Nyatakan apa yang perlu dibaiki.', 'Nyatakan apa yang perlu fix.'],
  ['Say what was checked (for example, security and cleaning codes only).', 'Nyatakan apa yang disemak (contohnya, kod keselamatan dan pembersihan sahaja).', 'Nyatakan apa yang di-check (contoh, kod security dan cleaning sahaja).'],
  ['Say what was done.', 'Nyatakan apa yang telah dibuat.', 'Nyatakan apa yang dah dibuat.'],
  ['Say who asked for help.', 'Nyatakan siapa yang meminta bantuan.', 'Nyatakan siapa yang minta help.'],
  ['Say who attended, or why it was not needed.', 'Nyatakan siapa yang hadir, atau mengapa tidak perlu.', 'Nyatakan siapa yang hadir, atau kenapa tak perlu.'],
  ['Say who has it.', 'Nyatakan siapa yang memegangnya.', 'Nyatakan siapa yang pegang.'],
  ['Say who in the company received the bid pack.', 'Nyatakan siapa dalam syarikat yang menerima pakej bida.', 'Nyatakan siapa dalam syarikat yang terima bid pack.'],
  ['Say who in the company receives the IT part (it is bid in the company’s own name).', 'Nyatakan siapa dalam syarikat yang menerima bahagian IT (bida dibuat atas nama syarikat sendiri).', 'Nyatakan siapa dalam syarikat yang terima bahagian IT (bid dibuat atas nama syarikat sendiri).'],
  ['Say why it is cancelled.', 'Nyatakan sebab ia dibatalkan.', 'Nyatakan sebab cancel.'],
  ['Say why it is changed.', 'Nyatakan sebab ia diubah.', 'Nyatakan sebab ubah.'],
  ['Say why it is dropped.', 'Nyatakan sebab ia digugurkan.', 'Nyatakan sebab drop.'],
  ['Say why it is needed.', 'Nyatakan sebab ia diperlukan.', 'Nyatakan sebab perlu.'],
  ['Say why it is rejected.', 'Nyatakan sebab ia ditolak.', 'Nyatakan sebab reject.'],
  ['Say why it should be disposed of.', 'Nyatakan sebab ia patut dilupuskan.', 'Nyatakan sebab perlu disposal.'],
  ['Say why the group does not bid.', 'Nyatakan sebab kumpulan tidak membida.', 'Nyatakan sebab group tak bid.'],
  ['Say why.', 'Nyatakan sebabnya.', 'Nyatakan sebab.'],
  ['Someone else agrees a purchase you asked for.', 'Orang lain yang bersetuju dengan pembelian yang anda minta.', 'Orang lain yang agree purchase yang anda minta.'],
  ['Someone else checks your own work: the IT Manager accepts it.', 'Orang lain menyemak kerja anda sendiri: Pengurus IT yang menerimanya.', 'Orang lain check kerja anda sendiri: IT Manager yang accept.'],
  ['Someone other than the person who fixed it records the answer.', 'Jawapan direkod oleh orang lain, bukan orang yang membaikinya.', 'Jawapan direkod oleh orang lain, bukan orang yang fix.'],
  ['That part is not done.', 'Bahagian itu belum selesai.', 'Bahagian tu belum siap.'],
  ['The COO agrees a purchase the IT Manager asked for.', 'COO yang bersetuju dengan pembelian yang diminta oleh Pengurus IT.', 'COO yang agree purchase yang IT Manager minta.'],
  ['The IT Lead does the technical check.', 'Ketua Teknikal IT yang membuat semakan teknikal.', 'IT Lead yang buat technical check.'],
  ['The IT Manager (or the IT Lead) adds IT tenders.', 'Pengurus IT (atau Ketua Teknikal IT) yang menambah tender IT.', 'IT Manager (atau IT Lead) yang tambah tender IT.'],
  ['The IT Manager accepts finished jobs (the COO while the IT Manager is away).', 'Pengurus IT yang menerima tugasan siap (COO semasa Pengurus IT tiada).', 'IT Manager yang accept job yang siap (COO semasa IT Manager cuti).'],
  ['The IT Manager agrees this need first; the COO approves the purchase in Procurement.', 'Pengurus IT bersetuju dengan keperluan ini dahulu; COO meluluskan pembelian dalam Perolehan.', 'IT Manager agree keperluan ni dulu; COO approve purchase dalam Procurement.'],
  ['The IT Manager deals with the company for its papers.', 'Pengurus IT yang berurusan dengan syarikat untuk dokumennya.', 'IT Manager yang uruskan dengan syarikat untuk dokumen.'],
  ['The IT Manager gives out the tender parts.', 'Pengurus IT yang mengagihkan bahagian tender.', 'IT Manager yang agihkan bahagian tender.'],
  ['The IT Manager gives this part out first.', 'Pengurus IT perlu mengagihkan bahagian ini dahulu.', 'IT Manager perlu agihkan bahagian ni dulu.'],
  ['The IT Manager moves the tender on.', 'Pengurus IT yang menggerakkan tender ke langkah seterusnya.', 'IT Manager yang gerakkan tender ke step seterusnya.'],
  ['The IT Manager names the IT tender executive.', 'Pengurus IT yang menamakan eksekutif tender IT.', 'IT Manager yang namakan IT tender executive.'],
  ['The IT Manager or the COO records when the IT Manager is away.', 'Pengurus IT atau COO merekod bila Pengurus IT tiada.', 'IT Manager atau COO rekod bila IT Manager cuti.'],
  ['The IT Manager or the IT Lead assigns help requests.', 'Pengurus IT atau Ketua Teknikal IT yang mengagihkan permintaan bantuan.', 'IT Manager atau IT Lead yang assign help request.'],
  ['The IT Manager or the IT Lead changes a job.', 'Pengurus IT atau Ketua Teknikal IT yang mengubah tugasan.', 'IT Manager atau IT Lead yang ubah job.'],
  ['The IT Manager or the IT Lead gives out this work.', 'Pengurus IT atau Ketua Teknikal IT yang mengagihkan kerja ini.', 'IT Manager atau IT Lead yang agihkan kerja ni.'],
  ['The IT Manager records the IT codes each company holds.', 'Pengurus IT yang merekod kod IT setiap syarikat.', 'IT Manager yang rekod kod IT setiap syarikat.'],
  ['The IT Manager sends a part back.', 'Pengurus IT yang memulangkan sesuatu bahagian.', 'IT Manager yang send back bahagian.'],
  ['The IT Manager, or the IT Lead at the technical check, sends a job back.', 'Pengurus IT, atau Ketua Teknikal IT semasa semakan teknikal, yang memulangkan tugasan.', 'IT Manager, atau IT Lead semasa technical check, yang send back job.'],
  ['The IT Manager, or the IT Lead for a job they gave, cancels a job.', 'Pengurus IT, atau Ketua Teknikal IT bagi tugasan yang diberinya, yang membatalkan tugasan.', 'IT Manager, atau IT Lead untuk job yang dia beri, yang cancel job.'],
  ['The IT parts are not drafted yet.', 'Bahagian IT belum didraf.', 'Bahagian IT belum di-draft.'],
  ['The email does not look right.', 'E-mel kelihatan tidak betul.', 'Email nampak tak betul.'],
  ['The person answers this one in Prima.', 'Orang tersebut menjawab sendiri dalam Prima.', 'Orang tu jawab sendiri dalam Prima.'],
  ['This asset is disposed of.', 'Aset ini telah dilupuskan.', 'Aset ni dah disposal.'],
  ['This change is already decided.', 'Perubahan ini sudah diputuskan.', 'Perubahan ni dah decide.'],
  ['This company holds no IT code on record; choose one the IT Manager has checked against its MOF certificate.', 'Syarikat ini tiada kod IT dalam rekod; pilih syarikat yang telah disemak oleh Pengurus IT berdasarkan sijil MOF.', 'Syarikat ni tiada kod IT dalam rekod; pilih syarikat yang IT Manager dah check dengan sijil MOF.'],
  ['This company’s MOF certificate ends before the tender closes; renew it or choose another company.', 'Sijil MOF syarikat ini tamat sebelum tender ditutup; perbaharui atau pilih syarikat lain.', 'Sijil MOF syarikat ni expired sebelum tender tutup; renew atau pilih syarikat lain.'],
  ['This file was already given as proof. Attach new proof.', 'Fail ini sudah diberi sebagai bukti. Lampirkan bukti baharu.', 'File ni dah diberi sebagai proof. Attach proof baru.'],
  ['This is given to someone else in IT.', 'Ini diberi kepada orang lain dalam IT.', 'Ni diberi kepada orang lain dalam IT.'],
  ['This is not the lowest quote: say why it is chosen.', 'Ini bukan sebut harga terendah: nyatakan sebab ia dipilih.', 'Ni bukan quotation paling rendah: nyatakan sebab dipilih.'],
  ['This part is given to someone else.', 'Bahagian ini diberi kepada orang lain.', 'Bahagian ni diberi kepada orang lain.'],
  ['This tender is closed for changes.', 'Tender ini tidak boleh diubah lagi.', 'Tender ni dah tak boleh diubah.'],
  ['Unknown IT action.', 'Tindakan IT tidak dikenali.', 'Action IT tak dikenali.'],
  ['Unknown buying step.', 'Langkah pembelian tidak dikenali.', 'Step buying tak dikenali.'],
  ['Unknown tender step.', 'Langkah tender tidak dikenali.', 'Step tender tak dikenali.'],
  ['Unknown step.', 'Langkah tidak dikenali.', 'Step tak dikenali.'],
  ['Write the update.', 'Tulis kemas kini.', 'Tulis update.'],
  ['(ACT and HR look at IT work; they do not change it)', '(ACT dan HR melihat kerja IT; mereka tidak mengubahnya)', '(ACT dan HR tengok kerja IT; mereka tak ubah apa-apa)'],
  ['(IT asks the CEO for access changes)', '(IT meminta CEO untuk perubahan akses)', '(IT minta CEO untuk ubah akses)'],
  ['(IT buys IT and electronic equipment)', '(IT membeli peralatan IT dan elektronik)', '(IT beli peralatan IT dan elektronik)'],
  ['(IT fills tender IT details)', '(IT mengisi butiran IT tender)', '(IT isi butiran IT tender)'],
  ['(IT maintains electronic assets)', '(IT menyelenggara aset elektronik)', '(IT maintain aset elektronik)'],
  ['(IT manages electronic assets)', '(IT mengurus aset elektronik)', '(IT urus aset elektronik)'],
  ['(IT runs onboarding)', '(IT menguruskan onboarding)', '(IT uruskan onboarding)'],
  ['(IT works help requests)', '(IT mengendalikan permintaan bantuan)', '(IT handle help request)'],
  ['(help requests)', '(permintaan bantuan)', '(help request)'],
  ['(only the IT Manager disposes of an asset)', '(hanya Pengurus IT melupuskan aset)', '(hanya IT Manager boleh disposal aset)'],
  ['(the IT Manager or IT Lead gives IT jobs)', '(Pengurus IT atau Ketua Teknikal IT memberi tugasan IT)', '(IT Manager atau IT Lead yang beri job IT)'],
  ['technical', 'teknikal', 'technical'],
  ['Attach a PDF, JPEG or PNG file.', 'Lampirkan fail PDF, JPEG atau PNG.', 'Attach file PDF, JPEG atau PNG.'],
  ['The file could not be attached.', 'Fail tidak dapat dilampirkan.', 'File tak dapat di-attach.'],
  ['Photo', 'Foto', null],
  ['Remove proof', 'Buang bukti', 'Buang proof'],
  ['Give the Finance payment reference.', 'Beri rujukan bayaran Kewangan.', 'Beri reference bayaran Finance.'],
  ['IT passes the approved purchase to Finance first.', 'IT perlu menyerahkan pembelian yang diluluskan kepada Kewangan dahulu.', 'IT perlu hantar purchase yang approved ke Finance dulu.'],
  ['(Finance records payment on approved IT purchases only)', '(Kewangan hanya merekod bayaran bagi pembelian IT yang diluluskan)', '(Finance hanya rekod bayaran untuk purchase IT yang approved)'],
  ['Use a test file', 'Guna fail ujian', 'Guna file test'],
  // Round 5 (28 Oct 2026): plan, working hours, rental, HR enters for staff, Finance pays.
  ['Plan', 'Pelan', 'Plan'],
  ['Week', 'Minggu', 'Week'],
  ['Month', 'Bulan', 'Month'],
  ['Year', 'Tahun', 'Year'],
  ['Today', 'Hari ini', null],
  ['Plan it', 'Rancang', 'Plan'],
  ['Who has what', 'Siapa buat apa', null],
  ['Regular work', 'Kerja rutin', null],
  ['Regular work due', 'Kerja rutin perlu dibuat', 'Kerja rutin due'],
  ['Not given to anyone', 'Belum diberi kepada sesiapa', 'Belum diberi kepada sesiapa'],
  ['Overdue, not given', 'Lewat, belum diberi', 'Overdue, belum diberi'],
  ['Jobs due in this period', 'Kerja perlu siap dalam tempoh ini', 'Job due dalam tempoh ini'],
  ['Everything in this period is given to someone.', 'Semua kerja dalam tempoh ini sudah diberi.', 'Semua kerja dalam tempoh ini sudah diberi.'],
  ['Yearly check', 'Semakan tahunan', 'Check tahunan'],
  ['Domain', 'Domain', null],
  ['Access review', 'Semakan akses', 'Review akses'],
  ['Tender', 'Tender', null],
  ['No owner', 'Tiada pemilik', 'Tiada owner'],
  ['Not given', 'Belum diberi', null],
  ['Arisha can suggest a plan', 'Arisha boleh mencadangkan pelan', 'Arisha boleh cadangkan plan'],
  ['She suggests; you decide and give each job.', 'Dia mencadangkan; anda yang memutuskan dan memberi setiap kerja.', 'Dia cadangkan; anda yang decide dan bagi setiap job.'],
  ['Suggest a plan', 'Cadangkan pelan', 'Cadangkan plan'],
  ['Device rental', 'Sewaan peranti', 'Sewa device'],
  ['Bid files', 'Fail tawaran', 'Fail bida'],
  ['Company information is confidential', 'Maklumat syarikat adalah sulit', 'Maklumat company adalah sulit'],
  ['Everything in Prima is confidential company information.', 'Semua maklumat dalam Prima adalah maklumat sulit syarikat.', 'Semua maklumat dalam Prima adalah maklumat sulit company.'],
  ['Use it only for your own work. Do not share, copy, forward or photograph any screen, file or figure for anyone outside your work.', 'Gunakan hanya untuk kerja anda. Jangan kongsi, salin, hantar atau ambil gambar mana-mana skrin, fail atau angka untuk sesiapa di luar kerja anda.', 'Guna hanya untuk kerja anda. Jangan share, copy, forward atau ambil gambar mana-mana screen, fail atau angka untuk sesiapa di luar kerja anda.'],
  ['You see only what your work needs. Do not ask others for what you cannot see.', 'Anda hanya melihat apa yang diperlukan untuk kerja anda. Jangan minta daripada orang lain apa yang anda tidak dapat lihat.', 'Anda hanya nampak apa yang kerja anda perlu. Jangan minta dari orang lain apa yang anda tak nampak.'],
  ['Every file you open is recorded with your name and the time.', 'Setiap fail yang anda buka direkodkan dengan nama anda dan masa.', 'Setiap fail yang anda buka direkod dengan nama dan masa.'],
  ['I agree and will keep it confidential', 'Saya setuju dan akan merahsiakannya', 'Saya setuju dan akan rahsiakan'],
  ['Thank you. Recorded.', 'Terima kasih. Direkodkan.', 'Terima kasih. Direkod.'],
  ['No file name yet. The IT Manager writes the name the tender asks for.', 'Belum ada nama fail. Pengurus IT menulis nama yang diminta tender.', 'Belum ada nama fail. IT Manager tulis nama yang tender minta.'],
  ['Write the file name', 'Tulis nama fail', 'Tulis nama fail'],
  ['File name saved.', 'Nama fail disimpan.', 'Nama fail disimpan.'],
  ['File name the tender asks for', 'Nama fail yang diminta tender', 'Nama fail yang tender minta'],
  ['Name every file exactly as the tender asks, never by the company name. The technical part must not show the company name anywhere: letterhead, logo, stamp, header, footer, watermark or the file\'s properties.', 'Namakan setiap fail tepat seperti yang dikehendaki tender, bukan nama syarikat. Bahagian teknikal tidak boleh ada nama syarikat di mana-mana: kepala surat, logo, cop, header, footer, tera air atau sifat fail.', 'Nama setiap fail ikut nama yang tender minta, bukan nama company. Bahagian teknikal tidak boleh ada nama company di mana-mana: kepala surat, logo, cop, header, footer, watermark atau properties fail.'],
  ['No file names listed yet. List the files the tender asks for, by their exact names.', 'Belum ada nama fail. Senaraikan fail yang diminta tender, ikut nama tepat.', 'Belum ada nama fail. Senaraikan fail yang tender minta, ikut nama tepat.'],
  ['Not uploaded', 'Belum dimuat naik', 'Belum upload'],
  ['Ready', 'Sedia', 'Ready'],
  ['Upload again', 'Muat naik semula', 'Upload semula'],
  ['I checked every page: no company name', 'Saya sudah semak setiap muka surat: tiada nama syarikat', 'Saya dah check setiap page: tiada nama company'],
  ['No company name found in the text or file properties the app can read. Check pictures, stamps and scanned pages by eye.', 'Tiada nama syarikat dalam teks atau sifat fail yang boleh dibaca oleh aplikasi. Semak gambar, cop dan halaman imbasan sendiri.', 'Tiada nama company dalam teks atau properties fail yang app boleh baca. Check gambar, cop dan page scan sendiri.'],
  ['The app cannot read the text of this file (picture or scan). Check every page by eye.', 'Aplikasi tidak dapat membaca teks fail ini (gambar atau imbasan). Semak setiap muka surat sendiri.', 'App tak dapat baca teks fail ini (gambar atau scan). Check setiap page sendiri.'],
  ['Save file', 'Simpan fail', 'Save fail'],
  ['Add a file', 'Tambah fail', 'Tambah fail'],
  ['Save file names', 'Simpan nama fail', 'Save nama fail'],
  ['Change file names', 'Tukar nama fail', 'Tukar nama fail'],
  ['List the file names', 'Senaraikan nama fail', 'Senaraikan nama fail'],
  ['File names saved.', 'Nama fail disimpan.', 'Nama fail disimpan.'],
  ['File uploaded.', 'Fail dimuat naik.', 'Fail diupload.'],
  ['Checked: no company name.', 'Disemak: tiada nama syarikat.', 'Checked: tiada nama company.'],
  ['Finish these before signing:', 'Selesaikan ini sebelum menandatangani:', 'Siapkan ini sebelum sign:'],
  ['Issue the bill', 'Keluarkan bil', 'Issue bil'],
  ['Record payment', 'Rekod bayaran', 'Rekod payment'],
  ['Bills', 'Bil', null],
  ['No bills yet.', 'Belum ada bil.', null],
  ['Not billed', 'Belum dibilkan', 'Belum bill'],
  ['Not paid', 'Belum dibayar', null],
  ['Paid', 'Sudah dibayar', 'Paid'],
  ['Bill recorded.', 'Bil direkodkan.', 'Bil direkod.'],
  ['Payment recorded.', 'Bayaran direkodkan.', 'Payment direkod.'],
  ["This month's rent", 'Sewa bulan ini', null],
  ['Billed, not paid yet', 'Sudah dibilkan, belum dibayar', 'Sudah bill, belum paid'],
  ['Prices are made up for the test. The real prices are filled in when pilot phase 1 goes live.', 'Harga adalah rekaan untuk ujian. Harga sebenar diisi apabila projek rintis fasa 1 bermula.', 'Harga rekaan untuk test. Harga sebenar diisi bila pilot phase 1 go live.'],
  ['Late in', 'Lewat masuk', null],
  ['Break over 1 hour', 'Rehat lebih 1 jam', 'Break lebih 1 jam'],
  ["You see your IT team's clock, view only.", 'Anda melihat rekod masa pasukan IT anda, untuk tontonan sahaja.', 'Anda nampak clock team IT anda, view sahaja.'],
  ['Enter for staff', 'Masukkan untuk staf', 'Isi untuk staff'],
  ['Choose the staff member…', 'Pilih staf…', 'Pilih staff…'],
  ['Ask to travel', 'Mohon perjalanan', 'Mohon travel'],
  ['Sent for approval.', 'Dihantar untuk kelulusan.', 'Dihantar untuk approval.'],
  ['Approved, Finance to pay', 'Diluluskan, Kewangan akan bayar', 'Approved, Finance akan bayar'],
  // Shell, sign-in and common words
  ['Choose who to sign in as', 'Pilih siapa untuk log masuk', 'Pilih siapa untuk sign in'],
  ['Switch person', 'Tukar pengguna', 'Tukar user'],
  ['Reset data', 'Set semula data', 'Reset data'],
  ['Start again from fresh made-up data', 'Mula semula dengan data rekaan baharu', 'Mula semula dengan data mock baharu'],
  ['Test version.', 'Versi ujian.', 'Versi test.'],
  ['Test data.', 'Data ujian.', 'Data test.'],
  [
    'Pilot records: what you enter here is real work. Names marked (mock) are placeholders until verified.',
    'Rekod projek rintis: apa yang anda masukkan di sini ialah kerja sebenar. Nama bertanda (mock) hanya sementara sehingga disahkan.',
    'Rekod pilot: apa yang anda masukkan di sini adalah kerja sebenar. Nama bertanda (mock) hanya placeholder sehingga disahkan.',
  ],
  ['All people, sites and clients are made up. Changes stay in this browser only.', 'Semua orang, tapak dan pelanggan adalah rekaan. Perubahan hanya disimpan dalam pelayar ini.', 'Semua orang, site dan client adalah rekaan. Perubahan hanya kekal dalam browser ini.'],
  [
    'IT department pilot, test version with made-up data. Only the IT team, the COO and the CEO sign in during the pilot; everyone else reaches IT on Teams, email or phone. Pick a person to see what they would see. Real sign-in will use Microsoft 365 accounts.',
    'Projek rintis Jabatan IT, versi ujian dengan data rekaan. Semasa projek rintis, hanya pasukan IT, COO, CEO, ACT dan HR yang log masuk; staf lain menghubungi IT melalui Teams, e-mel atau telefon. Pilih seorang untuk melihat skrin mereka. Log masuk sebenar akan menggunakan akaun Microsoft 365.',
    'Pilot Jabatan IT, versi test dengan data mock. Semasa pilot, hanya team IT, COO, CEO, ACT dan HR yang sign in; staf lain hubungi IT melalui Teams, email atau phone. Pilih seorang untuk tengok skrin mereka. Sign in sebenar guna akaun Microsoft 365.',
  ],
  ['Language', 'Bahasa', 'Bahasa'],
  ['Malaysia time', 'Waktu Malaysia', null],
  ['Group leadership', 'Kepimpinan kumpulan', 'Group leadership'],
  ['Close', 'Tutup', null],
  ['Save', 'Simpan', 'Save'],
  ['Add', 'Tambah', null],
  ['Open', 'Buka', null],
  ['Show', 'Papar', 'Show'],
  ['Next', 'Seterusnya', 'Next'],
  ['Search', 'Cari', null],
  ['Find', 'Cari', null],
  ['Details', 'Butiran', null],
  ['Details (optional)', 'Butiran (pilihan)', null],
  ['Note', 'Catatan', 'Nota'],
  ['Why', 'Sebab', null],
  ['Status', 'Status', null],
  ['Owner', 'Pemilik', 'Owner'],
  ['Company', 'Syarikat', null],
  ['Companies', 'Syarikat', null],
  ['Everyone', 'Semua orang', null],
  ['All', 'Semua', null],
  ['Other', 'Lain-lain', null],
  ['Kind', 'Jenis', null],
  ['Area', 'Bahagian', null],
  ['All areas', 'Semua bahagian', null],
  ['Every kind', 'Semua jenis', null],
  ['Every status', 'Semua status', null],
  ['Person', 'Orang', 'Staf'],
  ['Staff', 'Staf', null],
  ['Reference', 'Rujukan', null],
  ['Title', 'Tajuk', null],
  ['Due', 'Tarikh akhir', 'Due'],
  ['Started', 'Dimulakan', 'Started'],
  ['Target', 'Sasaran', 'Target'],
  ['Late', 'Lewat', null],
  ['late', 'lewat', null],
  ['Done', 'Selesai', 'Done'],
  ['Done late', 'Selesai lewat', 'Done lewat'],
  ['To do', 'Belum dibuat', 'To do'],
  ['to do', 'belum dibuat', 'to do'],
  ['Running', 'Sedang berjalan', 'Running'],
  ['running', 'sedang berjalan', 'running'],
  ['Waiting', 'Menunggu', null],
  ['waiting for the step before', 'menunggu langkah sebelumnya', 'tunggu step sebelum'],
  ['Not started', 'Belum bermula', 'Belum start'],
  ['Act now', 'Tindakan segera', 'Act segera'],
  ['Check', 'Semak', 'Check'],
  ['Held', 'Dipatuhi', 'OK'],
  ['unknown', 'tidak diketahui', null],
  ['Unknown', 'Tidak diketahui', null],
  ['dated', 'ikut tarikh', null],
  ['more', 'lagi', null],
  ['and', 'dan', null],
  ['of', 'daripada', null],
  ['on', 'pada', null],
  ['The', 'Pihak', null],
  ['Main', 'Utama', null],
  ['Overview', 'Ringkasan', 'Overview'],
  ['Settings', 'Tetapan', 'Settings'],
  ['History', 'Sejarah', 'History'],
  ['Reports', 'Laporan', 'Report'],
  ['(required)', '(wajib)', null],
  ['…', '…', null],

  // IT screen
  ['IT', 'IT', null],
  ['IT sections', 'Bahagian IT', null],
  [
    'Jobs given with a due date and done with proof, help requests, IT and electronic assets from purchase to disposal, joining and leaving, and the IT part of tenders. The IT Manager supervises, the IT Lead is technical, the COO monitors and the CEO owns every system.',
    'Tugasan diberi dengan tarikh akhir dan disiapkan dengan bukti, permintaan bantuan, aset IT dan elektronik dari pembelian hingga pelupusan, staf masuk dan keluar, serta bahagian IT dalam tender. Pengurus IT menyelia, Ketua Teknikal IT menyemak kerja teknikal, COO memantau dan CEO memiliki semua sistem.',
    'Job diberi dengan due date dan disiapkan dengan proof, help request, aset IT dan elektronik dari purchase hingga disposal, onboarding dan offboarding, serta bahagian IT dalam tender. IT Manager menyelia, IT Lead semak kerja teknikal, COO pantau dan CEO owner semua sistem.',
  ],
  ['Ask IT for help with your account, device, Microsoft 365, the network or Prima, and follow your requests here.', 'Minta bantuan IT untuk akaun, peranti, Microsoft 365, rangkaian atau Prima, dan ikuti permintaan anda di sini.', 'Minta bantuan IT untuk akaun, device, Microsoft 365, network atau Prima, dan follow request anda di sini.'],
  ['My work', 'Kerja saya', 'My work'],
  ['Jobs', 'Tugasan', 'Job'],
  ['Job', 'Tugasan', 'Job'],
  ['Team', 'Pasukan', 'Team'],
  ['Audit', 'Audit', null],
  ['Help requests', 'Permintaan bantuan', 'Help request'],
  ['Systems and access', 'Sistem dan akses', null],
  ['Systems', 'Sistem', null],
  ['Assets', 'Aset', null],
  ['Purchases', 'Pembelian', 'Purchase'],
  ['Buying', 'Pembelian', 'Purchase'],
  ['Maintenance', 'Penyelenggaraan', 'Maintenance'],
  ['Websites and domains', 'Laman web dan domain', 'Website dan domain'],
  ['Websites', 'Laman web', 'Website'],
  ['Tenders (eP)', 'Tender (eP)', null],
  ['Tenders', 'Tender', null],
  ['Joining and leaving', 'Staf masuk dan keluar', 'Onboarding dan offboarding'],
  ['My requests', 'Permintaan saya', 'Request saya'],
  ['Jobs late', 'Tugasan lewat', 'Job lewat'],
  ['Jobs open', 'Tugasan terbuka', 'Job open'],
  ['Purchases waiting', 'Pembelian menunggu', 'Purchase menunggu'],
  ['Help requests open', 'Permintaan bantuan terbuka', 'Help request open'],
  ['Help requests late', 'Permintaan bantuan lewat', 'Help request lewat'],
  ['Not checked in a year', 'Tidak disemak setahun', 'Tak check setahun'],
  ['Joiners or leavers late', 'Staf masuk/keluar lewat', 'Join/keluar lewat'],
  ['Access for the CEO', 'Akses untuk keputusan CEO', 'Akses untuk CEO decide'],

  // Roles
  ['IT Manager', 'Pengurus IT', 'IT Manager'],
  ['IT Lead', 'Ketua Teknikal IT', 'IT Lead'],
  ['IT Executive', 'Eksekutif IT', 'IT Executive'],
  ['IT tender executive', 'Eksekutif tender IT', 'IT tender executive'],
  ['Tender executive', 'Eksekutif tender', 'Tender executive'],
  ['COO or CEO', 'COO atau CEO', null],
  ['CEO', 'CEO', null],
  ['COO', 'COO', null],

  // My work
  ['You make sure the team does the job: give work, accept it only with proof, and chase what is late. Technical judgement is the IT Lead’s.', 'Anda memastikan pasukan menjalankan kerja: beri tugasan, terima hanya dengan bukti, dan kejar yang lewat. Penilaian teknikal ialah tugas Ketua Teknikal IT.', 'Anda pastikan team buat kerja: beri job, accept hanya dengan proof, dan kejar yang lewat. Hal teknikal ialah tugas IT Lead.'],
  ['Your jobs, and the technical checks waiting for you. You also give out help requests and jobs.', 'Tugasan anda, dan semakan teknikal yang menunggu anda. Anda juga mengagihkan permintaan bantuan dan tugasan.', 'Job anda, dan technical check yang menunggu anda. Anda juga agihkan help request dan job.'],
  ['Everything given to you. Submit each job with proof; the IT Manager accepts it.', 'Semua yang diberi kepada anda. Hantar setiap tugasan dengan bukti; Pengurus IT akan menerimanya.', 'Semua yang diberi kepada anda. Submit setiap job dengan proof; IT Manager akan accept.'],
  ['Nothing is waiting for you.', 'Tiada apa yang menunggu anda.', null],
  ['Done, for you to accept', 'Selesai, untuk anda terima', 'Done, untuk anda accept'],
  ['For your technical check', 'Untuk semakan teknikal anda', 'Untuk technical check anda'],
  ['Late jobs to chase', 'Tugasan lewat untuk dikejar', 'Job lewat untuk dikejar'],
  ['Help requests nobody has', 'Permintaan bantuan belum diagih', 'Help request belum ada PIC'],
  ['My jobs', 'Tugasan saya', 'Job saya'],
  ['My help requests', 'Permintaan bantuan saya', 'Help request saya'],
  ['Joiners, leavers and tenders given to me', 'Staf masuk, keluar dan tender yang diberi kepada saya', 'Onboarding, offboarding dan tender yang diberi kepada saya'],
  ['Tender steps running now', 'Langkah tender sedang berjalan', 'Step tender sedang running'],
  ['Open tenders', 'Buka tender', null],

  // Jobs
  ['Give a job', 'Beri tugasan', 'Beri job'],
  ['Give the job', 'Beri tugasan ini', 'Beri job ini'],
  ['Give to', 'Beri kepada', null],
  ['Give to…', 'Beri kepada…', null],
  ['Nobody yet: give to…', 'Belum ada: beri kepada…', 'Belum ada PIC: beri kepada…'],
  ['Given by', 'Diberi oleh', null],
  ['Given to', 'Diberi kepada', null],
  ['Doer', 'Pelaksana', 'PIC'],
  ['What has to be done', 'Apa yang perlu dibuat', null],
  ['Details: where, for whom, what counts as done', 'Butiran: di mana, untuk siapa, apa yang dikira selesai', 'Butiran: di mana, untuk siapa, apa yang dikira done'],
  ['Technical: the IT Lead checks it before the IT Manager accepts it', 'Teknikal: Ketua Teknikal IT menyemak sebelum Pengurus IT menerimanya', 'Teknikal: IT Lead check dulu sebelum IT Manager accept'],
  ['Task', 'Tugas', 'Task'],
  ['Install or set up', 'Pasang atau sediakan', 'Install atau setup'],
  ['Training (Microsoft 365)', 'Latihan (Microsoft 365)', 'Training (Microsoft 365)'],
  ['Access', 'Akses', null],
  ['Being done', 'Sedang dibuat', 'Sedang dibuat'],
  ['Submitted', 'Dihantar', 'Submitted'],
  ['Accepted', 'Diterima', 'Accepted'],
  ['Sent back', 'Dipulangkan', 'Send back'],
  ['Cancelled', 'Dibatalkan', 'Cancelled'],
  ['Waiting for a check', 'Menunggu semakan', 'Menunggu check'],
  ['Waiting for the IT Lead to check', 'Menunggu semakan Ketua Teknikal IT', 'Menunggu IT Lead check'],
  ['Waiting for the IT Manager to accept', 'Menunggu Pengurus IT menerima', 'Menunggu IT Manager accept'],
  ['Done, to check', 'Selesai, untuk disemak', 'Done, untuk di-check'],
  ['IT Lead checked', 'Disemak Ketua Teknikal IT', 'IT Lead dah check'],
  ['Accept', 'Terima', 'Accept'],
  ['Send back', 'Pulangkan', 'Send back'],
  ['Submit as done', 'Hantar sebagai selesai', 'Submit kerja siap'],
  ['Technical check passed', 'Semakan teknikal lulus', 'Technical check lulus'],
  ['Cancel job', 'Batalkan tugasan', 'Cancel job'],
  ['Change the job', 'Ubah tugasan', 'Ubah job'],
  ['Add note', 'Tambah catatan', 'Tambah nota'],
  ['Note or update', 'Catatan atau kemas kini', 'Nota atau update'],
  ['What was done (needed to submit)', 'Apa yang telah dibuat (wajib untuk hantar)', 'Apa yang dah dibuat (wajib untuk submit)'],
  ['What is missing (needed to send back)', 'Apa yang kurang (wajib untuk pulangkan)', 'Apa yang kurang (wajib untuk send back)'],
  ['Proof', 'Bukti', 'Proof'],
  ['No proof yet. A job cannot be submitted without it.', 'Belum ada bukti. Tugasan tidak boleh dihantar tanpa bukti.', 'Belum ada proof. Job tak boleh submit tanpa proof.'],
  ['a document', 'satu dokumen', null],
  ['Attach document', 'Lampirkan dokumen', 'Attach dokumen'],
  ['Who is doing what (last 30 days)', 'Siapa buat apa (30 hari lepas)', null],
  [
    'On time means accepted jobs submitted by the due date and help requests fixed within their time limit. Sent back counts work the IT Manager or IT Lead returned. Reopened counts fixes the person who asked said did not work. Tender steps counts eP tender steps finished, and how many took longer than their minutes.',
    'Tepat masa bermaksud tugasan diterima yang dihantar sebelum tarikh akhir dan permintaan bantuan yang dibaiki dalam had masa. Dipulangkan mengira kerja yang dipulangkan oleh Pengurus IT atau Ketua Teknikal IT. Dibuka semula mengira pembaikan yang dikatakan tidak berjaya oleh peminta. Langkah tender mengira langkah tender eP yang selesai, dan berapa yang melebihi minit sasaran.',
    'On time bermaksud job accepted yang disubmit sebelum due date dan help request yang settle dalam had masa. Send back kira kerja yang dipulangkan oleh IT Manager atau IT Lead. Reopened kira fix yang peminta kata tak menjadi. Step tender kira step tender eP yang siap, dan berapa yang lebih daripada minit sasaran.',
  ],
  ['Jobs open', 'Tugasan terbuka', 'Job open'],
  ['To check', 'Untuk disemak', 'Untuk check'],
  ['Help open', 'Bantuan terbuka', 'Help open'],
  ['Help late', 'Bantuan lewat', 'Help lewat'],
  ['Help fixed', 'Bantuan selesai', 'Help settle'],
  ['Reopened', 'Dibuka semula', 'Reopened'],
  ['On time', 'Tepat masa', 'On time'],
  ['Tender steps', 'Langkah tender', 'Step tender'],
  ['No work yet', 'Belum ada kerja', null],
  ['Supervises: gives work and accepts it. Not given jobs.', 'Penyelia: memberi kerja dan menerimanya. Tidak diberi tugasan.', 'Supervisor: beri kerja dan accept. Tidak diberi job.'],

  // Help requests
  ['Log a request', 'Rekod permintaan', 'Log request'],
  ['Log it', 'Rekod', 'Log'],
  ['Who asked', 'Siapa yang meminta', 'Siapa yang minta'],
  ['Who asked (name and company)', 'Siapa yang meminta (nama dan syarikat)', 'Siapa yang minta (nama dan syarikat)'],
  ['How they asked', 'Cara mereka meminta', 'Cara mereka minta'],
  ['How they answered', 'Cara mereka menjawab', 'Cara mereka jawab'],
  ['How they answered (e.g. Teams chat, 10:40)', 'Cara mereka menjawab (cth. sembang Teams, 10:40)', 'Cara mereka jawab (cth. Teams chat, 10:40)'],
  ['If not fixed: what is still wrong', 'Jika belum baik: apa yang masih bermasalah', 'Kalau belum settle: apa yang masih rosak'],
  ['They say it is fixed', 'Mereka sahkan sudah baik', 'Mereka confirm dah settle'],
  ['Not fixed: reopen', 'Belum baik: buka semula', 'Belum settle: reopen'],
  ['Teams', 'Teams', null],
  ['Email', 'E-mel', 'Email'],
  ['Phone', 'Telefon', 'Phone'],
  ['In person', 'Bersemuka', 'Depan-depan'],
  ['About', 'Berkenaan', 'Pasal'],
  ['Urgency', 'Tahap kesegeraan', 'Urgency'],
  ['P1: work stopped', 'P1: kerja terhenti', null],
  ['P2: work slowed', 'P2: kerja perlahan', null],
  ['P3: can wait', 'P3: boleh tunggu', null],
  ['P1: I cannot work at all', 'P1: Saya langsung tidak boleh bekerja', 'P1: Saya langsung tak boleh buat kerja'],
  ['P2: work is slowed down', 'P2: kerja menjadi perlahan', 'P2: kerja jadi slow'],
  ['P3: a question or training', 'P3: soalan atau latihan', 'P3: soalan atau training'],
  ['What is wrong', 'Apa masalahnya', null],
  ['Account or password', 'Akaun atau kata laluan', 'Akaun atau password'],
  ['Device', 'Peranti', 'Device'],
  ['Internet or network', 'Internet atau rangkaian', 'Internet atau network'],
  ['Microsoft 365', 'Microsoft 365', null],
  ['Prima', 'Prima', null],
  ['Show resolved', 'Papar yang selesai', 'Show yang settle'],
  ['Hide resolved', 'Sembunyi yang selesai', 'Hide yang settle'],
  ['What fixed it', 'Apa yang membaikinya', 'Apa yang settle-kan'],
  ['Take it', 'Ambil', null],
  ['Resolve', 'Selesaikan', 'Settle'],
  ['Resolved', 'Selesai', 'Settled'],
  ['Resolved late', 'Selesai lewat', 'Settle lewat'],
  ['Open', 'Buka', null],
  ['Being worked', 'Sedang diusahakan', 'Sedang dibuat'],
  ['Past time limit', 'Melebihi had masa', 'Lepas had masa'],
  ['Time limits: P1', 'Had masa: P1', null],
  ['hours, P2', 'jam, P2', null],
  ['hours, P3', 'jam, P3', null],
  ['hours.', 'jam.', null],
  ['Nothing open.', 'Tiada yang terbuka.', null],
  ['Ask IT for help', 'Minta bantuan IT', null],
  ['Send to IT', 'Hantar kepada IT', null],
  ['Yes, it is fixed', 'Ya, sudah baik', 'Ya, dah settle'],
  ['Not fixed', 'Belum baik', 'Belum settle'],
  ['You have not asked IT for anything yet.', 'Anda belum meminta apa-apa daripada IT.', null],
  ['waiting for the person to confirm', 'menunggu pengesahan peminta', 'tunggu peminta confirm'],
  ['confirmed by the person', 'disahkan oleh peminta', 'peminta dah confirm'],
  ['not answered, counted as confirmed', 'tiada jawapan, dikira disahkan', 'tiada jawapan, dikira confirmed'],
  ['the COO sees it', 'COO dapat melihatnya', 'COO nampak'],
  ['not given to anyone', 'belum diberi kepada sesiapa', 'belum ada PIC'],
  ['Thank you. Confirmed.', 'Terima kasih. Disahkan.', 'Terima kasih. Confirmed.'],

  // Buying
  ['Ask to buy', 'Mohon pembelian', 'Mohon purchase'],
  ['Why it is needed', 'Sebab ia diperlukan', null],
  ['For', 'Untuk', null],
  ['Item and model', 'Barang dan model', 'Item dan model'],
  ['Item', 'Barang', 'Item'],
  ['Qty', 'Kuantiti', 'Qty'],
  ['Quantity', 'Kuantiti', null],
  ['Unit price', 'Harga seunit', 'Harga unit'],
  ['Unit price, RM', 'Harga seunit, RM', 'Harga unit, RM'],
  ['Send for approval', 'Hantar untuk kelulusan', 'Hantar untuk approval'],
  [
    'An IT Executive asks and the IT Manager agrees the need. IT then gets 3 quotes from different suppliers and checks the online price, each with its document. The COO approves, then the CEO, in Prima or in Teams Approvals; nothing is bought before both. The approved purchase goes to Finance to pay, then IT receives it with the signed delivery order and tags it.',
    'Eksekutif IT memohon dan Pengurus IT bersetuju dengan keperluan. IT kemudian mendapatkan 3 sebut harga daripada pembekal berbeza dan menyemak harga dalam talian, setiap satu dengan dokumennya. COO meluluskan, kemudian CEO, dalam Prima atau dalam Teams Approvals; tiada pembelian sebelum kedua-duanya lulus. Pembelian yang lulus dihantar kepada Kewangan untuk dibayar, kemudian IT menerimanya dengan nota hantaran bertandatangan dan melabelkannya.',
    'IT Executive mohon dan IT Manager setuju keperluannya. IT kemudian dapatkan 3 quotation daripada supplier berbeza dan check harga online, setiap satu dengan dokumen. COO approve, kemudian CEO, dalam Prima atau Teams Approvals; tiada pembelian sebelum kedua-duanya approve. Purchase yang approved pergi ke Finance untuk bayar, kemudian IT terima barang dengan DO bertandatangan dan tag aset.',
  ],
  ['Approve', 'Lulus', 'Approve'],
  ['Reject', 'Tolak', 'Reject'],
  ['Rejected', 'Ditolak', 'Rejected'],
  ['Received', 'Diterima', 'Received'],
  ['Asked by', 'Dimohon oleh', null],
  ['Supplier', 'Pembekal', 'Supplier'],
  ['Supplier quote', 'Sebut harga pembekal', 'Quotation supplier'],
  ['Online or marketplace price', 'Harga dalam talian atau marketplace', 'Harga online atau marketplace'],
  ['Website or marketplace', 'Laman web atau marketplace', 'Website atau marketplace'],
  ['Total, RM', 'Jumlah, RM', null],
  ['Total RM', 'Jumlah RM', null],
  ['Quotation number', 'Nombor sebut harga', 'No. quotation'],
  ['Link to the listing', 'Pautan ke senarai jualan', 'Link ke listing'],
  ['Add quote', 'Tambah sebut harga', 'Tambah quotation'],
  ['Add online price', 'Tambah harga dalam talian', 'Tambah harga online'],
  ['Choose supplier', 'Pilih pembekal', 'Pilih supplier'],
  ['Why this one', 'Kenapa yang ini', null],
  ['Why, if not the lowest', 'Sebab, jika bukan yang termurah', 'Sebab, kalau bukan yang paling murah'],
  ['Send for COO then CEO approval', 'Hantar untuk kelulusan COO kemudian CEO', 'Hantar untuk approval COO kemudian CEO'],
  ['Lowest', 'Termurah', 'Paling murah'],
  ['Online:', 'Dalam talian:', 'Online:'],
  ['Chosen:', 'Dipilih:', null],
  ['COO: not yet', 'COO: belum', null],
  ['CEO: not yet', 'CEO: belum', null],
  ['Note (needed to reject)', 'Catatan (wajib untuk tolak)', 'Nota (wajib untuk reject)'],
  ['Teams approval', 'Kelulusan Teams', 'Teams approval'],
  ['Teams approval title or link', 'Tajuk atau pautan kelulusan Teams', 'Tajuk atau link Teams approval'],
  ['Record approval', 'Rekod kelulusan', 'Rekod approval'],
  ['Record rejection', 'Rekod penolakan', 'Rekod reject'],
  ['decided in Teams Approvals? Record it here with the approval title and a screenshot.', 'telah membuat keputusan dalam Teams Approvals? Rekodkan di sini dengan tajuk kelulusan dan tangkapan skrin.', 'dah decide dalam Teams Approvals? Rekod di sini dengan tajuk approval dan screenshot.'],
  ['Where it went to Finance (Teams approval or email subject)', 'Ke mana ia dihantar kepada Kewangan (kelulusan Teams atau subjek e-mel)', 'Hantar ke Finance melalui (Teams approval atau subjek email)'],
  ['Passed to Finance to pay', 'Dihantar kepada Kewangan untuk dibayar', 'Dah hantar ke Finance untuk bayar'],
  ['Finance payment voucher', 'Baucar bayaran Kewangan', 'Payment voucher Finance'],
  ['Payment reference', 'Rujukan bayaran', 'Rujukan payment'],
  ['Paid on', 'Dibayar pada', null],
  ['Finance has paid', 'Kewangan telah membayar', 'Finance dah bayar'],
  ['Delivery order', 'Nota hantaran', 'DO'],
  ['Delivery order number', 'Nombor nota hantaran', 'No. DO'],
  ['Received: tag the items', 'Diterima: labelkan barang', 'Received: tag barang'],
  ['With IT Manager', 'Pada Pengurus IT', 'Pada IT Manager'],
  ['With COO approval', 'Menunggu kelulusan COO', 'Menunggu approval COO'],
  ['With CEO approval', 'Menunggu kelulusan CEO', 'Menunggu approval CEO'],
  ['With Finance to pay', 'Menunggu bayaran Kewangan', 'Menunggu Finance bayar'],
  ['With IT: three quotes and an online price', 'Pada IT: tiga sebut harga dan harga dalam talian', 'Pada IT: tiga quotation dan harga online'],
  ['With IT to receive the goods', 'Pada IT untuk terima barang', null],
  ['Tag received items', 'Labelkan barang yang diterima', 'Tag barang yang diterima'],

  // Tenders
  ['IT tenders (eP and government)', 'Tender IT (eP dan kerajaan)', null],
  ['Add a tender found', 'Tambah tender yang ditemui', 'Tambah tender baru jumpa'],
  [
    'Every stage has a target in minutes and its clock starts when the stage before it is done: the earlier the bid is in eP, the better its chances. The closing date is only the last line; the bid goes in at least a day before.',
    'Setiap peringkat ada sasaran dalam minit dan masanya bermula apabila peringkat sebelumnya selesai: lebih awal tawaran dihantar dalam eP, lebih cerah peluangnya. Tarikh tutup hanyalah had terakhir; tawaran dihantar sekurang-kurangnya sehari sebelum.',
    'Setiap stage ada target dalam minit dan masa mula bila stage sebelumnya selesai: lebih awal bid masuk eP, lebih cerah peluang. Tarikh tutup cuma had terakhir; bid masuk sekurang-kurangnya sehari sebelum.',
  ],
  ['Tender executive (paired with the IT Manager):', 'Eksekutif tender (berpasangan dengan Pengurus IT):', 'Tender executive (pair dengan IT Manager):'],
  ['not named yet', 'belum dinamakan', null],
  ['Choose…', 'Pilih…', null],
  ['Which companies hold IT codes', 'Syarikat yang memegang kod IT', 'Syarikat yang ada kod IT'],
  ['Record a company', 'Rekod syarikat', null],
  [
    "Checked by the IT Manager during the pilot, from each company's MOF certificate. An IT tender is bid only in the name of a company holding the codes asked, with the certificate in force. PWVSB is the group company and holds no codes.",
    'Disemak oleh Pengurus IT semasa projek rintis, berdasarkan sijil MOF setiap syarikat. Tender IT hanya dibida atas nama syarikat yang memegang kod yang diminta, dengan sijil yang masih sah. PWVSB ialah syarikat kumpulan dan tidak memegang sebarang kod.',
    'Di-check oleh IT Manager semasa pilot, berdasarkan sijil MOF setiap syarikat. Tender IT hanya dibida atas nama syarikat yang ada kod yang diminta, dengan sijil masih sah. PWVSB ialah syarikat kumpulan dan tiada kod.',
  ],
  ['Still to check:', 'Belum disemak:', 'Belum check:'],
  ['Certificate', 'Sijil', null],
  ['No IT code', 'Tiada kod IT', null],
  ['IT codes', 'Kod IT', null],
  ['IT codes, one per line, as on the certificate (e.g. 210101 Perkakasan ICT). Leave empty if it holds none.', 'Kod IT, satu setiap baris, seperti dalam sijil (cth. 210101 Perkakasan ICT). Biarkan kosong jika tiada.', 'Kod IT, satu setiap line, ikut sijil (cth. 210101 Perkakasan ICT). Biar kosong kalau tiada.'],
  ['MOF certificate number', 'Nombor sijil MOF', 'No. sijil MOF'],
  ['Certificate number', 'Nombor sijil', 'No. sijil'],
  ['Certificate expiry', 'Tarikh tamat sijil', null],
  ['Note (needed when it holds no IT code)', 'Catatan (wajib jika tiada kod IT)', 'Nota (wajib kalau tiada kod IT)'],
  ['Save the codes', 'Simpan kod', 'Save kod'],
  ['Checked: holds no IT code', 'Disemak: tiada kod IT', 'Dah check: tiada kod IT'],
  ['Open tender', 'Tender terbuka', 'Open tender'],
  ['Quotation', 'Sebut harga', 'Quotation'],
  ['Quotation (sebut harga)', 'Sebut harga', 'Quotation (sebut harga)'],
  ['Closes on', 'Tarikh tutup', null],
  ['Title as on eP', 'Tajuk seperti dalam eP', 'Tajuk ikut eP'],
  ['Ministry, agency or council', 'Kementerian, agensi atau majlis', null],
  ['Bid in the name of', 'Bida atas nama', 'Bid atas nama'],
  ['Compulsory briefing or site visit (if any)', 'Taklimat atau lawatan tapak wajib (jika ada)', 'Taklimat atau site visit wajib (kalau ada)'],
  ['Briefing on', 'Taklimat pada', null],
  ['Add and start the clock', 'Tambah dan mula kira masa', 'Tambah dan start masa'],
  ['Timeline, parts and papers', 'Garis masa, bahagian dan dokumen', 'Timeline, bahagian dan dokumen'],
  ['Hide timeline', 'Sembunyi garis masa', 'Hide timeline'],
  ['Show won, lost and dropped', 'Papar yang menang, kalah dan tidak dibida', 'Show yang menang, kalah dan drop'],
  ['Hide won, lost and dropped', 'Sembunyi yang menang, kalah dan tidak dibida', 'Hide yang menang, kalah dan drop'],
  ['No IT tenders running.', 'Tiada tender IT sedang berjalan.', 'Tiada tender IT sedang running.'],
  ['IT parts', 'Bahagian IT', null],
  ['Papers from the company', 'Dokumen daripada syarikat', null],
  ['Preparing', 'Dalam penyediaan', 'Preparing'],
  ['With the company for eP', 'Pada syarikat untuk eP', null],
  ['Submitted in eP', 'Dihantar dalam eP', 'Submitted dalam eP'],
  ['Won', 'Menang', null],
  ['Lost', 'Kalah', null],
  ['Not bid', 'Tidak dibida', 'Tak bid'],
  ['Go: we bid', 'Teruskan: kita bida', 'Go: kita bid'],
  ['No-go', 'Tidak teruskan', 'No-go'],
  ['Submitted: save the slip', 'Dihantar: simpan slip', 'Submitted: simpan slip'],
  ['Who in the company received the bid pack', 'Siapa dalam syarikat yang menerima pek tawaran', 'Siapa dalam syarikat yang terima bid pack'],
  ['Who attended, or why not needed', 'Siapa yang hadir, atau sebab tidak perlu', 'Siapa hadir, atau kenapa tak perlu'],
  ['Note (needed for no-go)', 'Catatan (wajib jika tidak teruskan)', 'Nota (wajib untuk no-go)'],
  ['Done, with the document', 'Selesai, dengan dokumen', 'Done, dengan dokumen'],
  ['What to fix', 'Apa yang perlu dibetulkan', null],
  ['Asked the company', 'Sudah minta daripada syarikat', 'Dah minta dari syarikat'],
  ['Received, with the paper', 'Diterima, dengan dokumen', 'Received, dengan dokumen'],
  ['Asked', 'Sudah diminta', 'Dah minta'],
  ['Not asked', 'Belum diminta', 'Belum minta'],
  ['not given', 'belum diberi', 'belum ada PIC'],
  ['eP (ePerolehan)', 'eP (ePerolehan)', null],
  // Tender steps (rule IT-TENDER)
  ['Logged from eP; IT codes and MOF certificate checked', 'Direkod daripada eP; kod IT dan sijil MOF disemak', 'Direkod dari eP; kod IT dan sijil MOF di-check'],
  ['Go or no-go decided (codes, certificate, value, site)', 'Keputusan teruskan atau tidak (kod, sijil, nilai, tapak)', 'Keputusan go atau no-go (kod, sijil, nilai, site)'],
  ['Go or no-go decided', 'Keputusan teruskan atau tidak', 'Keputusan go atau no-go'],
  ['Tender document bought or downloaded in eP', 'Dokumen tender dibeli atau dimuat turun dalam eP', 'Dokumen tender dibeli atau download dalam eP'],
  ['Quotation document downloaded in eP', 'Dokumen sebut harga dimuat turun dalam eP', 'Dokumen quotation download dalam eP'],
  ['Company papers asked from the company', 'Dokumen syarikat diminta daripada syarikat', 'Dokumen syarikat diminta dari syarikat'],
  ['Arahan kepada petender read and the IT checklist made', 'Arahan kepada petender dibaca dan senarai semak IT disediakan', 'Arahan kepada petender dibaca dan checklist IT disediakan'],
  ['Quotation instructions read and the IT checklist made', 'Arahan sebut harga dibaca dan senarai semak IT disediakan', 'Arahan quotation dibaca dan checklist IT disediakan'],
  ['Briefing or site visit attended (when compulsory)', 'Taklimat atau lawatan tapak dihadiri (jika wajib)', 'Taklimat atau site visit dihadiri (kalau wajib)'],
  ['IT parts drafted: proposal, specifications, compliance table, price', 'Bahagian IT dideraf: cadangan, spesifikasi, jadual pematuhan, harga', 'Bahagian IT di-draft: proposal, spesifikasi, compliance table, harga'],
  ['IT parts drafted, with the price', 'Bahagian IT dideraf, dengan harga', 'Bahagian IT di-draft, dengan harga'],
  ['IT parts drafted', 'Bahagian IT dideraf', 'Bahagian IT di-draft'],
  ['Technical check by the IT Lead', 'Semakan teknikal oleh Ketua Teknikal IT', 'Technical check oleh IT Lead'],
  ['Company papers received', 'Dokumen syarikat diterima', null],
  ['Price agreed with the company manager', 'Harga dipersetujui dengan pengurus syarikat', 'Harga dipersetujui dengan company manager'],
  ['Price seen by the COO or CEO', 'Harga dilihat oleh COO atau CEO', 'Harga dilihat COO atau CEO'],
  ['Bid pack handed to the company', 'Pek tawaran diserahkan kepada syarikat', 'Bid pack diserahkan kepada syarikat'],
  ['Submitted in eP by the IT tender executive and the slip saved', 'Dihantar dalam eP oleh eksekutif tender IT dan slip disimpan', 'Submit dalam eP oleh IT tender executive dan slip disimpan'],
  ['Company checked in eP that the bid is submitted', 'Syarikat menyemak dalam eP bahawa tawaran telah dihantar', 'Syarikat check dalam eP yang bid dah submit'],
  ['Opening result or award recorded', 'Keputusan pembukaan atau award direkod', 'Keputusan opening atau award direkod'],
  ['Result recorded', 'Keputusan direkod', null],
  // Tender parts and papers (defaults)
  ['Technical proposal', 'Cadangan teknikal', 'Technical proposal'],
  ['Hardware and software list', 'Senarai perkakasan dan perisian', 'Senarai hardware dan software'],
  ['Compliance table against the specification', 'Jadual pematuhan berbanding spesifikasi', 'Compliance table ikut spesifikasi'],
  ['Price schedule (IT part)', 'Jadual harga (bahagian IT)', 'Price schedule (bahagian IT)'],
  ['Company IT experience and staff CVs', 'Pengalaman IT syarikat dan CV staf', null],
  ['MOF certificate (IT codes)', 'Sijil MOF (kod IT)', null],
  ['SSM company profile', 'Profil syarikat SSM', null],
  ['Latest audited accounts', 'Akaun teraudit terkini', null],
  ['Bank statement (3 months)', 'Penyata bank (3 bulan)', null],

  // Away
  ['When the IT Manager is away', 'Semasa Pengurus IT bercuti', 'Bila IT Manager cuti'],
  ['While the IT Manager is away the COO accepts finished work, so nothing waits.', 'Semasa Pengurus IT bercuti, COO menerima kerja yang siap supaya tiada yang tertangguh.', 'Masa IT Manager cuti, COO accept kerja yang siap supaya tiada yang tertangguh.'],
  ['First day away', 'Hari pertama bercuti', 'Hari pertama cuti'],
  ['Last day away', 'Hari terakhir bercuti', 'Hari terakhir cuti'],
  ['The IT Manager is back', 'Pengurus IT sudah kembali', 'IT Manager dah masuk kerja'],
  ['Away now: the COO accepts', 'Sedang bercuti: COO menerima', 'Sedang cuti: COO accept'],

  // Systems and access
  ['Systems and who may sign in', 'Sistem dan siapa boleh log masuk', 'Sistem dan siapa boleh sign in'],
  ['Ask the CEO to change access', 'Minta CEO menukar akses', 'Minta CEO ubah akses'],
  ['Access changes for the CEO', 'Perubahan akses untuk keputusan CEO', 'Perubahan akses untuk CEO decide'],
  ['The list is right', 'Senarai ini betul', 'List ni betul'],
  ['Review due', 'Semakan perlu dibuat', 'Review due'],
  ['two-step sign-in', 'log masuk dua langkah', '2-step sign in'],
  ['Two-step sign-in off', 'Log masuk dua langkah tidak aktif', '2-step sign in OFF'],
  ['master sign-in kept:', 'log masuk utama disimpan di:', 'master sign in disimpan di:'],

  // Assets, onboarding
  ['In use', 'Digunakan', 'In use'],
  ['in use', 'digunakan', 'in use'],
  ['Spare', 'Simpanan', 'Spare'],
  ['In repair', 'Dalam pembaikan', 'Dalam repair'],
  ['Disposal asked', 'Pelupusan dimohon', 'Disposal dimohon'],
  ['Disposed', 'Telah dilupuskan', 'Disposed'],
  ['Laptops', 'Komputer riba', 'Laptop'],
  ['Desktops', 'Komputer meja', 'Desktop'],
  ['Phones', 'Telefon', 'Phone'],
  ['Tablets', 'Tablet', null],
  ['Printers', 'Pencetak', 'Printer'],
  ['Network', 'Rangkaian', 'Network'],
  ['By kind', 'Mengikut jenis', 'Ikut jenis'],
  ['Repair', 'Pembaikan', 'Repair'],
  ['Service', 'Servis', null],
  ['Joins', 'Mula bekerja', 'Join'],
  ['Leaves', 'Berhenti', 'Keluar'],
  ['Every joiner gets a Microsoft 365 account, a device, Prima access and Microsoft 365 training by the first day. Every leaver is closed off by the last day.', 'Setiap staf baharu mendapat akaun Microsoft 365, peranti, akses Prima dan latihan Microsoft 365 pada hari pertama. Setiap staf yang berhenti ditutup aksesnya pada hari terakhir.', 'Setiap staf baru dapat akaun Microsoft 365, device, akses Prima dan training Microsoft 365 pada hari pertama. Setiap staf yang berhenti ditutup aksesnya pada hari terakhir.'],
  ['Microsoft 365 account and mailbox', 'Akaun dan peti mel Microsoft 365', 'Akaun dan mailbox Microsoft 365'],
  ['Laptop or phone issued and tagged', 'Komputer riba atau telefon diberi dan dilabel', 'Laptop atau phone diberi dan di-tag'],
  ['Prima access with the right role', 'Akses Prima dengan peranan yang betul', 'Akses Prima dengan role yang betul'],
  ['Microsoft 365 training given', 'Latihan Microsoft 365 diberi', 'Training Microsoft 365 diberi'],
  ['Microsoft 365 account blocked, mail forwarded', 'Akaun Microsoft 365 disekat, e-mel dimajukan', 'Akaun Microsoft 365 di-block, email di-forward'],
  ['Devices returned and checked', 'Peranti dipulangkan dan disemak', 'Device dipulangkan dan di-check'],
  ['Prima access removed', 'Akses Prima dibuang', 'Akses Prima dibuang'],

  // Audit and HR
  ['Controls', 'Kawalan', 'Control'],
  ['Rules that must always hold. Each counts how many times it was broken, so 0 means it held.', 'Peraturan yang mesti sentiasa dipatuhi. Setiap satu mengira berapa kali ia dilanggar; 0 bermaksud ia dipatuhi.', 'Rule yang mesti sentiasa dipatuhi. Setiap satu kira berapa kali dilanggar; 0 bermaksud dipatuhi.'],
  ['Nobody accepted their own job', 'Tiada sesiapa menerima tugasan sendiri', 'Tiada siapa accept job sendiri'],
  ['Every accepted job has proof', 'Setiap tugasan yang diterima ada bukti', 'Setiap job yang accepted ada proof'],
  ['Nobody recorded the answer on a request they fixed', 'Tiada sesiapa merekod jawapan bagi permintaan yang dibaikinya sendiri', 'Tiada siapa rekod jawapan untuk request yang dia settle sendiri'],
  ['Nothing went to Finance without COO and CEO approval', 'Tiada yang dihantar kepada Kewangan tanpa kelulusan COO dan CEO', 'Tiada yang pergi ke Finance tanpa approval COO dan CEO'],
  ['Every purchase sent for approval had 3 quotes', 'Setiap pembelian yang dihantar untuk kelulusan ada 3 sebut harga', 'Setiap purchase yang dihantar untuk approval ada 3 quotation'],
  ['Every eP submission has its slip', 'Setiap penghantaran eP ada slipnya', 'Setiap submission eP ada slip'],
  ['The CEO owns every system', 'CEO memiliki setiap sistem', 'CEO owner setiap sistem'],
  ['Found in the records: late or returned work, choices that needed a reason, approvals recorded from Teams, and settings to fix. Open the record\'s proof from its own tab.', 'Ditemui dalam rekod: kerja lewat atau dipulangkan, pilihan yang memerlukan sebab, kelulusan yang direkod daripada Teams, dan tetapan yang perlu dibetulkan. Buka bukti rekod daripada tabnya sendiri.', 'Dijumpai dalam rekod: kerja lewat atau send back, pilihan yang perlu sebab, approval yang direkod dari Teams, dan setting yang perlu dibetulkan. Buka proof rekod dari tab masing-masing.'],
  ['Nothing found.', 'Tiada apa ditemui.', 'Tiada apa dijumpai.'],
  ['Note', 'Catatan', 'Nota'],
  ['Every IT action', 'Setiap tindakan IT', 'Setiap action IT'],
  ['Person or reference', 'Orang atau rujukan', 'Staf atau rujukan'],
  ['From the audit trail, newest first. Entries cannot be edited or removed.', 'Daripada jejak audit, terbaru dahulu. Catatan tidak boleh diubah atau dibuang.', 'Dari audit trail, terbaru dulu. Entry tak boleh diubah atau dibuang.'],
  ['No IT actions yet in this test.', 'Belum ada tindakan IT dalam ujian ini.', 'Belum ada action IT dalam test ini.'],
  ['Jobs', 'Tugasan', 'Job'],
  ['Help requests', 'Permintaan bantuan', 'Help request'],
  ['Systems', 'Sistem', null],
  ['IT codes not yet checked against the MOF certificate', 'Kod IT belum disemak berdasarkan sijil MOF', 'Kod IT belum di-check dengan sijil MOF'],
  ['MOF certificate has ended', 'Sijil MOF telah tamat', 'Sijil MOF dah tamat'],
  ['Access list not confirmed by the CEO in the last 90 days', 'Senarai akses belum disahkan oleh CEO dalam 90 hari lepas', 'Senarai akses belum di-confirm CEO dalam 90 hari lepas'],
  ['Two-step sign-in (MFA) is off', 'Log masuk dua langkah (MFA) tidak aktif', '2-step sign in (MFA) OFF'],
  ['Two-step sign-in (MFA) not checked', 'Log masuk dua langkah (MFA) belum disemak', '2-step sign in (MFA) belum check'],
  ['Fixed after its time limit', 'Dibaiki selepas had masa', 'Settle lepas had masa'],
  ['Counted as fixed because the person did not answer', 'Dikira selesai kerana peminta tidak menjawab', 'Dikira settle sebab peminta tak jawab'],
  ['Note', 'Catatan', 'Nota'],

  // Websites (top level)
  ['Website sections', 'Bahagian laman web', 'Bahagian website'],
  ['The websites and domains assigned to you.', 'Laman web dan domain yang diberikan kepada anda.', 'Website dan domain yang diberi kepada anda.'],
  ['Domains', 'Domain', null],
  ['Live websites', 'Laman web aktif', 'Website live'],
  ['Domains expiring', 'Domain akan tamat', 'Domain nak expire'],
  ['Critical issues', 'Isu kritikal', null],
  ['Issues', 'Isu', null],
  ['Issues open', 'Isu terbuka', null],
  ['Quarterly reviews', 'Semakan suku tahunan', 'Review suku tahun'],
  ['Monthly checks', 'Semakan bulanan', 'Check bulanan'],
  ['DNS changes', 'Perubahan DNS', null],
  ['Connections', 'Sambungan', 'Connection'],
  ['Register', 'Daftar', null],
  ['Not connected', 'Tidak bersambung', 'Tak connected'],
  // Site man-hours (Fauzan, 6 Nov 2026)
  ["Site man-hours", "Jam tenaga kerja tapak", "Man-hours site"],
  ["Sites to look at", "Tapak untuk disemak", "Site untuk check"],
  ["All sites", "Semua tapak", "Semua site"],
  ["Over the total: needs approval", "Melebihi jumlah: perlu kelulusan", "Lebih total: perlu approval"],
  ["Roster over the total", "Jadual melebihi jumlah", "Roster lebih total"],
  ["Heading over", "Akan melebihi", "Nak lebih"],
  ["Extra hours approved", "Jam tambahan diluluskan", "Extra jam approved"],
  ["Within the total", "Dalam jumlah", "Dalam total"],
  ["People needed", "Orang diperlukan", null],
  ["Allowed this month", "Dibenarkan bulan ini", "Allowed bulan ini"],
  ["Worked so far", "Bekerja setakat ini", "Kerja setakat ini"],
  ["Over the total", "Melebihi jumlah", "Lebih total"],
  ["Approve extra hours", "Luluskan jam tambahan", "Approve extra jam"],
  ["Extra hours", "Jam tambahan", "Extra jam"],
  ["Show posts", "Tunjuk pos", null],
  ["Hide posts", "Sorok pos", null],
  ["Show only flagged sites", "Tunjuk tapak yang ditanda sahaja", "Tunjuk site flagged sahaja"],
  ["Every site is within its total man-hours.", "Setiap tapak dalam jumlah jam tenaga kerjanya.", "Semua site dalam total man-hours."],
  ["Guard on training (relief covers the post)", "Pengawal berkursus (ganti menjaga pos)", "Guard training (relief cover post)"],
  ["Annual leave (relief covers the post)", "Cuti tahunan (ganti menjaga pos)", "Cuti tahunan (relief cover post)"],
  ["On-the-job training (new guard alongside)", "Latihan semasa kerja (pengawal baharu bersama)", "OJT (guard baru sekali)"],
  ["Client asked for extra guards or hours", "Pelanggan minta pengawal atau jam tambahan", "Client minta extra guard atau jam"],
  ["Extra hours approved.", "Jam tambahan diluluskan.", "Extra jam approved."],
  // Public holidays (Fauzan, 6 Nov 2026)
  ["Public holidays", "Cuti umum", null],
  ["Man-hours", "Jam tenaga kerja", "Man-hours"],
  ["Not set", "Belum ditetapkan", "Belum set"],
  ["Uses the whole-company list", "Guna senarai seluruh syarikat", "Guna list seluruh syarikat"],
  ["Set the 11 public holidays", "Tetapkan 11 hari cuti umum", "Set 11 hari cuti umum"],
  ["Change the list", "Tukar senarai", "Tukar list"],
  ["Save the public holidays", "Simpan cuti umum", null],
  ["Public holidays saved.", "Cuti umum disimpan.", null],
  ["Earlier versions", "Versi terdahulu", "Versi lama"],
  ["Same days as the whole-company list above. Set a list here only if this state's holidays differ.", "Hari sama seperti senarai seluruh syarikat di atas. Tetapkan senarai di sini hanya jika cuti negeri ini berbeza.", "Hari sama macam list seluruh syarikat di atas. Set list sini hanya kalau cuti negeri ini lain."],
  ["Holiday name", "Nama cuti", null],
  ["Add a day (government-declared extra holiday)", "Tambah hari (cuti tambahan diisytiharkan kerajaan)", "Tambah hari (cuti extra kerajaan)"],
  // Salary calculator (Fauzan, 6 Nov 2026)
  ["Salary calculator", "Kalkulator gaji", null],
  ["The guard's month", "Bulan pengawal", "Bulan guard"],
  ["Working days worked", "Hari kerja bekerja", "Hari kerja"],
  ["Training days", "Hari latihan", "Hari training"],
  ["Annual leave days", "Hari cuti tahunan", null],
  ["MC days", "Hari MC", null],
  ["Public holidays off", "Cuti umum tidak bekerja", "Cuti umum off"],
  ["Rest days worked", "Hari rehat bekerja", "Rest day kerja"],
  ["Public holidays worked", "Cuti umum bekerja", "Cuti umum kerja"],
  ["Gross pay", "Gaji kasar", "Gross pay"],
  ["Salary", "Gaji", null],
  // Guard pay run (Fauzan, 5 Nov 2026)
  ["Guard pay", "Gaji pengawal", "Gaji guard"],
  ["My payslips", "Slip gaji saya", "Payslip saya"],
  ["Submit to the COO", "Hantar kepada COO", "Submit kepada COO"],
  ["Return to HR", "Pulangkan kepada HR", "Return kepada HR"],
  ["Mark paid", "Tanda sudah dibayar", "Mark paid"],
  ["Add holiday", "Tambah cuti umum", "Tambah cuti umum"],
  // Pay-out rules and advances (Fauzan, 6 Nov 2026)
  ["Wage advances", "Pendahuluan gaji", "Advance gaji"],
  ["Advances and loans", "Pendahuluan dan pinjaman", "Advance dan loan"],
  ["Statutory rates", "Kadar caruman berkanun", "Kadar statutory"],
  ["Set advances", "Tetapkan pendahuluan", "Set advance"],
  ["How it is paid", "Cara dibayar", "Cara bayar"],
  ["List for cash", "Senarai untuk tunai", "List untuk cash"],
  ["Give cash", "Beri tunai", "Bagi cash"],
  ["Refuse", "Tolak", null],
  ["Take off the list", "Keluarkan dari senarai", "Buang dari list"],
  ["Save change", "Simpan perubahan", "Save perubahan"],
  ["Cancel advance", "Batal pendahuluan", "Cancel advance"],
  ["Change or cancel", "Tukar atau batal", "Tukar atau cancel"],
  ["Pay law settings", "Tetapan undang-undang gaji", "Setting undang-undang gaji"],
  ["Set by the CEO", "Ditetapkan oleh CEO", "Set oleh CEO"],
  ["Change the pay law settings", "Tukar tetapan undang-undang gaji", "Tukar setting undang-undang gaji"],
  ["Save the pay law settings", "Simpan tetapan undang-undang gaji", "Simpan setting undang-undang gaji"],
  ["Pay law settings saved.", "Tetapan undang-undang gaji disimpan.", "Setting undang-undang gaji disimpan."],
  // Pay formulas (Fauzan, 5 Nov 2026)
  ["Name", "Nama", null],
  ["Set live", "Dikuatkuasakan", "Set live"],
  ["Pay formulas", "Formula gaji", null],
  ["Guard salary (shift)", "Gaji pengawal (syif)", "Gaji guard (shift)"],
  ["Driver overtime", "Kerja lebih masa pemandu", "OT driver"],
  ["Whole group", "Seluruh kumpulan", "Seluruh group"],
  ["Region", "Wilayah", "Region"],
  ["Site", "Tapak", "Site"],
  ["Waiting for the ACT Director", "Menunggu Pengarah ACT", "Tunggu ACT Director"],
  ["Withdrawn", "Ditarik balik", "Withdraw"],
  ["Only ACT and group leadership see the pay formulas.", "Hanya ACT dan pimpinan kumpulan boleh melihat formula gaji.", "Hanya ACT dan group leadership boleh tengok formula gaji."],
  ["How guard salary and driver overtime are counted. The ACT Director sets each formula and decides where it is used: the whole group, a region, a company or a site. The narrowest one wins. The ACT team can prepare amount changes for the Director. Group leadership sees everything here.", "Cara gaji pengawal dan kerja lebih masa pemandu dikira. Pengarah ACT menetapkan setiap formula dan memutuskan di mana ia digunakan: seluruh kumpulan, wilayah, syarikat atau tapak. Yang paling khusus diguna pakai. Pasukan ACT boleh menyediakan perubahan amaun untuk Pengarah. Pimpinan kumpulan melihat semua di sini.", "Cara gaji guard dan OT driver dikira. ACT Director set setiap formula dan tentukan di mana ia dipakai: seluruh group, region, syarikat atau site. Yang paling khusus menang. Team ACT boleh sediakan perubahan amaun untuk Director. Group leadership tengok semua di sini."],
  ["You are the ACT Director: you set formulas and where they are used.", "Anda Pengarah ACT: anda menetapkan formula dan di mana ia digunakan.", "Anda ACT Director: anda set formula dan di mana ia dipakai."],
  ["You are in ACT: you prepare amount changes; the ACT Director makes them live.", "Anda dalam ACT: anda menyediakan perubahan amaun; Pengarah ACT yang menguatkuasakannya.", "Anda dalam ACT: anda sediakan perubahan amaun; ACT Director yang buat ia live."],
  ["You can see the formulas. ACT sets them.", "Anda boleh melihat formula. ACT yang menetapkannya.", "Anda boleh tengok formula. ACT yang set."],
  ["Test data. The amounts are placeholders (minimum wage, no allowances) until ACT sets the real ones. The ACT Director's amounts are saved as chosen; labour law points are flagged here and to the CEO. A formula counts pay; it does not pay anyone.", "Data ujian. Amaun ini hanya sementara (gaji minimum, tiada elaun) sehingga ACT menetapkan amaun sebenar. Amaun yang dipilih oleh Pengarah ACT disimpan seperti dipilih; perkara undang-undang buruh ditandakan di sini dan kepada CEO. Formula mengira gaji; ia tidak membayar sesiapa.", "Data test. Amaun ini sementara (gaji minimum, tiada elaun) sampai ACT set amaun sebenar. Amaun yang ACT Director pilih disimpan macam dipilih; perkara undang-undang buruh di-flag di sini dan kepada CEO. Formula kira gaji; ia tak bayar sesiapa."],
  ["Pay formulas are not switched on in this database yet. Nothing can be saved until the pay formulas module is installed with approval.", "Formula gaji belum dihidupkan dalam pangkalan data ini. Tiada apa boleh disimpan sehingga modul formula gaji dipasang dengan kelulusan.", "Formula gaji belum on dalam database ini. Tak boleh save apa-apa sampai modul formula gaji dipasang dengan approval."],
  ["New guard salary formula", "Formula gaji pengawal baharu", "Formula gaji guard baru"],
  ["New staff overtime formula", "Formula kerja lebih masa staf baharu", "Formula OT staf baru"],
  ["Staff overtime", "Kerja lebih masa staf", "OT staf"],
  ["New driver overtime formula", "Formula kerja lebih masa pemandu baharu", "Formula OT driver baru"],
  ["Changes waiting for the ACT Director", "Perubahan menunggu Pengarah ACT", "Perubahan tunggu ACT Director"],
  ["Where each formula is used", "Di mana setiap formula digunakan", "Di mana setiap formula dipakai"],
  ["Formulas", "Formula", null],
  ["No formula is set yet.", "Belum ada formula ditetapkan.", "Belum ada formula di-set."],
  ["Labour law flags (shown to the CEO)", "Tanda undang-undang buruh (ditunjukkan kepada CEO)", "Flag undang-undang buruh (ditunjuk kepada CEO)"],
  ["Show a worked month", "Tunjuk contoh kiraan sebulan", null],
  ["Hide the worked month", "Sembunyi contoh kiraan", "Hide contoh kiraan"],
  ["Change amounts", "Ubah amaun", "Tukar amaun"],
  ["Decide", "Buat keputusan", "Decide"],
  ["Withdraw", "Tarik balik", "Withdraw"],
  ["Reason for your decision (required)", "Sebab keputusan anda (wajib)", null],
  ["Reason for your decision", "Sebab keputusan anda", null],
  ["Set it live", "Kuatkuasakan", "Set live"],
  ["A full month: every normal working day, no rest days or public holidays worked.", "Sebulan penuh: setiap hari bekerja biasa, tiada kerja pada hari rehat atau cuti umum.", "Sebulan penuh: setiap hari kerja biasa, tiada kerja hari rehat atau cuti umum."],
  ["Example: 20 overtime hours on working days and 2 rest days worked.", "Contoh: 20 jam kerja lebih masa pada hari bekerja dan 2 hari rehat bekerja.", "Contoh: 20 jam OT hari kerja dan 2 hari rehat kerja."],
  ["Rate", "Kadar", "Rate"],
  ["Amount", "Amaun", null],
  ["Gross before EPF, SOCSO, EIS and tax", "Kasar sebelum KWSP, PERKESO, SIP dan cukai", "Gross sebelum EPF, SOCSO, EIS dan cukai"],
  ["Basic pay", "Gaji pokok", "Basic pay"],
  ["Days not worked (unpaid)", "Hari tidak bekerja (tanpa gaji)", "Hari tak kerja (unpaid)"],
  ["Overtime, working days", "Kerja lebih masa, hari bekerja", "OT, hari kerja"],
  ["Rest day worked", "Bekerja pada hari rehat", "Kerja hari rehat"],
  ["Overtime, rest days", "Kerja lebih masa, hari rehat", "OT, hari rehat"],
  ["Public holiday worked", "Bekerja pada cuti umum", "Kerja cuti umum"],
  ["Overtime, public holidays", "Kerja lebih masa, cuti umum", "OT, cuti umum"],
  ["Overtime meal allowance", "Elaun makan kerja lebih masa", "Elaun makan OT"],
  ["Outstation allowance", "Elaun luar kawasan", "Elaun outstation"],
  ["More than 104 overtime hours this month: over the monthly overtime limit.", "Lebih 104 jam kerja lebih masa bulan ini: melebihi had bulanan.", "Lebih 104 jam OT bulan ini: lebih had bulanan."],
  ["Basic pay a month (RM)", "Gaji pokok sebulan (RM)", "Basic pay sebulan (RM)"],
  ["Shift length (hours)", "Tempoh syif (jam)", "Panjang shift (jam)"],
  ["Rest in the shift (hours)", "Rehat dalam syif (jam)", "Rehat dalam shift (jam)"],
  ["Days counted as a full month", "Hari dikira sebulan penuh", null],
  ["Normal hours a day", "Jam biasa sehari", null],
  ["Working days a week", "Hari bekerja seminggu", "Hari kerja seminggu"],
  ["Overtime, working day (x hourly)", "Kerja lebih masa, hari bekerja (x kadar sejam)", "OT, hari kerja (x rate sejam)"],
  ["Overtime, rest day (x hourly)", "Kerja lebih masa, hari rehat (x kadar sejam)", "OT, hari rehat (x rate sejam)"],
  ["Overtime, public holiday (x hourly)", "Kerja lebih masa, cuti umum (x kadar sejam)", "OT, cuti umum (x rate sejam)"],
  ["Rest day worked (extra days’ wages)", "Bekerja hari rehat (tambahan upah sehari)", "Kerja hari rehat (tambahan gaji harian)"],
  ["Public holiday worked (extra days’ wages)", "Bekerja cuti umum (tambahan upah harian)", "Kerja cuti umum (tambahan gaji harian)"],
  ["Overtime meal allowance (RM a day, 0 = none)", "Elaun makan kerja lebih masa (RM sehari, 0 = tiada)", "Elaun makan OT (RM sehari, 0 = tiada)"],
  ["Meal allowance after (overtime hours)", "Elaun makan selepas (jam kerja lebih masa)", "Elaun makan selepas (jam OT)"],
  ["Outstation allowance (RM a night, 0 = none)", "Elaun luar kawasan (RM semalam, 0 = tiada)", "Elaun outstation (RM semalam, 0 = tiada)"],
  ["Starts from (month)", "Mula dari (bulan)", null],
  ["The guard is relieved from the post during the rest (a relief guard covers, or the guard may leave). Untick if the guard stays at the post: the rest is then paid.", "Pengawal dilepaskan dari pos semasa rehat (pengawal ganti mengambil alih, atau pengawal boleh meninggalkan pos). Buang tanda jika pengawal kekal di pos: rehat itu kemudian dibayar.", "Guard dilepaskan dari post semasa rehat (relief guard cover, atau guard boleh keluar). Untick kalau guard kekal di post: rehat itu dibayar."],
  ["Fixed allowances", "Elaun tetap", null],
  ["Allowance name", "Nama elaun", null],
  ["Allowance amount (RM)", "Amaun elaun (RM)", null],
  ["Add allowance", "Tambah elaun", null],
  ["Remove", "Buang", "Remove"],
  ["Reason (kept with the formula)", "Sebab (disimpan bersama formula)", "Sebab (disimpan dengan formula)"],
  ["Why this formula or change", "Kenapa formula atau perubahan ini", null],
  ["Send to the ACT Director", "Hantar kepada Pengarah ACT", "Hantar kepada ACT Director"],
  ["Nothing chosen yet.", "Belum ada pilihan.", null],
  ["Current", "Semasa", "Current"],
  ["Replaced", "Diganti", "Replaced"],
  ["Show earlier choices", "Tunjuk pilihan terdahulu", "Tunjuk pilihan lama"],
  ["Hide earlier choices", "Sembunyi pilihan terdahulu", "Hide pilihan lama"],
  ["Choose the formula for a place", "Pilih formula untuk sesuatu tempat", "Pilih formula untuk satu tempat"],
  ["Kind of pay", "Jenis gaji", null],
  ["Applies to", "Terpakai kepada", "Untuk"],
  ["Place", "Tempat", null],
  ["Formula", "Formula", null],
  ["Pick the formula", "Pilih formula", null],
  ["None: use the wider choice", "Tiada: guna pilihan yang lebih luas", "Tiada: guna pilihan lebih luas"],
  ["Reason (kept with the choice)", "Sebab (disimpan bersama pilihan)", "Sebab (disimpan dengan pilihan)"],
  ["Save the choice", "Simpan pilihan", "Save pilihan"],
  ["Which formula pays here?", "Formula mana yang membayar di sini?", "Formula mana yang bayar di sini?"],
  ["Any company", "Mana-mana syarikat", null],
  ["Any site", "Mana-mana tapak", "Mana-mana site"],
  ["No formula is set for this place and month.", "Tiada formula ditetapkan untuk tempat dan bulan ini.", "Tiada formula di-set untuk tempat dan bulan ini."],
  ["Saved for the ACT Director to decide.", "Disimpan untuk keputusan Pengarah ACT.", "Disimpan untuk ACT Director decide."],
  ["Set. The formula is live from its month.", "Ditetapkan. Formula berkuat kuasa dari bulannya.", "Set. Formula live dari bulannya."],
  // Client CRM (Fauzan, 4 Nov 2026)
  ['From the first lead to the last invoice. Tap a stage to see its clients. Values are a month; unknown is never counted as zero.', 'Dari prospek pertama hingga invois terakhir. Tekan satu peringkat untuk melihat pelanggannya. Nilai adalah sebulan; yang tidak diketahui tidak dikira sebagai sifar.', 'Dari lead pertama hingga invois terakhir. Tekan satu stage untuk tengok client. Nilai sebulan; unknown tidak dikira sebagai kosong.'],
  ['Open the client', 'Buka pelanggan', 'Buka client'],
  ['Estimated', 'Anggaran', null],
  ['Within 90 days of the end', 'Dalam 90 hari sebelum tamat', null],
  ['Worked on the Tenders and quotes page: research, site survey, quotation.', 'Diusahakan di halaman Tender dan sebut harga: semakan, tinjauan tapak, sebut harga.', 'Diusahakan di page Tenders & quotes: research, site survey, quotation.'],
  ['Choose', 'Pilih', null],
  ['No client left in the last 12 months.', 'Tiada pelanggan keluar dalam 12 bulan lepas.', null],
  ['No open client requests or complaints.', 'Tiada permintaan atau aduan pelanggan yang terbuka.', null],
  ['Biggest client\'s share of the company\'s monthly value: over 30% is a concentration risk.', 'Bahagian pelanggan terbesar daripada nilai bulanan syarikat: lebih 30% ialah risiko tumpuan.', null],
  ['Client opened. Onboarding started.', 'Pelanggan dibuka. Perkhidmatan bermula.', 'Client dibuka. Onboarding bermula.'],
  ['Decision saved.', 'Keputusan disimpan.', null],
  ['Offer recorded.', 'Tawaran direkodkan.', 'Offer direkod.'],
  ['Answer recorded.', 'Jawapan direkodkan.', null],
  ['Request logged.', 'Permintaan direkodkan.', 'Request direkod.'],
  ['Request closed.', 'Permintaan ditutup.', 'Request ditutup.'],
  ['Offboarding started.', 'Penamatan perkhidmatan bermula.', 'Offboarding bermula.'],
  ['Added.', 'Ditambah.', null],
  ['Approach again from (optional)', 'Hubungi semula mulai (pilihan)', null],
  ['Needed by (if the client said)', 'Diperlukan sebelum (jika pelanggan beritahu)', 'Diperlukan sebelum (jika client beritahu)'],
  ['Price change %', 'Perubahan harga %', null],
  ['Decision', 'Keputusan', null],
  ['Answer', 'Jawapan', null],
  ['Outcome', 'Keputusan', null],
  ['What they do for us', 'Peranan mereka', null],
  ['Why the client is leaving', 'Sebab pelanggan keluar', 'Sebab client keluar'],
  ['Client board', 'Papan pelanggan', null],
  ['Pipeline', 'Saluran pelanggan', 'Pipeline'],
  ['Renewals', 'Pembaharuan kontrak', 'Renewal'],
  ['Requests and complaints', 'Permintaan dan aduan', null],
  ['Lost clients', 'Pelanggan yang hilang', null],
  ['Group', 'Kumpulan', 'Group'],
  ['Clients', 'Pelanggan', 'Client'],
  ['Needs attention', 'Perlu perhatian', null],
  ['Follow up', 'Perlu susulan', 'Follow up'],
  ['In order', 'Teratur', 'OK'],
  ['Onboarding', 'Mula perkhidmatan', 'Onboarding'],
  ['Offboarding', 'Tamat perkhidmatan', 'Offboarding'],
  ['Active', 'Aktif', null],
  ['Renewal due', 'Perlu diperbaharui', 'Renewal due'],
  ['Leaving', 'Akan keluar', null],
  ['Ended', 'Tamat', null],
  ['Leads being worked', 'Prospek sedang diusahakan', 'Lead sedang diusahakan'],
  ['Quotation with the client', 'Sebut harga di tangan pelanggan', 'Quotation dengan client'],
  ['Won, client not opened yet', 'Menang, pelanggan belum dibuka', 'Menang, client belum dibuka'],
  ['Leads and quotations', 'Prospek dan sebut harga', 'Lead dan quotation'],
  ['Clients needing attention', 'Pelanggan yang perlu perhatian', 'Client yang perlu perhatian'],
  ['Open as client', 'Buka sebagai pelanggan', 'Buka sebagai client'],
  ['Working', 'Sedang diusahakan', null],
  ['With client', 'Di tangan pelanggan', 'Dengan client'],
  ['Nothing here.', 'Tiada apa-apa di sini.', null],
  ['Open requests', 'Permintaan terbuka', null],
  ['Open complaints', 'Aduan terbuka', null],
  ['Overdue', 'Lewat tarikh', 'Overdue'],
  ['Request', 'Permintaan', 'Request'],
  ['Complaint', 'Aduan', null],
  ['Why clients left (last 12 months)', 'Sebab pelanggan keluar (12 bulan lepas)', 'Sebab client keluar (12 bulan lepas)'],
  ['Leaving and ended clients', 'Pelanggan yang akan keluar dan sudah tamat', 'Client yang akan keluar dan sudah tamat'],
  ['Reason not grouped', 'Sebab belum dikumpulkan', null],
  ['By company', 'Mengikut syarikat', null],
  ['Biggest clients', 'Pelanggan terbesar', 'Client terbesar'],
  ['Same client at two or more of our companies', 'Pelanggan sama di dua atau lebih syarikat kita', 'Client sama di dua atau lebih syarikat kita'],
  ['Matched by name. Check they are the same client before acting.', 'Dipadankan melalui nama. Pastikan pelanggan yang sama sebelum bertindak.', null],
  ['None found.', 'Tiada dijumpai.', null],
  ['About the client', 'Tentang pelanggan', 'Tentang client'],
  ['Person in charge', 'Pegawai bertanggungjawab', 'PIC'],
  ['Nobody named yet.', 'Belum dinamakan.', null],
  ['People at the client', 'Orang di pihak pelanggan', 'Contact di pihak client'],
  ['No contact on record.', 'Tiada orang dihubungi direkodkan.', 'Tiada contact direkod.'],
  ['Make main', 'Jadikan utama', null],
  ['No longer there', 'Sudah tiada', null],
  ['Add a person', 'Tambah orang', 'Tambah contact'],
  ['Position', 'Jawatan', null],
  ['Work phone', 'Telefon pejabat', null],
  ['Work email', 'E-mel pejabat', 'Email pejabat'],
  ['Main contact', 'Orang hubungan utama', 'Main contact'],
  ['Work details only. No IC number or home address.', 'Butiran kerja sahaja. Tiada nombor IC atau alamat rumah.', null],
  ['Save person', 'Simpan orang', 'Save contact'],
  ['Cancel', 'Batal', null],
  ['Renewal', 'Pembaharuan kontrak', 'Renewal'],
  ['Decide the renewal', 'Putuskan pembaharuan', 'Decide renewal'],
  ['Change the decision', 'Ubah keputusan', null],
  ['Reason', 'Sebab', null],
  ['Save decision', 'Simpan keputusan', null],
  ['Renewal offer sent to the client', 'Tawaran pembaharuan dihantar kepada pelanggan', 'Offer renewal dihantar kepada client'],
  ['Record offer sent', 'Rekod tawaran dihantar', 'Rekod offer dihantar'],
  ['Client\'s answer', 'Jawapan pelanggan', 'Jawapan client'],
  ['New contract end date', 'Tarikh tamat kontrak baharu', null],
  ['Record answer', 'Rekod jawapan', null],
  ['Client requests', 'Permintaan pelanggan', 'Request client'],
  ['No requests on record.', 'Tiada permintaan direkodkan.', null],
  ['What the client asked for', 'Apa yang pelanggan minta', 'Apa yang client minta'],
  ['Who at the client asked', 'Siapa di pihak pelanggan yang minta', 'Siapa di pihak client yang minta'],
  ['Save request', 'Simpan permintaan', 'Save request'],
  ['Declined', 'Ditolak', null],
  ['What was done', 'Apa yang telah dibuat', null],
  ['Why declined', 'Sebab ditolak', null],
  ['Signed variation reference', 'Rujukan variasi kontrak yang ditandatangani', null],
  ['Client leaving', 'Pelanggan keluar', 'Client keluar'],
  ['Start offboarding', 'Mula tamatkan perkhidmatan', 'Start offboarding'],
  ['What happened', 'Apa yang berlaku', null],
  ['Open client and start onboarding', 'Buka pelanggan dan mula perkhidmatan', 'Buka client dan start onboarding'],
  ['Choose the client\'s sites', 'Pilih lokasi pelanggan', 'Pilih site client'],
  ['Contract end date', 'Tarikh tamat kontrak', null],
  ['Renew on the same price', 'Sambung pada harga sama', null],
  ['Renew at a new price', 'Sambung pada harga baharu', null],
  ['Bid again (client calls a tender)', 'Bida semula (pelanggan buka tender)', 'Bida semula (client buka tender)'],
  ['Let the contract end', 'Biarkan kontrak tamat', null],
  ['Client signed the renewal', 'Pelanggan tandatangan pembaharuan', 'Client sign renewal'],
  ['Client will not renew', 'Pelanggan tidak mahu sambung', 'Client tak mahu sambung'],
  ['Client called a tender', 'Pelanggan buka tender', 'Client buka tender'],
  ['More guards', 'Tambah pengawal', 'Tambah guard'],
  ['Fewer guards', 'Kurang pengawal', 'Kurang guard'],
  ['Temporary post or event', 'Pos sementara atau acara', null],
  ['Change of hours or schedule', 'Tukar waktu atau jadual', null],
  ['Other request', 'Permintaan lain', 'Request lain'],
  ['Decides (signs the contract)', 'Pembuat keputusan (tandatangan kontrak)', null],
  ['On site (day-to-day contact)', 'Di lokasi (hubungan harian)', null],
  ['Finance (invoices and payment)', 'Kewangan (invois dan bayaran)', null],
  ['Procurement or tenders', 'Perolehan atau tender', 'Procurement atau tender'],
  ['Price', 'Harga', null],
  ['Service quality', 'Kualiti perkhidmatan', null],
  ['Lost the tender', 'Kalah tender', null],
  ['Client took security in-house', 'Pelanggan guna pengawal sendiri', 'Client guna guard sendiri'],
  ['Client closed or moved', 'Pelanggan tutup atau berpindah', 'Client tutup atau pindah'],
  ['We chose not to renew', 'Kita pilih tidak sambung', null],
  ['Group leadership only. Each company still runs its own clients.', 'Untuk pimpinan kumpulan sahaja. Setiap syarikat masih menguruskan pelanggan sendiri.', null],
  ['Visits, reports, ratings, complaints and invoices are recorded on the Client board tab.', 'Lawatan, laporan, penilaian, aduan dan invois direkod di tab Papan pelanggan.', null],
  ['Nothing on record yet.', 'Belum ada rekod.', null],
];

const DICT = new Map<string, [string, string]>();
for (const [en, ms, mix] of ROWS) DICT.set(en, [ms, mix === null ? ms : mix === '=' ? en : mix]);

const MONTH_MS: Record<string, string> = { May: 'Mei', Aug: 'Ogo', Oct: 'Okt', Dec: 'Dis', Mar: 'Mac' };
const dates = (s: string) => s.replace(/\b(\d{1,2} )?(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})\b/g, (_m, d, m, y) => `${d ?? ''}${MONTH_MS[m] ?? m} ${y}`);

/**
 * P80 (UI audit): what people read never shows a computer's date or amount. Text that reaches the screen from the
 * records ("due 2026-11-03", "RM2150.00", "statement for 2026-10") is shown as "3 Nov 2026", "RM2,150.00" and
 * "Oct 2026", in every language. Record numbers that hold a date (LM-SASA-2026-11-03, pay-20261106-005) stay as typed:
 * a date joined to letters, slashes or hyphens is part of a number, not a date.
 */
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// No look-behind (older iPhone Safari cannot read it): the character before is captured and put back.
const ISO_DT = /(^|[^\w/.-])(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?(?![\w/-]|\.\d)/g;
const ISO_MONTH = /(^|[^\w/.-])(\d{4})-(0[1-9]|1[0-2])(?![\w/-]|\.\d)/g;
const RM_RAW = /\bRM( ?)(-?)(\d+)(?:\.(\d+))?(?![\d,]|\.\d)/g;
export function tidy(s: string): string {
  if (!/\d/.test(s)) return s;
  let out = s.replace(ISO_DT, (m, pre: string, y: string, mo: string, d: string, hh?: string, mm?: string, zone?: string) => {
    if (zone) {
      // A time with its zone is shown in Malaysia time, like the clock at the top.
      const t = new Date(m.slice(pre.length));
      if (!Number.isNaN(t.getTime())) {
        const my = new Date(t.getTime() + 8 * 3600_000);
        return `${pre}${my.getUTCDate()} ${MONTHS_EN[my.getUTCMonth()]} ${my.getUTCFullYear()}, ${String(my.getUTCHours()).padStart(2, '0')}:${String(my.getUTCMinutes()).padStart(2, '0')}`;
      }
    }
    return `${pre}${Number(d)} ${MONTHS_EN[Number(mo) - 1]} ${y}${hh ? `, ${hh}:${mm}` : ''}`;
  });
  out = out.replace(ISO_MONTH, (_m, pre, y, mo) => `${pre}${MONTHS_EN[Number(mo) - 1]} ${y}`);
  if (out.includes('RM'))
    out = out.replace(RM_RAW, (m, sp, neg, whole: string, frac: string | undefined) => {
      // "RM450" and "RM1,234.50" are already clear; only long whole numbers and odd decimals are rewritten.
      if (frac === undefined && whole.length < 4) return m;
      if (frac !== undefined && frac.length === 2 && whole.length < 4) return m;
      const v = Number(`${whole}.${frac ?? '0'}`);
      return `RM${sp}${neg}${v.toLocaleString('en-MY', { minimumFractionDigits: frac === undefined ? 0 : 2, maximumFractionDigits: frac === undefined ? 0 : 2 })}`;
    });
  return out;
}

/** "1 h 30 min", "45 min", "2 days" in Malay. */
const dur = (s: string, mix: boolean) =>
  s
    .replace(/\b(\d+) days?\b/g, '$1 hari')
    .replace(/\b(\d+) h\b/g, mix ? '$1 jam' : '$1 jam')
    .replace(/\b(\d+) min\b/g, '$1 minit');

type Pat = [RegExp, (m: RegExpMatchArray, mix: boolean) => string];
const who = (s: string, mix: boolean) => (mix ? s : s.replace('IT Manager', 'Pengurus IT').replace('IT Lead', 'Ketua Teknikal IT'));
const PATTERNS: Pat[] = [
  // P80 (UI audit)
  [/^(\d+) given to you$/, (m) => `${m[1]} diberi kepada anda`],
  [/^Sent back to (.+)$/, (m) => `Dipulangkan kepada ${m[1]}`],
  [/^(\d+) to fill$/, (m) => `${m[1]} untuk diisi`],
  [/^The PDF is over (\d+) KB\. Scan it smaller\.$/, (m, x) => (x ? `PDF melebihi ${m[1]} KB. Scan dengan saiz lebih kecil.` : `PDF melebihi ${m[1]} KB. Imbas dengan saiz lebih kecil.`)],
  [/^Not allowed: \S+ for company (.+)\. Ask the company or check your authority grant\.$/, (m, x) => `${x ? 'Tak dibenarkan' : 'Tidak dibenarkan'} ${tr(m[1], x ? 'mix' : 'ms')}.`],
  [/^(\d{6}) is listed twice\.$/, (m) => `${m[1]} disenarai dua kali.`],
  [/^(.+): a MOF code has 6 digits\.$/, (m) => `${m[1]}: kod MOF ada 6 digit.`],
  [/^(\S+) is closed\.$/, (m) => `${m[1]} sudah ditutup.`],
  [/^(\S+) is not waiting for a (technical )?check\.$/, (m, x) => `${m[1]} tidak menunggu ${m[2] ? (x ? 'technical check' : 'semakan teknikal') : x ? 'check' : 'semakan'}.`],
  [/^(\S+) is already decided\.$/, (m, x) => `${m[1]} ${x ? 'dah decide' : 'sudah diputuskan'}.`],
  [/^(\S+) is still with Procurement; tag the items once the storekeeper has received them\.$/, (m, x) => (x ? `${m[1]} masih di Procurement; tag item selepas storekeeper terima.` : `${m[1]} masih di Perolehan; tag barang selepas penjaga stor menerimanya.`)],
  [/^(\d+) quotes from different suppliers are needed; (\d+) more\.$/, (m, x) => (x ? `Perlu ${m[1]} quotation dari supplier berbeza; ${m[2]} lagi.` : `Perlu ${m[1]} sebut harga daripada pembekal berbeza; ${m[2]} lagi.`)],
  [/^(.+) already quoted; three different suppliers are needed\.$/, (m, x) => (x ? `${m[1]} dah beri quotation; perlu tiga supplier berbeza.` : `${m[1]} sudah memberi sebut harga; perlu tiga pembekal berbeza.`)],
  [/^(.+): already done\.$/, (m, x) => `${tr(m[1], x ? 'mix' : 'ms')}: ${x ? 'dah done' : 'sudah selesai'}.`],
  [/^(.+): first finish "(.+)"\.$/, (m, x) => `${tr(m[1], x ? 'mix' : 'ms')}: ${x ? 'siapkan dulu' : 'selesaikan dahulu'} "${tr(m[2], x ? 'mix' : 'ms')}".`],
  [/^(.+): this step is for the (IT Manager|IT Lead|IT tender executive|COO or the CEO)\.$/, (m, x) =>
    `${tr(m[1], x ? 'mix' : 'ms')}: ${x ? 'step ni untuk' : 'langkah ini untuk'} ${x ? m[2].replace('COO or the CEO', 'COO atau CEO') : ({ 'IT Manager': 'Pengurus IT', 'IT Lead': 'Ketua Teknikal IT', 'IT tender executive': 'eksekutif tender IT', 'COO or the CEO': 'COO atau CEO' } as Record<string, string>)[m[2]]}.`],
  [/^Not ready to hand over: (.+)\.$/, (m, x) => `${x ? 'Belum ready untuk handover' : 'Belum sedia untuk diserahkan'}: ${m[1]}.`],
  [/^Only (.+) (starts|submits) this job\.$/, (m, x) => `Hanya ${m[1]} ${m[2] === 'starts' ? (x ? 'boleh start' : 'boleh memulakan') : x ? 'boleh submit' : 'boleh menghantar'} ${x ? 'job ni' : 'tugasan ini'}.`],
  [/^Only the (COO|CEO) decides this step\.$/, (m, x) => `Hanya ${m[1]} ${x ? 'decide step ni' : 'memutuskan langkah ini'}.`],
  [/^The chosen quote is more than (\d+)% above the online price: say why\.$/, (m, x) => (x ? `Quotation yang dipilih lebih ${m[1]}% dari harga online: nyatakan sebab.` : `Sebut harga yang dipilih melebihi ${m[1]}% daripada harga dalam talian: nyatakan sebabnya.`)],
  [/^This company does not hold code (.+)\.$/, (m) => `Syarikat ini tiada kod ${m[1]}.`],
  [/^This is with (.+); they or the IT Lead resolve it\.$/, (m, x) => (x ? `Ni pada ${m[1]}; dia atau IT Lead yang resolve.` : `Ini pada ${m[1]}; mereka atau Ketua Teknikal IT yang menyelesaikannya.`)],
  [/^This is with (.+)\.$/, (m) => `Ini pada ${m[1]}.`],
  [/^(\S+) for (.+) is already with the CEO\.$/, (m, x) => `${m[1]} untuk ${m[2]} ${x ? 'dah ada pada CEO' : 'sudah berada pada CEO'}.`],
  [/^(.+) already has (\S+) access\.$/, (m) => `${m[1]} sudah ada akses ${m[2]}.`],
  [/^(.+) has no access to remove\.$/, (m) => `${m[1]} tiada akses untuk dibuang.`],
  [/^Time limits: P1 (\d+) hours, P2 (\d+) hours, P3 (\d+) hours\.$/, (m, x) => `Had masa: P1 ${m[1]} jam, P2 ${m[2]} jam, P3 ${m[3]} jam.`],
  [/^The (COO|CEO) decided in Teams Approvals\? Record it here with the approval title and a screenshot\.$/, (m, x) =>
    x ? `${m[1]} dah decide dalam Teams Approvals? Rekod di sini dengan tajuk approval dan screenshot.` : `${m[1]} telah membuat keputusan dalam Teams Approvals? Rekodkan di sini dengan tajuk kelulusan dan tangkapan skrin.`],
  [/^Owner (.+?) · master sign-in kept: (.+?) · two-step sign-in (on|OFF|unknown)( · .+)?$/, (m, x) =>
    `${x ? 'Owner' : 'Pemilik'} ${m[1]} · ${x ? 'master sign in disimpan di' : 'log masuk utama disimpan di'}: ${m[2]} · ${x ? '2-step sign in' : 'log masuk dua langkah'} ${({ on: x ? 'ON' : 'HIDUP', OFF: x ? 'OFF' : 'MATI', unknown: x ? 'belum check' : 'belum disemak' } as Record<string, string>)[m[3]]}${m[4] ? ` · ${tr(m[4].slice(3), x ? 'mix' : 'ms')}` : ''}`],
  [/^Proof( \(required\))?: (.+)$/, (m, x) => `${x ? 'Proof' : 'Bukti'}${m[1] ? (x ? ' (wajib)' : ' (wajib)') : ''}: ${tr(m[2], x ? 'mix' : 'ms')}`],
  [/^(\d+) shown$/, (m) => `${m[1]} dipaparkan`],
  [/^and (\d+) more$/, (m) => `dan ${m[1]} lagi`],
  [/^Showing (\d+) of (\d+)\. (.+)$/, (m, x) => `${x ? 'Papar' : 'Memaparkan'} ${m[1]} daripada ${m[2]}. ${tr(m[3], x ? 'mix' : 'ms')}`],
  [/^Every job has one named person and a due date\. It is finished only when it is submitted with proof and accepted by the IT Manager; a technical job is checked by the IT Lead first\. Nobody accepts their own work\. A job (\d+) days late goes to the COO, and (\d+) days late to the CEO\.$/, (m, x) =>
    x
      ? `Setiap job ada satu PIC dan due date. Ia hanya selesai bila di-submit dengan proof dan di-accept oleh IT Manager; job teknikal di-check oleh IT Lead dulu. Tiada siapa boleh accept kerja sendiri. Job lewat ${m[1]} hari naik ke COO, dan lewat ${m[2]} hari ke CEO.`
      : `Setiap tugasan ada seorang penanggungjawab dan tarikh akhir. Ia hanya selesai apabila dihantar dengan bukti dan diterima oleh Pengurus IT; tugasan teknikal disemak oleh Ketua Teknikal IT dahulu. Tiada sesiapa boleh menerima kerja sendiri. Tugasan lewat ${m[1]} hari dibawa kepada COO, dan lewat ${m[2]} hari kepada CEO.`],
  [/^The CEO is the owner and master administrator of every system, domain and account\. IT staff only operate them with the access the CEO gives\. Passwords are never kept here; only where the CEO’s master sign-in and recovery codes are kept\. The CEO confirms each list every (\d+) days\.$/, (m, x) =>
    x
      ? `CEO ialah owner dan master admin setiap sistem, domain dan akaun. Staf IT hanya operate dengan akses yang CEO beri. Password tidak disimpan di sini; hanya lokasi master sign-in dan recovery code CEO. CEO confirm setiap list setiap ${m[1]} hari.`
      : `CEO ialah pemilik dan pentadbir utama setiap sistem, domain dan akaun. Staf IT hanya mengendalikannya dengan akses yang diberi oleh CEO. Kata laluan tidak disimpan di sini; hanya lokasi log masuk utama dan kod pemulihan CEO. CEO mengesahkan setiap senarai setiap ${m[1]} hari.`],
  // The data label is its own piece now (task T1), so this sentence is matched on its own.
  [/^Pilot: only IT, the COO, the CEO, the ACT head, the HR administrator and the Finance Director sign in\. Others reach IT on Teams, email or phone and IT logs it for them; approvals given in Teams Approvals are recorded here with a screenshot \((.+)\)\.$/, (m, x) =>
    x
      ? `Pilot: hanya IT, COO, CEO, ACT head, HR admin dan Finance Director yang sign in. Staf lain hubungi IT melalui Teams, email atau phone dan IT log bagi pihak mereka; approval dalam Teams Approvals direkod di sini dengan screenshot (${m[1]}).`
      : `Projek rintis: hanya IT, COO, CEO, Ketua ACT, Pentadbir HR dan Pengarah Kewangan yang log masuk. Staf lain menghubungi IT melalui Teams, e-mel atau telefon dan IT merekodkannya bagi pihak mereka; kelulusan dalam Teams Approvals direkod di sini bersama tangkapan skrin (${m[1]}).`],
  [/^Domains, websites, quarterly content reviews, monthly checks and issues for every company in the group\. (\S+) runs (.+) to (.+)\.$/, (m, x) =>
    x
      ? `Domain, website, review kandungan suku tahun, check bulanan dan isu untuk setiap syarikat dalam group. ${m[1]} dari ${dates(m[2])} hingga ${dates(m[3])}.`
      : `Domain, laman web, semakan kandungan suku tahun, semakan bulanan dan isu bagi setiap syarikat dalam kumpulan. ${m[1]} dari ${dates(m[2])} hingga ${dates(m[3])}.`],
  [/^ \(logged by IT, via (email|in person|phone|teams)\)$/, (m, x) => ` (direkod oleh IT, melalui ${({ email: x ? 'email' : 'e-mel', 'in person': 'bersemuka', phone: x ? 'phone' : 'telefon', teams: 'Teams' } as Record<string, string>)[m[1]]})`],
  [/^(.+): expires in (\d+) days?(, renewal not confirmed)?$/, (m, x) => `${m[1]}: tamat dalam ${m[2]} hari${m[3] ? (x ? ', renewal belum confirm' : ', pembaharuan belum disahkan') : ''}`],
  [/^(.+): expired (\d+) days? ago(, renewal not confirmed)?$/, (m, x) => `${m[1]}: tamat ${m[2]} hari lalu${m[3] ? (x ? ', renewal belum confirm' : ', pembaharuan belum disahkan') : ''}`],
  [/^expires in (\d+) days \((.+)\)$/, (m) => `tamat dalam ${m[1]} hari (${dates(m[2])})`],
  [/^expired (\d+) days ago$/, (m) => `tamat ${m[1]} hari lalu`],
  [/^(\d+) days?$/, (m) => `${m[1]} hari`],
  [/^(\d+ h )?\d+ min$/, (m, x) => dur(m[0], x)],
  [/^(\d+) offline or critical$/, (m, x) => `${m[1]} ${x ? 'offline atau critical' : 'luar talian atau kritikal'}`],
  [/^(\d+) steps? took longer than their minutes: (.+)$/, (m, x) => `${m[1]} ${x ? 'step' : 'langkah'} melebihi minit sasaran: ${m[2].split(', ').map((p) => tr(p, x ? 'mix' : 'ms')).join(', ')}`],
  [/^(\d+) in progress · (\d+) overdue$/, (m, x) => `${m[1]} ${x ? 'in progress' : 'sedang berjalan'} · ${m[2]} ${x ? 'overdue' : 'lewat'}`],
  [/^(\d+) live websites? missing an owner or backup$/, (m, x) => (x ? `${m[1]} website live tiada owner atau backup` : `${m[1]} laman web aktif tanpa pemilik atau pengganti`)],
  [/^(\d{4}-Q\d) reviews done$/, (m, x) => (x ? `Review ${m[1]} selesai` : `Semakan ${m[1]} selesai`)],
  [/^Open (\d{4}-Q\d) reviews$/, (m, x) => (x ? `Buka review ${m[1]}` : `Buka semakan ${m[1]}`)],
  [/^Open (\d{4}-\d\d|[A-Z][a-z]{2} \d{4}) monthly checks$/, (m, x) => (x ? `Buka check bulanan ${dates(m[1])}` : `Buka semakan bulanan ${dates(m[1])}`)],
  [/^(\d+) companies$/, (m) => `${m[1]} syarikat`],
  [/^(\d+) companies in the company list$/, (m) => `${m[1]} syarikat dalam senarai syarikat`],
  [/^(\d+) monthly checks? overdue across the team$/, (m, x) => (x ? `${m[1]} check bulanan overdue dalam team` : `${m[1]} semakan bulanan lewat dalam pasukan`)],
  [/^within 30 days · (\d+) within 60 · (\d+) expired$/, (m, x) => `dalam 30 hari · ${m[1]} dalam 60 · ${m[2]} ${x ? 'expired' : 'tamat'}`],
  [/^Monthly check (\d{4}-\d\d|[A-Z][a-z]{2} \d{4}): (.+) \(overdue\)$/, (m, x) => (x ? `Check bulanan ${dates(m[1])}: ${m[2]} (overdue)` : `Semakan bulanan ${dates(m[1])}: ${m[2]} (lewat)`)],
  [/^(.+): (Waiting for the company|Business owner to verify|Waiting for approval|IT testing|Waiting to be published) \((\d{4}-Q\d)\)(, overdue)?$/, (m, x) => `${m[1]}: ${tr(m[2], x ? 'mix' : 'ms')} (${m[3]})${m[4] ? (x ? ', overdue' : ', lewat') : ''}`],
  [/^(.+): company has not answered the (\d{4}-Q\d) review$/, (m, x) => (x ? `${m[1]}: syarikat belum jawab review ${m[2]}` : `${m[1]}: syarikat belum menjawab semakan ${m[2]}`)],
  [/^Answer recorded by IT for (.+?): (Teams chat|Phone call|Email reply|.+?), recorded by (.+)\. Sample-check with the person\.$/, (m, x) =>
    x ? `Jawapan direkod oleh IT untuk ${m[1]}: ${tr(m[2], 'mix')}, direkod oleh ${m[3]}. Buat sample check dengan orang tu.` : `Jawapan direkod oleh IT bagi ${m[1]}: ${tr(m[2], 'ms')}, direkod oleh ${m[3]}. Semak secara rawak dengan orang tersebut.`],
  [/^(.+)'s approval recorded from Teams \((.+)\) by (.+)\. Check the screenshot\.$/, (m, x) =>
    x ? `Approval ${m[1]} direkod dari Teams (${m[2]}) oleh ${m[3]}. Check screenshot.` : `Kelulusan ${m[1]} direkod dari Teams (${m[2]}) oleh ${m[3]}. Semak tangkapan skrin.`],
  [/^Fewer items tagged \((\d+)\) than ordered$/, (m, x) => (x ? `Item yang di-tag (${m[1]}) kurang daripada yang dipesan` : `Barang yang ditag (${m[1]}) kurang daripada pesanan`)],
  [/^no IT code \((.+)\)$/, (m, x) => `tiada kod IT (${m[1]})`],
  [/^Showing (\d+) of (\d+)\. Search or filter to narrow\.$/, (m, x) => (x ? `Papar ${m[1]} daripada ${m[2]}. Search atau filter untuk kecilkan list.` : `Memaparkan ${m[1]} daripada ${m[2]}. Cari atau tapis untuk kecilkan senarai.`)],
  [/^· (\d+) in repair$/, (m, x) => `· ${m[1]} ${x ? 'dalam repair' : 'dalam pembaikan'}`],
  [/^· (\d+) tagged$/, (m, x) => `· ${m[1]} ${x ? 'di-tag' : 'ditag'}`],
  [/^(\d+) in use$/, (m, x) => `${m[1]} ${x ? 'in use' : 'sedang digunakan'}`],
  [/^(.+) · (joins|leaves) (.+)$/, (m, x) => `${m[1]} · ${m[2] === 'joins' ? (x ? 'join' : 'masuk kerja') : x ? 'keluar' : 'berhenti'} ${dates(m[3])}`],
  [/^(\d+) days? late · (IT Manager|COO|CEO) sees it$/, (m, x) => `Lewat ${m[1]} hari · ${who(m[2], x)} ${x ? 'nampak' : 'dapat melihatnya'}`],
  [/^(\d+) days late, now with the (COO|CEO)$/, (m) => `Lewat ${m[1]} hari, kini pada ${m[2]}`],
  [/^Late (.+)$/, (m, x) => `Lewat ${dur(m[1], x)}`],
  [/^(\d+) late$/, (m) => `${m[1]} lewat`],
  [/^(\d+) to do$/, (m, x) => `${m[1]} ${x ? 'to do' : 'belum dibuat'}`],
  [/^(\d+) over time$/, (m, x) => `${m[1]} ${x ? 'lebih masa' : 'melebihi masa'}`],
  [/^(\d+) broken$/, (m, x) => `${m[1]} ${x ? 'dilanggar' : 'dilanggar'}`],
  [/^(\d+) items?$/, (m, x) => `${m[1]} ${x ? 'item' : 'barang'}`],
  [/^due (.+)$/, (m, x) => `${x ? 'due' : 'tarikh akhir'} ${dates(m[1])}`],
  [/^running, due (.+)$/, (m, x) => `${x ? 'running, due' : 'sedang berjalan, tarikh akhir'} ${dates(m[1])}`],
  [/^done (.+) by (.+) in (.+)$/, (m, x) => `${x ? 'done' : 'selesai'} ${dates(m[1])} oleh ${m[2]} dalam ${dur(m[3], x)}`],
  [/^target (.+)$/, (m, x) => `${x ? 'target' : 'sasaran'} ${dur(m[1], x)}`],
  [/^took (.+)$/, (m) => `ambil masa ${dur(m[1], false)}`],
  [/^Target (.+) of work from found to submitted$/, (m, x) => `${x ? 'Target' : 'Sasaran'} ${dur(m[1], x)} kerja dari ditemui hingga dihantar`],
  [/^now: (.+)$/, (m, x) => `kini: ${m[1].split('; ').map((p) => tr(p, x ? 'mix' : 'ms')).join('; ')}`],
  [/^closes (.+)$/, (m) => `tutup ${dates(m[1])}`],
  [/^(Open tender|Quotation)$/, (m, x) => (m[1] === 'Quotation' ? (x ? 'Quotation' : 'Sebut harga') : x ? 'Open tender' : 'Tender terbuka')],
  [/^in the name of (.+)$/, (m) => `atas nama ${m[1]}`],
  [/^codes (.+)$/, (m) => `kod ${m[1]}`],
  [/^MOF to (.+)$/, (m) => `MOF sah hingga ${dates(m[1])}`],
  [/^MOF ended (.+)$/, (m) => `MOF tamat ${dates(m[1])}`],
  [/^Reviewed (.+)$/, (m, x) => `${x ? 'Review' : 'Disemak'} ${dates(m[1])}`],
  [/^asked (.+)$/, (m, x) => `${x ? 'diminta' : 'diminta'} ${dates(m[1])}`],
  [/^received (.+)$/, (m) => `diterima ${dates(m[1])}`],
  [/^(\d+) of (\d+) companies checked\.$/, (m, x) => `${m[1]} daripada ${m[2]} syarikat ${x ? 'dah di-check' : 'telah disemak'}.`],
  [/^Sent back (\d+) times?$/, (m, x) => `${x ? 'Send back' : 'Dipulangkan'} ${m[1]} kali`],
  [/^Reopened (\d+) times?: the person said it was not fixed$/, (m, x) => `${x ? 'Reopen' : 'Dibuka semula'} ${m[1]} kali: peminta kata belum ${x ? 'settle' : 'baik'}`],
  [/^reopened (\d+)×$/, (m, x) => `${x ? 'reopen' : 'dibuka semula'} ${m[1]}×`],
  [/^sent back (\d+)×$/, (m, x) => `${x ? 'send back' : 'dipulangkan'} ${m[1]}×`],
  [/^Finished after the due date (.+)$/, (m, x) => `Siap selepas ${x ? 'due date' : 'tarikh akhir'} ${m[1]}`],
  [/^(\d+) waiting for a check$/, (m, x) => `${m[1]} menunggu ${x ? 'check' : 'semakan'}`],
  [/^(\d+) open · (\d+) to check$/, (m, x) => `${m[1]} ${x ? 'open' : 'terbuka'} · ${m[2]} untuk ${x ? 'check' : 'disemak'}`],
  [/^(\d+) gone to the COO or CEO$/, (m, x) => `${m[1]} ${x ? 'dah naik' : 'telah dibawa'} ke COO atau CEO`],
  [/^(\d+) not given to anyone$/, (m, x) => `${m[1]} ${x ? 'belum ada PIC' : 'belum diberi kepada sesiapa'}`],
  [/^(\d+) past the time limit$/, (m) => `${m[1]} melebihi had masa`],
  [/^(\d+) systems due for review$/, (m, x) => `${m[1]} sistem perlu ${x ? 'review' : 'disemak'}`],
  [/^(\d+) in repair · (\d+) service due$/, (m, x) => `${m[1]} ${x ? 'dalam repair' : 'dalam pembaikan'} · ${m[2]} perlu servis`],
  [/^(\d+) to fill · (\d+) days$/, (m) => `${m[1]} untuk diisi · ${m[2]} hari`],
  [/^Exceptions to check \((\d+)\)$/, (m, x) => `${x ? 'Exception untuk check' : 'Pengecualian untuk disemak'} (${m[1]})`],
  [/^Quotes \((\d+) of (\d+)\) and online price \((\d+) of (\d+)\)$/, (m, x) => `${x ? 'Quotation' : 'Sebut harga'} (${m[1]} daripada ${m[2]}) dan harga ${x ? 'online' : 'dalam talian'} (${m[3]} daripada ${m[4]})`],
  [/^Add (quote|online price)$/, (m, x) => (m[1] === 'quote' ? (x ? 'Tambah quotation' : 'Tambah sebut harga') : x ? 'Tambah harga online' : 'Tambah harga dalam talian')],
  [/^Open (.+\.(png|pdf|jpe?g))$/i, (m) => `Buka ${m[1]}`],
  [/^With (.+)$/, (m, x) => `Ada pada ${tr(m[1], x ? 'mix' : 'ms')}`],
];

/** One piece of screen text in the chosen language; text not in the table is returned as it is. */
export function tr(text: string, lang: Lang, raw = false): string {
  if (!text) return text;
  if (!raw) text = tidy(text);
  if (lang === 'en') return text;
  const lead = text.match(/^\s*/)![0];
  const trail = text.match(/\s*$/)![0];
  const core = text.trim();
  if (!core) return text;
  const out = trCore(core, lang);
  return out === core ? text : lead + out + trail;
}

function trCore(core: string, lang: Exclude<Lang, 'en'>): string {
  const hit = DICT.get(core);
  if (hit) return lang === 'ms' ? hit[0] : hit[1];
  // P80: a whole-line pattern first ("5 to fill · 18 days"), then the pieces of a line joined by middle dots.
  for (const [re, fn] of PATTERNS) {
    const m = core.match(re);
    if (m) return fn(m, lang === 'mix');
  }
  // A leading or trailing middle dot joins pieces on one line: translate the piece.
  if (core.startsWith('· ')) return `· ${trCore(core.slice(2), lang)}`;
  if (core.includes(' · ')) {
    const parts = core.split(' · ');
    const done = parts.map((p) => trCore(p, lang));
    if (done.some((d, i) => d !== parts[i])) return done.join(' · ');
  }
  // Several sentences side by side (a fixed sentence with a count after it): translate each one.
  // No look-behind in the pattern: older iPhone Safari (before 16.4) cannot read it.
  const sentences = core.replace(/([.?!]) (?=[A-Z0-9])/g, '$1\n').split('\n');
  if (sentences.length > 1) {
    // A known paragraph with a sentence added after it: the longest known start, then the rest.
    for (let k = sentences.length - 1; k >= 1; k--) {
      const head = sentences.slice(0, k).join(' ');
      if (!DICT.has(head)) continue;
      return `${trCore(head, lang)} ${trCore(sentences.slice(k).join(' '), lang)}`;
    }
    const done = sentences.map((p) => trCore(p, lang));
    if (done.some((d, i) => d !== sentences[i])) return done.join(' ');
  }
  // "Label: value" where the label is known.
  const lv = core.match(/^([A-Z][A-Za-z -]{1,40}): (.+)$/);
  if (lv && DICT.has(lv[1])) {
    const h = DICT.get(lv[1])!;
    return `${lang === 'ms' ? h[0] : h[1]}: ${trCore(lv[2], lang)}`;
  }
  // Pieces ending in ':' or '?' (labels).
  const tail = core.match(/^(.*?)([:?.])$/);
  if (tail) {
    const h = DICT.get(tail[1]);
    if (h) return (lang === 'ms' ? h[0] : h[1]) + tail[2];
  }
  return dates(core);
}

const ATTRS = ['placeholder', 'aria-label', 'title'] as const;
const original = new WeakMap<Node, string>();
const shown = new WeakMap<Node, string>();
const originalAttr = new WeakMap<Element, Record<string, string>>();
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE', 'PRE']);

/** The English last written into a text node, by React or a person; what is shown now is our translation of it. */
function originalOf(n: Text): string {
  const cur = n.nodeValue ?? '';
  if (shown.get(n) !== cur) original.set(n, cur);
  return original.get(n) ?? cur;
}

/**
 * React writes `Quotes ({a} of {b})` as several text nodes side by side. When an element holds only text, translate the
 * joined sentence, put it in the first node and empty the rest; React keeps updating its own nodes, and we redo it.
 */
function doJoined(p: Element, lang: Lang): boolean {
  const kids = p.childNodes;
  if (kids.length < 2) return false;
  for (let i = 0; i < kids.length; i++) if (kids[i].nodeType !== Node.TEXT_NODE) return false;
  const nodes = Array.from(kids) as Text[];
  const en = nodes.map(originalOf);
  const joined = en.join('');
  const out = tr(joined, lang);
  // Not known as a sentence: each piece may still be known on its own.
  const whole = out !== joined;
  nodes.forEach((n, i) => {
    const v = whole ? (i === 0 ? out : '') : tr(en[i], lang);
    shown.set(n, v);
    if (n.nodeValue !== v) n.nodeValue = v;
  });
  return true;
}

function doText(n: Text, lang: Lang) {
  const p = n.parentElement;
  if (!p || SKIP.has(p.tagName) || p.closest('[data-no-translate]')) return;
  if (doJoined(p, lang)) return;
  const cur = n.nodeValue ?? '';
  // React (or a person) wrote new English since we last translated: that is the new original.
  if (shown.get(n) !== cur) original.set(n, cur);
  const en = original.get(n) ?? cur;
  const out = tr(en, lang);
  shown.set(n, out);
  if (out !== cur) n.nodeValue = out;
}

function doAttrs(e: Element, lang: Lang) {
  if (e.closest('[data-no-translate]')) return;
  let rec = originalAttr.get(e);
  for (const a of ATTRS) {
    const v = e.getAttribute(a);
    if (v == null) continue;
    if (!rec) originalAttr.set(e, (rec = {}));
    const prevOut = rec[`${a}:out`];
    if (prevOut !== v) rec[a] = v;
    // A placeholder shows the format to type (2026-11-06): it is never rewritten.
    const out = tr(rec[a], lang, a === 'placeholder');
    rec[`${a}:out`] = out;
    if (out !== v) e.setAttribute(a, out);
  }
}

function walk(root: Node, lang: Lang) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text, lang);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (SKIP.has(el.tagName)) return;
  doAttrs(el, lang);
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = w.nextNode())) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text, lang);
    else doAttrs(n as Element, lang);
  }
}

/** Keep the page in the chosen language as React updates it. Returns a stop function. */
export function startTranslator(root: HTMLElement, lang: Lang): () => void {
  document.documentElement.lang = lang === 'en' ? 'en' : 'ms';
  walk(root, lang);
  let busy = false;
  const obs = new MutationObserver((list) => {
    if (busy) return;
    busy = true;
    try {
      for (const m of list) {
        if (m.type === 'characterData') doText(m.target as Text, lang);
        else if (m.type === 'attributes') doAttrs(m.target as Element, lang);
        else m.addedNodes.forEach((n) => walk(n, lang));
      }
    } finally {
      obs.takeRecords();
      busy = false;
    }
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
  return () => obs.disconnect();
}

/** Server messages (errors) shown in the chosen language when the table knows them. */
export function trMessage(msg: string, lang: Lang): string {
  return tr(msg, lang);
}
export const MESSAGES_KNOWN = (m: string) => DICT.has(m);

/**
 * Special Ops and Asset Management guide cards (Arisha main review, 2 Nov 2026, section A), in the shared guide-card shape
 * of PR #56 (packages/core/src/guide-cards.ts, GuideCardSpec at 4989972). This branch does not carry PR #56 yet, so the
 * shape is mirrored here structurally; when the two are combined, call registerGuideCards(SPECIAL_OPS_GUIDE_CARDS) from
 * guide-cards and delete the mirrored types below. Arisha then reads them through GET /api/org/guide.
 *
 * Rules kept: Bahasa Melayu first with English; `allowed` calls the same permission rule the server uses for the action;
 * "entered once" filled in; who to ask is a hand-over desk ('asset') or, with no Arms Control desk in the hand-over map,
 * null with the record's keepers named, never a person; anything not built or not walked through is in `notVerified`.
 * Each card names the service method it was checked against. Read-only help: a card never saves, approves or sends.
 */
import { assetRole, canRunCms } from './access';
import type { User } from './types';

interface GuideText {
  bm: string;
  en: string;
}
const t = (bm: string, en: string): GuideText => ({ bm, en });

/** Mirrors GuideCardSpec (PR #56). `askDesk` is an OrgDesk there; only 'asset' or null is used here. */
export interface SpecialOpsGuideCard {
  id: string;
  status: 'ready' | 'partial' | 'not_built';
  dept: string;
  title: GuideText;
  purpose: GuideText;
  who: GuideText;
  screen: { view: string | null; name: string; action: GuideText };
  allowed: (user: User) => boolean;
  fields: { key: string; label: string; required: boolean; format: GuideText; example: string }[];
  sources: { what: GuideText; askDesk: 'asset' | null; askName?: string }[];
  enteredOnce: GuideText;
  actions: string[];
  steps: { save: GuideText; review: GuideText; returned: GuideText; done: GuideText; recover: GuideText };
  notVerified: GuideText[];
  /** The service method(s) the card was checked against (extra to the shared shape; dropped by registerGuideCards' view). */
  checkedAgainst: string;
}

/**
 * The server's own rules, read from the methods named on each card. Company-level arms rights also depend on the
 * person's grant for that company; the server checks that on every action, so a card can only ever be broader.
 */
const ALLOWED = {
  // raiseArmsRequest -> armsHandler: arms.handle in the company (company manager, director) or Arms Control.
  armsRaise: (u: User) => !u.integration && (u.role === 'company_manager' || u.role === 'director' || canRunCms(u)),
  // armsRequestStep pass/return: canRunCms.
  armsControl: (u: User) => !u.integration && canRunCms(u),
  // armsRequestStep authorise/refuse, planArmedJob, updateArmedJob: company manager or director with arms.handle.
  companyAuthority: (u: User) => !u.integration && (u.role === 'company_manager' || u.role === 'director'),
  // amRecordPayment, amFollowUp, amWhatsAppConsent, amBuyRequest, amBuyReceived, amBuyReprice: assetRole 'team'.
  assetTeam: (u: User) => !u.integration && assetRole(u) === 'team',
  // amBuyDecide: Finance Director (up to the limit), COO or CEO.
  purchaseDecider: (u: User) => !u.integration && ((u.role === 'pwvsb_officer' && u.leadership === 'finance_director') || u.opsTier === 'coo' || u.opsTier === 'ceo'),
};

export const SPECIAL_OPS_GUIDE_CARDS: SpecialOpsGuideCard[] = [
  {
    id: "specialops.arms-request-raise",
    status: 'ready',
    dept: "Arms Control (Special Ops)",
    title: t("Buat permohonan senjata", "Raise an arms request"),
    purpose: t("Memohon untuk membeli peluru atau senjata, menservis, melupuskan, atau melaporkan kehilangan senjata syarikat anda.", "Ask to buy ammunition or firearms, service, dispose of, or report the loss of your company's firearms."),
    who: t("Syarikat berlesen (pengurus syarikat) atau Kawalan Senjata.", "The licensed company (company manager) or Arms Control."),
    screen: { view: "arms", name: "Arms control", action: t("Kawalan senjata → syarikat anda → Permohonan senjata → New arms request", "Arms control → your company → Arms requests → New arms request") },
    allowed: ALLOWED.armsRaise,
    fields: [
      { key: "what_it_is_for", label: "What it is for", required: true, format: t("Buy, Service, Dispose, Loss report", "Buy, Service, Dispose, Loss report"), example: "" },
      { key: "short_title", label: "Short title", required: true, format: t("Sekurang-kurangnya 4 aksara, cth. \"Buy 400 cartridges for range practice\"", "at least 4 characters, e.g. \"Buy 400 cartridges for range practice\""), example: "Buy 400 cartridges for range practice" },
      { key: "why_and_what_papers_you_have", label: "Why, and what papers you have", required: true, format: t("Ayat pendek, cth. \"Range practice; quotation QT-TEST-01 on file\"", "short sentence, e.g. \"Range practice; quotation QT-TEST-01 on file\""), example: "Range practice; quotation QT-TEST-01 on file" },
      { key: "quantity", label: "Quantity (buy only)", required: true, format: t("Nombor bulat, cth. 400", "whole number, e.g. 400"), example: "400" },
      { key: "calibre_or_model", label: "Calibre or model (buy only)", required: false, format: t("e.g. 12 gauge", "e.g. 12 gauge"), example: "12 gauge" },
      { key: "estimated_cost_rm", label: "Estimated cost RM (buy only)", required: false, format: t("e.g. 1200", "e.g. 1200"), example: "1200" },
      { key: "firearms", label: "Firearms (service, dispose, loss)", required: true, format: t("Tandakan dari senarai daftar syarikat", "tick from the company register"), example: "" },
    ],
    sources: [{ what: t("Sebut harga pembekal, laporan juruservis atau laporan kehilangan disimpan dalam fail syarikat. Jika tiada, tanya Jabatan Kawalan Senjata (Arms Control).", "The supplier's quotation, the armourer's report or the loss report is kept on the company file. If it is missing, ask the Arms Control Department."), askDesk: null, askName: 'Arms Control Department (the request’s reviewer)' }],
    enteredOnce: t("Senjata dipilih dari daftar syarikat; tag dan nombor siri bertopeng tidak ditaip semula. Selepas diluluskan dan disemak, daftar dikemas kini oleh sistem.", "Firearms are picked from the company register; the tag and masked serial are not typed again. Once approved and checked, the system updates the register itself."),
    actions: [],
    steps: {
      save: t("Tekan \"Send to Arms Control\". Jika ada yang salah, sebabnya ditunjuk dan tiada apa disimpan.", "Press \"Send to Arms Control\". If something is wrong the reason is shown and nothing is saved."),
      review: t("Kawalan Senjata menyemak dan meluluskan ke syarikat, atau menghantar balik dengan sebab. Pengurus syarikat membenarkan (bukan pemohon). Rujukan PDRM/KDN direkod, COO atau CEO meluluskan perbelanjaan, orang lain menyemak senjata, dan daftar dikemas kini.", "Arms Control reviews and passes it to the company, or sends it back with a reason. The company manager authorises (not the requester). The PDRM/KDN references are recorded, the COO or CEO approves the spending, someone else checks the arms, and the register is updated."),
      returned: t("Jika Kawalan Senjata menghantarnya balik, sebabnya ditunjuk pada baris \"Last\"; betulkan dengan \"Correct and resubmit\".", "If Arms Control sends it back, the reason shows on the \"Last\" line; fix it with \"Correct and resubmit\"."),
      done: t("Selesai apabila permohonan ditutup selepas daftar dikemas kini.", "Done when the request is closed after the register is updated."),
      recover: t("Ditolak dengan sebab jika: tajuk terlalu pendek, kuantiti tiada untuk pembelian, tiada senjata dipilih, atau senjata bukan milik syarikat ini. Betulkan dan hantar semula.", "Refused with the reason when: the title is too short, a purchase has no quantity, no firearm is picked, or a firearm is not this company's. Correct it and send again."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Langkah PDRM/KDN, Legal dan perbelanjaan selepas pengesahan belum dilalui dalam pelayar.', 'The PDRM/KDN, Legal and spending steps after authorisation have not been walked through in a browser.')],
    checkedAgainst: "raiseArmsRequest",
  },
  {
    id: "specialops.arms-request-resubmit",
    status: 'ready',
    dept: "Arms Control (Special Ops)",
    title: t("Betulkan permohonan yang dihantar balik", "Correct a request sent back"),
    purpose: t("Membetulkan permohonan senjata yang dihantar balik oleh Kawalan Senjata dan menghantarnya semula.", "Correct an arms request that Arms Control sent back, and send it again."),
    who: t("Syarikat berlesen (pengurus syarikat) atau Kawalan Senjata.", "The licensed company (company manager) or Arms Control."),
    screen: { view: "arms", name: "Arms control", action: t("Kawalan senjata → syarikat anda → Permohonan senjata → \"Correct and resubmit\" (pemohon sahaja)", "Arms control → your company → Arms requests → \"Correct and resubmit\" (the requester only)") },
    allowed: ALLOWED.armsRaise,
    fields: [
      { key: "quantity", label: "Quantity", required: false, format: t("Ubah jika perlu, cth. 400", "change if needed, e.g. 400"), example: "400" },
      { key: "cost_rm", label: "Cost RM", required: false, format: t("Ubah jika perlu, cth. 1200", "change if needed, e.g. 1200"), example: "1200" },
      { key: "what_you_corrected", label: "What you corrected", required: true, format: t("Sekurang-kurangnya 3 aksara, cth. \"Cut to 400\"", "at least 3 characters, e.g. \"Cut to 400\""), example: "Cut to 400" },
    ],
    sources: [{ what: t("Sebab ia dihantar balik ditunjukkan pada baris \"Last\". Tanya Kawalan Senjata jika tidak jelas.", "Why it came back is shown on the \"Last\" line. Ask Arms Control if it is unclear."), askDesk: null, askName: 'Arms Control Department (the request’s reviewer)' }],
    enteredOnce: t("Nilai lama kekal dalam log permohonan; tidak perlu buat permohonan baru.", "The old values stay in the request log; there is no need to raise a new request."),
    actions: [],
    steps: {
      save: t("Tekan \"Correct and resubmit\".", "Press \"Correct and resubmit\"."),
      review: t("Ia kembali kepada Kawalan Senjata untuk disemak semula. Kelulusan perbelanjaan yang lama dibatalkan dan perlu diberi semula.", "It goes back to Arms Control for review. Any earlier spending approval is cleared and must be given again."),
      returned: t("Ia boleh dihantar balik lagi dengan sebab baharu; betulkan semula.", "It can be sent back again with a new reason; correct it again."),
      done: t("Selesai apabila ia kembali kepada semakan Kawalan Senjata.", "Done when it is back with Arms Control for review."),
      recover: t("Hanya pemohon atau Kawalan Senjata boleh menghantar semula. Permohonan yang belum dihantar balik tidak boleh dihantar semula.", "Only the requester or Arms Control can resubmit. A request that was not sent back cannot be resubmitted."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Langkah PDRM/KDN, Legal dan perbelanjaan selepas pengesahan belum dilalui dalam pelayar.', 'The PDRM/KDN, Legal and spending steps after authorisation have not been walked through in a browser.')],
    checkedAgainst: "armsRequestStep('resubmit')",
  },
  {
    id: "specialops.arms-request-review",
    status: 'ready',
    dept: "Arms Control (Special Ops)",
    title: t("Semak permohonan senjata", "Review an arms request"),
    purpose: t("Menyemak permohonan syarikat dan meluluskannya ke syarikat atau menghantarnya balik.", "Review a company's request and pass it to the company or send it back."),
    who: t("Jabatan Kawalan Senjata, bukan pemohon.", "The Arms Control Department, not the requester."),
    screen: { view: "arms", name: "Arms control", action: t("Kawalan senjata → Requests → \"Pass to company\" atau \"Send back\"", "Arms control → Requests → \"Pass to company\" or \"Send back\"") },
    allowed: ALLOWED.armsControl,
    fields: [
      { key: "reason", label: "Reason", required: true, format: t("Sekurang-kurangnya 3 aksara, cth. \"Quantity matches two sessions\"", "at least 3 characters, e.g. \"Quantity matches two sessions\""), example: "Quantity matches two sessions" },
    ],
    sources: [{ what: t("Fail pembekal dan daftar senjata dalam Kawalan senjata.", "The supplier file and the firearm register in Arms control."), askDesk: null, askName: 'Arms Control Department (the request’s reviewer)' }],
    enteredOnce: t("Butiran permohonan datang dari syarikat; tiada yang ditaip semula.", "The request details come from the company; nothing is typed again."),
    actions: [],
    steps: {
      save: t("Tulis sebab, kemudian tekan \"Pass to company\" atau \"Send back\".", "Write the reason, then press \"Pass to company\" or \"Send back\"."),
      review: t("Diluluskan: pengurus syarikat membenarkan. Dihantar balik: pemohon membetulkan dan menghantar semula.", "Passed: the company manager authorises. Sent back: the requester corrects and resubmits."),
      returned: t("Permohonan yang dihantar balik kembali kepada anda selepas pemohon membetulkannya.", "A request sent back comes back to you after the requester corrects it."),
      done: t("Selesai apabila ia bergerak ke langkah syarikat atau kembali kepada pemohon.", "Done when it moves to the company step or back to the requester."),
      recover: t("Anda tidak boleh meluluskan permohonan yang anda buat sendiri; orang lain dalam Kawalan Senjata meluluskannya. Menghantar balik perlu sebab.", "You cannot pass a request you raised; someone else in Arms Control passes it. Sending back needs a reason."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Langkah PDRM/KDN, Legal dan perbelanjaan selepas pengesahan belum dilalui dalam pelayar.', 'The PDRM/KDN, Legal and spending steps after authorisation have not been walked through in a browser.')],
    checkedAgainst: "armsRequestStep('pass' | 'return')",
  },
  {
    id: "specialops.arms-request-authorise",
    status: 'ready',
    dept: "Arms Control (Special Ops)",
    title: t("Benarkan permohonan senjata", "Authorise an arms request"),
    purpose: t("Pengurus syarikat (pemegang lesen A) membenarkan atau menolak permohonan.", "The company manager (holder of the A licence) authorises or refuses the request."),
    who: t("Pengurus syarikat (pemegang lesen A).", "The company manager (holder of the A licence)."),
    screen: { view: "arms", name: "Arms control", action: t("Kawalan senjata → syarikat anda → Permohonan senjata → \"Authorise\" atau \"Refuse\"", "Arms control → your company → Arms requests → \"Authorise\" or \"Refuse\"") },
    allowed: ALLOWED.companyAuthority,
    fields: [
      { key: "reason", label: "Reason", required: true, format: t("Sekurang-kurangnya 3 aksara, cth. \"Needed for December range\"", "at least 3 characters, e.g. \"Needed for December range\""), example: "Needed for December range" },
    ],
    sources: [{ what: t("Permohonan dan sebab Kawalan Senjata ditunjukkan pada baris itu.", "The request and Arms Control's reason are shown on the line."), askDesk: null, askName: 'Arms Control Department (the request’s reviewer)' }],
    enteredOnce: t("Tiada yang ditaip semula selain sebab anda.", "Nothing is typed again except your reason."),
    actions: [],
    steps: {
      save: t("Tulis sebab, kemudian tekan \"Authorise\" atau \"Refuse\".", "Write the reason, then press \"Authorise\" or \"Refuse\"."),
      review: t("Dibenarkan: rujukan PDRM/KDN direkod dan COO atau CEO meluluskan perbelanjaan. Pindahan, pelupusan dan dagangan juga melalui semakan Legal PWVSB. Ditolak: permohonan ditutup.", "Authorised: the PDRM/KDN references are recorded and the COO or CEO approves the spending. Transfers, disposal and trade also pass the PWVSB Legal check. Refused: the request is closed."),
      returned: t("Tiada pemulangan pada langkah ini: tolak dengan sebab, dan pemohon membuat permohonan baharu.", "There is no return at this step: refuse with a reason, and the requester raises a new request."),
      done: t("Selesai apabila ia bergerak ke langkah PDRM/KDN atau ditutup.", "Done when it moves to the PDRM/KDN step or is closed."),
      recover: t("Anda tidak boleh membenarkan permohonan yang anda buat sendiri.", "You cannot authorise a request you raised yourself."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Langkah PDRM/KDN, Legal dan perbelanjaan selepas pengesahan belum dilalui dalam pelayar.', 'The PDRM/KDN, Legal and spending steps after authorisation have not been walked through in a browser.')],
    checkedAgainst: "armsRequestStep('authorise' | 'refuse')",
  },
  {
    id: "specialops.armed-job-plan",
    status: 'ready',
    dept: "Arms Control (Special Ops)",
    title: t("Rancang tugas bersenjata", "Plan an armed job"),
    purpose: t("Menempah tugas pengawal peribadi, CIT, CDM atau bilik kebal tunai.", "Book a close protection, cash-in-transit, cash deposit machine or cash vault job."),
    who: t("Pengurus syarikat (pemegang lesen A).", "The company manager (holder of the A licence)."),
    screen: { view: "arms", name: "Arms control", action: t("Kawalan senjata → syarikat anda → Tugas bersenjata → Plan an armed job", "Arms control → your company → Armed jobs → Plan an armed job") },
    allowed: ALLOWED.companyAuthority,
    fields: [
      { key: "kind_of_job", label: "Kind of job", required: true, format: t("Close protection, CIT, CDM, cash vault", "Close protection, CIT, CDM, cash vault"), example: "" },
      { key: "client", label: "Client", required: true, format: t("e.g. Synthetic Bank Bhd", "e.g. Synthetic Bank Bhd"), example: "Synthetic Bank Bhd" },
      { key: "details", label: "Details", required: false, format: t("Tanpa jumlah wang tunai, cth. \"Two drops, Klang\"", "no cash amounts, e.g. \"Two drops, Klang\""), example: "Two drops, Klang" },
      { key: "start_and_end", label: "Start and end", required: true, format: t("Tarikh dan masa", "date and time"), example: "" },
      { key: "crew", label: "Crew", required: true, format: t("Dipilih dari pemegang permit yang sah", "picked from valid permit holders"), example: "" },
      { key: "vehicle", label: "Vehicle", required: false, format: t("No. pendaftaran, cth. TEST 1234", "plate, e.g. TEST 1234"), example: "TEST 1234" },
      { key: "states", label: "States", required: false, format: t("Tandakan negeri yang dilalui", "tick the states it passes"), example: "" },
      { key: "police_approval_reference", label: "Police approval reference", required: false, format: t("Jika sudah ada, cth. PDRM/TEST/1", "when you have it, e.g. PDRM/TEST/1"), example: "PDRM/TEST/1" },
    ],
    sources: [{ what: t("Perjanjian pelanggan dan polisi insurans direkod dalam Perjanjian pelanggan (Client agreements). Tanya Kawalan Senjata jika tiada.", "The client agreement and insurance policy are recorded under Client agreements. Ask Arms Control if they are missing."), askDesk: null, askName: 'Arms Control Department (the request’s reviewer)' }],
    enteredOnce: t("Krew hanya dari pengawal warganegara Malaysia dengan permit sah; tiada pengawal asing (peraturan ARMS-LOCAL-ONLY).", "Crew come only from Malaysian guards with a valid permit; never foreign guards (rule ARMS-LOCAL-ONLY)."),
    actions: [],
    steps: {
      save: t("Tekan \"Book the job\".", "Press \"Book the job\"."),
      review: t("Tiada kelulusan untuk menempah. Kawalan Senjata dan bilik kawalan CMS memantau tugas itu.", "Booking needs no approval. Arms Control and the CMS command centre watch the job."),
      returned: t("Tiada pemulangan; ubah dengan kemas kini tugas.", "Nothing is returned; change it through a job update."),
      done: t("Selesai apabila tugas muncul sebagai Booked.", "Done when the job shows as Booked."),
      recover: t("Ditolak jika: ada jumlah wang tunai dalam butiran, tugas sudah tamat, krew bukan dari syarikat ini, atau krew sudah dalam tugas lain pada masa itu.", "Refused when: the details carry cash amounts, the job has already ended, the crew are not this company's, or a crew member is already on another armed job then."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Belum dilalui dalam pelayar; disemak terhadap kod pelayan sahaja.', 'Not walked through in a browser; checked against the server code only.')],
    checkedAgainst: "planArmedJob",
  },
  {
    id: "specialops.armed-job-update",
    status: 'ready',
    dept: "Arms Control (Special Ops)",
    title: t("Kemas kini tugas bersenjata", "Update an armed job"),
    purpose: t("Merekod mula, lewat, insiden atau selesai.", "Record started, delayed, incident or completed."),
    who: t("Pengurus syarikat (pemegang lesen A).", "The company manager (holder of the A licence)."),
    screen: { view: "arms", name: "Arms control", action: t("Kawalan senjata → syarikat anda → Tugas bersenjata → baris tugas", "Arms control → your company → Armed jobs → the job line") },
    allowed: ALLOWED.companyAuthority,
    fields: [
      { key: "status", label: "Status", required: true, format: t("Started, delayed, incident, completed", "Started, delayed, incident, completed"), example: "" },
      { key: "what_happened", label: "What happened", required: true, format: t("Sekurang-kurangnya 3 aksara, cth. \"Left the base on time\"", "at least 3 characters, e.g. \"Left the base on time\""), example: "Left the base on time" },
    ],
    sources: [{ what: t("Laporan krew semasa tugas.", "The crew's report during the job."), askDesk: null, askName: 'Arms Control Department (the request’s reviewer)' }],
    enteredOnce: t("Semakan \"boleh jalan\" dibina dari rekod sedia ada: permit, latihan menembak, daftar senjata, perjanjian, insurans, kenderaan.", "The go check is built from records already kept: permits, range practice, the firearm register, the agreement, insurance, the vehicle."),
    actions: [],
    steps: {
      save: t("Pilih status, tulis apa yang berlaku, dan simpan.", "Choose the status, write what happened, and save."),
      review: t("Tiada kelulusan. Tugas yang selesai tidak boleh diubah lagi.", "No approval. A completed job cannot be changed again."),
      returned: t("Tiada pemulangan.", "Nothing is returned."),
      done: t("Selesai apabila status baharu ditunjukkan.", "Done when the new status shows."),
      recover: t("Tugas tidak boleh dimulakan jika semakan menunjukkan perkara yang menyekat; senarainya ditunjukkan. Betulkan rekod itu dahulu (contoh: permit, insurans).", "A job cannot start while the check shows a blocking item; the list is shown. Fix that record first (for example the permit or the insurance)."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Belum dilalui dalam pelayar; disemak terhadap kod pelayan sahaja.', 'Not walked through in a browser; checked against the server code only.')],
    checkedAgainst: "updateArmedJob, armedJobCheck",
  },
  {
    id: "specialops.rent-payment",
    status: 'ready',
    dept: "Asset Management",
    title: t("Rekod bayaran sewa", "Record a rent payment"),
    purpose: t("Merekod sewa yang diterima daripada penyewa.", "Record rent received from a tenant."),
    who: t("Pasukan Asset Management.", "The Asset Management team."),
    screen: { view: "assets", name: "Asset Management", action: t("Asset Management → Rent and arrears → unit → Record payment", "Asset Management → Rent and arrears → the unit → Record payment") },
    allowed: ALLOWED.assetTeam,
    fields: [
      { key: "amount_rm", label: "Amount RM", required: true, format: t("e.g. 1500", "e.g. 1500"), example: "1500" },
      { key: "how_it_was_paid", label: "How it was paid", required: true, format: t("Cash, transfer, cheque, online", "Cash, transfer, cheque, online"), example: "" },
      { key: "date_received", label: "Date received", required: true, format: t("YYYY-MM-DD, bukan masa depan", "not in the future"), example: "" },
      { key: "bank_reference_or_cheque_number", label: "Bank reference or cheque number", required: true, format: t("Kecuali tunai, cth. TRX-TEST-001", "except cash, e.g. TRX-TEST-001"), example: "TRX-TEST-001" },
    ],
    sources: [{ what: t("Penyata bank atau cek daripada penyewa. Tanya pasukan Asset Management jika rujukan tiada.", "The bank statement or the tenant's cheque. Ask the Asset Management team if the reference is missing."), askDesk: 'asset' }],
    enteredOnce: t("Sistem memberi nombor resit dan memadankan bayaran dengan bulan tertunggak yang paling lama.", "The system numbers the receipt and applies the payment to the oldest unpaid month."),
    actions: [],
    steps: {
      save: t("Tekan \"Record payment\".", "Press \"Record payment\"."),
      review: t("Tiada kelulusan untuk rekod. Pembalikan resit perlu keputusan Pengarah Aset. Rekod bayaran bukan pemindahan bank.", "Recording needs no approval. Reversing a receipt needs the Asset Director’s decision. Recording a payment is not a bank transfer."),
      returned: t("Untuk membetulkan, minta pembalikan dengan sebab; Pengarah Aset memutuskan.", "To correct it, ask for a reversal with a reason; the Asset Director decides."),
      done: t("Selesai apabila resit bernombor muncul pada unit.", "Done when the numbered receipt shows on the unit."),
      recover: t("Ditolak jika lebih daripada sewa yang tertunggak; Kewangan mengendalikan bayaran pendahuluan.", "Refused when it is more than the rent still due; Finance handles any advance."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Belum dilalui dalam pelayar; disemak terhadap kod pelayan sahaja.', 'Not walked through in a browser; checked against the server code only.')],
    checkedAgainst: "amRecordPayment",
  },
  {
    id: "specialops.rent-follow-up",
    status: 'ready',
    dept: "Asset Management",
    title: t("Rekod susulan sewa", "Record a rent follow-up"),
    purpose: t("Merekod panggilan, mesej, lawatan, janji bayar, surat atau notis kepada penyewa.", "Record a call, message, visit, promise to pay, letter or notice to a tenant."),
    who: t("Pasukan Asset Management.", "The Asset Management team."),
    screen: { view: "assets", name: "Asset Management", action: t("Asset Management → Rent and arrears → unit → Record follow-up", "Asset Management → Rent and arrears → the unit → Record follow-up") },
    allowed: ALLOWED.assetTeam,
    fields: [
      { key: "what_was_done", label: "What was done", required: true, format: t("Call, message, email, visit, promise, letter, notice, note", "Call, message, email, visit, promise, letter, notice, note"), example: "" },
      { key: "what_happened", label: "What happened", required: true, format: t("e.g. \"Tenant will pay on Friday\"", "e.g. \"Tenant will pay on Friday\""), example: "Tenant will pay on Friday" },
      { key: "promised_date", label: "Promised date", required: false, format: t("Untuk janji bayar sahaja", "promise only, not in the past"), example: "" },
    ],
    sources: [{ what: t("Perbualan dengan penyewa.", "Your contact with the tenant."), askDesk: 'asset' }],
    enteredOnce: t("Butiran penyewa dan tunggakan diambil dari unit.", "The tenant's details and arrears come from the unit."),
    actions: [],
    steps: {
      save: t("Tekan \"Record follow-up\".", "Press \"Record follow-up\"."),
      review: t("Surat dan notis perlu kelulusan Pengarah Aset. Mesej WhatsApp automatik tidak dikira sebagai susulan pasukan.", "Letters and notices need the Asset Director's approval. Automatic WhatsApp messages do not count as the team's follow-up."),
      returned: t("Surat atau notis yang tidak diluluskan kembali dengan sebab.", "A letter or notice that is not approved comes back with the reason."),
      done: t("Selesai apabila susulan muncul dalam sejarah unit.", "Done when the follow-up shows in the unit history."),
      recover: t("Janji bayar perlu tarikh hari ini atau kemudian.", "A promise needs a date of today or later."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('Belum dilalui dalam pelayar; disemak terhadap kod pelayan sahaja.', 'Not walked through in a browser; checked against the server code only.')],
    checkedAgainst: "amFollowUp",
  },
  {
    id: "specialops.whatsapp-consent",
    status: 'partial',
    dept: "Asset Management",
    title: t("Rekod persetujuan peringatan WhatsApp", "Record WhatsApp reminder consent"),
    purpose: t("Merekod bahawa penyewa bersetuju (atau tidak lagi) menerima peringatan sewa melalui WhatsApp.", "Record that a tenant agreed (or no longer agrees) to rent reminders on WhatsApp."),
    who: t("Pasukan Asset Management.", "The Asset Management team."),
    screen: { view: "assets", name: "Asset Management", action: t("Asset Management → Rent and arrears → Peringatan WhatsApp → Agreed / Stop", "Asset Management → Rent and arrears → WhatsApp reminders → Agreed / Stop") },
    allowed: ALLOWED.assetTeam,
    fields: [
      { key: "how_the_tenant_agreed", label: "How the tenant agreed", required: true, format: t("Sekurang-kurangnya 5 aksara, cth. \"Signed consent form CF-TEST-01\"", "at least 5 characters, e.g. \"Signed consent form CF-TEST-01\""), example: "Signed consent form CF-TEST-01" },
    ],
    sources: [{ what: t("Borang persetujuan yang ditandatangani atau balasan penyewa. Nombor telefon bimbit Malaysia mesti ada pada unit.", "The signed consent form or the tenant's reply. A Malaysian mobile number must be on the unit."), askDesk: 'asset' }],
    enteredOnce: t("Satu persetujuan untuk setiap unit; satu mesej sehari untuk semua unit penyewa itu.", "One consent per unit; one message a day covers all of that tenant’s units."),
    actions: [],
    steps: {
      save: t("Tulis bagaimana penyewa bersetuju dan tekan \"Agreed\" (atau \"Stop\").", "Write how the tenant agreed and press \"Agreed\" (or \"Stop\")."),
      review: t("BELUM BERSAMBUNG: tiada mesej dihantar sehingga pemilik menyambung WhatsApp Business. Balasan STOP menghentikan peringatan pada semua unit penyewa itu.", "NOT CONNECTED: no message is sent until an owner connects WhatsApp Business. A STOP reply ends reminders on all of that tenant’s units."),
      returned: t("Tiada pemulangan; tekan \"Stop\" untuk menarik balik.", "Nothing is returned; press \"Stop\" to withdraw."),
      done: t("Selesai apabila unit ditunjukkan sebagai bersetuju.", "Done when the unit shows as agreed."),
      recover: t("Ditolak jika tiada nombor telefon bimbit Malaysia; tambah nombor dahulu.", "Refused when there is no Malaysian mobile number; add it first."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.'), t('WhatsApp Business belum disambung; tiada mesej dihantar.', 'WhatsApp Business is not connected; no message is sent.')],
    checkedAgainst: "amWhatsAppConsent",
  },
  {
    id: "specialops.purchase-request",
    status: 'ready',
    dept: "Asset Management",
    title: t("Mohon belian perabot atau kelengkapan", "Ask to buy furniture or fittings"),
    purpose: t("Memohon membeli aset bukan elektronik.", "Ask to buy non-electronic assets."),
    who: t("Pasukan Asset Management.", "The Asset Management team."),
    screen: { view: "assets", name: "Asset Management", action: t("Asset Management → Purchases → Ask", "Asset Management → Purchases → Ask") },
    allowed: ALLOWED.assetTeam,
    fields: [
      { key: "what", label: "What", required: true, format: t("e.g. Office chairs", "e.g. Office chairs"), example: "Office chairs" },
      { key: "category", label: "Category", required: true, format: t("Furniture, fitting, renovation, other", "Furniture, fitting, renovation, other"), example: "" },
      { key: "quantity", label: "Quantity", required: true, format: t("1 hingga 1000, cth. 6", "1 to 1000, e.g. 6"), example: "6" },
      { key: "estimated_total_cost_rm", label: "Estimated total cost RM", required: true, format: t("e.g. 1800", "e.g. 1800"), example: "1800" },
      { key: "location", label: "Location", required: true, format: t("e.g. Group office, level 3", "e.g. Group office, level 3"), example: "Group office, level 3" },
      { key: "whose_books", label: "Whose books", required: true, format: t("e.g. PWVSB", "e.g. PWVSB"), example: "PWVSB" },
      { key: "reason", label: "Reason", required: true, format: t("Sekurang-kurangnya 5 aksara", "at least 5 characters"), example: "" },
    ],
    sources: [{ what: t("Sebut harga pembekal. Tanya pasukan Asset Management.", "The supplier's quotation. Ask the Asset Management team."), askDesk: 'asset' }],
    enteredOnce: t("Apabila diterima, permohonan ini menjadi rekod aset; tidak ditaip semula.", "When received, this request becomes the asset record; it is not typed again."),
    actions: [],
    steps: {
      save: t("Tekan \"Ask\".", "Press \"Ask\"."),
      review: t("Pengarah Kewangan memutuskan sehingga RM10,000; di atasnya COO atau CEO. Sebab diperlukan; pemohon tidak boleh memutuskan.", "The Finance Director decides up to RM10,000; above that the COO or CEO. A reason is needed; the asker never decides."),
      returned: t("Jika ditolak, sebabnya ditunjukkan; buat permohonan baharu jika masih perlu.", "If refused, the reason shows; ask again with a new request if still needed."),
      done: t("Selesai apabila ia diterima dan menjadi aset dalam daftar.", "Done when it is received and becomes an asset in the register."),
      recover: t("Ditolak jika butiran tidak lengkap.", "Refused when a detail is missing."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.')],
    checkedAgainst: "amBuyRequest, amBuyDecide",
  },
  {
    id: "specialops.purchase-receive",
    status: 'ready',
    dept: "Asset Management",
    title: t("Terima aset yang dibeli", "Receive a bought asset"),
    purpose: t("Merekod tag, kos sebenar dan tarikh apabila aset yang diluluskan tiba.", "Record the tag, actual cost and date when an approved asset arrives."),
    who: t("Pasukan Asset Management.", "The Asset Management team."),
    screen: { view: "assets", name: "Asset Management", action: t("Asset Management → Purchases → baris yang diluluskan → Received", "Asset Management → Purchases → the approved line → Received") },
    allowed: ALLOWED.assetTeam,
    fields: [
      { key: "asset_tag", label: "Asset tag", required: true, format: t("Unik, cth. FUR-TEST-0001", "unique, e.g. FUR-TEST-0001"), example: "FUR-TEST-0001" },
      { key: "actual_cost_rm", label: "Actual cost RM", required: true, format: t("Tidak melebihi jumlah diluluskan", "not above the approved amount"), example: "" },
      { key: "purchase_date", label: "Purchase date", required: true, format: t("YYYY-MM-DD, bukan masa depan", "not in the future"), example: "" },
    ],
    sources: [{ what: t("Invois dan nota penghantaran pembekal.", "The supplier's invoice and delivery note."), askDesk: 'asset' }],
    enteredOnce: t("Permohonan yang diluluskan menjadi aset dalam daftar.", "The approved request becomes the asset in the register."),
    actions: [],
    steps: {
      save: t("Isi tag, kos dan tarikh, kemudian tekan \"Received\".", "Fill in the tag, cost and date, then press \"Received\"."),
      review: t("Jika kos lebih tinggi, tekan \"Ask again at RM…\" dengan sebab; ia kembali untuk kelulusan pada jumlah baru. Kelulusan lama kekal dalam sejarah.", "If the cost is higher, press \"Ask again at RM…\" with a reason; it goes back for approval at the new amount. The old approval stays in the history."),
      returned: t("Kos lebih tinggi: \"Ask again at RM…\" menghantarnya kembali untuk kelulusan.", "Higher cost: \"Ask again at RM…\" sends it back for approval."),
      done: t("Selesai apabila aset muncul dalam daftar dengan tag itu.", "Done when the asset shows in the register with that tag."),
      recover: t("Ditolak jika kos melebihi jumlah diluluskan atau tag sudah digunakan.", "Refused when the cost is above the approved amount or the tag is already used."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.')],
    checkedAgainst: "amBuyReceived, amBuyReprice",
  },
  {
    id: "specialops.purchase-decide",
    status: 'ready',
    dept: "Asset Management",
    title: t("Putuskan permohonan belian", "Decide a purchase request"),
    purpose: t("Meluluskan atau menolak belian aset dengan sebab.", "Approve or refuse an asset purchase with a reason."),
    who: t("Pengarah Kewangan (hingga RM10,000), COO atau CEO; bukan pemohon.", "The Finance Director (up to RM10,000), the COO or the CEO; never the asker."),
    screen: { view: "assets", name: "Asset Management", action: t("Asset Management → Purchases → Approve / Refuse", "Asset Management → Purchases → Approve / Refuse") },
    allowed: ALLOWED.purchaseDecider,
    fields: [
      { key: "reason", label: "Reason", required: true, format: t("Sekurang-kurangnya 3 aksara, cth. \"Within the furniture budget\"", "at least 3 characters, e.g. \"Within the furniture budget\""), example: "Within the furniture budget" },
    ],
    sources: [{ what: t("Sebab dan jumlah pemohon ditunjukkan pada baris.", "The asker's reason and amount are shown on the line."), askDesk: 'asset' }],
    enteredOnce: t("Keputusan terikat pada jumlah yang anda lihat.", "The decision is bound to the amount you saw."),
    actions: [],
    steps: {
      save: t("Tulis sebab dan tekan \"Approve\" atau \"Refuse\".", "Write the reason and press \"Approve\" or \"Refuse\"."),
      review: t("Diluluskan: pasukan merekod penerimaan. Ditolak: permohonan ditutup.", "Approved: the team records the receipt. Refused: the request is closed."),
      returned: t("Jika pasukan meminta semula pada jumlah baharu, ia kembali kepada anda.", "If the team asks again at a new amount, it comes back to you."),
      done: t("Selesai apabila status menjadi diluluskan atau ditolak.", "Done when the status becomes approved or refused."),
      recover: t("Jika jumlah berubah semasa anda membuat keputusan, buka semula. Pengarah Kewangan hanya sehingga RM10,000.", "If the amount changed while you were deciding, open it again. The Finance Director decides only up to RM10,000."),
    },
    notVerified: [t('Dilalui dalam pelayar dengan data sintetik pada 2 Nov 2026 hanya untuk langkah yang tersenarai dalam bukti UAT.', 'Walked through in a browser with synthetic data on 2 Nov 2026 only for the steps listed in the UAT evidence.')],
    checkedAgainst: "amBuyDecide",
  },];

/** The cards this person may use (display only; the server still decides every action). */
export function specialOpsGuideCardsFor(user: User, view?: 'arms' | 'assets'): SpecialOpsGuideCard[] {
  if (user.integration) return [];
  return SPECIAL_OPS_GUIDE_CARDS.filter((c) => c.allowed(user) && (!view || c.screen.view === view));
}

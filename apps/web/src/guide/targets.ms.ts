/** Bahasa Melayu twin of targets.ts: the same pages, routes, states and target ids in the same
 * order, with Malay titles, labels and "how to get here" lines. `group` stays the English key
 * (it groups pages and matches GUIDE_GROUPS); GROUP_LABELS_MS gives its Malay name.
 * content-parity.test.ts checks the structure against the English. */
import type { GUIDE_FLOWS, GuidePage, GuideTarget } from "./targets";

const t = (id: string, label: string): GuideTarget => ({ id, label });

export const GROUP_LABELS_MS: Record<string, string> = {
  Today: "Hari ini",
  Work: "Kerja",
  Prima: "Prima",
  Library: "Perpustakaan",
  "AI team": "Pasukan AI",
  Settings: "Tetapan",
  Developer: "Pembangun",
  Help: "Bantuan",
};

export const GUIDE_PAGES_MS: GuidePage[] = [
  // ---------------------------------------------------------------- Today
  {
    id: "workspace", route: "/workspace", title: "Meja kerja saya", group: "Today",
    states: [],
    targets: [
      t("desk.tabs", "Tab meja kerja"), t("desk.ask", "Cari atau pergi ke mana-mana"), t("desk.stats", "Kerja di tangan saya"), t("desk.pinned", "Disemat"),
      t("desk.work", "Kerja saya"), t("desk.files", "Fail meja kerja saya"), t("desk.agents", "Pekerja AI saya"),
      t("desk.waiting", "Hari ini"), t("desk.procedures", "Prosedur saya"),
    ],
  },
  {
    id: "home", route: "/", title: "Pusat arahan", group: "Today", states: [],
    targets: [t("home.health", "Kesihatan sistem"), t("home.getting-started", "Senarai semak Langkah permulaan"), t("home.shortcuts", "Pintasan")],
  },
  {
    id: "overview", route: "/overview", title: "Gambaran syarikat", group: "Today",
    states: [],
    targets: [t("overview.range", "Tempoh"), t("overview.branches", "Semua syarikat sebelah-menyebelah"), t("overview.briefing", "Taklimat AI")],
  },
  {
    id: "impact", route: "/impact", title: "Impak", group: "Today", who: "Pemilik dan pengurus",
    states: [{ key: "roi", how: "Tatal ke bawah ke kalkulator ROI dan cadangan Cuba" }],
    targets: [t("impact.totals", "Hasil terukur"), t("impact.roi", "Kalkulator ROI"), t("impact.try", "Cuba")],
  },
  {
    id: "my-worker", route: "/my-worker", title: "AI saya", group: "Today", who: "Kakitangan",
    states: [{ key: "welcome", how: "Log masuk kali pertama sebagai kakitangan: langkah Ambil pekerja AI anda (/welcome)" }],
    targets: [t("my-worker.status", "Apa yang sedang dibuatnya"), t("my-worker.actions", "Beri tugasan, sembang, tukar waktu"), t("my-worker.week", "Minggu kerjanya")],
  },
  {
    id: "assistants", route: "/assistants", title: "Pembantu saya", group: "Today", who: "Pemilik dan pengurus",
    states: [],
    targets: [t("assistants.chat", "Sembang dengan pembantu anda"), t("assistants.quick", "Soalan sekali ketik"), t("assistants.connections", "Gmail, Calendar dan WhatsApp")],
  },
  {
    id: "computers", route: "/computers", title: "Komputer saya", group: "Today", who: "Sesiapa yang ada AI sendiri (kembar AI atau pembantu peribadi)",
    states: [{ key: "activity", how: "Klik Aktiviti terkini pada komputer" }],
    targets: [
      t("computers.link", "Pautkan komputer"), t("computers.device", "Komputer yang dipautkan"), t("computers.folders", "Folder yang boleh dilihat AI anda"),
      t("computers.activity", "Apa yang dibuat AI anda padanya"), t("computers.safety", "Apa yang boleh dan tidak boleh dibuatnya"),
    ],
  },
  // ---------------------------------------------------------------- Work
  {
    id: "tasks", route: "/tasks", title: "Tugasan", group: "Work",
    states: [
      { key: "new", how: "Klik Tugasan baharu: komposer tugasan dibuka (apa yang anda perlukan, cara, siapa dan bila)" },
      { key: "sheet", how: "Klik kad tugasan: helaiannya dengan pelan, hasil dan garis masa" },
    ],
    targets: [t("tasks.new", "Tugasan baharu"), t("tasks.columns", "Lajur papan"), t("tasks.card", "Kad tugasan"), t("tasks.search", "Cari")],
  },
  {
    id: "approvals", route: "/approvals", title: "Kelulusan", group: "Work", states: [],
    targets: [t("approvals.card", "Keputusan yang menunggu"), t("approvals.actions", "Lulus, sentiasa benarkan atau tolak"), t("approvals.history", "Sejarah")],
  },
  {
    id: "chat", route: "/chat", title: "Sembang", group: "Work",
    states: [{ key: "conversation", how: "Pilih ejen: perbualan skrin penuh terbuka" }],
    targets: [t("chat.agents", "Pilih ejen"), t("chat.composer", "Taip, atau tahan mikrofon")],
  },
  {
    id: "mail", route: "/mail", title: "Microsoft 365", group: "Work", who: "Mereka yang ada AI sendiri atau pembantu peribadi",
    states: [],
    targets: [t("mail.drafts", "Menunggu kelulusan anda")],
  },
  {
    id: "forms", route: "/forms", title: "Borang", group: "Work",
    states: [
      { key: "handin", how: "Klik Hantar pada borang: muat naik borang yang diisi dan resit" },
      { key: "ask", how: "Klik Minta AI isikan pada borang" },
    ],
    targets: [t("forms.tabs", "Perlu dihantar dan semua borang"), t("forms.list", "Borang syarikat")],
  },
  {
    id: "reports", route: "/reports", title: "Laporan", group: "Work", states: [],
    targets: [t("reports.list", "Laporan yang ditulis ejen"), t("reports.search", "Cari")],
  },
  {
    id: "workflows", route: "/workflows", title: "Aliran kerja", group: "Work",
    states: [{ key: "editor", how: "Buka aliran kerja: editor skrin penuh" }],
    targets: [t("workflows.new", "Aliran kerja baharu"), t("workflows.list", "Aliran kerja"), t("workflows.run", "Jalankan")],
  },
  {
    id: "objectives", route: "/objectives", title: "Objektif", group: "Work", who: "Pemilik dan pengurus", states: [],
    targets: [],
  },
  // ---------------------------------------------------------------- Prima
  {
    id: "prima", route: "/prima", title: "Prima", group: "Prima", states: [],
    targets: [],
  },
  // ---------------------------------------------------------------- Library
  {
    id: "files", route: "/files", title: "Perpustakaan: Semak imbas", group: "Library",
    states: [{ key: "sheet", how: "Klik fail: pratonton dan apa yang dibaca daripadanya" }],
    targets: [
      t("files.company", "Pilih syarikat"), t("files.upload", "Muat naik fail, folder atau zip"), t("files.report", "Laporan muat naik"),
      t("files.tree", "Folder"), t("files.filters", "Carian dan penapis"), t("files.list", "Fail"),
      t("files.download-folder", "Muat turun folder"), t("files.download-all", "Muat turun semuanya"), t("files.library", "Guna sebagai garis panduan"),
      t("shell.search", "Cari dalam setiap dokumen"),
    ],
  },
  {
    id: "documents", route: "/documents", title: "Dokumen", group: "Library",
    states: [{ key: "editor", how: "Buka dokumen: editor dengan medan dan pratonton" }],
    targets: [t("documents.new", "Dokumen baharu"), t("documents.list", "Dokumen dan semakannya")],
  },
  {
    id: "sops", route: "/sops", title: "SOP", group: "Library", states: [],
    targets: [t("sops.new", "SOP baharu"), t("sops.list", "SOP ikut skop")],
  },
  {
    id: "library", route: "/library", title: "Garis panduan", group: "Library", states: [],
    targets: [t("library.upload", "Muat naik garis panduan"), t("library.sources", "Sumber dan status"), t("library.search", "Cuba cari"), t("library.sharepoint", "SharePoint dan OneDrive")],
  },
  {
    id: "templates", route: "/templates", title: "Templat", group: "Library", states: [],
    targets: [t("templates.new", "Templat baharu"), t("templates.list", "Templat")],
  },
  {
    id: "packs", route: "/packs", title: "Pek", group: "Library", states: [],
    targets: [t("packs.new", "Pek baharu"), t("packs.list", "Pek dan kemajuannya")],
  },
  {
    id: "company-kit", route: "/company-kit", title: "Kit syarikat", group: "Library", states: [],
    targets: [t("company-kit.fields", "Fakta syarikat"), t("company-kit.save", "Simpan")],
  },
  // ---------------------------------------------------------------- AI team
  {
    id: "agents", route: "/agents", title: "Ejen", group: "AI team",
    states: [
      { key: "new", how: "Klik Ejen baharu: pembina ejen (/agents/new)" },
      { key: "detail", how: "Klik kad ejen: halaman butirannya" },
    ],
    targets: [t("agents.new", "Ejen baharu"), t("agents.card", "Kad ejen"), t("agents.org", "Paparan carta organisasi")],
  },
  {
    id: "timetable", route: "/timetable", title: "Jadual waktu", group: "AI team", who: "Pemilik dan pengurus", states: [],
    targets: [],
  },
  {
    id: "monitor", route: "/monitor", title: "Pantau", group: "AI team", states: [],
    targets: [t("monitor.agents", "Ejen yang sedang bekerja"), t("monitor.screen", "Skrin langsung dan langkah")],
  },
  {
    id: "meetings", route: "/meetings", title: "Mesyuarat", group: "AI team", states: [],
    targets: [t("meetings.list", "Mesyuarat"), t("meetings.new", "Mula mesyuarat")],
  },
  {
    id: "broadcasts", route: "/broadcasts", title: "Hebahan", group: "AI team", states: [],
    targets: [t("broadcasts.compose", "Tulis hebahan"), t("broadcasts.list", "Dihantar dan diakui")],
  },
  {
    id: "office", route: "/office", title: "Ruang pejabat", group: "AI team",
    states: [{ key: "agent", how: "Klik ejen di mejanya: panel sisinya terbuka" }],
    targets: [t("office.floor", "Pejabat langsung"), t("office.branch", "Pilih syarikat")],
  },
  {
    id: "learning", route: "/learning", title: "Pembelajaran", group: "AI team", states: [],
    targets: [t("learning.kpis", "Apa yang dipelajari"), t("learning.autopilot", "Autopilot dan semakan kendiri"), t("learning.recent", "Keputusan terkini")],
  },
  {
    id: "skills", route: "/skills", title: "Kemahiran", group: "AI team",
    states: [{ key: "sheet", how: "Klik kemahiran: langkah, ujian, versi, Tambah baik dengan AI" }],
    targets: [t("skills.list", "Kemahiran"), t("skills.proposals", "Cadangan yang menunggu"), t("skills.teach", "Ajar daripada sumber")],
  },
  {
    id: "brain", route: "/brain", title: "Brain", group: "AI team", states: [],
    targets: [t("brain.tabs", "Halaman, fakta, carian, graf, mimpi"), t("brain.search", "Cari")],
  },
  {
    id: "blueprints", route: "/blueprints", title: "Pelan tugas", group: "AI team", states: [],
    targets: [t("blueprints.new", "Pelan tugas baharu"), t("blueprints.apply", "Guna pada ejen")],
  },
  // ---------------------------------------------------------------- Settings
  {
    id: "organization", route: "/organization", title: "Organisasi", group: "Settings",
    states: [{ key: "new", how: "Klik Tambah syarikat: industri dan pasukan AI siap sedia" }],
    targets: [t("organization.add", "Tambah syarikat"), t("organization.company", "Syarikat dan jabatannya")],
  },
  {
    id: "settings", route: "/settings/members", title: "Ahli dan tetapan", group: "Settings", states: [],
    targets: [t("settings.add", "Tambah ahli"), t("settings.list", "Orang dan peranan")],
  },
  {
    id: "roles", route: "/settings/roles", title: "Peranan dan akses", group: "Settings", who: "Pemilik", states: [],
    targets: [],
  },
  {
    id: "staff-computers", route: "/staff-computers", title: "Komputer staf", group: "Settings", who: "Pemilik, admin dan pengurus", states: [],
    targets: [],
  },
  {
    id: "ai-use", route: "/settings/ai-use", title: "Penggunaan dan had AI", group: "Settings", who: "Pemilik, admin dan pengurus", states: [],
    targets: [],
  },
  {
    id: "web-connections", route: "/web-connections", title: "Sambungan web", group: "Settings", who: "Pemilik", states: [],
    targets: [],
  },
  {
    id: "approved-services", route: "/approved-services", title: "Perkhidmatan diluluskan", group: "Settings", who: "Pemilik", states: [],
    targets: [],
  },
  {
    id: "channels", route: "/channels", title: "Saluran", group: "Settings", states: [],
    targets: [t("channels.whatsapp", "WhatsApp"), t("channels.telegram", "Telegram"), t("channels.push", "Pemberitahuan telefon")],
  },
  {
    id: "ai-engine", route: "/ai-engine", title: "Enjin AI", group: "Settings", who: "Pemilik dan pentadbir",
    states: [],
    targets: [t("ai-engine.tabs", "Penyedia, kumpulan model, penggunaan, ruang uji"), t("ai-engine.add", "Tambah penyedia")],
  },
  {
    id: "storage", route: "/settings/storage", title: "Storan fail", group: "Settings", who: "Pemilik dan admin", states: [],
    targets: [],
  },
  {
    id: "logins", route: "/logins", title: "Log masuk", group: "Settings", states: [],
    targets: [t("logins.new", "Tambah log masuk"), t("logins.list", "Log masuk, dikunci kepada lamannya")],
  },
  {
    id: "schedules", route: "/schedules", title: "Jadual", group: "Settings", states: [],
    targets: [t("schedules.new", "Jadual baharu"), t("schedules.list", "Jadual dan larian")],
  },
  {
    id: "mcp-servers", route: "/mcp-servers", title: "Alat MCP", group: "Settings", states: [],
    targets: [t("mcp-servers.add", "Sambung pelayan")],
  },
  {
    id: "activity", route: "/activity", title: "Aktiviti", group: "Settings", states: [],
    targets: [t("activity.filter", "Penapis"), t("activity.list", "Setiap perubahan, mengikut turutan")],
  },
  // ---------------------------------------------------------------- Developer
  {
    id: "feedbacks", route: "/feedbacks", title: "Maklum balas", group: "Developer", who: "Pembangun sistem", states: [],
    targets: [],
  },
  // ---------------------------------------------------------------- Help
  {
    id: "start", route: "/start", title: "Persediaan", group: "Help", states: [],
    targets: [],
  },
  {
    id: "tutorial", route: "/tutorial", title: "Tutorial", group: "Help", states: [],
    targets: [t("tutorial.tracks", "Laluan peranan anda"), t("tutorial.next", "Seterusnya")],
  },
  {
    id: "demo-day", route: "/tutorial", title: "Demo: sehari bekerja bersama ejen AI", group: "Help", states: [],
    targets: [],
  },
  {
    id: "present", route: "/present", title: "Bentang", group: "Help", states: [],
    targets: [],
  },
];

export type GuideFlow = { readonly id: (typeof GUIDE_FLOWS)[number]["id"]; readonly title: string; readonly page: string };

/** The recorded flows, with Malay titles. */
export const GUIDE_FLOWS_MS: readonly GuideFlow[] = [
  { id: "create-agent", title: "Cipta ejen", page: "agents" },
  { id: "give-task", title: "Beri tugasan dan ikutinya", page: "tasks" },
  { id: "approve", title: "Luluskan keputusan", page: "approvals" },
  { id: "add-company", title: "Tambah syarikat bersama pasukan AI siap sedia", page: "organization" },
  { id: "hire-worker", title: "Kakitangan: ambil pekerja AI anda", page: "my-worker" },
  { id: "phone-tour", title: "Di telefon", page: "home" },
];

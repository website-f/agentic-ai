import { tr, type Lang } from './i18n';
import type { ViewName } from './App';

/**
 * P90 (Fitri, 9 Nov 2026: "too many things and navs ... add a search bar ... group the navs accordingly"): the menu in
 * six sections, each split into small groups of related screens, plus the words people search with. Every screen sits
 * in exactly one group (scripts/nav-catalog.test.mjs checks it against the menu in App.tsx). Who may open a screen is
 * still decided by the menu filter in App.tsx and by the server; this file only places and describes screens.
 *
 * Titles and one-line descriptions are written in English and shown through the translation table (i18n.ts rows
 * "P90: menu sections" and "P90: screen descriptions").
 */
export type NavSectionId = 'today' | 'ops' | 'people' | 'biz' | 'gov' | 'it';

export interface NavGroup {
  title: string;
  views: ViewName[];
}
export interface NavSection {
  id: NavSectionId;
  title: string;
  groups: NavGroup[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'today',
    title: 'Today',
    groups: [
      { title: 'Dashboards', views: ['home', 'overview', 'company', 'office', 'doa', 'reports'] },
      { title: 'My work', views: ['mine', 'clock', 'work', 'meetings', 'memos'] },
    ],
  },
  {
    id: 'ops',
    title: 'Operations',
    groups: [
      { title: 'Sites and areas', views: ['ops', 'sites', 'branchwork', 'surveys', 'sitehours'] },
      { title: 'Guards and duty', views: ['people', 'roster', 'duty', 'attendance', 'cleaning'] },
      { title: 'Incidents and security', views: ['cases', 'arms', 'cms', 'cmsready', 'device'] },
      { title: 'Equipment and vehicles', views: ['items', 'sitestock', 'fleet'] },
    ],
  },
  {
    id: 'people',
    title: 'People and HR',
    groups: [
      { title: 'Staff', views: ['hr', 'staff-directory', 'staffclock', 'work-kpi', 'handovers'] },
      { title: 'Pay', views: ['staffpay', 'guardpay', 'payformulas', 'salarycalc', 'statutory', 'advances', 'loans', 'arrivalcash'] },
      { title: 'Claims and welfare', views: ['claims', 'socso'] },
      { title: 'Foreign workers', views: ['fwm', 'fwcost', 'fwstat', 'hostels'] },
    ],
  },
  {
    id: 'biz',
    title: 'Business and finance',
    groups: [
      { title: 'Clients and sales', views: ['commercial', 'clients', 'contracts'] },
      { title: 'Payments and buying', views: ['finance', 'payreq', 'requests', 'purchasing', 'credit'] },
      { title: 'Companies and assets', views: ['branches', 'assets', 'insurance'] },
      { title: 'JA Group app', views: ['ja', 'jaswitch'] },
    ],
  },
  {
    id: 'gov',
    title: 'Compliance and governance',
    groups: [
      { title: 'Licences and readiness', views: ['compliance', 'renewals', 'rba', 'selfaudit'] },
      { title: 'Audit and quality', views: ['act', 'audit', 'quality', 'grc'] },
      { title: 'Company governance', views: ['governance', 'registers', 'corporate', 'pdpa'] },
    ],
  },
  {
    id: 'it',
    title: 'IT and systems',
    groups: [
      { title: 'IT help', views: ['it', 'hr-it-intake', 'it-procurement'] },
      { title: 'Systems and data', views: ['connections', 'websites', 'continuity', 'it-metrics', 'it-extraction'] },
    ],
  },
];

const WHERE = new Map<ViewName, { section: NavSection; group: NavGroup; order: number }>();
{
  let order = 0;
  for (const s of NAV_SECTIONS) for (const g of s.groups) for (const v of g.views) WHERE.set(v, { section: s, group: g, order: order++ });
}
/** The section and group a screen sits in (undefined for a screen not placed yet; it then shows under "More"). */
export function whereIs(view: ViewName): { section: NavSection; group: NavGroup } | undefined {
  return WHERE.get(view);
}

/**
 * One plain line per screen for the home screen's "All your screens", and the words people use when they look for it
 * (English, Malay and the work words in between). Search also matches the menu label and section in every language.
 */
export const NAV_INFO: Record<ViewName, { blurb: string; words: string }> = {
  home: { blurb: 'What needs you today and the key numbers.', words: 'dashboard utama main start mula to do tugasan senarai' },
  overview: { blurb: 'Every company in the group at a glance.', words: 'group kumpulan all companies semua syarikat dashboard' },
  company: { blurb: "Your company's day: sites, guards and open matters.", words: 'company syarikat today hari ini dashboard' },
  office: { blurb: 'Share company office work out to the executives.', words: 'company office pejabat syarikat desk meja executive eksekutif task tugasan' },
  doa: { blurb: "The Director Office's letters, approvals and follow-ups.", words: 'director office pejabat pengarah doa letter surat approval kelulusan' },
  reports: { blurb: 'Monthly and summary reports to read or print.', words: 'report laporan monthly bulanan summary ringkasan print cetak' },
  mine: { blurb: 'Your own details, duty, leave and payslips.', words: 'my details butiran saya profile profil me saya duty tugas leave cuti payslip slip gaji training latihan' },
  clock: { blurb: 'Clock in and out for your working day.', words: 'clock in out punch masuk keluar daftar masuk attendance kehadiran my clock jam' },
  work: { blurb: 'Your tasks and what "done" means for each.', words: 'work kerja task tugasan to do job assignment' },
  meetings: { blurb: 'Meetings, minutes and the actions you own.', words: 'meeting mesyuarat minutes minit action tindakan agenda' },
  memos: { blurb: 'Memos and notices sent to you.', words: 'memo notice notis announcement pengumuman circular pekeliling' },
  ops: { blurb: 'Operations across regions and areas.', words: 'regional wilayah operations operasi area kawasan om region zon zone' },
  sites: { blurb: 'Every site with its posts, guards and client.', words: 'site tapak lokasi location post pos premis premises' },
  branchwork: { blurb: 'Checklists for branches far from the office.', words: 'far branch cawangan jauh checklist senarai semak' },
  surveys: { blurb: 'Survey a new site, even with no signal.', words: 'survey tinjauan site visit lawatan tapak offline new site' },
  sitehours: { blurb: 'Allowed guard hours per site each month.', words: 'man-hours manhours jam kerja hours jam site hours overtime lebih masa ot' },
  people: { blurb: 'Guards and officers: details, papers and history.', words: 'guard guards pengawal officer pegawai people kakitangan worker pekerja staff' },
  roster: { blurb: 'Who works which shift at which site.', words: 'roster jadual schedule shift syif giliran' },
  duty: { blurb: 'Duty plans for each guard post.', words: 'duty plan pelan tugas post pos patrol rondaan' },
  attendance: { blurb: 'Who came, who was late and who was absent.', words: 'attendance kehadiran clock in timesheet absent tidak hadir ponteng late lewat leave cuti' },
  cleaning: { blurb: 'Cleaning plans and checks for each site.', words: 'cleaning pembersihan cleaner pencuci' },
  cases: { blurb: 'Incidents and complaints, from report to close.', words: 'incident insiden kes case complaint aduan laporan kejadian' },
  arms: { blurb: 'Firearms, ammunition and their holders.', words: 'arms senjata firearm senjata api gun pistol shotgun peluru ammunition' },
  cms: { blurb: 'CCTV and alarm monitoring.', words: 'cms cctv monitoring pemantauan alarm penggera device peranti' },
  cmsready: { blurb: "Each site's devices and readiness for CMS.", words: 'cms readiness kesediaan cctv device peranti' },
  device: { blurb: "The site's shared device for face clock-in.", words: 'site device peranti tapak tablet face muka clock in' },
  items: { blurb: 'Equipment and uniforms: issue, return, scan and count.', words: 'items barang equipment peralatan uniform pakaian seragam scan imbas qr barcode stock stok walkie talkie' },
  sitestock: { blurb: 'Stock and fittings kept at each site.', words: 'site stock stok fittings kelengkapan inventory inventori' },
  fleet: { blurb: 'Company vehicles, bookings and drivers.', words: 'vehicle kenderaan car kereta van motorcycle motosikal transport pengangkutan driver pemandu' },
  hr: { blurb: 'HR across the group: staff, leave and cases.', words: 'hr human resources sumber manusia staff kakitangan leave cuti hiring pengambilan' },
  'staff-directory': { blurb: 'Office staff names, posts and contacts.', words: 'staff directory direktori senarai staf phone telefon email emel contact hubungi' },
  staffclock: { blurb: 'Office staff clock-in times.', words: 'staff clock jam staf office hours waktu pejabat attendance kehadiran staf' },
  'work-kpi': { blurb: 'How fast and how well work moves between teams.', words: 'kpi performance prestasi target sasaran workflow' },
  handovers: { blurb: 'Hand over your work before leave or a move.', words: 'hand-over handover serah tugas serahan leave cuti resign letak jawatan transfer pindah' },
  staffpay: { blurb: 'Office staff payroll and payslips.', words: 'salary gaji payroll payslip slip gaji staff pay gaji staf pay bayaran' },
  guardpay: { blurb: "The guards' monthly pay run.", words: 'salary gaji payroll guard pay gaji pengawal pay run wages upah' },
  payformulas: { blurb: 'How guard salary and overtime are counted.', words: 'pay formula formula gaji overtime ot lebih masa salary gaji' },
  salarycalc: { blurb: "See how a guard's month of pay is counted.", words: 'salary gaji calculator kalkulator kira gaji overtime ot' },
  statutory: { blurb: 'EPF, SOCSO, EIS and tax rates by month.', words: 'epf kwsp socso perkeso eis sip pcb tax cukai hrdf rates kadar statutory berkanun' },
  advances: { blurb: 'Wage advances asked for, approved and paid.', words: 'wage advance pendahuluan gaji salary advance' },
  loans: { blurb: 'Staff advances and loans, and repayments.', words: 'loan pinjaman advance pendahuluan repayment bayar balik' },
  arrivalcash: { blurb: 'Cash given to new foreign workers on arrival.', words: 'arrival ketibaan cash tunai foreign workers pekerja asing fw new worker' },
  claims: { blurb: 'Claim back work expenses and travel.', words: 'claim claims tuntutan mileage perbatuan receipt resit expenses belanja travel perjalanan' },
  socso: { blurb: 'SOCSO claims for injured guards and staff.', words: 'socso perkeso injury kecederaan accident kemalangan' },
  fwm: { blurb: 'Foreign workers: permits, passports and moves.', words: 'foreign workers pekerja asing fw fwm permit plks visa passport pasport nepal nepali' },
  fwcost: { blurb: 'What hiring foreign workers costs each company.', words: 'recruitment pengambilan agent ejen levy levi foreign workers pekerja asing fw cost kos' },
  fwstat: { blurb: 'EPF and SOCSO for Nepali workers, and repayments.', words: 'nepali nepal epf kwsp socso perkeso foreign workers pekerja asing fw recharge' },
  hostels: { blurb: 'Hostels, rooms and utility bills.', words: 'hostel asrama rumah kongsi accommodation penginapan utility utiliti bil bill' },
  commercial: { blurb: 'Tenders and quotations from first look to award.', words: 'tender sebut harga quote quotation bid bida sales jualan' },
  clients: { blurb: 'Clients and their contact people.', words: 'client pelanggan customer contact hubungan' },
  contracts: { blurb: 'Contracts and getting new sites started.', words: 'contract kontrak agreement perjanjian mobilisation mobilisasi loa' },
  finance: { blurb: 'Accounts, payments and cash for each company.', words: 'finance kewangan accounts akaun sql account invoice invois bank payment bayaran' },
  payreq: { blurb: 'Ask for a payment and follow its approvals.', words: 'payment request bayaran pembayaran permohonan bayaran invoice invois supplier pembekal' },
  requests: { blurb: 'Operation claims and office needs.', words: 'request permohonan permintaan office needs keperluan pejabat operation claims tuntutan operasi' },
  purchasing: { blurb: 'Buying, suppliers and the uniform store.', words: 'procurement perolehan purchase pembelian buy beli supplier pembekal po purchase order store stor uniform' },
  credit: { blurb: 'Credit given by PWVSB to group companies.', words: 'credit kredit loan pinjaman pwvsb' },
  branches: { blurb: "Branches, their settlements and actions.", words: 'branch branches cawangan settlement penyelesaian' },
  assets: { blurb: 'Company assets and their upkeep.', words: 'asset aset equipment peralatan property harta' },
  insurance: { blurb: 'Insurance policies and claims.', words: 'insurance insurans takaful policy polisi claim tuntutan' },
  ja: { blurb: 'Data read from the JA Group app.', words: 'ja group app aplikasi data feed payroll' },
  jaswitch: { blurb: 'Moving work over from the JA Group app.', words: 'ja switch tukar migrate pindah import history sejarah' },
  compliance: { blurb: 'Licences and permits, and when they expire.', words: 'licence license lesen permit permit kdn pdrm expiry tamat tempoh' },
  renewals: { blurb: 'Renewals coming due for each company.', words: 'renewal pembaharuan renew expiry tamat tempoh licence lesen road tax cukai jalan' },
  rba: { blurb: 'RBA ethics declarations and readiness.', words: 'rba ethics etika declaration akuan responsible business' },
  selfaudit: { blurb: "The company's yearly self-audit.", words: 'self audit audit kendiri yearly tahunan' },
  act: { blurb: 'Audit findings to fix, and how they are fixed.', words: 'act audit compliance pematuhan transformation transformasi finding findings penemuan' },
  audit: { blurb: 'Who changed what, and when.', words: 'audit trail jejak audit log history sejarah who changed' },
  quality: { blurb: 'Quality checks, guard skills and supplier ratings.', words: 'quality kualiti iso skills kemahiran assessment penilaian supplier rating penarafan pembekal' },
  grc: { blurb: 'Speak up about a concern, or declare a gift.', words: 'speak up whistle whistleblow pemberi maklumat concern gift hadiah declaration akuan assurance' },
  governance: { blurb: 'Mandates: who may decide what.', words: 'mandate mandat authority kuasa delegation delegasi resolution resolusi' },
  registers: { blurb: 'Governance registers kept by law.', words: 'register daftar conflict of interest konflik kepentingan governance' },
  corporate: { blurb: 'Company secretary filings and the board.', words: 'company secretary setiausaha syarikat ssm board lembaga director pengarah filing' },
  pdpa: { blurb: 'Personal data protection: consent and requests.', words: 'pdpa privacy privasi personal data data peribadi consent persetujuan' },
  it: { blurb: 'Ask IT for help, and IT equipment.', words: 'it help bantuan computer komputer laptop printer ticket tiket password kata laluan' },
  'hr-it-intake': { blurb: 'Accounts for staff joining, moving or leaving.', words: 'new staff staf baru joining leaving onboarding offboarding account akaun login hr it' },
  'it-procurement': { blurb: 'Buying IT equipment through to delivery.', words: 'it purchase pembelian it laptop computer komputer buy beli' },
  connections: { blurb: 'Check your Outlook, Teams and SharePoint access.', words: 'microsoft 365 outlook teams sharepoint email emel connection sambungan' },
  websites: { blurb: "The group's websites and who looks after them.", words: 'website laman web domain web' },
  continuity: { blurb: 'Backups and restore tests for every system.', words: 'continuity kesinambungan backup sandaran restore pemulihan disaster bencana' },
  'it-metrics': { blurb: 'How long work takes and how well it is done.', words: 'workflow time masa quality kualiti metrics' },
  'it-extraction': { blurb: 'Preview of data read by AI from files.', words: 'ai data extract ekstrak preview' },
};

/** Lower case, no accents, no punctuation: "Hand-overs" and "hand overs" match. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const LANGS_ALL: Lang[] = ['ms', 'mix'];

export interface NavHit<T> {
  item: T;
  score: number;
}

/**
 * Menu search: every word typed must be found in the screen's label (English or as shown in Malay or the mix), its
 * section or group name, or its search words. A label match ranks first, then the search words, then the section.
 */
export function searchNav<T extends { view: ViewName; label: string }>(items: T[], query: string): NavHit<T>[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out: NavHit<T>[] = [];
  for (const item of items) {
    const where = WHERE.get(item.view);
    const labels = [item.label, ...LANGS_ALL.map((l) => tr(item.label, l))].map(fold);
    const extra = fold(NAV_INFO[item.view]?.words ?? '');
    const place = where ? [where.section.title, where.group.title].flatMap((t) => [t, ...LANGS_ALL.map((l) => tr(t, l))]).map(fold).join(' ') : '';
    let score = 0;
    let all = true;
    for (const w of words) {
      const best = Math.max(
        // Inside a word only in the label and for longer words: "cuti" must not find "executive".
        ...labels.map((l) => (l.startsWith(w) ? 100 : ` ${l}`.includes(` ${w}`) ? 80 : w.length > 3 && l.includes(w) ? 50 : 0)),
        ` ${extra}`.includes(` ${w}`) ? 40 : 0,
        ` ${place}`.includes(` ${w}`) ? 20 : 0,
      );
      if (!best) {
        all = false;
        break;
      }
      score += best;
    }
    if (all) out.push({ item, score: score - (where ? where.order / 1000 : 1) });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The part of `shown` that matches what was typed, for highlighting: [before, match, after] or null. */
export function matchSpan(shown: string, query: string): [string, string, string] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const low = shown.toLowerCase();
  let at = low.indexOf(q);
  let len = q.length;
  if (at < 0) {
    // Several words typed: highlight the first one that appears.
    for (const w of q.split(/\s+/).filter((x) => x.length > 1)) {
      at = low.indexOf(w);
      if (at >= 0) {
        len = w.length;
        break;
      }
    }
  }
  if (at < 0) return null;
  return [shown.slice(0, at), shown.slice(at, at + len), shown.slice(at + len)];
}

/* ---------- Remembered per person in this browser (a convenience only; never needed for the app to work) ---------- */

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function writeList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* private window or storage full: forget it */
  }
}

/** Screens this person opened lately, newest first. */
export function recentViews(userId: string): ViewName[] {
  return readList(`prima.nav.recent.${userId}`) as ViewName[];
}
export function rememberView(userId: string, view: ViewName) {
  if (view === 'home') return;
  const list = [view, ...recentViews(userId).filter((v) => v !== view)].slice(0, 8);
  writeList(`prima.nav.recent.${userId}`, list);
}

/** Menu sections this person has opened or closed (by section id). */
export function sectionState(userId: string): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(`prima.nav.open.${userId}`) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}
export function saveSectionState(userId: string, state: Record<string, boolean>) {
  try {
    localStorage.setItem(`prima.nav.open.${userId}`, JSON.stringify(state));
  } catch {
    /* forget it */
  }
}

/** The menu laid out in sections and groups, keeping only the screens this person has. */
export function layoutNav<T extends { view: ViewName }>(items: T[]): { id: string; title: string; groups: { title: string; items: T[] }[]; count: number }[] {
  const byView = new Map(items.map((i) => [i.view, i]));
  const placed = new Set<ViewName>();
  const out: { id: string; title: string; groups: { title: string; items: T[] }[]; count: number }[] = [];
  for (const s of NAV_SECTIONS) {
    const groups = s.groups
      .map((g) => ({ title: g.title, items: g.views.map((v) => byView.get(v)).filter((x): x is T => !!x) }))
      .filter((g) => g.items.length);
    groups.forEach((g) => g.items.forEach((i) => placed.add(i.view)));
    const count = groups.reduce((n, g) => n + g.items.length, 0);
    if (count) out.push({ id: s.id, title: s.title, groups, count });
  }
  const rest = items.filter((i) => !placed.has(i.view));
  if (rest.length) out.push({ id: 'more', title: 'More', groups: [{ title: '', items: rest }], count: rest.length });
  return out;
}

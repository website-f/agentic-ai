import { accessClosed, isActHead, isGroupLeader } from './access';
import { RULES } from './rules';
import type { IsoDate, User } from './types';

/**
 * Microsoft use board (rule M365-USE; Fauzan, 23 Nov 2026). Prima reads Microsoft's own usage records once a day and
 * shows, for each office staff member, what is set up and what is actually used, with a short how-to for anything
 * missing. Coaching, never discipline. Only counts and dates are read: never the content of e-mail, chats or files.
 * A check Prima cannot measure is Unknown, never green.
 */
export type UseStatus = 'ok' | 'missing' | 'unknown';
export type UseCheckId = 'prima_signin' | 'authenticator' | 'password_reset' | 'my_apps' | 'teams' | 'outlook' | 'mailbox' | 'onedrive' | 'sharepoint' | 'onenote' | 'loop' | 'device' | 'desktop_office' | 'labels';

/** The order checks are shown in; the last three are for staff on a managed plan (Business Premium, E3, E5). */
export const USE_CHECKS: readonly UseCheckId[] = ['prima_signin', 'authenticator', 'password_reset', 'my_apps', 'teams', 'outlook', 'mailbox', 'onedrive', 'sharepoint', 'onenote', 'loop', 'device', 'desktop_office', 'labels'];
const MANAGED_ONLY: ReadonlySet<UseCheckId> = new Set(['device', 'desktop_office', 'labels']);
/** Not readable from Microsoft's usage records yet: always Unknown until a reviewed source is added. */
const NOT_MEASURED: ReadonlySet<UseCheckId> = new Set(['labels', 'loop']);
/** Microsoft's own application id for My Apps (myapps.microsoft.com), as it appears in the Entra sign-in log. */
export const MY_APPS_APP_ID = '2793995e-0a7d-40d7-bd35-6968ba142197';

/**
 * The Microsoft plan on a person's licence (Fauzan, 23 Nov 2026: "full use of microsoft we buy"): Business Premium
 * (or E3/E5), Business Basic with the Entra ID P1 add-on, Business Basic alone, or something else.
 */
export type UsePlan = 'premium' | 'basic_p1' | 'basic' | 'other';
export const USE_PLAN_LABEL: Record<UsePlan, string> = { premium: 'Premium', basic_p1: 'Basic + P1', basic: 'Basic', other: 'Other' };
/** What each plan should give the person, shown with their checklist. */
export const USE_PLAN_GIVES: Record<UsePlan, { bm: string; en: string }> = {
  premium: { bm: 'Pelan anda: Business Premium. Termasuk Authenticator, tukar kata laluan sendiri, My Apps, laptop dan telefon diurus IT, Office desktop dan label "Confidential".', en: 'Your plan: Business Premium. It includes Authenticator, self-service password reset, My Apps, IT-managed laptop and phone, desktop Office and "Confidential" labels.' },
  basic_p1: { bm: 'Pelan anda: Business Basic dengan Entra ID P1. Termasuk Authenticator, tukar kata laluan sendiri, My Apps, Teams, Outlook dan OneDrive dalam pelayar.', en: 'Your plan: Business Basic with Entra ID P1. It includes Authenticator, self-service password reset, My Apps, and Teams, Outlook and OneDrive in the browser.' },
  basic: { bm: 'Pelan anda: Business Basic. Termasuk Teams, Outlook dan OneDrive dalam pelayar, Authenticator dan My Apps.', en: 'Your plan: Business Basic. It includes Teams, Outlook and OneDrive in the browser, Authenticator and My Apps.' },
  other: { bm: 'Pelan anda bukan Business Basic atau Premium. Tanya IT apa yang termasuk.', en: 'Your plan is not Business Basic or Premium. Ask IT what it includes.' },
};

/** Short how-to per check, Bahasa Melayu first (staff screens default to BM). No AI tool is named. */
export const USE_HOWTO: Record<UseCheckId, { title: string; bm: string; en: string }> = {
  prima_signin: { title: 'Prima with Microsoft sign-in', bm: 'Masuk ke Prima dengan akaun Microsoft kerja anda (butang "Masuk dengan Microsoft"), bukan kata laluan lain.', en: 'Sign in to Prima with your work Microsoft account (the "Sign in with Microsoft" button), not another password.' },
  authenticator: { title: 'Microsoft Authenticator', bm: 'Pasang Microsoft Authenticator di telefon dan daftar di mysignins.microsoft.com. IT boleh bantu 15 minit.', en: 'Install Microsoft Authenticator on your phone and register at mysignins.microsoft.com. IT can help in 15 minutes.' },
  password_reset: { title: 'Password reset', bm: 'Daftar untuk tukar kata laluan sendiri di mysignins.microsoft.com, supaya tidak perlu tunggu IT.', en: 'Register for self-service password reset at mysignins.microsoft.com, so you never wait for IT.' },
  my_apps: { title: 'My Apps', bm: 'Buka Prima dan portal kerja dari myapps.microsoft.com. Jangan kongsi kata laluan.', en: 'Open Prima and work portals from myapps.microsoft.com. Never share a password.' },
  teams: { title: 'Teams', bm: 'Guna Teams untuk chat dan mesyuarat kerja, bukan WhatsApp.', en: 'Use Teams for work chat and meetings, not WhatsApp.' },
  outlook: { title: 'Outlook', bm: 'Guna e-mel kerja dalam Outlook untuk urusan rasmi.', en: 'Use your work e-mail in Outlook for official matters.' },
  mailbox: { title: 'Mailbox space', bm: 'Peti e-mel hampir penuh. Padam atau arkib e-mel lama, atau minta IT bantu.', en: 'Your mailbox is nearly full. Delete or archive old e-mail, or ask IT.' },
  onedrive: { title: 'OneDrive', bm: 'Simpan fail kerja sendiri dalam OneDrive, bukan hanya dalam laptop, supaya tidak hilang.', en: 'Save your own work files in OneDrive, not only on the laptop, so they are never lost.' },
  sharepoint: { title: 'SharePoint', bm: 'Buka dan kemas kini fail bersama syarikat atau jabatan dalam SharePoint, bukan hantar melalui WhatsApp atau e-mel. IT boleh tunjuk 15 minit.', en: 'Open and update your company or department shared files in SharePoint, instead of sending copies by WhatsApp or e-mail. IT can show you in 15 minutes.' },
  onenote: { title: 'OneNote', bm: 'Simpan nota mesyuarat dan nota kerja dalam OneNote buku nota pasukan, bukan kertas atau WhatsApp.', en: 'Keep meeting and work notes in a team OneNote notebook, not on paper or WhatsApp.' },
  loop: { title: 'Loop', bm: 'Guna komponen Loop dalam Teams atau Outlook untuk senarai tugas dan catatan bersama yang dikemas kini serentak.', en: 'Use Loop components in Teams or Outlook for shared task lists and notes that everyone updates at the same time.' },
  device: { title: 'Managed laptop and phone', bm: 'Laptop atau telefon syarikat belum diurus oleh IT (Intune). IT akan aturkan 15 minit.', en: 'Your company laptop or phone is not managed by IT (Intune) yet. IT will book 15 minutes.' },
  desktop_office: { title: 'Desktop Office', bm: 'Pasang Word, Excel dan Outlook versi desktop dari office.com.', en: 'Install desktop Word, Excel and Outlook from office.com.' },
  labels: { title: '"Confidential" labels', bm: 'Letak label "Confidential" pada fail gaji, tender dan HR.', en: 'Put a "Confidential" label on salary, tender and HR files.' },
};

/** A how-to step, BM then English. */
export interface UseStep { bm: string; en: string }
const st = (bm: string, en: string): UseStep => ({ bm, en });

/**
 * Step-by-step help for each check (Fauzan, 23 Nov 2026: "Make sure guide can help them to do microsoft. Or help them
 * to do it."). Each check has short numbered steps, the official Microsoft page to open, and whether IT can do it with
 * the person. No step ever asks for a password or a sign-in code to be shared: IT never needs them.
 */
export const USE_STEPS: Record<UseCheckId, { steps: UseStep[]; link: { url: string; label: string } | null; itHelps: string }> = {
  prima_signin: {
    steps: [st('Buka Prima dan tekan "Masuk dengan Microsoft".', 'Open Prima and press "Sign in with Microsoft".'), st('Pilih akaun kerja anda (nama@syarikat).', 'Choose your work account (name@company).'), st('Jika Prima kata akaun belum dipautkan, tekan "Minta IT bantu".', 'If Prima says the account is not linked yet, press "Ask IT to help".')],
    link: null,
    itHelps: 'IT links your Prima sign-in to your Microsoft account.',
  },
  authenticator: {
    steps: [st('Pasang Microsoft Authenticator dari Play Store atau App Store.', 'Install Microsoft Authenticator from the Play Store or App Store.'), st('Di komputer, buka mysignins.microsoft.com dan pilih "Tambah kaedah" > Authenticator.', 'On a computer, open mysignins.microsoft.com and choose "Add method" > Authenticator.'), st('Imbas kod QR dengan telefon, kemudian luluskan nombor yang dipaparkan.', 'Scan the QR code with your phone, then approve the number shown.')],
    link: { url: 'https://mysignins.microsoft.com/security-info', label: 'mysignins.microsoft.com' },
    itHelps: 'IT sits with you for 15 minutes to set it up on your phone.',
  },
  password_reset: {
    steps: [st('Buka mysignins.microsoft.com.', 'Open mysignins.microsoft.com.'), st('Tambah nombor telefon atau e-mel peribadi untuk tukar kata laluan sendiri.', 'Add a phone number or personal e-mail for resetting your own password.'), st('Lain kali lupa kata laluan, tekan "Lupa kata laluan?" di skrin masuk.', 'Next time you forget, press "Forgot password?" on the sign-in screen.')],
    link: { url: 'https://mysignins.microsoft.com/security-info', label: 'mysignins.microsoft.com' },
    itHelps: 'IT shows you how to register in 5 minutes.',
  },
  my_apps: {
    steps: [st('Buka myapps.microsoft.com (simpan sebagai penanda halaman).', 'Open myapps.microsoft.com (save it as a bookmark).'), st('Tekan jubin Prima atau portal kerja untuk masuk terus.', 'Press the Prima or work portal tile to go straight in.'), st('Jika jubin tiada, minta IT tambah untuk kumpulan anda.', 'If a tile is missing, ask IT to add it for your group.')],
    link: { url: 'https://myapps.microsoft.com', label: 'myapps.microsoft.com' },
    itHelps: 'IT adds the tiles your job needs.',
  },
  teams: {
    steps: [st('Pasang Teams di telefon dan komputer, masuk dengan akaun kerja.', 'Install Teams on your phone and computer and sign in with your work account.'), st('Buka pasukan syarikat atau jabatan anda.', 'Open your company or department team.'), st('Hantar mesej kerja dan buat mesyuarat di sini, bukan WhatsApp.', 'Send work messages and hold meetings here, not WhatsApp.')],
    link: { url: 'https://teams.microsoft.com', label: 'teams.microsoft.com' },
    itHelps: 'IT installs Teams and adds you to the right team.',
  },
  outlook: {
    steps: [st('Pasang Outlook di telefon, atau buka outlook.office.com.', 'Install Outlook on your phone, or open outlook.office.com.'), st('Masuk dengan akaun kerja anda.', 'Sign in with your work account.'), st('Guna e-mel kerja untuk urusan rasmi, bukan e-mel peribadi.', 'Use work e-mail for official matters, not personal e-mail.')],
    link: { url: 'https://outlook.office.com', label: 'outlook.office.com' },
    itHelps: 'IT sets up Outlook on your phone and computer.',
  },
  mailbox: {
    steps: [st('Dalam Outlook, kosongkan folder Deleted Items dan Junk.', 'In Outlook, empty the Deleted Items and Junk folders.'), st('Cari e-mel besar (Susun ikut Saiz) dan simpan lampirannya ke OneDrive.', 'Find large e-mails (Sort by Size) and save attachments to OneDrive.'), st('Padam e-mel yang tidak diperlukan lagi.', 'Delete e-mails you no longer need.')],
    link: { url: 'https://outlook.office.com', label: 'outlook.office.com' },
    itHelps: 'IT can turn on the online archive for you.',
  },
  onedrive: {
    steps: [st('Buka OneDrive di komputer (ikon awan) dan masuk dengan akaun kerja.', 'Open OneDrive on your computer (cloud icon) and sign in with your work account.'), st('Alihkan fail kerja dari Desktop dan Documents ke folder OneDrive.', 'Move work files from Desktop and Documents into the OneDrive folder.'), st('Fail selamat walaupun laptop rosak atau hilang.', 'Your files are safe even if the laptop breaks or is lost.')],
    link: { url: 'https://www.office.com/launch/onedrive', label: 'OneDrive' },
    itHelps: 'IT turns on folder backup so it happens by itself.',
  },
  sharepoint: {
    steps: [st('Buka laman SharePoint syarikat atau jabatan anda (dari Teams > Files, atau My Apps).', 'Open your company or department SharePoint site (from Teams > Files, or My Apps).'), st('Buka dan kemas kini fail di sana, jangan muat turun dan hantar salinan.', 'Open and update the files there; do not download and send copies.'), st('Untuk bukti dalam Prima, tampal pautan fail SharePoint.', 'For proof in Prima, paste the SharePoint file link.')],
    link: { url: 'https://www.office.com/launch/sharepoint', label: 'SharePoint' },
    itHelps: 'IT gives you access to your team site and shows you around.',
  },
  onenote: {
    steps: [st('Buka OneNote dari Teams (tab Notes) atau office.com.', 'Open OneNote from Teams (Notes tab) or office.com.'), st('Guna buku nota pasukan untuk nota mesyuarat dan tugasan.', 'Use the team notebook for meeting notes and tasks.'), st('Semua ahli pasukan nampak nota yang sama.', 'Everyone in the team sees the same notes.')],
    link: { url: 'https://www.onenote.com/notebooks', label: 'OneNote' },
    itHelps: 'IT creates the team notebook.',
  },
  loop: {
    steps: [st('Dalam chat Teams atau e-mel Outlook, tekan ikon Loop.', 'In a Teams chat or Outlook e-mail, press the Loop icon.'), st('Pilih senarai tugas atau jadual.', 'Choose a task list or table.'), st('Semua orang kemas kini senarai yang sama, serentak.', 'Everyone updates the same list at the same time.')],
    link: { url: 'https://loop.cloud.microsoft', label: 'Loop' },
    itHelps: 'IT shows your team how to use Loop lists.',
  },
  device: {
    steps: [st('Bawa laptop atau telefon syarikat kepada IT.', 'Bring your company laptop or phone to IT.'), st('IT daftarkan peranti supaya ia selamat dan dikemas kini sendiri.', 'IT enrols the device so it stays secure and updates itself.'), st('Fail peribadi anda tidak dibaca.', 'Your personal files are not read.')],
    link: null,
    itHelps: 'IT enrols your device (about 15 minutes).',
  },
  desktop_office: {
    steps: [st('Buka office.com dan masuk dengan akaun kerja.', 'Open office.com and sign in with your work account.'), st('Tekan "Pasang aplikasi" > Microsoft 365 apps.', 'Press "Install apps" > Microsoft 365 apps.'), st('Buka Word sekali untuk aktifkan.', 'Open Word once to activate it.')],
    link: { url: 'https://www.office.com', label: 'office.com' },
    itHelps: 'IT installs Office for you.',
  },
  labels: {
    steps: [st('Dalam Word atau Excel, tekan butang Sensitivity di atas.', 'In Word or Excel, press the Sensitivity button at the top.'), st('Pilih "Confidential" untuk fail gaji, tender dan HR.', 'Choose "Confidential" for salary, tender and HR files.'), st('Simpan fail seperti biasa.', 'Save the file as usual.')],
    link: null,
    itHelps: 'IT shows you where the label button is.',
  },
};

/** What the daily read brings back from Microsoft. A source that could not be read is null (its checks are Unknown). */
export interface UsageSources {
  /** Microsoft's report date (reports run about 2 days behind). */
  refreshed: IsoDate | null;
  /** Sign-in method registrations: links each Microsoft account id to its sign-in name. */
  registrations: { oid: string; upn: string; mfa: boolean; sspr: boolean }[] | null;
  /** Active users report: last activity dates and the products on each licence. */
  active: { upn: string; products: string; exchange: IsoDate | null; oneDrive: IsoDate | null; sharePoint: IsoDate | null; teams: IsoDate | null }[] | null;
  mailbox: { upn: string; used: number; prohibitSend: number }[] | null;
  /** Microsoft 365 apps usage report: who used OneNote (any platform) in the window. Absent or null = Unknown. */
  apps?: { upn: string; oneNote: boolean }[] | null;
  /** SharePoint activity report: last activity and how many shared files were opened or edited. Absent or null = use the active users report. */
  sharePoint?: { upn: string; last: IsoDate | null; viewedOrEdited: number }[] | null;
  activations: { upn: string; productType: string; windows: number; mac: number }[] | null;
  /** Intune devices: the owner's Microsoft account id and whether the device meets the rules. */
  devices: { oid: string; compliant: boolean }[] | null;
  /** Entra sign-in log, My Apps only: the Microsoft account id and the day of each sign-in. Absent or null = Unknown. */
  myApps?: { oid: string; day: IsoDate }[] | null;
  /** Entra sign-in log, Prima's own app only: the Microsoft account id and the day of each sign-in. Absent or null = Unknown. */
  primaSignIns?: { oid: string; day: IsoDate }[] | null;
}

export interface PersonUsage {
  userId: string;
  /** Has a linked Microsoft account in Prima. Without one nothing can be measured. */
  linked: boolean;
  /** On a managed plan (Business Premium, E3 or E5); null when unknown. */
  managed: boolean | null;
  checks: Partial<Record<UseCheckId, UseStatus>>;
  /** No use of Outlook, Teams, OneDrive or SharePoint in the idle window: the licence could move to someone else. */
  idle: boolean;
  /** The plan on the licence; null when unknown. Absent on days stored before this was read. */
  plan?: UsePlan | null;
  /** A Premium licence whose Premium-only features (managed device and desktop Office) are both unused. */
  premiumUnused?: boolean;
}

export interface UsageSnapshot {
  asOf: IsoDate;
  refreshed: IsoDate | null;
  /** Microsoft still hides names in its reports, so nobody could be matched (IT turns names on after the PDPA officer agrees). */
  namesHidden: boolean;
  people: PersonUsage[];
}

const OFFICE_ROLES: ReadonlySet<User['role']> = new Set(['director', 'pwvsb_officer', 'company_manager', 'admin_exec']);

/** Office staff the board covers: an open office sign-in, never guards, site devices or connected systems. */
export function usageCovered(u: User, today: IsoDate): boolean {
  return !u.integration && OFFICE_ROLES.has(u.role) && !accessClosed(u, today);
}

const DAY = 86_400_000;
function daysBefore(day: IsoDate, n: number): IsoDate {
  return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
}
const recent = (d: IsoDate | null, since: IsoDate) => !!d && d >= since;
const lower = (s: string) => s.trim().toLowerCase();
const words = (list: readonly string[]) => new RegExp(`\\b(${list.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');

/** Reads the plan from the "Assigned Products" text of Microsoft's active users report. */
export function usagePlan(products: string): UsePlan {
  const cfg = RULES.m365Use.value;
  if (words(cfg.managedProducts).test(products)) return 'premium';
  if (/\bBUSINESS BASIC\b/i.test(products)) return words(cfg.p1Products).test(products) ? 'basic_p1' : 'basic';
  return 'other';
}

/** Builds each covered person's checklist from the sources. Pure: same input, same answer. */
export function buildUsage(users: User[], src: UsageSources, today: IsoDate): UsageSnapshot {
  const cfg = RULES.m365Use.value;
  const since = daysBefore(today, cfg.activeWithinDays);
  const idleSince = daysBefore(today, cfg.idleDays);
  const regByOid = new Map((src.registrations ?? []).map((r) => [lower(r.oid), r]));
  const activeByUpn = new Map((src.active ?? []).map((r) => [lower(r.upn), r]));
  const mailByUpn = new Map((src.mailbox ?? []).map((r) => [lower(r.upn), r]));
  const spByUpn = new Map((src.sharePoint ?? []).map((r) => [lower(r.upn), r]));
  const appsByUpn = new Map((src.apps ?? []).map((r) => [lower(r.upn), r]));
  const actsByUpn = new Map<string, NonNullable<UsageSources['activations']>>();
  for (const a of src.activations ?? []) actsByUpn.set(lower(a.upn), [...(actsByUpn.get(lower(a.upn)) ?? []), a]);
  const devByOid = new Map<string, boolean[]>();
  for (const d of src.devices ?? []) devByOid.set(lower(d.oid), [...(devByOid.get(lower(d.oid)) ?? []), d.compliant]);
  const latestByOid = (rows: { oid: string; day: IsoDate }[] | null | undefined) => {
    const m = new Map<string, IsoDate>();
    for (const r of rows ?? []) if (r.day > (m.get(lower(r.oid)) ?? '')) m.set(lower(r.oid), r.day);
    return m;
  };
  const myAppsByOid = latestByOid(src.myApps);
  const primaByOid = latestByOid(src.primaSignIns);

  const regUpns = new Set((src.registrations ?? []).map((r) => lower(r.upn)));
  const anyMatch = (src.active ?? []).some((r) => regUpns.has(lower(r.upn)));
  const namesHidden = !!src.active?.length && !!src.registrations?.length && !anyMatch;

  const people = users
    .filter((u) => usageCovered(u, today))
    .map((u): PersonUsage => {
      const oid = u.entraOid ? lower(u.entraOid) : null;
      if (!oid) return { userId: u.id, linked: false, managed: null, checks: {}, idle: false, plan: null, premiumUnused: false };
      const reg = regByOid.get(oid);
      const upn = reg ? lower(reg.upn) : null;
      const act = upn ? activeByUpn.get(upn) : undefined;
      const plan = act ? usagePlan(act.products) : null;
      const managed = plan ? plan === 'premium' : null;
      const checks: Partial<Record<UseCheckId, UseStatus>> = {};
      const set = (id: UseCheckId, v: UseStatus) => {
        if (MANAGED_ONLY.has(id) && managed !== true) return;
        checks[id] = NOT_MEASURED.has(id) ? 'unknown' : v;
      };
      set('prima_signin', !src.primaSignIns ? 'unknown' : recent(primaByOid.get(oid) ?? null, since) ? 'ok' : 'missing');
      set('authenticator', !src.registrations || !reg ? 'unknown' : reg.mfa ? 'ok' : 'missing');
      set('password_reset', !src.registrations || !reg ? 'unknown' : reg.sspr ? 'ok' : 'missing');
      set('my_apps', !src.myApps ? 'unknown' : recent(myAppsByOid.get(oid) ?? null, since) ? 'ok' : 'missing');
      set('teams', !act ? 'unknown' : recent(act.teams, since) ? 'ok' : 'missing');
      set('outlook', !act ? 'unknown' : recent(act.exchange, since) ? 'ok' : 'missing');
      set('onedrive', !act ? 'unknown' : recent(act.oneDrive, since) ? 'ok' : 'missing');
      // SharePoint: shared company or department files opened or edited in the window. The activity report counts files;
      // without it, the last SharePoint date in the active users report is used.
      const sp = upn && src.sharePoint ? spByUpn.get(upn) : undefined;
      set('sharepoint', src.sharePoint && upn ? (sp && sp.viewedOrEdited > 0 && recent(sp.last, since) ? 'ok' : 'missing') : !act ? 'unknown' : recent(act.sharePoint, since) ? 'ok' : 'missing');
      set('onenote', !src.apps || !upn ? 'unknown' : appsByUpn.get(upn)?.oneNote ? 'ok' : 'missing');
      // Loop: Microsoft has no per-person Loop usage report yet, so it stays Unknown (how-to only).
      set('loop', 'unknown');
      const box = upn && src.mailbox ? mailByUpn.get(upn) : undefined;
      set('mailbox', !box || !(box.prohibitSend > 0) ? 'unknown' : (box.used / box.prohibitSend) * 100 < cfg.mailboxFullPct ? 'ok' : 'missing');
      const devs = src.devices ? devByOid.get(oid) ?? [] : null;
      set('device', !devs ? 'unknown' : devs.some(Boolean) ? 'ok' : 'missing');
      const acts = upn && src.activations ? actsByUpn.get(upn) ?? [] : null;
      set('desktop_office', !acts ? 'unknown' : acts.some((a) => a.windows + a.mac > 0) ? 'ok' : 'missing');
      set('labels', 'unknown');
      const idle = !!act && ![act.exchange, act.teams, act.oneDrive, act.sharePoint].some((d) => recent(d, idleSince));
      const premiumUnused = managed === true && checks.device === 'missing' && checks.desktop_office === 'missing';
      return { userId: u.id, linked: true, managed, checks, idle, plan, premiumUnused };
    });
  return { asOf: today, refreshed: src.refreshed, namesHidden, people };
}

/** Share of measured checks that are done (Unknown is left out); null when nothing could be measured. */
export function usageScore(p: PersonUsage): number | null {
  const measured = Object.values(p.checks).filter((s) => s !== 'unknown');
  if (!measured.length) return null;
  return Math.round((measured.filter((s) => s === 'ok').length / measured.length) * 100);
}

/** Department a head looks after: their own department's staff (and a Finance team leader their own team). */
function headOf(u: User): { department: NonNullable<User['department']>; financeTeam?: number } | null {
  if (u.role !== 'pwvsb_officer' || !u.department) return null;
  if (u.department === 'it' && u.itRole === 'manager') return { department: 'it' };
  if (u.department === 'fwm' && u.fwmRole === 'manager') return { department: 'fwm' };
  if (u.department === 'procurement' && u.procRole === 'manager') return { department: 'procurement' };
  if (u.department === 'asset' && u.assetRole === 'director') return { department: 'asset' };
  if (u.department === 'audit' && (u.actRole === 'lead' || u.actRole === 'manager')) return { department: 'audit' };
  if (u.department === 'finance' && u.financeRole === 'leader' && u.financeTeam != null) return { department: 'finance', financeTeam: u.financeTeam };
  return null;
}

/**
 * Who sees whom (the same walls as the rest of Prima): group leaders, IT and the ACT head or manager see everyone;
 * a Company Manager sees the office staff of their own companies; a department head their own department; everyone
 * else only themselves.
 */
export function usageSeesAll(viewer: User): boolean {
  if (viewer.integration) return false;
  return isGroupLeader(viewer) || (viewer.role === 'pwvsb_officer' && viewer.department === 'it') || isActHead(viewer) || (viewer.role === 'pwvsb_officer' && viewer.department === 'audit' && viewer.actRole === 'manager');
}

export function usageVisible(viewer: User, person: User): boolean {
  if (viewer.integration) return false;
  if (viewer.id === person.id) return true;
  if (usageSeesAll(viewer)) return true;
  if (viewer.role === 'company_manager')
    return (person.role === 'company_manager' || person.role === 'admin_exec') && person.companyIds.some((c) => viewer.companyIds.includes(c));
  const head = headOf(viewer);
  if (head && person.role === 'pwvsb_officer' && person.department === head.department)
    return head.financeTeam == null || person.financeTeam === head.financeTeam;
  return false;
}

export interface UsageGroupLine { key: string; people: number; score: number | null; setupMissing: number; idle: number; premiumUnused: number }

/** How many of the given people hold each plan (unknown plans are left out). */
export function usagePlanCounts(rows: PersonUsage[]): Record<UsePlan, number> {
  const out: Record<UsePlan, number> = { premium: 0, basic_p1: 0, basic: 0, other: 0 };
  for (const r of rows) if (r.plan) out[r.plan]++;
  return out;
}

/** Scores per company and per department over the people the viewer may see. */
export function usageSummary(rows: { person: User; usage: PersonUsage }[]): { companies: UsageGroupLine[]; departments: UsageGroupLine[] } {
  const groups = (keyOf: (u: User) => string[]) => {
    const m = new Map<string, { person: User; usage: PersonUsage }[]>();
    for (const r of rows) for (const k of keyOf(r.person)) m.set(k, [...(m.get(k) ?? []), r]);
    return [...m.entries()]
      .map(([key, rs]): UsageGroupLine => {
        const scores = rs.map((r) => usageScore(r.usage)).filter((s): s is number => s != null);
        return {
          key,
          people: rs.length,
          score: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
          setupMissing: rs.filter((r) => !r.usage.linked || r.usage.checks.authenticator === 'missing' || r.usage.checks.password_reset === 'missing').length,
          idle: rs.filter((r) => r.usage.idle).length,
          premiumUnused: rs.filter((r) => r.usage.premiumUnused).length,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  };
  return {
    companies: groups((u) => (u.role === 'company_manager' || u.role === 'admin_exec' ? u.companyIds : [])),
    departments: groups((u) => (u.role === 'pwvsb_officer' && u.department ? [u.department] : [])),
  };
}

/** Minimal CSV reader for Microsoft's report files (quoted fields, commas and line breaks inside quotes, a BOM). */
export function parseReportCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

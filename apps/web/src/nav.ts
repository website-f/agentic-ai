import {
  AddressBookIcon,
  ChartPieSliceIcon,
  ListChecksIcon,
  CalendarDotsIcon,
  BrainIcon,
  BooksIcon,
  BookOpenTextIcon,
  BookBookmarkIcon,
  PresentationIcon,
  BlueprintIcon,
  FlowArrowIcon,
  FileMagnifyingGlassIcon,
  FileTextIcon,
  FilesIcon,
  FolderOpenIcon,
  IdentificationCardIcon,
  PackageIcon,
  StackIcon,
  BroadcastIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  ChatsCircleIcon,
  TreeStructureIcon,
  ClockCounterClockwiseIcon,
  DeskIcon,
  DesktopTowerIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  CpuIcon,
  ChartBarIcon,
  ChartLineUpIcon,
  ClipboardTextIcon,
  CoinsIcon,
  LockKeyIcon,
  NotepadIcon,
  GaugeIcon,
  GearSixIcon,
  HardDrivesIcon,
  ScalesIcon,
  GraduationCapIcon,
  HandshakeIcon,
  KanbanIcon,
  LightningIcon,
  PlugsConnectedIcon,
  PuzzlePieceIcon,
  SealCheckIcon,
  SparkleIcon,
  UsersIcon,
  UsersThreeIcon,
  UserFocusIcon,
  TargetIcon,
  type Icon,
} from "@phosphor-icons/react";

import { msg } from "@/i18n";

export type AppPath =
  | "/"
  | "/assistants"
  | "/twin"
  | "/my-worker"
  | "/computers"
  | "/workspace"
  | "/forms"
  | "/overview"
  | "/impact"
  | "/reports"
  | "/company-kit"
  | "/files"
  | "/search"
  | "/templates"
  | "/documents"
  | "/packs"
  | "/logins"
  | "/office"
  | "/monitor"
  | "/agents"
  | "/tasks"
  | "/objectives"
  | "/approvals"
  | "/mail"
  | "/contacts"
  | "/crm"
  | "/start"
  | "/deals"
  | "/money"
  | "/chat"
  | "/meetings"
  | "/broadcasts"
  | "/brain"
  | "/sops"
  | "/library"
  | "/skills"
  | "/learning"
  | "/blueprints"
  | "/workflows"
  | "/schedules"
  | "/ai-engine"
  | "/mcp-servers"
  | "/channels"
  | "/organization"
  | "/activity"
  | "/settings"
  | "/settings/members"
  | "/settings/ai-use"
  | "/settings/storage"
  | "/settings/approval-limits"
  | "/timetable"
  | "/tutorial"
  | "/guide"
  | "/present";

export interface NavItem {
  to: AppPath;
  label: string;
  icon: Icon;
  /** Roadmap phase that ships this page; absent = live now. */
  phase?: string;
  blurb: string;
  /** Permission needed to see it in navigation (any of them, when a list). */
  perm?: string | string[];
  /** Other addresses that count as this entry (a page's second tab). */
  also?: AppPath[];
  /** Reached from another entry (a tab of it): known to page headers, not listed. */
  hidden?: boolean;
  /** A shorter name for the phone's bottom bar. */
  short?: string;
  /** P49: a page few people need: listed only when "Show all pages" is on (still searchable
   * and reachable by its address). */
  advanced?: boolean;
}

export interface NavSection {
  title: string;
  /** One plain sentence: what this group is for, for people new to the app. */
  hint: string;
  items: NavItem[];
  /** Open in the sidebar at first: for everyone, only for people who manage, or folded. */
  open: "all" | "managers" | "none";
}

// Titles, labels, hints and blurbs are English keys (msg); render them with t().
// P49: grouped the way a business owner thinks, not the way the system is built: today, the
// work, customers and money, the Library, the AI team, and settings folded away. Pages few
// people need are "advanced": hidden until "Show all pages", always searchable.
export const NAV: NavSection[] = [
  {
    title: msg("Today"),
    hint: msg("Your own desk, your AI, and the whole office at a glance."),
    open: "all",
    items: [
      { to: "/workspace", label: msg("My workspace"), short: msg("My desk"), icon: DeskIcon, blurb: msg("Your own desk: ask or search anything, your pinned SOPs and workflows, your AI workers, the work you gave and every file it produced.") },
      { to: "/", label: msg("Command center"), icon: GaugeIcon, perm: "office.view", also: ["/overview"], blurb: msg("Today at a glance: system health, organization and what to do next.") },
      { to: "/overview", label: msg("Company overview"), icon: ChartBarIcon, perm: "office.view", hidden: true, blurb: msg("Every branch side by side: work by type, what is failing or waiting, and spend, with an AI briefing.") },
      // P30: one entry for a person's one personal AI, their twin. Today (/my-worker) and its
      // chat, tasks, memory, teaching and profile (/twin) are tabs of it.
      { to: "/my-worker", label: msg("My AI"), icon: UserFocusIcon, perm: "agents.own", also: ["/twin"], blurb: msg("Your AI twin, the one AI that works for you: what it is doing today, chat with it, its tasks, what it knows, teaching it and its profile.") },
      { to: "/twin", label: msg("My twin"), icon: UserFocusIcon, perm: "agents.own", hidden: true, blurb: msg("Your AI twin: your virtual self at work. It handles routine tasks the way you would, and asks you before anything important.") },
      // Private assistants are for people who manage others (assistants.use); staff have their twin.
      { to: "/assistants", label: msg("My assistants"), icon: SparkleIcon, perm: "assistants.use", blurb: msg("Your own private AI assistants: the whole company at a glance, your Gmail with drafts you approve, and chasing people on WhatsApp.") },
      // P31: the person's own computers, for their own AI (twin or private assistant) only.
      { to: "/computers", label: msg("My computers"), icon: DesktopTowerIcon, perm: ["agents.own", "assistants.use"], blurb: msg("Let your own AI find files on your computer and browse on your screen. Only your AI can use it, only in the folders you choose.") },
    ],
  },
  {
    title: msg("Work"),
    hint: msg("Give work, answer what the AI asks you, and follow it to done."),
    open: "all",
    items: [
      { to: "/tasks", label: msg("Tasks"), icon: KanbanIcon, blurb: msg("A board of everything your agents are working on, from triage to done. Drag a card between columns to move it along.") },
      { to: "/approvals", label: msg("Approvals"), icon: SealCheckIcon, blurb: msg("Decisions agents are waiting on. Approve once, always, or deny, from here or from a phone notification.") },
      { to: "/chat", label: msg("Chat"), icon: ChatsCircleIcon, blurb: msg("Talk to any agent directly, by typing or with your voice, and pick up past conversations.") },
      // P34: what came into Outlook and the shared mailboxes, and what the AI did with each.
      { to: "/mail", label: msg("Microsoft 365"), icon: EnvelopeSimpleIcon, perm: ["agents.own", "assistants.use", "channels.manage"], blurb: msg("Your own Outlook mail, calendar and Teams chats, and the company's shared mailboxes: what reached you and what your AI did with each, from your own connection.") },
      { to: "/forms", label: msg("Forms"), icon: NotepadIcon, blurb: msg("Claims, advances, monthly records and requests: download the blank, hand it in before the deadline, or let your AI worker fill it in. Managers see who handed in.") },
      { to: "/reports", label: msg("Reports"), icon: ClipboardTextIcon, blurb: msg("What agents wrote up for you: summaries and tables you can sort and download.") },
      { to: "/workflows", label: msg("Workflows"), icon: FlowArrowIcon, perm: ["agents.manage", "agents.own", "work.write"], blurb: msg("Draw how a job is done as connected steps, or let an analyst agent draft it. Attach it to agents as their procedure, or run a job through it: each step goes to its agent, and you take the decisions.") },
      { to: "/objectives", advanced: true, label: msg("Objectives"), icon: TargetIcon, perm: "office.view", blurb: msg("What the company's work is for: progress, due dates and what each goal cost, including everything its tasks handed out. Agents see why linked work matters.") },
    ],
  },
  {
    title: msg("Customers and money"),
    hint: msg("Everything about your customers, sales and money in one place."),
    open: "all",
    items: [
      { to: "/crm", label: msg("CRM"), icon: ChartPieSliceIcon, perm: "crm.access", blurb: msg("Everything about your business in one place: customers, sales, money, work and anything else you track, with data from your other systems. Yours alone until you share parts of it.") },
      { to: "/contacts", label: msg("Contacts"), icon: AddressBookIcon, blurb: msg("Customers, suppliers, partners and leads: their people, TIN and SSM, every mail, task, invoice and deal with them, and what they owe.") },
      { to: "/deals", label: msg("Deals"), icon: HandshakeIcon, blurb: msg("The sales pipeline as a board, from lead to won or lost. Drag a deal along as it moves; each stage shows its count and value.") },
      { to: "/money", label: msg("Money"), icon: CoinsIcon, perm: "finance.view", blurb: msg("Invoices customers owe you and bills you owe suppliers (captured from email), what is overdue, the cash coming in and going out, and payment reminders.") },
    ],
  },
  {
    title: msg("Library"),
    hint: msg("Every file, document, SOP and guideline in one place, in folders."),
    open: "all",
    items: [
      { to: "/files", label: msg("Library"), icon: FolderOpenIcon, also: ["/documents", "/sops", "/library", "/templates", "/packs", "/company-kit", "/search"], blurb: msg("Every file, document, SOP and guideline in one place: browse the company's folders, or open Documents, SOPs, Guidelines, Templates, Packs, the Company kit and Search as tabs."), },
      // The Library's tabs: reached from its tab row, found by the command palette.
      { to: "/documents", label: msg("Documents"), icon: FilesIcon, hidden: true, blurb: msg("Documents drafted by people or agents, checked automatically, approved, and exported to PDF, Word or Excel.") },
      { to: "/sops", label: msg("SOPs"), icon: FileTextIcon, hidden: true, blurb: msg("Written procedures agents follow: for every company, one company, one department, or attached to specific agents.") },
      { to: "/library", label: msg("Guidelines"), icon: BooksIcon, hidden: true, blurb: msg("Guidelines, manuals and policies people upload. Agents search them when the work needs it and cite the page.") },
      { to: "/templates", label: msg("Templates"), icon: StackIcon, hidden: true, blurb: msg("Quotations, invoices, letters, proposals and your own Word files, with {{placeholders}} agents and people fill.") },
      { to: "/packs", label: msg("Packs"), icon: PackageIcon, hidden: true, blurb: msg("Submission packs: a checklist matched to real files and documents, compiled into one PDF with a cover and contents.") },
      { to: "/company-kit", label: msg("Company kit"), icon: IdentificationCardIcon, hidden: true, blurb: msg("Each company's facts every document reuses: legal name, registration, address, bank, signatory, logo.") },
      { to: "/search", label: msg("Search inside files"), icon: FileMagnifyingGlassIcon, hidden: true, blurb: msg("Search inside every document: a phrase on page 23 of a handbook, an amount, a form or a job title. Opens the file at the page.") },
    ],
  },
  {
    title: msg("AI team"),
    hint: msg("Your AI agents: who they are, their working day, and what they learned."),
    open: "managers",
    items: [
      { to: "/agents", label: msg("Agents"), icon: UsersThreeIcon, perm: "office.view", blurb: msg("Create agents by hand, place them in a department, give them skills and SOPs, and see who reports to whom.") },
      { to: "/office", label: msg("Office floor"), icon: BuildingsIcon, perm: "office.view", blurb: msg("A live pixel-art office per branch. Every agent sits at a desk in its department and walks to the podium when it needs you.") },
      { to: "/timetable", label: msg("Timetable"), icon: CalendarDotsIcon, perm: "office.view", blurb: msg("Each agent's working day, like a staff rota: its hours, its daily duties, and what waits for its next shift.") },
      { to: "/learning", label: msg("Learning"), icon: GraduationCapIcon, perm: "office.view", blurb: msg("What your agents learned, how each change was tested, what went live by itself, and what learning cost.") },
      { to: "/skills", label: msg("Skills"), icon: LightningIcon, perm: "office.view", blurb: msg("Procedures agents have learned. Review what they propose before it becomes part of how they work.") },
      { to: "/impact", label: msg("Impact"), icon: ChartLineUpIcon, perm: ["org.manage", "team.manage"], blurb: msg("What the AI team measurably did per company and department, the time it freed against what it cost, and what it can do next.") },
      { to: "/blueprints", advanced: true, label: msg("Blueprints"), icon: BlueprintIcon, perm: "agents.manage", blurb: msg("Reusable role packages — instructions, model, tool scope, SOPs and skills — you apply to agents so they start as specialists.") },
      { to: "/brain", advanced: true, label: msg("Brain"), icon: BrainIcon, perm: "office.view", blurb: msg("What the office knows: facts agents learned, wiki pages, and a nightly tidy-up that keeps them correct.") },
      { to: "/monitor", advanced: true, label: msg("Monitor"), icon: EyeIcon, perm: "office.view", blurb: msg("Watch any agent work live: its thinking, every tool it uses, questions to colleagues, and its browser screen.") },
      { to: "/meetings", advanced: true, label: msg("Meetings"), icon: UsersIcon, perm: "office.view", blurb: msg("Watch agents discuss a decision with each other, interject, and read the outcome they agree on.") },
      { to: "/broadcasts", advanced: true, label: msg("Broadcasts"), icon: BroadcastIcon, perm: "office.view", blurb: msg("Message everyone, a branch, a department or picked agents, and see who acknowledged it.") },
    ],
  },
  {
    title: msg("Settings"),
    hint: msg("Set up once: companies, people, AI, connections and limits."),
    open: "none",
    items: [
      { to: "/organization", label: msg("Organization"), icon: TreeStructureIcon, perm: "office.view", blurb: msg("Branches (one per company) and the departments inside them.") },
      { to: "/settings", label: msg("Settings"), icon: GearSixIcon, blurb: msg("Members and roles, appearance and your account.") },
      { to: "/settings/members", label: msg("Members and roles"), icon: UsersIcon, perm: ["members.manage", "team.manage"], hidden: true, blurb: msg("Add teammates and decide what each one can do.") },
      { to: "/settings/ai-use", label: msg("AI use and limits"), icon: CoinsIcon, perm: ["members.manage", "team.manage"], blurb: msg("Each person's daily AI allowance, what staff may use their AI for, and what was refused.") },
      { to: "/settings/approval-limits", label: msg("Approval limits"), icon: ScalesIcon, perm: "org.manage", blurb: msg("Let small, routine money steps go through without waiting for you: bills under an amount from known suppliers, small invoice drafts.") },
      { to: "/channels", label: msg("Channels"), icon: PlugsConnectedIcon, blurb: msg("Phone notifications, Telegram, API tokens, and which agent answers where.") },
      { to: "/ai-engine", label: msg("AI Engine"), icon: CpuIcon, perm: "org.read", blurb: msg("Add provider keys, test the connection, choose models and see what every agent spends.") },
      { to: "/settings/storage", label: msg("File storage"), icon: HardDrivesIcon, perm: "org.manage", blurb: msg("Where company files are kept: the database, this server's disk, a Backblaze B2 or S3 bucket, or your own file server, and what feeds the Library.") },
      { to: "/logins", label: msg("Logins"), icon: LockKeyIcon, perm: ["vault.manage", "vault.own"], blurb: msg("Website logins agents may use without ever seeing them, each locked to its own sites.") },
      { to: "/schedules", advanced: true, label: msg("Schedules"), icon: CalendarCheckIcon, perm: "office.view", blurb: msg("Recurring work and every run's result, with retries and grouped incidents.") },
      { to: "/mcp-servers", advanced: true, label: msg("MCP tools"), icon: PuzzlePieceIcon, perm: "engine.manage", blurb: msg("Connect tools from other systems (MCP): a tracker, a CRM, or your own server. Agents ask before every call.") },
      { to: "/activity", advanced: true, label: msg("Activity"), icon: ClockCounterClockwiseIcon, perm: "audit.read", blurb: msg("Every change made by people and agents, in a tamper-evident log.") },
    ],
  },
  {
    title: msg("Help"),
    hint: msg("Learn the app: ask how, a tutorial for your role, and the full guide."),
    open: "all",
    items: [
      { to: "/start", label: msg("Setting up"), icon: ListChecksIcon, blurb: msg("The few steps that make the office work for you, ticked off as you do them.") },
      { to: "/tutorial", label: msg("Tutorial"), icon: BookOpenTextIcon, blurb: msg("Learn the whole system for your role, step by step: from your first agent to giving tasks and seeing results.") },
      { to: "/guide", label: msg("Guide"), icon: BookBookmarkIcon, blurb: msg("The user guide: every page explained with annotated screenshots, how-to steps and short videos.") },
      { to: "/present", label: msg("Present"), icon: PresentationIcon, blurb: msg("A ready-made presentation of Agentic Office for clients and colleagues, full screen, built from real screenshots.") },
    ],
  },
];

export const ALL_NAV: NavItem[] = NAV.flatMap((s) => s.items);

/** Phone bottom bar: the four things you reach for one-handed, plus More. */
/** P52: pages that belong together share one sidebar entry and show as tabs on each other's
 * page (components/hub-tabs.tsx), so the menu stays short. Each page keeps its own address.
 * The sidebar shows the first tab the person may open, under the hub's name. (The Library is
 * its own hub: pages/library-hub.) */
export interface Hub {
  label: string;
  tabs: AppPath[];
}

export const HUBS: Hub[] = [
  { label: msg("Command center"), tabs: ["/", "/impact"] },
  { label: msg("My AI"), tabs: ["/my-worker", "/assistants", "/computers"] },
  { label: msg("Forms & reports"), tabs: ["/forms", "/reports"] },
  { label: msg("Workflows & goals"), tabs: ["/workflows", "/objectives"] },
  { label: msg("Customers"), tabs: ["/contacts", "/deals"] },
  { label: msg("Agents"), tabs: ["/agents", "/timetable", "/monitor", "/meetings", "/broadcasts"] },
  { label: msg("Knowledge & skills"), tabs: ["/learning", "/skills", "/brain", "/blueprints"] },
  { label: msg("Organization & people"), tabs: ["/organization", "/settings/members", "/settings/ai-use", "/settings/approval-limits"] },
  { label: msg("Settings"), tabs: ["/settings", "/channels", "/ai-engine", "/settings/storage", "/logins", "/schedules", "/mcp-servers", "/activity"] },
  { label: msg("Learn"), tabs: ["/tutorial", "/guide", "/present"] },
];

/** The hub a nav entry is a tab of, if any. */
export function hubOf(to: string): Hub | undefined {
  return HUBS.find((h) => h.tabs.includes(to as AppPath));
}

const navAllowed = (i: NavItem, perms: string[]) => !i.perm || [i.perm].flat().some((p) => perms.includes(p));

/** The hub's tabs this person may open, in order. */
export function hubTabs(hub: Hub, perms: string[]): NavItem[] {
  return hub.tabs.map((to) => ALL_NAV.find((n) => n.to === to)).filter((i): i is NavItem => !!i && navAllowed(i, perms));
}

/** A section's items as the sidebar lists them: each hub once (its first tab the person may
 * open, named after the hub, active on any of its tabs), other items as they are. */
export function sidebarItems(items: NavItem[], perms: string[]): NavItem[] {
  const out: NavItem[] = [];
  for (const i of items) {
    const hub = hubOf(i.to);
    if (!hub) { out.push(i); continue; }
    const first = hubTabs(hub, perms)[0];
    if (!first || first.to !== i.to) continue;
    out.push({ ...i, label: hub.label, hidden: false, advanced: false, also: [...(i.also ?? []), ...hub.tabs.filter((t) => t !== i.to)] });
  }
  return out;
}

/** The Help group: pinned at the foot of the sidebar and at the top of the phone More sheet. */
export const HELP_SECTION = "Help";

export const TAB_BAR: AppPath[] = ["/workspace", "/tasks", "/approvals", "/chat"];

/** The navigation entry a path belongs to (its own page, a tab of it, or a page under it). */
export function navItemFor(pathname: string): NavItem | undefined {
  const hit = (to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`));
  // The longest match wins; at the same length a page's own entry beats a tab of another.
  let best: NavItem | undefined;
  let bestScore = -1;
  for (const item of ALL_NAV) {
    for (const to of [item.to, ...(item.also ?? [])]) {
      const score = to.length * 2 + (to === item.to ? 1 : 0);
      if (hit(to) && score > bestScore) {
        best = item;
        bestScore = score;
      }
    }
  }
  return best;
}

/** May someone with these permissions open this path? The same rule as the sidebar, so a
 * page that is not in someone's navigation cannot be reached by typing its address either. */
export function pathAllowed(pathname: string, permissions: string[]): boolean {
  const item = navItemFor(pathname);
  return !item?.perm || [item.perm].flat().some((p) => permissions.includes(p));
}

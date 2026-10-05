import {
  BrainIcon,
  BriefcaseIcon,
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
  EyeIcon,
  CpuIcon,
  ChartBarIcon,
  ChartLineUpIcon,
  ClipboardTextIcon,
  LockKeyIcon,
  GaugeIcon,
  GearSixIcon,
  GraduationCapIcon,
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
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

// Titles, labels and blurbs are English keys (msg); render them with t().
// Grouped as a top-to-bottom flow: start at Home, look in on the Office and its agents,
// give and track Work, watch them Collaborate, back them with Knowledge, wire up Operations,
// and Admin at the bottom. Each group is one step of running the office.
export const NAV: NavSection[] = [
  {
    title: msg("Home"),
    items: [
      { to: "/", label: msg("Command center"), icon: GaugeIcon, blurb: msg("Today at a glance: system health, organization and what to do next.") },
      { to: "/my-worker", label: msg("My AI worker"), icon: BriefcaseIcon, perm: "agents.own", blurb: msg("The AI worker you hired: what it is doing now, what waits for you, its duties and the hours it works and rests.") },
      { to: "/twin", label: msg("My twin"), icon: UserFocusIcon, perm: "agents.own", blurb: msg("Your AI twin: your virtual self at work. It handles routine tasks the way you would, and asks you before anything important.") },
      { to: "/assistants", label: msg("My assistants"), icon: SparkleIcon, perm: "work.write", blurb: msg("Your own private AI assistants: the whole company at a glance, your Gmail with drafts you approve, and chasing people on WhatsApp.") },
      { to: "/overview", label: msg("Company overview"), icon: ChartBarIcon, blurb: msg("Every branch side by side: work by type, what is failing or waiting, and spend, with an AI briefing.") },
      { to: "/impact", label: msg("Impact"), icon: ChartLineUpIcon, perm: ["org.manage", "team.manage"], blurb: msg("What the AI team measurably did per company and department, the time it freed against what it cost, and what it can do next.") },
    ],
  },
  {
    title: msg("Office"),
    items: [
      { to: "/office", label: msg("Office floor"), icon: BuildingsIcon, blurb: msg("A live pixel-art office per branch. Every agent sits at a desk in its department and walks to the podium when it needs you.") },
      { to: "/monitor", label: msg("Monitor"), icon: EyeIcon, blurb: msg("Watch any agent work live: its thinking, every tool it uses, questions to colleagues, and its browser screen.") },
      { to: "/agents", label: msg("Agents"), icon: UsersThreeIcon, blurb: msg("Create agents by hand, place them in a department, give them skills and SOPs, and see who reports to whom.") },
    ],
  },
  {
    title: msg("Work"),
    items: [
      { to: "/tasks", label: msg("Tasks"), icon: KanbanIcon, blurb: msg("A board of everything your agents are working on, from triage to done. Drag a card between columns to move it along.") },
      { to: "/objectives", label: msg("Objectives"), icon: TargetIcon, blurb: msg("What the company's work is for: progress, due dates and what each goal cost, including everything its tasks handed out. Agents see why linked work matters.") },
      { to: "/approvals", label: msg("Approvals"), icon: SealCheckIcon, blurb: msg("Decisions agents are waiting on. Approve once, always, or deny, from here or from a phone notification.") },
      { to: "/reports", label: msg("Reports"), icon: ClipboardTextIcon, blurb: msg("What agents wrote up for you: summaries and tables you can sort and download.") },
      { to: "/chat", label: msg("Chat"), icon: ChatsCircleIcon, blurb: msg("Talk to any agent directly, by typing or with your voice, and pick up past conversations.") },
    ],
  },
  {
    // Step by step: set up the company once, give the office its files, keep templates,
    // prepare documents, then compile submission packs.
    title: msg("Documents"),
    items: [
      // P25: find anything inside every document, before the step-by-step flow below.
      { to: "/search", label: msg("Search documents"), icon: FileMagnifyingGlassIcon, blurb: msg("Search inside every document: a phrase on page 23 of a handbook, an amount, a form or a job title. Opens the file at the page.") },
      { to: "/company-kit", label: msg("Company kit"), icon: IdentificationCardIcon, blurb: msg("Each company's facts every document reuses: legal name, registration, address, bank, signatory, logo.") },
      { to: "/files", label: msg("Company files"), icon: FolderOpenIcon, blurb: msg("One place per company for all its documents. Drop a folder or a zip: it is kept in folders, read, sorted, and the how-to documents go to the library.") },
      { to: "/templates", label: msg("Templates"), icon: StackIcon, blurb: msg("Quotations, invoices, letters, proposals and your own Word files, with {{placeholders}} agents and people fill.") },
      { to: "/documents", label: msg("Documents"), icon: FilesIcon, blurb: msg("Documents drafted by people or agents, checked automatically, approved, and exported to PDF, Word or Excel.") },
      { to: "/packs", label: msg("Packs"), icon: PackageIcon, blurb: msg("Submission packs: a checklist matched to real files and documents, compiled into one PDF with a cover and contents.") },
    ],
  },
  {
    title: msg("Collaboration"),
    items: [
      { to: "/meetings", label: msg("Meetings"), icon: UsersIcon, blurb: msg("Watch agents discuss a decision with each other, interject, and read the outcome they agree on.") },
      { to: "/broadcasts", label: msg("Broadcasts"), icon: BroadcastIcon, blurb: msg("Message everyone, a branch, a department or picked agents, and see who acknowledged it.") },
    ],
  },
  {
    title: msg("Knowledge"),
    items: [
      { to: "/sops", label: msg("SOPs"), icon: FileTextIcon, blurb: msg("Written procedures agents follow: for every company, one company, one department, or attached to specific agents.") },
      { to: "/library", label: msg("Library"), icon: BooksIcon, blurb: msg("Guidelines, manuals and policies people upload. Agents search them when the work needs it and cite the page.") },
      { to: "/brain", label: msg("Brain"), icon: BrainIcon, blurb: msg("What the office knows: facts agents learned, wiki pages and the nightly dream, in a vault that also opens in Obsidian.") },
      { to: "/skills", label: msg("Skills"), icon: LightningIcon, blurb: msg("Procedures agents have learned. Review what they propose before it becomes part of how they work.") },
      { to: "/learning", label: msg("Learning"), icon: GraduationCapIcon, blurb: msg("What your agents learned, how each change was tested, what went live by itself, and what learning cost.") },
      { to: "/blueprints", label: msg("Blueprints"), icon: BlueprintIcon, perm: ["agents.manage", "agents.own"], blurb: msg("Reusable role packages — instructions, model, tool scope, SOPs and skills — you apply to agents so they start as specialists.") },
      { to: "/workflows", label: msg("Workflows"), icon: FlowArrowIcon, perm: ["agents.manage", "agents.own", "work.write"], blurb: msg("Draw how a job is done as connected steps, or let an analyst agent draft it. Attach it to agents as their procedure, or run a job through it: each step goes to its agent, and you take the decisions.") },
    ],
  },
  {
    title: msg("Operations"),
    items: [
      { to: "/schedules", label: msg("Schedules"), icon: CalendarCheckIcon, blurb: msg("Recurring work and every run's result, with retries and grouped incidents.") },
      { to: "/logins", label: msg("Logins"), icon: LockKeyIcon, perm: ["vault.manage", "vault.own"], blurb: msg("Website logins agents may use without ever seeing them, each locked to its own sites.") },
      { to: "/ai-engine", label: msg("AI Engine"), icon: CpuIcon, perm: "org.read", blurb: msg("Add provider keys, test the connection, choose models and see what every agent spends.") },
      { to: "/mcp-servers", label: msg("MCP tools"), icon: PuzzlePieceIcon, perm: "engine.manage", blurb: msg("Connect external tool servers (MCP) — a tracker, CRM, or a company's own server. Agents reach them through a search-and-call bridge, every call approved.") },
      { to: "/channels", label: msg("Channels"), icon: PlugsConnectedIcon, blurb: msg("Phone notifications, Telegram, API tokens, and which agent answers where.") },
    ],
  },
  {
    title: msg("Admin"),
    items: [
      { to: "/organization", label: msg("Organization"), icon: TreeStructureIcon, blurb: msg("Branches (one per company) and the departments inside them.") },
      { to: "/activity", label: msg("Activity"), icon: ClockCounterClockwiseIcon, perm: "audit.read", blurb: msg("Every change made by people and agents, in a tamper-evident log.") },
      { to: "/settings", label: msg("Settings"), icon: GearSixIcon, blurb: msg("Members and roles, appearance and your account.") },
    ],
  },
  {
    title: msg("Help"),
    items: [
      { to: "/tutorial", label: msg("Tutorial"), icon: BookOpenTextIcon, blurb: msg("Learn the whole system for your role, step by step: from your first agent to giving tasks and seeing results.") },
      { to: "/guide", label: msg("Guide"), icon: BookBookmarkIcon, blurb: msg("The user guide: every page explained with annotated screenshots, how-to steps and short videos.") },
      { to: "/present", label: msg("Present"), icon: PresentationIcon, blurb: msg("A ready-made presentation of Agentic Office for clients and colleagues, full screen, built from real screenshots.") },
    ],
  },
];

export const ALL_NAV: NavItem[] = NAV.flatMap((s) => s.items);

/** Phone bottom bar: the four things you reach for one-handed, plus More. */
/** The Help group: pinned at the foot of the sidebar and at the top of the phone More sheet. */
export const HELP_SECTION = "Help";

export const TAB_BAR: AppPath[] = ["/office", "/tasks", "/approvals", "/chat"];

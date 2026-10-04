import {
  BrainIcon,
  BriefcaseIcon,
  BooksIcon,
  BookOpenTextIcon,
  BlueprintIcon,
  FlowArrowIcon,
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
  type Icon,
} from "@phosphor-icons/react";

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
  | "/templates"
  | "/documents"
  | "/packs"
  | "/logins"
  | "/office"
  | "/monitor"
  | "/agents"
  | "/tasks"
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
  | "/tutorial";

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

// Grouped as a top-to-bottom flow: start at Home, look in on the Office and its agents,
// give and track Work, watch them Collaborate, back them with Knowledge, wire up Operations,
// and Admin at the bottom. Each group is one step of running the office.
export const NAV: NavSection[] = [
  {
    title: "Home",
    items: [
      { to: "/", label: "Command center", icon: GaugeIcon, blurb: "Today at a glance: system health, organization and what to do next." },
      { to: "/my-worker", label: "My AI worker", icon: BriefcaseIcon, perm: "agents.own", blurb: "The AI worker you hired: what it is doing now, what waits for you, its duties and the hours it works and rests." },
      { to: "/twin", label: "My twin", icon: UserFocusIcon, perm: "agents.own", blurb: "Your AI twin: your virtual self at work. It handles routine tasks the way you would, and asks you before anything important." },
      { to: "/assistants", label: "My assistants", icon: SparkleIcon, perm: "work.write", blurb: "Your own private AI assistants: the whole company at a glance, your Gmail with drafts you approve, and chasing people on WhatsApp." },
      { to: "/overview", label: "Company overview", icon: ChartBarIcon, blurb: "Every branch side by side: work by type, what is failing or waiting, and spend, with an AI briefing." },
      { to: "/impact", label: "Impact", icon: ChartLineUpIcon, perm: ["org.manage", "team.manage"], blurb: "What the AI team measurably did per company and department, the time it freed against what it cost, and what it can do next." },
    ],
  },
  {
    title: "Office",
    items: [
      { to: "/office", label: "Office floor", icon: BuildingsIcon, blurb: "A live pixel-art office per branch. Every agent sits at a desk in its department and walks to the podium when it needs you." },
      { to: "/monitor", label: "Monitor", icon: EyeIcon, blurb: "Watch any agent work live: its thinking, every tool it uses, questions to colleagues, and its browser screen." },
      { to: "/agents", label: "Agents", icon: UsersThreeIcon, blurb: "Create agents by hand, place them in a department, give them skills and SOPs, and see who reports to whom." },
    ],
  },
  {
    title: "Work",
    items: [
      { to: "/tasks", label: "Tasks", icon: KanbanIcon, blurb: "A board of everything your agents are working on, from triage to done. Drag a card onto an agent to assign it." },
      { to: "/approvals", label: "Approvals", icon: SealCheckIcon, blurb: "Decisions agents are waiting on. Approve once, always, or deny, from here or from a phone notification." },
      { to: "/reports", label: "Reports", icon: ClipboardTextIcon, blurb: "What agents wrote up for you: summaries and tables you can sort and download." },
      { to: "/chat", label: "Chat", icon: ChatsCircleIcon, blurb: "Talk to any agent directly, switch its model for a session, and turn a conversation into a task." },
    ],
  },
  {
    // Step by step: set up the company once, give the office its files, keep templates,
    // prepare documents, then compile submission packs.
    title: "Documents",
    items: [
      { to: "/company-kit", label: "Company kit", icon: IdentificationCardIcon, blurb: "Each company's facts every document reuses: legal name, registration, address, bank, signatory, logo." },
      { to: "/files", label: "Files", icon: FolderOpenIcon, blurb: "Certificates, statements, letters and photos the office keeps. Each one is read once (scans too) and summarised for agents." },
      { to: "/templates", label: "Templates", icon: StackIcon, blurb: "Quotations, invoices, letters, proposals and your own Word files, with {{placeholders}} agents and people fill." },
      { to: "/documents", label: "Documents", icon: FilesIcon, blurb: "Documents drafted by people or agents, checked automatically, approved, and exported to PDF, Word or Excel." },
      { to: "/packs", label: "Packs", icon: PackageIcon, blurb: "Submission packs: a checklist matched to real files and documents, compiled into one PDF with a cover and contents." },
    ],
  },
  {
    title: "Collaboration",
    items: [
      { to: "/meetings", label: "Meetings", icon: UsersIcon, blurb: "Watch agents discuss a decision with each other, interject, and read the outcome they agree on." },
      { to: "/broadcasts", label: "Broadcasts", icon: BroadcastIcon, blurb: "Message everyone, a branch, a department or picked agents, and see who acknowledged it." },
    ],
  },
  {
    title: "Knowledge",
    items: [
      { to: "/sops", label: "SOPs", icon: FileTextIcon, blurb: "Written procedures agents follow: for every company, one company, one department, or attached to specific agents." },
      { to: "/library", label: "Library", icon: BooksIcon, blurb: "Guidelines, manuals and policies people upload. Agents search them when the work needs it and cite the page." },
      { to: "/brain", label: "Brain", icon: BrainIcon, blurb: "What the office knows: facts agents learned, wiki pages and the nightly dream, in a vault that also opens in Obsidian." },
      { to: "/skills", label: "Skills", icon: LightningIcon, blurb: "Procedures agents have learned. Review what they propose before it becomes part of how they work." },
      { to: "/learning", label: "Learning", icon: GraduationCapIcon, blurb: "What your agents learned, how each change was tested, what went live by itself, and what learning cost." },
      { to: "/blueprints", label: "Blueprints", icon: BlueprintIcon, perm: ["agents.manage", "agents.own"], blurb: "Reusable role packages — instructions, model, tool scope, SOPs and skills — you apply to agents so they start as specialists." },
      { to: "/workflows", label: "Workflows", icon: FlowArrowIcon, perm: ["agents.manage", "agents.own", "work.write"], blurb: "Draw how a job is done as connected steps, or let an analyst agent draft it. Attach it to agents as their procedure, or run a job through it: each step goes to its agent, and you take the decisions." },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/schedules", label: "Schedules", icon: CalendarCheckIcon, blurb: "Recurring work and every run's result, with retries and grouped incidents." },
      { to: "/logins", label: "Logins", icon: LockKeyIcon, perm: ["vault.manage", "vault.own"], blurb: "Website logins agents may use without ever seeing them, each locked to its own sites." },
      { to: "/ai-engine", label: "AI Engine", icon: CpuIcon, perm: "org.read", blurb: "Add provider keys, test the connection, choose models and see what every agent spends." },
      { to: "/mcp-servers", label: "MCP tools", icon: PuzzlePieceIcon, perm: "engine.manage", blurb: "Connect external tool servers (MCP) — a tracker, CRM, or a company's own server. Agents reach them through a search-and-call bridge, every call approved." },
      { to: "/channels", label: "Channels", icon: PlugsConnectedIcon, blurb: "Phone notifications, Telegram, API tokens, and which agent answers where." },
    ],
  },
  {
    title: "Admin",
    items: [
      { to: "/organization", label: "Organization", icon: TreeStructureIcon, blurb: "Branches (one per company) and the departments inside them." },
      { to: "/activity", label: "Activity", icon: ClockCounterClockwiseIcon, perm: "audit.read", blurb: "Every change made by people and agents, in a tamper-evident log." },
      { to: "/settings", label: "Settings", icon: GearSixIcon, blurb: "Members and roles, appearance and your account." },
    ],
  },
  {
    title: "Help",
    items: [
      { to: "/tutorial", label: "Tutorial", icon: BookOpenTextIcon, blurb: "Learn the whole system for your role, step by step: from your first agent to giving tasks and seeing results." },
    ],
  },
];

export const ALL_NAV: NavItem[] = NAV.flatMap((s) => s.items);

/** Phone bottom bar: the four things you reach for one-handed, plus More. */
export const TAB_BAR: AppPath[] = ["/office", "/tasks", "/approvals", "/chat"];

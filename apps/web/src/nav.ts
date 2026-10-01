import {
  BrainIcon,
  FileTextIcon,
  BroadcastIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  ChatsCircleIcon,
  TreeStructureIcon,
  ClockCounterClockwiseIcon,
  CpuIcon,
  GaugeIcon,
  GearSixIcon,
  KanbanIcon,
  LightningIcon,
  PlugsConnectedIcon,
  SealCheckIcon,
  UsersIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";

export type AppPath =
  | "/"
  | "/office"
  | "/agents"
  | "/tasks"
  | "/approvals"
  | "/chat"
  | "/meetings"
  | "/broadcasts"
  | "/brain"
  | "/sops"
  | "/skills"
  | "/schedules"
  | "/ai-engine"
  | "/channels"
  | "/organization"
  | "/activity"
  | "/settings"
  | "/settings/members";

export interface NavItem {
  to: AppPath;
  label: string;
  icon: Icon;
  /** Roadmap phase that ships this page; absent = live now. */
  phase?: string;
  blurb: string;
  /** Permission needed to see it in navigation. */
  perm?: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    title: "Workspace",
    items: [
      { to: "/", label: "Command center", icon: GaugeIcon, blurb: "Today at a glance: system health, organization and what to do next." },
      { to: "/office", label: "Office", icon: BuildingsIcon, blurb: "A live pixel-art office per branch. Every agent sits at a desk in its department and walks to the podium when it needs you." },
      { to: "/agents", label: "Agents", icon: UsersThreeIcon, blurb: "Create agents by hand, place them in a department, give them skills and SOPs, and see who reports to whom." },
      { to: "/tasks", label: "Tasks", icon: KanbanIcon, blurb: "A board of everything your agents are working on, from triage to done. Drag a card onto an agent to assign it." },
      { to: "/approvals", label: "Approvals", icon: SealCheckIcon, blurb: "Decisions agents are waiting on. Approve once, always, or deny, from here or from a phone notification." },
      { to: "/chat", label: "Chat", icon: ChatsCircleIcon, blurb: "Talk to any agent directly, switch its model for a session, and turn a conversation into a task." },
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
      { to: "/brain", label: "Brain", icon: BrainIcon, blurb: "What the office knows: facts agents learned, wiki pages and the nightly dream, in a vault that also opens in Obsidian." },
      { to: "/skills", label: "Skills", icon: LightningIcon, blurb: "Procedures agents have learned. Review what they propose before it becomes part of how they work." },
    ],
  },
  {
    title: "Operations",
    items: [
      { to: "/schedules", label: "Schedules", icon: CalendarCheckIcon, blurb: "Recurring work and every run's result, with retries and grouped incidents." },
      { to: "/ai-engine", label: "AI Engine", icon: CpuIcon, blurb: "Add provider keys, test the connection, choose models and see what every agent spends." },
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
];

export const ALL_NAV: NavItem[] = NAV.flatMap((s) => s.items);

/** Phone bottom bar: the four things you reach for one-handed, plus More. */
export const TAB_BAR: AppPath[] = ["/office", "/tasks", "/approvals", "/chat"];

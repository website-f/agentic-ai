/**
 * What the Guide shows for every page: which states are captured and which controls are
 * highlighted. The capture tool (deploy/docs-capture) finds each target by its
 * data-guide="<id>" attribute in the real UI and records its box; the Guide page explains
 * each target in its steps. Keep ids stable: content and screenshots both use them.
 *
 * `states`: extra captures besides the page as it opens. `how` tells the capture tool (and
 * the reader) how that state is reached.
 */
export interface GuideTarget {
  id: string;
  label: string;
}

export interface GuideState {
  key: string;
  how: string;
}

export interface GuidePage {
  id: string;
  route: string;
  title: string;
  group: string;
  states: GuideState[];
  targets: GuideTarget[];
  /** Pages only some roles see; the Guide says who. */
  who?: string;
}

const t = (id: string, label: string): GuideTarget => ({ id, label });

export const GUIDE_PAGES: GuidePage[] = [
  // ---------------------------------------------------------------- Home
  {
    id: "home", route: "/", title: "Command center", group: "Home", states: [],
    targets: [t("home.health", "System health"), t("home.getting-started", "Getting started checklist"), t("home.shortcuts", "Shortcuts")],
  },
  {
    id: "workspace", route: "/workspace", title: "My workspace", group: "Home",
    states: [],
    targets: [
      t("desk.tabs", "The workspace tabs"), t("desk.ask", "Ask or search"), t("desk.stats", "Your day in numbers"), t("desk.pinned", "Pinned"),
      t("desk.work", "My work"), t("desk.files", "My workspace files"), t("desk.agents", "My AI workers"),
      t("desk.waiting", "Waiting for you"), t("desk.procedures", "My procedures"),
    ],
  },
  {
    id: "my-worker", route: "/my-worker", title: "My AI", group: "Home", who: "Staff",
    states: [{ key: "welcome", how: "First sign-in as staff: the Hire your AI worker steps (/welcome)" }],
    targets: [t("my-worker.status", "What it is doing now"), t("my-worker.actions", "Give a task, chat, change hours"), t("my-worker.week", "Its working week")],
  },
  {
    id: "assistants", route: "/assistants", title: "My assistants", group: "Home", who: "Owners and managers",
    states: [],
    targets: [t("assistants.chat", "Chat with your assistant"), t("assistants.quick", "One-tap questions"), t("assistants.connections", "Gmail, Calendar and WhatsApp")],
  },
  {
    id: "computers", route: "/computers", title: "My computers", group: "Home", who: "Anyone with their own AI (an AI twin or a private assistant)",
    states: [{ key: "activity", how: "Click Recent activity on a computer" }],
    targets: [
      t("computers.link", "Link a computer"), t("computers.device", "A linked computer"), t("computers.folders", "Folders your AI may see"),
      t("computers.activity", "What your AI did on it"), t("computers.safety", "What it can and cannot do"),
    ],
  },
  {
    id: "overview", route: "/overview", title: "Company overview", group: "Home",
    states: [],
    targets: [t("overview.range", "Period"), t("overview.branches", "Every company side by side"), t("overview.briefing", "AI briefing")],
  },
  {
    id: "impact", route: "/impact", title: "Impact", group: "Home", who: "Owners and managers",
    states: [{ key: "roi", how: "Scroll down to the ROI calculator and the Try it suggestions" }],
    targets: [t("impact.totals", "Measured results"), t("impact.roi", "ROI calculator"), t("impact.try", "Try it")],
  },
  // ---------------------------------------------------------------- Office
  {
    id: "office", route: "/office", title: "Office floor", group: "Office",
    states: [{ key: "agent", how: "Click an agent at its desk: its side panel opens" }],
    targets: [t("office.floor", "The live office"), t("office.branch", "Pick a company")],
  },
  {
    id: "monitor", route: "/monitor", title: "Monitor", group: "Office", states: [],
    targets: [t("monitor.agents", "Agents working now"), t("monitor.screen", "Live screen and steps")],
  },
  {
    id: "agents", route: "/agents", title: "Agents", group: "Office",
    states: [
      { key: "new", how: "Click New agent: the builder (/agents/new)" },
      { key: "detail", how: "Click an agent card: its detail page" },
    ],
    targets: [t("agents.new", "New agent"), t("agents.card", "An agent card"), t("agents.org", "Org chart view")],
  },
  // ---------------------------------------------------------------- Work
  {
    id: "tasks", route: "/tasks", title: "Tasks", group: "Work",
    states: [
      { key: "new", how: "Click New task: the task composer opens (what you need, how, who and when)" },
      { key: "sheet", how: "Click a task card: its sheet with plan, result and timeline" },
    ],
    targets: [t("tasks.new", "New task"), t("tasks.columns", "Board columns"), t("tasks.card", "A task card"), t("tasks.search", "Search")],
  },
  {
    id: "approvals", route: "/approvals", title: "Approvals", group: "Work", states: [],
    targets: [t("approvals.card", "A decision waiting"), t("approvals.actions", "Approve, always or deny"), t("approvals.history", "History")],
  },
  {
    id: "forms", route: "/forms", title: "Forms", group: "Work",
    states: [
      { key: "handin", how: "Click Hand in on a form: upload the filled form and receipts" },
      { key: "ask", how: "Click Ask AI to fill it on a form" },
    ],
    targets: [t("forms.tabs", "To hand in and all forms"), t("forms.list", "The company's forms")],
  },
  {
    id: "reports", route: "/reports", title: "Reports", group: "Work", states: [],
    targets: [t("reports.list", "Reports agents wrote"), t("reports.search", "Search")],
  },
  {
    id: "chat", route: "/chat", title: "Chat", group: "Work",
    states: [{ key: "conversation", how: "Pick an agent: the full-screen conversation opens" }],
    targets: [t("chat.agents", "Pick an agent"), t("chat.composer", "Type, or hold the microphone")],
  },
  // ---------------------------------------------------------------- Documents
  {
    id: "company-kit", route: "/company-kit", title: "Company kit", group: "Documents", states: [],
    targets: [t("company-kit.fields", "Company facts"), t("company-kit.save", "Save")],
  },
  {
    id: "files", route: "/files", title: "Library: Browse", group: "Documents",
    states: [{ key: "sheet", how: "Click a file: its preview and what was read from it" }],
    targets: [
      t("files.company", "Pick the company"), t("files.upload", "Upload files, folders or a zip"), t("files.report", "Upload report"),
      t("files.tree", "Folders"), t("files.filters", "Search and filters"), t("files.list", "Files"),
      t("files.download-folder", "Download a folder"), t("files.download-all", "Download everything"), t("files.library", "Use as a guideline"),
      t("shell.search", "Search inside every document"),
    ],
  },
  {
    id: "templates", route: "/templates", title: "Templates", group: "Documents", states: [],
    targets: [t("templates.new", "New template"), t("templates.list", "Templates")],
  },
  {
    id: "documents", route: "/documents", title: "Documents", group: "Documents",
    states: [{ key: "editor", how: "Open a document: the editor with fields and preview" }],
    targets: [t("documents.new", "New document"), t("documents.list", "Documents and their checks")],
  },
  {
    id: "packs", route: "/packs", title: "Packs", group: "Documents", states: [],
    targets: [t("packs.new", "New pack"), t("packs.list", "Packs and their progress")],
  },
  // ---------------------------------------------------------------- Collaboration
  {
    id: "meetings", route: "/meetings", title: "Meetings", group: "Collaboration", states: [],
    targets: [t("meetings.list", "Meetings"), t("meetings.new", "Start a meeting")],
  },
  {
    id: "broadcasts", route: "/broadcasts", title: "Broadcasts", group: "Collaboration", states: [],
    targets: [t("broadcasts.compose", "Write a broadcast"), t("broadcasts.list", "Sent and acknowledged")],
  },
  // ---------------------------------------------------------------- Knowledge
  {
    id: "sops", route: "/sops", title: "SOPs", group: "Knowledge", states: [],
    targets: [t("sops.new", "New SOP"), t("sops.list", "SOPs by scope")],
  },
  {
    id: "library", route: "/library", title: "Guidelines", group: "Knowledge", states: [],
    targets: [t("library.upload", "Upload guidelines"), t("library.sources", "Sources and status"), t("library.search", "Try a search")],
  },
  {
    id: "brain", route: "/brain", title: "Brain", group: "Knowledge", states: [],
    targets: [t("brain.tabs", "Pages, facts, search, graph, dreams"), t("brain.search", "Search")],
  },
  {
    id: "skills", route: "/skills", title: "Skills", group: "Knowledge",
    states: [{ key: "sheet", how: "Click a skill: steps, tests, versions, Improve with AI" }],
    targets: [t("skills.list", "Skills"), t("skills.proposals", "Proposals waiting"), t("skills.teach", "Teach from a source")],
  },
  {
    id: "learning", route: "/learning", title: "Learning", group: "Knowledge", states: [],
    targets: [t("learning.kpis", "What was learned"), t("learning.autopilot", "Autopilot and self-check"), t("learning.recent", "Recent decisions")],
  },
  {
    id: "blueprints", route: "/blueprints", title: "Blueprints", group: "Knowledge", states: [],
    targets: [t("blueprints.new", "New blueprint"), t("blueprints.apply", "Apply to an agent")],
  },
  {
    id: "workflows", route: "/workflows", title: "Workflows", group: "Knowledge",
    states: [{ key: "editor", how: "Open a workflow: the full-screen editor" }],
    targets: [t("workflows.new", "New workflow"), t("workflows.list", "Workflows"), t("workflows.run", "Run")],
  },
  // ---------------------------------------------------------------- Operations
  {
    id: "schedules", route: "/schedules", title: "Schedules", group: "Operations", states: [],
    targets: [t("schedules.new", "New schedule"), t("schedules.list", "Schedules and runs")],
  },
  {
    id: "logins", route: "/logins", title: "Logins", group: "Operations", states: [],
    targets: [t("logins.new", "Add a login"), t("logins.list", "Logins, locked to their sites")],
  },
  {
    id: "ai-engine", route: "/ai-engine", title: "AI Engine", group: "Operations", who: "Owners and admins",
    states: [],
    targets: [t("ai-engine.tabs", "Providers, model groups, usage, playground"), t("ai-engine.add", "Add a provider")],
  },
  {
    id: "mcp-servers", route: "/mcp-servers", title: "MCP tools", group: "Operations", states: [],
    targets: [t("mcp-servers.add", "Connect a server")],
  },
  {
    id: "channels", route: "/channels", title: "Channels", group: "Operations", states: [],
    targets: [t("channels.whatsapp", "WhatsApp"), t("channels.telegram", "Telegram"), t("channels.push", "Phone notifications")],
  },
  // ---------------------------------------------------------------- Admin
  {
    id: "organization", route: "/organization", title: "Organization", group: "Admin",
    states: [{ key: "new", how: "Click Add company: industry and ready-made AI team" }],
    targets: [t("organization.add", "Add company"), t("organization.company", "A company and its departments")],
  },
  {
    id: "activity", route: "/activity", title: "Activity", group: "Admin", states: [],
    targets: [t("activity.filter", "Filter"), t("activity.list", "Every change, in order")],
  },
  {
    id: "settings", route: "/settings/members", title: "Members and settings", group: "Admin", states: [],
    targets: [t("settings.add", "Add member"), t("settings.list", "People and roles")],
  },
  // ---------------------------------------------------------------- Help
  {
    id: "tutorial", route: "/tutorial", title: "Tutorial", group: "Help", states: [],
    targets: [t("tutorial.tracks", "Your role's track"), t("tutorial.next", "Next up")],
  },
  {
    // P25: a script for showing a client a day with AI agents (no screenshots of its own).
    id: "demo-day", route: "/tutorial", title: "Demo: a working day with AI agents", group: "Help", states: [],
    targets: [],
  },
];

/** The flows recorded as short videos (deploy/docs-capture records them). */
export const GUIDE_FLOWS = [
  { id: "create-agent", title: "Create an agent", page: "agents" },
  { id: "give-task", title: "Give a task and follow it", page: "tasks" },
  { id: "approve", title: "Approve a decision", page: "approvals" },
  { id: "add-company", title: "Add a company with a ready-made AI team", page: "organization" },
  { id: "hire-worker", title: "Staff: hire your AI worker", page: "my-worker" },
  { id: "phone-tour", title: "On the phone", page: "home" },
] as const;

export const pageById = (id: string) => GUIDE_PAGES.find((p) => p.id === id);

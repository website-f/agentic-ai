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
  // ---------------------------------------------------------------- Today
  {
    id: "workspace", route: "/workspace", title: "My workspace", group: "Today",
    states: [],
    targets: [
      t("desk.tabs", "The workspace tabs"), t("desk.ask", "Search or jump anywhere"), t("desk.stats", "On my plate"), t("desk.pinned", "Pinned"),
      t("desk.work", "My work"), t("desk.files", "My workspace files"), t("desk.agents", "My AI workers"),
      t("desk.waiting", "Today"), t("desk.procedures", "My procedures"),
    ],
  },
  {
    id: "home", route: "/", title: "Command center", group: "Today", states: [],
    targets: [t("home.health", "System health"), t("home.getting-started", "Getting started checklist"), t("home.shortcuts", "Shortcuts")],
  },
  {
    id: "overview", route: "/overview", title: "Company overview", group: "Today",
    states: [],
    targets: [t("overview.range", "Period"), t("overview.branches", "Every company side by side"), t("overview.briefing", "AI briefing")],
  },
  {
    id: "impact", route: "/impact", title: "Impact", group: "Today", who: "Owners and managers",
    states: [{ key: "roi", how: "Scroll down to the ROI calculator and the Try it suggestions" }],
    targets: [t("impact.totals", "Measured results"), t("impact.roi", "ROI calculator"), t("impact.try", "Try it")],
  },
  {
    id: "my-worker", route: "/my-worker", title: "My AI", group: "Today", who: "Staff",
    states: [{ key: "welcome", how: "First sign-in as staff: the Hire your AI worker steps (/welcome)" }],
    targets: [t("my-worker.status", "What it is doing now"), t("my-worker.actions", "Give a task, chat, change hours"), t("my-worker.week", "Its working week")],
  },
  {
    id: "assistants", route: "/assistants", title: "My assistants", group: "Today", who: "Owners and managers",
    states: [],
    targets: [t("assistants.chat", "Chat with your assistant"), t("assistants.quick", "One-tap questions"), t("assistants.connections", "Gmail, Calendar and WhatsApp")],
  },
  {
    id: "computers", route: "/computers", title: "My computers", group: "Today", who: "Anyone with their own AI (an AI twin or a private assistant)",
    states: [{ key: "activity", how: "Click Recent activity on a computer" }],
    targets: [
      t("computers.link", "Link a computer"), t("computers.device", "A linked computer"), t("computers.folders", "Folders your AI may see"),
      t("computers.activity", "What your AI did on it"), t("computers.safety", "What it can and cannot do"),
    ],
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
    id: "chat", route: "/chat", title: "Chat", group: "Work",
    states: [{ key: "conversation", how: "Pick an agent: the full-screen conversation opens" }],
    targets: [t("chat.agents", "Pick an agent"), t("chat.composer", "Type, or hold the microphone")],
  },
  {
    id: "mail", route: "/mail", title: "Microsoft 365", group: "Work", who: "People with their own AI or a private assistant",
    states: [],
    targets: [t("mail.drafts", "Waiting for your approval")],
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
    id: "workflows", route: "/workflows", title: "Workflows", group: "Work",
    states: [{ key: "editor", how: "Open a workflow: the full-screen editor" }],
    targets: [t("workflows.new", "New workflow"), t("workflows.list", "Workflows"), t("workflows.run", "Run")],
  },
  {
    id: "objectives", route: "/objectives", title: "Objectives", group: "Work", who: "Owners and managers", states: [],
    targets: [],
  },
  // ---------------------------------------------------------------- Prima
  {
    id: "prima", route: "/prima", title: "Prima", group: "Prima", states: [],
    targets: [],
  },
  // ---------------------------------------------------------------- Library
  {
    id: "files", route: "/files", title: "Library: Browse", group: "Library",
    states: [{ key: "sheet", how: "Click a file: its preview and what was read from it" }],
    targets: [
      t("files.company", "Pick the company"), t("files.upload", "Upload files, folders or a zip"), t("files.report", "Upload report"),
      t("files.tree", "Folders"), t("files.filters", "Search and filters"), t("files.list", "Files"),
      t("files.download-folder", "Download a folder"), t("files.download-all", "Download everything"), t("files.library", "Use as a guideline"),
      t("shell.search", "Search inside every document"),
    ],
  },
  {
    id: "documents", route: "/documents", title: "Documents", group: "Library",
    states: [{ key: "editor", how: "Open a document: the editor with fields and preview" }],
    targets: [t("documents.new", "New document"), t("documents.list", "Documents and their checks")],
  },
  {
    id: "sops", route: "/sops", title: "SOPs", group: "Library", states: [],
    targets: [t("sops.new", "New SOP"), t("sops.list", "SOPs by scope")],
  },
  {
    id: "library", route: "/library", title: "Guidelines", group: "Library", states: [],
    targets: [t("library.upload", "Upload guidelines"), t("library.sources", "Sources and status"), t("library.search", "Try a search"), t("library.sharepoint", "SharePoint and OneDrive")],
  },
  {
    id: "templates", route: "/templates", title: "Templates", group: "Library", states: [],
    targets: [t("templates.new", "New template"), t("templates.list", "Templates")],
  },
  {
    id: "packs", route: "/packs", title: "Packs", group: "Library", states: [],
    targets: [t("packs.new", "New pack"), t("packs.list", "Packs and their progress")],
  },
  {
    id: "company-kit", route: "/company-kit", title: "Company kit", group: "Library", states: [],
    targets: [t("company-kit.fields", "Company facts"), t("company-kit.save", "Save")],
  },
  // ---------------------------------------------------------------- AI team
  {
    id: "agents", route: "/agents", title: "Agents", group: "AI team",
    states: [
      { key: "new", how: "Click New agent: the builder (/agents/new)" },
      { key: "detail", how: "Click an agent card: its detail page" },
    ],
    targets: [t("agents.new", "New agent"), t("agents.card", "An agent card"), t("agents.org", "Org chart view")],
  },
  {
    id: "timetable", route: "/timetable", title: "Timetable", group: "AI team", who: "Owners and managers", states: [],
    targets: [],
  },
  {
    id: "monitor", route: "/monitor", title: "Monitor", group: "AI team", states: [],
    targets: [t("monitor.agents", "Agents working now"), t("monitor.screen", "Live screen and steps")],
  },
  {
    id: "meetings", route: "/meetings", title: "Meetings", group: "AI team", states: [],
    targets: [t("meetings.list", "Meetings"), t("meetings.new", "Start a meeting")],
  },
  {
    id: "broadcasts", route: "/broadcasts", title: "Broadcasts", group: "AI team", states: [],
    targets: [t("broadcasts.compose", "Write a broadcast"), t("broadcasts.list", "Sent and acknowledged")],
  },
  {
    id: "office", route: "/office", title: "Office floor", group: "AI team",
    states: [{ key: "agent", how: "Click an agent at its desk: its side panel opens" }],
    targets: [t("office.floor", "The live office"), t("office.branch", "Pick a company")],
  },
  {
    id: "learning", route: "/learning", title: "Learning", group: "AI team", states: [],
    targets: [t("learning.kpis", "What was learned"), t("learning.autopilot", "Autopilot and self-check"), t("learning.recent", "Recent decisions")],
  },
  {
    id: "skills", route: "/skills", title: "Skills", group: "AI team",
    states: [{ key: "sheet", how: "Click a skill: steps, tests, versions, Improve with AI" }],
    targets: [t("skills.list", "Skills"), t("skills.proposals", "Proposals waiting"), t("skills.teach", "Teach from a source")],
  },
  {
    id: "brain", route: "/brain", title: "Brain", group: "AI team", states: [],
    targets: [t("brain.tabs", "Pages, facts, search, graph, dreams"), t("brain.search", "Search")],
  },
  {
    id: "blueprints", route: "/blueprints", title: "Blueprints", group: "AI team", states: [],
    targets: [t("blueprints.new", "New blueprint"), t("blueprints.apply", "Apply to an agent")],
  },
  // ---------------------------------------------------------------- Settings
  {
    id: "organization", route: "/organization", title: "Organization", group: "Settings",
    states: [{ key: "new", how: "Click Add company: industry and ready-made AI team" }],
    targets: [t("organization.add", "Add company"), t("organization.company", "A company and its departments")],
  },
  {
    id: "settings", route: "/settings/members", title: "Members and settings", group: "Settings", states: [],
    targets: [t("settings.add", "Add member"), t("settings.list", "People and roles")],
  },
  {
    id: "roles", route: "/settings/roles", title: "Roles and access", group: "Settings", who: "Owners", states: [],
    targets: [],
  },
  {
    id: "staff-computers", route: "/staff-computers", title: "Staff computers", group: "Settings", who: "Owners, admins and managers", states: [],
    targets: [],
  },
  {
    id: "ai-use", route: "/settings/ai-use", title: "AI use and limits", group: "Settings", who: "Owners, admins and managers", states: [],
    targets: [],
  },
  {
    id: "web-connections", route: "/web-connections", title: "Web connections", group: "Settings", who: "Owners", states: [],
    targets: [],
  },
  {
    id: "approved-services", route: "/approved-services", title: "Approved services", group: "Settings", who: "Owners", states: [],
    targets: [],
  },
  {
    id: "channels", route: "/channels", title: "Channels", group: "Settings", states: [],
    targets: [t("channels.whatsapp", "WhatsApp"), t("channels.telegram", "Telegram"), t("channels.push", "Phone notifications")],
  },
  {
    id: "ai-engine", route: "/ai-engine", title: "AI Engine", group: "Settings", who: "Owners and admins",
    states: [],
    targets: [t("ai-engine.tabs", "Providers, model groups, usage, playground"), t("ai-engine.add", "Add a provider")],
  },
  {
    id: "storage", route: "/settings/storage", title: "File storage", group: "Settings", who: "Owners and admins", states: [],
    targets: [],
  },
  {
    id: "logins", route: "/logins", title: "Logins", group: "Settings", states: [],
    targets: [t("logins.new", "Add a login"), t("logins.list", "Logins, locked to their sites")],
  },
  {
    id: "schedules", route: "/schedules", title: "Schedules", group: "Settings", states: [],
    targets: [t("schedules.new", "New schedule"), t("schedules.list", "Schedules and runs")],
  },
  {
    id: "mcp-servers", route: "/mcp-servers", title: "MCP tools", group: "Settings", states: [],
    targets: [t("mcp-servers.add", "Connect a server")],
  },
  {
    id: "activity", route: "/activity", title: "Activity", group: "Settings", states: [],
    targets: [t("activity.filter", "Filter"), t("activity.list", "Every change, in order")],
  },
  // ---------------------------------------------------------------- Developer
  {
    id: "feedbacks", route: "/feedbacks", title: "Feedbacks", group: "Developer", who: "The system's developer", states: [],
    targets: [],
  },
  // ---------------------------------------------------------------- Help
  {
    id: "start", route: "/start", title: "Setting up", group: "Help", states: [],
    targets: [],
  },
  {
    id: "tutorial", route: "/tutorial", title: "Tutorial", group: "Help", states: [],
    targets: [t("tutorial.tracks", "Your role's track"), t("tutorial.next", "Next up")],
  },
  {
    // P25: a script for showing a client a day with AI agents (no screenshots of its own).
    id: "demo-day", route: "/tutorial", title: "Demo: a working day with AI agents", group: "Help", states: [],
    targets: [],
  },
  {
    id: "present", route: "/present", title: "Present", group: "Help", states: [],
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

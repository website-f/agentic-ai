/** The client presentation (/present): one entry per slide, built from the same captured
 * shots and videos as the guide. `shot` is a desktop shot key and `phone` a mobile shot key
 * ("<page>" or "<page>:<state>", see targets.ts); content.test.ts checks every key exists.
 * Claims stay honest: estimates are labelled, nothing promises 100% or replacing people. */

export type SlideIcon =
  | "files" | "package" | "chart" | "chat" | "brain" | "users" | "robot" | "hand" | "list" | "tools"
  | "check" | "seal" | "shield" | "lock" | "wallet" | "server" | "clock" | "eye" | "book" | "lightning"
  | "flow" | "calendar" | "buildings" | "calculator" | "trend" | "envelope" | "whatsapp" | "mic" | "plug" | "sparkle";

export interface SlidePoint {
  icon: SlideIcon;
  title: string;
  body: string;
}

export interface Slide {
  id: string;
  kind: "title" | "points" | "flow" | "feature" | "steps" | "closing";
  eyebrow: string;
  title: string;
  lead?: string;
  points?: SlidePoint[];
  bullets?: string[];
  /** Desktop shot key shown in a laptop frame. */
  shot?: string;
  /** Mobile shot key shown in a phone frame. */
  phone?: string;
  /** A recorded flow (GUIDE_FLOWS id) that plays in the frame when it exists. */
  video?: string;
  /** A small honest footnote on the slide. */
  note?: string;
  /** What to say: shown with N. */
  notes: string;
}

export const SLIDES: Slide[] = [
  {
    id: "title",
    kind: "title",
    eyebrow: "Agentic Office",
    title: "An AI office for your company, with your people in charge",
    lead: "AI agents in every department plan, do and check the routine work. Your people approve what matters.",
    shot: "office",
    phone: "home",
    notes:
      "Welcome. In the next fifteen minutes I'll show you an office where AI agents do the routine work of each department: drafting, chasing, checking, reporting. The important part: your people stay in charge. Nothing that matters happens without a person approving it.",
  },
  {
    id: "problem",
    kind: "points",
    eyebrow: "The problem",
    title: "Office work piles up",
    lead: "Skilled people spend their days on work that has to be done, but does not need their judgement.",
    points: [
      { icon: "files", title: "Documents", body: "Quotations, invoices and letters typed again from the same company facts." },
      { icon: "package", title: "Submissions", body: "Tender packs: chasing certificates, checking expiry dates, compiling PDFs." },
      { icon: "chart", title: "Reports", body: "Weekly numbers nobody has time to pull together." },
      { icon: "envelope", title: "Follow-ups", body: "Emails to answer, people to chase, reminders to send." },
      { icon: "book", title: "Know-how", body: "Procedures that live in one person's head, or in a binder nobody opens." },
      { icon: "clock", title: "Waiting", body: "Work that stops because the one person who knows is busy or away." },
    ],
    notes:
      "Ask the room: how much of your team's week goes into this kind of work? Most offices say a large share. It is necessary work, but it is not where your people add the most value.",
  },
  {
    id: "idea",
    kind: "points",
    eyebrow: "The idea",
    title: "An AI office: agents that work like staff",
    lead: "Every department gets AI agents with a job title, a manager, written procedures and a budget. People decide.",
    points: [
      { icon: "buildings", title: "One office per company", body: "Each company has its departments, and each department has its agents." },
      { icon: "robot", title: "Agents work like staff", body: "A job title, SOPs to follow, tools they may use, working hours and a budget." },
      { icon: "hand", title: "People stay in charge", body: "Agents ask before anything important. You approve once, always, or say no." },
    ],
    notes:
      "Think of it as hiring a team that never gets tired of routine work, but always asks before it spends money, sends anything to a customer or submits anything.",
  },
  {
    id: "flow",
    kind: "flow",
    eyebrow: "How a task flows",
    title: "From request to approved result",
    points: [
      { icon: "list", title: "You give a task", body: "Say what you need and what done looks like." },
      { icon: "lightning", title: "The agent plans", body: "It breaks the job into steps, following your SOPs." },
      { icon: "tools", title: "It works with tools", body: "Files, documents, the web, colleagues and calculations." },
      { icon: "check", title: "It checks itself", body: "A second model reads the work against the request first." },
      { icon: "seal", title: "A person approves", body: "You accept the result, or send it back with a comment." },
    ],
    shot: "tasks:sheet",
    video: "give-task",
    notes:
      "This is the heart of it. Every task has a visible plan, a timeline of what the agent did, and a self-check before it reaches you. If the self-check finds a gap, the agent fixes it once before you see the work.",
  },
  {
    id: "live",
    kind: "feature",
    eyebrow: "Live office and monitor",
    title: "See your AI team at work",
    lead: "A live office for each company, and a monitor that shows every step an agent takes.",
    bullets: [
      "Every agent at a desk: working, waiting on you, in a meeting or stuck",
      "Watch any agent's screen and steps live",
      "Hand out new work by dragging it onto an agent",
    ],
    shot: "office",
    phone: "monitor",
    notes:
      "Nothing happens in a black box. You can see who is working on what, and follow any agent step by step: every tool it uses and every question it asks a colleague.",
  },
  {
    id: "work",
    kind: "feature",
    eyebrow: "Tasks and approvals",
    title: "Every task and every decision in one place",
    lead: "A board from new to done, and one list of decisions waiting for you, on desktop or phone.",
    bullets: [
      "Tasks move from Triage to Running, In review and Done",
      "Approve once, always allow, or deny with a reason",
      "Decide from a phone notification, in one tap",
    ],
    shot: "tasks",
    phone: "approvals",
    video: "approve",
    notes:
      "Managers love this screen: they no longer ask 'where are we on that?'. The approvals list is the only place where agents wait for people, and it works from a phone notification.",
  },
  {
    id: "documents",
    kind: "feature",
    eyebrow: "Documents and packs",
    title: "Documents drafted, checked and packed",
    lead: "Company facts entered once. Quotations, letters and submission packs built from them, checked automatically.",
    bullets: [
      "Templates with your letterhead, or your own Word files",
      "Automatic checks flag gaps before anyone approves",
      "Submission packs matched to real files, compiled into one PDF",
    ],
    shot: "documents:editor",
    phone: "packs",
    note: "The office prepares; a person checks and submits.",
    notes:
      "AI drafts only from what you wrote and the files you attached; it doesn't invent facts. Expired certificates are flagged in the pack checklist before they become a problem.",
  },
  {
    id: "knowledge",
    kind: "feature",
    eyebrow: "Knowledge",
    title: "Your procedures, followed and cited",
    lead: "Write your SOPs once; agents follow them. Upload guidelines and manuals; agents search them and cite the page.",
    bullets: [
      "SOPs for every company, one company or one department",
      "A library of guidelines agents search when the work needs it",
      "Every answer points back to the page it came from",
    ],
    shot: "library",
    phone: "sops",
    notes:
      "This is how the office keeps your way of working. Change an SOP and every agent in scope follows the new version from its next step.",
  },
  {
    id: "learning",
    kind: "feature",
    eyebrow: "Learning",
    title: "It gets better, and you can see how",
    lead: "Agents propose skills from their work. Each change is tested before it goes live, and you choose how much is automatic.",
    bullets: [
      "Skills with tests, versions and a safety scan",
      "Improve with AI: tries better versions, keeps the best",
      "Autopilot from 'review everything' to 'proven changes go live'",
    ],
    shot: "skills:sheet",
    phone: "learning",
    notes:
      "Nothing changes how agents work until it passes its tests, and by default until a person approves it. The learning page shows what was learned, how it was checked and what it cost.",
  },
  {
    id: "finance",
    kind: "points",
    eyebrow: "Finance and forecasting",
    title: "Numbers you can check by hand",
    lead: "For money questions, agents use calculators with fixed formulas, not guesses. Every answer says which formula it used.",
    points: [
      { icon: "calculator", title: "Finance calculations", body: "Instalments (flat rate and reducing balance), NPV, IRR, payback, break-even, margins, depreciation, growth and SST." },
      { icon: "trend", title: "Forecasts with a range", body: "Trend and seasonal methods; the one with the smallest past error wins, and the result comes with an 80% range." },
      { icon: "eye", title: "Shown workings", body: "The formula and the inputs are in the answer, so your finance team can verify it." },
    ],
    note: "Forecasts are ranges, not promises.",
    notes:
      "This matters for trust: when an agent tells you a monthly instalment or a cash-flow forecast, the maths is done by a calculator, and it shows its working.",
  },
  {
    id: "workers",
    kind: "feature",
    eyebrow: "Staff AI workers",
    title: "Every employee can hire an AI worker",
    lead: "Staff hire their own AI worker in five short steps: its job, its duties and the hours it works and rests.",
    bullets: [
      "Working hours and breaks; work outside hours waits",
      "Recurring duties written in plain words",
      "It asks its person before anything important",
    ],
    shot: "my-worker",
    phone: "my-worker:welcome",
    video: "hire-worker",
    notes:
      "This turns AI from a tool for managers into help for everyone. Each person's worker handles their routine and tells others it is an AI when it deals with them.",
  },
  {
    id: "assistants",
    kind: "feature",
    eyebrow: "Personal assistants",
    title: "A private assistant for every person",
    lead: "Ask about the whole company, let it draft your email replies and calendar changes, and chase people on WhatsApp.",
    bullets: [
      "Gmail drafts only: you read, edit and send",
      "Calendar changes wait for your confirmation",
      "Type or speak; reach it on WhatsApp",
    ],
    shot: "assistants",
    phone: "assistants",
    notes:
      "Private means private: nobody else sees your assistant or its conversations. It never sends an email by itself; it prepares drafts for you.",
  },
  {
    id: "workflows",
    kind: "feature",
    eyebrow: "Workflows and schedules",
    title: "Whole jobs, mapped and on time",
    lead: "Draw how a job is done, or let AI draft it from a sentence. Run it, or put recurring work on a schedule.",
    bullets: [
      "12 ready templates: enquiry to quotation, leave, month-end close",
      "Approval steps wherever money or customers are involved",
      "Schedules with retries and a record of every run",
    ],
    shot: "workflows:editor",
    phone: "schedules",
    notes:
      "Workflows are where the office becomes a process: each step goes to the right agent, and the run stops for a person exactly where you drew an approval.",
  },
  {
    id: "companies",
    kind: "feature",
    eyebrow: "Companies and ready-made teams",
    title: "A new company, staffed in one step",
    lead: "Add a company, pick its industry, and a ready-made AI team joins: finance, sales, operations, HR and customer service.",
    bullets: [
      "Industry roles such as IT helpdesk or quantity surveyor",
      "Each company's knowledge can be kept private",
      "Ready-made agents ask first until you say otherwise",
    ],
    shot: "organization:new",
    phone: "agents",
    video: "add-company",
    notes:
      "For groups with several companies, each one gets its own office, departments and agents, and you can compare them side by side in the company overview.",
  },
  {
    id: "impact",
    kind: "feature",
    eyebrow: "Impact",
    title: "Measured results, honest estimates",
    lead: "See what the AI team did per company and department: tasks completed and what it cost, measured. Time freed, estimated from your own numbers.",
    bullets: [
      "Measured: tasks done, approval turnaround, AI cost",
      "Estimated (and labelled): time freed, staff time value",
      "Set your own assumptions: minutes per task, cost per hour",
    ],
    shot: "impact",
    phone: "overview",
    note: "Estimates are marked (est.) and use the assumptions you enter.",
    notes:
      "We separate what is measured from what is estimated, on screen. You set the assumptions, so the return on spend is your number, not ours.",
  },
  {
    id: "safety",
    kind: "points",
    eyebrow: "Safety and control",
    title: "Built so you stay in control",
    points: [
      { icon: "seal", title: "Approvals", body: "Money, customer messages and submissions wait for a person." },
      { icon: "eye", title: "Audit log", body: "Every change by people and agents, in a log that shows tampering." },
      { icon: "wallet", title: "Budgets", body: "A warning at 80% of an agent's budget; at the limit it pauses and asks." },
      { icon: "lock", title: "Private assistants", body: "Personal assistants and their chats are visible only to their owner." },
      { icon: "shield", title: "Logins never shown", body: "Passwords are encrypted, never sent to an AI model, used only on listed sites." },
      { icon: "server", title: "Your server", body: "Runs on your own server; only the text a task needs goes to the AI provider you choose." },
    ],
    notes:
      "Roles decide who can see and do what, from owner to viewer. High-risk actions are asked every time. And because it runs on your own server, your files and history stay with you.",
  },
  {
    id: "start",
    kind: "steps",
    eyebrow: "Getting started",
    title: "Up and running in three steps",
    points: [
      { icon: "plug", title: "Connect an AI provider", body: "Paste a key. A free tier is enough to start." },
      { icon: "buildings", title: "Add your companies", body: "Pick the industry; a ready-made AI team joins each one." },
      { icon: "check", title: "Give the first task", body: "Watch it plan and work, then approve the result." },
    ],
    phone: "home",
    notes:
      "You can give the first real task on day one. The built-in tutorial walks each role through the rest, and the user guide explains every screen.",
  },
  {
    id: "closing",
    kind: "closing",
    eyebrow: "Agentic Office",
    title: "Let's set up your first AI department",
    lead: "Pick one department and one routine job. We'll show you the result on your own data.",
    notes: "Ask which department has the most routine work, and offer to set it up together. Leave time for questions.",
  },
];

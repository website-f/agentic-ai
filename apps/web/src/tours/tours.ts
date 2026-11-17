/**
 * P109 guided tours: a short spotlight walk through a page (what it is, the key buttons, how
 * to do its main job), and a welcome tour per role that starts by itself the first time
 * someone signs in.
 *
 * A step points at an element by its anchor: `data-tour="<id>"` (new anchors) or
 * `data-guide="<id>"` (the Guide's screenshot anchors, the same ids): `"tasks.new"`. Also
 * `"nav:/tasks"` (the sidebar or phone tab bar link to a page) and `"css:<selector>"`. The
 * first one on screen wins; when none is (a phone, an empty page), the card shows in the
 * middle of the screen, or the step is left out when `skip` is set.
 *
 * Text is English keys (msg); the card shows it with t(), Malay rows in i18n/ms/tours.ts.
 *
 * Anchors other pages may keep for these tours (the Microsoft 365 page's own engineer adds
 * them as the page changes): mail.tabs, mail.connect, mail.accounts, mail.drafts.
 */
import { msg } from "@/i18n";

import type { Group } from "@/lib/getting-started";

export interface TourStep {
  /** Anchors, first on screen wins. None: a card in the middle. */
  target?: string[];
  title: string;
  body: string;
  /** The page this step is on (the tour goes there first). Default: the tour's own page. */
  on?: string;
  search?: Record<string, unknown>;
  /** Leave the step out when its element is not on screen (a button only some people have). */
  skip?: boolean;
  /** The first card of a welcome tour: offers Bahasa Melayu or English. */
  language?: boolean;
}

export interface Tour {
  id: string;
  title: string;
  /** The page the tour is about (its "Show me how" button shows there). */
  route: string;
  /** Also shown on these pages. */
  also?: string[];
  /** Steps stay where the person is unless they say `on` (Prima opens outside the office). */
  stay?: boolean;
  /** Only for people with one of these permissions. */
  perm?: string[];
  steps: TourStep[];
  /** A welcome tour (one per role group). */
  welcome?: Group;
}

const s = (target: string | string[] | undefined, title: string, body: string, more: Partial<TourStep> = {}): TourStep => ({
  target: target === undefined ? undefined : [target].flat(),
  title,
  body,
  ...more,
});

const HELP = s("page.help", msg("Show me how, on every page"), msg("Click Show me how on any page for a short tour like this one. You can also take any tour from Getting started."));
const CHIP = s(["gs.chip", "gs.card", "nav:/getting-started"], msg("Your getting started list"), msg("The steps for your role, in order. Each one ticks itself when it is done. Click it to see what is next."));

function welcomeCard(body: string): TourStep {
  return s(undefined, msg("Welcome to Agentic Office"), body, { language: true });
}

function doneCard(body: string): TourStep {
  return s(undefined, msg("You are ready"), body);
}

// ---------------------------------------------------------------- welcome tours (one per role group)

const WELCOME: Tour[] = [
  {
    id: "welcome-staff", welcome: "staff", title: msg("Welcome tour"), route: "/workspace", stay: true,
    steps: [
      welcomeCard(msg("A two-minute tour of where things are and what to click first. Skip it if you like; it is always under Getting started.")),
      s("desk.ask", msg("My workspace: your own desk"), msg("Everything for your day starts here. Type a question for your AI, or the name of a page, file or task, and press Enter."), { on: "/workspace" }),
      CHIP,
      s("nav:/my-worker", msg("My AI"), msg("Your own AI worker. Create it first, then customise its hours, how it speaks and what it may do.")),
      s("nav:/tasks", msg("Tasks"), msg("Tasks given to you and by you, for people and for your AI. Open one to see its checklist, files and due date.")),
      s("nav:/chat", msg("Chat"), msg("Talk to your AI or any agent, by typing or by voice.")),
      s("nav:/files", msg("Library"), msg("The company's files, SOPs and guidelines, in folders. Your AI reads them before it works.")),
      s("nav:/prima", msg("Prima"), msg("Clock in and do your daily Prima work. It opens with this same sign-in."), { skip: true }),
      HELP,
      doneCard(msg("Start with the first step on your Getting started list: your email, your workspace, then your own AI.")),
    ],
  },
  {
    id: "welcome-hod", welcome: "hod", title: msg("Welcome tour"), route: "/workspace", stay: true,
    steps: [
      welcomeCard(msg("A two-minute tour for heads of department and supervisors. Skip it if you like; it is always under Getting started.")),
      s("desk.ask", msg("My workspace: your own desk"), msg("Your day starts here: what waits for you, your pins, and one box to ask or find anything."), { on: "/workspace" }),
      CHIP,
      s("nav:/tasks", msg("Your team's tasks"), msg("Give your people tasks with a due date, a checklist and files, and follow them on a board, a calendar or a timeline.")),
      s("nav:/approvals", msg("Approvals"), msg("What your team and their AI wait on you to decide.")),
      s("nav:/settings/members", msg("Your team"), msg("Who reports to you, their roles and departments."), { skip: true }),
      s(["nav:/my-worker", "nav:/assistants"], msg("Your own AI"), msg("Your private assistant: your team at a glance, and drafts you approve.")),
      HELP,
      doneCard(msg("Next: set up your email and workspace, then check your team. Your Getting started list shows each step.")),
    ],
  },
  {
    id: "welcome-branch", welcome: "branch", title: msg("Welcome tour"), route: "/workspace", stay: true,
    steps: [
      welcomeCard(msg("A two-minute tour for branch managers. Skip it if you like; it is always under Getting started.")),
      s("desk.ask", msg("My workspace: your own desk"), msg("Your day starts here: what waits for you, your pins, and one box to ask or find anything."), { on: "/workspace" }),
      CHIP,
      s("nav:/", msg("Command center"), msg("Your branch at a glance: what is running, failing or waiting.")),
      s("nav:/tasks", msg("Tasks"), msg("Give your people and agents work, and follow it on a board, a calendar or a timeline.")),
      s("nav:/approvals", msg("Approvals"), msg("Decisions waiting for you.")),
      s("nav:/organization", msg("Your people"), msg("Your branch's departments and members."), { skip: true }),
      HELP,
      doneCard(msg("Next: your email and workspace, then check your people. Your Getting started list shows each step.")),
    ],
  },
  {
    id: "welcome-admin", welcome: "admin", title: msg("Welcome tour"), route: "/workspace", stay: true,
    steps: [
      welcomeCard(msg("A two-minute tour for admins and management. Skip it if you like; it is always under Getting started.")),
      s("desk.ask", msg("My workspace: your own desk"), msg("Your day starts here: what waits for you, your pins, and one box to ask or find anything."), { on: "/workspace" }),
      CHIP,
      s("nav:/", msg("Command center"), msg("Every company at a glance: health, work and what waits.")),
      s("nav:/approvals", msg("Approvals"), msg("Decisions waiting for you.")),
      s("nav:/organization", msg("Organization and people"), msg("Companies, departments, members and their roles.")),
      s("nav:/files", msg("Library"), msg("The group's files, SOPs and guidelines.")),
      HELP,
      doneCard(msg("Next: your email and workspace, then check the companies and people. Your Getting started list shows each step.")),
    ],
  },
  {
    id: "welcome-owner", welcome: "owner", title: msg("Welcome tour"), route: "/workspace", stay: true,
    steps: [
      welcomeCard(msg("A two-minute tour for owners: where you set up the office, and where your own work lives. Skip it if you like; it is always under Getting started.")),
      CHIP,
      s("nav:/", msg("Command center"), msg("The whole office at a glance: system health, every company and what to do next.")),
      s("nav:/settings", msg("Settings"), msg("The system mail for sign-in emails, the workspace, connections, the AI Engine and file storage.")),
      s("nav:/organization", msg("Organization and people"), msg("Companies and departments, members and their roles, and what each role may do.")),
      s("nav:/files", msg("Library"), msg("The group's files, SOPs and guidelines, and the SharePoint folders it reads.")),
      s(["nav:/my-worker", "nav:/assistants"], msg("Your own AI"), msg("Your private assistant: the company at a glance, and drafts you approve.")),
      HELP,
      doneCard(msg("Next: the system mail, the workspace, the Library's sources, companies, people and roles, then the AI engine. Your Getting started list has each step.")),
    ],
  },
];

// ---------------------------------------------------------------- page tours

const PAGES: Tour[] = [
  {
    id: "workspace", title: msg("My workspace"), route: "/workspace",
    steps: [
      s("page.title", msg("Your own desk"), msg("My workspace is yours alone: your day, your pins, your work and your files.")),
      s("desk.tabs", msg("Desk, work, files"), msg("Switch between your desk, the work you gave, your files, workflows and SOPs, and your AI workers.")),
      s("desk.ask", msg("Ask or jump anywhere"), msg("Type a question for your AI, or the name of a page, file or task, then press Enter.")),
      s("desk.waiting", msg("Today"), msg("What waits for you today: approvals, reviews and tasks due."), { skip: true }),
      s("desk.pinned", msg("Pinned"), msg("Pin the pages, files and SOPs you use every day: click the pin next to any page's title."), { skip: true }),
      s("desk.customize", msg("Make it yours"), msg("Click Customize to show, hide and reorder the parts of your desk."), { skip: true }),
      HELP,
    ],
  },
  {
    // The desk's My files tab (the Library's own folders have the "library" tour).
    id: "files", title: msg("My files"), route: "/workspace",
    steps: [
      s("desk.files", msg("Your files"), msg("What your AI made for you and the files you saved. Open, download, or move one to the Library."), { on: "/workspace", search: { tab: "files" } }),
      s("desk.tabs", msg("Back to your desk"), msg("The My desk tab takes you back."), { on: "/workspace", search: { tab: "files" } }),
    ],
  },
  {
    id: "my-ai", title: msg("My AI"), route: "/my-worker", also: ["/twin", "/welcome"], perm: ["agents.own"],
    steps: [
      s("page.title", msg("Your own AI"), msg("An AI worker of your own: it works for you only, at the hours you set, and asks before anything important.")),
      s("hub.tabs", msg("Its tabs"), msg("Chat with it, see its tasks and what it knows, teach it, and change its profile."), { skip: true }),
      s("my-worker.status", msg("What it is doing now"), msg("Its status and the work it is on."), { skip: true }),
      s("my-worker.actions", msg("Customise it"), msg("Give it a task, chat, or change its working hours and how it speaks."), { skip: true }),
      s("my-worker.give", msg("Give it a task"), msg("Write what you need in your own words. The result comes back under My work."), { skip: true }),
      s("my-worker.week", msg("Its working week"), msg("The hours it works. Outside them it waits for its next shift."), { skip: true }),
    ],
  },
  {
    id: "assistants", title: msg("My assistants"), route: "/assistants", perm: ["assistants.use"],
    steps: [
      s("page.title", msg("Your private assistant"), msg("Only you see it. It knows the company at a glance and drafts what you approve.")),
      s("assistants.chat", msg("Ask anything"), msg("Ask about your companies, your team or your day."), { skip: true }),
      s("assistants.quick", msg("One-tap questions"), msg("Tap one for a ready answer."), { skip: true }),
      s("assistants.connections", msg("Connect your mail and calendar"), msg("Connect once, and it drafts replies and plans your day. You always press Send."), { skip: true }),
    ],
  },
  {
    id: "tasks", title: msg("Tasks"), route: "/tasks",
    steps: [
      s("page.title", msg("All the work in one place"), msg("Tasks for people and for AI agents, from new to done.")),
      s("tasks.new", msg("New task"), msg("Click New task. Choose For people to give it to a colleague with a due date, a checklist and files, or For my AI or an agent."), { skip: true }),
      s("tasks.people", msg("Whose tasks"), msg("Pick a person to see only their tasks."), { skip: true }),
      s("tasks.views", msg("Board, calendar or timeline"), msg("Board shows columns like a card wall; Calendar shows due dates by month; Timeline shows how long each task runs."), { skip: true }),
      s("tasks.search", msg("Find a task"), msg("Search by title, person or agent."), { skip: true }),
      s("tasks.columns", msg("Move a card along"), msg("Drag a card to the next column, or open it to see its plan, checklist, files and comments."), { skip: true }),
    ],
  },
  {
    id: "approvals", title: msg("Approvals"), route: "/approvals", also: ["/approve"],
    steps: [
      s("page.title", msg("Decisions waiting for you"), msg("Agents and colleagues ask before anything important. Answer here or from your phone.")),
      s("approvals.card", msg("A decision"), msg("Read what it wants to do and why."), { skip: true }),
      s("approvals.actions", msg("Approve, always or deny"), msg("Approve once, allow it always for this kind of step, or deny with a reason."), { skip: true }),
      s("approvals.history", msg("History"), msg("Every decision taken, by whom and when."), { skip: true }),
    ],
  },
  {
    id: "chat", title: msg("Chat"), route: "/chat",
    steps: [
      s("page.title", msg("Talk to an agent"), msg("Talk to your AI or any agent directly. Anything that needs approval becomes a task.")),
      s("chat.agents", msg("Pick an agent"), msg("Click an agent to open a conversation. Type, or hold the microphone to speak."), { skip: true }),
      s("chat.quick", msg("Ready questions"), msg("Tap one to start."), { skip: true }),
    ],
  },
  {
    id: "library", title: msg("Library"), route: "/explorer",
    also: ["/files", "/library", "/documents", "/sops", "/templates", "/packs", "/company-kit", "/search"],
    steps: [
      s(["library.tabs", "page.title"], msg("The Library"), msg("Every file, document, SOP and guideline in one place. Browse folders, or open Documents, SOPs, Guidelines, Templates and Search."), { on: "/explorer" }),
      s("files.company", msg("Pick a company"), msg("Each company in the group has its own folders."), { on: "/explorer", skip: true }),
      s("files.tree", msg("Folders"), msg("Open a folder to see its files. Your AI files new documents in the right one."), { on: "/explorer", skip: true }),
      s("files.upload", msg("Upload"), msg("Drag files here, or click Upload. Your AI reads the Library before it works."), { on: "/explorer", skip: true }),
      s("files.views", msg("List or grid"), msg("Show files as a list or as tiles."), { on: "/explorer", skip: true }),
      s(["nav:/handoffs", "css:a[href^='/handoffs']"], msg("For other companies"), msg("Upload files for another company in the group from the For other companies tab: you check them, then they go to that company's Library."), { on: "/explorer", skip: true }),
    ],
  },
  {
    id: "handoffs", title: msg("For other companies"), route: "/handoffs",
    steps: [
      s("page.title", msg("Files for other companies"), msg("Upload a file for another company, check it, then hand it over to their Library.")),
      s("handoffs.tabs", msg("Upload, check, hand over"), msg("Upload, To check, Handed over and Received: each file moves along these tabs."), { skip: true }),
      s("handoffs.upload", msg("Upload for a company"), msg("Pick the company, drop the files, then check their titles before they go."), { skip: true }),
    ],
  },
  {
    id: "forms", title: msg("Forms & reports"), route: "/forms", also: ["/reports"],
    steps: [
      s("page.title", msg("Forms"), msg("Claims, advances, monthly records and requests, with their deadlines."), { on: "/forms" }),
      s("forms.tabs", msg("To hand in, or all forms"), msg("What you still need to hand in, and every form of the company."), { on: "/forms", skip: true }),
      s("forms.list", msg("Download, hand in, or ask your AI"), msg("Download the blank form, hand it in with receipts, or let your AI fill it in."), { on: "/forms", skip: true }),
      s(["hub.tabs"], msg("Reports"), msg("The Reports tab holds what agents wrote up for you: summaries and tables to download."), { on: "/forms", skip: true }),
    ],
  },
  {
    id: "members", title: msg("Members and teams"), route: "/settings/members", perm: ["members.manage", "team.manage"],
    steps: [
      s("page.title", msg("Your people"), msg("Everyone who can sign in: their role, company, department and who they report to.")),
      s("settings.add", msg("Add a member"), msg("Add someone by email with their role. They get a sign-in email with a link."), { skip: true }),
      s("settings.list", msg("Open a person"), msg("Click a person to change their role, company, department, team and what of the Library they read."), { skip: true }),
      s("hub.tabs", msg("Organization and people"), msg("Companies, roles and access, staff computers and AI limits are the other tabs."), { skip: true }),
    ],
  },
  {
    id: "organization", title: msg("Organization"), route: "/organization", perm: ["office.view"],
    steps: [
      s("page.title", msg("Companies and departments"), msg("One company per business in the group, each with its departments, heads and teams.")),
      s("organization.add", msg("Add a company"), msg("Pick its industry and it comes with departments and a ready AI team."), { skip: true }),
      s("organization.company", msg("Open a company"), msg("See its departments, who heads each one, and its people."), { skip: true }),
      s("hub.tabs", msg("Members and roles"), msg("The Members tab adds people; Roles and access sets what each role may do."), { skip: true }),
    ],
  },
  {
    id: "mail", title: msg("Microsoft 365"), route: "/mail", perm: ["agents.own", "assistants.use", "channels.manage"],
    steps: [
      s("page.title", msg("Your Microsoft 365"), msg("Your Outlook mail, calendar and Teams chats in one place, from your own connection.")),
      s(["mail.tabs", "page.actions"], msg("Mail, calendar and Teams"), msg("Switch between your mail, your calendar and your Teams chats here."), { skip: true }),
      s(["mail.connect", "outlook.connection"], msg("Connect once"), msg("If it asks you to connect, sign in with your Microsoft work account once."), { skip: true }),
      s("mail.drafts", msg("Drafts wait for you"), msg("Your AI drafts replies; nothing is sent until you press Send."), { skip: true }),
      s("mail.accounts", msg("Other email accounts"), msg("Connect Gmail or another mailbox to back up its attachments into your files."), { skip: true }),
    ],
  },
  {
    id: "settings", title: msg("Settings"), route: "/settings",
    steps: [
      s("page.title", msg("Your account and this workspace"), msg("Your password and sign-in, your language, and how the app looks."), { on: "/settings" }),
      s("settings.system-mail", msg("System mail"), msg("Owners: the Microsoft 365 address the office sends sign-in emails from. Turn it on and send a test."), { on: "/settings", skip: true }),
      s("settings.language", msg("Language"), msg("Bahasa Melayu or English, for the app and your AI."), { on: "/settings", skip: true }),
      s("hub.tabs", msg("Connections"), msg("Channels (phone notices, Telegram, WhatsApp), the AI Engine, file storage and logins are the other tabs."), { on: "/settings", skip: true }),
    ],
  },
  {
    id: "channels", title: msg("Connections"), route: "/channels",
    steps: [
      s("page.title", msg("Reach the office from your phone"), msg("Phone notifications, Telegram and WhatsApp, and which agent answers where.")),
      s("channels.push", msg("Phone notifications"), msg("Turn them on to approve and answer from your phone."), { skip: true }),
      s(["channels.whatsapp", "channels.telegram"], msg("WhatsApp and Telegram"), msg("Link your number to talk to your AI and send receipts as photos."), { skip: true }),
      s("channels.microsoft", msg("Microsoft"), msg("Your Microsoft work account: mail, calendar and Teams for your AI."), { skip: true }),
    ],
  },
  {
    id: "ai-engine", title: msg("AI Engine"), route: "/ai-engine", perm: ["engine.view", "engine.manage"],
    steps: [
      s("page.title", msg("The AI engine"), msg("Where the office's AI models come from, and what every agent spends.")),
      s("ai-engine.add", msg("Add a provider"), msg("Paste a provider key and test the connection."), { skip: true }),
      s("ai-engine.tabs", msg("Models and spend"), msg("Choose the models for smart, fast and bulk work, and see the spend."), { skip: true }),
    ],
  },
  {
    // Prima opens as its own app (outside the office), so this tour shows where its link is.
    id: "prima", title: msg("Prima"), route: "/prima", stay: true,
    steps: [
      s(["nav:/prima"], msg("Prima Secure"), msg("Click Prima to open Prima Secure: clocking in, rosters, cases, HR, claims and more. It opens with this same sign-in; its menu has Back to the office.")),
      s(undefined, msg("Your AI and Prima"), msg("Your AI follows the same SOPs and workflows from the Library. Owners match each company to Prima on the Prima page.")),
    ],
  },
  {
    id: "getting-started", title: msg("Getting started"), route: "/getting-started", also: ["/start"],
    steps: [
      s("page.title", msg("Getting started"), msg("The steps for your role, in order. Each one ticks itself when it is done.")),
      s("gs.progress", msg("How far you are"), msg("Your progress, and the welcome tour to take again."), { skip: true }),
      s("gs.steps", msg("Do it, or show me"), msg("Do it opens the page; Show me walks you through it. Some steps you tick yourself."), { skip: true }),
      s("gs.tours", msg("A tour of every page"), msg("Pick any page for a short tour."), { skip: true }),
    ],
  },
];

export const TOURS: Tour[] = [...WELCOME, ...PAGES];

export const tourById = (id: string) => TOURS.find((t) => t.id === id);

export const tourAllowed = (tour: Tour, perms: string[]) => !tour.perm || tour.perm.some((p) => perms.includes(p));

/** The welcome tour for a role group. */
export const welcomeTour = (group: Group | undefined): Tour => TOURS.find((t) => t.welcome === (group ?? "staff"))!;

/** The page tours this person may take, in the order they are listed. */
export const pageTours = (perms: string[]) => PAGES.filter((t) => tourAllowed(t, perms));

const hits = (pathname: string, route: string) =>
  route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`);

/** The tour of the page at `pathname` (its own route first, the longest match wins). */
export function tourFor(pathname: string, perms: string[]): Tour | undefined {
  let best: Tour | undefined;
  let score = -1;
  for (const t of PAGES) {
    if (!tourAllowed(t, perms)) continue;
    for (const r of [t.route, ...(t.also ?? [])]) {
      const sc = r.length * 2 + (r === t.route ? 1 : 0);
      if (hits(pathname, r) && sc > score) {
        best = t;
        score = sc;
      }
    }
  }
  return best;
}

/** Where a step happens: its own page, the tour's page, or wherever the person is. */
export function stepRoute(tour: Tour, step: TourStep): { to: string; search?: Record<string, unknown> } | undefined {
  if (step.on) return { to: step.on, search: step.search };
  return tour.stay ? undefined : { to: tour.route };
}

/** The CSS selector for one anchor. */
export function selectorOf(anchor: string): string {
  if (anchor.startsWith("css:")) return anchor.slice(4);
  if (anchor.startsWith("nav:")) {
    const to = anchor.slice(4).replace(/"/g, "");
    return `aside nav a[href="${to}"], nav[aria-label] a[href="${to}"], [data-tour="nav.${to}"]`;
  }
  const id = anchor.replace(/"/g, "");
  return `[data-tour~="${id}"], [data-guide="${id}"]`;
}

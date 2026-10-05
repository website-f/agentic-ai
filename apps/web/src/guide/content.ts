/** What the user guide says about every page in GUIDE_PAGES (targets.ts), in plain words.
 *
 * Written from the real screens: wrap a label people see on screen in **double asterisks**
 * and the guide shows it as a small UI chip. A step's `target` is a target id from
 * targets.ts: hovering or tapping the step lights up that box on the screenshot.
 * content.test.ts checks every page has a doc, every target exists and every link resolves.
 *
 * Keep this file free of React and icon imports: scripts/guide-to-md.mjs loads it in Node. */

export interface DocStep {
  text: string;
  /** A target id from targets.ts: its box lights up on the screenshot. */
  target?: string;
}

export interface Recipe {
  title: string;
  /** Show this captured state ("<page>:<state>") while reading the recipe. */
  state?: string;
  steps: DocStep[];
}

export interface PageDoc {
  /** One or two lines: what the page is for. */
  purpose: string;
  /** What you can do here. */
  can: string[];
  /** What each highlighted box on the screenshot is (target id -> one line). */
  spots: Record<string, string>;
  howto: Recipe[];
  tips: string[];
  /** Who can use it, in words. */
  who: string;
  /** Related guide page ids. */
  related: string[];
}

export interface FlowDoc {
  /** One or two lines shown above the video. */
  summary: string;
  /** What happens, in order: the caption list when the video has no chapters yet. */
  steps: string[];
}

/** Sidebar order of the groups. */
export const GUIDE_GROUPS = ["Home", "Office", "Work", "Documents", "Collaboration", "Knowledge", "Operations", "Admin", "Help"] as const;

const s = (text: string, target?: string): DocStep => (target ? { text, target } : { text });

const EVERYONE = "Everyone who can sign in. What you can change depends on your role.";

export const PAGE_DOCS: Record<string, PageDoc> = {
  // ------------------------------------------------------------------ Home
  home: {
    purpose: "Your start page: today at a glance. How many agents are working, what waits for you, whether the system is healthy and what to set up next.",
    can: [
      "See four live counts: **Agents**, **Working now**, **Waiting on you** and **To review**. Click one to jump to that list.",
      "Answer agents that check in or hit a budget warning under **Agents asking**: **Give a task**, **See budget** or **Dismiss**.",
      "Watch **Spend vs budget**: every agent with a budget, and who is close to the limit.",
      "Follow the **Getting started** checklist: branches, members, AI providers and your first agent.",
      "Check the **System** panel: every part of the system, running or down. It refreshes every 15 seconds.",
      "Staff: create or open your AI twin from the **Meet your AI twin** card.",
    ],
    spots: {
      "home.health": "System health: every service, running or down, checked every 15 seconds.",
      "home.getting-started": "The four first steps for a new office, with a button for each.",
      "home.shortcuts": "Quick links to Organization, Members and Agents.",
    },
    howto: [
      {
        title: "Set up a new office in four steps",
        steps: [
          s("Find the **Getting started** card. It shows how many of the four steps are done.", "home.getting-started"),
          s("Click **Add branch** to create one branch for each company you run."),
          s("Click **Add member** to invite the people who will use the office."),
          s("Click **Connect** to add an AI provider. A free tier is enough to start."),
          s("Click **New agent** to build your first agent. The card ticks itself off as you go."),
        ],
      },
      {
        title: "Check that everything is running",
        steps: [
          s("Look at the pill under the greeting: **All systems running** means all is well."),
          s("If it says **Needs attention**, open the **System** panel to see which part is down.", "home.health"),
          s("Tell your administrator which part is down. The panel refreshes by itself."),
        ],
      },
    ],
    tips: [
      "The **Getting started** card is hidden for staff. Staff see their AI twin card instead.",
      "Budget warnings start at 80% of an agent's limit. At 100% the agent pauses and asks.",
    ],
    who: EVERYONE,
    related: ["overview", "approvals", "tasks", "organization"],
  },

  "my-worker": {
    purpose: "Staff only: the home of the one AI worker you hired. See what it is doing, what waits for you, its duties and the hours it works.",
    can: [
      "Hire your AI worker in five short steps the first time you sign in: company, the worker, its job, working hours and the offer letter.",
      "See its status: **Working**, **Waiting for you**, **Paused**, on a break or **Free for work**.",
      "Use the quick actions: **Give a task**, **Chat**, **Change hours** and **Add a duty**.",
      "Answer what waits for you: approvals, questions and results to review.",
      "Follow today's timeline, its working week, its duties and its job.",
    ],
    spots: {
      "my-worker.status": "What your worker is doing right now.",
      "my-worker.actions": "Give a task, chat with it, change its hours or add a duty.",
      "my-worker.week": "Its working week: working hours, breaks and rest days.",
    },
    howto: [
      {
        title: "Hire your AI worker",
        state: "welcome",
        steps: [
          s("On **My AI worker**, click **Start hiring**. The hiring steps open full screen."),
          s("**Your company**: pick your company and department. If you are not sure, choose **Not sure yet**; your manager can set it later."),
          s("**Meet your AI worker**: give it a name, a job title and say how it should work. Tick what it must ask you about first."),
          s("**Its job** (optional): pick a role blueprint, workflows it follows, recurring duties and a first task."),
          s("**Working hours**: pick a quick start such as **Office week**, or set the days, hours and breaks yourself."),
          s("**Offer letter**: read the letter of appointment and click **Hire**. Then click **Meet** to go to work."),
        ],
      },
      {
        title: "Give your worker a task",
        steps: [
          s("Click **Give a task** in the quick actions.", "my-worker.actions"),
          s("Write what you need and what done looks like, then create the task."),
          s("Watch the status card change to **Working**. Results that need you appear under **Waiting for you**.", "my-worker.status"),
        ],
      },
      {
        title: "Change its working hours",
        steps: [
          s("Click **Change hours**, or **Change** on the **Its week** card.", "my-worker.week"),
          s("Set the working days, start and finish times and breaks."),
          s("Click **Save hours**. Work given outside the hours waits until it is back; chat always gets an answer."),
        ],
      },
    ],
    tips: [
      "Your worker tells people it is an AI when it deals with others.",
      "You choose your company once. After that, only an admin can move you.",
      "A duty is written in plain words, such as \"every Monday at 9am\". The page reads it back so you can check it.",
    ],
    who: "Staff. Managers and owners use Agents instead.",
    related: ["tasks", "approvals", "chat", "schedules"],
  },

  assistants: {
    purpose: "Your own private AI assistants. Nobody else sees them. Ask about the whole company, let it draft Gmail replies you approve, and chase people on WhatsApp.",
    can: [
      "Create an assistant from a ready-made card: **Chief of Staff**, **Inbox Assistant**, **Company Analyst** or **My Assistant**.",
      "Chat with it, by typing or with the microphone.",
      "Use one-tap questions such as **What's happening today?**, **Where are we slacking?** or **Weekly report**.",
      "Review **Drafts**: emails and calendar changes it prepared. Nothing is sent or added until you approve it.",
      "Connect Gmail, Google Calendar and your WhatsApp.",
      "Change its name, how it works for you, how it thinks and what it may use in **Settings**.",
    ],
    spots: {
      "assistants.chat": "The conversation with your assistant.",
      "assistants.quick": "One-tap questions. Gmail and calendar ones appear once Google is connected.",
      "assistants.connections": "Gmail, Calendar and WhatsApp: what is connected.",
    },
    howto: [
      {
        title: "Create your first assistant",
        steps: [
          s("Pick a card, for example **Chief of Staff**, and click **Create**. Use **Customise** to change the name first."),
          s("In **Anything it should know about you**, add a line about your job if you like."),
          s("Ask a first question, or tap one of the one-tap questions.", "assistants.quick"),
        ],
      },
      {
        title: "Let it draft your email replies",
        steps: [
          s("Click **Connect Google** in the connections card and sign in to Google.", "assistants.connections"),
          s("Tap **Check my inbox** or **Draft my replies**.", "assistants.quick"),
          s("Open the **Drafts** tab. Edit the subject or text if needed."),
          s("Click **Send** to send it, or **Discard** to drop it. Nothing was sent before you clicked."),
        ],
      },
      {
        title: "Link your WhatsApp",
        steps: [
          s("Click **Link my WhatsApp**. You get a code that works for 10 minutes.", "assistants.connections"),
          s("From your phone, send **LINK** and the code to the office WhatsApp number. **Open WhatsApp** does this for you on a phone."),
          s("Your assistant can now reach you, and chase people for you, on WhatsApp."),
        ],
      },
    ],
    tips: [
      "Gmail is drafts only: the assistant prepares replies, you send them.",
      "Calendar guests get an invitation only when you confirm the change in **Drafts**.",
      "Voice turns your speech into text in the message box. You can edit it before sending.",
    ],
    who: "Everyone who can create work (all roles except approver and viewer). Each person's assistants are private to them.",
    related: ["chat", "channels", "overview"],
  },

  overview: {
    purpose: "Every company side by side: work done, what is failing or waiting, and AI spend, with a short AI briefing.",
    can: [
      "Pick a period: **Today**, **7 days**, **30 days** or **90 days**.",
      "Read the totals: agents, tasks done, failed, waiting on people, reports and AI spend.",
      "Compare companies in the **Branches compared** table. Click a column to sort, or a company to open its office.",
      "Ask for a **Briefing**: a short summary written from the numbers on the page.",
      "See what **Needs attention**: failures, long waits, incidents and budgets.",
    ],
    spots: {
      "overview.range": "The period every number on the page covers.",
      "overview.branches": "Every company side by side. Click a column to sort.",
      "overview.briefing": "A short AI summary of the numbers on this page.",
    },
    howto: [
      {
        title: "Get a quick summary for a meeting",
        steps: [
          s("Choose the period, for example **7 days**.", "overview.range"),
          s("Click **Brief me** in the briefing card. It reads only the numbers on this page.", "overview.briefing"),
          s("Scroll to **Branches compared** to show the details behind it.", "overview.branches"),
        ],
      },
    ],
    tips: [
      "A briefing costs a fraction of a cent. A saved one is marked **(saved, no new cost)**.",
      "You only see the companies and departments your role covers.",
    ],
    who: EVERYONE,
    related: ["impact", "office", "reports"],
  },

  impact: {
    purpose: "What the AI team measurably did per company and department: tasks done, time freed against what it cost, and what it could do next.",
    can: [
      "See measured results for **7 days**, **30 days** or **90 days**: tasks completed, approval turnaround and skills learned.",
      "See estimates, clearly marked **(est.)**: time freed and the value of staff time.",
      "Change the assumptions behind the estimates: minutes per task, staff cost per hour and time spent checking AI work.",
      "Work out the return on AI spend with the ROI calculator.",
      "Try what each AI team can do with **Try it**, and add a ready-made team to a company.",
    ],
    spots: {
      "impact.totals": "Measured results, with estimates marked as estimates.",
      "impact.roi": "Return on the AI spend, worked out from your own assumptions.",
      "impact.try": "Example jobs per team. **Try it** opens a new task with an example brief.",
    },
    howto: [
      {
        title: "Make the estimates fit your office",
        steps: [
          s("Open **Assumptions behind the estimates**."),
          s("Set **Minutes a person takes per task** and **Staff cost per hour** for your office."),
          s("The totals and the ROI calculator update at once.", "impact.roi"),
          s("Click **Reset** to go back to the defaults. Your numbers are saved in this browser only."),
        ],
      },
      {
        title: "Try a new kind of work",
        steps: [
          s("Scroll to **What your AI team can do**.", "impact.try"),
          s("Click **Try it** on a card. A new task opens with an example brief."),
          s("Change the brief to fit your work and create the task. Nothing runs before you create it."),
        ],
      },
    ],
    tips: [
      "Time freed and staff value are estimates from your assumptions; task counts and AI cost are measured.",
      "Treat forecasts as ranges, not promises.",
    ],
    who: "Owners, admins, branch managers and heads of department.",
    related: ["overview", "organization", "learning"],
  },

  // ------------------------------------------------------------------ Office
  office: {
    purpose: "A live office for each company. Every agent sits at a desk in its department, and you can see who is working, waiting or stuck.",
    can: [
      "Switch company with the tabs at the top, and switch between **Map** and **List**.",
      "Zoom in and out, or click **Fit the office**.",
      "Click an agent to open its panel: **Give a task**, **Browse for me**, **Pause** or **Profile**.",
      "Hand out new tasks that have no agent yet: drag a card from **To hand out** onto an agent.",
      "See who is **Working**, **Waiting on you**, **In a meeting**, **In the breakroom**, **Stuck on an error** or **Paused**.",
    ],
    spots: {
      "office.floor": "The live office: each agent at its desk, showing what it is doing.",
      "office.branch": "Pick the company whose office you want to see.",
    },
    howto: [
      {
        title: "See what an agent is doing",
        state: "agent",
        steps: [
          s("Pick the company at the top.", "office.branch"),
          s("Click an agent at its desk. Its panel opens on the side.", "office.floor"),
          s("The **Monitor** tab shows its live steps; **Work** shows what it is working on and what it produced."),
          s("Anything waiting on you is pinned at the top of the panel. Decide it right there."),
        ],
      },
      {
        title: "Hand a task to an agent",
        steps: [
          s("New tasks without an agent wait in the **To hand out** tray."),
          s("Drag a card onto an agent, or use **Assign to…**.", "office.floor"),
          s("The task is assigned and started at once."),
        ],
      },
    ],
    tips: [
      "On a phone, tap an agent in the strip along the bottom to move the view to it.",
      "Agents you can only watch cannot be given tasks.",
    ],
    who: EVERYONE,
    related: ["monitor", "agents", "tasks"],
  },

  monitor: {
    purpose: "Watch agents work live: their steps, every tool they use, and their browser screen.",
    can: [
      "See **Everyone at work** as a wall of live screens, refreshed every 2 seconds.",
      "Pick one agent to see its current task, its live screen and a **Step by step** list.",
      "See what it cost in the last 24 hours and which helpers are on the job.",
    ],
    spots: {
      "monitor.agents": "Everyone at work, and each agent. Pick one to follow it.",
      "monitor.screen": "The agent's live screen and its steps as they happen.",
    },
    howto: [
      {
        title: "Follow one agent live",
        steps: [
          s("Pick the agent in the list.", "monitor.agents"),
          s("Watch its screen and the **Step by step** list update as it works.", "monitor.screen"),
          s("Click **Profile** to open the agent's own page."),
        ],
      },
    ],
    tips: [
      "An eye icon means you can only watch that agent; a lock means it is private.",
      "When nobody is working, the wall says **Nobody is working right now**.",
    ],
    who: EVERYONE,
    related: ["office", "agents", "tasks"],
  },

  agents: {
    purpose: "Your AI team: create agents, place them in a department, set what they may do, and see who reports to whom.",
    can: [
      "Create an agent in six steps with **New agent**: template, placement, identity, SOPs, permissions and review.",
      "Browse agents **By department** or as an **Org chart**.",
      "Open an agent to chat, give tasks, set its budget, edit its permissions and SOPs, or pause and retire it.",
      "Change who reports to whom by dragging in the org chart.",
    ],
    spots: {
      "agents.new": "Start the six-step agent builder.",
      "agents.card": "An agent: its model, role and pills such as **Auto** or **Budget**.",
      "agents.org": "Switch to the org chart to see and change who reports to whom.",
    },
    howto: [
      {
        title: "Create an agent",
        state: "new",
        steps: [
          s("Click **New agent**.", "agents.new"),
          s("**Template**: pick a ready-made role, or **Blank agent**."),
          s("**Placement**: choose the company and department it works in."),
          s("**Identity**: give it a name, a job title, a colour and its way of working."),
          s("**SOPs**: the company and department SOPs apply by themselves; tick any extra ones from the library."),
          s("**Permissions**: pick a model group and set each tool to **Allow**, **Ask me** or **Never**."),
          s("**Review** what the agent will be told, then click **Create agent**."),
        ],
      },
      {
        title: "Set a budget for an agent",
        state: "detail",
        steps: [
          s("Click an agent card to open it.", "agents.card"),
          s("Open the **Team & budget** tab."),
          s("Fill in **Tokens per day** or **US dollars per month** and click **Save**."),
          s("At 80% you get a warning; at 100% the agent pauses and asks you."),
        ],
      },
      {
        title: "Change who reports to whom",
        steps: [
          s("Click **Org chart**.", "agents.org"),
          s("Drag an agent onto its new manager, or use the **Reports to** menu."),
          s("An agent cannot report to someone below it."),
        ],
      },
    ],
    tips: [
      "**Ask me** means the agent stops and asks you before using that tool. **Never** removes the tool completely.",
      "**Work on auto** lets Ask-me tools run without asking, except high-risk ones.",
      "Retired agents leave the roster, but their past tasks and history stay.",
      "Staff have one AI twin instead of a New agent button.",
    ],
    who: "Everyone can see agents. Owners, admins, branch managers and heads of department create and change them; staff have their own twin.",
    related: ["blueprints", "sops", "office", "chat"],
  },

  // ------------------------------------------------------------------ Work
  tasks: {
    purpose: "A board of everything your agents are working on, from new to done.",
    can: [
      "Create a task with **New task**: what you need, who does it, priority, files and whether you review the result.",
      "Follow every task through the columns: **Triage**, **Ready**, **Running**, **Waiting**, **In review** and **Done**.",
      "Drag a card between columns, for example from **In review** to **Done**.",
      "Open a card to see its plan, result, sub-tasks, timeline and the self-check.",
      "**Accept**, **Send back**, **Start**, **Retry**, **Cancel** or **Delete** a task, and call a **Meeting** about it.",
      "Search by title, agent or label, and retry all failed tasks at once.",
    ],
    spots: {
      "tasks.new": "Create a new task.",
      "tasks.columns": "The board: each column is a stage of the work.",
      "tasks.card": "One task: title, agent, priority and labels. Click it to open.",
      "tasks.search": "Filter by title, agent or label.",
    },
    howto: [
      {
        title: "Give a task",
        state: "new",
        steps: [
          s("Click **New task**.", "tasks.new"),
          s("Write a **Title** and a **Brief**: what you need and what done looks like."),
          s("Pick the agent in **Assign to**, and a **Priority**."),
          s("Add files with **Attach or upload** if the agent needs them."),
          s("Keep **I review the result** on, then click **Create and start**."),
        ],
      },
      {
        title: "Check and accept a result",
        state: "sheet",
        steps: [
          s("Find the card in the **In review** column.", "tasks.columns"),
          s("Click the card to open it, and read the **Result**.", "tasks.card"),
          s("Click **Accept** if it is right. The task moves to **Done**."),
          s("If not, click **Send back**, write what should change, and the agent works on it again."),
        ],
      },
      {
        title: "Find a task quickly",
        steps: [
          s("Type part of the title, the agent's name or a label in the search box.", "tasks.search"),
          s("Only matching cards stay on the board."),
        ],
      },
    ],
    tips: [
      "**Running** and **Waiting** are moved by agents; you move the other columns.",
      "The plan shows if the self-check passed, or what it caught and fixed before hand-in.",
      "On a phone, press and hold a card to drag it, or use the column switcher.",
      "Deleting a task keeps the reports and files it produced.",
    ],
    who: "Everyone can see tasks. Creating and acting on tasks needs a role that can create work (not approver or viewer).",
    related: ["approvals", "reports", "meetings", "workflows"],
  },

  approvals: {
    purpose: "Decisions your agents are waiting on: tools they want to use, questions, and budgets that ran out.",
    can: [
      "See what is waiting in **Waiting**, and past decisions in **History**.",
      "For a tool request: **Approve once**, **Always allow** that agent, or **Deny** with a reason.",
      "For a question: tap a suggested answer or type your own, then **Send answer**.",
      "For a budget stop: **Allow more** or **Stop the task**.",
      "Decide from a phone notification too: it opens a one-screen page for that decision.",
    ],
    spots: {
      "approvals.card": "A decision waiting: who asks, what for, the risk and why.",
      "approvals.actions": "Approve once, always allow, or deny.",
      "approvals.history": "Every past decision, who made it and when.",
    },
    howto: [
      {
        title: "Approve or deny a request",
        steps: [
          s("Read the card: which agent, which tool, and **Why**.", "approvals.card"),
          s("Click **Approve once** to let it do this one thing.", "approvals.actions"),
          s("Or click **Always allow** so that agent need not ask again for this tool."),
          s("Or click **Deny** and, if you like, write a reason. The agent reads it."),
        ],
      },
      {
        title: "Look back at a decision",
        steps: [
          s("Open the **History** tab.", "approvals.history"),
          s("Each card shows what was decided, by whom and when."),
        ],
      },
    ],
    tips: [
      "**Always allow** is not offered for high-risk requests: those are asked every time.",
      "Turn on phone notifications in Channels to decide from anywhere.",
    ],
    who: "Everyone can see approvals. Owners, admins, managers, supervisors, staff and approvers can decide.",
    related: ["tasks", "channels", "activity"],
  },

  reports: {
    purpose: "What agents wrote up for you: a summary first, then tables you can sort, filter and download.",
    can: [
      "Search reports by title.",
      "Open a report to read its **Summary** and tables.",
      "Sort a table by clicking a column, filter long tables, and download a table as **CSV**.",
      "Jump to the task that produced the report.",
    ],
    spots: {
      "reports.list": "Every report agents wrote, newest first.",
      "reports.search": "Search reports by title.",
    },
    howto: [
      {
        title: "Download a table to Excel",
        steps: [
          s("Find the report in the list, or search for it.", "reports.search"),
          s("Click it to open.", "reports.list"),
          s("Click **CSV** above the table. The file opens in Excel or Google Sheets."),
        ],
      },
    ],
    tips: ["New reports appear in the list by themselves while the page is open."],
    who: EVERYONE,
    related: ["tasks", "overview", "documents"],
  },

  chat: {
    purpose: "Talk to any agent directly. When something needs doing, turn the reply into a task.",
    can: [
      "Pick an agent and chat with it.",
      "Speak instead of typing: click the microphone, talk, and your words appear in the box.",
      "Start a **New** conversation, or go back to an earlier one.",
      "Click **Make this a task** under a reply to turn it into a task.",
    ],
    spots: {
      "chat.agents": "Pick the agent you want to talk to.",
      "chat.composer": "Type your message, or use the microphone.",
    },
    howto: [
      {
        title: "Ask an agent something",
        state: "conversation",
        steps: [
          s("Pick the agent in the list.", "chat.agents"),
          s("Type your message and press Enter. Shift+Enter starts a new line.", "chat.composer"),
          s("Under its reply you see which model answered and which tools it used."),
        ],
      },
      {
        title: "Speak instead of typing",
        steps: [
          s("Click the microphone next to the message box.", "chat.composer"),
          s("Speak, then click **Stop**. Your words appear in the box."),
          s("Check the text and press Enter to send. Nothing is sent by itself."),
        ],
      },
      {
        title: "Turn a reply into a task",
        steps: [
          s("Click **Make this a task** under the agent's reply."),
          s("New task opens with the agent and the reply already filled in. Check it and create the task."),
        ],
      },
    ],
    tips: [
      "Anything that needs approval is suggested as a task instead of done in chat.",
      "Voice needs a speech-to-text model; an admin adds one in AI Engine.",
    ],
    who: "Everyone can open chat. Writing to agents needs a role that can create work.",
    related: ["tasks", "agents", "assistants"],
  },

  // ------------------------------------------------------------------ Documents
  "company-kit": {
    purpose: "Each company's facts that every document reuses: legal name, registration, address, bank, signatory, logo.",
    can: [
      "Pick a company and fill in its identity, contact, bank, people, money and brand details.",
      "Upload the company logo and see a live letterhead preview.",
      "Add your own facts under **More facts**; templates can use them.",
      "See how complete the kit is.",
    ],
    spots: {
      "company-kit.fields": "The company facts every document reuses.",
      "company-kit.save": "Save the kit.",
    },
    howto: [
      {
        title: "Fill in a company kit",
        steps: [
          s("Pick the company at the top."),
          s("Fill in the cards: identity, contact, bank, people, money and brand.", "company-kit.fields"),
          s("Click **Upload logo** and check the letterhead preview."),
          s("Click **Save kit**. Every new quotation, invoice and letter for this company uses these facts.", "company-kit.save"),
        ],
      },
    ],
    tips: [
      "Fill in the kit first: documents and packs pull from it.",
      "Only admins and the company's manager can change it.",
    ],
    who: "Everyone can read it. Admins and that company's manager can change it.",
    related: ["templates", "documents", "files"],
  },

  files: {
    purpose: "Company files: one place per company for all its documents. Drop a whole folder or zip and its folders are kept, every file is read and sorted, and how-to documents go to the library for agents.",
    can: [
      "Pick the company under **Company**, then drop files, whole folders or a .zip on the upload area.",
      "Follow each upload as it is unpacked, read and sorted, then read its report: what was found, what went to the library and what was held back.",
      "Browse the company's folders, search, filter by kind or department, or group the list **By kind** or **By department**.",
      "Open a file to see a preview, its summary, kind, department and folder, and change any of them.",
      "Download one file, a folder, everything for the company, or just the files you ticked, as a zip.",
      "Turn a procedure into an SOP or a workflow with **Make an SOP** or **Build a workflow**.",
      "Managers: **Release** a held-back file after checking it, or **Hold back** one yourself.",
    ],
    spots: {
      "files.company": "The company these documents belong to. Uploads and downloads are for this company only.",
      "files.upload": "Drop files, a whole folder or a zip here, or choose them.",
      "files.report": "One upload: its progress, then its report with flagged files and AI suggestions.",
      "files.tree": "The company's folders, with file counts and held-back files.",
      "files.filters": "Search, and filter by department or kind.",
      "files.list": "The files in the folder, with kind, department, status and library.",
      "files.download-folder": "Download the folder you are in as a zip.",
      "files.download-all": "Download every file this company has as a zip.",
      "files.library": "Make a file a guideline agents search and cite.",
    },
    howto: [
      {
        title: "Company documents: where to upload",
        steps: [
          s("Open **Company files** (under Documents) and pick the company under **Company**.", "files.company"),
          s("What to upload: SOPs, guides, checklists, flowcharts, forms, templates, certificates and contracts. A whole zip of the company's documents is fine."),
          s("Drop the zip, the files or a whole folder on the upload area, or click **Choose files** or **Choose a folder**.", "files.upload"),
          s("Wait while it shows **Unpacking**, **Reading** and **Sorting**. You can leave the page; the work carries on."),
          s("When it shows **Ready**, read the report: files by kind and department, how many went to the library, and what was held back.", "files.report"),
        ],
      },
      {
        title: "What happens to an upload by itself",
        steps: [
          s("Folders are kept as they were, so a file in TENDER/CARTA ALIR stays in that folder.", "files.tree"),
          s("Every file is read (scans too), given a kind such as SOP, form or certificate, and matched to a department."),
          s("How-to documents such as SOPs, guides and checklists go to the library, so agents search them and cite the page."),
          s("Files with passwords or staff ID numbers are **Held back**: kept and downloadable, but agents cannot read them until a manager checks them and clicks **Release**."),
        ],
      },
      {
        title: "View or download a file, a folder or everything",
        state: "sheet",
        steps: [
          s("Pick a folder on the left, or tap **Folders** on a phone.", "files.tree"),
          s("Click a file to open it: a preview, what it is and where it sits. **Download** gives you the original.", "files.list"),
          s("Click **Download folder** to get the folder you are in as a zip.", "files.download-folder"),
          s("Click **Download everything** to get all of the company's files.", "files.download-all"),
          s("To download a few, tick them and click **Download zip**."),
        ],
      },
      {
        title: "Turn a procedure into an SOP or a workflow",
        state: "sheet",
        steps: [
          s("Open the document, or tick several that belong together."),
          s("Click **Make an SOP** for written steps agents follow, or **Build a workflow** to run the job step by step."),
          s("Check the draft before you save it. The upload report also lists **AI suggestions** you can start from."),
        ],
      },
      {
        title: "Make a file a guideline",
        state: "sheet",
        steps: [
          s("Click the file to open it."),
          s("Turn on **Use as a guideline (library)**.", "files.library"),
          s("Pick **Who it is for**. Agents in that scope now search it and cite the page they used."),
        ],
      },
      {
        title: "Search inside every document",
        steps: [
          s("Click the search box at the top of any page, or press **/**, and start typing. On a phone, tap the magnifier.", "shell.search"),
          s("Pick a suggestion: a word from your own documents, a title, a heading, or one of your recent searches. The ↑ ↓ and Enter keys work too."),
          s("Press Enter for **Search all documents**: every file page by page, SOPs, documents, templates and wiki pages, with the matching words marked."),
          s("Put words in quotes for an exact phrase, like \"load system calculation\". Amounts and dates work as people write them: RM700, RM 700.00, 16hb. Reference numbers, like a PO or tender number, complete as you type."),
          s("Click a result: a file opens in Company files at the page that matched. You only find what you may open, and never a held-back file."),
        ],
      },
    ],
    tips: [
      "A held-back file never reaches agents until a manager releases it. The report says why in plain words and never shows the secret itself.",
      "Deleting a file shows it as missing in any pack that uses it.",
      "Certificates show **Valid until**, so you can renew them in time.",
    ],
    who: "Everyone can browse and download. Uploading and changing files needs a role that can create work; releasing held-back files needs a manager.",
    related: ["library", "sops", "workflows", "packs"],
  },

  templates: {
    purpose: "Quotations, invoices, letters, proposals and your own Word files, with {{placeholders}} that agents and people fill in.",
    can: [
      "Use a starter template, or make your own with **New template**.",
      "Upload your own Word file with **Word template**; its layout is kept.",
      "Insert company facts with one click: company name, address, document number, line items, total and more.",
      "Mark which fields must be filled and what type they are.",
      "Start a document from a template with **Use it**.",
    ],
    spots: {
      "templates.new": "Make a new template.",
      "templates.list": "Starter templates and your own.",
    },
    howto: [
      {
        title: "Make a template",
        steps: [
          s("Click **New template**.", "templates.new"),
          s("Give it a **Name**, pick a **Kind** and a **Number prefix**, such as QT."),
          s("Write the **Text**. Click the chips to insert company facts, the total or a signature block."),
          s("Check **Fields to fill**: they are found from the {{placeholders}}. Mark the ones that are required."),
          s("Click **Save template**."),
        ],
      },
      {
        title: "Use your own Word file",
        steps: [
          s("Click **Word template** and pick a .docx file."),
          s("Give it a name and click **Make template**. To change the text later, edit it in Word and upload again."),
        ],
      },
    ],
    tips: ["Document numbers count up by themselves, such as QT-2026-0001."],
    who: EVERYONE,
    related: ["documents", "company-kit", "packs"],
  },

  documents: {
    purpose: "Documents drafted by people or agents, checked automatically, approved, and exported to PDF, Word or Excel.",
    can: [
      "Create a document: **Write it with AI**, start from a **Blank page**, or pick a template.",
      "Fill fields by hand, or with **Fill with AI** from a description or a file.",
      "Rewrite a selected part: shorter, more formal, friendlier, fix grammar, or translate to Bahasa Melayu or English.",
      "See checks: what must be fixed and what to look at. Ask for **Review with AI**.",
      "Send for review, approve (which locks it) and export to PDF, Word or Excel.",
      "Go back to an earlier version in **History**.",
    ],
    spots: {
      "documents.new": "Create a new document.",
      "documents.list": "Every document, its status and how many checks need fixing.",
    },
    howto: [
      {
        title: "Draft a quotation with AI",
        state: "editor",
        steps: [
          s("Click **New document**.", "documents.new"),
          s("Pick the **Company**, and under **Start from** pick the quotation template."),
          s("Describe what it should say, and attach a file to work from if you have one."),
          s("Click **Create and fill**. The editor opens with fields and a preview on the letterhead."),
          s("Check every fact, fix anything the checks flag, and click **Save**."),
        ],
      },
      {
        title: "Approve and send a document",
        steps: [
          s("Open the document from the list.", "documents.list"),
          s("Click **Send for review**. A person with approval rights clicks **Approve** once all checks pass."),
          s("Use **Export** to download a PDF, Word or Excel file."),
        ],
      },
    ],
    tips: [
      "AI uses only what you wrote and the files you attached; it never invents facts. Still check every fact before you send it.",
      "Approved documents are locked. Click **Reopen** to change one.",
      "Ctrl+S (Cmd+S on a Mac) saves.",
    ],
    who: "Everyone can draft. Approving needs a role that decides approvals.",
    related: ["templates", "company-kit", "packs"],
  },

  packs: {
    purpose: "Submission packs, such as for a tender: a checklist matched to real files and documents, compiled into one PDF with a cover and contents.",
    can: [
      "Create a pack with a checklist, written by you or drafted with AI.",
      "Match items to files automatically with **Auto-fill from files**, then confirm each match.",
      "Draft missing documents, such as a cover letter, with **Draft it**.",
      "Ask an agent to prepare the pack.",
      "Compile one PDF with **Compile PDF**, then open or download it.",
    ],
    spots: {
      "packs.new": "Start a new submission pack.",
      "packs.list": "Your packs and how ready each one is.",
    },
    howto: [
      {
        title: "Prepare a submission pack",
        steps: [
          s("Click **New pack**.", "packs.new"),
          s("Give it a **Title**, pick the **Company** and say what it is for."),
          s("Click **Draft it with AI** for a checklist, edit the items, then **Create pack**."),
          s("Click **Auto-fill from files** and **Confirm** each match. Use **Add file** or **Draft it** for what is missing."),
          s("When everything required is ready, click **Compile PDF**."),
        ],
      },
    ],
    tips: [
      "The office prepares the pack; a person checks it and submits it. Agents never submit anything.",
      "Expired files are flagged in the checklist.",
    ],
    who: EVERYONE,
    related: ["files", "documents", "company-kit"],
  },

  // ------------------------------------------------------------------ Collaboration
  meetings: {
    purpose: "Agents discuss a decision with each other and agree on one recommendation. You can watch and add a point.",
    can: [
      "Start a meeting: the question, 2 to 5 agents and 1 to 4 rounds.",
      "Watch the live transcript and add a point while it runs.",
      "Read the outcome: the decision, options weighed, dissent and next steps.",
    ],
    spots: {
      "meetings.list": "Meetings happening now and past meetings.",
      "meetings.new": "Start a new meeting.",
    },
    howto: [
      {
        title: "Ask agents to decide something together",
        steps: [
          s("Click **New meeting**.", "meetings.new"),
          s("Write **What should they decide?**"),
          s("Pick 2 to 5 agents in **Who attends**. The first one you pick chairs."),
          s("Choose the number of **Rounds** and click **Start meeting**."),
          s("Open it from the list to follow the transcript and read the decision.", "meetings.list"),
        ],
      },
    ],
    tips: [
      "Meetings recommend; they never approve anything. Any action still goes through approvals.",
      "You can also start a meeting from a task with the **Meeting** button.",
    ],
    who: "Everyone can read meetings. Starting one needs a role that can create work.",
    related: ["tasks", "brain", "approvals"],
  },

  broadcasts: {
    purpose: "Send one message to every agent, a company, departments or chosen agents, and see who received it.",
    can: [
      "Send to **Everyone**, or **Choose** companies, departments or individual agents.",
      "Send an **Announcement** agents keep in mind, or **A task for each** agent.",
      "Ask each agent to reply.",
      "See who received it, who replied and which tasks were made.",
    ],
    spots: {
      "broadcasts.compose": "Write and send a broadcast.",
      "broadcasts.list": "Sent broadcasts, and how many received them.",
    },
    howto: [
      {
        title: "Tell every agent about a change",
        steps: [
          s("In **New broadcast**, choose **Everyone** or pick who it is for.", "broadcasts.compose"),
          s("Pick **Announcement** and write the message."),
          s("Click **Send broadcast**."),
          s("Open it in the sent list to see who received it.", "broadcasts.list"),
        ],
      },
    ],
    tips: [
      "Announcements stay in each agent's mind for 30 days.",
      "With **A task for each**, the first line becomes the task title, and the tasks wait in Triage for you to start.",
    ],
    who: "Everyone can read broadcasts. Sending needs a role that can create work.",
    related: ["office", "tasks", "sops"],
  },

  // ------------------------------------------------------------------ Knowledge
  sops: {
    purpose: "Written procedures your agents follow. Company and department SOPs apply by themselves; library SOPs are attached to chosen agents.",
    can: [
      "Write an SOP and choose who follows it: **Every company**, **One company**, **One department** or **Library**.",
      "Filter by who follows it, and search.",
      "Edit an SOP; every save becomes a new version.",
      "Delete an SOP; agents stop following it at once.",
    ],
    spots: {
      "sops.new": "Write a new SOP.",
      "sops.list": "SOPs grouped by who follows them.",
    },
    howto: [
      {
        title: "Write an SOP",
        steps: [
          s("Click **New SOP**.", "sops.new"),
          s("Give it a **Title**, such as \"Month-end close\"."),
          s("Under **Who follows it**, pick the scope and, if needed, the company or department."),
          s("Write the **Procedure**: purpose, steps, rules and output. Use **Preview** to check it."),
          s("Click **Create SOP**. Agents in scope follow it from their next step."),
        ],
      },
    ],
    tips: [
      "Agents read SOPs before every step.",
      "You cannot change who follows an SOP after it is created; make a new one instead.",
    ],
    who: "Everyone can read SOPs. Owners and admins write and change them.",
    related: ["library", "agents", "blueprints"],
  },

  library: {
    purpose: "Guidelines, manuals and policies, plus every SOP. Agents search them when the work needs it and cite the page they used.",
    can: [
      "Upload guidelines and choose who they are for: the whole company, one company or one department.",
      "See every source and whether it is ready (**Indexed**) or still being read.",
      "Try a search the way an agent would, and see the passage and citation it gets.",
      "Take a file out of the library; it stays in Files.",
    ],
    spots: {
      "library.upload": "Pick who it is for, then drop files.",
      "library.sources": "Every guideline and SOP, and whether it is ready.",
      "library.search": "Ask a question the way an agent would.",
    },
    howto: [
      {
        title: "Add a guideline",
        steps: [
          s("In **Add guidelines**, choose **Who it is for**.", "library.upload"),
          s("Drop the files. They show **Reading…**, then **Indexed** when agents can search them.", "library.sources"),
        ],
      },
      {
        title: "Check what an agent will find",
        steps: [
          s("Type a question in **Try a search** and click **Search**.", "library.search"),
          s("Each result shows the page, heading and citation. Strong matches are marked **Agents get this unasked**."),
        ],
      },
    ],
    tips: ["SOPs appear in the library by themselves."],
    who: "Everyone can search. Adding and taking out files needs a role that can create work.",
    related: ["files", "sops", "brain"],
  },

  brain: {
    purpose: "What the office knows: facts agents learned, wiki pages, and a nightly tidy-up called the dream.",
    can: [
      "Read and write wiki pages, and see links between them and their history.",
      "Teach the office a fact, correct one, or make it forget one.",
      "Search what the office knows, in English or Malay, including past conversations.",
      "See the knowledge as a graph, and read what each nightly dream changed.",
    ],
    spots: {
      "brain.tabs": "Pages, facts, search, graph and dreams.",
      "brain.search": "Search what the office knows.",
    },
    howto: [
      {
        title: "Teach the office a fact",
        steps: [
          s("Open the **Facts** tab.", "brain.tabs"),
          s("Type the fact in **Teach the office a fact** and choose **Who knows it**."),
          s("Click **Add**. Agents can recall it from now on."),
        ],
      },
      {
        title: "Find what the office knows",
        steps: [
          s("Open the **Search** tab.", "brain.tabs"),
          s("Ask your question in English or Malay.", "brain.search"),
          s("Results come from facts, pages and, if you tick it, past conversations."),
        ],
      },
    ],
    tips: [
      "The dream runs every night: it merges duplicates and settles contradictions (the newer fact wins).",
      "Correcting a fact keeps the old version under **Ended**.",
    ],
    who: "Everyone can read. Editing needs a role that can create work; vault tools and dream undo are for owners and admins.",
    related: ["library", "skills", "learning"],
  },

  skills: {
    purpose: "Procedures agents learned from their work. Nothing is used until a person approves it.",
    can: [
      "Browse the skill library and see how often each skill is used and accepted.",
      "Review **Proposals**: new skills, updates, merges and retirements agents suggest.",
      "Teach a skill from a web page, a file or pasted notes with **Teach from a source**.",
      "Write tests for a skill, run them, and let **Improve with AI** try better versions.",
      "See every version, compare them, and restore an older one.",
    ],
    spots: {
      "skills.list": "Skills agents can use, with how they perform.",
      "skills.proposals": "Changes agents proposed, waiting for a person.",
      "skills.teach": "Teach a skill from a link, a file or notes.",
    },
    howto: [
      {
        title: "Review a skill an agent proposed",
        steps: [
          s("Open the **Proposals** tab.", "skills.proposals"),
          s("Click a proposal. Read **Why**, the safety scan and the changes."),
          s("Click **Run tests** to compare the current and proposed versions."),
          s("Click **Approve**, **Edit and approve**, or **Reject**. When you reject, say why: the agent remembers."),
        ],
      },
      {
        title: "Test and improve a skill",
        state: "sheet",
        steps: [
          s("Click a skill in the library.", "skills.list"),
          s("Under **Tests**, click **Add**: a request, and what the answer must or must not contain."),
          s("Click **Run tests** to see how many pass."),
          s("Click **Improve with AI**. It rewrites from failing tests, tests each version and keeps the best."),
        ],
      },
      {
        title: "Teach a skill from a source",
        steps: [
          s("Click **Teach from a source**.", "skills.teach"),
          s("Pick **Link**, **File** or **Paste text**, and say what it should learn."),
          s("Click **Draft the skill**. It is tested, then waits in Proposals."),
        ],
      },
    ],
    tips: [
      "A safety scan checks every proposal; **Must fix** items block approval.",
      "A skill marked **Often sent back** has fewer than 70% of its results accepted.",
    ],
    who: "Everyone can see skills. Approving and retiring need approval rights; tests and drafts need a role that can create work.",
    related: ["learning", "brain", "agents"],
  },

  learning: {
    purpose: "What your agents learned, how each change was tested, what went live by itself, and what learning cost.",
    can: [
      "See for 7, 30 or 90 days: skills learned, waiting for review, skill success, facts learned, test pass rate and learning spend.",
      "Choose the autopilot: review everything, let proven changes go live, or let clean changes go live.",
      "Turn on **Self-check before hand-in**: a second model reads finished work against the request first.",
      "Read recent decisions and the most used skills.",
    ],
    spots: {
      "learning.kpis": "What was learned in the period.",
      "learning.autopilot": "How much may go live without a person, and the self-check.",
      "learning.recent": "Recent learning decisions.",
    },
    howto: [
      {
        title: "Decide how much is automatic",
        steps: [
          s("Find the **Autopilot** card.", "learning.autopilot"),
          s("Pick **Review everything** to approve every change yourself."),
          s("Or pick **Proven changes go live** (recommended): only changes with a clean safety scan whose tests pass at least as well."),
          s("Keep **Self-check before hand-in** on so agents fix gaps before you see the work."),
        ],
      },
    ],
    tips: [
      "Only an owner or admin can change the autopilot.",
      "Click **Waiting for review** to go straight to the proposals.",
    ],
    who: "Everyone can see it. Owners and admins change the autopilot.",
    related: ["skills", "brain", "impact"],
  },

  blueprints: {
    purpose: "Reusable role packages: instructions, model, tools, SOPs and skills. Define a role once, then apply it to any agent.",
    can: [
      "Create a blueprint with instructions, model group, autonomy and tool scope.",
      "Pick the library SOPs and skills it brings.",
      "Apply it to an agent so it starts as a specialist.",
    ],
    spots: {
      "blueprints.new": "Create a new blueprint.",
      "blueprints.apply": "Apply a blueprint to an agent.",
    },
    howto: [
      {
        title: "Create and apply a blueprint",
        steps: [
          s("Click **New blueprint**.", "blueprints.new"),
          s("Fill in **Name**, **Job title**, **Instructions** and **Model group**."),
          s("Choose **Ask before acting** or **Act on its own**, and set each tool to **Allow**, **Ask me** or **Never**."),
          s("Pick SOPs and skills, then click **Save blueprint**."),
          s("Click **Apply to an agent**, pick the agent and click **Apply**.", "blueprints.apply"),
        ],
      },
    ],
    tips: [
      "Applying replaces the agent's role, instructions, model, tools and SOPs with the blueprint's.",
      "Deleting a blueprint does not change agents already made from it.",
    ],
    who: "Owners, admins, branch managers, heads of department and staff.",
    related: ["agents", "sops", "skills"],
  },

  workflows: {
    purpose: "Draw how a job is done as connected steps, then run it: each step goes to its agent, and you take the decisions.",
    can: [
      "Create a workflow three ways: **Draw it yourself**, **Ask AI to draft it**, or **Start from a template**.",
      "Pick from 12 templates, such as **Client enquiry to quotation**, **Leave request** or **Month-end close**.",
      "Add steps for AI work, communication, documents, the web and people, such as an **Approval**.",
      "See problems before you run it, and let **Improve with AI** suggest changes.",
      "Run a job through it, give it with a task, or make it an agent's standard way of working.",
    ],
    spots: {
      "workflows.new": "Create a new workflow.",
      "workflows.list": "Your workflows, active or draft.",
      "workflows.run": "Run a job through the workflow.",
    },
    howto: [
      {
        title: "Build a workflow from a template",
        state: "editor",
        steps: [
          s("Click **New workflow** and choose **Start from a template**.", "workflows.new"),
          s("Pick a template. The editor opens with its steps."),
          s("Click a step to set who does it, and whether you check it before it moves on."),
          s("Check the problems button says **Looks good**, then click **Save**."),
        ],
      },
      {
        title: "Run a job through a workflow",
        steps: [
          s("Open the workflow from the list.", "workflows.list"),
          s("Click **Run**.", "workflows.run"),
          s("Say what the job is, add files, and pick the agent for each step."),
          s("Click **Start**. Decisions, questions and reviews wait for you under **Needs you**."),
        ],
      },
    ],
    tips: [
      "**Fill a web form** steps always wait for a person before submitting.",
      "**Draft email** steps prepare the email; a person sends it.",
      "Undo with Ctrl+Z in the editor.",
    ],
    who: "Owners, admins, managers, heads of department, supervisors, staff and operators.",
    related: ["tasks", "schedules", "agents"],
  },

  // ------------------------------------------------------------------ Operations
  schedules: {
    purpose: "Recurring work for your agents, and a record of every run with its result.",
    can: [
      "Create a schedule: which agent, what task, and when, such as **Every weekday at 9:00**.",
      "**Run now**, **Pause** or **Resume** a schedule.",
      "Read the **Run ledger**: every run, how long it took and its result.",
      "See **Incidents**: repeated failures with the same cause, grouped together.",
    ],
    spots: {
      "schedules.new": "Create a new schedule.",
      "schedules.list": "Your schedules and their last run.",
    },
    howto: [
      {
        title: "Schedule a weekly report",
        steps: [
          s("Click **New schedule**.", "schedules.new"),
          s("Give it a **Name**, pick the **Agent** and write the **Task title** and **Brief**."),
          s("Under **When**, pick **Every Monday at 9:00**, or another time."),
          s("Keep **Send results for review** on if you want to check each result. Click **Create schedule**."),
          s("The schedule appears in the list. Click **Run now** to try it straight away.", "schedules.list"),
        ],
      },
    ],
    tips: [
      "Failed runs retry by themselves after 5, 15 and 30 minutes.",
      "Each run creates a fresh task with the date added to its title.",
    ],
    who: "Everyone can see schedules. Creating and changing them needs a role that can create work.",
    related: ["tasks", "workflows", "my-worker"],
  },

  logins: {
    purpose: "Website logins your agents may use without ever seeing them, each locked to its own sites.",
    can: [
      "Save a login with the sites it may be used on.",
      "Choose who may use it: every company, one company, or only chosen agents.",
      "See when each login was last used.",
      "Change the sites, agents or password, or delete a login.",
    ],
    spots: {
      "logins.new": "Save a new login.",
      "logins.list": "Saved logins, each locked to its sites.",
    },
    howto: [
      {
        title: "Let agents sign in to a website",
        steps: [
          s("Click **Save a login**.", "logins.new"),
          s("Give it a name agents use, and the site address."),
          s("Type the username and password. They are encrypted and never shown again."),
          s("Choose who may use it, then click **Save login**.", "logins.list"),
        ],
      },
    ],
    tips: [
      "Passwords are never sent to an AI model; the browser types them in, only on the listed sites.",
      "Sites that need a one-time code, a captcha or a signing PIN stay with a person: the agent stops and asks.",
      "Every use is in the activity log.",
    ],
    who: "Owners, admins, branch managers, heads of department, and staff for their own logins.",
    related: ["agents", "activity", "channels"],
  },

  "ai-engine": {
    purpose: "Connect the AI providers your agents use, decide which models answer first, and see what every call costs.",
    can: [
      "Connect a provider with its key and test it.",
      "Arrange models into groups, such as Smart or Fast, in fallback order.",
      "See usage: calls, tokens, cost and errors per provider, model and kind of work.",
      "Try a prompt in the **Playground**.",
      "Set a safety limit on model calls per task.",
    ],
    spots: {
      "ai-engine.tabs": "Providers, model groups, usage, playground and settings.",
      "ai-engine.add": "Connect a new AI provider.",
    },
    howto: [
      {
        title: "Connect an AI provider",
        steps: [
          s("On **Providers**, pick a provider under **Connect a provider**.", "ai-engine.add"),
          s("Click **Get a key** to get one from the provider, then paste it."),
          s("Click **Test connection**, then **Save provider**."),
        ],
      },
      {
        title: "Choose which models answer first",
        steps: [
          s("Open **Model groups**.", "ai-engine.tabs"),
          s("In a group, click **Add model**, and drag the handle to set the order."),
          s("The first model answers. If it is down or out of credit, the next one does."),
        ],
      },
    ],
    tips: [
      "Keys are stored encrypted. Only the last four characters are ever shown again.",
      "Free tiers from Groq, OpenRouter, Mistral and HuggingFace are enough to start.",
      "Agents ask for a group, never a provider, so you can change models without touching agents.",
    ],
    who: "Owners and admins change it. Operators, approvers and viewers can look.",
    related: ["agents", "mcp-servers", "impact"],
  },

  "mcp-servers": {
    purpose: "Connect outside tool servers (MCP), such as a tracker or a CRM. Agents reach their tools through a search bridge, and every call is approved.",
    can: [
      "Connect a server with its address and, if needed, a key.",
      "See which servers are reachable and which tools each one offers.",
      "Turn a server off, refresh its tools, or remove it.",
    ],
    spots: {
      "mcp-servers.add": "Connect a new tool server.",
    },
    howto: [
      {
        title: "Connect a tool server",
        steps: [
          s("Click **Connect server**.", "mcp-servers.add"),
          s("Fill in **Name**, **URL** and, if the server needs one, the **Auth header**."),
          s("Click **Connect**. Its tools appear on the card."),
        ],
      },
    ],
    tips: ["Only web (http or https) servers are supported; the office never runs programs on your computer."],
    who: "Owners and admins.",
    related: ["ai-engine", "approvals", "agents"],
  },

  channels: {
    purpose: "Where the office reaches you: phone notifications, Telegram, WhatsApp, Gmail and API tokens, and which agent answers where.",
    can: [
      "Turn on notifications on this device, and send a test.",
      "Link your Telegram or WhatsApp account so you get messages and can answer there.",
      "Connect Gmail so your assistant can draft replies you approve.",
      "Admins: connect the Telegram bot and WhatsApp, decide which agent answers where, and make API tokens.",
    ],
    spots: {
      "channels.whatsapp": "WhatsApp for the office, and your own link.",
      "channels.telegram": "Telegram bot and your account.",
      "channels.push": "Notifications on this device.",
    },
    howto: [
      {
        title: "Get approvals on your phone",
        steps: [
          s("Open Channels on your phone. On an iPhone, first add the app to your Home Screen (Share, then Add to Home Screen).", "channels.push"),
          s("Turn on **Notifications on this device** and allow notifications."),
          s("Click **Send a test**. Tapping a notification opens the decision."),
        ],
      },
      {
        title: "Link your WhatsApp",
        steps: [
          s("In the WhatsApp card, click **Link my WhatsApp**.", "channels.whatsapp"),
          s("Send **LINK** and the code from your own WhatsApp to the office number before the countdown ends."),
        ],
      },
      {
        title: "Link your Telegram",
        steps: [
          s("In the Telegram card, click **Link my account**.", "channels.telegram"),
          s("Open Telegram and press **Start**, then click **I did it**."),
        ],
      },
    ],
    tips: [
      "Admins choose between WAHA (quick, scan a QR code) and the official Meta WhatsApp Business API.",
      "An API token is shown only once. Copy it straight away.",
    ],
    who: "Everyone links their own devices and accounts. Owners and admins set up the office channels.",
    related: ["approvals", "assistants", "logins"],
  },

  // ------------------------------------------------------------------ Admin
  organization: {
    purpose: "Your companies (branches) and the departments inside them. Add a company with a ready-made AI team in one step.",
    can: [
      "Add a company: name, colour, industry and standard departments.",
      "Add a ready-made AI team for its industry: finance, sales, operations, HR and customer service, plus industry roles.",
      "Keep a company's knowledge private.",
      "Rename, add and remove departments.",
    ],
    spots: {
      "organization.add": "Add a new company.",
      "organization.company": "A company with its departments.",
    },
    howto: [
      {
        title: "Add a company with a ready-made AI team",
        state: "new",
        steps: [
          s("Click **New branch**.", "organization.add"),
          s("Type the **Company name** and pick a colour."),
          s("Pick the **Industry**, such as Trading & retail."),
          s("Keep **Add a ready-made AI team** on and check **Who joins**."),
          s("Click **Create branch**. The company appears with its departments and agents.", "organization.company"),
        ],
      },
    ],
    tips: [
      "Ready-made agents ask first before acting; change that per agent later.",
      "Adding a team to an existing company skips roles it already has.",
    ],
    who: "Everyone can see it. Owners and admins change it.",
    related: ["agents", "settings", "impact"],
  },

  activity: {
    purpose: "Every change made by people and agents, in a log that shows if anything was edited or deleted.",
    can: [
      "Filter by **Sign-ins**, **People**, **Organization**, **Work**, **Agents** or **Other**.",
      "Read each change as a plain sentence: who, what and when.",
      "Click **Verify log** to check that nothing was changed.",
    ],
    spots: {
      "activity.filter": "Show one kind of change.",
      "activity.list": "Every change, newest first, grouped by day.",
    },
    howto: [
      {
        title: "Check who changed something",
        steps: [
          s("Pick a filter, such as **People** or **Agents**.", "activity.filter"),
          s("Scroll the list. Each line says who did what, and when.", "activity.list"),
          s("Click **Verify log** to confirm the log is intact."),
        ],
      },
    ],
    tips: ["Entries are chained together, so editing or deleting one is detectable."],
    who: "Owners and admins.",
    related: ["settings", "approvals", "logins"],
  },

  settings: {
    purpose: "The people in your workspace and their roles, plus your account and appearance.",
    can: [
      "Add a member with a role, and a company or department for managers and staff.",
      "Change a member's role or place, reset a password, or remove someone.",
      "Read what every role can do.",
      "Change the theme: light, dark or match your device.",
    ],
    spots: {
      "settings.add": "Add a new member.",
      "settings.list": "People and their roles.",
    },
    howto: [
      {
        title: "Add a member",
        steps: [
          s("Click **Add member**.", "settings.add"),
          s("Type the **Name** and **Email**, and pick a **Role**."),
          s("For managers and staff, pick their company or department."),
          s("Copy the temporary password and give it to them. They choose their own at first sign-in.", "settings.list"),
        ],
      },
    ],
    tips: [
      "The temporary password is shown only once.",
      "Only owners can make someone an owner.",
    ],
    who: "Owners and admins manage everyone; branch managers and heads of department add people to their own team.",
    related: ["organization", "activity"],
  },

  // ------------------------------------------------------------------ Help
  tutorial: {
    purpose: "Learn the system for your role, step by step: from your first agent to giving tasks and seeing results.",
    can: [
      "Follow your role's track: **Owner**, **Management**, **Staff** or **Approver & viewer**.",
      "Open a lesson's steps, or click **Show me** to go to the right page.",
      "Lessons tick themselves off when the system sees you did them.",
      "Search lessons, the glossary and common questions.",
    ],
    spots: {
      "tutorial.tracks": "Pick the track for your role.",
      "tutorial.next": "The next lesson to do.",
    },
    howto: [
      {
        title: "Take your role's tutorial",
        steps: [
          s("Pick your track at the top.", "tutorial.tracks"),
          s("Start with the **Next up** card.", "tutorial.next"),
          s("Click **Show me** to open the page, do the step, and come back."),
        ],
      },
    ],
    tips: ["The User guide (this page) explains every screen; the Tutorial walks you through them in order."],
    who: EVERYONE,
    related: ["home"],
  },
  // ------------------------------------------------------------------ Help: client demo
  "demo-day": {
    purpose: "A script for showing a client one working day with AI agents: a staff member hires their AI worker, agents run the company's own procedures, and a person approves what the AI made. Use your company's procedures; each step says what to click and what to point out.",
    can: [
      "Run the whole demo in about half an hour with one owner account and one staff account.",
      "Search inside every uploaded file, word by word, with suggestions as you type: a phrase, an amount like RM700 or a reference number.",
      "Show four workflows built from the company's uploaded procedures, each ending in a document a person reviews.",
      "Show where risky steps stop and wait in **Approvals**: sending outside, signing, payments and portal submissions.",
      "Finish in **Documents** and **Company files** filtered to **Made by AI**, so the client sees everything the AI made in one place.",
    ],
    spots: {},
    howto: [
      {
        title: "Before the demo: set up the company",
        steps: [
          s("Sign in as the owner. In **Company files**, pick the company and drop a zip of its procedures: uniform and equipment requests, disciplinary steps, the salary advance rules and the tender procedure."),
          s("When the upload is ready, select the procedure files and click **Make an SOP** or **Build a workflow**. Check each draft and save it."),
          s("Fill in **Company kit** (legal name, registration number, address, signatory) so letters and orders print on the letterhead."),
          s("Add a staff member with the staff role in Members, and keep their sign-in details for the demo."),
        ],
      },
      {
        title: "1. A staff member hires their AI worker",
        steps: [
          s("Sign in as the staff member. The hiring steps open by themselves; if not, click **Start hiring** on **My AI worker**."),
          s("Give the worker a name and a job title, for example HR assistant at your security company, and tick what it must ask about first."),
          s("Under **Its job**, add a duty it does every day, such as checking new leave requests each morning."),
          s("Under **Working hours**, pick **Office week**. Work given after hours waits for its next shift."),
          s("Read the offer letter and click **Hire**."),
        ],
      },
      {
        title: "2. Give it a task based on an SOP",
        steps: [
          s("On **My AI worker**, click **Give a task**."),
          s("Write the request and name the SOP to follow, for example: prepare a quotation for guarding two schools for 12 months, with the company's rates, following the quotation SOP."),
          s("Open the task in **Tasks** and show the timeline: the SOP it read, the files it opened and what it is doing now."),
          s("The quotation is made from the company's template, on its letterhead. It is saved in **Documents**, and its PDF in **Company files** under AI documents, marked **Made by AI**."),
          s("When it finishes, the result waits for review. Click **Accept**, or **Send back** with a note to show the agent fixing its own work."),
        ],
      },
      {
        title: "2b. Search anything inside the company's documents",
        steps: [
          s("Click the search box at the top of any page, or press **/**."),
          s("Type the first letters of a word, for example kelay. Suggestions appear as you type: whole words from the documents, file titles and headings inside the files."),
          s("Search an amount such as RM700, a reference number such as a tender or PO number, or a phrase in quotes. Results show the page of the PDF where it was found."),
          s("Click a result: the file opens at that page with the words highlighted. Filter by company, kind, department or **Made or uploaded**."),
          s("Point out that agents search the same way and quote the file and page they used. Staff only find what their company and role may open."),
        ],
      },
      {
        title: "3a. A uniform or equipment request, ending in a purchase order",
        steps: [
          s("Open **Workflows**, pick the uniform request workflow built from the company's procedure and click **Run**."),
          s("Type the request (who needs what, sizes and quantities) and click **Start**."),
          s("The run stops where the procedure needs a person: the manager's decision before any order is made. Show it under **Needs you**, then approve."),
          s("The agents check the request against the procedure and draft the purchase order from the company's template. Its PDF goes into the company's files under AI documents."),
          s("When the goods arrive, a person records what was received and the run closes."),
        ],
      },
      {
        title: "3b. A disciplinary case, ending in a warning letter",
        steps: [
          s("Run the disciplinary workflow with the case details: the staff member, what happened, the dates and any earlier warnings."),
          s("The agent follows the company's disciplinary steps, reads the records it was given and drafts the warning letter in the company's language."),
          s("Point out that the letter waits for a person. Nobody signs or sends it until someone approves it."),
        ],
      },
      {
        title: "3c. The monthly salary advance",
        steps: [
          s("Run the salary advance workflow with the month and the attendance for the first half of the month."),
          s("The agent works out how much each person may get under the company's rules, such as days worked and the advance limit, and shows the calculation in a report."),
          s("A person keys the approved amounts into the payroll system. The agent never makes a payment itself."),
          s("The run waits for that person to confirm it is done before it closes."),
        ],
      },
      {
        title: "3d. A tender, from the notice to the submission checklist",
        steps: [
          s("Run the tender workflow with the tender notice: upload the notice or paste its details."),
          s("The agents read the notice, note the closing date and any compulsory briefing, and tell the team what to prepare."),
          s("They draft the briefing notice and the letter asking the bank for a certified true copy (CTC) of the bank statement."),
          s("Submitting on the tender portal is always done by an authorised officer. The run waits for them to confirm it was submitted."),
        ],
      },
      {
        title: "4. Where approvals appear and how a person approves",
        steps: [
          s("Anything risky stops and asks first: an email or WhatsApp to someone outside the company, signing, payments and portal submissions."),
          s("The request shows in **Approvals**, and as a phone notification when channels are set up, with the agent, the action and its reason."),
          s("Click **Approve once** to let it go ahead this one time, or **Deny** with a reason the agent reads."),
          s("Every decision is kept in **History** and in the activity log, with who decided and when."),
        ],
      },
      {
        title: "5. Find what the AI made and review it",
        steps: [
          s("On the home page, a card shows how many documents AI made this week and how many wait for review. Click **Review now**."),
          s("In **Documents**, open **Review what AI made**. Each row shows the agent, the task or workflow it came from, and **Approve**, **Send back** and **Open**."),
          s("Send one back with a note and show the agent revising it. It comes back to the same list when it is done."),
          s("In **Company files**, choose **Made by AI** and pick an agent. The purchase order, the warning letter, the salary report and the tender letters are all there, each with its task and review status."),
          s("Switch the filter to **Uploaded** to show the company's own files, the procedures and forms the agents worked from."),
        ],
      },
    ],
    tips: [
      "Use made-up staff names and figures in a demo. Never show a real employee's case or salary.",
      "Run each workflow once before the meeting so you know how long it takes with your AI provider.",
      "AI folders follow the company's language: AI documents in English, Dokumen AI in Malay. A new version of a document replaces its file; Documents keeps every version.",
    ],
    who: "Owners and managers who show the system to a client. The first two parts need a staff account.",
    related: ["my-worker", "tasks", "workflows", "approvals", "documents", "files"],
  },

};

/** Captions for the recorded flows (GUIDE_FLOWS in targets.ts). */
export const FLOW_DOCS: Record<string, FlowDoc> = {
  "create-agent": {
    summary: "Build an agent from a template, place it in a department, set what it may do and create it.",
    steps: [
      "Open Agents and click New agent.",
      "Pick a template, then the company and department.",
      "Give it a name, a job title and a way of working.",
      "Pick its SOPs and set each tool to Allow, Ask me or Never.",
      "Review what it will be told and click Create agent.",
    ],
  },
  "give-task": {
    summary: "Give an agent a task, watch it plan and work, and accept the result.",
    steps: [
      "Open Tasks and click New task.",
      "Write the title and brief, and pick the agent.",
      "Click Create and start: the card moves to Running.",
      "Open the card to follow the plan and the self-check.",
      "When it reaches In review, read the result and click Accept.",
    ],
  },
  approve: {
    summary: "An agent asks before doing something important. Decide in one click.",
    steps: [
      "Open Approvals: the card shows who asks, what for and why.",
      "Click Approve once, Always allow, or Deny with a reason.",
      "The agent carries on, or stops and reads your reason.",
    ],
  },
  "add-company": {
    summary: "Add a company with its industry, and a ready-made AI team joins it.",
    steps: [
      "Open Organization and click New branch.",
      "Type the company name and pick the industry.",
      "Keep Add a ready-made AI team on and check who joins.",
      "Click Create branch: the departments and agents appear.",
    ],
  },
  "hire-worker": {
    summary: "Staff hire their own AI worker in five short steps.",
    steps: [
      "Pick your company and department.",
      "Name your worker and say how it should work.",
      "Give it duties and a first task, if you like.",
      "Set its working hours and breaks.",
      "Read the offer letter and hire it.",
    ],
  },
  "phone-tour": {
    summary: "The whole office fits in your pocket: the tab bar, approvals and the More menu on a phone.",
    steps: [
      "The bottom bar has Office, Tasks, Approvals and Chat.",
      "Approvals shows a badge when something waits for you.",
      "More opens every other page, with Help at the top.",
    ],
  },
};

/** Plain text of a doc string: **chips** become plain words. */
export const plain = (t: string) => t.replace(/\*\*(.+?)\*\*/g, "$1");

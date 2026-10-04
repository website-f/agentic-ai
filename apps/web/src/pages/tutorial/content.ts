/** What the tutorial teaches: role tracks of ordered lessons, a glossary and an FAQ.
 *
 * Steps use the app's real words. Wrap a label people will see on screen in **double
 * asterisks** and it is shown as a small UI chip. Every `show.to` must be a route in
 * src/router.tsx (content.test.ts checks this). */
import {
  BellRingingIcon,
  BlueprintIcon,
  BooksIcon,
  BuildingsIcon,
  CalendarCheckIcon,
  ChartBarIcon,
  ChatsCircleIcon,
  ClipboardTextIcon,
  ClockCounterClockwiseIcon,
  ClockIcon,
  CpuIcon,
  EyeIcon,
  FlowArrowIcon,
  GaugeIcon,
  GraduationCapIcon,
  HandIcon,
  KanbanIcon,
  LightbulbIcon,
  RobotIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SparkleIcon,
  UserFocusIcon,
  UserPlusIcon,
  UsersThreeIcon,
  type Icon,
} from "@phosphor-icons/react";

import type { Tone } from "@/components/page";
import type { Signal, Track } from "@/lib/tutorial";

/** The small mock picture next to a lesson. */
export type ArtKind =
  | "connect" | "company" | "people" | "builder" | "board" | "approval" | "flow" | "calendar"
  | "upload" | "chart" | "chat" | "phone" | "shield" | "twin" | "live" | "memory" | "report";

export interface Lesson {
  id: string;
  title: string;
  why: string;
  steps: string[];
  /** Where "Show me" goes; `search` opens the right tab or dialog where the page supports it. */
  show: { to: string; search?: Record<string, string | number>; label?: string };
  /** Done by itself when any of these is true in real data. */
  signals?: Signal[];
  /** Permissions needed to open the page (any of them). Absent = everyone. */
  perm?: string[];
  icon: Icon;
  tone: Tone;
  art: ArtKind;
}

export interface TrackInfo {
  id: Track;
  label: string;
  title: string;
  who: string;
  blurb: string;
  lessons: Lesson[];
}

const OWNER: Lesson[] = [
  {
    id: "owner.ai",
    title: "Connect your AI",
    why: "Agents think with the AI services you connect. Nothing works until one is in.",
    steps: [
      "Open **AI Engine** in the menu (under Operations).",
      "On the **Providers** tab, pick a provider card or **Connect a provider**, then paste the API key it gave you.",
      "Click **Test** on the provider to check the key works.",
      "Open **Model groups** and use **Add model** to fill each group, for example \"smart\". Agents ask for a group, never a provider, so you can swap models later without touching agents.",
      "Check spending any time on the **Usage** tab.",
    ],
    show: { to: "/ai-engine", search: { tab: "providers" }, label: "Open AI Engine" },
    signals: ["model_group"],
    perm: ["org.read"],
    icon: CpuIcon,
    tone: "info",
    art: "connect",
  },
  {
    id: "owner.company",
    title: "Add your companies",
    why: "Each company you run is a branch, with its own departments, agents and knowledge.",
    steps: [
      "Open **Organization** (under Admin).",
      "Click **New branch** and type the **Company name**.",
      "Keep **Add standard departments** on to start with Management, Finance, Operations and more. You can rename or remove them later.",
      "If a ready-made AI team is offered for the company's line of work, keep it: its agents arrive already at their desks.",
      "Turn on **Keep this company's knowledge private** if other companies' agents should not see its SOPs and notes.",
    ],
    show: { to: "/organization", search: { new: 1 }, label: "Add a company" },
    signals: ["company"],
    perm: ["org.manage"],
    icon: BuildingsIcon,
    tone: "accent",
    art: "company",
  },
  {
    id: "owner.people",
    title: "Invite your people",
    why: "Everyone signs in with their own account and sees only what their role allows.",
    steps: [
      "Open **Settings**, then **Members**, and click **Add member**.",
      "Type their name and email, then pick a role: Owner or Admin (the whole office), Branch manager, HOD or Supervisor (their branch or department), Staff (their own AI twin), Approver or Viewer (decide or watch).",
      "For office roles, choose their branch and department.",
      "Click **Copy** to share the temporary password. They choose their own at first sign-in.",
    ],
    show: { to: "/settings/members", search: { add: 1 }, label: "Add a member" },
    signals: ["people"],
    perm: ["members.manage"],
    icon: UserPlusIcon,
    tone: "violet",
    art: "people",
  },
  {
    id: "owner.agent",
    title: "Create your first agent",
    why: "An agent is an AI worker with a job title, a desk in a department and clear limits.",
    steps: [
      "Open **Agents** and click **New agent**.",
      "Go through the six short steps: **Template**, **Placement**, **Identity**, **SOPs**, **Permissions** and **Review**.",
      "In **Identity**, give it a **Name** and a **Job title**, and describe how it should work.",
      "In **Permissions**, choose for each tool: allow, ask you first, or never.",
      "Click **Create agent**. It now sits at its desk on the **Office floor**.",
    ],
    show: { to: "/agents/new", label: "Create an agent" },
    signals: ["agent"],
    perm: ["agents.manage"],
    icon: UsersThreeIcon,
    tone: "accent",
    art: "builder",
  },
  {
    id: "owner.blueprint",
    title: "Save a role as a blueprint",
    why: "Define a role once (instructions, model, tools, SOPs) and stamp it onto many agents.",
    steps: [
      "Open **Blueprints** (under Knowledge) and click **New blueprint**.",
      "Fill in the role, its instructions, the model group, which tools it may use, and its SOPs and skills.",
      "Click **Apply to an agent** to turn an agent into that specialist in one go.",
    ],
    show: { to: "/blueprints", label: "Open Blueprints" },
    signals: ["blueprint"],
    perm: ["agents.manage", "agents.own"],
    icon: BlueprintIcon,
    tone: "info",
    art: "builder",
  },
  {
    id: "owner.task",
    title: "Give a task and follow it live",
    why: "This is the everyday loop: you describe the work, an agent does it, you check it.",
    steps: [
      "Open **Tasks** and click **New task**.",
      "Write a **Title** and a **Brief**: what to do, and what a good result looks like.",
      "Pick the agent in **Assign to**, keep **I review the result** on, and click **Create and start**.",
      "Open **Monitor** or the **Office floor** to watch it think, use tools and ask colleagues.",
      "When it finishes, the card moves to review. Open it and click **Accept**, or **Send back** with what to change.",
    ],
    show: { to: "/tasks", search: { new: 1 }, label: "New task" },
    signals: ["task_created"],
    perm: ["work.write"],
    icon: KanbanIcon,
    tone: "accent",
    art: "board",
  },
  {
    id: "owner.approvals",
    title: "Decide what agents ask",
    why: "Anything risky waits for a person. You stay in control without doing the work.",
    steps: [
      "Open **Approvals**. Each card shows the agent, what it wants to do, and why.",
      "**Approve once** lets it go ahead this time.",
      "**Always allow for** the agent stops it asking for this kind of action again (not offered for high-risk actions).",
      "**Deny** stops it. Add a reason so it can try another way.",
    ],
    show: { to: "/approvals", label: "Open Approvals" },
    signals: ["approved"],
    perm: ["approvals.decide"],
    icon: SealCheckIcon,
    tone: "warn",
    art: "approval",
  },
  {
    id: "owner.workflow",
    title: "Draw a workflow and run it",
    why: "A workflow maps how a job is done, step by step, so every run follows the same path.",
    steps: [
      "Open **Workflows** and click **New workflow**.",
      "Choose **Describe it, AI draws it**, **Start from a template**, or start blank.",
      "Use **Add step** to add steps. Each step says who does it; decisions wait for a person.",
      "Save it, then click **Run**. Each step goes to its agent, and decisions come to you as **Needs you**.",
    ],
    show: { to: "/workflows", label: "Open Workflows" },
    signals: ["workflow_run"],
    perm: ["agents.manage", "agents.own", "work.write"],
    icon: FlowArrowIcon,
    tone: "violet",
    art: "flow",
  },
  {
    id: "owner.schedule",
    title: "Put routine work on a schedule",
    why: "Daily, weekly and month-end jobs run by themselves, and you see every result.",
    steps: [
      "Open **Schedules** and click **New schedule**.",
      "Give it a **Name**, choose the **Agent**, and write the **Task title** and **Brief**.",
      "Pick **When**, for example every weekday morning.",
      "Keep **Send results for review** on while you build trust. Click **Run now** to try it straight away.",
    ],
    show: { to: "/schedules", search: { tab: "schedules" }, label: "Open Schedules" },
    signals: ["schedule"],
    icon: CalendarCheckIcon,
    tone: "info",
    art: "calendar",
  },
  {
    id: "owner.library",
    title: "Upload your SOPs and manuals",
    why: "Agents follow your way of working when they can read your procedures and policies.",
    steps: [
      "Open **Library** and drop files in (PDF, Word or scans), or click to choose them.",
      "Choose who it is for: the whole workspace, one company, or one department.",
      "Agents search the library when the work needs it, and cite the page they used.",
      "For rules every agent must always follow, write them as **SOPs**.",
    ],
    show: { to: "/library", label: "Open Library" },
    signals: ["library"],
    icon: BooksIcon,
    tone: "orange",
    art: "upload",
  },
  {
    id: "owner.learning",
    title: "Let agents learn, safely",
    why: "Agents get better with use. You choose how much they may change by themselves.",
    steps: [
      "Open **Learning** to see what agents learned, how each change was tested, and what it cost.",
      "In the **Autopilot** card, choose whether tested skill changes go live by themselves or wait for a person.",
      "Click **Teach from a source** to turn a web page, a file or your own notes into a skill.",
      "Review waiting changes in **Skills**.",
    ],
    show: { to: "/learning", label: "Open Learning" },
    signals: ["autopilot"],
    icon: GraduationCapIcon,
    tone: "violet",
    art: "memory",
  },
  {
    id: "owner.overview",
    title: "See the whole company at a glance",
    why: "Every branch side by side: what got done, what is stuck, and what it cost.",
    steps: [
      "Open **Company overview** (under Home).",
      "Pick the period at the top to compare branches over the last days.",
      "Read the **Briefing**: an AI summary of the numbers, refreshed every 15 minutes.",
      "Open **Reports** for what agents wrote up, with tables you can download as **CSV**.",
    ],
    show: { to: "/overview", label: "Open the overview" },
    icon: ChartBarIcon,
    tone: "ok",
    art: "chart",
  },
  {
    id: "owner.assistant",
    title: "Your personal assistant, Gmail and WhatsApp",
    why: "A private assistant only you can see: it reads the whole company and your inbox for you.",
    steps: [
      "Open **My assistants** and click **New assistant**. It is **Private to you**.",
      "Under **Connections**, click **Connect Google** so it can read Gmail and draft replies. Nothing is sent until you approve it.",
      "Click **Link my WhatsApp** to chat with it and get notices on your phone.",
      "Ask it things like \"What needs me today?\" or \"Who is behind this week?\"",
    ],
    show: { to: "/assistants", label: "Open My assistants" },
    signals: ["assistant", "gmail"],
    perm: ["work.write"],
    icon: SparkleIcon,
    tone: "pink",
    art: "chat",
  },
  {
    id: "owner.safety",
    title: "Budgets and safety",
    why: "Limits keep costs predictable and make sure nothing important happens unseen.",
    steps: [
      "Open an agent from **Agents** and go to **Team & budget**.",
      "Set **Tokens per day** and **US dollars per month**. At the limit the agent pauses and asks you.",
      "On the **Permissions** tab, choose allow, ask or never for each tool.",
      "Keep website passwords in **Logins**: agents use them without ever seeing them.",
      "Every change by people and agents is kept in **Activity**.",
    ],
    show: { to: "/agents", label: "Open Agents" },
    signals: ["budget"],
    icon: ShieldCheckIcon,
    tone: "ok",
    art: "shield",
  },
];

const MANAGEMENT: Lesson[] = [
  {
    id: "management.overview",
    title: "Start your day on the overview",
    why: "One look tells you what needs you and what your team finished.",
    steps: [
      "Open **Command center**. **Waiting on you** shows decisions to make; **To review** shows finished work to check.",
      "Open **Company overview** to compare work, failures and spend for your branch or department.",
      "Read the **Briefing** for a short AI summary of the numbers.",
    ],
    show: { to: "/", label: "Open Command center" },
    icon: GaugeIcon,
    tone: "accent",
    art: "chart",
  },
  {
    id: "management.assign",
    title: "Assign work to your team's agents",
    why: "Hand routine work to the agents in your branch or department.",
    steps: [
      "Open **Tasks** and click **New task**.",
      "Write the **Title** and a clear **Brief**, then choose the agent in **Assign to**.",
      "Add **Labels (optional)** such as tender or invoice, so the overview can count them.",
      "Use **Keep going until (optional)** for a finish line, like \"all 40 invoices matched\".",
      "Click **Create and start**. You can also drag a card onto an agent on the board.",
    ],
    show: { to: "/tasks", search: { new: 1 }, label: "New task" },
    signals: ["task_created"],
    perm: ["work.write"],
    icon: KanbanIcon,
    tone: "accent",
    art: "board",
  },
  {
    id: "management.review",
    title: "Review: accept or send back",
    why: "Finished work waits for you, so nothing leaves the team unchecked.",
    steps: [
      "On **Tasks**, open a card in the review column.",
      "Read the result and any files it produced.",
      "Click **Accept** when it is right.",
      "Click **Send back** and say what to change. The agent continues with your note.",
    ],
    show: { to: "/tasks", label: "Open Tasks" },
    signals: ["reviewed"],
    perm: ["work.write"],
    icon: ClipboardTextIcon,
    tone: "ok",
    art: "board",
  },
  {
    id: "management.approvals",
    title: "Answer approvals",
    why: "Agents stop and ask before risky steps. Quick answers keep work moving.",
    steps: [
      "Open **Approvals**; the **Waiting** tab lists what agents are waiting on.",
      "**Approve once**, **Always allow for** the agent, or **Deny** with a reason.",
      "Turn on notifications in **Channels** to answer from your phone.",
    ],
    show: { to: "/approvals", label: "Open Approvals" },
    signals: ["approved"],
    perm: ["approvals.decide"],
    icon: SealCheckIcon,
    tone: "warn",
    art: "approval",
  },
  {
    id: "management.workflows",
    title: "Workflows for your department",
    why: "Make sure jobs like onboarding or claims always follow the same steps.",
    steps: [
      "Open **Workflows** and click **New workflow**, then **Start from a template** (for example \"New staff onboarding\").",
      "Adjust the steps and who does each one, then save.",
      "Click **Run** to put a job through it, or pick it in **New task** under **Workflow** and click **Start the workflow**.",
      "Steps that need you show **Needs you** on the run.",
    ],
    show: { to: "/workflows", label: "Open Workflows" },
    signals: ["workflow_run"],
    perm: ["agents.manage", "agents.own", "work.write"],
    icon: FlowArrowIcon,
    tone: "violet",
    art: "flow",
  },
  {
    id: "management.schedules",
    title: "Recurring work on schedules",
    why: "Weekly checks and month-end summaries arrive without anyone asking.",
    steps: [
      "Open **Schedules** and click **New schedule**.",
      "Choose the **Agent**, write the **Task title** and **Brief**, and pick **When**.",
      "See every run in the **Run ledger**; repeated failures are grouped under **Incidents**.",
    ],
    show: { to: "/schedules", search: { tab: "schedules" }, label: "Open Schedules" },
    signals: ["schedule"],
    icon: CalendarCheckIcon,
    tone: "info",
    art: "calendar",
  },
  {
    id: "management.reports",
    title: "Read reports",
    why: "Agents write up summaries and tables you can share or download.",
    steps: [
      "Open **Reports** to see what agents wrote up, newest first.",
      "Open one to read it; sort its tables, or download them as **CSV**.",
      "Use **All reports** to go back to the list.",
    ],
    show: { to: "/reports", label: "Open Reports" },
    icon: ClipboardTextIcon,
    tone: "orange",
    art: "report",
  },
  {
    id: "management.watch",
    title: "Watch your staff's agents work",
    why: "See who is busy, who is stuck, and who is waiting for a person.",
    steps: [
      "Open **Office floor**: every agent sits at its desk and walks to the podium when it needs someone.",
      "Click an agent: its **Monitor** tab shows its thinking, each tool it uses and its browser screen, live.",
      "Use **Pause** if an agent should stop for now, and **Resume** later.",
    ],
    show: { to: "/office", label: "Open the Office floor" },
    icon: EyeIcon,
    tone: "info",
    art: "live",
  },
  {
    id: "management.ask",
    title: "Ask an assistant how the team is doing",
    why: "Get answers in plain words instead of opening page after page.",
    steps: [
      "Open **My assistants** and click **New assistant**.",
      "Ask: \"Which tasks in my department are stuck?\" or \"What did Finance finish this week?\"",
      "It can chase your staff's agents, who message their people on WhatsApp.",
    ],
    show: { to: "/assistants", label: "Open My assistants" },
    signals: ["assistant"],
    perm: ["work.write"],
    icon: SparkleIcon,
    tone: "pink",
    art: "chat",
  },
];

const STAFF: Lesson[] = [
  {
    id: "staff.twin",
    title: "Hire your AI worker",
    why: "Your AI twin is your virtual self at work: it does the routine parts of your job.",
    steps: [
      "Open **My twin** (under Home) and click **Create my twin**.",
      "Three short steps: who it is, what it helps with, and what it must **Always ask me before**.",
      "Already have an agent of your own? Use **Make … my twin** instead.",
    ],
    show: { to: "/twin", label: "Open My twin" },
    signals: ["twin"],
    perm: ["agents.own"],
    icon: UserFocusIcon,
    tone: "accent",
    art: "twin",
  },
  {
    id: "staff.hours",
    title: "Set its working hours",
    why: "Like a contract: it works when you say, and urgent things can still reach it.",
    steps: [
      "On **My twin**, click **Edit persona**.",
      "Choose **Working hours**, for example weekdays 9am to 6pm.",
      "Turn on **Pick up waiting work by itself** so it starts queued tasks during those hours without being asked.",
    ],
    show: { to: "/twin", search: { edit: 1 }, label: "Edit persona" },
    signals: ["work_hours"],
    perm: ["agents.own"],
    icon: ClockIcon,
    tone: "info",
    art: "calendar",
  },
  {
    id: "staff.task",
    title: "Give it a task",
    why: "Describe the job once; your twin does it and reports back.",
    steps: [
      "On **My twin**, click **Give it a task**. Or open **Tasks**, click **New task** and pick your twin in **Assign to**.",
      "Say what to do, by when, and what a good result looks like.",
      "Attach any files it needs, then click **Create and start**.",
      "Follow it on the **Tasks** tab of **My twin**.",
    ],
    show: { to: "/twin", search: { tab: "tasks" }, label: "Open its tasks" },
    signals: ["task_created"],
    perm: ["work.write"],
    icon: KanbanIcon,
    tone: "accent",
    art: "board",
  },
  {
    id: "staff.chat",
    title: "Chat with it: type, talk or WhatsApp",
    why: "Quick questions and small jobs are faster as a chat.",
    steps: [
      "Open the **Chat** tab on **My twin** and type as you would to a colleague.",
      "Tap the microphone (**Speak instead of typing**) to send a voice note instead.",
      "Turn a good conversation into proper work with **Make this a task**.",
      "On your phone, use **Link my WhatsApp** (in **My assistants** or **Channels**) to message it and send voice notes there.",
    ],
    show: { to: "/twin", search: { tab: "chat" }, label: "Open the chat" },
    signals: ["chat", "whatsapp"],
    perm: ["agents.own"],
    icon: ChatsCircleIcon,
    tone: "pink",
    art: "chat",
  },
  {
    id: "staff.review",
    title: "Check its work",
    why: "You stay responsible, so you see the result before it counts.",
    steps: [
      "When your twin finishes, the task waits in review.",
      "Open it, read the result, then **Accept** it or **Send back** with what to change.",
      "\"Waiting on you\" on **My twin** means it has a question for you.",
    ],
    show: { to: "/twin", search: { tab: "tasks" }, label: "Open its tasks" },
    signals: ["reviewed"],
    perm: ["work.write"],
    icon: ClipboardTextIcon,
    tone: "ok",
    art: "board",
  },
  {
    id: "staff.teach",
    title: "Teach it how you work",
    why: "The more it knows about you and your job, the less you need to explain.",
    steps: [
      "Open the **Teach it** tab on **My twin**.",
      "Under **Remember this**, write one thing it should always know and click **Remember about me**. Never passwords or IC numbers.",
      "Use **Learn from a source** to turn a web page, file or your notes into a skill.",
      "See everything it keeps on **What it knows**, and upload guides to the **Library**.",
    ],
    show: { to: "/twin", search: { tab: "teach" }, label: "Teach it" },
    signals: ["library"],
    perm: ["agents.own"],
    icon: LightbulbIcon,
    tone: "warn",
    art: "memory",
  },
  {
    id: "staff.schedule",
    title: "Routine work on a schedule",
    why: "\"Every Monday at 9am, summarise last week's sales\" happens without you asking.",
    steps: [
      "Open **Schedules** and click **New schedule**.",
      "Pick your twin as the **Agent** and describe the job in **Task title** and **Brief**.",
      "Choose **When**, for example every Monday at 9am.",
      "Results come back for review, or straight to done if you turn **Send results for review** off.",
    ],
    show: { to: "/schedules", search: { tab: "schedules" }, label: "Open Schedules" },
    signals: ["schedule"],
    icon: CalendarCheckIcon,
    tone: "info",
    art: "calendar",
  },
  {
    id: "staff.asks",
    title: "What it asks you before doing",
    why: "It never sends, submits or spends on your behalf without your yes.",
    steps: [
      "It asks first for everything you ticked in **Always ask me before**, and always before sending forms or running code.",
      "Its questions appear in **Approvals** and as a phone notification.",
      "Answer with **Approve once**, **Always allow for** your twin, or **Deny**.",
    ],
    show: { to: "/approvals", label: "Open Approvals" },
    signals: ["approved"],
    perm: ["approvals.decide"],
    icon: HandIcon,
    tone: "warn",
    art: "approval",
  },
];

const APPROVER: Lesson[] = [
  {
    id: "approver.phone",
    title: "Get approvals on your phone",
    why: "Decide in seconds from your lock screen, wherever you are.",
    steps: [
      "Open **Channels** and switch on **Notifications on this device**.",
      "On a phone, use **Install the app** to add it to your home screen first.",
      "Click **Send a test** to check it arrives.",
      "Prefer WhatsApp? Use **Link my WhatsApp** on the same page.",
    ],
    show: { to: "/channels", label: "Open Channels" },
    signals: ["push", "whatsapp"],
    icon: BellRingingIcon,
    tone: "warn",
    art: "phone",
  },
  {
    id: "approver.decide",
    title: "Approve, always allow, or deny",
    why: "Agents wait for you before anything risky, so a quick answer keeps work moving.",
    steps: [
      "Open **Approvals**. Each card shows the agent, what it wants to do and why.",
      "**Approve once** lets it go ahead this time.",
      "**Always allow for** the agent stops it asking for this kind of action again.",
      "**Deny** stops it. Add a reason so it can try another way.",
    ],
    show: { to: "/approvals", label: "Open Approvals" },
    signals: ["approved"],
    perm: ["approvals.decide"],
    icon: SealCheckIcon,
    tone: "warn",
    art: "approval",
  },
  {
    id: "approver.history",
    title: "Look back at decisions",
    why: "See who decided what and when, any time someone asks.",
    steps: [
      "Open **Approvals** and choose the **History** tab.",
      "Each entry shows the decision, who made it, and when.",
    ],
    show: { to: "/approvals", search: { tab: "history" }, label: "Open History" },
    icon: ClockCounterClockwiseIcon,
    tone: "neutral",
    art: "report",
  },
  {
    id: "approver.watch",
    title: "See what agents are doing",
    why: "Watch the office work without changing anything.",
    steps: [
      "Open **Office floor** to see every agent at its desk.",
      "Open **Monitor** to follow one agent's steps live.",
      "Open **Tasks** for the board of everything in progress.",
    ],
    show: { to: "/office", label: "Open the Office floor" },
    icon: EyeIcon,
    tone: "info",
    art: "live",
  },
  {
    id: "approver.reports",
    title: "Read reports and the overview",
    why: "The results, written up in plain words and tables.",
    steps: [
      "Open **Reports** for summaries agents wrote; download tables as **CSV**.",
      "Open **Company overview** and read the **Briefing** for the big picture.",
    ],
    show: { to: "/reports", label: "Open Reports" },
    icon: ChartBarIcon,
    tone: "ok",
    art: "report",
  },
];

export const TRACKS: TrackInfo[] = [
  {
    id: "owner",
    label: "Owner",
    title: "Owner track",
    who: "Owners and admins",
    blurb: "Set up the office (AI, companies, people and agents), then run work from start to finish.",
    lessons: OWNER,
  },
  {
    id: "management",
    label: "Management",
    title: "Management track",
    who: "Branch managers, HODs and supervisors",
    blurb: "Run your team's work: assign it, review it, approve what agents ask and keep an eye on results.",
    lessons: MANAGEMENT,
  },
  {
    id: "staff",
    label: "Staff",
    title: "Staff track",
    who: "Staff with their own AI twin",
    blurb: "Hire your AI twin and hand it the routine parts of your day.",
    lessons: STAFF,
  },
  {
    id: "approver",
    label: "Approver",
    title: "Approver & viewer track",
    who: "Approvers and viewers",
    blurb: "Decide what agents ask from anywhere, and follow what they do.",
    lessons: APPROVER,
  },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t])) as Record<Track, TrackInfo>;

export interface Term {
  term: string;
  icon: Icon;
  tone: Tone;
  meaning: string;
}

export const GLOSSARY: Term[] = [
  { term: "Agent", icon: RobotIcon, tone: "accent", meaning: "An AI worker with a name, a job title and a desk in a department. It does tasks within the limits you set." },
  { term: "Task", icon: KanbanIcon, tone: "accent", meaning: "One piece of work given to an agent: a title, a brief, and a result you can check." },
  { term: "Approval", icon: SealCheckIcon, tone: "warn", meaning: "A question or a risky step an agent waits on. A person approves it, always allows it, or denies it." },
  { term: "Skill", icon: GraduationCapIcon, tone: "violet", meaning: "A procedure an agent learned and reuses. New skills are tested, and can wait for a person before going live." },
  { term: "SOP", icon: ClipboardTextIcon, tone: "orange", meaning: "A written standard operating procedure. Agents in its company or department always follow it." },
  { term: "Library", icon: BooksIcon, tone: "orange", meaning: "Manuals, policies and guidelines you upload. Agents search them when needed and cite the page." },
  { term: "Workflow", icon: FlowArrowIcon, tone: "violet", meaning: "A map of how a job is done: steps, who does each, and where a person decides. You can run jobs through it." },
  { term: "Blueprint", icon: BlueprintIcon, tone: "info", meaning: "A saved role (instructions, model, tools, SOPs, skills) you apply to agents so they start as specialists." },
  { term: "AI twin", icon: UserFocusIcon, tone: "accent", meaning: "A staff member's own agent: their virtual self at work, which asks them before anything important." },
  { term: "Assistant", icon: SparkleIcon, tone: "pink", meaning: "A private AI helper only its owner sees. It can read the company, your Gmail and chase people on WhatsApp." },
  { term: "Autopilot", icon: RobotIcon, tone: "violet", meaning: "The rule for learning: whether tested skill changes switch on by themselves or wait for a person." },
  { term: "Model group", icon: CpuIcon, tone: "info", meaning: "A named set of AI models (like \"smart\"). Agents ask for a group, so you can change models without touching agents." },
  { term: "Branch", icon: BuildingsIcon, tone: "accent", meaning: "One company you run, with its departments, agents and knowledge." },
];

export interface Faq {
  q: string;
  a: string;
}

export const FAQ: Faq[] = [
  {
    q: "What does it cost?",
    a: "You pay the AI providers you connect, only for what agents use. AI Engine > Usage shows spend per agent and per day. Free tiers and local models cost nothing. Set a daily or monthly budget per agent under Team & budget: at the limit it pauses and asks you.",
  },
  {
    q: "Can an agent do something important on its own?",
    a: "Only if you allowed it. Every tool is set to allow, ask first, or never. Sending emails, submitting forms, spending and running code ask first unless someone chose \"Always allow\", and high-risk steps always ask. You can pause any agent at any time.",
  },
  {
    q: "What if it gets something wrong?",
    a: "Keep \"I review the result\" on and nothing counts until you accept it. Send it back with what to change and it continues from your note. Teach it (memory, SOPs, the library) so it does not repeat the mistake; skill changes are tested before they go live.",
  },
  {
    q: "Who can see my data and my work?",
    a: "Each person sees only what their role allows: staff their own agents, managers their branch or department. Personal assistants are private even from the owner. Website logins are encrypted and agents use them without ever seeing the password. Every change is recorded in a tamper-evident log.",
  },
  {
    q: "Does our data go to the AI company?",
    a: "Only the text an agent needs for a step is sent to the AI provider you connected, and it all stays on your own server otherwise. Pick providers whose terms suit you, or use a local model so nothing leaves your server.",
  },
  {
    q: "How do I stop something?",
    a: "Pause an agent from its page or the Office floor, cancel a task from its card, or stop a workflow run with \"Stop the run\". Deny an approval to stop that single step.",
  },
];

/** Splits "Open **Tasks** now" into text and UI-word parts. */
export function parseStep(s: string): { text: string; ui: boolean }[] {
  return s.split("**").map((text, i) => ({ text, ui: i % 2 === 1 })).filter((p) => p.text);
}

/** Plain text of a lesson for search. */
export function lessonText(l: Lesson): string {
  return [l.title, l.why, ...l.steps].join(" ").replaceAll("**", "").toLowerCase();
}

/** "auto" when real data shows it, "manual" when the person ticked it, else false. */
export function lessonState(
  l: Lesson,
  signals: Partial<Record<Signal, boolean>> | undefined,
  done: readonly string[] | undefined,
): "auto" | "manual" | false {
  if (l.signals?.some((s) => signals?.[s])) return "auto";
  return done?.includes(l.id) ? "manual" : false;
}

/** Mirror of the server's role -> track map, used before progress loads. */
export function trackOfRole(role: string): Track {
  if (role === "owner" || role === "admin") return "owner";
  if (role === "staff") return "staff";
  if (role === "approver" || role === "viewer") return "approver";
  return "management";
}

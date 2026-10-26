/**
 * P48 "What to do here": for every page, what it is for and the next steps, written for the
 * person reading it. `staff`: a staff member (their own AI only); `manager`: owners, admins
 * and managers. A page with one entry shows it to both. Shown under the page title
 * (components/page-tips.tsx); each person can hide it per page and bring it back.
 *
 * Keys are the nav paths (nav.ts); `t()` translates (Malay in i18n/ms/tips.ts).
 */
import { msg } from "@/i18n";

export interface Tip {
  what: string;
  steps: string[];
}

export type Audience = "staff" | "manager";

export const PAGE_TIPS: Record<string, Partial<Record<Audience, Tip>>> = {
  "/workspace": {
    staff: {
      what: msg("Your desk: the work you gave, what your AI is doing, and what waits for you."),
      steps: [
        msg("Type what you need in Give your AI a task, in your own words."),
        msg("Answer anything under Waiting for you: your AI asks before important steps."),
        msg("Accept or send back finished work in My work."),
      ],
    },
    manager: {
      what: msg("Your own desk: work you gave, your files, and what waits for you personally."),
      steps: [
        msg("Give a task to any agent you look after from the box at the top."),
        msg("Clear Waiting for you first: approvals, documents to review, finished work to accept."),
        msg("For the whole office, open the Command center."),
      ],
    },
  },
  "/": {
    manager: {
      what: msg("The whole office at a glance: who is working, what waits on you, and what it costs."),
      steps: [
        msg("Start with Waiting on you and To review: those are blocked until you act."),
        msg("Agents asking means an agent is stuck or needs more budget."),
        msg("New here? Follow Getting started, one step at a time."),
      ],
    },
  },
  "/my-worker": {
    staff: {
      what: msg("Your AI worker: what it is doing, its hours and its daily duties."),
      steps: [
        msg("Give it a task, or chat with it for quick answers."),
        msg("Add duties for work you repeat, like a weekly report every Monday."),
        msg("Set its hours so it works when you do."),
      ],
    },
  },
  "/assistants": {
    manager: {
      what: msg("Your private assistants: they read your email, keep your calendar and draft replies, for you only."),
      steps: [
        msg("Connect Gmail or Outlook so they can read and draft."),
        msg("Drafts wait in Drafts: nothing is sent until you press Send."),
      ],
    },
  },
  "/computers": {
    staff: {
      what: msg("Your own computers, linked so your AI can find files and you can reach them from anywhere."),
      steps: [
        msg("Link a computer: copy one line into PowerShell or Terminal on it."),
        msg("Choose the folders your AI may see; everything else stays private."),
        msg("Away from the office? Open it from the web to see its files or its screen."),
      ],
    },
  },
  "/impact": {
    manager: {
      what: msg("What the AI saved the business: hours of work, money and turnaround, per company."),
      steps: [msg("Compare periods to see whether the AI team is paying off.")],
    },
  },
  "/tasks": {
    staff: {
      what: msg("Every piece of work you gave or that your AI does, from waiting to done."),
      steps: [
        msg("Press New task to hand out work."),
        msg("Waiting for a person means you need to decide something: open it."),
        msg("A task stuck or failed? Open it and use Stop, Try another AI or Finish it myself."),
      ],
    },
    manager: {
      what: msg("All the office's work, from waiting to done. Columns show where each task stands."),
      steps: [
        msg("Check the Waiting for a person column daily: those tasks need a decision."),
        msg("Open a failed task to retry it on another AI or agent, or finish it yourself."),
        msg("Filter by company or agent to see one team's load."),
      ],
    },
  },
  "/forms": {
    staff: {
      what: msg("Company forms: claims, leave, reports. Your AI can fill them in for you."),
      steps: [msg("Open a form and press Ask AI to fill it from your files."), msg("Check what it filled, then submit.")],
    },
    manager: {
      what: msg("The company's forms, who must fill them and when, and what came in."),
      steps: [msg("Make a form from a template or your own Word or Excel file."), msg("Set who fills it and how often; reminders go out on their own.")],
    },
  },
  "/approvals": {
    staff: {
      what: msg("Your AI asks here before important steps: sending, paying, submitting."),
      steps: [msg("Read what it wants to do and why, then Approve or Deny."), msg("Deny with a reason: your AI learns from it.")],
    },
    manager: {
      what: msg("Everything agents asked permission for. Nothing risky happens until someone here says yes."),
      steps: [
        msg("Approve or deny each request; a reason teaches the agent."),
        msg("Approve always for a tool you trust, so it stops asking."),
        msg("Too many small money approvals? Set limits in Settings > Approval limits."),
      ],
    },
  },
  "/mail": {
    staff: {
      what: msg("Your Outlook, read by your AI: sorted, summarised, with drafts waiting for you."),
      steps: [
        msg("Check Drafts waiting: send, edit or discard each one."),
        msg("Add Rules: when mail is from someone or about something, draft a reply or save its attachments."),
      ],
    },
    manager: {
      what: msg("Your Outlook and the shared mailboxes: sorted mail, drafts waiting, and inbox rules."),
      steps: [
        msg("Pick a mailbox at the top, then check Drafts waiting."),
        msg("Add Rules so routine mail is handled the same way every time."),
        msg("Shared mailboxes save attachments into the Library and turn bills into payables."),
      ],
    },
  },
  "/chat": {
    staff: {
      what: msg("Talk to your AI for quick answers and small jobs."),
      steps: [msg("Ask anything about your work or company documents."), msg("For bigger work, ask it to make a task.")],
    },
    manager: {
      what: msg("Talk to any agent you look after. Quick questions here; bigger work as tasks."),
      steps: [msg("Pick an agent on the left."), msg("Say \"make this a task\" when the job needs steps or approvals.")],
    },
  },
  "/reports": {
    staff: {
      what: msg("Reports your AI wrote for you: summaries, mail digests, daily summaries."),
      steps: [msg("Open one to read it, or download its tables as CSV.")],
    },
    manager: {
      what: msg("Every report the agents wrote: summaries, digests, weekly learning, end-of-day reports."),
      steps: [msg("Filter by agent or company."), msg("Download any table as CSV for Excel.")],
    },
  },
  "/objectives": {
    manager: {
      what: msg("Big goals the agents work towards over weeks, with a budget and progress."),
      steps: [msg("Write a goal in plain words; the agents plan the steps."), msg("Check progress and cost; pause it any time.")],
    },
  },
  "/workflows": {
    staff: {
      what: msg("Step-by-step jobs your AI can run the same way every time."),
      steps: [msg("Start one from a template, or ask your AI to draft one."), msg("Run it, and check each step's result.")],
    },
    manager: {
      what: msg("Repeatable jobs drawn as steps, with who does each and where a person checks."),
      steps: [
        msg("Start from a template or let the AI draft one from your SOP."),
        msg("Add an approval step where a person must agree."),
        msg("Run it or put it on a schedule."),
      ],
    },
  },
  "/contacts": {
    staff: {
      what: msg("Customers and suppliers, with everything that happened with each."),
      steps: [msg("Search for a company to see its emails, deals and invoices.")],
    },
    manager: {
      what: msg("Customers and suppliers, and the full history with each: email, deals, invoices."),
      steps: [msg("Add contacts by hand or import a spreadsheet."), msg("Open one to see its timeline and what is owed.")],
    },
  },
  "/deals": {
    staff: {
      what: msg("Sales in progress, from first contact to won or lost."),
      steps: [msg("Move a deal to its next stage as it changes."), msg("Ask your AI to draft the next follow-up.")],
    },
    manager: {
      what: msg("The sales pipeline: every deal, its value and stage."),
      steps: [msg("Drag deals between stages, or let agents update them from email."), msg("Check deals with no recent activity.")],
    },
  },
  "/money": {
    manager: {
      what: msg("What customers owe you and what you owe suppliers, with what is overdue and coming."),
      steps: [
        msg("Approve bills in Payables: check what the AI read, correct it if needed, then Approve."),
        msg("Upload receipts and bills here, or let staff send photos on WhatsApp."),
        msg("Send reminders for overdue invoices from each invoice."),
      ],
    },
  },
  "/files": {
    staff: {
      what: msg("The company Library: SOPs, policies, templates and documents your AI reads before it works."),
      steps: [msg("Search for any document by what it says."), msg("Upload your own files to My workspace.")],
    },
    manager: {
      what: msg("The company Library. Every agent reads it before it works, so keep SOPs and policies here."),
      steps: [
        msg("Upload SOPs and policies, or a whole ZIP of company files."),
        msg("Mark money, contracts and HR files as restricted to their department."),
        msg("Connect B2, S3 or a file server in Settings > File storage to import in place."),
      ],
    },
  },
  "/agents": {
    manager: {
      what: msg("Your AI team: who each agent is, its job, rules and how it is doing."),
      steps: [
        msg("Hire an agent from a blueprint, or Recruit with AI for any job."),
        msg("Open an agent to set what it may do without asking."),
      ],
    },
  },
  "/timetable": {
    manager: {
      what: msg("Each agent's working day, like a staff rota."),
      steps: [
        msg("Click an agent to set its hours and breaks."),
        msg("Add daily duties from the ready-made list: check email, chase invoices, end-of-day summary."),
        msg("Turn on the end-of-day summary to hear what each agent did."),
      ],
    },
  },
  "/office": {
    manager: {
      what: msg("The office as a picture: who is at their desk, in a meeting, or stuck."),
      steps: [msg("Click an agent to see what it is doing right now.")],
    },
  },
  "/monitor": {
    manager: {
      what: msg("Live activity: every step the agents take, as it happens."),
      steps: [msg("Use it when something looks wrong; filter by agent or task.")],
    },
  },
  "/meetings": {
    manager: {
      what: msg("Meetings between agents, and minutes from your own recorded meetings."),
      steps: [msg("Upload a recording to get minutes and action items."), msg("Turn action items into tasks.")],
    },
  },
  "/broadcasts": {
    manager: {
      what: msg("Send one message to many agents at once: a new rule, a price change, a holiday."),
      steps: [msg("Write it once; every agent you pick keeps it in mind from now on.")],
    },
  },
  "/brain": {
    manager: {
      what: msg("What the office remembers: facts, lessons and notes the agents learned."),
      steps: [msg("Search to see what an agent knows."), msg("Correct or forget a fact that is wrong.")],
    },
  },
  "/skills": {
    manager: {
      what: msg("Skills: how-to steps agents learned. Routines: jobs they repeat without paid AI."),
      steps: [msg("Approve or reject skill proposals."), msg("Trust routines that look right, so they start saving tokens.")],
    },
  },
  "/learning": {
    manager: {
      what: msg("What each agent learned this week, and what waits for you to trust."),
      steps: [msg("Trust the routines that look right."), msg("Decide the skill proposals."), msg("Read the lessons: they come from people saying no.")],
    },
  },
  "/blueprints": {
    manager: {
      what: msg("Job descriptions for agents: instructions, tools, skills and SOPs, ready to hire from."),
      steps: [msg("Press Recruit with AI and name any job: it researches it and drafts a blueprint."), msg("Review the draft, then hire an agent from it.")],
    },
  },
  "/organization": {
    manager: {
      what: msg("Your companies and their departments; every agent belongs to one."),
      steps: [msg("Add a company and pick its industry to get a ready AI team."), msg("Add departments, then hire agents into them.")],
    },
  },
  "/settings": {
    staff: {
      what: msg("Your account: language, how your AI talks to you, password."),
      steps: [msg("Pick how your AI speaks: standard, casual Malay or your state's dialect.")],
    },
    manager: {
      what: msg("Your account and the office's settings."),
      steps: [msg("Set your language and how your AI speaks."), msg("Members, AI use, storage and approval limits are in the menu under Setup.")],
    },
  },
  "/settings/ai-use": {
    manager: {
      what: msg("How much AI each person may use a day, and what staff may use it for."),
      steps: [msg("Set a daily allowance per person or per role."), msg("Check refused requests: they show where staff need more.")],
    },
  },
  "/settings/storage": {
    manager: {
      what: msg("Where company files are kept: the database, this server's disk, a bucket or your file server."),
      steps: [msg("Add storage and test it."), msg("Turn on Import to bring its documents into the Library.")],
    },
  },
  "/settings/approval-limits": {
    manager: {
      what: msg("Let small, routine money steps go through without waiting for you."),
      steps: [msg("Set the amount for bills from known suppliers."), msg("Check What went through on its own now and then.")],
    },
  },
  "/ai-engine": {
    manager: {
      what: msg("The AI models the office uses, what they cost, and how private each company's data stays."),
      steps: [
        msg("Add a provider key; free and local models work too."),
        msg("Set each company's privacy level: Standard, Confidential or Local only."),
      ],
    },
  },
  "/channels": {
    staff: {
      what: msg("Where your AI reaches you: phone notifications, Telegram, WhatsApp."),
      steps: [msg("Turn on notifications on this device."), msg("Link WhatsApp or Telegram to approve from your phone and send receipts as photos.")],
    },
    manager: {
      what: msg("How the office talks to the outside: notifications, Telegram, WhatsApp, Outlook and shared mailboxes."),
      steps: [msg("Connect WhatsApp or Telegram, then have staff link with a code."), msg("Add shared mailboxes so agents handle company email.")],
    },
  },
  "/logins": {
    staff: {
      what: msg("Website logins your AI may use for you, kept encrypted."),
      steps: [msg("Add a login only for sites you want your AI to use.")],
    },
    manager: {
      what: msg("Website logins agents may use (portals, e-perolehan), kept encrypted."),
      steps: [msg("Add a login and say which agents may use it."), msg("Submitting forms on a site always asks a person first.")],
    },
  },
  "/schedules": {
    manager: {
      what: msg("Every job that runs by itself at set times, and how each run went."),
      steps: [msg("Add a schedule in plain words, like every Monday at 9am."), msg("Check Runs and Incidents for anything that failed.")],
    },
  },
  "/mcp-servers": {
    manager: {
      what: msg("Extra tools from other systems, connected through MCP."),
      steps: [msg("Add a server, then choose which agents may use its tools.")],
    },
  },
  "/activity": {
    manager: {
      what: msg("Who changed what, and when: the office's audit log."),
      steps: [msg("Filter by kind to find a change."), msg("Entries cannot be edited or deleted.")],
    },
  },
};

/** The tip for this page and this person, or null. */
export function tipFor(path: string, audience: Audience): Tip | null {
  const entry = PAGE_TIPS[path];
  if (!entry) return null;
  return entry[audience] ?? entry.manager ?? entry.staff ?? null;
}

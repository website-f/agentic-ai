/**
 * P79: where each step of a page's "What to do here" (page-tips.ts) is on that page, for Show
 * me on this page in Rules & guide (components/feedback/guide-tour.tsx).
 *
 * Keyed by the step as written in page-tips.ts; the value names the element the step is about
 * as the page labels it in English (its text, aria-label or placeholder). Several names: the
 * first one on screen wins (an empty page shows "Create the first one", a full one "New
 * workflow"). Names are translated like the page is, so the Malay page is marked the same.
 * A step left out is matched by its own words, or listed without a mark.
 */
import type { GuideStep } from "@/components/feedback/guide-targets";
import type { Recipe } from "@/guide/content";

import type { Tip } from "./page-tips";

export const STEP_MARKS: Record<string, string[]> = {
  "Type what you need in Give your AI a task, in your own words.": ["What do you need?", "Give my AI a task"],
  "Start with Needs you under Today: your AI asks before important steps.": ["Needs you"],
  "Pin anything you use often, and press Customize to show only what you need.": ["Pinned", "Customize"],
  "Search or jump anywhere from the bar at the top, or press Ctrl K.": ["Search or jump to anything: pages, people, tasks, documents, agents"],
  "Clear Needs you first: approvals, documents to review, finished work to accept.": ["Needs you"],
  "For the whole office, open the Command center.": ["Command center"],
  "Start with Waiting on you and To review: those are blocked until you act.": ["Waiting on you", "To review"],
  "Agents asking means an agent is stuck or needs more budget.": ["Agents asking"],
  "New here? Follow Getting started, one step at a time.": ["Getting started"],
  "Give it a task, or chat with it for quick answers.": ["Give a task", "Chat"],
  "Add duties for work you repeat, like a weekly report every Monday.": ["Add a duty", "Duties"],
  "Set its hours so it works when you do.": ["Change hours", "Its week"],
  "Connect Gmail or Outlook so they can read and draft.": ["Connect Google", "Connect Outlook", "Connections", "Settings"],
  "Drafts wait in Drafts: nothing is sent until you press Send.": ["Drafts"],
  "Link a computer: copy one line into PowerShell or Terminal on it.": ["Link a computer"],
  "Choose the folders your AI may see; everything else stays private.": ["Folders", "Add a folder"],
  "Away from the office? Open it from the web to see its files or its screen.": ["Open from the web"],
  "Compare periods to see whether the AI team is paying off.": ["Period", "30 days"],
  "Press New task to hand out work.": ["New task", "Create first task"],
  "A card under Waiting means you need to decide something: open it.": ["Waiting"],
  "A task stuck or failed? Open it and use Stop, Try another AI or Finish it myself.": ["Failed and cancelled"],
  "Check the Waiting column daily: those tasks need a decision.": ["Waiting"],
  "Open a failed task to retry it on another AI or agent, or finish it yourself.": ["Failed and cancelled", "Retry all failed"],
  "Filter by company or agent to see one team's load.": ["Search cards by title, agent or label", "Whose cards"],
  "Open a form and press Ask AI to fill it from your files.": ["Ask AI to fill it", "To hand in"],
  "Check what it filled, then submit.": ["Check and hand in", "Hand in"],
  "Make a form from a template or your own Word or Excel file.": ["Add a form"],
  "Set who fills it and how often; reminders go out on their own.": ["Who fills it in", "When it is handed in", "Add a form"],
  "Read what it wants to do and why, then Approve or Deny.": ["Approve once", "Deny", "Waiting"],
  "Deny with a reason: your AI learns from it.": ["Reason (optional, the agent reads it)", "Deny"],
  "Approve or deny each request; a reason teaches the agent.": ["Approve once", "Deny", "Waiting"],
  "Approve always for a tool you trust, so it stops asking.": ["Always allow for {name}", "Approve once"],
  "Too many small money approvals? Set limits in Settings > Approval limits.": ["Approval limits"],
  "Check Waiting for your approval: send, edit or discard each draft.": ["Waiting for your approval", "All drafts"],
  "Add Rules: when mail is from someone or about something, draft a reply or save its attachments.": ["What your AI does with your mail"],
  "Pick a mailbox at the top, then check Waiting for your approval.": ["Mailbox", "Waiting for your approval"],
  "Add Rules so routine mail is handled the same way every time.": ["What your AI does with your mail"],
  "Shared mailboxes save attachments into the Library and turn bills into payables.": ["Mailbox", "Open Channels"],
  "Ask anything about your work or company documents.": ["Agents", "Recent conversations", "Meet your AI twin"],
  "Pick an agent to talk to.": ["Agents", "Find an agent", "New agent"],
  "Open one to read it, or download its tables as CSV.": ["Search reports"],
  "Use Search reports to find one.": ["Search reports"],
  "Write a goal in plain words; the agents plan the steps.": ["New objective"],
  "Check progress and what it has cost so far.": ["Work done", "Spent on active", "Needs attention"],
  "Start one from a template, or ask your AI to draft one.": ["Start from a template", "Ask AI to draft it", "New workflow", "Create the first one"],
  "Run it, and check each step's result.": ["Run", "Recent runs"],
  "Start from a template or let the AI draft one from your SOP.": ["Start from a template", "Ask AI to draft it", "New workflow", "Create the first one"],
  "Add an approval step where a person must agree.": ["Approval", "Add step"],
  "Run it, then follow each run under Recent runs.": ["Run", "Recent runs"],
  "Pick a list from the tabs at the top; tap a row to see everything about it.": ["CRM sections"],
  "Use Search and Filter to find what you need.": ["Search", "Filter"],
  "Tap Add to CRM: add what the office already has, or a starter for your kind of business.": ["Add to CRM", "1. Already in your office"],
  "Make your own list for anything else, then add the fields you want.": ["Make my own list", "3. Anything else", "Add to CRM"],
  "Connect your other systems in Connections, and share parts with your team in Sharing.": ["Connections", "Sharing"],
  "Do the first step that is not ticked yet; each one opens the right page.": ["Add an AI key", "Add the company", "Open the AI team", "Upload files", "Add people", "Connect your phone", "Give a task"],
  "Steps tick themselves when they are done.": ["Done"],
  "Search for a company to see its emails, deals and invoices.": ["Search name, email, phone, TIN or SSM"],
  "Add contacts by hand or import a spreadsheet.": ["New contact", "Import from Excel/CSV"],
  "Open one to see its timeline and what is owed.": ["Timeline", "Search name, email, phone, TIN or SSM"],
  "Move a deal to its next stage as it changes.": ["Stage", "Lead|deal"],
  "Drag deals between stages, or let agents update them from email.": ["Lead|deal", "New deal"],
  "Approve bills in Payables: check what the AI read, correct it if needed, then Approve.": ["Payables", "Bills awaiting approval"],
  "Upload receipts and bills here, or let staff send photos on WhatsApp.": ["Upload receipts and bills"],
  "Send reminders for overdue invoices from each invoice.": ["Send reminder", "Overdue only", "Overdue"],
  "Search for any document by what it says.": ["Search inside documents", "Search folders and files"],
  "Upload your own files to My workspace.": ["Upload", "Upload files"],
  "Upload SOPs and policies, or a whole ZIP of company files.": ["Upload", "Choose files", "Upload files"],
  "Mark money, contracts and HR files as restricted to their department.": ["Department"],
  "Hire an agent from a blueprint, or Recruit with AI for any job.": ["New agent", "Create first agent"],
  "Open an agent to set what it may do without asking.": ["Permissions"],
  "Click an agent to set its hours and breaks.": ["Working hours", "No agents yet"],
  "Add daily duties from the ready-made list: check email, chase invoices, end-of-day summary.": ["Start the day: go through new email", "Something else"],
  "Turn on the end-of-day summary to hear what each agent did.": ["Send a summary when its day ends", "End of day summary"],
  "Click an agent to see what it is doing right now.": ["People in the office", "Agent"],
  "Use it when something looks wrong; filter by agent or task.": ["Everyone at work", "No agents to watch"],
  "Upload a recording to get minutes and action items.": ["Upload a recording", "People meetings"],
  "Turn action items into tasks.": ["Action items", "Create task", "People meetings"],
  "Write it once; every agent you pick keeps it in mind from now on.": ["New broadcast", "Message"],
  "Search to see what an agent knows.": ["Ask what the office knows, in English or Malay", "Search"],
  "Correct or forget a fact that is wrong.": ["Correct this fact", "Facts"],
  "Approve or reject skill proposals.": ["Approve", "Proposals", "To review"],
  "Trust routines that look right, so they start saving tokens.": ["Trust it now", "Routines"],
  "Trust the routines that look right.": ["Trust", "Waiting for you", "Week by agent"],
  "Decide the skill proposals.": ["Waiting for you", "Waiting for review", "Overview and autopilot"],
  "Read the lessons: they come from people saying no.": ["Week by agent"],
  "Press Recruit with AI and name any job: it researches it and drafts a blueprint.": ["Recruit with AI"],
  "Review the draft, then hire an agent from it.": ["Apply to an agent"],
  "Add a company and pick its industry to get a ready AI team.": ["New branch", "Create first branch"],
  "Add departments, then hire agents into them.": ["Department"],
  "Pick how your AI speaks: standard, casual Malay or your state's dialect.": ["How your AI speaks to you"],
  "Set your language and how your AI speaks.": ["Language", "How your AI speaks to you"],
  "Members, AI use, storage and approval limits are in the menu under Settings.": ["Members and roles", "AI use and limits"],
  "Set a daily allowance per person or per role.": ["Daily AI allowance", "Each person today"],
  "Check refused requests: they show where staff need more.": ["Refused requests"],
  "Add storage and test it.": ["Add storage", "Test"],
  "Turn on Import to bring its documents into the Library.": ["Import its documents into the Library", "No other storage yet"],
  "Set the amount for bills from known suppliers.": ["Up to (RM)", "Approve small supplier bills and receipts on their own"],
  "Check What went through on its own now and then.": ["What went through on its own"],
  "Add a provider key; free and local models work too.": ["Connect a provider", "Providers"],
  "Set each company's privacy level: Standard, Confidential or Local only.": ["Data protection per company", "Privacy"],
  "Turn on notifications on this device.": ["Notifications on this device", "This device"],
  "Link WhatsApp or Telegram to approve from your phone and send receipts as photos.": ["Link my WhatsApp", "Link my account", "Your WhatsApp", "Your account"],
  "Connect WhatsApp or Telegram, then have staff link with a code.": ["Connect the bot", "Connect and show the QR code", "People linked", "Your account"],
  "Add shared mailboxes so agents handle company email.": ["Add mailbox", "Shared mailboxes", "Connect the office's Microsoft Entra app"],
  "Add a login only for sites you want your AI to use.": ["Save a login"],
  "Add a login and say which agents may use it.": ["Save a login", "Only these agents (optional)"],
  "Add a schedule in plain words, like every Monday at 9am.": ["New schedule"],
  "Check Run ledger and Incidents for anything that failed.": ["Run ledger", "Incidents", "Last run failed"],
  "Add a server: its tools reach your agents, and every call is approved first.": ["Connect server", "Connect a server"],
  "Filter by kind to find a change.": ["Filter activity"],
  "Entries cannot be edited or deleted.": ["Verify log"],
};

/** A tip's steps for the tour, in the person's language. */
export function guideSteps(tip: Tip, t: (s: string) => string): GuideStep[] {
  return tip.steps.map((s) => {
    const labels = STEP_MARKS[s];
    return labels?.length ? { text: t(s), labels: labels.map((l) => t(l)) } : { text: t(s) };
  });
}

/** A User Guide recipe (guide/content.ts, already in the person's language) as a tour: a step
 * lights its guide target, else the first **name** it mentions that is on the page. */
export function recipeSteps(recipe: Recipe): GuideStep[] {
  return recipe.steps.map((s) => {
    const labels = [...s.text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]!).filter(Boolean);
    const step: GuideStep = { text: s.text.replace(/\*\*(.+?)\*\*/g, "$1") };
    if (s.target) step.target = `[data-guide="${s.target}"]`;
    if (labels.length) step.labels = labels;
    return step;
  });
}

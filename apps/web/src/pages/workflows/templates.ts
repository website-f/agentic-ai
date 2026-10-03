/** Ready-made office workflows to start from. Each is a plain graph; people change anything. */
import type { Graph, WNode } from "@/lib/workflows";

import { tidy } from "./layout";
import { libItem } from "./library";

export interface WorkflowTemplate {
  id: string;
  name: string;
  area: "Sales" | "Finance" | "HR" | "Operations" | "Support" | "Marketing" | "Admin";
  description: string;
  graph: Graph;
}

type S = [id: string, kind: string, title: string, body?: string, extra?: Partial<WNode>];
type E = [from: string, to: string, label?: string];

function build(steps: S[], edges: E[]): Graph {
  const nodes: WNode[] = steps.map(([id, kind, title, body = "", extra = {}]) => {
    const it = libItem(kind)!;
    return { id, type: it.type, action: it.action, title, body, role: "", x: 0, y: 0, ...it.init, ...extra };
  });
  return tidy({ nodes, edges: edges.map(([from, to, label = ""], i) => ({ id: `e${i + 1}`, from, to, label })) });
}

export const TEMPLATES: WorkflowTemplate[] = [
  {
    id: "enquiry", name: "Client enquiry to quotation", area: "Sales",
    description: "Qualify a new enquiry, research the client, quote, approve and reply.",
    graph: build(
      [["s", "start", "Enquiry comes in", "Email, WhatsApp or web form from a prospect."],
        ["r", "read", "Pull out the request", "What they need, where, when, budget and contact."],
        ["q", "research", "Research the client", "Company background and any red flags."],
        ["d", "decision", "Good fit?"],
        ["t", "template", "Prepare the quotation", "From the Quotation template."],
        ["a", "approval", "Manager approves the quote"],
        ["m", "email", "Send the quotation", "Cover email with the quotation attached."],
        ["n", "reply", "Polite decline", "Thank them and suggest alternatives."],
        ["x", "message", "Note what to change", "The manager's comments, for a new quote."],
        ["e", "end", "Closed"]],
      [["s", "r"], ["r", "q"], ["q", "d"], ["d", "t", "yes"], ["d", "n", "no"], ["t", "a"], ["a", "m", "approved"], ["a", "x", "rejected"], ["m", "e"], ["n", "e"], ["x", "e"]],
    ),
  },
  {
    id: "invoice", name: "Supplier invoice processing", area: "Finance",
    description: "Read the invoice, match it to the PO, get approval, record it and tell the supplier.",
    graph: build(
      [["s", "start", "Invoice received"],
        ["r", "read", "Read the invoice", "Supplier, invoice no., date, items, total, due date."],
        ["p", "input", "Which PO is it for?", "Finance gives the purchase order number."],
        ["c", "check", "Match against the PO", "Quantities, prices and totals agree?"],
        ["d", "decision", "Everything matches?"],
        ["a", "approval", "Finance manager approves payment"],
        ["x", "spreadsheet", "Record in the payables sheet"],
        ["m", "email", "Payment notice to supplier"],
        ["q", "email", "Query the supplier", "List each mismatch clearly."],
        ["e", "end", "Done"]],
      [["s", "r"], ["r", "p"], ["p", "c"], ["c", "d"], ["d", "a", "yes"], ["d", "q", "no"], ["a", "x", "approved"], ["a", "q", "rejected"], ["x", "m"], ["m", "e"], ["q", "e"]],
    ),
  },
  {
    id: "leave", name: "Leave request", area: "HR",
    description: "Check the balance, get the manager's approval, tell the team.",
    graph: build(
      [["s", "start", "Leave request"],
        ["c", "calculate", "Check leave balance", "Days asked vs days left this year."],
        ["d", "decision", "Enough days?"],
        ["a", "approval", "Manager approves"],
        ["m", "message", "Tell the team", "Who covers, and the dates away."],
        ["n", "reply", "Explain to the staff", "Why it can't be approved and what they can do."],
        ["e", "end", "Done"]],
      [["s", "c"], ["c", "d"], ["d", "a", "yes"], ["d", "n", "no"], ["a", "m", "approved"], ["a", "n", "rejected"], ["m", "e"], ["n", "e"]],
    ),
  },
  {
    id: "purchase", name: "Purchase request", area: "Operations",
    description: "Get three quotes, compare, recommend, approve, issue the PO.",
    graph: build(
      [["s", "start", "Someone needs to buy something"],
        ["q", "research", "Find three suppliers", "Prices, delivery time, warranty."],
        ["c", "analyse", "Compare the quotes", "Table of price, delivery, terms."],
        ["w", "write", "Write a recommendation", "Which supplier and why, in five lines."],
        ["a", "approval", "Approve the purchase"],
        ["t", "template", "Issue the purchase order"],
        ["m", "email", "Send the PO to the supplier"],
        ["x", "message", "Tell the requester why", "The reason and what to do instead."],
        ["e", "end", "Ordered"]],
      [["s", "q"], ["q", "c"], ["c", "w"], ["w", "a"], ["a", "t", "approved"], ["a", "x", "rejected"], ["t", "m"], ["m", "e"], ["x", "e"]],
    ),
  },
  {
    id: "weekly", name: "Weekly management report", area: "Admin",
    description: "Gather the week's numbers, summarise, check and publish.",
    graph: build(
      [["s", "start", "Every Friday"],
        ["r", "read", "Gather this week's files", "Sales, spend, tickets, attendance."],
        ["a", "analyse", "Work out the numbers", "Totals and change vs last week."],
        ["w", "summarise", "Summarise the week", "Wins, problems, decisions needed."],
        ["c", "check", "Check figures and wording"],
        ["p", "report", "Publish the report"],
        ["m", "message", "Share with management"],
        ["e", "end", "Done"]],
      [["s", "r"], ["r", "a"], ["a", "w"], ["w", "c"], ["c", "p"], ["p", "m"], ["m", "e"]],
    ),
  },
  {
    id: "recruit", name: "Recruitment screening", area: "HR",
    description: "Read CVs, shortlist, schedule interviews and email candidates.",
    graph: build(
      [["s", "start", "CVs received"],
        ["r", "read", "Read every CV", "Experience, skills, salary, notice period."],
        ["k", "classify", "Shortlist", "Shortlist / maybe / no, against the job's must-haves."],
        ["d", "decision", "Anyone shortlisted?"],
        ["p", "plan", "Plan interviews", "Slots over the next week."],
        ["m", "email", "Invite candidates"],
        ["n", "email", "Thank the others"],
        ["e", "end", "Done"]],
      [["s", "r"], ["r", "k"], ["k", "d"], ["d", "p", "yes"], ["d", "n", "no"], ["p", "m"], ["m", "n"], ["n", "e"]],
    ),
  },
  {
    id: "complaint", name: "Customer complaint", area: "Support",
    description: "Understand it, route it, reply, then follow up.",
    graph: build(
      [["s", "start", "Complaint received"],
        ["u", "summarise", "What happened", "The issue, the customer, what they want."],
        ["k", "classify", "How serious?", "Low, medium or urgent."],
        ["d", "decision", "Urgent?"],
        ["h", "handoff", "Hand to the right department", "With the summary and the customer's details."],
        ["r", "reply", "Reply to the customer", "Apologise, explain the next step and when."],
        ["w", "wait", "Give it time", "", { wait_amount: 2, wait_unit: "days" }],
        ["i", "input", "Is the customer satisfied?", "Support confirms after following up."],
        ["e", "end", "Closed"]],
      [["s", "u"], ["u", "k"], ["k", "d"], ["d", "h", "yes"], ["d", "r", "no"], ["h", "r"], ["r", "w"], ["w", "i"], ["i", "e"]],
    ),
  },
  {
    id: "social", name: "Social media post", area: "Marketing",
    description: "Research, write in two languages, approve and schedule.",
    graph: build(
      [["s", "start", "Post idea"],
        ["q", "research", "Research the topic", "Facts, trends and what competitors posted."],
        ["w", "write", "Write the post", "Hook, body, call to action, hashtags."],
        ["t", "translate", "Bahasa Melayu version"],
        ["a", "approval", "Marketing lead approves"],
        ["p", "plan", "Schedule it", "Best day and time for each platform."],
        ["x", "message", "Changes needed", "What the lead wants changed, for the next draft."],
        ["e", "end", "Scheduled"]],
      [["s", "q"], ["q", "w"], ["w", "t"], ["t", "a"], ["a", "p", "approved"], ["a", "x", "rejected"], ["p", "e"], ["x", "e"]],
    ),
  },
  {
    id: "tender", name: "Submission pack", area: "Sales",
    description: "Read the requirements, gather the documents, check and approve.",
    graph: build(
      [["s", "start", "Tender or proposal to submit"],
        ["r", "read", "Read the requirements", "Every document and form they ask for, and the deadline."],
        ["p", "pack", "Gather the pack", "Match each item to the company's files."],
        ["i", "input", "Anything only you have?", "Signed forms, special approvals."],
        ["t", "template", "Cover letter and quotation"],
        ["c", "check", "Final check", "Every item there, signed, in date."],
        ["a", "approval", "Director approves"],
        ["x", "message", "Fix list for the team", "What the director wants fixed before submitting."],
        ["e", "end", "Ready to submit", "A person submits it."]],
      [["s", "r"], ["r", "p"], ["p", "i"], ["i", "t"], ["t", "c"], ["c", "a"], ["a", "e", "approved"], ["a", "x", "rejected"], ["x", "e"]],
    ),
  },
  {
    id: "monthend", name: "Month-end close", area: "Finance",
    description: "Reconcile, explain variances, approve and report.",
    graph: build(
      [["s", "start", "Last working day"],
        ["x", "spreadsheet", "Reconcile bank and ledger"],
        ["c", "check", "Find mismatches"],
        ["a", "analyse", "Explain big variances", "Anything over 10% vs budget."],
        ["w", "summarise", "Month summary", "Revenue, costs, cash, notes."],
        ["p", "approval", "Finance director approves"],
        ["r", "report", "Publish the month report"],
        ["f", "message", "Questions for finance", "What the director wants explained first."],
        ["e", "end", "Closed"]],
      [["s", "x"], ["x", "c"], ["c", "a"], ["a", "w"], ["w", "p"], ["p", "r", "approved"], ["p", "f", "rejected"], ["r", "e"], ["f", "e"]],
    ),
  },
  {
    id: "meeting", name: "Meeting follow-up", area: "Admin",
    description: "Minutes, action items, emails and a check-in a few days later.",
    graph: build(
      [["s", "start", "Meeting finished"],
        ["u", "summarise", "Write the minutes", "Decisions and who does what by when."],
        ["p", "plan", "Action list"],
        ["m", "email", "Email the attendees"],
        ["w", "wait", "Wait for progress", "", { wait_amount: 3, wait_unit: "days" }],
        ["c", "task", "Check on the actions", "Who is done, who is late."],
        ["e", "end", "Done"]],
      [["s", "u"], ["u", "p"], ["p", "m"], ["m", "w"], ["w", "c"], ["c", "e"]],
    ),
  },
  {
    id: "onboard", name: "New staff onboarding", area: "HR",
    description: "Welcome, first-week plan, accounts and team intro.",
    graph: build(
      [["s", "start", "Offer accepted"],
        ["i", "input", "Start date and role", "HR confirms the details."],
        ["w", "email", "Welcome email", "What to bring, where to go, who to ask."],
        ["p", "plan", "First-week plan"],
        ["h", "handoff", "IT sets up accounts", "Email, laptop, system access."],
        ["m", "message", "Introduce to the team"],
        ["e", "end", "Ready for day one"]],
      [["s", "i"], ["i", "w"], ["i", "h"], ["w", "p"], ["p", "m"], ["h", "m"], ["m", "e"]],
    ),
  },
];

/** The step library: every kind of office work a workflow can hold, grouped for the palette.
 * A library item is a node type plus (for work steps) an action; the action key matches the
 * server's ACTIONS so the agent doing the step gets the right instructions. */
import {
  CalculatorIcon, CalendarCheckIcon, ChartBarIcon, ChatCircleTextIcon, CheckSquareIcon, ClipboardTextIcon, EnvelopeSimpleIcon,
  FileMagnifyingGlassIcon, FileTextIcon, FlagCheckeredIcon, GitForkIcon, GlobeIcon, HandshakeIcon, HourglassIcon,
  MagnifyingGlassIcon, MegaphoneIcon, NotePencilIcon, PackageIcon, PenNibIcon, PlayCircleIcon, RobotIcon, SealCheckIcon,
  TableIcon, TagIcon, TextAlignLeftIcon, TextboxIcon, TranslateIcon, UserFocusIcon, UsersThreeIcon, type Icon,
} from "@phosphor-icons/react";

import type { Tone } from "@/components/page";
import type { NodeType, WNode } from "@/lib/workflows";

export interface LibItem {
  key: string;
  type: NodeType;
  action?: string;
  label: string;
  desc: string;
  icon: Icon;
  tone: Tone;
  group: (typeof GROUPS)[number];
  /** Extra fields a new node of this kind starts with. */
  init?: Partial<WNode>;
}

export const GROUPS = ["Flow", "AI work", "Communication", "Documents", "Web", "People"] as const;

export const LIBRARY: LibItem[] = [
  // Flow
  { key: "start", type: "start", label: "Start", desc: "Where the job comes in", icon: PlayCircleIcon, tone: "ok", group: "Flow" },
  { key: "decision", type: "decision", label: "Decision", desc: "The job branches: yes / no, or more ways", icon: GitForkIcon, tone: "warn", group: "Flow" },
  { key: "wait", type: "wait", label: "Wait", desc: "Pause for minutes, hours or days", icon: HourglassIcon, tone: "orange", group: "Flow", init: { wait_amount: 1, wait_unit: "days" } },
  { key: "end", type: "end", label: "End", desc: "The job is finished", icon: FlagCheckeredIcon, tone: "danger", group: "Flow" },
  { key: "note", type: "note", label: "Note", desc: "A sticky note for people; never run", icon: NotePencilIcon, tone: "neutral", group: "Flow" },
  // AI work
  { key: "task", type: "step", action: "task", label: "Agent task", desc: "Any work, in your own words", icon: RobotIcon, tone: "accent", group: "AI work" },
  { key: "research", type: "step", action: "research", label: "Research", desc: "Look into it on the web, with sources", icon: MagnifyingGlassIcon, tone: "info", group: "AI work" },
  { key: "read", type: "step", action: "read", label: "Read files", desc: "Pull facts out of PDFs, scans, sheets", icon: FileMagnifyingGlassIcon, tone: "info", group: "AI work" },
  { key: "write", type: "step", action: "write", label: "Write", desc: "Draft any text, ready to use", icon: PenNibIcon, tone: "accent", group: "AI work" },
  { key: "summarise", type: "step", action: "summarise", label: "Summarise", desc: "Key points, figures and decisions", icon: TextAlignLeftIcon, tone: "accent", group: "AI work" },
  { key: "translate", type: "step", action: "translate", label: "Translate", desc: "BM, English, Chinese and more", icon: TranslateIcon, tone: "violet", group: "AI work" },
  { key: "analyse", type: "step", action: "analyse", label: "Analyse data", desc: "Figures, trends, tables from data", icon: ChartBarIcon, tone: "violet", group: "AI work" },
  { key: "calculate", type: "step", action: "calculate", label: "Calculate", desc: "Totals, tax, payroll, quotes", icon: CalculatorIcon, tone: "violet", group: "AI work" },
  { key: "check", type: "step", action: "check", label: "Check", desc: "Proofread and find errors or gaps", icon: CheckSquareIcon, tone: "ok", group: "AI work" },
  { key: "classify", type: "step", action: "classify", label: "Sort & label", desc: "Sort items into categories", icon: TagIcon, tone: "pink", group: "AI work" },
  { key: "plan", type: "step", action: "plan", label: "Plan", desc: "Who does what, by when", icon: CalendarCheckIcon, tone: "pink", group: "AI work" },
  // Communication
  { key: "email", type: "step", action: "email", label: "Draft email", desc: "Subject and body; a person sends it", icon: EnvelopeSimpleIcon, tone: "info", group: "Communication" },
  { key: "reply", type: "step", action: "reply", label: "Reply to customer", desc: "A clear, polite, complete reply", icon: ChatCircleTextIcon, tone: "info", group: "Communication" },
  { key: "message", type: "step", action: "message", label: "Message the team", desc: "A short update or instruction", icon: MegaphoneIcon, tone: "orange", group: "Communication" },
  { key: "meeting", type: "step", action: "meeting", label: "Prepare meeting", desc: "Agenda, attendees, materials", icon: UsersThreeIcon, tone: "orange", group: "Communication" },
  // Documents
  { key: "template", type: "step", action: "template", label: "Fill a template", desc: "Quotation, invoice, letter, proposal", icon: FileTextIcon, tone: "accent", group: "Documents" },
  { key: "pack", type: "step", action: "pack", label: "Prepare a pack", desc: "Gather a submission pack", icon: PackageIcon, tone: "accent", group: "Documents" },
  { key: "report", type: "step", action: "report", label: "Publish report", desc: "A report people can read and download", icon: ClipboardTextIcon, tone: "ok", group: "Documents" },
  { key: "spreadsheet", type: "step", action: "spreadsheet", label: "Spreadsheet", desc: "Build or update an Excel file", icon: TableIcon, tone: "ok", group: "Documents" },
  // Web
  { key: "browse", type: "step", action: "browse", label: "Look up online", desc: "Check a website or portal", icon: GlobeIcon, tone: "info", group: "Web" },
  { key: "form", type: "step", action: "form", label: "Fill a web form", desc: "A person approves before submitting", icon: TextboxIcon, tone: "warn", group: "Web" },
  // People
  { key: "approval", type: "decision", action: "approval", label: "Approval", desc: "A person approves or rejects", icon: SealCheckIcon, tone: "ok", group: "People", init: { decider: "person" } },
  { key: "input", type: "input", label: "Ask a person", desc: "Wait for information only they have", icon: UserFocusIcon, tone: "pink", group: "People" },
  { key: "handoff", type: "handoff", label: "Hand off", desc: "Pass the work to another department", icon: HandshakeIcon, tone: "violet", group: "People" },
];

const BY_KEY = Object.fromEntries(LIBRARY.map((i) => [i.key, i]));

/** The library item a node is (its action first, else its type). */
export function itemFor(n: Pick<WNode, "type" | "action">): LibItem {
  if (n.action && BY_KEY[n.action] && BY_KEY[n.action]!.type === n.type) return BY_KEY[n.action]!;
  return BY_KEY[n.type] ?? BY_KEY.task!;
}

export const libItem = (key: string) => BY_KEY[key];

/** A node's one-line subtitle on the canvas. */
export function subtitle(n: WNode, agentName?: string | null): string {
  if (n.type === "wait") {
    const a = n.wait_amount ?? 1;
    const u = n.wait_unit ?? "hours";
    return `Wait ${a} ${a === 1 ? u.slice(0, -1) : u}`;
  }
  if (n.type === "decision") return n.decider === "agent" ? `${agentName ?? "An agent"} decides` : "A person decides";
  if (n.type === "input") return "A person answers";
  if (n.type === "start" || n.type === "end" || n.type === "note") return "";
  return [agentName ?? (n.role || ""), n.review ? "you review" : ""].filter(Boolean).join(" · ");
}

/** Tone colour as a CSS value, for edges and the minimap. */
export const TONE_VAR: Record<Tone, string> = {
  accent: "var(--accent)", ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", info: "var(--info)",
  neutral: "var(--text-muted)", violet: "var(--series-7)", orange: "var(--series-2)", pink: "var(--series-5)",
};

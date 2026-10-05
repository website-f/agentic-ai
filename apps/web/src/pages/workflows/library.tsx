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
import { msg, t } from "@/i18n";
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
  { key: "start", type: "start", label: msg("Start"), desc: msg("Where the job comes in"), icon: PlayCircleIcon, tone: "ok", group: "Flow" },
  { key: "decision", type: "decision", label: msg("Decision"), desc: msg("The job branches: yes / no, or more ways"), icon: GitForkIcon, tone: "warn", group: "Flow" },
  { key: "wait", type: "wait", label: msg("Wait"), desc: msg("Pause for minutes, hours or days"), icon: HourglassIcon, tone: "orange", group: "Flow", init: { wait_amount: 1, wait_unit: "days" } },
  { key: "end", type: "end", label: msg("End"), desc: msg("The job is finished"), icon: FlagCheckeredIcon, tone: "danger", group: "Flow" },
  { key: "note", type: "note", label: msg("Note"), desc: msg("A sticky note for people; never run"), icon: NotePencilIcon, tone: "neutral", group: "Flow" },
  // AI work
  { key: "task", type: "step", action: "task", label: msg("Agent task"), desc: msg("Any work, in your own words"), icon: RobotIcon, tone: "accent", group: "AI work" },
  { key: "research", type: "step", action: "research", label: msg("Research"), desc: msg("Look into it on the web, with sources"), icon: MagnifyingGlassIcon, tone: "info", group: "AI work" },
  { key: "read", type: "step", action: "read", label: msg("Read files"), desc: msg("Pull facts out of PDFs, scans, sheets"), icon: FileMagnifyingGlassIcon, tone: "info", group: "AI work" },
  { key: "write", type: "step", action: "write", label: msg("Write"), desc: msg("Draft any text, ready to use"), icon: PenNibIcon, tone: "accent", group: "AI work" },
  { key: "summarise", type: "step", action: "summarise", label: msg("Summarise"), desc: msg("Key points, figures and decisions"), icon: TextAlignLeftIcon, tone: "accent", group: "AI work" },
  { key: "translate", type: "step", action: "translate", label: msg("Translate"), desc: msg("BM, English, Chinese and more"), icon: TranslateIcon, tone: "violet", group: "AI work" },
  { key: "analyse", type: "step", action: "analyse", label: msg("Analyse data"), desc: msg("Figures, trends, tables from data"), icon: ChartBarIcon, tone: "violet", group: "AI work" },
  { key: "calculate", type: "step", action: "calculate", label: msg("Calculate"), desc: msg("Totals, tax, payroll, quotes"), icon: CalculatorIcon, tone: "violet", group: "AI work" },
  { key: "check", type: "step", action: "check", label: msg("Check"), desc: msg("Proofread and find errors or gaps"), icon: CheckSquareIcon, tone: "ok", group: "AI work" },
  { key: "classify", type: "step", action: "classify", label: msg("Sort & label"), desc: msg("Sort items into categories"), icon: TagIcon, tone: "pink", group: "AI work" },
  { key: "plan", type: "step", action: "plan", label: msg("Plan"), desc: msg("Who does what, by when"), icon: CalendarCheckIcon, tone: "pink", group: "AI work" },
  // Communication
  { key: "email", type: "step", action: "email", label: msg("Draft email"), desc: msg("Subject and body; a person sends it"), icon: EnvelopeSimpleIcon, tone: "info", group: "Communication" },
  { key: "reply", type: "step", action: "reply", label: msg("Reply to customer"), desc: msg("A clear, polite, complete reply"), icon: ChatCircleTextIcon, tone: "info", group: "Communication" },
  { key: "message", type: "step", action: "message", label: msg("Message the team"), desc: msg("A short update or instruction"), icon: MegaphoneIcon, tone: "orange", group: "Communication" },
  { key: "meeting", type: "step", action: "meeting", label: msg("Prepare meeting"), desc: msg("Agenda, attendees, materials"), icon: UsersThreeIcon, tone: "orange", group: "Communication" },
  // Documents
  { key: "template", type: "step", action: "template", label: msg("Fill a template"), desc: msg("Quotation, invoice, letter, proposal"), icon: FileTextIcon, tone: "accent", group: "Documents" },
  { key: "pack", type: "step", action: "pack", label: msg("Prepare a pack"), desc: msg("Gather a submission pack"), icon: PackageIcon, tone: "accent", group: "Documents" },
  { key: "report", type: "step", action: "report", label: msg("Publish report"), desc: msg("A report people can read and download"), icon: ClipboardTextIcon, tone: "ok", group: "Documents" },
  { key: "spreadsheet", type: "step", action: "spreadsheet", label: msg("Spreadsheet"), desc: msg("Build or update an Excel file"), icon: TableIcon, tone: "ok", group: "Documents" },
  // Web
  { key: "browse", type: "step", action: "browse", label: msg("Look up online"), desc: msg("Check a website or portal"), icon: GlobeIcon, tone: "info", group: "Web" },
  { key: "form", type: "step", action: "form", label: msg("Fill a web form"), desc: msg("A person approves before submitting"), icon: TextboxIcon, tone: "warn", group: "Web" },
  // People
  { key: "approval", type: "decision", action: "approval", label: msg("Approval"), desc: msg("A person approves or rejects"), icon: SealCheckIcon, tone: "ok", group: "People", init: { decider: "person" } },
  { key: "input", type: "input", label: msg("Ask a person"), desc: msg("Wait for information only they have"), icon: UserFocusIcon, tone: "pink", group: "People" },
  { key: "handoff", type: "handoff", label: msg("Hand off"), desc: msg("Pass the work to another department"), icon: HandshakeIcon, tone: "violet", group: "People" },
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
  if (n.type === "wait") return waitLabel(n.wait_amount ?? 1, n.wait_unit ?? "hours");
  if (n.type === "decision") return n.decider === "agent" ? t("{name} decides", { name: agentName ?? t("An agent") }) : t("A person decides");
  if (n.type === "input") return t("A person answers");
  if (n.type === "start" || n.type === "end" || n.type === "note") return "";
  return [agentName ?? (n.role || ""), n.review ? t("you review") : ""].filter(Boolean).join(" · ");
}

/** "Wait 2 days" as one sentence per unit and number, so Malay reads naturally. */
export function waitLabel(amount: number, unit: string): string {
  const one = amount === 1;
  if (unit === "minutes") return one ? t("Wait 1 minute") : t("Wait {n} minutes", { n: amount });
  if (unit === "days") return one ? t("Wait 1 day") : t("Wait {n} days", { n: amount });
  return one ? t("Wait 1 hour") : t("Wait {n} hours", { n: amount });
}

/** Tone colour as a CSS value, for edges and the minimap. */
export const TONE_VAR: Record<Tone, string> = {
  accent: "var(--accent)", ok: "var(--ok)", warn: "var(--warn)", danger: "var(--danger)", info: "var(--info)",
  neutral: "var(--text-muted)", violet: "var(--series-7)", orange: "var(--series-2)", pink: "var(--series-5)",
};

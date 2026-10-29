/** P55 "What should {name} do?": every kind of job an agent takes, grouped and in plain words,
 * so a person sees at a glance what they can ask for and where to click. Each card opens the
 * one task composer ready to go (the kind of work picked, a brief to fill in), or the chat,
 * or the workflow builder. Used on the office floor's agent sheet and in My AI workers. */
import {
  ArrowsClockwiseIcon, BrowserIcon, CalculatorIcon, ChatsCircleIcon, CheckSquareOffsetIcon, EnvelopeSimpleIcon,
  FilePdfIcon, FileTextIcon, FlowArrowIcon, FolderOpenIcon, GlobeIcon, ListChecksIcon, PencilSimpleLineIcon,
  ReceiptIcon, TreeStructureIcon, type Icon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { chatRoute } from "@/components/chat/links";
import { openTaskComposer, type ComposerPrefill } from "@/components/task-composer/store";
import { msg, t as tr, useT } from "@/i18n";
import { cn } from "@/lib/utils";

interface Job {
  key: string;
  icon: Icon;
  label: string;
  body: string;
  /** Opens the composer with this. */
  prefill?: () => ComposerPrefill;
  /** Or goes to a page. */
  to?: "chat" | "workflows";
}

interface Group {
  label: string;
  jobs: Job[];
}

const brief = (text: string) => () => ({ kind: "general" as const, brief: tr(text) });

export const JOB_GROUPS: Group[] = [
  {
    label: msg("Talk"),
    jobs: [
      { key: "chat", icon: ChatsCircleIcon, label: msg("Ask a question"), body: msg("A quick answer or advice, in a chat."), to: "chat" },
    ],
  },
  {
    label: msg("Paperwork"),
    jobs: [
      { key: "letter", icon: EnvelopeSimpleIcon, label: msg("Write a letter"), body: msg("On the letterhead, ready for your review."),
        prefill: brief("Write a letter to … about …. Use our letter template and company details. Key points: …") },
      { key: "file", icon: FolderOpenIcon, label: msg("File documents"), body: msg("Sorted into the right folders, with a list of what moved."),
        prefill: brief("File these documents into the right folders, the way we already keep them: …") },
      { key: "compile", icon: FilePdfIcon, label: msg("Compile into one PDF"), body: msg("Several files in one document with a contents page."),
        prefill: brief("Compile these into one PDF, in this order, titled …: …") },
      { key: "summarise", icon: FileTextIcon, label: msg("Summarise a file"), body: msg("Key points, numbers, dates and what needs action."),
        prefill: () => ({ kind: "general", brief: tr("Summarise the attached file: the key points, the numbers that matter and anything I need to act on."), pickFile: true }) },
      { key: "proofread", icon: CheckSquareOffsetIcon, label: msg("Check a document"), body: msg("Spelling, names, numbers and dates, before it goes out."),
        prefill: () => ({ kind: "general", brief: tr("Proofread the attached document and list every fix: spelling, names, numbers, dates."), pickFile: true }) },
      { key: "claim", icon: ReceiptIcon, label: msg("Prepare a claim"), body: msg("Receipts checked and totalled, the form filled, all in one file."),
        prefill: brief("Prepare my expense claim for … from these receipts: check each one, total them, fill the claim form and compile it with the receipts.") },
    ],
  },
  {
    label: msg("Research and the web"),
    jobs: [
      { key: "research", icon: GlobeIcon, label: msg("Research on the web"), body: msg("A cited answer or a short report from good sources."), prefill: () => ({ kind: "research" }) },
      { key: "browse", icon: BrowserIcon, label: msg("Use a website"), body: msg("Read a site, or fill in a form for your approval."), prefill: () => ({ kind: "browse" }) },
    ],
  },
  {
    label: msg("Routine work"),
    jobs: [
      { key: "repeat", icon: ArrowsClockwiseIcon, label: msg("Do it on a schedule"), body: msg("Every day, every Monday, every month: you pick when."), prefill: () => ({ kind: "general", repeat: true }) },
      { key: "workflow", icon: FlowArrowIcon, label: msg("Follow a workflow"), body: msg("Run one of the company's step-by-step procedures."), prefill: () => ({ kind: "workflow" }) },
      { key: "new-workflow", icon: TreeStructureIcon, label: msg("Set up a new workflow"), body: msg("Describe a job once; the steps are drawn for you."), to: "workflows" },
      { key: "report", icon: ListChecksIcon, label: msg("Weekly status report"), body: msg("Done, stuck and next, with the numbers."),
        prefill: brief("Write this week's status report for …: what was done, what is stuck and who can unblock it, and what is next.") },
      { key: "numbers", icon: CalculatorIcon, label: msg("Check figures"), body: msg("Totals, reconciliations or a messy spreadsheet cleaned."),
        prefill: brief("Check these figures and show the workings: …") },
      { key: "other", icon: PencilSimpleLineIcon, label: msg("Something else"), body: msg("Describe it in your own words."), prefill: () => ({ kind: "general" }) },
    ],
  },
];

export function JobPicker({ agentId, from, className, onPicked }: {
  agentId: string;
  /** Where the chat's back button returns to. */
  from?: string;
  className?: string;
  /** After a card is used (e.g. to close the dialog it is in). */
  onPicked?: () => void;
}) {
  const t = useT();
  const card = "flex min-h-[4.5rem] w-full items-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/30 focus-visible:outline-2 focus-visible:outline-accent";
  const inner = (j: Job) => (
    <>
      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft/60 text-accent"><j.icon size={19} weight="duotone" /></span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[13.5px] font-semibold leading-snug">{t(j.label)}</span>
        <span className="text-[12px] leading-snug text-muted">{t(j.body)}</span>
      </span>
    </>
  );
  return (
    <div className={cn("grid gap-4", className)}>
      {JOB_GROUPS.map((g) => (
        <section key={g.label} className="grid gap-2">
          <h3 className="text-[12px] font-semibold tracking-wide text-muted uppercase">{t(g.label)}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] gap-2">
            {g.jobs.map((j) => (
              <li key={j.key} className="min-w-0">
                {j.to === "chat" ? (
                  <Link {...chatRoute(agentId, { from })} onClick={onPicked} className={card}>{inner(j)}</Link>
                ) : j.to === "workflows" ? (
                  <Link to="/workflows" search={{}} onClick={onPicked} className={card}>{inner(j)}</Link>
                ) : (
                  <button type="button" className={card}
                    onClick={() => { onPicked?.(); openTaskComposer({ ...(j.prefill?.() ?? {}), agentId }); }}>
                    {inner(j)}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The obvious ways in: "Give my AI a task" with the three quick kinds of work, for the staff
 * home, the desk and an empty chat. Each opens the one task composer, ready to go. */
import { ArrowRightIcon, BrowserIcon, FileTextIcon, GlobeIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";

import { AgentAvatar } from "@/components/agent-avatar";
import { msg, t as tr, useT } from "@/i18n";
import { cn } from "@/lib/utils";

import type { ComposerPrefill } from "./store";
import { openTaskComposer } from "./store";

interface QuickKind {
  key: string;
  icon: typeof GlobeIcon;
  label: string;
  body: string;
  prefill: () => ComposerPrefill;
}

export const QUICK_KINDS: QuickKind[] = [
  { key: "research", icon: GlobeIcon, label: msg("Research something on the web"), body: msg("A cited answer or a report from good sources."), prefill: () => ({ kind: "research" }) },
  { key: "browse", icon: BrowserIcon, label: msg("Browse a website for me"), body: msg("Read a site, or fill in a form for your approval."), prefill: () => ({ kind: "browse" }) },
  {
    key: "file", icon: FileTextIcon, label: msg("Summarise a file"), body: msg("The key points, numbers and what needs action."),
    prefill: () => ({ kind: "general", brief: tr("Summarise the attached file: the key points, the numbers that matter and anything I need to act on."), pickFile: true }),
  },
];

/** Small chips (an empty chat): each opens the composer with that kind of work picked. */
export function QuickKindChips({ agentId, onCreated, className }: { agentId: string; onCreated?: ComposerPrefill["onCreated"]; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex flex-wrap justify-center gap-2", className)}>
      {QUICK_KINDS.map((k) => (
        <button key={k.key} type="button" onClick={() => openTaskComposer({ ...k.prefill(), agentId, onCreated })}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft/40 px-3.5 text-[12.5px] font-medium text-accent transition-colors hover:bg-accent-soft">
          <k.icon size={15} weight="duotone" /> {t(k.label)}
        </button>
      ))}
    </div>
  );
}

/** A prominent "Give my AI a task" entry: a big ask box and the three quick kinds as cards. */
export function GiveTaskPanel({ agent, title, guide, className }: {
  agent: { id: string; name: string; color: string; current_task?: { status?: string; title: string } | null };
  title?: string;
  guide?: string;
  className?: string;
}) {
  const t = useT();
  const working = !!agent.current_task && (agent.current_task.status ?? "running") === "running";
  return (
    <section data-guide={guide} className={cn("overflow-hidden rounded-[var(--radius-lg)] border border-accent/25 bg-surface shadow-[var(--shadow-soft)]", className)}>
      <div className="grid gap-3 bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_65%)] p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <AgentAvatar name={agent.name} color={agent.color} size="md" working={working} />
          <div className="min-w-0">
            <h2 className="text-[16px] leading-snug font-semibold">{title ?? t("Give {name} a task", { name: agent.name })}</h2>
            <p className="truncate text-[12.5px] text-muted">
              {working && agent.current_task ? t("Working on {title}", { title: agent.current_task.title }) : t("Say what you need. It works on it and asks you before anything risky.")}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => openTaskComposer({ agentId: agent.id })}
          className="group flex min-h-12 w-full min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-bg px-4 text-left text-[14.5px] text-muted transition-colors hover:border-accent/50">
          <PencilSimpleLineIcon size={18} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 truncate">{t("What do you need?")}</span>
          <ArrowRightIcon size={15} className="shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
        </button>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {QUICK_KINDS.map((k) => (
            <button key={k.key} type="button" onClick={() => openTaskComposer({ ...k.prefill(), agentId: agent.id })}
              className="flex min-h-14 min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-surface-2/50">
              <k.icon size={19} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">{t(k.label)}</span>
                <span className="block text-[11.5px] text-muted">{t(k.body)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

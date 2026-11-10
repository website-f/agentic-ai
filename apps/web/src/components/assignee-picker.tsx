/**
 * P97: pick who a task is for: a person (myself, the people I manage) or an AI agent, in one
 * searchable list. A panel under the button on desktop, a bottom sheet on phones (the shared
 * PickerPanel). Arrow keys move between the choices; Enter picks.
 */
import { CaretDownIcon, CheckIcon, RobotIcon, TrayIcon, UserIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type KeyboardEvent } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { PersonAvatar } from "@/components/person-avatar";
import { PICKER_TRIGGER, PickerPanel } from "@/components/ui/date-picker";
import { useT } from "@/i18n";
import { teamPeopleQuery, type AssigneeRef, type TeamPerson } from "@/lib/people";
import { cn } from "@/lib/utils";
import { agentsQuery, type Agent } from "@/lib/work";

/** "" = nobody yet. */
export type AssigneeValue = AssigneeRef | "";

/** The agents a person may give work to (not the ones they only watch). */
export const workableAgents = (agents: Agent[]) => agents.filter((a) => !a.view_only && a.status !== "retired");

interface Choice {
  value: AssigneeValue;
  name: string;
  line: string;
  kind: "person" | "agent" | "none";
  person?: TeamPerson;
  agent?: Agent;
}

export function useAssigneeChoices(): { people: TeamPerson[]; agents: Agent[]; loading: boolean } {
  const people = useQuery(teamPeopleQuery);
  const agents = useQuery(agentsQuery);
  return { people: people.data ?? [], agents: workableAgents(agents.data ?? []), loading: people.isLoading || agents.isLoading };
}

export function AssigneePicker({ value, onChange, label, allowNobody = true, compact, className, placeholder }: {
  value: AssigneeValue;
  /** What the button says while nobody is picked (default "Assign"). */
  placeholder?: string;
  onChange: (v: AssigneeValue) => void;
  label: string;
  allowNobody?: boolean;
  /** A small chip-like button (quick add) instead of a full-width field. */
  compact?: boolean;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const { people, agents } = useAssigneeChoices();
  const choices = useMemo<Choice[]>(() => {
    const out: Choice[] = people.map((p) => ({
      value: `user:${p.user_id}`,
      name: p.me ? t("Me ({name})", { name: p.name }) : p.name,
      line: [p.department_name, p.branch_name].filter(Boolean).join(", ") || p.email,
      kind: "person",
      person: p,
    }));
    for (const a of agents) out.push({ value: `agent:${a.id}`, name: a.name, line: a.role, kind: "agent", agent: a });
    if (allowNobody) out.push({ value: "", name: t("Nobody yet"), line: t("It waits until someone picks it up."), kind: "none" });
    return out;
  }, [people, agents, allowNobody, t]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? choices.filter((c) => `${c.name} ${c.line}`.toLowerCase().includes(needle)) : choices;
  const current = choices.find((c) => c.value === value);
  const pick = (v: AssigneeValue) => {
    onChange(v);
    setOpen(false);
    setQ("");
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-choice]")];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[e.key === "ArrowDown" ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1)];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  const peopleShown = shown.filter((c) => c.kind === "person");
  const agentsShown = shown.filter((c) => c.kind === "agent");
  const noneShown = shown.filter((c) => c.kind === "none");
  return (
    <PickerPanel open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }} title={label} initialFocus="input"
      trigger={
        <button type="button" aria-label={t("{label}: {value}", { label, value: current?.name ?? t("Nobody yet") })}
          className={cn(compact ? "inline-flex h-9 max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 text-[12.5px] hover:bg-surface-2 pointer-coarse:h-11" : PICKER_TRIGGER, className)}>
          <Face choice={current} />
          <span className={cn("min-w-0 flex-1 truncate", !current?.value && "text-muted")}>{current?.value ? current.name : placeholder ?? t("Assign")}</span>
          <CaretDownIcon size={13} className="shrink-0 text-muted" />
        </button>
      }>
      <div className="grid min-w-0 gap-2" onKeyDown={onKey}>
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder={t("Find a person or agent")} aria-label={t("Find a person or agent")}
          className="h-10 w-full rounded-sm border border-border bg-surface px-3 text-[13.5px] placeholder:text-muted/80 focus-visible:border-accent focus-visible:outline-none pointer-coarse:h-11" />
        <div role="listbox" aria-label={label} className="grid max-h-[min(22rem,60dvh)] min-w-0 gap-0.5 overflow-y-auto overscroll-contain">
          {peopleShown.length ? <Heading icon={<UserIcon size={12} weight="bold" />} text={t("People")} /> : null}
          {peopleShown.map((c) => <Row key={c.value} choice={c} on={c.value === value} onPick={pick} />)}
          {agentsShown.length ? <Heading icon={<RobotIcon size={12} weight="bold" />} text={t("AI agents")} /> : null}
          {agentsShown.map((c) => <Row key={c.value} choice={c} on={c.value === value} onPick={pick} />)}
          {noneShown.map((c) => <Row key="none" choice={c} on={!value} onPick={pick} />)}
          {!shown.length ? <p className="px-2 py-4 text-center text-[12.5px] text-muted">{t("Nobody matches “{q}”.", { q })}</p> : null}
        </div>
      </div>
    </PickerPanel>
  );
}

function Heading({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <p className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">{icon}{text}</p>;
}

function Face({ choice }: { choice?: Choice }) {
  if (choice?.person) return <PersonAvatar name={choice.person.name} id={choice.person.user_id} size="xs" />;
  if (choice?.agent) return <AgentAvatar name={choice.agent.name} color={choice.agent.color} size="xs" />;
  return <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full border border-dashed border-border text-muted"><TrayIcon size={12} /></span>;
}

function Row({ choice, on, onPick }: { choice: Choice; on: boolean; onPick: (v: AssigneeValue) => void }) {
  const t = useT();
  return (
    <button type="button" role="option" aria-selected={on} data-choice onClick={() => onPick(choice.value)}
      className={cn("flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none", on && "bg-accent-soft/60")}>
      <Face choice={choice} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] font-medium">{choice.name}</span>
          {choice.person?.reports_to_me ? <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10.5px] font-medium text-accent">{t("Your team")}</span> : null}
        </span>
        <span className="block truncate text-[11.5px] text-muted">
          {choice.line}
          {choice.person && choice.person.open_tasks ? ` · ${choice.person.open_tasks === 1 ? t("1 open task") : t("{n} open tasks", { n: choice.person.open_tasks })}` : ""}
        </span>
      </span>
      {on ? <CheckIcon size={15} weight="bold" className="shrink-0 text-accent" /> : null}
    </button>
  );
}

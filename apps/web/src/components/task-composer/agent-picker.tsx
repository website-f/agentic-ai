/** Pick who does the work: agents as cards with their face and what they are busy with. */
import { CheckCircleIcon, MagnifyingGlassIcon, TrayIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/work";

/** Nobody yet: the task waits in triage. */
export const NOBODY = "none";
const SHOWN = 6;

/** What the agent is up to, in a few words. */
export function busyLine(a: Agent, t: (s: string, v?: Record<string, string | number>) => string): { text: string; busy: boolean } {
  if (a.status === "paused") return { text: t("Paused"), busy: true };
  if (a.current_task?.status === "running") return { text: t("Working on {title}", { title: a.current_task.title }), busy: true };
  if (a.current_task?.status === "blocked") return { text: t("Waiting on a decision"), busy: true };
  if (a.duty && !a.duty.on) return { text: a.duty.label, busy: false };
  if (a.open_tasks) return { text: a.open_tasks === 1 ? t("1 open task") : t("{n} open tasks", { n: a.open_tasks }), busy: false };
  return { text: t("Free now"), busy: false };
}

export function AgentPicker({ agents, value, onChange, allowNobody, label, twinId }: {
  /** Already filtered to the agents the person may instruct. */
  agents: Agent[];
  value: string;
  onChange: (id: string) => void;
  /** Offer "Nobody yet" (the task waits in triage). */
  allowNobody?: boolean;
  label: string;
  twinId?: string | null;
}) {
  const t = useT();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  // The agent picked on open first, then the twin, then the rest (own agents first). The order
  // stays put while you pick, and a pick from the full list stays in view when it folds.
  const [first] = useState(value);
  const ordered = [...agents].sort((a, b) => rank(a, first, twinId) - rank(b, first, twinId));
  const needle = q.trim().toLowerCase();
  const top = ordered.slice(0, SHOWN);
  const picked = ordered.find((a) => a.id === value);
  const list = all
    ? ordered.filter((a) => !needle || `${a.name} ${a.role} ${a.department_name ?? ""} ${a.branch_name}`.toLowerCase().includes(needle))
    : picked && !top.includes(picked) ? [...top, picked] : top;
  const more = agents.length - SHOWN;
  return (
    <div className="grid min-w-0 gap-2">
      {all && agents.length > SHOWN ? (
        <label className="relative block">
          <span className="sr-only">{t("Find an agent")}</span>
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find an agent")} type="search" autoFocus
            className="h-10 w-full rounded-sm border border-border bg-surface pr-3 pl-9 text-[13.5px] placeholder:text-muted/80 focus-visible:border-accent focus-visible:outline-none" />
        </label>
      ) : null}
      <div role="radiogroup" aria-label={label} className={cn("grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2", all && "max-h-72 overflow-y-auto p-0.5")}>
        {list.map((a) => {
          const on = a.id === value;
          const b = busyLine(a, t);
          return (
            <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(a.id)}
              className={cn(
                "flex min-h-14 min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors",
                on ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30" : "border-border bg-surface hover:border-accent/40 hover:bg-surface-2/50",
              )}>
              <AgentAvatar name={a.name} color={a.color} size="sm" working={a.current_task?.status === "running"} />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-medium">{a.name}</span>
                  {a.id === twinId ? <span className="shrink-0 rounded-full bg-accent-soft px-1.5 text-[10.5px] font-medium text-accent">{t("Your AI worker")}</span> : null}
                </span>
                <span className={cn("block truncate text-[12px]", b.busy ? "text-warn" : "text-muted")}>{b.text}</span>
              </span>
              {on ? <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-accent" /> : null}
            </button>
          );
        })}
        {allowNobody ? (
          <button type="button" role="radio" aria-checked={value === NOBODY} onClick={() => onChange(NOBODY)}
            className={cn(
              "flex min-h-14 min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-dashed px-3 py-2 text-left transition-colors",
              value === NOBODY ? "border-accent bg-accent-soft/50" : "border-border hover:border-accent/40 hover:bg-surface-2/50",
            )}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted"><TrayIcon size={16} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium">{t("Nobody yet")}</span>
              <span className="block truncate text-[12px] text-muted">{t("It waits in triage until someone picks it up.")}</span>
            </span>
          </button>
        ) : null}
        {all && !list.length ? <p className="col-span-full px-2 py-4 text-center text-[12.5px] text-muted">{t("No agent matches \"{q}\".", { q })}</p> : null}
      </div>
      {more > 0 ? (
        <button type="button" onClick={() => { setAll((v) => !v); setQ(""); }} className="justify-self-start text-[12.5px] font-medium text-accent hover:underline">
          {all ? t("Show fewer") : t("Show all {n} agents", { n: agents.length })}
        </button>
      ) : null}
    </div>
  );
}

function rank(a: Agent, picked: string, twinId?: string | null): number {
  if (a.id === picked) return 0;
  if (twinId && a.id === twinId) return 1;
  return a.private ? 2 : a.owner_user_id ? 3 : 4;
}

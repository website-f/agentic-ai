import { CheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RadioGroup } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ActionBar } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { SwitchField } from "@/components/ui/switch";
import { locale, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { agentBudgetQuery, teamKeys, tokensShort, type AgentBudget } from "@/lib/teams";
import { cn } from "@/lib/utils";
import { workKeys, type Agent } from "@/lib/work";

function Meter({ label, used, limit, ratio, tokens }: { label: string; used: string; limit: string | null; ratio: number; tokens?: boolean }) {
  const t = useT();
  const pct = Math.round(ratio * 100);
  const tone = ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warn" : "bg-accent";
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-medium">{label}</span>
        <span className="text-muted tabular">{limit
          ? (tokens ? t("{used} of {limit} tokens ({pct}%)", { used, limit, pct }) : t("{used} of {limit} ({pct}%)", { used, limit, pct }))
          : (tokens ? t("{used} tokens, no limit", { used }) : t("{used}, no limit", { used }))}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={limit ? pct : 0}>
        {limit ? <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${Math.min(100, pct)}%` }} /> : null}
      </div>
    </div>
  );
}

/** Tokens per day, last 14 days: one series, thin bars, a tooltip per bar. */
function Daily({ b }: { b: AgentBudget }) {
  const t = useT();
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(`${b.day}T00:00:00`);
    d.setDate(d.getDate() - (13 - i));
    const key = d.toLocaleDateString("en-CA");
    return { key, label: d.toLocaleDateString(locale(), { day: "numeric", month: "short" }), tokens: b.by_day.find((x) => x.day === key)?.tokens ?? 0 };
  });
  const max = Math.max(b.token_limit ?? 0, ...days.map((d) => d.tokens), 1);
  const limitAt = b.token_limit ? 100 - (b.token_limit / max) * 100 : null;
  return (
    <figure className="grid gap-2">
      <figcaption className="text-[13px] font-medium">{t("Tokens per day, last 14 days")}</figcaption>
      <div className="relative flex h-28 items-end gap-1 border-b border-border">
        {limitAt !== null ? (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-danger/60" style={{ top: `${limitAt}%` }}>
            <span className="absolute -top-4 left-0 text-[10.5px] text-danger">{t("daily limit")}</span>
          </div>
        ) : null}
        {days.map((d) => (
          <div key={d.key} className="group relative flex h-full flex-1 items-end">
            <div className={cn("w-full rounded-t-[3px]", d.tokens > (b.token_limit ?? Infinity) ? "bg-danger" : "bg-accent")} style={{ height: `${(d.tokens / max) * 100}%`, minHeight: d.tokens ? 2 : 0 }} />
            <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-sm bg-fg px-2 py-1 text-[11px] whitespace-nowrap text-bg group-hover:block">
              {t("{day}: {n} tokens", { day: d.label, n: d.tokens.toLocaleString(locale()) })}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-muted"><span>{days[0]?.label}</span><span>{t("Today")}</span></div>
      <table className="sr-only">
        <caption>{t("Tokens per day")}</caption>
        <tbody>{days.map((d) => <tr key={d.key}><th>{d.label}</th><td>{d.tokens}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export function TeamTab({ agent, canManage }: { agent: Agent; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  // Spend is the owner's business: a watched colleague's agent shows its settings, not its usage.
  const { data: budget } = useQuery({ ...agentBudgetQuery(agent.id), enabled: !agent.view_only });
  const initial = {
    role_kind: agent.role_kind,
    max_parallel_children: String(agent.max_parallel_children),
    max_spawn_depth: String(agent.max_spawn_depth),
    heartbeat: agent.heartbeat,
    budget_daily_tokens: agent.budget_daily_tokens ? String(agent.budget_daily_tokens) : "",
    budget_monthly_usd: agent.budget_monthly_usd ? String(agent.budget_monthly_usd) : "",
  };
  const [d, setD] = useState(initial);
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  const save = useMutation({
    mutationFn: () =>
      api<Agent>(`/api/agents/${agent.id}`, "PATCH", {
        role_kind: d.role_kind,
        max_parallel_children: Number(d.max_parallel_children),
        max_spawn_depth: Number(d.max_spawn_depth),
        heartbeat: d.heartbeat,
        budget_daily_tokens: d.budget_daily_tokens ? Number(d.budget_daily_tokens) : null,
        budget_monthly_usd: d.budget_monthly_usd ? Number(d.budget_monthly_usd) : null,
      }),
    onSuccess: (a) => {
      qc.setQueryData(workKeys.agent(a.id), a);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: teamKeys.agentBudget(a.id) });
      toast.success(tr("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-8">
      <section className="grid gap-3">
        <h2 className="text-[14px] font-semibold">{t("Role in the team")}</h2>
        <RadioGroup.Root value={d.role_kind} disabled={!canManage} onValueChange={(v) => setD({ ...d, role_kind: v as Agent["role_kind"] })} aria-label={t("Role in the team")} className="grid gap-2 sm:grid-cols-2">
          {([
            ["leaf", t("Does the work"), t("Works on its own tasks. Can still call a meeting.")],
            ["orchestrator", t("Leads"), t("Can split a task, hand the parts to other agents in parallel, and merge their answers.")],
          ] as const).map(([v, title, body]) => (
            <RadioGroup.Item key={v} value={v} className="grid gap-0.5 rounded-[var(--radius-md)] border border-border p-3 text-left data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/50 disabled:opacity-60">
              <span className="text-[13.5px] font-medium">{title}</span>
              <span className="text-[12.5px] text-muted">{body}</span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        {d.role_kind === "orchestrator" ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Tasks handed out at once")} type="number" min={1} max={10} value={d.max_parallel_children} disabled={!canManage}
              onChange={(e) => setD({ ...d, max_parallel_children: e.target.value })} hint={t("1 to 10.")} />
            <Field label={t("Levels below it")} type="number" min={1} max={3} value={d.max_spawn_depth} disabled={!canManage}
              onChange={(e) => setD({ ...d, max_spawn_depth: e.target.value })} hint={t("How deep a chain of hand-offs may go: 1 to 3.")} />
          </div>
        ) : null}
      </section>

      <section className="grid gap-3">
        <h2 className="text-[14px] font-semibold">{t("Heartbeat")}</h2>
        <SwitchField checked={d.heartbeat} disabled={!canManage} onCheckedChange={(v) => setD({ ...d, heartbeat: v })} label={t("Check in every hour during work hours")}
          hint={t("Starts its oldest queued task, or, once a day, asks you for work when its queue is empty.")} />
      </section>

      <section className="grid gap-4">
        <div>
          <h2 className="text-[14px] font-semibold">{t("Budget")}</h2>
          <p className="text-[12.5px] text-muted">{t("You get an alert at 80 %. At 100 % the agent pauses and asks; approving allows half the limit again.")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("Tokens per day")} type="number" min={1000} step={1000} placeholder={t("No limit")} value={d.budget_daily_tokens} disabled={!canManage}
            onChange={(e) => setD({ ...d, budget_daily_tokens: e.target.value })} />
          <Field label={t("US dollars per month")} type="number" min={0.01} step={0.5} placeholder={t("No limit")} value={d.budget_monthly_usd} disabled={!canManage}
            onChange={(e) => setD({ ...d, budget_monthly_usd: e.target.value })} hint={t("Counts paid models only; free tiers cost 0.")} />
        </div>
        {budget ? (
          <div className="grid gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <Meter label={t("Today")} used={tokensShort(budget.tokens_today)} limit={budget.token_limit ? tokensShort(budget.token_limit) : null} ratio={budget.token_ratio} tokens />
            {agent.budget_daily_tokens && budget.token_limit && budget.token_limit > agent.budget_daily_tokens ? (
              <p className="-mt-2 text-[12px] text-muted">{t("Includes {n} extra approved for today.", { n: tokensShort(budget.token_limit - agent.budget_daily_tokens) })}</p>
            ) : null}
            <Meter label={t("This month")} used={`$${budget.usd_month.toFixed(2)}`} limit={budget.usd_limit !== null ? `$${budget.usd_limit.toFixed(2)}` : null} ratio={budget.usd_ratio} />
            <Daily b={budget} />
          </div>
        ) : null}
      </section>

      {canManage ? (
        <ActionBar className="justify-start">
          <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            <CheckIcon size={15} weight="bold" /> {t("Save")}
          </Button>
        </ActionBar>
      ) : null}
    </div>
  );
}

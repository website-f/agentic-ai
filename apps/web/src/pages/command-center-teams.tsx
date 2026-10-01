import { CoinsIcon, HandWavingIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api";
import { budgetsQuery, pingsQuery, teamKeys, tokensShort, type BudgetRow } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";

/** Agents asking for something outside a task: work to do, or a budget running low. */
export function PingsCard({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const { data: pings = [] } = useQuery(pingsQuery);
  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/api/pings/${id}/resolve`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKeys.pings }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!pings.length) return null;
  return (
    <Section title="Agents asking" description="Heartbeat check-ins and budget warnings.">
      <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
        {pings.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <AgentAvatar name={p.agent_name} color={p.agent_color} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px]">
                <span className="font-medium">{p.agent_name}</span>{" "}
                <span className="text-muted">{p.kind === "idle" ? <HandWavingIcon size={14} className="inline" /> : <CoinsIcon size={14} className="inline" />}</span>{" "}
                {p.message}
              </p>
              <p className="text-[12px] text-muted">{timeAgo(p.created_at)}</p>
            </div>
            {canWrite ? (
              <div className="flex gap-2">
                {p.kind === "idle" ? (
                  <Button size="sm" asChild><Link to="/tasks" search={{ new: 1, agent: p.agent_id }}><PlusIcon size={14} weight="bold" /> Give a task</Link></Button>
                ) : (
                  <Button size="sm" variant="outline" asChild><Link to="/agents/$agentId" params={{ agentId: p.agent_id }} search={{ tab: "team" }}>See budget</Link></Button>
                )}
                <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(p.id)}>Dismiss</Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Row({ b }: { b: BudgetRow }) {
  const daily = b.token_limit !== null && (b.token_ratio >= b.usd_ratio || b.usd_limit === null);
  const ratio = daily ? b.token_ratio : b.usd_ratio;
  const pct = Math.round(ratio * 100);
  return (
    <li>
      <Link to="/agents/$agentId" params={{ agentId: b.agent_id }} search={{ tab: "team" }} className="grid gap-1.5 px-4 py-2.5 hover:bg-surface-2/60">
        <span className="flex items-center gap-2 text-[13px]">
          <AgentAvatar name={b.name} color={b.color} size="xs" />
          <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
          <span className={cn("tabular", ratio >= 1 ? "text-danger" : ratio >= 0.8 ? "text-warn" : "text-muted")}>
            {daily ? `${tokensShort(b.tokens_today)} / ${tokensShort(b.token_limit)} today` : `$${b.usd_month.toFixed(2)} / $${(b.usd_limit ?? 0).toFixed(2)} this month`}
            {ratio >= 1 ? " · paused" : ""}
          </span>
        </span>
        <span className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span className={cn("block h-full rounded-full", ratio >= 1 ? "bg-danger" : ratio >= 0.8 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, pct)}%` }} />
        </span>
      </Link>
    </li>
  );
}

/** Spend against budget, fullest first. Agents without a limit show today's tokens only. */
export function BudgetsCard() {
  const { data = [] } = useQuery(budgetsQuery);
  const limited = data.filter((b) => b.token_limit !== null || b.usd_limit !== null).sort((x, y) => Math.max(y.token_ratio, y.usd_ratio) - Math.max(x.token_ratio, x.usd_ratio));
  const free = data.filter((b) => b.token_limit === null && b.usd_limit === null && b.tokens_today > 0).sort((x, y) => y.tokens_today - x.tokens_today);
  if (!data.length) return null;
  return (
    <Section title="Spend vs budget" description="Alert at 80 %, pause and ask at 100 %.">
      {limited.length ? (
        <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">{limited.map((b) => <Row key={b.agent_id} b={b} />)}</ul>
      ) : (
        <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-4 text-[13px] text-muted">
          No agent has a budget yet. Set one on an agent's Team & budget tab.
        </p>
      )}
      {free.length ? (
        <p className="text-[12.5px] text-muted">
          No limit: {free.slice(0, 4).map((b) => `${b.name} ${tokensShort(b.tokens_today)}`).join(", ")} tokens today.
        </p>
      ) : null}
    </Section>
  );
}

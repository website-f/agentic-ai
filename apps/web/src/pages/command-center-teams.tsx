import { BellRingingIcon, CoinsIcon, HandWavingIcon, PlusIcon, WalletIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { IconTile } from "@/components/page";
import { openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { budgetsQuery, pingsQuery, teamKeys, tokensShort, type BudgetRow } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";

/** Agents asking for something outside a task: work to do, or a budget running low. */
export function PingsCard({ canWrite }: { canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: pings = [] } = useQuery(pingsQuery);
  const dismiss = useMutation({
    mutationFn: (id: string) => api(`/api/pings/${id}/resolve`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: teamKeys.pings }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!pings.length) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<IconTile icon={BellRingingIcon} tone="warn" size="sm" />}
        title={t("Agents asking")}
        description={t("Heartbeat check-ins and budget warnings.")}
        actions={<Pill tone="warn">{pings.length}</Pill>}
      />
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
        {pings.map((p) => (
          <li key={p.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
            <AgentAvatar name={p.agent_name} color={p.agent_color} size="sm" />
            <div className="min-w-0 flex-1 basis-52">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px]">
                <span className="font-medium">{p.agent_name}</span>
                <Pill tone={p.kind === "idle" ? "info" : "warn"}>
                  {p.kind === "idle" ? <HandWavingIcon size={12} weight="bold" /> : <CoinsIcon size={12} weight="bold" />}
                  {p.kind === "idle" ? t("Wants work") : t("Budget")}
                </Pill>
              </p>
              <p className="mt-0.5 text-[13px] break-words">{p.message}</p>
              <p className="text-[12px] text-muted">{timeAgo(p.created_at)}</p>
            </div>
            {canWrite ? (
              <div className="ml-11 flex flex-wrap gap-2 sm:ml-0">
                {p.kind === "idle" ? (
                  <Button size="sm" onClick={() => openTaskComposer({ agentId: p.agent_id })}><PlusIcon size={14} weight="bold" /> {t("Give a task")}</Button>
                ) : (
                  <Button size="sm" variant="outline" asChild><Link to="/agents/$agentId" params={{ agentId: p.agent_id }} search={{ tab: "team" }}>{t("See budget")}</Link></Button>
                )}
                <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(p.id)}>{t("Dismiss")}</Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Row({ b }: { b: BudgetRow }) {
  const t = useT();
  const daily = b.token_limit !== null && (b.token_ratio >= b.usd_ratio || b.usd_limit === null);
  const ratio = daily ? b.token_ratio : b.usd_ratio;
  const pct = Math.round(ratio * 100);
  return (
    <li>
      <Link to="/agents/$agentId" params={{ agentId: b.agent_id }} search={{ tab: "team" }} className="grid gap-1.5 px-4 py-3 hover:bg-surface-2/60 sm:px-5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <AgentAvatar name={b.name} color={b.color} size="xs" />
          <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
          <span className="text-muted tabular">
            {daily ? t("{used} / {limit} today", { used: tokensShort(b.tokens_today), limit: tokensShort(b.token_limit) }) : t("${used} / ${limit} this month", { used: b.usd_month.toFixed(2), limit: (b.usd_limit ?? 0).toFixed(2) })}
          </span>
          {ratio >= 1 ? <Pill tone="danger">{t("Paused")}</Pill> : ratio >= 0.8 ? <Pill tone="warn">{pct}%</Pill> : null}
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
  const t = useT();
  const { data = [] } = useQuery(budgetsQuery);
  const limited = data.filter((b) => b.token_limit !== null || b.usd_limit !== null).sort((x, y) => Math.max(y.token_ratio, y.usd_ratio) - Math.max(x.token_ratio, x.usd_ratio));
  const free = data.filter((b) => b.token_limit === null && b.usd_limit === null && b.tokens_today > 0).sort((x, y) => y.tokens_today - x.tokens_today);
  if (!data.length) return null;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        icon={<IconTile icon={WalletIcon} tone="orange" size="sm" />}
        title={t("Spend vs budget")}
        description={t("Alert at 80 %, pause and ask at 100 %.")}
      />
      {limited.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">{limited.map((b) => <Row key={b.agent_id} b={b} />)}</ul>
      ) : (
        <p className="mx-4 mt-4 rounded-sm border border-dashed border-border px-4 py-3 text-[13px] text-muted sm:mx-5">
          {t("No agent has a budget yet. Set one on an agent's Team & budget tab.")}
        </p>
      )}
      {free.length ? (
        <div className="grid gap-2 px-4 py-3.5 sm:px-5">
          <p className="text-[12px] font-medium text-muted">{t("No limit, tokens used today")}</p>
          <ul className="flex flex-wrap gap-2">
            {free.slice(0, 4).map((b) => (
              <li key={b.agent_id}>
                <Link
                  to="/agents/$agentId"
                  params={{ agentId: b.agent_id }}
                  search={{ tab: "team" }}
                  className="inline-flex h-9 items-center gap-2 rounded-full border border-border bg-surface pr-3 pl-1.5 text-[12.5px] hover:border-accent/40 hover:bg-surface-2/60"
                >
                  <AgentAvatar name={b.name} color={b.color} size="xs" />
                  <span className="font-medium">{b.name}</span>
                  <span className="text-muted tabular">{tokensShort(b.tokens_today)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : limited.length ? null : <div className="h-4" />}
    </Card>
  );
}

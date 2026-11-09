import { TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { tokens } from "@/lib/allowance";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

/** P96: what an agent learned to do without the AI engine (api/routers/procedures.py). */
export interface AgentSavings {
  agent_id: string;
  agent_name: string;
  replay: boolean;
  office_on: boolean;
  can_manage: boolean;
  procedures: number;
  active: number;
  replays: number;
  tokens_saved: number;
  answers_reused: number;
  answer_tokens_saved: number;
}

export interface Procedure {
  id: string;
  name: string;
  description: string;
  status: "candidate" | "active" | "paused" | "retired";
  steps: number;
  tools: string[];
  browser: boolean;
  own: boolean;
  learned_here: boolean;
  uses: number;
  successes: number;
  failures: number;
  tokens_saved: number;
  last_used_at: string | null;
  note: string | null;
  can_forget: boolean;
}

export const procedureKeys = {
  summary: ["procedures", "summary"] as const,
  agent: (id: string) => ["procedures", "agent", id] as const,
};

/** One row per agent the person sees: for the AI use page's tables. */
export const procedureSummaryQuery = {
  queryKey: procedureKeys.summary,
  queryFn: () => api<AgentSavings[]>("/api/procedures/summary"),
};

const agentQuery = (id: string) => ({
  queryKey: procedureKeys.agent(id),
  queryFn: () => api<AgentSavings & { items: Procedure[] }>(`/api/procedures/agents/${id}`),
});

const STATUS: Record<Procedure["status"], { label: string; tone: "ok" | "info" | "warn" | "neutral" }> = {
  active: { label: msg("Runs by itself"), tone: "ok" },
  candidate: { label: msg("Learning"), tone: "info" },
  paused: { label: msg("Paused"), tone: "warn" },
  retired: { label: msg("Retired"), tone: "neutral" },
};

/** The tokens a learned procedure or a reused answer did not spend, in one line. */
export function savedLine(t: ReturnType<typeof useT>, s: AgentSavings): string {
  return t("{jobs} jobs done from memory, {answers} answers reused: {n} tokens saved", {
    jobs: s.replays,
    answers: s.answers_reused,
    n: tokens(s.tokens_saved + s.answer_tokens_saved),
  });
}

/** The switch, so the same control works on the agent page and in the AI use table. */
export function useReplaySwitch(agentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (replay: boolean) => api(`/api/procedures/agents/${agentId}`, "PUT", { replay }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["procedures"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
}

function Row({ p, agentId }: { p: Procedure; agentId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [ask, setAsk] = useState(false);
  const forget = useMutation({
    mutationFn: () => api(`/api/procedures/${p.id}?agent_id=${encodeURIComponent(agentId)}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["procedures"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = STATUS[p.status];
  return (
    <li className="grid min-w-0 gap-1 px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 basis-40 text-[13px] font-medium break-words">{p.name}</p>
        <Pill tone={s.tone} className="shrink-0">{t(s.label)}</Pill>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <span>{p.steps === 1 ? t("1 step") : t("{n} steps", { n: p.steps })}</span>
        {p.browser ? <span>· {t("in the browser")}</span> : null}
        <span>· {p.own ? t("its own, for one person") : p.learned_here ? t("shared with its company") : t("learned by a colleague")}</span>
        <span>· {t("{n} runs", { n: p.uses })}</span>
        {p.tokens_saved ? <span>· {t("{n} tokens saved", { n: tokens(p.tokens_saved) })}</span> : null}
        {p.last_used_at ? <span>· {timeAgo(p.last_used_at)}</span> : null}
      </div>
      {p.note ? <p className="text-[12.5px] break-words text-warn">{p.note}</p> : null}
      {p.can_forget ? (
        <div>
          <Button size="sm" variant="ghost" disabled={forget.isPending} onClick={() => setAsk(true)}>
            <TrashIcon size={14} /> {t("Forget")}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog open={ask} onOpenChange={setAsk} title={t("Forget {name}?", { name: p.name })}
        body={t("Agents will do this job with the AI again, and may learn it again.")} confirmLabel={t("Forget")} danger
        onConfirm={() => forget.mutate()} />
    </li>
  );
}

/** The agent page (Memory tab): what it learned, the tokens that saved, and the switch. */
export function LearnedProcedures({ agentId, name }: { agentId: string; name: string }) {
  const t = useT();
  const q = useQuery(agentQuery(agentId));
  const toggle = useReplaySwitch(agentId);
  const d = q.data;
  return (
    <section className="grid min-w-0 content-start gap-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold">{t("What {name} does from memory", { name })} <span className="font-normal text-muted">{d?.procedures ?? ""}</span></h2>
        <p className="text-[13px] text-muted">{t("Jobs it has done well before run again step by step without the AI, and the same first question gets the same answer. Anything new or different still goes to the AI, and sending or uploading always waits for a person.")}</p>
      </div>
      {q.isLoading ? <Skeleton className="h-20 rounded-[var(--radius-md)]" /> : q.error ? (
        <p role="alert" className="text-danger">{errorMessage(q.error)}</p>
      ) : d ? (
        <>
          <p className="text-[13px]">{savedLine(t, d)}</p>
          {d.can_manage ? (
            <SwitchField checked={d.replay} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)}
              label={t("Reuse what it learned")}
              hint={d.office_on ? t("Off: it always works with the AI. It keeps learning.") : t("Switched off for the whole office in Skills > Routines.")} />
          ) : null}
          {d.items.length ? (
            <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
              {d.items.slice(0, 30).map((p) => <Row key={p.id} p={p} agentId={agentId} />)}
            </ul>
          ) : (
            <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-[13px] text-muted">
              {t("Nothing yet. When {name} does the same kind of job twice the same way and people accept it, the steps show here.", { name })}
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

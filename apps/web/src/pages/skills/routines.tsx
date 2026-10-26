import { ArrowsClockwiseIcon, CheckCircleIcon, CoinsIcon, PauseIcon, PlayIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, Meta } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { tokens } from "@/lib/allowance";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";

/** P36: jobs the office learned to repeat without the paid model (api/routers/routines.py). */
export interface Routine {
  id: string;
  name: string;
  description: string;
  example: string;
  status: "candidate" | "active" | "paused" | "retired";
  slots: { name: string; description?: string; example?: string }[];
  steps: { tool: string; args: Record<string, unknown> }[];
  answer: { mode?: "template" | "compose"; text?: string };
  tools: string[];
  agent_name: string | null;
  confirmations: number;
  needed: number;
  uses: number;
  successes: number;
  failures: number;
  tokens_saved: number;
  baseline_tokens: number | null;
  last_used_at: string | null;
  note: string | null;
}

interface Summary {
  enabled: boolean;
  active: number;
  candidates: number;
  paused: number;
  uses: number;
  successes: number;
  tokens_saved: number;
}

const routineKeys = { list: ["routines"] as const, summary: ["routines", "summary"] as const };

const STATUS: Record<Routine["status"], { label: string; tone: "ok" | "info" | "warn" | "neutral" }> = {
  active: { label: msg("Runs by itself"), tone: "ok" },
  candidate: { label: msg("Learning"), tone: "info" },
  paused: { label: msg("Paused"), tone: "warn" },
  retired: { label: msg("Retired"), tone: "neutral" },
};

function RoutineRow({ r, canManage }: { r: Routine; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [forget, setForget] = useState(false);
  const act = useMutation({
    mutationFn: (action: "trust" | "pause" | "resume" | "retire") => api<Routine>(`/api/routines/${r.id}/${action}`, "POST", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routineKeys.list });
      toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/routines/${r.id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: routineKeys.list }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const s = STATUS[r.status];
  return (
    <li className="grid min-w-0 gap-2 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 text-left" aria-expanded={open}>
          <span className="block text-[14px] font-semibold break-words hover:text-accent">{r.name}</span>
          {r.description ? <span className="block text-[12.5px] break-words text-muted">{r.description}</span> : null}
        </button>
        <Pill tone={s.tone} className="shrink-0">{t(s.label)}</Pill>
      </div>
      <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[12px] text-muted"><Meta items={[
        r.agent_name ? t("Learned by {name}", { name: r.agent_name }) : null,
        r.status === "candidate" ? t("Seen done this way {n} of {needed} times", { n: r.confirmations, needed: r.needed }) : t("{n} runs", { n: r.uses }),
        r.successes || r.failures ? t("{ok} accepted, {bad} sent back or failed", { ok: r.successes, bad: r.failures }) : null,
        r.tokens_saved ? t("{n} tokens saved", { n: tokens(r.tokens_saved) }) : null,
        r.last_used_at ? t("last used {when}", { when: timeAgo(r.last_used_at).toLowerCase() }) : null,
      ]} /></div>
      {r.note ? <p className="text-[12.5px] text-warn">{r.note}</p> : null}
      {open ? (
        <div className="grid gap-2 rounded-sm border border-border bg-surface-2/40 p-3 text-[12.5px]">
          {r.example ? <p className="break-words"><span className="font-medium">{t("Learned from:")}</span> {r.example.slice(0, 300)}</p> : null}
          {r.slots.length ? (
            <p className="break-words"><span className="font-medium">{t("Changes each time:")}</span> {r.slots.map((x) => x.description || x.name).join(", ")}</p>
          ) : <p>{t("Exactly the same every time.")}</p>}
          <ol className="grid list-decimal gap-1 pl-5">
            {r.steps.map((st, i) => (
              <li key={i} className="font-mono text-[12px] break-all">{st.tool}({JSON.stringify(st.args).slice(0, 160)})</li>
            ))}
          </ol>
          <p className="break-words">
            <span className="font-medium">{t("The answer:")}</span>{" "}
            {r.answer.mode === "template" ? t("a fixed reply, no AI needed") : t("written by the cheapest AI from the results: {how}", { how: r.answer.text ?? "" })}
          </p>
        </div>
      ) : null}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {r.status === "candidate" || r.status === "paused" ? (
            <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate(r.status === "paused" ? "resume" : "trust")}>
              {r.status === "paused" ? <PlayIcon size={14} /> : <CheckCircleIcon size={14} />} {r.status === "paused" ? t("Resume") : t("Trust it now")}
            </Button>
          ) : null}
          {r.status === "active" || r.status === "candidate" ? (
            <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate("pause")}><PauseIcon size={14} /> {t("Pause")}</Button>
          ) : null}
          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => setForget(true)}><TrashIcon size={14} /> {t("Forget")}</Button>
        </div>
      ) : null}
      <ConfirmDialog open={forget} onOpenChange={setForget} title={t("Forget {name}?", { name: r.name })}
        body={t("Agents will do this job with the AI again, and may learn it again.")} confirmLabel={t("Forget")} danger
        onConfirm={() => remove.mutate()} />
    </li>
  );
}

export function RoutinesPanel() {
  const t = useT();
  const qc = useQueryClient();
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = ["brain.manage", "agents.manage", "team.manage"].some((p) => me.permissions.includes(p));
  const canSwitch = me.permissions.includes("members.manage");
  const list = useQuery({ queryKey: routineKeys.list, queryFn: () => api<Routine[]>("/api/routines") });
  const summary = useQuery({ queryKey: routineKeys.summary, queryFn: () => api<Summary>("/api/routines/summary") });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api("/api/routines/settings", "PUT", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: routineKeys.summary }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const sm = summary.data;
  return (
    <>
      <p className="text-[13px] text-muted">
        {t("When an agent does the same kind of job twice the same way and people accept it, the office keeps the steps. Next time the steps run by themselves and only the final write-up (if any) goes to the cheapest AI. Every step still asks for approval where it must, and anything unexpected hands the job back to the agent.")}
      </p>
      {sm ? (
        <StatGrid>
          <Stat label={t("Run by themselves")} value={sm.active} icon={ArrowsClockwiseIcon} tone="ok" />
          <Stat label={t("Being learned")} value={sm.candidates} icon={CheckCircleIcon} tone="info" hint={t("Waiting for a second accepted job")} />
          <Stat label={t("Jobs done this way")} value={sm.uses} icon={PlayIcon} tone="accent" />
          <Stat label={t("Tokens saved")} value={tokens(sm.tokens_saved)} icon={CoinsIcon} tone="ok" hint={t("Against the first time each job was done")} />
        </StatGrid>
      ) : null}
      {sm && canSwitch ? (
        <SwitchField checked={sm.enabled} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)}
          label={t("Let agents repeat learned jobs without the AI")} hint={t("Off: agents still learn routines, but always work with the AI.")} />
      ) : null}
      {list.isLoading ? <Skeleton className="h-32" /> : list.error ? (
        <p role="alert" className="text-danger">{errorMessage(list.error)}</p>
      ) : !list.data?.length ? (
        <EmptyState icon={ArrowsClockwiseIcon} title={t("No routines yet")}
          body={t("They appear after agents finish work that used tools and could be repeated, such as a monthly report or a regular check. Give the same kind of task twice and accept the results.")} />
      ) : (
        <ListCard>{list.data.map((r) => <RoutineRow key={r.id} r={r} canManage={canManage} />)}</ListCard>
      )}
    </>
  );
}

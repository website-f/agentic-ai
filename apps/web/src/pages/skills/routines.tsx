import { ArrowsClockwiseIcon, CheckCircleIcon, CoinsIcon, PauseIcon, PlayIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { DataTable, filterOf, RowMenu, TableFilter, useTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { MenuItem } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, useT } from "@/i18n";
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

/** What a routine does, step by step (opened from its row). */
function RoutineDetail({ r }: { r: Routine }) {
  const t = useT();
  return (
    <div className="grid gap-2 text-[12.5px]">
      {r.description ? <p className="text-[13px] break-words text-muted">{r.description}</p> : null}
      {r.note ? <p className="text-warn">{r.note}</p> : null}
      {r.example ? <p className="break-words"><span className="font-medium">{t("Learned from:")}</span> {r.example.slice(0, 300)}</p> : null}
      {r.slots.length ? (
        <p className="break-words"><span className="font-medium">{t("Changes each time:")}</span> {r.slots.map((x) => x.description || x.name).join(", ")}</p>
      ) : <p>{t("Exactly the same every time.")}</p>}
      <ol className="grid list-decimal gap-1 rounded-sm border border-border bg-surface-2/40 p-3 pl-8">
        {r.steps.map((st, i) => (
          <li key={i} className="font-mono text-[12px] break-all">{st.tool}({JSON.stringify(st.args).slice(0, 160)})</li>
        ))}
      </ol>
      <p className="break-words">
        <span className="font-medium">{t("The answer:")}</span>{" "}
        {r.answer.mode === "template" ? t("a fixed reply, no AI needed") : t("written by the cheapest AI from the results: {how}", { how: r.answer.text ?? "" })}
      </p>
    </div>
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
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "trust" | "pause" | "resume" | "retire" }) => api<Routine>(`/api/routines/${id}/${action}`, "POST", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: routineKeys.list });
      toast.success(t("Saved."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/routines/${id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: routineKeys.list }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const [forget, setForget] = useState<Routine | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // P107: a data table (its address keys start with r_, beside the skills table's).
  const control = useTableState({ size: 25 }, { prefix: "r_", filters: ["status", "agent"] });
  const [status] = filterOf(control, "status");
  const [agent] = filterOf(control, "agent");
  const all = useMemo(() => list.data ?? [], [list.data]);
  const agents = useMemo(() => [...new Set(all.map((r) => r.agent_name ?? ""))].filter(Boolean).sort((a, b) => a.localeCompare(b)), [all]);
  const rows = useMemo(() => all.filter((r) => (!status || r.status === status) && (!agent || (r.agent_name ?? "") === agent)), [all, status, agent]);
  const opened = all.find((r) => r.id === openId) ?? null;
  const sm = summary.data;

  const buttons = (r: Routine) => (
    <>
      {r.status === "candidate" || r.status === "paused" ? (
        <Button size="sm" variant="outline" loading={act.isPending} onClick={() => act.mutate({ id: r.id, action: r.status === "paused" ? "resume" : "trust" })}>
          {r.status === "paused" ? <PlayIcon size={14} /> : <CheckCircleIcon size={14} />} {r.status === "paused" ? t("Resume") : t("Trust it now")}
        </Button>
      ) : null}
      {r.status === "active" || r.status === "candidate" ? (
        <Button size="sm" variant="ghost" disabled={act.isPending} onClick={() => act.mutate({ id: r.id, action: "pause" })}><PauseIcon size={14} /> {t("Pause")}</Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => setForget(r)}><TrashIcon size={14} /> {t("Forget")}</Button>
    </>
  );

  const columns: Column<Routine>[] = [
    {
      id: "name", header: t("Routine"), card: "title", sortValue: (r) => r.name.toLowerCase(), exportValue: (r) => r.name,
      cell: (r) => (
        <span className="grid min-w-0 gap-0.5">
          <span className="text-[13.5px] font-semibold break-words">{r.name}</span>
          {r.description ? <span className="line-clamp-2 text-[12.5px] break-words text-muted">{r.description}</span> : null}
          {r.note ? <span className="text-[12px] text-warn">{r.note}</span> : null}
        </span>
      ),
    },
    { id: "status", header: t("Status"), sortValue: (r) => r.status, exportValue: (r) => t(STATUS[r.status].label), cell: (r) => <Pill tone={STATUS[r.status].tone}>{t(STATUS[r.status].label)}</Pill> },
    { id: "agent", header: t("Learned by"), hideBelow: "lg", sortValue: (r) => r.agent_name, cell: (r) => r.agent_name ?? <span className="text-muted">-</span> },
    {
      id: "uses", header: t("Runs"), kind: "number", align: "right", sortValue: (r) => r.uses,
      cell: (r) => (r.status === "candidate"
        ? <span className="text-muted">{t("Seen {n} of {needed}", { n: r.confirmations, needed: r.needed })}</span>
        : r.uses.toLocaleString(locale())),
    },
    {
      id: "results", header: t("Accepted"), kind: "number", align: "right", hideBelow: "xl", sortValue: (r) => r.successes, exportValue: (r) => `${r.successes}/${r.successes + r.failures}`,
      cell: (r) => (r.successes || r.failures ? t("{ok} of {all}", { ok: r.successes, all: r.successes + r.failures }) : <span className="text-muted">-</span>),
    },
    { id: "saved", header: t("Tokens saved"), kind: "number", align: "right", sortValue: (r) => r.tokens_saved, cell: (r) => (r.tokens_saved ? tokens(r.tokens_saved) : <span className="text-muted">-</span>) },
    {
      id: "used", header: t("Last used"), kind: "date", hideBelow: "lg", sortValue: (r) => r.last_used_at,
      cell: (r) => (r.last_used_at ? <span className="text-muted">{timeAgo(r.last_used_at)}</span> : <span className="text-muted">-</span>),
    },
  ];

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
      {!list.isLoading && !list.error && !all.length ? (
        <EmptyState icon={ArrowsClockwiseIcon} title={t("No routines yet")}
          body={t("They appear after agents finish work that used tools and could be repeated, such as a monthly report or a regular check. Give the same kind of task twice and accept the results.")} />
      ) : (
        <DataTable
          label={t("Routines")}
          columns={columns}
          rows={rows}
          rowId={(r) => r.id}
          rowLabel={(r) => r.name}
          control={control}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          searchText={(r) => `${r.name} ${r.description} ${r.agent_name ?? ""} ${r.tools.join(" ")}`}
          searchPlaceholder={t("Search routines")}
          exportName={t("routines")}
          onOpen={(r) => setOpenId(r.id)}
          filters={
            <>
              <TableFilter control={control} id="status" label={t("Status")} allLabel={t("All statuses")}
                options={(Object.keys(STATUS) as Routine["status"][]).map((k) => ({ value: k, label: t(STATUS[k].label) }))} />
              {agents.length > 1 ? (
                <TableFilter control={control} id="agent" label={t("Learned by")} allLabel={t("Every agent")} options={agents.map((a) => ({ value: a, label: a }))} />
              ) : null}
            </>
          }
          actions={canManage ? (r) => (
            <RowMenu label={t("Options for {name}", { name: r.name })}>
              {r.status === "candidate" || r.status === "paused" ? (
                <MenuItem icon={r.status === "paused" ? <PlayIcon /> : <CheckCircleIcon />} disabled={act.isPending}
                  onSelect={() => act.mutate({ id: r.id, action: r.status === "paused" ? "resume" : "trust" })}>
                  {r.status === "paused" ? t("Resume") : t("Trust it now")}
                </MenuItem>
              ) : null}
              {r.status === "active" || r.status === "candidate" ? (
                <MenuItem icon={<PauseIcon />} disabled={act.isPending} onSelect={() => act.mutate({ id: r.id, action: "pause" })}>{t("Pause")}</MenuItem>
              ) : null}
              <MenuItem icon={<TrashIcon />} danger disabled={remove.isPending} onSelect={() => setForget(r)}>{t("Forget")}</MenuItem>
            </RowMenu>
          ) : undefined}
        />
      )}
      {opened ? (
        <ResponsiveDialog open onOpenChange={(o) => !o && setOpenId(null)} title={opened.name}
          description={`${t(STATUS[opened.status].label)}${opened.agent_name ? ` · ${t("Learned by {name}", { name: opened.agent_name })}` : ""}`}
          footer={canManage ? buttons(opened) : undefined}>
          <RoutineDetail r={opened} />
        </ResponsiveDialog>
      ) : null}
      <ConfirmDialog open={!!forget} onOpenChange={(o) => !o && setForget(null)} title={t("Forget {name}?", { name: forget?.name ?? "" })}
        body={t("Agents will do this job with the AI again, and may learn it again.")} confirmLabel={t("Forget")} danger
        onConfirm={() => {
          if (!forget) return;
          remove.mutate(forget.id);
          if (forget.id === openId) setOpenId(null);
        }} />
    </>
  );
}

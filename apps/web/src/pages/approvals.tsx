import { ClockCounterClockwiseIcon, SealCheckIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { ApprovalCard } from "@/components/approval-card";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { DataTable, filterOf, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { approvalsQuery, workKeys, type Approval } from "@/lib/work";

type Tab = "pending" | "history";

/** Waiting approvals are a short inbox of cards to decide on. */
function Waiting({ canDecide }: { canDecide: boolean }) {
  const t = useT();
  const { data, isLoading, error } = useQuery(approvalsQuery("pending"));
  if (isLoading) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
            <div className="flex items-center gap-3"><Skeleton className="size-8 rounded-full" /><Skeleton className="h-4 w-2/3" /></div>
            <Skeleton className="h-16" />
            <Skeleton className="h-8 w-1/2" />
          </div>
        ))}
      </div>
    );
  }
  if (error) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data?.length) {
    return <EmptyState icon={SealCheckIcon} title={t("Nothing waiting on you")} body={t("When an agent needs permission or has a question, it shows up here and as a notification.")} />;
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
      {data.map((a, i) => (
        <ApprovalCard key={a.id} approval={a} canDecide={canDecide}
          guide={i === 0 ? "approvals.card" : undefined}
          guideActions={i === 0 ? "approvals.actions" : undefined} />
      ))}
    </div>
  );
}

const OUTCOME: Partial<Record<Approval["status"], { label: string; tone: "ok" | "danger" | "info" | "neutral" }>> = {
  approved: { label: msg("Approved"), tone: "ok" },
  denied: { label: msg("Denied"), tone: "danger" },
  answered: { label: msg("Answered"), tone: "info" },
  expired: { label: msg("Expired"), tone: "neutral" },
  cancelled: { label: msg("Cancelled"), tone: "neutral" },
};
const ALL = "all";

/** P96: decisions only grow, so history is a data table: the server finds words, filters the
 * outcome, sorts and sends one numbered page. A row opens the full card (read only). */
function History({ onTotal }: { onTotal: (n: number) => void }) {
  const t = useT();
  const control = useTableState({ size: 25 }, { filters: ["status"] });
  const [outcome, setOutcome] = filterOf(control, "status");
  const table = useServerTable<Approval>(workKeys.approvals("history"), "/api/approvals", control.state, { state: "history" });
  const [open, setOpen] = useState<Approval | null>(null);
  const total = table.total;
  useEffect(() => {
    if (!table.loading) onTotal(total);
  }, [table.loading, total, onTotal]);
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");
  const columns: Column<Approval>[] = [
    { id: "created", header: t("Asked"), sortable: true, kind: "date", className: "whitespace-nowrap", cell: (a) => <span className="text-muted tabular">{when(a.created_at)}</span> },
    {
      id: "agent", header: t("Agent"), card: "title",
      cell: (a) => (
        <span className="grid min-w-0">
          <span className="font-medium break-words">{a.agent_name}</span>
          <span className="text-[12px] break-words text-muted">{a.task_title}</span>
        </span>
      ),
    },
    {
      id: "what", header: t("What it asked"), card: "full",
      cell: (a) => (
        <span className="grid min-w-0 gap-0.5">
          <span className="text-[13px] break-words">{a.kind === "question" ? a.reason : a.tool_label || a.tool_name}</span>
          {a.kind !== "question" && a.reason ? <span className="line-clamp-2 text-[12px] break-words text-muted">{a.reason}</span> : null}
        </span>
      ),
    },
    {
      id: "outcome", header: t("Outcome"),
      cell: (a) => {
        const o = OUTCOME[a.status];
        return o ? <Pill tone={o.tone}>{t(o.label)}</Pill> : <Pill>{a.status}</Pill>;
      },
    },
    {
      id: "decided", header: t("Decided"), sortable: true, kind: "date", hideBelow: "lg",
      cell: (a) => (
        <span className="grid min-w-0">
          <span className="break-words">{a.decided_by_name ?? a.decided_by ?? "-"}</span>
          {a.decided_at ? <span className="text-[12px] text-muted tabular">{when(a.decided_at)}</span> : null}
        </span>
      ),
    },
  ];
  return (
    <>
      <DataTable
        label={t("Decisions")}
        mode="server"
        columns={columns}
        rows={table.rows}
        total={table.total}
        rowId={(a) => a.id}
        rowLabel={(a) => `${a.agent_name}: ${a.tool_label || a.tool_name}`}
        control={control}
        loading={table.loading}
        fetching={table.fetching}
        error={table.error}
        onRetry={table.refetch}
        onOpen={setOpen}
        searchPlaceholder={t("Search by agent, task or what was asked")}
        filters={
          <Select className="w-full sm:w-44" label={t("Outcome")} value={outcome || ALL} onValueChange={(v) => setOutcome(v === ALL ? "" : v)}
            options={[{ value: ALL, label: t("Every outcome") }, ...(Object.keys(OUTCOME) as Approval["status"][]).map((s) => ({ value: s, label: t(OUTCOME[s]!.label) }))]} />
        }
        empty={<EmptyState icon={ClockCounterClockwiseIcon} title={t("No decisions yet")} body={t("Every approval, denial and answer is kept here with who made it and when.")} />}
      />
      {open ? (
        <SideSheet open onOpenChange={(o) => { if (!o) setOpen(null); }} title={open.agent_name} description={open.task_title}>
          <ApprovalCard approval={open} canDecide={false} />
        </SideSheet>
      ) : null}
    </>
  );
}

export function ApprovalsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canDecide = me.permissions.includes("approvals.decide");
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const navigate = useNavigate();
  const tab: Tab = search.tab === "history" ? "history" : "pending";
  const { data: pending } = useQuery(approvalsQuery("pending"));
  const [historyTotal, setHistoryTotal] = useState<number | undefined>(undefined);
  return (
    <Page>
      <PageHeader
        title={t("Approvals")}
        description={canDecide ? t("Agents stop and wait here before risky actions, and when they need an answer from you.") : t("Your role can see decisions but not make them. Ask an approver or admin.")}
      />
      <Segmented<Tab>
        guide="approvals.history"
        label={t("Approvals")}
        className="w-fit"
        value={tab}
        onChange={(v) => navigate({ to: "/approvals", search: { tab: v }, replace: true })}
        options={[
          { value: "pending", label: t("Waiting"), count: pending?.length },
          { value: "history", label: t("History"), count: tab === "history" ? historyTotal : undefined },
        ]}
      />
      {tab === "pending" ? <Waiting canDecide={canDecide} /> : <History onTotal={setHistoryTotal} />}
    </Page>
  );
}

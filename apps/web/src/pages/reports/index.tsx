import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, ClipboardTextIcon, DownloadSimpleIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { Markdown } from "@/components/markdown";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { onLiveEvent } from "@/lib/live";
import { officeKeys, reportQuery, reportsQuery, type Report, type ReportTable } from "@/lib/office-data";
import { cn, timeAgo } from "@/lib/utils";

function DataTable({ reportId, table, n }: { reportId: string; table: ReportTable; n: number }) {
  const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
  const [q, setQ] = useState("");
  const numeric = table.columns.map((_, i) => table.rows.length > 0 && table.rows.every((r) => typeof r[i] === "number" || r[i] === ""));
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? table.rows.filter((r) => r.some((c) => String(c).toLowerCase().includes(needle))) : table.rows;
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.col], y = b[sort.col];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""), undefined, { numeric: true });
        return sort.desc ? -c : c;
      });
    }
    return out;
  }, [table.rows, sort, q]);
  return (
    <section aria-label={table.title || `Table ${n + 1}`} className="overflow-hidden rounded-[var(--radius-md)] border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-2">
        <h3 className="flex-1 text-[13.5px] font-semibold">{table.title || `Table ${n + 1}`} <span className="font-normal text-muted">· {table.rows.length} rows</span></h3>
        {table.rows.length > 8 ? (
          <label className="relative">
            <span className="sr-only">Filter rows</span>
            <MagnifyingGlassIcon size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" className="h-7 w-36 rounded-sm border border-border bg-surface pr-2 pl-6 text-[12.5px] focus-visible:border-accent focus-visible:outline-none" />
          </label>
        ) : null}
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/reports/${reportId}/table/${n}.csv`} download><DownloadSimpleIcon size={14} /> CSV</a>
        </Button>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-surface text-left text-muted shadow-[0_1px_0_var(--color-border)]">
            <tr>
              {table.columns.map((c, i) => (
                <th key={i} scope="col" className={cn("px-3 py-2 font-medium whitespace-nowrap", numeric[i] && "text-right")}
                  aria-sort={sort?.col === i ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => setSort((s) => ({ col: i, desc: s?.col === i ? !s.desc : !!numeric[i] }))}>
                    {c}{sort?.col === i ? (sort.desc ? <ArrowDownIcon size={11} /> : <ArrowUpIcon size={11} />) : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, ri) => (
              <tr key={ri} className="align-top hover:bg-surface-2/40">
                {table.columns.map((_, ci) => (
                  <td key={ci} className={cn("px-3 py-1.5", numeric[ci] ? "text-right font-mono tabular" : "max-w-[28rem] break-words")}>
                    {typeof r[ci] === "number" ? Number(r[ci]).toLocaleString() : String(r[ci] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
            {!rows.length ? <tr><td colSpan={table.columns.length} className="px-3 py-4 text-center text-muted">No rows match.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Reader({ id, onBack }: { id: string; onBack: () => void }) {
  const { data: r, isLoading, error } = useQuery(reportQuery(id));
  if (isLoading) return <Skeleton className="h-96 rounded-[var(--radius-md)]" />;
  if (error || !r) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <article className="grid min-w-0 gap-4">
      <button onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted hover:text-fg lg:hidden"><ArrowLeftIcon size={14} /> All reports</button>
      <header className="grid gap-2">
        <h2 className="text-[19px] font-semibold tracking-tight">{r.title}</h2>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
          {r.agent_name ? <span className="inline-flex items-center gap-1.5"><AgentAvatar name={r.agent_name} color={r.agent_color ?? "#888"} size="xs" /> {r.agent_name}</span> : null}
          {r.branch_name ? <span>· {r.branch_name}</span> : null}
          <span>· {timeAgo(r.created_at)}</span>
          {r.task_id ? <>· <Link to="/tasks" search={{ task: r.task_id }} className="text-accent hover:underline">{r.task_title ?? "the task"}</Link></> : null}
          {r.labels.map((l) => <Pill key={l}>{l}</Pill>)}
        </p>
      </header>
      {r.summary ? <p className="rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/50 px-4 py-3 text-[14px]">{r.summary}</p> : null}
      {(r.tables ?? []).map((t, n) => <DataTable key={n} reportId={r.id} table={t} n={n} />)}
      {r.body ? <Markdown className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">{r.body}</Markdown> : null}
    </article>
  );
}

function Row({ r, active, onOpen }: { r: Report; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} aria-current={active} className={cn("grid w-full gap-1 px-4 py-3 text-left hover:bg-surface-2/60", active && "bg-accent-soft/50")}>
        <span className="truncate text-[13.5px] font-medium">{r.title}</span>
        <span className="line-clamp-2 text-[12.5px] text-muted">{r.summary}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
          {r.agent_name} · {r.branch_name ?? "Office"} · {timeAgo(r.created_at)}
          {r.row_count ? <Pill>{r.row_count} rows</Pill> : null}
          {r.labels.slice(0, 2).map((l) => <Pill key={l}>{l}</Pill>)}
        </span>
      </button>
    </li>
  );
}

export function ReportsPage() {
  const qc = useQueryClient();
  const { data: reports = [], isLoading, error } = useQuery(reportsQuery);
  const search = useSearch({ strict: false }) as { r?: string };
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  useEffect(() => onLiveEvent((ev) => {
    if (ev.type === "report.created") qc.invalidateQueries({ queryKey: officeKeys.reports });
  }), [qc]);
  const shown = reports.filter((r) => !q.trim() || `${r.title} ${r.summary} ${r.agent_name} ${r.branch_name} ${r.labels.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()));
  const open = (id?: string) => navigate({ to: "/reports", search: id ? { r: id } : {}, replace: true });
  const current = search.r ?? (typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches ? shown[0]?.id : undefined);

  return (
    <Page className="max-w-7xl">
      <PageHeader title="Reports" description="What agents wrote up for you: a summary first, then tables you can sort, filter and download as CSV." />
      {isLoading ? <Skeleton className="h-96 rounded-[var(--radius-md)]" /> : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !reports.length ? (
        <EmptyState icon={ClipboardTextIcon} title="No reports yet" body="Ask an agent for a report (for example, a summary of an inbox) and it publishes one here." />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className={cn("grid content-start gap-3", current && "hidden lg:grid")}>
            <label className="relative">
              <span className="sr-only">Search reports</span>
              <MagnifyingGlassIcon size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reports" className="h-9 w-full rounded-sm border border-border bg-surface pr-3 pl-8 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
            </label>
            <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
              {shown.map((r) => <Row key={r.id} r={r} active={r.id === current} onOpen={() => open(r.id)} />)}
              {!shown.length ? <li className="px-4 py-6 text-center text-[13px] text-muted">No report matches.</li> : null}
            </ul>
          </div>
          {current ? <Reader key={current} id={current} onBack={() => open()} /> : null}
        </div>
      )}
    </Page>
  );
}

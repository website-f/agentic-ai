import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, ArrowsDownUpIcon, ClipboardTextIcon, DownloadSimpleIcon, KanbanIcon, MagnifyingGlassIcon, SparkleIcon, TableIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { AgentAvatar } from "@/components/agent-avatar";
import { LoadMore } from "@/components/load-more";
import { Markdown } from "@/components/markdown";
import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Meta } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { onLiveEvent } from "@/lib/live";
import { officeKeys, reportQuery, type Report, type ReportTable } from "@/lib/office-data";
import { useDebounced, usePagedList } from "@/lib/paged";
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
    <section aria-label={table.title || `Table ${n + 1}`} className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-2/50 px-3 py-2.5 sm:px-4">
        <h3 className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-[13.5px] font-semibold">
          <TableIcon size={15} weight="duotone" className="shrink-0 text-muted" />
          <span className="min-w-0 break-words">{table.title || `Table ${n + 1}`} <span className="font-normal whitespace-nowrap text-muted">· {table.rows.length} rows</span></span>
        </h3>
        {table.rows.length > 8 ? (
          <label className="relative max-sm:flex-1">
            <span className="sr-only">Filter rows</span>
            <MagnifyingGlassIcon size={13} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows" className="h-8 w-full rounded-sm border border-border bg-surface pr-2 pl-7 text-[12.5px] focus-visible:border-accent focus-visible:outline-none sm:w-40" />
          </label>
        ) : null}
        <Button size="sm" variant="outline" asChild>
          <a href={`/api/reports/${reportId}/table/${n}.csv`} download><DownloadSimpleIcon size={14} /> CSV</a>
        </Button>
      </div>
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 z-10 bg-surface text-left text-muted shadow-[0_1px_0_var(--color-border)]">
            <tr>
              {table.columns.map((c, i) => (
                <th key={i} scope="col" className={cn("px-3 py-2 font-medium whitespace-nowrap", numeric[i] && "text-right")}
                  aria-sort={sort?.col === i ? (sort.desc ? "descending" : "ascending") : "none"}>
                  <button className={cn("group inline-flex items-center gap-1 py-0.5 hover:text-fg", sort?.col === i && "text-fg")} onClick={() => setSort((s) => ({ col: i, desc: s?.col === i ? !s.desc : !!numeric[i] }))}>
                    {c}{sort?.col === i ? (sort.desc ? <ArrowDownIcon size={11} /> : <ArrowUpIcon size={11} />) : <ArrowsDownUpIcon size={11} className="opacity-0 transition-opacity group-hover:opacity-60" />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, ri) => (
              <tr key={ri} className="align-top hover:bg-surface-2/40">
                {table.columns.map((_, ci) => (
                  <td key={ci} className={cn("px-3 py-2", numeric[ci] ? "text-right font-mono whitespace-nowrap tabular" : "max-w-[28rem] min-w-[8rem] break-words")}>
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
  if (isLoading) {
    return (
      <div className="grid content-start gap-4" aria-hidden>
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 rounded-[var(--radius-md)]" />
        <Skeleton className="h-64 rounded-[var(--radius-md)]" />
      </div>
    );
  }
  if (error || !r) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  return (
    <article className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 w-fit lg:hidden"><ArrowLeftIcon size={14} /> All reports</Button>
      <header className="grid min-w-0 gap-2.5">
        <h2 className="text-[19px] leading-snug font-semibold tracking-tight break-words sm:text-[21px]">{r.title}</h2>
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[12.5px] text-muted">
          <Meta
            items={[
              r.agent_name ? <span className="inline-flex items-center gap-1.5 text-fg"><AgentAvatar name={r.agent_name} color={r.agent_color ?? "#888"} size="xs" /> {r.agent_name}</span> : null,
              r.branch_name,
              <time dateTime={r.created_at}>{timeAgo(r.created_at)}</time>,
              r.task_id ? <Link to="/tasks" search={{ task: r.task_id }} className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline"><KanbanIcon size={13} className="shrink-0" /><span className="truncate">{r.task_title ?? "the task"}</span></Link> : null,
            ]}
          />
        </p>
        {r.labels.length ? <div className="flex flex-wrap gap-1.5">{r.labels.map((l) => <Pill key={l}>{l}</Pill>)}</div> : null}
      </header>
      {r.summary ? (
        <section aria-label="Summary" className="flex min-w-0 gap-3 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/50 p-4">
          <IconTile icon={SparkleIcon} size="sm" className="max-sm:hidden" />
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold tracking-[0.06em] text-accent uppercase">Summary</p>
            <p className="mt-1 text-[14px] leading-relaxed break-words">{r.summary}</p>
          </div>
        </section>
      ) : null}
      {(r.tables ?? []).map((t, n) => <DataTable key={n} reportId={r.id} table={t} n={n} />)}
      {r.body ? <Markdown className="rounded-[var(--radius-md)] border border-border bg-surface px-4 py-4 sm:px-5">{r.body}</Markdown> : null}
    </article>
  );
}

function Row({ r, active, onOpen }: { r: Report; active: boolean; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} aria-current={active} className={cn("relative grid w-full grid-cols-[minmax(0,1fr)] gap-1 px-4 py-3 text-left transition-colors hover:bg-surface-2/60", active && "bg-accent-soft/50 hover:bg-accent-soft/60")}>
        {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" /> : null}
        <span className="line-clamp-2 text-[13.5px] leading-snug font-medium break-words">{r.title}</span>
        {r.summary ? <span className="line-clamp-2 text-[12.5px] text-muted">{r.summary}</span> : null}
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-muted">
          <Meta items={[r.agent_name, r.branch_name ?? "Office", timeAgo(r.created_at)]} />
        </span>
        {r.row_count || r.labels.length ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {r.row_count ? <Pill tone="info"><TableIcon size={11} weight="bold" /> {r.row_count} rows</Pill> : null}
            {r.labels.slice(0, 2).map((l) => <Pill key={l}>{l}</Pill>)}
          </span>
        ) : null}
      </button>
    </li>
  );
}

export function ReportsPage() {
  const qc = useQueryClient();
  const search = useSearch({ strict: false }) as { r?: string };
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  // Search runs on the server (title, summary, agent, label) and the list loads 50 at a time.
  const needle = useDebounced(q.trim());
  const list = usePagedList<Report>(officeKeys.reports, "/api/reports", { q: needle });
  const { items: shown, isLoading, error } = list;
  useEffect(() => onLiveEvent((ev) => {
    if (ev.type === "report.created") qc.invalidateQueries({ queryKey: officeKeys.reports });
  }), [qc]);
  const open = (id?: string) => navigate({ to: "/reports", search: id ? { r: id } : {}, replace: true });
  const current = search.r ?? (typeof window !== "undefined" && window.matchMedia?.("(min-width: 1024px)").matches ? shown[0]?.id : undefined);

  return (
    <Page className="max-w-7xl">
      <PageHeader title="Reports" description="What agents wrote up for you: a summary first, then tables you can sort, filter and download as CSV." />
      {isLoading ? (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div className="grid content-start gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</div>
          <Skeleton className="h-96 rounded-[var(--radius-md)] max-lg:hidden" />
        </div>
      ) : error ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : !shown.length && !needle && !list.hasMore ? (
        <EmptyState icon={ClipboardTextIcon} title="No reports yet" body="Ask an agent for a report (for example, a summary of an inbox) and it publishes one here." />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <div className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6.5rem)] lg:grid-rows-[auto_minmax(0,1fr)]", current && "hidden lg:grid")}>
            <SearchInput guide="reports.search" value={q} onChange={setQ} placeholder="Search reports" className="flex-none basis-auto" />
            <div data-guide="reports.list" className="min-h-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
              <p className="border-b border-border px-4 py-2 text-[12px] text-muted tabular">
                {needle ? `${list.total ?? shown.length} matching` : `${list.total ?? shown.length} ${(list.total ?? shown.length) === 1 ? "report" : "reports"}`}
              </p>
              <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border lg:max-h-[calc(100dvh-12rem)] lg:overflow-y-auto lg:overscroll-contain">
                {shown.map((r) => <Row key={r.id} r={r} active={r.id === current} onOpen={() => open(r.id)} />)}
                {!shown.length ? <li className="px-4 py-8 text-center text-[13px] text-muted">No report matches.</li> : null}
                {list.hasMore || shown.length > 50 ? <li className="p-3"><LoadMore compact noun="reports" shown={shown.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} /></li> : null}
              </ul>
            </div>
          </div>
          {current ? <Reader key={current} id={current} onBack={() => open()} /> : null}
        </div>
      )}
    </Page>
  );
}

import { FilesIcon, PlusIcon, SealCheckIcon, PencilSimpleLineIcon, WarningCircleIcon, EyeIcon, SparkleIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, Page } from "@/components/page";
import { MadeBy, ReviewActions, ReviewPill, WorkLinks } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { ListRow, Meta } from "@/components/ui/card";
import { DataTable, TableFilter, useServerTable, useTableState, type Column } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { SearchSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import { Stat, StatGrid } from "@/components/ui/stat";
import { useT } from "@/i18n";
import { useCompanies } from "@/lib/company";
import { docKeys, docStatsQuery, STATUS_LABEL, type DocStatus } from "@/lib/documents";
import { docOrigin, provKeys, type DocOrigin, type ReviewedDoc } from "@/lib/provenance";
import { branchesQuery, meQuery } from "@/lib/queries";
import { everyRow } from "@/lib/table-export";
import { cn, timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";
import { DocumentEditor } from "./editor";
import { NewDocumentDialog } from "./new-document";
import { LibraryHeader } from "../library-hub/hub";
import { KindTile } from "./visuals";

const ALL = "__all";
type Filter = DocStatus | "fix";
type View = "all" | "review";

/** P107: a select styled like the table's filter chips (TableFilter), for the one filter whose
 * "all" must be stored explicitly (the company starts on the header's company). */
function CompanyFilter({ value, on, onChange, options }: { value: string; on: boolean; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const t = useT();
  return (
    <SearchSelect size="md" label={t("Company")} value={value} onValueChange={onChange} searchPlaceholder={t("Search companies")}
      className={cn("w-full sm:w-auto sm:max-w-60 sm:min-w-36", on && "border-accent/50 bg-accent-soft/50 font-medium text-fg")}
      options={[{ value: ALL, label: t("All companies") }, ...options]} />
  );
}

export function DocumentsPage() {
  const t = useT();
  const search = useSearch({ from: "/library/documents" });
  const navigate = useNavigate({ from: "/documents" });
  const { data: me } = useQuery(meQuery);
  const [view, setView] = useState<View>(search.view === "review" ? "review" : "all");
  // P107: data tables. Status, who made it, agent and company live in the address with the
  // table (search, page, sort); the review queue keeps its own page and search under "r_".
  const control = useTableState({ size: 25 }, { filters: ["status", "origin", "agent", "branch"] });
  const queueControl = useTableState({ size: 25 }, { prefix: "r_" });
  const f = control.state.f;
  const status = (["draft", "review", "approved", "fix"].includes(f.status ?? "") ? f.status : "") as Filter | "";
  // The Company filter starts on the header's company; "all" (kept in the address) is every company.
  const { selected: headerCompany } = useCompanies();
  const branch = f.branch === "all" ? ALL : f.branch || headerCompany?.id || ALL;
  const [creating, setCreating] = useState(!!search.new);
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: allAgents = [] } = useQuery(agentsQuery);
  const agents = allAgents.filter((a) => !a.clone_of && (branch === ALL || a.branch_id === branch));
  const agent = f.agent && agents.some((a) => a.id === f.agent) ? f.agent : "";
  // Picking an agent means "made by AI".
  const origin = (agent ? "agent" : f.origin === "agent" || f.origin === "person" ? f.origin : "") as DocOrigin | "";
  // Company, search, who made it and status all filter on the server, so each numbered page is
  // already the right documents; the tiles and tab counts come from one stats call.
  const needle = control.state.q.trim();
  const params: Record<string, string> = {};
  if (branch !== ALL) params.branch_id = branch;
  if (needle) params.q = needle;
  if (agent) params.agent_id = agent;
  const listParams: Record<string, string> = { ...params };
  if (origin) listParams.origin = origin;
  const { data: stats } = useQuery({ ...docStatsQuery(listParams), enabled: !search.d });
  // The table's own filters go to the API under the API's names (not their address names).
  const listExtra = {
    ...listParams,
    status: status && status !== "fix" ? status : undefined,
    fix: status === "fix" ? true : undefined,
  };
  const list = useServerTable<ReviewedDoc>(docKeys.documents, "/api/documents", { ...control.state, f: {} }, listExtra, { enabled: !search.d && view === "all" });
  const queueExtra = {
    branch_id: branch !== ALL ? branch : undefined,
    agent_id: agent || undefined,
  };
  const queue = useServerTable<ReviewedDoc>(provKeys.queue, "/api/documents/review-queue", queueControl.state, queueExtra, { enabled: !search.d && view === "review" });

  if (search.d) {
    return <Page><DocumentEditor key={search.d} id={search.d} /></Page>;
  }

  const count = (s: DocStatus) => stats?.[s] ?? 0;
  const fixing = stats?.fix ?? 0;
  const aiWaiting = stats?.ai_waiting ?? 0;
  const canApprove = !!me?.permissions.includes("approvals.decide");
  const canWrite = !!me?.permissions.includes("work.write");
  // Opening a document or switching the view keeps the tables' places in the address.
  const merge = (change: Record<string, unknown>) => ((prev: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...prev, ...change };
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete next[k];
    return next;
  }) as never;
  const open = (id: string) => navigate({ search: merge({ d: id }) });
  const showView = (v: View) => { setView(v); navigate({ search: merge({ view: v === "review" ? "review" : undefined }), replace: true }); };
  const setStatus = (s: Filter | "") => control.set({ f: { status: s } });
  const toggle = (s: Filter) => setStatus(status === s ? "" : s);
  const setBranch = (v: string) => control.set({ f: { branch: v === ALL ? "all" : v === headerCompany?.id ? "" : v, agent: "" } });

  const companyFilter = branches.length > 1 ? (
    <CompanyFilter value={branch} on={branch !== ALL} onChange={setBranch} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
  ) : null;
  const agentFilter = agents.length ? (
    <TableFilter control={control} id="agent" label={t("Agent")} allLabel={t("Any agent")}
      options={agents.map((a) => ({ value: a.id, label: a.name }))} />
  ) : null;
  const filters = companyFilter || agentFilter ? <>{companyFilter}{agentFilter}</> : undefined;

  const titleCol: Column<ReviewedDoc> = {
    id: "title", header: t("Document"), sortable: true, card: "title", exportValue: (d) => d.title,
    cell: (d) => (
      <span className="flex min-w-0 items-start gap-2.5">
        <KindTile kind={d.kind} size="sm" />
        <span className="min-w-0 pt-0.5 text-[13.5px] font-medium break-words">
          {d.title}{d.number ? <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">{d.number}</span> : null}
        </span>
      </span>
    ),
  };
  const checks = (d: ReviewedDoc) => d.errors ? <Pill tone="danger"><WarningCircleIcon size={12} weight="fill" /> {t("{n} to fix", { n: d.errors })}</Pill>
    : d.warnings ? <Pill tone="warn">{t("{n} to check", { n: d.warnings })}</Pill> : <span className="text-muted">-</span>;
  const updated: Column<ReviewedDoc> = {
    id: "updated", header: t("Updated"), sortable: true, kind: "date", className: "whitespace-nowrap", exportValue: (d) => d.updated_at,
    cell: (d) => <time dateTime={d.updated_at} className="text-muted">{timeAgo(d.updated_at)}</time>,
  };
  const columns: Column<ReviewedDoc>[] = [
    titleCol,
    { id: "number", header: t("Number"), exportOnly: true, cell: () => null, exportValue: (d) => d.number ?? "" },
    {
      id: "by", header: t("Made by"), exportValue: (d) => (docOrigin(d) === "agent" ? d.agent_name ?? "" : d.created_by_name ?? ""),
      cell: (d) => docOrigin(d) === "agent" ? <MadeBy origin="agent" agentName={d.agent_name} agentColor={d.agent_color} size="sm" />
        : d.created_by_name ? <span className="break-words">{d.created_by_name}</span> : <span className="text-muted">-</span>,
    },
    { id: "template", header: t("Template"), hideBelow: "xl", exportValue: (d) => d.template_name ?? t("Free-form"), cell: (d) => d.template_name ?? <span className="text-muted">{t("Free-form")}</span> },
    { id: "company", header: t("Company"), hideBelow: "lg", exportValue: (d) => d.branch_name ?? "", cell: (d) => d.branch_name ?? <span className="text-muted">-</span> },
    { id: "checks", header: t("Checks"), hideBelow: "lg", cell: checks },
    {
      id: "status", header: t("Status"), exportValue: (d) => t(STATUS_LABEL[d.status].label),
      cell: (d) => d.review_status === "sent_back" ? <ReviewPill status="sent_back" /> : <Pill tone={STATUS_LABEL[d.status].tone}>{t(STATUS_LABEL[d.status].label)}</Pill>,
    },
    updated,
  ];
  const queueColumns: Column<ReviewedDoc>[] = [
    {
      ...titleCol,
      cell: (d) => (
        <span className="grid min-w-0 gap-1">
          {titleCol.cell(d)}
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] sm:pl-11">
            <WorkLinks taskId={d.task_id} taskTitle={d.task_title} runId={d.workflow_run_id} runTitle={d.workflow_run_title} />
            {d.review_note ? <span className="inline-flex min-w-0 items-center gap-1 text-muted"><ArrowCounterClockwiseIcon size={12} className="shrink-0" /><span className="truncate">{t("Revised after: {note}", { note: d.review_note })}</span></span> : null}
          </span>
        </span>
      ),
    },
    { id: "by", header: t("Made by"), exportValue: (d) => d.agent_name ?? "", cell: (d) => <MadeBy origin="agent" agentName={d.agent_name} agentColor={d.agent_color} size="sm" /> },
    { id: "company", header: t("Company"), hideBelow: "xl", exportValue: (d) => d.branch_name ?? "", cell: (d) => d.branch_name ?? <span className="text-muted">-</span> },
    { id: "checks", header: t("Checks"), hideBelow: "lg", cell: checks },
    updated,
    {
      id: "decide", header: t("Decision"), card: "full",
      cell: (d) => <ReviewActions doc={d} canApprove={canApprove} canWrite={canWrite} onOpen={() => open(d.id)} />,
    },
  ];

  return (
    <Page>
      <LibraryHeader tab="/documents"
        actions={<Button data-guide="documents.new" onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New document")}</Button>} />

      <Segmented<View> label={t("View")} value={view} onChange={showView} guide="documents.review-tab"
        options={[
          { value: "all", label: t("All documents"), ...(stats ? { count: stats.total } : {}) },
          { value: "review", label: t("Review what AI made"), count: aiWaiting },
        ]} />

      {view === "all" ? (
        <StatGrid>
          <Stat label={t("In review")} value={count("review")} icon={EyeIcon} tone="info" hint={t("Waiting for a person")}
            onClick={() => toggle("review")} active={status === "review"} />
          <Stat label={t("Drafts")} value={count("draft")} icon={PencilSimpleLineIcon} tone="neutral" hint={t("Still being written")}
            onClick={() => toggle("draft")} active={status === "draft"} />
          <Stat label={t("Approved")} value={count("approved")} icon={SealCheckIcon} tone="ok" hint={t("Ready to send")}
            onClick={() => toggle("approved")} active={status === "approved"} />
          <Stat label={t("Needs fixing")} value={fixing} icon={WarningCircleIcon} tone={fixing ? "danger" : "neutral"} hint={stats && !stats.fix_complete ? t("In the latest 300") : t("Failed a check")}
            onClick={() => toggle("fix")} active={status === "fix"} />
        </StatGrid>
      ) : (
        <div className="flex flex-wrap items-start gap-3 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/40 px-4 py-3">
          <SparkleIcon size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p className="text-[14px] font-semibold">{aiWaiting === 1 ? t("1 document from AI agents waits for you") : t("{n} documents from AI agents wait for you", { n: aiWaiting })}</p>
            <p className="text-[13px] text-muted">{t("Agents draft; a person decides. Approve to lock it, or send it back with a note and the agent revises it. Nothing goes out until a person approves.")}</p>
          </div>
        </div>
      )}

      {view === "all" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-guide="documents.filters">
          <Segmented<Filter | typeof ALL> label={t("Status")} value={status || ALL} onChange={(v) => setStatus(v === ALL ? "" : v)}
            options={[
              { value: ALL, label: t("All"), count: stats?.total },
              { value: "review", label: t("In review"), count: count("review") },
              { value: "draft", label: t("Drafts"), count: count("draft") },
              { value: "approved", label: t("Approved"), count: count("approved") },
            ]} />
          <span data-guide="documents.origin" className="min-w-0">
            <Segmented<DocOrigin | typeof ALL> label={t("Made by")} value={origin || ALL} size="sm"
              onChange={(v) => control.set({ f: { origin: v === ALL ? "" : v, ...(v === "person" ? { agent: "" } : {}) } })}
              options={[
                { value: ALL, label: t("Anyone") },
                { value: "agent", label: t("Made by AI"), ...(stats?.agent !== undefined ? { count: stats.agent } : {}) },
                { value: "person", label: t("Made by people"), ...(stats?.person !== undefined ? { count: stats.person } : {}) },
              ]} />
          </span>
        </div>
      ) : null}

      {view === "review" ? (
        <div data-guide="documents.queue" className="min-w-0">
          <DataTable<ReviewedDoc>
            label={t("Documents waiting for review")}
            columns={queueColumns}
            rows={queue.rows}
            total={queue.total}
            mode="server"
            rowId={(d) => d.id}
            rowLabel={(d) => d.title}
            control={queueControl}
            exportName={t("documents-for-review")}
            exportRows={() => everyRow<ReviewedDoc>("/api/documents/review-queue", queueControl.state, queueExtra)}
            loading={queue.loading}
            fetching={queue.fetching}
            error={queue.error}
            onRetry={queue.refetch}
            onOpen={(d) => open(d.id)}
            searchPlaceholder={t("Search title or number")}
            filters={filters}
            empty={<EmptyState icon={SealCheckIcon} title={t("Nothing from AI waits for review")}
              body={t("When an agent drafts a quotation, a letter or an order, it shows here for a person to approve or send back.")} />}
          />
        </div>
      ) : (
        <div data-guide="documents.list" className="min-w-0">
          <DataTable<ReviewedDoc>
            label={t("Documents")}
            columns={columns}
            rows={list.rows}
            total={list.total}
            mode="server"
            rowId={(d) => d.id}
            rowLabel={(d) => d.title}
            control={control}
            exportName={t("documents")}
            exportRows={() => everyRow<ReviewedDoc>("/api/documents", { ...control.state, f: {} }, listExtra)}
            loading={list.loading}
            fetching={list.fetching}
            error={list.error}
            onRetry={list.refetch}
            onOpen={(d) => open(d.id)}
            searchPlaceholder={t("Search title or number")}
            filters={filters}
            empty={<EmptyState icon={FilesIcon} title={t("No documents yet")}
              body={t("Start from a template (quotation, invoice, letter, proposal…), let AI write a draft from a description, or ask an agent to prepare one.")}
              action={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New document")}</Button>} />}
          />
        </div>
      )}
      {creating ? <NewDocumentDialog branchId={branch === ALL ? null : branch} onClose={() => setCreating(false)}
        onCreated={(id) => navigate({ search: merge({ d: id }) })} /> : null}
    </Page>
  );
}

export function DocRow({ d, onOpen }: { d: ReviewedDoc; onOpen: () => void }) {
  const t = useT();
  const s = STATUS_LABEL[d.status];
  const ai = docOrigin(d) === "agent";
  return (
    <ListRow onClick={onOpen} leading={<KindTile kind={d.kind} />}
      title={<>{d.title}{d.number ? <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">{d.number}</span> : null}</>}
      meta={<Meta items={[
        ai ? <MadeBy origin="agent" agentName={d.agent_name} agentColor={d.agent_color} size="sm" /> : d.created_by_name ? t("by {name}", { name: d.created_by_name }) : null,
        d.template_name ?? t("Free-form"),
        d.branch_name,
        t("updated {when}", { when: timeAgo(d.updated_at) }),
      ]} />}
      trailing={<>
        {d.errors ? <Pill tone="danger"><WarningCircleIcon size={12} weight="fill" /> {t("{n} to fix", { n: d.errors })}</Pill>
          : d.warnings ? <Pill tone="warn">{t("{n} to check", { n: d.warnings })}</Pill> : null}
        {d.review_status === "sent_back" ? <ReviewPill status="sent_back" /> : <Pill tone={s.tone}>{t(s.label)}</Pill>}
      </>} />
  );
}

/** One document an agent made, waiting for a person: what, who, from where, and the decision. */
export function QueueRow({ d, canApprove, canWrite, onOpen }: { d: ReviewedDoc; canApprove: boolean; canWrite: boolean; onOpen: () => void }) {
  const t = useT();
  return (
    <ListRow leading={<KindTile kind={d.kind} />}
      title={<>{d.title}{d.number ? <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">{d.number}</span> : null}</>}
      meta={<Meta items={[
        <MadeBy origin="agent" agentName={d.agent_name} agentColor={d.agent_color} size="sm" />,
        d.branch_name,
        t("updated {when}", { when: timeAgo(d.updated_at) }),
      ]} />}
      trailing={<ReviewActions doc={d} canApprove={canApprove} canWrite={canWrite} onOpen={onOpen} />}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[12.5px]">
        <WorkLinks taskId={d.task_id} taskTitle={d.task_title} runId={d.workflow_run_id} runTitle={d.workflow_run_title} />
        {d.errors ? <Pill tone="danger"><WarningCircleIcon size={12} weight="fill" /> {t("{n} to fix", { n: d.errors })}</Pill>
          : d.warnings ? <Pill tone="warn">{t("{n} to check", { n: d.warnings })}</Pill> : null}
        {d.review_note ? <span className="inline-flex min-w-0 items-center gap-1 text-muted"><ArrowCounterClockwiseIcon size={12} className="shrink-0" /><span className="truncate">{t("Revised after: {note}", { note: d.review_note })}</span></span> : null}
      </span>
    </ListRow>
  );
}

import { FilesIcon, PlusIcon, SealCheckIcon, PencilSimpleLineIcon, WarningCircleIcon, EyeIcon, SparkleIcon, ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { LoadMore } from "@/components/load-more";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { MadeBy, ReviewActions, ReviewPill, WorkLinks } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { docKeys, docStatsQuery, STATUS_LABEL, type DocStatus } from "@/lib/documents";
import { useDebounced, usePagedList } from "@/lib/paged";
import { docOrigin, provKeys, type DocOrigin, type ReviewedDoc } from "@/lib/provenance";
import { branchesQuery, meQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";
import { DocumentEditor } from "./editor";
import { NewDocumentDialog } from "./new-document";
import { DocSteps, KindTile } from "./visuals";

const ALL = "__all";
type Filter = DocStatus | typeof ALL | "fix";
type View = "all" | "review";
type OriginFilter = DocOrigin | typeof ALL;

export function DocumentsPage() {
  const t = useT();
  const search = useSearch({ from: "/app/documents" });
  const navigate = useNavigate({ from: "/documents" });
  const { data: me } = useQuery(meQuery);
  const [status, setStatus] = useState<Filter>(ALL);
  const [view, setView] = useState<View>(search.view === "review" ? "review" : "all");
  const [origin, setOrigin] = useState<OriginFilter>(ALL);
  const [agent, setAgent] = useState<string>(ALL);
  // The Company filter starts on the header's company ("All companies": every company).
  const { selected: headerCompany } = useCompanies();
  const [branch, setBranch] = useState(headerCompany?.id ?? ALL);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(!!search.new);
  const { data: branches = [] } = useQuery(branchesQuery);
  const { data: allAgents = [] } = useQuery(agentsQuery);
  const agents = allAgents.filter((a) => !a.clone_of && (branch === ALL || a.branch_id === branch));
  // Company, search, who made it and status all filter on the server, so each lazily loaded
  // page is already the right documents; the tiles and tab counts come from one stats call.
  const needle = useDebounced(q.trim());
  const params: Record<string, string> = {};
  if (branch !== ALL) params.branch_id = branch;
  if (needle) params.q = needle;
  if (agent !== ALL) params.agent_id = agent;
  const listParams: Record<string, string> = { ...params };
  if (origin !== ALL) listParams.origin = origin;
  const { data: stats } = useQuery({ ...docStatsQuery(listParams), enabled: !search.d });
  const list = usePagedList<ReviewedDoc>(docKeys.documents, "/api/documents", {
    ...listParams,
    status: status !== ALL && status !== "fix" ? status : undefined,
    fix: status === "fix" ? true : undefined,
  }, { enabled: !search.d && view === "all" });
  const queue = usePagedList<ReviewedDoc>(provKeys.queue, "/api/documents/review-queue", {
    branch_id: branch !== ALL ? branch : undefined,
    agent_id: agent !== ALL ? agent : undefined,
  }, { enabled: !search.d && view === "review" });
  const { items: docs, isLoading, error } = list;

  if (search.d) {
    return <Page><DocumentEditor key={search.d} id={search.d} /></Page>;
  }

  const count = (s: DocStatus) => stats?.[s] ?? 0;
  const fixing = stats?.fix ?? 0;
  const aiWaiting = stats?.ai_waiting ?? 0;
  const canApprove = !!me?.permissions.includes("approvals.decide");
  const canWrite = !!me?.permissions.includes("work.write");
  const open = (id: string) => navigate({ search: { d: id } });
  const showView = (v: View) => { setView(v); navigate({ search: v === "review" ? { view: "review" } : {}, replace: true }); };
  const filtering = !!q || status !== ALL || origin !== ALL || agent !== ALL;

  return (
    <Page>
      <PageHeader title={t("Documents")}
        description={t("Quotations, invoices, letters and proposals, written by you or by agents. Each is checked automatically, approved by a person, then exported to PDF, Word or Excel.")}
        actions={<Button data-guide="documents.new" onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New document")}</Button>} />
      <DocSteps current="/documents" />

      <Segmented<View> label={t("View")} value={view} onChange={showView} guide="documents.review-tab"
        options={[
          { value: "all", label: t("All documents"), ...(stats ? { count: stats.total } : {}) },
          { value: "review", label: t("Review what AI made"), count: aiWaiting },
        ]} />

      {view === "all" ? (
        <StatGrid>
          <Stat label={t("In review")} value={count("review")} icon={EyeIcon} tone="info" hint={t("Waiting for a person")}
            onClick={() => setStatus(status === "review" ? ALL : "review")} active={status === "review"} />
          <Stat label={t("Drafts")} value={count("draft")} icon={PencilSimpleLineIcon} tone="neutral" hint={t("Still being written")}
            onClick={() => setStatus(status === "draft" ? ALL : "draft")} active={status === "draft"} />
          <Stat label={t("Approved")} value={count("approved")} icon={SealCheckIcon} tone="ok" hint={t("Ready to send")}
            onClick={() => setStatus(status === "approved" ? ALL : "approved")} active={status === "approved"} />
          <Stat label={t("Needs fixing")} value={fixing} icon={WarningCircleIcon} tone={fixing ? "danger" : "neutral"} hint={stats && !stats.fix_complete ? t("In the latest 300") : t("Failed a check")}
            onClick={() => setStatus(status === "fix" ? ALL : "fix")} active={status === "fix"} />
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

      <Toolbar data-guide="documents.filters">
        {view === "all" ? (
          <Segmented<Filter> label={t("Status")} value={status} onChange={setStatus}
            options={[
              { value: ALL, label: t("All"), count: stats?.total },
              { value: "review", label: t("In review"), count: count("review") },
              { value: "draft", label: t("Drafts"), count: count("draft") },
              { value: "approved", label: t("Approved"), count: count("approved") },
            ]} />
        ) : null}
        {view === "all" ? <SearchInput value={q} onChange={setQ} placeholder={t("Search title or number")} /> : null}
        <Select value={branch} onValueChange={(v) => { setBranch(v); setAgent(ALL); }} label={t("Company")} className="sm:w-56"
          options={[{ value: ALL, label: t("All companies") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
        {agents.length ? (
          <Select value={agent} label={t("Agent")} className="sm:w-48"
            onValueChange={(v) => { setAgent(v); if (v !== ALL && view === "all") setOrigin("agent"); }}
            options={[{ value: ALL, label: t("Any agent") }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
        ) : null}
      </Toolbar>
      {view === "all" ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2" data-guide="documents.origin">
          <Segmented<OriginFilter> label={t("Made by")} value={origin} size="sm"
            onChange={(v) => { setOrigin(v); if (v === "person") setAgent(ALL); }}
            options={[
              { value: ALL, label: t("Anyone") },
              { value: "agent", label: t("Made by AI"), ...(stats?.agent !== undefined ? { count: stats.agent } : {}) },
              { value: "person", label: t("Made by people"), ...(stats?.person !== undefined ? { count: stats.person } : {}) },
            ]} />
        </div>
      ) : null}

      {view === "review" ? (
        queue.isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[92px]" />)}</div>
          : queue.error ? <p role="alert" className="text-danger">{errorMessage(queue.error)}</p>
          : !queue.items.length ? (
            <EmptyState icon={SealCheckIcon} title={t("Nothing from AI waits for review")}
              body={t("When an agent drafts a quotation, a letter or an order, it shows here for a person to approve or send back.")} />
          ) : (
            <ListCard data-guide="documents.queue">
              {queue.items.map((d) => <QueueRow key={d.id} d={d} canApprove={canApprove} canWrite={canWrite} onOpen={() => open(d.id)} />)}
            </ListCard>
          )
      ) : isLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[68px]" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !docs.length ? (
          <EmptyState icon={FilesIcon} title={filtering ? t("Nothing matches") : t("No documents yet")}
            body={t("Start from a template (quotation, invoice, letter, proposal…), let AI write a draft from a description, or ask an agent to prepare one.")}
            action={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New document")}</Button>} />
        ) : (
          <ListCard data-guide="documents.list">
            {docs.map((d) => <DocRow key={d.id} d={d} onOpen={() => open(d.id)} />)}
          </ListCard>
        )}
      {view === "all" && (docs.length || list.hasMore) ? <LoadMore noun="documents" shown={docs.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} /> : null}
      {view === "review" && (queue.items.length || queue.hasMore) ? <LoadMore noun="documents" shown={queue.items.length} total={queue.total} hasMore={queue.hasMore} loading={queue.isFetchingMore} onLoad={queue.loadMore} /> : null}
      {creating ? <NewDocumentDialog branchId={branch === ALL ? null : branch} onClose={() => setCreating(false)}
        onCreated={(id) => navigate({ search: { d: id } })} /> : null}
    </Page>
  );
}

function DocRow({ d, onOpen }: { d: ReviewedDoc; onOpen: () => void }) {
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
function QueueRow({ d, canApprove, canWrite, onOpen }: { d: ReviewedDoc; canApprove: boolean; canWrite: boolean; onOpen: () => void }) {
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

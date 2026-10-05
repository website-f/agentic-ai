import { FilesIcon, PlusIcon, RobotIcon, SealCheckIcon, PencilSimpleLineIcon, WarningCircleIcon, EyeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { LoadMore } from "@/components/load-more";
import { EmptyState, Page, PageHeader } from "@/components/page";
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
import { docKeys, docStatsQuery, STATUS_LABEL, type DocStatus, type DocSummary } from "@/lib/documents";
import { useDebounced, usePagedList } from "@/lib/paged";
import { branchesQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { DocumentEditor } from "./editor";
import { NewDocumentDialog } from "./new-document";
import { DocSteps, KindTile } from "./visuals";

const ALL = "__all";
type Filter = DocStatus | typeof ALL | "fix";

export function DocumentsPage() {
  const t = useT();
  const search = useSearch({ from: "/app/documents" });
  const navigate = useNavigate({ from: "/documents" });
  const [status, setStatus] = useState<Filter>(ALL);
  // The Company filter starts on the header's company ("All companies": every company).
  const { selected: headerCompany } = useCompanies();
  const [branch, setBranch] = useState(headerCompany?.id ?? ALL);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(!!search.new);
  const { data: branches = [] } = useQuery(branchesQuery);
  // Company, search and status all filter on the server, so each lazily loaded page is already
  // the right documents; the tiles and tab counts come from one stats call.
  const needle = useDebounced(q.trim());
  const params: Record<string, string> = {};
  if (branch !== ALL) params.branch_id = branch;
  if (needle) params.q = needle;
  const { data: stats } = useQuery({ ...docStatsQuery(params), enabled: !search.d });
  const list = usePagedList<DocSummary>(docKeys.documents, "/api/documents", {
    ...params,
    status: status !== ALL && status !== "fix" ? status : undefined,
    fix: status === "fix" ? true : undefined,
  }, { enabled: !search.d });
  const { items: docs, isLoading, error } = list;

  if (search.d) {
    return <Page><DocumentEditor key={search.d} id={search.d} /></Page>;
  }

  const count = (s: DocStatus) => stats?.[s] ?? 0;
  const fixing = stats?.fix ?? 0;

  return (
    <Page>
      <PageHeader title={t("Documents")}
        description={t("Quotations, invoices, letters and proposals, written by you or by agents. Each is checked automatically, approved by a person, then exported to PDF, Word or Excel.")}
        actions={<Button data-guide="documents.new" onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New document")}</Button>} />
      <DocSteps current="/documents" />
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
      <Toolbar>
        <Segmented<Filter> label={t("Status")} value={status} onChange={setStatus}
          options={[
            { value: ALL, label: t("All"), count: stats?.total },
            { value: "review", label: t("In review"), count: count("review") },
            { value: "draft", label: t("Drafts"), count: count("draft") },
            { value: "approved", label: t("Approved"), count: count("approved") },
          ]} />
        <SearchInput value={q} onChange={setQ} placeholder={t("Search title or number")} />
        <Select value={branch} onValueChange={setBranch} label={t("Company")} className="sm:w-56"
          options={[{ value: ALL, label: t("All companies") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      </Toolbar>
      {isLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[68px]" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !docs.length ? (
          <EmptyState icon={FilesIcon} title={q || status !== ALL ? t("Nothing matches") : t("No documents yet")}
            body={t("Start from a template (quotation, invoice, letter, proposal…), let AI write a draft from a description, or ask an agent to prepare one.")}
            action={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> {t("New document")}</Button>} />
        ) : (
          <ListCard data-guide="documents.list">
            {docs.map((d) => <DocRow key={d.id} d={d} onOpen={() => navigate({ search: { d: d.id } })} />)}
          </ListCard>
        )}
      {docs.length || list.hasMore ? <LoadMore noun="documents" shown={docs.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} /> : null}
      {creating ? <NewDocumentDialog branchId={branch === ALL ? null : branch} onClose={() => setCreating(false)}
        onCreated={(id) => navigate({ search: { d: id } })} /> : null}
    </Page>
  );
}

function DocRow({ d, onOpen }: { d: DocSummary; onOpen: () => void }) {
  const t = useT();
  const s = STATUS_LABEL[d.status];
  return (
    <ListRow onClick={onOpen} leading={<KindTile kind={d.kind} />}
      title={<>{d.title}{d.number ? <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">{d.number}</span> : null}</>}
      meta={<Meta items={[
        d.agent_name ? <span className="inline-flex items-center gap-1"><RobotIcon size={13} weight="duotone" className="text-accent" />{d.agent_name}</span> : null,
        d.template_name ?? t("Free-form"),
        d.branch_name,
        t("updated {when}", { when: timeAgo(d.updated_at) }),
      ]} />}
      trailing={<>
        {d.errors ? <Pill tone="danger"><WarningCircleIcon size={12} weight="fill" /> {t("{n} to fix", { n: d.errors })}</Pill>
          : d.warnings ? <Pill tone="warn">{t("{n} to check", { n: d.warnings })}</Pill> : null}
        <Pill tone={s.tone}>{t(s.label)}</Pill>
      </>} />
  );
}

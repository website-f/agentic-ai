import { FilesIcon, PlusIcon, RobotIcon, SealCheckIcon, PencilSimpleLineIcon, WarningCircleIcon, EyeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { errorMessage } from "@/lib/api";
import { documentsQuery, STATUS_LABEL, type DocStatus, type DocSummary } from "@/lib/documents";
import { branchesQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { DocumentEditor } from "./editor";
import { NewDocumentDialog } from "./new-document";
import { DocSteps, KindTile } from "./visuals";

const ALL = "__all";
type Filter = DocStatus | typeof ALL | "fix";

export function DocumentsPage() {
  const search = useSearch({ from: "/app/documents" });
  const navigate = useNavigate({ from: "/documents" });
  const [status, setStatus] = useState<Filter>(ALL);
  const [branch, setBranch] = useState(ALL);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(!!search.new);
  const { data: branches = [] } = useQuery(branchesQuery);
  // One list per company/search; status is filtered here so every tab shows its count.
  const params: Record<string, string> = {};
  if (branch !== ALL) params.branch_id = branch;
  if (q.trim()) params.q = q.trim();
  const { data: all = [], isLoading, error } = useQuery({ ...documentsQuery(params), enabled: !search.d });

  if (search.d) {
    return <Page><DocumentEditor key={search.d} id={search.d} /></Page>;
  }

  const count = (s: DocStatus) => all.filter((d) => d.status === s).length;
  const fixing = all.filter((d) => d.errors > 0).length;
  const docs = all.filter((d) => (status === ALL ? true : status === "fix" ? d.errors > 0 : d.status === status));

  return (
    <Page>
      <PageHeader title="Documents"
        description="Quotations, invoices, letters and proposals, written by you or by agents. Each is checked automatically, approved by a person, then exported to PDF, Word or Excel."
        actions={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New document</Button>} />
      <DocSteps current="/documents" />
      <StatGrid>
        <Stat label="In review" value={count("review")} icon={EyeIcon} tone="info" hint="Waiting for a person"
          onClick={() => setStatus(status === "review" ? ALL : "review")} active={status === "review"} />
        <Stat label="Drafts" value={count("draft")} icon={PencilSimpleLineIcon} tone="neutral" hint="Still being written"
          onClick={() => setStatus(status === "draft" ? ALL : "draft")} active={status === "draft"} />
        <Stat label="Approved" value={count("approved")} icon={SealCheckIcon} tone="ok" hint="Ready to send"
          onClick={() => setStatus(status === "approved" ? ALL : "approved")} active={status === "approved"} />
        <Stat label="Needs fixing" value={fixing} icon={WarningCircleIcon} tone={fixing ? "danger" : "neutral"} hint="Failed a check"
          onClick={() => setStatus(status === "fix" ? ALL : "fix")} active={status === "fix"} />
      </StatGrid>
      <Toolbar>
        <Segmented<Filter> label="Status" value={status} onChange={setStatus}
          options={[
            { value: ALL, label: "All", count: all.length },
            { value: "review", label: "In review", count: count("review") },
            { value: "draft", label: "Drafts", count: count("draft") },
            { value: "approved", label: "Approved", count: count("approved") },
          ]} />
        <SearchInput value={q} onChange={setQ} placeholder="Search title or number" />
        <Select value={branch} onValueChange={setBranch} label="Company" className="sm:w-56"
          options={[{ value: ALL, label: "All companies" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      </Toolbar>
      {isLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[68px]" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !docs.length ? (
          <EmptyState icon={FilesIcon} title={q || status !== ALL ? "Nothing matches" : "No documents yet"}
            body="Start from a template (quotation, invoice, letter, proposal…), let AI write a draft from a description, or ask an agent to prepare one."
            action={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New document</Button>} />
        ) : (
          <ListCard>
            {docs.map((d) => <DocRow key={d.id} d={d} onOpen={() => navigate({ search: { d: d.id } })} />)}
          </ListCard>
        )}
      {creating ? <NewDocumentDialog branchId={branch === ALL ? null : branch} onClose={() => setCreating(false)}
        onCreated={(id) => navigate({ search: { d: id } })} /> : null}
    </Page>
  );
}

function DocRow({ d, onOpen }: { d: DocSummary; onOpen: () => void }) {
  const s = STATUS_LABEL[d.status];
  return (
    <ListRow onClick={onOpen} leading={<KindTile kind={d.kind} />}
      title={<>{d.title}{d.number ? <span className="ml-2 font-mono text-[11.5px] font-normal text-muted">{d.number}</span> : null}</>}
      meta={<Meta items={[
        d.agent_name ? <span className="inline-flex items-center gap-1"><RobotIcon size={13} weight="duotone" className="text-accent" />{d.agent_name}</span> : null,
        d.template_name ?? "Free-form",
        d.branch_name,
        `updated ${timeAgo(d.updated_at)}`,
      ]} />}
      trailing={<>
        {d.errors ? <Pill tone="danger"><WarningCircleIcon size={12} weight="fill" /> {d.errors} to fix</Pill>
          : d.warnings ? <Pill tone="warn">{d.warnings} to check</Pill> : null}
        <Pill tone={s.tone}>{s.label}</Pill>
      </>} />
  );
}

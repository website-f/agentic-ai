import { FilesIcon, MagnifyingGlassIcon, PlusIcon, RobotIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { documentsQuery, STATUS_LABEL, type DocStatus } from "@/lib/documents";
import { branchesQuery } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";
import { DocumentEditor } from "./editor";
import { NewDocumentDialog } from "./new-document";

const ALL = "__all";
const FILTERS: { id: DocStatus | typeof ALL; label: string }[] = [
  { id: ALL, label: "All" },
  { id: "review", label: "In review" },
  { id: "draft", label: "Drafts" },
  { id: "approved", label: "Approved" },
];

export function DocumentsPage() {
  const search = useSearch({ from: "/app/documents" });
  const navigate = useNavigate({ from: "/documents" });
  const [status, setStatus] = useState<DocStatus | typeof ALL>(ALL);
  const [branch, setBranch] = useState(ALL);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(!!search.new);
  const { data: branches = [] } = useQuery(branchesQuery);
  const params: Record<string, string> = {};
  if (status !== ALL) params.status = status;
  if (branch !== ALL) params.branch_id = branch;
  if (q.trim()) params.q = q.trim();
  const { data: docs = [], isLoading, error } = useQuery({ ...documentsQuery(params), enabled: !search.d });

  if (search.d) {
    return <Page><DocumentEditor key={search.d} id={search.d} /></Page>;
  }

  return (
    <Page>
      <PageHeader title="Documents"
        description="Step 3: quotations, invoices, letters and proposals — drafted by you or by agents, checked automatically, approved by a person, then exported to PDF, Word or Excel."
        actions={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New document</Button>} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-sm border border-border p-0.5" role="tablist" aria-label="Status">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={status === f.id} onClick={() => setStatus(f.id)}
              className={cn("rounded-[calc(var(--radius-sm)-2px)] px-3 py-1 text-[13px]", status === f.id ? "bg-accent text-accent-fg font-medium" : "text-muted hover:bg-surface-2")}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="relative min-w-0 flex-1 basis-48">
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or number" className="pl-9" aria-label="Search documents" />
        </label>
        <Select value={branch} onValueChange={setBranch} label="Company" className="w-52"
          options={[{ value: ALL, label: "All companies" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      </div>
      {isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !docs.length ? (
          <EmptyState icon={FilesIcon} title={q || status !== ALL ? "Nothing matches" : "No documents yet"}
            body="Start from a template (quotation, invoice, letter, proposal…), let AI write a draft from a description, or ask an agent to prepare one."
            action={<Button onClick={() => setCreating(true)}><PlusIcon size={16} weight="bold" /> New document</Button>} />
        ) : (
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
            {docs.map((d) => {
              const s = STATUS_LABEL[d.status];
              return (
                <li key={d.id}>
                  <button type="button" onClick={() => navigate({ search: { d: d.id } })}
                    className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60">
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[14px] font-medium">{d.title}</span>
                        {d.number ? <span className="shrink-0 text-[12px] text-muted">{d.number}</span> : null}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[12.5px] text-muted">
                        {d.agent_name ? <><RobotIcon size={13} /> {d.agent_name} ·</> : null}
                        {[d.template_name ?? "Free-form", d.branch_name, `updated ${timeAgo(d.updated_at)}`].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      {d.errors ? <Pill tone="danger"><WarningCircleIcon size={12} weight="fill" /> {d.errors}</Pill>
                        : d.warnings ? <Pill tone="warn">{d.warnings} to check</Pill> : null}
                      <Pill tone={s.tone}>{s.label}</Pill>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      {creating ? <NewDocumentDialog branchId={branch === ALL ? null : branch} onClose={() => setCreating(false)}
        onCreated={(id) => navigate({ search: { d: id } })} /> : null}
    </Page>
  );
}

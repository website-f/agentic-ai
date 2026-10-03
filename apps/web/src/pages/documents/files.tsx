import { ArrowClockwiseIcon, ArrowSquareOutIcon, DownloadSimpleIcon, FolderOpenIcon, HourglassMediumIcon, SparkleIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FileDrop, FileStatus } from "@/components/file-drop";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, errorMessage } from "@/lib/api";
import { docKeys, fileQuery, fileSize, filesQuery, fileUrl, type DocFile } from "@/lib/documents";
import { branchesQuery } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { DocSteps, FileTile } from "./visuals";

const ALL = "__all";
type Show = "all" | "upload" | "generated" | "expiring";

function daysUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 86_400_000;
}

function FileSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: f, error } = useQuery(fileQuery(id));
  const { data: branches = [] } = useQuery(branchesQuery);
  const [removing, setRemoving] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: docKeys.files });
  };
  const move = useMutation({
    mutationFn: (branch_id: string | null) => api<DocFile>(`/api/files/${id}`, "PATCH", { branch_id }),
    onSuccess: () => { refresh(); toast.success("Moved."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reread = useMutation({
    mutationFn: () => api<DocFile>(`/api/files/${id}/reread`, "POST"),
    onSuccess: () => { refresh(); toast.success("Reading it again."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api(`/api/files/${id}`, "DELETE"),
    onSuccess: () => { refresh(); toast.success("File deleted."); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const viewable = f && (f.mime === "application/pdf" || f.mime.startsWith("image/"));

  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} wide
      title={f ? <span className="flex min-w-0 items-center gap-3"><FileTile mime={f.mime} name={f.name} size="sm" /><span className="min-w-0 break-words">{f.title || f.name}</span></span> : "File"}
      description={f ? [f.kind, f.pages ? `${f.pages} page${f.pages > 1 ? "s" : ""}` : "", fileSize(f.size), f.ocr ? "read with OCR" : ""].filter(Boolean).join(" · ") : undefined}
      actions={f ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" asChild><a href={fileUrl(f.id)}><DownloadSimpleIcon size={14} /> Download</a></Button>
          {viewable ? <Button size="sm" variant="outline" asChild><a href={fileUrl(f.id, true)} target="_blank" rel="noreferrer"><ArrowSquareOutIcon size={14} /> Open</a></Button> : null}
          {f.source === "upload" ? <Button size="sm" variant="ghost" loading={reread.isPending} onClick={() => reread.mutate()}><ArrowClockwiseIcon size={14} /> Read again</Button> : null}
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(true)}><TrashIcon size={14} /> Delete</Button>
        </div>
      ) : null}>
      {error ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : !f ? <Skeleton className="h-40" /> : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <FileStatus f={f} />
            {f.source === "generated" ? <Pill tone="accent">Generated</Pill> : null}
            <span className="text-[12.5px] text-muted">{f.name} · added {timeAgo(f.created_at)}</span>
          </div>
          {f.error && f.status !== "reading" ? <p className="rounded-sm bg-warn/10 px-3 py-2 text-[13px] text-warn">{f.error}</p> : null}
          <section className="grid gap-1.5">
            <h3 className="text-[13px] font-semibold">What it is</h3>
            <p className="text-[13.5px] leading-relaxed">{f.status === "reading" ? "Reading the file…" : f.summary || "No summary (no AI model was available when it was read)."}</p>
          </section>
          {Object.keys(f.fields).length ? (
            <section className="grid gap-1.5">
              <h3 className="text-[13px] font-semibold">Key facts</h3>
              <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3 text-[13px] sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)] sm:gap-y-1.5 max-sm:[&_dd]:mb-1.5">
                {Object.entries(f.fields).map(([k, v]) => (
                  <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="break-words">{v}</dd></div>
                ))}
                {f.expires_on ? <div className="contents"><dt className="text-muted">Valid until</dt><dd className={f.expired ? "font-medium text-danger" : ""}>{f.expires_on}{f.expired ? " (expired)" : ""}</dd></div> : null}
              </dl>
            </section>
          ) : null}
          <div className="grid gap-1.5 sm:max-w-xs">
            <span className="text-[13px] font-semibold">Company</span>
            <Select value={f.branch_id ?? ALL} onValueChange={(v) => move.mutate(v === ALL ? null : v)} label="Company"
              options={[{ value: ALL, label: "All companies (shared)" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          </div>
          <section className="grid gap-1.5">
            <h3 className="text-[13px] font-semibold">Text agents read {f.text_length ? <span className="font-normal text-muted">({f.text_length.toLocaleString()} characters)</span> : null}</h3>
            <pre className="max-h-[50dvh] overflow-auto rounded-[var(--radius-md)] border border-border bg-surface-2/50 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
              {f.text?.trim() || (f.status === "reading" ? "…" : "No text could be read.")}
            </pre>
          </section>
        </div>
      )}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title="Delete this file?" danger confirmLabel="Delete"
        body="Agents can no longer read it, and packs that use it will show it as missing." onConfirm={async () => { await del.mutateAsync(); }} />
    </SideSheet>
  );
}

export function FilesPage() {
  const search = useSearch({ from: "/app/files" });
  const navigate = useNavigate({ from: "/files" });
  const [branch, setBranch] = useState(ALL);
  const [q, setQ] = useState("");
  const [show, setShow] = useState<Show>("all");
  const { data: branches = [] } = useQuery(branchesQuery);
  const params: Record<string, string> = {};
  if (branch !== ALL) params.branch_id = branch;
  if (q.trim()) params.q = q.trim();
  const { data: all = [], isLoading, error } = useQuery(filesQuery(params));
  const open = (id?: string) => navigate({ search: { f: id } });

  const soon = (f: DocFile) => f.expired || (!!f.expires_on && daysUntil(f.expires_on) < 60);
  const counts = {
    upload: all.filter((f) => f.source === "upload").length,
    generated: all.filter((f) => f.source === "generated").length,
    expiring: all.filter(soon).length,
    reading: all.filter((f) => f.status === "reading").length,
  };
  const files = all.filter((f) =>
    show === "all" ? true : show === "expiring" ? soon(f) : f.source === show,
  );

  return (
    <Page>
      <PageHeader title="Files"
        description="Everything your companies hand the office: certificates, statements, letters, forms and photos. Each file is read once (scans too) and summarised, so agents work from it without re-reading." />
      <DocSteps current="/files" />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <FileDrop branchId={branch === ALL ? null : branch} onUploaded={(fs) => fs.length === 1 && open(fs[0]!.id)} />
        <StatGrid className="grid-cols-2 lg:grid-cols-2">
          <Stat label="Uploaded" value={counts.upload} icon={FolderOpenIcon} hint={counts.reading ? `${counts.reading} being read now` : "Read and summarised"}
            onClick={() => setShow(show === "upload" ? "all" : "upload")} active={show === "upload"} />
          <Stat label="Made by the office" value={counts.generated} icon={SparkleIcon} tone="violet" hint="Exports, packs, agent output"
            onClick={() => setShow(show === "generated" ? "all" : "generated")} active={show === "generated"} />
          <Stat label="Expiring or expired" value={counts.expiring} icon={HourglassMediumIcon} tone={counts.expiring ? "warn" : "neutral"}
            hint="Within 60 days" onClick={() => setShow(show === "expiring" ? "all" : "expiring")} active={show === "expiring"}
            className="col-span-2" />
        </StatGrid>
      </div>
      <Toolbar>
        <Segmented<Show> label="Show" value={show} onChange={setShow}
          options={[
            { value: "all", label: "All", count: all.length },
            { value: "upload", label: "Uploaded", count: counts.upload },
            { value: "generated", label: "Generated", count: counts.generated },
            { value: "expiring", label: "Expiring", count: counts.expiring },
          ]} />
        <SearchInput value={q} onChange={setQ} placeholder="Search by name or type" />
        <Select value={branch} onValueChange={setBranch} label="Company" className="sm:w-56"
          options={[{ value: ALL, label: "All companies" }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
      </Toolbar>
      {isLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}</div>
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !files.length ? (
          <EmptyState icon={FolderOpenIcon} title={q || show !== "all" ? "No files match" : "No files yet"}
            body="Drop the documents a company keeps on hand: registration certificate, bank statements, licences, company profile. Agents use them to prepare documents and packs." />
        ) : (
          <ListCard>
            {files.map((f) => (
              <ListRow key={f.id} onClick={() => open(f.id)} active={search.f === f.id}
                leading={<FileTile mime={f.mime} name={f.name} />}
                title={f.title || f.name}
                meta={<Meta items={[f.kind, f.branch_name ?? "All companies", fileSize(f.size), timeAgo(f.created_at)]} />}
                trailing={<>
                  <FileStatus f={f} />
                  {f.source === "generated" ? <Pill tone="accent">Generated</Pill> : null}
                </>}>
                {f.summary ? <span className="line-clamp-2 text-[12.5px] text-muted/90">{f.summary}</span> : null}
              </ListRow>
            ))}
          </ListCard>
        )}
      {search.f ? <FileSheet id={search.f} onClose={() => open(undefined)} /> : null}
    </Page>
  );
}

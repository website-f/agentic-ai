/** P25: show who made a document or file (an AI agent, a person, an upload), where it came
 * from (task, workflow run) and its review, and let people approve or send back what agents
 * made. Shared by Company files, Documents, the task sheet and the home page. */
import {
  ArrowCounterClockwiseIcon, ArrowRightIcon, ArrowSquareOutIcon, CloudArrowUpIcon, FilePdfIcon, FlowArrowIcon,
  GlobeIcon, ListChecksIcon, RobotIcon, SealCheckIcon, SparkleIcon, UserIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { docKeys, fileQuery, siteOf, type DocFile, type DocSummary } from "@/lib/documents";
import {
  approveDocument, docOrigin, fileOrigin, REVIEW_LABEL, reviewCountQuery, sendBackDocument,
  type DocProvenance, type FileProvenance, type ReviewedDoc, type ReviewStatus,
} from "@/lib/provenance";
import { keys } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

// ---------------------------------------------------------------- pills

/** "AI · Aina" with the agent's face, "Uploaded", or "Made by a person". */
export function MadeBy({ origin, agentName, agentColor, size = "md" }: {
  origin: "agent" | "person" | "uploaded";
  agentName?: string | null;
  agentColor?: string | null;
  size?: "sm" | "md";
}) {
  const t = useT();
  const small = size === "sm";
  if (origin === "agent") {
    return (
      <Pill tone="accent" className={cn("max-w-full min-w-0", small && "px-2")} title={agentName ? t("Made by {name}, an AI agent", { name: agentName }) : t("Made by AI")}>
        {agentName ? <AgentAvatar name={agentName} color={agentColor ?? "var(--accent)"} size="xs" className="-ml-1.5 size-4 text-[8px]" /> : <RobotIcon size={12} weight="bold" />}
        <span className="truncate">{agentName ? t("AI · {name}", { name: agentName }) : t("Made by AI")}</span>
      </Pill>
    );
  }
  if (origin === "uploaded") return <Pill className={cn(small && "px-2")}><CloudArrowUpIcon size={12} weight="bold" /> {t("Uploaded")}</Pill>;
  return <Pill className={cn(small && "px-2")}><UserIcon size={12} weight="bold" /> {t("Made by a person")}</Pill>;
}

export function ReviewPill({ status }: { status: ReviewStatus | null | undefined }) {
  const t = useT();
  if (!status) return null;
  const s = REVIEW_LABEL[status];
  return <Pill tone={s.tone}>{status === "approved" ? <SealCheckIcon size={12} weight="fill" /> : null}{t(s.label)}</Pill>;
}

/** Links to the task and the workflow run something came from. */
export function WorkLinks({ taskId, taskTitle, runId, runTitle, className }: {
  taskId?: string | null;
  taskTitle?: string | null;
  runId?: string | null;
  runTitle?: string | null;
  className?: string;
}) {
  const t = useT();
  if (!taskId && !runId) return null;
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1", className)}>
      {taskId ? (
        <Link to="/tasks" search={{ task: taskId }} onClick={(e) => e.stopPropagation()}
          className="inline-flex min-w-0 items-center gap-1 text-accent underline-offset-2 hover:underline">
          <ListChecksIcon size={13} className="shrink-0" /><span className="truncate">{taskTitle ? t("Task: {title}", { title: taskTitle }) : t("Open the task")}</span>
        </Link>
      ) : null}
      {runId ? (
        <Link to="/workflows" search={{ run: runId }} onClick={(e) => e.stopPropagation()}
          className="inline-flex min-w-0 items-center gap-1 text-accent underline-offset-2 hover:underline">
          <FlowArrowIcon size={13} className="shrink-0" /><span className="truncate">{runTitle ? t("Workflow: {title}", { title: runTitle }) : t("Open the workflow run")}</span>
        </Link>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------- a file's provenance (viewer)

/** Who made the open file and where it came from. Shown above the file viewer. */
export function FileProvenanceCard({ fileId }: { fileId: string }) {
  const t = useT();
  const { data } = useQuery(fileQuery(fileId));
  const f = data as (DocFile & FileProvenance) | undefined;
  if (!f) return null;
  const origin = fileOrigin(f);
  // A file an agent fetched from a website: outside content, not something AI wrote.
  const fetched = f.source === "download";
  const site = fetched ? siteOf(f.source_path) : "";
  const what = fetched
    ? (f.agent_name
      ? t("{name} downloaded it from {site}.", { name: f.agent_name, site: site || t("a website") })
      : t("An agent downloaded it from {site}.", { site: site || t("a website") }))
    : origin === "agent"
      ? (f.agent_name ? t("Made by {name}, an AI agent.", { name: f.agent_name }) : t("Made by an AI agent."))
      : origin === "person" ? t("Made in the office by a person (for example a compiled pack).") : t("Uploaded by a person.");
  return (
    <section data-guide="files.provenance" aria-label={t("Where it came from")}
      className={cn("grid gap-2 rounded-[var(--radius-md)] border p-3", origin === "agent" ? "border-accent/30 bg-accent-soft/35" : "border-border bg-surface-2/30")}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {fetched ? <Pill tone="info"><GlobeIcon size={12} weight="bold" /> {t("Downloaded")}</Pill>
          : <MadeBy origin={origin} agentName={f.agent_name} agentColor={f.agent_color} />}
        <ReviewPill status={f.review_status} />
        <span className="text-[12.5px] text-muted">{what}</span>
      </div>
      {f.task_id || f.workflow_run_id || f.document_id ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
          <WorkLinks taskId={f.task_id} taskTitle={f.task_title} runId={f.workflow_run_id} runTitle={f.workflow_run_title} />
          {f.document_id ? (
            <Link to="/documents" search={{ d: f.document_id }} className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
              <ArrowSquareOutIcon size={13} /> {f.review_status === "waiting" ? t("Review it in Documents") : t("Open in Documents")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {origin === "agent" && f.document_id ? (
        <p className="text-[12px] text-muted">{t("This file is the saved copy of the document. A new version replaces it; Documents keeps every version.")}</p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- review actions

function useRefreshDocs() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: docKeys.documents });
    void qc.invalidateQueries({ queryKey: docKeys.files });
    void qc.invalidateQueries({ queryKey: keys.status });
  };
}

export function SendBackDialog({ doc, open, onOpenChange, onDone }: {
  doc: Pick<DocSummary, "id" | "title" | "agent_name">;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onDone?: (d: DocProvenance) => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const refresh = useRefreshDocs();
  const send = useMutation({
    mutationFn: () => sendBackDocument(doc.id, note.trim()),
    onSuccess: (d) => {
      refresh();
      setNote("");
      onOpenChange(false);
      toast.success(doc.agent_name ? tr("Sent back to {name}. It comes back for review once revised.", { name: doc.agent_name }) : tr("Sent back."));
      onDone?.(d);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Send back to the agent")}
      description={doc.agent_name ? t("Tell {name} what to change in {title}.", { name: doc.agent_name, title: doc.title }) : t("Say what to change.")}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (note.trim().length >= 3) send.mutate(); }}>
        <label className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("What should change?")}</span>
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={1000}
            placeholder={t("e.g. Use 3 guards instead of 2, and add the site address.")}
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
        </label>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button type="submit" loading={send.isPending} disabled={note.trim().length < 3}><ArrowCounterClockwiseIcon size={15} /> {t("Send back")}</Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}

/** Approve / Send back / Open for one document an agent made. */
export function ReviewActions({ doc, canApprove, canWrite, onOpen, size = "sm" }: {
  doc: ReviewedDoc;
  canApprove: boolean;
  canWrite: boolean;
  onOpen?: () => void;
  size?: "sm" | "md";
}) {
  const t = useT();
  const refresh = useRefreshDocs();
  const [sending, setSending] = useState(false);
  const approve = useMutation({
    mutationFn: () => approveDocument(doc.id),
    onSuccess: () => { refresh(); toast.success(tr("Approved — it is locked now.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const btn = size === "sm" ? "sm" : "md";
  return (
    <span className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {canApprove && doc.status !== "approved" ? (
        <Button size={btn} loading={approve.isPending} disabled={doc.errors > 0} title={doc.errors ? t("Fix the checks first") : undefined} onClick={() => approve.mutate()}>
          <SealCheckIcon size={14} /> {t("Approve")}
        </Button>
      ) : null}
      {canWrite && docOrigin(doc) === "agent" && doc.status !== "approved" && doc.review_status !== "sent_back" ? (
        <Button size={btn} variant="outline" onClick={() => setSending(true)}><ArrowCounterClockwiseIcon size={14} /> {t("Send back")}</Button>
      ) : null}
      {onOpen ? <Button size={btn} variant="ghost" onClick={onOpen}><ArrowSquareOutIcon size={14} /> {t("Open|verb")}</Button> : null}
      <SendBackDialog doc={doc} open={sending} onOpenChange={setSending} />
    </span>
  );
}

/** In the document editor: who made it, from where, and where the review stands. */
export function DocReviewBanner({ doc, canWrite }: { doc: DocSummary & DocProvenance; canWrite: boolean }) {
  const t = useT();
  const [sending, setSending] = useState(false);
  const origin = docOrigin(doc);
  const status = doc.review_status ?? (doc.status === "review" ? "waiting" : doc.status === "approved" ? "approved" : "draft");
  if (origin !== "agent" && !doc.review_note) return null;
  const pdf = doc.files?.find((f) => f.format === "pdf") ?? doc.files?.[0];
  return (
    <section aria-label={t("Where it came from")} data-guide="documents.provenance"
      className={cn("grid gap-2 rounded-[var(--radius-md)] border px-3.5 py-3", status === "sent_back" ? "border-warn/30 bg-warn/6" : status === "waiting" ? "border-info/30 bg-info/6" : "border-border bg-surface-2/30")}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <MadeBy origin={origin} agentName={doc.agent_name} agentColor={doc.agent_color} />
        <ReviewPill status={status} />
        <span className="min-w-0 text-[13px]">
          {status === "waiting" ? t("An AI agent made this. A person checks it before it goes anywhere.")
            : status === "sent_back" ? t("Sent back with a note. The agent revises it and it comes back here.")
            : status === "approved" ? (doc.reviewed_by_name ? t("Approved by {name}.", { name: doc.reviewed_by_name }) : t("Approved."))
            : t("Still a draft.")}
        </span>
        {canWrite && origin === "agent" && doc.status !== "approved" && status !== "sent_back" ? (
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => setSending(true)}><ArrowCounterClockwiseIcon size={14} /> {t("Send back")}</Button>
        ) : null}
      </div>
      {doc.review_note ? (
        <p className="text-[12.5px] break-words text-muted">
          {doc.reviewed_by_name ? t("Note from {name}: {note}", { name: doc.reviewed_by_name, note: doc.review_note }) : t("Note: {note}", { note: doc.review_note })}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <WorkLinks taskId={doc.task_id} taskTitle={doc.task_title} runId={doc.workflow_run_id} runTitle={doc.workflow_run_title} />
        {doc.revision_task_id && doc.revision_task_id !== doc.task_id ? (
          <Link to="/tasks" search={{ task: doc.revision_task_id }} className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
            <ArrowCounterClockwiseIcon size={13} /> {t("Revision task")}
          </Link>
        ) : null}
        {pdf ? (
          <Link to="/files" search={{ f: pdf.id }} className="inline-flex min-w-0 items-center gap-1 text-accent underline-offset-2 hover:underline">
            <FilePdfIcon size={13} className="shrink-0" /><span className="truncate">{t("Saved in {folder}", { folder: pdf.folder })}</span>
          </Link>
        ) : null}
      </div>
      <SendBackDialog doc={doc} open={sending} onOpenChange={setSending} />
    </section>
  );
}

// ---------------------------------------------------------------- the task sheet

/** Documents and files the agent made in this task. */
export function TaskDocuments({ taskId, title, icon }: { taskId: string; title: (n: number) => ReactNode; icon?: ReactNode }) {
  const t = useT();
  const docs = useQuery({
    queryKey: [...docKeys.documents, { task_id: taskId }],
    queryFn: () => api<ReviewedDoc[]>(`/api/documents?${new URLSearchParams({ task_id: taskId, limit: "50" })}`),
  });
  const files = useQuery({
    queryKey: [...docKeys.files, { task_id: taskId, source: "generated" }],
    queryFn: () => api<(DocFile & FileProvenance)[]>(`/api/files?${new URLSearchParams({ task_id: taskId, source: "generated", limit: "50" })}`),
  });
  // What its agent fetched from websites (tender documents, an offer printout).
  const fetched = useQuery({
    queryKey: [...docKeys.files, { task_id: taskId, source: "download" }],
    queryFn: () => api<(DocFile & FileProvenance)[]>(`/api/files?${new URLSearchParams({ task_id: taskId, source: "download", limit: "50" })}`),
  });
  // A document's own saved copies are listed under it, not again as files.
  const loose = (files.data ?? []).filter((f) => !f.document_id);
  const downloads = fetched.data ?? [];
  const n = (docs.data?.length ?? 0) + loose.length;
  if (docs.isLoading || files.isLoading) return <Skeleton className="h-14 rounded-[var(--radius-md)]" />;
  if (!n && !downloads.length) return null;
  return (
    <section className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2.5" data-guide="tasks.documents">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h3 className="flex min-w-0 flex-wrap items-center gap-x-2 text-[13px] font-semibold">{icon}{title(n)}</h3>
        <Link to="/files" search={{ view: "tasks", task: taskId }} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
          {t("Every file of this task")} <ArrowRightIcon size={13} />
        </Link>
      </div>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {(docs.data ?? []).map((d) => {
          const pdf = d.files?.find((f) => f.format === "pdf");
          return (
            <li key={d.id} className="grid min-w-0 gap-1 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5">
              <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <Link to="/documents" search={{ d: d.id }} className="min-w-0 text-[13px] font-medium break-words text-fg hover:text-accent">
                  {d.title}{d.number ? <span className="ml-1.5 font-mono text-[11.5px] font-normal text-muted">{d.number}</span> : null}
                </Link>
                <ReviewPill status={d.review_status ?? (d.status === "review" ? "waiting" : d.status === "approved" ? "approved" : "draft")} />
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
                <MadeBy origin={docOrigin(d)} agentName={d.agent_name} agentColor={d.agent_color} size="sm" />
                {pdf ? <Link to="/files" search={{ f: pdf.id }} className="inline-flex items-center gap-1 text-accent hover:underline"><FilePdfIcon size={13} /> {t("PDF in Files")}</Link> : null}
                <span>{t("updated {when}", { when: timeAgo(d.updated_at) })}</span>
              </span>
            </li>
          );
        })}
        {loose.map((f) => (
          <li key={f.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5">
            <Link to="/files" search={{ f: f.id }} className="min-w-0 text-[13px] font-medium break-words text-fg hover:text-accent">{f.title || f.name}</Link>
            <span className="text-[12px] text-muted">{f.folder || t("Top level")}</span>
          </li>
        ))}
      </ul>
      {downloads.length ? (
        <>
          <h4 className="flex items-center gap-1.5 pt-1 text-[12.5px] font-semibold text-muted"><GlobeIcon size={14} /> {t("Downloaded from websites")} <span className="font-normal tabular">{downloads.length}</span></h4>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {downloads.map((f) => (
              <li key={f.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3.5 py-2.5">
                <Link to="/files" search={{ f: f.id, view: "tasks", task: taskId }} className="min-w-0 text-[13px] font-medium break-words text-fg hover:text-accent">{f.title || f.name}</Link>
                <span className="text-[12px] text-muted">{timeAgo(f.created_at)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- the home card

/** "AI made N documents this week · M waiting for review", linking to the queue. */
export function AiWorkCard() {
  const t = useT();
  const { data, isLoading } = useQuery(reviewCountQuery);
  if (isLoading) return <Skeleton className="h-[92px] rounded-[var(--radius-md)]" />;
  if (!data) return null;
  const made = data.made_week + data.files_week;
  return (
    <Card data-guide="home.ai-work" className="overflow-hidden">
      <CardHeader icon={<IconTile icon={SparkleIcon} tone="accent" size="sm" />}
        title={made === 1 ? t("AI made 1 document this week") : t("AI made {n} documents this week", { n: made })}
        description={data.waiting
          ? (data.waiting === 1 ? t("1 waiting for your review") : t("{n} waiting for your review", { n: data.waiting }))
          : t("Nothing waiting for review")}
        actions={
          <Button size="sm" variant={data.waiting ? "primary" : "outline"} asChild>
            <Link to="/documents" search={{ view: "review" }}>{data.waiting ? t("Review now") : t("See what AI made")} <ArrowRightIcon size={14} /></Link>
          </Button>
        } />
      {data.sent_back ? (
        <p className="px-4 py-2.5 text-[12.5px] text-muted sm:px-5">
          {data.sent_back === 1 ? t("1 sent back, being revised by its agent.") : t("{n} sent back, being revised by their agents.", { n: data.sent_back })}
        </p>
      ) : null}
    </Card>
  );
}



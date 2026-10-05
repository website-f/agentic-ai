/** Drop files (or click to choose) to upload them; each is read in the background. */
import { CloudArrowUpIcon, FileIcon, FilePdfIcon, FileDocIcon, FileXlsIcon, ImageIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys, fileSize, filesQuery, MAX_UPLOAD_MB, uploadFile, type DocFile } from "@/lib/documents";
import { cn, timeAgo } from "@/lib/utils";

export function FileGlyph({ mime, size = 18 }: { mime: string; size?: number }) {
  if (mime === "application/pdf") return <FilePdfIcon size={size} weight="duotone" className="text-danger" />;
  if (mime.includes("wordprocessingml")) return <FileDocIcon size={size} weight="duotone" className="text-info" />;
  if (mime.includes("spreadsheetml") || mime === "text/csv") return <FileXlsIcon size={size} weight="duotone" className="text-ok" />;
  if (mime.startsWith("image/")) return <ImageIcon size={size} weight="duotone" className="text-warn" />;
  return <FileIcon size={size} weight="duotone" className="text-muted" />;
}

function daysUntil(iso: string, now: number = Date.now()): number {
  return (new Date(iso).getTime() - now) / 86_400_000;
}

export function FileStatus({ f }: { f: Pick<DocFile, "status" | "expired" | "expires_on" | "error"> }) {
  const t = useT();
  if (f.status === "reading") return <Pill tone="info" live>{t("Reading…")}</Pill>;
  if (f.status === "failed") return <Pill tone="danger" title={f.error ?? undefined}>{t("Could not read")}</Pill>;
  if (f.expired) return <Pill tone="danger">{t("Expired")}</Pill>;
  if (f.expires_on) {
    const days = daysUntil(f.expires_on);
    if (days < 60) return <Pill tone="warn">{t("Expires in {n}d", { n: Math.max(0, Math.round(days)) })}</Pill>;
  }
  return null;
}

export function FileDrop({ branchId, taskId, onUploaded, compact, className, guide }: {
  branchId?: string | null;
  taskId?: string | null;
  onUploaded?: (files: DocFile[]) => void;
  compact?: boolean;
  className?: string;
  /** data-guide id for the Guide's screenshots. */
  guide?: string;
}) {
  const t = useT();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(0);

  const send = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    setBusy(files.length);
    const done: DocFile[] = [];
    for (const f of files) {
      try {
        done.push(await uploadFile(f, { branch_id: branchId, task_id: taskId }));
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
      setBusy((n) => n - 1);
    }
    qc.invalidateQueries({ queryKey: docKeys.files });
    if (done.length) {
      toast.success(done.length === 1 ? t("{name} uploaded. Reading it now.", { name: done[0]!.name }) : t("{n} files uploaded. Reading them now.", { n: done.length }));
      onUploaded?.(done);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void send(e.dataTransfer.files);
  };

  return (
    <div
      data-guide={guide}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        "grid place-items-center rounded-[var(--radius-md)] border-2 border-dashed text-center transition-colors",
        over ? "border-accent bg-accent-soft" : "border-border bg-surface-2/40",
        compact ? "px-4 py-4" : "px-6 py-8",
        className,
      )}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) void send(e.target.files); e.target.value = ""; }} />
      <div className="grid justify-items-center gap-2">
        <CloudArrowUpIcon size={compact ? 22 : 30} weight="duotone" className="text-accent" />
        <p className="text-[13.5px] font-medium">{busy ? (busy > 1 ? t("Uploading {n} files…", { n: busy }) : t("Uploading 1 file…")) : t("Drop files here")}</p>
        {!compact ? (
          <p className="max-w-md text-[12.5px] text-muted">
            {t("PDFs, Word, Excel, CSV, or photos of documents (up to {mb} MB). Each one is read once (scans included) and summarised, so agents can use it without re-reading.", { mb: MAX_UPLOAD_MB })}
          </p>
        ) : null}
        <Button size="sm" variant="outline" loading={busy > 0} onClick={() => input.current?.click()}>{t("Choose files")}</Button>
      </div>
    </div>
  );
}

/** Pick one of the company's files, or upload a new one right here. */
export function FilePicker({ open, onOpenChange, branchId, onPick, title, filter }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId?: string | null;
  onPick: (f: DocFile) => void;
  title?: string;
  filter?: (f: DocFile) => boolean;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const params: Record<string, string> = { source: "upload" };
  if (branchId) params.branch_id = branchId;
  if (q.trim()) params.q = q.trim();
  const { data: files = [], isLoading } = useQuery(filesQuery(params));
  const shown = filter ? files.filter(filter) : files;
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title ?? t("Choose a file")} className="w-[min(96vw,40rem)]"
      description={t("Your company's files. Upload a new one if it is not here yet.")}>
      <div className="grid gap-3">
        <FileDrop compact branchId={branchId} onUploaded={(fs) => { onPick(fs[0]!); onOpenChange(false); }} />
        <label className="relative">
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search files")} className="pl-9" aria-label={t("Search files")} />
        </label>
        <ul className="grid max-h-[46dvh] gap-1 overflow-y-auto">
          {isLoading ? <li className="px-2 py-3 text-[13px] text-muted">{t("Loading…")}</li>
            : !shown.length ? <li className="px-2 py-3 text-[13px] text-muted">{q ? t("No files match.") : t("No files yet.")}</li>
            : shown.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => { onPick(f); onOpenChange(false); }}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-surface-2">
                  <FileGlyph mime={f.mime} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{f.title || f.name}</span>
                    <span className="block truncate text-[12px] text-muted">{[f.kind, fileSize(f.size), timeAgo(f.created_at)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <FileStatus f={f} />
                </button>
              </li>
            ))}
        </ul>
      </div>
    </ResponsiveDialog>
  );
}

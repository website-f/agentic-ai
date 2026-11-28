/** Company files: the big drop zone (files, folders, zips), per-file upload progress, then each
 * upload's processing progress and its report (what was found, what was held back, what the
 * AI suggests building). */
import {
  ArrowSquareOutIcon, BooksIcon, CaretDownIcon, CheckCircleIcon, CloudArrowUpIcon, DownloadSimpleIcon, FileIcon, FileZipIcon,
  FolderOpenIcon, ShieldWarningIcon, SkipForwardIcon, WarningIcon, XIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useImperativeHandle, useRef, useState, type DragEvent, type Ref } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { locale, msg, t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { fileSize } from "@/lib/documents";
import {
  ACCEPT, archiveUrl, filesFromDrop, filesFromInput, flagWords, intakeBatchQuery, intakeKeys, INTAKE_ACTIVE, isJunk, kindKey, kindLabel, notThere,
  uploadIntake, uploadPlain, type IntakeBatch, type IntakeStatus, type PickedFile,
} from "@/lib/intake";
import type { Branch } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

import { IntakeSuggestions } from "@/components/doc-builders";
import { KeywordInput } from "@/components/file-keywords";
import { SwitchField } from "@/components/ui/switch";
import { folderGroups, previewSort } from "@/lib/organize";
import { KindTile } from "./visuals";

const AUTO = "__auto";
/** Files sent at once after the first (which creates the batch). */
const PARALLEL = 3;

type ItemState = "waiting" | "sending" | "sent" | "failed";

interface Item {
  key: string;
  path: string;
  size: number;
  zip: boolean;
  progress: number;
  state: ItemState;
  error?: string;
}

function Bar({ value, tone = "accent", className, label }: { value: number; tone?: "accent" | "ok" | "danger"; className?: string; label?: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div className={cn("h-full rounded-full transition-[width] duration-300", tone === "ok" ? "bg-ok" : tone === "danger" ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Drop or choose files, folders or a zip; they go to the company's documents as one upload. */
/** Start an upload from outside the drop zone (P61: files dropped on a folder in the explorer). */
export interface IntakeDropHandle {
  upload: (files: PickedFile[], folder: string) => void;
}

export function IntakeDrop({ branch, folder, department, onBatch, ref }: {
  branch: Branch;
  /** The folder being browsed: uploads go into it ("" or absent: the top). */
  folder?: string;
  /** P143b: a Library unit: every file goes to this department (no AI pick), named as the unit. */
  department?: { id: string; name: string } | null;
  onBatch: (batchId: string) => void;
  ref?: Ref<IntakeDropHandle>;
}) {
  const t = useT();
  const qc = useQueryClient();
  const pickFiles = useRef<HTMLInputElement>(null);
  const pickFolder = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [over, setOver] = useState(false);
  const [dept, setDept] = useState(AUTO);
  const [items, setItems] = useState<Item[]>([]);
  const [running, setRunning] = useState(false);
  // P149c: picked files wait here first: keywords for all of them, and sorting into folders.
  const [staged, setStaged] = useState<{ files: PickedFile[]; into: string } | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [autoSort, setAutoSort] = useState<boolean | null>(null); // null: the place's default

  const update = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const stage = (picked: PickedFile[], into: string | undefined = folder) => {
    const files = picked.filter((p) => !isJunk(p) && p.file.size > 0);
    if (!files.length) {
      toast.error(tr("Nothing to upload: the folder is empty."));
      return;
    }
    if (running) return;
    setStaged({ files, into: into ?? "" });
  };

  const run = async (files: PickedFile[], into: string | undefined, opts: { keywords: string[]; auto: boolean }) => {
    if (running || !files.length) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    setItems(files.map((p, i) => ({ key: `${i}:${p.path}`, path: p.path, size: p.file.size, zip: /\.zip$/i.test(p.path), progress: 0, state: "waiting" })));
    let batch: string | null = null;
    let plain = false;
    let sent = 0;
    const one = async (i: number) => {
      const p = files[i]!;
      update(i, { state: "sending" });
      const params = {
        branch_id: branch.id, name: p.path, department_id: department?.id ?? (dept === AUTO ? null : dept), batch, folder: into || null,
        keywords: opts.keywords, auto_sort: opts.auto && !into,
      };
      const progress = (f: number) => update(i, { progress: f });
      try {
        if (!plain) {
          try {
            const b: IntakeBatch = await uploadIntake(p.file, params, progress, ctrl.signal);
            batch ??= b.id;
          } catch (e) {
            if (!notThere(e)) throw e;
            plain = true; // this server has no intake yet: keep the files, one by one
            await uploadPlain(p.file, params, progress, ctrl.signal);
          }
        } else {
          await uploadPlain(p.file, params, progress, ctrl.signal);
        }
        sent += 1;
        update(i, { state: "sent", progress: 1 });
      } catch (e) {
        update(i, { state: "failed", error: errorMessage(e) });
      }
    };
    let next = 0;
    // The first file creates the upload; the rest join it, a few at a time.
    while (next < files.length && !batch && !plain && !ctrl.signal.aborted) await one(next++);
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        while (next < files.length && !ctrl.signal.aborted) await one(next++);
      }),
    );
    setRunning(false);
    abort.current = null;
    void qc.invalidateQueries({ queryKey: ["files"] });
    void qc.invalidateQueries({ queryKey: intakeKeys.all });
    if (ctrl.signal.aborted) toast(tr("Upload stopped. {n} sent.", { n: sent }));
    else if (sent === files.length) toast.success(files.length === 1 ? tr("Uploaded. Reading and sorting it now.") : tr("{n} files uploaded. Reading and sorting them now.", { n: sent }));
    else toast.error(tr("{n} of {total} files could not be uploaded.", { n: files.length - sent, total: files.length }));
    if (batch) onBatch(batch);
    if (sent === files.length) setTimeout(() => setItems([]), 1200);
  };

  useImperativeHandle(ref, () => ({ upload: (files, into) => stage(files, into) }));

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    try {
      stage(await filesFromDrop(e.dataTransfer));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const confirm = (auto: boolean) => {
    if (!staged) return;
    const { files, into } = staged;
    setStaged(null);
    void run(files, into, { keywords, auto });
    setKeywords([]);
    setAutoSort(null);
  };

  const total = items.length;
  const done = items.filter((x) => x.state === "sent").length;
  const failed = items.filter((x) => x.state === "failed").length;
  const bytes = items.reduce((n, x) => n + x.size, 0);
  const sentBytes = items.reduce((n, x) => n + x.size * x.progress, 0);

  return (
    <section data-guide="files.upload" className="grid gap-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => void onDrop(e)}
        className={cn(
          "grid place-items-center rounded-[var(--radius-lg)] border-2 border-dashed px-5 py-8 text-center transition-colors sm:py-10",
          over ? "border-accent bg-accent-soft" : "border-border bg-surface-2/40",
        )}
      >
        <input ref={pickFiles} type="file" multiple accept={ACCEPT} hidden
          onChange={(e) => { if (e.target.files) stage(filesFromInput(e.target.files)); e.target.value = ""; }} />
        <input ref={(el) => { pickFolder.current = el; el?.setAttribute("webkitdirectory", ""); }} type="file" multiple hidden
          onChange={(e) => { if (e.target.files) stage(filesFromInput(e.target.files)); e.target.value = ""; }} />
        <div className="grid max-w-xl justify-items-center gap-2.5">
          <CloudArrowUpIcon size={36} weight="duotone" className="text-accent" />
          <p className="text-[15px] font-semibold text-balance">
            {running ? t("Uploading {done} of {total}…", { done, total }) : t("Drop {company}'s documents here", { company: department?.name ?? branch.name })}
          </p>
          {folder ? (
            <p className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-[12.5px] font-medium text-accent">
              <FolderOpenIcon size={13} weight="bold" className="shrink-0" />
              <span className="truncate">{t("Into the folder {folder}", { folder })}</span>
            </p>
          ) : null}
          <p className="text-[13px] text-muted text-pretty">
            {t("Files, whole folders or a .zip: PDF, Word, Excel, PowerPoint, images and text. Folders are kept. Each file is read, sorted by kind and department, and checked for passwords and personal data.")}
          </p>
          <div className="mt-1 flex flex-wrap justify-center gap-2">
            <Button size="sm" disabled={running || !!staged} onClick={() => pickFiles.current?.click()}><FileIcon size={15} /> {t("Choose files")}</Button>
            <Button size="sm" variant="outline" disabled={running || !!staged} onClick={() => pickFolder.current?.click()}><FolderOpenIcon size={15} /> {t("Choose a folder")}</Button>
          </div>
          {department ? null : (
            <div className="mt-1 flex w-full max-w-xs items-center gap-2 text-[12.5px] text-muted">
              <span className="shrink-0">{t("Department")}</span>
              <Select size="sm" value={dept} onValueChange={setDept} label={t("Department")} className="min-w-0 flex-1" disabled={running}
                options={[{ value: AUTO, label: t("Let the AI sort it") }, ...branch.departments.map((d) => ({ value: d.id, label: d.name }))]} />
            </div>
          )}
        </div>
      </div>

      {staged ? (
        <StagedUpload files={staged.files} into={staged.into} branch={branch} department={department ?? null}
          keywords={keywords} setKeywords={setKeywords} autoSort={autoSort} setAutoSort={setAutoSort}
          onCancel={() => { setStaged(null); setKeywords([]); setAutoSort(null); }} onConfirm={confirm} />
      ) : null}

      {items.length ? (
        <Card>
          <div className="grid gap-2 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13.5px] font-medium">
                {running ? t("Uploading {done} of {total}", { done, total }) : failed ? t("{n} could not be uploaded", { n: failed }) : t("All {n} uploaded", { n: total })}
              </p>
              <span className="flex items-center gap-2 text-[12.5px] text-muted tabular">
                {fileSize(Math.round(sentBytes))} / {fileSize(bytes)}
                {running ? (
                  <Button size="sm" variant="ghost" onClick={() => abort.current?.abort()}><XIcon size={14} /> {t("Stop")}</Button>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setItems([])}>{t("Clear")}</Button>
                )}
              </span>
            </div>
            <Bar value={bytes ? sentBytes / bytes : 0} tone={failed && !running ? "danger" : "accent"} label={t("Upload progress")} />
          </div>
          <ul className="grid max-h-64 grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-y-auto">
            {items.map((x) => (
              <li key={x.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2">
                {x.zip ? <FileZipIcon size={16} weight="duotone" className="text-warn" /> : <FileIcon size={16} weight="duotone" className="text-muted" />}
                <span className="grid min-w-0 gap-1">
                  <span className="truncate text-[12.5px]" title={x.path}>{x.path}</span>
                  {x.state === "sending" ? <Bar value={x.progress} /> : null}
                  {x.error ? <span className="text-[12px] break-words text-danger">{x.error}</span> : null}
                </span>
                <span className="text-[12px] text-muted tabular">
                  {x.state === "sent" ? <CheckCircleIcon size={16} weight="fill" className="text-ok" aria-label={t("Uploaded")} />
                    : x.state === "failed" ? <WarningIcon size={16} weight="fill" className="text-danger" aria-label={t("Failed")} />
                    : x.state === "sending" ? `${Math.round(x.progress * 100)}%` : fileSize(x.size)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- P149c: before uploading

/** The picked files, waiting: keywords for all of them, "Sort into folders automatically"
 * (on by default in a unit) and where each would go, then Upload. */
function StagedUpload({ files, into, branch, department, keywords, setKeywords, autoSort, setAutoSort, onCancel, onConfirm }: {
  files: PickedFile[];
  into: string;
  branch: Branch;
  department: { id: string; name: string } | null;
  keywords: string[];
  setKeywords: (k: string[]) => void;
  autoSort: boolean | null;
  setAutoSort: (on: boolean) => void;
  onCancel: () => void;
  onConfirm: (auto: boolean) => void;
}) {
  const t = useT();
  const names = files.map((f) => f.path);
  const { data: preview, isFetching } = useQuery({
    queryKey: ["files", "sort-preview", branch.id, department?.id ?? "", into, keywords, names],
    queryFn: () => previewSort({ branchId: branch.id, departmentId: department?.id, folder: into, keywords, names }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  // A chosen folder keeps its files; sorting is for the top of the unit or company.
  const canSort = !into && preview !== null;
  const auto = canSort && (autoSort ?? preview?.auto ?? !!department);
  const groups = preview && auto ? folderGroups(preview.items) : [];
  const sorted = groups.filter((g) => g.sorted).reduce((n, g) => n + g.names.length, 0);
  return (
    <Card data-guide="files.upload-options">
      <CardHeader
        icon={<span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent"><CloudArrowUpIcon size={18} weight="duotone" /></span>}
        title={files.length === 1 ? t("1 file ready to upload") : t("{n} files ready to upload", { n: files.length })}
        description={into ? t("Into the folder {folder}", { folder: into }) : department?.name ?? branch.name}
      />
      <CardBody className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-[13px] font-semibold">{t("Keywords for these files")}</span>
          <span className="text-[12.5px] text-muted">{t("Added to every file in this upload, so you can find, filter and sort them later.")}</span>
          <KeywordInput value={keywords} onChange={setKeywords} branchId={branch.id} departmentId={department?.id} autoFocus />
        </div>
        {canSort ? (
          <SwitchField checked={auto} onCheckedChange={setAutoSort} label={t("Sort into folders automatically")}
            hint={t("By what each file is and the date in its name or content, e.g. Payroll/2026/11. Folders you upload keep their own folders.")} />
        ) : into ? (
          <p className="text-[12.5px] text-muted">{t("The files stay in the folder you chose.")}</p>
        ) : null}
        {auto && groups.length ? (
          <div className="grid gap-1.5" aria-busy={isFetching}>
            <span className="text-[12.5px] font-semibold">
              {t("Proposed folders: {n} of {total} files sorted", { n: sorted, total: files.length })}
            </span>
            <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-2 text-[12.5px]">
              {groups.map((g) => (
                <li key={`${g.sorted}:${g.folder}`} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                  <FolderOpenIcon size={14} weight="duotone" className={g.sorted ? "text-accent" : "text-muted"} />
                  <span className="min-w-0 truncate" title={g.names.join("\n")}>
                    <span className="font-medium">{g.folder || t("Top level")}</span>
                    {!g.sorted ? <span className="text-muted"> · {t("stays here")}</span> : null}
                    <span className="text-muted"> · {g.names.slice(0, 2).join(", ")}{g.names.length > 2 ? "…" : ""}</span>
                  </span>
                  <span className="text-muted tabular">{g.names.length}</span>
                </li>
              ))}
            </ul>
            <span className="text-[12px] text-muted">{t("From the file names and keywords; once read, a file's content can still decide its folder.")}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onCancel}>{t("Cancel")}</Button>
          <Button onClick={() => onConfirm(auto)}>
            <CloudArrowUpIcon size={15} /> {files.length === 1 ? t("Upload 1 file") : t("Upload {n} files", { n: files.length })}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------- one upload: progress + report

const STAGES: { key: IntakeStatus; label: string }[] = [
  { key: "unpacking", label: msg("Unpacking") },
  { key: "reading", label: msg("Reading") },
  { key: "sorting", label: msg("Sorting") },
  { key: "ready", label: msg("Ready") },
];

function Stages({ status }: { status: IntakeStatus }) {
  const t = useT();
  const at = status === "failed" ? -1 : STAGES.findIndex((s) => s.key === status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[12px]" aria-label={t("Progress")}>
      {STAGES.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className={cn(
            "rounded-full px-2 py-0.5 font-medium",
            i < at || status === "ready" ? "bg-ok/12 text-ok" : i === at ? "bg-accent text-accent-fg" : "bg-surface-2 text-muted",
          )}>
            {t(s.label)}
          </span>
          {i < STAGES.length - 1 ? <span aria-hidden className="h-px w-3 bg-border" /> : null}
        </li>
      ))}
    </ol>
  );
}

function Count({ label, value, tone, icon: Icon }: { label: string; value: number; tone?: "warn" | "ok" | "accent"; icon: typeof BooksIcon }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-2/30 px-3 py-2.5">
      <Icon size={18} weight="duotone" className={cn("shrink-0", tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-accent")} />
      <span className="grid min-w-0">
        <span className="text-[17px] leading-tight font-semibold tabular">{value.toLocaleString(locale())}</span>
        <span className="text-[12px] leading-snug text-muted">{label}</span>
      </span>
    </div>
  );
}

export interface ShowFilter {
  batch: string;
  kind?: string;
  department?: string;
}

/** One upload: live progress while the server works, then its report. */
export function BatchCard({ batchId, branch, onOpenFile, onShow, onDismiss, guide, defaultOpen = true }: {
  batchId: string;
  /** Show the full report straight away (older uploads start folded to one line). */
  defaultOpen?: boolean;
  branch: Branch;
  onOpenFile: (id: string) => void;
  onShow: (f: ShowFilter) => void;
  onDismiss?: () => void;
  guide?: string;
}) {
  const t = useT();
  const { data: b, error, refetch } = useQuery(intakeBatchQuery(batchId));
  const [skippedOpen, setSkippedOpen] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  if (error && notThere(error)) return null;
  if (error) return <p role="alert" className="text-[13px] text-danger">{errorMessage(error)}</p>;
  if (!b) return <Card className="h-28 animate-pulse" />;
  const active = INTAKE_ACTIVE.includes(b.status);
  const r = b.report ?? {};
  const flagged = r.flagged ?? [];
  const skipped = r.skipped ?? [];
  const kinds = Object.entries(r.by_kind ?? {}).filter(([, n]) => n > 0).sort((a, z) => z[1] - a[1]);
  const depts = Object.entries(r.by_department ?? {}).filter(([, n]) => n > 0).sort((a, z) => z[1] - a[1]);
  const deptName = (id: string) => (id ? branch.departments.find((d) => d.id === id)?.name ?? t("Other department") : t("No department"));

  return (
    <Card data-guide={guide} className={cn(b.status === "failed" && "border-danger/40")}>
      <CardHeader
        icon={<span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent"><FileZipIcon size={18} weight="duotone" /></span>}
        title={<span className="break-words">{b.name || t("Upload")}</span>}
        description={b.status === "ready" && !open
          ? t("Uploaded {when} · {n} files · {held} held back", { when: timeAgo(b.created_at), n: b.total - skipped.length, held: flagged.length })
          : t("Uploaded {when}", { when: timeAgo(b.created_at) })}
        actions={<>
          {b.status === "ready" ? (
            <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <CaretDownIcon size={13} className={cn("transition-transform", !open && "-rotate-90")} /> {open ? t("Hide report") : t("Show report")}
            </Button>
          ) : null}
          {b.status === "ready" ? (
            <Button size="sm" variant="outline" asChild>
              <a href={archiveUrl({ batch_id: b.id })} download><DownloadSimpleIcon size={14} /> {t("Download this upload")}</a>
            </Button>
          ) : null}
          {onDismiss && !active ? <Button size="icon-sm" variant="ghost" aria-label={t("Hide")} onClick={onDismiss}><XIcon size={15} /></Button> : null}
        </>}
      />
      {b.status === "ready" && !open ? null : <CardBody className="grid gap-4">
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Stages status={b.status} />
            <span className="text-[12.5px] text-muted tabular">
              {b.status === "unpacking" && !b.total ? t("Opening the upload…") : t("{done} of {total} files read", { done: b.done, total: b.total })}
            </span>
          </div>
          {b.status !== "ready" ? <Bar value={b.total ? b.done / b.total : 0} tone={b.status === "failed" ? "danger" : "accent"} label={t("Reading progress")} /> : null}
          {b.status === "failed" ? <p className="rounded-sm bg-danger/10 px-3 py-2 text-[13px] text-danger">{b.error || t("This upload could not be finished.")}</p> : null}
        </div>

        {b.status === "ready" ? (
          <>
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Count label={t("Files kept")} value={b.total - skipped.length} icon={FolderOpenIcon} />
              <Count label={t("Added to the library")} value={r.library ?? 0} icon={BooksIcon} tone="ok" />
              <Count label={t("Held back")} value={flagged.length} icon={ShieldWarningIcon} tone={flagged.length ? "warn" : "ok"} />
              <Count label={t("Skipped")} value={skipped.length} icon={SkipForwardIcon} tone={skipped.length ? "warn" : "ok"} />
            </div>

            {kinds.length ? (
              <div className="grid gap-2">
                <h3 className="text-[13px] font-semibold">{t("What was found")}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {kinds.map(([k, n]) => (
                    <button key={k} type="button" onClick={() => onShow({ batch: b.id, kind: kindKey(k) })}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface py-1 pr-3 pl-1 text-[12.5px] transition-colors hover:border-accent/40 hover:bg-accent-soft">
                      <KindTile kind={kindKey(k)} size="sm" />
                      <span className="font-medium">{kindLabel(k)}</span>
                      <span className="text-muted tabular">{n}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {depts.length ? (
              <div className="grid gap-2">
                <h3 className="text-[13px] font-semibold">{t("By department")}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {depts.map(([d, n]) => (
                    <button key={d || "none"} type="button" onClick={() => onShow({ batch: b.id, department: d || undefined })}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] transition-colors hover:border-accent/40 hover:bg-accent-soft">
                      <span className="font-medium">{deptName(d)}</span>
                      <span className="text-muted tabular">{n}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {flagged.length ? (
              <div className="grid gap-2 rounded-[var(--radius-md)] border border-warn/30 bg-warn/6 p-3">
                <div className="flex items-start gap-2.5">
                  <ShieldWarningIcon size={18} weight="duotone" className="mt-0.5 shrink-0 text-warn" />
                  <div className="min-w-0">
                    <h3 className="text-[13.5px] font-semibold">{flagged.length === 1 ? t("1 file held back from AI") : t("{n} files held back from AI", { n: flagged.length })}</h3>
                    <p className="text-[12.5px] text-muted">{t("They are kept and you can download them, but agents cannot read them until a manager releases them.")}</p>
                  </div>
                </div>
                <ul className="grid gap-1">
                  {flagged.map((f) => (
                    <li key={f.file_id}>
                      <button type="button" onClick={() => onOpenFile(f.file_id)}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 py-1.5 text-left hover:bg-surface/70">
                        <span className="grid min-w-0 gap-0.5">
                          <span className="truncate text-[13px] font-medium" title={f.name}>{f.name}</span>
                          <span className="text-[12px] break-words text-muted">{[...flagWords(f.reasons), f.detail].filter(Boolean).join(" · ")}</span>
                        </span>
                        <ArrowSquareOutIcon size={14} className="text-muted" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {skipped.length ? (
              <div className="grid gap-1.5">
                <button type="button" onClick={() => setSkippedOpen((o) => !o)} aria-expanded={skippedOpen}
                  className="flex items-center gap-1.5 justify-self-start text-[13px] font-semibold">
                  <CaretDownIcon size={13} className={cn("transition-transform", !skippedOpen && "-rotate-90")} />
                  {skipped.length === 1 ? t("1 entry skipped") : t("{n} entries skipped", { n: skipped.length })}
                </button>
                {skippedOpen ? (
                  <ul className="grid gap-1 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-2.5 text-[12.5px]">
                    {skipped.map((s, i) => (
                      <li key={`${s.path}:${i}`} className="grid gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <span className="break-words [overflow-wrap:anywhere]">{s.path}</span>
                        <span className="text-muted">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-2" data-guide={guide ? "files.suggestions" : undefined}>
              <h3 className="text-[13px] font-semibold">{t("AI suggestions")}</h3>
              <IntakeSuggestions batchId={b.id} suggestions={r.suggestions ?? []} onChange={() => void refetch()} />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button size="sm" variant="outline" onClick={() => onShow({ batch: b.id })}><FolderOpenIcon size={14} /> {t("Show these files")}</Button>
            </div>
          </>
        ) : null}
      </CardBody>}
    </Card>
  );
}

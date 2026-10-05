/** Company files: one file open. A preview (PDF, Office shown as PDF, zoomable image, text),
 * what was read from it, where it sits, what the scan found, and what you can do with it. */
import {
  ArrowClockwiseIcon, ArrowSquareOutIcon, ArrowsOutIcon, CornersInIcon, DownloadSimpleIcon, FolderOpenIcon, LockSimpleIcon,
  LockSimpleOpenIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, ShieldWarningIcon, TrashIcon, XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { FileStatus } from "@/components/file-drop";
import { LibraryToggle } from "@/components/library-toggle";
import { PinButton } from "@/components/pin-button";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, t as tr, useLang, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { docKeys, fileQuery, fileSize, fileUrl } from "@/lib/documents";
import {
  cleanFolder, deleteFile, flagWords, holdFile, intakeKeys, KINDS, kindKey, kindLabel, moveFiles, notThere, patchFile, previewKind,
  previewUrl, releaseFile, type CompanyFile,
} from "@/lib/intake";
import type { Branch } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { createViewport, type Viewport } from "@/lib/viewport";

import { BuildFromDocs } from "@/components/doc-builders";
import { FileTile, KindTile } from "./visuals";

const NONE = "__none";

/** Pan and zoom an image: wheel or pinch to zoom, drag to move, double-tap to zoom in. */
function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const vp = useRef<Viewport | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el || !size) return;
    const v = createViewport(el, {
      initial: { x: 0, y: 0, k: 1 },
      limits: { min: 0.05, max: 8 },
      onChange: (c) => {
        if (img.current) img.current.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.k})`;
      },
      contentBounds: () => ({ x: 0, y: 0, w: size.w, h: size.h }),
      fitOptions: { pad: 12, maxK: 1 },
      wheelCapture: "focus",
      doubleTapZoom: true,
      keyboard: false,
    });
    vp.current = v;
    v.fit();
    return () => {
      v.destroy();
      vp.current = null;
    };
  }, [size]);

  if (failed) return <p className="grid h-full place-items-center p-6 text-center text-[13px] text-muted">{t("The preview could not be loaded. Download the file to open it.")}</p>;
  return (
    <div className="relative h-full min-h-0 w-full">
      <div ref={box} className="absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing">
        <img ref={img} src={src} alt={alt} draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth || 800, h: e.currentTarget.naturalHeight || 600 })}
          onError={() => setFailed(true)}
          className="absolute top-0 left-0 max-w-none origin-top-left select-none"
          style={{ transform: "scale(0.0001)" }} />
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1 rounded-[var(--radius-sm)] border border-border bg-surface/95 p-0.5 shadow-[var(--shadow-soft)]">
        <Button size="icon-sm" variant="ghost" aria-label={t("Zoom out")} onClick={() => vp.current?.zoomBy(1 / 1.4, undefined, 180)}><MagnifyingGlassMinusIcon size={16} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("Fit to view")} onClick={() => vp.current?.fit(undefined, { animate: 220 })}><CornersInIcon size={16} /></Button>
        <Button size="icon-sm" variant="ghost" aria-label={t("Zoom in")} onClick={() => vp.current?.zoomBy(1.4, undefined, 180)}><MagnifyingGlassPlusIcon size={16} /></Button>
      </div>
    </div>
  );
}

function Preview({ f, tall, canSee, page }: { f: CompanyFile; tall: boolean; canSee: boolean; page?: number }) {
  const t = useT();
  const kind = previewKind(f);
  const frame = cn("w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface-2/40", tall ? "h-[78dvh]" : "h-[46dvh] sm:h-[52dvh]");
  if (!canSee) {
    return (
      <div className={cn(frame, "grid h-auto place-items-center gap-2 px-6 py-10 text-center")}>
        <LockSimpleIcon size={26} weight="duotone" className="text-warn" />
        <p className="max-w-sm text-[13px] text-muted">{t("This file is held back while a manager checks it. Ask a manager to release it.")}</p>
      </div>
    );
  }
  if (f.status === "reading" && kind === "office") return <Skeleton className={frame} />;
  // P25: a search hit opens a PDF at its page (#page=N; Office previews are a text PDF with
  // other page breaks, so they open at the top).
  const at = kind === "pdf" && page && page > 0 ? `#page=${page}` : "";
  if (kind === "pdf" || kind === "office") return <iframe key={at} src={previewUrl(f.id) + at} title={f.title || f.name} className={cn(frame, "bg-white")} />;
  if (kind === "image") return <div className={frame}><ZoomImage src={previewUrl(f.id)} alt={f.title || f.name} /></div>;
  if (kind === "text") {
    return (
      <pre className={cn(frame, "h-auto max-h-[52dvh] overflow-x-hidden overflow-y-auto p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]")}>
        {f.text?.trim() || (f.status === "reading" ? "…" : t("No text could be read."))}
      </pre>
    );
  }
  return (
    <div className={cn(frame, "grid h-auto place-items-center px-6 py-10 text-center text-[13px] text-muted")}>
      {t("There is no preview for this type of file. Download it to open it.")}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** Pick a folder (or type a new one) for one file or several. */
export function MoveDialog({ open, onOpenChange, folders, current, count, onMove }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  folders: string[];
  current: string;
  count: number;
  onMove: (folder: string) => Promise<void>;
}) {
  const t = useT();
  // The body unmounts while closed, so each opening starts from the current folder.
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={count === 1 ? t("Move to folder") : t("Move {n} files to a folder", { n: count })}
      description={t("Pick a folder, or type a new one. Use / for a folder inside a folder.")} className="w-[min(94vw,32rem)]">
      <MoveForm folders={folders} current={current} onMove={onMove} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function MoveForm({ folders, current, onMove, onDone }: { folders: string[]; current: string; onMove: (folder: string) => Promise<void>; onDone: () => void }) {
  const t = useT();
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const needle = value.trim().toLowerCase();
  const shown = folders.filter((p) => p && (!needle || p.toLowerCase().includes(needle))).slice(0, 40);
  const go = async () => {
    setBusy(true);
    try {
      await onMove(cleanFolder(value));
      onDone();
    } catch {
      /* the caller showed the error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("e.g. OPERATIONS/SOP")} aria-label={t("Folder")}
        onKeyDown={(e) => { if (e.key === "Enter") void go(); }} />
      <ul className="grid max-h-[40dvh] gap-0.5 overflow-y-auto">
        <li>
          <button type="button" onClick={() => setValue("")} className={cn("w-full rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2", !cleanFolder(value) && "bg-accent-soft text-accent")}>
            {t("Top level (no folder)")}
          </button>
        </li>
        {shown.map((p) => (
          <li key={p}>
            <button type="button" onClick={() => setValue(p)}
              className={cn("flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-2", cleanFolder(value) === p && "bg-accent-soft text-accent")}>
              <FolderOpenIcon size={15} className="shrink-0 text-muted" />
              <span className="min-w-0 break-words [overflow-wrap:anywhere]">{p}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
        <Button loading={busy} onClick={() => void go()}><FolderOpenIcon size={15} /> {cleanFolder(value) ? t("Move|file") : t("Move to the top")}</Button>
      </div>
    </div>
  );
}

/** Move files: one call when the server has /api/files/move, else one PATCH each. */
export async function moveMany(ids: string[], folder: string): Promise<void> {
  try {
    await moveFiles(ids, folder);
  } catch (e) {
    if (!notThere(e)) throw e;
    for (const id of ids) await patchFile(id, { folder });
  }
}

function ReasonDialog({ open, onOpenChange, title, body, confirm, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  confirm: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={title} description={body}>
      <ReasonForm confirm={confirm} onConfirm={onConfirm} onDone={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
}

function ReasonForm({ confirm, onConfirm, onDone }: { confirm: string; onConfirm: (reason: string) => Promise<void>; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      onDone();
    } catch {
      /* the caller showed the error */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <label className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("Reason")}</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300}
          placeholder={t("e.g. Checked: the passwords were already changed")}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
      </label>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
        <Button loading={busy} disabled={!reason.trim()} onClick={() => void go()}>{confirm}</Button>
      </div>
    </div>
  );
}

/** P25: `page` in the address (a search hit) is for the file it came with. Read it once, then
 * drop it from the address so the next file opened from the list starts at its top. */
function useSearchPage(id: string): number | undefined {
  const search = useSearch({ strict: false }) as { f?: string; page?: number };
  const navigate = useNavigate();
  const [held, setHeld] = useState<{ id: string; page: number } | null>(null);
  if (search.page && search.f === id && (held?.id !== id || held.page !== search.page)) setHeld({ id, page: search.page });
  useEffect(() => {
    if (search.page) void navigate({ to: ".", search: ((s: Record<string, unknown>) => ({ ...s, page: undefined })) as never, replace: true });
  }, [search.page, navigate]);
  return held && held.id === id ? held.page : undefined;
}

/** The open file. `inline` renders it as a pane (wide desktops); otherwise the caller wraps
 * it in a side sheet. */
export function FileViewer({ id, branch, folders, canManage, canEdit, onClose, inline }: {
  id: string;
  branch: Branch | null;
  folders: string[];
  canManage: boolean;
  canEdit: boolean;
  onClose: () => void;
  inline?: boolean;
}) {
  const t = useT();
  const lang = useLang((s) => s.lang);
  const qc = useQueryClient();
  const { data, error } = useQuery(fileQuery(id));
  const f = data as CompanyFile | undefined;
  const [tall, setTall] = useState(false);
  const page = useSearchPage(id);
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [hold, setHold] = useState<"release" | "hold" | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: docKeys.files });
    void qc.invalidateQueries({ queryKey: intakeKeys.all });
  };
  const patch = useMutation({
    mutationFn: (body: Parameters<typeof patchFile>[1]) => patchFile(id, body),
    onSuccess: () => { refresh(); toast.success(tr("Saved.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reread = useMutation({
    mutationFn: () => api(`/api/files/${id}/reread`, "POST"),
    onSuccess: () => { refresh(); toast.success(tr("Reading it again.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const shell = (title: ReactNode, description: ReactNode, actions: ReactNode, content: ReactNode, tile?: ReactNode) =>
    inline ? (
      <div className="grid min-w-0 gap-4">
        <div className="flex min-w-0 items-start gap-3">
          {tile}
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold break-words">{title}</h2>
            {description ? <p className="text-[12.5px] text-muted">{description}</p> : null}
          </div>
          <Button size="icon-sm" variant="ghost" aria-label={t("Close")} onClick={onClose}><XIcon size={16} /></Button>
        </div>
        {actions}
        {content}
      </div>
    ) : (
      <SideSheet open onOpenChange={(o) => !o && onClose()} size="lg" description={description} actions={actions}
        title={<span className="flex min-w-0 items-center gap-3">{tile}<span className="min-w-0 break-words">{title}</span></span>}>
        {content}
      </SideSheet>
    );

  if (error) return shell(t("File"), null, null, <p role="alert" className="text-danger">{errorMessage(error)}</p>);
  if (!f) return shell(t("File"), null, null, <div className="grid gap-3"><Skeleton className="h-10" /><Skeleton className="h-64" /><Skeleton className="h-24" /></div>);

  const held = !!f.quarantined;
  const canSee = !held || canManage;
  const flags = flagWords([], f.sensitive);
  const dept = branch?.departments.find((d) => d.id === f.department_id);
  const kk = kindKey(f.kind);

  const actions = (
    <div className="flex flex-wrap gap-2">
      {canSee ? <Button size="sm" variant="outline" asChild><a href={fileUrl(f.id)} download><DownloadSimpleIcon size={14} /> {t("Download")}</a></Button> : null}
      {canSee ? <PinButton kind="file" refId={f.id} title={f.title || f.name} withLabel /> : null}
      {canSee && previewKind(f) !== "none" ? (
        <Button size="sm" variant="outline" asChild>
          <a href={previewKind(f) === "text" ? fileUrl(f.id, true) : previewUrl(f.id)} target="_blank" rel="noreferrer"><ArrowSquareOutIcon size={14} /> {lang === "ms" ? t("Open (verb)") : "Open"}</a>
        </Button>
      ) : null}
      {canEdit ? <Button size="sm" variant="ghost" onClick={() => setMoving(true)}><FolderOpenIcon size={14} /> {t("Move|file")}</Button> : null}
      {canManage ? (
        held
          ? <Button size="sm" variant="ghost" onClick={() => setHold("release")}><LockSimpleOpenIcon size={14} /> {t("Release")}</Button>
          : <Button size="sm" variant="ghost" onClick={() => setHold("hold")}><LockSimpleIcon size={14} /> {t("Hold back")}</Button>
      ) : null}
      {canEdit && f.source === "upload" ? <Button size="sm" variant="ghost" loading={reread.isPending} onClick={() => reread.mutate()}><ArrowClockwiseIcon size={14} /> {t("Read again")}</Button> : null}
      {canEdit ? <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(true)}><TrashIcon size={14} /> {t("Delete")}</Button> : null}
    </div>
  );

  const body = (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <FileStatus f={f} />
        {held ? <Pill tone="warn"><ShieldWarningIcon size={13} /> {t("Held back")}</Pill> : null}
        {f.library ? <Pill tone="accent">{t("In library")}</Pill> : null}
        <span className="text-[12.5px] text-muted">{t("added {when}", { when: timeAgo(f.created_at) })}</span>
      </div>

      {held || (f.sensitive && flags.length) ? (
        <section className={cn("grid gap-1.5 rounded-[var(--radius-md)] border p-3", held ? "border-warn/30 bg-warn/6" : "border-border bg-surface-2/30")}>
          <h3 className="flex items-center gap-2 text-[13px] font-semibold">
            <ShieldWarningIcon size={16} weight="duotone" className={held ? "text-warn" : "text-muted"} />
            {held ? t("Held back from AI") : t("Released for AI")}
          </h3>
          {flags.length ? <ul className="ml-6 list-disc text-[13px]">{flags.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          <p className="text-[12.5px] text-muted">
            {held ? t("Agents cannot read it and it stays out of the library until a manager releases it.") : t("A manager checked it and let agents read it.")}
          </p>
          {f.sensitive?.reason ? <p className="text-[12.5px] text-muted">{t("Reason: {reason}", { reason: f.sensitive.reason })}</p> : null}
        </section>
      ) : null}

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">{t("Preview")}</h3>
          {canSee && previewKind(f) !== "none" && previewKind(f) !== "text" ? (
            <Button size="sm" variant="ghost" onClick={() => setTall((v) => !v)}>
              {tall ? <><CornersInIcon size={14} /> {t("Smaller")}</> : <><ArrowsOutIcon size={14} /> {t("Bigger")}</>}
            </Button>
          ) : null}
        </div>
        {page && previewKind(f) === "pdf" && canSee ? <p className="text-[12px] text-muted">{t("Opened at page {n}, where your search found it.", { n: page })}</p> : null}
        <Preview f={f} tall={tall} canSee={canSee} page={page} />
        {previewKind(f) === "office" && canSee ? <p className="text-[12px] text-muted">{t("Office files are shown as a PDF. Download gives you the original.")}</p> : null}
      </section>

      <section className="grid gap-1.5">
        <h3 className="text-[13px] font-semibold">{t("What it is")}</h3>
        <p className="text-[13.5px] leading-relaxed">{f.status === "reading" ? t("Reading the file…") : f.summary || t("No summary (no AI model was available when it was read).")}</p>
        {f.error && f.status !== "reading" ? <p className="rounded-sm bg-warn/10 px-3 py-2 text-[13px] text-warn">{f.error}</p> : null}
      </section>

      <section className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="text-[13px] font-semibold">{t("Kind")}</span>
            <Select value={kk} disabled={!canEdit || patch.isPending} onValueChange={(v) => patch.mutate({ kind: v })} label={t("Kind")}
              options={KINDS.map((k) => ({ value: k.key, label: k.key === "sop" ? "SOP" : t(k.label) }))} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[13px] font-semibold">{t("Department")}</span>
            <Select value={f.department_id ?? NONE} disabled={!canEdit || patch.isPending || !branch} label={t("Department")}
              onValueChange={(v) => patch.mutate({ department_id: v === NONE ? null : v })}
              options={[{ value: NONE, label: t("No department") }, ...(branch?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
          </label>
        </div>
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3 text-[13px] sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] sm:gap-y-1.5 max-sm:[&_dd]:mb-1.5">
          <Row label={t("Folder")}>{f.folder ? f.folder : t("Top level")}</Row>
          {f.source_path && f.source_path !== f.name ? <Row label={t("Uploaded as")}>{f.source_path}</Row> : null}
          <Row label={t("File")}>{[f.name, fileSize(f.size), f.pages ? (f.pages > 1 ? t("{n} pages", { n: f.pages }) : t("1 page")) : "", f.ocr ? t("read with OCR") : ""].filter(Boolean).join(" · ")}</Row>
          {kk === "other" && f.kind ? <Row label={t("Read as")}>{kindLabel(f.kind)}</Row> : null}
          {dept ? <Row label={t("Department")}>{dept.name}</Row> : null}
          {Object.entries(f.fields ?? {}).map(([k, v]) => <Row key={k} label={k}>{v}</Row>)}
          {f.expires_on ? <Row label={t("Valid until")}><span className={f.expired ? "font-medium text-danger" : ""}>{f.expires_on}{f.expired ? ` ${t("(expired)")}` : ""}</span></Row> : null}
        </dl>
      </section>

      {f.source === "upload" ? <LibraryToggle file={f} disabled={held || !canEdit} /> : null}
      {held ? <p className="-mt-3 text-[12px] text-muted">{t("A held-back file cannot go in the library.")}</p> : null}

      {branch && canEdit && canSee && !held ? (
        <section className="grid gap-2 rounded-[var(--radius-md)] border border-border p-3">
          <h3 className="text-[13px] font-semibold">{t("Turn it into a procedure")}</h3>
          <p className="text-[12.5px] text-muted">{t("Make an SOP agents follow, or a workflow that runs the job step by step, from this document.")}</p>
          <BuildFromDocs fileIds={[f.id]} branchId={branch.id} />
        </section>
      ) : null}

      {canSee ? (
        <details className="group grid gap-1.5">
          <summary className="cursor-pointer text-[13px] font-semibold">
            {t("Text agents read")} {f.text_length ? <span className="font-normal text-muted">({t("{n} characters", { n: f.text_length.toLocaleString(locale()) })})</span> : null}
          </summary>
          <pre className="mt-2 max-h-[50dvh] overflow-x-hidden overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface-2/50 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
            {f.text?.trim() || (f.status === "reading" ? "…" : t("No text could be read."))}
          </pre>
        </details>
      ) : null}

      <MoveDialog open={moving} onOpenChange={setMoving} folders={folders} current={f.folder ?? ""} count={1}
        onMove={async (folder) => {
          try { await moveMany([f.id], folder); refresh(); toast.success(tr("Moved.")); } catch (e) { toast.error(errorMessage(e)); throw e; }
        }} />
      <ReasonDialog open={hold === "release"} onOpenChange={(o) => !o && setHold(null)} title={t("Release this file?")} confirm={t("Release")}
        body={t("Agents can read it again and it can go in the library. Say why it is safe.")}
        onConfirm={async (reason) => { try { await releaseFile(f.id, reason); refresh(); toast.success(tr("Released.")); } catch (e) { toast.error(errorMessage(e)); throw e; } }} />
      <ReasonDialog open={hold === "hold"} onOpenChange={(o) => !o && setHold(null)} title={t("Hold this file back?")} confirm={t("Hold back")}
        body={t("Agents stop reading it and it leaves the library until a manager releases it.")}
        onConfirm={async (reason) => { try { await holdFile(f.id, reason); refresh(); toast.success(tr("Held back.")); } catch (e) { toast.error(errorMessage(e)); throw e; } }} />
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t("Delete this file?")} danger confirmLabel={t("Delete")}
        body={t("Agents can no longer read it, and packs that use it will show it as missing.")}
        onConfirm={async () => {
          try { await deleteFile(f.id); refresh(); toast.success(tr("File deleted.")); onClose(); } catch (e) { toast.error(errorMessage(e)); }
        }} />
    </div>
  );

  return shell(
    f.title || f.name,
    [kindLabel(f.kind), dept?.name, fileSize(f.size)].filter(Boolean).join(" · "),
    actions,
    body,
    kk === "other" ? <FileTile mime={f.mime} name={f.name} size="sm" /> : <KindTile kind={kk} size="sm" />,
  );
}

/** Company files: one file open, inside the file panel (see file-panel.tsx). A sticky header
 * (what it is, where it sits, what you can do with it) over two tabs: the preview at the full
 * size of the panel (PDF, Office shown as PDF, zoomable image, text), and the details (who made
 * it, what was read from it, its kind and department, the scan, the guidelines, the text agents
 * read). */
import {
  ArrowClockwiseIcon, ArrowSquareOutIcon, BooksIcon, CornersInIcon, DotsThreeIcon, DownloadSimpleIcon, EyeIcon, FolderOpenIcon,
  FolderSimpleIcon, InfoIcon, LockSimpleIcon, LockSimpleOpenIcon, MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon, ShieldWarningIcon,
  SparkleIcon, TrashIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { toast } from "sonner";

import { BuildFromDocs } from "@/components/doc-builders";
import { openTaskComposer } from "@/components/task-composer/store";
import { FileStatus } from "@/components/file-drop";
import { LibraryToggle } from "@/components/library-toggle";
import { PageTabs } from "@/components/page-tabs";
import { PinButton } from "@/components/pin-button";
import { FileProvenanceCard, ReviewPill } from "@/components/provenance";
import { Meta } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { SHEET_BODY } from "@/components/ui/fit-width";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { docKeys, fileSize, fileUrl } from "@/lib/documents";
import {
  cleanFolder, deleteFile, flagWords, holdFile, intakeKeys, KINDS, kindKey, kindLabel, moveFiles, notThere, patchFile, previewKind,
  previewUrl, releaseFile, type CompanyFile,
} from "@/lib/intake";
import { libraryKeys, setLibrary } from "@/lib/library";
import type { FileProvenance } from "@/lib/provenance";
import type { Branch } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { createViewport, type Viewport } from "@/lib/viewport";

import { FileTile, KindTile } from "./visuals";

const NONE = "__none";

/** Phones: 44px touch targets on the header's buttons. */
const TOUCH = "pointer-coarse:h-11 pointer-coarse:min-w-11";

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
      {!size ? <Skeleton className="absolute inset-3" /> : null}
      <div ref={box} className="absolute inset-0 cursor-grab touch-none overflow-hidden active:cursor-grabbing">
        <img ref={img} src={src} alt={alt} draggable={false}
          onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth || 800, h: e.currentTarget.naturalHeight || 600 })}
          onError={() => setFailed(true)}
          className="absolute top-0 left-0 max-w-none origin-top-left select-none"
          style={{ transform: "scale(0.0001)" }} />
      </div>
      <div className="absolute right-2 bottom-2 flex gap-1 rounded-[var(--radius-sm)] border border-border bg-surface/95 p-0.5 shadow-[var(--shadow-soft)]">
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" aria-label={t("Zoom out")} onClick={() => vp.current?.zoomBy(1 / 1.4, undefined, 180)}><MagnifyingGlassMinusIcon size={16} /></Button>
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" aria-label={t("Fit to view")} onClick={() => vp.current?.fit(undefined, { animate: 220 })}><CornersInIcon size={16} /></Button>
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" aria-label={t("Zoom in")} onClick={() => vp.current?.zoomBy(1.4, undefined, 180)}><MagnifyingGlassPlusIcon size={16} /></Button>
      </div>
    </div>
  );
}

/** A PDF (or an Office file shown as one) in a frame, with a skeleton until it has loaded. */
function FramePreview({ src, title }: { src: string; title: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded ? <Skeleton className="absolute inset-3" /> : null}
      <iframe src={src} title={title} onLoad={() => setLoaded(true)}
        className={cn("absolute inset-0 size-full bg-white transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} />
    </>
  );
}

/** A quiet message in the middle of the preview area, with what to do next. */
function PreviewNote({ icon, children, action }: { icon: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-y-auto p-6">
      <div className="grid max-w-sm justify-items-center gap-3 text-center">
        {icon}
        <p className="text-[13.5px] leading-relaxed text-pretty text-muted">{children}</p>
        {action ? <div className="flex flex-wrap justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

/** The preview, filling the room it is given (its parent is `relative` and sized). */
function Preview({ f, canSee, page, onDetails }: { f: CompanyFile; canSee: boolean; page?: number; onDetails: () => void }) {
  const t = useT();
  const kind = previewKind(f);
  const name = f.title || f.name;
  if (!canSee) {
    return (
      <PreviewNote icon={<LockSimpleIcon size={28} weight="duotone" className="text-warn" />}
        action={<Button size="sm" variant="outline" className={TOUCH} onClick={onDetails}><InfoIcon size={14} /> {t("See the details")}</Button>}>
        {t("This file is held back while a manager checks it. Ask a manager to release it.")}
      </PreviewNote>
    );
  }
  if (f.status === "reading" && kind === "office") return <Skeleton className="absolute inset-3" />;
  // P25: a search hit opens a PDF at its page (#page=N; Office previews are a text PDF with
  // other page breaks, so they open at the top).
  const at = kind === "pdf" && page && page > 0 ? `#page=${page}` : "";
  if (kind === "pdf" || kind === "office") return <FramePreview key={f.id + at} src={previewUrl(f.id) + at} title={name} />;
  if (kind === "image") return <div className="absolute inset-0"><ZoomImage key={f.id} src={previewUrl(f.id)} alt={name} /></div>;
  if (kind === "text") {
    return (
      <pre className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
        {f.text?.trim() || (f.status === "reading" ? "…" : t("No text could be read."))}
      </pre>
    );
  }
  return (
    <PreviewNote icon={kindKey(f.kind) === "other" ? <FileTile mime={f.mime} name={f.name} size="lg" /> : <KindTile kind={kindKey(f.kind)} size="lg" />}
      action={<>
        <Button size="sm" className={TOUCH} asChild><a href={fileUrl(f.id)} download><DownloadSimpleIcon size={14} /> {t("Download")}</a></Button>
        <Button size="sm" variant="outline" className={TOUCH} onClick={onDetails}><InfoIcon size={14} /> {t("See the details")}</Button>
      </>}>
      {t("There is no preview for this type of file. Download it to open it.")}
    </PreviewNote>
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

export type FileTab = "preview" | "details";

/** The panel's accessible title and description (Radix Dialog's on desktop, vaul's on phones). */
type TitleSlot = ComponentType<{ className?: string; title?: string; children: ReactNode }>;
type DescriptionSlot = ComponentType<{ asChild?: boolean; children: ReactNode }>;

/** One file, loaded, laid out for the file panel: the sticky header and the open tab. */
export function FileView({ f, branch, folders, canManage, canEdit, page, tab, onTab, onClose, close, nav, phone, Title, Description }: {
  f: CompanyFile;
  branch: Branch | null;
  folders: string[];
  canManage: boolean;
  canEdit: boolean;
  /** A search hit's page (PDFs open there). */
  page?: number;
  tab: FileTab;
  onTab: (tab: FileTab) => void;
  onClose: () => void;
  /** The close button, top right. */
  close: ReactNode;
  /** Previous / next file in the folder, beside the tabs. */
  nav?: ReactNode;
  phone: boolean;
  Title: TitleSlot;
  Description: DescriptionSlot;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [hold, setHold] = useState<"release" | "hold" | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: docKeys.files });
    void qc.invalidateQueries({ queryKey: intakeKeys.all });
  };
  const patch = useMutation({
    mutationFn: (body: Parameters<typeof patchFile>[1]) => patchFile(f.id, body),
    onSuccess: () => { refresh(); toast.success(tr("Saved.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reread = useMutation({
    mutationFn: () => api(`/api/files/${f.id}/reread`, "POST"),
    onSuccess: () => { refresh(); toast.success(tr("Reading it again.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const guideline = useMutation({
    mutationFn: (on: boolean) => setLibrary(f.id, on, on ? { branch_id: f.branch_id ?? branch?.id ?? null, department_id: f.department_id ?? null } : undefined),
    onSuccess: (_, on) => {
      refresh();
      void qc.invalidateQueries({ queryKey: libraryKeys.all });
      toast.success(on ? tr("Agents can now search this file and cite it.") : tr("Taken out of the library."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const held = !!f.quarantined;
  const canSee = !held || canManage;
  const flags = flagWords([], f.sensitive);
  const dept = branch?.departments.find((d) => d.id === f.department_id);
  const kk = kindKey(f.kind);
  const pk = previewKind(f);
  const name = f.title || f.name;
  const review = (f as CompanyFile & Partial<FileProvenance>).review_status;

  const more = canManage || canEdit ? (
    <Menu>
      <MenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" aria-label={t("More actions")}><DotsThreeIcon size={18} weight="bold" /></Button>
      </MenuTrigger>
      <MenuContent>
        {canEdit && f.source === "upload" && !held ? (
          <MenuItem icon={<BooksIcon />} disabled={guideline.isPending} onSelect={() => guideline.mutate(!f.library)}>
            {f.library ? t("Take out of the guidelines") : t("Add to guidelines")}
          </MenuItem>
        ) : null}
        {canEdit && f.source === "upload" ? <MenuItem icon={<ArrowClockwiseIcon />} disabled={reread.isPending} onSelect={() => reread.mutate()}>{t("Read again")}</MenuItem> : null}
        {canManage ? (
          held
            ? <MenuItem icon={<LockSimpleOpenIcon />} onSelect={() => setHold("release")}>{t("Release")}</MenuItem>
            : <MenuItem icon={<LockSimpleIcon />} onSelect={() => setHold("hold")}>{t("Hold back")}</MenuItem>
        ) : null}
        {canEdit ? <>
          <MenuSeparator />
          <MenuItem icon={<TrashIcon />} danger onSelect={() => setRemoving(true)}>{t("Delete")}</MenuItem>
        </> : null}
      </MenuContent>
    </Menu>
  ) : null;

  const header = (
    <div className="shrink-0 border-b border-border bg-surface px-4 pt-2 sm:px-6 sm:pt-5">
      <div className="flex min-w-0 items-start gap-3">
        {kk === "other" ? <FileTile mime={f.mime} name={f.name} size={phone ? "sm" : "md"} /> : <KindTile kind={kk} size={phone ? "sm" : "md"} />}
        <div className="grid min-w-0 flex-1 gap-1">
          <Title title={name} className="line-clamp-2 text-[15.5px] leading-snug font-semibold tracking-[-0.01em] break-words text-pretty [overflow-wrap:anywhere] sm:text-[17px]">{name}</Title>
          <Description asChild>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted sm:gap-x-1.5">
              <Meta items={[
                <span key="folder" className="inline-flex min-w-0 items-center gap-1"><FolderSimpleIcon size={12} className="shrink-0" /><span className="min-w-0 break-words [overflow-wrap:anywhere]">{f.folder || t("Top level")}</span></span>,
                kindLabel(f.kind),
                dept?.name,
                fileSize(f.size),
                f.pages ? (f.pages > 1 ? t("{n} pages", { n: f.pages }) : t("1 page")) : null,
                t("added {when}", { when: timeAgo(f.created_at) }),
              ]} />
            </div>
          </Description>
        </div>
        {close}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        {canSee ? (
          <Button size="sm" className={TOUCH} asChild><a href={fileUrl(f.id)} download><DownloadSimpleIcon size={14} /> {t("Download")}</a></Button>
        ) : null}
        {canSee && pk !== "none" ? (
          <Button size="sm" variant="outline" className={TOUCH} asChild>
            <a href={pk === "text" ? fileUrl(f.id, true) : previewUrl(f.id)} target="_blank" rel="noreferrer" aria-label={phone ? t("Open in new tab") : undefined}>
              <ArrowSquareOutIcon size={14} /> {phone ? null : t("Open in new tab")}
            </a>
          </Button>
        ) : null}
        {/* P56: straight from the file to the AI: the composer opens with it attached. */}
        {canSee && !held ? (
          <Button size="sm" variant="outline" className={TOUCH} aria-label={phone ? t("Ask AI about this file") : undefined}
            onClick={() => openTaskComposer({ kind: "general", files: [{ id: f.id, name: f.name }], brief: tr("About the attached file: ") })}>
            <SparkleIcon size={14} /> {phone ? null : t("Ask AI about this file")}
          </Button>
        ) : null}
        {canEdit ? (
          <Button size="sm" variant="ghost" className={TOUCH} onClick={() => setMoving(true)} aria-label={phone ? t("Move to folder") : undefined}>
            <FolderOpenIcon size={14} /> {phone ? null : t("Move|file")}
          </Button>
        ) : null}
        {canSee ? <PinButton kind="file" refId={f.id} title={name} withLabel={!phone} className={phone ? "pointer-coarse:size-11" : undefined} /> : null}
        {more}
        <span className="flex min-w-0 flex-wrap items-center gap-1.5 sm:ml-auto">
          <ReviewPill status={review} />
          <FileStatus f={f} />
          {held ? <Pill tone="warn"><ShieldWarningIcon size={12} weight="bold" /> {t("Held back")}</Pill> : null}
          {f.library ? <Pill tone="accent">{t("Guideline")}</Pill> : null}
        </span>
      </div>

      <div className="mt-2 flex min-w-0 items-end justify-between gap-2">
        <PageTabs<FileTab> value={tab} onChange={onTab} label={t("File")} className="mx-0 min-w-0 flex-1 border-b-0 px-0"
          tabs={[{ value: "preview", label: t("Preview"), icon: EyeIcon }, { value: "details", label: t("Details"), icon: InfoIcon }]} />
        {nav ? <div className="flex shrink-0 items-center gap-1 pb-1.5">{nav}</div> : null}
      </div>
    </div>
  );

  const preview = (
    <div role="tabpanel" aria-label={t("File preview")} data-vaul-no-drag className="flex min-h-0 flex-1 flex-col gap-2 bg-surface-2/40 p-3 sm:p-4">
      {page && pk === "pdf" && canSee ? <p className="text-[12px] text-muted">{t("Opened at page {n}, where your search found it.", { n: page })}</p> : null}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-soft)]">
        <Preview f={f} canSee={canSee} page={page} onDetails={() => onTab("details")} />
      </div>
      {pk === "office" && canSee ? <p className="text-[12px] text-muted">{t("Office files are shown as a PDF. Download gives you the original.")}</p> : null}
    </div>
  );

  const details = (
    <div role="tabpanel" aria-label={t("File details")} data-sheet-body className={cn(SHEET_BODY, "px-4 py-4 sm:px-6 sm:py-5")}>
      <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-5">
        <FileProvenanceCard fileId={f.id} />

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

        <section className="grid gap-1.5">
          <h3 className="text-[13px] font-semibold">{t("What it is")}</h3>
          <p className="max-w-[65ch] text-[13.5px] leading-relaxed text-pretty">{f.status === "reading" ? t("Reading the file…") : f.summary || t("No summary (no AI model was available when it was read).")}</p>
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
      </div>
    </div>
  );

  return (
    <>
      {header}
      {tab === "preview" ? preview : details}

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
    </>
  );
}

/** The header and preview shapes while the file loads. */
export function FileViewSkeleton({ close }: { close: ReactNode }) {
  return (
    <>
      <div className="shrink-0 border-b border-border px-4 pt-2 pb-3 sm:px-6 sm:pt-5">
        <div className="flex items-start gap-3">
          <Skeleton className="size-10 shrink-0" />
          <div className="grid flex-1 gap-2"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-3.5 w-1/2" /></div>
          {close}
        </div>
        <div className="mt-3 flex gap-2"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-32" /><Skeleton className="h-8 w-20" /></div>
        <div className="mt-4 flex gap-4"><Skeleton className="h-5 w-20" /><Skeleton className="h-5 w-20" /></div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col bg-surface-2/40 p-3 sm:p-4"><Skeleton className="min-h-0 flex-1" /></div>
    </>
  );
}

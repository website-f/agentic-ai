/**
 * P109: files for a person's task, every way people have them: upload (or drop) from the
 * computer or phone, pick from the office's Files or Library, paste a screenshot (Ctrl+V
 * anywhere in the form) or capture one of a screen, window or tab. Uploads go to the office's
 * Files; the caller links them to the task.
 */
import { BooksIcon, CameraIcon, FolderOpenIcon, MagnifyingGlassIcon, PaperclipIcon, UploadSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { FileGlyph, FilePicker } from "@/components/file-drop";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys, uploadFile, type DocFile } from "@/lib/documents";
import { libraryQuery } from "@/lib/library";
import { canCaptureScreen, captureScreen, pastedImages } from "@/lib/people-tasks";
import { cn } from "@/lib/utils";

export interface PickedFile {
  id: string;
  name: string;
  mime?: string;
}

/** Upload these files to the office's Files (one by one, each reported), the done ones back. */
export function useUploader(branchId?: string | null) {
  const t = useT();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(0);
  const upload = async (list: File[]): Promise<DocFile[]> => {
    if (!list.length) return [];
    setBusy((n) => n + list.length);
    const done: DocFile[] = [];
    for (const f of list) {
      try {
        done.push(await uploadFile(f, { branch_id: branchId }));
      } catch (e) {
        toast.error(t("{name}: {why}", { name: f.name, why: errorMessage(e) }));
      }
      setBusy((n) => n - 1);
    }
    if (done.length) void qc.invalidateQueries({ queryKey: docKeys.files });
    return done;
  };
  return { upload, busy };
}

/** Ctrl+V of a screenshot anywhere on the page while this is mounted: uploaded and added. */
export function usePasteScreenshots(onFiles: (files: File[]) => void, enabled = true) {
  const handler = useRef(onFiles);
  useEffect(() => {
    handler.current = onFiles;
  });
  useEffect(() => {
    if (!enabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = pastedImages(e);
      if (!files.length) return;
      e.preventDefault();
      handler.current(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [enabled]);
}

/** Pick one of the Library's files (guidelines, manuals, policies) the person may read. */
export function LibraryPicker({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (o: boolean) => void; onPick: (f: PickedFile) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({ ...libraryQuery, enabled: open });
  const needle = q.trim().toLowerCase();
  const files = (data?.sources ?? []).filter((s) => s.kind === "file" && (!needle || `${s.title} ${s.name}`.toLowerCase().includes(needle)));
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("Pick from the Library")} className="w-[min(96vw,40rem)]"
      description={t("Guidelines, manuals and policies you may read. The file stays in the Library; the task links to it.")}>
      <div className="grid gap-3">
        <label className="relative">
          <MagnifyingGlassIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search the Library")} className="pl-9" aria-label={t("Search the Library")} />
        </label>
        <ul className="grid max-h-[46dvh] gap-1 overflow-y-auto">
          {isLoading ? <li className="px-2 py-3 text-[13px] text-muted">{t("Loading…")}</li>
            : !files.length ? <li className="px-2 py-3 text-[13px] text-muted">{q ? t("No files match.") : t("No files in the Library yet.")}</li>
            : files.slice(0, 200).map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => { onPick({ id: s.id, name: s.title || s.name, mime: s.mime }); onOpenChange(false); }}
                  className="grid min-h-11 w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-sm px-2.5 py-2 text-left hover:bg-surface-2">
                  <FileGlyph mime={s.mime} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{s.title || s.name}</span>
                    <span className="block truncate text-[12px] text-muted">{s.scope_label}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      </div>
    </ResponsiveDialog>
  );
}

/** The buttons and the drop zone; `files` are the ones picked so far (removable). */
export function AttachBar({ files, onAdd, onRemove, branchId, busy: outerBusy, compact }: {
  files: PickedFile[];
  onAdd: (files: PickedFile[]) => void;
  onRemove?: (id: string) => void;
  branchId?: string | null;
  busy?: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [pickFiles, setPickFiles] = useState(false);
  const [pickLibrary, setPickLibrary] = useState(false);
  const { upload, busy } = useUploader(branchId);
  const add = async (list: File[]) => {
    const done = await upload(list);
    if (done.length) onAdd(done.map((f) => ({ id: f.id, name: f.name, mime: f.mime })));
  };
  usePasteScreenshots((fs) => {
    toast(t("Screenshot pasted. Uploading…"), { duration: 1500 });
    void add(fs);
  });
  const capture = async () => {
    try {
      const f = await captureScreen();
      if (f) await add([f]);
    } catch (e) {
      if ((e as DOMException)?.name !== "NotAllowedError") toast.error(errorMessage(e));
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void add(Array.from(e.dataTransfer.files));
  };
  const working = busy > 0 || !!outerBusy;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn("grid min-w-0 gap-2 rounded-[var(--radius-md)] border border-dashed p-2.5 transition-colors", over ? "border-accent bg-accent-soft/40" : "border-border bg-surface-2/30")}
    >
      <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) void add(Array.from(e.target.files)); e.target.value = ""; }} />
      {files.length ? (
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label={t("Attached files")}>
          {files.map((f) => (
            <li key={f.id} className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pr-1 pl-2 text-[12.5px]">
              <FileGlyph mime={f.mime ?? ""} size={14} />
              <span className="truncate">{f.name}</span>
              {onRemove ? (
                <button type="button" aria-label={t("Remove {name}", { name: f.name })} onClick={() => onRemove(f.id)}
                  className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"><XIcon size={12} /></button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Button size="sm" variant="outline" loading={working} onClick={() => input.current?.click()}><UploadSimpleIcon size={14} /> {t("Upload")}</Button>
        <Button size="sm" variant="outline" onClick={() => setPickFiles(true)}><FolderOpenIcon size={14} /> {t("From Files")}</Button>
        <Button size="sm" variant="outline" onClick={() => setPickLibrary(true)}><BooksIcon size={14} /> {t("From the Library")}</Button>
        {canCaptureScreen() ? <Button size="sm" variant="outline" onClick={() => void capture()}><CameraIcon size={14} /> {t("Screenshot")}</Button> : null}
      </div>
      {compact ? null : (
        <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><PaperclipIcon size={12} className="shrink-0" /> {t("Drop files here, or paste a screenshot with Ctrl+V.")}</p>
      )}
      <FilePicker open={pickFiles} onOpenChange={setPickFiles} branchId={branchId} title={t("Files for this task")}
        onPick={(f) => onAdd([{ id: f.id, name: f.title || f.name, mime: f.mime }])} />
      <LibraryPicker open={pickLibrary} onOpenChange={setPickLibrary} onPick={(f) => onAdd([f])} />
    </div>
  );
}

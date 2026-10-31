/** The file panel: any file in the Library opens here, off to the side of the folder browser,
 * which stays where it was behind it. Tablets and desktops: a wide panel docked right. Phones: a
 * full-height bottom drawer with a drag handle. The address keeps the open file (?f=, and ?page=
 * for a search hit), so back, forward and links work.
 *
 * Previous / next (and the ← → keys) step through the files listed behind the panel, in the
 * order they are shown. Rows mark themselves with `data-file-row="<id>"` on an element inside
 * their button; the panel reads that order from the page, so every list (a folder, a group, a
 * task's files, the grid) works without passing it down. Closing gives focus back to the row
 * of the file that was open last. */
import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Dialog } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Drawer } from "vaul";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { fileQuery } from "@/lib/documents";
import type { CompanyFile, FolderNode } from "@/lib/intake";
import { meQuery } from "@/lib/queries";
import { hasAny } from "@/lib/types";
import { useIsPhone } from "@/lib/use-media";

import { useFolderTree } from "../library-hub/tree";
import { FileView, FileViewSkeleton, type FileTab } from "./files-viewer";

/** The attribute a row puts on an element inside its button. */
export const FILE_ROW = "data-file-row";

/** The files listed in the browser, in the order shown (each once). */
function rowIds(root: ParentNode): string[] {
  const seen = new Set<string>();
  for (const el of root.querySelectorAll<HTMLElement>(`[${FILE_ROW}]`)) {
    const id = el.getAttribute(FILE_ROW);
    if (id) seen.add(id);
  }
  return [...seen];
}

/** The button of a file's row, to step to it and to give focus back to it. */
function rowButton(id: string): HTMLElement | null {
  const mark = document.querySelector(`[${FILE_ROW}="${CSS.escape(id)}"]`);
  return mark?.closest<HTMLElement>("button, a") ?? null;
}

/** Keeps the list of shown files while the panel is open: more load, filters change. */
function useRowIds(open: boolean): string[] {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    const root = document.querySelector("[data-file-browser]") ?? document.body;
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = rowIds(root);
      setIds((old) => (old.length === next.length && old.every((x, i) => x === next[i]) ? old : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    schedule();
    const watch = new MutationObserver(schedule);
    watch.observe(root, { childList: true, subtree: true });
    return () => {
      watch.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [open]);
  return ids;
}

/** Keys that belong to the control that has focus, not to stepping through files. */
const OWN_KEYS = "input, textarea, select, [contenteditable='true'], [role='combobox'], [role='slider'], [role='listbox'], [role='menu']";

export function FilePanel({ id, page, onClose, onStep }: {
  /** The open file; none closes the panel. */
  id?: string;
  page?: number;
  onClose: () => void;
  /** Open another file in its place (previous / next). */
  onStep: (id: string) => void;
}) {
  const t = useT();
  const phone = useIsPhone();
  const open = !!id;
  // The last file stays on screen while the panel slides away, and its row gets focus back.
  const [last, setLast] = useState(id);
  if (id && id !== last) setLast(id);
  const shown = id ?? last;
  // Each opening starts on the preview; stepping to the next file keeps the tab you are on.
  const [tab, setTab] = useState<FileTab>("preview");
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTab("preview");
  }

  const ids = useRowIds(open);
  const at = shown ? ids.indexOf(shown) : -1;
  const prev = at > 0 ? ids[at - 1] : undefined;
  const next = at >= 0 && at < ids.length - 1 ? ids[at + 1] : undefined;
  const step = (to: string | undefined) => {
    if (!to) return;
    onStep(to);
    // Keep the row in view behind the panel, so closing lands on it.
    rowButton(to)?.scrollIntoView({ block: "nearest" });
  };

  const content = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const el = e.target as HTMLElement;
    // Menus and dialogs opened from the panel live elsewhere on the page: leave their keys alone.
    if (!e.currentTarget.contains(el) || el.closest(OWN_KEYS)) return;
    const to = e.key === "ArrowLeft" ? prev : next;
    if (!to) return;
    e.preventDefault();
    step(to);
  };
  // Focus goes to the panel itself (its title is read out), so ← → work straight away.
  const onOpenAutoFocus = (e: Event) => {
    e.preventDefault();
    content.current?.focus({ preventScroll: true });
  };
  const onCloseAutoFocus = (e: Event) => {
    const row = last ? rowButton(last) : null;
    if (!row) return;
    e.preventDefault();
    row.focus({ preventScroll: true });
  };

  const close = (
    <Button size="icon-sm" variant="ghost" className="-mt-0.5 -mr-1.5 shrink-0 pointer-coarse:size-11" aria-label={t("Close")} onClick={onClose}>
      <XIcon size={18} />
    </Button>
  );
  const nav = at >= 0 && ids.length > 1 ? (
    <>
      <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" disabled={!prev} onClick={() => step(prev)}
        aria-label={t("Previous file")} title={`${t("Previous file")} (←)`}>
        <CaretLeftIcon size={16} weight="bold" />
      </Button>
      <span className="min-w-14 text-center text-[12px] whitespace-nowrap text-muted tabular-nums max-sm:sr-only" aria-live="polite">
        {t("{n} of {total}", { n: at + 1, total: ids.length })}
      </span>
      <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" disabled={!next} onClick={() => step(next)}
        aria-label={t("Next file")} title={`${t("Next file")} (→)`}>
        <CaretRightIcon size={16} weight="bold" />
      </Button>
    </>
  ) : null;

  const body = (Title: typeof Dialog.Title, Description: typeof Dialog.Description) =>
    shown ? (
      <PanelBody id={shown} page={id ? page : undefined} tab={tab} onTab={setTab} onClose={onClose} close={close} nav={nav}
        phone={phone} Title={Title} Description={Description} />
    ) : null;

  if (phone) {
    return (
      <Drawer.Root open={open} onOpenChange={(o) => !o && onClose()}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Drawer.Content ref={content} onKeyDown={onKeyDown} onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}
            className="fixed inset-x-0 bottom-0 z-50 flex max-w-[100vw] flex-col overflow-hidden rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
            style={{ height: "calc(100dvh - max(0.5rem, env(safe-area-inset-top)))", paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div aria-hidden className="mx-auto mt-2 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-border" />
            {body(Drawer.Title as typeof Dialog.Title, Drawer.Description as typeof Dialog.Description)}
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/25 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <Dialog.Content ref={content} onKeyDown={onKeyDown} onOpenAutoFocus={onOpenAutoFocus} onCloseAutoFocus={onCloseAutoFocus}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(92vw,56rem)] flex-col border-l border-border bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[sheet-in_220ms_cubic-bezier(0.16,1,0.3,1)] 2xl:w-[min(92vw,60rem)]">
          {body(Dialog.Title, Dialog.Description)}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Loads the file, its company and that company's folders (to move it), then shows it. */
function PanelBody({ id, page, tab, onTab, onClose, close, nav, phone, Title, Description }: {
  id: string;
  page?: number;
  tab: FileTab;
  onTab: (tab: FileTab) => void;
  onClose: () => void;
  close: ReactNode;
  nav: ReactNode;
  phone: boolean;
  Title: typeof Dialog.Title;
  Description: typeof Dialog.Description;
}) {
  const t = useT();
  const co = useCompanies();
  const { data: me } = useQuery(meQuery);
  const { data, error } = useQuery(fileQuery(id));
  const f = data as CompanyFile | undefined;
  const branch = co.branches.find((b) => b.id === f?.branch_id) ?? null;
  const { root } = useFolderTree(f?.branch_id ?? null);
  const folders = useMemo(() => {
    const out: string[] = [];
    const walk = (n: FolderNode) => { if (n.path) out.push(n.path); n.children.forEach(walk); };
    walk(root);
    return out;
  }, [root]);

  if (!f && error) {
    return (
      <>
        <div className="flex shrink-0 items-start gap-3 border-b border-border px-4 pt-2 pb-3 sm:px-6 sm:pt-5 sm:pb-4">
          <div className="grid min-w-0 flex-1 gap-1">
            <Title className="text-[17px] font-semibold">{t("File")}</Title>
            <Description asChild><p className="text-[12.5px] text-muted">{t("This file could not be opened.")}</p></Description>
          </div>
          {close}
        </div>
        <p role="alert" className="px-4 py-5 text-[13.5px] text-danger sm:px-6">{errorMessage(error)}</p>
      </>
    );
  }
  if (!f) {
    return (
      <>
        <Title className="sr-only">{t("File")}</Title>
        <Description className="sr-only">{t("Loading the file…")}</Description>
        <FileViewSkeleton close={close} />
      </>
    );
  }
  return (
    <FileView f={f} branch={branch} folders={folders} page={page} tab={tab} onTab={onTab} onClose={onClose} close={close} nav={nav}
      phone={phone} Title={Title} Description={Description}
      canEdit={!!me && hasAny(me, "work.write")} canManage={!!me && hasAny(me, "org.manage", "vault.manage")} />
  );
}

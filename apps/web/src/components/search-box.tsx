/** P25: the header's document search. Type and suggestions appear (your recent searches,
 * words from your own documents, titles, headings); ↑ ↓ Enter Esc; Enter searches everything
 * on the Search page. A popover on wider screens, a full-screen sheet on phones. */
import {
  ArrowElbowDownLeftIcon,
  ArrowLeftIcon,
  ClockCounterClockwiseIcon,
  FileTextIcon,
  FilesIcon,
  MagnifyingGlassIcon,
  StackIcon,
  BrainIcon,
  TextAlignLeftIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, Popover } from "radix-ui";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useT } from "@/i18n";
import { useCompanies } from "@/lib/company";
import { clearRecent, markParts, safeHref, searchKeys, suggestQuery, useDebounced, type HitType, type Suggestion } from "@/lib/search";
import { usePalette } from "@/lib/stores";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { Button } from "./ui/button";

/** A snippet from the server: text with <mark> runs. Never rendered as HTML. */
export function Marked({ html, className }: { html: string; className?: string }) {
  return (
    <span className={className}>
      {markParts(html).map((p, i) =>
        p.mark ? (
          <mark key={i} className="rounded-[3px] bg-warn/25 px-0.5 text-fg [box-decoration-break:clone]">{p.text}</mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

export const TYPE_ICON: Record<HitType, Icon> = {
  file: FilesIcon,
  sop: FileTextIcon,
  document: FilesIcon,
  template: StackIcon,
  page: BrainIcon,
};

/** Open a hit or suggestion. Files open in Company files, which shows one company at a time:
 * switch to the file's company first. */
export function useOpenTarget() {
  const navigate = useNavigate();
  const co = useCompanies();
  return (url: string | null | undefined, type?: HitType | null, branchId?: string | null) => {
    const href = safeHref(url);
    if (!href) return;
    if (type === "file") {
      const want = branchId && co.branches.some((b) => b.id === branchId) ? branchId : co.one?.id;
      if (want && (co.isAll || co.selected?.id !== want)) co.select(want);
    }
    void navigate({ href });
  };
}

interface Row {
  key: string;
  icon: Icon;
  label: ReactNode;
  hint?: string;
  run: () => void;
}

function useRows(q: string, items: Suggestion[], go: (text: string) => void, open: ReturnType<typeof useOpenTarget>, done: () => void): Row[] {
  const t = useT();
  const rows: Row[] = [];
  const text = q.trim();
  if (text) {
    rows.push({
      key: "all",
      icon: MagnifyingGlassIcon,
      label: <>{t("Search all documents for “{q}”", { q: text })}</>,
      run: () => go(text),
    });
  }
  for (const s of items) {
    const hint =
      s.kind === "recent" ? t("Recent") : s.kind === "term" ? t("Word") : s.kind === "heading" ? (s.page ? t("Heading, p.{n}", { n: s.page }) : t("Heading")) : typeLabel(t, s.type);
    const icon = s.kind === "recent" ? ClockCounterClockwiseIcon : s.kind === "term" ? MagnifyingGlassIcon : s.kind === "heading" ? TextAlignLeftIcon : TYPE_ICON[s.type ?? "file"];
    rows.push({
      key: `${s.kind}:${s.id ?? ""}:${s.page ?? ""}:${s.text}`,
      icon,
      label: s.text,
      hint,
      run: () => {
        if (s.kind === "recent" || s.kind === "term") go(s.text);
        else {
          done();
          open(s.url, s.type, s.branch_id);
        }
      },
    });
  }
  return rows;
}

export function typeLabel(t: (s: string, v?: Record<string, string | number>) => string, type?: HitType | null): string {
  switch (type) {
    case "sop":
      return "SOP";
    case "document":
      return t("Document");
    case "template":
      return t("Template");
    case "page":
      return t("Wiki page");
    default:
      return t("File");
  }
}

function RowList({ rows, active, setActive, listId, empty }: { rows: Row[]; active: number; setActive: (i: number) => void; listId: string; empty?: ReactNode }) {
  const box = useRef<HTMLUListElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLElement>(`[data-row="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);
  if (!rows.length) return <>{empty}</>;
  return (
    <ul ref={box} id={listId} role="listbox" className="grid gap-0.5 p-1.5">
      {rows.map((r, i) => {
        const IconCmp = r.icon;
        return (
          <li
            key={r.key}
            id={`${listId}-${i}`}
            data-row={i}
            role="option"
            aria-selected={i === active}
            onMouseMove={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={r.run}
            className={cn(
              "group flex min-h-11 cursor-pointer items-center gap-3 rounded-sm px-2.5 py-2 text-[13.5px] sm:min-h-10",
              i === active ? "bg-surface-2" : "",
            )}
          >
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-muted ring-1 ring-border/60", i === active && "bg-accent-soft text-accent ring-accent/15")}>
              <IconCmp size={15} />
            </span>
            <span className="min-w-0 flex-1 truncate">{r.label}</span>
            {r.hint ? <span className="shrink-0 rounded-full bg-surface-2 px-2 text-[11px] text-muted group-aria-selected:bg-surface">{r.hint}</span> : null}
            <ArrowElbowDownLeftIcon size={14} className={cn("shrink-0 text-muted max-sm:hidden", i === active ? "visible" : "invisible")} aria-hidden />
          </li>
        );
      })}
    </ul>
  );
}

/** The input, suggestions and keys, shared by the popover, the phone sheet and the Search page. */
export function useSearchBox({ initial = "", onDone, live = false }: { initial?: string; onDone?: () => void; live?: boolean } = {}) {
  const navigate = useNavigate();
  const co = useCompanies();
  const qc = useQueryClient();
  const open = useOpenTarget();
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(live);
  const debounced = useDebounced(q, 150);
  const branch = co.isAll ? undefined : co.selected?.id;
  const { data, isFetching } = useQuery(suggestQuery(debounced, branch, focused));
  const items = data?.suggestions ?? [];
  const done = () => onDone?.();
  const go = (text: string) => {
    setQ(text);
    done();
    void navigate({ to: "/search", search: { q: text } });
    void qc.invalidateQueries({ queryKey: searchKeys.all });
  };
  const rows = useRows(q, debounced === q || !q ? items : items.filter((s) => s.kind !== "term"), go, open, done);
  // New suggestions start the highlight at the top (state adjusted while rendering).
  const [shownFor, setShownFor] = useState(debounced);
  if (shownFor !== debounced) {
    setShownFor(debounced);
    setActive(0);
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i + 1) % rows.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = rows[active] ?? rows[0];
      if (r) r.run();
      else if (q.trim()) go(q.trim());
    } else if (e.key === "Escape") {
      if (q && !onDone) setQ("");
      else done();
      (e.target as HTMLInputElement).blur();
    }
  };
  const clear = async () => {
    await clearRecent().catch(() => undefined);
    void qc.invalidateQueries({ queryKey: ["search", "suggest"] });
  };
  return { q, setQ, rows, active, setActive, onKeyDown, focused, setFocused, isFetching, hasRecent: items.some((s) => s.kind === "recent"), clear };
}

function Footer({ onPalette, hasRecent, onClear }: { onPalette: () => void; hasRecent: boolean; onClear: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-surface-2/40 px-3 py-2 text-[11.5px] text-muted">
      <span className="flex items-center gap-1.5 max-sm:hidden"><Key>↑</Key><Key>↓</Key> {t("Move")}</span>
      <span className="flex items-center gap-1.5 max-sm:hidden"><Key>Enter</Key> {t("Open|verb")}</span>
      <span className="flex items-center gap-1.5 max-sm:hidden"><Key>Esc</Key> {t("Close")}</span>
      {hasRecent ? (
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClear} className="hover:text-fg hover:underline">
          {t("Clear recent searches")}
        </button>
      ) : null}
      <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onPalette} className="ml-auto hover:text-fg hover:underline">
        {t("Jump to a page instead")}
      </button>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-[5px] border border-border bg-surface px-1 font-sans text-[11px] text-muted">{children}</kbd>;
}

function Hint() {
  const t = useT();
  return (
    <div className="px-4 py-5 text-[13px] text-muted">
      <p className="font-medium text-fg">{t("Search inside every document")}</p>
      <p className="mt-1">{t("A phrase from a handbook page, an amount like RM700, a form name or a job title. Put words in quotes for an exact phrase.")}</p>
    </div>
  );
}

/** A search box with suggestions in a popover under it: the header's (tablets and up, "/"
 * jumps to it) and the Search page's. */
export function SearchField({ variant = "header", initial = "", autoFocus }: { variant?: "header" | "page"; initial?: string; autoFocus?: boolean }) {
  const t = useT();
  const setPalette = usePalette((s) => s.setOpen);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const page = variant === "page";
  const box = useSearchBox({ initial, onDone: () => { setOpen(false); input.current?.blur(); } });
  // The Search page's box follows the address (a recent search picked below it).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    box.setQ(initial);
  }
  // "/" anywhere (not while typing) jumps to the header's box.
  useEffect(() => {
    if (page) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page]);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div data-guide={page ? "search.box" : "shell.search"} className={page ? "relative w-full min-w-0" : "relative hidden w-56 md:block lg:w-80"}>
          <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={input}
            type="search"
            enterKeyHint="search"
            autoFocus={autoFocus}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-activedescendant={open && box.rows.length ? `${listId}-${box.active}` : undefined}
            aria-label={t("Search documents")}
            placeholder={t("Search documents…")}
            value={box.q}
            onChange={(e) => { box.setQ(e.target.value); setOpen(true); }}
            onFocus={() => { box.setFocused(true); setOpen(true); }}
            onBlur={() => setOpen(false)}
            onKeyDown={box.onKeyDown}
            className={cn(
              "w-full rounded-sm border border-border bg-surface pr-9 pl-9 text-fg placeholder:text-muted focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden",
              page ? "h-11 text-[16px] sm:text-[15px]" : "h-9 text-[13.5px]",
            )}
          />
          {box.q ? (
            <button type="button" aria-label={t("Clear search")} onMouseDown={(e) => e.preventDefault()} onClick={() => box.setQ("")}
              className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
              <XIcon size={13} />
            </button>
          ) : page ? null : (
            <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border px-1.5 font-mono text-[11px] text-muted">/</kbd>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => { if (e.target instanceof Node && input.current?.parentElement?.contains(e.target)) e.preventDefault(); }}
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-[max(var(--radix-popover-trigger-width),min(calc(100vw-1.5rem),32rem))] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <div className="max-h-[min(26rem,60dvh)] min-h-0 overflow-y-auto overscroll-contain">
            <RowList rows={box.rows} active={box.active} setActive={box.setActive} listId={listId} empty={<Hint />} />
          </div>
          <Footer hasRecent={box.hasRecent} onClear={() => void box.clear()} onPalette={() => { setOpen(false); setPalette(true); }} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Phones: a search button that opens a full-screen sheet. */
function PhoneSearch() {
  const t = useT();
  const setPalette = usePalette((s) => s.setOpen);
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label={t("Search documents")} data-guide="shell.search-phone">
          <MagnifyingGlassIcon size={18} />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-surface outline-none data-[state=open]:animate-[fade-in_120ms_ease-out]"
          style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <Dialog.Title className="sr-only">{t("Search documents")}</Dialog.Title>
          {open ? <PhoneSheet listId={listId} onClose={() => setOpen(false)} onPalette={() => { setOpen(false); setPalette(true); }} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PhoneSheet({ listId, onClose, onPalette }: { listId: string; onClose: () => void; onPalette: () => void }) {
  const t = useT();
  const box = useSearchBox({ onDone: onClose, live: true });
  return (
    <>
      <div className="flex items-center gap-2 border-b border-border px-2 py-2">
        <Button variant="ghost" size="icon-sm" aria-label={t("Close")} onClick={onClose}><ArrowLeftIcon size={18} /></Button>
        <div className="relative min-w-0 flex-1">
          <input
            autoFocus
            type="search"
            enterKeyHint="search"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-label={t("Search documents")}
            placeholder={t("Search documents…")}
            value={box.q}
            onChange={(e) => box.setQ(e.target.value)}
            onKeyDown={box.onKeyDown}
            className="h-11 w-full rounded-sm border border-border bg-surface-2/40 pr-9 pl-3 text-[16px] text-fg placeholder:text-muted focus-visible:border-accent focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {box.q ? (
            <button type="button" aria-label={t("Clear search")} onClick={() => box.setQ("")}
              className="absolute top-1/2 right-2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2">
              <XIcon size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <RowList rows={box.rows} active={box.active} setActive={box.setActive} listId={listId} empty={<Hint />} />
      </div>
      <Footer hasRecent={box.hasRecent} onClear={() => void box.clear()} onPalette={onPalette} />
    </>
  );
}

/** The header's search: the box (tablets and up) and the button (phones). */
export function HeaderSearch() {
  const phone = useIsPhone();
  return phone ? <PhoneSearch /> : <SearchField />;
}

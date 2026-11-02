/** One file or folder in the explorer, as a tile (grid), a row (list) or a row of columns
 * (details), plus the inline rename box and the details view's column headings. Selection,
 * dragging and menus are handled by the file area (browser.tsx); this only draws. */
import { ArrowDownIcon, ArrowUpIcon, FolderIcon, FolderSimpleIcon, ShieldWarningIcon } from "@phosphor-icons/react";
import { useRef, useState, type HTMLAttributes, type ReactNode } from "react";

import { FileStatus } from "@/components/file-drop";
import { LabelChips } from "@/components/file-labels";
import { MadeBy, ReviewPill } from "@/components/provenance";
import { Pill } from "@/components/ui/pill";
import { locale, useT } from "@/i18n";
import { fileSize, fileUrl } from "@/lib/documents";
import { FILE_TYPES, fileType, splitExt, type ExplorerFile, type Item, type SortDir, type SortField } from "@/lib/explorer";
import { kindKey, kindLabel } from "@/lib/intake";
import { fileOrigin } from "@/lib/provenance";
import { cn, timeAgo } from "@/lib/utils";

import { FileTile, KindTile } from "../documents/visuals";

export type Layout = "grid" | "list" | "details";

/** The details view's columns: name, labels, type, size, modified, made by, actions. */
export const DETAILS_COLS = "grid-cols-[2rem_minmax(14rem,2.6fr)_minmax(8rem,1.5fr)_6.5rem_5.5rem_7.5rem_minmax(8rem,1.2fr)_2.75rem]";

function FolderGlyph({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const box = size === "sm" ? "size-8" : size === "lg" ? "size-14" : "size-10";
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-[var(--radius-sm)] bg-warn/12 text-warn ring-1 ring-warn/20 ring-inset", box)}>
      <FolderIcon size={size === "lg" ? 30 : size === "sm" ? 17 : 21} weight="duotone" />
    </span>
  );
}

function FileGlyph({ f, size = "md" }: { f: ExplorerFile; size?: "sm" | "md" | "lg" }) {
  const kk = kindKey(f.kind);
  return kk === "other" ? <FileTile mime={f.mime} name={f.name} size={size} /> : <KindTile kind={kk} size={size} />;
}

/** An image file shows itself in the grid; anything else its type's icon. */
function Thumb({ f, canSee }: { f: ExplorerFile; canSee: boolean }) {
  const [failed, setFailed] = useState(false);
  if (fileType(f) === "image" && canSee && !failed && f.status !== "reading") {
    return <img src={fileUrl(f.id, true)} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="size-full object-cover" />;
  }
  return <FileGlyph f={f} size="lg" />;
}

export const isAiMade = (f: ExplorerFile) => fileOrigin(f) === "agent";

/** Rename in place: Enter keeps it, Escape or an unchanged name leaves it as it was. The file
 * name's extension stays out of the first selection, as in a file manager. */
export function RenameBox({ value, onDone, className, label, fresh }: {
  value: string;
  onDone: (name: string | null) => void;
  className?: string;
  label: string;
  /** Naming something new: the suggested name counts as a choice. */
  fresh?: boolean;
}) {
  const [text, setText] = useState(value);
  const settled = useRef(false);
  const done = (keep: boolean) => {
    if (settled.current) return;
    settled.current = true;
    onDone(keep && text.trim() && (fresh || text.trim() !== value) ? text.trim() : null);
  };
  return (
    <input value={text} autoFocus aria-label={label} maxLength={200}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.setSelectionRange(0, splitExt(value)[0].length)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); done(true); }
        if (e.key === "Escape") { e.preventDefault(); done(false); }
      }}
      onBlur={() => done(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn("h-8 w-full min-w-0 rounded-sm border border-accent bg-surface px-2 text-[13.5px] text-fg ring-3 ring-accent/20 outline-none pointer-coarse:h-10", className)} />
  );
}

export interface ItemViewProps {
  item: Item;
  layout: Layout;
  selected: boolean;
  /** The one item the keyboard is on (tab stop). */
  current: boolean;
  /** Cut to the clipboard: shown faded until pasted. */
  cut: boolean;
  /** Open in the file panel. */
  active: boolean;
  /** Something is dragged over this folder and may drop here. */
  dropOver: boolean;
  /** Show the folder it sits in (search results, filters). */
  showPath: boolean;
  /** Checkboxes show (something is selected, or a touch screen in select mode). */
  selecting: boolean;
  /** May see held-back files (their thumbnails). */
  canManage: boolean;
  renaming: boolean;
  onRename: (name: string | null) => void;
  onToggle: () => void;
  /** Events of the item itself: click, double-click, context menu, long-press, drag and drop. */
  events: HTMLAttributes<HTMLDivElement>;
  /** The "…" menu (touch, and anyone who prefers a button). */
  menu: ReactNode;
}

export function ItemView(p: ItemViewProps) {
  const t = useT();
  const { item, layout } = p;
  const f = item.kind === "file" ? item.file : null;
  const held = !!f?.quarantined;
  const name = item.name;
  const sub = f && f.title && f.title !== f.name ? f.title : null;
  const where = f ? f.folder || t("Top level") : item.kind === "folder" && item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : t("Top level");
  const folderMeta = item.kind === "folder" ? (item.files === 1 ? t("1 file") : item.files ? t("{n} files", { n: item.files.toLocaleString(locale()) }) : t("Empty")) : "";
  const date = f ? f.updated_at ?? f.created_at : null;

  const check = (
    <input type="checkbox" checked={p.selected} tabIndex={-1} onChange={p.onToggle}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      aria-label={t("Select {name}", { name })}
      className={cn("size-4 accent-[var(--accent)] transition-opacity pointer-coarse:size-5",
        p.selecting || p.selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden")} />
  );
  const nameNode = p.renaming
    ? <RenameBox value={name} onDone={p.onRename} label={t("New name for {name}", { name })} />
    : <span data-file-row={f?.id} className={cn("min-w-0 font-medium break-words [overflow-wrap:anywhere]", layout === "grid" ? "line-clamp-2 text-[13px]" : "truncate text-[13.5px]")} title={name}>{name}</span>;
  const chips = f ? (
    <>
      {isAiMade(f) ? <MadeBy origin="agent" agentName={f.agent_name} agentColor={f.agent_color} size="sm" /> : null}
      <LabelChips labels={f.labels} max={layout === "grid" ? 2 : 3} />
      {held ? <Pill tone="warn" className="px-2"><ShieldWarningIcon size={12} weight="bold" /> {t("Held back")}</Pill> : null}
      {f.library ? <Pill tone="accent" className="px-2">{t("Guideline")}</Pill> : null}
      <ReviewPill status={f.review_status} />
      {f.status !== "ready" || f.expired ? <FileStatus f={f} /> : null}
    </>
  ) : item.kind === "folder" && item.flagged ? <Pill tone="warn" className="px-2"><ShieldWarningIcon size={12} weight="bold" /> {item.flagged}</Pill> : null;

  const shell = cn(
    "group relative min-w-0 cursor-default outline-none select-none transition-[background-color,box-shadow,opacity] duration-150",
    "focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-inset",
    p.selected ? "bg-accent-soft/70" : "hover:bg-surface-2/70",
    p.active && !p.selected && "bg-accent-soft/35",
    p.dropOver && "bg-accent-soft ring-2 ring-accent ring-inset",
    p.cut && "opacity-55",
  );
  const common = {
    role: "option" as const,
    "aria-selected": p.selected,
    "data-key": item.key,
    "aria-label": name,
    tabIndex: p.current ? 0 : -1,
    ...p.events,
  };

  if (layout === "grid") {
    return (
      <div {...common} className={cn(shell, "flex flex-col gap-2 rounded-[var(--radius-md)] border p-2 pb-2.5",
        p.selected ? "border-accent/50" : "border-border bg-surface", p.dropOver && "border-accent")}>
        <div className="relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[var(--radius-sm)] bg-surface-2/60">
          {f ? <Thumb f={f} canSee={!held || p.canManage} /> : <FolderGlyph size="lg" />}
          <span className="absolute top-1.5 left-1.5 grid place-items-center">{check}</span>
          <span className="absolute top-1 right-1">{p.menu}</span>
        </div>
        <div className="grid min-w-0 gap-0.5 px-0.5">
          {nameNode}
          <span className="truncate text-[11.5px] text-muted">
            {f ? [kindLabel(f.kind), fileSize(f.size)].join(" · ") : `${folderMeta}${item.kind === "folder" && item.size ? ` · ${fileSize(item.size)}` : ""}`}
          </span>
          {p.showPath ? <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-muted"><FolderSimpleIcon size={11} className="shrink-0" /><span className="truncate">{where}</span></span> : null}
        </div>
        {chips ? <div className="flex min-w-0 flex-wrap gap-1 px-0.5">{chips}</div> : null}
      </div>
    );
  }

  if (layout === "details") {
    return (
      <div {...common} className={cn(shell, "grid min-h-11 items-center gap-x-3 border-b border-border/70 pr-1", DETAILS_COLS)}>
        <span className="grid place-items-center">{check}</span>
        <span className="flex min-w-0 items-center gap-2.5 py-1.5">
          {f ? <FileGlyph f={f} size="sm" /> : <FolderGlyph size="sm" />}
          <span className="grid min-w-0 flex-1">
            {nameNode}
            {p.showPath ? <span className="truncate text-[11.5px] text-muted">{where}</span> : sub ? <span className="truncate text-[11.5px] text-muted">{sub}</span> : null}
          </span>
          {held ? <ShieldWarningIcon size={14} weight="bold" className="shrink-0 text-warn" aria-label={t("Held back")} /> : null}
        </span>
        <span className="min-w-0">{f ? <LabelChips labels={f.labels} max={2} /> : null}</span>
        <span className="truncate text-[12.5px] text-muted" title={f ? typeLabel(f, t) : undefined}>{f ? typeLabel(f, t) : t("Folder")}</span>
        <span className="text-right text-[12.5px] text-muted tabular-nums">{f ? fileSize(f.size) : item.kind === "folder" ? fileSize(item.size) : ""}</span>
        <span className="truncate text-[12.5px] text-muted tabular-nums" title={date ? new Date(date).toLocaleString(locale()) : undefined}>{date ? timeAgo(date) : folderMeta}</span>
        <span className="min-w-0">{f ? <MadeBy origin={fileOrigin(f)} agentName={f.agent_name} agentColor={f.agent_color} size="sm" /> : null}</span>
        <span className="grid place-items-center">{p.menu}</span>
      </div>
    );
  }

  // list
  return (
    <div {...common} className={cn(shell, "grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border/70 py-2 pr-1 pl-2.5 pointer-coarse:py-2.5")}>
      <span className={cn("grid w-4 place-items-center pointer-coarse:w-5", !p.selecting && "pointer-coarse:hidden")}>{check}</span>
      {f ? <FileGlyph f={f} /> : <FolderGlyph />}
      <span className="grid min-w-0 gap-0.5">
        {nameNode}
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted">
          {f ? <>
            <span>{kindLabel(f.kind)}</span>
            <span>· {fileSize(f.size)}</span>
            {date ? <span>· {timeAgo(date)}</span> : null}
          </> : <span>{folderMeta}{item.kind === "folder" && item.size ? ` · ${fileSize(item.size)}` : ""}</span>}
          {p.showPath ? <span className="inline-flex min-w-0 items-center gap-1">· <FolderSimpleIcon size={11} className="shrink-0" /><span className="truncate">{where}</span></span> : null}
        </span>
        {sub && !p.renaming ? <span className="truncate text-[12px] text-muted/80">{sub}</span> : null}
        {chips ? <span className="flex min-w-0 flex-wrap items-center gap-1 pt-0.5">{chips}</span> : null}
      </span>
      <span className="self-center">{p.menu}</span>
    </div>
  );
}

function typeLabel(f: ExplorerFile, t: (s: string) => string): string {
  const k = fileType(f);
  const ext = splitExt(f.name)[1].slice(1).toUpperCase();
  const label = t(FILE_TYPES.find((x) => x.key === k)?.label ?? "Other");
  return ext && k !== "pdf" ? `${label} (${ext})` : label;
}

/** The details view's headings: click one to sort by it, again to turn the order round. */
export function DetailsHeader({ sort, dir, onSort, allSelected, someSelected, onSelectAll }: {
  sort: SortField;
  dir: SortDir;
  onSort: (field: SortField) => void;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: (on: boolean) => void;
}) {
  const t = useT();
  const head = (field: SortField | null, label: string, right = false) => {
    if (!field) return <span className={cn("truncate", right && "text-right")}>{label}</span>;
    const on = sort === field;
    const Arrow = dir === "asc" ? ArrowUpIcon : ArrowDownIcon;
    return (
      <button type="button" onClick={() => onSort(field)} aria-sort={on ? (dir === "asc" ? "ascending" : "descending") : undefined}
        className={cn("flex min-w-0 items-center gap-1 rounded-sm py-1 text-left transition-colors hover:text-fg", right && "justify-end", on && "text-fg")}>
        <span className="truncate">{label}</span>
        {on ? <Arrow size={11} weight="bold" className="shrink-0" /> : null}
      </button>
    );
  };
  return (
    <div role="presentation" className={cn("sticky top-0 z-10 grid h-9 items-center gap-x-3 border-b border-border bg-surface/95 pr-1 text-[12px] font-medium text-muted backdrop-blur", DETAILS_COLS)}>
      <span className="grid place-items-center">
        <input type="checkbox" checked={allSelected} ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
          onChange={(e) => onSelectAll(e.target.checked)} aria-label={t("Select all")} className="size-4 accent-[var(--accent)]" />
      </span>
      {head("name", t("Name"))}
      {head(null, t("Labels"))}
      {head("type", t("Type"))}
      {head("size", t("Size"), true)}
      {head("date", t("Modified"))}
      {head(null, t("Made by"))}
      <span />
    </div>
  );
}

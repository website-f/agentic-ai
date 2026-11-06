/** The explorer's file area for one company: the toolbar (up, path, search, new folder,
 * upload, filter, sort, view), the files and folders as a grid, a list or details, and the
 * status bar. Works like a file manager: click selects, Ctrl/Cmd+click adds, Shift+click picks
 * a range, double-click or Enter opens, right-click (or the "…" button) for everything you can
 * do, Ctrl/Cmd+C X V copy, cut and paste into the open folder, F2 renames, Delete deletes,
 * Backspace goes up, and files and folders drag onto folders. Phones: tap opens, a long press
 * selects, and a bar at the bottom acts on what is selected. */
import {
  ArrowSquareOutIcon, ArrowUpIcon, BooksIcon, CaretRightIcon, CheckIcon, CheckSquareIcon, ClipboardIcon, CopyIcon, DotsThreeIcon,
  DownloadSimpleIcon, EyeIcon, FlowArrowIcon, FolderOpenIcon, FolderPlusIcon, FunnelSimpleIcon, ListIcon, MagnifyingGlassIcon,
  PencilSimpleIcon, RowsIcon, ScissorsIcon, SortAscendingIcon, SparkleIcon, SquaresFourIcon, TagIcon, TrashIcon, TreeStructureIcon,
  UploadSimpleIcon, XIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ContextMenu, DropdownMenu, Popover } from "radix-ui";
import {
  useEffect, useEffectEvent, useRef, useState, type ComponentType, type DragEvent, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode, type RefObject,
} from "react";
import { toast } from "sonner";

import { BuildFromDocs } from "@/components/doc-builders";
import { LabelChip, LabelsDialog } from "@/components/file-labels";
import { LoadMore } from "@/components/load-more";
import { EmptyState } from "@/components/page";
import { openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { SearchInput } from "@/components/ui/search-input";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { docKeys, fileSize, fileUrl } from "@/lib/documents";
import {
  EMPTY_SELECTION, FILE_TYPES, fileItemKey, fileType, folderItemKey, folderNameProblem, labelsQuery, selectionReducer, sortItems,
  type ClipItem, type Clipboard, type ExplorerFile, type FileType, type Item, type SelectionAction, type SortDir, type SortField,
} from "@/lib/explorer";
import { archiveUrl, cleanFolder, filesFromDrop, folderChain, folderName, KINDS, kindKey, previewKind, previewUrl, type FolderNode, type KindKey, type PickedFile } from "@/lib/intake";
import { setLibrary } from "@/lib/library";
import { usePagedList, useDebounced } from "@/lib/paged";
import { fileOrigin, type FileOrigin } from "@/lib/provenance";
import { meQuery } from "@/lib/queries";
import { hasAny, type Branch } from "@/lib/types";
import { useIsPhone, useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { findNode } from "../library-hub/tree";
import { BatchCard, IntakeDrop, type IntakeDropHandle, type ShowFilter } from "../documents/files-upload";
import { FolderPickerDialog, NotEmptyDialog } from "./dialogs";
import { DetailsHeader, ItemView, RenameBox, type Layout } from "./items";
import { canDropInto, copyKey, draggedItems, endDrag, isFileDrag, isOwnDrag, itemsWord, startDrag, type ExplorerOps } from "./ops";

// ---------------------------------------------------------------- preferences (this device)

const PREFS = "agentic.library.explorer";
interface Prefs { layout: Layout; sort: SortField; dir: SortDir }
const DEFAULT_PREFS: Prefs = { layout: "list", sort: "name", dir: "asc" };

function readPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? "{}") as Partial<Prefs>;
    return {
      layout: v.layout === "grid" || v.layout === "details" ? v.layout : "list",
      sort: v.sort === "date" || v.sort === "size" || v.sort === "type" ? v.sort : "name",
      dir: v.dir === "desc" ? "desc" : "asc",
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function usePrefs() {
  const [prefs, setPrefs] = useState(readPrefs);
  const set = (patch: Partial<Prefs>) => setPrefs((p) => {
    const next = { ...p, ...patch };
    try { localStorage.setItem(PREFS, JSON.stringify(next)); } catch { /* private mode: lasts until reload */ }
    return next;
  });
  return { ...prefs, set };
}

// ---------------------------------------------------------------- filters

interface Filters {
  origin: FileOrigin | null;
  types: FileType[];
  kinds: KindKey[];
  labels: string[];
  held: boolean;
  /** A department id, or "none". */
  dept: string | null;
  /** One upload's files (from its report). */
  batch: string | null;
}
const NO_FILTERS: Filters = { origin: null, types: [], kinds: [], labels: [], held: false, dept: null, batch: null };
const filterCount = (f: Filters) => (f.origin ? 1 : 0) + f.types.length + f.kinds.length + f.labels.length + (f.held ? 1 : 0) + (f.dept ? 1 : 0) + (f.batch ? 1 : 0);

const ORIGINS: { value: FileOrigin; label: string }[] = [
  { value: "agent", label: msg("Made by AI") },
  { value: "person", label: msg("Made by people") },
  { value: "uploaded", label: msg("Uploaded") },
];

const SORTS: { value: SortField; label: string }[] = [
  { value: "name", label: msg("Name") },
  { value: "date", label: msg("Date modified") },
  { value: "size", label: msg("Size") },
  { value: "type", label: msg("Type") },
];

// ---------------------------------------------------------------- menus

interface Act {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** The keyboard shortcut, shown at the right. */
  keys?: string;
  /** A line above it. */
  sep?: boolean;
}

type ItemCmp = ComponentType<{ onSelect?: (e: Event) => void; disabled?: boolean; className?: string; children?: ReactNode }>;
type SepCmp = ComponentType<{ className?: string }>;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

/** The same actions in the right-click menu and in the "…" menu. */
function ActItems({ acts, Item: I, Sep }: { acts: Act[]; Item: ItemCmp; Sep: SepCmp }) {
  return acts.map((a, i) => (
    <span key={a.id} className="contents">
      {a.sep && i > 0 ? <Sep className="my-1 h-px bg-border" /> : null}
      <I onSelect={a.run} disabled={a.disabled}
        className={cn("flex cursor-default items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] outline-none select-none pointer-coarse:py-3",
          "data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2", a.danger ? "text-danger" : "text-fg")}>
        <span className={cn("[&_svg]:size-4", a.danger ? "text-danger" : "text-muted")}>{a.icon}</span>
        <span className="min-w-0 flex-1 truncate">{a.label}</span>
        {a.keys ? <span className="pl-6 text-[11.5px] text-muted tabular-nums pointer-coarse:hidden">{a.keys}</span> : null}
      </I>
    </span>
  ));
}

const MENU_BOX = "z-50 max-h-[var(--radix-context-menu-content-available-height)] min-w-56 overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-[var(--shadow-pop)] data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]";

// ---------------------------------------------------------------- helpers

const toClipItem = (i: Item): ClipItem =>
  i.kind === "file" ? { kind: "file", id: i.file.id, name: i.file.name, folder: i.file.folder ?? "" } : { kind: "folder", path: i.path };

function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function allFolders(root: FolderNode): FolderNode[] {
  const out: FolderNode[] = [];
  const walk = (n: FolderNode) => { for (const c of n.children) { out.push(c); walk(c); } };
  walk(root);
  return out;
}

/** A name no folder here has yet: "New folder", "New folder 2"... */
function freshName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((x) => x.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i += 1) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

interface BarAct { id: string; label: string; icon: ReactNode; run: () => void; danger?: boolean }

const TEXT_TARGET = "input, textarea, select, [contenteditable='true'], [contenteditable='']";

// ---------------------------------------------------------------- the path row

function PathBar({ branch, folder, searching, onFolder, drop, over }: {
  branch: Branch;
  folder: string;
  searching: boolean;
  onFolder: (path: string) => void;
  drop: (path: string) => HTMLAttributes<HTMLElement>;
  /** The crumb something is dragged over ("crumb:<path>"). */
  over: string | null;
}) {
  const t = useT();
  const chain = folderChain(folder);
  const box = useRef<HTMLElement>(null);
  // A deep folder keeps its own name in view: the row scrolls to its end.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [folder]);
  const crumb = "shrink-0 rounded-sm px-1.5 py-1 text-[13px] whitespace-nowrap transition-colors hover:bg-surface-2 pointer-coarse:py-2.5";
  return (
    <nav ref={box} aria-label={t("Folder path")}
      className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" onClick={() => onFolder("")} {...drop("")} aria-current={!folder && !searching ? "page" : undefined}
        className={cn(crumb, "max-w-[14rem] truncate", !folder && !searching && "font-semibold", over === "crumb:" && "bg-accent-soft text-accent ring-2 ring-accent")}>{branch.name}</button>
      {chain.map((p, i) => (
        <span key={p} className="flex shrink-0 items-center gap-0.5">
          <CaretRightIcon size={11} className="shrink-0 text-muted" aria-hidden />
          <button type="button" onClick={() => onFolder(p)} {...drop(p)} aria-current={i === chain.length - 1 && !searching ? "page" : undefined}
            className={cn(crumb, "max-w-[16rem] truncate", i === chain.length - 1 && "font-semibold", over === `crumb:${p}` && "bg-accent-soft text-accent ring-2 ring-accent")}>{folderName(p)}</button>
        </span>
      ))}
      {searching ? (
        <span className="flex shrink-0 items-center gap-0.5">
          <CaretRightIcon size={11} className="shrink-0 text-muted" aria-hidden />
          <span aria-current="page" className="px-1.5 text-[13px] font-semibold whitespace-nowrap">{t("Search results")}</span>
        </span>
      ) : null}
    </nav>
  );
}

// ---------------------------------------------------------------- filter and sort controls

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[12.5px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-10",
        on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg")}>
      {on ? <CheckIcon size={11} weight="bold" /> : null}{children}
    </button>
  );
}

function FilterButton({ filters, setFilters, branch }: { filters: Filters; setFilters: (f: Filters) => void; branch: Branch }) {
  const t = useT();
  const { data: labels = [] } = useQuery(labelsQuery(branch.id));
  const n = filterCount(filters);
  const flip = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const section = "grid gap-1.5";
  const head = "text-[12px] font-semibold text-muted";
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="sm" variant={n ? "secondary" : "outline"} className="pointer-coarse:h-11" aria-label={t("Filter")}>
          <FunnelSimpleIcon size={15} /> <span className="max-sm:hidden">{t("Filter")}</span>
          {n ? <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg tabular">{n}</span> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} collisionPadding={8}
          className="z-50 grid max-h-[var(--radix-popover-content-available-height)] w-[min(92vw,24rem)] gap-4 overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-[var(--shadow-pop)] data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]">
          <div className={section}>
            <span className={head}>{t("Made by")}</span>
            <div className="flex flex-wrap gap-1.5">
              {ORIGINS.map((o) => <Chip key={o.value} on={filters.origin === o.value} onClick={() => setFilters({ ...filters, origin: filters.origin === o.value ? null : o.value })}>{t(o.label)}</Chip>)}
            </div>
          </div>
          <div className={section}>
            <span className={head}>{t("File type")}</span>
            <div className="flex flex-wrap gap-1.5">
              {FILE_TYPES.map((x) => <Chip key={x.key} on={filters.types.includes(x.key)} onClick={() => setFilters({ ...filters, types: flip(filters.types, x.key) })}>{t(x.label)}</Chip>)}
            </div>
          </div>
          <div className={section}>
            <span className={head}>{t("Kind")}</span>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => <Chip key={k.key} on={filters.kinds.includes(k.key)} onClick={() => setFilters({ ...filters, kinds: flip(filters.kinds, k.key) })}>{k.key === "sop" ? "SOP" : t(k.label)}</Chip>)}
            </div>
          </div>
          {labels.length ? (
            <div className={section}>
              <span className={head}>{t("Labels")}</span>
              <div className="flex flex-wrap gap-1.5">
                {labels.slice(0, 40).map((l) => (
                  <button key={l.label} type="button" aria-pressed={filters.labels.includes(l.label)} onClick={() => setFilters({ ...filters, labels: flip(filters.labels, l.label) })}
                    className={cn("rounded-[6px] p-0.5 transition-shadow pointer-coarse:p-2", filters.labels.includes(l.label) ? "ring-2 ring-accent" : "hover:ring-1 hover:ring-border")}>
                    <LabelChip label={l.label} />
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {branch.departments.length ? (
            <div className={section}>
              <span className={head}>{t("Department")}</span>
              <div className="flex flex-wrap gap-1.5">
                {[...branch.departments.map((d) => ({ id: d.id, name: d.name })), { id: "none", name: t("No department") }].map((d) => (
                  <Chip key={d.id} on={filters.dept === d.id} onClick={() => setFilters({ ...filters, dept: filters.dept === d.id ? null : d.id })}>{d.name}</Chip>
                ))}
              </div>
            </div>
          ) : null}
          <div className={section}>
            <span className={head}>{t("Safety")}</span>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={filters.held} onClick={() => setFilters({ ...filters, held: !filters.held })}>{t("Held back only")}</Chip>
            </div>
          </div>
          {n ? <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setFilters(NO_FILTERS)}><XIcon size={13} /> {t("Clear filters")}</Button> : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SortButton({ sort, dir, onChange }: { sort: SortField; dir: SortDir; onChange: (p: { sort?: SortField; dir?: SortDir }) => void }) {
  const t = useT();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="outline" className="pointer-coarse:h-11" aria-label={t("Sort")}>
          <SortAscendingIcon size={15} /> <span className="max-sm:hidden">{t(SORTS.find((s) => s.value === sort)?.label ?? "Name")}</span>
        </Button>
      </MenuTrigger>
      <MenuContent className="w-52">
        <MenuLabel>{t("Sort by")}</MenuLabel>
        <MenuRadioGroup value={sort} onValueChange={(v) => onChange({ sort: v as SortField })}>
          {SORTS.map((s) => <MenuRadioItem key={s.value} value={s.value} className="pointer-coarse:py-3">{t(s.label)}</MenuRadioItem>)}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuRadioGroup value={dir} onValueChange={(v) => onChange({ dir: v as SortDir })}>
          <MenuRadioItem value="asc" className="pointer-coarse:py-3">{sort === "date" ? t("Oldest first") : sort === "size" ? t("Smallest first") : t("A to Z")}</MenuRadioItem>
          <MenuRadioItem value="desc" className="pointer-coarse:py-3">{sort === "date" ? t("Newest first") : sort === "size" ? t("Largest first") : t("Z to A")}</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function ViewSwitch({ layout, onChange, phone }: { layout: Layout; onChange: (l: Layout) => void; phone: boolean }) {
  const t = useT();
  const opts = ([["grid", SquaresFourIcon, msg("Grid")], ["list", ListIcon, msg("List")], ["details", RowsIcon, msg("Details")]] as const)
    .filter(([v]) => !phone || v !== "details");
  return (
    <div role="group" aria-label={t("View")} className="flex shrink-0 rounded-sm border border-border bg-surface-2/60 p-0.5">
      {opts.map(([value, IconCmp, label]) => {
        const on = layout === value;
        return (
          <button key={value} type="button" aria-pressed={on} title={t(label)} aria-label={t(label)} onClick={() => onChange(value)}
            className={cn("grid size-7 place-items-center rounded-[5px] transition-colors pointer-coarse:size-10",
              on ? "bg-surface text-accent shadow-[0_1px_2px_hsl(var(--shadow)/0.08)]" : "text-muted hover:text-fg")}>
            <IconCmp size={16} weight={on ? "bold" : "regular"} />
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- the file area

export function CompanyExplorer({ branch, folder, openId, initialOrigin, root, ops, clip, setClip, uploadOpen, setUploadOpen, intake, uploadInto, onFolder, onOpenFile, onOpenTree }: {
  branch: Branch;
  folder: string;
  openId?: string;
  initialOrigin?: FileOrigin;
  root: FolderNode;
  ops: ExplorerOps;
  clip: Clipboard | null;
  setClip: (c: Clipboard | null) => void;
  uploadOpen: boolean;
  setUploadOpen: (open: boolean) => void;
  intake: RefObject<IntakeDropHandle | null>;
  uploadInto: (files: PickedFile[], folder: string) => void;
  onFolder: (path: string) => void;
  onOpenFile: (id: string) => void;
  onOpenTree: () => void;
}) {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const canEdit = !!me && hasAny(me, "work.write");
  const canManage = !!me && hasAny(me, "org.manage", "vault.manage");
  const phone = useIsPhone();
  const coarse = useMedia("(pointer: coarse)");
  const prefs = usePrefs();
  const layout: Layout = phone && prefs.layout === "details" ? "list" : prefs.layout;

  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim());
  const searching = !!needle;
  const [filters, setFilters] = useState<Filters>(() => ({ ...NO_FILTERS, origin: initialOrigin ?? null }));
  const filtering = filterCount(filters) > 0;
  const here = findNode(root, folder) ?? root;

  // ---- files from the server: this folder; with filters, everything under it; a search, the
  // whole company. The server filters what it can; the rest is filtered here.
  const list = usePagedList<ExplorerFile>(docKeys.files, "/api/files", {
    branch_id: branch.id,
    ...(searching ? { q: needle } : filtering ? { folder: folder || undefined, recursive: true } : { folder: folder || "/" }),
    origin: filters.origin ?? undefined,
    kind: filters.kinds.length === 1 ? filters.kinds[0] : undefined,
    label: filters.labels[0],
    department_id: filters.dept ?? undefined,
    batch_id: filters.batch ?? undefined,
  }, { pageSize: 200, poll: (rows) => (rows.some((f) => f.status === "reading") ? 2500 : false) });

  const files = list.items.filter((f) => {
    if (!searching && !filtering && (f.folder ?? "") !== folder) return false;
    if (filters.origin && fileOrigin(f) !== filters.origin) return false;
    if (filters.types.length && !filters.types.includes(fileType(f))) return false;
    if (filters.kinds.length && !filters.kinds.includes(kindKey(f.kind))) return false;
    if (filters.labels.length && !filters.labels.every((l) => (f.labels ?? []).some((x) => x.toLowerCase() === l.toLowerCase()))) return false;
    if (filters.held && !f.quarantined) return false;
    if (filters.dept === "none" && f.department_id) return false;
    if (filters.dept && filters.dept !== "none" && f.department_id !== filters.dept) return false;
    if (filters.batch && f.batch_id && f.batch_id !== filters.batch) return false;
    return true;
  });

  const folderNodes = searching
    ? allFolders(root).filter((n) => n.name.toLowerCase().includes(needle.toLowerCase())).slice(0, 200)
    : filtering ? [] : here.children;
  const items = sortItems([
    ...folderNodes.map((n): Item => ({ key: folderItemKey(n.path), kind: "folder", path: n.path, name: n.name, files: n.files, size: n.size, flagged: n.flagged })),
    ...files.map((f): Item => ({ key: fileItemKey(f.id), kind: "file", file: f, name: f.name })),
  ], prefs.sort, prefs.dir);
  const order = items.map((i) => i.key);
  const byKey = new Map(items.map((i) => [i.key, i]));

  // ---- selection: starts empty in each folder, search and filter.
  const [sel, setSel] = useState(EMPTY_SELECTION);
  const act = (a: SelectionAction) => setSel((s) => selectionReducer(s, a));
  const [cursor, setCursor] = useState<string | null>(null);
  const scope = `${folder}|${needle}|${JSON.stringify(filters)}`;
  const [seenScope, setSeenScope] = useState(scope);
  if (seenScope !== scope) {
    setSeenScope(scope);
    setSel(EMPTY_SELECTION);
    setCursor(null);
  }
  const selectedKeys = sel.keys.filter((k) => byKey.has(k));
  const selected = selectedKeys.map((k) => byKey.get(k)!);
  const selectedSet = new Set(selectedKeys);
  const selFiles = selected.flatMap((i) => (i.kind === "file" ? [i.file] : []));
  const current = cursor && byKey.has(cursor) ? cursor : order[0] ?? null;
  const selecting = selectedKeys.length > 0;
  const cutKeys = new Set(clip?.mode === "cut" && clip.branchId === branch.id
    ? clip.items.map((c) => (c.kind === "file" ? fileItemKey(c.id) : folderItemKey(c.path))) : []);

  // ---- inline rename and the new folder being named
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // ---- dialogs
  const [picker, setPicker] = useState<{ mode: "move" | "copy"; items: Item[] } | null>(null);
  const [labelsFor, setLabelsFor] = useState<ExplorerFile[] | null>(null);
  const [removing, setRemoving] = useState<{ files: ExplorerFile[]; folders: string[] } | null>(null);
  const [building, setBuilding] = useState<string[] | null>(null);
  const [notEmpty, setNotEmpty] = useState<{ name: string; path: string; files: number } | null>(null);
  const [ctx, setCtx] = useState<"items" | "bg">("bg");
  const [dropOver, setDropOver] = useState<string | null>(null);
  const [areaOver, setAreaOver] = useState(false);
  // ---- uploads started here show their report
  const [recent, setRecent] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const area = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------- what things do

  const openItem = (i: Item) => {
    if (i.kind === "folder") {
      if (searching) setQ("");
      onFolder(i.path);
    } else {
      onOpenFile(i.file.id);
    }
  };
  const goUp = () => {
    if (searching) setQ("");
    else if (folder) onFolder(folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : "");
  };
  const toClip = (mode: Clipboard["mode"], its: Item[]) => {
    if (!its.length) return;
    setClip({ mode, branchId: branch.id, items: its.map(toClipItem) });
    const what = itemsWord(its.filter((i) => i.kind === "file").length, its.filter((i) => i.kind === "folder").length);
    toast(mode === "cut" ? tr("Cut {what}. Open a folder and paste.", { what }) : tr("Copied {what}. Open a folder and paste.", { what }), { duration: 2500 });
  };
  const paste = async (dest: string) => {
    if (!clip || !canEdit) return;
    if (clip.branchId !== branch.id) {
      toast.error(tr("Those were cut or copied in another company. Paste them there."));
      return;
    }
    const ok = await ops.transfer(clip.mode, clip.items, dest);
    if (ok && clip.mode === "cut") setClip(null);
  };
  const askAi = (its: Item[]) => {
    const fs = its.flatMap((i) => (i.kind === "file" ? [i.file] : []));
    const target = its.length === 1 && its[0]?.kind === "folder" ? its[0].path : folder;
    const name = target || `${branch.name} (${tr("top level")})`;
    if (fs.length && fs.length === its.length) {
      openTaskComposer({
        kind: "general",
        title: tr("Organize {n} files in {folder}", { n: fs.length, folder: name }),
        brief: tr("Organize these {n} files from the folder {folder}: file them into sensible subfolders the way we already keep things, using list_folders and file_document; list what moved.", { n: fs.length, folder: name }),
        files: fs.slice(0, 20).map((f) => ({ id: f.id, name: f.name })),
      });
      return;
    }
    openTaskComposer({
      kind: "general",
      title: tr("Organize {folder}", { folder: name }),
      brief: tr("Organize the folder {folder}: file these documents into sensible subfolders the way we already keep things, using list_folders and file_document; list what moved.", { folder: name }),
    });
  };
  const downloadItems = (its: Item[]) => {
    const fs = its.flatMap((i) => (i.kind === "file" ? [i.file] : []));
    const ds = its.flatMap((i) => (i.kind === "folder" ? [i.path] : []));
    if (fs.length === 1 && !ds.length) download(fileUrl(fs[0]!.id));
    else if (fs.length) download(archiveUrl({ ids: fs.map((f) => f.id) }));
    for (const d of ds) download(archiveUrl({ branch_id: branch.id, folder: d }));
  };
  const askDelete = (its: Item[]) => {
    if (!canEdit || !its.length) return;
    const full = its.find((i) => i.kind === "folder" && i.files > 0);
    if (full && full.kind === "folder" && its.length === 1) {
      setNotEmpty({ name: full.name, path: full.path, files: full.files });
      return;
    }
    const fs = its.flatMap((i) => (i.kind === "file" ? [i.file] : []));
    const ds = its.flatMap((i) => (i.kind === "folder" && !i.files ? [i.path] : []));
    if (full) toast(tr("Folders with files in them stay; only empty folders are deleted."));
    if (fs.length || ds.length) setRemoving({ files: fs, folders: ds });
  };
  const addToGuidelines = async (fs: ExplorerFile[]) => {
    let ok = 0;
    let held = 0;
    for (const f of fs) {
      if (f.quarantined) { held += 1; continue; }
      try {
        await setLibrary(f.id, true, { branch_id: f.branch_id ?? branch.id, department_id: f.department_id ?? null });
        ok += 1;
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    ops.refresh();
    if (ok) toast.success(ok === 1 ? tr("1 file added to the guidelines.") : tr("{n} files added to the guidelines.", { n: ok }));
    if (held) toast(held === 1 ? tr("1 held-back file was left out.") : tr("{n} held-back files were left out.", { n: held }));
  };
  const commitRename = async (i: Item, name: string | null) => {
    setRenaming(null);
    if (!name) return;
    if (i.kind === "folder") {
      const problem = folderNameProblem(name);
      if (problem) return void toast.error(tr(problem));
      await ops.renameFolderTo(i.path, name);
    } else {
      await ops.renameFileTo(i.file, name);
    }
  };
  const commitCreate = async (name: string | null) => {
    setCreating(false);
    const clean = name?.trim() || null;
    if (!clean) return;
    const problem = folderNameProblem(clean);
    if (problem) return void toast.error(tr(problem));
    const path = await ops.newFolder(folder, clean);
    if (path) {
      setSel({ keys: [folderItemKey(path)], anchor: folderItemKey(path) });
      setCursor(folderItemKey(path));
    }
  };
  const startCreate = () => {
    if (searching) setQ("");
    if (filtering) setFilters(NO_FILTERS);
    setCreating(true);
  };

  // ---- the actions for what is selected (right-click, "…", the bars)
  const itemActs = (its: Item[]): Act[] => {
    const one = its.length === 1 ? its[0] : undefined;
    const fs = its.flatMap((i) => (i.kind === "file" ? [i.file] : []));
    const pasteInto = one?.kind === "folder" ? one.path : folder;
    const acts: Act[] = [];
    if (one?.kind === "folder") acts.push({ id: "open", label: t("Open"), icon: <FolderOpenIcon />, run: () => openItem(one), keys: "Enter" });
    if (one?.kind === "file") {
      acts.push({ id: "preview", label: t("Preview"), icon: <EyeIcon />, run: () => openItem(one), keys: "Enter" });
      const canSee = !one.file.quarantined || canManage;
      if (canSee) {
        const pk = previewKind(one.file);
        acts.push({ id: "tab", label: t("Open in new tab"), icon: <ArrowSquareOutIcon />, run: () => window.open(pk === "pdf" || pk === "office" ? previewUrl(one.file.id) : fileUrl(one.file.id, true), "_blank", "noopener") });
      }
    }
    if (canEdit && one) acts.push({ id: "rename", label: t("Rename"), icon: <PencilSimpleIcon />, run: () => setRenaming(one.key), keys: "F2", sep: true });
    acts.push({ id: "copy", label: t("Copy"), icon: <CopyIcon />, run: () => toClip("copy", its), keys: `${MOD}C`, sep: !(canEdit && one) });
    if (canEdit) {
      acts.push({ id: "cut", label: t("Cut"), icon: <ScissorsIcon />, run: () => toClip("cut", its), keys: `${MOD}X` });
      if (clip) acts.push({ id: "paste", label: one?.kind === "folder" ? t("Paste into {name}", { name: one.name }) : t("Paste here"), icon: <ClipboardIcon />, run: () => void paste(pasteInto), keys: `${MOD}V` });
      acts.push({ id: "move", label: t("Move to…"), icon: <FolderOpenIcon />, run: () => setPicker({ mode: "move", items: its }), sep: true });
      acts.push({ id: "copyto", label: t("Copy to…"), icon: <CopyIcon />, run: () => setPicker({ mode: "copy", items: its }) });
      if (fs.length) acts.push({ id: "labels", label: t("Labels…"), icon: <TagIcon />, run: () => setLabelsFor(fs) });
      if (fs.length && fs.some((f) => f.source === "upload" && !f.library && !f.quarantined)) {
        acts.push({ id: "guide", label: t("Add to guidelines"), icon: <BooksIcon />, run: () => void addToGuidelines(fs.filter((f) => f.source === "upload" && !f.library)) });
      }
      acts.push({ id: "ai", label: t("Ask AI to organize"), icon: <SparkleIcon />, run: () => askAi(its), sep: true });
      if (fs.length && fs.length === its.length && !fs.some((f) => f.quarantined)) {
        acts.push({ id: "build", label: t("Make an SOP or workflow…"), icon: <FlowArrowIcon />, run: () => setBuilding(fs.map((f) => f.id)) });
      }
    }
    acts.push({ id: "download", label: fs.length === its.length && fs.length > 1 ? t("Download as zip") : t("Download"), icon: <DownloadSimpleIcon />, run: () => downloadItems(its), sep: !canEdit });
    if (canEdit) acts.push({ id: "delete", label: t("Delete"), icon: <TrashIcon />, run: () => askDelete(its), danger: true, keys: IS_MAC ? "⌫" : "Del", sep: true });
    return acts;
  };
  const backgroundActs = (): Act[] => {
    const acts: Act[] = [];
    if (canEdit) {
      if (clip) acts.push({ id: "paste", label: t("Paste here"), icon: <ClipboardIcon />, run: () => void paste(folder), keys: `${MOD}V` });
      acts.push({ id: "new", label: t("New folder"), icon: <FolderPlusIcon />, run: startCreate, sep: !!clip });
      acts.push({ id: "upload", label: t("Upload files"), icon: <UploadSimpleIcon />, run: () => setUploadOpen(true) });
      acts.push({ id: "ai", label: t("Ask AI to organize this folder"), icon: <SparkleIcon />, run: () => askAi([]) });
    }
    if (order.length) acts.push({ id: "all", label: t("Select all"), icon: <CheckSquareIcon />, run: () => act({ type: "all", order }), keys: `${MOD}A`, sep: true });
    acts.push({ id: "download", label: folder ? t("Download this folder") : t("Download everything"), icon: <DownloadSimpleIcon />, run: () => download(archiveUrl({ branch_id: branch.id, folder: folder || null })) });
    return acts;
  };

  // ---------------------------------------------------------------- keys

  const focusItem = (key: string) => {
    const el = area.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    el?.focus({ preventScroll: true });
    el?.scrollIntoView({ block: "nearest" });
  };
  const gridCols = () => {
    const g = area.current?.querySelector<HTMLElement>("[data-grid]");
    if (!g) return 1;
    return Math.max(1, getComputedStyle(g).gridTemplateColumns.split(" ").filter(Boolean).length);
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || renaming || creating) return;
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el?.closest(TEXT_TARGET)) return;
    if (document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']")) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.altKey) {
      if (k === "a" && order.length) { e.preventDefault(); act({ type: "all", order }); }
      else if (k === "c" && selected.length && !window.getSelection()?.toString()) { e.preventDefault(); toClip("copy", selected); }
      else if (k === "x" && selected.length && canEdit) { e.preventDefault(); toClip("cut", selected); }
      else if (k === "v" && clip && canEdit) { e.preventDefault(); void paste(folder); }
      return;
    }
    // Plain keys belong to the control in focus, unless that is the file area or nothing.
    const inArea = !el || el === document.body || !!el.closest("[data-explorer-area]");
    if (!inArea) return;
    if (e.key === "F2") { if (canEdit && selected.length === 1) { e.preventDefault(); setRenaming(selected[0]!.key); } return; }
    if (e.key === "Delete" || (IS_MAC && e.key === "Backspace" && e.metaKey)) { if (selected.length) { e.preventDefault(); askDelete(selected); } return; }
    if (e.key === "Escape") { if (selectedKeys.length) { e.preventDefault(); act({ type: "clear" }); } return; }
    if (e.key === "Backspace" || (e.altKey && e.key === "ArrowUp")) { if (folder || searching) { e.preventDefault(); goUp(); } return; }
    if (e.key === "Enter") {
      const target = selected[0] ?? (current ? byKey.get(current) : undefined);
      if (target) { e.preventDefault(); openItem(target); }
      return;
    }
    if (["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) && order.length) {
      const cols = layout === "grid" ? gridCols() : 1;
      const i = Math.max(0, current ? order.indexOf(current) : 0);
      const step = { ArrowDown: cols, ArrowUp: -cols, ArrowLeft: layout === "grid" ? -1 : 0, ArrowRight: layout === "grid" ? 1 : 0, Home: -i, End: order.length } as Record<string, number>;
      const j = Math.min(order.length - 1, Math.max(0, i + (step[e.key] ?? 0)));
      const key = order[j]!;
      e.preventDefault();
      setCursor(key);
      if (!mod) act({ type: "click", key, order, shift: e.shiftKey });
      focusItem(key);
    }
  });
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  // ---------------------------------------------------------------- drag and drop

  const dropProps = (path: string, key: string | null): HTMLAttributes<HTMLElement> => ({
    onDragOver: (e: DragEvent) => {
      if (!canEdit) return;
      const ok = isOwnDrag(e) ? canDropInto(path) : isFileDrag(e);
      if (!ok) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = isOwnDrag(e) && copyKey(e) ? "copy" : isOwnDrag(e) ? "move" : "copy";
      setDropOver(key ?? `crumb:${path}`);
      setAreaOver(false);
    },
    onDragLeave: (e: DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropOver((o) => (o === (key ?? `crumb:${path}`) ? null : o));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOver(null);
      dropInto(path, e);
    },
  });
  const dropInto = (path: string, e: DragEvent) => {
    if (isOwnDrag(e)) {
      const its = draggedItems();
      endDrag();
      if (its) void ops.transfer(copyKey(e) ? "copy" : "cut", its, path);
      return;
    }
    if (!e.dataTransfer.files.length) return;
    filesFromDrop(e.dataTransfer).then((picked) => uploadInto(picked, path)).catch((err: unknown) => toast.error(errorMessage(err)));
  };

  // ---------------------------------------------------------------- one item's events

  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const pressed = useRef(false);
  /** How the last press came: a finger taps to open, a mouse clicks to select. */
  const lastPointer = useRef("mouse");
  const cancelPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };

  const events = (i: Item): HTMLAttributes<HTMLDivElement> => ({
    onClick: (e) => {
      if (pressed.current) { pressed.current = false; return; }
      setCursor(i.key);
      if (lastPointer.current !== "mouse" && e.detail > 0) {
        if (selecting) act({ type: "toggle", key: i.key });
        else openItem(i);
        return;
      }
      act({ type: "click", key: i.key, order, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    },
    onDoubleClick: (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (lastPointer.current === "mouse") openItem(i);
    },
    onContextMenu: (e) => {
      if (lastPointer.current !== "mouse") {
        // A long press on a touch screen selects instead (see onPointerDown).
        e.preventDefault();
        return;
      }
      setCtx("items");
      setCursor(i.key);
      act({ type: "context", key: i.key });
    },
    onPointerDown: (e) => {
      lastPointer.current = e.pointerType;
      if (e.pointerType === "mouse") return;
      cancelPress();
      press.current = {
        x: e.clientX, y: e.clientY,
        timer: setTimeout(() => {
          press.current = null;
          pressed.current = true;
          act({ type: "toggle", key: i.key });
          setCursor(i.key);
          navigator.vibrate?.(12);
        }, 450),
      };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    draggable: canEdit && !coarse && renaming !== i.key,
    onDragStart: (e) => {
      const its = selectedSet.has(i.key) ? selected : [i];
      if (!selectedSet.has(i.key)) act({ type: "click", key: i.key, order });
      startDrag(e, its.map(toClipItem), its.length === 1 ? i.name : itemsWord(its.filter((x) => x.kind === "file").length, its.filter((x) => x.kind === "folder").length));
    },
    onDragEnd: () => { endDrag(); setDropOver(null); setAreaOver(false); },
    ...(i.kind === "folder" ? dropProps(i.path, i.key) : {}),
  });

  const itemMenu = (i: Item) => (
    <DropdownMenu.Root onOpenChange={(o) => { if (o) { act({ type: "context", key: i.key }); setCursor(i.key); } }}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={t("Actions for {name}", { name: i.name })} tabIndex={-1}
          onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
          className={cn("grid size-8 place-items-center rounded-sm text-muted transition-[opacity,background-color] hover:bg-surface hover:text-fg data-[state=open]:bg-surface data-[state=open]:opacity-100 pointer-coarse:size-11",
            layout !== "details" && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
            layout === "grid" && "bg-surface/90 shadow-[var(--shadow-soft)]")}>
          <DotsThreeIcon size={18} weight="bold" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} collisionPadding={8} className={cn(MENU_BOX, "max-h-[var(--radix-dropdown-menu-content-available-height)]")}>
          <ActItems acts={itemActs(selectedSet.has(i.key) ? selected : [i])} Item={DropdownMenu.Item as ItemCmp} Sep={DropdownMenu.Separator as SepCmp} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );

  const renderItem = (i: Item, showPath: boolean) => (
    <ItemView key={i.key} item={i} layout={layout} selected={selectedSet.has(i.key)} current={i.key === current} cut={cutKeys.has(i.key)}
      active={i.kind === "file" && i.file.id === openId} dropOver={dropOver === i.key} showPath={showPath} selecting={selecting} canManage={canManage}
      renaming={renaming === i.key} onRename={(name) => void commitRename(i, name)} onToggle={() => act({ type: "toggle", key: i.key })}
      events={events(i)} menu={itemMenu(i)} />
  );

  const newFolderItem = creating ? (
    <div className={cn("flex items-center gap-2.5 bg-accent-soft/50", layout === "grid" ? "flex-col rounded-[var(--radius-md)] border border-accent/50 p-2" : "border-b border-border/70 px-3 py-2")}>
      <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-[var(--radius-sm)] bg-warn/12 text-warn ring-1 ring-warn/20 ring-inset", layout === "grid" ? "aspect-[4/3] w-full" : "size-10")}>
        <FolderPlusIcon size={layout === "grid" ? 30 : 20} weight="duotone" />
      </span>
      <RenameBox value={freshName(t("New folder"), here.children.map((c) => c.name))} label={t("Name of the new folder")} fresh onDone={(n) => void commitCreate(n)} />
    </div>
  ) : null;

  // ---------------------------------------------------------------- layout

  const showPath = searching || filtering;
  const searchFolders = searching ? items.filter((i) => i.kind === "folder") : [];
  const searchFiles = searching ? items.filter((i) => i.kind === "file") : [];
  const selSize = selected.reduce((n, i) => n + (i.kind === "file" ? i.file.size : i.size), 0);
  const totalSize = items.reduce((n, i) => n + (i.kind === "file" ? i.file.size : i.size), 0);
  const empty = !list.isLoading && !items.length && !creating;

  const listOf = (its: Item[], label: string) => {
    if (layout === "grid") {
      return (
        <div role="listbox" aria-multiselectable aria-label={label} data-grid
          className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5 p-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:p-4">
          {its.map((i) => renderItem(i, showPath))}
        </div>
      );
    }
    return (
      <div role="listbox" aria-multiselectable aria-label={label} className="grid grid-cols-[minmax(0,1fr)]">
        {its.map((i) => renderItem(i, showPath))}
      </div>
    );
  };

  const groupHead = (label: string, n: number) => (
    <h3 className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface/95 px-4 py-2 text-[12.5px] font-semibold backdrop-blur">
      {label} <span className="font-normal text-muted tabular">{n.toLocaleString(locale())}</span>
    </h3>
  );

  const body = list.isLoading && !items.length ? (
    <div className="grid gap-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
  ) : list.error ? (
    <p role="alert" className="p-4 text-[13.5px] text-danger">{errorMessage(list.error)}</p>
  ) : empty ? (
    <div className="p-4">
      {searching ? (
        <EmptyState icon={MagnifyingGlassIcon} title={t("Nothing matches “{q}”", { q: needle })}
          body={t("Folder and file names were searched. To find words inside documents, search inside them.")}
          action={<Button size="sm" variant="outline" asChild><Link to="/search" search={{ q: needle }}>{t("Search inside documents")}</Link></Button>} />
      ) : filtering ? (
        <EmptyState icon={FunnelSimpleIcon} title={t("No files match")} body={t("Nothing in this folder or the folders inside it matches these filters.")}
          action={<Button size="sm" variant="outline" onClick={() => setFilters(NO_FILTERS)}>{t("Clear filters")}</Button>} />
      ) : (
        <EmptyState icon={FolderOpenIcon} title={folder ? t("This folder is empty") : t("No files yet")}
          body={canEdit ? t("Drag files here from your computer, upload them, or make folders to keep things in.") : t("Nothing has been put here yet.")}
          action={canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setUploadOpen(true)}><UploadSimpleIcon size={14} /> {t("Upload files")}</Button>
              <Button size="sm" variant="outline" onClick={startCreate}><FolderPlusIcon size={14} /> {t("New folder")}</Button>
            </div>
          ) : undefined} />
      )}
    </div>
  ) : (
    <>
      {layout === "details" ? (
        <DetailsHeader sort={prefs.sort} dir={prefs.dir}
          onSort={(field) => prefs.set(field === prefs.sort ? { dir: prefs.dir === "asc" ? "desc" : "asc" } : { sort: field, dir: field === "date" || field === "size" ? "desc" : "asc" })}
          allSelected={!!order.length && selectedKeys.length === order.length} someSelected={selecting}
          onSelectAll={(on) => act(on ? { type: "all", order } : { type: "clear" })} />
      ) : null}
      {newFolderItem && layout === "grid" ? <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5 px-3 pt-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:px-4 sm:pt-4">{newFolderItem}</div> : newFolderItem}
      {searching ? <>
        {searchFolders.length ? <section aria-label={t("Folders")}>{groupHead(t("Folders"), searchFolders.length)}{listOf(searchFolders, t("Folders"))}</section> : null}
        {searchFiles.length ? <section aria-label={t("Files")}>{groupHead(t("Files"), list.total ?? searchFiles.length)}{listOf(searchFiles, t("Files"))}</section> : null}
      </> : listOf(items, t("Files and folders"))}
      {files.length ? (
        <div className="px-4 py-3">
          <LoadMore noun="files" shown={files.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} />
        </div>
      ) : null}
    </>
  );

  const uploadIds = recent.filter((id) => !hidden.has(id)).slice(0, 3);
  const showFilter = (s: ShowFilter) => {
    setFilters({ ...NO_FILTERS, batch: s.batch, kinds: s.kind ? [kindKey(s.kind)] : [], dept: s.department === undefined ? null : s.department || "none" });
    onFolder("");
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* ---- toolbar */}
      <div data-guide="files.filters" className="grid shrink-0 gap-2 border-b border-border bg-surface px-3 py-2 sm:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <Button size="icon-sm" variant="ghost" className="shrink-0 pointer-coarse:size-11" disabled={!folder && !searching} onClick={goUp}
            aria-label={t("Up one folder")} title={`${t("Up one folder")} (Backspace)`}>
            <ArrowUpIcon size={17} weight="bold" />
          </Button>
          <PathBar branch={branch} folder={folder} searching={searching} onFolder={(p) => { setQ(""); onFolder(p); }} drop={(p) => dropProps(p, `crumb:${p}`)} over={dropOver} />
          <Button size="sm" variant="outline" className="shrink-0 md:hidden pointer-coarse:h-11" onClick={onOpenTree}>
            <TreeStructureIcon size={15} /> <span className="max-[400px]:sr-only">{t("Folders")}</span>
          </Button>
          <div ref={searchBox} className="hidden w-64 shrink-0 md:block lg:w-80"
            onKeyDown={(e: ReactKeyboardEvent) => {
              if (e.key === "Enter" && items[0]) { e.preventDefault(); openItem(items[0]); }
              if (e.key === "ArrowDown" && items[0]) { e.preventDefault(); setCursor(items[0].key); focusItem(items[0].key); }
              if (e.key === "Escape" && q) { e.preventDefault(); setQ(""); }
            }}>
            <SearchInput value={q} onChange={setQ} placeholder={t("Search folders and files")} label={t("Search folders and files")} className="w-full" />
          </div>
        </div>
        <div className="md:hidden"
          onKeyDown={(e: ReactKeyboardEvent) => { if (e.key === "Enter" && items[0]) { e.preventDefault(); openItem(items[0]); } }}>
          <SearchInput value={q} onChange={setQ} placeholder={t("Search folders and files")} label={t("Search folders and files")} />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {canEdit ? <>
            <Button size="sm" variant="outline" className="pointer-coarse:h-11" onClick={startCreate} aria-label={t("New folder")}>
              <FolderPlusIcon size={15} /> <span className="max-sm:hidden">{t("New folder")}</span>
            </Button>
            <Button size="sm" variant={uploadOpen ? "secondary" : "outline"} aria-pressed={uploadOpen} className="pointer-coarse:h-11" onClick={() => setUploadOpen(!uploadOpen)} aria-label={t("Upload")}>
              <UploadSimpleIcon size={15} /> <span className="max-sm:hidden">{t("Upload")}</span>
            </Button>
            {clip ? (
              <Button size="sm" variant="outline" className="pointer-coarse:h-11" onClick={() => void paste(folder)}
                title={`${t("Paste here")} (${MOD}V)`} aria-label={t("Paste here")}>
                <ClipboardIcon size={15} /> <span className="max-sm:hidden">{t("Paste")}</span>
                <span className="rounded-full bg-surface-2 px-1.5 text-[11px] text-muted tabular">{clip.items.length}</span>
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="pointer-coarse:h-11" onClick={() => askAi(selected.length ? selected : [])}
              aria-label={selected.length ? t("Ask AI to organize the selection") : t("Ask AI to organize this folder")}
              title={selected.length ? t("Ask AI to organize the selection") : t("Ask AI to organize this folder")}>
              <SparkleIcon size={15} /> <span className="max-lg:hidden">{t("Ask AI to organize")}</span>
            </Button>
          </> : null}
          <span className="flex-1" />
          <FilterButton filters={filters} setFilters={setFilters} branch={branch} />
          <SortButton sort={prefs.sort} dir={prefs.dir} onChange={(p) => prefs.set(p)} />
          <ViewSwitch layout={layout} onChange={(l) => prefs.set({ layout: l })} phone={phone} />
        </div>
        {filtering ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px]">
            <span className="text-muted">{searching ? t("Filtered results") : t("Matches in this folder and the folders inside it:")}</span>
            {filters.origin ? <Chip on onClick={() => setFilters({ ...filters, origin: null })}>{t(ORIGINS.find((o) => o.value === filters.origin)?.label ?? "")} <XIcon size={11} /></Chip> : null}
            {filters.types.map((x) => <Chip key={x} on onClick={() => setFilters({ ...filters, types: filters.types.filter((y) => y !== x) })}>{t(FILE_TYPES.find((y) => y.key === x)?.label ?? "")} <XIcon size={11} /></Chip>)}
            {filters.kinds.map((x) => <Chip key={x} on onClick={() => setFilters({ ...filters, kinds: filters.kinds.filter((y) => y !== x) })}>{x === "sop" ? "SOP" : t(KINDS.find((k) => k.key === x)?.label ?? "")} <XIcon size={11} /></Chip>)}
            {filters.labels.map((x) => <Chip key={x} on onClick={() => setFilters({ ...filters, labels: filters.labels.filter((y) => y !== x) })}>{x} <XIcon size={11} /></Chip>)}
            {filters.dept ? <Chip on onClick={() => setFilters({ ...filters, dept: null })}>{filters.dept === "none" ? t("No department") : branch.departments.find((d) => d.id === filters.dept)?.name ?? t("Department")} <XIcon size={11} /></Chip> : null}
            {filters.held ? <Chip on onClick={() => setFilters({ ...filters, held: false })}>{t("Held back only")} <XIcon size={11} /></Chip> : null}
            {filters.batch ? <Chip on onClick={() => setFilters({ ...filters, batch: null })}>{t("From one upload")} <XIcon size={11} /></Chip> : null}
            <Button size="sm" variant="ghost" className="h-7 pointer-coarse:h-10" onClick={() => setFilters(NO_FILTERS)}>{t("Clear filters")}</Button>
          </div>
        ) : null}
      </div>

      {/* ---- the files */}
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild disabled={coarse}>
          <div ref={area} data-file-browser data-explorer-area data-guide="files.list"
            onContextMenuCapture={() => setCtx("bg")}
            onClick={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.grid !== undefined || (e.target as HTMLElement).getAttribute("role") === "listbox") act({ type: "clear" }); }}
            onDragOver={(e) => {
              // The upload box takes its own drops.
              if (!canEdit || e.defaultPrevented) return;
              if (isFileDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setAreaOver(true); }
              else if (isOwnDrag(e) && canDropInto(folder)) { e.preventDefault(); e.dataTransfer.dropEffect = copyKey(e) ? "copy" : "move"; }
            }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAreaOver(false); }}
            onDrop={(e) => {
              setAreaOver(false);
              if (e.defaultPrevented) return;
              e.preventDefault();
              if (isOwnDrag(e)) {
                const its = draggedItems();
                endDrag();
                if (its && !searching) void ops.transfer(copyKey(e) ? "copy" : "cut", its, folder, { quiet: true });
                return;
              }
              dropInto(folder, e);
            }}
            className={cn("relative min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface outline-none [-webkit-touch-callout:none]",
              selecting && phone && "pb-24")}>
            {canEdit ? (
              <div className={cn("grid gap-3 border-b border-border bg-surface-2/30 p-3 sm:p-4", !uploadOpen && !uploadIds.length && "hidden")}>
                <div className={cn("grid gap-3", !uploadOpen && "hidden")}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold">{t("Upload into {folder}", { folder: ops.placeName(folder) })}</p>
                    <Button size="icon-sm" variant="ghost" className="pointer-coarse:size-11" aria-label={t("Close")} onClick={() => setUploadOpen(false)}><XIcon size={16} /></Button>
                  </div>
                  <IntakeDrop ref={intake} branch={branch} folder={folder} onBatch={(id) => setRecent((r) => [id, ...r.filter((x) => x !== id)])} />
                </div>
                {uploadIds.map((id, n) => (
                  <BatchCard key={id} batchId={id} branch={branch} onOpenFile={onOpenFile} onShow={showFilter} defaultOpen={n === 0}
                    guide={n === 0 ? "files.report" : undefined} onDismiss={() => setHidden((h) => new Set([...h, id]))} />
                ))}
              </div>
            ) : null}
            {searching ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border px-4 py-2 text-[12.5px] text-muted">
                {t("Folders and files named like “{q}” in {company}.", { q: needle, company: branch.name })}
                <Link to="/search" search={{ q: needle }} className="font-medium text-accent hover:underline">{t("Search inside documents")}</Link>
              </p>
            ) : null}
            {body}
            {areaOver ? (
              <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-[var(--radius-lg)] border-2 border-dashed border-accent bg-accent-soft/80">
                <p className="flex items-center gap-2 text-[14px] font-semibold text-accent"><UploadSimpleIcon size={20} /> {t("Drop to upload into {folder}", { folder: ops.placeName(folder) })}</p>
              </div>
            ) : null}
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content collisionPadding={8} className={MENU_BOX}>
            <ActItems acts={ctx === "items" && selected.length ? itemActs(selected) : backgroundActs()} Item={ContextMenu.Item as ItemCmp} Sep={ContextMenu.Separator as SepCmp} />
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      {/* ---- status bar (tablets and desktops) */}
      <div role="status" aria-live="polite" className="hidden min-h-10 shrink-0 items-center gap-2 border-t border-border bg-surface-2/50 px-3 text-[12.5px] text-muted md:flex">
        <span className="tabular-nums">
          {items.length === 1 ? t("1 item") : t("{n} items", { n: items.length.toLocaleString(locale()) })}
          {!selecting && totalSize ? ` · ${fileSize(totalSize)}` : ""}
        </span>
        {selecting ? <span className="font-medium text-fg tabular-nums">· {t("{n} selected", { n: selectedKeys.length })} · {fileSize(selSize)}</span> : null}
        {clip ? (
          <span className="flex items-center gap-1.5">
            · {clip.mode === "cut" ? <ScissorsIcon size={13} /> : <CopyIcon size={13} />}
            {clip.mode === "cut" ? t("{n} cut", { n: clip.items.length }) : t("{n} copied", { n: clip.items.length })}
            <button type="button" className="rounded-sm px-1 hover:bg-surface-2 hover:text-fg" onClick={() => setClip(null)} aria-label={t("Empty the clipboard")}><XIcon size={12} /></button>
          </span>
        ) : null}
        <span className="flex-1" />
        {selecting ? <>
          {canEdit ? <Button size="sm" variant="ghost" className="h-7" onClick={() => setPicker({ mode: "move", items: selected })}><FolderOpenIcon size={14} /> {t("Move to…")}</Button> : null}
          {canEdit && selFiles.length ? <Button size="sm" variant="ghost" className="h-7" onClick={() => setLabelsFor(selFiles)}><TagIcon size={14} /> {t("Labels…")}</Button> : null}
          <Button size="sm" variant="ghost" className="h-7" onClick={() => downloadItems(selected)}><DownloadSimpleIcon size={14} /> {t("Download")}</Button>
          {canEdit ? <Button size="sm" variant="ghost" className="h-7 text-danger" onClick={() => askDelete(selected)}><TrashIcon size={14} /> {t("Delete")}</Button> : null}
          <Button size="icon-sm" variant="ghost" className="size-7" onClick={() => act({ type: "clear" })} aria-label={t("Clear the selection")} title={`${t("Clear the selection")} (Esc)`}><XIcon size={14} /></Button>
        </> : (
          <a href={archiveUrl({ branch_id: branch.id, folder: folder || null })} download data-guide="files.download-folder"
            className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-surface-2 hover:text-fg">
            <DownloadSimpleIcon size={14} /> {folder ? t("Download folder") : t("Download all")}
          </a>
        )}
      </div>

      {/* ---- phones: what to do with the selection, at the bottom */}
      {selecting && phone ? (
        <div role="toolbar" aria-label={t("Selected")}
          className="fixed inset-x-0 bottom-0 z-30 grid gap-1 border-t border-border bg-surface/95 px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] shadow-[var(--shadow-pop)] backdrop-blur-md">
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[13px] font-semibold tabular-nums">{t("{n} selected", { n: selectedKeys.length })} · {fileSize(selSize)}</span>
            <Button size="sm" variant="ghost" className="h-11" onClick={() => act({ type: "clear" })}><XIcon size={15} /> {t("Done")}</Button>
          </div>
          <div className="grid grid-cols-5 gap-1">
            {([
              canEdit ? { id: "move", label: t("Move"), icon: <FolderOpenIcon size={20} />, run: () => setPicker({ mode: "move", items: selected }) } : null,
              { id: "copy", label: t("Copy"), icon: <CopyIcon size={20} />, run: () => (canEdit ? setPicker({ mode: "copy", items: selected }) : toClip("copy", selected)) },
              canEdit && selFiles.length ? { id: "labels", label: t("Labels"), icon: <TagIcon size={20} />, run: () => setLabelsFor(selFiles) } : { id: "download", label: t("Download"), icon: <DownloadSimpleIcon size={20} />, run: () => downloadItems(selected) },
              canEdit ? { id: "delete", label: t("Delete"), icon: <TrashIcon size={20} />, run: () => askDelete(selected), danger: true } : null,
            ] as (BarAct | null)[]).filter((x): x is BarAct => !!x).map((a) => (
              <button key={a.id} type="button" onClick={a.run}
                className={cn("flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-sm text-[11.5px] font-medium hover:bg-surface-2", a.danger ? "text-danger" : "text-fg")}>
                {a.icon}{a.label}
              </button>
            ))}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button type="button" className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-sm text-[11.5px] font-medium text-fg hover:bg-surface-2">
                  <DotsThreeIcon size={20} weight="bold" />{t("More")}
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content side="top" align="end" sideOffset={6} collisionPadding={8} className={cn(MENU_BOX, "max-h-[var(--radix-dropdown-menu-content-available-height)]")}>
                  <ActItems acts={itemActs(selected)} Item={DropdownMenu.Item as ItemCmp} Sep={DropdownMenu.Separator as SepCmp} />
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        </div>
      ) : null}

      {/* ---- dialogs */}
      <FolderPickerDialog open={!!picker} onOpenChange={(o) => !o && setPicker(null)} mode={picker?.mode ?? "move"} root={root} rootName={branch.name} current={folder}
        what={picker ? itemsWord(picker.items.filter((i) => i.kind === "file").length, picker.items.filter((i) => i.kind === "folder").length) : ""}
        onPick={(dest) => {
          if (!picker) return;
          const its = picker.items;
          void ops.transfer(picker.mode === "move" ? "cut" : "copy", its.map(toClipItem), cleanFolder(dest)).then((ok) => { if (ok) act({ type: "clear" }); });
        }} />
      <LabelsDialog open={!!labelsFor} onOpenChange={(o) => !o && setLabelsFor(null)} files={labelsFor ?? []} branchId={branch.id} />
      <ConfirmDialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)} danger
        confirmLabel={removing ? t("Delete {what}", { what: itemsWord(removing.files.length, removing.folders.length) }) : t("Delete")}
        title={removing ? t("Delete {what}?", { what: itemsWord(removing.files.length, removing.folders.length) }) : ""}
        body={removing?.files.length ? t("Agents can no longer read them, and packs that use them will show them as missing.") : t("The empty folders are removed.")}
        onConfirm={async () => {
          if (!removing) return;
          await ops.remove(removing.files, removing.folders);
          act({ type: "clear" });
        }} />
      <ResponsiveDialog open={!!building} onOpenChange={(o) => !o && setBuilding(null)} className="w-[min(94vw,34rem)]"
        title={t("Turn it into a procedure")} description={t("Make an SOP agents follow, or a workflow that runs the job step by step, from these documents.")}>
        {building ? <BuildFromDocs fileIds={building} branchId={branch.id} /> : null}
      </ResponsiveDialog>
      <NotEmptyDialog folder={notEmpty} onClose={() => setNotEmpty(null)} onOpen={onFolder} />
    </div>
  );
}

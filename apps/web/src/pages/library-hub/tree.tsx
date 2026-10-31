/** The Browse tab's folder directory: the company's own folders as a tree, then the
 * ready-made folders (documents, SOPs, guidelines, templates and quick views of the file
 * store) with their counts. A real folder tree down the side on tablets and desktops (its own
 * scroll, arrow keys, chevrons); in a sheet and as a drill-down list on phones, with a
 * breadcrumb and a back button above the contents. */
import {
  ArrowLeftIcon, BuildingsIcon, CaretRightIcon, FolderIcon, FolderOpenIcon, ShieldWarningIcon, TreeStructureIcon, type Icon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { locale, useT } from "@/i18n";
import { docStatsQuery, fileStatsQuery, templatesQuery } from "@/lib/documents";
import type { StoreView } from "@/lib/file-store";
import { buildTree, fileTreeQuery, folderChain, folderName, type FolderNode } from "@/lib/intake";
import { reviewCountQuery } from "@/lib/provenance";
import type { Branch } from "@/lib/types";
import { cn } from "@/lib/utils";
import { sopsQuery } from "@/lib/work";

import { sopsForCompany, templatesForCompany, VIEW_GROUPS, VIEW_INFO } from "./views";

// ---------------------------------------------------------------- the tree's shape

/** One entry of the tree: a group heading, the company (its top folder), one of its folders,
 * a company to pick (under "All companies") or a ready-made folder. */
interface TNode {
  key: string;
  kind: "group" | "root" | "folder" | "company" | "view";
  label: string;
  children: TNode[];
  path?: string;
  view?: StoreView;
  companyId?: string;
  color?: string;
  count?: number;
  flagged?: number;
}

/** A visible row: the node, where it sits, and whether it is open. */
interface TRow {
  node: TNode;
  level: number;
  parent: string | null;
  size: number;
  pos: number;
  open: boolean;
}

const GROUP_COMPANY = "g:company";
const groupKey = (i: number) => `g:${i}`;
const folderKey = (path: string) => `f:${path}`;

function flatten(nodes: TNode[], level: number, parent: string | null, expanded: Set<string>, out: TRow[]): TRow[] {
  nodes.forEach((node, i) => {
    const open = node.children.length > 0 && expanded.has(node.key);
    out.push({ node, level, parent, size: nodes.length, pos: i + 1, open });
    if (open) flatten(node.children, level + 1, node.key, expanded, out);
  });
  return out;
}

/** The rows that must be open for this one to show. */
function ancestorsOf(view: StoreView, folder: string, branch: Branch | null): string[] {
  if (view !== "folders") {
    const g = VIEW_GROUPS.findIndex((x) => x.views.includes(view));
    return g >= 0 ? [groupKey(g)] : [];
  }
  return [GROUP_COMPANY, ...(branch ? [folderKey(""), ...folderChain(folder).slice(0, -1).map(folderKey)] : [])];
}

/** Scroll the nearest scrolling box (not the page) just enough to show `el`. */
function keepInView(el: HTMLElement) {
  let box = el.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const pad = 8;
  if (r.top < b.top + pad) box.scrollTop -= b.top + pad - r.top;
  else if (r.bottom > b.bottom - pad) box.scrollTop += r.bottom - (b.bottom - pad);
}

// ---------------------------------------------------------------- one row

function TreeRow({ row, selected, tabbable, onActivate, onToggle, onFocus, setEl }: {
  row: TRow;
  selected: boolean;
  tabbable: boolean;
  onActivate: () => void;
  onToggle: () => void;
  onFocus: () => void;
  setEl: (el: HTMLLIElement | null) => void;
}) {
  const t = useT();
  const { node, open } = row;
  const group = node.kind === "group";
  const V = node.view ? VIEW_INFO[node.view] : null;
  const IconCmp: Icon | null = node.kind === "root" ? BuildingsIcon
    : node.kind === "folder" ? (open || selected ? FolderOpenIcon : FolderIcon)
    : V ? V.icon : null;
  // Groups and the company sit flush; folders step in under the company.
  const indent = group ? 0 : Math.max(0, row.level - 2) * 12;
  return (
    <li ref={setEl} role="treeitem" aria-level={row.level} aria-setsize={row.size} aria-posinset={row.pos}
      aria-expanded={node.children.length ? open : undefined} aria-selected={group ? undefined : selected}
      tabIndex={tabbable ? 0 : -1} onClick={onActivate} onFocus={onFocus}
      title={node.kind === "folder" ? node.path : V ? t(V.hint) : undefined}
      className={cn(
        "flex min-w-0 cursor-pointer items-center rounded-sm outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset",
        group ? "mt-2 text-muted/80 first:mt-0 hover:text-fg"
          : selected ? "bg-accent-soft font-semibold text-accent" : "hover:bg-surface-2",
      )}
      style={{ paddingLeft: indent }}>
      {node.children.length ? (
        <span aria-hidden onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className="grid size-7 shrink-0 place-items-center rounded-sm text-muted hover:text-fg pointer-coarse:size-11">
          <CaretRightIcon size={group ? 10 : 12} weight="bold" className={cn("transition-transform", open && "rotate-90")} />
        </span>
      ) : <span className="size-7 shrink-0 pointer-coarse:size-11" aria-hidden />}
      {group ? (
        <span className="min-w-0 flex-1 truncate py-1.5 pr-2 text-[10.5px] font-semibold tracking-[0.08em] uppercase">{node.label}</span>
      ) : (
        <span className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-[13px] pointer-coarse:py-2.5">
          {node.kind === "company" ? <span aria-hidden className="mx-[3px] size-2.5 shrink-0 rounded-full" style={{ background: node.color || "var(--accent)" }} />
            : IconCmp ? <IconCmp size={16} weight={selected && node.kind === "view" ? "fill" : "duotone"} className={cn("shrink-0", !selected && node.kind !== "root" && "text-muted")} /> : null}
          <span className="min-w-0 flex-1 truncate">{node.label}</span>
          {node.flagged ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-warn/14 px-1.5 text-[11px] font-medium text-warn" title={t("{n} held back", { n: node.flagged })}>
              <ShieldWarningIcon size={11} weight="bold" />{node.flagged}
            </span>
          ) : null}
          {node.count ? (
            <span className={cn("shrink-0 tabular", node.view === "review" ? "rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" : "text-[11.5px] font-normal text-muted")}>
              {node.count.toLocaleString(locale())}
            </span>
          ) : null}
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- the whole directory

/** The Library's folders as one tree (role="tree"): the company and its folders, then the
 * ready-made folders in their groups. Up and Down move, Right opens a folder (or steps into it),
 * Left closes it (or steps out), Enter opens it, Home and End jump. The open folder stays
 * highlighted and in view; the tree scrolls on its own, never the page. */
export function LibraryTree({ view, folder, branch, branches, onView, onFolder, onCompany }: {
  view: StoreView;
  folder: string;
  branch: Branch | null;
  branches: Branch[];
  onView: (v: StoreView) => void;
  onFolder: (path: string) => void;
  onCompany: (id: string) => void;
}) {
  const t = useT();
  const counts = useViewCounts(branch);
  const { tree, root } = useFolderTree(branch?.id ?? null);

  const nodes = useMemo<TNode[]>(() => {
    const folderNode = (n: FolderNode): TNode => ({
      key: folderKey(n.path), kind: "folder", label: n.name, path: n.path, count: n.files, flagged: n.flagged, children: n.children.map(folderNode),
    });
    const company: TNode = branch
      ? {
        key: GROUP_COMPANY, kind: "group", label: t("Company folders"),
        children: [{
          key: folderKey(""), kind: "root", label: branch.name, path: "", count: tree?.total_files ?? root.files, flagged: root.flagged,
          children: root.children.map(folderNode),
        }],
      }
      : {
        key: GROUP_COMPANY, kind: "group", label: t("Company folders"),
        children: branches.map((b) => ({ key: `c:${b.id}`, kind: "company", label: b.name, companyId: b.id, color: b.color, children: [] })),
      };
    return [company, ...VIEW_GROUPS.map((g, i): TNode => ({
      key: groupKey(i), kind: "group", label: t(g.title),
      children: g.views.map((v) => ({ key: `v:${v}`, kind: "view", label: t(VIEW_INFO[v].label), view: v, count: counts[v], children: [] })),
    }))];
  }, [branch, branches, root, tree?.total_files, counts, t]);

  const selectedKey = view === "folders" ? (branch ? folderKey(folder) : null) : `v:${view}`;

  // Open: every group, the company, and the folders down to the open one; then whatever the
  // person opens or closes. When the open folder changes, the way down to it opens again.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([
    GROUP_COMPANY, folderKey(""), ...VIEW_GROUPS.map((_, i) => groupKey(i)), ...ancestorsOf(view, folder, branch),
  ]));
  const [seen, setSeen] = useState(selectedKey);
  const [focusKey, setFocusKey] = useState<string | null>(selectedKey);
  if (seen !== selectedKey) {
    setSeen(selectedKey);
    setFocusKey(selectedKey);
    const need = ancestorsOf(view, folder, branch);
    if (need.some((k) => !expanded.has(k))) setExpanded((s) => new Set([...s, ...need]));
  }

  const rows = useMemo(() => flatten(nodes, 1, null, expanded, []), [nodes, expanded]);
  const active = rows.some((r) => r.node.key === focusKey) ? focusKey
    : rows.some((r) => r.node.key === selectedKey) ? selectedKey
    : rows[0]?.node.key ?? null;

  const els = useRef(new Map<string, HTMLLIElement>());
  // The open folder stays in view, scrolling the tree only when it is off-screen (also once
  // the folders load, for a link straight to a deep folder).
  const shown = rows.some((r) => r.node.key === selectedKey);
  useEffect(() => {
    const el = shown && selectedKey ? els.current.get(selectedKey) : undefined;
    if (el) keepInView(el);
  }, [selectedKey, shown]);

  const toggle = (key: string, open?: boolean) => setExpanded((s) => {
    const n = new Set(s);
    if (open ?? !n.has(key)) n.add(key);
    else n.delete(key);
    return n;
  });
  const activate = (node: TNode) => {
    setFocusKey(node.key);
    if (node.kind === "group") toggle(node.key);
    else if (node.kind === "company" && node.companyId) onCompany(node.companyId);
    else if (node.kind === "view" && node.view) onView(node.view);
    else if (node.path !== undefined) {
      if (node.children.length) toggle(node.key, true);
      onFolder(node.path);
    }
  };
  const focusRow = (key: string | null | undefined) => {
    if (!key) return;
    setFocusKey(key);
    const el = els.current.get(key);
    if (el) {
      el.focus({ preventScroll: true });
      keepInView(el);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const i = rows.findIndex((r) => r.node.key === active);
    const row = rows[i];
    if (!row) return;
    const kids = row.node.children.length > 0;
    switch (e.key) {
      case "ArrowDown": focusRow(rows[i + 1]?.node.key); break;
      case "ArrowUp": focusRow(rows[i - 1]?.node.key); break;
      case "Home": focusRow(rows[0]?.node.key); break;
      case "End": focusRow(rows[rows.length - 1]?.node.key); break;
      case "ArrowRight":
        if (kids && !row.open) toggle(row.node.key, true);
        else if (row.open) focusRow(rows[i + 1]?.node.key);
        break;
      case "ArrowLeft":
        if (row.open) toggle(row.node.key, false);
        else focusRow(row.parent);
        break;
      case "Enter":
      case " ":
        activate(row.node);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <nav aria-label={t("Library folders")} data-guide="files.views" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start">
      <ul role="tree" aria-label={t("Library folders")} data-guide="files.tree" onKeyDown={onKeyDown}
        className="grid grid-cols-[minmax(0,1fr)] content-start gap-px">
        {rows.map((row) => (
          <TreeRowWithHint key={row.node.key} empty={row.node.kind === "root" && !row.node.children.length}>
            <TreeRow row={row} selected={row.node.key === selectedKey} tabbable={row.node.key === active}
              onActivate={() => activate(row.node)} onToggle={() => toggle(row.node.key)} onFocus={() => setFocusKey(row.node.key)}
              setEl={(el) => { if (el) els.current.set(row.node.key, el); else els.current.delete(row.node.key); }} />
          </TreeRowWithHint>
        ))}
      </ul>
    </nav>
  );
}

/** The company row, and under it a word on how folders appear while it has none. */
function TreeRowWithHint({ empty, children }: { empty: boolean; children: ReactNode }) {
  const t = useT();
  if (!empty) return children;
  return <>
    {children}
    <li role="none" className="py-1 pr-2 pl-9 text-[12px] text-muted">
      {t("No folders yet. Upload a folder or a zip and its folders show here.")}
    </li>
  </>;
}

// ---------------------------------------------------------------- data

export function findNode(root: FolderNode, path: string): FolderNode | null {
  if (root.path === path) return root;
  for (const c of root.children) {
    if (path === c.path || path.startsWith(`${c.path}/`)) return findNode(c, path);
  }
  return null;
}

/** The company's folder tree (cached with the list below it). */
export function useFolderTree(branchId: string | null) {
  const { data: tree } = useQuery({ ...fileTreeQuery(branchId ?? ""), enabled: !!branchId });
  const root = useMemo(() => buildTree(tree?.folders ?? []), [tree]);
  return { tree, root };
}

// ---------------------------------------------------------------- counts

/** How many things each ready-made folder holds, for the company in view (or every one). */
export function useViewCounts(branch: Branch | null): Partial<Record<StoreView, number>> {
  const params: Record<string, string> = branch ? { branch_id: branch.id } : {};
  const { data: stats } = useQuery(fileStatsQuery(params));
  const { data: review } = useQuery(reviewCountQuery);
  const { data: docs } = useQuery(docStatsQuery(params));
  const { data: sops } = useQuery(sopsQuery);
  const { data: templates } = useQuery(templatesQuery);
  return {
    documents: docs?.total,
    sops: sops ? sopsForCompany(sops, branch).length : undefined,
    library: stats?.library,
    templates: templates ? templatesForCompany(templates, branch).length : undefined,
    review: review?.waiting,
    tasks: stats?.in_tasks,
    recent: stats?.total,
    agents: stats?.agent,
    downloads: stats?.download,
    uploaded: stats?.upload,
  };
}


// ---------------------------------------------------------------- phones: drill down

/** At the top of the Library on phones: the ready-made folders as rows to tap into. */
export function QuickFolders({ branch, onView, className }: { branch: Branch | null; onView: (v: StoreView) => void; className?: string }) {
  const t = useT();
  const counts = useViewCounts(branch);
  return (
    <ul aria-label={t("Folders")} className={cn("grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface", className)}>
      {VIEW_GROUPS.flatMap((g) => g.views).map((v) => {
        const V = VIEW_INFO[v];
        const n = counts[v];
        return (
          <li key={v}>
            <button type="button" onClick={() => onView(v)}
              className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2/70">
              <span className="grid size-9 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent ring-1 ring-accent/15 ring-inset"><V.icon size={18} weight="duotone" /></span>
              <span className="grid min-w-0">
                <span className="truncate text-[14px] font-medium">{t(V.label)}</span>
                <span className="truncate text-[12px] text-muted">{t(V.hint)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                {n ? <span className={cn("tabular", v === "review" ? "rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" : "text-[12px] text-muted")}>{n.toLocaleString(locale())}</span> : null}
                <CaretRightIcon size={14} className="text-muted" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Where you are: Library › a ready-made folder, or Library › the company › its folders. Every
 * part opens its folder. On phones a back button goes up one folder, and Folders opens the tree. */
export function BrowseCrumbs({ view, folder, branch, onRoot, onFolder, onOpenTree, className }: {
  view: StoreView;
  folder: string;
  branch: Branch | null;
  onRoot: () => void;
  onFolder: (path: string) => void;
  onOpenTree: () => void;
  className?: string;
}) {
  const t = useT();
  const chain = view === "folders" ? folderChain(folder) : [];
  const crumb = "min-w-0 rounded-sm px-1.5 py-0.5 text-left break-words [overflow-wrap:anywhere] hover:bg-surface-2 pointer-coarse:py-1.5";
  const sep = <CaretRightIcon size={11} className="shrink-0 text-muted" aria-hidden />;
  // One folder up: the folder above, the company, or the Library itself.
  const up: { label: string; go: () => void } | null = view !== "folders"
    ? { label: t("Library"), go: onRoot }
    : chain.length > 1 ? { label: folderName(chain[chain.length - 2] ?? ""), go: () => onFolder(chain[chain.length - 2] ?? "") }
    : chain.length === 1 ? { label: branch?.name ?? t("Library"), go: () => onFolder("") }
    : null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2", className)}>
      {up ? (
        <button type="button" onClick={up.go} aria-label={t("Back to {name}", { name: up.label })} title={t("Back to {name}", { name: up.label })}
          className="-my-1 -ml-1.5 grid size-11 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg md:hidden">
          <ArrowLeftIcon size={18} weight="bold" />
        </button>
      ) : null}
      <nav aria-label={t("Folder path")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[13px]">
        <button type="button" onClick={onRoot} className={cn(crumb, "shrink-0 whitespace-nowrap", view === "folders" && !folder && !branch && "font-semibold")}>{t("Library")}</button>
        {view !== "folders" ? (
          <span className="flex min-w-0 items-center gap-1">{sep}<span aria-current="page" className="min-w-0 px-1.5 font-semibold break-words">{t(VIEW_INFO[view].label)}</span></span>
        ) : branch ? (
          <span className="flex min-w-0 items-center gap-1">
            {sep}
            <button type="button" onClick={() => onFolder("")} aria-current={!folder ? "page" : undefined} className={cn(crumb, !folder && "font-semibold")}>{branch.name}</button>
          </span>
        ) : null}
        {chain.map((p, i) => (
          <span key={p} className="flex min-w-0 items-center gap-1">
            {sep}
            <button type="button" onClick={() => onFolder(p)} aria-current={i === chain.length - 1 ? "page" : undefined}
              className={cn(crumb, i === chain.length - 1 && "font-semibold")}>{folderName(p)}</button>
          </span>
        ))}
      </nav>
      <Button size="sm" variant="outline" className="shrink-0 md:hidden" onClick={onOpenTree}><TreeStructureIcon size={14} /> {t("Folders")}</Button>
    </div>
  );
}

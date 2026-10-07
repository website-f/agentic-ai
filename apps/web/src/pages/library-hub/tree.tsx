/** The Browse tab's folder directory: the company's own folders as a tree, then the
 * ready-made folders (documents, SOPs, guidelines, templates and quick views of the file
 * store) with their counts. Down the side on desktop; in a sheet and as a drill-down list on
 * phones, with a breadcrumb above the contents. */
import { BuildingsIcon, CaretRightIcon, FolderIcon, FolderOpenIcon, ShieldWarningIcon, TreeStructureIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

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

// ---------------------------------------------------------------- the company's folders

function TreeNode({ node, depth, current, open, onToggle, onPick }: {
  node: FolderNode;
  depth: number;
  current: string | null;
  open: Set<string>;
  onToggle: (path: string) => void;
  onPick: (path: string) => void;
}) {
  const t = useT();
  const isOpen = open.has(node.path);
  const on = current === node.path;
  return (
    <li>
      <div className={cn("group flex min-w-0 items-center rounded-sm", on ? "bg-accent-soft text-accent" : "hover:bg-surface-2")}
        style={{ paddingLeft: `${depth * 12}px` }}>
        {node.children.length ? (
          <button type="button" onClick={() => onToggle(node.path)} aria-expanded={isOpen}
            aria-label={isOpen ? t("Close {name}", { name: node.name }) : t("Open {name}", { name: node.name })}
            className="grid size-7 shrink-0 place-items-center rounded-sm text-muted hover:text-fg pointer-coarse:size-9">
            <CaretRightIcon size={12} weight="bold" className={cn("transition-transform", isOpen && "rotate-90")} />
          </button>
        ) : <span className="size-7 shrink-0 pointer-coarse:size-9" aria-hidden />}
        <button type="button" onClick={() => onPick(node.path)} aria-current={on ? "true" : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-[13px] pointer-coarse:py-2.5">
          {isOpen || on ? <FolderOpenIcon size={16} weight="duotone" className="shrink-0" /> : <FolderIcon size={16} weight="duotone" className="shrink-0 text-muted" />}
          <span className="min-w-0 flex-1 truncate" title={node.path}>{node.name}</span>
          {node.flagged ? (
            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-warn/14 px-1.5 text-[11px] font-medium text-warn" title={t("{n} held back", { n: node.flagged })}>
              <ShieldWarningIcon size={11} weight="bold" />{node.flagged}
            </span>
          ) : null}
          <span className="shrink-0 text-[11.5px] text-muted tabular">{node.files.toLocaleString(locale())}</span>
        </button>
      </div>
      {isOpen && node.children.length ? (
        <ul>
          {node.children.map((c) => <TreeNode key={c.path} node={c} depth={depth + 1} current={current} open={open} onToggle={onToggle} onPick={onPick} />)}
        </ul>
      ) : null}
    </li>
  );
}

/** One company's folders. `current` is null when another folder of the Library is open. */
function FolderTree({ root, current, onPick, total, rootLabel }: {
  root: FolderNode;
  current: string | null;
  onPick: (path: string) => void;
  total: number;
  rootLabel: string;
}) {
  const t = useT();
  // Open the chain to the current folder, plus whatever the person opens.
  const [opened, setOpened] = useState<Set<string>>(() => new Set(folderChain(current ?? "").slice(0, -1)));
  const open = useMemo(() => new Set([...opened, ...folderChain(current ?? "").slice(0, -1)]), [opened, current]);
  const toggle = (p: string) => setOpened((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });
  return (
    <div data-guide="files.tree" className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
      <button type="button" onClick={() => onPick("")} aria-current={current === "" ? "true" : undefined}
        className={cn("flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] font-medium pointer-coarse:py-2.5", current === "" ? "bg-accent-soft text-accent" : "hover:bg-surface-2")}>
        <BuildingsIcon size={16} weight="duotone" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{rootLabel}</span>
        {root.flagged ? <span className="inline-flex items-center gap-0.5 rounded-full bg-warn/14 px-1.5 text-[11px] font-medium text-warn"><ShieldWarningIcon size={11} weight="bold" />{root.flagged}</span> : null}
        <span className="text-[11.5px] text-muted tabular">{total.toLocaleString(locale())}</span>
      </button>
      {root.children.length ? (
        <ul>
          {root.children.map((c) => <TreeNode key={c.path} node={c} depth={0} current={current} open={open} onToggle={toggle} onPick={onPick} />)}
        </ul>
      ) : <p className="px-2 py-1 text-[12.5px] text-muted">{t("No folders yet. Upload a folder or a zip and its folders show here.")}</p>}
    </div>
  );
}

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

// ---------------------------------------------------------------- the whole directory

function GroupTitle({ children }: { children: string }) {
  return <p className="px-2 pt-3 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase first:pt-0">{children}</p>;
}

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
  return (
    <nav aria-label={t("Library folders")} data-guide="files.views" className="grid grid-cols-[minmax(0,1fr)] content-start gap-0.5">
      <GroupTitle>{t("Company folders")}</GroupTitle>
      {branch ? (
        <FolderTree key={branch.id} root={root} current={view === "folders" ? folder : null} onPick={onFolder}
          total={tree?.total_files ?? root.files} rootLabel={branch.name} />
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          {branches.map((b) => (
            <li key={b.id}>
              <button type="button" onClick={() => onCompany(b.id)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 pointer-coarse:py-2.5">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: b.color || "var(--accent)" }} />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                <CaretRightIcon size={12} className="shrink-0 text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {VIEW_GROUPS.map((g) => (
        <div key={g.title} className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
          <GroupTitle>{t(g.title)}</GroupTitle>
          {g.views.map((v) => {
            const on = v === view;
            const V = VIEW_INFO[v];
            const n = counts[v];
            return (
              <button key={v} type="button" onClick={() => onView(v)} aria-current={on ? "page" : undefined} title={t(V.hint)}
                className={cn("flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors pointer-coarse:py-2.5",
                  on ? "bg-accent-soft font-semibold text-accent" : "hover:bg-surface-2")}>
                <V.icon size={16} weight={on ? "fill" : "duotone"} className={cn("shrink-0", !on && "text-muted")} />
                <span className="min-w-0 flex-1 truncate">{t(V.label)}</span>
                {n ? (
                  <span className={cn("tabular", v === "review" ? "rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" : "text-[11.5px] text-muted")}>
                    {n.toLocaleString(locale())}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
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

/** Where you are: Library › a ready-made folder, or Library › the company › its folders. */
export function BrowseCrumbs({ view, folder, branch, onRoot, onFolder, onOpenTree }: {
  view: StoreView;
  folder: string;
  branch: Branch | null;
  onRoot: () => void;
  onFolder: (path: string) => void;
  onOpenTree: () => void;
}) {
  const t = useT();
  const chain = view === "folders" ? folderChain(folder) : [];
  const crumb = "min-w-0 rounded-sm px-1.5 py-0.5 text-left break-words [overflow-wrap:anywhere] hover:bg-surface-2";
  const sep = <CaretRightIcon size={11} className="shrink-0 text-muted" aria-hidden />;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
      <Button size="sm" variant="outline" className="shrink-0 lg:hidden" onClick={onOpenTree}><TreeStructureIcon size={14} /> {t("Folders")}</Button>
      <nav aria-label={t("Folder path")} className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-[13px]">
        <button type="button" onClick={onRoot} className={cn(crumb, "shrink-0 whitespace-nowrap", view === "folders" && !folder && !branch && "font-semibold")}>{t("Library")}</button>
        {view !== "folders" ? (
          <span className="flex min-w-0 items-center gap-1">{sep}<span className="min-w-0 px-1.5 font-semibold break-words">{t(VIEW_INFO[view].label)}</span></span>
        ) : branch ? (
          <span className="flex min-w-0 items-center gap-1">
            {sep}
            <button type="button" onClick={() => onFolder("")} className={cn(crumb, !folder && "font-semibold")}>{branch.name}</button>
          </span>
        ) : null}
        {chain.map((p, i) => (
          <span key={p} className="flex min-w-0 items-center gap-1">
            {sep}
            <button type="button" onClick={() => onFolder(p)} className={cn(crumb, i === chain.length - 1 && "font-semibold")}>{folderName(p)}</button>
          </span>
        ))}
      </nav>
    </div>
  );
}

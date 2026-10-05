/** Company files (P24): one place per company for all its documents. Upload anything (files,
 * folders, zips), see each upload sorted with a report, browse the folders, open and download
 * any file, a folder or everything, and turn procedures into SOPs and workflows. */
import {
  BooksIcon, BuildingsIcon, CaretRightIcon, CheckIcon, DownloadSimpleIcon, FolderIcon, FolderOpenIcon, FolderSimpleIcon,
  ShieldWarningIcon, TrashIcon, TreeStructureIcon, XIcon,
} from "@phosphor-icons/react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { FileStatus } from "@/components/file-drop";
import { LoadMore } from "@/components/load-more";
import { FileProvenanceCard, MadeBy, ReviewPill, WorkLinks } from "@/components/provenance";
import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, Toolbar } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { ALL_COMPANIES, useCompanies } from "@/lib/company";
import { docKeys, fileQuery, fileSize, fileStatsQuery } from "@/lib/documents";
import {
  archiveUrl, buildTree, deleteFile, fileTreeQuery, folderChain, folderName, intakeKeys, KINDS, kindKey, kindLabel, notThere,
  type CompanyFile, type FolderNode, type IntakeBatch, type KindKey,
} from "@/lib/intake";
import { libraryKeys, setLibrary } from "@/lib/library";
import { usePagedList, useDebounced } from "@/lib/paged";
import { fileOrigin, type FileOrigin, type FileProvenance } from "@/lib/provenance";
import { meQuery } from "@/lib/queries";
import { hasAny, type Branch } from "@/lib/types";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

import { BuildFromDocs } from "@/components/doc-builders";
import { BatchCard, IntakeDrop, type ShowFilter } from "./files-upload";
import { FileViewer, MoveDialog, moveMany } from "./files-viewer";
import { DocSteps, FileTile, KindTile } from "./visuals";

type View = "folder" | "kind" | "department";
const ANY = "__any";
const NO_DEPT = "__none";
/** P25: who made it. */
type OriginFilter = FileOrigin | typeof ANY;
type ProvFile = CompanyFile & FileProvenance;

// ---------------------------------------------------------------- folder tree

function TreeNode({ node, depth, current, open, onToggle, onPick }: {
  node: FolderNode;
  depth: number;
  current: string;
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

function FolderTree({ root, current, onPick, total }: { root: FolderNode; current: string; onPick: (path: string) => void; total: number }) {
  const t = useT();
  // Open the chain to the current folder, plus whatever the person opens.
  const [opened, setOpened] = useState<Set<string>>(() => new Set(folderChain(current).slice(0, -1)));
  const open = useMemo(() => new Set([...opened, ...folderChain(current).slice(0, -1)]), [opened, current]);
  const toggle = (p: string) => setOpened((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });
  return (
    <nav aria-label={t("Folders")} data-guide="files.tree" className="grid gap-1">
      <button type="button" onClick={() => onPick("")} aria-current={current === "" ? "true" : undefined}
        className={cn("flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] font-medium pointer-coarse:py-2.5", current === "" ? "bg-accent-soft text-accent" : "hover:bg-surface-2")}>
        <TreeStructureIcon size={16} weight="duotone" className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{t("All files")}</span>
        {root.flagged ? <span className="inline-flex items-center gap-0.5 rounded-full bg-warn/14 px-1.5 text-[11px] font-medium text-warn"><ShieldWarningIcon size={11} weight="bold" />{root.flagged}</span> : null}
        <span className="text-[11.5px] text-muted tabular">{total.toLocaleString(locale())}</span>
      </button>
      {root.children.length ? (
        <ul>
          {root.children.map((c) => <TreeNode key={c.path} node={c} depth={0} current={current} open={open} onToggle={toggle} onPick={onPick} />)}
        </ul>
      ) : <p className="px-2 py-1 text-[12.5px] text-muted">{t("No folders yet. Upload a folder or a zip and its folders show here.")}</p>}
    </nav>
  );
}

function findNode(root: FolderNode, path: string): FolderNode | null {
  if (root.path === path) return root;
  for (const c of root.children) {
    if (path === c.path || path.startsWith(`${c.path}/`)) return findNode(c, path);
  }
  return null;
}

function Crumbs({ folder, onPick }: { folder: string; onPick: (p: string) => void }) {
  const t = useT();
  const chain = folderChain(folder);
  return (
    <nav aria-label={t("Folder path")} className="flex min-w-0 flex-wrap items-center gap-1 text-[13px]">
      <button type="button" onClick={() => onPick("")} className={cn("shrink-0 rounded-sm px-1.5 py-0.5 whitespace-nowrap hover:bg-surface-2", !folder && "font-semibold")}>{t("All files")}</button>
      {chain.map((p, i) => (
        <span key={p} className="flex min-w-0 items-center gap-1">
          <CaretRightIcon size={11} className="shrink-0 text-muted" aria-hidden />
          <button type="button" onClick={() => onPick(p)}
            className={cn("min-w-0 rounded-sm px-1.5 py-0.5 text-left break-words [overflow-wrap:anywhere] hover:bg-surface-2", i === chain.length - 1 && "font-semibold")}>
            {folderName(p)}
          </button>
        </span>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------- rows

function FileRow({ f, branch, picked, onPick, onOpen, active, showFolder }: {
  f: CompanyFile;
  branch: Branch;
  picked: boolean;
  onPick: (on: boolean) => void;
  onOpen: () => void;
  active: boolean;
  showFolder: boolean;
}) {
  const t = useT();
  const kk = kindKey(f.kind);
  const dept = branch.departments.find((d) => d.id === f.department_id)?.name;
  return (
    <li className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-start", active && "bg-accent-soft/50", picked && "bg-accent-soft/30")}>
      <label className="grid cursor-pointer place-items-center self-stretch pl-4 pr-1 pointer-coarse:pl-3">
        <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} className="size-4 accent-[var(--accent)] pointer-coarse:size-5"
          aria-label={t("Select {name}", { name: f.title || f.name })} />
      </label>
      <button type="button" onClick={onOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 py-3 pr-4 pl-2 text-left transition-colors hover:bg-surface-2/70 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        {kk === "other" ? <FileTile mime={f.mime} name={f.name} /> : <KindTile kind={kk} />}
        <span className="grid min-w-0 gap-0.5">
          <span className="min-w-0 text-[14px] font-medium break-words max-sm:line-clamp-2 sm:truncate">{f.title || f.name}</span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-muted">
            <span>{kindLabel(f.kind)}</span>
            {dept ? <span>· {dept}</span> : null}
            {f.pages ? <span>· {f.pages > 1 ? t("{n} pages", { n: f.pages }) : t("1 page")}</span> : null}
            <span>· {fileSize(f.size)}</span>
            {showFolder && f.folder ? <span className="inline-flex min-w-0 items-center gap-1">· <FolderSimpleIcon size={12} className="shrink-0" /><span className="truncate">{f.folder}</span></span> : null}
          </span>
          {f.title && f.title !== f.name ? <span className="truncate text-[12px] text-muted/80">{f.name}</span> : null}
          {fileOrigin(f as ProvFile) === "agent" ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-[12px]">
              <MadeBy origin="agent" agentName={(f as ProvFile).agent_name} agentColor={(f as ProvFile).agent_color} size="sm" />
              <WorkLinks taskId={f.task_id} taskTitle={(f as ProvFile).task_title} runId={(f as ProvFile).workflow_run_id} runTitle={(f as ProvFile).workflow_run_title} />
            </span>
          ) : null}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 max-sm:col-start-2">
          <ReviewPill status={(f as ProvFile).review_status} />
          <FileStatus f={f} />
          {f.status === "ready" && !f.expires_on && !f.quarantined ? <Pill tone="ok">{t("Ready")}</Pill> : null}
          {f.expires_on && !f.expired && f.status === "ready" ? <Pill>{t("Valid until {date}", { date: f.expires_on })}</Pill> : null}
          {f.library ? <Pill tone="accent">{t("In library")}</Pill> : null}
          {f.quarantined ? <Pill tone="warn"><ShieldWarningIcon size={12} weight="bold" /> {t("Held back")}</Pill> : null}
        </span>
      </button>
    </li>
  );
}

function FolderRow({ node, onPick }: { node: FolderNode; onPick: () => void }) {
  const t = useT();
  return (
    <li>
      <button type="button" onClick={onPick} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2.5 pr-4 pl-4 text-left transition-colors hover:bg-surface-2/70">
        <span className="grid size-10 place-items-center rounded-[var(--radius-sm)] bg-warn/12 text-warn ring-1 ring-warn/20 ring-inset"><FolderIcon size={20} weight="duotone" /></span>
        <span className="grid min-w-0">
          <span className="truncate text-[14px] font-medium">{node.name}</span>
          <span className="text-[12.5px] text-muted">{node.files === 1 ? t("1 file") : t("{n} files", { n: node.files.toLocaleString(locale()) })} · {fileSize(node.size)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          {node.flagged ? <Pill tone="warn"><ShieldWarningIcon size={12} weight="bold" /> {node.flagged}</Pill> : null}
          <CaretRightIcon size={14} className="text-muted" />
        </span>
      </button>
    </li>
  );
}

/** The open file in a side sheet, with who made it on top. The viewer renders as a pane
 * inside it; its own header is hidden because the sheet has one. */
function FileSheet({ id, onClose, children }: { id: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const { data } = useQuery(fileQuery(id));
  const f = data as ProvFile | undefined;
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="lg"
      title={f ? <span className="min-w-0 break-words">{f.title || f.name}</span> : t("File")}
      description={f ? [kindLabel(f.kind), fileSize(f.size)].filter(Boolean).join(" · ") : undefined}>
      <div className="grid min-w-0 gap-4">
        <FileProvenanceCard fileId={id} />
        <div className="min-w-0 [&>div>div:first-child]:hidden">{children}</div>
      </div>
    </SideSheet>
  );
}

// ---------------------------------------------------------------- the hub for one company

function CompanyHub({ branch }: { branch: Branch }) {
  const t = useT();
  const qc = useQueryClient();
  const search = useSearch({ from: "/app/files" });
  const navigate = useNavigate({ from: "/files" });
  const { data: me } = useQuery(meQuery);
  const canEdit = !!me && hasAny(me, "work.write");
  const canManage = !!me && hasAny(me, "org.manage", "vault.manage");
  const wide = useMedia("(min-width: 1280px)");

  const folder = search.folder ?? "";
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<KindKey | typeof ANY>(ANY);
  const [dept, setDept] = useState<string>(ANY);
  const [origin, setOrigin] = useState<OriginFilter>(search.origin ?? ANY);
  const [agent, setAgent] = useState<string>(ANY);
  const [view, setView] = useState<View>("folder");
  const [batch, setBatch] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Map<string, CompanyFile>>(new Map());
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = (patch: { f?: string | undefined; folder?: string | undefined }) =>
    navigate({ search: (s: { f?: string; folder?: string }) => ({ ...s, ...patch }), replace: "folder" in patch && !("f" in patch) });
  // On wide screens a file opened from the list shows in a pane beside it; one opened from an
  // upload report or a link (further up, or straight in) opens in the side sheet.
  const [inPane, setInPane] = useState(false);
  const openFile = (id?: string, fromList = false) => {
    setInPane(fromList);
    go({ f: id });
  };
  const pickFolder = (p: string) => {
    go({ folder: p || undefined });
    setFoldersOpen(false);
  };

  // Folders.
  const { data: tree } = useQuery(fileTreeQuery(branch.id));
  const root = useMemo(() => buildTree(tree?.folders ?? []), [tree]);
  const here = findNode(root, folder) ?? root;
  const folderPaths = useMemo(() => {
    const out: string[] = [];
    const walk = (n: FolderNode) => { if (n.path) out.push(n.path); n.children.forEach(walk); };
    walk(root);
    return out;
  }, [root]);

  // Uploads: the ones started here, then the company's earlier ones.
  const uploads = usePagedList<IntakeBatch>(intakeKeys.list(branch.id), "/api/intake", { branch_id: branch.id }, { pageSize: 5 });
  const uploadIds = useMemo(() => {
    const ids = [...recent];
    if (!(uploads.error && notThere(uploads.error))) for (const b of uploads.items) if (!ids.includes(b.id)) ids.push(b.id);
    return ids.filter((id) => !hidden.has(id)).slice(0, 3);
  }, [recent, uploads.items, uploads.error, hidden]);

  // The newest finished upload shows its report; older ones start folded.
  const newestReady = uploads.items.find((b) => b.status === "ready")?.id;

  // Files.
  const needle = useDebounced(q.trim());
  const filtering = !!needle || kind !== ANY || dept !== ANY || !!batch || origin !== ANY || agent !== ANY;
  const { data: stats } = useQuery(fileStatsQuery({ branch_id: branch.id }));
  const { data: allAgents = [] } = useQuery(agentsQuery);
  const agents = allAgents.filter((a) => a.branch_id === branch.id && !a.clone_of);
  const recursive = view !== "folder" || filtering;
  const list = usePagedList<CompanyFile>(docKeys.files, "/api/files", {
    branch_id: branch.id,
    // Folder view asks for one folder only ("/" = the top); other views search everything under it.
    folder: recursive ? folder || undefined : folder || "/",
    recursive: recursive ? true : undefined,
    q: needle || undefined,
    kind: kind === ANY ? undefined : kind,
    department_id: dept === ANY ? undefined : dept === NO_DEPT ? "none" : dept,
    batch_id: batch ?? undefined,
    origin: origin === ANY ? undefined : origin,
    agent_id: agent === ANY ? undefined : agent,
  }, { poll: (rows) => (rows.some((f) => f.status === "reading") ? 2500 : false) });
  // The server filters; this also keeps the list right on a server that ignores a filter.
  const files = list.items.filter((f) => {
    if (kind !== ANY && kindKey(f.kind) !== kind) return false;
    if (dept === NO_DEPT && f.department_id) return false;
    if (dept !== ANY && dept !== NO_DEPT && f.department_id !== dept) return false;
    if (!recursive && tree?.folders.length && (f.folder ?? "") !== folder) return false;
    if (batch && f.batch_id && f.batch_id !== batch) return false;
    if (origin !== ANY && fileOrigin(f as ProvFile) !== origin) return false;
    return true;
  });

  const groups = useMemo(() => {
    if (view === "folder") return null;
    const by = new Map<string, CompanyFile[]>();
    for (const f of files) {
      const key = view === "kind" ? kindKey(f.kind) : (f.department_id ?? "");
      by.set(key, [...(by.get(key) ?? []), f]);
    }
    const label = (k: string) => view === "kind" ? kindLabel(k) : k ? branch.departments.find((d) => d.id === k)?.name ?? t("Other department") : t("No department");
    const order = view === "kind" ? KINDS.map((k) => k.key as string) : [...branch.departments.map((d) => d.id), ""];
    return [...by.entries()]
      .sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999))
      .map(([k, rows]) => ({ key: k, label: label(k), rows, kind: view === "kind" ? (k as KindKey) : null }));
  }, [files, view, branch.departments, t]);

  const showFilter = (s: ShowFilter) => {
    setBatch(s.batch);
    setKind((s.kind as KindKey | undefined) ?? ANY);
    setDept(s.department === undefined ? ANY : s.department || NO_DEPT);
    go({ folder: undefined });
    document.getElementById("company-files-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const clearFilters = () => { setQ(""); setKind(ANY); setDept(ANY); setBatch(null); setOrigin(ANY); setAgent(ANY); };

  const pick = (f: CompanyFile, on: boolean) => setPicked((m) => {
    const n = new Map(m);
    if (on) n.set(f.id, f);
    else n.delete(f.id);
    return n;
  });
  const allPicked = files.length > 0 && files.every((f) => picked.has(f.id));
  const pickAll = (on: boolean) => setPicked((m) => {
    const n = new Map(m);
    for (const f of files) {
      if (on) n.set(f.id, f);
      else n.delete(f.id);
    }
    return n;
  });
  const ids = [...picked.keys()];
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: docKeys.files });
    void qc.invalidateQueries({ queryKey: libraryKeys.all });
    void qc.invalidateQueries({ queryKey: intakeKeys.all });
  };

  const addToLibrary = async () => {
    setBusy(true);
    let ok = 0;
    let held = 0;
    for (const f of picked.values()) {
      if (f.quarantined) { held += 1; continue; }
      try {
        await setLibrary(f.id, true, { branch_id: f.branch_id ?? branch.id, department_id: f.department_id ?? null });
        ok += 1;
      } catch (e) {
        toast.error(`${f.name}: ${errorMessage(e)}`);
      }
    }
    setBusy(false);
    refresh();
    if (ok) toast.success(ok === 1 ? tr("1 file added to the library.") : tr("{n} files added to the library.", { n: ok }));
    if (held) toast(held === 1 ? tr("1 held-back file was left out.") : tr("{n} held-back files were left out.", { n: held }));
  };

  const removeAll = async () => {
    let ok = 0;
    for (const id of ids) {
      try { await deleteFile(id); ok += 1; } catch (e) { toast.error(errorMessage(e)); }
    }
    setPicked(new Map());
    refresh();
    if (ok) toast.success(ok === 1 ? tr("File deleted.") : tr("{n} files deleted.", { n: ok }));
    if (search.f && ids.includes(search.f)) openFile(undefined);
  };

  const paneOpen = wide && inPane && !!search.f;
  // P25: who made the file shows above the viewer, in the pane and in the sheet alike.
  const viewer = search.f ? (
    paneOpen ? (
      <div className="grid gap-3">
        <FileProvenanceCard fileId={search.f} />
        <FileViewer id={search.f} branch={branch} folders={folderPaths} canManage={canManage} canEdit={canEdit}
          onClose={() => openFile(undefined)} inline />
      </div>
    ) : (
      <FileSheet id={search.f} onClose={() => openFile(undefined)}>
        <FileViewer id={search.f} branch={branch} folders={folderPaths} canManage={canManage} canEdit={canEdit}
          onClose={() => openFile(undefined)} inline />
      </FileSheet>
    )
  ) : null;

  const subfolders = view === "folder" && !filtering ? here.children : [];
  const folderTotal = folder ? here.files : tree?.total_files || list.total || files.length;

  return (
    <>
      {canEdit ? <IntakeDrop branch={branch} onBatch={(id) => setRecent((r) => [id, ...r.filter((x) => x !== id)])} /> : null}

      {uploadIds.length ? (
        <section className="grid gap-3" aria-label={t("Uploads")}>
          {uploadIds.map((id, i) => (
            <BatchCard key={id} batchId={id} branch={branch} onOpenFile={(fid) => openFile(fid)} onShow={showFilter}
              defaultOpen={recent.includes(id) || id === newestReady}
              guide={i === 0 ? "files.report" : undefined}
              onDismiss={() => setHidden((h) => new Set([...h, id]))} />
          ))}
        </section>
      ) : null}

      <section id="company-files-list" className="grid scroll-mt-20 gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{t("Browse")}</h2>
            <p className="text-[13px] text-muted">
              {tree?.total_files ? t("{n} files · {size}", { n: tree.total_files.toLocaleString(locale()), size: fileSize(tree.total_size) }) : t("Every file this company has, in its folders.")}
            </p>
          </div>
          <Segmented<View> label={t("Group")} value={view} onChange={setView} size="sm" guide="files.view"
            options={[
              { value: "folder", label: t("By folder") },
              { value: "kind", label: t("By kind") },
              { value: "department", label: t("By department") },
            ]} />
        </div>

        <div data-guide="files.filters" className="grid gap-2">
          <Toolbar>
            <SearchInput value={q} onChange={setQ} placeholder={t("Search names, titles and kinds")} />
            <Select value={dept} onValueChange={setDept} label={t("Department")} className="sm:w-56"
              options={[{ value: ANY, label: t("Every department") }, ...branch.departments.map((d) => ({ value: d.id, label: d.name })), { value: NO_DEPT, label: t("No department") }]} />
          </Toolbar>
          <div data-guide="files.origin" className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented<OriginFilter> label={t("Made by")} value={origin} size="sm"
              onChange={(v) => { setOrigin(v); if (v !== "agent" && v !== ANY) setAgent(ANY); }}
              options={[
                { value: ANY, label: t("All"), ...(stats ? { count: stats.total } : {}) },
                { value: "agent", label: t("Made by AI"), ...(stats?.agent !== undefined ? { count: stats.agent } : {}) },
                { value: "uploaded", label: t("Uploaded"), ...(stats?.uploaded !== undefined ? { count: stats.uploaded } : {}) },
                { value: "person", label: t("Made by people"), ...(stats?.person !== undefined ? { count: stats.person } : {}) },
              ]} />
            {agents.length ? (
              <Select value={agent} label={t("Agent")} className="sm:w-52"
                onValueChange={(v) => { setAgent(v); if (v !== ANY) setOrigin("agent"); }}
                options={[{ value: ANY, label: t("Any agent") }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
            ) : null}
          </div>
          <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap" role="group" aria-label={t("Kind")}>
              {[{ key: ANY, label: t("All kinds") }, ...KINDS.map((k) => ({ key: k.key, label: k.key === "sop" ? "SOP" : t(k.label) }))].map((k) => {
                const on = kind === k.key;
                return (
                  <button key={k.key} type="button" aria-pressed={on} onClick={() => setKind(k.key as KindKey | typeof ANY)}
                    className={cn("inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[12.5px] font-medium whitespace-nowrap transition-colors pointer-coarse:h-9",
                      on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg")}>
                    {on && k.key !== ANY ? <CheckIcon size={12} weight="bold" /> : null}{k.label}
                  </button>
                );
              })}
            </div>
          </div>
          {batch || filtering ? (
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              {batch ? <Pill tone="info">{t("From one upload")}</Pill> : null}
              <Button size="sm" variant="ghost" onClick={clearFilters}><XIcon size={13} /> {t("Clear filters")}</Button>
            </div>
          ) : null}
        </div>

        {/* Desktop: folders | files; with a file open beside the list: files | file (the
            breadcrumb and the Folders button still move between folders). */}
        <div className={cn("grid gap-4", paneOpen ? "grid-cols-[minmax(0,1fr)_minmax(0,34rem)]" : "lg:grid-cols-[16rem_minmax(0,1fr)]")}>
          <Card className={cn("hidden max-h-[calc(100dvh-8rem)] self-start overflow-y-auto p-2 lg:sticky lg:top-4", !paneOpen && "lg:block")}>
            <FolderTree root={root} current={folder} onPick={pickFolder} total={tree?.total_files || list.total || files.length} />
          </Card>

          <div className="grid min-w-0 content-start gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 py-2">
              <div className="flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-auto">
                <Button size="sm" variant="outline" className={cn(!paneOpen && "lg:hidden")} onClick={() => setFoldersOpen(true)}><TreeStructureIcon size={14} /> {t("Folders")}</Button>
                <Crumbs folder={folder} onPick={pickFolder} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-[12.5px] whitespace-nowrap text-muted">
                  <input type="checkbox" checked={allPicked} onChange={(e) => pickAll(e.target.checked)} disabled={!files.length} className="size-4 accent-[var(--accent)]" />
                  {t("Select all")}
                </label>
                <Button size="sm" variant="ghost" asChild>
                  <a href={archiveUrl({ branch_id: branch.id, folder: folder || null })} download data-guide="files.download-folder">
                    <DownloadSimpleIcon size={14} /> {folder ? t("Download folder") : t("Download all")}
                  </a>
                </Button>
              </div>
            </div>

            {list.isLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
              : list.error ? <p role="alert" className="text-danger">{errorMessage(list.error)}</p>
              : !files.length && !subfolders.length ? (
                <EmptyState icon={FolderOpenIcon}
                  title={filtering ? t("No files match") : folder ? t("This folder is empty") : t("No files yet")}
                  body={filtering ? t("Try another kind or department, or clear the filters.") : t("Drop the company's SOPs, guides, forms, certificates and contracts above. A whole zip is fine.")}
                  action={filtering ? <Button size="sm" variant="outline" onClick={clearFilters}>{t("Clear filters")}</Button> : undefined} />
              ) : (
                <ul data-guide="files.list" className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
                  {subfolders.map((n) => <FolderRow key={n.path} node={n} onPick={() => pickFolder(n.path)} />)}
                  {groups
                    ? groups.flatMap((g) => [
                      <li key={`h:${g.key}`} className="flex items-center gap-2 bg-surface-2/50 px-4 py-2 text-[12.5px] font-semibold">
                        {g.kind ? <KindTile kind={g.kind} size="sm" /> : <BuildingsIcon size={15} className="text-muted" />}
                        <span className="min-w-0 flex-1 truncate">{g.label}</span>
                        <span className="font-normal text-muted tabular">{g.rows.length}</span>
                      </li>,
                      ...g.rows.map((f) => (
                        <FileRow key={f.id} f={f} branch={branch} picked={picked.has(f.id)} onPick={(on) => pick(f, on)} onOpen={() => openFile(f.id, true)}
                          active={search.f === f.id} showFolder />
                      )),
                    ])
                    : files.map((f) => (
                      <FileRow key={f.id} f={f} branch={branch} picked={picked.has(f.id)} onPick={(on) => pick(f, on)} onOpen={() => openFile(f.id, true)}
                        active={search.f === f.id} showFolder={recursive} />
                    ))}
                </ul>
              )}
            {files.length ? <LoadMore noun="files" shown={files.length} total={list.total ?? (folder ? folderTotal : null)} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} /> : null}
          </div>

          {paneOpen ? (
            <Card id="company-files-viewer" className="max-h-[calc(100dvh-2rem)] self-start overflow-y-auto p-4 xl:sticky xl:top-4">{viewer}</Card>
          ) : null}
        </div>
      </section>

      {picked.size ? (
        <div role="toolbar" aria-label={t("Selected files")} data-guide="files.selection"
          className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-surface/95 px-3 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur-md md:bottom-4">
          <span className="mr-1 text-[13px] font-semibold tabular">{t("{n} selected", { n: picked.size })}</span>
          <Button size="sm" variant="outline" asChild>
            <a href={archiveUrl({ ids })} download><DownloadSimpleIcon size={14} /> {t("Download zip")}</a>
          </Button>
          {canEdit ? <>
            <Button size="sm" variant="outline" onClick={() => setMoving(true)}><FolderOpenIcon size={14} /> {t("Move|file")}</Button>
            <Button size="sm" variant="outline" loading={busy} onClick={() => void addToLibrary()}><BooksIcon size={14} /> {t("Add to library")}</Button>
            <BuildFromDocs fileIds={ids} branchId={branch.id} />
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(true)}><TrashIcon size={14} /> {t("Delete")}</Button>
          </> : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPicked(new Map())}><XIcon size={14} /> {t("Clear")}</Button>
        </div>
      ) : null}

      {!(wide && inPane) && viewer}

      <SideSheet open={foldersOpen} onOpenChange={setFoldersOpen} title={t("Folders")} size="sm">
        <FolderTree root={root} current={folder} onPick={pickFolder} total={tree?.total_files || list.total || files.length} />
      </SideSheet>
      <MoveDialog open={moving} onOpenChange={setMoving} folders={folderPaths} current={folder} count={picked.size}
        onMove={async (to) => {
          try {
            await moveMany(ids, to);
            refresh();
            setPicked(new Map());
            toast.success(tr("Moved."));
          } catch (e) {
            toast.error(errorMessage(e));
            throw e;
          }
        }} />
      <ConfirmDialog open={removing} onOpenChange={setRemoving} danger confirmLabel={t("Delete")}
        title={picked.size === 1 ? t("Delete this file?") : t("Delete {n} files?", { n: picked.size })}
        body={t("Agents can no longer read them, and packs that use them will show them as missing.")} onConfirm={removeAll} />
    </>
  );
}

// ---------------------------------------------------------------- page

/** Under "All companies": pick the company whose documents to work on. */
function CompanyPicker({ branches, onPick }: { branches: Branch[]; onPick: (id: string) => void }) {
  const t = useT();
  const trees = useQueries({ queries: branches.map((b) => fileTreeQuery(b.id)) });
  return (
    <section className="grid gap-3" data-guide="files.pick-company">
      <div className="rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/40 px-4 py-3">
        <p className="text-[14px] font-semibold">{t("Pick a company first")}</p>
        <p className="text-[13px] text-muted">{t("Each company keeps its own documents. Choose the one you are uploading for or want to browse.")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map((b, i) => {
          const n = trees[i]?.data?.total_files ?? 0;
          return (
            <Card key={b.id} interactive className="p-0">
              <button type="button" onClick={() => onPick(b.id)} className="flex w-full items-center gap-3 px-4 py-4 text-left">
                <span className="grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] text-white" style={{ background: b.color || "var(--accent)" }}>
                  <BuildingsIcon size={20} weight="duotone" />
                </span>
                <span className="grid min-w-0 flex-1">
                  <span className="truncate text-[14px] font-semibold">{b.name}</span>
                  <span className="text-[12.5px] text-muted">{n ? (n === 1 ? t("1 file") : t("{n} files", { n: n.toLocaleString(locale()) })) : t("Open its documents")}</span>
                </span>
                <CaretRightIcon size={15} className="text-muted" />
              </button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

export function FilesPage() {
  const t = useT();
  const co = useCompanies();
  const branch = co.isAll ? null : co.selected;
  const options = [...(co.canAll ? [{ value: ALL_COMPANIES, label: t("All companies") }] : []), ...co.branches.map((b) => ({ value: b.id, label: b.name }))];

  return (
    <Page wide>
      <PageHeader title={t("Company files")}
        description={t("One place per company for all its documents. Drop a whole folder or zip: it is kept in its folders, read, sorted, and the how-to documents go to the library for agents.")}
        actions={branch ? (
          <Button variant="outline" asChild>
            <a href={archiveUrl({ branch_id: branch.id })} download data-guide="files.download-all"><DownloadSimpleIcon size={16} /> {t("Download everything")}</a>
          </Button>
        ) : null} />
      <DocSteps current="/files" />
      <div data-guide="files.company" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
        <BuildingsIcon size={20} weight="duotone" className="shrink-0 text-accent" />
        <span className="text-[13.5px] font-medium">{t("Company")}</span>
        <Select value={branch?.id ?? ALL_COMPANIES} onValueChange={co.select} label={t("Company")} className="min-w-0 flex-1 sm:max-w-xs"
          options={options} placeholder={t("Pick a company")} />
        {branch ? <span className="text-[12.5px] text-muted max-sm:w-full">{t("Uploads and downloads here are for {company} only.", { company: branch.name })}</span> : null}
      </div>
      {co.isLoading && !co.branches.length ? <Skeleton className="h-48" />
        : !co.branches.length ? (
          <EmptyState icon={BuildingsIcon} title={t("No companies yet")} body={t("Add a company in Organization first. Each company keeps its own documents.")} />
        ) : branch ? <CompanyHub key={branch.id} branch={branch} />
        : <CompanyPicker branches={co.branches} onPick={co.select} />}
    </Page>
  );
}


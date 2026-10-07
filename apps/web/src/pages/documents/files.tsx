/** The Library's Browse tab (/files): a folder directory of everything. Down the side, the
 * company's own folders as a tree, then ready-made folders: documents, SOPs, guidelines,
 * templates, and quick views of the file store (what waits for review, each task's files,
 * recent, made by AI, from websites, uploaded). In a company's folders: upload anything
 * (files, folders, zips) into the folder you are in, see each upload sorted with a report,
 * search, sort, list or grid, open and download any file, a folder or everything, and turn
 * procedures into SOPs and workflows. */
import {
  BooksIcon, BuildingsIcon, CaretRightIcon, CheckIcon, DownloadSimpleIcon, FolderIcon, FolderOpenIcon, FolderSimpleIcon,
  ShieldWarningIcon, TrashIcon, UploadSimpleIcon, XIcon,
} from "@phosphor-icons/react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { FileStatus } from "@/components/file-drop";
import { LoadMore } from "@/components/load-more";
import { FileProvenanceCard, MadeBy, ReviewPill, WorkLinks } from "@/components/provenance";
import { EmptyState, Page } from "@/components/page";
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
  archiveUrl, deleteFile, fileTreeQuery, intakeKeys, KINDS, kindKey, kindLabel, notThere,
  type CompanyFile, type FolderNode, type IntakeBatch, type KindKey,
} from "@/lib/intake";
import { libraryKeys, setLibrary } from "@/lib/library";
import { usePagedList, useDebounced } from "@/lib/paged";
import { type StoreView } from "@/lib/file-store";
import { fileOrigin, type FileOrigin, type FileProvenance } from "@/lib/provenance";
import { meQuery } from "@/lib/queries";
import { hasAny, type Branch } from "@/lib/types";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";

import { BuildFromDocs } from "@/components/doc-builders";
import { BrowseControls, sortRows, Tile, TileGrid, useBrowsePrefs } from "../library-hub/browse-bits";
import { DocumentsFolder, SopsFolder, TemplatesFolder } from "../library-hub/collections";
import { LibraryHeader } from "../library-hub/hub";
import { BrowseCrumbs, findNode, LibraryTree, QuickFolders, useFolderTree } from "../library-hub/tree";
import { VIEW_INFO } from "../library-hub/views";
import { BatchCard, IntakeDrop, type ShowFilter } from "./files-upload";
import { FileViewer, MoveDialog, moveMany } from "./files-viewer";
import { StoreFileSheet, StoreTile, StoreViewBody } from "./file-store";
import { FileTile, KindTile } from "./visuals";

type View = "folder" | "kind" | "department";
const ANY = "__any";
const NO_DEPT = "__none";
/** P25: who made it. */
type OriginFilter = FileOrigin | typeof ANY;
type ProvFile = CompanyFile & FileProvenance;

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
          {f.library ? <Pill tone="accent">{t("Guideline")}</Pill> : null}
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

function CompanyHub({ branch, uploadOpen }: { branch: Branch; uploadOpen: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const search = useSearch({ from: "/app/files" });
  const navigate = useNavigate({ from: "/files" });
  const { data: me } = useQuery(meQuery);
  const canEdit = !!me && hasAny(me, "work.write");
  const canManage = !!me && hasAny(me, "org.manage", "vault.manage");
  // A file opened from the list shows beside it only when there is room next to the folders.
  const wide = useMedia("(min-width: 1440px)");
  const prefs = useBrowsePrefs();

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
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  const go = (patch: { f?: string | undefined; folder?: string | undefined }) =>
    navigate({ search: (s: { f?: string; folder?: string }) => ({ ...s, ...patch }) });
  // On wide screens a file opened from the list shows in a pane beside it; one opened from an
  // upload report or a link (further up, or straight in) opens in the side sheet.
  const [inPane, setInPane] = useState(false);
  const openFile = (id?: string, fromList = false) => {
    setInPane(fromList);
    go({ f: id });
  };
  const pickFolder = (p: string) => go({ folder: p || undefined, f: undefined });

  // Folders.
  const { tree, root } = useFolderTree(branch.id);
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
  const shown = list.items.filter((f) => {
    if (kind !== ANY && kindKey(f.kind) !== kind) return false;
    if (dept === NO_DEPT && f.department_id) return false;
    if (dept !== ANY && dept !== NO_DEPT && f.department_id !== dept) return false;
    if (!recursive && tree?.folders.length && (f.folder ?? "") !== folder) return false;
    if (batch && f.batch_id && f.batch_id !== batch) return false;
    if (origin !== ANY && fileOrigin(f as ProvFile) !== origin) return false;
    return true;
  });
  const files = useMemo(() => sortRows(shown, prefs.sort, (f) => f.title || f.name, (f) => f.created_at), [shown, prefs.sort]);

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
    if (ok) toast.success(ok === 1 ? tr("1 file added to the guidelines.") : tr("{n} files added to the guidelines.", { n: ok }));
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
  // A company with no files yet starts with the upload area open.
  const showUpload = canEdit && (uploadOpen || (!!tree && !tree.total_files));
  const grid = prefs.layout === "grid" && !groups;

  return (
    <>
      {showUpload ? <IntakeDrop branch={branch} folder={folder} onBatch={(id) => setRecent((r) => [id, ...r.filter((x) => x !== id)])} /> : null}

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
        <div data-guide="files.filters" className="grid gap-2">
          <Toolbar>
            <SearchInput value={q} onChange={setQ} placeholder={folder ? t("Search this folder") : t("Search names, titles and kinds")} className="sm:max-w-80" />
            <Select value={dept} onValueChange={setDept} label={t("Department")} className="sm:w-52"
              options={[{ value: ANY, label: t("Every department") }, ...branch.departments.map((d) => ({ value: d.id, label: d.name })), { value: NO_DEPT, label: t("No department") }]} />
            <BrowseControls prefs={prefs} grid={view === "folder"} />
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

        {/* With a file open beside the list (wide screens): files | file. */}
        <div className={cn("grid gap-4", paneOpen && "grid-cols-[minmax(0,1fr)_minmax(0,34rem)]")}>
          <div className="grid min-w-0 content-start gap-3">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-1">
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <Segmented<View> label={t("Group")} value={view} onChange={setView} size="sm" guide="files.view"
                  options={[
                    { value: "folder", label: t("By folder") },
                    { value: "kind", label: t("By kind") },
                    { value: "department", label: t("By department") },
                  ]} />
                {folderTotal ? (
                  <span className="text-[12.5px] text-muted">
                    {t("{n} files · {size}", { n: folderTotal.toLocaleString(locale()), size: fileSize(folder ? here.size : tree?.total_size ?? 0) })}
                  </span>
                ) : null}
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
              ) : grid ? (
                <TileGrid data-guide="files.list">
                  {subfolders.map((n) => (
                    <Tile key={n.path} onClick={() => pickFolder(n.path)} title={n.name}
                      leading={<span className="grid size-12 place-items-center rounded-[var(--radius-sm)] bg-warn/12 text-warn ring-1 ring-warn/20 ring-inset"><FolderIcon size={24} weight="duotone" /></span>}
                      meta={`${n.files === 1 ? t("1 file") : t("{n} files", { n: n.files.toLocaleString(locale()) })} · ${fileSize(n.size)}`}
                      badge={n.flagged ? <Pill tone="warn"><ShieldWarningIcon size={12} weight="bold" /> {n.flagged}</Pill> : undefined} />
                  ))}
                  {files.map((f) => (
                    <StoreTile key={f.id} f={f as ProvFile} onOpen={() => openFile(f.id, true)} active={search.f === f.id}
                      corner={<input type="checkbox" checked={picked.has(f.id)} onChange={(e) => pick(f, e.target.checked)}
                        className="size-4 accent-[var(--accent)] pointer-coarse:size-5" aria-label={t("Select {name}", { name: f.title || f.name })} />} />
                  ))}
                </TileGrid>
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
            <Button size="sm" variant="outline" loading={busy} onClick={() => void addToLibrary()}><BooksIcon size={14} /> {t("Add to guidelines")}</Button>
            <BuildFromDocs fileIds={ids} branchId={branch.id} />
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setRemoving(true)}><TrashIcon size={14} /> {t("Delete")}</Button>
          </> : null}
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPicked(new Map())}><XIcon size={14} /> {t("Clear")}</Button>
        </div>
      ) : null}

      {!(wide && inPane) && viewer}

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
  const search = useSearch({ from: "/app/files" });
  const navigate = useNavigate({ from: "/files" });
  const { data: me } = useQuery(meQuery);
  const canEdit = !!me && hasAny(me, "work.write");
  const branch = co.isAll ? null : co.selected;
  const options = [...(co.canAll ? [{ value: ALL_COMPANIES, label: t("All companies") }] : []), ...co.branches.map((b) => ({ value: b.id, label: b.name }))];
  // The company's folders unless a link asks for another folder of the Library (a task's
  // files, what waits for review...).
  const view: StoreView = search.view ?? (search.task ? "tasks" : "folders");
  const folder = view === "folders" ? (search.folder ?? "") : "";
  const [treeOpen, setTreeOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const pick = (v: StoreView) => {
    setTreeOpen(false);
    void navigate({ search: (s) => ({ ...s, view: v === "folders" ? undefined : v, task: undefined, folder: undefined, origin: undefined, f: undefined, page: undefined }) });
  };
  const pickFolder = (p: string) => {
    setTreeOpen(false);
    void navigate({ search: (s) => ({ ...s, view: undefined, task: undefined, folder: p || undefined, f: undefined, page: undefined }) });
  };
  const pickCompany = (id: string) => {
    co.select(id);
    pickFolder("");
  };
  const open = (id?: string) => navigate({ search: (s) => ({ ...s, f: id, page: undefined }) });
  const startUpload = () => {
    if (view !== "folders") pickFolder("");
    setUploadOpen((o) => (view === "folders" ? !o : true));
  };

  const tree = (
    <LibraryTree view={view} folder={folder} branch={branch} branches={co.branches} onView={pick} onFolder={pickFolder} onCompany={pickCompany} />
  );
  // One company's folders show in the hub, which opens its own files; elsewhere a file opens
  // in the side sheet.
  const hub = view === "folders" && !!branch;

  let body: ReactNode;
  if (view === "folders") body = branch ? <CompanyHub key={branch.id} branch={branch} uploadOpen={uploadOpen} /> : <CompanyPicker branches={co.branches} onPick={pickCompany} />;
  else if (view === "documents") body = <DocumentsFolder branch={branch} />;
  else if (view === "sops") body = <SopsFolder branch={branch} />;
  else if (view === "templates") body = <TemplatesFolder branch={branch} />;
  else body = <StoreViewBody view={view} branchId={branch?.id ?? null} taskId={search.task} onOpen={open} openId={search.f} />;

  return (
    <Page wide>
      <LibraryHeader tab="/files"
        actions={<>
          {canEdit ? (
            <Button variant={uploadOpen && view === "folders" ? "secondary" : "outline"} aria-pressed={uploadOpen && view === "folders"} onClick={startUpload}>
              <UploadSimpleIcon size={16} /> {t("Upload files")}
            </Button>
          ) : null}
          {branch ? (
            <Button variant="ghost" asChild>
              <a href={archiveUrl({ branch_id: branch.id })} download data-guide="files.download-all"><DownloadSimpleIcon size={16} /> {t("Download everything")}</a>
            </Button>
          ) : null}
        </>} />
      {co.branches.length > 1 ? (
        <div data-guide="files.company" className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3">
          <BuildingsIcon size={20} weight="duotone" className="shrink-0 text-accent" />
          <span className="text-[13.5px] font-medium">{t("Company")}</span>
          <Select value={branch?.id ?? ALL_COMPANIES} onValueChange={co.select} label={t("Company")} className="min-w-0 flex-1 sm:max-w-xs"
            options={options} placeholder={t("Pick a company")} />
          <span className="text-[12.5px] text-muted max-sm:w-full">
            {branch ? t("Showing {company} only.", { company: branch.name }) : t("Showing every company you work in.")}
          </span>
        </div>
      ) : null}
      {co.isLoading && !co.branches.length ? <Skeleton className="h-48" />
        : !co.branches.length ? (
          <EmptyState icon={BuildingsIcon} title={t("No companies yet")} body={t("Add a company in Organization first. Each company keeps its own documents.")} />
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
            <Card className="hidden max-h-[calc(100dvh-2rem)] min-w-0 self-start overflow-y-auto p-2 lg:sticky lg:top-4 lg:block">{tree}</Card>
            <div className="grid min-w-0 content-start gap-4">
              <BrowseCrumbs view={view} folder={folder} branch={branch} onRoot={() => pickFolder("")} onFolder={pickFolder} onOpenTree={() => setTreeOpen(true)} />
              {view !== "folders" ? <p className="-mt-1 px-1 text-[13px] text-muted">{t(VIEW_INFO[view].hint)}</p> : null}
              {/* Phones: the root of the Library lists its ready-made folders to tap into. */}
              {view === "folders" && !folder ? <QuickFolders branch={branch} onView={pick} className="lg:hidden" /> : null}
              {body}
            </div>
          </div>
        )}
      <SideSheet open={treeOpen} onOpenChange={setTreeOpen} title={t("Folders")} size="sm">{tree}</SideSheet>
      {!hub && search.f ? <StoreFileSheet id={search.f} onClose={() => open(undefined)} /> : null}
    </Page>
  );
}

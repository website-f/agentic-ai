/** The file store's lists on the Library's Browse tab: what waits for review, each piece of
 * work with everything it made, downloaded or was given, the newest files, what AI made, what
 * agents fetched from websites, uploads, and the guidelines. Any file opens in the same viewer
 * from any list. */
import { ArrowRightIcon, DownloadSimpleIcon, FolderOpenIcon, GlobeIcon, ListChecksIcon, SealCheckIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { FileStatus } from "@/components/file-drop";
import { LoadMore } from "@/components/load-more";
import { EmptyState } from "@/components/page";
import { FileProvenanceCard, MadeBy, ReviewPill, WorkLinks } from "@/components/provenance";
import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import { Card, ListCard, ListRow, Meta, Toolbar } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import type { FileView } from "@/lib/file-store";
import { docKeys, fileQuery, fileSize, fileUrl, siteOf } from "@/lib/documents";
import { kindKey, kindLabel, type CompanyFile } from "@/lib/intake";
import { useDebounced, usePagedList } from "@/lib/paged";
import { fileOrigin, provKeys, type FileProvenance, type ReviewedDoc } from "@/lib/provenance";
import { meQuery } from "@/lib/queries";
import { hasAny } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

import { BrowseControls, sortRows, Tile, TileGrid, useBrowsePrefs } from "../library-hub/browse-bits";
import { VIEW_INFO } from "../library-hub/views";
import { QueueRow } from "./documents";
import { FileViewer } from "./files-viewer";
import { FileTile, KindTile } from "./visuals";


type StoreFile = CompanyFile & FileProvenance;

// ---------------------------------------------------------------- one file


/** Where a file came from, in a few words: an agent made it, fetched it, or a person added it. */
function FromWhere({ f }: { f: StoreFile }) {
  const t = useT();
  if (f.source === "download") {
    const host = siteOf(f.source_path);
    return (
      <Pill tone="info" className="max-w-full min-w-0 px-2" title={f.source_path || undefined}>
        <GlobeIcon size={12} weight="bold" />
        <span className="truncate">{host ? t("Downloaded from {site}", { site: host }) : t("Downloaded from a website")}</span>
      </Pill>
    );
  }
  return <MadeBy origin={fileOrigin(f)} agentName={f.agent_name} agentColor={f.agent_color} size="sm" />;
}

export function StoreRow({ f, onOpen, showCompany, showTask = true, active }: {
  f: StoreFile;
  onOpen: () => void;
  showCompany?: boolean;
  showTask?: boolean;
  active?: boolean;
}) {
  const t = useT();
  const kk = kindKey(f.kind);
  return (
    <ListRow onClick={onOpen} active={active}
      leading={kk === "other" ? <FileTile mime={f.mime} name={f.name} /> : <KindTile kind={kk} />}
      title={f.title || f.name}
      meta={<Meta items={[
        kindLabel(f.kind),
        f.pages ? (f.pages > 1 ? t("{n} pages", { n: f.pages }) : t("1 page")) : null,
        fileSize(f.size),
        showCompany ? f.branch_name : null,
        timeAgo(f.created_at),
      ]} />}
      trailing={<>
        <ReviewPill status={f.review_status} />
        <FileStatus f={f} />
        {f.library ? <Pill tone="accent">{t("Guideline")}</Pill> : null}
        <a href={fileUrl(f.id)} download onClick={(e) => e.stopPropagation()} aria-label={t("Download {name}", { name: f.name })}
          className="grid size-8 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-10">
          <DownloadSimpleIcon size={16} />
        </a>
      </>}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 text-[12px]">
        <FromWhere f={f} />
        {showTask ? <WorkLinks taskId={f.task_id} taskTitle={f.task_title} runId={f.workflow_run_id} runTitle={f.workflow_run_title} /> : null}
        {f.folder ? <span className="inline-flex min-w-0 items-center gap-1 text-muted"><FolderOpenIcon size={12} className="shrink-0" /><span className="truncate">{f.folder}</span></span> : null}
      </span>
    </ListRow>
  );
}

/** Any file, opened from any view, in a side sheet: who made it, then the file itself. */
export function StoreFileSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const co = useCompanies();
  const { data: me } = useQuery(meQuery);
  const { data } = useQuery(fileQuery(id));
  const f = data as StoreFile | undefined;
  const branch = co.branches.find((b) => b.id === f?.branch_id) ?? null;
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="lg"
      title={f ? <span className="min-w-0 break-words">{f.title || f.name}</span> : t("File")}
      description={f ? [kindLabel(f.kind), fileSize(f.size), f.branch_name].filter(Boolean).join(" · ") : undefined}>
      <div className="grid min-w-0 gap-4">
        <FileProvenanceCard fileId={id} />
        <div className="min-w-0 [&>div>div:first-child]:hidden">
          <FileViewer id={id} branch={branch} folders={[]} onClose={onClose} inline
            canEdit={!!me && hasAny(me, "work.write")} canManage={!!me && hasAny(me, "org.manage", "vault.manage")} />
        </div>
      </div>
    </SideSheet>
  );
}

// ---------------------------------------------------------------- flat views

const FLAT: Partial<Record<FileView, Record<string, string>>> = {
  recent: {},
  agents: { origin: "agent" },
  downloads: { source: "download" },
  uploaded: { source: "upload" },
  library: { library: "true" },
};

/** A file as a tile in the grid. */
export function StoreTile({ f, onOpen, active, corner }: { f: StoreFile; onOpen: () => void; active?: boolean; corner?: ReactNode }) {
  const t = useT();
  const kk = kindKey(f.kind);
  return (
    <Tile onClick={onOpen} active={active} corner={corner}
      leading={kk === "other" ? <FileTile mime={f.mime} name={f.name} size="lg" /> : <KindTile kind={kk} size="lg" />}
      title={f.title || f.name}
      meta={[kindLabel(f.kind), fileSize(f.size), timeAgo(f.created_at)].filter(Boolean).join(" · ")}
      badge={(f.review_status === "waiting" || f.library || f.status !== "ready") ? <>
        <ReviewPill status={f.review_status} />
        <FileStatus f={f} />
        {f.library ? <Pill tone="accent">{t("Guideline")}</Pill> : null}
      </> : undefined} />
  );
}

function FlatView({ view, branchId, onOpen, openId }: { view: FileView; branchId: string | null; onOpen: (id: string) => void; openId?: string }) {
  const t = useT();
  const prefs = useBrowsePrefs();
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim());
  const list = usePagedList<StoreFile>(docKeys.files, "/api/files", {
    ...FLAT[view],
    branch_id: branchId ?? undefined,
    q: needle || undefined,
  }, { pageSize: 50, poll: (rows) => (rows.some((f) => f.status === "reading") ? 2500 : false) });
  const files = useMemo(() => sortRows(list.items, prefs.sort, (f) => f.title || f.name, (f) => f.created_at), [list.items, prefs.sort]);
  const V = VIEW_INFO[view];
  return (
    <div className="grid min-w-0 content-start gap-3">
      <Toolbar>
        <SearchInput value={q} onChange={setQ} placeholder={t("Search names, titles and kinds")} className="sm:max-w-80" />
        <BrowseControls prefs={prefs} />
        <div className="flex flex-wrap gap-1 sm:ml-auto">
          {view === "library" ? (
            <Button size="sm" variant="ghost" asChild>
              <Link to="/library">{t("Open the Guidelines tab")} <ArrowRightIcon size={13} /></Link>
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" asChild>
            <Link to="/search" search={needle ? { q: needle } : {}}>{t("Search inside documents")} <ArrowRightIcon size={13} /></Link>
          </Button>
        </div>
      </Toolbar>
      {list.isLoading ? <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px]" />)}</div>
        : list.error ? <p role="alert" className="text-danger">{errorMessage(list.error)}</p>
        : !files.length ? (
          <EmptyState icon={V.icon} title={needle ? t("No files match") : t("Nothing here yet")} body={t(V.hint)} />
        ) : prefs.layout === "grid" ? (
          <TileGrid>{files.map((f) => <StoreTile key={f.id} f={f} onOpen={() => onOpen(f.id)} active={openId === f.id} />)}</TileGrid>
        ) : (
          <ListCard>
            {files.map((f) => <StoreRow key={f.id} f={f} onOpen={() => onOpen(f.id)} showCompany={!branchId} active={openId === f.id} />)}
          </ListCard>
        )}
      {files.length ? <LoadMore noun="files" shown={files.length} total={list.total} hasMore={list.hasMore} loading={list.isFetchingMore} onLoad={list.loadMore} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- by task

interface TaskFiles {
  task_id: string;
  title: string;
  status: string;
  agent_name: string | null;
  agent_color: string | null;
  branch_id: string | null;
  branch_name: string | null;
  latest: string;
  count: number;
  files: StoreFile[];
}

type Bucket = "review" | "made" | "downloaded" | "given";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "review", label: msg("Waiting for your review") },
  { key: "made", label: msg("Made by AI") },
  { key: "downloaded", label: msg("Downloaded from websites") },
  { key: "given", label: msg("Given by people") },
];

function bucketOf(f: StoreFile): Bucket {
  if (f.review_status === "waiting") return "review";
  if (f.source === "download") return "downloaded";
  if (fileOrigin(f) === "agent") return "made";
  return "given";
}

const STATUS_TONE: Record<string, "neutral" | "info" | "ok" | "warn" | "danger"> = {
  done: "ok", review: "info", running: "info", ready: "neutral", blocked: "warn", failed: "danger", cancelled: "neutral", triage: "neutral",
};
const STATUS_LABEL: Record<string, string> = {
  done: msg("Done"), review: msg("In review"), running: msg("Working"), ready: msg("Queued"), blocked: msg("Waiting for you"), failed: msg("Failed"), cancelled: msg("Cancelled"), triage: msg("Triage"),
};

function TaskCard({ g, onOpen, openId, full, showCompany }: { g: TaskFiles; onOpen: (id: string) => void; openId?: string; full: boolean; showCompany: boolean }) {
  const t = useT();
  const navigate = useNavigate({ from: "/files" });
  const by = new Map<Bucket, StoreFile[]>();
  for (const f of g.files) by.set(bucketOf(f), [...(by.get(bucketOf(f)) ?? []), f]);
  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        {g.agent_name ? <AgentAvatar name={g.agent_name} color={g.agent_color ?? "var(--accent)"} size="sm" /> : <ListChecksIcon size={22} weight="duotone" className="text-muted" />}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Link to="/tasks" search={{ task: g.task_id }} className="min-w-0 text-[14.5px] font-semibold break-words hover:text-accent">
            {g.title || t("Open the task")}
          </Link>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-muted">
            <Meta items={[
              g.agent_name,
              showCompany ? g.branch_name : null,
              g.count === 1 ? t("1 file") : t("{n} files", { n: g.count }),
              t("latest {when}", { when: timeAgo(g.latest) }),
            ]} />
          </span>
        </div>
        {g.status ? <Pill tone={STATUS_TONE[g.status] ?? "neutral"}>{t(STATUS_LABEL[g.status] ?? g.status)}</Pill> : null}
      </div>
      {BUCKETS.filter((b) => by.get(b.key)?.length).map((b) => (
        <section key={b.key} aria-label={t(b.label)}>
          <h3 className={cn("bg-surface-2/50 px-4 py-1.5 text-[12px] font-semibold", b.key === "review" ? "text-accent" : "text-muted")}>
            {t(b.label)} <span className="font-normal tabular">{by.get(b.key)?.length}</span>
          </h3>
          <ListCard className="rounded-none border-0 border-b">
            {by.get(b.key)?.map((f) => <StoreRow key={f.id} f={f} onOpen={() => onOpen(f.id)} showTask={false} active={openId === f.id} />)}
          </ListCard>
        </section>
      ))}
      {!full && g.count > g.files.length ? (
        <div className="px-4 py-2.5">
          <Button size="sm" variant="ghost" onClick={() => navigate({ search: (s) => ({ ...s, view: "tasks", task: g.task_id }) })}>
            {t("Show all {n} files", { n: g.count })} <ArrowRightIcon size={13} />
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function TasksView({ branchId, taskId, onOpen, openId }: { branchId: string | null; taskId?: string; onOpen: (id: string) => void; openId?: string }) {
  const t = useT();
  const navigate = useNavigate({ from: "/files" });
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim());
  const params = new URLSearchParams();
  if (branchId) params.set("branch_id", branchId);
  if (taskId) params.set("task_id", taskId);
  if (needle) params.set("q", needle);
  params.set("limit", "15");
  const groups = useQuery({
    queryKey: [...docKeys.files, "by-task", params.toString()],
    queryFn: () => api<TaskFiles[]>(`/api/files/by-task?${params}`),
    refetchInterval: (q) => (q.state.data?.some((g) => g.files.some((f) => f.status === "reading")) ? 2500 : false),
  });
  return (
    <div className="grid min-w-0 content-start gap-3">
      {taskId ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate({ search: (s) => ({ ...s, task: undefined }) })}>{t("All tasks")}</Button>
          <span className="text-[13px] text-muted">{t("Every file of this task and its helpers.")}</span>
        </div>
      ) : (
        <Toolbar>
          <SearchInput value={q} onChange={setQ} placeholder={t("Find a file in any task")} />
        </Toolbar>
      )}
      {groups.isLoading ? <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
        : groups.error ? <p role="alert" className="text-danger">{errorMessage(groups.error)}</p>
        : !groups.data?.length ? (
          <EmptyState icon={ListChecksIcon} title={needle ? t("No files match") : t("No work with files yet")}
            body={t("When an agent makes, downloads or is given a file for a task, the task shows here with all of them together.")} />
        ) : groups.data.map((g) => <TaskCard key={g.task_id} g={g} onOpen={onOpen} openId={openId} full={!!taskId} showCompany={!branchId} />)}
    </div>
  );
}

// ---------------------------------------------------------------- needs review

function ReviewView({ branchId }: { branchId: string | null }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: me } = useQuery(meQuery);
  const queue = usePagedList<ReviewedDoc>(provKeys.queue, "/api/documents/review-queue", { branch_id: branchId ?? undefined }, { pageSize: 30 });
  return (
    <div className="grid min-w-0 content-start gap-3">
      {queue.isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px]" />)}</div>
        : queue.error ? <p role="alert" className="text-danger">{errorMessage(queue.error)}</p>
        : !queue.items.length ? (
          <EmptyState icon={SealCheckIcon} title={t("Nothing waits for your review")}
            body={t("Documents agents write (proposals, letters, reports) come here first. Approve them, or send them back with a note and the agent revises.")} />
        ) : (
          <ListCard>
            {queue.items.map((d) => (
              <QueueRow key={d.id} d={d} canApprove={!!me && hasAny(me, "approvals.decide")} canWrite={!!me && hasAny(me, "work.write")}
                onOpen={() => void navigate({ to: "/documents", search: { d: d.id } })} />
            ))}
          </ListCard>
        )}
      {queue.items.length ? <LoadMore noun="documents" shown={queue.items.length} total={queue.total} hasMore={queue.hasMore} loading={queue.isFetchingMore} onLoad={queue.loadMore} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------- one view

export function StoreViewBody({ view, branchId, taskId, onOpen, openId }: {
  view: FileView;
  branchId: string | null;
  taskId?: string;
  onOpen: (id: string) => void;
  openId?: string;
}): ReactNode {
  if (view === "review") return <ReviewView branchId={branchId} />;
  if (view === "tasks") return <TasksView branchId={branchId} taskId={taskId} onOpen={onOpen} openId={openId} />;
  return <FlatView key={view} view={view} branchId={branchId} onOpen={onOpen} openId={openId} />;
}

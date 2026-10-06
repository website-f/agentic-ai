/** My workspace (P26): each person's own desk, for owners and staff alike.
 *
 * One page instead of going through Files, SOPs, Workflows, Tasks and Documents one by one:
 * ask or search (the question goes to their AI worker, who finds it in the company's documents
 * and hands it back), what they pinned, the work they gave and what came back, their
 * workspace files, their AI workers, what waits for them, and the SOPs and workflows for
 * their job, ready to open or run again. The rest of the app stays there to browse. */
import {
  ArrowRightIcon,
  BrainIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CloudArrowUpIcon,
  DeskIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FilesIcon,
  FlowArrowIcon,
  HourglassIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  PaperPlaneTiltIcon,
  PlayIcon,
  PushPinIcon,
  SealCheckIcon,
  SparkleIcon,
  SpinnerGapIcon,
  SquaresFourIcon,
  StackIcon,
  UserFocusIcon,
  WarningIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { PageTabs } from "@/components/page-tabs";
import { PinButton } from "@/components/pin-button";
import { MadeBy, ReviewPill } from "@/components/provenance";
import { Marked, TYPE_ICON, typeLabel, useOpenTarget } from "@/components/search-box";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow, Meta } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  askDesk,
  askTargetsQuery,
  deskKeys,
  deskQuery,
  unpinItem,
  uploadToDesk,
  workGroup,
  type Desk,
  type DeskWork,
  type Pin,
  type PinKind,
} from "@/lib/desk";
import { fileSize, fileUrl } from "@/lib/documents";
import { searchKeys, suggestQuery, useDebounced, type SearchResult } from "@/lib/search";
import { cn, timeAgo } from "@/lib/utils";
import type { Workflow } from "@/lib/workflows";
import { StartRunDialog } from "@/pages/workflows/run";

import { AgentsTab } from "./agents";
import { WorkflowsTab } from "./workflows";

const PIN_ICON: Record<PinKind, Icon> = {
  sop: FileTextIcon,
  workflow: FlowArrowIcon,
  file: FilesIcon,
  document: FilesIcon,
  template: StackIcon,
  page: BrainIcon,
  task: KanbanIcon,
  agent: UserFocusIcon,
  search: MagnifyingGlassIcon,
};

const PIN_TONE: Record<PinKind, Tone> = {
  sop: "info",
  workflow: "violet",
  file: "accent",
  document: "accent",
  template: "orange",
  page: "pink",
  task: "neutral",
  agent: "ok",
  search: "neutral",
};

export function DeskPage() {
  const t = useT();
  const { data, isLoading, error } = useQuery(deskQuery);
  if (isLoading) {
    return (
      <Page wide>
        <Skeleton className="h-10 w-64 rounded-sm" />
        <Skeleton className="h-36 rounded-[var(--radius-md)]" />
        <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</StatGrid>
        <Skeleton className="h-72 rounded-[var(--radius-md)]" />
      </Page>
    );
  }
  if (error || !data) {
    return (
      <Page wide>
        <PageHeader title={t("My workspace")} icon={DeskIcon} />
        <EmptyState icon={WarningIcon} title={t("Could not open your workspace")} body={errorMessage(error)} />
      </Page>
    );
  }
  return <DeskView desk={data} />;
}

export type DeskTab = "overview" | "work" | "files" | "procedures" | "agents";
export const DESK_TABS: DeskTab[] = ["overview", "work", "files", "procedures", "agents"];

function DeskView({ desk }: { desk: Desk }) {
  const t = useT();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: DeskTab };
  const tab: DeskTab = search.tab && DESK_TABS.includes(search.tab) ? search.tab : "overview";
  const go = (next: DeskTab) => void navigate({ to: "/workspace", search: next === "overview" ? {} : { tab: next }, replace: true });
  const waiting = desk.waiting.approvals.length + desk.waiting.reviews.length + desk.waiting.documents.length;
  const open = desk.work.filter((w) => workGroup(w.status) === "open").length;
  const done = desk.work.filter((w) => workGroup(w.status) === "done").length;
  const where = [desk.person.company, desk.person.department].filter(Boolean).join(" · ");
  return (
    <Page wide>
      <PageHeader
        title={t("My workspace")}
        icon={DeskIcon}
        eyebrow={where || t("Home")}
        description={t("Your desk: what you pinned, the procedures for your job, your AI workers, the work you gave and everything it produced. Ask here and your AI worker finds it for you.")}
      />
      <PageTabs
        label={t("My workspace")}
        guide="desk.tabs"
        value={tab}
        onChange={go}
        tabs={[
          { value: "overview", label: t("Overview"), icon: SquaresFourIcon, count: waiting, attention: true },
          { value: "work", label: t("My work"), icon: KanbanIcon, count: open + desk.waiting.reviews.length },
          { value: "files", label: t("My files"), icon: FilesIcon, count: desk.file_counts.total + desk.document_total },
          { value: "procedures", label: t("Workflows & SOPs"), icon: FlowArrowIcon, count: desk.procedures.workflow_total },
          { value: "agents", label: t("AI workers"), icon: UserFocusIcon, count: desk.agents.length },
        ]}
      />
      {tab === "overview" ? (
        <>
          {desk.can_ask ? <AskPanel /> : null}
          <StatGrid guide="desk.stats">
            <Stat label={t("Waiting for you")} value={waiting} icon={SealCheckIcon} tone={waiting ? "warn" : "ok"} hint={waiting ? t("Approvals, answers and reviews") : t("Nothing right now")} onClick={() => go("work")} />
            <Stat label={t("In progress")} value={open} icon={HourglassIcon} tone="info" hint={t("Work you gave or your AI does")} onClick={() => go("work")} />
            <Stat label={t("Done this week")} value={done} icon={CheckCircleIcon} tone="ok" onClick={() => go("work")} />
            <Stat label={t("In my workspace")} value={desk.file_counts.total + desk.document_total} icon={FilesIcon} tone="accent" hint={t("{n} pinned", { n: desk.pins.length })} onClick={() => go("files")} />
          </StatGrid>
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_23rem]">
            <div className="grid min-w-0 content-start gap-5">
              <Pinned pins={desk.pins} />
            </div>
            <div className="grid min-w-0 content-start gap-5">
              <Waiting desk={desk} />
              {desk.recent_searches.length ? <Recent items={desk.recent_searches} /> : null}
            </div>
          </div>
        </>
      ) : tab === "work" ? (
        <MyWork work={desk.work} />
      ) : tab === "files" ? (
        <MyFiles desk={desk} />
      ) : tab === "procedures" ? (
        <WorkflowsTab desk={desk} />
      ) : (
        <AgentsTab desk={desk} onWorkflows={() => go("procedures")} />
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- ask or search

function AskPanel() {
  const t = useT();
  const qc = useQueryClient();
  const open = useOpenTarget();
  const [q, setQ] = useState("");
  const [make, setMake] = useState<"answer" | "document">("answer");
  const [agentId, setAgentId] = useState<string>("");
  const [searched, setSearched] = useState("");
  const [asked, setAsked] = useState<{ id: string; title: string; agent: string; note: string | null } | null>(null);
  const debounced = useDebounced(q.trim(), 180);
  const { data: sug } = useQuery(suggestQuery(debounced, undefined, debounced.length >= 2 && debounced !== searched));
  const { data: targets = [] } = useQuery(askTargetsQuery);
  const target = targets.find((a) => a.id === agentId) ?? targets[0];
  const results = useQuery({
    queryKey: [...searchKeys.all, "desk", searched],
    queryFn: () => api<SearchResult>(`/api/search?${new URLSearchParams({ q: searched, limit: "6" })}`),
    enabled: !!searched,
  });
  const ask = useMutation({
    mutationFn: () => askDesk({ text: q.trim(), agent_id: target?.id, make }),
    onSuccess: (r) => {
      setAsked({ id: r.task_id, title: r.title, agent: r.agent.name, note: r.note });
      setQ("");
      setSearched("");
      void qc.invalidateQueries({ queryKey: deskKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const search = (text: string) => {
    const s = text.trim();
    if (!s) return;
    setQ(s);
    setSearched(s);
    setAsked(null);
  };
  const terms = (sug?.suggestions ?? []).filter((s) => q.trim() && s.text.toLowerCase() !== q.trim().toLowerCase()).slice(0, 6);
  return (
    <Card data-guide="desk.ask" className="overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_65%)] p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <IconTile icon={SparkleIcon} size="sm" />
          <h2 className="text-[15px] font-semibold">{t("Ask or search")}</h2>
          <span className="text-[12.5px] text-muted">{t("Anything inside your company's documents, SOPs and records.")}</span>
        </div>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            search(q);
          }}
        >
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">{t("Ask or search")}</span>
            <MagnifyingGlassIcon size={18} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("e.g. kelayakan advance, RM700, uniform request, a tender number…")}
              className="h-12 w-full rounded-sm border border-border bg-surface pr-10 pl-10 text-[15px] text-fg placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
            />
            {q ? (
              <button type="button" aria-label={t("Clear")} onClick={() => { setQ(""); setSearched(""); }} className="absolute top-1/2 right-3 -translate-y-1/2 text-muted hover:text-fg">
                <XIcon size={16} />
              </button>
            ) : null}
          </label>
          <div className="flex min-w-0 gap-2 max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1">
            <Button type="submit" variant="outline" size="lg" disabled={!q.trim()}>
              <MagnifyingGlassIcon size={16} /> {t("Search")}
            </Button>
            <Button type="button" size="lg" disabled={q.trim().length < 3 || !target} loading={ask.isPending} onClick={() => ask.mutate()}>
              <PaperPlaneTiltIcon size={16} /> <span className="truncate">{target ? t("Ask {name}", { name: target.name }) : t("Ask my AI")}</span>
            </Button>
          </div>
        </form>
        {terms.length ? (
          <div className="flex flex-wrap gap-1.5">
            {terms.map((s) => (
              <button
                key={`${s.kind}:${s.text}:${s.id ?? ""}`}
                type="button"
                onClick={() => (s.kind === "term" || s.kind === "recent" ? search(s.text) : open(s.url, s.type, s.branch_id))}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[12.5px] hover:border-accent/40 hover:bg-accent-soft/40"
              >
                {s.kind === "recent" ? <ClockCounterClockwiseIcon size={12} /> : s.kind === "term" ? <MagnifyingGlassIcon size={12} /> : <FileTextIcon size={12} />}
                <span className="truncate">{s.text}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <Segmented
            size="sm"
            label={t("What should your AI hand back?")}
            value={make}
            onChange={setMake}
            options={[
              { value: "answer", label: t("Find and answer") },
              { value: "document", label: t("Answer and prepare a document") },
            ]}
          />
          {targets.length > 1 ? (
            <Select size="sm" label={t("Who should do it")} value={target?.id ?? ""} onValueChange={setAgentId}
              options={targets.map((a) => ({ value: a.id, label: a.is_twin ? t("{name} (your AI worker)", { name: a.name }) : a.name }))} className="min-w-0 sm:w-64" />
          ) : null}
          {!targets.length ? (
            <span>{t("You have no AI worker yet.")} <Link to="/my-worker" className="text-accent hover:underline">{t("Hire one")}</Link></span>
          ) : (
            <span>{t("Whatever it finds or makes is kept in your workspace.")}</span>
          )}
        </div>
        {asked ? (
          <div className="flex flex-wrap items-center gap-2 rounded-sm border border-accent/30 bg-accent-soft/40 px-3 py-2 text-[13px]">
            <CheckCircleIcon size={16} className="text-accent" weight="fill" />
            <span className="min-w-0 flex-1">
              {asked.note ? t("{name} will do it: {note}", { name: asked.agent, note: asked.note }) : t("{name} is on it. The answer appears under My work.", { name: asked.agent })}
            </span>
            <Link to="/tasks" search={{ task: asked.id }} className="font-medium text-accent hover:underline">{t("Follow it")}</Link>
          </div>
        ) : null}
      </div>
      {searched ? (
        <div className="border-t border-border">
          {results.isLoading ? (
            <div className="grid gap-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-sm" />)}</div>
          ) : results.data && results.data.hits.length ? (
            <ListCard className="rounded-none border-0">
              {results.data.hits.map((h) => {
                const IconCmp = TYPE_ICON[h.type];
                return (
                  <ListRow
                    key={`${h.type}:${h.id}:${h.page ?? ""}`}
                    leading={<IconTile icon={IconCmp} size="sm" tone="neutral" />}
                    title={h.title}
                    meta={
                      <>
                        <Meta items={[typeLabel(t, h.type), h.page ? t("p.{n}", { n: h.page }) : null, h.company, h.folder]} />
                        {h.snippet ? <Marked html={h.snippet} className="line-clamp-2 basis-full text-[12.5px]" /> : null}
                      </>
                    }
                    trailing={
                      <>
                        <PinButton kind={h.type === "page" ? "page" : h.type} refId={h.id} title={h.title} />
                        <Button size="sm" variant="outline" onClick={() => open(h.url, h.type, h.branch_id)}>{t("Open|verb")}</Button>
                      </>
                    }
                  />
                );
              })}
              <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12.5px] text-muted">
                <span>{t("{n} results", { n: results.data.total })}</span>
                <span className="flex flex-wrap gap-3">
                  <PinButton kind="search" refId={searched} title={searched} withLabel />
                  <Link to="/search" search={{ q: searched }} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    {t("See all results")} <ArrowRightIcon size={13} />
                  </Link>
                </span>
              </li>
            </ListCard>
          ) : (
            <p className="px-4 py-4 text-[13px] text-muted">
              {t("Nothing in the documents matches “{q}”.", { q: searched })} {targets.length ? t("Ask your AI worker: it also reads the files page by page and asks colleagues.") : null}
            </p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------- pinned

function Pinned({ pins }: { pins: Pin[] }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [running, setRunning] = useState<Workflow | null>(null);
  const unpin = useMutation({
    mutationFn: unpinItem,
    onSuccess: () => void qc.invalidateQueries({ queryKey: deskKeys.all }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const run = useMutation({
    mutationFn: (id: string) => api<Workflow>(`/api/workflows/${id}`),
    onSuccess: setRunning,
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card data-guide="desk.pinned">
      <CardHeader
        title={t("Pinned")}
        description={t("Your shortcuts: SOPs, workflows, files, documents and searches you use often.")}
        icon={<IconTile icon={PushPinIcon} size="sm" />}
      />
      <CardBody>
        {pins.length ? (
          <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {pins.map((p) => (
              <li key={p.id} className={cn("group relative grid min-w-0 gap-2 rounded-[var(--radius-sm)] border border-border bg-surface p-3 transition-colors hover:border-accent/40", p.missing && "opacity-60")}>
                <button type="button" onClick={() => !p.missing && void navigate({ href: p.url })} className="flex min-w-0 items-start gap-2.5 pr-7 text-left" disabled={p.missing}>
                  <IconTile icon={PIN_ICON[p.kind]} tone={PIN_TONE[p.kind]} size="sm" />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="truncate text-[13.5px] font-medium">{p.title}</span>
                    <span className="truncate text-[12px] text-muted">{p.missing ? t("No longer there") : pinKindLabel(t, p.kind)}{p.sub && !p.missing ? ` · ${p.kind === "sop" ? scopeLabel(t, p.sub) : p.sub}` : ""}</span>
                  </span>
                </button>
                <Button size="icon-sm" variant="ghost" className="absolute top-1.5 right-1.5 size-7" title={t("Unpin")} aria-label={t("Unpin")} onClick={() => unpin.mutate(p.id)}>
                  <XIcon size={13} />
                </Button>
                {(p.kind === "workflow" || p.kind === "file") && !p.missing ? <div className="flex items-center gap-1.5">
                  {p.kind === "workflow" && !p.missing ? (
                    <Button size="sm" variant="outline" loading={run.isPending && run.variables === p.ref} onClick={() => run.mutate(p.ref)}>
                      <PlayIcon size={13} /> {t("Run")}
                    </Button>
                  ) : null}
                  {p.kind === "file" && !p.missing ? (
                    <Button size="sm" variant="ghost" asChild>
                      <a href={fileUrl(p.ref)} download><DownloadSimpleIcon size={14} /> {t("Download")}</a>
                    </Button>
                  ) : null}
                </div> : null}
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex items-start gap-3 rounded-sm border border-dashed border-border px-4 py-5 text-[13px] text-muted">
            <PushPinIcon size={18} className="mt-0.5 shrink-0 text-accent" />
            <p>{t("Nothing pinned yet. Press the pin next to any SOP, workflow, file, document or search result, and it stays here for one-click access.")}</p>
          </div>
        )}
      </CardBody>
      {running ? <StartRunDialog wf={running} onClose={() => setRunning(null)} /> : null}
    </Card>
  );
}

function scopeLabel(t: (s: string) => string, scope: string): string {
  return scope === "department" ? t("Your department") : scope === "branch" ? t("Your company") : scope === "library" ? t("Library") : t("Everyone");
}

function pinKindLabel(t: (s: string) => string, k: PinKind): string {
  return {
    sop: "SOP",
    workflow: t("Workflow"),
    file: t("File"),
    document: t("Document"),
    template: t("Template"),
    page: t("Wiki page"),
    task: t("Task"),
    agent: t("Agent"),
    search: t("Saved search"),
  }[k];
}

// ---------------------------------------------------------------- my work

const STATUS: Record<string, { label: string; tone: "neutral" | "info" | "ok" | "warn" | "danger" | "accent" }> = {
  triage: { label: "Queued", tone: "neutral" },
  ready: { label: "Queued", tone: "neutral" },
  running: { label: "Working", tone: "info" },
  blocked: { label: "Needs you", tone: "warn" },
  review: { label: "Review", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

function MyWork({ work }: { work: DeskWork[] }) {
  const t = useT();
  const navigate = useNavigate();
  const counts = { open: 0, waiting: 0, done: 0 };
  for (const w of work) counts[workGroup(w.status)] += 1;
  const [tab, setTab] = useState<"open" | "waiting" | "done">(counts.waiting ? "waiting" : counts.open ? "open" : "done");
  const shown = work.filter((w) => workGroup(w.status) === tab);
  return (
    <Card data-guide="desk.work">
      <CardHeader
        title={t("My work")}
        description={t("What you asked for and what your AI workers are doing, with everything they made.")}
        icon={<IconTile icon={KanbanIcon} size="sm" tone="info" />}
      />
      <div className="border-b border-border px-4 py-2.5 sm:px-5">
        <Segmented size="sm" label={t("Show")} value={tab} onChange={setTab}
          options={[
            { value: "open", label: t("In progress"), count: counts.open },
            { value: "waiting", label: t("Waiting for me"), count: counts.waiting },
            { value: "done", label: t("Done"), count: counts.done },
          ]} />
      </div>
      {shown.length ? (
        <ListCard className="rounded-none border-0">
          {shown.map((w) => {
            const s = STATUS[w.status] ?? STATUS.ready!;
            return (
              <ListRow
                key={w.id}
                onClick={() => void navigate({ href: w.url })}
                leading={w.status === "running" ? <SpinnerGapIcon size={18} className="animate-spin text-info" /> : <IconTile icon={w.source === "desk" ? SparkleIcon : KanbanIcon} size="sm" tone={w.status === "done" ? "ok" : "neutral"} />}
                title={w.title}
                meta={
                  <>
                    <Meta items={[w.agent_name, w.from_me ? t("You asked") : w.source === "scheduled" ? t("Its duty") : null, timeAgo(w.updated_at)]} />
                    {w.note && w.status === "blocked" ? <span className="basis-full text-warn">{w.note}</span> : null}
                    {w.result && workGroup(w.status) !== "open" ? <span className="line-clamp-2 basis-full text-[12.5px]">{w.result.replace(/[*#`>]/g, "")}</span> : null}
                    {w.made.length ? (
                      <span className="flex max-w-full min-w-0 basis-full flex-wrap gap-1.5 pt-1">
                        {w.made.map((m) => (
                          <Link key={m.id} to={m.kind === "document" ? "/documents" : "/files"} search={m.kind === "document" ? { d: m.id } : { f: m.id }} onClick={(e) => e.stopPropagation()}
                            className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-full border border-border bg-surface-2/60 px-2 py-0.5 text-[12px] text-fg hover:border-accent/40">
                            <FilesIcon size={12} className="shrink-0" /> <span className="min-w-0 truncate">{m.title}</span>
                          </Link>
                        ))}
                      </span>
                    ) : null}
                  </>
                }
                trailing={<Pill tone={s.tone}>{t(s.label)}</Pill>}
              />
            );
          })}
        </ListCard>
      ) : (
        <CardBody>
          <p className="text-[13px] text-muted">
            {tab === "waiting" ? t("Nothing waits for you.") : tab === "open" ? t("Nothing in progress. Ask above, or give your AI worker a task.") : t("Nothing finished this week yet.")}
          </p>
        </CardBody>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- my files

const FEW = 8;

function MyFiles({ desk }: { desk: Desk }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"files" | "agent" | "uploaded" | "documents">("files");
  const [all, setAll] = useState(false);
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      for (const f of files) await uploadToDesk(f);
      return files.length;
    },
    onSuccess: (n) => {
      toast.success(t("{n} file(s) added to your workspace.", { n }));
      void qc.invalidateQueries({ queryKey: deskKeys.all });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const matching = desk.files.filter((f) => tab === "files" || (tab === "agent" ? f.origin === "agent" : f.origin === "uploaded"));
  const files = all ? matching : matching.slice(0, FEW);
  return (
    <Card data-guide="desk.files">
      <CardHeader
        title={t("My workspace files")}
        description={t("Everything you uploaded here and everything your work produced: quotations, letters, reports, spreadsheets.")}
        icon={<IconTile icon={FilesIcon} size="sm" />}
        actions={
          <>
            <input ref={input} type="file" multiple hidden onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; if (list.length) upload.mutate(list); }} />
            <Button size="sm" variant="outline" loading={upload.isPending} onClick={() => input.current?.click()}>
              <CloudArrowUpIcon size={15} /> {t("Upload to my workspace")}
            </Button>
          </>
        }
      />
      <div className="border-b border-border px-4 py-2.5 sm:px-5">
        <Segmented size="sm" label={t("Show")} value={tab} onChange={setTab}
          options={[
            { value: "files", label: t("All files"), count: desk.file_counts.total },
            { value: "agent", label: t("Made by AI"), count: desk.file_counts.agent },
            { value: "uploaded", label: t("Uploaded"), count: desk.file_counts.uploaded },
            { value: "documents", label: t("Documents"), count: desk.document_total },
          ]} />
      </div>
      {tab === "documents" ? (
        desk.documents.length ? (
          <ListCard className="rounded-none border-0">
            {(all ? desk.documents : desk.documents.slice(0, FEW)).map((d) => (
              <ListRow key={d.id} onClick={() => void navigate({ href: d.url })}
                leading={<IconTile icon={FileTextIcon} size="sm" tone="neutral" />}
                title={d.title}
                meta={<Meta items={[d.number, <MadeBy key="m" origin={d.origin} agentName={d.agent_name} size="sm" />, timeAgo(d.updated_at)]} />}
                trailing={<><ReviewPill status={d.review_status} /><PinButton kind="document" refId={d.id} title={d.title} /></>} />
            ))}
          </ListCard>
        ) : (
          <CardBody><p className="text-[13px] text-muted">{t("No documents yet. Ask your AI worker to prepare one, or draft one in Documents.")}</p></CardBody>
        )
      ) : files.length ? (
        <ListCard className="rounded-none border-0">
          {files.map((f) => (
            <ListRow key={f.id} onClick={() => void navigate({ href: f.url })}
              leading={<IconTile icon={f.origin === "agent" ? SparkleIcon : FilesIcon} size="sm" tone={f.origin === "agent" ? "accent" : "neutral"} />}
              title={f.title}
              meta={<Meta items={[<MadeBy key="m" origin={f.origin} agentName={f.agent_name} size="sm" />, f.folder, fileSize(f.size), timeAgo(f.created_at)]} />}
              trailing={
                <>
                  <PinButton kind="file" refId={f.id} title={f.title} />
                  {!f.quarantined ? (
                    <Button size="icon-sm" variant="ghost" asChild title={t("Download")} aria-label={t("Download")}>
                      <a href={fileUrl(f.id)} download onClick={(e) => e.stopPropagation()}><DownloadSimpleIcon size={15} /></a>
                    </Button>
                  ) : <Pill tone="warn">{t("Held back")}</Pill>}
                </>
              } />
          ))}
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12.5px]">
            {matching.length > FEW ? (
              <button type="button" onClick={() => setAll((v) => !v)} className="font-medium text-accent hover:underline">
                {all ? t("Show fewer") : t("Show all ({n})", { n: matching.length })}
              </button>
            ) : <span />}
            <Link to="/files" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("Company files")} <ArrowRightIcon size={13} /></Link>
          </li>
        </ListCard>
      ) : (
        <CardBody><p className="text-[13px] text-muted">{t("Nothing here yet. Upload your own files, or ask your AI worker: what it makes lands here.")}</p></CardBody>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- right column

function Waiting({ desk }: { desk: Desk }) {
  const t = useT();
  const w = desk.waiting;
  const rows: { key: string; icon: Icon; title: string; hint: string; to: ReactNode }[] = [
    ...w.approvals.map((a) => ({
      key: a.id,
      icon: SealCheckIcon,
      title: a.task_title,
      hint: a.kind === "question" ? t("Your AI asks you something") : t("Asks to: {what}", { what: a.tool_name }),
      to: <Link to="/approvals" className="text-[12.5px] font-medium text-accent hover:underline">{t("Answer")}</Link>,
    })),
    ...w.documents.map((d) => ({
      key: d.id,
      icon: FileTextIcon,
      title: d.title,
      hint: t("Made by AI, waiting for your review"),
      to: <Link to="/documents" search={{ d: d.id }} className="text-[12.5px] font-medium text-accent hover:underline">{t("Review")}</Link>,
    })),
    ...w.reviews.map((r) => ({
      key: r.id,
      icon: KanbanIcon,
      title: r.title,
      hint: t("Finished, waiting for you to accept"),
      to: <Link to="/tasks" search={{ task: r.id }} className="text-[12.5px] font-medium text-accent hover:underline">{t("Review")}</Link>,
    })),
  ];
  return (
    <Card data-guide="desk.waiting">
      <CardHeader title={t("Waiting for you")} icon={<IconTile icon={SealCheckIcon} size="sm" tone={rows.length ? "warn" : "ok"} />} />
      {rows.length ? (
        <ListCard className="rounded-none border-0">
          {rows.slice(0, 8).map((r) => (
            <ListRow key={r.key} leading={<r.icon size={16} className="text-warn" />} title={r.title} meta={r.hint} trailing={r.to} />
          ))}
        </ListCard>
      ) : (
        <CardBody><p className="text-[13px] text-muted">{t("Nothing waits for you. Your AI asks here before anything important.")}</p></CardBody>
      )}
    </Card>
  );
}

function Recent({ items }: { items: string[] }) {
  const t = useT();
  return (
    <Card>
      <CardHeader title={t("Recent searches")} icon={<IconTile icon={ClockCounterClockwiseIcon} size="sm" tone="neutral" />} />
      <CardBody className="flex flex-wrap gap-1.5">
        {items.map((q) => (
          <span key={q} className="inline-flex max-w-full items-center gap-0.5 rounded-full border border-border bg-surface pr-1 text-[12.5px]">
            <Link to="/search" search={{ q }} className="truncate py-1 pl-3 hover:text-accent">{q}</Link>
            <PinButton kind="search" refId={q} title={q} className="size-6" />
          </span>
        ))}
      </CardBody>
    </Card>
  );
}

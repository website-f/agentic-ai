/** My workspace (P26): each person's own desk, for owners and staff alike. P97: its overview
 * (./home.tsx) is the person's virtual desk: one bar to anywhere, Today, Pinned (anything, in
 * folders), Recent, My AI, How do I…? and Go to, each shown, hidden and ordered by them.
 *
 * One page instead of going through Files, SOPs, Workflows, Tasks and Documents one by one:
 * ask or search (the question goes to their AI worker, who finds it in the company's documents
 * and hands it back), what they pinned, the work they gave and what came back, their
 * workspace files, their AI workers, what waits for them, and the SOPs and workflows for
 * their job, ready to open or run again. The rest of the app stays there to browse. */
import {
  ArrowRightIcon,
  CloudArrowUpIcon,
  DeskIcon,
  DownloadSimpleIcon,
  FileTextIcon,
  FilesIcon,
  FlowArrowIcon,
  KanbanIcon,
  ListChecksIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  SpinnerGapIcon,
  SquaresFourIcon,
  UserFocusIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { PageTabs } from "@/components/page-tabs";
import { TutorialBanner } from "@/pages/tutorial/banner";
import { PinButton } from "@/components/pin-button";
import { MadeBy, ReviewPill } from "@/components/provenance";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow, Meta } from "@/components/ui/card";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useLang, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { deskKeys, deskQuery, uploadToDesk, workGroup, type Desk, type DeskWork } from "@/lib/desk";
import { fileSize, fileUrl } from "@/lib/documents";
import { useIsPhone } from "@/lib/use-media";
import { timeAgo } from "@/lib/utils";

import { useAskMyAi } from "./hub";
import { AgentsTab } from "./agents";
import { DeskHome, greeting } from "./home";
import { WorkflowsTab } from "./workflows";

export function DeskPage() {
  const t = useT();
  const { data, isLoading, error } = useQuery(deskQuery);
  if (isLoading) {
    return (
      <Page>
        <Skeleton className="h-12 w-72 max-w-full rounded-sm" />
        <Skeleton className="h-14 rounded-[var(--radius-lg)]" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56 rounded-[var(--radius-md)]" />
          <Skeleton className="h-56 rounded-[var(--radius-md)]" />
        </div>
        <Skeleton className="h-40 rounded-[var(--radius-md)]" />
      </Page>
    );
  }
  if (error || !data) {
    return (
      <Page>
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
  const lang = useLang((s) => s.lang);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: DeskTab };
  const tab: DeskTab = search.tab && DESK_TABS.includes(search.tab) ? search.tab : "overview";
  const go = (next: DeskTab) => void navigate({ to: "/workspace", search: next === "overview" ? {} : { tab: next }, replace: true });
  const [customizing, setCustomizing] = useState(false);
  // On a phone, Customize sits at the end of the desk instead of above it.
  const phone = useIsPhone();
  const waiting = desk.waiting.approvals.length + desk.waiting.reviews.length + desk.waiting.documents.length;
  const open = desk.work.filter((w) => workGroup(w.status) === "open").length;
  const where = [desk.person.company, desk.person.department].filter(Boolean).join(" · ");
  // P97: a greeting and today's date, the person's company and department under it.
  const now = new Date();
  const first = desk.person.name.trim().split(/\s+/)[0] ?? "";
  const today = now.toLocaleDateString(lang === "ms" ? "ms-MY" : "en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <Page>
      <PageHeader
        title={t(greeting(now.getHours()), { name: first })}
        icon={DeskIcon}
        eyebrow={[today, where].filter(Boolean).join(" · ")}
        actions={tab === "overview" && !phone ? (
          <Button variant="outline" size="sm" onClick={() => setCustomizing(true)}>
            <SlidersHorizontalIcon size={15} /> {t("Customize")}
          </Button>
        ) : undefined}
      />
      {/* P48: staff never open the Command center, so the tutorial nudge lives here too. */}
      <TutorialBanner />
      <PageTabs
        label={t("My workspace")}
        guide="desk.tabs"
        value={tab}
        onChange={go}
        tabs={[
          { value: "overview", label: t("My desk"), icon: SquaresFourIcon, count: waiting, attention: true },
          { value: "work", label: t("My work"), icon: KanbanIcon, count: open + desk.waiting.reviews.length },
          { value: "files", label: t("My files"), icon: FilesIcon, count: desk.file_counts.total + desk.document_total },
          { value: "procedures", label: t("Workflows & SOPs"), icon: FlowArrowIcon, count: desk.procedures.workflow_total },
          { value: "agents", label: t("AI workers"), icon: UserFocusIcon, count: desk.agents.length },
        ]}
      />
      {tab === "overview" ? (
        <DeskHome desk={desk} onTab={go} customizing={customizing} onCustomize={setCustomizing} />
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
        actions={
          <Button size="sm" asChild>
            <Link to="/tasks"><KanbanIcon size={15} /> {t("Open the task board")}</Link>
          </Button>
        }
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
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const ask = useAskMyAi();
  const hit = (text: string) => !needle || needle.split(/\s+/).every((w) => text.toLowerCase().includes(w));
  const matching = desk.files.filter((f) => (tab === "files" || (tab === "agent" ? f.origin === "agent" : f.origin === "uploaded")) && hit(`${f.title} ${f.folder ?? ""}`));
  const docs = desk.documents.filter((d) => hit(`${d.title} ${d.number ?? ""}`));
  const files = all || needle ? matching : matching.slice(0, FEW);
  const askAbout = (id: string, how: "summary" | "facts") =>
    ask.mutate({
      file_ids: [id],
      text: how === "summary"
        ? t("Summarize this file for me: the main points in plain words, then anything I must do.")
        : t("From this file, list every date, deadline, amount, name and thing someone must do, with the page it is on."),
    });
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
      <div className="grid gap-2.5 border-b border-border px-4 py-2.5 sm:px-5">
        <SearchInput value={q} onChange={setQ} placeholder={t("Search my files by name or folder")} />
        <Segmented size="sm" label={t("Show")} value={tab} onChange={setTab}
          options={[
            { value: "files", label: t("All files"), count: desk.file_counts.total },
            { value: "agent", label: t("Made by AI"), count: desk.file_counts.agent },
            { value: "uploaded", label: t("Uploaded"), count: desk.file_counts.uploaded },
            { value: "documents", label: t("Documents"), count: desk.document_total },
          ]} />
      </div>
      {needle ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-[12.5px] text-muted sm:px-5">
          <span>{t("Only the newest files of your workspace are here.")}</span>
          <Link to="/search" search={{ q: q.trim() } as never} className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
            {t("Search every document for “{q}”", { q: q.trim() })} <ArrowRightIcon size={13} />
          </Link>
          {desk.can_ask ? (
            <button type="button" className="font-medium text-accent hover:underline" disabled={ask.isPending}
              onClick={() => ask.mutate({ text: t("Find the file or document about: {q}. Tell me where it is and what it says.", { q: q.trim() }) })}>
              {t("Ask my AI to find it")}
            </button>
          ) : null}
        </p>
      ) : null}
      {tab === "documents" ? (
        docs.length ? (
          <ListCard className="rounded-none border-0">
            {(all || needle ? docs : docs.slice(0, FEW)).map((d) => (
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
                  {desk.can_ask && !f.quarantined ? (
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" title={t("Ask my AI about this file")} aria-label={t("Ask my AI about this file")} onClick={(e) => e.stopPropagation()}>
                          <SparkleIcon size={15} />
                        </Button>
                      </MenuTrigger>
                      <MenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <MenuItem icon={<SparkleIcon />} onSelect={() => askAbout(f.id, "summary")}>{t("Summarize it")}</MenuItem>
                        <MenuItem icon={<ListChecksIcon />} onSelect={() => askAbout(f.id, "facts")}>{t("Pull out dates, amounts and to-dos")}</MenuItem>
                      </MenuContent>
                    </Menu>
                  ) : null}
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
            {matching.length > FEW && !needle ? (
              <button type="button" onClick={() => setAll((v) => !v)} className="font-medium text-accent hover:underline">
                {all ? t("Show fewer") : t("Show all ({n})", { n: matching.length })}
              </button>
            ) : <span />}
            <Link to="/files" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">{t("Files")} <ArrowRightIcon size={13} /></Link>
          </li>
        </ListCard>
      ) : (
        <CardBody><p className="text-[13px] text-muted">{needle ? t("Nothing matches.") : t("Nothing here yet. Upload your own files, or ask your AI worker: what it makes lands here.")}</p></CardBody>
      )}
    </Card>
  );
}

import {
  ArchiveIcon, ArrowsMergeIcon, BookOpenTextIcon, ChartLineUpIcon, CheckCircleIcon, ClockCounterClockwiseIcon, DownloadSimpleIcon, LightningIcon, PencilSimpleIcon, PlusIcon,
  RobotIcon, SealQuestionIcon, ShieldWarningIcon, SparkleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ListCard, Meta } from "@/components/ui/card";
import { DataTable, filterOf, TableFilter, useTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { LoadMore } from "@/components/load-more";
import { Segmented } from "@/components/ui/segmented";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { isAutoApproved } from "@/lib/learning";
import { keys, meQuery } from "@/lib/queries";
import { compact, KIND_LABEL, pct, skillKeys, skillsQuery, TRUST_LABEL, type Proposal, type ProposalKind, type Skill } from "@/lib/skills";
import { usePagedList } from "@/lib/paged";
import { cn, timeAgo } from "@/lib/utils";

import { LearnSourceDialog } from "@/pages/learning/learn-source-dialog";

import { ImportSkillDialog } from "./import-dialog";

import { SuiteBadge } from "./eval-results";
import { ProposalSheet } from "./proposal-sheet";
import { RoutinesPanel } from "./routines";
import { SkillSheet } from "./skill-sheet";

export const SKILL_TABS = ["library", "routines", "proposals", "history"] as const;
export type SkillTab = (typeof SKILL_TABS)[number];
export interface SkillsSearch {
  tab?: SkillTab;
  skill?: string;
  proposal?: string;
}

const TAB_LABEL: Record<SkillTab, string> = { library: msg("Library"), routines: msg("Routines"), proposals: msg("Proposals"), history: msg("History") };
const STATUS_LABEL: Record<Proposal["status"], string> = { pending: msg("pending"), approved: msg("approved"), rejected: msg("rejected"), superseded: msg("superseded") };
const DECIDED_BY: Record<Proposal["status"], string> = { pending: msg("pending, {name}"), approved: msg("approved by {name}"), rejected: msg("rejected by {name}"), superseded: msg("superseded by {name}") };
const TRUST_TONE = { trusted: "info", official: "accent", builtin: "neutral" } as const;
const KIND_LOOK: Record<ProposalKind, { icon: typeof LightningIcon; tone: Tone }> = {
  new: { icon: SparkleIcon, tone: "accent" },
  patch: { icon: PencilSimpleIcon, tone: "info" },
  merge: { icon: ArrowsMergeIcon, tone: "violet" },
  retire: { icon: ArchiveIcon, tone: "neutral" },
};

const STARTER = `## When to use
The situation this procedure is for.

## Steps
1. First step (name the tool to use, e.g. calc)
2. Second step

## Output format
What the finished answer looks like.

## Pitfalls
- What usually goes wrong.
`;

function NewSkill({ open, onOpenChange, canDecide }: { open: boolean; onOpenChange: (o: boolean) => void; canDecide: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState(STARTER);
  const create = useMutation({
    mutationFn: () => api<{ skill: unknown; proposal: unknown }>("/api/skills", "POST", { name, description, body }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: skillKeys.all });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(r.skill ? tr("Published. Agents see it from their next step.") : tr("Sent for review."));
      onOpenChange(false);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={t("New skill")} className="sm:max-w-2xl"
      description={t("A procedure agents load when a task matches. Keep it general: no client names, amounts or dates.")}
      footer={<Button loading={create.isPending} disabled={name.trim().length < 2 || description.trim().length < 10} onClick={() => create.mutate()}>{canDecide ? t("Publish") : t("Send for review")}</Button>}>
      <div className="grid gap-3">
        <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("e.g. reconcile-bank-statement")} autoFocus />
        <Field label={t("Description")} value={description} onChange={(e) => setDescription(e.target.value)} hint={t("One sentence: what it does and when to use it. Agents choose by this.")} />
        <div className="grid gap-1.5">
          <label htmlFor="new-skill-body" className="text-[13px] font-medium">{t("Instructions")}</label>
          <textarea id="new-skill-body" value={body} onChange={(e) => setBody(e.target.value)} rows={14}
            className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
        </div>
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

/** A skill sent back often enough to need a look (5+ judged, under 70% accepted). */
function lowRate(s: Skill): boolean {
  const judged = s.stats.accepted + s.stats.sent_back + s.stats.failed;
  return s.stats.success_rate !== null && judged >= 5 && s.stats.success_rate < 0.7;
}

/** P107: the skill library as a data table: search, which skills / trust / needs-a-look
 * filters, sortable numbers, numbered pages. A row opens the skill's sheet. */
function SkillsTable({ onOpen }: { onOpen: (s: Skill) => void }) {
  const t = useT();
  const control = useTableState({ size: 25 }, { filters: ["state", "trust", "look"] });
  const [stateParam] = filterOf(control, "state");
  const state: "active" | "retired" = stateParam === "retired" ? "retired" : "active";
  const [trust] = filterOf(control, "trust");
  const [look] = filterOf(control, "look");
  const { data: skills, isLoading, error, refetch } = useQuery(skillsQuery(state));
  const rows = useMemo(() => (skills ?? []).filter((s) =>
    (!trust || s.trust === trust)
    && (!look || (look === "review" ? s.pending > 0 : lowRate(s)))), [skills, trust, look]);

  const columns: Column<Skill>[] = [
    {
      id: "name", header: t("Skill"), card: "title", sortValue: (s) => s.name.toLowerCase(), exportValue: (s) => s.name,
      cell: (s) => (
        <span className="flex min-w-0 items-start gap-3">
          <IconTile icon={LightningIcon} tone={s.status === "retired" ? "neutral" : lowRate(s) ? "danger" : "accent"} size="sm" />
          <span className="grid min-w-0 gap-0.5">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 font-mono text-[13.5px] font-medium break-all">{s.name}</span>
              {s.pending ? <Pill tone="warn">{t("{n} to review", { n: s.pending })}</Pill> : null}
              {lowRate(s) ? <Pill tone="danger">{t("Often sent back")}</Pill> : null}
            </span>
            <span className="line-clamp-2 text-[12.5px] break-words text-muted">{s.description}</span>
          </span>
        </span>
      ),
    },
    { id: "description", header: t("Description"), exportOnly: true, cell: () => null, exportValue: (s) => s.description },
    { id: "trust", header: t("Kind"), sortValue: (s) => t(TRUST_LABEL[s.trust]), hideBelow: "lg", cell: (s) => <Pill tone={TRUST_TONE[s.trust]}>{t(TRUST_LABEL[s.trust])}</Pill> },
    { id: "version", header: t("Version"), kind: "number", align: "right", hideBelow: "xl", sortValue: (s) => s.version, cell: (s) => `v${s.version}` },
    { id: "uses", header: t("Uses"), kind: "number", align: "right", sortValue: (s) => s.stats.uses, cell: (s) => s.stats.uses.toLocaleString(locale()) },
    { id: "accepted", header: t("Accepted"), kind: "number", align: "right", sortValue: (s) => s.stats.success_rate, exportValue: (s) => pct(s.stats.success_rate), cell: (s) => pct(s.stats.success_rate) },
    {
      id: "tokens", header: t("Tokens"), kind: "number", align: "right", hideBelow: "lg",
      sortValue: (s) => (s.saved_pct !== null ? s.saved_pct : null), exportValue: (s) => s.stats.avg_tokens,
      cell: (s) => (s.saved_pct !== null ? (
        <span className={cn(s.saved_pct > 0 && "text-ok")} title={t("tokens")}>−{pct(s.saved_pct)}</span>
      ) : <span title={t("tokens/task")}>{compact(s.stats.avg_tokens)}</span>),
    },
    {
      id: "used", header: t("Last used"), kind: "date", hideBelow: "xl", sortValue: (s) => s.last_used_at,
      cell: (s) => (s.last_used_at ? <span className="text-muted">{timeAgo(s.last_used_at)}</span> : <span className="text-muted">-</span>),
    },
  ];

  return (
    <div data-guide="skills.list" className="grid min-w-0">
      <DataTable
        label={t("Skills")}
        columns={columns}
        rows={rows}
        rowId={(s) => s.id}
        rowLabel={(s) => s.name}
        control={control}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        searchText={(s) => `${s.name} ${s.description}`}
        searchPlaceholder={t("Search skills")}
        exportName={t("skills")}
        onOpen={onOpen}
        empty={<EmptyState icon={LightningIcon} title={state === "retired" ? t("Nothing retired") : t("No skills yet")}
          body={state === "retired" ? t("Retired skills land here and can be restored.") : t("When an agent finishes long or repeated work, it proposes a skill. You can also write one yourself.")} />}
        filters={
          <>
            <TableFilter control={control} id="state" label={t("Which skills")} allLabel={t("Active")}
              options={[{ value: "retired", label: t("Retired") }]} />
            <TableFilter control={control} id="trust" label={t("Kind")} allLabel={t("Every kind")}
              options={(Object.keys(TRUST_LABEL) as Skill["trust"][]).map((k) => ({ value: k, label: t(TRUST_LABEL[k]) }))} />
            <TableFilter control={control} id="look" label={t("Needs a look")} allLabel={t("Every skill")}
              options={[{ value: "review", label: t("Has changes to review") }, { value: "low", label: t("Often sent back") }]} />
          </>
        }
      />
    </div>
  );
}

function ProposalRow({ p, onOpen }: { p: Proposal; onOpen: () => void }) {
  const t = useT();
  const blocks = p.scan.filter((f) => f.level === "block").length;
  const warns = p.scan.length - blocks;
  const look = KIND_LOOK[p.kind];
  const auto = isAutoApproved(p);
  const decider = p.decided_by_name ?? (/^(Approved|Closed) automatically/.test(p.decision_note ?? "") ? t("the autopilot") : null);
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60">
        <IconTile icon={look.icon} tone={look.tone} size="sm" />
        <span className="grid min-w-0 gap-1.5">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-mono text-[13.5px] font-medium break-all">{p.name}</span>
            <Pill tone="accent">{t(KIND_LABEL[p.kind])}</Pill>
            {p.status !== "pending" ? <Pill tone={p.status === "approved" ? "ok" : p.status === "rejected" ? "danger" : "neutral"}>{t(STATUS_LABEL[p.status])}</Pill> : null}
            {auto ? <Pill tone="info"><RobotIcon size={12} weight="fill" aria-hidden /> {t("Auto-approved")}</Pill> : null}
            {blocks ? <Pill tone="danger"><ShieldWarningIcon size={12} weight="fill" /> {t("Must fix")}</Pill> : warns ? <Pill tone="warn">{t("{n} to check", { n: warns })}</Pill> : null}
            {p.eval?.new ? <SuiteBadge suite={p.eval.new} label={t("Tests")} /> : null}
            {p.stale ? <Pill tone="warn">{t("Outdated draft")}</Pill> : null}
          </span>
          {p.reason ? <span className="line-clamp-2 text-[13px] break-words text-muted">{p.reason}</span> : null}
          {p.decision_note ? (
            <span className={cn("w-fit max-w-full rounded-sm px-2 py-1 text-[12.5px] break-words", p.status === "pending" ? "bg-warn/10 text-warn" : "bg-surface-2/70 text-fg/80")}>
              {p.decision_note}
            </span>
          ) : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-muted">
            <Meta items={[
              p.proposed_by_name,
              p.source_task ? <span key="t" className="break-words">{t("from “{title}”", { title: p.source_task.title })}</span> : null,
              timeAgo(p.created_at).toLowerCase(),
              decider ? t(DECIDED_BY[p.status], { name: decider }) : null,
            ]} />
          </span>
        </span>
      </button>
    </li>
  );
}

export function SkillsPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const canManage = me.permissions.includes("agents.manage");
  // P96: a new skill reaches every agent, so only someone who manages the whole workspace's
  // agents publishes it straight away; anyone else sends it for review (skills.may_publish).
  const canPublishNew = canManage && (!me.scope || me.scope.kind === "all");
  const search = useSearch({ strict: false }) as SkillsSearch;
  const navigate = useNavigate();
  const tab: SkillTab = search.tab && SKILL_TABS.includes(search.tab) ? search.tab : "library";
  const [creating, setCreating] = useState(0);
  const [teaching, setTeaching] = useState(0);
  const [importing, setImporting] = useState(false);
  // The library tab's own table asks for active or retired skills; these feed the counts.
  const { data: skills } = useQuery(skillsQuery("active"));
  // Proposals only grow (the review queue and every past decision): both load 50 at a time.
  const pendingList = usePagedList<Proposal>(skillKeys.proposals("pending"), "/api/skill-proposals", { state: "pending" });
  const decidedList = usePagedList<Proposal>(skillKeys.proposals("decided"), "/api/skill-proposals", { state: "decided" }, { enabled: tab === "history" });
  const pending = pendingList.items;
  const decided = decidedList.items;
  const pendingCount = pendingList.total ?? pending.length;
  // Opening and closing a sheet keeps the table's search, filters and page in the address.
  const go = (next: SkillsSearch) => navigate({ to: "/skills", search: ((p: Record<string, unknown>) => ({ ...p, tab, ...next })) as never, replace: true });
  const totals = useMemo(() => {
    const list = skills ?? [];
    const accepted = list.reduce((n, s) => n + s.stats.accepted, 0);
    const judged = list.reduce((n, s) => n + s.stats.accepted + s.stats.sent_back + s.stats.failed, 0);
    return { uses: list.reduce((n, s) => n + s.stats.uses, 0), rate: judged ? accepted / judged : null, judged };
  }, [skills]);

  return (
    <Page>
      <PageHeader
        title={t("Skills")}
        description={t("Procedures your agents load when a task matches, so the second time is faster and cheaper. Agents propose new ones from their work; nothing is used until a person approves it.")}
        actions={canWrite ? (
          <>
            <Button data-guide="skills.teach" variant="outline" onClick={() => setTeaching((n) => n + 1)}><BookOpenTextIcon size={16} /> {t("Teach from a source")}</Button>
            {canManage ? <Button variant="outline" onClick={() => setImporting(true)}><DownloadSimpleIcon size={16} /> {t("Import a skill")}</Button> : null}
            <Button onClick={() => setCreating((n) => n + 1)}><PlusIcon size={16} weight="bold" /> {t("New skill")}</Button>
          </>
        ) : null}
      />
      {skills ? (
        <StatGrid>
          <Stat label={t("Active skills")} value={skills.length} icon={LightningIcon} tone="accent" hint={t("Agents load these when a task matches")} onClick={() => go({ tab: "library" })} active={tab === "library"} />
          <Stat guide="skills.proposals" label={t("To review")} value={pendingCount} icon={SealQuestionIcon} tone={pendingCount ? "warn" : "neutral"}
            hint={pendingCount ? t("Waiting for a person") : t("All caught up")} onClick={() => go({ tab: "proposals" })} active={tab === "proposals"} />
          <Stat label={t("Uses")} value={totals.uses} icon={ChartLineUpIcon} tone="info" hint={t("Across all active skills")} />
          <Stat label={t("Accepted")} value={pct(totals.rate)} icon={CheckCircleIcon} tone="ok" hint={totals.judged ? t("{n} results judged", { n: totals.judged }) : t("Nothing judged yet")} />
        </StatGrid>
      ) : null}

      <Segmented<SkillTab> label={t("Skills sections")} value={tab} onChange={(v) => navigate({ to: "/skills", search: { tab: v }, replace: true })} className="w-fit"
        options={SKILL_TABS.map((k) => ({ value: k, label: t(TAB_LABEL[k]), count: k === "proposals" ? pendingCount : k === "library" ? skills?.length : undefined }))} />

      <div role="tabpanel" aria-label={t(TAB_LABEL[tab])} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
        {tab === "library" ? (
          <SkillsTable onOpen={(s) => go({ skill: s.id })} />
        ) : tab === "routines" ? (
          <RoutinesPanel />
        ) : tab === "proposals" ? (
          pending.length ? (
            <>
              <ListCard>
                {pending.map((p) => <ProposalRow key={p.id} p={p} onOpen={() => go({ proposal: p.id })} />)}
              </ListCard>
              <LoadMore noun="proposals" shown={pending.length} total={pendingList.total} hasMore={pendingList.hasMore} loading={pendingList.isFetchingMore} onLoad={pendingList.loadMore} />
            </>
          ) : (
            <EmptyState icon={SealQuestionIcon} title={t("Nothing to review")}
              body={t("Agents propose a skill after work that took many steps or several rounds of corrections, and the nightly curator proposes merges and retirements. They wait here for you.")} />
          )
        ) : decided.length ? (
          <>
            <ListCard>
              {decided.map((p) => <ProposalRow key={p.id} p={p} onOpen={() => go({ proposal: p.id })} />)}
            </ListCard>
            <LoadMore noun="decisions" shown={decided.length} total={decidedList.total} hasMore={decidedList.hasMore} loading={decidedList.isFetchingMore} onLoad={decidedList.loadMore} />
          </>
        ) : (
          <EmptyState icon={ClockCounterClockwiseIcon} title={t("No decisions yet")} body={t("Decisions on proposals appear here.")} />
        )}
      </div>

      {search.skill ? <SkillSheet key={search.skill} id={search.skill} canWrite={canWrite} onClose={() => go({ skill: undefined })} /> : null}
      {search.proposal ? <ProposalSheet key={search.proposal} id={search.proposal} canWrite={canWrite} onClose={() => go({ proposal: undefined })} /> : null}
      {teaching ? <LearnSourceDialog key={teaching} open onOpenChange={(o) => !o && setTeaching(0)} /> : null}
      {importing ? <ImportSkillDialog onClose={() => setImporting(false)} onDone={() => { setImporting(false); go({ tab: "proposals" }); }} /> : null}
      {creating ? <NewSkill key={creating} open canDecide={canPublishNew} onOpenChange={(o) => !o && setCreating(0)} /> : null}
    </Page>
  );
}

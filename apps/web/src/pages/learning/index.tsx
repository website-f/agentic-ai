import {
  ArchiveIcon,
  ArrowDownRightIcon,
  ArrowRightIcon,
  ArrowsMergeIcon,
  ArrowUpRightIcon,
  BookOpenTextIcon,
  BrainIcon,
  ChartLineIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  CoinsIcon,
  DownloadSimpleIcon,
  FlaskIcon,
  GraduationCapIcon,
  LightbulbIcon,
  ListNumbersIcon,
  PencilSimpleIcon,
  RankingIcon,
  RobotIcon,
  SealQuestionIcon,
  SparkleIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { toast } from "sonner";

import { IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Meta } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, t as tr, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  LEARNING_RANGES,
  learningKeys,
  learningOverviewQuery,
  MODE_HELP,
  setLearningMode,
  setSelfCheck,
  trajectoriesUrl,
  type LearningDecision,
  type LearningMode,
  type LearningOverview,
  type LearningRange,
} from "@/lib/learning";
import { usdShort } from "@/lib/office-data";
import { meQuery } from "@/lib/queries";
import { compact, KIND_LABEL, pct, type ProposalKind } from "@/lib/skills";
import { cn, timeAgo } from "@/lib/utils";
import { ProposalSheet } from "@/pages/skills/proposal-sheet";
import { SkillSheet } from "@/pages/skills/skill-sheet";

import { LearnSourceDialog } from "./learn-source-dialog";

const KPI_GRID = "sm:grid-cols-3 lg:grid-cols-3 2xl:grid-cols-6";
const KIND_LOOK: Record<ProposalKind, { icon: Icon; tone: Tone }> = {
  new: { icon: SparkleIcon, tone: "accent" },
  patch: { icon: PencilSimpleIcon, tone: "info" },
  merge: { icon: ArrowsMergeIcon, tone: "violet" },
  retire: { icon: ArchiveIcon, tone: "neutral" },
};
const STATUS_TONE = { pending: "warn", approved: "ok", rejected: "danger", superseded: "neutral" } as const;
const STATUS_LABEL = { pending: msg("Waiting"), approved: msg("Approved"), rejected: msg("Rejected"), superseded: msg("Replaced") } as const;
const DECIDED_BY = { pending: msg("proposed by {name}"), approved: msg("approved by {name}"), rejected: msg("rejected by {name}"), superseded: msg("replaced by {name}") } as const;
const MODE_TITLE: Record<LearningMode, string> = { review: msg("Review everything"), auto_safe: msg("Proven changes go live"), auto: msg("Clean changes go live") };
const SERIES = [
  { key: "proposed", label: msg("Skill drafts"), color: "var(--series-1)" },
  { key: "approved", label: msg("Skills switched on"), color: "var(--series-2)" },
  { key: "facts", label: msg("Facts learned"), color: "var(--series-3)" },
] as const;
const SOURCE_LABEL: Record<string, string> = { task: msg("tasks"), chat: msg("chats"), person: msg("people"), agent: msg("agents"), dream: msg("the nightly dream") };

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });
}

function evalText(e: LearningDecision["eval"]): string | null {
  if (!e) return null;
  if (e.new) return e.old
    ? tr("Tests {passed}/{total} (was {oldPassed}/{oldTotal})", { passed: e.new[0], total: e.new[1], oldPassed: e.old[0], oldTotal: e.old[1] })
    : tr("Tests {passed}/{total}", { passed: e.new[0], total: e.new[1] });
  return e.error ? tr("Tests could not run") : null;
}

/** The ways an agent comes to learn something, for empty states. */
const HOW: { icon: Icon; tone: Tone; title: string; body: string }[] = [
  { icon: ListNumbersIcon, tone: "info", title: msg("Long jobs"), body: msg("A task that took many tool calls is written up as a skill, so the next one is quicker.") },
  { icon: ChatCircleTextIcon, tone: "warn", title: msg("Corrections"), body: msg("When you send work back, the agent turns the correction into an update.") },
  { icon: WarningIcon, tone: "danger", title: msg("Failures"), body: msg("A failed attempt that was then fixed becomes a pitfall in the skill.") },
  { icon: BrainIcon, tone: "violet", title: msg("“Remember how to do this”"), body: msg("Say it in chat or on a task and the agent drafts a skill on the spot.") },
  { icon: BookOpenTextIcon, tone: "accent", title: msg("A source"), body: msg("Teach from a web page, a file or pasted notes with Teach from a source.") },
];

function HowItLearns({ className }: { className?: string }) {
  const t = useT();
  return (
    <ul className={cn("grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2", className)}>
      {HOW.map((h) => (
        <li key={h.title} className="flex min-w-0 items-start gap-3">
          <IconTile icon={h.icon} tone={h.tone} size="sm" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{t(h.title)}</span>
            <span className="block text-[12.5px] break-words text-muted">{t(h.body)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Trend({ now, prev }: { now: number | null; prev: number | null }) {
  const t = useT();
  if (now === null) return <>{t("Nothing judged yet")}</>;
  if (prev === null) return <>{t("No earlier period to compare")}</>;
  const points = Math.round((now - prev) * 100);
  if (!points) return <>{t("Same as the period before")}</>;
  const up = points > 0;
  const Arrow = up ? ArrowUpRightIcon : ArrowDownRightIcon;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-flex items-center gap-0.5 font-medium", up ? "text-ok" : "text-danger")}>
        <Arrow size={12} weight="bold" aria-hidden /> {t("{sign}{n} pts", { sign: up ? "+" : "−", n: Math.abs(points) })}
      </span>
      <span>{t("vs the period before")}</span>
    </span>
  );
}

function Kpis({ o, onWaiting }: { o: LearningOverview; onWaiting: () => void }) {
  const t = useT();
  const learned = o.proposals.approved_auto + o.proposals.approved_human;
  return (
    <StatGrid guide="learning.kpis" className={KPI_GRID}>
      <Stat label={t("Skills learned")} value={learned} icon={GraduationCapIcon} tone="accent"
        hint={learned ? t("{n} by autopilot", { n: o.proposals.approved_auto }) : t("{n} active in all", { n: o.skills.active })} />
      <Stat label={t("Waiting for review")} value={o.proposals.waiting} icon={SealQuestionIcon} tone={o.proposals.waiting ? "warn" : "neutral"}
        hint={o.proposals.waiting ? t("Open the review queue") : t("All caught up")} onClick={onWaiting} />
      <Stat label={t("Skill success")} value={pct(o.uses.success_rate)} icon={CheckCircleIcon} tone="ok"
        hint={<Trend now={o.uses.success_rate} prev={o.uses.prev_success_rate} />} />
      <Stat label={t("Facts learned")} value={o.facts.learned} icon={LightbulbIcon} tone="warn"
        hint={o.facts.replaced ? t("{n} replaced by newer ones", { n: o.facts.replaced }) : t("None replaced")} />
      <Stat label={t("Test pass rate")} value={pct(o.proposals.eval_pass_rate)} icon={FlaskIcon} tone="info"
        hint={o.proposals.eval_pass_rate === null ? t("No drafts tested yet") : t("Across tested drafts")} />
      <Stat label={t("Learning spend")} value={usdShort(o.spend.cost_usd)} icon={CoinsIcon} tone="orange"
        hint={t("{tokens} tokens, {calls} calls", { tokens: compact(o.spend.tokens), calls: o.spend.calls })} />
    </StatGrid>
  );
}

function Autopilot({ o }: { o: LearningOverview }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: setLearningMode,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: learningKeys.all });
      toast.success(r.mode === "review" ? tr("Saved. Every skill change now waits for a person.") : tr("Saved. The autopilot uses the new rule from the next change."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const value = save.isPending && save.variables ? save.variables : o.mode;
  const check = useMutation({
    mutationFn: setSelfCheck,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: learningKeys.all });
      toast.success(r.self_check ? tr("Self-check is on: work is reviewed before hand-in.") : tr("Self-check is off."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card data-guide="learning.autopilot" aria-label={t("Autopilot")} className="flex flex-col">
      <CardHeader icon={<IconTile icon={RobotIcon} tone="violet" size="sm" />} title={t("Autopilot")}
        description={t("Which learned skill changes go live without a person.")} />
      <CardBody className="grid gap-3">
        <RadioGroup.Root value={value} onValueChange={(v) => save.mutate(v as LearningMode)} disabled={!o.can_configure || save.isPending}
          aria-label={t("Autopilot mode")} className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {o.modes.map((m) => (
            <RadioGroup.Item key={m.key} value={m.key}
              className={cn(
                "group grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-[var(--radius-sm)] border border-border px-3 py-2.5 text-left transition-colors",
                "hover:bg-surface-2/60 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent",
                "data-[state=checked]:border-accent data-[state=checked]:bg-accent-soft/40",
              )}>
              <span aria-hidden className="mt-0.5 grid size-4 place-items-center rounded-full border border-border bg-surface group-data-[state=checked]:border-accent">
                <span className="size-2 rounded-full bg-accent opacity-0 group-data-[state=checked]:opacity-100" />
              </span>
              <span className="grid min-w-0 gap-0.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
                  {t(MODE_TITLE[m.key] ?? m.label)}
                  {m.key === "auto_safe" ? <Pill tone="accent" className="px-2 text-[11px] leading-[18px]">{t("Recommended")}</Pill> : null}
                </span>
                <span className="text-[12.5px] break-words text-muted">{t(MODE_HELP[m.key] ?? m.label)}</span>
              </span>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <p className="text-[12px] text-muted">
          {o.can_configure ? t("Every automatic change is versioned and can be put back from the skill's version list.") : t("Only an owner or admin can change this.")}
        </p>
        <div className="border-t border-border pt-3">
          <SwitchField
            checked={check.isPending && check.variables !== undefined ? check.variables : o.self_check}
            onCheckedChange={(v) => check.mutate(v)}
            disabled={!o.can_configure || check.isPending}
            label={t("Self-check before hand-in")}
            hint={t("A second model reads finished work against the request and the procedure. If something is missing or a number has no support, the agent fixes it once before you see it, and the lesson goes into its skills.")}
          />
        </div>
      </CardBody>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  const t = useT();
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-44 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]">
      <p className="mb-1.5 font-medium">{shortDay(String(label))}</p>
      <ul className="grid gap-1">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
            <span className="flex-1 text-muted">{t(s.label)}</span>
            <span className="font-mono tabular">{Number(payload.find((p) => p.dataKey === s.key)?.value ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DailyChart({ o }: { o: LearningOverview }) {
  const t = useT();
  const totals = useMemo(
    () => Object.fromEntries(SERIES.map((s) => [s.key, o.series.reduce((n, d) => n + d[s.key], 0)])) as Record<(typeof SERIES)[number]["key"], number>,
    [o.series],
  );
  const sources = Object.entries(o.facts.by_source).filter(([, n]) => n);
  const empty = !totals.proposed && !totals.approved && !totals.facts;
  return (
    <Card aria-label={t("Learning per day")} className="flex flex-col">
      <CardHeader icon={<IconTile icon={ChartLineIcon} tone="info" size="sm" />} title={t("Learning per day")}
        description={t("Skill drafts, skills switched on and facts learned in the last {n} days.", { n: o.days })} />
      <CardBody className="grid flex-1 content-start gap-3">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" aria-label={t("Legend")}>
          {SERIES.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3.5 rounded-full" style={{ background: s.color }} />
              {t(s.label)} <span className="font-medium tabular">{totals[s.key]}</span>
            </li>
          ))}
        </ul>
        <div className="relative h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={o.series} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-muted)" }} tickLine={false} axisLine={false} />
              <Tooltip cursor={{ stroke: "var(--color-border)" }} content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} />
              {SERIES.map((s) => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={t(s.label)} stroke={s.color} strokeWidth={2}
                  dot={o.days <= 7 ? { r: 3.5, fill: s.color, stroke: "var(--color-surface)", strokeWidth: 2 } : false}
                  activeDot={{ r: 5, stroke: "var(--color-surface)", strokeWidth: 2 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          {empty ? (
            <p className="pointer-events-none absolute inset-0 grid place-items-center text-[13px] text-muted">{t("Nothing learned in this period yet.")}</p>
          ) : null}
        </div>
        {sources.length ? (
          <p className="text-[12px] break-words text-muted">
            {t("Facts came from {list}.", { list: sources.map(([k, n]) => `${SOURCE_LABEL[k] ? t(SOURCE_LABEL[k]) : k} (${n})`).join(", ") })}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

function DecisionRow({ d, onOpen }: { d: LearningDecision; onOpen: () => void }) {
  const t = useT();
  const look = KIND_LOOK[d.kind] ?? KIND_LOOK.new;
  const ev = evalText(d.eval);
  const who = d.status !== "pending" && d.decided_by
    ? t(DECIDED_BY[d.status] ?? DECIDED_BY.approved, { name: d.decided_by })
    : t("proposed by {name}", { name: d.proposed_by });
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2/60 sm:px-5">
        <IconTile icon={look.icon} tone={look.tone} size="sm" />
        <span className="grid min-w-0 gap-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 font-mono text-[13.5px] font-medium break-all">{d.name}</span>
            <Pill tone="accent">{KIND_LABEL[d.kind] ? t(KIND_LABEL[d.kind]) : d.kind}</Pill>
            <Pill tone={STATUS_TONE[d.status] ?? "neutral"}>{STATUS_LABEL[d.status] ? t(STATUS_LABEL[d.status]) : d.status}</Pill>
            {d.auto && d.status === "approved" ? <Pill tone="info"><RobotIcon size={12} weight="fill" aria-hidden /> {t("Auto-approved")}</Pill> : null}
          </span>
          {d.note ? <span className="line-clamp-2 text-[12.5px] break-words text-fg/80">{d.note}</span>
            : d.reason ? <span className="line-clamp-2 text-[12.5px] break-words text-muted">{d.reason}</span> : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12px] text-muted sm:gap-x-1.5">
            <Meta items={[who, ev ? <span key="ev" className="tabular">{ev}</span> : null, timeAgo(d.decided_at ?? d.created_at).toLowerCase()]} />
          </span>
        </span>
      </button>
    </li>
  );
}

const RECENT_FIRST = 6;

function Recent({ o, onOpen, brief }: { o: LearningOverview; onOpen: (id: string) => void; brief?: boolean }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? o.recent : o.recent.slice(0, RECENT_FIRST);
  return (
    <Card data-guide="learning.recent" aria-label={t("Recent decisions")} className="overflow-hidden">
      <CardHeader icon={<IconTile icon={SealQuestionIcon} tone="accent" size="sm" />} title={t("Recent decisions")}
        description={t("Skill changes agents proposed, how they tested, and who switched them on.")} />
      {o.recent.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
          {shown.map((d) => <DecisionRow key={d.id} d={d} onOpen={() => onOpen(d.id)} />)}
          {o.recent.length > RECENT_FIRST ? (
            <li className="flex justify-center px-4 py-2">
              <Button size="sm" variant="ghost" className="max-sm:h-9 max-sm:w-full" onClick={() => setAll(!all)}>
                {all ? t("Show fewer") : t("Show all {n}", { n: o.recent.length })}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : brief ? (
        <p className="px-4 py-8 text-center text-[13px] text-muted sm:px-5">{t("No skill changes yet.")}</p>
      ) : (
        <CardBody className="grid gap-4">
          <p className="text-[13px] text-muted">{t("No skill changes yet. Agents learn in five ways:")}</p>
          <HowItLearns />
        </CardBody>
      )}
    </Card>
  );
}

function TopSkills({ o, onOpen }: { o: LearningOverview; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <Card aria-label={t("Top skills")} className="overflow-hidden">
      <CardHeader icon={<IconTile icon={RankingIcon} tone="ok" size="sm" />} title={t("Most used skills")} description={t("In the last {n} days.", { n: o.days })} />
      {o.top_skills.length ? (
        <table className="w-full table-fixed text-[13px]">
          <thead className="border-b border-border bg-surface-2/50 text-left text-[12px] text-muted">
            <tr>
              <th scope="col" className="py-2 pr-2 pl-4 font-medium sm:pl-5">{t("Skill")}</th>
              <th scope="col" className="w-14 px-2 py-2 text-right font-medium">{t("Uses")}</th>
              <th scope="col" className="w-[4.5rem] py-2 pr-4 pl-2 text-right font-medium sm:pr-5">{t("Success")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {o.top_skills.map((s) => (
              <tr key={s.id} className="hover:bg-surface-2/50">
                <td className="py-2.5 pr-2 pl-4 sm:pl-5">
                  <button type="button" onClick={() => onOpen(s.id)} className="grid min-w-0 text-left hover:text-accent">
                    <span className="font-mono text-[13px] font-medium break-all">{s.name}</span>
                    <span className="text-[11.5px] text-muted tabular">{t("version {n}", { n: s.version })}</span>
                  </button>
                </td>
                <td className="px-2 py-2.5 text-right tabular">{s.uses}</td>
                <td className={cn("py-2.5 pr-4 pl-2 text-right font-medium tabular sm:pr-5", s.success_rate !== null && s.success_rate < 0.7 && "text-danger")}>
                  {pct(s.success_rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-4 py-8 text-center text-[13px] text-muted sm:px-5">{t("No skill was used in this period.")}</p>
      )}
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <StatGrid className={KPI_GRID}>
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}
      </StatGrid>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-[var(--radius-md)]" />
        <Skeleton className="h-80 rounded-[var(--radius-md)]" />
      </div>
    </div>
  );
}

export function LearningPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const canWrite = me.permissions.includes("work.write");
  const canDecide = me.permissions.includes("approvals.decide");
  const canExport = me.role === "owner" || me.role === "admin";
  const search = useSearch({ strict: false }) as { days?: number };
  const navigate = useNavigate();
  const days: LearningRange = LEARNING_RANGES.find((r) => r === search.days) ?? 30;
  const { data: o, isLoading, error } = useQuery(learningOverviewQuery(days));
  const [teaching, setTeaching] = useState(0);
  const [proposal, setProposal] = useState<string | null>(null);
  const [skill, setSkill] = useState<string | null>(null);
  const quiet = o && !o.proposals.created && !o.facts.learned && !o.recent.length && !o.top_skills.length;

  return (
    <Page className="max-w-7xl">
      <PageHeader
        title={t("Learning")}
        description={t("What your agents learned, how it was checked, and what it cost.")}
        actions={
          <>
            {canExport ? (
              <Button variant="outline" size="sm" className="max-sm:h-9" asChild>
                <a href={trajectoriesUrl(90)} download title={t("Finished tasks from the last 90 days as ShareGPT conversations (JSONL). Private agents are left out and secrets are redacted.")}>
                  <DownloadSimpleIcon size={15} /> {t("Download training data")}
                </a>
              </Button>
            ) : null}
            {canWrite ? (
              <Button size="sm" className="max-sm:h-9" onClick={() => setTeaching((n) => n + 1)}><BookOpenTextIcon size={15} /> {t("Teach from a source")}</Button>
            ) : null}
          </>
        }
      />

      <Segmented
        label={t("Period")}
        value={String(days)}
        onChange={(v) => navigate({ to: "/learning", search: { days: Number(v) }, replace: true })}
        options={LEARNING_RANGES.map((r) => ({ value: String(r), label: t("{n} days", { n: r }) }))}
        className="w-fit max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center"
      />

      {isLoading ? <LoadingState /> : error || !o ? (
        <p role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">
          {t("Could not load learning.")} {errorMessage(error)}
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
          <Kpis o={o} onWaiting={() => navigate({ to: "/skills", search: { tab: "proposals" } })} />

          {quiet ? (
            <Card aria-label={t("How agents learn")}>
              <CardHeader icon={<IconTile icon={GraduationCapIcon} size="sm" />} title={t("Nothing learned in the last {n} days", { n: days })}
                description={t("Learning happens on its own as agents work. Each change is tested before it goes live.")}
                actions={canWrite ? <Button size="sm" variant="outline" onClick={() => setTeaching((n) => n + 1)}>{t("Teach from a source")} <ArrowRightIcon size={14} /></Button> : null} />
              <CardBody><HowItLearns /></CardBody>
            </Card>
          ) : null}

          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <DailyChart o={o} />
            <Autopilot o={o} />
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Recent o={o} onOpen={setProposal} brief={!!quiet} />
            <TopSkills o={o} onOpen={setSkill} />
          </div>
        </div>
      )}

      {proposal ? <ProposalSheet key={proposal} id={proposal} canDecide={canDecide} canWrite={canWrite} onClose={() => setProposal(null)} /> : null}
      {skill ? <SkillSheet key={skill} id={skill} canDecide={canDecide} canWrite={canWrite} onClose={() => setSkill(null)} /> : null}
      {teaching ? <LearnSourceDialog key={teaching} open onOpenChange={(open) => !open && setTeaching(0)} /> : null}
    </Page>
  );
}


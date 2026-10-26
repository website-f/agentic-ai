/** P45 "Week by agent": what each agent learned in one week (facts, lessons from people,
 * skills, routines and the tokens they saved), and what waits for a manager: routines still
 * learning (Trust the good ones so they run now) and skill proposals to decide. Built from
 * what the office keeps (GET /api/learning/week); no model is asked. */
import { CaretLeftIcon, CaretRightIcon, CheckCircleIcon, CoinsIcon, GraduationCapIcon, LightbulbIcon, ListChecksIcon, SealQuestionIcon, TrashIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { locale, useT } from "@/i18n";
import { tokens } from "@/lib/allowance";
import { api, errorMessage } from "@/lib/api";

export interface AgentWeek {
  id: string;
  name: string;
  role: string;
  color: string | null;
  done: number;
  facts: number;
  fact_examples: string[];
  lessons: number;
  lesson_examples: string[];
  skills_proposed: number;
  skills_approved: number;
  skill_uses: number;
  skill_accepted: number;
  routines_learned: number;
  routine_runs: number;
  tokens_saved: number;
}

export interface LearningWeek {
  week: string;
  start: string;
  end: string;
  this_week: string;
  previous: string;
  next: string | null;
  agents: AgentWeek[];
  totals: Record<"done" | "facts" | "lessons" | "skills_proposed" | "skills_approved" | "routines_learned" | "routine_runs" | "tokens_saved", number>;
  to_trust: { id: string; name: string; description: string; agent_name: string | null; baseline_tokens: number }[];
  pending_skills: number;
}

export const weekQuery = (week?: string) =>
  queryOptions({
    queryKey: ["learning", "week", week ?? "this"],
    queryFn: () => api<LearningWeek>(`/api/learning/week${week ? `?week=${encodeURIComponent(week)}` : ""}`),
    staleTime: 30_000,
  });

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "numeric", month: "short", timeZone: "UTC" });

function learnedSomething(a: AgentWeek): boolean {
  return !!(a.facts || a.lessons || a.skills_proposed || a.routines_learned || a.routine_runs || a.done);
}

export function WeekView({ week, onWeek, canManage }: { week?: string; onWeek: (w: string | undefined) => void; canManage: boolean }) {
  const t = useT();
  const q = useQuery(weekQuery(week));
  const w = q.data;
  const busy = w?.agents.filter(learnedSomething) ?? [];
  const quiet = w ? w.agents.length - busy.length : 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" disabled={!w} onClick={() => w && onWeek(w.previous)} aria-label={t("The week before")}><CaretLeftIcon size={15} /></Button>
        <span className="min-w-40 text-center text-[14px] font-semibold">
          {w ? (w.week === w.this_week ? t("This week ({from} to {to})", { from: day(w.start), to: day(w.end) }) : t("{from} to {to}", { from: day(w.start), to: day(w.end) })) : t("Loading…")}
        </span>
        <Button size="icon-sm" variant="outline" disabled={!w?.next} onClick={() => w?.next && onWeek(w.next === w.this_week ? undefined : w.next)} aria-label={t("The week after")}><CaretRightIcon size={15} /></Button>
        <span className="text-[12.5px] text-muted">{t("Every Monday morning, owners also get last week's summary as a report.")}</span>
      </div>

      {q.isLoading ? <Skeleton className="h-40 rounded-[var(--radius-md)]" /> : q.error || !w ? (
        <p role="alert" className="text-[13.5px] text-danger">{errorMessage(q.error)}</p>
      ) : (
        <>
          <StatGrid>
            <Stat label={t("Tasks finished")} value={w.totals.done} icon={ListChecksIcon} />
            <Stat label={t("Facts and lessons")} value={w.totals.facts + w.totals.lessons} icon={LightbulbIcon} tone="warn"
              hint={t("{n} lessons from people", { n: w.totals.lessons })} />
            <Stat label={t("Skills and routines learned")} value={w.totals.skills_proposed + w.totals.routines_learned} icon={GraduationCapIcon} tone="violet"
              hint={t("{n} skills approved", { n: w.totals.skills_approved })} />
            <Stat label={t("Tokens saved by routines")} value={tokens(w.totals.tokens_saved)} icon={CoinsIcon} tone="ok"
              hint={t("{n} routine runs", { n: w.totals.routine_runs })} />
          </StatGrid>

          {w.to_trust.length || w.pending_skills ? (
            <Card className="grid gap-3 p-4 sm:p-5">
              <div>
                <h3 className="text-[15px] font-semibold">{t("Waiting for you")}</h3>
                <p className="text-[13px] text-muted">{t("Routines repeat a job the way an agent learned it, without the paid AI. Trust one once you are happy with it: it starts saving tokens right away.")}</p>
              </div>
              {w.to_trust.length ? (
                <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-[var(--radius-md)] border border-border">
                  {w.to_trust.map((r) => <TrustRow key={r.id} r={r} canManage={canManage} />)}
                </ul>
              ) : null}
              {w.pending_skills ? (
                <Link to="/skills" search={{ tab: "proposals" }} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline">
                  <SealQuestionIcon size={15} /> {t("{n} skill proposals wait for a decision", { n: w.pending_skills })}
                </Link>
              ) : null}
            </Card>
          ) : null}

          {!busy.length ? (
            <EmptyState icon={GraduationCapIcon} title={t("Nothing learned this week yet")}
              body={t("Agents learn from finished tasks, from corrections when you send work back, and from what you teach them. Give them work and check back here.")} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
              {busy.map((a) => <AgentCard key={a.id} a={a} />)}
            </div>
          )}
          {quiet ? <p className="text-[12.5px] text-muted">{t("{n} other agents had a quiet week.", { n: quiet })}</p> : null}
        </>
      )}
    </div>
  );
}

function AgentCard({ a }: { a: AgentWeek }) {
  const t = useT();
  const examples = [...a.lesson_examples.map((x) => ({ x, lesson: true })), ...a.fact_examples.map((x) => ({ x, lesson: false }))];
  return (
    <Card className="grid content-start gap-3 p-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: a.color ?? "var(--accent)" }} />
        <Link to="/agents/$agentId" params={{ agentId: a.id }} className="min-w-0 truncate text-[14.5px] font-semibold hover:text-accent">{a.name}</Link>
        <span className="min-w-0 truncate text-[12.5px] text-muted">{a.role}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {a.done ? <Pill>{t("{n} tasks done", { n: a.done })}</Pill> : null}
        {a.facts ? <Pill tone="warn">{t("{n} facts", { n: a.facts })}</Pill> : null}
        {a.lessons ? <Pill tone="danger">{t("{n} lessons", { n: a.lessons })}</Pill> : null}
        {a.skills_proposed ? <Pill tone="info">{t("{n} skills", { n: a.skills_proposed })}</Pill> : null}
        {a.routines_learned ? <Pill tone="accent">{t("{n} new routines", { n: a.routines_learned })}</Pill> : null}
        {a.tokens_saved ? <Pill tone="ok">{t("{n} tokens saved", { n: tokens(a.tokens_saved) })}</Pill> : null}
      </div>
      {examples.length ? (
        <ul className="grid gap-1.5 text-[13px]">
          {examples.slice(0, 4).map(({ x, lesson }, i) => (
            <li key={i} className="flex min-w-0 items-start gap-2">
              <LightbulbIcon size={14} weight="duotone" className={lesson ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-warn"} />
              <span className="min-w-0 break-words">{x}{lesson ? <span className="text-muted"> · {t("from a person")}</span> : null}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {a.skill_uses ? (
        <p className="text-[12.5px] text-muted">{t("Used its skills {n} times; {ok} were accepted.", { n: a.skill_uses, ok: a.skill_accepted })}</p>
      ) : null}
    </Card>
  );
}

function TrustRow({ r, canManage }: { r: LearningWeek["to_trust"][number]; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (action: "trust" | "retire") => api(`/api/routines/${r.id}/${action}`, "POST", {}),
    onSuccess: (_, action) => {
      void qc.invalidateQueries({ queryKey: ["learning", "week"] });
      void qc.invalidateQueries({ queryKey: ["routines"] });
      toast.success(action === "trust" ? t("Trusted. It runs by itself from the next matching task.") : t("Retired. It will not run."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[13.5px] font-medium">{r.name}</span>
        <span className="text-[12.5px] break-words text-muted">
          {[r.agent_name, r.description, r.baseline_tokens ? t("about {n} tokens each time today", { n: tokens(r.baseline_tokens) }) : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      {canManage ? (
        <div className="flex gap-1.5">
          <Button size="sm" loading={act.isPending && act.variables === "trust"} onClick={() => act.mutate("trust")}><CheckCircleIcon size={15} /> {t("Trust")}</Button>
          <Button size="sm" variant="ghost" loading={act.isPending && act.variables === "retire"} onClick={() => act.mutate("retire")} aria-label={t("Retire {name}", { name: r.name })}><TrashIcon size={15} /> <span className="max-sm:hidden">{t("Not useful")}</span></Button>
        </div>
      ) : null}
    </li>
  );
}

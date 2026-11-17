/**
 * P109 Getting started (/getting-started): the steps for this person's role, in order, each
 * ticked from real data, from a tour they took, or by hand; the welcome tour to take (again);
 * and a short guided tour of every page they can open.
 */
import { ArrowCounterClockwiseIcon, CheckCircleIcon, CircleIcon, HandPointingIcon, PlayIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { useDoStep, useShowStep } from "@/components/getting-started-chip";
import { Page, PageHeader, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { GROUP_LABEL, gettingStartedQuery, nextStep, stepView, useSaveGettingStarted } from "@/lib/getting-started";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { startTour } from "@/tours/store";
import { pageTours, welcomeTour } from "@/tours/tours";

export function GettingStartedPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const q = useQuery(gettingStartedQuery);
  const save = useSaveGettingStarted();
  const doStep = useDoStep();
  const show = useShowStep();
  const state = q.data;
  const next = nextStep(state);
  const welcome = welcomeTour(state?.group);
  const resumeAt = state?.welcome === "started" && state.resume?.tour === welcome.id ? state.resume.step : 0;
  const tours = pageTours(me.permissions);
  const mark = (key: string, done: boolean) =>
    save.mutate({ mark: { [key]: done } }, { onError: (e) => toast.error(errorMessage(e)) });

  return (
    <Page>
      <PageHeader icon={RocketLaunchIcon} title={t("Getting started")}
        description={state ? t("Your steps as {role}, in order. Each one ticks itself when it is done.", { role: t(GROUP_LABEL[state.group]) }) : t("Your steps, in order. Each one ticks itself when it is done.")} />
      {q.isLoading ? <Skeleton className="h-72 rounded-[var(--radius-md)]" /> : !state ? (
        <Card className="p-4 text-[13.5px] text-muted">{t("Your steps could not be loaded. Try again in a moment.")}</Card>
      ) : (
        <>
          <Card data-tour="gs.progress" className="grid gap-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 text-[14px]">
              <span className="font-semibold">{state.complete ? t("All set. Well done!") : t("{done} of {total} done", { done: state.done, total: state.total })}</span>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={state.welcome === "done" || state.welcome === "skipped" ? "outline" : "primary"}
                  onClick={() => startTour(welcome.id, me.user.id, resumeAt)} className="pointer-coarse:h-11">
                  {resumeAt ? <><PlayIcon size={14} weight="fill" /> {t("Carry on with the welcome tour")}</>
                    : state.welcome === "done" ? <><ArrowCounterClockwiseIcon size={14} /> {t("Take the welcome tour again")}</>
                    : <><PlayIcon size={14} weight="fill" /> {t("Start the welcome tour")}</>}
                </Button>
                {state.dismissed ? (
                  <Button size="sm" variant="ghost" onClick={() => save.mutate({ dismissed: false })} className="pointer-coarse:h-11">{t("Show on my desk again")}</Button>
                ) : null}
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={state.total} aria-valuenow={state.done}
              aria-label={t("Getting started")}>
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((state.done / Math.max(1, state.total)) * 100)}%` }} />
            </div>
          </Card>

          <ol data-tour="gs.steps" className="grid gap-3">
            {state.steps.map((s, i) => {
              const v = stepView(s.key, me.permissions);
              const isNext = s === next;
              return (
                <li key={s.key}>
                  <Card className={cn("grid gap-3 p-4 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center", isNext && "ring-2 ring-accent/40")}>
                    {s.done
                      ? <CheckCircleIcon size={30} weight="fill" className="text-ok" aria-label={t("Done")} />
                      : <span aria-hidden className="grid size-8 place-items-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent tabular">{i + 1}</span>}
                    <div className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                        {t(v.title)}
                        {s.optional ? <Pill>{t("Optional")}</Pill> : null}
                        {isNext ? <Pill tone="accent">{t("Next")}</Pill> : null}
                        {s.by === "hand" ? <Pill tone="ok">{t("Ticked by you")}</Pill> : s.by === "tour" ? <Pill tone="ok">{t("Tour taken")}</Pill> : null}
                      </span>
                      <span className="text-[13px] text-muted">{t(v.why)}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {!s.done ? (
                        <Button size="sm" variant={isNext ? "primary" : "outline"} onClick={() => doStep(s.key)} className="pointer-coarse:h-11">{t(v.action)}</Button>
                      ) : null}
                      {v.tour ? (
                        <Button size="sm" variant="ghost" onClick={() => show(v.tour!)} className="pointer-coarse:h-11">
                          <HandPointingIcon size={14} /> {t("Show me")}
                        </Button>
                      ) : null}
                      {s.manual && s.key !== "welcome" && (s.by === null || s.by === "hand") ? (
                        <Button size="sm" variant="ghost" aria-pressed={s.by === "hand"} onClick={() => mark(s.key, s.by !== "hand")} className="pointer-coarse:h-11">
                          {s.by === "hand" ? <><CheckCircleIcon size={14} weight="fill" /> {t("Not done yet")}</> : <><CircleIcon size={14} /> {t("Mark as done")}</>}
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ol>

          <Section title={t("A tour of every page")} guide="gs.tours">
            <p className="text-[13px] text-muted">{t("Each tour opens the page and shows what it is, the key buttons, and how to do its main job. Every page also has a Show me how button next to its title.")}</p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tours.map((tour) => {
                const seen = state.tours_seen.includes(tour.id);
                return (
                  <li key={tour.id}>
                    <button type="button" onClick={() => startTour(tour.id, me.user.id)}
                      className="flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft/40">
                      <HandPointingIcon size={18} className="shrink-0 text-accent" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{t(tour.title)}</span>
                      {seen ? <Pill tone="ok">{t("Seen")}</Pill> : <span className="text-[12px] text-muted">{t("{n} steps", { n: tour.steps.length })}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Section>
        </>
      )}
    </Page>
  );
}

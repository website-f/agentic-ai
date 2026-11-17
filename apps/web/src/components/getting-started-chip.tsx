/**
 * P109 Getting started, small: a progress chip in the sidebar and the phone's More sheet, and
 * a card on My workspace, until every step for the person's role is done (or they hide it).
 */
import { ArrowRightIcon, HandPointingIcon, RocketLaunchIcon, XIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { gettingStartedQuery, nextStep, stepView, useSaveGettingStarted, type GettingStarted, type StepKey } from "@/lib/getting-started";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { startTour } from "@/tours/store";
import { welcomeTour } from "@/tours/tours";

/** The checklist while there is something left to do (undefined while loading or when done). */
export function useOpenChecklist(): GettingStarted | undefined {
  const { data: me } = useQuery(meQuery);
  const { data } = useQuery({ ...gettingStartedQuery, enabled: !!me && me.access !== "prima_only" });
  return data && !data.complete && !data.dismissed && data.total > 0 ? data : undefined;
}

/** What a step's button does: open its page, the New task box, or the welcome tour. */
export function useDoStep() {
  const navigate = useNavigate();
  const { data: me } = useQuery(meQuery);
  const { data } = useQuery({ ...gettingStartedQuery, enabled: false });
  return (key: StepKey) => {
    const v = stepView(key, me?.permissions ?? []);
    if (v.to === "compose") openTaskComposer();
    else if (v.to === "tour:welcome") {
      if (me) startTour(welcomeTour(data?.group).id, me.user.id);
    } else void navigate({ to: v.to as never, search: (v.search ?? {}) as never });
  };
}

/** "Show me": the tour of the page a step is on. */
export function useShowStep() {
  const { data: me } = useQuery(meQuery);
  return (tour: string) => (me ? startTour(tour, me.user.id) : undefined);
}

function Bar({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-surface", className)}>
      <span className="block h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
    </span>
  );
}

/** The sidebar (wide screens) and the phone's More sheet (`always`). */
export function GettingStartedChip({ always = false }: { always?: boolean }) {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const state = useOpenChecklist();
  if (!state) return null;
  const next = nextStep(state);
  return (
    <Link to="/getting-started" data-tour="gs.chip"
      className={cn("rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 px-3 py-2.5 transition-colors hover:bg-accent-soft", always ? "grid" : "mx-3 mb-2 hidden xl:grid")}>
      <span className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-accent">
        <span className="inline-flex items-center gap-1.5"><RocketLaunchIcon size={14} weight="fill" /> {t("Getting started")}</span>
        <span className="tabular">{t("{done} of {total}", { done: state.done, total: state.total })}</span>
      </span>
      <Bar done={state.done} total={state.total} className="mt-1.5" />
      {next ? <span className="mt-1.5 truncate text-[12px] text-fg/80">{t("Next: {step}", { step: t(stepView(next.key, me?.permissions ?? []).title) })}</span> : null}
    </Link>
  );
}

/** On My workspace: how far along, the next step and its buttons, until done. */
export function GettingStartedCard() {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const state = useOpenChecklist();
  const doStep = useDoStep();
  const show = useShowStep();
  const save = useSaveGettingStarted();
  if (!state) return null;
  const next = nextStep(state);
  const view = next ? stepView(next.key, me?.permissions ?? []) : undefined;
  return (
    <section data-tour="gs.card" aria-label={t("Getting started")}
      className="relative grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/35 p-4 pr-12">
      <div className="grid gap-1.5">
        <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-semibold">
          <RocketLaunchIcon size={17} weight="fill" className="text-accent" /> {t("Getting started")}
          <span className="text-[12.5px] font-medium text-muted tabular">{t("{done} of {total} done", { done: state.done, total: state.total })}</span>
        </p>
        <Bar done={state.done} total={state.total} className="max-w-md" />
      </div>
      {next && view ? (
        <div className="grid gap-2">
          <p className="text-[13.5px]"><span className="font-medium">{t("Next: {step}", { step: t(view.title) })}</span> <span className="text-muted">{t(view.why)}</span></p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => doStep(next.key)} className="pointer-coarse:h-11">{t(view.action)}</Button>
            {view.tour ? (
              <Button size="sm" variant="outline" onClick={() => show(view.tour!)} className="pointer-coarse:h-11">
                <HandPointingIcon size={14} /> {t("Show me")}
              </Button>
            ) : null}
            <Button asChild size="sm" variant="ghost" className="pointer-coarse:h-11">
              <Link to="/getting-started">{t("All steps")} <ArrowRightIcon size={13} /></Link>
            </Button>
          </div>
        </div>
      ) : null}
      <button type="button" onClick={() => save.mutate({ dismissed: true })} aria-label={t("Hide Getting started")} title={t("Hide Getting started")}
        className="absolute top-2 right-2 grid size-9 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg">
        <XIcon size={14} />
      </button>
    </section>
  );
}

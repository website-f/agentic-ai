/** P49 "Get set up" (/start): the few steps that make the office work, in order, each ticked
 * from real data, with a button to do it and an "Ask how" for help in plain words. Owners and
 * managers set up the company; staff set up their own AI. (lib/setup.ts) */
import { ArrowRightIcon, ChatCircleDotsIcon, CheckCircleIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";

import { useHelpAsk } from "@/components/help-ask";
import { Page, PageHeader } from "@/components/page";
import { openTaskComposer } from "@/components/task-composer/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { meQuery } from "@/lib/queries";
import { stepsFor, type SetupStep } from "@/lib/setup";
import { tutorialProgressQuery } from "@/lib/tutorial";
import { staffOnly } from "@/lib/twin";
import { cn } from "@/lib/utils";

export function useSetupSteps() {
  const { data: me } = useSuspenseQuery(meQuery);
  const q = useQuery(tutorialProgressQuery);
  const steps = stepsFor(staffOnly(me.permissions), me.permissions, q.data?.signals ?? {});
  const needed = steps.filter((s) => !s.optional);
  const done = needed.filter((s) => s.done).length;
  return { steps, done, total: needed.length, loading: q.isLoading, finished: !!q.data && done >= needed.length };
}

export function useDoStep() {
  const navigate = useNavigate();
  return (s: SetupStep) => (s.to === "compose" ? openTaskComposer() : void navigate({ to: s.to, search: (s.search ?? {}) as never }));
}

export function StartPage() {
  const t = useT();
  const { steps, done, total, loading, finished } = useSetupSteps();
  const doStep = useDoStep();
  const ask = useHelpAsk((s) => s.ask);
  const next = steps.find((s) => !s.done && !s.optional);
  return (
    <Page>
      <PageHeader icon={RocketLaunchIcon} title={t("Get set up")}
        description={t("A few steps and the office works for you. Each one ticks itself when it is done.")} />
      {loading ? <Skeleton className="h-72 rounded-[var(--radius-md)]" /> : (
        <>
          <Card className="grid gap-2 p-4">
            <div className="flex items-center justify-between gap-3 text-[14px]">
              <span className="font-semibold">{finished ? t("All set. Well done!") : t("{done} of {total} done", { done, total })}</span>
              {finished ? <Link to="/workspace" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent hover:underline">{t("Go to My workspace")} <ArrowRightIcon size={13} /></Link> : null}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
            </div>
          </Card>
          <ol className="grid gap-3">
            {steps.map((s, i) => (
              <li key={s.key}>
                <Card className={cn("grid gap-3 p-4 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:items-center", s === next && "ring-2 ring-accent/40")}>
                  {s.done
                    ? <CheckCircleIcon size={30} weight="fill" className="text-ok" aria-label={t("Done")} />
                    : <span aria-hidden className="grid size-8 place-items-center rounded-full bg-accent-soft text-[14px] font-semibold text-accent tabular">{i + 1}</span>}
                  <div className="grid min-w-0 gap-0.5">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
                      {t(s.title)}
                      {s.optional ? <Pill>{t("Optional")}</Pill> : null}
                      {s === next ? <Pill tone="accent">{t("Next")}</Pill> : null}
                    </span>
                    <span className="text-[13px] text-muted">{t(s.why)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!s.done ? <Button variant={s === next ? "primary" : "outline"} onClick={() => doStep(s)}>{t(s.action)}</Button> : null}
                    <Button variant="ghost" onClick={() => ask(t("How do I do this: {step}?", { step: t(s.title) }))}>
                      <ChatCircleDotsIcon size={15} /> {t("Ask how")}
                    </Button>
                  </div>
                </Card>
              </li>
            ))}
          </ol>
        </>
      )}
    </Page>
  );
}

/** In the sidebar (wide screens) until the steps are done: how far along, and the next step. */
export function SetupCard({ always = false }: { always?: boolean }) {
  const t = useT();
  const { steps, done, total, loading, finished } = useSetupSteps();
  if (loading || finished || !total) return null;
  const next = steps.find((s) => !s.done && !s.optional);
  return (
    <Link to="/start" className={cn("rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 px-3 py-2.5 transition-colors hover:bg-accent-soft", always ? "grid" : "mx-3 mb-2 hidden xl:grid")}>
      <span className="flex items-center justify-between gap-2 text-[12.5px] font-semibold text-accent">
        <span className="inline-flex items-center gap-1.5"><RocketLaunchIcon size={14} weight="fill" /> {t("Get set up")}</span>
        <span className="tabular">{t("{done} of {total}", { done, total })}</span>
      </span>
      <span className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface">
        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </span>
      {next ? <span className="mt-1.5 truncate text-[12px] text-fg/80">{t("Next: {step}", { step: t(next.title) })}</span> : null}
    </Link>
  );
}

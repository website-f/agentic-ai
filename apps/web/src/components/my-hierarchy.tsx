/**
 * P111: "My hierarchy" on My workspace. Fitri (17 Nov 2026): "in my workspace can see this my
 * hierarchy expand so see who is my higher ups". My manager first; open it to see everyone
 * above me up to the top; then me and the people who report to me. The managers above come by
 * name, job title, department and company only (the server's rule, lib/hierarchy.ts). Opens the
 * organization chart on me (Organization > Hierarchy, or a chart in a dialog for people who
 * do not open the Organization page).
 */
import { ArrowRightIcon, CaretDownIcon, CaretUpIcon, TreeStructureIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { myHierarchyQuery, placeOf, type OrgPerson } from "@/lib/hierarchy";
import type { Me } from "@/lib/types";
import { cn, initials } from "@/lib/utils";

// The chart (and the Members dialogs it uses) loads only when opened.
const OrgChartView = lazy(() => import("@/pages/org-chart").then((m) => ({ default: m.OrgChartView })));
const REPORTS_SHOWN = 8;

/** Opens the chart on me: the Organization page for those who open it, else a dialog. */
export function MyHierarchyLink({ me }: { me: Me }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (me.permissions.includes("office.view")) {
    return (
      <Link to="/organization" search={{ view: "hierarchy", focus: me.user.id } as never}
        className="hit inline-flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
        {t("Open the organization chart")} <ArrowRightIcon size={13} />
      </Link>
    );
  }
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <TreeStructureIcon size={15} /> {t("View as chart")}
      </Button>
      {open ? (
        <ResponsiveDialog open onOpenChange={setOpen} title={t("My hierarchy")} className="w-[min(94vw,72rem)]">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <OrgChartView me={me} initialFocus={me.user.id} embedded />
          </Suspense>
        </ResponsiveDialog>
      ) : null}
    </>
  );
}

function Row({ person, you, last }: { person: OrgPerson; you?: boolean; last?: boolean }) {
  const t = useT();
  const place = placeOf(person);
  return (
    <li className="relative flex min-w-0 items-start gap-3 pb-3">
      {!last ? <span aria-hidden className="absolute top-10 bottom-0 left-[19px] w-px bg-border" /> : null}
      <span aria-hidden className={cn(
        "relative grid size-10 shrink-0 place-items-center rounded-full text-[12.5px] font-semibold ring-1",
        you ? "bg-accent text-accent-fg ring-accent/30" : "bg-accent-soft text-accent ring-accent/15",
      )}>
        {initials(person.name)}
      </span>
      <span className={cn("grid min-w-0 flex-1 gap-0.5 rounded-[var(--radius-sm)] px-2 py-1", you && "bg-accent-soft/40")}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[13.5px] font-semibold">
          <span className="min-w-0 break-words">{person.name}</span>
          {you ? <span className="text-[11.5px] font-medium text-accent">{t("You")}</span> : null}
        </span>
        {person.job_title ? <span className="text-[12.5px] font-medium text-accent">{person.job_title}</span> : null}
        {place ? <span className="truncate text-[12px] text-muted" title={place}>{place}</span> : null}
      </span>
    </li>
  );
}

export function MyHierarchy() {
  const t = useT();
  const { data, isLoading, error } = useQuery(myHierarchyQuery);
  const [whole, setWhole] = useState(false);
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius-md)]" />;
  if (error || !data) {
    return <Card className="px-4 py-4 text-[13.5px] text-muted sm:px-5">{t("Could not load your hierarchy.")}</Card>;
  }
  const up = [...data.chain].reverse(); // the top first, my own manager last
  const shown = whole ? up : up.slice(-1);
  const hidden = up.length - shown.length;
  const reports = data.reports;
  if (!up.length && !reports.length) {
    return (
      <Card className="flex items-start gap-3 px-4 py-4 text-[13.5px] text-muted sm:px-5">
        <TreeStructureIcon size={20} className="mt-0.5 shrink-0 text-accent" weight="duotone" />
        <span>{t("Nobody is set above or under you yet. An owner or admin sets who reports to whom in Members.")}</span>
      </Card>
    );
  }
  return (
    <Card className="grid gap-1 px-4 py-4 sm:px-5">
      {up.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
          <span className="text-[12px] font-medium tracking-wide text-muted uppercase">
            {up.length === 1 ? t("You report to") : t("Your line of managers ({n})", { n: up.length })}
          </span>
          {up.length > 1 ? (
            <Button size="sm" variant="ghost" onClick={() => setWhole((w) => !w)} aria-expanded={whole}>
              {whole ? <CaretUpIcon size={14} /> : <CaretDownIcon size={14} />}
              {whole ? t("Show only my manager") : t("Show everyone above me ({n})", { n: hidden })}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ol aria-label={t("My hierarchy")} className="grid min-w-0">
        {shown.map((p) => <Row key={p.user_id} person={p} />)}
        <Row person={data.me} you last />
      </ol>
      {reports.length ? (
        <div className="grid gap-2 border-t border-border pt-3">
          <span className="flex items-center gap-1.5 text-[12px] font-medium tracking-wide text-muted uppercase">
            <UsersThreeIcon size={13} />
            {reports.length === 1 ? t("1 person reports to you") : t("{n} people report to you", { n: reports.length })}
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {reports.slice(0, REPORTS_SHOWN).map((p) => (
              <li key={p.user_id} className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border border-border bg-surface py-1 pr-3 pl-1">
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[10.5px] font-semibold text-accent">{initials(p.name)}</span>
                <span className="min-w-0 truncate text-[12.5px] font-medium" title={[p.name, p.job_title].filter(Boolean).join(" · ")}>{p.name}</span>
              </li>
            ))}
            {reports.length > REPORTS_SHOWN ? (
              <li className="inline-flex items-center px-2 text-[12.5px] text-muted">{t("+{n} more", { n: reports.length - REPORTS_SHOWN })}</li>
            ) : null}
          </ul>
          {data.below > reports.length ? (
            <p className="text-[12.5px] text-muted">{t("{n} people in your line in all, down every level.", { n: data.below })}</p>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

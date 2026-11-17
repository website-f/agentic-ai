import { QuestionIcon, type Icon } from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { guidePageFor } from "@/guide/lookup";
import { HubTabs } from "./hub-tabs";
import { PageTips, ShowTipsButton } from "@/components/page-tips";
import { PinPageButton } from "@/components/pin-button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { hubOf, NAV, navItemFor } from "@/nav";
import { TourButton } from "@/tours/tour-button";

import { IconTile } from "./page-parts";

export { EmptyState, IconTile, Section, TONE, type Tone } from "./page-parts";

/** The nav entry (and its section) for the current page, so every header gets its icon. */
function useNavEntry() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  let best: { section: string; icon: Icon; to: string } | null = null;
  for (const s of NAV) {
    for (const i of s.items) {
      const hit = i.to === "/" ? pathname === "/" : pathname === i.to || pathname.startsWith(`${i.to}/`);
      if (hit && (!best || i.to.length > best.to.length)) best = { section: s.title, icon: i.icon, to: i.to };
    }
  }
  return best;
}

/** The user-guide page for the current screen, if one is written. */
function useGuideEntry() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return guidePageFor(pathname);
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Defaults to the page's nav icon. Pass null for none. */
  icon?: Icon | null;
  /** Defaults to the page's nav section. */
  eyebrow?: ReactNode;
}) {
  const t = useT();
  const entry = useNavEntry();
  const guide = useGuideEntry();
  const IconCmp = icon === undefined ? entry?.icon : icon;
  const kicker = eyebrow ?? (entry ? t(entry.section) : undefined);
  return (
    <>
    <div className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        {IconCmp ? <IconTile icon={IconCmp} size="lg" className="hidden sm:grid" /> : null}
        <div className="min-w-0">
          {kicker ? (
            <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">{kicker}</p>
          ) : null}
          <div className="flex min-w-0 items-start gap-2">
            <h1 data-tour="page.title" className="min-w-0 text-[22px] leading-tight font-semibold tracking-tight text-balance break-words sm:text-[26px]">
              {title}
            </h1>
            {entry ? <ShowTipsButton path={entry.to} /> : null}
            {/* P109: a short guided tour of this page */}
            <TourButton />
            {/* P97: pin this page to the person's desk */}
            <PinPageButton title={typeof title === "string" ? title : entry ? t(navItemFor(entry.to)?.label ?? "") : ""}
              className="mt-0.5 size-7 rounded-full border border-border bg-surface pointer-coarse:size-9 sm:mt-1" />
            {guide ? (
              <Link
                to="/guide/$page"
                params={{ page: guide.id }}
                title={t("Guide: how to use {page}", { page: t(guide.title) })}
                aria-label={t("Help: how to use {page}", { page: t(guide.title) })}
                className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent pointer-coarse:size-9 sm:mt-1"
              >
                <QuestionIcon size={15} weight="bold" />
              </Link>
            ) : null}
          </div>
          {description ? <p className="mt-1 max-w-[68ch] text-[13.5px] text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div data-tour="page.actions" className="flex shrink-0 flex-wrap gap-2 max-sm:[&>*]:flex-1">{actions}</div> : null}
    </div>
    {/* P52: the other pages of this page's hub, as tabs */}
    <HubTabs />
    {/* P48: what this page is for and what to do next, for this person */}
    {entry ? <PageTips path={entry.to} /> : null}
    </>
  );
}

/** Every page: centred column, phone gutters, and one vertical rhythm between its blocks. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  // P52: the pages of one hub (tabs of one sidebar entry) share one width, so moving between
  // tabs never makes the page jump.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const entry = navItemFor(pathname);
  const inHub = !!entry && !!hubOf(entry.to);
  return (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
        wide || inHub ? "max-w-[96rem]" : "max-w-6xl",
        className,
        inHub && "max-w-[96rem]", // a page's own narrower width gives way inside a hub
      )}
    >
      {children}
    </div>
  );
}

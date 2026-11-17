/** P109 "Show me how": next to a page's title, starts that page's guided tour. */
import { HandPointingIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

import { useT } from "@/i18n";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { startTour } from "./store";
import { tourFor } from "./tours";

export function TourButton({ path, className }: { /** Default: the page open now. */ path?: string; className?: string }) {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useQuery(meQuery);
  const tour = me ? tourFor(path ?? pathname, me.permissions) : undefined;
  if (!tour || !me) return null;
  return (
    <button
      type="button"
      data-tour="page.help"
      onClick={() => startTour(tour.id, me.user.id)}
      title={t("Show me how: a short tour of {page}", { page: t(tour.title) })}
      aria-label={t("Show me how: a short tour of {page}", { page: t(tour.title) })}
      className={cn(
        "mt-0.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-2 text-[12px] font-medium text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent pointer-coarse:h-9 sm:mt-1",
        className,
      )}
    >
      <HandPointingIcon size={14} weight="bold" />
      <span className="max-sm:sr-only">{t("Show me how")}</span>
    </button>
  );
}

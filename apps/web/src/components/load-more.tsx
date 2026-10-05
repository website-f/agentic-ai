/** The foot of a lazy-loaded list: skeleton rows while the next page loads, an invisible
 * sentinel that loads it as the reader nears the bottom, and a visible "Load more" button with
 * "Showing 50 of 312" for keyboards, screen readers and anyone who prefers to click. */
import { ArrowDownIcon } from "@phosphor-icons/react";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { cn } from "@/lib/utils";

/** The nouns callers pass, so each has a Malay entry; others show as given. */
export const LOAD_MORE_NOUNS = [msg("items"), msg("tasks"), msg("files"), msg("documents"), msg("reports"), msg("meetings"), msg("broadcasts"), msg("decisions"), msg("proposals"), msg("entries"), msg("facts"), msg("runs")];

export interface LoadMoreProps {
  /** Rows on screen now. */
  shown: number;
  /** Rows matching on the server, when the endpoint counts them. */
  total?: number | null;
  hasMore: boolean;
  loading: boolean;
  onLoad: () => void;
  /** Plural noun for the count line ("tasks", "files"). */
  noun?: string;
  /** Load automatically when the sentinel scrolls into view (default on). */
  auto?: boolean;
  /** What to show while a page loads (defaults to three row skeletons). */
  skeleton?: ReactNode;
  /** Pixels before the bottom at which loading starts. */
  margin?: number;
  className?: string;
  /** Tighter layout for narrow containers such as board columns. */
  compact?: boolean;
  /** The scrolling box the list lives in, when it is not the page (a board column). */
  root?: RefObject<Element | null>;
}

export function LoadMore({ shown, total, hasMore, loading, onLoad, noun = "items", auto = true, skeleton, margin = 480, className, compact, root }: LoadMoreProps) {
  const t = useT();
  const sentinel = useRef<HTMLDivElement>(null);
  const load = useRef(onLoad);
  useEffect(() => {
    load.current = onLoad;
  });

  useEffect(() => {
    const el = sentinel.current;
    if (!auto || !hasMore || loading || !el || typeof IntersectionObserver === "undefined") return;
    // Re-created after each page: if the sentinel is still in view (a short page), the
    // observer's first callback fires at once and the next page loads too.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) load.current();
    }, { root: root?.current ?? null, rootMargin: `0px 0px ${margin}px 0px` });
    io.observe(el);
    return () => io.disconnect();
  }, [auto, hasMore, loading, margin, root]);

  const n = shown.toLocaleString(locale());
  const what = t(noun);
  const count = total != null && total >= shown ? t("Showing {shown} of {total} {noun}", { shown: n, total: total.toLocaleString(locale()), noun: what }) : t("Showing {shown} {noun}", { shown: n, noun: what });
  if (!hasMore && !loading) {
    // The whole list is on screen: only say so when it spans more than one page.
    return shown > 50 ? <p className={cn("py-2 text-center text-[12px] text-muted tabular", className)}>{t("All {n} {noun} shown", { n, noun: what })}</p> : null;
  }

  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)] gap-2", className)}>
      {loading ? (
        <div aria-hidden className="grid gap-2">
          {skeleton ?? Array.from({ length: compact ? 2 : 3 }, (_, i) => <Skeleton key={i} className={cn("rounded-[var(--radius-sm)]", compact ? "h-20" : "h-14")} />)}
        </div>
      ) : null}
      <div ref={sentinel} aria-hidden className="h-px" />
      <div className={cn("flex min-w-0 items-center justify-center gap-3", compact ? "flex-col gap-1.5 py-1" : "flex-wrap py-1 max-sm:flex-col max-sm:gap-2")}>
        <p role="status" aria-live="polite" className="min-w-0 text-center text-[12px] text-muted tabular">{loading ? t("Loading more {noun}…", { noun: what }) : count}</p>
        {hasMore ? (
          <Button variant="outline" size="sm" className={cn("min-h-9", compact ? "w-full" : "max-sm:w-full")} loading={loading} onClick={onLoad}>
            {!loading ? <ArrowDownIcon size={14} weight="bold" /> : null} {t("Load more")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

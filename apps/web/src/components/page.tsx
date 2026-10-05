import { QuestionIcon, type Icon } from "@phosphor-icons/react";
import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { guidePageFor } from "@/guide/lookup";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { NAV } from "@/nav";

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

/** A tinted square holding an icon: page headers, list rows, cards and stats share it. */
export function IconTile({
  icon: IconCmp,
  tone = "accent",
  size = "md",
  className,
}: {
  icon: Icon;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const box = size === "sm" ? "size-8" : size === "lg" ? "size-12" : "size-10";
  const glyph = size === "sm" ? 16 : size === "lg" ? 24 : 20;
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-[var(--radius-sm)] ring-1 ring-inset", TONE[tone], box, className)}
    >
      <IconCmp size={glyph} weight="duotone" />
    </span>
  );
}

export type Tone = "accent" | "ok" | "warn" | "danger" | "info" | "neutral" | "violet" | "orange" | "pink";

export const TONE: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent ring-accent/15",
  ok: "bg-ok/10 text-ok ring-ok/15",
  warn: "bg-warn/12 text-warn ring-warn/20",
  danger: "bg-danger/10 text-danger ring-danger/15",
  info: "bg-info/10 text-info ring-info/15",
  neutral: "bg-surface-2 text-muted ring-border/60",
  violet: "bg-[color-mix(in_oklab,var(--series-7)_12%,transparent)] text-[var(--series-7)] ring-[color-mix(in_oklab,var(--series-7)_20%,transparent)]",
  orange: "bg-[color-mix(in_oklab,var(--series-2)_12%,transparent)] text-[var(--series-2)] ring-[color-mix(in_oklab,var(--series-2)_20%,transparent)]",
  pink: "bg-[color-mix(in_oklab,var(--series-5)_14%,transparent)] text-[var(--series-5)] ring-[color-mix(in_oklab,var(--series-5)_22%,transparent)]",
};

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
    <div className="flex flex-col gap-4 pb-1 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3.5">
        {IconCmp ? <IconTile icon={IconCmp} size="lg" className="hidden sm:grid" /> : null}
        <div className="min-w-0">
          {kicker ? (
            <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">{kicker}</p>
          ) : null}
          <div className="flex min-w-0 items-start gap-2">
            <h1 className="min-w-0 text-[22px] leading-tight font-semibold tracking-tight text-balance break-words sm:text-[26px]">
              {title}
            </h1>
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
      {actions ? <div className="flex shrink-0 flex-wrap gap-2 max-sm:[&>*]:flex-1">{actions}</div> : null}
    </div>
  );
}

/** Every page: centred column, phone gutters, and one vertical rhythm between its blocks. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full min-w-0 flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8 lg:py-8",
        wide ? "max-w-[96rem]" : "max-w-6xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({
  icon: IconCmp,
  title,
  body,
  action,
  className,
}: {
  icon: Icon;
  title: string;
  body: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-4 overflow-hidden rounded-[var(--radius-md)] border border-dashed border-border bg-surface/60 px-6 py-12 text-center",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,var(--accent-soft),transparent_70%)] opacity-70"
      />
      <IconTile icon={IconCmp} size="lg" className="relative" />
      <div className="relative max-w-md">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="mt-1 text-[13.5px] text-muted">{body}</p>
      </div>
      {action ? <div className="relative">{action}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className,
  guide,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** data-guide id for the Guide's screenshots. */
  guide?: string;
}) {
  return (
    <section data-guide={guide} className={cn("grid min-w-0 gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description ? <p className="text-[13px] text-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

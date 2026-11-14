/**
 * P104: the plain building blocks of a page (an icon tile, an empty state, a section), kept free
 * of the navigation, tips and pins so the sign-in screens can use them without loading those.
 * `@/components/page` re-exports them; import from either.
 */
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

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
    <section data-guide={guide} className={cn("grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3", className)}>
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

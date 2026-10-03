import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

/** A surface block. `interactive` adds the hover lift used by clickable cards. */
export function Card({
  className,
  interactive,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[var(--radius-md)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]",
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-accent/40 hover:shadow-[var(--shadow-soft)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5 sm:px-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon}
        <div className="min-w-0">
          <h2 className="text-[14.5px] font-semibold">{title}</h2>
          {description ? <p className="text-[12.5px] text-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 sm:p-5", className)} {...props} />;
}

/** A bordered list with dividers; rows never push the page wider than the screen. */
export function ListCard({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul
      className={cn(
        "grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

/** One row: leading visual, title + meta, trailing slot. Wraps the trailing slot on phones. */
export function ListRow({
  leading,
  title,
  meta,
  trailing,
  onClick,
  active,
  className,
  children,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      {leading}
      <span className="grid min-w-0 gap-0.5">
        <span className="min-w-0 text-[14px] font-medium break-words max-sm:line-clamp-2 sm:truncate">{title}</span>
        {meta ? <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-muted sm:gap-x-1.5">{meta}</span> : null}
        {children}
      </span>
      {trailing ? (
        <span className={cn("flex flex-wrap items-center justify-end gap-1.5 max-sm:justify-start", leading && "max-sm:col-start-2")}>
          {trailing}
        </span>
      ) : null}
    </>
  );
  const cls = cn(
    "grid w-full items-center gap-x-3 gap-y-2 px-4 py-3 text-left",
    leading ? "grid-cols-[auto_minmax(0,1fr)_auto] max-sm:grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-[minmax(0,1fr)_auto] max-sm:grid-cols-[minmax(0,1fr)]",
    onClick && "transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2/70",
    active && "bg-accent-soft/50",
    className,
  );
  return (
    <li>
      {onClick ? (
        <button type="button" onClick={onClick} className={cls}>
          {body}
        </button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** Dot separators between metadata bits, skipping empty ones (no stray leading dots). */
export function Meta({ items }: { items: ReactNode[] }) {
  const shown = items.filter((i) => i !== null && i !== undefined && i !== false && i !== "");
  return (
    <>
      {shown.map((it, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1.5">
          {i > 0 ? <span aria-hidden className="text-muted/50 max-sm:hidden">•</span> : null}
          {it}
        </span>
      ))}
    </>
  );
}

/** Filters/search above a list or grid: one row on desktop, stacked on phones. */
export function Toolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap items-center gap-2 max-sm:[&>*]:w-full", className)} {...props} />;
}

/** Sticky footer for forms on phones (sits above the tab bar); a plain row on larger screens. */
export function ActionBar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-2",
        "max-md:sticky max-md:bottom-[calc(4.25rem+env(safe-area-inset-bottom))] max-md:z-20 max-md:-mx-4 max-md:border-t max-md:border-border max-md:bg-surface/95 max-md:px-4 max-md:py-3 max-md:backdrop-blur-md max-md:[&>*]:flex-1",
        className,
      )}
      {...props}
    />
  );
}

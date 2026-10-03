import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { IconTile, type Tone } from "@/components/page";
import { cn } from "@/lib/utils";

/** A headline number with its label; `onClick` makes it a filter shortcut. */
export function Stat({
  label,
  value,
  hint,
  icon,
  tone = "accent",
  onClick,
  active,
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: Icon;
  tone?: Tone;
  onClick?: () => void;
  active?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted">{label}</span>
        {icon ? <IconTile icon={icon} tone={tone} size="sm" /> : null}
      </div>
      <span className="text-[22px] leading-none font-semibold tracking-tight tabular sm:text-[26px]">{value}</span>
      {hint ? <span className="text-[12px] text-muted max-sm:line-clamp-1 max-sm:text-[11.5px]">{hint}</span> : null}
    </>
  );
  const cls = cn(
    "grid min-w-0 content-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left sm:p-4",
    onClick && "transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)]",
    active && "border-accent/60 ring-2 ring-accent/15",
    className,
  );
  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const pill = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium leading-5 whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-surface-2 text-muted",
        accent: "bg-accent-soft text-accent",
        ok: "bg-ok/12 text-ok",
        warn: "bg-warn/14 text-warn",
        danger: "bg-danger/12 text-danger",
        info: "bg-info/12 text-info",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface PillProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof pill> {
  /** A small leading dot, only for real live state (e.g. a service being up). */
  live?: boolean;
}

export function Pill({ className, tone, live, children, ...props }: PillProps) {
  return (
    <span className={cn(pill({ tone }), className)} {...props}>
      {live ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

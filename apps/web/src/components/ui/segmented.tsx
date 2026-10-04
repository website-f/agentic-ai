import { motion } from "motion/react";
import { useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

/** Tabs-style filter with a sliding highlight. Scrolls sideways on narrow screens instead of wrapping. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = "md",
  guide,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegmentOption<T>[];
  label: string;
  className?: string;
  size?: "sm" | "md";
  /** data-guide id for the Guide's screenshots. */
  guide?: string;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  // When the strip scrolls (phones), keep the chosen tab in view.
  useEffect(() => {
    const box = list.current;
    const tab = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!box || !tab || box.scrollWidth <= box.clientWidth) return;
    box.scrollTo({ left: tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [value]);
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      data-guide={guide}
      className={cn(
        "flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-surface-2/60 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-[calc(var(--radius-sm)-2px)] font-medium whitespace-nowrap transition-colors",
              size === "sm" ? "h-7 px-2.5 text-[12.5px] pointer-coarse:h-9" : "h-8 px-3 text-[13px] pointer-coarse:h-10",
              on ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            {on ? (
              <motion.span
                layoutId={`seg-${id}`}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className="absolute inset-0 rounded-[calc(var(--radius-sm)-2px)] bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] ring-1 ring-border"
              />
            ) : null}
            <span className="relative">{o.label}</span>
            {o.count !== undefined ? (
              <span
                className={cn(
                  "relative rounded-full px-1.5 text-[11px] tabular",
                  on ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
                )}
              >
                {o.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

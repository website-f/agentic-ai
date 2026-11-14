import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
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
  const list = useRef<HTMLDivElement>(null);
  // P104: the highlight is one element that slides with a CSS transition (it was an animation
  // library's shared layout, which the sign-in page and the shell then had to download).
  const [box, setBox] = useState<Box | null>(null);
  const labels = options.map((o) => `${o.value}:${o.label}:${o.count ?? ""}`).join("|");
  useLayoutEffect(() => {
    const tab = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!tab) {
      setBox(null);
      return;
    }
    const measure = () =>
      setBox((b) => {
        const n = { left: tab.offsetLeft, top: tab.offsetTop, width: tab.offsetWidth, height: tab.offsetHeight };
        return b && b.left === n.left && b.top === n.top && b.width === n.width && b.height === n.height ? b : n;
      });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(tab);
    if (list.current) ro.observe(list.current);
    return () => ro.disconnect();
  }, [value, labels]);
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
        "relative flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-[var(--radius-sm)] border border-border bg-surface-2/60 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {box ? (
        <span
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 rounded-[calc(var(--radius-sm)-2px)] bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] ring-1 ring-border transition-[transform,width,height] duration-200 ease-[cubic-bezier(0.2,0.9,0.3,1)] motion-reduce:transition-none"
          style={{ transform: `translate(${box.left}px, ${box.top}px)`, width: box.width, height: box.height }}
        />
      ) : null}
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

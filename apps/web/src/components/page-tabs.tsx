/** Labelled tabs across the top of a page (My workspace, Home): one clear row with an icon,
 * a label and a count, underlined when chosen. Scrolls sideways on phones instead of
 * wrapping, and keeps the chosen tab in view. */
import type { Icon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export interface PageTab<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
  count?: number;
  /** Draw the count as something waiting (amber) rather than a plain number. */
  attention?: boolean;
}

export function PageTabs<T extends string>({
  value,
  onChange,
  tabs,
  label,
  className,
  guide,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: PageTab<T>[];
  label: string;
  className?: string;
  guide?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
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
        "-mx-4 flex min-w-0 gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        const IconCmp = tab.icon;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "relative flex shrink-0 items-center gap-2 px-3 pt-2 pb-3 text-[14px] whitespace-nowrap transition-colors",
              "after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:rounded-full after:transition-colors",
              active ? "font-semibold text-fg after:bg-accent" : "text-muted after:bg-transparent hover:text-fg",
            )}
          >
            {IconCmp ? <IconCmp size={18} weight={active ? "fill" : "regular"} className={active ? "text-accent" : undefined} /> : null}
            {tab.label}
            {tab.count ? (
              <span
                className={cn(
                  "grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular",
                  tab.attention ? "bg-warn/15 text-warn" : active ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted",
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

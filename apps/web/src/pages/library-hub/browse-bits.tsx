/** Small pieces every Library folder shares: sort (newest, oldest, name), list or grid, and
 * the grid tile. The choice is each person's own, kept on this device. */
import { ListIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";

import { Select } from "@/components/ui/select";
import { msg, useT } from "@/i18n";
import { cn } from "@/lib/utils";

export type SortKey = "newest" | "oldest" | "name";
export type Layout = "list" | "grid";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "newest", label: msg("Newest first") },
  { value: "oldest", label: msg("Oldest first") },
  { value: "name", label: msg("Name A to Z") },
];

const KEY = "agentic.library.browse";

function read(): { sort: SortKey; layout: Layout } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as { sort?: string; layout?: string };
    return {
      sort: SORTS.some((s) => s.value === v.sort) ? (v.sort as SortKey) : "newest",
      layout: v.layout === "grid" ? "grid" : "list",
    };
  } catch {
    return { sort: "newest", layout: "list" };
  }
}

function write(v: { sort: SortKey; layout: Layout }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // private mode: the choice lasts until the page reloads
  }
}

export function useBrowsePrefs() {
  const [prefs, setPrefs] = useState(read);
  const set = (patch: Partial<typeof prefs>) => setPrefs((p) => {
    const next = { ...p, ...patch };
    write(next);
    return next;
  });
  return {
    sort: prefs.sort,
    layout: prefs.layout,
    setSort: (sort: SortKey) => set({ sort }),
    setLayout: (layout: Layout) => set({ layout }),
  };
}

export type BrowsePrefs = ReturnType<typeof useBrowsePrefs>;

/** Sort the loaded rows. Names compare like a file manager (2 before 10, any case). */
export function sortRows<T>(rows: T[], sort: SortKey, name: (r: T) => string, date: (r: T) => string | null | undefined): T[] {
  const out = [...rows];
  if (sort === "name") out.sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: "base" }));
  else {
    const at = (r: T) => Date.parse(date(r) ?? "") || 0;
    out.sort((a, b) => (sort === "newest" ? at(b) - at(a) : at(a) - at(b)));
  }
  return out;
}

/** Sort, and list or grid. `grid={false}` leaves out the layout switch (grouped lists). */
export function BrowseControls({ prefs, grid = true, className }: { prefs: BrowsePrefs; grid?: boolean; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <Select size="sm" value={prefs.sort} onValueChange={(v) => prefs.setSort(v as SortKey)} label={t("Sort")} className="min-w-0 flex-1 sm:w-40 sm:flex-none"
        options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))} />
      {grid ? (
        <div role="group" aria-label={t("Show as")} className="flex shrink-0 rounded-sm border border-border bg-surface-2/60 p-0.5">
          {([["list", ListIcon, msg("List")], ["grid", SquaresFourIcon, msg("Grid")]] as const).map(([value, IconCmp, label]) => {
            const on = prefs.layout === value;
            return (
              <button key={value} type="button" aria-pressed={on} title={t(label)} aria-label={t(label)} onClick={() => prefs.setLayout(value)}
                className={cn("grid size-7 place-items-center rounded-[5px] transition-colors pointer-coarse:size-9",
                  on ? "bg-surface text-accent shadow-[0_1px_2px_hsl(var(--shadow)/0.08)]" : "text-muted hover:text-fg")}>
                <IconCmp size={16} weight={on ? "bold" : "regular"} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The grid: tiles that wrap, two across on phones. */
export function TileGrid({ children, className, ...rest }: { children: ReactNode; className?: string; "data-guide"?: string }) {
  return <ul className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5", className)} {...rest}>{children}</ul>;
}

/** One tile: a big visual, the name on up to two lines, a line of facts. */
export function Tile({ leading, title, meta, badge, onClick, active, corner }: {
  leading: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  onClick: () => void;
  active?: boolean;
  /** Top-right corner, outside the button (a checkbox). */
  corner?: ReactNode;
}) {
  return (
    <li className="relative min-w-0">
      <button type="button" onClick={onClick}
        className={cn(
          "grid h-full w-full content-start gap-2.5 rounded-[var(--radius-md)] border bg-surface p-3 text-left transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)]",
          active ? "border-accent ring-2 ring-accent/20" : "border-border",
        )}>
        <span className="flex items-start justify-between gap-2 pr-6">{leading}</span>
        <span className="line-clamp-2 min-w-0 text-[13.5px] font-medium break-words">{title}</span>
        {meta ? <span className="min-w-0 truncate text-[12px] text-muted">{meta}</span> : null}
        {badge ? <span className="flex min-w-0 flex-wrap gap-1">{badge}</span> : null}
      </button>
      {corner ? <span className="absolute top-2.5 right-2.5">{corner}</span> : null}
    </li>
  );
}

/** P81: pick many rows and delete them at once (Library, SOPs). A checkbox per row, "Select
 * all" for what is listed, the count, and one "Delete N items" that sticks to the bottom of
 * the screen on phones (above the tab bar) so it is always in reach. */
import { TrashIcon, XIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { locale, useT } from "@/i18n";
import { cn } from "@/lib/utils";

export interface Selection {
  /** The picked ids that are still listed, in list order. */
  selected: string[];
  isOn: (id: string) => boolean;
  toggle: (id: string) => void;
  setAll: (on: boolean) => void;
  clear: () => void;
  all: boolean;
  some: boolean;
}

/** `ids`: what may be picked now (a filter or a refresh that hides a row also unpicks it). */
export function useSelection(ids: string[]): Selection {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());
  const selected = useMemo(() => ids.filter((id) => picked.has(id)), [ids, picked]);
  const shown = useMemo(() => new Set(ids), [ids]);
  return {
    selected,
    isOn: (id) => picked.has(id) && shown.has(id),
    toggle: (id) =>
      setPicked((p) => {
        const n = new Set(p);
        if (n.has(id)) n.delete(id);
        else n.add(id);
        return n;
      }),
    setAll: (on) => setPicked(on ? new Set(ids) : new Set()),
    clear: () => setPicked(new Set()),
    all: ids.length > 0 && selected.length === ids.length,
    some: selected.length > 0,
  };
}

/** One row's box; a bigger target on touch screens. */
export function RowCheck({ checked, onChange, label, className }: { checked: boolean; onChange: () => void; label: string; className?: string }) {
  return (
    <label className={cn("-m-2 grid shrink-0 cursor-pointer place-items-center p-2 pointer-coarse:-m-3 pointer-coarse:p-3", className)} onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="size-4 cursor-pointer accent-[var(--accent)] pointer-coarse:size-5" />
    </label>
  );
}

export function SelectAll({ sel, total }: { sel: Selection; total: number }) {
  const t = useT();
  return (
    <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-1 text-[13px] font-medium select-none max-sm:w-auto">
      <input type="checkbox" checked={sel.all} disabled={!total}
        ref={(el) => { if (el) el.indeterminate = sel.some && !sel.all; }}
        onChange={(e) => sel.setAll(e.target.checked)}
        className="size-4 cursor-pointer accent-[var(--accent)] pointer-coarse:size-5" />
      {t("Select all")}
      <span className="font-normal text-muted tabular-nums">{total.toLocaleString(locale())}</span>
    </label>
  );
}

/** Shown while something is picked. */
export function BulkBar({ sel, onDelete }: { sel: Selection; onDelete: () => void }) {
  const t = useT();
  const n = sel.selected.length;
  if (!n) return null;
  return (
    <div role="toolbar" aria-label={t("Selected")}
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 px-3 py-2",
        "max-md:sticky max-md:bottom-[calc(var(--bottom-bar,4.25rem)+env(safe-area-inset-bottom)+0.5rem)] max-md:z-20 max-md:bg-surface/95 max-md:shadow-[var(--shadow-pop)] max-md:backdrop-blur-md",
      )}>
      <span aria-live="polite" className="text-[13px] font-semibold tabular-nums">{t("{n} selected", { n: n.toLocaleString(locale()) })}</span>
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={sel.clear}><XIcon size={14} /> {t("Clear")}</Button>
      <Button size="sm" variant="danger" onClick={onDelete}>
        <TrashIcon size={14} /> {n === 1 ? t("Delete 1 item") : t("Delete {n} items", { n: n.toLocaleString(locale()) })}
      </Button>
    </div>
  );
}

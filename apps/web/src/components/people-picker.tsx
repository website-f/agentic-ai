/**
 * P97: tick many people from a long list: search by name, email or place, ticked ones first,
 * finger-sized rows. Used for "Manages" (who reports to a head of department or manager).
 */
import { CheckSquareIcon, SquareIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { PersonAvatar } from "@/components/person-avatar";
import { SearchInput } from "@/components/ui/search-input";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export interface PickPerson {
  user_id: string;
  name: string;
  /** Where they sit, their role, or who they report to now. */
  line?: string;
  /** Shown but not tickable (with why). */
  locked?: string;
}

export function PeoplePicker({ people, value, onChange, label, quick }: {
  people: PickPerson[];
  value: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
  label: string;
  /** One-tap groups ("Everyone in Finance"). */
  quick?: { label: string; ids: string[] }[];
}) {
  const t = useT();
  const [q, setQ] = useState("");
  // Ticked people first (in the order the list was opened with), then by name.
  const [first] = useState(() => new Set(value));
  const ordered = useMemo(
    () => [...people].sort((a, b) => Number(first.has(b.user_id)) - Number(first.has(a.user_id)) || a.name.localeCompare(b.name)),
    [people, first],
  );
  const needle = q.trim().toLowerCase();
  const shown = needle ? ordered.filter((p) => `${p.name} ${p.line ?? ""}`.toLowerCase().includes(needle)) : ordered;
  const toggle = (id: string) => {
    const n = new Set(value);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    onChange(n);
  };
  const tickable = shown.filter((p) => !p.locked).map((p) => p.user_id);
  const allOn = tickable.length > 0 && tickable.every((id) => value.has(id));
  return (
    <div className="grid min-w-0 gap-2">
      <SearchInput value={q} onChange={setQ} placeholder={t("Search by name or place")} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[12.5px] text-muted tabular">{value.size === 1 ? t("1 ticked") : t("{n} ticked", { n: value.size })}</span>
        {tickable.length ? (
          <button type="button" className="text-[12.5px] font-medium text-accent hover:underline"
            onClick={() => {
              const n = new Set(value);
              for (const id of tickable) {
                if (allOn) n.delete(id);
                else n.add(id);
              }
              onChange(n);
            }}>
            {allOn ? t("Untick these") : needle ? t("Tick these {n}", { n: tickable.length }) : t("Tick everyone")}
          </button>
        ) : null}
        {quick?.filter((g) => g.ids.length).map((g) => (
          <button key={g.label} type="button" className="rounded-full border border-border px-2.5 py-1 text-[12px] hover:border-accent/40 hover:text-accent"
            onClick={() => onChange(new Set([...value, ...g.ids]))}>
            + {g.label}
          </button>
        ))}
      </div>
      <ul role="group" aria-label={label} className="grid max-h-[min(24rem,55dvh)] min-w-0 divide-y divide-border overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border">
        {shown.map((p) => {
          const on = value.has(p.user_id);
          return (
            <li key={p.user_id}>
              <label className={cn("flex min-h-12 min-w-0 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-surface-2/60", on && "bg-accent-soft/40", p.locked && "cursor-not-allowed opacity-60")}>
                <input type="checkbox" className="sr-only" aria-label={p.name} checked={on} disabled={!!p.locked} onChange={() => toggle(p.user_id)} />
                {on ? <CheckSquareIcon size={20} weight="fill" className="shrink-0 text-accent" /> : <SquareIcon size={20} className="shrink-0 text-muted" />}
                <PersonAvatar name={p.name} id={p.user_id} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{p.name}</span>
                  {p.locked || p.line ? <span className="block truncate text-[11.5px] text-muted">{p.locked ?? p.line}</span> : null}
                </span>
              </label>
            </li>
          );
        })}
        {!shown.length ? <li className="px-3 py-6 text-center text-[12.5px] text-muted">{t("Nobody matches “{q}”.", { q })}</li> : null}
      </ul>
    </div>
  );
}

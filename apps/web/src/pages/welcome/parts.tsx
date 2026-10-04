/** Pieces shared by the staff onboarding (/welcome) and the staff home (/my-worker):
 * choice cards, the working-hours editor, its weekly timeline, and the duty form. */
import { CheckIcon, CoffeeIcon, LightningIcon, LockSimpleIcon, PlusIcon, TrashIcon, WarningIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Field, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { DAY_SHORT, describeHours, hoursProblem, mins, readWhen, type DutyIn, type WorkHours } from "@/lib/staff";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------ choice cards */

/** A big tappable card that reads as a radio or checkbox. */
export function ChoiceCard({
  on,
  onToggle,
  title,
  hint,
  leading,
  trailing,
  kind = "radio",
  locked,
  disabled,
}: {
  on: boolean;
  onToggle?: () => void;
  title: ReactNode;
  hint?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  kind?: "radio" | "checkbox";
  locked?: boolean;
  disabled?: boolean;
}) {
  const inert = locked || disabled || !onToggle;
  return (
    <button
      type="button"
      role={kind}
      aria-checked={on}
      aria-disabled={inert || undefined}
      onClick={inert ? undefined : onToggle}
      className={cn(
        "flex min-h-14 w-full min-w-0 items-center gap-3 rounded-[var(--radius-md)] border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow]",
        on ? "border-accent/60 bg-accent-soft/50 shadow-[var(--shadow-soft)]" : "border-border bg-surface hover:border-accent/30 hover:bg-surface-2/50",
        inert && "cursor-default hover:border-border",
        disabled && !on && "opacity-60",
      )}
    >
      {leading}
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-[14px] leading-snug font-medium break-words">{title}</span>
        {hint ? <span className="text-[12.5px] break-words text-muted">{hint}</span> : null}
      </span>
      {trailing}
      <span
        aria-hidden
        className={cn(
          "grid size-5 shrink-0 place-items-center border transition-colors",
          kind === "radio" ? "rounded-full" : "rounded-[6px]",
          on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface",
        )}
      >
        {locked ? <LockSimpleIcon size={11} weight="bold" /> : on ? <CheckIcon size={12} weight="bold" /> : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------ the week */

const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** ISO weekday (Mon=1) and minutes since midnight, now, in a time zone. */
function nowIn(tz: string): { day: number; m: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const day = DAY_SHORT.findIndex((d) => d === get("weekday")) + 1;
    return { day: day || 1, m: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
  } catch {
    const d = new Date();
    return { day: ((d.getDay() + 6) % 7) + 1, m: d.getHours() * 60 + d.getMinutes() };
  }
}

/** A week at a glance: working stretches, breaks and rest days, with "now" on today's row. */
export function WeekTimeline({ hours, className }: { hours: WorkHours; className?: string }) {
  const problem = hoursProblem(hours);
  const lo = Math.max(0, Math.floor(mins(hours.start) / 60) - 1) * 60;
  const hi = Math.min(24, Math.ceil(mins(hours.end) / 60) + 1) * 60;
  const span = Math.max(60, hi - lo);
  const pct = (m: number) => `${((Math.min(Math.max(m, lo), hi) - lo) / span) * 100}%`;
  const ticks: number[] = [];
  const step = span > 12 * 60 ? 240 : span > 8 * 60 ? 180 : 120;
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const [now] = useState(() => nowIn(hours.tz));
  const breaks = [...hours.breaks].sort((a, b) => mins(a.start) - mins(b.start));
  return (
    <div className={cn("grid min-w-0 gap-2", className)} role="img" aria-label={problem ? "Working hours are not complete" : `Works ${describeHours(hours)}`}>
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-end gap-2">
        <span />
        <div className="relative h-4 text-[10.5px] text-muted tabular">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full" style={{ left: pct(t) }}>
              {String(t / 60).padStart(2, "0")}:00
            </span>
          ))}
        </div>
      </div>
      {NAMES.map((name, i) => {
        const day = i + 1;
        const works = hours.days.includes(day) && !problem;
        const today = day === now.day;
        return (
          <div key={name} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
            <span className={cn("text-[12px] tabular", today ? "font-semibold text-fg" : "text-muted")} title={name}>
              {DAY_SHORT[i]}
            </span>
            <div className={cn("relative h-6 overflow-hidden rounded-[6px] bg-surface-2", today && "ring-1 ring-accent/40")}>
              {works ? (
                <>
                  <span className="absolute inset-y-0 rounded-[6px] bg-accent/85" style={{ left: pct(mins(hours.start)), width: `calc(${pct(mins(hours.end))} - ${pct(mins(hours.start))})` }} />
                  {breaks.map((b) => (
                    <span
                      key={b.start}
                      title={`Break ${b.start}–${b.end}`}
                      className="absolute inset-y-0 grid place-items-center bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_4px,var(--surface)_4px_8px)] text-muted"
                      style={{ left: pct(mins(b.start)), width: `calc(${pct(mins(b.end))} - ${pct(mins(b.start))})` }}
                    >
                      {mins(b.end) - mins(b.start) >= 45 ? <CoffeeIcon size={12} weight="bold" /> : null}
                    </span>
                  ))}
                </>
              ) : (
                <span className="absolute inset-0 grid place-items-center text-[11px] text-muted">Rest day</span>
              )}
              {today && now.m >= lo && now.m <= hi ? (
                <span aria-hidden className="absolute inset-y-0 w-0.5 bg-fg/70" style={{ left: pct(now.m) }} />
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[3rem] text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-accent/85" /> Working</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[repeating-linear-gradient(135deg,var(--surface-2)_0_2px,var(--border)_2px_4px)]" /> Break</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-0.5 bg-fg/70" /> Now</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ the hours editor */

const PRESETS: { label: string; days: number[]; start: string; end: string; breaks: { start: string; end: string }[] }[] = [
  { label: "Office week", days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "14:00" }] },
  { label: "Early shift", days: [1, 2, 3, 4, 5], start: "08:00", end: "17:00", breaks: [{ start: "12:00", end: "13:00" }] },
  { label: "Six days", days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "14:00" }] },
  { label: "Every day", days: [1, 2, 3, 4, 5, 6, 7], start: "09:00", end: "21:00", breaks: [{ start: "13:00", end: "14:00" }] },
];

const ZONES = [
  "Asia/Kuala_Lumpur",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Bangkok",
  "Asia/Manila",
  "Asia/Hong_Kong",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

function zones(current: string): string[] {
  const mine = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "";
    }
  })();
  return [...new Set([current, mine, ...ZONES].filter(Boolean))];
}

export function HoursEditor({ value, onChange, name }: { value: WorkHours; onChange: (v: WorkHours) => void; name: string }) {
  const set = (patch: Partial<WorkHours>) => onChange({ ...value, ...patch });
  const toggleDay = (d: number) => set({ days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b) });
  const problem = hoursProblem(value);
  const setBreak = (i: number, k: "start" | "end", v: string) => set({ breaks: value.breaks.map((b, j) => (j === i ? { ...b, [k]: v } : b)) });
  const addBreak = () => {
    const last = value.breaks[value.breaks.length - 1];
    const s = last ? Math.min(mins(last.end) + 120, mins(value.end) - 30) : 13 * 60;
    const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    set({ breaks: [...value.breaks, { start: hh(s), end: hh(Math.min(s + 15, mins(value.end))) }] });
  };
  const active = PRESETS.find((p) => p.start === value.start && p.end === value.end && p.days.join() === value.days.join() && JSON.stringify(p.breaks) === JSON.stringify(value.breaks));
  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid gap-2">
        <span className="text-[13px] font-medium">Quick start</span>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={active === p}
              onClick={() => set({ days: p.days, start: p.start, end: p.end, breaks: p.breaks })}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors",
                active === p ? "border-accent/50 bg-accent-soft text-accent" : "border-border bg-surface hover:border-accent/30",
              )}
            >
              {active === p ? <CheckIcon size={13} weight="bold" /> : null}
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-[13px] font-medium">Working days</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {DAY_SHORT.map((d, i) => {
            const on = value.days.includes(i + 1);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={NAMES[i]}
                onClick={() => toggleDay(i + 1)}
                className={cn(
                  "grid h-11 min-w-0 place-items-center rounded-sm border text-[13px] font-medium transition-colors",
                  on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface text-muted hover:border-accent/40",
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts at" type="time" step={300} value={value.start} onChange={(e) => set({ start: e.target.value || value.start })} />
        <Field label="Finishes at" type="time" step={300} value={value.end} onChange={(e) => set({ end: e.target.value || value.end })} />
      </div>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] font-medium">Lunch and breaks</span>
          {value.breaks.length < 4 ? (
            <Button type="button" variant="outline" size="sm" onClick={addBreak}>
              <PlusIcon size={14} weight="bold" /> Add a break
            </Button>
          ) : null}
        </div>
        {value.breaks.length ? (
          <ul className="grid gap-2">
            {value.breaks.map((b, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
                <Field label={i === 0 ? "From" : "From"} type="time" step={300} value={b.start} onChange={(e) => setBreak(i, "start", e.target.value || b.start)} />
                <Field label="Until" type="time" step={300} value={b.end} onChange={(e) => setBreak(i, "end", e.target.value || b.end)} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove this break" onClick={() => set({ breaks: value.breaks.filter((_, j) => j !== i) })}>
                  <TrashIcon size={16} />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">No breaks: it works straight through.</p>
        )}
      </div>
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">Time zone</span>
        <Select label="Time zone" className="w-full" value={value.tz} onValueChange={(tz) => set({ tz })} options={zones(value.tz).map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} />
      </div>
      <div className="rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3.5">
        <SwitchField
          checked={value.urgent_anytime}
          onCheckedChange={(v) => set({ urgent_anytime: v })}
          label="May work outside hours for urgent tasks"
          hint={`Anything marked urgent starts right away, even at night. Everything else waits until ${name} is back.`}
        />
      </div>
      {problem ? (
        <p role="alert" className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          <WarningIcon size={16} className="mt-0.5 shrink-0" /> {problem}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ duties */

/** The value after the person stops typing for a moment. */
export function useDebounced<T>(value: T, ms = 400): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return out;
}

export const EMPTY_DUTY: DutyIn = { title: "", brief: "", when: "", urgent: false };

/** One recurring duty: what, when (plain words, read back as you type), urgent. */
export function DutyForm({ value, onChange, urgentAllowed }: { value: DutyIn; onChange: (d: DutyIn) => void; urgentAllowed: boolean }) {
  const text = useDebounced(value.when.trim());
  const read = useQuery({
    queryKey: ["me", "worker", "when", text],
    queryFn: () => readWhen(text),
    enabled: text.length >= 3,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
  const r = text.length >= 3 ? read.data : undefined;
  return (
    <div className="grid min-w-0 gap-3">
      <Field label="Duty" value={value.title} maxLength={160} placeholder="e.g. Weekly aging report" onChange={(e) => onChange({ ...value, title: e.target.value })} />
      <div className="grid gap-1.5">
        <Field
          label="When"
          value={value.when}
          maxLength={200}
          placeholder="e.g. every Monday at 9am"
          onChange={(e) => onChange({ ...value, when: e.target.value })}
          aria-describedby="duty-when-read"
        />
        <p id="duty-when-read" aria-live="polite" className={cn("min-h-[1.25rem] text-[12.5px]", r && !r.ok ? "text-warn" : "text-muted")}>
          {r ? (r.ok ? <span className="inline-flex items-center gap-1 text-ok"><CheckIcon size={13} weight="bold" /> Runs {r.summary}</span> : r.question) : "Say it in plain words: every weekday at 8am, every 1st of the month at 9am."}
        </p>
      </div>
      <TextareaField label="What to do (optional)" rows={2} maxLength={4000} value={value.brief} onChange={(e) => onChange({ ...value, brief: e.target.value })} placeholder="The steps or the result you expect." />
      <SwitchField
        checked={value.urgent}
        onCheckedChange={(v) => onChange({ ...value, urgent: v })}
        label="Urgent"
        hint={urgentAllowed ? "Runs on time even outside working hours." : "Marked urgent. It still waits for working hours unless you allow urgent work any time."}
      />
    </div>
  );
}

/** Whether the duty form can be added: a title and words the server read as a repeating time. */
export function useDutyReady(d: DutyIn): boolean {
  const text = useDebounced(d.when.trim());
  const read = useQuery({
    queryKey: ["me", "worker", "when", text],
    queryFn: () => readWhen(text),
    enabled: text.length >= 3,
    staleTime: 60_000,
  });
  return d.title.trim().length > 0 && text === d.when.trim() && !!read.data?.ok;
}

export function UrgentPill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-danger/12 px-2 py-0.5 text-[11.5px] font-medium text-danger">
      <LightningIcon size={11} weight="fill" /> Urgent
    </span>
  );
}

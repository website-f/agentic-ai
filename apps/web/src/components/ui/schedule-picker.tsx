/**
 * The schedule picker (P55): "when should this run?" without a cron line. How often (once,
 * every day, weekdays, chosen days of the week, a day of the month, every few hours), then
 * the date and time with our own pickers. It says the result in plain words ("Every Monday
 * and Thursday at 9:00 am") with the next runs, as the server will run them.
 *
 * Usage: `const when = useSchedulePicker({ cron, once })`, `<SchedulePicker state={when} />`,
 * then save `when.value` ({ cron, once, firstDate }) unless `when.problem` says what is missing.
 * A schedule whose cron the picker cannot show keeps it, read-only, until someone replaces it.
 */
import { CalendarCheckIcon, CaretRightIcon } from "@phosphor-icons/react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useId, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

import { locale, msg, t as tNow, useT } from "@/i18n";
import { api } from "@/lib/api";
import { useDebounced } from "@/lib/paged";
import { meQuery } from "@/lib/queries";
import {
  defaultPlan,
  describePlan,
  EVERY_HOURS,
  parseCron,
  planToCron,
  WEEK_ORDER,
  weekdayName,
  type Frequency,
  type SchedulePlan,
} from "@/lib/teams";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { addDays, DatePicker } from "./date-picker";
import { Select } from "./select";
import { SwitchField } from "./switch";
import { formatClock, TimePicker } from "./time-picker";

export interface ScheduleValue {
  cron: string;
  /** Runs once, then switches itself off. */
  once: boolean;
  /** Once: the day it runs ("YYYY-MM-DD", in the schedule's time zone). */
  firstDate?: string;
}

export interface ScheduleState {
  /** null: a cron line the picker cannot show; it is kept as it is (`custom`). */
  plan: SchedulePlan | null;
  setPlan: (plan: SchedulePlan | null) => void;
  custom: string | null;
  value: ScheduleValue;
  /** What to fix before saving, in words; null when it can be saved. */
  problem: string | null;
  /** The next runs (ISO), as the server reads the schedule; `pending` while they catch up. */
  next: string[];
  pending: boolean;
  tz: string | undefined;
}

const FREQS: { value: Frequency; label: string }[] = [
  { value: "once", label: msg("Once") },
  { value: "daily", label: msg("Every day") },
  { value: "weekdays", label: msg("Weekdays (Mon–Fri)") },
  { value: "weekly", label: msg("Every week") },
  { value: "monthly", label: msg("Every month") },
  { value: "hourly", label: msg("Every few hours") },
];

/** "YYYY-MM-DD HH:MM" now, in a time zone (the browser's when unknown or invalid). */
function nowIn(tz: string | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { ...opts, timeZone: tz }).formatToParts(new Date());
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", opts).formatToParts(new Date());
  }
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? "00";
  return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}`;
}

/** A next-run time for people: "Mon, 3 Nov, 9:00 am", on the schedule's clock. */
function runLabel(iso: string, tz: string | undefined): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  try {
    return new Date(iso).toLocaleString(locale(), { ...opts, timeZone: tz });
  } catch {
    return new Date(iso).toLocaleString(locale(), opts);
  }
}

/** The picker can show it (and so save it back unchanged). */
const pickable = (p: SchedulePlan | null): p is SchedulePlan => !!p && p.freq !== "yearly" && !(p.freq === "monthly" && p.monthDay > 28);

function planProblem(p: SchedulePlan, tz: string | undefined): string | null {
  if (p.freq === "weekly" && !p.days.length) return tNow("Pick at least one day.");
  if (p.freq === "hourly" && p.window && p.window[0] >= p.window[1]) return tNow("The end time must be after the start time.");
  if (p.freq === "once") {
    if (!p.date) return tNow("Pick a date.");
    if (`${p.date} ${p.time}` <= nowIn(tz)) return tNow("That time has already passed. Pick a later one.");
  }
  return null;
}

/**
 * The picker's state, kept by the form that saves it. `cron`/`once`: the schedule being edited
 * (none: a new one, weekdays at 9:00 am). `after`: when reading a one-off back, the date it
 * means is the first one after this (default now). `tz`: the schedule's time zone (default the
 * workspace's). `active`: false while the picker is not shown (no preview calls).
 */
export function useSchedulePicker({ cron, once = false, after, tz, active = true }: { cron?: string; once?: boolean; after?: Date; tz?: string; active?: boolean } = {}): ScheduleState {
  const t = useT();
  const { data: me } = useQuery(meQuery);
  const zone = tz ?? me?.workspace.timezone;
  const [custom] = useState(() => (cron && !pickable(parseCron(cron, once, after)) ? cron : null));
  const [plan, setPlan] = useState<SchedulePlan | null>(() => {
    if (!cron) return defaultPlan();
    const read = parseCron(cron, once, after);
    return pickable(read) ? read : null;
  });
  const value: ScheduleValue = plan
    ? { cron: planToCron(plan), once: plan.freq === "once", ...(plan.freq === "once" ? { firstDate: plan.date } : {}) }
    : { cron: custom ?? cron ?? "", once };
  const sent = useDebounced(value.cron, 300);
  const preview = useQuery({
    queryKey: ["cron-preview", sent, zone ?? ""],
    queryFn: () =>
      api<{ ok: boolean; next: string[]; error?: string }>(
        `/api/schedules/preview?cron=${encodeURIComponent(sent)}${zone ? `&tz=${encodeURIComponent(zone)}` : ""}`,
      ),
    enabled: active && sent.split(" ").length === 5,
    placeholderData: keepPreviousData,
  });
  const fresh = sent === value.cron && !preview.isPlaceholderData;
  const settled = fresh ? preview.data : undefined;
  let problem = plan ? planProblem(plan, zone) : null;
  if (!problem && settled?.ok === false) problem = settled.error ?? t("That timing does not work. Pick another.");
  // A one-off's cron has no year: when its next run is not on the picked day, that day has gone.
  if (!problem && plan?.freq === "once" && settled?.next[0] && settled.next[0].slice(0, 10) !== plan.date) {
    problem = t("That time has already passed. Pick a later one.");
  }
  const next = preview.data?.ok ? preview.data.next : [];
  return { plan, setPlan, custom, value, problem, next, pending: !fresh || preview.isFetching, tz: zone };
}

function Chip({ on, children, ...props }: { on: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...props}
      className={cn(
        "h-9 rounded-full border px-3.5 text-[13px] whitespace-nowrap transition-colors pointer-coarse:h-11",
        "focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none",
        on ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:border-accent/40",
        props.className,
      )}>
      {children}
    </button>
  );
}

function Part({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      {htmlFor ? <label htmlFor={htmlFor} className="text-[13px] font-medium">{label}</label> : <span className="text-[13px] font-medium">{label}</span>}
      {children}
      {hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function SchedulePicker({ state, allowOnce = true, className }: { state: ScheduleState; allowOnce?: boolean; className?: string }) {
  const t = useT();
  const id = useId();
  const { plan, setPlan, custom, problem, next, pending, tz } = state;
  const [today] = useState(() => nowIn(tz).slice(0, 10));

  const summary = (
    <div aria-live="polite" className="grid min-w-0 gap-1 rounded-[var(--radius-md)] border border-border bg-surface-2/40 px-3.5 py-2.5">
      <p className="flex min-w-0 items-start gap-2 text-[13.5px] font-medium">
        <CalendarCheckIcon size={16} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
        <span className="min-w-0 break-words">{plan ? describePlan(plan, true) : t("Custom timing")}</span>
      </p>
      {problem ? (
        <p role="alert" className="text-[12.5px] text-danger">{problem}</p>
      ) : next.length ? (
        <p className={cn("text-[12.5px] text-muted transition-opacity", pending && "opacity-50")}>
          {state.value.once
            ? t("Runs {when}, then switches itself off.", { when: runLabel(next[0] ?? "", tz) })
            : t("Next: {times}", { times: next.slice(0, 3).map((n) => runLabel(n, tz)).join(" · ") })}
        </p>
      ) : null}
      {tz ? <p className="text-[12px] text-muted">{t("Times are in {tz}.", { tz })}</p> : null}
    </div>
  );

  if (!plan) {
    // A cron line made elsewhere that the picker cannot show: it keeps running as it is.
    return (
      <div className={cn("grid min-w-0 gap-3", className)}>
        {summary}
        <p className="text-[12.5px] text-muted">{t("This schedule has a timing the picker cannot show. It keeps running as it is until you replace it.")}</p>
        <details className="group rounded-[var(--radius-md)] border border-border">
          <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 px-3 text-[13px] font-medium select-none pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
            <CaretRightIcon size={12} weight="bold" className="transition-transform group-open:rotate-90" /> {t("Advanced")}
          </summary>
          <div className="grid gap-1.5 border-t border-border px-3 py-2.5">
            <p className="text-[12px] text-muted">{t("As the scheduler reads it (minute, hour, day, month, weekday):")}</p>
            <code className="block rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-[13px] break-all">{custom}</code>
          </div>
        </details>
        <Button variant="outline" className="justify-self-start max-sm:w-full pointer-coarse:h-11" onClick={() => setPlan(defaultPlan())}>
          {t("Replace with a simple schedule")}
        </Button>
      </div>
    );
  }

  const patch = (p: Partial<SchedulePlan>) => setPlan({ ...plan, ...p });
  const time = (
    <Part label={t("Time")} htmlFor={`${id}-time`}>
      <TimePicker id={`${id}-time`} label={t("Time")} value={plan.time} onChange={(time) => patch({ time })} />
    </Part>
  );
  const hourOptions = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: formatClock(h, plan.minute) }));
  return (
    // A container: the parts sit side by side once the picker itself is wide enough, wherever it is.
    <div className={cn("@container grid min-w-0 gap-3.5", className)}>
      <div role="radiogroup" aria-label={t("How often")} className="flex min-w-0 flex-wrap gap-1.5">
        {FREQS.filter((f) => allowOnce || f.value !== "once").map((f) => (
          <Chip key={f.value} role="radio" aria-checked={plan.freq === f.value} on={plan.freq === f.value} onClick={() => patch({ freq: f.value })}>
            {t(f.label)}
          </Chip>
        ))}
      </div>
      {custom ? (
        <button type="button" onClick={() => setPlan(null)} className="-mt-1.5 min-h-9 justify-self-start rounded-sm text-[12.5px] text-muted underline-offset-2 hover:text-fg hover:underline">
          {t("Keep the original timing")}
        </button>
      ) : null}

      {plan.freq === "once" ? (
        <div className="grid min-w-0 gap-3 @sm:grid-cols-2">
          <Part label={t("Date")} htmlFor={`${id}-date`}>
            <DatePicker id={`${id}-date`} label={t("Date")} value={plan.date || null} onChange={(date) => patch({ date })}
              today={today} min={today} max={addDays(today, 364)} />
          </Part>
          {time}
        </div>
      ) : null}

      {plan.freq === "daily" || plan.freq === "weekdays" ? <div className="grid min-w-0 gap-3 @sm:grid-cols-2">{time}</div> : null}

      {plan.freq === "weekly" ? (
        <>
          <Part label={t("On these days")}>
            <div role="group" aria-label={t("On these days")} className="grid grid-cols-4 gap-1.5 @sm:grid-cols-7">
              {WEEK_ORDER.map((d) => {
                const picked = plan.days.includes(d);
                return (
                  <button key={d} type="button" aria-pressed={picked} aria-label={weekdayName(d)}
                    onClick={() => patch({ days: picked ? plan.days.filter((x) => x !== d) : [...plan.days, d] })}
                    className={cn(
                      "h-10 min-w-0 truncate rounded-sm border px-1 text-[13px] transition-colors pointer-coarse:h-11",
                      "focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none",
                      picked ? "border-accent bg-accent-soft font-medium text-accent" : "border-border bg-surface hover:border-accent/40",
                    )}>
                    {weekdayName(d, "short")}
                  </button>
                );
              })}
            </div>
          </Part>
          <div className="grid min-w-0 gap-3 @sm:grid-cols-2">{time}</div>
        </>
      ) : null}

      {plan.freq === "monthly" ? (
        <div className="grid min-w-0 gap-3 @sm:grid-cols-2">
          <Part label={t("Day of the month")} hint={t("Up to the 28th, so it runs in every month.")}>
            <Select label={t("Day of the month")} value={String(plan.monthDay)} onValueChange={(v) => patch({ monthDay: Number(v) })} className="pointer-coarse:h-11"
              options={Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: t("Day {day}", { day: i + 1 }) }))} />
          </Part>
          {time}
        </div>
      ) : null}

      {plan.freq === "hourly" ? (
        <div className="grid min-w-0 gap-3.5">
          <div className="grid min-w-0 gap-3 @sm:grid-cols-2">
            <Part label={t("How often")}>
              <Select label={t("How often")} value={String(plan.every)} onValueChange={(v) => patch({ every: Number(v) })} className="pointer-coarse:h-11"
                options={EVERY_HOURS.map((n) => ({ value: String(n), label: n === 1 ? t("Every hour") : t("Every {n} hours", { n }) }))} />
            </Part>
          </div>
          <SwitchField checked={!!plan.window} onCheckedChange={(v) => patch({ window: v ? [9, 17] : null })}
            label={t("Only during working hours")} hint={plan.window ? undefined : t("Off: around the clock.")} />
          {plan.window ? (
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <Part label={t("From")}>
                <Select label={t("From")} value={String(plan.window[0])} className="pointer-coarse:h-11"
                  onValueChange={(v) => patch({ window: [Number(v), plan.window?.[1] ?? 17] })} options={hourOptions.slice(0, 23)} />
              </Part>
              <Part label={t("Until")}>
                <Select label={t("Until")} value={String(plan.window[1])} className="pointer-coarse:h-11"
                  onValueChange={(v) => patch({ window: [plan.window?.[0] ?? 9, Number(v)] })} options={hourOptions.slice(1)} />
              </Part>
            </div>
          ) : null}
          <SwitchField checked={plan.weekdaysOnly} onCheckedChange={(weekdaysOnly) => patch({ weekdaysOnly })}
            label={t("Weekdays only")} hint={t("Monday to Friday.")} />
        </div>
      ) : null}

      {summary}
    </div>
  );
}

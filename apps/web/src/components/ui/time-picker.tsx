/**
 * Our own time picker (P55): quick times (8:00, 9:00, 12:00, 17:00), then the hour and the
 * minute in 5-minute steps, as big buttons a thumb can hit. 12 or 24 hours, as the app's
 * language reads a clock ("9:00 am", "9:00 PG"). Values are "HH:MM" (24 hours).
 */
import { CaretDownIcon, ClockIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";

import { locale, useT } from "@/i18n";
import { cn } from "@/lib/utils";

import { Button } from "./button";
import { PICKER_TRIGGER, PickerPanel } from "./date-picker";

const pad = (n: number) => String(n).padStart(2, "0");
const QUICK: [number, number][] = [[8, 0], [9, 0], [12, 0], [17, 0]];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function split(value: string): [number, number] {
  const [h, m] = (value || "09:00").split(":").map(Number);
  return [Math.min(23, Math.max(0, h || 0)), Math.min(59, Math.max(0, m || 0))];
}

/** "9:00 am" in the app's language. */
export function formatClock(h: number, m: number): string {
  return new Intl.DateTimeFormat(locale(), { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

/** Whether the app's language reads a 12-hour clock, and its words for morning and afternoon. */
function clockStyle(): { h12: boolean; am: string; pm: string } {
  const f = new Intl.DateTimeFormat(locale(), { hour: "numeric", minute: "2-digit" });
  const period = (h: number) => f.formatToParts(new Date(2000, 0, 1, h)).find((p) => p.type === "dayPeriod")?.value;
  return { h12: !!f.resolvedOptions().hour12, am: period(9) ?? "AM", pm: period(21) ?? "PM" };
}

const CELL =
  "h-10 min-w-0 rounded-sm text-[14px] tabular transition-colors pointer-coarse:h-11 " +
  "focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none";
const on = (yes: boolean) => (yes ? "bg-accent font-semibold text-accent-fg" : "bg-surface-2/60 hover:bg-surface-2");

export function TimePicker({
  value,
  onChange,
  label,
  id,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** What the field is for ("Time"): names the trigger and titles the sheet. */
  label: string;
  id?: string;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [h, m] = split(value);
  const { h12, am, pm } = clockStyle();
  const set = (hh: number, mm: number) => onChange(`${pad(hh)}:${pad(mm)}`);
  const afternoon = h >= 12;
  const hours = h12 ? [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] : Array.from({ length: 24 }, (_, i) => i);
  const hourOf = (label: number) => (h12 ? (label % 12) + (afternoon ? 12 : 0) : label);
  const shown = formatClock(h, m);
  const ids = useId();
  return (
    <PickerPanel open={open} onOpenChange={setOpen} title={label} initialFocus="[data-picked-hour]"
      trigger={
        <button type="button" id={id} aria-label={t("{label}: {value}", { label, value: shown })} className={cn(PICKER_TRIGGER, className)}>
          <ClockIcon size={16} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1 truncate tabular">{shown}</span>
          <CaretDownIcon size={14} className="shrink-0 text-muted" />
        </button>
      }>
      <div className="grid min-w-0 gap-3.5">
        <div role="group" aria-label={t("Quick times")} className="grid grid-cols-4 gap-1.5">
          {QUICK.map(([qh, qm]) => (
            <button key={qh} type="button" aria-pressed={h === qh && m === qm}
              onClick={() => { set(qh, qm); setOpen(false); }}
              className={cn("h-9 min-w-0 truncate rounded-full border px-1 text-[12.5px] font-medium tabular transition-colors pointer-coarse:h-11",
                h === qh && m === qm ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface hover:border-accent/40")}>
              {formatClock(qh, qm)}
            </button>
          ))}
        </div>

        <div role="group" aria-labelledby={`${ids}-h`} className="grid min-w-0 gap-1.5">
          <div className="flex min-h-9 items-center justify-between gap-2">
            <span id={`${ids}-h`} className="text-[12.5px] font-medium text-muted">{t("Hour")}</span>
            {h12 ? (
              <div role="group" aria-label={t("Morning or afternoon")} className="flex gap-0.5 rounded-sm border border-border bg-surface-2/60 p-0.5">
                {[false, true].map((pmSide) => (
                  <button key={String(pmSide)} type="button" aria-pressed={afternoon === pmSide}
                    onClick={() => afternoon !== pmSide && set(pmSide ? h + 12 : h - 12, m)}
                    className={cn("h-8 min-w-11 rounded-[calc(var(--radius-sm)-2px)] px-2.5 text-[12.5px] font-medium transition-colors pointer-coarse:h-10",
                      afternoon === pmSide ? "bg-surface text-fg shadow-[0_1px_2px_hsl(var(--shadow)/0.12)] ring-1 ring-border" : "text-muted hover:text-fg")}>
                    {pmSide ? pm : am}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-6 gap-1">
            {hours.map((n) => (
              <button key={n} type="button" aria-pressed={hourOf(n) === h} aria-label={formatClock(hourOf(n), m)} data-picked-hour={hourOf(n) === h || undefined}
                onClick={() => set(hourOf(n), m)} className={cn(CELL, on(hourOf(n) === h))}>
                {h12 ? n : pad(n)}
              </button>
            ))}
          </div>
        </div>

        <div role="group" aria-labelledby={`${ids}-m`} className="grid min-w-0 gap-1.5">
          <span id={`${ids}-m`} className="text-[12.5px] font-medium text-muted">{t("Minute")}</span>
          <div className="grid grid-cols-6 gap-1">
            {MINUTES.map((n) => (
              <button key={n} type="button" aria-pressed={n === m} aria-label={formatClock(h, n)}
                onClick={() => set(h, n)} className={cn(CELL, on(n === m))}>
                :{pad(n)}
              </button>
            ))}
          </div>
        </div>

        <Button className="w-full pointer-coarse:h-11" onClick={() => setOpen(false)}>{t("Done")}</Button>
      </div>
    </PickerPanel>
  );
}

/**
 * Our own date picker (P55): a month grid, Monday first, month and day names in the app's
 * language. A small panel under the field on tablet/desktop, a bottom sheet on phones (thumb
 * reach, the safe area kept clear). Keyboard: arrows move a day or a week, Home/End go to the
 * week's ends, Page Up/Down a month (with Shift a year), Enter or Space picks.
 *
 * Dates are plain "YYYY-MM-DD" strings: a calendar day, no time zone attached.
 */
import { CalendarBlankIcon, CaretDownIcon, CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react";
import { Dialog, Popover } from "radix-ui";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { locale, useT } from "@/i18n";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "YYYY-MM-DD" → a local Date at midnight. */
export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 2000, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  return toIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** The same day n months on (the 31st becomes the month's last day). */
function addMonths(iso: string, n: number): string {
  const d = fromIso(iso);
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return toIso(new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last)));
}

const within = (iso: string, min?: string, max?: string) => (!min || iso >= min) && (!max || iso <= max);
const clampDay = (iso: string, min?: string, max?: string) => (min && iso < min ? min : max && iso > max ? max : iso);
/** 0 = Monday … 6 = Sunday. */
const mondayIndex = (d: Date) => (d.getDay() + 6) % 7;

/** A panel under its trigger on tablet/desktop; a bottom sheet on phones. Used by the date and time pickers. */
export function PickerPanel({
  open,
  onOpenChange,
  title,
  trigger,
  children,
  initialFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  trigger: ReactNode;
  children: ReactNode;
  /** A selector inside the panel that gets focus when it opens (e.g. the picked day). */
  initialFocus?: string;
}) {
  const t = useT();
  const phone = useIsPhone();
  const focusFirst = (e: Event) => {
    const el = initialFocus ? (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(initialFocus) : null;
    if (el) {
      e.preventDefault();
      el.focus();
    }
  };
  if (phone) {
    // A Radix dialog (not a second vaul drawer), so it stacks cleanly over the sheet it opens from.
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
          <Dialog.Content
            aria-describedby={undefined}
            onOpenAutoFocus={focusFirst}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] max-w-[100vw] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none data-[state=open]:animate-[dialog-in_180ms_cubic-bezier(0.16,1,0.3,1)]"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" />
            <div className="flex min-w-0 shrink-0 items-center justify-between gap-3 pt-1 pr-2 pl-5">
              <Dialog.Title className="min-w-0 truncate text-base font-semibold">{title}</Dialog.Title>
              <Dialog.Close className="grid size-11 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg" aria-label={t("Close")}>
                <XIcon size={18} />
              </Dialog.Close>
            </div>
            <div className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-1 pb-4">{children}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          aria-label={title}
          onOpenAutoFocus={focusFirst}
          // Fits the room left on screen; it scrolls inside rather than running off the edge.
          className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(calc(100vw-1rem),19.5rem)] overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-surface p-3 shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The trigger every picker shares: looks like the app's inputs, 44px tall on touch screens. */
export const PICKER_TRIGGER =
  "inline-flex h-10 w-full min-w-0 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-left text-sm text-fg " +
  "transition-colors hover:bg-surface-2 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none " +
  "data-[state=open]:border-accent disabled:opacity-60 pointer-coarse:h-11";

/** A month grid. `today` is the calendar day it calls today (the schedule's time zone, say). */
export function Calendar({
  value,
  onChange,
  min,
  max,
  today,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  today?: string;
}) {
  const t = useT();
  const [now] = useState(() => today ?? toIso(new Date()));
  // The focused day drives everything: the month shown is the one it is in.
  const [focus, setFocus] = useState(() => clampDay(value ?? now, min, max));
  const grid = useRef<HTMLDivElement>(null);
  const byKey = useRef(false);
  useEffect(() => {
    // Keyboard moves: move the real focus too (clicking prev/next month leaves it on the button).
    if (!byKey.current) return;
    byKey.current = false;
    grid.current?.querySelector<HTMLElement>(`[data-day="${focus}"]`)?.focus();
  }, [focus]);

  const lang = locale();
  const first = fromIso(focus.slice(0, 8) + "01");
  const lead = mondayIndex(first);
  // Six rows always, so the grid does not jump under a thumb when the month changes.
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), i - lead + 1);
    return d.getMonth() === first.getMonth() ? toIso(d) : null;
  });
  const weekHead = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i)); // 1 Jan 2024: a Monday
  const prevEnd = addDays(focus.slice(0, 8) + "01", -1);
  const nextStart = addMonths(focus.slice(0, 8) + "01", 1);
  const go = (iso: string) => setFocus(clampDay(iso, min, max));

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const d = fromIso(focus);
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1),
      ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      Home: () => addDays(focus, -mondayIndex(d)),
      End: () => addDays(focus, 6 - mondayIndex(d)),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    byKey.current = true;
    go(move());
  };

  const nav = "grid size-10 place-items-center rounded-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-35 pointer-coarse:size-11";
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className={nav} aria-label={t("Previous month")} disabled={!!min && prevEnd < min} onClick={() => go(addMonths(focus, -1))}>
          <CaretLeftIcon size={16} weight="bold" />
        </button>
        <p aria-live="polite" className="min-w-0 truncate text-[14px] font-semibold capitalize">
          {first.toLocaleDateString(lang, { month: "long", year: "numeric" })}
        </p>
        <button type="button" className={nav} aria-label={t("Next month")} disabled={!!max && nextStart > max} onClick={() => go(addMonths(focus, 1))}>
          <CaretRightIcon size={16} weight="bold" />
        </button>
      </div>
      <div ref={grid} role="grid" aria-label={first.toLocaleDateString(lang, { month: "long", year: "numeric" })} className="grid min-w-0 gap-0.5">
        <div role="row" className="grid grid-cols-7 gap-0.5">
          {weekHead.map((d) => (
            <span key={d.getDay()} role="columnheader" aria-label={d.toLocaleDateString(lang, { weekday: "long" })}
              className="truncate py-1 text-center text-[11.5px] font-medium text-muted">
              {d.toLocaleDateString(lang, { weekday: "short" })}
            </span>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} role="row" className="grid grid-cols-7 gap-0.5">
            {cells.slice(row * 7, row * 7 + 7).map((iso, i) => {
              if (!iso) return <span key={`x${i}`} role="gridcell" aria-hidden className="h-10 pointer-coarse:h-11" />;
              const picked = iso === value;
              const isToday = iso === now;
              return (
                <button
                  key={iso}
                  type="button"
                  role="gridcell"
                  data-day={iso}
                  tabIndex={iso === focus ? 0 : -1}
                  aria-selected={picked}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={fromIso(iso).toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  disabled={!within(iso, min, max)}
                  onKeyDown={onKey}
                  onFocus={() => setFocus(iso)}
                  onClick={() => onChange(iso)}
                  className={cn(
                    "relative h-10 min-w-0 rounded-sm text-[14px] tabular transition-colors pointer-coarse:h-11",
                    "focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none disabled:pointer-events-none disabled:text-muted/45",
                    picked ? "bg-accent font-semibold text-accent-fg" : "hover:bg-surface-2",
                    isToday && !picked && "font-semibold text-accent",
                  )}
                >
                  {Number(iso.slice(8))}
                  {isToday ? <span aria-hidden className={cn("absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full", picked ? "bg-accent-fg" : "bg-accent")} /> : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {within(now, min, max) ? (
        <button type="button" onClick={() => onChange(now)}
          className="h-9 justify-self-start rounded-sm px-2.5 text-[13px] font-medium text-accent hover:bg-accent-soft pointer-coarse:h-11">
          {t("Today")}
        </button>
      ) : null}
    </div>
  );
}

/** A date field: shows the picked day, opens the calendar. */
export function DatePicker({
  value,
  onChange,
  label,
  min,
  max,
  today,
  id,
  className,
}: {
  value: string | null;
  onChange: (iso: string) => void;
  /** What the field is for ("Date"): names the trigger and titles the sheet. */
  label: string;
  min?: string;
  max?: string;
  today?: string;
  id?: string;
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const shown = value ? fromIso(value).toLocaleDateString(locale(), { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : t("Pick a date");
  return (
    <PickerPanel open={open} onOpenChange={setOpen} title={label} initialFocus='[data-day][tabindex="0"]'
      trigger={
        <button type="button" id={id} aria-label={t("{label}: {value}", { label, value: shown })} className={cn(PICKER_TRIGGER, className)}>
          <CalendarBlankIcon size={16} className="shrink-0 text-muted" />
          <span className={cn("min-w-0 flex-1 truncate", !value && "text-muted")}>{shown}</span>
          <CaretDownIcon size={14} className="shrink-0 text-muted" />
        </button>
      }>
      <Calendar value={value} min={min} max={max} today={today} onChange={(d) => { onChange(d); setOpen(false); }} />
    </PickerPanel>
  );
}

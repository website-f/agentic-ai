/**
 * P98: searchable selects for long lists (branches, departments, people, roles).
 *
 * - `SearchSelect`: pick one. A button that opens a list with a search box on top.
 * - `MultiSelect`: pick many. The picked ones show as chips (each with its own remove button);
 *   the list stays open while you tick, with "Pick all shown" / "Clear" and a count.
 *
 * Both type to filter (name, hint and keywords; accents and case ignored), move with the arrow
 * keys, pick with Enter, close with Escape, and open as a bottom sheet on a phone. Built on cmdk
 * (the command palette's list) and Radix Popover / Dialog for focus and layering, so they work
 * inside dialogs and sheets. An optional `action` row at the end (always shown) runs something
 * else, such as "+ New department".
 */
import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { Command } from "cmdk";
import { Dialog, Popover } from "radix-ui";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { useT } from "@/i18n";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";

export interface PickOption {
  value: string;
  label: string;
  /** A second line: where they sit, what the role does. Searched too. */
  hint?: string;
  disabled?: boolean;
  /** More words that find this option (an email, a code). */
  keywords?: string[];
  /** A heading the option is listed under. */
  group?: string;
}

interface PickAction {
  label: string;
  /** Gets what was typed (handy as the new item's name). */
  onSelect: (typed: string) => void;
}

interface BaseProps {
  options: PickOption[];
  /** The field's name: the button's accessible name and the sheet's title. */
  label: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  /** A row after the options, always shown (not filtered). */
  action?: PickAction;
  id?: string;
}

/** Lower case, no accents, single spaces: "Café  Ops" and "cafe ops" match. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** The options that match every typed word (in the label, hint or keywords). */
export function filterOptions(options: PickOption[], query: string): PickOption[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return options;
  return options.filter((o) => {
    const hay = fold([o.label, o.hint ?? "", ...(o.keywords ?? [])].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

const TRIGGER =
  "inline-flex w-full max-w-full min-w-0 items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 text-left text-fg hover:bg-surface-2 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-60";

const ITEM =
  "relative flex min-h-11 min-w-0 cursor-default items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] outline-none select-none data-[selected=true]:bg-surface-2 data-[disabled=true]:opacity-50 sm:min-h-9";

/** The open list: a popover under the button, or a bottom sheet on a phone. */
function Popup({ open, onOpenChange, label, trigger, children }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  label: string;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const phone = useIsPhone();
  if (phone) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
          <Dialog.Content
            data-testid="pick-sheet"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[85dvh] max-w-[100vw] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-border" />
            <div className="flex min-w-0 shrink-0 items-center gap-2 pt-2 pr-2 pl-4">
              <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">{label}</Dialog.Title>
              <Dialog.Close className="grid size-11 shrink-0 place-items-center rounded-full text-muted active:bg-surface-2" aria-label={t("Close")}>
                <XIcon size={18} />
              </Dialog.Close>
            </div>
            {children}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange} modal>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          aria-label={label}
          className="z-[60] flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-[max(var(--radix-popover-trigger-width),18rem)] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-pop)] outline-none"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The search box and the list, shared by both selects. */
function PickList({ label, options, query, onQuery, searchPlaceholder, emptyText, isPicked, onPick, action, header, footer }: {
  label: string;
  options: PickOption[];
  query: string;
  onQuery: (q: string) => void;
  searchPlaceholder?: string;
  emptyText?: string;
  isPicked: (v: string) => boolean;
  onPick: (o: PickOption) => void;
  action?: PickAction;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  const shown = filterOptions(options, query);
  // Options keep their order; a group heading is shown where its first option is.
  const groups: { name: string; items: PickOption[] }[] = [];
  for (const o of shown) {
    const name = o.group ?? "";
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.items.push(o);
    else groups.push({ name, items: [o] });
  }
  return (
    <Command shouldFilter={false} loop label={label} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3">
        <MagnifyingGlassIcon size={15} className="shrink-0 text-muted" aria-hidden />
        <Command.Input
          autoFocus
          value={query}
          onValueChange={onQuery}
          placeholder={searchPlaceholder ?? t("Type to search")}
          aria-label={searchPlaceholder ?? t("Type to search")}
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] text-fg outline-none placeholder:text-muted sm:h-10 sm:text-[13.5px]"
        />
        {query ? (
          <button type="button" aria-label={t("Clear search")} onClick={() => onQuery("")}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg">
            <XIcon size={13} />
          </button>
        ) : null}
      </div>
      {header}
      <Command.List className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1 [scrollbar-width:thin]">
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted">{emptyText ?? t("Nothing matches.")}</p>
        ) : null}
        {groups.map((g, gi) => (
          <Command.Group key={`${g.name}-${gi}`} heading={g.name || undefined}
            className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-[0.06em] [&_[cmdk-group-heading]]:text-muted [&_[cmdk-group-heading]]:uppercase">
            {g.items.map((o) => {
              const on = isPicked(o.value);
              return (
                <Command.Item key={o.value} value={o.value} disabled={o.disabled} onSelect={() => onPick(o)}
                  aria-checked={on} data-picked={on || undefined} className={ITEM}>
                  <span aria-hidden className={cn("grid size-4 shrink-0 place-items-center rounded-[4px]", on ? "bg-accent text-accent-fg" : "border border-border")}>
                    {on ? <CheckIcon size={11} weight="bold" /> : null}
                  </span>
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate">{o.label}</span>
                    {o.hint ? <span className="line-clamp-2 text-[12px] break-words text-muted">{o.hint}</span> : null}
                  </span>
                </Command.Item>
              );
            })}
          </Command.Group>
        ))}
        {action ? (
          <Command.Item value="__action__" onSelect={() => action.onSelect(query.trim())} className={cn(ITEM, "font-medium text-accent")}>
            <PlusIcon size={14} weight="bold" className="shrink-0" /> <span className="truncate">{action.label}</span>
          </Command.Item>
        ) : null}
      </Command.List>
      {footer}
    </Command>
  );
}

/** Opens on ArrowDown/Enter/Space like a select, and on a typed letter (which starts the search). */
function openKeys(setOpen: (o: boolean) => void, setQuery: (q: string) => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setQuery(e.key);
      setOpen(true);
    }
  };
}

/** Pick one, with a search box. Same props as Select, plus search and an optional action row. */
export function SearchSelect({ value, onValueChange, options, label, placeholder, searchPlaceholder, emptyText, disabled, size = "md", className, action, id }: BaseProps & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const t = useT();
  const [open, setOpenRaw] = useState(false);
  const [query, setQuery] = useState("");
  const setOpen = (o: boolean) => {
    setOpenRaw(o);
    if (!o) setQuery("");
  };
  const current = options.find((o) => o.value === value);
  const trigger = (
    <button type="button" id={id} disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      onKeyDown={openKeys(setOpen, setQuery)}
      className={cn(TRIGGER, size === "sm" ? "h-8 text-[13px]" : "h-10 text-sm", className)}>
      <span className={cn("min-w-0 truncate", !current && "text-muted")}>{current ? current.label : placeholder ?? t("Pick one")}</span>
      <CaretDownIcon size={14} className="shrink-0 text-muted" aria-hidden />
    </button>
  );
  return (
    <Popup open={open} onOpenChange={setOpen} label={label} trigger={trigger}>
      <PickList label={label} options={options} query={query} onQuery={setQuery} searchPlaceholder={searchPlaceholder} emptyText={emptyText}
        isPicked={(v) => v === value}
        onPick={(o) => { onValueChange(o.value); setOpen(false); }}
        action={action ? { label: action.label, onSelect: (typed) => { setOpen(false); action.onSelect(typed); } } : undefined} />
    </Popup>
  );
}

/** Pick many: chips for the picked ones, a list that stays open while you tick. */
export function MultiSelect({ value, onValueChange, options, label, placeholder, searchPlaceholder, emptyText, disabled, size = "md", className, action, id, maxChips = 6, locked }: BaseProps & {
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Chips shown before "+N more". */
  maxChips?: number;
  /** Values that cannot be removed here (shown without a remove button), with why. */
  locked?: Record<string, string>;
}) {
  const t = useT();
  const [open, setOpenRaw] = useState(false);
  const [query, setQuery] = useState("");
  const setOpen = (o: boolean) => {
    setOpenRaw(o);
    if (!o) setQuery("");
  };
  const byValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const picked = new Set(value);
  const toggle = (v: string) => {
    if (locked?.[v] && picked.has(v)) return;
    onValueChange(picked.has(v) ? value.filter((x) => x !== v) : [...value, v]);
  };
  const shown = filterOptions(options, query).filter((o) => !o.disabled);
  const allShownOn = shown.length > 0 && shown.every((o) => picked.has(o.value));
  const chips = value.slice(0, maxChips);
  const more = value.length - chips.length;
  const nameOf = (v: string) => byValue.get(v)?.label ?? v;
  const opener = openKeys(setOpen, setQuery);
  const trigger = (
    <button type="button" id={id} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
      aria-label={value.length ? t("{label}: {n} picked. Change", { label, n: value.length }) : label}
      onKeyDown={opener}
      className={cn("inline-flex min-h-8 min-w-24 flex-1 items-center justify-between gap-1 rounded-sm px-1.5 text-left text-muted hover:text-fg focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-60",
        size === "sm" ? "text-[13px]" : "text-[13.5px]")}>
      <span className="min-w-0 truncate">{value.length ? t("Add or remove") : placeholder ?? t("Pick one or more")}</span>
      <CaretDownIcon size={14} className="shrink-0" aria-hidden />
    </button>
  );
  return (
    <div className={cn("flex min-h-10 w-full max-w-full min-w-0 flex-wrap items-center gap-1 rounded-sm border border-border bg-surface p-1", disabled && "opacity-60", className)}
      role="group" aria-label={label}>
      {chips.map((v) => (
        <span key={v} className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2.5 text-[12.5px] font-medium text-accent">
          <span className="min-w-0 truncate">{nameOf(v)}</span>
          {locked?.[v] ? (
            <span className="sr-only">{locked[v]}</span>
          ) : (
            <button type="button" disabled={disabled} aria-label={t("Remove {name}", { name: nameOf(v) })} onClick={() => toggle(v)}
              className="grid size-6 shrink-0 place-items-center rounded-full hover:bg-accent/15 sm:size-5">
              <XIcon size={11} weight="bold" />
            </button>
          )}
        </span>
      ))}
      {more > 0 ? <span className="px-1 text-[12.5px] text-muted tabular">{t("+{n} more", { n: more })}</span> : null}
      <Popup open={open} onOpenChange={setOpen} label={label} trigger={trigger}>
        <PickList label={label} options={options} query={query} onQuery={setQuery} searchPlaceholder={searchPlaceholder} emptyText={emptyText}
          isPicked={(v) => picked.has(v)} onPick={(o) => toggle(o.value)}
          action={action ? { label: action.label, onSelect: (typed) => { setOpen(false); action.onSelect(typed); } } : undefined}
          header={
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[12.5px]">
              <span className="text-muted tabular" aria-live="polite">{value.length === 1 ? t("1 picked") : t("{n} picked", { n: value.length })}</span>
              {shown.length ? (
                <button type="button" className="font-medium text-accent hover:underline"
                  onClick={() => {
                    const ids = shown.map((o) => o.value);
                    if (allShownOn) onValueChange(value.filter((v) => !ids.includes(v) || !!locked?.[v]));
                    else onValueChange([...value, ...ids.filter((v) => !picked.has(v))]);
                  }}>
                  {allShownOn ? t("Unpick these") : query ? t("Pick these {n}", { n: shown.length }) : t("Pick all")}
                </button>
              ) : null}
              {value.length ? (
                <button type="button" className="font-medium text-muted hover:text-fg hover:underline"
                  onClick={() => onValueChange(value.filter((v) => !!locked?.[v]))}>
                  {t("Clear")}
                </button>
              ) : null}
            </div>
          }
          footer={
            <div className="flex shrink-0 justify-end border-t border-border px-3 py-2">
              <button type="button" onClick={() => setOpen(false)}
                className="inline-flex h-9 items-center rounded-sm bg-accent px-4 text-[13px] font-medium text-accent-fg hover:opacity-90">
                {t("Done")}
              </button>
            </div>
          } />
      </Popup>
    </div>
  );
}

/** P109b the Microsoft 365 workspace, full screen (Fitri, 17 Nov 2026: "when clicked do a full
 * screen page with a back button just for it"): no office side menu or top bar, a clear Back
 * (to where the person came from), its own tabs (on top on a wide screen, at the bottom on a
 * phone, like an app), and the actions of the open tab on the right. Esc goes back too when no
 * dialog is open. Arrow keys move between the tabs. */
import { ArrowLeftIcon, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export interface FrameTab<T extends string> {
  value: T;
  label: string;
  icon: Icon;
  /** A small number on the tab (unread, waiting). */
  count?: number | null;
}

export function M365Frame<T extends string>({ title, tabs, value, onChange, onBack, actions, switcher, children }: {
  title: string;
  /** P118: which of the person's Microsoft accounts is shown, beside the title. */
  switcher?: ReactNode;
  tabs: FrameTab<T>[];
  value: T;
  onChange: (v: T) => void;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const main = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);
  // A new tab starts at its top.
  useEffect(() => {
    main.current?.scrollTo?.({ top: 0 });
  }, [value]);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg pt-[env(safe-area-inset-top)]" data-m365-frame="">
      <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-1.5 sm:gap-3 sm:px-4">
        <Button variant="ghost" onClick={onBack} title={t("Back (Esc)")} className="h-11 shrink-0 gap-1.5 px-2.5 text-fg sm:h-10">
          <ArrowLeftIcon size={19} /> <span className="max-sm:sr-only">{t("Back")}</span>
        </Button>
        <h1 className="min-w-0 shrink truncate text-[15.5px] font-semibold tracking-tight max-sm:sr-only">{title}</h1>
        {switcher}
        <div className="hidden min-w-0 flex-1 justify-center md:flex">
          <Tabs tabs={tabs} value={value} onChange={onChange} label={title} variant="top" />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0">{actions}</div>
      </header>
      <div ref={main} id="m365-main" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto grid w-full max-w-[1400px] min-w-0 content-start gap-4 px-4 pt-4 pb-8 sm:px-6 sm:pt-5 md:pb-10">
          {children}
        </div>
      </div>
      <nav className="shrink-0 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden" aria-label={title}>
        <Tabs tabs={tabs} value={value} onChange={onChange} label={title} variant="bottom" />
      </nav>
    </div>
  );
}

function Tabs<T extends string>({ tabs, value, onChange, label, variant }: {
  tabs: FrameTab<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  variant: "top" | "bottom";
}) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = tabs.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to]!.value);
    refs.current[to]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={variant === "top" ? "flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]" : "grid"}
      style={variant === "bottom" ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}>
      {tabs.map((tab, i) => {
        const on = tab.value === value;
        const count = tab.count && tab.count > 0 ? (tab.count > 99 ? "99+" : String(tab.count)) : null;
        return (
          <button key={tab.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            data-variant={variant}
            onClick={() => onChange(tab.value)} onKeyDown={(e) => onKey(e, i)}
            aria-label={count ? t("{label}, {n} new", { label: tab.label, n: count }) : undefined}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 font-medium transition-colors focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none",
              variant === "top"
                ? cn("h-9 shrink-0 rounded-full px-3.5 text-[13.5px]", on ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")
                : cn("min-h-14 min-w-0 flex-col gap-0.5 px-1 py-1.5 text-[11.5px]", on ? "text-accent" : "text-muted"),
            )}>
            <tab.icon size={variant === "top" ? 16 : 21} weight={on ? "fill" : "regular"} className="shrink-0" />
            <span className="max-w-full truncate">{tab.label}</span>
            {count ? (
              <span aria-hidden className={cn("rounded-full bg-accent px-1.5 text-[10.5px] leading-4 font-semibold text-accent-fg tabular",
                variant === "bottom" && "absolute top-1 left-1/2 ml-2")}>{count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

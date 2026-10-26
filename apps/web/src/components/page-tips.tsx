/** P48 "What to do here": a short panel under each page title saying what the page is for and
 * the next steps, for the person reading it (staff or a manager). Hidden per page with ×,
 * brought back with the lightbulb next to the title. Remembered on this device only. */
import { LightbulbIcon, XIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { create } from "zustand";

import { useT } from "@/i18n";
import { tipFor, type Audience } from "@/lib/page-tips";
import { meQuery } from "@/lib/queries";
import { staffOnly } from "@/lib/twin";

const KEY = "agentic.tips.hidden";

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface TipsState {
  hidden: string[];
  toggle: (path: string) => void;
}

const useTips = create<TipsState>((set, get) => ({
  hidden: read(),
  toggle: (path) => {
    const now = get().hidden.includes(path) ? get().hidden.filter((p) => p !== path) : [...get().hidden, path];
    try {
      localStorage.setItem(KEY, JSON.stringify(now));
    } catch {
      /* storage blocked: it still hides for this visit */
    }
    set({ hidden: now });
  },
}));

function useAudience(): Audience {
  const { data: me } = useSuspenseQuery(meQuery);
  return staffOnly(me.permissions) ? "staff" : "manager";
}

/** The panel itself (nothing when the page has no tip, or the person hid it). */
export function PageTips({ path }: { path: string }) {
  const t = useT();
  const tip = tipFor(path, useAudience());
  const hidden = useTips((s) => s.hidden.includes(path));
  const toggle = useTips((s) => s.toggle);
  if (!tip || hidden) return null;
  return (
    <section aria-label={t("What to do here")}
      className="relative flex min-w-0 items-start gap-3 rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/35 px-4 py-3 pr-11">
      <LightbulbIcon size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
      <div className="grid min-w-0 gap-1.5">
        <p className="text-[13.5px] font-medium">{t(tip.what)}</p>
        {tip.steps.length ? (
          <ol className="grid gap-1 text-[13px] text-fg/85">
            {tip.steps.map((s, i) => (
              <li key={s} className="flex min-w-0 gap-2">
                <span aria-hidden className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-surface text-[11px] font-semibold text-accent tabular ring-1 ring-accent/25">{i + 1}</span>
                <span className="min-w-0">{t(s)}</span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
      <button type="button" onClick={() => toggle(path)} aria-label={t("Hide these tips")} title={t("Hide these tips")}
        className="absolute top-2 right-2 grid size-8 place-items-center rounded-sm text-muted hover:bg-surface hover:text-fg">
        <XIcon size={14} />
      </button>
    </section>
  );
}

/** Next to the title: brings the tips back once hidden (nothing while they show). */
export function ShowTipsButton({ path }: { path: string }) {
  const t = useT();
  const tip = tipFor(path, useAudience());
  const hidden = useTips((s) => s.hidden.includes(path));
  const toggle = useTips((s) => s.toggle);
  if (!tip || !hidden) return null;
  return (
    <button type="button" onClick={() => toggle(path)} title={t("Show what to do here")} aria-label={t("Show what to do here")}
      className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-border bg-surface text-muted transition-colors hover:border-accent/40 hover:bg-accent-soft hover:text-accent pointer-coarse:size-9 sm:mt-1">
      <LightbulbIcon size={15} weight="bold" />
    </button>
  );
}

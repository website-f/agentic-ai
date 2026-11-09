/** P73: the panels the floating button opens besides the screenshot: write feedback without a
 * screenshot, the rules and guide for the page you are on, and what you sent with the answers. */
import {
  CameraIcon,
  ChatTeardropTextIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  EyeIcon,
  GavelIcon,
  LockKeyIcon,
  MapTrifoldIcon,
  PaperPlaneTiltIcon,
  ScalesIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  UsersThreeIcon,
  XIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { CATEGORIES, categoryOf, myFeedbackQuery, screenshotUrl, statusOf, type FeedbackCategory, type HouseRule } from "@/lib/feedback";
import { useIsPhone } from "@/lib/use-media";
import { cn, timeAgo } from "@/lib/utils";

/** A panel docked on the right (a tall sheet on phones) over a dimmed page. P93: on a phone the
 * sheet is a share of the layer, which follows what can be seen: with the on-screen keyboard up it
 * takes all of the room above it, its middle scrolls and the footer (Send) stays in sight. */
export function Panel({ title, sub, icon: I, onClose, children, footer }: { title: string; sub?: string; icon: Icon; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const t = useT();
  const phone = useIsPhone();
  return (
    <div className="absolute inset-0 flex justify-end bg-neutral-950/45 backdrop-blur-[2px]" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <motion.section
        initial={phone ? { y: 60 } : { x: 60 }}
        animate={{ x: 0, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
        className={cn(
          "flex flex-col bg-surface shadow-[var(--shadow-pop)]",
          phone ? "mt-auto h-[88%] max-h-full w-full rounded-t-[var(--radius-lg)] border-t border-border pb-[env(safe-area-inset-bottom)] in-data-[visible=part]:h-full in-data-[visible=part]:pb-0" : "h-full w-[min(100vw,27rem)] border-l border-border",
        )}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 pt-4 pb-3.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent-soft text-accent ring-1 ring-accent/15">
            <I size={19} weight="duotone" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {sub ? <p className="mt-0.5 text-[12.5px] text-muted">{sub}</p> : null}
          </div>
          <button type="button" onClick={onClose} aria-label={t("Close")} title={t("Close")} className="-my-1 grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:size-11">
            <XIcon size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3">{footer}</footer> : null}
      </motion.section>
    </div>
  );
}

// ------------------------------------------------------------------ write feedback

export function GeneralForm({
  pageLabel,
  sending,
  onSend,
  onScreenshot,
  onClose,
}: {
  pageLabel: string;
  sending: boolean;
  onSend: (v: { category: FeedbackCategory; note: string; aboutPage: boolean }) => void;
  onScreenshot: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [note, setNote] = useState("");
  const [aboutPage, setAboutPage] = useState(true);
  const ok = note.trim().length >= 3;
  return (
    <Panel
      title={t("Write feedback")}
      sub={t("No screenshot needed: tell the developer what you think, in your own words.")}
      icon={ChatTeardropTextIcon}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onScreenshot} className="inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-fg">
            <CameraIcon size={14} /> {t("Add a screenshot instead")}
          </button>
          <Button className="ml-auto" onClick={() => onSend({ category: category ?? "other", note, aboutPage })} disabled={!ok} loading={sending}>
            <PaperPlaneTiltIcon size={16} weight="bold" /> {t("Send feedback")}
          </Button>
        </>
      }
    >
      <div className="grid gap-5">
        <div className="grid gap-2">
          <p className="text-[12.5px] font-medium text-muted">{t("What is it about?")}</p>
          <div className="grid grid-cols-2 gap-2">
            {CATEGORIES.map((c) => (
              <button key={c.value} type="button" onClick={() => setCategory((v) => (v === c.value ? null : c.value))} aria-pressed={category === c.value}
                className={cn(
                  "grid gap-0.5 rounded-[var(--radius-sm)] border px-3 py-2.5 text-left transition-colors",
                  category === c.value ? "border-accent bg-accent-soft" : "border-border hover:border-accent/40 hover:bg-surface-2",
                )}>
                <span className={cn("text-[13px] font-semibold", category === c.value && "text-accent")}>{t(c.label)}</span>
                <span className="text-[11.5px] leading-snug text-muted">{t(c.hint)}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="grid gap-2">
          <span className="text-[12.5px] font-medium text-muted">{t("Your feedback")}</span>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={7}
            maxLength={4000}
            placeholder={t("Anything at all: what is hard, what is missing, what you would change, what you like.")}
            className="w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2.5 text-[13.5px] outline-none focus:border-accent"
          />
          <span className="text-right text-[11.5px] text-muted tabular">{note.length} / 4000</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--radius-sm)] border border-border px-3 py-2.5">
          <input type="checkbox" checked={aboutPage} onChange={(e) => setAboutPage(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span className="grid gap-0.5">
            <span className="text-[13px] font-medium">{t("It is about this page")}</span>
            <span className="text-[12px] text-muted">{aboutPage ? pageLabel : t("About the whole system")}</span>
          </span>
        </label>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ rules and guide

// How the system is governed: the same for everyone, wherever they are.
export const SYSTEM_RULES: { icon: Icon; title: string; body: string }[] = [
  { icon: SealCheckIcon, title: msg("The AI asks before anything important"), body: msg("Agents stop and ask a person before payments, sending outside the company, deleting or anything risky. You decide in Approvals, or from a phone notification.") },
  { icon: UsersThreeIcon, title: msg("Everyone sees only their own area"), body: msg("Staff see their own work and their AI; a supervisor or head of department their department; a branch manager their company; owners and admins everything.") },
  { icon: ClockCounterClockwiseIcon, title: msg("Every change is recorded"), body: msg("What people and agents change is written to a tamper-evident activity log that cannot be edited afterwards.") },
  { icon: ScalesIcon, title: msg("A daily AI allowance"), body: msg("Each person has a daily AI allowance. It resets at midnight, and a manager can give more.") },
  { icon: ShieldCheckIcon, title: msg("Company information stays with approved services"), body: msg("When the company switches it on, company information goes only to outside services it approved.") },
  { icon: LockKeyIcon, title: msg("Saved logins stay hidden"), body: msg("Agents sign in to websites with saved logins without ever seeing the password.") },
  { icon: EyeIcon, title: msg("Your feedback goes to the developer"), body: msg("What you send here, screenshot included, is read by the system's developer. Leave out anything private before you send.") },
];

/** P79: opens the picture tour of the page's guide (guide-tour.tsx). */
export function TourButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 flex w-full items-center gap-3 rounded-[var(--radius-sm)] border border-accent/30 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-accent-soft/40"
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent text-accent-fg">
        <MapTrifoldIcon size={17} weight="fill" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold">{t("Show me on this page")}</span>
        <span className="block text-[12px] text-muted">{t("A picture of this screen with each step marked on it.")}</span>
      </span>
    </button>
  );
}

export function Block({ title, icon: I, children }: { title: string; icon: Icon; children: ReactNode }) {
  return (
    <section className="grid gap-2.5">
      <h3 className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">
        <I size={15} weight="bold" /> {title}
      </h3>
      {children}
    </section>
  );
}

/** Does a house rule tied to a page belong to this one? "/tasks" covers "/tasks/abc", and
 * "/prima" covers every Prima screen ("/prima/#staffpay"). `also` is another name the page goes
 * by (the menu entry it sits under). */
export function ruleOnPage(rule: HouseRule, path: string, also?: string): boolean {
  if (!rule.page) return false;
  const p = rule.page.replace(/\/+$/, "") || "/";
  if (path === rule.page || path === p || (also && also === rule.page)) return true;
  return p !== "/" && (path.startsWith(`${p}/`) || path.startsWith(`${p}#`));
}

/** The developer's rules tied to this page, under "This page". */
export function PageRuleCards({ rules }: { rules: HouseRule[] }) {
  const t = useT();
  return (
    <>
      {rules.map((r) => (
        <div key={r.id} className="rounded-[var(--radius-md)] border border-accent/25 bg-accent-soft/40 px-4 py-3">
          <p className="text-[13px] font-semibold">{r.title || t("Rule for this page")}</p>
          {r.body ? <p className="mt-1 text-[12.5px] whitespace-pre-line text-fg/85">{r.body}</p> : null}
        </div>
      ))}
    </>
  );
}

/** The developer's rules for every page. */
export function HouseRulesBlock({ rules }: { rules: HouseRule[] }) {
  const t = useT();
  if (!rules.length) return null;
  return (
    <Block title={t("House rules")} icon={GavelIcon}>
      <ul className="grid gap-2">
        {rules.map((r) => (
          <li key={r.id} className="rounded-[var(--radius-md)] border border-border px-4 py-3">
            <p className="text-[13px] font-semibold">{r.title}</p>
            {r.body ? <p className="mt-1 text-[12.5px] whitespace-pre-line text-fg/85">{r.body}</p> : null}
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** How the system is run: the governance cards at the foot of Rules & guide. */
export function SystemRulesBlock({ items = SYSTEM_RULES }: { items?: typeof SYSTEM_RULES }) {
  const t = useT();
  return (
    <Block title={t("How the system is run")} icon={ScalesIcon}>
      <ul className="grid gap-2">
        {items.map((r) => (
          <li key={r.title} className="flex gap-3 rounded-[var(--radius-md)] border border-border px-3.5 py-3">
            <r.icon size={18} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold">{t(r.title)}</p>
              <p className="mt-0.5 text-[12.5px] text-fg/80">{t(r.body)}</p>
            </div>
          </li>
        ))}
      </ul>
    </Block>
  );
}

// ------------------------------------------------------------------ my feedback

export function MinePanel({ onClose, onNew }: { onClose: () => void; onNew: () => void }) {
  const t = useT();
  const q = useQuery(myFeedbackQuery);
  return (
    <Panel title={t("My feedback")} sub={t("What you sent, where each one stands, and the developer's answers.")} icon={ClockCounterClockwiseIcon} onClose={onClose}
      footer={<><span /><Button variant="outline" size="sm" onClick={onNew}><ChatTeardropTextIcon size={15} /> {t("Write feedback")}</Button></>}>
      {q.isPending ? (
        <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : q.isError ? (
        <p className="text-[13px] text-danger">{t("Could not load your feedback.")}</p>
      ) : !q.data.length ? (
        <div className="grid place-items-center gap-2 py-10 text-center">
          <CheckCircleIcon size={30} weight="duotone" className="text-accent" />
          <p className="text-[13.5px] font-medium">{t("Nothing sent yet")}</p>
          <p className="max-w-xs text-[12.5px] text-muted">{t("Whatever you notice, big or small, send it: every piece is read.")}</p>
        </div>
      ) : (
        <ul className="grid gap-2.5">
          {q.data.map((f) => {
            const s = statusOf(f.status);
            return (
              <li key={f.id} className="grid gap-2 rounded-[var(--radius-md)] border border-border px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={s.tone}>{t(s.label)}</Pill>
                  <Pill tone={categoryOf(f.category).tone === "accent" ? "neutral" : categoryOf(f.category).tone}>{t(categoryOf(f.category).label)}</Pill>
                  <span className="ml-auto text-[11.5px] text-muted">{timeAgo(f.created_at)}</span>
                </div>
                <div className="flex gap-3">
                  {f.has_screenshot ? (
                    <a href={screenshotUrl(f.id)} target="_blank" rel="noreferrer" className="shrink-0">
                      <img src={screenshotUrl(f.id)} alt={t("Your screenshot")} loading="lazy" className="h-14 w-20 rounded-sm border border-border object-cover object-top" />
                    </a>
                  ) : null}
                  <div className="min-w-0">
                    {f.note ? <p className="line-clamp-3 text-[13px] whitespace-pre-line">{f.note}</p> : <p className="text-[13px] text-muted">{t("Screenshot with marks")}</p>}
                    {f.page_title || f.page_path ? <p className="mt-1 truncate text-[11.5px] text-muted">{f.page_title || f.page_path}</p> : null}
                  </div>
                </div>
                {f.dev_note ? (
                  <div className="rounded-sm border-l-2 border-accent bg-accent-soft/40 px-3 py-2">
                    <p className="text-[11.5px] font-semibold text-accent">{t("Developer's answer")}</p>
                    <p className="mt-0.5 text-[12.5px] whitespace-pre-line">{f.dev_note}</p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

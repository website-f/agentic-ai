/** P73: Rules & guide in the office: what the page you are on is for (its menu entry, tips and
 * guide page), the developer's rules for it, your role, the house rules and how the system is
 * run. Prima's own version is feedback-widget/prima-rules.tsx. */
import { ArrowSquareOutIcon, BookOpenTextIcon, CaretRightIcon, GavelIcon, IdentificationBadgeIcon, LightbulbIcon, ListNumbersIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Pill } from "@/components/ui/pill";
import { guidePageFor } from "@/guide/lookup";
import { useLang, useT } from "@/i18n";
import type { HouseRule } from "@/lib/feedback";
import { guideSteps, recipeSteps } from "@/lib/page-tip-marks";
import { tipFor } from "@/lib/page-tips";
import { staffOnly } from "@/lib/twin";
import { ROLE_INFO, type Me } from "@/lib/types";
import { navItemFor } from "@/nav";

import type { GuideStep } from "./guide-targets";
import { Block, HouseRulesBlock, PageRuleCards, Panel, ruleOnPage, SystemRulesBlock, TourButton } from "./panels";

export function RulesPanel({ me, path, rules, onClose, onTour }: { me: Me; path: string; rules: HouseRule[]; onClose: () => void; onTour: (steps: GuideStep[], heading?: string) => void }) {
  const t = useT();
  const item = navItemFor(path);
  const tip = tipFor(item?.to ?? path, staffOnly(me.permissions) ? "staff" : "manager");
  const guide = guidePageFor(path);
  const pageRules = rules.filter((r) => ruleOnPage(r, path, item?.to));
  const role = ROLE_INFO[me.role];
  // The User Guide's recipes for this page, in the person's language (loaded when asked for:
  // the guide's words are a chunk of their own).
  const lang = useLang((s) => s.lang);
  const docs = useQuery({ queryKey: ["guide-text", lang], queryFn: () => import("@/guide/lang").then((m) => m.guideText(lang).docs), staleTime: Infinity, enabled: !!guide });
  const recipes = guide ? (docs.data?.[guide.id]?.howto ?? []).filter((r) => r.steps.length) : [];
  return (
    <Panel title={t("Rules & guide")} sub={t("What this page is for, what you may do here, and how the system is run.")} icon={GavelIcon} onClose={onClose}>
      <div className="grid gap-6">
        <Block title={t("This page")} icon={BookOpenTextIcon}>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-2/50 px-4 py-3">
            <p className="text-[14px] font-semibold">{item ? t(item.label) : document.title}</p>
            {item ? <p className="mt-1 text-[13px] text-fg/85">{t(item.blurb)}</p> : null}
            {tip ? (
              <div className="mt-3 grid gap-1.5">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
                  <LightbulbIcon size={14} weight="fill" /> {t(tip.what)}
                </p>
                <ol className="grid gap-1 text-[12.5px] text-fg/85">
                  {tip.steps.map((s, i) => (
                    <li key={s} className="flex gap-2">
                      <span className="mt-px grid size-[17px] shrink-0 place-items-center rounded-full bg-surface text-[10.5px] font-semibold text-accent ring-1 ring-accent/25">{i + 1}</span>
                      <span>{t(s)}</span>
                    </li>
                  ))}
                </ol>
                {tip.steps.length ? <TourButton onClick={() => onTour(guideSteps(tip, t))} /> : null}
              </div>
            ) : null}
            {guide ? (
              <Link to="/guide/$page" params={{ page: guide.id }} onClick={onClose} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline">
                {t("Open the guide for this page")} <ArrowSquareOutIcon size={13} />
              </Link>
            ) : null}
          </div>
          {recipes.length ? (
            <div className="grid gap-1.5">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
                <ListNumbersIcon size={14} weight="bold" /> {t("Step by step on this page")}
              </p>
              <ul className="grid gap-1">
                {recipes.map((r) => (
                  <li key={r.title}>
                    <button
                      type="button"
                      onClick={() => onTour(recipeSteps(r), r.title)}
                      className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-left text-[12.5px] transition-colors hover:border-accent/40 hover:bg-accent-soft/30"
                    >
                      <span className="min-w-0 flex-1">{r.title}</span>
                      <span className="shrink-0 text-[11.5px] text-muted tabular">{t("{n} steps", { n: r.steps.length })}</span>
                      <CaretRightIcon size={13} className="shrink-0 text-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <PageRuleCards rules={pageRules} />
        </Block>

        <Block title={t("Your role")} icon={IdentificationBadgeIcon}>
          <div className="rounded-[var(--radius-md)] border border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="accent">{role ? t(role.label) : me.role}</Pill>
              {me.user.is_developer ? <Pill tone="info">{t("Developer")}</Pill> : null}
              {me.scope?.label ? <span className="text-[12.5px] text-muted">{me.scope.label}</span> : null}
            </div>
            {role ? <p className="mt-2 text-[12.5px] text-fg/85">{t(role.blurb)}</p> : null}
          </div>
        </Block>

        <HouseRulesBlock rules={rules.filter((r) => !r.page)} />
        <SystemRulesBlock />
      </div>
    </Panel>
  );
}

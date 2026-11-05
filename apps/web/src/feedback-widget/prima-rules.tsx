/** P75: Rules & guide over Prima: what the Prima screen is for (Prima's own words), its steps,
 * the developer's rules for Prima, your role in Prima, Prima's rules for this screen, the house
 * rules, and that feedback goes to the developer. */
import { BookOpenTextIcon, GavelIcon, IdentificationBadgeIcon, LightbulbIcon, ScalesIcon } from "@phosphor-icons/react";

import { Block, HouseRulesBlock, PageRuleCards, Panel, ruleOnPage, SYSTEM_RULES, SystemRulesBlock } from "@/components/feedback/panels";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import type { HouseRule } from "@/lib/feedback";
import { ROLE_INFO, type Me } from "@/lib/types";
import { cn } from "@/lib/utils";

import type { PrimaPageInfo } from "./prima";

// Of the office's governance cards, the one that holds in Prima too: who reads the feedback.
const PRIMA_SYSTEM_RULES = SYSTEM_RULES.filter((r) => r.title === "Your feedback goes to the developer");

export function PrimaRulesPanel({ me, page, path, rules, onClose }: { me: Me; page: PrimaPageInfo; path: string; rules: HouseRule[]; onClose: () => void }) {
  const t = useT();
  const pageRules = rules.filter((r) => ruleOnPage(r, path));
  const office = ROLE_INFO[me.role];
  return (
    <Panel title={t("Rules & guide")} sub={t("What this Prima screen is for, what you may do here, and the rules that apply.")} icon={GavelIcon} onClose={onClose}>
      <div className="grid gap-6">
        <Block title={t("This page")} icon={BookOpenTextIcon}>
          <div className="rounded-[var(--radius-md)] border border-border bg-surface-2/50 px-4 py-3">
            <p className="text-[14px] font-semibold">{page.title}</p>
            {page.blurb ? <p className="mt-1 text-[13px] text-fg/85">{page.blurb}</p> : null}
            {page.steps.length ? (
              <div className="mt-3 grid gap-1.5">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
                  <LightbulbIcon size={14} weight="fill" /> {t("How to use it")}
                </p>
                <ol className="grid gap-1 text-[12.5px] text-fg/85">
                  {page.steps.map((s, i) => (
                    <li key={`${i}-${s}`} className="flex gap-2">
                      <span className="mt-px grid size-[17px] shrink-0 place-items-center rounded-full bg-surface text-[10.5px] font-semibold text-accent ring-1 ring-accent/25">{i + 1}</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {!page.blurb && !page.steps.length ? <p className="mt-1 text-[12.5px] text-muted">{t("A screen of Prima Secure, the group's operations app.")}</p> : null}
          </div>
          <PageRuleCards rules={pageRules} />
        </Block>

        <Block title={t("Your role")} icon={IdentificationBadgeIcon}>
          <div className="rounded-[var(--radius-md)] border border-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Pill tone="accent">{page.role ? page.role.label : office ? t(office.label) : me.role}</Pill>
              {me.user.is_developer ? <Pill tone="info">{t("Developer")}</Pill> : null}
              {page.role && office ? <span className="text-[12.5px] text-muted">{t("In the office: {role}", { role: t(office.label) })}</span> : null}
            </div>
            {page.role ? (
              page.role.blurb ? <p className="mt-2 text-[12.5px] text-fg/85">{page.role.blurb}</p> : null
            ) : office ? (
              <p className="mt-2 text-[12.5px] text-fg/85">{t(office.blurb)}</p>
            ) : null}
          </div>
        </Block>

        {page.rules.length ? (
          <Block title={t("Prima's rules for this screen")} icon={ScalesIcon}>
            <ul className="grid gap-2">
              {page.rules.map((r, i) => (
                <li key={r.id || `${i}-${r.title}`} className="rounded-[var(--radius-md)] border border-border px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className={cn("min-w-0 flex-1", r.title.length > 120 ? "text-[12.5px] text-fg/85" : "text-[13px] font-semibold")}>{r.title}</p>
                    {r.source ? <Pill tone={r.source.toLowerCase() === "law" ? "warn" : "neutral"}>{r.source}</Pill> : null}
                  </div>
                  {r.body ? <p className="mt-1 text-[12.5px] whitespace-pre-line text-fg/85">{r.body}</p> : null}
                  {r.id ? <p className="mt-1 font-mono text-[11px] text-muted">{r.id}</p> : null}
                </li>
              ))}
            </ul>
          </Block>
        ) : null}

        <HouseRulesBlock rules={rules.filter((r) => !r.page)} />
        <SystemRulesBlock items={PRIMA_SYSTEM_RULES} />
      </div>
    </Panel>
  );
}

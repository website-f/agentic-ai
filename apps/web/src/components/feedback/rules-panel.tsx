/** P73: Rules & guide in the office: what the page you are on is for (its menu entry, tips and
 * guide page), the developer's rules for it, your role, the house rules and how the system is
 * run. Prima's own version is feedback-widget/prima-rules.tsx. */
import { ArrowSquareOutIcon, BookOpenTextIcon, GavelIcon, IdentificationBadgeIcon, LightbulbIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { Pill } from "@/components/ui/pill";
import { guidePageFor } from "@/guide/lookup";
import { useT } from "@/i18n";
import type { HouseRule } from "@/lib/feedback";
import { tipFor } from "@/lib/page-tips";
import { staffOnly } from "@/lib/twin";
import { ROLE_INFO, type Me } from "@/lib/types";
import { navItemFor } from "@/nav";

import { Block, HouseRulesBlock, PageRuleCards, Panel, ruleOnPage, SystemRulesBlock } from "./panels";

export function RulesPanel({ me, path, rules, onClose }: { me: Me; path: string; rules: HouseRule[]; onClose: () => void }) {
  const t = useT();
  const item = navItemFor(path);
  const tip = tipFor(item?.to ?? path, staffOnly(me.permissions) ? "staff" : "manager");
  const guide = guidePageFor(path);
  const pageRules = rules.filter((r) => ruleOnPage(r, path, item?.to));
  const role = ROLE_INFO[me.role];
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
              </div>
            ) : null}
            {guide ? (
              <Link to="/guide/$page" params={{ page: guide.id }} onClick={onClose} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline">
                {t("Open the guide for this page")} <ArrowSquareOutIcon size={13} />
              </Link>
            ) : null}
          </div>
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

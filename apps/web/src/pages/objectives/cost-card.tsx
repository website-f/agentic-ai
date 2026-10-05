/** The company overview's "Cost by objective": AI spend in the period per objective (its tasks
 * and everything they handed out), with a link to the Objectives page. */
import { ArrowRightIcon, TargetIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import { fxRate, rm, STATUS, type ObjectiveCost } from "@/lib/objectives";

export function ObjectiveCostCard({ rows, days, branchName }: { rows: ObjectiveCost[]; days: number; branchName: (id: string | null) => string }) {
  const t = useT();
  const fx = fxRate();
  const top = rows[0]?.usd ?? 0;
  const total = rows.reduce((s, r) => s + r.usd, 0);
  const spentLine = days === 1
    ? t("{amount} of AI spend in the last day went to work linked to objectives.", { amount: rm(total, fx) })
    : t("{amount} of AI spend in the last {n} days went to work linked to objectives.", { amount: rm(total, fx), n: days });
  return (
    <Card aria-label={t("Cost by objective")} className="overflow-hidden">
      <CardHeader
        icon={<IconTile icon={TargetIcon} tone="accent" size="sm" />}
        title={t("Cost by objective")}
        description={rows.length ? spentLine : t("Link tasks to objectives to see what each goal costs.")}
        actions={
          <Button size="sm" variant="outline" asChild className="pointer-coarse:min-h-9">
            <Link to="/objectives">{t("All objectives")} <ArrowRightIcon size={13} /></Link>
          </Button>
        }
      />
      {rows.length ? (
        <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id}>
              <Link to="/objectives" search={{ o: r.id }} className="grid min-w-0 gap-1.5 px-4 py-2.5 transition-colors hover:bg-surface-2/50 sm:px-5">
                <span className="flex min-w-0 items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-medium break-words">{r.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-muted">
                      <span>{branchName(r.branch_id)}</span>
                      <span aria-hidden className="text-muted/50">•</span>
                      <span className="tabular">{r.tasks === 1 ? t("1 task") : t("{n} tasks", { n: r.tasks })}</span>
                      {r.status !== "active" ? <Pill tone={STATUS[r.status].tone} className="px-2 text-[11px] leading-[18px]">{t(STATUS[r.status].label)}</Pill> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13.5px] font-semibold tabular">{rm(r.usd, fx)}</span>
                    {r.budget_usd !== null ? <span className="block text-[11.5px] text-muted tabular">{t("budget {amount}", { amount: rm(r.budget_usd, fx) })}</span> : null}
                  </span>
                </span>
                <span aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <span className="block h-full rounded-full bg-accent/70" style={{ width: `${top ? Math.max(2, (r.usd / top) * 100) : 0}%` }} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-8 text-center text-[13px] text-muted">{t("No spend on objectives in this period.")}</p>
      )}
    </Card>
  );
}

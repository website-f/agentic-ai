/** Money charts: how late the open amounts are (aging, five buckets) and the cash expected in
 * and out each week. Plain bars with a real table beside them for screen readers. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { parseDay } from "@/lib/crm";
import { AGING_BUCKETS, AGING_LABEL, agingQuery, agingShares, forecastQuery, scaleMax, type AgingBucket, type MoneyDirection } from "@/lib/money";
import { cn } from "@/lib/utils";
import { LoadError, useFormat } from "@/pages/contacts/bits";

const BUCKET_COLOR: Record<AgingBucket, string> = {
  current: "bg-ok",
  d1_30: "bg-info",
  d31_60: "bg-warn",
  d61_90: "bg-[var(--series-2)]",
  d90_plus: "bg-danger",
};

export function AgingCard({ direction, branchId }: { direction: MoneyDirection; branchId?: string }) {
  const t = useT();
  const { money } = useFormat();
  const aging = useQuery(agingQuery(direction, branchId));
  const a = aging.data;
  const shares = a ? agingShares(a) : null;
  const total = a ? AGING_BUCKETS.reduce((s, b) => s + a[b].amount, 0) : 0;
  return (
    <Card>
      <CardHeader title={direction === "receivable" ? t("How late customers are") : t("How late your bills are")}
        description={t("Open amounts by how far past the due date they are.")} />
      <CardBody className="grid gap-4">
        {aging.isLoading ? <Skeleton className="h-28" /> : aging.error ? <LoadError error={aging.error} /> : a && shares ? (
          <>
            <div aria-hidden className="flex h-4 w-full overflow-hidden rounded-full bg-surface-2">
              {total ? AGING_BUCKETS.map((b) => (shares[b] ? <span key={b} className={cn("h-full", BUCKET_COLOR[b])} style={{ width: `${shares[b]}%` }} /> : null)) : null}
            </div>
            <table className="w-full text-[12.5px]">
              <caption className="sr-only">{t("Open amounts by how late they are")}</caption>
              <thead className="sr-only">
                <tr><th scope="col">{t("How late")}</th><th scope="col">{t("Documents")}</th><th scope="col">{t("Amount")}</th></tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {AGING_BUCKETS.map((b) => (
                  <tr key={b}>
                    <th scope="row" className="py-1.5 text-left font-normal">
                      <span className="flex items-center gap-2">
                        <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", BUCKET_COLOR[b])} />
                        {t(AGING_LABEL[b])}
                      </span>
                    </th>
                    <td className="py-1.5 text-right text-muted tabular">{a[b].count}</td>
                    <td className={cn("py-1.5 pl-3 text-right font-medium whitespace-nowrap tabular", b !== "current" && a[b].amount > 0 && "text-danger")}>{money(a[b].amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

const WINDOWS = [30, 60, 90] as const;
type Window = (typeof WINDOWS)[number];

export function ForecastCard({ branchId }: { branchId?: string }) {
  const t = useT();
  const { money, short } = useFormat();
  const [days, setDays] = useState<Window>(30);
  const forecast = useQuery(forecastQuery(days, branchId));
  const weeks = forecast.data ?? [];
  const max = scaleMax(weeks);
  const totIn = weeks.reduce((s, w) => s + w.in, 0);
  const totOut = weeks.reduce((s, w) => s + w.out, 0);
  const label = (iso: string) => parseDay(iso)?.toLocaleDateString(locale(), { day: "numeric", month: "short" }) ?? iso;
  return (
    <Card>
      <CardHeader title={t("Cash forecast")} description={t("What is due to come in and go out each week, from open invoices and bills.")}
        actions={<Segmented<string> size="sm" label={t("How far ahead")} value={String(days)} onChange={(v) => setDays(Number(v) as Window)}
          options={WINDOWS.map((d) => ({ value: String(d), label: t("{n} days", { n: d }) }))} />} />
      <CardBody className="grid gap-3">
        {forecast.isLoading ? <Skeleton className="h-40" /> : forecast.error ? <LoadError error={forecast.error} /> : !weeks.length ? (
          <p className="py-6 text-center text-[13px] text-muted">{t("Nothing is due in this period.")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
              <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-ok" /> {t("Coming in {amount}", { amount: money(totIn) })}</span>
              <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[3px] bg-danger/75" /> {t("Going out {amount}", { amount: money(totOut) })}</span>
            </div>
            <div aria-hidden className="grid h-40 min-w-0 items-end gap-1 border-b border-border" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
              {weeks.map((w) => (
                <div key={w.week_start} className="flex h-full min-w-0 items-end justify-center gap-[2px]" title={`${label(w.week_start)}: +${short(w.in)} / -${short(w.out)}`}>
                  <span className="w-full max-w-4 rounded-t-[3px] bg-ok" style={{ height: `${(w.in / max) * 100}%` }} />
                  <span className="w-full max-w-4 rounded-t-[3px] bg-danger/75" style={{ height: `${(w.out / max) * 100}%` }} />
                </div>
              ))}
            </div>
            <div aria-hidden className="grid min-w-0 gap-1 text-center text-[10.5px] text-muted" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
              {weeks.map((w, i) => <span key={w.week_start} className={cn("truncate", weeks.length > 6 && i % 2 === 1 && "invisible sm:visible")}>{label(w.week_start)}</span>)}
            </div>
            <table className="sr-only">
              <caption>{t("Cash forecast by week")}</caption>
              <thead><tr><th scope="col">{t("Week of")}</th><th scope="col">{t("Coming in")}</th><th scope="col">{t("Going out")}</th></tr></thead>
              <tbody>
                {weeks.map((w) => <tr key={w.week_start}><th scope="row">{label(w.week_start)}</th><td>{money(w.in)}</td><td>{money(w.out)}</td></tr>)}
              </tbody>
            </table>
          </>
        )}
      </CardBody>
    </Card>
  );
}

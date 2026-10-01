import { ChartBarIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { RadioGroup } from "radix-ui";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

import { EmptyState } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

import { compact, providerColors, providersQuery, usageQuery, usd, type UsageRow } from "./data";

const RANGES = [7, 30, 90] as const;

function pct(part: number, whole: number): string {
  if (!whole) return "-";
  const v = (part / whole) * 100;
  if (v > 0 && v < 0.1) return "<0.1%";
  return `${v < 10 && v > 0 ? v.toFixed(1) : Math.round(v)}%`;
}

function dayKeys(days: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

function ChartTooltip({ active, payload, label }: TooltipContentProps<number, string>) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => Number(p.value) > 0).reverse();
  const total = rows.reduce((s, p) => s + Number(p.value), 0);
  return (
    <div className="min-w-44 rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]">
      <p className="mb-1.5 font-medium">{shortDay(String(label))}</p>
      {rows.length ? (
        <ul className="grid gap-1">
          {rows.map((p) => (
            <li key={String(p.dataKey)} className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: String(p.color) }} />
              <span className="flex-1 text-muted">{String(p.dataKey)}</span>
              <span className="font-mono tabular">{compact(Number(p.value))}</span>
            </li>
          ))}
          <li className="mt-1 flex justify-between border-t border-border pt-1">
            <span className="text-muted">Total</span>
            <span className="font-mono tabular">{compact(total)}</span>
          </li>
        </ul>
      ) : (
        <p className="text-muted">No calls</p>
      )}
    </div>
  );
}

function StatStrip({ t }: { t: UsageRow }) {
  const tokens = t.prompt + t.completion;
  const items = [
    { label: "Calls", value: compact(t.calls) },
    { label: "Tokens", value: compact(tokens), note: `${compact(t.prompt)} in, ${compact(t.completion)} out` },
    { label: "Served from cache", value: pct(t.cached, t.prompt), note: "Share of input tokens" },
    { label: "Cost", value: usd(t.cost), note: t.unpriced ? `${t.unpriced} ${t.unpriced === 1 ? "call" : "calls"} unpriced` : "All calls priced" },
    { label: "Errors", value: pct(t.errors, t.calls), note: `${t.errors} failed ${t.errors === 1 ? "call" : "calls"}`, bad: t.errors > 0 },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <p className="text-[12.5px] text-muted">{i.label}</p>
          <p className={cn("mt-0.5 flex items-center gap-1.5 text-[22px] leading-tight font-semibold tabular", i.bad && "text-danger")}>
            {i.bad ? <WarningCircleIcon size={18} weight="fill" aria-label="Has errors" /> : null}
            {i.value}
          </p>
          {i.note ? <p className="truncate text-[12px] text-muted">{i.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

function UsageTable({ title, rows, colors, label }: { title: string; rows: UsageRow[]; colors: Map<string, string>; label: (r: UsageRow) => { main: string; sub?: string; swatch?: string } }) {
  if (!rows.length) return null;
  return (
    <section className="grid gap-2">
      <h3 className="text-[14px] font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border bg-surface">
        <table className="w-full min-w-[40rem] text-left text-[13px]">
          <thead className="bg-surface-2/60 text-[12px] text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-3 py-2 text-right font-medium">Calls</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">From cache</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Errors</th>
              <th className="px-4 py-2 text-right font-medium">Avg time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r, i) => {
              const l = label(r);
              return (
                <tr key={i}>
                  <td className="px-4 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      {l.swatch ? <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: colors.get(l.swatch) ?? "var(--series-other)" }} /> : null}
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{l.main}</span>
                        {l.sub ? <span className="block truncate font-mono text-[11.5px] text-muted">{l.sub}</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{compact(r.calls)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{compact(r.prompt + r.completion)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{pct(r.cached, r.prompt)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{r.unpriced && !r.cost ? "Unpriced" : usd(r.cost)}</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono tabular", r.errors > 0 && "text-danger")}>{r.errors}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular">{r.avg_latency ? `${(r.avg_latency / 1000).toFixed(1)} s` : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const TASK_LABELS: Record<string, string> = { "engine.test": "Connection tests", playground: "Playground" };

export function UsageTab() {
  const [days, setDays] = useState<number>(7);
  const { data, isLoading, error } = useQuery(usageQuery(days));
  const { data: providers = [] } = useQuery(providersQuery);
  const colors = useMemo(() => providerColors(providers), [providers]);

  const { rows, series } = useMemo(() => {
    const names = [...new Set((data?.daily ?? []).map((d) => d.provider))];
    // Stack in the same fixed slot order as the colors, so a provider keeps its place.
    const order = new Map(providers.map((p) => [p.name, p.id]));
    names.sort((a, b) => (order.get(a) ?? "~" + a).localeCompare(order.get(b) ?? "~" + b));
    const byDay = new Map<string, Record<string, number | string>>();
    for (const k of dayKeys(days)) byDay.set(k, { day: k });
    for (const d of data?.daily ?? []) {
      const row = byDay.get(d.day) ?? { day: d.day };
      row[d.provider] = d.tokens;
      byDay.set(d.day, row);
    }
    return { rows: [...byDay.values()], series: names };
  }, [data, days, providers]);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13.5px] text-muted">Every model call, including failures, connection tests and fallbacks.</p>
        <RadioGroup.Root
          value={String(days)}
          onValueChange={(v) => setDays(Number(v))}
          aria-label="Time range"
          className="inline-flex rounded-sm border border-border bg-surface p-0.5"
        >
          {RANGES.map((r) => (
            <RadioGroup.Item
              key={r}
              value={String(r)}
              className="rounded-[6px] px-3 py-1.5 text-[13px] text-muted data-[state=checked]:bg-accent-soft data-[state=checked]:font-medium data-[state=checked]:text-accent"
            >
              {r} days
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
      </div>

      {isLoading ? (
        <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-72" /></div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">Could not load usage. {errorMessage(error)}</div>
      ) : !data || data.totals.calls === 0 ? (
        <EmptyState icon={ChartBarIcon} title={`No model calls in the last ${days} days`} body="Usage appears here as soon as a provider is tested or the playground runs. Agents add to it from P2." />
      ) : (
        <>
          <StatStrip t={data.totals} />

          <section className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[14px] font-semibold">Tokens per day by provider</h3>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" aria-label="Legend">
                {series.map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: colors.get(s) ?? "var(--series-other)" }} />
                    <span className="text-muted">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap={days > 30 ? "12%" : "24%"}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "var(--text-muted)", fontSize: 11.5 }} />
                  <YAxis tickFormatter={(v: number) => compact(v)} width={44} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 11.5 }} />
                  <Tooltip content={(p) => <ChartTooltip {...(p as TooltipContentProps<number, string>)} />} cursor={{ fill: "var(--surface-2)" }} />
                  {series.map((s, i) => (
                    <Bar
                      key={s}
                      dataKey={s}
                      stackId="tokens"
                      fill={colors.get(s) ?? "var(--series-other)"}
                      stroke="var(--surface)"
                      strokeWidth={1}
                      maxBarSize={40}
                      radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
                      isAnimationActive={false}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <UsageTable title="By provider" rows={data.by_provider} colors={colors} label={(r) => ({ main: r.provider ?? "", swatch: r.provider })} />
          <UsageTable title="By model" rows={data.by_model} colors={colors} label={(r) => ({ main: r.provider ?? "", sub: r.model, swatch: r.provider })} />
          <UsageTable title="By kind of work" rows={data.by_task} colors={colors} label={(r) => ({ main: TASK_LABELS[r.task ?? ""] ?? r.task ?? "" })} />
        </>
      )}
    </div>
  );
}

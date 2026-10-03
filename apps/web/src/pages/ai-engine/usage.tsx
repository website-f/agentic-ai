import { ArchiveIcon, ChartBarIcon, CurrencyDollarIcon, LightningIcon, TextAaIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from "recharts";

import { EmptyState } from "@/components/page";
import { Meta } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
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
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Stat label="Calls" value={compact(t.calls)} icon={LightningIcon} tone="accent" hint="Every model request" />
      <Stat label="Tokens" value={compact(tokens)} icon={TextAaIcon} tone="info" hint={`${compact(t.prompt)} in, ${compact(t.completion)} out`} />
      <Stat label="Served from cache" value={pct(t.cached, t.prompt)} icon={ArchiveIcon} tone="violet" hint="Share of input tokens" />
      <Stat
        label="Cost"
        value={usd(t.cost)}
        icon={CurrencyDollarIcon}
        tone="ok"
        hint={t.unpriced ? `${t.unpriced} ${t.unpriced === 1 ? "call" : "calls"} unpriced` : "All calls priced"}
      />
      <Stat
        label="Errors"
        value={pct(t.errors, t.calls)}
        icon={WarningCircleIcon}
        tone={t.errors > 0 ? "danger" : "neutral"}
        hint={`${t.errors} failed ${t.errors === 1 ? "call" : "calls"}`}
        className="col-span-2 sm:col-span-1"
      />
    </div>
  );
}

type RowLabel = (r: UsageRow) => { main: string; sub?: string; swatch?: string };
type Breakdown = "provider" | "model" | "task";

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: color }} />;
}

function UsageTable({ rows, colors, label }: { rows: UsageRow[]; colors: Map<string, string>; label: RowLabel }) {
  const avg = (r: UsageRow) => (r.avg_latency ? `${(r.avg_latency / 1000).toFixed(1)} s` : "-");
  const cost = (r: UsageRow) => (r.unpriced && !r.cost ? "Unpriced" : usd(r.cost));
  return (
    <>
      {/* Phones: one compact row each, headline numbers on the right, the rest underneath. */}
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border sm:hidden">
        {rows.map((r, i) => {
          const l = label(r);
          return (
            <li key={i} className="grid gap-1 px-4 py-3">
              <div className="flex min-w-0 items-start gap-2">
                {l.swatch ? <Swatch color={colors.get(l.swatch) ?? "var(--series-other)"} /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium break-words">{l.main}</span>
                  {l.sub ? <span className="block font-mono text-[11.5px] break-all text-muted">{l.sub}</span> : null}
                </span>
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[13px] font-medium tabular">{compact(r.prompt + r.completion)}</span>
                  <span className="block font-mono text-[11.5px] text-muted tabular">{cost(r)}</span>
                </span>
              </div>
              <p className={cn("flex flex-wrap gap-x-1.5 text-[12px] text-muted tabular", l.swatch && "pl-[18px]")}>
                <Meta
                  items={[
                    `${compact(r.calls)} ${r.calls === 1 ? "call" : "calls"}`,
                    `${pct(r.cached, r.prompt)} cached`,
                    r.errors > 0 ? <span className="text-danger">{r.errors} failed</span> : "no errors",
                    `avg ${avg(r)}`,
                  ]}
                />
              </p>
            </li>
          );
        })}
      </ul>
      <div className="overflow-x-auto max-sm:hidden">
        <table className="w-full min-w-[40rem] text-left text-[13px]">
          <thead className="border-b border-border bg-surface-2/60 text-[12px] text-muted">
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
                <tr key={i} className="transition-colors hover:bg-surface-2/40">
                  <td className="px-4 py-2.5">
                    <span className="flex min-w-0 items-start gap-2">
                      {l.swatch ? <Swatch color={colors.get(l.swatch) ?? "var(--series-other)"} /> : null}
                      <span className="min-w-0">
                        <span className="block font-medium break-words">{l.main}</span>
                        {l.sub ? <span className="block font-mono text-[11.5px] break-all text-muted">{l.sub}</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{compact(r.calls)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{compact(r.prompt + r.completion)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{pct(r.cached, r.prompt)}</td>
                  <td className="px-3 py-2.5 text-right font-mono tabular">{cost(r)}</td>
                  <td className={cn("px-3 py-2.5 text-right font-mono tabular", r.errors > 0 && "text-danger")}>{r.errors}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular">{avg(r)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const TASK_LABELS: Record<string, string> = { "engine.test": "Connection tests", playground: "Playground" };

function UsageBreakdown({
  view,
  onView,
  colors,
  sets,
}: {
  view: Breakdown;
  onView: (v: Breakdown) => void;
  colors: Map<string, string>;
  sets: Record<Breakdown, { label: string; rows: UsageRow[]; row: RowLabel }>;
}) {
  const keys = (Object.keys(sets) as Breakdown[]).filter((k) => sets[k].rows.length);
  if (!keys.length) return null;
  const current = keys.includes(view) ? view : keys[0]!;
  const set = sets[current];
  return (
    <section className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold">Breakdown</h3>
          <p className="text-[12.5px] text-muted">Calls, tokens and cost grouped by {set.label.toLowerCase()}.</p>
        </div>
        <Segmented
          size="sm"
          label="Group usage by"
          value={current}
          onChange={onView}
          options={keys.map((k) => ({ value: k, label: sets[k].label, count: sets[k].rows.length }))}
        />
      </div>
      <UsageTable rows={set.rows} colors={colors} label={set.row} />
    </section>
  );
}

export function UsageTab() {
  const [days, setDays] = useState<number>(7);
  const [view, setView] = useState<Breakdown>("provider");
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
        <p className="min-w-0 text-[13.5px] text-muted">Every model call, including failures, connection tests and fallbacks.</p>
        <Segmented
          label="Time range"
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={RANGES.map((r) => ({ value: String(r), label: `${r} days` }))}
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</div>
          <Skeleton className="h-80 rounded-[var(--radius-md)]" />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">Could not load usage. {errorMessage(error)}</div>
      ) : !data || data.totals.calls === 0 ? (
        <EmptyState icon={ChartBarIcon} title={`No model calls in the last ${days} days`} body="Usage appears here as soon as a provider is tested or the playground runs. Agents add to it from P2." />
      ) : (
        <>
          <StatStrip t={data.totals} />

          <section className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold">Tokens per day by provider</h3>
                <p className="text-[12.5px] text-muted">Last {days} days, stacked by provider.</p>
              </div>
              <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" aria-label="Legend">
                {series.map((s) => (
                  <li key={s} className="flex items-center gap-1.5">
                    <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: colors.get(s) ?? "var(--series-other)" }} />
                    <span className="text-muted">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="h-56 w-full min-w-0 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={days > 30 ? "12%" : "24%"}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis dataKey="day" tickFormatter={shortDay} tickLine={false} axisLine={false} minTickGap={28} tick={{ fill: "var(--text-muted)", fontSize: 11.5 }} />
                  <YAxis tickFormatter={(v: number) => compact(v)} width={46} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 11.5 }} />
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

          <UsageBreakdown
            view={view}
            onView={setView}
            colors={colors}
            sets={{
              provider: { label: "Provider", rows: data.by_provider, row: (r) => ({ main: r.provider ?? "", swatch: r.provider }) },
              model: { label: "Model", rows: data.by_model, row: (r) => ({ main: r.provider ?? "", sub: r.model, swatch: r.provider }) },
              task: { label: "Kind of work", rows: data.by_task, row: (r) => ({ main: TASK_LABELS[r.task ?? ""] ?? r.task ?? "" }) },
            }}
          />
        </>
      )}
    </div>
  );
}

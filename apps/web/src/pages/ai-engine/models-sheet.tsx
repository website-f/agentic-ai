import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DataTable, filterOf, TableFilter, useLocalTableState, type Column } from "@/components/ui/data-table";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";

import { aiKeys, modelsQuery, type AIModel, type Provider } from "./data";

const CAP_LABELS: Record<string, string> = {
  tools: msg("Tools"),
  json: "JSON",
  vision: msg("Vision"),
  embed: msg("Embeddings"),
  reasoning: msg("Thinking"),
};

function PriceInput({ model, field, label }: { model: AIModel; field: "price_in" | "price_out" | "price_cached_in"; label: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [value, setValue] = useState(model[field] === null ? "" : String(model[field]));
  const save = useMutation({
    mutationFn: (v: number | null) => api(`/api/ai/models/${model.id}`, "PATCH", { [field]: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai", "models"] }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const commit = () => {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : Number(trimmed);
    if (next !== null && (Number.isNaN(next) || next < 0)) {
      toast.error(t("Prices are numbers in US dollars per million tokens."));
      return;
    }
    if (next !== model[field]) save.mutate(next);
  };
  return (
    <label className="grid gap-0.5">
      <span className="text-[11px] text-muted">{label}</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder="-"
        aria-label={t("{label} for {model}, dollars per million tokens", { label, model: model.model_id })}
        className="h-9 w-full rounded-sm border sm:w-20 border-border bg-surface px-2 font-mono text-[12.5px] tabular focus-visible:border-accent focus-visible:outline-none"
      />
    </label>
  );
}

export function ModelsSheet({ provider, open, onOpenChange }: { provider: Provider; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: models, isLoading, error, refetch } = useQuery({ ...modelsQuery(provider.id), enabled: open });
  const refresh = useMutation({
    mutationFn: () => api<{ total: number; added: number; stale: number }>(`/api/ai/providers/${provider.id}/models/refresh`, "POST"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["ai", "models"] });
      qc.invalidateQueries({ queryKey: aiKeys.providers });
      toast.success(t("{total} models listed. {added} new, {stale} no longer offered.", { total: r.total, added: r.added, stale: r.stale }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  // P107: every model (no longer cut at 200) in a data table kept in memory: search, what it
  // can do, priced or not, still offered or not, sort and pages.
  const control = useLocalTableState({ size: 25 });
  const [cap] = filterOf(control, "cap");
  const [priced] = filterOf(control, "priced");
  const [offered] = filterOf(control, "offered");
  const isPriced = (m: AIModel) => m.price_in !== null || m.price_out !== null;
  const rows = useMemo(() => (models ?? []).filter((m) =>
    (!cap || m.caps[cap as keyof AIModel["caps"]] === true)
    && (!priced || (priced === "yes") === isPriced(m))
    && (!offered || (offered === "stale") === m.stale)), [models, cap, priced, offered]);
  const caps = useMemo(() => Object.keys(CAP_LABELS).filter((c) => (models ?? []).some((m) => m.caps[c as keyof AIModel["caps"]])), [models]);

  const columns: Column<AIModel>[] = [
    {
      id: "model", header: t("Model"), card: "title", sortValue: (m) => m.model_id.toLowerCase(), exportValue: (m) => m.model_id,
      cell: (m) => (
        <span className="grid min-w-0 gap-1">
          <span className="font-mono text-[13px] break-all" title={m.model_id}>{m.model_id}</span>
          <span className="flex flex-wrap gap-1">
            {m.stale ? <Pill tone="warn">{t("No longer offered")}</Pill> : null}
            {Object.entries(m.caps).map(([c, ok]) =>
              ok !== undefined ? (
                <Pill key={c} tone={ok ? "ok" : "neutral"} className={ok ? "" : "line-through"}>
                  {CAP_LABELS[c] ? t(CAP_LABELS[c]) : c}
                </Pill>
              ) : null,
            )}
          </span>
        </span>
      ),
    },
    {
      id: "context", header: t("Context"), kind: "number", align: "right", hideBelow: "lg", sortValue: (m) => m.context_window ?? null,
      cell: (m) => (m.context_window ? <span className="font-mono">{t("{n}k context", { n: Math.round(m.context_window / 1000) })}</span> : <span className="text-muted">-</span>),
    },
    {
      id: "prices", header: t("Prices (US$ per million tokens)"), card: "full",
      cell: (m) => (
        <span className="grid grid-cols-3 gap-2 sm:flex">
          <PriceInput model={m} field="price_in" label={t("Input")} />
          <PriceInput model={m} field="price_cached_in" label={t("Cached")} />
          <PriceInput model={m} field="price_out" label={t("Output")} />
        </span>
      ),
    },
    // Export only: the three prices as numbers.
    { id: "price_in", header: t("Input"), exportOnly: true, cell: () => null, exportValue: (m) => m.price_in },
    { id: "price_cached_in", header: t("Cached"), exportOnly: true, cell: () => null, exportValue: (m) => m.price_cached_in },
    { id: "price_out", header: t("Output"), exportOnly: true, cell: () => null, exportValue: (m) => m.price_out },
  ];

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("{name} models", { name: provider.name })}
      description={t("Set prices in US dollars per million tokens so costs are tracked. Leave blank if unknown.")}
      className="w-[min(94vw,52rem)]"
    >
      <DataTable
        label={t("{name} models", { name: provider.name })}
        columns={columns}
        rows={rows}
        rowId={(m) => m.id}
        rowLabel={(m) => m.model_id}
        control={control}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        searchText={(m) => m.model_id}
        searchPlaceholder={t("Search models")}
        exportName={t("{name} models", { name: provider.name })}
        stickyHeader={false}
        filters={models?.length ? (
          <>
            {caps.length ? <TableFilter control={control} id="cap" label={t("Can do")} allLabel={t("Any ability")}
              options={caps.map((c) => ({ value: c, label: t(CAP_LABELS[c]!) }))} /> : null}
            <TableFilter control={control} id="priced" label={t("Price")} allLabel={t("Priced or not")}
              options={[{ value: "yes", label: t("Priced") }, { value: "no", label: t("No price yet") }]} />
            <TableFilter control={control} id="offered" label={t("Offered")} allLabel={t("Offered or not")}
              options={[{ value: "live", label: t("Still offered") }, { value: "stale", label: t("No longer offered") }]} />
          </>
        ) : undefined}
        toolbarActions={
          <Button variant="outline" onClick={() => refresh.mutate()} loading={refresh.isPending}>
            {!refresh.isPending ? <ArrowClockwiseIcon size={15} /> : null} {t("Refresh list")}
          </Button>
        }
        empty={
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13.5px] text-muted">
            {t("No models listed yet. Run a connection test or refresh the list.")}
          </p>
        }
      />
    </ResponsiveDialog>
  );
}

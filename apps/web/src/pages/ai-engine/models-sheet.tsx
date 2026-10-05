import { ArrowClockwiseIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
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
  const { data: models, isLoading } = useQuery({ ...modelsQuery(provider.id), enabled: open });
  const [q, setQ] = useState("");
  const refresh = useMutation({
    mutationFn: () => api<{ total: number; added: number; stale: number }>(`/api/ai/providers/${provider.id}/models/refresh`, "POST"),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["ai", "models"] });
      qc.invalidateQueries({ queryKey: aiKeys.providers });
      toast.success(t("{total} models listed. {added} new, {stale} no longer offered.", { total: r.total, added: r.added, stale: r.stale }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const shown = useMemo(
    () => (models ?? []).filter((m) => m.model_id.toLowerCase().includes(q.toLowerCase())).slice(0, 200),
    [models, q],
  );

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("{name} models", { name: provider.name })}
      description={t("Set prices in US dollars per million tokens so costs are tracked. Leave blank if unknown.")}
      className="w-[min(94vw,52rem)]"
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-0 flex-1 basis-48">
            <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Search models")}
              aria-label={t("Search models")}
              className="h-10 w-full rounded-sm border border-border bg-surface pr-3 pl-9 text-[13.5px] focus-visible:border-accent focus-visible:outline-none"
            />
          </label>
          <Button variant="outline" onClick={() => refresh.mutate()} loading={refresh.isPending}>
            {!refresh.isPending ? <ArrowClockwiseIcon size={15} /> : null} {t("Refresh list")}
          </Button>
        </div>
        {isLoading ? (
          <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : shown.length ? (
          <ul className="max-h-[52dvh] divide-y divide-border overflow-y-auto rounded-[var(--radius-md)] border border-border">
            {shown.map((m) => (
              <li key={m.id} className="flex flex-wrap items-end gap-x-4 gap-y-2 px-3.5 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-mono text-[13px] break-all" title={m.model_id}>{m.model_id}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.stale ? <Pill tone="warn">{t("No longer offered")}</Pill> : null}
                    {m.context_window ? <Pill>{t("{n}k context", { n: Math.round(m.context_window / 1000) })}</Pill> : null}
                    {Object.entries(m.caps).map(([cap, ok]) =>
                      ok !== undefined ? (
                        <Pill key={cap} tone={ok ? "ok" : "neutral"} className={ok ? "" : "line-through"}>
                          {CAP_LABELS[cap] ? t(CAP_LABELS[cap]) : cap}
                        </Pill>
                      ) : null,
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 max-sm:w-full sm:flex">
                  <PriceInput model={m} field="price_in" label={t("Input")} />
                  <PriceInput model={m} field="price_cached_in" label={t("Cached")} />
                  <PriceInput model={m} field="price_out" label={t("Output")} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-8 text-center text-[13.5px] text-muted">
            {models?.length ? t("No model matches that search.") : t("No models listed yet. Run a connection test or refresh the list.")}
          </p>
        )}
      </div>
    </ResponsiveDialog>
  );
}

import {
  CheckCircleIcon,
  CpuIcon,
  DotsThreeIcon,
  ListBulletsIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlugsConnectedIcon,
  PlusIcon,
  PowerIcon,
  QuestionIcon,
  SnowflakeIcon,
  TrashIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { cn, timeAgo } from "@/lib/utils";

import { aiKeys, modelsQuery, presetsQuery, providerColors, providersQuery, type Preset, type Provider } from "./data";
import { ModelsSheet } from "./models-sheet";
import { ProviderDialog } from "./provider-dialog";
import { TestControls, TestSteps, useConnectionTest } from "./test-runner";

const HEALTH = {
  ok: { label: "Working", cls: "text-ok", icon: CheckCircleIcon },
  degraded: { label: "Key works, chat failing", cls: "text-warn", icon: WarningCircleIcon },
  down: { label: "Not working", cls: "text-danger", icon: XCircleIcon },
  unknown: { label: "Not tested yet", cls: "text-muted", icon: QuestionIcon },
} as const;

export function Monogram({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid size-10 shrink-0 place-items-center rounded-[var(--radius-md)] text-[15px] font-semibold text-white", className)}
      style={{ background: color }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Last 24 health checks, oldest first. Status color always comes with the text label beside it. */
function HealthSpark({ checks }: { checks: Provider["recent_checks"] }) {
  const slots = 24;
  const pad = Array.from({ length: Math.max(0, slots - checks.length) }, () => null);
  const cells = [...pad, ...checks];
  const okCount = checks.filter((c) => c.ok).length;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <svg
        viewBox={`0 0 ${slots * 5} 14`}
        preserveAspectRatio="none"
        className="h-3.5 w-full max-w-[120px] min-w-0 flex-1"
        role="img"
        aria-label={checks.length ? `${okCount} of ${checks.length} recent checks passed` : "No checks yet"}
      >
        {cells.map((c, i) => (
          <rect
            key={i}
            x={i * 5}
            y={c && !c.ok ? 0 : 3}
            width={3}
            height={c && !c.ok ? 14 : 11}
            rx={1.5}
            fill={c === null ? "var(--border)" : c.ok ? "var(--ok)" : "var(--danger)"}
          >
            {c ? <title>{`${new Date(c.ts).toLocaleString()}: ${c.ok ? "passed" : "failed"}${c.latency_ms ? `, ${c.latency_ms} ms` : ""}`}</title> : null}
          </rect>
        ))}
      </svg>
      <span className="shrink-0 text-[12px] text-muted tabular">{checks.length ? `${okCount}/${checks.length}` : "No checks"}</span>
    </div>
  );
}

function TestDialog({ provider, open, onOpenChange }: { provider: Provider; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { data: models } = useQuery({ ...modelsQuery(provider.id), enabled: open });
  const [model, setModel] = useState(provider.last_test_result?.model ?? "");
  const [capabilities, setCapabilities] = useState(false);
  const test = useConnectionTest();
  const run = async () => {
    await test.run({ provider_id: provider.id, model: model || null, capabilities });
    qc.invalidateQueries({ queryKey: aiKeys.providers });
    qc.invalidateQueries({ queryKey: ["ai", "models"] });
  };
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title={`Test ${provider.name}`} description="Uses the saved key and address." className="w-[min(94vw,34rem)]">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        <TestControls
          models={(models ?? []).filter((m) => !m.stale).map((m) => m.model_id)}
          model={model}
          onModel={setModel}
          capabilities={capabilities}
          onCapabilities={setCapabilities}
          onRun={run}
          running={test.running}
        />
        <TestSteps steps={test.steps} done={test.done} error={test.error} />
      </div>
    </ResponsiveDialog>
  );
}

function ProviderCard({ provider, color, canManage }: { provider: Provider; color: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<null | "test" | "models" | "edit" | "remove">(null);
  const [editKey, setEditKey] = useState(0);
  const h = HEALTH[provider.health];
  const toggle = useMutation({
    mutationFn: () => api(`/api/ai/providers/${provider.id}`, "PATCH", { enabled: !provider.enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiKeys.providers });
      toast.success(provider.enabled ? `${provider.name} turned off. Groups will skip it.` : `${provider.name} turned on.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col rounded-[var(--radius-md)] border border-border bg-surface shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] transition-[border-color,box-shadow] hover:shadow-[var(--shadow-soft)]",
        !provider.enabled && "opacity-70",
      )}
    >
      <div className="flex items-start gap-3 p-4">
        <Monogram name={provider.name} color={color} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="min-w-0 text-[15px] font-semibold break-words">{provider.name}</h3>
            <Pill tone={provider.tier === "paid" ? "info" : "accent"} className="capitalize">{provider.tier}</Pill>
            {!provider.enabled ? <Pill>Off</Pill> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-[12px] text-muted" title={provider.base_url}>{provider.base_url}</p>
        </div>
        {canManage ? (
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Options for ${provider.name}`}>
                <DotsThreeIcon size={20} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<PencilSimpleIcon />} onSelect={() => { setEditKey((k) => k + 1); setDialog("edit"); }}>Edit or replace key</MenuItem>
              <MenuItem icon={<PowerIcon />} onSelect={() => toggle.mutate()}>{provider.enabled ? "Turn off" : "Turn on"}</MenuItem>
              <MenuSeparator />
              <MenuItem icon={<TrashIcon />} danger onSelect={() => setDialog("remove")}>Remove provider</MenuItem>
            </MenuContent>
          </Menu>
        ) : null}
      </div>

      <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-border bg-surface-2/30 px-4 py-3 text-[12.5px]">
        <div className="min-w-0">
          <dt className="text-muted">Status</dt>
          <dd className={cn("mt-0.5 flex items-start gap-1.5 font-medium", h.cls)}>
            <h.icon size={15} weight="fill" className="mt-px shrink-0" /> <span className="min-w-0">{h.label}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Key</dt>
          <dd className="mt-0.5 truncate font-mono">{provider.key_hint || "None"}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Recent checks</dt>
          <dd className="mt-1"><HealthSpark checks={provider.recent_checks} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted">Models</dt>
          <dd className="mt-0.5 tabular">{provider.model_count || "Not listed yet"}</dd>
        </div>
      </dl>

      {provider.cooling_seconds > 0 ? (
        <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-sm bg-info/10 px-2.5 py-1.5 text-[12.5px] text-info">
          <SnowflakeIcon size={14} className="mt-0.5 shrink-0" /> Resting for {provider.cooling_seconds} s after an error. Groups use the next model meanwhile.
        </p>
      ) : null}
      {provider.last_test_result && !provider.last_test_result.ok ? (
        <p className="mx-4 mb-3 flex items-start gap-1.5 rounded-sm bg-danger/8 px-2.5 py-1.5 text-[12.5px] break-words text-danger">
          <WarningCircleIcon size={14} weight="fill" className="mt-0.5 shrink-0" />
          <span className="min-w-0">{provider.last_test_result.summary}</span>
        </p>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
        <span className="min-w-0 flex-1 text-[12px] text-muted">
          {provider.last_test_at ? `Tested ${timeAgo(provider.last_test_at).toLowerCase()}` : "Never tested"}
        </span>
        <Button size="sm" variant="ghost" onClick={() => setDialog("models")}>
          <ListBulletsIcon size={15} /> Models
        </Button>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={() => setDialog("test")}>
            <PlayIcon size={14} weight="fill" /> Test
          </Button>
        ) : null}
      </div>

      {dialog === "test" ? <TestDialog provider={provider} open onOpenChange={(o) => !o && setDialog(null)} /> : null}
      {dialog === "models" ? <ModelsSheet provider={provider} open onOpenChange={(o) => !o && setDialog(null)} /> : null}
      <ProviderDialog key={editKey} provider={provider} open={dialog === "edit"} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog
        open={dialog === "remove"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Remove ${provider.name}?`}
        body="Its key is deleted and it is taken out of every model group. Usage history is kept."
        confirmLabel="Remove provider"
        danger
        onConfirm={async () => {
          try {
            await api(`/api/ai/providers/${provider.id}`, "DELETE");
            qc.invalidateQueries({ queryKey: ["ai"] });
            qc.invalidateQueries({ queryKey: keys.status });
            toast.success(`${provider.name} removed.`);
          } catch (e) {
            toast.error(errorMessage(e));
          }
        }}
      />
    </article>
  );
}

function PresetTile({ preset, onConnect }: { preset: Preset; onConnect: () => void }) {
  return (
    <button
      type="button"
      onClick={onConnect}
      className="group flex min-w-0 items-start gap-3 rounded-[var(--radius-md)] border border-dashed border-border bg-surface/60 p-3.5 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft/30 focus-visible:border-accent"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-surface-2 text-[14px] font-semibold text-muted transition-colors group-hover:bg-accent-soft group-hover:text-accent">
        {preset.name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] font-medium">
          {preset.name}
          <Pill tone={preset.tier === "paid" ? "info" : "accent"} className="px-2 py-0 text-[11px]">
            {preset.tier === "free" ? "Free tier" : preset.tier === "paid" ? "Paid" : "Local"}
          </Pill>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-muted">{preset.notes}</span>
      </span>
      <PlusIcon size={16} className="mt-1 shrink-0 text-muted group-hover:text-accent" />
    </button>
  );
}

export function ProvidersTab({ canManage }: { canManage: boolean }) {
  const { data: providers, isLoading, error } = useQuery(providersQuery);
  const { data: presets = [] } = useQuery(presetsQuery);
  const [connect, setConnect] = useState<{ preset: Preset | null; key: number } | null>(null);
  const [opens, setOpens] = useState(0);
  const colors = useMemo(() => providerColors(providers ?? []), [providers]);

  const used = new Set((providers ?? []).map((p) => p.preset).filter(Boolean));
  const available = presets.filter((p) => !used.has(p.id));
  const primary = available.filter((p) => p.primary);
  const optional = available.filter((p) => !p.primary);
  // A fresh key per open remounts the dialog, so every connect starts with empty fields.
  const open = (preset: Preset | null) => {
    setOpens((n) => n + 1);
    setConnect({ preset, key: opens + 1 });
  };

  if (isLoading) {
    return (
      <div className="grid gap-5">
        <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[6.5rem] rounded-[var(--radius-md)]" />)}</StatGrid>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">{[0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-[var(--radius-md)]" />)}</div>
      </div>
    );
  }
  if (error) {
    return <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 p-4 text-[13.5px] text-danger">Could not load providers. {errorMessage(error)}</div>;
  }

  const list = providers ?? [];
  const on = list.filter((p) => p.enabled);
  const working = on.filter((p) => p.health === "ok").length;
  const attention = on.filter((p) => p.health === "degraded" || p.health === "down").length;
  const untested = on.filter((p) => p.health === "unknown").length;
  const models = list.reduce((n, p) => n + p.model_count, 0);

  return (
    <div className="grid gap-8">
      {list.length ? (
        <div className="grid gap-5">
          <StatGrid>
            <Stat label="Connected" value={list.length} icon={PlugsConnectedIcon} tone="accent"
              hint={list.length - on.length ? `${list.length - on.length} turned off` : "All turned on"} />
            <Stat label="Working" value={working} icon={CheckCircleIcon} tone="ok"
              hint={untested ? `${untested} not tested yet` : `of ${on.length} turned on`} />
            <Stat label="Need attention" value={attention} icon={WarningCircleIcon} tone={attention ? "danger" : "neutral"}
              hint={attention ? "Failing their last checks" : "Nothing failing"} />
            <Stat label="Models listed" value={models.toLocaleString()} icon={CpuIcon} tone="info" hint="Across all providers" />
          </StatGrid>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            {list.map((p) => (
              <ProviderCard key={p.id} provider={p} color={colors.get(p.id) ?? "var(--series-other)"} canManage={canManage} />
            ))}
          </div>
        </div>
      ) : (
        <EmptyState
          icon={CpuIcon}
          title="No AI providers connected"
          body="Agents need at least one. Paste a key below, test it, and save. Free tiers from Groq, OpenRouter, Mistral and HuggingFace are enough to start."
        />
      )}

      {canManage && available.length ? (
        <Section
          guide="ai-engine.add"
          title="Connect a provider"
          description="Addresses are filled in. You only need the key."
          actions={
            <Button variant="outline" size="sm" onClick={() => open(null)}>
              <PlusIcon size={15} /> Other OpenAI-compatible
            </Button>
          }
        >
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...primary, ...optional].map((p) => <PresetTile key={p.id} preset={p} onConnect={() => open(p)} />)}
          </div>
        </Section>
      ) : null}

      {connect ? (
        <ProviderDialog key={connect.key} preset={connect.preset} open onOpenChange={(o) => !o && setConnect(null)} />
      ) : null}
    </div>
  );
}

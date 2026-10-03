import { ArrowSquareOutIcon, EyeIcon, EyeSlashIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { api, ApiError, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";

import { aiKeys, type Preset, type Provider, type Tier } from "./data";
import { TestControls, TestSteps, useConnectionTest } from "./test-runner";

const TIERS = [
  { value: "free", label: "Free tier", hint: "Calls are counted but cost $0." },
  { value: "paid", label: "Paid", hint: "Cost comes from the model prices you set." },
  { value: "local", label: "Local", hint: "Runs on your own hardware." },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preset?: Preset | null; // connecting a known provider
  provider?: Provider; // editing an existing one
}

/** Connect or edit a provider. Remounted with a fresh key per open by the caller. */
export function ProviderDialog({ open, onOpenChange, preset, provider }: Props) {
  const qc = useQueryClient();
  const editing = !!provider;
  const [name, setName] = useState(provider?.name ?? preset?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? preset?.base_url ?? "https://");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [tier, setTier] = useState<Tier>(provider?.tier ?? preset?.tier ?? "paid");
  const [model, setModel] = useState(provider?.last_test_result?.model ?? "");
  const [capabilities, setCapabilities] = useState(false);
  const test = useConnectionTest();

  const urlChanged = editing && baseUrl.trim().replace(/\/$/, "") !== provider.base_url;
  const keyNeeded = !editing || urlChanged;
  const presetId = provider?.preset ?? preset?.id ?? null;

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api<Provider>(`/api/ai/providers/${provider.id}`, "PATCH", {
            name,
            tier,
            ...(urlChanged ? { base_url: baseUrl } : {}),
            ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          })
        : api<Provider>("/api/ai/providers", "POST", { name, preset: presetId, base_url: baseUrl, api_key: apiKey.trim(), tier }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: aiKeys.providers });
      qc.invalidateQueries({ queryKey: keys.status });
      toast.success(editing ? `${name} updated.` : `${name} connected.`);
      onOpenChange(false);
    },
  });
  const fields = save.error instanceof ApiError ? save.error.fields : {};

  const runTest = () => {
    const typedKey = apiKey.trim();
    if (editing && !typedKey && !urlChanged) {
      test.run({ provider_id: provider.id, model: model || null, capabilities });
    } else {
      test.run({ preset: presetId, name, base_url: baseUrl.trim(), api_key: typedKey, tier, model: model || null, capabilities });
    }
  };
  const canTest = editing ? (!urlChanged || apiKey.trim().length >= 8) : apiKey.trim().length >= 8 && baseUrl.length > 10;
  const canSave = name.trim() && baseUrl.length > 10 && (!keyNeeded || apiKey.trim().length >= 8);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? `Edit ${provider.name}` : preset ? `Connect ${preset.name}` : "Connect a provider"}
      description={preset?.notes || (editing ? undefined : "Any service with an OpenAI-compatible API works here.")}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
            {editing ? "Save changes" : "Save provider"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {preset?.key_url ? (
          <a
            href={preset.key_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
          >
            Get a {preset.name} key <ArrowSquareOutIcon size={14} />
          </a>
        ) : null}

        <div className="grid gap-1.5">
          <label htmlFor="provider-key" className="text-[13px] font-medium">
            API key
          </label>
          <div className="relative">
            <input
              id="provider-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={editing ? `Saved key ${provider.key_hint}. Leave blank to keep it.` : "Paste the key"}
              aria-invalid={!!fields.api_key}
              className="h-10 w-full rounded-sm border border-border bg-surface pr-11 pl-3 font-mono text-[13px] placeholder:font-sans placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              aria-label={showKey ? "Hide key" : "Show key"}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-sm p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
            >
              {showKey ? <EyeSlashIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
          <p className="text-[12.5px] text-muted">
            {urlChanged
              ? "You changed the address, so type the key again. A saved key is never sent to a new address."
              : "Stored encrypted. Only the last four characters are ever shown again."}
          </p>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} error={fields.name} />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Billing</span>
            <Select value={tier} onValueChange={(v) => setTier(v as Tier)} options={TIERS} label="Billing" />
          </div>
        </div>
        <Field
          label="API address"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="[&_input]:font-mono [&_input]:text-[13px]"
          hint={preset ? "Filled in for you. Change it only if the provider moved its API." : "The OpenAI-compatible base URL, usually ending in /v1."}
          error={fields.base_url}
        />

        <div className="rounded-[var(--radius-md)] border border-border bg-surface-2/40 p-3.5">
          <TestControls
            models={test.done?.models ?? []}
            model={model}
            onModel={setModel}
            capabilities={capabilities}
            onCapabilities={setCapabilities}
            onRun={runTest}
            running={test.running}
            disabled={!canTest}
          />
          {test.steps.length || test.error ? (
            <div className="mt-3">
              <TestSteps steps={test.steps} done={test.done} error={test.error} />
            </div>
          ) : null}
        </div>
        <FormError message={save.error && !Object.keys(fields).length ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

import {
  ArrowRightIcon,
  CloudArrowUpIcon,
  EyeIcon,
  HardDrivesIcon,
  LockKeyIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { locale, useT } from "@/i18n";
import { ApiError, errorMessage } from "@/lib/api";
import {
  CATEGORY_LABEL,
  cloudUsesForLocalOnly,
  countPlaceholders,
  DATA_LEVELS,
  LEVEL_HINT,
  LEVEL_LABEL,
  LOCAL_ONLY_LIMIT,
  MASKED_CATEGORIES,
  patchBranchDataLevel,
  previewPrivacy,
  privacyKeys,
  privacyQuery,
  SAMPLE_TEXT,
  savePrivacy,
  splitMasked,
  untrustedUses,
  type CompanyPrivacy,
  type DataLevel,
  type PrivacyCategory,
  type PrivacyPreview,
  type PrivacySettings,
  type PrivacyUpdate,
  type ProviderUse,
} from "@/lib/privacy";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { providersQuery } from "./data";

/** One color per masked category, used for the placeholder chips and the counts alike. */
const CATEGORY_STYLE: Record<PrivacyCategory, { chip: string; dot: string }> = {
  ids: { chip: "bg-info/12 text-info ring-info/30", dot: "bg-info" },
  people: { chip: "bg-accent-soft text-accent ring-accent/30", dot: "bg-accent" },
  companies: { chip: "bg-warn/14 text-warn ring-warn/30", dot: "bg-warn" },
  amounts: { chip: "bg-ok/12 text-ok ring-ok/30", dot: "bg-ok" },
};

const CATEGORY_ORDER: PrivacyCategory[] = ["ids", "people", "companies", "amounts"];

// ------------------------------------------------------------------------------------- protection

function HowItWorks() {
  const t = useT();
  const steps: { icon: Icon; title: string; body: string }[] = [
    { icon: LockKeyIcon, title: t("1. Masked on our server"), body: t("Private details become placeholders like [PERSON_K7Q2A].") },
    { icon: CloudArrowUpIcon, title: t("2. Provider sees placeholders"), body: t("The cloud AI never receives the real names, IDs or numbers.") },
    { icon: ShieldCheckIcon, title: t("3. Real values put back"), body: t("Our server restores them in the answer and in the agent's actions.") },
  ];
  return (
    <ol className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-3">
      {steps.map((s, i) => (
        <li key={i} className="relative flex min-w-0 items-start gap-2.5 rounded-[var(--radius-sm)] border border-border bg-surface-2/40 px-3 py-2.5">
          <s.icon size={18} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">{s.title}</span>
            <span className="block text-[12.5px] text-muted">{s.body}</span>
          </span>
          {i < steps.length - 1 ? (
            <ArrowRightIcon aria-hidden size={14} className="absolute top-1/2 -right-2.5 z-10 hidden -translate-y-1/2 rounded-full bg-surface text-muted sm:block" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ProtectionCard({ settings, canManage }: { settings: PrivacySettings; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: PrivacyUpdate) => savePrivacy(body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: privacyKeys.settings });
      const before = qc.getQueryData<PrivacySettings>(privacyKeys.settings);
      if (before) {
        qc.setQueryData<PrivacySettings>(privacyKeys.settings, {
          ...before,
          masking: body.masking ?? before.masking,
          categories: { ...before.categories, ...body.categories },
        });
      }
      return { before };
    },
    onError: (e, _body, ctx) => {
      if (ctx?.before) qc.setQueryData(privacyKeys.settings, ctx.before);
      toast.error(errorMessage(e));
    },
    onSuccess: () => toast.success(t("Privacy settings saved.")),
    onSettled: () => qc.invalidateQueries({ queryKey: privacyKeys.settings }),
  });
  const on = settings.masking;

  return (
    <Card className="grid gap-5 p-4 sm:p-5">
      <SwitchField
        checked={on}
        disabled={!canManage || save.isPending}
        onCheckedChange={(v) => save.mutate({ masking: v })}
        label={t("Protect data sent to AI providers")}
        hint={t(
          "Before anything is sent to a cloud AI provider, IDs and bank or card numbers, people's names and contacts, and company names are swapped for placeholders like [PERSON_K7Q2A]. The provider only ever sees the placeholders. Our server puts the real values back in the answer and in the agent's actions, so your team sees normal text. The local model on this server is never masked, because nothing leaves.",
        )}
      />
      <HowItWorks />
      <fieldset className="grid gap-2" disabled={!canManage || !on}>
        <legend className="mb-2 text-[13px] font-medium">{t("What to mask")}</legend>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {CATEGORY_ORDER.map((c) => {
            const checked = settings.categories[c];
            const style = CATEGORY_STYLE[c];
            return (
              <label
                key={c}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-2.5 rounded-sm border px-3 py-2.5 text-[13.5px] transition-colors",
                  checked && on ? "border-accent/50 bg-accent-soft/30" : "border-border bg-surface",
                  (!canManage || !on) && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => save.mutate({ categories: { [c]: e.target.checked } })}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span aria-hidden className={cn("size-2 rounded-full", style.dot)} />
                    {t(CATEGORY_LABEL[c])}
                  </span>
                  <span className="block text-[12.5px] text-muted">
                    {c === "ids" ? t("MyKad, passport, bank account and card numbers.") : null}
                    {c === "people" ? t("Names, phone numbers, emails and addresses.") : null}
                    {c === "companies" ? t("Company names, tender and reference numbers.") : null}
                    {c === "amounts" ? t("Off keeps quotations and calculations accurate.") : null}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {!on ? (
        <p role="status" className="flex items-start gap-2 rounded-sm bg-warn/12 px-3 py-2 text-[12.5px] text-warn">
          <WarningIcon size={15} weight="fill" className="mt-px shrink-0" />
          {t("Protection is off. Cloud providers receive your text exactly as written.")}
        </p>
      ) : null}
      {!canManage ? <p className="text-[12.5px] text-muted">{t("You need AI Engine management permission to change these settings.")}</p> : null}
    </Card>
  );
}

// ------------------------------------------------------------------------------------- preview

function MaskedText({ text }: { text: string }) {
  const t = useT();
  const segments = useMemo(() => splitMasked(text), [text]);
  return (
    <p className="text-[13.5px] leading-[1.9] break-words whitespace-pre-wrap">
      {segments.map((s, i) =>
        s.type === "text" ? (
          <span key={i}>{s.text}</span>
        ) : (
          <mark
            key={i}
            title={t(CATEGORY_LABEL[s.category])}
            className={cn("mx-px rounded-[5px] px-1.5 py-0.5 font-mono text-[12px] font-medium ring-1 ring-inset [box-decoration-break:clone]", CATEGORY_STYLE[s.category].chip)}
          >
            {s.text}
          </mark>
        ),
      )}
    </p>
  );
}

function PreviewCard({ settings, canRun }: { settings: PrivacySettings; canRun: boolean }) {
  const t = useT();
  const id = useId();
  const [text, setText] = useState(() => t(SAMPLE_TEXT));
  const [branch, setBranch] = useState("");
  const [shown, setShown] = useState<{ input: string; result: PrivacyPreview } | null>(null);
  const run = useMutation({
    mutationFn: () => previewPrivacy(text, branch || null),
    onSuccess: (result) => setShown({ input: text, result }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const counts = shown ? { ...countPlaceholders(shown.result.masked), ...shown.result.counts } : null;
  const tiles: PrivacyCategory[] = settings.masking && settings.categories.amounts ? [...MASKED_CATEGORIES, "amounts"] : [...MASKED_CATEGORIES];
  const total = counts ? tiles.reduce((n, c) => n + (counts[c] ?? 0), 0) : 0;
  const stale = !!shown && shown.input !== text;

  return (
    <Card className="grid overflow-hidden lg:grid-cols-2">
      <div className="grid content-start gap-3 border-border p-4 max-lg:border-b sm:p-5 lg:border-r">
        <label htmlFor={`${id}-text`} className="text-[13px] font-medium">{t("What your team writes")}</label>
        <textarea
          id={`${id}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && text.trim() && canRun) run.mutate();
          }}
          rows={7}
          className="w-full min-w-0 resize-y rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          {settings.companies.length ? (
            <Select
              size="sm"
              label={t("Company")}
              value={branch || "any"}
              onValueChange={(v) => setBranch(v === "any" ? "" : v)}
              options={[
                { value: "any", label: t("Any company") },
                ...settings.companies.map((c) => ({ value: c.branch_id, label: c.name, hint: t(LEVEL_LABEL[c.data_level]) })),
              ]}
              className="min-w-0 flex-1 sm:max-w-[16rem]"
            />
          ) : null}
          <Button size="sm" onClick={() => run.mutate()} loading={run.isPending} disabled={!text.trim() || !canRun} className="ml-auto">
            <EyeIcon size={15} /> {t("Preview")}
          </Button>
        </div>
        <button type="button" onClick={() => setText(t(SAMPLE_TEXT))} className="justify-self-start text-[12.5px] text-muted underline-offset-2 hover:text-fg hover:underline">
          {t("Use the example again")}
        </button>
        {!canRun ? <p className="text-[12.5px] text-muted">{t("You need AI Engine management permission to run the preview.")}</p> : null}
      </div>

      <div className="grid min-w-0 content-start gap-3 bg-surface-2/30 p-4 sm:p-5" aria-live="polite">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium">{t("What the AI provider sees")}</h3>
          {stale ? <Pill tone="warn">{t("Text changed: preview again")}</Pill> : null}
        </div>
        {shown ? (
          <>
            <div className={cn("min-h-[9.5rem] rounded-sm border border-border bg-surface px-3 py-2.5 transition-opacity", stale && "opacity-60")}>
              <MaskedText text={shown.result.masked} />
            </div>
            <ul className={cn("grid gap-2", tiles.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
              {tiles.map((c) => {
                const S = CATEGORY_STYLE[c];
                return (
                  <li key={c} className="min-w-0 rounded-sm border border-border bg-surface px-2.5 py-2">
                    <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", S.dot)} />
                      <span className="truncate">{t(CATEGORY_LABEL[c])}</span>
                    </span>
                    <span className="mt-0.5 block text-[20px] leading-tight font-semibold tabular">{(counts?.[c] ?? 0).toLocaleString(locale())}</span>
                  </li>
                );
              })}
            </ul>
            <p className="text-[12.5px] text-muted">
              {!settings.masking
                ? t("Protection is off, so nothing was masked.")
                : total
                  ? t("{n} private details never leave your server.", { n: total })
                  : t("Nothing private found in this text.")}{" "}
              {settings.masking && !settings.categories.amounts ? t("Amounts stay readable.") : null}
            </p>
          </>
        ) : (
          <div className="grid min-h-[9.5rem] place-items-center rounded-sm border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">
            <span className="grid justify-items-center gap-2">
              <ShieldCheckIcon size={22} weight="duotone" className="text-accent" />
              {t("Press Preview to see the text exactly as a cloud provider would receive it.")}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------------------------- companies

function ProviderChip({ use, alarm }: { use: ProviderUse; alarm: boolean }) {
  const t = useT();
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
        alarm ? "border-danger/40 bg-danger/8 text-danger" : "border-border bg-surface",
      )}
    >
      <span className="min-w-0 truncate font-medium">{use.name}</span>
      {use.trusted ? (
        <span className="inline-flex items-center gap-0.5 text-ok" title={t("Trusted for confidential data")}>
          <ShieldCheckIcon size={13} weight="fill" />
          <span className="sr-only">{t("Trusted")}</span>
        </span>
      ) : null}
      <span className={cn("shrink-0 tabular", !alarm && "text-muted")}>
        {use.calls === 1 ? t("1 call") : t("{n} calls", { n: use.calls.toLocaleString(locale()) })}
        {" · "}
        {t("{n} masked", { n: use.masked.toLocaleString(locale()) })}
      </span>
    </span>
  );
}

function CompanyRow({ company, canSetLevels, localIds }: { company: CompanyPrivacy; canSetLevels: boolean; localIds: ReadonlySet<string> }) {
  const t = useT();
  const qc = useQueryClient();
  const setLevel = useMutation({
    mutationFn: (level: DataLevel) => patchBranchDataLevel(company.branch_id, level),
    onSuccess: (_r, level) => {
      qc.invalidateQueries({ queryKey: privacyKeys.settings });
      qc.invalidateQueries({ queryKey: keys.branches });
      toast.success(t("{name} is now {level}.", { name: company.name, level: t(LEVEL_LABEL[level]) }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const level = setLevel.isPending && setLevel.variables ? setLevel.variables : company.data_level;
  const untrusted = untrustedUses(company);
  const leaked = cloudUsesForLocalOnly(company, localIds);
  const alarmIds = new Set([...untrusted, ...leaked].map((p) => p.provider_id));
  const used = company.providers_30d.filter((p) => p.calls > 0);

  return (
    <li className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3.5 sm:px-5 md:grid-cols-[minmax(0,14rem)_minmax(0,15rem)_minmax(0,1fr)] md:items-start">
      <div className="min-w-0">
        <p className="text-[14px] font-medium break-words">{company.name}</p>
        <p className="text-[12.5px] text-muted">{t(LEVEL_HINT[level])}</p>
      </div>
      <div className="min-w-0">
        <Select
          size="sm"
          label={t("Data protection for {name}", { name: company.name })}
          value={level}
          disabled={!canSetLevels || setLevel.isPending}
          onValueChange={(v) => v !== company.data_level && setLevel.mutate(v as DataLevel)}
          options={DATA_LEVELS.map((l) => ({ value: l, label: t(LEVEL_LABEL[l]), hint: t(LEVEL_HINT[l]) }))}
          className="w-full"
        />
        {level === "local_only" ? <p className="mt-1.5 text-[12px] text-warn">{t(LOCAL_ONLY_LIMIT)}</p> : null}
      </div>
      <div className="grid min-w-0 gap-2">
        {used.length ? (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {used.map((p) => <ProviderChip key={p.provider_id} use={p} alarm={alarmIds.has(p.provider_id)} />)}
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">{t("No AI calls in the last 30 days.")}</p>
        )}
        {untrusted.length ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-sm bg-danger/8 px-2.5 py-1.5 text-[12.5px] text-danger">
            <ShieldWarningIcon size={15} weight="fill" className="mt-px shrink-0" />
            <span className="min-w-0">
              {t("Confidential, but used providers that are not trusted: {names}. Mark them trusted on Providers only if your agreement rules out training and retention.", {
                names: untrusted.map((p) => p.name).join(", "),
              })}
            </span>
          </p>
        ) : null}
        {leaked.length ? (
          <p role="alert" className="flex items-start gap-1.5 rounded-sm bg-danger/8 px-2.5 py-1.5 text-[12.5px] text-danger">
            <ShieldWarningIcon size={15} weight="fill" className="mt-px shrink-0" />
            <span className="min-w-0">{t("Local only, but cloud providers were used: {names}.", { names: leaked.map((p) => p.name).join(", ") })}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function CompaniesCard({ settings, canSetLevels }: { settings: PrivacySettings; canSetLevels: boolean }) {
  const t = useT();
  const { data: providers } = useQuery(providersQuery);
  const localIds = useMemo(() => new Set((providers ?? []).filter((p) => p.tier === "local").map((p) => p.id)), [providers]);
  if (!settings.companies.length) {
    return <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted">{t("No companies yet. Add one on the Organization page.")}</p>;
  }
  return (
    <Card className="overflow-hidden">
      <div className="hidden grid-cols-[minmax(0,14rem)_minmax(0,15rem)_minmax(0,1fr)] gap-3 border-b border-border bg-surface-2/40 px-5 py-2 text-[12px] font-medium text-muted md:grid">
        <span>{t("Company")}</span>
        <span>{t("Data protection")}</span>
        <span>{t("AI providers used, last 30 days")}</span>
      </div>
      <ul className="divide-y divide-border">
        {settings.companies.map((c) => <CompanyRow key={c.branch_id} company={c} canSetLevels={canSetLevels} localIds={localIds} />)}
      </ul>
      {!canSetLevels ? <p className="border-t border-border px-5 py-2 text-[12px] text-muted">{t("Only people who manage the organization can change a company's data protection.")}</p> : null}
    </Card>
  );
}

// ------------------------------------------------------------------------------------- tab

export function PrivacyTab({ canManage, canSetLevels }: { canManage: boolean; canSetLevels: boolean }) {
  const t = useT();
  const { data: settings, isPending, error } = useQuery(privacyQuery);

  if (isPending) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-72 rounded-[var(--radius-md)]" />
        <Skeleton className="h-64 rounded-[var(--radius-md)]" />
      </div>
    );
  }
  if (error || !settings) {
    const missing = error instanceof ApiError && error.status === 404;
    return (
      <div role="alert" className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-4 text-[13.5px]">
        <HardDrivesIcon size={18} className="mt-px shrink-0 text-muted" />
        <span>{missing ? t("This server does not have AI privacy controls yet. Update the server to turn them on.") : `${t("Could not load privacy settings.")} ${errorMessage(error)}`}</span>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <Section title={t("Protect data sent to AI providers")} description={t("Decide what stays private when agents use a cloud AI.")}>
        <ProtectionCard settings={settings} canManage={canManage} />
      </Section>
      <Section title={t("See what the AI provider sees")} description={t("Type or paste anything. Nothing is sent to an AI provider by this preview.")}>
        <PreviewCard settings={settings} canRun={canManage} />
      </Section>
      <Section
        title={t("Data protection per company")}
        description={t("Standard: any provider, masked. Confidential: only trusted providers. Local only: nothing leaves the server.")}
      >
        <CompaniesCard settings={settings} canSetLevels={canSetLevels} />
      </Section>
    </div>
  );
}

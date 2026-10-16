/** Pieces the Business pages (Contacts, Deals, Money) share: the "server not updated" notice,
 * role pills, money in the UI language, a company filter and a contact picker. */
import { BuildingOfficeIcon, CheckIcon, PlugsIcon, UserIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";

import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { Select } from "@/components/ui/select";
import { useLang, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { ALL_COMPANIES, useCompanies } from "@/lib/company";
import { isMissingApi, partySearchQuery, ROLE_LABEL, ROLE_TONE, type Party, type PartyRole } from "@/lib/crm";
import { formatDay, formatMoney, formatMoneyShort } from "@/lib/money";
import { useDebounced } from "@/lib/paged";
import { cn } from "@/lib/utils";

/** P35 is not on this server yet: say so plainly instead of showing an error. */
export function MissingBusiness({ className }: { className?: string }) {
  const t = useT();
  return (
    <p role="status" className={cn("flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2.5 text-[12.5px]", className)}>
      <PlugsIcon size={15} className="mt-0.5 shrink-0 text-warn" />
      <span className="min-w-0">{t("This server does not have contacts, deals and money yet. Update the server to turn them on.")}</span>
    </p>
  );
}

/** A failed query: the notice for a missing API, else the error in red. */
export function LoadError({ error, className }: { error: unknown; className?: string }) {
  if (isMissingApi(error)) return <MissingBusiness className={className} />;
  return <p role="alert" className={cn("text-[13.5px] text-danger", className)}>{errorMessage(error)}</p>;
}

export function RolePills({ roles, className }: { roles: PartyRole[]; className?: string }) {
  const t = useT();
  if (!roles.length) return null;
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {roles.map((r) => <Pill key={r} tone={ROLE_TONE[r]}>{t(ROLE_LABEL[r])}</Pill>)}
    </span>
  );
}

/** Money and dates in the UI language (re-renders when it changes). */
export function useFormat() {
  const lang = useLang((s) => s.lang);
  const money = useCallback((n: number | null | undefined, currency = "MYR") => formatMoney(n, currency, lang), [lang]);
  const short = useCallback((n: number | null | undefined, currency = "MYR") => formatMoneyShort(n, currency, lang), [lang]);
  const day = useCallback((v: string | null | undefined) => formatDay(v, lang), [lang]);
  return { money, short, day };
}

/** A local "which company" filter, starting from the header's choice. "" = every company. */
export function useCompanyFilter() {
  const { branches, canAll, isAll, selected, one } = useCompanies();
  const [picked, setPicked] = useState<string | null>(null);
  const value = picked ?? (isAll || !selected ? "" : selected.id);
  return { branches, canAll, value, set: setPicked, one, branchId: value || undefined };
}

export function CompanySelect({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const t = useT();
  const { branches, canAll } = useCompanies();
  if (!canAll) return null;
  return (
    <Select size="md" value={value || ALL_COMPANIES} onValueChange={(v) => onChange(v === ALL_COMPANIES ? "" : v)} label={t("Company")} className={cn("sm:w-52", className)}
      options={[{ value: ALL_COMPANIES, label: t("All companies") }, ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
  );
}

/** Pick a contact by typing part of its name (customers for invoices and deals by default). */
export function PartyPicker({ value, onChange, role, branchId, label, invalid }: {
  value: Pick<Party, "id" | "name"> | null;
  onChange: (p: Party | null) => void;
  role?: PartyRole;
  branchId?: string;
  label: string;
  invalid?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState("");
  const needle = useDebounced(q.trim(), 250);
  const open = !value;
  const res = useQuery({ ...partySearchQuery(needle, role, branchId), enabled: open });
  const items = res.data?.items ?? [];
  if (value) {
    return (
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{label}</span>
        <div className="flex min-w-0 items-center gap-2 rounded-sm border border-border bg-surface-2/50 px-3 py-2">
          <CheckIcon size={15} weight="bold" className="shrink-0 text-ok" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="shrink-0 text-[12.5px] text-accent hover:underline">{t("Change")}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-1.5">
      <span id={id} className="text-[13px] font-medium">{label}</span>
      <div className={cn("grid gap-1 rounded-sm", invalid && "ring-2 ring-danger/30")}>
        <SearchInput value={q} onChange={setQ} label={label} placeholder={t("Type a name to find it")} />
        <ul aria-labelledby={id} className="grid max-h-56 gap-0.5 overflow-y-auto">
          {res.isLoading ? <li className="px-2 py-2 text-[12.5px] text-muted">{t("Loading…")}</li>
            : res.error ? <li><LoadError error={res.error} /></li>
            : !items.length ? <li className="px-2 py-2 text-[12.5px] text-muted">{needle ? t("No contact matches.") : t("No contacts yet. Add one on Contacts first.")}</li>
            : items.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onChange(p)} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-sm px-2.5 py-2 text-left hover:bg-surface-2">
                  {p.kind === "person" ? <UserIcon size={16} className="text-muted" /> : <BuildingOfficeIcon size={16} className="text-muted" />}
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                    {p.email || p.phone ? <span className="block truncate text-[12px] text-muted">{p.email || p.phone}</span> : null}
                  </span>
                  <RolePills roles={p.roles.slice(0, 2)} className="max-sm:hidden" />
                </button>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/** Two-column form rows that stack on phones and never push the dialog wider. */
export const FORM_GRID = "grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2";

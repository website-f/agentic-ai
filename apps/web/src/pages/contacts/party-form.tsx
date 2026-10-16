/** New contact / edit contact: a company or a person, its roles, tax details (TIN, SSM, SST),
 * address and payment terms, and on create the first contact person. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import {
  createParty,
  MY_STATES,
  PARTY_ROLES,
  partyKeys,
  ROLE_LABEL,
  updateParty,
  type Party,
  type PartyIn,
  type PartyKind,
  type PartyRole,
} from "@/lib/crm";
import { cn } from "@/lib/utils";

import { FORM_GRID } from "./bits";

const TERMS = [0, 7, 14, 30, 45, 60, 90];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Draft {
  kind: PartyKind;
  roles: PartyRole[];
  name: string;
  legal_name: string;
  reg_no: string;
  tin: string;
  sst_no: string;
  industry: string;
  email: string;
  phone: string;
  website: string;
  line1: string;
  line2: string;
  postcode: string;
  city: string;
  state: string;
  country: string;
  currency: string;
  terms: string;
  credit: string;
  tags: string;
  notes: string;
  cName: string;
  cTitle: string;
  cEmail: string;
  cPhone: string;
  branch: string;
}

function draftOf(p: Party | null | undefined, roles: PartyRole[], branch: string): Draft {
  return {
    kind: p?.kind ?? "company",
    roles: p?.roles ?? roles,
    name: p?.name ?? "",
    legal_name: p?.legal_name ?? "",
    reg_no: p?.reg_no ?? "",
    tin: p?.tin ?? "",
    sst_no: p?.sst_no ?? "",
    industry: p?.industry ?? "",
    email: p?.email ?? "",
    phone: p?.phone ?? "",
    website: p?.website ?? "",
    line1: p?.address.lines[0] ?? "",
    line2: p?.address.lines.slice(1).join(", ") ?? "",
    postcode: p?.address.postcode ?? "",
    city: p?.address.city ?? "",
    state: p?.address.state ?? "",
    country: p?.address.country || "Malaysia",
    currency: p?.currency || "MYR",
    terms: p?.payment_terms_days === null || p?.payment_terms_days === undefined ? "30" : String(p.payment_terms_days),
    credit: p?.credit_limit === null || p?.credit_limit === undefined ? "" : String(p.credit_limit),
    tags: p?.tags.join(", ") ?? "",
    notes: p?.notes ?? "",
    cName: "",
    cTitle: "",
    cEmail: "",
    cPhone: "",
    branch: p?.branch_id ?? branch,
  };
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="grid min-w-0 gap-3">
      <legend className="mb-1 text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

export function PartyDialog({ open, onOpenChange, party, defaultRoles = ["customer"], onSaved }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Editing this contact; absent = a new one. */
  party?: Party | null;
  defaultRoles?: PartyRole[];
  onSaved?: (p: Party) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { branches, canAll, one } = useCompanies();
  const [d, setD] = useState<Draft>(() => draftOf(party, defaultRoles, one?.id ?? ""));
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const editing = !!party;

  const nameErr = !d.name.trim() ? t("Give it a name.") : undefined;
  const emailErr = d.email.trim() && !EMAIL.test(d.email.trim()) ? t("This does not look like an email address.") : undefined;
  const cEmailErr = d.cEmail.trim() && !EMAIL.test(d.cEmail.trim()) ? t("This does not look like an email address.") : undefined;
  const rolesErr = !d.roles.length ? t("Pick at least one.") : undefined;
  const branchErr = !editing && !d.branch ? t("Pick a company.") : undefined;
  const invalid = !!(nameErr || emailErr || cEmailErr || rolesErr || branchErr);

  const save = useMutation({
    mutationFn: () => {
      const body: PartyIn = {
        kind: d.kind,
        roles: d.roles,
        name: d.name,
        legal_name: d.kind === "company" ? d.legal_name : "",
        reg_no: d.reg_no,
        tin: d.tin,
        sst_no: d.sst_no,
        industry: d.industry,
        email: d.email,
        phone: d.phone,
        website: d.website,
        address: { lines: [d.line1, d.line2], postcode: d.postcode, city: d.city, state: d.state, country: d.country },
        currency: d.currency.trim().toUpperCase() || "MYR",
        payment_terms_days: d.terms === "" ? null : Math.max(0, Math.round(Number(d.terms)) || 0),
        credit_limit: d.credit.trim() === "" ? null : Math.max(0, Number(d.credit) || 0),
        tags: d.tags.split(","),
        notes: d.notes,
      };
      if (party) return updateParty(party.id, body);
      return createParty({ ...body, branch_id: d.branch, contact: { name: d.cName, title: d.cTitle, email: d.cEmail, phone: d.cPhone } });
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: partyKeys.all });
      toast.success(editing ? t("Saved.") : t("{name} added.", { name: p.name || d.name.trim() }));
      onOpenChange(false);
      onSaved?.(p);
    },
  });

  const submit = () => {
    setTried(true);
    if (!invalid) save.mutate();
  };

  const toggleRole = (r: PartyRole) => set("roles", d.roles.includes(r) ? d.roles.filter((x) => x !== r) : [...d.roles, r]);
  const termOptions = [...new Set([...TERMS, ...(d.terms && !TERMS.includes(Number(d.terms)) ? [Number(d.terms)] : [])])]
    .sort((a, b) => a - b)
    .map((n) => ({ value: String(n), label: n === 0 ? t("Cash on delivery") : t("{n} days", { n }) }));
  const stateOptions = [{ value: "-", label: t("Not set") }, ...[...new Set([...MY_STATES, ...(d.state && !MY_STATES.includes(d.state) ? [d.state] : [])])].map((s) => ({ value: s, label: s }))];

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)} className="w-[min(94vw,42rem)]"
      title={party ? t("Edit {name}", { name: party.name }) : t("New contact")}
      description={editing ? undefined : t("A customer, supplier, partner or lead. Agents use these details on invoices, quotes and emails.")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>{t("Cancel")}</Button>
          <Button onClick={submit} loading={save.isPending}>{editing ? t("Save") : t("Add contact")}</Button>
        </>
      }>
      <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <div className="grid gap-3">
          <Segmented label={t("Company or person")} value={d.kind} onChange={(v) => set("kind", v)} className="w-full sm:w-fit"
            options={[{ value: "company", label: t("Company|contact") }, { value: "person", label: t("Person") }]} />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("What they are to you")}</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Roles")}>
              {PARTY_ROLES.map((r) => {
                const on = d.roles.includes(r);
                return (
                  <button key={r} type="button" aria-pressed={on} onClick={() => toggleRole(r)}
                    className={cn("inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                      on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-muted hover:text-fg")}>
                    {t(ROLE_LABEL[r])}
                  </button>
                );
              })}
            </div>
            {tried && rolesErr ? <p className="text-[12.5px] text-danger">{rolesErr}</p> : null}
          </div>
          <Field label={d.kind === "company" ? t("Company name") : t("Full name")} value={d.name} onChange={(e) => set("name", e.target.value)} error={tried ? nameErr : undefined} autoFocus />
          {!editing && canAll ? (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Which of your companies deals with them")}</span>
              <Select value={d.branch} onValueChange={(v) => set("branch", v)} label={t("Company")} placeholder={t("Pick a company")}
                options={branches.map((b) => ({ value: b.id, label: b.name }))} />
              {tried && branchErr ? <p className="text-[12.5px] text-danger">{branchErr}</p> : null}
            </div>
          ) : null}
        </div>

        <Group title={t("Registration and tax")}>
          <div className={FORM_GRID}>
            {d.kind === "company" ? <Field label={t("Registered name")} hint={t("As on the SSM certificate, if different.")} value={d.legal_name} onChange={(e) => set("legal_name", e.target.value)} className="sm:col-span-2" /> : null}
            <Field label={d.kind === "company" ? t("SSM number") : t("IC or passport number")} value={d.reg_no} onChange={(e) => set("reg_no", e.target.value)} />
            <Field label={t("TIN")} hint={t("LHDN tax number, for e-Invoice.")} value={d.tin} onChange={(e) => set("tin", e.target.value)} />
            <Field label={t("SST number")} value={d.sst_no} onChange={(e) => set("sst_no", e.target.value)} />
            <Field label={t("Industry")} value={d.industry} onChange={(e) => set("industry", e.target.value)} />
          </div>
        </Group>

        <Group title={t("How to reach them")}>
          <div className={FORM_GRID}>
            <Field label={t("Email")} type="email" inputMode="email" value={d.email} onChange={(e) => set("email", e.target.value)} error={tried ? emailErr : undefined} />
            <Field label={t("Phone")} type="tel" inputMode="tel" value={d.phone} onChange={(e) => set("phone", e.target.value)} />
            <Field label={t("Website")} value={d.website} onChange={(e) => set("website", e.target.value)} className="sm:col-span-2" />
            <Field label={t("Address line 1")} value={d.line1} onChange={(e) => set("line1", e.target.value)} className="sm:col-span-2" />
            <Field label={t("Address line 2")} value={d.line2} onChange={(e) => set("line2", e.target.value)} className="sm:col-span-2" />
            <Field label={t("Postcode")} inputMode="numeric" value={d.postcode} onChange={(e) => set("postcode", e.target.value)} />
            <Field label={t("City")} value={d.city} onChange={(e) => set("city", e.target.value)} />
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("State")}</span>
              <Select value={d.state || "-"} onValueChange={(v) => set("state", v === "-" ? "" : v)} label={t("State")} options={stateOptions} />
            </div>
            <Field label={t("Country")} value={d.country} onChange={(e) => set("country", e.target.value)} />
          </div>
        </Group>

        {!editing ? (
          <Group title={t("Contact person (optional)")}>
            <div className={FORM_GRID}>
              <Field label={t("Name")} value={d.cName} onChange={(e) => set("cName", e.target.value)} />
              <Field label={t("Job title")} value={d.cTitle} onChange={(e) => set("cTitle", e.target.value)} />
              <Field label={t("Email")} type="email" value={d.cEmail} onChange={(e) => set("cEmail", e.target.value)} error={tried ? cEmailErr : undefined} />
              <Field label={t("Phone")} type="tel" value={d.cPhone} onChange={(e) => set("cPhone", e.target.value)} />
            </div>
          </Group>
        ) : null}

        <Group title={t("Payment terms")}>
          <div className={FORM_GRID}>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Pays within")}</span>
              <Select value={d.terms} onValueChange={(v) => set("terms", v)} label={t("Pays within")} options={termOptions} />
            </div>
            <Field label={t("Credit limit (RM)")} inputMode="decimal" value={d.credit} onChange={(e) => set("credit", e.target.value.replace(/[^\d.]/g, ""))} hint={t("Leave empty for no limit.")} />
            <Field label={t("Currency")} value={d.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
            <Field label={t("Tags")} hint={t("Separate with commas, e.g. VIP, Klang Valley.")} value={d.tags} onChange={(e) => set("tags", e.target.value)} />
          </div>
          <TextareaField label={t("Notes")} value={d.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
        </Group>
        <button type="submit" hidden />
      </form>
    </ResponsiveDialog>
  );
}

/**
 * P111: every organization in Prima too (Fitri, 17 Nov 2026: "what organization added in
 * agentic must exist in prima as well since its correlated").
 *
 * The office links a new organization to the Prima company of the same name. When Prima has
 * none, the owner adds it to Prima here, with what Prima needs (its SSM number, primary state,
 * the source document and a reason); Prima adds it as a draft that is checked against SSM in
 * Prima. The Organization page shows each company's Prima link: linked, not linked (with why,
 * and "Add to Prima"), or its name differs in Prima (with Prima's reason and "Try again").
 * The API is /api/prima/companies (agentic/prima/org_link.py).
 */
import { ArrowsClockwiseIcon, LinkIcon, WarningIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SwitchField } from "@/components/ui/switch";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";

export interface PrimaLinkState {
  state: "linked" | "not_linked" | "name_differs";
  code?: string | null;
  message: string;
  made: boolean;
}

export interface PrimaBranchRow {
  id: string;
  name: string;
  company_id: string | null;
  suggestion: string | null;
  link?: PrimaLinkState;
  code_hint?: string | null;
}

export interface PrimaCompaniesData {
  companies: { id: string; name: string }[];
  branches: PrimaBranchRow[];
}

export const PRIMA_COMPANIES_KEY = ["prima", "companies"] as const;

/** Prima's companies beside the office's (owners and admins: org.manage). Shared with the
 * Prima page by its query key. No data when Prima is not set up or not answering. */
export function usePrimaCompanies(enabled: boolean) {
  return useQuery({
    queryKey: PRIMA_COMPANIES_KEY,
    queryFn: () => api<PrimaCompaniesData>("/api/prima/companies"),
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** What Prima needs to add a company (Part N4). */
export interface PrimaDraft {
  ssm_no: string;
  state: string;
  source_ref: string;
  reason: string;
  code: string;
}

export const emptyDraft = (code = ""): PrimaDraft => ({ ssm_no: "", state: "", source_ref: "", reason: "", code });

/** The same lengths Prima and the office API ask for. */
export function draftReady(d: PrimaDraft): boolean {
  return d.ssm_no.trim().length >= 5 && d.state.trim().length >= 3 && d.source_ref.trim().length >= 3
    && d.reason.trim().length >= 3 && /^[A-Za-z0-9-]{0,12}$/.test(d.code.trim());
}

/** A short code from the name's initials, as Prima's own (the API makes the same one). */
export function codeHint(name: string): string {
  const noise = new Set(["SDN", "BHD", "BERHAD", "SENDIRIAN", "AND", "&", "DAN", "THE", "(M)", "M"]);
  const words = name.toUpperCase().split(/\s+/).filter((w) => w && !noise.has(w));
  let code = words.map((w) => (/^[A-Z]/.test(w) ? w[0] : w.replace(/[^A-Z0-9]/g, ""))).join("").replace(/[^A-Z0-9]/g, "").slice(0, 12);
  if (code.length < 2) code = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  return code.length >= 2 ? code : "CO";
}

/** The name as matching sees it: case, spacing and punctuation do not count. */
const key = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

export function PrimaDetailsFields({ draft, onDraft }: { draft: PrimaDraft; onDraft: (d: PrimaDraft) => void }) {
  const t = useT();
  const set = (k: keyof PrimaDraft) => (e: { target: { value: string } }) => onDraft({ ...draft, [k]: e.target.value });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      <Field label={t("SSM registration number")} value={draft.ssm_no} onChange={set("ssm_no")} maxLength={40}
        placeholder={t("e.g. 202601012345 (1234567-A)")} />
      <Field label={t("Primary state")} value={draft.state} onChange={set("state")} maxLength={60} placeholder={t("e.g. Selangor")} />
      <Field label={t("Source document")} value={draft.source_ref} onChange={set("source_ref")} maxLength={200}
        placeholder={t("e.g. SSM company profile, 17 Nov 2026")} className="sm:col-span-2" />
      <Field label={t("Company code in Prima")} value={draft.code} onChange={(e) => onDraft({ ...draft, code: e.target.value.toUpperCase() })}
        maxLength={12} hint={t("Capital letters, digits or -. From the name's initials if left empty.")} className="[&_input]:font-mono [&_input]:uppercase" />
      <TextareaField label={t("Why it is added")} value={draft.reason} onChange={set("reason")} maxLength={500} rows={2}
        placeholder={t("e.g. New licensed company joins the group")} className="sm:col-span-2" />
    </div>
  );
}

/** P111: in "New company": what happens in Prima (linked by name, or added with its SSM
 * details now, or later from the table). */
export function NewCompanyPrima({ name, on, onOn, draft, onDraft }: {
  name: string;
  on: boolean;
  onOn: (v: boolean) => void;
  draft: PrimaDraft;
  onDraft: (d: PrimaDraft) => void;
}) {
  const t = useT();
  const { data } = usePrimaCompanies(true);
  if (!data?.companies) return null; // Prima is not set up here (or not answering)
  const same = name.trim() ? data.companies.find((c) => key(c.name) === key(name)) : undefined;
  return (
    <section className="grid gap-3 rounded-[var(--radius-md)] border border-border bg-surface-2/30 p-3.5">
      <p className="flex items-center gap-1.5 text-[13.5px] font-medium"><LinkIcon size={15} className="shrink-0 text-accent" /> {t("Prima")}</p>
      {same ? (
        <p className="text-[12.5px] text-muted">{t("It will be linked to the Prima company {name}.", { name: same.name })}</p>
      ) : (
        <>
          <SwitchField checked={on} onCheckedChange={onOn} label={t("Add it to Prima now")}
            hint={t("Prima needs its SSM details. You can also add it later from the companies table.")} />
          {on ? <PrimaDetailsFields draft={draft} onDraft={onDraft} /> : null}
        </>
      )}
    </section>
  );
}

interface SyncOut { outcome: string; company_id: string | null; link: PrimaLinkState }

function sync(branchId: string, draft?: PrimaDraft) {
  const details = draft
    ? { ssm_no: draft.ssm_no.trim(), state: draft.state.trim(), source_ref: draft.source_ref.trim(), reason: draft.reason.trim(), code: draft.code.trim() }
    : undefined;
  return api<SyncOut>(`/api/prima/companies/${branchId}/sync`, "POST", details ? { details } : {});
}

function said(r: SyncOut, name: string): void {
  if (r.link.state === "linked") {
    toast.success(r.outcome === "made" ? tr("{name} added to Prima.", { name }) : tr("{name} is linked to Prima.", { name }));
  } else {
    toast.error(r.link.message || tr("{name} is not in Prima yet.", { name }));
  }
}

/** After "Create company": add it to Prima with the details given (it stays created either
 * way; the table shows the Prima link). */
export async function addToPrimaAfterCreate(branchId: string, name: string, draft: PrimaDraft, refresh: () => void): Promise<void> {
  try {
    said(await sync(branchId, draft), name);
  } catch (e) {
    toast.error(errorMessage(e));
  } finally {
    refresh();
  }
}

/** Add one organization to Prima (with its SSM details), or try a rename again. */
export function AddToPrimaDialog({ row, onClose }: { row: PrimaBranchRow; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const differs = row.link?.state === "name_differs";
  const [draft, setDraft] = useState<PrimaDraft>(() => emptyDraft(row.code_hint ?? codeHint(row.name)));
  const [left, setLeft] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => sync(row.id, differs ? undefined : draft),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: PRIMA_COMPANIES_KEY });
      if (r.link.state === "linked") {
        said(r, row.name);
        onClose();
      } else setLeft(r.link.message || t("{name} is not in Prima yet.", { name: row.name }));
    },
  });
  const why = left ?? row.link?.message ?? "";
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()}
      title={differs ? t("Rename {name} in Prima", { name: row.name }) : t("Add {name} to Prima", { name: row.name })}
      description={differs
        ? t("Prima still has this company under its old name.")
        : t("Prima adds it as a draft, checked against SSM in Prima. Only an owner or admin adds companies to Prima.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button loading={run.isPending} disabled={!differs && !draftReady(draft)} onClick={() => { setLeft(null); run.mutate(); }}>
            {differs ? <><ArrowsClockwiseIcon size={16} /> {t("Try again")}</> : t("Add to Prima")}
          </Button>
        </>
      }>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
        {why ? (
          <p role="status" className="flex items-start gap-2 rounded-sm border border-warn/30 bg-warn/8 px-3 py-2 text-[13px] text-fg">
            <WarningIcon size={16} className="mt-0.5 shrink-0 text-warn" /> <span className="min-w-0 break-words">{why}</span>
          </p>
        ) : null}
        {differs ? null : (
          <>
            <PrimaDetailsFields draft={draft} onDraft={setDraft} />
            <p className="text-[12.5px] text-muted">
              {t("Is it a company Prima already has under another name?")}{" "}
              <Link to="/prima" className="font-medium text-accent hover:underline">{t("Link it on the Prima page")}</Link>
            </p>
          </>
        )}
        <FormError message={run.error ? errorMessage(run.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

/** The "Prima company" cell of the companies table: linked (its Prima name), not linked (and
 * "Add to Prima"), or its name differs in Prima (and "Try again"). */
export function PrimaLinkCell({ branchId, name, canManage }: { branchId: string; name: string | null; canManage: boolean }) {
  const t = useT();
  const { data } = usePrimaCompanies(canManage);
  const [open, setOpen] = useState(false);
  const row = data?.branches.find((b) => b.id === branchId);
  const state = row?.link?.state ?? (name ? "linked" : "not_linked");
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation(); // the row opens its sheet
  let shown;
  if (state === "linked") {
    shown = (
      <Pill tone="ok" className="max-w-full" title={row?.link?.made ? t("Added to Prima from the office: a draft, checked against SSM in Prima.") : undefined}>
        <span className="truncate">{name}</span>
      </Pill>
    );
  } else {
    const differs = state === "name_differs";
    shown = (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1" title={row?.link?.message || undefined}>
        {differs ? (
          <Pill tone="warn" className="max-w-full"><WarningIcon size={12} weight="bold" /> <span className="truncate">{t("Name differs in Prima")}</span></Pill>
        ) : (
          <span className="text-muted">{t("Not linked")}</span>
        )}
        {canManage && row ? (
          <Button variant="outline" size="sm" className="h-7 px-2 text-[12px]" onClick={(e) => { stop(e); setOpen(true); }}>
            {differs ? t("Try again") : t("Add to Prima")}
          </Button>
        ) : null}
      </span>
    );
  }
  return (
    <>
      {shown}
      {open && row ? <span onClick={stop} onKeyDown={stop} className="contents"><AddToPrimaDialog row={row} onClose={() => setOpen(false)} /></span> : null}
    </>
  );
}

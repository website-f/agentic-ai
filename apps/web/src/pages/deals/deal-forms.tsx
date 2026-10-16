/** A deal's sheet (edit it, mark it won or lost), the new-deal form and the lost-reason prompt. */
import { ArrowSquareOutIcon, TrophyIcon, XCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import {
  createDeal,
  DEAL_STAGES,
  dealKeys,
  partyKeys,
  partyQuery,
  STAGE_LABEL,
  STAGE_PROBABILITY,
  STAGE_TONE,
  updateDeal,
  type Deal,
  type DealIn,
  type DealStage,
  type Party,
} from "@/lib/crm";
import { membersQuery } from "@/lib/queries";
import { FORM_GRID, PartyPicker, useFormat } from "@/pages/contacts/bits";

const NOBODY = "-";

/** Members as owner options ("Me" first); empty when this person may not list members. */
export function useOwners(meId: string) {
  const t = useT();
  const members = useQuery({ ...membersQuery, retry: false });
  const list = members.data ?? [];
  const nameOf = (id: string | null | undefined) => (!id ? "" : id === meId ? t("Me") : (list.find((m) => m.user_id === id)?.name ?? ""));
  const options = [
    { value: NOBODY, label: t("No owner") },
    { value: meId, label: t("Me") },
    ...list.filter((m) => m.user_id !== meId && m.is_active).map((m) => ({ value: m.user_id, label: m.name || m.email })),
  ];
  return { options, nameOf };
}

interface Form {
  title: string;
  value: string;
  currency: string;
  stage: DealStage;
  probability: string;
  expected_close: string;
  next_step: string;
  next_step_due: string;
  source: string;
  owner: string;
}

const formOf = (d: Partial<Deal>, meId: string): Form => ({
  title: d.title ?? "",
  value: d.value ? String(d.value) : "",
  currency: d.currency || "MYR",
  stage: d.stage ?? "lead",
  probability: d.probability === null || d.probability === undefined ? String(STAGE_PROBABILITY[d.stage ?? "lead"]) : String(d.probability),
  expected_close: d.expected_close ?? "",
  next_step: d.next_step ?? "",
  next_step_due: d.next_step_due ?? "",
  source: d.source ?? "",
  owner: d.owner_user_id === undefined ? meId : (d.owner_user_id ?? NOBODY),
});

const bodyOf = (f: Form): DealIn => ({
  title: f.title,
  value: Number(f.value) || 0,
  currency: f.currency.trim().toUpperCase() || "MYR",
  stage: f.stage,
  probability: f.probability === "" ? null : Number(f.probability),
  expected_close: f.expected_close,
  next_step: f.next_step,
  next_step_due: f.next_step_due,
  source: f.source,
  owner_user_id: f.owner === NOBODY ? null : f.owner,
});

function DealFields({ f, set, meId, showStage }: { f: Form; set: <K extends keyof Form>(k: K, v: Form[K]) => void; meId: string; showStage: boolean }) {
  const t = useT();
  const owners = useOwners(meId);
  return (
    <div className={FORM_GRID}>
      <Field label={t("Value (RM)")} inputMode="decimal" value={f.value} onChange={(e) => set("value", e.target.value.replace(/[^\d.]/g, ""))} />
      <Field label={t("Chance of winning (%)")} inputMode="numeric" value={f.probability} onChange={(e) => set("probability", e.target.value.replace(/\D/g, "").slice(0, 3))} />
      {showStage ? (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Stage")}</span>
          <Select value={f.stage} label={t("Stage")} onValueChange={(v) => { set("stage", v as DealStage); set("probability", String(STAGE_PROBABILITY[v as DealStage])); }}
            options={DEAL_STAGES.filter((s) => s !== "lost").map((s) => ({ value: s, label: t(STAGE_LABEL[s]) }))} />
        </div>
      ) : null}
      <Field label={t("Expected to close")} type="date" value={f.expected_close} onChange={(e) => set("expected_close", e.target.value)} />
      <Field label={t("Next step")} placeholder={t("e.g. Send the revised quote")} value={f.next_step} onChange={(e) => set("next_step", e.target.value)} className="sm:col-span-2" />
      <Field label={t("Next step due")} type="date" value={f.next_step_due} onChange={(e) => set("next_step_due", e.target.value)} />
      {owners.options.length > 2 || f.owner !== meId ? (
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Owner")}</span>
          <Select value={f.owner} onValueChange={(v) => set("owner", v)} label={t("Owner")}
            options={owners.options.some((o) => o.value === f.owner) ? owners.options : [...owners.options, { value: f.owner, label: t("Someone else") }]} />
        </div>
      ) : null}
      <Field label={t("Source")} placeholder={t("e.g. Referral, website, tender")} value={f.source} onChange={(e) => set("source", e.target.value)} />
    </div>
  );
}

/** "New deal": with whom, what, how much, and the next step. */
export function NewDealDialog({ open, onOpenChange, partyId, meId, onCreated }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  partyId?: string;
  meId: string;
  onCreated?: (d: Deal) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { one } = useCompanies();
  const preset = useQuery({ ...partyQuery(partyId ?? ""), enabled: !!partyId });
  // undefined: still the contact the link named (if any); null: cleared to pick another.
  const [party, setParty] = useState<Pick<Party, "id" | "name" | "branch_id"> | null | undefined>(undefined);
  const chosen = party !== undefined ? party : preset.data ? { id: preset.data.id, name: preset.data.name, branch_id: preset.data.branch_id } : null;
  const [f, setF] = useState<Form>(() => formOf({}, meId));
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const titleErr = !f.title.trim() ? t("Give it a title.") : undefined;
  const save = useMutation({
    mutationFn: () => createDeal({ ...bodyOf(f), party_id: chosen!.id, branch_id: chosen!.branch_id || one?.id }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: dealKeys.all });
      void qc.invalidateQueries({ queryKey: partyKeys.all });
      toast.success(t("Deal added."));
      onOpenChange(false);
      onCreated?.(d);
    },
  });
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)} className="w-[min(94vw,38rem)]" title={t("New deal")}
      description={t("An opportunity with a customer or lead: a quote, a tender, a renewal.")}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>{t("Cancel")}</Button>
          <Button loading={save.isPending} onClick={() => { setTried(true); if (!titleErr && chosen) save.mutate(); }}>{t("Add deal")}</Button>
        </>
      }>
      <div className="grid gap-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        {partyId && preset.isLoading && party === undefined ? <p className="text-[13px] text-muted">{t("Loading…")}</p> : (
          <PartyPicker label={t("With whom")} value={chosen} onChange={(p) => setParty(p ? { id: p.id, name: p.name, branch_id: p.branch_id } : null)} invalid={tried && !chosen} />
        )}
        {tried && !chosen ? <p className="-mt-2 text-[12.5px] text-danger">{t("Pick who the deal is with.")}</p> : null}
        <Field label={t("Title")} placeholder={t("e.g. Annual aircond maintenance, 12 units")} value={f.title} onChange={(e) => set("title", e.target.value)} error={tried ? titleErr : undefined} />
        <DealFields f={f} set={set} meId={meId} showStage />
      </div>
    </ResponsiveDialog>
  );
}

/** Asks why a deal was lost before it moves to Lost (the reason is kept for later). */
export function LostDialog({ deal, onCancel, onConfirm, busy }: { deal: Deal | null; onCancel: () => void; onConfirm: (reason: string) => void; busy?: boolean }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const REASONS = [t("Price too high"), t("Went with a competitor"), t("No budget"), t("No reply"), t("Timing")];
  return (
    <ResponsiveDialog open={!!deal} onOpenChange={(o) => !o && !busy && onCancel()} title={t("Why was {title} lost?", { title: deal?.title ?? "" })}
      description={t("A short reason helps you see patterns later.")}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>{t("Cancel")}</Button>
          <Button variant="danger" loading={busy} onClick={() => { setTried(true); if (reason.trim()) onConfirm(reason.trim()); }}>{t("Mark as lost")}</Button>
        </>
      }>
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border border-border px-3 py-1 text-[12.5px] hover:border-accent/50 hover:text-accent">{r}</button>
          ))}
        </div>
        <TextareaField label={t("Reason")} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} error={tried && !reason.trim() ? t("Write a short reason.") : undefined} />
      </div>
    </ResponsiveDialog>
  );
}

/** One deal: edit its details, move it on, or close it as won or lost. */
export function DealSheet({ deal, meId, canWrite, onClose }: { deal: Deal; meId: string; canWrite: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { money, day } = useFormat();
  const owners = useOwners(meId);
  const [f, setF] = useState<Form>(() => formOf(deal, meId));
  const [losing, setLosing] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: dealKeys.all });
    void qc.invalidateQueries({ queryKey: partyKeys.all });
  };
  const save = useMutation({
    mutationFn: (body: DealIn) => updateDeal(deal.id, body),
    onSuccess: (_d, body) => {
      refresh();
      toast.success(body.stage === "won" ? t("Marked as won.") : body.stage === "lost" ? t("Marked as lost.") : t("Saved."));
      if (body.stage === "won" || body.stage === "lost") setLosing(false);
    },
  });
  const closed = deal.stage === "won" || deal.stage === "lost";
  const titleErr = !f.title.trim() ? t("Give it a title.") : undefined;
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} title={deal.title}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone={STAGE_TONE[deal.stage]}>{t(STAGE_LABEL[deal.stage])}</Pill>
          <span className="font-medium text-fg tabular">{money(deal.value, deal.currency)}</span>
          {deal.party_id ? (
            <Link to="/contacts/$partyId" params={{ partyId: deal.party_id }} className="inline-flex items-center gap-1 text-accent hover:underline">
              {deal.party_name || t("Contact")} <ArrowSquareOutIcon size={12} />
            </Link>
          ) : null}
        </span>
      }
      actions={canWrite && !closed ? (
        <>
          <Button size="sm" variant="outline" loading={save.isPending && save.variables?.stage === "won"} onClick={() => save.mutate({ stage: "won", probability: 100 })}><TrophyIcon size={15} className="text-ok" /> {t("Mark as won")}</Button>
          <Button size="sm" variant="outline" onClick={() => setLosing(true)}><XCircleIcon size={15} className="text-danger" /> {t("Mark as lost")}</Button>
        </>
      ) : canWrite && closed ? (
        <Button size="sm" variant="outline" loading={save.isPending} onClick={() => save.mutate({ stage: "negotiation", lost_reason: "" })}>{t("Reopen")}</Button>
      ) : null}>
      <div className="grid gap-5">
        {deal.stage === "lost" && deal.lost_reason ? (
          <p className="rounded-sm border border-danger/25 bg-danger/6 px-3 py-2 text-[13px]"><span className="font-medium">{t("Lost because:")}</span> {deal.lost_reason}</p>
        ) : null}
        {canWrite ? (
          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (!titleErr) save.mutate(bodyOf(f)); }}>
            <FormError message={save.error ? errorMessage(save.error) : null} />
            <Field label={t("Title")} value={f.title} onChange={(e) => set("title", e.target.value)} error={titleErr} />
            <DealFields f={f} set={set} meId={meId} showStage={!closed} />
            <div className="flex justify-end">
              <Button type="submit" loading={save.isPending && !save.variables?.stage?.match(/won|lost/)}>{t("Save changes")}</Button>
            </div>
          </form>
        ) : (
          <dl className="grid gap-2.5 text-[13px]">
            {[
              [t("Chance of winning"), deal.probability === null ? "" : `${deal.probability}%`],
              [t("Expected to close"), day(deal.expected_close)],
              [t("Next step"), deal.next_step],
              [t("Next step due"), day(deal.next_step_due)],
              [t("Owner"), owners.nameOf(deal.owner_user_id)],
              [t("Source"), deal.source],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="min-w-0 text-right break-words">{v}</dd></div>
            ))}
          </dl>
        )}
      </div>
      <LostDialog deal={losing ? deal : null} busy={save.isPending} onCancel={() => setLosing(false)} onConfirm={(reason) => save.mutate({ stage: "lost", lost_reason: reason, probability: 0 })} />
    </SideSheet>
  );
}

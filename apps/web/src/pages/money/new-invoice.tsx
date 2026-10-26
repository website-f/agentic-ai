/** "New invoice": a draft receivable for a customer, with a line editor (quantity, unit price and
 * SST per line) and the totals worked out as you type. P43: the same form makes a bill typed in
 * by hand (direction "payable"), and corrects a bill the AI read from a file before approving
 * it (`editing`). */
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { addDays, isoDay, partyKeys, partyQuery, type Party } from "@/lib/crm";
import { cleanLines, createMoney, lineAmount, moneyKeys, SST_RATES, totals, updateMoney, type MoneyDirection, type MoneyDoc, type MoneyDocDetail, type MoneyLine } from "@/lib/money";
import { FORM_GRID, PartyPicker, useFormat } from "@/pages/contacts/bits";

type Picked = Pick<Party, "id" | "name" | "branch_id" | "payment_terms_days">;

const blank = (rate: number): MoneyLine => ({ description: "", qty: 1, unit_price: 0, tax_rate: rate, amount: 0 });

/** The lines to start from when correcting a bill: its own, else one line with what was read. */
function startLines(d: MoneyDocDetail, label: string): MoneyLine[] {
  if (d.lines.length) return d.lines.map((l) => ({ ...l }));
  const base = d.subtotal || d.total;
  const rate = d.subtotal && d.tax_total ? Math.round((d.tax_total / d.subtotal) * 100) : 0;
  return [{ description: label, qty: 1, unit_price: base, tax_rate: rate, amount: base }];
}

export function NewInvoiceDialog({ open, onOpenChange, partyId, onCreated, direction = "receivable", editing }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  partyId?: string;
  onCreated?: (d: MoneyDoc) => void;
  direction?: MoneyDirection;
  /** A bill or draft to correct instead of making a new one. */
  editing?: MoneyDocDetail;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { money } = useFormat();
  const { one } = useCompanies();
  const dir: MoneyDirection = editing?.direction ?? direction;
  const bill = dir === "payable";
  const preset = useQuery({ ...partyQuery(partyId ?? ""), enabled: !!partyId });
  // undefined: the contact the link named (if any); null: cleared to pick another.
  const [party, setParty] = useState<Picked | null | undefined>(
    editing?.party_id ? { id: editing.party_id, name: editing.party_name, branch_id: editing.branch_id, payment_terms_days: 30 } as Picked : undefined,
  );
  const chosen: Picked | null = party !== undefined ? party : preset.data ?? null;
  const [issue, setIssue] = useState(editing?.issue_date ?? isoDay());
  // null: follow the contact's payment terms
  const [due, setDue] = useState<string | null>(editing?.due_date ?? null);
  const [number, setNumber] = useState(editing?.number ?? "");
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [rate, setRate] = useState(editing ? 0 : 8);
  const [lines, setLines] = useState<MoneyLine[]>(editing ? startLines(editing, t("As on the bill")) : [blank(8)]);
  const [tried, setTried] = useState(false);
  const terms = chosen?.payment_terms_days ?? 30;
  const dueDate = due ?? addDays(issue, terms);
  const sums = totals(lines);
  const usable = cleanLines(lines);

  const setLine = (i: number, patch: Partial<MoneyLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const errors = {
    party: !chosen ? (bill ? t("Pick the supplier.") : t("Pick the customer.")) : undefined,
    lines: !usable.length || !(sums.total > 0) ? t("Add at least one line with an amount.") : undefined,
    due: dueDate < issue ? t("The due date is before the issue date.") : undefined,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () => editing
      ? updateMoney(editing.id, { party_id: chosen!.id, number, issue_date: issue, due_date: dueDate, reference, notes, lines })
      : createMoney({
        direction: dir,
        branch_id: chosen!.branch_id || one?.id || "",
        party_id: chosen!.id,
        number: bill ? number : undefined,
        issue_date: issue,
        due_date: dueDate,
        currency: "MYR",
        reference,
        notes,
        lines,
      }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: moneyKeys.all });
      void qc.invalidateQueries({ queryKey: partyKeys.all });
      toast.success(editing ? t("Saved. Approve it when it is right.") : bill ? t("Bill saved. Approve it when it is right.") : t("Draft invoice saved."));
      onOpenChange(false);
      onCreated?.(d);
    },
  });

  const title = editing ? (bill ? t("Correct this bill") : t("Edit invoice")) : bill ? t("New bill") : t("New invoice");
  const description = editing
    ? t("Fix anything the AI read wrong (supplier, number, dates, amounts) before you approve it.")
    : bill ? t("Type in a bill you received on paper. It waits for approval like any other bill.")
    : t("Saved as a draft. Check it, then mark it as sent once the customer has it.");

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)} className="w-[min(96vw,46rem)]" title={title}
      description={description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>{t("Cancel")}</Button>
          <Button loading={save.isPending} onClick={() => { setTried(true); if (!invalid) save.mutate(); }}>{editing || bill ? t("Save") : t("Save draft")}</Button>
        </>
      }>
      <div className="grid gap-4">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        {partyId && preset.isLoading && party === undefined ? <p className="text-[13px] text-muted">{t("Loading…")}</p> : (
          <PartyPicker label={bill ? t("Supplier") : t("Customer")} role={bill ? "supplier" : "customer"} value={chosen} invalid={tried && !!errors.party}
            onChange={(p) => { setParty(p); setDue(null); }} />
        )}
        {tried && errors.party ? <p className="-mt-2 text-[12.5px] text-danger">{errors.party}</p> : null}
        <div className={FORM_GRID}>
          {bill ? <Field label={t("Bill or receipt number")} value={number} onChange={(e) => setNumber(e.target.value)} /> : null}
          <Field label={t("Issue date")} type="date" value={issue} onChange={(e) => setIssue(e.target.value || isoDay())} />
          <Field label={t("Due date")} type="date" value={dueDate} onChange={(e) => setDue(e.target.value || null)}
            hint={due === null ? t("{n} days, from their payment terms.", { n: terms }) : undefined} error={errors.due} />
          <Field label={t("Reference")} hint={bill ? t("Our PO number, if any.") : t("Their PO or quotation number.")} value={reference} onChange={(e) => setReference(e.target.value)} />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("SST for new lines")}</span>
            <Select value={String(rate)} onValueChange={(v) => setRate(Number(v))} label={t("SST for new lines")}
              options={SST_RATES.map((r) => ({ value: String(r), label: r ? t("SST {rate}%", { rate: r }) : t("No SST") }))} />
          </div>
        </div>

        <fieldset className="grid min-w-0 gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t("Lines")}</legend>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {lines.map((l, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[var(--radius-sm)] border border-border p-2.5 sm:grid-cols-[minmax(0,1fr)_4.5rem_7rem_6.5rem_auto] sm:items-center sm:border-0 sm:p-0">
                <Input aria-label={t("Description for line {n}", { n: i + 1 })} placeholder={t("Description")} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} className="max-sm:col-span-2" />
                <Input aria-label={t("Quantity for line {n}", { n: i + 1 })} inputMode="decimal" value={String(l.qty)} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} className="text-right" />
                <Input aria-label={t("Unit price for line {n}", { n: i + 1 })} inputMode="decimal" placeholder={t("Unit price")} value={l.unit_price ? String(l.unit_price) : ""}
                  onChange={(e) => setLine(i, { unit_price: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} className="text-right" />
                <Select value={String(l.tax_rate)} onValueChange={(v) => setLine(i, { tax_rate: Number(v) })} label={t("SST for line {n}", { n: i + 1 })}
                  options={[...new Set([...SST_RATES, l.tax_rate])].map((r) => ({ value: String(r), label: r ? `${r}%` : t("No SST") }))} />
                <div className="flex items-center justify-end gap-1 max-sm:col-span-2">
                  <span className="text-[13px] font-medium whitespace-nowrap tabular sm:hidden">{money(lineAmount(l))}</span>
                  <Button size="icon-sm" variant="ghost" aria-label={t("Remove line {n}", { n: i + 1 })} disabled={lines.length === 1}
                    onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><TrashIcon size={15} /></Button>
                </div>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => setLines((ls) => [...ls, blank(rate)])}><PlusIcon size={14} weight="bold" /> {t("Add line")}</Button>
          {tried && errors.lines ? <p className="text-[12.5px] text-danger">{errors.lines}</p> : null}
        </fieldset>

        <dl className="ml-auto grid w-full max-w-xs gap-1 text-[13px]">
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("Subtotal")}</dt><dd className="tabular">{money(sums.subtotal)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-muted">{t("SST")}</dt><dd className="tabular">{money(sums.tax_total)}</dd></div>
          <div className="flex justify-between gap-3 border-t border-border pt-1"><dt className="font-medium">{t("Total")}</dt><dd className="text-[15px] font-semibold tabular">{money(sums.total)}</dd></div>
        </dl>
        <TextareaField label={bill ? t("Notes") : t("Notes on the invoice")} placeholder={bill ? t("e.g. Paid by cash at the counter.") : t("e.g. Bank details, or thanks for your business.")} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
      </div>
    </ResponsiveDialog>
  );
}

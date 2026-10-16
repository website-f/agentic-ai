/** One invoice or bill: who, when, its lines and totals, payments so far, where it came from
 * (the emailed file, the document, the mail) and what a finance manager can do next. */
import {
  ArrowSquareOutIcon,
  BellRingingIcon,
  CheckCircleIcon,
  CopySimpleIcon,
  EnvelopeSimpleIcon,
  FileTextIcon,
  PaperclipIcon,
  PaperPlaneTiltIcon,
  ProhibitIcon,
  SealCheckIcon,
  WalletIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { isoDay, partyKeys } from "@/lib/crm";
import {
  actionsFor,
  approveMoney,
  balanceOf,
  markMoneySent,
  moneyDocQuery,
  moneyKeys,
  PAYMENT_METHODS,
  recordPayment,
  remindMoney,
  STATUS_LABEL,
  STATUS_TONE,
  voidMoney,
  type MoneyDocDetail,
} from "@/lib/money";
import { LoadError, useFormat } from "@/pages/contacts/bits";

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: moneyKeys.all });
    void qc.invalidateQueries({ queryKey: partyKeys.all });
  };
}

export function DocSheet({ id, canManage, onClose, onOpen }: { id: string; canManage: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const t = useT();
  const doc = useQuery(moneyDocQuery(id));
  const d = doc.data;
  const title = d ? (d.number || (d.direction === "receivable" ? t("Invoice (no number yet)") : t("Bill (no number yet)"))) : t("Loading…");
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="lg" title={title}
      description={d ? <Summary d={d} /> : undefined}
      actions={d && canManage ? <Actions d={d} /> : undefined}>
      {doc.isLoading ? <div className="grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
        : doc.error || !d ? <LoadError error={doc.error} />
        : <Body d={d} onOpen={onOpen} />}
    </SideSheet>
  );
}

function Summary({ d }: { d: MoneyDocDetail }) {
  const t = useT();
  const late = d.overdue && d.status !== "paid" && d.status !== "void";
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Pill>{d.direction === "receivable" ? t("Invoice") : t("Bill")}</Pill>
      <Pill tone={STATUS_TONE[d.status]}>{t(STATUS_LABEL[d.status])}</Pill>
      {late ? <Pill tone="danger">{d.days_overdue === 1 ? t("1 day overdue") : t("{n} days overdue", { n: d.days_overdue })}</Pill> : null}
      {d.party_id ? (
        <Link to="/contacts/$partyId" params={{ partyId: d.party_id }} className="inline-flex min-w-0 items-center gap-1 text-accent hover:underline">
          <span className="truncate">{d.party_name || t("Contact")}</span> <ArrowSquareOutIcon size={12} className="shrink-0" />
        </Link>
      ) : d.party_name ? <span>{d.party_name}</span> : <span className="text-warn">{t("No contact linked")}</span>}
    </span>
  );
}

function Body({ d, onOpen }: { d: MoneyDocDetail; onOpen: (id: string) => void }) {
  const t = useT();
  const { money, day } = useFormat();
  const dup = useQuery({ ...moneyDocQuery(d.duplicate_of ?? ""), enabled: !!d.duplicate_of, retry: false });
  const balance = balanceOf(d);
  const cur = d.currency;
  const facts = [
    [t("Issued"), day(d.issue_date)],
    [t("Due"), day(d.due_date)],
    [t("Reference"), d.reference],
    [t("Source"), d.source],
  ].filter(([, v]) => v);
  return (
    <div className="grid gap-5">
      {d.duplicate_of ? (
        <div role="alert" className="flex items-start gap-2 rounded-sm border border-warn/35 bg-warn/8 px-3 py-2.5 text-[13px]">
          <WarningIcon size={16} className="mt-0.5 shrink-0 text-warn" />
          <span className="min-w-0">
            {t("Possible duplicate of {number}.", { number: dup.data?.number || dup.data?.party_name || t("another document") })}{" "}
            <button type="button" onClick={() => onOpen(d.duplicate_of!)} className="font-medium text-accent hover:underline">{t("Compare")}</button>
          </span>
        </div>
      ) : null}

      {facts.length ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
          {facts.map(([k, v]) => <div key={k} className="grid min-w-0 gap-0.5"><dt className="text-[12px] text-muted">{k}</dt><dd className="break-words">{v}</dd></div>)}
        </dl>
      ) : null}

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">{t("Lines")}</h3>
        {!d.lines.length ? <p className="text-[13px] text-muted">{t("No lines read yet. The total below is what was captured.")}</p> : (
          <div className="grid grid-cols-[minmax(0,1fr)] rounded-[var(--radius-sm)] border border-border">
            <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_4rem_7rem_4rem_7rem] gap-2 border-b border-border bg-surface-2/50 px-3 py-1.5 text-[12px] font-medium text-muted sm:grid">
              <span>{t("Description")}</span><span className="text-right">{t("Qty")}</span><span className="text-right">{t("Unit price")}</span><span className="text-right">{t("SST")}</span><span className="text-right">{t("Amount")}</span>
            </div>
            <ul className="divide-y divide-border">
              {d.lines.map((l, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5 px-3 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_4rem_7rem_4rem_7rem]">
                  <span className="min-w-0 break-words">{l.description || "—"}</span>
                  <span className="text-right font-medium tabular sm:hidden">{money(l.amount, cur)}</span>
                  <span className="col-span-2 text-[12px] text-muted tabular sm:hidden">
                    {t("{qty} × {price}", { qty: l.qty, price: money(l.unit_price, cur) })}{l.tax_rate ? ` · ${t("SST {rate}%", { rate: l.tax_rate })}` : ""}
                  </span>
                  <span className="hidden text-right tabular sm:block">{l.qty}</span>
                  <span className="hidden text-right tabular sm:block">{money(l.unit_price, cur)}</span>
                  <span className="hidden text-right text-muted tabular sm:block">{l.tax_rate ? `${l.tax_rate}%` : "—"}</span>
                  <span className="hidden text-right font-medium tabular sm:block">{money(l.amount, cur)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <dl className="ml-auto grid w-full max-w-xs gap-1 text-[13px]">
          <Row k={t("Subtotal")} v={money(d.subtotal, cur)} />
          <Row k={t("SST")} v={money(d.tax_total, cur)} />
          <Row k={t("Total")} v={money(d.total, cur)} strong />
          {d.amount_paid ? <Row k={t("Paid")} v={money(d.amount_paid, cur)} /> : null}
          {d.status !== "void" ? <Row k={t("Still owed")} v={money(balance, cur)} strong tone={balance > 0 && d.overdue ? "danger" : undefined} /> : null}
        </dl>
      </section>

      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold">{t("Payments")}</h3>
        {!d.payments.length ? <p className="text-[13px] text-muted">{t("No payments recorded yet.")}</p> : (
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-[var(--radius-sm)] border border-border">
            {d.payments.map((p) => (
              <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-[13px]">
                <span className="grid min-w-0">
                  <span>{day(p.paid_at)}</span>
                  <span className="truncate text-[12px] text-muted">{[t(PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method), p.reference].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="font-medium tabular">{money(p.amount, cur)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {d.file_id || d.document_id || d.mail_item_id ? (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold">{t("Where it came from")}</h3>
          <div className="flex flex-wrap gap-2">
            {d.file_id ? <Button asChild size="sm" variant="outline"><Link to="/files" search={{ f: d.file_id }}><PaperclipIcon size={14} /> {t("Open the file")}</Link></Button> : null}
            {d.document_id ? <Button asChild size="sm" variant="outline"><Link to="/documents" search={{ d: d.document_id }}><FileTextIcon size={14} /> {t("Open the document")}</Link></Button> : null}
            {d.mail_item_id ? <Button asChild size="sm" variant="outline"><Link to="/mail"><EnvelopeSimpleIcon size={14} /> {t("Open in Mail")}</Link></Button> : null}
          </div>
        </section>
      ) : null}

      {d.notes ? (
        <section className="grid gap-1">
          <h3 className="text-[13px] font-semibold">{t("Notes")}</h3>
          <p className="text-[13px] whitespace-pre-wrap break-words text-fg/90">{d.notes}</p>
        </section>
      ) : null}
    </div>
  );
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={`tabular ${strong ? "text-[14px] font-semibold" : ""} ${tone === "danger" ? "text-danger" : ""}`}>{v}</dd>
    </div>
  );
}

function Actions({ d }: { d: MoneyDocDetail }) {
  const t = useT();
  const refresh = useRefresh();
  const navigate = useNavigate();
  const can = actionsFor(d);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: () => approveMoney(d.id),
    onSuccess: () => { toast.success(t("Bill approved.")); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: () => markMoneySent(d.id),
    onSuccess: () => { toast.success(t("Marked as sent.")); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remind = useMutation({
    mutationFn: () => remindMoney(d.id),
    onSuccess: (r) => {
      refresh();
      if (r?.draft_id) {
        toast.success(t("Draft created — approve it in Mail."), { action: { label: t("Open Mail"), onClick: () => void navigate({ to: "/mail" }) }, duration: 8000 });
      } else if (r?.text) setText(r.text);
      else toast.success(t("Reminder prepared."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const markSent = d.direction === "receivable" && (d.status === "draft" || d.status === "approved");
  if (!can.approve && !can.pay && !can.void && !can.remind && !markSent) return null;
  return (
    <>
      {can.approve ? <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate()}><SealCheckIcon size={15} /> {t("Approve")}</Button> : null}
      {markSent ? <Button size="sm" variant="outline" loading={send.isPending} onClick={() => send.mutate()}><PaperPlaneTiltIcon size={15} /> {t("Mark as sent")}</Button> : null}
      {can.pay ? <Button size="sm" variant={can.approve ? "outline" : "primary"} onClick={() => setPaying(true)}><WalletIcon size={15} /> {t("Record payment")}</Button> : null}
      {can.remind ? <Button size="sm" variant="outline" loading={remind.isPending} onClick={() => remind.mutate()}><BellRingingIcon size={15} /> {t("Send reminder")}</Button> : null}
      {can.void ? <Button size="sm" variant="ghost" onClick={() => setVoiding(true)}><ProhibitIcon size={15} /> {t("Void")}</Button> : null}
      {paying ? <PaymentDialog d={d} onClose={() => setPaying(false)} /> : null}
      {voiding ? <VoidDialog d={d} onClose={() => setVoiding(false)} /> : null}
      <ReminderText text={text} onClose={() => setText(null)} />
    </>
  );
}

function PaymentDialog({ d, onClose }: { d: MoneyDocDetail; onClose: () => void }) {
  const t = useT();
  const { money } = useFormat();
  const refresh = useRefresh();
  const balance = balanceOf(d);
  const [amount, setAmount] = useState(balance ? String(balance) : "");
  const [paidAt, setPaidAt] = useState(isoDay());
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const n = Number(amount);
  const err = !(n > 0) ? t("Enter the amount paid.") : n > balance + 0.005 ? t("That is more than the {amount} still owed.", { amount: money(balance, d.currency) }) : undefined;
  const save = useMutation({
    mutationFn: () => recordPayment(d.id, { amount: n, paid_at: paidAt, method, reference }),
    onSuccess: () => {
      toast.success(t("Payment recorded."));
      refresh();
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={t("Record payment")}
      description={t("{number}: {amount} still owed.", { number: d.number || t("This document"), amount: money(balance, d.currency) })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>{t("Cancel")}</Button>
          <Button loading={save.isPending} disabled={!!err} onClick={() => save.mutate()}><CheckCircleIcon size={15} /> {t("Record payment")}</Button>
        </>
      }>
      <div className="grid gap-3">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <Field label={t("Amount ({currency})", { currency: d.currency })} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} error={amount ? err : undefined} autoFocus />
        <Field label={t("Paid on")} type="date" value={paidAt} max={isoDay()} onChange={(e) => setPaidAt(e.target.value)} />
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("How")}</span>
          <Select value={method} onValueChange={setMethod} label={t("How")} options={PAYMENT_METHODS.map((m) => ({ value: m.value, label: t(m.label) }))} />
        </div>
        <Field label={t("Reference")} hint={t("Bank reference or cheque number.")} value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
    </ResponsiveDialog>
  );
}

function VoidDialog({ d, onClose }: { d: MoneyDocDetail; onClose: () => void }) {
  const t = useT();
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const save = useMutation({
    mutationFn: () => voidMoney(d.id, reason),
    onSuccess: () => {
      toast.success(t("Voided."));
      refresh();
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && !save.isPending && onClose()} title={t("Void {number}?", { number: d.number || t("this document") })}
      description={t("It stays on record, marked void, and no longer counts as owed.")}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>{t("Cancel")}</Button>
          <Button variant="danger" loading={save.isPending} onClick={() => { setTried(true); if (reason.trim()) save.mutate(); }}>{t("Void")}</Button>
        </>
      }>
      <div className="grid gap-3">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <TextareaField label={t("Reason")} placeholder={t("e.g. Entered twice, or replaced by a credit note.")} value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
          error={tried && !reason.trim() ? t("Write a short reason.") : undefined} />
      </div>
    </ResponsiveDialog>
  );
}

/** The reminder as text, when it is not an email draft: copy it into WhatsApp or anywhere. */
function ReminderText({ text, onClose }: { text: string | null; onClose: () => void }) {
  const t = useT();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text ?? "");
      toast.success(t("Copied."));
    } catch {
      toast.error(t("Could not copy. Select the text and copy it yourself."));
    }
  };
  return (
    <ResponsiveDialog open={text !== null} onOpenChange={(o) => !o && onClose()} title={t("Reminder ready")}
      description={t("Copy it and send it yourself (WhatsApp, SMS or email).")}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t("Close")}</Button>
          <Button onClick={() => void copy()}><CopySimpleIcon size={15} /> {t("Copy")}</Button>
        </>
      }>
      <p className="rounded-sm border border-border bg-surface-2/50 px-3 py-2.5 text-[13.5px] whitespace-pre-wrap break-words select-text">{text}</p>
    </ResponsiveDialog>
  );
}

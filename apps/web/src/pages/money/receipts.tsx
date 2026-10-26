/** P43 "Upload receipts and bills": drop photos or PDFs (many at once). Each is kept in the
 * company's "Bills and receipts" folder and read into a bill waiting for approval; a receipt
 * that was already paid is paid when approved, and one a staff member paid from their own
 * pocket is marked as their claim so finance pays them back. */
import { CheckCircleIcon, CloudArrowUpIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { partyKeys } from "@/lib/crm";
import { MAX_RECEIPT_MB, moneyKeys, uploadReceipt, type MoneyDoc } from "@/lib/money";
import { membersQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CompanySelect, useFormat } from "@/pages/contacts/bits";

const COMPANY = "company";

interface Row {
  key: string;
  name: string;
  state: "waiting" | "reading" | "done" | "failed";
  doc?: MoneyDoc;
  error?: string;
}

export function ReceiptsDialog({ open, onOpenChange, branchId, onOpenDoc }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId?: string;
  onOpenDoc: (id: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const { money } = useFormat();
  const { one } = useCompanies();
  const input = useRef<HTMLInputElement>(null);
  const [company, setCompany] = useState<string>(branchId ?? "");
  const [payer, setPayer] = useState<string>(COMPANY);
  const [rows, setRows] = useState<Row[]>([]);
  const [over, setOver] = useState(false);
  const members = useQuery({ ...membersQuery, enabled: open, retry: false });
  const target = company || branchId || one?.id || "";
  const busy = rows.some((r) => r.state === "waiting" || r.state === "reading");

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const send = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    const added = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, name: f.name, state: "waiting" as const }));
    setRows((rs) => [...added, ...rs]);
    // One at a time: each is read by the AI, and the server keeps the order clear.
    for (const [i, f] of files.entries()) {
      const key = added[i]!.key;
      set(key, { state: "reading" });
      try {
        const doc = await uploadReceipt(f, target, payer === COMPANY ? null : payer);
        set(key, { state: "done", doc });
      } catch (e) {
        set(key, { state: "failed", error: errorMessage(e) });
      }
    }
    void qc.invalidateQueries({ queryKey: moneyKeys.all });
    void qc.invalidateQueries({ queryKey: partyKeys.all });
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (!busy) void send(e.dataTransfer.files);
  };

  const people = (members.data ?? []).filter((m) => m.is_active);

  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} className="w-[min(96vw,40rem)]"
      title={t("Upload receipts and bills")}
      description={t("Photos or PDFs, as many as you like. Each is read into a bill that waits for your approval. Receipts already paid are recorded as paid when you approve them.")}
      footer={<Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>{rows.length ? t("Done") : t("Cancel")}</Button>}>
      <div className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("For which company")}</span>
            <CompanySelect value={company || target} onChange={setCompany} />
          </div>
          {people.length ? (
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">{t("Who paid")}</span>
              <Select value={payer} onValueChange={setPayer} label={t("Who paid")}
                options={[
                  { value: COMPANY, label: t("The company (or not paid yet)") },
                  ...people.map((m) => ({ value: m.user_id, label: t("{name}, from their own money (a claim)", { name: m.name }) })),
                ]} />
            </div>
          ) : null}
        </div>

        <button type="button" onClick={() => input.current?.click()} disabled={busy}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}
          className={cn(
            "grid min-h-36 place-items-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed px-4 py-6 text-center transition-colors",
            over ? "border-accent bg-accent-soft/50" : "border-border bg-surface-2/40 hover:border-accent/50",
            busy && "opacity-60",
          )}>
          <CloudArrowUpIcon size={30} weight="duotone" className="text-accent" />
          <span className="text-[14px] font-medium">{t("Drop photos or PDFs here, or click to choose")}</span>
          <span className="text-[12.5px] text-muted">{t("Up to {mb} MB each. Phone photos work: keep the whole receipt in view.", { mb: MAX_RECEIPT_MB })}</span>
        </button>
        <input ref={input} type="file" multiple hidden accept="image/*,application/pdf"
          onChange={(e) => { if (e.target.files) void send(e.target.files); e.target.value = ""; }} />

        {rows.length ? (
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {rows.map((r) => (
              <li key={r.key} className="flex min-w-0 items-start gap-2.5 px-3 py-2.5 text-[13px]">
                {r.state === "done" ? <CheckCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-ok" />
                  : r.state === "failed" ? <WarningCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0 text-danger" />
                  : <span className="mt-1.5 size-2.5 shrink-0 animate-pulse rounded-full bg-accent" />}
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">{r.name}</span>
                  {r.state === "done" && r.doc ? (
                    <span className="text-muted">
                      {r.doc.party_name} · {money(r.doc.total, r.doc.currency)}
                      {r.doc.duplicate_of ? <> · <span className="text-warn">{t("Possible duplicate")}</span></> : null}
                    </span>
                  ) : r.state === "failed" ? <span className="text-danger">{r.error}</span>
                    : <span className="text-muted">{r.state === "reading" ? t("Reading…") : t("Waiting…")}</span>}
                </div>
                {r.state === "done" && r.doc ? (
                  <Button size="sm" variant="ghost" onClick={() => { onOpenChange(false); onOpenDoc(r.doc!.id); }}>{t("Check it")}</Button>
                ) : r.state === "failed" ? <Pill tone="danger">{t("Not read")}</Pill> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

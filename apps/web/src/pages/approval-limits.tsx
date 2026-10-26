/** P46 Settings > Approval limits: small routine money steps go through without a person
 * (a supplier bill under a set amount, from a supplier approved before; an agent drafting a
 * small invoice), with a daily cap, and a list of what went through on its own. Everything
 * else still waits for a person, exactly as before. (api/routers/approval_limits.py) */
import { ReceiptIcon, ScalesIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/utils";

interface Limits {
  bills: { enabled: boolean; max: number | string; known_suppliers_only: boolean };
  invoices: { enabled: boolean; max: number | string };
  per_day: number;
}

interface LimitsOut {
  limits: Limits;
  used_today: number;
  recent: { kind: "bill" | "tool"; at: string; label: string; amount: string; money_doc_id?: string; task_id?: string }[];
}

const key = ["approval-limits"] as const;

export function ApprovalLimitsPage() {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: key, queryFn: () => api<LimitsOut>("/api/approval-limits") });
  // What the person is editing; until they change something, what the server has.
  const [form, setForm] = useState<Limits | null>(null);

  const save = useMutation({
    mutationFn: (body: Limits) => api<LimitsOut>("/api/approval-limits", "PUT", {
      ...body,
      bills: { ...body.bills, max: Number(body.bills.max) || 0 },
      invoices: { ...body.invoices, max: Number(body.invoices.max) || 0 },
    }),
    onSuccess: (r) => { qc.setQueryData(key, r); setForm(r.limits); toast.success(t("Saved. It applies from the next bill or invoice.")); },
  });

  const f = form ?? q.data?.limits ?? null;
  const set = (patch: Partial<Limits>) => setForm((x) => {
    const base = x ?? q.data?.limits;
    return base ? { ...base, ...patch } : x;
  });
  const money = (v: string) => v.replace(/[^\d.]/g, "");

  return (
    <Page>
      <PageHeader title={t("Approval limits")}
        description={t("Let small, routine money steps go through without waiting for you. Anything over a limit, unusual or new still waits for a person, as before.")} />

      {q.isLoading || !f ? <Skeleton className="h-64 rounded-[var(--radius-md)]" /> : q.error ? (
        <p role="alert" className="text-danger">{errorMessage(q.error)}</p>
      ) : (
        <>
          <Card className="grid gap-4 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <ReceiptIcon size={22} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              <div className="grid min-w-0 flex-1 gap-3">
                <SwitchField checked={f.bills.enabled} onCheckedChange={(enabled) => set({ bills: { ...f.bills, enabled } })}
                  label={t("Approve small supplier bills and receipts on their own")}
                  hint={t("Bills read from email, phone photos or uploads. A receipt already paid is then recorded as paid; a staff member's claim waits to be paid back.")} />
                {f.bills.enabled ? (
                  <div className="grid gap-3 sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-end">
                    <Field label={t("Up to (RM)")} inputMode="decimal" value={String(f.bills.max)} onChange={(e) => set({ bills: { ...f.bills, max: money(e.target.value) } })} />
                    <SwitchField checked={f.bills.known_suppliers_only} onCheckedChange={(v) => set({ bills: { ...f.bills, known_suppliers_only: v } })}
                      label={t("Only from suppliers you have approved a bill from before")}
                      hint={t("Recommended: the first bill from anyone new always waits for you.")} />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-start gap-3 border-t border-border pt-4">
              <ScalesIcon size={22} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              <div className="grid min-w-0 flex-1 gap-3">
                <SwitchField checked={f.invoices.enabled} onCheckedChange={(enabled) => set({ invoices: { ...f.invoices, enabled } })}
                  label={t("Let agents draft customer invoices without asking")}
                  hint={t("Only drafts: a person still approves and sends every invoice.")} />
                {f.invoices.enabled ? (
                  <Field label={t("Up to (RM)")} className="sm:max-w-56" inputMode="decimal" value={String(f.invoices.max)}
                    onChange={(e) => set({ invoices: { ...f.invoices, max: money(e.target.value) } })} />
                ) : null}
              </div>
            </div>
            <div className="flex items-start gap-3 border-t border-border pt-4">
              <ShieldCheckIcon size={22} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
              <div className="grid min-w-0 flex-1 gap-2">
                <Field label={t("At most this many a day go through on their own")} className="sm:max-w-56" inputMode="numeric"
                  value={String(f.per_day)} onChange={(e) => set({ per_day: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                  hint={t("{n} so far today. After that, everything waits for a person until tomorrow.", { n: q.data?.used_today ?? 0 })} />
                <p className="text-[12.5px] text-muted">{t("Always waits for a person: anything over a limit, possible duplicates, other currencies, and bills from new suppliers (unless you turn that off).")}</p>
              </div>
            </div>
            <FormError message={save.error ? errorMessage(save.error) : null} />
            <div className="flex justify-end">
              <Button loading={save.isPending} onClick={() => save.mutate(f)}>{t("Save")}</Button>
            </div>
          </Card>

          <section className="grid gap-2">
            <h2 className="text-[15px] font-semibold">{t("What went through on its own")}</h2>
            {!q.data?.recent.length ? (
              <EmptyState icon={ShieldCheckIcon} title={t("Nothing yet")}
                body={t("Each bill or invoice draft that goes through under a limit is listed here, with a link to check it.")} />
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
                {q.data.recent.map((r, i) => (
                  <li key={i} className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                    <Pill tone={r.kind === "bill" ? "accent" : "info"}>{r.kind === "bill" ? t("Bill") : t("Agent")}</Pill>
                    {r.money_doc_id ? (
                      <Link to="/money" search={{ tab: "payable", doc: r.money_doc_id }} className="min-w-0 flex-1 truncate font-medium hover:text-accent">{r.label}</Link>
                    ) : r.task_id ? (
                      <Link to="/tasks" search={{ task: r.task_id }} className="min-w-0 flex-1 truncate hover:text-accent">{r.label}</Link>
                    ) : <span className="min-w-0 flex-1 truncate">{r.label}</span>}
                    {r.amount ? <span className="font-medium tabular">{r.amount}</span> : null}
                    <span className="text-[12px] text-muted">{timeAgo(r.at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Page>
  );
}

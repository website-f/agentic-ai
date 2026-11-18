import { CalendarBlankIcon, SunIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormError, Input } from "@/components/ui/field";
import { SideSheet } from "@/components/ui/side-sheet";
import { useT } from "@/i18n";
import { giveAllowance, tokens, type GiveSpan } from "@/lib/allowance";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";

const AMOUNTS = [10_000, 25_000, 50_000, 100_000];

export interface GiveTarget {
  user_id: string;
  name: string;
  used?: number;
  limit?: number | null;
  paused?: number;
}

/** P114 (Fitri, 18 Nov 2026): give a person more AI allowance for today only or for every day to
 * the end of this week. Their tasks paused at the limit start again, first paused first
 * (api/routers/allowances.py give_more). */
export function GiveAllowanceSheet({ person, onClose }: { person: GiveTarget; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [amount, setAmount] = useState("25000");
  const [span, setSpan] = useState<GiveSpan>("today");
  const n = Number(amount);
  const bad = !(n >= 1000 && n <= 5_000_000);
  const give = useMutation({
    mutationFn: () => giveAllowance(person.user_id, n, span),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ["allowance"] });
      void qc.invalidateQueries({ queryKey: workKeys.tasks });
      const what = span === "week"
        ? t("{name} gets {n} more tokens each day until Sunday.", { name: person.name, n: tokens(r.given) })
        : t("{name} gets {n} more tokens for today.", { name: person.name, n: tokens(r.given) });
      toast.success(r.resumed ? `${what} ${t("{n} paused tasks started again.", { n: r.resumed })}` : what);
      onClose();
    },
  });
  const spans: { value: GiveSpan; label: string; hint: string; icon: typeof SunIcon }[] = [
    { value: "today", label: t("Today only"), hint: t("Ends at midnight"), icon: SunIcon },
    { value: "week", label: t("This week"), hint: t("Added to every day until Sunday"), icon: CalendarBlankIcon },
  ];
  return (
    <SideSheet open onOpenChange={(o) => { if (!o) onClose(); }} size="sm" title={t("Give {name} more AI", { name: person.name })}
      description={person.limit != null ? t("Used {used} of {limit} tokens today.", { used: tokens(person.used ?? 0), limit: tokens(person.limit) }) : undefined}>
      <form className="grid gap-5" onSubmit={(e) => { e.preventDefault(); if (!bad) give.mutate(); }}>
        {person.paused ? (
          <p role="note" className="rounded-sm bg-warn/10 px-3 py-2 text-[13px] text-warn">
            {t("{n} of their tasks are paused. They start again as soon as you give more, the first paused first.", { n: person.paused })}
          </p>
        ) : null}
        <fieldset className="grid gap-2" disabled={give.isPending}>
          <legend className="mb-1 text-[13px] font-medium">{t("How long")}</legend>
          {spans.map((s) => (
            <label key={s.value} className={cn("flex cursor-pointer items-start gap-3 rounded-sm border px-3 py-2.5",
              span === s.value ? "border-accent bg-accent-soft/50" : "border-border hover:bg-surface-2")}>
              <input type="radio" name="span" value={s.value} checked={span === s.value} onChange={() => setSpan(s.value)} className="mt-0.5 size-4 accent-[var(--accent)]" />
              <s.icon size={16} className="mt-0.5 shrink-0 text-muted" />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[13.5px] font-medium">{s.label}</span>
                <span className="text-[12px] text-muted">{s.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <label htmlFor="give-amount" className="text-[13px] font-medium">{span === "week" ? t("Extra tokens each day") : t("Extra tokens today")}</label>
          <Input id="give-amount" type="number" min={1000} max={5_000_000} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full tabular sm:w-44" aria-invalid={bad || undefined} />
          <div className="flex flex-wrap gap-1.5">
            {AMOUNTS.map((a) => (
              <Button key={a} type="button" size="sm" variant={n === a ? "secondary" : "ghost"} onClick={() => setAmount(String(a))}>+{tokens(a)}</Button>
            ))}
          </div>
          {bad ? <p className="text-[12px] text-danger">{t("Give between 1,000 and 5,000,000 tokens.")}</p> : null}
        </div>
        <FormError message={give.error ? errorMessage(give.error) : null} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={give.isPending} disabled={bad}>{t("Give {n}", { n: tokens(n || 0) })}</Button>
          <Button type="button" variant="outline" onClick={onClose}>{t("Cancel")}</Button>
        </div>
      </form>
    </SideSheet>
  );
}

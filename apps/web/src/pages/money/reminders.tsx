/** A company's payment reminders: on or off, which days around the due date, and how they go
 * (an email draft approved in Mail, or text to copy). For finance managers. */
import { BellRingingIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, FormError } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { useCompanies } from "@/lib/company";
import { moneyKeys, parseDays, REMINDER_CHANNELS, remindersQuery, saveReminders, type ReminderSettings } from "@/lib/money";
import { LoadError } from "@/pages/contacts/bits";

type Translate = ReturnType<typeof useT>;

/** "3 days before the due date, then 1, 7 and 30 days after." */
export function describeDays(days: number[], t: Translate): string {
  const before = days.filter((d) => d < 0).map((d) => -d).sort((a, b) => b - a);
  const on = days.includes(0);
  const after = days.filter((d) => d > 0);
  const list = (ns: number[]) => ns.join(", ");
  const parts: string[] = [];
  if (before.length) parts.push(t("{list} days before the due date", { list: list(before) }));
  if (on) parts.push(t("on the due date"));
  if (after.length) parts.push(t("{list} days after", { list: list(after) }));
  return parts.length ? parts.join("; ") : t("No days set.");
}

export function RemindersCard({ branchId }: { branchId?: string }) {
  const t = useT();
  const { branches, canAll, one } = useCompanies();
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked ?? branchId ?? one?.id ?? "";
  const name = branches.find((b) => b.id === id)?.name ?? "";
  const settings = useQuery({ ...remindersQuery(id), enabled: !!id });
  return (
    <Card>
      <CardHeader icon={<BellRingingIcon size={20} weight="duotone" className="mt-0.5 shrink-0 text-accent" />} title={t("Payment reminders")}
        description={t("Customers with unpaid invoices are reminded on the days you choose. Nothing goes out without someone approving it.")}
        actions={canAll ? (
          <Select size="sm" value={id} onValueChange={setPicked} label={t("Company")} className="w-48" options={branches.map((b) => ({ value: b.id, label: b.name }))} />
        ) : null} />
      <CardBody>
        {!id ? null : settings.isLoading ? <Skeleton className="h-32" /> : settings.error ? <LoadError error={settings.error} /> : settings.data ? (
          <RemindersForm key={id} branchId={id} name={name} initial={settings.data} />
        ) : null}
      </CardBody>
    </Card>
  );
}

function RemindersForm({ branchId, name, initial }: { branchId: string; name: string; initial: ReminderSettings }) {
  const t = useT();
  const qc = useQueryClient();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [daysText, setDaysText] = useState(initial.days.join(", "));
  const [channel, setChannel] = useState(initial.channel);
  const days = parseDays(daysText);
  const save = useMutation({
    mutationFn: () => saveReminders(branchId, { enabled, days, channel }),
    onSuccess: (s) => {
      qc.setQueryData(moneyKeys.reminders(branchId), s);
      void qc.invalidateQueries({ queryKey: moneyKeys.reminders(branchId) });
      setDaysText((s?.days ?? days).join(", "));
      toast.success(name ? t("Reminders saved for {name}.", { name }) : t("Reminders saved."));
    },
  });
  const channels = REMINDER_CHANNELS.some((c) => c.value === channel) ? REMINDER_CHANNELS : [...REMINDER_CHANNELS, { value: channel, label: channel, hint: "" }];
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <SwitchField checked={enabled} onCheckedChange={setEnabled} label={t("Send payment reminders")} hint={t("Only for invoices that are sent and not fully paid.")} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
        <Field label={t("Days from the due date")} value={daysText} onChange={(e) => setDaysText(e.target.value)} disabled={!enabled}
          hint={enabled ? describeDays(days, t) : t("Negative is before the due date, e.g. -3, 1, 7, 14, 30.")} />
        <div className="grid content-start gap-1.5">
          <span className="text-[13px] font-medium">{t("How they go")}</span>
          <Select value={channel} onValueChange={setChannel} label={t("How they go")} disabled={!enabled}
            options={channels.map((c) => ({ value: c.value, label: t(c.label), hint: c.hint ? t(c.hint) : undefined }))} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={save.isPending} disabled={enabled && !days.length}>{t("Save reminders")}</Button>
      </div>
    </form>
  );
}

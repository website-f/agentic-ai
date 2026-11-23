/**
 * P125: changes by IT support that wait for an owner or a global admin (lib/held.ts).
 * - The Approvals page's "Changes by IT support" tab: each change's summary, who asked and when,
 *   its fields under "Details", Approve / Decline (a reason always), and how the run went.
 * - On Members and Organization, for IT support: a banner saying their changes go for approval,
 *   and their own changes still waiting (with Cancel).
 */
import { CheckCircleIcon, KeyIcon, ShieldCheckIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { approveHeld, cancelHeld, declineHeld, HELD_STATUS, heldQuery, heldReasonOk, MIN_HELD_REASON, oneTimePassword, type HeldChange } from "@/lib/held";
import { cn } from "@/lib/utils";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

function useRefresh() {
  const qc = useQueryClient();
  // An approved change may touch members, companies, access or settings: everything refreshes.
  return () => void qc.invalidateQueries();
}

/** One change: what, who and when, its fields, and (for an approver) approve or decline. */
export function HeldCard({ c, highlight }: { c: HeldChange; highlight?: boolean }) {
  const t = useT();
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const approve = useMutation({
    mutationFn: () => approveHeld(c.id, reason),
    onSuccess: (x) => {
      if (x.applied) {
        toast.success(t("Approved and done. {name} is told.", { name: x.change.requested_by_name }));
        setPassword(oneTimePassword(x.result));
      } else {
        toast.warning(t("Could not be applied: {message}", { message: x.change.apply_message }));
      }
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const decline = useMutation({
    mutationFn: () => declineHeld(c.id, reason),
    onSuccess: (x) => {
      toast.success(t("Declined. {name} is told why.", { name: x.requested_by_name }));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => cancelHeld(c.id),
    onSuccess: () => {
      toast.success(t("Change cancelled."));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const status = HELD_STATUS[c.status];
  const ok = heldReasonOk(reason);
  const busy = approve.isPending || decline.isPending;
  return (
    <Card id={`change-${c.id}`} className={cn("grid min-w-0 gap-3 p-4", highlight && "ring-2 ring-accent/40")}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <ShieldCheckIcon size={18} weight="duotone" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[12px] text-muted">{t("Change by IT support")}</span>
          <span className="text-[14.5px] font-semibold break-words">{c.summary}</span>
          <span className="text-[12.5px] text-muted">{t("{name} asked {when}", { name: c.requested_by_name || t("Someone"), when: when(c.created_at) })}</span>
        </div>
        <Pill tone={status.tone} className="shrink-0">{t(status.label)}</Pill>
      </div>
      {!c.requester_still_it_support ? (
        <p className="text-[12.5px] text-warn">
          {c.requester_role_label
            ? t("{name} is no longer IT support (now {role}). IT support's rules still apply to this change.", { name: c.requested_by_name, role: c.requester_role_label })
            : t("{name} is no longer a member here. IT support's rules still apply to this change.", { name: c.requested_by_name })}
        </p>
      ) : null}
      {c.status === "pending" && c.apply_message ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-[var(--radius-sm)] bg-danger/10 px-3 py-2 text-[13px] break-words text-danger">
          <WarningIcon size={15} className="mt-0.5 shrink-0" />
          <span>{t("Could not be applied: {message}", { message: c.apply_message })}</span>
        </p>
      ) : null}
      {c.details.length ? (
        <details className="group text-[13px]">
          <summary className="w-fit cursor-pointer font-medium text-accent hover:underline">{t("Details")}</summary>
          <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2">
            {c.details.map((d, i) => (
              <div key={`${d.field}-${i}`} className="contents">
                <dt className="text-muted break-words">{d.field}</dt>
                <dd className="min-w-0 break-words">{d.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {c.status === "pending" ? (
        <p className="text-[12px] text-muted">{t("Expires {when} if nobody decides it.", { when: when(c.expires_at) })}</p>
      ) : null}
      {c.status !== "pending" && c.status !== "cancelled" && c.status !== "expired" && c.decided_by_name ? (
        <p className="text-[12.5px] break-words text-muted">
          {t("{name} decided {when}", { name: c.decided_by_name, when: when(c.decided_at) })}
          {c.decision_note ? `: ${c.decision_note}` : ""}
        </p>
      ) : null}
      {password ? (
        <p className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2 text-[13px]">
          <KeyIcon size={15} className="text-accent" />
          {t("One-time password (shown once, give it to them):")} <code className="font-mono font-semibold select-all">{password}</code>
        </p>
      ) : null}
      {c.can_decide ? (
        <div className="grid gap-2 border-t border-border pt-3">
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Your reason")}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000}
              placeholder={t("Why you approve or decline it (they see this)")}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          </label>
          {!ok && reason ? <p className="text-[12px] text-muted">{t("Write at least {n} letters.", { n: MIN_HELD_REASON })}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={!ok || busy} loading={decline.isPending} onClick={() => decline.mutate()}>
              <XCircleIcon size={15} /> {t("Decline")}
            </Button>
            <Button size="sm" disabled={!ok || busy || c.status !== "pending"} loading={approve.isPending} onClick={() => approve.mutate()}>
              <CheckCircleIcon size={15} /> {c.apply_message ? t("Try again") : t("Approve")}
            </Button>
          </div>
        </div>
      ) : null}
      {c.can_cancel ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>{t("Cancel this change")}</Button>
        </div>
      ) : null}
    </Card>
  );
}

function List({ title, items, open }: { title: string; items: HeldChange[]; open?: string }) {
  if (!items.length) return null;
  return (
    <section className="grid gap-2" aria-label={title}>
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {items.map((c) => <HeldCard key={c.id} c={c} highlight={c.id === open} />)}
      </div>
    </section>
  );
}

/** The Approvals page's "Changes by IT support" tab. */
export function ItChanges({ open }: { open?: string }) {
  const t = useT();
  const { data, isLoading, error } = useQuery(heldQuery);
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.to_decide.length && !data.decided.length && !data.mine.length) {
    return (
      <EmptyState icon={ShieldCheckIcon} title={t("No changes by IT support")}
        body={t("When IT support adds or changes members, the organization, access or settings, the change waits here until an owner or a global admin approves it.")} />
    );
  }
  return (
    <div className="grid gap-6">
      {data.is_approver ? (
        data.to_decide.length ? (
          <List title={t("Waiting for you ({n})", { n: data.to_decide.length })} items={data.to_decide} open={open} />
        ) : (
          <p className="text-[13.5px] text-muted">{t("No change by IT support waits for you.")}</p>
        )
      ) : null}
      <List title={t("My changes")} items={data.mine} open={open} />
      <List title={t("Decided lately")} items={data.decided} open={open} />
    </div>
  );
}

/** On Members and Organization, for IT support only: their changes go for approval, and the
 * ones still waiting. */
export function ItSupportNotice({ role }: { role: string }) {
  const t = useT();
  const { data } = useQuery({ ...heldQuery, enabled: role === "it_support" });
  if (role !== "it_support") return null;
  const waiting = (data?.mine ?? []).filter((c) => c.status === "pending" || c.status === "applying");
  return (
    <div className="grid gap-3">
      <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft px-3 py-2.5 text-[13.5px]">
        <ShieldCheckIcon size={17} weight="duotone" className="mt-0.5 shrink-0 text-accent" />
        <span>{t("Your changes go to an owner or global admin for approval.")}</span>
      </p>
      {waiting.length ? (
        <List title={t("Waiting for approval ({n})", { n: waiting.length })} items={waiting} />
      ) : null}
    </div>
  );
}

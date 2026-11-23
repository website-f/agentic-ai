/**
 * P120: requests from people on the Approvals page (Fitri, 20 Nov 2026: "all approval processes
 * will be in the Approvals page, not just approvals for AI"). What waits for me (approve or
 * decline, always with a reason), what I decided lately, and what I asked for myself. The server
 * decides who sees and decides each one (lib/requests.ts).
 */
import { ArrowSquareOutIcon, CheckCircleIcon, EnvelopeSimpleIcon, FolderSimpleIcon, HandshakeIcon, XCircleIcon } from "@phosphor-icons/react";
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
import { linkedKeys } from "@/lib/linked-sources";
import { m365Keys } from "@/lib/m365";
import { cancelRequest, decideRequest, KIND_LABEL, MIN_REASON, reasonOk, requestKeys, requestsQuery, STATUS_LABEL, type PersonRequest } from "@/lib/requests";
import { cn } from "@/lib/utils";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: requestKeys.all });
    void qc.invalidateQueries({ queryKey: linkedKeys.all });
    void qc.invalidateQueries({ queryKey: ["me", "needs"] });
    void qc.invalidateQueries({ queryKey: ["microsoft"] }); // P124: a waiting work email account
    void qc.invalidateQueries({ queryKey: m365Keys.accounts });
  };
}

/** One request: who asked, for what, why; and (when it is mine to decide) approve or decline. */
export function RequestCard({ r, highlight }: { r: PersonRequest; highlight?: boolean }) {
  const t = useT();
  const refresh = useRefresh();
  const [reason, setReason] = useState("");
  const decide = useMutation({
    mutationFn: (d: "approve" | "decline") => decideRequest(r.id, d, reason),
    onSuccess: (x) => {
      toast.success(x.status === "approved" ? t("Approved. {name} is told.", { name: x.requested_by_name }) : t("Declined. {name} is told why.", { name: x.requested_by_name }));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cancel = useMutation({
    mutationFn: () => cancelRequest(r.id),
    onSuccess: () => {
      toast.success(t("Request cancelled."));
      refresh();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const status = STATUS_LABEL[r.status];
  const link = r.detail.web_url || r.detail.url;
  const ok = reasonOk(reason);
  return (
    <Card id={`request-${r.id}`} className={cn("grid min-w-0 gap-3 p-4", highlight && "ring-2 ring-accent/40")}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          {r.kind === "library_link" ? <FolderSimpleIcon size={18} weight="duotone" /> : r.kind === "work_mail" ? <EnvelopeSimpleIcon size={18} weight="duotone" /> : <HandshakeIcon size={18} weight="duotone" />}
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-[12px] text-muted">{t(KIND_LABEL[r.kind] ?? r.kind)}</span>
          <span className="text-[14.5px] font-semibold break-words">{r.title}</span>
          <span className="text-[12.5px] text-muted">
            {t("{name} asked {when}", { name: r.requested_by_name || t("Someone"), when: when(r.created_at) })}
            {r.branch_name ? ` · ${r.branch_name}` : ""}
          </span>
        </div>
        <Pill tone={status.tone} className="shrink-0">{t(status.label)}</Pill>
      </div>
      {r.kind === "work_mail" ? (
        <p className="text-[12.5px] break-words text-muted">
          {r.detail.source === "microsoft" ? t("Microsoft account on {domain}", { domain: r.detail.domain ?? "" }) : t("Email account (IMAP) on {domain}", { domain: r.detail.domain ?? "" })}
          {r.status === "pending" ? ` · ${t("It is not used until it is approved. Declining removes it and its sign-in.")}` : ""}
        </p>
      ) : null}
      {r.note ? <p className="rounded-[var(--radius-sm)] bg-surface-2 px-3 py-2 text-[13px] break-words">{r.note}</p> : null}
      {link ? (
        <a href={link} target="_blank" rel="noreferrer noopener" className="inline-flex w-fit max-w-full min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-accent hover:underline">
          <ArrowSquareOutIcon size={13} className="shrink-0" /> <span className="truncate">{t("Open it in SharePoint")}</span>
        </a>
      ) : null}
      {r.status === "pending" && r.approver_name && !r.can_decide ? (
        <p className="text-[12.5px] text-muted">{t("Waiting for {name} to decide.", { name: r.approver_name })}</p>
      ) : null}
      {r.status !== "pending" && r.status !== "cancelled" ? (
        <p className="text-[12.5px] break-words text-muted">
          {t("{name} decided {when}", { name: r.decided_by_name || t("Someone"), when: when(r.decided_at) })}
          {r.decision_note ? `: ${r.decision_note}` : ""}
        </p>
      ) : null}
      {r.can_decide ? (
        <div className="grid gap-2 border-t border-border pt-3">
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Your reason")}</span>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000}
              placeholder={t("Why you approve or decline it (they see this)")}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
          </label>
          {!ok && reason ? <p className="text-[12px] text-muted">{t("Write at least {n} letters.", { n: MIN_REASON })}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" size="sm" disabled={!ok || decide.isPending} loading={decide.isPending && decide.variables === "decline"} onClick={() => decide.mutate("decline")}>
              <XCircleIcon size={15} /> {t("Decline")}
            </Button>
            <Button size="sm" disabled={!ok || decide.isPending} loading={decide.isPending && decide.variables === "approve"} onClick={() => decide.mutate("approve")}>
              <CheckCircleIcon size={15} /> {t("Approve")}
            </Button>
          </div>
        </div>
      ) : null}
      {r.can_cancel ? (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>{t("Cancel my request")}</Button>
        </div>
      ) : null}
    </Card>
  );
}

function List({ title, items, open }: { title: string; items: PersonRequest[]; open?: string }) {
  if (!items.length) return null;
  return (
    <section className="grid gap-2" aria-label={title}>
      <h2 className="text-[13px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2">
        {items.map((r) => <RequestCard key={r.id} r={r} highlight={r.id === open} />)}
      </div>
    </section>
  );
}

/** The Approvals page's "From people" tab. */
export function PeopleRequests({ open }: { open?: string }) {
  const t = useT();
  const { data, isLoading, error } = useQuery(requestsQuery);
  if (isLoading) return <Skeleton className="h-40 rounded-[var(--radius-md)]" />;
  if (error || !data) return <p role="alert" className="text-danger">{errorMessage(error)}</p>;
  if (!data.to_decide.length && !data.decided.length && !data.mine.length) {
    return (
      <EmptyState icon={HandshakeIcon} title={t("No requests from people")}
        body={t("When someone asks for something that needs approval (such as a SharePoint folder for the Library or a work email account), the person above them decides it here.")} />
    );
  }
  return (
    <div className="grid gap-6">
      {data.to_decide.length ? (
        <List title={t("Waiting for you ({n})", { n: data.to_decide.length })} items={data.to_decide} open={open} />
      ) : (
        <p className="text-[13.5px] text-muted">{t("Nothing from your people waits for you.")}</p>
      )}
      <List title={t("My requests")} items={data.mine} open={open} />
      <List title={t("Decided lately")} items={data.decided} open={open} />
    </div>
  );
}

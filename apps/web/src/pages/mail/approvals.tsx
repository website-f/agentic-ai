/** P109 Teams Approvals on the Microsoft 365 page: what the person is asked to approve (Approve
 * / Reject with a comment, their own press), and what they asked others for. When the office's
 * Microsoft app may not read approvals yet, an honest card says which permission is missing and
 * who adds it. */
import { ArrowSquareOutIcon, CheckIcon, MicrosoftTeamsLogoIcon, PlusIcon, SealCheckIcon, ShareNetworkIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { MultiSelect } from "@/components/ui/search-select";
import { SwitchField } from "@/components/ui/switch";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, useT } from "@/i18n";
import { api, ApiError, errorMessage } from "@/lib/api";
import { approvalsQuery, m365Keys, respondApproval, type TeamsApproval } from "@/lib/m365";
import { microsoftAccountQuery, startMicrosoftConnect } from "@/lib/microsoft";

const STATE: Record<string, { label: string; tone: "warn" | "ok" | "neutral" | "danger" }> = {
  pending: { label: msg("Waiting"), tone: "warn" },
  completed: { label: msg("Done"), tone: "ok" },
  canceled: { label: msg("Cancelled"), tone: "neutral" },
  created: { label: msg("Starting"), tone: "neutral" },
};

export function TeamsApprovals() {
  const t = useT();
  const account = useQuery(microsoftAccountQuery);
  const q = useQuery({ ...approvalsQuery, enabled: !!account.data?.connected });
  const [answering, setAnswering] = useState<{ item: TeamsApproval; response: string } | null>(null);
  // P122: Teams approvals and SharePoint's sign-offs, apart or together.
  const [from, setFrom] = useState<"all" | "teams" | "sharepoint">("all");
  const [asking, setAsking] = useState(false);
  const reconnect = useMutation({
    mutationFn: startMicrosoftConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (q.isLoading || account.isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--radius-md)]" />)}</div>;
  if (q.error instanceof ApiError && (q.error.code === "approvals_off" || q.error.code === "approvals_unavailable")) {
    return (
      <div className="grid gap-3 rounded-[var(--radius-md)] border border-warn/30 bg-warn/6 p-4">
        <p className="flex items-center gap-2 text-[14px] font-semibold"><ShieldWarningIcon size={18} className="text-warn" /> {t("Teams Approvals need one more permission")}</p>
        <p className="text-[13px]">{q.error.message}</p>
        <ol className="grid list-decimal gap-1 pl-5 text-[12.5px] text-muted">
          <li>{t("Your Microsoft 365 admin adds the delegated Microsoft Graph permission ApprovalSolution.ReadWrite to the office's app in Microsoft Entra and grants admin consent.")}</li>
          <li>{t("An office admin turns on Teams Approvals (Channels > Microsoft 365).")}</li>
          <li>{t("You reconnect Microsoft 365 once.")}</li>
        </ol>
        <Button size="sm" variant="outline" className="w-fit" loading={reconnect.isPending} onClick={() => reconnect.mutate()}>{t("Reconnect Microsoft 365")}</Button>
      </div>
    );
  }
  if (q.error) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(q.error)}</p>;
  const all = q.data ?? [];
  const sourceOf = (a: TeamsApproval) => a.source ?? "teams";
  const counts = { all: all.length, teams: all.filter((a) => sourceOf(a) === "teams").length, sharepoint: all.filter((a) => sourceOf(a) === "sharepoint").length };
  const items = from === "all" ? all : all.filter((a) => sourceOf(a) === from);
  // What waits for an answer comes first.
  const pendingFirst = (a: TeamsApproval, b: TeamsApproval) => Number(b.state === "pending") - Number(a.state === "pending");
  const mine = items.filter((a) => a.i_approve).sort(pendingFirst);
  const asked = items.filter((a) => !a.i_approve && a.i_own).sort(pendingFirst);
  const newButton = (
    <Button size="sm" className="w-fit" onClick={() => setAsking(true)}>
      <PlusIcon size={14} /> {t("Ask for an approval")}
    </Button>
  );
  const dialog = asking ? <NewApprovalDialog onClose={() => setAsking(false)} /> : null;
  if (!all.length)
    return (
      <>
        <EmptyState icon={SealCheckIcon} title={t("No approvals")} body={t("Approvals made in the Approvals app in Teams, and files sent for sign-off in SharePoint, show here.")} action={newButton} />
        {dialog}
      </>
    );
  return (
    <div className="grid gap-5">
      {newButton}
      {dialog}
      {counts.teams && counts.sharepoint ? (
        <Segmented
          label={t("Where the approvals come from")}
          value={from}
          onChange={setFrom}
          className="w-fit"
          options={[
            { value: "all", label: t("All"), count: counts.all },
            { value: "teams", label: "Teams", count: counts.teams },
            { value: "sharepoint", label: "SharePoint", count: counts.sharepoint },
          ]}
        />
      ) : null}
      <section className="grid gap-2">
        <h3 className="text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">{t("Asked of you")}</h3>
        {mine.length ? <ul className="grid gap-2">{mine.map((a) => <ApprovalCard key={a.id} a={a} onAnswer={(response) => setAnswering({ item: a, response })} />)}</ul>
          : <p className="text-[13px] text-muted">{t("Nothing waits for you.")}</p>}
      </section>
      {asked.length ? (
        <section className="grid gap-2">
          <h3 className="text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">{t("You asked for")}</h3>
          <ul className="grid gap-2">{asked.map((a) => <ApprovalCard key={a.id} a={a} />)}</ul>
        </section>
      ) : null}
      {answering ? <AnswerDialog item={answering.item} response={answering.response} onClose={() => setAnswering(null)} /> : null}
    </div>
  );
}

function ApprovalCard({ a, onAnswer }: { a: TeamsApproval; onAnswer?: (response: string) => void }) {
  const t = useT();
  const st = STATE[a.state] ?? { label: a.state, tone: "neutral" as const };
  return (
    <li className="grid gap-2 rounded-[var(--radius-md)] border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <p className="text-[14px] font-medium break-words">{a.title}</p>
          <p className="text-[12.5px] text-muted">
            {[a.owner && t("From {name}", { name: a.owner }), a.created_at && new Date(a.created_at).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Pill className="gap-1">
          {a.source === "sharepoint" ? <ShareNetworkIcon size={13} /> : <MicrosoftTeamsLogoIcon size={13} />}
          {a.source === "sharepoint" ? "SharePoint" : "Teams"}
        </Pill>
        {a.all_must_approve ? <Pill>{t("Everyone must approve")}</Pill> : null}
        <Pill tone={st.tone}>{t(st.label)}</Pill>
        {a.result ? <Pill tone={/reject/i.test(a.result) ? "danger" : "ok"}>{a.result}</Pill> : null}
      </div>
      {a.description ? <p className="text-[13px] whitespace-pre-wrap break-words">{a.description}</p> : null}
      {a.link ? (
        <a href={a.link} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-accent hover:underline">
          <ArrowSquareOutIcon size={14} /> {a.source === "sharepoint" ? t("Open in SharePoint") : t("Open the link")}
        </a>
      ) : null}
      {onAnswer && a.state === "pending" ? (
        <div className="flex flex-wrap gap-2">
          {a.options.map((o) => (
            <Button key={o} size="sm" variant={/reject/i.test(o) ? "outline" : "primary"} onClick={() => onAnswer(o)}>
              {/reject/i.test(o) ? <XIcon size={14} /> : /approve/i.test(o) ? <CheckIcon size={14} /> : null}
              {/^approve$/i.test(o) ? t("Approve") : /^reject$/i.test(o) ? t("Reject") : o}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

function AnswerDialog({ item, response, onClose }: { item: TeamsApproval; response: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [comment, setComment] = useState("");
  const label = /^approve$/i.test(response) ? t("Approve") : /^reject$/i.test(response) ? t("Reject") : response;
  const send = useMutation({
    mutationFn: () => respondApproval(item.id, response, comment.trim()),
    onSuccess: () => { toast.success(t("Your answer was sent.")); void qc.invalidateQueries({ queryKey: m365Keys.approvals }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("{answer}: {title}", { answer: label, title: item.title })}
      description={t("Your answer goes to Teams Approvals now. Add a comment if you like.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button variant={/reject/i.test(response) ? "danger" : "primary"} loading={send.isPending} onClick={() => send.mutate()}>{label}</Button>
      </>}>
      <TextareaField label={t("Comment (optional)")} rows={3} value={comment} maxLength={2000} onChange={(e) => setComment(e.target.value)} />
    </ResponsiveDialog>
  );
}

/** P122: a new approval in the Approvals app in Teams, asked of colleagues of the same Microsoft
 * organisation (office members who signed in with Microsoft). Microsoft tells them in Teams. */
function NewApprovalDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const people = useQuery({ queryKey: [...m365Keys.approvals, "people"], queryFn: () => api<{ user_id: string; name: string }[]>("/api/m365/approvals/people"), staleTime: 5 * 60_000 });
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [approvers, setApprovers] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const send = useMutation({
    mutationFn: () => api<{ approvers: string[] }>("/api/m365/approvals", "POST", { title: title.trim(), description: details.trim(), approvers, all_must_approve: all }),
    onSuccess: (r) => {
      toast.success(t("Sent to {names} in Teams.", { names: r.approvers.join(", ") }));
      // Microsoft makes it in the background: look again in a few seconds.
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: m365Keys.approvals }), 4000);
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const options = (people.data ?? []).map((p) => ({ value: p.user_id, label: p.name }));
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("Ask for an approval")}
      description={t("It goes to the Approvals app in Teams. Your approvers are told in Teams and by email.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button loading={send.isPending} disabled={!title.trim() || !approvers.length} onClick={() => send.mutate()}>{t("Send")}</Button>
      </>}>
      <div className="grid gap-3">
        <Field label={t("What needs approving")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder={t("e.g. Buy 5 laptops for the HR team")} />
        <TextareaField label={t("Details (optional)")} rows={3} value={details} maxLength={2000} onChange={(e) => setDetails(e.target.value)} />
        <MultiSelect selectAll={false} value={approvers} onValueChange={setApprovers} options={options} label={t("Approvers")}
          placeholder={people.isLoading ? t("Loading...") : t("Pick who approves")}
          emptyText={t("Nobody here yet: colleagues show once they have signed in with Microsoft.")} />
        <SwitchField checked={all} onCheckedChange={setAll} label={t("Everyone must approve")} hint={t("Off: the first answer decides.")} />
      </div>
    </ResponsiveDialog>
  );
}

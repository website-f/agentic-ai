/** Microsoft approvals on the Microsoft 365 page.
 *
 * P109: what the person is asked to approve and what they asked others for. P127 (Fitri, 23 Nov
 * 2026: "put it all there ... make it I can view the approval to view the content and
 * attachments"): every approval of the office the person may see (owner and global admins: the
 * whole organisation, from every connected Microsoft account; branch managers and HODs: their
 * people's; everyone else: their own), filtered (waiting for me / for others / done, words, where
 * it was made, who asked), each one opened in a side sheet (a bottom sheet on phones) with its
 * details, links, approvers and their answers. Approve / Reject only for an approver who did not
 * ask for it, always with a reason. Answers the person's own AI prepared wait here until they
 * press Send. The list shows at once (the server keeps each account's list and refreshes it
 * behind); Refresh asks Microsoft afresh. */
import {
  ArrowClockwiseIcon, ArrowSquareOutIcon, CheckIcon, FlowArrowIcon, LinkSimpleIcon, MicrosoftTeamsLogoIcon, PaperPlaneRightIcon, PlusIcon,
  RobotIcon, SealCheckIcon, ShareNetworkIcon, ShieldWarningIcon, TrashIcon, XIcon,
} from "@phosphor-icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SearchInput } from "@/components/ui/search-input";
import { MultiSelect, SearchSelect } from "@/components/ui/search-select";
import { Segmented } from "@/components/ui/segmented";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  answerApproval, approvalDetailQuery, discardPreparedAnswer, freshOrgApprovals, m365Keys, orgApprovalKeys, orgApprovalsQuery, preparedAnswersQuery,
  sendPreparedAnswer, type ApprovalDetail, type OrgApproval, type OrgApprovals, type PreparedAnswer,
} from "@/lib/m365";
import { startMicrosoftConnect } from "@/lib/microsoft";

const STATE: Record<string, { label: string; tone: "warn" | "ok" | "neutral" | "danger" }> = {
  pending: { label: msg("Waiting"), tone: "warn" },
  completed: { label: msg("Done"), tone: "ok" },
  canceled: { label: msg("Cancelled"), tone: "neutral" },
  created: { label: msg("Starting"), tone: "neutral" },
};
const SOURCE: Record<OrgApproval["source"], { label: string; icon: typeof MicrosoftTeamsLogoIcon }> = {
  teams: { label: "Teams", icon: MicrosoftTeamsLogoIcon },
  sharepoint: { label: "SharePoint", icon: ShareNetworkIcon },
  flow: { label: "Power Automate", icon: FlowArrowIcon },
};
const VIEW_NOTE: Record<OrgApprovals["view"], string> = {
  all: msg("Every approval in your organisation, from everyone's connected Microsoft accounts."),
  scope: msg("Approvals of the people you manage, and your own."),
  own: msg("Approvals you asked for or are asked to answer."),
};
const MIN_REASON = 3;

type Status = "all" | "mine" | "others" | "done";
type From = "any" | OrgApproval["source"];

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const isApprove = (o: string) => /^approve/i.test(o);
const isReject = (o: string) => /^reject/i.test(o);

function useAnswerLabel() {
  const t = useT();
  return (o: string) => (/^approve$/i.test(o) ? t("Approve") : /^reject$/i.test(o) ? t("Reject") : /^approved$/i.test(o) ? t("Approved") : /^rejected$/i.test(o) ? t("Rejected") : o);
}

export function TeamsApprovals() {
  const t = useT();
  const qc = useQueryClient();
  const search = useSearch({ from: "/m365" });
  const navigate = useNavigate({ from: "/m365" });
  const q = useQuery({ ...orgApprovalsQuery, placeholderData: keepPreviousData });
  const prepared = useQuery(preparedAnswersQuery);
  const [status, setStatus] = useState<Status>("all");
  const [from, setFrom] = useState<From>("any");
  const [who, setWho] = useState("");
  const [words, setWords] = useState("");
  const [asking, setAsking] = useState(false);
  const open = (id: string | undefined) => void navigate({ search: (s) => ({ ...s, approval: id }), replace: true });
  const refresh = useMutation({
    mutationFn: freshOrgApprovals,
    onSuccess: (data) => { qc.setQueryData(orgApprovalKeys.all, data); void qc.invalidateQueries({ queryKey: orgApprovalKeys.prepared }); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const counts = useMemo(() => ({
    all: all.length,
    mine: all.filter((a) => a.waiting_for_me).length,
    others: all.filter((a) => a.state === "pending" && !a.waiting_for_me).length,
    done: all.filter((a) => a.state !== "pending").length,
  }), [all]);
  const sources = useMemo(() => [...new Set(all.map((a) => a.source))], [all]);
  const askers = useMemo(() => [...new Set(all.map((a) => a.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [all]);
  const items = useMemo(() => {
    const w = words.trim().toLowerCase();
    return all
      .filter((a) => status === "all" || (status === "mine" ? a.waiting_for_me : status === "others" ? a.state === "pending" && !a.waiting_for_me : a.state !== "pending"))
      .filter((a) => from === "any" || a.source === from)
      .filter((a) => !who || a.owner === who)
      .filter((a) => !w || `${a.title} ${a.description} ${a.owner} ${a.approvers.map((p) => p.name).join(" ")}`.toLowerCase().includes(w))
      .sort((a, b) => Number(b.waiting_for_me) - Number(a.waiting_for_me));
  }, [all, status, from, who, words]);

  if (q.isLoading) return <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 rounded-[var(--radius-md)]" />)}</div>;
  if (q.error && !q.data) return <p role="alert" className="text-[13.5px] text-danger">{errorMessage(q.error)}</p>;
  const data = q.data;
  const newButton = (
    <Button size="sm" className="w-fit" onClick={() => setAsking(true)}>
      <PlusIcon size={14} /> {t("Ask for an approval")}
    </Button>
  );
  const dialog = asking ? <NewApprovalDialog onClose={() => setAsking(false)} /> : null;
  const sheet = search.approval ? <ApprovalSheet id={search.approval} onClose={() => open(undefined)} /> : null;
  if (data && !data.connected && !all.length) return <PermissionCard />;
  const waiting = prepared.data ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {data?.connected ? newButton : null}
        <Button size="sm" variant="outline" className="w-fit" loading={refresh.isPending} onClick={() => refresh.mutate()}>
          <ArrowClockwiseIcon size={14} /> {t("Refresh")}
        </Button>
        {data ? <p className="min-w-0 flex-1 basis-60 text-[12.5px] text-muted">{t(VIEW_NOTE[data.view])}</p> : null}
      </div>
      {data && data.failed > 0 ? (
        <p className="rounded-[var(--radius-md)] border border-warn/30 bg-warn/6 px-3 py-2 text-[12.5px]">
          {t("{n} connected Microsoft accounts could not be read just now; their approvals may be missing. Refresh in a moment.", { n: data.failed })}
        </p>
      ) : null}
      {dialog}

      {waiting.length ? (
        <section className="grid gap-2" aria-label={t("Answers your AI prepared")}>
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase"><RobotIcon size={15} /> {t("Answers your AI prepared")}</h3>
          <ul className="grid gap-2">{waiting.map((p) => <PreparedCard key={p.id} p={p} onOpen={() => open(p.approval_id)} />)}</ul>
        </section>
      ) : null}

      {!all.length ? (
        <EmptyState icon={SealCheckIcon} title={t("No approvals")} body={t("Approvals made in the Approvals app in Teams, and files sent for sign-off in SharePoint, show here.")} />
      ) : (
        <>
          <Segmented
            label={t("Which approvals")}
            value={status}
            onChange={setStatus}
            className="w-fit max-w-full"
            options={[
              { value: "all", label: t("All"), count: counts.all },
              { value: "mine", label: t("Waiting for me"), count: counts.mine },
              { value: "others", label: t("Waiting for others"), count: counts.others },
              { value: "done", label: t("Done"), count: counts.done },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={words} onChange={setWords} placeholder={t("Search approvals")} />
            {sources.length > 1 ? (
              <Segmented
                size="sm"
                label={t("Where the approvals come from")}
                value={from}
                onChange={setFrom}
                className="w-fit max-w-full"
                options={[{ value: "any" as From, label: t("Anywhere") }, ...sources.map((s) => ({ value: s as From, label: SOURCE[s].label }))]}
              />
            ) : null}
            {askers.length > 1 ? (
              <SearchSelect size="sm" className="w-full sm:w-56" label={t("Who asked")} value={who} onValueChange={setWho}
                options={[{ value: "", label: t("Anyone asked") }, ...askers.map((n) => ({ value: n, label: n }))]} />
            ) : null}
          </div>
          {items.length ? (
            <ul className="grid gap-2">{items.map((a) => <ApprovalCard key={a.id} a={a} onOpen={() => open(a.id)} />)}</ul>
          ) : (
            <p className="text-[13px] text-muted">{status === "mine" ? t("Nothing waits for you.") : t("No approvals match.")}</p>
          )}
        </>
      )}
      {sheet}
    </div>
  );
}

/** The office's Microsoft app may not read approvals yet: which permission, and who adds it. */
function PermissionCard() {
  const t = useT();
  const reconnect = useMutation({
    mutationFn: startMicrosoftConnect,
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-3 rounded-[var(--radius-md)] border border-warn/30 bg-warn/6 p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold"><ShieldWarningIcon size={18} className="text-warn" /> {t("Teams Approvals need one more permission")}</p>
      <ol className="grid list-decimal gap-1 pl-5 text-[12.5px] text-muted">
        <li>{t("Your Microsoft 365 admin adds the delegated Microsoft Graph permission ApprovalSolution.ReadWrite to the office's app in Microsoft Entra and grants admin consent.")}</li>
        <li>{t("An office admin turns on Teams Approvals (Channels > Microsoft 365).")}</li>
        <li>{t("You reconnect Microsoft 365 once.")}</li>
      </ol>
      <Button size="sm" variant="outline" className="w-fit" loading={reconnect.isPending} onClick={() => reconnect.mutate()}>{t("Reconnect Microsoft 365")}</Button>
    </div>
  );
}

function Badges({ a }: { a: OrgApproval }) {
  const t = useT();
  const label = useAnswerLabel();
  const st = STATE[a.state] ?? { label: a.state, tone: "neutral" as const };
  const src = SOURCE[a.source] ?? SOURCE.teams;
  return (
    <>
      <Pill className="gap-1"><src.icon size={13} />{src.label}</Pill>
      {a.all_must_approve ? <Pill>{t("Everyone must approve")}</Pill> : null}
      <Pill tone={st.tone}>{t(st.label)}</Pill>
      {a.result ? <Pill tone={/reject/i.test(a.result) ? "danger" : "ok"}>{label(a.result)}</Pill> : null}
    </>
  );
}

function ApprovalCard({ a, onOpen }: { a: OrgApproval; onOpen: () => void }) {
  const t = useT();
  const approvers = a.approvers.map((p) => p.name).filter(Boolean).join(", ");
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface p-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent">
        <div className="flex flex-wrap items-start gap-2">
          <p className="min-w-0 flex-1 basis-48 text-[14px] font-medium break-words">{a.title}</p>
          {a.waiting_for_me ? <Pill tone="accent">{t("Waiting for you")}</Pill> : null}
          <Badges a={a} />
        </div>
        <p className="text-[12.5px] text-muted">
          {[a.i_own ? t("You asked") : a.owner && t("From {name}", { name: a.owner }), when(a.created_at), approvers && t("Approvers: {names}", { names: approvers })].filter(Boolean).join(" · ")}
        </p>
        {a.description ? <p className="line-clamp-2 text-[13px] break-words text-muted">{a.description}</p> : null}
      </button>
    </li>
  );
}

function PreparedCard({ p, onOpen }: { p: PreparedAnswer; onOpen: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const label = useAnswerLabel();
  const [editing, setEditing] = useState(false);
  const done = () => { void qc.invalidateQueries({ queryKey: m365Keys.approvals }); };
  const discard = useMutation({
    mutationFn: () => discardPreparedAnswer(p.id),
    onSuccess: () => { toast.success(t("Discarded. Nothing was sent.")); done(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <li className="grid gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 p-3">
      <div className="flex flex-wrap items-start gap-2">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 basis-48 text-left text-[14px] font-medium break-words hover:underline">{p.title}</button>
        <Pill tone={isReject(p.response) ? "danger" : "ok"}>{label(p.response)}</Pill>
      </div>
      <p className="text-[13px] break-words"><span className="text-muted">{t("Reason")}: </span>{p.reason}</p>
      <p className="text-[12px] text-muted">{t("Nothing is sent until you press Send.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setEditing(true)}><PaperPlaneRightIcon size={14} /> {t("Check and send")}</Button>
        <Button size="sm" variant="ghost" loading={discard.isPending} onClick={() => discard.mutate()}><TrashIcon size={14} /> {t("Discard")}</Button>
      </div>
      {editing ? <AnswerDialog title={p.title} approvalId={p.approval_id} response={p.response} prepared={p} onClose={() => setEditing(false)} /> : null}
    </li>
  );
}

function ApprovalSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const label = useAnswerLabel();
  const qc = useQueryClient();
  // Shown at once from the list; the full approval (approvers, answers) fills in.
  const listed = qc.getQueryData<OrgApprovals>(orgApprovalKeys.all)?.items.find((a) => a.id === id);
  const q = useQuery({ ...approvalDetailQuery(id), placeholderData: listed ? ({ ...listed, links: [], people: listed.approvers, answered: false, can_answer: false, prepared: [] } as ApprovalDetail) : undefined });
  const [answering, setAnswering] = useState<string | null>(null);
  const d = q.data;
  const shareLink = d?.source === "sharepoint" ? d.links[0] ?? d.link : "";
  const footer = d ? (
    <div className="flex flex-wrap gap-2">
      {d.can_answer && !d.i_own
        ? d.options.map((o) => (
          <Button key={o} size="sm" variant={isReject(o) ? "outline" : "primary"} onClick={() => setAnswering(o)}>
            {isReject(o) ? <XIcon size={14} /> : isApprove(o) ? <CheckIcon size={14} /> : null}
            {label(o)}
          </Button>
        ))
        : null}
      <a href={d.teams_link} target="_blank" rel="noreferrer"
        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
        <MicrosoftTeamsLogoIcon size={14} /> {t("Open in Teams")}
      </a>
      {shareLink ? (
        <a href={shareLink} target="_blank" rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 text-[13px] font-medium hover:bg-surface-2">
          <ArrowSquareOutIcon size={14} /> {t("Open in SharePoint")}
        </a>
      ) : null}
    </div>
  ) : null;
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} title={d?.title ?? t("Approval")} actions={footer}
      description={d ? [d.i_own ? t("You asked") : d.owner && t("From {name}", { name: d.owner }), when(d.created_at)].filter(Boolean).join(" · ") : undefined}>
      {!d ? (
        q.error ? <p role="alert" className="text-[13.5px] text-danger">{errorMessage(q.error)}</p> : <Skeleton className="h-40 rounded-[var(--radius-md)]" />
      ) : (
        <div className="grid gap-5">
          <div className="flex flex-wrap gap-2"><Badges a={d} /></div>
          {d.waiting_for_me && d.answered ? <p className="text-[13px] text-muted">{t("You answered already; it waits for the other approvers.")}</p> : null}
          {d.i_own && d.state === "pending" ? <p className="text-[13px] text-muted">{t("You asked for this approval: another approver answers it.")}</p> : null}

          <section className="grid gap-1.5">
            <h4 className="text-[12px] font-semibold tracking-[0.04em] text-muted uppercase">{t("Details")}</h4>
            <p className="text-[13.5px] whitespace-pre-wrap break-words">{d.description || t("No details were given.")}</p>
          </section>

          <section className="grid gap-1.5">
            <h4 className="text-[12px] font-semibold tracking-[0.04em] text-muted uppercase">{t("Links and files")}</h4>
            {d.links.length ? (
              <ul className="grid gap-1">
                {d.links.map((l) => (
                  <li key={l}>
                    <a href={l} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium break-all text-accent hover:underline">
                      <LinkSimpleIcon size={14} className="shrink-0" /> {l}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-[12.5px] text-muted">{t("Files attached in Teams are not handed out by Microsoft: open the approval in Teams to see them.")}</p>
          </section>

          <section className="grid gap-1.5">
            <h4 className="text-[12px] font-semibold tracking-[0.04em] text-muted uppercase">{t("Approvers")}</h4>
            {d.people.length ? (
              <ul className="grid gap-2">
                {d.people.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="grid gap-0.5 rounded-[var(--radius-md)] border border-border p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 flex-1 text-[13.5px] font-medium break-words">{p.name || t("Someone")}{p.group ? ` (${t("group")})` : ""}</span>
                      {p.response ? <Pill tone={isReject(p.response) ? "danger" : "ok"}>{label(p.response)}</Pill> : <Pill tone="warn">{t("No answer yet")}</Pill>}
                    </div>
                    {p.comment ? <p className="text-[13px] whitespace-pre-wrap break-words">“{p.comment}”</p> : null}
                    {p.answered_at ? <p className="text-[12px] text-muted">{when(p.answered_at)}</p> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-muted">{q.isPlaceholderData ? t("Loading...") : t("Microsoft did not say who the approvers are.")}</p>}
          </section>

          {d.prepared.length ? (
            <section className="grid gap-2">
              <h4 className="flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.04em] text-muted uppercase"><RobotIcon size={14} /> {t("Answers your AI prepared")}</h4>
              <ul className="grid gap-2">{d.prepared.map((p) => <PreparedCard key={p.id} p={p} onOpen={() => undefined} />)}</ul>
            </section>
          ) : null}
        </div>
      )}
      {answering && d ? <AnswerDialog title={d.title} approvalId={d.id} response={answering} onClose={() => setAnswering(null)} /> : null}
    </SideSheet>
  );
}

/** Approve / Reject (or the approval's own answers) with a reason: always required. A prepared
 * answer from the person's AI is sent through the same dialog, after they read it. */
function AnswerDialog({ title, approvalId, response, prepared, onClose }: { title: string; approvalId: string; response: string; prepared?: PreparedAnswer; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const label = useAnswerLabel()(response);
  const [reason, setReason] = useState(prepared?.reason ?? "");
  const short = reason.trim().length < MIN_REASON;
  const send = useMutation({
    mutationFn: () => (prepared ? sendPreparedAnswer(prepared.id, reason.trim()) : answerApproval(approvalId, response, reason.trim())),
    onSuccess: () => {
      toast.success(t("Your answer was sent."));
      void qc.invalidateQueries({ queryKey: m365Keys.approvals });
      onClose();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("{answer}: {title}", { answer: label, title })}
      description={prepared ? t("Your AI prepared this answer. Read it, change the reason if you like, and send it.") : t("Your answer goes to Microsoft Approvals now, with your reason.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button variant={isReject(response) ? "danger" : "primary"} disabled={short} loading={send.isPending} onClick={() => send.mutate()}>{label}</Button>
      </>}>
      <TextareaField label={t("Reason")} hint={t("Required, for approving and for rejecting.")} rows={3} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
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
      // Microsoft makes it in the background: look again (afresh) in a few seconds.
      window.setTimeout(() => void freshOrgApprovals().then((d) => qc.setQueryData(orgApprovalKeys.all, d)).catch(() => undefined), 4000);
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

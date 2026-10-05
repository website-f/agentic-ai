import { ArchiveIcon, CheckIcon, FlaskIcon, GitDiffIcon, HourglassIcon, PencilSimpleIcon, QuestionIcon, RobotIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { DiffView } from "@/components/diff-view";
import { Markdown } from "@/components/markdown";
import { IconTile, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { isAutoApproved, learningKeys } from "@/lib/learning";
import { keys } from "@/lib/queries";
import { compact, KIND_LABEL, proposalQuery, skillKeys, type ProposalDetail } from "@/lib/skills";
import { timeAgo } from "@/lib/utils";

import { EvalResults, SuiteBadge } from "./eval-results";

const STATUS_TONE = { pending: "warn", approved: "ok", rejected: "danger", superseded: "neutral" } as const;
const STATUS_LABEL = { pending: msg("pending"), approved: msg("approved"), rejected: msg("rejected"), superseded: msg("superseded") } as const;
/** The closing line of a decided proposal, by status and by who decided. */
const DECIDED = {
  approved: { none: msg("Approved"), name: msg("Approved by {name}"), auto: msg("Approved by the learning autopilot") },
  rejected: { none: msg("Rejected"), name: msg("Rejected by {name}"), auto: msg("Rejected by the learning autopilot") },
  superseded: { none: msg("Replaced by a newer draft"), name: msg("Replaced by a newer draft by {name}"), auto: msg("Replaced by a newer draft by the learning autopilot") },
} as const;

function Heading({ icon, tone = "neutral", children, actions }: { icon: typeof FlaskIcon; tone?: Tone; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-2 text-[14px] font-semibold"><IconTile icon={icon} tone={tone} size="sm" /> <span className="min-w-0 break-words">{children}</span></h3>
      {actions ? <span className="flex flex-wrap items-center gap-2">{actions}</span> : null}
    </div>
  );
}

function Scan({ p }: { p: ProposalDetail }) {
  const t = useT();
  if (p.kind === "retire") return null;
  if (!p.scan.length) return <Pill tone="ok" className="w-fit"><CheckIcon size={12} weight="bold" /> {t("Safety scan clean")}</Pill>;
  return (
    <ul className="grid gap-1.5">
      {p.scan.map((f) => (
        <li key={f.code} className={f.level === "block" ? "flex gap-2 rounded-sm bg-danger/8 px-3 py-2 text-[13px] text-danger" : "flex gap-2 rounded-sm bg-warn/10 px-3 py-2 text-[13px] text-warn"}>
          <ShieldWarningIcon size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words"><span className="font-medium">{f.level === "block" ? t("Must fix:") : t("Check:")}</span> {f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProposalSheet({ id, canDecide, canWrite, onClose }: { id: string; canDecide: boolean; canWrite: boolean; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: p, isLoading, error } = useQuery(proposalQuery(id));
  const [editing, setEditing] = useState<{ description: string; body: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: skillKeys.all });
    qc.invalidateQueries({ queryKey: keys.status });
    qc.invalidateQueries({ queryKey: learningKeys.all });
  };
  const approve = useMutation({
    mutationFn: () => api(`/api/skill-proposals/${id}/approve`, "POST", editing ?? {}),
    onSuccess: () => {
      refresh();
      toast.success(p?.kind === "retire" ? tr("Retired.") : tr("Approved. Agents see it from their next step."));
      onClose();
    },
  });
  const reject = useMutation({
    mutationFn: () => api(`/api/skill-proposals/${id}/reject`, "POST", { reason: rejecting ?? "" }),
    onSuccess: () => {
      refresh();
      toast.success(p?.agent_id ? tr("Rejected. The agent remembers your reason.") : tr("Rejected."));
      onClose();
    },
  });
  const evaluate = useMutation({
    mutationFn: () => api(`/api/skill-proposals/${id}/evaluate`, "POST"),
    onSuccess: () => toast(tr("Running the tests. Results appear here in a minute.")),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const blocked = p?.scan.some((f) => f.level === "block") && !editing;
  const pending = p?.status === "pending";
  const auto = p ? isAutoApproved(p) : false;

  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={p ? <span className="font-mono break-all">{p.name}</span> : t("Proposal")}
      description={p ? (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">{t(KIND_LABEL[p.kind])}</Pill>
          <Pill tone={STATUS_TONE[p.status]}>{t(STATUS_LABEL[p.status])}</Pill>
          {auto ? <Pill tone="info"><RobotIcon size={12} weight="fill" aria-hidden /> {t("Auto-approved")}</Pill> : null}
          <span>{t("from {name}, {when}", { name: p.proposed_by_name, when: timeAgo(p.created_at).toLowerCase() })}</span>
        </span>
      ) : null}
      actions={p && pending && canDecide ? (
        editing ? (
          <>
            <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate()}><CheckIcon size={14} weight="bold" /> {t("Save and approve")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t("Cancel edit")}</Button>
          </>
        ) : rejecting !== null ? (
          <>
            <Button size="sm" variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}><XIcon size={14} weight="bold" /> {t("Reject")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>{t("Cancel")}</Button>
          </>
        ) : (
          <>
            <Button size="sm" loading={approve.isPending} disabled={blocked} onClick={() => approve.mutate()}><CheckIcon size={14} weight="bold" /> {t("Approve")}</Button>
            {p.kind !== "retire" ? <Button size="sm" variant="outline" onClick={() => setEditing({ description: p.description, body: p.body })}><PencilSimpleIcon size={14} /> {t("Edit and approve")}</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setRejecting("")}><XIcon size={14} /> {t("Reject")}</Button>
          </>
        )
      ) : null}
    >
      {isLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-20 rounded-[var(--radius-md)]" />
          <Skeleton className="h-72 rounded-[var(--radius-md)]" />
        </div>
      ) : error || !p ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {rejecting !== null ? (
            <div className="grid gap-1.5">
              <label htmlFor="reject-reason" className="text-[13px] font-medium">{p.agent_id ? t("Why not? The agent remembers this next time.") : t("Why not?")}</label>
              <textarea id="reject-reason" value={rejecting} onChange={(e) => setRejecting(e.target.value)} rows={3} autoFocus
                className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
            </div>
          ) : null}
          {pending && p.decision_note ? (
            <p role="status" className="flex items-start gap-2 rounded-[var(--radius-sm)] bg-warn/10 px-3 py-2 text-[13px] text-warn">
              <HourglassIcon size={16} weight="fill" className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{p.decision_note}</span>
            </p>
          ) : null}
          <FormError message={approve.error ? errorMessage(approve.error) : reject.error ? errorMessage(reject.error) : null} />

          <section className="grid min-w-0 gap-2.5">
            <Heading icon={QuestionIcon} tone="accent">{t("Why")}</Heading>
            <p className="text-[13.5px] break-words">{p.reason || t("No reason given.")}</p>
            {p.source_task ? (
              <p className="text-[12.5px] text-muted">
                {t("Learned from")} <Link to="/tasks" search={{ task: p.source_task.id }} className="text-accent hover:underline">{p.source_task.title}</Link>
                {p.source_task.tokens ? t(", which took {n} tokens.", { n: compact(p.source_task.tokens) }) : "."}
              </p>
            ) : null}
            {p.stale ? <p className="rounded-sm bg-warn/10 px-3 py-2 text-[12.5px] text-warn">{t("The skill changed since this was drafted (now version {n}). Review the diff against the current text.", { n: p.current?.version ?? "" })}</p> : null}
            <Scan p={p} />
          </section>

          {editing ? (
            <section className="grid gap-3">
              <Field label={t("Description")} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              <div className="grid gap-1.5">
                <label htmlFor="edit-body" className="text-[13px] font-medium">{t("Instructions")}</label>
                <textarea id="edit-body" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={20}
                  className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
              </div>
            </section>
          ) : p.kind === "retire" ? (
            <section className="grid min-w-0 gap-2.5">
              <Heading icon={ArchiveIcon}>{t("Skill to retire")}</Heading>
              <p className="text-[13px] text-muted">{p.description}</p>
              <p className="text-[13px] text-muted">{t("Retired skills disappear from agents' lists. You can restore one at any time.")}</p>
            </section>
          ) : (
            <section className="grid min-w-0 gap-2.5">
              <Heading icon={GitDiffIcon} tone="info">{p.current ? t("Changes to version {n}", { n: p.current.version }) : t("Proposed skill")}</Heading>
              <p className="text-[13px] break-words"><span className="text-muted">{t("Description:")}</span> {p.description}</p>
              {p.current && p.current.description !== p.description ? (
                <p className="text-[12.5px] text-muted line-through">{p.current.description}</p>
              ) : null}
              {p.current ? (
                <div className="min-w-0"><DiffView before={p.kind === "merge" && p.other ? `${p.current.body}\n${p.other.body}` : p.current.body} after={p.body}
                  labels={[p.kind === "merge" && p.other ? `${p.name} + ${p.other.name}` : t("Version {n}", { n: p.current.version }), t("Proposed")]} /></div>
              ) : (
                <div className="min-w-0 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3.5 sm:px-5"><Markdown>{p.body}</Markdown></div>
              )}
            </section>
          )}

          {p.kind !== "retire" ? (
            <section className="grid min-w-0 gap-2.5">
              <Heading icon={FlaskIcon} tone="info" actions={(
                <>
                  {p.eval?.old ? <SuiteBadge suite={p.eval.old} label={t("Version {n}", { n: p.eval.old_version ?? "" })} /> : null}
                  <SuiteBadge suite={p.eval?.new} label={t("Proposed")} />
                  {canWrite && pending ? <Button size="sm" variant="outline" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>{t("Run tests")}</Button> : null}
                </>
              )}>{t("Tests")}</Heading>
              {p.eval?.new ? <EvalResults suite={p.eval.new} before={p.eval.old} />
                : <p className="text-[13px] text-muted">{p.eval_cases.length || p.current ? t("Not run yet.") : t("No test cases yet. Approving adds the ones proposed here; you can add more on the skill.")}</p>}
              {p.eval_cases.length ? (
                <p className="text-[12.5px] text-muted">{p.eval_cases.length === 1 ? t("Brings 1 test case: {list}.", { list: p.eval_cases.map((c) => c.title).join(", ") }) : t("Brings {n} test cases: {list}.", { n: p.eval_cases.length, list: p.eval_cases.map((c) => c.title).join(", ") })}</p>
              ) : null}
            </section>
          ) : null}

          {p.status !== "pending" ? (
            <p className="text-[12.5px] text-muted">
              {t(DECIDED[p.status as keyof typeof DECIDED][p.decided_by_name ? "name" : auto ? "auto" : "none"], { name: p.decided_by_name ?? "" })}
              {p.decided_at ? `, ${timeAgo(p.decided_at).toLowerCase()}` : ""}
              {p.decision_note ? `: ${auto ? p.decision_note.replace(/^Approved automatically:\s*/, "") : p.decision_note}` : "."}
            </p>
          ) : null}
        </div>
      )}
    </SideSheet>
  );
}

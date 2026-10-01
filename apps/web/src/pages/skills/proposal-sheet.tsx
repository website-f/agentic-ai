import { CheckIcon, FlaskIcon, PencilSimpleIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { DiffView } from "@/components/diff-view";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { compact, KIND_LABEL, proposalQuery, skillKeys, type Proposal } from "@/lib/skills";
import { timeAgo } from "@/lib/utils";

import { EvalResults, SuiteBadge } from "./eval-results";

const STATUS_TONE = { pending: "warn", approved: "ok", rejected: "danger", superseded: "neutral" } as const;

function Scan({ p }: { p: Proposal }) {
  if (p.kind === "retire") return null;
  if (!p.scan.length) return <Pill tone="ok" className="w-fit"><CheckIcon size={12} weight="bold" /> Safety scan clean</Pill>;
  return (
    <ul className="grid gap-1.5">
      {p.scan.map((f) => (
        <li key={f.code} className={f.level === "block" ? "flex gap-2 text-[13px] text-danger" : "flex gap-2 text-[13px] text-warn"}>
          <ShieldWarningIcon size={16} weight="fill" className="mt-0.5 shrink-0" />
          <span><span className="font-medium">{f.level === "block" ? "Must fix" : "Check"}:</span> {f.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function ProposalSheet({ id, canDecide, canWrite, onClose }: { id: string; canDecide: boolean; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: p, isLoading, error } = useQuery(proposalQuery(id));
  const [editing, setEditing] = useState<{ description: string; body: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: skillKeys.all });
    qc.invalidateQueries({ queryKey: keys.status });
  };
  const approve = useMutation({
    mutationFn: () => api(`/api/skill-proposals/${id}/approve`, "POST", editing ?? {}),
    onSuccess: () => {
      refresh();
      toast.success(p?.kind === "retire" ? "Retired." : "Approved. Agents see it from their next step.");
      onClose();
    },
  });
  const reject = useMutation({
    mutationFn: () => api(`/api/skill-proposals/${id}/reject`, "POST", { reason: rejecting ?? "" }),
    onSuccess: () => {
      refresh();
      toast.success(p?.agent_id ? "Rejected. The agent remembers your reason." : "Rejected.");
      onClose();
    },
  });
  const evaluate = useMutation({
    mutationFn: () => api(`/api/skill-proposals/${id}/evaluate`, "POST"),
    onSuccess: () => toast("Running the tests. Results appear here in a minute."),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const blocked = p?.scan.some((f) => f.level === "block") && !editing;
  const pending = p?.status === "pending";

  return (
    <SideSheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={p ? <span className="font-mono">{p.name}</span> : "Proposal"}
      description={p ? (
        <span className="flex flex-wrap items-center gap-2">
          <Pill tone="accent">{KIND_LABEL[p.kind]}</Pill>
          <Pill tone={STATUS_TONE[p.status]}>{p.status}</Pill>
          <span>from {p.proposed_by_name}, {timeAgo(p.created_at).toLowerCase()}</span>
        </span>
      ) : null}
      actions={p && pending && canDecide ? (
        editing ? (
          <>
            <Button size="sm" loading={approve.isPending} onClick={() => approve.mutate()}><CheckIcon size={14} weight="bold" /> Save and approve</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel edit</Button>
          </>
        ) : rejecting !== null ? (
          <>
            <Button size="sm" variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}><XIcon size={14} weight="bold" /> Reject</Button>
            <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
          </>
        ) : (
          <>
            <Button size="sm" loading={approve.isPending} disabled={blocked} onClick={() => approve.mutate()}><CheckIcon size={14} weight="bold" /> Approve</Button>
            {p.kind !== "retire" ? <Button size="sm" variant="outline" onClick={() => setEditing({ description: p.description, body: p.body })}><PencilSimpleIcon size={14} /> Edit and approve</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => setRejecting("")}><XIcon size={14} /> Reject</Button>
          </>
        )
      ) : null}
    >
      {isLoading ? <Skeleton className="h-96 rounded-[var(--radius-md)]" /> : error || !p ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
          {rejecting !== null ? (
            <div className="grid gap-1.5">
              <label htmlFor="reject-reason" className="text-[13px] font-medium">Why not? {p.agent_id ? "The agent remembers this next time." : ""}</label>
              <textarea id="reject-reason" value={rejecting} onChange={(e) => setRejecting(e.target.value)} rows={3} autoFocus
                className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
            </div>
          ) : null}
          <FormError message={approve.error ? errorMessage(approve.error) : reject.error ? errorMessage(reject.error) : null} />

          <section className="grid gap-2">
            <h3 className="text-[13.5px] font-semibold">Why</h3>
            <p className="text-[13.5px]">{p.reason || "No reason given."}</p>
            {p.source_task ? (
              <p className="text-[12.5px] text-muted">
                Learned from <Link to="/tasks" search={{ task: p.source_task.id }} className="text-accent hover:underline">{p.source_task.title}</Link>
                {p.source_task.tokens ? <>, which took {compact(p.source_task.tokens)} tokens</> : null}.
              </p>
            ) : null}
            {p.stale ? <p className="text-[12.5px] text-warn">The skill changed since this was drafted (now version {p.current?.version}). Review the diff against the current text.</p> : null}
            <Scan p={p} />
          </section>

          {editing ? (
            <section className="grid gap-3">
              <Field label="Description" value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              <div className="grid gap-1.5">
                <label htmlFor="edit-body" className="text-[13px] font-medium">Instructions</label>
                <textarea id="edit-body" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={20}
                  className="w-full rounded-sm border border-border bg-surface px-3 py-2 font-mono text-[12.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
              </div>
            </section>
          ) : p.kind === "retire" ? (
            <section className="grid gap-2">
              <h3 className="text-[13.5px] font-semibold">Skill to retire</h3>
              <p className="text-[13px] text-muted">{p.description}</p>
              <p className="text-[13px] text-muted">Retired skills disappear from agents' lists. You can restore one at any time.</p>
            </section>
          ) : (
            <section className="grid gap-2">
              <h3 className="text-[13.5px] font-semibold">{p.current ? `Changes to version ${p.current.version}` : "Proposed skill"}</h3>
              <p className="text-[13px]"><span className="text-muted">Description:</span> {p.description}</p>
              {p.current && p.current.description !== p.description ? (
                <p className="text-[12.5px] text-muted line-through">{p.current.description}</p>
              ) : null}
              {p.current ? (
                <DiffView before={p.kind === "merge" && p.other ? `${p.current.body}\n${p.other.body}` : p.current.body} after={p.body}
                  labels={[p.kind === "merge" && p.other ? `${p.name} + ${p.other.name}` : `Version ${p.current.version}`, "Proposed"]} />
              ) : (
                <div className="rounded-[var(--radius-md)] border border-border bg-surface px-5 py-4"><Markdown>{p.body}</Markdown></div>
              )}
            </section>
          )}

          {p.kind !== "retire" ? (
            <section className="grid gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-[13.5px] font-semibold"><FlaskIcon size={15} /> Tests</h3>
                <span className="flex flex-wrap gap-2">
                  {p.eval?.old ? <SuiteBadge suite={p.eval.old} label={`Version ${p.eval.old_version}`} /> : null}
                  <SuiteBadge suite={p.eval?.new} label="Proposed" />
                  {canWrite && pending ? <Button size="sm" variant="outline" loading={evaluate.isPending} onClick={() => evaluate.mutate()}>Run tests</Button> : null}
                </span>
              </div>
              {p.eval?.new ? <EvalResults suite={p.eval.new} before={p.eval.old} />
                : <p className="text-[13px] text-muted">{p.eval_cases.length || p.current ? "Not run yet." : "No test cases yet. Approving adds the ones proposed here; you can add more on the skill."}</p>}
              {p.eval_cases.length ? (
                <p className="text-[12.5px] text-muted">Brings {p.eval_cases.length} test {p.eval_cases.length === 1 ? "case" : "cases"}: {p.eval_cases.map((c) => c.title).join(", ")}.</p>
              ) : null}
            </section>
          ) : null}

          {p.status !== "pending" ? (
            <p className="text-[12.5px] text-muted">
              {p.status === "approved" ? "Approved" : p.status === "rejected" ? "Rejected" : "Replaced by a newer draft"}
              {p.decided_by_name ? ` by ${p.decided_by_name}` : ""}{p.decided_at ? `, ${timeAgo(p.decided_at).toLowerCase()}` : ""}
              {p.decision_note ? `: ${p.decision_note}` : "."}
            </p>
          ) : null}
        </div>
      )}
    </SideSheet>
  );
}

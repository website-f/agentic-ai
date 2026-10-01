import { CheckIcon, ClockIcon, QuestionIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { timeAgo } from "@/lib/utils";
import { workKeys, type Approval } from "@/lib/work";

import { AgentAvatar } from "./agent-avatar";
import { Button } from "./ui/button";
import { Pill } from "./ui/pill";

function ArgsPreview({ a }: { a: Approval }) {
  const url = typeof a.args.url === "string" ? a.args.url : null;
  if (url) {
    return (
      <p className="truncate rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-[12.5px]" title={url}>
        {url}
      </p>
    );
  }
  const entries = Object.entries(a.args).filter(([k]) => k !== "why" && k !== "reason");
  if (!entries.length) return null;
  return (
    <pre className="max-h-32 overflow-auto rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] whitespace-pre-wrap">
      {entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}
    </pre>
  );
}

export function ApprovalCard({ approval: a, canDecide, showTask = true }: { approval: Approval; canDecide: boolean; showTask?: boolean }) {
  const qc = useQueryClient();
  const [answer, setAnswer] = useState("");
  const [denying, setDenying] = useState(false);
  const decide = useMutation({
    mutationFn: (body: { decision: "approve" | "deny" | "answer"; scope?: "once" | "always"; answer?: string }) =>
      api<Approval>(`/api/approvals/${a.id}`, "POST", body),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: workKeys.tasks });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: keys.status });
      const verb = { approved: "Approved", denied: "Denied", answered: "Answer sent" }[r.status as "approved" | "denied" | "answered"] ?? "Done";
      toast.success(`${verb}. ${a.agent_name} carries on.`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const question = a.kind === "question";
  const pending = a.status === "pending";
  const expiresIn = timeAgo(a.expires_at);

  return (
    <article className="grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4">
      <header className="flex items-start gap-3">
        <AgentAvatar name={a.agent_name} color={a.agent_color} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px]">
            <span className="font-semibold">{a.agent_name}</span>{" "}
            <span className="text-muted">{question ? "has a question" : `wants to use ${a.tool_label}`}</span>
          </p>
          {showTask ? (
            <Link to="/tasks" search={{ task: a.task_id }} className="block truncate text-[12.5px] text-accent hover:underline">{a.task_title}</Link>
          ) : null}
        </div>
        {question ? (
          <Pill tone="info"><QuestionIcon size={12} weight="bold" /> Question</Pill>
        ) : a.risk !== "low" ? (
          <Pill tone={a.risk === "high" ? "danger" : "warn"}><ShieldWarningIcon size={12} weight="bold" /> {a.risk === "high" ? "High" : "Medium"} risk</Pill>
        ) : null}
      </header>

      {question ? (
        <p className="rounded-sm bg-surface-2 px-3 py-2 text-[14px]">{a.reason}</p>
      ) : (
        <div className="grid gap-2">
          <ArgsPreview a={a} />
          {a.reason ? <p className="text-[13px] text-muted"><span className="text-fg">Why:</span> {a.reason}</p> : null}
        </div>
      )}

      {pending && canDecide ? (
        question ? (
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) decide.mutate({ decision: "answer", answer }); }}>
            <label htmlFor={`ans-${a.id}`} className="sr-only">Your answer</label>
            <textarea id={`ans-${a.id}`} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder="Type your answer"
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!answer.trim()} loading={decide.isPending}><CheckIcon size={14} weight="bold" /> Send answer</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => decide.mutate({ decision: "deny", answer: "I can't answer that. Continue without it." })}>Skip question</Button>
            </div>
          </form>
        ) : denying ? (
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); decide.mutate({ decision: "deny", answer }); }}>
            <label htmlFor={`deny-${a.id}`} className="text-[12.5px] text-muted">Reason (optional, the agent reads it)</label>
            <input id={`deny-${a.id}`} autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} className="h-9 rounded-sm border border-border bg-surface px-3 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="danger" loading={decide.isPending}><XIcon size={14} weight="bold" /> Deny</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDenying(false)}>Back</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ decision: "approve", scope: "once" })}><CheckIcon size={14} weight="bold" /> Approve once</Button>
            <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "approve", scope: "always" })}>Always allow for {a.agent_name}</Button>
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => setDenying(true)}>Deny</Button>
          </div>
        )
      ) : null}

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
        {pending ? (
          <span className="inline-flex items-center gap-1"><ClockIcon size={13} /> Asked {timeAgo(a.created_at).toLowerCase()}, expires {expiresIn.toLowerCase()}</span>
        ) : (
          <span>
            <span className="font-medium text-fg capitalize">{a.status}</span>
            {a.scope === "always" ? " (always)" : ""}{a.decided_by_name ? ` by ${a.decided_by_name}` : ""}{a.decided_at ? ` ${timeAgo(a.decided_at).toLowerCase()}` : ""}
            {a.answer ? `: "${a.answer}"` : ""}
          </span>
        )}
        {!pending || !canDecide ? null : <span className="font-mono">{a.rule}</span>}
      </footer>
    </article>
  );
}

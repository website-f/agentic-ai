import { CheckIcon, ClockIcon, CoinsIcon, QuestionIcon, ShieldWarningIcon, XIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { api, errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { tokensShort } from "@/lib/teams";
import { cn, timeAgo } from "@/lib/utils";
import { workKeys, type Approval } from "@/lib/work";

import { AgentAvatar } from "./agent-avatar";
import { Button } from "./ui/button";
import { Pill } from "./ui/pill";

function FormPreview({ fields, page }: { fields: { label: string; value: string }[]; page?: string }) {
  return (
    <div className="overflow-hidden rounded-sm border border-border">
      <p className="truncate border-b border-border bg-surface-2 px-2.5 py-1.5 text-[12px] text-muted">
        It will send this form{page ? <> on <span className="font-mono">{page}</span></> : null}:
      </p>
      <dl className="grid max-h-56 grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-y-auto px-2.5 py-2 text-[12.5px]">
        {fields.map((f, i) => (
          <div key={i} className="contents">
            <dt className="truncate text-muted" title={f.label}>{f.label}</dt>
            <dd className={f.value ? "min-w-0 [overflow-wrap:anywhere]" : "text-muted italic"}>{f.value || "empty"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ArgsPreview({ a }: { a: Approval }) {
  const form = Array.isArray(a.args.form) ? (a.args.form as { label: string; value: string }[]) : null;
  if (form?.length) return <FormPreview fields={form} page={typeof a.args.page === "string" ? a.args.page : undefined} />;
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
    <pre className="max-h-32 overflow-x-hidden overflow-y-auto rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-[12px] whitespace-pre-wrap [overflow-wrap:anywhere]">
      {entries.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join("\n")}
    </pre>
  );
}

/** What a budget ask shows: how much was used against the limit, as a bar. */
export function BudgetUsage({ args }: { args: Record<string, unknown> }) {
  const n = (k: string) => (typeof args[k] === "number" ? (args[k] as number) : null);
  const daily = (n("token_ratio") ?? 0) >= (n("usd_ratio") ?? 0) && n("token_limit") !== null;
  const ratio = daily ? n("token_ratio") ?? 0 : n("usd_ratio") ?? 0;
  const used = daily ? `${tokensShort(n("tokens_today"))} of ${tokensShort(n("token_limit"))} tokens today` : `$${(n("usd_month") ?? 0).toFixed(2)} of $${(n("usd_limit") ?? 0).toFixed(2)} this month`;
  return (
    <div className="grid gap-1.5">
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label="Budget used">
        <div className="h-full rounded-full bg-danger" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <p className="text-[12.5px] text-muted tabular">{used} ({Math.round(ratio * 100)}%)</p>
    </div>
  );
}

const DECIDED_TONE: Partial<Record<Approval["status"], "ok" | "danger" | "info" | "neutral">> = {
  approved: "ok",
  denied: "danger",
  answered: "info",
  expired: "neutral",
  cancelled: "neutral",
};

export function ApprovalCard({
  approval: a,
  canDecide,
  showTask = true,
  guide,
  guideActions,
}: {
  approval: Approval;
  canDecide: boolean;
  showTask?: boolean;
  /** data-guide ids for the Guide's screenshots: the card, and its decision buttons. */
  guide?: string;
  guideActions?: string;
}) {
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
  const budget = a.kind === "budget";
  const options = Array.isArray(a.args.options) ? (a.args.options as unknown[]).map(String).filter(Boolean).slice(0, 6) : [];
  const pending = a.status === "pending";
  const expiresIn = timeAgo(a.expires_at);

  return (
    <article data-guide={guide} className={cn("flex h-full min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border bg-surface p-4 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)]", pending && a.risk === "high" && !question && !budget ? "border-danger/35" : pending ? "border-warn/35" : "border-border")}>
      <header className="flex items-start gap-3">
        <AgentAvatar name={a.agent_name} color={a.agent_color} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug break-words">
            <span className="font-semibold">{a.agent_name}</span>{" "}
            <span className="text-muted">{question ? "has a question" : budget ? "is over budget and paused" : `wants to use ${a.tool_label}`}</span>
          </p>
          {showTask ? (
            <Link to="/tasks" search={{ task: a.task_id }} className="mt-0.5 block truncate text-[12.5px] text-accent hover:underline" title={a.task_title}>{a.task_title}</Link>
          ) : null}
        </div>
        {question ? (
          <Pill tone="info" className="shrink-0"><QuestionIcon size={12} weight="bold" /> Question</Pill>
        ) : budget ? (
          <Pill tone="warn" className="shrink-0"><CoinsIcon size={12} weight="bold" /> Budget</Pill>
        ) : a.risk !== "low" ? (
          <Pill tone={a.risk === "high" ? "danger" : "warn"} className="shrink-0"><ShieldWarningIcon size={12} weight="bold" /> {a.risk === "high" ? "High" : "Medium"} risk</Pill>
        ) : null}
      </header>

      {question ? (
        <p className="rounded-r-sm rounded-l-[3px] border-l-2 border-info/60 bg-surface-2 px-3 py-2.5 text-[14px] leading-relaxed break-words">{a.reason}</p>
      ) : budget ? (
        <div className="grid gap-2">
          <BudgetUsage args={a.args} />
          <p className="text-[13px] text-muted">{a.reason}</p>
        </div>
      ) : (
        <div className="grid gap-2">
          <ArgsPreview a={a} />
          {a.reason ? <p className="text-[13px] break-words text-muted"><span className="font-medium text-fg">Why:</span> {a.reason}</p> : null}
        </div>
      )}

      {pending && canDecide ? (
        question ? (
          <form data-guide={guideActions} className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) decide.mutate({ decision: "answer", answer }); }}>
            {options.length ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Quick answers">
                {options.map((o) => (
                  <Button key={o} type="button" size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "answer", answer: o })}>
                    {o}
                  </Button>
                ))}
              </div>
            ) : null}
            <label htmlFor={`ans-${a.id}`} className="sr-only">Your answer</label>
            <textarea id={`ans-${a.id}`} value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2} placeholder={options.length ? "Or type your own answer" : "Type your answer"}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={!answer.trim()} loading={decide.isPending}><CheckIcon size={14} weight="bold" /> Send answer</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => decide.mutate({ decision: "deny", answer: "I can't answer that. Continue without it." })}>Skip question</Button>
            </div>
          </form>
        ) : denying ? (
          <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); decide.mutate({ decision: "deny", answer }); }}>
            <label htmlFor={`deny-${a.id}`} className="text-[12.5px] text-muted">Reason (optional, the agent reads it)</label>
            <input id={`deny-${a.id}`} autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} className="h-10 rounded-sm border border-border bg-surface px-3 text-[13.5px] focus-visible:border-accent focus-visible:outline-none" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="danger" loading={decide.isPending}><XIcon size={14} weight="bold" /> Deny</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setDenying(false)}>Back</Button>
            </div>
          </form>
        ) : budget ? (
          <div data-guide={guideActions} className="flex flex-wrap gap-2">
            <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ decision: "approve", scope: "once" })}><CheckIcon size={14} weight="bold" /> Allow more</Button>
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => setDenying(true)}>Stop the task</Button>
          </div>
        ) : (
          <div data-guide={guideActions} className="flex flex-wrap gap-2">
            <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ decision: "approve", scope: "once" })}><CheckIcon size={14} weight="bold" /> Approve once</Button>
            {/* High-risk tools ask every time: "always" is only offered for the rest. */}
            {a.risk !== "high" ? <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => decide.mutate({ decision: "approve", scope: "always" })}>Always allow for {a.agent_name}</Button> : null}
            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => setDenying(true)}>Deny</Button>
          </div>
        )
      ) : null}

      <footer className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/70 pt-3 text-[12px] text-muted">
        {pending ? (
          <span className="inline-flex items-center gap-1"><ClockIcon size={13} /> Asked {timeAgo(a.created_at).toLowerCase()}, expires {expiresIn.toLowerCase()}</span>
        ) : (
          <>
            <Pill tone={DECIDED_TONE[a.status] ?? "neutral"} className="capitalize">{a.status}{a.scope === "always" ? " (always)" : ""}</Pill>
            <span className="min-w-0 break-words">
              {a.decided_by_name ? `by ${a.decided_by_name}` : ""}{a.decided_at ? ` ${timeAgo(a.decided_at).toLowerCase()}` : ""}
              {a.answer ? <span className="mt-1 block text-fg">"{a.answer}"</span> : null}
            </span>
          </>
        )}
        {!pending || !canDecide ? null : <span className="min-w-0 truncate font-mono" title={a.rule}>{a.rule}</span>}
      </footer>
    </article>
  );
}

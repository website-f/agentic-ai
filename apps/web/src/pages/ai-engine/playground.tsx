import { CheckCircleIcon, MinusCircleIcon, PaperPlaneRightIcon, XCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ApiError, writeHeaders } from "@/lib/api";

import { groupsQuery, usd, type Attempt, type PlaygroundReply } from "./data";

class PlaygroundError extends ApiError {
  readonly attempts: Attempt[];
  constructor(status: number, code: string, message: string, attempts: Attempt[]) {
    super(status, code, message);
    this.attempts = attempts;
  }
}

async function runPlayground(body: { group: string; prompt: string; system?: string }): Promise<PlaygroundReply> {
  const res = await fetch("/api/ai/playground", { method: "POST", credentials: "same-origin", headers: writeHeaders(), body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new PlaygroundError(res.status, data?.code ?? "http_error", data?.message ?? "The request failed.", data?.attempts ?? []);
  return data as PlaygroundReply;
}

function Route({ attempts }: { attempts: Attempt[] }) {
  if (!attempts.length) return null;
  return (
    <section className="grid gap-1.5">
      <h3 className="text-[12.5px] font-medium text-muted">Route taken</h3>
      <ol className="grid gap-1">
        {attempts.map((a, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px]">
            {a.ok ? (
              <CheckCircleIcon size={16} weight="fill" className="mt-px shrink-0 text-ok" />
            ) : a.failed ? (
              <XCircleIcon size={16} weight="fill" className="mt-px shrink-0 text-danger" />
            ) : (
              <MinusCircleIcon size={16} className="mt-px shrink-0 text-muted" />
            )}
            <span className="min-w-0">
              <span className="font-mono">{a.member}</span>
              <span className="text-muted"> {a.ok ? `answered in ${a.latency_ms} ms` : a.skipped ? `skipped: ${a.skipped}` : a.failed}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PlaygroundTab({ canRun }: { canRun: boolean }) {
  const qc = useQueryClient();
  const { data: groups = [] } = useQuery(groupsQuery);
  const [group, setGroup] = useState("smart");
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState("In one sentence, what is a good first job for an AI research assistant?");
  const run = useMutation({
    mutationFn: () => runPlayground({ group, prompt, system: system.trim() || undefined }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai", "usage"] }),
  });
  const err = run.error instanceof PlaygroundError ? run.error : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form
        className="grid content-start gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <p className="text-[13.5px] text-muted">Send a prompt through a model group exactly the way an agent would, fallbacks included.</p>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">Model group</span>
          <Select
            value={group}
            onValueChange={setGroup}
            label="Model group"
            options={groups.map((g) => ({ value: g.name, label: g.label, hint: g.members.length ? `${g.members.length} models` : "No models yet" }))}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="pg-system" className="text-[13px] font-medium">Instructions <span className="font-normal text-muted">(optional)</span></label>
          <textarea id="pg-system" value={system} onChange={(e) => setSystem(e.target.value)} rows={2} placeholder="You are a concise assistant for a Malaysian SME." className="rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="pg-prompt" className="text-[13px] font-medium">Prompt</label>
          <textarea
            id="pg-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && prompt.trim()) run.mutate();
            }}
            rows={6}
            className="rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
          />
        </div>
        <Button type="submit" loading={run.isPending} disabled={!canRun || !prompt.trim()} className="w-fit">
          {!run.isPending ? <PaperPlaneRightIcon size={15} weight="fill" /> : null} Run
        </Button>
        {!canRun ? <p className="text-[12.5px] text-muted">Your role can view results but not run prompts.</p> : null}
      </form>

      <section className="grid content-start gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5" aria-live="polite">
        {run.data ? (
          <>
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{run.data.content}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 font-mono text-[12px] text-muted tabular">
              <span className="font-sans font-medium text-fg">{run.data.provider_name}</span>
              <span>{run.data.model}</span>
              <span>{(run.data.latency_ms / 1000).toFixed(2)} s</span>
              <span>{run.data.prompt_tokens} in / {run.data.completion_tokens} out</span>
              {run.data.cached_tokens ? <span>{run.data.cached_tokens} cached</span> : null}
              <span>{usd(run.data.cost_usd)}</span>
            </p>
            <Route attempts={run.data.attempts} />
          </>
        ) : run.error ? (
          <>
            <p role="alert" className="text-[13.5px] text-danger">{run.error.message}</p>
            {err ? <Route attempts={err.attempts} /> : null}
          </>
        ) : (
          <p className="text-[13.5px] text-muted">The reply, the model that answered and every fallback step show up here.</p>
        )}
      </section>
    </div>
  );
}

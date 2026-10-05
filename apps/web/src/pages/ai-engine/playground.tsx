import { ChatTextIcon, CheckCircleIcon, FlaskIcon, MinusCircleIcon, PaperPlaneRightIcon, XCircleIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { t as tr, useT } from "@/i18n";
import { ApiError, writeHeaders } from "@/lib/api";

import { chatGroupsQuery, usd, type Attempt, type PlaygroundReply } from "./data";

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
  if (!res.ok) throw new PlaygroundError(res.status, data?.code ?? "http_error", data?.message ?? tr("The request failed."), data?.attempts ?? []);
  return data as PlaygroundReply;
}

function Route({ attempts }: { attempts: Attempt[] }) {
  const t = useT();
  if (!attempts.length) return null;
  return (
    <section className="grid gap-1.5">
      <h3 className="text-[12.5px] font-medium text-muted">{t("Route taken")}</h3>
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
            <span className="min-w-0 break-words">
              <span className="font-mono break-all">{a.member}</span>
              <span className="text-muted"> {a.ok ? t("answered in {ms} ms", { ms: a.latency_ms ?? 0 }) : a.skipped ? t("skipped: {reason}", { reason: a.skipped }) : a.failed}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function PlaygroundTab({ canRun }: { canRun: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: groups = [] } = useQuery(chatGroupsQuery);
  const [group, setGroup] = useState("smart");
  const [system, setSystem] = useState("");
  const [prompt, setPrompt] = useState(() => t("In one sentence, what is a good first job for an AI research assistant?"));
  const run = useMutation({
    mutationFn: () => runPlayground({ group, prompt, system: system.trim() || undefined }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai", "usage"] }),
  });
  const err = run.error instanceof PlaygroundError ? run.error : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-5">
      <form
        className="grid min-w-0 content-start gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <div className="flex items-start gap-3">
          <IconTile icon={FlaskIcon} size="sm" />
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-semibold">{t("Try a prompt")}</h2>
            <p className="text-[12.5px] text-muted">{t("Send a prompt through a model group exactly the way an agent would, fallbacks included.")}</p>
          </div>
        </div>
        <div className="grid gap-1.5">
          <span className="text-[13px] font-medium">{t("Model group")}</span>
          <Select
            value={group}
            onValueChange={setGroup}
            label={t("Model group")}
            options={groups.map((g) => ({ value: g.name, label: g.label, hint: g.members.length ? t("{n} models", { n: g.members.length }) : t("No models yet") }))}
          />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="pg-system" className="text-[13px] font-medium">{t("Instructions")} <span className="font-normal text-muted">{t("(optional)")}</span></label>
          <textarea id="pg-system" value={system} onChange={(e) => setSystem(e.target.value)} rows={2} placeholder={t("You are a concise assistant for a Malaysian SME.")} className="w-full min-w-0 rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="pg-prompt" className="text-[13px] font-medium">{t("Prompt")}</label>
          <textarea
            id="pg-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && prompt.trim()) run.mutate();
            }}
            rows={6}
            className="w-full min-w-0 rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={run.isPending} disabled={!canRun || !prompt.trim()} className="max-sm:w-full">
            {!run.isPending ? <PaperPlaneRightIcon size={15} weight="fill" /> : null} {t("Run")}
          </Button>
          <span className="text-[12px] text-muted max-sm:hidden">{t("Ctrl + Enter in the prompt also runs it.")}</span>
        </div>
        {!canRun ? <p className="text-[12.5px] text-muted">{t("Your role can view results but not run prompts.")}</p> : null}
      </form>

      <section className="grid min-w-0 content-start gap-4 rounded-[var(--radius-md)] border border-border bg-surface p-4 shadow-[0_1px_2px_hsl(var(--shadow)/0.04)] sm:p-5" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[14.5px] font-semibold">{t("Reply")}</h2>
          {run.data ? <Pill tone="ok">{t("Answered")}</Pill> : run.error ? <Pill tone="danger">{t("Failed")}</Pill> : run.isPending ? <Pill tone="info">{t("Running")}</Pill> : null}
        </div>
        {run.isPending ? (
          <div className="grid gap-2" aria-hidden>
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : run.data ? (
          <>
            <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">{run.data.content}</p>
            <p className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 font-mono text-[12px] text-muted tabular">
              <span className="font-sans font-medium text-fg">{run.data.provider_name}</span>
              <span className="break-all">{run.data.model}</span>
              <span>{(run.data.latency_ms / 1000).toFixed(2)} s</span>
              <span>{t("{in} in / {out} out", { in: run.data.prompt_tokens, out: run.data.completion_tokens })}</span>
              {run.data.cached_tokens ? <span>{t("{n} cached", { n: run.data.cached_tokens })}</span> : null}
              <span>{usd(run.data.cost_usd)}</span>
            </p>
            <Route attempts={run.data.attempts} />
          </>
        ) : run.error ? (
          <>
            <p role="alert" className="rounded-sm bg-danger/8 px-3 py-2 text-[13.5px] break-words text-danger">{run.error.message}</p>
            {err ? <Route attempts={err.attempts} /> : null}
          </>
        ) : (
          <div className="grid place-items-center gap-2 rounded-sm border border-dashed border-border px-4 py-10 text-center">
            <ChatTextIcon size={22} weight="duotone" className="text-muted" />
            <p className="max-w-xs text-[13px] text-muted">{t("The reply, the model that answered and every fallback step show up here.")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

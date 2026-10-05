import { CheckCircleIcon, MinusCircleIcon, PlayIcon, XCircleIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { errorMessage, streamNdjson } from "@/lib/api";
import { cn } from "@/lib/utils";

import { usd, type DoneEvent, type StepEvent, type TestEvent } from "./data";

export interface TestRequest {
  provider_id?: string;
  preset?: string | null;
  name?: string;
  base_url?: string;
  api_key?: string;
  tier?: string;
  model?: string | null;
  capabilities: boolean;
}

const RATE_LABELS: Record<string, string> = {
  "x-ratelimit-remaining-requests": msg("Requests left"),
  "x-ratelimit-remaining-tokens": msg("Tokens left"),
  "x-ratelimit-limit-requests": msg("Request limit"),
  "x-ratelimit-limit-tokens": msg("Token limit"),
  "x-ratelimit-reset-requests": msg("Requests reset"),
  "x-ratelimit-reset-tokens": msg("Tokens reset"),
  "retry-after": msg("Retry after (s)"),
};

function StepIcon({ status }: { status: StepEvent["status"] }) {
  if (status === "running")
    return <span aria-hidden className="mt-0.5 size-[18px] shrink-0 animate-spin rounded-full border-2 border-accent border-r-transparent" />;
  if (status === "ok") return <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-ok" />;
  if (status === "failed") return <XCircleIcon size={20} weight="fill" className="shrink-0 text-danger" />;
  return <MinusCircleIcon size={20} className="shrink-0 text-muted" />;
}

/** Runs the streamed 3-step test and shows each step as it lands. */
export function useConnectionTest() {
  const [steps, setSteps] = useState<StepEvent[]>([]);
  const [done, setDone] = useState<DoneEvent | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (req: TestRequest) => {
    setSteps([]);
    setDone(null);
    setError(null);
    setRunning(true);
    try {
      await streamNdjson<TestEvent>("/api/ai/providers/test", req, (e) => {
        if (e.type === "done") {
          setDone(e);
          return;
        }
        setSteps((prev) => {
          const i = prev.findIndex((s) => s.step === e.step);
          if (i === -1) return [...prev, e];
          const next = prev.slice();
          next[i] = e;
          return next;
        });
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };
  const reset = () => {
    setSteps([]);
    setDone(null);
    setError(null);
  };
  return { steps, done, running, error, run, reset };
}

export function TestSteps({ steps, done, error }: { steps: StepEvent[]; done: DoneEvent | null; error: string | null }) {
  const t = useT();
  const reduce = useReducedMotion();
  if (error) {
    return (
      <div role="alert" className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger">
        {error}
      </div>
    );
  }
  if (!steps.length) return null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-live="polite">
      <ol className="divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
        <AnimatePresence initial={false}>
          {steps.map((s) => (
            <motion.li
              key={s.step}
              initial={reduce ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              className="flex gap-3 px-3.5 py-3"
            >
              <StepIcon status={s.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 text-[13.5px] font-medium break-words">
                    {s.label}
                    {s.model ? <span className="ml-2 font-mono text-[12px] font-normal break-all text-muted">{s.model}</span> : null}
                  </p>
                  {s.latency_ms !== undefined ? (
                    <span className="shrink-0 font-mono text-[12px] text-muted tabular">{s.latency_ms} ms</span>
                  ) : null}
                </div>
                {s.detail ? (
                  <p className={cn("mt-0.5 text-[12.5px] break-words", s.status === "failed" ? "text-danger" : "text-muted")}>{s.detail}</p>
                ) : null}
                {s.usage ? (
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11.5px] text-muted tabular">
                    <span>{t("{n} in", { n: s.usage.prompt })}</span>
                    <span>{t("{n} out", { n: s.usage.completion })}</span>
                    {s.usage.cached ? <span>{t("{n} cached", { n: s.usage.cached })}</span> : null}
                    {s.usage.reasoning ? <span>{t("{n} thinking", { n: s.usage.reasoning })}</span> : null}
                    <span>{usd(s.cost_usd)}</span>
                  </p>
                ) : null}
                {s.rate && Object.keys(s.rate).length ? (
                  <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px]">
                    {Object.entries(s.rate).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <dt className="text-muted">{RATE_LABELS[k] ? t(RATE_LABELS[k]) : k}</dt>
                        <dd className="font-mono tabular">{v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
      {done ? (
        <p className={cn("flex items-start gap-1.5 rounded-sm px-3 py-2 text-[13px] font-medium", done.ok ? "bg-ok/10 text-ok" : "bg-danger/8 text-danger")}>
          {done.ok ? <CheckCircleIcon size={16} weight="fill" className="mt-px shrink-0" /> : <XCircleIcon size={16} weight="fill" className="mt-px shrink-0" />}
          {done.ok ? t("Connection works.") : t("The connection is not working yet. Fix the step marked in red and test again.")}
        </p>
      ) : null}
    </div>
  );
}

/** Model to test with plus the capabilities switch and run button. */
export function TestControls({
  models,
  model,
  onModel,
  capabilities,
  onCapabilities,
  onRun,
  running,
  disabled,
}: {
  models: string[];
  model: string;
  onModel: (m: string) => void;
  capabilities: boolean;
  onCapabilities: (v: boolean) => void;
  onRun: () => void;
  running: boolean;
  disabled?: boolean;
}) {
  const t = useT();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="grid gap-1.5">
        <label htmlFor="test-model" className="text-[13px] font-medium">
          {t("Model to test with")}
        </label>
        <input
          id="test-model"
          list="test-model-options"
          value={model}
          onChange={(e) => onModel(e.target.value)}
          placeholder={models.length ? t("Pick from the list or type an ID") : t("Picked automatically")}
          className="h-10 w-full rounded-sm border border-border bg-surface px-3 font-mono text-[13px] placeholder:font-sans placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none"
        />
        <datalist id="test-model-options">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      <SwitchField
        checked={capabilities}
        onCheckedChange={onCapabilities}
        label={t("Also check tool calling, JSON mode and embeddings")}
        hint={t("Three extra small requests. Results are saved on the model.")}
      />
      <Button variant="outline" onClick={onRun} loading={running} disabled={disabled}>
        {!running ? <PlayIcon size={15} weight="fill" /> : null} {t("Test connection")}
      </Button>
    </div>
  );
}

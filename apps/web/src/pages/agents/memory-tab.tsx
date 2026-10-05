import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { locale, msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { agentFactsQuery, brainKeys, coreMemoryQuery, factScope, type CoreMemory } from "@/lib/brain";
import { cn, timeAgo } from "@/lib/utils";
import type { Agent } from "@/lib/work";

const TARGETS = [
  { key: "user", title: msg("Who it works for"), hint: msg("People, roles and preferences. Example: Fitri wants the summary line first.") },
  { key: "memory", title: msg("Notes and lessons"), hint: msg("How this office works and what it learned. Example: Close the books on the 28th.") },
] as const;

const lines = (text: string) => text.split("\n").map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
const used = (items: string[]) => items.reduce((n, e) => n + e.length + 1, 0);

function Editor({ agent, mem, canWrite }: { agent: Agent; mem: CoreMemory; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState({ user: mem.user.join("\n"), memory: mem.memory.join("\n") });
  const dirty = text.user !== mem.user.join("\n") || text.memory !== mem.memory.join("\n");
  const save = useMutation({
    mutationFn: () => api<CoreMemory>(`/api/agents/${agent.id}/memory`, "PUT", { user: lines(text.user), memory: lines(text.memory) }),
    onSuccess: (m) => {
      qc.setQueryData(brainKeys.core(agent.id), m);
      setText({ user: m.user.join("\n"), memory: m.memory.join("\n") });
      toast.success(tr("Saved. {name} uses it from the next task or conversation.", { name: agent.name }));
    },
  });

  return (
    <section className="grid min-w-0 content-start gap-4">
      <div>
        <h2 className="text-[14px] font-semibold">{t("Core memory")}</h2>
        <p className="text-[13px] text-muted">{t("Always in {name}'s prompt, so it stays short. {name} edits it too, with the memory tool. One entry per line.", { name: agent.name })}</p>
      </div>
      {TARGETS.map((tg) => {
        const n = used(lines(text[tg.key]));
        const cap = mem.caps[tg.key];
        const over = n > cap;
        return (
          <div key={tg.key} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`mem-${tg.key}`} className="text-[13px] font-medium">{t(tg.title)}</label>
              <span className={cn("text-[12px] tabular", over ? "text-danger" : "text-muted")}>{n.toLocaleString(locale())} / {cap.toLocaleString(locale())}</span>
            </div>
            <div aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div className={cn("h-full rounded-full", over ? "bg-danger" : n / cap > 0.85 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, (n / cap) * 100)}%` }} />
            </div>
            <textarea id={`mem-${tg.key}`} value={text[tg.key]} disabled={!canWrite} rows={tg.key === "memory" ? 8 : 5}
              onChange={(e) => setText({ ...text, [tg.key]: e.target.value })} placeholder={t(tg.hint)}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-70" />
          </div>
        );
      })}
      {canWrite ? (
        <div className="flex items-center gap-3">
          <Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>{t("Save memory")}</Button>
          {dirty ? <span className="text-[12.5px] text-muted">{t("Unsaved changes")}</span> : null}
        </div>
      ) : null}
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </section>
  );
}

export function MemoryTab({ agent, canWrite }: { agent: Agent; canWrite: boolean }) {
  const t = useT();
  const { data: mem, isLoading, error } = useQuery(coreMemoryQuery(agent.id));
  const { data: facts = [] } = useQuery(agentFactsQuery(agent.id));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {isLoading ? <Skeleton className="h-72 rounded-[var(--radius-md)]" /> : error || !mem ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : (
        <Editor key={mem.memory.join("|") + mem.user.join("|")} agent={agent} mem={mem} canWrite={canWrite} />
      )}
      <section className="grid min-w-0 content-start gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <h2 className="text-[14px] font-semibold">{t("Facts {name} can recall", { name: agent.name })} <span className="font-normal text-muted">{facts.length}</span></h2>
            <p className="text-[13px] text-muted">{t("Its own private facts plus what its company shares. Only relevant ones reach the prompt.")}</p>
          </div>
          <Button asChild size="sm" variant="outline"><Link to="/brain" search={{ tab: "facts" }}>{t("All facts")}</Link></Button>
        </div>
        {facts.length ? (
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
            {facts.slice(0, 40).map((f) => (
              <li key={f.id} className="grid gap-1 px-4 py-2.5">
                <p className="text-[13px] break-words">{f.text}</p>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Pill tone={f.agent_id ? "info" : "neutral"}>{factScope(f)}</Pill>
                  <span>{timeAgo(f.valid_from)}</span>
                  {f.hits ? <span>· {t("recalled {n}×", { n: f.hits })}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-[13px] text-muted">
            {t("Nothing yet. {name} picks up facts as it finishes tasks and chats.", { name: agent.name })}
          </p>
        )}
      </section>
    </div>
  );
}

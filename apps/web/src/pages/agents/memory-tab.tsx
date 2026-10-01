import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { agentFactsQuery, brainKeys, coreMemoryQuery, factScope, type CoreMemory } from "@/lib/brain";
import { cn, timeAgo } from "@/lib/utils";
import type { Agent } from "@/lib/work";

const TARGETS = [
  { key: "user", title: "Who it works for", hint: "People, roles and preferences. Example: Fitri wants the summary line first." },
  { key: "memory", title: "Notes and lessons", hint: "How this office works and what it learned. Example: Close the books on the 28th." },
] as const;

const lines = (text: string) => text.split("\n").map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
const used = (items: string[]) => items.reduce((n, e) => n + e.length + 1, 0);

function Editor({ agent, mem, canWrite }: { agent: Agent; mem: CoreMemory; canWrite: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = useState({ user: mem.user.join("\n"), memory: mem.memory.join("\n") });
  const dirty = text.user !== mem.user.join("\n") || text.memory !== mem.memory.join("\n");
  const save = useMutation({
    mutationFn: () => api<CoreMemory>(`/api/agents/${agent.id}/memory`, "PUT", { user: lines(text.user), memory: lines(text.memory) }),
    onSuccess: (m) => {
      qc.setQueryData(brainKeys.core(agent.id), m);
      setText({ user: m.user.join("\n"), memory: m.memory.join("\n") });
      toast.success(`Saved. ${agent.name} uses it from the next task or conversation.`);
    },
  });

  return (
    <section className="grid content-start gap-4">
      <div>
        <h2 className="text-[14px] font-semibold">Core memory</h2>
        <p className="text-[13px] text-muted">Always in {agent.name}'s prompt, so it stays short. {agent.name} edits it too, with the memory tool. One entry per line.</p>
      </div>
      {TARGETS.map((t) => {
        const n = used(lines(text[t.key]));
        const cap = mem.caps[t.key];
        const over = n > cap;
        return (
          <div key={t.key} className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={`mem-${t.key}`} className="text-[13px] font-medium">{t.title}</label>
              <span className={cn("text-[12px] tabular", over ? "text-danger" : "text-muted")}>{n.toLocaleString()} / {cap.toLocaleString()}</span>
            </div>
            <div aria-hidden className="h-1 overflow-hidden rounded-full bg-surface-2">
              <div className={cn("h-full rounded-full", over ? "bg-danger" : n / cap > 0.85 ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, (n / cap) * 100)}%` }} />
            </div>
            <textarea id={`mem-${t.key}`} value={text[t.key]} disabled={!canWrite} rows={t.key === "memory" ? 8 : 5}
              onChange={(e) => setText({ ...text, [t.key]: e.target.value })} placeholder={t.hint}
              className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-70" />
          </div>
        );
      })}
      {canWrite ? (
        <div className="flex items-center gap-3">
          <Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>Save memory</Button>
          {dirty ? <span className="text-[12.5px] text-muted">Unsaved changes</span> : null}
        </div>
      ) : null}
      <FormError message={save.error ? errorMessage(save.error) : null} />
    </section>
  );
}

export function MemoryTab({ agent, canWrite }: { agent: Agent; canWrite: boolean }) {
  const { data: mem, isLoading, error } = useQuery(coreMemoryQuery(agent.id));
  const { data: facts = [] } = useQuery(agentFactsQuery(agent.id));
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {isLoading ? <Skeleton className="h-72 rounded-[var(--radius-md)]" /> : error || !mem ? (
        <p role="alert" className="text-danger">{errorMessage(error)}</p>
      ) : (
        <Editor key={mem.memory.join("|") + mem.user.join("|")} agent={agent} mem={mem} canWrite={canWrite} />
      )}
      <section className="grid content-start gap-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold">Facts {agent.name} can recall <span className="font-normal text-muted">{facts.length}</span></h2>
            <p className="text-[13px] text-muted">Its own private facts plus what its company shares. Only relevant ones reach the prompt.</p>
          </div>
          <Button asChild size="sm" variant="outline"><Link to="/brain" search={{ tab: "facts" }}>All facts</Link></Button>
        </div>
        {facts.length ? (
          <ul className="divide-y divide-border rounded-[var(--radius-md)] border border-border bg-surface">
            {facts.slice(0, 40).map((f) => (
              <li key={f.id} className="grid gap-1 px-4 py-2.5">
                <p className="text-[13px]">{f.text}</p>
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted">
                  <Pill tone={f.agent_id ? "info" : "neutral"}>{factScope(f)}</Pill>
                  <span>{timeAgo(f.valid_from)}</span>
                  {f.hits ? <span>· recalled {f.hits}×</span> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-[13px] text-muted">
            Nothing yet. {agent.name} picks up facts as it finishes tasks and chats.
          </p>
        )}
      </section>
    </div>
  );
}

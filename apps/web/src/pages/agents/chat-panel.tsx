import { ClipboardTextIcon, PaperPlaneRightIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Select } from "@/components/ui/select";
import { VoiceInput } from "@/components/voice-input";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { usePagedList } from "@/lib/paged";
import { cn } from "@/lib/utils";
import { workKeys, type Agent } from "@/lib/work";

const OLDER = "__older";

interface Msg {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  meta?: { provider?: string; model?: string; tools?: string[] } | null;
}

export function ChatPanel({ agent, canWrite, className }: { agent: Agent; canWrite: boolean; className?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [local, setLocal] = useState<Msg[]>([]);
  const [deleting, setDeleting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // Most recent 30 conversations; older ones load on demand from the picker's last option.
  const sessions = usePagedList<{ id: string; title: string; updated_at: string }>(
    workKeys.sessions(agent.id), `/api/agents/${agent.id}/sessions`, {}, { pageSize: 30 });
  const history = useQuery({
    queryKey: workKeys.messages(sessionId ?? "none"),
    queryFn: () => api<Msg[]>(`/api/chat/sessions/${sessionId}/messages`),
    enabled: !!sessionId,
  });
  const messages = [...(sessionId ? history.data ?? [] : []), ...local];

  const send = useMutation({
    mutationFn: (text: string) =>
      api<{ session_id: string; reply: string; provider: string; model: string; tools_used: string[] }>(
        `/api/agents/${agent.id}/chat`, "POST", { message: text, session_id: sessionId }),
    onMutate: (text) => setLocal((l) => [...l, { id: `u${Date.now()}`, role: "user", content: text }]),
    onSuccess: async (r) => {
      setSessionId(r.session_id);
      await qc.invalidateQueries({ queryKey: workKeys.messages(r.session_id) });
      qc.invalidateQueries({ queryKey: workKeys.sessions(agent.id) });
      setLocal([]);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      setLocal((l) => l.slice(0, -1));
    },
  });

  useEffect(() => {
    // Scroll the message list itself, never the page around it.
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages.length, send.isPending, reduce]);

  const remove = async () => {
    if (!sessionId) return;
    try {
      await api(`/api/chat/sessions/${sessionId}`, "DELETE");
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    qc.removeQueries({ queryKey: workKeys.messages(sessionId) });
    qc.invalidateQueries({ queryKey: workKeys.sessions(agent.id) });
    setLocal([]);
    setSessionId(null);
    toast.success(tr("Conversation deleted."));
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || send.isPending) return;
    setDraft("");
    send.mutate(text);
  };
  const makeTask = (content: string) =>
    navigate({ to: "/tasks", search: { new: 1, agent: agent.id, brief: content.slice(0, 4000) } });

  return (
    <div className={cn("flex min-h-0 flex-col rounded-[var(--radius-md)] border border-border bg-surface", className)}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Select
          size="sm"
          value={sessionId ?? "new"}
          onValueChange={(v) => {
            if (v === OLDER) return sessions.loadMore();
            setLocal([]);
            setSessionId(v === "new" ? null : v);
          }}
          label={t("Conversation")}
          className="min-w-0 flex-1 sm:max-w-sm"
          options={[
            { value: "new", label: t("New conversation") },
            ...sessions.items.map((s) => ({ value: s.id, label: s.title })),
            ...(sessions.hasMore ? [{ value: OLDER, label: sessions.isFetchingMore ? t("Loading older conversations…") : t("Load older conversations…") }] : []),
          ]}
        />
        {sessionId ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => { setLocal([]); setSessionId(null); }}>
              <PlusIcon size={14} /> {t("New")}
            </Button>
            <Button size="icon-sm" variant="ghost" className="size-9 shrink-0 text-muted hover:text-danger" disabled={send.isPending}
              onClick={() => setDeleting(true)} aria-label={t("Delete this conversation")} title={t("Delete this conversation")}>
              <TrashIcon size={16} />
            </Button>
          </>
        ) : null}
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t("Delete this conversation?")} danger confirmLabel={t("Delete")}
        body={t("Its messages are removed for good. What {name} already learned from it stays in its memory.", { name: agent.name })} onConfirm={remove} />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4" aria-live="polite">
        {!messages.length && !send.isPending ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center">
            <AgentAvatar name={agent.name} color={agent.color} size="lg" />
            <p className="text-[14px] font-medium">{t("Talk to {name}", { name: agent.name })}</p>
            <p className="max-w-xs text-[12.5px] text-muted">{t("Ask questions or think out loud together. Anything that needs approval is suggested as a task.")}</p>
          </div>
        ) : null}
        <ol className="grid grid-cols-[minmax(0,1fr)] gap-4">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.li key={m.id} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-2.5", m.role === "user" && "justify-end")}>
                {m.role === "assistant" ? <AgentAvatar name={agent.name} color={agent.color} size="sm" className="mt-0.5" /> : null}
                <div className={cn("max-w-[85%] min-w-0", m.role === "user" && "text-right")}>
                  <div className={cn("inline-block rounded-[var(--radius-md)] px-3.5 py-2.5 text-left", m.role === "user" ? "bg-accent text-accent-fg" : "bg-surface-2")}>
                    {m.role === "assistant" ? <Markdown>{m.content}</Markdown> : <p className="text-[14px] whitespace-pre-wrap">{m.content}</p>}
                  </div>
                  {m.role === "assistant" ? (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                      {m.meta?.model ? <span className="font-mono">{m.meta.model}</span> : null}
                      {m.meta?.tools?.length ? <span>{t("Used {tools}", { tools: m.meta.tools.join(", ") })}</span> : null}
                      {canWrite ? (
                        <button onClick={() => makeTask(m.content)} className="inline-flex items-center gap-1 hover:text-accent">
                          <ClipboardTextIcon size={13} /> {t("Make this a task")}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
          {send.isPending ? (
            <li className="flex items-center gap-2.5">
              <AgentAvatar name={agent.name} color={agent.color} size="sm" />
              <span className="flex gap-1 rounded-[var(--radius-md)] bg-surface-2 px-3.5 py-3" aria-label={t("{name} is thinking", { name: agent.name })}>
                {[0, 1, 2].map((i) => <span key={i} className="size-1.5 rounded-full bg-muted motion-safe:animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}
              </span>
            </li>
          ) : null}
        </ol>
      </div>

      <form data-guide="chat.composer" className="flex items-end gap-2 border-t border-border p-2.5" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor={`chat-${agent.id}`} className="sr-only">{t("Message {name}", { name: agent.name })}</label>
        <textarea
          id={`chat-${agent.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          rows={1}
          disabled={!canWrite || agent.status !== "active"}
          placeholder={agent.status !== "active" ? (agent.status === "paused" ? t("{name} is paused", { name: agent.name }) : t("{name} is retired", { name: agent.name })) : canWrite ? t("Message {name}", { name: agent.name }) : t("Your role can read but not chat")}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-sm border border-border bg-bg px-3 py-2 text-[14px] focus-visible:border-accent focus-visible:outline-none disabled:opacity-60"
        />
        <VoiceInput disabled={!canWrite || agent.status !== "active"}
          onText={(said) => { setDraft((d) => (d.trim() ? `${d.trimEnd()} ${said}` : said)); document.getElementById(`chat-${agent.id}`)?.focus(); }} />
        <Button type="submit" size="icon" disabled={!draft.trim() || send.isPending || !canWrite} aria-label={t("Send")}>
          <PaperPlaneRightIcon size={18} weight="fill" />
        </Button>
      </form>
    </div>
  );
}

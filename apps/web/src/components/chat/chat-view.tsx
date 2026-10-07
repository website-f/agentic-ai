/** The full-screen chat with one agent or assistant: conversations beside it (a sheet on
 * phones), a comfortable reading column, tool chips under replies, and a composer that stays
 * above the phone keyboard. Rendered by the /chat/$agentId route (pages/chat-full.tsx). */
import {
  ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ClipboardTextIcon, ClockCounterClockwiseIcon, CopyIcon, KanbanIcon,
  LightningIcon, PaperPlaneRightIcon, PlusIcon, SidebarSimpleIcon, TrashIcon, WarningCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { titleFrom } from "@/components/task-composer/briefs";
import { QuickKindChips } from "@/components/task-composer/quick-kinds";
import { openTaskComposer, type ComposerResult } from "@/components/task-composer/store";
import { TaskCard } from "@/components/task-composer/task-card";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceInput } from "@/components/voice-input";
import { t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import { staffOnly } from "@/lib/twin";
import { useIsPhone } from "@/lib/use-media";
import { cn } from "@/lib/utils";
import { workKeys, type Agent } from "@/lib/work";

import { clearAsk, peekAsk, taskIdIn } from "./links";
import { channelOf, SessionList, useSessions } from "./sessions";
import { TASK_TOOLS, toolLook } from "./tools";

export interface ChatMessage {
  id: number | string;
  role: "user" | "assistant";
  content: string;
  meta?: { provider?: string; model?: string; tools?: string[]; budget?: boolean } | null;
}

export interface ChatReply { session_id: string; reply: string; provider?: string; model?: string; tools_used: string[] }

/** A one-tap question. A prompt with a <placeholder> fills the box instead of sending. */
export interface QuickPrompt { label: string; prompt: string }

export interface ChatViewProps {
  agent: Agent;
  /** The role may chat (work.write). */
  canWrite: boolean;
  /** Shows the back button (and Esc goes back). */
  onBack?: () => void;
  /** Open this conversation first. */
  initialSession?: string | null;
  /** With no conversation asked for, carry on the latest web conversation (assistants). */
  resumeLatest?: boolean;
  /** The open conversation changed (the route keeps it in the address). */
  onSessionChange?: (id: string | null) => void;
  quickPrompts?: QuickPrompt[];
  /** Extra controls in the header, e.g. the assistants' "to approve" badge. */
  headerExtra?: ReactNode;
  /** Words for the empty conversation. */
  emptyState?: { title?: ReactNode; body?: ReactNode; footer?: ReactNode };
  /** "Make this a task" (default: the task composer with this agent, the question and the reply). */
  onMakeTask?: (content: string) => void;
  /** After every reply, e.g. to refresh what the reply proposed. */
  onReply?: (r: ChatReply) => void;
  /** What it is probably doing while it works. */
  thinking?: (asked: string) => string;
}

/** Remembered per device: whether the conversation list is open beside the chat. */
const RAIL_KEY = "agentic.chat.rail";
function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== "0";
  } catch {
    return true;
  }
}

const coarse = () => typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

export function ChatView({
  agent, canWrite, onBack, initialSession, resumeLatest, onSessionChange, quickPrompts, headerExtra, emptyState, onMakeTask, onReply, thinking,
}: ChatViewProps) {
  const t = useT();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const { data: me } = useQuery(meQuery);
  const phone = useIsPhone();
  const [sessionId, setSessionId] = useState<string | null>(initialSession ?? null);
  const [picked, setPicked] = useState(!!initialSession || !resumeLatest);
  // A one-tap question from a launcher: sent as soon as the chat opens (one with a <blank> waits in the box).
  const [opening] = useState(() => peekAsk(agent.id));
  const [draft, setDraft] = useState(() => (opening?.includes("<") ? opening : ""));
  const [local, setLocal] = useState<ChatMessage[]>([]);
  const [asked, setAsked] = useState("");
  const [rail, setRail] = useState(readRail);
  const [history, setHistory] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [seen, setSeen] = useState(0);
  const [announce, setAnnounce] = useState("");
  // Tasks handed out from this conversation, shown in it after the message they followed.
  const [cards, setCards] = useState<{ id: string; after: number }[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const askedOnOpen = useRef(false);
  const backRef = useRef(onBack);
  const sessionCb = useRef(onSessionChange);
  useEffect(() => {
    backRef.current = onBack;
    sessionCb.current = onSessionChange;
  });

  const inactive = agent.status !== "active";
  const locked = !canWrite || inactive;

  const sessions = useSessions(agent.id);
  // Carry on the latest web conversation (WhatsApp and Telegram chats have their own).
  const latest = sessions.items.find((s) => !channelOf(s));
  const current = picked ? sessionId : sessionId ?? latest?.id ?? null;
  const waitingForLatest = !picked && sessions.isLoading;
  const thread = useQuery({
    queryKey: workKeys.messages(current ?? "none"),
    queryFn: () => api<ChatMessage[]>(`/api/chat/sessions/${current}/messages`),
    enabled: !!current,
  });
  const messages = [...(current ? thread.data ?? [] : []), ...local];
  const title = sessions.items.find((s) => s.id === current)?.title;

  useEffect(() => {
    sessionCb.current?.(current);
  }, [current]);

  const send = useMutation({
    mutationFn: (text: string) => api<ChatReply>(`/api/agents/${agent.id}/chat`, "POST", { message: text, session_id: current }),
    onMutate: (text) => {
      setAsked(text);
      setLocal((l) => [...l, { id: `u${Date.now()}`, role: "user", content: text }]);
    },
    onSuccess: async (r) => {
      setSessionId(r.session_id);
      setPicked(true);
      await qc.invalidateQueries({ queryKey: workKeys.messages(r.session_id) });
      qc.invalidateQueries({ queryKey: workKeys.sessions(agent.id) });
      setLocal([]);
      setAnnounce(tr("{name} replied: {text}", { name: agent.name, text: r.reply.slice(0, 600) }));
      onReply?.(r);
    },
    onError: (e, text) => {
      toast.error(errorMessage(e));
      setLocal((l) => l.slice(0, -1));
      // Nothing typed is lost: the message goes back in the box.
      setDraft((d) => (d.trim() ? d : text));
    },
  });

  const toBottom = (smooth: boolean) => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth && !reduce ? "smooth" : "auto" });
  };
  // New messages follow the conversation down, unless you scrolled up to read something.
  useEffect(() => {
    if (stick.current) toBottom(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toBottom only reads refs
  }, [messages.length, send.isPending]);
  // Another conversation: start at its latest message.
  useEffect(() => {
    stick.current = true;
    toBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toBottom only reads refs
  }, [current, thread.isSuccess]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    stick.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && seen !== messages.length) setSeen(messages.length);
  };
  const unseen = !atBottom && messages.length > seen && messages[messages.length - 1]?.role === "assistant";

  // The chat owns the viewport: the page behind it does not scroll, and on phones it follows
  // the visible area so the keyboard never covers the message box.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    const vv = window.visualViewport;
    const el = root.current;
    const fit = () => {
      if (!vv || !el) return;
      el.style.height = `${vv.height}px`;
      el.style.top = `${vv.offsetTop}px`;
    };
    fit();
    vv?.addEventListener("resize", fit);
    vv?.addEventListener("scroll", fit);
    return () => {
      html.style.overflow = prev;
      vv?.removeEventListener("resize", fit);
      vv?.removeEventListener("scroll", fit);
    };
  }, []);

  // Esc goes back, unless a dialog or sheet is open (it closes that) or you are mid-message.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || !backRef.current) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      if (e.target === box.current && box.current?.value.trim()) {
        box.current.blur();
        return;
      }
      e.preventDefault();
      backRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ready to type on open (not on touch screens, where the keyboard would cover the chat).
  useEffect(() => {
    if (!coarse()) box.current?.focus();
  }, []);

  // The message box grows with what you type, up to a limit, then scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  // The jump-to-latest button floats just above the message box, whatever its height.
  useEffect(() => {
    const el = composer.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const ro = new ResizeObserver(() => host.style.setProperty("--composer-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleRail = () => setRail((r) => {
    try {
      localStorage.setItem(RAIL_KEY, r ? "0" : "1");
    } catch {
      /* storage blocked: remembered for this visit only */
    }
    return !r;
  });
  const startNew = () => {
    setLocal([]);
    setCards([]);
    setSessionId(null);
    setPicked(true);
    setHistory(false);
    box.current?.focus();
  };
  const pick = (id: string) => {
    setLocal([]);
    setCards([]);
    setSessionId(id);
    setPicked(true);
    setHistory(false);
  };

  const submit = (text = draft) => {
    const said = text.trim();
    if (!said || send.isPending || locked) return;
    setDraft("");
    stick.current = true;
    send.mutate(said);
  };
  const runPrompt = (p: QuickPrompt) => {
    if (p.prompt.includes("<")) {
      setDraft(p.prompt);
      box.current?.focus();
    } else submit(p.prompt);
  };

  useEffect(() => {
    if (askedOnOpen.current) return;
    askedOnOpen.current = true;
    clearAsk(agent.id);
    if (opening && !opening.includes("<") && !locked) {
      stick.current = true;
      send.mutate(opening);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, []);

  const remove = async () => {
    if (!current) return;
    try {
      await api(`/api/chat/sessions/${current}`, "DELETE");
    } catch (e) {
      toast.error(errorMessage(e));
      return;
    }
    qc.removeQueries({ queryKey: workKeys.messages(current) });
    qc.invalidateQueries({ queryKey: workKeys.sessions(agent.id) });
    setLocal([]);
    setSessionId(null);
    setPicked(true);
    toast.success(tr("Conversation deleted."));
  };

  const addCard = (r: ComposerResult) => {
    if (r.kind === "task") setCards((c) => [...c, { id: r.task.id, after: messages.length }]);
  };
  // "Make this a task": the composer, with the question as the title and the reply as context.
  const makeTask = (content: string, question?: string) => {
    if (onMakeTask) return onMakeTask(content);
    openTaskComposer({
      agentId: agent.id,
      title: question ? titleFrom(question) : undefined,
      brief: (question ? `${question.trim()}\n\n${tr("From our chat:")}\n${content}` : content).slice(0, 8000),
      onCreated: addCard,
    });
  };
  const lastAsked = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const giveTask = () => openTaskComposer({ agentId: agent.id, brief: lastAsked.slice(0, 8000), onCreated: addCard });
  const showKinds = canWrite && !inactive && (!!agent.is_twin || staffOnly(me?.permissions ?? []));
  const copy = (text: string) =>
    void navigator.clipboard?.writeText(text).then(() => toast.success(tr("Copied.")), () => toast.error(tr("Copy blocked by the browser.")));

  const thinkingText = thinking ? thinking(asked) : t("{name} is thinking…", { name: agent.name });
  const railOpen = rail && !phone;
  const prompts = locked ? [] : quickPrompts ?? [];
  const placeholder = inactive
    ? agent.status === "paused" ? t("{name} is paused", { name: agent.name }) : t("{name} is retired", { name: agent.name })
    : !canWrite ? t("Your role can read but not chat")
    : phone ? t("Ask anything…") : t("Message {name}", { name: agent.name });
  const list = <SessionList sessions={sessions} current={current} onPick={pick} onNew={startNew} />;

  return (
    <div
      ref={root}
      className="fixed inset-x-0 top-0 z-40 flex h-dvh min-w-0 overflow-hidden bg-surface pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      {/* Wide screens: the conversations sit beside the chat (and fold away). */}
      {railOpen ? (
        <aside aria-label={t("Conversations")} className="flex w-72 shrink-0 flex-col border-r border-border bg-surface-2/40">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{t("Conversations")}</p>
            <Button size="icon-sm" variant="ghost" onClick={toggleRail} aria-label={t("Hide conversations")} title={t("Hide conversations")}><SidebarSimpleIcon size={17} /></Button>
          </div>
          {list}
        </aside>
      ) : null}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border px-1.5 sm:gap-2 sm:px-3">
          {onBack ? (
            <Button size="icon" variant="ghost" onClick={onBack} aria-label={t("Back")} title={t("Back (Esc)")}>
              <ArrowLeftIcon size={19} />
            </Button>
          ) : null}
          {!phone && !rail ? (
            <Button size="icon-sm" variant="ghost" onClick={toggleRail} aria-label={t("Show conversations")} title={t("Show conversations")}><SidebarSimpleIcon size={17} /></Button>
          ) : null}
          <AgentAvatar name={agent.name} color={agent.color} size="sm" working={send.isPending || agent.current_task?.status === "running"} className="ml-1" />
          <div className="ml-1 min-w-0 flex-1">
            <h1 className="flex min-w-0 items-center gap-2 text-[14.5px] leading-tight font-semibold">
              <span className="truncate">{agent.name}</span>
              {agent.status === "paused" ? <Pill className="shrink-0 px-1.5 py-0 text-[10.5px]">{t("Paused")}</Pill>
                : agent.status === "retired" ? <Pill className="shrink-0 px-1.5 py-0 text-[10.5px]">{t("Retired")}</Pill> : null}
            </h1>
            <p className="truncate text-[12px] text-muted">{send.isPending ? thinkingText : title && current ? title : agent.role}</p>
          </div>
          {headerExtra}
          {canWrite && !inactive ? (
            <Button size="sm" variant="ghost" className="max-sm:size-10 max-sm:px-0" onClick={giveTask} aria-label={t("Give a task")} title={t("Give a task")}>
              <KanbanIcon size={17} /><span className="max-md:hidden">{t("Give a task")}</span>
            </Button>
          ) : null}
          {!railOpen ? (
            <Button size="icon" variant="ghost" onClick={() => setHistory(true)} aria-label={t("Conversations")} title={t("Conversations")}><ClockCounterClockwiseIcon size={18} /></Button>
          ) : null}
          {current ? (
            <>
              <Button size="sm" variant="ghost" className="max-sm:size-10 max-sm:px-0" onClick={startNew} aria-label={t("New conversation")} title={t("New conversation")}>
                <PlusIcon size={16} /><span className="max-md:hidden">{t("New")}</span>
              </Button>
              <Button size="icon" variant="ghost" className="text-muted hover:text-danger max-sm:hidden" disabled={send.isPending}
                onClick={() => setDeleting(true)} aria-label={t("Delete this conversation")} title={t("Delete this conversation")}>
                <TrashIcon size={17} />
              </Button>
            </>
          ) : null}
        </header>

        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 sm:py-8">
          {thread.error && !messages.length ? (
            <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-10 text-center">
              <WarningCircleIcon size={28} weight="duotone" className="text-warn" />
              <p className="text-[14px]">{errorMessage(thread.error)}</p>
              <Button variant="outline" onClick={startNew}><PlusIcon size={15} /> {t("New conversation")}</Button>
            </div>
          ) : !messages.length && !send.isPending ? (
            (current && thread.isLoading) || waitingForLatest ? (
              <div className="mx-auto grid max-w-[760px] gap-5">{[0, 1, 2].map((i) => <Skeleton key={i} className={cn("h-16 rounded-[var(--radius-lg)]", i % 2 ? "ml-auto w-2/3" : "w-4/5")} />)}</div>
            ) : (
              <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-4 py-6 text-center">
                <AgentAvatar name={agent.name} color={agent.color} size="lg" />
                <div>
                  <p className="text-[17px] font-semibold">{emptyState?.title ?? t("Talk to {name}", { name: agent.name })}</p>
                  <p className="mt-1 text-[13.5px] text-muted">{emptyState?.body ?? t("Ask questions or think out loud together. Anything that needs approval is suggested as a task.")}</p>
                </div>
                {prompts.length ? (
                  <div data-guide="chat.quick" className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                    {prompts.slice(0, 6).map((p) => (
                      <button key={p.label} type="button" onClick={() => runPrompt(p)}
                        className="group flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3.5 py-3 text-left text-[13px] transition-colors hover:border-accent/50 hover:bg-accent-soft/40">
                        <span className="font-medium">{t(p.label)}</span>
                        <ArrowRightIcon size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                      </button>
                    ))}
                  </div>
                ) : null}
                {showKinds ? (
                  <div className="grid w-full gap-2">
                    <p className="text-[12px] text-muted">{t("Or hand it work right away:")}</p>
                    <QuickKindChips agentId={agent.id} onCreated={addCard} />
                  </div>
                ) : null}
                {emptyState?.footer}
              </div>
            )
          ) : null}
          <ol className="mx-auto grid w-full max-w-[760px] grid-cols-[minmax(0,1fr)] gap-7">
            <AnimatePresence initial={false}>
              {cards.filter((c) => c.after === 0).map((c) => (
                <motion.li key={`card-${c.id}`} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="min-w-0 sm:pl-11">
                  <TaskCard taskId={c.id} />
                </motion.li>
              ))}
              {messages.flatMap((m, i) => {
                const question = m.role === "assistant" ? messages.slice(0, i).reverse().find((x) => x.role === "user")?.content : undefined;
                return [
                  <motion.li key={m.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex min-w-0 gap-3", m.role === "user" && "justify-end")}>
                    {m.role === "user" ? (
                      <div className="max-w-[85%] rounded-[var(--radius-lg)] rounded-br-sm bg-accent px-4 py-2.5 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-accent-fg">{m.content}</div>
                    ) : (
                      <Reply m={m} agent={agent} canTask={canWrite && !inactive} onTask={() => makeTask(m.content, question)} onCopy={copy} />
                    )}
                  </motion.li>,
                  ...cards.filter((c) => c.after === i + 1).map((c) => (
                    <motion.li key={`card-${c.id}`} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="min-w-0 sm:pl-11">
                      <TaskCard taskId={c.id} />
                    </motion.li>
                  )),
                ];
              })}
            </AnimatePresence>
            {send.isPending ? (
              <li className="flex items-center gap-3">
                <AgentAvatar name={agent.name} color={agent.color} size="sm" working />
                <span className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-surface-2/70 px-3.5 py-2.5 text-[13px] text-muted">
                  <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 rounded-full bg-accent motion-safe:animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
                  {thinkingText}
                </span>
              </li>
            ) : null}
          </ol>
          <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>
        </div>

        {/* Scrolled up to read: one tap back to the latest message. */}
        <AnimatePresence>
          {!atBottom && messages.length ? (
            <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: 8 }}
              className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--composer-h,6rem)+0.75rem)] flex justify-center">
              <button type="button" onClick={() => { stick.current = true; toBottom(true); }}
                className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-medium shadow-[var(--shadow-pop)] hover:border-accent/50 hover:text-accent">
                <ArrowDownIcon size={14} weight="bold" /> {unseen ? t("New reply") : t("Jump to latest")}
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div ref={composer} className="shrink-0 border-t border-border bg-surface">
          {messages.length && prompts.length ? (
            <div data-guide="chat.quick" className="mx-auto flex max-w-[808px] gap-1.5 overflow-x-auto px-3 pt-2 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden">
              {prompts.map((p) => (
                <button key={p.label} type="button" disabled={send.isPending} onClick={() => runPrompt(p)}
                  className="h-8 shrink-0 rounded-full border border-border px-3 text-[12px] whitespace-nowrap text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50 pointer-coarse:h-9">
                  {t(p.label)}
                </button>
              ))}
            </div>
          ) : null}
          <form data-guide="chat.composer" className="mx-auto flex w-full max-w-[808px] items-end gap-2 px-3 py-2.5 sm:px-6 sm:py-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label htmlFor={`chat-${agent.id}`} className="sr-only">{t("Message {name}", { name: agent.name })}</label>
            <textarea
              ref={box}
              id={`chat-${agent.id}`}
              value={draft}
              rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={locked}
              placeholder={placeholder}
              aria-describedby={`chat-${agent.id}-hint`}
              className="max-h-[200px] min-h-11 flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-bg px-3.5 py-2.5 text-[14.5px] leading-relaxed focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-60 max-sm:text-[16px]"
            />
            <VoiceInput round disabled={locked}
              onText={(said) => { setDraft((d) => (d.trim() ? `${d.trimEnd()} ${said}` : said)); box.current?.focus(); }} />
            <Button type="submit" size="icon" className="size-11 rounded-full" disabled={!draft.trim() || send.isPending || locked} aria-label={t("Send")}>
              <PaperPlaneRightIcon size={18} weight="fill" />
            </Button>
          </form>
          <p id={`chat-${agent.id}-hint`} className="-mt-1 pb-2 text-center text-[11px] text-muted max-sm:sr-only">{t("Enter to send, Shift+Enter for a new line")}</p>
        </div>
      </main>

      {/* Conversations as a sheet: phones always, wide screens when the side list is folded. */}
      <SideSheet open={history} onOpenChange={setHistory} size="sm" title={t("Conversations")} description={t("Your chats with {name}.", { name: agent.name })}
        actions={current ? (
          <Button size="sm" variant="ghost" className="hover:text-danger" disabled={send.isPending} onClick={() => { setHistory(false); setDeleting(true); }}>
            <TrashIcon size={14} /> {t("Delete this conversation")}
          </Button>
        ) : null}>
        {list}
      </SideSheet>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={t("Delete this conversation?")} danger confirmLabel={t("Delete")}
        body={t("Its messages are removed for good. What {name} already learned from it stays in its memory.", { name: agent.name })} onConfirm={remove} />
    </div>
  );
}

/** One reply: easy to read (no bubble, full reading width), then what it used and what you can do with it. */
function Reply({ m, agent, canTask, onTask, onCopy }: {
  m: ChatMessage;
  agent: Agent;
  canTask: boolean;
  onTask: () => void;
  onCopy: (text: string) => void;
}) {
  const t = useT();
  const tools = [...new Set(m.meta?.tools ?? [])];
  const madeTask = tools.some((x) => TASK_TOOLS.includes(x));
  const taskId = madeTask ? taskIdIn(m.content) : undefined;
  const chips = new Map<string, { label: string; icon: typeof LightningIcon }>();
  for (const tool of tools) {
    if (TASK_TOOLS.includes(tool)) continue;
    const look = toolLook(tool);
    const label = look ? t(look.label) : tool.replace(/_/g, " ");
    if (!chips.has(label)) chips.set(label, { label, icon: look?.icon ?? LightningIcon });
  }
  return (
    <>
      <AgentAvatar name={agent.name} color={agent.color} size="sm" className="mt-0.5 max-sm:hidden" />
      <div className="min-w-0 flex-1">
        <Markdown className="text-[15px] leading-7 [&_pre]:text-[13px] [&_pre]:leading-relaxed [&_table]:text-[13px]">{m.content}</Markdown>
        {chips.size || (madeTask && !taskId) ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {madeTask && !taskId ? (
              <Link to="/tasks" search={{}}
                className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-soft/50 px-2.5 py-0.5 text-[11.5px] font-medium text-accent hover:bg-accent-soft">
                <KanbanIcon size={12} /> {t("Created a task")} <ArrowRightIcon size={11} />
              </Link>
            ) : null}
            {[...chips.values()].map((c) => (
              <span key={c.label} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
                <c.icon size={11} /> {c.label}
              </span>
            ))}
          </div>
        ) : null}
        {/* A task it handed out: shown in place, its status following the work. */}
        {taskId ? <TaskCard taskId={taskId} className="mt-2.5" /> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[12px] text-muted">
          <button type="button" onClick={() => onCopy(m.content)} className="inline-flex h-8 items-center gap-1 rounded-sm px-1.5 hover:bg-surface-2 hover:text-fg">
            <CopyIcon size={13} /> {t("Copy")}
          </button>
          {canTask ? (
            <button type="button" onClick={onTask} className="inline-flex h-8 items-center gap-1 rounded-sm px-1.5 hover:bg-surface-2 hover:text-accent">
              <ClipboardTextIcon size={13} /> {t("Make this a task")}
            </button>
          ) : null}
          {m.meta?.model ? <span className="ml-auto font-mono text-[11px] text-muted/80 max-sm:hidden">{m.meta.model}</span> : null}
        </div>
      </div>
    </>
  );
}

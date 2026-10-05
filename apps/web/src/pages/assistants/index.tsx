/** My assistants (P16): a person's own private AI assistants. Chat with them about the whole
 * company, let them read Gmail and draft replies (sent only when approved here), and have them
 * chase people and other agents on WhatsApp. Built phone-first. */
import {
  ArrowDownIcon, ArrowRightIcon, ArrowsInSimpleIcon, ArrowsOutSimpleIcon, CalendarBlankIcon, ClockCounterClockwiseIcon, SidebarSimpleIcon, CalendarCheckIcon, CalendarPlusIcon, CalendarXIcon, ChartLineUpIcon, CheckCircleIcon,
  ChatCircleDotsIcon, ClockCountdownIcon, EnvelopeSimpleIcon, GearSixIcon, LightningIcon, VideoCameraIcon,
  LockSimpleIcon, MagnifyingGlassIcon, PaperPlaneRightIcon, PlusIcon, SparkleIcon, TrashIcon, TrendDownIcon, UsersThreeIcon,
  WarningCircleIcon, WhatsappLogoIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Markdown } from "@/components/markdown";
import { EmptyState, IconTile, Page, PageHeader, type Tone } from "@/components/page";
import { Trans } from "@/components/trans";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { VoiceInput } from "@/components/voice-input";
import { msg, t as tr, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  assistantKeys, assistantsQuery, calendarDraftsQuery, draftsQuery, QUICK_PROMPTS, type AssistantsHome, type CalendarDraft, type EmailDraft, type Preset,
} from "@/lib/assistants";
import { useFillHeight } from "@/lib/use-fill-height";
import { useIsPhone } from "@/lib/use-media";
import { cn, timeAgo } from "@/lib/utils";
import { workKeys, type Agent } from "@/lib/work";

type Tab = "chat" | "drafts" | "settings";

const PRESET_LOOK: Record<Preset["key"], { icon: Icon; tone: Tone; can: string[] }> = {
  chief_of_staff: { icon: SparkleIcon, tone: "accent", can: [msg("Daily company pulse"), msg("Who's slipping"), msg("Chase people & agents"), msg("Your inbox & calendar")] },
  inbox: { icon: EnvelopeSimpleIcon, tone: "info", can: [msg("Reads Gmail"), msg("What needs you today"), msg("Drafts replies to approve")] },
  analyst: { icon: ChartLineUpIcon, tone: "violet", can: [msg("Team performance"), msg("Trends & tables"), msg("Three actions")] },
  custom: { icon: GearSixIcon, tone: "orange", can: [msg("Your own instructions")] },
};

/** What each tool looks like under a reply. */
const TOOL_LOOK: Record<string, { label: string; icon: Icon }> = {
  company_pulse: { label: msg("Company pulse"), icon: ChartLineUpIcon },
  team_performance: { label: msg("Team performance"), icon: UsersThreeIcon },
  slacking_report: { label: msg("Where things slip"), icon: TrendDownIcon },
  notify_person: { label: msg("Messaged a person"), icon: WhatsappLogoIcon },
  message_agent: { label: msg("Gave an agent a job"), icon: LightningIcon },
  email_search: { label: msg("Searched email"), icon: MagnifyingGlassIcon },
  email_read: { label: msg("Read an email"), icon: EnvelopeSimpleIcon },
  email_draft_reply: { label: msg("Drafted a reply"), icon: PaperPlaneRightIcon },
  email_draft: { label: msg("Drafted an email"), icon: PaperPlaneRightIcon },
  calendar_agenda: { label: msg("Read your calendar"), icon: CalendarBlankIcon },
  calendar_free_slots: { label: msg("Found free time"), icon: CalendarCheckIcon },
  calendar_create_event: { label: msg("Proposed an event"), icon: CalendarPlusIcon },
  calendar_update_event: { label: msg("Proposed a change"), icon: CalendarBlankIcon },
  calendar_cancel_event: { label: msg("Proposed a cancellation"), icon: CalendarXIcon },
  schedule_task: { label: msg("Set up a schedule"), icon: ClockCountdownIcon },
  list_my_schedules: { label: msg("Checked schedules"), icon: ClockCountdownIcon },
  cancel_schedule: { label: msg("Cancelled a schedule"), icon: ClockCountdownIcon },
};

/** Tools whose result waits on the Drafts tab. */
const PROPOSES = ["email_draft", "email_draft_reply", "calendar_create_event", "calendar_update_event", "calendar_cancel_event"];

/** While the assistant works: what it is probably doing, from what was asked. */
function thinkingLine(q: string): string {
  const s = q.toLowerCase();
  if (/\bevery\b|remind me|\bdaily\b|\bweekly\b|\bmonthly\b/.test(s)) return tr("Setting up the schedule…");
  if (/calendar|meeting|free time|free slot|\bbook\b|agenda/.test(s)) return tr("Checking your calendar…");
  if (/inbox|email|mail|reply|draft/.test(s)) return tr("Going through your email…");
  if (/slack|stuck|late|behind|slip/.test(s)) return tr("Looking for what's stuck…");
  if (/who|staff|team|perform|doing well/.test(s)) return tr("Checking how everyone is doing…");
  if (/tell|remind|chase|notify|whatsapp/.test(s)) return tr("Reaching out…");
  return tr("Looking at the company…");
}

// ---------------------------------------------------------------- creating

function NewAssistant({ presets, onClose, onCreated }: { presets: Preset[]; onClose: () => void; onCreated: (a: Agent) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [key, setKey] = useState<Preset["key"]>("chief_of_staff");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const create = useMutation({
    mutationFn: () => api<Agent>("/api/assistants", "POST", { preset: key, name: name.trim() || undefined, instructions: notes.trim() || undefined }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(t("{name} is ready.", { name: a.name })); onCreated(a); },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("New assistant")} className="w-[min(96vw,40rem)]"
      description={t("Private to you: nobody else sees it or what you discuss.")}
      footer={<><Button variant="outline" onClick={onClose}>{t("Cancel")}</Button><Button loading={create.isPending} onClick={() => create.mutate()}><SparkleIcon size={15} /> {t("Create")}</Button></>}>
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {presets.map((p) => {
            const look = PRESET_LOOK[p.key];
            const on = p.key === key;
            return (
              <button key={p.key} type="button" onClick={() => setKey(p.key)}
                className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-[var(--radius-md)] border p-3 text-left transition-colors",
                  on ? "border-accent bg-accent-soft/60 ring-2 ring-accent/15" : "border-border hover:border-accent/40")}>
                <IconTile icon={look.icon} tone={look.tone} size="sm" />
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold">{p.name}</span>
                  <span className="block text-[12px] text-muted">{p.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        <Field label={t("Name (optional)")} value={name} onChange={(e) => setName(e.target.value)} placeholder={presets.find((p) => p.key === key)?.name} />
        <TextareaField label={t("Anything it should know about you (optional)")} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={t("e.g. Reply in Bahasa Melayu to government clients. My weekly meeting is Monday 9am. Flag anything about cash flow first.")} />
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function Welcome({ presets, onPick }: { presets: Preset[]; onPick: (k: Preset["key"]) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (preset: string) => api<Agent>("/api/assistants", "POST", { preset }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(t("{name} is ready. Say hello.", { name: a.name })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-5">
      <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_70%)]" />
        <div className="relative grid max-w-2xl gap-3">
          <Pill tone="accent" className="w-fit"><LockSimpleIcon size={12} /> {t("Private to you")}</Pill>
          <h2 className="text-[22px] leading-tight font-semibold tracking-tight sm:text-[28px]">{t("An assistant that knows the whole company, and your inbox.")}</h2>
          <p className="text-[14px] text-muted">{t("Ask what's happening, where you're slipping and who needs a push. It reads your Gmail and drafts replies you approve, and it chases your staff's agents, who message their people on WhatsApp.")}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {presets.map((p) => {
          const look = PRESET_LOOK[p.key];
          return (
            <Card key={p.key} interactive className="flex flex-col">
              <CardBody className="flex flex-1 flex-col gap-3">
                <div className="flex items-center gap-3">
                  <IconTile icon={look.icon} tone={look.tone} />
                  <span className="text-[15px] font-semibold">{p.name}</span>
                </div>
                <p className="text-[13px] text-muted">{p.blurb}</p>
                <ul className="grid gap-1 text-[12.5px]">
                  {look.can.map((c) => <li key={c} className="flex items-center gap-1.5"><CheckCircleIcon size={14} weight="fill" className="text-ok" /> {t(c)}</li>)}
                </ul>
                <div className="mt-auto flex gap-2 pt-1">
                  <Button className="flex-1" loading={create.isPending && create.variables === p.key} onClick={() => create.mutate(p.key)}>{t("Create")}</Button>
                  <Button variant="ghost" onClick={() => onPick(p.key)}>{t("Customise")}</Button>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- chat

interface Msg { id: number | string; role: "user" | "assistant"; content: string; meta?: { tools?: string[] } | null }
interface ChatSession { id: string; title: string; updated_at: string }

/** WhatsApp and Telegram conversations live with the channel; the web chat picks up the rest. */
const isChannelChat = (s: ChatSession) => s.title.startsWith("WhatsApp") || s.title.startsWith("Telegram");

/** Remembered per device: whether the conversation list is open beside the full-screen chat. */
const RAIL_KEY = "agentic.assistants.rail";
function readRail(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) !== "0";
  } catch {
    return true;
  }
}

/** Typing somewhere: single-key shortcuts stay out of the way. */
const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function SessionList({ sessions, current, onPick, onNew, loading }: {
  sessions: ChatSession[];
  current: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  loading: boolean;
}) {
  const t = useT();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}><PlusIcon size={15} /> {t("New conversation")}</Button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2" aria-label={t("Conversations")}>
        {loading ? [0, 1, 2].map((i) => <li key={i}><Skeleton className="mb-1.5 h-12 rounded-sm" /></li>) : null}
        {!loading && !sessions.length ? <li className="px-2 py-6 text-center text-[12.5px] text-muted">{t("No conversations yet.")}</li> : null}
        {sessions.map((s) => {
          const on = s.id === current;
          const channel = isChannelChat(s);
          return (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s.id)} aria-current={on || undefined}
                className={cn("flex min-h-12 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left transition-colors", on ? "bg-accent-soft" : "hover:bg-surface-2")}>
                {channel ? <WhatsappLogoIcon size={16} className="shrink-0 text-ok" /> : <ChatCircleDotsIcon size={16} className={cn("shrink-0", on ? "text-accent" : "text-muted")} />}
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-[13px]", on && "font-medium text-accent")}>{s.title || t("Conversation")}</span>
                  <span className="block truncate text-[11.5px] text-muted">{timeAgo(s.updated_at)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Chat({ agent, home, onDrafts }: { agent: Agent; home: AssistantsHome; onDrafts: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const phone = useIsPhone();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [draft, setDraft] = useState("");
  const [local, setLocal] = useState<Msg[]>([]);
  const [asked, setAsked] = useState("");
  const [full, setFull] = useState(false);
  const [rail, setRail] = useState(readRail);
  const [history, setHistory] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [seen, setSeen] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  const composer = useRef<HTMLDivElement>(null);

  // Normal view: exactly the screen that is left below the tabs (measured, not guessed), so the
  // page itself never scrolls and only the conversation does.
  useFillHeight(root, { fit: "page", min: phone ? 352 : 384, enabled: !full });

  const sessions = useQuery({
    queryKey: workKeys.sessions(agent.id),
    queryFn: () => api<ChatSession[]>(`/api/agents/${agent.id}/sessions`),
  });
  // Pick up the latest conversation (web ones; WhatsApp chats have their own).
  const latest = (sessions.data ?? []).find((s) => !isChannelChat(s));
  const current = picked ? sessionId : sessionId ?? latest?.id ?? null;
  const thread = useQuery({
    queryKey: workKeys.messages(current ?? "none"),
    queryFn: () => api<Msg[]>(`/api/chat/sessions/${current}/messages`),
    enabled: !!current,
  });
  const messages = [...(current ? thread.data ?? [] : []), ...local];
  const title = (sessions.data ?? []).find((s) => s.id === current)?.title;

  const send = useMutation({
    mutationFn: (text: string) =>
      api<{ session_id: string; reply: string; tools_used: string[] }>(`/api/agents/${agent.id}/chat`, "POST", { message: text, session_id: current }),
    onMutate: (text) => { setAsked(text); setLocal((l) => [...l, { id: `u${Date.now()}`, role: "user", content: text }]); },
    onSuccess: async (r) => {
      setSessionId(r.session_id);
      setPicked(true);
      await qc.invalidateQueries({ queryKey: workKeys.messages(r.session_id) });
      qc.invalidateQueries({ queryKey: workKeys.sessions(agent.id) });
      if (r.tools_used.some((x) => PROPOSES.includes(x))) {
        qc.invalidateQueries({ queryKey: assistantKeys.allDrafts });
        qc.invalidateQueries({ queryKey: assistantKeys.allCalendar });
        qc.invalidateQueries({ queryKey: assistantKeys.home });
      }
      setLocal([]);
    },
    onError: (e) => { toast.error(errorMessage(e)); setLocal((l) => l.slice(0, -1)); },
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
  // Another conversation (or the full-screen switch): start at its latest message.
  useEffect(() => {
    stick.current = true;
    toBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toBottom only reads refs
  }, [current, full, thread.isSuccess]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    stick.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && seen !== messages.length) setSeen(messages.length);
  };
  const unseen = !atBottom && messages.length > seen && messages[messages.length - 1]?.role === "assistant";

  // Full screen: F toggles it (when not typing), Esc leaves it (when no sheet or dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === "f" || e.key === "F") && !typing(e.target)) {
        e.preventDefault();
        setFull((f) => !f);
      } else if (e.key === "Escape" && full && ![...document.querySelectorAll('[role="dialog"]')].some((d) => d !== root.current)) {
        setFull(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);
  // Full screen owns the viewport: the page behind it does not scroll, and on phones the chat
  // follows the visible area so the keyboard never covers the message box.
  useEffect(() => {
    if (!full) return;
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
      if (el) {
        el.style.height = "";
        el.style.top = "";
      }
    };
  }, [full]);

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
  const startNew = () => { setLocal([]); setSessionId(null); setPicked(true); setHistory(false); box.current?.focus(); };
  const pick = (id: string) => { setLocal([]); setSessionId(id); setPicked(true); setHistory(false); };

  const submit = (text = draft) => {
    const said = text.trim();
    if (!said || send.isPending) return;
    setDraft("");
    stick.current = true;
    send.mutate(said);
  };
  const gmail = !!home.google.account;
  const cal = !!home.google.account?.calendar;
  const prompts = QUICK_PROMPTS.filter((p) => !p.needs || (p.needs === "gmail" ? gmail : cal));
  const waiting = home.drafts_pending + (home.calendar_pending ?? 0);
  const railOpen = full && rail && !phone;
  const list = (
    <SessionList sessions={sessions.data ?? []} current={current} onPick={pick} onNew={startNew} loading={sessions.isLoading} />
  );

  return (
    <div
      ref={root}
      data-guide="assistants.chat"
      role={full ? "dialog" : undefined}
      aria-modal={full || undefined}
      aria-label={full ? t("Chat with {name}, full screen", { name: agent.name }) : undefined}
      className={cn(
        "flex min-w-0 overflow-hidden bg-surface",
        full
          ? "fixed inset-x-0 top-0 z-40 h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] motion-safe:animate-[fade-in_160ms_ease-out]"
          : "h-[var(--fill-h,32rem)] rounded-[var(--radius-lg)] border border-border",
      )}
    >
      {/* Full screen on wide screens: the conversations sit beside the chat (and fold away). */}
      {railOpen ? (
        <aside aria-label={t("Conversations")} className="flex w-72 shrink-0 flex-col border-r border-border bg-surface-2/40">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <AgentAvatar name={agent.name} color={agent.color} size="sm" />
            <p className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{agent.name}</p>
            <Button size="icon-sm" variant="ghost" onClick={toggleRail} aria-label={t("Hide conversations")} title={t("Hide conversations")}><SidebarSimpleIcon size={17} /></Button>
          </div>
          {list}
        </aside>
      ) : null}

      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className={cn("flex shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3 sm:px-4", full ? "h-14" : "py-2.5")}>
          {full && !phone && !rail ? (
            <Button size="icon-sm" variant="ghost" onClick={toggleRail} aria-label={t("Show conversations")} title={t("Show conversations")}><SidebarSimpleIcon size={17} /></Button>
          ) : null}
          <AgentAvatar name={agent.name} color={agent.color} size="sm" working={send.isPending} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{agent.name}</p>
            <p className="truncate text-[11.5px] text-muted">{send.isPending ? thinkingLine(asked) : title && current ? title : agent.role}</p>
          </div>
          {waiting ? (
            <Button size="sm" variant="outline" onClick={() => { setFull(false); onDrafts(); }} title={t("{n} to approve", { n: waiting })}>
              <CheckCircleIcon size={14} /> {waiting}<span className="max-sm:hidden"> {t("to approve")}</span>
            </Button>
          ) : null}
          {!railOpen ? (
            <Button size="icon-sm" variant="ghost" onClick={() => setHistory(true)} aria-label={t("Conversations")} title={t("Conversations")}><ClockCounterClockwiseIcon size={17} /></Button>
          ) : null}
          {current ? (
            <Button size="sm" variant="ghost" onClick={startNew} aria-label={t("New conversation")} title={t("New conversation")}><PlusIcon size={15} /><span className="max-md:hidden">{t("New")}</span></Button>
          ) : null}
          <Button size="icon-sm" variant="ghost" onClick={() => setFull((f) => !f)} aria-pressed={full}
            aria-label={full ? t("Exit full screen") : t("Full screen")} title={full ? t("Exit full screen (Esc)") : t("Full screen (F)")}>
            {full ? <ArrowsInSimpleIcon size={17} /> : <ArrowsOutSimpleIcon size={17} />}
          </Button>
        </div>

        <div ref={scroller} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6" aria-live="polite">
          {!messages.length && !send.isPending ? (
            current && thread.isLoading ? (
              <div className="mx-auto grid max-w-3xl gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className={cn("h-16 rounded-[var(--radius-lg)]", i % 2 ? "ml-auto w-2/3" : "w-4/5")} />)}</div>
            ) : (
              <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-4 py-6 text-center">
                <AgentAvatar name={agent.name} color={agent.color} size="lg" />
                <div>
                  <p className="text-[17px] font-semibold">{t("Hi, I'm {name}.", { name: agent.name })}</p>
                  <p className="mt-1 text-[13px] text-muted">{t("Ask me about the company, your team or your inbox. Try one of these:")}</p>
                </div>
                <div data-guide="assistants.quick" className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                  {prompts.slice(0, 6).map((p) => (
                    <button key={p.label} type="button" onClick={() => (p.prompt.includes("<") ? (setDraft(p.prompt), box.current?.focus()) : submit(p.prompt))}
                      className="group flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3.5 py-3 text-left text-[13px] transition-colors hover:border-accent/50 hover:bg-accent-soft/40">
                      <span className="font-medium">{t(p.label)}</span>
                      <ArrowRightIcon size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                    </button>
                  ))}
                </div>
                {!gmail ? <p className="text-[12px] text-muted">{t("Connect Google in Settings and I can read your inbox and calendar too.")}</p>
                  : !cal ? <p className="text-[12px] text-muted">{t("Reconnect Google in Settings to add your calendar.")}</p> : null}
              </div>
            )
          ) : null}
          <ol className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-5">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.li key={m.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-2.5", m.role === "user" && "justify-end")}>
                  {m.role === "assistant" ? <AgentAvatar name={agent.name} color={agent.color} size="sm" className="mt-0.5 shrink-0 max-sm:hidden" /> : null}
                  <div className={cn("min-w-0", m.role === "user" ? "max-w-[85%]" : "max-w-full flex-1")}>
                    {m.role === "user" ? (
                      <div className="rounded-[var(--radius-lg)] rounded-br-sm bg-accent px-3.5 py-2.5 text-[14px] break-words whitespace-pre-wrap text-accent-fg">{m.content}</div>
                    ) : (
                      <div className="min-w-0 overflow-x-auto rounded-[var(--radius-lg)] rounded-tl-sm bg-surface-2/70 px-4 py-3">
                        <Markdown className="text-[14px] [&_table]:text-[12.5px]">{m.content}</Markdown>
                      </div>
                    )}
                    {m.role === "assistant" && m.meta?.tools?.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {[...new Set(m.meta.tools)].map((tool) => {
                          const look = TOOL_LOOK[tool];
                          const IconCmp = look?.icon ?? LightningIcon;
                          return (
                            <span key={tool} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
                              <IconCmp size={11} /> {look ? t(look.label) : tool.replace(/_/g, " ")}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
            {send.isPending ? (
              <li className="flex items-center gap-2.5">
                <AgentAvatar name={agent.name} color={agent.color} size="sm" working />
                <span className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-surface-2/70 px-3.5 py-2.5 text-[12.5px] text-muted">
                  <span className="flex gap-1">{[0, 1, 2].map((i) => <span key={i} className="size-1.5 rounded-full bg-accent motion-safe:animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />)}</span>
                  {thinkingLine(asked)}
                </span>
              </li>
            ) : null}
          </ol>
        </div>

        {/* Scrolled up to read: one tap back to the latest message. */}
        <AnimatePresence>
          {!atBottom && messages.length ? (
            <motion.div initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: 8 }}
              className="pointer-events-none absolute inset-x-0 bottom-[calc(var(--composer-h,7.5rem)+0.75rem)] flex justify-center">
              <button type="button" onClick={() => { stick.current = true; toBottom(true); }}
                className="pointer-events-auto inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 text-[12.5px] font-medium shadow-[var(--shadow-pop)] hover:border-accent/50 hover:text-accent">
                <ArrowDownIcon size={14} weight="bold" /> {unseen ? t("New reply") : t("Jump to latest")}
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div ref={composer} className="shrink-0">
          {messages.length ? (
            <div data-guide="assistants.quick" className={cn("flex gap-1.5 overflow-x-auto border-t border-border px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", full && "sm:justify-center")}>
              {prompts.map((p) => (
                <button key={p.label} type="button" disabled={send.isPending}
                  onClick={() => (p.prompt.includes("<") ? (setDraft(p.prompt), box.current?.focus()) : submit(p.prompt))}
                  className="h-8 shrink-0 rounded-full border border-border px-3 text-[12px] whitespace-nowrap text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50 pointer-coarse:h-9">
                  {t(p.label)}
                </button>
              ))}
            </div>
          ) : null}
          <form className={cn("mx-auto flex w-full items-end gap-2 p-2.5 sm:p-3", full && "max-w-4xl")} onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label htmlFor={`as-${agent.id}`} className="sr-only">{t("Message {name}", { name: agent.name })}</label>
            <textarea ref={box} id={`as-${agent.id}`} value={draft} rows={1}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              disabled={agent.status !== "active"}
              placeholder={agent.status !== "active" ? t("{name} is {status}", { name: agent.name, status: agent.status === "paused" ? t("Paused").toLowerCase() : agent.status }) : phone ? t("Ask anything…") : t("Ask {name} anything…", { name: agent.name })}
              className="max-h-40 min-h-11 flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-bg px-3.5 py-2.5 text-[14px] [field-sizing:content] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-60 max-sm:text-[16px]" />
            <VoiceInput round disabled={agent.status !== "active"}
              onText={(said) => { setDraft((d) => (d.trim() ? `${d.trimEnd()} ${said}` : said)); box.current?.focus(); }} />
            <Button type="submit" size="icon" className="size-11 rounded-full" disabled={!draft.trim() || send.isPending} aria-label={t("Send")}>
              <PaperPlaneRightIcon size={18} weight="fill" />
            </Button>
          </form>
        </div>
      </div>

      {/* Conversations as a sheet: phones always, wide screens when the side list is not shown. */}
      <SideSheet open={history} onOpenChange={setHistory} size="sm" title={t("Conversations")} description={t("Your chats with {name}. WhatsApp chats are listed too.", { name: agent.name })}>
        {list}
      </SideSheet>
    </div>
  );
}

// ---------------------------------------------------------------- drafts

function DraftCard({ d }: { d: EmailDraft }) {
  const t = useT();
  const qc = useQueryClient();
  const [body, setBody] = useState(d.body);
  const [subject, setSubject] = useState(d.subject);
  const [discarding, setDiscarding] = useState(false);
  const edited = body !== d.body || subject !== d.subject;
  const refresh = () => { qc.invalidateQueries({ queryKey: assistantKeys.allDrafts }); qc.invalidateQueries({ queryKey: assistantKeys.home }); };
  const save = useMutation({
    mutationFn: () => api<EmailDraft>(`/api/email-drafts/${d.id}`, "PATCH", { body, subject }),
    onSuccess: () => { refresh(); toast.success(t("Draft updated in Gmail.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (edited) await api(`/api/email-drafts/${d.id}`, "PATCH", { body, subject });
      return api<EmailDraft>(`/api/email-drafts/${d.id}/send`, "POST");
    },
    onSuccess: () => { refresh(); toast.success(t("Sent to {to}.", { to: d.to.replace(/<.*>/, "").trim() || d.to })); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: () => api(`/api/email-drafts/${d.id}/discard`, "POST"),
    onSuccess: () => { refresh(); toast.success(t("Discarded.")); },
  });
  return (
    <Card>
      <CardHeader icon={<IconTile icon={EnvelopeSimpleIcon} tone="info" size="sm" />}
        title={<span className="break-words">{t("To {to}", { to: d.to })}</span>}
        description={[d.agent_name ? t("Drafted by {name}", { name: d.agent_name }) : null, timeAgo(d.created_at)].filter(Boolean).join(" · ")}
        actions={<Pill tone="warn">{t("Waiting for you")}</Pill>} />
      <CardBody className="grid gap-3">
        {d.is_reply && d.original_from ? (
          <div className="rounded-[var(--radius-sm)] border-l-2 border-border bg-surface-2/50 px-3 py-2 text-[12.5px] text-muted">
            <p className="font-medium text-fg">{t("In reply to {from}", { from: d.original_from })}</p>
            {d.original_snippet ? <p className="mt-0.5 line-clamp-2">{d.original_snippet}</p> : null}
          </div>
        ) : null}
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label={t("Subject")} className="font-medium" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} aria-label={t("Email body")}
          className="w-full rounded-sm border border-border bg-surface px-3 py-2.5 text-[14px] leading-relaxed [field-sizing:content] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
        <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
          <Button loading={send.isPending} onClick={() => send.mutate()}><PaperPlaneRightIcon size={15} weight="fill" /> {edited ? t("Save and send") : t("Send")}</Button>
          {edited ? <Button variant="outline" loading={save.isPending} onClick={() => save.mutate()}>{t("Save changes")}</Button> : null}
          <Button variant="ghost" className="hover:text-danger" onClick={() => setDiscarding(true)}><TrashIcon size={14} /> {t("Discard")}</Button>
        </div>
        {d.error ? <p className="text-[12.5px] text-danger">{d.error}</p> : null}
      </CardBody>
      <ConfirmDialog open={discarding} onOpenChange={setDiscarding} title={t("Discard this draft?")} danger confirmLabel={t("Discard")}
        body={t("It is removed from your Gmail drafts. Nothing was sent.")} onConfirm={async () => { await discard.mutateAsync(); }} />
    </Card>
  );
}

const CAL_LOOK: Record<CalendarDraft["action"], { icon: Icon; tone: Tone; verb: string; confirm: string; done: string }> = {
  create: { icon: CalendarPlusIcon, tone: "accent", verb: msg("New event"), confirm: msg("Add to calendar"), done: msg("Added to your calendar.") },
  update: { icon: CalendarBlankIcon, tone: "info", verb: msg("Change"), confirm: msg("Save the change"), done: msg("Calendar updated.") },
  cancel: { icon: CalendarXIcon, tone: "danger", verb: msg("Cancel"), confirm: msg("Cancel the event"), done: msg("Event cancelled.") },
};

/** An event an assistant proposed. Nothing reaches Google (or the guests) until Confirm. */
function CalendarDraftCard({ d }: { d: CalendarDraft }) {
  const t = useT();
  const qc = useQueryClient();
  const look = CAL_LOOK[d.action];
  const refresh = () => { qc.invalidateQueries({ queryKey: assistantKeys.allCalendar }); qc.invalidateQueries({ queryKey: assistantKeys.home }); };
  const confirm = useMutation({
    mutationFn: () => api<CalendarDraft>(`/api/calendar-drafts/${d.id}/confirm`, "POST"),
    onSuccess: () => { refresh(); toast.success(t(look.done) + (d.notify ? ` ${t("Guests were told.")}` : "")); },
    onError: (e) => { refresh(); toast.error(errorMessage(e)); },
  });
  const discard = useMutation({
    mutationFn: () => api(`/api/calendar-drafts/${d.id}/discard`, "POST"),
    onSuccess: () => { refresh(); toast.success(t("Discarded. Nothing changed in your calendar.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card>
      <CardHeader icon={<IconTile icon={look.icon} tone={look.tone} size="sm" />}
        title={<span className="break-words">{t(look.verb)}: {d.title}</span>}
        description={[d.agent_name ? t("Proposed by {name}", { name: d.agent_name }) : null, timeAgo(d.created_at)].filter(Boolean).join(" · ")}
        actions={<Pill tone="warn">{t("Waiting for you")}</Pill>} />
      <CardBody className="grid gap-3">
        <p className="text-[13.5px] break-words">{d.summary}</p>
        {d.attendees.length || d.meet ? (
          <div className="flex flex-wrap gap-1.5">
            {d.attendees.map((a) => <span key={a} className="max-w-full truncate rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted">{a}</span>)}
            {d.meet ? <Pill tone="info"><VideoCameraIcon size={12} /> Google Meet</Pill> : null}
          </div>
        ) : null}
        {d.notify ? <p className="text-[12px] text-muted">{d.action === "create" ? t("Guests get an invitation only when you confirm.") : t("Guests get an update only when you confirm.")}</p> : null}
        <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
          <Button variant={d.action === "cancel" ? "danger" : "primary"} loading={confirm.isPending} onClick={() => confirm.mutate()}>
            <CalendarCheckIcon size={15} /> {t(look.confirm)}
          </Button>
          <Button variant="ghost" loading={discard.isPending} onClick={() => discard.mutate()}><TrashIcon size={14} /> {t("Discard")}</Button>
        </div>
        {d.error ? <p className="text-[12.5px] text-danger">{d.error}</p> : null}
      </CardBody>
    </Card>
  );
}

const HANDLED: Record<string, string> = { sent: msg("Sent"), done: msg("Done"), discarded: msg("Discarded"), failed: msg("Failed"), cancelled: msg("Cancelled") };

function Drafts({ home }: { home: AssistantsHome }) {
  const t = useT();
  const { data: pending = [], isLoading } = useQuery(draftsQuery("pending"));
  const { data: events = [], isLoading: loadingEvents } = useQuery(calendarDraftsQuery("pending"));
  const [history, setHistory] = useState(false);
  const { data: all = [] } = useQuery({ ...draftsQuery("all"), enabled: history });
  const { data: allEvents = [] } = useQuery({ ...calendarDraftsQuery("all"), enabled: history });
  if (!home.google.account && !events.length) {
    return <EmptyState icon={EnvelopeSimpleIcon} title={t("Google isn't connected")} body={t("Connect it in Settings and your assistants can read your inbox and calendar, draft replies and propose events. Nothing is sent or added until you approve it here.")} />;
  }
  const done = [
    ...all.filter((d) => d.status !== "pending").map((d) => ({ id: d.id, icon: EnvelopeSimpleIcon, status: d.status, ok: d.status === "sent", text: `${d.subject} → ${d.to}`, at: d.decided_at ?? d.created_at })),
    ...allEvents.filter((d) => d.status !== "pending").map((d) => ({ id: d.id, icon: CAL_LOOK[d.action].icon, status: d.status, ok: d.status === "done", text: `${t(CAL_LOOK[d.action].verb)}: ${d.title}`, at: d.decided_at ?? d.created_at })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="grid gap-3">
      {isLoading || loadingEvents ? <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        : !pending.length && !events.length ? <EmptyState icon={CheckCircleIcon} title={t("Nothing waiting")} body={t("When an assistant drafts an email or proposes a calendar event, it appears here and on your phone. You review it, then send or confirm.")} />
        : (
          <>
            {events.map((d) => <CalendarDraftCard key={d.id} d={d} />)}
            {pending.map((d) => <DraftCard key={d.id} d={d} />)}
          </>
        )}
      <button type="button" onClick={() => setHistory((h) => !h)} className="w-fit text-[12.5px] text-muted hover:text-fg">{history ? t("Hide handled") : t("Show handled")}</button>
      {history ? (
        <ul className="grid gap-1.5">
          {done.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-sm border border-border px-3 py-2 text-[12.5px]">
              <d.icon size={14} className="shrink-0 text-muted" />
              <Pill tone={d.ok ? "ok" : d.status === "failed" ? "danger" : "neutral"}>{HANDLED[d.status] ? t(HANDLED[d.status]!) : d.status}</Pill>
              <span className="min-w-0 flex-1 truncate">{d.text}</span>
              <span className="text-muted">{timeAgo(d.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- settings and connections

const pretty = (n: string | null) => (n ? `+${n.replace(/^(\d{2})(\d{2})(\d{3,4})(\d{4})$/, "$1 $2-$3 $4")}` : "");

/** Link my own WhatsApp to the office number, right here: a code, a wa.me link, and a wait. */
function LinkWhatsApp({ home }: { home: AssistantsHome }) {
  const t = useT();
  const qc = useQueryClient();
  const [code, setCode] = useState<{ code: string; url: string | null; expires_in: number } | null>(null);
  const get = useMutation({
    mutationFn: () => api<{ code: string; url: string | null; expires_in: number }>(`/api/channels/${home.whatsapp.channel_id}/link-code`, "POST"),
    onSuccess: setCode,
    onError: (e) => toast.error(errorMessage(e)),
  });
  // While a code is out, look every few seconds for the link to land.
  useEffect(() => {
    if (!code || home.whatsapp.linked) return;
    const poll = setInterval(() => qc.invalidateQueries({ queryKey: assistantKeys.home }), 4000);
    const stop = setTimeout(() => clearInterval(poll), code.expires_in * 1000);
    return () => { clearInterval(poll); clearTimeout(stop); };
  }, [code, home.whatsapp.linked, qc]);
  const wasLinked = useRef(home.whatsapp.linked);
  useEffect(() => {
    if (home.whatsapp.linked && !wasLinked.current) toast.success(t("WhatsApp linked. Notices and your assistant are on WhatsApp now."));
    wasLinked.current = home.whatsapp.linked;
  }, [home.whatsapp.linked, t]);
  if (home.whatsapp.linked) return <Pill tone="ok"><CheckCircleIcon size={12} weight="fill" /> {t("Linked")}</Pill>;
  if (home.whatsapp.status !== "WORKING") return <Button size="sm" variant="outline" asChild><Link to="/channels">{t("Open Channels")}</Link></Button>;
  if (!code) return <Button size="sm" loading={get.isPending} onClick={() => get.mutate()}>{t("Link my WhatsApp")}</Button>;
  return (
    <div className="grid w-full gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 p-3">
      <p className="text-[12.5px]"><Trans text={t("From your phone, send this to {number}:")} values={{ number: <b>{pretty(home.whatsapp.number)}</b> }} /></p>
      <p className="rounded-sm bg-surface px-3 py-2 text-center font-mono text-[18px] font-semibold tracking-[0.15em] select-all">LINK {code.code}</p>
      {code.url ? <Button size="sm" asChild><a href={code.url} target="_blank" rel="noreferrer"><WhatsappLogoIcon size={15} /> {t("Open WhatsApp")}</a></Button> : null}
      <p className="text-[11.5px] text-muted"><Trans text={t("Is {number} your own phone? Then open WhatsApp, tap {button} and send it there. You can chat with your assistant in that chat; messages to yourself don't ring, so for alerts link a different number.")} values={{ number: pretty(home.whatsapp.number), button: <b>{t("Message yourself")}</b> }} /></p>
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className="size-1.5 animate-pulse rounded-full bg-accent" /> {t("Waiting for your message… (code valid 10 minutes)")}</p>
    </div>
  );
}

function Connections({ home }: { home: AssistantsHome }) {
  const t = useT();
  const qc = useQueryClient();
  const [unlinking, setUnlinking] = useState(false);
  const g = home.google;
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/api/integrations/google/connect", "POST"),
    onSuccess: (r) => { window.location.href = r.url; },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const disconnect = useMutation({
    mutationFn: () => api("/api/integrations/google/account", "DELETE"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(t("Google disconnected.")); },
  });
  const row = (icon: Icon, tone: Tone, title: string, status: React.ReactNode, action: React.ReactNode) => (
    // The card is narrow at every size: the action sits under the text, never squeezing it.
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-4 py-3">
      <IconTile icon={icon} tone={tone} size="sm" />
      <span className="min-w-0"><span className="block text-[13.5px] font-medium">{title}</span><span className="block text-[12px] break-words text-muted">{status}</span></span>
      {action ? <span className="col-start-2 flex min-w-0 flex-wrap gap-2">{action}</span> : null}
    </li>
  );
  return (
    <Card data-guide="assistants.connections">
      <CardHeader title={t("Connections")} description={t("What your assistants can reach on your behalf.")} />
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
        {row(EnvelopeSimpleIcon, "info", "Gmail",
          g.account ? (g.account.status === "error" ? <span className="text-danger">{g.account.last_error}</span> : t("Connected as {email}. Drafts only; you send.", { email: g.account.email }))
            : g.configured ? t("Read your inbox and draft replies. Free.") : g.can_configure ? t("Set up Google sign-in first (Channels > Gmail).") : t("Ask an admin to set up Google sign-in."),
          g.account ? (
            <>
              {g.account.status === "error" ? <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending}>{t("Reconnect")}</Button> : <Pill tone="ok"><CheckCircleIcon size={12} weight="fill" /> {t("Connected")}</Pill>}
              <Button size="sm" variant="ghost" onClick={() => setUnlinking(true)}>{t("Disconnect")}</Button>
            </>
          ) : g.configured ? <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>{t("Connect Google")}</Button>
            : g.can_configure ? <Button size="sm" variant="outline" asChild><Link to="/channels">{t("Set up")}</Link></Button> : null)}
        {row(CalendarBlankIcon, "accent", t("Calendar"),
          g.account?.calendar ? t("Your Google Calendar. Assistants read it and find free time; events they propose wait for you.")
            : g.account ? t("Connected before calendar access was added. Reconnect Google and tick the calendar box.")
            : t("Connect Google above to add your calendar."),
          g.account?.calendar ? <Pill tone="ok"><CheckCircleIcon size={12} weight="fill" /> {t("Connected")}</Pill>
            : g.account ? <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}><CalendarPlusIcon size={14} /> {t("Reconnect Google to add Calendar")}</Button>
            : null)}
        {row(WhatsappLogoIcon, "ok", "WhatsApp",
          !home.whatsapp.channel_id ? t("Not set up for the office yet.")
            : home.whatsapp.status !== "WORKING" ? t("The office number is not connected ({status}). An admin reconnects it on Channels.", { status: (home.whatsapp.status ?? "unknown").toLowerCase().replace(/_/g, " ") })
            : home.whatsapp.linked ? t("Office number {number} connected, and your phone is linked: notices, drafts and chat reach you there.", { number: pretty(home.whatsapp.number) })
            : <Trans text={t("Office number {number} is connected. Link {your} number to get notices and chat with your assistant.")} values={{ number: pretty(home.whatsapp.number), your: <b>{t("your")}</b> }} />,
          home.whatsapp.channel_id ? <LinkWhatsApp home={home} /> : <Button size="sm" variant="outline" asChild><Link to="/channels">{t("Set up")}</Link></Button>)}
        {row(ChatCircleDotsIcon, "neutral", t("Where you get notices"),
          home.reach.length ? home.reach.map((r) => (r === "app" ? t("this app") : r === "whatsapp" ? "WhatsApp" : "Telegram")).join(", ") : t("Nowhere yet: turn on phone notifications or link WhatsApp."),
          null)}
      </ul>
      <ConfirmDialog open={unlinking} onOpenChange={setUnlinking} title={t("Disconnect Google?")} confirmLabel={t("Disconnect")}
        body={t("Your assistants stop reading your email and calendar. Drafts already in Gmail stay there.")} onConfirm={async () => { await disconnect.mutateAsync(); }} />
    </Card>
  );
}

const TOOL_GROUPS: { label: string; hint: string; tools: string[]; on?: Record<string, string> }[] = [
  { label: msg("Company reports"), hint: msg("Pulse, team performance, where things slip"), tools: ["company_pulse", "team_performance", "slacking_report"] },
  { label: msg("Email"), hint: msg("Read your Gmail and draft replies (you send)"), tools: ["email_search", "email_read", "email_draft_reply", "email_draft"] },
  { label: msg("Calendar"), hint: msg("Read your calendar, find free time, propose events (you confirm)"), tools: ["calendar_agenda", "calendar_free_slots", "calendar_create_event", "calendar_update_event", "calendar_cancel_event"] },
  { label: msg("Reach people and agents"), hint: msg("WhatsApp/app messages, jobs for other agents"), tools: ["notify_person", "message_agent"] },
  // Asking in chat is the OK; from anywhere else a schedule waits for your approval ("ask").
  { label: msg("Schedules"), hint: msg("Set up recurring or one-off jobs when you ask"), tools: ["schedule_task", "list_my_schedules", "cancel_schedule"], on: { schedule_task: "ask" } },
];

function Settings({ agent, home }: { agent: Agent; home: AssistantsHome }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState(agent.name);
  const [soul, setSoul] = useState(agent.soul);
  const [group, setGroup] = useState(agent.model_group);
  const [tools, setTools] = useState<Record<string, string>>(agent.tools);
  const [retiring, setRetiring] = useState(false);
  const dirty = name !== agent.name || soul !== agent.soul || group !== agent.model_group || JSON.stringify(tools) !== JSON.stringify(agent.tools);
  const save = useMutation({
    mutationFn: () => api<Agent>(`/api/agents/${agent.id}`, "PATCH", { name, soul, model_group: group, tools }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(t("Saved.")); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retire = useMutation({
    mutationFn: () => api(`/api/agents/${agent.id}`, "PATCH", { status: "retired" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(t("{name} retired.", { name: agent.name })); },
  });
  const on = (g: string[]) => g.every((k) => (tools[k] ?? "allow") !== "deny");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Card>
        <CardHeader title={t("Your assistant")} description={t("Only you see it, and what you discuss.")} />
        <CardBody className="grid gap-4">
          <Field label={t("Name")} value={name} onChange={(e) => setName(e.target.value)} />
          <TextareaField label={t("How it works for you")} rows={9} value={soul} onChange={(e) => setSoul(e.target.value)} hint={t("Its instructions, in plain words. Add how you like things done.")} />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">{t("Thinking")}</span>
            <Select value={group} onValueChange={setGroup} label={t("Model group")} options={[{ value: "smart", label: t("Smart (best answers)") }, { value: "fast", label: t("Fast (cheaper)") }, { value: "reasoning", label: t("Reasoning (deep analysis)") }]} />
          </div>
          <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
            {TOOL_GROUPS.map((g) => (
              <SwitchField key={g.label} checked={on(g.tools)} label={t(g.label)} hint={t(g.hint)}
                onCheckedChange={(v) => setTools((cur) => ({ ...cur, ...Object.fromEntries(g.tools.map((x) => [x, v ? g.on?.[x] ?? "allow" : "deny"])) }))} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button>
            <Button variant="ghost" className="hover:text-danger" onClick={() => setRetiring(true)}><TrashIcon size={14} /> {t("Retire")}</Button>
          </div>
        </CardBody>
      </Card>
      <Connections home={home} />
      <ConfirmDialog open={retiring} onOpenChange={setRetiring} title={t("Retire {name}?", { name: agent.name })} danger confirmLabel={t("Retire")}
        body={t("It stops working for you. Your conversations stay in the records.")} onConfirm={async () => { await retire.mutateAsync(); }} />
    </div>
  );
}

// ---------------------------------------------------------------- the page

export function AssistantsPage() {
  const t = useT();
  const search = useSearch({ from: "/app/assistants" });
  const navigate = useNavigate({ from: "/assistants" });
  const qc = useQueryClient();
  const { data: home, isLoading, error } = useQuery(assistantsQuery);
  const [creating, setCreating] = useState<Preset["key"] | null>(null);
  const tab: Tab = search.tab ?? "chat";
  const list = useMemo(() => home?.assistants ?? [], [home]);
  const agent = useMemo(() => list.find((a) => a.id === search.a) ?? list[0], [list, search.a]);
  const waiting = (home?.drafts_pending ?? 0) + (home?.calendar_pending ?? 0);
  const go = (p: { a?: string; tab?: Tab }) => navigate({ search: (s) => ({ ...s, ...p, google: undefined, msg: undefined }), replace: true });
  const viewTabs = (
    <Segmented<Tab> label={t("View")} value={tab} onChange={(v) => go({ tab: v })} className="w-full sm:w-fit lg:w-full [&>button]:flex-1 [&>button]:justify-center"
      options={[
        { value: "chat", label: t("Chat") },
        { value: "drafts", label: t("Drafts"), ...(waiting ? { count: waiting } : {}) },
        { value: "settings", label: t("Settings") },
      ]} />
  );

  // Back from Google sign-in.
  useEffect(() => {
    if (!search.google) return;
    if (search.google === "connected") toast.success(search.msg ? t("Google connected: {detail}.", { detail: search.msg }) : t("Google connected."));
    else toast.error(search.msg || t("Google sign-in failed."));
    qc.invalidateQueries({ queryKey: assistantKeys.home });
    navigate({ search: (s) => ({ ...s, google: undefined, msg: undefined, tab: "settings" }), replace: true });
  }, [search.google, search.msg, navigate, qc, t]);

  return (
    // Phones in the chat: tighter page padding, so the conversation reaches down to the tab bar.
    <Page wide className={list.length && tab === "chat" ? "max-md:pt-3 max-md:pb-2" : undefined}>
      {/* On phones with assistants, the chat gets the screen: its own header names the assistant. */}
      <div className={list.length ? "max-md:hidden" : undefined}>
        <PageHeader title={t("My assistants")}
          description={t("Your own private AI assistants: they know the whole company, read your inbox, and chase people for you.")}
          actions={list.length ? <Button onClick={() => setCreating("chief_of_staff")}><PlusIcon size={16} weight="bold" /> {t("New assistant")}</Button> : null} />
      </div>
      {isLoading ? <Skeleton className="h-[60dvh] rounded-[var(--radius-lg)]" />
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !home || !agent ? (
          home ? <Welcome presets={home.presets} onPick={(k) => setCreating(k)} /> : null
        ) : (
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            {/* assistants: a rail on desktop, chips on phones */}
            <aside className="min-w-0">
              {/* Wide screens: the view tabs head the side rail, so the chat starts higher and runs taller. */}
              <div className="mb-3 max-lg:hidden">{viewTabs}</div>
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:grid lg:overflow-visible lg:px-0">
                {list.map((a) => {
                  const on = a.id === agent.id;
                  return (
                    <button key={a.id} type="button" onClick={() => go({ a: a.id })}
                      className={cn("flex shrink-0 items-center gap-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-left transition-colors lg:w-full",
                        on ? "border-accent bg-accent-soft/60" : "border-border bg-surface hover:border-accent/40")}>
                      <AgentAvatar name={a.name} color={a.color} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold">{a.name}</span>
                        <span className="block truncate text-[11.5px] text-muted max-lg:hidden">{a.role}</span>
                      </span>
                    </button>
                  );
                })}
                <button type="button" onClick={() => setCreating("custom")}
                  className="flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border px-3 py-2 text-[13px] text-muted hover:border-accent/50 hover:text-fg lg:w-full">
                  <PlusIcon size={15} /> {t("Add")}
                </button>
              </div>
              <div data-guide="assistants.connections" className="mt-4 hidden gap-2 lg:grid">
                <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase">{t("Connected")}</p>
                <span className="flex min-w-0 items-center gap-2 text-[12.5px]"><EnvelopeSimpleIcon size={15} className={cn("shrink-0", home.google.account ? "text-ok" : "text-muted")} /> <span className="truncate">{home.google.account ? home.google.account.email : t("Gmail not connected")}</span></span>
                {home.google.account ? (
                  home.google.account.calendar ? <span className="flex items-center gap-2 text-[12.5px]"><CalendarBlankIcon size={15} className="text-ok" /> {t("Calendar connected")}</span>
                    : <button type="button" onClick={() => go({ tab: "settings" })} className="flex items-center gap-2 text-left text-[12.5px] text-warn hover:underline"><CalendarBlankIcon size={15} /> {t("Add your calendar →")}</button>
                ) : null}
                <span className="flex items-center gap-2 text-[12.5px]">
                  <WhatsappLogoIcon size={15} className={home.whatsapp.status === "WORKING" ? "text-ok" : "text-muted"} />
                  {!home.whatsapp.channel_id ? t("WhatsApp not set up") : home.whatsapp.status === "WORKING" ? t("Office {number}", { number: pretty(home.whatsapp.number) }) : t("Office WhatsApp offline")}
                </span>
                {home.whatsapp.status === "WORKING" ? (
                  <button type="button" onClick={() => go({ tab: "settings" })} className={cn("flex items-center gap-2 pl-[23px] text-left text-[12px]", home.whatsapp.linked ? "text-ok" : "text-warn hover:underline")}>
                    {home.whatsapp.linked ? t("Your phone is linked") : t("Link your phone →")}
                  </button>
                ) : null}
                {waiting ? <button type="button" onClick={() => go({ tab: "drafts" })} className="flex items-center gap-2 text-left text-[12.5px] font-medium text-warn"><WarningCircleIcon size={15} weight="fill" /> {t("{n} waiting for you", { n: waiting })}</button> : null}
              </div>
            </aside>

            <div className="grid min-w-0 content-start gap-3">
              <div className="lg:hidden">{viewTabs}</div>
              {tab === "chat" ? <Chat key={agent.id} agent={agent} home={home} onDrafts={() => go({ tab: "drafts" })} />
                : tab === "drafts" ? <Drafts home={home} />
                : <Settings key={agent.id + agent.soul.length} agent={agent} home={home} />}
            </div>
          </div>
        )}
      {creating && home ? <NewAssistant presets={home.presets} onClose={() => setCreating(null)} onCreated={(a) => { setCreating(null); go({ a: a.id, tab: "chat" }); }} /> : null}
    </Page>
  );
}

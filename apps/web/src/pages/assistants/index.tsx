/** My assistants (P16): a person's own private AI assistants. Chat with them about the whole
 * company, let them read Gmail and draft replies (sent only when approved here), and have them
 * chase people and other agents on WhatsApp. Built phone-first. */
import {
  ArrowRightIcon, ChartLineUpIcon, CheckCircleIcon, ChatCircleDotsIcon, EnvelopeSimpleIcon, GearSixIcon, LightningIcon,
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
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { api, errorMessage } from "@/lib/api";
import { assistantKeys, assistantsQuery, draftsQuery, QUICK_PROMPTS, type AssistantsHome, type EmailDraft, type Preset } from "@/lib/assistants";
import { cn, timeAgo } from "@/lib/utils";
import { workKeys, type Agent } from "@/lib/work";

type Tab = "chat" | "drafts" | "settings";

const PRESET_LOOK: Record<Preset["key"], { icon: Icon; tone: Tone; can: string[] }> = {
  chief_of_staff: { icon: SparkleIcon, tone: "accent", can: ["Daily company pulse", "Who's slipping", "Chase people & agents", "Your inbox"] },
  inbox: { icon: EnvelopeSimpleIcon, tone: "info", can: ["Reads Gmail", "What needs you today", "Drafts replies to approve"] },
  analyst: { icon: ChartLineUpIcon, tone: "violet", can: ["Team performance", "Trends & tables", "Three actions"] },
  custom: { icon: GearSixIcon, tone: "orange", can: ["Your own instructions"] },
};

/** What each tool looks like under a reply. */
const TOOL_LOOK: Record<string, { label: string; icon: Icon }> = {
  company_pulse: { label: "Company pulse", icon: ChartLineUpIcon },
  team_performance: { label: "Team performance", icon: UsersThreeIcon },
  slacking_report: { label: "Where things slip", icon: TrendDownIcon },
  notify_person: { label: "Messaged a person", icon: WhatsappLogoIcon },
  message_agent: { label: "Gave an agent a job", icon: LightningIcon },
  email_search: { label: "Searched email", icon: MagnifyingGlassIcon },
  email_read: { label: "Read an email", icon: EnvelopeSimpleIcon },
  email_draft_reply: { label: "Drafted a reply", icon: PaperPlaneRightIcon },
  email_draft: { label: "Drafted an email", icon: PaperPlaneRightIcon },
};

/** While the assistant works: what it is probably doing, from what was asked. */
function thinkingLine(q: string): string {
  const s = q.toLowerCase();
  if (/inbox|email|mail|reply|draft/.test(s)) return "Going through your email…";
  if (/slack|stuck|late|behind|slip/.test(s)) return "Looking for what's stuck…";
  if (/who|staff|team|perform|doing well/.test(s)) return "Checking how everyone is doing…";
  if (/tell|remind|chase|notify|whatsapp/.test(s)) return "Reaching out…";
  return "Looking at the company…";
}

// ---------------------------------------------------------------- creating

function NewAssistant({ presets, onClose, onCreated }: { presets: Preset[]; onClose: () => void; onCreated: (a: Agent) => void }) {
  const qc = useQueryClient();
  const [key, setKey] = useState<Preset["key"]>("chief_of_staff");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const create = useMutation({
    mutationFn: () => api<Agent>("/api/assistants", "POST", { preset: key, name: name.trim() || undefined, instructions: notes.trim() || undefined }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(`${a.name} is ready.`); onCreated(a); },
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title="New assistant" className="w-[min(96vw,40rem)]"
      description="Private to you: nobody else sees it or what you discuss."
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}><SparkleIcon size={15} /> Create</Button></>}>
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
        <Field label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder={presets.find((p) => p.key === key)?.name} />
        <TextareaField label="Anything it should know about you (optional)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Reply in Bahasa Melayu to government clients. My weekly meeting is Monday 9am. Flag anything about cash flow first." />
        <FormError message={create.error ? errorMessage(create.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function Welcome({ presets, onPick }: { presets: Preset[]; onPick: (k: Preset["key"]) => void }) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: (preset: string) => api<Agent>("/api/assistants", "POST", { preset }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(`${a.name} is ready. Say hello.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="grid gap-5">
      <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface p-5 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-[radial-gradient(circle,var(--accent-soft),transparent_70%)]" />
        <div className="relative grid max-w-2xl gap-3">
          <Pill tone="accent" className="w-fit"><LockSimpleIcon size={12} /> Private to you</Pill>
          <h2 className="text-[22px] leading-tight font-semibold tracking-tight sm:text-[28px]">An assistant that knows the whole company, and your inbox.</h2>
          <p className="text-[14px] text-muted">Ask what's happening, where you're slipping and who needs a push. It reads your Gmail and drafts replies you approve, and it chases your staff's agents, who message their people on WhatsApp.</p>
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
                  {look.can.map((c) => <li key={c} className="flex items-center gap-1.5"><CheckCircleIcon size={14} weight="fill" className="text-ok" /> {c}</li>)}
                </ul>
                <div className="mt-auto flex gap-2 pt-1">
                  <Button className="flex-1" loading={create.isPending && create.variables === p.key} onClick={() => create.mutate(p.key)}>Create</Button>
                  <Button variant="ghost" onClick={() => onPick(p.key)}>Customise</Button>
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

function Chat({ agent, home, onDrafts }: { agent: Agent; home: AssistantsHome; onDrafts: () => void }) {
  const qc = useQueryClient();
  const reduce = useReducedMotion();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [picked, setPicked] = useState(false);
  const [draft, setDraft] = useState("");
  const [local, setLocal] = useState<Msg[]>([]);
  const [asked, setAsked] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const sessions = useQuery({
    queryKey: workKeys.sessions(agent.id),
    queryFn: () => api<{ id: string; title: string; updated_at: string }[]>(`/api/agents/${agent.id}/sessions`),
  });
  // Pick up the latest conversation (web ones; WhatsApp chats have their own).
  const latest = (sessions.data ?? []).find((s) => !s.title.startsWith("WhatsApp") && !s.title.startsWith("Telegram"));
  const current = picked ? sessionId : sessionId ?? latest?.id ?? null;
  const history = useQuery({
    queryKey: workKeys.messages(current ?? "none"),
    queryFn: () => api<Msg[]>(`/api/chat/sessions/${current}/messages`),
    enabled: !!current,
  });
  const messages = [...(current ? history.data ?? [] : []), ...local];

  const send = useMutation({
    mutationFn: (text: string) =>
      api<{ session_id: string; reply: string; tools_used: string[] }>(`/api/agents/${agent.id}/chat`, "POST", { message: text, session_id: current }),
    onMutate: (text) => { setAsked(text); setLocal((l) => [...l, { id: `u${Date.now()}`, role: "user", content: text }]); },
    onSuccess: async (r) => {
      setSessionId(r.session_id);
      setPicked(true);
      await qc.invalidateQueries({ queryKey: workKeys.messages(r.session_id) });
      qc.invalidateQueries({ queryKey: workKeys.sessions(agent.id) });
      if (r.tools_used.some((t) => t.startsWith("email_draft"))) {
        qc.invalidateQueries({ queryKey: assistantKeys.allDrafts });
        qc.invalidateQueries({ queryKey: assistantKeys.home });
      }
      setLocal([]);
    },
    onError: (e) => { toast.error(errorMessage(e)); setLocal((l) => l.slice(0, -1)); },
  });

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : "smooth" });
  }, [messages.length, send.isPending, reduce]);

  const submit = (text = draft) => {
    const t = text.trim();
    if (!t || send.isPending) return;
    setDraft("");
    send.mutate(t);
  };
  const gmail = !!home.google.account;
  const prompts = QUICK_PROMPTS.filter((p) => !p.needs || gmail);

  return (
    // Exactly the screen that is left: app header, page title (desktop), tabs, tab bar (phones).
    <div className="flex h-[calc(100dvh-18.5rem-env(safe-area-inset-bottom))] min-h-[24rem] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface md:h-[calc(100dvh-18rem)] lg:h-[calc(100dvh-17.5rem)]">
      <div className="flex items-center gap-3 border-b border-border px-3 py-2.5 sm:px-4">
        <AgentAvatar name={agent.name} color={agent.color} size="sm" working={send.isPending} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{agent.name}</p>
          <p className="truncate text-[11.5px] text-muted">{send.isPending ? thinkingLine(asked) : agent.role}</p>
        </div>
        {home.drafts_pending ? (
          <Button size="sm" variant="outline" onClick={onDrafts}><EnvelopeSimpleIcon size={14} /> {home.drafts_pending} to approve</Button>
        ) : null}
        {current ? (
          <Button size="sm" variant="ghost" onClick={() => { setLocal([]); setSessionId(null); setPicked(true); }} aria-label="New conversation"><PlusIcon size={15} /><span className="max-sm:hidden">New</span></Button>
        ) : null}
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" aria-live="polite">
        {!messages.length && !send.isPending ? (
          <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-4 py-6 text-center">
            <AgentAvatar name={agent.name} color={agent.color} size="lg" />
            <div>
              <p className="text-[17px] font-semibold">Hi, I'm {agent.name}.</p>
              <p className="mt-1 text-[13px] text-muted">Ask me about the company, your team or your inbox. Try one of these:</p>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
              {prompts.slice(0, 6).map((p) => (
                <button key={p.label} type="button" onClick={() => (p.prompt.includes("<") ? (setDraft(p.prompt), box.current?.focus()) : submit(p.prompt))}
                  className="group flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3.5 py-3 text-left text-[13px] transition-colors hover:border-accent/50 hover:bg-accent-soft/40">
                  <span className="font-medium">{p.label}</span>
                  <ArrowRightIcon size={14} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
                </button>
              ))}
            </div>
            {!gmail ? <p className="text-[12px] text-muted">Connect Gmail in Settings and I can read your inbox too.</p> : null}
          </div>
        ) : null}
        <ol className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-5">
          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.li key={m.id} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex gap-2.5", m.role === "user" && "justify-end")}>
                {m.role === "assistant" ? <AgentAvatar name={agent.name} color={agent.color} size="sm" className="mt-0.5 shrink-0 max-sm:hidden" /> : null}
                <div className={cn("min-w-0", m.role === "user" ? "max-w-[85%]" : "max-w-full flex-1")}>
                  {m.role === "user" ? (
                    <div className="rounded-[var(--radius-lg)] rounded-br-sm bg-accent px-3.5 py-2.5 text-[14px] whitespace-pre-wrap text-accent-fg">{m.content}</div>
                  ) : (
                    <div className="min-w-0 overflow-x-auto rounded-[var(--radius-lg)] rounded-tl-sm bg-surface-2/70 px-4 py-3">
                      <Markdown className="text-[14px] [&_table]:text-[12.5px]">{m.content}</Markdown>
                    </div>
                  )}
                  {m.role === "assistant" && m.meta?.tools?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {[...new Set(m.meta.tools)].map((t) => {
                        const look = TOOL_LOOK[t];
                        const IconCmp = look?.icon ?? LightningIcon;
                        return (
                          <span key={t} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-muted">
                            <IconCmp size={11} /> {look?.label ?? t.replace(/_/g, " ")}
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

      {messages.length ? (
        <div className="flex gap-1.5 overflow-x-auto border-t border-border px-3 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {prompts.map((p) => (
            <button key={p.label} type="button" disabled={send.isPending}
              onClick={() => (p.prompt.includes("<") ? (setDraft(p.prompt), box.current?.focus()) : submit(p.prompt))}
              className="h-8 shrink-0 rounded-full border border-border px-3 text-[12px] whitespace-nowrap text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50">
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      <form className="flex items-end gap-2 p-2.5 sm:p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label htmlFor={`as-${agent.id}`} className="sr-only">Message {agent.name}</label>
        <textarea ref={box} id={`as-${agent.id}`} value={draft} rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          disabled={agent.status !== "active"}
          placeholder={agent.status !== "active" ? `${agent.name} is ${agent.status}` : `Ask ${agent.name} anything…`}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-bg px-3.5 py-2.5 text-[14px] [field-sizing:content] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none disabled:opacity-60" />
        <Button type="submit" size="icon" className="size-11 rounded-full" disabled={!draft.trim() || send.isPending} aria-label="Send">
          <PaperPlaneRightIcon size={18} weight="fill" />
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- drafts

function DraftCard({ d }: { d: EmailDraft }) {
  const qc = useQueryClient();
  const [body, setBody] = useState(d.body);
  const [subject, setSubject] = useState(d.subject);
  const [discarding, setDiscarding] = useState(false);
  const edited = body !== d.body || subject !== d.subject;
  const refresh = () => { qc.invalidateQueries({ queryKey: assistantKeys.allDrafts }); qc.invalidateQueries({ queryKey: assistantKeys.home }); };
  const save = useMutation({
    mutationFn: () => api<EmailDraft>(`/api/email-drafts/${d.id}`, "PATCH", { body, subject }),
    onSuccess: () => { refresh(); toast.success("Draft updated in Gmail."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (edited) await api(`/api/email-drafts/${d.id}`, "PATCH", { body, subject });
      return api<EmailDraft>(`/api/email-drafts/${d.id}/send`, "POST");
    },
    onSuccess: () => { refresh(); toast.success(`Sent to ${d.to.replace(/<.*>/, "").trim() || d.to}.`); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const discard = useMutation({
    mutationFn: () => api(`/api/email-drafts/${d.id}/discard`, "POST"),
    onSuccess: () => { refresh(); toast.success("Discarded."); },
  });
  return (
    <Card>
      <CardHeader icon={<IconTile icon={EnvelopeSimpleIcon} tone="info" size="sm" />}
        title={<span className="break-words">To {d.to}</span>}
        description={[d.agent_name ? `Drafted by ${d.agent_name}` : null, timeAgo(d.created_at)].filter(Boolean).join(" · ")}
        actions={<Pill tone="warn">Waiting for you</Pill>} />
      <CardBody className="grid gap-3">
        {d.is_reply && d.original_from ? (
          <div className="rounded-[var(--radius-sm)] border-l-2 border-border bg-surface-2/50 px-3 py-2 text-[12.5px] text-muted">
            <p className="font-medium text-fg">In reply to {d.original_from}</p>
            {d.original_snippet ? <p className="mt-0.5 line-clamp-2">{d.original_snippet}</p> : null}
          </div>
        ) : null}
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" className="font-medium" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} aria-label="Email body"
          className="w-full rounded-sm border border-border bg-surface px-3 py-2.5 text-[14px] leading-relaxed [field-sizing:content] focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none" />
        <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
          <Button loading={send.isPending} onClick={() => send.mutate()}><PaperPlaneRightIcon size={15} weight="fill" /> {edited ? "Save and send" : "Send"}</Button>
          {edited ? <Button variant="outline" loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button> : null}
          <Button variant="ghost" className="hover:text-danger" onClick={() => setDiscarding(true)}><TrashIcon size={14} /> Discard</Button>
        </div>
        {d.error ? <p className="text-[12.5px] text-danger">{d.error}</p> : null}
      </CardBody>
      <ConfirmDialog open={discarding} onOpenChange={setDiscarding} title="Discard this draft?" danger confirmLabel="Discard"
        body="It is removed from your Gmail drafts. Nothing was sent." onConfirm={async () => { await discard.mutateAsync(); }} />
    </Card>
  );
}

function Drafts({ home }: { home: AssistantsHome }) {
  const { data: pending = [], isLoading } = useQuery(draftsQuery("pending"));
  const [history, setHistory] = useState(false);
  const { data: all = [] } = useQuery({ ...draftsQuery("all"), enabled: history });
  if (!home.google.account) {
    return <EmptyState icon={EnvelopeSimpleIcon} title="Gmail isn't connected" body="Connect it in Settings and your assistants can read your inbox and draft replies. Nothing is ever sent until you press Send here." />;
  }
  return (
    <div className="grid gap-3">
      {isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" />
        : !pending.length ? <EmptyState icon={CheckCircleIcon} title="Nothing waiting" body="When an assistant drafts an email for you, it appears here and on your phone. You review it, change anything, then send." />
        : pending.map((d) => <DraftCard key={d.id} d={d} />)}
      <button type="button" onClick={() => setHistory((h) => !h)} className="w-fit text-[12.5px] text-muted hover:text-fg">{history ? "Hide" : "Show"} sent and discarded</button>
      {history ? (
        <ul className="grid gap-1.5">
          {all.filter((d) => d.status !== "pending").map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 rounded-sm border border-border px-3 py-2 text-[12.5px]">
              <Pill tone={d.status === "sent" ? "ok" : d.status === "failed" ? "danger" : "neutral"}>{d.status}</Pill>
              <span className="min-w-0 flex-1 truncate">{d.subject} → {d.to}</span>
              <span className="text-muted">{timeAgo(d.decided_at ?? d.created_at)}</span>
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
    const t = setInterval(() => qc.invalidateQueries({ queryKey: assistantKeys.home }), 4000);
    const stop = setTimeout(() => clearInterval(t), code.expires_in * 1000);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [code, home.whatsapp.linked, qc]);
  const wasLinked = useRef(home.whatsapp.linked);
  useEffect(() => {
    if (home.whatsapp.linked && !wasLinked.current) toast.success("WhatsApp linked. Notices and your assistant are on WhatsApp now.");
    wasLinked.current = home.whatsapp.linked;
  }, [home.whatsapp.linked]);
  if (home.whatsapp.linked) return <Pill tone="ok"><CheckCircleIcon size={12} weight="fill" /> Linked</Pill>;
  if (home.whatsapp.status !== "WORKING") return <Button size="sm" variant="outline" asChild><Link to="/channels">Open Channels</Link></Button>;
  if (!code) return <Button size="sm" loading={get.isPending} onClick={() => get.mutate()}>Link my WhatsApp</Button>;
  return (
    <div className="grid w-full gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 p-3">
      <p className="text-[12.5px]">From your phone, send this to <b>{pretty(home.whatsapp.number)}</b>:</p>
      <p className="rounded-sm bg-surface px-3 py-2 text-center font-mono text-[18px] font-semibold tracking-[0.15em] select-all">LINK {code.code}</p>
      {code.url ? <Button size="sm" asChild><a href={code.url} target="_blank" rel="noreferrer"><WhatsappLogoIcon size={15} /> Open WhatsApp</a></Button> : null}
      <p className="text-[11.5px] text-muted">Is {pretty(home.whatsapp.number)} your own phone? Then open WhatsApp, tap <b>Message yourself</b> and send it there. You can chat with your assistant in that chat; messages to yourself don't ring, so for alerts link a different number.</p>
      <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><span className="size-1.5 animate-pulse rounded-full bg-accent" /> Waiting for your message… (code valid 10 minutes)</p>
    </div>
  );
}

function Connections({ home }: { home: AssistantsHome }) {
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success("Gmail disconnected."); },
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
    <Card>
      <CardHeader title="Connections" description="What your assistants can reach on your behalf." />
      <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-border">
        {row(EnvelopeSimpleIcon, "info", "Gmail",
          g.account ? (g.account.status === "error" ? <span className="text-danger">{g.account.last_error}</span> : <>Connected as {g.account.email}. Drafts only; you send.</>)
            : g.configured ? "Read your inbox and draft replies. Free." : g.can_configure ? "Set up Google sign-in first (Channels > Gmail)." : "Ask an admin to set up Google sign-in.",
          g.account ? (
            <>
              {g.account.status === "error" ? <Button size="sm" onClick={() => connect.mutate()} loading={connect.isPending}>Reconnect</Button> : <Pill tone="ok"><CheckCircleIcon size={12} weight="fill" /> Connected</Pill>}
              <Button size="sm" variant="ghost" onClick={() => setUnlinking(true)}>Disconnect</Button>
            </>
          ) : g.configured ? <Button size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>Connect Gmail</Button>
            : g.can_configure ? <Button size="sm" variant="outline" asChild><Link to="/channels">Set up</Link></Button> : null)}
        {row(WhatsappLogoIcon, "ok", "WhatsApp",
          !home.whatsapp.channel_id ? "Not set up for the office yet."
            : home.whatsapp.status !== "WORKING" ? `The office number is not connected (${(home.whatsapp.status ?? "unknown").toLowerCase().replace(/_/g, " ")}). An admin reconnects it on Channels.`
            : home.whatsapp.linked ? <>Office number {pretty(home.whatsapp.number)} connected, and your phone is linked: notices, drafts and chat reach you there.</>
            : <>Office number {pretty(home.whatsapp.number)} is connected. Link <b>your</b> number to get notices and chat with your assistant.</>,
          home.whatsapp.channel_id ? <LinkWhatsApp home={home} /> : <Button size="sm" variant="outline" asChild><Link to="/channels">Set up</Link></Button>)}
        {row(ChatCircleDotsIcon, "neutral", "Where you get notices",
          home.reach.length ? home.reach.map((r) => (r === "app" ? "this app" : r === "whatsapp" ? "WhatsApp" : "Telegram")).join(", ") : "Nowhere yet: turn on phone notifications or link WhatsApp.",
          null)}
      </ul>
      <ConfirmDialog open={unlinking} onOpenChange={setUnlinking} title="Disconnect Gmail?" confirmLabel="Disconnect"
        body="Your assistants stop reading your email. Drafts already in Gmail stay there." onConfirm={async () => { await disconnect.mutateAsync(); }} />
    </Card>
  );
}

const TOOL_GROUPS: { label: string; hint: string; tools: string[] }[] = [
  { label: "Company reports", hint: "Pulse, team performance, where things slip", tools: ["company_pulse", "team_performance", "slacking_report"] },
  { label: "Email", hint: "Read your Gmail and draft replies (you send)", tools: ["email_search", "email_read", "email_draft_reply", "email_draft"] },
  { label: "Reach people and agents", hint: "WhatsApp/app messages, jobs for other agents", tools: ["notify_person", "message_agent"] },
];

function Settings({ agent, home }: { agent: Agent; home: AssistantsHome }) {
  const qc = useQueryClient();
  const [name, setName] = useState(agent.name);
  const [soul, setSoul] = useState(agent.soul);
  const [group, setGroup] = useState(agent.model_group);
  const [tools, setTools] = useState<Record<string, string>>(agent.tools);
  const [retiring, setRetiring] = useState(false);
  const dirty = name !== agent.name || soul !== agent.soul || group !== agent.model_group || JSON.stringify(tools) !== JSON.stringify(agent.tools);
  const save = useMutation({
    mutationFn: () => api<Agent>(`/api/agents/${agent.id}`, "PATCH", { name, soul, model_group: group, tools }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success("Saved."); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const retire = useMutation({
    mutationFn: () => api(`/api/agents/${agent.id}`, "PATCH", { status: "retired" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: assistantKeys.home }); toast.success(`${agent.name} retired.`); },
  });
  const on = (g: string[]) => g.every((t) => (tools[t] ?? "allow") !== "deny");
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Card>
        <CardHeader title="Your assistant" description="Only you see it, and what you discuss." />
        <CardBody className="grid gap-4">
          <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextareaField label="How it works for you" rows={9} value={soul} onChange={(e) => setSoul(e.target.value)} hint="Its instructions, in plain words. Add how you like things done." />
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Thinking</span>
            <Select value={group} onValueChange={setGroup} label="Model group" options={[{ value: "smart", label: "Smart (best answers)" }, { value: "fast", label: "Fast (cheaper)" }, { value: "reasoning", label: "Reasoning (deep analysis)" }]} />
          </div>
          <div className="grid gap-3 rounded-[var(--radius-md)] border border-border p-3">
            {TOOL_GROUPS.map((g) => (
              <SwitchField key={g.label} checked={on(g.tools)} label={g.label} hint={g.hint}
                onCheckedChange={(v) => setTools((t) => ({ ...t, ...Object.fromEntries(g.tools.map((x) => [x, v ? "allow" : "deny"])) }))} />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
            <Button variant="ghost" className="hover:text-danger" onClick={() => setRetiring(true)}><TrashIcon size={14} /> Retire</Button>
          </div>
        </CardBody>
      </Card>
      <Connections home={home} />
      <ConfirmDialog open={retiring} onOpenChange={setRetiring} title={`Retire ${agent.name}?`} danger confirmLabel="Retire"
        body="It stops working for you. Your conversations stay in the records." onConfirm={async () => { await retire.mutateAsync(); }} />
    </div>
  );
}

// ---------------------------------------------------------------- the page

export function AssistantsPage() {
  const search = useSearch({ from: "/app/assistants" });
  const navigate = useNavigate({ from: "/assistants" });
  const qc = useQueryClient();
  const { data: home, isLoading, error } = useQuery(assistantsQuery);
  const [creating, setCreating] = useState<Preset["key"] | null>(null);
  const tab: Tab = search.tab ?? "chat";
  const list = useMemo(() => home?.assistants ?? [], [home]);
  const agent = useMemo(() => list.find((a) => a.id === search.a) ?? list[0], [list, search.a]);
  const go = (p: { a?: string; tab?: Tab }) => navigate({ search: (s) => ({ ...s, ...p, google: undefined, msg: undefined }), replace: true });

  // Back from Google sign-in.
  useEffect(() => {
    if (!search.google) return;
    if (search.google === "connected") toast.success(`Gmail connected${search.msg ? `: ${search.msg}` : ""}.`);
    else toast.error(search.msg || "Google sign-in failed.");
    qc.invalidateQueries({ queryKey: assistantKeys.home });
    navigate({ search: (s) => ({ ...s, google: undefined, msg: undefined, tab: "settings" }), replace: true });
  }, [search.google, search.msg, navigate, qc]);

  return (
    <Page wide>
      {/* On phones with assistants, the chat gets the screen: its own header names the assistant. */}
      <div className={list.length ? "max-md:hidden" : undefined}>
        <PageHeader title="My assistants"
          description="Your own private AI assistants: they know the whole company, read your inbox, and chase people for you."
          actions={list.length ? <Button onClick={() => setCreating("chief_of_staff")}><PlusIcon size={16} weight="bold" /> New assistant</Button> : null} />
      </div>
      {isLoading ? <Skeleton className="h-[60dvh] rounded-[var(--radius-lg)]" />
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : !home || !agent ? (
          home ? <Welcome presets={home.presets} onPick={(k) => setCreating(k)} /> : null
        ) : (
          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            {/* assistants: a rail on desktop, chips on phones */}
            <aside className="min-w-0">
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
                  <PlusIcon size={15} /> Add
                </button>
              </div>
              <div className="mt-4 hidden gap-2 lg:grid">
                <p className="text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase">Connected</p>
                <span className="flex items-center gap-2 text-[12.5px]"><EnvelopeSimpleIcon size={15} className={home.google.account ? "text-ok" : "text-muted"} /> {home.google.account ? home.google.account.email : "Gmail not connected"}</span>
                <span className="flex items-center gap-2 text-[12.5px]">
                  <WhatsappLogoIcon size={15} className={home.whatsapp.status === "WORKING" ? "text-ok" : "text-muted"} />
                  {!home.whatsapp.channel_id ? "WhatsApp not set up" : home.whatsapp.status === "WORKING" ? `Office ${pretty(home.whatsapp.number)}` : "Office WhatsApp offline"}
                </span>
                {home.whatsapp.status === "WORKING" ? (
                  <button type="button" onClick={() => go({ tab: "settings" })} className={cn("flex items-center gap-2 pl-[23px] text-left text-[12px]", home.whatsapp.linked ? "text-ok" : "text-warn hover:underline")}>
                    {home.whatsapp.linked ? "Your phone is linked" : "Link your phone →"}
                  </button>
                ) : null}
                {home.drafts_pending ? <button type="button" onClick={() => go({ tab: "drafts" })} className="flex items-center gap-2 text-left text-[12.5px] font-medium text-warn"><WarningCircleIcon size={15} weight="fill" /> {home.drafts_pending} draft{home.drafts_pending > 1 ? "s" : ""} to approve</button> : null}
              </div>
            </aside>

            <div className="grid min-w-0 content-start gap-3">
              <Segmented<Tab> label="View" value={tab} onChange={(t) => go({ tab: t })} className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center"
                options={[
                  { value: "chat", label: "Chat" },
                  { value: "drafts", label: "Drafts", ...(home.drafts_pending ? { count: home.drafts_pending } : {}) },
                  { value: "settings", label: "Settings" },
                ]} />
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

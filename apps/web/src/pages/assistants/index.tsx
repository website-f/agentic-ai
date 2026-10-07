/** My assistants (P16): a person's own private AI assistants. Chat with them about the whole
 * company, let them read Gmail and draft replies (sent only when approved here), and have them
 * chase people and other agents on WhatsApp. Built phone-first. */
import {
  CalendarBlankIcon, CalendarCheckIcon, CalendarPlusIcon, CalendarXIcon, ChartLineUpIcon, CheckCircleIcon, ChatCircleDotsIcon,
  EnvelopeSimpleIcon, GearSixIcon, VideoCameraIcon, LockSimpleIcon, PaperPlaneRightIcon, PlusIcon, SparkleIcon, TrashIcon,
  WarningCircleIcon, WhatsappLogoIcon, type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { ChatLauncher } from "@/components/chat/chat-launcher";
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
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import {
  assistantKeys, assistantsQuery, calendarDraftsQuery, draftsQuery, type AssistantsHome, type CalendarDraft, type EmailDraft, type Preset,
} from "@/lib/assistants";
import { cn, timeAgo } from "@/lib/utils";
import type { Agent } from "@/lib/work";

import { assistantPrompts } from "./chat-extras";

type Tab = "chat" | "drafts" | "settings";

const PRESET_LOOK: Record<Preset["key"], { icon: Icon; tone: Tone; can: string[] }> = {
  chief_of_staff: { icon: SparkleIcon, tone: "accent", can: [msg("Daily company pulse"), msg("Who's slipping"), msg("Chase people & agents"), msg("Your inbox & calendar")] },
  inbox: { icon: EnvelopeSimpleIcon, tone: "info", can: [msg("Reads Gmail"), msg("What needs you today"), msg("Drafts replies to approve")] },
  analyst: { icon: ChartLineUpIcon, tone: "violet", can: [msg("Team performance"), msg("Trends & tables"), msg("Three actions")] },
  custom: { icon: GearSixIcon, tone: "orange", can: [msg("Your own instructions")] },
};

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
    // The chat itself opens full screen (/chat/$agentId); this page is its home: presets, drafts, settings.
    <Page wide>
      <PageHeader title={t("My assistants")}
        description={t("Your own private AI assistants: they know the whole company, read your inbox, and chase people for you.")}
        actions={list.length ? <Button onClick={() => setCreating("chief_of_staff")}><PlusIcon size={16} weight="bold" /> {t("New assistant")}</Button> : null} />
      {isLoading ? <Skeleton className="h-[60dvh] rounded-[var(--radius-lg)]" />
        : error ? <p role="alert" className="text-danger">{errorMessage(error)}</p>
        : home?.available === false ? (
          // P30: personal assistants are for people who manage others; staff have their twin.
          <EmptyState icon={SparkleIcon} title={t("Not for your role")} body={home.reason ?? t("Personal assistants are for people who manage others.")}
            action={<Button asChild><Link to="/my-worker">{t("Open My AI")}</Link></Button>} />
        ) : !home || !agent ? (
          home ? <Welcome presets={home.presets} onPick={(k) => setCreating(k)} /> : null
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
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

            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3">
              <div className="lg:hidden">{viewTabs}</div>
              {tab === "chat" ? (
                <ChatLauncher key={agent.id} agent={agent} canWrite from={`/assistants?a=${encodeURIComponent(agent.id)}`}
                  quickPrompts={assistantPrompts(home)} guide={{ root: "assistants.chat", quick: "assistants.quick" }}
                  footer={!home.google.account ? <p className="text-[12px] text-muted">{t("Connect Google in Settings and I can read your inbox and calendar too.")}</p>
                    : !home.google.account.calendar ? <p className="text-[12px] text-muted">{t("Reconnect Google in Settings to add your calendar.")}</p> : null} />
              )
                : tab === "drafts" ? <Drafts home={home} />
                : <Settings key={agent.id + agent.soul.length} agent={agent} home={home} />}
            </div>
          </div>
        )}
      {creating && home ? <NewAssistant presets={home.presets} onClose={() => setCreating(null)} onCreated={(a) => { setCreating(null); go({ a: a.id, tab: "chat" }); }} /> : null}
    </Page>
  );
}

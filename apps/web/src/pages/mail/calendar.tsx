/** P109 the person's own Outlook calendar on the Microsoft 365 page: a week (seven columns on
 * a wide screen, an agenda on a phone), an event's detail (join link, guests and their
 * answers, Accept / Maybe / Decline), "Ask AI: prepare me for this meeting" (from related mail),
 * and a new event the person checks and creates ("Plan with AI" fills the form). */
import {
  ArrowSquareOutIcon,
  CalendarBlankIcon,
  CalendarPlusIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckIcon,
  MapPinIcon,
  QuestionIcon,
  SparkleIcon,
  VideoCameraIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/page";
import { PersonAvatar } from "@/components/person-avatar";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, Input, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  addDaysTo,
  allEmails,
  calendarQuery,
  createEvent,
  eventQuery,
  fromLocalInput,
  m365Keys,
  mailDocument,
  respondEvent,
  splitAddresses,
  toLocalInput,
  weekStart,
  type CalEvent,
} from "@/lib/m365";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

import { AiAnswer, useAskAi } from "./ai";
import { MeetingRecord, useMeetingComposer } from "./meeting";

const RESPONSE: Record<string, string> = {
  accepted: msg("Accepted"),
  tentativelyAccepted: msg("Maybe"),
  declined: msg("Declined"),
  organizer: msg("Organiser"),
  notResponded: msg("No answer yet"),
  none: msg("No answer yet"),
};

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "");

export function OutlookCalendar() {
  const t = useT();
  const wide = useMedia("(min-width: 768px)");
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const openMeeting = useMeetingComposer((s) => s.open);
  const end = addDaysTo(anchor, 7);
  const q = useQuery(calendarQuery(anchor.toISOString(), end.toISOString()));
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysTo(anchor, i)), [anchor]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of q.data ?? []) {
      if (!e.start) continue;
      const k = new Date(e.start).toDateString();
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    for (const list of map.values()) list.sort((a, b) => Number(b.all_day) - Number(a.all_day) || (a.start ?? "").localeCompare(b.start ?? ""));
    return map;
  }, [q.data]);
  const today = new Date().toDateString();
  const range = `${anchor.toLocaleDateString(locale(), { day: "numeric", month: "short" })} – ${addDaysTo(anchor, 6).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="outline" aria-label={t("Previous week")} onClick={() => setAnchor((a) => addDaysTo(a, -7))}><CaretLeftIcon size={15} /></Button>
          <Button size="sm" variant="outline" onClick={() => setAnchor(weekStart(new Date()))}>{t("Today")}</Button>
          <Button size="icon-sm" variant="outline" aria-label={t("Next week")} onClick={() => setAnchor((a) => addDaysTo(a, 7))}><CaretRightIcon size={15} /></Button>
        </div>
        <h3 className="min-w-0 flex-1 text-[14.5px] font-semibold tabular">{range}</h3>
        <div className="flex gap-2 max-sm:w-full [&>button]:max-sm:flex-1">
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}><CalendarPlusIcon size={15} /> {t("New event")}</Button>
          {/* P109b: a Teams meeting the AI fills in; Outlook sends the invitations. */}
          <Button size="sm" onClick={() => openMeeting()}><VideoCameraIcon size={15} /> {t("New Teams meeting")}</Button>
        </div>
      </div>
      {q.isLoading ? <Skeleton className="h-72 rounded-[var(--radius-md)]" />
        : q.error ? <p role="alert" className="text-[13.5px] text-danger">{errorMessage(q.error)}</p>
        : wide ? (
          <div className="grid grid-cols-7 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface">
            {days.map((d) => {
              const list = byDay.get(d.toDateString()) ?? [];
              const isToday = d.toDateString() === today;
              return (
                <section key={d.toISOString()} aria-label={d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}
                  className={cn("grid min-h-56 min-w-0 content-start gap-1.5 border-r border-border p-1.5 last:border-r-0", isToday && "bg-accent-soft/30")}>
                  <h4 className="flex items-baseline gap-1.5 px-1 text-[12px] text-muted">
                    <span className="uppercase">{d.toLocaleDateString(locale(), { weekday: "short" })}</span>
                    <span className={cn("text-[15px] font-semibold text-fg tabular", isToday && "grid size-7 place-items-center rounded-full bg-accent text-accent-fg")}>{d.getDate()}</span>
                  </h4>
                  {list.map((e) => <EventChip key={e.id} e={e} onOpen={() => setOpenId(e.id)} />)}
                </section>
              );
            })}
          </div>
        ) : (
          <ol className="grid gap-3">
            {days.filter((d) => (byDay.get(d.toDateString()) ?? []).length || d.toDateString() === today).map((d) => (
              <li key={d.toISOString()} className="grid gap-1.5">
                <h4 className={cn("text-[12.5px] font-semibold text-muted uppercase", d.toDateString() === today && "text-accent")}>
                  {d.toDateString() === today ? t("Today") : d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "short" })}
                </h4>
                {(byDay.get(d.toDateString()) ?? []).length ? (byDay.get(d.toDateString()) ?? []).map((e) => <EventChip key={e.id} e={e} onOpen={() => setOpenId(e.id)} roomy />)
                  : <p className="text-[13px] text-muted">{t("Nothing planned.")}</p>}
              </li>
            ))}
            {!q.data?.length ? <EmptyState icon={CalendarBlankIcon} title={t("A free week")} body={t("Nothing in your Outlook calendar this week.")} /> : null}
          </ol>
        )}
      {openId ? <EventSheet id={openId} onClose={() => setOpenId(null)} /> : null}
      {creating ? <NewEvent onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

function EventChip({ e, onOpen, roomy }: { e: CalEvent; onOpen: () => void; roomy?: boolean }) {
  const t = useT();
  return (
    <button type="button" onClick={onOpen}
      className={cn("grid w-full min-w-0 gap-0.5 rounded-sm border-l-[3px] bg-surface-2 px-2 py-1.5 text-left hover:bg-border/50 focus-visible:ring-3 focus-visible:ring-accent/25 focus-visible:outline-none",
        e.cancelled ? "border-l-muted opacity-60" : e.show_as === "tentative" ? "border-l-info" : "border-l-accent", roomy && "px-3 py-2.5")}>
      <span className="text-[11.5px] text-muted tabular">{e.all_day ? t("All day") : `${hm(e.start)}–${hm(e.end)}`}</span>
      <span className={cn("text-[12.5px] font-medium break-words", roomy && "text-[14px]", e.cancelled && "line-through")}>{e.subject}</span>
      {e.location ? <span className="truncate text-[11.5px] text-muted">{e.location}</span> : null}
      {e.join_url && roomy ? <span className="flex items-center gap-1 text-[11.5px] text-[#4f52b2] dark:text-[#a6a8f0]"><VideoCameraIcon size={12} /> Teams</span> : null}
    </button>
  );
}

function EventSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery(eventQuery(id));
  const [prep, setPrep] = useState<string | null>(null);
  const dark = typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
  const ai = useAskAi((r) => setPrep(r.text ?? ""));
  const answer = useMutation({
    mutationFn: (a: "accept" | "tentative" | "decline") => respondEvent(id, a),
    onSuccess: () => { toast.success(t("Your answer was sent to the organiser.")); void qc.invalidateQueries({ queryKey: m365Keys.all }); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const e = q.data;
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md" title={e?.subject ?? t("Event")}
      description={e ? (e.all_day ? t("All day") : `${new Date(e.start ?? "").toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" })}, ${hm(e.start)}–${hm(e.end)}`) : undefined}
      actions={e ? <>
        {e.join_url ? <Button asChild className="bg-[#5b5fc7] text-white"><a href={e.join_url} target="_blank" rel="noreferrer noopener"><VideoCameraIcon size={15} /> {t("Join Teams meeting")}</a></Button> : null}
        <Button variant="secondary" loading={ai.isPending} onClick={() => ai.mutate({ action: "meeting_prep", event_id: id })}><SparkleIcon size={15} /> {t("Prepare me for this meeting")}</Button>
        {e.web_link ? <Button variant="outline" asChild><a href={e.web_link} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Outlook")}</a></Button> : null}
      </> : undefined}>
      {q.isLoading ? <div className="grid gap-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        : q.error || !e ? <p role="alert" className="text-danger">{errorMessage(q.error)}</p> : (
          <div className="grid gap-4">
            {prep != null ? <AiAnswer title={t("Your meeting brief")} text={prep} onClose={() => setPrep(null)} /> : null}
            {e.cancelled ? <Pill tone="danger">{t("Cancelled")}</Pill> : null}
            {e.location ? <p className="flex items-center gap-2 text-[13.5px]"><MapPinIcon size={16} className="shrink-0 text-muted" /> {e.location}</p> : null}
            {!e.is_organizer ? (
              <div className="grid gap-2">
                <p className="text-[12.5px] text-muted">{t("Your answer: {answer}", { answer: t(RESPONSE[e.my_response] ?? RESPONSE.none!) })}</p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={e.my_response === "accepted" ? "primary" : "outline"} loading={answer.isPending && answer.variables === "accept"} onClick={() => answer.mutate("accept")}><CheckIcon size={14} /> {t("Accept")}</Button>
                  <Button size="sm" variant={e.my_response === "tentativelyAccepted" ? "primary" : "outline"} loading={answer.isPending && answer.variables === "tentative"} onClick={() => answer.mutate("tentative")}><QuestionIcon size={14} /> {t("Maybe")}</Button>
                  <Button size="sm" variant={e.my_response === "declined" ? "danger" : "outline"} loading={answer.isPending && answer.variables === "decline"} onClick={() => answer.mutate("decline")}><XIcon size={14} /> {t("Decline")}</Button>
                </div>
              </div>
            ) : null}
            <section className="grid gap-1.5">
              <h4 className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("People")}</h4>
              <ul className="grid gap-1.5">
                <li className="flex min-w-0 items-center gap-2 text-[13px]"><PersonAvatar name={e.organizer.name || e.organizer.address} size="xs" /><span className="min-w-0 truncate">{e.organizer.name || e.organizer.address}</span><Pill className="ml-auto">{t("Organiser")}</Pill></li>
                {e.attendees.map((a) => (
                  <li key={a.address} className="flex min-w-0 items-center gap-2 text-[13px]">
                    <PersonAvatar name={a.name || a.address} size="xs" />
                    <span className="min-w-0 truncate">{a.name || a.address}</span>
                    <span className="ml-auto shrink-0 text-[12px] text-muted">{t(RESPONSE[a.response] ?? RESPONSE.none!)}</span>
                  </li>
                ))}
              </ul>
            </section>
            {/* P109b: made from the office: its join link, Prima record, Change and Cancel. */}
            {e.is_organizer ? <MeetingRecord eventId={id} onCancelled={onClose} /> : null}
            {e.body_html.trim() ? (
              <iframe title={t("Event details")} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={mailDocument(e.body_html, "", { images: false, dark })}
                className="h-72 w-full rounded-sm border border-border" />
            ) : null}
          </div>
        )}
    </SideSheet>
  );
}

function NewEvent({ onClose }: { onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const start0 = new Date();
  start0.setMinutes(0, 0, 0);
  start0.setHours(start0.getHours() + 1);
  const [subject, setSubject] = useState("");
  const [start, setStart] = useState(toLocalInput(start0.toISOString()));
  const [end, setEnd] = useState(toLocalInput(new Date(start0.getTime() + 3600_000).toISOString()));
  const [guests, setGuests] = useState("");
  const [location, setLocation] = useState("");
  const [online, setOnline] = useState(true);
  const [body, setBody] = useState("");
  const [plan, setPlan] = useState("");
  const list = splitAddresses(guests);
  const okGuests = !guests.trim() || allEmails(list);
  const ok = subject.trim() && start && end && new Date(end) > new Date(start) && okGuests;
  const ai = useAskAi((r) => {
    const e = r.event;
    if (!e) return;
    if (e.subject) setSubject(e.subject);
    if (e.start) setStart(toLocalInput(e.start));
    if (e.end) setEnd(toLocalInput(e.end));
    if (e.attendees.length) setGuests(e.attendees.join(", "));
    if (e.location) setLocation(e.location);
    setOnline(e.online);
    if (e.body) setBody(e.body);
    toast.success(t("Filled in. Check it, then press Create."));
  });
  const create = useMutation({
    mutationFn: () => createEvent({ subject: subject.trim(), start: fromLocalInput(start), end: fromLocalInput(end), attendees: list, location: location.trim(), body, online }),
    onSuccess: () => { toast.success(list.length ? t("Event created. Invitations were sent.") : t("Event created.")); void qc.invalidateQueries({ queryKey: m365Keys.all }); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} title={t("New event")} description={t("In your own Outlook calendar. Guests get an invitation when you press Create.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button disabled={!ok} loading={create.isPending} onClick={() => create.mutate()}><CalendarPlusIcon size={15} /> {t("Create")}</Button>
      </>}>
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-dashed border-accent/40 bg-accent-soft/25 p-2.5">
          <label className="min-w-0"><span className="sr-only">{t("Plan with AI")}</span>
            <Input value={plan} onChange={(e) => setPlan(e.target.value)} maxLength={1000} placeholder={t("e.g. Tender review with ali@company.com Thursday 10am, 1 hour, on Teams")} />
          </label>
          <Button size="sm" variant="secondary" className="w-fit" disabled={plan.trim().length < 4} loading={ai.isPending} onClick={() => ai.mutate({ action: "event_draft", instructions: plan })}>
            <SparkleIcon size={14} /> {t("Plan with AI")}
          </Button>
        </div>
        <Field label={t("Title")} value={subject} maxLength={255} onChange={(e) => setSubject(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("Starts")} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          <Field label={t("Ends")} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)}
            error={start && end && new Date(end) <= new Date(start) ? t("The end must be after the start.") : undefined} />
        </div>
        <Field label={t("Guests (emails, optional)")} value={guests} onChange={(e) => setGuests(e.target.value)} inputMode="email"
          error={!okGuests ? t("Check the email addresses.") : undefined} />
        <Field label={t("Place (optional)")} value={location} maxLength={255} onChange={(e) => setLocation(e.target.value)} />
        <SwitchField checked={online} onCheckedChange={setOnline} label={t("Teams meeting")} hint={t("Adds a Teams link to join online.")} />
        <TextareaField label={t("Agenda (optional)")} rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
    </ResponsiveDialog>
  );
}

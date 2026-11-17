/** P109b "New Teams meeting" with AI (Fitri, 17 Nov 2026: "ask AI to create a Teams meeting with
 * meeting link and send to who ... it will auto send invitations, and also update the Prima
 * meetings record there. Make it seamless.").
 *
 * The person types or says what they want; the AI fills the form (title, the people matched to
 * their addresses, when, how long, agenda, kind). They check it, pick anyone the AI was unsure
 * about, and press "Create and send invitations": a Teams meeting in their own Outlook, whose
 * invitations Outlook sends. The join link is shown with Copy. The meeting is also recorded in
 * Prima's Meetings as them when Prima allows it; if not, the reason shows with "Add to Prima".
 * Nothing is created or sent before that press. Opened from the Microsoft 365 workspace's
 * header, the Calendar tab, and "Set up a meeting about this" on an email or a chat. */
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  CopyIcon,
  PaperPlaneTiltIcon,
  PencilSimpleIcon,
  PlusIcon,
  SparkleIcon,
  VideoCameraIcon,
  WarningCircleIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { create } from "zustand";

import { PersonAvatar } from "@/components/person-avatar";
import { VoiceInput } from "@/components/voice-input";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, Input, TextareaField } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import {
  addToPrima,
  allEmails,
  cancelMeeting,
  changeMeeting,
  createMeeting,
  draftMeeting,
  fromLocalInput,
  m365Keys,
  m365SummaryQuery,
  MEETING_KINDS,
  meetingLinkKey,
  meetingLinkQuery,
  minutesBetween,
  readyPeople,
  searchPeople,
  summaryKey,
  toLocalInput,
  type DraftPerson,
  type Invitee,
  type MeetingKind,
  type PrimaRecord,
  type TeamsMeeting,
} from "@/lib/m365";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- who opens it

/** What the composer starts from: an email or a chat it is about, words to start with, or a
 * meeting made here to change. */
export interface MeetingStart {
  message_id?: string;
  chat_id?: string;
  /** Shown above the form: "About: <subject or chat>". */
  about?: string;
  instructions?: string;
  edit?: TeamsMeeting;
}

interface ComposerState {
  start: MeetingStart | null;
  open: (start?: MeetingStart) => void;
  close: () => void;
}

export const useMeetingComposer = create<ComposerState>((set) => ({
  start: null,
  open: (start = {}) => set({ start }),
  close: () => set({ start: null }),
}));

/** One composer for the whole Microsoft 365 workspace. */
export function MeetingComposerHost() {
  const start = useMeetingComposer((s) => s.start);
  const close = useMeetingComposer((s) => s.close);
  if (!start) return null;
  return <MeetingComposer key={JSON.stringify(start)} start={start} onClose={close} />;
}

export const KIND_LABEL: Record<MeetingKind, string> = {
  management: msg("Management"),
  department: msg("Department"),
  operations: msg("Operations"),
  client: msg("Client"),
  board: msg("Board"),
  toolbox: msg("Toolbox talk"),
  other: msg("Other"),
};

const LENGTHS = [15, 30, 45, 60, 90, 120, 180];

function nextHour(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return toLocalInput(d.toISOString());
}

const zoneName = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
};

// ---------------------------------------------------------------- the composer

export function MeetingComposer({ start, onClose }: { start: MeetingStart; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const edit = start.edit;
  const summary = useQuery(m365SummaryQuery());
  const primaHere = !!summary.data?.prima;
  const [ask, setAsk] = useState(start.instructions ?? "");
  const [title, setTitle] = useState(edit?.title ?? "");
  const [when, setWhen] = useState(edit ? toLocalInput(edit.start) : nextHour());
  const [minutes, setMinutes] = useState(edit ? minutesBetween(edit.start, edit.end) || 30 : 30);
  const [people, setPeople] = useState<DraftPerson[]>(
    () => edit?.attendees.map((p) => ({ ...p, status: "ok" as const, options: [] })) ?? [],
  );
  const [agenda, setAgenda] = useState(edit?.agenda ?? "");
  const [kind, setKind] = useState<MeetingKind>(edit?.kind ?? "management");
  const [prima, setPrima] = useState(true);
  const [reason, setReason] = useState("");
  const [done, setDone] = useState<TeamsMeeting | null>(null);
  const [filled, setFilled] = useState(false);

  const ai = useMutation({
    mutationFn: () => draftMeeting({ instructions: ask.trim(), message_id: start.message_id, chat_id: start.chat_id }),
    onSuccess: (d) => {
      if (d.title) setTitle(d.title);
      setWhen(toLocalInput(d.start));
      setMinutes(d.minutes);
      setPeople(d.attendees);
      if (d.agenda) setAgenda(d.agenda);
      setKind(d.kind);
      setFilled(true);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const startIso = when ? fromLocalInput(when) : "";
  const endIso = startIso ? new Date(Date.parse(startIso) + minutes * 60_000).toISOString() : "";
  const { ok: invitees, missing } = readyPeople(people);
  const ready = !!title.trim() && !!startIso && minutes > 0 && !missing.length;

  const save = useMutation({
    mutationFn: () =>
      edit
        ? changeMeeting(edit.event_id, { title: title.trim(), start: startIso, end: endIso, attendees: invitees, agenda, reason: reason.trim() })
        : createMeeting({ title: title.trim(), start: startIso, end: endIso, attendees: invitees, agenda, kind, prima: primaHere && prima }),
    onSuccess: (m) => {
      void qc.invalidateQueries({ queryKey: m365Keys.all });
      void qc.invalidateQueries({ queryKey: summaryKey });
      if (edit) {
        toast.success(m.prima_warning ? t("Meeting changed. Prima was not updated: {why}", { why: m.prima_warning }) : t("Meeting changed. Everyone invited gets the update."));
        onClose();
      } else {
        setDone(m);
      }
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const endsAt = endIso ? new Date(endIso).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) : "";
  const zone = zoneName();

  if (done) return <MeetingDone meeting={done} primaHere={primaHere} onClose={onClose} onChange={setDone} />;

  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} className="w-[min(96vw,46rem)]"
      title={edit ? t("Change the meeting") : t("New Teams meeting")}
      description={edit ? t("Everyone invited gets the update from your Outlook when you press Save.") : t("Say what you need and the AI fills this in. Check it, then press Create: Outlook sends the invitations with the Teams link.")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        <Button disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>
          <PaperPlaneTiltIcon size={15} /> {edit ? t("Save and send the update") : t("Create and send invitations")}
        </Button>
      </>}>
      <div className="grid gap-4">
        {!edit ? (
          <section aria-label={t("Ask AI")} className="grid gap-2 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/30 p-3">
            {start.about ? <p className="text-[12.5px] text-muted">{t("About: {what}", { what: start.about })}</p> : null}
            <label className="grid gap-1.5">
              <span className="flex items-center gap-1.5 text-[13px] font-medium"><SparkleIcon size={15} weight="fill" className="text-accent" /> {t("What meeting do you need?")}</span>
              <textarea value={ask} onChange={(e) => setAsk(e.target.value)} maxLength={4000} rows={2}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && ask.trim().length >= 3) { e.preventDefault(); ai.mutate(); } }}
                placeholder={t("e.g. Meeting with Faiz and Nabilah tomorrow 3pm about the D WAY roster, 45 min, send agenda")}
                className="min-h-16 w-full resize-y rounded-sm border border-border bg-surface px-3 py-2 text-[14px] outline-none focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20" />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={ask.trim().length < 3} loading={ai.isPending} onClick={() => ai.mutate()}>
                <SparkleIcon size={14} /> {filled ? t("Fill in again") : t("Fill in with AI")}
              </Button>
              <VoiceInput onText={(text) => setAsk((a) => (a.trim() ? `${a.trim()} ${text}` : text))} />
              {filled ? <span className="text-[12.5px] text-muted">{t("Filled in. Check everything below before you create it.")}</span> : null}
            </div>
          </section>
        ) : null}

        <Field label={t("Title")} value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <Field label={t("Starts")} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
            hint={endsAt ? t("Ends {time}{zone}", { time: endsAt, zone: zone ? ` (${zone})` : "" }) : undefined} />
          <div className="grid content-start gap-1.5">
            <span className="text-[13px] font-medium">{t("How long")}</span>
            <Select label={t("How long")} value={String(minutes)} onValueChange={(v) => setMinutes(Number(v))}
              options={[...new Set([...LENGTHS, minutes])].sort((a, b) => a - b).map((m) => ({ value: String(m), label: lengthText(t, m) }))} />
          </div>
        </div>

        <InviteePicker people={people} onChange={setPeople} />

        <TextareaField label={t("Agenda")} rows={4} maxLength={4000} value={agenda} onChange={(e) => setAgenda(e.target.value)}
          hint={t("One item per line. It goes in the invitation.")} />

        <p className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface-2/50 px-3 py-2.5 text-[13px]">
          <VideoCameraIcon size={17} weight="duotone" className="shrink-0 text-[#5b5fc7] dark:text-[#a6a8f0]" />
          <span>{t("Teams meeting: the join link is added to the invitation.")}</span>
        </p>

        {edit ? (
          edit.prima.status === "added" ? (
            <Field label={t("Why it changed (for the Prima record, optional)")} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          ) : null
        ) : primaHere ? (
          <div className="grid gap-2 rounded-[var(--radius-md)] border border-border p-3">
            <SwitchField checked={prima} onCheckedChange={setPrima} label={t("Also record it in Prima Meetings")}
              hint={t("As you, with your Prima access. If Prima does not allow it, you see why.")} />
            {prima ? (
              <div className="grid max-w-60 gap-1.5">
                <span className="text-[13px] font-medium">{t("Kind of meeting")}</span>
                <Select label={t("Kind of meeting")} value={kind} onValueChange={(v) => setKind(v as MeetingKind)}
                  options={MEETING_KINDS.map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} />
              </div>
            ) : null}
          </div>
        ) : null}

        {missing.length ? (
          <p role="status" className="flex items-start gap-2 text-[13px] text-warn">
            <WarningCircleIcon size={16} className="mt-0.5 shrink-0" />
            {t("Pick or type an address for: {names}", { names: missing.map((p) => p.name || "?").join(", ") })}
          </p>
        ) : null}
      </div>
    </ResponsiveDialog>
  );
}

function lengthText(t: ReturnType<typeof useT>, m: number): string {
  if (m < 60) return t("{n} min", { n: m });
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? t("{h} h {m} min", { h, m: rest }) : t("{h} h", { h });
}

// ---------------------------------------------------------------- who is invited

/** The people to invite: chips (one sure address each), the ones the AI was unsure about with
 * their choices, and a search over the office members and the person's own Outlook. */
export function InviteePicker({ people, onChange }: { people: DraftPerson[]; onChange: (p: DraftPerson[]) => void }) {
  const t = useT();
  const id = useId();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    const h = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(h);
  }, [q]);
  const found = useQuery({
    queryKey: [...m365Keys.all, "people", term],
    queryFn: () => searchPeople(term),
    enabled: term.length >= 2 && !term.includes(","),
    retry: false,
    staleTime: 60_000,
  });
  const taken = useMemo(() => new Set(people.map((p) => p.email.toLowerCase()).filter(Boolean)), [people]);
  const results = (found.data ?? []).filter((p) => !taken.has(p.email.toLowerCase())).slice(0, 8);
  const typed = q.trim().replace(/^<|>$/g, "");
  const typedOk = allEmails([typed]) && !taken.has(typed.toLowerCase());

  const add = (p: Invitee) => {
    onChange([...people, { ...p, status: "ok", options: [] }]);
    setQ("");
    setActive(0);
  };
  const set = (i: number, p: DraftPerson) => onChange(people.map((x, j) => (j === i ? p : x)));
  const remove = (i: number) => onChange(people.filter((_, j) => j !== i));

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-[13px] font-medium">{t("People to invite")}</legend>
      {people.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t("People to invite")}>
          {people.map((p, i) => (
            <li key={`${p.email}|${p.name}|${i}`} className="max-w-full min-w-0">
              {p.status === "ok" && p.email ? (
                <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-border bg-surface py-1 pr-1 pl-1.5 text-[13px]">
                  <PersonAvatar name={p.name || p.email} id={p.email} size="xs" />
                  <span className="min-w-0 truncate" title={p.email}>{p.name || p.email}</span>
                  {p.name && p.name !== p.email ? <span className="hidden min-w-0 truncate text-[12px] text-muted sm:inline">{p.email}</span> : null}
                  <button type="button" onClick={() => remove(i)} aria-label={t("Remove {name}", { name: p.name || p.email })}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg focus-visible:ring-3 focus-visible:ring-accent/30 focus-visible:outline-none pointer-coarse:size-9">
                    <XIcon size={13} />
                  </button>
                </span>
              ) : (
                <Unsure person={p} onPick={(x) => set(i, { ...p, ...x, status: "ok", options: [] })} onRemove={() => remove(i)} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted">{t("No one yet. Search for people below, or ask the AI above.")}</p>
      )}
      <div className="relative">
        <label htmlFor={`${id}-q`} className="sr-only">{t("Add people")}</label>
        <div className="flex gap-2">
          <Input id={`${id}-q`} value={q} onChange={(e) => { setQ(e.target.value); setActive(0); }} autoComplete="off"
            placeholder={t("Add people: type a name or an email")} maxLength={120}
            role="combobox" aria-expanded={results.length > 0} aria-controls={`${id}-list`}
            aria-activedescendant={results.length ? `${id}-o${active}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && results.length) { e.preventDefault(); setActive((a) => (a + 1) % results.length); }
              else if (e.key === "ArrowUp" && results.length) { e.preventDefault(); setActive((a) => (a - 1 + results.length) % results.length); }
              else if (e.key === "Enter") {
                e.preventDefault();
                if (results[active]) add(results[active]!);
                else if (typedOk) add({ name: typed, email: typed.toLowerCase() });
              } else if (e.key === "Escape" && q) { e.stopPropagation(); setQ(""); }
            }} />
          <Button type="button" variant="outline" className="h-10 shrink-0" disabled={!typedOk} onClick={() => add({ name: typed, email: typed.toLowerCase() })}>
            <PlusIcon size={14} /> {t("Add")}
          </Button>
        </div>
        {term.length >= 2 && q.trim() ? (
          <ul id={`${id}-list`} role="listbox" aria-label={t("People found")}
            className="mt-1.5 grid max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-soft)] empty:hidden">
            {found.isLoading ? <li className="px-3 py-2.5 text-[13px] text-muted">{t("Searching…")}</li>
              : found.error ? <li role="alert" className="px-3 py-2.5 text-[13px] text-danger">{errorMessage(found.error)}</li>
              : !results.length ? <li className="px-3 py-2.5 text-[13px] text-muted">{typedOk ? t("Press Enter to add this address.") : t("No one found. Type their full email.")}</li>
              : results.map((p, i) => (
                <li key={p.email} id={`${id}-o${i}`} role="option" aria-selected={i === active}>
                  <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => add(p)}
                    className={cn("flex min-h-11 w-full min-w-0 items-center gap-2.5 px-3 py-2 text-left text-[13.5px] hover:bg-surface-2", i === active && "bg-accent-soft/50")}>
                    <PersonAvatar name={p.name || p.email} id={p.email} size="sm" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate font-medium">{p.name || p.email}</span>
                      <span className="truncate text-[12px] text-muted">{p.email}</span>
                    </span>
                    <span className="shrink-0 text-[11.5px] text-muted">{p.source === "office" ? t("Office") : p.source === "teams" ? "Teams" : "Outlook"}</span>
                  </button>
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </fieldset>
  );
}

/** A person the AI was not sure about: pick one of the matches, or type the address. */
function Unsure({ person, onPick, onRemove }: { person: DraftPerson; onPick: (p: Invitee) => void; onRemove: () => void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const good = allEmails([email.trim()]);
  return (
    <div className="grid max-w-full min-w-0 gap-1.5 rounded-[var(--radius-md)] border border-warn/40 bg-warn/6 p-2 text-[13px]">
      <div className="flex min-w-0 items-center gap-2">
        <WarningCircleIcon size={15} className="shrink-0 text-warn" />
        <span className="min-w-0 flex-1 truncate">
          {person.status === "choose" ? t("Which {name}?", { name: person.name }) : t("No address found for {name}", { name: person.name })}
        </span>
        <Button size="icon-sm" variant="ghost" aria-label={t("Remove {name}", { name: person.name })} onClick={onRemove}><XIcon size={13} /></Button>
      </div>
      {person.options.length ? (
        <div className="flex flex-wrap gap-1.5">
          {person.options.map((o) => (
            <Button key={o.email} size="sm" variant="outline" className="max-w-full" onClick={() => onPick(o)}>
              <span className="min-w-0 truncate">{o.name}</span> <span className="hidden truncate text-muted sm:inline">{o.email}</span>
            </Button>
          ))}
        </div>
      ) : null}
      <div className="flex gap-1.5">
        <label className="min-w-0 flex-1"><span className="sr-only">{t("Email for {name}", { name: person.name })}</span>
          <Input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder={t("Email for {name}", { name: person.name })}
            onKeyDown={(e) => { if (e.key === "Enter" && good) { e.preventDefault(); onPick({ name: person.name, email: email.trim().toLowerCase() }); } }} />
        </label>
        <Button size="sm" className="h-10" variant="outline" disabled={!good} onClick={() => onPick({ name: person.name, email: email.trim().toLowerCase() })}>{t("Use")}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- after Create

function MeetingDone({ meeting, primaHere, onClose, onChange }: { meeting: TeamsMeeting; primaHere: boolean; onClose: () => void; onChange: (m: TeamsMeeting) => void }) {
  const t = useT();
  const n = meeting.attendees.length;
  return (
    <ResponsiveDialog open onOpenChange={(o) => !o && onClose()} className="w-[min(96vw,40rem)]"
      title={n ? t("Meeting created. Invitations sent.") : t("Meeting created.")}
      description={n ? t("Outlook sent the invitation to {n} people, with the Teams link.", { n }) : t("It is in your Outlook calendar with its Teams link.")}
      footer={<Button onClick={onClose}>{t("Done")}</Button>}>
      <div className="grid gap-4">
        <div className="flex items-center gap-2 text-[14px] font-medium">
          <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-ok" />
          <span className="min-w-0 break-words">{meeting.title}</span>
        </div>
        <p className="text-[13px] text-muted">{whenText(meeting.start, meeting.end)}</p>
        {meeting.join_url ? <JoinLink url={meeting.join_url} /> : <p className="text-[13px] text-muted">{t("Microsoft is still adding the Teams link. It is in the invitation.")}</p>}
        <div className="flex flex-wrap gap-2">
          {meeting.join_url ? (
            <Button asChild variant="secondary"><a href={meeting.join_url} target="_blank" rel="noreferrer noopener"><VideoCameraIcon size={15} /> {t("Join Teams meeting")}</a></Button>
          ) : null}
          {meeting.web_link ? (
            <Button asChild variant="outline"><a href={meeting.web_link} target="_blank" rel="noreferrer noopener"><ArrowSquareOutIcon size={15} /> {t("Open in Outlook")}</a></Button>
          ) : null}
        </div>
        <PrimaLine meeting={meeting} primaHere={primaHere} onChange={onChange} />
      </div>
    </ResponsiveDialog>
  );
}

export function whenText(start: string, end: string): string {
  const a = new Date(start);
  const b = new Date(end);
  const day = a.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
  const hm = (d: Date) => d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${hm(a)}–${hm(b)}`;
}

/** The Teams join link, ready to copy. */
export function JoinLink({ url }: { url: string }) {
  const t = useT();
  const id = useId();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("Link copied."));
    } catch {
      toast.error(t("Could not copy. Select the link and copy it."));
    }
  };
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium">{t("Teams link")}</label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 font-mono text-[12.5px]" />
        <Button variant="outline" className="h-10 shrink-0" onClick={() => void copy()}><CopyIcon size={15} /> {t("Copy")}</Button>
      </div>
    </div>
  );
}

const PRIMA_TEXT: Record<PrimaRecord["status"], string> = {
  none: msg("Not recorded in Prima."),
  added: msg("Recorded in Prima Meetings."),
  failed: msg("Not added to Prima: {reason}"),
  skipped: msg("Not added to Prima: {reason}"),
  cancelled: msg("Cancelled in Prima too."),
};

/** Where the meeting stands in Prima, with "Add to Prima" when it is not there. */
export function PrimaLine({ meeting, primaHere, onChange }: { meeting: TeamsMeeting; primaHere: boolean; onChange?: (m: TeamsMeeting) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const p = meeting.prima;
  const retry = useMutation({
    mutationFn: () => addToPrima(meeting.event_id),
    onSuccess: (m) => {
      onChange?.(m);
      void qc.invalidateQueries({ queryKey: m365Keys.all });
      if (m.prima.status === "added") toast.success(t("Recorded in Prima Meetings."));
      else toast.error(t(PRIMA_TEXT[m.prima.status], { reason: m.prima.reason ?? "" }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (p.status === "none" && !primaHere) return null;
  const good = p.status === "added" || p.status === "cancelled";
  const canRetry = !meeting.cancelled && (p.status === "failed" || (p.status === "none" && primaHere));
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-[13px]",
      good ? "border-ok/30 bg-ok/6" : "border-warn/30 bg-warn/6")}>
      {good ? <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-ok" /> : <WarningCircleIcon size={16} className="shrink-0 text-warn" />}
      <span className="min-w-0 flex-1 break-words">{t(PRIMA_TEXT[p.status], { reason: p.reason ?? "" })}</span>
      {canRetry ? <Button size="sm" variant="outline" loading={retry.isPending} onClick={() => retry.mutate()}>{t("Add to Prima")}</Button> : null}
    </div>
  );
}

// ---------------------------------------------------------------- a meeting made here, later

/** In an event's detail: for a meeting made from this workspace, its Prima record ("Add to
 * Prima" when it is not there), and Change / Cancel, which reach the Prima record too. */
export function MeetingRecord({ eventId, onCancelled }: { eventId: string; onCancelled?: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const link = useQuery(meetingLinkQuery(eventId));
  const summary = useQuery(m365SummaryQuery());
  const openComposer = useMeetingComposer((s) => s.open);
  const [cancelling, setCancelling] = useState(false);
  const [why, setWhy] = useState("");
  const cancel = useMutation({
    mutationFn: () => cancelMeeting(eventId, why.trim()),
    onSuccess: (m) => {
      toast.success(m.prima_warning ? t("Meeting cancelled. Prima was not updated: {why}", { why: m.prima_warning }) : t("Meeting cancelled. Everyone invited is told."));
      void qc.invalidateQueries({ queryKey: m365Keys.all });
      void qc.invalidateQueries({ queryKey: summaryKey });
      setCancelling(false);
      onCancelled?.();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const m = link.data;
  if (!m || !m.linked) return null;
  return (
    <section aria-label={t("Made from the office")} className="grid gap-2.5">
      <h4 className="text-[12px] font-semibold tracking-[0.06em] text-muted uppercase">{t("Made from the office")}</h4>
      {m.join_url && !m.cancelled ? <JoinLink url={m.join_url} /> : null}
      <PrimaLine meeting={m} primaHere={!!summary.data?.prima} onChange={(next) => qc.setQueryData(meetingLinkKey(eventId), { linked: true, ...next })} />
      {!m.cancelled ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openComposer({ edit: m })}><PencilSimpleIcon size={14} /> {t("Change")}</Button>
          <Button size="sm" variant="outline" className="text-danger" onClick={() => setCancelling(true)}><XCircleIcon size={14} /> {t("Cancel meeting")}</Button>
        </div>
      ) : <p className="text-[13px] text-muted">{t("This meeting was cancelled.")}</p>}
      <ResponsiveDialog open={cancelling} onOpenChange={setCancelling} title={t("Cancel this meeting?")}
        description={t("Everyone invited gets Outlook's cancellation. The Prima record is cancelled too, with your reason.")}
        footer={<>
          <Button variant="ghost" onClick={() => setCancelling(false)}>{t("Keep it")}</Button>
          <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>{t("Cancel meeting")}</Button>
        </>}>
        <Field label={t("Reason (sent with the cancellation)")} value={why} maxLength={300} onChange={(e) => setWhy(e.target.value)} />
      </ResponsiveDialog>
    </section>
  );
}

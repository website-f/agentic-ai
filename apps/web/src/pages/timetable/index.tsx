/** P47 Timetable: every agent's working day, like a staff rota. Its hours (breaks cut out),
 * what it does at set times (its duties: schedules that run as it), and whether it sends a
 * short summary when its day ends. Click an agent to change its hours and duties, or add a
 * duty from a ready-made list. (GET /api/timetable; hours: PATCH /api/agents/{id}; duties:
 * /api/schedules) */
import { CalendarDotsIcon, CaretLeftIcon, CaretRightIcon, ClockIcon, MoonIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormError, Input, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { SideSheet } from "@/components/ui/side-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { meQuery } from "@/lib/queries";
import type { WorkHours } from "@/lib/staff";
import { schedulesQuery, teamKeys, type Schedule } from "@/lib/teams";
import { cn } from "@/lib/utils";

interface DayDuty { schedule_id: string; time: string; title: string; name: string; enabled: boolean; outside_hours: boolean; urgent: boolean }

interface DayPlan {
  agent_id: string;
  name: string;
  role: string;
  color: string | null;
  is_twin: boolean;
  status: string;
  date: string;
  tz: string;
  any_time: boolean;
  works: boolean;
  hours: { start: string; end: string }[];
  breaks: { start: string; end: string }[];
  work_hours: (WorkHours & { day_report?: boolean }) | null;
  label: string | null;
  duties: DayDuty[];
  waiting_for_shift: number;
  day_report: boolean;
}

interface Timetable { date: string; tz: string; agents: DayPlan[] }

const timetableQuery = (date?: string) =>
  queryOptions({ queryKey: ["timetable", date ?? "today"], queryFn: () => api<Timetable>(`/api/timetable${date ? `?date=${date}` : ""}`), staleTime: 30_000 });

const mins = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const shift = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const dayName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });

/** Ready-made duties: what offices usually hand an assistant. */
const TEMPLATES: { title: string; brief: string; time: string; days: number[] }[] = [
  { title: msg("Start the day: go through new email"), brief: msg("Check new email in the mailboxes you look after. Sort it, make tasks for what needs doing, and draft replies to routine questions for a person to approve."), time: "08:30", days: [1, 2, 3, 4, 5] },
  { title: msg("Chase overdue invoices"), brief: msg("List the invoices past their due date and draft polite payment reminders. Do not send them: a person approves each one."), time: "10:00", days: [1, 4] },
  { title: msg("Follow up open quotations"), brief: msg("Find quotations sent more than a week ago with no answer and draft a short follow-up for each."), time: "10:30", days: [3] },
  { title: msg("Check stock and orders"), brief: msg("Check today's orders and stock levels in the Library sheets and list anything running low or late."), time: "11:00", days: [1, 2, 3, 4, 5] },
  { title: msg("End of day summary"), brief: msg("Write a short summary for the manager: what was done today, what is stuck, and what needs a decision tomorrow."), time: "17:00", days: [1, 2, 3, 4, 5] },
  { title: msg("Weekly report"), brief: msg("Write the weekly report: work done, open issues, money owed both ways, and next week's priorities."), time: "16:00", days: [5] },
];

const DAY_SHORT = [msg("Mon"), msg("Tue"), msg("Wed"), msg("Thu"), msg("Fri"), msg("Sat"), msg("Sun")];
const VIEW_FROM = 6 * 60;
const VIEW_TO = 22 * 60;

export function TimetablePage() {
  const t = useT();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { date?: string; agent?: string };
  const { data: me } = useSuspenseQuery(meQuery);
  const canManage = me.permissions.includes("agents.manage") || me.permissions.includes("agents.own");
  const q = useQuery(timetableQuery(search.date));
  const tt = q.data;
  const go = (date?: string) => void navigate({ to: "/timetable", search: { date, agent: search.agent }, replace: true });
  const open = tt?.agents.find((a) => a.agent_id === search.agent);
  const today = !search.date;

  return (
    <Page wide>
      <PageHeader title={t("Timetable")}
        description={t("Each agent's working day, like a staff rota: when it works, what it does at set times, and what waits for its next shift. Click an agent to change its hours or give it a daily duty.")} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon-sm" variant="outline" disabled={!tt} onClick={() => tt && go(shift(tt.date, -1))} aria-label={t("The day before")}><CaretLeftIcon size={15} /></Button>
        <span className="min-w-48 text-center text-[14.5px] font-semibold">{tt ? (today ? t("Today, {day}", { day: dayName(tt.date) }) : dayName(tt.date)) : t("Loading…")}</span>
        <Button size="icon-sm" variant="outline" disabled={!tt} onClick={() => tt && go(shift(tt.date, 1))} aria-label={t("The day after")}><CaretRightIcon size={15} /></Button>
        {!today ? <Button size="sm" variant="ghost" onClick={() => go(undefined)}>{t("Back to today")}</Button> : null}
        <Legend />
      </div>

      {q.isLoading ? <Skeleton className="h-64 rounded-[var(--radius-md)]" /> : q.error || !tt ? (
        <p role="alert" className="text-danger">{errorMessage(q.error)}</p>
      ) : !tt.agents.length ? (
        <EmptyState icon={CalendarDotsIcon} title={t("No agents yet")} body={t("Hire an agent first; its working day shows here.")} />
      ) : (
        <Card className="overflow-hidden p-0">
          <Scale />
          <ul className="divide-y divide-border">
            {tt.agents.map((a) => <AgentRow key={a.agent_id} a={a} onOpen={() => void navigate({ to: "/timetable", search: { date: search.date, agent: a.agent_id } })} />)}
          </ul>
        </Card>
      )}

      {open ? (
        <AgentDay a={open} canManage={canManage} onClose={() => void navigate({ to: "/timetable", search: { date: search.date }, replace: true })} />
      ) : null}
    </Page>
  );
}

function Legend() {
  const t = useT();
  return (
    <span className="ml-auto flex flex-wrap items-center gap-3 text-[12px] text-muted max-sm:ml-0">
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-accent/70" /> {t("Working")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-sm bg-surface-2 ring-1 ring-border" /> {t("Break or off")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-info" /> {t("Duty")}</span>
      <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-warn" /> {t("Duty outside its hours (waits)")}</span>
    </span>
  );
}

const pos = (m: number) => `${(Math.min(Math.max(m, VIEW_FROM), VIEW_TO) - VIEW_FROM) / (VIEW_TO - VIEW_FROM) * 100}%`;
const width = (a: number, b: number) => `${(Math.min(b, VIEW_TO) - Math.max(a, VIEW_FROM)) / (VIEW_TO - VIEW_FROM) * 100}%`;

function Scale() {
  const hours = [6, 8, 10, 12, 14, 16, 18, 20, 22];
  return (
    <div className="hidden grid-cols-[14rem_minmax(0,1fr)] border-b border-border bg-surface-2/40 px-4 py-1.5 md:grid">
      <span />
      <div className="relative h-4 text-[11px] text-muted">
        {hours.map((h) => <span key={h} className="absolute -translate-x-1/2 tabular" style={{ left: pos(h * 60) }}>{String(h).padStart(2, "0")}:00</span>)}
      </div>
    </div>
  );
}

function AgentRow({ a, onOpen }: { a: DayPlan; onOpen: () => void }) {
  const t = useT();
  return (
    <li>
      <button type="button" onClick={onOpen}
        className="grid w-full grid-cols-[minmax(0,1fr)] gap-2 px-4 py-3 text-left transition-colors hover:bg-surface-2/50 md:grid-cols-[14rem_minmax(0,1fr)] md:items-center">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: a.color ?? "var(--accent)" }} />
          <span className="grid min-w-0">
            <span className="truncate text-[14px] font-medium">{a.name}</span>
            <span className="truncate text-[12px] text-muted">{a.any_time ? t("Works any time") : a.works ? a.label : t("Day off")}</span>
          </span>
        </span>
        {/* phones: a sentence; wider: the day as a bar */}
        <span className="text-[12.5px] text-muted md:hidden">
          {a.duties.length ? a.duties.map((d) => `${d.time} ${d.title}`).join(" · ") : t("No duties today")}
        </span>
        <span className="relative hidden h-8 rounded-sm bg-surface-2 ring-1 ring-border md:block">
          {(a.any_time ? [{ start: "00:00", end: "24:00" }] : a.hours).map((h, i) => (
            <span key={i} className="absolute inset-y-1 rounded-sm bg-accent/70" style={{ left: pos(mins(h.start)), width: width(mins(h.start), mins(h.end)) }} />
          ))}
          {!a.works && !a.any_time ? <span className="absolute inset-0 grid place-items-center text-[12px] text-muted"><MoonIcon size={14} className="mr-1 inline" />{t("Day off")}</span> : null}
          {a.duties.map((d, i) => (
            <span key={i} title={`${d.time} ${d.title}${d.outside_hours ? ` (${t("waits for its shift")})` : ""}`}
              className={cn("absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface", !d.enabled ? "bg-border" : d.outside_hours ? "bg-warn" : "bg-info")}
              style={{ left: pos(mins(d.time)) }} />
          ))}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------- one agent: hours and duties

function AgentDay({ a, canManage, onClose }: { a: DayPlan; canManage: boolean; onClose: () => void }) {
  const t = useT();
  return (
    <SideSheet open onOpenChange={(o) => !o && onClose()} size="md" title={t("{name}'s day", { name: a.name })} description={a.role}>
      <div className="grid gap-6">
        {a.waiting_for_shift ? (
          <p className="flex items-center gap-2 rounded-sm border border-info/30 bg-info/8 px-3 py-2 text-[13px]">
            <ClockIcon size={15} className="shrink-0 text-info" /> {t("{n} tasks wait for its next shift to start.", { n: a.waiting_for_shift })}
          </p>
        ) : null}
        <HoursEditor a={a} canManage={canManage} />
        <Duties a={a} canManage={canManage} />
      </div>
    </SideSheet>
  );
}

function HoursEditor({ a, canManage }: { a: DayPlan; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const base = a.work_hours;
  const [anyTime, setAnyTime] = useState(!base);
  const [days, setDays] = useState<number[]>(base?.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(base?.start ?? "09:00");
  const [end, setEnd] = useState(base?.end ?? "18:00");
  const [brk, setBrk] = useState(base?.breaks?.[0] ?? { start: "13:00", end: "14:00" });
  const [hasBreak, setHasBreak] = useState(!!base?.breaks?.length || !base);
  const [urgent, setUrgent] = useState(!!base?.urgent_anytime);
  const [report, setReport] = useState(!!base?.day_report);
  const save = useMutation({
    mutationFn: () => api(`/api/agents/${a.agent_id}`, "PATCH", {
      work_hours: anyTime ? null : { tz: a.tz, days, start, end, breaks: hasBreak ? [brk] : [], urgent_anytime: urgent, day_report: report },
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["timetable"] }); toast.success(t("Saved. The new hours apply from now.")); },
  });
  return (
    <section className="grid gap-3">
      <h3 className="text-[14px] font-semibold">{t("Working hours")}</h3>
      <SwitchField checked={anyTime} onCheckedChange={setAnyTime} disabled={!canManage}
        label={t("Works any time")} hint={t("Off: it works the hours below, and work that comes in after hours waits for its next shift.")} />
      {!anyTime ? (
        <>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Working days")}>
            {DAY_SHORT.map((d, i) => {
              const n = i + 1;
              const on = days.includes(n);
              return (
                <button key={n} type="button" aria-pressed={on} disabled={!canManage}
                  onClick={() => setDays((xs) => (on ? xs.filter((x) => x !== n) : [...xs, n].sort()))}
                  className={cn("min-h-9 min-w-11 rounded-sm border px-2 text-[13px] font-medium", on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted")}>
                  {t(d)}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("Starts")} type="time" value={start} onChange={(e) => setStart(e.target.value)} disabled={!canManage} />
            <Field label={t("Ends")} type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!canManage} />
          </div>
          <SwitchField checked={hasBreak} onCheckedChange={setHasBreak} disabled={!canManage} label={t("A lunch break")} />
          {hasBreak ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t("Break from")} type="time" value={brk.start} onChange={(e) => setBrk({ ...brk, start: e.target.value })} disabled={!canManage} />
              <Field label={t("Break until")} type="time" value={brk.end} onChange={(e) => setBrk({ ...brk, end: e.target.value })} disabled={!canManage} />
            </div>
          ) : null}
          <SwitchField checked={urgent} onCheckedChange={setUrgent} disabled={!canManage}
            label={t("Urgent work any time")} hint={t("Urgent tasks start straight away, even after hours.")} />
          <SwitchField checked={report} onCheckedChange={setReport} disabled={!canManage}
            label={t("Send a summary when its day ends")} hint={t("What it finished, what failed and what waits for a person. Made from its tasks, no AI cost.")} />
        </>
      ) : null}
      <FormError message={save.error ? errorMessage(save.error) : null} />
      {canManage ? <Button className="w-fit" loading={save.isPending} disabled={!anyTime && !days.length} onClick={() => save.mutate()}>{t("Save hours")}</Button> : null}
    </section>
  );
}

function Duties({ a, canManage }: { a: DayPlan; canManage: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const all = useQuery({ ...schedulesQuery, enabled: canManage, retry: false });
  const mine = (all.data ?? []).filter((s) => s.agent_id === a.agent_id);
  const [adding, setAdding] = useState<(typeof TEMPLATES)[number] | null | "blank">(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: teamKeys.schedules }); void qc.invalidateQueries({ queryKey: ["timetable"] }); };
  const toggle = useMutation({ mutationFn: (s: Schedule) => api(`/api/schedules/${s.id}`, "PATCH", { enabled: !s.enabled }), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({ mutationFn: (s: Schedule) => api(`/api/schedules/${s.id}`, "DELETE"), onSuccess: refresh, onError: (e) => toast.error(errorMessage(e)) });
  return (
    <section className="grid gap-3">
      <div>
        <h3 className="text-[14px] font-semibold">{t("Duties")}</h3>
        <p className="text-[12.5px] text-muted">{t("Jobs it does by itself at set times, like a staff member's daily routine.")}</p>
      </div>
      {a.duties.length ? (
        <ul className="grid divide-y divide-border rounded-[var(--radius-md)] border border-border">
          {a.duties.map((d, i) => (
            <li key={i} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
              <span className="w-12 shrink-0 font-semibold tabular">{d.time}</span>
              <span className={cn("min-w-0 flex-1 truncate", !d.enabled && "text-muted line-through")}>{d.title}</span>
              {d.outside_hours ? <Pill tone="warn">{t("Waits for its shift")}</Pill> : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted">{t("No duties on this day.")}</p>}

      {canManage && mine.length ? (
        <div className="grid gap-1.5">
          <span className="text-[12.5px] font-medium text-muted">{t("All its duties")}</span>
          <ul className="grid divide-y divide-border rounded-[var(--radius-md)] border border-border">
            {mine.map((s) => (
              <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{s.title}</span>
                <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>{s.enabled ? t("Pause") : t("Resume")}</Button>
                <Button size="icon-sm" variant="ghost" onClick={() => remove.mutate(s)} aria-label={t("Remove {name}", { name: s.title })}><TrashIcon size={14} /></Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {canManage ? (
        adding ? (
          <DutyForm a={a} preset={adding === "blank" ? null : adding} onDone={() => { setAdding(null); refresh(); }} onCancel={() => setAdding(null)} />
        ) : (
          <div className="grid gap-2">
            <span className="text-[12.5px] font-medium text-muted">{t("Add a duty")}</span>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((tp) => (
                <button key={tp.title} type="button" onClick={() => setAdding(tp)}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-accent/30 bg-accent-soft/40 px-2.5 text-[12.5px] font-medium text-accent hover:bg-accent-soft">
                  <PlusIcon size={12} /> {t(tp.title)}
                </button>
              ))}
              <button type="button" onClick={() => setAdding("blank")}
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-2.5 text-[12.5px] font-medium hover:text-accent">
                <PlusIcon size={12} /> {t("Something else")}
              </button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}

function DutyForm({ a, preset, onDone, onCancel }: { a: DayPlan; preset: (typeof TEMPLATES)[number] | null; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(preset ? t(preset.title) : "");
  const [brief, setBrief] = useState(preset ? t(preset.brief) : "");
  const [time, setTime] = useState(preset?.time ?? "09:00");
  const [days, setDays] = useState<number[]>(preset?.days ?? [1, 2, 3, 4, 5]);
  const [review, setReview] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const [h, m] = time.split(":").map(Number);
      const dow = days.length === 7 ? "*" : days.map((d) => d % 7).join(","); // cron: 0 = Sunday
      return api("/api/schedules", "POST", {
        name: title, agent_id: a.agent_id, title, brief, cron: `${m ?? 0} ${h ?? 9} * * ${dow}`, timezone: a.tz, requires_review: review,
      });
    },
    onSuccess: () => { toast.success(t("Duty added.")); onDone(); },
  });
  return (
    <Card className="grid gap-3 p-3.5">
      <Field label={t("What")} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} />
      <TextareaField label={t("How (instructions for the agent)")} value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} />
      <div className="grid gap-1.5">
        <span className="text-[13px] font-medium">{t("When")}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="w-32" aria-label={t("Time")} />
          {DAY_SHORT.map((d, i) => {
            const n = i + 1;
            const on = days.includes(n);
            return (
              <button key={n} type="button" aria-pressed={on} onClick={() => setDays((xs) => (on ? xs.filter((x) => x !== n) : [...xs, n].sort()))}
                className={cn("min-h-9 min-w-11 rounded-sm border px-2 text-[12.5px] font-medium", on ? "border-accent bg-accent-soft text-accent" : "border-border text-muted")}>
                {t(d)}
              </button>
            );
          })}
        </div>
      </div>
      <SwitchField checked={review} onCheckedChange={setReview} label={t("A person checks each result")} hint={t("Off: it finishes on its own; you still see every result.")} />
      <FormError message={save.error ? errorMessage(save.error) : null} />
      <div className="flex gap-2">
        <Button loading={save.isPending} disabled={!title.trim() || !days.length} onClick={() => save.mutate()}>{t("Add duty")}</Button>
        <Button variant="ghost" onClick={onCancel}>{t("Cancel")}</Button>
      </div>
    </Card>
  );
}

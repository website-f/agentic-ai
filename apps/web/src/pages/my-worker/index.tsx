/** My AI worker (P19): the staff home. What the worker is doing now (working, on a break,
 * off duty until 09:00, busy with X), today's timeline, what waits for the person, and quick
 * ways to give it work, chat, change its hours and duties. /twin stays the deeper page (chat,
 * memory, teaching, persona); this page is the day-to-day view of "the person I hired". */
import {
  ArrowRightIcon,
  BlueprintIcon,
  CalendarDotsIcon,
  ChatCircleDotsIcon,
  CheckCircleIcon,
  ClockIcon,
  CoffeeIcon,
  FlowArrowIcon,
  HourglassIcon,
  KanbanIcon,
  LightningIcon,
  ListChecksIcon,
  MoonStarsIcon,
  PencilSimpleIcon,
  PlusIcon,
  RepeatIcon,
  SealCheckIcon,
  SparkleIcon,
  UserFocusIcon,
  WarningIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, IconTile, Page, PageHeader, Section, type Tone } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow, Meta } from "@/components/ui/card";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { FormError } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat, StatGrid } from "@/components/ui/stat";
import { errorMessage } from "@/lib/api";
import {
  addDuty,
  clock,
  describeHours,
  hoursProblem,
  saveHours,
  setWorkflows,
  staffKeys,
  staffQuery,
  workerQuery,
  type DutyIn,
  type WorkerHome,
  type WorkerTask,
  type WorkHours,
} from "@/lib/staff";
import { cn, timeAgo } from "@/lib/utils";
import { workKeys, type Agent } from "@/lib/work";
import { ChoiceCard, DutyForm, EMPTY_DUTY, HoursEditor, UrgentPill, useDutyReady, WeekTimeline } from "@/pages/welcome/parts";

export function MyWorkerPage() {
  const { data, isLoading, error } = useQuery(workerQuery);
  if (isLoading) {
    return (
      <Page>
        <Skeleton className="h-10 w-64 rounded-sm" />
        <Skeleton className="h-44 rounded-[var(--radius-md)]" />
        <StatGrid>{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-md)]" />)}</StatGrid>
        <Skeleton className="h-64 rounded-[var(--radius-md)]" />
      </Page>
    );
  }
  if (error || !data) {
    return (
      <Page>
        <PageHeader title="My AI worker" />
        <FormError message={errorMessage(error)} />
      </Page>
    );
  }
  if (!data.eligible) {
    return (
      <Page>
        <PageHeader title="My AI worker" />
        <EmptyState icon={UserFocusIcon} title="This page is for staff" body="Staff hire one AI worker that works on their behalf. Managers add and run agents from Agents." action={<Button asChild><Link to="/agents">Go to Agents</Link></Button>} />
      </Page>
    );
  }
  if (!data.twin) return <NotHired first={data.person.first_name} />;
  return <Home data={data} twin={data.twin} />;
}

function NotHired({ first }: { first: string }) {
  return (
    <Page>
      <PageHeader title="My AI worker" description="An AI worker of your own: it works on your behalf, at the hours you set, and asks you before anything important." />
      <section className="relative overflow-hidden rounded-[var(--radius-lg)] border border-accent/25 bg-surface p-6 shadow-[var(--shadow-soft)] sm:p-8">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_60%)]" />
        <div className="relative grid max-w-xl gap-3">
          <IconTile icon={SparkleIcon} size="lg" />
          <h2 className="text-[20px] leading-snug font-semibold text-balance">Hire your AI worker, {first}</h2>
          <p className="text-[13.5px] text-muted">Five short steps: where you work, who it is, its job, its working hours, and the offer letter.</p>
          <Button asChild size="lg" className="justify-self-start max-sm:w-full">
            <Link to="/welcome">Start hiring <ArrowRightIcon size={16} /></Link>
          </Button>
        </div>
      </section>
    </Page>
  );
}

/* ------------------------------------------------------------ status now */

function statusOf(data: WorkerHome, twin: Agent): { label: string; detail: string | null; tone: "accent" | "warn" | "neutral" | "info" | "ok"; icon: Icon } {
  const busy = twin.current_task;
  const duty = data.duty;
  if (twin.status === "paused") return { label: "Paused", detail: "A manager paused it. It does not start new work.", tone: "neutral", icon: MoonStarsIcon };
  if (busy?.status === "blocked") return { label: "Waiting for you", detail: busy.title, tone: "warn", icon: HourglassIcon };
  if (busy) return { label: "Working", detail: busy.title, tone: "accent", icon: SparkleIcon };
  if (duty && !duty.on) {
    return { label: duty.label, detail: duty.state === "break" ? "Back to work after its break." : "New work waits until it is back.", tone: "neutral", icon: duty.state === "break" ? CoffeeIcon : MoonStarsIcon };
  }
  return { label: duty?.state === "working" ? `Free · ${duty.label.toLowerCase()}` : "Free for work", detail: "Give it something to do.", tone: "ok", icon: CheckCircleIcon };
}

function Home({ data, twin }: { data: WorkerHome; twin: Agent }) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [dialog, setDialog] = useState<null | "hours" | "duty" | "workflows">(null);
  const st = statusOf(data, twin);
  const counts = data.counts ?? { done_today: 0, open: 0, waiting: 0 };
  const duties = data.duties ?? [];
  const waiting = data.waiting ?? { approvals: [], reviews: [] };
  const working = st.label === "Working";
  return (
    <Page>
      <PageHeader
        title="My AI worker"
        description={`${twin.name} works for you. Here is what it is doing, what needs you, and when it works.`}
      />

      <Card className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 h-24 opacity-[0.12]" style={{ background: twin.color }} />
        <div className="relative grid gap-5 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <AgentAvatar name={twin.name} color={twin.color} size="lg" working={working} className="ring-4 ring-surface" />
            <div className="grid min-w-0 gap-1.5">
              <p className="text-[18px] leading-snug font-semibold break-words">{twin.name}</p>
              <p className="text-[13px] break-words text-muted">
                {twin.role} · {twin.department_name ? `${twin.department_name}, ` : ""}{twin.branch_name}
              </p>
              <motion.div
                data-guide="my-worker.status"
                key={st.label}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "mt-1 flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5",
                  st.tone === "accent" && "border-accent/30 bg-accent-soft/50",
                  st.tone === "warn" && "border-warn/30 bg-warn/10",
                  st.tone === "ok" && "border-ok/25 bg-ok/8",
                  (st.tone === "neutral" || st.tone === "info") && "border-border bg-surface-2/60",
                )}
              >
                <st.icon size={18} weight="duotone" className={cn("mt-0.5 shrink-0", st.tone === "accent" ? "text-accent" : st.tone === "warn" ? "text-warn" : st.tone === "ok" ? "text-ok" : "text-muted")} />
                <span className="grid min-w-0 gap-0.5">
                  <span className="text-[14px] font-medium break-words">{st.label}</span>
                  {st.detail ? <span className="text-[12.5px] break-words text-muted">{st.detail}</span> : null}
                </span>
              </motion.div>
              <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted">
                <ClockIcon size={14} className="shrink-0" />
                <span className="min-w-0 break-words">{twin.work_hours ? data.hours_label : "Works any time (no hours set)"}</span>
              </p>
            </div>
          </div>
          <div data-guide="my-worker.actions" className="grid grid-cols-2 gap-2 lg:w-80">
            <QuickAction icon={KanbanIcon} label="Give a task" onClick={() => navigate({ to: "/tasks", search: { new: 1, agent: twin.id } })} />
            <QuickAction icon={ChatCircleDotsIcon} label="Chat" onClick={() => navigate({ to: "/twin", search: { tab: "chat" } })} />
            <QuickAction icon={ClockIcon} label="Change hours" onClick={() => setDialog("hours")} />
            <QuickAction icon={RepeatIcon} label="Add a duty" onClick={() => setDialog("duty")} />
          </div>
        </div>
      </Card>

      <StatGrid>
        <Stat label="Done today" value={counts.done_today} icon={CheckCircleIcon} tone="ok" />
        <Stat label="Open work" value={counts.open} icon={KanbanIcon} tone="accent" hint={twin.current_task ? `On: ${twin.current_task.title}` : undefined} />
        <Stat label="Waiting for you" value={counts.waiting} icon={SealCheckIcon} tone={counts.waiting ? "warn" : "neutral"} />
        <Stat label="Duties" value={duties.length} icon={RepeatIcon} tone="info" hint={duties.length ? "Recurring work" : "None yet"} />
      </StatGrid>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 content-start gap-5">
          <Section title="Waiting for you" description="Questions and approvals it needs, and finished work to review.">
            {waiting.approvals.length || waiting.reviews.length ? (
              <ListCard>
                {waiting.approvals.map((a) => (
                  <ListRow
                    key={a.id}
                    onClick={() => navigate({ to: "/approve/$approvalId", params: { approvalId: a.id } })}
                    leading={<IconTile icon={a.kind === "question" ? ChatCircleDotsIcon : SealCheckIcon} size="sm" tone="warn" />}
                    title={a.reason || (a.kind === "question" ? "It has a question" : `Wants to use ${a.tool_name}`)}
                    meta={<Meta items={[a.task_title, timeAgo(a.created_at)]} />}
                    trailing={<Pill tone="warn">{a.kind === "question" ? "Question" : "Approve?"}</Pill>}
                  />
                ))}
                {waiting.reviews.map((t) => (
                  <ListRow
                    key={t.id}
                    onClick={() => navigate({ to: "/tasks", search: { task: t.id } })}
                    leading={<IconTile icon={ListChecksIcon} size="sm" tone="info" />}
                    title={t.title}
                    meta={<Meta items={["Finished, waiting for your review", timeAgo(t.updated_at)]} />}
                    trailing={<Pill tone="info">Review</Pill>}
                  />
                ))}
              </ListCard>
            ) : (
              <Card className="flex items-center gap-3 p-4">
                <IconTile icon={CheckCircleIcon} size="sm" tone="ok" />
                <p className="min-w-0 text-[13.5px] text-muted">Nothing needs you right now.</p>
              </Card>
            )}
          </Section>
          <Today data={data} twin={twin} />
        </div>
        <div className="grid min-w-0 content-start gap-5">
          <Card data-guide="my-worker.week">
            <CardHeader
              title="Its week"
              description={twin.work_hours ? data.hours_label : "No hours set: it works any time."}
              icon={<IconTile icon={CalendarDotsIcon} size="sm" />}
              actions={<Button variant="outline" size="sm" onClick={() => setDialog("hours")}><PencilSimpleIcon size={14} /> Change</Button>}
            />
            <CardBody>
              {twin.work_hours ? (
                <WeekTimeline key={twin.work_hours.tz} hours={twin.work_hours} />
              ) : (
                <p className="text-[13px] text-muted">Set working hours so it rests like a colleague: work given at night waits for the morning.</p>
              )}
              {twin.work_hours?.urgent_anytime ? (
                <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-muted"><LightningIcon size={13} weight="fill" className="text-danger" /> Urgent work may start outside these hours.</p>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Duties"
              description="Recurring work it does in its hours."
              icon={<IconTile icon={RepeatIcon} size="sm" tone="info" />}
              actions={<Button variant="outline" size="sm" onClick={() => setDialog("duty")}><PlusIcon size={14} weight="bold" /> Add</Button>}
            />
            {duties.length ? (
              <ul className="grid divide-y divide-border">
                {duties.map((d) => (
                  <li key={d.id} className="grid min-w-0 gap-0.5 px-4 py-3 sm:px-5">
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-[14px] font-medium break-words">
                      {d.title}
                      {d.urgent ? <UrgentPill /> : null}
                      {!d.enabled ? <Pill>Off</Pill> : null}
                    </span>
                    <span className="text-[12.5px] text-muted">{d.next_run ? `Next: ${new Date(d.next_run).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Not scheduled"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody><p className="text-[13px] text-muted">No duties yet. Add one, like "every Monday at 9am, the weekly aging report".</p></CardBody>
            )}
            <div className="border-t border-border px-4 py-2.5 sm:px-5">
              <Link to="/schedules" className="inline-flex min-h-9 items-center gap-1 text-[13px] text-accent hover:underline">Manage in Schedules <ArrowRightIcon size={13} /></Link>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Its job"
              icon={<IconTile icon={BlueprintIcon} size="sm" tone="violet" />}
              actions={<Button variant="outline" size="sm" onClick={() => setDialog("workflows")}><FlowArrowIcon size={14} /> Workflows</Button>}
            />
            <CardBody className="grid gap-3">
              <p className="text-[13px]">
                <span className="text-muted">Role playbook: </span>
                {data.blueprint ?? <span className="text-muted">none (your own instructions)</span>}
              </p>
              <div className="grid gap-1.5">
                <p className="text-[12.5px] text-muted">Workflows it follows</p>
                {data.workflows?.length ? (
                  <div className="flex flex-wrap gap-1.5">{data.workflows.map((w) => <Pill key={w.id} tone="accent"><FlowArrowIcon size={12} weight="bold" /> {w.name}</Pill>)}</div>
                ) : (
                  <p className="text-[13px] text-muted">None yet.</p>
                )}
              </div>
              <Button variant="ghost" size="sm" asChild className="justify-self-start">
                <Link to="/twin" search={{ edit: 1 }}><PencilSimpleIcon size={14} /> Edit its persona</Link>
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>

      {dialog === "hours" ? <HoursDialog twin={twin} onClose={() => setDialog(null)} /> : null}
      {dialog === "duty" ? <DutyDialog twin={twin} onClose={() => setDialog(null)} /> : null}
      {dialog === "workflows" ? <WorkflowsDialog onClose={() => setDialog(null)} /> : null}
    </Page>
  );
}

function QuickAction({ icon: IconCmp, label, onClick }: { icon: Icon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 min-w-0 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-3 text-left text-[13px] font-medium transition-colors hover:border-accent/40 hover:bg-surface-2/60"
    >
      <IconCmp size={17} weight="duotone" className="shrink-0 text-accent" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------ today */

const KIND: Record<WorkerTask["kind"], { label: string; tone: Tone; pill: "accent" | "warn" | "neutral" | "ok" | "danger" | "info"; icon: Icon; order: number }> = {
  working: { label: "Working", tone: "accent", pill: "accent", icon: SparkleIcon, order: 0 },
  waiting: { label: "Needs you", tone: "warn", pill: "warn", icon: HourglassIcon, order: 1 },
  review: { label: "Review", tone: "info", pill: "info", icon: ListChecksIcon, order: 2 },
  queued: { label: "Queued", tone: "neutral", pill: "neutral", icon: ClockIcon, order: 3 },
  done: { label: "Done", tone: "ok", pill: "ok", icon: CheckCircleIcon, order: 5 },
  failed: { label: "Failed", tone: "danger", pill: "danger", icon: WarningIcon, order: 6 },
  cancelled: { label: "Cancelled", tone: "neutral", pill: "neutral", icon: WarningIcon, order: 7 },
};

function Today({ data, twin }: { data: WorkerHome; twin: Agent }) {
  const navigate = useNavigate();
  const tz = data.timezone;
  const tasks = [...(data.today ?? [])].sort((a, b) => KIND[a.kind].order - KIND[b.kind].order);
  const upcoming = data.upcoming ?? [];
  const empty = !tasks.length && !upcoming.length;
  return (
    <Section title="Today" description={`Done, in progress, and what waits for ${twin.name}'s working hours.`}>
      {empty ? (
        <EmptyState
          icon={ListChecksIcon}
          title="A quiet day so far"
          body={`Give ${twin.name} something to do. Work given outside its hours waits for its next shift.`}
          action={<Button onClick={() => navigate({ to: "/tasks", search: { new: 1, agent: twin.id } })}><PlusIcon size={15} weight="bold" /> Give a task</Button>}
        />
      ) : (
        <ol className="relative grid gap-0 rounded-[var(--radius-md)] border border-border bg-surface py-1">
          {tasks.map((t) => {
            const k = KIND[t.kind];
            const waitsForHours = t.kind === "queued" && t.note?.startsWith("Starts when");
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => navigate({ to: "/tasks", search: { task: t.id } })}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2/60 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                >
                  <IconTile icon={waitsForHours ? MoonStarsIcon : k.icon} size="sm" tone={k.tone} />
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 flex-wrap items-center gap-2 text-[14px] font-medium break-words">
                      {t.title}
                      {t.priority === "urgent" ? <UrgentPill /> : null}
                    </span>
                    <span className="text-[12.5px] break-words text-muted">
                      {t.note ?? (t.kind === "done" && t.finished_at ? `Finished at ${clock(t.finished_at, tz)}` : t.kind === "working" && t.started_at ? `Started at ${clock(t.started_at, tz)}` : `Updated ${timeAgo(t.updated_at)}`)}
                    </span>
                  </span>
                  <span className="max-sm:col-start-2">
                    <Pill tone={waitsForHours ? "neutral" : k.pill}>{waitsForHours ? "Waits for its hours" : k.label}</Pill>
                  </span>
                </button>
              </li>
            );
          })}
          {upcoming.map((u) => (
            <li key={`u-${u.id}`} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <IconTile icon={RepeatIcon} size="sm" tone="info" />
              <span className="grid min-w-0 gap-0.5">
                <span className="text-[14px] font-medium break-words">{u.title}</span>
                <span className="text-[12.5px] text-muted">
                  Duty at {clock(u.at, tz)}{u.starts_at !== u.at ? `, starts at ${clock(u.starts_at, tz)} when it is back` : ""}
                </span>
              </span>
              <span className="max-sm:col-start-2"><Pill tone="info">Later today</Pill></span>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------ dialogs */

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: staffKeys.worker });
    qc.invalidateQueries({ queryKey: staffKeys.state });
    qc.invalidateQueries({ queryKey: workKeys.agents });
  };
}

function HoursDialog({ twin, onClose }: { twin: Agent; onClose: () => void }) {
  const staff = useQuery(staffQuery);
  const refresh = useRefresh();
  const [hours, setHours] = useState<WorkHours | null>(twin.work_hours ?? null);
  const value = hours ?? staff.data?.default_hours ?? null;
  const save = useMutation({
    mutationFn: (v: WorkHours | null) => saveHours(twin.id, v),
    onSuccess: (a) => {
      refresh();
      toast.success(a.work_hours ? `Saved. ${a.name} works ${a.hours_label}.` : `${a.name} now works any time.`);
      onClose();
    },
  });
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title="Working hours"
      description={`When ${twin.name} works and rests. Work given outside these hours waits.`}
      className="w-[min(96vw,40rem)]"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {twin.work_hours ? <Button variant="ghost" onClick={() => save.mutate(null)} disabled={save.isPending}>Any time</Button> : null}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => value && save.mutate(value)} loading={save.isPending} disabled={!value || !!hoursProblem(value)}>Save hours</Button>
        </div>
      }
    >
      {value ? (
        <div className="grid min-w-0 gap-5">
          <div className="rounded-[var(--radius-md)] border border-border p-3.5">
            <p className="mb-3 text-[12.5px] text-muted">{hoursProblem(value) ? "Not complete yet" : describeHours(value)}</p>
            <WeekTimeline key={value.tz} hours={value} />
          </div>
          <HoursEditor value={value} onChange={setHours} name={twin.name} />
          <FormError message={save.error ? errorMessage(save.error) : null} />
        </div>
      ) : (
        <Skeleton className="h-64 rounded-[var(--radius-md)]" />
      )}
    </ResponsiveDialog>
  );
}

function DutyDialog({ twin, onClose }: { twin: Agent; onClose: () => void }) {
  const refresh = useRefresh();
  const [d, setD] = useState<DutyIn>({ ...EMPTY_DUTY });
  const ready = useDutyReady(d);
  const save = useMutation({
    mutationFn: () => addDuty({ ...d, title: d.title.trim(), when: d.when.trim() }),
    onSuccess: (r) => {
      refresh();
      if (r.warning) toast.warning(r.warning);
      else toast.success(`Added. ${twin.name} does it ${r.summary}.`);
      onClose();
    },
  });
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title="Add a duty"
      description={`Recurring work ${twin.name} does in its working hours.`}
      className="w-[min(96vw,34rem)]"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!ready}><PlusIcon size={15} weight="bold" /> Add duty</Button>
        </div>
      }
    >
      <div className="grid min-w-0 gap-4">
        <DutyForm value={d} onChange={setD} urgentAllowed={!!twin.work_hours?.urgent_anytime || !twin.work_hours} />
        <FormError message={save.error ? errorMessage(save.error) : null} />
      </div>
    </ResponsiveDialog>
  );
}

function WorkflowsDialog({ onClose }: { onClose: () => void }) {
  const staff = useQuery(staffQuery);
  const refresh = useRefresh();
  const [picked, setPicked] = useState<string[] | null>(null);
  const current = picked ?? staff.data?.workflows.filter((w) => w.following).map((w) => w.id) ?? [];
  const save = useMutation({
    mutationFn: () => setWorkflows(current),
    onSuccess: () => {
      refresh();
      toast.success("Saved. It follows these from its next task.");
      onClose();
    },
  });
  return (
    <ResponsiveDialog
      open
      onOpenChange={(o) => (o ? null : onClose())}
      title="Workflows it follows"
      description="Step-by-step procedures it follows whenever the work matches."
      className="w-[min(96vw,34rem)]"
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!staff.data}>Save</Button>
        </div>
      }
    >
      {staff.data ? (
        staff.data.workflows.length ? (
          <div className="grid gap-2">
            {staff.data.workflows.map((w) => {
              const on = current.includes(w.id);
              return (
                <ChoiceCard
                  key={w.id}
                  kind="checkbox"
                  on={on}
                  onToggle={() => setPicked(on ? current.filter((x) => x !== w.id) : [...current, w.id])}
                  title={w.name}
                  hint={[w.description, `${w.steps} step${w.steps === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
                  trailing={w.status === "draft" ? <Pill>Draft</Pill> : null}
                />
              );
            })}
            <FormError message={save.error ? errorMessage(save.error) : null} />
          </div>
        ) : (
          <p className="text-[13px] text-muted">No workflows yet. Your manager can draw them in Workflows.</p>
        )
      ) : (
        <Skeleton className="h-40 rounded-[var(--radius-md)]" />
      )}
    </ResponsiveDialog>
  );
}

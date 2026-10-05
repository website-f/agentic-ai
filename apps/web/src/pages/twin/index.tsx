/** My twin (P18): a staff member's AI twin, their virtual self at work. Chat with it, see its
 * tasks and what it knows about you, teach it, and edit its persona with the wizard. */
import {
  BookOpenTextIcon,
  CaretDownIcon,
  BrainIcon,
  ChatsCircleIcon,
  ClockIcon,
  GraduationCapIcon,
  HandIcon,
  KanbanIcon,
  LightbulbIcon,
  PauseIcon,
  PencilSimpleIcon,
  PlayIcon,
  PlusIcon,
  ShieldCheckIcon,
  SparkleIcon,
  UserFocusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { TwinPill } from "@/components/agent-access";
import { AgentAvatar } from "@/components/agent-avatar";
import { EmptyState, IconTile, Page, PageHeader } from "@/components/page";
import { Trans } from "@/components/trans";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, ListCard, ListRow, Meta } from "@/components/ui/card";
import { FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { msg, useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { brainKeys } from "@/lib/brain";
import { meQuery } from "@/lib/queries";
import { startingAnswers, teachTwin, twinKeys, twinQuery, type TwinState } from "@/lib/twin";
import { cn, timeAgo } from "@/lib/utils";
import { STATUS_INFO, workKeys, type Agent, type Task } from "@/lib/work";
import { ChatPanel } from "@/pages/agents/chat-panel";
import { MemoryTab } from "@/pages/agents/memory-tab";
import { LearnSourceDialog } from "@/pages/learning/learn-source-dialog";

import { TwinDuo, useAdopt } from "./meet-card";
import { TwinWizard } from "./wizard";

type Tab = "chat" | "tasks" | "memory" | "teach";

function NoTwin({ state, onCreate }: { state: TwinState; onCreate: () => void }) {
  const t = useT();
  const adopt = useAdopt();
  const points = [
    { icon: UserFocusIcon, title: t("Works like you"), body: t("Knows your job, your tone and your languages, and follows your team's SOPs.") },
    { icon: HandIcon, title: t("Asks you first"), body: t("Stops before anything on your list. Sending forms and running code always need you.") },
    { icon: GraduationCapIcon, title: t("Learns as you go"), body: t("Remembers what you teach it and what it learns from finished work.") },
  ];
  return (
    <>
      <section className="relative overflow-hidden rounded-[var(--radius-lg)] border border-accent/25 bg-surface shadow-[var(--shadow-soft)]">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_60%)]" />
        <div className="relative grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-7">
          <TwinDuo state={state} />
          <div className="min-w-0">
            <h2 className="text-[19px] leading-snug font-semibold text-balance">{t("Meet your AI twin, {name}", { name: state.person.first_name })}</h2>
            <p className="mt-1 max-w-[62ch] text-[13.5px] text-muted">
              {t("Your virtual self at work. It handles routine tasks the way you would, and asks you before anything important.")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 max-sm:[&>*]:w-full">
              {state.adoptable.length ? (
                state.adoptable.map((a) => (
                  <Button key={a.id} loading={adopt.isPending && adopt.variables === a.id} onClick={() => adopt.mutate(a.id)}>
                    <UserFocusIcon size={16} weight="bold" /> {t("Make {name} my twin", { name: a.name })}
                  </Button>
                ))
              ) : (
                <Button size="lg" onClick={onCreate} disabled={!state.can_create}>
                  <SparkleIcon size={16} weight="fill" /> {t("Create my twin")}
                </Button>
              )}
            </div>
            {state.adoptable.length ? (
              <p className="mt-2 text-[12.5px] text-muted">
                {state.adoptable.length === 1 ? t("Staff have one agent. You already have one, so it becomes your twin instead of adding another.") : t("Staff have one agent. You already have some, so it becomes your twin instead of adding another.")}
              </p>
            ) : !state.can_create ? (
              <p className="mt-2 text-[12.5px] text-muted">{t("Ask an admin to set up your company first.")}</p>
            ) : null}
          </div>
        </div>
      </section>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
        {points.map((p) => (
          <Card key={p.title} className="flex gap-3 p-4">
            <IconTile icon={p.icon} size="sm" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">{p.title}</p>
              <p className="text-[12.5px] text-muted">{p.body}</p>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}

function Profile({ state, twin }: { state: TwinState; twin: Agent }) {
  const t = useT();
  const a = startingAnswers(state);
  const helps = state.options.helps_with.filter((h) => a.helps_with.includes(h.key)).map((h) => h.label);
  const asks = state.options.ask_first.filter((o) => o.locked || a.ask_first.includes(o.key)).map((o) => o.label);
  const status = twin.status === "paused" ? { label: msg("Paused"), tone: "neutral" as const }
    : twin.current_task?.status === "blocked" ? { label: msg("Waiting on you"), tone: "warn" as const }
    : twin.current_task ? { label: msg("Working"), tone: "accent" as const } : { label: msg("Available"), tone: "info" as const };
  // Phones: the details fold away so the chat and tabs stay near the top.
  const [more, setMore] = useState(false);
  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 h-20 opacity-[0.12]" style={{ background: twin.color }} />
      <div className="relative grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 items-start gap-4">
          <AgentAvatar name={twin.name} color={twin.color} size="lg" working={status.label === "Working"} className="ring-4 ring-surface" />
          <div className="grid min-w-0 gap-2">
            <div className="min-w-0">
              <p className="text-[17px] leading-snug font-semibold break-words">{twin.name}</p>
              <p className="text-[13px] text-muted break-words">{twin.role} · {twin.department_name ?? twin.branch_name}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <TwinPill person={state.person.name} />
              <Pill tone={status.tone}>{t(status.label)}</Pill>
              {twin.heartbeat ? <Pill tone="info">{t("Picks up work by itself")}</Pill> : null}
            </div>
            {a.job ? <p className="max-w-[60ch] text-[13.5px] break-words">{a.job}</p> : (
              <p className="text-[13px] text-muted">{t("It does not know your job yet. Tell it with Edit persona.")}</p>
            )}
            {twin.current_task ? (
              <p className="text-[12.5px] text-muted"><Trans text={t("On: {title}")} values={{ title: <span className="text-fg">{twin.current_task.title}</span> }} /></p>
            ) : null}
          </div>
        </div>
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)}
          className="flex min-h-10 items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 text-left text-[13px] lg:hidden">
          <span className="min-w-0 truncate"><span className="font-medium">{t("Helps with {n}", { n: helps.length })}</span><span className="text-muted"> · {t("asks you first about {n} things", { n: asks.length })}</span></span>
          <CaretDownIcon size={14} className={cn("shrink-0 text-muted transition-transform", more && "rotate-180")} />
        </button>
        <div className={cn("min-w-0 content-start gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-3.5 lg:grid", more ? "grid" : "hidden")}>
          {helps.length ? (
            <div className="grid gap-1.5">
              <p className="text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase">{t("Helps you with")}</p>
              <div className="flex flex-wrap gap-1.5">{helps.map((h) => <Pill key={h} tone="accent">{h}</Pill>)}</div>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <p className="flex items-center gap-1 text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase"><ShieldCheckIcon size={12} weight="bold" /> {t("Asks you first")}</p>
            <p className="text-[12.5px] break-words">{asks.join(" · ")}</p>
          </div>
          <p className="flex items-center gap-1.5 text-[12.5px] text-muted"><ClockIcon size={14} className="shrink-0" /> {a.hours} · {a.languages.join(", ")}</p>
        </div>
      </div>
    </Card>
  );
}

function Tasks({ twin, canWrite }: { twin: Agent; canWrite: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const { data = [], isLoading, error } = useQuery({
    queryKey: [...workKeys.tasks, "agent", twin.id],
    queryFn: () => api<Task[]>(`/api/tasks?agent_id=${twin.id}&limit=50`),
  });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">{t("What {name} is doing and has done. It tells you when something needs you.", { name: twin.name })}</p>
        {canWrite ? (
          <Button size="sm" onClick={() => navigate({ to: "/tasks", search: { new: 1, agent: twin.id } })}>
            <PlusIcon size={15} weight="bold" /> {t("Give it a task")}
          </Button>
        ) : null}
      </div>
      {isLoading ? <Skeleton className="h-40 rounded-[var(--radius-md)]" /> : error ? (
        <p role="alert" className="text-[13px] text-danger">{errorMessage(error)}</p>
      ) : data.length ? (
        <ListCard>
          {data.map((task) => {
            const info = STATUS_INFO[task.status];
            return (
              <ListRow
                key={task.id}
                onClick={() => navigate({ to: "/tasks", search: { task: task.id } })}
                leading={<IconTile icon={KanbanIcon} size="sm" tone={info.tone === "ok" ? "ok" : info.tone === "warn" ? "warn" : info.tone === "danger" ? "danger" : "accent"} />}
                title={task.title}
                meta={<Meta items={[t("Updated {ago}", { ago: timeAgo(task.updated_at) }), task.pending_approvals ? t("{n} waiting on you", { n: task.pending_approvals }) : null]} />}
                trailing={<Pill tone={info.tone}>{t(info.label)}</Pill>}
              />
            );
          })}
        </ListCard>
      ) : (
        <EmptyState icon={KanbanIcon} title={t("No tasks yet")} body={t("Give {name} something routine to start with, like a weekly summary or a follow-up list.", { name: twin.name })} />
      )}
    </div>
  );
}

function Teach({ twin, state, canWrite }: { twin: Agent; state: TwinState; canWrite: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [learnOpen, setLearnOpen] = useState(false);
  const [learnKey, setLearnKey] = useState(0);
  const teach = useMutation({
    mutationFn: (target: "user" | "memory") => teachTwin(text.trim(), target),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: brainKeys.core(twin.id) });
      toast.success(t("{name} will keep that in mind from its next task or chat.", { name: twin.name }));
    },
  });
  const ideas = [
    t("My manager is ..."),
    t("I send the weekly report every Friday by 4pm."),
    t("Clients prefer quotations in PDF with our letterhead."),
  ];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <Card>
        <CardHeader icon={<IconTile icon={LightbulbIcon} size="sm" />} title={t("Remember this")} description={t("One thing {name} should always know. It goes into its memory.", { name: twin.name })} />
        <CardBody className="grid gap-3">
          <TextareaField label={t("What should it remember?")} rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)}
            disabled={!canWrite} placeholder={ideas[1]} hint={t("Never passwords, card or IC numbers. Those are refused.")} />
          <div className="flex flex-wrap gap-1.5">
            {ideas.map((i) => (
              <button key={i} type="button" onClick={() => setText(i)} className="inline-flex h-8 items-center rounded-full border border-border px-3 text-[12.5px] text-muted hover:border-accent/40 hover:text-fg">
                {i}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 max-sm:[&>*]:flex-1">
            <Button disabled={!canWrite || text.trim().length < 3} loading={teach.isPending && teach.variables === "user"} onClick={() => teach.mutate("user")}>
              {t("Remember about me")}
            </Button>
            <Button variant="outline" disabled={!canWrite || text.trim().length < 3} loading={teach.isPending && teach.variables === "memory"} onClick={() => teach.mutate("memory")}>
              {t("Save as a working note")}
            </Button>
          </div>
          <FormError message={teach.error ? errorMessage(teach.error) : null} />
        </CardBody>
      </Card>
      <div className="grid content-start gap-3">
        <Card className="flex gap-3 p-4">
          <IconTile icon={GraduationCapIcon} size="sm" tone="violet" />
          <div className="grid min-w-0 gap-2">
            <div>
              <p className="text-[13.5px] font-medium">{t("Teach it a whole procedure")}</p>
              <p className="text-[12.5px] text-muted">{t("Point at a web page, a file or your own notes. It is written up as a skill, tested, then used by your twin.")}</p>
            </div>
            <Button size="sm" variant="outline" className="w-fit" disabled={!canWrite} onClick={() => { setLearnKey((k) => k + 1); setLearnOpen(true); }}>
              <BookOpenTextIcon size={15} /> {t("Learn from a source")}
            </Button>
          </div>
        </Card>
        <Card className="flex gap-3 p-4">
          <IconTile icon={BrainIcon} size="sm" tone="info" />
          <div className="grid min-w-0 gap-1.5">
            <p className="text-[13.5px] font-medium">{t("SOPs it follows")}</p>
            {state.sops.length ? (
              <ul className="grid gap-0.5 text-[12.5px] text-muted">
                {state.sops.slice(0, 5).map((s) => <li key={s.id} className="break-words"><span className="text-fg">{s.title}</span> · {s.scope_label}</li>)}
              </ul>
            ) : <p className="text-[12.5px] text-muted">{t("None written for your team yet.")}</p>}
            <Link to="/sops" className="text-[12.5px] font-medium text-accent hover:underline">{t("Open SOPs")}</Link>
          </div>
        </Card>
      </div>
      {learnOpen ? <LearnSourceDialog key={learnKey} open={learnOpen} onOpenChange={setLearnOpen} /> : null}
    </div>
  );
}

export function TwinPage() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const { data: state, isLoading, error } = useQuery(twinQuery);
  const search = useSearch({ strict: false }) as { tab?: Tab; edit?: number };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [wizard, setWizard] = useState(!!search.edit);
  const [wizardKey, setWizardKey] = useState(0);
  const tab: Tab = search.tab ?? "chat";
  const canWrite = me.permissions.includes("work.write");
  const twin = state?.twin ?? null;

  const pause = useMutation({
    mutationFn: (next: "active" | "paused") => api<Agent>(`/api/agents/${twin?.id}`, "PATCH", { status: next }),
    onSuccess: (a) => {
      qc.invalidateQueries({ queryKey: twinKeys.me });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      toast.success(a.status === "paused" ? t("{name} is paused. It takes no new work until you resume it.", { name: a.name }) : t("{name} is back at work.", { name: a.name }));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const openWizard = () => {
    setWizardKey((k) => k + 1);
    setWizard(true);
  };
  const closeWizard = (o: boolean) => {
    setWizard(o);
    if (!o && search.edit) navigate({ to: "/twin", search: { tab: search.tab }, replace: true });
  };

  if (isLoading || !state) {
    return (
      <Page>
        <PageHeader title={t("My twin")} description={t("Your virtual self at work.")} />
        {error ? <p role="alert" className="text-danger">{errorMessage(error)}</p> : (
          <>
            <Skeleton className="h-44 rounded-[var(--radius-md)]" />
            <Skeleton className="h-[26rem] rounded-[var(--radius-md)]" />
          </>
        )}
      </Page>
    );
  }

  if (!state.eligible) {
    return (
      <Page>
        <PageHeader title={t("My twin")} description={t("AI twins are for staff: one agent each, their virtual self at work.")} />
        <EmptyState icon={UserFocusIcon} title={t("Twins are for staff")} body={t("Your role adds and manages agents directly. You can still see everyone's twins in Agents and the office.")}
          action={<Button asChild variant="outline"><Link to="/agents">{t("Open Agents")}</Link></Button>} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title={twin ? twin.name : t("My twin")}
        description={twin ? t("Your AI twin: your virtual self at work. It works the way you do and asks you before anything important.") : t("Your virtual self at work.")}
        actions={twin ? (
          <>
            <Button variant="outline" onClick={() => pause.mutate(twin.status === "paused" ? "active" : "paused")} loading={pause.isPending}>
              {twin.status === "paused" ? <><PlayIcon size={16} weight="fill" /> {t("Resume")}</> : <><PauseIcon size={16} weight="fill" /> {t("Pause")}</>}
            </Button>
            <Button onClick={openWizard}><PencilSimpleIcon size={16} /> {t("Edit persona")}</Button>
          </>
        ) : null}
      />
      {twin ? (
        <>
          <Profile state={state} twin={twin} />
          {!state.profile ? (
            <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-accent/30 bg-accent-soft/40 px-4 py-3">
              <SparkleIcon size={18} weight="fill" className="shrink-0 text-accent" />
              <p className="min-w-0 flex-1 basis-56 text-[13px]">{t("Tell {name} about you: your job, your tone and what it should ask first. Three short steps.", { name: twin.name })}</p>
              <Button size="sm" onClick={openWizard}>{t("Tell it about me")}</Button>
            </div>
          ) : null}
          <Segmented<Tab>
            label={t("My twin")}
            value={tab}
            onChange={(v) => navigate({ to: "/twin", search: { tab: v === "chat" ? undefined : v }, replace: true })}
            options={[
              { value: "chat", label: t("Chat") },
              { value: "tasks", label: t("Tasks"), count: twin.open_tasks },
              { value: "memory", label: t("What it knows") },
              { value: "teach", label: t("Teach it") },
            ]}
            className="w-full sm:w-fit [&>button]:flex-1 [&>button]:justify-center"
          />
          {tab === "chat" ? (
            <ChatPanel agent={twin} canWrite={canWrite} className="h-[min(70dvh,40rem)] min-h-[24rem]" />
          ) : tab === "tasks" ? (
            <Tasks twin={twin} canWrite={canWrite} />
          ) : tab === "memory" ? (
            <MemoryTab agent={twin} canWrite={canWrite} />
          ) : (
            <Teach twin={twin} state={state} canWrite={canWrite} />
          )}
          <p className="flex items-center gap-1.5 text-[12px] text-muted">
            <ChatsCircleIcon size={14} className="shrink-0" /> {t("Your manager can see {name}'s work like any agent in your team, and colleagues can watch it, but only you shape who it is.", { name: twin.name })}
          </p>
        </>
      ) : (
        <NoTwin state={state} onCreate={openWizard} />
      )}
      {wizard ? <TwinWizard key={wizardKey} state={state} open={wizard} onOpenChange={closeWizard} /> : null}
    </Page>
  );
}

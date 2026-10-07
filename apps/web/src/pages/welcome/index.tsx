/** Staff onboarding (P19): "Hire your AI worker". Phone-first, full screen, five steps:
 * your company -> meet your AI worker -> its job -> working hours -> offer letter. The worker
 * is the person's AI twin (P18); steps 3-5 are saved together when they press Hire. */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BlueprintIcon,
  BriefcaseIcon,
  BuildingsIcon,
  CheckIcon,
  ClockIcon,
  FlowArrowIcon,
  HandIcon,
  ListChecksIcon,
  LockSimpleIcon,
  PlusIcon,
  RepeatIcon,
  SignatureIcon,
  SparkleIcon,
  TrashIcon,
  UserFocusIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Trans } from "@/components/trans";
import { LogoMark } from "@/components/logo";
import { IconTile } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Skeleton } from "@/components/ui/skeleton";
import { SwitchField } from "@/components/ui/switch";
import { locale, msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import {
  describeHours,
  hireWorker,
  hoursProblem,
  setPlacement,
  staffKeys,
  staffQuery,
  type DutyIn,
  type HireOut,
  type StaffState,
  type WorkHours,
} from "@/lib/staff";
import { adoptTwin, saveTwin, startingAnswers, twinKeys, twinQuery, type TwinState } from "@/lib/twin";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";

import { ChoiceCard, DutyForm, EMPTY_DUTY, HoursEditor, UrgentPill, useDutyReady, WeekTimeline } from "./parts";

const STEPS: { title: string; short: string; icon: Icon }[] = [
  { title: msg("Your company"), short: msg("Company"), icon: BuildingsIcon },
  { title: msg("Meet your AI worker"), short: msg("Worker"), icon: UserFocusIcon },
  { title: msg("Its job"), short: msg("Job"), icon: BriefcaseIcon },
  { title: msg("Working hours"), short: msg("Hours"), icon: ClockIcon },
  { title: msg("Offer letter"), short: msg("Offer"), icon: SignatureIcon },
];

export function WelcomePage() {
  const staff = useQuery(staffQuery);
  const tw = useQuery(twinQuery);
  if (staff.error || tw.error) {
    return (
      <Shell step={0}>
        <FormError message={errorMessage(staff.error ?? tw.error)} />
      </Shell>
    );
  }
  if (!staff.data || !tw.data) {
    return (
      <Shell step={0}>
        <div className="grid gap-4" aria-busy>
          <Skeleton className="h-8 w-2/3 rounded-sm" />
          <Skeleton className="h-4 w-full rounded-sm" />
          <Skeleton className="h-16 rounded-[var(--radius-md)]" />
          <Skeleton className="h-16 rounded-[var(--radius-md)]" />
        </div>
      </Shell>
    );
  }
  return <Onboarding staff={staff.data} tw={tw.data} />;
}

/** The full-screen frame: brand, progress, the step, and a footer that stays reachable. */
function Shell({ step, children, footer, done }: { step: number; children: ReactNode; footer?: ReactNode; done?: boolean }) {
  const t = useT();
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header
        className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur-md"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto grid w-full max-w-2xl gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2.5">
              <LogoMark className="size-7" />
              <span className="truncate text-[14px] font-semibold">{t("Hire your AI worker")}</span>
            </span>
            {done ? null : (
              <Button asChild variant="ghost" size="sm">
                <Link to="/my-worker">{t("Later")}</Link>
              </Button>
            )}
          </div>
          <ol className="grid grid-cols-5 gap-1.5" aria-label={t("Steps")}>
            {STEPS.map((s, i) => (
              <li key={s.title} className="grid min-w-0 gap-1" aria-current={i === step ? "step" : undefined}>
                <span className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <motion.span
                    className="block h-full rounded-full bg-accent"
                    initial={false}
                    animate={{ width: done || i <= step ? "100%" : "0%" }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                  />
                </span>
                <span className={cn("truncate text-[11px] max-sm:sr-only", i === step ? "font-medium text-fg" : "text-muted")}>{t(s.short)}</span>
              </li>
            ))}
          </ol>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pt-6 pb-36 sm:px-6 sm:pt-8">{children}</main>
      {footer ? (
        <footer
          className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur-md"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3 sm:px-6">{footer}</div>
        </footer>
      ) : null}
    </div>
  );
}

function StepHead({ step, title, body }: { step: number; title: ReactNode; body: ReactNode }) {
  const t = useT();
  const s = STEPS[step]!;
  return (
    <div className="mb-6 flex min-w-0 items-start gap-3.5">
      <IconTile icon={s.icon} size="lg" className="max-sm:size-10" />
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">{t("Step {n} of {total}", { n: step + 1, total: STEPS.length })}</p>
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-balance break-words sm:text-[26px]">{title}</h1>
        <p className="mt-1.5 text-[13.5px] text-muted">{body}</p>
      </div>
    </div>
  );
}

function Block({ title, hint, icon, children }: { title: string; hint?: ReactNode; icon?: Icon; children: ReactNode }) {
  return (
    <section className="grid min-w-0 gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <IconTile icon={icon} size="sm" tone="neutral" /> : null}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

interface Worker {
  name: string;
  role: string;
  style: string;
  ask_first: string[];
}

interface FirstTask {
  on: boolean;
  title: string;
  brief: string;
  urgent: boolean;
}

function Onboarding({ staff, tw }: { staff: StaffState; tw: TwinState }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const p = staff.placement;
  const [place, setPlace] = useState<{ branch_id: string | null; department_id: string | null }>(() => ({
    branch_id: p.branch_id ?? (staff.companies.length === 1 ? staff.companies[0]!.id : null),
    department_id: p.department_id,
  }));
  const [worker, setWorker] = useState<Worker>(() => {
    const a = startingAnswers(tw);
    return { name: a.name, role: a.role, style: a.style ?? "", ask_first: a.ask_first ?? [] };
  });
  const [blueprintId, setBlueprintId] = useState<string | null>(null);
  const [workflowIds, setWorkflowIds] = useState<string[]>(() => staff.workflows.filter((w) => w.following).map((w) => w.id));
  const [duties, setDuties] = useState<DutyIn[]>([]);
  const [draft, setDraft] = useState<DutyIn | null>(null);
  const [first, setFirst] = useState<FirstTask>({ on: false, title: "", brief: "", urgent: false });
  const [hours, setHours] = useState<WorkHours>(staff.default_hours);
  const [done, setDone] = useState<HireOut | null>(null);
  const draftReady = useDutyReady(draft ?? EMPTY_DUTY);

  const company = staff.companies.find((c) => c.id === place.branch_id) ?? null;
  const dept = company?.departments.find((d) => d.id === place.department_id) ?? null;
  const twinName = worker.name.trim() || tw.suggested.name;
  const color = tw.twin?.color ?? tw.suggested.color;
  const first_name = staff.person.first_name;

  const go = (n: number) => {
    setDir(n > step ? 1 : -1);
    setStep(n);
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  const placeM = useMutation({
    mutationFn: () => setPlacement(place.branch_id!, place.department_id),
    onSuccess: (s) => {
      qc.setQueryData(staffKeys.state, s);
      qc.invalidateQueries({ queryKey: twinKeys.me });
      qc.invalidateQueries({ queryKey: keys.me });
      go(1);
    },
  });
  const twinM = useMutation({
    mutationFn: () => saveTwin({ ...startingAnswers(tw), ...worker, name: worker.name.trim(), role: worker.role.trim() }, !!tw.twin),
    onSuccess: (s) => {
      qc.setQueryData(twinKeys.me, s);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      if (!tw.twin) toast.success(s.twin?.name ? t("{name} is here. Now give it a job.", { name: s.twin.name }) : t("Your AI worker is here. Now give it a job."));
      go(2);
    },
  });
  const adoptM = useMutation({
    mutationFn: adoptTwin,
    onSuccess: (s) => {
      qc.setQueryData(twinKeys.me, s);
      if (s.twin) setWorker((w) => ({ ...w, name: s.twin!.name, role: s.twin!.role }));
      toast.success(s.twin?.name ? t("{name} is now your AI worker.", { name: s.twin.name }) : t("Your agent is now your AI worker."));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const hireM = useMutation({
    mutationFn: () =>
      hireWorker({
        blueprint_id: blueprintId,
        workflow_ids: workflowIds,
        duties,
        work_hours: hours,
        first_task: first.on && first.title.trim() ? { title: first.title.trim(), brief: first.brief, urgent: first.urgent } : null,
      }),
    onSuccess: (out) => {
      setDone(out);
      qc.invalidateQueries({ queryKey: staffKeys.state });
      qc.invalidateQueries({ queryKey: staffKeys.worker });
      qc.invalidateQueries({ queryKey: twinKeys.me });
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: ["me", "prefs"] });
      out.warnings.forEach((w) => toast.warning(w));
    },
  });

  const placeChanged = place.branch_id !== p.branch_id || place.department_id !== p.department_id;
  const canNext = [
    !!place.branch_id && !placeM.isPending,
    worker.name.trim().length > 0 && worker.role.trim().length > 0 && !twinM.isPending,
    !draft,
    !hoursProblem(hours),
    true,
  ][step];

  const next = () => {
    if (step === 0) {
      if (placeChanged && p.can_choose) placeM.mutate();
      else go(1);
    } else if (step === 1) {
      twinM.mutate();
    } else if (step < 4) {
      go(step + 1);
    } else {
      hireM.mutate();
    }
  };
  const error = [placeM.error, twinM.error, null, null, hireM.error][step];

  if (done) {
    return (
      <Shell step={4} done>
        <Hired out={done} hours={hours} color={color} first={first_name} onGo={() => navigate({ to: "/my-worker" })} />
      </Shell>
    );
  }

  const footer = (
    <>
      {step > 0 ? (
        <Button variant="outline" size="lg" onClick={() => go(step - 1)} disabled={hireM.isPending} className="max-sm:px-4">
          <ArrowLeftIcon size={16} /> <span className="max-sm:sr-only">{t("Back")}</span>
        </Button>
      ) : null}
      <Button size="lg" className="flex-1 sm:ml-auto sm:flex-none sm:min-w-44" onClick={next} disabled={!canNext} loading={placeM.isPending || twinM.isPending || hireM.isPending}>
        {step === 4 ? (
          <>
            <SignatureIcon size={17} weight="bold" /> <span className="truncate">{t("Hire {name}", { name: twinName })}</span>
          </>
        ) : step === 1 && !tw.twin ? (
          <>
            <SparkleIcon size={16} weight="fill" /> <span className="truncate">{t("Create {name}", { name: twinName })}</span>
          </>
        ) : (
          <>
            {t("Next")} <ArrowRightIcon size={16} />
          </>
        )}
      </Button>
    </>
  );

  return (
    <Shell step={step} footer={footer}>
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.div
          key={step}
          custom={dir}
          initial={reduce ? false : { opacity: 0, x: 24 * dir }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? undefined : { opacity: 0, x: -24 * dir }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="grid min-w-0 gap-6"
        >
          {step === 0 ? (
            <CompanyStep staff={staff} place={place} setPlace={setPlace} />
          ) : step === 1 ? (
            <WorkerStep tw={tw} staff={staff} worker={worker} setWorker={setWorker} color={color} company={company?.name ?? null} dept={dept?.name ?? null} onAdopt={(id) => adoptM.mutate(id)} adopting={adoptM.isPending} />
          ) : step === 2 ? (
            <div className="grid min-w-0 gap-8">
              <StepHead step={2} title={t("What will {name} do?", { name: twinName })} body={t("Pick a ready-made role, the workflows it follows, its recurring duties and a first task. All optional: you can change them any time.")} />
              <Block title={t("Role blueprint")} icon={BlueprintIcon} hint={t("A ready-made role from your company. It adds the role's know-how, SOPs and skills; your worker keeps its own name and manners.")}>
                <div className="grid gap-2" role="radiogroup" aria-label={t("Role blueprint")}>
                  <ChoiceCard on={blueprintId === null} onToggle={() => setBlueprintId(null)} title={t("No blueprint")} hint={t("Just what you told it, and your team's SOPs.")} />
                  {staff.blueprints.map((b) => (
                    <ChoiceCard key={b.id} on={blueprintId === b.id} onToggle={() => setBlueprintId(b.id)} title={b.name} hint={b.description || b.role || undefined} />
                  ))}
                </div>
                {staff.blueprints.length === 0 ? <p className="text-[12.5px] text-muted">{t("Your company has no blueprints yet.")}</p> : null}
              </Block>
              <Block title={t("Workflows it follows")} icon={FlowArrowIcon} hint={t("Step-by-step procedures. It follows them whenever the work matches.")}>
                {staff.workflows.length ? (
                  <div className="grid gap-2">
                    {staff.workflows.map((w) => {
                      const on = workflowIds.includes(w.id);
                      return (
                        <ChoiceCard
                          key={w.id}
                          kind="checkbox"
                          on={on}
                          onToggle={() => setWorkflowIds((x) => (on ? x.filter((y) => y !== w.id) : [...x, w.id]))}
                          title={w.name}
                          hint={[w.description, w.steps === 1 ? t("1 step") : t("{n} steps", { n: w.steps })].filter(Boolean).join(" · ")}
                          trailing={w.status === "draft" ? <Pill>{t("Draft")}</Pill> : null}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-muted">{t("No workflows yet. Your manager can draw them in Workflows.")}</p>
                )}
              </Block>
              <Block title={t("Recurring duties")} icon={RepeatIcon} hint={t("Work it does on a rhythm, like a weekly report. It does them in its working hours.")}>
                {duties.length ? (
                  <ul className="grid gap-2">
                    {duties.map((d, i) => (
                      <li key={i} className="flex min-w-0 items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-3.5 py-2.5">
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="flex min-w-0 flex-wrap items-center gap-2 text-[14px] font-medium break-words">{d.title}{d.urgent ? <UrgentPill /> : null}</span>
                          <span className="text-[12.5px] break-words text-muted">{d.when}</span>
                        </span>
                        <Button variant="ghost" size="icon" aria-label={t("Remove {name}", { name: d.title })} onClick={() => setDuties((x) => x.filter((_, j) => j !== i))}>
                          <TrashIcon size={16} />
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {draft ? (
                  <Card className="grid gap-4 p-4">
                    <DutyForm value={draft} onChange={setDraft} urgentAllowed={hours.urgent_anytime} />
                    <div className="flex flex-wrap justify-end gap-2 max-sm:[&>*]:flex-1">
                      <Button variant="outline" onClick={() => setDraft(null)}>{t("Cancel")}</Button>
                      <Button
                        disabled={!draftReady}
                        onClick={() => {
                          setDuties((x) => [...x, { ...draft, title: draft.title.trim(), when: draft.when.trim() }]);
                          setDraft(null);
                        }}
                      >
                        <CheckIcon size={15} weight="bold" /> {t("Add duty")}
                      </Button>
                    </div>
                  </Card>
                ) : duties.length < 10 ? (
                  <Button variant="outline" className="justify-self-start max-sm:w-full" onClick={() => setDraft({ ...EMPTY_DUTY })}>
                    <PlusIcon size={15} weight="bold" /> {t("Add a duty")}
                  </Button>
                ) : null}
              </Block>
              <Block title={t("A first task")} icon={ListChecksIcon} hint={t("Something to start on right away (or as soon as its working day begins).")}>
                <Card className="grid gap-4 p-4">
                  <SwitchField checked={first.on} onCheckedChange={(on) => setFirst((f) => ({ ...f, on }))} label={t("Give it a first task")} hint={t("It reports back to you when it is done.")} />
                  {first.on ? (
                    <>
                      <Field label={t("Task")} value={first.title} maxLength={200} placeholder={t("e.g. List this month's overdue invoices")} onChange={(e) => setFirst((f) => ({ ...f, title: e.target.value }))} />
                      <TextareaField label={t("Details (optional)")} rows={2} maxLength={8000} value={first.brief} onChange={(e) => setFirst((f) => ({ ...f, brief: e.target.value }))} />
                      <SwitchField checked={first.urgent} onCheckedChange={(urgent) => setFirst((f) => ({ ...f, urgent }))} label={t("Urgent")} hint={t("Urgent work may start outside working hours, if you allow it in the next step.")} />
                    </>
                  ) : null}
                </Card>
              </Block>
              {draft ? <p className="text-[12.5px] text-warn">{t("Add or cancel the duty you are writing before you go on.")}</p> : null}
            </div>
          ) : step === 3 ? (
            <div className="grid min-w-0 gap-6">
              <StepHead step={3} title={t("When does {name} work?", { name: twinName })} body={t("Like any colleague, it works set hours and rests. Work given outside them waits until it is back. Chat always gets an answer.")} />
              <Card className="grid gap-3 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-[14px] font-semibold">{t("Its week")}</p>
                  <p className="text-[12.5px] text-muted">{hoursProblem(hours) ? t("Not complete yet") : describeHours(hours)}</p>
                </div>
                <WeekTimeline key={hours.tz} hours={hours} />
              </Card>
              <HoursEditor value={hours} onChange={setHours} name={twinName} />
            </div>
          ) : (
            <OfferStep
              staff={staff}
              tw={tw}
              worker={worker}
              color={color}
              company={company?.name ?? staff.workspace.name}
              dept={dept?.name ?? null}
              blueprint={staff.blueprints.find((b) => b.id === blueprintId)?.name ?? null}
              workflows={staff.workflows.filter((w) => workflowIds.includes(w.id)).map((w) => w.name)}
              duties={duties}
              first={first.on && first.title.trim() ? first : null}
              hours={hours}
            />
          )}
          <FormError message={error ? errorMessage(error) : null} />
        </motion.div>
      </AnimatePresence>
    </Shell>
  );
}

/* ------------------------------------------------------------ step 1: company */

function CompanyStep({
  staff,
  place,
  setPlace,
}: {
  staff: StaffState;
  place: { branch_id: string | null; department_id: string | null };
  setPlace: (p: { branch_id: string | null; department_id: string | null }) => void;
}) {
  const t = useT();
  const p = staff.placement;
  const company = staff.companies.find((c) => c.id === place.branch_id) ?? null;
  const locked = <span className="inline-flex items-center gap-1 text-[12.5px] text-muted"><LockSimpleIcon size={12} weight="bold" /> {t("Set by your manager")}</span>;
  const dot = (color: string) => <span aria-hidden className="size-3 shrink-0 rounded-full ring-4 ring-surface-2" style={{ background: color }} />;
  return (
    <div className="grid min-w-0 gap-8">
      <StepHead
        step={0}
        title={t("Hi {name}, where do you work?", { name: staff.person.first_name })}
        body={t("Your AI worker sits with you, in your company and department, and follows the SOPs written there.")}
      />
      <Block title={t("Company")} icon={BuildingsIcon}>
        {staff.companies.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-border px-4 py-6 text-center text-[13.5px] text-muted">
            {t("There are no companies yet. Ask an admin to add one, then come back.")}
          </p>
        ) : p.branch_locked ? (
          <ChoiceCard on locked title={p.branch_name} hint={locked} leading={dot(company?.color ?? "var(--accent)")} />
        ) : (
          <div className="grid gap-2" role="radiogroup" aria-label={t("Company")}>
            {staff.companies.map((c) => (
              <ChoiceCard
                key={c.id}
                on={place.branch_id === c.id}
                onToggle={() => setPlace({ branch_id: c.id, department_id: null })}
                title={c.name}
                hint={`${c.departments.length === 1 ? t("1 department") : t("{n} departments", { n: c.departments.length })}${c.industry ? ` · ${c.industry}` : ""}`}
                leading={dot(c.color)}
              />
            ))}
            <p className="text-[12.5px] text-muted">{t("You choose once. After that, only an admin can move you.")}</p>
          </div>
        )}
      </Block>
      {company && company.departments.length ? (
        <Block title={t("Department")} icon={UserFocusIcon}>
          {p.department_locked ? (
            <ChoiceCard on locked title={p.department_name} hint={locked} />
          ) : (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Department")}>
              {company.departments.map((d) => (
                <ChoiceCard key={d.id} on={place.department_id === d.id} onToggle={() => setPlace({ ...place, department_id: d.id })} title={d.name} />
              ))}
              <ChoiceCard on={place.department_id === null} onToggle={() => setPlace({ ...place, department_id: null })} title={t("Not sure yet")} hint={t("Your manager can set it later.")} />
            </div>
          )}
        </Block>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ step 2: the worker */

function WorkerStep({
  tw,
  staff,
  worker,
  setWorker,
  color,
  company,
  dept,
  onAdopt,
  adopting,
}: {
  tw: TwinState;
  staff: StaffState;
  worker: Worker;
  setWorker: (fn: (w: Worker) => Worker) => void;
  color: string;
  company: string | null;
  dept: string | null;
  onAdopt: (id: string) => void;
  adopting: boolean;
}) {
  const t = useT();
  const name = worker.name.trim() || tw.suggested.name;
  const toggle = (k: string) => setWorker((w) => ({ ...w, ask_first: w.ask_first.includes(k) ? w.ask_first.filter((x) => x !== k) : [...w.ask_first, k] }));
  return (
    <div className="grid min-w-0 gap-7">
      <StepHead
        step={1}
        title={t("Meet your AI worker")}
        body={t("Like hiring someone to work on your behalf: give them a name and a job title, and tell them how you like things done.")}
      />
      <Card className="relative overflow-hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 h-14 opacity-[0.14]" style={{ background: color }} />
        <div className="relative flex min-w-0 items-center gap-3.5 p-4">
          <motion.span key={name.slice(0, 1)} initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
            <AgentAvatar name={name} color={color} size="lg" className="ring-4 ring-surface" />
          </motion.span>
          <div className="grid min-w-0 gap-1">
            <p className="text-[16px] leading-snug font-semibold break-words">{name}</p>
            <p className="text-[12.5px] break-words text-muted">
              {worker.role.trim() || tw.suggested.role}
              {company ? ` · ${dept ? `${dept}, ` : ""}${company}` : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <Pill tone="accent"><UserFocusIcon size={12} weight="bold" /> {t("Works for {name}", { name: staff.person.name })}</Pill>
              {tw.twin ? <Pill tone="ok"><CheckIcon size={12} weight="bold" /> {t("Already here")}</Pill> : null}
            </div>
          </div>
        </div>
      </Card>
      {!tw.twin && tw.adoptable.length ? (
        <div className="grid gap-2 rounded-[var(--radius-md)] border border-info/30 bg-info/8 p-4">
          <p className="text-[13.5px]">
            {tw.adoptable.length === 1 ? t("You already have an agent of your own. Make it your AI worker instead of adding another:") : t("You already have agents of your own. Make one your AI worker instead of adding another:")}
          </p>
          <div className="flex flex-wrap gap-2 max-sm:[&>*]:w-full">
            {tw.adoptable.map((a) => (
              <Button key={a.id} variant="outline" loading={adopting} onClick={() => onAdopt(a.id)}>
                <UserFocusIcon size={15} weight="bold" /> {t("Make {name} my worker", { name: a.name })}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 sm:items-start">
        <Field label={t("Its name")} value={worker.name} maxLength={80} onChange={(e) => setWorker((w) => ({ ...w, name: e.target.value }))} hint={t("You can rename it any time.")} />
        <Field label={t("Job title")} value={worker.role} maxLength={120} placeholder={tw.suggested.role} onChange={(e) => setWorker((w) => ({ ...w, role: e.target.value }))} />
      </div>
      <TextareaField
        label={t("How it should work")}
        rows={3}
        maxLength={600}
        value={worker.style}
        onChange={(e) => setWorker((w) => ({ ...w, style: e.target.value }))}
        placeholder={t("For example: double-check every figure, keep replies short, and list what is still pending at the end of the day.")}
        hint={t("In your own words. It works the way you would.")}
      />
      <fieldset className="grid gap-2">
        <legend className="mb-1 flex items-center gap-1.5 text-[13px] font-medium"><HandIcon size={14} weight="bold" /> {t("It must ask you first before")}</legend>
        <p className="mb-1 text-[12.5px] text-muted">{t("It stops and asks you (on your phone too). Untick what it may just do.")}</p>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
          {tw.options.ask_first.map((o) => (
            <ChoiceCard key={o.key} kind="checkbox" on={!!o.locked || worker.ask_first.includes(o.key)} locked={o.locked} onToggle={() => toggle(o.key)} title={o.label} hint={o.locked ? t("Always") : o.hint} />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/* ------------------------------------------------------------ step 5: the offer */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-0.5 border-t border-dashed border-border py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase sm:pt-0.5">{label}</dt>
      <dd className="min-w-0 text-[13.5px] break-words">{children}</dd>
    </div>
  );
}

function OfferStep({
  staff,
  tw,
  worker,
  color,
  company,
  dept,
  blueprint,
  workflows,
  duties,
  first,
  hours,
}: {
  staff: StaffState;
  tw: TwinState;
  worker: Worker;
  color: string;
  company: string;
  dept: string | null;
  blueprint: string | null;
  workflows: string[];
  duties: DutyIn[];
  first: FirstTask | null;
  hours: WorkHours;
}) {
  const t = useT();
  const name = worker.name.trim() || tw.suggested.name;
  const role = worker.role.trim() || tw.suggested.role;
  const asks = tw.options.ask_first.filter((o) => o.locked || worker.ask_first.includes(o.key)).map((o) => o.label.toLowerCase());
  const [today] = useState(() => new Date().toLocaleDateString(locale(), { day: "numeric", month: "long", year: "numeric" }));
  const shift = `${hours.start}–${hours.end}`;
  return (
    <div className="grid min-w-0 gap-6">
      <StepHead step={4} title={t("Your offer letter")} body={t("Read it over, then hire {name}. Everything here can be changed later from My AI.", { name })} />
      <article className="relative overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-pop)]">
        <div aria-hidden className="h-1.5" style={{ background: color }} />
        <div className="grid gap-5 p-5 sm:p-7">
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{t("Letter of appointment")}</p>
              <h2 className="mt-1 text-[19px] leading-snug font-semibold text-balance break-words sm:text-[21px]">
                {t("{name} — {role} at {company}", { name, role, company })}
              </h2>
            </div>
            <AgentAvatar name={name} color={color} size="md" />
          </header>
          <p className="text-[14px] leading-relaxed">
            <Trans
              text={dept
                ? t("{person} hires {name} as their AI worker: {role} in {dept} at {company}. {plain} works on {first}'s behalf, the way {first} would, says it is an AI when it deals with others, and reports back when work is done.")
                : t("{person} hires {name} as their AI worker: {role} at {company}. {plain} works on {first}'s behalf, the way {first} would, says it is an AI when it deals with others, and reports back when work is done.")}
              values={{ person: staff.person.name, name: <strong>{name}</strong>, plain: name, role, dept, company, first: staff.person.first_name }}
            />
          </p>
          <dl className="grid">
            <Row label={t("Works")}>
              {describeHours({ ...hours, breaks: [] })}
              <span className="text-muted"> · {hours.tz.replace(/_/g, " ")}</span>
            </Row>
            <Row label={t("Breaks")}>
              {hours.breaks.length ? hours.breaks.map((b, i) => (i === 0 ? t("Lunch {start}–{end}", { start: b.start, end: b.end }) : t("Break {start}–{end}", { start: b.start, end: b.end }))).join(", ") : t("None: {shift} straight", { shift })}
            </Row>
            <Row label={t("Outside hours")}>{hours.urgent_anytime ? t("Only urgent work, any time.") : t("Rests. New work waits for the next working day.")}</Row>
            <Row label={t("Duties")}>
              <ul className="grid gap-1">
                {blueprint ? <li className="flex gap-1.5"><BlueprintIcon size={15} className="mt-0.5 shrink-0 text-accent" /> {t("Plays the role of {name}", { name: blueprint })}</li> : null}
                {workflows.map((w) => <li key={w} className="flex gap-1.5"><FlowArrowIcon size={15} className="mt-0.5 shrink-0 text-accent" /> {t("Follows the {name} workflow", { name: w })}</li>)}
                {duties.map((d) => (
                  <li key={d.title} className="flex gap-1.5"><RepeatIcon size={15} className="mt-0.5 shrink-0 text-accent" /> <span className="min-w-0">{d.title}, {d.when}{d.urgent ? ` (${t("urgent")})` : ""}</span></li>
                ))}
                {first ? <li className="flex gap-1.5"><ListChecksIcon size={15} className="mt-0.5 shrink-0 text-accent" /> <span className="min-w-0">{t("First task: {title}", { title: first.title.trim() })}</span></li> : null}
                {!blueprint && !workflows.length && !duties.length && !first ? <li className="text-muted">{t("Whatever you give it. It follows your team's SOPs.")}</li> : null}
              </ul>
            </Row>
            <Row label={t("Always asks you before")}>{asks.join(", ")}</Row>
            <Row label={t("Reports to")}>{staff.person.name}{dept ? `, ${dept}` : ""}</Row>
          </dl>
          <footer className="grid grid-cols-2 gap-6 pt-2">
            <div className="grid min-w-0 gap-1">
              <span className="truncate border-b border-fg/40 pb-1 font-serif text-[18px] italic">{staff.person.name}</span>
              <span className="text-[11.5px] text-muted">{t("Signed, {date}", { date: today })}</span>
            </div>
            <div className="grid min-w-0 gap-1">
              <span className="truncate border-b border-fg/40 pb-1 font-serif text-[18px] text-muted italic">{name}</span>
              <span className="text-[11.5px] text-muted">{t("Accepted on hire")}</span>
            </div>
          </footer>
        </div>
      </article>
    </div>
  );
}

/* ------------------------------------------------------------ hired */

function Hired({ out, hours, color, first, onGo }: { out: HireOut; hours: WorkHours; color: string; first: string; onGo: () => void }) {
  const t = useT();
  const reduce = useReducedMotion();
  const name = out.twin.name;
  const bits = Array.from({ length: 18 }, (_, i) => {
    const angle = (i / 18) * Math.PI * 2;
    const r = 64 + (i % 3) * 16;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, d: (i % 4) * 0.04, big: i % 2 === 0 };
  });
  return (
    <div className="grid justify-items-center gap-4 pt-6 text-center">
      <div className="relative grid size-44 place-items-center" aria-hidden>
        {reduce
          ? null
          : bits.map((b, i) => (
              <motion.span
                key={i}
                className={cn("absolute rounded-full", b.big ? "size-2.5" : "size-1.5 bg-accent")}
                style={b.big ? { background: color } : undefined}
                initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
                animate={{ x: b.x, y: b.y, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
                transition={{ duration: 1.2, delay: 0.15 + b.d, ease: "easeOut" }}
              />
            ))}
        <motion.span initial={reduce ? false : { scale: 0.3, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}>
          <AgentAvatar name={name} color={color} size="lg" className="size-20 text-[26px] ring-8 ring-accent-soft" />
        </motion.span>
      </div>
      <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-balance">{t("Welcome aboard, {name}!", { name })}</h1>
      <p className="max-w-md text-[14px] text-muted">
        {t("{first}, your AI worker is hired. It works {hours}, asks you before anything important, and tells you when it finishes.", { first, hours: describeHours(hours) })}
      </p>
      {out.first_task ? (
        <p className="flex max-w-md items-start gap-2 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 text-left text-[13.5px]">
          <ListChecksIcon size={17} className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0 break-words">
            {out.first_task.starts_at ? `${out.first_task.note ?? t("It starts when its working day begins")}: ${out.first_task.title}.` : t("It is starting on \"{title}\" now.", { title: out.first_task.title })}
          </span>
        </p>
      ) : null}
      {out.duties.length ? (
        <div className="flex max-w-md flex-wrap justify-center gap-1.5">
          {out.duties.map((d) => <Pill key={d.id} tone="accent"><RepeatIcon size={12} weight="bold" /> {d.title}: {d.summary}</Pill>)}
        </div>
      ) : null}
      <Button size="lg" className="mt-2 max-sm:w-full" onClick={onGo}>
        {t("Meet {name} at work", { name })} <ArrowRightIcon size={16} />
      </Button>
    </div>
  );
}

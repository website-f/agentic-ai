/** The AI twin wizard (P18): About you -> How it should work -> Review & create, with a live
 * preview of the twin as the person answers. A dialog on desktop, a bottom sheet on phones. */
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  HandIcon,
  LockSimpleIcon,
  SparkleIcon,
  TranslateIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { TwinPill } from "@/components/agent-access";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/ui/dialog";
import { Field, FormError, TextareaField } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { SwitchField } from "@/components/ui/switch";
import { msg, useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { keys } from "@/lib/queries";
import { previewTwin, saveTwin, startingAnswers, twinKeys, type TwinAnswers, type TwinState } from "@/lib/twin";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";

const STEPS = [msg("About you"), msg("How it should work"), msg("Review & create")] as const;
const ONLY_WHEN_ASKED = "Only when I ask";

/** The labels of the chosen keys, in the options' order. */
function picked(options: { key: string; label: string; locked?: boolean }[], keysOn: string[], withLocked = false) {
  return options.filter((o) => keysOn.includes(o.key) || (withLocked && o.locked)).map((o) => o.label);
}

/** The twin as it will look: avatar, name, role, what it does and what it asks first. */
export function TwinPreviewCard({ a, state, className, compact }: { a: TwinAnswers; state: TwinState; className?: string; compact?: boolean }) {
  const t = useT();
  const helps = picked(state.options.helps_with, a.helps_with);
  const asks = picked(state.options.ask_first, a.ask_first, true);
  const name = a.name.trim() || state.suggested.name;
  return (
    <div className={cn("relative min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-soft)]", className)}>
      <div aria-hidden className="absolute inset-x-0 top-0 h-16 opacity-[0.14]" style={{ background: a.color }} />
      <div className={cn("relative grid gap-3", compact ? "p-3" : "p-4")}>
        <div className="flex min-w-0 items-center gap-3">
          <motion.span key={a.color} initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 20 }}>
            <AgentAvatar name={name} color={a.color} size={compact ? "md" : "lg"} className="ring-4 ring-surface" />
          </motion.span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-snug font-semibold break-words">{name}</p>
            <p className="truncate text-[12.5px] text-muted">{a.role.trim() || state.suggested.role}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <TwinPill person={state.person.name} />
          {state.person.department_name ? <Pill>{state.person.department_name}</Pill> : null}
        </div>
        {compact ? null : (
          <>
            {a.job.trim() ? <p className="line-clamp-4 text-[13px] break-words text-fg/90">{a.job.trim()}</p> : null}
            {helps.length ? (
              <div className="grid gap-1.5">
                <p className="text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase">{t("Helps you with")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {helps.map((h) => <Pill key={h} tone="accent">{h}</Pill>)}
                </div>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <p className="flex items-center gap-1 text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase"><HandIcon size={12} weight="bold" /> {t("Asks you first")}</p>
              <ul className="grid gap-1 text-[12.5px]">
                {asks.map((x) => (
                  <li key={x} className="flex items-start gap-1.5"><CheckIcon size={13} weight="bold" className="mt-0.5 shrink-0 text-accent" /> <span className="min-w-0">{x}</span></li>
                ))}
              </ul>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2.5 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1"><ClockIcon size={13} /> {a.hours}</span>
              <span className="inline-flex items-center gap-1"><TranslateIcon size={13} /> {a.languages.join(", ") || "English"}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A toggle chip / card that reads as a checkbox to assistive tech. */
function Choice({ on, onToggle, label, hint, locked, wide }: { on: boolean; onToggle: () => void; label: string; hint?: string; locked?: boolean; wide?: boolean }) {
  const t = useT();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      aria-disabled={locked || undefined}
      onClick={locked ? undefined : onToggle}
      className={cn(
        "flex min-h-11 min-w-0 items-start gap-2.5 rounded-sm border px-3 py-2.5 text-left transition-colors",
        on ? "border-accent/50 bg-accent-soft/60" : "border-border bg-surface hover:border-accent/30 hover:bg-surface-2/50",
        locked && "cursor-default opacity-90",
        wide && "w-full",
      )}
    >
      <span className={cn("mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border transition-colors", on ? "border-accent bg-accent text-accent-fg" : "border-border bg-surface")}>
        {locked ? <LockSimpleIcon size={11} weight="bold" /> : on ? <CheckIcon size={12} weight="bold" /> : null}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-[13.5px] font-medium break-words">{label}{locked ? <span className="ml-1.5 text-[11.5px] font-normal text-muted">{t("Always")}</span> : null}</span>
        {hint ? <span className="text-[12px] text-muted">{hint}</span> : null}
      </span>
    </button>
  );
}

function StepDots({ step }: { step: number }) {
  const t = useT();
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label={t("Steps")}>
      {STEPS.map((s, i) => (
        <li key={s} className="grid gap-1.5" aria-current={i === step ? "step" : undefined}>
          <span className="h-1 overflow-hidden rounded-full bg-surface-2">
            <motion.span className="block h-full rounded-full bg-accent" initial={false} animate={{ width: i <= step ? "100%" : "0%" }} transition={{ duration: 0.35, ease: "easeOut" }} />
          </span>
          <span className={cn("truncate text-[11.5px]", i === step ? "font-medium text-fg" : "text-muted")}>{t(s)}</span>
        </li>
      ))}
    </ol>
  );
}

/** A small burst of colour around the new twin: the "it's alive" moment. */
function Celebrate({ a }: { a: TwinAnswers }) {
  const reduce = useReducedMotion();
  const bits = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    const r = 58 + (i % 3) * 14;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, d: (i % 4) * 0.03, big: i % 2 === 0 };
  });
  return (
    <div className="relative mx-auto grid size-40 place-items-center" aria-hidden>
      {reduce ? null : bits.map((b, i) => (
        <motion.span
          key={i}
          className={cn("absolute rounded-full", b.big ? "size-2.5" : "size-1.5 bg-accent")}
          style={b.big ? { background: a.color } : undefined}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0.4 }}
          animate={{ x: b.x, y: b.y, opacity: [0, 1, 0], scale: [0.4, 1, 0.6] }}
          transition={{ duration: 1.1, delay: 0.15 + b.d, ease: "easeOut" }}
        />
      ))}
      <motion.span initial={reduce ? false : { scale: 0.3, rotate: -12, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 14 }}>
        <AgentAvatar name={a.name} color={a.color} size="lg" className="size-20 text-[26px] ring-8 ring-accent-soft" />
      </motion.span>
    </div>
  );
}

export function TwinWizard({ state, open, onOpenChange }: { state: TwinState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const editing = !!state.twin;
  const [a, setA] = useState<TwinAnswers>(() => startingAnswers(state));
  const [step, setStep] = useState(0);
  const [polish, setPolish] = useState(false);
  const [done, setDone] = useState<TwinState | null>(null);
  const set = <K extends keyof TwinAnswers>(k: K, v: TwinAnswers[K]) => setA((x) => ({ ...x, [k]: v }));
  const toggle = (k: "helps_with" | "ask_first" | "languages", v: string) =>
    setA((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  const save = useMutation({
    mutationFn: () => saveTwin({ ...a, polish }, editing),
    onSuccess: (s) => {
      // A new twin: the cache is updated when the person leaves the celebration, so the card
      // that opened this wizard does not swap itself out underneath it.
      if (editing) qc.setQueryData(twinKeys.me, s);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      qc.invalidateQueries({ queryKey: keys.status });
      const name = s.twin?.name ?? a.name;
      if (editing) {
        toast.success(t("Saved. {name} uses its new persona from the next task or chat.", { name }));
        onOpenChange(false);
      } else {
        toast.success(t("{name} is ready. Say hello!", { name }));
        setDone(s);
      }
    },
  });
  const preview = useMutation({ mutationFn: () => previewTwin({ ...a, polish: false }) });

  const valid = a.name.trim().length > 0 && a.role.trim().length > 0;
  const finish = () => {
    if (done) qc.setQueryData(twinKeys.me, done);
    onOpenChange(false);
    navigate({ to: "/twin" });
  };

  const footer = done ? (
    <Button onClick={finish} className="sm:min-w-40">{done.twin?.name ? t("Meet {name}", { name: done.twin.name }) : t("Meet your twin")} <ArrowRightIcon size={16} /></Button>
  ) : (
    <>
      {step > 0 ? (
        <Button variant="outline" onClick={() => setStep(step - 1)} disabled={save.isPending}><ArrowLeftIcon size={16} /> {t("Back")}</Button>
      ) : (
        <Button variant="outline" onClick={() => onOpenChange(false)}>{editing ? t("Cancel") : t("Not now")}</Button>
      )}
      {step < 2 ? (
        <Button onClick={() => setStep(step + 1)} disabled={!valid}>{t("Next")} <ArrowRightIcon size={16} /></Button>
      ) : (
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!valid}>
          <SparkleIcon size={16} weight="fill" /> {editing ? t("Save changes") : t("Create my twin")}
        </Button>
      )}
    </>
  );

  const first = state.person.first_name;
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => (save.isPending ? null : done && !o ? finish() : onOpenChange(o))}
      title={done ? t("Say hello to your twin") : editing ? (state.twin?.name ? t("Edit {name}", { name: state.twin.name }) : t("Edit your twin")) : t("Meet your AI twin")}
      description={done ? undefined : `${t("Step {n} of {total}", { n: step + 1, total: STEPS.length })} · ${t(STEPS[step]!)}`}
      className="w-[min(96vw,56rem)]"
      footer={<div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
    >
      {done && done.twin ? (
        <div className="grid justify-items-center gap-3 py-4 text-center">
          <Celebrate a={a} />
          <h3 className="text-[18px] font-semibold text-balance">{t("{name} is ready", { name: done.twin.name })}</h3>
          <p className="max-w-md text-[13.5px] text-muted">
            {t("Your virtual self at work. It handles routine tasks the way you would, asks you before anything important, and tells you when it finishes.")}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            <TwinPill person={state.person.name} />
            {done.polished ? <Pill tone="info">{t("Persona polished with AI")}</Pill> : null}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 pt-1">
          <StepDots step={step} />
          {step < 2 ? <TwinPreviewCard a={a} state={state} compact className="md:hidden" /> : null}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_17rem]">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={reduce ? false : { opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce ? undefined : { opacity: 0, x: -16 }}
                transition={{ duration: 0.18 }}
                className="grid min-w-0 content-start gap-4"
              >
                {step === 0 ? (
                  <>
                    <p className="text-[13.5px] text-muted">
                      {t("Hi {name}! Your twin is your virtual self at work. Tell it a little about your job and it will handle routine work the way you would.", { name: first })}
                    </p>
                    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 sm:items-start">
                      <Field label={t("Your twin's name")} value={a.name} maxLength={80} onChange={(e) => set("name", e.target.value)} hint={t("You can rename it any time.")} />
                      <Field label={t("Your job title")} value={a.role} maxLength={120} onChange={(e) => set("role", e.target.value)} placeholder={state.suggested.role} />
                    </div>
                    <TextareaField label={t("What you do")} rows={3} maxLength={600} value={a.job} onChange={(e) => set("job", e.target.value)}
                      hint={t("A sentence or two in your own words. It is the first thing your twin knows about you.")} />
                    <fieldset className="grid gap-2">
                      <legend className="mb-2 text-[13px] font-medium">{t("Languages you work in")}</legend>
                      <div className="flex flex-wrap gap-2">
                        {state.options.languages.map((l) => {
                          const on = a.languages.includes(l);
                          return (
                            <button key={l} type="button" aria-pressed={on} onClick={() => toggle("languages", l)}
                              className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] transition-colors",
                                on ? "border-accent/50 bg-accent-soft text-accent" : "border-border hover:border-accent/30")}>
                              {on ? <CheckIcon size={13} weight="bold" /> : null}{l}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                    <fieldset className="grid gap-2">
                      <legend className="mb-2 text-[13px] font-medium">{t("Its colour")}</legend>
                      <div className="flex flex-wrap gap-2 sm:gap-2.5" role="radiogroup" aria-label={t("Colour")}>
                        {state.options.colors.map((c) => (
                          <button key={c} type="button" role="radio" aria-checked={a.color === c} aria-label={t("Colour {value}", { value: c })} onClick={() => set("color", c)}
                            className={cn("grid size-9 place-items-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-105",
                              a.color === c && "ring-2 ring-fg/70")} style={{ background: c }}>
                            {a.color === c ? <CheckIcon size={15} weight="bold" className="text-white" /> : null}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  </>
                ) : step === 1 ? (
                  <>
                    <fieldset className="grid gap-2">
                      <legend className="mb-2 text-[13px] font-medium">{t("How should it sound?")}</legend>
                      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t("Tone")}>
                        {state.options.tones.map((tone) => (
                          <button key={tone.key} type="button" role="radio" aria-checked={a.tone === tone.key} onClick={() => set("tone", tone.key as TwinAnswers["tone"])}
                            className={cn("grid min-h-11 gap-0.5 rounded-sm border px-3 py-2.5 text-left transition-colors",
                              a.tone === tone.key ? "border-accent/50 bg-accent-soft/60" : "border-border hover:border-accent/30 hover:bg-surface-2/50")}>
                            <span className="text-[13.5px] font-medium">{tone.label}</span>
                            <span className="text-[12px] text-muted first-letter:uppercase">{tone.hint}</span>
                          </button>
                        ))}
                      </div>
                    </fieldset>
                    <TextareaField label={t("How you like to work (optional)")} rows={2} maxLength={600} value={a.style} onChange={(e) => set("style", e.target.value)}
                      placeholder={t("For example: I double-check figures and keep a list of what is pending.")} />
                    <fieldset className="grid gap-2">
                      <legend className="mb-2 text-[13px] font-medium">{t("What should it help with?")}</legend>
                      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                        {state.options.helps_with.map((h) => (
                          <Choice key={h.key} on={a.helps_with.includes(h.key)} onToggle={() => toggle("helps_with", h.key)} label={h.label} hint={h.hint} />
                        ))}
                      </div>
                    </fieldset>
                    <fieldset className="grid gap-2">
                      <legend className="mb-1 text-[13px] font-medium">{t("Always ask me before")}</legend>
                      <p className="mb-1 text-[12.5px] text-muted">{t("Your twin stops and asks you (on your phone too) before these. Untick what it may just do.")}</p>
                      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                        {state.options.ask_first.map((o) => (
                          <Choice key={o.key} on={!!o.locked || a.ask_first.includes(o.key)} locked={o.locked} onToggle={() => toggle("ask_first", o.key)} label={o.label} hint={o.hint} />
                        ))}
                      </div>
                    </fieldset>
                    <div className="grid gap-3 rounded-sm border border-border bg-surface-2/40 p-3">
                      <div className="grid gap-1.5">
                        <span className="text-[13px] font-medium">{t("Working hours")}</span>
                        <Select label={t("Working hours")} className="w-full" value={a.hours} onValueChange={(v) => setA((x) => ({ ...x, hours: v, heartbeat: v === ONLY_WHEN_ASKED ? false : x.heartbeat }))}
                          options={state.options.hours.map((h) => ({ value: h, label: h }))} />
                      </div>
                      <SwitchField checked={a.heartbeat} disabled={a.hours === ONLY_WHEN_ASKED} onCheckedChange={(v) => set("heartbeat", v)}
                        label={t("Pick up waiting work by itself")} hint={t("In your working hours it starts tasks queued for it, without being asked.")} />
                    </div>
                  </>
                ) : (
                  <>
                    <TwinPreviewCard a={a} state={state} className="md:hidden" />
                    <div className="grid gap-2 rounded-sm border border-border p-3">
                      <p className="text-[13px] font-medium">{t("It follows your office's SOPs")}</p>
                      {state.sops.length ? (
                        <ul className="grid gap-1 text-[12.5px] text-muted">
                          {state.sops.slice(0, 6).map((s) => <li key={s.id} className="flex min-w-0 gap-1.5"><CheckIcon size={13} weight="bold" className="mt-0.5 shrink-0 text-accent" /><span className="min-w-0 break-words"><span className="text-fg">{s.title}</span> · {s.scope_label}</span></li>)}
                          {state.sops.length > 6 ? <li>{t("and {n} more", { n: state.sops.length - 6 })}</li> : null}
                        </ul>
                      ) : (
                        <p className="text-[12.5px] text-muted">{state.person.department_name ? t("No written SOPs for {team} yet. It follows them as soon as they are added.", { team: state.person.department_name }) : t("No written SOPs for your team yet. It follows them as soon as they are added.")}</p>
                      )}
                    </div>
                    <SwitchField checked={polish} onCheckedChange={setPolish} label={t("Polish the wording with AI")}
                      hint={t("A quick model rewrites its persona in natural words. If none is available, your answers are used as written.")} />
                    <details className="group rounded-sm border border-border" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !preview.data) preview.mutate(); }}>
                      <summary className="flex min-h-10 cursor-pointer items-center justify-between gap-2 px-3 text-[13px] font-medium">
                        {t("What it will be told")} <ArrowRightIcon size={14} className="text-muted transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="border-t border-border px-3 py-2.5">
                        {preview.isPending ? <p className="text-[12.5px] text-muted">{t("Writing it up…")}</p> : preview.error ? (
                          <p className="text-[12.5px] text-danger">{errorMessage(preview.error)}</p>
                        ) : preview.data ? (
                          <pre className="max-h-64 overflow-y-auto font-sans text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted">{preview.data.soul}</pre>
                        ) : null}
                      </div>
                    </details>
                    <p className="text-[12.5px] text-muted">
                      {editing ? t("Changes apply from its next task or chat.") : a.name.trim() ? t("{name} starts careful: it asks before anything on your list, and your manager can see its work like any agent in your team.", { name: a.name.trim() }) : t("Your twin starts careful: it asks before anything on your list, and your manager can see its work like any agent in your team.")}
                    </p>
                    <FormError message={save.error ? errorMessage(save.error) : null} />
                  </>
                )}
              </motion.div>
            </AnimatePresence>
            <aside className="hidden min-w-0 md:block">
              <div className="sticky top-0 grid gap-2">
                <p className="text-[11.5px] font-medium tracking-[0.05em] text-muted uppercase">{t("Live preview")}</p>
                <TwinPreviewCard a={a} state={state} />
              </div>
            </aside>
          </div>
        </div>
      )}
    </ResponsiveDialog>
  );
}

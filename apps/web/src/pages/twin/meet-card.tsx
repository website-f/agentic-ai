/** The home card that introduces a staff member to their AI twin (P18), or links to it. */
import { ArrowRightIcon, HandIcon, SparkleIcon, UserFocusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import { AgentAvatar } from "@/components/agent-avatar";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { errorMessage } from "@/lib/api";
import { adoptTwin, twinKeys, twinQuery, type TwinState } from "@/lib/twin";
import { cn } from "@/lib/utils";
import { workKeys } from "@/lib/work";

import { TwinWizard } from "./wizard";

/** You and your twin, side by side: the person's initials and the twin-to-be. */
export function TwinDuo({ state, className }: { state: TwinState; className?: string }) {
  const reduce = useReducedMotion();
  const color = state.twin?.color ?? state.suggested.color;
  return (
    <div className={cn("relative flex shrink-0 items-center", className)} aria-hidden>
      <span className="grid size-14 place-items-center rounded-full border-2 border-dashed border-accent/40 bg-surface text-[18px] font-semibold text-muted">
        {state.person.initials}
      </span>
      <motion.span
        className="-ml-4"
        initial={reduce ? false : { x: -14, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 18, delay: 0.1 }}
      >
        <AgentAvatar name={state.twin?.name ?? state.suggested.name} color={color} size="lg" className="ring-4 ring-surface" />
      </motion.span>
      <span className="absolute -right-1 -bottom-1 grid size-6 place-items-center rounded-full bg-accent text-accent-fg ring-2 ring-surface">
        <SparkleIcon size={13} weight="fill" />
      </span>
    </div>
  );
}

/** Adopting an agent the person already has, instead of a second one. */
export function useAdopt() {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: adoptTwin,
    onSuccess: (s) => {
      qc.setQueryData(twinKeys.me, s);
      qc.invalidateQueries({ queryKey: workKeys.agents });
      toast.success(s.twin?.name ? t("{name} is now your AI twin. Tell it about you next.", { name: s.twin.name }) : t("Your agent is now your AI twin. Tell it about you next."));
      navigate({ to: "/twin", search: { edit: 1 } });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function MeetTwinCard() {
  const t = useT();
  const { data: state } = useQuery(twinQuery);
  const [open, setOpen] = useState(false);
  const adopt = useAdopt();
  if (!state?.eligible) return null;

  if (state.twin) {
    const tw = state.twin;
    return (
      <Link
        to="/twin"
        className="group flex min-w-0 items-center gap-3 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3 transition-[border-color,box-shadow] hover:border-accent/40 hover:shadow-[var(--shadow-soft)]"
      >
        <AgentAvatar name={tw.name} color={tw.color} working={tw.current_task?.status === "running"} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium break-words">{t("Your twin, {name}", { name: tw.name })}</span>
          <span className="block truncate text-[12.5px] text-muted">
            {tw.current_task ? t("On: {title}", { title: tw.current_task.title }) : tw.open_tasks ? (tw.open_tasks === 1 ? t("1 open task") : t("{n} open tasks", { n: tw.open_tasks })) : t("Free. Chat with it or give it a task.")}
          </span>
        </span>
        <ArrowRightIcon size={15} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
      </Link>
    );
  }

  const old = state.adoptable;
  return (
    <section
      aria-labelledby="meet-twin"
      className="relative overflow-hidden rounded-[var(--radius-md)] border border-accent/25 bg-surface shadow-[var(--shadow-soft)]"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,var(--accent-soft),transparent_65%)]" />
      <div className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-6">
        <TwinDuo state={state} />
        <div className="min-w-0 flex-1">
          <p className="text-[11.5px] font-medium tracking-[0.06em] text-accent uppercase">{t("New for you")}</p>
          <h2 id="meet-twin" className="text-[17px] leading-snug font-semibold text-balance">{t("Meet your AI twin")}</h2>
          <p className="mt-1 max-w-[60ch] text-[13.5px] text-muted">
            {t("Your virtual self at work. It handles routine tasks the way you would, and asks you before anything important.")}
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
            <HandIcon size={14} className="shrink-0 text-accent" /> {t("Three short steps. You can change it any time.")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 max-sm:[&>*]:w-full">
          {old.length ? (
            old.slice(0, 2).map((a) => (
              <Button key={a.id} loading={adopt.isPending && adopt.variables === a.id} onClick={() => adopt.mutate(a.id)}>
                <UserFocusIcon size={16} weight="bold" /> {t("Make {name} my twin", { name: a.name })}
              </Button>
            ))
          ) : (
            <Button size="lg" onClick={() => setOpen(true)} disabled={!state.can_create}>
              <SparkleIcon size={16} weight="fill" /> {t("Create my twin")}
            </Button>
          )}
          {old.length ? <p className="max-w-56 text-[12px] text-muted">{t("You already have an agent, so it becomes your twin instead of adding another.")}</p> : null}
        </div>
      </div>
      {open ? <TwinWizard state={state} open={open} onOpenChange={setOpen} /> : null}
    </section>
  );
}

/** Small, shared markers for who may act on an agent (P16).
 * `view_only`: a colleague's agent in the viewer's branch: watch only, no chat, tasks or edits.
 * `private`: a personal assistant, only ever returned to its owner. */
import { CoffeeIcon, EyeIcon, LockSimpleIcon, MoonStarsIcon, UserFocusIcon } from "@phosphor-icons/react";

import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

type Access = {
  view_only?: boolean;
  private?: boolean;
  is_twin?: boolean;
  owner_name?: string | null;
  duty?: { state: string; on: boolean; label: string } | null;
  hours_label?: string | null;
};

/** Agents the viewer can chat with or hand work to (anything not watch-only). */
export function canInstruct(a: Access): boolean {
  return !a.view_only;
}

/** Pickers that put an agent in front of other people (meetings, broadcasts): own, non-personal agents only. */
export function canShare(a: Access): boolean {
  return !a.view_only && !a.private;
}

export function ViewOnlyPill({ className }: { className?: string }) {
  const t = useT();
  return (
    <Pill tone="neutral" className={cn("shrink-0", className)} title={t("You can watch this agent work, but not instruct or change it")}>
      <EyeIcon size={12} weight="bold" /> {t("View only")}
    </Pill>
  );
}

export function PrivatePill({ className }: { className?: string }) {
  const t = useT();
  return (
    <Pill tone="neutral" className={cn("shrink-0", className)} title={t("Your personal assistant: only you see it")}>
      <LockSimpleIcon size={12} weight="bold" /> {t("Private")}
    </Pill>
  );
}

/** P18: a staff member's AI twin, their virtual self at work. */
export function TwinPill({ person, className }: { person?: string | null; className?: string }) {
  const t = useT();
  const title = person ? t("The AI twin of {person}: it works the way they would and asks them first", { person }) : t("The AI twin of a staff member: it works the way they would and asks them first");
  return (
    <Pill tone="accent" className={cn("shrink-0", className)} title={title}>
      <UserFocusIcon size={12} weight="bold" /> {person ? t("Twin of {person}", { person }) : t("Twin of staff")}
    </Pill>
  );
}

/** P19: an agent with working hours that is off duty or on a break right now
 * ("Off duty until 09:00 tomorrow"). Nothing while it is on duty or has no hours. */
export function OffDutyPill({ duty, hours, className }: { duty?: Access["duty"]; hours?: string | null; className?: string }) {
  const t = useT();
  if (!duty || duty.on) return null;
  const Glyph = duty.state === "break" ? CoffeeIcon : MoonStarsIcon;
  return (
    <Pill tone="neutral" className={cn("shrink-0", className)} title={hours ? t("Works {hours}. New work waits until it is back.", { hours }) : undefined}>
      <Glyph size={12} weight="bold" /> {duty.label}
    </Pill>
  );
}

/** The markers, in a fixed order; renders nothing for an ordinary own agent on duty. */
export function AgentAccessPills({ agent, className }: { agent: Access; className?: string }) {
  const off = !!agent.duty && !agent.duty.on;
  if (!agent.view_only && !agent.private && !agent.is_twin && !off) return null;
  return (
    <>
      {agent.is_twin ? <TwinPill person={agent.owner_name} className={className} /> : null}
      {off ? <OffDutyPill duty={agent.duty} hours={agent.hours_label} className={className} /> : null}
      {agent.view_only ? <ViewOnlyPill className={className} /> : null}
      {agent.private ? <PrivatePill className={className} /> : null}
    </>
  );
}

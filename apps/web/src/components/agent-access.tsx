/** Small, shared markers for who may act on an agent (P16).
 * `view_only`: a colleague's agent in the viewer's branch: watch only, no chat, tasks or edits.
 * `private`: a personal assistant, only ever returned to its owner. */
import { EyeIcon, LockSimpleIcon } from "@phosphor-icons/react";

import { Pill } from "@/components/ui/pill";
import { cn } from "@/lib/utils";

type Access = { view_only?: boolean; private?: boolean };

/** Agents the viewer can chat with or hand work to (anything not watch-only). */
export function canInstruct(a: Access): boolean {
  return !a.view_only;
}

/** Pickers that put an agent in front of other people (meetings, broadcasts): own, non-personal agents only. */
export function canShare(a: Access): boolean {
  return !a.view_only && !a.private;
}

export function ViewOnlyPill({ className }: { className?: string }) {
  return (
    <Pill tone="neutral" className={cn("shrink-0", className)} title="You can watch this agent work, but not instruct or change it">
      <EyeIcon size={12} weight="bold" /> View only
    </Pill>
  );
}

export function PrivatePill({ className }: { className?: string }) {
  return (
    <Pill tone="neutral" className={cn("shrink-0", className)} title="Your personal assistant: only you see it">
      <LockSimpleIcon size={12} weight="bold" /> Private
    </Pill>
  );
}

/** Both markers, in a fixed order; renders nothing for an ordinary own agent. */
export function AgentAccessPills({ agent, className }: { agent: Access; className?: string }) {
  if (!agent.view_only && !agent.private) return null;
  return (
    <>
      {agent.view_only ? <ViewOnlyPill className={className} /> : null}
      {agent.private ? <PrivatePill className={className} /> : null}
    </>
  );
}

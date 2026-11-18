import { AgentAvatar } from "@/components/agent-avatar";
import { cn, initials } from "@/lib/utils";
import type { Task } from "@/lib/work";

const SIZES = { xs: "size-6 text-[10px]", sm: "size-8 text-[12px]", md: "size-10 text-[14px]" } as const;
// A person's face is a soft tint with a ring (an agent's is a solid colour), so people and AI
// stay apart at a glance on a mixed board.
const TONES = [
  "bg-accent-soft text-accent ring-accent/25",
  "bg-info/12 text-info ring-info/25",
  "bg-warn/12 text-warn ring-warn/25",
  "bg-ok/12 text-ok ring-ok/25",
  "bg-surface-2 text-fg ring-border",
] as const;

function tone(seed: string): string {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length]!;
}

/** P97: a person's face (initials on a soft tint, ringed). */
export function PersonAvatar({ name, id, size = "sm", className }: { name: string; id?: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold ring-1", SIZES[size], tone(id ?? name), className)}>
      {initials(name)}
    </span>
  );
}

/** Who a task is for: a person or an agent, with their face; null when nobody has it. */
export function AssigneeFace({ task, size = "xs" }: { task: Task; size?: "xs" | "sm" }) {
  if (task.assignee_user_id) return <PersonAvatar name={task.assignee_user_name ?? "?"} id={task.assignee_user_id} size={size} />;
  if (task.assignee_name) return <AgentAvatar name={task.assignee_name} color={task.assignee_color ?? "#888"} size={size} working={task.status === "running"} />;
  return null;
}

export const assigneeName = (task: Task) => task.assignee_user_name ?? task.assignee_name ?? null;

/** P114: an agent task's people, by name: who started the request (their daily AI allowance
 * pays) and whose AI it is when that is someone else. Nothing for a task given to a person. */
export function taskWhose(task: Task): { startedBy: string | null; aiOf: string | null } {
  if (task.assignee_user_id || !task.assignee_agent_id) return { startedBy: null, aiOf: null };
  const startedBy = task.for_user_name ?? null;
  const other = task.assignee_owner_id && task.assignee_owner_id !== task.for_user_id;
  return { startedBy, aiOf: other ? task.assignee_owner_name ?? null : null };
}

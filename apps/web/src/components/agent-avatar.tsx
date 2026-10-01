import { cn, initials } from "@/lib/utils";

const SIZES = { xs: "size-6 text-[10px]", sm: "size-8 text-[12px]", md: "size-10 text-[14px]", lg: "size-14 text-[18px]" } as const;

/** An agent's face: initials on its own color. Pulses gently while the agent is working. */
export function AgentAvatar({
  name,
  color,
  size = "md",
  working,
  className,
}: {
  name: string;
  color: string;
  size?: keyof typeof SIZES;
  working?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("relative inline-grid shrink-0 place-items-center rounded-full font-semibold text-white", SIZES[size], className)} style={{ background: color }} aria-hidden>
      {initials(name)}
      {working ? (
        <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-accent motion-safe:animate-pulse" />
      ) : null}
    </span>
  );
}

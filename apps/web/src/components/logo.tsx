import { cn } from "@/lib/utils";

/** Monogram mark; same geometry as public/favicon.svg. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8", className)}>
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path
        d="M20 46 32 16l12 30"
        fill="none"
        stroke="var(--accent-fg)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M25 36h14" stroke="var(--accent-fg)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">Agentic Office</span>
    </span>
  );
}

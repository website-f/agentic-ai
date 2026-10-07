/** What the AI can and cannot do on a linked computer, in plain words (docs/PC-AGENT.md, Rules). */
import { CheckCircleIcon, HandPalmIcon, ProhibitIcon, ShieldCheckIcon, type Icon } from "@phosphor-icons/react";

import { msg, useT } from "@/i18n";
import { cn } from "@/lib/utils";

const GROUPS: { title: string; icon: Icon; tone: string; items: string[] }[] = [
  {
    title: msg("Your AI can"),
    icon: CheckCircleIcon,
    tone: "text-ok",
    items: [
      msg("Find and read files, only in the folders you picked."),
      msg("Copy a file into your workspace (My workspace › From my PC)."),
      msg("Open a browser window on your screen, with its own separate profile, and browse while you watch."),
    ],
  },
  {
    title: msg("It asks you first"),
    icon: HandPalmIcon,
    tone: "text-warn",
    items: [
      msg("Before it saves a file to your computer."),
      msg("Before it sends a form on a website."),
    ],
  },
  {
    title: msg("It never"),
    icon: ProhibitIcon,
    tone: "text-danger",
    items: [
      msg("Works for anyone else: company agents, colleagues and managers never reach your computer."),
      msg("Opens passwords or keys: SSH and cloud keys, password managers, keychains, browser data, .env files and certificates are always refused."),
      msg("Uses your own Chrome or Edge profile, so your saved passwords and cookies stay out of reach."),
      msg("Does anything while the computer is paused."),
    ],
  },
];

export function SafetyBox({ className }: { className?: string }) {
  const t = useT();
  return (
    <section data-guide="computers.safety" aria-labelledby="pc-safety" className={cn("grid min-w-0 gap-3 rounded-[var(--radius-md)] border border-border bg-surface p-4 sm:p-5", className)}>
      <h2 id="pc-safety" className="flex items-center gap-2 text-[15px] font-semibold">
        <ShieldCheckIcon size={18} weight="duotone" className="text-accent" /> {t("What your AI can do on your computer")}
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g.title} className="grid content-start gap-2">
            <h3 className={cn("flex items-center gap-1.5 text-[13px] font-semibold", g.tone)}>
              <g.icon size={15} weight="fill" /> {t(g.title)}
            </h3>
            <ul className="grid gap-1.5">
              {g.items.map((i) => (
                <li key={i} className="text-[13px] leading-snug text-muted">{t(i)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="border-t border-border pt-3 text-[12.5px] text-muted">
        {t("Everything it does is listed under Recent activity here, and on the computer itself (agentic-pc logs). Pause or unlink any time: it stops at once.")}
      </p>
    </section>
  );
}

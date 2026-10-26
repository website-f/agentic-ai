import { CoinsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { useT } from "@/i18n";
import { myAllowanceQuery, tokens } from "@/lib/allowance";
import { cn } from "@/lib/utils";

/** P36: what is left of my AI allowance today. Nothing when I have no limit. */
export function AllowanceMeter({ className }: { className?: string }) {
  const t = useT();
  const { data } = useQuery(myAllowanceQuery);
  if (!data || data.limit === null) return null;
  const ratio = data.limit ? Math.min(1, data.used / data.limit) : 1;
  const tone = data.over ? "bg-danger" : ratio >= 0.8 ? "bg-warn" : "bg-accent";
  return (
    <div className={cn("grid gap-1.5 rounded-[var(--radius-md)] border border-border bg-surface px-4 py-3", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="inline-flex items-center gap-1.5 font-medium"><CoinsIcon size={15} className="text-accent" /> {t("My AI allowance today")}</span>
        <span className="tabular text-muted">{t("{used} of {limit} tokens", { used: tokens(data.used), limit: tokens(data.limit) })}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)} aria-label={t("AI allowance used")}>
        <div className={cn("h-full rounded-full transition-[width]", tone)} style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="text-[12px] text-muted">
        {data.over
          ? t("Used up for today. It resets at midnight, or ask your manager for more.")
          : t("Resets at midnight. Work your AI repeats from what it learned uses almost none.")}
      </p>
    </div>
  );
}

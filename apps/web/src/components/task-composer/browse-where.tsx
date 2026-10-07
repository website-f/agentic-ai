/** P31: where a "Browse a website" task runs: the server's virtual browser, or a real window on
 * the person's own computer. Only offered for the person's OWN AI (their twin or private
 * assistant) once they have linked a computer; an offline or paused computer cannot be picked. */
import { CloudIcon, DesktopTowerIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";

import { useT } from "@/i18n";
import { devicesQuery, isMyOwnAi, type Device } from "@/lib/devices";
import { meQuery } from "@/lib/queries";
import { agentsQuery, type Agent } from "@/lib/work";
import { cn } from "@/lib/utils";

export const ON_SERVER = "server";

/** The person's computers this agent may use: none unless it is their own AI. */
export function useMyDevicesFor(agent: Pick<Agent, "owner_user_id" | "is_twin" | "private"> | null, userId: string | null | undefined): Device[] {
  const mine = isMyOwnAi(agent, userId);
  const { data } = useQuery({ ...devicesQuery, enabled: mine });
  return mine ? (data ?? []) : [];
}

/** Same, from an agent id (the chat's quick chips only know the id). */
export function useMyDevicesForId(agentId: string): Device[] {
  const { data: me } = useQuery(meQuery);
  const { data: agents } = useQuery(agentsQuery);
  return useMyDevicesFor(agents?.find((a) => a.id === agentId) ?? null, me?.user.id);
}

/** A computer the AI can browse on right now. */
export const canBrowseOn = (d: Device) => d.online && !d.paused && d.browsers.length > 0;

export function BrowseWhere({ devices, value, onChange }: { devices: Device[]; value: string; onChange: (v: string) => void }) {
  const t = useT();
  const option = (v: string, label: string, hint: string | null, off: boolean, Icon: typeof CloudIcon) => {
    const on = value === v;
    return (
      <button key={v} type="button" role="radio" aria-checked={on} disabled={off} onClick={() => onChange(v)}
        className={cn(
          "flex min-w-0 items-start gap-2.5 rounded-[var(--radius-md)] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-55",
          on ? "border-accent bg-accent-soft/50 ring-1 ring-accent/30" : "border-border bg-surface hover:border-accent/40",
        )}>
        <Icon size={17} weight={on ? "fill" : "duotone"} className="mt-0.5 shrink-0 text-accent" />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium break-words">{label}</span>
          {hint ? <span className="block text-[12px] text-muted">{hint}</span> : null}
        </span>
      </button>
    );
  };
  return (
    <div className="grid min-w-0 gap-1.5">
      <span className="text-[13px] font-medium">{t("Where to browse")}</span>
      <div role="radiogroup" aria-label={t("Where to browse")} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {option(ON_SERVER, t("On the server (virtual)"), t("A browser in the office's cloud. You can watch it live."), false, CloudIcon)}
        {devices.map((d) => {
          const hint = d.paused ? t("Paused") : !d.online ? t("Offline") : !d.browsers.length ? t("No Chrome or Edge on it")
            : t("A real window on your screen, from your own internet line.");
          return option(d.id, t("On my computer: {name}", { name: d.name }), hint, !canBrowseOn(d), DesktopTowerIcon);
        })}
      </div>
    </div>
  );
}

/** P117 (feedback 19 Nov: "when I need to clock in I need to go to Prima"): clocking in from My
 * workspace. Shows whether you are clocked in (Prima's own record, read through the office as
 * you) and opens Prima's clock screen inside the office, where the face or photo and the place
 * are taken as Prima's rules say. Once Prima has opened on this device it is shown only to people
 * Prima has a clock for (guards clock in on the site device); before that, to staff (the people
 * whose phone tab is Clock in), without asking Prima anything until they open it. */
import { ArrowRightIcon, ClockUserIcon } from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect } from "react";

import { useT } from "@/i18n";
import { api } from "@/lib/api";
import { allScreens, usePrima } from "@/lib/prima-embed";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface MyClock {
  allowed: boolean;
  open: { in?: { capturedAt?: string; receivedAt?: string } | null } | null;
}

function hhmm(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ClockCard() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const load = usePrima((s) => s.load);
  const menu = usePrima((s) => s.menu);
  useEffect(() => load(me.user.id), [load, me.user.id]);
  // Prima told this device the person has the clock screen (they opened Prima here once).
  const hasClock = allScreens(menu).some((s) => s.view === "clock");
  const clock = useQuery({
    queryKey: ["prima", "my-clock"],
    queryFn: () => api<MyClock>("/api/prima/api/me/clock"),
    enabled: hasClock,
    staleTime: 60_000,
    retry: false,
  });
  const staff = !me.permissions.includes("office.view");
  if (menu ? !hasClock : !staff) return null;
  if (clock.data?.allowed === false || clock.isError) return null;
  const since = clock.data?.open ? hhmm(clock.data.open.in?.capturedAt ?? clock.data.open.in?.receivedAt) : "";
  const on = !!clock.data?.open;
  return (
    <Link
      to="/prima"
      hash="clock"
      data-guide="desk.clock"
      className={cn(
        "flex min-w-0 items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3 transition-colors",
        on ? "border-ok/30 bg-ok/8 hover:bg-ok/12" : "border-accent/30 bg-accent-soft/40 hover:bg-accent-soft",
      )}
    >
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-full", on ? "bg-ok/15 text-ok" : "bg-accent/15 text-accent")}>
        <ClockUserIcon size={22} weight="fill" />
      </span>
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-[14.5px] font-semibold">
          {!clock.data ? (clock.isLoading ? t("My clock") : t("Clock in")) : on ? (since ? t("Clocked in since {time}", { time: since }) : t("Clocked in")) : t("Not clocked in")}
        </span>
        <span className="truncate text-[12.5px] text-muted">{on ? t("Open my clock to clock out or see today.") : t("Clock in here, without leaving the office.")}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-accent">
        {on ? t("My clock") : t("Clock in")} <ArrowRightIcon size={14} weight="bold" />
      </span>
    </Link>
  );
}

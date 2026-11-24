/** P117 (Fitri, 19 Nov 2026: one office, Prima inside): the sidebar's Prima group. Prima's own
 * apps and screens for this person (as Prima reported them, lib/prima-embed.ts), opened inside
 * the office page: Clock in first, Prima's home, then each app; the open app shows its screens
 * under it. Before Prima has opened once on this device, one "Prima" entry. */
import {
  AddressBookIcon, BankIcon, BriefcaseIcon, ClockUserIcon, CrownIcon, DesktopIcon, DotsThreeCircleIcon, GlobeHemisphereEastIcon, HandshakeIcon,
  HouseIcon, MoneyIcon, ScalesIcon, ShieldCheckIcon, ToolboxIcon, UsersThreeIcon, type Icon,
} from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { CaretDownIcon, StarIcon, UserIcon } from "@phosphor-icons/react";
import { Fragment, useEffect, useState, type MouseEvent } from "react";

import { useT } from "@/i18n";
import { allScreens, primaGo, usePrima } from "@/lib/prima-embed";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

const APP_ICON: Record<string, Icon> = {
  ops: BriefcaseIcon,
  security: ShieldCheckIcon,
  equip: ToolboxIcon,
  hr: UsersThreeIcon,
  pay: MoneyIcon,
  fw: GlobeHemisphereEastIcon,
  sales: HandshakeIcon,
  finance: BankIcon,
  gov: ScalesIcon,
  board: CrownIcon,
  it: DesktopIcon,
  // P129: Prima's own side-menu sections.
  main: StarIcon,
  me: UserIcon,
  people: UsersThreeIcon,
  money: MoneyIcon,
  company: ScalesIcon,
  tools: DesktopIcon,
};

const ROW =
  "relative flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-[13.5px] transition-colors justify-center wide:justify-start";
const ON =
  "bg-accent-soft font-medium text-accent before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-accent";
const OFF = "text-muted hover:bg-surface-2 hover:text-fg";

function Entry({ hash, label, icon: Ico, active }: { hash: string; label: string; icon: Icon; active: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Prima already showing: open the screen in it (no reload); else go to Prima at that screen.
  const open = (e: MouseEvent) => {
    if (pathname === "/prima" && primaGo(`#${hash}`)) e.preventDefault();
  };
  return (
    <li>
      <Link to="/prima" hash={hash} onClick={open} title={label} aria-current={active ? "page" : undefined} className={cn(ROW, active ? ON : OFF)}>
        <Ico size={19} weight={active ? "fill" : "regular"} className="shrink-0" />
        <span className="hidden truncate wide:inline">{label}</span>
      </Link>
    </li>
  );
}

export function PrimaNav() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const load = usePrima((s) => s.load);
  const menu = usePrima((s) => s.menu);
  const view = usePrima((s) => s.view);
  const space = usePrima((s) => s.space);
  useEffect(() => load(me.user.id), [load, me.user.id]);
  const here = pathname === "/prima";
  if (!menu) {
    return (
      <ul className="grid gap-0.5">
        <Entry hash="" label={t("Prima")} icon={ShieldCheckIcon} active={here} />
      </ul>
    );
  }
  const screens = allScreens(menu);
  const clock = screens.find((s) => s.view === "clock");
  const apps = menu.apps;
  // P129: Prima's side menu in its own sections, each opening and closing here as in Prima.
  if (apps.some((a) => a.section)) return <PrimaSections />;
  return (
    <ul className="grid gap-0.5">
      {clock ? <Entry hash="clock" label={t("Clock in")} icon={ClockUserIcon} active={here && view === "clock"} /> : null}
      {apps.length ? (
        <>
          <Entry hash="home" label={t("Prima home")} icon={HouseIcon} active={here && view === "home" && !space} />
          {apps.map((a) => {
            const open = here && space === a.id;
            return (
              <Fragment key={a.id}>
                <Entry hash={`@${a.id}`} label={a.title} icon={APP_ICON[a.id] ?? DotsThreeCircleIcon} active={open && view === "home"} />
                {open ? (
                  <li className="hidden wide:block">
                    <ul className="mb-1 ml-[1.15rem] grid gap-0.5 border-l border-border pl-2">
                      {a.screens.map((sc) => (
                        <li key={sc.view}>
                          <Link to="/prima" hash={sc.view} title={sc.label}
                            onClick={(e) => { if (primaGo(`#${sc.view}`)) e.preventDefault(); }}
                            aria-current={view === sc.view ? "page" : undefined}
                            className={cn("flex h-8 items-center rounded-sm px-2 text-[13px] transition-colors", view === sc.view ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                            <span className="truncate">{sc.label}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ) : null}
              </Fragment>
            );
          })}
        </>
      ) : (
        // A short Prima menu (no apps): its screens, each one entry.
        menu.screens.filter((sc) => sc.view !== "clock").map((sc) => (
          <Entry key={sc.view} hash={sc.view} label={sc.label} icon={ShieldCheckIcon} active={here && view === sc.view} />
        ))
      )}
      {me.permissions.includes("org.manage") ? (
        <li>
          <Link to="/prima" search={{ people: 1 }} title={t("People in Prima")} className={cn(ROW, OFF)}>
            <AddressBookIcon size={19} className="shrink-0" />
            <span className="hidden truncate wide:inline">{t("People in Prima")}</span>
          </Link>
        </li>
      ) : null}
    </ul>
  );
}

/** P129 (Fitri, 24 Nov 2026): Prima's screens in its own sections (Main screens, My work, Operations ...), each a
 * heading that opens and closes; the section holding the open screen starts open. */
function PrimaSections() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const menu = usePrima((s) => s.menu);
  const view = usePrima((s) => s.view);
  const here = pathname === "/prima";
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (!menu) return null;
  const clock = allScreens(menu).find((s) => s.view === "clock");
  return (
    <ul className="grid gap-0.5">
      {clock ? <Entry hash="clock" label={t("Clock in")} icon={ClockUserIcon} active={here && view === "clock"} /> : null}
      <Entry hash="home" label={t("Prima home")} icon={HouseIcon} active={here && view === "home"} />
      {menu.apps.map((a) => {
        const hasHere = here && a.screens.some((sc) => sc.view === view);
        const isOpen = open[a.id] ?? (hasHere || a.id === "main");
        const Ico = APP_ICON[a.id] ?? DotsThreeCircleIcon;
        return (
          <li key={a.id}>
            <button
              type="button"
              title={a.title}
              aria-expanded={isOpen}
              onClick={() => setOpen((o) => ({ ...o, [a.id]: !isOpen }))}
              className={cn(ROW, "w-full", hasHere && !isOpen ? ON : OFF)}
            >
              <Ico size={19} className="shrink-0" />
              <span className="hidden flex-1 truncate text-left wide:inline">{a.title}</span>
              <CaretDownIcon size={12} weight="bold" className={cn("hidden shrink-0 transition-transform wide:inline", isOpen ? "" : "-rotate-90")} />
            </button>
            {isOpen ? (
              <ul className="mb-1 ml-[1.15rem] hidden gap-0.5 border-l border-border pl-2 wide:grid">
                {a.screens.map((sc) => (
                  <li key={sc.view}>
                    <Link to="/prima" hash={sc.view} title={sc.label}
                      onClick={(e) => { if (pathname === "/prima" && primaGo(`#${sc.view}`)) e.preventDefault(); }}
                      aria-current={here && view === sc.view ? "page" : undefined}
                      className={cn("flex h-8 items-center rounded-sm px-2 text-[13px] transition-colors", here && view === sc.view ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-surface-2 hover:text-fg")}>
                      <span className="truncate">{sc.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

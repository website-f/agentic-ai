import { setBadge, syncPush } from "@/lib/push";
import {
  CaretUpDownIcon,
  DotsThreeIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  MegaphoneIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SignOutIcon,
  SunIcon,
} from "@phosphor-icons/react";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "vaul";

import { useLiveEvents } from "@/lib/live";
import { branchesQuery, meQuery, systemStatusQuery } from "@/lib/queries";
import { useBranch, usePalette, useTheme, type ThemePref } from "@/lib/stores";
import { useSignOut } from "@/lib/use-sign-out";
import { cn, initials } from "@/lib/utils";
import { ALL_NAV, HELP_SECTION, NAV, TAB_BAR, type NavItem } from "@/nav";

import { CommandPalette } from "./command-palette";
import { LogoMark, Wordmark } from "./logo";
import { Button } from "./ui/button";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "./ui/menu";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function useVisibleNav() {
  const { data: me } = useSuspenseQuery(meQuery);
  return useMemo(
    () =>
      NAV.map((s) => ({
        ...s,
        items: s.items.filter((i) => !i.perm || [i.perm].flat().some((p) => me.permissions.includes(p))),
      })).filter((s) => s.items.length),
    [me.permissions],
  );
}

/** Tutorial, Guide and Present: never permission-gated, always reachable. */
const HELP_ITEMS: NavItem[] = NAV.find((s) => s.title === HELP_SECTION)?.items ?? [];

function isActive(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

function PhaseTag({ phase }: { phase: string }) {
  return (
    <span className="ml-auto rounded-full bg-surface-2 px-1.5 text-[10.5px] font-medium text-muted tabular">
      {phase}
    </span>
  );
}

/** Pinned under the scrolling nav so help is never below the fold. */
function HelpFooter({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Help" className="shrink-0 border-t border-border px-3 py-2.5">
      <p className="hidden px-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase xl:block">
        {HELP_SECTION}
      </p>
      <ul className="grid gap-0.5 xl:grid-cols-3 xl:gap-1">
        {HELP_ITEMS.map((item) => {
          const active = isActive(pathname, item.to);
          const IconCmp = item.icon;
          return (
            <li key={item.to} className="min-w-0">
              <Link
                to={item.to}
                title={item.blurb}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center justify-center rounded-sm transition-colors xl:h-auto xl:flex-col xl:gap-0.5 xl:py-1.5",
                  active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <IconCmp size={19} weight={active ? "fill" : "regular"} />
                <span className="sr-only text-[11.5px] leading-tight font-medium xl:not-sr-only">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Sidebar() {
  const sections = useVisibleNav().filter((s) => s.title !== HELP_SECTION);
  const waiting = useWaiting();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="sticky top-0 hidden h-dvh w-[68px] shrink-0 flex-col border-r border-border bg-surface md:flex xl:w-[244px]">
      <div className="flex h-14 items-center px-[18px] xl:px-4">
        <Link to="/" className="flex items-center" aria-label="Agentic Office home">
          <span className="xl:hidden">
            <LogoMark />
          </span>
          <Wordmark className="hidden xl:flex" />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 pb-4" aria-label="Main">
        {sections.map((section) => (
          <div key={section.title} className="mt-4 first:mt-1">
            <p className="hidden px-2.5 pb-1 text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase xl:block">
              {section.title}
            </p>
            <ul className="grid gap-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.to);
                const IconCmp = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      title={item.label}
                      className={cn(
                        "relative flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-[13.5px] transition-colors",
                        "justify-center xl:justify-start",
                        active
                          ? "bg-accent-soft font-medium text-accent before:absolute before:top-2 before:bottom-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-accent"
                          : "text-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <span className="relative">
                        <IconCmp size={19} weight={active ? "fill" : "regular"} />
                        {waiting[item.to] ? <span className="absolute -top-1 -right-1 size-2 rounded-full bg-warn xl:hidden" /> : null}
                      </span>
                      <span className="hidden xl:inline">{item.label}</span>
                      <Badge count={waiting[item.to] ?? 0} className="ml-auto hidden xl:grid" />
                      {item.phase ? (
                        <span className="hidden xl:contents">
                          <PhaseTag phase={item.phase} />
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <HelpFooter pathname={pathname} />
    </aside>
  );
}

function BranchSwitcher() {
  const { data: branches = [] } = useQuery(branchesQuery);
  const { branchId, setBranchId } = useBranch();
  const navigate = useNavigate();
  // A remembered branch that was deleted falls back to the first one.
  const current = branches.find((b) => b.id === branchId) ?? branches[0];

  return (
    <Menu>
      <MenuTrigger asChild>
        <button className="flex h-9 max-w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left hover:bg-surface-2">
          <span
            aria-hidden
            className="size-2.5 shrink-0 rounded-full"
            style={{ background: current?.color ?? "var(--border)" }}
          />
          <span className="truncate text-[13.5px] font-medium">
            {current ? current.name : "No branches yet"}
          </span>
          <CaretUpDownIcon size={14} className="shrink-0 text-muted" />
        </button>
      </MenuTrigger>
      <MenuContent align="start" className="w-64">
        <MenuLabel>Branches</MenuLabel>
        {branches.length ? (
          <MenuRadioGroup value={current?.id} onValueChange={setBranchId}>
            {branches.map((b) => (
              <MenuRadioItem key={b.id} value={b.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: b.color }} />
                  <span className="truncate">{b.name}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        ) : (
          <p className="px-2.5 py-2 text-[13px] text-muted">Each company you run becomes a branch.</p>
        )}
        <MenuSeparator />
        <MenuItem icon={<PlusIcon />} onSelect={() => navigate({ to: "/organization", search: { new: 1 } })}>
          New branch
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

const THEME_ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

function ThemeMenu() {
  const { pref, setPref } = useTheme();
  const IconCmp = THEME_ICON[pref];
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Theme">
          <IconCmp size={18} />
        </Button>
      </MenuTrigger>
      <MenuContent className="w-44">
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
          <MenuRadioItem value="light">Light</MenuRadioItem>
          <MenuRadioItem value="dark">Dark</MenuRadioItem>
          <MenuRadioItem value="system">Match system</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function UserMenu() {
  const { data: me } = useSuspenseQuery(meQuery);
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          className="grid size-8 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent"
          aria-label="Account"
        >
          {initials(me.user.name)}
        </button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-[13.5px] font-medium">{me.user.name}</p>
          <p className="truncate text-[12.5px] text-muted">{me.user.email}</p>
          <p className="mt-1 text-[12px] text-muted">
            {me.workspace.name} · <span className="capitalize">{me.role}</span>
          </p>
        </div>
        <MenuSeparator />
        <MenuItem icon={<KeyIcon />} onSelect={() => navigate({ to: "/change-password" })}>
          Change password
        </MenuItem>
        <MenuItem icon={<SignOutIcon />} onSelect={signOut}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function useApprovalCount() {
  const { data } = useQuery(systemStatusQuery);
  return data?.counts.approvals_pending ?? 0;
}

/** Things waiting for a person, per nav item: decisions and skill proposals. */
function useWaiting(): Partial<Record<string, number>> {
  const { data } = useQuery(systemStatusQuery);
  return { "/approvals": data?.counts.approvals_pending ?? 0, "/skills": data?.counts.skill_proposals_pending ?? 0 };
}

function Badge({ count, className }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span className={cn("grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[10.5px] font-semibold text-white tabular", className)} aria-label={`${count} waiting`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Header() {
  const setOpen = usePalette((s) => s.setOpen);
  const navigate = useNavigate();
  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:px-4"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Link to="/" className="-m-1.5 p-1.5 md:hidden" aria-label="Home">
        <LogoMark className="size-7" />
      </Link>
      <div className="min-w-0 flex-1">
        <BranchSwitcher />
      </div>
      <button
        onClick={() => setOpen(true)}
        className="hidden h-9 w-64 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-[13px] text-muted hover:bg-surface-2 lg:flex"
      >
        <MagnifyingGlassIcon size={16} />
        <span className="flex-1 text-left">Search or jump to…</span>
        <kbd className="rounded border border-border px-1.5 font-mono text-[11px]">{IS_MAC ? "⌘K" : "Ctrl K"}</kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <MagnifyingGlassIcon size={18} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Broadcast a message"
        onClick={() => navigate({ to: "/broadcasts" })}
      >
        <MegaphoneIcon size={18} />
      </Button>
      <ThemeMenu />
      <UserMenu />
    </header>
  );
}

function TabLink({ item, active, badge = 0 }: { item: NavItem; active: boolean; badge?: number }) {
  const IconCmp = item.icon;
  return (
    <Link
      to={item.to}
      className={cn(
        "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
        active ? "text-accent" : "text-muted",
      )}
    >
      <span className="relative">
        <IconCmp size={22} weight={active ? "fill" : "regular"} />
        <Badge count={badge} className="absolute -top-1.5 -right-2.5" />
      </span>
      {item.label}
    </Link>
  );
}

function MobileTabBar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const approvals = useApprovalCount();
  const sections = useVisibleNav();
  const [more, setMore] = useState(false);
  const tabs = TAB_BAR.map((to) => ALL_NAV.find((n) => n.to === to)).filter(Boolean) as NavItem[];
  const moreActive = !tabs.some((t) => isActive(pathname, t.to));
  const moreSections = sections
    .filter((s) => s.title !== HELP_SECTION)
    .map((s) => ({ ...s, items: s.items.filter((i) => !TAB_BAR.includes(i.to)) }))
    .filter((s) => s.items.length);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map((t) => (
          <TabLink key={t.to} item={t} active={isActive(pathname, t.to)} badge={t.to === "/approvals" ? approvals : 0} />
        ))}
        <button
          onClick={() => setMore(true)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
            moreActive ? "text-accent" : "text-muted",
          )}
        >
          <DotsThreeIcon size={22} weight="bold" />
          More
        </button>
      </nav>
      <Drawer.Root open={more} onOpenChange={setMore}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-40 bg-black/40" />
          {/* The sheet itself only drags; the list scrolls inside it (vaul treats a drag on the
              sheet as "move the sheet", so a scrolling sheet could never scroll on a phone). */}
          <Drawer.Content
            aria-describedby={undefined}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-[var(--radius-lg)] border-t border-border bg-surface outline-none"
          >
            <div aria-hidden className="mx-auto mt-2.5 mb-2 h-1.5 w-10 shrink-0 rounded-full bg-border" />
            <Drawer.Title className="sr-only">All pages</Drawer.Title>
            <div
              data-vaul-no-drag
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 [-webkit-overflow-scrolling:touch]"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
            >
            <div className="mb-4 grid grid-cols-3 gap-2" role="list" aria-label="Help">
              {HELP_ITEMS.map((item) => {
                const IconCmp = item.icon;
                const active = isActive(pathname, item.to);
                return (
                  <Link
                    key={item.to}
                    role="listitem"
                    to={item.to}
                    onClick={() => setMore(false)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-full border px-2 py-2 text-[12.5px] font-medium",
                      active ? "border-accent/40 bg-accent-soft text-accent" : "border-border bg-surface-2/60 text-fg",
                    )}
                  >
                    <IconCmp size={17} weight={active ? "fill" : "regular"} className={active ? undefined : "text-accent"} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            {moreSections.map((s) => (
              <div key={s.title} className="mb-3">
                <p className="mb-1.5 px-1 text-[12px] font-medium text-muted">{s.title}</p>
                <div className="grid grid-cols-3 gap-2">
                  {s.items.map((item) => {
                    const IconCmp = item.icon;
                    const active = isActive(pathname, item.to);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        onClick={() => setMore(false)}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-[var(--radius-md)] border px-2 py-2.5 text-center text-[12px]",
                          active ? "border-accent/40 bg-accent-soft text-accent" : "border-border text-fg",
                        )}
                      >
                        <IconCmp size={22} weight={active ? "fill" : "regular"} />
                        <span className="leading-tight">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
}

function useDeviceSync() {
  const { data } = useQuery(systemStatusQuery);
  const waiting = data?.counts.approvals_pending ?? 0;
  // The number on the installed app's icon follows the approvals waiting.
  useEffect(() => setBadge(waiting), [waiting]);
  // The browser may have rotated this device's push subscription: re-send it once per start.
  useEffect(() => void syncPush(), []);
}

export function AppShell() {
  const setOpen = usePalette((s) => s.setOpen);
  useLiveEvents();
  useDeviceSync();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>
      </div>
      <MobileTabBar />
      <CommandPalette />
    </div>
  );
}

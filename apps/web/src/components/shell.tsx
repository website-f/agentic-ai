import { setBadge, syncPush } from "@/lib/push";
import {
  BuildingsIcon,
  CaretDownIcon,
  CaretUpDownIcon,
  CheckIcon,
  CommandIcon,
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
import { Command } from "cmdk";
import { Popover } from "radix-ui";
import { useEffect, useMemo, useState } from "react";
import { Drawer } from "vaul";

import { ALL_COMPANIES, useCompanies } from "@/lib/company";
import { useLiveEvents } from "@/lib/live";
import { meQuery, systemStatusQuery } from "@/lib/queries";
import { useBranch, usePalette, useTheme, type ThemePref } from "@/lib/stores";
import { LanguageSwitch, useProfileLanguage } from "@/components/language-switch";
import { useT } from "@/i18n";
import { useMedia } from "@/lib/use-media";
import { useSignOut } from "@/lib/use-sign-out";
import { ROLE_INFO } from "@/lib/types";
import { cn, initials } from "@/lib/utils";
import { agentsQuery } from "@/lib/work";
import { ALL_NAV, HELP_SECTION, NAV, TAB_BAR, type NavItem, type NavSection } from "@/nav";

import { CommandPalette } from "./command-palette";
import { HeaderSearch } from "./search-box";
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
        items: s.items.filter((i) => !i.hidden && (!i.perm || [i.perm].flat().some((p) => me.permissions.includes(p)))),
      })).filter((s) => s.items.length),
    [me.permissions],
  );
}

/** Which sidebar groups are open: each person's own choice (kept on this device), else the
 * group's default (everyday groups open; the AI team and how-we-work groups open for people
 * who manage; setup folded). The group of the page you are on is always open. */
const OPEN_KEY = "agentic.nav.open";

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

function useOpenGroups() {
  const { data: me } = useSuspenseQuery(meQuery);
  const manages = ["agents.manage", "org.manage", "team.manage"].some((p) => me.permissions.includes(p));
  const [chosen, setChosen] = useState<Record<string, boolean>>(readOpen);
  const isOpen = (s: NavSection) => chosen[s.title] ?? (s.open === "all" || (s.open === "managers" && manages));
  const toggle = (s: NavSection) => {
    const next = { ...chosen, [s.title]: !isOpen(s) };
    setChosen(next);
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // private mode: the choice lasts until the page reloads
    }
  };
  return { isOpen, toggle };
}

/** Tutorial, Guide and Present: never permission-gated, always reachable. */
const HELP_ITEMS: NavItem[] = NAV.find((s) => s.title === HELP_SECTION)?.items ?? [];

function matches(pathname: string, to: string) {
  return to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`);
}

function isActive(pathname: string, to: string) {
  const item = ALL_NAV.find((n) => n.to === to);
  return matches(pathname, to) || !!item?.also?.some((a) => matches(pathname, a));
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
  const t = useT();
  return (
    <nav aria-label={t("Help")} className="shrink-0 border-t border-border px-3 py-2.5">
      <p className="hidden px-2.5 pb-1.5 text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase xl:block">
        {t(HELP_SECTION)}
      </p>
      <ul className="grid gap-0.5 xl:grid-cols-3 xl:gap-1">
        {HELP_ITEMS.map((item) => {
          const active = isActive(pathname, item.to);
          const IconCmp = item.icon;
          return (
            <li key={item.to} className="min-w-0">
              <Link
                to={item.to}
                title={t(item.blurb)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center justify-center rounded-sm transition-colors xl:h-auto xl:flex-col xl:gap-0.5 xl:py-1.5",
                  active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                <IconCmp size={19} weight={active ? "fill" : "regular"} />
                <span className="sr-only text-[11.5px] leading-tight font-medium xl:not-sr-only">{t(item.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Sidebar() {
  const t = useT();
  const sections = useVisibleNav().filter((s) => s.title !== HELP_SECTION);
  const groups = useOpenGroups();
  const waiting = useWaiting();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <aside className="sticky top-0 hidden h-dvh w-[68px] shrink-0 flex-col border-r border-border bg-surface md:flex xl:w-[244px]">
      <div className="flex h-14 items-center px-[18px] xl:px-4">
        <Link to="/" className="flex items-center" aria-label={t("Agentic Office home")}>
          <span className="xl:hidden">
            <LogoMark />
          </span>
          <Wordmark className="hidden xl:flex" />
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4" aria-label={t("Main")}>
        {sections.map((section) => {
          const here = section.items.some((i) => isActive(pathname, i.to));
          const open = here || groups.isOpen(section);
          const waitingHere = section.items.reduce((n, i) => n + (waiting[i.to] ?? 0), 0);
          return (
            <div key={section.title} className="mt-3 border-t border-border/60 pt-2 first:mt-1 first:border-0 first:pt-0 xl:border-0 xl:pt-0">
              <button
                type="button"
                onClick={() => groups.toggle(section)}
                aria-expanded={open}
                disabled={here}
                title={t(section.hint)}
                className="hidden w-full items-center gap-1.5 rounded-sm px-2.5 py-1 text-left text-[10.5px] font-semibold tracking-[0.08em] text-muted/80 uppercase transition-colors hover:text-fg disabled:cursor-default disabled:hover:text-muted/80 xl:flex"
              >
                <span className="min-w-0 flex-1 truncate">{t(section.title)}</span>
                {!open && waitingHere ? <Badge count={waitingHere} className="normal-case" /> : null}
                {here ? null : <CaretDownIcon size={11} weight="bold" className={cn("shrink-0 transition-transform", !open && "-rotate-90")} />}
              </button>
              {open ? (
                <p className="hidden px-2.5 pb-1.5 text-[11.5px] leading-snug text-muted xl:block">{t(section.hint)}</p>
              ) : null}
              <ul className={cn("grid gap-0.5", !open && "xl:hidden")}>
                {section.items.map((item) => {
                  const active = isActive(pathname, item.to);
                  const IconCmp = item.icon;
                  return (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        title={`${t(item.label)}: ${t(item.blurb)}`}
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
                        <span className="hidden truncate xl:inline">{t(item.label)}</span>
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
          );
        })}
      </nav>
      <HelpFooter pathname={pathname} />
    </aside>
  );
}

/** Up to three company colours, overlapped: the "All companies" mark. */
function CompanyStack({ colors }: { colors: string[] }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center">
      {colors.slice(0, 3).map((c, i) => (
        <span key={i} className={cn("size-2.5 rounded-full ring-2 ring-bg", i > 0 && "-ml-1")} style={{ background: c }} />
      ))}
    </span>
  );
}

const SWITCH_ITEM =
  "group flex min-h-10 cursor-default items-center gap-2.5 rounded-sm px-2.5 py-2 text-[13.5px] outline-none select-none data-[selected=true]:bg-surface-2";

/** Which company the app is looking at: one of them, or all of them. A searchable list (type to
 * filter, arrow keys and Enter) with each company's colour and agent count. */
function BranchSwitcher() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  const { branches, canAll, isAll, selected, select } = useCompanies();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const coarse = useMedia("(pointer: coarse)");
  // Agent counts are a nicety: fetched (or read from cache) only while the list is open.
  const { data: agents } = useQuery({ ...agentsQuery, enabled: open });
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents ?? []) if (a.status !== "retired" && !a.clone_of) m.set(a.branch_id, (m.get(a.branch_id) ?? 0) + 1);
    return m;
  }, [agents]);
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const canCreate = me.permissions.includes("org.manage");
  const choose = (id: string) => {
    select(id);
    setOpen(false);
  };
  const [hl, setHl] = useState("");
  const onOpenChange = (o: boolean) => {
    setOpen(o);
    setQ("");
    // Start the keyboard highlight on the current choice.
    if (o) setHl(isAll ? ALL_COMPANIES : (selected?.id ?? ""));
  };
  const countHint = (n: number | undefined) =>
    agents ? <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] text-muted tabular group-data-[selected=true]:bg-surface">{n ?? 0}</span> : null;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button
          data-guide="shell.company"
          aria-label={t("Company: {name}. Change company", { name: isAll ? t("All companies") : (selected?.name ?? t("none")) })}
          className="flex h-9 max-w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left hover:bg-surface-2 data-[state=open]:bg-surface-2"
        >
          {isAll ? (
            <CompanyStack colors={branches.map((b) => b.color)} />
          ) : (
            <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: selected?.color ?? "var(--border)" }} />
          )}
          <span className="truncate text-[13.5px] font-medium">
            {isAll ? t("All companies") : selected ? selected.name : t("No companies yet")}
          </span>
          {isAll ? <span className="shrink-0 rounded-full bg-surface-2 px-1.5 text-[11px] text-muted tabular max-sm:hidden">{branches.length}</span> : null}
          <CaretUpDownIcon size={14} className="shrink-0 text-muted" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          // Focus goes to the search box (desktop) or the list itself, so arrow keys work at once.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            const root = e.currentTarget as HTMLElement | null;
            const input = root?.querySelector<HTMLInputElement>("input");
            if (input && !coarse) input.focus();
            else root?.querySelector<HTMLElement>("[cmdk-root]")?.focus();
          }}
          className="z-50 w-[min(calc(100vw-1.5rem),20rem)] overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-[menu-in_140ms_cubic-bezier(0.16,1,0.3,1)]"
        >
          <Command label={t("Companies")} loop tabIndex={-1} className="outline-none" value={hl} onValueChange={setHl}
            // Plain "contains" on the names (values are ids, which would fuzzy-match anything).
            filter={(_v, search, words) => (words ?? []).some((w) => w.toLowerCase().includes(search.trim().toLowerCase())) ? 1 : 0}>
            {branches.length > 1 ? (
              <div className="flex items-center gap-2 border-b border-border px-3">
                <MagnifyingGlassIcon size={16} className="shrink-0 text-muted" aria-hidden />
                <Command.Input
                  value={q}
                  onValueChange={setQ}
                  placeholder={t("Find a company…")}
                  className="h-11 w-full min-w-0 bg-transparent text-[16px] outline-none placeholder:text-muted sm:text-[14px]"
                />
              </div>
            ) : null}
            <Command.List className="max-h-[min(22rem,60dvh)] overflow-y-auto overscroll-contain p-1">
              <Command.Empty className="px-3 py-6 text-center text-[13px] text-muted">{t("No company matches “{q}”.", { q })}</Command.Empty>
              {canAll ? (
                <Command.Item value={ALL_COMPANIES} keywords={[t("All companies"), "All companies", "every"]} onSelect={() => choose(ALL_COMPANIES)} className={SWITCH_ITEM}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-surface-2 text-muted ring-1 ring-border/60">
                    <BuildingsIcon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t("All companies")}</span>
                    <span className="block truncate text-[11.5px] text-muted">{t("Lists show every company")}</span>
                  </span>
                  {countHint(total)}
                  <CheckIcon size={15} weight="bold" className={cn("shrink-0 text-accent", !isAll && "invisible")} aria-hidden />
                </Command.Item>
              ) : null}
              {branches.length ? (
                <Command.Group
                  heading={t("Companies")}
                  className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted"
                >
                  {branches.map((b) => {
                    const on = !isAll && selected?.id === b.id;
                    return (
                      <Command.Item key={b.id} value={b.id} keywords={[b.name]} onSelect={() => choose(b.id)} className={SWITCH_ITEM} aria-current={on || undefined}>
                        <span className="grid size-6 shrink-0 place-items-center">
                          <span aria-hidden className="size-2.5 rounded-full" style={{ background: b.color }} />
                        </span>
                        <span className="min-w-0 flex-1 truncate">{b.name}</span>
                        {countHint(counts.get(b.id))}
                        <CheckIcon size={15} weight="bold" className={cn("shrink-0 text-accent", !on && "invisible")} aria-hidden />
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              ) : (
                <p className="px-2.5 py-3 text-[13px] text-muted">{t("Each company you run gets its own office, agents and documents.")}</p>
              )}
            </Command.List>
            {canCreate ? (
              <div className="border-t border-border p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate({ to: "/organization", search: { new: 1 } });
                  }}
                  className="flex min-h-10 w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[13.5px] hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none"
                >
                  <PlusIcon size={16} className="text-muted" /> {t("New company")}
                </button>
              </div>
            ) : null}
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

const THEME_ICON = { light: SunIcon, dark: MoonIcon, system: MonitorIcon } as const;

function ThemeMenu() {
  const t = useT();
  const { pref, setPref } = useTheme();
  const IconCmp = THEME_ICON[pref];
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("Theme")}>
          <IconCmp size={18} />
        </Button>
      </MenuTrigger>
      <MenuContent className="w-44">
        <MenuLabel>{t("Theme")}</MenuLabel>
        <MenuRadioGroup value={pref} onValueChange={(v) => setPref(v as ThemePref)}>
          <MenuRadioItem value="light">{t("Light")}</MenuRadioItem>
          <MenuRadioItem value="dark">{t("Dark")}</MenuRadioItem>
          <MenuRadioItem value="system">{t("Match system")}</MenuRadioItem>
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}

function UserMenu() {
  const { data: me } = useSuspenseQuery(meQuery);
  const t = useT();
  useProfileLanguage();
  const signOut = useSignOut();
  const navigate = useNavigate();
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          className="grid size-8 place-items-center rounded-full bg-accent-soft text-[12px] font-semibold text-accent"
          aria-label={t("Account")}
        >
          {initials(me.user.name)}
        </button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-[13.5px] font-medium">{me.user.name}</p>
          <p className="truncate text-[12.5px] text-muted">{me.user.email}</p>
          <p className="mt-1 text-[12px] text-muted">
            {me.workspace.name} · <span className={ROLE_INFO[me.role] ? undefined : "capitalize"}>{ROLE_INFO[me.role] ? t(ROLE_INFO[me.role].label) : me.role}</span>
          </p>
        </div>
        <MenuSeparator />
        <div className="flex items-center justify-between gap-3 px-2.5 py-1.5">
          <span className="text-[12.5px] text-muted">{t("Language")}</span>
          <LanguageSwitch />
        </div>
        <MenuSeparator />
        <MenuItem icon={<KeyIcon />} onSelect={() => navigate({ to: "/change-password" })}>
          {t("Change password")}
        </MenuItem>
        <MenuItem icon={<SignOutIcon />} onSelect={signOut}>
          {t("Sign out")}
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
  return {
    "/approvals": data?.counts.approvals_pending ?? 0,
    "/skills": data?.counts.skill_proposals_pending ?? 0,
    "/documents": data?.counts.documents_review ?? 0, // P25: what AI made, waiting for review
  };
}

function Badge({ count, className }: { count: number; className?: string }) {
  const t = useT();
  if (!count) return null;
  return (
    <span className={cn("grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[10.5px] font-semibold text-white tabular", className)} aria-label={t("{n} waiting", { n: count })}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function Header() {
  const t = useT();
  const setOpen = usePalette((s) => s.setOpen);
  const navigate = useNavigate();
  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:px-4"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <Link to="/" className="-m-1.5 p-1.5 md:hidden" aria-label={t("Home")}>
        <LogoMark className="size-7" />
      </Link>
      <div className="min-w-0 flex-1">
        <BranchSwitcher />
      </div>
      {/* P25: search inside every document; the command palette stays on Ctrl K. */}
      <HeaderSearch />
      <Button
        variant="ghost"
        size="icon-sm"
        className="hidden md:inline-flex"
        aria-label={t("Jump to a page or run an action…")}
        title={IS_MAC ? "⌘K" : "Ctrl K"}
        onClick={() => setOpen(true)}
      >
        <CommandIcon size={18} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("Broadcast a message")}
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
  const t = useT();
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
      <span className="max-w-full truncate px-0.5">{t(item.short ?? item.label)}</span>
    </Link>
  );
}

function MobileTabBar() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const approvals = useApprovalCount();
  const sections = useVisibleNav();
  const [more, setMore] = useState(false);
  const tabs = TAB_BAR.map((to) => ALL_NAV.find((n) => n.to === to)).filter(Boolean) as NavItem[];
  const moreActive = !tabs.some((tab) => isActive(pathname, tab.to));
  const moreSections = sections
    .filter((s) => s.title !== HELP_SECTION)
    .map((s) => ({ ...s, items: s.items.filter((i) => !TAB_BAR.includes(i.to)) }))
    .filter((s) => s.items.length);

  return (
    <>
      <nav
        aria-label={t("Main")}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {tabs.map((tab) => (
          <TabLink key={tab.to} item={tab} active={isActive(pathname, tab.to)} badge={tab.to === "/approvals" ? approvals : 0} />
        ))}
        <button
          onClick={() => setMore(true)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
            moreActive ? "text-accent" : "text-muted",
          )}
        >
          <DotsThreeIcon size={22} weight="bold" />
          {t("More")}
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
            <Drawer.Title className="sr-only">{t("All pages")}</Drawer.Title>
            <div
              data-vaul-no-drag
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-1 [-webkit-overflow-scrolling:touch]"
              style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
            >
            <div className="mb-4 grid grid-cols-3 gap-2" role="list" aria-label={t("Help")}>
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
                    {t(item.label)}
                  </Link>
                );
              })}
            </div>
            {moreSections.map((s) => (
              <div key={s.title} className="mb-3">
                <p className="px-1 text-[12.5px] font-semibold">{t(s.title)}</p>
                <p className="mb-2 px-1 text-[12px] leading-snug text-muted">{t(s.hint)}</p>
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
                        <span className="leading-tight">{t(item.label)}</span>
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
  const { data: me } = useSuspenseQuery(meQuery);
  // The company switcher remembers each person's choice on this device.
  const bindUser = useBranch((s) => s.bindUser);
  useEffect(() => bindUser(me.user.id), [bindUser, me.user.id]);
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

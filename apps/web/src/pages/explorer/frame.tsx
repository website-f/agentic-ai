/** P61b: the whole Library in one full-screen page, outside the app shell (like the full-screen
 * chat). Every Library address (/explorer, /documents, /sops, /library, /templates, /packs,
 * /company-kit, /search) opens inside this frame: one header (Back, the company, the search,
 * the bell and the account menu), the Library's tabs under it, then the tab itself. Browse (the
 * file explorer) fills the rest of the screen with its own folder tree and scrolling; the other
 * tabs scroll in one area under the tabs. Back returns to the page the Library was opened from,
 * however many tabs and folders were opened since; else to ?from=; else home. */
import { ArrowLeftIcon, DownloadSimpleIcon, FolderOpenIcon, SidebarSimpleIcon } from "@phosphor-icons/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";

import { safeFrom } from "@/components/chat/links";
import { CommandPalette } from "@/components/command-palette";
import { NeedsBell } from "@/components/needs-bell";
import { IconTile } from "@/components/page";
import { SearchField } from "@/components/search-box";
import { useDeviceSync, UserMenu } from "@/components/shell";
import { TaskComposerHost } from "@/components/task-composer/task-composer";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useT } from "@/i18n";
import { ALL_COMPANIES, useCompanies } from "@/lib/company";
import { STORE_VIEWS } from "@/lib/file-store";
import { archiveUrl } from "@/lib/intake";
import { useLiveEvents } from "@/lib/live";
import { meQuery } from "@/lib/queries";
import { useBranch, usePalette } from "@/lib/stores";
import { cn } from "@/lib/utils";

import { LibraryTabs, type BrowseSearch } from "../library-hub/hub";
import { InLibraryFrame, type LibraryFrame as FrameValue } from "./frame-context";

// ---------------------------------------------------------------- leaving

/** Per history entry (its router key): the index the Library was opened at and the ?from= it
 * was opened with. Kept for the tab, so a reload, or coming back with the browser's own Back
 * and Forward, still knows where the Library's Back goes. */
const ENTRIES = "agentic.library.entries";
const KEEP = 100;
type HistoryState = { __TSR_index?: number; __TSR_key?: string };
type Entry = { i: number; from?: string };

function readEntries(): Record<string, Entry> {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(ENTRIES) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, Entry>) : {};
  } catch {
    return {};
  }
}

function useLeave() {
  const router = useRouter();
  const navigate = useNavigate();
  const state = () => router.history.location.state as HistoryState;
  const key = useRouterState({ select: (s) => (s.location.state as HistoryState).__TSR_key ?? "" });
  const [entry] = useState<Entry>(() => {
    const st = state();
    const now = st.__TSR_index ?? 0;
    const saved = st.__TSR_key ? readEntries()[st.__TSR_key] : undefined;
    if (saved && Number.isInteger(saved.i) && saved.i >= 0 && saved.i <= now) return { i: saved.i, from: safeFrom(saved.from) };
    const search = router.history.location.search;
    return { i: now, from: safeFrom(new URLSearchParams(search).get("from") ?? undefined) };
  });
  // Every Library entry visited in this visit remembers where the visit began.
  useEffect(() => {
    if (!key) return;
    try {
      const all = readEntries();
      delete all[key];
      all[key] = entry;
      const keys = Object.keys(all);
      for (const k of keys.slice(0, Math.max(0, keys.length - KEEP))) delete all[k];
      sessionStorage.setItem(ENTRIES, JSON.stringify(all));
    } catch {
      // private mode: this visit only
    }
  }, [key, entry]);
  return () => {
    const now = state().__TSR_index ?? 0;
    if (entry.i > 0 && entry.i <= now) router.history.go(entry.i - now - 1);
    else if (entry.from) void navigate({ href: entry.from });
    else void navigate({ to: "/" });
  };
}

// ---------------------------------------------------------------- small pieces

const TREE = "agentic.explorer.tree-hidden";

function useTreeHidden(): [boolean, (h: boolean) => void] {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(TREE) === "1"; } catch { return false; }
  });
  const set = useCallback((h: boolean) => {
    setHidden(h);
    try { localStorage.setItem(TREE, h ? "1" : "0"); } catch { /* this visit only */ }
  }, []);
  return [hidden, set];
}

/** Ctrl K / ⌘K opens the command palette, as in the app shell. */
function usePaletteKey() {
  const setOpen = usePalette((s) => s.setOpen);
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
}

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

/** The folder (or ready-made folder) open in Browse, without the open file: where the Browse tab
 * goes back to from the other tabs. */
function browseOf(search: Record<string, unknown>): BrowseSearch {
  const view = (STORE_VIEWS as readonly unknown[]).includes(search.view) ? (search.view as BrowseSearch["view"]) : undefined;
  const origin = search.origin === "agent" || search.origin === "uploaded" || search.origin === "person" ? search.origin : undefined;
  return { folder: str(search.folder), view, task: str(search.task), origin };
}

// ---------------------------------------------------------------- the frame

export function LibraryFrame() {
  const t = useT();
  const { data: me } = useSuspenseQuery(meQuery);
  // No app shell here: the company choice, live updates, the badge, the palette and the task
  // composer are set up once for every Library tab.
  const bindUser = useBranch((s) => s.bindUser);
  useEffect(() => bindUser(me.user.id), [bindUser, me.user.id]);
  useLiveEvents();
  useDeviceSync();
  usePaletteKey();

  const navigate = useNavigate({ from: "/explorer" });
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search }) as Record<string, unknown>;
  const browsing = pathname === "/explorer";
  const leave = useLeave();
  const co = useCompanies();
  const branch = co.isAll ? null : co.selected;
  const [treeHidden, setTreeHidden] = useTreeHidden();
  const frame = useMemo<FrameValue>(() => ({ treeHidden, setTreeHidden }), [treeHidden, setTreeHidden]);

  // Browse remembers its folder while the other tabs are open (state adjusted while rendering).
  const here = browsing ? JSON.stringify(browseOf(search)) : null;
  const [browse, setBrowse] = useState("{}");
  if (here !== null && here !== browse) setBrowse(here);
  const browseSearch = useMemo(() => JSON.parse(browse) as BrowseSearch, [browse]);

  const pickCompany = (id: string) => {
    co.select(id);
    setBrowse("{}");
    // Browse starts again at the new company's top folder.
    if (browsing) {
      void navigate({
        to: "/explorer",
        search: (s) => ({ ...s, view: undefined, task: undefined, folder: undefined, f: undefined, page: undefined }),
        resetScroll: false,
      });
    }
  };
  const many = co.branches.length > 1;
  const options = [...(co.canAll ? [{ value: ALL_COMPANIES, label: t("All companies") }] : []), ...co.branches.map((b) => ({ value: b.id, label: b.name }))];

  return (
    <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-1.5 sm:gap-2 sm:px-3">
        <Button variant="ghost" size="sm" className="h-10 min-w-10 shrink-0 gap-1.5 px-2.5 text-fg pointer-coarse:h-11 pointer-coarse:min-w-11"
          onClick={leave} aria-label={t("Back")} title={t("Back")}>
          <ArrowLeftIcon size={18} weight="bold" /> <span className="max-sm:hidden">{t("Back")}</span>
        </Button>
        <span aria-hidden className="h-6 w-px shrink-0 bg-border max-sm:hidden" />
        <IconTile icon={FolderOpenIcon} size="sm" className="max-sm:hidden" />
        <h1 className={cn("shrink-0 text-[15.5px] font-semibold tracking-[-0.01em]", many && "max-[520px]:sr-only")}>{t("Library")}</h1>
        {many ? (
          <div data-guide="files.company" className="min-w-0 sm:ml-1">
            <Select size="sm" value={branch?.id ?? ALL_COMPANIES} onValueChange={pickCompany} label={t("Company")} options={options}
              placeholder={t("Pick a company")} className="w-44 sm:w-56 pointer-coarse:h-11" />
          </div>
        ) : null}
        <span className="min-w-0 flex-1" />
        {/* The whole Library's search; on smaller screens the Search tab is one tap away (and
            the Search tab has its own big box). */}
        {pathname !== "/search" ? <div className="hidden min-w-0 lg:block"><SearchField /></div> : null}
        {browsing ? (
          <Button size="icon-sm" variant="ghost" className="hidden shrink-0 md:inline-flex" onClick={() => setTreeHidden(!treeHidden)}
            aria-pressed={!treeHidden} aria-label={treeHidden ? t("Show the folders") : t("Hide the folders")} title={treeHidden ? t("Show the folders") : t("Hide the folders")}>
            <SidebarSimpleIcon size={18} />
          </Button>
        ) : null}
        {branch ? (
          <Button asChild size="icon-sm" variant="ghost" className="shrink-0 pointer-coarse:size-11">
            <a href={archiveUrl({ branch_id: branch.id })} download data-guide="files.download-all"
              aria-label={t("Download everything from {company}", { company: branch.name })} title={t("Download everything from {company}", { company: branch.name })}>
              <DownloadSimpleIcon size={18} />
            </a>
          </Button>
        ) : null}
        <div className="flex shrink-0 items-center gap-0.5 pointer-coarse:*:size-11">
          <NeedsBell />
          <UserMenu />
        </div>
      </header>

      <LibraryTabs bar browse={browseSearch} />

      <InLibraryFrame.Provider value={frame}>
        {browsing ? (
          // Browse fills the rest of the screen and scrolls inside its own panes.
          <Outlet />
        ) : (
          // One scrolling area for the other tabs; it starts at the top on every new page and
          // comes back where it was with the browser's Back (see scrollToTopSelectors). No app
          // tab bar here, so phone action bars stick to the bottom (--bottom-bar).
          <main id="library-main" data-scroll-restoration-id="library-main"
            className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] [--bottom-bar:0px]">
            <Outlet />
          </main>
        )}
      </InLibraryFrame.Provider>

      <CommandPalette />
      <TaskComposerHost />
    </div>
  );
}

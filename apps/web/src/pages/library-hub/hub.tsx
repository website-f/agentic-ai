/** The Library: every file, document, SOP and guideline in one place. One nav entry; each tab
 * keeps its own address (/files, /documents, /sops, ...), so deep links, the guide and the
 * tutorial still open the right one. Every tab page starts with <LibraryHeader>: the one title
 * "Library", the tab's own description and actions, then the tabs. */
import {
  BooksIcon, FileMagnifyingGlassIcon, FileTextIcon, FilesIcon, FolderOpenIcon, IdentificationCardIcon, PackageIcon, StackIcon,
  type Icon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";

import { PageHeader } from "@/components/page";
import { msg, useT } from "@/i18n";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ALL_NAV } from "@/nav";

export type LibraryPath = "/files" | "/documents" | "/sops" | "/library" | "/templates" | "/packs" | "/company-kit" | "/search";

export interface LibraryTab {
  to: LibraryPath;
  label: string;
  icon: Icon;
  description: string;
}

/** In order. Labels and descriptions are English keys (msg); render them with t(). */
export const LIBRARY_TABS: LibraryTab[] = [
  {
    to: "/files", label: msg("Browse"), icon: FolderOpenIcon,
    description: msg("Every file in folders: the company's own folders, plus ready-made folders for documents, SOPs, guidelines, templates and what agents made or downloaded."),
  },
  {
    to: "/documents", label: msg("Documents"), icon: FilesIcon,
    description: msg("Quotations, invoices, letters and proposals, written by you or by agents. Each is checked automatically, approved by a person, then exported to PDF, Word or Excel."),
  },
  {
    to: "/sops", label: msg("SOPs"), icon: FileTextIcon,
    description: msg("Written procedures your agents follow. Company and department SOPs apply automatically; the others are attached to specific agents."),
  },
  {
    to: "/library", label: msg("Guidelines"), icon: BooksIcon,
    description: msg("The office's guidelines, manuals and policies, plus every SOP. Agents search them when the work needs it and cite the page they used."),
  },
  {
    to: "/templates", label: msg("Templates"), icon: StackIcon,
    description: msg("The documents you write again and again. Start from a starter, write your own with {{placeholders}}, or upload your own Word file and keep its layout."),
  },
  {
    to: "/packs", label: msg("Packs"), icon: PackageIcon,
    description: msg("Everything a submission needs, in one PDF. List the items, let the office match the company's files and documents (or ask an agent to prepare the rest), then compile it with a cover and contents for you to check and submit."),
  },
  {
    to: "/company-kit", label: msg("Company kit"), icon: IdentificationCardIcon,
    description: msg("The facts every document about a company reuses: legal name, registration, address, bank, signatory and logo. Fill it once; templates and agents use it everywhere."),
  },
  {
    to: "/search", label: msg("Search"), icon: FileMagnifyingGlassIcon,
    description: msg("Search inside every document your company has: files page by page, SOPs, prepared documents, templates and wiki pages."),
  },
];

export function libraryTab(to: LibraryPath): LibraryTab {
  return LIBRARY_TABS.find((x) => x.to === to)!;
}

/** The tabs this person may open: the same permissions the navigation uses for each address. */
export function useLibraryTabs(): LibraryTab[] {
  const { data: me } = useQuery(meQuery);
  return LIBRARY_TABS.filter((tab) => {
    const item = ALL_NAV.find((n) => n.to === tab.to);
    if (!item?.perm) return true;
    return !!me && [item.perm].flat().some((p) => me.permissions.includes(p));
  });
}

function onPath(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/** The Library's tabs: links, so each tab is its own address. Scrolls sideways on phones. */
export function LibraryTabs({ className }: { className?: string }) {
  const t = useT();
  const tabs = useLibraryTabs();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const list = useRef<HTMLDivElement>(null);
  const current = tabs.find((x) => onPath(pathname, x.to))?.to;
  // On phones the row scrolls: keep the open tab in view.
  useEffect(() => {
    const box = list.current;
    const tab = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !tab || box.scrollWidth <= box.clientWidth) return;
    box.scrollTo({ left: tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2 });
  }, [current]);
  return (
    <nav aria-label={t("Library")} className={cn("min-w-0", className)}>
      <div ref={list} data-guide="library.tabs"
        className="-mx-4 flex min-w-0 gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.to === current;
          const IconCmp = tab.icon;
          return (
            <Link key={tab.to} to={tab.to} aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex shrink-0 items-center gap-2 px-3 pt-2 pb-3 text-[14px] whitespace-nowrap transition-colors",
                "after:absolute after:inset-x-2 after:-bottom-px after:h-[2.5px] after:rounded-full after:transition-colors",
                active ? "font-semibold text-fg after:bg-accent" : "text-muted after:bg-transparent hover:text-fg",
              )}>
              <IconCmp size={18} weight={active ? "fill" : "regular"} className={active ? "text-accent" : undefined} />
              {t(tab.label)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/** The top of every Library tab: the title "Library", what this tab is for, its own actions
 * (Upload, New document, New SOP...), then the tabs. */
export function LibraryHeader({ tab, actions }: { tab: LibraryPath; actions?: ReactNode }) {
  const t = useT();
  const here = libraryTab(tab);
  return (
    <div className="grid min-w-0 gap-4">
      <PageHeader title={t("Library")} eyebrow={false} icon={here.icon} description={t(here.description)} actions={actions} />
      <LibraryTabs />
    </div>
  );
}

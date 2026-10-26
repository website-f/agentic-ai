/** P52: the tabs of a hub (nav.ts HUBS): pages that share one sidebar entry, shown under the
 * title of each of them. Links, so every tab keeps its own address; scrolls sideways on a
 * phone, keeping the open tab in view. Rendered by PageHeader. */
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { useT } from "@/i18n";
import { meQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { hubOf, hubTabs, navItemFor } from "@/nav";

const on = (pathname: string, to: string) => (to === "/" ? pathname === "/" || pathname === "/overview" : pathname === to || pathname.startsWith(`${to}/`));

export function HubTabs() {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = useQuery(meQuery);
  const list = useRef<HTMLDivElement>(null);
  const entry = navItemFor(pathname);
  const hub = entry ? hubOf(entry.to) : undefined;
  const tabs = hub && me ? hubTabs(hub, me.permissions) : [];
  const current = tabs.filter((x) => on(pathname, x.to)).sort((a, b) => b.to.length - a.to.length)[0]?.to;
  useEffect(() => {
    const box = list.current;
    const tab = box?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!box || !tab || box.scrollWidth <= box.clientWidth) return;
    box.scrollTo({ left: tab.offsetLeft - (box.clientWidth - tab.offsetWidth) / 2 });
  }, [current]);
  if (!hub || tabs.length < 2) return null;
  return (
    <nav aria-label={t(hub.label)} className="min-w-0">
      <div ref={list} data-guide="hub.tabs"
        className="-mx-4 flex min-w-0 gap-1 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {tabs.map((tab) => {
          const active = tab.to === current;
          const IconCmp = tab.icon;
          return (
            <Link key={tab.to} to={tab.to} aria-current={active ? "page" : undefined} title={t(tab.blurb)}
              className={cn(
                "relative flex min-h-11 shrink-0 items-center gap-2 px-3 pt-2 pb-3 text-[14px] whitespace-nowrap transition-colors",
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

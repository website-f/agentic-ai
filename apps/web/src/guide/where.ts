/** P102 "Where to find it": the sidebar path to a guide chapter's page, read from nav.ts, so it
 * always matches the sidebar people see (a hub's tabs, the Library's tabs, folded groups). Pages
 * the sidebar keeps behind "Show all pages" are all tabs of a hub, which is always listed. The
 * labels are English keys: show each one with t(). */
import { ALL_NAV, HUBS, NAV, navItemFor, type NavItem } from "@/nav";

export interface WhereStep {
  label: string;
  /** A tab on the page before it, not a sidebar entry of its own. */
  tab?: boolean;
}

export interface Where {
  /** Sidebar section, then the entry, then the tab when the page is one. */
  trail: WhereStep[];
  /** The sidebar group that holds it is folded at first (Settings). */
  folded: boolean;
}

const sectionOf = (to: string) => NAV.find((s) => s.items.some((i) => i.to === to));

/** The way to a page's route from the sidebar, or undefined when the sidebar has no entry for it. */
export function whereOf(route: string): Where | undefined {
  const item: NavItem | undefined = navItemFor(route);
  if (!item) return undefined;
  const hub = HUBS.find((h) => h.tabs.includes(item.to));
  let section = sectionOf(item.to);
  const trail: WhereStep[] = [];
  if (hub) {
    // The sidebar lists a hub once, under its first tab's section and the hub's name.
    const first = hub.tabs[0]!;
    section = sectionOf(first) ?? section;
    trail.push({ label: hub.label });
    if (item.to !== first) trail.push({ label: item.label, tab: true });
  } else if (item.hidden) {
    // A tab of another entry (the Library's Documents, SOPs...): that entry, then the tab.
    const parent = ALL_NAV.find((i) => !i.hidden && i.also?.includes(item.to));
    if (parent) {
      section = sectionOf(parent.to) ?? section;
      trail.push({ label: parent.label }, { label: item.label, tab: true });
    } else trail.push({ label: item.label });
  } else trail.push({ label: item.label });
  if (!section) return undefined;
  const all = [{ label: section.title }, ...trail].filter((s, i, a) => i === 0 || s.label !== a[i - 1]!.label);
  return { trail: all, folded: section.open === "none" };
}

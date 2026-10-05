import { BookBookmarkIcon, type Icon } from "@phosphor-icons/react";

import { msg } from "@/i18n";
import { ALL_NAV } from "@/nav";

import { GUIDE_PAGES, type GuidePage } from "./targets";

/** "Click **New task**" with the on-screen words as small chips. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("**").map((part, i) =>
        !part ? null : i % 2 ? (
          <span
            key={i}
            className="rounded-[5px] border border-border bg-surface-2 px-1.5 py-px text-[0.93em] font-medium text-fg [box-decoration-break:clone]"
          >
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

function navIcon(page: GuidePage): Icon {
  const exact = ALL_NAV.find((n) => n.to === page.route);
  const prefix = ALL_NAV.filter((n) => n.to !== "/" && page.route.startsWith(n.to)).sort((a, b) => b.to.length - a.to.length)[0];
  return (exact ?? prefix)?.icon ?? BookBookmarkIcon;
}

/** Each guide page's sidebar icon, by page id (a static map, so render code only looks it up). */
export const PAGE_ICONS: Record<string, Icon> = Object.fromEntries(GUIDE_PAGES.map((p) => [p.id, navIcon(p)]));

/** Friendly names for captured states (English keys; show them with t()). */
const STATE_LABELS: Record<string, string> = {
  new: msg("Creating one"),
  detail: msg("Detail page"),
  sheet: msg("Opened item"),
  editor: msg("Editor"),
  agent: msg("Agent panel"),
  welcome: msg("Hiring steps"),
  conversation: msg("Conversation"),
  roi: msg("ROI calculator"),
};

/** The English name of a captured state: pass it through t() where it shows. */
export const stateLabel = (key: string) => STATE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1).replace(/[-_]/g, " ");

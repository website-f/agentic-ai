/**
 * P79: Show me on this page for a Prima screen. Prima's screens share one layout (its kit,
 * apps/prima/apps/web/src/kit.tsx): the page head with what the screen is for and its main
 * buttons ("Add mandate", "New contract"), tabs, the numbers at the top, search, then cards.
 * The tour walks those parts of the screen open now, in the person's language, and lights
 * each one (the elements themselves are handed to the tour: Prima's page is not changed).
 * Steps Prima writes for a screen itself (window.__primaPage.steps) are used instead, when it
 * has them.
 */
import type { GuideStep } from "@/components/feedback/guide-targets";
import { msg } from "@/i18n";

type T = (text: string, vars?: Record<string, string | number>) => string;

/** An element's first line of text (a heading, a button's name), at most `max` characters. */
const first = (el: Element | null | undefined, max = 80): string =>
  ((el as HTMLElement | null)?.innerText ?? el?.textContent ?? "").trim().split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, max) ?? "";

function seen(el: Element | null): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.getClientRects().length > 0 && !el.closest("[data-feedback-ignore], [hidden], [aria-hidden=true]");
}

/** The words for a list of names: "A, B and C" (at most `max`, "and more" after). */
function list(names: string[], t: T, max = 5): string {
  const n = names.filter(Boolean).slice(0, max);
  if (!n.length) return "";
  if (n.length === 1) return n[0]!;
  const head = n.slice(0, -1).join(", ");
  const more = names.length > max;
  return more ? t("{list} and more", { list: n.join(", ") }) : t("{a} and {b}", { a: head, b: n.at(-1)! });
}

// The words of the tour (Malay in i18n/ms/feedback.ts).
const W = {
  head: msg("{title}: {what}"),
  headOnly: msg("This screen is {title}. Its title and main buttons are at the top."),
  add: msg("Press {label} to start a new one: a form opens at the side."),
  more: msg("Also at the top: {list}."),
  tabs: msg("The tabs split the screen into parts: {list}. Pick one to see it."),
  statsPress: msg("The numbers show where things stand. Press one to see just those."),
  stats: msg("The numbers show where things stand."),
  search: msg("Search here to find one quickly."),
  card: msg("{title}: {what}"),
  cardOnly: msg("{title} is shown here."),
  steps: msg("These steps show how far it has got: a tick means done."),
  empty: msg("Nothing here yet. It fills in as work comes in."),
};

/** The tour of the screen open now. */
export function primaLayoutSteps(t: T, doc: Document = document): GuideStep[] {
  const main = doc.querySelector("main") ?? doc.body;
  const out: GuideStep[] = [];

  const head = main.querySelector(".k-head");
  if (seen(head)) {
    const title = first(head.querySelector("h1"));
    const what = first(head.querySelector(".k-head-sub"), 400);
    if (title) out.push({ text: what ? t(W.head, { title, what }) : t(W.headOnly, { title }), el: head.querySelector(".k-head-text") ?? head });
    const buttons = Array.from(head.querySelectorAll(".k-head-actions button, .k-head-actions a")).filter(seen);
    const [primary, ...rest] = buttons;
    if (primary && first(primary)) {
      out.push({ text: t(W.add, { label: first(primary) }), el: primary });
    }
    const others = rest.map((e) => first(e)).filter(Boolean);
    if (others.length) out.push({ text: t(W.more, { list: list(others, t) }), el: head.querySelector(".k-head-actions") ?? undefined });
  }

  const tabs = Array.from(main.querySelectorAll("[role=tablist]")).find(seen);
  if (tabs) {
    const names = Array.from(tabs.querySelectorAll("[role=tab]")).map((e) => first(e)).filter(Boolean);
    if (names.length > 1) {
      out.push({ text: t(W.tabs, { list: list(names, t, 6) }), el: tabs });
    }
  }

  const stats = Array.from(main.querySelectorAll(".k-stats")).find(seen);
  if (stats) {
    out.push({ text: stats.querySelector("button.k-stat") ? t(W.statsPress) : t(W.stats), el: stats });
  }

  const search = Array.from(main.querySelectorAll(".k-search, .k-toolbar")).find(seen);
  if (search) {
    out.push({ text: t(W.search), el: search });
  }

  // The first cards with a title, at most three, so the tour stays short.
  let cards = 0;
  for (const card of Array.from(main.querySelectorAll(".k-card"))) {
    if (cards >= 3 || !seen(card)) continue;
    const title = first(card.querySelector(":scope > .k-card-head h2"));
    if (!title) continue;
    const what = first(card.querySelector(":scope > .k-card-head .k-card-title p"), 300);
    out.push({ text: what ? t(W.card, { title, what }) : t(W.cardOnly, { title }), el: card });
    cards++;
  }

  const steps = Array.from(main.querySelectorAll(".k-steps")).find(seen);
  if (steps) {
    out.push({ text: t(W.steps), el: steps });
  }

  if (!cards) {
    const empty = Array.from(main.querySelectorAll(".k-empty")).find(seen);
    if (empty) {
      out.push({ text: t(W.empty), el: empty });
    }
  }
  return out;
}

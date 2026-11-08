import { tr, type Lang } from './i18n';
import { SCREEN_GUIDES } from './arisha-screens.data';

/**
 * P87: Arisha's screen guide. One plain-language page per menu screen (what it is for, who uses it, its tabs, how to do
 * the common tasks with the exact button names, words that need explaining, and why a button may be missing), written
 * from each screen's code. Arisha gets the full page for the screen the person has open, and a one-line index of the
 * other screens in their own menu so she can say where to go. Static text only: no record values, names or data.
 */
export interface ScreenGuide {
  view: string;
  title: string;
  what: string;
  who: string;
  tabs: { name: string; what: string }[];
  tasks: { task: string; steps: string[] }[];
  terms: { term: string; means: string }[];
  notes: string;
}

export { SCREEN_GUIDES };
const BY_VIEW = new Map(SCREEN_GUIDES.map((g) => [g.view, g]));

export function screenGuide(view: string): ScreenGuide | undefined {
  return BY_VIEW.get(view);
}

/**
 * Quoted screen words as the person sees them: the screens are translated by the same table, so a Malay or mixed
 * screen shows the translated label; Arisha gets both so she can name the button exactly as it appears.
 */
export function onScreen(text: string, lang: Lang): string {
  if (lang === 'en') return text;
  return text.replace(/"([^"\n]{1,80})"/g, (whole, label: string) => {
    const shown = tr(label, lang);
    return shown && shown !== label ? `"${shown}" (English: "${label}")` : whole;
  });
}

/**
 * The open screen's guide within `room` characters. The parts are kept in order of use (what it is for, who, the
 * notes on missing buttons, the how-tos, tabs, words); a how-to that does not fit is still named, so Arisha knows it
 * exists and can say "ask me about ..." rather than invent the steps.
 */
function full(g: ScreenGuide, lang: Lang, room: number): string {
  const head = [`SCREEN OPEN NOW: ${g.title}`, `What it is for: ${g.what}`, `Who uses it: ${g.who}`];
  if (g.notes) head.push(`If something is missing or empty: ${g.notes}`);
  const parts: string[] = [onScreen(head.join('\n'), lang)];
  let used = parts[0].length;
  const add = (text: string) => {
    const t = onScreen(text, lang);
    if (used + t.length + 1 > room) return false;
    parts.push(t);
    used += t.length + 1;
    return true;
  };
  const left: string[] = [];
  if (g.tasks.length) add('How to:');
  for (const t of g.tasks) if (!add([`* ${t.task}`, ...t.steps.map((s, i) => `  ${i + 1}. ${s}`)].join('\n'))) left.push(t.task);
  if (g.tabs.length) add(['Tabs:', ...g.tabs.map((t) => `- "${t.name}": ${t.what}`)].join('\n')) || add(`Tabs: ${g.tabs.map((t) => `"${t.name}"`).join(', ')}`);
  if (g.terms.length) add(['Words on this screen:', ...g.terms.map((t) => `- ${t.term}: ${t.means}`)].join('\n'));
  if (left.length) parts.push(onScreen(`More how-tos on this screen (steps not loaded here; say they exist and give the general way from the tabs above): ${left.join('; ')}`, lang));
  return parts.join('\n');
}

/** A line's first sentence, cut to n characters. */
const short = (s: string, n: number) => {
  const first = s.split(/(?<=\.)\s/)[0];
  return first.length <= n ? first : `${first.slice(0, n - 1).trimEnd()}…`;
};

/**
 * The screen guide part of Arisha's brief: the open screen in full, the person's other screens one line each, within
 * `room` characters (the server takes at most 20,000 for the whole brief, so the caller passes what is left).
 */
export function screenGuideText(view: string, menu: string[], lang: Lang, room = 12_000): string {
  const intro =
    'SCREEN GUIDE (written from the screens themselves; quoted words are the exact labels on screen. Explain only from this guide, the cards and the rules; if it does not cover something, say so and suggest asking their manager or IT.)';
  const open = BY_VIEW.get(view);
  const mine = new Set(menu);
  const others = SCREEN_GUIDES.filter((g) => g.view !== view && mine.has(g.title));
  const name = (g: ScreenGuide) => (tr(g.title, lang) !== g.title ? `${tr(g.title, lang)} (${g.title})` : g.title);
  // The open screen first (up to two thirds of the room), then as much of the menu index as fits.
  const openText = open ? full(open, lang, Math.max(1500, Math.floor(room * 0.66) - intro.length)) : `SCREEN OPEN NOW: ${view} (no guide written for this screen yet; say so if asked about it).`;
  const rest = room - intro.length - openText.length - 120;
  const lines: string[] = [];
  for (const width of [110, 60, 0]) {
    lines.length = 0;
    let used = 0;
    for (const g of others) {
      const line = width ? `- ${name(g)}: ${short(g.what, width)}` : `- ${name(g)}`;
      used += line.length + 1;
      lines.push(line);
    }
    if (used <= rest) break;
  }
  while (lines.length && lines.reduce((n, l) => n + l.length + 1, 0) > rest) lines.pop();
  return [intro, openText, lines.length ? `OTHER SCREENS IN THIS PERSON'S MENU (use to answer "where do I ...?"):\n${lines.join('\n')}` : '']
    .filter(Boolean)
    .join('\n');
}

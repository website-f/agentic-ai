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

function full(g: ScreenGuide, lang: Lang): string {
  const lines = [`SCREEN OPEN NOW: ${g.title}`, `What it is for: ${g.what}`, `Who uses it: ${g.who}`];
  if (g.tabs.length) lines.push('Tabs:', ...g.tabs.map((t) => `- "${t.name}": ${t.what}`));
  if (g.tasks.length) {
    lines.push('How to:');
    for (const t of g.tasks) lines.push(`* ${t.task}`, ...t.steps.map((s, i) => `  ${i + 1}. ${s}`));
  }
  if (g.terms.length) lines.push('Words on this screen:', ...g.terms.map((t) => `- ${t.term}: ${t.means}`));
  if (g.notes) lines.push(`If something is missing or empty: ${g.notes}`);
  return onScreen(lines.join('\n'), lang);
}

/** The screen guide part of Arisha's brief: the open screen in full, the person's other screens one line each. */
export function screenGuideText(view: string, menu: string[], lang: Lang): string {
  const open = BY_VIEW.get(view);
  const mine = new Set(menu);
  const others = SCREEN_GUIDES.filter((g) => g.view !== view && mine.has(g.title));
  const index = others.map((g) => `- ${tr(g.title, lang) !== g.title ? `${tr(g.title, lang)} (${g.title})` : g.title}: ${g.what}`);
  return [
    'SCREEN GUIDE (written from the screens themselves; quoted words are the exact labels on screen. Explain only from this guide, the cards and the rules; if it does not cover something, say so and suggest asking their manager or IT.)',
    open ? full(open, lang) : `SCREEN OPEN NOW: ${view} (no guide written for this screen yet; say so if asked about it).`,
    index.length ? `OTHER SCREENS IN THIS PERSON'S MENU (use to answer "where do I ...?"):\n${index.join('\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * P75: what the office's feedback button (its "Rules & guide" panel) shows about the screen open now: the screen,
 * the person's Prima role, and Prima's rules that govern it. The office's widget (/feedback-widget.js, built by
 * apps/web) reads window.__primaPage each time it opens and listens for "prima:page".
 */
import { RULES } from '@prima/core';

export interface PrimaPage {
  view: string;
  title: string;
  blurb?: string;
  /** How to use the screen; `target` (a CSS selector, best a data-guide attribute) is the element a step is about,
   * lit in the widget's "Show me on this page". Without steps the widget walks the screen's layout itself. */
  steps?: (string | { text: string; target?: string })[];
  role?: { label: string; blurb?: string };
  rules?: { id: string; title: string; body?: string; source?: string }[];
}

declare global {
  interface Window {
    __primaPage?: PrimaPage;
  }
}

/** The rule families each screen is governed by (rule id prefixes, packages/core/src/rules.ts). */
const RULES_BY_VIEW: Record<string, string[]> = {
  it: ['IT-', 'PILOT'],
  websites: ['IT-'],
  continuity: ['BCM', 'IT-'],
  clock: ['SYS', 'HR-', 'PDPA'],
  staffclock: ['SYS', 'HR-', 'PDPA'],
  claims: ['HR-', 'PAY'],
  staffpay: ['PAY', 'HR-', 'EA'],
  finance: ['FIN', 'PAY'],
  act: ['ACT', 'AUD', 'GOV'],
  grc: ['ACT', 'GOV', 'AUD'],
  audit: ['AUD', 'ACT'],
  hr: ['HR-', 'LEAVE', 'EA'],
  people: ['HR-'],
  attendance: ['OPS-', 'HR-'],
  roster: ['OPS-'],
  sites: ['OPS-'],
  arms: ['ARMS'],
  cms: ['CMS', 'ARMS'],
  cases: ['CASE', 'EVID'],
  meetings: ['MTG'],
  fwm: ['FWM'],
  socso: ['HR-', 'INS'],
  insurance: ['INS'],
  pdpa: ['PDPA'],
};

type RuleRow = { id: string; label: string; source: string };

/** A scannable title: the first sentence, without the "Fauzan, 27 Oct 2026:" it was decided with (kept in the body). */
function titleOf(text: string): string {
  const plain = text.replace(/^[^:]{0,60}\d{1,2} [A-Z][a-z]{2} \d{4}[^:]{0,40}:\s*/, '');
  const s = plain.split(/(?<=\.)\s/)[0] ?? plain;
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return t.length > 110 ? `${t.slice(0, 107)}…` : t;
}

export function rulesFor(view: string): NonNullable<PrimaPage['rules']> {
  const prefixes = RULES_BY_VIEW[view] ?? [];
  if (!prefixes.length) return [];
  return (Object.values(RULES) as unknown as RuleRow[])
    .filter((r) => prefixes.some((p) => r.id.startsWith(p)))
    .slice(0, 12)
    .map((r) => ({ id: r.id, title: titleOf(r.source), body: r.source, source: r.label }));
}

/** Tell the office's feedback button which screen is open. */
export function publishPage(page: PrimaPage): void {
  window.__primaPage = page;
  window.dispatchEvent(new Event('prima:page'));
}

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
  steps?: string[];
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

function firstSentence(text: string): string {
  const s = text.split(/(?<=\.)\s/)[0] ?? text;
  return s.length > 110 ? `${s.slice(0, 107)}…` : s;
}

export function rulesFor(view: string): NonNullable<PrimaPage['rules']> {
  const prefixes = RULES_BY_VIEW[view] ?? [];
  if (!prefixes.length) return [];
  return (Object.values(RULES) as unknown as RuleRow[])
    .filter((r) => prefixes.some((p) => r.id.startsWith(p)))
    .slice(0, 12)
    .map((r) => ({ id: r.id, title: firstSentence(r.source), body: r.source, source: r.label }));
}

/** Tell the office's feedback button which screen is open. */
export function publishPage(page: PrimaPage): void {
  window.__primaPage = page;
  window.dispatchEvent(new Event('prima:page'));
}

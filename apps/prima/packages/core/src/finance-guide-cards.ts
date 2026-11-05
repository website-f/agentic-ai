/**
 * The Finance guide cards in the shared guide-card shape (GuideCardSpec, PR #56 `guide-cards.ts`, 4989972), kept as plain
 * data so this PR builds on its own. The type below is a local copy; at the combined merge it is replaced by the import
 * from `./guide-cards` and the list is passed to `registerGuideCards(FINANCE_GUIDE_CARD_SPECS)`. Nothing here adds
 * wording: every text comes from the Finance cards in `finance-guides.ts`, so the two cannot say different things.
 */
import { FIN_GUIDES, finGuidesFor, type FinGuide, type FinGuideRole, type FinText } from './finance-guides';
import type { User } from './types';

// ---- Local copy of the shared shape (PR #56). Replace with `import type { GuideCardSpec } from './guide-cards'` at merge.
interface GuideText {
  bm: string;
  en: string;
}
interface GuideField {
  key: string;
  label: string;
  required: boolean;
  format: GuideText;
  example: string;
  choices?: string[];
  rule?: GuideText;
}
export interface FinanceGuideCardSpec {
  id: string;
  status: 'ready' | 'partial' | 'not_built';
  dept: string;
  title: GuideText;
  purpose: GuideText;
  who: GuideText;
  screen: { view: string | null; name: string; action: GuideText };
  fields?: GuideField[];
  sources: { what: GuideText; askDesk: FinanceSourceDesk | null; askName?: string }[];
  enteredOnce: GuideText;
  steps: { save: GuideText; review: GuideText; returned: GuideText; done: GuideText; recover: GuideText };
  notVerified: GuideText[];
  allowed: (user: User) => boolean;
  actions?: string[];
}
// ---- end of local copy

/** The hand-over desks (`OrgDesk` in the shared `org-links.ts`) that keep a Finance card's source papers. */
export type FinanceSourceDesk = 'finance' | 'procurement' | 'company_office';
type SourceKeeper = { desk: FinanceSourceDesk } | { name: string };

/**
 * Who keeps each source, in the order of the card's `sources` list. Taken from the source wording itself: Finance's own
 * files, SQL Account and payment records sit with Finance; a Procurement purchase with Procurement; what a company head
 * sends with a request sits with that company's office; the daily worker list comes from the named site supervisor.
 */
export const FINANCE_SOURCE_KEEPERS: Record<string, SourceKeeper[]> = {
  'fin.payment.prepare': [{ desk: 'finance' }, { desk: 'finance' }, { desk: 'procurement' }],
  'fin.payment.review': [{ desk: 'finance' }],
  'fin.payment.approve': [{ desk: 'finance' }],
  'fin.payment.release': [{ desk: 'finance' }],
  'fin.request.create': [{ desk: 'company_office' }],
  'fin.request.check': [{ desk: 'company_office' }],
  'fin.dailycash.list': [{ name: 'The site supervisor who uses the workers' }],
  'fin.dailycash.collector': [{ desk: 'finance' }],
};

function keeperOf(id: string, i: number): { askDesk: FinanceSourceDesk | null; askName?: string } {
  const k = FINANCE_SOURCE_KEEPERS[id]?.[i];
  if (!k) throw new Error(`Finance guide card ${id}: source ${i} names no keeper`);
  return 'desk' in k ? { askDesk: k.desk } : { askDesk: null, askName: k.name };
}

const g = (x: FinText): GuideText => ({ bm: x.ms, en: x.en });
const join = (xs: FinText[]): GuideText => ({ bm: xs.map((x) => x.ms).join(' '), en: xs.map((x) => x.en).join(' ') });
const ROLE: Record<FinGuideRole, FinText> = {
  fin_data_entry: { ms: 'Kemasukan data Kewangan', en: 'Finance data entry' },
  fin_deputy: { ms: 'Timbalan ketua pasukan Kewangan', en: 'Finance team deputy' },
  fin_leader: { ms: 'Ketua pasukan Kewangan', en: 'Finance team leader' },
  fd: { ms: 'Pengarah Kewangan', en: 'Finance Director' },
  ceo: { ms: 'CEO', en: 'CEO' },
  coo: { ms: 'COO', en: 'COO' },
  company_head: { ms: 'Pengurus syarikat', en: 'Company manager' },
  dept_head: { ms: 'Ketua jabatan', en: 'Department head' },
};
const example = (v: FinGuide['fields'][number]['example']) => (typeof v === 'string' || typeof v === 'number' ? String(v) : JSON.stringify(v));

function spec(c: FinGuide): FinanceGuideCardSpec {
  const steps = join(c.steps);
  return {
    id: c.id,
    status: c.status === 'built' ? 'ready' : 'not_built',
    dept: 'finance',
    title: g(c.title),
    purpose: g(c.purpose),
    who: join(c.for.map((r) => ROLE[r])),
    screen: { view: c.id.startsWith('fin.request.') ? 'payreq' : 'finance', name: c.where.en, action: g(c.where) },
    fields: c.fields.map((f) => ({ key: f.key, label: f.label.en, required: f.required, format: g(f.format), example: example(f.example) })),
    sources: [
      ...c.sources.map((what, i) => ({ what: g(what), ...keeperOf(c.id, i) })),
      ...c.ask.map((what) => ({ what: g(what), askDesk: null, askName: what.en })),
    ],
    enteredOnce: join(c.reused),
    // The Finance cards keep one ordered list of steps (save, review, return and resubmit are in it), so each step slot
    // carries that same list rather than new wording.
    steps: { save: steps, review: steps, returned: steps, done: g(c.done), recover: join(c.recover) },
    notVerified: (c.notes ?? []).map(g),
    // Same role check as the Finance screen and Arisha (finGuidesFor reads the Finance services' own actor rules).
    allowed: (user) => finGuidesFor(user).some((x) => x.id === c.id),
  };
}

/** Finance's cards for `registerGuideCards(...)` at the combined merge. */
export const FINANCE_GUIDE_CARD_SPECS: FinanceGuideCardSpec[] = FIN_GUIDES.map(spec);

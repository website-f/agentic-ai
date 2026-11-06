import { arishaMayConsult, arishaMayReadContext, arishaMayPrepareFinance, arishaRecordKindsFor, type ArishaPilotUser } from './arisha-policy';
import type { ArishaContextSummary } from './arisha-context';
import { RECORD_KINDS, checkRecordValues, type RecordKind, type RecordValues } from './records';

/** Scoped read-only summaries and local draft proposals, shared by demo and server. */

export interface ArishaTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** A local record proposal. Human submission/review is separate; company drafts retain the CEO-only path. */
export interface ArishaDraft {
  kind: RecordKind;
  companyId: string | null;
  values: RecordValues;
  summary: string;
}

/** Local proposal only. label is for the human card, never model context. */
export interface ArishaFinanceDraft {
  companyId: string;
  pack: 'audit' | 'tax';
  itemId: string;
  status: 'prepared';
  label: string;
}

export interface ArishaAnswer {
  text: string;
  drafts: ArishaDraft[];
  financeDrafts: ArishaFinanceDraft[];
  summaryEvidence: ArishaContextSummary[];
}

export interface ArishaToolSpec {
  name: 'record_form' | 'prepare_record' | 'executive_summary' | 'finance_papers' | 'prepare_finance_paper' | 'task_guide';
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required: string[] };
}

export const ARISHA_TOOLS: ArishaToolSpec[] = [
  {
    name: 'task_guide',
    description:
      'Read only. Returns the in-app guide cards this person may use (BM and English), the same versioned cards as the Guide tab: who does the task, which screen, the fields and rules, what is entered once and reused, and what is not verified or switched off. Explain from these cards only; never claim a task, screen or connection the cards do not show.',
    inputSchema: { type: 'object', properties: { cardId: { type: 'string' } }, required: [] },
  },
  {
    name: 'record_form',
    description:
      'Returns the fields of one record form (key, label, type, required, choices). For a per-company record without companyId it returns the companies to choose from (id and name). Call before preparing a record.',
    inputSchema: { type: 'object', properties: { kind: { type: 'string' }, companyId: { type: 'string' } }, required: ['kind'] },
  },
  {
    name: 'prepare_record',
    description:
      'Prepares a new site, post, checkpoint or IT domain proposal within the authenticated leader’s scope. CEO only: company master preparation updates a permitted existing company and always stays draft/unverified; the CEO must explicitly save and separately verify source documents. No HR, arms, payment or approval fields. values maps allowed field keys to values. The human must submit it for an authorized human to review and save using existing authority; this tool never persists or saves.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string' }, companyId: { type: 'string' }, values: { type: 'object' }, summary: { type: 'string' } },
      required: ['kind', 'values', 'summary'],
    },
  },
  {
    name: 'executive_summary',
    description: 'Read bounded numeric metrics for a permitted context and current company grants. Returns observedAt, coverage limitations, warnings and exact source reference IDs. Source update time may be unknown. This is not runtime monitoring or complete organizational certification. Cite only returned source IDs and explicitly state missing coverage.',
    inputSchema: { type: 'object', properties: { context: { type: 'string', enum: ['operations', 'compliance', 'finance-papers'] }, companyId: { type: 'string' } }, required: ['context'] },
  },
  {
    name: 'finance_papers',
    description: 'Read permitted company IDs, or existing finance paper IDs, packs and statuses for one permitted company. No labels, balances, bank details or free-text records are sent to the model. A paper must still be todo before preparation can be proposed.',
    inputSchema: { type: 'object', properties: { companyId: { type: 'string' } }, required: [] },
  },
  {
    name: 'prepare_finance_paper',
    description: 'Prepare a LOCAL proposal to mark one existing audit/tax paper as prepared. Call finance_papers for current IDs first. Never persists, pays, approves, reviews or sends a paper. A human must explicitly submit, review and save using existing authority. No other status or action is allowed.',
    inputSchema: { type: 'object', properties: { companyId: { type: 'string' }, pack: { type: 'string', enum: ['audit', 'tax'] }, itemId: { type: 'string' } }, required: ['companyId', 'pack', 'itemId'] },
  },
];

/**
 * Advertised tools are scoped too; every execution still rechecks authorization in the service.
 * P80: everyone who may consult Arisha gets the read-only guide (task_guide: their own cards); summaries, record and
 * finance preparation stay with the leaders arisha-policy names.
 */
export function arishaToolsFor(user: ArishaPilotUser): ArishaToolSpec[] {
  if (!arishaMayConsult(user)) return [];
  const contexts = ['operations', 'compliance', 'finance-papers'].filter((context) => arishaMayReadContext(user, context));
  return ARISHA_TOOLS.filter((tool) =>
    (tool.name === 'executive_summary' && contexts.length > 0) ||
    tool.name === 'task_guide' ||
    ((tool.name === 'record_form' || tool.name === 'prepare_record') && arishaRecordKindsFor(user).length > 0) ||
    ((tool.name === 'finance_papers' || tool.name === 'prepare_finance_paper') && arishaMayPrepareFinance(user))
  ).map((tool) => tool.name === 'executive_summary' ? { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, context: { type: 'string', enum: contexts } } } } : tool);
}

/** The record forms Arisha can fill, one line each, for her brief. */
export const ARISHA_KIND_LIST = Object.values(RECORD_KINDS)
  .map((k) => `${k.kind}: ${k.label}${k.companyScoped ? ' (per company)' : ''}`)
  .join('\n');

/** The kind Arisha named, or an error she can read. */
export function arishaKind(v: unknown): RecordKind {
  const kind = String(v ?? '') as RecordKind;
  if (!RECORD_KINDS[kind]) throw new Error(`No form called ${kind}.`);
  return kind;
}

/** What record_form returns to Arisha, from the form the service built for this user. */
export function arishaFormView(f: {
  companyId: string | null;
  chooseCompany: [string, string][] | null;
  spec: { fields: { key: string; label: string; type: string; required?: boolean; help?: string; options?: [string, string][] }[] };
  options: Record<string, [string, string][]>;
}) {
  if (f.chooseCompany) return { chooseCompany: f.chooseCompany.map(([id, name]) => ({ id, name })) };
  return {
    companyId: f.companyId,
    fields: f.spec.fields.map((x) => ({
      key: x.key,
      label: x.label,
      type: x.type,
      required: !!x.required,
      help: x.help,
      choices: (x.type === 'select' ? x.options : x.type === 'ref' ? f.options[x.key] : undefined)?.slice(0, 60).map(([value, label]) => ({ value, label })),
    })),
  };
}

/** prepare_record: checks the values against the form's rules; throws the problems for Arisha to fix. */
export function arishaPrepare(input: Record<string, unknown>): ArishaDraft {
  const kind = arishaKind(input.kind);
  const spec = RECORD_KINDS[kind];
  const companyId = input.companyId ? String(input.companyId).slice(0, 60) : null;
  if (spec.companyScoped && !companyId) throw new Error('Choose the company first (record_form lists them).');
  const raw = input.values && typeof input.values === 'object' ? (input.values as RecordValues) : {};
  const { values, problems } = checkRecordValues(spec, raw, true);
  if (problems.length) throw new Error(problems.join(' '));
  return { kind, companyId, values, summary: String(input.summary ?? spec.label).slice(0, 200) };
}


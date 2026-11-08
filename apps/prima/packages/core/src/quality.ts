import { AccessDenied } from "./access";
import { GROUP_EMPLOYER_ID } from "./access";
import { isGroupLeader } from "./access";
import { isHrDirector } from "./access";
import { visibleCompanyIds } from "./access";
import { starterProfiles } from "./quality-seed";
import { starterRequirements } from "./quality-seed";
import { CREDENTIAL_LABEL } from "./rules";
import { RULES } from "./rules";
import { BadRequest } from "./service";
import { NotFound } from "./service";
import type { Store } from "./store";
import { addDays } from "./time";
import { daysBetween } from "./time";
import type { ActFinding } from "./types";
import type { CredentialType } from "./types";
import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import type { Person } from "./types";
import type { PersonRole } from "./types";
import type { User } from "./types";



// ---------- Records ----------

export type QmsStandardCode = 'ISO9001' | 'PIKM';

/** Prima data that can speak to a requirement on its own, shown to ACT as a hint (never as checked evidence). */
export type QmsSignal = 'competency' | 'act_findings' | 'licences' | 'foundation' | 'none';

export interface QmsNote {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

/** One requirement of one standard and edition. Group-wide: the same list applies to every company unless ACT says not. */
export interface QmsRequirement {
  id: Id;
  standard: QmsStandardCode;
  edition: string;
  /** The clause or section reference in the standard, as printed there. */
  ref: string;
  /** Our own short summary of what is needed. The standard's own wording is not copied. */
  title: string;
  /** True until the real text of the standard has been read and this row checked against it (PIKM rows today). */
  placeholder: boolean;
  /** Who in the company answers for it, by job title (not a person). */
  ownerTitle: string;
  /** The Prima screen or workflow that produces the evidence. */
  workflow: string;
  /** ACT audit area a gap is raised under (rule ACT-PLAN). */
  actArea: string;
  signal: QmsSignal;
  retired: boolean;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { title: string; ref: string; placeholder: boolean; by: string; at: IsoDateTime; note: string }[];
}

export type QmsEvidenceKind = 'prima_record' | 'document' | 'observation' | 'prima_signal';

export interface QmsEvidence {
  id: Id;
  kind: QmsEvidenceKind;
  /** What it is, in plain words ("CSG certificates for all Sasa guards, Credentials screen"). */
  label: string;
  /** Record number, document reference or link. A saved link is not proof the content was checked. */
  ref: string;
  linkedBy: string;
  linkedById: Id;
  at: IsoDateTime;
  check: (QmsNote & { ok: boolean }) | null;
}

/** One requirement for one company: applicability, the evidence linked, gaps and reviews. Created on first use. */
export interface QmsEntry {
  /** `${requirementId}--${companyId}` */
  id: Id;
  companyId: Id;
  requirementId: Id;
  /** false only when ACT decided, with a reason, that the requirement does not apply to this company. */
  applies: boolean;
  appliesNote: QmsNote | null;
  evidence: QmsEvidence[];
  /** Gaps raised as ACT findings; the finding's own steps carry the fix and the check. */
  gaps: (QmsNote & { findingId: Id; findingRef: string })[];
  reviews: QmsNote[];
}

export type CompItemKind = 'credential' | 'training' | 'skill';

export interface CompItem {
  id: Id;
  label: string;
  kind: CompItemKind;
  /** For a credential: any of these on file and in date meets it (e.g. KDN card or vetting submitted). */
  credentialTypes?: CredentialType[];
  /** Months until a skill or training must be assessed again; null means once is enough. */
  refreshMonths: number | null;
}

/** What one role needs. Group-wide; a new version takes effect once the HR Director approves it. */
export interface CompProfile {
  id: Id;
  role: PersonRole;
  name: string;
  version: number;
  items: CompItem[];
  status: 'proposed' | 'approved' | 'replaced' | 'not_agreed';
  proposed: QmsNote;
  decision: (QmsNote & { agree: boolean }) | null;
}

export type CompMethod = 'observation' | 'practical' | 'written' | 'interview' | 'certificate';

/** One assessment of one person on one item. */
export interface CompAssessment {
  id: Id;
  companyId: Id;
  personId: Id;
  itemId: Id;
  profileVersion: number;
  result: 'competent' | 'not_yet';
  method: CompMethod;
  note: string;
  evidenceRef: string;
  assessedOn: IsoDate;
  /** When competent and the item has a refresher; null otherwise. */
  nextDueOn: IsoDate | null;
  /** Set when this assessment follows a course: it is then also the check that the training worked. */
  afterTraining: string | null;
  assessor: string;
  assessorId: Id;
  at: IsoDateTime;
}

// ----- QMS foundation (ISO 9001 clauses 4 and 5): scope, quality policy, issues, interested parties, process map -----

export type QmsFoundationKind = 'scope' | 'policy' | 'issue' | 'party' | 'process';

/**
 * One item of the group's quality system foundation. The scope and quality policy are top-management decisions, so a
 * new version is drafted (ACT or the Chief of Staff) and the CEO agrees or sends it back with a reason. Issues,
 * interested parties and processes are working lists: kept up to date by ACT or the Chief of Staff, no approval, and
 * looked at again on their review date (and in management review).
 */
export interface QmsFoundationItem {
  id: Id;
  kind: QmsFoundationKind;
  title: string;
  /** Scope or policy text; for an issue, what it is and its effect; for a process, what it does. */
  body: string;
  /** Issue: inside or outside the business. */
  side?: 'internal' | 'external';
  /** Interested party: what they need from us, and how we keep track of it. */
  needs?: string;
  monitor?: string;
  /** Process: owner by job title, what goes in and out, how it is measured, its main risks, the requirements it serves. */
  ownerTitle?: string;
  inputs?: string;
  outputs?: string;
  measures?: string;
  risks?: string;
  requirementIds?: Id[];
  /** Scope and policy are versioned; the other kinds stay at 1 and keep a history of edits. */
  version: number;
  status: 'draft' | 'approved' | 'replaced' | 'not_agreed' | 'active' | 'retired';
  decision: (QmsNote & { agree: boolean }) | null;
  reviewEveryMonths: number;
  lastReviewedOn: IsoDate;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: QmsNote[];
}

export const QMS_FOUNDATION_LABEL: Record<QmsFoundationKind, string> = {
  scope: 'Scope of the quality system',
  policy: 'Quality policy',
  issue: 'Internal and external issues',
  party: 'Interested parties',
  process: 'Process map',
};

/** Who keeps the foundation: ACT and the Chief of Staff or Deputy. The CEO decides scope and policy. */
export function foundationRole(user: User): 'keep' | 'ceo' | 'view' | null {
  if (user.integration) return null;
  if (user.role === 'director' || user.opsTier === 'ceo') return 'ceo';
  if ((user.role === 'pwvsb_officer' && user.department === 'audit') || isHrDirector(user)) return 'keep';
  if (isGroupLeader(user) || user.role === 'company_manager') return 'view';
  return null;
}

// ---------- Labels (English; the screen translates) ----------

export const QMS_EVIDENCE_LABEL: Record<QmsEvidenceKind, string> = {
  prima_record: 'Prima record',
  document: 'Document',
  observation: 'Seen on site or in a walk-through',
  prima_signal: 'Prima figures',
};
export const QMS_SIGNAL_LABEL: Record<QmsSignal, string> = {
  competency: 'Competency matrix',
  foundation: 'QMS foundation',
  act_findings: 'ACT findings',
  licences: 'Company licences',
  none: 'No Prima figures',
};
export const COMP_KIND_LABEL: Record<CompItemKind, string> = { credential: 'Licence or certificate', training: 'Training', skill: 'Skill' };
export const COMP_METHOD_LABEL: Record<CompMethod, string> = {
  observation: 'Watched doing the work',
  practical: 'Practical test',
  written: 'Written test',
  interview: 'Questions and answers',
  certificate: 'Certificate checked',
};
export const COMP_ROLE_LABEL: Record<PersonRole, string> = {
  guard: 'Guard',
  supervisor: 'Officer (stationed)',
  patrol_officer: 'Patrolling officer',
  office: 'Office staff',
};

export type QmsState = 'awaiting_text' | 'not_applicable' | 'gap' | 'unknown' | 'not_checked' | 'review_due' | 'checked';
export const QMS_STATE_LABEL: Record<QmsState, string> = {
  awaiting_text: 'Waiting for the code text',
  not_applicable: 'Does not apply',
  gap: 'Gap being fixed',
  unknown: 'Unknown: no evidence',
  not_checked: 'Evidence not checked yet',
  review_due: 'Review due',
  checked: 'Evidence checked',
};

export type CompState = 'met' | 'due_soon' | 'expired' | 'not_yet' | 'missing';
export const COMP_STATE_LABEL: Record<CompState, string> = {
  met: 'Met',
  due_soon: 'Due soon',
  expired: 'Expired or refresher overdue',
  not_yet: 'Not yet competent',
  missing: 'Not assessed',
};

// ---------- Pure helpers ----------

const MONTH_DAYS = 30.44;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const oneOf = <T extends string>(v: unknown, labels: Record<T, string>): T | null =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(labels, v) ? (v as T) : null;
const entryId = (requirementId: Id, companyId: Id) => `${requirementId}--${companyId}`;
const stamp = (at: IsoDateTime) => `${Date.parse(at).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** The state of one requirement for one company. Never "compliant": the best is "evidence checked", by a person. */
export function qmsState(req: QmsRequirement, entry: QmsEntry | undefined, findings: Pick<ActFinding, 'id' | 'status'>[], today: IsoDate): { state: QmsState; reviewDueOn: IsoDate | null } {
  if (entry && !entry.applies) return { state: 'not_applicable', reviewDueOn: null };
  const openGap = entry?.gaps.some((g) => findings.find((f) => f.id === g.findingId)?.status !== 'closed') ?? false;
  const checked = (entry?.evidence ?? []).filter((e) => e.check?.ok);
  const lastCheck = [...checked.map((e) => e.check!.at.slice(0, 10)), ...(entry?.reviews ?? []).map((r) => r.at.slice(0, 10))].sort().pop() ?? null;
  const reviewDueOn = lastCheck ? addDays(lastCheck, Math.round(RULES.quality.value.reviewEveryMonths * MONTH_DAYS)) : null;
  if (req.placeholder) return { state: 'awaiting_text', reviewDueOn };
  if (openGap) return { state: 'gap', reviewDueOn };
  const live = (entry?.evidence ?? []).filter((e) => !e.check || e.check.ok);
  if (!live.length) return { state: 'unknown', reviewDueOn };
  if (!checked.length) return { state: 'not_checked', reviewDueOn };
  if (reviewDueOn && reviewDueOn < today) return { state: 'review_due', reviewDueOn };
  return { state: 'checked', reviewDueOn };
}

/** One person's standing on one competency item. Credentials come from HR's existing records. */
export function compItemState(
  item: CompItem,
  person: Pick<Person, 'id'>,
  credentials: { personId: Id; type: CredentialType; expiresOn: IsoDate | null; number: string }[],
  assessments: CompAssessment[],
  today: IsoDate,
): { state: CompState; dueOn: IsoDate | null; detail: string } {
  const soon = RULES.quality.value.dueSoonDays;
  if (item.kind === 'credential') {
    const mine = credentials.filter((c) => c.personId === person.id && (item.credentialTypes ?? []).includes(c.type));
    if (!mine.length) return { state: 'missing', dueOn: null, detail: 'Not on file' };
    const best = [...mine].sort((a, b) => (b.expiresOn ?? '9999-12-31').localeCompare(a.expiresOn ?? '9999-12-31'))[0];
    if (best.expiresOn && best.expiresOn < today) return { state: 'expired', dueOn: best.expiresOn, detail: `${CREDENTIAL_LABEL[best.type]} expired` };
    if (best.expiresOn && daysBetween(today, best.expiresOn) <= soon) return { state: 'due_soon', dueOn: best.expiresOn, detail: `${CREDENTIAL_LABEL[best.type]} expires soon` };
    return { state: 'met', dueOn: best.expiresOn, detail: CREDENTIAL_LABEL[best.type] };
  }
  const last = assessments
    .filter((a) => a.personId === person.id && a.itemId === item.id)
    .sort((a, b) => b.assessedOn.localeCompare(a.assessedOn) || b.at.localeCompare(a.at))[0];
  if (!last) return { state: 'missing', dueOn: null, detail: 'Not assessed' };
  if (last.result === 'not_yet') return { state: 'not_yet', dueOn: null, detail: `Assessed ${last.assessedOn} by ${last.assessor}` };
  if (last.nextDueOn && last.nextDueOn < today) return { state: 'expired', dueOn: last.nextDueOn, detail: 'Refresher overdue' };
  if (last.nextDueOn && daysBetween(today, last.nextDueOn) <= soon) return { state: 'due_soon', dueOn: last.nextDueOn, detail: 'Refresher due soon' };
  return { state: 'met', dueOn: last.nextDueOn, detail: `Assessed ${last.assessedOn} by ${last.assessor}` };
}

// ---------- Who does what ----------

export type QmsRole = 'act' | 'company' | 'view';

/** Register: ACT keeps it; the company manager links evidence for their own company; group leaders watch. */
export function qmsRoleOf(user: User): QmsRole | null {
  if (user.integration) return null;
  if (user.role === 'pwvsb_officer' && user.department === 'audit') return 'act';
  if (user.role === 'company_manager') return 'company';
  if (isGroupLeader(user)) return 'view';
  return null;
}

export type CompRole = 'hr' | 'assess' | 'view';

/** Matrix: HR keeps the role profiles; managers and officers assess; leaders and ACT watch. Guards never see it. */
export function compRoleOf(user: User): CompRole | null {
  if (user.integration || user.role === 'guard' || user.role === 'site_device') return null;
  if (user.role === 'pwvsb_officer' && user.department === 'hr') return 'hr';
  if (isHrDirector(user)) return 'hr';
  if (user.role === 'company_manager' || user.role === 'supervisor') return 'assess';
  if (user.role === 'pwvsb_officer' && user.department === 'operations') return 'assess';
  if (user.role === 'admin_exec') return 'view';
  if (isGroupLeader(user) || (user.role === 'pwvsb_officer' && user.department === 'audit')) return 'view';
  return null;
}

/** May this person assess this staff member? Never themselves; each assessor only the people their job covers. */
export function mayAssess(user: User, person: Pick<Person, 'id' | 'companyId' | 'role'>, companies: Id[]): boolean {
  if (user.personId && user.personId === person.id) return false;
  if (!companies.includes(person.companyId)) return false;
  if (user.role === 'company_manager') return user.companyIds.includes(person.companyId);
  if (user.role === 'supervisor') return user.companyIds.includes(person.companyId) && person.role === 'guard';
  if (user.role === 'pwvsb_officer' && user.department === 'operations') return person.role !== 'office';
  if (user.role === 'pwvsb_officer' && user.department === 'hr') return person.role === 'office';
  return false;
}

// ---------- Service ----------

type RaiseFinding = (
  user: User,
  input: { companyId: Id | null; area: string; source: ActFinding['source']; title: string; detail: string; severity: ActFinding['severity']; evidence: string; ownerUserId: Id; origin?: 'quality' },
) => Promise<ActFinding>;

export class QualityService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private raiseFinding: RaiseFinding,
  ) {}

  private today(): IsoDate {
    return this.clock().slice(0, 10);
  }
  private who(user: User) {
    return { by: user.name, byId: user.id, at: this.clock() };
  }
  private reason(v: unknown, what = 'Say why') {
    const n = text(v, 400);
    if (n.length < 3) throw new BadRequest(`${what}: give a short reason.`);
    return n;
  }
  private async mustBeReady() {
    if (this.store.qualityReady && !(await this.store.qualityReady()))
      throw new BadRequest('Quality and compliance is not switched on yet. The database part waits for the CEO to approve it.');
  }

  /** Companies this person works with here. A company manager sees their own; PWVSB staff their granted companies. */
  async companiesFor(user: User): Promise<Id[]> {
    if (user.role === 'company_manager' || user.role === 'admin_exec' || user.role === 'supervisor') return user.companyIds;
    if (user.role !== 'director' && user.role !== 'pwvsb_officer') return [];
    return visibleCompanyIds(user, await this.store.list('grants', {}), this.today());
  }

  // ----- Register -----

  /** The register for the companies this person may see; one company opened in detail. */
  async register(user: User, opts: { companyId?: Id; standard?: QmsStandardCode } = {}) {
    const role = qmsRoleOf(user);
    if (!role) throw new AccessDenied('view', '(quality and compliance register)');
    await this.mustBeReady();
    const today = this.today();
    const allowed = role === 'act' ? [...new Set([...(await this.companiesFor(user)), GROUP_EMPLOYER_ID])] : await this.companiesFor(user);
    if (!allowed.length) throw new AccessDenied('view', '(quality and compliance register)');
    const [reqsAll, entries, findings, companies] = await Promise.all([
      this.store.list('qmsRequirements', {}),
      this.store.list('qmsEntries', { companyId: allowed }),
      this.store.list('actFindings', {}),
      this.store.list('companies', { id: allowed }),
    ]);
    const name = (id: Id) => (id === GROUP_EMPLOYER_ID ? 'PWVSB (group)' : (companies.find((c) => c.id === id)?.name ?? id));
    const reqs = reqsAll.filter((r) => !r.retired && (!opts.standard || r.standard === opts.standard)).sort((a, b) => a.standard.localeCompare(b.standard) || refOrder(a.ref, b.ref));
    const companyId = opts.companyId && allowed.includes(opts.companyId) ? opts.companyId : allowed.filter((id) => id !== GROUP_EMPLOYER_ID)[0] ?? allowed[0];

    const summary = allowed.map((cid) => {
      const counts: Record<QmsState, number> = { awaiting_text: 0, not_applicable: 0, gap: 0, unknown: 0, not_checked: 0, review_due: 0, checked: 0 };
      for (const r of reqs) counts[qmsState(r, entries.find((e) => e.id === entryId(r.id, cid)), findings, today).state]++;
      return { companyId: cid, companyName: name(cid), counts };
    });

    const signals = await this.signals(companyId);
    const rows = reqs.map((r) => {
      const entry = entries.find((e) => e.id === entryId(r.id, companyId));
      const { state, reviewDueOn } = qmsState(r, entry, findings, today);
      return {
        requirement: r,
        entry: entry ?? null,
        state,
        reviewDueOn,
        signal: r.signal === 'none' ? null : signals[r.signal],
        gaps: (entry?.gaps ?? []).map((g) => ({ ...g, status: findings.find((f) => f.id === g.findingId)?.status ?? 'open' })),
        canLink: role === 'act' || (role === 'company' && user.companyIds.includes(companyId)),
        // Only ACT checks, and never evidence they linked themselves.
        checkable: role === 'act' ? (entry?.evidence ?? []).filter((e) => !e.check && e.linkedById !== user.id).map((e) => e.id) : [],
        canDecide: role === 'act',
      };
    });
    const owners =
      role === 'act'
        ? (await this.store.list('users', {}))
            .filter((u) => !u.integration && u.department !== 'audit' && (u.role === 'company_manager' ? u.companyIds.includes(companyId) : u.role === 'pwvsb_officer' || u.role === 'director'))
            .map((u) => ({ id: u.id, name: u.name, title: u.title }))
            .slice(0, 80)
        : [];
    return {
      role,
      rule: RULES.quality.value,
      standards: RULES.quality.value.standards,
      actAreas: RULES.act.value.areas.map((a) => ({ id: a.id, name: a.name })),
      companies: allowed.map((id) => ({ id, name: name(id) })),
      companyId,
      companyName: name(companyId),
      summary,
      rows,
      owners,
      kpis: {
        unknown: rows.filter((r) => r.state === 'unknown').length,
        toCheck: rows.reduce((n, r) => n + r.checkable.length, 0),
        gaps: rows.filter((r) => r.state === 'gap').length,
        reviewDue: rows.filter((r) => r.state === 'review_due').length,
        checked: rows.filter((r) => r.state === 'checked').length,
        awaitingText: rows.filter((r) => r.state === 'awaiting_text').length,
      },
    };
  }

  /** Figures Prima already has for a company, shown next to a requirement. A hint for ACT, never checked evidence. */
  private async signals(companyId: Id): Promise<Record<Exclude<QmsSignal, 'none'>, string>> {
    const today = this.today();
    const [findings, licences, foundation] = await Promise.all([this.store.list('actFindings', { companyId }), this.store.list('licences', { companyId }), this.store.list('qmsFoundation', {})]);
    const open = findings.filter((f) => f.status !== 'closed');
    const late = open.filter((f) => f.dueOn < today).length;
    const lic = licences.filter((l) => !l.expiresOn || l.expiresOn < today).length;
    let comp = 'No staff on record';
    if (companyId !== GROUP_EMPLOYER_ID) {
      const m = await this.matrixFor(companyId);
      comp = `${m.people.length - m.people.filter((p) => p.gaps).length} of ${m.people.length} staff meet every item for their role; ${m.people.filter((p) => p.gaps).length} have gaps`;
    }
    return {
      competency: comp,
      act_findings: `${open.length} ACT finding${open.length === 1 ? '' : 's'} open, ${late} overdue`,
      licences: `${licences.length} licence${licences.length === 1 ? '' : 's'} on file, ${lic} expired or with no date`,
      foundation: foundationSummary(foundation, today),
    };
  }

  private async entryFor(tx: Store, user: User, requirementId: Id, companyId: Id, mode: 'link' | 'act') {
    const role = qmsRoleOf(user);
    if (mode === 'act' && role !== 'act') throw new AccessDenied('view', '(ACT checks evidence and decides gaps)');
    if (mode === 'link' && !(role === 'act' || (role === 'company' && user.companyIds.includes(companyId))))
      throw new AccessDenied('view', '(the company manager links evidence for their own company)');
    const allowed = role === 'act' ? [...(await this.companiesFor(user)), GROUP_EMPLOYER_ID] : await this.companiesFor(user);
    if (!allowed.includes(companyId)) throw new AccessDenied('view', companyId);
    const req = await tx.get('qmsRequirements', requirementId);
    if (!req || req.retired) throw new NotFound('Requirement');
    const id = entryId(requirementId, companyId);
    await tx.lock?.('qmsEntries', id);
    let entry = await tx.get('qmsEntries', id);
    if (!entry) {
      entry = { id, companyId, requirementId, applies: true, appliesNote: null, evidence: [], gaps: [], reviews: [] };
      await tx.insert('qmsEntries', entry);
    }
    return { req, entry };
  }

  /** One entry point for the screen and the API; every action checks the person again here. */
  async act(user: User, action: string, b: Record<string, unknown>) {
    await this.mustBeReady();
    switch (action) {
      case 'addRequirement':
        return this.saveRequirement(user, null, b);
      case 'editRequirement':
        return this.saveRequirement(user, text(b.id, 160), b);
      case 'linkEvidence':
        return this.linkEvidence(user, b);
      case 'checkEvidence':
        return this.checkEvidence(user, b);
      case 'setApplies':
        return this.setApplies(user, b);
      case 'raiseGap':
        return this.raiseGap(user, b);
      case 'review':
        return this.review(user, b);
      case 'proposeProfile':
        return this.proposeProfile(user, b);
      case 'decideProfile':
        return this.decideProfile(user, text(b.id, 160), b.agree === true, b.note);
      case 'assess':
        return this.assess(user, b);
      case 'loadStarter':
        return this.loadStarter(user);
      case 'saveFoundation':
        return this.saveFoundation(user, b);
      case 'decideFoundation':
        return this.decideFoundation(user, text(b.id, 160), b.agree === true, b.note);
      case 'reviewFoundation':
        return this.reviewFoundation(user, text(b.id, 160), b);
      default:
        throw new BadRequest('Unknown action.');
    }
  }

  /**
   * A fresh install starts empty. ACT loads the starter requirement list (ISO headings, PIKM placeholders) and HR the
   * starter role profiles, which arrive as proposals for the HR Director. Rows already there are left alone.
   */
  private async loadStarter(user: User) {
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      if (qmsRoleOf(user) === 'act') {
        const have = new Set((await tx.list('qmsRequirements', {})).map((r) => r.id));
        const add = starterRequirements({ by: w.by, byId: w.byId }, w.at).filter((r) => !have.has(r.id));
        for (const r of add) await tx.insert('qmsRequirements', r);
        await tx.audit({ at: w.at, actor: w.by, companyId: null, action: 'quality.requirement.starter', entity: 'qms_requirement', entityId: 'starter', summary: `Starter requirement list loaded: ${add.length} added.` });
        return { added: add.length };
      }
      if (user.role === 'pwvsb_officer' && user.department === 'hr') {
        const have = await tx.list('compProfiles', {});
        const add = starterProfiles(w).filter((p) => !have.some((h) => h.role === p.role));
        for (const p of add) await tx.insert('compProfiles', p);
        await tx.audit({ at: w.at, actor: w.by, companyId: null, action: 'quality.profile.starter', entity: 'comp_profile', entityId: 'starter', summary: `Starter role profiles proposed: ${add.length}.` });
        return { added: add.length };
      }
      throw new AccessDenied('view', '(ACT loads requirements; HR loads role profiles)');
    });
  }

  private async saveRequirement(user: User, id: Id | null, b: Record<string, unknown>) {
    if (qmsRoleOf(user) !== 'act') throw new AccessDenied('view', '(ACT keeps the requirements list)');
    const w = this.who(user);
    const title = text(b.title, 300);
    const ref = text(b.ref, 40);
    const note = text(b.note, 300);
    if (!title || !ref) throw new BadRequest('Give the clause reference and a short summary of what is needed.');
    return this.store.transaction(async (tx) => {
      if (id) {
        await tx.lock?.('qmsRequirements', id);
        const r = await tx.get('qmsRequirements', id);
        if (!r) throw new NotFound('Requirement');
        const retire = b.retire === true;
        // Leaving placeholder status means someone read the real text: say where.
        const placeholder = b.placeholder === false ? false : r.placeholder;
        if (r.placeholder && !placeholder && note.length < 3) throw new BadRequest('Say which page or section of the code text you checked this against.');
        if (retire && note.length < 3) throw new BadRequest('Say why this requirement is retired.');
        const patch: Partial<QmsRequirement> = {
          title,
          ref,
          placeholder,
          ownerTitle: text(b.ownerTitle, 120) || r.ownerTitle,
          workflow: text(b.workflow, 160) || r.workflow,
          retired: retire,
          history: [...r.history, { title: r.title, ref: r.ref, placeholder: r.placeholder, by: w.by, at: w.at, note: note || 'Updated' }],
        };
        await tx.update('qmsRequirements', id, patch);
        await tx.audit({ at: w.at, actor: w.by, companyId: null, action: retire ? 'quality.requirement.retire' : 'quality.requirement.edit', entity: 'qms_requirement', entityId: id, summary: `${r.standard} ${ref}: ${title}${retire ? ' (retired)' : ''}.` });
        return (await tx.get('qmsRequirements', id))!;
      }
      const std = RULES.quality.value.standards.find((s) => s.code === b.standard);
      if (!std) throw new BadRequest('Choose the standard.');
      const area = RULES.act.value.areas.find((a) => a.id === b.actArea)?.id ?? 'CORPORATE';
      const r: QmsRequirement = {
        id: `qr-${std.code.toLowerCase()}-${stamp(w.at)}`,
        standard: std.code as QmsStandardCode,
        edition: std.edition,
        ref,
        title,
        // A PIKM row stays a placeholder until the code text is read; ISO rows are our own summaries of the headings.
        placeholder: std.code === 'PIKM' ? b.placeholder !== false || note.length < 3 : false,
        ownerTitle: text(b.ownerTitle, 120) || 'Company Manager',
        workflow: text(b.workflow, 160) || '',
        actArea: area,
        signal: oneOf(b.signal, QMS_SIGNAL_LABEL) ?? 'none',
        retired: false,
        by: w.by,
        byId: w.byId,
        at: w.at,
        history: [],
      };
      await tx.insert('qmsRequirements', r);
      await tx.audit({ at: w.at, actor: w.by, companyId: null, action: 'quality.requirement.add', entity: 'qms_requirement', entityId: r.id, summary: `${r.standard} ${r.ref}: ${r.title}.` });
      return r;
    });
  }

  private async linkEvidence(user: User, b: Record<string, unknown>) {
    const kind = oneOf(b.kind, QMS_EVIDENCE_LABEL);
    if (!kind) throw new BadRequest('Choose what kind of evidence it is.');
    const companyId = text(b.companyId, 80);
    const requirementId = text(b.requirementId, 160);
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      const { req, entry } = await this.entryFor(tx, user, requirementId, companyId, 'link');
      let label = text(b.label, 200);
      let ref = text(b.ref, 300);
      if (kind === 'prima_signal') {
        // The figures are filled by the server at this moment, never typed.
        if (req.signal === 'none') throw new BadRequest('Prima has no figures for this requirement. Link a record or document instead.');
        label = `${QMS_SIGNAL_LABEL[req.signal]} on ${this.today()}: ${(await this.signals(companyId))[req.signal]}`;
        ref = `prima:${req.signal}:${companyId}:${this.today()}`;
      }
      if (label.length < 3) throw new BadRequest('Say what the evidence is.');
      if (kind !== 'observation' && ref.length < 2) throw new BadRequest('Give the record number, document reference or link.');
      if (entry.evidence.filter((e) => !e.check || e.check.ok).length >= 20) throw new BadRequest('Twenty pieces of evidence are linked already. Remove old ones by having ACT reject them.');
      const ev: QmsEvidence = { id: `qe-${stamp(w.at)}`, kind, label, ref, linkedBy: w.by, linkedById: w.byId, at: w.at, check: null };
      await tx.update('qmsEntries', entry.id, { evidence: [...entry.evidence, ev] });
      await tx.audit({ at: w.at, actor: w.by, companyId, action: 'quality.evidence.link', entity: 'qms_entry', entityId: entry.id, summary: `${req.standard} ${req.ref}: ${QMS_EVIDENCE_LABEL[kind]} linked (${label}).` });
      return (await tx.get('qmsEntries', entry.id))!;
    });
  }

  private async checkEvidence(user: User, b: Record<string, unknown>) {
    const ok = b.ok === true;
    const note = this.reason(b.note, ok ? 'Say what you checked' : 'Say what is wrong with it');
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      const { req, entry } = await this.entryFor(tx, user, text(b.requirementId, 160), text(b.companyId, 80), 'act');
      if (req.placeholder && ok) throw new BadRequest('This requirement is still a placeholder. Check it against the code text first, then the evidence.');
      const ev = entry.evidence.find((e) => e.id === b.evidenceId);
      if (!ev) throw new NotFound('Evidence');
      if (ev.check) throw new BadRequest('This evidence has been checked already.');
      if (ev.linkedById === user.id) throw new BadRequest('You linked this evidence. Another ACT member checks it.');
      await tx.update('qmsEntries', entry.id, { evidence: entry.evidence.map((e) => (e.id === ev.id ? { ...e, check: { ...w, note, ok } } : e)) });
      await tx.audit({ at: w.at, actor: w.by, companyId: entry.companyId, action: ok ? 'quality.evidence.ok' : 'quality.evidence.reject', entity: 'qms_entry', entityId: entry.id, summary: `${req.standard} ${req.ref}: evidence "${ev.label}" ${ok ? 'checked' : 'not accepted'} (${note}).` });
      return (await tx.get('qmsEntries', entry.id))!;
    });
  }

  private async setApplies(user: User, b: Record<string, unknown>) {
    const applies = b.applies === true;
    const note = this.reason(b.note, applies ? 'Say why it applies again' : 'Say why it does not apply');
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      const { req, entry } = await this.entryFor(tx, user, text(b.requirementId, 160), text(b.companyId, 80), 'act');
      await tx.update('qmsEntries', entry.id, { applies, appliesNote: { ...w, note } });
      await tx.audit({ at: w.at, actor: w.by, companyId: entry.companyId, action: 'quality.applies', entity: 'qms_entry', entityId: entry.id, summary: `${req.standard} ${req.ref}: ${applies ? 'applies' : 'does not apply'} (${note}).` });
      return (await tx.get('qmsEntries', entry.id))!;
    });
  }

  /** A gap becomes an ACT finding: the owner plans the fix, shows proof, ACT checks it and can reopen it. */
  private async raiseGap(user: User, b: Record<string, unknown>) {
    const requirementId = text(b.requirementId, 160);
    const companyId = text(b.companyId, 80);
    const note = this.reason(b.note, 'Say what is missing');
    const req = await this.store.get('qmsRequirements', requirementId);
    if (!req || req.retired) throw new NotFound('Requirement');
    if (qmsRoleOf(user) !== 'act') throw new AccessDenied('view', '(ACT records gaps)');
    const severity = (['high', 'medium', 'low'] as const).find((s) => s === b.severity) ?? 'medium';
    const finding = await this.raiseFinding(user, {
      companyId: companyId === GROUP_EMPLOYER_ID ? null : companyId,
      area: req.actArea,
      source: 'workflow_audit',
      title: `${req.standard === 'ISO9001' ? 'ISO 9001' : 'PIKM'} ${req.ref}: ${req.title}`.slice(0, 160),
      detail: note,
      severity,
      evidence: `Requirements register: ${note}`.slice(0, 500),
      ownerUserId: text(b.ownerUserId, 80),
      origin: 'quality',
    });
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      const { entry } = await this.entryFor(tx, user, requirementId, companyId, 'act');
      await tx.update('qmsEntries', entry.id, { gaps: [...entry.gaps, { ...w, note, findingId: finding.id, findingRef: finding.ref }] });
      await tx.audit({ at: w.at, actor: w.by, companyId: entry.companyId, action: 'quality.gap', entity: 'qms_entry', entityId: entry.id, summary: `${req.standard} ${req.ref}: gap raised as ${finding.ref} (${note}).` });
      return { entry: (await tx.get('qmsEntries', entry.id))!, finding };
    });
  }

  private async review(user: User, b: Record<string, unknown>) {
    const note = this.reason(b.note, 'Say what you looked at');
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      const { req, entry } = await this.entryFor(tx, user, text(b.requirementId, 160), text(b.companyId, 80), 'act');
      if (!entry.evidence.some((e) => e.check?.ok)) throw new BadRequest('Nothing checked to review yet. Check the evidence first.');
      await tx.update('qmsEntries', entry.id, { reviews: [...entry.reviews, { ...w, note }] });
      await tx.audit({ at: w.at, actor: w.by, companyId: entry.companyId, action: 'quality.review', entity: 'qms_entry', entityId: entry.id, summary: `${req.standard} ${req.ref}: reviewed (${note}).` });
      return (await tx.get('qmsEntries', entry.id))!;
    });
  }

  // ----- QMS foundation -----

  async foundation(user: User) {
    const role = foundationRole(user);
    if (!role) throw new AccessDenied('view', '(quality system foundation)');
    await this.mustBeReady();
    const today = this.today();
    const [items, reqs] = await Promise.all([this.store.list('qmsFoundation', {}), this.store.list('qmsRequirements', { retired: false })]);
    // Company managers see what is in force, not drafts.
    const shown = items.filter((i) => role !== 'view' || user.role !== 'company_manager' || i.status === 'approved' || i.status === 'active');
    const rows = shown
      .map((i) => {
        const dueOn = addDays(i.lastReviewedOn, Math.round(i.reviewEveryMonths * MONTH_DAYS));
        return {
          item: i,
          reviewDueOn: dueOn,
          reviewLate: (i.status === 'approved' || i.status === 'active') && dueOn < today,
          requirements: (i.requirementIds ?? []).map((id) => reqs.find((r) => r.id === id)).filter(Boolean).map((r) => ({ id: r!.id, label: `${r!.standard === 'ISO9001' ? 'ISO 9001' : 'PIKM'} ${r!.ref}` })),
          canEdit: role === 'keep' && (i.status === 'active' || i.status === 'approved' || (i.status === 'draft' && i.byId === user.id) || i.status === 'not_agreed'),
          canDecide: role === 'ceo' && i.status === 'draft' && i.byId !== user.id,
          canReview: role === 'keep' && (i.status === 'active' || i.status === 'approved'),
        };
      })
      .sort((a, b) => KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) || Number(b.reviewLate) - Number(a.reviewLate) || a.item.title.localeCompare(b.item.title));
    return {
      role,
      rows,
      requirements: role === 'keep' ? reqs.map((r) => ({ id: r.id, label: `${r.standard === 'ISO9001' ? 'ISO 9001' : 'PIKM'} ${r.ref}: ${r.title}`.slice(0, 120) })) : [],
      summary: foundationSummary(items, today),
      kpis: {
        scopeApproved: items.some((i) => i.kind === 'scope' && i.status === 'approved'),
        policyApproved: items.some((i) => i.kind === 'policy' && i.status === 'approved'),
        drafts: items.filter((i) => i.status === 'draft').length,
        processes: items.filter((i) => i.kind === 'process' && i.status === 'active').length,
        processesNoOwner: items.filter((i) => i.kind === 'process' && i.status === 'active' && !i.ownerTitle).length,
        reviewLate: rows.filter((r) => r.reviewLate).length,
      },
    };
  }

  private async saveFoundation(user: User, b: Record<string, unknown>) {
    if (foundationRole(user) !== 'keep') throw new AccessDenied('view', '(ACT or the Chief of Staff keeps the quality system foundation)');
    const kind = oneOf(b.kind, QMS_FOUNDATION_LABEL);
    if (!kind) throw new BadRequest('Choose what you are recording.');
    const title = text(b.title, 160);
    const body = text(b.body, 4000);
    if (title.length < 3) throw new BadRequest('Give it a title.');
    if ((kind === 'scope' || kind === 'policy') && body.length < 20) throw new BadRequest(`Write the ${kind === 'scope' ? 'scope' : 'policy'} text.`);
    if (kind === 'process' && !text(b.ownerTitle, 120)) throw new BadRequest('Name the process owner by job title.');
    if (kind === 'party' && !text(b.needs, 400)) throw new BadRequest('Say what this party needs from us.');
    const months = Math.round(Number(b.reviewEveryMonths ?? 12));
    if (!Number.isFinite(months) || months < 1 || months > 36) throw new BadRequest('Review every 1 to 36 months.');
    const reqs = await this.store.list('qmsRequirements', {});
    const requirementIds = (Array.isArray(b.requirementIds) ? b.requirementIds : []).filter((id): id is string => typeof id === 'string' && reqs.some((r) => r.id === id)).slice(0, 30);
    const fields = {
      title,
      body,
      ...(kind === 'issue' ? { side: b.side === 'internal' ? ('internal' as const) : ('external' as const) } : {}),
      ...(kind === 'party' ? { needs: text(b.needs, 400), monitor: text(b.monitor, 400) } : {}),
      ...(kind === 'process'
        ? { ownerTitle: text(b.ownerTitle, 120), inputs: text(b.inputs, 400), outputs: text(b.outputs, 400), measures: text(b.measures, 400), risks: text(b.risks, 400), requirementIds }
        : {}),
      reviewEveryMonths: months,
    };
    const w = this.who(user);
    const id = text(b.id, 160);
    return this.store.transaction(async (tx) => {
      const versioned = kind === 'scope' || kind === 'policy';
      if (id) {
        await tx.lock?.('qmsFoundation', id);
        const old = await tx.get('qmsFoundation', id);
        if (!old || old.kind !== kind) throw new NotFound('Item');
        if (old.status === 'retired' || old.status === 'replaced') throw new BadRequest('This item is no longer in use.');
        const note = text(b.note, 300) || 'Updated';
        if (versioned && old.status !== 'draft') {
          // A change to the scope or policy is a new draft version for the CEO; the one in force stays until then.
          const all = await tx.list('qmsFoundation', { kind });
          if (all.some((x) => x.status === 'draft')) throw new BadRequest('A new version is already waiting for the CEO.');
          const v = Math.max(...all.map((x) => x.version)) + 1;
          const draft: QmsFoundationItem = { ...old, ...fields, id: `qf-${kind}-v${v}`, version: v, status: 'draft', decision: null, lastReviewedOn: this.today(), by: w.by, byId: w.byId, at: w.at, history: [{ ...w, note }] };
          await tx.insert('qmsFoundation', draft);
          await tx.audit({ at: w.at, actor: w.by, companyId: null, action: 'quality.foundation.draft', entity: 'qms_foundation', entityId: draft.id, summary: `${QMS_FOUNDATION_LABEL[kind]} version ${v} drafted (${note}).` });
          return draft;
        }
        if (versioned && old.byId !== user.id) throw new BadRequest('Another person drafted this version. Ask them to change it, or wait for the CEO.');
        const retire = !versioned && b.retire === true;
        await tx.update('qmsFoundation', id, { ...fields, status: retire ? 'retired' : old.status === 'not_agreed' ? 'draft' : old.status, decision: old.status === 'not_agreed' ? null : old.decision, history: [...old.history, { ...w, note }] });
        await tx.audit({ at: w.at, actor: w.by, companyId: null, action: retire ? 'quality.foundation.retire' : 'quality.foundation.edit', entity: 'qms_foundation', entityId: id, summary: `${QMS_FOUNDATION_LABEL[kind]}: ${title}${retire ? ' retired' : ' updated'} (${note}).` });
        return (await tx.get('qmsFoundation', id))!;
      }
      let version = 1;
      if (versioned) {
        const all = await tx.list('qmsFoundation', { kind });
        if (all.some((x) => x.status === 'draft')) throw new BadRequest('A new version is already waiting for the CEO.');
        if (all.some((x) => x.status === 'approved')) throw new BadRequest('There is one in force already. Change it to draft a new version.');
        version = Math.max(0, ...all.map((x) => x.version)) + 1;
      }
      const item: QmsFoundationItem = {
        id: versioned ? `qf-${kind}-v${version}` : `qf-${kind}-${stamp(w.at)}`,
        kind,
        ...fields,
        version,
        status: versioned ? 'draft' : 'active',
        decision: null,
        lastReviewedOn: this.today(),
        by: w.by,
        byId: w.byId,
        at: w.at,
        history: [],
      };
      await tx.insert('qmsFoundation', item);
      await tx.audit({ at: w.at, actor: w.by, companyId: null, action: 'quality.foundation.add', entity: 'qms_foundation', entityId: item.id, summary: `${QMS_FOUNDATION_LABEL[kind]}: ${title}${versioned ? ` version ${version} drafted` : ''}.` });
      return item;
    });
  }

  /** Scope and policy belong to top management: the CEO agrees or sends back, with a reason, never on their own draft. */
  private async decideFoundation(user: User, id: Id, agree: boolean, noteIn: unknown) {
    if (foundationRole(user) !== 'ceo') throw new AccessDenied('view', '(the CEO decides the quality scope and policy)');
    const note = this.reason(noteIn, agree ? 'Say why it is right' : 'Say what to change');
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('qmsFoundation', id);
      const it = await tx.get('qmsFoundation', id);
      if (!it) throw new NotFound('Item');
      if (it.status !== 'draft') throw new BadRequest('This is not waiting for a decision.');
      if (it.byId === user.id) throw new BadRequest('You drafted this version. It needs another person to draft it for your decision.');
      if (agree) for (const old of await tx.list('qmsFoundation', { kind: it.kind, status: 'approved' })) await tx.update('qmsFoundation', old.id, { status: 'replaced' });
      await tx.update('qmsFoundation', id, { status: agree ? 'approved' : 'not_agreed', decision: { ...w, note, agree }, lastReviewedOn: this.today() });
      await tx.audit({ at: w.at, actor: w.by, companyId: null, action: agree ? 'quality.foundation.approve' : 'quality.foundation.return', entity: 'qms_foundation', entityId: id, summary: `${QMS_FOUNDATION_LABEL[it.kind]} version ${it.version} ${agree ? 'agreed' : 'sent back'} (${note}).` });
      return (await tx.get('qmsFoundation', id))!;
    });
  }

  private async reviewFoundation(user: User, id: Id, b: Record<string, unknown>) {
    if (foundationRole(user) !== 'keep') throw new AccessDenied('view', '(ACT or the Chief of Staff reviews the foundation)');
    const note = this.reason(b.note, 'Say what you looked at');
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('qmsFoundation', id);
      const it = await tx.get('qmsFoundation', id);
      if (!it || (it.status !== 'active' && it.status !== 'approved')) throw new NotFound('Item in force');
      await tx.update('qmsFoundation', id, { lastReviewedOn: this.today(), history: [...it.history, { ...w, note: `Reviewed: ${note}` }] });
      await tx.audit({ at: w.at, actor: w.by, companyId: null, action: 'quality.foundation.review', entity: 'qms_foundation', entityId: id, summary: `${QMS_FOUNDATION_LABEL[it.kind]}: ${it.title} reviewed (${note}).` });
      return (await tx.get('qmsFoundation', id))!;
    });
  }

  // ----- Competency matrix -----

  private async matrixFor(companyId: Id) {
    const today = this.today();
    const [people, credentials, assessments, profiles] = await Promise.all([
      this.store.list('people', { companyId, status: 'active' }),
      this.store.list('credentials', { companyId }),
      this.store.list('compAssessments', { companyId }),
      this.store.list('compProfiles', { status: 'approved' }),
    ]);
    const rows = people
      .map((p) => {
        const profile = profiles.find((x) => x.role === p.role) ?? null;
        const items = (profile?.items ?? []).map((item) => ({ itemId: item.id, ...compItemState(item, p, credentials, assessments, today) }));
        const gaps = items.filter((i) => i.state === 'missing' || i.state === 'not_yet' || i.state === 'expired').length;
        return { person: { id: p.id, name: p.name, staffNo: p.staffNo, role: p.role, jobTitle: p.jobTitle ?? null, companyId: p.companyId }, profileId: profile?.id ?? null, items, gaps, dueSoon: items.filter((i) => i.state === 'due_soon').length };
      })
      .sort((a, b) => b.gaps - a.gaps || a.person.name.localeCompare(b.person.name));
    return { people: rows, assessments, profiles };
  }

  async matrix(user: User, opts: { companyId?: Id; role?: PersonRole } = {}) {
    const role = compRoleOf(user);
    if (!role) throw new AccessDenied('view', '(competency matrix)');
    await this.mustBeReady();
    const allowed = (await this.companiesFor(user)).filter((id) => id !== GROUP_EMPLOYER_ID);
    if (!allowed.length) throw new AccessDenied('view', '(competency matrix)');
    const companyId = opts.companyId && allowed.includes(opts.companyId) ? opts.companyId : allowed[0];
    const [companies, allProfiles] = await Promise.all([this.store.list('companies', { id: allowed }), this.store.list('compProfiles', {})]);
    const m = await this.matrixFor(companyId);
    // A stationed officer sees only the guards of their own company; HR's office side sees only office staff.
    const visible = m.people.filter((r) => {
      if (user.role === 'supervisor') return r.person.role === 'guard';
      return !opts.role || r.person.role === opts.role;
    });
    const today = this.today();
    const afterTraining = m.assessments.filter((a) => a.afterTraining);
    const recent = [...m.assessments].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
    const byRole = (['guard', 'supervisor', 'patrol_officer', 'office'] as PersonRole[]).map((r) => {
      const ppl = visible.filter((p) => p.person.role === r);
      return { role: r, people: ppl.length, withGaps: ppl.filter((p) => p.gaps).length, dueSoon: ppl.filter((p) => p.dueSoon).length };
    });
    const people = await this.store.list('people', { companyId, status: 'active' });
    return {
      role,
      companies: allowed.map((id) => ({ id, name: companies.find((c) => c.id === id)?.name ?? id })),
      companyId,
      profiles: allProfiles.filter((p) => p.status !== 'replaced').sort((a, b) => a.role.localeCompare(b.role) || b.version - a.version),
      canProposeProfile: role === 'hr' && user.department === 'hr',
      canDecideProfile: isHrDirector(user),
      byRole,
      rows: visible.slice(0, 400).map((r) => ({ ...r, canAssess: mayAssess(user, people.find((p) => p.id === r.person.id)!, allowed) })),
      totalRows: visible.length,
      recent,
      kpis: {
        people: visible.length,
        withGaps: visible.filter((p) => p.gaps).length,
        dueSoon: visible.filter((p) => p.dueSoon).length,
        trainingChecks: afterTraining.length,
        trainingWorked: afterTraining.filter((a) => a.result === 'competent').length,
        assessedThisMonth: m.assessments.filter((a) => a.assessedOn.slice(0, 7) === today.slice(0, 7)).length,
      },
    };
  }

  private async proposeProfile(user: User, b: Record<string, unknown>) {
    if (!(user.role === 'pwvsb_officer' && user.department === 'hr')) throw new AccessDenied('view', '(HR proposes role profiles)');
    const role = oneOf(b.role, COMP_ROLE_LABEL);
    if (!role) throw new BadRequest('Choose the role.');
    const items: CompItem[] = (Array.isArray(b.items) ? b.items : []).slice(0, 25).map((raw, i) => {
      const x = (raw ?? {}) as Record<string, unknown>;
      const kind = oneOf(x.kind, COMP_KIND_LABEL);
      const label = text(x.label, 120);
      if (!kind || !label) throw new BadRequest(`Item ${i + 1}: give its name and kind.`);
      const types = (Array.isArray(x.credentialTypes) ? x.credentialTypes : []).filter((t): t is CredentialType => typeof t === 'string').slice(0, 4);
      if (kind === 'credential' && !types.length) throw new BadRequest(`Item ${i + 1}: say which licence or certificate on file meets it.`);
      const months = x.refreshMonths === null || x.refreshMonths === '' || x.refreshMonths === undefined ? null : Math.round(Number(x.refreshMonths));
      if (months !== null && (!Number.isFinite(months) || months < 1 || months > 120)) throw new BadRequest(`Item ${i + 1}: refresher months must be 1 to 120, or blank.`);
      return { id: text(x.id, 60) || `ci-${role}-${i + 1}`, label, kind, ...(kind === 'credential' ? { credentialTypes: types } : {}), refreshMonths: kind === 'credential' ? null : months };
    });
    if (!items.length) throw new BadRequest('List at least one item the role needs.');
    if (new Set(items.map((i) => i.id)).size !== items.length) throw new BadRequest('Two items have the same id.');
    const note = this.reason(b.note, 'Say what changed');
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      const all = await tx.list('compProfiles', { role });
      if (all.some((p) => p.status === 'proposed')) throw new BadRequest('A change for this role is already waiting for the HR Director.');
      const version = Math.max(0, ...all.map((p) => p.version)) + 1;
      const p: CompProfile = { id: `cp-${role}-v${version}`, role, name: COMP_ROLE_LABEL[role], version, items, status: 'proposed', proposed: { ...w, note }, decision: null };
      await tx.insert('compProfiles', p);
      await tx.audit({ at: w.at, actor: w.by, companyId: null, action: 'quality.profile.propose', entity: 'comp_profile', entityId: p.id, summary: `${p.name} version ${version} proposed: ${items.length} items (${note}).` });
      return p;
    });
  }

  /** What a role needs decides who is qualified, so a new version is a real decision: the HR Director, with a reason. */
  private async decideProfile(user: User, id: Id, agree: boolean, noteIn: unknown) {
    if (!isHrDirector(user)) throw new AccessDenied('view', '(the HR Director approves role profiles)');
    const note = this.reason(noteIn, agree ? 'Say why it is right' : 'Say what is wrong');
    const w = this.who(user);
    return this.store.transaction(async (tx) => {
      await tx.lock?.('compProfiles', id);
      const p = await tx.get('compProfiles', id);
      if (!p) throw new NotFound('Role profile');
      if (p.status !== 'proposed') throw new BadRequest('This profile is not waiting for a decision.');
      if (p.proposed.byId === user.id) throw new BadRequest('You proposed this change. The other HR Director decides.');
      if (agree) for (const old of await tx.list('compProfiles', { role: p.role, status: 'approved' })) await tx.update('compProfiles', old.id, { status: 'replaced' });
      await tx.update('compProfiles', id, { status: agree ? 'approved' : 'not_agreed', decision: { ...w, note, agree } });
      await tx.audit({ at: w.at, actor: w.by, companyId: null, action: agree ? 'quality.profile.approve' : 'quality.profile.reject', entity: 'comp_profile', entityId: id, summary: `${p.name} version ${p.version} ${agree ? 'approved' : 'not agreed'} (${note}).` });
      return (await tx.get('compProfiles', id))!;
    });
  }

  private async assess(user: User, b: Record<string, unknown>) {
    if (compRoleOf(user) === null || compRoleOf(user) === 'view') throw new AccessDenied('view', '(assessing competency)');
    const person = await this.store.get('people', text(b.personId, 80));
    if (!person || person.status !== 'active') throw new NotFound('Staff member');
    const allowed = await this.companiesFor(user);
    if (!mayAssess(user, person, allowed)) throw new AccessDenied('view', user.personId === person.id ? '(nobody assesses themselves)' : '(this person is not in your line of work)');
    const profile = (await this.store.list('compProfiles', { role: person.role, status: 'approved' }))[0];
    const item = profile?.items.find((i) => i.id === b.itemId);
    if (!profile || !item) throw new BadRequest('Choose an item from the role profile.');
    if (item.kind === 'credential') throw new BadRequest('Licences and certificates are read from HR records. Update the record there instead.');
    const result = b.result === 'competent' ? 'competent' : b.result === 'not_yet' ? 'not_yet' : null;
    if (!result) throw new BadRequest('Say whether the person is competent or not yet.');
    const method = oneOf(b.method, COMP_METHOD_LABEL);
    if (!method) throw new BadRequest('Say how you assessed it.');
    const note = this.reason(b.note, result === 'competent' ? 'Say what you saw' : 'Say what still needs work');
    const assessedOn = isDate(b.assessedOn) ? b.assessedOn : this.today();
    if (assessedOn > this.today()) throw new BadRequest('The assessment date cannot be in the future.');
    if (daysBetween(assessedOn, this.today()) > 90) throw new BadRequest('Record assessments within 90 days of doing them.');
    const months = item.refreshMonths ?? null;
    const w = this.who(user);
    const a: CompAssessment = {
      id: `ca-${person.id}-${item.id}-${stamp(w.at)}`,
      companyId: person.companyId,
      personId: person.id,
      itemId: item.id,
      profileVersion: profile.version,
      result,
      method,
      note,
      evidenceRef: text(b.evidenceRef, 200),
      assessedOn,
      nextDueOn: result === 'competent' && months ? addDays(assessedOn, Math.round(months * MONTH_DAYS)) : null,
      afterTraining: text(b.afterTraining, 160) || null,
      assessor: w.by,
      assessorId: w.byId,
      at: w.at,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('compAssessments', a);
      await tx.audit({ at: w.at, actor: w.by, companyId: person.companyId, action: 'quality.assess', entity: 'comp_assessment', entityId: a.id, summary: `${person.name}: ${item.label} ${result === 'competent' ? 'competent' : 'not yet competent'} (${COMP_METHOD_LABEL[method].toLowerCase()}).` });
      return a;
    });
  }

  // ----- Home -----

  /** One grouped line per person, only for work that is theirs (staff experience rule 3). */
  async homeItems(user: User) {
    const items: { tone: 'crit' | 'warn' | 'info'; tag: string; title: string; detail: string; go: { view: 'quality' } }[] = [];
    const tag = 'Quality and compliance';
    try {
      if (qmsRoleOf(user) === 'act') {
        const entries = await this.store.list('qmsEntries', {});
        const n = entries.reduce((s, e) => s + e.evidence.filter((x) => !x.check && x.linkedById !== user.id).length, 0);
        if (n) items.push({ tone: 'info', tag, title: `${n} piece${n === 1 ? '' : 's'} of evidence to check`, detail: 'Requirements register', go: { view: 'quality' } });
      }
      if (foundationRole(user) === 'ceo') {
        const d = (await this.store.list('qmsFoundation', { status: 'draft' })).filter((x) => x.byId !== user.id);
        if (d.length) items.push({ tone: 'warn', tag, title: `${d.length} quality ${d.length === 1 ? 'item' : 'items'} for your decision`, detail: d.map((x) => QMS_FOUNDATION_LABEL[x.kind]).join(', '), go: { view: 'quality' } });
      }
      if (isHrDirector(user)) {
        const p = (await this.store.list('compProfiles', { status: 'proposed' })).filter((x) => x.proposed.byId !== user.id);
        if (p.length) items.push({ tone: 'warn', tag, title: `${p.length} role profile change${p.length === 1 ? '' : 's'} to decide`, detail: p.map((x) => x.name).join(', '), go: { view: 'quality' } });
      }
      // Officers: one grouped line for their own guards whose on-the-job check is overdue or must be done again. Never
      // assessed (the first round) is not nagged here; the officer sees it on the screen.
      if (user.role === 'supervisor' && compRoleOf(user) === 'assess') {
        let n = 0;
        for (const companyId of user.companyIds) {
          const m = await this.matrixFor(companyId);
          const kindOf = new Map(m.profiles.flatMap((p) => p.items.map((i) => [i.id, i.kind] as const)));
          n += m.people.filter(
            (r) => r.person.role === 'guard' && r.person.id !== user.personId && r.items.some((i) => kindOf.get(i.itemId) !== 'credential' && (i.state === 'expired' || i.state === 'not_yet')),
          ).length;
        }
        if (n) items.push({ tone: 'info', tag: 'Guard skills', title: `${n} guard${n === 1 ? '' : 's'} to check at work again`, detail: 'Refresher overdue or not yet able', go: { view: 'quality' } });
      }
      if (user.role === 'company_manager' && user.companyIds.length === 1) {
        const m = await this.matrixFor(user.companyIds[0]);
        const late = m.people.filter((p) => p.items.some((i) => i.state === 'expired')).length;
        if (late) items.push({ tone: 'warn', tag, title: `${late} staff with an expired licence or overdue refresher`, detail: 'Competency matrix', go: { view: 'quality' } });
      }
    } catch {
      return [];
    }
    return items;
  }
}

/** Sort clause references the way people read them: 4.1 before 4.10, 7.1.5 after 7.1. */
function refOrder(a: string, b: string) {
  const pa = a.split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = b.split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return a.localeCompare(b);
}

const KIND_ORDER: QmsFoundationKind[] = ['scope', 'policy', 'issue', 'party', 'process'];

/** One line on the foundation for the register's "Prima figures". */
export function foundationSummary(items: QmsFoundationItem[], today: IsoDate): string {
  const live = items.filter((i) => i.status === 'approved' || i.status === 'active');
  const scope = live.find((i) => i.kind === 'scope');
  const policy = live.find((i) => i.kind === 'policy');
  const late = live.filter((i) => addDays(i.lastReviewedOn, Math.round(i.reviewEveryMonths * MONTH_DAYS)) < today).length;
  const processes = live.filter((i) => i.kind === 'process');
  return [
    scope ? `scope version ${scope.version} agreed` : 'no agreed scope',
    policy ? `policy version ${policy.version} agreed` : 'no agreed policy',
    `${live.filter((i) => i.kind === 'issue').length} issues`,
    `${live.filter((i) => i.kind === 'party').length} interested parties`,
    `${processes.length} processes (${processes.filter((p) => !p.requirementIds?.length).length} not linked to a requirement)`,
    `${late} past review`,
  ].join(', ');
}
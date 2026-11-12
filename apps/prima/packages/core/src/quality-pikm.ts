// E9 Quality (PIKM / ISO) records (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A5 / E9). The five PIKM Part 1
// gaps on the Quality and compliance list (docs/QUALITY_AND_COMPLIANCE.md, 8 Nov 2026), kept as records next to the
// requirements register, never a second quality system:
//   medical        yearly medical for guards aged 56 and over (7.1): HR records it with the certificate; another HR
//                  person checks it; a "fit with restrictions" or "unfit" result is checked by the HR Director.
//   briefing       site risks briefed to the guards before they are deployed (9.4): the OM, officer or company manager
//                  records who was briefed with the signed attendance; another of them checks it. Guards rostered at a
//                  site for the first time in the next 7 days with no briefing show as "to brief".
//   retention      personnel records kept 7 years after employment ends: HR proposes clearing a file only after the
//                  7 years and never under a legal hold; the HR Director decides. Prima never deletes the record.
//   client_pack    the client information pack on request (9.3): Prima fills licence, registration and insurance from
//                  the records; the company office prepares it; the company manager or ACT approves before it goes.
//   office_system  office alarm and CCTV (6.3): installer, each maintenance visit with the service report, and the next
//                  service date; ACT checks the record.
// Every step keeps who did it and a reason for each decision; nobody checks or approves their own record.
// Table prima.qms_pikm_records (db/modules/quality-pikm-v1.sql), approved to build, not yet to install.

import { AccessDenied, isActHead, isHrDirector, isOwnerAdmin } from './access';
import { hrKeeps } from './hr';
import { RULES } from './rules';
import type { HomeItem, PrimaService, ProofInput } from './service';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { addDays, ageOn, toMs } from './time';
import type { Id, IsoDate, IsoDateTime, Person, User } from './types';

export type PikmKind = 'medical' | 'briefing' | 'retention' | 'client_pack' | 'office_system';
export type PikmStatus = 'waiting' | 'checked' | 'returned' | 'cleared' | 'refused' | 'approved' | 'sent';
export type MedicalResult = 'fit' | 'fit_restricted' | 'unfit';

export interface PikmStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

export interface PackItem {
  key: 'licence' | 'registration' | 'insurance' | 'membership' | 'iso';
  label: string;
  ref: string;
  expiresOn: IsoDate | null;
  ok: boolean;
  required: boolean;
}

export interface SystemVisit {
  on: IsoDate;
  contractor: string;
  result: string;
  docIds: Id[];
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export interface PikmRecord {
  id: Id;
  companyId: Id;
  kind: PikmKind;
  status: PikmStatus;
  personId?: Id | null;
  /** medical */
  examinedOn?: IsoDate;
  result?: MedicalResult;
  restrictions?: string;
  clinic?: string;
  nextDueOn?: IsoDate;
  /** briefing */
  siteId?: Id;
  briefedOn?: IsoDate;
  risks?: string;
  personIds?: Id[];
  /** retention */
  leftOn?: IsoDate;
  keepUntil?: IsoDate;
  /** client pack */
  clientName?: string;
  requestedOn?: IsoDate;
  items?: PackItem[];
  sent?: { on: IsoDate; to: string; how: string; by: string; byId: Id; at: IsoDateTime } | null;
  /** office system */
  system?: 'alarm' | 'cctv';
  installer?: string;
  installedOn?: IsoDate | null;
  place?: string;
  visits?: SystemVisit[];
  nextServiceOn?: IsoDate | null;
  docIds: Id[];
  recorded: PikmStep;
  decided: (PikmStep & { ok: boolean }) | null;
  history: PikmStep[];
}

export const MEDICAL_RESULT_LABEL: Record<MedicalResult, string> = {
  fit: 'Fit for guard duty',
  fit_restricted: 'Fit with restrictions',
  unfit: 'Not fit for guard duty',
};

export const PIKM_KIND_LABEL: Record<PikmKind, string> = {
  medical: 'Yearly medical, guards 56 and over',
  briefing: 'Site risk briefing before deployment',
  retention: 'Personnel records kept 7 years',
  client_pack: 'Client information pack',
  office_system: 'Office alarm and CCTV',
};

export const PIKM_ACTIONS = [
  'medical_record',
  'medical_check',
  'briefing_record',
  'briefing_check',
  'retention_propose',
  'retention_decide',
  'pack_prepare',
  'pack_decide',
  'pack_sent',
  'system_record',
  'system_visit',
  'system_check',
] as const;

const FIELD_ROLES: Person['role'][] = ['guard', 'supervisor', 'patrol_officer'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v: unknown): IsoDate | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const proofs = (v: unknown): ProofInput[] => (Array.isArray(v) ? (v.slice(0, 3) as ProofInput[]) : []);
const step = (user: User, at: IsoDateTime, note = ''): PikmStep => ({ by: user.name, byId: user.id, at, note });
const addYears = (d: IsoDate, n: number): IsoDate => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;

/** The medical due for a guard aged 56 or over: none on record, due within the due-soon window, or overdue. */
export function medicalDue(p: Pick<Person, 'dob' | 'role' | 'status'>, latest: Pick<PikmRecord, 'nextDueOn' | 'status'> | null, today: IsoDate): { state: 'not_needed' | 'missing' | 'overdue' | 'due_soon' | 'ok'; dueOn: IsoDate | null } {
  const r = RULES.pikmRecords.value;
  if (p.status !== 'active' || !FIELD_ROLES.includes(p.role) || !p.dob || ageOn(p.dob, today) < r.medicalFromAge) return { state: 'not_needed', dueOn: null };
  if (!latest || !latest.nextDueOn || latest.status === 'returned') return { state: 'missing', dueOn: today };
  if (latest.nextDueOn < today) return { state: 'overdue', dueOn: latest.nextDueOn };
  if (latest.nextDueOn <= addDays(today, RULES.quality.value.dueSoonDays)) return { state: 'due_soon', dueOn: latest.nextDueOn };
  return { state: 'ok', dueOn: latest.nextDueOn };
}

/** The day a personnel file may be cleared: the last working day plus the PIKM keep period. */
export function keepUntil(lastDayOn: IsoDate): IsoDate {
  return addYears(lastDayOn, RULES.pikmRecords.value.keepYears);
}

export class PikmService {
  constructor(
    private store: Store,
    private svc: PrimaService,
  ) {}

  private now(): IsoDateTime {
    return this.svc.now();
  }
  private today(): IsoDate {
    return this.svc.now().slice(0, 10);
  }
  private async ready(): Promise<boolean> {
    return this.store.hasTable ? this.store.hasTable('qmsPikmRecords') : true;
  }
  private async mustBeReady() {
    if (!(await this.ready())) throw new BadRequest('PIKM records are not switched on yet. The database part waits for the CEO to install it.');
  }
  private async companies(user: User): Promise<Id[]> {
    return (await this.svc.visibleCompanies(user)).map((c) => c.id);
  }
  private async see(user: User, companyId: Id) {
    if (!(await this.companies(user)).includes(companyId) && !(companyId === 'pwvsb' && (hrKeeps(user) || isHrDirector(user) || user.department === 'audit' || user.department === 'it')))
      throw new AccessDenied('view', companyId);
  }
  /** Company office for one company: its manager and admin executives. */
  private companyOffice(user: User, companyId: Id): boolean {
    return (user.role === 'company_manager' || user.role === 'admin_exec') && user.companyIds.includes(companyId);
  }
  private opsLead(user: User): boolean {
    return user.department === 'operations' && ['om', 'regional', 'ops_director', 'ogm', 'coo'].includes(user.opsTier ?? '');
  }
  private async record(id: Id, kind: PikmKind): Promise<PikmRecord> {
    const r = await this.store.get('qmsPikmRecords', id);
    if (!r || r.kind !== kind) throw new NotFound('Record');
    return r;
  }
  private async save(user: User, r: PikmRecord, isNew: boolean, summary: string, docs: import('./types').EvidenceDoc[] = [], patch?: (ids: Id[], cur: PikmRecord) => Partial<PikmRecord>) {
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const ids = docs.length ? await this.svc.savePaperDocs(tx, docs) : [];
      let out: PikmRecord;
      if (isNew) {
        out = { ...r, docIds: [...r.docIds, ...ids] };
        await tx.insert('qmsPikmRecords', out);
      } else {
        await tx.lock?.('qmsPikmRecords', r.id);
        const cur = await tx.get('qmsPikmRecords', r.id);
        if (!cur || cur.status !== r.status || cur.history.length !== r.history.length) throw new BadRequest('The record changed meanwhile. Open it again.');
        const change = patch ? patch(ids, cur) : {};
        out = await tx.update('qmsPikmRecords', r.id, { ...change, history: [...cur.history, step(user, at, summary)] });
      }
      await tx.audit({ at, actor: user.name, companyId: r.companyId === 'pwvsb' ? null : r.companyId, action: `pikm.${r.kind}`, entity: 'qms_pikm_record', entityId: r.id, summary });
      return out;
    });
  }
  private newId(kind: PikmKind): Id {
    return `pikm-${kind.slice(0, 4)}-${toMs(this.now()).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  async act(user: User, action: string, body: Record<string, unknown>): Promise<PikmRecord> {
    await this.mustBeReady();
    const id = text(body.id, 120);
    const ok = body.ok === true || body.approve === true;
    const note = text(body.note, 400);
    switch (action) {
      case 'medical_record':
        return this.medicalRecord(user, body);
      case 'medical_check':
        return this.medicalCheck(user, id, ok, note);
      case 'briefing_record':
        return this.briefingRecord(user, body);
      case 'briefing_check':
        return this.briefingCheck(user, id, ok, note);
      case 'retention_propose':
        return this.retentionPropose(user, text(body.personId, 80), note);
      case 'retention_decide':
        return this.retentionDecide(user, id, ok, note);
      case 'pack_prepare':
        return this.packPrepare(user, body);
      case 'pack_decide':
        return this.packDecide(user, id, ok, note);
      case 'pack_sent':
        return this.packSent(user, id, body);
      case 'system_record':
        return this.systemRecord(user, body);
      case 'system_visit':
        return this.systemVisit(user, id, body);
      case 'system_check':
        return this.systemCheck(user, id, note);
      default:
        throw new BadRequest('Unknown PIKM step.');
    }
  }

  private needNote(note: string, what: string) {
    if (note.length < 3) throw new BadRequest(`Write a comment to ${what}. A short one is fine.`);
  }

  // ----- medical, guards 56 and over -----

  private async medicalRecord(user: User, body: Record<string, unknown>) {
    if (!hrKeeps(user)) throw new AccessDenied('view', '(HR records the yearly medical)');
    const p = await this.store.get('people', text(body.personId, 80));
    if (!p) throw new NotFound('Guard');
    await this.see(user, p.companyId);
    if (!FIELD_ROLES.includes(p.role)) throw new BadRequest('The yearly medical is for guards and officers.');
    const examinedOn = day(body.examinedOn);
    const today = this.today();
    if (!examinedOn || examinedOn > today || examinedOn < addDays(today, -365)) throw new BadRequest('Give the day of the medical, within the last 12 months.');
    if (!p.dob || ageOn(p.dob, examinedOn) < RULES.pikmRecords.value.medicalFromAge - 1)
      throw new BadRequest(`The yearly medical is for guards aged ${RULES.pikmRecords.value.medicalFromAge} and over (from a year before).`);
    const result = body.result as MedicalResult;
    if (!MEDICAL_RESULT_LABEL[result]) throw new BadRequest('Choose the doctor’s result.');
    const restrictions = text(body.restrictions, 300);
    if (result === 'fit_restricted' && restrictions.length < 3) throw new BadRequest('Write the restrictions the doctor gave.');
    const clinic = text(body.clinic, 120);
    if (clinic.length < 3) throw new BadRequest('Give the clinic or doctor.');
    const docs = this.svc.paperDocs(user, p.companyId, proofs(body.proof), `Medical ${examinedOn}: ${p.staffNo}`);
    if (!docs.length) throw new BadRequest('Attach the medical certificate.');
    const at = this.now();
    const r: PikmRecord = {
      id: this.newId('medical'),
      companyId: p.companyId,
      kind: 'medical',
      status: 'waiting',
      personId: p.id,
      examinedOn,
      result,
      restrictions,
      clinic,
      nextDueOn: addYears(examinedOn, 1),
      docIds: [],
      recorded: step(user, at),
      decided: null,
      history: [step(user, at, `Medical recorded: ${MEDICAL_RESULT_LABEL[result]}`)],
    };
    return this.save(user, r, true, `${p.staffNo} yearly medical on ${examinedOn}: ${MEDICAL_RESULT_LABEL[result]}`, docs);
  }

  private async medicalCheck(user: User, id: Id, ok: boolean, note: string) {
    const r = await this.record(id, 'medical');
    await this.see(user, r.companyId);
    if (!hrKeeps(user)) throw new AccessDenied('view', '(HR checks the yearly medical)');
    if (r.recorded.byId === user.id) throw new AccessDenied('view', '(another HR person checks the medical you recorded)');
    if (r.result !== 'fit' && !isHrDirector(user)) throw new AccessDenied('view', '(the HR Director checks a restricted or unfit result)');
    if (r.status !== 'waiting') throw new BadRequest('This medical has already been checked.');
    this.needNote(note, ok ? 'check' : 'send it back');
    const at = this.now();
    return this.save(user, r, false, `Medical ${ok ? 'checked' : 'sent back'}: ${note}`, [], () => ({ status: ok ? 'checked' : 'returned', decided: { ...step(user, at, note), ok } }));
  }

  // ----- risk briefing before deployment -----

  private async mayBrief(user: User, companyId: Id): Promise<boolean> {
    return this.companyOffice(user, companyId) || ((user.role === 'supervisor' || this.opsLead(user)) && (await this.svc.canDo(user, 'roster.edit', companyId)));
  }

  private async briefingRecord(user: User, body: Record<string, unknown>) {
    const site = await this.store.get('sites', text(body.siteId, 80));
    if (!site) throw new NotFound('Site');
    await this.see(user, site.companyId);
    if (!(await this.mayBrief(user, site.companyId))) throw new AccessDenied('view', '(the OM, officer or company office briefs the guards)');
    const briefedOn = day(body.briefedOn);
    const today = this.today();
    if (!briefedOn || briefedOn > today || briefedOn < addDays(today, -30)) throw new BadRequest('Give the day of the briefing, within the last 30 days.');
    const risks = text(body.risks, 1000);
    if (risks.length < 10) throw new BadRequest('Write the site risks that were explained.');
    const ids = Array.isArray(body.personIds) ? [...new Set((body.personIds as unknown[]).filter((x): x is string => typeof x === 'string'))].slice(0, 100) : [];
    if (!ids.length) throw new BadRequest('Choose who was briefed.');
    const people = await this.store.list('people', { id: ids });
    if (people.length !== ids.length || people.some((p) => p.companyId !== site.companyId)) throw new BadRequest('Choose guards of the site’s company.');
    const docs = this.svc.paperDocs(user, site.companyId, proofs(body.proof), `Risk briefing ${briefedOn}: ${site.name}`);
    if (!docs.length) throw new BadRequest('Attach the attendance sheet the guards signed.');
    const at = this.now();
    const r: PikmRecord = {
      id: this.newId('briefing'),
      companyId: site.companyId,
      kind: 'briefing',
      status: 'waiting',
      siteId: site.id,
      briefedOn,
      risks,
      personIds: ids,
      docIds: [],
      recorded: step(user, at),
      decided: null,
      history: [step(user, at, `Briefing recorded: ${ids.length} briefed`)],
    };
    return this.save(user, r, true, `Risk briefing at ${site.name} on ${briefedOn}: ${ids.length} guard(s)`, docs);
  }

  private async briefingCheck(user: User, id: Id, ok: boolean, note: string) {
    const r = await this.record(id, 'briefing');
    await this.see(user, r.companyId);
    if (!(user.role === 'company_manager' && user.companyIds.includes(r.companyId)) && !this.opsLead(user)) throw new AccessDenied('view', '(the company manager or the OM checks a briefing)');
    if (r.recorded.byId === user.id) throw new AccessDenied('view', '(nobody checks a briefing they recorded)');
    if (r.status !== 'waiting') throw new BadRequest('This briefing has already been checked.');
    this.needNote(note, ok ? 'check' : 'send it back');
    const at = this.now();
    return this.save(user, r, false, `Briefing ${ok ? 'checked' : 'sent back'}: ${note}`, [], () => ({ status: ok ? 'checked' : 'returned', decided: { ...step(user, at, note), ok } }));
  }

  // ----- personnel records kept 7 years -----

  private async retentionPropose(user: User, personId: Id, note: string) {
    if (!hrKeeps(user)) throw new AccessDenied('view', '(HR proposes clearing a personnel file)');
    const p = await this.store.get('people', personId);
    if (!p) throw new NotFound('Staff member');
    await this.see(user, p.companyId);
    const left = p.leaving?.lastDayOn ?? null;
    if (p.status !== 'left' || !left) throw new BadRequest('Only the file of someone who has left can be cleared.');
    const until = keepUntil(left);
    if (this.today() < until) throw new BadRequest(`The file is kept until ${until} (${RULES.pikmRecords.value.keepYears} years after the last day).`);
    const holds = (await this.store.list('legalHolds', { companyId: p.companyId })).filter((h) => h.tbl === 'people' && h.refId === p.id && !h.released);
    if (holds.length) throw new BadRequest('The file is under a legal hold. It stays until the hold is released.');
    this.needNote(note, 'propose clearing the file');
    const open = (await this.store.list('qmsPikmRecords', { companyId: p.companyId })).find((x) => x.kind === 'retention' && x.personId === p.id && (x.status === 'waiting' || x.status === 'cleared'));
    if (open) throw new BadRequest(open.status === 'cleared' ? 'This file is already cleared.' : 'A proposal for this file is already waiting.');
    const at = this.now();
    const r: PikmRecord = { id: this.newId('retention'), companyId: p.companyId, kind: 'retention', status: 'waiting', personId: p.id, leftOn: left, keepUntil: until, docIds: [], recorded: step(user, at, note), decided: null, history: [step(user, at, `Clearing proposed: ${note}`)] };
    return this.save(user, r, true, `${p.staffNo} personnel file proposed for clearing (kept until ${until}): ${note}`);
  }

  private async retentionDecide(user: User, id: Id, ok: boolean, note: string) {
    const r = await this.record(id, 'retention');
    await this.see(user, r.companyId);
    if (!isHrDirector(user)) throw new AccessDenied('view', '(the HR Director decides on clearing a personnel file)');
    if (r.recorded.byId === user.id) throw new AccessDenied('view', '(nobody decides a proposal they made)');
    if (r.status !== 'waiting') throw new BadRequest('This proposal has already been decided.');
    this.needNote(note, ok ? 'clear the file' : 'keep the file');
    const holds = (await this.store.list('legalHolds', { companyId: r.companyId })).filter((h) => h.tbl === 'people' && h.refId === r.personId && !h.released);
    if (ok && holds.length) throw new BadRequest('The file is under a legal hold. It stays until the hold is released.');
    const at = this.now();
    return this.save(user, r, false, `Personnel file ${ok ? 'cleared for disposal under the PDPA register (Prima keeps the record line)' : 'kept'}: ${note}`, [], () => ({ status: ok ? 'cleared' : 'refused', decided: { ...step(user, at, note), ok } }));
  }

  // ----- client information pack -----

  private async packItems(companyId: Id, membership: string, today: IsoDate): Promise<PackItem[]> {
    const [company, licences, policies] = await Promise.all([this.store.get('companies', companyId), this.store.list('licences', { companyId }), this.store.list('insurancePolicies', { companyId })]);
    const latest = (type: string) => licences.filter((l) => l.type === type).sort((a, b) => (b.expiresOn ?? '').localeCompare(a.expiresOn ?? ''))[0] ?? null;
    const kdn = latest('KDN_LICENCE');
    const iso = latest('ISO_CERT');
    const pl = policies.filter((x) => x.kind === 'PUBLIC_LIABILITY' && x.startsOn <= today).sort((a, b) => b.expiresOn.localeCompare(a.expiresOn))[0] ?? null;
    return [
      { key: 'licence', label: 'KDN security licence', ref: kdn?.reference ?? '', expiresOn: kdn?.expiresOn ?? null, ok: !!kdn?.expiresOn && kdn.expiresOn >= today, required: true },
      { key: 'registration', label: 'Company registration (SSM)', ref: company?.ssmNo ?? '', expiresOn: null, ok: !!company?.ssmNo, required: true },
      { key: 'insurance', label: 'Public liability insurance', ref: pl ? `${pl.insurer} ${pl.policyNo}` : '', expiresOn: pl?.expiresOn ?? null, ok: !!pl && pl.expiresOn >= today, required: true },
      { key: 'membership', label: 'Association membership', ref: membership, expiresOn: null, ok: membership.length >= 3, required: false },
      { key: 'iso', label: 'ISO certificate', ref: iso?.reference ?? '', expiresOn: iso?.expiresOn ?? null, ok: !!iso?.expiresOn && iso.expiresOn >= today, required: false },
    ];
  }

  private async packPrepare(user: User, body: Record<string, unknown>) {
    const companyId = text(body.companyId, 80);
    await this.see(user, companyId);
    if (!this.companyOffice(user, companyId) && user.department !== 'audit') throw new AccessDenied('view', '(the company office or ACT prepares a client pack)');
    const clientName = text(body.clientName, 160);
    if (clientName.length < 3) throw new BadRequest('Give the client who asked.');
    const requestedOn = day(body.requestedOn) ?? this.today();
    const items = await this.packItems(companyId, text(body.membership, 120), this.today());
    const at = this.now();
    const r: PikmRecord = { id: this.newId('client_pack'), companyId, kind: 'client_pack', status: 'waiting', clientName, requestedOn, items, sent: null, docIds: [], recorded: step(user, at), decided: null, history: [step(user, at, `Pack prepared for ${clientName}`)] };
    return this.save(user, r, true, `Client information pack prepared for ${clientName}`);
  }

  private async packDecide(user: User, id: Id, ok: boolean, note: string) {
    const r = await this.record(id, 'client_pack');
    await this.see(user, r.companyId);
    if (!(user.role === 'company_manager' && user.companyIds.includes(r.companyId)) && !isActHead(user)) throw new AccessDenied('view', '(the company manager or the ACT Director approves a client pack)');
    if (r.recorded.byId === user.id) throw new AccessDenied('view', '(nobody approves a pack they prepared)');
    if (r.status !== 'waiting') throw new BadRequest('This pack has already been decided.');
    this.needNote(note, ok ? 'approve' : 'refuse');
    // The papers are read again at approval: a licence or policy that lapsed since the pack was prepared stops it.
    const items = await this.packItems(r.companyId, r.items?.find((i) => i.key === 'membership')?.ref ?? '', this.today());
    const missing = items.filter((i) => i.required && !i.ok);
    if (ok && missing.length) throw new BadRequest(`Not ready to send: ${missing.map((i) => i.label).join(', ')} missing or expired.`);
    const at = this.now();
    return this.save(user, r, false, `Client pack for ${r.clientName} ${ok ? 'approved' : 'refused'}: ${note}`, [], () => ({ items, status: ok ? 'approved' : 'refused', decided: { ...step(user, at, note), ok } }));
  }

  private async packSent(user: User, id: Id, body: Record<string, unknown>) {
    const r = await this.record(id, 'client_pack');
    await this.see(user, r.companyId);
    if (!this.companyOffice(user, r.companyId) && user.department !== 'audit') throw new AccessDenied('view', '(the company office or ACT sends the pack)');
    if (r.status !== 'approved') throw new BadRequest('Only an approved pack is sent.');
    const on = day(body.on);
    if (!on || on > this.today() || on < r.decided!.at.slice(0, 10)) throw new BadRequest('Give the day it was sent, on or after the approval.');
    const to = text(body.to, 160);
    const how = text(body.how, 80);
    if (to.length < 3 || how.length < 3) throw new BadRequest('Say who received it and how it was sent.');
    const at = this.now();
    return this.save(user, r, false, `Client pack sent to ${to} by ${how} on ${on}`, [], () => ({ status: 'sent', sent: { on, to, how, by: user.name, byId: user.id, at } }));
  }

  // ----- office alarm and CCTV -----

  private maySystem(user: User, companyId: Id): boolean {
    return this.companyOffice(user, companyId) || user.department === 'it' || isOwnerAdmin(user);
  }

  private async systemRecord(user: User, body: Record<string, unknown>) {
    const companyId = text(body.companyId, 80);
    await this.see(user, companyId);
    if (!this.maySystem(user, companyId)) throw new AccessDenied('view', '(the company office or IT keeps the office alarm and CCTV record)');
    const system = body.system === 'alarm' || body.system === 'cctv' ? body.system : null;
    if (!system) throw new BadRequest('Choose alarm or CCTV.');
    const installer = text(body.installer, 160);
    const place = text(body.place, 200);
    if (installer.length < 3 || place.length < 3) throw new BadRequest('Give the installer and the office it is at.');
    const installedOn = day(body.installedOn);
    const nextServiceOn = day(body.nextServiceOn);
    if (!nextServiceOn || nextServiceOn < this.today()) throw new BadRequest('Give the next service date from the maintenance contract.');
    const docs = this.svc.paperDocs(user, companyId === 'pwvsb' ? 'pwvsb' : companyId, proofs(body.proof), `${system === 'alarm' ? 'Alarm' : 'CCTV'} installation: ${place}`);
    const at = this.now();
    const r: PikmRecord = { id: this.newId('office_system'), companyId, kind: 'office_system', status: 'waiting', system, installer, installedOn, place, visits: [], nextServiceOn, docIds: [], recorded: step(user, at), decided: null, history: [step(user, at, `${system} recorded at ${place}`)] };
    return this.save(user, r, true, `Office ${system === 'alarm' ? 'alarm' : 'CCTV'} recorded at ${place}, installer ${installer}`, docs);
  }

  private async systemVisit(user: User, id: Id, body: Record<string, unknown>) {
    const r = await this.record(id, 'office_system');
    await this.see(user, r.companyId);
    if (!this.maySystem(user, r.companyId)) throw new AccessDenied('view', '(the company office or IT records a service visit)');
    const on = day(body.on);
    if (!on || on > this.today()) throw new BadRequest('Give the day of the service visit.');
    const contractor = text(body.contractor, 160);
    const result = text(body.result, 300);
    if (contractor.length < 3 || result.length < 3) throw new BadRequest('Give who serviced it and what they found.');
    const nextServiceOn = day(body.nextServiceOn);
    if (!nextServiceOn || nextServiceOn <= on) throw new BadRequest('Give the next service date.');
    const docs = this.svc.paperDocs(user, r.companyId, proofs(body.proof), `Service report ${on}: ${r.place}`);
    if (!docs.length) throw new BadRequest('Attach the service report.');
    const at = this.now();
    return this.save(user, r, false, `Service visit on ${on} by ${contractor}: ${result}`, docs, (ids, cur) => ({
      visits: [...(cur.visits ?? []), { on, contractor, result, docIds: ids, by: user.name, byId: user.id, at }],
      nextServiceOn,
      // A new visit needs ACT's check again.
      status: 'waiting',
      decided: null,
    }));
  }

  private async systemCheck(user: User, id: Id, note: string) {
    const r = await this.record(id, 'office_system');
    await this.see(user, r.companyId);
    if (user.department !== 'audit') throw new AccessDenied('view', '(ACT checks the office alarm and CCTV record)');
    const lastBy = r.visits?.at(-1)?.byId ?? r.recorded.byId;
    if (lastBy === user.id || r.recorded.byId === user.id) throw new AccessDenied('view', '(nobody checks a record they keep)');
    if (r.status !== 'waiting') throw new BadRequest('Already checked. A new service visit asks for a check again.');
    this.needNote(note, 'check');
    const at = this.now();
    return this.save(user, r, false, `Alarm and CCTV record checked: ${note}`, [], () => ({ status: 'checked', decided: { ...step(user, at, note), ok: true } }));
  }

  // ----- the board -----

  /** What this person may see and do for each PIKM record, with what is due. Sections the person has no part in are left out. */
  async board(user: User, opts: { companyId?: Id } = {}) {
    if (user.integration || user.role === 'guard' || user.role === 'site_device') throw new AccessDenied('view', '(PIKM records)');
    if (!(await this.ready())) return { ready: false as const };
    const companies = await this.svc.visibleCompanies(user);
    const ids = companies.map((c) => c.id).filter((id) => !opts.companyId || id === opts.companyId);
    const today = this.today();
    const hr = hrKeeps(user) || isHrDirector(user);
    const act = user.department === 'audit' || isActHead(user);
    const office = user.role === 'company_manager' || user.role === 'admin_exec';
    const ops = this.opsLead(user) || user.role === 'supervisor';
    const it = user.department === 'it';
    const all = (await this.store.list('qmsPikmRecords', { companyId: [...ids, ...(hr || act || it ? ['pwvsb'] : [])] })).sort((a, b) => b.recorded.at.localeCompare(a.recorded.at));
    const name = (id: Id) => (id === 'pwvsb' ? 'PWVSB (group office)' : (companies.find((c) => c.id === id)?.name ?? id));
    const people = hr || office || ops || act ? await this.store.list('people', { companyId: ids }) : [];
    const pname = (id: Id | null | undefined) => {
      const p = people.find((x) => x.id === id);
      return p ? `${p.name} (${p.staffNo})` : '';
    };
    const by = (k: PikmKind) => all.filter((r) => r.kind === k);
    const out: Record<string, unknown> = { ready: true, companies: companies.map((c) => ({ id: c.id, name: c.name })), canAct: { hr, hrDirector: isHrDirector(user), act, office, ops, it } };

    if (hr || office || act) {
      const meds = by('medical');
      const latest = new Map<Id, PikmRecord>();
      for (const m of meds) if (m.personId && m.status !== 'returned' && (!latest.has(m.personId) || (latest.get(m.personId)!.examinedOn ?? '') < (m.examinedOn ?? ''))) latest.set(m.personId, m);
      const due = people
        .map((p) => ({ p, d: medicalDue(p, latest.get(p.id) ?? null, today) }))
        .filter((x) => x.d.state !== 'not_needed' && x.d.state !== 'ok')
        .map((x) => ({ personId: x.p.id, name: x.p.name, staffNo: x.p.staffNo, companyName: name(x.p.companyId), age: ageOn(x.p.dob!, today), state: x.d.state, dueOn: x.d.dueOn }));
      out.medical = {
        due,
        rows: meds.slice(0, 300).map((r) => ({ record: r, person: pname(r.personId), companyName: name(r.companyId), canCheck: hrKeeps(user) && r.status === 'waiting' && r.recorded.byId !== user.id && (r.result === 'fit' || isHrDirector(user)) })),
        canRecord: hrKeeps(user),
        fromAge: RULES.pikmRecords.value.medicalFromAge,
      };
    }
    if (ops || office || act) {
      const rows = by('briefing');
      const shifts = await this.store.list('shifts', { companyId: ids }, { field: 'date', from: addDays(today, -180), before: addDays(today, 8) });
      const sites = await this.store.list('sites', { companyId: ids });
      const briefed = new Set(rows.filter((r) => r.status !== 'returned').flatMap((r) => (r.personIds ?? []).map((p) => `${r.siteId}|${p}`)));
      const before = new Set(shifts.filter((s) => s.date < today && s.personId).map((s) => `${s.siteId}|${s.personId}`));
      const toBrief = new Map<string, { siteId: Id; siteName: string; personId: Id; name: string; firstOn: IsoDate; companyName: string }>();
      for (const s of shifts.filter((x) => x.date >= today && x.personId).sort((a, b) => a.date.localeCompare(b.date))) {
        const k = `${s.siteId}|${s.personId}`;
        if (before.has(k) || briefed.has(k) || toBrief.has(k)) continue;
        const site = sites.find((x) => x.id === s.siteId);
        toBrief.set(k, { siteId: s.siteId, siteName: site?.name ?? s.siteId, personId: s.personId!, name: pname(s.personId), firstOn: s.date, companyName: name(s.companyId) });
      }
      out.briefing = {
        toBrief: [...toBrief.values()].slice(0, 300),
        rows: rows.slice(0, 300).map((r) => ({ record: r, siteName: sites.find((x) => x.id === r.siteId)?.name ?? r.siteId ?? '', people: (r.personIds ?? []).map(pname), companyName: name(r.companyId), canCheck: ((user.role === 'company_manager' && user.companyIds.includes(r.companyId)) || this.opsLead(user)) && r.status === 'waiting' && r.recorded.byId !== user.id })),
        sites: sites.map((x) => ({ id: x.id, name: x.name, companyId: x.companyId })),
        guards: people.filter((p) => p.status === 'active' && FIELD_ROLES.includes(p.role)).map((p) => ({ id: p.id, name: p.name, staffNo: p.staffNo, companyId: p.companyId })),
        canRecord: office || ops,
      };
    }
    if (hr) {
      const rows = by('retention');
      const eligible = people
        .filter((p) => p.status === 'left' && p.leaving?.lastDayOn)
        .map((p) => ({ personId: p.id, name: p.name, staffNo: p.staffNo, companyName: name(p.companyId), lastDayOn: p.leaving!.lastDayOn, keepUntil: keepUntil(p.leaving!.lastDayOn) }))
        .sort((a, b) => a.keepUntil.localeCompare(b.keepUntil));
      out.retention = {
        keepYears: RULES.pikmRecords.value.keepYears,
        files: eligible.slice(0, 300).map((e) => ({ ...e, mayClear: e.keepUntil <= today && !rows.some((r) => r.personId === e.personId && (r.status === 'waiting' || r.status === 'cleared')) })),
        rows: rows.map((r) => ({ record: r, person: pname(r.personId), companyName: name(r.companyId), canDecide: isHrDirector(user) && r.status === 'waiting' && r.recorded.byId !== user.id })),
        canPropose: hrKeeps(user),
      };
    }
    if (office || act) {
      out.clientPack = {
        rows: by('client_pack').map((r) => ({
          record: r,
          companyName: name(r.companyId),
          canDecide: ((user.role === 'company_manager' && user.companyIds.includes(r.companyId)) || isActHead(user)) && r.status === 'waiting' && r.recorded.byId !== user.id,
          canSend: (this.companyOffice(user, r.companyId) || user.department === 'audit') && r.status === 'approved',
        })),
        canPrepare: office || user.department === 'audit',
      };
    }
    if (office || act || it) {
      out.officeSystems = {
        rows: by('office_system').map((r) => ({
          record: r,
          companyName: name(r.companyId),
          due: r.nextServiceOn ? (r.nextServiceOn < today ? 'overdue' : r.nextServiceOn <= addDays(today, RULES.quality.value.dueSoonDays) ? 'due_soon' : 'ok') : 'unknown',
          canVisit: this.maySystem(user, r.companyId),
          canCheck: user.department === 'audit' && r.status === 'waiting' && r.recorded.byId !== user.id && (r.visits?.at(-1)?.byId ?? '') !== user.id,
        })),
        canRecord: office || it || isOwnerAdmin(user),
      };
    }
    return out as {
      ready: true;
      companies: { id: Id; name: string }[];
      canAct: { hr: boolean; hrDirector: boolean; act: boolean; office: boolean; ops: boolean; it: boolean };
      medical?: { due: { personId: Id; name: string; staffNo: string; companyName: string; age: number; state: string; dueOn: IsoDate | null }[]; rows: { record: PikmRecord; person: string; companyName: string; canCheck: boolean }[]; canRecord: boolean; fromAge: number };
      briefing?: {
        toBrief: { siteId: Id; siteName: string; personId: Id; name: string; firstOn: IsoDate; companyName: string }[];
        rows: { record: PikmRecord; siteName: string; people: string[]; companyName: string; canCheck: boolean }[];
        sites: { id: Id; name: string; companyId: Id }[];
        guards: { id: Id; name: string; staffNo: string; companyId: Id }[];
        canRecord: boolean;
      };
      retention?: { keepYears: number; files: { personId: Id; name: string; staffNo: string; companyName: string; lastDayOn: IsoDate; keepUntil: IsoDate; mayClear: boolean }[]; rows: { record: PikmRecord; person: string; companyName: string; canDecide: boolean }[]; canPropose: boolean };
      clientPack?: { rows: { record: PikmRecord; companyName: string; canDecide: boolean; canSend: boolean }[]; canPrepare: boolean };
      officeSystems?: { rows: { record: PikmRecord; companyName: string; due: 'overdue' | 'due_soon' | 'ok' | 'unknown'; canVisit: boolean; canCheck: boolean }[]; canRecord: boolean };
    };
  }

  /** Home: medicals due, briefings owed before deployment, decisions waiting, and alarm or CCTV services due. */
  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration || user.role === 'guard' || user.role === 'site_device') return [];
    if (!(await this.ready())) return [];
    const b = await this.board(user).catch(() => null);
    if (!b || !b.ready) return [];
    const out: HomeItem[] = [];
    const go = { view: 'quality' as const };
    if (b.medical && hrKeeps(user)) {
      const late = b.medical.due.filter((d) => d.state !== 'due_soon');
      if (b.medical.due.length) out.push({ tone: late.length ? 'crit' : 'warn', tag: 'PIKM', title: `Yearly medical: ${b.medical.due.length} guard(s) aged ${b.medical.fromAge} and over`, detail: `${late.length} missing or overdue`, go });
      const check = b.medical.rows.filter((r) => r.canCheck).length;
      if (check) out.push({ tone: 'warn', tag: 'PIKM', title: `${check} medical record(s) to check`, detail: 'Recorded by another HR person', go });
    }
    if (b.briefing) {
      if (b.briefing.canRecord && b.briefing.toBrief.length) out.push({ tone: 'warn', tag: 'PIKM', title: `Brief ${b.briefing.toBrief.length} guard(s) on the site risks before their first shift`, detail: b.briefing.toBrief.slice(0, 3).map((x) => `${x.siteName} ${x.firstOn}`).join('; '), go });
      const check = b.briefing.rows.filter((r) => r.canCheck).length;
      if (check) out.push({ tone: 'info', tag: 'PIKM', title: `${check} risk briefing(s) to check`, detail: 'Recorded by another person', go });
    }
    if (b.retention) {
      const decide = b.retention.rows.filter((r) => r.canDecide).length;
      if (decide) out.push({ tone: 'warn', tag: 'PIKM', title: `${decide} personnel file(s) proposed for clearing`, detail: `Kept ${b.retention.keepYears} years after the last day`, go });
    }
    if (b.clientPack) {
      const decide = b.clientPack.rows.filter((r) => r.canDecide).length;
      if (decide) out.push({ tone: 'warn', tag: 'PIKM', title: `${decide} client information pack(s) to approve`, detail: 'Licence, registration, insurance', go });
    }
    if (b.officeSystems) {
      const due = b.officeSystems.rows.filter((r) => r.canVisit && (r.due === 'overdue' || r.due === 'due_soon'));
      if (due.length) out.push({ tone: due.some((r) => r.due === 'overdue') ? 'crit' : 'warn', tag: 'PIKM', title: `Office alarm or CCTV service due at ${due.length} place(s)`, detail: due.slice(0, 3).map((r) => r.record.place ?? '').join('; '), go });
    }
    return out;
  }
}

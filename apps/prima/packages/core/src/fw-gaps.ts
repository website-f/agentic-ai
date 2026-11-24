// FWM department check gaps (Fauzan, 23 Nov 2026: "Do the gap", study note "FWM department check"). One service for:
//  B1 loading the paper dates FWM already keeps in Excel or CSV (rule FWM-BULK-LOAD),
//  B2 hostel accommodation certificate reminders (FWM-HOSTEL-CERT),
//  B3 the levy paid on each work permit renewal (FWM-LEVY; D1 puts its share on the EPF/SOCSO debit note),
//  B4 one exit file for every foreign worker who leaves (FWM-EXIT),
//  B5 the FWM caseload: which Executive owns each company's workers (FWM-CASELOAD),
//  D2 absconding cases raised by the OM after 3 days missing, never automatic (FWM-ABSCOND),
//  D3 a light quota tracker (FWM-QUOTA).
// Exit files, absconding cases, quotas and the caseload live in module fw-gaps-v1 (not on the release list). Bulk dates,
// levy and hostel reminders use existing tables. Passport numbers are kept as the last 4 characters only; no IC numbers.
import { AccessDenied } from './access';
import { latestCredentials } from './checks';
import { FW_PAPER_LABEL, FW_PAPERS, fwPaperNumber } from './fw';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService, type ProofInput } from './service';
import type { Store } from './store';
import { addDays, dateOf, daysBetween, toMs } from './time';
import type { Credential, FwPaper, FwRenewal, Id, IsoDate, IsoDateTime, Person, User } from './types';
import { addMonthsIso } from './work';

export type FwExitReason = 'END' | 'YEAR10' | 'REPATRIATED' | 'RESIGNED' | 'ABSCONDED' | 'TERMINATED' | 'DIED' | 'OTHER';
export const FW_EXIT_REASON_LABEL: Record<FwExitReason, string> = {
  END: 'Contract ended',
  YEAR10: 'Year 10, going home',
  REPATRIATED: 'Sent home (repatriated)',
  RESIGNED: 'Resigned',
  ABSCONDED: 'Absconded',
  TERMINATED: 'Employment terminated',
  DIED: 'Died',
  OTHER: 'Other',
};
/** Reasons where the worker flies home, so the flight is part of the file. */
const GOES_HOME: FwExitReason[] = ['END', 'YEAR10', 'REPATRIATED', 'RESIGNED', 'TERMINATED'];

export interface FwGapHistory {
  at: IsoDateTime;
  by: string;
  byId: Id;
  note: string;
}
export interface FwPaperStep {
  ref: string;
  on: IsoDate;
  docIds: Id[];
  by: string;
}
interface FwGapBase {
  id: Id;
  companyId: Id;
  history: FwGapHistory[];
  createdAt: IsoDateTime;
  createdBy: string;
}
export interface FwExitRec extends FwGapBase {
  kind: 'exit';
  personId: Id;
  staffNo: string;
  name: string;
  reason: FwExitReason;
  lastDay: IsoDate;
  /** The report to the Labour Department and Immigration is due this day (rule FWM-EXIT, Unverified). */
  reportDue: IsoDate;
  note: string;
  memo: FwPaperStep | null;
  flight: { on: IsoDate; ref: string; by: string } | null;
  labour: FwPaperStep | null;
  immigration: FwPaperStep | null;
  abscondId: Id | null;
  status: 'open' | 'closed';
  closedAt: IsoDateTime | null;
}
export interface FwAbscondRec extends FwGapBase {
  kind: 'abscond';
  personId: Id;
  staffNo: string;
  name: string;
  lastSeenOn: IsoDate;
  contactTried: string;
  raisedBy: string;
  raisedById: Id;
  status: 'raised' | 'reported' | 'found';
  police: FwPaperStep | null;
  immigration: FwPaperStep | null;
  foundOn: IsoDate | null;
  exitId: Id | null;
}
export interface FwQuotaRec extends FwGapBase {
  kind: 'quota';
  ref: string;
  appliedOn: IsoDate;
  placesAsked: number;
  status: 'applied' | 'approved' | 'rejected';
  approvedOn: IsoDate | null;
  validTo: IsoDate | null;
  places: number;
  used: number;
  letterDocIds: Id[];
  note: string;
}
export interface FwCaseloadRec extends FwGapBase {
  kind: 'caseload';
  execId: Id;
  execName: string;
}
export type FwGapRec = FwExitRec | FwAbscondRec | FwQuotaRec | FwCaseloadRec;

/** One row of FWM's own list of paper dates (CSV or pasted from Excel). */
export interface FwBulkRow {
  company: string;
  staffNo: string;
  paper: string;
  number?: string;
  issuedOn: string;
  expiresOn: string;
}
export interface FwBulkCheck {
  line: number;
  staffNo: string;
  paper: FwPaper | null;
  status: 'load' | 'skip' | 'error';
  why: string;
  name?: string;
  companyName?: string;
  issuedOn?: IsoDate;
  expiresOn?: IsoDate;
}

const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** A date as FWM's lists write it: 2027-03-31, 31/03/2027, 31-03-2027 or 31.03.2027 (day first, the Malaysian way). */
export function fwListDate(v: unknown): IsoDate | null {
  const t = s(v, 20);
  if (isDate(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return null;
  const d = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDate(d) && new Date(`${d}T00:00:00Z`).getUTCDate() === Number(m[1]) ? d : null;
}

/** The paper as FWM's lists name it (Prima codes, the JA app's codes or plain words). */
export function fwListPaper(v: unknown): FwPaper | null {
  const t = s(v, 60).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  if (!t) return null;
  if ((FW_PAPERS as string[]).includes(t.replace(/ /g, '_'))) return t.replace(/ /g, '_') as FwPaper;
  if (/^(PLKS|PERMIT|WORK PERMIT|PERMIT KERJA|VP TE|VPTE)\b/.test(t) || t.includes('PLKS')) return 'PLKS_PERMIT';
  if (/PASSPORT|PASPORT/.test(t)) return 'PASSPORT';
  if (/FOMEMA|MEDICAL|PERUBATAN/.test(t)) return 'FOMEMA';
  if (/SPIKPA|HOSPITAL/.test(t)) return 'SPIKPA';
  if (/FWIG|INSURANCE|INSURANS|FW INS/.test(t)) return 'FW_INSURANCE';
  if (/KDN/.test(t)) return 'KDN_LETTER';
  return null;
}

/** Levy share for a user of the worker: yearly levy / 12 x days used / days in the month, to the sen (rule FWM-LEVY). */
export function fwLevyShare(yearly: number, daysUsed: number, daysInMonth: number): number {
  if (!(yearly > 0) || !(daysInMonth > 0)) return 0;
  const f = Math.min(1, Math.max(0, daysUsed / daysInMonth));
  return Math.round(((yearly / RULES.fwmLevy.value.monthsCovered) * f) * 100) / 100;
}

/** The levy a renewal paid that covers a month: paid on or before the month's end and less than 12 months before it. */
export function fwLevyFor(renewals: Pick<FwRenewal, 'id' | 'paper' | 'levy'>[], period: string): { yearly: number; renewalId: Id } | null {
  const end = `${period}-28`;
  const from = addMonthsIso(`${period}-01`, -RULES.fwmLevy.value.monthsCovered);
  const hit = renewals
    .filter((r) => r.paper === 'PLKS_PERMIT' && r.levy && r.levy.amount > 0 && r.levy.paidOn <= end && r.levy.paidOn > from)
    .sort((a, b) => b.levy!.paidOn.localeCompare(a.levy!.paidOn))[0];
  return hit ? { yearly: hit.levy!.amount, renewalId: hit.id } : null;
}

export class FwGapsService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private svc: PrimaService,
  ) {}
  private now() {
    return this.clock();
  }
  private today() {
    return dateOf(this.clock());
  }
  private async installed() {
    return !this.store.hasTable || (await this.store.hasTable('fwGapRecs'));
  }
  private async need() {
    if (!(await this.installed())) throw new BadRequest('Foreign worker exits, absconding cases, quotas and caseload are not installed in this database yet (module fw-gaps-v1, run by the CEO).');
  }
  private async recs(ids: Id[]): Promise<FwGapRec[]> {
    if (!ids.length || !(await this.installed())) return [];
    return ((await this.store.list('fwGapRecs', { companyId: ids }).catch(() => [])) as FwGapRec[]) ?? [];
  }
  private role(user: User) {
    return user.integration ? null : this.svc.fwRoleFor(user);
  }
  private staff(user: User) {
    if (this.role(user) !== 'staff') throw new AccessDenied('hr.monitor', '(Foreign Worker Management staff only)');
  }
  private async worker(user: User, personId: unknown): Promise<Person> {
    const p = await this.store.get('people', s(personId, 120));
    if (!p) throw new NotFound('Worker');
    if (p.nationality === 'MY') throw new BadRequest('Foreign Worker Management handles foreign workers only.');
    if (!(await this.svc.visibleCompanyIdsOf(user)).includes(p.companyId)) throw new AccessDenied('view', p.companyId);
    return p;
  }
  private date(v: unknown, what: string, opts: { notFuture?: boolean } = {}): IsoDate {
    const d = fwListDate(v);
    if (!d) throw new BadRequest(`${what}: give the date.`);
    if (opts.notFuture && d > this.today()) throw new BadRequest(`${what} cannot be in the future.`);
    return d;
  }
  private async proof(user: User, companyId: Id, proof: unknown, ownerId: Id, caption: string, required: boolean, tx: Store) {
    const list = Array.isArray(proof) ? (proof as ProofInput[]) : [];
    if (!list.length) {
      if (required) throw new BadRequest(`Attach ${caption.toLowerCase()}.`);
      return [] as Id[];
    }
    const rec = this.svc.ssProof(user, companyId, null, list, true);
    if (required && !rec.docs.length) throw new BadRequest(`Attach ${caption.toLowerCase()}.`);
    return this.svc.ssSaveProof(tx, { photos: [], docs: rec.docs.map((d) => ({ ...d, fwmId: ownerId, caption: d.caption || caption })) });
  }
  private hist(user: User, note: string): FwGapHistory {
    return { at: this.now(), by: user.name, byId: user.id, note: note.slice(0, 300) };
  }
  private newId(prefix: string, key: string) {
    return `${prefix}-${key.replace(/[^a-zA-Z0-9-]/g, '')}-${toMs(this.now())}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // ---------- B5 caseload ----------

  /** Company -> the FWM Executive who owns its workers. */
  async caseload(ids: Id[]): Promise<Map<Id, { execId: Id; execName: string }>> {
    const out = new Map<Id, { execId: Id; execName: string }>();
    for (const r of await this.recs(ids)) if (r.kind === 'caseload') out.set(r.companyId, { execId: r.execId, execName: r.execName });
    return out;
  }

  private async setCaseload(user: User, i: Record<string, unknown>) {
    this.staff(user);
    if (user.fwmRole !== 'manager') throw new AccessDenied('hr.monitor', '(only the FWM Manager splits the companies)');
    await this.need();
    const companyId = s(i.companyId, 80);
    if (!(await this.svc.visibleCompanyIdsOf(user)).includes(companyId)) throw new AccessDenied('view', companyId);
    const exec = await this.store.get('users', s(i.execId, 120));
    if (!exec || exec.department !== 'fwm' || exec.fwmRole === 'despatch' || exec.integration) throw new BadRequest('Choose an FWM Executive, the Deputy or the Manager.');
    const id = `fwcl-${companyId}`;
    await this.store.lock?.('fwGapRecs', id);
    const cur = (await this.store.get('fwGapRecs', id)) as FwCaseloadRec | undefined;
    if (cur?.execId === exec.id) throw new BadRequest(`${exec.name} already owns this company's workers.`);
    const note = `Owner: ${exec.name}${cur ? ` (was ${cur.execName})` : ''}`;
    return this.store.transaction(async (tx) => {
      if (cur) await tx.update('fwGapRecs', id, { execId: exec.id, execName: exec.name, history: [...cur.history, this.hist(user, note)] } as Partial<FwGapRec>);
      else await tx.insert('fwGapRecs', { id, companyId, kind: 'caseload', execId: exec.id, execName: exec.name, history: [this.hist(user, note)], createdAt: this.now(), createdBy: user.name } as FwCaseloadRec);
      await tx.audit({ at: this.now(), actor: user.name, companyId, action: 'fwm.caseload', entity: 'company', entityId: companyId, summary: note });
      return tx.get('fwGapRecs', id);
    });
  }

  // ---------- B1 bulk paper dates ----------

  /** Check each row of FWM's list against Prima; nothing is saved. */
  private async checkBulk(user: User, rowsIn: unknown): Promise<{ rows: FwBulkCheck[]; load: (FwBulkCheck & { person: Person; number: string })[] }> {
    this.staff(user);
    const raw = Array.isArray(rowsIn) ? (rowsIn as FwBulkRow[]) : [];
    if (!raw.length) throw new BadRequest('The list is empty. Use the template: company, staff no, paper, number, issued on, expires on.');
    const max = RULES.fwmBulkLoad.value.maxRows;
    if (raw.length > max) throw new BadRequest(`At most ${max} rows at a time; split the list.`);
    const ids = await this.svc.visibleCompanyIdsOf(user);
    const [companies, people, creds] = await Promise.all([
      this.store.list('companies', { id: ids }),
      this.store.list('people', { companyId: ids }),
      this.store.list('credentials', { companyId: ids }),
    ]);
    const coOf = (v: string) => {
      const t = v.trim().toUpperCase();
      return companies.find((c) => c.id.toUpperCase() === t || (c.code ?? '').toUpperCase() === t || c.name.toUpperCase() === t) ?? null;
    };
    const today = this.today();
    const seen = new Set<string>();
    const rows: FwBulkCheck[] = [];
    const load: (FwBulkCheck & { person: Person; number: string })[] = [];
    raw.forEach((r, n) => {
      const line = n + 2;
      const staffNo = s(r?.staffNo, 40);
      const paper = fwListPaper(r?.paper);
      const base: FwBulkCheck = { line, staffNo, paper, status: 'error', why: '' };
      const co = coOf(s(r?.company, 120));
      if (!co) return rows.push({ ...base, why: `Company "${s(r?.company, 60)}" is not one you can see (use its code or full name).` });
      const person = people.find((p) => p.companyId === co.id && p.staffNo.trim().toUpperCase() === staffNo.toUpperCase());
      if (!person) return rows.push({ ...base, companyName: co.name, why: `No worker ${staffNo || '(blank)'} in ${co.name}. Add the worker first (or from the JA app).` });
      const more = { name: person.name, companyName: co.name };
      if (person.nationality === 'MY') return rows.push({ ...base, ...more, why: 'Malaysian: FWM keeps foreign workers only.' });
      if (!paper) return rows.push({ ...base, ...more, why: `Paper "${s(r?.paper, 40)}" not known (PLKS, passport, FOMEMA, insurance, SPIKPA, KDN letter).` });
      const issuedOn = fwListDate(r?.issuedOn);
      const expiresOn = fwListDate(r?.expiresOn);
      if (!expiresOn) return rows.push({ ...base, ...more, why: 'Expiry date missing or not a date (use 31/03/2027 or 2027-03-31).' });
      if (!issuedOn || issuedOn > today) return rows.push({ ...base, ...more, expiresOn, why: 'Issue date missing, not a date, or in the future.' });
      if (expiresOn <= issuedOn) return rows.push({ ...base, ...more, issuedOn, expiresOn, why: 'The expiry must be after the issue date.' });
      const key = `${person.id}|${paper}`;
      if (seen.has(key)) return rows.push({ ...base, ...more, issuedOn, expiresOn, why: 'The same worker and paper appear twice in the list.' });
      seen.add(key);
      const number = fwPaperNumber(paper, s(r?.number, 60)).slice(0, 60);
      const cur = latestCredentials(creds.filter((c) => c.personId === person.id && c.companyId === person.companyId)).get(paper) ?? null;
      if (cur?.source === 'prima') return rows.push({ ...base, ...more, issuedOn, expiresOn, status: 'skip', why: `Prima already has this paper from a copy (expires ${cur.expiresOn}); the list never replaces it.` });
      if (cur?.expiresOn && expiresOn <= cur.expiresOn) return rows.push({ ...base, ...more, issuedOn, expiresOn, status: 'skip', why: `Prima already has ${cur.expiresOn}, the same or later.` });
      // A JA date has no real issue date; any other paper on record must be older than the one on the list.
      if (cur && cur.source !== 'ja' && issuedOn <= cur.issuedOn) return rows.push({ ...base, ...more, issuedOn, expiresOn, why: `The paper on record was issued ${cur.issuedOn}; the list's paper must be issued after it. Check the row, or correct the paper on the board.` });
      const ok: FwBulkCheck = { ...base, ...more, issuedOn, expiresOn, status: 'load', why: cur?.expiresOn ? `Replaces ${cur.expiresOn} (${cur.source === 'ja' ? 'from JA' : cur.source === 'list' ? 'an earlier list' : 'sample'})` : 'New on the board' };
      rows.push(ok);
      load.push({ ...ok, person, number });
    });
    return { rows, load };
  }

  private async bulkPreview(user: User, i: Record<string, unknown>) {
    const { rows } = await this.checkBulk(user, i.rows);
    return { rows, counts: { load: rows.filter((r) => r.status === 'load').length, skip: rows.filter((r) => r.status === 'skip').length, error: rows.filter((r) => r.status === 'error').length } };
  }

  private async bulkSave(user: User, i: Record<string, unknown>) {
    const { rows, load } = await this.checkBulk(user, i.rows);
    if (!load.length) throw new BadRequest('Nothing to load: every row is already on record or has a problem.');
    const at = this.now();
    const ref = `FWL-${at.slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await this.store.transaction(async (tx) => {
      const perCompany = new Map<Id, number>();
      for (const r of load) {
        const c: Credential = {
          id: `cr-fw-${r.person.id}-${r.paper!.toLowerCase()}-${toMs(at)}-${Math.random().toString(36).slice(2, 8)}`,
          companyId: r.person.companyId,
          personId: r.person.id,
          type: r.paper!,
          number: r.number,
          issuedOn: r.issuedOn!,
          expiresOn: r.expiresOn!,
          source: 'list',
          docIds: [],
          recordedBy: user.name,
          recordedById: user.id,
          recordedAt: at,
        };
        await tx.insert('credentials', c);
        perCompany.set(r.person.companyId, (perCompany.get(r.person.companyId) ?? 0) + 1);
      }
      for (const [companyId, n] of perCompany)
        await tx.audit({ at, actor: user.name, companyId, action: 'fwm.paper.list', entity: 'company', entityId: companyId, summary: `${ref}: ${n} paper date${n === 1 ? '' : 's'} loaded from FWM's list (copy not seen yet)` });
    });
    return { ref, loaded: load.length, skipped: rows.filter((r) => r.status === 'skip').length, errors: rows.filter((r) => r.status === 'error').length, rows };
  }

  // ---------- B3 levy ----------

  private async recordLevy(user: User, i: Record<string, unknown>) {
    this.staff(user);
    const id = s(i.renewalId, 200);
    await this.store.lock?.('fwRenewals', id);
    const r = await this.store.get('fwRenewals', id);
    if (!r) throw new NotFound('Renewal');
    if (!(await this.svc.visibleCompanyIdsOf(user)).includes(r.companyId)) throw new AccessDenied('view', r.companyId);
    if (r.paper !== 'PLKS_PERMIT') throw new BadRequest('The levy is recorded on the work permit (PLKS) renewal.');
    const amount = Number(i.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) throw new BadRequest('Give the levy paid in RM (up to 2 decimals).');
    const paidOn = this.date(i.paidOn, 'Levy paid on', { notFuture: true });
    const ref = s(i.ref, 60);
    if (ref.length < 3) throw new BadRequest('Give the levy receipt or FWCMS payment reference.');
    const reason = s(i.reason, 300);
    if (r.levy && reason.length < 5) throw new BadRequest(`Levy RM${r.levy.amount.toFixed(2)} is already recorded; say why it changes.`);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const docIds = await this.proof(user, r.companyId, i.proof, r.id, 'Levy receipt', true, tx);
      const levy = { amount, paidOn, ref, docIds, by: user.name, at };
      const saved = await tx.update('fwRenewals', r.id, { levy, note: r.levy ? `${r.note}${r.note ? ' · ' : ''}Levy changed: ${reason}`.slice(0, 600) : r.note });
      await tx.audit({ at, actor: user.name, companyId: r.companyId, action: 'fwm.levy', entity: 'person', entityId: r.personId, summary: `Levy RM${amount.toFixed(2)} paid ${paidOn} (${ref}) on the work permit renewal${r.levy ? `; was RM${r.levy.amount.toFixed(2)}: ${reason}` : ''}` });
      return saved;
    });
  }

  // ---------- B4 exit files ----------

  private exitDue(reason: FwExitReason, lastDay: IsoDate) {
    return addDays(lastDay, RULES.fwmExit.value.reportDays[reason] ?? 14);
  }

  private async openExit(user: User, i: Record<string, unknown>, tx?: Store, abscond?: FwAbscondRec) {
    this.staff(user);
    await this.need();
    const p = await this.worker(user, i.personId);
    const reason = s(i.reason, 20) as FwExitReason;
    if (!FW_EXIT_REASON_LABEL[reason]) throw new BadRequest('Choose why the worker is leaving.');
    if (reason === 'ABSCONDED' && !abscond) throw new BadRequest('An absconding exit opens from the absconding case once FWM reports it.');
    const lastDay = this.date(i.lastDay, 'Last day');
    if (lastDay > addDays(this.today(), 180)) throw new BadRequest('The last day is more than 6 months away; open the file nearer the time.');
    const all = await (tx ?? this.store).list('fwGapRecs', { companyId: [p.companyId] }) as FwGapRec[];
    if (all.some((r) => r.kind === 'exit' && r.personId === p.id && r.status === 'open')) throw new BadRequest(`${p.staffNo} already has an open exit file.`);
    const id = this.newId('fwx', p.staffNo);
    const rec: FwExitRec = {
      id,
      companyId: p.companyId,
      kind: 'exit',
      personId: p.id,
      staffNo: p.staffNo,
      name: p.name,
      reason,
      lastDay,
      reportDue: this.exitDue(reason, lastDay),
      note: s(i.note, 300),
      memo: null,
      flight: null,
      labour: null,
      immigration: abscond?.immigration ?? null,
      abscondId: abscond?.id ?? null,
      status: 'open',
      closedAt: null,
      history: [this.hist(user, `Exit file opened: ${FW_EXIT_REASON_LABEL[reason]}, last day ${lastDay}`)],
      createdAt: this.now(),
      createdBy: user.name,
    };
    const go = async (t: Store) => {
      await t.insert('fwGapRecs', rec);
      await t.audit({ at: this.now(), actor: user.name, companyId: p.companyId, action: 'fwm.exit.open', entity: 'person', entityId: p.id, summary: `${p.staffNo}: exit file ${FW_EXIT_REASON_LABEL[reason]}, last day ${lastDay}, report due ${rec.reportDue}` });
      return rec;
    };
    return tx ? go(tx) : this.store.transaction(go);
  }

  private async exitFor(user: User, id: unknown): Promise<FwExitRec> {
    await this.need();
    const r = (await this.store.get('fwGapRecs', s(id, 200))) as FwGapRec | undefined;
    if (!r || r.kind !== 'exit') throw new NotFound('Exit file');
    if (!(await this.svc.visibleCompanyIdsOf(user)).includes(r.companyId)) throw new AccessDenied('view', r.companyId);
    return r;
  }

  private async exitStep(user: User, i: Record<string, unknown>) {
    this.staff(user);
    const id = s(i.id, 200);
    await this.store.lock?.('fwGapRecs', id);
    const r = await this.exitFor(user, id);
    if (r.status !== 'open') throw new BadRequest('This exit file is closed.');
    const step = s(i.step, 20);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      let patch: Partial<FwExitRec>;
      let note: string;
      if (step === 'memo' || step === 'labour' || step === 'immigration') {
        const label = step === 'memo' ? 'Check-out memo' : step === 'labour' ? 'Report to the Labour Department' : 'Report to Immigration';
        const ref = s(i.ref, 80);
        if (ref.length < 3) throw new BadRequest(`${label}: give the reference.`);
        const on = this.date(i.on, label, { notFuture: true });
        const docIds = await this.proof(user, r.companyId, i.proof, r.id, label, true, tx);
        patch = { [step]: { ref, on, docIds, by: user.name } } as Partial<FwExitRec>;
        note = `${label}: ${ref} on ${on}`;
      } else if (step === 'flight') {
        if (!GOES_HOME.includes(r.reason) && r.reason !== 'OTHER') throw new BadRequest('No flight for this exit reason.');
        const ref = s(i.ref, 80);
        if (ref.length < 3) throw new BadRequest('Flight: give the flight number or ticket reference.');
        patch = { flight: { on: this.date(i.on, 'Flight date'), ref, by: user.name } };
        note = `Flight ${ref} on ${(patch.flight as { on: string }).on}`;
      } else if (step === 'close') {
        const missing: string[] = [];
        if (!r.memo && r.reason !== 'ABSCONDED' && r.reason !== 'DIED') missing.push('check-out memo');
        if (!r.flight && GOES_HOME.includes(r.reason)) missing.push('flight');
        if (!r.labour) missing.push('report to the Labour Department');
        if (!r.immigration) missing.push('report to Immigration');
        if (missing.length) throw new BadRequest(`Before closing, record: ${missing.join(', ')}.`);
        if (r.lastDay > this.today()) throw new BadRequest(`The worker's last day is ${r.lastDay}; close after it.`);
        patch = { status: 'closed', closedAt: at };
        note = 'Exit file closed';
      } else throw new BadRequest('Unknown exit step.');
      const saved = await tx.update('fwGapRecs', r.id, { ...patch, history: [...r.history, this.hist(user, note)] } as Partial<FwGapRec>);
      await tx.audit({ at, actor: user.name, companyId: r.companyId, action: `fwm.exit.${step}`, entity: 'person', entityId: r.personId, summary: `${r.staffNo}: ${note}` });
      return saved;
    });
  }

  // ---------- D2 absconding cases ----------

  private async raiseAbscond(user: User, i: Record<string, unknown>) {
    const role = this.role(user);
    if (role !== 'om' && role !== 'company' && role !== 'staff') throw new AccessDenied('hr.monitor', '(the OM, the company manager or FWM raises a missing worker)');
    await this.need();
    const p = await this.worker(user, i.personId);
    const lastSeenOn = this.date(i.lastSeenOn, 'Last seen on', { notFuture: true });
    const days = RULES.fwmAbscond.value.missingDays;
    const missing = daysBetween(lastSeenOn, this.today());
    if (missing < days) throw new BadRequest(`Last seen ${missing} day${missing === 1 ? '' : 's'} ago. A case is raised after ${days} days missing with no contact; until then keep trying to reach the worker.`);
    const contactTried = s(i.contactTried, 300);
    if (contactTried.length < 10) throw new BadRequest('Say how you tried to reach the worker (phone, hostel, friends).');
    await this.store.lock?.('people', p.id);
    const all = (await this.store.list('fwGapRecs', { companyId: [p.companyId] })) as FwGapRec[];
    if (all.some((r) => r.kind === 'abscond' && r.personId === p.id && r.status !== 'found' && !r.exitId)) throw new BadRequest(`A missing-worker case for ${p.staffNo} is already open.`);
    const rec: FwAbscondRec = {
      id: this.newId('fwa', p.staffNo),
      companyId: p.companyId,
      kind: 'abscond',
      personId: p.id,
      staffNo: p.staffNo,
      name: p.name,
      lastSeenOn,
      contactTried,
      raisedBy: user.name,
      raisedById: user.id,
      status: 'raised',
      police: null,
      immigration: null,
      foundOn: null,
      exitId: null,
      history: [this.hist(user, `Raised: last seen ${lastSeenOn} (${missing} days)`)],
      createdAt: this.now(),
      createdBy: user.name,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('fwGapRecs', rec);
      await tx.audit({ at: this.now(), actor: user.name, companyId: p.companyId, action: 'fwm.abscond.raise', entity: 'person', entityId: p.id, summary: `${p.staffNo}: missing since ${lastSeenOn}, raised to FWM` });
      return rec;
    });
  }

  private async abscondStep(user: User, i: Record<string, unknown>) {
    const role = this.role(user);
    const id = s(i.id, 200);
    await this.need();
    await this.store.lock?.('fwGapRecs', id);
    const r = (await this.store.get('fwGapRecs', id)) as FwGapRec | undefined;
    if (!r || r.kind !== 'abscond') throw new NotFound('Missing-worker case');
    if (!(await this.svc.visibleCompanyIdsOf(user)).includes(r.companyId)) throw new AccessDenied('view', r.companyId);
    if (r.status !== 'raised') throw new BadRequest('This case is already settled.');
    const step = s(i.step, 20);
    const at = this.now();
    if (step === 'found') {
      // The worker came back: FWM, or whoever raised it, closes the case. Discipline is a separate HR step.
      if (role !== 'staff' && r.raisedById !== user.id) throw new AccessDenied('hr.monitor', '(FWM or whoever raised the case)');
      const foundOn = this.date(i.foundOn, 'Found on', { notFuture: true });
      if (foundOn < r.lastSeenOn) throw new BadRequest('Found on is before the last-seen date.');
      const note = s(i.note, 300);
      if (note.length < 5) throw new BadRequest('Say where the worker was found.');
      return this.store.transaction(async (tx) => {
        const saved = await tx.update('fwGapRecs', r.id, { status: 'found', foundOn, history: [...r.history, this.hist(user, `Found ${foundOn}: ${note}`)] } as Partial<FwGapRec>);
        await tx.audit({ at, actor: user.name, companyId: r.companyId, action: 'fwm.abscond.found', entity: 'person', entityId: r.personId, summary: `${r.staffNo}: found ${foundOn}` });
        return saved;
      });
    }
    if (step === 'report') {
      this.staff(user);
      const pref = s(i.policeRef, 80);
      const iref = s(i.immigrationRef, 80);
      if (pref.length < 3 || iref.length < 3) throw new BadRequest('Give the police report number and the Immigration notice reference.');
      const pOn = this.date(i.policeOn, 'Police report date', { notFuture: true });
      const iOn = this.date(i.immigrationOn, 'Immigration notice date', { notFuture: true });
      return this.store.transaction(async (tx) => {
        const pDocs = await this.proof(user, r.companyId, i.policeProof, r.id, 'Police report copy', true, tx);
        const iDocs = await this.proof(user, r.companyId, i.immigrationProof, r.id, 'Immigration notice copy', true, tx);
        const reported: FwAbscondRec = { ...r, status: 'reported', police: { ref: pref, on: pOn, docIds: pDocs, by: user.name }, immigration: { ref: iref, on: iOn, docIds: iDocs, by: user.name } };
        const exit = await this.openExit(user, { personId: r.personId, reason: 'ABSCONDED', lastDay: r.lastSeenOn, note: `From the missing-worker case ${r.id}` }, tx, reported);
        const saved = await tx.update('fwGapRecs', r.id, { status: 'reported', police: reported.police, immigration: reported.immigration, exitId: exit.id, history: [...r.history, this.hist(user, `Reported: police ${pref}, Immigration ${iref}; exit file opened`)] } as Partial<FwGapRec>);
        await tx.audit({ at, actor: user.name, companyId: r.companyId, action: 'fwm.abscond.report', entity: 'person', entityId: r.personId, summary: `${r.staffNo}: police ${pref} (${pOn}), Immigration ${iref} (${iOn}); exit file ${exit.id}` });
        return saved;
      });
    }
    throw new BadRequest('Unknown step.');
  }

  // ---------- D3 quotas ----------

  private async addQuota(user: User, i: Record<string, unknown>) {
    this.staff(user);
    await this.need();
    const companyId = s(i.companyId, 80);
    if (!(await this.svc.visibleCompanyIdsOf(user)).includes(companyId)) throw new AccessDenied('view', companyId);
    const ref = s(i.ref, 60);
    if (ref.length < 3) throw new BadRequest('Give the application reference (KESUMA eQuota or FWCMS).');
    const placesAsked = Math.floor(Number(i.placesAsked));
    if (!(placesAsked > 0 && placesAsked <= 5000)) throw new BadRequest('Give the number of places applied for.');
    const appliedOn = this.date(i.appliedOn, 'Applied on', { notFuture: true });
    const rec: FwQuotaRec = {
      id: this.newId('fwq', ref),
      companyId,
      kind: 'quota',
      ref,
      appliedOn,
      placesAsked,
      status: 'applied',
      approvedOn: null,
      validTo: null,
      places: 0,
      used: 0,
      letterDocIds: [],
      note: s(i.note, 300),
      history: [this.hist(user, `Applied ${appliedOn} for ${placesAsked} places`)],
      createdAt: this.now(),
      createdBy: user.name,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('fwGapRecs', rec);
      await tx.audit({ at: this.now(), actor: user.name, companyId, action: 'fwm.quota.add', entity: 'company', entityId: companyId, summary: `Quota ${ref}: ${placesAsked} places applied ${appliedOn}` });
      return rec;
    });
  }

  private async quotaStep(user: User, i: Record<string, unknown>) {
    this.staff(user);
    await this.need();
    const id = s(i.id, 200);
    await this.store.lock?.('fwGapRecs', id);
    const r = (await this.store.get('fwGapRecs', id)) as FwGapRec | undefined;
    if (!r || r.kind !== 'quota') throw new NotFound('Quota');
    if (!(await this.svc.visibleCompanyIdsOf(user)).includes(r.companyId)) throw new AccessDenied('view', r.companyId);
    const step = s(i.step, 20);
    const at = this.now();
    return this.store.transaction(async (tx) => {
      let patch: Partial<FwQuotaRec>;
      let note: string;
      if (step === 'approve') {
        if (r.status !== 'applied') throw new BadRequest('Only an application waiting for an answer is approved.');
        const approvedOn = this.date(i.approvedOn, 'Approved on', { notFuture: true });
        const places = Math.floor(Number(i.places));
        if (!(places > 0 && places <= r.placesAsked)) throw new BadRequest(`Give the places approved (1 to ${r.placesAsked}).`);
        const validTo = i.validTo ? this.date(i.validTo, 'Valid to') : addDays(addMonthsIso(approvedOn, RULES.fwmQuota.value.validMonths), -1);
        if (validTo <= approvedOn) throw new BadRequest('Valid to must be after the approval date.');
        const letterDocIds = await this.proof(user, r.companyId, i.proof, r.id, 'Quota approval letter', true, tx);
        patch = { status: 'approved', approvedOn, places, validTo, letterDocIds };
        note = `Approved ${approvedOn}: ${places} places, valid to ${validTo}`;
      } else if (step === 'reject') {
        if (r.status !== 'applied') throw new BadRequest('Only an application waiting for an answer is rejected.');
        const why = s(i.note, 300);
        if (why.length < 5) throw new BadRequest('Say what the answer was.');
        patch = { status: 'rejected' };
        note = `Rejected: ${why}`;
      } else if (step === 'used') {
        if (r.status !== 'approved') throw new BadRequest('Places are used only on an approved quota.');
        const used = Math.floor(Number(i.used));
        if (!(used >= 0 && used <= r.places)) throw new BadRequest(`Places used is 0 to ${r.places}.`);
        if (used === r.used) throw new BadRequest('Nothing changed.');
        patch = { used };
        note = `Places used: ${used} of ${r.places}${s(i.note, 200) ? ` (${s(i.note, 200)})` : ''}`;
      } else throw new BadRequest('Unknown quota step.');
      const saved = await tx.update('fwGapRecs', r.id, { ...patch, history: [...r.history, this.hist(user, note)] } as Partial<FwGapRec>);
      await tx.audit({ at, actor: user.name, companyId: r.companyId, action: `fwm.quota.${step}`, entity: 'company', entityId: r.companyId, summary: `Quota ${r.ref}: ${note}` });
      return saved;
    });
  }

  // ---------- board, home and B2 hostel certificates ----------

  /** Hostel certificates expiring within 90 days or expired, for FWM (all) or the owning company's manager. */
  private async certsDue(user: User) {
    const role = this.role(user);
    if (role !== 'staff' && role !== 'company' && role !== 'escalation') return [];
    const ids = await this.svc.visibleCompanyIdsOf(user);
    const hostels = await this.store.list('hostels', { companyId: ids });
    const today = this.today();
    const [first] = [...RULES.fwmHostelCert.value.remindDays].sort((a, b) => b - a);
    const companies = await this.store.list('companies', { id: ids });
    return hostels
      .filter((h) => h.cert?.expiresOn && daysBetween(today, h.cert.expiresOn) <= first)
      .filter((h) => role !== 'company' || user.companyIds.includes(h.companyId))
      .map((h) => {
        const daysLeft = daysBetween(today, h.cert!.expiresOn);
        const step = daysLeft < 0 ? 0 : [...RULES.fwmHostelCert.value.remindDays].sort((a, b) => a - b).find((d) => daysLeft <= d) ?? first;
        return { hostelId: h.id, name: h.name, companyId: h.companyId, companyName: companies.find((c) => c.id === h.companyId)?.name ?? h.companyId, certNo: h.cert!.number, expiresOn: h.cert!.expiresOn, daysLeft, step };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }

  async board(user: User) {
    const role = this.role(user);
    if (!role || role === 'despatch') throw new AccessDenied('hr.monitor', '(foreign workers)');
    const ids = await this.svc.visibleCompanyIdsOf(user);
    const installed = await this.installed();
    const recs = await this.recs(ids);
    const today = this.today();
    const companies = await this.store.list('companies', { id: ids });
    const coName = (id: Id) => companies.find((c) => c.id === id)?.name ?? id;
    // Rows are already inside the company wall; a company manager sees only their own companies, an OM their own cases.
    const own = (r: FwGapRec) => (role === 'company' ? user.companyIds.includes(r.companyId) : role === 'om' ? r.kind === 'abscond' && r.raisedById === user.id : true);
    const people = role === 'om' || role === 'company' || role === 'staff' ? (await this.store.list('people', { companyId: ids })).filter((p) => p.nationality !== 'MY' && p.status !== 'left') : [];
    const exits = recs
      .filter((r): r is FwExitRec => r.kind === 'exit' && (role === 'staff' || role === 'escalation' || own(r)))
      .map((r) => {
        const person = people.find((p) => p.id === r.personId);
        return {
          ...r,
          companyName: coName(r.companyId),
          reasonLabel: FW_EXIT_REASON_LABEL[r.reason],
          needsFlight: GOES_HOME.includes(r.reason),
          needsMemo: r.reason !== 'ABSCONDED' && r.reason !== 'DIED',
          reportLate: r.status === 'open' && (!r.labour || !r.immigration) && r.reportDue < today,
          staffRecordActive: r.status === 'closed' && !!person,
        };
      })
      .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.reportDue.localeCompare(b.reportDue));
    const absconds = recs
      .filter((r): r is FwAbscondRec => r.kind === 'abscond' && (role === 'staff' || role === 'escalation' || own(r)))
      .map((r) => ({ ...r, companyName: coName(r.companyId), daysMissing: daysBetween(r.lastSeenOn, today), canFound: r.status === 'raised' && (role === 'staff' || r.raisedById === user.id), canReport: r.status === 'raised' && role === 'staff' }))
      .sort((a, b) => Number(a.status !== 'raised') - Number(b.status !== 'raised') || b.createdAt.localeCompare(a.createdAt));
    const quotas = role === 'staff' || role === 'escalation' || role === 'company'
      ? recs
          .filter((r): r is FwQuotaRec => r.kind === 'quota' && (role !== 'company' || user.companyIds.includes(r.companyId)))
          .map((r) => {
            const daysLeft = r.validTo ? daysBetween(today, r.validTo) : null;
            return { ...r, companyName: coName(r.companyId), daysLeft, remind: r.status === 'approved' && r.used < r.places && daysLeft !== null && daysLeft <= Math.max(...RULES.fwmQuota.value.remindDays), expired: daysLeft !== null && daysLeft < 0 };
          })
          .sort((a, b) => (a.validTo ?? '9999').localeCompare(b.validTo ?? '9999'))
      : [];
    const caseloadMap = new Map<Id, FwCaseloadRec>();
    for (const r of recs) if (r.kind === 'caseload') caseloadMap.set(r.companyId, r);
    const team = role === 'staff' ? (await this.store.list('users', {})).filter((u) => u.department === 'fwm' && u.fwmRole !== 'despatch' && !u.integration).map((u) => ({ id: u.id, name: u.name, fwmRole: u.fwmRole ?? null })) : [];
    const caseload = role === 'staff' || role === 'escalation'
      ? companies
          .map((c) => {
            const workers = people.filter((p) => p.companyId === c.id).length;
            const r = caseloadMap.get(c.id);
            return { companyId: c.id, companyName: c.name, workers, execId: r?.execId ?? null, execName: r?.execName ?? null };
          })
          .filter((c) => c.workers > 0 || c.execId)
          .sort((a, b) => a.companyName.localeCompare(b.companyName))
      : [];
    return {
      role,
      installed,
      canWork: role === 'staff',
      canLead: role === 'staff' && (user.fwmRole === 'manager' || user.fwmRole === 'deputy'),
      canSetCaseload: role === 'staff' && user.fwmRole === 'manager',
      canRaise: role === 'om' || role === 'company' || role === 'staff',
      exits,
      absconds,
      quotas,
      caseload,
      team,
      certs: await this.certsDue(user),
      /** FWM staff work from this screen (they have no home page): the same reminders as a Do today list. */
      todo: role === 'staff' ? await this.homeItems(user) : [],
      workers: role === 'om' || role === 'company' || role === 'staff' ? people.map((p) => ({ id: p.id, staffNo: p.staffNo, name: p.name, companyId: p.companyId, companyName: coName(p.companyId) })).sort((a, b) => a.staffNo.localeCompare(b.staffNo)) : [],
      companies: companies.map((c) => ({ id: c.id, name: c.name, code: c.code ?? null })),
      reasons: Object.entries(FW_EXIT_REASON_LABEL).map(([value, label]) => ({ value, label })),
      papers: FW_PAPERS.map((p) => ({ value: p, label: FW_PAPER_LABEL[p] })),
      rules: { bulk: RULES.fwmBulkLoad, cert: RULES.fwmHostelCert, levy: RULES.fwmLevy, exit: RULES.fwmExit, abscond: RULES.fwmAbscond, quota: RULES.fwmQuota, caseload: RULES.fwmCaseload },
    };
  }

  async homeItems(user: User): Promise<HomeItem[]> {
    const role = this.role(user);
    if (role !== 'staff' && role !== 'company' && role !== 'om') return [];
    const out: HomeItem[] = [];
    if (role !== 'om') {
      for (const c of (await this.certsDue(user)).slice(0, 5))
        out.push({
          tone: c.daysLeft < 0 ? 'crit' : c.daysLeft <= 30 ? 'warn' : 'info',
          tag: 'Hostel certificate',
          title: `${c.name}: accommodation certificate ${c.daysLeft < 0 ? `expired ${-c.daysLeft} days ago` : `expires in ${c.daysLeft} days`}`,
          detail: `${c.companyName} · ${c.certNo} · renew it with the Labour Department before ${c.expiresOn}`,
          go: { view: 'fwm' },
        } as HomeItem);
    }
    const ids = await this.svc.visibleCompanyIdsOf(user);
    const recs = await this.recs(ids);
    const today = this.today();
    if (role === 'staff') {
      const raised = recs.filter((r): r is FwAbscondRec => r.kind === 'abscond' && r.status === 'raised');
      if (raised.length)
        out.push({ tone: 'crit', tag: 'Foreign workers', title: `${raised.length} missing worker${raised.length === 1 ? '' : 's'} raised by the OM`, detail: 'Check, then file the police report and the Immigration notice, or close it if found', go: { view: 'fwm' } } as HomeItem);
      const late = recs.filter((r): r is FwExitRec => r.kind === 'exit' && r.status === 'open' && (!r.labour || !r.immigration) && r.reportDue <= addDays(today, 3));
      if (late.length)
        out.push({ tone: late.some((r) => r.reportDue < today) ? 'crit' : 'warn', tag: 'Foreign workers', title: `${late.length} leaver report${late.length === 1 ? '' : 's'} due to Labour and Immigration`, detail: `Nearest due ${late.map((r) => r.reportDue).sort()[0]}`, go: { view: 'fwm' } } as HomeItem);
      const q = recs.filter((r): r is FwQuotaRec => r.kind === 'quota' && r.status === 'approved' && r.used < r.places && !!r.validTo && daysBetween(today, r.validTo) <= Math.max(...RULES.fwmQuota.value.remindDays));
      if (q.length)
        out.push({ tone: q.some((r) => daysBetween(today, r.validTo!) <= 30) ? 'warn' : 'info', tag: 'Foreign workers', title: `${q.length} quota${q.length === 1 ? '' : 's'} with unused places ending soon`, detail: q.slice(0, 3).map((r) => `${r.ref} to ${r.validTo}`).join(', '), go: { view: 'fwm' } } as HomeItem);
    }
    return out;
  }

  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'bulkPreview':
        return this.bulkPreview(user, i);
      case 'bulkSave':
        return this.bulkSave(user, i);
      case 'recordLevy':
        return this.recordLevy(user, i);
      case 'openExit':
        return this.openExit(user, i);
      case 'exitStep':
        return this.exitStep(user, i);
      case 'raiseAbscond':
        return this.raiseAbscond(user, i);
      case 'abscondStep':
        return this.abscondStep(user, i);
      case 'addQuota':
        return this.addQuota(user, i);
      case 'quotaStep':
        return this.quotaStep(user, i);
      case 'setCaseload':
        return this.setCaseload(user, i);
      default:
        throw new BadRequest('Unknown foreign worker action.');
    }
  }
}
export const FW_GAP_READS = ['board', 'bulkPreview'];

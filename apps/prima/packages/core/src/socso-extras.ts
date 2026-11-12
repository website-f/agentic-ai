// E4 SOCSO extras (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A1 / E4). Built on the SOCSO claim of
// 26 Oct and the LINDUNG, dependants and DOSH steps of 5 Nov 2026 (socso.ts), never a second copy of them:
//   1. The LINDUNG 24 Jam claim form: HR prepares it from the claim, a second HR person checks it, then it is printed
//      for the worker to take to PERKESO (or to key into Portal LINDUNG Faedah). The worker still applies himself.
//   2. The company's own money to the dependants of a foreign worker who died (final wages, insurance, ex gratia),
//      paid abroad: HR raises it with the family's bank or embassy letter, the Finance Director or the CEO approves
//      with a reason (never the person who raised it), Finance records the transfer with the bank slip (never the
//      approver), HR records the family's word that it arrived. PERKESO's own payments stay as they are.
//   3. The DOSH notice from the SOCSO case: reminders on Home for what DOSH is still owed and for PERKESO's LINDUNG
//      employment check (rule HR-LINDUNG-VERIFY, 2 working days, approved 11 Nov 2026 as G14); the screens print a
//      filled JKKP 6 / JKKP 7 draft from the case.
// Everything sits in the existing socso_claims JSON record: no new table, no migration.

import { AccessDenied } from './access';
import { finActor } from './finance';
import { hrKeeps } from './hr';
import { doshApplies, doshClock, lindungVerifyClock, emptyLindung, SOCSO_TYPE_LABEL } from './socso';
import type { HomeItem, PrimaService, ProofInput } from './service';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { toMs } from './time';
import type { Id, IsoDate, IsoDateTime, SocsoClaim, User } from './types';

// ---------- Records (inside SocsoClaim.socsoExtras) ----------

export interface SocsoStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

/** What HR fills on the LINDUNG form that the claim does not already hold. */
export interface LindungFormFields {
  /** How the accident happened, in the worker's words. */
  how: string;
  /** The injury and the part of the body. Kept by HR (medical). */
  injury: string;
  /** The clinic or hospital that first treated the worker. */
  treatedAt: string;
  /** The police report number, where there is one. */
  policeReportNo: string;
}

export interface LindungForm {
  fields: LindungFormFields;
  prepared: SocsoStep;
  /** A second HR person checked the form against the papers. Cleared when the form is changed. */
  checked: SocsoStep | null;
  version: number;
}

export type PayAbroadWhat = 'FINAL_WAGES' | 'INSURANCE' | 'EX_GRATIA' | 'OTHER';
export type PayAbroadRoute = 'BANK_ABROAD' | 'REMITTANCE' | 'EMBASSY';
export type PayAbroadStatus = 'waiting' | 'approved' | 'refused' | 'paid' | 'received';

/** The company's own payment to a dependant abroad. PERKESO's payments are SocsoDependantPayment, not this. */
export interface PayAbroad {
  id: Id;
  dependantId: Id;
  what: PayAbroadWhat;
  /** Ringgit the company pays; the bank or agent converts. Typed by HR from the papers, never a set rate. */
  amount: number;
  route: PayAbroadRoute;
  /** Where it goes, as on the family's or embassy's letter: bank, branch and the account's last 4 digits only. */
  payTo: string;
  reason: string;
  /** The family's bank letter, the embassy letter or the insurer's discharge. */
  docIds: Id[];
  status: PayAbroadStatus;
  raised: SocsoStep;
  decided: (SocsoStep & { approve: boolean }) | null;
  paid: (SocsoStep & { on: IsoDate; ref: string; docIds: Id[] }) | null;
  received: (SocsoStep & { on: IsoDate; docIds: Id[] }) | null;
}

export interface SocsoExtras {
  lindungForm?: LindungForm | null;
  payAbroad?: PayAbroad[];
}

export const PAY_ABROAD_WHAT_LABEL: Record<PayAbroadWhat, string> = {
  FINAL_WAGES: 'Final wages and leave pay owed',
  INSURANCE: 'Insurance paid to the company for the family',
  EX_GRATIA: 'Ex gratia payment approved by the company',
  OTHER: 'Other money owed to the family',
};

export const PAY_ABROAD_ROUTE_LABEL: Record<PayAbroadRoute, string> = {
  BANK_ABROAD: "Bank transfer to the dependant's own account abroad",
  REMITTANCE: 'Licensed remittance agent to the dependant',
  EMBASSY: "Through the worker's embassy",
};

export const PAY_ABROAD_STATUS_LABEL: Record<PayAbroadStatus, string> = {
  waiting: 'Waiting for the Finance Director or CEO',
  approved: 'Approved: Finance to pay',
  refused: 'Refused',
  paid: 'Paid: waiting for the family',
  received: 'Received by the family',
};

export const SOCSO_EXTRA_ACTIONS = ['lindung_form', 'lindung_check', 'pay_raise', 'pay_decide', 'pay_paid', 'pay_received'] as const;
export type SocsoExtraAction = (typeof SOCSO_EXTRA_ACTIONS)[number];

// ---------- Pure checks ----------

/** What still stops the LINDUNG form being given to the worker. */
export function lindungFormGaps(c: Pick<SocsoClaim, 'type' | 'place' | 'incidentAt'>, form: LindungForm | null | undefined): string[] {
  const gaps: string[] = [];
  if (c.type !== 'NON_WORK_ACCIDENT') return ['Only for a LINDUNG 24 Jam (non-work accident) claim.'];
  if (!form) return ['Prepare the form.'];
  if (!c.place.trim()) gaps.push('The place of the accident is missing on the claim.');
  if (form.fields.how.length < 10) gaps.push('Say how the accident happened.');
  if (form.fields.injury.length < 3) gaps.push('Give the injury.');
  if (form.fields.treatedAt.length < 3) gaps.push('Give the clinic or hospital.');
  if (!form.checked) gaps.push('A second HR person checks the form.');
  return gaps;
}

/** Who acts next on a payment abroad. */
export function payAbroadNext(p: Pick<PayAbroad, 'status'>): 'approver' | 'finance' | 'hr' | null {
  if (p.status === 'waiting') return 'approver';
  if (p.status === 'approved') return 'finance';
  if (p.status === 'paid') return 'hr';
  return null;
}

/** The Finance Director or the CEO approves the company's money (rule FIN-PAY: Finance payments, any amount). */
export function approvesPayAbroad(user: User): boolean {
  const a = finActor(user);
  return !!a && (a.kind === 'director' || a.kind === 'ceo');
}

/** Finance records the transfer: the Finance Director or a Finance team leader or deputy. */
export function paysPayAbroad(user: User): boolean {
  const a = finActor(user);
  return !!a && (a.kind === 'director' || a.kind === 'leader' || a.kind === 'deputy');
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v: unknown): IsoDate | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const proofs = (v: unknown): ProofInput[] => (Array.isArray(v) ? (v.slice(0, 3) as ProofInput[]) : []);
const step = (user: User, at: IsoDateTime, note = ''): SocsoStep => ({ by: user.name, byId: user.id, at, note });

// ---------- Service ----------

export class SocsoExtrasService {
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

  async act(user: User, action: string, body: Record<string, unknown>): Promise<SocsoClaim> {
    const claimId = text(body.claimId, 80);
    if (!claimId) throw new BadRequest('Choose the claim.');
    switch (action as SocsoExtraAction) {
      case 'lindung_form':
        return this.lindungForm(user, claimId, body);
      case 'lindung_check':
        return this.lindungCheck(user, claimId, text(body.note, 300));
      case 'pay_raise':
        return this.payRaise(user, claimId, body);
      case 'pay_decide':
        return this.payDecide(user, claimId, text(body.paymentId, 80), body.approve === true, text(body.note, 400));
      case 'pay_paid':
        return this.payPaid(user, claimId, text(body.paymentId, 80), body);
      case 'pay_received':
        return this.payReceived(user, claimId, text(body.paymentId, 80), body);
      default:
        throw new BadRequest('Unknown SOCSO step.');
    }
  }

  /** HR prepares (or corrects) the LINDUNG claim form. A change after the check needs the check again. */
  private async lindungForm(user: User, claimId: Id, body: Record<string, unknown>) {
    const { c } = await this.svc.socsoHrClaim(user, claimId, ['NON_WORK_ACCIDENT']);
    if (c.status === 'CLOSED') throw new BadRequest('The claim is closed.');
    const fields: LindungFormFields = {
      how: text(body.how, 600),
      injury: text(body.injury, 200),
      treatedAt: text(body.treatedAt, 120),
      policeReportNo: text(body.policeReportNo, 40),
    };
    if (fields.how.length < 10) throw new BadRequest('Say how the accident happened, in a sentence or two.');
    if (fields.injury.length < 3) throw new BadRequest('Give the injury and the part of the body.');
    if (fields.treatedAt.length < 3) throw new BadRequest('Give the clinic or hospital that treated the worker.');
    const at = this.now();
    return this.svc.socsoSave(
      user,
      c,
      (_ids, f) => {
        const cur = f.socsoExtras?.lindungForm ?? null;
        const form: LindungForm = { fields, prepared: step(user, at), checked: null, version: (cur?.version ?? 0) + 1 };
        return { socsoExtras: { ...(f.socsoExtras ?? {}), lindungForm: form } };
      },
      c.socsoExtras?.lindungForm ? 'LINDUNG claim form corrected; it needs checking again' : 'LINDUNG claim form prepared',
      'lindung.form',
    );
  }

  /** A second HR person checks the form against the papers. Never the person who prepared it. */
  private async lindungCheck(user: User, claimId: Id, note: string) {
    const { c } = await this.svc.socsoHrClaim(user, claimId, ['NON_WORK_ACCIDENT']);
    const form = c.socsoExtras?.lindungForm;
    if (!form) throw new BadRequest('Prepare the form first.');
    if (form.checked) throw new BadRequest('The form is already checked.');
    if (form.prepared.byId === user.id) throw new AccessDenied('hr.pay', '(another HR person checks the form you prepared)');
    if (note.length < 3) throw new BadRequest('Write a comment to check the form. A short one is fine.');
    const at = this.now();
    return this.svc.socsoSave(
      user,
      c,
      (_ids, f) => {
        const cur = f.socsoExtras?.lindungForm;
        if (!cur || cur.version !== form.version) throw new BadRequest('The form changed meanwhile. Open the claim again.');
        if (cur.checked) throw new BadRequest('The form is already checked.');
        return { socsoExtras: { ...(f.socsoExtras ?? {}), lindungForm: { ...cur, checked: step(user, at, note) } } };
      },
      `LINDUNG claim form checked: ${note}`,
      'lindung.form_check',
    );
  }

  /** HR raises the company's own payment to a dependant abroad, with the family's or embassy's letter. */
  private async payRaise(user: User, claimId: Id, body: Record<string, unknown>) {
    const { c } = await this.svc.socsoHrClaim(user, claimId, ['DEATH']);
    if (c.status === 'CLOSED') throw new BadRequest('The claim is closed.');
    const dependantId = text(body.dependantId, 80);
    const who = (c.dependants?.people ?? []).find((p) => p.id === dependantId);
    if (!who) throw new NotFound('Dependant');
    if (who.country.trim().toLowerCase() === 'malaysia') throw new BadRequest('This is for a dependant who lives abroad. Pay a family in Malaysia through the normal payment request.');
    const what = body.what as PayAbroadWhat;
    if (!PAY_ABROAD_WHAT_LABEL[what]) throw new BadRequest('Choose what the money is for.');
    const route = body.route as PayAbroadRoute;
    if (!PAY_ABROAD_ROUTE_LABEL[route]) throw new BadRequest('Choose how the money goes.');
    const amount = typeof body.amount === 'number' ? Math.round(body.amount * 100) / 100 : NaN;
    if (!Number.isFinite(amount) || amount <= 0 || amount >= 10_000_000) throw new BadRequest('Give the amount in ringgit.');
    const payTo = text(body.payTo, 200);
    if (payTo.length < 5) throw new BadRequest('Say where it goes, as on the letter: bank, branch and the last 4 digits of the account.');
    if (/\d{8,}/.test(payTo.replace(/[\s-]/g, ''))) throw new BadRequest('Write only the last 4 digits of the account. The full number stays on the attached letter.');
    const reason = text(body.reason, 400);
    if (reason.length < 5) throw new BadRequest('Say why the company owes this money.');
    const docs = this.svc.socsoProofDocs(user, c, proofs(body.proof), `Payment abroad: ${who.name}`, true);
    const at = this.now();
    return this.svc.socsoSave(
      user,
      c,
      (ids, f) => {
        const list = f.socsoExtras?.payAbroad ?? [];
        if (list.some((p) => p.dependantId === dependantId && p.what === what && (p.status === 'waiting' || p.status === 'approved')))
          throw new BadRequest('A payment of this kind to this dependant is already waiting.');
        const pay: PayAbroad = {
          id: `pab-${toMs(at).toString(36)}-${list.length + 1}`,
          dependantId,
          what,
          amount,
          route,
          payTo,
          reason,
          docIds: ids,
          status: 'waiting',
          raised: step(user, at, reason),
          decided: null,
          paid: null,
          received: null,
        };
        return { socsoExtras: { ...(f.socsoExtras ?? {}), payAbroad: [...list, pay] } };
      },
      `Company payment abroad raised: ${PAY_ABROAD_WHAT_LABEL[what].toLowerCase()} RM${amount.toFixed(2)} to a dependant in ${who.country}`,
      'pay_abroad.raise',
      docs,
    );
  }

  /** The claim and the payment, for a step outside HR: the claim must be in a company the person can see. */
  private async payFor(user: User, claimId: Id, paymentId: Id) {
    const c = await this.store.get('socsoClaims', claimId);
    if (!c) throw new NotFound('SOCSO claim');
    if (!(await this.svc.visibleCompanies(user)).some((x) => x.id === c.companyId)) throw new AccessDenied('view', c.companyId);
    const p = (c.socsoExtras?.payAbroad ?? []).find((x) => x.id === paymentId);
    if (!p) throw new NotFound('Payment');
    return { c, p };
  }

  private static swap(f: SocsoClaim, id: Id, fn: (p: PayAbroad) => PayAbroad): Partial<SocsoClaim> {
    const list = f.socsoExtras?.payAbroad ?? [];
    return { socsoExtras: { ...(f.socsoExtras ?? {}), payAbroad: list.map((p) => (p.id === id ? fn(p) : p)) } };
  }

  /** The Finance Director or the CEO approves or refuses, with a reason; never the person who raised it. */
  private async payDecide(user: User, claimId: Id, paymentId: Id, approve: boolean, note: string) {
    if (!approvesPayAbroad(user)) throw new AccessDenied('view', '(the Finance Director or the CEO approves payments abroad)');
    const { c, p } = await this.payFor(user, claimId, paymentId);
    if (p.raised.byId === user.id) throw new AccessDenied('view', '(nobody approves a payment they raised)');
    if (p.status !== 'waiting') throw new BadRequest('This payment has already been decided.');
    if (note.length < 3) throw new BadRequest(`Write a comment to ${approve ? 'approve' : 'refuse'}. A short one is fine.`);
    const at = this.now();
    return this.svc.socsoSave(
      user,
      c,
      (_ids, f) => {
        const cur = (f.socsoExtras?.payAbroad ?? []).find((x) => x.id === paymentId);
        if (!cur || cur.status !== 'waiting') throw new BadRequest('This payment has already been decided.');
        return SocsoExtrasService.swap(f, paymentId, (x) => ({ ...x, status: approve ? 'approved' : 'refused', decided: { ...step(user, at, note), approve } }));
      },
      `Company payment abroad RM${p.amount.toFixed(2)} ${approve ? 'approved' : 'refused'}: ${note}`,
      approve ? 'pay_abroad.approve' : 'pay_abroad.refuse',
    );
  }

  /** Finance records the transfer with the bank slip; never the person who approved it. */
  private async payPaid(user: User, claimId: Id, paymentId: Id, body: Record<string, unknown>) {
    if (!paysPayAbroad(user)) throw new AccessDenied('view', '(Finance records the transfer)');
    const { c, p } = await this.payFor(user, claimId, paymentId);
    if (p.status !== 'approved') throw new BadRequest('Only an approved payment is paid.');
    if (p.decided?.byId === user.id) throw new AccessDenied('view', '(the person who approved it does not also pay it)');
    if (p.raised.byId === user.id) throw new AccessDenied('view', '(the person who raised it does not also pay it)');
    const on = day(body.on);
    if (!on || on > this.today() || on < p.decided!.at.slice(0, 10)) throw new BadRequest('Give the date the money was sent, on or after the approval.');
    const ref = text(body.ref, 60);
    if (ref.length < 3) throw new BadRequest("Give the bank's or agent's transfer reference.");
    const docs = this.svc.socsoProofDocs(user, c, proofs(body.proof), `Transfer ${ref}`, true);
    const at = this.now();
    return this.svc.socsoSave(
      user,
      c,
      (ids, f) => {
        const cur = (f.socsoExtras?.payAbroad ?? []).find((x) => x.id === paymentId);
        if (!cur || cur.status !== 'approved') throw new BadRequest('Only an approved payment is paid.');
        return SocsoExtrasService.swap(f, paymentId, (x) => ({ ...x, status: 'paid', paid: { ...step(user, at), on, ref, docIds: ids } }));
      },
      `Company payment abroad RM${p.amount.toFixed(2)} sent on ${on}, ref ${ref}`,
      'pay_abroad.paid',
      docs,
    );
  }

  /** HR records the family's word that the money arrived. */
  private async payReceived(user: User, claimId: Id, paymentId: Id, body: Record<string, unknown>) {
    const { c } = await this.svc.socsoHrClaim(user, claimId, ['DEATH']);
    const p = (c.socsoExtras?.payAbroad ?? []).find((x) => x.id === paymentId);
    if (!p) throw new NotFound('Payment');
    if (p.status !== 'paid') throw new BadRequest('Record the transfer first.');
    const on = day(body.on);
    if (!on || on > this.today() || on < p.paid!.on) throw new BadRequest('Give the date the family received it, on or after the transfer.');
    const docs = this.svc.socsoProofDocs(user, c, proofs(body.proof), `Received abroad: ${p.paid!.ref}`, true);
    const at = this.now();
    return this.svc.socsoSave(
      user,
      c,
      (ids, f) => {
        const cur = (f.socsoExtras?.payAbroad ?? []).find((x) => x.id === paymentId);
        if (!cur || cur.status !== 'paid') throw new BadRequest('Already confirmed.');
        return SocsoExtrasService.swap(f, paymentId, (x) => ({ ...x, status: 'received', received: { ...step(user, at), on, docIds: ids } }));
      },
      `Family confirmed the company payment ${p.paid!.ref} arrived on ${on}`,
      'pay_abroad.received',
      docs,
    );
  }

  /**
   * The payments abroad a Finance Director, the CEO or Finance acts on (no medical papers, no family papers): who, how
   * much, why and where it stands. HR sees them on the claim itself.
   */
  async board(user: User) {
    const approver = approvesPayAbroad(user);
    const payer = paysPayAbroad(user);
    if (!approver && !payer) throw new AccessDenied('view', '(payments to dependants abroad)');
    const companies = await this.svc.visibleCompanies(user);
    const ids = companies.map((x) => x.id);
    const claims = (await this.store.list('socsoClaims', { companyId: ids })).filter((c) => (c.socsoExtras?.payAbroad ?? []).length > 0);
    const people = claims.length ? await this.store.list('people', { id: [...new Set(claims.map((c) => c.personId))] }) : [];
    const rows = claims.flatMap((c) =>
      (c.socsoExtras?.payAbroad ?? []).map((p) => {
        const dep = (c.dependants?.people ?? []).find((d) => d.id === p.dependantId);
        const worker = people.find((x) => x.id === c.personId);
        return {
          claimId: c.id,
          companyName: companies.find((x) => x.id === c.companyId)?.name ?? c.companyId,
          worker: worker ? { name: worker.name, staffNo: worker.staffNo } : null,
          dependant: dep ? { name: dep.name, relation: dep.relation, country: dep.country } : null,
          payment: { ...p, docIds: [] as Id[] },
          whatLabel: PAY_ABROAD_WHAT_LABEL[p.what],
          routeLabel: PAY_ABROAD_ROUTE_LABEL[p.route],
          statusLabel: PAY_ABROAD_STATUS_LABEL[p.status],
          canDecide: approver && p.status === 'waiting' && p.raised.byId !== user.id,
          canPay: payer && p.status === 'approved' && p.decided?.byId !== user.id && p.raised.byId !== user.id,
        };
      }),
    );
    const order: Record<PayAbroadStatus, number> = { waiting: 0, approved: 1, paid: 2, refused: 3, received: 4 };
    rows.sort((a, b) => order[a.payment.status] - order[b.payment.status] || a.payment.raised.at.localeCompare(b.payment.raised.at));
    return { rows, canDecide: approver, canPay: payer };
  }

  /**
   * Reminders on Home: what the person themselves must do next on SOCSO extras. HR: LINDUNG check due (2 working days,
   * rule HR-LINDUNG-VERIFY), DOSH still owed, a LINDUNG form to check, money abroad to confirm. Finance Director and CEO:
   * payments to approve. Finance: approved payments to send.
   */
  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration || user.role === 'guard' || user.role === 'site_device') return [];
    const approver = approvesPayAbroad(user);
    const payer = paysPayAbroad(user);
    const hrish = hrKeeps(user) || user.role === 'company_manager' || user.role === 'admin_exec';
    if (!approver && !payer && !hrish) return [];
    const companies = await this.svc.visibleCompanies(user);
    if (!companies.length) return [];
    const claims = (await this.store.list('socsoClaims', { companyId: companies.map((x) => x.id) })).filter((c) => c.status !== 'CLOSED' || (c.socsoExtras?.payAbroad ?? []).length);
    const today = this.today();
    const out: HomeItem[] = [];
    const go = (c: SocsoClaim) => ({ view: 'socso' as const, companyId: c.companyId });
    for (const c of claims) {
      for (const p of c.socsoExtras?.payAbroad ?? []) {
        if (approver && p.status === 'waiting' && p.raised.byId !== user.id)
          out.push({ tone: 'warn', tag: 'Approve', title: `Payment abroad to a dependant: RM${p.amount.toFixed(2)}`, detail: `${PAY_ABROAD_WHAT_LABEL[p.what]} · raised by ${p.raised.by}`, go: { view: 'payreq' } });
        if (payer && p.status === 'approved' && p.decided?.byId !== user.id && p.raised.byId !== user.id)
          out.push({ tone: 'warn', tag: 'Finance', title: `Send the approved payment abroad: RM${p.amount.toFixed(2)}`, detail: `${PAY_ABROAD_ROUTE_LABEL[p.route]} · approved by ${p.decided?.by ?? ''}`, go: { view: 'payreq' } });
      }
    }
    if (!hrish) return out;
    for (const c of claims) {
      if (c.status === 'CLOSED') continue;
      let manage = false;
      try {
        await this.svc.socsoHrClaim(user, c.id);
        manage = true;
      } catch {
        manage = false;
      }
      if (!manage) continue;
      if (c.type === 'NON_WORK_ACCIDENT') {
        const clock = lindungVerifyClock(c.lindung ?? emptyLindung(), today);
        if (clock)
          out.push({ tone: clock.overdue ? 'crit' : 'warn', tag: 'SOCSO', title: `Answer PERKESO's LINDUNG employment check by ${clock.due}`, detail: `${SOCSO_TYPE_LABEL[c.type]} · claim ${c.id}`, go: go(c) });
        const form = c.socsoExtras?.lindungForm;
        if (form && !form.checked && form.prepared.byId !== user.id)
          out.push({ tone: 'info', tag: 'SOCSO', title: 'Check the LINDUNG claim form', detail: `Prepared by ${form.prepared.by} · claim ${c.id}`, go: go(c) });
      }
      if (doshApplies(c.type) && c.dosh) {
        const k = doshClock(c.dosh, today);
        if (k.owed.length)
          out.push({ tone: k.overdue || (k.immediateNeeded && !k.immediateDone) ? 'crit' : 'warn', tag: 'DOSH', title: `${k.owed.join('; ')}${k.formDue ? ` (due ${k.formDue})` : ''}`, detail: `${SOCSO_TYPE_LABEL[c.type]} · claim ${c.id}`, go: go(c) });
      } else if (doshApplies(c.type) && !c.dosh)
        out.push({ tone: 'warn', tag: 'DOSH', title: 'Decide what DOSH needs for this accident', detail: `${SOCSO_TYPE_LABEL[c.type]} · claim ${c.id}`, go: go(c) });
      for (const p of c.socsoExtras?.payAbroad ?? [])
        if (p.status === 'paid') out.push({ tone: 'info', tag: 'SOCSO', title: 'Confirm the family received the payment abroad', detail: `RM${p.amount.toFixed(2)} sent ${p.paid!.on}, ref ${p.paid!.ref}`, go: go(c) });
    }
    return out;
  }
}

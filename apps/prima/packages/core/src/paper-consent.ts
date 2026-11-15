import { AccessDenied, pdpaRole } from "./access";
import { BadRequest, NotFound } from "./service";
import type { Store } from "./store";
import type { Id, IsoDate, IsoDateTime, PdpaConsent, User } from "./types";

/**
 * Part N18 (Fauzan, 14 Nov 2026: "Yes start now. Pdpa will collect written not in system."): the PDPA officer collects
 * each person's signed privacy notice and consent on paper. Prima keeps only a small record in the consent register
 * (person, what was consented to, date signed, paper reference, who entered it); no form, no e-signature, no scan.
 *
 * Face sign-in and location (guard phone trial sites, staff clock location) are switched on for a person only when such
 * a record exists, and a recorded withdrawal switches them off. Because the consent register sits behind the PDPA wall,
 * each record also sets a one-line gate per person and scope (no name, no paper reference) that the person's own
 * company can read, so the sign-in check works under the database walls.
 *
 * The gate is a switch the PDPA officer or the Chief of Staff turns on, with a reason, once the paper round has started
 * (Fauzan, "No skipping. We run also"): until then face and location behave as before.
 */
export type ConsentScope = 'face' | 'location';
export const PAPER_CONSENT_REGISTER: Record<ConsentScope, Id> = { face: 'paper-face', location: 'paper-location' };

export interface ConsentGate {
  /** `${personId}.${scope}`, or 'switch' for the one on/off row. */
  id: Id;
  personId: Id | null;
  companyId: Id | null;
  scope: ConsentScope | null;
  on: boolean;
  consentId: Id | null;
  by: string;
  at: IsoDateTime;
  reason?: string;
  history?: { at: IsoDateTime; by: string; what: string }[];
}

export class PaperConsentService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
    private today: () => IsoDate,
  ) {}

  private async installed() {
    return !this.store.hasTable || (await this.store.hasTable('consentGates'));
  }

  /** Whether the paper consent gate is switched on. Off (current behaviour) until the PDPA officer or the CoS turns it on. */
  async gateOn(): Promise<boolean> {
    if (!(await this.installed())) return false;
    return (await this.store.get('consentGates', 'switch'))?.on === true;
  }

  /** Face or location is allowed for this person: always while the gate is off; with it on, only with a live paper consent. */
  async allowed(personId: Id | null | undefined, scope: ConsentScope): Promise<boolean> {
    if (!(await this.gateOn())) return true;
    if (!personId) return false;
    return (await this.store.get('consentGates', `${personId}.${scope}`))?.on === true;
  }

  static message(scope: ConsentScope) {
    return scope === 'face'
      ? 'Face sign-in needs your signed PDPA consent on paper. Ask the PDPA officer or your office.'
      : 'Location needs your signed PDPA consent on paper. Ask the PDPA officer or your office.';
  }

  private officer(user: User) {
    if (pdpaRole(user) !== 'officer') throw new AccessDenied('view', '(only the PDPA officer records paper consent)');
  }

  /** The PDPA officer or the Chief of Staff switches the gate on or off, with a reason. */
  async setGate(user: User, on: boolean, reason: string) {
    if (pdpaRole(user) !== 'officer' && !(!user.integration && user.leadership === 'cos')) throw new AccessDenied('view', '(the PDPA officer or the Chief of Staff)');
    const why = String(reason ?? '').trim().slice(0, 300);
    if (why.length < 3) throw new BadRequest('Give the reason for the change.');
    if (!(await this.installed())) throw new BadRequest('Paper consent is not installed in this database yet (module paper-consent-v1, run by the CEO).');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('consentGates', 'switch');
      const cur = await tx.get('consentGates', 'switch');
      if ((cur?.on ?? false) === on) throw new BadRequest('Nothing changed.');
      const what = `Paper consent gate switched ${on ? 'on' : 'off'}: ${why}`;
      const row: ConsentGate = { id: 'switch', personId: null, companyId: null, scope: null, on, consentId: null, by: user.name, at, reason: why, history: [...(cur?.history ?? []), { at, by: user.name, what }].slice(-50) };
      if (cur) {
        const { id: _id, ...patch } = row;
        await tx.update('consentGates', 'switch', patch);
      } else await tx.insert('consentGates', row);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'pdpa.consent_gate', entity: 'consent_gate', entityId: 'switch', summary: what });
      return row;
    });
  }

  /** Record a paper consent: person, face, location or both, date signed and the paper reference. No scan is needed. */
  async record(user: User, input: { personId?: unknown; staffNo?: unknown; scope?: unknown; signedOn?: unknown; paperRef?: unknown; noticeVersion?: unknown }) {
    this.officer(user);
    if (!(await this.installed())) throw new BadRequest('Paper consent is not installed in this database yet (module paper-consent-v1, run by the CEO).');
    const personId = String(input.personId ?? '').trim().slice(0, 80);
    const staffNo = String(input.staffNo ?? '').trim().toLowerCase().slice(0, 40);
    const p = personId ? await this.store.get('people', personId) : staffNo ? ((await this.store.list('people', {})).find((x) => x.staffNo.toLowerCase() === staffNo) ?? null) : null;
    if (!p) throw new NotFound('Person');
    const scopes: ConsentScope[] = input.scope === 'both' ? ['face', 'location'] : input.scope === 'face' || input.scope === 'location' ? [input.scope] : [];
    if (!scopes.length) throw new BadRequest('Say what was consented to: face, location or both.');
    const signedOn = String(input.signedOn ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(signedOn) || signedOn > this.today()) throw new BadRequest('Give the date signed, not in the future.');
    const paperRef = String(input.paperRef ?? '').trim().slice(0, 60);
    if (paperRef.length < 2) throw new BadRequest('Give the paper reference number.');
    const noticeVersion = String(input.noticeVersion ?? '').trim().slice(0, 40) || 'paper';
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const out: PdpaConsent[] = [];
      for (const scope of scopes) {
        const registerId = PAPER_CONSENT_REGISTER[scope];
        await tx.lock?.('consentGates', `${p.id}.${scope}`);
        const live = (await tx.list('pdpaConsents', { registerId })).some((c) => !c.withdrawn && c.subjectRef.toLowerCase() === p.staffNo.toLowerCase());
        if (live) throw new BadRequest(`This person already has a live ${scope} consent.`);
        const row: PdpaConsent = {
          id: `pdc-paper-${scope}-${p.id}-${Date.parse(at).toString(36)}`,
          registerId,
          companyId: p.companyId,
          subjectName: p.name,
          subjectRef: p.staffNo,
          subjectKind: p.role === 'office' ? 'staff' : 'guard',
          noticeVersion,
          givenOn: signedOn,
          docId: null,
          recordedBy: user.name,
          recordedAt: at,
          withdrawn: null,
          personId: p.id,
          scope,
          paperRef,
        };
        await tx.insert('pdpaConsents', row);
        const gate: ConsentGate = { id: `${p.id}.${scope}`, personId: p.id, companyId: p.companyId, scope, on: true, consentId: row.id, by: user.name, at };
        if (await tx.get('consentGates', gate.id)) {
          const { id: _id, ...patch } = gate;
          await tx.update('consentGates', gate.id, patch);
        } else await tx.insert('consentGates', gate);
        out.push(row);
      }
      await tx.audit({ at, actor: user.name, companyId: p.companyId, action: 'pdpa.paper_consent.record', entity: 'person', entityId: p.id, summary: `Paper consent (${scopes.join(' and ')}) recorded for ${p.staffNo}, ref ${paperRef}, signed ${signedOn}.` });
      return out;
    });
  }

  /** A recorded withdrawal switches face or location off for that person; the consent stays on the register as history. */
  async withdraw(user: User, consentId: Id, on: IsoDate, note: string) {
    this.officer(user);
    const text = String(note ?? '').trim().slice(0, 300);
    if (text.length < 3) throw new BadRequest('Say how the person withdrew (letter, form) and what stops now.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(on ?? '') || on > this.today()) throw new BadRequest('Give the date withdrawn, not in the future.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('pdpaConsents', consentId);
      const c = await tx.get('pdpaConsents', consentId);
      if (!c || !c.scope || !c.personId) throw new NotFound('Paper consent');
      if (c.withdrawn) throw new BadRequest('This consent is already withdrawn.');
      if (on < c.givenOn) throw new BadRequest('Withdrawal cannot be before the consent was given.');
      const saved = await tx.update('pdpaConsents', consentId, { withdrawn: { on, note: text, by: user.name, at } });
      const gid = `${c.personId}.${c.scope}`;
      if (await tx.get('consentGates', gid)) await tx.update('consentGates', gid, { on: false, consentId, by: user.name, at });
      await tx.audit({ at, actor: user.name, companyId: c.companyId, action: 'pdpa.paper_consent.withdraw', entity: 'person', entityId: c.personId, summary: `Paper consent (${c.scope}) withdrawn by ${c.subjectRef} on ${on}; ${c.scope} stops now.` });
      return saved;
    });
  }

  /** The PDPA officer's list: the switch and every paper consent, live or withdrawn. */
  async board(user: User) {
    const role = pdpaRole(user);
    if (!role && !(!user.integration && user.leadership === 'cos')) throw new AccessDenied('view', '(PDPA)');
    const installed = await this.installed();
    const sw = installed ? await this.store.get('consentGates', 'switch') : null;
    const ids = Object.values(PAPER_CONSENT_REGISTER);
    const consents = role ? (await this.store.list('pdpaConsents', {})).filter((c) => ids.includes(c.registerId)) : [];
    return {
      installed,
      gateOn: sw?.on === true,
      switchHistory: sw?.history ?? [],
      canRecord: role === 'officer',
      canSwitch: role === 'officer' || user.leadership === 'cos',
      consents: consents.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt)),
    };
  }
}

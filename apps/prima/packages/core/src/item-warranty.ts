// J2 Equipment warranty claims (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A8 / J2). Insurance claims cover
// policies only (docs/INSURANCE_CLAIMS.md "Not done": no warranty claims for equipment). This adds the warranty claim
// to the supplier on an item of the P98 items register, never a second item list:
//   1. raise    the store, IT or the company manager of the item's owner raises it: the supplier, the fault, the
//               warranty end date and the warranty card or invoice as proof. Refused for an item that is lost or
//               disposed, out of warranty on the day the fault was found, or with a claim already open.
//   2. approve  the company manager (or, for the Goodwill and head-office stores, the Procurement executive) approves
//               sending it, or refuses, with a reason; never the person who raised it.
//   3. sent     the item handed to the supplier: date, the supplier's claim reference, the hand-over proof.
//   4. outcome  repaired, replaced (with the new serial) or refused by the supplier (with their reason), with the
//               supplier's report or letter as proof.
//   5. close    the company manager checks the outcome and closes it with a comment; never the person who recorded the
//               outcome. A refused claim can go to Finance from the item's own write-off steps.
// The item's place and state still move only through the items register's own steps (send and receive).
// Table prima.item_warranty_claims (db/modules/item-warranty-v1.sql, needs the item register module): approved to
// build, not yet to install.

import { AccessDenied } from './access';
import { RULES } from './rules';
import type { ItemRole } from './item-service';
import type { HomeItem, PrimaService, ProofInput } from './service';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { toMs } from './time';
import type { EvidenceDoc, Id, IsoDate, IsoDateTime, User } from './types';

export type WarrantyStatus = 'raised' | 'approved' | 'refused' | 'sent' | 'outcome' | 'closed';
export type WarrantyOutcome = 'repaired' | 'replaced' | 'refused_by_supplier';

export interface WarrantyStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

export interface WarrantyClaim {
  id: Id;
  ref: string;
  /** The item's owner (the company that holds the warranty). */
  companyId: Id;
  itemId: Id;
  itemLabel: string;
  serial: string | null;
  supplier: string;
  fault: string;
  faultOn: IsoDate;
  warrantyTo: IsoDate;
  status: WarrantyStatus;
  docIds: Id[];
  raised: WarrantyStep;
  decided: (WarrantyStep & { approve: boolean }) | null;
  sent: (WarrantyStep & { on: IsoDate; supplierRef: string; docIds: Id[] }) | null;
  outcome: (WarrantyStep & { result: WarrantyOutcome; on: IsoDate; newSerial: string | null; reason: string; docIds: Id[] }) | null;
  closed: WarrantyStep | null;
  history: WarrantyStep[];
}

export const WARRANTY_STATUS_LABEL: Record<WarrantyStatus, string> = {
  raised: 'Waiting for approval to send',
  approved: 'Approved: send to the supplier',
  refused: 'Not sent',
  sent: 'With the supplier',
  outcome: 'Back: waiting to be closed',
  closed: 'Closed',
};

export const WARRANTY_OUTCOME_LABEL: Record<WarrantyOutcome, string> = {
  repaired: 'Repaired under warranty',
  replaced: 'Replaced by the supplier',
  refused_by_supplier: 'Refused by the supplier',
};

export const WARRANTY_ACTIONS = ['raise', 'decide', 'sent', 'outcome', 'close'] as const;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v: unknown): IsoDate | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const proofs = (v: unknown): ProofInput[] => (Array.isArray(v) ? (v.slice(0, 3) as ProofInput[]) : []);
const step = (user: User, at: IsoDateTime, note = ''): WarrantyStep => ({ by: user.name, byId: user.id, at, note });

export class WarrantyService {
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
    if (!this.store.hasTable) return true;
    return (await this.store.hasTable('itemWarrantyClaims')) && (await this.store.hasTable('physicalItems'));
  }
  private async roles(user: User, partyId: Id): Promise<ItemRole[]> {
    return (await this.svc.items.rolesFor(user)).get(partyId) ?? [];
  }
  private async may(user: User, partyId: Id, ...rs: ItemRole[]) {
    return (await this.roles(user, partyId)).some((r) => rs.includes(r));
  }

  async act(user: User, action: string, body: Record<string, unknown>): Promise<WarrantyClaim> {
    if (!(await this.ready())) throw new BadRequest('Warranty claims are not switched on yet. The database part waits for the CEO to install it.');
    switch (action) {
      case 'raise':
        return this.raise(user, body);
      case 'decide':
        return this.decide(user, text(body.id, 120), body.approve === true, text(body.note, 400));
      case 'sent':
        return this.sentStep(user, text(body.id, 120), body);
      case 'outcome':
        return this.outcomeStep(user, text(body.id, 120), body);
      case 'close':
        return this.close(user, text(body.id, 120), text(body.note, 400));
      default:
        throw new BadRequest('Unknown warranty step.');
    }
  }

  private async raise(user: User, body: Record<string, unknown>) {
    const item = await this.store.get('physicalItems', text(body.itemId, 120));
    if (!item) throw new NotFound('Item');
    if (!(await this.may(user, item.ownerPartyId, 'store', 'manager', 'it'))) throw new AccessDenied('view', '(the store, IT or the company manager of the item’s owner raises a warranty claim)');
    if (item.state === 'lost' || item.state === 'disposed' || item.retiredAt) throw new BadRequest('This item is lost or disposed; there is nothing to send back.');
    const supplier = text(body.supplier, 160);
    const fault = text(body.fault, 600);
    if (supplier.length < 3) throw new BadRequest('Give the supplier who gave the warranty.');
    if (fault.length < 10) throw new BadRequest('Describe the fault in a sentence.');
    const today = this.today();
    const faultOn = day(body.faultOn) ?? today;
    if (faultOn > today) throw new BadRequest('The fault date cannot be in the future.');
    let warrantyTo = day(body.warrantyTo);
    if (!warrantyTo && item.itAssetId) warrantyTo = (await this.store.get('itAssets', item.itAssetId))?.warrantyTo ?? null;
    if (!warrantyTo) throw new BadRequest('Give the warranty end date from the warranty card or invoice.');
    if (warrantyTo < faultOn) throw new BadRequest(`The warranty ended on ${warrantyTo}, before the fault was found. This is a repair, not a warranty claim.`);
    const docs = this.svc.paperDocs(user, item.ownerPartyId, proofs(body.proof), `Warranty card or invoice: ${item.token}`);
    if (!docs.length) throw new BadRequest('Attach the warranty card or the invoice.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const open = (await tx.list('itemWarrantyClaims', { companyId: item.ownerPartyId })).find((c) => c.itemId === item.id && c.status !== 'closed' && c.status !== 'refused');
      if (open) throw new BadRequest(`A warranty claim is already open for this item (${open.ref}).`);
      const ids = await this.svc.savePaperDocs(tx, docs);
      const sku = await tx.get('itemSkus', item.skuId);
      const claim: WarrantyClaim = {
        id: `wc-${toMs(at).toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        ref: `WC-${today.replace(/-/g, '').slice(2)}-${item.token.slice(-4)}`,
        companyId: item.ownerPartyId,
        itemId: item.id,
        itemLabel: `${sku?.name ?? 'Item'} · ${item.token}`,
        serial: item.serial,
        supplier,
        fault,
        faultOn,
        warrantyTo,
        status: 'raised',
        docIds: ids,
        raised: step(user, at, fault),
        decided: null,
        sent: null,
        outcome: null,
        closed: null,
        history: [step(user, at, `Raised to ${supplier}: ${fault}`)],
      };
      await tx.insert('itemWarrantyClaims', claim);
      await tx.audit({ at, actor: user.name, companyId: claim.companyId, action: 'item.warranty_raise', entity: 'item_warranty_claim', entityId: claim.id, summary: `${claim.ref} ${claim.itemLabel} to ${supplier}, warranty to ${warrantyTo}` });
      return claim;
    });
  }

  private async load(user: User, id: Id) {
    const c = await this.store.get('itemWarrantyClaims', id);
    if (!c) throw new NotFound('Warranty claim');
    if (!(await this.roles(user, c.companyId)).length) throw new AccessDenied('view', c.companyId);
    return c;
  }

  private async save(user: User, c: WarrantyClaim, what: string, action: string, docs: EvidenceDoc[], patch: (ids: Id[]) => Partial<WarrantyClaim>) {
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('itemWarrantyClaims', c.id);
      const cur = await tx.get('itemWarrantyClaims', c.id);
      if (!cur || cur.status !== c.status) throw new BadRequest('The claim changed meanwhile. Open it again.');
      const ids = docs.length ? await this.svc.savePaperDocs(tx, docs) : [];
      const out = await tx.update('itemWarrantyClaims', c.id, { ...patch(ids), history: [...cur.history, step(user, at, what)] });
      await tx.audit({ at, actor: user.name, companyId: c.companyId, action: `item.warranty_${action}`, entity: 'item_warranty_claim', entityId: c.id, summary: `${c.ref}: ${what}` });
      return out;
    });
  }

  /** The company manager (the Procurement executive for the Goodwill and head-office stores) approves or refuses sending it. */
  private async decide(user: User, id: Id, approve: boolean, note: string) {
    const c = await this.load(user, id);
    if (!(await this.may(user, c.companyId, 'manager'))) throw new AccessDenied('view', '(the company manager approves sending an item under warranty)');
    if (c.raised.byId === user.id) throw new AccessDenied('view', '(nobody approves a claim they raised)');
    if (c.status !== 'raised') throw new BadRequest('This claim has already been decided.');
    if (note.length < 3) throw new BadRequest(`Write a comment to ${approve ? 'approve' : 'refuse'}. A short one is fine.`);
    return this.save(user, c, `${approve ? 'Approved to send' : 'Not sent'}: ${note}`, approve ? 'approve' : 'refuse', [], () => ({ status: approve ? 'approved' : 'refused', decided: { ...step(user, this.now(), note), approve } }));
  }

  private async sentStep(user: User, id: Id, body: Record<string, unknown>) {
    const c = await this.load(user, id);
    if (!(await this.may(user, c.companyId, 'store', 'manager', 'it'))) throw new AccessDenied('view', '(the store, IT or the company manager sends it)');
    if (c.status !== 'approved') throw new BadRequest('Only an approved claim is sent to the supplier.');
    const on = day(body.on);
    if (!on || on > this.today() || on < c.decided!.at.slice(0, 10)) throw new BadRequest('Give the day it was handed to the supplier, on or after the approval.');
    const supplierRef = text(body.supplierRef, 60);
    if (supplierRef.length < 3) throw new BadRequest("Give the supplier's claim or job reference.");
    const docs = this.svc.paperDocs(user, c.companyId, proofs(body.proof), `Handed to ${c.supplier}: ${c.ref}`);
    if (!docs.length) throw new BadRequest('Attach the hand-over note or the courier slip.');
    return this.save(user, c, `Handed to ${c.supplier} on ${on}, their ref ${supplierRef}`, 'sent', docs, (ids) => ({ status: 'sent', sent: { ...step(user, this.now()), on, supplierRef, docIds: ids } }));
  }

  private async outcomeStep(user: User, id: Id, body: Record<string, unknown>) {
    const c = await this.load(user, id);
    if (!(await this.may(user, c.companyId, 'store', 'manager', 'it'))) throw new AccessDenied('view', '(the store, IT or the company manager records what the supplier did)');
    if (c.status !== 'sent') throw new BadRequest('Record the outcome when the supplier has the item.');
    const result = body.result as WarrantyOutcome;
    if (!WARRANTY_OUTCOME_LABEL[result]) throw new BadRequest('Choose what the supplier did.');
    const on = day(body.on);
    if (!on || on > this.today() || on < c.sent!.on) throw new BadRequest('Give the day the supplier answered, on or after it was sent.');
    const newSerial = result === 'replaced' ? text(body.newSerial, 80) : '';
    if (result === 'replaced' && newSerial.length < 2) throw new BadRequest('Give the serial of the replacement.');
    const reason = text(body.reason, 400);
    if (result === 'refused_by_supplier' && reason.length < 5) throw new BadRequest("Give the supplier's reason for refusing.");
    const docs = this.svc.paperDocs(user, c.companyId, proofs(body.proof), `Supplier's answer: ${c.ref}`);
    if (!docs.length) throw new BadRequest("Attach the supplier's service report or letter.");
    return this.save(user, c, `${WARRANTY_OUTCOME_LABEL[result]} on ${on}${newSerial ? `, new serial ${newSerial}` : ''}${reason ? `: ${reason}` : ''}`, 'outcome', docs, (ids) => ({
      status: 'outcome',
      outcome: { ...step(user, this.now()), result, on, newSerial: newSerial || null, reason, docIds: ids },
    }));
  }

  private async close(user: User, id: Id, note: string) {
    const c = await this.load(user, id);
    if (!(await this.may(user, c.companyId, 'manager'))) throw new AccessDenied('view', '(the company manager closes a warranty claim)');
    if (c.status !== 'outcome') throw new BadRequest('Close the claim when the outcome is recorded.');
    if (c.outcome!.byId === user.id) throw new AccessDenied('view', '(the person who recorded the outcome does not also close it)');
    if (note.length < 3) throw new BadRequest('Write a comment to close. A short one is fine.');
    return this.save(user, c, `Closed: ${note}`, 'close', [], () => ({ status: 'closed', closed: step(user, this.now(), note) }));
  }

  /** Warranty claims of the companies whose items this person works, with the next step for them. */
  async board(user: User) {
    if (!(await this.ready())) return { ready: false as const, rows: [], canRaise: false, items: [] };
    const roles = await this.svc.items.rolesFor(user);
    const parties = [...roles.keys()];
    const may = (p: Id, ...rs: ItemRole[]) => (roles.get(p) ?? []).some((r) => rs.includes(r));
    const claims = parties.length ? (await this.store.list('itemWarrantyClaims', { companyId: parties })).sort((a, b) => b.raised.at.localeCompare(a.raised.at)) : [];
    const today = this.today();
    const makers = parties.filter((p) => may(p, 'store', 'manager', 'it'));
    const items = makers.length ? (await this.store.list('physicalItems', {})).filter((i) => makers.includes(i.ownerPartyId) && i.state !== 'lost' && i.state !== 'disposed' && !i.retiredAt) : [];
    const skus = items.length ? await this.store.list('itemSkus', {}) : [];
    return {
      ready: true as const,
      canRaise: makers.length > 0,
      items: items.slice(0, 2000).map((i) => ({ id: i.id, token: i.token, serial: i.serial, name: skus.find((s) => s.id === i.skuId)?.name ?? 'Item', ownerPartyId: i.ownerPartyId })),
      rows: claims.map((c) => ({
        claim: c,
        statusLabel: WARRANTY_STATUS_LABEL[c.status],
        daysWithSupplier: c.status === 'sent' && c.sent ? Math.max(0, Math.round((toMs(`${today}T00:00:00+08:00`) - toMs(`${c.sent.on}T00:00:00+08:00`)) / 86_400_000)) : null,
        canDecide: may(c.companyId, 'manager') && c.status === 'raised' && c.raised.byId !== user.id,
        canSend: may(c.companyId, 'store', 'manager', 'it') && c.status === 'approved',
        canOutcome: may(c.companyId, 'store', 'manager', 'it') && c.status === 'sent',
        canClose: may(c.companyId, 'manager') && c.status === 'outcome' && c.outcome?.byId !== user.id,
      })),
      // Claims with the supplier longer than this show as waiting long (a reminder; no time limit is set by rule).
      longDays: RULES.warrantyClaims.value.supplierReminderDays,
    };
  }

  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration || user.role === 'guard' || user.role === 'site_device') return [];
    const b = await this.board(user).catch(() => null);
    if (!b || !b.ready) return [];
    const out: HomeItem[] = [];
    const go = { view: 'items' as const };
    const decide = b.rows.filter((r) => r.canDecide || r.canClose);
    if (decide.length) out.push({ tone: 'warn', tag: 'Items', title: `${decide.length} warranty claim(s) to approve or close`, detail: decide.slice(0, 3).map((r) => r.claim.ref).join(', '), go });
    const send = b.rows.filter((r) => r.canSend);
    if (send.length) out.push({ tone: 'info', tag: 'Items', title: `${send.length} warranty claim(s) approved: send to the supplier`, detail: send.slice(0, 3).map((r) => `${r.claim.ref} to ${r.claim.supplier}`).join(', '), go });
    const long = b.rows.filter((r) => r.canOutcome && (r.daysWithSupplier ?? 0) > b.longDays);
    if (long.length) out.push({ tone: 'warn', tag: 'Items', title: `${long.length} item(s) with the supplier over ${b.longDays} days`, detail: long.slice(0, 3).map((r) => `${r.claim.ref} since ${r.claim.sent?.on ?? ''}`).join(', '), go });

    return out;
  }
}

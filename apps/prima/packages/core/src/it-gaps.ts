import type { AccountRequest } from './accounts-access';
import type { ItPolicyRec } from './it-policy-service';
import type { Store } from './store';
import type { Id, IsoDate, IsoDateTime, ItAsset, ItOnboarding, ItRentalBill, User } from './types';

/**
 * IT department gaps (Fauzan, 23 Nov 2026: "Do the gap", study "IT department in Prima: how it works and the gaps").
 *
 * B1  A leaver is handed to IT: when HR closes a leaver's Prima access, IT sees the person, the devices they still hold
 *     and whether the leaver checklist is started and finished. Never automatic: IT starts the checklist (the database
 *     lets only IT write the checklist) and records each step with evidence.
 * D1  One door for a new joiner: an approved new account in Accounts and Access shows on IT's "From HR" list, opens the
 *     joining checklist from there, and counts as the Microsoft 365 approval (the HR Director or the CEO already approved).
 * B3  A company manager sees the IT devices their company rents from Merdeka and the monthly bills, own company only.
 */

/** How far back IT is shown leavers and new joiners from HR. */
export const IT_FROM_HR_DAYS = 120;

export interface ItFromHrRow {
  kind: 'join' | 'leave';
  userId: Id;
  name: string;
  title: string;
  /** Joiner: the day the account was approved. Leaver: the day access closed. */
  on: IsoDate;
  /** Joiner: who approved it in Accounts and Access. */
  approvedBy: string | null;
  accessRequestId: Id | null;
  companyId: Id | null;
  /** Devices still assigned to the leaver by name (in use or in repair). */
  devices: { id: Id; tag: string; kind: string; model: string }[];
  /** The IT checklist for this person, when IT has started it. */
  checklist: { id: Id; done: number; total: number } | null;
  /** Microsoft 365 accounts on the register for this person still active (leaver) or present (joiner). */
  m365Active: number;
  /** Joiner: an approved Microsoft 365 account request already exists for this person. */
  m365Approved: boolean;
  /** What IT still has to do, in plain words; empty when finished. */
  todo: string[];
}

const minusDays = (d: IsoDate, n: number): IsoDate => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
};
const norm = (s: string | null | undefined) => (s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const officeUser = (u: User) => !u.integration && u.role !== 'guard' && u.role !== 'site_device';

/** The new accounts an approved request made: each create line with the account id written for it (in order). */
export function accountsMade(q: AccountRequest) {
  const creates = q.items.filter((x) => x.op === 'create');
  return creates
    .map((item, k) => ({ item, userId: item.op === 'create' ? (item.userId ?? q.applied?.users[k] ?? null) : null }))
    .filter((x): x is { item: Extract<AccountRequest['items'][number], { op: 'create' }>; userId: Id } => !!x.userId && x.item.op === 'create');
}

/** Devices assigned (by name) to a person, still in use or in repair. */
export function devicesHeldBy(assets: ItAsset[], name: string) {
  const n = norm(name);
  if (!n) return [];
  return assets.filter((a) => (a.status === 'in_use' || a.status === 'repair') && norm(a.assignedTo) === n);
}

/**
 * B1 + D1: the people HR has started or finished, for IT. A row drops off once IT has finished its checklist and, for a
 * leaver, no device is still assigned to the person.
 */
export function itFromHr(input: {
  users: User[];
  accountRequests: AccountRequest[];
  onboarding: ItOnboarding[];
  assets: ItAsset[];
  policyRecs: ItPolicyRec[];
  today: IsoDate;
}): ItFromHrRow[] {
  const { users, accountRequests, onboarding, assets, policyRecs, today } = input;
  const since = minusDays(today, IT_FROM_HR_DAYS);
  const byId = new Map(users.map((u) => [u.id, u]));
  const checklistOf = (uid: Id, kind: 'join' | 'leave') => {
    const rows = onboarding.filter((o) => o.kind === kind && o.manual?.personUserId === uid);
    const o = rows.sort((a, b) => (b.manual?.createdAt ?? '').localeCompare(a.manual?.createdAt ?? ''))[0];
    return o ? { id: o.id, done: o.steps.filter((s) => !!s.doneAt).length, total: o.steps.length } : null;
  };
  const m365 = (uid: Id) => policyRecs.filter((r) => r.kind === 'm365' && r.d.ownerUserId === uid);
  const m365Approved = (uid: Id) => policyRecs.some((r) => r.kind === 'acctReq' && r.status === 'approved' && r.d.subjectUserId === uid);
  const out: ItFromHrRow[] = [];

  for (const q of accountRequests) {
    if (q.status !== 'approved' || !q.applied || !q.decidedAt || q.decidedAt.slice(0, 10) < since) continue;
    accountsMade(q).forEach(({ item, userId }) => {
      const u = byId.get(userId);
      if (!u || !officeUser(u) || (u.accessClosedFrom && u.accessClosedFrom <= today)) return;
      const checklist = checklistOf(u.id, 'join');
      const approved = m365Approved(u.id);
      const todo: string[] = [];
      if (!checklist) todo.push('start the joining checklist');
      else if (checklist.done < checklist.total) todo.push(`joining checklist ${checklist.done}/${checklist.total}`);
      if (!approved && !m365(u.id).length) todo.push('record the Microsoft 365 account (approved here)');
      if (!todo.length) return;
      out.push({
        kind: 'join', userId: u.id, name: u.name, title: u.title ?? item.title, on: q.decidedAt!.slice(0, 10), approvedBy: q.decidedBy,
        accessRequestId: q.id, companyId: item.companyId ?? null, devices: [], checklist, m365Active: m365(u.id).length, m365Approved: approved, todo,
      });
    });
  }

  for (const u of users) {
    if (!officeUser(u) || !u.accessClosedFrom || u.accessClosedFrom > today || u.accessClosedFrom < since) continue;
    const devices = devicesHeldBy(assets, u.name).map((a) => ({ id: a.id, tag: a.tag, kind: a.kind, model: a.model }));
    const checklist = checklistOf(u.id, 'leave');
    const active = m365(u.id).filter((r) => r.status === 'active').length;
    const todo: string[] = [];
    if (devices.length) todo.push(`collect ${devices.length} device${devices.length === 1 ? '' : 's'}`);
    if (!checklist) todo.push('start the leaver checklist');
    else if (checklist.done < checklist.total) todo.push(`leaver checklist ${checklist.done}/${checklist.total}`);
    if (active) todo.push(`block ${active} Microsoft 365 account${active === 1 ? '' : 's'}`);
    if (!todo.length) continue;
    out.push({
      kind: 'leave', userId: u.id, name: u.name, title: u.title ?? '', on: u.accessClosedFrom, approvedBy: null, accessRequestId: null,
      companyId: u.companyIds[0] ?? null, devices, checklist, m365Active: active, m365Approved: false, todo,
    });
  }
  return out.sort((a, b) => (a.kind === b.kind ? b.on.localeCompare(a.on) : a.kind === 'leave' ? -1 : 1));
}

export interface CompanyItRentals {
  companyId: Id;
  devices: { tag: string; kind: string; model: string; status: string; assignedTo: string | null; location: string }[];
  bills: { period: string; total: number; invoiceRef: string; paid: boolean; issuedAt: IsoDateTime | null }[];
}

/** B3: what a company rents from Merdeka, read through the store (the database store uses prima.it_company_rentals). */
export async function companyItRentals(store: Store, companyId: Id): Promise<CompanyItRentals> {
  if (store.companyItRentals) return store.companyItRentals(companyId);
  const assets = (await store.list('itAssets', {})).filter((a) => a.ownerId === companyId && (a.status === 'in_use' || a.status === 'repair'));
  const bills = (await store.list('itRentalBills', {})).filter((b: ItRentalBill) => b.companyId === companyId);
  return {
    companyId,
    devices: assets
      .map((a) => ({ tag: a.tag, kind: a.kind, model: a.model, status: a.status, assignedTo: a.assignedTo, location: a.location }))
      .sort((a, b) => a.tag.localeCompare(b.tag)),
    bills: bills
      .map((b) => ({ period: b.period, total: b.total, invoiceRef: b.invoiceRef, paid: !!b.paid, issuedAt: b.issuedAt ?? null }))
      .sort((a, b) => b.period.localeCompare(a.period))
      .slice(0, 24),
  };
}

/** D3: a member of the Finance team named as Merdeka's IT purchase finance team (prima.it_purchase_finance_authorities). */
export function merdekaFinanceMember(u: User, team: number | null | undefined): boolean {
  return (
    !u.integration &&
    u.role === 'pwvsb_officer' &&
    u.department === 'finance' &&
    team != null &&
    u.financeTeam === team &&
    ['leader', 'deputy', 'data_entry'].includes(u.financeRole ?? '')
  );
}

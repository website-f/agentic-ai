import { AccessDenied } from "./access";
import { isHrAdmin } from "./hr";
import { isHrDirector } from "./access";
import { BadRequest } from "./service";
import type { Store } from "./store";
import type { Id, IsoDate, IsoDateTime, User } from "./types";
import { registerWall } from "./walls";

/**
 * Part N17 (Fauzan, 14 Nov 2026: "Let hr administrator key in the system. As the list usually changes per year."):
 * three Group HR lists are settings the HR Administrator keys in, each version from a date with a reason. Old versions
 * are kept and a record uses the version in force on its date. Nothing is preset in the code: until HR keys a list in,
 * the screen says "not set by HR". The HR Director views them; nobody else changes them.
 */
export type HrListKind = 'guard_courses' | 'claim_clauses' | 'discipline_steps';

export interface GuardCourseItem {
  name: string;
  /** Whether every guard must have it, or it is an optional upgrade. */
  needed: 'required' | 'optional';
  /** By when, in words (for example "within 1 year of joining"). */
  byWhen: string;
}
export interface ClaimClauseItem {
  clause: string;
  item: string;
  covered: string;
  note: string;
}
export interface DisciplineStepItem {
  step: string;
  when: string;
  by: string;
  keep: string;
}
export type HrListItem = GuardCourseItem | ClaimClauseItem | DisciplineStepItem;
export type HrListItemOf<K extends HrListKind> = K extends 'guard_courses' ? GuardCourseItem : K extends 'claim_clauses' ? ClaimClauseItem : DisciplineStepItem;

export interface HrList {
  id: Id;
  kind: HrListKind;
  from: IsoDate;
  items: HrListItem[];
  reason: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
}

export const HR_LIST_LABEL: Record<HrListKind, string> = {
  guard_courses: 'Guard course list (which courses a guard needs, and by when)',
  claim_clauses: 'Medical claim clauses (what a claim covers and excludes)',
  discipline_steps: 'Discipline steps (the steps and their order)',
};

export function holdsHrLists(user: User): boolean {
  return !user.integration && isHrAdmin(user);
}
registerWall('hr_lists', holdsHrLists);

/** The version in force on a date: the latest whose start date has come. */
export function hrListInForce(lists: HrList[], kind: HrListKind, on: IsoDate): HrList | null {
  return lists.filter((l) => l.kind === kind && l.from <= on).sort((a, b) => a.from.localeCompare(b.from) || a.at.localeCompare(b.at)).at(-1) ?? null;
}

const t = (v: unknown, what: string, max = 200) => {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  if (!s || s.length > max) throw new BadRequest(`${what}: 1 to ${max} characters.`);
  return s;
};

function itemsOf(kind: HrListKind, raw: unknown): HrListItem[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 60) throw new BadRequest('Give 1 to 60 lines.');
  return raw.map((x, i) => {
    const r = (x ?? {}) as Record<string, unknown>;
    const n = `Line ${i + 1}`;
    if (kind === 'guard_courses') {
      if (r.needed !== 'required' && r.needed !== 'optional') throw new BadRequest(`${n}: say if it is required or optional.`);
      return { name: t(r.name, `${n} course`), needed: r.needed, byWhen: t(r.byWhen, `${n} by when`) };
    }
    if (kind === 'claim_clauses') return { clause: t(r.clause, `${n} clause`, 20), item: t(r.item, `${n} item`), covered: t(r.covered, `${n} covered`, 60), note: String(r.note ?? '').trim().slice(0, 300) };
    return { step: t(r.step, `${n} step`), when: t(r.when, `${n} when`, 300), by: t(r.by, `${n} decided by`), keep: t(r.keep, `${n} kept for`, 60) };
  });
}

export class HrListService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private async installed() {
    return !this.store.hasTable || (await this.store.hasTable('hrLists'));
  }

  private async all(): Promise<HrList[]> {
    return (await this.installed()) ? this.store.list('hrLists', {}) : [];
  }

  /** Every person who reads a list on a record: the version in force on that date, or "not set by HR". */
  async inForce<K extends HrListKind>(kind: K, on: IsoDate) {
    const l = hrListInForce(await this.all(), kind, on);
    const items = (l?.items ?? []) as HrListItemOf<K>[];
    return { kind, label: HR_LIST_LABEL[kind], set: !!l, from: l?.from ?? null, items, by: l?.by ?? null, note: l ? null : 'Not set by HR yet.' };
  }

  /** The HR Administrator (keeps) and the HR Director (views): every version of the three lists. */
  async view(user: User) {
    if (!holdsHrLists(user) && !isHrDirector(user)) throw new AccessDenied('hr.monitor', '(HR lists)');
    const all = await this.all();
    return {
      installed: await this.installed(),
      canSet: holdsHrLists(user),
      lists: (Object.keys(HR_LIST_LABEL) as HrListKind[]).map((kind) => ({
        kind,
        label: HR_LIST_LABEL[kind],
        versions: all.filter((l) => l.kind === kind).sort((a, b) => b.from.localeCompare(a.from) || b.at.localeCompare(a.at)),
      })),
    };
  }

  /** The HR Administrator keys in a new version from a date, with a reason. Never backdated before a version in force. */
  async set(user: User, kind: HrListKind, input: Record<string, unknown>) {
    if (!holdsHrLists(user)) throw new AccessDenied('hr.monitor', '(only the HR Administrator keys in the HR lists)');
    if (!(kind in HR_LIST_LABEL)) throw new BadRequest('Unknown list.');
    if (!(await this.installed())) throw new BadRequest('HR lists are not installed in this database yet (module hr-lists-v1, run by the CEO).');
    const from = String(input.from ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) throw new BadRequest('From: a date (YYYY-MM-DD), for example 2027-01-01.');
    const reason = String(input.reason ?? '').trim();
    if (reason.length < 3) throw new BadRequest('Say why (a short reason is fine).');
    const items = itemsOf(kind, input.items);
    const at = this.now();
    const row: HrList = { id: `hrl-${kind}-${from}-${Date.parse(at).toString(36)}`, kind, from, items, reason: reason.slice(0, 500), by: user.name, byId: user.id, at };
    await this.store.transaction(async (tx) => {
      await tx.insert('hrLists', row);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'hr.list_set', entity: 'hr_list', entityId: row.id, summary: `${HR_LIST_LABEL[kind]} from ${from}: ${items.length} line(s). ${row.reason}`.slice(0, 900) });
    });
    return row;
  }
}

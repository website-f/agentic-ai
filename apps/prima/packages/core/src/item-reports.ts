// Reports of the item register (P85; Fitri's paper section 10). Built only from rows the user may already see (the
// service filters and masks first), so a report never widens access. Every report says when its data is from, the
// last event it includes and its scope; a CSV export repeats those lines at the top and is audited by the service.

import { csvText } from './item-finance';
import { labelDisplay, STATE_LABEL, type ItemCase, type ItemEvent, type ItemLabelPrint, type ItemLot, type ItemMovement, type ItemSku, type PhysicalItem } from './items';
import type { Id, IsoDate, IsoDateTime } from './types';

export type ItemReportKind = 'balance' | 'history' | 'transit' | 'custody_by_person' | 'site_shortages' | 'usage_life' | 'returns_repairs_losses' | 'reprints';
export const ITEM_REPORT_KINDS: ItemReportKind[] = ['balance', 'transit', 'custody_by_person', 'site_shortages', 'usage_life', 'returns_repairs_losses', 'reprints', 'history'];
export const ITEM_REPORT_TITLE: Record<ItemReportKind, string> = {
  balance: 'Balance by owner, place, item type, size and condition',
  history: 'Item history (last 90 days)',
  transit: 'In transit and partly received',
  custody_by_person: 'Items held by each person',
  site_shortages: 'Sites: shortages and open matters',
  usage_life: 'Use and expected life',
  returns_repairs_losses: 'Returns, repairs, laundry and losses',
  reprints: 'Labels printed and reprinted',
};

export interface ItemReport {
  kind: ItemReportKind;
  title: string;
  asOf: IsoDateTime;
  lastEventAt: IsoDateTime | null;
  scope: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportInput {
  kind: ItemReportKind;
  asOf: IsoDateTime;
  today: IsoDate;
  scope: string;
  partyName: (id: Id) => string;
  items: PhysicalItem[];
  lots: ItemLot[];
  moves: ItemMovement[];
  cases: ItemCase[];
  events: ItemEvent[];
  prints: ItemLabelPrint[];
  skus: ItemSku[];
  /** After-sale care rows (life and service), already filtered by the service. */
  care: { itemId: Id; token: string; skuId: Id; condition: string; state: string; ageMonths: number; lifeEnds: IsoDate | null; services: number; status: string }[];
}

const where = (i: PhysicalItem) => (i.custody.kind === 'store' || i.custody.kind === 'site' ? i.custody.label : i.custody.kind.replace('_', ' '));

export function buildReport(x: ReportInput): ItemReport {
  const sku = (id: Id) => x.skus.find((s) => s.id === id);
  const code = (id: Id) => sku(id)?.code ?? id;
  const size = (id: Id) => sku(id)?.size ?? '';
  const lastEventAt = x.events.map((e) => e.at).sort().at(-1) ?? null;
  const base = { kind: x.kind, title: ITEM_REPORT_TITLE[x.kind], asOf: x.asOf, lastEventAt, scope: x.scope };
  const live = x.items.filter((i) => !i.componentIds.length);
  switch (x.kind) {
    case 'balance': {
      const m = new Map<string, (string | number)[]>();
      for (const i of live) {
        if (i.state === 'disposed') continue;
        const k = [i.ownerPartyId, i.custody.partyId, where(i), i.skuId, i.condition, i.state].join('|');
        const row = m.get(k) ?? [x.partyName(i.ownerPartyId), x.partyName(i.custody.partyId), where(i), code(i.skuId), size(i.skuId), i.condition, STATE_LABEL[i.state], 0];
        row[7] = (row[7] as number) + 1;
        m.set(k, row);
      }
      for (const l of x.lots) m.set(`lot|${l.id}`, [x.partyName(l.ownerPartyId), x.partyName(l.custody.partyId), l.custody.label, code(l.skuId), size(l.skuId), 'n/a', 'Counted by quantity', l.qty]);
      return { ...base, columns: ['Owner', 'Holder', 'Where', 'Item type', 'Size', 'Condition', 'State', 'Quantity'], rows: [...m.values()].sort((a, b) => String(a[3]).localeCompare(String(b[3]))) };
    }
    case 'transit':
      return {
        ...base,
        columns: ['Movement', 'Type', 'From', 'To', 'Sent', 'Units', 'Received', 'Waiting or missing', 'Damaged or wrong'],
        rows: x.moves
          .filter((m) => m.status === 'dispatched' || m.status === 'partly_received')
          .map((m) => [m.ref, m.type, x.partyName(m.fromPartyId), m.to.label, m.dispatched?.at.slice(0, 10) ?? '', m.lines.length, m.lines.filter((l) => l.result === 'received').length, m.lines.filter((l) => l.result === 'pending' || l.result === 'missing').length, m.lines.filter((l) => l.result === 'damaged' || l.result === 'wrong_item').length]),
      };
    case 'custody_by_person': {
      const m = new Map<string, (string | number)[]>();
      for (const i of live.filter((i) => i.custody.kind === 'person')) {
        const k = `${i.custody.ref}|${i.skuId}`;
        const row = m.get(k) ?? [i.custody.label, x.partyName(i.custody.partyId), code(i.skuId), size(i.skuId), 0, 0];
        row[4] = (row[4] as number) + 1;
        if (i.pendingAck) row[5] = (row[5] as number) + 1;
        m.set(k, row);
      }
      return { ...base, columns: ['Person', 'Company', 'Item type', 'Size', 'Units', 'Not yet confirmed'], rows: [...m.values()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
    }
    case 'site_shortages': {
      const sites = new Map<Id, { label: string; party: Id; units: number; overdue: number; unconfirmed: number; cases: number; damaged: number }>();
      const siteRow = (id: Id, label: string, party: Id) => sites.get(id) ?? (sites.set(id, { label, party, units: 0, overdue: 0, unconfirmed: 0, cases: 0, damaged: 0 }), sites.get(id)!);
      for (const i of live.filter((i) => i.custody.kind === 'site')) {
        const r = siteRow(i.custody.ref, i.custody.label, i.custody.partyId);
        r.units++;
        if (i.dueBack && i.dueBack.on < x.today) r.overdue++;
        if (i.condition === 'damaged') r.damaged++;
      }
      for (const c of x.cases.filter((c) => c.status === 'open' && c.itemId)) {
        const i = x.items.find((ii) => ii.id === c.itemId);
        if (i?.custody.kind === 'site') siteRow(i.custody.ref, i.custody.label, i.custody.partyId).cases++;
      }
      return { ...base, columns: ['Site', 'Company', 'Units at site', 'Overdue returns', 'Damaged', 'Open cases'], rows: [...sites.values()].map((s) => [s.label, x.partyName(s.party), s.units, s.overdue, s.damaged, s.cases]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) };
    }
    case 'usage_life':
      return { ...base, columns: ['Label', 'Item type', 'Condition', 'State', 'Age (months)', 'Expected life ends', 'Services', 'Status'], rows: x.care.map((c) => [labelDisplay(c.token), code(c.skuId), c.condition, c.state, c.ageMonths, c.lifeEnds ?? 'not set', c.services, c.status.replace(/_/g, ' ')]) };
    case 'returns_repairs_losses': {
      const kinds = ['return', 'repair_out', 'repair_back', 'laundry_out', 'laundry_back', 'report_missing', 'lost', 'disposed', 'found', 'swap'];
      return {
        ...base,
        columns: ['When', 'What', 'Label', 'Item type', 'Note'],
        rows: x.events
          .filter((e) => e.itemId && kinds.includes(e.kind))
          .sort((a, b) => b.at.localeCompare(a.at))
          .map((e) => {
            const i = x.items.find((ii) => ii.id === e.itemId);
            return [e.at.slice(0, 16).replace('T', ' '), e.kind.replace(/_/g, ' '), i ? labelDisplay(i.token) : '', i ? code(i.skuId) : '', e.note];
          }),
      };
    }
    case 'reprints':
      return {
        ...base,
        columns: ['When', 'Label', 'Item type', 'Generation', 'First or reprint', 'Reason', 'Printed by', 'Scanned back'],
        rows: x.prints
          .slice()
          .sort((a, b) => b.at.localeCompare(a.at))
          .map((p) => {
            const i = x.items.find((ii) => ii.id === p.itemId);
            return [p.at.slice(0, 16).replace('T', ' '), i ? labelDisplay(i.token) : '', i ? code(i.skuId) : '', p.gen, p.kind, p.reason ?? '', p.by, p.verified ? p.verified.at.slice(0, 16).replace('T', ' ') : 'not yet'];
          }),
      };
    case 'history': {
      const from = new Date(Date.parse(`${x.today}T00:00:00Z`) - 90 * 86_400_000).toISOString();
      return {
        ...base,
        columns: ['When', 'Label', 'Item type', 'Event', 'By', 'To', 'Note'],
        rows: x.events
          .filter((e) => e.itemId && e.at >= from)
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 5000)
          .map((e) => {
            const i = x.items.find((ii) => ii.id === e.itemId);
            return [e.at.slice(0, 16).replace('T', ' '), i ? labelDisplay(i.token) : '', i ? code(i.skuId) : '', e.kind.replace(/_/g, ' '), e.by, e.to?.label ?? '', e.note];
          }),
      };
    }
  }
}

/** A report as CSV: three lines of what it is, when and for whom, a blank line, then the table. */
export function reportCsv(r: ItemReport): string {
  return csvText([['Report', r.title], ['Data as of', r.asOf], ['Last event included', r.lastEventAt ?? 'none'], ['Scope', r.scope], [], r.columns, ...r.rows]);
}


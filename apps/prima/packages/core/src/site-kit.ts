import type { Id } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";


export type SiteKitCategory = 'furniture' | 'shelter' | 'fan_light' | 'cctv' | 'equipment' | 'other';
export type SiteKitOwner = 'company' | 'client' | 'rented';

export interface SiteKitItem {
  id: Id;
  /** e.g. Plastic chair, Guard post (pondok), Standing fan, CCTV camera. */
  name: string;
  category: SiteKitCategory;
  /** How many the site needs. */
  required: number;
  owner: SiteKitOwner;
  note: string;
  /**
   * At contract end (Fauzan, 4 Nov 2026) every item is taken back, unless the client contract says it is handed over
   * (give the clause) or management approves giving it (SiteKit.gifts). Missing means take back.
   */
  atEnd?: 'take_back' | 'hand_over';
  handOverRef?: string;
}

export interface SiteKitRecord {
  id: Id;
  /**
   * install: items put in place; check: the monthly count of what is in place, working and broken; take_back: at
   * contract end, what came back and what was handed over (lines may also name cleaning equipment as clean:<id>).
   */
  kind: 'install' | 'check' | 'take_back';
  date: IsoDate;
  lines: { itemId: Id; inPlace: number; working: number; broken: number; takenBack?: number; handedOver?: number }[];
  note: string;
  by: string;
  byId: Id;
  at: IsoDateTime;
  proofIds: Id[];
}

export interface SiteKit {
  /** kit-<siteId> */
  id: Id;
  companyId: Id;
  siteId: Id;
  items: SiteKitItem[];
  /** Installs and checks, newest last; the oldest are dropped past 120 (the audit log keeps all). */
  records: SiteKitRecord[];
  /** Management (COO or CEO) approved giving items to the client at contract end, with a reason. ref: kit:<id> or clean:<id>. */
  gifts?: { ref: string; qty: number; reason: string; by: string; byId: Id; at: IsoDateTime }[];
  version: number;
  updatedBy: string;
  updatedAt: IsoDateTime;
}

export const SITE_KIT_CATEGORY_LABEL: Record<SiteKitCategory, string> = {
  furniture: 'Chairs and tables',
  shelter: 'Guard post and shelter',
  fan_light: 'Fans and lights',
  cctv: 'CCTV',
  equipment: 'Other equipment',
  other: 'Other',
};

export const SITE_KIT_OWNER_LABEL: Record<SiteKitOwner, string> = { company: 'Ours', client: "Client's", rented: 'Rented' };

/** A monthly check is due when the last record is older than this many days (proposed, rule SITE-KIT-CHECK). */
export const SITE_KIT_CHECK_DAYS = 31;

export interface SiteKitItemStatus {
  item: SiteKitItem;
  inPlace: number | null;
  working: number | null;
  broken: number | null;
  /** Needed minus working; positive is short. */
  short: number | null;
  lastOn: IsoDate | null;
}

export function siteKitStatus(kit: SiteKit, today: IsoDate) {
  const items = kit.items.map((item): SiteKitItemStatus => {
    const rec = [...kit.records].reverse().find((r) => r.lines.some((l) => l.itemId === item.id));
    const l = rec?.lines.find((x) => x.itemId === item.id);
    return {
      item,
      inPlace: l?.inPlace ?? null,
      working: l?.working ?? null,
      broken: l?.broken ?? null,
      short: l ? Math.max(0, item.required - l.working) : null,
      lastOn: rec?.date ?? null,
    };
  });
  const last = kit.records.at(-1)?.date ?? null;
  const due = !last || Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`) > SITE_KIT_CHECK_DAYS * 86_400_000;
  return {
    items,
    lastRecord: last,
    checkDue: kit.items.length > 0 && due,
    short: items.filter((i) => (i.short ?? 0) > 0).length,
    broken: items.filter((i) => (i.broken ?? 0) > 0).length,
    neverRecorded: items.filter((i) => i.lastOn === null).length,
  };
}

/**
 * The equipment a KPM guard contract asks for at each premise (Lampiran A2 section 4, shared by Fauzan on 4 Nov 2026),
 * from the most guards on any one shift and the guards on the contract. Walkie-talkies are not needed when one guard
 * works a shift alone. Uniforms are issued per guard by the store (2 sets in month 1, 1 set in months 13 and 25).
 */
export function kpmGuardKit(maxPerShift: number, guards: number): SiteKitItem[] {
  const m = Math.max(1, Math.floor(maxPerShift));
  const g = Math.max(m, Math.floor(guards));
  const item = (id: string, name: string, required: number, note: string): SiteKitItem => ({ id, name, category: 'equipment', required, owner: 'company', note, atEnd: 'take_back', handOverRef: '' });
  return [
    item('kpm-tour-points', 'Guard tour points (RFID/NFC)', 4, 'At least 4, where the premise administrator sets; working within 1 month of the start'),
    item('kpm-tour-device', 'Guard tour device with data plan', 1, 'Rugged; face recognition and geofence; repaired within 72 h in Sabah, Sarawak, Labuan (48 h elsewhere)'),
    ...(m > 1
      ? [
          item('kpm-radio', 'Walkie-talkie', m, 'One per guard on the busiest shift; 1 km range; waterproof'),
          item('kpm-radio-battery', 'Walkie-talkie spare battery (4 h)', m, ''),
          item('kpm-radio-charger', 'Walkie-talkie charger', m, ''),
        ]
      : []),
    item('kpm-baton', 'Baton (cota), wood 325 g, 45 cm', m, 'One per guard on the busiest shift'),
    item('kpm-whistle', 'Whistle (rust-proof)', g, 'One per guard'),
    item('kpm-raincoat', 'Raincoat, bright polyester', m, 'One per guard on the busiest shift'),
    item('kpm-torch', 'Torch, heavy duty 6V', m, 'One per guard on the busiest shift'),
    item('kpm-first-aid', 'First aid kit (DOSH standard)', 1, 'At the main guard post'),
    item('kpm-numbers', 'Emergency numbers board (police, fire, hospital, company)', 1, 'Displayed at every guard post'),
  ];
}
// Barrier gates: the ANPR camera's plate read, checked against the visitor management system (expected visitors and their
// plates) and the vehicle management system (registered and blocked vehicles) (Fauzan, 2 Nov 2026).
// CMS only reads. The gate opens by the site's own rules; a CMS command to open it stays off (plan section 7).
import { makeEvent, stableId, type CmsEvent } from '../event';
import type { DirectoryIndex } from '../directory';

/** Malaysian plates are written with and without spaces; compare letters and digits only. */
export function normalisePlate(p: string): string {
  return p.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface Vehicle {
  plate: string;
  siteIds: string[];
  status: 'registered' | 'blocked';
  owner: string;
  /** Blocked vehicles: why, shown to the gate guard. */
  reason?: string;
}

export interface Visitor {
  id: string;
  siteId: string;
  name: string;
  host: string;
  plate: string | null;
  /** The visit window. A plate outside it is treated as unknown. */
  from: string;
  to: string;
}

/** The lists the visitor and vehicle systems send. Each system's adaptor fills one of these. */
export class GateLists {
  private vehicles = new Map<string, Vehicle>();
  private visitors: Visitor[] = [];

  setVehicles(list: Vehicle[]): void {
    this.vehicles = new Map(list.map((v) => [normalisePlate(v.plate), { ...v, plate: normalisePlate(v.plate) }]));
  }

  setVisitors(list: Visitor[]): void {
    this.visitors = list.map((v) => ({ ...v, plate: v.plate ? normalisePlate(v.plate) : null }));
  }

  /** Both lists as plain JSON, for the saved state (persist.ts). */
  exportLists(): { vehicles: Vehicle[]; visitors: Visitor[] } {
    return { vehicles: [...this.vehicles.values()], visitors: this.visitors };
  }

  vehicle(plate: string): Vehicle | undefined {
    return this.vehicles.get(normalisePlate(plate));
  }

  visitor(siteId: string, plate: string, at: string): Visitor | undefined {
    const p = normalisePlate(plate);
    const t = Date.parse(at);
    return this.visitors.find((v) => v.siteId === siteId && v.plate === p && Date.parse(v.from) <= t && t <= Date.parse(v.to));
  }
}

/** A plate read, after the brand adaptor has mapped its fields. */
export interface PlateRead {
  cameraId: string;
  plate: string;
  /** 0 to 1. */
  confidence: number;
  at: string;
  lane?: string;
  imageUrl?: string;
}

/** Reads below this confidence go to the gate guard to check by eye. PROPOSED. */
export const MIN_CONFIDENCE = 0.8;

export type GateVerdict = 'blocked' | 'registered' | 'visitor' | 'unknown' | 'unclear';

export function decide(read: PlateRead, siteId: string, lists: GateLists): { verdict: GateVerdict; vehicle?: Vehicle; visitor?: Visitor } {
  const vehicle = lists.vehicle(read.plate);
  // A blocked plate is flagged whatever the confidence: a wrong read costs a check, a missed block costs more.
  if (vehicle?.status === 'blocked') return { verdict: 'blocked', vehicle };
  if (read.confidence < MIN_CONFIDENCE) return { verdict: 'unclear' };
  if (vehicle && vehicle.siteIds.includes(siteId)) return { verdict: 'registered', vehicle };
  const visitor = lists.visitor(siteId, read.plate, read.at);
  if (visitor) return { verdict: 'visitor', visitor };
  return { verdict: 'unknown' };
}

export function plateEvent(read: PlateRead, dir: DirectoryIndex, lists: GateLists, receivedAt = new Date().toISOString()): CmsEvent | { refused: string } {
  const cam = dir.devices.get(read.cameraId);
  if (!cam || cam.kind !== 'anpr') return { refused: `ANPR camera ${read.cameraId} not in the directory` };
  const site = dir.sites.get(cam.siteId)!;
  const plate = normalisePlate(read.plate);
  if (!plate) return { refused: 'empty plate' };
  const { verdict, vehicle, visitor } = decide(read, site.id, lists);
  const base = {
    id: stableId('anpr', read.cameraId, plate, read.at),
    companyId: site.companyId,
    siteId: site.id,
    deviceId: cam.id,
    source: 'anpr',
    occurredAt: read.at,
    receivedAt,
    clipUrl: read.imageUrl && /^https:\/\//.test(read.imageUrl) ? read.imageUrl : undefined,
  };
  const detail = { plate, confidence: read.confidence, lane: read.lane ?? null, verdict };
  switch (verdict) {
    case 'blocked':
      return makeEvent({ ...base, kind: 'GATE_PLATE_BLOCKED', summary: `Blocked vehicle ${plate} at ${site.name}${vehicle?.reason ? `: ${vehicle.reason}` : ''}`, detail });
    case 'registered':
      return makeEvent({ ...base, kind: 'GATE_PLATE_ALLOWED', summary: `${plate} (${vehicle!.owner}) at ${site.name}`, detail });
    case 'visitor':
      return makeEvent({ ...base, kind: 'GATE_VISITOR_ARRIVED', summary: `Visitor ${visitor!.name} for ${visitor!.host}, ${plate}, at ${site.name}`, detail: { ...detail, visitorId: visitor!.id } });
    case 'unclear':
      return makeEvent({ ...base, kind: 'GATE_PLATE_UNKNOWN', summary: `Plate read unclear (${plate}?) at ${site.name}: check by eye`, detail });
    default:
      return makeEvent({ ...base, kind: 'GATE_PLATE_UNKNOWN', summary: `Unknown vehicle ${plate} at ${site.name}`, detail });
  }
}

/**
 * Brand profiles: where each brand puts the plate fields in its JSON push. Field paths use dots. Only the generic profile
 * is set now; a brand's profile is added from its API document once the brand list is in (plan section 5).
 */
export interface BrandProfile {
  plate: string;
  confidence: string;
  /** How the brand gives confidence: 0 to 1, or 0 to 100. */
  confidenceScale: 1 | 100;
  at: string;
  cameraId: string;
  lane?: string;
  imageUrl?: string;
}

export const PROFILES: Record<string, BrandProfile> = {
  generic: { plate: 'plate', confidence: 'confidence', confidenceScale: 1, at: 'time', cameraId: 'cameraId', lane: 'lane', imageUrl: 'imageUrl' },
};

function pick(o: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), o);
}

export function readFromJson(body: unknown, profile: BrandProfile): PlateRead | { refused: string } {
  const plate = pick(body, profile.plate);
  const conf = Number(pick(body, profile.confidence));
  const at = pick(body, profile.at);
  const cameraId = pick(body, profile.cameraId);
  if (typeof plate !== 'string' || typeof cameraId !== 'string') return { refused: 'plate or camera missing' };
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) return { refused: 'time missing' };
  if (!Number.isFinite(conf)) return { refused: 'confidence missing' };
  const lane = profile.lane ? pick(body, profile.lane) : undefined;
  const imageUrl = profile.imageUrl ? pick(body, profile.imageUrl) : undefined;
  return {
    plate,
    cameraId,
    at: new Date(at).toISOString(),
    confidence: Math.max(0, Math.min(1, conf / profile.confidenceScale)),
    lane: typeof lane === 'string' ? lane : undefined,
    imageUrl: typeof imageUrl === 'string' ? imageUrl : undefined,
  };
}

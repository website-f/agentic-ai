// How one scan is judged (P85; Fitri's paper sections 9 and 10). The screen and the server judge a scan the same way:
// the screen asks first (items/scan-check, read only), and every write runs the same rules again before it changes
// anything. A scan only finds a record; it never grants anything.
//
// - A label the user may not see is "not found", exactly like an unknown label, and counts towards the miss limiter.
// - A typed ID is manual entry: it needs a reason and physical proof (the maker serial when the item has one, otherwise
//   a tick that the item type and size match). It is marked manual and never closes a shortage by itself.
// - A label of an older generation (a reprint replaced it) is a superseded copy: it never moves the item.
// - A generation newer than the item's own is impossible: treated as not found and audited as a suspected forgery.

import { sha256Hex } from './audit';
import { labelGenOf, parseScan, SCAN_SOURCES, type ItemConfig, type ItemState, type PhysicalItem, type ScanEntry, type ScanSource } from './items';
import type { Id } from './types';

export type ScanPurpose = 'view' | 'pick' | 'receive' | 'issue' | 'return' | 'count' | 'observe' | 'confirm' | 'verify_print';
export const SCAN_PURPOSES: ScanPurpose[] = ['view', 'pick', 'receive', 'issue', 'return', 'count', 'observe', 'confirm', 'verify_print'];

/** Purposes that change where an item is or who holds it: a superseded label never does these. */
export const MOVING_PURPOSES: ScanPurpose[] = ['pick', 'receive', 'issue', 'return', 'confirm'];

export type ScanOutcome =
  | 'ok'
  | 'duplicate'
  | 'not_on_list'
  | 'wrong_sku'
  | 'not_available'
  | 'held_elsewhere'
  | 'superseded_label'
  | 'needs_manual_proof'
  | 'not_found';

export const SCAN_OUTCOME_LABEL: Record<ScanOutcome, string> = {
  ok: 'OK',
  duplicate: 'Already scanned',
  not_on_list: 'Not on this list',
  wrong_sku: 'Wrong item type',
  not_available: 'Not available',
  held_elsewhere: 'Held elsewhere',
  superseded_label: 'Old copy of the label',
  needs_manual_proof: 'Typed: proof needed',
  not_found: 'Not found',
};

/** The answer for one scan. Items the user cannot see get not_found and nothing else. */
export interface ScanVerdict {
  outcome: ScanOutcome;
  message: string;
  source: ScanSource;
  manual: boolean;
  itemId?: Id;
  label?: string;
  sku?: string | null;
  size?: string | null;
  state?: ItemState;
  version?: number;
  /** The item has a maker serial: a typed entry must give it. */
  hasSerial?: boolean;
}

/** Longest raw value accepted from a scanner or a keyboard. */
export const SCAN_MAX = 80;

/**
 * A scan entry from a request, checked for shape only. A bare label string (older screens and actions) counts as
 * chosen from a list on screen. Returns a plain message when the entry is malformed.
 */
export function readEntry(raw: unknown, label?: unknown): { ok: true; entry: ScanEntry } | { ok: false; message: string } {
  if (raw == null || raw === '') {
    if (label == null || label === '') return { ok: false, message: 'Scan or type the label ID.' };
    return { ok: true, entry: { code: String(label).slice(0, SCAN_MAX), source: 'list', manual: null } };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, message: 'The scan must be an object.' };
  const r = raw as Record<string, unknown>;
  const code = String(r.code ?? '').trim();
  if (!code) return { ok: false, message: 'Scan or type the label ID.' };
  if (code.length > SCAN_MAX) return { ok: false, message: 'That is not a Prima item label.' };
  const source = SCAN_SOURCES.includes(r.source as ScanSource) ? (r.source as ScanSource) : null;
  if (!source) return { ok: false, message: 'Say how the code was read (camera, scanner, RFID, list or typed).' };
  let manual: ScanEntry['manual'] = null;
  if (r.manual != null) {
    if (typeof r.manual !== 'object' || Array.isArray(r.manual)) return { ok: false, message: 'The manual entry details must be an object.' };
    const m = r.manual as Record<string, unknown>;
    manual = {
      reason: String(m.reason ?? '').trim().slice(0, 200),
      serialSeen: m.serialSeen == null ? undefined : String(m.serialSeen).trim().slice(0, 60),
      skuSizeConfirmed: m.skuSizeConfirmed === true,
    };
  }
  const deviceAt = typeof r.deviceAt === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(r.deviceAt) ? r.deviceAt : null;
  const baseVersion = Number.isInteger(r.baseVersion) && (r.baseVersion as number) >= 0 ? (r.baseVersion as number) : null;
  return { ok: true, entry: { code, source, manual, deviceAt, baseVersion } };
}

/**
 * The manual-entry rule (paper section 10: "input manual ID dengan sebab dan pengesahan fizikal"). Returns the refusal
 * message, or null when the entry may be used. Only typed entries are checked.
 */
export function manualProblem(entry: ScanEntry, item: Pick<PhysicalItem, 'serial'>): string | null {
  if (entry.source !== 'typed') return null;
  const m = entry.manual;
  if (!m || m.reason.length < 5) return 'A typed ID needs a reason (label damaged, unreadable, missing or printer fault).';
  if (item.serial) {
    if (!m.serialSeen) return 'Type the maker serial you can see on the item, to prove it is the same item.';
    if (m.serialSeen.trim().toUpperCase() !== item.serial.trim().toUpperCase()) return 'The serial you typed does not match this item. Check the item, or keep it aside and open a case.';
    return null;
  }
  if (!m.skuSizeConfirmed) return 'Confirm the item type and size match what the ID says.';
  return null;
}

/** Judge the generation printed in the code against the item's current label. */
export function genVerdict(gen: number | null, source: ScanSource, item: Pick<PhysicalItem, 'labelGen' | 'labelPrints'>): 'ok' | 'superseded' | 'forged' {
  if (gen == null || source === 'typed' || source === 'list' || source === 'rfid') return 'ok';
  const cur = labelGenOf(item);
  if (gen < cur) return 'superseded';
  if (gen > cur) return 'forged';
  return 'ok';
}

/** Too many typed entries in one session: a manager looks before it is committed or closed. */
export function tooManyManual(manual: number, total: number, cfg: Pick<ItemConfig, 'manualMin' | 'manualShare'>): boolean {
  return manual > Math.max(cfg.manualMin, Math.floor(total * cfg.manualShare));
}

/** A fingerprint of the scanned value for the audit and the miss limiter. The raw label is never stored for a miss. */
export function scanHash(code: string): string {
  const p = parseScan(code);
  const norm = p.ok ? (p.by === 'label' ? p.token : `rfid:${p.tag}`) : code.trim().toUpperCase();
  return sha256Hex(`prima-scan:${norm}`);
}

/** Rolling window of the miss limiter. */
export const MISS_WINDOW_MS = 10 * 60 * 1000;

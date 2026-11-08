import { toHex } from "./audit";
import { PIN_KEY_MIN_LENGTH } from "./pin";
import { hmacSha256 } from "./pin";
import type { GroupEmployment } from "./types";
import type { IsoDate } from "./types";
import type { Nationality } from "./types";
import type { PersonRole } from "./types";
import type { RehireStatus } from "./types";


const enc = new TextEncoder();

/** Separates this use of the key from PIN hashing, so a link key can never be confused with a PIN hash. */
const DOMAIN = 'prima-staff-id-link:v1';

/**
 * Keys an IC or passport so the link table can find the same person without holding the number. The key is the same
 * secret the API already keeps for PINs (PIN_PEPPER in Key Vault), used under its own label. Without the key, linking
 * is off and the history says so; it never falls back to the plain number.
 */
export interface IdLinker {
  readonly on: boolean;
  /** The link key for a number, or null when linking is off or the number is too short to be one. */
  key(idFull: string | null | undefined, nationality: Nationality): string | null;
}

/** The form compared: capitals, no spaces, dashes or slashes, so "900101-10-1234" and "900101101234" match. */
export function normaliseIdNumber(idFull: string): string {
  return idFull.toUpperCase().replace(/[\s\-/.]/g, '');
}

export function idLinker(secret: string | null | undefined): IdLinker {
  const k = secret && secret.length >= PIN_KEY_MIN_LENGTH ? enc.encode(secret) : null;
  return {
    on: !!k,
    key(idFull, nationality) {
      if (!k || !idFull) return null;
      const n = normaliseIdNumber(idFull);
      if (n.length < 6) return null;
      // Malaysians by IC, everyone else by passport: the same characters in the two never meet.
      const kind = nationality === 'MY' ? 'MY' : 'PASSPORT';
      return `k1$${toHex(hmacSha256(k, enc.encode(`${DOMAIN}:${kind}:${n}`)))}`;
    },
  };
}

/** Rehire decisions, in the words the screens use. */
export const REHIRE_LABEL: Record<RehireStatus, string> = {
  eligible: 'Can be hired again',
  check_first: 'Check with HR before hiring',
  do_not_rehire: 'Do not hire again',
};

/** A day after another, for continuous service (a transfer ends one day and starts the next). */
function nextDay(d: IsoDate): IsoDate {
  return new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Employments sorted from the first to the latest. */
export function sortEmployments<T extends Pick<GroupEmployment, 'from' | 'to'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.from.localeCompare(b.from) || (a.to ?? '9999').localeCompare(b.to ?? '9999'));
}

/**
 * Since when the person has worked in the group without a break (a transfer within the group is no break). Null when
 * they are not working in the group now. A gap of more than a day, for example leaving for a few years, starts again.
 */
export function continuousSince(rows: Pick<GroupEmployment, 'from' | 'to' | 'status'>[], today: IsoDate): IsoDate | null {
  const sorted = sortEmployments(rows);
  const current = sorted.filter((r) => r.status !== 'left' && (r.to === null || r.to >= today));
  if (!current.length) return null;
  let start = current[0].from;
  // Walk back while an earlier employment ended the day before (or overlaps) the start.
  for (;;) {
    const before = sorted.find((r) => r.from < start && r.to !== null && (r.to >= start || nextDay(r.to) >= start));
    if (!before) return start;
    start = before.from;
  }
}

/** The number of separate times the person joined the group (transfers within the group do not count again). */
export function timesJoined(rows: (Pick<GroupEmployment, 'from' | 'to'> & { status?: GroupEmployment['status'] })[]): number {
  const sorted = sortEmployments(rows);
  let n = 0;
  let reach: IsoDate | null = null;
  for (const r of sorted) {
    if (reach === null || r.from > nextDay(reach)) n++;
    // A record that says left without a last day (some JA rows) ends, as far as Prima knows, where it started.
    const end = r.to ?? (r.status === 'left' ? r.from : '9999-12-31');
    if (reach === null || end > reach) reach = end;
  }
  return n;
}

/**
 * What Prima suggests HR looks at, never a decision (discipline is never automatic): a dismissal or termination, a
 * guard who absconded, or a domestic inquiry that proved a charge.
 */
export function rehireSuggestion(input: { endings: (string | null)[]; provenCharges: number; dismissals: number }): { status: RehireStatus; why: string } | null {
  const reasons: string[] = [];
  if (input.dismissals) reasons.push(`${input.dismissals} dismissal${input.dismissals === 1 ? '' : 's'} after an inquiry`);
  if (input.endings.includes('terminated')) reasons.push('an employment ended by termination');
  if (input.endings.includes('absconded')) reasons.push('left without notice (absconded)');
  if (input.provenCharges && !input.dismissals) reasons.push(`${input.provenCharges} proven charge${input.provenCharges === 1 ? '' : 's'} at an inquiry`);
  return reasons.length ? { status: 'check_first', why: `HR to look at: ${reasons.join('; ')}.` } : null;
}

export const OLD_RECORD_ENDINGS = ['resigned', 'terminated', 'contract_end', 'retired', 'absconded', 'unknown'] as const;
export const GROUP_ROLES: PersonRole[] = ['guard', 'supervisor', 'patrol_officer', 'office'];

/** How many checks before hiring one person may run a day (each is audited); stops trying numbers one after another. */
/** DECIDED (Fauzan, 4 Nov 2026 07:15Z): lookups per person per day outside HR. */
export const HIRE_CHECKS_PER_DAY = 30;
/** DECIDED (Fauzan, 4 Nov 2026 07:15Z): a decision by lookup must follow a lookup of the same keyed number by the same person within this many minutes. */
export const HISTORY_MARK_WINDOW_MIN = 30;
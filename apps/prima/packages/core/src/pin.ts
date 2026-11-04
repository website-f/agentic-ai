// Staff PINs for site devices and witness sign-offs (pre-publication review R1, Fauzan 31 Oct 2026).
//
// A PIN is never kept as typed. The person record holds "h1$<salt>$<HMAC-SHA256(key, salt:PIN)>". A PIN has only
// 10,000 to 1,000,000 values, so a salt alone would not stop someone holding a copy of the database from trying them
// all; the key is what does. It lives outside the database (PIN_PEPPER in Key Vault), so a leaked backup or export
// reveals no PIN. Without the key, PIN checks are refused rather than weakened.
//
// HMAC is built on the SHA-256 in audit.ts so the same check runs in the API and in the browser test version.

import { sha256Bytes, toHex } from './audit';

/** What a PIN may look like: 4 to 6 digits. */
export const PIN_PATTERN = /^\d{4,6}$/;

const PREFIX = 'h1';
const BLOCK = 64;

/** Key used by the browser test version, the mock data and local tests only. The API refuses it in production. */
export const DEMO_PIN_KEY = 'prima-demo-pin-key-not-for-real-data';

/** The key must be long enough that it cannot be guessed (Key Vault secret, 32+ characters). */
export const PIN_KEY_MIN_LENGTH = 32;

const enc = new TextEncoder();

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  let k = key.length > BLOCK ? sha256Bytes(key) : key;
  const padded = new Uint8Array(BLOCK);
  padded.set(k);
  k = padded;
  const ipad = k.map((b) => b ^ 0x36);
  const opad = k.map((b) => b ^ 0x5c);
  return sha256Bytes(concat(opad, sha256Bytes(concat(ipad, message))));
}

/** Compares without stopping at the first difference, so timing does not give away how much matched. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  globalThis.crypto.getRandomValues(salt);
  return salt;
}

export function isPinHash(stored: unknown): stored is string {
  return typeof stored === 'string' && /^h1\$[0-9a-f]{32}\$[0-9a-f]{64}$/.test(stored);
}

/** Thrown when the API has no PIN key: PIN checks are refused, never skipped. */
export class PinsOff extends Error {
  constructor() {
    super('PIN sign-in is switched off until IT sets the PIN key. Use another way to confirm, or ask IT.');
    this.name = 'PinsOff';
  }
}

export interface PinKeeper {
  /** False when no usable key was given: hash() and matches() then throw PinsOff. */
  readonly on: boolean;
  /** The stored form of a PIN. A salt is only passed by the mock data, so the test data stays the same on every run. */
  hash(pin: string, salt?: Uint8Array): string;
  /** Whether the typed PIN matches the stored one. A PIN still kept as typed (never hashed) never matches. */
  matches(stored: string | null | undefined, pin: string): boolean;
}

export function pinKeeper(key: string | null | undefined): PinKeeper {
  const k = key && key.length >= PIN_KEY_MIN_LENGTH ? enc.encode(key) : null;
  const digest = (salt: Uint8Array, pin: string) => toHex(hmacSha256(k!, concat(salt, enc.encode(`:${pin}`))));
  return {
    on: !!k,
    hash(pin, salt = randomSalt()) {
      if (!k) throw new PinsOff();
      if (!PIN_PATTERN.test(pin)) throw new Error('A PIN is 4 to 6 digits.');
      return `${PREFIX}$${toHex(salt)}$${digest(salt, pin)}`;
    },
    matches(stored, pin) {
      if (!k) throw new PinsOff();
      if (!isPinHash(stored) || typeof pin !== 'string' || !PIN_PATTERN.test(pin)) return false;
      const [, saltHex, want] = stored.split('$');
      const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
      return sameText(digest(salt, pin), want);
    },
  };
}

/** The keeper for the browser test version, the mock data and local tests. */
export const DEMO_PIN_KEEPER = pinKeeper(DEMO_PIN_KEY);

/**
 * The test PIN of a mock staff member, worked out from the staff number so testers can sign in. The mock data stores
 * only its hash. Never used for real people: real PINs are set by HR (setStaffPin) and never shown again.
 */
export function demoPin(staffNo: string): string {
  const n = Number(staffNo.replace(/\D/g, '').slice(-6) || '0');
  return String(1000 + ((n * 7919) % 9000));
}

/** A fixed salt for a mock record, so the generated test data is the same on every run. */
export function demoPinSalt(id: string): Uint8Array {
  return sha256Bytes(enc.encode(`pin-salt:${id}`)).slice(0, 16);
}

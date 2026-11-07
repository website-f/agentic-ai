/**
 * Sealing gate details for the in-house server (Fauzan, 6 Nov 2026: police need the full data of people coming in and
 * out, kept 2 to 7 years, on the company's in-house server).
 *
 * The site device seals the full identity number, the IC picture and written book pages with the in-house server's
 * public key before anything leaves the phone. Prima stores and forwards the sealed bundle but cannot open it: only the
 * in-house server holds the private key. Each bundle has its own random AES-256-GCM key, wrapped with RSA-OAEP-256.
 *
 * Works in the browser and in Node 20+ (Web Crypto).
 */
import type { SealedBundle } from './types';

export const SEAL_ALG = 'RSA-OAEP-256+A256GCM' as const;

/** What a device may put in a sealed bundle. */
export type SealedPart = 'id_number' | 'id_photo' | 'licence_photo' | 'plate_photo' | 'paper_pages';
export type SealedContents = Partial<Record<SealedPart, string | string[]>>;

const subtle = () => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error('This device cannot seal details (no Web Crypto). Use a current browser.');
  return c.subtle;
};

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Seals the details for the in-house server. The result is all Prima ever holds. */
export async function sealForInhouse(key: { keyId: string; jwk: JsonWebKey }, contents: SealedContents): Promise<SealedBundle> {
  const parts = (Object.keys(contents) as SealedPart[]).filter((k) => contents[k] != null && contents[k] !== '');
  if (!parts.length) throw new Error('Nothing to seal.');
  const s = subtle();
  const pub = await s.importKey('jwk', key.jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const aes = await s.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify({ v: 1, contents }));
  const [ciphertext, raw, digest] = await Promise.all([
    s.encrypt({ name: 'AES-GCM', iv }, aes, plain),
    s.exportKey('raw', aes),
    s.digest('SHA-256', plain),
  ]);
  const wrapped = await s.encrypt({ name: 'RSA-OAEP' }, pub, raw);
  return { alg: SEAL_ALG, keyId: key.keyId, wrappedKey: b64url(wrapped), iv: b64url(iv), ciphertext: b64url(ciphertext), plainSha256: hex(digest), contents: parts };
}

/**
 * Opens a bundle with the in-house private key. This runs only on the in-house server (and in tests); Prima never has
 * the private key. The fingerprint is checked, so a changed bundle is refused.
 */
export async function openSealed(privateJwk: JsonWebKey, b: SealedBundle): Promise<SealedContents> {
  if (b.alg !== SEAL_ALG) throw new Error('Unknown seal.');
  const s = subtle();
  const priv = await s.importKey('jwk', privateJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  const raw = await s.decrypt({ name: 'RSA-OAEP' }, priv, fromB64url(b.wrappedKey));
  const aes = await s.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = await s.decrypt({ name: 'AES-GCM', iv: fromB64url(b.iv) }, aes, fromB64url(b.ciphertext));
  if (hex(await s.digest('SHA-256', plain)) !== b.plainSha256) throw new Error('The sealed details were changed.');
  return (JSON.parse(new TextDecoder().decode(plain)) as { contents: SealedContents }).contents;
}

/** A throwaway key pair for tests and the browser test version. A real in-house key is made on the in-house server. */
export async function makeTestInhouseKey(keyId = 'test-inhouse-key'): Promise<{ keyId: string; jwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const s = subtle();
  const pair = await s.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const [jwk, privateJwk] = await Promise.all([s.exportKey('jwk', pair.publicKey), s.exportKey('jwk', pair.privateKey)]);
  return { keyId, jwk, privateJwk };
}

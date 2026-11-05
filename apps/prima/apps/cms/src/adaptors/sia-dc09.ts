// Intrusion alarm panels over IP: SIA DC-09 frames carrying Contact ID (ADM-CID) or a link test (NULL).
// Frame: LF, CRC (4 hex), 0 + length (3 hex), body, CR. Body: "ID" seq [Rrcvr] Lpref #acct [data] [_hh:mm:ss,MM-DD-YYYY].
// Encrypted frames (ID starting with *) need the panel's AES key and are refused until keys are set up per panel.
import { makeEvent, stableId, type CmsEvent, type EventKind } from '../event';
import type { DirectoryIndex } from '../directory';

/** CRC-16/ARC (poly 0x8005 reflected, start 0), as SIA DC-09 uses. */
export function crc16(text: string): number {
  let crc = 0;
  for (const byte of Buffer.from(text, 'latin1')) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

function hex(n: number, width: number): string {
  return n.toString(16).toUpperCase().padStart(width, '0');
}

export function frame(body: string): string {
  return `\n${hex(crc16(body), 4)}0${hex(Buffer.byteLength(body, 'latin1'), 3)}${body}\r`;
}

export interface Dc09Message {
  id: string;
  seq: string;
  receiver: string | null;
  prefix: string;
  account: string;
  data: string;
  /** UTC time stamp from the panel, if it sent one. */
  at: string | null;
}

export type ParseResult = { ok: true; msg: Dc09Message } | { ok: false; reason: string };

const BODY = /^"(\*?)([A-Z0-9-]+)"(\d{4})(R[0-9A-F]{1,6})?(L[0-9A-F]{1,6})#([0-9A-F]{3,16})\[([^\]]*)\](?:_(\d{2}):(\d{2}):(\d{2}),(\d{2})-(\d{2})-(\d{4}))?$/;

export function parseFrame(raw: string): ParseResult {
  const m = /^\n([0-9A-F]{4})0([0-9A-F]{3})(.*)\r$/s.exec(raw);
  if (!m) return { ok: false, reason: 'not a DC-09 frame' };
  const [, crc, len, body] = m;
  if (parseInt(len, 16) !== Buffer.byteLength(body, 'latin1')) return { ok: false, reason: 'length does not match' };
  if (parseInt(crc, 16) !== crc16(body)) return { ok: false, reason: 'CRC does not match' };
  const b = BODY.exec(body);
  if (!b) return { ok: false, reason: 'body not understood' };
  const [, star, id, seq, rcv, pref, acct, data, hh, mi, ss, mo, dd, yyyy] = b;
  if (star) return { ok: false, reason: 'encrypted frame: panel key not set up' };
  const at = hh ? `${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}Z` : null;
  if (at && Number.isNaN(Date.parse(at))) return { ok: false, reason: 'time stamp not valid' };
  return { ok: true, msg: { id, seq, receiver: rcv ?? null, prefix: pref, account: acct, data, at } };
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `_${p(now.getUTCHours())}:${p(now.getUTCMinutes())}:${p(now.getUTCSeconds())},${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}-${now.getUTCFullYear()}`;
}

/** The receiver's acknowledgement; the panel resends until it gets one. */
export function ack(msg: Dc09Message, now = new Date()): string {
  return frame(`"ACK"${msg.seq}${msg.receiver ?? ''}${msg.prefix}#${msg.account}[]${stamp(now)}`);
}

/** Sent when a frame cannot be read (bad CRC or length), so the panel resends it. */
export function nak(now = new Date()): string {
  return frame(`"NAK"0000R0L0A0[]${stamp(now)}`);
}

export interface ContactId {
  account: string;
  qualifier: 'new' | 'restore' | 'status';
  code: number;
  partition: string;
  zone: string;
}

export function parseContactId(data: string): ContactId | null {
  const m = /^#?([0-9A-F]{3,16})\|([136])(\d{3}) ?([0-9A-F]{2}) ?([0-9A-F]{3})$/.exec(data.trim());
  if (!m) return null;
  const q = m[2] === '1' ? 'new' : m[2] === '3' ? 'restore' : 'status';
  return { account: m[1], qualifier: q, code: Number(m[3]), partition: m[4], zone: m[5] };
}

/** Contact ID event codes to our kinds. Null means a status message, kept as the panel's heartbeat only. */
export function kindForCode(code: number): EventKind | null {
  if (code === 137 || code === 144 || code === 145 || code === 383) return 'TAMPER';
  if (code >= 110 && code <= 119) return 'FIRE';
  if ((code >= 100 && code <= 109) || (code >= 120 && code <= 129)) return 'PANIC';
  if (code >= 130 && code <= 149) return 'INTRUSION';
  return null;
}

const CODE_WORDS: Record<number, string> = {
  100: 'Medical alarm',
  110: 'Fire alarm',
  120: 'Panic alarm',
  121: 'Duress',
  122: 'Silent panic',
  130: 'Burglary',
  131: 'Perimeter burglary',
  132: 'Interior burglary',
  133: '24-hour zone',
  134: 'Entry or exit zone',
  137: 'Panel tamper',
  144: 'Sensor tamper',
  145: 'Expansion module tamper',
  383: 'Sensor tamper',
};

export interface Dc09Outcome {
  /** What to send back to the panel. */
  reply: string;
  /** The panel's device id when known, so its heartbeat is recorded. */
  deviceId: string | null;
  event: CmsEvent | null;
  refused?: string;
}

/**
 * One frame from a panel. Every readable frame is acknowledged, including ones from accounts we do not know (they are
 * refused as events and logged, so an unknown panel is visible, not silently dropped).
 */
export function handleFrame(raw: string, dir: DirectoryIndex, now = new Date()): Dc09Outcome {
  const p = parseFrame(raw);
  if (!p.ok) return { reply: nak(now), deviceId: null, event: null, refused: p.reason };
  const { msg } = p;
  const reply = ack(msg, now);
  const device = dir.byAccount.get(msg.account) ?? null;
  if (!device) return { reply, deviceId: null, event: null, refused: `alarm account ${msg.account} not in the directory` };
  if (msg.id === 'NULL') return { reply, deviceId: device.id, event: null };
  if (msg.id !== 'ADM-CID') return { reply, deviceId: device.id, event: null, refused: `format ${msg.id} not supported yet` };
  const cid = parseContactId(msg.data);
  if (!cid) return { reply, deviceId: device.id, event: null, refused: 'Contact ID data not understood' };
  const site = dir.sites.get(device.siteId)!;
  const base = { companyId: site.companyId, siteId: site.id, deviceId: device.id, source: 'sia-dc09', occurredAt: msg.at ?? undefined, receivedAt: now.toISOString() };
  const id = stableId('dc09', msg.account, msg.seq, msg.data, msg.at ?? '');
  const words = CODE_WORDS[cid.code] ?? `Alarm code ${cid.code}`;
  const detail = { code: cid.code, zone: cid.zone, partition: cid.partition, account: msg.account };
  const kind = kindForCode(cid.code);
  if (!kind) return { reply, deviceId: device.id, event: null };
  if (cid.qualifier === 'restore')
    return { reply, deviceId: device.id, event: makeEvent({ ...base, id, kind: 'ALARM_RESTORED', summary: `${words} restored, zone ${cid.zone}, ${site.name}`, detail }) };
  return { reply, deviceId: device.id, event: makeEvent({ ...base, id, kind, summary: `${words}, zone ${cid.zone}, ${site.name}`, detail }) };
}

import { sha256Hex } from "./audit";
import type { CmsDeviceKind } from "./types";
import type { CmsReadinessDevice } from "./types";
import type { CmsReadinessKey } from "./types";
import type { CmsReadinessValue } from "./types";
import type { CmsSiteReadiness } from "./types";


export const CMS_DEVICE_KINDS: Record<CmsDeviceKind, { label: string; linkHint: string }> = {
  CCTV_RECORDER: { label: 'CCTV recorder (NVR or DVR)', linkHint: 'Usually ONVIF Profile S/T, or the brand’s own API for health and events.' },
  ALARM_PANEL: { label: 'Alarm panel', linkHint: 'Usually SIA DC-09 or Contact ID through an alarm receiver.' },
  BARRIER_GATE: { label: 'Barrier gate controller', linkHint: 'Gate events by API or a dry contact. Remote opening stays off.' },
  ANPR_CAMERA: { label: 'Number plate (ANPR) camera', linkHint: 'Plate events by API or HTTP push.' },
  ACCESS_CONTROL: { label: 'Door access control', linkHint: 'Door events from its controller by API.' },
  VISITOR_SYSTEM: { label: 'Visitor management system', linkHint: 'Visitor events by API.' },
  INTERCOM: { label: 'Intercom or IP phone', linkHint: 'SIP to the CMS phone desk.' },
  PANIC_BUTTON: { label: 'Panic button', linkHint: 'Through the alarm panel or its own receiver.' },
};

export interface CmsReadinessItemSpec {
  key: CmsReadinessKey;
  label: string;
  help: string;
  /** A proof reference is needed before the answer can be yes. */
  needsRef: boolean;
  /** A short note is needed with a yes (what, which provider, whose name). */
  needsNote: boolean;
  /** Only needed when the site has a device of one of these kinds. */
  onlyWith?: CmsDeviceKind[];
}

export const CMS_READINESS_ITEMS: CmsReadinessItemSpec[] = [
  {
    key: 'survey',
    label: 'Site survey done',
    help: 'Someone walked the site and noted where the devices, network point and power are. Give the survey report or photo reference.',
    needsRef: true,
    needsNote: false,
  },
  {
    key: 'consent',
    label: 'Client agreed in writing that CMS watches this site',
    help: 'The client’s letter, email or contract clause allowing the CMS command centre to read its devices.',
    needsRef: true,
    needsNote: false,
  },
  {
    key: 'privacyNotice',
    label: 'CCTV notice signs are up (PDPA)',
    help: 'Signs telling people the area is under CCTV. Give the photo reference.',
    needsRef: true,
    needsNote: false,
    onlyWith: ['CCTV_RECORDER', 'ANPR_CAMERA'],
  },
  {
    key: 'internet',
    label: 'Internet at the site can carry the device link',
    help: 'Say the line type and provider, and who pays for it.',
    needsRef: false,
    needsNote: true,
  },
  {
    key: 'power',
    label: 'Backup power (UPS) for the recorder, panel or gate controller',
    help: 'Say what backs them up and for how long.',
    needsRef: false,
    needsNote: true,
  },
  {
    key: 'timeSync',
    label: 'Devices keep Malaysia time',
    help: 'Set to a time server (NTP) so CMS times and video times agree.',
    needsRef: false,
    needsNote: false,
  },
  {
    key: 'adminHolder',
    label: 'A named person holds the device admin login',
    help: 'Name and role only, at the client or the company. Never type a password, PIN or code into Prima.',
    needsRef: false,
    needsNote: true,
  },
];

export const CMS_READINESS_KEYS = CMS_READINESS_ITEMS.map((i) => i.key);

/** Items worked out from the device list, not answered by hand. */
export const CMS_DERIVED_ITEMS = [
  { key: 'devices', label: 'Devices at the site are listed' },
  { key: 'brands', label: 'Every device has the brand the client chose, and where the client wrote it' },
  { key: 'vendors', label: 'Every device has its installer or vendor contact' },
  { key: 'links', label: 'Every device’s vendor confirmed in writing how it can share health and events' },
] as const;

export type CmsReadinessStatus = 'not_started' | 'in_progress' | 'needs_fix' | 'ready_for_check' | 'ready_to_connect';

export const CMS_READINESS_STATUS_LABEL: Record<CmsReadinessStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  needs_fix: 'Needs fixing',
  ready_for_check: 'Waiting for Arms Control check',
  ready_to_connect: 'Ready to connect (not connected)',
};

export type CmsItemState = 'done' | 'gap' | 'unknown' | 'not_needed';

export interface CmsReadinessItemView {
  key: string;
  label: string;
  state: CmsItemState;
  detail: string;
}

export function emptyReadiness(): CmsSiteReadiness {
  return { devices: [], answers: {}, check: null, returned: null };
}

function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object')
    return `{${Object.keys(x as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(x ?? null);
}

/**
 * The exact readiness content a check speaks for: every device field and every answer, including who recorded them.
 * Any change after a check gives a new fingerprint, so the old check no longer counts.
 */
export function readinessFingerprint(r: CmsSiteReadiness | null | undefined): string {
  const x = r ?? emptyReadiness();
  const devices = [...x.devices].sort((a, b) => a.id.localeCompare(b.id));
  return sha256Hex(stable({ devices, answers: x.answers }));
}

/** Text that looks like someone typed a login secret. Prima keeps who holds a login, never the login itself. */
const SECRET_LIKE = /(pass(word)?|pwd|kata\s*laluan|pin|passcode|secret|token)\s*[:=]/i;
export function looksLikeSecret(text: string): boolean {
  return SECRET_LIKE.test(text);
}

function needed(spec: CmsReadinessItemSpec, devices: CmsReadinessDevice[]): boolean {
  return !spec.onlyWith || devices.some((d) => spec.onlyWith!.includes(d.kind));
}

function stateOf(v: CmsReadinessValue | undefined): CmsItemState {
  return v === 'yes' ? 'done' : v === 'no' ? 'gap' : 'unknown';
}

/** Every item with its state, and the site's status. Unknown is never green (V15). */
export function readinessView(r: CmsSiteReadiness | null | undefined) {
  const x = r ?? emptyReadiness();
  const ds = x.devices;
  const items: CmsReadinessItemView[] = [];
  const missing = (f: (d: CmsReadinessDevice) => boolean) => ds.filter(f).map((d) => `${CMS_DEVICE_KINDS[d.kind].label}${d.brand ? ` (${d.brand})` : ''}`);

  items.push({ key: 'devices', label: CMS_DERIVED_ITEMS[0].label, state: ds.length ? 'done' : 'unknown', detail: ds.length ? `${ds.length} listed` : 'None listed yet' });
  const noBrand = missing((d) => !d.brand.trim() || !d.clientChoiceRef.trim());
  items.push({
    key: 'brands',
    label: CMS_DERIVED_ITEMS[1].label,
    state: !ds.length ? 'unknown' : noBrand.length ? 'unknown' : 'done',
    detail: noBrand.length ? `Missing for: ${noBrand.join(', ')}` : ds.length ? 'All recorded' : '',
  });
  const noVendor = missing((d) => !d.vendorName.trim() || !d.vendorPhone.trim());
  items.push({
    key: 'vendors',
    label: CMS_DERIVED_ITEMS[2].label,
    state: !ds.length ? 'unknown' : noVendor.length ? 'unknown' : 'done',
    detail: noVendor.length ? `Missing for: ${noVendor.join(', ')}` : ds.length ? 'All recorded' : '',
  });
  const cannot = missing((d) => d.linkConfirmed === 'no');
  const notYet = missing((d) => d.linkConfirmed === 'unknown' || !d.linkMethod.trim());
  items.push({
    key: 'links',
    label: CMS_DERIVED_ITEMS[3].label,
    state: !ds.length ? 'unknown' : cannot.length ? 'gap' : notYet.length ? 'unknown' : 'done',
    detail: cannot.length
      ? `The vendor says these cannot share events yet: ${cannot.join(', ')}. The brand stays the client’s choice; ask the vendor for an API or a gateway.`
      : notYet.length
        ? `Not confirmed yet: ${notYet.join(', ')}`
        : ds.length
          ? 'All confirmed'
          : '',
  });
  for (const spec of CMS_READINESS_ITEMS) {
    if (!needed(spec, ds)) {
      items.push({ key: spec.key, label: spec.label, state: 'not_needed', detail: 'Not needed for the devices listed' });
      continue;
    }
    const a = x.answers[spec.key];
    items.push({
      key: spec.key,
      label: spec.label,
      state: stateOf(a?.value),
      detail: a ? [a.note, a.ref ? `Proof: ${a.ref}` : ''].filter(Boolean).join(' · ') : 'Not answered',
    });
  }

  const counted = items.filter((i) => i.state !== 'not_needed');
  const done = counted.filter((i) => i.state === 'done').length;
  const fingerprint = readinessFingerprint(x);
  const allDone = done === counted.length;
  const checkValid = !!x.check && x.check.fingerprint === fingerprint && allDone;
  const returnedOpen = !!x.returned && x.returned.fingerprint === fingerprint;
  const touched = ds.length > 0 || Object.keys(x.answers).length > 0;
  const status: CmsReadinessStatus = !touched
    ? 'not_started'
    : counted.some((i) => i.state === 'gap') || returnedOpen
      ? 'needs_fix'
      : !allDone
        ? 'in_progress'
        : checkValid
          ? 'ready_to_connect'
          : 'ready_for_check';
  return {
    items,
    done,
    total: counted.length,
    status,
    statusLabel: CMS_READINESS_STATUS_LABEL[status],
    fingerprint,
    check: checkValid ? x.check : null,
    /** A check made on content that has changed since. Shown so nobody mistakes it for a current check. */
    staleCheck: !!x.check && !checkValid ? x.check : null,
    returned: returnedOpen ? x.returned : null,
    /** Always false here: connecting devices is a later step (Fauzan, 5 Nov 2026). */
    connected: false as const,
  };
}

/** Everyone who recorded part of the current content. None of them may check it (nobody checks their own work). */
export function readinessContributors(r: CmsSiteReadiness | null | undefined): Set<string> {
  const x = r ?? emptyReadiness();
  return new Set([...x.devices.map((d) => d.byId), ...Object.values(x.answers).map((a) => a!.byId)]);
}
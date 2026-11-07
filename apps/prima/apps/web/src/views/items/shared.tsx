// Shared bits of the item register screens (P85 split of views/Items.tsx): labels, tones, roles and small helpers.
import type { ItemAction, ItemCategory } from '@prima/core';
import { api, type ItemBoard } from '../../api';

export type Role = 'store' | 'manager' | 'ops' | 'finance' | 'it' | 'view' | 'hr';

/** A fresh request id: a retry or a double tap of the same change is answered once (paper section 7). */
export const rid = () => `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const act = (a: ItemAction) => api.itemAct(rid(), a);

export const CAT_LABEL: Record<ItemCategory, string> = {
  uniform: 'Uniform',
  footwear: 'Shoes and boots',
  vest: 'Vests',
  torchlight: 'Torchlights',
  radio: 'Radios',
  phone: 'Phones',
  patrol_device: 'Patrol devices',
  bodycam: 'Body cameras',
  it_device: 'IT devices',
  office: 'Office items',
  furniture: 'Furniture',
  cleaning: 'Cleaning',
  safety: 'Safety gear',
  tools: 'Tools',
  other: 'Other',
};
export const TYPE_LABEL = { sale: 'Sale', rental: 'Rental', loan: 'Loan', transfer: 'Transfer', supplier_return: 'Return to supplier' } as const;
export const MOVE_TONE = { draft: 'neutral', dispatched: 'info', partly_received: 'warn', received: 'ok', cancelled: 'neutral' } as const;
export const STATE_TONE: Record<string, 'ok' | 'warn' | 'crit' | 'info' | 'neutral'> = {
  quarantine: 'warn',
  available: 'ok',
  reserved: 'info',
  in_transit: 'info',
  with_person: 'ok',
  at_site: 'ok',
  repair: 'warn',
  laundry: 'info',
  missing: 'crit',
  lost: 'crit',
  disposed: 'neutral',
};
export const LINE_TONE = { received: 'ok', pending: 'neutral', missing: 'crit', damaged: 'warn', wrong_item: 'warn' } as const;

/** Outcomes a case may close with (the server checks them again). */
export const OUTCOMES: Record<string, string[]> = {
  short: ['arrived', 'lost'],
  damaged: ['usable', 'repair', 'dispose'],
  wrong_item: ['sent_back', 'kept_with_approval'],
  wrong_place: ['checked'],
  dispute: ['person_has_it', 'back_in_store', 'missing'],
  missing: ['found', 'confirmed_lost'],
  count_not_found: ['found', 'report_missing'],
  count_extra: ['checked'],
  label_mismatch: ['identity_confirmed', 'label_withdrawn'],
  dispose: ['approved', 'rejected'],
  service: ['serviced', 'repair', 'replace_advised', 'no_fault_found'],
  unexpected_item: ['returned_to_sender', 'kept_with_approval', 'checked'],
  label_superseded: ['identity_confirmed', 'label_withdrawn'],
  label_unreadable: ['reprinted', 'checked'],
  count_unknown_label: ['checked', 'returned_to_owner'],
  seen_elsewhere: ['checked'],
  recon_diff: ['explained', 'corrected_in_sql', 'escalated'],
  sync_review: ['resolved'],
};
/** Closing these needs the item's label scanned, never typed. */
export const SHORTAGE_CLOSE: Record<string, string> = { short: 'arrived', missing: 'found', count_not_found: 'found' };

export function rolesOf(b: ItemBoard) {
  const m = new Map<string, Role[]>();
  for (const r of b.roles) m.set(r.partyId, r.roles as Role[]);
  return m;
}
export const any = (b: ItemBoard, ...rs: Role[]) => b.roles.some((r) => r.roles.some((x) => rs.includes(x as Role)));
export const handles = (b: ItemBoard, partyId: string) => (rolesOf(b).get(partyId) ?? []).some((r) => r === 'store' || r === 'manager' || r === 'it');
export const partyName = (b: ItemBoard, id: string) => b.parties.find((p) => p.id === id)?.name ?? id;
export const skuName = (b: ItemBoard, id: string) => {
  const s = b.skus.find((x) => x.id === id);
  return s ? `${s.code}: ${s.name}` : id;
};

/** Save text as a file on this device (a CSV export, an export file). Nothing leaves except the download. */
export function downloadText(name: string, text: string, mime = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file as a data URL (PDF or photo evidence). */
export const readFile = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('The file could not be read.'));
    r.readAsDataURL(f);
  });

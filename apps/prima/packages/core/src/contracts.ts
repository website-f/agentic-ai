import { addDays } from "./time";
import type { ContractReview } from "./types";
import type { ContractVersion } from "./types";
import type { IsoDate } from "./types";
import type { MobItem } from "./types";
import type { MobWorkstream } from "./types";
import type { MobAuto } from "./types";
import type { MobOwner } from "./types";



/** The mobilisation workstreams (V6 amendment, proposed wording until Operations confirms it; W12 masterplan §191). */
export const MOB_WORKSTREAM_LABEL: Record<MobWorkstream, string> = {
  W1: 'Contract and award papers',
  W2: 'Client onboarding',
  W3: 'Site survey and risk',
  W4: 'Post orders and SOP',
  W5: 'Manpower and roster',
  W6: 'Guard clearance',
  W7: 'Registrations and notices',
  W8: 'Insurance and guarantees',
  W9: 'Equipment and uniforms',
  W10: 'Arms',
  W11: 'Billing set-up',
  W12: 'CMS activation',
};

/** The CMS activation item (masterplan §191). Kept last so the ids of the items before it never change. */
export const CMS_ACTIVATION_LABEL = 'CMS activation (technical): site CCTV or alarm panel linked and tested, a signal received by CMS, call-out contacts named';

/**
 * The mobilisation checklist (V6 amendment W1 to W11, real-use version 5 Nov 2026). Wording, due days and which items
 * are critical are proposed (decision M-1) until Operations confirms them. Critical items block go-live.
 */
export const MOB_TEMPLATE: Tpl[] = [
  { w: 'W1', label: 'Signed contract or letter of award filed', at: -10, critical: true, owner: 'company' },
  { w: 'W1', label: 'Stamp duty paid on the contract', at: -5, critical: false, owner: 'company' },
  { w: 'W1', label: "Client's purchase order or service order number recorded", at: -7, critical: false, owner: 'company' },
  { w: 'W2', label: 'Client due diligence accepted by the company manager', at: -10, critical: true, owner: 'company', auto: 'client_diligence' },
  { w: 'W2', label: 'Client contacts on record: who decides, who is on site, who pays', at: -7, critical: false, owner: 'company', auto: 'client_contacts' },
  { w: 'W2', label: 'Kick-off meeting with the client held, minutes filed', at: -5, critical: false, owner: 'operations' },
  { w: 'W2', label: 'Billing address and e-Invoice details (TIN) recorded', at: -7, critical: false, owner: 'company' },
  { w: 'W3', label: 'Site survey done, with photos', at: -7, critical: true, owner: 'operations', expansion: true },
  { w: 'W3', label: 'Site risk assessment done (armed or unarmed decided)', at: -7, critical: true, owner: 'operations', expansion: true },
  { w: 'W4', label: 'Assignment instructions for every post agreed and signed by the client', at: -3, critical: true, owner: 'operations', auto: 'assignment_instructions', expansion: true },
  { w: 'W4', label: 'Emergency contacts posted at the site (police, Bomba, hospital)', at: -1, critical: false, owner: 'operations', expansion: true },
  { w: 'W5', label: "First week's roster filled for every post", at: -3, critical: true, owner: 'operations', auto: 'roster', expansion: true },
  { w: 'W5', label: 'Relief guards named for leave and absence', at: -3, critical: false, owner: 'operations', expansion: true },
  { w: 'W6', label: 'Every rostered guard cleared to deploy (KDN, CSG, permits, age)', at: -1, critical: true, owner: 'operations', auto: 'guard_clearance', expansion: true },
  { w: 'W6', label: 'Site briefing given to the guards, attendance signed', at: -1, critical: false, owner: 'operations', expansion: true },
  { w: 'W7', label: 'Place of employment checked with JTKSM (Employment Act s.63A)', at: 0, critical: false, owner: 'company' },
  { w: 'W7', label: 'New guards registered with PERKESO (within 30 days of hiring)', at: 0, critical: false, owner: 'hr', expansion: true },
  { w: 'W7', label: 'KDN notice for the new site, if required', at: 0, critical: false, owner: 'company', expansion: true },
  { w: 'W8', label: 'Insurance cover confirmed for the site (liability, fidelity, guard cover)', at: -3, critical: true, owner: 'company', expansion: true },
  { w: 'W8', label: 'Performance bond or bank guarantee lodged, if the contract asks', at: -3, critical: false, owner: 'finance' },
  { w: 'W9', label: 'Uniforms and personal equipment issued', at: -1, critical: false, owner: 'operations', expansion: true },
  { w: 'W9', label: 'Radios, patrol tags and site phone installed and tested', at: -1, critical: false, owner: 'operations', expansion: true },
  { w: 'W9', label: 'Guard post, logbooks and visitor book ready', at: -1, critical: false, owner: 'operations', expansion: true },
  { w: 'W10', label: 'Firearm permits checked for every armed guard', at: -3, critical: true, owner: 'arms', armedOnly: true, expansion: true },
  { w: 'W10', label: 'Vault and firearm issue plan approved by Arms Control', at: -3, critical: true, owner: 'arms', armedOnly: true, expansion: true },
  { w: 'W11', label: 'Billing method, rates and SQL Account customer set up', at: 0, critical: false, owner: 'finance', expansion: true },
  { w: 'W11', label: 'e-Invoice or client portal set up for this client', at: 0, critical: false, owner: 'finance' },
  { w: 'W11', label: 'First invoice checked against the contract', at: 30, critical: false, owner: 'finance', expansion: true },
  { w: 'W12', label: CMS_ACTIVATION_LABEL, at: -1, critical: false, owner: 'operations', expansion: true },
];

export function mobilisationFor(startOn: IsoDate, armed: boolean): MobItem[] {
  return items(startOn, armed, 1);
}

export function reviewsFor(startOn: IsoDate): ContractReview[] {
  return ([1, 7, 14, 30] as const).map((day) => ({ day, dueOn: addDays(startOn, day), doneAt: null, by: null, note: '' }));
}

/** The month's billing under a contract version. Method 3 counts every calendar day of the month. */
export function contractBilling(v: ContractVersion, period: string, daysPerMonthM1 = 30.5) {
  const [y, m] = period.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (v.billingMethod === 'FIXED') return { days, lines: [{ label: 'Fixed monthly fee', hours: 0, amount: r2(v.fixedFee ?? 0) }], total: r2(v.fixedFee ?? 0) };
  const lines = v.posts.map((p) => {
    const hours =
      v.billingMethod === 'M1'
        ? p.guards * p.hoursPerDay * daysPerMonthM1
        : v.billingMethod === 'M2'
          ? p.guards * (p.contractedHours ?? 0)
          : p.guards * p.hoursPerDay * days;
    return { label: p.label, hours, amount: r2(hours * p.rate) };
  });
  return { days, lines, total: r2(lines.reduce((n, l) => n + l.amount, 0)) };
}

export const BILLING_METHOD_LABEL: Record<ContractVersion['billingMethod'], string> = {
  M1: 'Method 1: hours a day x 30.5',
  M2: 'Method 2: contracted hours',
  M3: 'Method 3: hours a day x days in the month',
  FIXED: 'Fixed monthly fee',
};

export const MOB_OWNER_LABEL: Record<MobOwner, string> = {
  company: 'Company office',
  operations: 'Operations',
  hr: 'HR',
  finance: 'Finance',
  arms: 'Arms Control',
};

type Tpl = {
  w: MobWorkstream;
  label: string;
  /** Days from the start date; negative is before it. */
  at: number;
  critical: boolean;
  owner: MobOwner;
  armedOnly?: boolean;
  auto?: MobAuto;
  /** Also opened again for a material expansion (a new site, more guards, armed posts). */
  expansion?: boolean;
};

function items(startOn: IsoDate, armed: boolean, round: number): MobItem[] {
  return MOB_TEMPLATE.filter((t) => (armed || !t.armedOnly) && (round === 1 || t.expansion)).map((t, i) => ({
    id: round === 1 ? `mob-${i + 1}` : `mob-r${round}-${i + 1}`,
    workstream: t.w,
    label: t.label,
    offset: t.at,
    dueOn: addDays(startOn, t.at),
    critical: t.critical,
    status: 'open',
    by: null,
    at: null,
    note: '',
    acceptedUntil: null,
    ...(t.w === 'W12' ? { check: 'cms_activation' as const } : {}),
    owner: t.owner,
    auto: t.auto ?? null,
    proofIds: [],
    round,
    log: [],
  }));
}

/** A material expansion (a new site, more guards, armed posts) opens the site-level items again, due against its start. */
export function expansionItems(round: number, startOn: IsoDate, armed: boolean): MobItem[] {
  return items(startOn, armed, round);
}

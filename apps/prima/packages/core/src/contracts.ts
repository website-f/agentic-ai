import { addDays } from './time';
import type { ContractReview, ContractVersion, IsoDate, MobItem, MobWorkstream } from './types';

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

/** [workstream, item, days from start, critical, armed sites only]. */
const MOB_TEMPLATE: [MobWorkstream, string, number, boolean, boolean][] = [
  ['W1', 'Signed contract or letter of award filed', -10, true, false],
  ['W2', 'Client contacts, PO and billing address recorded', -7, false, false],
  ['W3', 'Site survey and risk assessment done', -7, true, false],
  ['W4', 'Post orders and SOP agreed with the client', -3, true, false],
  ['W5', 'Roster for the first month published', -3, true, false],
  ['W6', 'Every guard cleared to deploy (KDN, CSG, permits, age)', -1, true, false],
  ['W7', 'Workplace registration and notices checked (JTKSM, PERKESO, KDN)', 0, false, false],
  ['W8', 'Insurance cover and any performance bond in place', -3, true, false],
  ['W9', 'Uniforms, radios, patrol tags and site phone delivered', -1, false, false],
  ['W10', 'Armed posts: permits, vault and firearm issue plan', -3, true, true],
  ['W11', 'Billing method, rates and SQL Account customer set up', 0, false, false],
  ['W11', 'First invoice checked against the contract', 30, false, false],
  ['W12', CMS_ACTIVATION_LABEL, -1, false, false],
];

export function mobilisationFor(startOn: IsoDate, armed: boolean): MobItem[] {
  return MOB_TEMPLATE.filter(([, , , , armedOnly]) => armed || !armedOnly).map(([workstream, label, offset, critical], i) => ({
    id: `mob-${i + 1}`,
    workstream,
    label,
    offset,
    dueOn: addDays(startOn, offset),
    critical,
    status: 'open',
    by: null,
    at: null,
    note: '',
    acceptedUntil: null,
    ...(workstream === 'W12' ? { check: 'cms_activation' as const } : {}),
  }));
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

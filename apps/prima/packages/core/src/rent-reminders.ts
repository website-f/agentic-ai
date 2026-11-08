import type { AmTenancy } from "./types";
import type { AmUnit } from "./types";
import type { IsoDate } from "./types";
import type { IsoDateTime } from "./types";
import { addDays } from "./time";
import { daysBetween } from "./time";


/**
 * Timings: due day confirmed by Fauzan (2 Nov 2026); the reminder days are PROPOSED, to confirm with the Asset Director: rent for a month is due on the 1st (Fauzan, 2 Nov 2026); a reminder 3 days before,
 * one on the due day, then one 7 days late and every 10 days after that while it stays unpaid. After 90 days late
 * WhatsApp reminders stop: the team's letter or notice of demand (Asset Director approves) takes over. Messages go out
 * only between 9 am and 6 pm Malaysia time, and never more than one a day to the same tenant.
 */
export const RENT_REMINDERS = {
  dueDay: 1,
  beforeDays: 3,
  firstLateDays: 7,
  lateEveryDays: 10,
  stopAfterLateDays: 90,
  sendFromHour: 9,
  sendToHour: 18,
  maxAttempts: 3,
} as const;

export type RentReminderStage = 'before' | 'due' | 'late';

export interface RentReminderPlan {
  unitId: string;
  /** One reminder per unit, period and stage (late ones also carry their round), so a re-run never sends twice. */
  key: string;
  stage: RentReminderStage;
  period: string;
  amount: number;
  dueOn: IsoDate;
  daysLate: number;
}

export type RentReminderSkip = 'no_consent' | 'no_phone' | 'internal' | 'promise' | 'past_90_days' | 'sent_today';

export function rentDueOn(period: string, dueDay: number = RENT_REMINDERS.dueDay): IsoDate {
  return `${period}-${String(dueDay).padStart(2, '0')}`;
}

/** A Malaysian mobile number in the international form WhatsApp needs (60123456789), or null when it is not one. */
export function waNumber(phone: string | null | undefined): string | null {
  const d = String(phone ?? '').replace(/\D/g, '');
  const n = d.startsWith('0') ? `6${d}` : d;
  return /^601\d{8,9}$/.test(n) ? n : null;
}

/** What the tenant is owed a reminder about today, or why not. Only the oldest unpaid month is chased, with the total. */
export function rentReminderFor(u: Pick<AmUnit, 'id' | 'tenancy'>, today: IsoDate): { plan: RentReminderPlan | null; skip: RentReminderSkip | null } {
  const t = u.tenancy;
  if (!t) return { plan: null, skip: null };
  const open = t.invoices.filter((i) => i.paid < i.amount && rentDueOn(i.period) <= addDays(today, RENT_REMINDERS.beforeDays)).sort((a, b) => a.period.localeCompare(b.period));
  if (!open.length) return { plan: null, skip: null };
  const oldest = open[0];
  const dueOn = rentDueOn(oldest.period);
  const amount = Math.round(open.reduce((n, i) => n + i.amount - i.paid, 0) * 100) / 100;
  const daysLate = daysBetween(dueOn, today);
  let stage: RentReminderStage | null = null;
  let round = 0;
  if (daysLate === -RENT_REMINDERS.beforeDays) stage = 'before';
  else if (daysLate === 0) stage = 'due';
  else if (daysLate >= RENT_REMINDERS.firstLateDays && (daysLate - RENT_REMINDERS.firstLateDays) % RENT_REMINDERS.lateEveryDays === 0) {
    stage = 'late';
    round = (daysLate - RENT_REMINDERS.firstLateDays) / RENT_REMINDERS.lateEveryDays + 1;
  }
  if (!stage) return { plan: null, skip: null };
  if (t.internal) return { plan: null, skip: 'internal' };
  if (daysLate > RENT_REMINDERS.stopAfterLateDays) return { plan: null, skip: 'past_90_days' };
  if (!t.whatsapp?.consent?.on) return { plan: null, skip: 'no_consent' };
  if (!waNumber(t.tenantPhone)) return { plan: null, skip: 'no_phone' };
  // A tenant who promised to pay by a date that has not passed is not chased until then.
  const promise = (t.followUps ?? []).filter((f) => f.action === 'PROMISE' && f.promiseOn).at(-1);
  if (stage === 'late' && promise?.promiseOn && promise.promiseOn >= today) return { plan: null, skip: 'promise' };
  if ((t.whatsapp?.reminders ?? []).some((r) => r.queuedAt.slice(0, 10) === today)) return { plan: null, skip: 'sent_today' };
  const key = `${u.id}:${oldest.period}:${stage}${round ? `-${round}` : ''}`;
  return { plan: { unitId: u.id, key, stage, period: oldest.period, amount, dueOn, daysLate }, skip: null };
}

/** Whether a Malaysia-time moment is inside the sending hours. */
export function inSendingHours(at: IsoDateTime): boolean {
  const ms = Date.parse(at);
  const hour = new Date(ms + 8 * 3_600_000).getUTCHours();
  return hour >= RENT_REMINDERS.sendFromHour && hour < RENT_REMINDERS.sendToHour;
}

/** Replies that withdraw consent. WhatsApp requires an easy way out; the tenant is then never messaged again. */
export function isStopReply(text: string): boolean {
  return /^\s*(stop|berhenti|unsubscribe|henti)\s*[.!]?\s*$/i.test(text);
}

export type WhatsAppConsent = NonNullable<NonNullable<AmTenancy['whatsapp']>['consent']>;
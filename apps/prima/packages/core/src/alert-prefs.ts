// J6 (Fauzan, 11 Nov 2026: "Staff choose their alerts: BUILD"; today everyone gets urgent alerts plus a daily digest).
// Each person chooses: urgent alerts by email (on or off), the daily digest (on or off), and topics they do not want
// (by the topic each alert carries: Leave, Finance, IT job...). Muted topics leave the email and the in-app bell; the
// person's to-do list on Home still shows all their work.
//
// Urgent SAFETY alerts cannot be switched off (rule ALERT-SAFETY-LOCKED): an urgent (red) alert on firearms, a post with
// no guard or a guard not turned up, a serious incident or P1 case, workplace safety (OSH, DOSH) or a personal data
// breach is always sent, even with urgent email off or the topic muted. The list is in rules.ts.
import { RULES } from './rules';
import type { AlertItem, AlertMode } from './alerts';
import { BadRequest } from './service';
import type { Store } from './store';
import type { Id, IsoDateTime, User } from './types';

export interface AlertPrefs {
  /** The person's own user id (one row each). */
  id: Id;
  userId: Id;
  urgent: boolean;
  digest: boolean;
  /** Topics (alert tags) the person does not want; safety topics are never kept here. */
  muted: string[];
  updatedAt: IsoDateTime;
  history: { at: IsoDateTime; what: string }[];
}

export const DEFAULT_ALERT_PREFS = { urgent: true, digest: true, muted: [] as string[] };

/** Whether this topic is a safety topic (never muted). */
export const isSafetyTopic = (tag: string) => RULES.alertSafetyLocked.value.tags.includes(tag);
/** An urgent safety alert: always sent and always shown. */
export const isSafetyAlert = (i: Pick<AlertItem, 'tone' | 'tag'>) => i.tone === 'crit' && isSafetyTopic(i.tag);

/** Topics a person may choose from: the common ones plus any their own alerts carry now. Safety topics are marked. */
export function alertTopics(current: Pick<AlertItem, 'tag'>[]): { tag: string; safety: boolean }[] {
  const tags = new Set<string>([...RULES.alertSafetyLocked.value.tags, ...COMMON_TOPICS, ...current.map((i) => i.tag)]);
  return [...tags].map((tag) => ({ tag, safety: isSafetyTopic(tag) })).sort((a, b) => Number(b.safety) - Number(a.safety) || a.tag.localeCompare(b.tag));
}

/** Topics most staff meet, so the screen can offer them before an alert of that kind has arrived. */
const COMMON_TOPICS = ['Leave', 'Claims', 'Memo', 'Finance', 'Payment requests', 'Staff payroll', 'IT job', 'IT job to check', 'Meeting', 'Meeting action', 'Renewals', 'Licence', 'Tender', 'Clients', 'Appraisal', 'Policy'];

/**
 * Which alerts go out under a person's choices. Email urgent: red items, minus muted topics, none at all when urgent is
 * off, but urgent safety alerts always. Email digest: nothing when the digest is off; else minus muted topics, urgent
 * safety kept. Bell: minus muted topics, urgent safety kept.
 */
export function applyAlertPrefs<T extends Pick<AlertItem, 'tone' | 'tag'>>(items: T[], prefs: Pick<AlertPrefs, 'urgent' | 'digest' | 'muted'> | null, channel: AlertMode | 'bell'): T[] {
  const p = prefs ?? DEFAULT_ALERT_PREFS;
  const muted = new Set(p.muted);
  const keep = (i: T) => isSafetyAlert(i) || !muted.has(i.tag);
  if (channel === 'urgent') return items.filter((i) => isSafetyAlert(i) || (p.urgent && keep(i)));
  if (channel === 'digest') return p.digest ? items.filter(keep) : [];
  return items.filter(keep);
}

export class AlertPrefsService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
  ) {}

  private async installed(): Promise<boolean> {
    return !this.store.hasTable || (await this.store.hasTable('alertPrefs'));
  }

  /** The person's own choices, or the defaults (urgent and digest on) when none are saved or the module is missing. */
  async get(user: User): Promise<AlertPrefs | null> {
    if (!(await this.installed())) return null;
    return (await this.store.get('alertPrefs', user.id)) ?? null;
  }

  async mine(user: User, current: AlertItem[]) {
    const ready = await this.installed();
    const p = ready ? await this.get(user) : null;
    return {
      ready,
      urgent: p?.urgent ?? true,
      digest: p?.digest ?? true,
      muted: p?.muted ?? [],
      updatedAt: p?.updatedAt ?? null,
      topics: alertTopics(current),
      safety: RULES.alertSafetyLocked.value.tags,
    };
  }

  /** Saves the person's own choices. Safety topics cannot be muted. Nobody sets another person's alerts. */
  async set(user: User, input: { urgent: boolean; digest: boolean; muted: string[] }) {
    if (user.integration || user.role === 'guard' || user.role === 'site_device') throw new BadRequest('Alerts are for staff sign-ins.');
    if (!(await this.installed())) throw new BadRequest('Choosing alerts is not installed in this database yet (module alert-prefs-v1, run by the CEO).');
    if (typeof input.urgent !== 'boolean' || typeof input.digest !== 'boolean') throw new BadRequest('Say whether urgent alerts and the daily digest are on.');
    const raw = (Array.isArray(input.muted) ? input.muted : []).map((t) => String(t).trim().slice(0, 60)).filter(Boolean);
    const safety = raw.filter(isSafetyTopic);
    if (safety.length) throw new BadRequest(`Urgent safety alerts cannot be switched off: ${safety.join(', ')}.`);
    const muted = [...new Set(raw)].slice(0, 100).sort();
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('alertPrefs', user.id);
      const cur = await tx.get('alertPrefs', user.id);
      const what = `urgent ${input.urgent ? 'on' : 'off'}, digest ${input.digest ? 'on' : 'off'}, ${muted.length} topic${muted.length === 1 ? '' : 's'} muted`;
      const row: AlertPrefs = { id: user.id, userId: user.id, urgent: input.urgent, digest: input.digest, muted, updatedAt: at, history: [...(cur?.history ?? []), { at, what }].slice(-20) };
      if (cur) await tx.update('alertPrefs', user.id, row);
      else await tx.insert('alertPrefs', row);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'alerts.prefs', entity: 'user', entityId: user.id, summary: `Alert choices saved: ${what}.` });
      return row;
    });
  }
}

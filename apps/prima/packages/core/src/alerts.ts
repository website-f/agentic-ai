import type { HomeItem } from "./service";
import type { HomeTone } from "./service";


export type AlertChannel = 'email' | 'teams';
export type AlertMode = 'urgent' | 'digest';

export interface AlertItem {
  /** Stable identity of the item: the same work on the same record gives the same key on every run. */
  key: string;
  tone: HomeTone;
  tag: string;
  title: string;
  detail: string;
  /** The Prima screen where the work is done. */
  view: string;
}

/** Most items in one message; the rest are counted, not listed. */
export const ALERT_MAX_LINES = 15;

/** The key leaves out the wording that changes daily (counts of days, "overdue") so one piece of work alerts once. */
export function alertItem(item: HomeItem): AlertItem {
  const go = item.go as unknown as Record<string, unknown>;
  const ref = ['companyId', 'caseId', 'siteId', 'personId', 'tenderId'].map((k) => (typeof go[k] === 'string' ? `${k}=${go[k]}` : '')).join('|');
  return {
    key: [item.tag, item.title, String(go.view ?? ''), ref].join('␟'),
    tone: item.tone,
    tag: item.tag,
    title: item.title,
    detail: item.detail,
    view: String(go.view ?? 'home'),
  };
}

/** Same work listed twice (two sources) is alerted once. */
export function uniqueAlerts(items: AlertItem[]): AlertItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

/**
 * Which items to send now.
 * - urgent: red items whose key has not been sent to this person yet;
 * - digest: everything still waiting that is not just "fine" (ok/neutral), once a day.
 */
export function planAlerts(items: AlertItem[], mode: AlertMode, alreadySent: (key: string) => boolean): AlertItem[] {
  const open = uniqueAlerts(items);
  if (mode === 'urgent') return open.filter((i) => i.tone === 'crit' && !alreadySent(i.key));
  return open.filter((i) => i.tone === 'crit' || i.tone === 'warn' || i.tone === 'info');
}

const TONE_RANK: Record<HomeTone, number> = { crit: 0, warn: 1, info: 2, neutral: 3, ok: 4 };

/** The in-app bell (Fauzan, 5 Nov 2026: alerts in Teams, email AND Prima): the same items, red first. */
export function inAppAlerts(items: AlertItem[]): AlertItem[] {
  return planAlerts(items, 'digest', () => true)
    .map((i, n) => ({ i, n }))
    .sort((a, b) => TONE_RANK[a.i.tone] - TONE_RANK[b.i.tone] || a.n - b.n)
    .map((x) => x.i);
}

export interface AlertMessage {
  subject: string;
  text: string;
  html: string;
}

const TONE_BM: Record<HomeTone, string> = { crit: 'SEGERA', warn: 'Perlu tindakan', info: 'Untuk makluman', neutral: 'Makluman', ok: 'Selesai' };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A Prima link to the screen, when the address of Prima is known; otherwise no link. */
function link(appUrl: string | null, view: string): string | null {
  if (!appUrl) return null;
  return `${appUrl.replace(/\/+$/, '')}/#${encodeURIComponent(view)}`;
}

/** The email for one person. Item titles are shown as they are written in Prima. */
export function renderAlertEmail(mode: AlertMode, items: AlertItem[], opts: { appUrl: string | null; today: string }): AlertMessage {
  const shown = items.slice(0, ALERT_MAX_LINES);
  const more = items.length - shown.length;
  const n = items.length;
  const subject =
    mode === 'urgent'
      ? `Prima Secure: ${n} perkara SEGERA perlu tindakan anda`
      : `Prima Secure: ${n} perkara perlu tindakan anda hari ini (${opts.today})`;
  const lead =
    mode === 'urgent'
      ? 'Perkara segera ini baru muncul dalam senarai kerja anda di Prima Secure.'
      : 'Ini senarai kerja anda yang masih menunggu di Prima Secure.';
  const foot = 'Buka Prima Secure untuk bertindak. E-mel ini dihantar secara automatik; jangan balas. Soalan: hubungi Pengarah Projek atau Jabatan IT.';
  const lines = shown.map((i) => {
    const url = link(opts.appUrl, i.view);
    return { i, url, text: `- [${TONE_BM[i.tone]}] ${i.tag}: ${i.title}${i.detail ? ` (${i.detail})` : ''}${url ? `\n  ${url}` : ''}` };
  });
  const text = [lead, '', ...lines.map((l) => l.text), ...(more > 0 ? [`- dan ${more} lagi dalam Prima Secure.`] : []), '', foot].join('\n');
  const html = [
    `<p>${esc(lead)}</p>`,
    '<ul>',
    ...lines.map(
      (l) =>
        `<li><strong>${esc(TONE_BM[l.i.tone])}</strong> · ${esc(l.i.tag)}: ${l.url ? `<a href="${esc(l.url)}">${esc(l.i.title)}</a>` : esc(l.i.title)}${l.i.detail ? `<br><small>${esc(l.i.detail)}</small>` : ''}</li>`,
    ),
    ...(more > 0 ? [`<li>dan ${more} lagi dalam Prima Secure.</li>`] : []),
    '</ul>',
    `<p><small>${esc(foot)}</small></p>`,
  ].join('');
  return { subject, text, html };
}

/**
 * A Teams channel post (Adaptive Card 1.4) for one department's new urgent items.
 * A channel is seen by everyone in it, and channel membership is not Prima's permission check, so the post carries
 * only how many new urgent items of each kind are waiting: never a title, detail, name or record text. Each person
 * sees their own items in their email and in the Prima bell.
 */
export function renderTeamsCard(department: string, items: AlertItem[], opts: { appUrl: string | null }): Record<string, unknown> {
  const byTag = new Map<string, number>();
  for (const i of items) byTag.set(i.tag, (byTag.get(i.tag) ?? 0) + 1);
  const kinds = [...byTag].slice(0, ALERT_MAX_LINES);
  const more = byTag.size - kinds.length;
  const body: Record<string, unknown>[] = [
    { type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: `Prima Secure: ${items.length} perkara SEGERA baharu (${department})` },
    ...kinds.map(([tag, n]) => ({ type: 'TextBlock', wrap: true, text: `**${tag}**: ${n}` })),
    ...(more > 0 ? [{ type: 'TextBlock', wrap: true, isSubtle: true, text: `dan ${more} jenis lagi dalam Prima Secure.` }] : []),
    { type: 'TextBlock', wrap: true, text: 'Butiran ada dalam e-mel setiap orang dan loceng amaran dalam Prima Secure.' },
    { type: 'TextBlock', wrap: true, isSubtle: true, size: 'Small', text: 'Dihantar secara automatik oleh Prima Secure. Tindakan dibuat dalam Prima Secure.' },
  ];
  const url = link(opts.appUrl, 'home');
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(url ? { actions: [{ type: 'Action.OpenUrl', title: 'Buka Prima Secure', url }] } : {}),
        },
      },
    ],
  };
}
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ClientShareReport } from '@prima/core';

// Client report links (Fauzan, 3 Nov 2026: "Shared report links first"). The link carries which company, client and
// link it is, signed with SHARE_LINK_SECRET. The page re-checks the link on every open (not revoked, not expired),
// so a signature alone never opens a report. With no secret (or a short one) in production, links are switched off.

const MIN_SECRET = 32;
const DEV_SECRET = 'development-only-client-report-link-key';

export function shareSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.SHARE_LINK_SECRET ?? '';
  if (s.length >= MIN_SECRET && s !== DEV_SECRET) return s;
  return env.NODE_ENV === 'production' ? null : DEV_SECRET;
}

/** The public address links start with, e.g. <staging-api-url>. Unset in production means links are off. */
export function shareBase(env: NodeJS.ProcessEnv = process.env): string | null {
  const b = (env.SHARE_LINK_BASE ?? '').trim().replace(/\/+$/, '');
  if (b) return /^https:\/\//.test(b) || env.NODE_ENV !== 'production' ? b : null;
  return env.NODE_ENV === 'production' ? null : '';
}

export interface ShareRef {
  c: string;
  k: string;
  l: string;
}

function mac(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`client-share.${payload}`).digest('base64url');
}

export function signShare(ref: ShareRef, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ c: ref.c, k: ref.k, l: ref.l })).toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

export function verifyShare(token: string, secret: string | null): ShareRef | null {
  if (!secret || typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const a = createHash('sha256').update(mac(secret, payload)).digest();
  const b = createHash('sha256').update(sig).digest();
  if (!timingSafeEqual(a, b)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<ShareRef>;
    const ok = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120;
    return ok(v.c) && ok(v.k) && ok(v.l) ? { c: v.c, k: v.k, l: v.l } : null;
  } catch {
    return null;
  }
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

const money = (n: number) => `RM ${n.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SHARE_STYLE = `body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f6f7f9;color:#1b1f24}
main{max-width:860px;margin:0 auto;padding:24px 16px}h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px}
.muted{color:#5b6470;font-size:13px}.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;background:#fff}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e3e6ea;font-size:14px}th{background:#eef1f4}
.note{background:#fff8e6;border:1px solid #f0d58a;padding:10px 12px;border-radius:6px;font-size:13px;margin-top:16px}
@media (prefers-color-scheme:dark){body{background:#14171b;color:#e6e9ed}table{background:#1c2026}th{background:#262b33}
th,td{border-color:#2f353e}.muted{color:#9aa4b0}.note{background:#2a2414;border-color:#5a4a1e}}`;

/** CSP for the page: no scripts, no images, no forms, only the one inline style above (by its hash). */
export function shareCsp(): string {
  const h = createHash('sha256').update(SHARE_STYLE).digest('base64');
  return `default-src 'none'; style-src 'sha256-${h}'; frame-ancestors 'none'; form-action 'none'; base-uri 'none'`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${SHARE_STYLE}</style></head><body><main>${body}</main></body></html>`;
}

/** The same answer for a forged, revoked, expired or unknown link, so the page never says which. */
export function shareGonePage(): string {
  return page('Report link', `<h1>This report link is not available</h1><p class="muted">It may have expired or been withdrawn. Please ask your security company for a new link.</p>`);
}

export function shareReportPage(r: ClientShareReport, opts: { token?: string } = {}): string {
  const sites = r.sites.length
    ? `<div class="wrap"><table><thead><tr><th>Site</th><th>Patrol checkpoints scanned</th><th>Supervisor visits</th></tr></thead><tbody>${r.sites
        .map((s) => `<tr><td>${esc(s.name)}</td><td>${s.patrolScans}</td><td>${s.visits}</td></tr>`)
        .join('')}</tbody></table></div>`
    : `<p class="muted">No sites are listed for this account.</p>`;
  const incidents = r.incidents.length
    ? `<div class="wrap"><table><thead><tr><th>Ref</th><th>Date</th><th>Site</th><th>Kind</th><th>Severity</th><th>Status</th></tr></thead><tbody>${r.incidents
        .map((c) => `<tr><td>${esc(c.ref)}</td><td>${esc(c.on)}</td><td>${esc(c.site)}</td><td>${esc(c.kind)}</td><td>${esc(c.severity)}</td><td>${esc(c.status)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : `<p class="muted">No incidents, emergency alerts or complaints were recorded at your sites in this period.</p>`;
  const invoices = r.invoices.length
    ? `<div class="wrap"><table><thead><tr><th>Month</th><th>Amount</th><th>Sent on</th></tr></thead><tbody>${r.invoices
        .map((x) => `<tr><td>${esc(x.period)}</td><td>${esc(money(x.amount))}</td><td>${esc(x.sentOn ?? 'Not yet sent')}</td></tr>`)
        .join('')}</tbody></table></div><p class="muted">This lists invoices sent for months wholly inside this period. It is not a statement of account and does not show payments.</p>`
    : `<p class="muted">No invoices are recorded for this period.</p>`;
  // J1 (11 Nov 2026): a report kept as a file opens as its PDF from the link (a relative address: the token's own path).
  const pdf = new Set(r.pdfPeriods ?? []);
  const token = opts.token ?? null;
  const reportItem = (p: string) => (token && pdf.has(p) ? `<a href="${esc(token)}/doc/report/${esc(p)}">${esc(p)} (PDF)</a>` : esc(p));
  const reports = r.reports.length ? `<p>Monthly service reports sent for: ${r.reports.map(reportItem).join(', ')}.</p>` : `<p class="muted">No monthly service reports recorded for this period.</p>`;
  return page(
    `Service report: ${r.clientName}`,
    `<h1>Service report for ${esc(r.clientName)}</h1>
<p class="muted">From ${esc(r.companyName)}. Period ${esc(r.from)} to ${esc(r.to)}. Prepared ${esc(r.generatedAt.slice(0, 16).replace('T', ' '))}. This link works until ${esc(r.expiresOn)}.</p>
<h2>Your sites</h2>${sites}<h2>Incidents at your sites</h2>${incidents}<h2>Invoices</h2>${invoices}<h2>Monthly reports</h2>${reports}
<p class="note">Read-only summary from your security company's records. For questions or corrections, contact your account manager.</p>`,
  );
}

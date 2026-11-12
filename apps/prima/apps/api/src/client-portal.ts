// J1 (P100, Fauzan 11 Nov 2026): the client portal's pages and the signatures behind them. Like the report links
// (share-links.ts): plain escaped HTML, no scripts, one hashed inline style, forms posted to the same address only.
// The personal link names the company, the client and the person (signed with SHARE_LINK_SECRET); the access code the
// OM gave proves it is them; the session is a signed cookie (HttpOnly, Secure, SameSite=Strict) that ends after 12 hours
// or at once when the OM resets the code or closes the sign-in. Bahasa Melayu by default, English on request.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { PORTAL_SESSION_HOURS } from '@prima/core';
import { SHARE_STYLE } from './share-links';

export interface PortalRef {
  c: string;
  k: string;
  u: string;
}

const mac = (secret: string, kind: string, payload: string) => createHmac('sha256', secret).update(`client-portal-${kind}.${payload}`).digest('base64url');
const same = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
const ok = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120;

export function signPortalRef(ref: PortalRef, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ c: ref.c, k: ref.k, u: ref.u })).toString('base64url');
  return `${payload}.${mac(secret, 'link', payload)}`;
}

export function verifyPortalRef(token: string, secret: string | null): PortalRef | null {
  if (!secret || typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined || !same(mac(secret, 'link', payload), sig)) return null;
  try {
    const v = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Partial<PortalRef>;
    return ok(v.c) && ok(v.k) && ok(v.u) ? { c: v.c, k: v.k, u: v.u } : null;
  } catch {
    return null;
  }
}

export interface PortalSession extends PortalRef {
  v: number;
  exp: number;
}

export const PORTAL_COOKIE = 'prima_portal';

export function signPortalSession(s: PortalSession, secret: string): string {
  const payload = Buffer.from(JSON.stringify(s)).toString('base64url');
  return `${payload}.${mac(secret, 'session', payload)}`;
}

/** The session for this link from the cookie, or null (another person's, expired, forged). */
export function portalSessionFor(cookieHeader: string | undefined, ref: PortalRef, secret: string | null, nowMs = Date.now()): PortalSession | null {
  if (!secret) return null;
  const raw = (cookieHeader ?? '').split(';').map((x) => x.trim()).find((x) => x.startsWith(`${PORTAL_COOKIE}=`));
  if (!raw) return null;
  const [payload, sig, extra] = raw.slice(PORTAL_COOKIE.length + 1).split('.');
  if (!payload || !sig || extra !== undefined || !same(mac(secret, 'session', payload), sig)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString()) as PortalSession;
    if (s.c !== ref.c || s.k !== ref.k || s.u !== ref.u || typeof s.v !== 'number' || typeof s.exp !== 'number' || s.exp < nowMs) return null;
    return s;
  } catch {
    return null;
  }
}

export function portalCookie(s: PortalSession, secret: string): string {
  return `${PORTAL_COOKIE}=${signPortalSession(s, secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${PORTAL_SESSION_HOURS * 3600}`;
}
export const PORTAL_COOKIE_CLEAR = `${PORTAL_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

/** A per-session form check: a page from this session only (on top of the SameSite cookie). */
export function portalFormKey(s: PortalSession, secret: string): string {
  return mac(secret, 'form', `${s.c}.${s.k}.${s.u}.${s.v}.${s.exp}`).slice(0, 32);
}

/** CSP: no scripts, no images, the one inline style, forms only to this address. */
export function portalCsp(): string {
  const h = createHash('sha256').update(PORTAL_STYLE).digest('base64');
  return `default-src 'none'; style-src 'sha256-${h}'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'`;
}

export const PORTAL_STYLE = `${SHARE_STYLE}
form{display:grid;gap:10px;background:#fff;border:1px solid #e3e6ea;border-radius:8px;padding:14px;margin:8px 0}
label{display:grid;gap:4px;font-size:14px}input,select,textarea{font:inherit;padding:10px;border:1px solid #c9ced4;border-radius:6px;min-height:44px;box-sizing:border-box;width:100%}
button{font:inherit;min-height:44px;padding:0 18px;border-radius:6px;border:0;background:#13895f;color:#fff;font-weight:600;cursor:pointer}
button.plain{background:transparent;color:inherit;border:1px solid #c9ced4}.top{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center}
.ok{background:#e1f2e7;border:1px solid #9fd3b2;padding:10px 12px;border-radius:6px}.bad{background:#fbe4df;border:1px solid #e9a99c;padding:10px 12px;border-radius:6px}
.tag{display:inline-block;padding:2px 8px;border-radius:99px;background:#eef1f4;font-size:12px}.lang a{color:inherit;margin-left:8px}
ul.list{list-style:none;padding:0;margin:0}ul.list li{background:#fff;border:1px solid #e3e6ea;border-radius:8px;padding:10px 12px;margin:6px 0}
fieldset{border:0;padding:0;margin:0;display:flex;gap:8px;flex-wrap:wrap}fieldset label{display:flex;align-items:center;gap:6px;min-height:44px}fieldset input{width:auto;min-height:auto}
@media (prefers-color-scheme:dark){form,ul.list li{background:#1c2026;border-color:#2f353e}input,select,textarea{background:#14171b;color:#e6e9ed;border-color:#2f353e}
.ok{background:#173826;border-color:#2a6a46}.bad{background:#3a1d17;border-color:#7a3a2e}.tag{background:#262b33}button.plain{border-color:#2f353e}}`;

export type Lang = 'ms' | 'en';
const T = {
  ms: {
    title: 'Portal pelanggan',
    signInTitle: 'Log masuk portal pelanggan',
    signInLead: 'Masukkan kod akses yang diberi oleh Pengurus Operasi anda. Kod ini untuk anda seorang sahaja.',
    code: 'Kod akses',
    signIn: 'Log masuk',
    wrong: 'Kod tidak betul. Selepas 5 kali salah, log masuk dikunci 30 minit.',
    locked: 'Log masuk dikunci sementara kerana kod salah terlalu banyak kali. Cuba lagi selepas 30 minit atau minta kod baru.',
    gone: 'Log masuk ini tidak tersedia. Minta pautan atau kod baru daripada syarikat keselamatan anda.',
    hello: 'Selamat datang',
    from: 'Daripada',
    signOut: 'Log keluar',
    sites: 'Tapak anda',
    noSites: 'Tiada tapak disenaraikan untuk akaun ini.',
    reports: 'Laporan perkhidmatan bulanan',
    noReports: 'Belum ada laporan bulanan.',
    slips: 'Slip pengesahan kerja yang ditandatangani',
    noSlips: 'Belum ada slip pengesahan.',
    pdf: 'PDF',
    notFile: 'disimpan di tempat lain',
    signedBy: 'ditandatangani oleh',
    say: 'Beri maklum balas atau buat permintaan',
    kind: 'Apa yang anda mahu hantar?',
    rating: 'Penilaian perkhidmatan',
    complaint: 'Aduan',
    request: 'Permintaan',
    score: 'Penilaian (1 sangat tidak puas hati, 5 sangat puas hati)',
    site: 'Tapak (jika berkenaan)',
    anySite: 'Semua atau tiada tapak tertentu',
    reqKind: 'Jenis permintaan (untuk permintaan sahaja)',
    text: 'Butiran',
    send: 'Hantar',
    sentRating: 'Terima kasih. Penilaian anda telah dihantar.',
    sentComplaint: 'Aduan anda telah dihantar kepada Pengurus Operasi.',
    sentRequest: 'Permintaan anda telah dihantar kepada Pengurus Operasi.',
    raised: 'Yang anda hantar di sini',
    none: 'Belum ada.',
    open: 'Dalam tindakan',
    done: 'Selesai',
    declined: 'Ditolak',
    answer: 'Jawapan',
    note: 'Halaman ini hanya menunjukkan rekod pelanggan anda sendiri. Untuk perkara segera, hubungi pengurus akaun atau talian kecemasan anda.',
    switch: 'English',
  },
  en: {
    title: 'Client portal',
    signInTitle: 'Sign in to the client portal',
    signInLead: 'Type the access code your Operations Manager gave you. The code is for you only.',
    code: 'Access code',
    signIn: 'Sign in',
    wrong: 'The code is not right. After 5 wrong tries the sign-in is locked for 30 minutes.',
    locked: 'The sign-in is locked for now after too many wrong codes. Try again after 30 minutes or ask for a new code.',
    gone: 'This sign-in is not available. Ask your security company for a new link or code.',
    hello: 'Welcome',
    from: 'From',
    signOut: 'Sign out',
    sites: 'Your sites',
    noSites: 'No sites are listed for this account.',
    reports: 'Monthly service reports',
    noReports: 'No monthly reports yet.',
    slips: 'Signed work acknowledgement slips',
    noSlips: 'No acknowledgement slips yet.',
    pdf: 'PDF',
    notFile: 'kept elsewhere',
    signedBy: 'signed by',
    say: 'Give feedback or make a request',
    kind: 'What would you like to send?',
    rating: 'Rate the service',
    complaint: 'Complaint',
    request: 'Request',
    score: 'Rating (1 very unhappy, 5 very happy)',
    site: 'Site (if it is about one)',
    anySite: 'All or no particular site',
    reqKind: 'Kind of request (requests only)',
    text: 'Details',
    send: 'Send',
    sentRating: 'Thank you. Your rating was sent.',
    sentComplaint: 'Your complaint was sent to the Operations Manager.',
    sentRequest: 'Your request was sent to the Operations Manager.',
    raised: 'What you sent here',
    none: 'Nothing yet.',
    open: 'Being handled',
    done: 'Done',
    declined: 'Declined',
    answer: 'Answer',
    note: "This page shows only your own client's records. For anything urgent, call your account manager or the emergency line.",
    switch: 'Bahasa Melayu',
  },
} as const;
type Words = Record<keyof (typeof T)['ms'], string>;

export const langOf = (q: unknown): Lang => (q === 'en' ? 'en' : 'ms');

const esc = (v: unknown): string =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

function page(lang: Lang, title: string, body: string, other: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title><style>${PORTAL_STYLE}</style></head><body><main>
<p class="lang muted" style="text-align:right">${other}</p>${body}</main></body></html>`;
}

const switchLink = (w: Words, here: string, lang: Lang) => `<a href="${esc(here)}?lang=${lang === 'ms' ? 'en' : 'ms'}">${esc(w.switch)}</a>`;

export function portalSignInPage(lang: Lang, state: 'start' | 'wrong' | 'locked' | 'gone'): string {
  const w = T[lang];
  if (state === 'gone') return page(lang, w.title, `<h1>${esc(w.title)}</h1><p class="bad">${esc(w.gone)}</p>`, switchLink(w, 'start', lang));
  return page(
    lang,
    w.signInTitle,
    `<h1>${esc(w.signInTitle)}</h1><p class="muted">${esc(w.signInLead)}</p>
${state === 'wrong' ? `<p class="bad">${esc(w.wrong)}</p>` : state === 'locked' ? `<p class="bad">${esc(w.locked)}</p>` : ''}
<form method="post" action="sign-in?lang=${lang}"><label>${esc(w.code)}<input name="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required maxlength="40" placeholder="XXXX-XXXX-XXXX-XXXX"></label><button>${esc(w.signIn)}</button></form>
<p class="note">${esc(w.note)}</p>`,
    switchLink(w, 'start', lang),
  );
}

export interface PortalHomeView {
  clientName: string;
  companyName: string;
  person: { name: string; post: string };
  sites: { id: string; name: string }[];
  reports: { period: string; pdf: boolean }[];
  slips: { period: string; signedOn: string; signer: string; pdf: boolean }[];
  requestKinds: { key: string; label: string }[];
  raised: { kind: 'request' | 'complaint' | 'rating'; at: string; from: string; what: string; status: string; answer: string | null }[];
}

export function portalHomePage(lang: Lang, h: PortalHomeView, formKey: string, sent: string | null, problem: string | null): string {
  const w = T[lang];
  const sentText = sent === 'rating' ? w.sentRating : sent === 'complaint' ? w.sentComplaint : sent === 'request' ? w.sentRequest : null;
  const list = <X,>(xs: X[], empty: string, row: (x: X) => string) => (xs.length ? `<ul class="list">${xs.map(row).join('')}</ul>` : `<p class="muted">${esc(empty)}</p>`);
  const status = (s: string) => `<span class="tag">${esc(s === 'open' ? w.open : s === 'declined' ? w.declined : w.done)}</span>`;
  const kindWord = (k: string) => (k === 'rating' ? w.rating : k === 'complaint' ? w.complaint : w.request);
  return page(
    lang,
    `${w.title}: ${h.clientName}`,
    `<div class="top"><div><h1>${esc(h.clientName)}</h1><p class="muted">${esc(w.hello)}, ${esc(h.person.name)} (${esc(h.person.post)}). ${esc(w.from)} ${esc(h.companyName)}.</p></div>
<form method="post" action="sign-out?lang=${lang}" style="background:none;border:0;padding:0"><input type="hidden" name="f" value="${esc(formKey)}"><button class="plain">${esc(w.signOut)}</button></form></div>
${sentText ? `<p class="ok">${esc(sentText)}</p>` : ''}${problem ? `<p class="bad">${esc(problem)}</p>` : ''}
<h2>${esc(w.say)}</h2>
<form method="post" action="send?lang=${lang}"><input type="hidden" name="f" value="${esc(formKey)}">
<fieldset><legend class="muted">${esc(w.kind)}</legend>
<label><input type="radio" name="kind" value="rating" required> ${esc(w.rating)}</label>
<label><input type="radio" name="kind" value="complaint"> ${esc(w.complaint)}</label>
<label><input type="radio" name="kind" value="request"> ${esc(w.request)}</label></fieldset>
<label>${esc(w.score)}<select name="score"><option value=""></option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${n}</option>`).join('')}</select></label>
<label>${esc(w.reqKind)}<select name="requestKind"><option value=""></option>${h.requestKinds.map((k) => `<option value="${esc(k.key)}">${esc(k.label)}</option>`).join('')}</select></label>
<label>${esc(w.site)}<select name="siteId"><option value="">${esc(w.anySite)}</option>${h.sites.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select></label>
<label>${esc(w.text)}<textarea name="text" rows="4" maxlength="500"></textarea></label>
<button>${esc(w.send)}</button></form>
<h2>${esc(w.raised)}</h2>${list(h.raised, w.none, (r) => `<li><strong>${esc(kindWord(r.kind))}</strong> ${status(r.status)} <span class="muted">${esc(r.at.slice(0, 10))}</span><br>${esc(r.what)}${r.answer ? `<br><span class="muted">${esc(w.answer)}:</span> ${esc(r.answer)}` : ''}</li>`)}
<h2>${esc(w.reports)}</h2>${list(h.reports, w.noReports, (r) => `<li>${esc(r.period)} · ${r.pdf ? `<a href="doc/report/${esc(r.period)}">${esc(w.pdf)}</a>` : `<span class="muted">${esc(w.notFile)}</span>`}</li>`)}
<h2>${esc(w.slips)}</h2>${list(h.slips, w.noSlips, (s) => `<li>${esc(s.period)} · ${esc(w.signedBy)} ${esc(s.signer)}, ${esc(s.signedOn)} · ${s.pdf ? `<a href="doc/slip/${esc(s.period)}">${esc(w.pdf)}</a>` : `<span class="muted">${esc(w.notFile)}</span>`}</li>`)}
<h2>${esc(w.sites)}</h2>${list(h.sites, w.noSites, (s) => `<li>${esc(s.name)}</li>`)}
<p class="note">${esc(w.note)}</p>`,
    switchLink(w, 'home', lang),
  );
}

/** A stored data URL as its bytes and type (only PDF, JPEG or PNG). */
export function docBytes(dataUrl: string): { mime: string; bytes: Buffer } | null {
  const m = /^data:(application\/pdf|image\/jpeg|image\/png);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  return m ? { mime: m[1], bytes: Buffer.from(m[2], 'base64') } : null;
}

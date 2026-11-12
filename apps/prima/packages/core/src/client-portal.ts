// J1 (Fauzan, 11 Nov 2026: "Client portal: BUILD. Managed by the OM, monitored by the company manager, the COO
// oversees"). The next step after the read-only report links (client-share.ts): a named person at the client signs in
// to their own portal page with a personal link and an access code the Operations Manager gives them, and there
//   - sees only their own client's sites, the monthly service reports and the signed acknowledgement slips as PDFs;
//   - rates the service (1 to 5) and writes feedback, raises a complaint, or makes a request.
// Nothing new is kept for the client's words: a rating goes on the client's ratings, a complaint on its complaints and a
// request on its requests, marked as from the portal, so the OM answers them where they already work (Clients) and the
// existing client-care counts include them. The portal shows the client only the outcome of what they raised there.
// The access lives on the client record like the report links (no new table): the OM opens, resets or closes it; the
// company manager sees it and may close it; the COO sees every company's. The code is shown once and kept only as a hash.
import { AccessDenied, isGroupLeader } from './access';
import { sha256Hex } from './audit';
import { CLIENT_REQUEST_KIND } from './crm';
import { RULES } from './rules';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { addDays, dateOf, toMs } from './time';
import type { ClientAccount, ClientComplaint, ClientRequest, ClientRequestKind, EvidenceDoc, Id, IsoDateTime, User } from './types';

/** One person at the client with a portal sign-in. Kept on the client record (ClientAccount.portalUsers). */
export interface ClientPortalUser {
  id: Id;
  name: string;
  /** Their post at the client (Facilities Manager, Head of Security). */
  post: string;
  /** sha256 of the access code bound to this sign-in; the code itself is shown once, to the OM, and never kept. */
  codeHash: string;
  failedTries: number;
  lockedUntil: IsoDateTime | null;
  /** Raised by every code reset, closing and sign-out everywhere, so older sessions stop at once. */
  sessionVersion: number;
  lastSignInAt: IsoDateTime | null;
  by: string;
  byId: Id;
  at: IsoDateTime;
  resets: { by: string; at: IsoDateTime; reason: string }[];
  closed: { by: string; byId: Id; at: IsoDateTime; reason: string } | null;
}

/** Most open portal sign-ins one client may have. */
export const PORTAL_MAX_USERS = 5;
/** A client-portal session lasts at most this long; then the client signs in again with the code. */
export const PORTAL_SESSION_HOURS = 12;

/** Letters and digits that cannot be mistaken for one another (the same set as guard phone codes). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const normalCode = (c: string) => String(c ?? '').toUpperCase().replace(/[\s-]/g, '');
export const portalCodeHash = (portalUserId: Id, code: string) => sha256Hex(`client-portal.${portalUserId}.${normalCode(code)}`);

/** A new access code: 16 characters (about 79 bits), shown as four groups of four. */
export function newPortalCode(): string {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  const raw = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
  return raw.match(/.{4}/g)!.join('-');
}

export type PortalRole = 'om' | 'cm' | 'coo';

/** OM manages; the company manager (and the company desk) monitors; the COO and the group leaders oversee. */
export function portalRole(u: User, actOn: boolean): PortalRole | null {
  if (u.integration) return null;
  if (actOn) return 'om';
  if (isGroupLeader(u)) return 'coo';
  if (u.role === 'company_manager' || u.role === 'admin_exec') return 'cm';
  return null;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const strip = (p: ClientPortalUser) => {
  const { codeHash: _h, ...rest } = p;
  void _h;
  return rest;
};

export interface ClientPortalDeps {
  /** Clients this person can see (the client screen's scope). */
  scope(user: User): Promise<ClientAccount[]>;
  /** Whether this person acts on this client (Operations in the area: the OM). */
  actsOn(user: User, a: ClientAccount): Promise<boolean>;
}

/** What the portal pages say to a client when a sign-in or a page is refused; the same words for every cause. */
export const PORTAL_GONE = 'This sign-in is not available. Ask your security company for a new link or code.';

export class ClientPortalService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
    private deps: ClientPortalDeps,
  ) {}

  // ---------- Staff: the OM, the company manager and the COO ----------

  private async staffAccount(user: User, clientId: Id): Promise<{ a: ClientAccount; role: PortalRole }> {
    const a = (await this.deps.scope(user)).find((x) => x.id === String(clientId ?? '').slice(0, 120));
    if (!a) throw new NotFound('Client');
    const role = portalRole(user, await this.deps.actsOn(user, a));
    if (!role) throw new AccessDenied('view', '(the Operations Manager, the company manager and the COO)');
    if (role === 'cm' && !user.companyIds.includes(a.companyId)) throw new AccessDenied('view', a.companyId);
    return { a, role };
  }

  /** Every client this person sees, with its portal sign-ins and what came in through the portal. */
  async desk(user: User) {
    const accounts = (await this.deps.scope(user)).filter((a) => a.stage !== 'ended');
    const rows = [];
    let anyRole: PortalRole | null = null;
    for (const a of accounts) {
      const role = portalRole(user, await this.deps.actsOn(user, a));
      if (!role || (role === 'cm' && !user.companyIds.includes(a.companyId))) continue;
      anyRole = anyRole === 'om' ? 'om' : role;
      const users = (a.portalUsers ?? []).map((p) => ({ ...strip(p), open: !p.closed, locked: !!p.lockedUntil && toMs(p.lockedUntil) > toMs(this.now()) }));
      const requests = (a.requests ?? []).filter((q) => q.viaPortal);
      const complaints = (a.complaints ?? []).filter((c) => c.via === 'portal');
      const ratings = a.ratings.filter((r) => r.via === 'portal');
      rows.push({
        clientId: a.id,
        name: a.name,
        companyId: a.companyId,
        canManage: role === 'om',
        canClose: role === 'om' || role === 'cm',
        users,
        openUsers: users.filter((u) => u.open).length,
        lastSignInAt: users.map((u) => u.lastSignInAt).filter((x): x is string => !!x).sort().at(-1) ?? null,
        waiting: [
          ...requests.filter((q) => q.status === 'open').map((q) => ({ kind: 'request' as const, id: q.id, at: q.at, from: q.from, what: `${CLIENT_REQUEST_KIND[q.kind]}: ${q.what}` })),
          ...complaints.filter((c) => !c.resolvedAt).map((c) => ({ kind: 'complaint' as const, id: c.id, at: c.at, from: c.from, what: c.what })),
        ].sort((x, y) => x.at.localeCompare(y.at)),
        lastRating: ratings.at(-1) ?? null,
      });
    }
    if (!anyRole && !isGroupLeader(user) && !['company_manager', 'admin_exec'].includes(user.role)) throw new AccessDenied('view', '(the Operations Manager, the company manager and the COO)');
    const today = dateOf(this.now());
    return {
      role: anyRole ?? portalRole(user, false),
      today,
      clients: rows.sort((x, y) => y.waiting.length - x.waiting.length || x.name.localeCompare(y.name)),
      counts: {
        clients: rows.length,
        withPortal: rows.filter((r) => r.openUsers > 0).length,
        waiting: rows.reduce((n, r) => n + r.waiting.length, 0),
        waitingOver3Days: rows.reduce((n, r) => n + r.waiting.filter((w) => w.at.slice(0, 10) < addDays(today, -3)).length, 0),
      },
    };
  }

  /** The OM opens a portal sign-in for a named person at the client. Returns the code once. */
  async open(user: User, clientId: Id, input: { name: string; post: string }) {
    const { a, role } = await this.staffAccount(user, clientId);
    if (role !== 'om') throw new AccessDenied('view', '(the Operations Manager in the area opens client portal sign-ins)');
    if (a.stage === 'ended') throw new BadRequest('This client has ended.');
    const name = clean(input.name, 120);
    const post = clean(input.post, 120);
    if (name.length < 3) throw new BadRequest("Give the client person's name.");
    if (post.length < 2) throw new BadRequest('Give their post at the client.');
    const at = this.now();
    const id = `cpu-${toMs(at).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const code = newPortalCode();
    const p: ClientPortalUser = { id, name, post, codeHash: portalCodeHash(id, code), failedTries: 0, lockedUntil: null, sessionVersion: 1, lastSignInAt: null, by: user.name, byId: user.id, at, resets: [], closed: null };
    await this.store.transaction(async (tx) => {
      await tx.lock?.('clientAccounts', a.id);
      const cur = (await tx.get('clientAccounts', a.id))!;
      if ((cur.portalUsers ?? []).filter((x) => !x.closed).length >= PORTAL_MAX_USERS) throw new BadRequest(`This client already has ${PORTAL_MAX_USERS} open portal sign-ins. Close one first.`);
      if ((cur.portalUsers ?? []).some((x) => !x.closed && x.name.toLowerCase() === name.toLowerCase())) throw new BadRequest(`${name} already has an open portal sign-in. Reset the code instead.`);
      await tx.update('clientAccounts', a.id, { portalUsers: [...(cur.portalUsers ?? []), p] });
      await tx.audit({ at, actor: user.name, companyId: a.companyId, action: 'client.portal.open', entity: 'client', entityId: a.id, summary: `${a.name}: client portal sign-in opened for ${name} (${post}).` });
    });
    return { user: strip(p), code, ref: { c: a.companyId, k: a.id, u: id } };
  }

  /** The OM gives a new code (the old one and every session stop), with the reason. */
  async reset(user: User, clientId: Id, portalUserId: Id, reason: string) {
    const { a, role } = await this.staffAccount(user, clientId);
    if (role !== 'om') throw new AccessDenied('view', '(the Operations Manager in the area resets a client portal code)');
    const why = clean(reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason for the new code.');
    const code = newPortalCode();
    const at = this.now();
    let out: ClientPortalUser | null = null;
    await this.store.transaction(async (tx) => {
      await tx.lock?.('clientAccounts', a.id);
      const cur = (await tx.get('clientAccounts', a.id))!;
      const p = (cur.portalUsers ?? []).find((x) => x.id === portalUserId);
      if (!p) throw new NotFound('Portal sign-in');
      if (p.closed) throw new BadRequest('This portal sign-in is closed. Open a new one.');
      out = { ...p, codeHash: portalCodeHash(p.id, code), failedTries: 0, lockedUntil: null, sessionVersion: p.sessionVersion + 1, resets: [...p.resets, { by: user.name, at, reason: why }] };
      await tx.update('clientAccounts', a.id, { portalUsers: (cur.portalUsers ?? []).map((x) => (x.id === p.id ? out! : x)) });
      await tx.audit({ at, actor: user.name, companyId: a.companyId, action: 'client.portal.reset', entity: 'client', entityId: a.id, summary: `${a.name}: new portal code for ${p.name}. ${why}` });
    });
    return { user: strip(out!), code, ref: { c: a.companyId, k: a.id, u: portalUserId } };
  }

  /** The OM or the company manager closes a portal sign-in at once, with the reason. */
  async close(user: User, clientId: Id, portalUserId: Id, reason: string) {
    const { a, role } = await this.staffAccount(user, clientId);
    if (role !== 'om' && role !== 'cm') throw new AccessDenied('view', '(the Operations Manager or the company manager closes a client portal sign-in)');
    const why = clean(reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason for closing it.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('clientAccounts', a.id);
      const cur = (await tx.get('clientAccounts', a.id))!;
      const p = (cur.portalUsers ?? []).find((x) => x.id === portalUserId);
      if (!p) throw new NotFound('Portal sign-in');
      if (p.closed) throw new BadRequest('Already closed.');
      await tx.update('clientAccounts', a.id, {
        portalUsers: (cur.portalUsers ?? []).map((x) => (x.id === p.id ? { ...x, sessionVersion: x.sessionVersion + 1, closed: { by: user.name, byId: user.id, at, reason: why } } : x)),
      });
      await tx.audit({ at, actor: user.name, companyId: a.companyId, action: 'client.portal.close', entity: 'client', entityId: a.id, summary: `${a.name}: portal sign-in of ${p.name} closed. ${why}` });
      return { ok: true };
    });
  }

  // ---------- The client, through the portal (a session limited to the client's company, see the API) ----------

  private async portalAccount(companyId: Id, clientId: Id): Promise<ClientAccount> {
    const a = (await this.store.list('clientAccounts', { companyId: [companyId] })).find((x) => x.id === clientId);
    if (!a || a.companyId !== companyId || a.stage === 'ended') throw new NotFound(PORTAL_GONE);
    return a;
  }

  /** Checks the access code. Five wrong codes lock the sign-in for 30 minutes (the guard phone numbers, G16). */
  async signIn(companyId: Id, clientId: Id, portalUserId: Id, code: string): Promise<{ ok: true; version: number; name: string } | { ok: false; locked: boolean }> {
    const at = this.now();
    const r = RULES.guardPhone.value;
    return this.store.transaction(async (tx) => {
      await tx.lock?.('clientAccounts', clientId);
      const a = await this.portalAccount(companyId, clientId);
      const p = (a.portalUsers ?? []).find((x) => x.id === portalUserId);
      if (!p || p.closed) return { ok: false as const, locked: false };
      if (p.lockedUntil && toMs(p.lockedUntil) > toMs(at)) return { ok: false as const, locked: true };
      const good = normalCode(code).length === 16 && portalCodeHash(p.id, code) === p.codeHash;
      const tries = good ? 0 : p.failedTries + 1;
      // A lock that has run out is cleared, so the next five wrong codes lock again (audit P100: an old, past lockedUntil
      // used to reset the count on every wrong code and the sign-in never locked a second time).
      const newLock = !good && tries >= r.maxFailedTries;
      const lockedUntil = newLock ? new Date(toMs(at) + r.lockMin * 60_000).toISOString() : null;
      const next: ClientPortalUser = { ...p, failedTries: newLock ? 0 : tries, lockedUntil, ...(good ? { lastSignInAt: at } : {}) };
      await tx.update('clientAccounts', a.id, { portalUsers: (a.portalUsers ?? []).map((x) => (x.id === p.id ? next : x)) });
      await tx.audit({
        at,
        actor: `Client portal: ${p.name}`,
        companyId: a.companyId,
        action: good ? 'client.portal.sign_in' : newLock ? 'client.portal.locked' : 'client.portal.wrong_code',
        entity: 'client',
        entityId: a.id,
        summary: `${a.name}: ${p.name} ${good ? 'signed in to the client portal' : newLock ? `locked out until ${lockedUntil} after ${r.maxFailedTries} wrong codes` : 'typed a wrong portal code'}.`,
      });
      return good ? { ok: true as const, version: p.sessionVersion, name: p.name } : { ok: false as const, locked: newLock };
    });
  }

  private async session(companyId: Id, clientId: Id, portalUserId: Id, version: number) {
    const a = await this.portalAccount(companyId, clientId);
    const p = (a.portalUsers ?? []).find((x) => x.id === portalUserId);
    if (!p || p.closed || p.sessionVersion !== version) throw new NotFound(PORTAL_GONE);
    return { a, p };
  }

  /** The client's own page: their sites, papers, what they raised here and its outcome. Nothing of another client. */
  async home(companyId: Id, clientId: Id, portalUserId: Id, version: number) {
    const { a, p } = await this.session(companyId, clientId, portalUserId, version);
    const [company, sites] = await Promise.all([this.store.get('companies', a.companyId), this.store.list('sites', { companyId: [a.companyId] })]);
    const mine = sites.filter((s) => a.siteIds.includes(s.id));
    const siteName = new Map(mine.map((s) => [s.id, s.name]));
    return {
      clientName: a.name,
      companyName: company?.name ?? '',
      person: { name: p.name, post: p.post },
      sites: mine.map((s) => ({ id: s.id, name: s.name })).sort((x, y) => x.name.localeCompare(y.name)),
      reports: [...a.reports].sort((x, y) => y.period.localeCompare(x.period)).map((r) => ({ period: r.period, pdf: !!r.docId })),
      slips: [...(a.workAcks ?? [])].sort((x, y) => y.period.localeCompare(x.period)).map((w) => ({ period: w.period, signedOn: w.signedOn, signer: w.signer, pdf: !!w.docId })),
      requestKinds: (Object.keys(CLIENT_REQUEST_KIND) as ClientRequestKind[]).map((k) => ({ key: k, label: CLIENT_REQUEST_KIND[k] })),
      raised: [
        ...(a.requests ?? [])
          .filter((q) => q.viaPortal)
          .map((q) => ({ kind: 'request' as const, at: q.at, from: q.from, what: `${CLIENT_REQUEST_KIND[q.kind]}: ${q.what}`, status: q.status === 'open' ? 'open' : q.status === 'done' ? 'done' : 'declined', answer: q.outcome })),
        ...(a.complaints ?? [])
          .filter((c) => c.via === 'portal')
          .map((c) => ({ kind: 'complaint' as const, at: c.at, from: c.from, what: `${c.siteId ? `${siteName.get(c.siteId) ?? ''}: ` : ''}${c.what}`, status: c.resolvedAt ? 'done' : 'open', answer: c.resolution })),
        ...a.ratings.filter((r) => r.via === 'portal').map((r) => ({ kind: 'rating' as const, at: r.at, from: r.from ?? '', what: `${r.score} of 5${r.comment ? `: ${r.comment}` : ''}`, status: 'done', answer: null })),
      ]
        .sort((x, y) => y.at.localeCompare(x.at))
        .slice(0, 30),
    };
  }

  /** The client rates the service, raises a complaint or makes a request; it lands where the OM already works. */
  async send(
    companyId: Id,
    clientId: Id,
    portalUserId: Id,
    version: number,
    input: { kind: 'rating' | 'complaint' | 'request'; score?: number; text: string; siteId?: string | null; requestKind?: string },
  ) {
    const { a, p } = await this.session(companyId, clientId, portalUserId, version);
    const text = clean(input.text, 500);
    const siteId = input.siteId ? String(input.siteId) : null;
    if (siteId && !a.siteIds.includes(siteId)) throw new BadRequest('Choose one of your own sites.');
    const at = this.now();
    const from = `${p.name} (${p.post})`;
    const actor = `Client portal: ${p.name}`;
    const rand = () => `${toMs(at)}-${Math.random().toString(36).slice(2, 7)}`;
    return this.store.transaction(async (tx) => {
      await tx.lock?.('clientAccounts', a.id);
      const cur = (await tx.get('clientAccounts', a.id))!;
      if (input.kind === 'rating') {
        const score = Math.round(Number(input.score));
        if (!(score >= 1 && score <= 5)) throw new BadRequest('Choose a rating from 1 to 5.');
        if (score <= RULES.clientCare.value.lowScore && text.length < 3) throw new BadRequest('Tell us what is not right, so it can be fixed.');
        await tx.update('clientAccounts', a.id, { ratings: [...cur.ratings, { at, by: actor, score, comment: text, from, via: 'portal', docId: null }] });
        await tx.audit({ at, actor, companyId: a.companyId, action: 'client.rating', entity: 'client', entityId: a.id, summary: `${a.name}: satisfaction ${score} of 5, from ${from} by the client portal.` });
        return { kind: 'rating' };
      }
      if (text.length < 5) throw new BadRequest('Write a few words (at least 5 characters).');
      if (input.kind === 'complaint') {
        if ((cur.complaints ?? []).filter((c) => c.via === 'portal' && !c.resolvedAt).length >= 20) throw new BadRequest('You have 20 open complaints. Please wait for answers or call your account manager.');
        const c: ClientComplaint = { id: `cc-${rand()}`, at, by: actor, from, via: 'portal', what: text, siteId, resolvedAt: null, resolvedBy: null, resolution: null, docIds: [] };
        await tx.update('clientAccounts', a.id, { complaints: [...(cur.complaints ?? []), c] });
        await tx.audit({ at, actor, companyId: a.companyId, action: 'client.complaint', entity: 'client', entityId: a.id, summary: `${a.name}: complaint from ${from} by the client portal: ${text.slice(0, 120)}` });
        return { kind: 'complaint' };
      }
      if (input.kind !== 'request') throw new BadRequest('Choose a rating, a complaint or a request.');
      const kind = (Object.keys(CLIENT_REQUEST_KIND) as ClientRequestKind[]).find((k) => k === input.requestKind);
      if (!kind) throw new BadRequest('Choose what you are asking for.');
      if ((cur.requests ?? []).filter((x) => x.status === 'open').length >= 50) throw new BadRequest('There are 50 open requests already. Please call your account manager.');
      const q: ClientRequest = { id: `cq-${rand()}`, kind, what: text, from, at, by: actor, neededBy: null, status: 'open', closedAt: null, closedBy: null, outcome: null, variationRef: null, viaPortal: true, siteId };
      await tx.update('clientAccounts', a.id, { requests: [...(cur.requests ?? []), q] });
      await tx.audit({ at, actor, companyId: a.companyId, action: 'client.request', entity: 'client', entityId: a.id, summary: `${a.name}: request from ${from} by the client portal: ${CLIENT_REQUEST_KIND[kind]}, ${text.slice(0, 120)}.` });
      return { kind: 'request' };
    });
  }

  /** A monthly report or a signed slip as its PDF, only the client's own, only one kept as a file (not a link). */
  async doc(companyId: Id, clientId: Id, portalUserId: Id, version: number, kind: 'report' | 'slip', period: string): Promise<EvidenceDoc> {
    const { a } = await this.session(companyId, clientId, portalUserId, version);
    return this.paper(a, kind, period);
  }

  /** The PDF behind one of the client's papers (also used by the report links for their monthly reports). */
  async paper(a: ClientAccount, kind: 'report' | 'slip', period: string): Promise<EvidenceDoc> {
    const docId = kind === 'report' ? a.reports.find((r) => r.period === period && r.docId)?.docId : (a.workAcks ?? []).find((w) => w.period === period)?.docId;
    if (!docId) throw new NotFound('Paper');
    const d = await this.store.get('evidenceDocs', docId);
    if (!d || d.companyId !== a.companyId || d.link || !/^data:(application\/pdf|image\/(jpeg|png));base64,/.test(d.data ?? '')) throw new NotFound('Paper');
    return d;
  }
}

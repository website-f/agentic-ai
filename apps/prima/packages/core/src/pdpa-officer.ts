// PDPA officer department check (Fauzan, 23 Nov 2026: "Do the gap" on the study note "PDPA officer: department check").
// B1 the officer's Do today, B2 who downloaded personal data, B3 the client's PDPA step closed only by the officer,
// B4 a lost or stolen device reaches the officer, B5 one list of keep periods; D1 the clean-up of data past its keep
// period runs only with the officer's OK, D2 every staff member can ask about their own data, D3 the Chief of Staff
// acts on breaches and data requests while the PDPA officer is away.
import { AccessDenied, accessClosed, GROUP_EMPLOYER_ID, pdpaRole } from './access';
import { isChiefOfStaff } from './hr';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService } from './service';
import type { Store } from './store';
import { addDays, dateOf, daysBetween, fromMs, toMs } from './time';
import type { ClientAccount, Id, IsoDate, IsoDateTime, PdpaRequest, User } from './types';

/** Who may ask the PDPA officer something, or what IT passed on. */
export type PdpaInboxKind = 'ask' | 'device';
export type PdpaAskKind = PdpaRequest['kind'];
export const PDPA_ASK_KINDS: PdpaAskKind[] = ['ACCESS', 'CORRECTION', 'PORTABILITY', 'WITHDRAW_CONSENT', 'OBJECTION'];
export const PDPA_ASK_LABEL: Record<PdpaAskKind, { en: string; bm: string }> = {
  ACCESS: { en: 'See a copy of my personal data', bm: 'Lihat salinan data peribadi saya' },
  CORRECTION: { en: 'Correct my personal data', bm: 'Betulkan data peribadi saya' },
  PORTABILITY: { en: 'Send my data to me or another organisation', bm: 'Hantar data saya kepada saya atau organisasi lain' },
  WITHDRAW_CONSENT: { en: 'Withdraw a consent I gave', bm: 'Tarik balik persetujuan yang saya beri' },
  OBJECTION: { en: 'Stop a use of my data', bm: 'Hentikan sesuatu penggunaan data saya' },
};

/**
 * One line in the PDPA officer's inbox: a staff member's question about their own data (D2) or a lost or stolen device
 * IT was told about (B4). Behind the PDPA wall; the person who asked reads only their own lines. Nothing is deleted.
 */
export interface PdpaInboxItem {
  id: Id;
  kind: PdpaInboxKind;
  /** The signed-in person who asked or reported. */
  userId: Id;
  personName: string;
  companyId: Id | null;
  at: IsoDateTime;
  askKind: PdpaAskKind | null;
  detail: string;
  /** The IT request the device report came from. */
  sourceRef: string | null;
  handled: {
    by: string;
    at: IsoDateTime;
    outcome: 'request' | 'breach' | 'no_breach' | 'closed';
    /** The data request (DSR-...) or the breach case opened from it. */
    ref: string | null;
    note: string;
  } | null;
}

/**
 * The PDPA officer's OK for the clean-up of data past its keep period (D1): valid 7 days; the daily clean-up jobs
 * (purge-retention, purge-locations) delete only while an OK is valid and add each run to it.
 */
export interface PdpaPurgeOk {
  id: Id;
  okOn: IsoDate;
  validUntil: IsoDate;
  by: string;
  at: IsoDateTime;
  reason: string;
  runs: { at: IsoDateTime; by: string; what: string }[];
}

export const PDPA_OFFICER_RULE = {
  /** A data request due within this many days shows on Do today. */
  requestSoonDays: 5,
  /** An OK for the clean-up lasts this many days, then the officer gives a new one. */
  purgeOkDays: 7,
  /** Open questions one person may have at once. */
  maxOpenAsks: 3,
  /** How far back the downloads list and the cover notices go. */
  downloadsDays: 90,
  coverNoticeDays: 14,
};

/** Added to the audit line and the case step when the Chief of Staff acts for the PDPA officer. */
export const PDPA_COVER_NOTE = 'Chief of Staff, covering while the PDPA officer is away';

const SENSITIVE_DOWNLOADS = ['personal', 'medical', 'pay', 'bank'] as const;

const text = (v: unknown, max: number) =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);

/** The PDPA officers on the books today (not closed). */
async function activeOfficers(store: Store, today: IsoDate): Promise<User[]> {
  return (await store.list('users', {})).filter((u) => !u.integration && u.role === 'pwvsb_officer' && u.department === 'pdpa' && !accessClosed(u, today));
}

/**
 * D3: the PDPA officer is away when nobody holds the job today, or every officer is on approved leave today. A leave
 * record the reader cannot see counts as not away, so the cover never starts by mistake.
 */
export async function pdpaOfficerAway(store: Store, today: IsoDate): Promise<boolean> {
  const officers = await activeOfficers(store, today);
  if (!officers.length) return true;
  for (const o of officers) {
    if (!o.personId) return false;
    const leave = await store.list('leaveRequests', { personId: o.personId }).catch(() => []);
    if (!leave.some((q) => q.status === 'approved' && q.from <= today && q.to >= today)) return false;
  }
  return true;
}

/** Who acts on breaches and data requests: the PDPA officer, or the Chief of Staff while the officer is away (D3). */
export async function pdpaActs(store: Store, user: User, today: IsoDate): Promise<'officer' | 'cover' | null> {
  if (pdpaRole(user) === 'officer') return 'officer';
  if (user.integration || !isChiefOfStaff(user)) return null;
  return (await pdpaOfficerAway(store, today)) ? 'cover' : null;
}

export class PdpaOfficerService {
  constructor(
    private store: Store,
    private now: () => IsoDateTime,
    private svc: PrimaService,
  ) {}

  private today(): IsoDate {
    return dateOf(this.now());
  }

  private async installed(): Promise<boolean> {
    return !this.store.hasTable || (await this.store.hasTable('pdpaInbox'));
  }

  private async needInstalled() {
    if (!(await this.installed())) throw new BadRequest('The PDPA inbox and clean-up OK are not installed in this database yet (module pdpa-officer-v1, run by the CEO).');
  }

  private monitor(user: User) {
    if (!pdpaRole(user)) throw new AccessDenied('view', '(PDPA)');
  }

  async acts(user: User) {
    return pdpaActs(this.store, user, this.today());
  }

  private async actor(user: User, what: string) {
    const by = await this.acts(user);
    if (!by) throw new AccessDenied('view', `(only the PDPA officer ${what}; the Chief of Staff acts only while the PDPA officer is away)`);
    return by;
  }

  // ---------- B1: Do today ----------

  /**
   * The PDPA officer's work for today, most urgent first. While covering, the Chief of Staff sees only breaches, data
   * requests and the inbox (D3). Monitors see nothing here: their alerts stay on the leaders' Monitor.
   */
  async doToday(user: User): Promise<HomeItem[]> {
    const by = await this.acts(user);
    if (!by) return [];
    const today = this.today();
    const nowMs = toMs(this.now());
    const go = { view: 'pdpa' as const };
    const out: HomeItem[] = [];
    const board = await this.svc.pdpaBoard(user);
    for (const c of board.cases.filter((x) => x.status === 'open' && x.kind === 'BREACH' && x.clock)) {
      const k = c.clock!;
      const b = c.breach!;
      if (!b.commissionerAt) {
        const left = Math.floor((toMs(k.commissionerDue) - nowMs) / 3_600_000);
        out.push({
          tone: left < 24 ? 'crit' : 'warn',
          tag: 'Breach',
          title: `${c.title}: tell the PDP Commissioner ${left < 0 ? `(${-left} h late)` : `within ${left} h`}`,
          detail: `${c.companyName} · found ${b.detectedAt.slice(0, 16).replace('T', ' ')}`,
          go,
        });
      } else if (k.subjectsDue && !b.subjectsAt)
        out.push({
          tone: k.subjectsLate ? 'crit' : 'warn',
          tag: 'Breach',
          title: `${c.title}: tell the affected people by ${k.subjectsDue}`,
          detail: `${c.companyName} · significant harm`,
          go,
        });
      if (!b.dataKinds?.trim() || !b.cause?.trim())
        out.push({ tone: 'info', tag: 'Breach register', title: `${c.title}: record the data involved and the cause`, detail: 'Needed before the breach can close', go });
    }
    const rights = await this.svc.pdpaRights(user);
    for (const r of rights.requests.filter((x) => x.request.status === 'open')) {
      if (!r.late && r.daysLeft > PDPA_OFFICER_RULE.requestSoonDays) continue;
      out.push({
        tone: r.late ? 'crit' : 'warn',
        tag: 'Data request',
        title: `${r.request.ref} ${r.request.subjectName}: ${r.late ? `${-r.daysLeft} days late` : `due ${r.request.dueOn} (${r.daysLeft} days)`}`,
        detail: `${r.companyName}${r.request.idVerified ? '' : ' · identity not checked yet'}`,
        go,
      });
    }
    const inbox = await this.inboxRows(user).catch(() => [] as PdpaInboxItem[]);
    const openAsks = inbox.filter((i) => !i.handled && i.kind === 'ask');
    const openDevices = inbox.filter((i) => !i.handled && i.kind === 'device');
    for (const d of openDevices)
      out.push({ tone: 'crit', tag: 'Possible breach', title: `${d.detail}: decide if personal data was exposed`, detail: `${d.personName} reported it ${d.at.slice(0, 10)}${d.sourceRef ? ` · ${d.sourceRef}` : ''}`, go });
    if (openAsks.length)
      out.push({ tone: 'warn', tag: 'Staff asked', title: `${openAsks.length} question${openAsks.length === 1 ? '' : 's'} from staff about their own data`, detail: 'Log each as a data request; the 21 days count from the day they asked', go });
    if (by === 'cover') return out;
    for (const d of rights.dpos.filter((x) => x.state !== 'ok'))
      out.push({
        tone: d.state === 'notify_late' ? 'crit' : 'warn',
        tag: 'DPO',
        title:
          d.state === 'unknown'
            ? `${d.companyName}: no data protection officer on file`
            : d.state === 'notify_late'
              ? `${d.companyName}: DPO not notified to the Commissioner (due ${d.notifyDue})`
              : d.state === 'to_notify'
                ? `${d.companyName}: notify the DPO to the Commissioner by ${d.notifyDue}`
                : `${d.companyName}: publish the DPO's contact`,
        detail: d.dpo ? d.dpo.name : 'Record one in the DPO register',
        go,
      });
    for (const c of board.cases.filter((x) => x.status === 'open' && x.kind === 'CLIENT_CONSENT' && x.consent?.decision === 'pending'))
      out.push({ tone: 'warn', tag: 'Client consent', title: `${c.consent!.client}: ${c.consent!.advisedAt ? 'record the decision' : 'advise the client'} on ${c.consent!.product}`, detail: c.companyName, go });
    for (const s of await this.clientSteps(user).catch(() => []))
      out.push({ tone: 'warn', tag: 'Client onboarding', title: `${s.client}: PDPA step open`, detail: `${s.companyName} · close it from the client's consent, or say why none is needed`, go });
    const products = await this.svc.productBoard(user);
    for (const c of products.certsDue)
      out.push({
        tone: c.cert.state === 'expired' ? 'crit' : c.cert.state === 'urgent' ? 'warn' : 'info',
        tag: 'Certificate',
        title: `${c.product}: ${c.cert.body === 'OTHER' ? c.cert.scheme || 'certificate' : c.cert.body} ${c.cert.state === 'expired' ? `expired ${c.cert.expiresOn}` : `expires ${c.cert.expiresOn}`}`,
        detail: 'Renew it, or the product is blocked in proposals',
        go,
      });
    const reg = await this.svc.pdpaRegisterBoard(user).catch(() => null);
    if (reg) {
      const incomplete = reg.rows.filter((r) => r.state === 'incomplete').length;
      const due = reg.rows.filter((r) => r.state === 'review_due').length;
      if (incomplete) out.push({ tone: 'warn', tag: 'Data register', title: `${incomplete} register entr${incomplete === 1 ? 'y needs' : 'ies need'} details`, detail: 'Keep period, disposal, notice or impact assessment missing', go });
      if (due) out.push({ tone: 'info', tag: 'Data register', title: `${due} register entr${due === 1 ? 'y is' : 'ies are'} due for the yearly review`, detail: 'Review with the CEO or the Chief of Staff', go });
    }
    if ((await this.installed()) && !(await this.validOk(today)))
      out.push({ tone: 'info', tag: 'Clean-up', title: 'Give this week’s OK for the clean-up of data past its keep period', detail: 'Without it the daily clean-up deletes nothing', go });
    for (const n of await this.coverNotices(user))
      out.push({ tone: 'info', tag: 'Done while away', title: n.summary, detail: `${n.actor} · ${n.at.slice(0, 10)}`, go });
    const rank = { crit: 0, warn: 1, info: 2, neutral: 3, ok: 4 } as const;
    return out.map((t, i) => ({ t, i })).sort((a, b) => rank[a.t.tone] - rank[b.t.tone] || a.i - b.i).map((x) => x.t);
  }

  /** D3: the Chief of Staff's Home carries the PDPA work only while covering. */
  async homeItems(user: User): Promise<HomeItem[]> {
    if ((await this.acts(user)) !== 'cover') return [];
    return (await this.doToday(user)).map((i) => ({ ...i, tag: `PDPA cover: ${i.tag}` }));
  }

  /** What the Chief of Staff did while the officer was away, shown to the officer for two weeks. */
  private async coverNotices(user: User) {
    if (pdpaRole(user) !== 'officer') return [];
    const since = fromMs(toMs(this.now()) - PDPA_OFFICER_RULE.coverNoticeDays * 86_400_000);
    return (await this.store.list('audit'))
      .filter((e) => e.action.startsWith('pdpa.') && e.at >= since && e.summary.includes(PDPA_COVER_NOTE))
      .slice(-10)
      .reverse();
  }

  // ---------- B2: who downloaded personal data ----------

  async downloads(user: User) {
    this.monitor(user);
    const since = fromMs(toMs(this.now()) - PDPA_OFFICER_RULE.downloadsDays * 86_400_000);
    const companies = await this.store.list('companies', {});
    const name = (id: Id | null) => (id ? (companies.find((c) => c.id === id)?.name ?? id) : 'Group');
    const rows = (await this.store.list('audit'))
      .filter((e) => e.action === 'export.download' && e.at >= since)
      .map((e) => {
        const sens = /Sensitive \(([a-z]+)\)/.exec(e.summary)?.[1] ?? null;
        return {
          at: e.at,
          by: e.actor,
          company: name(e.companyId),
          screen: e.entityId,
          sensitivity: sens,
          reason: /Reason: (.*?) Ref EXP-/.exec(e.summary)?.[1] ?? '',
          ref: /Ref (EXP-[A-Z0-9-]+)/.exec(e.summary)?.[1] ?? '',
          rows: Number(/: (\d+) rows?\./.exec(e.summary)?.[1] ?? 0),
          what: e.summary.replace(/ Ref EXP-[A-Z0-9-]+\.?$/, ''),
        };
      })
      .filter((r) => r.sensitivity && (SENSITIVE_DOWNLOADS as readonly string[]).includes(r.sensitivity))
      .reverse();
    const byPerson = new Map<string, number>();
    for (const r of rows) byPerson.set(r.by, (byPerson.get(r.by) ?? 0) + r.rows);
    return {
      days: PDPA_OFFICER_RULE.downloadsDays,
      rows,
      top: [...byPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([by, total]) => ({ by, rows: total })),
    };
  }

  // ---------- B3: the client's PDPA onboarding step ----------

  async clientSteps(user: User) {
    this.monitor(user);
    const companies = await this.store.list('companies', {});
    const cases = (await this.store.list('pdpaCases', {})).filter((c) => c.kind === 'CLIENT_CONSENT' && c.consent);
    return (await this.store.list('clientAccounts', {}))
      .filter((a) => a.stage !== 'ended' && a.onboarding.some((s) => s.key === 'pdpa' && !s.doneAt))
      .map((a) => ({
        accountId: a.id,
        client: a.name,
        companyId: a.companyId,
        companyName: companies.find((c) => c.id === a.companyId)?.name ?? a.companyId,
        stage: a.stage,
        consentCases: cases
          .filter((c) => c.consent!.client.toLowerCase().includes(a.name.toLowerCase().slice(0, 12)) || a.name.toLowerCase().includes(c.consent!.client.toLowerCase().slice(0, 12)))
          .map((c) => ({ id: c.id, title: c.title, product: c.consent!.product, decision: c.consent!.decision })),
      }))
      .sort((a, b) => a.client.localeCompare(b.client));
  }

  /** Only the PDPA officer closes the step: from the client's signed consent, or with the reason no consent is needed. */
  async clientStepDone(user: User, input: { accountId?: unknown; caseId?: unknown; note?: unknown }) {
    if (pdpaRole(user) !== 'officer') throw new AccessDenied('view', '(only the PDPA officer closes the client’s PDPA step)');
    const accountId = text(input.accountId, 80);
    const caseId = text(input.caseId, 120);
    const note = text(input.note, 300);
    const a = await this.store.get('clientAccounts', accountId);
    if (!a) throw new NotFound('Client');
    const step = a.onboarding.find((s) => s.key === 'pdpa');
    if (!step) throw new NotFound('Step');
    if (step.doneAt) throw new BadRequest('Already done.');
    let what: string;
    if (caseId) {
      const c = await this.store.get('pdpaCases', caseId);
      if (!c || c.kind !== 'CLIENT_CONSENT' || !c.consent) throw new NotFound('Client consent case');
      if (c.consent.decision !== 'given') throw new BadRequest('The client has not given consent on that case. Record the signed consent first.');
      what = `Client consent on file for ${c.consent.product} (${c.title})${note ? `: ${note}` : ''}`;
    } else {
      if (note.length < 10) throw new BadRequest('Choose the client’s consent case, or say why no consent is needed (for example: no camera, tracker or other monitoring product at this client).');
      what = `No client consent needed: ${note}`;
    }
    const at = this.now();
    const done = a.onboarding.map((s) => (s.key === 'pdpa' ? { ...s, doneAt: at, by: user.name, note: what.slice(0, 300), docId: s.docId ?? null } : s));
    const patch: Partial<ClientAccount> = { onboarding: done, ...(done.every((s) => s.doneAt) && a.stage === 'onboarding' ? { stage: 'active' as const } : {}) };
    return this.store.transaction(async (tx) => {
      await tx.lock?.('clientAccounts', a.id);
      const fresh = await tx.get('clientAccounts', a.id);
      if (fresh?.onboarding.find((s) => s.key === 'pdpa')?.doneAt) throw new BadRequest('Already done.');
      const saved = await tx.update('clientAccounts', a.id, patch);
      await tx.audit({ at, actor: user.name, companyId: a.companyId, action: 'pdpa.client_step', entity: 'client_account', entityId: a.id, summary: `${a.name}: PDPA onboarding step done. ${what}` });
      return saved;
    });
  }

  // ---------- D2 and B4: the inbox ----------

  private async inboxRows(user: User): Promise<PdpaInboxItem[]> {
    if (!(await this.installed())) return [];
    const all = await this.store.list('pdpaInbox', {});
    return pdpaRole(user) || (await this.acts(user)) ? all : all.filter((i) => i.userId === user.id);
  }

  async inbox(user: User) {
    this.monitor(user);
    const installed = await this.installed();
    const companies = await this.store.list('companies', {});
    const rows = (await this.inboxRows(user)).sort((a, b) => Number(!!a.handled) - Number(!!b.handled) || b.at.localeCompare(a.at));
    return {
      installed,
      acts: await this.acts(user),
      companies: companies.map((c) => ({ id: c.id, name: c.name })),
      rows: rows.map((i) => ({ ...i, companyName: i.companyId ? (companies.find((c) => c.id === i.companyId)?.name ?? i.companyId) : null, daysOpen: daysBetween(dateOf(i.at), this.today()) })),
    };
  }

  /** D2: any staff member signed in asks about their own data. The officer answers within 21 days from today. */
  async ask(user: User, input: { kind?: unknown; detail?: unknown }) {
    if (user.integration || user.role === 'site_device') throw new AccessDenied('view', '(ask with your own sign-in)');
    await this.needInstalled();
    const kind = PDPA_ASK_KINDS.find((k) => k === input.kind);
    if (!kind) throw new BadRequest('Choose what you want to do with your data.');
    const detail = text(input.detail, 500);
    if (detail.length < 5) throw new BadRequest('Say which data, in a few words.');
    const mine = (await this.store.list('pdpaInbox', {})).filter((i) => i.userId === user.id && !i.handled);
    if (mine.length >= PDPA_OFFICER_RULE.maxOpenAsks) throw new BadRequest(`You already have ${mine.length} questions waiting. The PDPA officer answers them first.`);
    const at = this.now();
    const row: PdpaInboxItem = {
      id: `pask-${toMs(at)}-${globalThis.crypto.randomUUID().slice(0, 6)}`,
      kind: 'ask',
      userId: user.id,
      personName: user.name,
      companyId: user.companyIds[0] ?? null,
      at,
      askKind: kind,
      detail,
      sourceRef: null,
      handled: null,
    };
    return this.store.transaction(async (tx) => {
      await tx.insert('pdpaInbox', row);
      // The audit line names no data and no reason: only that a question was sent.
      await tx.audit({ at, actor: user.name, companyId: row.companyId, action: 'pdpa.ask', entity: 'pdpa_inbox', entityId: row.id, summary: 'Asked the PDPA officer about their own personal data.' });
      return row;
    });
  }

  /** The person's own questions and what happened to them. */
  async myAsks(user: User) {
    if (user.integration) throw new AccessDenied('view', '(your own questions)');
    const installed = await this.installed();
    const rows = installed ? (await this.store.list('pdpaInbox', {})).filter((i) => i.userId === user.id && i.kind === 'ask') : [];
    return {
      installed,
      kinds: PDPA_ASK_KINDS.map((k) => ({ kind: k, ...PDPA_ASK_LABEL[k] })),
      days: RULES.pdpaRights.value.requestDays,
      rows: rows
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((i) => ({ id: i.id, at: i.at, askKind: i.askKind, detail: i.detail, dueOn: addDays(dateOf(i.at), RULES.pdpaRights.value.requestDays), handled: i.handled ? { at: i.handled.at, outcome: i.handled.outcome, ref: i.handled.ref, note: i.handled.outcome === 'closed' ? i.handled.note : '' } : null })),
    };
  }

  /**
   * B4: a lost or stolen device reported to IT reaches the PDPA officer. Written with the reporter's own sign-in.
   * Skipped (the IT request still stands) while the module is not installed.
   */
  async noteDevice(user: User, input: { ticketRef: string; title: string; companyId: Id | null }) {
    if (!(await this.installed())) return null;
    const at = this.now();
    const row: PdpaInboxItem = {
      id: `pdev-${toMs(at)}-${globalThis.crypto.randomUUID().slice(0, 6)}`,
      kind: 'device',
      userId: user.id,
      personName: user.name,
      companyId: input.companyId && input.companyId !== GROUP_EMPLOYER_ID ? input.companyId : null,
      at,
      askKind: null,
      detail: text(input.title, 160),
      sourceRef: text(input.ticketRef, 40) || null,
      handled: null,
    };
    await this.store.insert('pdpaInbox', row);
    return row;
  }

  /** The officer (or the Chief of Staff while covering) handles one inbox line. */
  async handle(user: User, input: { id?: unknown; action?: unknown; note?: unknown; companyId?: unknown }) {
    const by = await this.actor(user, 'answers the PDPA inbox');
    await this.needInstalled();
    const id = text(input.id, 80);
    const note = text(input.note, 300);
    const item = await this.store.get('pdpaInbox', id);
    if (!item) throw new NotFound('Inbox line');
    if (item.handled) throw new BadRequest('Already handled.');
    const action = (['request', 'breach', 'no_breach', 'close'] as const).find((a) => a === input.action);
    if (!action) throw new BadRequest('Choose what to do.');
    if (item.kind === 'ask' && (action === 'breach' || action === 'no_breach')) throw new BadRequest('That is for device reports.');
    if (item.kind === 'device' && action === 'request') throw new BadRequest('That is for questions from staff.');
    let ref: string | null = null;
    if (action === 'request') {
      const companyId = item.companyId ?? (text(input.companyId, 60) || null);
      if (!companyId) throw new BadRequest('Choose the company that holds the person’s data.');
      const r = await this.svc.addPdpaRequest(user, {
        companyId,
        kind: item.askKind ?? 'ACCESS',
        subjectName: item.personName,
        subjectKind: 'staff',
        detail: item.detail,
        receivedOn: dateOf(item.at),
      });
      await this.svc.pdpaRequestStep(user, r.id, 'verify', 'Asked while signed in to Prima with their own account');
      ref = r.ref;
    } else if (action === 'breach') {
      const c = await this.svc.openPdpaCase(user, {
        kind: 'BREACH',
        companyId: item.companyId,
        title: `Possible breach: ${item.detail}`.slice(0, 160),
        detail: `${item.personName} reported the device ${item.sourceRef ? `(${item.sourceRef}) ` : ''}on ${item.at.slice(0, 16).replace('T', ' ')}. ${note}`.trim(),
        detectedAt: item.at,
      });
      ref = c.id;
    } else if (note.length < 10) throw new BadRequest(action === 'no_breach' ? 'Say why no personal data was exposed (for example: encrypted and wiped, no data on it).' : 'Say why it is closed (for example: answered, or a duplicate).');
    const at = this.now();
    const outcome = action === 'no_breach' ? 'no_breach' : action === 'close' ? 'closed' : action;
    return this.store.transaction(async (tx) => {
      await tx.lock?.('pdpaInbox', id);
      const fresh = await tx.get('pdpaInbox', id);
      if (fresh?.handled) throw new BadRequest('Already handled.');
      const saved = await tx.update('pdpaInbox', id, { handled: { by: user.name, at, outcome, ref, note } });
      await tx.audit({
        at,
        actor: user.name,
        companyId: item.companyId,
        action: 'pdpa.inbox',
        entity: 'pdpa_inbox',
        entityId: id,
        summary: `${item.kind === 'ask' ? 'Question from staff' : `Device report ${item.sourceRef ?? ''}`.trim()}: ${outcome.replace('_', ' ')}${ref ? ` (${ref})` : ''}${by === 'cover' ? ` (${PDPA_COVER_NOTE})` : ''}.`,
      });
      return saved;
    });
  }

  // ---------- B5 and D1: keep periods and the clean-up OK ----------

  private async validOk(today: IsoDate): Promise<PdpaPurgeOk | null> {
    if (!(await this.installed())) return null;
    return (await this.store.list('pdpaPurgeOks', {})).filter((o) => o.okOn <= today && o.validUntil >= today).sort((a, b) => b.okOn.localeCompare(a.okOn))[0] ?? null;
  }

  async keepList(user: User) {
    this.monitor(user);
    const today = this.today();
    const settings = await this.svc.pdpaSettings();
    const products = (await this.store.list('products', {})).filter((p) => p.personalData.length);
    const reg = await this.svc.pdpaRegisterBoard(user).catch(() => null);
    const gate = RULES.siteGate;
    const vid = RULES.siteDispatch;
    const loc = RULES.staffTrackKeepDays;
    const ping = RULES.guardPhone;
    const job = 'Daily clean-up job, only with the PDPA officer’s OK';
    const rows = [
      { what: 'Site gate records (visitors and vehicles, ID numbers, IC pictures)', keep: `${gate.value.keepYears} years (law allows ${gate.value.keepYearsMin} to ${gate.value.keepYearsMax})`, rule: gate.id, label: gate.label, how: job, state: 'set' as const },
      { what: 'CMS proof video clips not on a case', keep: `${vid.value.videoKeepDays} days`, rule: vid.id, label: vid.label, how: job, state: 'set' as const },
      { what: 'Staff clock location readings', keep: `${loc.value} days`, rule: loc.id, label: loc.label, how: job, state: 'set' as const },
      { what: 'Guard phone location readings', keep: `${ping.value.keepPingsDays} days`, rule: ping.id, label: ping.label, how: job, state: 'set' as const },
      { what: 'Breach register entries', keep: `${settings.keepYears} years after closing`, rule: RULES.pdpaBreachRegister.id, label: RULES.pdpaBreachRegister.label, how: 'Kept; never deleted by Prima', state: 'set' as const },
      { what: 'Personnel records after the person leaves', keep: `${RULES.personnelKeepYears.value} years`, rule: RULES.personnelKeepYears.id, label: RULES.personnelKeepYears.label, how: 'HR decides each one; no job deletes them', state: 'set' as const },
      { what: 'Site survey photos', keep: 'Not set', rule: RULES.siteSurvey.id, label: RULES.siteSurvey.label, how: 'For the PDPA officer to set (Unknown until then)', state: 'unknown' as const },
      {
        what: 'Products sold or rented that collect personal data',
        keep: `${products.filter((p) => p.retentionDays).length} of ${products.length} have a keep period`,
        rule: RULES.productCerts.id,
        label: RULES.productCerts.label,
        how: 'Set on each product (Products tab)',
        state: products.some((p) => !p.retentionDays) ? ('unknown' as const) : ('set' as const),
      },
      {
        what: 'Personal data register entries',
        keep: reg ? `${reg.rows.filter((r) => r.state !== 'retired' && r.item.retentionDays).length} of ${reg.rows.filter((r) => r.state !== 'retired').length} have a keep period` : 'Register not installed',
        rule: RULES.pdpaRegisterReview.id,
        label: RULES.pdpaRegisterReview.label,
        how: 'Set on each entry (Data register tab)',
        state: !reg || reg.rows.some((r) => r.state !== 'retired' && !r.item.retentionDays) ? ('unknown' as const) : ('set' as const),
      },
    ];
    const installed = await this.installed();
    const ok = await this.validOk(today);
    const oks = installed ? (await this.store.list('pdpaPurgeOks', {})).sort((a, b) => b.okOn.localeCompare(a.okOn)).slice(0, 10) : [];
    const runs = (await this.store.list('audit'))
      .filter((e) => e.action === 'RETENTION_PURGE' || e.action === 'LOCATION_PURGE')
      .slice(-10)
      .reverse()
      .map((e) => ({ at: e.at, by: e.actor, summary: e.summary }));
    return { installed, rows, ok, oks, runs, canOk: pdpaRole(user) === 'officer' && installed, okDays: PDPA_OFFICER_RULE.purgeOkDays };
  }

  /** D1: the officer agrees, with a reason, that the daily clean-up may delete what is past its keep period this week. */
  async okCleanUp(user: User, input: { reason?: unknown }) {
    if (pdpaRole(user) !== 'officer') throw new AccessDenied('view', '(only the PDPA officer gives the clean-up OK)');
    await this.needInstalled();
    const reason = text(input.reason, 300);
    if (reason.length < 10) throw new BadRequest('Say what you checked (for example: no open legal hold or case needs the records due).');
    const today = this.today();
    if (await this.validOk(today)) throw new BadRequest('This week’s OK is already given.');
    const at = this.now();
    const row: PdpaPurgeOk = { id: `pok-${today}`, okOn: today, validUntil: addDays(today, PDPA_OFFICER_RULE.purgeOkDays - 1), by: user.name, at, reason, runs: [] };
    return this.store.transaction(async (tx) => {
      if (await tx.get('pdpaPurgeOks', row.id)) throw new BadRequest('Today’s OK is already given.');
      await tx.insert('pdpaPurgeOks', row);
      await tx.audit({ at, actor: user.name, companyId: null, action: 'pdpa.purge_ok', entity: 'pdpa_purge_ok', entityId: row.id, summary: `Clean-up OK until ${row.validUntil}: ${reason}` });
      return row;
    });
  }

  /** One API door for the writes. */
  async act(user: User, action: string, input: Record<string, unknown>) {
    switch (action) {
      case 'ask':
        return this.ask(user, input);
      case 'handle':
        return this.handle(user, input);
      case 'client-step':
        return this.clientStepDone(user, input);
      case 'purge-ok':
        return this.okCleanUp(user, input);
      default:
        throw new BadRequest('Unknown PDPA action.');
    }
  }
}

import { AccessDenied } from './access';
import {
  ASSISTANT_ACTIONS,
  ASSISTANT_RULE,
  assistantActionsFor,
  assistantAllowed,
  assistantLearn,
  assistantMayPublish,
  assistantNorm,
  assistantTeams,
  assistantUnderstand,
  emptyStyle,
  type AssistantDraft,
  type AssistantLists,
  type AssistantSkill,
  type AssistantStyle,
} from './assistant';
import type { GuideCardView } from './guide-cards';
import { BadRequest, NotFound, type PrimaService, type ProofInput } from './service';
import type { Store } from './store';
import { myt } from './time';
import type { Id, IsoDate, User } from './types';

/** One row of the agent's memory table: a skill, or one person's style (module assistant-v1). */
export type AssistantMemoryRow = (AssistantSkill & { kind: 'skill' }) | (AssistantStyle & { kind: 'style'; owner: Id });

const text = (x: unknown, max: number) => (typeof x === 'string' ? x.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');

/** A guide card the instruction may be about, with the steps and the screen. Only the person's own cards. */
export interface AssistantGuideHit {
  id: string;
  title: string;
  purpose: string;
  view: string | null;
  screen: string;
  button: string;
  steps: string[];
  status: GuideCardView['status'];
}

export function assistantGuideSearch(instruction: string, cards: GuideCardView[], lang: 'bm' | 'en', max = 3): AssistantGuideHit[] {
  const t = assistantNorm(instruction);
  const words = t.trim().split(' ').filter((w) => w.length > 3);
  if (!words.length) return [];
  const scored = cards
    .filter((c) => c.status !== 'not_built')
    .map((c) => {
      const hay = assistantNorm(`${c.title.bm} ${c.title.en} ${c.purpose.bm} ${c.purpose.en} ${c.screen.name}`);
      const n = words.filter((w) => hay.includes(` ${w} `) || hay.includes(` ${w}`)).length;
      return { c, n };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, max);
  return scored.map(({ c }) => ({
    id: c.id,
    title: c.title[lang],
    purpose: c.purpose[lang],
    view: c.screen.view,
    screen: c.screen.name,
    button: c.screen.action[lang],
    steps: [c.steps.save[lang], c.steps.review[lang], c.steps.returned[lang], c.steps.done[lang]].filter(Boolean),
    status: c.status,
  }));
}

/**
 * The agent on the server. It reads Prima's own lists under the person's walls, uses the team's skills and the person's
 * own style, and returns a filled form. It never sends anything: the screen sends through the usual action.
 */
export class AssistantService {
  constructor(private store: Store, private now: () => string, private svc: PrimaService) {}

  private must(user: User) {
    if (!assistantAllowed(user)) throw new AccessDenied('view', '(the Prima agent is for staff who fill forms)');
  }
  private async installed() {
    return !this.store.hasTable || (await this.store.hasTable('assistantMemory'));
  }
  private async rows(): Promise<AssistantMemoryRow[]> {
    return (await this.installed()) ? this.store.list('assistantMemory', {}) : [];
  }

  async style(user: User): Promise<AssistantStyle> {
    const row = (await this.rows()).find((r) => r.kind === 'style' && r.owner === user.id) as (AssistantStyle & { kind: 'style' }) | undefined;
    if (!row) return emptyStyle(user.id, this.now());
    const { kind: _k, owner: _o, ...style } = row as AssistantStyle & { kind: 'style'; owner: Id };
    return { ...style, id: user.id };
  }

  /** The skills the person's agent uses: their own and their teams'. */
  async skills(user: User): Promise<AssistantSkill[]> {
    const teams = assistantTeams(user);
    return (await this.rows()).filter((r): r is AssistantSkill & { kind: 'skill' } => r.kind === 'skill' && !r.retired && ((r.scope === 'me' && r.owner === user.id) || (r.scope === 'team' && teams.includes(r.owner))));
  }

  /** What the agent shows: the actions it can fill for this person, their skills and their own style. */
  async home(user: User) {
    this.must(user);
    const installed = await this.installed();
    const guides = this.svc.guideCards(user).cards.filter((c) => c.status !== 'not_built').length;
    return {
      installed,
      actions: (await this.jobsFor(user)).map(({ may: _m, ...a }) => a),
      skills: installed ? await this.skills(user) : [],
      style: installed ? await this.style(user) : emptyStyle(user.id, this.now()),
      teams: assistantTeams(user).map((t) => ({ owner: t, mayPublish: assistantMayPublish(user, t) })),
      guides,
    };
  }

  /** The jobs offered to this person: the rule in assistant.ts, then, where the server has a finer check, that check. */
  async jobsFor(user: User) {
    const out = [];
    for (const a of assistantActionsFor(user)) {
      if (a.id === 'uniform-guard') {
        const ok = await this.svc.uniformRequests(user).then((r) => !!(r as { canRequest?: boolean }).canRequest).catch(() => false);
        if (!ok) continue;
      }
      out.push(a);
    }
    return out;
  }

  /** One Prima list, read as the person (their walls). Each list is the same one the job's own screen shows. */
  private async pickList(user: User, name: string, v: Record<string, unknown>): Promise<{ id: Id; name: string; code?: string }[]> {
    const svc = this.svc;
    const safe = <T>(p: Promise<T>, d: T) => p.catch(() => d);
    switch (name) {
      case 'companies':
        return (await safe(svc.visibleCompanies(user), [])).map((c) => ({ id: c.id, name: c.name, code: c.code }));
      case 'companySites':
      case 'people': {
        const companyId = typeof v.companyId === 'string' ? v.companyId : null;
        if (!companyId) return [];
        if (name === 'companySites') return (await safe(svc.sites(user, companyId), [])).map(({ site: x }) => ({ id: x.id, name: x.name, code: x.code }));
        return (await safe(svc.people(user, companyId), []))
          .map(({ person: p }) => p)
          .filter((p) => p.status === 'active')
          .slice(0, 3000)
          .map((p) => ({ id: p.id, name: p.staffNo ? `${p.name} (${p.staffNo})` : p.name, code: p.staffNo ?? undefined }));
      }
      case 'clients':
        return ((await safe(svc.clientBoard(user), { accounts: [] } as never)) as { accounts: { id: Id; name: string }[] }).accounts.map((a) => ({ id: a.id, name: a.name }));
      case 'uniforms':
        return ((await safe(svc.uniformRequests(user), { uniforms: [] } as never)) as { uniforms: { id: Id; name: string }[] }).uniforms.map((x) => ({ id: x.id, name: x.name }));
      case 'fwWorkers':
        return ((await safe(svc.fwmBoard(user), { workers: [] } as never)) as { workers: { id: Id; name: string; staffNo?: string }[] }).workers.map((w) => ({ id: w.id, name: w.staffNo ? `${w.name} (${w.staffNo})` : w.name, code: w.staffNo }));
      case 'vehicles':
        return ((await safe(svc.fleetBoard(user), { board: [] } as never)) as { board: { id: Id; plate: string; model?: string }[] }).board.map((x) => ({ id: x.id, name: `${x.plate}${x.model ? ` ${x.model}` : ''}`, code: x.plate.replace(/\s+/g, '') }));
      case 'fuelCards': {
        // The chosen vehicle's live cards of the kind it was paid with; Transport only (the job is theirs).
        const kind = v.paidWith === 'FUEL_CARD' ? 'FUEL' : v.paidWith === 'SUBSIDY_CARD' ? 'SUBSIDY' : null;
        if (!kind || typeof v.vehicleId !== 'string' || !(await this.jobsFor(user)).some((a) => a.id === 'fuel')) return [];
        const veh = (await this.store.get('vehicles', v.vehicleId)) as { cards?: { id: Id; kind: string; issuer: string; last4: string; endedOn: string | null }[] } | null;
        return (veh?.cards ?? []).filter((c) => c.kind === kind && c.endedOn == null).map((c) => ({ id: c.id, name: `${c.issuer} ****${c.last4}`, code: c.last4 }));
      }
      case 'units':
        return ((await safe(svc.amBoard(user), { units: [] } as never)) as { units: { id: Id; code: string; name: string; tenant?: string | null }[] }).units.map((x) => ({ id: x.id, name: `${x.code} ${x.name}${x.tenant ? `, ${x.tenant}` : ''}`, code: x.code }));
      case 'owners': {
        // ACT names who will fix a finding: someone in a company it covers, or a central owner; never ACT itself.
        const users = (await this.store.list('users', {})) as User[];
        return users.filter((u) => !u.integration && u.department !== 'audit' && u.role !== 'guard' && u.role !== 'site_device').slice(0, 1000).map((u) => ({ id: u.id, name: u.name }));
      }
      default:
        return [];
    }
  }

  /** Lists for one action. Site supplies need the sites the person may ask for and, once the site is known, its store
   *  items and the OMs who receive there; other jobs need the lists their fields name. */
  private async lists(user: User, actionId: string | null, v: Record<string, unknown>): Promise<AssistantLists & { siteName?: string }> {
    const action = ASSISTANT_ACTIONS.find((a) => a.id === actionId);
    if (!action) return {};
    const out: AssistantLists & { siteName?: string } = {};
    if (actionId === 'site-supplies') {
      out.sites = ((await this.svc.siteSuppliesAct(user, 'sites', {}).catch(() => [])) as { id: Id; name: string }[]).map((x) => ({ id: x.id, name: x.name }));
      const siteId = typeof v.siteId === 'string' ? v.siteId : null;
      if (siteId) {
        const opt = (await this.svc.siteSuppliesAct(user, 'options', { siteId }).catch(() => null)) as { items: { id: Id; name: string; size?: string | null }[]; receivers: { id: Id; name: string }[]; site: { name: string } } | null;
        out.items = opt?.items.map((i) => ({ id: i.id, name: i.size ? `${i.name} (${i.size})` : i.name, size: i.size ?? null })) ?? [];
        out.receivers = opt?.receivers ?? [];
        out.siteName = opt?.site.name;
      }
    }
    const names = [...new Set(action.fields.filter((f) => f.type === 'pick' && f.list).map((f) => f.list!))];
    if (names.length) {
      out.pick = {};
      for (const n of names) out.pick[n] = await this.pickList(user, n, v);
    }
    return out;
  }

  /** Step 1 and 2: picks the action and fills its form from the instruction. Nothing is saved or sent. */
  async understand(user: User, input: { text?: unknown; actionId?: unknown; lang?: unknown }) {
    this.must(user);
    const instruction = text(input.text, ASSISTANT_RULE.maxTextChars);
    if (instruction.length < 3) throw new BadRequest('Tell the agent what you need, in a few words.');
    const lang = input.lang === 'en' ? 'en' : 'bm';
    const actions = await this.jobsFor(user);
    const chosen = typeof input.actionId === 'string' && actions.some((a) => a.id === input.actionId) ? input.actionId : null;
    const installed = await this.installed();
    const [skills, style] = installed ? await Promise.all([this.skills(user), this.style(user)]) : [[], null];
    const base = { text: instruction, today: this.now().slice(0, 10), actions, skills, style };
    let draft: AssistantDraft = assistantUnderstand({ ...base, lists: {}, actionId: chosen });
    let lists: AssistantLists & { siteName?: string } = {};
    // A list can depend on an earlier choice (the site's store items, the company's staff): read again until settled.
    for (let pass = 0; pass < 3 && draft.actionId; pass++) {
      const before = JSON.stringify(draft.values);
      lists = await this.lists(user, draft.actionId, draft.values);
      draft = { ...assistantUnderstand({ ...base, lists, actionId: draft.actionId }), alternatives: draft.alternatives };
      if (pass > 0 && JSON.stringify(draft.values) === before) break;
    }
    // Not a form the agent fills: the person's own guide says where and how.
    const guide = assistantGuideSearch(instruction, this.svc.guideCards(user).cards, lang);
    return { draft, lists, guide, origin: 'suggestion' as const, sent: false };
  }

  /** The lists for a job after the person changed a choice on the form (a company, a site). Read as the person. */
  async listsFor(user: User, input: { actionId?: unknown; values?: unknown }) {
    this.must(user);
    const action = (await this.jobsFor(user)).find((a) => a.id === input.actionId);
    if (!action) throw new AccessDenied('view', '(this job is not one the agent fills for you)');
    const v = (input.values && typeof input.values === 'object' ? input.values : {}) as Record<string, unknown>;
    return this.lists(user, action.id, v);
  }

  /**
   * Step 3, only when the person presses Send on the checked form: the same server action the screen uses, as the
   * person. Every check of that action applies; the agent adds no right. Nothing here approves, decides, pays or signs.
   */
  async send(user: User, input: { actionId?: unknown; values?: unknown; text?: unknown; draft?: unknown; labels?: unknown }) {
    this.must(user);
    const action = (await this.jobsFor(user)).find((a) => a.id === input.actionId);
    if (!action) throw new AccessDenied('view', '(this job is not one the agent fills for you; open its screen)');
    const v = (input.values && typeof input.values === 'object' && !Array.isArray(input.values) ? input.values : {}) as Record<string, unknown>;
    for (const f of action.fields) if (f.required && (v[f.name] === undefined || v[f.name] === '' || v[f.name] === null || (Array.isArray(v[f.name]) && !(v[f.name] as unknown[]).length))) throw new BadRequest(`Fill in ${f.label.en.toLowerCase()} first.`);
    const str = (k: string, max = 2000) => text(v[k], max);
    const opt = (k: string, max = 2000) => str(k, max) || null;
    const num = (k: string) => (v[k] === undefined || v[k] === null || v[k] === '' ? null : Number(v[k]));
    const date = (k: string) => {
      const d = str(k, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequest('Give the date as a real date.');
      return d as IsoDate;
    };
    const time = (k: string, dflt?: string) => {
      const t = str(k, 5) || dflt || '';
      if (!/^\d{2}:\d{2}$/.test(t)) throw new BadRequest('Give the time as HH:MM.');
      return t;
    };
    const proof = (Array.isArray(v.proof) ? v.proof : []).slice(0, 5) as ProofInput[];
    const svc = this.svc;
    let result: unknown;
    let ref = '';
    switch (action.id) {
      case 'site-supplies': {
        const lines = (Array.isArray(v.lines) ? v.lines : []).slice(0, 60).map((l) => ({ stockItemId: text((l as Record<string, unknown>)?.stockItemId, 160), qty: Number((l as Record<string, unknown>)?.qty) }));
        const made = (await svc.siteSuppliesAct(user, 'request', { siteId: str('siteId', 160), receiverUserId: str('receiverUserId', 160) || undefined, lines, forNewSite: v.forNewSite === true, notes: str('notes'), startedByRole: 'om' })) as { id: Id; ref?: string; status?: string };
        // An OM's request starts as a draft and is submitted at once; an office request is already on its way.
        result = made.status === 'baharu' ? await svc.siteSuppliesAct(user, 'submit', { id: made.id, note: 'Sent from the Prima agent after checking.' }) : made;
        ref = made.ref ?? made.id;
        break;
      }
      case 'leave': {
        if (!user.personId) throw new BadRequest('Your login is not linked to your staff record yet. Ask HR, or use the Leave screen.');
        result = await svc.requestLeave(user, { personId: user.personId, kind: str('kind', 20) as never, from: date('from'), to: date('to'), reason: str('reason', 500), illness: opt('illness', 120), clinic: opt('clinic', 120), mcNo: opt('mcNo', 40), proof });
        break;
      }
      case 'leave-for':
        result = await svc.requestLeave(user, { personId: str('personId', 160), kind: str('kind', 20) as never, from: date('from'), to: date('to'), reason: str('reason', 500), illness: opt('illness', 120), clinic: opt('clinic', 120), mcNo: opt('mcNo', 40), proof });
        break;
      case 'it-help':
        result = await svc.raiseItTicket(user, { category: str('category', 20) as never, priority: str('priority', 4) as never, title: str('title', 120), detail: str('detail') });
        break;
      case 'problem':
        result = await svc.problems.report(user, { what: str('what'), screen: 'Prima agent' });
        break;
      case 'time-slip':
        result = await svc.requestTimeSlip(user, { date: date('date'), from: time('from'), to: time('to'), reason: str('reason', 500) });
        break;
      case 'ot-claim':
        result = await svc.requestOtClaim(user, { date: date('date'), hours: Number(v.hours), kind: (str('kind', 20) || 'normal') as never, reason: str('reason', 500) });
        break;
      case 'meeting': {
        const d = date('date');
        const start = time('start');
        const end = str('end', 5) ? time('end') : `${String(Math.min(23, Number(start.slice(0, 2)) + 1)).padStart(2, '0')}${start.slice(2)}`;
        result = await svc.scheduleMeeting(user, { companyId: null, kind: 'department', title: str('title', 160), start: myt(d, start), end: myt(d, end), location: str('location', 160), attendees: str('attendees', 600).split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 40), agenda: str('agenda') });
        break;
      }
      case 'help-ask':
        result = await svc.helpAsk(user, { text: str('text'), taskId: null });
        break;
      case 'my-task': {
        const title = str('title', 160);
        result = await svc.workTaskAdd(user, { userId: user.id, title, doneMeans: title, dueAt: myt(date('date'), time('time', '17:30')), priority: 'normal' });
        break;
      }
      case 'staff-claim':
        result = await svc.submitStaffClaim(user, { kind: str('kind', 20) as never, date: date('date'), amount: Number(v.amount), note: str('note', 500) }, proof);
        break;
      case 'office-request': {
        const period = str('period', 7);
        if (!/^\d{4}-\d{2}$/.test(period)) throw new BadRequest('Give the month.');
        const saved = (await svc.saveExpense(user, { kind: 'OFFICE', companyId: str('companyId', 120), period, category: str('category', 20) as never, lines: [{ item: str('item', 200), amount: Number(v.amount) }] }, proof)) as { id: Id };
        // With its bill or receipt attached it goes to the CoS at once; without, it waits as a draft on the Office screen.
        result = proof.length ? await svc.submitExpense(user, saved.id) : saved;
        ref = proof.length ? saved.id : `${saved.id} (draft: attach the bill on the Office screen, then submit)`;
        break;
      }
      case 'client-request':
        result = await svc.addClientRequest(user, str('accountId', 160), { kind: str('kind', 20) as never, what: str('what', 500), from: str('from', 120), neededBy: opt('neededBy', 10) as IsoDate | null });
        break;
      case 'vacancy': {
        const category = str('category', 10) as 'guard' | 'officer' | 'staff';
        result = await svc.raiseVacancy(user, { companyId: str('companyId', 120), title: str('title', 80), department: str('department', 80) || (category === 'staff' ? 'Office' : 'Operations'), headcount: Number(v.headcount), reason: str('reason', 500), payFrom: num('payFrom'), payTo: num('payTo'), category, state: str('state', 40) });
        break;
      }
      case 'payment-request':
        result = await svc.financeRequests.create(user, str('companyId', 120), {
          subject: str('subject', 20), sector: opt('sector', 20), title: str('title', 160), purpose: str('purpose', 1000), amount: Number(v.amount), payee: str('payee', 160), dueOn: date('dueOn'), calc: str('calc', 2000),
          evidence: str('evidence', 2000).split(/[,;\n]/).map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 10),
        });
        break;
      case 'police-help': {
        const booked = str('kind', 20) === 'VISIT_BOOKED';
        result = await svc.askPoliceHelp(user, { companyId: str('companyId', 120), kind: str('kind', 20) as never, reason: str('reason', 30) as never, expectedAt: booked ? myt(date('date'), time('time', '10:00')) : null, policeUnit: str('policeUnit', 120), officer: str('officer', 120), asked: str('asked', 500), contactName: str('contactName', 120), contactPhone: str('contactPhone', 30) });
        break;
      }
      case 'case-report':
        result = await svc.raiseCase(user, { companyId: str('companyId', 120), siteId: opt('siteId', 160), type: str('type', 20) as never, severity: str('severity', 2) as never, title: str('title', 160), description: str('description'), proof });
        break;
      case 'uniform-guard':
        result = await svc.requestUniform(user, { staffNo: str('staffNo', 40), stockItemId: str('stockItemId', 160), qty: Number(v.qty), reason: str('reason', 300) });
        break;
      case 'purchase-request':
        result = await svc.raisePurRequest(user, str('companyId', 120), { title: str('title', 120), category: str('category', 20) as never, lines: [{ item: str('item', 120), stockItemId: null, qty: Number(v.qty), unitPrice: Number(v.unitPrice) }] });
        break;
      case 'fwm-task':
        result = await svc.createFwmTask(user, str('personId', 160), { kind: str('kind', 20) as never, what: str('what', 300), place: str('place', 160), dueOn: date('dueOn') });
        break;
      case 'vehicle-request': {
        const d = date('date');
        result = await svc.requestVehicle(user, { purpose: str('purpose', 300), from: myt(d, time('start')), to: myt(d, time('end')) });
        break;
      }
      case 'fuel':
        result = await svc.recordFuel(user, str('vehicleId', 160), { at: myt(date('date'), time('time')), paidWith: str('paidWith', 20) as never, fuel: str('fuel', 10) as never, litres: Number(v.litres), amountRm: Number(v.amountRm), odometerKm: Number(v.odometerKm), station: str('station', 120), driver: str('driver', 120), ...(v.cardId ? { cardId: str('cardId', 160) } : {}) }, proof);
        break;
      case 'rent-payment':
        result = await svc.amRecordPayment(user, str('unitId', 160), { amount: Number(v.amount), method: str('method', 10) as never, on: date('on'), receiptNo: str('receiptNo', 60), ref: str('ref', 60) });
        break;
      case 'act-finding':
        result = await svc.raiseActFinding(user, { companyId: opt('companyId', 120), area: str('area', 40), source: 'manual', title: str('title', 160), detail: str('detail', 1000), severity: str('severity', 10) as never, evidence: str('evidence', 500), ownerUserId: str('ownerUserId', 160) });
        break;
      case 'it-purchase':
        result = await svc.raiseItPurchase(user, { ownerId: '', reason: str('reason', 300), items: [{ kind: str('kind', 10) as never, description: str('description', 80), qty: Number(v.qty), unitPrice: Number(v.unitPrice) }] });
        break;
      case 'pdpa-request':
        result = await svc.addPdpaRequest(user, { companyId: str('companyId', 120), kind: str('kind', 20) as never, subjectName: str('subjectName', 100), subjectKind: str('subjectKind', 10) as never, detail: str('detail', 500), receivedOn: date('receivedOn') });
        break;
      case 'legal-matter':
        result = await svc.addLegalMatter(user, str('companyId', 120), { title: str('title', 160), kind: str('kind', 20) as never, counterparty: str('counterparty', 160), side: str('side', 12) as never, exposure: num('exposure'), lawyer: str('lawyer', 160), nextOn: opt('nextOn', 10) as IsoDate | null, nextWhat: str('nextWhat', 300) });
        break;
      default:
        throw new BadRequest('Open this job on its own screen.');
    }
    if (!ref && result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      const inner = (r.fill ?? null) as { id?: unknown } | null;
      ref = String(r.ref ?? r.id ?? inner?.id ?? '');
    }
    await this.store.audit({ at: this.now(), actor: user.name, companyId: typeof v.companyId === 'string' ? v.companyId : null, action: 'assistant.sent', entity: 'assistant', entityId: action.id, summary: `${user.name} sent "${action.label.en}" filled by the Prima agent and checked by them${ref ? ` (${ref})` : ''}.` });
    // The agent remembers the person's usual choices and words; a database without the module simply does not learn.
    let learned = false;
    if (await this.installed()) {
      const { proof: _p, ...sent } = v;
      await this.learn(user, { actionId: action.id, text: input.text, sent, draft: input.draft, labels: input.labels });
      learned = true;
    }
    return { sent: true, actionId: action.id, view: action.view, ref, learned, result };
  }

  // ---------- memory ----------

  private async ready() {
    if (!(await this.installed())) throw new BadRequest('The agent\'s skill library is not installed in this database yet (module assistant-v1).');
  }

  /** After the person sent a form: their usual values and their own words for things are kept. */
  async learn(user: User, input: { actionId?: unknown; text?: unknown; sent?: unknown; draft?: unknown; labels?: unknown }) {
    this.must(user);
    await this.ready();
    const actionId = typeof input.actionId === 'string' && ASSISTANT_ACTIONS.some((a) => a.id === input.actionId) ? input.actionId : null;
    if (!actionId || !input.sent || typeof input.sent !== 'object') throw new BadRequest('Nothing to learn from.');
    const draft = (input.draft && typeof input.draft === 'object' ? input.draft : { values: {} }) as AssistantDraft;
    const labels = (input.labels && typeof input.labels === 'object' ? input.labels : {}) as Record<string, string>;
    const next = assistantLearn(await this.style(user), { actionId, text: text(input.text, ASSISTANT_RULE.maxTextChars), sent: input.sent as Record<string, unknown>, draft: { ...draft, values: draft.values ?? {} }, labels, at: this.now() });
    return this.putStyle(user, next);
  }

  private async putStyle(user: User, style: AssistantStyle) {
    const id = `style-${user.id}`;
    const row = { ...style, id, kind: 'style' as const, owner: user.id } as unknown as AssistantMemoryRow;
    const had = (await this.rows()).some((r) => r.id === id);
    if (had) {
      const { id: _id, ...patch } = row as unknown as Record<string, unknown>;
      await this.store.update('assistantMemory', id, patch as never);
    }
    else await this.store.insert('assistantMemory', row as never);
    return { ...style, id: user.id };
  }

  /** The person sets their own language, sign-off and tone. */
  async setStyle(user: User, input: { lang?: unknown; signOff?: unknown; tone?: unknown }) {
    this.must(user);
    await this.ready();
    const s = await this.style(user);
    const lang = input.lang === 'bm' || input.lang === 'en' || input.lang === 'mix' ? input.lang : input.lang === null ? null : s.lang;
    const signOff = input.signOff === undefined ? s.signOff : text(input.signOff, 120) || null;
    const tone = input.tone === 'full' || input.tone === 'short' ? input.tone : s.tone;
    return this.putStyle(user, { ...s, lang, signOff, tone, updatedAt: this.now() });
  }

  /** Forgets one learned word, or everything the agent learned about the person. */
  async forget(user: User, input: { said?: unknown; all?: unknown }) {
    this.must(user);
    await this.ready();
    const s = await this.style(user);
    if (input.all === true) return this.putStyle(user, emptyStyle(user.id, this.now()));
    const said = text(input.said, 80);
    return this.putStyle(user, { ...s, words: s.words.filter((w) => w.said !== said), updatedAt: this.now() });
  }

  /** Saves a skill: the person's own, or for their team when they head it. */
  async saveSkill(user: User, input: { scope?: unknown; owner?: unknown; name?: unknown; words?: unknown; actionId?: unknown; values?: unknown; note?: unknown }) {
    this.must(user);
    await this.ready();
    const scope = input.scope === 'team' ? 'team' : 'me';
    const owner = scope === 'me' ? user.id : text(input.owner, 80);
    if (scope === 'team' && !assistantMayPublish(user, owner)) throw new AccessDenied('view', '(a team skill is saved by the head or manager of that team)');
    const name = text(input.name, 80);
    if (name.length < 3) throw new BadRequest('Give the skill a short name.');
    const actionId = typeof input.actionId === 'string' && assistantActionsFor(user).some((a) => a.id === input.actionId) ? input.actionId : null;
    if (!actionId) throw new BadRequest('Choose the job this skill fills.');
    const words = (Array.isArray(input.words) ? input.words : [name]).map((w) => text(w, 60).toLowerCase()).filter((w) => w.length >= 3).slice(0, 10);
    if (!words.length) throw new BadRequest('Give at least one word that calls this skill up.');
    const action = ASSISTANT_ACTIONS.find((a) => a.id === actionId)!;
    const given = input.values && typeof input.values === 'object' ? (input.values as Record<string, unknown>) : {};
    // A skill keeps choices and usual values, never dates, times, quantities or the items of one request.
    const values = Object.fromEntries(action.fields.filter((f) => !['date', 'time', 'number', 'items'].includes(f.type) && given[f.name] !== undefined && given[f.name] !== '').map((f) => [f.name, given[f.name]]));
    const mine = (await this.rows()).filter((r) => r.kind === 'skill' && r.owner === owner && !(r as AssistantSkill).retired);
    if (mine.length >= ASSISTANT_RULE.maxSkillsPerOwner) throw new BadRequest('This library is full. Retire a skill no longer used first.');
    const at = this.now();
    const row: AssistantSkill & { kind: 'skill' } = { kind: 'skill', id: `skl-${Date.parse(at).toString(36)}-${Math.random().toString(36).slice(2, 8)}`, scope, owner, name, words, actionId, values, note: text(input.note, 600), by: user.name, byId: user.id, at, retired: null };
    await this.store.insert('assistantMemory', row as never);
    await this.store.audit({ at, actor: user.name, companyId: owner.startsWith('company:') ? owner.slice(8) : null, action: 'assistant.skill', entity: 'assistant_skill', entityId: row.id, summary: `${scope === 'team' ? `Team skill for ${owner}` : 'Own skill'} "${name}" for ${actionId}.` });
    return row;
  }

  /** A skill no longer used is retired with a reason, never deleted. */
  async retireSkill(user: User, input: { id?: unknown; reason?: unknown }) {
    this.must(user);
    await this.ready();
    const id = text(input.id, 80);
    const row = (await this.rows()).find((r) => r.id === id && r.kind === 'skill') as (AssistantSkill & { kind: 'skill' }) | undefined;
    if (!row || row.retired) throw new NotFound('Skill');
    const may = row.scope === 'me' ? row.owner === user.id : assistantMayPublish(user, row.owner);
    if (!may) throw new AccessDenied('view', '(a team skill is retired by the head or manager of that team)');
    const reason = text(input.reason, 200);
    if (reason.length < 5) throw new BadRequest('Say why this skill is no longer used.');
    const at = this.now();
    await this.store.update('assistantMemory', id, { retired: { by: user.name, at, reason } } as never);
    await this.store.audit({ at, actor: user.name, companyId: row.owner.startsWith('company:') ? row.owner.slice(8) : null, action: 'assistant.skill_retired', entity: 'assistant_skill', entityId: id, summary: `Skill "${row.name}" retired: ${reason}` });
    return { ok: true };
  }
}

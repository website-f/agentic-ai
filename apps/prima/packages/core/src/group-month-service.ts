// Part Y (Fitri package, monthly JA Group meeting and staff duty checklists, Fauzan's answers Y-Q1..Y-Q10, 14 Nov 2026):
// the monthly group meeting built from each company's 14-item report (the company's last verified toolbox pack plus the
// monthly-only items, one report not two), the submission deadline and the "who has not sent" list, the unit sections,
// Internal Audit's accounts report tracker and Friday red/yellow/green report, the JTK register, the guard pay method
// counts, the meeting logistics and minutes (Prima's minutes are the record), and the real duty checklists (yearly and ad
// hoc duties, date windows, a named person and a backup per line) that replace the draft role playbooks and count in the
// person's KPI. Prima sends no Outlook invite and connects to no Loop, OneNote, SharePoint or Power Automate.
import { AccessDenied } from './access';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService } from './service';
import type { Store } from './store';
import { addDays, dateOf, myt, toMs } from './time';
import { lineManagerOf } from './work';
import type { Id, IsoDate, IsoDateTime, User, WorkTask } from './types';
import type { PackLine } from './toolbox-service';

export type GmKind = 'settings' | 'meeting' | 'report' | 'acct' | 'jtk' | 'payMethod' | 'ryg' | 'duty';
export const GM_KINDS: GmKind[] = ['settings', 'meeting', 'report', 'acct', 'jtk', 'payMethod', 'ryg', 'duty'];
export interface GmRec {
  id: Id;
  kind: GmKind;
  /** 'co:<companyId>', 'dept:<department>' or 'group'. */
  scope: string;
  companyId: Id | null;
  /** The month reported (YYYY-MM), the year for a duty line, or ''. */
  period: string;
  status: string;
  d: Record<string, unknown>;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; note: string }[];
}
export type DutyEvery = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'adhoc';
const EVERY: DutyEvery[] = ['daily', 'weekly', 'monthly', 'yearly', 'adhoc'];
export interface DutyLine {
  text: string;
  every: DutyEvery;
  fromDay?: number | null;
  toDay?: number | null;
  month?: number | null;
  weekday?: number | null;
  picId: Id;
  picName: string;
  backupId: Id | null;
  backupName: string | null;
  /** Part Z1: who checks this line's work (never the person in charge); null = the line manager. */
  checkerId?: Id | null;
  checkerName?: string | null;
  sopRef: string;
  role: string;
  templateId: string | null;
}

const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v: unknown): v is IsoDate => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const nextMonth = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const prevMonth = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
const lastDay = (p: string) => {
  const [y, m] = p.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const dayIn = (p: string, day: number) => `${p}-${String(Math.min(lastDay(p), Math.max(1, day))).padStart(2, '0')}` as IsoDate;
const weekday = (d: IsoDate) => new Date(`${d}T00:00:00Z`).getUTCDay() || 7;
/** Malaysian IC numbers are never shown (YL1). */
const noIc = (v: string) => v.replace(/\b\d{6}-?\d{2}-?\d{4}\b/g, '[IC disembunyikan]');
function patchOf(r: GmRec): Omit<GmRec, 'id' | 'companyId'> {
  const { id: _i, companyId: _c, ...rest } = r;
  void _i;
  void _c;
  return rest;
}
function subWorkingDays(on: IsoDate, n: number, holidays: Set<IsoDate>): IsoDate {
  let d = on;
  let left = n;
  while (left > 0) {
    d = addDays(d, -1);
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) left--;
  }
  return d;
}

type CalItem = { id: string; text: string; fromDay?: number; toDay?: number; every?: 'monthly' | 'bimonthly' | 'twice' | 'weekly'; weekday?: number };
export class GroupMonthService {
  constructor(
    private store: Store,
    private clock: () => IsoDateTime,
    private svc: PrimaService,
  ) {}
  private now() {
    return this.clock();
  }
  private today() {
    return dateOf(this.clock());
  }
  private async installed() {
    return !this.store.hasTable || (await this.store.hasTable('groupMonthRecs'));
  }
  private async need() {
    if (!(await this.installed())) throw new BadRequest('Monthly group meeting records are not installed in this database yet (module group-monthly-v1, run by the CEO).');
  }
  private async recs(kind?: GmKind): Promise<GmRec[]> {
    if (!(await this.installed())) return [];
    const all = ((await this.store.list('groupMonthRecs', {}).catch(() => [])) as GmRec[]) ?? [];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }
  private async get(id: Id) {
    if (!(await this.installed())) return null;
    return ((await this.store.get('groupMonthRecs', id).catch(() => undefined)) as GmRec | undefined) ?? null;
  }
  private hist(cur: GmRec | null | undefined, user: User, note: string) {
    return [...(cur?.history ?? []), { at: this.now(), by: user.name, note: note.slice(0, 300) }];
  }
  private async save(user: User, rec: GmRec, action: string, summary: string, cur?: GmRec | null) {
    return this.store.transaction(async (tx) => {
      if (cur) await tx.update('groupMonthRecs', rec.id, patchOf(rec) as never);
      else await tx.insert('groupMonthRecs', rec as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: rec.companyId, action: `groupMonth.${action}`, entity: 'group_month_rec', entityId: rec.id, summary: `${rec.scope} ${rec.period}: ${summary}`.slice(0, 300) });
      return rec;
    });
  }
  private rec(user: User, kind: GmKind, id: Id, scope: string, companyId: Id | null, period: string, status: string, d: Record<string, unknown>, cur: GmRec | null, note: string): GmRec {
    return { id, kind, scope, companyId, period, status, d, by: cur?.by ?? user.name, byId: cur?.byId ?? user.id, at: cur?.at ?? this.now(), history: this.hist(cur, user, note) };
  }

  // ---------- who ----------
  private staff(u: User) {
    return !u.integration && u.role === 'pwvsb_officer';
  }
  private hr(u: User) {
    return this.staff(u) && u.department === 'hr';
  }
  private doa(u: User) {
    return this.staff(u) && u.department === 'director_office';
  }
  private audit(u: User) {
    return this.staff(u) && u.department === 'audit';
  }
  private ceo(u: User) {
    return !u.integration && u.opsTier === 'ceo';
  }
  private finance(u: User) {
    return !u.integration && (u.leadership === 'finance_director' || (u.role === 'pwvsb_officer' && u.department === 'finance'));
  }
  private wide(u: User) {
    return !u.integration && (u.opsTier === 'ceo' || u.opsTier === 'coo' || ['cos', 'deputy_cos', 'chairman', 'vice_chairman'].includes(u.leadership ?? '') || this.doa(u));
  }
  private office(u: User, co: Id) {
    return !u.integration && (u.role === 'company_manager' || u.role === 'admin_exec') && u.companyIds.includes(co);
  }
  private manager(u: User, co: Id) {
    return !u.integration && u.role === 'company_manager' && u.companyIds.includes(co);
  }
  private director(u: User, co: Id) {
    return !u.integration && u.role === 'director' && u.companyIds.includes(co);
  }
  private member(u: User, dept: string) {
    return this.staff(u) && u.department === dept;
  }
  private async head(u: User, dept: string) {
    if (!this.member(u, dept)) return false;
    const m = lineManagerOf(u, await this.store.list('users')).manager;
    return !m || m.department !== dept;
  }
  private parse(scope: string): { co: Id | null; dept: string | null } {
    if (scope.startsWith('co:') && scope.length > 3) return { co: scope.slice(3), dept: null };
    if (scope.startsWith('dept:') && scope.length > 5) return { co: null, dept: scope.slice(5) };
    throw new BadRequest('Choose the company or the unit.');
  }
  /** Full report readers: the company office or the unit, its directors, group roles, Unit HR (organiser), Internal Audit and the FD for companies. */
  private reads(u: User, scope: string) {
    const { co, dept } = this.parse(scope);
    if (this.wide(u) || this.hr(u) || this.audit(u)) return true;
    if (co) return this.office(u, co) || this.director(u, co) || (u.leadership === 'finance_director' && !u.integration);
    return this.member(u, dept!);
  }
  private prepares(u: User, scope: string) {
    const { co, dept } = this.parse(scope);
    return co ? this.office(u, co) : this.member(u, dept!);
  }
  /** SULIT detail (Y8 / Y9): the CEO, the FD, Internal Audit and the company's own directors. */
  private seesSulit(u: User, co: Id | null) {
    return !u.integration && (u.opsTier === 'ceo' || u.leadership === 'finance_director' || this.audit(u) || (!!co && this.director(u, co)));
  }
  /** Attendees see the roll-up (who has sent) though not every company's detail. */
  private seesBoard(u: User) {
    return !u.integration && (this.wide(u) || this.hr(u) || this.audit(u) || u.role === 'company_manager' || u.role === 'pwvsb_officer' || u.role === 'director');
  }

  // ---------- the meeting (Y1, Y2, Y9) ----------
  private mtgId(period: string) {
    return `gm-mtg-${period}`;
  }
  private repId(period: string, scope: string) {
    return `gm-rep-${period}-${scope.replace(':', '-')}`;
  }
  async meeting(period: string) {
    return this.get(this.mtgId(period));
  }
  /** The submission deadline: N working days before the meeting (Y-Q3). Null while no date is set. */
  async deadline(period: string): Promise<IsoDate | null> {
    const m = await this.meeting(period);
    const on = m?.d.meetingOn as IsoDate | undefined;
    if (!on) return null;
    return subWorkingDays(on, RULES.groupMonthly.value.deadlineWorkingDays, (await this.svc.itHolidays()).set);
  }
  private async bil(period: string) {
    const y = period.slice(0, 4);
    const all = (await this.recs('meeting')).filter((r) => r.period.startsWith(y)).sort((a, b) => a.period.localeCompare(b.period));
    const n = all.findIndex((r) => r.period === period);
    return `Bil ${(n < 0 ? all.length : n) + 1}/${y}`;
  }
  /** Unit HR sets the meeting date (agreed with the CEO) for the month reported. */
  async setMeeting(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!this.hr(user)) throw new AccessDenied('view', '(Unit HR organises the monthly group meeting)');
    const period = s(i.period, 7);
    if (!isMonth(period)) throw new BadRequest('Give the month reported (YYYY-MM).');
    const meetingOn = s(i.meetingOn, 10);
    if (!isDate(meetingOn) || meetingOn.slice(0, 7) < nextMonth(period)) throw new BadRequest(`The meeting for ${period} is held after that month ends (usually the 9th-18th of the next month).`);
    const cur = await this.meeting(period);
    if (cur?.d.minutesStatus === 'verified') throw new BadRequest('The minutes are verified; the meeting is closed.');
    const d = { ...(cur?.d ?? {}), meetingOn, agreedWith: s(i.agreedWith, 120) || 'CEO', note: s(i.note, 300) };
    const rec = this.rec(user, 'meeting', this.mtgId(period), 'group', null, period, cur?.status ?? 'planned', d, cur, `mesyuarat ${meetingOn}${cur?.d.meetingOn && cur.d.meetingOn !== meetingOn ? ` (dari ${cur.d.meetingOn})` : ''}`);
    return this.save(user, rec, 'meeting', `meeting on ${meetingOn}`, cur);
  }
  /** Y9: logistics from the HR checklist. Outlook invites are sent in Outlook; Prima records that they were sent. Catering stays outside Prima. */
  async logistics(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!this.hr(user)) throw new AccessDenied('view', '(Unit HR organises the monthly group meeting)');
    const period = s(i.period, 7);
    const cur = await this.meeting(period);
    if (!cur) throw new BadRequest('Set the meeting date first.');
    const users = await this.store.list('users');
    const recorders = Array.isArray(i.recorderIds) ? (i.recorderIds as unknown[]).map((x) => s(x, 80)).filter(Boolean) : ((cur.d.recorderIds as Id[]) ?? []);
    for (const r of recorders) if (!users.some((u) => u.id === r && !u.integration)) throw new BadRequest('A minute-taker is not a Prima user.');
    const invitesSentOn = i.invitesSentOn == null || i.invitesSentOn === '' ? ((cur.d.invitesSentOn as string | null) ?? null) : s(i.invitesSentOn, 10);
    if (invitesSentOn && (!isDate(invitesSentOn) || invitesSentOn > this.today())) throw new BadRequest('The invites date is a date, not in the future.');
    const prev = await this.meeting(prevMonth(period));
    const d = {
      ...cur.d,
      invitesSentOn,
      recorderIds: recorders,
      recorders: recorders.map((r) => users.find((u) => u.id === r)?.name ?? r),
      room: s(i.room ?? cur.d.room, 120),
      lastMinutesId: prev?.d.minutesStatus === 'verified' ? prev.id : null,
    };
    const rec = this.rec(user, 'meeting', cur.id, 'group', null, period, cur.status, d, cur, `logistik: jemputan ${invitesSentOn ?? 'belum'}, pencatat ${recorders.length}`);
    return this.save(user, rec, 'logistics', 'logistics recorded', cur);
  }
  /** Minutes of the group meeting (Y-Q10: Prima's minutes are the record). Unit HR prepares; the Director Office or the CEO verifies, never the preparer. */
  async minutes(user: User, i: Record<string, unknown>) {
    await this.need();
    const period = s(i.period, 7);
    const cur = await this.meeting(period);
    if (!cur) throw new NotFound('Monthly meeting');
    const step = s(i.step, 20);
    const st = (cur.d.minutesStatus as string | undefined) ?? 'none';
    const d = { ...cur.d };
    let note = '';
    if (step === 'draft') {
      if (!this.hr(user)) throw new AccessDenied('view', '(Unit HR prepares the minutes)');
      if (st === 'submitted' || st === 'verified') throw new BadRequest('The minutes are submitted or verified.');
      if ((cur.d.meetingOn as string) > this.today()) throw new BadRequest('Minutes are written after the meeting.');
      const text = s(i.text, 20000);
      if (text.length < 20) throw new BadRequest('Write the minutes (decisions and who does what by when).');
      d.minutes = noIc(text);
      // X17 pattern: AI notes from Loop or Notes are pasted, and stay "belum disemak" until the preparer ticks them.
      if (i.aiNotes != null) d.aiNotes = { text: noIc(s(i.aiNotes, 20000)), checked: i.aiChecked === true, checkedBy: i.aiChecked === true ? user.name : null };
      d.minutesStatus = 'draft';
      d.preparedBy = user.name;
      d.preparedById = user.id;
      note = 'minit draf';
    } else if (step === 'submit') {
      if (!this.hr(user)) throw new AccessDenied('view', '(Unit HR submits the minutes)');
      if (st !== 'draft' && st !== 'returned') throw new BadRequest('Write the minutes first.');
      const ai = d.aiNotes as { checked?: boolean; text?: string } | undefined;
      if (ai?.text && !ai.checked) throw new BadRequest('Tick that the AI notes were checked (nota AI - belum disemak) before submitting.');
      d.minutesStatus = 'submitted';
      note = 'minit dihantar untuk pengesahan';
    } else if (step === 'verify' || step === 'return') {
      if (!(this.doa(user) || this.ceo(user))) throw new AccessDenied('view', '(the Director Office or the CEO verifies the group minutes)');
      if (st !== 'submitted') throw new BadRequest('The minutes are not waiting for verification.');
      if (d.preparedById === user.id) throw new AccessDenied('view', '(nobody verifies minutes they prepared)');
      const comment = s(i.comment, 500);
      if (!comment) throw new BadRequest(step === 'verify' ? 'Write a comment to verify (a short one is fine).' : 'Say why the minutes go back.');
      d.minutesStatus = step === 'verify' ? 'verified' : 'returned';
      if (step === 'verify') {
        d.verifiedBy = user.name;
        d.verifiedAt = this.now();
      }
      note = `${step === 'verify' ? 'disahkan' : 'dikembalikan'}: ${comment}`;
    } else throw new BadRequest('Step: draft, submit, verify or return.');
    const rec = this.rec(user, 'meeting', cur.id, 'group', null, period, d.minutesStatus === 'verified' ? 'held' : cur.status, d, cur, note);
    return this.save(user, rec, `minutes.${step}`, note, cur);
  }

  // ---------- the company and unit reports (Y1-Y4, Y8) ----------
  private async units(): Promise<string[]> {
    const users = await this.store.list('users');
    const depts = new Set(users.filter((u) => u.role === 'pwvsb_officer' && !u.integration && u.department && u.department !== 'director_office' && u.department !== 'chief_of_staff').map((u) => u.department as string));
    return [...depts].sort();
  }
  /** The latest verified Part X toolbox pack of the scope from the month reported onwards (one report, not two: Y-Q2). */
  private async latestPack(scope: string, period: string): Promise<{ pack: Record<string, PackLine[]>; meetingId: Id; packAt: string } | null> {
    const mins = ((await this.store.list('toolboxRecs', {}).catch(() => [])) as { kind: string; scope: string; status: string; d: Record<string, unknown> }[]).filter((r) => r.kind === 'minutes' && r.scope === scope && r.status === 'verified');
    const meetings = new Map((await this.store.list('meetings')).map((m) => [m.id, m]));
    const cut = `${nextMonth(period)}-31`;
    const pick = mins
      .map((r) => ({ r, m: meetings.get(String(r.d.meetingId)) }))
      .filter((x) => x.m && dateOf(x.m.start) <= cut && dateOf(x.m.start) >= `${period}-01`)
      .sort((a, b) => a.m!.start.localeCompare(b.m!.start))
      .pop();
    return pick ? { pack: (pick.r.d.pack as Record<string, PackLine[]>) ?? {}, meetingId: pick.m!.id, packAt: String(pick.r.d.packAt ?? '') } : null;
  }
  /** The monthly-only lines Prima fills from records (Y3). */
  private async ownLines(co: Id, period: string): Promise<Record<string, PackLine[]>> {
    const out: Record<string, PackLine[]> = {};
    const L = (k: string, text: string, source: string, red = false) => (out[k] ??= []).push({ text: noIc(text), source, ...(red ? { red } : {}) });
    const from = `${period}-01`;
    const to = dayIn(period, 31);
    // 1: board from the company secretary records; shareholdings stay in SULIT (Y9), only the count shows here.
    const profile = (await this.store.list('corpProfiles', { companyId: [co] }).catch(() => [])).find((p) => p.companyId === co);
    if (profile) {
      L('1', `Pengarah: ${profile.directors.length}${profile.directors.some((d) => d.appointedOn >= from && d.appointedOn <= to) ? ' (pelantikan baharu bulan ini)' : ''}; pemegang saham: ${profile.shareholders?.length ?? 0} (butiran dalam SULIT)`, 'Setiausaha syarikat');
      for (const sh of profile.shareholders ?? []) L('sulit', `Pemegang saham: ${(sh as { name?: string }).name ?? '-'}${(sh as { percent?: number }).percent != null ? ` ${(sh as { percent?: number }).percent}%` : ''}`, 'Setiausaha syarikat (SULIT)');
    } else L('1', 'Daftar setiausaha syarikat: tiada rekod', 'Setiausaha syarikat', true);
    const filings = (await this.store.list('corpFilings', { companyId: [co] }).catch(() => [])).filter((f) => f.companyId === co && ['DIRECTOR_CHANGE', 'SHARE_CHANGE'].includes(f.kind));
    for (const f of filings.filter((x) => String((x as { lodgedOn?: string; createdOn?: string }).lodgedOn ?? (x as { createdOn?: string }).createdOn ?? '').slice(0, 7) === period))
      L('1', `${f.kind === 'DIRECTOR_CHANGE' ? 'Perubahan pengarah' : 'Perubahan saham'} difailkan`, 'Setiausaha syarikat');
    // 5: court cases from Legal.
    const legal = (await this.store.list('legalMatters', { companyId: [co] }).catch(() => [])).filter((m) => m.companyId === co && m.status === 'open' && m.kind === 'LITIGATION');
    for (const m of legal) L('5', `Kes mahkamah ${m.ref}: ${m.title}${m.nextDate ? `, ${m.nextDate.what} ${m.nextDate.on}` : ''}`, 'Undang-undang');
    if (!legal.length) L('5', 'Kes mahkamah terbuka: tiada', 'Undang-undang');
    // 9: guard pay method counts (guard pay stays in JA; the company office records the counts).
    const pm = (await this.recs('payMethod')).find((r) => r.companyId === co && r.period === period);
    if (pm) L('9', `Pindahan ${pm.d.transfer}, tiada akaun bank ${pm.d.noAccount}, tunai ${pm.d.cash}`, 'JA (direkod syarikat)', Number(pm.d.cash) > 0 || Number(pm.d.noAccount) > 0);
    else L('9', 'Kaedah bayaran gaji pengawal: tiada rekod bulan ini', 'JA (direkod syarikat)', true);
    // 10: JTK complaints and audits.
    const jtk = (await this.recs('jtk')).filter((r) => r.companyId === co && (r.status === 'open' || String(r.d.closedOn ?? '').slice(0, 7) === period));
    for (const j of jtk)
      L('10', `${j.d.type === 'audit' ? 'Audit JTK' : 'Aduan JTK'} ${j.d.ref}: diterima ${j.d.receivedOn}${j.d.staffNo ? `, pekerja ${j.d.staffNo}` : ''}${j.d.amount ? `, RM${j.d.amount}` : ''}${j.d.hearingOn ? `, pendengaran ${j.d.hearingOn}` : ''}${j.status === 'closed' ? `, keputusan: ${j.d.outcome}` : ''}`, 'Daftar JTK', j.status === 'open');
    if (!jtk.length) L('10', 'Aduan / audit JTK: tiada', 'Daftar JTK');
    return out;
  }
  private async buildLines(scope: string, period: string) {
    const { co, dept } = this.parse(scope);
    const pk = await this.latestPack(scope, period);
    const lines: Record<string, PackLine[]> = {};
    const add = (k: string, l: PackLine[]) => (lines[k] = [...(lines[k] ?? []), ...l]);
    if (co) {
      for (const it of RULES.groupMonthly.value.items) for (const sec of it.from) add(it.key, pk?.pack[sec] ?? []);
      if (pk?.pack.sulit) add('sulit', pk.pack.sulit);
      const own = await this.ownLines(co, period);
      for (const [k, v] of Object.entries(own)) add(k, v);
      for (const it of RULES.groupMonthly.value.items) if (!lines[it.key]?.length && it.own !== 'line') add(it.key, [{ text: 'tiada rekod', source: '-', red: true }]);
    } else {
      for (const [k, v] of Object.entries(pk?.pack ?? {})) add(`d${k}`, v);
      if (dept === 'audit') {
        const t = await this.acctGrid(period.slice(0, 4));
        const due = t.rows.filter((r) => r.cells.some((c) => c.state === 'late' || c.state === 'missing'));
        add('u0', [{ text: `Laporan akaun: ${t.rows.length} entiti, ${due.length} lewat atau belum dihantar`, source: 'Penjejak laporan akaun', ...(due.length ? { red: true } : {}) }]);
      }
    }
    if (!pk) add('pack', [{ text: `Tiada pek toolbox disahkan untuk ${period}`, source: 'Toolbox', red: true }]);
    return { lines, packMeetingId: pk?.meetingId ?? null, packAt: pk?.packAt ?? null };
  }
  /** The items of a scope: the 14-item template for a company, the department pack sections plus unit sections for a unit. */
  private items(scope: string) {
    const { co, dept } = this.parse(scope);
    if (co) return RULES.groupMonthly.value.items.map((x) => ({ key: x.key, title: x.title }));
    const units = RULES.groupMonthly.value.unitSections[dept!] ?? [];
    return [
      ...RULES.toolbox.value.agenda.department.map((x) => ({ key: `d${x.key}`, title: x.title })),
      ...units.map((t, n) => ({ key: `u${n}`, title: t })),
    ];
  }
  /** Y1: build (or rebuild) the month's report from records; refused once submitted or verified. */
  async reportBuild(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    const period = s(i.period, 7);
    if (!isMonth(period) || period >= this.today().slice(0, 7)) throw new BadRequest('Report a month that has ended (YYYY-MM).');
    if (!this.prepares(user, scope)) throw new AccessDenied('view', '(the company admin team or the unit prepares its monthly report)');
    const id = this.repId(period, scope);
    const cur = await this.get(id);
    if (cur && ['submitted', 'verified'].includes(cur.status)) throw new BadRequest('The report is submitted or verified; it cannot be rebuilt.');
    const built = await this.buildLines(scope, period);
    const d = { ...(cur?.d ?? {}), items: this.items(scope), ...built, builtAt: this.now(), notes: (cur?.d.notes as Record<string, string>) ?? {}, ticks: (cur?.d.ticks as Record<string, string>) ?? {} };
    const rec = this.rec(user, 'report', id, scope, this.parse(scope).co, period, 'draft', d, cur, `laporan dibina (data setakat ${this.now()})`);
    return this.save(user, rec, 'report.build', 'report built', cur);
  }
  /** Status notes per item (paid-up capital, filing and cleanliness, staff relations, unit sections) and the changed / no change tick. */
  async reportSave(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    const period = s(i.period, 7);
    const cur = await this.get(this.repId(period, scope));
    if (!cur) throw new BadRequest('Build the report first.');
    if (!this.prepares(user, scope)) throw new AccessDenied('view', '(the company admin team or the unit prepares its monthly report)');
    if (['submitted', 'verified'].includes(cur.status)) throw new BadRequest('The report is submitted or verified.');
    const keys = new Set((cur.d.items as { key: string }[]).map((x) => x.key));
    const notes = { ...((cur.d.notes as Record<string, string>) ?? {}) };
    const ticks = { ...((cur.d.ticks as Record<string, string>) ?? {}) };
    for (const [k, v] of Object.entries((i.notes as Record<string, unknown>) ?? {})) {
      if (!keys.has(k)) throw new BadRequest(`Item ${k} is not on this report.`);
      notes[k] = noIc(s(v, 3000));
    }
    for (const [k, v] of Object.entries((i.ticks as Record<string, unknown>) ?? {})) {
      if (!keys.has(k)) throw new BadRequest(`Item ${k} is not on this report.`);
      if (v !== 'berubah' && v !== 'tiada_perubahan') throw new BadRequest('Tick: berubah or tiada_perubahan.');
      ticks[k] = v;
    }
    const rec = this.rec(user, 'report', cur.id, scope, cur.companyId, period, cur.status === 'returned' ? 'returned' : 'draft', { ...cur.d, notes, ticks }, cur, 'catatan dikemas kini');
    return this.save(user, rec, 'report.save', 'notes saved', cur);
  }
  async reportSubmit(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    const period = s(i.period, 7);
    const cur = await this.get(this.repId(period, scope));
    if (!cur) throw new BadRequest('Build the report first.');
    if (!this.prepares(user, scope)) throw new AccessDenied('view', '(the company admin team or the unit submits its monthly report)');
    if (cur.status !== 'draft' && cur.status !== 'returned') throw new BadRequest('The report is already submitted or verified.');
    const items = cur.d.items as { key: string; title: string }[];
    const ticks = (cur.d.ticks as Record<string, string>) ?? {};
    const notes = (cur.d.notes as Record<string, string>) ?? {};
    const missing = items.filter((x) => !ticks[x.key]);
    if (missing.length) throw new BadRequest(`Tick "berubah" or "tiada perubahan" for every item: ${missing.map((x) => x.key).join(', ')}.`);
    // YL2: no copy-forward. An item marked changed with the same note as last month's verified report is refused.
    const last = await this.get(this.repId(prevMonth(period), scope));
    if (last?.status === 'verified') {
      const ln = (last.d.notes as Record<string, string>) ?? {};
      const same = items.filter((x) => ticks[x.key] === 'berubah' && notes[x.key] && notes[x.key] === ln[x.key]);
      if (same.length) throw new BadRequest(`Item ${same.map((x) => x.key).join(', ')} says "berubah" but the note is the same as last month. Update it or tick "tiada perubahan".`);
    }
    for (const k of ['13', '14']) if (items.some((x) => x.key === k) && !notes[k]) throw new BadRequest(`Write a status line for item ${k}.`);
    const rec = this.rec(user, 'report', cur.id, scope, cur.companyId, period, 'submitted', { ...cur.d, preparedBy: user.name, preparedById: user.id, submittedAt: this.now() }, cur, 'dihantar untuk pengesahan');
    return this.save(user, rec, 'report.submit', 'submitted', cur);
  }
  /** Y-Q3: the company manager verifies (or a director of the company); the unit head for a unit. Never the preparer. */
  private async verifies(user: User, scope: string) {
    const { co, dept } = this.parse(scope);
    return co ? this.manager(user, co) || this.director(user, co) : this.head(user, dept!);
  }
  async reportDecide(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    const period = s(i.period, 7);
    const cur = await this.get(this.repId(period, scope));
    if (!cur) throw new NotFound('Monthly report');
    if (cur.status !== 'submitted') throw new BadRequest('The report is not waiting for verification.');
    if (!(await this.verifies(user, scope))) throw new AccessDenied('view', '(the company manager verifies the company report; the unit head the unit report)');
    if (cur.d.preparedById === user.id) throw new AccessDenied('view', '(nobody verifies a report they prepared)');
    const verdict = s(i.verdict, 10);
    const comment = s(i.comment, 500);
    if (verdict !== 'verify' && verdict !== 'return') throw new BadRequest('Verify or return.');
    if (!comment) throw new BadRequest(verdict === 'verify' ? 'Write a comment to verify (a short one is fine).' : 'Say why it goes back.');
    const d = verdict === 'verify' ? { ...cur.d, verifiedBy: user.name, verifiedById: user.id, verifiedAt: this.now() } : cur.d;
    const rec = this.rec(user, 'report', cur.id, scope, cur.companyId, period, verdict === 'verify' ? 'verified' : 'returned', d, cur, `${verdict === 'verify' ? 'disahkan' : 'dikembalikan'}: ${comment}`);
    return this.save(user, rec, `report.${verdict}`, comment, cur);
  }
  async reportView(user: User, i: Record<string, unknown>) {
    const scope = s(i.scope, 80);
    const period = s(i.period, 7);
    if (!this.reads(user, scope)) throw new AccessDenied('view', '(monthly report)');
    const cur = await this.get(this.repId(period, scope));
    if (!cur) return { scope, period, status: 'none', items: this.items(scope), lines: {}, notes: {}, ticks: {}, can: { prepare: this.prepares(user, scope), verify: await this.verifies(user, scope) } };
    const lines = { ...((cur.d.lines as Record<string, PackLine[]>) ?? {}) };
    const co = this.parse(scope).co;
    if (lines.sulit?.length) {
      if (this.seesSulit(user, co))
        await this.store.transaction(async (tx) => {
          await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'groupMonth.sulit_open', entity: 'group_month_rec', entityId: cur.id, summary: `${scope} ${period}: SULIT section opened.` });
        });
      else lines.sulit = [{ text: `Sulit: ${lines.sulit.length} perkara`, source: 'SULIT' }];
    }
    return {
      scope,
      period,
      status: cur.status,
      items: cur.d.items,
      lines,
      notes: cur.d.notes ?? {},
      ticks: cur.d.ticks ?? {},
      builtAt: cur.d.builtAt ?? null,
      packMeetingId: cur.d.packMeetingId ?? null,
      preparedBy: cur.d.preparedBy ?? null,
      verifiedBy: cur.d.verifiedBy ?? null,
      history: cur.history,
      deadline: await this.deadline(period),
      can: { prepare: this.prepares(user, scope) && ['draft', 'returned'].includes(cur.status), verify: cur.status === 'submitted' && (await this.verifies(user, scope)) && cur.d.preparedById !== user.id },
    };
  }
  /** Y1 / Y2: who has sent and who has not, late in red. Group roles, Unit HR, Internal Audit and attendees see it. */
  async board(user: User, i: Record<string, unknown>) {
    if (!this.seesBoard(user)) throw new AccessDenied('view', '(monthly group meeting)');
    const period = isMonth(i.period) ? (i.period as string) : prevMonth(this.today().slice(0, 7));
    const m = await this.meeting(period);
    const deadline = await this.deadline(period);
    const today = this.today();
    const reps = (await this.recs('report')).filter((r) => r.period === period);
    const companies = await this.store.list('companies');
    const scopes = [...companies.map((c) => ({ scope: `co:${c.id}`, name: c.name })), ...(await this.units()).map((d) => ({ scope: `dept:${d}`, name: `Unit ${d}` }))];
    const rows = scopes.map((x) => {
      const r = reps.find((y) => y.scope === x.scope);
      const status = r?.status ?? 'none';
      const late = !!deadline && today > deadline && status !== 'verified';
      const onDay = !!m?.d.meetingOn && today >= (m.d.meetingOn as string) && status !== 'verified';
      return { ...x, status, late, red: onDay, submittedAt: r?.d.submittedAt ?? null, verifiedBy: r?.d.verifiedBy ?? null };
    });
    return {
      period,
      bil: m ? await this.bil(period) : null,
      meetingOn: m?.d.meetingOn ?? null,
      deadline,
      invitesSentOn: m?.d.invitesSentOn ?? null,
      recorders: m?.d.recorders ?? [],
      lastMinutesId: m?.d.lastMinutesId ?? null,
      minutesStatus: m?.d.minutesStatus ?? 'none',
      minutes: this.wide(user) || this.hr(user) || this.audit(user) || m?.d.minutesStatus === 'verified' ? (m?.d.minutes ?? null) : null,
      aiNotes: this.hr(user) ? (m?.d.aiNotes ?? null) : null,
      rows,
      sent: rows.filter((r) => r.status === 'verified').length,
      notSent: rows.filter((r) => r.status !== 'verified').map((r) => r.name),
      can: { organise: this.hr(user), verifyMinutes: this.doa(user) || this.ceo(user) },
    };
  }

  // ---------- registers (Y3) ----------
  async jtk(user: User, i: Record<string, unknown>) {
    await this.need();
    const co = s(i.companyId, 80);
    if (!this.office(user, co)) throw new AccessDenied('view', '(the company admin team keeps the JTK register)');
    const id = s(i.id, 120) || `gm-jtk-${co}-${toMs(this.now())}`;
    const cur = await this.get(id);
    if (cur && cur.companyId !== co) throw new NotFound('JTK record');
    const type = s(i.type ?? cur?.d.type, 10);
    if (type !== 'complaint' && type !== 'audit') throw new BadRequest('Type: complaint or audit.');
    const ref = s(i.ref ?? cur?.d.ref, 60);
    const receivedOn = s(i.receivedOn ?? cur?.d.receivedOn, 10);
    if (ref.length < 2 || !isDate(receivedOn)) throw new BadRequest('Give the JTK reference and the date received.');
    // PDPA (YL1): the complainant is named by staff number only; a name stays on the JTK letter.
    const staffNo = s(i.staffNo ?? cur?.d.staffNo, 30);
    if (/[a-z]{3,}\s+[a-z]{3,}/i.test(staffNo)) throw new BadRequest('Give the staff number, not the name.');
    const amount = i.amount == null || i.amount === '' ? ((cur?.d.amount as number | null) ?? null) : Number(i.amount);
    if (amount != null && !(amount >= 0)) throw new BadRequest('The amount is RM, 0 or more.');
    const hearingOn = s(i.hearingOn ?? cur?.d.hearingOn, 10) || null;
    if (hearingOn && !isDate(hearingOn)) throw new BadRequest('The hearing date is a date.');
    const close = i.close === true;
    const outcome = s(i.outcome ?? cur?.d.outcome, 500);
    if (close && outcome.length < 3) throw new BadRequest('Write the outcome to close it.');
    const d = { type, ref, receivedOn, staffNo, amount, hearingOn, outcome, closedOn: close ? this.today() : (cur?.d.closedOn ?? null) };
    const rec = this.rec(user, 'jtk', id, `co:${co}`, co, receivedOn.slice(0, 7), close ? 'closed' : 'open', d, cur, close ? `ditutup: ${outcome}` : `${type} ${ref}`);
    return this.save(user, rec, 'jtk', `${type} ${ref}`, cur);
  }
  async payMethod(user: User, i: Record<string, unknown>) {
    await this.need();
    const co = s(i.companyId, 80);
    if (!this.office(user, co)) throw new AccessDenied('view', '(the company admin team records the guard pay method counts)');
    const period = s(i.period, 7);
    if (!isMonth(period)) throw new BadRequest('Give the month (YYYY-MM).');
    const n = (v: unknown, what: string) => {
      const x = Number(v);
      if (!Number.isInteger(x) || x < 0) throw new BadRequest(`${what}: a whole number, 0 or more.`);
      return x;
    };
    const d = { transfer: n(i.transfer, 'Paid by transfer'), noAccount: n(i.noAccount, 'No bank account'), cash: n(i.cash, 'Paid in cash'), note: s(i.note, 300), source: 'JA' };
    const id = `gm-pay-${co}-${period}`;
    const cur = await this.get(id);
    const rec = this.rec(user, 'payMethod', id, `co:${co}`, co, period, 'recorded', d, cur, `pindahan ${d.transfer}, tiada akaun ${d.noAccount}, tunai ${d.cash}`);
    return this.save(user, rec, 'payMethod', 'pay method counts', cur);
  }
  async registers(user: User, i: Record<string, unknown>) {
    const co = s(i.companyId, 80);
    if (!this.reads(user, `co:${co}`)) throw new AccessDenied('view', '(company registers)');
    const all = await this.recs();
    return {
      jtk: all.filter((r) => r.kind === 'jtk' && r.companyId === co).map((r) => ({ id: r.id, status: r.status, ...r.d })),
      payMethod: all.filter((r) => r.kind === 'payMethod' && r.companyId === co).map((r) => ({ period: r.period, ...r.d })),
    };
  }

  // ---------- accounts report tracker and the Friday report (Y5) ----------
  private acctDue(period: string) {
    return dayIn(nextMonth(period), RULES.groupMonthly.value.acctReportDueDay);
  }
  async acctSent(user: User, i: Record<string, unknown>) {
    await this.need();
    const co = s(i.companyId, 80);
    if (!(this.office(user, co) || this.finance(user))) throw new AccessDenied('view', '(the company office or Finance records that the accounts report was sent)');
    const period = s(i.period, 7);
    if (!isMonth(period) || period >= this.today().slice(0, 7)) throw new BadRequest('Give a month that has ended (YYYY-MM).');
    const sentOn = s(i.sentOn ?? this.today(), 10);
    if (!isDate(sentOn) || sentOn > this.today()) throw new BadRequest('The sent date is a date, not in the future.');
    const ref = s(i.ref, 300);
    if (ref.length < 3) throw new BadRequest('Give the report file name or link.');
    const id = `gm-acct-${co}-${period}`;
    const cur = await this.get(id);
    if (cur?.status === 'reviewed') throw new BadRequest('Internal Audit has reviewed this report.');
    const fin = (await this.store.list('finStatus', { companyId: [co] }).catch(() => [])).find((f) => f.companyId === co);
    const due = this.acctDue(period);
    const lateDays = sentOn > due ? Math.round((toMs(myt(sentOn, '12:00')) - toMs(myt(due, '12:00'))) / 86_400_000) : 0;
    const d = { sentOn, ref, due, lateDays, financeTeam: (fin as { team?: string } | undefined)?.team ?? null, sentBy: user.name, sentById: user.id };
    const rec = this.rec(user, 'acct', id, `co:${co}`, co, period, 'sent', d, cur, `dihantar ${sentOn}${lateDays ? `, lewat ${lateDays} hari` : ''}`);
    return this.save(user, rec, 'acct.sent', `accounts report ${period} sent`, cur);
  }
  async acctReview(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!this.audit(user)) throw new AccessDenied('view', '(Internal Audit reviews the accounts reports)');
    const co = s(i.companyId, 80);
    const period = s(i.period, 7);
    const cur = await this.get(`gm-acct-${co}-${period}`);
    if (!cur || cur.status !== 'sent') throw new BadRequest('The report has not been sent.');
    if (cur.d.sentById === user.id) throw new AccessDenied('view', '(nobody reviews a report they sent)');
    const comment = s(i.comment, 500);
    if (!comment) throw new BadRequest('Write the review comment.');
    const rec = this.rec(user, 'acct', cur.id, cur.scope, co, period, 'reviewed', { ...cur.d, reviewedBy: user.name, reviewedOn: this.today(), comment }, cur, `disemak: ${comment}`);
    return this.save(user, rec, 'acct.review', comment, cur);
  }
  private async acctGrid(year: string) {
    const companies = await this.store.list('companies');
    const recs = (await this.recs('acct')).filter((r) => r.period.startsWith(year));
    const today = this.today();
    const months = Array.from({ length: 12 }, (_, n) => `${year}-${String(n + 1).padStart(2, '0')}`).filter((p) => p < today.slice(0, 7));
    const rows = companies.map((c) => ({
      companyId: c.id,
      name: c.name,
      cells: months.map((p) => {
        const r = recs.find((x) => x.companyId === c.id && x.period === p);
        const due = this.acctDue(p);
        const state = r ? (Number(r.d.lateDays) > 0 ? 'late' : r.status === 'reviewed' ? 'reviewed' : 'sent') : today > due ? 'missing' : 'not_due';
        return { period: p, due, state, sentOn: r?.d.sentOn ?? null, lateDays: r?.d.lateDays ?? null, financeTeam: r?.d.financeTeam ?? null };
      }),
    }));
    return { year, months, rows };
  }
  async acctTracker(user: User, i: Record<string, unknown>) {
    if (!(this.audit(user) || this.wide(user) || this.finance(user))) throw new AccessDenied('view', '(accounts report tracker)');
    return this.acctGrid(/^\d{4}$/.test(String(i.year ?? '')) ? String(i.year) : this.today().slice(0, 4));
  }
  /** The red/yellow/green report: red = a due report not sent; yellow = sent late or open ACT findings; green otherwise. */
  async ryg(user: User) {
    if (!(this.audit(user) || this.wide(user))) throw new AccessDenied('view', '(Internal Audit weekly report)');
    const grid = await this.acctGrid(this.today().slice(0, 4));
    const findings = (await this.store.list('actFindings', {}).catch(() => [])) as { companyId?: Id | null; status?: string }[];
    const rows = grid.rows.map((r) => {
      const missing = r.cells.filter((c) => c.state === 'missing').map((c) => c.period);
      const late = r.cells.filter((c) => c.state === 'late').map((c) => c.period);
      const open = findings.filter((f) => f.companyId === r.companyId && !['closed', 'resolved'].includes(String(f.status))).length;
      const colour = missing.length ? 'red' : late.length || open ? 'yellow' : 'green';
      return { companyId: r.companyId, name: r.name, colour, missing, late, openFindings: open };
    });
    return { asOf: this.now(), rows, red: rows.filter((r) => r.colour === 'red').length, yellow: rows.filter((r) => r.colour === 'yellow').length, green: rows.filter((r) => r.colour === 'green').length };
  }
  /** Internal Audit freezes the Friday report for the employer (one per week). */
  async rygFreeze(user: User) {
    await this.need();
    if (!this.audit(user)) throw new AccessDenied('view', '(Internal Audit sends the Friday report)');
    const r = await this.ryg(user);
    const week = addDays(this.today(), 1 - weekday(this.today()));
    const id = `gm-ryg-${week}`;
    const cur = await this.get(id);
    if (cur) throw new BadRequest(`This week's report was already sent on ${dateOf(cur.at)}.`);
    const rec = this.rec(user, 'ryg', id, 'group', null, week.slice(0, 7), 'sent', { week, ...r }, null, `merah ${r.red}, kuning ${r.yellow}, hijau ${r.green}`);
    return this.save(user, rec, 'ryg', `red ${r.red}, yellow ${r.yellow}, green ${r.green}`, null);
  }

  // ---------- duty checklists (Y6, Y7, Y11) ----------
  private async dutyKeeper(user: User, scope: string) {
    const { co, dept } = this.parse(scope);
    return co ? this.manager(user, co) : this.head(user, dept!);
  }
  private async person(scope: string, id: unknown, what: string) {
    const { co, dept } = this.parse(scope);
    const u = (await this.store.list('users')).find((x) => x.id === s(id, 80) && !x.integration);
    if (!u) throw new BadRequest(`Choose the ${what}.`);
    if (co ? !u.companyIds.includes(co) || !['company_manager', 'admin_exec'].includes(u.role) : !this.member(u, dept!)) throw new BadRequest(`The ${what} must work in this company's office or this unit.`);
    return u;
  }
  private dutyFields(i: Record<string, unknown>, cur?: Partial<DutyLine>) {
    const text = s(i.text ?? cur?.text, 300);
    if (text.length < 3) throw new BadRequest('Write the duty.');
    const every = s(i.every ?? cur?.every, 10) as DutyEvery;
    if (!EVERY.includes(every)) throw new BadRequest('How often: daily, weekly, monthly, yearly or adhoc.');
    const num = (v: unknown, lo: number, hi: number, what: string) => {
      if (v == null || v === '') return null;
      const x = Number(v);
      if (!Number.isInteger(x) || x < lo || x > hi) throw new BadRequest(`${what}: ${lo} to ${hi}.`);
      return x;
    };
    const fromDay = num(i.fromDay ?? cur?.fromDay, 1, 31, 'From day');
    const toDay = num(i.toDay ?? cur?.toDay, 1, 31, 'To day');
    const month = num(i.month ?? cur?.month, 1, 12, 'Month');
    const wkday = num(i.weekday ?? cur?.weekday, 1, 5, 'Weekday');
    if ((every === 'monthly' || every === 'yearly') && (fromDay == null || toDay == null || toDay < fromDay)) throw new BadRequest('Give the date window (from day to day, e.g. 5-15hb).');
    if (every === 'yearly' && month == null) throw new BadRequest('Give the month of a yearly duty.');
    if (every === 'weekly' && wkday == null) throw new BadRequest('Give the weekday of a weekly duty (1 Monday to 5 Friday).');
    return { text, every, fromDay, toDay, month, weekday: wkday, sopRef: s(i.sopRef ?? cur?.sopRef, 200) };
  }
  private async dutyRec(user: User, scope: string, id: Id, line: DutyLine, cur: GmRec | null, status: string, note: string) {
    const rec = this.rec(user, 'duty', id, scope, this.parse(scope).co, '', status, line as unknown as Record<string, unknown>, cur, note);
    return this.save(user, rec, 'duty', note, cur);
  }
  private async checkerOf(scope: string, id: unknown, picId: Id) {
    if (id == null || id === '') return null;
    const users = await this.store.list('users');
    const u = users.find((x) => x.id === s(id, 80) && !x.integration);
    if (!u) throw new BadRequest('Choose the checker.');
    if (u.id === picId) throw new BadRequest('The checker is not the person in charge (no self-check).');
    const { co, dept } = this.parse(scope);
    if (co ? !(u.companyIds.includes(co) && ['company_manager', 'director'].includes(u.role)) && !this.wide(u) : !this.member(u, dept!) && !this.wide(u)) throw new BadRequest('The checker is this company\'s manager or director, or a member of this unit.');
    return u;
  }
  /** Part Z1: the checker named on a duty line, if any. */
  async dutyChecker(lineId: Id): Promise<Id | null> {
    const r = await this.get(lineId);
    return r?.kind === 'duty' ? ((r.d.checkerId as Id | null | undefined) ?? null) : null;
  }
  /** Part Z2: the group monthly calendar (the rule's list unless Unit HR or the Director Office changed it in the app). */
  async calendar(): Promise<{ items: CalItem[]; changedBy: string | null; changedAt: string | null; reason: string | null }> {
    const got = await this.get('gm-settings');
    const r = got?.kind === 'settings' ? got : null;
    const items = (r?.d.calendar as CalItem[] | undefined) ?? RULES.groupDuties.value.calendar;
    return { items, changedBy: r ? (r.history.at(-1)?.by ?? r.by) : null, changedAt: r ? (r.history.at(-1)?.at ?? r.at) : null, reason: (r?.d.reason as string | undefined) ?? null };
  }
  async setCalendar(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!(this.hr(user) || this.doa(user))) throw new AccessDenied('view', '(Unit HR or the Director Office keeps the group calendar)');
    const reason = s(i.reason, 300);
    if (reason.length < 3) throw new BadRequest('Say why the calendar changes.');
    if (!Array.isArray(i.items) || !i.items.length || i.items.length > 60) throw new BadRequest('Give the calendar lines (1 to 60).');
    const seen = new Set<string>();
    const items: CalItem[] = i.items.map((raw, n) => {
      const x = (raw ?? {}) as Record<string, unknown>;
      const text = s(x.text, 160);
      if (text.length < 2) throw new BadRequest(`Line ${n + 1}: write what is due.`);
      const every = (s(x.every, 10) || 'monthly') as CalItem['every'];
      if (!['monthly', 'bimonthly', 'twice', 'weekly'].includes(every!)) throw new BadRequest(`Line ${n + 1}: monthly, bimonthly, twice or weekly.`);
      const day = (v: unknown) => {
        if (v == null || v === '') return undefined;
        const d = Number(v);
        if (!Number.isInteger(d) || d < 1 || d > 31) throw new BadRequest(`Line ${n + 1}: day 1 to 31.`);
        return d;
      };
      const fromDay = day(x.fromDay);
      const toDay = day(x.toDay);
      const wd = x.weekday == null || x.weekday === '' ? undefined : Number(x.weekday);
      if (every === 'weekly' && !(Number.isInteger(wd) && wd! >= 1 && wd! <= 5)) throw new BadRequest(`Line ${n + 1}: give the weekday (1 Monday to 5 Friday).`);
      if ((every === 'monthly' || every === 'bimonthly') && (fromDay == null || toDay == null || toDay < fromDay)) throw new BadRequest(`Line ${n + 1}: give the days (from to).`);
      let id = s(x.id, 60) || `cal-${n + 1}`;
      while (seen.has(id)) id = `${id}x`;
      seen.add(id);
      return { id, text, every, ...(fromDay != null ? { fromDay } : {}), ...(toDay != null ? { toDay } : {}), ...(every === 'weekly' ? { weekday: wd } : {}) };
    });
    const cur = await this.get('gm-settings');
    if (cur && cur.kind !== 'settings') throw new BadRequest('The calendar settings record is damaged; ask IT.');
    const rec = this.rec(user, 'settings', 'gm-settings', 'group', null, '', 'active', { ...(cur?.d ?? {}), calendar: items, reason }, cur, `kalendar diubah: ${reason}`);
    await this.save(user, rec, 'calendar', `calendar ${items.length} lines: ${reason}`, cur);
    return this.calendar();
  }
  /** Y6 / Y11: load the group template for a role onto one person (the company manager or the unit head loads). */
  async dutyLoad(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    if (!(await this.dutyKeeper(user, scope))) throw new AccessDenied('view', '(the company manager or the unit head loads the duty checklists)');
    const role = s(i.role, 40);
    const tpl = RULES.groupDuties.value.template[role];
    if (!tpl) throw new BadRequest(`Template: ${Object.keys(RULES.groupDuties.value.template).join(' or ')}.`);
    const pic = await this.person(scope, i.picId, 'person in charge');
    const backup = i.backupId ? await this.person(scope, i.backupId, 'backup') : null;
    if (backup?.id === pic.id) throw new BadRequest('The backup is another person.');
    const checker = await this.checkerOf(scope, i.checkerId, pic.id);
    const existing = (await this.recs('duty')).filter((r) => r.scope === scope && r.status === 'active' && r.d.picId === pic.id);
    const out: GmRec[] = [];
    for (const t of tpl) {
      if (existing.some((r) => r.d.templateId === t.id)) continue;
      const line: DutyLine = { text: t.text, every: t.every, fromDay: t.fromDay ?? null, toDay: t.toDay ?? null, month: t.month ?? null, weekday: t.weekday ?? null, picId: pic.id, picName: pic.name, backupId: backup?.id ?? null, backupName: backup?.name ?? null, checkerId: checker?.id ?? null, checkerName: checker?.name ?? null, sopRef: '', role, templateId: t.id };
      out.push(await this.dutyRec(user, scope, `gm-duty-${scope.replace(':', '-')}-${pic.id}-${t.id}`, line, null, 'active', `templat ${role}: ${t.text}`));
    }
    return { added: out.length, skipped: tpl.length - out.length };
  }
  async dutyAdd(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    if (!(await this.dutyKeeper(user, scope))) throw new AccessDenied('view', '(the company manager or the unit head keeps the duty checklists)');
    const f = this.dutyFields(i);
    const pic = await this.person(scope, i.picId, 'person in charge');
    const backup = i.backupId ? await this.person(scope, i.backupId, 'backup') : null;
    if (backup?.id === pic.id) throw new BadRequest('The backup is another person.');
    const checker = await this.checkerOf(scope, i.checkerId, pic.id);
    const line: DutyLine = { ...f, picId: pic.id, picName: pic.name, backupId: backup?.id ?? null, backupName: backup?.name ?? null, checkerId: checker?.id ?? null, checkerName: checker?.name ?? null, role: s(i.role, 40) || 'own', templateId: null };
    return this.dutyRec(user, scope, `gm-duty-${scope.replace(':', '-')}-${toMs(this.now())}-${Math.random().toString(36).slice(2, 6)}`, line, null, 'active', `baris baharu: ${f.text}`);
  }
  async dutyEdit(user: User, i: Record<string, unknown>) {
    await this.need();
    const cur = await this.get(s(i.id, 160));
    if (!cur || cur.kind !== 'duty') throw new NotFound('Duty line');
    if (!(await this.dutyKeeper(user, cur.scope))) throw new AccessDenied('view', '(the company manager or the unit head keeps the duty checklists)');
    const old = cur.d as unknown as DutyLine;
    if (i.remove === true) {
      const reason = s(i.reason, 300);
      if (reason.length < 3) throw new BadRequest('Say why the line is removed.');
      return this.dutyRec(user, cur.scope, cur.id, old, cur, 'removed', `dibuang: ${reason}`);
    }
    const f = this.dutyFields(i, old);
    const pic = i.picId ? await this.person(cur.scope, i.picId, 'person in charge') : null;
    const backup = i.backupId === null || i.backupId === '' ? null : i.backupId ? await this.person(cur.scope, i.backupId, 'backup') : undefined;
    const line: DutyLine = { ...old, ...f, ...(pic ? { picId: pic.id, picName: pic.name } : {}), ...(backup === null ? { backupId: null, backupName: null } : backup ? { backupId: backup.id, backupName: backup.name } : {}) };
    if (line.backupId && line.backupId === line.picId) throw new BadRequest('The backup is another person.');
    if (i.checkerId !== undefined) {
      const ch = await this.checkerOf(cur.scope, i.checkerId, line.picId);
      line.checkerId = ch?.id ?? null;
      line.checkerName = ch?.name ?? null;
    } else if (line.checkerId && line.checkerId === line.picId) throw new BadRequest('The checker is not the person in charge (no self-check).');
    return this.dutyRec(user, cur.scope, cur.id, line, cur, 'active', `diubah: ${f.text}${pic && pic.id !== old.picId ? `, PIC ${pic.name}` : ''}`);
  }
  async duties(user: User, i: Record<string, unknown>) {
    const scope = s(i.scope, 80);
    const { co, dept } = this.parse(scope);
    if (!(this.wide(user) || this.audit(user) || this.hr(user) || (co ? this.office(user, co) : this.member(user, dept!)))) throw new AccessDenied('view', '(duty checklists)');
    const lines = (await this.recs('duty')).filter((r) => r.scope === scope && r.status === 'active').sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    // Part Z1 (the 70-task layout): number, frequency, target date, actual done date, status, SOP and checker per line.
    const tasks = ((await this.store.list('workTasks', {}).catch(() => [])) as WorkTask[]).filter((t) => t.playbookItemId?.startsWith('duty:'));
    return {
      scope,
      templates: Object.fromEntries(Object.entries(RULES.groupDuties.value.template).map(([k, v]) => [k, v.length])),
      calendar: await this.calendar(),
      lines: lines.map((r, n) => {
        const t = tasks.filter((x) => x.playbookItemId === `duty:${r.id}`).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return {
          no: n + 1,
          id: r.id,
          ...(r.d as unknown as DutyLine),
          window: this.windowText(r.d as unknown as DutyLine),
          period: t?.period ?? null,
          target: t ? dateOf(t.late ? t.late.newDueAt : t.dueAt) : null,
          doneOn: t?.evidence ? dateOf(t.evidence.at) : null,
          status: !t ? 'belum dibuka' : t.status === 'accepted' ? 'disemak' : t.status === 'done' ? 'menunggu semakan' : t.status === 'returned' ? 'dikembalikan' : toMs(this.now()) > toMs(t.late ? t.late.newDueAt : t.dueAt) ? 'lewat' : 'terbuka',
          checkedBy: t?.review?.by ?? null,
        };
      }),
      can: { keep: await this.dutyKeeper(user, scope) },
    };
  }
  windowText(l: Pick<DutyLine, 'every' | 'fromDay' | 'toDay' | 'month' | 'weekday'>) {
    if (l.every === 'daily') return 'setiap hari bekerja';
    if (l.every === 'weekly') return `setiap minggu (hari ${l.weekday})`;
    if (l.every === 'monthly') return `${l.fromDay}-${l.toDay}hb setiap bulan`;
    if (l.every === 'yearly') return `${l.fromDay}-${l.toDay}hb bulan ${l.month}`;
    return 'bila perlu';
  }
  /** The active duty lines a person is in charge of (no permission check: the service reads them for that person's own tasks). */
  async dutyLinesFor(userId: Id): Promise<(DutyLine & { id: Id })[]> {
    return (await this.recs('duty')).filter((r) => r.status === 'active' && r.d.picId === userId).map((r) => ({ id: r.id, ...(r.d as unknown as DutyLine) }));
  }
  /** When a dated duty line opens as a task on a date, with its period and due time; null when not open that day. */
  static openOn(l: Pick<DutyLine, 'every' | 'fromDay' | 'toDay' | 'month' | 'weekday'>, date: IsoDate): { period: string; dueAt: IsoDateTime } | null {
    const day = Number(date.slice(8, 10));
    const ym = date.slice(0, 7);
    if (l.every === 'daily') return { period: date, dueAt: myt(date, '17:00') };
    if (l.every === 'weekly') {
      const mon = addDays(date, 1 - weekday(date));
      return { period: mon, dueAt: myt(addDays(mon, (l.weekday ?? 5) - 1), '17:00') };
    }
    if (l.every === 'monthly') return day >= (l.fromDay ?? 1) ? { period: ym, dueAt: myt(dayIn(ym, l.toDay ?? 28), '17:00') } : null;
    if (l.every === 'yearly') return Number(date.slice(5, 7)) === l.month && day >= (l.fromDay ?? 1) ? { period: date.slice(0, 4), dueAt: myt(dayIn(ym, l.toDay ?? 28), '17:00') } : null;
    return null;
  }
  /** Y7: checklist lines done inside their window, per person, for a month (from the person's checklist tasks). */
  async dutyKpi(user: User, i: Record<string, unknown>) {
    const scope = s(i.scope, 80);
    const { co, dept } = this.parse(scope);
    if (!(this.wide(user) || this.audit(user) || this.hr(user) || (co ? this.manager(user, co) : await this.head(user, dept!)))) throw new AccessDenied('view', '(checklist KPI)');
    const month = isMonth(i.month) ? (i.month as string) : this.today().slice(0, 7);
    const lines = (await this.recs('duty')).filter((r) => r.scope === scope);
    const ids = new Set(lines.map((r) => r.id));
    const tasks = ((await this.store.list('workTasks', {}).catch(() => [])) as WorkTask[]).filter((t) => t.playbookItemId?.startsWith('duty:') && ids.has(t.playbookItemId.slice(5)) && dateOf(t.late ? t.late.newDueAt : t.dueAt).slice(0, 7) === month && toMs(t.late ? t.late.newDueAt : t.dueAt) <= toMs(this.now()));
    const people = new Map<Id, { name: string; due: number; onTime: number }>();
    for (const t of tasks) {
      const p = people.get(t.userId) ?? { name: t.userName, due: 0, onTime: 0 };
      p.due++;
      if ((t.status === 'done' || t.status === 'accepted') && t.evidence && toMs(t.evidence.at) <= toMs(t.late ? t.late.newDueAt : t.dueAt)) p.onTime++;
      people.set(t.userId, p);
    }
    return { scope, month, people: [...people].map(([userId, p]) => ({ userId, ...p, onTimePct: p.due ? Math.round((p.onTime * 100) / p.due) : null })) };
  }

  // ---------- home ----------
  async homeItems(user: User): Promise<HomeItem[]> {
    if (!(await this.installed())) return [];
    const items: HomeItem[] = [];
    const period = prevMonth(this.today().slice(0, 7));
    const m = await this.meeting(period);
    const go = { view: 'meetings' } as HomeItem['go'];
    if (m && (this.hr(user) || this.doa(user))) {
      const b = await this.board(user, { period });
      const late = b.rows.filter((r) => r.late);
      const red = b.rows.filter((r) => r.red);
      if (this.hr(user) && late.length) items.push({ tone: 'warn', tag: 'Mesyuarat bulanan', title: `${late.length} laporan ${period} lewat (tarikh akhir ${b.deadline})`, detail: late.slice(0, 4).map((r) => r.name).join(', '), go });
      if (this.doa(user) && red.length) items.push({ tone: 'crit', tag: 'Mesyuarat bulanan', title: `${red.length} laporan ${period} belum disahkan pada hari mesyuarat`, detail: red.slice(0, 4).map((r) => r.name).join(', '), go });
    }
    if (m && (user.role === 'company_manager' || user.role === 'admin_exec')) {
      const deadline = await this.deadline(period);
      for (const co of user.companyIds.slice(0, 3)) {
        const r = await this.get(this.repId(period, `co:${co}`));
        if (r?.status === 'returned') items.push({ tone: 'warn', tag: 'Laporan bulanan', title: `Laporan ${period} dikembalikan`, detail: 'Betulkan dan hantar semula.', go });
        else if (!r || r.status === 'draft') items.push({ tone: deadline && this.today() > deadline ? 'crit' : 'info', tag: 'Laporan bulanan', title: `Laporan ${period} belum dihantar`, detail: deadline ? `Tarikh akhir ${deadline}` : 'Tarikh mesyuarat belum ditetapkan', go });
        else if (r.status === 'submitted' && this.manager(user, co) && r.d.preparedById !== user.id) items.push({ tone: 'info', tag: 'Laporan bulanan', title: `Sahkan laporan ${period}`, detail: `Disediakan oleh ${r.d.preparedBy}`, go });
      }
    }
    if (this.audit(user)) {
      const grid = await this.acctGrid(this.today().slice(0, 4));
      const missing = grid.rows.filter((r) => r.cells.some((c) => c.state === 'missing'));
      if (missing.length) items.push({ tone: 'warn', tag: 'Laporan akaun', title: `${missing.length} syarikat belum hantar laporan akaun`, detail: missing.slice(0, 4).map((r) => r.name).join(', '), go });
      const week = addDays(this.today(), 1 - weekday(this.today()));
      if (weekday(this.today()) >= RULES.groupMonthly.value.rygWeekday && !(await this.get(`gm-ryg-${week}`))) items.push({ tone: 'info', tag: 'Laporan Jumaat', title: 'Hantar laporan merah/kuning/hijau minggu ini', detail: 'Dari penjejak laporan akaun dan penemuan terbuka.', go });
    }
    return items;
  }

  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user, i);
      case 'setMeeting':
        return this.setMeeting(user, i);
      case 'logistics':
        return this.logistics(user, i);
      case 'minutes':
        return this.minutes(user, i);
      case 'reportBuild':
        return this.reportBuild(user, i);
      case 'reportSave':
        return this.reportSave(user, i);
      case 'reportSubmit':
        return this.reportSubmit(user, i);
      case 'reportDecide':
        return this.reportDecide(user, i);
      case 'reportView':
        return this.reportView(user, i);
      case 'jtk':
        return this.jtk(user, i);
      case 'payMethod':
        return this.payMethod(user, i);
      case 'registers':
        return this.registers(user, i);
      case 'acctSent':
        return this.acctSent(user, i);
      case 'acctReview':
        return this.acctReview(user, i);
      case 'acctTracker':
        return this.acctTracker(user, i);
      case 'ryg':
        return this.ryg(user);
      case 'rygFreeze':
        return this.rygFreeze(user);
      case 'dutyLoad':
        return this.dutyLoad(user, i);
      case 'dutyAdd':
        return this.dutyAdd(user, i);
      case 'dutyEdit':
        return this.dutyEdit(user, i);
      case 'duties':
        return this.duties(user, i);
      case 'dutyKpi':
        return this.dutyKpi(user, i);
      case 'calendar':
        return this.calendar();
      case 'setCalendar':
        return this.setCalendar(user, i);
      default:
        throw new BadRequest('Unknown monthly meeting action.');
    }
  }
}
/** The read-only operations (no write access needed). */
export const GM_READS = ['board', 'reportView', 'registers', 'acctTracker', 'ryg', 'duties', 'dutyKpi', 'calendar'];

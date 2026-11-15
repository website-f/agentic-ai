// Part X (Fitri package, company toolbox meeting papers, Fauzan's answers X-Q1..X-Q11, 14 Nov 2026): the company and
// central department toolbox meeting as the HQ status meeting. The standard agenda (two versions), the status pack
// Prima builds and freezes from the company's or department's own records, status lines that carry forward, no
// copy-forward minutes, prepared and verified (verifying replaces signature and stamp), meeting numbers, the registers
// the minutes need (KDN state branch offices, MOF nominees, PGM claims, client payment deductions, SULIT items), the
// central director's visit every 2 months, AI notes pasted from Loop or Notes (checked by the preparer), the group view
// and the OM's site safety and operations talk. Prima never connects to Loop or OneNote; paste or upload only.
import { AccessDenied, isGroupLeader } from './access';
import { isCorpAdminOwner } from './central-admin';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService, type ProofInput } from './service';
import { simplePdf } from './simple-pdf';
import type { Store } from './store';
import { addDays, dateOf, daysBetween } from './time';
import { lineManagerOf } from './work';
import type { Id, IsoDate, IsoDateTime, Meeting, User } from './types';

export type ToolboxKind = 'settings' | 'minutes' | 'line' | 'section' | 'branch' | 'nominee' | 'pgm' | 'receipt' | 'personal' | 'siteTalk';
export interface ToolboxRec {
  id: Id;
  kind: ToolboxKind;
  /** 'co:<companyId>' or 'dept:<department>'; 'group' for settings. */
  scope: string;
  companyId: Id | null;
  status: string;
  d: Record<string, unknown>;
  by: string;
  byId: Id;
  at: IsoDateTime;
  history: { at: IsoDateTime; by: string; note: string }[];
}
export type PackLine = { text: string; source: string; red?: boolean };
export type Section = { key: string; title: string; source: string; own?: boolean };
export type LineStatus = 'baru' | 'dalam_proses' | 'menunggu' | 'selesai' | 'tiada';
const LINE_STATUS: LineStatus[] = ['baru', 'dalam_proses', 'menunggu', 'selesai', 'tiada'];
const DEDUCTIONS = ['penalty', 'contra', 'factoring', 'handling', 'sst', 'other'] as const;

/** A row update never carries its id or company (the store refuses to change them). */
function patchOf<T extends { id: unknown; companyId: unknown }>(r: T): Omit<T, 'id' | 'companyId'> {
  const { id: _id, companyId: _co, ...rest } = r;
  void _id;
  void _co;
  return rest;
}
const s = (v: unknown, max = 300) => String(v ?? '').trim().slice(0, max);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const MONTHS_BM = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
const last4 = (v: unknown) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 4 ? `****${d.slice(-4)}` : '';
};
/** Malaysian IC numbers (YYMMDD-PB-###G) are never shown on a list, the pack or an export (XL1). */
const noIc = (v: string) => v.replace(/\b\d{6}-?\d{2}-?\d{4}\b/g, '[IC disembunyikan]');

export class ToolboxService {
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
  private async hasRecs() {
    return !this.store.hasTable || (await this.store.hasTable('toolboxRecs'));
  }
  private async need() {
    if (!(await this.hasRecs())) throw new BadRequest('Toolbox records are not installed in this database yet (module toolbox-v1, run by the CEO).');
  }
  private async recs(kind?: ToolboxKind): Promise<ToolboxRec[]> {
    if (!(await this.hasRecs())) return [];
    const all = ((await this.store.list('toolboxRecs', {}).catch(() => [])) as ToolboxRec[]) ?? [];
    return kind ? all.filter((r) => r.kind === kind) : all;
  }

  // ---------- settings ----------
  async settings() {
    const base = structuredClone(RULES.toolbox.value);
    const saved = (await this.recs('settings')).find((r) => r.id === 'tbx-settings');
    const d = (saved?.d ?? {}) as Partial<typeof base> & { rotation?: Record<string, Id> };
    return { ...base, ...d, rotation: (d.rotation ?? {}) as Record<string, Id> };
  }

  // ---------- who ----------
  private wide(u: User) {
    return !u.integration && (u.opsTier === 'ceo' || u.opsTier === 'coo' || u.leadership === 'cos' || u.leadership === 'deputy_cos' || isCorpAdminOwner(u) || this.doa(u));
  }
  /** The Director Office (a company director sign-in is not the Director Office here). */
  private doa(u: User) {
    return !u.integration && u.role === 'pwvsb_officer' && u.department === 'director_office';
  }
  private isAct(u: User) {
    return !u.integration && u.department === 'audit';
  }
  private fd(u: User) {
    return !u.integration && u.leadership === 'finance_director';
  }
  private finance(u: User) {
    return !u.integration && (u.leadership === 'finance_director' || (u.role === 'pwvsb_officer' && u.department === 'finance'));
  }
  private async centralDirector(u: User) {
    const c = (await this.settings()).centralDirectors;
    return !u.integration && (c.opsTier.includes(u.opsTier ?? '') || c.leadership.includes(u.leadership ?? ''));
  }
  private companyOffice(u: User, companyId: Id) {
    return !u.integration && ['company_manager', 'admin_exec', 'director'].includes(u.role) && u.companyIds.includes(companyId);
  }
  /** A director of this company: a director sign-in of the company, or a company sign-in named on its board register. */
  private async director(u: User, companyId: Id) {
    if (u.integration || !u.companyIds.includes(companyId)) return false;
    if (u.role === 'director') return true;
    const profile = (await this.store.list('corpProfiles', { companyId: [companyId] }).catch(() => [])).find((p) => p.companyId === companyId);
    return !!profile?.directors.some((d) => d.name.trim().toLowerCase() === u.name.trim().toLowerCase());
  }
  private deptMember(u: User, dept: string) {
    return !u.integration && u.role === 'pwvsb_officer' && u.department === dept;
  }
  /** The head of a central department: a member whose line manager is outside it (the standing plan's rule). */
  private async deptHead(u: User, dept: string) {
    if (!this.deptMember(u, dept)) return false;
    const m = lineManagerOf(u, await this.store.list('users')).manager;
    return !m || m.department !== dept;
  }
  private parse(scope: string): { co: Id | null; dept: string | null } {
    if (scope.startsWith('co:')) return { co: scope.slice(3), dept: null };
    if (scope.startsWith('dept:')) return { co: null, dept: scope.slice(5) };
    throw new BadRequest('Choose the company or department.');
  }
  private async reads(u: User, scope: string) {
    const { co, dept } = this.parse(scope);
    if (this.wide(u) || this.isAct(u)) return true;
    if (co) return this.companyOffice(u, co) || this.fd(u);
    return this.deptMember(u, dept!);
  }
  private async prepares(u: User, scope: string) {
    const { co, dept } = this.parse(scope);
    if (co) return !u.integration && (u.role === 'company_manager' || u.role === 'admin_exec') && u.companyIds.includes(co);
    return this.deptMember(u, dept!);
  }
  /** The FD sees only d), e), f) (and SULIT) of a company pack it is not otherwise allowed to read (X-Q5). */
  private sectionLimited(u: User, scope: string) {
    const { co } = this.parse(scope);
    return !!co && this.fd(u) && !this.wide(u) && !this.isAct(u) && !this.companyOffice(u, co);
  }
  private async seesSulit(u: User, companyId: Id) {
    return !u.integration && (u.opsTier === 'ceo' || this.fd(u) || this.isAct(u) || (await this.director(u, companyId)));
  }

  // ---------- meetings ----------
  private scopeOf(m: Meeting): string | null {
    if (m.seriesKey?.startsWith('co-office:')) return `co:${m.seriesKey.slice(10)}`;
    if (m.seriesKey?.startsWith('dept-toolbox:')) return `dept:${m.seriesKey.slice(13)}`;
    if (m.kind !== 'toolbox') return null;
    if (m.companyId) return `co:${m.companyId}`;
    return m.department ? `dept:${m.department}` : null;
  }
  private async meeting(id: unknown) {
    const m = await this.store.get('meetings', s(id, 120));
    if (!m) throw new NotFound('Meeting');
    const scope = this.scopeOf(m);
    if (!scope) throw new BadRequest('This is not a toolbox meeting.');
    return { m, scope };
  }
  private minId(meetingId: Id) {
    return `tbx-min-${meetingId}`;
  }
  private async minutesOf(meetingId: Id) {
    return ((await this.store.get('toolboxRecs', this.minId(meetingId)).catch(() => undefined)) as ToolboxRec | undefined) ?? null;
  }
  /** The agenda for a scope: the standard version plus the company's or department's own sections. */
  private async agendaFor(scope: string): Promise<Section[]> {
    const st = await this.settings();
    const std = (scope.startsWith('co:') ? st.agenda.company : st.agenda.department).map((x) => ({ ...x }));
    const own = (await this.recs('section')).filter((r) => r.scope === scope && r.status === 'active').map((r) => ({ key: String(r.d.key), title: String(r.d.title), source: 'manual', own: true }));
    return [...std, ...own];
  }
  private async upsert(user: User, rec: ToolboxRec, action: string, summary: string, cur?: ToolboxRec | null) {
    return this.store.transaction(async (tx) => {
      if (cur) await tx.update('toolboxRecs', rec.id, patchOf(rec) as never);
      else await tx.insert('toolboxRecs', rec as never);
      // Group-level audit row with the company or department named (central readers hold no company grant).
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: `toolbox.${action}`, entity: 'toolbox_rec', entityId: rec.id, summary: `${rec.scope}: ${summary}`.slice(0, 300) });
      return rec;
    });
  }
  private hist(cur: ToolboxRec | null | undefined, user: User, note: string) {
    return [...(cur?.history ?? []), { at: this.now(), by: user.name, note: note.slice(0, 300) }];
  }
  /** Meetings of this scope, oldest first (any status but cancelled). */
  private async scopeMeetings(scope: string) {
    return (await this.store.list('meetings'))
      .filter((m) => m.status !== 'cancelled' && this.scopeOf(m) === scope)
      .sort((a, b) => a.start.localeCompare(b.start));
  }
  /** "Bil n/yyyy": numbered per company or department per year, from 1 (X7). */
  private async bil(scope: string, m: Meeting) {
    const y = m.start.slice(0, 4);
    const same = (await this.scopeMeetings(scope)).filter((x) => x.start.slice(0, 4) === y);
    return `Bil ${same.findIndex((x) => x.id === m.id) + 1}/${y}`;
  }

  // ---------- the status pack (X3, X9, X10, X18) ----------
  private async pack(scope: string, m: Meeting): Promise<Record<string, PackLine[]>> {
    const { co, dept } = this.parse(scope);
    const asOf = this.now();
    const on = dateOf(m.start) < this.today() ? dateOf(m.start) : this.today();
    const year = on.slice(0, 4);
    const out: Record<string, PackLine[]> = {};
    const L = (key: string, text: string, source: string, red = false) => (out[key] ??= []).push({ text: noIc(text), source, ...(red ? { red } : {}) });
    const none = (key: string, source: string) => !out[key]?.length && L(key, 'tiada rekod', source, true);
    const recs = await this.recs();
    const lines = recs.filter((r) => r.kind === 'line' && r.scope === scope && r.status !== 'closed');
    for (const ln of lines) L(String(ln.d.section), `${ln.d.matter}: ${ln.d.status}${ln.d.target ? `, sasaran ${ln.d.target}` : ''}${ln.d.ownerName ? `, ${ln.d.ownerName}` : ''}`, 'Baris status');
    L(co ? 'a' : '1', `Dijemput: ${m.attendeeIds?.length ?? 0} orang${m.attendees.length ? ` + ${m.attendees.length} tetamu` : ''}`, 'Mesyuarat');
    if (co) {
      const lic = (await this.store.list('licences', { companyId: [co] })).filter((l) => l.companyId === co);
      for (const l of lic.filter((x) => ['KDN_LICENCE', 'MAJLIS_PREMISE'].includes(x.type)))
        L('b', `${l.type === 'KDN_LICENCE' ? 'Lesen KDN' : `Lesen PBT${l.title ? ` ${l.title}` : ''}`} ${l.reference}: ${l.expiresOn ? `tamat ${l.expiresOn}` : 'tiada tarikh tamat'}${l.renewal?.kdn ? ' (pembaharuan KDN dibuka)' : ''}`, 'Pentadbiran Pusat', !l.expiresOn || l.expiresOn < addDays(on, 60));
      const br = recs.filter((r) => r.kind === 'branch' && r.companyId === co && r.status !== 'closed');
      for (const b of br) L('b', `Cawangan ${b.d.state}${b.d.zone ? ` (${b.d.zone})` : ''}: KDN ${b.d.kdnStatus}, PBT ${b.d.pbtStatus ?? 'tiada rekod'}${b.d.vault ? ', bilik kebal' : ''}${b.d.chosen ? ', cawangan pilihan' : ''}`, 'Daftar cawangan', b.d.kdnStatus !== 'lulus');
      const max = (await this.settings()).maxBranches;
      if (max != null && br.length > max) L('b', `Cawangan ${br.length} melebihi had ${max}`, 'Tetapan', true);
      none('b', 'Pentadbiran Pusat');
      const contracts = (await this.store.list('contracts', { companyId: [co] })).filter((c) => c.companyId === co && ['active', 'ready', 'mobilising'].includes(c.state));
      for (const c of contracts) {
        const left = daysBetween(on, c.endOn);
        L('c', `${c.clientName} (${c.ref}): tamat ${c.endOn}, ${left} hari`, 'Kontrak', left <= 90);
      }
      const k = await this.svc.kdn.counts(co).catch(() => null);
      if (k) L('c', `Pengawal tempatan ${k.local}, Nepal ${k.nepali}; tanpa CSG ${k.csg.notTrained} (tiada rekod ${k.csg.unknown})`, 'HR / JA', k.csg.notTrained + k.csg.unknown > 0);
      none('c', 'Kontrak');
      // X9: 12 months per client account from the invoices sent and Finance's receipts with named deductions.
      const accounts = (await this.store.list('clientAccounts', { companyId: [co] })).filter((a) => a.companyId === co && a.stage !== 'ended');
      const receipts = recs.filter((r) => r.kind === 'receipt' && r.companyId === co);
      const nowMonth = Number(on.slice(5, 7));
      for (const a of accounts) {
        const cells: string[] = [];
        let red = false;
        for (let mo = 1; mo <= nowMonth; mo++) {
          const period = `${year}-${String(mo).padStart(2, '0')}`;
          const inv = (a.invoices ?? []).find((x) => x.period === period);
          if (!inv) {
            if (a.startedOn.slice(0, 7) <= period) {
              cells.push(`${MONTHS_BM[mo - 1]}: belum invois`);
              red = true;
            }
            continue;
          }
          const got = receipts.filter((r) => r.d.accountId === a.id && r.d.period === period);
          const paid = got.reduce((n, r) => n + Number(r.d.amount ?? 0), 0);
          const ded = got.reduce((n, r) => n + ((r.d.deductions as { amount: number }[]) ?? []).reduce((x, y) => x + Number(y.amount), 0), 0);
          const out$ = Math.max(0, Math.round((inv.amount - paid - ded) * 100) / 100);
          cells.push(`${MONTHS_BM[mo - 1]}: RM${inv.amount} diterima RM${paid}${ded ? ` potongan RM${ded}` : ''}${out$ ? ` baki RM${out$}` : ''}`);
        }
        L('d', `${a.name}${a.contractEndsOn ? ` (tamat ${a.contractEndsOn})` : ''}: ${cells.join('; ') || 'tiada bulan'}`, 'Kewangan', red);
      }
      for (const r of receipts.filter((x) => (x.d.deductions as unknown[])?.length && String(x.d.period).startsWith(year)))
        for (const d of r.d.deductions as { kind: string; amount: number; note?: string }[]) L('d', `Potongan ${r.d.period}: ${d.kind} RM${d.amount}${d.note ? ` (${d.note})` : ''}`, 'Kewangan');
      none('d', 'Kewangan');
      for (const p of recs.filter((r) => r.kind === 'pgm' && r.companyId === co)) {
        const arrears = Math.max(0, Number(p.d.approvedAmount ?? 0) - Number(p.d.receivedAmount ?? 0));
        L('e', `PGM ${p.d.pgmYear} ${p.d.zone ?? ''} (${p.d.contractRef ?? ''}): ${p.d.approvedOn ? `lulus ${p.d.approvedOn} RM${p.d.approvedAmount}` : 'belum lulus'}, diterima RM${p.d.receivedAmount ?? 0}${arrears ? `, tunggakan RM${arrears}` : ''}`, 'Kewangan', arrears > 0);
      }
      none('e', 'Kewangan');
      // X10: 12 months of statutory and tax payments from Finance regular payments.
      const fin = (await this.store.list('finStatus', { companyId: [co] }).catch(() => [])).find((f) => f.companyId === co);
      const STAT: [RegExp, string][] = [
        [/EPF|KWSP/i, 'KWSP'],
        [/PERKESO|SOCSO/i, 'PERKESO'],
        [/EIS|SIP/i, 'SIP/EIS'],
        [/HRD|PSMB/i, 'HRD'],
        [/CP204/i, 'CP204'],
        [/PCB|MTD/i, 'PCB'],
        [/zakat/i, 'Zakat'],
        [/SST|kastam|customs/i, 'SST'],
      ];
      for (const [re, label] of STAT) {
        const reg = (fin?.regular ?? []).find((x) => re.test(`${x.body ?? ''} ${x.name}`) && x.kind !== 'loan' && x.kind !== 'hire_purchase');
        if (!reg) {
          L('f', `${label}: tiada rekod bayaran tetap`, 'Kewangan', true);
          continue;
        }
        const step = label === 'SST' ? 2 : 1;
        const miss: string[] = [];
        for (let mo = step; mo < nowMonth; mo += step) {
          const period = `${year}-${String(mo).padStart(2, '0')}`;
          const due = reg.dues.find((d) => d.period === period);
          if (!due || !(due.paymentId || due.debited)) miss.push(MONTHS_BM[mo - 1]);
        }
        L('f', `${label}: ${miss.length ? `tiada rekod bayaran ${miss.join(', ')}` : `semua bulan hingga ${MONTHS_BM[Math.max(0, nowMonth - 2)]} direkod`}`, 'Kewangan', miss.length > 0);
      }
      if (k) L('h', `CSG: belum berlatih ${k.csg.notTrained}, tiada rekod ${k.csg.unknown}; TNG: belum berlatih ${k.tng.notTrained}, tiada rekod ${k.tng.unknown}`, 'HR / JA', k.csg.notTrained + k.tng.notTrained > 0);
      none('h', 'HR / JA');
      const month = on.slice(0, 7);
      const tenders = (await this.store.list('tenders', { companyId: [co] })).filter((t) => t.companyId === co && t.closesOn.slice(0, 7) === month);
      const byCh = new Map<string, number>();
      for (const t of tenders) byCh.set(t.channel, (byCh.get(t.channel) ?? 0) + 1);
      L('i', `Tender ditutup bulan ini: ${tenders.length}${byCh.size ? ` (${[...byCh].map(([c, n]) => `${c} ${n}`).join(', ')})` : ''}`, 'Tender');
      for (const l of lic.filter((x) => x.type === 'VENDOR_PANEL' || x.type === 'MOF_REGISTRATION'))
        L('i', `${l.type === 'MOF_REGISTRATION' ? 'MOF' : `Panel ${l.title ?? ''}`} ${l.reference}: ${l.expiresOn ? `tamat ${l.expiresOn}` : 'tiada tarikh'}`, 'Pentadbiran Pusat', !l.expiresOn || l.expiresOn < addDays(on, 60));
      for (const n of recs.filter((r) => r.kind === 'nominee' && r.companyId === co && r.status !== 'removed'))
        L('j', `${n.d.name} (${n.d.position}), ${n.d.record ?? 'MOF'}: ditambah ${n.d.addedOn}${n.d.removalRequestedOn ? `, mohon dikeluarkan ${n.d.removalRequestedOn}` : ''}`, 'Daftar penama');
      none('j', 'Daftar penama');
      const vaults = (await this.store.list('vaults', { companyId: [co] }).catch(() => [])).filter((v) => v.companyId === co);
      const creds = (await this.store.list('credentials', { companyId: [co] })).filter((c) => c.companyId === co && c.type === ('FIREARM_LICENCE' as never));
      const permits = lic.filter((x) => x.type === ('FIREARM_PERMIT' as never));
      L('k', `Bilik kebal ${vaults.length}; lesen senjata kakitangan ${creds.length}${permits.length ? `; permit ${permits.length}` : ''}`, 'Kawalan Senjata');
      for (const c of creds.filter((x) => x.expiresOn && x.expiresOn < addDays(on, 90))) L('k', `Lesen ${c.number.slice(-4)} tamat ${c.expiresOn}`, 'Kawalan Senjata', true);
      const branches = (await this.store.list('branches', { companyId: [co] })).filter((b) => b.companyId === co && b.status !== 'closed');
      for (const b of branches) L('l', `${b.name} (${b.state}), model ${b.model}`, 'Cawangan');
      none('l', 'Cawangan');
      const people = (await this.store.list('people', { companyId: [co] })).filter((p) => p.companyId === co && p.status === 'active');
      L('m', `Pekerja Nepal aktif: ${people.filter((p) => p.nationality === 'NP').length}`, 'FWM');
      for (const r of (fin?.regular ?? []).filter((x) => ['hire_purchase', 'loan', 'bill', 'rent', 'insurance'].includes(x.kind) && x.status === 'active')) {
        const paid = r.dues.filter((d) => d.paymentId || d.debited).map((d) => d.period).sort().at(-1);
        L('n', `${r.name}: bayaran terakhir ${paid ?? 'tiada rekod'}`, 'Kewangan', !paid);
      }
      for (const b of fin?.banks ?? []) L('n', `Akaun bank ${b.bank ?? ''} ${last4((b as { accountNo?: string }).accountNo ?? (b as { last4?: string }).last4)}`.trim(), 'Kewangan');
      L('n', fin?.auditedTo ? `Akaun beraudit hingga ${fin.auditedTo.date}` : 'Akaun beraudit: tiada rekod', 'Kewangan', !fin?.auditedTo);
      for (const l of lic.filter((x) => x.type === 'ISO_CERT')) L('n', `ISO ${l.reference}: ${l.expiresOn ? `tamat ${l.expiresOn}` : 'tiada tarikh'}`, 'Pentadbiran Pusat', !l.expiresOn || l.expiresOn < addDays(on, 60));
      none('n', 'Kewangan');
      // X18: SULIT, items in one person's name; the detail is cut for readers who may not see it (view()).
      for (const p of recs.filter((r) => r.kind === 'personal' && r.companyId === co && r.status === 'active'))
        L('sulit', `${p.d.what}: ${p.d.name}, RM${p.d.amount}${p.d.paidOn ? `, dibayar ${p.d.paidOn}` : ''}${p.d.assetRef ? `, aset ${p.d.assetRef}` : ''}${p.d.note ? ` (${p.d.note})` : ''}`, 'Kewangan (SULIT)');
    } else {
      const users = (await this.store.list('users')).filter((u) => u.role === 'pwvsb_officer' && u.department === dept && !u.integration);
      L('2', `Kakitangan: ${users.length}`, 'HR');
      const ids = new Set(users.map((u) => u.id));
      const leave = (await this.store.list('leaveRequests', {}).catch(() => [])).filter((l) => users.some((u) => u.personId === l.personId) && l.status !== 'rejected' && l.to >= on && l.from <= addDays(on, 14));
      L('2', `Cuti dalam 2 minggu: ${leave.length}`, 'HR');
      const tasks = (await this.store.list('workTasks', {}).catch(() => [])).filter((t) => ids.has(t.userId) && t.status === 'open');
      const late = tasks.filter((t) => dateOf(t.dueAt) < on);
      L('3', `Tugasan terbuka: ${tasks.length}, lewat: ${late.length}`, 'Kerja', late.length > 0);
      const findings = (await this.store.list('actFindings', {}).catch(() => [])).filter((f) => ids.has(f.ownerUserId) && !['closed', 'resolved'].includes(String((f as { status?: string }).status)));
      L('5', `Penemuan ACT terbuka: ${findings.length}`, 'ACT', findings.length > 0);
    }
    for (const sec of await this.agendaFor(scope)) if (!out[sec.key]?.length && sec.source === 'manual') L(sec.key, 'tiada baris', 'Baris status');
    void asOf;
    return out;
  }

  /** What one person may see of a pack: the FD only d), e), f); SULIT detail only for its readers (X18). */
  private async cut(user: User, scope: string, pack: Record<string, PackLine[]>) {
    const { co } = this.parse(scope);
    const limited = this.sectionLimited(user, scope);
    const sulit = co ? await this.seesSulit(user, co) : false;
    const out: Record<string, PackLine[]> = {};
    for (const [k, v] of Object.entries(pack)) {
      if (k === 'sulit') {
        out[k] = sulit ? v : [{ text: `Sulit: ${v.length} perkara`, source: 'Kewangan (SULIT)' }];
        continue;
      }
      if (limited && !['d', 'e', 'f'].includes(k)) {
        out[k] = [{ text: `${v.length} perkara (terhad)`, source: '-' }];
        continue;
      }
      out[k] = v;
    }
    return { pack: out, sulitShown: sulit && !!pack.sulit?.length };
  }

  // ---------- one meeting ----------
  async view(user: User, i: Record<string, unknown>) {
    const { m, scope } = await this.meeting(i.meetingId);
    if (!(await this.reads(user, scope))) throw new AccessDenied('view', '(toolbox meeting)');
    const min = await this.minutesOf(m.id);
    const agenda = (min?.d.agenda as Section[] | undefined) ?? (await this.agendaFor(scope));
    const raw = (min?.d.pack as Record<string, PackLine[]> | undefined) ?? null;
    const cut = raw ? await this.cut(user, scope, raw) : null;
    // X18: each opening of a pack with SULIT detail is logged.
    if (cut?.sulitShown)
      await this.store.transaction(async (tx) => {
        await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'toolbox.sulit_open', entity: 'meeting', entityId: m.id, summary: `${scope}: SULIT section opened.` });
      });
    const lines = (await this.recs('line')).filter((r) => r.scope === scope && r.status !== 'closed');
    const stale = await this.staleAge(scope, lines);
    return {
      meetingId: m.id,
      title: m.title,
      start: m.start,
      scope,
      bil: await this.bil(scope, m),
      agenda,
      pack: cut?.pack ?? null,
      packAt: (min?.d.packAt as string | undefined) ?? null,
      ticks: (min?.d.ticks as Record<string, string> | undefined) ?? {},
      status: min?.status ?? 'draft',
      text: this.sectionLimited(user, scope) ? null : ((min?.d.text as string | undefined) ?? ''),
      aiNotes: min?.d.aiNotes ?? null,
      preparedBy: (min?.d.preparedBy as string | undefined) ?? null,
      verifiedBy: (min?.d.verifiedBy as string | undefined) ?? null,
      versions: ((min?.d.versions as unknown[] | undefined) ?? []).length,
      remarks: (min?.d.remarks as unknown[] | undefined) ?? [],
      lines: lines.map((l) => ({ id: l.id, section: l.d.section, matter: l.d.matter, status: l.d.status, ownerName: l.d.ownerName ?? null, target: l.d.target ?? null, note: l.d.note ?? '', changedOn: dateOf(l.at), stale: stale.get(l.id) ?? 0 })),
      can: { prepare: await this.prepares(user, scope), verify: await this.canVerify(user, scope, m, min) },
    };
  }
  /** How many toolbox meetings of the scope have been held since a line last changed. */
  private async staleAge(scope: string, lines: ToolboxRec[]) {
    const held = (await this.scopeMeetings(scope)).filter((m) => m.start <= this.now());
    const out = new Map<Id, number>();
    for (const l of lines) out.set(l.id, held.filter((m) => m.start > l.at).length);
    return out;
  }

  /** X3: build (or rebuild) the status pack and freeze it on the meeting; refused after verification. */
  async build(user: User, i: Record<string, unknown>) {
    await this.need();
    const { m, scope } = await this.meeting(i.meetingId);
    if (!(await this.prepares(user, scope))) throw new AccessDenied('view', '(the company admin team or the department builds the pack)');
    const cur = await this.minutesOf(m.id);
    if (cur && ['submitted', 'verified'].includes(cur.status)) throw new BadRequest('The minutes are submitted or verified; the pack cannot change.');
    const pack = await this.pack(scope, m);
    const agenda = (cur?.d.agenda as Section[] | undefined) ?? (await this.agendaFor(scope));
    const rec: ToolboxRec = {
      id: this.minId(m.id),
      kind: 'minutes',
      scope,
      companyId: this.parse(scope).co,
      status: 'draft',
      d: { ...(cur?.d ?? {}), meetingId: m.id, agenda, pack, packAt: this.now() },
      by: cur?.by ?? user.name,
      byId: cur?.byId ?? user.id,
      at: cur?.at ?? this.now(),
      history: this.hist(cur, user, `pek status dibina (data setakat ${this.now()})`),
    };
    return this.upsert(user, rec, 'build', `status pack built for ${m.id}`, cur);
  }

  /** X4: a status line (new or changed); an owner makes it their action item. */
  async line(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    if (!(await this.prepares(user, scope))) throw new AccessDenied('view', '(the company admin team or the department keeps the lines)');
    const status = s(i.status, 20) as LineStatus;
    if (!LINE_STATUS.includes(status)) throw new BadRequest('Status: baru, dalam_proses, menunggu, selesai or tiada.');
    const id = s(i.id, 120);
    const cur = id ? ((await this.store.get('toolboxRecs', id).catch(() => undefined)) as ToolboxRec | undefined) : undefined;
    if (id && (!cur || cur.kind !== 'line' || cur.scope !== scope)) throw new NotFound('Status line');
    const section = cur ? String(cur.d.section) : s(i.section, 10);
    if (!cur && !(await this.agendaFor(scope)).some((x) => x.key === section)) throw new BadRequest('Choose the agenda section.');
    const matter = cur ? String(cur.d.matter) : s(i.matter, 200);
    if (matter.length < 3) throw new BadRequest('Say what the matter is.');
    let ownerId: Id | null = (i.ownerId === undefined ? (cur?.d.ownerId as Id | null | undefined) : s(i.ownerId, 120)) || null;
    let ownerName: string | null = (cur?.d.ownerName as string | null | undefined) ?? null;
    if (i.ownerId !== undefined) {
      const o = ownerId ? await this.store.get('users', ownerId) : null;
      if (ownerId && !o) throw new BadRequest('Choose the owner from Prima users.');
      ownerId = o?.id ?? null;
      ownerName = o?.name ?? null;
    }
    const target = isDate(i.target) ? String(i.target) : ((cur?.d.target as string | null | undefined) ?? null);
    const note = i.note === undefined ? ((cur?.d.note as string | undefined) ?? '') : s(i.note, 500);
    const shownClosed = status === 'selesai' ? ((cur?.d.closedShown as number | undefined) ?? 0) : 0;
    const rec: ToolboxRec = {
      id: cur?.id ?? `tbx-line-${scope.replace(/[^a-z0-9-]/gi, '')}-${Date.parse(this.now()).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      kind: 'line',
      scope,
      companyId: this.parse(scope).co,
      status: 'open',
      d: { section, matter, status, ownerId, ownerName, target, note, closedShown: shownClosed },
      by: cur?.by ?? user.name,
      byId: cur?.byId ?? user.id,
      at: this.now(),
      history: this.hist(cur, user, `${status}${note ? `: ${note}` : ''}`),
    };
    return this.upsert(user, rec, 'line', `${section} ${matter}: ${status}`, cur ?? null);
  }

  /** X2: a company or department adds its own section; standard sections cannot be dropped. */
  async addSection(user: User, i: Record<string, unknown>) {
    await this.need();
    const scope = s(i.scope, 80);
    const { co, dept } = this.parse(scope);
    const ok = co ? user.role === 'company_manager' && user.companyIds.includes(co) : await this.deptHead(user, dept!);
    if (!ok) throw new AccessDenied('view', '(the company manager or department head adds sections)');
    if (i.drop) throw new BadRequest('A standard section cannot be dropped; tick "tiada perubahan" when nothing is new.');
    const title = s(i.title, 120);
    if (title.length < 3) throw new BadRequest('Name the section.');
    const n = (await this.recs('section')).filter((r) => r.scope === scope).length + 1;
    const rec: ToolboxRec = { id: `tbx-sec-${scope.replace(/[^a-z0-9-]/gi, '')}-${n}`, kind: 'section', scope, companyId: co, status: 'active', d: { key: `x${n}`, title }, by: user.name, byId: user.id, at: this.now(), history: this.hist(null, user, `section added: ${title}`) };
    return this.upsert(user, rec, 'section', `section added: ${title}`);
  }

  private async minutesRec(user: User, meetingId: unknown, prepare = true) {
    await this.need();
    const { m, scope } = await this.meeting(meetingId);
    if (prepare && !(await this.prepares(user, scope))) throw new AccessDenied('view', '(the preparer)');
    const cur = await this.minutesOf(m.id);
    if (!cur) throw new BadRequest('Build the status pack first (Bina pek status).');
    return { m, scope, cur, rec: structuredClone(cur) };
  }

  /** X5 and X17: the minutes text, the per-section ticks and the pasted or uploaded AI notes. */
  async draft(user: User, i: Record<string, unknown>) {
    const { m, cur, rec } = await this.minutesRec(user, i.meetingId);
    if (['submitted', 'verified'].includes(cur.status)) throw new BadRequest('Submitted or verified minutes cannot change; a correction is a new version.');
    if (i.text !== undefined) rec.d.text = s(i.text, 20_000);
    if (i.ticks && typeof i.ticks === 'object') {
      const keys = new Set(((rec.d.agenda as Section[]) ?? []).map((x) => x.key));
      const t: Record<string, string> = { ...((rec.d.ticks as Record<string, string>) ?? {}) };
      for (const [k, v] of Object.entries(i.ticks as Record<string, unknown>)) if (keys.has(k) && (v === 'changed' || v === 'nochange')) t[k] = `${v}:${user.name}`;
      rec.d.ticks = t;
    }
    if (i.aiText !== undefined || i.aiFile !== undefined) {
      const proofs = Array.isArray(i.aiFile) ? (i.aiFile as ProofInput[]) : [];
      const docs = proofs.length ? await this.svc.kdnSaveDocs(user, m.companyId ?? 'pwvsb', proofs, true) : [];
      rec.d.aiNotes = { text: s(i.aiText, 20_000), docIds: docs.map((d) => d.id), docNames: docs.map((d) => d.name), checked: false, by: user.name, at: this.now() };
    }
    if (i.aiChecked === true) {
      if (!rec.d.aiNotes) throw new BadRequest('Paste or attach the AI notes first.');
      (rec.d.aiNotes as Record<string, unknown>).checked = true;
      (rec.d.aiNotes as Record<string, unknown>).checkedBy = user.name;
    }
    rec.history = this.hist(cur, user, 'draft saved');
    return this.upsert(user, rec, 'draft', `minutes draft for ${m.id}`, cur);
  }

  /** X5 + X6: submit for verification; each section changed or "tiada perubahan"; no copy of the last meeting. */
  async submit(user: User, i: Record<string, unknown>) {
    const { m, scope, cur, rec } = await this.minutesRec(user, i.meetingId);
    if (['submitted', 'verified'].includes(cur.status)) throw new BadRequest('Already submitted.');
    if (Date.parse(m.start) > Date.parse(this.now())) throw new BadRequest('The meeting has not started yet.');
    const agenda = (rec.d.agenda as Section[]) ?? [];
    const ticks = (rec.d.ticks as Record<string, string>) ?? {};
    const open = agenda.filter((x) => !ticks[x.key]).map((x) => x.key);
    if (open.length) throw new BadRequest(`Setiap seksyen perlu "berubah" atau "tiada perubahan": ${open.join(', ')}.`);
    const ai = rec.d.aiNotes as { checked?: boolean } | undefined;
    if (ai && !ai.checked) throw new BadRequest('Nota AI - belum disemak. Tick that you checked them against the meeting first.');
    const text = String(rec.d.text ?? '');
    if (text.length < 20 && !ai) throw new BadRequest('Type or paste the minutes.');
    // A figure dated after the meeting cannot be in its minutes.
    const after = [...text.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((x) => x[1]).filter((d) => d > dateOf(m.end));
    if (after.length && !s(i.datesReason, 300)) throw new BadRequest(`The minutes carry dates after the meeting (${after.slice(0, 3).join(', ')}). Fix them or give the reason.`);
    const prev = (await this.scopeMeetings(scope)).filter((x) => x.start < m.start).at(-1);
    const prevMin = prev ? await this.minutesOf(prev.id) : null;
    const lines = (await this.recs('line')).filter((r) => r.scope === scope && r.status !== 'closed');
    const sameLines = prevMin && lines.every((l) => l.at <= (prevMin.d.submittedAt as string));
    if (prevMin && String(prevMin.d.text ?? '').trim() === text.trim() && sameLines && s(i.sameReason, 300).length < 3)
      throw new BadRequest('Sama seperti mesyuarat lepas. Give the reason, or update the minutes.');
    rec.status = 'submitted';
    rec.d.preparedBy = user.name;
    rec.d.preparedById = user.id;
    rec.d.submittedAt = this.now();
    if (s(i.sameReason, 300)) rec.d.sameReason = s(i.sameReason, 300);
    rec.history = this.hist(cur, user, 'submitted for verification');
    return this.upsert(user, rec, 'submit', `minutes submitted for ${m.id}`, cur);
  }

  private async canVerify(user: User, scope: string, m: Meeting, min: ToolboxRec | null) {
    if (!min || min.status !== 'submitted' || min.d.preparedById === user.id) return false;
    const { co, dept } = this.parse(scope);
    const visiting = (await this.centralDirector(user)) && (m.attendance ?? []).some((a) => a.userId === user.id && a.state === 'present') || (await this.centralDirector(user)) && (m.attendeeIds ?? []).includes(user.id);
    if (visiting) return true;
    if (co) {
      if (await this.director(user, co)) return true;
      if (user.role === 'company_manager' && user.companyIds.includes(co)) {
        // The company manager verifies only when no director of the company attended.
        const users = await this.store.list('users');
        const dirs: Id[] = [];
        for (const a of m.attendeeIds ?? []) {
          const u = users.find((x) => x.id === a);
          if (u && (await this.director(u, co))) dirs.push(a);
        }
        return dirs.length === 0;
      }
      return false;
    }
    return this.deptHead(user, dept!);
  }

  /** X6: verify with a comment, or return with a reason; never the preparer. Verified = locked, the meeting is held. */
  async verify(user: User, i: Record<string, unknown>) {
    const { m, scope, cur, rec } = await this.minutesRec(user, i.meetingId, false);
    if (cur.status !== 'submitted') throw new BadRequest('Nothing to verify.');
    if (cur.d.preparedById === user.id) throw new BadRequest('You prepared these minutes, so someone else verifies them.');
    if (!(await this.canVerify(user, scope, m, cur))) throw new AccessDenied('view', '(the director who chairs, else the company manager; the department head; or the visiting central director)');
    const why = s(i.comment, 300);
    if (why.length < 3) throw new BadRequest('Give a comment (every approval has a reason).');
    if (i.return === true) {
      rec.status = 'returned';
      rec.history = this.hist(cur, user, `returned: ${why}`);
      rec.status = 'draft';
      return this.upsert(user, rec, 'return', `minutes returned: ${why}`, cur);
    }
    rec.status = 'verified';
    rec.d.verifiedBy = user.name;
    rec.d.verifiedById = user.id;
    rec.d.verifiedAt = this.now();
    rec.d.verifyComment = why;
    rec.d.bil = await this.bil(scope, m);
    rec.history = this.hist(cur, user, `verified: ${why}`);
    const lines = (await this.recs('line')).filter((r) => r.scope === scope && r.status !== 'closed');
    return this.store.transaction(async (tx) => {
      await tx.update('toolboxRecs', rec.id, patchOf(rec) as never);
      // A "selesai" line shows once more, then drops to history (X4).
      for (const l of lines.filter((x) => x.d.status === 'selesai')) {
        const shown = Number(l.d.closedShown ?? 0) + 1;
        const next: ToolboxRec = { ...structuredClone(l), d: { ...l.d, closedShown: shown }, status: shown >= 2 ? 'closed' : 'open', history: [...l.history, { at: this.now(), by: user.name, note: shown >= 2 ? 'closed after showing once as done' : 'shown as done' }] };
        await tx.update('toolboxRecs', l.id, patchOf(next) as never);
      }
      // The meeting counts as held for the standing plan once its minutes are verified (X7); owners get action items.
      const actions = lines
        .filter((l) => l.d.ownerId && l.d.status !== 'selesai' && l.d.status !== 'tiada')
        .map((l) => ({ text: `${l.d.matter}`, owner: String(l.d.ownerName ?? ''), ownerId: l.d.ownerId as Id, due: (l.d.target as IsoDate | null) ?? null, done: false }));
      await tx.update('meetings', m.id, {
        status: 'held',
        minutes: { text: String(rec.d.text || '(nota AI dilampirkan)').slice(0, 20_000), by: String(rec.d.preparedBy ?? user.name), at: this.now() },
        summary: { text: `Minit toolbox ${rec.d.bil}, disahkan oleh ${user.name}.`, actions, reader: 'toolbox status lines', at: this.now(), checkedBy: null, checkedAt: null },
      } as never);
      await tx.audit({ at: this.now(), actor: user.name, companyId: null, action: 'toolbox.verify', entity: 'meeting', entityId: m.id, summary: `${scope}: minutes ${rec.d.bil} verified: ${why}`.slice(0, 300) });
      return rec;
    });
  }

  /** X6: a correction after verification is a new version with the reason; the old version is kept. */
  async correct(user: User, i: Record<string, unknown>) {
    const { m, cur, rec } = await this.minutesRec(user, i.meetingId);
    if (cur.status !== 'verified') throw new BadRequest('Only verified minutes are corrected as a new version.');
    const why = s(i.reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason for the correction.');
    rec.d.versions = [...((cur.d.versions as unknown[]) ?? []), { text: cur.d.text, preparedBy: cur.d.preparedBy, verifiedBy: cur.d.verifiedBy, verifiedAt: cur.d.verifiedAt, reason: why, at: this.now() }];
    rec.status = 'draft';
    rec.d.verifiedBy = null;
    rec.d.verifiedById = null;
    rec.history = this.hist(cur, user, `correction opened: ${why}`);
    return this.upsert(user, rec, 'correct', `correction opened for ${m.id}: ${why}`, cur);
  }

  /** X16: the visiting central director's remarks; each becomes a status line in section o) / 8. */
  async remarks(user: User, i: Record<string, unknown>) {
    await this.need();
    const { m, scope } = await this.meeting(i.meetingId);
    if (!(await this.centralDirector(user))) throw new AccessDenied('view', '(a central management director)');
    const text = s(i.text, 500);
    if (text.length < 3) throw new BadRequest('Write the remark.');
    const cur = await this.minutesOf(m.id);
    if (!cur) throw new BadRequest('Build the status pack first (Bina pek status).');
    const rec = structuredClone(cur);
    rec.d.remarks = [...((cur.d.remarks as unknown[]) ?? []), { by: user.name, at: this.now(), text }];
    rec.history = this.hist(cur, user, `Ulasan pengarah: ${text}`);
    await this.upsert(user, rec, 'remarks', `director remark on ${m.id}`, cur);
    const id = `tbx-line-${scope.replace(/[^a-z0-9-]/gi, '')}-dr-${Date.parse(this.now()).toString(36)}`;
    const line: ToolboxRec = { id, kind: 'line', scope, companyId: this.parse(scope).co, status: 'open', d: { section: scope.startsWith('co:') ? 'o' : '8', matter: `Ulasan pengarah: ${text}`, status: 'baru', ownerId: null, ownerName: null, target: null, note: '', closedShown: 0 }, by: user.name, byId: user.id, at: this.now(), history: this.hist(null, user, 'from the director remarks') };
    return this.upsert(user, line, 'line', `director remark line`, null);
  }

  /** X6: "Minit (PDF)" with company, Bil, prepared by and verified by. */
  async exportPdf(user: User, i: Record<string, unknown>) {
    const v = await this.view(user, i);
    if (v.status !== 'verified') throw new BadRequest('Only verified minutes are exported.');
    const name = v.scope.startsWith('co:') ? ((await this.store.get('companies', v.scope.slice(3)))?.name ?? v.scope) : v.scope.slice(5);
    const out: string[] = [`MINIT MESYUARAT TOOLBOX - ${name}`, `${v.bil} | ${v.start.slice(0, 16).replace('T', ' ')}`, ''];
    for (const sec of v.agenda) {
      out.push(`${sec.key}) ${sec.title}`);
      for (const l of v.pack?.[sec.key] ?? []) out.push(`   - ${l.text} [${l.source}]${l.red ? ' (!)' : ''}`);
    }
    out.push('', 'Minit:', ...noIc(v.text ?? '').split('\n'), '', `Disediakan oleh: ${v.preparedBy}`, `Disahkan oleh: ${v.verifiedBy} (pengesahan dalam Prima menggantikan tandatangan dan cop)`);
    const pdf = simplePdf(out);
    let bin = '';
    for (let k = 0; k < pdf.length; k += 0x8000) bin += String.fromCharCode(...pdf.subarray(k, k + 0x8000));
    return { name: `Minit_${v.bil.replace(/[^0-9a-z]+/gi, '_')}.pdf`, base64: btoa(bin) };
  }

  // ---------- registers (X8a-d, X18) ----------
  private async register(user: User, kind: 'branch' | 'nominee' | 'pgm' | 'receipt' | 'personal', i: Record<string, unknown>) {
    await this.need();
    const companyId = s(i.companyId, 60);
    if (!(await this.store.get('companies', companyId))) throw new BadRequest('Choose the company.');
    const fin = kind === 'pgm' || kind === 'receipt' || kind === 'personal';
    const ok = fin ? this.finance(user) || (kind === 'pgm' && this.companyOffice(user, companyId) && user.role !== 'director') : (this.companyOffice(user, companyId) && user.role !== 'director') || isCorpAdminOwner(user);
    if (!ok) throw new AccessDenied('view', fin ? '(Finance)' : "(the company's office or Central Admin)");
    const id = s(i.id, 120);
    const cur = id ? ((await this.store.get('toolboxRecs', id).catch(() => undefined)) as ToolboxRec | undefined) : undefined;
    if (id && (!cur || cur.kind !== kind || cur.companyId !== companyId)) throw new NotFound('Record');
    const d: Record<string, unknown> = { ...(cur?.d ?? {}) };
    const take = (k: string, max = 200) => i[k] !== undefined && (d[k] = s(i[k], max));
    let status = cur?.status ?? 'active';
    if (kind === 'branch') {
      for (const k of ['state', 'zone', 'address', 'pbtStatus', 'pbtLicenceId', 'tenure', 'note', 'chosenReason']) take(k, 300);
      if (i.kdnStatus !== undefined) {
        if (!['lulus', 'dalam_proses', 'batal'].includes(String(i.kdnStatus))) throw new BadRequest('KDN status: lulus, dalam_proses or batal.');
        d.kdnStatus = i.kdnStatus;
      }
      if (i.vault !== undefined) d.vault = i.vault === true;
      if (i.chosen !== undefined) {
        d.chosen = i.chosen === true;
        if (d.chosen && (!isDate(i.chosenOn) || s(i.chosenReason).length < 3)) throw new BadRequest('A chosen branch needs the decision date and reason.');
        d.chosenOn = i.chosenOn;
      }
      if (!s(d.state) || !d.kdnStatus) throw new BadRequest('Give the state and the KDN status.');
      if (d.kdnStatus === 'batal') status = 'closed';
    } else if (kind === 'nominee') {
      for (const k of ['name', 'position', 'record', 'reason']) take(k);
      if (isDate(i.addedOn)) d.addedOn = i.addedOn;
      if (isDate(i.removalRequestedOn)) d.removalRequestedOn = i.removalRequestedOn;
      if (isDate(i.removedOn)) {
        d.removedOn = i.removedOn;
        status = 'removed';
      }
      if (/\d{6}-?\d{2}-?\d{4}/.test(`${d.name} ${d.position} ${d.reason ?? ''}`)) throw new BadRequest('Keep the IC number on the attached MOF document only, never in the list.');
      if (!s(d.name) || !s(d.position) || !d.addedOn) throw new BadRequest('Give the name, position and date added.');
      if (Array.isArray(i.docs) && (i.docs as unknown[]).length) {
        const docs = await this.svc.kdnSaveDocs(user, companyId, i.docs as ProofInput[], true);
        d.docIds = [...((d.docIds as Id[]) ?? []), ...docs.map((x) => x.id)];
      }
    } else if (kind === 'pgm') {
      for (const k of ['contractRef', 'zone', 'note']) take(k);
      for (const k of ['pgmYear', 'appliedAmount', 'approvedAmount', 'receivedAmount']) if (i[k] !== undefined) d[k] = Number(i[k]);
      for (const k of ['appliedOn', 'approvedOn', 'receivedOn']) if (isDate(i[k])) d[k] = i[k];
      if (!Number.isInteger(d.pgmYear) || !s(d.contractRef)) throw new BadRequest('Give the contract and the PGM year.');
    } else if (kind === 'receipt') {
      const acc = await this.store.get('clientAccounts', s(i.accountId, 120));
      if (!acc || acc.companyId !== companyId) throw new BadRequest('Choose the client account of this company.');
      if (!/^\d{4}-\d{2}$/.test(s(i.period, 7))) throw new BadRequest('Give the invoice month (YYYY-MM).');
      const amount = Number(i.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new BadRequest('Give the amount received.');
      const ded = (Array.isArray(i.deductions) ? (i.deductions as Record<string, unknown>[]) : []).map((x) => ({ kind: s(x.kind, 20), amount: Number(x.amount), note: s(x.note, 120) }));
      if (ded.some((x) => !(DEDUCTIONS as readonly string[]).includes(x.kind) || !Number.isFinite(x.amount) || x.amount <= 0)) throw new BadRequest('Name each deduction: penalty, contra, factoring, handling, sst or other, with the amount.');
      if (ded.some((x) => x.kind === 'other' && x.note.length < 3)) throw new BadRequest('Say what the "other" deduction is.');
      Object.assign(d, { accountId: acc.id, period: s(i.period, 7), amount, receivedOn: isDate(i.receivedOn) ? i.receivedOn : this.today(), deductions: ded, ref: s(i.ref, 80) });
    } else {
      for (const k of ['what', 'name', 'assetRef', 'note']) take(k);
      if (i.amount !== undefined) d.amount = Number(i.amount);
      if (isDate(i.paidOn)) d.paidOn = i.paidOn;
      if (i.ended === true) status = 'ended';
      if (!s(d.what) || !s(d.name) || !Number.isFinite(Number(d.amount))) throw new BadRequest('Give what it is, whose name and the amount.');
    }
    if (kind === 'branch' && d.chosen) {
      const other = (await this.recs('branch')).find((r) => r.companyId === companyId && r.id !== cur?.id && r.d.chosen && r.d.zone && r.d.zone === d.zone);
      if (other) throw new BadRequest(`Zone ${d.zone} already has a chosen branch (${other.d.state}); untick it first.`);
    }
    const note = s(i.reason ?? i.note, 200) || (cur ? 'updated' : 'added');
    const rec: ToolboxRec = {
      id: cur?.id ?? `tbx-${kind}-${companyId}-${Date.parse(this.now()).toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      kind,
      scope: `co:${companyId}`,
      companyId,
      status,
      d,
      by: cur?.by ?? user.name,
      byId: cur?.byId ?? user.id,
      at: this.now(),
      history: this.hist(cur, user, note),
    };
    return this.upsert(user, rec, kind, `${kind} ${cur ? 'updated' : 'added'}`, cur ?? null);
  }
  async registers(user: User, i: Record<string, unknown>) {
    const companyId = s(i.companyId, 60);
    const scope = `co:${companyId}`;
    if (!(await this.reads(user, scope)) && !this.finance(user)) throw new AccessDenied('view', '(company registers)');
    const sulit = await this.seesSulit(user, companyId);
    const all = (await this.recs()).filter((r) => r.companyId === companyId && ['branch', 'nominee', 'pgm', 'receipt', 'personal'].includes(r.kind));
    return all
      .filter((r) => r.kind !== 'personal' || sulit)
      .map((r) => ({ id: r.id, kind: r.kind, status: r.status, d: Object.fromEntries(Object.entries(r.d).map(([k, v]) => [k, typeof v === 'string' ? noIc(v) : v])), at: r.at, by: r.by }));
  }

  // ---------- X16 rotation ----------
  async setRotation(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!this.doa(user) && !isCorpAdminOwner(user)) throw new AccessDenied('view', '(the Director Office keeps the rotation)');
    const why = s(i.reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason for the change.');
    const scope = s(i.scope, 80);
    this.parse(scope);
    const dir = await this.store.get('users', s(i.directorId, 120));
    if (!dir || !(await this.centralDirector(dir))) throw new BadRequest('Choose a central management director (CEO, COO, CoS, DCoS, FD, Ops Director or OGM).');
    return this.saveSetting(user, { rotation: { ...(await this.settings()).rotation, [scope]: dir.id } }, `rotation ${scope} -> ${dir.name}: ${why}`);
  }
  /** Central Admin changes the agenda versions or numbers with a reason; a held meeting keeps its own copy (X2). */
  async setSetting(user: User, i: Record<string, unknown>) {
    await this.need();
    if (!isCorpAdminOwner(user)) throw new AccessDenied('view', '(Central Admin)');
    const why = s(i.reason, 300);
    if (why.length < 3) throw new BadRequest('Give the reason (who asked and why).');
    const patch: Record<string, unknown> = {};
    if (i.agenda && typeof i.agenda === 'object') {
      const a = i.agenda as Record<string, Section[]>;
      const cur = (await this.settings()).agenda;
      for (const v of ['company', 'department'] as const) {
        if (!a[v]) continue;
        const keys = new Set(a[v].map((x) => x.key));
        const dropped = cur[v].filter((x) => !keys.has(x.key));
        if (dropped.length) throw new BadRequest(`A standard section cannot be dropped: ${dropped.map((x) => x.key).join(', ')}.`);
      }
      patch.agenda = { ...cur, ...a };
    }
    if (i.maxBranches !== undefined) patch.maxBranches = i.maxBranches === null ? null : Number(i.maxBranches);
    if (i.siteTalkDays !== undefined) patch.siteTalkDays = Number(i.siteTalkDays);
    return this.saveSetting(user, patch, why);
  }
  private async saveSetting(user: User, patch: Record<string, unknown>, note: string) {
    const cur = ((await this.store.get('toolboxRecs', 'tbx-settings').catch(() => undefined)) as ToolboxRec | undefined) ?? null;
    const rec: ToolboxRec = { id: 'tbx-settings', kind: 'settings', scope: 'group', companyId: null, status: 'active', d: { ...(cur?.d ?? {}), ...patch }, by: cur?.by ?? user.name, byId: cur?.byId ?? user.id, at: this.now(), history: this.hist(cur, user, note) };
    return this.upsert(user, rec, 'settings', note, cur);
  }

  // ---------- X19 OM site talks ----------
  private async omStates(u: User): Promise<string[] | 'all' | null> {
    if (u.integration) return null;
    if (u.opsTier === 'om') return u.areaStates ?? [];
    if (u.opsTier === 'regional') {
      const { REGIONS } = await import('./regions');
      return REGIONS.filter((r) => (u.regionIds ?? []).includes(r.id)).flatMap((r) => r.states);
    }
    if (['ogm', 'ops_director', 'coo', 'ceo'].includes(u.opsTier ?? '')) return 'all';
    return null;
  }
  private async siteState(siteId: Id) {
    const site = await this.store.get('sites', siteId);
    if (!site) return null;
    const br = site.branchId ? await this.store.get('branches', site.branchId) : null;
    return { site, state: site.state ?? br?.state ?? null };
  }
  async siteTalk(user: User, i: Record<string, unknown>) {
    await this.need();
    if (user.opsTier !== 'om') throw new AccessDenied('view', '(the OM holds the site toolbox talk)');
    const st = await this.siteState(s(i.siteId, 120));
    if (!st) throw new BadRequest('Choose the site.');
    if (!(user.areaStates ?? []).includes(st.state ?? '')) throw new AccessDenied('view', '(a site in your area)');
    const on = isDate(i.on) ? String(i.on) : this.today();
    if (on > this.today()) throw new BadRequest('The date cannot be in the future.');
    const topics = s(i.safety, 300);
    if (topics.length < 3) throw new BadRequest('Give the safety topic.');
    const ops = (Array.isArray(i.ops) ? (i.ops as unknown[]) : []).map((x) => s(x, 200)).filter(Boolean);
    const guardIds = (Array.isArray(i.guardIds) ? (i.guardIds as unknown[]) : []).map((x) => s(x, 120)).filter(Boolean);
    const headcount = i.headcount === undefined ? null : Number(i.headcount);
    if (!guardIds.length && !(Number.isInteger(headcount) && headcount! > 0)) throw new BadRequest('Pick the guards present, or give the head count (guards in the JA app).');
    const proof = Array.isArray(i.photos) ? (i.photos as ProofInput[]) : [];
    const photoIds = await this.svc.toolboxSavePhotos(user, st.site.companyId, st.site.id, proof);
    if (!photoIds.length) throw new BadRequest('Take the photo at the site (time and GPS stamped).');
    const issues = (Array.isArray(i.issues) ? (i.issues as unknown[]) : []).map((x) => s(x, 300)).filter(Boolean);
    const rec: ToolboxRec = {
      id: `tbx-talk-${st.site.id}-${on}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      kind: 'siteTalk',
      scope: `co:${st.site.companyId}`,
      companyId: st.site.companyId,
      status: 'held',
      d: { siteId: st.site.id, siteName: st.site.name, state: st.state, on, time: s(i.time, 5) || null, safety: topics, ops, guardIds, headcount, photoIds, issues },
      by: user.name,
      byId: user.id,
      at: this.now(),
      history: this.hist(null, user, `site talk at ${st.site.name}`),
    };
    return this.upsert(user, rec, 'site_talk', `site talk ${st.site.name} on ${on}`);
  }
  /** Sites in the person's area with their last talk; a site with none in the period is due (X19). */
  async siteTalks(user: User) {
    const states = await this.omStates(user);
    const cm = user.role === 'company_manager';
    if (!states && !cm) throw new AccessDenied('view', '(site toolbox talks)');
    const days = (await this.settings()).siteTalkDays;
    const since = addDays(this.today(), -days);
    const [sites, branches, talks] = await Promise.all([this.store.list('sites', {}), this.store.list('branches', {}), this.recs('siteTalk')]);
    const rows = [];
    for (const site of sites) {
      const state = site.state ?? branches.find((b) => b.id === site.branchId)?.state ?? null;
      if (cm ? !user.companyIds.includes(site.companyId) : states !== 'all' && !(states as string[]).includes(state ?? '')) continue;
      const last = talks.filter((t) => t.d.siteId === site.id).map((t) => String(t.d.on)).sort().at(-1) ?? null;
      rows.push({ siteId: site.id, siteName: site.name, companyId: site.companyId, state, last, due: !last || last < since });
    }
    return { days, rows: rows.sort((a, b) => Number(b.due) - Number(a.due) || a.siteName.localeCompare(b.siteName)) };
  }

  // ---------- X11, X15, X16 group view ----------
  async board(user: User) {
    if (user.integration) throw new AccessDenied('view', '(toolbox)');
    const st = await this.settings();
    const meetings = await this.store.list('meetings');
    const companies = await this.store.list('companies', {});
    const users = await this.store.list('users');
    const recs = await this.recs();
    const scopes: { scope: string; name: string }[] = [];
    for (const c of companies) if (users.some((u) => u.role === 'company_manager' && u.companyIds.includes(c.id))) scopes.push({ scope: `co:${c.id}`, name: c.name });
    const depts = [...new Set(users.filter((u) => u.role === 'pwvsb_officer' && u.department && !u.integration).map((u) => u.department!))].sort();
    for (const d of depts) if (users.filter((u) => u.role === 'pwvsb_officer' && u.department === d).length >= 2) scopes.push({ scope: `dept:${d}`, name: d });
    const mine: typeof scopes = [];
    for (const x of scopes) if (await this.reads(user, x.scope)) mine.push(x);
    if (!mine.length) throw new AccessDenied('view', '(toolbox)');
    const today = this.today();
    const twoWeeks = addDays(today, -14);
    const months = st.directorEveryMonths;
    const periodStart = (() => {
      const y = Number(today.slice(0, 4));
      const mo = Number(today.slice(5, 7)) - 1;
      const b = Math.floor(mo / months) * months;
      return `${y}-${String(b + 1).padStart(2, '0')}-01`;
    })();
    const prevStart = (() => {
      const d = new Date(`${periodStart}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - months);
      return d.toISOString().slice(0, 10);
    })();
    const centralIds = new Set<Id>();
    for (const u of users) if (await this.centralDirector(u)) centralIds.add(u.id);
    const rows = [];
    for (const x of mine) {
      const ms = meetings.filter((m) => m.status !== 'cancelled' && this.scopeOf(m) === x.scope);
      const mins = recs.filter((r) => r.kind === 'minutes' && r.scope === x.scope);
      const verified = mins.filter((r) => r.status === 'verified').map((r) => ({ r, m: ms.find((m) => m.id === r.d.meetingId) })).filter((v) => v.m).sort((a, b) => a.m!.start.localeCompare(b.m!.start));
      const last = verified.at(-1)?.m ?? null;
      const lines = recs.filter((r) => r.kind === 'line' && r.scope === x.scope && r.status !== 'closed');
      const stale = await this.staleAge(x.scope, lines);
      const oldest = lines.map((l) => l.at).sort()[0] ?? null;
      const present = (from: string, to: string) => ms.some((m) => dateOf(m.start) >= from && dateOf(m.start) < to && (m.attendance ?? []).some((a) => a.userId && centralIds.has(a.userId) && a.state === 'present'));
      const lastPack = mins.map((r) => r.d.pack as Record<string, PackLine[]> | undefined).filter(Boolean).at(-1) ?? {};
      const red = Object.entries(lastPack).filter(([k]) => k !== 'sulit').reduce((n, [, v]) => n + v.filter((l) => l.red).length, 0);
      const maxStale = Math.max(0, ...[...stale.values()]);
      rows.push({
        scope: x.scope,
        name: x.name,
        lastMeeting: last ? dateOf(last.start) : null,
        late: !last || dateOf(last.start) < twoWeeks,
        openLines: lines.length,
        oldestLineOn: oldest ? dateOf(oldest) : null,
        staleMax: maxStale,
        tell: maxStale >= st.staleTell[1] ? 'Director Office' : maxStale >= st.staleTell[0] ? (x.scope.startsWith('co:') ? 'company manager' : 'department head') : null,
        red,
        director: st.rotation[x.scope] ? (users.find((u) => u.id === st.rotation[x.scope])?.name ?? null) : null,
        directorVisit: present(periodStart, addDays(today, 1)) ? 'ada' : 'belum',
        // A missed earlier period shows "Lawatan pengarah pusat: tiada" (X16).
        directorMissed: !present(prevStart, periodStart),
      });
    }
    return { rows, staleTell: st.staleTell, directorEveryMonths: months, can: { rotation: this.doa(user) || isCorpAdminOwner(user), central: isCorpAdminOwner(user) } };
  }

  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration) return [];
    const b = await this.board(user).catch(() => null);
    const items: HomeItem[] = [];
    const go = { view: 'meetings' as const };
    if (b) {
      const late = b.rows.filter((r) => r.late);
      if (late.length && (this.wide(user) || b.rows.length === 1)) items.push({ tone: 'warn', tag: 'Toolbox', title: `${late.length} mesyuarat toolbox belum disahkan dalam 2 minggu`, detail: late.slice(0, 4).map((r) => r.name).join(', '), go });
      const dir = b.rows.filter((r) => r.directorMissed);
      if (dir.length && (this.doa(user) || user.opsTier === 'ceo')) items.push({ tone: 'warn', tag: 'Toolbox', title: `Lawatan pengarah pusat: tiada (${dir.length})`, detail: dir.slice(0, 4).map((r) => r.name).join(', '), go });
    }
    if (user.opsTier === 'om') {
      const t = await this.siteTalks(user).catch(() => null);
      const due = t?.rows.filter((r) => r.due) ?? [];
      if (due.length) items.push({ tone: 'info', tag: 'Toolbox', title: `${due.length} tapak belum ada taklimat toolbox`, detail: due.slice(0, 4).map((r) => r.siteName).join(', '), go: { view: 'meetings' as const } });
    }
    return items;
  }

  async act(user: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'board':
        return this.board(user);
      case 'view':
        return this.view(user, i);
      case 'build':
        return this.build(user, i);
      case 'line':
        return this.line(user, i);
      case 'addSection':
        return this.addSection(user, i);
      case 'draft':
        return this.draft(user, i);
      case 'submit':
        return this.submit(user, i);
      case 'verify':
        return this.verify(user, i);
      case 'correct':
        return this.correct(user, i);
      case 'remarks':
        return this.remarks(user, i);
      case 'pdf':
        return this.exportPdf(user, i);
      case 'branch':
      case 'nominee':
      case 'pgm':
      case 'receipt':
      case 'personal':
        return this.register(user, op, i);
      case 'registers':
        return this.registers(user, i);
      case 'rotation':
        return this.setRotation(user, i);
      case 'setSetting':
        return this.setSetting(user, i);
      case 'siteTalk':
        return this.siteTalk(user, i);
      case 'siteTalks':
        return this.siteTalks(user);
      default:
        throw new BadRequest('Unknown toolbox step.');
    }
  }
}

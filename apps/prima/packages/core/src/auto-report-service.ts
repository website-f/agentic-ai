// Monthly reports Prima makes by itself (Fauzan, 23 Nov 2026: "Let system automaticly create every month report
// needed"; decision card the same day: the owner checks, Prima sends on the due day if the owner has not, client
// reports always wait for a person). See auto-reports.ts for the figures and docs/AUTO_MONTHLY_REPORTS.md.
//
// Who owns what:
//  - a company's monthly reports to the Director Office: the company manager and admin executives of that company;
//  - a central department's monthly report: that department's staff;
//  - a client's service report: Operations staff who act on that client (as for recording a client report by hand);
//  - the group report for the CEO: the Director Office.
// Everything is made under the wall of whoever makes it (the person opening Reports, the Director Office or CEO
// pressing Make now, or the system sign-in u-report-maker on the daily run), so a report holds only what that sign-in
// may read.
import { AccessDenied, accessClosed, isGroupLeader } from './access';
import { unitHeadsOf } from './unit-heads';
import { sha256Hex } from './audit';
import {
  CLIENT_REPORT_ID,
  GROUP_REPORT_ID,
  applyLayout,
  autoReportCsv,
  autoReportPdf,
  missingMust,
  prefsOf,
  buildClientReport,
  buildCompanyReport,
  buildDepartmentReport,
  buildGroupReport,
  reportMonthBefore,
  monthName,
  type AutoReport,
  type AutoReportLayout,
  type AutoReportPrefs,
  type AutoReportSection,
  type ReadRows,
} from './auto-reports';
import { reportPeriods } from './reports';
import { RULES } from './rules';
import { BadRequest, NotFound, type HomeItem, type PrimaService } from './service';
import type { Store } from './store';
import { dateOf } from './time';
import type { ClientAccount, Company, EvidenceDoc, Id, IsoDate, IsoDateTime, ReportDef, ReportSubmission, User } from './types';

const PRIMA = 'Prima (automatic)';
const DEPT_LABEL: Record<string, string> = {
  operations: 'Operations',
  hr: 'Human Resources',
  arms_control: 'Arms Control',
  chief_of_staff: 'Chief of Staff (insurance)',
  cms: 'CMS command centre',
  director_office: 'Director Office',
  fwm: 'Foreign Worker Management',
  pdpa: 'PDPA',
  transport: 'Transport',
  asset: 'Asset Management',
  finance: 'Finance',
  it: 'IT',
  legal: 'Legal',
  audit: 'ACT',
  procurement: 'Procurement and Inventory',
  marketing: 'Marketing',
};
const dayOf = (ym: string, day: number): IsoDate => {
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  return `${ym}-${String(Math.min(Math.max(day, 1), last)).padStart(2, '0')}`;
};
const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

interface Target {
  defId: string;
  name: string;
  kind: AutoReport['kind'];
  companyId: Id | null;
  department: string | null;
  client: ClientAccount | null;
  scopeName: string;
  due: IsoDate;
  def: ReportDef | null;
}

export class AutoReportService {
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
  async installed() {
    return !this.store.hasTable || (await this.store.hasTable('autoReports'));
  }
  private async need() {
    if (!(await this.installed())) throw new BadRequest('Monthly reports made by Prima are not installed in this database yet (module auto-reports-v1).');
  }
  /** The month the reports are for: the month just ended, once the make day has come. */
  month(): string | null {
    const today = this.today();
    if (Number(today.slice(8, 10)) < RULES.autoReports.value.makeDay) return null;
    return reportMonthBefore(today.slice(0, 7));
  }
  private reader(): ReadRows {
    return async (t, f, r) => {
      try {
        if (this.store.hasTable && !(await this.store.hasTable(t))) return null;
        return await this.store.list(t, f, r);
      } catch {
        return null;
      }
    };
  }
  private async all(): Promise<AutoReport[]> {
    if (!(await this.installed())) return [];
    return (await this.store.list('autoReports', {}).catch(() => [])) as AutoReport[];
  }

  // ---------- who ----------
  private staff(u: User) {
    return !u.integration && u.role === 'pwvsb_officer';
  }
  private doa(u: User) {
    return this.staff(u) && u.department === 'director_office';
  }
  /** May press Make now: the Director Office, the CEO and the COO, and the system sign-in. */
  private maker(u: User) {
    return u.integration === 'report_maker' || this.doa(u) || (!u.integration && (u.opsTier === 'ceo' || u.opsTier === 'coo'));
  }
  private office(u: User, co: Id | null) {
    return !u.integration && !!co && (u.role === 'company_manager' || u.role === 'admin_exec') && u.companyIds.includes(co);
  }
  private async clientIds(u: User): Promise<Set<Id>> {
    return new Set((await this.svc.autoReportClientsFor(u)).map((a) => a.id));
  }
  /** The person who checks, keys in and sends it. */
  private async owns(u: User, r: AutoReport, clients?: Set<Id>): Promise<boolean> {
    if (u.integration) return false;
    switch (r.kind) {
      case 'company':
        return this.office(u, r.companyId);
      case 'department':
        return this.staff(u) && u.department === r.department;
      case 'client':
        return (clients ?? (await this.clientIds(u))).has(r.clientId!);
      case 'group':
        return this.doa(u);
    }
  }
  /** Who reads it: the owner, the Director Office, group leadership, ACT for department reports, the company office for its clients. */
  private async reads(u: User, r: AutoReport, clients?: Set<Id>): Promise<boolean> {
    if (await this.owns(u, r, clients)) return true;
    if (u.integration) return u.integration === 'report_maker';
    if (isGroupLeader(u)) return true;
    if (r.kind === 'group') return false;
    if (this.doa(u)) return r.kind !== 'client';
    if (r.kind === 'department' && this.staff(u) && u.department === 'audit') return true;
    if (r.kind === 'client') return this.office(u, r.companyId);
    return false;
  }

  // ---------- what is due ----------
  private async defs(): Promise<ReportDef[]> {
    return (await this.store.list('reportDefs')).filter((d) => d.active && d.frequency === 'monthly');
  }
  private dueOf(def: ReportDef, month: string): IsoDate {
    const p = reportPeriods(def, `${nextMonth(month)}-${String(Math.min(def.dueDay, 28)).padStart(2, '0')}`, 3).find((x) => x.period === month);
    return p?.due ?? dayOf(nextMonth(month), def.dueDay);
  }
  /** The reports this sign-in makes: its own, or for a maker every one it can see. */
  private async targets(u: User, month: string): Promise<Target[]> {
    const out: Target[] = [];
    const defs = await this.defs();
    const isMaker = this.maker(u) || isGroupLeader(u);
    const visible = new Set(await this.svc.visibleCompanyIdsOf(u));
    const companies = (await this.store.list('companies', {})) as Company[];
    const onApp = companies.filter((c) => c.isPilot && visible.has(c.id));
    const mineCo = isMaker ? onApp : onApp.filter((c) => this.office(u, c.id));
    for (const def of defs.filter((d) => d.from === 'company'))
      for (const c of mineCo) out.push({ defId: def.id, name: def.name, kind: 'company', companyId: c.id, department: null, client: null, scopeName: c.name, due: this.dueOf(def, month), def });
    for (const def of defs.filter((d) => d.from === 'department' && d.department))
      if (isMaker || (this.staff(u) && u.department === def.department))
        out.push({ defId: def.id, name: def.name, kind: 'department', companyId: null, department: def.department!, client: null, scopeName: DEPT_LABEL[def.department!] ?? def.department!, due: this.dueOf(def, month), def });
    const clientDue = dayOf(nextMonth(month), RULES.autoReports.value.clientDueDay);
    const clients = isMaker
      ? ((await this.store.list('clientAccounts', {})) as ClientAccount[]).filter((a) => onApp.some((c) => c.id === a.companyId) && a.stage !== 'ended' && a.stage !== 'onboarding')
      : (await this.svc.autoReportClientsFor(u)).filter((a) => a.stage !== 'ended' && a.stage !== 'onboarding');
    for (const a of clients)
      out.push({ defId: CLIENT_REPORT_ID, name: 'Monthly service report to the client', kind: 'client', companyId: a.companyId, department: null, client: a, scopeName: a.name, due: clientDue, def: null });
    if (isMaker || this.doa(u))
      out.push({ defId: GROUP_REPORT_ID, name: 'Group monthly report for the CEO', kind: 'group', companyId: null, department: null, client: null, scopeName: 'PWVSB Group', due: dayOf(nextMonth(month), RULES.autoReports.value.groupDueDay), def: null });
    return out;
  }
  private idOf(t: Pick<Target, 'defId' | 'companyId' | 'department' | 'client'>, month: string) {
    return `ar-${t.defId}-${month}-${t.client?.id ?? t.department ?? t.companyId ?? 'group'}`;
  }
  /** Prima's parts with the Director Office's layout and the owner's own choices applied. */
  private async build(u: User, t: Target, month: string, prefs: AutoReportPrefs | null): Promise<AutoReportSection[]> {
    return applyLayout(await this.raw(u, t, month, this.reader()), await this.layoutOf(t.defId), prefs);
  }
  private async raw(u: User, t: Target, month: string, read: ReadRows): Promise<AutoReportSection[]> {
    const visible = await this.svc.visibleCompanyIdsOf(u);
    const companies = ((await this.store.list('companies', {})) as Company[]).filter((c) => visible.includes(c.id) && c.isPilot).map((c) => c.id);
    switch (t.kind) {
      case 'company':
        return buildCompanyReport(read, t.def!, { month, companyIds: [t.companyId!] });
      case 'client':
        return buildClientReport(read, t.client!, { month, companyIds: [t.client!.companyId] });
      case 'department': {
        const staff = ((await this.store.list('users')) as User[]).filter((x) => !x.integration && x.role === 'pwvsb_officer' && x.department === t.department);
        return buildDepartmentReport(read, { dept: t.department!, sections: t.def!.sections?.length ? t.def!.sections : RULES.monthlyReport.value.sections, scope: { month, companyIds: companies }, staff });
      }
      case 'group':
        return buildGroupReport(read, { month, companyIds: companies }, (await this.defs()).filter((d) => d.from === 'department').map((d) => d.department!));
    }
  }
  /** Make what is missing for the month (never a second copy; a sent report is never made again). */
  private async make(u: User, month: string): Promise<AutoReport[]> {
    const all = await this.all();
    const have = new Set(all.map((r) => r.id));
    const byId = new Map(all.map((r) => [r.id, r]));
    const made: AutoReport[] = [];
    for (const t of await this.targets(u, month)) {
      const id = this.idOf(t, month);
      if (have.has(id)) continue;
      // The owner's choices last month (parts left out, own parts) carry over.
      const last = byId.get(this.idOf(t, reportMonthBefore(month)));
      const sections = await this.build(u, t, month, last ? prefsOf(last.sections) : null);
      const at = this.now();
      const by = u.integration ? PRIMA : `${PRIMA}, opened by ${u.name}`;
      const r: AutoReport = {
        id,
        defId: t.defId,
        name: t.name,
        kind: t.kind,
        period: month,
        companyId: t.companyId,
        department: t.department,
        clientId: t.client?.id ?? null,
        scopeName: t.scopeName,
        due: t.due,
        madeAt: at,
        madeBy: by,
        version: 1,
        sections,
        extras: [],
        status: 'made',
        sent: null,
        history: [{ at, by, note: `Made from Prima records for ${monthName(month)}.` }],
      };
      try {
        await this.store.transaction(async (tx) => {
          await tx.insert('autoReports', r);
          await tx.audit({ at, actor: by, companyId: r.companyId, action: 'autoReport.make', entity: 'auto_report', entityId: id, summary: `${r.name} for ${r.scopeName}, ${monthName(month)}, made by Prima.` });
        });
        have.add(id);
        made.push(r);
      } catch (e) {
        // Two people opening Reports at the same moment: the other one made it first.
        if (!/duplicate|already|exists|unique/i.test(e instanceof Error ? e.message : '')) throw e;
      }
    }
    return made;
  }

  // ---------- sending ----------
  private evidenceDoc(r: AutoReport, f: { name: string; data: string }, by: string): EvidenceDoc {
    const sha256 = sha256Hex(f.data);
    return {
      id: `doc-${sha256.slice(0, 16)}`,
      companyId: r.companyId!,
      caseId: null,
      followUpId: null,
      reportId: `rs-${r.defId}-${r.period}-${r.companyId}`,
      name: f.name,
      mime: 'application/pdf',
      bytes: f.data.length,
      sha256,
      data: f.data,
      caption: `${r.name} ${r.period}`,
      uploadedBy: by,
      receivedAt: this.now(),
    } as EvidenceDoc;
  }
  /** Prima sends an internal report the owner did not send by its due day (decision card, 23 Nov 2026). */
  private async sendDue(u: User): Promise<AutoReport[]> {
    if (!RULES.autoReports.value.sendOnDueDay) return [];
    const today = this.today();
    const subs = (await this.store.list('reportSubmissions')) as ReportSubmission[];
    const sent: AutoReport[] = [];
    for (const r of (await this.all()).filter((x) => x.status === 'made' && x.due <= today && (x.kind === 'company' || x.kind === 'department'))) {
      const at = this.now();
      const existing = subs.find((s) => s.defId === r.defId && s.period === r.period && (r.companyId ? s.companyId === r.companyId : s.department === r.department));
      await this.store.transaction(async (tx) => {
        if (existing) {
          // The owner sent it the old way (own file): keep theirs and close this copy.
          await tx.update('autoReports', r.id, { status: 'sent', sent: { by: existing.by, byId: '', at: existing.at, checked: true, note: 'Sent by the owner with their own file.' }, history: [...r.history, { at, by: PRIMA, note: 'The owner already sent this report.' }] });
          return;
        }
        const final: AutoReport = { ...r, status: 'sent', sent: { by: PRIMA, byId: u.id, at, checked: false, note: 'Sent by Prima on the due day; the owner did not check it.' } };
        const pdf = autoReportPdf(final);
        const docs = r.companyId ? [this.evidenceDoc(final, pdf, PRIMA)] : [];
        if (docs.length) await this.svc.ssSaveProof(tx, { photos: [], docs });
        const sub: ReportSubmission = {
          id: `rs-${r.defId}-${r.period}-${r.companyId ?? r.department}`,
          defId: r.defId,
          period: r.period,
          companyId: r.companyId,
          department: r.companyId ? null : (r.department as ReportSubmission['department']),
          by: PRIMA,
          at,
          note: `Made and sent by Prima on the due day. Not checked by the owner.${missingMust(r.sections).length ? ` Must-have parts empty: ${missingMust(r.sections).join(', ')}.` : ''}`.slice(0, 600),
          docIds: docs.map((d) => d.id),
          file: r.companyId ? null : { name: pdf.name, data: pdf.data },
          ...(r.kind === 'department' ? { sectionsCovered: r.sections.filter((s) => !s.hidden && (s.lines.length || s.note)).map((s) => s.title) } : {}),
        };
        await tx.insert('reportSubmissions', sub);
        await tx.update('autoReports', r.id, { status: 'sent', sent: final.sent, history: [...r.history, { at, by: PRIMA, note: 'Sent on the due day, not checked by the owner.' }] });
        await tx.audit({ at, actor: PRIMA, companyId: r.companyId, action: 'report.submit', entity: 'report', entityId: sub.id, summary: `${r.name} for ${monthName(r.period)} sent by Prima on the due day, not checked.` });
      });
      sent.push(r);
    }
    return sent;
  }

  /** The daily run (and Make now): make the month's reports, then send what is due and unsent. */
  async run(u: User) {
    if (!this.maker(u)) throw new AccessDenied('view', '(Make now: the Director Office, the CEO and the COO)');
    await this.need();
    const month = this.month();
    const made = month ? await this.make(u, month) : [];
    const sent = await this.sendDue(u);
    return { month, made: made.length, sent: sent.length };
  }

  private row(r: AutoReport, owner: boolean) {
    const shown = r.sections.filter((s) => !s.hidden);
    const filled = shown.filter((s) => s.lines.length).length;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      period: r.period,
      monthName: monthName(r.period),
      scopeName: r.scopeName,
      due: r.due,
      madeAt: r.madeAt,
      version: r.version,
      status: r.status,
      sent: r.sent,
      owner,
      overdue: r.status === 'made' && r.due < this.today(),
      sections: shown.length,
      filled,
      notes: shown.filter((s) => s.note).length,
      missing: missingMust(r.sections),
      extras: r.extras.map((x) => x.name),
    };
  }

  /** The Reports screen: the reports Prima made that this person owns or reads. Opening it makes any that are missing. */
  async mine(u: User) {
    const installed = await this.installed();
    const month = this.month();
    if (!installed) return { installed, month, canRun: false, canSet: false, reports: [] as ReturnType<AutoReportService['row']>[] };
    if (month && !u.integration) await this.make(u, month);
    const clients = await this.clientIds(u);
    const rows: ReturnType<AutoReportService['row']>[] = [];
    for (const r of (await this.all()).sort((a, b) => b.period.localeCompare(a.period) || a.name.localeCompare(b.name) || a.scopeName.localeCompare(b.scopeName)))
      if (await this.reads(u, r, clients)) rows.push(this.row(r, await this.owns(u, r, clients)));
    return { installed, month, canRun: this.maker(u), canSet: await this.maySet(u), reports: rows.slice(0, 300) };
  }

  private async one(u: User, id: unknown, own = false): Promise<AutoReport> {
    await this.need();
    const r = (await this.store.get('autoReports', str(id, 120))) as AutoReport | undefined;
    if (!r || !(await this.reads(u, r))) throw new NotFound('Report');
    if (own && !(await this.owns(u, r))) throw new AccessDenied('view', '(only the owner of this report keys in, uploads or sends it)');
    return r;
  }
  async view(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id);
    const layout = await this.layoutOf(r.defId);
    return { ...this.row(r, await this.owns(u, r)), sectionsList: r.sections, history: r.history, noteMax: RULES.autoReports.value.noteMax, ownParts: !layout || layout.ownParts, maxOwn: RULES.autoReports.value.maxOwnParts };
  }
  private async patch(u: User, r: AutoReport, p: Partial<AutoReport>, note: string) {
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const out = await tx.update('autoReports', r.id, { ...p, history: [...r.history, { at, by: u.name, note }] });
      await tx.audit({ at, actor: u.name, companyId: r.companyId, action: 'autoReport.change', entity: 'auto_report', entityId: r.id, summary: `${r.name} ${r.scopeName} ${r.period}: ${note}`.slice(0, 300) });
      return out;
    });
  }
  /** Key in: the owner's words for one section. */
  async note(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id, true);
    if (r.status === 'sent') throw new BadRequest('This report was already sent.');
    const k = Number(i.index);
    if (!Number.isInteger(k) || k < 0 || k >= r.sections.length) throw new BadRequest('Choose a section.');
    const text = str(i.text, RULES.autoReports.value.noteMax);
    const sections = r.sections.map((s, j) => (j === k ? { ...s, note: text || undefined } : s));
    return this.patch(u, r, { sections }, `${text ? 'Note keyed in' : 'Note cleared'} for "${r.sections[k].title}".`);
  }
  /** Upload: a paper Prima does not hold (for example the profit and loss from SQL Account). */
  async upload(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id, true);
    if (r.status === 'sent') throw new BadRequest('This report was already sent.');
    if (r.extras.length >= RULES.autoReports.value.maxExtras) throw new BadRequest(`Up to ${RULES.autoReports.value.maxExtras} papers.`);
    const data = String(i.data ?? '');
    if (!/^data:application\/pdf;base64,/.test(data)) throw new BadRequest('Upload the paper as a PDF.');
    if (data.length > RULES.caseProof.value.maxDocBytes * 1.4) throw new BadRequest('The paper is too large.');
    const name = str(i.name, 120) || 'Paper.pdf';
    return this.patch(u, r, { extras: [...r.extras, { name, data, by: u.name, at: this.now() }] }, `Paper added: ${name}.`);
  }
  /** Make again with today's records (before it is sent); the owner's notes and papers stay. */
  async remake(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id, true);
    if (r.status === 'sent') throw new BadRequest('This report was already sent.');
    const defs = await this.defs();
    const client = r.clientId ? (((await this.store.list('clientAccounts', {})) as ClientAccount[]).find((a) => a.id === r.clientId) ?? null) : null;
    const t: Target = { defId: r.defId, name: r.name, kind: r.kind, companyId: r.companyId, department: r.department, client, scopeName: r.scopeName, due: r.due, def: defs.find((d) => d.id === r.defId) ?? null };
    if ((r.kind === 'company' || r.kind === 'department') && !t.def) throw new BadRequest('This report is no longer on the report list.');
    if (r.kind === 'client' && !client) throw new NotFound('Client');
    const fresh = await this.build(u, t, r.period, prefsOf(r.sections));
    const notes = new Map(r.sections.map((s) => [s.title, s.note]));
    const sections = fresh.map((s) => ({ ...s, note: notes.get(s.title) }));
    return this.patch(u, r, { sections, version: r.version + 1, madeAt: this.now() }, `Made again from today's records (version ${r.version + 1}).`);
  }
  /** The owner sends it: to the Director Office, to the client's record, or to the CEO for the group report. */
  async send(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id, true);
    if (r.status === 'sent') throw new BadRequest('This report was already sent.');
    const missing = missingMust(r.sections);
    if (missing.length) throw new BadRequest(`The Director Office wants these parts filled first: ${missing.join(', ')}. Key in a note for each.`);
    const note = str(i.note, 300);
    const pdf = autoReportPdf({ ...r, sent: { by: u.name, byId: u.id, at: this.now(), checked: true, note } });
    const docs = [{ kind: 'document' as const, name: pdf.name, data: pdf.data }];
    const extras = r.extras.map((x) => ({ kind: 'document' as const, name: x.name, data: x.data }));
    if (r.kind === 'company') {
      await this.svc.submitReport(u, { defId: r.defId, period: r.period, companyId: r.companyId, note, proof: [...docs, ...extras], sections: r.sections.filter((s) => !s.hidden).map((s) => s.title) });
    } else if (r.kind === 'department') {
      const def = (await this.defs()).find((d) => d.id === r.defId);
      await this.svc.submitReport(u, { defId: r.defId, period: r.period, companyId: null, note, proof: docs, sections: def?.sections ?? [] });
    } else if (r.kind === 'client') {
      await this.svc.clientReport(u, r.clientId!, r.period, [...docs, ...extras]);
    }
    const fresh = (await this.store.get('autoReports', r.id)) as AutoReport;
    return this.patch(u, fresh, { status: 'sent', sent: { by: u.name, byId: u.id, at: this.now(), checked: true, note } }, r.kind === 'group' ? 'Sent to the CEO.' : r.kind === 'client' ? 'Recorded as sent to the client.' : 'Checked and sent to the Director Office.');
  }
  /** Download: the PDF or the spreadsheet. */
  async download(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id);
    return i.format === 'csv' ? autoReportCsv(r) : autoReportPdf(r);
  }

  // ---------- the owner's own choices ----------
  /** Leave an optional part out of the report, or put it back. Must-have parts stay. */
  async hide(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id, true);
    if (r.status === 'sent') throw new BadRequest('This report was already sent.');
    const k = Number(i.index);
    const s = r.sections[k];
    if (!s) throw new BadRequest('Choose a part.');
    if (s.must) throw new BadRequest('The Director Office says this part must be in the report.');
    const hidden = i.hidden !== false;
    const sections = r.sections.map((x, j) => (j === k ? { ...x, hidden: hidden || undefined } : x));
    return this.patch(u, r, { sections }, `${hidden ? 'Left out' : 'Put back'}: "${s.title}" (kept for next month).`);
  }
  /** Add a part of the owner's own; it comes back next month. */
  async addPart(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id, true);
    if (r.status === 'sent') throw new BadRequest('This report was already sent.');
    const layout = await this.layoutOf(r.defId);
    if (layout && !layout.ownParts) throw new BadRequest('The Director Office has fixed the parts of this report.');
    const title = str(i.title, 80);
    if (title.length < 3) throw new BadRequest('Give the part a name.');
    if (r.sections.some((s) => s.title.toLowerCase() === title.toLowerCase())) throw new BadRequest('The report already has a part with this name.');
    const max = RULES.autoReports.value.maxOwnParts;
    if (r.sections.filter((s) => s.source === 'own').length >= max) throw new BadRequest(`Up to ${max} parts of your own.`);
    const text = str(i.text, RULES.autoReports.value.noteMax);
    return this.patch(u, r, { sections: [...r.sections, { title, lines: [], source: 'own', note: text || undefined }] }, `Own part added: "${title}" (kept for next month).`);
  }
  /** Take away a part the owner added. */
  async removePart(u: User, i: Record<string, unknown>) {
    const r = await this.one(u, i.id, true);
    if (r.status === 'sent') throw new BadRequest('This report was already sent.');
    const k = Number(i.index);
    const s = r.sections[k];
    if (!s || s.source !== 'own') throw new BadRequest('Only a part you added can be taken away.');
    return this.patch(u, r, { sections: r.sections.filter((_, j) => j !== k) }, `Own part taken away: "${s.title}".`);
  }

  // ---------- the Director Office sets each report ----------
  /**
   * Who changes what each report must have: the head of the Director Office (the Administrator) and the CEO, the same
   * people who change the report list (Fauzan, 23 Nov 2026, D2). Until a head of the Director Office is named on the
   * organisation chart, the Director Office's own staff keep it.
   */
  private async maySet(u: User): Promise<boolean> {
    if (u.integration) return false;
    if (u.opsTier === 'ceo') return true;
    if (!this.doa(u)) return false;
    if (unitHeadsOf(u).includes('d_director_office')) return true;
    const today = this.today();
    return !((await this.store.list('users', {})) as User[]).some((x) => !accessClosed(x, today) && unitHeadsOf(x).includes('d_director_office'));
  }
  private async layoutOf(id: string): Promise<AutoReportLayout | null> {
    if (this.store.hasTable && !(await this.store.hasTable('autoReportLayouts'))) return null;
    return ((await this.store.get('autoReportLayouts', id).catch(() => undefined)) as AutoReportLayout | undefined) ?? null;
  }
  /** Every monthly report Prima makes, with the parts Prima can fill and how the Director Office set it. */
  async layouts(u: User) {
    await this.need();
    if (!this.doa(u) && !(this.maker(u) && !u.integration)) throw new AccessDenied('view', '(report settings: the Director Office)');
    const month = this.month() ?? reportMonthBefore(this.today().slice(0, 7));
    const none: ReadRows = async () => null;
    const defs = await this.defs();
    const sample = (kind: AutoReport['kind'], def: ReportDef | null): Target => ({
      defId: def?.id ?? (kind === 'client' ? CLIENT_REPORT_ID : GROUP_REPORT_ID),
      name: def?.name ?? (kind === 'client' ? 'Monthly service report to the client' : 'Group monthly report for the CEO'),
      kind,
      companyId: null,
      department: def?.department ?? null,
      client: kind === 'client' ? ({ id: '-', companyId: '-', name: 'Client', siteIds: [] } as unknown as ClientAccount) : null,
      scopeName: '',
      due: this.today(),
      def,
    });
    const list = [
      ...defs.filter((d) => d.from === 'company').map((d) => sample('company', d)),
      ...defs.filter((d) => d.from === 'department' && d.department).map((d) => sample('department', d)),
      sample('client', null),
      sample('group', null),
    ];
    const out = [];
    for (const t of list) {
      const titles = (await this.raw(u, t, month, none)).map((s) => s.title);
      out.push({ id: t.defId, name: t.name, kind: t.kind, from: t.def?.department ? (DEPT_LABEL[t.def.department] ?? t.def.department) : t.kind === 'company' ? 'Each company office' : t.kind === 'client' ? 'Operations, per client' : 'Director Office', primaParts: titles, layout: await this.layoutOf(t.defId) });
    }
    return { canSet: await this.maySet(u), reports: out, limits: { maxAdded: RULES.autoReports.value.maxAddedParts, hintMax: 200 } };
  }
  /** The Director Office sets what a report must have, what is left out and what is added. */
  async setLayout(u: User, i: Record<string, unknown>) {
    if (!(await this.maySet(u))) throw new AccessDenied('view', '(report settings: the head of the Director Office and the CEO)');
    await this.need();
    const all = (await this.layouts(u)).reports;
    const rep = all.find((x) => x.id === str(i.reportId, 80));
    if (!rep) throw new BadRequest('Choose a report Prima makes.');
    const known = new Set(rep.primaParts);
    const partsIn = Array.isArray(i.parts) ? (i.parts as Record<string, unknown>[]) : [];
    const seen = new Set<string>();
    const parts: AutoReportLayout['parts'] = [];
    for (const p of partsIn) {
      const title = str(p?.title, 120);
      const use = p?.use === 'must' || p?.use === 'off' ? p.use : 'optional';
      if (!known.has(title) || seen.has(title)) continue;
      seen.add(title);
      parts.push({ title, use });
    }
    for (const t of rep.primaParts) if (!seen.has(t)) parts.push({ title: t, use: 'optional' });
    const addedIn = Array.isArray(i.added) ? (i.added as Record<string, unknown>[]) : [];
    const max = RULES.autoReports.value.maxAddedParts;
    if (addedIn.length > max) throw new BadRequest(`Up to ${max} added parts.`);
    const names = new Set(parts.map((p) => p.title.toLowerCase()));
    const added: AutoReportLayout['added'] = addedIn.map((a, k) => {
      const title = str(a?.title, 80);
      if (title.length < 3) throw new BadRequest(`Added part ${k + 1} needs a name.`);
      if (names.has(title.toLowerCase())) throw new BadRequest(`"${title}" is already a part of this report.`);
      names.add(title.toLowerCase());
      return { title, hint: str(a?.hint, 200), must: a?.must === true };
    });
    const note = str(i.note, 300);
    if (note.length < 3) throw new BadRequest('Say what changed.');
    const at = this.now();
    const prev = await this.layoutOf(rep.id);
    const row: AutoReportLayout = { id: rep.id, parts, added, ownParts: i.ownParts !== false, by: u.name, at, note, history: [...(prev?.history ?? []), { at, by: u.name, note }].slice(-50) };
    await this.store.transaction(async (tx) => {
      if (prev) await tx.update('autoReportLayouts', rep.id, row);
      else await tx.insert('autoReportLayouts', row);
      // Unsent reports of this kind follow the new settings now; Prima's figures and the owner's notes stay.
      for (const r of (await this.all()).filter((x) => x.defId === rep.id && x.status === 'made')) {
        const notes = new Map(r.sections.map((x) => [x.title, x.note]));
        const prima = r.sections.filter((x) => !x.source || x.source === 'prima').map((x) => ({ title: x.title, lines: x.lines }));
        const sections = applyLayout(prima, row, prefsOf(r.sections)).map((x) => ({ ...x, note: notes.get(x.title) }));
        await tx.update('autoReports', r.id, { sections, history: [...r.history, { at, by: u.name, note: `Director Office changed what this report must have: ${note}`.slice(0, 300) }] });
      }
      await tx.audit({ at, actor: u.name, companyId: null, action: 'autoReport.layout', entity: 'auto_report_layout', entityId: rep.id, summary: `${rep.name}: ${parts.filter((p) => p.use === 'must').length} must-have, ${parts.filter((p) => p.use === 'off').length} left out, ${added.length} added. ${note}`.slice(0, 300) });
    });
    return row;
  }

  /** Home and the bell: reports waiting for this person, red once the due day has passed. */
  async homeItems(u: User): Promise<HomeItem[]> {
    if (u.integration || !(await this.installed())) return [];
    const today = this.today();
    const warn = RULES.autoReports.value.warnDays;
    const clients = await this.clientIds(u);
    const items: HomeItem[] = [];
    for (const r of await this.all()) {
      if (r.status === 'sent') {
        if (r.kind === 'group' && isGroupLeader(u) && r.sent && dateOf(r.sent.at) >= reportMonthBefore(today.slice(0, 7)) + '-01' && today <= r.due)
          items.push({ tone: 'info', tag: 'Report', title: `Group monthly report for ${monthName(r.period)} is ready`, detail: `Sent by ${r.sent.by}. Open Reports to read or download it.`, go: { view: 'reports' } });
        continue;
      }
      if (!(await this.owns(u, r, clients))) continue;
      const late = r.due < today;
      const soon = !late && r.due <= new Date(Date.parse(`${today}T00:00:00Z`) + warn * 86_400_000).toISOString().slice(0, 10);
      const auto = (r.kind === 'company' || r.kind === 'department') && RULES.autoReports.value.sendOnDueDay;
      items.push({
        tone: late ? 'crit' : soon ? 'warn' : 'info',
        tag: 'Report',
        title: `${r.name} for ${monthName(r.period)} is ready: check and send`,
        detail: `${r.scopeName} · made by Prima · due ${r.due}${auto ? ' · Prima sends it on the due day if you have not' : ''}`,
        go: { view: 'reports' },
      });
    }
    // Not made yet (the daily run cannot see this company): opening Reports makes it.
    const month = this.month();
    if (month && (u.role === 'company_manager' || u.role === 'admin_exec') && !u.integration) {
      const have = new Set((await this.all()).map((r) => r.id));
      const defs = (await this.defs()).filter((d) => d.from === 'company');
      const missing = u.companyIds.filter((co) => defs.some((d) => !have.has(this.idOf({ defId: d.id, companyId: co, department: null, client: null }, month))));
      if (missing.length && defs.length)
        items.push({ tone: 'info', tag: 'Report', title: `Prima can make your ${monthName(month)} monthly reports now`, detail: 'Open Reports: Prima fills them from its records.', go: { view: 'reports' } });
    }
    return items;
  }

  async act(u: User, op: string, i: Record<string, unknown>): Promise<unknown> {
    switch (op) {
      case 'mine':
        return this.mine(u);
      case 'view':
        return this.view(u, i);
      case 'note':
        return this.note(u, i);
      case 'upload':
        return this.upload(u, i);
      case 'remake':
        return this.remake(u, i);
      case 'send':
        return this.send(u, i);
      case 'download':
        return this.download(u, i);
      case 'run':
        return this.run(u);
      case 'hide':
        return this.hide(u, i);
      case 'addPart':
        return this.addPart(u, i);
      case 'removePart':
        return this.removePart(u, i);
      case 'layouts':
        return this.layouts(u);
      case 'setLayout':
        return this.setLayout(u, i);
      default:
        throw new BadRequest('Unknown report action.');
    }
  }
}


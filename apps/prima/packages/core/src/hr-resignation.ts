// E10 Staff resignation (Fauzan, 11 Nov 2026: "Tell Fitri to build"; handover A6 / E10 and Part J): the resignation
// procedure in the handbook, in English and Malay, and the steps that follow it in Prima.
//   Notice (rule HR-RESIGN-NOTICE): 1 month for service under 1 year, 3 months for 1 year or more. Never shorter than
//   Employment Act 1955 s.12 (4 weeks under 2 years, 6 weeks 2 to 5 years, 8 weeks 5 years or more): Prima takes the
//   later of the two last days, so the company notice can only lengthen what the Act gives.
//   1. The staff member resigns in Prima (or HR enters the signed letter for them): the day notice is given, the last
//      day asked for and, if they wish, the reason. Prima works out the earliest last day.
//   2. HR accepts with a comment and confirms the last day; nobody accepts their own resignation. The leaving step on
//      the staff record (CP22A, closing the sign-in) then follows from that last day.
//   3. A last day earlier than the notice (shorter notice by agreement) needs the HR Director's waiver with a reason,
//      never by the staff member or the HR person who accepted it.
//   The staff member may withdraw before HR accepts; after that only by agreement with HR (outside Prima).
// Table prima.staff_resignations (db/modules/hr-resignations-v1.sql), approved to build, not yet to install.

import { AccessDenied, isHrDirector, isOwnerAdmin } from './access';
import { hrKeeps, staffClockUser } from './hr';
import { noticeWeeks, serviceYears } from './hr-joining';
import { RULES } from './rules';
import type { HomeItem, PrimaService, ProofInput } from './service';
import { BadRequest, NotFound } from './service';
import type { Store } from './store';
import { addDays, toMs } from './time';
import type { Id, IsoDate, IsoDateTime, Person, User } from './types';

export type ResignationStatus = 'submitted' | 'waiver_waiting' | 'accepted' | 'withdrawn';

export interface ResignStep {
  by: string;
  byId: Id;
  at: IsoDateTime;
  note: string;
}

export interface Resignation {
  id: Id;
  /** The staff member's company; null for PWVSB central staff (as time slips). */
  companyId: Id | null;
  personId: Id;
  userId: Id | null;
  name: string;
  staffNo: string;
  hiredOn: IsoDate;
  noticeOn: IsoDate;
  /** The last day the staff member asked for. */
  askedLastDay: IsoDate;
  /** The earliest last day under the company notice and the Act, worked out when it was given. */
  earliestLastDay: IsoDate;
  noticeLabel: string;
  reason: string;
  docIds: Id[];
  status: ResignationStatus;
  /** Given by the staff member, or entered by HR from the signed letter. */
  given: ResignStep & { byStaff: boolean };
  /** HR's acceptance and the confirmed last day. */
  accepted: (ResignStep & { lastDayOn: IsoDate }) | null;
  /** A shorter notice by agreement: why, and the HR Director's decision. */
  shortNotice: { lastDayOn: IsoDate; reason: string; asked: ResignStep; decided: (ResignStep & { approve: boolean }) | null } | null;
  withdrawn: ResignStep | null;
  history: ResignStep[];
}

export const RESIGN_ACTIONS = ['submit', 'withdraw', 'accept', 'waiver_decide'] as const;

/** A date plus whole months, held to the last day of a shorter month (31 Jan + 1 month = 28 Feb). */
export function resignAddMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}

/**
 * The notice for a resignation given on noticeOn: the company's (1 month under 1 year of service, 3 months for 1 year
 * or more) and the Act's (s.12), and the earliest last day, the later of the two. Notice runs from the day after it is
 * given; the last day is the day before the period ends.
 */
export function resignationNotice(hiredOn: IsoDate, noticeOn: IsoDate) {
  const r = RULES.resignationNotice.value;
  const years = serviceYears(hiredOn, noticeOn);
  const months = years < 1 ? r.underOneYearMonths : r.oneYearOrMoreMonths;
  const actWeeks = noticeWeeks(years);
  const byCompany = resignAddMonths(noticeOn, months);
  const byAct = addDays(noticeOn, actWeeks * 7);
  const earliestLastDay = byCompany >= byAct ? byCompany : byAct;
  return {
    years: Math.round(years * 100) / 100,
    months,
    actWeeks,
    byCompany,
    byAct,
    earliestLastDay,
    label: `${months} month${months === 1 ? '' : 's'} (${years < 1 ? 'under 1 year' : '1 year or more'} of service); the Act's minimum is ${actWeeks} weeks`,
  };
}

/** The resignation procedure for the handbook, in English and Malay, with the approved notice periods. */
export function resignationProcedure() {
  const r = RULES.resignationNotice.value;
  const en = {
    title: 'Resignation procedure',
    body: [
      '1. Give notice in writing. Resign in Prima (Clock screen, "Resign") or give HR a signed letter. The notice starts the day after you give it.',
      `2. Notice period: ${r.underOneYearMonths} month if you have worked here less than 1 year; ${r.oneYearOrMoreMonths} months if you have worked here 1 year or more. It is never shorter than the Employment Act 1955, section 12 (4 weeks under 2 years, 6 weeks from 2 to 5 years, 8 weeks from 5 years); the longer period applies, and a longer period in your contract also applies.`,
      '3. HR confirms your last working day in writing within the notice period. Your head plans the handover of your work.',
      '4. A shorter notice is only by agreement: ask HR with your reason. The HR Director decides. Otherwise either side may pay wages in place of the notice not worked (Employment Act s.13).',
      '5. Before your last day: hand over your work, files and passwords to your head; return company items (laptop, phone, access card, uniform, keys). Items are checked; nothing is deducted from your pay for them without the law allowing it.',
      '6. Annual leave not taken is settled with your final pay, or taken during the notice if your head agrees. You may withdraw your resignation before HR accepts it; after that only if HR agrees.',
      '7. Your final pay, EPF, SOCSO and tax forms (CP22A, EA form) are done by HR and Finance. Your sign-in closes the day after your last day.',
    ].join('\n'),
  };
  const ms = {
    title: 'Prosedur peletakan jawatan',
    body: [
      '1. Beri notis secara bertulis. Letak jawatan dalam Prima (skrin Clock, "Letak jawatan") atau serahkan surat bertandatangan kepada HR. Notis bermula pada hari selepas ia diberi.',
      `2. Tempoh notis: ${r.underOneYearMonths} bulan jika anda bekerja di sini kurang daripada 1 tahun; ${r.oneYearOrMoreMonths} bulan jika anda bekerja di sini 1 tahun atau lebih. Ia tidak sekali-kali lebih pendek daripada Akta Kerja 1955, seksyen 12 (4 minggu bagi kurang 2 tahun, 6 minggu bagi 2 hingga 5 tahun, 8 minggu bagi 5 tahun ke atas); tempoh yang lebih panjang terpakai, dan tempoh yang lebih panjang dalam kontrak anda juga terpakai.`,
      '3. HR mengesahkan hari terakhir bekerja anda secara bertulis dalam tempoh notis. Ketua anda merancang penyerahan tugas anda.',
      '4. Notis yang lebih pendek hanya dengan persetujuan: mohon kepada HR dengan sebabnya. Pengarah HR membuat keputusan. Jika tidak, mana-mana pihak boleh membayar gaji sebagai ganti notis yang tidak dijalani (Akta Kerja s.13).',
      '5. Sebelum hari terakhir: serahkan tugas, fail dan kata laluan kepada ketua anda; pulangkan barang syarikat (komputer riba, telefon, kad akses, pakaian seragam, kunci). Barang disemak; tiada apa dipotong daripada gaji anda untuknya tanpa dibenarkan oleh undang-undang.',
      '6. Cuti tahunan yang tidak diambil diselesaikan bersama gaji akhir, atau diambil dalam tempoh notis jika ketua anda bersetuju. Anda boleh menarik balik peletakan jawatan sebelum HR menerimanya; selepas itu hanya jika HR bersetuju.',
      '7. Gaji akhir, KWSP, PERKESO dan borang cukai (CP22A, borang EA) diuruskan oleh HR dan Kewangan. Akaun log masuk anda ditutup pada hari selepas hari terakhir anda.',
    ].join('\n'),
  };
  return { en, ms, rule: RULES.resignationNotice };
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v: unknown): IsoDate | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const step = (user: User, at: IsoDateTime, note = ''): ResignStep => ({ by: user.name, byId: user.id, at, note });

export class ResignationService {
  constructor(
    private store: Store,
    private svc: PrimaService,
  ) {}

  private now(): IsoDateTime {
    return this.svc.now();
  }
  private today(): IsoDate {
    return this.svc.now().slice(0, 10);
  }
  private async ready(): Promise<boolean> {
    return this.store.hasTable ? this.store.hasTable('staffResignations') : true;
  }
  private async mustBeReady() {
    if (!(await this.ready())) throw new BadRequest('Resigning in Prima is not switched on yet. The database part waits for the CEO to install it. Give HR a signed letter.');
  }

  async act(user: User, action: string, body: Record<string, unknown>): Promise<Resignation> {
    await this.mustBeReady();
    switch (action) {
      case 'submit':
        return this.submit(user, body);
      case 'withdraw':
        return this.withdraw(user, text(body.id, 120), text(body.note, 300));
      case 'accept':
        return this.accept(user, text(body.id, 120), body);
      case 'waiver_decide':
        return this.waiverDecide(user, text(body.id, 120), body.approve === true, text(body.note, 400));
      default:
        throw new BadRequest('Unknown resignation step.');
    }
  }

  /** The staff member resigns, or HR enters a signed letter for them (personId given). */
  private async submit(user: User, body: Record<string, unknown>) {
    const forId = text(body.personId, 80);
    const byStaff = !forId || forId === user.personId;
    let person: Person | undefined;
    let staffUser: User | null = null;
    if (byStaff) {
      if (!staffClockUser(user) || !user.personId) throw new AccessDenied('view', '(office staff resign from their own sign-in)');
      person = await this.store.get('people', user.personId);
      staffUser = user;
    } else {
      if (!hrKeeps(user) && !isOwnerAdmin(user)) throw new AccessDenied('view', '(HR enters a resignation letter for a staff member)');
      person = await this.store.get('people', forId);
      if (person) staffUser = (await this.store.list('users', {})).find((u) => u.personId === person!.id) ?? null;
    }
    if (!person) throw new NotFound('Staff member');
    if (person.role !== 'office') throw new BadRequest('This procedure is for office staff. Guards and officers resign through their Operations Manager.');
    if (person.status !== 'active') throw new BadRequest('Only active staff resign.');
    if (person.leaving) throw new BadRequest('A leaving date is already on the staff record. Ask HR.');
    const today = this.today();
    const noticeOn = byStaff ? today : (day(body.noticeOn) ?? today);
    if (noticeOn > today || noticeOn < addDays(today, -14)) throw new BadRequest('The notice date is today, or the date on the signed letter within the last 14 days.');
    const n = resignationNotice(person.hiredOn, noticeOn);
    const askedLastDay = day(body.lastDayOn) ?? n.earliestLastDay;
    if (askedLastDay <= noticeOn) throw new BadRequest('The last day comes after the notice date.');
    const reason = text(body.reason, 300);
    const proof = (Array.isArray(body.proof) ? body.proof.slice(0, 3) : []) as ProofInput[];
    const companyId = byStaff ? this.svc.staffCompanyOf(user) : person.companyId === 'pwvsb' ? null : person.companyId;
    const docs = proof.length ? this.svc.paperDocs(user, companyId ?? 'pwvsb', proof, `Resignation letter: ${person.staffNo}`) : [];
    if (!byStaff && !docs.length) throw new BadRequest('Attach the signed resignation letter.');
    const at = this.now();
    return this.store.transaction(async (tx) => {
      const open = (await tx.list('staffResignations', { personId: person!.id })).find((x) => x.status === 'submitted' || x.status === 'waiver_waiting' || x.status === 'accepted');
      if (open) throw new BadRequest('A resignation is already on record. Withdraw it first, or ask HR.');
      const ids = docs.length ? await this.svc.savePaperDocs(tx, docs) : [];
      const row: Resignation = {
        id: `rsg-${toMs(at).toString(36)}-${person!.id}`.slice(0, 120),
        companyId,
        personId: person!.id,
        userId: staffUser?.id ?? null,
        name: person!.name,
        staffNo: person!.staffNo,
        hiredOn: person!.hiredOn,
        noticeOn,
        askedLastDay,
        earliestLastDay: n.earliestLastDay,
        noticeLabel: n.label,
        reason,
        docIds: ids,
        status: 'submitted',
        given: { ...step(user, at, reason), byStaff },
        accepted: null,
        shortNotice: null,
        withdrawn: null,
        history: [step(user, at, `Resignation given on ${noticeOn}; last day asked ${askedLastDay}; earliest under the notice ${n.earliestLastDay}`)],
      };
      await tx.insert('staffResignations', row);
      await tx.audit({ at, actor: user.name, companyId, action: 'hr.resign', entity: 'staff_resignation', entityId: row.id, summary: `${person!.staffNo} resigned on ${noticeOn} (${byStaff ? 'own sign-in' : 'letter entered by HR'}); notice ${n.label}; earliest last day ${n.earliestLastDay}` });
      return row;
    });
  }

  private async load(user: User, id: Id): Promise<Resignation> {
    const r = await this.store.get('staffResignations', id);
    if (!r) throw new NotFound('Resignation');
    return r;
  }

  private async save(user: User, r: Resignation, patch: Partial<Resignation>, what: string, action: string, alsoPerson?: Partial<Person>) {
    const at = this.now();
    return this.store.transaction(async (tx) => {
      await tx.lock?.('staffResignations', r.id);
      const cur = await tx.get('staffResignations', r.id);
      if (!cur || cur.status !== r.status || cur.history.length !== r.history.length) throw new BadRequest('The resignation changed meanwhile. Open it again.');
      const out = await tx.update('staffResignations', r.id, { ...patch, history: [...cur.history, step(user, at, what)] });
      if (alsoPerson) {
        await tx.lock?.('people', r.personId);
        const p = await tx.get('people', r.personId);
        if (!p) throw new NotFound('Staff member');
        if (p.leaving) throw new BadRequest('A leaving date is already on the staff record. Check it on the staff record.');
        await tx.update('people', r.personId, alsoPerson);
      }
      await tx.audit({ at, actor: user.name, companyId: r.companyId, action, entity: 'staff_resignation', entityId: r.id, summary: `${r.staffNo}: ${what}` });
      return out;
    });
  }

  /** The staff member withdraws before HR accepts. */
  private async withdraw(user: User, id: Id, note: string) {
    const r = await this.load(user, id);
    if (r.userId !== user.id && r.personId !== user.personId) throw new AccessDenied('view', '(only the staff member withdraws their resignation)');
    if (r.status !== 'submitted' && r.status !== 'waiver_waiting') throw new BadRequest('HR has accepted it. To withdraw now, speak to HR: it needs their agreement.');
    return this.save(user, r, { status: 'withdrawn', withdrawn: step(user, this.now(), note) }, `Withdrawn by the staff member${note ? `: ${note}` : ''}`, 'hr.resign_withdraw');
  }

  /** The leaving step written to the staff record when the resignation is accepted. */
  private leaving(user: User, r: Resignation, lastDayOn: IsoDate): Partial<Person> {
    return { leaving: { kind: 'resigned', noticeOn: r.noticeOn, lastDayOn, reason: `Resigned (Prima ${r.id})${r.reason ? `: ${r.reason}` : ''}`, by: user.name, at: this.now() } };
  }

  /**
   * HR accepts with a comment and confirms the last day. A last day before the earliest under the notice is a shorter
   * notice by agreement: it waits for the HR Director's waiver.
   */
  private async accept(user: User, id: Id, body: Record<string, unknown>) {
    if (!hrKeeps(user)) throw new AccessDenied('view', '(HR accepts a resignation)');
    const r = await this.load(user, id);
    if (r.personId === user.personId || r.userId === user.id) throw new AccessDenied('view', '(another HR person accepts your own resignation)');
    if (r.status !== 'submitted') throw new BadRequest('This resignation is not waiting for HR.');
    const note = text(body.note, 400);
    if (note.length < 3) throw new BadRequest('Write a comment to accept. A short one is fine.');
    const lastDayOn = day(body.lastDayOn) ?? r.askedLastDay;
    if (lastDayOn <= r.noticeOn) throw new BadRequest('The last day comes after the notice date.');
    const at = this.now();
    if (lastDayOn < r.earliestLastDay) {
      const reason = text(body.shortReason, 400);
      if (reason.length < 5) throw new BadRequest(`The notice ends on ${r.earliestLastDay}. For an earlier last day, give the reason for the shorter notice; the HR Director decides.`);
      return this.save(
        user,
        r,
        { status: 'waiver_waiting', shortNotice: { lastDayOn, reason, asked: step(user, at, note), decided: null } },
        `Shorter notice asked: last day ${lastDayOn} instead of ${r.earliestLastDay}. ${reason}`,
        'hr.resign_short_notice',
      );
    }
    return this.save(user, r, { status: 'accepted', accepted: { ...step(user, at, note), lastDayOn } }, `Accepted by HR: last day ${lastDayOn}. ${note}`, 'hr.resign_accept', this.leaving(user, r, lastDayOn));
  }

  /** The HR Director agrees to the shorter notice or refuses it, with a reason; never the staff member or the HR person who asked. */
  private async waiverDecide(user: User, id: Id, approve: boolean, note: string) {
    if (!isHrDirector(user)) throw new AccessDenied('view', '(the HR Director decides a shorter notice)');
    const r = await this.load(user, id);
    if (r.status !== 'waiver_waiting' || !r.shortNotice) throw new BadRequest('No shorter notice is waiting.');
    if (r.personId === user.personId || r.userId === user.id) throw new AccessDenied('view', '(nobody decides on their own notice)');
    if (r.shortNotice.asked.byId === user.id) throw new AccessDenied('view', '(the person who asked for the shorter notice does not also agree it)');
    if (note.length < 3) throw new BadRequest(`Write a comment to ${approve ? 'agree' : 'refuse'}. A short one is fine.`);
    const at = this.now();
    const decided = { ...step(user, at, note), approve };
    if (!approve)
      return this.save(user, r, { status: 'submitted', shortNotice: { ...r.shortNotice, decided } }, `Shorter notice refused by the HR Director: ${note}. HR accepts with the full notice.`, 'hr.resign_short_refuse');
    const lastDayOn = r.shortNotice.lastDayOn;
    return this.save(
      user,
      r,
      { status: 'accepted', shortNotice: { ...r.shortNotice, decided }, accepted: { ...r.shortNotice.asked, lastDayOn } },
      `Shorter notice agreed by the HR Director: last day ${lastDayOn}. ${note}`,
      'hr.resign_short_agree',
      this.leaving(user, r, lastDayOn),
    );
  }

  /** The staff member's own resignation and what the notice would be today; HR's list of resignations. */
  async mine(user: User) {
    const ready = await this.ready();
    const allowed = staffClockUser(user) && !!user.personId;
    const me = allowed ? await this.store.get('people', user.personId!) : undefined;
    const office = !!me && me.role === 'office' && me.status === 'active';
    const rows = ready && allowed ? (await this.store.list('staffResignations', { personId: user.personId! })).sort((a, b) => b.given.at.localeCompare(a.given.at)) : [];
    return {
      ready,
      allowed: allowed && office,
      notice: me && office ? resignationNotice(me.hiredOn, this.today()) : null,
      rows,
      procedure: resignationProcedure(),
    };
  }

  async board(user: User) {
    const hr = hrKeeps(user) || isHrDirector(user);
    if (!hr && !isOwnerAdmin(user)) throw new AccessDenied('view', '(resignations: HR)');
    const ready = await this.ready();
    const rows = ready ? (await this.store.list('staffResignations', {})).sort((a, b) => b.given.at.localeCompare(a.given.at)).slice(0, 300) : [];
    const today = this.today();
    const staff = hrKeeps(user) ? (await this.store.list('people', { status: 'active' })).filter((p) => p.role === 'office' && !p.leaving) : [];
    return {
      ready,
      rows: rows.map((r) => ({
        r,
        canAccept: hrKeeps(user) && r.status === 'submitted' && r.personId !== user.personId && r.userId !== user.id,
        canWaive: isHrDirector(user) && r.status === 'waiver_waiting' && r.shortNotice?.asked.byId !== user.id && r.personId !== user.personId,
        daysLeft: r.accepted ? Math.max(0, Math.round((toMs(`${r.accepted.lastDayOn}T00:00:00+08:00`) - toMs(`${today}T00:00:00+08:00`)) / 86_400_000)) : null,
      })),
      canEnter: hrKeeps(user),
      staff: staff.map((p) => ({ id: p.id, name: p.name, staffNo: p.staffNo })),
      procedure: resignationProcedure(),
    };
  }

  async homeItems(user: User): Promise<HomeItem[]> {
    if (user.integration || !(hrKeeps(user) || isHrDirector(user))) return [];
    if (!(await this.ready())) return [];
    const rows = await this.store.list('staffResignations', {});
    const out: HomeItem[] = [];
    const accept = rows.filter((r) => r.status === 'submitted' && r.personId !== user.personId);
    if (hrKeeps(user) && accept.length) out.push({ tone: 'warn', tag: 'HR', title: `${accept.length} resignation(s) to accept and confirm the last day`, detail: accept.slice(0, 3).map((r) => `${r.name} (${r.noticeOn})`).join(', '), go: { view: 'hr' } });
    const waive = rows.filter((r) => r.status === 'waiver_waiting' && r.shortNotice?.asked.byId !== user.id && r.personId !== user.personId);
    if (isHrDirector(user) && waive.length) out.push({ tone: 'warn', tag: 'HR', title: `${waive.length} shorter notice(s) to decide`, detail: waive.slice(0, 3).map((r) => r.name).join(', '), go: { view: 'hr' } });
    return out;
  }
}

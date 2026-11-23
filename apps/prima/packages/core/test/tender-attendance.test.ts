// Site visit and briefing tracker (Marketing item AH13, Fauzan 23 Nov 2026). Synthetic records only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, addDays, attendanceGaps, attendanceUrgent, generateDataset, tenderAttendance, type Tender } from '../src';

const TODAY = '2026-11-23';
const NOW = '2026-11-23T03:00:00.000Z';
let n = 0;
const slip = () => ({ kind: 'document' as const, name: `Slip ${++n}.pdf`, data: 'data:application/pdf;base64,' + btoa(`%PDF-1.4 synthetic slip ${n}\n%%EOF`) });

function fresh() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  let now = NOW;
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const t = ds.tenders.find((x) => x.companyId === 'co-sasa' && (x.status === 'open' || x.status === 'preparing') && x.closesOn > addDays(TODAY, 10))!;
  return { ds, svc, t, at: (v: string) => (now = v) };
}

const base = { id: 't', companyId: 'c', status: 'open', closesOn: '2026-12-31' } as unknown as Tender;

describe('Site visit and briefing tracker (AH13)', () => {
  it('works out what each briefing or site visit still needs', () => {
    const t: Tender = { ...base, record: { siteVisit: { on: '2026-11-25', mandatory: true, place: 'Site (mock)', outcome: '', mofNamedOnly: true }, briefing: { on: '2026-11-20', mandatory: false, place: '', outcome: '' } } };
    const items = tenderAttendance(t, TODAY);
    expect(items.map((a) => [a.kind, a.state, a.days])).toEqual([
      ['BRIEFING', 'RECORD', -3],
      ['SITE_VISIT', 'NAME', 2],
    ]);
    expect(attendanceUrgent(items[1])).toBe(true);
    expect(attendanceGaps(t, TODAY)).toEqual([]); // the briefing was not mandatory; the site visit is still ahead
    expect(attendanceGaps(t, '2026-11-26')).toEqual(['record the site visit attendance slip']);
    const missed: Tender = { ...t, attendance: [{ kind: 'SITE_VISIT', attendee: 'Director (mock)', mofNamed: true, namedBy: 'x', namedById: 'x', namedAt: NOW, result: { attended: false, note: 'Car broke down', docIds: [], by: 'x', byId: 'x', at: NOW } }] };
    expect(attendanceGaps(missed, '2026-11-26')).toEqual(['Site visit on 2026-11-25 was missed']);
  });

  it('the company names its person from day 1, the MOF-named person where the tender says so', async () => {
    const { ds, svc, t } = fresh();
    const ae = await svc.user('u-ae-sasa');
    const cm = await svc.user('u-cm-sasa');
    await expect(svc.nameTenderAttendee(ae, t.id, 'SITE_VISIT', 'Director (mock)', true)).rejects.toThrow(/date of the briefing or site visit/);
    await svc.setTenderRecord(ae, t.id, { siteVisit: { on: addDays(TODAY, 2), mandatory: true, place: 'Buyer office (mock)', outcome: '', mofNamedOnly: true } });
    const home = await svc.home(cm, 'co-sasa');
    const item = home.todo.find((i) => i.tag === 'Site visit');
    expect(item?.tone).toBe('crit');
    await expect(svc.nameTenderAttendee(ae, t.id, 'SITE_VISIT', 'Admin Executive (mock)', false)).rejects.toThrow(/MOF certificate/);
    const other = ds.users.find((u) => u.role === 'admin_exec' && u.companyIds.includes('co-arsh') && !u.companyIds.includes('co-sasa'))!;
    await expect(svc.nameTenderAttendee(other, t.id, 'SITE_VISIT', 'Someone (mock)', true)).rejects.toBeInstanceOf(AccessDenied);
    await svc.nameTenderAttendee(cm, t.id, 'SITE_VISIT', 'Director (mock)', true);
    expect((await svc.home(cm, 'co-sasa')).todo.some((i) => i.tag === 'Site visit')).toBe(false);
    expect(ds.audit.some((a) => a.action === 'tender.attendee' && a.entityId === t.id)).toBe(true);
    await expect(svc.recordTenderAttendance(ae, t.id, 'SITE_VISIT', true, '', [slip()])).rejects.toThrow(/on or after the day/);
  });

  it('on the day the slip is kept, or the miss is explained, and a missed mandatory visit stops the bid', async () => {
    const { ds, svc, t, at } = fresh();
    const ae = await svc.user('u-ae-sasa');
    await svc.setTenderRecord(ae, t.id, { siteVisit: { on: TODAY, mandatory: true, place: '', outcome: '' } });
    expect(tenderAttendance(ds.tenders.find((x) => x.id === t.id)!, TODAY)[0].state).toBe('RECORD');
    expect((await svc.home(await svc.user('u-cm-sasa'), 'co-sasa')).todo.some((i) => /Record the site visit attendance/.test(i.title))).toBe(true);
    await expect(svc.recordTenderAttendance(ae, t.id, 'SITE_VISIT', true, '', [])).rejects.toThrow(/attendance slip/);
    await expect(svc.recordTenderAttendance(ae, t.id, 'SITE_VISIT', false, 'no', [])).rejects.toThrow(/why nobody/);
    await svc.recordTenderAttendance(ae, t.id, 'SITE_VISIT', true, '', [slip()]);
    const saved = ds.tenders.find((x) => x.id === t.id)!;
    expect(saved.attendance![0].result!.attended).toBe(true);
    expect(ds.evidenceDocs.some((d) => d.id === saved.attendance![0].result!.docIds[0] && d.tenderId === t.id)).toBe(true);
    await expect(svc.recordTenderAttendance(ae, t.id, 'SITE_VISIT', true, '', [slip()])).rejects.toThrow(/already recorded/);

    // A second tender whose mandatory briefing passed unrecorded cannot be lodged.
    const t2 = ds.tenders.find((x) => x.companyId === 'co-sasa' && x.id !== t.id && x.status === 'preparing' && x.closesOn > addDays(TODAY, 3));
    if (t2) {
      await svc.setTenderRecord(ae, t2.id, { briefing: { on: addDays(TODAY, -1), mandatory: true, place: '', outcome: '' } });
      at('2026-11-23T04:00:00.000Z');
      await expect(svc.submitTender(ae, t2.id, '', [slip()])).rejects.toThrow();
      expect(attendanceGaps(ds.tenders.find((x) => x.id === t2.id)!, TODAY)).toEqual(['record the briefing attendance slip']);
    }
  });

  it('a desk bid with nobody named shows on the Marketing board, and goes to the COO within 3 days', async () => {
    const { ds, svc } = fresh();
    await svc.startMarketingDesk(await svc.user('u-fauzan'), TODAY, 'Marketing does all from today');
    const own = ds.users.find((u) => u.marketingRole === 'executive' && ds.grants.some((g) => g.userId === u.id && g.companyId === 'co-sasa'))!;
    for (const l of ds.licences.filter((x) => x.companyId === 'co-sasa')) l.expiresOn = addDays(TODAY, 400);
    await svc.recordTenderOpportunity(own, { kind: 'TENDER', ref: 'MKT-AH13', title: 'Guarding (mock)', buyer: 'Buyer (mock)', channel: 'GOVERNMENT', source: 'Public portal', closesOn: addDays(TODAY, 20), guards: 5, note: '', companyIds: ['co-sasa'] });
    const t = ds.tenders.find((x) => x.ref === 'MKT-AH13')!;
    await svc.setTenderRecord(own, t.id, { siteVisit: { on: addDays(TODAY, 2), mandatory: true, place: '', outcome: '', mofNamedOnly: true } });
    const board = await svc.marketingBoard(await svc.user('u-mkt-mgr'));
    const a = board.alerts.find((x) => x.tag === 'Site visit' && x.go?.tenderId === t.id);
    expect(a?.level).toBe('coo');
    const coo = ds.users.find((u) => u.opsTier === 'coo');
    if (coo) expect((await svc.home(coo)).todo.some((i) => i.tag === 'Site visit')).toBe(true);
    // Marketing records what the company said; it cannot name itself where only the MOF-named person may go.
    await expect(svc.nameTenderAttendee(own, t.id, 'SITE_VISIT', own.name, false)).rejects.toThrow(/MOF certificate/);
    await svc.nameTenderAttendee(own, t.id, 'SITE_VISIT', 'Director (mock)', true);
    expect((await svc.marketingBoard(await svc.user('u-mkt-mgr'))).alerts.some((x) => x.tag === 'Site visit')).toBe(false);
  });
});

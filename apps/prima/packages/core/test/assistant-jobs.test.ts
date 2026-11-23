import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt } from '../src';

// The Prima helper's department jobs (Fauzan, 23 Nov 2026: "See from company wide, what helper can help each staff",
// then "Build"). Each job is understood from plain words, sent through the job's own server action as the person, and
// offered only to the people that action allows. Synthetic data only.
const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:00');
let n = 0;
const doc = () => ({ kind: 'document' as const, name: `synthetic-${++n}.pdf`, data: 'data:application/pdf;base64,' + Buffer.from(`%PDF-1.4 synthetic ${n}`).toString('base64') });

async function setup() {
  const ds = generateDataset({ today: TODAY, now: NOW });
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => NOW);
  return { ds, store, svc, a: svc.assistant };
}

type Case = { who: string; job: string; text: string; expect: Record<string, unknown>; add?: Record<string, unknown> };
const CASES: Case[] = [
  { who: 'u-finance-am', job: 'staff-claim', text: 'Tuntutan klinik RM 85.50 pada 22/11, demam', expect: { kind: 'MEDICAL', date: '2026-11-22', amount: 85.5 }, add: { proof: [doc()] } },
  { who: 'u-cm-sasa', job: 'office-request', text: 'Bil elektrik pejabat November RM 420', expect: { category: 'UTILITIES', period: '2026-11', amount: 420 }, add: { proof: [doc()] } },
  { who: 'u-cm-sasa', job: 'client-request', text: 'Pelanggan minta tambah pengawal 2 orang untuk acara', expect: { kind: 'more_guards' }, add: { from: 'Encik Ali (mock)' } },
  { who: 'u-cm-sasa', job: 'vacancy', text: 'Jawatan kosong 3 orang pengawal di Selangor gaji RM 1700 hingga RM 1900 sebab tapak baru', expect: { category: 'guard', headcount: 3, payFrom: 1700, payTo: 1900 }, add: { title: 'Pengawal keselamatan', state: 'Selangor' } },
  { who: 'u-cm-sasa', job: 'payment-request', text: 'Permohonan bayaran operasi kerajaan RM 1,200 untuk baiki pagar tapak sebelum 30/11', expect: { subject: 'operations', sector: 'government', amount: 1200, dueOn: '2026-11-30' }, add: { payee: 'Pembekal (mock)', calc: '2 pintu x RM600', evidence: 'sebut harga, gambar' } },
  { who: 'u-cm-sasa', job: 'police-help', text: 'Polis telefon minta pemeriksaan bilik kebal, hubungi 012-3456789', expect: { kind: 'PHONE_CALL', reason: 'ARMOURY_CHECK', contactPhone: '012-3456789' }, add: { policeUnit: 'IPD Klang (mock)', contactName: 'Pengurus (mock)' } },
  { who: 'u-cm-sasa', job: 'leave-for', text: 'Masukkan cuti sakit untuk pengawal esok', expect: { kind: 'SICK', from: '2026-11-24', to: '2026-11-24' }, add: { illness: 'Demam (mock)', clinic: 'Klinik X (mock)', mcNo: 'MC-0001 (mock)', proof: [doc()] } },
  { who: 'u-cm-sasa', job: 'case-report', text: 'Insiden kecurian di tapak malam tadi, serius', expect: { type: 'INCIDENT', severity: 'P2' }, add: { proof: [doc()] } },
  { who: 'u-proc-exec', job: 'purchase-request', text: 'Beli 50 pasang kasut uniform RM 45 seunit', expect: { category: 'UNIFORM', qty: 50, unitPrice: 45 }, add: { item: 'Kasut uniform (mock)' } },
  { who: 'u-fwm-ex1', job: 'fwm-task', text: 'Tugas FOMEMA untuk pekerja sebelum 5/12', expect: { kind: 'FOMEMA', dueOn: '2026-12-05' } },
  { who: 'u-pwvsb-hr', job: 'vehicle-request', text: 'Pinjam kereta esok 2pm hingga 4pm mesyuarat pelanggan', expect: { date: '2026-11-24', start: '14:00', end: '16:00' } },
  { who: 'u-transport', job: 'fuel', text: 'Isi minyak diesel WXY 1234, 40 liter RM 82 odometer 84500 km kad minyak hari ini 9.30', expect: { vehicleId: 'veh-sasa-1', fuel: 'DIESEL', litres: 40, amountRm: 82, odometerKm: 84500, paidWith: 'FUEL_CARD', time: '09:30', cardId: 'vc-veh-sasa-1-2' }, add: { station: 'Petronas (mock)', driver: 'Pemandu (mock)', proof: [doc()] } },
  { who: 'u-asset-re1', job: 'rent-payment', text: 'Bayaran sewa RES-006 RM 650 pindahan semalam', expect: { unitId: 'am-u-006', amount: 650, method: 'TRANSFER', on: '2026-11-22' }, add: { ref: 'IBG-1 (mock)' } },
  { who: 'u-act-aud1', job: 'act-finding', text: 'Penemuan: stok tidak dikira bulan ini, serius', expect: { severity: 'high' }, add: { area: 'PURCHASING' } },
  { who: 'u-it-ex1', job: 'it-purchase', text: 'Beli laptop baru 2 unit RM 3500 untuk staf baharu', expect: { kind: 'LAPTOP', qty: 2, unitPrice: 3500 } },
  { who: 'u-pdpa', job: 'pdpa-request', text: 'Permintaan akses data peribadi daripada pengawal hari ini', expect: { kind: 'ACCESS', subjectKind: 'guard', receivedOn: TODAY }, add: { subjectName: 'Pengawal (mock)' } },
  { who: 'u-legal', job: 'legal-matter', text: 'Notis tuntutan daripada pembekal, kita dituntut RM 20,000', expect: { kind: 'DEMAND', side: 'respondent', exposure: 20000 }, add: { counterparty: 'Pembekal (mock)', lawyer: 'Tetuan X (mock)' } },
];

describe('Department jobs: understood from words, sent as the person', () => {
  for (const c of CASES)
    it(`${c.job} (${c.who})`, async () => {
      const { a, svc, store } = await setup();
      const u = await svc.user(c.who);
      const jobs = (await a.jobsFor(u)).map((x) => x.id);
      expect(jobs).toContain(c.job);
      // The person types; the helper picks the job by itself.
      const r = await a.understand(u, { text: c.text });
      expect(r.draft.actionId === c.job || r.draft.alternatives.includes(c.job)).toBe(true);
      const d = r.draft.actionId === c.job ? r : await a.understand(u, { text: c.text, actionId: c.job });
      expect(d.draft.values).toMatchObject(c.expect);
      expect(d.sent).toBe(false);
      // The person checks, fills what is left from the same lists, and presses Send.
      const values: Record<string, unknown> = { ...d.draft.values, ...(c.add ?? {}) };
      const action = (await a.jobsFor(u)).find((x) => x.id === c.job)!;
      for (const f of action.fields) {
        if (f.type !== 'pick' || values[f.name]) continue;
        const l = (await a.listsFor(u, { actionId: c.job, values })) as { pick?: Record<string, { id: string; code?: string }[]> };
        const list = l.pick?.[f.list!] ?? [];
        if (f.required) values[f.name] = (f.list === 'people' ? list.find((p) => /\d/.test(p.code ?? '')) : list[0])?.id;
      }
      const before = (await store.list('audit', {})).length;
      const s = await a.send(u, { actionId: c.job, values, text: c.text, draft: d.draft });
      expect(s.sent).toBe(true);
      expect(s.ref).not.toBe('');
      const audit = await store.list('audit', {});
      expect(audit.length).toBeGreaterThan(before + 1); // the job's own record of the change, and the helper's
      expect(audit.some((x) => x.action === 'assistant.sent' && x.entityId === c.job)).toBe(true);
    });
});

describe('Each job only for the people its screen allows', () => {
  it('a storekeeper, a finance data-entry clerk and a patrol officer are not offered office or department jobs', async () => {
    const { a, svc } = await setup();
    const sk = (await a.jobsFor(await svc.user('u-proc-store1'))).map((x) => x.id);
    expect(sk).not.toContain('purchase-request');
    expect(sk).not.toContain('site-supplies');
    const de = (await a.jobsFor(await svc.user('u-fin-t1-de1'))).map((x) => x.id);
    for (const j of ['payment-request', 'vacancy', 'fuel', 'rent-payment', 'legal-matter', 'act-finding']) expect(de).not.toContain(j);
    const po = (await a.jobsFor(await svc.user('u-po-sasa-1'))).map((x) => x.id);
    expect(po).not.toContain('vehicle-request');
    expect(po).toContain('case-report');
  });

  it('the server still decides: sending another job by its name is refused, and so is a forged company', async () => {
    const { a, svc } = await setup();
    const de = await svc.user('u-fin-t1-de1');
    await expect(a.send(de, { actionId: 'payment-request', values: { companyId: 'co-sasa' } })).rejects.toThrow(/not one the agent fills/);
    const ae = await svc.user('u-ae-arsh');
    const other = (await svc.store.list('companies', {})).find((c) => !ae.companyIds.includes(c.id))!;
    await expect(a.send(ae, { actionId: 'police-help', values: { companyId: other.id, kind: 'PHONE_CALL', reason: 'OTHER', policeUnit: 'x', asked: 'x', contactName: 'x', contactPhone: '0123456789' } })).rejects.toThrow();
  });

  it('a uniform for one guard is offered only to a government OM', async () => {
    const { a, svc } = await setup();
    const om = await svc.user('u-om-klang');
    const can = ((await svc.uniformRequests(om)) as { canRequest: boolean }).canRequest;
    expect((await a.jobsFor(om)).some((x) => x.id === 'uniform-guard')).toBe(can);
    expect((await a.jobsFor(await svc.user('u-cm-sasa'))).some((x) => x.id === 'uniform-guard')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  AccessDenied,
  MemoryStore,
  PrimaService,
  bqRoute,
  briefFields,
  draftBqLines,
  generateDataset,
  myt,
  pastRates,
  RULES,
  type AmJobKind,
  type AmWorkOrder,
} from '../src';

// Asset Management BQ, quotes and award (Fauzan, 5 Nov 2026, rule AM-BQ). Synthetic data only: mock contractors and
// made-up prices.
const TODAY = '2026-11-05';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const job = (id: string, title: string, unitId: string | null): AmWorkOrder => ({
    id,
    unitId,
    propertyId: null,
    title,
    source: 'inspection',
    raisedOn: TODAY,
    dueOn: '2026-12-05',
    status: 'open',
    cost: null,
    contractor: null,
    doneOn: null,
  });
  const unit = ds.amUnits[0].id;
  ds.amWorkOrders.push(job('wo-t1', 'Repaint unit (test)', unit), job('wo-t2', 'Repaint second unit (test)', ds.amUnits[1].id), job('wo-t3', 'Fence repair (test)', unit));
  const svc = new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
  return { ds, svc };
};
const u = (svc: PrimaService, id: string) => svc.user(id);

/** Every required job detail answered with synthetic text. */
const fullAnswers = (kind: AmJobKind) =>
  Object.fromEntries(
    briefFields(kind).map((f) => [f.key, f.kind === 'choice' ? f.options![0] : f.kind === 'yesno' ? 'no' : f.kind === 'date' ? '2026-11-20' : 'Synthetic answer (test)']),
  );
const brief = async (svc: PrimaService, uid: string, woId: string, kind: AmJobKind, measurements: Record<string, number>) =>
  svc.amBqBrief(await svc.user(uid), woId, { jobKind: kind, answers: fullAnswers(kind), measurements, version: 0 });
const PAINT = { wallArea: 200 };

const paintLines = [
  { item: 'Wall emulsion paint, two coats', unit: 'm2', qty: 200, rate: 8, note: 'Online price check, mock' },
  { item: 'Protect floors and fittings, clean up', unit: 'lot', qty: 1, rate: 300, note: 'Supplier call, mock' },
];

async function approvedBq(svc: PrimaService, woId = 'wo-t1') {
  const mm = await u(svc, 'u-asset-mm');
  const dir = await u(svc, 'u-asset-dir');
  await brief(svc, 'u-asset-mm', woId, 'PAINTING', PAINT);
  await svc.amBqSave(mm, woId, { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 1 });
  await svc.amBqSubmit(mm, woId);
  await svc.amBqDecide(dir, woId, true, 'Quantities match the site visit');
  return { mm, dir };
}

const quote = (contractor: string, wall: number, lot: number, stated?: number) => ({
  contractor,
  ref: `Q-${contractor.slice(0, 3)}`,
  receivedOn: TODAY,
  validUntil: '2026-12-31',
  lines: [
    { lineId: 'L1', rate: wall },
    { lineId: 'L2', rate: lot },
  ],
  statedTotal: stated ?? 200 * wall + lot,
});

describe('BQ helpers', () => {
  it('drafts from the template and prices a line only from our own past awards', () => {
    const rates = pastRates([{ item: 'Wall emulsion paint, two coats', unit: 'M2', rate: 7.5, on: '2026-09-01', contractor: 'Mock A' }], TODAY);
    const lines = draftBqLines('PAINTING', { wallArea: 120, ceilingArea: 0 }, rates);
    expect(lines.map((l) => l.item)).toEqual(['Surface preparation and sealer coat', 'Wall emulsion paint, two coats', 'Protect floors and fittings, clean up']);
    expect(lines.find((l) => l.item.startsWith('Wall'))).toMatchObject({ qty: 120, rate: 7.5, rateFrom: 'past' });
    // No past price: no rate is made up.
    expect(lines.find((l) => l.item.startsWith('Surface'))).toMatchObject({ rate: null, rateFrom: null });
  });

  it('picks the route from the estimate, and never one quote while lines are unpriced', () => {
    expect(bqRoute(3_000, 0)).toMatchObject({ route: 'DIRECT', quotesNeeded: 1, cooToo: false });
    expect(bqRoute(3_000, 2)).toMatchObject({ route: 'RFQ', quotesNeeded: 3 });
    expect(bqRoute(20_000, 0)).toMatchObject({ route: 'RFQ', cooToo: false });
    expect(bqRoute(80_000, 0)).toMatchObject({ route: 'TENDER', cooToo: true });
  });
});

describe('Job details before the BQ (Fauzan, 5 Nov 2026)', () => {
  it('lists the details needed for each kind of job, common ones first', () => {
    const keys = briefFields('ELECTRICAL').map((f) => f.key);
    expect(keys.slice(0, 4)).toEqual(['need', 'requestedBy', 'discussedWith', 'siteVisitOn']);
    expect(keys).toEqual(expect.arrayContaining(['supply', 'certNeeded']));
    expect(briefFields('PAINTING').map((f) => f.key)).not.toContain('supply');
  });

  it('keeps drafting, saving and submitting closed until every required detail and a measurement are in', async () => {
    const { svc } = fresh();
    const mm = await u(svc, 'u-asset-mm');
    await expect(svc.amBqDraft(mm, 'wo-t1', 'PAINTING', PAINT)).rejects.toThrow(/Fill in the job details first/);
    const partial = await svc.amBqBrief(mm, 'wo-t1', { jobKind: 'PAINTING', answers: { need: 'Repaint before new tenant (test)', occupied: 'no' }, measurements: {}, version: 0 });
    expect(partial).toMatchObject({ status: 'draft', lines: [], version: 1 });
    const view = await svc.amBq(mm, 'wo-t1');
    expect(view.briefMissing).toEqual(expect.arrayContaining(['Who asked for it', 'Site visit date', 'Colour and paint brand or grade']));
    expect(view.briefMissing.at(-1)).toMatch(/^Site measurements/);
    await expect(svc.amBqDraft(mm, 'wo-t1', 'PAINTING', PAINT)).rejects.toThrow(/Who asked for it/);
    await expect(svc.amBqSave(mm, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 1 })).rejects.toThrow(/Fill in the job details first/);
    await expect(svc.amBqBrief(mm, 'wo-t1', { jobKind: 'PAINTING', answers: { occupied: 'maybe' }, measurements: {}, version: 1 })).rejects.toThrow(/answer yes or no/);
    await expect(svc.amBqBrief(mm, 'wo-t1', { jobKind: 'PAINTING', answers: { requestedBy: 'Someone' }, measurements: {}, version: 1 })).rejects.toThrow(/choose one of the options/);
    const full = await svc.amBqBrief(mm, 'wo-t1', { jobKind: 'PAINTING', answers: fullAnswers('PAINTING'), measurements: PAINT, version: 1 });
    expect((await svc.amBq(mm, 'wo-t1')).briefMissing).toEqual([]);
    expect(full.brief!.by).toBe(mm.name);
    // A draft for another kind of job than the details is refused.
    await expect(svc.amBqDraft(mm, 'wo-t1', 'ROOFING', { roofArea: 10 })).rejects.toThrow(/kind of job differs/);
    expect((await svc.amBqDraft(mm, 'wo-t1', 'PAINTING', PAINT)).lines.length).toBeGreaterThan(0);
  });
});

describe('BQ, quotes and award', () => {
  it('only Asset Management and its overseers see a BQ; only the team prepares it', async () => {
    const { svc } = fresh();
    await expect(svc.amBq(await u(svc, 'u-it-mgr'), 'wo-t1')).rejects.toBeInstanceOf(AccessDenied);
    const fin = await u(svc, 'u-finance-am');
    expect((await svc.amBq(fin, 'wo-t1')).role).toBe('oversee');
    await expect(svc.amBqSave(fin, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 0 })).rejects.toBeInstanceOf(AccessDenied);
    await expect(brief(svc, 'u-finance-am', 'wo-t1', 'PAINTING', PAINT)).rejects.toBeInstanceOf(AccessDenied);
  });

  it('needs the source of a price that is not our past price, and refuses a stale save', async () => {
    const { svc } = fresh();
    const mm = await u(svc, 'u-asset-mm');
    await brief(svc, 'u-asset-mm', 'wo-t1', 'PAINTING', PAINT);
    await expect(
      svc.amBqSave(mm, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: [{ ...paintLines[0], note: '' }], version: 1 }),
    ).rejects.toThrow(/say where the price/);
    const saved = await svc.amBqSave(mm, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 1 });
    expect(saved).toMatchObject({ status: 'draft', estimate: 1900, version: 2 });
    expect(saved.lines[0].rateFrom).toBe('staff');
    expect(saved.brief!.answers.need).toBe('Synthetic answer (test)');
    await expect(svc.amBqSave(mm, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 1 })).rejects.toThrow(/changed by someone else/);
  });

  it('the preparer cannot approve their own BQ; the Asset Director approves with a reason', async () => {
    const { svc } = fresh();
    const dir = await u(svc, 'u-asset-dir');
    const mm = await u(svc, 'u-asset-mm');
    await brief(svc, 'u-asset-dir', 'wo-t1', 'PAINTING', PAINT);
    await svc.amBqSave(dir, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 1 });
    await svc.amBqSubmit(dir, 'wo-t1');
    await expect(svc.amBqDecide(dir, 'wo-t1', true, 'ok')).rejects.toThrow(/another person decides/);
    await expect(svc.amBqDecide(mm, 'wo-t1', true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    // The Asset Director prepared it, so the COO decides in their place.
    const coo = await u(svc, 'u-coo');
    expect((await svc.amBq(coo, 'wo-t1')).can.decide).toBe(true);
    expect((await svc.amBq(mm, 'wo-t1')).can.decide).toBe(false);
    expect(await svc.amBqDecide(coo, 'wo-t1', true, 'Checked the quantities')).toMatchObject({ status: 'approved', director: null });

    const { svc: s2 } = fresh();
    const mm2 = await u(s2, 'u-asset-mm');
    const dir2 = await u(s2, 'u-asset-dir');
    await brief(s2, 'u-asset-mm', 'wo-t1', 'PAINTING', PAINT);
    await s2.amBqSave(mm2, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 1 });
    const sub = await s2.amBqSubmit(mm2, 'wo-t1');
    expect(sub).toMatchObject({ status: 'submitted', route: 'DIRECT', estimate: 1900 });
    expect((await s2.amBq(dir2, 'wo-t1')).can.decide).toBe(true);
    expect((await s2.amBq(await u(s2, 'u-coo'), 'wo-t1')).can.decide).toBe(false);
    await expect(s2.amBqDecide(dir2, 'wo-t1', true, '  ')).rejects.toThrow(/Say why you are approving/);
    expect(await s2.amBqDecide(dir2, 'wo-t1', true, 'Matches the site visit')).toMatchObject({ status: 'approved' });
  });

  it('a large BQ also needs the COO after the Asset Director', async () => {
    const { svc } = fresh();
    const mm = await u(svc, 'u-asset-mm');
    const dir = await u(svc, 'u-asset-dir');
    const coo = await u(svc, 'u-coo');
    await brief(svc, 'u-asset-mm', 'wo-t1', 'RENOVATION', { floorArea: 1000 });
    await svc.amBqSave(mm, 'wo-t1', { jobKind: 'RENOVATION', measurements: { floorArea: 1000 }, lines: [{ item: 'Supply and lay floor tiles', unit: 'm2', qty: 1000, rate: 90, note: 'Supplier call, mock' }], version: 1 });
    expect(await svc.amBqSubmit(mm, 'wo-t1')).toMatchObject({ route: 'TENDER' });
    await expect(svc.amBqDecide(coo, 'wo-t1', true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    expect(await svc.amBqDecide(dir, 'wo-t1', true, 'Needed before the new tenant')).toMatchObject({ status: 'submitted' });
    expect(await svc.amBqDecide(coo, 'wo-t1', true, 'Budget is there')).toMatchObject({ status: 'approved' });
  });

  it('compares quotes, needs a reason for a dearer one, and the final approval sets the contractor and price', async () => {
    const { svc, ds } = fresh();
    const { mm, dir } = await approvedBq(svc);
    await expect(svc.amQuoteAdd(await u(svc, 'u-finance-am'), 'wo-t1', quote('Mock Cat A', 7, 250))).rejects.toBeInstanceOf(AccessDenied);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 7, 250));
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat B', 9, 100));
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat C', 6, 200, 9999));
    await expect(svc.amQuoteAdd(mm, 'wo-t1', quote('mock cat a', 5, 5))).rejects.toThrow(/already has a quote/);

    const view = await svc.amBq(mm, 'wo-t1');
    // C is cheapest on paper but its lines do not add up, so A (RM1,650) is the lowest complete quote.
    expect(view.comparison!.lowestId).toBe('Q1');
    expect(view.advice.map((a) => a.code)).toEqual(expect.arrayContaining(['SUM_WRONG', 'SAVING', 'BUNDLE']));

    await expect(svc.amAwardAsk(mm, 'wo-t1', 'Q3', 'cheapest')).rejects.toThrow(/do not add up/);
    await expect(svc.amAwardAsk(mm, 'wo-t1', 'Q2', '')).rejects.toThrow(/not the lowest/);
    const asked = await svc.amAwardAsk(mm, 'wo-t1', 'Q1', '');
    expect(asked.award).toMatchObject({ quoteId: 'Q1', total: 1650, final: false });
    await expect(svc.amAwardDecide(mm, 'wo-t1', true, 'ok')).rejects.toThrow(/another person decides/);
    await expect(svc.amAwardDecide(dir, 'wo-t1', true, '')).rejects.toThrow(/Say why/);
    const done = await svc.amAwardDecide(dir, 'wo-t1', true, 'Lowest complete quote');
    expect(done.award!.final).toBe(true);
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')).toMatchObject({ contractor: 'Mock Cat A', cost: 1650 });
    await expect(svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat D', 5, 5))).rejects.toThrow(/already asked or made/);

    // The next painting job is drafted at our own awarded price.
    await brief(svc, 'u-asset-mm', 'wo-t2', 'PAINTING', { wallArea: 50 });
    const draft = await svc.amBqDraft(mm, 'wo-t2', 'PAINTING', { wallArea: 50 });
    expect(draft.lines.find((l) => l.item.startsWith('Wall'))).toMatchObject({ rate: 7, rateFrom: 'past' });
    expect(draft.lines.find((l) => l.item.startsWith('Surface'))).toMatchObject({ rate: null });
  });

  it('a price above the route ceiling must go out again', async () => {
    const { svc } = fresh();
    const { mm } = await approvedBq(svc);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 40, 300));
    await expect(svc.amAwardAsk(mm, 'wo-t1', 'Q1', 'only one')).rejects.toThrow(/above what a single quote may award/);
  });

  it('a turned-down award can be asked again on another quote', async () => {
    const { svc } = fresh();
    const { mm, dir } = await approvedBq(svc);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 7, 250));
    await svc.amAwardAsk(mm, 'wo-t1', 'Q1', '');
    await svc.amAwardDecide(dir, 'wo-t1', false, 'Contractor has a dispute with us');
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat B', 8, 250));
    const again = await svc.amAwardAsk(mm, 'wo-t1', 'Q2', 'Q1 turned down by the Asset Director');
    expect(again.award!.quoteId).toBe('Q2');
    expect(again.pastAwards).toHaveLength(1);
  });

  it('nobody who wrote the details or lines approves: the COO decides when the Asset Director worked on it', async () => {
    const { svc } = fresh();
    const mm = await u(svc, 'u-asset-mm');
    const dir = await u(svc, 'u-asset-dir');
    const coo = await u(svc, 'u-coo');
    // The Director writes the details and the lines; the Manager re-saves the same lines and submits.
    await brief(svc, 'u-asset-dir', 'wo-t1', 'PAINTING', PAINT);
    await svc.amBqSave(dir, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 1 });
    await svc.amBqSave(mm, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: paintLines, version: 2 });
    await svc.amBqSubmit(mm, 'wo-t1');
    await expect(svc.amBqDecide(dir, 'wo-t1', true, 'ok')).rejects.toThrow(/prepared or recorded part/);
    expect((await svc.amBq(dir, 'wo-t1')).can.decide).toBe(false);
    expect((await svc.amBq(coo, 'wo-t1')).can.decide).toBe(true);
    expect(await svc.amBqDecide(coo, 'wo-t1', true, 'Checked against the site photos')).toMatchObject({ status: 'approved' });
  });

  it('the person who recorded the chosen quote does not decide its award', async () => {
    const { svc } = fresh();
    const { mm, dir } = await approvedBq(svc);
    const coo = await u(svc, 'u-coo');
    await svc.amQuoteAdd(dir, 'wo-t1', quote('Mock Cat A', 7, 250));
    await svc.amAwardAsk(mm, 'wo-t1', 'Q1', 'Only one contractor replied (test)');
    await expect(svc.amAwardDecide(dir, 'wo-t1', true, 'ok')).rejects.toThrow(/prepared or recorded part/);
    expect((await svc.amBq(coo, 'wo-t1')).can.decideAward).toBe(true);
    expect((await svc.amAwardDecide(coo, 'wo-t1', true, 'Price is in line with past jobs')).award!.final).toBe(true);
  });

  it('reopens an approved BQ with a reason and keeps the quotes as an earlier round', async () => {
    const { svc } = fresh();
    const { mm, dir } = await approvedBq(svc);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 40, 300));
    await expect(svc.amAwardAsk(mm, 'wo-t1', 'Q1', 'only one')).rejects.toThrow(/Reopen the BQ/);
    await expect(svc.amBqReopen(mm, 'wo-t1', ' ')).rejects.toThrow(/Say why/);
    await expect(svc.amBqReopen(await u(svc, 'u-finance-am'), 'wo-t1', 'x')).rejects.toBeInstanceOf(AccessDenied);
    const re = await svc.amBqReopen(mm, 'wo-t1', 'Prices came in above a single-quote job (test)');
    expect(re).toMatchObject({ status: 'returned', quotes: [], director: null, route: null });
    expect(re.rounds).toHaveLength(1);
    expect(re.rounds![0].quotes[0].contractor).toBe('Mock Cat A');
    const v = re.version;
    await svc.amBqSave(mm, 'wo-t1', { jobKind: 'PAINTING', measurements: PAINT, lines: [{ ...paintLines[0], rate: 40 }, paintLines[1]], version: v });
    expect(await svc.amBqSubmit(mm, 'wo-t1')).toMatchObject({ route: 'RFQ', rounds: [expect.anything()] });
    await svc.amBqDecide(dir, 'wo-t1', true, 'New estimate from the first round');
  });

  it('after an award the edit form cannot change the contractor or price', async () => {
    const { svc } = fresh();
    const { mm, dir } = await approvedBq(svc);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 7, 250));
    await svc.amAwardAsk(mm, 'wo-t1', 'Q1', 'Only one contractor so far (test)');
    const form = async () => ({ ...((await svc.recordForm(mm, 'amWorkOrder', 'wo-t1', null)).values as Record<string, unknown>) });
    await expect(svc.saveRecord(mm, 'amWorkOrder', 'wo-t1', null, { ...(await form()), cost: 1 } as never)).rejects.toThrow(/award is waiting/);
    await svc.amAwardDecide(dir, 'wo-t1', true, 'Fair price');
    await expect(svc.saveRecord(mm, 'amWorkOrder', 'wo-t1', null, { ...(await form()), cost: 9999 } as never)).rejects.toThrow(/awarded through its BQ/);
    await expect(svc.saveRecord(mm, 'amWorkOrder', 'wo-t1', null, { ...(await form()), contractor: 'Other (mock)' } as never)).rejects.toThrow(/awarded through its BQ/);
    await svc.saveRecord(mm, 'amWorkOrder', 'wo-t1', null, { ...(await form()), status: 'in_progress' } as never);
  });
});

describe('Variation orders (Fauzan, 5 Nov 2026: every price change is a VO)', () => {
  async function awarded(svc: PrimaService) {
    const { mm, dir } = await approvedBq(svc);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 7, 250));
    await svc.amAwardAsk(mm, 'wo-t1', 'Q1', 'Only one contractor so far (test)');
    await svc.amAwardDecide(dir, 'wo-t1', true, 'Fair price');
    return { mm, dir, coo: await u(svc, 'u-coo'), ceo: await u(svc, 'u-fauzan'), chair: await u(svc, 'u-chair') };
  }
  const add = (qty: number, rate = 7, note = '') => ({ lineId: 'L1', item: '', unit: '', qty, rate, note });

  it('is raised only after a final award, with a reason and the contractor reference', async () => {
    const { svc } = fresh();
    const { mm, dir } = await approvedBq(svc);
    await expect(svc.amVoAsk(mm, 'wo-t1', { reason: 'More walls', contractorRef: 'VO-1', lines: [add(10)] })).rejects.toThrow(/only after the award/);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 7, 250));
    await svc.amAwardAsk(mm, 'wo-t1', 'Q1', 'Only one contractor so far (test)');
    await svc.amAwardDecide(dir, 'wo-t1', true, 'Fair price');
    await expect(svc.amVoAsk(await u(svc, 'u-finance-am'), 'wo-t1', { reason: 'x', contractorRef: 'y', lines: [add(10)] })).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amVoAsk(mm, 'wo-t1', { reason: ' ', contractorRef: 'VO-1', lines: [add(10)] })).rejects.toThrow(/Say why/);
    await expect(svc.amVoAsk(mm, 'wo-t1', { reason: 'More walls', contractorRef: '', lines: [add(10)] })).rejects.toThrow(/VO quote or letter/);
    const view = await svc.amBq(mm, 'wo-t1');
    expect(view.price).toMatchObject({ awarded: 1650, now: 1650, openVo: null });
    expect(view.can.askVo).toBe(true);
  });

  it('checks each line: omit no more than is left, a changed rate needs its reason, new work cannot be negative', async () => {
    const { svc } = fresh();
    const { mm } = await awarded(svc);
    const ask = (lines: Parameters<PrimaService['amVoAsk']>[2]['lines']) => svc.amVoAsk(mm, 'wo-t1', { reason: 'Scope change (test)', contractorRef: 'VO-1', lines });
    await expect(ask([add(-201)])).rejects.toThrow(/only 200 m2/);
    await expect(ask([add(10, 9)])).rejects.toThrow(/awarded rate is RM7/);
    await expect(ask([{ lineId: null, item: 'Gate paint (test)', unit: 'lot', qty: -1, rate: 100 }])).rejects.toThrow(/only BQ lines can be omitted/);
    await expect(ask([{ lineId: 'L9', item: '', unit: '', qty: 1, rate: 1 }])).rejects.toThrow(/not a line of this BQ/);
    await expect(ask([add(10), add(-10)])).rejects.toThrow(/does not change the price/);
    const vo = await ask([add(10), { lineId: null, item: 'Gate paint (test)', unit: 'lot', qty: 1, rate: 60, note: 'Contractor letter, mock' }]);
    expect(vo.variations![0]).toMatchObject({ id: 'VO1', amount: 130, final: false });
    await expect(ask([add(5)])).rejects.toThrow(/already waiting/);
  });

  it('the asker does not decide; the Asset Director approves, then the CEO and the Chairman consent, and the price follows', async () => {
    const { svc, ds } = fresh();
    const { mm, dir, ceo, chair } = await awarded(svc);
    await svc.amVoAsk(mm, 'wo-t1', { reason: 'Extra wall found on site (test)', contractorRef: 'VO-1', lines: [add(20)] });
    await expect(svc.amVoDecide(mm, 'wo-t1', 'VO1', true, 'ok')).rejects.toThrow(/another person decides/);
    await expect(svc.amVoDecide(dir, 'wo-t1', 'VO1', true, '')).rejects.toThrow(/Say why/);
    await expect(svc.amVoDecide(ceo, 'wo-t1', 'VO1', true, 'early')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.amBq(dir, 'wo-t1')).can.decideVo).toBe(true);
    await svc.amVoDecide(dir, 'wo-t1', 'VO1', true, 'Measured on the visit');
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1650);
    expect((await svc.amBq(mm, 'wo-t1')).price).toMatchObject({ openVo: 'VO1', openVoNext: 'ceo' });
    // The Chairman consents only after the CEO; the Asset Director cannot give consent.
    await expect(svc.amVoDecide(chair, 'wo-t1', 'VO1', true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amVoDecide(dir, 'wo-t1', 'VO1', true, 'again')).rejects.toThrow(/already took a step/);
    expect((await svc.amBq(ceo, 'wo-t1')).can.decideVo).toBe(true);
    await svc.amVoDecide(ceo, 'wo-t1', 'VO1', true, 'Consent, needed for the tenant');
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1650);
    expect((await svc.amBq(chair, 'wo-t1')).price).toMatchObject({ openVoNext: 'chairman' });
    const r = await svc.amVoDecide(chair, 'wo-t1', 'VO1', true, 'Consent');
    expect(r.variations![0]).toMatchObject({ final: true, ceo: { approve: true }, chairman: { approve: true } });
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1790);
    expect((await svc.amBq(mm, 'wo-t1')).price).toMatchObject({ awarded: 1650, now: 1790, voPct: 8.5 });
    // Omitting part of a line counts the earlier VO: 220 m2 are now in the job.
    await expect(svc.amVoAsk(mm, 'wo-t1', { reason: 'Less (test)', contractorRef: 'VO-2', lines: [add(-221)] })).rejects.toThrow(/only 220 m2/);
    // The edit form still cannot change the price.
    const form = { ...((await svc.recordForm(mm, 'amWorkOrder', 'wo-t1', null)).values as Record<string, unknown>) };
    await expect(svc.saveRecord(mm, 'amWorkOrder', 'wo-t1', null, { ...form, cost: 2000 } as never)).rejects.toThrow(/awarded through its BQ/);
  });

  it('the COO also decides once the VOs together pass 10% of the award, and a turned-down VO leaves the price', async () => {
    const { svc, ds } = fresh();
    const { mm, dir, coo, ceo, chair } = await awarded(svc);
    await svc.amVoAsk(mm, 'wo-t1', { reason: 'Extra wall (test)', contractorRef: 'VO-1', lines: [add(20)] });
    await svc.amVoDecide(dir, 'wo-t1', 'VO1', true, 'Measured on the visit');
    await svc.amVoDecide(ceo, 'wo-t1', 'VO1', true, 'Consent');
    await svc.amVoDecide(chair, 'wo-t1', 'VO1', true, 'Consent');
    // 140 + 70 = 210, past 10% of RM1,650.
    await svc.amVoAsk(mm, 'wo-t1', { reason: 'Another wall (test)', contractorRef: 'VO-2', lines: [add(10)] });
    expect((await svc.amBq(mm, 'wo-t1')).price).toMatchObject({ openVo: 'VO2', openVoCooToo: true });
    const half = await svc.amVoDecide(dir, 'wo-t1', 'VO2', true, 'Needed');
    expect(half.variations![1].final).toBe(false);
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1790);
    await svc.amVoDecide(coo, 'wo-t1', 'VO2', false, 'Do it in the next job');
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1790);
    expect((await svc.amBq(mm, 'wo-t1')).can.askVo).toBe(true);
  });

  it('a refused consent turns the VO down and leaves the price', async () => {
    const { svc, ds } = fresh();
    const { mm, dir, ceo, chair } = await awarded(svc);
    await svc.amVoAsk(mm, 'wo-t1', { reason: 'Extra wall (test)', contractorRef: 'VO-1', lines: [add(20)] });
    await svc.amVoDecide(dir, 'wo-t1', 'VO1', true, 'Measured on the visit');
    await svc.amVoDecide(ceo, 'wo-t1', 'VO1', true, 'Consent');
    const r = await svc.amVoDecide(chair, 'wo-t1', 'VO1', false, 'Include it in next year budget');
    expect(r.variations![0]).toMatchObject({ final: false, chairman: { approve: false } });
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1650);
    await expect(svc.amVoDecide(chair, 'wo-t1', 'VO1', true, 'changed my mind')).rejects.toThrow(/no variation order waiting/);
    expect((await svc.amBq(mm, 'wo-t1')).can.askVo).toBe(true);
  });

  it('the team can withdraw a waiting VO with a reason, and then raise a corrected one', async () => {
    const { svc } = fresh();
    const { mm, dir } = await awarded(svc);
    await svc.amVoAsk(mm, 'wo-t1', { reason: 'Wrong area (test)', contractorRef: 'VO-1', lines: [add(20)] });
    await expect(svc.amVoWithdraw(dir, 'wo-t1', 'VO1', 'x')).resolves.toBeTruthy(); // the Asset Director is in the team
    await expect(svc.amVoWithdraw(mm, 'wo-t1', 'VO1', 'again')).rejects.toThrow(/no variation order waiting/);
    await expect(svc.amVoDecide(dir, 'wo-t1', 'VO1', true, 'ok')).rejects.toThrow(/no variation order waiting/);
    const r = await svc.amVoAsk(mm, 'wo-t1', { reason: 'Right area (test)', contractorRef: 'VO-1a', lines: [add(15)] });
    expect(r.variations!.map((v) => v.id)).toEqual(['VO1', 'VO2']);
    await expect(svc.amVoWithdraw(await u(svc, 'u-fauzan'), 'wo-t1', 'VO2', 'x')).rejects.toBeInstanceOf(AccessDenied);
  });

  it('a VO waiting for consent is on the CEO and then the Chairman home', async () => {
    const { svc } = fresh();
    const { mm, dir, ceo, chair } = await awarded(svc);
    await svc.amVoAsk(mm, 'wo-t1', { reason: 'Extra wall (test)', contractorRef: 'VO-1', lines: [add(20)] });
    const tags = async (who: typeof ceo) => (await svc.home(who)).todo.filter((t) => t.tag === 'Variation order').map((t) => t.title);
    expect(await tags(ceo)).toEqual([]);
    await svc.amVoDecide(dir, 'wo-t1', 'VO1', true, 'Measured');
    expect(await tags(ceo)).toEqual([expect.stringMatching(/VO1 \+RM140 for your consent/)]);
    expect(await tags(chair)).toEqual([]);
    await svc.amVoDecide(ceo, 'wo-t1', 'VO1', true, 'Consent');
    expect(await tags(ceo)).toEqual([]);
    expect(await tags(chair)).toHaveLength(1);
  });
});

// C13 (Fauzan, 11 Nov 2026): for now EVERY variation order needs the CEO's and then the Chairman's consent, whatever its
// value; value limits come later. Synthetic amounts only.
describe('C13: every VO needs CEO and Chairman consent, whatever its value', () => {
  const add = (qty: number, rate = 7) => ({ lineId: 'L1', item: '', unit: '', qty, rate, note: '' });
  it('a RM7 VO still waits for the CEO and then the Chairman before it is approved; other roles are refused', async () => {
    const { svc, ds } = fresh();
    const { mm, dir } = await approvedBq(svc);
    await svc.amQuoteAdd(mm, 'wo-t1', quote('Mock Cat A', 7, 250));
    await svc.amAwardAsk(mm, 'wo-t1', 'Q1', 'Only one contractor so far (test)');
    await svc.amAwardDecide(dir, 'wo-t1', true, 'Fair price');
    const ceo = await u(svc, 'u-fauzan');
    const chair = await u(svc, 'u-chair');
    const vc = ds.users.find((x) => x.leadership === 'vice_chairman');
    expect(RULES.amBq.value.voConsent).toEqual(['ceo', 'chairman']);
    expect(RULES.amBq.source).toMatch(/Approved by Fauzan, 11 Nov 2026/);
    await svc.amVoAsk(mm, 'wo-t1', { reason: 'One more square metre (test)', contractorRef: 'VO-S', lines: [add(1)] });
    await svc.amVoDecide(dir, 'wo-t1', 'VO1', true, 'Measured');
    let vo = (await svc.amBq(mm, 'wo-t1')).bq!.variations![0];
    expect(vo).toMatchObject({ amount: 7, final: false });
    expect((await svc.amBq(mm, 'wo-t1')).price).toMatchObject({ openVo: 'VO1', openVoNext: 'ceo' });
    // Not the COO, the Vice Chairman, the Chairman before the CEO, or Finance.
    for (const who of [await u(svc, 'u-coo'), chair, await u(svc, 'u-finance-am'), ...(vc ? [vc] : [])])
      await expect(svc.amVoDecide(who, 'wo-t1', 'VO1', true, 'ok')).rejects.toBeInstanceOf(AccessDenied);
    await svc.amVoDecide(ceo, 'wo-t1', 'VO1', true, 'Consent (test)');
    vo = (await svc.amBq(mm, 'wo-t1')).bq!.variations![0];
    expect(vo.final).toBe(false);
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1650);
    await expect(svc.amVoDecide(ceo, 'wo-t1', 'VO1', true, 'again')).rejects.toThrow(/already took a step/);
    const r = await svc.amVoDecide(chair, 'wo-t1', 'VO1', true, 'Consent (test)');
    expect(r.variations![0]).toMatchObject({ final: true, ceo: { approve: true }, chairman: { approve: true } });
    expect(ds.amWorkOrders.find((w) => w.id === 'wo-t1')!.cost).toBe(1657);
  });
});

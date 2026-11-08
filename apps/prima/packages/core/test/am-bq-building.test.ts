import { describe, expect, it } from 'vitest';
import {
  MemoryStore,
  PrimaService,
  bqEstimate,
  bqWorkbookSheets,
  bqWorkbookXlsx,
  briefFields,
  briefMissing,
  buildingWorksDraft,
  checkQuote,
  draftBq,
  generateDataset,
  myt,
  newBuildingDraft,
  pastRates,
  type AmJobKind,
  type AmWorkOrder,
} from '../src';

// Building BQs (Fauzan, 5 Nov 2026): a new building, and a renovation or extension, laid out like Fauzan's own BQ
// (Ringkasan / BQ / Nota, lettered sections, workings, contingency, Kadar left for the contractor). Synthetic data only.
const TODAY = '2026-11-05';
const fresh = () => {
  const ds = generateDataset({ today: TODAY, now: myt(TODAY, '10:00') });
  const job: AmWorkOrder = {
    id: 'wo-b1',
    unitId: ds.amUnits[0].id,
    propertyId: null,
    title: 'Extra bedroom and higher ceiling (test)',
    source: 'planned',
    raisedOn: TODAY,
    dueOn: '2027-01-31',
    status: 'open',
    cost: null,
    contractor: null,
    doneOn: null,
  };
  ds.amWorkOrders.push(job);
  return new PrimaService(new MemoryStore(ds), () => myt(TODAY, '10:00'));
};
const answers = (kind: AmJobKind) =>
  Object.fromEntries(
    briefFields(kind).map((f) => [f.key, f.kind === 'choice' ? f.options![0] : f.kind === 'yesno' ? 'no' : f.kind === 'date' ? '2026-11-20' : 'Synthetic answer (test)']),
  );

/** The measurements of Fauzan's sample job: 7.2m x 6.0m, a 4.0m x 6.0m room at the end, ceiling raised to 3.5m. */
const SAMPLE = {
  existLength: 7.2,
  existWidth: 6,
  wallHeight: 3.5,
  raiseHeight: 1.2,
  extLength: 4,
  extWidth: 6,
  extColumns: 7,
  roofRemove: 76,
  ceilingRemove: 43.2,
  floorFinishRemove: 40.1,
  floorRaise: 100,
  roofPitch: 18,
  eave: 0.6,
  newOpenings: 1,
  closeOpenings: 4,
  doors: 1,
  windows: 4,
  plumbingPoints: 2,
  toilets: 0,
  septicTanks: 1,
  lightPoints: 9,
  powerPoints: 23,
  acPoints: 1,
  fanPoints: 3,
  repaintOutside: 126,
};

describe('Building BQ drafts', () => {
  it('renovation or extension: the sample job gives lettered sections and the same key quantities as Fauzan worked out', () => {
    const d = buildingWorksDraft(SAMPLE);
    expect(d.sections.map((s) => s.code)).toEqual(d.sections.map((_, i) => String.fromCharCode(65 + i)));
    expect(d.sections.map((s) => s.title)).toEqual(
      expect.arrayContaining(['KERJA AWALAN & AM', 'KERJA ROBOH & PEMBUANGAN', 'BILIK TAMBAHAN (4m x 6m)', 'MENAIKKAN DINDING & SILING KE 3.5m', 'KERJA BUMBUNG BARU', 'KEMASAN & CAT']),
    );
    const q = (start: string) => d.lines.find((l) => l.item.startsWith(start));
    // Raised walls (7.2 + 7.2 + 6 + 6) x 1.2 = 31.7 m2, plastered both sides; ceiling 43.2 + 24 = 67.2 m2; ridge 12.4 m.
    expect(q('Dinding bata separuh (115mm) ditambah')).toMatchObject({ qty: 31.7, unit: 'm2' });
    expect(q('Lepa (plaster) dinding yang dinaikkan')).toMatchObject({ qty: 63.4 });
    expect(q('Siling rata papan plaster')).toMatchObject({ qty: 67.2, calc: '43.2 + 24' });
    expect(q('Rabung')).toMatchObject({ qty: 12.4, unit: 'm' });
    expect(q('Buka dan buang kepingan bumbung')).toMatchObject({ qty: 76 });
    expect(q('Naikkan aras lantai sedia ada 100mm')).toMatchObject({ qty: 43.2 });
    expect(q('Tiang konkrit')).toMatchObject({ qty: 7, unit: 'no' });
    // Ring beam: outside 34.4 + the old end wall now inside 6.0 = 40.4 (Fauzan: 40).
    expect(q('Rasuk keliling')).toMatchObject({ qty: 40.4, calc: 'Perimeter luar 34.4 + dinding kongsi 6' });
    // Every line has its working or is a lump sum; optional lines are marked.
    expect(d.lines.filter((l) => l.optional).map((l) => l.item)).toEqual(expect.arrayContaining([expect.stringMatching(/^\(Pilihan\)/)]));
    expect(d.contingencyPct).toBe(5);
    expect(d.title).toBe('Kerja ubahsuai, bilik tambahan 4m x 6m dan menaikkan siling ke 3.5m');
  });

  it('leaves out every part that was not measured, and closes up the section letters', () => {
    const d = buildingWorksDraft({ existLength: 10, existWidth: 5, floorFinishRemove: 50 });
    expect(d.sections.map((s) => `${s.code} ${s.title}`)).toEqual(['A KERJA AWALAN & AM', 'B KERJA ROBOH & PEMBUANGAN', 'C KERJA LANTAI']);
    expect(d.lines.some((l) => /bumbung/i.test(l.item) && l.section !== 'A')).toBe(false);
  });

  it('new building: quantities come from the measured size, with the factors written in the working', () => {
    const d = newBuildingDraft({ length: 10, width: 6, wallHeight: 3, roofPitch: 20, eave: 0.6, internalWalls: 6, doors: 3, windows: 4, toilets: 1, toiletArea: 4, columns: 8, lightPoints: 6, powerPoints: 8 });
    const q = (start: string) => d.lines.find((l) => l.item.startsWith(start))!;
    expect(q('Lantai konkrit Gred 25')).toMatchObject({ qty: 60 });
    expect(q('Korek tanah')).toMatchObject({ qty: 20.5, calc: '(32 + 6) x 0.6 x 0.9 (anggaran)' }); // 38 x 0.54 = 20.52
    // Wall (32 + 6) x 3 = 114 less 3 doors and 4 windows (5.67 + 5.76) = 102.6
    expect(q('Dinding bata separuh')).toMatchObject({ qty: 102.6 });
    expect(q('Jubin lantai homogeneous')).toMatchObject({ qty: 56 });
    expect(q('Mata lampu')).toMatchObject({ qty: 6 });
    expect(d.lines.some((l) => l.item.startsWith('Mata penghawa dingin'))).toBe(false);
    expect(d.notes.join(' ')).toMatch(/lukisan jurutera/);
  });

  it('prices a line only from our own past awards; everything else stays empty', () => {
    const rates = pastRates([{ item: 'Rabung (ridge capping)', unit: 'm', rate: 28, on: '2026-08-01', contractor: 'Mock Roofing' }], TODAY);
    const d = draftBq('BUILDING_WORKS', SAMPLE, rates);
    expect(d.lines.find((l) => l.item.startsWith('Rabung'))).toMatchObject({ rate: 28, rateFrom: 'past' });
    expect(d.lines.filter((l) => l.rate != null)).toHaveLength(1);
    expect(d.lines.every((l) => /^L\d+$/.test(l.id) && l.section)).toBe(true);
  });

  it('needs the building size measured before drafting', () => {
    const brief = { jobKind: 'NEW_BUILDING' as const, answers: answers('NEW_BUILDING') };
    expect(briefMissing(brief, { length: 10 })).toEqual(['Building width (m)', 'Floor to ceiling height (m)', 'Roof slope (degrees)']);
    expect(briefMissing(brief, { length: 10, width: 6, wallHeight: 3, roofPitch: 20 })).toEqual([]);
  });

  it('asks for the ceiling height and both extension sizes once an extension or raised walls are measured', () => {
    const brief = { jobKind: 'BUILDING_WORKS' as const, answers: answers('BUILDING_WORKS') };
    expect(briefMissing(brief, { existLength: 7.2, existWidth: 6, roofRemove: 40 })).toEqual([]);
    expect(briefMissing(brief, { existLength: 7.2, existWidth: 6, extLength: 4 })).toEqual(['New floor to ceiling height (m)', 'Extension width (m)']);
    expect(briefMissing(brief, { existLength: 7.2, existWidth: 6, raiseHeight: 1.2 })).toEqual(['New floor to ceiling height (m)']);
  });
});

describe('Contingency', () => {
  it('counts towards the estimate and the route, so it cannot keep a job under a limit', () => {
    const lines = [{ id: 'L1', item: 'x', unit: 'LS', qty: 1, rate: 48_000, rateFrom: 'staff' as const, note: 'mock' }];
    expect(bqEstimate(lines, 5)).toEqual({ known: 48_000, unpriced: 0, contingency: 2_400, withContingency: 50_400 });
  });

  it('accepts a quote total written with the contingency added, but compares the line total', () => {
    const bq = { lines: [{ id: 'L1', item: 'x', unit: 'm2', qty: 10, rate: null, rateFrom: null, note: '' }], contingencyPct: 5 };
    const q = { id: 'Q1', contractor: 'Mock', ref: 'Q', receivedOn: TODAY, validUntil: null, lines: [{ lineId: 'L1', rate: 100 }], statedTotal: 1050, addedBy: '', addedById: '', at: '' };
    expect(checkQuote(bq, q, new Map(), TODAY)).toMatchObject({ total: 1000, sumOk: true, statedWithContingency: true });
    expect(checkQuote(bq, { ...q, statedTotal: 1000 }, new Map(), TODAY)).toMatchObject({ sumOk: true, statedWithContingency: false });
    expect(checkQuote(bq, { ...q, statedTotal: 1200 }, new Map(), TODAY)).toMatchObject({ sumOk: false });
  });
});

describe('Building BQ through the flow', () => {
  it('saves sections, workings, notes and drawings; the route uses the estimate with contingency', async () => {
    const svc = fresh();
    const mm = await svc.user('u-asset-mm');
    const dir = await svc.user('u-asset-dir');
    await svc.amBqBrief(mm, 'wo-b1', { jobKind: 'BUILDING_WORKS', answers: answers('BUILDING_WORKS'), measurements: SAMPLE, version: 0 });
    const d = await svc.amBqDraft(mm, 'wo-b1', 'BUILDING_WORKS', SAMPLE);
    expect(d.sections!.length).toBeGreaterThan(5);
    // One staff price makes the known lines RM48,000; with 5% contingency the estimate is RM50,400, so an open tender.
    const lines = d.lines.map((l, i) => ({ ...l, rate: i === 0 ? 48_000 : null, note: i === 0 ? 'Supplier call (mock)' : '' }));
    const saved = await svc.amBqSave(mm, 'wo-b1', {
      jobKind: 'BUILDING_WORKS',
      measurements: SAMPLE,
      lines,
      version: 1,
      title: d.title,
      location: 'Unit A (test)',
      sections: d.sections,
      contingencyPct: 5,
      notes: [...d.notes!, 'Pokok di atas bumbung: puncak baru tidak melebihi paras sedia ada (test).'],
      drawings: [{ ref: 'L-01', title: 'Pelan lantai (test)' }],
    });
    expect(saved).toMatchObject({ title: d.title, location: 'Unit A (test)', contingencyPct: 5, estimate: 50_400, drawings: [{ ref: 'L-01', title: 'Pelan lantai (test)' }] });
    expect(saved.lines[0]).toMatchObject({ section: 'A' });
    expect(saved.lines.find((l) => l.item.startsWith('Rabung'))).toMatchObject({ section: expect.stringMatching(/^[A-Z]$/), calc: '11.2 + 2 x 0.6' });
    expect(saved.lines.filter((l) => l.optional).length).toBeGreaterThan(0);
    const view = await svc.amBq(mm, 'wo-b1');
    expect(view.route).toMatchObject({ route: 'TENDER', cooToo: true });
    expect(view.templates.find((t) => t.kind === 'BUILDING_WORKS')).toMatchObject({ building: true });
    const sub = await svc.amBqSubmit(mm, 'wo-b1');
    expect(sub).toMatchObject({ route: 'TENDER', estimate: 50_400 });
    await svc.amBqDecide(dir, 'wo-b1', true, 'Checked against the drawing (test)');
    expect((await svc.amBq(dir, 'wo-b1')).can.decide).toBe(false);
  });

  it('refuses a line under a section that does not exist, a contingency above 20% and a drawing with no number', async () => {
    const svc = fresh();
    const mm = await svc.user('u-asset-mm');
    await svc.amBqBrief(mm, 'wo-b1', { jobKind: 'BUILDING_WORKS', answers: answers('BUILDING_WORKS'), measurements: SAMPLE, version: 0 });
    const base = { jobKind: 'BUILDING_WORKS' as const, measurements: SAMPLE, version: 1, sections: [{ code: 'A', title: 'KERJA AWALAN & AM' }] };
    const line = { item: 'Mobilisasi (test)', unit: 'LS', qty: 1, rate: null };
    await expect(svc.amBqSave(mm, 'wo-b1', { ...base, lines: [{ ...line, section: 'Q' }] })).rejects.toThrow(/section Q is not in/);
    await expect(svc.amBqSave(mm, 'wo-b1', { ...base, lines: [line], contingencyPct: 25 })).rejects.toThrow(/0% to 20%/);
    await expect(svc.amBqSave(mm, 'wo-b1', { ...base, lines: [line], drawings: [{ ref: '', title: 'Pelan' }] })).rejects.toThrow(/number and its title/);
    await expect(svc.amBqSave(mm, 'wo-b1', { ...base, lines: [line], sections: [{ code: 'A', title: 'X' }, { code: 'A', title: 'Y' }] })).rejects.toThrow(/not used twice/);
    await expect(svc.amBqBrief(mm, 'wo-b1', { jobKind: 'BUILDING_WORKS', answers: answers('BUILDING_WORKS'), measurements: { ...SAMPLE, roofPitch: 75 }, version: 1 })).rejects.toThrow(/60 degrees/);
    // A line with no section goes under the first one.
    expect((await svc.amBqSave(mm, 'wo-b1', { ...base, lines: [line] })).lines[0].section).toBe('A');
  });
});

describe('Excel for contractors', () => {
  const d = buildingWorksDraft(SAMPLE);
  const input = { title: d.title, location: 'Unit A (test)', sections: d.sections, lines: d.lines, contingencyPct: 5, notes: d.notes, drawings: [{ ref: 'L-01', title: 'Pelan lantai' }] };

  it('lays out Ringkasan, BQ and Nota with formulas, an empty yellow Kadar column and no rates of ours', () => {
    const sh = bqWorkbookSheets(input);
    expect(sh.bq).toContain('<f>C7*E7</f>');
    expect(sh.bq).toMatch(/<f>SUM\(F7:F\d+\)<\/f>/);
    // Kadar (column E) is a blank yellow input cell on every line.
    const lineRows = (sh.bq.match(/<f>C\d+\*E\d+<\/f>/g) ?? []).length;
    expect(lineRows).toBe(d.lines.length);
    expect((sh.bq.match(/<c r="E\d+" s="5"\/>/g) ?? []).length).toBe(d.lines.length);
    expect(sh.bq).toContain('m²');
    expect(sh.ringkasan).toContain('<f>BQ!F');
    expect(sh.ringkasan).toContain('JUMLAH KESELURUHAN');
    expect(sh.ringkasan).toContain('<v>0.05</v>');
    expect(sh.nota).toContain('SENARAI LUKISAN');
    expect(sh.nota).toContain('Pelan lantai');
  });

  it('keeps typed text as text, never as a formula', () => {
    const sh = bqWorkbookSheets({ title: '=HYPERLINK("x")', lines: [{ item: '=1+1 <b>&', unit: 'LS', qty: 1 }] });
    expect(sh.bq).toContain('=1+1 &lt;b&gt;&amp;');
    expect(sh.bq).not.toContain('<f>1+1');
    expect(sh.bq).not.toContain('<f>HYPERLINK');
  });

  it('is a zip holding the workbook parts', () => {
    const bytes = bqWorkbookXlsx(input);
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
    const text = new TextDecoder().decode(bytes);
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet3.xml']) expect(text).toContain(part);
    expect(text).toContain('<sheet name="Ringkasan"');
  });
});

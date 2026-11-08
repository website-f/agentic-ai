// Drafting help (DRAFT-HELP): who may ask, what is sent, and what a suggestion may contain. Synthetic data only.
import { describe, expect, it } from 'vitest';
import {
  bqSuggestionLines,
  checkBillSuggestion,
  checkBqSuggestion,
  checkPostSuggestion,
  draftHelpAllowed,
  draftHelpInput,
  draftHelpKindsFor,
  readBillAmount,
  locateOnBill,
  readBillDate,
  redactPersonal,
  DRAFT_HELP_LABELS,
  type PostHelpInput,
  type User,
} from '../src';

const user = (over: Partial<User>): User => ({ id: 'u-x', name: 'Synthetic', title: 'T', role: 'pwvsb_officer', companyIds: ['pwvsb'], siteIds: [], ...over }) as User;

describe('who may ask for a suggested draft', () => {
  it('gives each kind only to the people who write that record by hand', () => {
    expect(draftHelpKindsFor(user({ department: 'asset' }))).toEqual(['bq']);
    expect(draftHelpKindsFor(user({ department: 'hr' }))).toEqual(['job-post']);
    expect(draftHelpKindsFor(user({ leadership: 'cos' }))).toEqual(['job-post']);
    expect(draftHelpKindsFor(user({ role: 'company_manager', companyIds: ['c1'] }))).toEqual(['job-post']);
    expect(draftHelpKindsFor(user({ department: 'finance', financeRole: 'data_entry', financeTeam: 1 }))).toEqual(['bill']);
    expect(draftHelpKindsFor(user({ leadership: 'finance_director' }))).toEqual(['bill']);
  });
  it('refuses approvers who do not draft, guards, devices, system feeds and closed accounts', () => {
    expect(draftHelpKindsFor(user({ opsTier: 'ceo' }))).toEqual([]);
    expect(draftHelpKindsFor(user({ leadership: 'chairman' }))).toEqual([]);
    expect(draftHelpKindsFor(user({ assetRole: 'director', department: undefined }))).toEqual([]);
    expect(draftHelpKindsFor(user({ role: 'guard' }))).toEqual([]);
    expect(draftHelpKindsFor(user({ role: 'site_device' }))).toEqual([]);
    expect(draftHelpKindsFor(user({ department: 'hr', integration: 'ja' }))).toEqual([]);
    expect(draftHelpAllowed(user({ department: 'finance', accessClosedFrom: '2026-11-05' }), 'bill', '2026-11-05')).toBe(false);
    expect(draftHelpAllowed(user({ department: 'finance', accessClosedFrom: '2026-11-06' }), 'bill', '2026-11-05')).toBe(true);
  });
  it('staff labels never name an AI product', () => {
    const all = JSON.stringify(DRAFT_HELP_LABELS);
    expect(all).not.toMatch(/\b(AI|Arisha|Claude|ChatGPT|OpenAI|GPT|Copilot|kecerdasan buatan)\b/i);
  });
});

describe('only job facts are sent', () => {
  it('removes IC numbers, mobile numbers and emails from free text', () => {
    const t = redactPersonal('Hubungi 012-345 6789 atau ali@example.test, IC 900101-14-5678, ref 201901012345');
    expect(t).not.toMatch(/345 6789|example\.test|900101/);
    expect(t).toContain('201901012345'); // a company registration number is not an IC (month 19)
  });
  it('trims the BQ form to its fields and refuses unknown or oversized input', () => {
    const r = draftHelpInput('bq', {
      title: 'Ubahsuai bilik tambahan',
      jobKind: 'RENOVATION',
      details: { 'Who asked': 'Tenant 012-3456789', Scope: 'Raise ceiling to 3.5m' },
      measurements: { 'Building length (m)': 7.2, 'Building width (m)': 6 },
      notes: '',
      extra: 'ignored',
    });
    expect(r.kind).toBe('bq');
    if (r.kind !== 'bq') return;
    expect(JSON.stringify(r.input)).not.toContain('3456789');
    expect(r.input).not.toHaveProperty('extra');
    expect(() => draftHelpInput('bq', { title: 'x', jobKind: 'OTHER', measurements: { a: -1 } })).toThrow();
    expect(() => draftHelpInput('bq', { title: 'x', jobKind: 'OTHER' })).toThrow(/details or a measurement/);
    expect(() => draftHelpInput('bill', { text: 'x'.repeat(8001) })).toThrow();
  });
  it('keeps the official apply line but refuses an IC in it', () => {
    const ok = draftHelpInput('job-post', { title: 'Pengawal Keselamatan', employer: 'Syarikat Contoh Sdn Bhd', applyHow: 'WhatsApp 012-000 1111', payFrom: 1700, payTo: 1900, headcount: 3, category: 'guard', closingDate: '2026-12-01' });
    expect(ok.kind === 'job-post' && ok.input.applyHow).toBe('WhatsApp 012-000 1111');
    expect(() => draftHelpInput('job-post', { title: 'X', employer: 'Y', applyHow: 'IC 900101-14-5678' })).toThrow(/IC/);
    expect(() => draftHelpInput('job-post', { title: 'X', employer: 'Y', payFrom: 2000, payTo: 1000 })).toThrow(/range/);
  });
  it('removes card-like numbers from a bill but keeps the account number', () => {
    const r = draftHelpInput('bill', { text: 'No. Akaun 220112345678\nKad 4111 1111 1111 1111\nPemilik 900101-14-5678\nJumlah RM88.00' });
    expect(r.kind === 'bill' && r.input.text).toContain('220112345678');
    expect(r.kind === 'bill' && r.input.text).not.toContain('900101-14-5678');
    expect(r.kind === 'bill' && r.input.text).not.toContain('4111 1111');
  });
});

describe('a BQ suggestion', () => {
  const good = {
    sections: [
      { title: 'Kerja awalan & am', lines: [{ item: 'Mobilisasi dan demobilisasi', qty: 1, unit: 'LS', working: '', basis: 'estimate', optional: false }] },
      {
        title: 'Kerja roboh',
        lines: [
          { item: 'Buka dan buang siling sedia ada', qty: 43.2, unit: 'm2', working: '7.2 x 6.0', basis: 'measured', optional: false },
          { item: 'Panel solar tambahan', qty: 2, unit: 'no', working: 'Anggaran', basis: 'estimate', optional: true },
        ],
      },
    ],
    notes: ['Semua kuantiti adalah anggaran; kontraktor sahkan di tapak.'],
  };
  it('numbers the lines itself, normalises units and keeps the rate empty', () => {
    const { suggestion, warnings } = checkBqSuggestion(good);
    expect(suggestion.sections.map((s) => s.code)).toEqual(['A', 'B']);
    expect(suggestion.sections[1].lines.map((l) => l.code)).toEqual(['B1', 'B2']);
    expect(suggestion.sections[1].lines[0].unit).toBe('m²');
    expect(warnings).toEqual(expect.arrayContaining(['NO_RATES_FROM_HELPER', 'HAS_ESTIMATED_QUANTITIES', 'HAS_OPTIONAL_ITEMS']));
    const lines = bqSuggestionLines(suggestion);
    expect(lines.every((l) => l.rate === null && l.rateFrom === null)).toBe(true);
    expect(lines[1]).toMatchObject({ item: 'B1 Buka dan buang siling sedia ada', unit: 'm2', qty: 43.2, note: '7.2 x 6.0' });
    expect(lines[2].item).toContain('(Pilihan)');
    expect(lines[0].note).toMatch(/^Anggaran; sahkan di tapak/);
  });
  it('refuses any price, unknown unit, extra field, zero quantity or personal number', () => {
    const line = good.sections[1].lines[0];
    const withLine = (l: object) => ({ sections: [{ title: 'X', lines: [l] }], notes: [] });
    expect(() => checkBqSuggestion(withLine({ ...line, item: 'Siling RM45 semeter' }))).toThrow();
    expect(() => checkBqSuggestion(withLine({ ...line, working: '43.2 x RM30' }))).toThrow();
    expect(() => checkBqSuggestion(withLine({ ...line, rate: 30 }))).toThrow();
    expect(() => checkBqSuggestion(withLine({ ...line, unit: 'acre' }))).toThrow();
    expect(() => checkBqSuggestion(withLine({ ...line, qty: 0 }))).toThrow();
    expect(() => checkBqSuggestion({ ...withLine(line), notes: ['Call 012-345 6789'] })).toThrow();
    expect(() => checkBqSuggestion({ sections: [], notes: [] })).toThrow();
  });
  it('a "measured" line with no working is shown as an estimate', () => {
    const { suggestion } = checkBqSuggestion({ sections: [{ title: 'X', lines: [{ item: 'Y', qty: 1, unit: 'no', working: '', basis: 'measured', optional: false }] }], notes: [] });
    expect(suggestion.sections[0].lines[0]).toMatchObject({ basis: 'estimate', working: 'Anggaran' });
  });
});

describe('a post suggestion', () => {
  const f: PostHelpInput = { title: 'Pengawal Keselamatan', department: 'Operasi', headcount: 3, category: 'guard', employer: 'Syarikat Contoh Sdn Bhd', payFrom: 1700, payTo: 1900, applyHow: 'WhatsApp 012-000 1111 atau kerja@contoh.test', closingDate: '2026-12-01' };
  it('accepts wording within the approved pay range and the official contact', () => {
    const { suggestion } = checkPostSuggestion({ bm: 'JAWATAN KOSONG: Pengawal Keselamatan\nGaji RM1,700 - RM1,900\nWhatsApp 012-000 1111', en: 'We are hiring: Security Guard. Email kerja@contoh.test' }, f);
    expect(suggestion.text).toContain('\n\nWe are hiring');
  });
  it('refuses pay outside the range, any pay without a range, other phones or emails, an IC, or a missing title', () => {
    const t = (bm: string, ff = f) => () => checkPostSuggestion({ bm, en: 'Security Guard' }, ff);
    expect(t('Pengawal Keselamatan, gaji RM2,500')).toThrow();
    expect(t('Pengawal Keselamatan, elaun RM300')).toThrow();
    expect(t('Pengawal Keselamatan, gaji RM1,700', { ...f, payFrom: null, payTo: null })).toThrow();
    expect(t('Pengawal Keselamatan, hubungi 019-888 7777')).toThrow();
    expect(t('Pengawal Keselamatan, emel hr@lain.test')).toThrow();
    expect(t('Pengawal Keselamatan 900101-14-5678')).toThrow();
    expect(t('Pengawal Keselamatan, lelaki sahaja')).toThrow();
    expect(() => checkPostSuggestion({ bm: 'Jawatan kosong', en: 'Hiring now' }, f)).toThrow();
    expect(() => checkPostSuggestion({ bm: 'Pengawal Keselamatan', en: 'x', extra: 1 }, f)).toThrow();
  });
});

describe('reading a bill (A8)', () => {
  const bill = 'SYARIKAT AIR CONTOH BHD\nNo. Akaun: 220012345678\nNo. Bil: B-9981\nTarikh Bil: 03/11/2026\nTempoh: 01 Okt 2026 - 31 Okt 2026\nTarikh Akhir Bayaran: 24.11.2026\nJumlah Perlu Dibayar: RM1,234.50';
  const at = (s: string) => ({ raw: s });
  const none = { raw: null };
  const reading = {
    fields: {
      billerName: at('SYARIKAT AIR CONTOH BHD'),
      accountNo: at('220012345678'),
      billNo: at('B-9981'),
      billDate: at('03/11/2026'),
      dueDate: at('24.11.2026'),
      periodFrom: at('01 Okt 2026'),
      periodTo: at('31 Okt 2026'),
      amountDue: at('RM1,234.50'),
    },
  };
  it('keeps only text that is really on the bill and reads dates and amounts', () => {
    const { suggestion } = checkBillSuggestion(reading, bill);
    expect(suggestion.fields.amountDue.value).toBe(1234.5);
    expect(suggestion.fields.billDate.value).toBe('2026-11-03');
    expect(suggestion.fields.dueDate.value).toBe('2026-11-24');
    expect(suggestion.fields.periodFrom.value).toBe('2026-10-01');
    expect(suggestion.problems).toEqual([]);
  });
  it('finds each value on the bill itself, allowing for tidied spacing', () => {
    const { suggestion } = checkBillSuggestion({ fields: { ...reading.fields, billerName: { raw: 'SYARIKAT  AIR\nCONTOH BHD' }, periodFrom: { raw: '01 Okt  2026' } } }, bill);
    expect(suggestion.fields.billerName).toMatchObject({ raw: 'SYARIKAT AIR CONTOH BHD', start: 0, value: 'SYARIKAT AIR CONTOH BHD' });
    expect(suggestion.fields.periodFrom.value).toBe('2026-10-01');
    expect(locateOnBill('a.b c', 'a.b')).toEqual({ start: 0, end: 3 });
    expect(locateOnBill('axb', 'a.b')).toBeNull(); // regex characters are literal
  });
  it('refuses a figure that is not on the bill (an invented amount) or extra fields', () => {
    expect(() => checkBillSuggestion({ fields: { ...reading.fields, amountDue: { raw: 'RM9,999.00' } } }, bill)).toThrow();
    expect(() => checkBillSuggestion({ fields: { ...reading.fields, amountDue: { raw: 'RM1,234.50', start: 0, end: 1 } } }, bill)).toThrow();
    expect(() => checkBillSuggestion({ fields: { ...reading.fields, extra: none } }, bill)).toThrow();
  });
  it('notes missing or odd figures for staff instead of guessing', () => {
    const { suggestion } = checkBillSuggestion({ fields: { ...reading.fields, amountDue: none, dueDate: at('03/11/2026'), billDate: at('24.11.2026') } }, bill);
    expect(suggestion.problems).toEqual(expect.arrayContaining(['MISSING_amountDue', 'DUE_BEFORE_BILL_DATE']));
  });
  it('reads Malaysian date and amount styles and refuses credits', () => {
    expect(readBillDate('5/1/26')).toBe('2026-01-05');
    expect(readBillDate('31 Disember 2026')).toBe('2026-12-31');
    expect(readBillDate('31/02/2026')).toBeNull();
    expect(readBillAmount('RM 88.00')).toBe(88);
    expect(readBillAmount('12.30 CR')).toBeNull();
    expect(readBillAmount('-5.00')).toBeNull();
  });
});

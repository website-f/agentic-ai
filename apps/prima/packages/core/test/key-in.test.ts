// Key-in helper (KEY-IN, AI-AGENT-BUDGET): fill order, what is never sent, what may come back. Synthetic papers only.
import { describe, expect, it } from 'vitest';
import {
  aiOutTokens,
  keyInSnippet,
  AiBudgetMeter,
  KEY_IN_LABELS,
  KEY_IN_LOCAL_ONLY,
  RULES,
  aiAgentKinds,
  aiAgentTeam,
  aiCostUsd,
  aiPrice,
  checkKeyInOnlineOutput,
  keyInAllowed,
  keyInConfirm,
  keyInConfirmAll,
  keyInFill,
  keyInHash,
  keyInMissing,
  keyInOnlineAllowed,
  keyInOnlineInput,
  keyInReadyToSave,
  keyInRedact,
  keyInRulesRead,
  keyInStart,
  keyInValuesIn,
  type User,
} from '../src';

const user = (over: Partial<User>): User => ({ id: 'u-x', name: 'Synthetic', title: 'T', role: 'pwvsb_officer', companyIds: ['pwvsb'], siteIds: [], ...over }) as User;

const QUOTE = ['SYARIKAT CONTOH SDN BHD', 'SEBUT HARGA', 'No. Sebut Harga: SH-2026/0412', 'Tarikh: 18/11/2026', 'Sah sehingga: 18 Disember 2026', 'Sub-total RM 1,200.00', 'SST 8% RM 96.00', 'Jumlah Besar RM 1,296.00'].join('\n');

describe('who may use the key-in helper', () => {
  it('is for staff who fill forms, never guards, shared devices, system sign-ins or closed accounts', () => {
    expect(keyInAllowed(user({ department: 'finance' }))).toBe(true);
    expect(keyInAllowed(user({ role: 'company_manager', companyIds: ['c1'] }))).toBe(true);
    expect(keyInAllowed(user({ role: 'guard' }))).toBe(false);
    expect(keyInAllowed(user({ role: 'site_device' }))).toBe(false);
    expect(keyInAllowed(user({ integration: 'ja' }))).toBe(false);
    expect(keyInAllowed(user({ accessClosedFrom: '2026-11-01' }), '2026-11-23')).toBe(false);
  });
  it('never names an AI product on staff screens', () => {
    expect(JSON.stringify(KEY_IN_LABELS)).not.toMatch(/\bAI\b|Claude|GPT|OpenAI|Arisha|DeepSeek|Copilot/i);
  });
});

describe('step 3: fixed rules on the words the phone read', () => {
  it('finds the date, total, reference and validity on a quotation', () => {
    const got = Object.fromEntries(keyInRulesRead('quote', QUOTE).map((f) => [f.name, f]));
    expect(got.paperDate).toMatchObject({ value: '2026-11-18', raw: '18/11/2026', origin: 'phone' });
    expect(got.amount).toMatchObject({ value: 1296, raw: 'RM 1,296.00' });
    expect(got.ref.value).toBe('SH-2026/0412');
    expect(got.validUntil.value).toBe('2026-12-18');
  });
  it('does not take a sub-total or tax line as the total', () => {
    expect(keyInRulesRead('receipt', 'Sub-total RM 50.00\nSST RM 4.00').find((f) => f.name === 'amount')).toBeUndefined();
  });
  it('leaves a field empty when the paper gives two different answers', () => {
    expect(keyInRulesRead('permit', 'Tarikh tamat: 01/02/2027\nExpiry: 01/03/2027').find((f) => f.name === 'expiresOn')).toBeUndefined();
    expect(keyInRulesRead('permit', 'Tarikh tamat: 01/02/2027\nExpiry date 2027-02-01').find((f) => f.name === 'expiresOn')?.value).toBe('2027-02-01');
  });
  it('reads day first, refuses impossible dates, and does not read an expiry line as the paper date', () => {
    expect(keyInValuesIn('date', '03/04/2026')[0].value).toBe('2026-04-03');
    expect(keyInValuesIn('date', '31/02/2026')).toEqual([]);
    expect(keyInValuesIn('date', '2026-11-30')).toHaveLength(1);
    expect(keyInRulesRead('certificate', 'Tarikh tamat: 05/06/2027').find((f) => f.name === 'paperDate')).toBeUndefined();
  });
  it('reads litres and the total on a fuel receipt', () => {
    const got = Object.fromEntries(keyInRulesRead('fuel', 'Date 20/11/2026\nVolume 42.31\nTotal RM 86.74').map((f) => [f.name, f.value]));
    expect(got).toEqual({ paperDate: '2026-11-20', amount: 86.74, litres: 42.31 });
  });
});

describe('KDN renewal papers (AG21): months and years, read on the device only', () => {
  const read = (paper: 'statement' | 'bank-statement', text: string) => Object.fromEntries(keyInRulesRead(paper, text).map((f) => [f.name, f.value]));
  it('reads a contribution period written in words, in numbers, or as two dates', () => {
    expect(read('statement', 'PENYATA CARUMAN MAJIKAN\nBulan Caruman: Januari 2026 hingga Julai 2026')).toMatchObject({ periodFrom: '2026-01', periodTo: '2026-07' });
    expect(read('statement', 'Contribution statement\nPeriod: 01/2026 - 07/2026')).toMatchObject({ periodFrom: '2026-01', periodTo: '2026-07' });
    expect(read('statement', 'Tempoh 01/01/2026 - 31/07/2026')).toMatchObject({ periodFrom: '2026-01', periodTo: '2026-07' });
  });
  it('reads the year of a tax or accounts paper, and leaves it empty when two years are given', () => {
    expect(read('statement', 'BORANG CP204\nTahun Taksiran 2026')).toMatchObject({ year: 2026 });
    expect(read('statement', 'AUDITED FINANCIAL STATEMENTS\nFor the financial year ended 31 December 2025')).toMatchObject({ year: 2025 });
    expect(read('statement', 'Tahun 2025 dan 2026').year).toBeUndefined();
  });
  it('reads the month of a bank statement from its period, once', () => {
    expect(read('bank-statement', 'Statement Period: 01/06/2026 - 30/06/2026')).toMatchObject({ statementMonth: '2026-06' });
    expect(read('bank-statement', 'Tempoh penyata: 01/05/2026 - 30/06/2026').statementMonth).toBeUndefined();
  });
  it('does not take an impossible month or a phone number as a month or year', () => {
    expect(keyInValuesIn('month', 'Bulan 13/2026')).toEqual([]);
    expect(keyInValuesIn('year', 'Tel 03-1234 5678')).toEqual([]);
    expect(keyInValuesIn('month', 'Julai 2026').map((v) => v.value)).toEqual(['2026-07']);
  });
  it('statements and bank statements are never sent to the online reader', () => {
    expect(keyInOnlineAllowed('statement')).toBe(false);
    expect(keyInOnlineAllowed('bank-statement')).toBe(false);
  });
});

describe('fill order: never overwrite, always check', () => {
  it('keeps what was typed and what Prima held, fills only empty fields, and marks them to check', () => {
    const start = keyInStart('quote', { ref: 'MY-OWN-REF' }, { paperDate: '2026-11-01' });
    const filled = keyInFill(start, keyInRulesRead('quote', QUOTE));
    const by = Object.fromEntries(filled.map((f) => [f.name, f]));
    expect(by.ref).toMatchObject({ value: 'MY-OWN-REF', origin: 'typed', toCheck: false });
    expect(by.paperDate).toMatchObject({ value: '2026-11-01', origin: 'prima', toCheck: false });
    expect(by.amount).toMatchObject({ value: 1296, origin: 'phone', toCheck: true });
    expect(keyInReadyToSave(filled)).toBe(false);
    expect(keyInReadyToSave(keyInConfirmAll(filled))).toBe(true);
  });
  it('a corrected value becomes the person\'s own; a confirmed one keeps where it came from', () => {
    const filled = keyInFill(keyInStart('receipt'), [{ name: 'amount', value: 12.5, raw: '12.50', origin: 'helper' }]);
    expect(keyInConfirm(filled, 'amount').find((f) => f.name === 'amount')).toMatchObject({ value: 12.5, origin: 'helper', toCheck: false });
    expect(keyInConfirm(filled, 'amount', 21.5).find((f) => f.name === 'amount')).toMatchObject({ value: 21.5, origin: 'typed', raw: null, toCheck: false });
    expect(keyInMissing(keyInConfirm(filled, 'amount', null))).toContain('amount');
  });
});

describe('step 4: what may be sent', () => {
  it('never sends consent, medical, firearm, investigation, speak-up or bank statement papers', () => {
    for (const p of KEY_IN_LOCAL_ONLY) {
      expect(keyInOnlineAllowed(p)).toBe(false);
      expect(keyInOnlineInput(p, 'Tarikh 01/02/2026 some long enough words here', ['paperDate'])).toBeNull();
    }
  });
  it('sends only the empty fields, and nothing when none are empty', () => {
    expect(keyInOnlineInput('quote', QUOTE, [])).toBeNull();
    expect(keyInOnlineInput('quote', QUOTE, ['validUntil'])?.fields.map((f) => f.name)).toEqual(['validUntil']);
  });
  it('removes IC, passport, bank account, card and phone numbers and emails first, and keeps dates and amounts', () => {
    const red = keyInRedact('IC 900101-14-5678 Passport A12345678 Akaun 5123-4567-8901 Tel 012-345 6789 a@b.com\nTarikh 18/11/2026 Jumlah RM 1,296.00 2026-11-30');
    for (const secret of ['900101-14-5678', 'A12345678', '5123-4567-8901', '012-345 6789', 'a@b.com']) expect(red).not.toContain(secret);
    for (const kept of ['18/11/2026', '1,296.00', '2026-11-30']) expect(red).toContain(kept);
  });
  it('gives the same key for the same paper and fields, whatever the field order', () => {
    const a = keyInOnlineInput('quote', QUOTE, ['validUntil', 'ref'])!;
    const b = keyInOnlineInput('quote', QUOTE, ['ref', 'validUntil'])!;
    expect(keyInHash(a)).toBe(keyInHash(b));
    expect(keyInHash(a)).not.toBe(keyInHash(keyInOnlineInput('quote', QUOTE, ['ref'])!));
  });
});

describe('step 4: what may come back', () => {
  const input = keyInOnlineInput('quote', 'Harga keseluruhan kerja ialah RM 4,500.00 dan tawaran ini sah hingga hujung bulan iaitu 30/11/2026.', ['amount', 'validUntil'])!;
  it('keeps a value only when its words are on the paper and hold exactly one value of the right type', () => {
    const got = checkKeyInOnlineOutput(input, { values: [{ name: 'amount', raw: 'RM 4,500.00' }, { name: 'validUntil', raw: '30/11/2026' }] });
    expect(got).toEqual([
      { name: 'amount', value: 4500, raw: 'RM 4,500.00', origin: 'helper' },
      { name: 'validUntil', value: '2026-11-30', raw: '30/11/2026', origin: 'helper' },
    ]);
  });
  it('drops invented words, fields not asked for, unsure answers and anything that is not a value', () => {
    expect(checkKeyInOnlineOutput(input, { values: [{ name: 'amount', raw: 'RM 9,999.00' }] })).toEqual([]);
    expect(checkKeyInOnlineOutput(input, { values: [{ name: 'ref', raw: '30/11/2026' }] })).toEqual([]);
    expect(checkKeyInOnlineOutput(input, { values: [{ name: 'amount', raw: null }] })).toEqual([]);
    expect(checkKeyInOnlineOutput(input, { values: [{ name: 'validUntil', raw: 'hujung bulan' }] })).toEqual([]);
    expect(checkKeyInOnlineOutput(input, { approved: true, values: 'yes' })).toEqual([]);
    expect(checkKeyInOnlineOutput(input, null)).toEqual([]);
  });
  it('does not trust a field answered twice with different values', () => {
    const two = keyInOnlineInput('quote', 'Harga RM 100.00 atau RM 200.00 bergantung pada pilihan pelanggan.', ['amount'])!;
    expect(checkKeyInOnlineOutput(two, { values: [{ name: 'amount', raw: 'RM 100.00' }, { name: 'amount', raw: 'RM 200.00' }] })).toEqual([]);
  });
});

describe('budget and switches (AI-AGENT-BUDGET)', () => {
  it('holds the owner decision: USD 25 per agent a month, as Policy', () => {
    expect(RULES.aiAgentBudget.value.usdPerAgentPerMonth).toBe(25);
    expect(RULES.aiAgentBudget.label).toBe('Policy');
  });
  it('has every kind off unless listed', () => {
    expect(aiAgentKinds(undefined)).toEqual([]);
    expect(aiAgentKinds(' key-in, Contract-Reader ,, bad kind! ')).toEqual(['key-in', 'contract-reader']);
  });
  it('needs a real price before any call', () => {
    expect(aiPrice(undefined, '1')).toBeNull();
    expect(aiPrice('0', '1')).toBeNull();
    expect(aiPrice('abc', '1')).toBeNull();
    expect(aiCostUsd(aiPrice('0.5', '2')!, 1_000_000, 500_000)).toBeCloseTo(1.5);
  });
  it('counts one agent per team: a department, or a company office', () => {
    expect(aiAgentTeam(user({ department: 'finance' }))).toBe('dept:finance');
    expect(aiAgentTeam(user({ role: 'company_manager', companyIds: ['c2', 'c1'] }))).toBe('company:c1');
  });
  it('refuses a call that would pass the cap, per team and per month', () => {
    const m = new AiBudgetMeter(25);
    expect(m.reserve('key-in', 'dept:finance', '2026-11', 20)).toBe(true);
    expect(m.reserve('key-in', 'dept:finance', '2026-11', 6)).toBe(false);
    expect(m.reserve('key-in', 'dept:hr', '2026-11', 6)).toBe(true);
    m.settle('key-in', 'dept:finance', '2026-11', 20, 0.01);
    expect(m.spentUsd('key-in', 'dept:finance', '2026-11')).toBeCloseTo(0.01);
    expect(m.reserve('key-in', 'dept:finance', '2026-12', 20)).toBe(true);
  });
});

// Fauzan, 23 Nov 2026: "Usd 25 for each agent or helper. Make sure it use all the new technology to decrease the amount
// of token needed to work." Synthetic papers only.
describe('Fewer tokens for each online read', () => {
  const filler = Array.from({ length: 110 }, (_, i) => `Terma dan syarat perkara ${i + 1}: perkhidmatan diberikan seperti dipersetujui oleh kedua-dua pihak.`);
  const LONG = ['SEBUT HARGA (mock)', ...filler.slice(0, 55), 'Sah sehingga', '30/11/2026', ...filler.slice(55), 'Jumlah besar RM 4,500.00'].join('\n');

  it('sends only the lines near the empty fields, not the whole paper', () => {
    const s = keyInSnippet('quote', LONG, ['validUntil']);
    expect(s).toContain('Sah sehingga\n30/11/2026');
    expect(s.length).toBeLessThan(200);
    expect(LONG.length).toBeGreaterThan(9_000);
    const input = keyInOnlineInput('quote', LONG, ['validUntil', 'amount'])!;
    expect(input.text).toContain('30/11/2026');
    expect(input.text).toContain('RM 4,500.00');
    expect(input.text.length).toBeLessThanOrEqual(2_500);
  });

  it('a paper with no field words still sends only a short part', () => {
    expect(keyInSnippet('quote', filler.join('\n'), ['ref']).length).toBeLessThanOrEqual(2_500);
  });

  it('counts cached sent tokens at the lower price, only when the price sheet gives one', () => {
    const full = aiPrice('0.4', '1.6')!;
    expect(full.usdPerMTokCached).toBe(0.4);
    const cached = aiPrice('0.4', '1.6', '0.1')!;
    expect(aiCostUsd(cached, 1_000_000, 0, 800_000)).toBeCloseTo(0.2 * 0.4 + 0.8 * 0.1);
    expect(aiCostUsd(full, 1_000_000, 0, 800_000)).toBeCloseTo(0.4);
    // A cached price above the full price is a typing mistake: the full price is used.
    expect(aiPrice('0.4', '1.6', '5')!.usdPerMTokCached).toBe(0.4);
  });

  it('asks for only as much answer as the fields need', () => {
    expect(aiOutTokens(1)).toBe(70);
    expect(aiOutTokens(3)).toBe(150);
    expect(aiOutTokens(50)).toBe(400);
  });
});

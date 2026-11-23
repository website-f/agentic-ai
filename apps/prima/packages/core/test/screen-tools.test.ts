// Upload, Key in and Download on every screen (Fauzan, 23 Nov 2026). Synthetic data only.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  EXPORT_RULE,
  MemoryStore,
  PrimaService,
  RECORD_KINDS,
  SCREEN_TOOLS,
  exportAllowed,
  exportCsv,
  exportPdf,
  exportSensitivity,
  exportXlsx,
  generateDataset,
  myt,
  type RecordKind,
} from '../src';

const TODAY = '2026-11-23';
const NOW = myt(TODAY, '10:30');
const setup = () => {
  const ds = generateDataset({ today: TODAY, now: NOW });
  return { ds, svc: new PrimaService(new MemoryStore(ds), () => NOW) };
};

/** Files inside a stored (uncompressed) or deflated ZIP, by name. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const b = Buffer.from(bytes);
  const out = new Map<string, string>();
  let i = 0;
  while (b.readUInt32LE(i) === 0x04034b50) {
    const method = b.readUInt16LE(i + 8);
    const size = b.readUInt32LE(i + 18);
    const nameLen = b.readUInt16LE(i + 26);
    const extra = b.readUInt16LE(i + 28);
    const name = b.subarray(i + 30, i + 30 + nameLen).toString();
    const data = b.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    out.set(name, (method === 8 ? inflateRawSync(data) : data).toString());
    i += 30 + nameLen + extra + size;
  }
  return out;
}

describe('screen tools: every screen is covered', () => {
  it('has an entry for every screen in the menu, and no entry for a screen that does not exist', () => {
    const app = readFileSync(new URL('../../../apps/web/src/App.tsx', import.meta.url), 'utf8');
    const union = /export type ViewName =([^;]+);/.exec(app)![1];
    const views = [...union.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(views.length).toBeGreaterThan(80);
    expect(Object.keys(SCREEN_TOOLS).sort()).toEqual(views);
  });

  it('puts each record form on a screen that the record engine says holds it', () => {
    for (const [screen, t] of Object.entries(SCREEN_TOOLS)) for (const k of t.records ?? []) expect(RECORD_KINDS[k as RecordKind], `${screen}: ${k}`).toBeTruthy();
    // Every record kind has a Key in place somewhere.
    const placed = new Set(Object.values(SCREEN_TOOLS).flatMap((t) => t.records ?? []));
    const missing = (Object.keys(RECORD_KINDS) as RecordKind[]).filter((k) => !placed.has(k));
    expect(missing).toEqual([]);
  });
});

describe('screen tools: sensitive downloads', () => {
  it('reads sensitivity from the tab first, then the screen', () => {
    expect(exportSensitivity('staffpay', 'Pay runs')).toBe('pay');
    expect(exportSensitivity('finance', 'Banking')).toBe('bank');
    expect(exportSensitivity('claims', 'My claims')).toBe('medical');
    expect(exportSensitivity('grc', 'Speak up')).toBe('speakup');
    expect(exportSensitivity('grc', 'Gifts')).toBe(null);
    expect(exportSensitivity('arms', '')).toBe('firearms');
    expect(exportSensitivity('people', 'Medical leave')).toBe('medical');
    expect(exportSensitivity('sites', 'Posts')).toBe(null);
  });

  it('logs every download, asks a reason for sensitive data, and keeps speak-up lists to their handlers', async () => {
    const { ds, svc } = setup();
    const cm = await svc.user('u-cm-sasa');
    const plain = await svc.exports.log(cm, { screen: 'sites', tab: 'Posts', format: 'xlsx', rows: 12, companyId: cm.companyIds[0] });
    expect((await svc.exports.log(cm, { screen: 'sites', format: 'csv', rows: 2 })).ref).toMatch(/^EXP-/);
    expect(plain.ref).toMatch(/^EXP-20261123-[0-9A-F]{6}$/);
    expect(plain.sensitivity).toBe(null);
    const hr = await svc.user('u-pwvsb-hr');
    await expect(svc.exports.log(hr, { screen: 'staffpay', tab: 'Pay runs', format: 'pdf', rows: 3 })).rejects.toThrow(/Say why/);
    await expect(svc.exports.log(hr, { screen: 'staffpay', tab: 'Pay runs', format: 'pdf', rows: 3, reason: 'short' })).rejects.toThrow(/Say why/);
    const pay = await svc.exports.log(hr, { screen: 'staffpay', tab: 'Pay runs', format: 'pdf', rows: 3, reason: 'November payroll check for HR Director' });
    expect(pay.sensitivity).toBe('pay');
    // Speak-up: HR handles reports; a company manager does not.
    expect(exportAllowed(cm, 'grc', 'Speak up')).toBe(false);
    await expect(svc.exports.log(cm, { screen: 'grc', tab: 'Speak up', format: 'xlsx', rows: 1, reason: 'I want the whole list' })).rejects.toThrow(/Not allowed/);
    expect(exportAllowed(hr, 'grc', 'Speak up')).toBe(true);
    // Unknown screens, the site device, bad formats and huge files are refused; integrations never download.
    await expect(svc.exports.log(cm, { screen: 'nope', format: 'xlsx', rows: 1 })).rejects.toThrow(/no download/);
    await expect(svc.exports.log(cm, { screen: 'device', format: 'xlsx', rows: 1 })).rejects.toThrow(/no download/);
    await expect(svc.exports.log(cm, { screen: 'sites', format: 'docx', rows: 1 })).rejects.toThrow(/Excel, CSV or PDF/);
    await expect(svc.exports.log(cm, { screen: 'sites', format: 'xlsx', rows: EXPORT_RULE.maxRows + 1 })).rejects.toThrow(/at most/);
    await expect(svc.exports.log(cm, { screen: 'sites', format: 'xlsx', rows: 1.5 })).rejects.toThrow(/at most/);
    const feed = ds.users.find((u) => u.integration)!;
    expect(exportAllowed(feed, 'sites', '')).toBe(false);
    // A company the person has no access to is not written on the log line.
    await svc.exports.log(cm, { screen: 'sites', format: 'xlsx', rows: 1, companyId: 'co-not-mine' });
    const lines = ds.audit.filter((a) => a.action === 'export.download');
    expect(lines.length).toBe(4);
    expect(lines[0].summary).toContain('Downloaded Excel of sites / Posts: 12 rows.');
    expect(lines[0].companyId).toBe(cm.companyIds[0]);
    expect(lines[1].summary).toContain('Downloaded CSV of sites: 2 rows.');
    expect(lines[2].summary).toContain('Sensitive (pay). Reason: November payroll check for HR Director');
    expect(lines[2].summary).toContain(pay.ref);
    expect(lines[3].companyId).toBe(null);
  });
});

describe('screen tools: files', () => {
  const stamp = { title: 'Sites · Posts', ref: 'EXP-20261123-ABC123', at: NOW, by: 'Test Person', sensitivity: 'pay' as const };

  it('makes an Excel workbook with the stamp, keeps IC and phone numbers as text, and never writes a formula', () => {
    const x = unzip(
      exportXlsx(
        [
          { name: 'Posts', header: ['Name', 'Guards', 'IC', 'Note'], rows: [['Gate <A>', '2', '900101015555', '=HYPERLINK("x")'], ['Lobby', '1,250.50', '0123456789', '']] },
          { name: 'Posts', header: ['Other'], rows: [] },
        ],
        stamp,
      ),
    );
    expect([...x.keys()]).toContain('xl/worksheets/sheet2.xml');
    const wb = x.get('xl/workbook.xml')!;
    expect(wb).toContain('name="Posts"');
    expect(wb).toContain('name="Posts 2"');
    const s1 = x.get('xl/worksheets/sheet1.xml')!;
    expect(s1).toContain('Ref EXP-20261123-ABC123');
    expect(s1).toContain('SULIT / CONFIDENTIAL: pay data');
    expect(s1).toContain('Gate &lt;A&gt;');
    expect(s1).toContain('<v>2</v>');
    expect(s1).toContain('<v>1250.5</v>');
    expect(s1).toContain('>900101015555<');
    expect(s1).toContain('>0123456789<');
    expect(s1).not.toContain('<f>');
    expect(s1).toContain('=HYPERLINK(&quot;x&quot;)');
  });

  it('makes a CSV another system can read: no stamp, quoted where needed, no formulas', () => {
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(exportCsv([{ name: 'EPF', header: ['Name', 'IC', 'Amount', 'Note'], rows: [['Ali, bin Abu', '900101015555', '-12.50', '=SUM(A1)'], ['Siti "Ct"', '0123', '1250', '@x']] }]));
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual(['Name,IC,Amount,Note', `"Ali, bin Abu",900101015555,-12.50,'=SUM(A1)`, `"Siti ""Ct""",0123,1250,'@x`, '']);
    const two = new TextDecoder().decode(exportCsv([{ name: 'A', header: ['x'], rows: [['1']] }, { name: 'B', header: ['y'], rows: [] }]));
    expect(two).toContain('A\r\nx\r\n1\r\n\r\nB\r\ny');
  });

  it('makes a PDF with the stamp and each row', () => {
    const pdf = Buffer.from(exportPdf([{ name: 'Posts', header: ['Name', 'Guards'], rows: [['Gate', '2']] }], { ...stamp, sensitivity: null })).toString('latin1');
    expect(pdf.startsWith('%PDF')).toBe(true);
    expect(pdf).toContain('EXP-20261123-ABC123');
    expect(pdf).toContain('1. Name: Gate');
    expect(pdf).toContain('Guards: 2');
  });
});

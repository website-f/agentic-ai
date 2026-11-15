import { describe, expect, it } from 'vitest';
import { RECORD_KINDS, applyImportMapping, bulkHelperAiBrief, parseCsv, suggestFiling, suggestImportMapping } from '../src';

// K8 / N2 (Fauzan, 11 Nov 2026): the data manager and file manager only suggest; the person confirms. Synthetic data.
describe('data manager (bulk load columns)', () => {
  it('places columns on fields by heading and value shape, leaves the unknown for the person, and rewrites the file', () => {
    const site = RECORD_KINDS.site.fields;
    const nameField = site.find((f) => /name/i.test(f.key))!;
    const csv = [`Nama Tapak,${site.find((f) => f.type === 'select')?.label ?? 'Kind'},Remarks xyz`, 'Sample Site A,x,hello', 'Sample Site A,x,hello'].join('\n');
    const table = parseCsv(csv);
    const s = suggestImportMapping(table, 'site');
    expect(s.best.kind).toBe('site');
    expect(s.best.columns[0].fieldKey).toBe(nameField.key);
    expect(s.best.columns[2].fieldKey).toBeNull();
    expect(s.rowFlags.some((r) => r.row === 3 && /Same as row 2/.test(r.problems[0]))).toBe(true);
    const out = applyImportMapping(table, s.best.columns.map((c) => c.fieldKey));
    expect(out.split('\n')[0]).toBe([nameField.key, s.best.columns[1].fieldKey].filter(Boolean).join(','));
    expect(() => applyImportMapping(table, [nameField.key, nameField.key, null])).toThrow(/same field/);
  });

  it('the AI brief carries headings and value shapes, never the values', () => {
    const table = parseCsv('Name,IC,Phone,Start\nSample Person,900101-01-1234,012-3456789,2026-01-01');
    const b = bulkHelperAiBrief(table);
    const text = JSON.stringify(b);
    expect(text).not.toMatch(/Sample Person|900101|3456789/);
    expect(b.shapes[1]).toEqual(['id']);
  });
});

describe('file manager (many papers at once)', () => {
  it('finds the person by staff number or full name and the paper by its words; holds the rest', () => {
    const people = [{ id: 'p1', name: 'Sample Worker One', staffNo: 'SS-0001' }, { id: 'p2', name: 'Sample Worker Two', staffNo: 'SS-0002' }];
    const r = suggestFiling(['SS-0001 perjanjian kerja.pdf', 'Sample Worker Two vetting.pdf', 'scan123.pdf', 'SS0002_passport.jpg'], people);
    expect(r[0]).toMatchObject({ personId: 'p1', kind: 'AGREEMENT', confidence: 'sure', direct: true });
    expect(r[1]).toMatchObject({ personId: 'p2', kind: 'VETTING_CERT', confidence: 'unsure' });
    expect(r[2]).toMatchObject({ personId: null, kind: 'OTHER', confidence: 'none' });
    expect(r[3]).toMatchObject({ personId: 'p2', kind: 'PASSPORT', direct: false });
  });
});

import { describe, expect, it } from 'vitest';
import { generateDataset, myt } from '../src';
describe('combined synthetic seed identities', () => {
  it('has one row per primary key across every generated collection', () => {
    const data = generateDataset({ today: '2026-11-07', now: myt('2026-11-07', '10:00'), daysBack: 2 });
    for (const [table, rows] of Object.entries(data)) {
      if (!Array.isArray(rows)) continue;
      const ids = rows.filter((row: unknown) => row != null && typeof row === 'object' && 'id' in row).map((row: { id: string }) => row.id);
      expect(ids.length, `${table}: duplicate synthetic primary keys`).toBe(new Set(ids).size);
    }
  });
});

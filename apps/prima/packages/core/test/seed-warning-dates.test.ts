import { describe, expect, it } from 'vitest';
import { generateDataset } from '../src/seed';

// The Nepali test guard's verbal warning must be seeded on every date: the HR appeal browser journey signs in as that
// guard and looks for it. It used to be missing whenever two days ago was the guard's rest day.
describe('seed: test guard warning does not depend on the date', () => {
  it('is present for 14 days in a row', () => {
    for (let d = 14; d <= 27; d++) {
      const today = `2026-11-${d}`;
      const ds = generateDataset({ today, now: `${today}T02:00:00.000Z`, daysBack: 40 });
      const hit = ds.attendanceFollowUps.filter((f) => f.note.startsWith('Left the post 40 minutes'));
      expect(hit.length, today).toBe(1);
    }
  }, 120_000);
});

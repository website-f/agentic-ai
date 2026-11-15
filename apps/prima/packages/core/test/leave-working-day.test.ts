import { describe, expect, it } from 'vitest';
import { workingDayDeadlines } from '../src/hr-leave';

// C3 (Fauzan, 11 Nov 2026): a guard's leave request moves up one level per working day; weekends and public
// holidays do not count.
describe('C3: guard leave moves up one level per working day', () => {
  it('skips the weekend', () => {
    // Friday 13 Nov 2026, 10:00: the next level starts Monday 10:00, then Tuesday 10:00.
    expect(workingDayDeadlines('2026-11-13T10:00:00+08:00', new Set(), 2)).toEqual(['2026-11-16T10:00:00+08:00', '2026-11-17T10:00:00+08:00']);
  });
  it('skips a public holiday', () => {
    expect(workingDayDeadlines('2026-11-16T09:00:00+08:00', new Set(['2026-11-17']), 1)).toEqual(['2026-11-18T09:00:00+08:00']);
  });
  it('a request made on a day off starts at the next working day', () => {
    // Saturday: the clock starts Monday 00:00, so the first level ends Tuesday 00:00.
    expect(workingDayDeadlines('2026-11-14T15:00:00+08:00', new Set(), 1)).toEqual(['2026-11-17T00:00:00+08:00']);
  });
});

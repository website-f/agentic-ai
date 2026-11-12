import { describe, expect, it } from 'vitest';
import { RULES, evaluateClockIn, evaluateClockOut, myt, type Shift, type Site } from '../src';

// P100 G5 (Fauzan, 11 Nov 2026): clock-in grace and early clock-out grace 15 -> 10 minutes; rest between shifts stays 8 h.
const date = '2026-11-12';
const shift = { id: 'sh1', companyId: 'c1', siteId: 's1', postId: 'p1', personId: 'g1', date, start: myt(date, '07:00'), end: myt(date, '19:00'), status: 'published' } as Shift;
const site = { id: 's1', companyId: 'c1', lat: 3.1, lng: 101.6, geofenceM: 200 } as unknown as Site;
const inAt = (hhmm: string) => evaluateClockIn({ shift, site, at: myt(date, hhmm), receivedAt: myt(date, hhmm), lat: 3.1, lng: 101.6, face: { score: 0.9, live: true }, faceEnrolled: true });

describe('P100 G5: grace is 10 minutes both ways', () => {
  it('the rule values and their approval', () => {
    expect(RULES.lateGraceMin.value).toBe(10);
    expect(RULES.earlyLeaveGraceMin.value).toBe(10);
    expect(RULES.minRestHours.value).toBe(8);
    expect(RULES.lateGraceMin.source).toMatch(/Approved by Fauzan, 11 Nov 2026/);
  });
  it('11 minutes late is late; 10 minutes is not', () => {
    expect(inAt('07:10').flags).not.toContain('LATE');
    expect(inAt('07:11').flags).toContain('LATE');
  });
  it('leaving 11 minutes early is early; 10 minutes is not', () => {
    expect(evaluateClockOut(shift, myt(date, '18:50'))).not.toContain('EARLY_LEAVE');
    expect(evaluateClockOut(shift, myt(date, '18:49'))).toContain('EARLY_LEAVE');
  });
});

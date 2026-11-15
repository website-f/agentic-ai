// G5 (Fauzan, 11 Nov 2026): clock-in and early clock-out grace are 10 minutes. Synthetic shift only.
import { describe, expect, it } from 'vitest';
import { evaluateClockIn, evaluateClockOut, RULES } from '../src';

const shift = { start: '2026-11-18T08:00:00+08:00', end: '2026-11-18T20:00:00+08:00' } as never;
const site = { lat: 3, lng: 101, geofenceM: 100 } as never;
const at = (t: string) => `2026-11-18T${t}:00+08:00`;
const clockIn = (t: string) => evaluateClockIn({ shift, site, at: at(t), receivedAt: at(t), lat: 3, lng: 101, face: null, faceEnrolled: false }).flags;

describe('G5 grace of 10 minutes', () => {
  it('uses 10 minutes for both rules', () => {
    expect(RULES.lateGraceMin.value).toBe(10);
    expect(RULES.earlyLeaveGraceMin.value).toBe(10);
  });
  it('10 minutes late is not late; 11 minutes is', () => {
    expect(clockIn('08:10')).not.toContain('LATE');
    expect(clockIn('08:11')).toContain('LATE');
  });
  it('leaving 10 minutes early is fine; 11 minutes early is an early leave', () => {
    expect(evaluateClockOut(shift, at('19:50'))).toEqual([]);
    expect(evaluateClockOut(shift, at('19:49'))).toEqual(['EARLY_LEAVE']);
  });
});

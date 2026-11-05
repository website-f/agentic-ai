import { describe, expect, it } from 'vitest';
import { ACT_GUIDE_CARDS, generateDataset } from '../src';

const users = generateDataset({ today: '2026-11-02', now: '2026-11-02T10:00:00+08:00' }).users;

describe('ACT guide cards (shared format)', () => {
  it('every card has BM and English, says what is entered once, and names a source and whom to ask (no named person)', () => {
    // The full shared checks (guideCardProblems) run at the combined merge with #56.
    for (const c of ACT_GUIDE_CARDS) {
      const texts = [c.title, c.purpose, c.who, c.screen.action, c.enteredOnce, ...Object.values(c.steps), ...c.sources.map((s) => s.what), ...c.notVerified];
      for (const x of texts) expect(x.bm.trim() && x.en.trim()).toBeTruthy();
      expect(c.enteredOnce.en.length).toBeGreaterThanOrEqual(20);
      expect(c.sources.length).toBeGreaterThan(0);
      for (const s of c.sources) {
        expect(s.askDesk !== null || !!s.askName?.trim()).toBe(true);
        expect(s.askName ?? '').not.toMatch(/bin |binti |a\/l /);
      }
      expect(c.notVerified.length).toBeGreaterThan(0);
    }
    expect(new Set(ACT_GUIDE_CARDS.map((c) => c.id)).size).toBe(ACT_GUIDE_CARDS.length);
  });

  it('shows each card only to the jobs the service lets do the task', () => {
    const ids = (id: string) => {
      const u = users.find((x) => x.id === id)!;
      return ACT_GUIDE_CARDS.filter((c) => c.allowed(u)).map((c) => c.id).sort();
    };
    expect(ids('u-audit')).toEqual(['act.check', 'act.field_check', 'act.follow_up', 'act.investigation', 'act.timing.set', 'act.work.done']);
    expect(ids('u-act-aud1')).toEqual(['act.check', 'act.field_check', 'act.follow_up', 'act.investigation', 'act.work.done']);
    expect(ids('u-act-enf2')).toEqual(['act.field_check', 'act.follow_up']);
    expect(ids('u-cm-sasa')).toEqual(['act.owner.fix', 'act.owner.plan']);
  });
});

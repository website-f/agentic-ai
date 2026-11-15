import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, generateDataset, myt, trainerAnswer, trainerWalkThrough } from '../src';

// K9 / N3 (Fauzan, 11 Nov 2026): Arisha trains staff from their own guide cards only. Synthetic data.
const TODAY = '2026-11-05';
const svc = new PrimaService(new MemoryStore(generateDataset({ today: TODAY, now: myt(TODAY, '10:00') })), () => myt(TODAY, '10:00'));

describe('in-app trainer', () => {
  it('answers from the person\'s own cards and refuses another department\'s task', async () => {
    const it1 = svc.guideCards(await svc.user('u-it-ex1'));
    const hr = svc.guideCards(await svc.user('u-pwvsb-hr'));
    const own = hr.cards[0];
    const a = trainerAnswer(hr.cards, `How do I ${own.title.en}?`);
    expect(a.found).toBe(true);
    expect(a.steps[0].cardId).toBe(own.id);
    expect(a.reply.bm).toMatch(/langkah/);
    // A task only HR has, asked by IT staff: refused, nothing about it shown.
    const hrOnly = hr.cards.find((c) => !it1.cards.some((x) => x.id === c.id))!;
    const r = trainerAnswer(it1.cards, hrOnly.title.en);
    expect(r.steps.some((s) => s.cardId === hrOnly.id)).toBe(false);
    expect(trainerAnswer(it1.cards, 'zzzz qqqq').found).toBe(false);
    expect(trainerWalkThrough(hr.cards).length).toBeGreaterThan(0);
  });
});

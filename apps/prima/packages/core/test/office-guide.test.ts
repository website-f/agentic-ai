// Office guide cards must match the real screens and service messages (Arisha main review, section A), follow the
// shared guide-card rules of PR #56 (BM + English, entered-once, desk or record keepers to ask, notVerified), and be
// scoped by the server's own permission rules. Synthetic examples only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OFFICE_GUIDE, officeGuideFor } from '../src/office-guide';
import { generateDataset, myt } from '../src';

const root = join(__dirname, '..', '..', '..');
const src = ['apps/web/src/views/Office.tsx', 'apps/web/src/views/Commercial.tsx', 'packages/core/src/service.ts', 'packages/core/src/access.ts']
  .map((f) => readFileSync(join(root, f), 'utf8'))
  .join('\n');

// A quoted phrase with "…" stands for a filled-in name; each fixed part must exist.
const quoted = (s: string) =>
  [...s.matchAll(/"([^"]+)"/g)].flatMap((m) =>
    m[1]
      .split('…')
      .map((x) => x.trim())
      .filter(Boolean),
  );

describe('company office guide cards', () => {
  it('every text has Bahasa Melayu and English; entered-once, a source and whom to ask are filled', () => {
    for (const c of OFFICE_GUIDE) {
      const texts = [c.title, c.purpose, c.who, c.screen.action, c.enteredOnce, ...Object.values(c.steps), ...c.sources.map((s) => s.what), ...c.notVerified];
      for (const v of texts) {
        expect(v.bm.trim().length, c.id).toBeGreaterThan(0);
        expect(v.en.trim().length, c.id).toBeGreaterThan(0);
      }
      expect(c.enteredOnce.en.length, c.id).toBeGreaterThanOrEqual(20);
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      for (const s of c.sources) expect(s.askDesk !== null || !!s.askName?.trim(), c.id).toBe(true);
      expect(new Set(OFFICE_GUIDE.map((x) => x.id)).size).toBe(OFFICE_GUIDE.length);
    }
  });

  it('every quoted button, label or message, and every field label, exists in the current screens or service', () => {
    const titles = new Set(OFFICE_GUIDE.map((c) => c.title.en)); // a card may point to another card
    for (const c of OFFICE_GUIDE) {
      const texts = [c.screen.action.en, ...Object.values(c.steps).map((s) => s.en), ...(c.fields ?? []).map((f) => f.format.en)];
      for (const q of texts.flatMap(quoted)) if (!titles.has(q)) expect(src, `${c.id}: "${q}"`).toContain(q);
      for (const f of c.fields ?? []) expect(src, `${c.id}: field ${f.label}`).toContain(f.label);
    }
  });

  it('is scoped by the server permission rules: executives never get approval cards, leaders only the monitor card', () => {
    const users = generateDataset({ today: '2026-11-02', now: myt('2026-11-02', '10:00') }).users;
    const user = (id: string) => users.find((u) => u.id === id)!;
    const ids = (id: string) => OFFICE_GUIDE.filter((c) => c.allowed(user(id))).map((c) => c.id);
    expect(ids('u-ae-sasa')).not.toContain('office.quotation.review');
    expect(ids('u-ae-sasa')).not.toContain('office.desks');
    expect(ids('u-ae-sasa')).toContain('office.quotation.correct');
    expect(ids('u-gm-sasa')).toEqual(expect.arrayContaining(['office.desks', 'office.quotation.review']));
    const ceo = users.find((u) => u.role === 'director' && /Chief Executive/.test(u.title ?? ''))!;
    expect(OFFICE_GUIDE.filter((c) => c.allowed(ceo)).map((c) => c.id)).toEqual(['office.monitor']);
    expect(officeGuideFor('monitor').map((c) => c.id)).toEqual(['office.monitor']);
    expect(officeGuideFor('exec').map((c) => c.id)).not.toContain('office.quotation.review');
    expect(officeGuideFor(null)).toEqual([]);
  });
});

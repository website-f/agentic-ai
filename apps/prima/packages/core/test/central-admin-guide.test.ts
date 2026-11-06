import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AccessDenied, CENTRAL_ADMIN_GUIDE, CENTRAL_ADMIN_GUIDE_SPECS, MemoryStore, PrimaService, centralAdminGuideFor, generateDataset, myt } from '../src';

// Guide cards (Arisha main review, section A): role-scoped, BM and English, and every button they name exists on a
// screen today. Dummy data only.
const views = resolve(__dirname, '../../../apps/web/src/views');
const screens =
  readdirSync(views)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => readFileSync(resolve(views, f), 'utf8'))
    .join('\n') + readFileSync(resolve(__dirname, '../src/service.ts'), 'utf8');
const svc = new PrimaService(new MemoryStore(generateDataset({ today: '2026-11-02', now: myt('2026-11-02', '10:00') })), () => myt('2026-11-02', '10:00'));

describe('Central Admin guide cards', () => {
  it('has Bahasa Melayu and English for every text, and a synthetic example for every field', () => {
    for (const c of CENTRAL_ADMIN_GUIDE) {
      for (const k of ['title', 'purpose', 'responsible', 'where', 'source', 'ask', 'reuse', 'returned', 'evidence', 'recover', 'limits'] as const) {
        expect(c[k].ms.length, `${c.id}.${k}.ms`).toBeGreaterThan(2);
        expect(c[k].en.length, `${c.id}.${k}.en`).toBeGreaterThan(2);
      }
      for (const f of c.fields) expect(f.example.length, `${c.id} example`).toBeGreaterThan(0);
      // Synthetic examples only: anything that looks like a reference says (mock), and no personal names appear.
      expect(JSON.stringify(c)).not.toMatch(/@|\+60|\b\d{6}-\d{2}-\d{4}\b/);
    }
  });

  it('names only buttons, tabs and messages that exist in the screens and service today', () => {
    for (const c of CENTRAL_ADMIN_GUIDE)
      for (const text of [c.where.en, c.returned.en, c.recover.en, ...c.steps.map((s) => s.en)])
        for (const [, label] of text.matchAll(/"([^"]+)"/g)) expect(screens.includes(label), `${c.id}: "${label}"`).toBe(true);
  });

  it('gives each person only the cards for their own roles', async () => {
    const ids = async (uid: string) => centralAdminGuideFor(await svc.user(uid)).cards.map((c) => c.id);
    expect(await ids('u-cm-sasa')).toEqual(expect.arrayContaining(['company-file-draft', 'renewal', 'task-finish']));
    expect(await ids('u-cm-sasa')).not.toContain('company-file-check');
    expect(await ids('u-cm-sasa')).not.toContain('legal-flags');
    expect(await ids('u-cm-sasa')).not.toContain('credit-loan');
    expect(await ids('u-dcos')).toEqual(expect.arrayContaining(['company-file-check', 'panel-firm', 'legal-flags']));
    expect(await ids('u-credit')).toContain('credit-loan');
    expect(await ids('u-credit')).not.toContain('legal-flags');
    expect(await ids('u-pwvsb-doa')).toContain('director-office-lists');
    expect(await ids('u-bm-sasa-1')).toEqual(expect.arrayContaining(['renewal']));
    expect(await ids('u-bm-sasa-1')).not.toContain('company-file-draft');
    expect(await ids('u-fwm-ex1')).toEqual(['task-finish']);
    expect(centralAdminGuideFor(await svc.user('u-cm-sasa'), 'credit').cards).toEqual([]);
  });
});

describe('Central Admin cards in the shared guide-card format (PR #56)', () => {
  const texts = (c: (typeof CENTRAL_ADMIN_GUIDE_SPECS)[number]) => [
    c.title,
    c.purpose,
    c.who,
    c.screen.action,
    c.enteredOnce,
    ...Object.values(c.steps),
    ...c.sources.map((s) => s.what),
    ...c.notVerified,
    ...(c.fields ?? []).map((f) => f.format),
  ];
  it('has BM and English everywhere, says what is entered once, and asks a desk or the record keepers, never a person', () => {
    expect(new Set(CENTRAL_ADMIN_GUIDE_SPECS.map((c) => c.id)).size).toBe(CENTRAL_ADMIN_GUIDE_SPECS.length);
    for (const c of CENTRAL_ADMIN_GUIDE_SPECS) {
      for (const x of texts(c)) {
        expect(x.bm.trim().length, `${c.id} bm`).toBeGreaterThan(0);
        expect(x.en.trim().length, `${c.id} en`).toBeGreaterThan(0);
      }
      expect(c.enteredOnce.en.length, c.id).toBeGreaterThanOrEqual(20);
      expect(c.sources.length, c.id).toBeGreaterThan(0);
      for (const s of c.sources) expect(s.askDesk !== null || !!s.askName?.trim(), c.id).toBe(true);
    }
  });

  it('shows a card exactly to the people the service lets do the task', async () => {
    const card = (id: string) => CENTRAL_ADMIN_GUIDE_SPECS.find((c) => c.id === `central-admin.${id}`)!;
    const can = async (fn: () => Promise<unknown>) =>
      fn().then(
        () => true,
        (e) => !(e instanceof AccessDenied),
      );
    for (const id of ['u-cm-sasa', 'u-dcos', 'u-credit', 'u-pwvsb-doa', 'u-fauzan', 'u-bm-sasa-1', 'u-cosec', 'u-fwm-ex1', 'u-legal', 'u-fd', 'u-cos']) {
      const u = await svc.user(id);
      // Masterplan cards (3 Nov 2026): the service rejects on role before anything else, so a bad input shows the role.
      expect(card('kpkt-check').allowed(u), `${id} kpkt`).toBe(await can(() => svc.creditCheckLenderLicence(u, 'no-such-loan', { ref: '', validTo: '', note: '' })));
      expect(card('delegations').allowed(u), `${id} delegations`).toBe(
        await can(() => svc.addDelegation(u, u.role === 'company_manager' ? u.companyIds[0] : 'pwvsb', { kind: 'BOGUS' as never } as never)),
      );
      expect(card('adviser-money').allowed(u), `${id} adviser money`).toBe(
        await can(async () => {
          const b = await svc.panelBoard(u).catch(() => null);
          if (!b || !(b.canKeep.AUDIT || b.canKeep.LAW || b.canAgreeBudget)) throw new AccessDenied('view', 'x');
        }),
      );
      expect(card('credit-loan').allowed(u), `${id} credit`).toBe(
        await can(async () => {
          if (!(await svc.creditBoard(u)).roles.includes('officer')) throw new AccessDenied('view', 'x');
        }),
      );
      expect(card('legal-flags').allowed(u), `${id} legal flags`).toBe(await can(() => svc.directorLegalFlags(u)));
      expect(card('director-office-lists').allowed(u), `${id} director office`).toBe(
        await can(async () => {
          if (!(await svc.reports(u).catch(() => ({ editList: undefined }))).editList) throw new AccessDenied('view', 'x');
        }),
      );
      expect(card('company-file-check').allowed(u), `${id} check`).toBe(
        await can(async () => {
          const rows = await svc.companyFiles(u).catch(() => []);
          // The checker role: the corporate owner (the service still refuses checking one's own draft). P78: the owner
          // keeps the panel lists too, so the corporate role itself is asked, not the panel.
          if (!rows.length || !(await svc.corpBoard(u).catch(() => null))?.roles.includes('owner')) throw new AccessDenied('view', 'x');
        }),
      );
    }
  });
});

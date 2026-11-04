import { describe, expect, it } from 'vitest';
import { MemoryStore, PrimaService, ReviewConflict, generateDataset, myt, sha256Hex, type AuditEntry } from '../src';

// Arisha's reviewed handoff into the T9 import (Fauzan, 31 Oct 2026). Dummy rows only.
const TODAY = '2026-10-31';
const START = myt(TODAY, '10:00');
const OTHERS = ['u-fd', 'u-coo', 'u-audit', 'u-it-mgr', 'u-it-lead'];
const SOURCE = 'UAT note: printer UAT-JAM-77 on floor 3 is jammed, raised by UAT Staff A over Teams, urgency P2.';

function fresh() {
  const ds = generateDataset({ today: TODAY, now: START });
  const clock = { now: START };
  const store = new MemoryStore(ds);
  const svc = new PrimaService(store, () => clock.now);
  return { ds, store, svc, clock };
}

let n = 0;
/** An extraction the CEO ran, as Arisha's extraction service audits it. */
async function extraction(store: MemoryStore, opts: { actor?: string; outcome?: string; kind?: string; text?: string; at?: string } = {}) {
  n += 1;
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const text = opts.text ?? SOURCE;
  await store.audit({
    at: opts.at ?? START,
    actor: opts.actor ?? 'u-fauzan',
    companyId: null,
    action: 'arisha.extraction.terminal',
    entity: 'arisha_extraction',
    entityId: id,
    summary: JSON.stringify({ sourceSha256: sha256Hex(text), sourceLength: text.length, kind: opts.kind ?? 'tickets', selfDeclaredDataClass: 'synthetic', consentVersion: 'it-extraction-v1', outcome: opts.outcome ?? 'success' }),
  });
  return { id, text };
}

const at = (text: string, s: string) => ({ start: text.indexOf(s), end: text.indexOf(s) + s.length });

function ticketPart(ex: { id: string; text: string }, title = 'UAT printer UAT-JAM-77 jammed') {
  return {
    extractionId: ex.id,
    source: { label: 'UAT Teams note', sha256: sha256Hex(ex.text), canonicalText: ex.text },
    rows: [
      {
        fields: { title, category: 'device', priority: 'P2', requester: 'UAT Staff A', channel: 'Teams', raisedOn: null, detail: null, itPerson: 'u-it-ex1' },
        evidence: { priority: at(ex.text, 'P2'), requester: at(ex.text, 'UAT Staff A'), channel: at(ex.text, 'Teams') },
      },
    ],
  };
}

describe('Arisha reviewed handoff into the T9 import', () => {
  it('keeps the review, not the source text, and previews through T9', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const out = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    expect(out.review.status).toBe('reviewing');
    expect(out.review.version).toBe(1);
    expect(out.preview?.ready).toBe(1);
    expect(out.preview?.rows[0].sourceRef).toMatch(/^Arisha review [0-9a-f]{8}: UAT Teams note, row 2$/);
    // Quoted word for word from the source, typed by the CEO, or emptied against evidence. A person is never "quoted".
    const row = out.review.parts[0].rows[0];
    expect(row.quoted.sort()).toEqual(['channel', 'priority', 'requester']);
    expect(row.typed.sort()).toEqual(['category', 'itPerson', 'title']);
    expect(row.cleared).toEqual([]);
    expect(row.rowId).toBe('p1-r1');
    const stored = JSON.stringify(await store.get('itImportReviews', out.review.id));
    expect(stored).not.toContain('floor 3');
    expect(stored).not.toContain(SOURCE);
  });

  it('refuses everyone but the CEO on every action, without saying whether a review exists', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    for (const id of OTHERS) {
      const u = await svc.user(id);
      await expect(svc.itImportReviews.create(u, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] })).rejects.toThrow(/only the CEO/);
      await expect(svc.itImportReviews.get(u, review.id)).rejects.toThrow(/only the CEO/);
      await expect(svc.itImportReviews.update(u, review.id, { version: 1, parts: [ticketPart(ex)] })).rejects.toThrow(/only the CEO/);
      await expect(svc.itImportReviews.approve(u, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] })).rejects.toThrow(/only the CEO/);
      await expect(svc.itImportReviews.abandon(u, review.id, { version: 1 })).rejects.toThrow(/only the CEO/);
    }
    // A fifth, ordinary user too.
    const staff = (await store.list('users', {})).find((u) => !u.opsTier && !u.leadership && !u.integration && u.department !== 'it')!;
    await expect(svc.itImportReviews.get(staff, review.id)).rejects.toThrow(/only the CEO/);
    expect((await svc.itImportReviews.get(ceo, review.id)).review.version).toBe(1);
  });

  it('accepts only the CEO’s own, finished, recent extraction of the same source and kind', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const make = async (p: ReturnType<typeof ticketPart>) => svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [p] });
    await expect(make(ticketPart({ id: '00000000-0000-4000-8000-999999999999', text: SOURCE }))).rejects.toThrow(/not one of yours/);
    await expect(make(ticketPart(await extraction(store, { actor: 'u-coo' })))).rejects.toThrow(/not one of yours/);
    await expect(make(ticketPart(await extraction(store, { outcome: 'provider_failed' })))).rejects.toThrow(/not one of yours/);
    await expect(make(ticketPart(await extraction(store, { kind: 'jobs' })))).rejects.toThrow(/other kind/);
    await expect(make(ticketPart(await extraction(store, { at: myt(TODAY, '09:40') })))).rejects.toThrow(/minutes old/);
    const ex = await extraction(store);
    const changed = ticketPart(ex);
    changed.source.canonicalText = SOURCE + ' (edited)';
    await expect(make(changed)).rejects.toThrow(/does not match its fingerprint/);
    const other = await extraction(store, { text: 'Another UAT note entirely.' });
    const swapped = ticketPart(other);
    swapped.source = { ...ticketPart(ex).source };
    await expect(make(swapped)).rejects.toThrow(/not the one Arisha read/);
    await expect(svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex), ticketPart(ex)] })).rejects.toThrow(/twice/);
    const extra = ticketPart(ex) as Record<string, unknown>;
    (extra.rows as Record<string, unknown>[])[0].fields = { title: 'x' };
    await expect(make(extra as ReturnType<typeof ticketPart>)).rejects.toThrow(/exactly the help request fields/);
  });

  it('imports the exact reviewed batch once; a retry returns the first receipt', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const a = await extraction(store);
    const b = await extraction(store, { text: 'Second UAT note: wifi down, UAT Staff B by phone, P1.' });
    const second = { ...ticketPart(b, 'UAT wifi down floor 2'), rows: [{ fields: { title: 'UAT wifi down floor 2', category: 'network', priority: 'P1', requester: 'UAT Staff B', channel: 'phone', raisedOn: null, detail: null, itPerson: null } }] };
    const { review, preview } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(a), second] });
    expect(preview?.ready).toBe(2);
    const before = (await store.list('itTickets', {})).length;
    const approval = { version: review.version, previewToken: review.previewToken, skipRows: [] as number[] };
    const out = await svc.itImportReviews.approve(ceo, review.id, approval);
    expect(out.created).toHaveLength(2);
    expect(out.already).toBe(false);
    const made = (await store.list('itTickets', {})).filter((t) => t.importBatchId === review.id);
    expect(made).toHaveLength(2);
    expect(made[0].sourceRef).toMatch(/Arisha review/);
    expect((await store.list('itTickets', {})).length).toBe(before + 2);
    const again = await svc.itImportReviews.approve(ceo, review.id, approval);
    expect(again).toMatchObject({ already: true, created: out.created });
    expect((await store.list('itTickets', {})).length).toBe(before + 2);
    await expect(svc.itImportReviews.approve(ceo, review.id, { ...approval, skipRows: [2] })).rejects.toBeInstanceOf(ReviewConflict);
    await expect(svc.itImportReviews.update(ceo, review.id, { version: 2, parts: [ticketPart(a)] })).rejects.toThrow(/already imported/);
    await expect(svc.itImportReviews.abandon(ceo, review.id, { version: 2 })).rejects.toThrow(/one by one/);
  });

  it('binds the approval to the latest version and preview', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    const edited = { extractionId: ex.id, rows: [{ rowId: 'p1-r1', fields: { ...review.parts[0].rows[0].fields, title: 'UAT printer UAT-JAM-77 jammed again' } }] };
    const upd = await svc.itImportReviews.update(ceo, review.id, { version: 1, parts: [edited] });
    expect(upd.review.version).toBe(2);
    expect(upd.review.previewToken).not.toBe(review.previewToken);
    await expect(svc.itImportReviews.update(ceo, review.id, { version: 1, parts: [ticketPart(ex)] })).rejects.toBeInstanceOf(ReviewConflict);
    await expect(svc.itImportReviews.approve(ceo, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] })).rejects.toBeInstanceOf(ReviewConflict);
    await expect(svc.itImportReviews.approve(ceo, review.id, { version: 2, previewToken: review.previewToken, skipRows: [] })).rejects.toThrow(/latest saved preview/);
    const before = (await store.list('itTickets', {})).length;
    const ok = await svc.itImportReviews.approve(ceo, review.id, { version: 2, previewToken: upd.review.previewToken, skipRows: [] });
    expect(ok.created).toHaveLength(1);
    expect((await store.list('itTickets', {})).length).toBe(before + 1);
  });

  it('closes reviews left open, keeps closed ones read-only, and clears values after 30 days', async () => {
    const { store, svc, clock } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    const ex2 = await extraction(store);
    const left = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex2)] });
    await svc.itImportReviews.abandon(ceo, left.review.id, { version: 1 });
    await expect(svc.itImportReviews.approve(ceo, left.review.id, { version: 2, previewToken: left.review.previewToken, skipRows: [] })).rejects.toThrow(/abandoned/);
    clock.now = myt('2026-11-01', '10:30');
    expect((await svc.itImportReviews.get(ceo, review.id)).review.status).toBe('expired');
    await expect(svc.itImportReviews.approve(ceo, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] })).rejects.toThrow(/expired/);
    clock.now = myt('2026-12-02', '11:00');
    const purged = (await svc.itImportReviews.get(ceo, review.id)).review;
    expect(purged.purged).toBe(true);
    expect(purged.parts[0].rows).toEqual([]);
    expect(purged.reviewedHash).toBe(review.reviewedHash);
    expect(purged.parts[0].sourceSha256).toBe(review.parts[0].sourceSha256);
  });

  it('audits fingerprints and counts only, never values', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    await svc.itImportReviews.approve(ceo, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] });
    const lines = (await store.list('audit', {})).filter((e: AuditEntry) => e.entity === 'it_import_review');
    expect(lines.map((e) => e.action)).toEqual(['it.import.review.create', 'it.import.review.commit']);
    for (const e of lines) {
      expect(e.summary).not.toMatch(/UAT Staff A|printer|Teams|IT Executive/);
      expect(JSON.parse(e.summary)).toMatchObject({ kind: 'tickets', rows: 1 });
    }
  });

  it('resumes after the 15-minute window: admitted parts are edited by row, without their source', async () => {
    const { store, svc, clock } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    clock.now = myt(TODAY, '11:00');
    const row = review.parts[0].rows[0];
    const fields = { ...row.fields, title: 'UAT printer jammed, checked by CEO', channel: null };
    const upd = await svc.itImportReviews.update(ceo, review.id, { version: 1, parts: [{ extractionId: ex.id, rows: [{ rowId: row.rowId, fields }] }] });
    const r = upd.review.parts[0].rows[0];
    expect(r.quoted.sort()).toEqual(['priority', 'requester']);
    expect(r.typed.sort()).toEqual(['category', 'itPerson', 'title']);
    expect(r.cleared).toEqual(['channel']);
    expect(upd.review.parts[0].sourceSha256).toBe(review.parts[0].sourceSha256);
    // A part sent again with its source is still a new admission, and that one must be recent.
    await expect(svc.itImportReviews.update(ceo, review.id, { version: 2, parts: [ticketPart(ex)] })).rejects.toThrow();
    await expect(svc.itImportReviews.update(ceo, review.id, { version: 2, parts: [{ extractionId: ex.id, rows: [{ rowId: 'p1-r9', fields }] }] })).rejects.toThrow(/unknown row/);
    await expect(svc.itImportReviews.update(ceo, review.id, { version: 2, parts: [{ extractionId: ex.id, rows: [{ rowId: row.rowId, fields }, { rowId: row.rowId, fields }] }] })).rejects.toThrow(/twice/);
    // A new row typed into an admitted part is typed in every filled field.
    const added = await svc.itImportReviews.update(ceo, review.id, { version: 2, parts: [{ extractionId: ex.id, rows: [{ rowId: row.rowId, fields }, { fields: { ...fields, title: 'UAT second printer' } }] }] });
    expect(added.review.parts[0].rows[1]).toMatchObject({ rowId: 'p1-r2', quoted: [] });
    expect(added.review.counts).toMatchObject({ rows: 2 });
  });

  it('refuses evidence outside the source, and marks a value emptied against evidence as cleared', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const bad = ticketPart(ex);
    (bad.rows[0].evidence as Record<string, unknown>).priority = { start: 0, end: SOURCE.length + 5 };
    await expect(svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [bad] })).rejects.toThrow(/outside the source/);
    const backwards = ticketPart(ex);
    (backwards.rows[0].evidence as Record<string, unknown>).priority = { start: 10, end: 10 };
    await expect(svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [backwards] })).rejects.toThrow(/outside the source/);
    const cleared = ticketPart(ex);
    (cleared.rows[0].evidence as Record<string, unknown>).detail = at(SOURCE, 'floor 3');
    const out = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [cleared] });
    expect(out.review.parts[0].rows[0].cleared).toEqual(['detail']);
    expect(JSON.stringify(out.review)).not.toContain('floor 3');
  });

  it('names IT staff by stable ID only, and checks them again at approval', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const byName = ticketPart(ex);
    byName.rows[0].fields.itPerson = 'IT Executive 1 (mock)';
    await expect(svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [byName] })).rejects.toThrow(/IT staff list/);
    const mgr = ticketPart(ex);
    mgr.rows[0].fields.itPerson = 'u-it-mgr';
    await expect(svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [mgr] })).rejects.toThrow(/IT staff list/);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    await store.update('users', 'u-it-ex1', { accessClosedFrom: TODAY });
    const before = (await store.list('itTickets', {})).length;
    await expect(svc.itImportReviews.approve(ceo, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] })).rejects.toThrow(/can no longer be given IT work/);
    expect((await store.list('itTickets', {})).length).toBe(before);
  });

  it('refresh saves a changed preview as a new version; a stale preview cannot be approved', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const two = ticketPart(ex);
    two.rows.push({ fields: { ...two.rows[0].fields, title: 'UAT second request' }, evidence: {} as never });
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [two] });
    // Unchanged: nothing written.
    const same = await svc.itImportReviews.refresh(ceo, review.id, { version: 1 });
    expect(same).toMatchObject({ stale: false, review: { version: 1, previewToken: review.previewToken } });
    // Someone logs the same request by hand: the saved preview is now stale.
    const open = (await store.list('itTickets', {}))[0];
    await store.update('itTickets', open.id, { title: 'UAT printer UAT-JAM-77 jammed', raisedFor: 'UAT Staff A', status: 'open' } as never);
    expect((await svc.itImportReviews.get(ceo, review.id)).stale).toBe(true);
    await expect(svc.itImportReviews.approve(ceo, review.id, { version: 1, previewToken: review.previewToken, skipRows: [] })).rejects.toThrow(/latest saved preview|Preview the batch again|changed/);
    const fresh2 = await svc.itImportReviews.refresh(ceo, review.id, { version: 1 });
    expect(fresh2.review.version).toBe(2);
    expect(fresh2.stale).toBe(false);
    expect(fresh2.preview?.rows[0].duplicateOf).toBeTruthy();
    await expect(svc.itImportReviews.refresh(ceo, review.id, { version: 1 })).rejects.toBeInstanceOf(ReviewConflict);
    const out = await svc.itImportReviews.approve(ceo, review.id, { version: 2, previewToken: fresh2.review.previewToken, skipRows: [] });
    expect(out.created).toHaveLength(1);
    const kept = (await store.get('itImportReviews', review.id))!;
    expect(kept.receipt?.skipped).toEqual([{ row: 2, reason: 'duplicate' }]);
    expect(JSON.stringify(kept.receipt)).not.toContain('already open');
  });

  it('keeps only reason codes for skipped rows, and audits expiry and clearing', async () => {
    const { store, svc, clock } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const two = ticketPart(ex);
    two.rows.push({ fields: { ...two.rows[0].fields, title: 'UAT second request' }, evidence: {} as never });
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [two] });
    const out = await svc.itImportReviews.approve(ceo, review.id, { version: 1, previewToken: review.previewToken, skipRows: [3] });
    expect(out.created).toHaveLength(1);
    expect(out.skipped).toEqual([{ row: 3, reason: 'left_out' }]);
    expect((await store.get('itImportReviews', review.id))!.receipt?.skipped).toEqual([{ row: 3, reason: 'left_out' }]);
    const ex2 = await extraction(store);
    const left = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex2)] });
    clock.now = myt('2026-11-01', '10:30');
    await svc.itImportReviews.get(ceo, left.review.id);
    clock.now = myt('2026-12-02', '11:00');
    await svc.itImportReviews.get(ceo, review.id);
    const actions = (await store.list('audit', {})).filter((e: AuditEntry) => e.entity === 'it_import_review').map((e) => e.action);
    expect(actions).toContain('it.import.review.expire');
    expect(actions).toContain('it.import.review.purge');
  });

  it('a create retried with the same request ID returns the first review, and nobody else can reuse it', async () => {
    const { store, svc, clock } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const body = { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] };
    const first = await svc.itImportReviews.create(ceo, body);
    expect(first.replayed).toBe(false);
    // The answer was lost; the screen sends the same request again, even after the 15-minute extraction window.
    clock.now = myt(TODAY, '10:40');
    const again = await svc.itImportReviews.create(ceo, JSON.parse(JSON.stringify(body)));
    expect(again).toMatchObject({ replayed: true, review: { id: first.review.id, version: 1 } });
    expect((await store.list('itImportReviews', {})).length).toBe(1);
    expect((await svc.itImportReviews.get(ceo, body.requestId)).review.id).toBe(first.review.id);
    // Same ID, different request: refused, nothing changes.
    await expect(svc.itImportReviews.create(ceo, { ...body, parts: [ticketPart(ex, 'Something else')] })).rejects.toBeInstanceOf(ReviewConflict);
    await expect(svc.itImportReviews.create(ceo, { ...body, requestId: 'not-a-uuid' })).rejects.toThrow(/request ID/);
    await expect(svc.itImportReviews.create(ceo, { kind: 'tickets', parts: [ticketPart(ex)] })).rejects.toThrow(/request ID/);
    expect((await store.list('itImportReviews', {})).length).toBe(1);
    const audit = (await store.list('audit', {})).filter((e: AuditEntry) => e.action === 'it.import.review.create');
    expect(audit).toHaveLength(1);
  });

  it('the first approval and every retry return the same receipt, with codes only', async () => {
    const { store, svc } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    const body = { version: 1, previewToken: review.previewToken, skipRows: [] };
    const first = await svc.itImportReviews.approve(ceo, review.id, body);
    const retry = await svc.itImportReviews.approve(ceo, review.id, body);
    expect(Object.keys(first).sort()).toEqual(Object.keys(retry).sort());
    expect({ ...first, already: true }).toEqual(retry);
    expect(first.already).toBe(false);
  });

  it('an expired review is kept 30 days from its expiry time, not from when clean-up noticed', async () => {
    const { store, svc, clock } = fresh();
    const ceo = await svc.user('u-fauzan');
    const ex = await extraction(store);
    const { review } = await svc.itImportReviews.create(ceo, { requestId: crypto.randomUUID(), kind: 'tickets', parts: [ticketPart(ex)] });
    clock.now = myt('2026-11-05', '10:00');
    const seen = (await svc.itImportReviews.get(ceo, review.id)).review;
    expect(seen.status).toBe('expired');
    expect(Date.parse(seen.purgeAfter!)).toBe(Date.parse(review.expiresAt) + 30 * 86_400_000);
  });
});


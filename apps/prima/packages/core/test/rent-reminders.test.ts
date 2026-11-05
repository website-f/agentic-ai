// WhatsApp rent reminders (Fauzan, 2 Nov 2026). Mock data only: the tenant, unit and number are made up.
import { describe, expect, it } from 'vitest';
import { AccessDenied, BadRequest, MemoryStore, PrimaService, generateDataset, isStopReply, myt, rentReminderFor, waNumber, type AmTenancy, type AmUnit } from '../src';

function fresh(day: string, time = '10:30') {
  const ds = generateDataset({ today: '2026-10-26', now: myt('2026-10-26', '10:30') });
  let now = myt(day, time);
  const svc = new PrimaService(new MemoryStore(ds), () => now);
  const unit = ds.amUnits.find((u) => u.tenancy && !u.tenancy.internal)!;
  // One tenant owing November only, with a mobile number on file.
  unit.tenancy = { ...unit.tenancy!, tenant: 'Test Tenant Sdn Bhd', tenantPhone: '012-345 6789', invoices: [{ period: '2026-11', amount: 1500, paid: 0, paidOn: null }], payments: [], followUps: [], whatsapp: null };
  // Every other tenant is paid up, so only this unit is in play.
  for (const u of ds.amUnits) if (u !== unit && u.tenancy) u.tenancy = { ...u.tenancy, invoices: u.tenancy.invoices.map((i) => ({ ...i, paid: i.amount })) };
  return { ds, svc, unitId: unit.id, setNow: (d: string, t = '10:30') => (now = myt(d, t)) };
}

const tenancy = (over: Partial<AmTenancy>): Pick<AmUnit, 'id' | 'tenancy'> => ({
  id: 'u1',
  tenancy: { tenant: 'T', internal: false, startOn: '2026-01-01', endOn: '2027-12-31', rent: 1000, deposit: 0, utilityDeposit: 0, stamped: true, tenantPhone: '0123456789', lastContactOn: null, invoices: [{ period: '2026-11', amount: 1000, paid: 0, paidOn: null }], whatsapp: { consent: { on: true, by: 'x', at: 'x', how: 'form' }, reminders: [] }, ...over },
});

describe('rent reminder plan', () => {
  it('reminds 3 days before, on the due day, then 7 days late and every 10 days, and stops after 90 days', () => {
    const at = (d: string) => rentReminderFor(tenancy({}), d).plan?.stage ?? null;
    expect(at('2026-10-29')).toBe('before');
    expect(at('2026-10-30')).toBeNull();
    expect(at('2026-11-01')).toBe('due');
    expect(at('2026-11-08')).toBe('late');
    expect(at('2026-11-18')).toBe('late');
    expect(at('2027-01-27')).toBe('late'); // 87 days late: the last one
    expect(rentReminderFor(tenancy({}), '2026-11-18').plan!.key).toBe('u1:2026-11:late-2');
    expect(rentReminderFor(tenancy({}), '2027-02-06').skip).toBe('past_90_days');
  });

  it('skips tenants who did not agree, have no mobile, are group offices, or promised to pay', () => {
    expect(rentReminderFor(tenancy({ whatsapp: null }), '2026-11-01').skip).toBe('no_consent');
    expect(rentReminderFor(tenancy({ tenantPhone: '03-1234 5678' }), '2026-11-01').skip).toBe('no_phone');
    expect(rentReminderFor(tenancy({ internal: true }), '2026-11-01').skip).toBe('internal');
    const promised = tenancy({ followUps: [{ id: 'f', on: '2026-11-05', action: 'PROMISE', note: 'pay Friday', promiseOn: '2026-11-20', by: 'x', at: 'x', approval: null }] });
    expect(rentReminderFor(promised, '2026-11-08').skip).toBe('promise');
    expect(rentReminderFor(tenancy({ invoices: [{ period: '2026-11', amount: 1000, paid: 1000, paidOn: '2026-11-01' }] }), '2026-11-01').plan).toBeNull();
  });

  it('reads Malaysian mobiles and STOP replies', () => {
    expect(waNumber('012-345 6789')).toBe('60123456789');
    expect(waNumber('+60 11-2345 6789')).toBe('601123456789');
    expect(waNumber('03-1234 5678')).toBeNull();
    expect(isStopReply('STOP')).toBe(true);
    expect(isStopReply('berhenti.')).toBe(true);
    expect(isStopReply('I will pay tomorrow, stop asking')).toBe(false);
  });
});

describe('WhatsApp reminders through the service', () => {
  it('needs the tenant’s consent recorded with how, then queues once, sends in hours, logs it, and takes receipts and replies', async () => {
    const { svc, unitId, setNow } = fresh('2026-11-01', '08:00');
    const team = await svc.user('u-asset-re1');
    const wa = await svc.user('u-whatsapp-link');
    await expect(svc.amWhatsAppConsent(team, unitId, true, '')).rejects.toBeInstanceOf(BadRequest);
    await expect(svc.amWhatsAppConsent(await svc.user('u-fd'), unitId, true, 'Signed form')).rejects.toBeInstanceOf(AccessDenied);
    expect((await svc.amQueueRentReminders(wa)).skipped.no_consent).toBe(1);
    await svc.amWhatsAppConsent(team, unitId, true, 'Signed the reminder consent form');
    expect((await svc.amQueueRentReminders(wa)).queued).toBe(1);
    expect((await svc.amQueueRentReminders(team)).queued).toBe(0); // the same reminder is never queued twice
    // Outside sending hours nothing goes; inside, the tenant's number and the template values go to the sender only.
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    setNow('2026-11-01', '10:00');
    await expect(svc.amWhatsAppOutbox(team)).rejects.toBeInstanceOf(AccessDenied);
    const out = await svc.amWhatsAppOutbox(wa);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ to: '60123456789', stage: 'due', params: { amount: 'RM1,500.00', period: '2026-11', dueOn: '2026-11-01' } });
    // Claimed: a second sender at the same moment gets nothing.
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    // A failed try goes back to the queue and is claimed again; a success is logged but is not the team's own update.
    await svc.amWhatsAppResult(wa, [{ claimId: out[0].claimId, ok: false, error: 'timeout' }]);
    const again = await svc.amWhatsAppOutbox(wa);
    expect(again).toHaveLength(1);
    await svc.amWhatsAppResult(wa, [{ claimId: again[0].claimId, ok: true, providerId: 'wamid.TEST1' }]);
    // A repeated report of the same result changes nothing.
    expect((await svc.amWhatsAppResult(wa, [{ claimId: again[0].claimId, ok: true, providerId: 'wamid.TEST1' }])).sent).toBe(1);
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    let u = (await svc.amBoard(team)).units.find((x) => x.id === unitId)!;
    expect(u.followUps.filter((f) => /Automatic WhatsApp reminder/.test(f.note))).toHaveLength(1);
    await svc.amWhatsAppEvents(wa, { statuses: [{ providerId: 'wamid.TEST1', status: 'read' }, { providerId: 'wamid.TEST1', status: 'delivered' }], replies: [] });
    let board = await svc.amWhatsAppBoard(team);
    expect(board.recent[0]).toMatchObject({ status: 'read', attempts: 2 });
    // A reply is noted for the team; an unknown number is only counted; STOP ends reminders.
    const r1 = await svc.amWhatsAppEvents(wa, { statuses: [], replies: [{ from: '60123456789', text: 'Will pay on Friday' }, { from: '60199999999', text: 'hello' }] });
    expect(r1).toMatchObject({ replies: 1, unknown: 1 });
    u = (await svc.amBoard(team)).units.find((x) => x.id === unitId)!;
    expect(u.followUps.at(-1)!.note).toBe('Tenant replied on WhatsApp: Will pay on Friday');
    await svc.amWhatsAppEvents(wa, { statuses: [], replies: [{ from: '60123456789', text: 'STOP' }] });
    board = await svc.amWhatsAppBoard(team);
    expect(board.agreed).toBe(0);
    setNow('2026-11-08', '10:00');
    expect((await svc.amQueueRentReminders(wa)).skipped.no_consent).toBe(1);
  });

  it('cancels a waiting reminder once the rent is paid, and the AM feed or staff outside the team cannot run it', async () => {
    const { ds, svc, unitId } = fresh('2026-11-01', '08:00');
    const team = await svc.user('u-asset-re1');
    await svc.amWhatsAppConsent(team, unitId, true, 'Tenant replied YES on WhatsApp');
    await svc.amQueueRentReminders(team);
    const unit = ds.amUnits.find((x) => x.id === unitId)!;
    unit.tenancy = { ...unit.tenancy!, invoices: [{ period: '2026-11', amount: 1500, paid: 1500, paidOn: '2026-11-01' }] };
    expect((await svc.amQueueRentReminders(team)).cancelled).toBe(1);
    await expect(svc.amQueueRentReminders(await svc.user('u-am-feed'))).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amQueueRentReminders(await svc.user('u-fd'))).rejects.toBeInstanceOf(AccessDenied);
  });

  it('sends one message a day to a tenant with several units, with today’s balance, and STOP stops every unit', async () => {
    const { ds, svc, unitId, setNow } = fresh('2026-11-01', '10:00');
    const team = await svc.user('u-asset-re1');
    const wa = await svc.user('u-whatsapp-link');
    // A second unit for the same tenant and number, owing too; a third tenant elsewhere is untouched.
    const second = ds.amUnits.find((u) => u.tenancy && !u.tenancy.internal && u.id !== unitId)!;
    second.tenancy = { ...second.tenancy!, tenant: 'Test Tenant Sdn Bhd', tenantPhone: '+60 12-345 6789', invoices: [{ period: '2026-11', amount: 800, paid: 0, paidOn: null }], payments: [], followUps: [], whatsapp: null };
    await svc.amWhatsAppConsent(team, unitId, true, 'Signed the reminder consent form');
    await svc.amWhatsAppConsent(team, second.id, true, 'Signed the reminder consent form');
    expect((await svc.amQueueRentReminders(wa)).queued).toBe(2);
    // A part-payment after queueing: the message carries today's balance, not the queued one.
    const first = ds.amUnits.find((u) => u.id === unitId)!;
    first.tenancy = { ...first.tenancy!, invoices: [{ period: '2026-11', amount: 1500, paid: 1000, paidOn: '2026-11-01' }] };
    const out = await svc.amWhatsAppOutbox(wa);
    expect(out).toHaveLength(1);
    expect(out[0].reminderIds).toHaveLength(2);
    expect(out[0].params.amount).toBe('RM1,300.00');
    await svc.amWhatsAppResult(wa, [{ claimId: out[0].claimId, ok: true, providerId: 'wamid.MULTI' }]);
    // A receipt for the one message updates both units.
    await svc.amWhatsAppEvents(wa, { statuses: [{ providerId: 'wamid.MULTI', status: 'delivered' }], replies: [] });
    expect((await svc.amWhatsAppBoard(team)).recent.filter((r) => r.providerId === 'wamid.MULTI').map((r) => r.status)).toEqual(['delivered', 'delivered']);
    // Next late reminder for both is queued; STOP before it goes cancels both and withdraws consent on both units.
    setNow('2026-11-08', '08:00');
    expect((await svc.amQueueRentReminders(wa)).queued).toBe(2);
    const stop = await svc.amWhatsAppEvents(wa, { statuses: [], replies: [{ from: '60123456789', text: 'Berhenti' }] });
    expect(stop.stopped).toBe(1);
    const board = await svc.amWhatsAppBoard(team);
    expect(board.agreed).toBe(0);
    expect(board.recent.filter((r) => r.stage === 'late').map((r) => r.status)).toEqual(['cancelled', 'cancelled']);
    setNow('2026-11-08', '10:00');
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
  });

  it('round 2: a claim with no result after 15 minutes becomes uncertain and is never sent again on its own', async () => {
    const { svc, unitId, setNow } = fresh('2026-11-01', '10:00');
    const team = await svc.user('u-asset-re1');
    const wa = await svc.user('u-whatsapp-link');
    await svc.amWhatsAppConsent(team, unitId, true, 'Signed the reminder consent form');
    await svc.amQueueRentReminders(wa);
    const first = await svc.amWhatsAppOutbox(wa);
    expect(first).toHaveLength(1);
    setNow('2026-11-01', '10:10');
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    // The sender stopped after WhatsApp may have taken the message: the claim expires as uncertain, not as waiting.
    setNow('2026-11-01', '10:20');
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    let board = await svc.amWhatsAppBoard(team);
    expect(board.uncertain).toBe(1);
    expect(board.recent[0].status).toBe('uncertain');
    // Still not sent on later passes, the same day or the next.
    setNow('2026-11-01', '16:00');
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    setNow('2026-11-02', '10:00');
    await svc.amQueueRentReminders(wa);
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    // A late, clear result for the old claim still settles it.
    expect((await svc.amWhatsAppResult(wa, [{ claimId: first[0].claimId, ok: true, providerId: 'wamid.LATE' }])).sent).toBe(1);
    board = await svc.amWhatsAppBoard(team);
    expect(board.uncertain).toBe(0);
    expect(board.recent.find((r) => r.providerId === 'wamid.LATE')?.status).toBe('sent');
  });

  it('round 2: an unclear answer is kept uncertain (not retried); a clear refusal is retried; the team settles with a reason', async () => {
    const { svc, unitId, setNow } = fresh('2026-11-01', '10:00');
    const team = await svc.user('u-asset-re1');
    const wa = await svc.user('u-whatsapp-link');
    const fd = await svc.user('u-fd');
    await svc.amWhatsAppConsent(team, unitId, true, 'Signed the reminder consent form');
    await svc.amQueueRentReminders(wa);
    // A clear refusal (4xx) goes back to waiting and is tried again.
    let out = await svc.amWhatsAppOutbox(wa);
    expect((await svc.amWhatsAppResult(wa, [{ claimId: out[0].claimId, ok: false, error: 'WhatsApp answered 400' }])).failed).toBe(1);
    out = await svc.amWhatsAppOutbox(wa);
    expect(out).toHaveLength(1);
    // A timeout: it may have gone. Not retried.
    expect((await svc.amWhatsAppResult(wa, [{ claimId: out[0].claimId, ok: false, uncertain: true, error: 'timeout' }])).uncertain).toBe(1);
    setNow('2026-11-02', '10:00');
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    // A repeat of the unclear report changes nothing.
    expect((await svc.amWhatsAppResult(wa, [{ claimId: out[0].claimId, ok: false, uncertain: true, error: 'timeout' }])).ignored).toBe(0);
    const r = (await svc.amWhatsAppBoard(team)).recent.find((x) => x.status === 'uncertain')!;
    // Only the team settles it, with what they checked.
    await expect(svc.amWhatsAppSettle(fd, unitId, r.id, 'resend', 'Checked the inbox')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amWhatsAppSettle(wa, unitId, r.id, 'resend', 'Checked the inbox')).rejects.toBeInstanceOf(AccessDenied);
    await expect(svc.amWhatsAppSettle(team, unitId, r.id, 'resend', ' ')).rejects.toBeInstanceOf(BadRequest);
    await svc.amWhatsAppSettle(team, unitId, r.id, 'resend', 'Not in the WhatsApp Business inbox');
    // Settled once: a second settle is refused, and the reminder is sent again on the next pass.
    await expect(svc.amWhatsAppSettle(team, unitId, r.id, 'went', 'Checked again')).rejects.toBeInstanceOf(BadRequest);
    expect(await svc.amWhatsAppOutbox(wa)).toHaveLength(1);
  });

  it('round 2: the one-a-day limit holds across units, including a unit messaged earlier with nothing waiting now', async () => {
    const { ds, svc, unitId, setNow } = fresh('2026-11-01', '10:00');
    const team = await svc.user('u-asset-re1');
    const wa = await svc.user('u-whatsapp-link');
    await svc.amWhatsAppConsent(team, unitId, true, 'Signed the reminder consent form');
    await svc.amQueueRentReminders(wa);
    const morning = await svc.amWhatsAppOutbox(wa);
    expect(morning).toHaveLength(1);
    await svc.amWhatsAppResult(wa, [{ claimId: morning[0].claimId, ok: true, providerId: 'wamid.AM' }]);
    // In the afternoon a second unit on the same number is added and agrees; its due-day reminder is queued.
    setNow('2026-11-01', '15:00');
    const second = ds.amUnits.find((u) => u.tenancy && !u.tenancy.internal && u.id !== unitId)!;
    second.tenancy = { ...second.tenancy!, tenant: 'Test Tenant Sdn Bhd', tenantPhone: '012 345 6789', invoices: [{ period: '2026-11', amount: 800, paid: 0, paidOn: null }], payments: [], followUps: [], whatsapp: null };
    await svc.amWhatsAppConsent(team, second.id, true, 'Signed the reminder consent form');
    expect((await svc.amQueueRentReminders(wa)).queued).toBe(1);
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
    // A claim in flight on one unit also blocks another unit on the same number.
    setNow('2026-11-02', '10:00');
    const next = await svc.amWhatsAppOutbox(wa);
    expect(next).toHaveLength(1);
    expect(next[0].reminderIds).toEqual([expect.stringContaining(second.id)]);
    // Unit A gets a reminder waiting while unit B's message is still being sent.
    const unitA = ds.amUnits.find((u) => u.id === unitId)!;
    unitA.tenancy!.whatsapp!.reminders.push({ id: `${unitId}:2026-11:extra`, stage: 'late', period: '2026-11', amount: 1500, dueOn: '2026-11-01', queuedAt: myt('2026-11-02', '10:01'), status: 'queued', attempts: 0, providerId: null, lastError: null, updatedAt: myt('2026-11-02', '10:01') });
    expect(await svc.amWhatsAppOutbox(wa)).toEqual([]);
  });
});

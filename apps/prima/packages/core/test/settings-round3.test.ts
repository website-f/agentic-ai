// G6-G16 (Fauzan, 11 Nov 2026, settings round 3): each value checked against the handover text and marked approved in the
// rule register. Nothing changed value; HR-STAFF-KEEP moved from Unverified to Policy. Synthetic data only.
import { describe, expect, it } from 'vitest';
import { AccessDenied, MemoryStore, PrimaService, RULES, generateDataset, myt } from '../src';

const APPROVED = /Approved by Fauzan, 11 Nov 2026 \(round 3, G(6|7|8|9|10|11|12|13|14|15|16)/;

describe('G6-G16: settings approved as they are', () => {
  const cases: [string, { id: string; label: string; source: string }, unknown, unknown][] = [
    ['G6 show-cause, guards', RULES.disciplineHandbook, RULES.disciplineHandbook.value.showCauseReplyDays, 3],
    ['G7 firearm overdue', RULES.armsOverdue, RULES.armsOverdue.value, { alertMin: 15, escalateMin: 30, lossCaseMin: 120 }],
    ['G7 vault door', RULES.vaultDoorMatchMin, RULES.vaultDoorMatchMin.value, 15],
    ['G8 CMS acknowledgement', RULES.siteDispatch, RULES.siteDispatch.value.ackSec, { urgent: 60, alert: 180, instruction: 900 }],
    ['G8 video kept', RULES.siteDispatch, RULES.siteDispatch.value.videoKeepDays, 90],
    ['G9 staff location readings', RULES.staffTrackKeepDays, RULES.staffTrackKeepDays.value, 90],
    ['G9 site visitor records', RULES.siteGate, RULES.siteGate.value.keepYears, 7],
    [
      'G10 permit reminders',
      RULES.credentialLeadDays,
      (({ KDN_GUARD_CARD, PLKS_PERMIT, PASSPORT, FOMEMA, FW_INSURANCE }) => ({ KDN_GUARD_CARD, PLKS_PERMIT, PASSPORT, FOMEMA, FW_INSURANCE }))(RULES.credentialLeadDays.value),
      { KDN_GUARD_CARD: 60, PLKS_PERMIT: 90, PASSPORT: 180, FOMEMA: 60, FW_INSURANCE: 60 },
    ],
    ['G11 hostel bill ladder', RULES.hostelBillReminders, RULES.hostelBillReminders.value.ladder, [{ overdueDays: 1, to: 'Chief of Staff' }, { overdueDays: 7, to: 'COO' }, { overdueDays: 14, to: 'CEO' }]],
    ['G11 utility deduction', RULES.utilityAllowance, RULES.utilityAllowance.value, { electricity: 30, water: 20, noticesBeforeDeduction: 2, maxDeductionShareOfBasic: 0.5 }],
    ['G12 minimum insurance list', RULES.requiredCover, RULES.requiredCover.value.length > 0, true],
    ['G13 continuity', RULES.continuity, [RULES.continuity.value.restoreTestMonths, RULES.continuity.value.drillMonths], [6, 12]],
    ['G14 memo read', RULES.memoRead, RULES.memoRead.value.readWithinDays, 3],
    ['G14 SOCSO check-in', RULES.socsoCheckInDays, RULES.socsoCheckInDays.value, 7],
    ['G14 LINDUNG answer', RULES.lindungVerifyDays, RULES.lindungVerifyDays.value, 2],
    [
      'G15 Asset Management',
      RULES.amExtras,
      (({ cidbWarnDays, lowRating, advertWithinDays, letBeforeEndDays, meterSpikeX }) => ({ cidbWarnDays, lowRating, advertWithinDays, letBeforeEndDays, meterSpikeX }))(RULES.amExtras.value),
      { cidbWarnDays: 30, lowRating: 3, advertWithinDays: 7, letBeforeEndDays: 90, meterSpikeX: 2 },
    ],
    [
      'G16 guard phone',
      RULES.guardPhone,
      (({ sessionHours, maxFailedTries, lockMin, keepPingsDays }) => ({ sessionHours, maxFailedTries, lockMin, keepPingsDays }))(RULES.guardPhone.value),
      { sessionHours: 14, maxFailedTries: 5, lockMin: 30, keepPingsDays: 90 },
    ],
  ];
  for (const [what, rule, got, want] of cases)
    it(`${what}: ${rule.id} keeps the approved value and records Fauzan's approval`, () => {
      expect(got).toEqual(want);
      expect(rule.label).toBe(rule.id === 'HR-CASE' ? 'Law' : 'Policy');
      expect(rule.source).toMatch(APPROVED);
    });

  it('keeps office staff at 7 days to answer a show-cause letter (HR-CASE, unchanged)', () => {
    expect(RULES.hrCases.value.showCauseReplyDays).toBe(7);
  });

  it('G12: the Chief of Staff signs off the minimum insurance list with the lawyer', () => {
    expect(RULES.requiredCover.source).toMatch(/Chief of Staff signs off each company.s minimum insurance list with the lawyer/);
  });

  it('G14: only the memo publisher side sends the read reminder; a guard is refused', async () => {
    const today = '2026-11-12';
    const ds = generateDataset({ today, now: myt(today, '09:00') });
    const svc = new PrimaService(new MemoryStore(ds), () => myt(today, '09:00'));
    const memo = ds.memos[0];
    const guard = ds.users.find((u) => u.role === 'guard')!;
    expect(memo && guard).toBeTruthy();
    await expect(svc.remindMemo(await svc.user(guard.id), memo.id)).rejects.toBeInstanceOf(AccessDenied);
  });
});

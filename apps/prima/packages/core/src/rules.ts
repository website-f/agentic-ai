import type { CredentialType } from "./types";
import type { GovArea } from "./types";
import type { GrcStream } from "./types";
import type { InsuranceKind } from "./types";
import type { LicenceType } from "./types";
import type { Severity } from "./types";


































export type RuleLabel = 'Law' | 'Secondary' | 'Policy' | 'Unverified';

export interface Rule<T> {
  id: string;
  value: T;
  label: RuleLabel;
  source: string;
}

function rule<T>(id: string, value: T, label: RuleLabel, source: string): Rule<T> {
  return { id, value, label, source };
}

export type JaArea = 'payroll' | 'fwm' | 'incidents' | 'hostels';

export const RULES = {
  maxGuardAge: rule('HR-AGE-MAX', 60, 'Policy', 'Fauzan, 23 Oct 2026: no guards over 60'),
  medicalFromAge: rule(
    'QMS-MEDICAL-56',
    { fromAge: 56, validMonths: 12, level: 'warn' as 'warn' | 'block' },
    'Policy',
    'Fitri package E9 (PIKM/ISO, approved by Fauzan 11 Nov 2026): a guard or officer aged 56 or over needs a yearly medical fitness check on record before deployment. Starts as a warning on the roster; the owner may make it a block.',
  ),
  riskBriefing: rule(
    'QMS-RISK-BRIEF',
    { risks: ['medium', 'high'] as ('low' | 'medium' | 'high')[], level: 'warn' as 'warn' | 'block' },
    'Policy',
    'Fitri package E9 (PIKM/ISO, approved by Fauzan 11 Nov 2026): before a guard first works a medium or high risk site, the supervisor, OM or company office records the site risk briefing. Starts as a warning on the roster.',
  ),
  alertChoice: rule(
    'ALERT-CHOICE',
    { lockedWords: ['SOS', 'firearm', 'arms', 'vault', 'alarm', 'dispatch', 'police', 'P1'], maxMuted: 30 },
    'Policy',
    'Fitri package A13 (Fauzan 11 Nov 2026: staff choose their alerts). Each person may stop the daily summary and mute topics by email and Teams; the in-app bell still shows all. Topics with these words (safety and arms) cannot be muted. Proposed list.',
  ),
  personnelKeepYears: rule(
    'HR-RECORDS-KEEP',
    7,
    'Policy',
    'Fitri package E9 (PIKM/ISO, approved by Fauzan 11 Nov 2026): personnel records are kept 7 years after the person leaves (Employment Act s.61 asks for 6 years for wage records; PIKM asks for 7). Prima never deletes them earlier.',
  ),
  maxHoursPerDay: rule('OPS-HOURS-MAX', 12, 'Law', 'Employment Act 1955 s.60A: not more than 12 hours a day including overtime'),
  minRestHours: rule('OPS-REST-MIN', 8, 'Policy', 'Approved by Fauzan, 11 Nov 2026 (G5): minimum rest between shifts stays 8 hours'),
  maxConsecutiveDays: rule('OPS-REST-DAY', 6, 'Law', 'Employment Act 1955 s.59: one rest day each week'),
  lateGraceMin: rule('OPS-LATE-GRACE', 10, 'Policy', 'Approved by Fauzan, 11 Nov 2026: 10 minutes clock-in grace (G5, was 15); a guard 11 minutes late is marked late'),
  earlyLeaveGraceMin: rule('OPS-EARLY-GRACE', 10, 'Policy', 'Approved by Fauzan, 11 Nov 2026: 10 minutes early clock-out grace (G5, was 15)'),
  offlineSyncMin: rule('OPS-OFFLINE', 5, 'Policy', 'Records reaching the server 5+ minutes late are marked as offline sync'),
  kdnVettingUsualDays: rule(
    'HR-KDN-VETTING',
    21,
    'Policy',
    'Fauzan, 24 Oct 2026: a guard may work while KDN vetting is pending, only once the application is submitted in eSIMS. Vetting usually takes up to 3 weeks.',
  ),
  csgDeadlineMonths: rule('HR-CSG-FIRST-YEAR', 12, 'Policy', 'Fauzan, 24 Oct 2026: CSG training must be completed within the first year of work'),
  injuryMcPay: rule(
    'HR-INJURY-MC',
    3,
    'Law',
    'Fauzan, 26 Oct 2026: MC and hospitalisation are paid as the law requires, basic pay only. Employment Act s.60F(4): no paid sick leave for days PERKESO pays temporary disablement (MC of 4 days or more). Injury MC of 3 days or less is company sick leave; longer MC is held until PERKESO decides.',
  ),
  fwmLadder: rule(
    'FWM-LADDER',
    [120, 90, 60, 30, 15, 7] as const,
    'Policy',
    'Fauzan, 26 Oct 2026: reminders at 120, 90, 60, 30 and 15 days before a foreign-worker paper expires, 15 days is urgent; escalation FWM, then Chief of Staff, COO and CEO; the CEO is alerted 7 days before expiry. Per FW design v3, the Chief of Staff is alerted at 30 days and the COO at 15 days if the step is not yet submitted. A renewal submitted with its receipt pauses the ladder. Approved by Fauzan, 11 Nov 2026 (round 3, G10).',
  ),
  fwPrivateOnly: rule('FWM-PRIVATE-ONLY', true, 'Policy', 'Fauzan, 26 Oct 2026: Nepali guards may work only in the private sector, never at government sites.'),
  fwmYearCap: rule(
    'FWM-YEAR-CAP',
    10,
    'Policy',
    'Fauzan, 26 Oct 2026: Sasa keeps a foreign worker to the end of year 10, then the worker goes home for 6 months on a fresh permit application filed in month 3 (the process takes about 3 months; entry is by flight only).',
  ),
  fwmPassportMonths: rule(
    'FWM-PASSPORT-12M',
    12,
    'Law',
    'FWCMS help (checked 26 Oct 2026): the passport must be valid for 12 months when the PLKS is renewed. The ladder for a passport runs to 12 months before its expiry.',
  ),
  socsoCheckInDays: rule(
    'HR-SOCSO-CHECKIN',
    7,
    'Policy',
    'SOCSO Claims SOP, rehabilitation section (26 Oct 2026): the officer checks in with an injured guard every week while off work and for the first month back. Proposed, for approval. Approved by Fauzan, 11 Nov 2026 (round 3, G14).',
  ),
  staffPingMin: rule(
    'HR-STAFF-PING',
    10,
    'Policy',
    'Fauzan, 26 Oct 2026: staff location is followed from clock-in to clock-out. Proposed: one reading every 10 minutes while clocked in.',
  ),
  staffTrackGapMin: rule(
    'HR-STAFF-GAP',
    30,
    'Policy',
    'Proposed: no location for 30 minutes while clocked in shows as Unknown (phone off, app closed or GPS blocked), never as fine.',
  ),
  staffMovement: rule(
    'HR-STAFF-MOVE',
    { outOfStationMin: 15, maxAccuracyM: 150, maxSpeedKmh: 200, farClockInM: 1000, movingPingMin: 2, movedM: 100 },
    'Policy',
    'Fitri, 9 Nov 2026 (P93): movements while clocked in are recorded well enough to see when staff go out of their place, to prevent violations and fraud. Proposed: outside the assigned place (check-in place, company office, field area or base) for more than 15 minutes is an out-of-station period for the manager to review; readings rougher than 150 m are not used for distance or place (Fitri, 23 Nov 2026: indoor Wi-Fi readings are about 100 to 130 m; 100 m dropped most of them); faster than 200 km/h between two readings is a jump; a clock-in more than 1 km outside the place is a review item. While moving (100 m or more) the phone sends a reading about every 2 minutes; when still, at the HR-STAFF-PING interval.',
  ),
  staffClockSnap: rule(
    'HR-STAFF-SNAP',
    { on: true },
    'Policy',
    'Fitri, 11 Nov 2026 (P97): "where is the face scan/snap?" Each staff check-in and check-out takes a face photo on the phone with the same face check as the sign-in face check (the phone finds the face and checks it moved; with a face HR approved, the server matches it). Without a camera the person writes why; their manager or HR looks at it. A missing or unmatched face never refuses the check-in (as for guards); it is reviewed. The photo is seen only by the person, their manager and HR, and kept as long as location readings (HR-STAFF-KEEP). On by default; off, the check-in asks for no photo. Face is biometric data under the PDPA: the written notice to staff must say so before this goes live.',
  ),
  armsRfid: rule(
    'ARMS-RFID',
    { scanRequired: false },
    'Policy',
    'Fauzan, 27 Oct 2026: every firearm carries an RFID tag, scanned at the vault at every issue and return. A scanned tag that is not this firearm’s stops the issue or return. A firearm picked by hand (no tag yet, or the reader not working) is recorded as not scanned and shown to Arms Control, never as confirmed. Whether a scan should be compulsory once every firearm is tagged is a proposal.',
  ),
  armsDamage: rule(
    'ARMS-DAMAGE',
    { lightHours: 24, mediumReportHours: 24, mediumReferralWorkingDays: 2, criticalMinutes: 0 },
    'Policy',
    'Arms policies (Pekeliling penyelenggaraan dan kerosakan senjata api, in force 1 Nov 2026; SOP kerosakan RACI), Fauzan 13 Nov 2026 23:44Z (R-X3): a damaged firearm is out of use at once. Light: inspect and confirm within 1 working day (24 h). Medium: report the same day, refer to a licensed dealer within 1-2 working days. Critical: immediately, a P1 case to the company head, the company director and Arms Control, COO told. Reuse only after a person who did not report or repair it confirms, with Arms Control as the independent check. Arms Control may change a target with a reason.',
  ),
  armsMaint: rule(
    'ARMS-MAINT-DAYS',
    { maintenanceDays: 120, dueSoonDays: 14, inspectDays: null as number | null, vaultInspectDays: null as number | null, jacketInspectDays: null as number | null },
    'Policy',
    'Fauzan 14 Nov 2026 00:24Z (R-X11, inventory workshop day 3): every firearm gets a maintenance check every 120 days, due from its last maintenance record; due in 14 days shows on the Arms Control board, overdue warns at issue. Routine firearm inspection, vault inspection and bulletproof jacket inspection frequencies are "belum ditetapkan" until Arms Control sets them.',
  ),
  armsPolicy: rule(
    'ARMS-POLICY',
    {
      buyWindowDays: 14,
      buyRemindDays: [7, 10],
      renewalLeadDays: 90,
      followUpDays: 30,
      expected: { licenceHqDays: 30, licenceIpdMonths: 6, licenceBookMonths: 6, vaultIpdDays: 30, vaultInspectMonths: 12, vaultApprovalMonths: 3, vaultSetupDays: 3, buyIpdMonths: 8, buyPdrmWorkingDays: 180 },
      recordsKeepYears: 7,
      jacketKeepYears: 5,
      jacketSplitDays: 30,
      inForce: { circulars: '2026-11-01', others: '2026-11-18' },
    },
    'Policy',
    'Arms, vault, licence and bulletproof jacket papers (sent 13-14 Nov 2026), Fauzan 13 Nov 2026 23:44Z (R-X1..R-X10): one group standard; buy within 14 days of the police approval letter (reminders day 7 and 10; after day 14 no order, receipt or reconcile on that approval); renewal starts 90 days before expiry; monthly follow-up while the police decide; expected times are shown, never a block; arms records kept at least 7 years after the record closes, jackets 5 years; the three circulars in force 1 Nov 2026, the others 18 Nov 2026. Arms Control changes a value with a reason.',
  ),
  officeAm: rule(
    'AM-OFFICE',
    {
      inForce: '2026-11-18',
      repair: { checkHours: 1, quotesHours: 2, approvalHours: 24, repairDays: 7, paymentDays: 1, closeDays: 1, criticalResponseDays: 1, quotesNeeded: 3, quoteOnlyUpTo: 5000, ceoAbove: 50000, confirmRemindDays: [3, 5] },
      inventory: { checkDays: 1, confirmDays: 3, fileDays: 1, firstLoadBy: '2026-12-31', warrantyRemindDays: 30, countMonths: 12 },
      disposal: { photosNeeded: 3, collectHours: 1, inspectHours: 1, approvalHours: 24, disposeDays: 1, updateDays: 1, totalDays: 3, vcConsentNbv: 10000 },
      building: { documentsDays: 5, bankDays: 14, gapDays: 3, downPaymentDays: 2, formDays: 2, registerDays: 2, confirmDay: 15, confirmCallDays: 2 },
      rent: { invoiceFrom: 20, invoiceTo: 22, checkDay: 23, sendFrom: 24, sendTo: 29, receiveFrom: 28, receiveTo: 10, lateFrom: 11, arrearsTellDays: 30, cashBankDays: 2, largeCash: 5000, wrongChequeReturnDays: 2, replacementDays: 3, bounceLimit: 2, bounceWindowMonths: 12, expiryRemindDays: 60 },
      visit: { everyMonths: 3, totalDays: 4, approvalHours: 24, followUpDays: 1, fileDays: 1 },
      jmb: { followUpDays: 3, criticalFollowUpDays: 1 },
      policyReviewYears: 2,
    },
    'Policy',
    'Prisma (Asset Management) office papers 2.0 sent 13-14 Nov 2026, Fauzan 13 Nov 2026 23:47Z and 14 Nov 2026 01:43Z, 01:51Z and 03:12Z (S-X1..S-X40): in Prima from 18 Nov 2026; 3 quotes for every office repair (fewer only with the Asset Director\'s reason), quote-only up to RM5,000, Asset Director with the Vice Chairman\'s consent and the CEO above RM50,000; critical response within 1 working day; requester confirms, reminders day 3 and 5, then the Asset Director may confirm; the 2.0 time targets are alerts only and the unit may set a new date per job with a reason; office inventory checked in 1, confirmed in 3, filed in 1 working day, first load by 31 Dec 2026; office disposal 3 working days, Vice Chairman consent at RM10,000 book value or a sale, donation or transfer outside the group; building purchase chart B timings; office rent invoiced 20th-22nd, checked 23rd, sent 24th-29th, received 28th-10th, late from the 11th, cash banked within 2 working days, large cash RM5,000; offices visited every 3 months, 4 working days visit to filing; JMB follow-up every 3 working days (critical every day); policies reviewed every 2 years. The unit changes a value with a reason.',
  ),
  staffHours: rule(
    'HR-STAFF-HOURS',
    { start: '08:30', end: '17:30', breakMin: 60 },
    'Policy',
    'Fauzan, 28 Oct 2026: staff work 8.30 am to 5.30 pm with a one-hour break. The break is normally 1 pm to 2 pm but may be taken at any time, as long as it is one hour. The staff clock flags a first clock-in after 8.30 am, a last clock-out before 5.30 pm and breaks (time signed out between clock-ins) longer than one hour, for HR and the manager to look at.',
  ),
  confidentiality: rule(
    'SEC-CONFIDENTIAL',
    {
      version: 1,
      points: [
        'Everything in Prima is confidential company information.',
        'Use it only for your own work. Do not share, copy, forward or photograph any screen, file or figure for anyone outside your work.',
        'You see only what your work needs. Do not ask others for what you cannot see.',
        'Every file you open is recorded with your name and the time.',
      ],
    },
    'Policy',
    'Fauzan, 28 Oct 2026: "Enforce secrecy in company." Each person sees only what their own work needs, every opening of a confidential file is recorded, and each person accepts the confidentiality rule before using Prima. The wording is a proposal for the company lawyer to confirm.',
  ),
  tenderFiles: rule(
    'TENDER-FILES',
    { parts: ['TEKNIKAL', 'KEWANGAN', 'HARGA', 'LAIN'] },
    'Policy',
    'Fauzan, 28 Oct 2026: when a tender is filled, every file is named as the tender asks, never by the company name. The technical part must not show the company name anywhere. The app blocks a file whose name differs from the name asked for or carries the company name, and a technical file whose readable text or file properties carry it; the person who prepared the bid confirms each technical file was checked page by page, because a scan or picture cannot be read in full.',
  ),
  staffDoorCheck: rule(
    'HR-STAFF-DOOR',
    { leftBeforeSignOutMin: 30 },
    'Policy',
    'Fauzan, 27 Oct 2026: the staff clock is checked against the office door system that CMS monitors. A clock never signed out closes at the last door exit that day (23:59 when the door has no exit). Signing out more than 30 minutes after the door last recorded the person leaving is flagged for HR. The 30 minutes is a proposal.',
  ),
  staffPhoneTimeMin: rule(
    'HR-STAFF-TIME',
    5,
    'Policy',
    "Proposed: the phone's time may differ from the server's by up to 5 minutes; the server's time is the record.",
  ),
  staffTrackKeepDays: rule(
    'HR-STAFF-KEEP',
    90,
    'Policy',
    'Proposed retention of location readings, to confirm with the PDPA notice to staff (location and face are personal data; face is biometric). Approved by Fauzan, 11 Nov 2026 (round 3, G9).',
  ),
  remotePlanMin: rule(
    'HR-WFH-PLAN',
    60,
    'Policy',
    'Fauzan, 27 Oct 2026: staff may work from home while their manager can see they are working. Proposed: on a home day the staff member posts the day plan (tasks) within 60 minutes of signing in.',
  ),
  remoteCheckIns: rule(
    'HR-WFH-CHECKIN',
    { times: ['11:00', '15:00'], windowMin: 30 },
    'Policy',
    'Proposed: two check-ins at fixed times on a home day, answered within 30 minutes with a one-line update. Fixed times, never random prompts, and no camera or screen capture.',
  ),
  remotePlace: rule(
    'HR-WFH-PLACE',
    { radiusM: 300 },
    'Policy',
    'Proposed: on a home day the location is checked once, at the first reading after sign-in, against the approved place (within 300 m). Only the distance is kept; the location is not followed for the rest of the day.',
  ),
  remotePattern: rule(
    'HR-WFH-PATTERN',
    { misses: 3, days: 10 },
    'Policy',
    'Proposed: 3 or more misses (no day plan, a missed check-in, no end-of-day report) over the last 10 home days asks the manager to talk to the staff member. Nothing is automatic: ending the arrangement or any discipline is the manager’s written decision.',
  ),
  workHelpEscalateMin: rule(
    'WORK-HELP-ESCALATE',
    30,
    'Policy',
    'Fauzan, 27 Oct 2026 (D3): a "Stuck, need help" request not answered by the line manager within 30 minutes shows to the manager’s manager.',
  ),
  workCheckInBy: rule('WORK-CHECKIN', '10:00', 'Policy', 'Fauzan, 27 Oct 2026 (D2): the morning check-in (hours, top 3 priorities, support needed) is sent by 10:00.'),
  workOneOnOneDays: rule('WORK-1TO1', 7, 'Policy', 'Fauzan, 27 Oct 2026 (D3): a one-to-one with each team member every week; missing after 7 days shows on the manager’s list.'),
  cooMonitors: rule(
    'COO-MONITORS',
    ['it', 'operations', 'fwm', 'procurement', 'transport'] as const,
    'Policy',
    'Fauzan, 31 Oct 2026: the COO may accept or return anyone\u2019s work, with a reason, only in the departments he directly monitors: IT, Operations, Foreign Worker Management, Inventory and Goodwill Empire (the "procurement" department here is operations inventory procurement under the OGM; Goodwill Empire is not yet in Prima) and Transport. Fauzan, 31 Oct 2026: procurement is in three parts, IT procurement (IT department), operations inventory procurement (this one) and asset procurement (Asset Management, not monitored by the COO); small office buys are done by each office and ad-hoc procurement is under the CEO. Every COO approval has a reason; a short one is fine. The person in charge of checking it is told. Fauzan: the list will grow; add a department here only once he confirms the COO directly monitors it.',
  ),
  workDueSoonDays: rule('WORK-DUE-SOON', 3, 'Policy', 'Proposed: tasks due within 3 days show as due soon on the manager’s dashboard.'),
  workOnTimeStandard: rule(
    'WORK-STANDARD',
    { onTimePct: 80, weeks: 4 },
    'Policy',
    'Proposed (D4): results are at standard when at least 80% of tasks over the last 4 weeks were done on time and each role measure met its weekly standard. No tasks means UNKNOWN, never at standard.',
  ),
  workProbationMonths: rule('WORK-WFH-PROBATION', 3, 'Policy', 'Fauzan, 27 Oct 2026 (D5): working from home only after the 3-month probation, with the playbook signed off and results at standard.'),
  branchVisitCycle: rule(
    'BRANCH-VISITS',
    { omPerMonth: 2, romPerMonth: 1, actPerHalf: 1, spotPerMonth: 2 },
    'Policy',
    'Fauzan, 27 Oct 2026 (D7, D9): OM visits each far branch at least twice a month, the Regional OM monthly, ACT one unannounced audit per branch per half year; CMS or the company manager may make up to 2 random video spot checks per branch a month.',
  ),
  plannerPreferred: rule(
    'WORK-PLANNER',
    { planId: 'mock-plan-pwvsb', wins: 'newer' },
    'Policy',
    'Fauzan, 27 Oct 2026 (P1): tasks live in both Prima and Microsoft Planner for now, Planner preferred. A change made in Planner wins when it is newer than the last change in Prima.',
  ),
  remoteAnswerDays: rule(
    'HR-WFH-ANSWER',
    60,
    'Law',
    'Employment Act 1955 s.60P (in force 1 Jan 2023): an employee may apply in writing for a flexible working arrangement, including the place of work; the employer answers in writing within 60 days and gives the grounds for a refusal.',
  ),
  faceMatchMin: rule(
    'OPS-FACE-MATCH',
    0.8,
    'Policy',
    'Fauzan, 24 Oct 2026: guards and supervisors clock in and out by face. Proposed match threshold, to tune with the chosen face engine.',
  ),
  tenderEligibility: rule(
    'COM-TENDER-ELIGIBLE',
    'KDN licence and insurance for every bid; MOF registration too for government tenders',
    'Policy',
    'Masterplan V3/V4/V15: an expired or missing MOF registration blocks government tender prequalification; each company is checked on its own papers (V7)',
  ),
  armsOverdue: rule<{ alertMin: number; escalateMin: number; lossCaseMin: number }>(
    'ARMS-OVERDUE',
    { alertMin: 15, escalateMin: 30, lossCaseMin: 120 },
    'Policy',
    'Master plan W13 (V13/V14 arms design): firearm not back 15 minutes after due alerts, 30 minutes escalates, 2 hours opens a loss case. Proposed, for approval with Arms Control. Approved by Fauzan, 11 Nov 2026 (round 3, G7).',
  ),
  armsWitness: rule(
    'ARMS-WITNESS',
    true,
    'Policy',
    'V13/V14: every issue and return has a second person as witness; KDN Circular 1/2006 requires a register of every movement out and in',
  ),
  patrolGapMin: rule(
    'OPS-PATROL-GAP',
    120,
    'Policy',
    "Fauzan, 25 Oct 2026: patrols are usually every 2 hours. A checkpoint at a guarded site with no NFC tap for longer shows as a missed patrol. A site can follow its client's own time instead.",
  ),
  patrolIntervalRange: rule<{ min: number; max: number }>(
    'OPS-PATROL-SITE',
    { min: 15, max: 480 },
    'Policy',
    "Fauzan, 25 Oct 2026: the Regional Operations Manager sets a site's patrol time to follow the client's request. Allowed range 15 minutes to 8 hours (proposed).",
  ),
  vaultWatchCheckMin: rule(
    'ARMS-VAULT-WATCH',
    60,
    'Policy',
    'Fauzan, 25 Oct 2026: CMS control watches every vault day and night. Proposed: the vault watch checks in with CMS at least every 60 minutes; a later check shows as an alert.',
  ),
  cmsMinStaffing: rule<{ headControl: number; monitorOfficers: number }>(
    'CMS-STAFFING',
    { headControl: 1, monitorOfficers: 1 },
    'Policy',
    'Fauzan, 25 Oct 2026: CMS must be manned by 1 Head Control and 1 Monitor Officer on every shift. CMS settings can add more, never fewer.',
  ),
  cmsSettingRange: rule<
    Record<
      | 'clockInGraceMin'
      | 'handoverWithinMin'
      | 'vaultWatchCheckMin'
      | 'forwardAfterSec'
      | 'answerTargetSec'
      | 'callbackWithinMin'
      | 'alarmAckSec'
      | 'minRestHours'
      | 'headControlPerShift'
      | 'monitorOfficersPerShift',
      { min: number; max: number }
    >
  >(
    'CMS-SETTINGS',
    {
      clockInGraceMin: { min: 5, max: 60 },
      handoverWithinMin: { min: 5, max: 60 },
      vaultWatchCheckMin: { min: 15, max: 120 },
      forwardAfterSec: { min: 10, max: 60 },
      answerTargetSec: { min: 5, max: 60 },
      callbackWithinMin: { min: 5, max: 120 },
      alarmAckSec: { min: 15, max: 300 },
      minRestHours: { min: 1, max: 24 },
      headControlPerShift: { min: 1, max: 2 },
      monitorOfficersPerShift: { min: 1, max: 6 },
    },
    'Policy',
    'Proposed limits for the CMS settings Arms Control may set, for approval',
  ),
  phoneForward: rule(
    'CMS-PHONE',
    20,
    'Policy',
    'Fauzan, 25 Oct 2026: CMS is the focal point for the IP phones of every company; a call not answered at the extension forwards to CMS. Proposed default: forward after 20 seconds of ringing (about 4 rings).',
  ),
  attendanceAlertRepeat: rule(
    'ATT-ALERT-REPEAT',
    5,
    'Policy',
    'Shahirah, 25 Oct 2026: alert the PIC when a guard is absent or an attendance check fails, and repeat the alert every 5 minutes until action is taken. An absence stays open until a replacement or buffer guard is sent, the guard is on post, or it is excused with a reason. Disciplinary action is recorded by the company, never issued by the app.',
  ),
  opsStepIn: rule(
    'OPS-STEP-IN',
    15,
    'Policy',
    'Fauzan, 27 Oct 2026 ("Do it"): when a guard is absent or a post is empty and the company PIC has not acted within 15 minutes, the Operations Manager covering the site (or the Regional OM, the Operations Director or OGM for their sector, or the COO) may alert the guard, send a replacement or excuse the absence for the company. It is recorded as done by operations on behalf of the company; discipline and closing stay with the company.',
  ),
  caseEscalation: rule(
    'CASE-ESCALATE',
    { P1: 15, P2: 60, P3: 240, P4: 1440 } as Record<'P1' | 'P2' | 'P3' | 'P4', number>,
    'Policy',
    'Fauzan, 25 Oct 2026: escalation until fully resolved. A site case goes to the officer stationed at the site (where there is one), the patrolling officer, the Operations Manager, then the Regional Operations Manager, who confirms it fully resolved. Up to the ROM, if a level has not acted within these minutes (by severity) the next level is alerted and may step in. Above the ROM only big matters, by decision: the OGM (government sites) or Operations Director (private sites), then the COO, then the CEO. Times proposed.',
  ),
  caseProof: rule(
    'CASE-PROOF',
    { maxItems: 3, maxDocBytes: 700_000 },
    'Policy',
    'Fauzan, 25 Oct 2026: every case or incident must come with proof, be verified with proof and be done with proof: a photo from the in-app camera or a supporting document (PDF or picture of a letter, report or certificate). A case is reported with at least one proof, except an SOS, which is never held up. Each verify, resolve and confirm step adds its own proof. Excusing an absence or recording discipline needs a document. Up to 3 items of up to 700 KB each per step (proposed).',
  ),
  sharedPay: rule(
    'OPS-SHARED-PAY',
    'by_guards',
    'Policy',
    "Fauzan, 25 Oct 2026: a patrolling officer may work for more than one company in the group. The salary is divided between the companies by the number of each company's guards under the officer's command (for example RM4,000 with 40 Sasa and 20 Inas guards: Sasa pays RM2,666.67, Inas RM1,333.33). An officer working for several companies is usually paid more than one working for a single company. Each company pays its own share through its own payroll. The guard count used for the split is today's roster in the test version; payroll will use the month's roster.",
  ),
  leaveYearEnd: rule(
    'HR-LEAVE-YEAR-END',
    {
      /** Unused annual leave carried into the next year (days). */
      carryForwardDays: 0,
      /** Staff are reminded of the annual leave days they have left from this month of the year. */
      remindFromMonth: 11,
    },
    'Policy',
    'Fauzan, 13 Nov 2026 (Part N6, answer c): no carry-forward; unused annual leave lapses on 31 December, and staff see a reminder of the days they have left in November and December. HR checks this against the Employment Act 1955 before it applies (an employer who refuses leave the employee asked for still owes it).',
  ),
  leaveEntitlement: rule(
    'EA-LEAVE',
    {
      annual: [
        { underYears: 2, days: 8 },
        { underYears: 5, days: 12 },
        { underYears: 99, days: 16 },
      ],
      sick: [
        { underYears: 2, days: 14 },
        { underYears: 5, days: 18 },
        { underYears: 99, days: 22 },
      ],
      hospitalTotal: 60,
    },
    'Law',
    'Employment Act 1955 s.60E: paid annual leave of 8 days (under 2 years of service), 12 days (2 to 5 years) or 16 days (5 years or more), in proportion to completed months in the first year. s.60F: paid sick leave of 14, 18 or 22 days on a medical certificate, and 60 separate hospitalisation days per calendar year under the current rules (Peninsula/Labuan from 1 January 2023; Sabah/Sarawak from 1 May 2025). Historical transition balances require HR/legal review; ordinary sick leave does not reduce the current hospitalisation allowance. The guard informs the employer within 48 hours. Emergency leave is taken from annual leave (company policy, proposed).',
  ),
  familyLeave: rule(
    'EA-FAMILY-LEAVE',
    { maternityDays: 98, maternityPaidMinDays: 90, maternityPaidUnderChildren: 5, paternityDays: 7, paternityMinMonths: 12, paternityMaxBirths: 5 },
    'Law',
    'Employment Act 1955 as amended from 1 Jan 2023. s.37: maternity leave of at least 98 consecutive days, paid at the ordinary rate when the employee worked at least 90 days in the 9 months before the birth and has fewer than five surviving children. s.41A: a pregnant employee, or one with an illness from the pregnancy, is not dismissed except for misconduct, wilful breach of the contract or closure of the business. s.60FA: paternity leave of 7 consecutive days for a married male employee with at least 12 months of service, for up to five births, told to the employer at least 30 days before the expected birth or as soon as possible after it. Fauzan, 2 Nov 2026: HR may give more than the Act for a staff member, never less.',
  ),
  publicHolidays: rule(
    'EA-PUBLIC-HOLIDAY',
    { minPerYear: 11, compulsory: ['NATIONAL_DAY', 'AGONG_BIRTHDAY', 'RULER_BIRTHDAY', 'LABOUR_DAY', 'MALAYSIA_DAY'] as const },
    'Law',
    "Employment Act 1955 s.60D as amended from 1 Jan 2023: at least 11 paid gazetted public holidays a year, five of them fixed: National Day (31 Aug), the Yang di-Pertuan Agong's birthday, the Ruler's birthday or Federal Territory Day, Labour Day (1 May) and Malaysia Day (16 Sep). A holiday on a rest day moves to the next working day. HR enters each year's gazetted list per state; Fauzan, 2 Nov 2026: HR may add more holidays than the Act requires. Office staff leave does not count public holidays or Saturdays and Sundays. Fauzan, 11 Nov 2026 (E13): confirmed, public holiday pay is 2 extra days on top of the normal day's pay; real formula amounts come from the ACT Director.",
  ),
  hrJoinLeave: rule(
    'HR-JOIN-LEAVE',
    {
      cp22Days: 30,
      socsoRegDays: 30,
      cp22aDaysBefore: 30,
      eaBy: '02-28',
      borangEBy: '03-31',
      probationRemindDays: 14,
      retireAge: 60,
      retireRemindDays: 90,
      keepYears: 6,
      noticeWeeks: [
        { underYears: 2, weeks: 4 },
        { underYears: 5, weeks: 6 },
        { underYears: 99, weeks: 8 },
      ],
      benefitDays: [
        { underYears: 2, days: 10 },
        { underYears: 5, days: 15 },
        { underYears: 99, days: 20 },
      ],
      retrenchNoticeDays: 30,
    },
    'Law',
    "HR Phase 3, slice 3B (Fauzan, 2 Nov 2026: LHDN forms done by the system automatically; retrenchment is a guide for HR; retirement at 60 as for guards). Income Tax Act 1967: CP22 to LHDN within 30 days of a new hire; CP22A at least 30 days before an employee stops work (LHDN exempts some cases where PCB was deducted: HR checks); EA form to every employee by end of February; Borang E with CP8D by 31 March. SOCSO Act 1969: register a new employee within 30 days; EPF Act 1991: contributions from the first month, by the 15th. Employment Act 1955 s.12 notice (4, 6 or 8 weeks by service, or the contract's longer notice); Employment (Termination and Lay-Off Benefits) Regulations 1980: 10, 15 or 20 days' wages a year of service after 12 months; Form PK to the Labour Department at least 30 days before a retrenchment; employment records and the register of employees kept 6 years. Minimum Retirement Age Act 2012: 60. Prima drafts and reminds; HR files with LHDN, KWSP, PERKESO and JTK.",
  ),
  vacancy: rule(
    'HR-VACANCY',
    { needsCeo: true, headSigns: true },
    'Policy',
    "Fauzan, 2 Nov 2026: a vacancy is approved by the CEO, and the company head signs the approval (the company is the employer). HR or the company manager raises it; for PWVSB central posts the CEO signs (Fauzan, 11 Nov 2026, C2: changed from the HR Director); his approval is the signature. Every step carries a comment; nobody approves their own request.",
  ),
  jobAdvert: rule(
    'HR-JOB-ADVERT',
    { staffApprover: 'hr_director', guardApprover: 'om_of_state', channelsConnected: 0, maxChars: 3000, maxClosingDays: 90 },
    'Policy',
    "Fauzan, 5 Nov 2026 (audit decision 6): post vacancies for guards and all staff, with AI drafting and publishing to social media. Fauzan confirmed 5 Nov 2026: a person approves each post before it goes out; for guard and patrolling officer posts the Operations Manager approves (the OM covering the post's state, or the Regional OM of its region as backup), for all other staff the HR Director. An approved post goes out by itself once each account is connected; JobStreet is paid per post. HR or the company manager drafts for an open vacancy; the approver is never the person who wrote the current wording; approval is bound to the exact wording and any edit sends it back. Social accounts are not connected, so publishing is switched off and Prima never shows a post as published; HR may record a post it made by hand, marked as not checked by Prima. Wording is checked for IC and mobile numbers (blocked) and for discriminatory wording, pay below the minimum wage and missing pay (warnings for the approver).",
  ),
  hrCases: rule(
    'HR-CASE',
    { showCauseReplyDays: 7, refuseInquiryWithinDays: 30, suspensionPendingMaxDays: 14, suspensionPayMin: 0.5, outcomeSuspensionMaxDays: 14 },
    'Law',
    "HR Phase 3, slice 3E (Fauzan, 2 Nov 2026: a file on what happens with each staff member; sexual harassment inquiry). Employment Act 1955 s.14: after due inquiry the employer may dismiss, downgrade or suspend without wages for up to 2 weeks; pending the inquiry the employee may be suspended for up to 2 weeks on at least half pay. Natural justice: the charge in writing, a fair time to answer (Prima suggests 7 days), and a panel of people not involved. Part XVA (s.81A-81H): the employer inquires into every sexual harassment complaint; it may refuse only if the matter was inquired before with no finding of harassment, or the complaint is frivolous, vexatious or not in good faith, and then tells the complainant in writing with the reasons within 30 days of receiving it; a notice on sexual harassment is displayed at the workplace at all times. Anti-Sexual Harassment Act 2022: the complainant may also go to the Tribunal. HR records; a dismissal, downgrade or suspension is recorded by the HR Director (CoS or DCoS); the app never decides.",
  ),
  disciplineAppeal: rule(
    'HR-APPEAL',
    { withinDays: 14 },
    'Policy',
    "IKEA IWAY audit finding (Fauzan, 6 Nov 2026): discipline needs an appeal step. A guard or staff member may appeal in writing against a warning, a suspension, a downgrade or a dismissal; within 14 days of the step (Fauzan, 8 Nov 2026: yes). The guard lodges it on their own sign-in, or the company or HR records it from the letter. The HR Director (CoS or DCoS) or the CEO decides, with written reasons, never the person who recorded the step or who is part of the case: upheld, varied to a lighter step, or overturned. An overturned step no longer counts on the discipline ladder. Fauzan, 8 Nov 2026 confirmed the 14 days and that the HR Director or the CEO decides, never someone who made the original decision. Industrial Relations Act 1967 s.20 representations stay open to a dismissed worker whatever the appeal decides.",
  ),
  policyLanguages: rule(
    'HR-POLICY-LANG',
    { required: ['en', 'ms'], siteRosterDays: 30 },
    'Policy',
    "IKEA IWAY audit finding (Fauzan, 6 Nov 2026): HR builds and governs the handbook and code of conduct, for everyone, a specific job or a specific site. Every version has an English and a Malay copy; each worker also gets a copy in their mother tongue (Nepali for Nepali workers unless HR sets otherwise). Prima records the language each worker signed or was briefed in, and shows HR the mother tongues still missing a copy. A material change needs the translations again. A site policy reaches people rostered at that site within 30 days either side of today (Fauzan, 8 Nov 2026: yes). More languages are added when needed (Fauzan, 8 Nov 2026: not yet). Translations are made and checked by people HR names; Prima never machine-translates a policy.",
  ),
  officeOsh: rule(
    'HR-OSH-OFFICE',
    { coordinatorMinStaff: 5, reviewMonths: 12, reportDays: 7 },
    'Law',
    "HR Phase 3, OSH for office staff (Fauzan, 2 Nov 2026: OSH coordinator, office risk assessment and the DOSH report, 'do it also'). OSHA 1994 (as amended 2022) s.29A: an employer with 5 or more employees appoints an OSH coordinator, unless it has a safety and health officer; s.18B: the employer carries out a risk assessment (HIRARC) and acts on it; Prima suggests a review every 12 months. NADOPOD Regulations 2004: a death or serious bodily injury is notified to DOSH at once by the quickest means, and every accident, dangerous occurrence, poisoning or disease goes on form JKKP 6 (JKKP 7 for a disease) within 7 days; the JKKP 8 yearly summary by 31 January. HR keeps these records and files with DOSH; Prima never files.",
  ),
  hrDevelopment: rule(
    'HR-DEVELOP',
    { ratingMin: 1, ratingMax: 5, staffReplyDays: 14 },
    'Policy',
    "HR Phase 3, slice 3F (Fauzan, 2 Nov 2026: appraisal and training 'do it'; payslips delivered in app for staff to download; handbook, code of conduct and IT-use acknowledgements 'do it also'). HR keeps each staff member's training record, with the HRD Corp claim reference where the levy pays (PSMB Act 2001). A yearly appraisal is rated 1 to 5 by an appraiser HR names, never the staff member; the staff member reads it and may add a comment (Prima suggests within 14 days); HR closes it. Every active office staff member acknowledges the latest version of each policy HR publishes; a new version asks again. Appraisal is not the KPI, which is on hold until pilot test 1.",
  ),
  minimumWage: rule(
    'HR-MIN-WAGE',
    { monthly: 1700, from: '2025-02-01', before: 1500 },
    'Law',
    "HR Phase 3, slice 3D (Fauzan, 2 Nov 2026: minimum wage yes). Minimum Wages Order 2024: RM1,700 a month from 1 February 2025 (1 August 2025 for employers of fewer than five), RM1,500 before. Prima flags a basic pay below it on the staff payslip and on guards from JA; HR corrects it. Prima never pays less on its own.",
  ),
  staffOvertime: rule(
    'HR-OT',
    { enabled: false, normal: 1.5, restDay: 2, publicHoliday: 3, eaWageCap: 4000, daysDivisor: 26, hoursPerDay: 8 },
    'Law',
    "HR Phase 3, slice 3D (Fauzan, 2 Nov 2026: 'Prepare the details but will not start it only if needed. HR will put which is needed and the calculation rates. As a lot of staff are 4000 above salary.'). Employment Act s.60A(3): overtime at least 1.5 times the hourly rate on a normal day; s.60(3) rest day 2 times; s.60D public holiday 3 times. Hourly rate = monthly basic / 26 / 8 (s.60I). The Act's overtime rules cover staff earning up to RM4,000 (First Schedule, 2022). Off until HR switches it on and names the staff it applies to.",
  ),
  hostelBillReminders: rule(
    'FWM-HOSTEL-BILL',
    {
      remindDays: [14, 7, 3],
      ladder: [
        { overdueDays: 1, to: 'Chief of Staff' },
        { overdueDays: 7, to: 'COO' },
        { overdueDays: 14, to: 'CEO' },
      ],
    },
    'Policy',
    'Fauzan, 26 Oct 2026: hostel billing reminds the company that owns or rents the hostel to ask for payment approval, sent to FWM; the Operations Director (private) or OGM (government) approves, then the COO; FWM keeps the approvals and the payment slip. Reminder days 14, 7 and 3 before due, then daily, and the overdue ladder (Chief of Staff from day 1, COO from day 7, CEO from day 14) are proposed. Approved by Fauzan, 11 Nov 2026 (round 3, G11).',
  ),
  utilityAllowance: rule(
    'FWM-UTILITY',
    { electricity: 30, water: 20, noticesBeforeDeduction: 2, maxDeductionShareOfBasic: 0.5 },
    'Policy',
    'Fauzan, 26 Oct 2026: the system works out each hostel electricity and water bill above RM30 (electricity) and RM20 (water) per person a month, pro-rated by bed-days, and HR decides per person: a notice or a deduction. The 1st and 2nd time are notices only; from the 3rd a deduction may be chosen, only when the contract of employment has the utility clause. The count never resets. Legal item L4: Practice (JTK verbal, Fauzan 26 Oct 2026); JTK written confirmation not on file yet. Total deductions in a month kept within 50% of wages (Employment Act s.24(8), check proposed). Approved by Fauzan, 11 Nov 2026 (round 3, G11).',
  ),
  fleetReminders: rule(
    'FLEET-REMIND',
    { renewalDays: 30, serviceDays: 14, serviceKm: 500, paymentDays: 7, deviceSilentMinutes: 30 },
    'Policy',
    'Fauzan, 26 Oct 2026: the Transport head is reminded of everything about each vehicle: renewals (road tax, insurance, PUSPAKOM, permits), servicing and payments. Proposed: renewals from 30 days before, servicing 14 days or 500 km before, payments 7 days before; a tracker or dashcam silent over 30 minutes shows as unknown to CMS.',
  ),
  clientCare: rule(
    'OPS-CLIENT-CARE',
    {
      visitEveryDays: 30,
      reportByDay: 7,
      invoiceByDay: 10,
      lowScore: 2,
      ratingEveryDays: 90,
      contractWarnDays: 60,
      billingOverdueDays: 30,
      /** A low rating needs a visit or meeting within this many days (proposed). */
      followUpDays: 7,
      /** A complaint open longer than this is overdue (proposed). */
      complaintDays: 7,
      /** This many complaints in 90 days is a warning (proposed). */
      complaintsWarn: 3,
    },
    'Policy',
    "Fauzan, 26 Oct 2026: the COO monitors client relations, onboarding and offboarding, maintenance, reports done or not, satisfaction, documents and billing; each company manager monitors their own; Operations Managers, the Operations Director and officers act. Proposed: a visit or meeting every 30 days, the monthly report by the 7th, a satisfaction rating every 90 days (2 or less is low), contract renewal from 60 days, billing overdue over 30 days. Fauzan, 26 Oct 2026: each month's client invoice is recorded with proof of sending within 10 days after the month ends. Fauzan, 2 Nov 2026: client satisfaction must be monitored. Each rating names who at the client gave it and how; a low rating needs a visit or meeting within 7 days (proposed); a complaint is overdue after 7 days open (proposed); 3 complaints in 90 days is a warning (proposed); a fall of 2 points or more is a warning.",
  ),
  assetMgmt: rule(
    'AM-WATCH',
    {
      arrearsDays: [30, 60, 90],
      tenancyWarnDays: 90,
      dueWarnDays: 30,
      vacantWarnDays: 60,
      stockTakeMonths: 12,
      /** Cash rent must be banked within this many days of receipt (proposed). */
      cashBankDays: 2,
      /** An unpaid unit's status is updated at least this often until it is paid (Fauzan, 27 Oct 2026). */
      followUpEveryDays: 10,
    },
    'Policy',
    'Fauzan, 26 Oct 2026: Asset Management runs 450 rental units, every non-electronic asset, 2 resorts, 6 orchards and a training facility; the Chairman and Vice Chairman monitor it, the CEO oversees, the Finance Director manages its finances. Only group leadership and the finance staff who oversee it see its data. Proposed watch points: arrears at 30, 60 and 90 days; agreements from 90 days before they end; insurance, assessment and quit rent from 30 days; units vacant over 60 days; every asset checked once a year. Fauzan, 27 Oct 2026: the rental team records rent paid (cash, transfer, cheque, online) and follows up unpaid rent; cash needs a receipt number and Finance confirms it is banked (proposed within 2 days); a reminder letter or notice of demand needs the Asset Director’s approval; a payment is reversed only with a reason, never deleted, and not after Finance has banked it. Fauzan, 27 Oct 2026: every unit with rent unpaid is followed up and its status updated at least every 10 days until it is paid, by call, WhatsApp, email or visit; a late update alerts the Asset Director; the reminder is written in Malay with English below. Approved by Fauzan, 11 Nov 2026 (round 3, G15).',
  ),
  act: rule(
    'ACT-PLAN',
    {
      dueDays: { high: 14, medium: 30, low: 60 },
      /** Days overdue before each level sees it: Chief of Staff, then COO, then CEO. */
      escalateDays: [1, 14, 30],
      /** Proposed: an owner who has not planned the fix this many days after a finding is raised gets a follow-up. */
      planDays: 5,
      /** Proposed: Enforcement follows up an open, overdue or reopened finding at least this often. */
      followUpEveryDays: 7,
      /** Fauzan, 2 Nov 2026: ACT verifies each workflow in the field, against its timing, every 6 months. */
      fieldCheckMonths: 6,
      /** Working day used to walk through a workflow's timing (pilot hours 8.30 to 5.30, Monday to Friday). */
      workDay: { start: '08:30', end: '17:30' },
      /** Proposed: days the Director gives a team to finish distributed work when no date is set. */
      assignDays: 14,
      /**
       * Two ACT teams (Fauzan, 2 Nov 2026), each 1 Auditor + 1 Enforcement officer. Both teams cover every workflow
       * (Fauzan, 2 Nov 2026): a finding stays with the team that raised it until it closes.
       */
      teams: [
        { id: 1, name: 'Team 1' },
        { id: 2, name: 'Team 2' },
      ] as { id: 1 | 2; name: string }[],
      areas: [
        { id: 'ATTENDANCE', name: 'Guard attendance and clocking', months: 6 },
        { id: 'PATROL', name: 'Patrols, incidents and cases', months: 6 },
        { id: 'ROSTER', name: 'Rostering and replacements', months: 6 },
        { id: 'LICENSING', name: 'Guard licensing, KDN vetting and CSG', months: 6 },
        { id: 'FWM', name: 'Foreign workers', months: 6 },
        { id: 'ARMS', name: 'Arms, vaults and armed jobs', months: 6 },
        { id: 'OSH', name: 'Safety and health at sites (OSHA)', months: 12 },
        { id: 'CLAIMS', name: 'Staff claims and leave', months: 12 },
        { id: 'PAYROLL', name: 'Payroll and statutory contributions', months: 6 },
        { id: 'BILLING', name: 'Contracts, billing and invoices', months: 6 },
        { id: 'TENDERS', name: 'Tenders, quotations and leads', months: 12 },
        { id: 'PURCHASING', name: 'Purchasing, suppliers and stock', months: 6 },
        { id: 'ETHICS', name: 'Anti-bribery, gifts and speak up (MACC s.17A)', months: 12 },
        { id: 'CORPORATE', name: 'Company secretary, audit, insurance and legal', months: 12 },
        { id: 'CREDIT', name: 'PWVSB credit and branches', months: 12 },
        { id: 'PDPA', name: 'Personal data (PDPA)', months: 12 },
        { id: 'IT', name: 'IT, backups and continuity', months: 12 },
        { id: 'ASSETS', name: 'Asset Management and fixed assets', months: 12 },
        { id: 'REPORTING', name: 'Monthly reports from departments and companies', months: 12 },
        /** Part U20 (Fitri package, 14 Nov 2026): the inventory workshop's action items, entered by ACT through the app. */
        { id: 'INV_WORKSHOP_2026', name: 'Bengkel inventori 2026', months: 12 },
      ] as { id: string; name: string; months: number }[],
    },
    'Policy',
    'Fauzan, 27 Oct 2026: ACT (Audit, Compliance and Transformation) monitors all compliance, audits every workflow, checks all discrepancies, finds solutions and leads the improvement. Confirmed by Fauzan 27 Oct 2026: fix within 14/30/60 days by severity; overdue findings shown to the Chief of Staff, then the COO after 14 days and the CEO after 30; high-risk workflows audited every 6 months, the rest yearly; improvements approved by the COO or CEO. Nothing is automatic discipline. Fauzan, 2 Nov 2026: ACT monitors all, with 1 Director and 2 teams of 1 Auditor and 1 Enforcement officer. Fauzan, 2 Nov 2026: both teams cover every workflow (no split); the ACT Director distributes the work to the two teams (audits, monthly report reviews, findings); ACT also monitors each department’s monthly report. Proposed: the Auditor audits and checks fixes, Enforcement follows up owners and does spot checks, only the Director closes a high finding; the 5-day plan follow-up and the 7-day follow-up cycle await Fauzan.',
  ),
  meetingPrep: rule(
    'MTG-PREP',
    {
      /** The checklist should be finished this many hours before the meeting starts. */
      readyHoursBefore: 24,
      common: [
        'Agenda sent to all attendees',
        'Previous minutes and open action items sent',
        'Papers and reports for each agenda item attached or sent',
        'Attendance confirmed',
        'Presenters briefed on their agenda items',
        'Room, Teams link and equipment checked',
      ],
      byKind: {
        board: ['Notice of meeting sent as the constitution requires', 'Quorum confirmed', 'Company secretary informed', 'Draft resolutions prepared'],
        management: ['Department reports collected'],
        operations: ['Attendance, absence and incident figures pulled', 'Open cases and client complaints listed'],
        department: [],
        client: [
          'Client contract, billing and payment status checked',
          'Open cases and complaints for the client listed',
          'Who presents what to the client agreed',
        ],
        // Part X (Fauzan, 14 Nov 2026): the company/department toolbox is the HQ status meeting; site safety talks are the OM's (X19).
        toolbox: ['Status pack built (Bina pek status)', 'Open lines from the last meeting listed', 'Attendance confirmed'],
        other: [],
      } as Record<'board' | 'management' | 'operations' | 'department' | 'client' | 'toolbox' | 'other', string[]>,
    },
    'Policy',
    'Fauzan, 27 Oct 2026: every scheduled meeting has an agenda and a pre-briefing checklist. Confirmed by Fauzan 27 Oct 2026: the checklist items per kind of meeting, and that it should be finished 24 hours before the meeting; the organiser can add their own items.',
  ),
  fixedAssets: rule(
    'AST-DEPN',
    {
      lifeYears: { FURNITURE: 10, FITTING: 10, RENOVATION: 10, OTHER: 10 } as Record<'FURNITURE' | 'FITTING' | 'RENOVATION' | 'OTHER', number>,
      fdApprovesUpTo: 10000,
      /** A written-off asset kept in use is checked again after this many months. */
      endOfLifeReviewMonths: 12,
      accounts: { expense: '910-000', accumulated: '160-900', disposalGainLoss: '911-000', cost: '160-000' },
    },
    'Policy',
    'Lives and limits confirmed by Fauzan 27 Oct 2026; the auditors still confirm the method. Straight line over the useful life with no residual value, starting the month after purchase (MFRS 116 / MPERS section 17 allow it; the auditors confirm the lives). Prima prepares the monthly journal per owner entity; Finance posts it in SQL Account and records the reference here. Disposals: the Finance Director approves a net book value up to RM10,000, the COO above that. Confirmed by Fauzan 27 Oct 2026, adding: an asset fully written off that can still be used is kept in use or refurbished, and reviewed again every 12 months; it is disposed only when it cannot be used or refurbished, and an asset in good condition cannot be put up for disposal once written off. Whether a refurbishment cost is added to the asset or expensed is for Finance and the auditors. Capital allowances for tax (Income Tax Act 1967 Schedule 3) are worked out in the year-end tax pack from the rates the Finance Director sets, confirmed from the published LHDN guidance (no tax agent: Fauzan, 11 Nov 2026, round 3 Q17).',
  ),
  staffPayroll: rule(
    'PAY-STAFF',
    {
      /** Staff are paid on this day of the same month (Fauzan, 11 Nov 2026), or the month's last day if shorter. */
      payDay: 29,
      unpaidDivisor: 26,
      /** SQL Account codes for the journal draft; Finance replaces these with the group's chart of accounts. */
      accounts: {
        salaries: '900-000',
        epfEr: '901-000',
        socsoEr: '902-000',
        eisEr: '903-000',
        hrd: '904-000',
        claims: '905-000',
        salaryPayable: '400-100',
        epfPayable: '400-200',
        socsoPayable: '400-300',
        eisPayable: '400-400',
        pcbPayable: '400-500',
        hrdPayable: '400-600',
        lindungPayable: '400-310',
        zakatPayable: '400-700',
      },
    },
    'Law',
    "Fauzan, 27 Oct 2026: guard and officer pay comes from the JA Group app; Prima builds payroll for staff. HR prepares, the Chief of Staff (or the Deputy) approves, then the COO approves (Fauzan, 1 Nov 2026; this replaced the Vice Chairman's monthly consent decided 26 Oct 2026), then Finance pays through the bank's payroll service and posts to SQL Account. The Vice Chairman consents to each salary amount when it is set each year or on review. Every approval carries a comment. Employment Act 1955 s.19: wages within 7 days after the month; s.60I: a monthly-paid employee's daily rate is the monthly pay divided by 26. EPF Third Schedule, SOCSO and EIS tables, HRD levy 1%, PCB from LHDN's e-PCB. Prima drafts files only and never files or pays. Fauzan, 11 Nov 2026: staff are paid on the 29th of the same month (was the 7th of the next month), so HR prepares and the Chief of Staff and the COO approve before the 29th; the Finance Director can change the day in the Finance settings.",
  ),
  it: rule(
    'IT-WATCH',
    {
      serviceMonths: 6, domainWarnDays: 60, sslWarnDays: 21, checkStaleHours: 24, warrantyWarnDays: 60, checkMonths: 6,
      /** Merdeka IT-POL-004 section 4 (Fauzan, 13 Nov 2026 "Use policy"): first-RESPONSE targets. P1-P3 in clock minutes, P4 in working days. */
      responseMinutes: { P1: 15, P2: 60, P3: 240 },
      p4ResponseWorkingDays: 1,
      officeHours: { start: '08:30', end: '17:30' },
      /** The person is reminded to confirm a fix on these days after it is resolved; after the last one the IT Manager chases. */
      confirmReminderDays: [3, 5],
      /**
       * Stage time frames (working days), late flags on a purchase, never blocks. Fauzan 14 Nov 2026 (Part V V-X6
       * "Create better timing") replaced the flow chart 2 defaults (3/3/3/1/1/3/1): review 1, assessment and
       * recommendation 2, approvals + budget + PO together 2, delivery = the chosen quote's lead time (this value only
       * when the quote has none), receive + inspect by the next working day, register and label together 1.
       */
      purchaseStageDays: { review: 1, recommend: 2, approve: 2, delivery: 2, inspect: 1, register: 1, label: 1 },
      /** V-X6: request to handover for a stock item in Malaysia, not counting supplier lead time beyond 2 days. */
      wholePurchaseWorkingDays: 5,
      supplierLeadFreeDays: 2,
      /** V-X6 ICT disposal (working days): inspection + repair decision 3; approvals together 2; data wipe + certificate 2 after approval; whole 7 to "ready for contractor". */
      disposalStageWorkingDays: { inspect: 3, approve: 2, wipe: 2, whole: 7 },
      /** V9: a Microsoft 365 account ready within 2 working days of the CoS approval; the IP register updated within 3 working days of a change. */
      accountReadyWorkingDays: 2,
      ipRegisterWorkingDays: 3,
      /** Purchase and disposal records are kept at least this long (Q-D3); Prima deletes nothing. */
      retentionYears: 5,
      /** Disposal inspection target in calendar days (flow chart 4), kept for reference; V-X6 uses disposalStageWorkingDays. */
      disposalInspectDays: 14,
      /** Merdeka rental agreement Jadual B (Fauzan, 14 Nov 2026): refurbish every 36 months, end-of-life review 48 (phones and tablets 36), maintenance every 6. */
      refurbishMonths: 36,
      endOfLifeMonths: { default: 48, PHONE: 36, TABLET: 36 } as Record<string, number>,
      maintenanceMonths: 6,
      /** Disposal approvers (Q-X5): IT Manager, then the head of the company using the device, then HQ. */
      disposalHq: 'coo' as 'coo' | 'ceo',
    },
    'Policy',
    'Fauzan, 27 Oct 2026: the IT department (IT Manager, IT Lead, 4 IT Executives) runs the full lifecycle of every IT and electronic asset (buying, maintenance, repair, disposal), monitored by the COO and overseen by the CEO; it monitors the domains and websites, prepares the IT part of tenders, troubleshoots, teaches Microsoft 365 and onboards new staff. Proposed: domains renewed 60 days before expiry, certificates 21 days; a site not checked in 24 hours is unknown; help requests answered within 4, 24 or 72 hours by priority; every asset health/condition inspected every six calendar months (Fauzan, 1 Nov 2026); unknown inspection history requires an initial check, and generic inventory/service checks do not satisfy this; a disposal needs the IT Manager; the IT Manager agrees each purchase need (the COO when the IT Manager asks) and Procurement buys it; CCTV, network and printers serviced every 6 months. Merdeka IT policies, 13 Nov 2026 (Fauzan\'s answers Q-X1 to Q-X9): help requests have four priorities with first-RESPONSE targets (P1 15 minutes, P2 1 hour, P3 4 hours, P4 1 working day in office hours 8.30-5.30, Monday to Friday, national public holidays); the old fix limits (4, 24 and 72 hours) are no longer targets and the resolved time is kept for information only; purchase stages carry the flow chart time frames as late flags; purchase and disposal records are kept at least 5 years; a disposal is approved by the IT Manager, the head of the company using the device and the COO as HQ (Q-X5), each with a reason, never by whoever asked or inspected; devices are refurbished every 36 months, reviewed for end of life at 48 (phones and tablets 36) and maintained every 6 months (Fauzan, 14 Nov 2026). Fauzan, 14 Nov 2026 (Part V V-X6 "Create better timing"): purchase review 1, assessment 2, approvals + budget + PO 2 working days, delivery by the quoted lead time, receive and inspect by the next working day, register and label 1; a stock item in Malaysia 5 working days from request to handover (supplier lead time beyond 2 days not counted); ICT disposal inspection 3, approvals 2, data wipe and certificate 2, whole 7 working days to ready for the contractor; the IT Manager may change them with a reason; late is a flag, never a block. V9 (IT briefing 22 Oct 2026): a Microsoft 365 account ready within 2 working days of the CoS approval; the IP register updated within 3 working days of a website, domain or system change.',
  ),
  pilot: rule(
    'PILOT-IT',
    { on: true, area: 'it' as const, leaders: ['coo', 'ceo'] as ('coo' | 'ceo')[], stack: 'Microsoft 365 Business Basic' },
    'Policy',
    'Fauzan, 28 Oct 2026: the system is built for the IT department first; every other department and company is not part of the system yet, and IT must understand how it works before more are added. Only IT staff, the COO and the CEO sign in. Everyone else reaches IT the way they do today (Teams, email, phone, in person) and IT records it. The group runs Microsoft 365 Basic, so Prima works around it: approvals in Teams, files in SharePoint and OneDrive, no device management (Intune) and no Power Automate premium connectors.',
  ),
  itBuy: rule(
    'IT-BUY',
    { quotesNeeded: 3, onlineChecksNeeded: 1, onlineTolerancePct: 5, approvers: ['coo', 'ceo'] as ('coo' | 'ceo')[] },
    'Policy',
    'Fauzan, 27 and 28 Oct 2026: every IT and electronic purchase follows the group buying rule: three supplier quotes and an online or marketplace price check, all with documents; the chosen quote more than 5% above the online price needs a reason (10% proposed, cut to 5% by Fauzan on 28 Oct); the COO and then the CEO approve before anything is bought; approvals are given in Microsoft Teams (Approvals) or in Prima; the approval then goes to Finance, who pay. IT receives and tags the goods against the delivery order. During the pilot IT runs these steps itself because Procurement and Finance are not on the system yet. Merdeka IT policies, 13 Nov 2026 (Q-X3 "Prima"): the counts stay 3 supplier quotes and 1 online price with the 5% tolerance; each quote now records its type (physical or online), number, date, warranty, lead time, payment terms, contact and expiry, and IT (the IT Lead or an IT Executive, never the IT Manager who agrees the need) recommends one with a reason. Q-X4: the assigned Merdeka Finance person records the budget check before the PO; two payment routes: (a) pay after delivery and invoice match, the default, or (b) pay before delivery when the supplier\'s terms need it, covered by the same COO and CEO approval, with delivery, inspection and invoice match recorded afterwards and an undelivered paid purchase flagged after the quoted lead time. A staff claim for IT equipment or software without an approved IT purchase is refused (circular MN/CIR/IT/003/2026 point 3).',
  ),
  itTender: rule(
    'IT-TENDER',
    {
      /** [key, label, owner, starts after (null: when found), target minutes (null: a dated event)]. */
      tender: [
        ['found', 'Logged from eP; IT codes and MOF certificate checked', 'manager', null, 30],
        ['go', 'Go or no-go decided (codes, certificate, value, site)', 'manager', 'found', 30],
        ['download', 'Tender document bought or downloaded in eP', 'exec', 'go', 30],
        ['askdocs', 'Company papers asked from the company', 'manager', 'go', 30],
        ['read', 'Arahan kepada petender read and the IT checklist made', 'exec', 'download', 60],
        ['briefing', 'Briefing or site visit attended (when compulsory)', 'exec', 'read', null],
        ['draft', 'IT parts drafted: proposal, specifications, compliance table, price', 'exec', 'read', 360],
        ['check', 'Technical check by the IT Lead', 'lead', 'draft', 60],
        ['gotdocs', 'Company papers received', 'manager', 'askdocs', 1440],
        ['price', 'Price agreed with the company manager', 'manager', 'check', 60],
        ['leaders', 'Price seen by the COO or CEO', 'leader', 'price', 60],
        ['handover', 'Bid pack handed to the company', 'manager', 'leaders', 30],
        ['submit', 'Submitted in eP by the IT tender executive and the slip saved', 'exec', 'handover', 60],
        ['confirm', 'Company checked in eP that the bid is submitted', 'manager', 'submit', 30],
        ['result', 'Opening result or award recorded', 'manager', 'confirm', null],
      ] as [string, string, 'manager' | 'exec' | 'lead' | 'leader', string | null, number | null][],
      quotation: [
        ['found', 'Logged from eP; IT codes and MOF certificate checked', 'manager', null, 15],
        ['go', 'Go or no-go decided', 'manager', 'found', 15],
        ['download', 'Quotation document downloaded in eP', 'exec', 'go', 15],
        ['askdocs', 'Company papers asked from the company', 'manager', 'go', 15],
        ['read', 'Quotation instructions read and the IT checklist made', 'exec', 'download', 60],
        ['draft', 'IT parts drafted, with the price', 'exec', 'read', 240],
        ['check', 'Technical check by the IT Lead', 'lead', 'draft', 30],
        ['gotdocs', 'Company papers received', 'manager', 'askdocs', 480],
        ['price', 'Price agreed with the company manager', 'manager', 'check', 30],
        ['leaders', 'Price seen by the COO or CEO', 'leader', 'price', 30],
        ['handover', 'Bid pack handed to the company', 'manager', 'leaders', 15],
        ['submit', 'Submitted in eP by the IT tender executive and the slip saved', 'exec', 'handover', 30],
        ['confirm', 'Company checked in eP that the bid is submitted', 'manager', 'submit', 15],
        ['result', 'Result recorded', 'manager', 'confirm', null],
      ] as [string, string, 'manager' | 'exec' | 'lead' | 'leader', string | null, number | null][],
    },
    'Policy',
    'Fauzan, 28 Oct 2026: all IT tenders come from eP (ePerolehan) or other government tenders. The IT Manager finds them and deals with the company holding the IT codes; one IT Executive is paired with the IT Manager and does every IT tender; the IT Lead checks the technical part; the COO or CEO sees the price before the bid pack is handed over; the IT tender executive submits in eP and the company then checks in eP that it is in (Fauzan, 28 Oct 2026, on the study). Every stage has a target time in minutes and its clock starts when the stage before it is done, because the earlier the bid is in, the better its chances; the closing date is only the last line, and the bid goes into eP at least a day before it. Minutes as edited by Fauzan on 28 Oct (reading 60, drafting 360): an open tender is about 13 hours of IT work, but the company\'s papers (a day) set the pace, so about 27 hours from found to submitted; a quotation about 9.5 hours. Asking the company for its papers in the first hour is what makes it fast. Government practice (Treasury procurement circulars, to confirm for each notice): an open tender is advertised for at least 21 days and a quotation for at least 7; the closing time on the notice is final in eP.',
  ),
  itRental: rule(
    'IT-RENTAL',
    {
      /** Monthly rent per device, RM. MADE UP for the test (Fauzan, 28 Oct 2026: real prices given when pilot phase 1 goes live). */
      monthly: { LAPTOP: 120, DESKTOP: 90, PHONE: 45, TABLET: 40, PRINTER: 80, NETWORK: 60, CCTV: 150, OTHER: 30 } as Record<string, number>,
      billByDay: 7,
    },
    'Unverified',
    'Fauzan, 28 Oct 2026: the IT department works through Merdeka Network Sdn Bhd. Merdeka employs and pays the IT team, pays every IT cost and bills from itself; every device is owned by Merdeka and rented to the group companies. Each month Merdeka bills each company for the devices it has in use or in repair (spares are not billed); Fauzan, 1 Nov 2026: the IT Manager enters actual rental rates, IT staff prepare billing records and migrate existing asset/actual historical billing records, while Finance retains payment-record authority. Stored monthly values here are DEMO SIMULATION ONLY and are never a production fallback; real preparation requires effective-dated Manager-entered rates and immutable snapshots. Proposed: the bill goes out by the 7th of the month.',
  ),
  itPlan: rule(
    'IT-PLAN',
    // No fixed job limit and no fixed plan dates: plan what the work needs (Fauzan, 28 Oct 2026).
    { weekCap: null as number | null },
    'Policy',
    "Fauzan, 28 Oct 2026: the IT Manager makes sure the team's work is planned properly for the whole week, month and year, and Arisha helps the manager plan (she suggests; the manager decides and gives each job). The plan lays out the regular work from the registers (servicing every 6 months, six-calendar-month health inspections from recorded inspection history, domain and certificate renewals, 90-day access reviews, tender closing dates) and each person's jobs. Fauzan, 28 Oct 2026 (go-live): no fixed limit on jobs a week and no fixed date to give out the plan; plan what the work needs. A week or month ahead with nothing planned for an IT Lead or Executive is still flagged.",
  ),
  itJobs: rule(
    'IT-JOBS',
    { cooAfterDays: 3, ceoAfterDays: 7, accessReviewDays: 90, ticketCooAfterHours: 24 },
    'Policy',
    'Fauzan, 28 Oct 2026, making IT the pilot: the IT Manager is an administrator who makes sure the team does the job, not a technical post; the IT Lead holds the technical know-how; the CEO is the owner and master administrator of every system, domain and account, and IT staff only operate them. Approved by Fauzan on 28 Oct 2026 (D1 to D5): every job has a named doer and a due date and is submitted with proof; a technical job is checked by the IT Lead before the IT Manager accepts it; nobody accepts their own work; a job late 3 days goes to the COO and 7 days to the CEO; a help request past its time limit by 24 hours goes to the COO; the person who asked confirms the fix (Merdeka IT policies, 13 Nov 2026, Q-X2: a request closes ONLY when the person confirms; the old 3-day auto-confirm is removed; the person is reminded on day 3 and day 5, then the IT Manager sees it waiting for confirmation and chases; IT may record a confirmation given by phone, Teams or email with how it was given, never for its own fix; a help request whose first response is late by 24 hours goes to the COO); the CEO alone grants or removes access and reviews each access list every 90 days; while the IT Manager is away the COO accepts finished work; the IT Manager is not given technical jobs but runs the IT tenders: finds them, deals with the companies holding IT codes and gives each part to an IT Executive.',
  ),
  payFormulas: rule(
    'PAY-FORMULA',
    { scopes: ['site', 'company', 'region', 'group'], standardRestHours: [2, 2.5, 3], shiftHours: 12, fullMonthDays: 26, orpDivisor: 26 },
    'Policy',
    'Fauzan, 5 Nov 2026: the guard salary formula can be set per site, per company, per region or for the whole group, all set by the ACT Director; the standard formula is a full month of 12-hour shifts with 2, 2.5 or 3 hours of rest a day; drivers have an overtime formula; ACT sets the amounts in every formula. Later the same day: ACT sets the overtime formula for everyone (staff overtime too); the ACT Director’s amounts are saved as chosen and labour law is only a flag to the CEO; security guards are exempt from the hours limits. Fauzan, 6 Nov 2026, the usual guard rules (the standard default, ACT can change them): basic covers 45 hours a week, one rest day a week (6 days of 7.5 hours); overtime on a working day 1.5x the hourly rate; on a rest day the first 7.5 hours are one day’s pay and overtime past them 2x; on a public holiday 2 days’ pay for the normal hours and overtime 3x. Hourly rate = basic / 26 / 7.5 = basic / 195, the same as basic x 12 / 52 weeks / 45 hours. The ACT team prepares, the ACT Director makes it live and decides where it is used, with a reason each time; the narrowest choice wins (site, company, region, group). A formula starts this month or later, never in the past. Employment Act 1955 points flagged: minimum wage (Minimum Wages Order 2024, RM1,700), normal hours at most 8 a day and 45 a week (s.60A(1)), overtime at least 1.5x on a working day (s.60A(3)), 2x on a rest day (s.60(3)), 3x on a public holiday (s.60D(3)), rest-day work one extra day and holiday work two extra days; daily rate = monthly / 26, hourly = daily / normal hours (s.60I). Pay below that floor is flagged on the formula and on the CEO’s home, never refused; guard formulas carry no hours-limit flags (exemption), only the rest-break rule. Only entries that cannot be counted are refused.',
  ),
  rosterEngine: rule(
    'ROSTER-ENGINE',
    { onByDefault: false, approval: 'OM prepares -> Area/Zone Supervisor verifies (where the site has one) -> OD (private) / OGM (government) publishes', clientLimitsBlock: true, lawPointsFlag: true },
    'Policy',
    'Proposed, Part O (Fauzan, 13 Nov 2026): ALL sites go on the roster engine in batches, switched on per site (PO-1); client limits block publishing a roster, Employment Act points are flags to the CEO (PO-2); HR does not check guard rosters (PO-5). Roster and pay pack v3 (14 Nov 2026) is a draft for HR/Legal sign-off.',
  ),
  rosterBreaks: rule(
    'ROSTER-BREAKS',
    { unpaidOnlyIfConfirmedAndRelieved: true, interruptedMinutesPaid: true, singleGuardNoUnpaidBreak: true, needsClientPermission: true },
    'Policy',
    'Proposed, Part O O6 and v3 section 5: an unpaid break is only time confirmed taken AND relieved with the client\'s written permission; interrupted minutes are paid; IKEA breaks are paid by IKEA and never deducted (Fauzan, 13 Nov 2026, L2).',
  ),
  payHybrid: rule(
    'PAY-HYBRID',
    { modes: ['count_days', 'roster_hybrid', 'hourly'], defaultMode: 'count_days', incompleteMonth: 'working_days', offDayWork: 'same_as_rest_day', lumpSumConsentNeverWaives: true },
    'Policy',
    'Proposed, Part O O7/O8 (Fauzan, 13 Nov 2026): pay mode per site on the ACT Director formula (PO-4); part month = basic / the site\'s normal working days (IKEA 22, some 24, default 26) (PO-3, 23:13Z); OFF-day work at fixed base x1 / x2 or the statutory amount if higher (23:16Z); OT rate the higher of company and statutory. Lump-sum agreements built fully (Fauzan, 14 Nov 2026): a target never lowers what is due. Guard pay stays trial (PAY-GUARD).',
  ),
  guardPayroll: rule(
    'PAY-GUARD',
    {
      payByDay: 7,
      /** Off while the JA Group app still pays guards: runs are side-by-side trials, never marked paid. Fauzan picks the switch date. */
      primaPays: false,
      /** Fauzan, 8 Nov 2026: Prima takes over guard pay on this date. */
      switchDate: '2027-08-01',
      /** SQL Account codes for the journal draft; Finance replaces these with the group's chart of accounts. */
      accounts: {
        wages: '910-000',
        epfEr: '911-000',
        socsoEr: '912-000',
        eisEr: '913-000',
        hrd: '914-000',
        wagesPayable: '410-100',
        epfPayable: '410-200',
        socsoPayable: '410-300',
        lindungPayable: '410-310',
        eisPayable: '410-400',
        pcbPayable: '410-500',
        hrdPayable: '410-600',
        utilityRecovered: '415-000',
      },
    },
    'Policy',
    "Fauzan, 5 Nov 2026 (third audit, item 1: Build): Prima runs its own monthly guard pay from attendance under the ACT pay formulas (PAY-FORMULA), with payslips and a bank file. Fauzan, 26 Oct 2026: the COO approves all guard and officer salaries. HR prepares each company's month, the COO approves with a reason, Finance pays through the bank; Prima only drafts the files. Fauzan, 11 Nov 2026 (B1): each company prepares its own month; the Company Manager names the preparer(s) with a reason; the OM does not prepare (HR keeps preparing until the CEO installs module guard-pay-preparers-v1). Fauzan, 5 Nov 2026 00:55Z: the JA Group app keeps running until he picks a switch date, so until then a run is a side-by-side trial compared with JA's figures and cannot be marked paid. Fauzan, 8 Nov 2026: Prima takes over guard pay on 1 August 2027 (switchDate); until then the JA Group app keeps paying guards and Prima pay runs are side-by-side trials only, and the guard pay database is installed later as its own step. primaPays stays off until the switch is made on that date. Employment Act 1955 s.19: wages paid within 7 days after the wage period. KWSP: overtime is not wages for EPF. Public holidays are entered by HR from the gazette for each month; none are assumed.",
  ),
  payLaw: rule(
    'PAY-LAW-CEO',
    { setter: 'ceo', byMonth: true, defaults: 'EA 1955 as at Nov 2026' },
    'Policy',
    'Fauzan, 6 Nov 2026: the CEO sets the base salary and, when a new law comes in, how salary and the base are counted: the day divisor, minimum wage, overtime minimums and limits, from a month with a reason. Formulas and flags follow the version in force. EPF, SOCSO and other contributions are set in the pay runs.',
  ),
  payRestBreak: rule(
    'PAY-REST-BREAK',
    { relievedOnly: true, minBreakHours: 0.5 },
    'Law',
    'Rest inside a shift is unpaid only when it is a real break: the guard is relieved from the post (a relief guard covers, or the guard may leave). A guard who must stay at the post is working, so the rest is paid as work. Employment Act 1955 s.60A(1)(a): a break of at least 30 minutes after 5 hours of work. Counsel to confirm for the shift-work exemption.',
  ),
  siteHours: rule(
    'SITE-HOURS',
    { approverPrivate: 'ops_director', approverGovernment: 'ogm', reasonRequired: true },
    'Policy',
    'Fauzan, 6 Nov 2026: guard total hours are watched when salary is done. A site that needs 2 guards per 12-hour shift for a 30-day month needs 4 people and cannot go over 1,440 man-hours (guards per shift x hours covered a day x days in the month, added up for every post). Any total above that is flagged, and the Operations Director (private site) or the OGM (government site) approves the extra hours with a reason before salary, usually for training, annual leave or on-the-job training.',
  ),
  guardPublicHolidays: rule(
    'PAY-PUBLIC-HOLIDAYS',
    { perYear: 11, dueDay: 10, remindFrom: 1, setters: ['ops_director', 'ogm'] },
    'Law',
    'Employment Act 1955 s.60D: 11 paid public holidays a year, five of them National Day, the Agong’s birthday, the Ruler’s birthday or Federal Territory Day, Labour Day and Malaysia Day; the list is posted at the workplace before the year starts. A holiday on a rest day moves to the next working day; a holiday during annual or sick leave is a holiday, not leave; absence without consent on the working day before or after loses that holiday’s pay (s.60D(2)). Fauzan, 6 Nov 2026: the Operations Director or the OGM (not the OM) sets the 11 days for each year by 10 December; a guard not working on a holiday is still paid 7.5 hours, one normal day.',
  ),
  lindung: rule(
    'PAY-LINDUNG',
    {
      /** Employee-only rate by wage month, effective-dated; the employer pays nothing. Later steps to be confirmed with PERKESO. */
      rates: [
        { from: '2026-06', rate: 0.0075 },
        { from: '2028-06', rate: 0.01 },
        { from: '2031-06', rate: 0.0125 },
      ],
      wageCeiling: 6000,
    },
    'Law',
    "Employees' Non-Employment Injury Scheme (LINDUNG 24 Jam), PERKESO, from June 2026 wages: the employee pays 0.75% of wages up to RM6,000, the employer nothing; 1.00% from year 3 and 1.25% from year 6 (dates to confirm). Optional for Malaysians since 9 July 2026: deduct unless an opt-out form is on file. Always deducted for foreign workers. Shown in its own column, never added into normal SOCSO (Fauzan, 27 Oct 2026).",
  ),
  credit: rule(
    'CRD-COLLATERAL',
    {
      capSecuredPct: 12,
      capUnsecuredPct: 18,
      chargeLodgeDays: 30,
      chargeWarnDays: 20,
      /** Loan agreements are stamped within 30 days of signing (Stamp Act 1949 s.47A); a reminder from day 20 (5G). */
      stampDays: 30,
      stampWarnDays: 20,
      defaultCureDays: 14,
      /** Agreement templates counsel has approved for enforcement steps 7 to 9. None yet. */
      counselApprovedTemplates: [] as string[],
      enforcementSteps: [
        'Notice of default sent to the company',
        'Cure or standstill period agreed',
        'Meeting with the company board',
        'Collateral valued by an independent valuer',
        'Restructuring offered and answered',
        "Final demand through PWVSB's counsel",
        'Enforcement decision by the PWVSB board',
        'KDN and SSM clearance for any change',
        'Legal completion by the company secretary',
      ],
    },
    'Law',
    "V8 and V10 (24 Oct 2026): a beneficiary agreement is collateral only. A verified default automatically opens the enforcement workflow, never an ownership or share change. Moneylenders Act 1951 s.17A: interest at most 12% a year secured and 18% unsecured; s.29B bars oppressive recovery. Companies Act 2016 s.352: a charge is lodged with SSM within 30 days of creation. A missed instalment opens an investigation; a default is confirmed only when the bank and subledger are reconciled, no dispute or deferral is open and the cure period has passed, by the credit officer and then Finance (legal too on a template's first default). Steps 7 to 9 stay off until counsel approves the template; ownership records change only by the company secretary's verified update. Proposed step wording and 14-day cure, for counsel to confirm.",
  ),
  procurement: rule(
    'PUR-DOA',
    {
      /** Fauzan, 27 Oct 2026: every supply gets three quotes, whatever the amount. */
      quotesAbove: 0,
      quotesNeeded: 3,
      /** Online or marketplace prices checked for the same items before approval. */
      onlineChecksNeeded: 1,
      /** Part U U-X14 (Fauzan, 14 Nov 2026 "3 and 2"): office purchases need 3 shop quotes AND 2 online prices; store and site stock stays 3 + 1 (U-X15). */
      officeOnlineChecksNeeded: 2,
      /** A chosen quote dearer than the lowest online price by more than this % needs a reason (Fauzan, 27 Oct 2026). */
      onlineTolerancePct: 5,
      /** Approval by the COO and then the CEO (Fauzan, 27 Oct 2026). */
      approvers: ['coo', 'ceo'] as ('coo' | 'ceo')[],
      /** Invoice may differ from the order by at most this % (proposed). */
      matchTolerancePct: 1,
      supplierReviewDays: 365,
      /** Group companies are above the e-Invoice threshold, so every supplier bill needs the IRBM e-Invoice UUID. */
      eInvoiceRequired: true,
    },
    'Policy',
    'Fauzan, 27 Oct 2026: the Procurement and Inventory department (under the Operations General Manager, monitored by the COO and CEO; 1 executive and 2 storekeepers) buys all operational equipment for the group (walkie-talkies, uniforms, bodycams, translation devices, patrol devices, NFC tokens) and cleaning equipment and products, and follows each product through its life. Every supply gets 3 supplier quotes and is checked against online and marketplace prices; the COO and the CEO approve. The person who receives an item confirms it in their own details. V5 controls kept: MACC Act 2009 s.17A supplier due diligence (conflict-of-interest declaration, anti-bribery acknowledgement, Finance-verified bank account, yearly review); LHDN e-Invoice UUID before the bill is entered; the requester never approves, an approver never receives; uniforms and equipment are never charged to the guard (Employment Act 1955 s.24). The 10% online price tolerance was confirmed by Fauzan on 27 Oct 2026.',
  ),
  governance: rule(
    'GOV-AUTHORITY',
    {
      /** Mandates up for renewal show this many days before they end (Central Admin 5D: 90 days). */
      warnDays: 90,
      /** Fauzan's rule (V12, 24 Oct 2026): every company matter is controlled by the licensed company or monitored by it; PWVSB acts only under a live mandate. */
      areas: [
        { area: 'OPERATIONS', label: 'Operations, rosters and sites', company: 'Controls', pwvsb: 'Monitors; COO acts only under a mandate' },
        { area: 'HR_PAYROLL', label: 'Hiring, discipline and payroll', company: 'Controls (employer)', pwvsb: 'Monitors; central HR serves under a mandate' },
        {
          area: 'FINANCE',
          label: 'Bank accounts, payments and accounts',
          company: 'Controls (own bank and SQL Account)',
          pwvsb: 'Monitors; Finance serves under a mandate',
        },
        { area: 'PROCUREMENT', label: 'Buying and suppliers', company: 'Controls', pwvsb: 'Approves above the company limit under a mandate' },
        { area: 'CONTRACTS', label: 'Client contracts and tenders', company: 'Controls (signs)', pwvsb: 'Monitors' },
        { area: 'LICENSING', label: 'KDN licence and permits', company: 'Controls (licence holder)', pwvsb: 'Monitors' },
        { area: 'ARMS', label: 'Firearms and the vault', company: 'Controls (permit holder)', pwvsb: 'Arms Control coordinates; CMS monitors' },
        {
          area: 'CORPORATE',
          label: 'Board, shares and SSM filings',
          company: 'Controls (own board and secretary)',
          pwvsb: 'Approves changes where the agreement says so',
        },
        { area: 'IT', label: 'Devices, accounts and data', company: 'Uses', pwvsb: 'IT department serves the group' },
      ] as { area: GovArea; label: string; company: string; pwvsb: string }[],
      /** Who approves what, as decided so far. Each line names its source; 'proposed' lines wait for confirmation. */
      matrix: [
        { matter: 'Guard and officer salaries', approves: 'COO', source: 'Fauzan, 26 Oct 2026' },
        { matter: 'Staff payroll run (monthly)', approves: 'Chief of Staff approves, then the COO approves', source: 'Fauzan, 1 Nov 2026' },
        { matter: 'Staff salary amounts (set yearly or on review)', approves: 'HR proposes, Chief of Staff or Deputy verifies, Vice Chairman consents', source: 'Fauzan, 1 Nov 2026' },
        { matter: 'Office supplies, utilities and rent', approves: 'Company manager asks, Chief of Staff approves, COO final', source: 'Fauzan, 26 Oct 2026' },
        { matter: 'IT and electronic purchases', approves: 'IT Manager, then COO', source: 'Assumption, to confirm' },
        {
          matter: 'Operational and cleaning equipment purchases',
          approves: 'Procurement gets 3 quotes and the online price, then the COO, then the CEO',
          source: 'Fauzan, 27 Oct 2026 (PUR-DOA)',
        },
        { matter: 'Guard and officer leave', approves: 'Operations Manager or above', source: 'Fauzan, 25 Oct 2026' },
        { matter: 'Staff leave', approves: 'HR Administrator decides (Chief of Staff or Deputy if HR does not), Vice Chairman consents', source: 'Fauzan, 1 Nov 2026' },
        { matter: 'Staff HR in every company', approves: 'HR department governs with full authority; each company monitors its own staff, view only', source: 'Fauzan, 1 Nov 2026' },
        { matter: 'Memos to all staff / all guards', approves: 'Chief of Staff / COO', source: 'Fauzan, 26 Oct 2026' },
        {
          matter: 'Company SSM filings (annual return, accounts, change notices)',
          approves: 'Head office Corporate Admin (Deputy Chief of Staff) records; the Chief of Staff and the company secretary monitor; each company views and supplies papers',
          source: 'Fauzan, 1 Nov 2026',
        },
        { matter: 'Tender submission', approves: 'Preparer signs, then the company manager', source: 'Fauzan, 26 Oct 2026' },
        {
          matter: 'Corporate changes (directors, shares, bank signatories)',
          approves: 'Company manager asks; the Deputy Chief of Staff approves for PWVSB with a reason and the signed clause; the Chief of Staff monitors; then the company board',
          source: 'Fauzan, 24 Oct, 1 and 2 Nov 2026',
        },
        { matter: 'PWVSB credit default', approves: 'Credit officer and Finance Director (legal on first default)', source: 'V10' },
        { matter: 'Discipline', approves: 'The company decides; never automatic', source: 'Fauzan, 25 Oct 2026' },
      ],
    },
    'Policy',
    "V7, V8 and V12 (24 Oct 2026): PWVSB's authority comes mainly from management agreements and board mandates, not from share ownership; each company keeps its own licence, board, employment and accounts. Every PWVSB action is checked against a live grant. A mandate gives power only once the company's board has confirmed it and PWVSB legal has verified the signed copy; it warns 60 days before expiry and gives no power after it. Area wording is a proposal for counsel to confirm against the signed agreements.",
  ),
  assurance: rule(
    'AUD-GRC',
    {
      dueSoonDays: 30,
      /** Acknowledge a whistleblowing report within this many days (proposed). */
      whistleAckDays: 7,
      /** While a report is open the handler tells the reporter where it stands at least this often (RBA; approved by Fauzan 8 Nov 2026, "Policy yes proceed"). */
      whistleUpdateDays: 30,
      /** After closing, the reporter may still use the receipt code to report retaliation for this long (approved by Fauzan 8 Nov 2026, "Policy yes proceed"). */
      whistleAfterCloseDays: 365,
      /** Gifts above this value need a decision (proposed). Cash and anything with a public official always do. */
      giftDecisionAbove: 500,
      oshReviewMonths: 12,
      /** Who handles a whistleblowing report, in order, skipping anyone named in it or the reporter (proposed). */
      whistleHandlers: ['u-audit', 'u-chair', 'u-vchair'],
      obligations: [
        { stream: 'OSH', title: 'OSH coordinator appointed and named', basis: 'OSHA 1994 s.29A (5 or more employees), in force 1 Jun 2024', everyMonths: 12 },
        { stream: 'OSH', title: 'Risk assessment (HIRARC) reviewed for every site', basis: 'OSHA 1994 s.18B', everyMonths: 12 },
        {
          stream: 'OSH',
          title: 'OSH committee meeting held',
          basis: 'OSH (Safety and Health Committee) Regulations 1996, 40 or more employees',
          everyMonths: 3,
        },
        { stream: 'ANTI_BRIBERY', title: 'Anti-bribery risk assessment', basis: 'MACC Act 2009 s.17A, TRUST principle R', everyMonths: 12 },
        { stream: 'ANTI_BRIBERY', title: 'Anti-bribery training for managers and buyers', basis: 'MACC Act 2009 s.17A, TRUST principle T', everyMonths: 12 },
        { stream: 'ANTI_BRIBERY', title: 'Gifts and hospitality register reviewed', basis: 'MACC Act 2009 s.17A, TRUST principle S', everyMonths: 3 },
        { stream: 'TAX', title: 'PCB (MTD) paid by the 15th', basis: 'Income Tax (Deduction from Remuneration) Rules 1994', everyMonths: 1 },
        { stream: 'TAX', title: 'SST-02 return filed', basis: 'Service Tax Act 2018, two-monthly', everyMonths: 2 },
        { stream: 'TAX', title: 'Form E filed by 31 March', basis: 'Income Tax Act 1967 s.83', everyMonths: 12 },
        {
          stream: 'EMPLOYEE_RELATIONS',
          title: 'Grievance log reviewed',
          basis: 'Employment Act 1955 s.81H (harassment complaints); company policy',
          everyMonths: 3,
        },
        { stream: 'PRIVACY', title: 'Record of personal data processing reviewed', basis: 'PDPA 2010 as amended, in force 1 Jun 2025', everyMonths: 12 },
        { stream: 'CONTINUITY', title: 'Backup restored in a test', basis: 'Group continuity policy (proposed)', everyMonths: 6 },
        { stream: 'INTERNAL_AUDIT', title: 'Internal audit plan approved by the board', basis: 'Group policy (V15)', everyMonths: 12 },
        { stream: 'SUPPLIER', title: 'Supplier due diligence reviewed', basis: 'MACC Act 2009 s.17A, TRUST principle U', everyMonths: 12 },
        {
          stream: 'WELFARE',
          title: 'Worker accommodation inspected',
          basis: 'Employees Minimum Standards of Housing, Accommodations and Amenities Act 1990 (Act 446)',
          everyMonths: 6,
        },
        { stream: 'FRAUD', title: 'Payroll checked against attendance (ghost workers)', basis: 'Group policy (V15)', everyMonths: 1 },
      ] as { stream: GrcStream; title: string; basis: string; everyMonths: number }[],
    },
    'Policy',
    "V15 (24 Oct 2026): one obligation register and case engine across the workstreams; maker-checker everywhere; implicated people routed out; missing evidence is UNKNOWN, never green. Laws as cited per line (OSHA amendments in force 1 June 2024; MACC s.17A adequate procedures; PDPA amendments in force 1 June 2025; Whistleblower Protection Act 2010 protects disclosures to enforcement agencies, so the internal channel keeps the reporter's identity confidential). The gift limit, acknowledgement days and handler order are proposals for Fauzan to confirm.",
  ),
  corporate: rule(
    'COR-SECRETARY',
    {
      annualReturnDays: 30,
      fsCirculateMonths: 6,
      fsLodgeDays: 30,
      changeFileDays: 14,
      warnDays: 30,
      receiptWarnDays: 14,
      /** Audit signed within this many months of the year end, leaving a month to circulate (proposed). */
      auditSignMonths: 5,
      /** The group's panel of four audit firms (names to come; A-5). */
      auditorPanel: ['Audit firm 1 (mock)', 'Audit firm 2 (mock)', 'Audit firm 3 (mock)', 'Audit firm 4 (mock)'],
      legalStaleDays: 30,
      legalSoonDays: 7,
    },
    'Law',
    "V9 (24 Oct 2026) and Fauzan, 24 Oct 2026: every company keeps its own licensed secretary, filings and board; any change to a company's corporate structure needs PWVSB approval, citing the signed clause, before the board acts. Companies Act 2016: annual return within 30 days after the incorporation anniversary (s.68); a private company circulates its financial statements within 6 months of the year end (s.258) and lodges them within 30 days of circulating (s.259); changes of directors, secretary or beneficial owners notified within 14 days (s.58, s.236, s.60A). Only a licensed secretary lodges in MBRS. Prima never lodges, signs or files; a filing stays awaiting acknowledgement until the SSM receipt is recorded. Secretaries to confirm.",
  ),
  branches: rule(
    'BRN-CONTROL',
    { reviewDays: 3, pwvsbDays: 7 },
    'Policy',
    "V11, V12 and V12.1 (24 Oct 2026): a branch sits inside its licensed company (same licence, employer and accounts). Model A, the company keeps a signed % of eligible billing; B, the manager is salaried; C, the company keeps a signed % of net branch profit. Percentages come only from the signed agreement; a missing term holds the settlement for contract review. Settlements are held while a bank account is unreconciled, wages or EPF are unpaid, or the KDN licence has an issue; wages are never held and the company pays any Model A shortfall. Fauzan: every company matter is controlled or monitored by the company. Proposed: a branch action the company has not reviewed in 3 days goes to the Company Manager's home, and after 7 days to PWVSB.",
  ),
  contracts: rule(
    'CNT-MOBILISE',
    { majorAcceptMaxDays: 30, reviewDays: [1, 7, 14, 30], startWarnDays: 7, daysPerMonthM1: 30.5 },
    'Policy',
    'V6 amendment (24 Oct 2026) and the consolidated plan: a signed contract or letter of award opens mobilisation against 12 workstreams (W12 CMS activation, checked by Prima, masterplan §191) due from 10 days before to 30 days after the start. Critical items block go-live and cannot be risk-accepted; others may be risk-accepted by the company manager for up to 30 days (proposed, decision M-1). Go-live needs the Site Ready-to-Operate Certificate, then reviews at day 1, 7, 14 and 30; day 30 checks the first invoice against the contract. Billing Method 1 is hours a day x 30.5 x posts, 2 is the contracted hours, 3 is hours a day x days in the month, or a fixed monthly fee; the method never changes without a signed variation (Fauzan, 23 Oct 2026). Real use (5 Nov 2026): the signed paper is recorded with its copy; every item is done with proof or checked by the system (first-week roster, guard clearance, client contacts); a signed variation that adds a site or guards opens its own mobilisation and Ready-to-Operate; a renewal signed in Clients moves the contract end date. The company controls; PWVSB monitors.',
  ),
  finance: rule(
    'FIN-WATCH',
    { staleHours: 48, reconcileByDay: 10, closeByDay: 15, packWarnDays: 30 },
    'Policy',
    "Fauzan, 27 Oct 2026: Finance (the Finance Director and 7 teams of a team leader, a deputy and 2 data entry executives) keeps every company's books in SQL Account, which stays; Prima makes sure it is used fully. Proposed checks: figures from SQL Account not older than 48 hours (else Unknown); every bank account reconciled in SQL Account to last month end by the 10th; last month closed by the 15th; what Prima billed and paid is posted; integrity tests FS-01, FS-02 and FS-06 at exactly RM0.00 (V6). Tax: Form C within 7 months of the year end, Form E by 31 March, EA forms to staff by the end of February, CP204 instalments by the 15th of each month (Income Tax Act 1967). Data entry prepares, the team leader or deputy reviews, the team leader or Finance Director sends.",
  ),
  financeSqlPosting: rule(
    'FIN-SQLPOST',
    { senderEveryMinutes: 5, retryMinutes: [5, 15, 60, 240, 1440], checkAt: '06:00', stuckWorkingDays: 1, exceptionCheckWorkingDays: 3 },
    'Policy',
    'Fauzan, 13 Nov 2026 (Build 1): SQL Account stays the books; Prima posts approved, finished records into the right company\'s own SQL Account book through the vendor API only, never its tables. One installation, a separate book per company. A posting job is written in the same transaction that finishes the record; it waits, with its reason, until posting is switched on (SQL_POSTING_ENABLED, then the company, then the document type, each by the Finance Director or the CEO with a reason), the company\'s SQL Account set-up is confirmed with API = yes and every code it needs is entered and checked by a second person. Sender every 5 minutes, oldest first, one company at a time; a network error is retried after 5, 15, 60 and 240 minutes and the next day, then a person looks; a timeout after sending is looked up by our reference, never sent again. Daily check at 06:00: each posted document is read back and compared; jobs not posted after 1 working day, finished records with no job and records changed after posting are listed. Each exception is explained by Finance and checked by someone else; unchecked after 3 working days it shows on the Finance Director\'s home and holds the month-end close. Not posted in Build 1: client invoices (raised in SQL Account), guard and staff payroll, intercompany and other journals. Keys live only in Azure Key Vault.',
  ),
  jaGroupApp: rule(
    'SYS-JA-OWNS',
    {
      owns: [] as JaArea[],
      planned: ['payroll', 'incidents', 'hostels'] as JaArea[],
      staleHours: 24,
      payrollByDay: 7,
      papersWarnDays: 30,
      papersCeoDays: 7,
    },
    'Policy',
    "Fauzan, 26 Oct 2026: guard-to-officer payroll, foreign worker management and incidents are in the JA Group app, which is already built; the JA app sends its data to Prima by API. Fauzan, 27 Oct 2026: Prima's own screens stay on until that API is live; each area moves from planned to owns only when its feed is live, and Prima's version is then switched off (not deleted). Foreign worker hostels also run in the JA app (Fauzan, 27 Oct 2026). A feed silent for over 24 hours shows as unknown. Employment Act 1955 s.19: wages are paid within 7 days after the wage period, so last month's payroll not marked paid by the 7th is flagged. Papers: the JA app runs the renewals; Prima watches anything due within 30 days and puts 7 days or less in front of the CEO. Fauzan, 5 Nov 2026: the FWM permit board lives in both apps (rule FWM-BOTH-APPS), so FWM is no longer planned to move to JA only.",
  ),
  opsMeetings: rule(
    'OPS-MONTHLY-MEETING',
    { remindFromDay: 1 },
    'Policy',
    'Fauzan, 26 Oct 2026: the COO monitors all operations and holds a monthly operations meeting with each company under operations; reminded until held with minutes filed.',
  ),
  productCerts: rule(
    'PDPA-PRODUCT-CERT',
    { remindDays: 90, urgentDays: 30 },
    'Policy',
    'Fauzan, 26 Oct 2026: the PDPA officer keeps every product sold or rented to clients, its personal data details and its certificates (MySTI, SIRIM, MCMC or other bodies), with the renewal or how to obtain each. Proposed: remind 90 days before expiry, urgent from 30. A proposal is ready only when every product has its personal data details, valid certificates, and client consent planned where needed.',
  ),
  pdpaBreach: rule(
    'PDPA-BREACH',
    { commissionerHours: 72, subjectsDays: 7 },
    'Law',
    'Personal Data Protection (Amendment) Act 2024 s.12B and the PDP Commissioner breach notification guideline: notify the Commissioner within 72 hours of finding a breach, and the affected people within 7 days of notifying the Commissioner where it causes or is likely to cause significant harm. Fauzan, 26 Oct 2026: use as the basis; the PDPA officer handles it, the Operations Director monitors.',
  ),
  crm: rule(
    'CRM-LIFECYCLE',
    {
      /** A renewal opens this many days before the contract ends (Fauzan, 5 Nov 2026). */
      renewalOpenDays: 90,
      /** The company manager decides renew, new price, rebid or let go by this many days before the end (Fauzan, 5 Nov 2026). */
      decideByDays: 60,
      /** The renewal offer goes to the client by this many days before the end (Fauzan, 5 Nov 2026). */
      proposalByDays: 45,
      /** A client request with no date is due after this many days (proposed). */
      requestDays: 14,
      /** A client with no main contact on record is a warning; with none at all, unknown. */
      needsMainContact: true,
    },
    'Policy',
    'Fauzan, 4 Nov 2026: "Yes build that. We want complete" (a complete client CRM). One client lifecycle: sales lead, quotation or tender, won, contract, onboarding, service (visits, reports, ratings, complaints, client requests, invoices), renewal, offboarding, with the reason the client was lost. Each company sees only its own clients; group leadership sees all (group data rule, 26 Oct 2026). Fauzan, 5 Nov 2026, confirmed: a renewal opens 90 days before the contract ends; the company manager decides (renew, renew at a new price, rebid, or let go) with a reason by 60 days before; the offer reaches the client by 45 days before. Fauzan, 5 Nov 2026 (D4): sales is the company admin executives, monitored by the company manager; they open a won lead as the client. Still proposed: a renewal is accepted only with the signed paper and the new end date; a client request is due in 14 days unless the client gives a date; more or fewer guards is done only with the signed contract variation. Billing stays in SQL Account.',
  ),
  leads: rule(
    'CRM-LEADS',
    { staleDays: 14, wonNeedsAcceptedQuote: true },
    'Policy',
    'Masterplan V3 CRM (proposal): research every prospect before pricing (SSM search that the company is live, payment record, current provider, risks, armed work) and survey the site; a slow or unknown payer needs the company manager to accept the risk before a proposal. A lead with no next step for 14 days is stale. Won only on an accepted quotation; then open client onboarding. For Fauzan to confirm.',
  ),
  continuity: rule(
    'BCM-RTO',
    {
      restoreTestMonths: 6,
      drillMonths: 12,
      playbooks: [
        {
          id: 'PRIMA_DOWN',
          title: 'Prima is down',
          steps: [
            'IT confirms the outage and tells the COO and CMS',
            'Switch to the emergency server if not back within the RTO',
            'Sites use the paper clock-in sheet and patrol log',
            'Enter paper records within 24 hours of recovery, marked as late entries',
          ],
        },
        {
          id: 'CMS_DOWN',
          title: 'Command centre (CMS) down',
          steps: [
            'Head Control moves to the backup room or a mobile set',
            'Supervisors call in every hour by phone',
            'Arms movements are logged on paper at the vault and entered later',
            'COO decides when to return',
          ],
        },
        {
          id: 'SITE_OFFLINE',
          title: 'A site has no internet',
          steps: [
            'The site phone keeps clock-ins and patrol scans offline and sends them when back',
            'After 30 minutes of silence CMS calls the site',
            'If still offline after 2 hours, use the paper sheet',
          ],
        },
        {
          id: 'DATA_BREACH',
          title: 'Personal data breach',
          steps: [
            'Contain: lock the accounts or devices involved',
            'PDPA officer opens a breach case (Commissioner within 72 hours)',
            'IT keeps the logs; nobody deletes evidence',
            'Tell affected people within 7 days if harm is significant',
          ],
        },
        {
          id: 'RANSOMWARE',
          title: 'Ransomware or a wiped server',
          steps: [
            'Disconnect the affected server; do not pay',
            'Restore from the copy that was offline',
            'Report to CyberSecurity Malaysia and the police',
            'Check the restore against the last good backup before going live',
          ],
        },
      ],
    },
    'Policy',
    "V15 (24 Oct 2026) continuity workstream and Fauzan, 24 Oct 2026: all data in Malaysia, with a cloud copy, Fauzan's own server and an emergency server. Proposed targets: live operations (Prima, CMS) back within 4 hours losing at most 1 hour of data; finance (SQL Account) within 24 hours losing at most 24 hours. Restore test every 6 months and a playbook drill every year; a copy with no backup or restore test on record is unknown. Targets are proposals for Fauzan and IT to confirm. Approved by Fauzan, 11 Nov 2026 (round 3, G13).",
  ),
  pdpaRights: rule(
    'PDPA-RIGHTS',
    {
      dpoNotifyDays: 21,
      requestDays: 21,
      refusalGrounds: [
        'Identity could not be verified',
        'Not enough information to find the data',
        'Would disclose another person’s data without their consent',
        'Burden or expense disproportionate to the risk to the person',
        'Would breach a law or a court order',
        'Would disclose confidential commercial information',
      ],
    },
    'Law',
    'Personal Data Protection Act 2010: access requests answered within 21 days (s.31), correction within 21 days (s.35), refusal only on the s.32 and s.36 grounds with written reasons; consent may be withdrawn (s.38). PDPA amendments in force 1 June 2025: data portability (s.43A) and a data protection officer for each data controller, notified to the Commissioner within 21 days of appointment (Commissioner DPO guideline). The 21-day period for portability is a proposal; confirm with counsel.',
  ),
  staffClaims: rule(
    'HR-STAFF-CLAIMS',
    {
      medicalPerYear: 1000,
      opticalPer2Years: 500,
      foodOver90Km: 25,
      foodPerNight: 50,
      hotelPerNight: 200,
      longTripKm: 90,
      kmTolerance: 0.1,
      roadFactor: 1.3,
    },
    'Policy',
    'Fauzan, 26 Oct 2026, for staff (everyone except guards, patrolling officers and officers): no group hospitalisation (staff buy their own insurance); medical up to RM1,000 a year with dental inside it; optical RM500 every 2 years; yearly check-up at a panel clinic with the result uploaded, claimed separately. Travel: the Chief of Staff sets and publishes the approved rate per km for each vehicle every month, company car included, and is reminded until it is published; office to the place and back; over 90 km one way RM25 food; overnight hotel up to RM200 and RM50 food a night instead of the RM25; toll and parking claimable, valet parking not. A place not pre-approved, or claimed km more than 10% off the system km, needs the Chief of Staff. HR checks every claim and the COO approves it (Fauzan, 26 Oct 2026: all claims, operation claims and hostel bills approved by the COO). System km = twice the furthest location ping from the clock-in point that day, times a road factor of 1.3 (proposed); the company car tracker is not connected yet.',
  ),
  foreignAnnualLeaveCap: rule(
    'FWM-AL-CAP',
    12,
    'Policy',
    'Fauzan, 26 Oct 2026: Nepali guards get at most 12 days of annual leave a year, as in their contract (8 days in the first 2 years, then 12). Flag: Employment Act 1955 s.60E gives 16 days from 5 years of service, and s.7 voids a contract term below the Act, so this cap needs legal confirmation for Nepali guards past year 5.',
  ),
  leaveEscalate: rule(
    'LEAVE-ESCALATE',
    12,
    'Policy',
    'Fauzan, 25 Oct 2026: a request from a guard or officer is approved or rejected only by the Operations Manager or higher. If it gets no go-ahead or rejection within 1 working day, it moves up a level: OM, Regional OM, head of operations, COO, CEO. Fauzan, 11 Nov 2026 (C3): 1 working day per level, weekends and public holidays not counted. The value (12 hours) is kept for office staff leave at HR, which moves up every 12 hours once the Company Manager has authorised it.',
  ),
  upgradeCourses: rule(
    'HR-UPGRADE',
    [
      { id: 'FIRST_AID', name: 'First aid and CPR', by: 'Company in-house or approved provider', needs: 'Any guard' },
      { id: 'FIRE', name: 'Fire safety and emergency response', by: 'Company in-house or approved provider', needs: 'Any guard' },
      { id: 'CCTV', name: 'CCTV and control room operator', by: 'Company in-house', needs: 'Valid CSG' },
      { id: 'SUPERVISOR', name: 'Supervisor course', by: 'Company in-house', needs: '2 years of service, valid CSG, no warning in 12 months' },
      {
        id: 'ARMED',
        name: 'Armed guard (firearm handling, then police permit)',
        by: 'Approved trainer, then PDRM permit',
        needs: 'Malaysian, 21 or older, no warning in 12 months',
      },
    ],
    'Unverified',
    'Fauzan, 25 Oct 2026: the profile shows each guard the chances to upgrade, such as courses and certification the company or government provides in their field. This list is a placeholder until Group HR gives the real course catalogue, providers and HRD Corp claim rules.',
  ),
  claimsPolicy: rule(
    'HR-CLAIMS',
    [] as { clause: string; item: string; covered: string; note: string }[],
    'Policy',
    'Set by the HR Administrator in the app (Fauzan, 14 Nov 2026: the list usually changes per year). Each version runs from a date with a reason; a record uses the version in force on its date. Until HR keys it in, the screen says "not set by HR". The draft clauses of 26 Oct 2026 are no longer preset.',
  ),
  hospitalDocs: rule(
    'HR-HOSP-DOCS',
    [
      { item: 'ADMISSION_LETTER', label: 'Admission letter or referral', needed: true },
      { item: 'GUARANTEE_LETTER', label: 'Guarantee letter (GL) from the insurer', needed: false },
      { item: 'MEDICAL_CERT', label: 'Medical certificate covering the stay', needed: true },
      { item: 'DISCHARGE_SUMMARY', label: 'Discharge summary', needed: true },
      { item: 'ITEMISED_BILL', label: 'Itemised hospital bill and receipt', needed: true },
      { item: 'CLAIM_FORM', label: 'Insurer claim form, signed', needed: true },
    ] as const,
    'Policy',
    'Shahirah, 26 Oct 2026: for hospitalisation, a checklist of documents and a tracker for the submission and processing of each one. The list follows the usual insurer claim pack; Group HR may change it.',
  ),
  disciplinePolicy: rule(
    'HR-DISCIPLINE',
    {
      principles: [
        'Nothing is automatic: the app records and reminds; a person decides.',
        'The worker is told the charge in writing and may explain before any step above a verbal warning.',
        'Every step is recorded on the profile with the document and who decided it.',
        'Suspension during an inquiry is with at least half pay, for up to 2 weeks (Employment Act s.14(2)).',
      ],
    },
    'Policy',
    'The discipline steps (each step, when, decided by and kept for) are set by the HR Administrator in the app (Fauzan, 14 Nov 2026), versioned by date. These principles follow the Employment Act 1955 s.14 and the Code of Conduct for Industrial Harmony (approved by Fauzan, 11 Nov 2026, round 3, G6).',
  ),
  patrolSpan: rule(
    'OPS-PATROL-SPAN',
    60,
    'Policy',
    'Fauzan, 25 Oct 2026: a patrolling officer commands at most 60 guards. Counted as the different guards rostered today at the sites on the patrol, across companies when the officer also patrols another company. Over the limit is shown to operations; the company changes the patrol areas.',
  ),
  siteGate: rule(
    'SITE-GATE',
    { keepYears: 7, keepYearsMin: 2, keepYearsMax: 7, shownIdChars: 4, postLogMaxChars: 1000, insideAlertHours: 12, sentLaterMin: 10, offlineMaxDays: 7, paperPagesMax: 10 },
    'Policy',
    'Fauzan, 6 Nov 2026: the shared site device is the one-stop guard duty device: post log, visitor log with evidence, vehicle plates against the site list. Police require the full details of people coming in and out kept for 2 to 7 years, so the full ID number, the IC picture and written in/out book pages are kept, sealed on the device for the in-house server only (screens show the last 4 characters). Kept 7 years here, the top of the police range, until the PDPA officer and counsel set it within 2 to 7. With no internet the device keeps entries encrypted and sends them when the signal returns (up to 7 days, proposed). Visitors need a notice at the gate. Approved by Fauzan, 11 Nov 2026 (round 3, G9).',
  ),
  siteTasks: rule(
    'SITE-TASK',
    { maxActivePerSite: 40, titleMax: 120, detailMax: 600, boardDays: 7, needsAnswerMax: 600 },
    'Policy',
    'Fauzan, 6 Nov 2026: the OM discusses with the client what the site needs and what can be done, then sets tasks for the patrolling officer, the officer or the guard; the shared device shows the tasks due today. A higher rank may do a lower rank\'s task. A task not done by the end of its day shows as missed to the OM. Limits are proposals.',
  ),
  clientCodes: rule(
    'CLIENT-CODE',
    { selfAuditEveryMonths: 12, selfAuditRemindDays: [60, 30, 7], hoursLookbackDays: 14, inspectionFixDays: 14, maxRequirements: 120, maxFormItems: 40, maxRooms: 30 },
    'Policy',
    "Fauzan, 6 Nov 2026, after the IKEA IWAY audit of Sasa: a client's code of conduct checklist is kept on the site's client needs page and done by the OM or ACT, because not every client needs one. Working-hours and break checks, and the site and hostel inspection forms, apply only where the client's code asks for them, with the items the client asks for. Every company does its own self-audit every year, for the company, a site or everything, with reminders. Reminders at 60, 30 and 7 days, a 14-day fix target for inspection items and the 14-day hours look-back are proposals.",
  ),
  rba: rule(
    'RBA-READY',
    { traceSampleSize: 20, traceToleranceHours: 4, normalHoursPerDay: 8, grievanceOverdueDays: 30, maxCommittee: 6 },
    'Policy',
    "Fauzan, 8 Nov 2026 (\"Yes\" to the RBA build order after the RBA Code of Conduct v8.0 readiness checklist): RBA is a client code beside IWAY, with green, yellow, orange and red grades, and red items go to ACT, the Chief of Staff and the COO the same day. ACT traces a sample of about 20 workers a month, foreign workers first, from roster to clock to overtime to pay to bank, and settles every mismatch. Each foreign worker has one master file in the nine RBA folders. Staff sign an ethics declaration once, on entering service. The discipline appeal step itself is HR-APPEAL (IWAY, PR #131). No fee, deposit, fine or penalty for leaving is taken from pay. Fauzan, 7 Nov 2026: the RBA committee is the Operations Director and a few company heads, chosen by the Chief of Staff every year. Fauzan, 8 Nov 2026 (\"Policy yes proceed\"): the 20-worker sample, 4-hour tolerance, 8-hour normal day and 30-day grievance target are approved; staff sign the ethics declaration once on entering service, and the committee has at most 6 members.",
  ),
  siteDispatch: rule(
    'CMS-DISPATCH',
    {
      /** Seconds the site device has to acknowledge before CMS is told to phone the guard or supervisor. */
      ackSec: { urgent: 60, alert: 180, instruction: 900 },
      /** Minutes from acknowledgement to proof before CMS is told proof is late. */
      proofMin: { urgent: 5, alert: 15, instruction: 60 },
      /** How often an unanswered urgent or alert sounds again on the device. */
      repeatSec: { urgent: 15, alert: 60, instruction: 0 },
      maxVideoSec: 30,
      maxVideoBytes: 2_000_000,
      /** PDPA: clips not attached to a case are deleted after this many days. */
      videoKeepDays: 90,
    },
    'Policy',
    'Fauzan, 6 Nov 2026: CMS can send an instruction, an alert or an urgent alert to a site shared device, also when AI analytics on CCTV or a sensor pin-points something. The guard verifies with a time-stamped photo, or a video from the device or a bodycam linked to it. CMS monitors and tells; the company decides. Timings, video length and the 90-day keep period are proposed; video is personal data under PDPA (notice, viewers and keep period need the PDPA officer). Approved by Fauzan, 11 Nov 2026 (round 3, G8).',
  ),
  evidenceGeo: rule(
    'EVID-GEO',
    { maxAccuracyM: 100, sentLaterMin: 10, clockAheadMin: 2, maxImageBytes: 700_000 },
    'Policy',
    'Fauzan, 25 Oct 2026: incident reports and site visits carry photos from the in-app camera with a built-in time stamp and geo-tag, to prove the event is true. No gallery uploads. A photo needs GPS; it is checked against the site geofence, GPS weaker than 100 m is flagged, and a photo sent more than 10 minutes after it was taken is marked as sent later. Values proposed.',
  ),
  disciplineHandbook: rule(
    'HR-HANDBOOK',
    { warningValidMonths: 12, showCauseReplyDays: 7, suspensionMaxDays: 14 },
    'Policy',
    'Fauzan, 25 Oct 2026: one disciplinary handbook for every guard in every company, and it must follow labour law. The ladder (verbal, written, final warning, show-cause, domestic inquiry, then an inquiry outcome), a warning counting for 12 months and 3 days to answer a show-cause letter are proposed until Group HR and counsel issue the handbook. Approved by Fauzan, 11 Nov 2026 (round 3, Q6): guards have 7 days to answer a show-cause letter, the same as office staff, so nobody is given less time to answer.',
  ),
  disciplineLaw: rule(
    'EA-DISCIPLINE',
    true,
    'Law',
    'Employment Act 1955: s.14(1) dismissal without notice, downgrading or suspension without wages for up to 2 weeks only for misconduct and only after due inquiry; s.14(2) suspension pending inquiry up to 2 weeks with at least half wages; s.24 no fines or penalty deductions from wages; s.15(2) absence for more than 2 consecutive working days without leave, reasonable excuse or informing the employer counts as breaking the contract; s.60F(2) a guard on sick leave must inform the employer within 48 hours. Sabah and Sarawak Labour Ordinances apply in those states; counsel to confirm the handbook. Approved by Fauzan, 11 Nov 2026 (round 3, G6).',
  ),
  armsTradeStock: rule(
    'ARMS-TRADE-STOCK',
    3,
    'Unverified',
    'Fauzan, 25 Oct 2026: three licensed security companies will hold an arms dealer licence and keep trade stock in their own vault to save cost. Trade stock is registered apart from operational firearms and is never issued to a guard. Whether an armoury approved for operational firearms may also hold dealer stock needs PDRM and counsel confirmation (KDN Circular 1/2006 limits a security company to its own firearms).',
  ),
  vaultDoorMatchMin: rule(
    'ARMS-DOOR-MATCH',
    15,
    'Policy',
    'V14 s.209 and s.226: a vault door opening with no issue, return or count within 15 minutes is flagged for an independent check. Proposed window, for approval. Approved by Fauzan, 11 Nov 2026 (round 3, G7).',
  ),
  policeReportDays: rule(
    'ARMS-POLICE-REPORT',
    14,
    'Law',
    'Arms Act 1960 s.7(1): report loss or destruction of arms or ammunition at the nearest police station within 14 days of becoming aware',
  ),
  armsSitePolice: rule(
    'ARMS-SITE-POLICE',
    true,
    'Policy',
    'Fauzan, 25 Oct 2026: the police are notified once when armed guards are set up at a site or for an armed contract (not daily); a small arms vault at the site needs police approval before going live; moving arms to another state needs police approval.',
  ),
  registerCheckHours: rule(
    'ARMS-REGISTER-CHECK',
    24,
    'Policy',
    'Fauzan, 25 Oct 2026: every vault, at the site and the main vault, keeps both the register book and the online register. Proposed: the book is checked against the online register at least every 24 hours.',
  ),
  rangePracticeMonths: rule(
    'ARMS-RANGE',
    6,
    'Secondary',
    'KDN Private Agency Circular Bil. 1/2006, Lampiran A para 2: armed personnel must get shooting practice at least twice a year. Shown as due every 6 months.',
  ),
  insuranceRenewalDays: rule(
    'INS-RENEWAL',
    60,
    'Policy',
    'Proposed: start renewal quotes 60 days before a policy expires, so cover never lapses. For approval with the Chief of Staff.',
  ),
  insurancePremiumDays: rule(
    'INS-PREMIUM',
    { firstDays: 30, secondDays: 14 },
    'Policy',
    'Malaysian general insurance runs on cash before cover; some corporate policies allow a premium warranty period. Warn 14 days before the premium is due. Confirm each policy with the broker. Fauzan, 11 Nov 2026: confirmed 14 days, plus a first reminder 30 days before the premium is due.',
  ),
  insuranceClaimNoticeDays: rule(
    'INS-CLAIM-NOTICE',
    30,
    'Policy',
    'Most policies say notify the insurer as soon as possible. Proposed: 30 days from the incident at the latest. Check each policy wording. Fauzan, 11 Nov 2026: confirmed, 30 days.',
  ),
  insuranceClaimAgeDays: rule('INS-CLAIM-AGE', 90, 'Policy', 'Proposed: a claim still open 90 days after notice is chased with the insurer or broker.'),
  guaranteeLeadDays: rule(
    'INS-GUARANTEE',
    60,
    'Policy',
    'A performance bond or guarantee must stay valid until the contract or tender validity ends. Proposed: extend 60 days before it expires; ask for release once the contract ends. Fauzan, 11 Nov 2026 (C4 F13): every insurance and bank guarantee is tracked until it is settled (released or claimed back), with a reminder from 30 days before it is due.',
  ),
  requiredCover: rule<{ kind: InsuranceKind; when: 'all' | 'foreign' | 'armed' | 'cit'; why: string }[]>(
    'INS-REQUIRED',
    [
      { kind: 'PUBLIC_LIABILITY', when: 'all', why: 'Client contracts and tenders ask for it (COM-TENDER-ELIGIBLE)' },
      { kind: 'GROUP_PERSONAL_ACCIDENT', when: 'all', why: 'Proposed group policy for every guard' },
      { kind: 'PROFESSIONAL_INDEMNITY', when: 'all', why: 'KDN renewal checklist 2027 item 3.6 (Fauzan, 14 Nov 2026: required cover for every company)' },
      { kind: 'FIDELITY_GUARANTEE', when: 'all', why: 'Proposed: covers theft by staff at client sites' },
      { kind: 'FW_HOSPITALISATION', when: 'foreign', why: 'Foreign worker hospitalisation cover (SPIKPA) is needed for the work permit; to confirm' },
      { kind: 'ARMED_SERVICE', when: 'armed', why: 'Armed-service liability, asked for in client arms agreements (V14)' },
      { kind: 'CASH_IN_TRANSIT', when: 'cit', why: 'Cash-in-transit cover for CIT, CDM and vault jobs' },
    ],
    'Policy',
    'Minimum cover per company. Approved by Fauzan, 11 Nov 2026 (round 3, G12 / Q12): the Chief of Staff signs off the list with counsel.',
  ),
  clockInWindowMin: rule('OPS-CLOCK-WINDOW', 60, 'Policy', 'Clock-in allowed from 60 minutes before shift start'),
  licenceLeadDays: rule<Record<LicenceType, number>>(
    'REG-LEAD',
    {
      KDN_LICENCE: 120,
      MOF_REGISTRATION: 90,
      INSURANCE: 90,
      SSM_ANNUAL_RETURN: 60,
      MAJLIS_PREMISE: 60,
      MAJLIS_SIGNBOARD: 60,
      VENDOR_PANEL: 90,
      ISO_CERT: 120,
      FIRE_CERT: 90,
      OFFICE_ALARM: 30,
      OFFICE_CCTV: 30,
      PIKM_MEMBERSHIP: 60,
      MOF_DIGITAL_CERT: 60,
      BUMIPUTERA_STATUS: 90,
      BOND: 60,
      CARRY_USE: 90,
      CNU: 90,
      AMRA: 90,
      LHDN_TCC: 30,
      CIDB: 90,
      OTHER_COMPLIANCE: 60,
    },
    'Policy',
    'Part Z3 (Fauzan, 14 Nov 2026 "Add any that still missing"): PIKM, MOF digital certificate, Bumiputera status (renew 3 months before, so 90), bonds, Carry & Use, CNU, AMRA, LHDN TCC and CIDB added from the company checklists; leads proposed. Universal Operating Guidebook: KDN T-120, MOF T-90, insurance T-90, SSM T-60. Central Admin 5C (Fauzan, 2 Nov 2026): every renewal a company holds; each company renews, Central Admin monitors. Proposed leads: majlis 60, vendor panels 90 (MOF renewal opens 3 months before expiry), ISO 120 before each audit, fire certificate 90, other 60.',
  ),
  credentialLeadDays: rule<Record<CredentialType, number>>(
    'HR-CRED-LEAD',
    {
      KDN_GUARD_CARD: 60,
      KDN_VETTING: 0,
      CSG_TRAINING: 0,
      TNG_TRAINING: 0,
      PLKS_PERMIT: 90,
      PASSPORT: 180,
      FOMEMA: 60,
      FW_INSURANCE: 60,
      SPIKPA: 60,
      KDN_LETTER: 90,
      FIREARM_PERMIT: 90,
      RANGE_PRACTICE: 30,
      MEDICAL_CHECK: 30,
      SITE_BRIEFING: 0,
    },
    'Policy',
    'Proposed reminder lead times for personal permits, for approval Approved by Fauzan, 11 Nov 2026 (round 3, G10). Firearm permit 90 days (arms licence policy, Fauzan 13 Nov 2026 23:44Z, R-X5).',
  ),
  caseSla: rule<Record<Severity, string>>(
    'CASE-SLA',
    { P1: '5 minutes', P2: '30 minutes', P3: 'same day', P4: '2 working days' },
    'Policy',
    'Universal Operating Guidebook severities P1 to P4',
  ),
  insiderControls: rule(
    'CTL-INSIDER',
    {
      /** A staff claim is made within this many days of the receipt or trip. */
      claimMaxAgeDays: 60,
      /** A one-off payroll allowance above this is flagged to the Chief of Staff and Vice Chairman. */
      allowanceFlagAbove: 500,
      /** Finance confirms a rent transfer, online payment or cheque against the bank within this many days. */
      rentBankConfirmDays: 7,
      /** The store is counted with a witness at least this often. */
      stockCountDays: 30,
    },
    'Policy',
    'Fauzan, 27 Oct 2026, approving the insider abuse audit: salary account changes verified by both the HR Director and Finance; nobody verifies their own pay; claims within 60 days; travel pre-approved by the Chief of Staff before the trip; quotes and online prices backed by documents; IT purchases through Procurement; rent reversals by the Asset Director with system receipt numbers; firearm and store witnesses signed in by PIN; a second person on false alarms, whistleblowing closures and case closures. Amounts and days are proposals for approval.',
  ),
  staffZakat: rule(
    'PAY-ZAKAT',
    { bodies: ['Zakat Kuala Lumpur', 'Zakat Selangor', 'Zakat Kedah', 'Zakat Perlis'], minPercent: 0.5, maxPercent: 25, usualPercent: 2.5 },
    'Policy',
    "Fauzan, 2 Nov 2026: staff choose whether zakat is deducted from their salary, which body it goes to and the percentage. Zakat paid by salary deduction reduces the monthly tax deduction (PCB) ringgit for ringgit (Income Tax Act 1967 s.6A(3); Income Tax (Deduction from Remuneration) Rules 1994), never below zero; to be verified against LHDN's current PCB specification before go-live. The companies pay Zakat Kuala Lumpur, Zakat Selangor, Zakat Kedah and Zakat Perlis. The 0.5% to 25% range and 2.5% suggestion are proposals; Employment Act s.24(8) keeps all deductions to half of the wages at most.",
  ),
  financePayments: rule(
    'FIN-PAY',
    { ceoNoticeFrom: 200_000, approvalExpiryDays: 30, cooSubjects: ['operations', 'it', 'fwm', 'inventory', 'transport', 'goodwill'] as string[], maxAmount: 50_000_000, maxEvidence: 10, reasonMin: 10, bankPackByDay: 10, paymentPackByDay: 15 },
    'Policy',
    "Finance Phase 2 (Fauzan, 31 Oct 2026: Phase 2 is Finance, after the IT pilot). Policy (Fauzan): every approval gives at least a comment; the CEO has full authority alongside the Finance Director; SQL Account stays the books. Phase 2 gate (CEO roadmap, 28 Oct 2026): one user may not both authorise and pay a transaction. In Prima a payment is prepared with its SQL Account document and evidence, reviewed by someone else in the team (deputy or leader), approved by someone who neither prepared nor reviewed it, and released in the bank portal by someone who did not approve it, who records the bank's reference. A month-end close is approved by the Finance Director or the CEO only when SQL Account is closed, every bank account is reconciled with its report attached, FS-01, FS-02 and FS-06 are RM0.00 and every other exception is explained (V6). DECIDED (Fauzan, 1 Nov 2026): approval is by subject matter and only the Finance Director, the CEO and the COO approve anything; Finance payments are approved by the Finance Director or the CEO at any amount (team leaders and deputies review, never approve); payments for the departments the COO directly monitors (Operations, IT, Foreign Worker Management, Procurement & Inventory, Transport, Goodwill Empire; Fauzan 27 and 31 Oct 2026) are approved by the COO or the CEO, not the Finance Director; Finance still prepares, reviews and releases them; the CEO is also reminded of payments of RM500,000 or more. DECIDED (Fauzan, 1 Nov 2026): an approved payment not released within 30 days goes back for a fresh approval; the Finance Director sets this and the other Finance timings and thresholds in Prima. PROPOSED: the bank pack is due by the 10th and the payment pack by the 15th. Fauzan, 11 Nov 2026: the CEO is told of payments from RM200,000 (was RM500,000); the rest as is; the Finance Director can change the figure in the Finance settings.",
  ),
  financeSst: rule(
    'FIN-SST',
    { rate: 0.08, threshold: 500_000, periodMonths: 2, toleranceRm: 1, penaltyTiers: [0.1, 0.15, 0.15] as number[], claimMinDocs: 3 },
    'Secondary',
    "Service Tax Act 2018 as summarised by PwC's 2025/2026 Malaysian Tax Booklet and KPMG's service tax summary (checked 31 Oct 2026; the FD confirms from LHDN / Customs guidance (G17, Fauzan 11 Nov 2026: no tax agent)): security services (guards or protection for safety or security, First Schedule Group G item (k)) are taxable and are NOT covered by the Group G business-to-business exemption; the rate is 8% (6% services such as logistics or rental are separate); registration is due once taxable services over 12 months exceed the threshold (RM500,000 for most services; confirm the figure for item (k)); returns (SST-02) are filed in MySST every 2 months and tax is paid by the last day of the month after the taxable period; late payment adds 10% for the first 30 days, then 15% and 15% more. Tax is normally due when payment is received (or 12 months after the service), unless Customs approved invoice-basis accounting. DECIDED (Fauzan, 1 Nov 2026): the group pays service tax when the customer's payment is received, not on invoice, so bad debt relief should rarely be needed; when bad debt relief or a refund of a wrong payment is needed, a full document pack is submitted to Customs for approval (recovery is usually very hard), so Prima keeps the claim, its documents (at least 3), who prepared and who submitted it, and Customs' answer. DECIDED (Fauzan, 1 Nov 2026): SST is charged to the client at 8% of the bill without SST, so the tax inside a payment received is 8/108 of it; the SST on the invoices and the tax worked out from the money received must agree, and the declared tax must equal it. Prima checks: declared tax = 8/108 of the money received (or, for older returns, taxable value x rate) within RM1 or explained; the invoices' SST agrees with it or is explained; filed with the MySST acknowledgement; paid to the Royal Malaysian Customs Department through an approved Prima payment of exactly the declared amount, to a verified payee, by the due date.",
  ),
  financeEInvoice: rule(
    'FIN-EINV',
    { exemptBelow: 3_000_000, consolidateByDay: 7, singleTxnMax: 10_000, cancelHours: 72, checkByDay: 10 },
    'Secondary',
    "Fauzan, 1 Nov 2026: Malaysia now requires e-Invoicing and it runs from SQL Account. LHDN e-Invoice General Guideline v4.8 and Specific Guideline v4.9 (Aug-Sep 2026), as summarised by Malay Mail (31 Aug 2026) and e-Invoice advisers (checked 1 Nov 2026; the FD confirms from LHDN / Customs guidance (G17, Fauzan 11 Nov 2026: no tax agent)): from 1 Sep 2026 taxpayers with annual turnover below RM3 million are exempt (up from RM1 million), the guideline also removes the exemption where a related company has revenue of RM3 million or more (GL 1.6.10). DECIDED (Fauzan, 1 Nov 2026): each group company is its own legal entity and is tested on its OWN turnover; a company starts e-Invoicing when it reaches RM3 million. Phases: above RM100 million from 1 Aug 2024, RM25-100 million from 1 Jan 2025, RM5-25 million from 1 Jul 2025, up to RM5 million from 1 Jan 2026 (relaxation for that phase to 31 Dec 2027); during relaxation monthly consolidated e-Invoices are tolerated and no penalty applies under ITA s.120. Outside relaxation, failing to issue an e-Invoice is an offence under s.120(1)(d) (fine RM200 to RM20,000 per instance, or up to 6 months' jail, or both). Operating rules: sales to buyers who do not ask for an e-Invoice go into a monthly consolidated e-Invoice submitted within 7 days after the month; a single sale above RM10,000 gets its own e-Invoice (not consolidated) from 2026; an e-Invoice is cancelled only within 72 hours of validation, after that a credit or debit note is issued; self-billed e-Invoices are issued for foreign suppliers and agents, payouts to agents and dealers, and other listed cases; a supplier's validated e-Invoice is the proof of expense. SQL Account's MyInvois module submits sales invoices, cash sales, credit and debit notes and self-billed purchase documents, shows Valid, Invalid, Submitting and Cancelled, builds the consolidated e-Invoice, and lists everything in MyInvois Transaction. PROPOSED: the month's e-Invoice check recorded by the 10th; no unvalidated sales document at the close.",
  ),
  financeReceivables: rule(
    'FIN-AR',
    { followUpDays: 30, caseFromDays: 90, writeOffMinDays: 180, writeOffMinEvidence: 2, sstUnpaidMonths: 12, eInvoiceCancelHours: 72 },
    'Secondary',
    "Fauzan, 1 Nov 2026: invoices are issued but the site or the payer has changed so the invoice does not go through, and the ageing shows it only after 3 months; Finance needs a proper way to cancel and redo an invoice, to handle a payer who will not pay or goes bankrupt, to declare bad debt, and to cancel sales when the audit report has already been signed. Rules applied: an invoice is never deleted; a wrong invoice is reversed by a credit note (an e-Invoice validated less than 72 hours ago may be cancelled in MyInvois instead) and a new invoice issued to the right payer. A credit note or write-off for an invoice in a financial year whose audited accounts are signed is dated in the current open month, never back in the audited year; the Finance Director tells the auditor and decides with the auditor whether it is a material prior-period error (MFRS 108 / MPERS section 10). Bad debt: written off only after recovery steps with evidence and approval by the Finance Director or the CEO (not the preparer); income tax deduction for bad debts under ITA 1967 s.34(2), per LHDN's public ruling. Service tax is due when payment is received or, if unpaid, 12 months after the invoice; where tax was paid and the debt is written off after reasonable recovery efforts, the service tax can be reclaimed as bad debt relief from Customs (Service Tax Act 2018; the Finance Director confirms the steps from the published Customs guidance, no tax agent: Fauzan, 11 Nov 2026, round 3 Q17). PROPOSED: an invoice unpaid 90 days or more needs a case; each open case is followed up at least every 30 days; write-off not before 180 days unless the customer is insolvent, with at least 2 pieces of evidence (demand letter, lawyer's letter, liquidation or bankruptcy notice).",
  ),
  financeRegularBills: rule(
    'FIN-REGULAR-BILLS',
    {
      /** A varying bill more than this % above the average of the last three bills needs an explanation. */
      unusualHighPct: 10,
      /** A varying bill more than this % below the average of the last three bills needs an explanation. */
      unusualLowPct: 10,
    },
    'Policy',
    'Fauzan, 2 Nov 2026 (lighter check L3): a varying regular bill (electricity, water, phone and the like) needs an explanation only when it is more than 10% above or more than 10% below the average of the last three bills; exactly 10% needs none. The Finance Director may change either limit in the Finance settings, with a reason, from a date, and the history is kept. Statutory amounts and staff zakat taken from the approved staff payroll stay an exact match.',
  ),
  financeControls: rule(
    'FIN-CONTROLS',
    {
      matchDays: 3,
      /** A remembered explanation (A6, 2 Nov 2026) covers bank lines up to this amount; larger ones are explained one by one. Proposal. */
      ruleMaxAmount: 5000,
      unclearedDays: 5,
      ageingByDay: 10,
      monthlyPackByDay: 20,
      forecastByDay: 20,
      variancePct: 5,
      varianceMinRm: 5_000,
      auditCirculateMonths: 6,
      ssmLodgeDays: 30,
    },
    'Policy',
    "Fauzan, 31 Oct 2026: approvals run in Microsoft Teams and SharePoint and every approver comments whatever the decision, so Prima links each payment to its Teams or SharePoint approval; payments must reach the right person; bank statements are reconciled; ageing is done every month so nothing is Unknown; staff prepare what the auditor needs every month so the audit is not late; proper budgeting and forecasting even though actuals never follow the plan to the dot. Paid to the right person: a payee is entered by one person and verified by another by calling back on a number from an independent source (never the number in the request), a bank detail change holds every unreleased payment to that payee until re-verified, and whoever releases a payment confirms the account's last 4 digits and name in the bank portal match. Companies Act 2016: a private company circulates audited financial statements within 6 months of its year end (s.258) and lodges them with SSM within 30 days of circulation (s.259). PROPOSED, to confirm with the Finance Director: statement lines matched to payments within 3 days of release, a released payment not seen on the statement after 5 days is flagged, ageing recorded by the 10th, the monthly audit file by the 20th, a quarterly forecast by the 20th of the month after each quarter (Fauzan, 1 Nov 2026: forecasts are quarterly and yearly), and a month off the budget by more than 10% and RM5,000 explained. Fauzan, 11 Nov 2026: confirmed as is.",
  ),
  financeMoneyIn: rule(
    'FIN-MONEYIN',
    {
      /** An invoice more than this % away from the contract's monthly amount needs a note (fixed fee or Method 2 only). */
      billDiffPct: 1,
      /** A government claim is expected to be paid this many days after a complete claim is submitted. */
      govtPayDays: 14,
      /** An unpaid government claim is followed up at least this often. */
      govtFollowUpDays: 14,
      /** Money in with no invoice is allocated within this many days of the bank date. */
      unidentifiedDays: 7,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: yes to the Finance suggestions doc: every contract\'s monthly billing must have its invoice in SQL Account and a missing one is named at the close (1); a government claims tracker with the date submitted, reference, expected payment date and follow-up (2); and money in with no invoice goes to an unidentified list, to be allocated within 7 days (5). The 14-day government payment term (Treasury practice), the 14-day follow-up and the 1% billing difference are PROPOSALS for the Finance Director to confirm. Fauzan, 11 Nov 2026: confirmed; government usually pays late, so a late government claim is shown on the government claims tracker and is not raised as a red alarm on its own.',
  ),
  financeWht: rule(
    'FIN-WHT',
    {
      /** Late payment penalty on withholding tax not paid by the due day. */
      latePenaltyPct: 10,
      /** Published rates on the gross paid or credited to a non-resident (a treaty may give a lower rate with a certificate of residence). */
      rates: { services: 10, royalty: 10, interest: 15, contract: 13, other_income: 10 },
    },
    'Law',
    'Income Tax Act 1967 s.107A (contract payments: 10% on account of the contractor + 3% on account of employees = 13%), s.109 (royalty 10%, interest 15%), s.109B (special classes of income: technical services, use of movable property, 10%), s.109F (other gains or profits, 10%). Due to LHDN within one month after paying or crediting; 10% penalty on any amount not paid by then. Fauzan, 2 Nov 2026: no tax agent, use the published rules.',
  ),
  financeYearEnd: rule(
    'FIN-YEAREND',
    {
      /** Capital allowance on plant and machinery: initial allowance in the year bought. */
      initialPct: 20,
      /** Annual allowance by class. */
      annualPct: { general: 14, heavy_vehicle: 20, office: 10, computer: 20, motor_car: 20 },
      /** Small value assets: each RM2,000 or less, 100% in the year bought, up to RM20,000 a year in total (not for SMEs). */
      smallValueMax: 2000,
      smallValueCap: 20000,
      /** Motor car qualifying cost: RM100,000 if new and RM150,000 or less, otherwise RM50,000. */
      motorCarCapNew: 100000,
      motorCarCapOther: 50000,
      /** SME for income tax (Schedule 1 para 2A): paid-up capital and gross business income at most. */
      smePaidUpMax: 2500000,
      smeIncomeMax: 50000000,
      /** An auditor request is due this many days after it is asked, unless the auditor gives a day. */
      auditRequestDays: 14,
    },
    'Policy',
    'Income Tax Act 1967 Schedule 3 and Income Tax (Qualifying Plant Annual Allowances) Rules, as published by LHDN; Fauzan, 2 Nov 2026: yes to suggestions 21 to 23. Rates and caps to be checked by the Finance Director against the current LHDN public rulings before use; the 14 days for auditor requests is a PROPOSAL. Fauzan, 11 Nov 2026: confirmed; the Finance Director can edit the rates and caps afterwards in the Finance settings.',
  ),
  financeSupplierStatements: rule(
    'FIN-SUPSTMT',
    {
      /** How many of the biggest suppliers (by money paid in the last 12 months) are checked each quarter. */
      topSuppliers: 10,
      /** Days after the quarter ends to agree and review them; after that the close stays open. */
      dueDays: 30,
    },
    'Policy',
    "Fauzan, 2 Nov 2026: yes to suggestion 11 (quarterly supplier statement check for the biggest suppliers). Top 10 and 30 days are PROPOSALS for the Finance Director. Fauzan, 11 Nov 2026: confirmed.",
  ),
  financeCredit: rule(
    'FIN-CREDIT',
    {
      /** An invoice unpaid for longer than this many days makes Prima warn before posts are added for the client. */
      overdueDays: 90,
      /** Finance refreshes each limited client's balance from SQL Account at least this often. */
      balanceStaleDays: 35,
    },
    'Policy',
    "Fauzan, 2 Nov 2026: yes to suggestion 4 (credit limit per private client; warn Operations before adding posts for a client over its limit or over 90 days). Limits are set by the Finance Director or the CEO with a reason (Fauzan, 2 Nov 2026); Prima warns and Operations may still add the post with a reason that Finance sees. The 35 days is a PROPOSAL for the FD. Fauzan, 11 Nov 2026: confirmed.",
  ),
  financeBanking: rule(
    'FIN-BANKING',
    {
      /** Prima asks someone to decide (renew or uplift) this many days before a fixed deposit matures. */
      maturityAlertDays: 14,
      /** Words on a statement line that mark a bank charge or fee (money out). */
      chargeWords: ['CHARGE', 'CHRG', 'FEE', 'COMMISSION', 'COMM ', 'SERVICE TAX', 'SST ON', 'STAMP DUTY', 'PENALTY', 'HANDLING', 'ANNUAL FEE', 'CHQ BOOK', 'INTEREST CHARGED', 'OD INTEREST'],
    },
    'Policy',
    'Fauzan, 2 Nov 2026: yes to the Finance suggestions doc: fixed deposits and idle cash with maturity alerts and where the money sits (15), and a monthly review of bank charges against what the bank agreed (16). The 14-day alert and the list of charge words are PROPOSALS for the Finance Director; each bank\'s agreed monthly charges are recorded per account by the team leader, the FD or the CEO. Fauzan, 11 Nov 2026: confirmed.',
  ),
  financeContractEnd: rule(
    'FIN-CONTRACT-END',
    {
      /** Deposits, retention and guarantee collateral are claimed back within this many days of the contract's end. */
      claimWithinDays: 30,
      /** Retention still held by a client is updated at least this often until it is claimed back (Fauzan, 11 Nov 2026). */
      retentionPromptMonths: 2,
      /** The final invoice is recorded within this many days of the end. */
      finalInvoiceDays: 14,
      /** Ended contracts stay on the list this long. */
      showDays: 365,
    },
    'Policy',
    "Fauzan, 2 Nov 2026: yes to the Finance suggestions doc: client deposits and retention sums held by clients with a claim-back at contract end (3); when a contract ends, billing stops and the deposit, IG or retention claim starts automatically (24); and automation A11, follow-up tasks open by themselves when a contract is cancelled or ends. The 30-day claim and 14-day final invoice limits are PROPOSALS for the Finance Director to confirm. Fauzan, 11 Nov 2026: confirmed; tenders also carry retention money, tracked per tender or contract with a status update asked every 2 months until it is claimed back (the Finance Director can change the months).",
  ),
  financeStamp: rule(
    'FIN-STAMP',
    {
      /** Stamp Act 1949 s.47: an agreement signed in Malaysia is stamped within 30 days of signing. */
      stampDays: 30,
      /** Prima's working target: the refund application goes in within this many days of the cancellation. */
      refundTargetDays: 30,
      /** Stamp Act 1949 s.57 proviso: relief for a stamped instrument that became void or useless is applied for within 12 months of its date. */
      refundLimitMonths: 12,
      /** Stamp Act 1949 s.47A(1): late stamping within 3 months of the deadline costs RM50 or 10% of the duty, whichever is higher; later, RM100 or 20%. */
      latePenalty: { withinMonths: 3, first: { min: 50, pct: 10 }, after: { min: 100, pct: 20 } },
      refundMinDocs: 3,
      refundDocs: ['the stamped agreement and its STAMPS certificate', 'the cancellation letter or agreement signed by both parties', 'proof the duty was paid', 'a letter or statutory declaration that the agreement was not carried out and was not used in any court case (s.57)'],
      /** No answer from LHDN after this many days is followed up. */
      lhdnAnswerDays: 60,
      /** An approved refund not seen in the bank after this many days is followed up. */
      refundMoneyDays: 30,
    },
    'Law',
    'Fauzan, 2 Nov 2026: stamp duty on new contracts and tenancies, stamped within the time limit (suggestion 19): "Ok. Create also procedure to unstamp the contract, if the contract cancelled." Fauzan, 2 Nov 2026: "No need tax agent. All details are online already." From the published Stamp Act 1949: stamp within 30 days of signing in Malaysia (s.47); late penalty RM50 or 10% of the duty within 3 months of the deadline, RM100 or 20% after (s.47A(1), LHDN penalty guideline of 6 Nov 2025); the refund (allowance) for a stamped agreement that is cancelled, void or not carried out is applied for within 12 months of the agreement\'s date, the agreement is given up to be cancelled and must not have been used in court (s.57(f) and proviso), and is paid in money (s.59). Applications and enquiries go to LHDN STAMPS (stamps@hasil.gov.my). The 30-day target to submit, 60 days for LHDN\'s answer and 30 days for the money are Prima working targets.',
  ),
  financeDailyCash: rule(
    'FIN-DAILYCASH',
    {
      /** Proposals for the FD: days after the list ends to settle, days for a withdrawal to show on the statement, and how many days a list may start before it is made. */
      settleDays: 3,
      statementDays: 5,
      backdateDays: 3,
      reasonMin: 10,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: "There is one cash payment. We have daily cash buffer that need to be paid. If not, they dont want to work. So create a system that this type of people can be paid. Cash will be collected by coo or ceo to be paid." and "Only fd can approve this. They need to list it for the week or month. Before than prepare cash." Finance lists the people for the week or month, only the Finance Director approves (never the preparer, not the CEO), Finance then withdraws the cash (never above the approved total, found on the bank statement) and hands it to the COO or CEO, who counts it, pays each listed person for each listed day with the signed pay sheet as proof, and gives back what was not paid; Finance counts and banks it, and any difference is explained and accepted by the FD. The limits are proposals for the FD. Fauzan, 6 Nov 2026 ("Buffer also the same" as the guard pay-out rules): each person is paid to a bank account or e-wallet only, and Finance records each day\'s transfer with its reference (never by the FD who approved); cash only when the Director Office lists the person with the reason and the COO or the CEO gives it with a note (never whoever listed), and only that cash is withdrawn and handed over; a relative\'s or friend\'s account needs the person\'s consent letter stamped by a Commissioner for Oaths (Pesuruhjaya Sumpah) and approved by the COO only (Fauzan, 6 Nov 2026: the CEO does not stand in). Later the same day: "Director list will send cash person list per site per name and the amount, cash will be given out by ceo or coo. Signed paper of the receive collected and upload as proof. Upload done by director office." The Director Office lists each cash person with the site and the cash amount (at most their approved pay, and the cash withdrawn is at most these amounts); the COO or CEO pays; the Director Office uploads each signed receipt (PDF, JPEG or PNG, kept with its SHA-256), and the list is not settled until every receipt is in. The FD cannot approve a list until every person can be paid. Prima keeps only the last 4 digits of an account. EA s.25 asks for the worker\'s own or joint bank account: e-wallet and third-party accounts are flagged as legal points for the CEO. Fauzan, 11 Nov 2026: no limit needed on the daily rate or the number of people (cash is CEO-only; the FD may stand in).',
  ),
  financeIntercompany: rule(
    'FIN-IC',
    {
      /** Proposal for the FD: a difference above this is corrected in SQL Account, not explained. */
      explainMax: 1000,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: yes to suggestion 12, "Intercompany: management fees, recharges and loans between companies agreed on both sides every month" (the transfer pricing file, suggestion 20, "no need for now"). Each company records its month-end balance with each other group company by kind; both sides must come to RM0.00; a difference is corrected or explained by a reviewer who entered neither side; a balance last month must be recorded again; anything not agreed or explained stops both companies\' close. The explain limit is a proposal for the FD. Fauzan, 11 Nov 2026: a difference up to RM1,000 may be explained (was RM5,000); the Finance Director can change it in the Finance settings.',
  ),
  financeForecast13: rule(
    'FIN-CASH13',
    {
      /** Staff pay day, the 29th of the same month (Fauzan, 11 Nov 2026); guards are paid on the 7th of the next month. */
      payDay: 29,
      /** A reviewer looks the forecast over at least this often. */
      reviewDays: 7,
      /** Regular payments due this many days ago and still open are counted in week 1. */
      regularLookBackDays: 31,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: yes to suggestion 13, "13-week cash forecast per company: payroll dates, the 15th statutory payments, expected government receipts". Prima fills it from the last statement balances, open payments, the regular payments list (EPF, PERKESO, PCB and HRD on the 15th), the staff payroll at last month\'s net pay on the usual pay day, daily cash lists and government claims; Finance adds what Prima cannot know; a reviewer looks it over weekly; a week below zero shows on FD/CEO home. A forecast only; Prima never moves money. Fauzan, 11 Nov 2026: guards are paid on the 7th; staff are paid on the 29th of the same month (the Finance Director can change the day in the Finance settings).',
  ),
  financeCash: rule(
    'FIN-CASH',
    {
      /** A staff advance is settled with receipts within this many days of being paid. */
      advanceSettleDays: 30,
      /** The longest settle-by date Finance may give (Fauzan, 2 Nov 2026: "not more than 30 days"). */
      advanceMaxDays: 30,
      /** One petty cash voucher at most; bigger spending goes through a normal payment. */
      pettyVoucherMax: 50,
      pettyFloatMax: 500,
      /** The petty cash count for a month is done by this day of the month after. */
      pettyCountByDay: 5,
      /** Card holders explain every line by this day of the month after the statement month. */
      cardExplainByDay: 10,
      /** A bank mandate is confirmed against the bank's own list at least this often. */
      mandateReviewDays: 365,
      /** Two payments to the same supplier for the same amount within this many days are treated as a possible duplicate. */
      duplicateDays: 45,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: yes to the Finance suggestions doc: staff cash advances with a settle-by date, unsettled ones shown to HR and Finance (6); petty cash per office with a float, top-up only with receipts and a monthly count by someone else (7); company credit and fuel cards with each statement matched to receipts and personal use flagged (8); a duplicate supplier invoice check across all companies by supplier, number or amount (9); and a bank mandate register of signatories and portal approvers per account, reviewed when someone leaves (14). The days and ringgit limits are PROPOSALS for the Finance Director to confirm. Fauzan, 11 Nov 2026: petty cash float RM500 (was RM5,000) and RM50 per voucher (was RM500); the Finance Director sets the right amounts later in the Finance settings.',
  ),
  renewals: rule(
    'REG-RENEW',
    {
      /** Days overdue before the renewal steps up: Deputy Chief of Staff, then Chief of Staff, then CEO. */
      escalateDays: [0, 14, 30] as [number, number, number],
      /** Reminder while the agency has it. */
      agencyReminderDays: 7,
      /** Starting paper checklists; the agency's current form decides and the company adds what it asks for. */
      papers: {
        KDN_LICENCE: ['Renewal application in the KDN system', 'Current licence', 'SSM company profile', 'Directors and shareholders list', 'Latest audited accounts', 'Guard list with CSG training status', 'Office premises proof', 'Insurance cover'],
        MOF_REGISTRATION: ['Online renewal in ePerolehan', 'SSM documents', 'Latest audited accounts or bank statements', 'Employee EPF and SOCSO statements', 'Office photos and tenancy agreement', 'Current certificate'],
        INSURANCE: ['Quotes from insurers', 'Current policy schedule', 'Claims history'],
        SSM_ANNUAL_RETURN: ['Company secretary prepares the return', 'Directors and shareholders confirmed'],
        MAJLIS_PREMISE: ['Council renewal form or portal entry', 'Current licence', 'SSM company profile', 'Tenancy agreement or title', 'Latest assessment tax receipt', 'Fire certificate where the council asks'],
        MAJLIS_SIGNBOARD: ['Council renewal form or portal entry', 'Current licence', 'Signboard photo and size'],
        VENDOR_PANEL: ["The client's or agency's renewal form", 'SSM company profile', 'Audited accounts', 'KDN, MOF and ISO certificates', 'Insurance', 'Bank confirmation letter'],
        ISO_CERT: ['Internal audit report', 'Management review minutes', 'Open corrective actions closed', 'Audit booked with the certifying body', 'Nonconformities closed by the deadline'],
        FIRE_CERT: ['Fire equipment service records', 'Inspection booked', 'Floor plan where asked'],
        OFFICE_ALARM: ['Installer name and contact', 'Last service report', 'Test of each zone and the monitoring link', 'Next service booked'],
        OFFICE_CCTV: ['Installer name and contact', 'Last service report', 'Recording kept for the agreed days, checked', 'Next service booked'],
        PIKM_MEMBERSHIP: ["PIKM renewal form", "Current membership certificate", "KDN licence copy"],
        MOF_DIGITAL_CERT: ["Digital certificate renewal with the certificate authority", "MOF profile up to date"],
        BUMIPUTERA_STATUS: ["Renewal in ePerolehan (opens 3 months before)", "SSM documents", "Shareholders and directors list", "Latest audited accounts"],
        BOND: ["Bond issuer renewal or release letter", "Contract the bond covers"],
        CARRY_USE: ["Police renewal form", "Current permit", "Licence A holder details"],
        CNU: ["Police application", "Client letter", "Guard list"],
        AMRA: ["Police application", "Custodian details", "Vault approval"],
        LHDN_TCC: ["Application in MyTax", "Tax payments up to date"],
        CIDB: ["CIDB renewal in the portal", "SSM documents", "Audited accounts"],
        OTHER_COMPLIANCE: ['Renewal form', 'Current certificate'],
      } as Record<LicenceType, string[]>,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: "License renewal, majlis license renewal. All vendor renewal, iso renewal and compliance"; "Create also workflow on settling it. Whats needed."; "Renewal done by each company. Central admin monitor it." Steps: papers, the company manager signs (never the preparer), fee paid through Finance, submit, agency follow-up, new certificate and expiry, Central Admin confirms. Nothing is lodged or paid by the app. Master plan W15: an expired security licence blocks new contracts for that company. Paper lists are starting checklists (proposed).',
  ),
  kdnRenewal: rule(
    'KDN-RENEW-2027',
    {
      /** The KDN checklist (Lampiran C 2027) in KDN's own order and labels (KDN skips label 4; never renumber). */
      template: {
        year: 2027,
        lines: [
          { item: '1.1', label: '-', name: 'Pengesahan pembaharuan dalam talian 2027 (eSIMS), ditandatangani pengarah', form: 'hardcopy', check: 'esims' },
          { item: '1.2', label: '1', name: 'Sijil carian insolvensi syarikat dan setiap pengarah (September 2026 atau selepas)', form: 'softcopy', check: 'since', since: '2026-09-01' },
          { item: '1.3', label: '2', name: 'SSM Corporate Info penuh (September 2026 atau selepas)', form: 'softcopy', check: 'since', since: '2026-09-01' },
          { item: '1.4', label: '-', name: 'Surat Akuan Syarikat Anti Rasuah, ditandatangani pengarah', form: 'hardcopy', check: 'pledge' },
          { item: '2.1', label: '3', name: 'Salinan lesen senjata api (Pemegang Lesen A), jika ada', form: 'softcopy', ifApplicable: true },
          { item: '3.1', label: '5', name: 'KWSP Borang A: resit rasmi dan penyata bayaran Jan-Jul 2026', form: 'softcopy', check: 'months', from: '2026-01', to: '2026-07' },
          { item: '3.2', label: '6', name: 'PERKESO: resit rasmi dan penyata bayaran Jan-Jul 2026', form: 'softcopy', check: 'months', from: '2026-01', to: '2026-07' },
          { item: '3.3', label: '7', name: 'Cukai pendapatan syarikat 2026 (CP204) dan pengesahan bayaran SST 2026', form: 'softcopy', check: 'year', year: 2026 },
          { item: '3.4', label: '8', name: 'Penyata bayaran levi PSMB (HRD Corp) 2026', form: 'softcopy', check: 'year', year: 2026 },
          { item: '3.5', label: '9', name: 'Penyata kewangan beraudit 2025 atau surat pengesahan juruaudit', form: 'softcopy', check: 'year', year: 2025 },
          { item: '3.6', label: '10', name: 'Polisi insurans berkuat kuasa: Indemniti Profesional, Liabiliti Awam, Kemalangan Diri Berkumpulan', form: 'softcopy', check: 'insurance' },
          { item: '3.7', label: '11', name: 'Penyata bank syarikat, 1 bulan terkini (bulan penuh sebelum janji temu)', form: 'softcopy', check: 'statement' },
          { item: '4.1', label: '12', name: 'CSG: bilangan pengawal tempatan belum berlatih 2026 dan resit pendaftaran CSG 2026', form: 'softcopy', check: 'counts', count: 'CSG' },
          { item: '4.2', label: '13', name: 'TNG: bilangan pengawal tempatan belum berlatih 2026 dan resit pendaftaran TNG 2026', form: 'softcopy', check: 'counts', count: 'TNG' },
          { item: 'Akhir', label: '-', name: 'Akuan pengarah / pemegang saham pada senarai semak (nama, IC, jawatan, cop, tandatangan)', form: 'hardcopy', check: 'declaration' },
        ],
      } as import('./kdn-renewal').KdnTemplate,
      /** KDN's 2027 window and the Hari Bertemu Pelanggan sessions (Lampiran A), with the group's own dates (W-X3). */
      window: {
        year: 2027,
        opens: '2026-09-28',
        closes: '2026-12-31',
        hours: '8.00 pagi - 5.00 petang (Isnin - Jumaat)',
        sessions: [
          { no: 1, from: '2026-09-28', to: '2026-10-02' },
          { no: 2, from: '2026-10-12', to: '2026-10-16' },
          { no: 3, from: '2026-10-26', to: '2026-10-30' },
          { no: 4, from: '2026-11-09', to: '2026-11-13' },
          { no: 5, from: '2026-11-23', to: '2026-11-27' },
          { no: 6, from: '2026-12-07', to: '2026-12-11' },
          { no: 7, from: '2026-12-14', to: '2026-12-18' },
        ],
        /** Session 7 only for a company KDN sent back for missing papers (W-X3). */
        returnOnlySessions: [7],
        openBy: '2026-11-18',
        bookBy: '2026-11-23',
        acceptBy: '2026-12-11',
        place: 'Bahagian Keselamatan dan Ketenteraman Awam, Aras 10, Blok Setia Perkasa 1, Putrajaya',
      } as import('./kdn-renewal').KdnWindow,
    },
    'Policy',
    "KDN letter KDN.K.S.700-3/1/8 Jld. 41 (1), 11 Sep 2026, with Lampiran A-C and the anti-corruption pledge. Fauzan, 14 Nov 2026 (W-X1..W-X13): the 2027 checklist is the template (\"KDN usually update this yearly\"; Central Admin loads a new year with a reason); a director of the same company signs; renewal opened by 18 Nov, appointment by 23 Nov, sessions 5 or 6, session 7 only after a return; not booked by 23 Nov = CoS, not accepted by 11 Dec = CEO; item 3.3 = CP204 and SST proof with Finance's no-arrears tick; bank statement = the full month before the appointment; the company head confirms the CSG/TNG counts; every Nepali guard in eSIMS before the director signs; every company holds a 2(b) licence; insolvency search for the company and every director.",
  ),
  /**
   * Part T (Fitri package; papers T-D1..T-D9 sent 13 Nov 2026; Fauzan's answers T-X1..T-X9 13 Nov 23:49Z and round 2
   * 23:52Z): one site supplies request for cleaning (KBK), Nepali guard (PKK Nepal) and local guard (PKK) sites. These
   * are the starting settings per contract type; the OGM (government store) or Operations Director (a private store)
   * changes them in the app with a reason. No Min or Max number is set here: management sets them from real usage.
   */
  siteSupplies: rule(
    'SITE-SUPPLIES',
    {
      contracts: {
        KBK: { prefix: 'KBK', label: 'Kebersihan (KBK)', startedBy: 'supervisor', firstCheck: false, bulkCount: false, responsible: false },
        PKK_NEPAL: { prefix: 'NEP', label: 'PKK Nepal', startedBy: 'om', firstCheck: true, bulkCount: true, responsible: true },
        PKK: { prefix: 'PKK', label: 'PKK Tempatan', startedBy: 'patrol_officer', firstCheck: false, bulkCount: true, responsible: true },
      },
      /** Pieces sent in bulk to a guard site and not handed out within this many days show on the OM board (T6). */
      handOutDays: 30,
      /** Guards on a line who were not on that site's roster in this many days show to the first checker (T3a). */
      rosterDays: 14,
      /** "Prima only from" (T-X2): empty until Fauzan sets the date; until then paper, email and SharePoint also run. */
      primaOnlyFrom: null as string | null,
      maxLines: 60,
    },
    'Policy',
    'Fauzan, 13 Nov 2026 (T-X1..T-X9 and round 2: OGM or a named deputy confirms; Nepal first check by the Gov Ops HQ admin executive; bulk count and responsible person ON for PKK Nepal and PKK Local; in-app notices now, email later; Goodwill store for government contracts)',
  ),
  /**
   * Part U (Fitri package; papers U-D1..U-D17 sent 13-14 Nov 2026; Fauzan's answers U-X1..U-X15, 14 Nov 2026): stock
   * counts, the 6-monthly major count with a freeze, variance and book correction, the Monday opening balance, the
   * stock card, store stages and times, the CSG/TNG course uniform buffer, the 7 KPIs, the monthly report and the
   * disposal case. Every number is a setting; empty means "belum ditetapkan" and never a default.
   */
  amRental: rule(
    'AM-RENTAL',
    {
      /** Letting (V-X11, V35-V39): first reply in office hours, same working day; after 5.30 pm by 10 am next working day. */
      firstReplyOfficeHours: 2,
      afterHoursReplyBy: '10:00',
      viewingWorkingDays: 1,
      screenMinutes: 30,
      advertOfficeHours: 2,
      agentAfterDays: 30,
      agentFeeMonths: 1,
      platforms: ['FACEBOOK_MARKETPLACE', 'PROPERTYGURU', 'MUDAH'] as string[],
      /** Household income (applicant + spouse) by rent band (V45, V-X20, V-X21); below 800 and above 2500 the Asset Director sets per unit. */
      incomeBands: [
        { from: 800, to: 999, need: 3500, upTo: 4000 },
        { from: 1000, to: 1599, need: 4500, upTo: 5000 },
        { from: 1600, to: 2500, need: 6000, upTo: 6500 },
      ],
      /** Occupants by bedrooms (V45): 2 -> 4, 3 -> 5, 4+ -> warn above 6, max 7. */
      occupants: { 2: 4, 3: 5, 4: 7 } as Record<number, number>,
      occupantsWarn4Bed: 6,
      parking: { TERRACE: { cars: 2, motorcycles: 2 }, MULTI_STOREY: { cars: 1, motorcycles: 1 }, OTHER: { cars: 1, motorcycles: 1 } } as Record<string, { cars: number; motorcycles: number }>,
      depositMonths: 2,
      advanceMonths: 1,
      utilitiesHours: 72,
      applicationDeleteMonths: 6,
      wholeProcessWorkingDays: 9,
      /** Monthly rent (V58-V63): invoices 20th-24th, window 25th to the 10th, 24 h steps, Dalam Semakan 3 working days. */
      invoiceFromDay: 20,
      invoiceByDay: 24,
      windowFromDay: 25,
      windowToDay: 10,
      stepHours: 24,
      sendEscalateHours: 48,
      dalamSemakanWorkingDays: 3,
      receiptWorkingDays: 1,
      /** Arrears (V64-V68): 3 months of the tenant's part, 3 working days, notice on day 4, 14 calendar days, management 3-7 working days. */
      arrearsMonths: 3,
      demandWorkingDays: 3,
      vacateDays: 14,
      managementWorkingDays: 7,
      /** Move-out (V69-V73). */
      noticeDays: 30,
      inspectCutoff: '14:00',
      statementHours: 24,
      refundWorkingDays: 3,
      heldBillSettleWorkingDays: 7,
      /** Stamping (V74-V77, V-X30): tenant pays in 24 h; reminders day 3 and 7 after signing; day 20 to the Asset Director; 30-day deadlines; keep 7 years. */
      stampTenantHours: 24,
      stampReminderDays: [3, 7],
      stampEscalateDay: 20,
      stampDeadlineDays: 30,
      stampKeepYears: 7,
      /** Repairs (V78-V89, V-X31..V-X37). */
      repair: { inspectWorkingDays: 1, adminHours: 48, quotesNeeded: 3, quoteOnlyLimit: 5000, vcAbove: 5000, ceoAbove: 50000, objectionDays: 7, objectionReplyWorkingDays: 3, tenantPayDays: 14, unclearWarnWorkingDays: 5, waterRefundMonths: 3, waterWarnMonths: 2 },
      zakatExpiryWarnDays: 30,
      papersFrom: '2026-11-18',
    },
    'Policy',
    'Prisma Wiramaju rental papers V-D6..V-D46 (advertising, application and selection, tenancy agreement, stamping online, monthly rent collection, 3-month arrears and notice to vacate, tenant moving out, repair responsibility and the maintenance request), sent by Fauzan 14 Nov 2026, with his answers V-X11..V-X37 (14 Nov 2026 00:40Z, 01:43Z, 01:51Z and 03:12Z): first enquiry reply within 2 office hours; rent, deposit, terms, platforms and agents proposed by the rental admin executive and approved by the Asset Director; a new tenant approved by the Asset Director then the Chairman or Vice Chairman; the papers\' income bands on applicant + spouse income (no separate one-earner guide; gaps use the band below; outside 800-2500 the Asset Director sets the minimum); company tenants on a company form; deposit 2 months + 1 month\'s rent to the OWNER company\'s account; only Finance confirms money from the bank, never a slip; no cash for rental home rent (CDM with the slip); rent invoices raised in SQL Account by Finance and checked against the tenancy; zakat body pays full or part, any shortfall by the 10th moves to the tenant and counts in arrears; two receipts for a zakat tenant; the 14-day notice is followed by the Asset Director\'s decision (lawyer\'s letter and court action by default, or a written payment plan; a lock-out only after the company\'s lawyer confirms in writing); final bills not out: hold only an estimate; a zakat-paid deposit is refunded to the zakat body unless its written release is on file; stamp duty paid to LHDN by Finance only after the tenant\'s money is confirmed; repairs proposed by the officer and approved by the Asset Director, the Vice Chairman\'s consent above RM5,000 and the CEO above RM50,000; tenant repair charges invoiced separately, 14 days, not counted in rent arrears; objection within 7 days; panel contractors per trade; water refund only when an owner leak is repaired more than 3 months after it was found.',
  ),
  inventoryControl: rule(
    'INV-CONTROL',
    {
      /** U-X1: every store is counted once a month (all categories), no freeze. */
      countEveryDays: 30,
      /** U-X10: the full major count with the 2-5 PM freeze on the last working day of June and December. */
      majorMonths: [6, 12],
      majorWindow: { from: '14:00', to: '17:00' },
      /** U-X3: a variance line above this value also needs the OGM. */
      adjustOgmAbove: 500,
      /** U-X7: a disposal case at or above this value, any sale or auction, or a sensitive item needs the OGM / company manager. */
      disposalApproveAbove: 1000,
      /** U-X11: 7 working days from approval to Ready for Delivery for in-stock lines; 10 working days for a disposal. */
      inStockReadyDays: 7,
      disposalDays: 10,
      /** U-X5: other stage targets after one month of data (empty). */
      stageTargets: { order: null as number | null, receiving: null as number | null, preparation: null as number | null, delivery: null as number | null },
      /** U6/U-X4: "Checked by PIC" by a second store person; skipped by a private store with one admin executive. */
      picStores: ['goodwill'] as string[],
      /** U3: the same item short in this many counts in a row is flagged to the OGM. */
      repeatShortCounts: 3,
      /** U9: the papers' targets (set by SOP-INV-001; Fauzan may change them). */
      kpiTargets: { accuracyPct: 98, unauthorised: 0, recordedPct: 100, uniformRecordPct: 100, countCompletionPct: 100, investigatedPct: 100, stockOuts: 0 },
      /** U18: days for goods received to reach the store or register ("tempoh pendaftaran"), empty until set. */
      registerDays: null as number | null,
      /** U19: expected life in months per equipment kind, empty until set. */
      expectedLifeMonths: {} as Record<string, number>,
      /** U-X9: inventory, count and disposal records kept at least 7 years. */
      recordsYears: 7,
      /** U-X6b: a CSG / TNG course set does not count in the 3 free pieces (fixed rule). */
      courseSetsInAllowance: false,
      /** U-X12: who may be charged for negligence or misuse; the legal flag shown on each charge. */
      chargeCauses: ['NEGLIGENCE', 'MISUSE'],
      /** U16: the supplier's DO number and a photo are needed on every goods received note. */
      grnDoRequired: true,
      /** U8: a buffer level is reviewed at least every this many days. */
      bufferReviewDays: 90,
      legalFlag: 'Employment Act 1955 s.24: a damage deduction generally needs the worker’s written agreement or the Labour Director General’s permission (s.24(4)); all deductions in a month within 50% of wages (s.24(8)).',
    },
    'Policy',
    'Fauzan, 14 Nov 2026 (U-X1 monthly count; U-X2/U-X10 major count 2-5 PM with freeze end June and December; U-X3 adjust only through the variance report, OGM above RM500; U-X4 store stages; U-X5/U-X11 7 and 10 working days; U-X6 CSG/TNG course buffer, U-X6b outside the allowance; U-X7 disposal RM1,000; U-X8 Admin = Procurement executive; U-X9 7 years; U-X12 negligence or misuse taken from pay with HR review; U-X14/U-X15 office purchases 3 quotes + 2 online, store stock 3 + 1)',
  ),
  toolbox: rule(
    'TOOLBOX-AGENDA',
    {
      /** The two standard agendas (X2). source: what Prima fills the section from (X3), or 'manual' for status lines only. */
      agenda: {
        company: [
          { key: 'a', title: 'Kehadiran', source: 'attendance' },
          { key: 'b', title: 'Lesen KDN, cawangan negeri dan lesen PBT', source: 'kdn' },
          { key: 'c', title: 'Kontrak semasa: tenaga kerja, tapisan, CSG, tamat kontrak', source: 'contracts' },
          { key: 'd', title: 'Bil dan bayaran pelanggan mengikut kontrak', source: 'billing' },
          { key: 'e', title: 'Tuntutan PGM', source: 'pgm' },
          { key: 'f', title: 'Caruman berkanun dan cukai', source: 'statutory' },
          { key: 'g', title: 'Tugasan pentadbiran HQ', source: 'manual' },
          { key: 'h', title: 'Kursus CSG dan TNG', source: 'training' },
          { key: 'i', title: 'Tender dan pendaftaran vendor', source: 'tenders' },
          { key: 'j', title: 'Penama MOF', source: 'nominees' },
          { key: 'k', title: 'Senjata api: Pelesen A, AMRA, bilik kebal', source: 'arms' },
          { key: 'l', title: 'Pengurus zon / JV', source: 'jv' },
          { key: 'm', title: 'Kuota dan pekerja Nepal', source: 'fwm' },
          { key: 'n', title: 'Bil syarikat, pinjaman, sewa, audit, ISO', source: 'bills' },
          { key: 'sulit', title: 'SULIT: perkara atas nama individu', source: 'sulit' },
          { key: 'o', title: 'Hal-hal lain dan mesyuarat seterusnya', source: 'manual' },
        ],
        department: [
          { key: '1', title: 'Kehadiran dan perkara terbuka', source: 'attendance' },
          { key: '2', title: 'Kakitangan: bilangan, kekosongan, cuti dan ganti, latihan', source: 'people' },
          { key: '3', title: 'Kerja: tugasan terbuka, lewat, KPI', source: 'work' },
          { key: '4', title: 'Kewangan: bajet, pembelian dan bayaran menunggu, tuntutan', source: 'manual' },
          { key: '5', title: 'Pematuhan dan risiko: penemuan ACT, lesen, kes', source: 'compliance' },
          { key: '6', title: 'Aset dan sistem: peralatan, isu IT, kenderaan', source: 'manual' },
          { key: '7', title: 'Rancangan 2 minggu dan bantuan diperlukan', source: 'manual' },
          { key: '8', title: 'Keputusan, hal lain, mesyuarat seterusnya', source: 'manual' },
        ],
      } as Record<'company' | 'department', { key: string; title: string; source: string }[]>,
      /** Status lines not changed for this many meetings: told to the company manager / department head, then the Director Office (X-Q9). */
      staleTell: [3, 6] as [number, number],
      /** A central management director attends each company and department toolbox once in every this many months (X16). */
      directorEveryMonths: 2,
      /** Who counts as a central management director (X16, confirmed by Fauzan 14 Nov 2026). */
      centralDirectors: { opsTier: ['ceo', 'coo', 'ops_director', 'ogm'], leadership: ['cos', 'deputy_cos', 'finance_director'] },
      /** The OM's site safety and operations talk: every site at least once in this many days (X19, confirmed). */
      siteTalkDays: 30,
      /** KDN branch offices per company: a warning above this number; null = no number set yet (X-Q8). */
      maxBranches: null as number | null,
    },
    'Policy',
    "Fauzan, 14 Nov 2026 (Part X answers X-Q1..X-Q11): every company and every central department holds a toolbox meeting every 2 weeks with a standard agenda that monitors the whole management of the company or department; one central management director (CEO, COO, CoS, DCoS, FD, Ops Director or OGM, confirmed 14 Nov 2026) attends each once every 2 months; the director who chairs verifies (else the company manager; the department head for a department), never the preparer; verifying in Prima replaces signature and stamp; items in one person's name go into the pack marked SULIT; site safety and operations talks are done by the OM, every site at least monthly (confirmed 14 Nov 2026).",
  ),
  groupMonthly: rule(
    'GROUP-MONTHLY',
    {
      /** The 14 standing items of each company's monthly report (folder "AGENDA MESYUARAT BULANAN JA GROUP"); from = the Part X pack sections Prima fills it from. */
      items: [
        { key: '1', title: 'Perubahan lembaga pengarah dan modal berbayar', from: [] as string[], own: 'board' },
        { key: '2', title: 'KDN: cawangan, pengarah, tapisan, STS, lesen senjata', from: ['b', 'k'] },
        { key: '3', title: 'Caruman: KWSP, PERKESO, SIP, PSMB/HRD', from: ['f'] },
        { key: '4', title: 'Cukai: SST, LHDN dan CP204, PCB, zakat', from: ['f'] },
        { key: '5', title: 'Audit akaun, audit Kastam/LHDN/agensi lain, kes mahkamah', from: ['n'], own: 'court' },
        { key: '6', title: 'Insurans syarikat dan jaminan insurans (IG)', from: ['n'] },
        { key: '7', title: 'Projek KPM: zon, tempoh, pengawal, invois hingga bulan', from: ['c', 'd', 'e'] },
        { key: '8', title: 'Projek kementerian lain / swasta (projek HQ)', from: ['c', 'i'] },
        { key: '9', title: 'Gaji dan pendahuluan pengawal: pindahan, tiada akaun bank, tunai', from: [], own: 'payMethod' },
        { key: '10', title: 'Aduan dan audit Jabatan Tenaga Kerja (JTK)', from: [], own: 'jtk' },
        { key: '11', title: 'Pengurusan Nepal: kelulusan, bilangan, lokasi, permit tamat', from: ['m'] },
        { key: '12', title: 'Kursus CSG dan TNG tahun ini, tuntutan PSMB', from: ['h'] },
        { key: '13', title: 'Pentadbiran syarikat: fail, pejabat, bilik kebal, kebersihan', from: [], own: 'line' },
        { key: '14', title: 'Hubungan sesama rakan sekerja', from: [], own: 'line' },
      ] as { key: string; title: string; from: string[]; own?: string }[],
      /** Unit sections (Y4) added to the department pack of these units. */
      unitSections: {
        audit: ['Laporan akaun syarikat (penjejak)', 'Analisis umur penghutang'],
        finance: ['Audit LHDN / Kastam', 'Invois lama belum dibayar'],
        fwm: ['Imigresen dan penguatkuasaan', 'Lesen agensi pekerjaan', 'FWCMS', 'Senarai hitam'],
        it: ['Akaun M365 dan peti mel', 'Pembelian ICT', 'Tender IT', 'Aliran kelulusan SharePoint'],
        kbk_bmb: ['Kontrak mengikut zon', 'Bayaran PPD/PTJ hingga bulan'],
        school: ['Sistem gaji jam utama', 'Tender 2027'],
        transport: ['Kad subsidi minyak'],
      } as Record<string, string[]>,
      /** Y-Q3: reports in Prima this many working days before the meeting; the company manager verifies. */
      deadlineWorkingDays: 3,
      /** Y5: a month's accounts report is due by this day of the following month (the company checklists: 20-28hb, due 28hb). */
      acctReportDueDay: 28,
      /** Y5: the red/yellow/green report goes to the employer every Friday (weekday 5). */
      rygWeekday: 5,
    },
    'Policy',
    "Fauzan, 14 Nov 2026 (Part Y answers Y-Q1..Y-Q10): the monthly JA Group meeting uses the 14-item company template filled from each company's records; the monthly report is the company's last verified toolbox pack plus the monthly-only items (one report, not two); reports are in Prima 3 working days before the meeting, the company manager verifies, Unit HR sees who is missing and a report still missing on the day is red to the Director Office; the missing items (board and paid-up capital, JTK, court cases, guard pay method, office filing and cleanliness, staff relations) are added; Internal Audit's accounts report tracker and Friday red/yellow/green report move into Prima; named people's PCB, zakat and shareholdings stay in the SULIT section; Prima's minutes become the record of the monthly group meeting.",
  ),
  groupDuties: rule(
    'GROUP-DUTIES',
    {
      /**
       * Y6 / Y11: the common company HQ duty template (section 0 of the duty map built from every company's checklists,
       * 14 Nov 2026) by role. Each company manager loads it for their people and adds or removes lines. every: daily,
       * weekly (weekday 1-5), monthly (window fromDay-toDay), yearly (month + window) or adhoc (no fixed date).
       */
      template: {
        company_manager: [
          { id: 'cm-email', text: 'Emel dan surat syarikat', every: 'daily' },
          { id: 'cm-bank', text: 'Baki bank dan wang masuk (rekod, maklum Kewangan)', every: 'daily' },
          { id: 'cm-payback', text: 'Rekod bayaran balik pengurus (invois, tarikh bayar, tarikh pulang, slip)', every: 'daily' },
          { id: 'cm-tender', text: 'Semakan tender harian dan senarai tanda', every: 'daily' },
          { id: 'cm-claims', text: 'Semak tuntutan HQ, operasi, peronda, penyelia', every: 'monthly', fromDay: 1, toDay: 7 },
          { id: 'cm-state-claims', text: 'Tuntutan negeri dalam Teams', every: 'monthly', fromDay: 8, toDay: 8 },
          { id: 'cm-cp204', text: 'CP204', every: 'monthly', fromDay: 1, toDay: 7 },
          { id: 'cm-guardpay', text: 'Gaji pengawal: semak kehadiran, OT, MC dan hantar', every: 'monthly', fromDay: 1, toDay: 5 },
          { id: 'cm-guardpay-verify', text: 'Sahkan gaji pengawal', every: 'monthly', fromDay: 15, toDay: 18 },
          { id: 'cm-hqpay', text: 'Rekod gaji HQ dan potongan pengarah ke HR', every: 'monthly', fromDay: 20, toDay: 20 },
          { id: 'cm-acct', text: 'Laporan akaun bulanan', every: 'monthly', fromDay: 20, toDay: 28 },
          { id: 'cm-jag', text: 'Agenda mesyuarat bulanan JA Group', every: 'monthly', fromDay: 20, toDay: 28 },
          { id: 'cm-zakat', text: 'Zakat (PCB) dan sewa stor KBK', every: 'monthly', fromDay: 28, toDay: 30 },
          { id: 'cm-petty', text: 'Wang runcit (termasuk pejabat cawangan) melalui Teams', every: 'monthly', fromDay: 28, toDay: 30 },
          { id: 'cm-rent', text: 'Rekod sewa pejabat dan kenderaan, slip kepada tuan rumah', every: 'monthly', fromDay: 1, toDay: 5 },
          { id: 'cm-esims', text: 'eSIMS KDN: cawangan, profil, pembaharuan lesen', every: 'yearly', month: 10, fromDay: 1, toDay: 31 },
          { id: 'cm-insurance', text: 'Pembaharuan insurans syarikat (sebut harga melalui Teams)', every: 'yearly', month: 9, fromDay: 1, toDay: 30 },
          { id: 'cm-pikm', text: 'Keahlian PIKM', every: 'yearly', month: 1, fromDay: 1, toDay: 31 },
          { id: 'cm-ssm', text: 'SSM MyData tahunan', every: 'yearly', month: 1, fromDay: 1, toDay: 31 },
          { id: 'cm-pbt', text: 'Lesen PBT', every: 'yearly', month: 2, fromDay: 1, toDay: 28 },
          { id: 'cm-licA', text: 'Lesen A senjata api (selewat-lewatnya 30 Jun)', every: 'yearly', month: 6, fromDay: 1, toDay: 30 },
          { id: 'cm-mof', text: 'Profil MOF (cawangan, kod bidang, penama, sijil digital)', every: 'adhoc' },
          { id: 'cm-bigtender', text: 'Tender besar PKK/KBK/BMB (sedia, bahagi zon, muat naik, slip)', every: 'adhoc' },
        ],
        admin_exec: [
          { id: 'ae-email', text: 'Emel, telefon (termasuk pengesahan pekerjaan), kumpulan WhatsApp/Teams, surat dan fail', every: 'daily' },
          { id: 'ae-ep', text: 'Bayaran e-Perolehan PKK/KBK dan pengesahan invois', every: 'daily' },
          { id: 'ae-eptender', text: 'Imbasan tender EP harian (tarikh tutup, dokumen, taklimat)', every: 'daily' },
          { id: 'ae-csg', text: 'Pendaftaran dan bayaran CSG/TNG dalam PIKM', every: 'daily' },
          { id: 'ae-vetting', text: 'Tapisan eSIMS (mohon, lulus/gagal, batal yang berhenti, sijil)', every: 'daily' },
          { id: 'ae-statutory', text: 'KWSP/PERKESO/SIP/PSMB, resit dan Borang 8A', every: 'monthly', fromDay: 5, toDay: 15 },
          { id: 'ae-permit', text: 'Permit/ePLKS Nepal dalam eSIMS', every: 'monthly', fromDay: 1, toDay: 15 },
          { id: 'ae-payslip', text: 'Slip gaji kepada Operasi', every: 'monthly', fromDay: 2, toDay: 8 },
          { id: 'ae-tendersum', text: 'Ringkasan tender dalam pautan HR', every: 'monthly', fromDay: 1, toDay: 28 },
          { id: 'ae-hrdf', text: 'Tuntutan HRDF untuk CSG', every: 'monthly', fromDay: 1, toDay: 28 },
          { id: 'ae-filing', text: 'Fail tahunan sedia sebelum 1 Januari', every: 'yearly', month: 12, fromDay: 1, toDay: 31 },
          { id: 'ae-kdn', text: 'Dokumen pembaharuan KDN', every: 'yearly', month: 10, fromDay: 1, toDay: 31 },
          { id: 'ae-newcontract', text: 'Dokumen kontrak baharu (pas, memo, nombor kecemasan, SOP, profil)', every: 'adhoc' },
        ],
      } as Record<string, { id: string; text: string; every: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'adhoc'; fromDay?: number; toDay?: number; month?: number; weekday?: number }[]>,
      /**
       * Part Z2: the group monthly calendar from the companies' files (14 Nov 2026). Unit HR or the Director Office may
       * change it in the app with a reason; this list is only the starting value. every: monthly (default), bimonthly
       * (every 2 months), twice (twice a month) or weekly (weekday 1-5).
       */
      calendar: [
        { id: 'cal-payapprove', text: 'Kelulusan gaji', fromDay: 2, toDay: 3 },
        { id: 'cal-pay', text: 'Bayar gaji', fromDay: 7, toDay: 7 },
        { id: 'cal-statutory', text: 'KWSP / PERKESO / SIP', fromDay: 8, toDay: 15 },
        { id: 'cal-rent', text: 'Sewa', fromDay: 1, toDay: 7 },
        { id: 'cal-tax', text: 'CP204 / PCB / PSMB', fromDay: 13, toDay: 15 },
        { id: 'cal-advapprove', text: 'Kelulusan pendahuluan', fromDay: 16, toDay: 17 },
        { id: 'cal-adv', text: 'Bayar pendahuluan', fromDay: 20, toDay: 20 },
        { id: 'cal-hqpay-hr', text: 'Gaji HQ (HR)', fromDay: 20, toDay: 20 },
        { id: 'cal-hqpay-de', text: 'Gaji HQ (kemasukan data)', fromDay: 28, toDay: 28 },
        { id: 'cal-reports', text: 'Laporan bulanan', fromDay: 28, toDay: 28 },
        { id: 'cal-sst', text: 'SST (setiap 2 bulan)', fromDay: 25, toDay: 31, every: 'bimonthly' },
        { id: 'cal-bills-1', text: 'Bil (pusingan 1)', fromDay: 2, toDay: 2 },
        { id: 'cal-bills-2', text: 'Bil (pusingan 2)', fromDay: 22, toDay: 22 },
        { id: 'cal-claims-1', text: 'Tuntutan (pusingan 1)', fromDay: 11, toDay: 11 },
        { id: 'cal-claims-2', text: 'Tuntutan (pusingan 2)', fromDay: 23, toDay: 23 },
        { id: 'cal-hp', text: 'Sewa beli (HP)', fromDay: 30, toDay: 30 },
        { id: 'cal-toolbox', text: 'Toolbox (dua kali sebulan)', every: 'twice' },
        { id: 'cal-balances', text: 'Baki kepada Ketua Kewangan', every: 'weekly', weekday: 4 },
      ] as { id: string; text: string; fromDay?: number; toDay?: number; every?: 'monthly' | 'bimonthly' | 'twice' | 'weekly'; weekday?: number }[],
    },
    'Policy',
    'Fauzan, 14 Nov 2026 (Part Y answers Y-Q6, Y-Q7 and Y11): the real duty checklists replace the draft role playbooks, with yearly and ad hoc duties, a date window and a named person (with a backup) on each line; each head loads theirs when real data is allowed; a checklist line done inside its window counts as on time in that person\'s KPI. The template is the common company HQ list found in every company\'s checklist (duty map, 14 Nov 2026).',
  ),
  armsLocalOnly: rule(
    'ARMS-LOCAL-ONLY',
    true,
    'Policy',
    'Fauzan, 2 Nov 2026: "foreign guard cannot use arm." The group\'s rule on top of the Private Agencies (Amendment) Act 2025: only Malaysian guards carry arms. A foreign guard is never issued a firearm, rostered on an armed post or put on an armed job (CIT, CDM, cash vaulting, bodyguard). Bank CIT tenders also ask for Malaysian armed guards (RHB tender notice).',
  ),
  actFraud: rule(
    'ACT-FRAUD',
    {
      /** Look-back for every anomaly rule. */
      lookBackDays: 90,
      /** Two staff phone clocks this close in time and place, both away from their base, may be one person clocking two. */
      buddyClock: { minutes: 5, metres: 25 },
      /** One person reversing this many rent payments inside the look-back. */
      rentReversals: 2,
      /** Evidence kept in an investigation file: at most this many files, each at most this size. */
      evidenceMax: 20,
      evidenceBytes: 1_500_000,
    },
    'Policy',
    'Fauzan, 3 Nov 2026 ("build all not build"): masterplan item 241, fraud anomalies, investigations and forensic controls. The anomaly rules are fixed checks on records already in Prima, never AI and never an accusation: ACT decides whether to open a finding or an investigation. Investigations are seen only by ACT; evidence is kept with its SHA-256 and every open, add, view and close is logged. Nobody is disciplined automatically. The look-back, the buddy-clock window, the reversal count and the evidence limits are proposals.',
  ),
  monthlyReport: rule(
    'RPT-MONTHLY',
    {
      /** Fauzan, 2 Nov 2026: every department's monthly report is due on the 25th of the next month. */
      dueDay: 25,
      /**
       * Proposed standard form for every department's monthly report (Fauzan, 2 Nov 2026: "propose what standard form
       * whole app ... and ACT department to decide what needed"). The ACT Director changes the sections per department.
       */
      sections: [
        'Summary of the month: three to five key points',
        'Key figures against target: speed and quality of the work',
        'Work done, work still open and anything overdue',
        'Money: spending against budget, payments made and pending',
        'People: headcount, joiners, leavers, leave and training',
        'Compliance: licences, permits and legal dates due in the next 90 days; ACT findings open and fixed',
        'Risks, incidents and complaints',
        'Improvements done and planned',
        'Decisions or help needed from management',
      ],
      /** Proposed: the figures ACT compares with the records already in Prima, per department. */
      checks: {
        operations: ['Guard no-shows and replacements against attendance', 'Incidents and cases against the case register'],
        hr: ['Headcount, joiners and leavers against staff records', 'Pay changes against verified pay changes'],
        arms_control: ['Firearm count against the vault register', 'Firearms issued and returned against arms movements'],
        chief_of_staff: ['Policies and renewals against the insurance register', 'Claims against insurance claims'],
        cms: ['Alarms and calls against the CMS log'],
        director_office: ['Tenders sent against the tender register', 'Meetings and minutes against the meeting list'],
        fwm: ['Permit renewals against foreign worker records'],
        pdpa: ['Data requests and breaches against the PDPA register'],
        transport: ['Vehicles, services and road tax against the fleet list'],
        asset: ['Rent collected and arrears against the rental records'],
        finance: ['Collections and payments against SQL Account and the bank', 'Statutory payments against the payment list'],
        it: ['Tickets opened and closed against the IT board', 'Devices and rentals against the asset list'],
        legal: ['Legal matters and filings against the corporate register'],
        audit: ['Findings opened and closed against the ACT register'],
        procurement: ['Purchases and stock against purchase requests and the store'],
      } as Record<string, string[]>,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: ACT monitors the monthly report of each department; each report is due on the 25th of the next month (25 days after the month ends). The standard form is a proposal; the ACT Director decides what each department must cover. ACT checks each report is on time, complete and true against the records in Prima.',
  ),
  workRebalance: rule(
    'WORK-REBALANCE',
    {
      /** Leave starting within this many days is shown. */
      lookAheadDays: 5,
      /** Overloaded: open load at least this many times the team average, and at least overloadMin. */
      overloadFactor: 1.5,
      overloadMin: 5,
      /** Someone with this many overdue tasks is not given more. */
      overdueBusy: 3,
      /** Overdue this many hours: advise a decision. */
      stuckHours: 24,
      /** Timing: at risk when time left is under riskFactor x the person's usual time, and at most riskMaxHours. */
      riskFactor: 1,
      riskMaxHours: 72,
      /** The usual time is known only after this many finished tasks (fewer is UNKNOWN), from at most sampleMax. */
      minFinished: 3,
      sampleMax: 20,
      lookBackDays: 28,
      /** A moved task with under this many hours left also gets a new due time, extendHours later. */
      minHoursLeft: 4,
      extendHours: 24,
    },
    'Policy',
    'Fauzan, 2 Nov 2026: each manager may delegate or readjust the work of staff under them, and Arisha advises what to change from the data (time to do tasks, workload). Fauzan approved these thresholds on 2 Nov 2026 (he may change them later). The advice is a prompt for the manager, never a finding, ranking or input to pay or access; the manager decides and gives a reason.',
  ),
  workRebalanceAi: rule(
    'WORK-REBALANCE-AI',
    { perUserPerDay: 10 },
    'Policy',
    'Fauzan, 2 Nov 2026: "Use ai when needed. We use it in case basis." A manager may ask Arisha AI about one rebalance case at a time, by pressing a button; it is off until switched on (WORK_REBALANCE_AI_ENABLED) and needs Arisha AI to be on. Proposed cap: 10 asks per manager per day, to keep within the Arisha cost target. People are sent as Person A, B, C; no names, task titles, leave kinds or reasons go to the AI.',
  ),
  fwmPassportCheckDays: rule(
    'FWM-PASSPORT-CHECK',
    90,
    'Policy',
    'Approved by Fauzan, 3 Nov 2026: FWM checks where each foreign worker\'s passport is at least every 90 days. The worker keeps it; withholding a passport is an offence under the Passports Act 1966 s.12(1)(f).',
  ),
  fwmWelfareCheckDays: rule(
    'FWM-WELFARE-CHECK',
    90,
    'Policy',
    'Approved by Fauzan, 3 Nov 2026: FWM has a private welfare talk with each foreign worker at least every 90 days (ILO forced-labour indicators).',
  ),
  fwmPassportConsentDoc: rule(
    'FWM-PASSPORT-CONSENT',
    true,
    'Policy',
    'Approved by Fauzan, 3 Nov 2026: a document attached to a passport check or follow-up counts as the worker\'s consent to company safekeeping. The app does not read the document, so it cannot tell whether it is a real, voluntary consent signed by the worker; the FWM officer attaching it is responsible for that. Legal flag kept (Passports Act 1966 s.12(1)(f)): reviewed by the directors, not shown to routine staff.',
  ),
  fwmZeroFee: rule(
    'FWM-ZERO-FEE',
    true,
    'Policy',
    'Best practice review BP-1, built on Fauzan\'s go-ahead of 3 Nov 2026: no worker pays to get the job. FWM asks each new worker privately what they paid; any fee found is followed up until the agency pays it back.',
  ),
  fwmRecruitmentCost: rule(
    'FWM-RECRUITMENT-COST',
    'full_month',
    'Policy',
    'Fauzan, 3 Nov 2026: when a foreign worker of one company works under another company\'s job, the employer charges that company a recruitment cost to cover recruitment and renewal costs. Full month per worker: any day in the month counts as the whole month; when a worker works under two hosts in one month, the hosts split it half each (equal shares if more). The host pays FWM; FWM pays the owning company back at its own rate, once per worker per month. The Finance Director or CEO sets both RM rates per worker per month in the app; with no rate set the charge is Unknown and cannot be drafted. The worker keeps wearing the owning company\'s uniform (Fauzan checked with KDN, 3 Nov 2026).',
  ),
  policeHelp: rule(
    'ARMS-POLICE-HELP',
    { visitNowMin: 15, phoneCallMin: 30, bookedHoursBefore: 24 },
    'Policy',
    'Fauzan, 3 Nov 2026: a company that gets a police call or visit (usually an armoury check) asks Arms Control for help, and Arms Control sends someone. Times approved by Fauzan, 3 Nov 2026: a helper is assigned within 15 minutes for a visit happening now, 30 minutes for a phone call, and 24 hours before a booked visit; past that the request shows as late to Arms Control, CMS and the company.',
  ),
  timeSlip: rule(
    'HR-TIME-SLIP',
    { maxHours: 4, makeUpDays: 30, halfDayHours: 4, aheadDays: 30 },
    'Policy',
    'Fauzan, 4 Nov 2026: staff may ask for a time slip to leave the office for a few hours on their own matters, at most 4 hours a slip. The company head (company staff) or the department head (central staff) approves with a comment and HR is told; HR may change who approves. The hours are worked back within 30 days, counted from the staff clock after 5.30 pm. Hours not worked back by then are taken from annual leave in half days (4 hours each), and HR is told; when no annual leave is left the rest is unpaid leave for HR to see.',
  ),
  cleaningRates: rule(
    'CLEAN-RATES',
    { toilet: '10 cubicles/h', sweep: '400 m²/h', mop: '250 m²/h', vacuum: '250 m²/h', grassCut: '300 m²/h', drain: '60 m/h', briefingMin: 10, moveMin: 5, inspectMin: 5, maxPartMin: 90 },
    'Policy',
    'Fauzan, 4 Nov 2026: OMs plan each cleaning site minute by minute from the size of each area. Work rates per person are common industry figures (Fauzan said yes to defaults, 4 Nov 2026); the OM sets a different rate on any area to match the site. Breaks are taken in two turns as the KPM cleaning contract requires.',
  ),
  cleaningStock: rule(
    'CLEAN-STOCK',
    { overUsePct: 100, underUsePct: 50, reorderDays: 7 },
    'Policy',
    'Fauzan, 4 Nov 2026: cleaning equipment and supplies are planned, monitored and managed, with no over-use and no under-giving. Set by Fauzan (4 Nov 2026): use above 100% of the budget is over-use; below 50% means supplies may not reach the areas or were under-given; reorder when stock covers fewer than 7 working days (proposed); a received count below what was sent is a short delivery.',
  ),
  cleaningProof: rule(
    'CLEAN-PROOF',
    { maxPhotoBytes: 700_000, maxMapBytes: 2_000_000, timeMarkToleranceMin: 10 },
    'Policy',
    "Fauzan, 4 Nov 2026: supervisors do not sign in yet; the OM uploads the supervisor's proof, which must be a time-marked photo, not an ordinary photo. The OM enters the time printed on the photo; Prima compares it with the camera's own time when the file has it, refuses a photo from another day and refuses a photo already used as proof.",
  ),
  fleetFuel: rule(
    'FLEET-FUEL',
    { tankSlackPct: 5, kmPerLitreBandPct: 30, kmPerLitreMinFills: 3, tooSoonHours: 4, enterWithinDays: 31, trackerGapPct: 10 },
    'Policy',
    'Fauzan, 5 Nov 2026: the Transport department monitors all transport usage: petrol cards where there is one, the subsidy card, the tracker and everything that happens with each vehicle. Proposed checks: litres over the tank size by more than 5%; km per litre more than 30% away from the same vehicle\'s usual (after 3 fill-ups); two fill-ups within 4 hours; a card used on a vehicle it is not kept for; the wrong fuel on a subsidy card; a card over its monthly limit or quota; no receipt; the odometer out of order. Fill-ups are entered within 31 days. Tracker distance more than 10% away from the odometer is flagged once the tracker is connected.',
  ),
  fwmAck: rule(
    'FWM-ACK',
    {
      workingDays: 1,
      /**
       * National public holidays that fall on a weekday (weekends are skipped anyway). 2026: Deepavali replacement
       * and Christmas. 2027: the Cabinet Division schedule (Hari Raya and Deepavali dates subject to change).
       * Update each year from the official schedule; state-only holidays are not counted.
       */
      holidays: [
        '2026-11-09',
        '2026-12-25',
        '2027-03-10',
        '2027-03-11',
        '2027-05-17',
        '2027-05-20',
        '2027-06-07',
        '2027-08-31',
        '2027-09-16',
        '2027-10-28',
      ] as string[],
    },
    'Policy',
    'FW design v3, confirmed by Fauzan 26 Oct 2026: at 30 days or less before a foreign-worker paper deadline, everyone alerted (FWM, Chief of Staff, COO, CEO) acknowledges within 1 working day. Fauzan, 5 Nov 2026: Saturday, Sunday and public holidays are not working days. Holidays: national weekday holidays from the Cabinet Division schedule (2027 Islamic and Deepavali dates subject to change; 2027 replacement days and state-only holidays not included yet).',
  ),
  fwmBothApps: rule(
    'FWM-BOTH-APPS',
    true,
    'Policy',
    'Fauzan, 5 Nov 2026 (audit decision 1): the foreign worker permit and renewal board lives in both Prima and the JA Group app. FWM records papers in Prima from the paper itself; the JA app sends its dates; where they differ the board shows both and FWM decides. Prima never overwrites a date silently.',
  ),
  amBq: rule(
    'AM-BQ',
    {
      /** Under this estimate one quote is enough (proposed). */
      directBelow: 5_000,
      /** Up to this estimate three quotes (RFQ); above it an open tender with at least three bids (proposed). */
      rfqUpTo: 50_000,
      quotesForRfq: 3,
      /** Above this amount the COO approves after the Asset Director, for the BQ and for the award (proposed). */
      cooAbove: 50_000,
      /** A quote line dearer than our own past price by more than this % is flagged (proposed). */
      dearerPct: 20,
      /** Past awarded prices older than this are not used for drafts (proposed). */
      historyMonths: 24,
      /** Open jobs at the same place within this many days are suggested to go out together (proposed). */
      bundleDays: 30,
      /** Variation orders: the COO also approves once all VOs together pass this % of the award, or the price passes cooAbove (proposed). */
      voCooPct: 10,
      /** All VOs together above this % of the award: advice to check whether the job should have gone out again (proposed). */
      voWarnPct: 20,
    },
    'Policy',
    'Fauzan, 5 Nov 2026: Asset Management needs a bill of quantities for every job it offers out, with help drafting the BQ and advice on tenders and quotations at the lowest cost. Proposed for approval: the Asset Management team prepares the BQ, the Asset Director approves it and the COO also approves above RM50,000; under RM5,000 one quote, up to RM50,000 three quotes, above that an open tender; rates only from our own past awarded quotes or a price staff entered with its source, never invented; the lowest complete quote wins, any other choice needs a written reason approved the same way. Fauzan, 5 Nov 2026: every price change after the award is a variation order (VO); proposed: the Asset Director approves, and the COO too once all VOs together pass 10% of the award or the price passes RM50,000. Fauzan, 5 Nov 2026: every VO must get the consent of the Chairman and the CEO. Fauzan, 5 Nov 2026: a BQ for a new building or a renovation, laid out like his own sample (summary, lettered sections, workings, notes, contingency, Kadar left for the contractor); proposed: the contingency (5% by default, 0 to 20%) counts towards the estimate and the route but is not part of the contractor\'s price and is spent only through a VO.',
  ),
  registers: rule(
    'GOV-REGISTERS',
    {
      /** Each director declares interests once a year (Fauzan, 5 Nov 2026; Companies Act 2016 s.221). */
      interestEveryMonths: 12,
      highRiskScore: 15,
      mediumRiskScore: 8,
      highRiskReviewMonths: 3,
      otherRiskReviewMonths: 6,
      dueSoonDays: 30,
    },
    'Policy',
    "Fauzan, 5 Nov 2026: no public listing (KDN does not allow a listed security company), but follow listing-style governance a little. Related-party deals: the Deputy Chief of Staff records, the Chief of Staff reviews with a reason; a board resolution only above a limit the CEO sets (not set yet). Directors declare interests once a year (Companies Act 2016 s.221); the Deputy Chief of Staff collects the forms by hand and marks each done; only the DCoS, CoS and CEO see deals and declarations. Committees keep minutes. The risk register is in ACT only: the ACT Director scores, settles and directs the team; 5x5 scoring, high at 15 (proposal).",
  ),
  siteSurvey: rule(
    'SURVEY-OFFLINE',
    { minPhotos: 1, maxPhotos: 12, maxPosts: 20, maxMeasures: 20, keepOnPhoneDays: 30 },
    'Policy',
    'Fauzan, 4 Nov 2026 (staff usability rule 5): site survey forms take photos and measurements, work with no signal and send later, with no retyping; the survey goes to the Project Director (the COO, the Operations General Manager or the Operations Director, Fauzan 5 Nov 2026), who accepts or returns it with a reason and never decides their own survey. At least 1 and at most 12 photos (none only with a written reason where photography is not allowed, e.g. a protected place under the Protected Areas and Protected Places Act 1959 or a client rule), 20 posts and 20 extra measurements; how long survey photos are kept is for the PDPA officer to set; a survey not sent stays on the phone and reminds the surveyor after 30 days. Values proposed.',
  ),
  pdpaBreachRegister: rule(
    'PDPA-BREACH-REGISTER',
    { keepYears: 2 },
    'Secondary',
    'PDP Commissioner Data Breach Notification Guideline (2025): a data controller keeps a register of every personal data breach, notified or not, for at least 2 years, with what happened, the data and people affected, and the action taken. Closed breach entries stay on the register and cannot be removed before then. Fauzan, 5 Nov 2026: confirmed; the PDPA officer or the Chief of Staff may set a longer period in PDPA settings, never under 2 years.',
  ),
  pdpaRegisterReview: rule(
    'PDPA-REGISTER-REVIEW',
    { reviewDays: 365, sensitiveNeedsDpia: true },
    'Policy',
    'Fauzan, 5 Nov 2026: approved. The PDPA officer, with the CEO or the Chief of Staff, reviews every entry of the personal data register at least once a year. Sensitive data (health, face or other biometric data) needs explicit consent or another s.40 ground and a data protection impact assessment before use. For approval with the PDPA officer and the Operations Director.',
  ),
  lindungVerifyDays: rule(
    'HR-LINDUNG-VERIFY',
    2,
    'Policy',
    'LINDUNG 24 Jam (5 Nov 2026): PERKESO emails the company to confirm the worker is employed; HR answers within 2 working days so the benefit is not held up. Company target, not law; PERKESO sets no deadline in its FAQ. Proposed, for approval. Approved by Fauzan, 11 Nov 2026 (round 3, G14).',
  ),
  doshFormWorkingDays: rule(
    'OSH-DOSH-NOTICE',
    7,
    'Law',
    'OSHA 1994 s.32 and NADOPOD Regulations 2004: death, serious bodily injury and dangerous occurrences are told to the nearest DOSH office at once by the quickest means, then JKKP 6 within 7 working days; injury keeping a worker off more than 4 calendar days, JKKP 6 within 7 working days; occupational poisoning or disease, JKKP 7. Every case goes in the JKKP 8 register, sent to DOSH before 31 January and kept 5 years (DOSH NADOPOD guidelines). Check the current DOSH submission channel.',
  ),
  opsMeeting: rule(
    'OPS-MEETING',
    {
      /** Sections of operations the COO meets every month. `tiers` and `department` find the section head(s) to invite. */
      sections: [
        { key: 'gov', label: 'Government operations', department: 'operations', tiers: ['ogm'] },
        { key: 'private', label: 'Private operations', department: 'operations', tiers: ['ops_director'] },
        { key: 'cms', label: 'CMS command centre', department: 'cms', tiers: [] },
        { key: 'arms', label: 'Arms Control', department: 'arms_control', tiers: [] },
        { key: 'transport', label: 'Transport', department: 'transport', tiers: [] },
      ] as { key: string; label: string; department: string; tiers: string[] }[],
      /** After this day of the month a section with no meeting set is shown red. */
      scheduleByDay: 10,
      /** Minutes are due this many days after the meeting; after that the organiser and the COO are reminded. */
      minutesWithinDays: 3,
      agenda: [
        'Action items from last month',
        'Attendance, absence and incident figures',
        'Open cases and client complaints',
        'Staffing, equipment and vehicles',
        'Issues the section needs the COO to decide',
        'Plan for next month',
        'Any other matters',
      ],
    },
    'Policy',
    "Fauzan, 26 Oct 2026: \"All operation will be monitor by coo. Its do montly operation meeting with each section in the company who under perview of operation.\" Fauzan, 5 Nov 2026: the five central sections below plus the existing monthly meeting with each company's operations. The 10th-of-month scheduling cut-off, the 3-day minutes window and the standing agenda are proposed for Fauzan to confirm (5 Nov 2026).",
  ),
  meetingPlan: rule(
    'MTG-PLAN',
    {
      /**
       * The regular meetings each kind of staff needs, thought through role by role and confirmed by Fauzan on 5 Nov 2026.
       * `every` is the period; `dueDay` is how many days into the period it should be set before it shows late (proposed).
       * The agenda is the standing list; Prima puts what is important now (open actions, open serious cases, licences and
       * tenders due) in front of it automatically.
       */
      series: [
        {
          key: 'grp-mgmt',
          label: 'Group management meeting',
          every: 'fortnight',
          dueDay: 3,
          kind: 'management',
          who: 'Director Office sets it; CEO, COO, Chief of Staff, Deputy, Finance Director and the Director Office attend',
          agenda: ['Action items from the last meeting', 'Tenders and quotations closing', 'Collections and overdue clients', 'Escalated cases and risks', 'Decisions needed'],
        },
        {
          key: 'grp-general',
          label: 'Monthly general meeting',
          every: 'month',
          // Part Y (14 Nov 2026): the meeting for month N is held about the 9th-18th of month N+1.
          dueDay: 18,
          kind: 'management',
          who: 'Director Office sets it; all company managers, all department heads and Finance team leaders attend, with the Director Office, Chairman and Vice Chairman',
          // Part Y Y1: each company reports on the 14-item template (GROUP-MONTHLY) and each unit on its department pack.
          agenda: ['Action items from the last meeting', 'Who has sent and who has not (Mesyuarat bulanan JA Group)', 'Each company: the 14-item monthly report', 'Each unit: department pack and unit sections', 'Internal Audit: accounts report tracker and findings', 'Announcements and decisions'],
        },
        {
          key: 'grp-board-review',
          label: "Chairman's quarterly review",
          every: 'quarter',
          dueDay: 30,
          kind: 'board',
          who: 'Director Office sets it; Chairman, Vice Chairman, CEO, COO, Finance Director and Chief of Staff attend',
          agenda: ['Minutes and actions of the last review', 'Group results and cash', 'Operations, licences and compliance', 'Legal matters and risks', 'Plans for next quarter'],
        },
        {
          key: 'dept-toolbox',
          label: 'Mesyuarat Toolbox Jabatan',
          every: 'fortnight',
          dueDay: 3,
          kind: 'toolbox',
          who: 'The head of each central department sets it; the whole department attends',
          agenda: ['1 Kehadiran dan perkara terbuka', '2 Kakitangan', '3 Kerja dan KPI', '4 Kewangan', '5 Pematuhan dan risiko', '6 Aset dan sistem', '7 Rancangan 2 minggu', '8 Keputusan dan hal lain'],
        },
        {
          key: 'fin-close',
          label: 'Finance month-end close meeting',
          every: 'month',
          dueDay: 5,
          kind: 'department',
          who: 'The Finance Director sets it; team leaders and deputies attend',
          agenda: ['Bank reconciliations', 'Receivables and collections', 'Payables and payments due', 'Statutory payments (EPF, SOCSO, EIS, PCB, HRD)', 'Close checklist and packs'],
        },
        {
          key: 'co-office',
          label: 'Mesyuarat Toolbox Syarikat',
          every: 'fortnight',
          dueDay: 3,
          kind: 'toolbox',
          who: 'The company manager sets it; the admin executives attend',
          agenda: ['a) Kehadiran', 'b) Lesen KDN, cawangan negeri dan lesen PBT', 'c) Kontrak semasa', 'd) Bil dan bayaran pelanggan', 'e) Tuntutan PGM', 'f) Caruman berkanun dan cukai', 'g) Tugasan pentadbiran HQ', 'h) Kursus CSG dan TNG', 'i) Tender dan pendaftaran vendor', 'j) Penama MOF', 'k) Senjata api', 'l) Pengurus zon / JV', 'm) Kuota dan pekerja Nepal', 'n) Bil syarikat, pinjaman, sewa, audit, ISO', 'SULIT', 'o) Hal-hal lain'],
        },
        {
          key: 'co-ops',
          label: 'Company operations meeting with the COO',
          every: 'bimonth',
          dueDay: 15,
          kind: 'operations',
          who: 'The company manager sets it; admin executives and the COO attend',
          agenda: ['Action items from the last meeting', 'Attendance, no-shows and incidents', 'Client complaints and requests', 'Staffing and equipment', 'Plan for the next two months'],
        },
        {
          key: 'co-board',
          label: 'Company board meeting',
          every: 'year',
          dueDay: 180,
          kind: 'board',
          who: 'The company manager sets it with the company secretary; directors attend (add them as guests if they have no Prima account)',
          agenda: ['Confirm the last minutes', 'Management accounts', 'Licence, KDN and compliance matters', 'Contracts and tenders above the board limit', 'Resolutions'],
        },
      ] as { key: string; label: string; every: 'fortnight' | 'month' | 'bimonth' | 'quarter' | 'year'; dueDay: number; kind: 'board' | 'management' | 'operations' | 'department' | 'toolbox'; who: string; agenda: string[] }[],
    },
    'Policy',
    'Fauzan, 5 Nov 2026: "Set for every one meetings and memo also. Be like every staff than think what meeting needed." Fauzan confirmed the list the same day: group management, department toolbox and company office meetings every two weeks; the COO joins each company operations meeting every two months; company board once a year; a monthly general meeting with all company managers, department heads and Finance team leaders; the agenda is set automatically from what is important and lateness is still flagged. The set-by days are proposed. The COO monthly section meetings stay under OPS-MEETING.',
  ),
  memoRead: rule(
    'MEMO-READ',
    { readWithinDays: 3 },
    'Policy',
    'Fauzan, 26 Oct 2026: readers tap "I have read this" and the publisher sees who read it. The 3-day read-by date and the publisher reminder to those who have not read are proposed (5 Nov 2026). Approved by Fauzan, 11 Nov 2026 (round 3, G14).',
  ),
  quality: rule(
    'QMS-REGISTER',
    {
      /** Standards kept in one register, each with its own edition. PIKM Parts 1 and 2 received from Fauzan, 8 Nov 2026 (2022 drafts); each row keeps its own part and edition. */
      standards: [
        { code: 'ISO9001', edition: '2015', name: 'ISO 9001:2015 Quality management systems', text: 'headings' },
        { code: 'PIKM', edition: '1:2022 draft', name: 'PIKM-KDN/SIRIM Code of practice for private security agencies, Part 1: management and Part 2: security screening', text: 'headings' },
      ],
      /** Each requirement with checked evidence is looked at again this often (approved by Fauzan, 8 Nov 2026). */
      reviewEveryMonths: 12,
      /** Credentials or refreshers expiring within this many days show as "due soon". */
      dueSoonDays: 60,
      /** Default refresher when a skill item has none set (approved by Fauzan, 8 Nov 2026). */
      defaultRefreshMonths: 12,
    },
    'Policy',
    "Fauzan, 5 Nov 2026: extend the existing Prima modules into one connected quality and compliance system for the SIRIM/PIKM code and ISO 9001:2015, not a separate app. One requirements and evidence register for both standards, each standard and edition kept separate. ACT keeps the list, links existing approved records and checks the evidence; a person who links evidence never checks it. The app never declares a company compliant: missing evidence shows Unknown. Gaps go to an ACT finding (the existing corrective-action steps), not a second CAPA system. Competency matrix per role in HR: credentials are read from the existing records; skills are assessed by a manager or officer, never by the person themselves. Staff never see or fill in clause checklists. Fauzan, 8 Nov 2026 approved as built: 12-month evidence review, 60-day due-soon, refreshers every 12 months for guards and officers and 24 months for office Prima and PDPA training, the four starter role profiles, the screening check lists, repeat screening every 36 months (staff and guards) and 12 months (directors and shareholders), and OM or company manager recording code-of-conduct briefings.",
  ),
  fwRecharge: rule(
    'FW-RECHARGE',
    {
      /** The user company or branch repays within this many days of the debit note. Proposal, for approval. */
      repayDays: 30,
      /** A paid figure more than this many ringgit from the published rate needs a note from Finance. */
      checkToleranceRm: 1,
    },
    'Policy',
    'Fauzan, 5 Nov 2026: "Make sure EPF and SOCSO for Nepali are paid by the owner company and repaid back by the company that used it; if the branch manager used it, it needs to pay the amount of EPF and SOCSO to the owner company. Salary can be paid by the company that uses or the branch that uses." The owner company holds the permit, stays the employer and pays KWSP and PERKESO by the 15th of the next month whether or not it has been repaid. The user repays employer and employee shares (the salary payer deducts the employee share from the wage) and LINDUNG 24 Jam, split by the days it used the worker in the month. Split by days worked decided by Fauzan, 5 Nov 2026. The 30 days to repay and the RM1 check are proposals for approval.',
  ),
  amExtras: rule(
    'AM-EXTRAS',
    {
      /** A contractor's CIDB registration is flagged this many days before it ends. */
      cidbWarnDays: 30,
      /** A contractor averaging below this rating over at least minRatings jobs is flagged for review. */
      lowRating: 3,
      minRatings: 2,
      /** An empty unit is advertised within this many days of becoming vacant. */
      advertWithinDays: 7,
      /** An open enquiry gets a next step at least this often. */
      enquiryFollowUpDays: 3,
      /** A unit is put up for letting from this many days before its tenancy ends. */
      letBeforeEndDays: 90,
      /** Each meter is read at least this often. */
      meterReadDays: 31,
      /** A reading using more than this times the usual is flagged (possible leak or fault). */
      meterSpikeX: 2,
      /** A resort hold without a deposit lapses after this many days. */
      holdDays: 3,
      /** Deposit needed to confirm an outside booking, % of the stay. */
      depositPct: 30,
      /** A resort's MOTAC registration is flagged this many days before it ends. */
      motacWarnDays: 60,
      /** A harvest sale this % or more below the crop's recent average price is flagged. */
      priceDropPct: 20,
      /** Days of sales the recent average price looks back over. */
      priceLookbackDays: 30,
      /** Spoiled over this % of a pick is flagged. */
      spoilPct: 10,
      /** Kept or given away over this % of a pick is flagged. */
      keptPct: 5,
      /** A planned job becomes a work order this many days before it is due. */
      pmLeadDays: 14,
    },
    'Policy',
    'Fauzan, 26 Oct 2026: Asset Management finds tenants, monitors utilities and runs the resorts and orchards. Fauzan, 5 Nov 2026 (third audit, item 4 "Build"): add the contractors list, finding tenants, utility meters, resort bookings, orchard harvest and planned maintenance. Proposed for approval: the team adds a contractor and the Asset Director approves it for use, suspends or blacklists it with a reason; every finished job is rated; the Asset Director approves every tenancy offer, by someone other than whoever made it, and an offer under the asking rent needs a reason; each meter is read monthly with a photo and a big jump is flagged; the Asset Director sets each resort\'s price list, a price under it needs a reason, an outside booking is confirmed with a 30% deposit and a hold lapses after 3 days; every harvest sale has a weighing slip, and a price drop of 20%, spoilage over 10% or more than 5% kept or given away is flagged; planned jobs turn into work orders 14 days before they are due and only the Asset Director pauses a job the law or a licence requires. Finance confirms every payment in the bank. All figures proposed, for Fauzan to confirm.',
  ),
  jaSwitch: rule(
    'JA-SWITCH',
    {
      sideBySideDays: 30,
      jaReadOnlyDays: 92,
      hoursTolerance: 0.25,
      payToleranceRm: 0,
      incidentMatchMin: 60,
      startBackDays: 62,
      startAheadDays: 31,
      importMaxRows: 2000,
      reportRows: 500,
    },
    'Policy',
    "Fauzan, 5 Nov 2026 (third audit item 3, plan 'How we switch safely'): Prima and JA run the same month side by side for one company and one area; a difference report lists every mismatch and each is explained or fixed; ACT checks the report (proposed: ACT Lead or Deputy, never someone who explained a difference in it); the CEO switches the area, and a switch can be undone; JA stays read-only for 3 months after. Fauzan, 5 Nov 2026: 'Every formula can set by act director': the ACT Director sets these numbers in the app (a run keeps the values it started with). Starting values: 30 days side by side, pay to the sen, attendance hours may differ by 15 minutes, incidents match by site within 60 minutes, JA read-only 92 days. Recommended order: incidents, attendance and patrol, guard pay, then hostels; foreign worker papers live in both apps and never switch. JA history comes by a one-time import of JA exports, staged by ACT and approved by another person (ACT Lead or Deputy); the import never creates people and refuses full IC numbers.",
  ),
  guardPhone: rule<{
    heartbeatSec: number;
    offlineAfterMin: number;
    pingEverySec: number;
    codeValidHours: number;
    sessionHours: number;
    maxFailedTries: number;
    lockMin: number;
    dutyMarginMin: number;
    sosRepeatMin: number;
    keepPingsDays: number;
  }>(
    'OPS-GUARD-PHONE',
    {
      heartbeatSec: 60,
      offlineAfterMin: 5,
      pingEverySec: 60,
      codeValidHours: 24,
      sessionHours: 14,
      maxFailedTries: 5,
      lockMin: 30,
      dutyMarginMin: 30,
      sosRepeatMin: 10,
      keepPingsDays: 90,
    },
    'Policy',
    'Third audit item 2, Fauzan 5 Nov 2026: guards sign in on their own phones with face plus PIN, live patrol location, SOS button and a heartbeat to CMS. Heartbeat every 60 s and offline after 5 min follow the JA requirements (2 Nov 2026). Location only on duty (30 min either side of the shift); Fauzan, 5 Nov 2026: no PDPA notice step on the phone. Keeping readings 90 days and the code, session, lock and SOS numbers are PROPOSED. Approved by Fauzan, 11 Nov 2026 (round 3, G16).',
  ),
  qualityOps: rule(
    'QMS-OPERATIONS',
    {
      /** A service fault at a site that had another within this many days is a repeat and goes to ACT for the root cause (approved by Fauzan, 5 Nov 2026). */
      repeatDays: 90,
      /** Each supplier is rated again this often (approved by Fauzan, 5 Nov 2026). */
      supplierRateEveryDays: 365,
    },
    'Policy',
    "Fauzan, 5 Nov 2026 (\"Build any not build\"): the day-to-day quality pieces on existing records. Service faults are recorded once by the company or Operations, with what was done at once and whether the client was told; serious faults and repeats at the same site go to ACT for the root cause as an ACT finding. Procurement or the company manager rates suppliers on quality, time and paperwork; Stop blocks the supplier and only Finance unblocks. ACT or the Chief of Staff keeps the quality objectives and controlled documents; a document version is approved by a second person, never its writer. Management review: Prima builds the inputs from its own figures and the CEO agrees the record. Guards and officers see none of it. Fauzan, 5 Nov 2026 said yes to the 90-day repeat window, the 12-month supplier re-rating and the 24-month default document review.",
  ),
  fwmRecruitSteps: rule(
    'FWM-RECRUIT-STEPS',
    ['AGENCY_LICENCE', 'EMBASSY', 'INTERVIEW', 'AGE', 'CONTRACT'],
    'Policy',
    'Fauzan, 6 Nov 2026 (IWAY answer 7, "done in FWM"): FWM records each foreign worker\'s recruitment steps: the agency\'s licence, the embassy\'s confirmation, the interview, the age check from the passport, and the contract signed in English and Malay before travel. A worker is cleared to travel only when all five are on record; zero recruitment fees is confirmed after arrival by the arrival fee check (FWM-ZERO-FEE).',
  ),
  fwmRecruitAge: rule(
    'FWM-RECRUIT-AGE',
    { min: 18, max: 60 },
    'Policy',
    'Fauzan, 6 Nov 2026: a recruited worker is 18 to 60, taken from the date of birth on the passport and counted to the planned travel date (HR-AGE-MAX: no guards over 60).',
  ),
  fwmContractLanguages: rule(
    'FWM-CONTRACT-LANG',
    ['en', 'ms'],
    'Policy',
    'Fauzan, 6 Nov 2026: English and Malay are a must; the worker\'s mother tongue may be added. The contract is signed before the worker travels.',
  ),
  fwmMove: rule(
    'FWM-MOVE',
    { noticeWorkingDays: 3, steps: ['originPic', 'newPic', 'fwm', 'hq', 'ketua'], closeRemindHours: 24 },
    'Policy',
    'Fauzan, 13-14 Nov 2026 (Fitri package Part P, FWM papers S1-S7): a foreign worker hostel or site move is raised at least 3 working days ahead (urgent needs a reason), signed in five steps (both PICs, FWM, the new company head, then the Operations Director or OGM) with nobody signing two steps, and FWM closes it with the JA reference. The days and hours are FWM settings in the app.',
  ),
  fwmHostelNeed: rule(
    'FWM-HOSTEL-NEED',
    { verifiedBy: 'fwm', approvedBy: ['ops_director', 'ogm'], onePurchasePerNeed: true },
    'Policy',
    'Fauzan, 13-14 Nov 2026 (Fitri package Part P, FWM papers T1-T3): the OM raises a hostel need showing the residents and the items already there, FWM verifies, the Operations Director or OGM approves with a reason (never the raiser), and Asset Management buys once against the approved need; the OM confirms receipt with a photo and the hostel list updates.',
  ),
  shortStays: rule(
    'AM-SHORT-STAY',
    { staffRate: 300, staffRateBasis: 'PER_PERSON_NIGHT', depositPct: 50, freeCancelDays: 7, lateCancelKeepPct: 50, fullPayDaysBefore: 3, airbnbAnswerHours: 20, payoutWorkingDays: 5, claimDeadlineDays: 14, goodwillCapRm: 300 },
    'Policy',
    'Fauzan, 14 Nov 2026 03:12Z answers 30-35 and 37-51, 03:26Z SOP-1..4 (Fitri package Part P19-P39; papers PRWM-UPA 2026/015, 017, 018): staff houses are the homestay houses, one calendar per house for direct, Airbnb and staff stays; staff stays RM300 a person a night billed to the department; staff damage recovered automatically once the staff member acknowledges it with written consent; direct guests pay a 50% deposit and full payment 3 days before check-in, Finance alone confirms money and issues receipts; Airbnb guests pay only through Airbnb, Finance matches payouts; complaints, cleaning and inventory follow the three draft SOPs. Every number is an Asset Director setting in the app.',
  )
} as const;

export const CREDENTIAL_LABEL: Record<CredentialType, string> = {
  KDN_GUARD_CARD: 'KDN guard card',
  KDN_VETTING: 'KDN vetting submitted (eSIMS)',
  CSG_TRAINING: 'CSG basic training',
  TNG_TRAINING: 'TNG supervisor training',
  PLKS_PERMIT: 'PLKS work permit',
  PASSPORT: 'Passport',
  FOMEMA: 'FOMEMA medical',
  FW_INSURANCE: 'Foreign worker insurance',
  SPIKPA: 'SPIKPA hospital insurance',
  KDN_LETTER: 'KDN approval letter',
  FIREARM_PERMIT: 'Firearm permit',
  RANGE_PRACTICE: 'Range practice',
  MEDICAL_CHECK: 'Yearly medical (56 and over)',
  SITE_BRIEFING: 'Site risk briefing',
};

export const LICENCE_LABEL: Record<LicenceType, string> = {
  KDN_LICENCE: 'KDN security licence',
  MOF_REGISTRATION: 'MOF registration',
  INSURANCE: 'Group insurance',
  SSM_ANNUAL_RETURN: 'SSM annual return',
  MAJLIS_PREMISE: 'Council premise licence',
  MAJLIS_SIGNBOARD: 'Council signboard licence',
  VENDOR_PANEL: 'Vendor registration',
  ISO_CERT: 'ISO certification',
  FIRE_CERT: 'Fire certificate',
  OFFICE_ALARM: 'Office alarm (installer and service)',
  OFFICE_CCTV: 'Office CCTV (installer and service)',
  PIKM_MEMBERSHIP: 'PIKM membership',
  MOF_DIGITAL_CERT: 'MOF digital certificate',
  BUMIPUTERA_STATUS: 'Bumiputera status (MOF)',
  BOND: 'Performance bond or bank guarantee',
  CARRY_USE: 'Firearm Carry & Use permit',
  CNU: 'CNU (firearm use for a client)',
  AMRA: 'AMRA (arms custodian) approval',
  LHDN_TCC: 'LHDN tax clearance (TCC)',
  CIDB: 'CIDB registration',
  OTHER_COMPLIANCE: 'Other compliance',
};

/** Credentials every deployable guard must hold. */
export const REQUIRED_ALL: CredentialType[] = ['KDN_GUARD_CARD', 'CSG_TRAINING'];
/** Extra credentials for foreign workers. */
export const REQUIRED_FOREIGN: CredentialType[] = ['PLKS_PERMIT', 'PASSPORT', 'FOMEMA', 'FW_INSURANCE'];

export const INSURANCE_LABEL: Record<InsuranceKind, string> = {
  PUBLIC_LIABILITY: 'Public liability',
  PROFESSIONAL_INDEMNITY: 'Professional indemnity (Insurans Indemniti Profesional)',
  GROUP_PERSONAL_ACCIDENT: 'Group personal accident',
  GROUP_HOSPITALISATION: 'Group hospitalisation',
  FW_HOSPITALISATION: 'Foreign worker hospitalisation',
  FIDELITY_GUARANTEE: 'Fidelity guarantee',
  ARMED_SERVICE: 'Armed-service liability',
  CASH_IN_TRANSIT: 'Cash in transit',
  MOTOR_FLEET: 'Motor fleet',
  FIRE_OFFICE: 'Fire and office',
};

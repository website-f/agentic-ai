// Rule register. Every business number used by Wave 1 lives here with its source and
// label, so the app can show why it blocked or warned (master plan 6.6). In production
// these move to a versioned table with effective dates and approvers.

import type { CredentialType, GovArea, GrcStream, InsuranceKind, LicenceType, Severity } from './types';

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
  maxHoursPerDay: rule('OPS-HOURS-MAX', 12, 'Law', 'Employment Act 1955 s.60A: not more than 12 hours a day including overtime'),
  minRestHours: rule('OPS-REST-MIN', 8, 'Policy', 'Proposed minimum rest between shifts, for approval'),
  maxConsecutiveDays: rule('OPS-REST-DAY', 6, 'Law', 'Employment Act 1955 s.59: one rest day each week'),
  lateGraceMin: rule('OPS-LATE-GRACE', 15, 'Policy', 'Proposed clock-in grace period, for approval'),
  earlyLeaveGraceMin: rule('OPS-EARLY-GRACE', 15, 'Policy', 'Proposed clock-out grace period, for approval'),
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
    'Fauzan, 26 Oct 2026: reminders at 120, 90, 60, 30 and 15 days before a foreign-worker paper expires, 15 days is urgent; escalation FWM, then Chief of Staff, COO and CEO; the CEO is alerted 7 days before expiry. Per FW design v3, the Chief of Staff is alerted at 30 days and the COO at 15 days if the step is not yet submitted. A renewal submitted with its receipt pauses the ladder.',
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
    'SOCSO Claims SOP, rehabilitation section (26 Oct 2026): the officer checks in with an injured guard every week while off work and for the first month back. Proposed, for approval.',
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
  armsRfid: rule(
    'ARMS-RFID',
    { scanRequired: false },
    'Policy',
    'Fauzan, 27 Oct 2026: every firearm carries an RFID tag, scanned at the vault at every issue and return. A scanned tag that is not this firearm’s stops the issue or return. A firearm picked by hand (no tag yet, or the reader not working) is recorded as not scanned and shown to Arms Control, never as confirmed. Whether a scan should be compulsory once every firearm is tagged is a proposal.',
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
    'Unverified',
    'Proposed retention of location readings, to confirm with the PDPA notice to staff (location and face are personal data; face is biometric).',
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
    'Master plan W13 (V13/V14 arms design): firearm not back 15 minutes after due alerts, 30 minutes escalates, 2 hours opens a loss case. Proposed, for approval with Arms Control.',
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
    'Employment Act 1955 s.60E: paid annual leave of 8 days (under 2 years of service), 12 days (2 to 5 years) or 16 days (5 years or more), in proportion to completed months in the first year. s.60F: paid sick leave of 14, 18 or 22 days on a medical certificate, and up to 60 days a year in total with hospitalisation (sick leave counted inside the 60). The guard informs the employer within 48 hours. Emergency leave is taken from annual leave (company policy, proposed).',
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
    'Fauzan, 26 Oct 2026: hostel billing reminds the company that owns or rents the hostel to ask for payment approval, sent to FWM; the Operations Director (private) or OGM (government) approves, then the COO; FWM keeps the approvals and the payment slip. Reminder days 14, 7 and 3 before due, then daily, and the overdue ladder (Chief of Staff from day 1, COO from day 7, CEO from day 14) are proposed.',
  ),
  utilityAllowance: rule(
    'FWM-UTILITY',
    { electricity: 30, water: 20, noticesBeforeDeduction: 2, maxDeductionShareOfBasic: 0.5 },
    'Policy',
    'Fauzan, 26 Oct 2026: the system works out each hostel electricity and water bill above RM30 (electricity) and RM20 (water) per person a month, pro-rated by bed-days, and HR decides per person: a notice or a deduction. The 1st and 2nd time are notices only; from the 3rd a deduction may be chosen, only when the contract of employment has the utility clause. The count never resets. Legal item L4: Practice (JTK verbal, Fauzan 26 Oct 2026); JTK written confirmation not on file yet. Total deductions in a month kept within 50% of wages (Employment Act s.24(8), check proposed).',
  ),
  fleetReminders: rule(
    'FLEET-REMIND',
    { renewalDays: 30, serviceDays: 14, serviceKm: 500, paymentDays: 7, deviceSilentMinutes: 30 },
    'Policy',
    'Fauzan, 26 Oct 2026: the Transport head is reminded of everything about each vehicle: renewals (road tax, insurance, PUSPAKOM, permits), servicing and payments. Proposed: renewals from 30 days before, servicing 14 days or 500 km before, payments 7 days before; a tracker or dashcam silent over 30 minutes shows as unknown to CMS.',
  ),
  clientCare: rule(
    'OPS-CLIENT-CARE',
    { visitEveryDays: 30, reportByDay: 7, invoiceByDay: 10, lowScore: 2, ratingEveryDays: 90, contractWarnDays: 60, billingOverdueDays: 30 },
    'Policy',
    "Fauzan, 26 Oct 2026: the COO monitors client relations, onboarding and offboarding, maintenance, reports done or not, satisfaction, documents and billing; each company manager monitors their own; Operations Managers, the Operations Director and officers act. Proposed: a visit or meeting every 30 days, the monthly report by the 7th, a satisfaction rating every 90 days (2 or less is low), contract renewal from 60 days, billing overdue over 30 days. Fauzan, 26 Oct 2026: each month's client invoice is recorded with proof of sending within 10 days after the month ends.",
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
    'Fauzan, 26 Oct 2026: Asset Management runs 450 rental units, every non-electronic asset, 2 resorts, 6 orchards and a training facility; the Chairman and Vice Chairman monitor it, the CEO oversees, the Finance Director manages its finances. Only group leadership and the finance staff who oversee it see its data. Proposed watch points: arrears at 30, 60 and 90 days; agreements from 90 days before they end; insurance, assessment and quit rent from 30 days; units vacant over 60 days; every asset checked once a year. Fauzan, 27 Oct 2026: the rental team records rent paid (cash, transfer, cheque, online) and follows up unpaid rent; cash needs a receipt number and Finance confirms it is banked (proposed within 2 days); a reminder letter or notice of demand needs the Asset Director’s approval; a payment is reversed only with a reason, never deleted, and not after Finance has banked it. Fauzan, 27 Oct 2026: every unit with rent unpaid is followed up and its status updated at least every 10 days until it is paid, by call, WhatsApp, email or visit; a late update alerts the Asset Director; the reminder is written in Malay with English below.',
  ),
  act: rule(
    'ACT-PLAN',
    {
      dueDays: { high: 14, medium: 30, low: 60 },
      /** Days overdue before each level sees it: Chief of Staff, then COO, then CEO. */
      escalateDays: [1, 14, 30],
      areas: [
        { id: 'ATTENDANCE', name: 'Guard attendance and clocking', months: 6 },
        { id: 'PATROL', name: 'Patrols, incidents and cases', months: 6 },
        { id: 'ROSTER', name: 'Rostering and replacements', months: 6 },
        { id: 'LICENSING', name: 'Guard licensing, KDN vetting and CSG', months: 6 },
        { id: 'FWM', name: 'Foreign workers', months: 6 },
        { id: 'PAYROLL', name: 'Payroll and statutory contributions', months: 6 },
        { id: 'CLAIMS', name: 'Staff claims and leave', months: 12 },
        { id: 'BILLING', name: 'Contracts, billing and invoices', months: 6 },
        { id: 'TENDERS', name: 'Tenders, quotations and leads', months: 12 },
        { id: 'PURCHASING', name: 'Purchasing, suppliers and stock', months: 6 },
        { id: 'ARMS', name: 'Arms, vaults and armed jobs', months: 6 },
        { id: 'CORPORATE', name: 'Company secretary, audit and legal', months: 12 },
        { id: 'CREDIT', name: 'PWVSB credit and branches', months: 12 },
        { id: 'PDPA', name: 'Personal data (PDPA)', months: 12 },
        { id: 'IT', name: 'IT, backups and continuity', months: 12 },
        { id: 'ASSETS', name: 'Asset Management and fixed assets', months: 12 },
      ],
    },
    'Policy',
    'Fauzan, 27 Oct 2026: ACT (Audit, Compliance and Transformation) monitors all compliance, audits every workflow, checks all discrepancies, finds solutions and leads the improvement. Confirmed by Fauzan 27 Oct 2026: fix within 14/30/60 days by severity; overdue findings shown to the Chief of Staff, then the COO after 14 days and the CEO after 30; high-risk workflows audited every 6 months, the rest yearly; a high finding is closed only by the ACT Lead or Deputy; improvements approved by the COO or CEO. Nothing is automatic discipline.',
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
        other: [],
      } as Record<'board' | 'management' | 'operations' | 'department' | 'client' | 'other', string[]>,
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
    'Lives and limits confirmed by Fauzan 27 Oct 2026; the auditors still confirm the method. Straight line over the useful life with no residual value, starting the month after purchase (MFRS 116 / MPERS section 17 allow it; the auditors confirm the lives). Prima prepares the monthly journal per owner entity; Finance posts it in SQL Account and records the reference here. Disposals: the Finance Director approves a net book value up to RM10,000, the COO above that. Confirmed by Fauzan 27 Oct 2026, adding: an asset fully written off that can still be used is kept in use or refurbished, and reviewed again every 12 months; it is disposed only when it cannot be used or refurbished, and an asset in good condition cannot be put up for disposal once written off. Whether a refurbishment cost is added to the asset or expensed is for Finance and the auditors. Capital allowances for tax (Income Tax Act 1967 Schedule 3) are for the tax agent.',
  ),
  staffPayroll: rule(
    'PAY-STAFF',
    {
      payByDay: 7,
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
      },
    },
    'Law',
    "Fauzan, 27 Oct 2026: guard and officer pay comes from the JA Group app; Prima builds payroll for staff. HR prepares, the Chief of Staff approves, the Vice Chairman consents (decided 26 Oct 2026), then Finance pays through the bank's payroll service and posts to SQL Account. Employment Act 1955 s.19: wages within 7 days after the month; s.60I: a monthly-paid employee's daily rate is the monthly pay divided by 26. EPF Third Schedule, SOCSO and EIS tables, HRD levy 1%, PCB from LHDN's e-PCB. Prima drafts files only and never files or pays.",
  ),
  it: rule(
    'IT-WATCH',
    { serviceMonths: 6, domainWarnDays: 60, sslWarnDays: 21, checkStaleHours: 24, slaHours: { P1: 4, P2: 24, P3: 72 }, warrantyWarnDays: 60, checkMonths: 6 },
    'Policy',
    'Fauzan, 27 Oct 2026: the IT department (IT Manager, IT Lead, 4 IT Executives) runs the full lifecycle of every IT and electronic asset (buying, maintenance, repair, disposal), monitored by the COO and overseen by the CEO; it monitors the domains and websites, prepares the IT part of tenders, troubleshoots, teaches Microsoft 365 and onboards new staff. Proposed: domains renewed 60 days before expiry, certificates 21 days; a site not checked in 24 hours is unknown; help requests answered within 4, 24 or 72 hours by priority; every asset health/condition inspected every six calendar months (Fauzan, 1 Nov 2026); unknown inspection history requires an initial check, and generic inventory/service checks do not satisfy this; a disposal needs the IT Manager; the IT Manager agrees each purchase need (the COO when the IT Manager asks) and Procurement buys it; CCTV, network and printers serviced every 6 months.',
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
    'Fauzan, 27 and 28 Oct 2026: every IT and electronic purchase follows the group buying rule: three supplier quotes and an online or marketplace price check, all with documents; the chosen quote more than 5% above the online price needs a reason (10% proposed, cut to 5% by Fauzan on 28 Oct); the COO and then the CEO approve before anything is bought; approvals are given in Microsoft Teams (Approvals) or in Prima; the approval then goes to Finance, who pay. IT receives and tags the goods against the delivery order. During the pilot IT runs these steps itself because Procurement and Finance are not on the system yet.',
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
    { cooAfterDays: 3, ceoAfterDays: 7, confirmDays: 3, accessReviewDays: 90, ticketCooAfterHours: 24 },
    'Policy',
    'Fauzan, 28 Oct 2026, making IT the pilot: the IT Manager is an administrator who makes sure the team does the job, not a technical post; the IT Lead holds the technical know-how; the CEO is the owner and master administrator of every system, domain and account, and IT staff only operate them. Approved by Fauzan on 28 Oct 2026 (D1 to D5): every job has a named doer and a due date and is submitted with proof; a technical job is checked by the IT Lead before the IT Manager accepts it; nobody accepts their own work; a job late 3 days goes to the COO and 7 days to the CEO; a help request past its time limit by 24 hours goes to the COO; the person who asked confirms the fix within 3 days or it counts as confirmed; the CEO alone grants or removes access and reviews each access list every 90 days; while the IT Manager is away the COO accepts finished work; the IT Manager is not given technical jobs but runs the IT tenders: finds them, deals with the companies holding IT codes and gives each part to an IT Executive.',
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
      warnDays: 60,
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
        { matter: 'Staff salaries and the staff payroll run', approves: 'Chief of Staff approves, Vice Chairman consents', source: 'Fauzan, 26-27 Oct 2026' },
        { matter: 'Office supplies, utilities and rent', approves: 'Company manager asks, Chief of Staff approves, COO final', source: 'Fauzan, 26 Oct 2026' },
        { matter: 'IT and electronic purchases', approves: 'IT Manager, then COO', source: 'Assumption, to confirm' },
        {
          matter: 'Operational and cleaning equipment purchases',
          approves: 'Procurement gets 3 quotes and the online price, then the COO, then the CEO',
          source: 'Fauzan, 27 Oct 2026 (PUR-DOA)',
        },
        { matter: 'Guard and officer leave', approves: 'Operations Manager or above', source: 'Fauzan, 25 Oct 2026' },
        { matter: 'Staff leave', approves: 'HR or above', source: 'Fauzan, 25 Oct 2026' },
        { matter: 'Memos to all staff / all guards', approves: 'Chief of Staff / COO', source: 'Fauzan, 26 Oct 2026' },
        { matter: 'Tender submission', approves: 'Preparer signs, then the company manager', source: 'Fauzan, 26 Oct 2026' },
        {
          matter: 'Corporate changes (directors, shares, bank signatories)',
          approves: 'Chief of Staff or Deputy for PWVSB, then the company board',
          source: 'Fauzan, 24 Oct 2026',
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
    'V6 amendment (24 Oct 2026) and the consolidated plan: a signed contract or letter of award opens mobilisation against 11 workstreams due from 10 days before to 30 days after the start. Critical items block go-live and cannot be risk-accepted; others may be risk-accepted by the company manager for up to 30 days (proposed, decision M-1). Go-live needs the Site Ready-to-Operate Certificate, then reviews at day 1, 7, 14 and 30; day 30 checks the first invoice against the contract. Billing Method 1 is hours a day x 30.5 x posts, 2 is the contracted hours, 3 is hours a day x days in the month, or a fixed monthly fee; the method never changes without a signed variation (Fauzan, 23 Oct 2026). The company controls; PWVSB monitors.',
  ),
  finance: rule(
    'FIN-WATCH',
    { staleHours: 48, reconcileByDay: 10, closeByDay: 15, packWarnDays: 30 },
    'Policy',
    "Fauzan, 27 Oct 2026: Finance (the Finance Director and 7 teams of a team leader, a deputy and 2 data entry executives) keeps every company's books in SQL Account, which stays; Prima makes sure it is used fully. Proposed checks: figures from SQL Account not older than 48 hours (else Unknown); every bank account reconciled in SQL Account to last month end by the 10th; last month closed by the 15th; what Prima billed and paid is posted; integrity tests FS-01, FS-02 and FS-06 at exactly RM0.00 (V6). Tax: Form C within 7 months of the year end, Form E by 31 March, EA forms to staff by the end of February, CP204 instalments by the 15th of each month (Income Tax Act 1967). Data entry prepares, the team leader or deputy reviews, the team leader or Finance Director sends.",
  ),
  jaGroupApp: rule(
    'SYS-JA-OWNS',
    {
      owns: [] as JaArea[],
      planned: ['payroll', 'fwm', 'incidents', 'hostels'] as JaArea[],
      staleHours: 24,
      payrollByDay: 7,
      papersWarnDays: 30,
      papersCeoDays: 7,
    },
    'Policy',
    "Fauzan, 26 Oct 2026: guard-to-officer payroll, foreign worker management and incidents are in the JA Group app, which is already built; the JA app sends its data to Prima by API. Fauzan, 27 Oct 2026: Prima's own screens stay on until that API is live; each area moves from planned to owns only when its feed is live, and Prima's version is then switched off (not deleted). Foreign worker hostels also run in the JA app (Fauzan, 27 Oct 2026). A feed silent for over 24 hours shows as unknown. Employment Act 1955 s.19: wages are paid within 7 days after the wage period, so last month's payroll not marked paid by the 7th is flagged. Papers: the JA app runs the renewals; Prima watches anything due within 30 days and puts 7 days or less in front of the CEO.",
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
    "V15 (24 Oct 2026) continuity workstream and Fauzan, 24 Oct 2026: all data in Malaysia, with a cloud copy, Fauzan's own server and an emergency server. Proposed targets: live operations (Prima, CMS) back within 4 hours losing at most 1 hour of data; finance (SQL Account) within 24 hours losing at most 24 hours. Restore test every 6 months and a playbook drill every year; a copy with no backup or restore test on record is unknown. Targets are proposals for Fauzan and IT to confirm.",
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
    'Fauzan, 25 Oct 2026: a request from a guard or officer is approved or rejected only by the Operations Manager or higher. If it gets no go-ahead or rejection within 12 hours (or 1 working day), it moves up a level: OM, Regional OM, head of operations, COO, CEO. 12 hours used; to confirm against "1 working day".',
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
    [
      { clause: '1.1', item: 'Panel clinic consultation', covered: 'Yes', note: 'At a company panel clinic, with the staff card' },
      { clause: '1.2', item: 'Medicine prescribed at the visit', covered: 'Yes', note: 'Only what the doctor prescribes for the illness on the MC' },
      { clause: '1.3', item: 'Medical certificate (MC)', covered: 'Yes', note: 'Upload it in the app within 48 hours (Employment Act s.60F)' },
      { clause: '1.4', item: 'Non-panel clinic', covered: 'Emergency only', note: 'With the receipt and the MC; HR decides' },
      {
        clause: '2.1',
        item: 'Hospital room and board, surgery',
        covered: 'Through insurance',
        note: 'Group hospitalisation (Malaysians) or SPIKPA (foreign workers), up to the policy limit',
      },
      { clause: '2.2', item: 'Work injury treatment', covered: 'Through SOCSO', note: 'Open a SOCSO claim from the staff profile' },
      { clause: '3.1', item: 'Supplements, vitamins, cosmetic or beauty treatment', covered: 'No', note: '' },
      { clause: '3.2', item: 'Dental and optical', covered: 'No', note: 'Unless the company adds them later' },
      { clause: '3.3', item: 'Pre-existing illness for a foreign worker before the FOMEMA pass', covered: 'No', note: 'Check the SPIKPA policy wording' },
    ],
    'Unverified',
    'Shahirah, 26 Oct 2026: a policy with clauses stating which items can be claimed. This is a draft for Group HR to confirm the limits, the panel clinics and the insurer wording before it is used.',
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
      steps: [
        { step: 'Verbal warning', when: 'First minor offence, such as being late or a uniform fault', by: 'OM (guards) or HR (staff)', keep: '6 months' },
        {
          step: 'Written warning',
          when: 'A repeat minor offence, or a first moderate one such as sleeping on duty or leaving the post',
          by: 'OM with HR',
          keep: '12 months',
        },
        { step: 'Final written warning', when: 'A further offence while a written warning is active', by: 'Company Manager with HR', keep: '12 months' },
        {
          step: 'Show-cause letter',
          when: 'A serious offence such as absence without leave for 2 days in a row, theft, fighting or a lost firearm',
          by: 'Company Manager with HR',
          keep: 'Permanent',
        },
        {
          step: 'Domestic inquiry',
          when: 'When the explanation is not accepted and dismissal or downgrade may follow',
          by: 'An independent panel set by the Company Manager',
          keep: 'Permanent',
        },
        {
          step: 'Outcome',
          when: 'Warning, suspension without wages up to 2 weeks, downgrade or dismissal (Employment Act s.14)',
          by: 'Company Manager, on the panel finding',
          keep: 'Permanent',
        },
      ],
      principles: [
        'Nothing is automatic: the app records and reminds; a person decides.',
        'The worker is told the charge in writing and may explain before any step above a verbal warning.',
        'Every step is recorded on the profile with the document and who decided it.',
        'Suspension during an inquiry is with at least half pay, for up to 2 weeks (Employment Act s.14(2)).',
      ],
    },
    'Unverified',
    'Shahirah, 26 Oct 2026: a clear disciplinary policy and governance. Draft based on the Employment Act 1955 s.14 and the Code of Conduct for Industrial Harmony, for Group HR and the company boards to approve; offence lists are examples.',
  ),
  patrolSpan: rule(
    'OPS-PATROL-SPAN',
    60,
    'Policy',
    'Fauzan, 25 Oct 2026: a patrolling officer commands at most 60 guards. Counted as the different guards rostered today at the sites on the patrol, across companies when the officer also patrols another company. Over the limit is shown to operations; the company changes the patrol areas.',
  ),
  evidenceGeo: rule(
    'EVID-GEO',
    { maxAccuracyM: 100, sentLaterMin: 10, clockAheadMin: 2, maxImageBytes: 700_000 },
    'Policy',
    'Fauzan, 25 Oct 2026: incident reports and site visits carry photos from the in-app camera with a built-in time stamp and geo-tag, to prove the event is true. No gallery uploads. A photo needs GPS; it is checked against the site geofence, GPS weaker than 100 m is flagged, and a photo sent more than 10 minutes after it was taken is marked as sent later. Values proposed.',
  ),
  disciplineHandbook: rule(
    'HR-HANDBOOK',
    { warningValidMonths: 12, showCauseReplyDays: 3, suspensionMaxDays: 14 },
    'Policy',
    'Fauzan, 25 Oct 2026: one disciplinary handbook for every guard in every company, and it must follow labour law. The ladder (verbal, written, final warning, show-cause, domestic inquiry, then an inquiry outcome), a warning counting for 12 months and 3 days to answer a show-cause letter are proposed until Group HR and counsel issue the handbook.',
  ),
  disciplineLaw: rule(
    'EA-DISCIPLINE',
    true,
    'Law',
    'Employment Act 1955: s.14(1) dismissal without notice, downgrading or suspension without wages for up to 2 weeks only for misconduct and only after due inquiry; s.14(2) suspension pending inquiry up to 2 weeks with at least half wages; s.24 no fines or penalty deductions from wages; s.15(2) absence for more than 2 consecutive working days without leave, reasonable excuse or informing the employer counts as breaking the contract; s.60F(2) a guard on sick leave must inform the employer within 48 hours. Sabah and Sarawak Labour Ordinances apply in those states; counsel to confirm the handbook.',
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
    'V14 s.209 and s.226: a vault door opening with no issue, return or count within 15 minutes is flagged for an independent check. Proposed window, for approval.',
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
    14,
    'Unverified',
    'Malaysian general insurance runs on cash before cover; some corporate policies allow a premium warranty period. Warn 14 days before the premium is due. Confirm each policy with the broker.',
  ),
  insuranceClaimNoticeDays: rule(
    'INS-CLAIM-NOTICE',
    30,
    'Unverified',
    'Most policies say notify the insurer as soon as possible. Proposed: 30 days from the incident at the latest. Check each policy wording.',
  ),
  insuranceClaimAgeDays: rule('INS-CLAIM-AGE', 90, 'Policy', 'Proposed: a claim still open 90 days after notice is chased with the insurer or broker.'),
  guaranteeLeadDays: rule(
    'INS-GUARANTEE',
    60,
    'Policy',
    'A performance bond or guarantee must stay valid until the contract or tender validity ends. Proposed: extend 60 days before it expires; ask for release once the contract ends.',
  ),
  requiredCover: rule<{ kind: InsuranceKind; when: 'all' | 'foreign' | 'armed' | 'cit'; why: string }[]>(
    'INS-REQUIRED',
    [
      { kind: 'PUBLIC_LIABILITY', when: 'all', why: 'Client contracts and tenders ask for it (COM-TENDER-ELIGIBLE)' },
      { kind: 'GROUP_PERSONAL_ACCIDENT', when: 'all', why: 'Proposed group policy for every guard' },
      { kind: 'FIDELITY_GUARANTEE', when: 'all', why: 'Proposed: covers theft by staff at client sites' },
      { kind: 'FW_HOSPITALISATION', when: 'foreign', why: 'Foreign worker hospitalisation cover (SPIKPA) is needed for the work permit; to confirm' },
      { kind: 'ARMED_SERVICE', when: 'armed', why: 'Armed-service liability, asked for in client arms agreements (V14)' },
      { kind: 'CASH_IN_TRANSIT', when: 'cit', why: 'Cash-in-transit cover for CIT, CDM and vault jobs' },
    ],
    'Policy',
    'Proposed minimum cover per company, for approval with the Chief of Staff and counsel',
  ),
  clockInWindowMin: rule('OPS-CLOCK-WINDOW', 60, 'Policy', 'Clock-in allowed from 60 minutes before shift start'),
  licenceLeadDays: rule<Record<LicenceType, number>>(
    'REG-LEAD',
    { KDN_LICENCE: 120, MOF_REGISTRATION: 90, INSURANCE: 90, SSM_ANNUAL_RETURN: 60 },
    'Policy',
    'Universal Operating Guidebook: KDN T-120, MOF T-90, insurance T-90, SSM T-60',
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
      FIREARM_PERMIT: 60,
      RANGE_PRACTICE: 30,
    },
    'Policy',
    'Proposed reminder lead times for personal permits, for approval',
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
  FIREARM_PERMIT: 'Firearm permit',
  RANGE_PRACTICE: 'Range practice',
};

export const LICENCE_LABEL: Record<LicenceType, string> = {
  KDN_LICENCE: 'KDN security licence',
  MOF_REGISTRATION: 'MOF registration',
  INSURANCE: 'Group insurance',
  SSM_ANNUAL_RETURN: 'SSM annual return',
};

/** Credentials every deployable guard must hold. */
export const REQUIRED_ALL: CredentialType[] = ['KDN_GUARD_CARD', 'CSG_TRAINING'];
/** Extra credentials for foreign workers. */
export const REQUIRED_FOREIGN: CredentialType[] = ['PLKS_PERMIT', 'PASSPORT', 'FOMEMA', 'FW_INSURANCE'];

export const INSURANCE_LABEL: Record<InsuranceKind, string> = {
  PUBLIC_LIABILITY: 'Public liability',
  GROUP_PERSONAL_ACCIDENT: 'Group personal accident',
  GROUP_HOSPITALISATION: 'Group hospitalisation',
  FW_HOSPITALISATION: 'Foreign worker hospitalisation',
  FIDELITY_GUARANTEE: 'Fidelity guarantee',
  ARMED_SERVICE: 'Armed-service liability',
  CASH_IN_TRANSIT: 'Cash in transit',
  MOTOR_FLEET: 'Motor fleet',
  FIRE_OFFICE: 'Fire and office',
};

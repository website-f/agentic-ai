// Pure checks used by both the API and the browser demo. They never decide on pay,
// discipline or contracts; they block clear breaches and flag the rest for a person.

import { CREDENTIAL_LABEL, LICENCE_LABEL, REQUIRED_ALL, REQUIRED_FOREIGN, RULES } from './rules';
import { addMinutes, addWorkingDays, ageOn, dateOf, daysBetween, minutesBetween, myt, toMs } from './time';
import type {
  ArmsMovement,
  AttendanceFlag,
  CompanyLicence,
  Credential,
  CredentialType,
  FaceCapture,
  Firearm,
  IsoDate,
  IsoDateTime,
  LicenceType,
  Person,
  Severity,
  Shift,
  Site,
  TenderChannel,
  Vault,
} from './types';

// ---------- Expiry status ----------

/** UNKNOWN is never shown as compliant (master plan rule 12). */
export type ExpiryStatus = 'OK' | 'DUE' | 'OVERDUE' | 'UNKNOWN';

export interface ExpiryResult {
  status: ExpiryStatus;
  daysLeft: number | null;
}

export function expiryStatus(expiresOn: IsoDate | null | undefined, today: IsoDate, leadDays: number): ExpiryResult {
  if (expiresOn === undefined) return { status: 'UNKNOWN', daysLeft: null };
  if (expiresOn === null) return { status: 'OK', daysLeft: null };
  const daysLeft = daysBetween(today, expiresOn);
  if (daysLeft < 0) return { status: 'OVERDUE', daysLeft };
  if (daysLeft <= leadDays) return { status: 'DUE', daysLeft };
  return { status: 'OK', daysLeft };
}

export function licenceStatus(licence: CompanyLicence | undefined, today: IsoDate): ExpiryResult {
  if (!licence || licence.expiresOn === null) return { status: 'UNKNOWN', daysLeft: null };
  return expiryStatus(licence.expiresOn, today, RULES.licenceLeadDays.value[licence.type]);
}

export function credentialStatus(c: Credential | undefined, type: CredentialType, today: IsoDate): ExpiryResult {
  if (!c) return { status: 'UNKNOWN', daysLeft: null };
  return expiryStatus(c.expiresOn, today, RULES.credentialLeadDays.value[type]);
}

export const STATUS_RANK: Record<ExpiryStatus, number> = { OVERDUE: 3, UNKNOWN: 2, DUE: 1, OK: 0 };

/** Worst status wins; used for roll-ups so one missing record keeps a company off green. */
export function worst(statuses: ExpiryStatus[]): ExpiryStatus {
  return statuses.reduce<ExpiryStatus>((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), 'OK');
}

export { LICENCE_LABEL };

// ---------- Deployability ----------

export interface Finding {
  level: 'block' | 'warn';
  code: string;
  message: string;
  ruleId?: string;
}

export function requiredCredentials(person: Person, armed: boolean): CredentialType[] {
  // Office staff are not posted at sites, so no guard papers are needed.
  if (person.role === 'office') return [];
  const req = [...REQUIRED_ALL];
  if (person.nationality !== 'MY') req.push(...REQUIRED_FOREIGN);
  if (armed) req.push('FIREARM_PERMIT');
  return req;
}

/** Latest credential of each type for a person. */
export function latestCredentials(credentials: Credential[]): Map<CredentialType, Credential> {
  const out = new Map<CredentialType, Credential>();
  for (const c of credentials) {
    const cur = out.get(c.type);
    if (!cur || c.issuedOn > cur.issuedOn) out.set(c.type, c);
  }
  return out;
}

/** Can this person be deployed on this date, to an armed or unarmed post? (W3, W4, W5) */
export function deployability(person: Person, credentials: Credential[], on: IsoDate, armed: boolean): Finding[] {
  const findings: Finding[] = [];
  if (person.status !== 'active') {
    findings.push({ level: 'block', code: 'NOT_ACTIVE', message: `${person.name} is ${person.status}.` });
  }
  const age = ageOn(person.dob, on);
  if (age > RULES.maxGuardAge.value) {
    findings.push({
      level: 'block',
      code: 'OVER_AGE',
      message: `${person.name} is ${age}. Group policy allows guards up to ${RULES.maxGuardAge.value}.`,
      ruleId: RULES.maxGuardAge.id,
    });
  }
  const latest = latestCredentials(credentials.filter((c) => c.personId === person.id));
  for (const type of requiredCredentials(person, armed)) {
    const r = checkRequirement(person, latest, type, on);
    if (r.level !== 'ok') findings.push({ level: r.level, code: r.code, message: r.message!, ruleId: r.ruleId });
  }
  return findings;
}

export interface Requirement extends ExpiryResult {
  type: CredentialType;
  label: string;
  level: 'ok' | 'warn' | 'block';
  code: string;
  message: string | null;
  /** Short text for a status chip when it differs from the plain expiry wording. */
  chip?: string;
  ruleId?: string;
}

/** Same month and day, n months later (clamped to month end). */
function addMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export function csgDeadline(person: Person): IsoDate {
  return addMonths(person.hiredOn, RULES.csgDeadlineMonths.value);
}

/**
 * One required paper for one person on one date, with the two exceptions Fauzan set on
 * 24 Oct 2026: work is allowed while KDN vetting is pending once submitted in eSIMS, and
 * CSG training may be completed any time in the first year of work.
 */
export function checkRequirement(person: Person, latest: Map<CredentialType, Credential>, type: CredentialType, on: IsoDate): Requirement {
  const label = CREDENTIAL_LABEL[type];
  const c = latest.get(type);
  const res = credentialStatus(c, type, on);
  const base = { type, label, ...res };

  if (type === 'KDN_GUARD_CARD' && (res.status === 'UNKNOWN' || res.status === 'OVERDUE')) {
    const sub = latest.get('KDN_VETTING');
    // A submission counts only if it is newer than the card it replaces.
    if (sub && sub.issuedOn <= on && (!c || sub.issuedOn > c.issuedOn)) {
      const waited = daysBetween(sub.issuedOn, on);
      const usual = RULES.kdnVettingUsualDays.value;
      return {
        ...base,
        status: 'DUE',
        daysLeft: null,
        level: 'warn',
        code: 'KDN_VETTING_PENDING',
        chip: waited > usual ? `Vetting ${waited} days` : 'Vetting pending',
        message:
          `KDN vetting pending: submitted in eSIMS ${waited} days ago (${sub.number}). Allowed to work until KDN decides.` +
          (waited > usual ? ` This is longer than the usual ${usual / 7} weeks; follow up with KDN.` : ''),
        ruleId: RULES.kdnVettingUsualDays.id,
      };
    }
    if (res.status === 'UNKNOWN') {
      return {
        ...base,
        level: 'block',
        code: 'MISSING_KDN_GUARD_CARD',
        message: 'No KDN guard card on record and no vetting submitted in eSIMS.',
        ruleId: RULES.kdnVettingUsualDays.id,
      };
    }
  }

  if (type === 'CSG_TRAINING' && res.status === 'UNKNOWN') {
    const deadline = csgDeadline(person);
    const left = daysBetween(on, deadline);
    if (left >= 0) {
      return {
        ...base,
        status: 'DUE',
        daysLeft: left,
        level: 'warn',
        code: 'CSG_DUE_FIRST_YEAR',
        chip: `CSG due in ${left} days`,
        message: `CSG training not done yet. It must be done by ${deadline}, the end of the first year of work (${left} days left).`,
        ruleId: RULES.csgDeadlineMonths.id,
      };
    }
    return {
      ...base,
      status: 'OVERDUE',
      daysLeft: left,
      level: 'block',
      code: 'CSG_PAST_FIRST_YEAR',
      chip: 'CSG overdue',
      message: `CSG training was not done within the first year of work (deadline ${deadline}).`,
      ruleId: RULES.csgDeadlineMonths.id,
    };
  }

  if (res.status === 'UNKNOWN') return { ...base, level: 'block', code: `MISSING_${type}`, message: `No ${label} on record.` };
  if (res.status === 'OVERDUE') return { ...base, level: 'block', code: `EXPIRED_${type}`, message: `${label} expired ${-(res.daysLeft ?? 0)} days ago.` };
  if (res.status === 'DUE')
    return { ...base, level: 'warn', code: `DUE_${type}`, message: `${label} expires in ${res.daysLeft} days.`, ruleId: RULES.credentialLeadDays.id };
  return { ...base, level: 'ok', code: 'OK', message: null };
}

export function isBlocked(findings: Finding[]): boolean {
  return findings.some((f) => f.level === 'block');
}

// ---------- Roster ----------

export function shiftHours(s: Pick<Shift, 'start' | 'end'>): number {
  return minutesBetween(s.start, s.end) / 60;
}

/**
 * Check assigning a person to a shift against their other shifts (W6). The caller passes
 * the person's existing shifts; the candidate shift is not in that list.
 */
export function checkAssignment(args: { person: Person; credentials: Credential[]; shift: Shift; site: Site; otherShifts: Shift[] }): Finding[] {
  const { person, credentials, shift, site, otherShifts } = args;
  const findings: Finding[] = [];

  if (person.companyId !== shift.companyId) {
    findings.push({
      level: 'block',
      code: 'OTHER_COMPANY',
      message: 'This guard is employed by another company. Each company deploys only its own staff.',
    });
    return findings;
  }

  findings.push(...deployability(person, credentials, shift.date, site.armed));
  if (person.nationality !== 'MY' && site.sector === 'government' && RULES.fwPrivateOnly.value) {
    findings.push({
      level: 'block',
      code: 'FOREIGN_AT_GOVERNMENT_SITE',
      message: 'Foreign workers work only at private-sector sites. This is a government site.',
      ruleId: RULES.fwPrivateOnly.id,
    });
  }

  const hours = shiftHours(shift);
  const sameDayHours = hours + otherShifts.filter((s) => s.date === shift.date).reduce((sum, s) => sum + shiftHours(s), 0);
  if (sameDayHours > RULES.maxHoursPerDay.value) {
    findings.push({
      level: 'block',
      code: 'OVER_12_HOURS',
      message: `${sameDayHours} hours on ${shift.date}. The legal limit is ${RULES.maxHoursPerDay.value}.`,
      ruleId: RULES.maxHoursPerDay.id,
    });
  }

  const start = toMs(shift.start);
  const end = toMs(shift.end);
  for (const o of otherShifts) {
    const os = toMs(o.start);
    const oe = toMs(o.end);
    if (os < end && start < oe) {
      findings.push({ level: 'block', code: 'OVERLAP', message: `Overlaps another shift on ${o.date}.` });
      continue;
    }
    const gapH = (os >= end ? os - end : start - oe) / 3_600_000;
    if (gapH < RULES.minRestHours.value) {
      findings.push({
        level: 'warn',
        code: 'SHORT_REST',
        message: `Only ${gapH.toFixed(1)} hours rest next to the shift on ${o.date}.`,
        ruleId: RULES.minRestHours.id,
      });
    }
  }

  // Consecutive working days ending on or around this shift.
  const workDays = new Set(otherShifts.map((s) => s.date));
  workDays.add(shift.date);
  let run = 1;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.parse(`${shift.date}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
    if (!workDays.has(d)) break;
    run += 1;
  }
  for (let i = 1; i <= 7; i++) {
    const d = new Date(Date.parse(`${shift.date}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);
    if (!workDays.has(d)) break;
    run += 1;
  }
  if (run > RULES.maxConsecutiveDays.value) {
    findings.push({
      level: 'warn',
      code: 'NO_REST_DAY',
      message: `${run} working days in a row. Each guard needs one rest day a week.`,
      ruleId: RULES.maxConsecutiveDays.id,
    });
  }

  return findings;
}

// ---------- Attendance ----------

/** Great-circle distance in metres. */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** Find the rostered shift a clock-in belongs to. */
export function matchShift(shifts: Shift[], personId: string, siteId: string, at: IsoDateTime): Shift | null {
  const t = toMs(at);
  const window = RULES.clockInWindowMin.value * 60_000;
  return shifts.find((s) => s.personId === personId && s.siteId === siteId && t >= toMs(s.start) - window && t <= toMs(s.end)) ?? null;
}

export function evaluateClockIn(args: {
  shift: Shift | null;
  site: Site;
  at: IsoDateTime;
  receivedAt: IsoDateTime;
  lat: number | null;
  lng: number | null;
  face: FaceCapture | null;
  faceEnrolled: boolean;
}): { flags: AttendanceFlag[]; distanceM: number | null } {
  const flags: AttendanceFlag[] = [];
  const { shift, site, at, receivedAt, lat, lng } = args;
  if (!shift) flags.push('NOT_ROSTERED');
  else if (minutesBetween(shift.start, at) > RULES.lateGraceMin.value) flags.push('LATE');
  let dist: number | null = null;
  if (lat !== null && lng !== null) {
    dist = distanceM(lat, lng, site.lat, site.lng);
    if (dist > site.geofenceM) flags.push('OUTSIDE_GEOFENCE');
  } else {
    flags.push('OUTSIDE_GEOFENCE');
  }
  flags.push(...evaluateFace(args.face, args.faceEnrolled));
  if (minutesBetween(at, receivedAt) >= RULES.offlineSyncMin.value) flags.push('OFFLINE_SYNC');
  return { flags, distanceM: dist };
}

/**
 * Face check for clock-in and clock-out. A failed check is recorded for the supervisor,
 * never used to turn a guard away from the post.
 */
export function evaluateFace(face: FaceCapture | null, enrolled: boolean): AttendanceFlag[] {
  if (!face) return ['NO_PHOTO'];
  if (!enrolled) return ['NO_FACE_ENROLMENT'];
  const flags: AttendanceFlag[] = [];
  if (!face.live) flags.push('NO_LIVENESS');
  if (face.score < RULES.faceMatchMin.value) flags.push('FACE_NOT_MATCHED');
  return flags;
}

export const FACE_FLAGS: AttendanceFlag[] = ['NO_PHOTO', 'NO_FACE_ENROLMENT', 'NO_LIVENESS', 'FACE_NOT_MATCHED'];

export function evaluateClockOut(shift: Shift | null, at: IsoDateTime): AttendanceFlag[] {
  if (shift && minutesBetween(at, shift.end) > RULES.earlyLeaveGraceMin.value) return ['EARLY_LEAVE'];
  return [];
}

// ---------- Cases ----------

/** When the first response is due for a new case (Guidebook severities). */
export function slaDue(severity: Severity, openedAt: IsoDateTime): IsoDateTime {
  switch (severity) {
    case 'P1':
      return addMinutes(openedAt, 5);
    case 'P2':
      return addMinutes(openedAt, 30);
    case 'P3':
      return myt(dateOf(openedAt), '23:59');
    case 'P4':
      return myt(addWorkingDays(dateOf(openedAt), 2), '18:00');
  }
}

export function slaState(due: IsoDateTime, now: IsoDateTime, done: boolean): 'met' | 'running' | 'breached' {
  if (done) return 'met';
  return toMs(now) > toMs(due) ? 'breached' : 'running';
}

// ---------- Tenders ----------

/**
 * Can this company bid? Each licensed company is checked on its own papers; another
 * company's valid licence never counts (V7). Government tenders need a valid MOF
 * registration; every bid needs the KDN licence and insurance. Checked on today and on
 * the closing date. Unknown is treated as a problem, never as valid.
 */
export function tenderEligibility(channel: TenderChannel, licences: CompanyLicence[], today: IsoDate, closesOn: IsoDate): Finding[] {
  const needed: LicenceType[] = channel === 'GOVERNMENT' ? ['KDN_LICENCE', 'MOF_REGISTRATION', 'INSURANCE'] : ['KDN_LICENCE', 'INSURANCE'];
  const out: Finding[] = [];
  for (const type of needed) {
    const l = licences.find((x) => x.type === type);
    const label = LICENCE_LABEL[type];
    if (!l || l.expiresOn === null) {
      out.push({ level: 'block', code: `NO_RECORD_${type}`, message: `${label}: no record. Upload it before bidding.`, ruleId: 'COM-TENDER-ELIGIBLE' });
    } else if (l.expiresOn < today) {
      out.push({
        level: 'block',
        code: `EXPIRED_${type}`,
        message: `${label} expired on ${l.expiresOn}. Renew before bidding.`,
        ruleId: 'COM-TENDER-ELIGIBLE',
      });
    } else if (l.expiresOn < closesOn) {
      out.push({
        level: 'warn',
        code: `EXPIRES_BEFORE_CLOSING_${type}`,
        message: `${label} expires on ${l.expiresOn}, before the tender closes. Show proof of renewal.`,
        ruleId: 'COM-TENDER-ELIGIBLE',
      });
    } else if (licenceStatus(l, today).status === 'DUE') {
      out.push({ level: 'warn', code: `DUE_${type}`, message: `${label} is due for renewal on ${l.expiresOn}.`, ruleId: 'COM-TENDER-ELIGIBLE' });
    }
  }
  return out;
}

// ---------- Arms ----------

/**
 * Pre-issue gate (V14 s.206). Every failure blocks: the app never makes an armed issue
 * look ready when a legal condition is missing, and nobody can override it in the app.
 */
export function armsIssueCheck(args: {
  person: Person;
  credentials: Credential[];
  firearm: Firearm;
  vault: Vault;
  site: Site;
  shift: Shift | null;
  issuer: string;
  witness: string;
  today: IsoDate;
  firearmBusy: boolean;
  /** The RFID tag code read at the vault, if the firearm was scanned (rule ARMS-RFID). */
  rfidScan?: string | null;
}): Finding[] {
  const { person, credentials, firearm, vault, site, shift, issuer, witness, today } = args;
  const out: Finding[] = [];
  const block = (code: string, message: string, ruleId = 'ARMS-ISSUE') => out.push({ level: 'block', code, message, ruleId });
  if (firearm.companyId !== site.companyId || vault.companyId !== site.companyId)
    block('OTHER_COMPANY', 'This firearm belongs to another company. Firearms are never shared between companies.');
  if (firearm.ownership === 'TRADE')
    block('TRADE_STOCK', `${firearm.tag} is dealer stock for sale. Trade stock is never issued to a guard.`, 'ARMS-TRADE-STOCK');
  if (!site.armed) block('NOT_ARMED_SITE', `${site.name} is not an armed post.`);
  if (!shift || shift.personId !== person.id || shift.siteId !== site.id)
    block('NO_ARMED_SHIFT', `${person.name} is not rostered at ${site.name} for this shift.`);
  if (firearm.status !== 'IN_VAULT' || args.firearmBusy)
    block('NOT_IN_VAULT', `${firearm.tag} is not in the vault (status ${firearm.status.replace('_', ' ').toLowerCase()}).`);
  if (!firearm.licenceExpiresOn || firearm.licenceExpiresOn < today)
    block('FIREARM_LICENCE', `${firearm.tag}: firearm licence ${firearm.licenceExpiresOn ? 'expired' : 'not recorded'}.`);
  if (!vault.approvalExpiresOn || vault.approvalExpiresOn < today)
    block('VAULT_APPROVAL', `${vault.name}: storage approval ${vault.approvalExpiresOn ? 'expired' : 'not recorded'}.`);
  const permit = latestCredentials(credentials.filter((c) => c.personId === person.id)).get('FIREARM_PERMIT');
  const st = credentialStatus(permit, 'FIREARM_PERMIT', today);
  if (st.status === 'UNKNOWN' || st.status === 'OVERDUE') block('NO_PERMIT', `${person.name} has no valid firearm permit.`);
  if (person.status !== 'active') block('NOT_ACTIVE', `${person.name} is ${person.status}.`);
  if (vault.authorisedUsers && !vault.authorisedUsers.includes(issuer))
    block('NOT_AUTHORISED_USER', `${issuer} is not on the authorised list for ${vault.name}.`);
  const scan = normaliseRfid(args.rfidScan);
  if (scan && scan !== firearm.rfidTag)
    block(
      'RFID_MISMATCH',
      firearm.rfidTag
        ? `The tag scanned is not ${firearm.tag}’s. Scan the firearm in hand again.`
        : `${firearm.tag} has no RFID tag recorded. Record its tag first.`,
      'ARMS-RFID',
    );
  else if (!scan && RULES.armsRfid.value.scanRequired) block('RFID_NOT_SCANNED', `Scan ${firearm.tag}’s RFID tag before issuing.`, 'ARMS-RFID');
  if (!witness.trim()) block('NO_WITNESS', 'A second person must witness the issue.', 'ARMS-WITNESS');
  else if (witness.trim().toLowerCase() === issuer.trim().toLowerCase() || witness.trim().toLowerCase() === person.name.toLowerCase())
    block('SAME_WITNESS', 'The witness must be someone other than the issuer and the guard.', 'ARMS-WITNESS');
  return out;
}

/** An RFID tag code as stored: upper case, without spaces, colons or dashes. */
export function normaliseRfid(code: string | null | undefined): string | null {
  const c = (code ?? '').toUpperCase().replace(/[\s:-]+/g, '');
  return c || null;
}

export type ArmsOverdueState = 'out' | 'alert' | 'escalate' | 'loss_case' | 'returned';

/** Where an open movement sits on the overdue ladder (rule ARMS-OVERDUE). */
export function armsOverdueState(m: ArmsMovement, now: IsoDateTime): ArmsOverdueState {
  if (m.returnedAt) return 'returned';
  const late = minutesBetween(m.dueBack, now);
  const r = RULES.armsOverdue.value;
  if (late >= r.lossCaseMin) return 'loss_case';
  if (late >= r.escalateMin) return 'escalate';
  if (late >= r.alertMin) return 'alert';
  return 'out';
}
